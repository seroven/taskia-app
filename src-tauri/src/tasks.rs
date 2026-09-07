use chrono::{Duration, Local, NaiveDate};
use serde::Deserialize;
use tauri::State;

use crate::auth::require_user;
use crate::error::{AppError, AppResult};
use crate::models::{Task, TaskKind, TaskRow, TaskStatus};
use crate::AppState;

const TASK_SELECT: &str = r#"
  SELECT
    t.id, t.user_id, t.course_id, c.name AS course_name,
    t.difficulty_id, d.code AS difficulty_code, d.name AS difficulty_name,
    t.title, t.description, t.task_kind, t.status, t.board_order,
    t.study_passed, t.due_date, t.created_at, t.updated_at
  FROM tasks t
  INNER JOIN courses c ON c.id = t.course_id
  INNER JOIN difficulties d ON d.id = t.difficulty_id
"#;

#[derive(Debug, Deserialize)]
pub struct TaskFilters {
    pub created_on: Option<String>,
    pub due_on: Option<String>,
    pub course_id: Option<u64>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskPayload {
    pub title: String,
    pub description: Option<String>,
    pub course_id: u64,
    pub difficulty_id: u64,
    pub task_kind: String,
    pub due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveTaskPayload {
    pub task_id: u64,
    pub status: String,
    pub board_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReorderItem {
    pub task_id: u64,
    pub status: String,
    pub board_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskPayload {
    pub task_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub course_id: u64,
    pub difficulty_id: u64,
    pub task_kind: String,
    pub due_date: Option<String>,
    pub status: String,
}

fn parse_date(value: &str, field: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::msg(format!("Fecha inválida en {field}. Usa YYYY-MM-DD")))
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Inicio (incl.) y fin (excl.) del día civil local, expresados en UTC naive
/// para comparar contra `created_at` guardado en UTC.
fn local_day_utc_range(date: NaiveDate) -> AppResult<(chrono::NaiveDateTime, chrono::NaiveDateTime)> {
    use chrono::{TimeZone, Utc};

    let start_local = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::msg("Fecha inválida"))?;
    let end_local = (date + Duration::days(1))
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::msg("Fecha inválida"))?;

    let start = Local
        .from_local_datetime(&start_local)
        .single()
        .ok_or_else(|| AppError::msg("No se pudo interpretar el inicio del día local"))?
        .with_timezone(&Utc)
        .naive_utc();
    let end = Local
        .from_local_datetime(&end_local)
        .single()
        .ok_or_else(|| AppError::msg("No se pudo interpretar el fin del día local"))?
        .with_timezone(&Utc)
        .naive_utc();

    Ok((start, end))
}

fn resolve_due_date(kind: &TaskKind, due_date: &Option<String>) -> AppResult<NaiveDate> {
    match kind {
        TaskKind::Daily => Ok(today()),
        TaskKind::Project => {
            let value = due_date
                .as_ref()
                .ok_or_else(|| AppError::msg("Elige hasta cuándo tienes para el proyecto"))?;
            parse_date(value, "due_date")
        }
    }
}

async fn ensure_course(pool: &sqlx::MySqlPool, course_id: u64) -> AppResult<()> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM courses WHERE id = ? AND is_active = 1",
    )
    .bind(course_id)
    .fetch_one(pool)
    .await?;

    if exists == 0 {
        return Err(AppError::msg("Curso no válido"));
    }
    Ok(())
}

async fn ensure_difficulty(pool: &sqlx::MySqlPool, difficulty_id: u64) -> AppResult<()> {
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM difficulties WHERE id = ?")
            .bind(difficulty_id)
            .fetch_one(pool)
            .await?;

    if exists == 0 {
        return Err(AppError::msg("Dificultad no válida"));
    }
    Ok(())
}

/// Candado: dificultad Alta no puede pasar a Terminado sin study_passed.
fn ensure_can_mark_done(
    difficulty_code: &str,
    study_passed: bool,
    current_status: &TaskStatus,
    next_status: &TaskStatus,
) -> AppResult<()> {
    if *next_status != TaskStatus::Done {
        return Ok(());
    }
    // Ya estaba en Terminado (reorden dentro de la columna): no bloquear.
    if *current_status == TaskStatus::Done {
        return Ok(());
    }
    if difficulty_code == "high" && !study_passed {
        return Err(AppError::msg(
            "Esta tarea es de dificultad Alta. Primero estudiala con el tutor hasta que diga que estás listo.",
        ));
    }
    Ok(())
}

