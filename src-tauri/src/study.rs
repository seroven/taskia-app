use std::fs;
use std::path::PathBuf;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use tauri::{AppHandle, Manager, State};

use crate::auth::require_user;
use crate::error::{AppError, AppResult};
use crate::models::Task;
use crate::tasks::fetch_task;
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TutorPhase {
    Understanding,
    Practicing,
    Reviewing,
}

impl Default for TutorPhase {
    fn default() -> Self {
        Self::Understanding
    }
}

impl TutorPhase {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Understanding => "understanding",
            Self::Practicing => "practicing",
            Self::Reviewing => "reviewing",
        }
    }

    fn from_db(value: &str) -> Self {
        match value {
            "practicing" => Self::Practicing,
            "reviewing" => Self::Reviewing,
            _ => Self::Understanding,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyMessage {
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyContext {
    pub task_id: u64,
    pub updated_at: String,
    pub tutor_phase: TutorPhase,
    pub topic_summary: String,
    /// Resumen vivo que se envía a Gemini (no el chat completo).
    pub context_summary: String,
    pub hints_level: i32,
    pub messages: Vec<StudyMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudySession {
    pub context: StudyContext,
    pub board: Value,
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyExercise {
    pub id: String,
    pub title: String,
    pub instructions: String,
    pub expected_interaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiTutorReply {
    pub phase: String,
    pub speak_to_child: String,
    pub ask_questions: Vec<String>,
    pub topic_summary: String,
    pub context_summary: String,
    /// Memoria del niño entre tareas (resumen vivo del usuario).
    pub user_memory_summary: String,
    pub exercise: Option<StudyExercise>,
    pub draw_ops: Vec<Value>,
    pub hints_level: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyChatResponse {
    pub reply: GeminiTutorReply,
    pub context: StudyContext,
}

#[derive(Debug, FromRow)]
struct StudySessionRow {
    task_id: u64,
    tutor_phase: String,
    topic_summary: String,
    context_summary: String,
    hints_level: i32,
    updated_at: chrono::NaiveDateTime,
}

#[derive(Debug, FromRow)]
struct StudyMessageRow {
    role: String,
    content: String,
    created_at: chrono::NaiveDateTime,
}

fn study_root(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::msg(format!("No se pudo resolver app data: {err}")))?;
    Ok(base.join("study"))
}

fn task_dir(app: &AppHandle, task_id: u64) -> AppResult<PathBuf> {
    let dir = study_root(app)?.join(task_id.to_string());
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn board_path(app: &AppHandle, task_id: u64) -> AppResult<PathBuf> {
    Ok(task_dir(app, task_id)?.join("board.json"))
}

fn empty_board() -> Value {
    json!({
      "type": "excalidraw",
      "version": 2,
      "source": "taskia",
      "elements": [],
      "appState": {
        "viewBackgroundColor": "#ffffff"
      },
      "files": {}
    })
}

async fn load_board(
    pool: &sqlx::MySqlPool,
    app: &AppHandle,
    task_id: u64,
) -> AppResult<Value> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT board_json FROM study_boards WHERE task_id = ?")
            .bind(task_id)
            .fetch_optional(pool)
            .await?;

    if let Some(raw) = existing {
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            return Ok(value);
        }
    }

    // Migración suave desde archivo local antiguo (si existe)
    let path = board_path(app, task_id)?;
    if path.exists() {
        let raw = fs::read_to_string(&path)?;
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            save_board_db(pool, task_id, &value).await?;
            return Ok(value);
        }
    }

    let board = empty_board();
    save_board_db(pool, task_id, &board).await?;
    Ok(board)
}

async fn save_board_db(
    pool: &sqlx::MySqlPool,
    task_id: u64,
    board: &Value,
) -> AppResult<()> {
    let raw = serde_json::to_string(board)?;
    sqlx::query(
        r#"
        INSERT INTO study_boards (task_id, board_json)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE board_json = VALUES(board_json)
        "#,
    )
    .bind(task_id)
    .bind(raw)
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_user_memory(pool: &sqlx::MySqlPool, user_id: u64) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO user_study_memory (user_id, memory_summary)
        VALUES (?, '')
        ON DUPLICATE KEY UPDATE user_id = user_id
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_user_memory(pool: &sqlx::MySqlPool, user_id: u64) -> AppResult<String> {
    ensure_user_memory(pool, user_id).await?;
    let summary: String =
        sqlx::query_scalar("SELECT memory_summary FROM user_study_memory WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    Ok(summary)
}

async fn save_user_memory(
    pool: &sqlx::MySqlPool,
    user_id: u64,
    summary: &str,
) -> AppResult<()> {
    ensure_user_memory(pool, user_id).await?;
    sqlx::query("UPDATE user_study_memory SET memory_summary = ? WHERE user_id = ?")
        .bind(summary)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

fn phase_from_str(value: &str) -> TutorPhase {
    TutorPhase::from_db(value)
}

fn truncate_chars(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

const MAX_CONTEXT_SUMMARY: usize = 400;
const MAX_USER_MEMORY: usize = 600;
const MAX_BOARD_DESCRIPTION: usize = 500;
const MAX_SPEAK: usize = 450;


async fn ensure_study_session(pool: &sqlx::MySqlPool, task_id: u64) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO study_sessions (task_id, tutor_phase, topic_summary, context_summary, hints_level)
        VALUES (?, 'understanding', '', '', 0)
        ON DUPLICATE KEY UPDATE task_id = task_id
        "#,
    )
    .bind(task_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_context(pool: &sqlx::MySqlPool, task_id: u64) -> AppResult<StudyContext> {
    ensure_study_session(pool, task_id).await?;

    let row = sqlx::query_as::<_, StudySessionRow>(
        r#"
        SELECT task_id, tutor_phase, topic_summary, context_summary, hints_level, updated_at
        FROM study_sessions
        WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_one(pool)
    .await?;

    let message_rows = sqlx::query_as::<_, StudyMessageRow>(
        r#"
        SELECT role, content, created_at
        FROM study_messages
        WHERE task_id = ?
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(task_id)
    .fetch_all(pool)
    .await?;

    Ok(StudyContext {
        task_id: row.task_id,
        updated_at: row.updated_at.format("%Y-%m-%d %H:%M:%S").to_string(),
        tutor_phase: TutorPhase::from_db(&row.tutor_phase),
        topic_summary: row.topic_summary,
        context_summary: row.context_summary,
        hints_level: row.hints_level,
        messages: message_rows
            .into_iter()
            .map(|m| StudyMessage {
                role: m.role,
                content: m.content,
                created_at: m.created_at.format("%Y-%m-%d %H:%M:%S").to_string(),
            })
            .collect(),
    })
}

async fn save_session_meta(pool: &sqlx::MySqlPool, context: &StudyContext) -> AppResult<()> {
    sqlx::query(
        r#"
        UPDATE study_sessions
        SET tutor_phase = ?,
            topic_summary = ?,
            context_summary = ?,
            hints_level = ?
        WHERE task_id = ?
        "#,
    )
    .bind(context.tutor_phase.as_str())
    .bind(&context.topic_summary)
    .bind(&context.context_summary)
    .bind(context.hints_level)
    .bind(context.task_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_message(
    pool: &sqlx::MySqlPool,
    task_id: u64,
    role: &str,
    content: &str,
) -> AppResult<StudyMessage> {
    let result = sqlx::query(
        r#"
        INSERT INTO study_messages (task_id, role, content)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(task_id)
    .bind(role)
    .bind(content)
    .execute(pool)
    .await?;

    let id = result.last_insert_id();
    let created = sqlx::query_scalar::<_, chrono::NaiveDateTime>(
        "SELECT created_at FROM study_messages WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(StudyMessage {
        role: role.to_string(),
        content: content.to_string(),
        created_at: created.format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

fn extract_json_object(text: &str) -> AppResult<String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') {
        return Ok(trimmed.to_string());
    }
    let re = Regex::new(r"(?s)\{.*\}").map_err(|err| AppError::msg(err.to_string()))?;
    re.find(trimmed)
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| AppError::msg("La IA no devolvió JSON válido"))
}

fn tutor_system_prompt() -> &'static str {
    r##"Tutor amable para niño ~10 años. Español latinoamericano, claro y breve.
No des la solución completa: guía con preguntas/pistas. Prioriza la tarea actual.
Recibes context_summary (esta tarea) y user_memory_summary (entre tareas). No el chat entero.
Pizarra opcional: si board_has_drawing=false, ignórala por completo.
Responde SOLO JSON (sin markdown):
{"phase":"understanding|practicing|reviewing","speak_to_child":"...","ask_questions":[],"topic_summary":"...","context_summary":"...","user_memory_summary":"...","exercise":null,"draw_ops":[],"hints_level":0}
context_summary ≤ 400 chars. user_memory_summary ≤ 600 chars (si update_user_memory=false, repite el recibido).
draw_ops [] por defecto; solo dibuja si ayuda de verdad. exercise null salvo en practicing.
"##
}

fn build_user_payload(
    task: &Task,
    context: &StudyContext,
    user_message: &str,
    board_description: Option<&str>,
    user_memory: &str,
    update_user_memory: bool,
) -> String {
    let description = truncate_chars(
        task.description.as_deref().unwrap_or(""),
        220,
    );
    let board_has_content = board_description
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    json!({
      "instruction": if board_has_content {
        "Responde breve. Usa context_summary + user_memory + mensaje + pizarra. Actualiza context_summary."
      } else {
        "Responde breve. Usa context_summary + user_memory + mensaje. Ignora pizarra. Actualiza context_summary."
      },
      "update_user_memory": update_user_memory,
      "task": {
        "title": truncate_chars(&task.title, 120),
        "description": description,
        "course": task.course_name,
        "difficulty": task.difficulty_name
      },
      "phase": context.tutor_phase,
      "topic_summary": truncate_chars(&context.topic_summary, 120),
      "context_summary": truncate_chars(&context.context_summary, MAX_CONTEXT_SUMMARY),
      "user_memory_summary": truncate_chars(user_memory, MAX_USER_MEMORY),
      "hints_level": context.hints_level,
      "board_has_drawing": board_has_content,
      "board_drawing": if board_has_content {
        truncate_chars(board_description.unwrap_or(""), MAX_BOARD_DESCRIPTION)
      } else {
        String::new()
      },
      "child_message": truncate_chars(user_message, 800)
    })
    .to_string()
}

async fn call_gemini(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    board_image_base64: Option<&str>,
) -> AppResult<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );

    let mut parts = vec![json!({ "text": user })];
    if let Some(raw) = board_image_base64.map(str::trim).filter(|s| !s.is_empty()) {
        let data = raw
            .strip_prefix("data:image/png;base64,")
            .or_else(|| raw.strip_prefix("data:image/jpeg;base64,"))
            .unwrap_or(raw);
        parts.push(json!({
          "inline_data": {
            "mime_type": "image/png",
            "data": data
          }
        }));
        parts.push(json!({
          "text": "Imagen de la pizarra del niño. Úsala solo si aporta."
        }));
    }

    let body = json!({
      "systemInstruction": {
        "parts": [{ "text": system }]
      },
      "contents": [{
        "role": "user",
        "parts": parts
      }],
      "generationConfig": {
        "temperature": 0.6,
        "maxOutputTokens": 700,
        "responseMimeType": "application/json"
      }
    });

    let client = reqwest::Client::new();
    let response = client.post(url).json(&body).send().await?;
    let status = response.status();
    let payload: Value = response.json().await?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Error al llamar a Gemini");
        return Err(AppError::msg(message.to_string()));
    }

    let text = payload
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::msg("Respuesta vacía de Gemini"))?;

    Ok(text.to_string())
}

fn parse_tutor_reply(raw: &str) -> AppResult<GeminiTutorReply> {
    let json_text = extract_json_object(raw)?;
    let value: Value = serde_json::from_str(&json_text)?;
    Ok(GeminiTutorReply {
        phase: value
            .get("phase")
            .and_then(|v| v.as_str())
            .unwrap_or("understanding")
            .to_string(),
        speak_to_child: value
            .get("speak_to_child")
            .and_then(|v| v.as_str())
            .unwrap_or("¡Hola! Cuéntame qué quieres practicar.")
            .to_string(),
        ask_questions: value
            .get("ask_questions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        topic_summary: value
            .get("topic_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        context_summary: value
            .get("context_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        user_memory_summary: value
            .get("user_memory_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        exercise: value
            .get("exercise")
            .cloned()
            .filter(|v| !v.is_null())
            .and_then(|v| serde_json::from_value(v).ok()),
        draw_ops: value
            .get("draw_ops")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        hints_level: value
            .get("hints_level")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
    })
}

fn gemini_credentials() -> AppResult<(String, String)> {
    let api_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| AppError::msg("Falta GEMINI_API_KEY en el archivo .env"))?;
    if api_key.trim().is_empty() {
        return Err(AppError::msg("Configura GEMINI_API_KEY en el archivo .env"));
    }
    let model =
        std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.6-flash".to_string());
    Ok((api_key, model))
}

async fn request_tutor_reply(
    api_key: &str,
    model: &str,
    task: &Task,
    context: &StudyContext,
    user_message: &str,
    board_description: Option<&str>,
    board_image_base64: Option<&str>,
    user_memory: &str,
    update_user_memory: bool,
) -> AppResult<GeminiTutorReply> {
    let system = tutor_system_prompt();
    let payload = build_user_payload(
        task,
        context,
        user_message,
        board_description,
        user_memory,
        update_user_memory,
    );
    let raw = call_gemini(api_key, model, system, &payload, board_image_base64).await?;

    // Sin segunda llamada de repair: fallback local si el JSON falla
    let mut reply = match parse_tutor_reply(&raw) {
        Ok(parsed) => parsed,
        Err(_) => GeminiTutorReply {
            phase: context.tutor_phase.as_str().to_string(),
            speak_to_child: "¡Uy! Se me trabó un poquito. ¿Me lo cuentas otra vez con tus palabras?".into(),
            ask_questions: vec!["¿Qué parte quieres practicar ahora?".into()],
            topic_summary: context.topic_summary.clone(),
            context_summary: context.context_summary.clone(),
            user_memory_summary: user_memory.to_string(),
            exercise: None,
            draw_ops: Vec::new(),
            hints_level: context.hints_level,
        },
    };

    if reply.speak_to_child.trim().is_empty() {
        reply.speak_to_child =
            "¡Genial! Cuéntame un poquito más y seguimos juntos.".into();
    }
    reply.speak_to_child = truncate_chars(&reply.speak_to_child, MAX_SPEAK);

    if reply.context_summary.trim().is_empty() {
        reply.context_summary = if context.context_summary.trim().is_empty() {
            format!("Estudiando \"{}\".", task.title)
        } else {
            context.context_summary.clone()
        };
    }
    reply.context_summary = truncate_chars(&reply.context_summary, MAX_CONTEXT_SUMMARY);

    if !update_user_memory || reply.user_memory_summary.trim().is_empty() {
        reply.user_memory_summary = if user_memory.trim().is_empty() {
            format!("Estudia \"{}\" ({}).", task.title, task.course_name)
        } else {
            user_memory.to_string()
        };
    }
    reply.user_memory_summary = truncate_chars(&reply.user_memory_summary, MAX_USER_MEMORY);

    Ok(reply)
}

fn compose_assistant_visible(reply: &GeminiTutorReply) -> String {
    let mut assistant_visible = reply.speak_to_child.clone();
    if !reply.ask_questions.is_empty() {
        assistant_visible.push_str("\n\n");
        for (index, question) in reply.ask_questions.iter().enumerate() {
            assistant_visible.push_str(&format!("{}. {}\n", index + 1, question));
        }
    }
    if let Some(exercise) = &reply.exercise {
        assistant_visible.push_str(&format!(
            "\nEjercicio: {}\n{}",
            exercise.title, exercise.instructions
        ));
    }
    assistant_visible
}

async fn apply_reply(
    pool: &sqlx::MySqlPool,
    user_id: u64,
    context: &mut StudyContext,
    reply: &GeminiTutorReply,
    update_user_memory: bool,
) -> AppResult<()> {
    context.tutor_phase = phase_from_str(&reply.phase);
    if !reply.topic_summary.trim().is_empty() {
        context.topic_summary = truncate_chars(&reply.topic_summary, 120);
    }
    context.context_summary = truncate_chars(&reply.context_summary, MAX_CONTEXT_SUMMARY);
    context.hints_level = reply.hints_level;

    let assistant_visible = compose_assistant_visible(reply);
    let saved = insert_message(pool, context.task_id, "assistant", &assistant_visible).await?;
    context.messages.push(saved);
    save_session_meta(pool, context).await?;
    if update_user_memory && !reply.user_memory_summary.trim().is_empty() {
        save_user_memory(
            pool,
            user_id,
            &truncate_chars(&reply.user_memory_summary, MAX_USER_MEMORY),
        )
        .await?;
    }
    Ok(())
}

fn local_greeting(task: &Task, user_memory: &str) -> (String, String, String) {
    let desc = task
        .description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let memory_hint = if user_memory.trim().is_empty() {
        String::new()
    } else {
        " Si ya practicamos algo antes, podemos retomar desde ahí.".to_string()
    };
    let speak = match desc {
        Some(d) => format!(
            "¡Hola! Vi tu tarea \"{}\": {}. Estoy aquí para ayudarte paso a paso.{} ¿Qué parte quieres practicar primero?",
            task.title, truncate_chars(d, 160), memory_hint
        ),
        None => format!(
            "¡Hola! Vi tu tarea \"{}\". Estoy aquí para ayudarte paso a paso.{} ¿Qué quieres practicar hoy?",
            task.title, memory_hint
        ),
    };
    let context_summary = format!("Inicio local. Tarea: \"{}\".", task.title);
    (speak, task.title.clone(), context_summary)
}

#[tauri::command]
pub async fn study_load_session(
    app: AppHandle,
    task_id: u64,
    state: State<'_, AppState>,
) -> AppResult<StudySession> {
    let user = require_user(&state).await?;
    let task = fetch_task(&state.pool, task_id, user.id).await?;
    if task.status.as_str() != "studying" {
        return Err(AppError::msg(
            "Solo puedes abrir el modo estudio en tareas En estudio",
        ));
    }

    let mut context = load_context(&state.pool, task_id).await?;
    let board = load_board(&state.pool, &app, task_id).await?;
    let user_memory = load_user_memory(&state.pool, user.id)
        .await
        .unwrap_or_default();

    // Saludo local: 0 tokens de Gemini al abrir
    if context.messages.is_empty() {
        let (speak, topic, summary) = local_greeting(&task, &user_memory);
        context.topic_summary = topic;
        context.context_summary = summary;
        if let Ok(msg) = insert_message(&state.pool, task_id, "assistant", &speak).await {
            context.messages.push(msg);
        }
        let _ = save_session_meta(&state.pool, &context).await;
    }

    Ok(StudySession {
        context,
        board,
        task,
    })
}

#[tauri::command]
pub async fn study_save_board(
    app: AppHandle,
    task_id: u64,
    board: Value,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _ = app;
    let user = require_user(&state).await?;
    let _task = fetch_task(&state.pool, task_id, user.id).await?;
    save_board_db(&state.pool, task_id, &board).await?;
    Ok(())
}

#[tauri::command]
pub async fn study_chat(
    app: AppHandle,
    task_id: u64,
    user_message: String,
    board_description: Option<String>,
    board_image_base64: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<StudyChatResponse> {
    let _ = app;
    let user = require_user(&state).await?;
    let task = fetch_task(&state.pool, task_id, user.id).await?;
    if task.status.as_str() != "studying" {
        return Err(AppError::msg(
            "Solo puedes chatear en modo estudio con tareas En estudio",
        ));
    }

    let message = user_message.trim().to_string();
    if message.is_empty() {
        return Err(AppError::msg("Escribe un mensaje"));
    }

    let (api_key, model) = gemini_credentials()?;
    let mut context = load_context(&state.pool, task_id).await?;
    let user_memory = load_user_memory(&state.pool, user.id).await?;

    let user_msg = insert_message(&state.pool, task_id, "user", &message).await?;
    context.messages.push(user_msg);

    let user_turns = context
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .count();
    // Actualizar memoria entre tareas cada 3 mensajes del niño
    let update_user_memory = user_turns % 3 == 0;

    let reply = request_tutor_reply(
        &api_key,
        &model,
        &task,
        &context,
        &message,
        board_description.as_deref(),
        board_image_base64.as_deref(),
        &user_memory,
        update_user_memory,
    )
    .await?;
    apply_reply(
        &state.pool,
        user.id,
        &mut context,
        &reply,
        update_user_memory,
    )
    .await?;

    Ok(StudyChatResponse { reply, context })
}
