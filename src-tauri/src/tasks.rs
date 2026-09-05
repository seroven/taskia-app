use chrono::NaiveDate;
use serde::Deserialize;
use tauri::State;

use crate::auth::require_user;
use crate::error::{AppError, AppResult};
use crate::models::{Task, TaskRow, TaskStatus};
use crate::AppState;

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
    pub due_date: String,
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

fn parse_date(value: &str, field: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::msg(format!("Fecha inválida en {field}. Usa YYYY-MM-DD")))
}

async fn fetch_task(pool: &sqlx::MySqlPool, task_id: u64, user_id: u64) -> AppResult<Task> {
    let row = sqlx::query_as::<_, TaskRow>(
        r#"
        SELECT
          t.id, t.user_id, t.course_id, c.name AS course_name,
          t.title, t.description, t.status, t.board_order,
          t.due_date, t.created_at, t.updated_at
        FROM tasks t
        INNER JOIN courses c ON c.id = t.course_id
        WHERE t.id = ? AND t.user_id = ?
        LIMIT 1
        "#,
    )
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

    let mut sql = String::from(
        r#"
        SELECT
          t.id, t.user_id, t.course_id, c.name AS course_name,
          t.title, t.description, t.status, t.board_order,
          t.due_date, t.created_at, t.updated_at
        FROM tasks t
        INNER JOIN courses c ON c.id = t.course_id
        WHERE t.user_id = ?
        "#,
    );

    let mut created_on: Option<NaiveDate> = None;
    let mut due_on: Option<NaiveDate> = None;

    if let Some(ref value) = filters.created_on {
        created_on = Some(parse_date(value, "created_on")?);
        sql.push_str(" AND DATE(t.created_at) = ?");
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

    if let Some(date) = created_on {
        query = query.bind(date);
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

    let due_date = parse_date(&payload.due_date, "due_date")?;
    let description = payload
        .description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let course_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM courses WHERE id = ? AND is_active = 1",
    )
    .bind(payload.course_id)
    .fetch_one(&state.pool)
    .await?;

    if course_exists == 0 {
        return Err(AppError::msg("Curso no válido"));
    }

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
        INSERT INTO tasks (user_id, course_id, title, description, status, board_order, due_date)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
        "#,
    )
    .bind(user.id)
    .bind(payload.course_id)
    .bind(&title)
    .bind(description)
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

#[derive(Debug, Deserialize)]
pub struct UpdateTaskPayload {
    pub task_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub course_id: u64,
    pub due_date: String,
    pub status: String,
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
    let due_date = parse_date(&payload.due_date, "due_date")?;
    let description = payload
        .description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let course_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM courses WHERE id = ? AND is_active = 1",
    )
    .bind(payload.course_id)
    .fetch_one(&state.pool)
    .await?;

    if course_exists == 0 {
        return Err(AppError::msg("Curso no válido"));
    }

    let current = fetch_task(&state.pool, payload.task_id, user.id).await?;
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
        SET title = ?, description = ?, course_id = ?, due_date = ?, status = ?, board_order = ?
        WHERE id = ? AND user_id = ?
        "#,
    )
    .bind(&title)
    .bind(description)
    .bind(payload.course_id)
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