async fn difficulty_code_by_id(pool: &sqlx::MySqlPool, difficulty_id: u64) -> AppResult<String> {
    sqlx::query_scalar::<_, String>("SELECT code FROM difficulties WHERE id = ? LIMIT 1")
        .bind(difficulty_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::msg("Dificultad no válida"))
}

pub(crate) async fn fetch_task(
    pool: &sqlx::MySqlPool,
    task_id: u64,
    user_id: u64,
) -> AppResult<Task> {
    let sql = format!(
        "{TASK_SELECT}
        WHERE t.id = ? AND t.user_id = ?
        LIMIT 1"
    );

    let row = sqlx::query_as::<_, TaskRow>(&sql)
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::msg("Tarea no encontrada"))?;

    row.into_task().map_err(AppError::msg)
}

#[tauri::command]
pub async fn list_tasks(
    filters: TaskFilters,
    state: State<'_, AppState>,
) -> AppResult<Vec<Task>> {
    let user = require_user(&state).await?;

    let mut sql = format!("{TASK_SELECT} WHERE t.user_id = ?");

    let mut created_range: Option<(chrono::NaiveDateTime, chrono::NaiveDateTime)> = None;
    let mut due_on: Option<NaiveDate> = None;

    if let Some(ref value) = filters.created_on {
        let date = parse_date(value, "created_on")?;
        // Evitar DATE(created_at): MySQL en UTC rompe el “día local” de noche.
        created_range = Some(local_day_utc_range(date)?);
        sql.push_str(" AND t.created_at >= ? AND t.created_at < ?");
    }

    if let Some(ref value) = filters.due_on {
        due_on = Some(parse_date(value, "due_on")?);
        sql.push_str(" AND t.due_date = ?");
    }

    if filters.course_id.is_some() {
        sql.push_str(" AND t.course_id = ?");
    }

    if let Some(ref status) = filters.status {
        TaskStatus::from_db(status).map_err(AppError::msg)?;
        sql.push_str(" AND t.status = ?");
    }

    sql.push_str(" ORDER BY t.status ASC, t.board_order ASC, t.id ASC");

    let mut query = sqlx::query_as::<_, TaskRow>(&sql).bind(user.id);

    if let Some((start, end)) = created_range {
        query = query.bind(start).bind(end);
    }
    if let Some(date) = due_on {
        query = query.bind(date);
    }
    if let Some(course_id) = filters.course_id {
        query = query.bind(course_id);
    }
    if let Some(ref status) = filters.status {
        query = query.bind(status);
    }

    let rows = query.fetch_all(&state.pool).await?;
    let mut tasks = Vec::with_capacity(rows.len());
    for row in rows {
        tasks.push(row.into_task().map_err(AppError::msg)?);
    }
    Ok(tasks)
}

#[tauri::command]
pub async fn create_task(
    payload: CreateTaskPayload,
    state: State<'_, AppState>,
) -> AppResult<Task> {
    let user = require_user(&state).await?;
    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::msg("El título es obligatorio"));
    }

    let kind = TaskKind::from_db(&payload.task_kind).map_err(AppError::msg)?;
    let due_date = resolve_due_date(&kind, &payload.due_date)?;
    let description = payload
        .description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    ensure_course(&state.pool, payload.course_id).await?;
    ensure_difficulty(&state.pool, payload.difficulty_id).await?;

    let next_order = sqlx::query_scalar::<_, Option<i32>>(
        r#"
        SELECT MAX(board_order)
        FROM tasks
        WHERE user_id = ? AND status = 'pending'
        "#,
    )
    .bind(user.id)
    .fetch_one(&state.pool)
    .await?
    .map(|value| value + 1)
    .unwrap_or(0);

    let result = sqlx::query(
        r#"
        INSERT INTO tasks (
          user_id, course_id, difficulty_id, title, description,
          task_kind, status, board_order, due_date
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        "#,
    )
    .bind(user.id)
    .bind(payload.course_id)
    .bind(payload.difficulty_id)
    .bind(&title)
    .bind(description)
    .bind(kind.as_str())
    .bind(next_order)
    .bind(due_date)
    .execute(&state.pool)
    .await?;

    fetch_task(&state.pool, result.last_insert_id(), user.id).await
}

#[tauri::command]
pub async fn move_task(
    payload: MoveTaskPayload,
    state: State<'_, AppState>,
) -> AppResult<Task> {
    let user = require_user(&state).await?;
    let status = TaskStatus::from_db(&payload.status).map_err(AppError::msg)?;
    let current = fetch_task(&state.pool, payload.task_id, user.id).await?;
    ensure_can_mark_done(
        &current.difficulty_code,
        current.study_passed,
        &current.status,
        &status,
    )?;

    let updated = sqlx::query(
        r#"
        UPDATE tasks
        SET status = ?, board_order = ?
        WHERE id = ? AND user_id = ?
        "#,
    )
    .bind(status.as_str())
    .bind(payload.board_order)
    .bind(payload.task_id)
    .bind(user.id)
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::msg("Tarea no encontrada"));
    }

    fetch_task(&state.pool, payload.task_id, user.id).await
}

#[tauri::command]
pub async fn update_task(
    payload: UpdateTaskPayload,
    state: State<'_, AppState>,
) -> AppResult<Task> {
    let user = require_user(&state).await?;
    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::msg("El título es obligatorio"));
    }

    let status = TaskStatus::from_db(&payload.status).map_err(AppError::msg)?;
    let kind = TaskKind::from_db(&payload.task_kind).map_err(AppError::msg)?;
    let due_date = resolve_due_date(&kind, &payload.due_date)?;
    let description = payload
        .description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    ensure_course(&state.pool, payload.course_id).await?;
    ensure_difficulty(&state.pool, payload.difficulty_id).await?;

    let current = fetch_task(&state.pool, payload.task_id, user.id).await?;
    let next_difficulty_code = if payload.difficulty_id == current.difficulty_id {
        current.difficulty_code.clone()
    } else {
        difficulty_code_by_id(&state.pool, payload.difficulty_id).await?
    };
    ensure_can_mark_done(
        &next_difficulty_code,
        current.study_passed,
        &current.status,
        &status,
    )?;
    let status_changed = current.status.as_str() != status.as_str();

    let board_order = if status_changed {
        sqlx::query_scalar::<_, Option<i32>>(
            r#"
            SELECT MAX(board_order)
            FROM tasks
            WHERE user_id = ? AND status = ?
            "#,
        )
        .bind(user.id)
        .bind(status.as_str())
        .fetch_one(&state.pool)
        .await?
        .map(|value| value + 1)
        .unwrap_or(0)
    } else {
        current.board_order
    };

    let updated = sqlx::query(
        r#"
        UPDATE tasks
        SET title = ?, description = ?, course_id = ?, difficulty_id = ?,
            task_kind = ?, due_date = ?, status = ?, board_order = ?
        WHERE id = ? AND user_id = ?
        "#,
    )
    .bind(&title)
    .bind(description)
    .bind(payload.course_id)
    .bind(payload.difficulty_id)
    .bind(kind.as_str())
    .bind(due_date)
    .bind(status.as_str())
    .bind(board_order)
    .bind(payload.task_id)
    .bind(user.id)
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::msg("Tarea no encontrada"));
    }

    fetch_task(&state.pool, payload.task_id, user.id).await
}

#[tauri::command]
pub async fn reorder_tasks(
    items: Vec<ReorderItem>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let user = require_user(&state).await?;

    let mut tx = state.pool.begin().await?;

    for item in items {
        let status = TaskStatus::from_db(&item.status).map_err(AppError::msg)?;
        let current = fetch_task(&state.pool, item.task_id, user.id).await?;
        ensure_can_mark_done(
            &current.difficulty_code,
            current.study_passed,
            &current.status,
            &status,
        )?;

        let updated = sqlx::query(
            r#"
            UPDATE tasks
            SET status = ?, board_order = ?
            WHERE id = ? AND user_id = ?
            "#,
        )
        .bind(status.as_str())
        .bind(item.board_order)
        .bind(item.task_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;

        if updated.rows_affected() == 0 {
            return Err(AppError::msg(format!(
                "Tarea {} no encontrada",
                item.task_id
            )));
        }
    }

    tx.commit().await?;
    Ok(())
}
