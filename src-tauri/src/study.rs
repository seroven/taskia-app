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
pub struct StudyEval {
    pub passed: bool,
    pub evidence: String,
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
    pub study_eval: StudyEval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyChatResponse {
    pub reply: GeminiTutorReply,
    pub context: StudyContext,
    pub study_passed: bool,
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
const MAX_LAST_TUTOR: usize = 320;

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

fn tutor_system_prompt(allow_ai_draw: bool) -> String {
    let mut prompt = String::from(
        r##"Tutor amable para niño ~10 años. Español latinoamericano, claro y breve.
No des la solución completa: guía con preguntas/pistas. Prioriza la tarea actual.
Recibes context_summary (esta tarea), last_tutor_message (tu burbuja anterior) y user_memory_summary. No el chat entero.
Mantén coherencia con el ejercicio abierto: si last_tutor_message o context_summary citan un número/ejercicio, NO preguntes de qué número hablan.
Pizarra de entrada: si board_has_drawing=false, ignora lo que haya dibujado el niño.
Responde SOLO JSON (sin markdown):
{"phase":"understanding|practicing|reviewing","speak_to_child":"...","ask_questions":[],"topic_summary":"...","context_summary":"...","user_memory_summary":"...","exercise":null,"draw_ops":[],"hints_level":0,"study_eval":{"passed":false,"evidence":""}}
context_summary ≤ 400 chars. Debe incluir SIEMPRE, si hay ejercicio abierto: "Ejercicio activo: …" con el número/datos exactos; no lo borres hasta resolverlo o cambiarlo. Resume aciertos del niño.
user_memory_summary ≤ 600 chars (si update_user_memory=false, repite el recibido).
exercise: usa el objeto cuando planteas un ejercicio nuevo (también en reviewing); si sigues el mismo, puedes dejar null pero conserva "Ejercicio activo" en context_summary.
Dominio (study_eval): passed=true SOLO si TODOS se cumplen:
1) phase=reviewing
2) ≥2 aciertos reales del niño en ejercicios/variaciones (no solo “ok”)
3) al menos una variación distinta al ejemplo inicial
4) no regalaste la solución completa en esos turnos
5) el niño explicó en corto el procedimiento O aplicó el concepto con números nuevos
6) user_turns ≥ 3 (si user_turns<3 → passed=false)
Si study_passed_already=true → study_eval.passed=true y evidence corta "ya aprobado".
Si duda → passed=false. Si passed=true, celebra en speak_to_child y di que puede mover la tarea a Terminado.
"##,
    );

    if !allow_ai_draw {
        prompt.push_str("draw_ops siempre []. No dibujes en la pizarra.");
        return prompt;
    }

    prompt.push_str(
        r##"Pizarra de salida: allow_ai_draw=true. Si el niño pide ejercicio nuevo, practica, o conviene visualizar:
1) Empieza con {"op":"clear_board"} (la app borra toda la pizarra y centra tu dibujo grande).
2) Dibuja con 3–8 ops. Preferí stamps con scale≈2; luego shape/text con labels.
3) No dejes números/figuras solo en speak_to_child: deben ir en draw_ops.
4) Coordenadas relativas libres (la app re-centra). Labels claros (base, altura, lados).
Stamps: right_triangle, circle, square, number_line, arrow.
Shapes: rectangle|ellipse|triangle|line|arrow|text (x,y,w,h,label?,color?).
Ejemplo (triángulo base 8 altura 4):
[{"op":"clear_board"},{"op":"stamp","id":"right_triangle","x":0,"y":0,"scale":2},{"op":"shape","type":"text","x":110,"y":175,"label":"8"},{"op":"shape","type":"text","x":-30,"y":70,"label":"4"}]
"##,
    );
    prompt
}

fn last_tutor_message(context: &StudyContext) -> String {
    context
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "assistant")
        .map(|m| truncate_chars(&m.content, MAX_LAST_TUTOR))
        .unwrap_or_default()
}

fn extract_active_exercise_line(summary: &str) -> Option<String> {
    for line in summary.lines() {
        let trimmed = line.trim();
        if trimmed.to_lowercase().starts_with("ejercicio activo:") {
            return Some(truncate_chars(trimmed, 180));
        }
    }
    None
}

fn ensure_active_exercise_in_context(
    summary: &str,
    exercise: &Option<StudyExercise>,
    previous_summary: &str,
) -> String {
    let mut base = summary.trim().to_string();
    if let Some(ex) = exercise {
        let line = format!(
            "Ejercicio activo: {} — {}",
            truncate_chars(&ex.title, 60),
            truncate_chars(&ex.instructions, 140)
        );
        if let Some(old) = extract_active_exercise_line(&base) {
            base = base.replacen(&old, &line, 1);
        } else {
            base = if base.is_empty() {
                line
            } else {
                format!("{line}\n{base}")
            };
        }
    } else if extract_active_exercise_line(&base).is_none() {
        if let Some(prev) = extract_active_exercise_line(previous_summary) {
            base = if base.is_empty() {
                prev
            } else {
                format!("{prev}\n{base}")
            };
        }
    }
    truncate_chars(&base, MAX_CONTEXT_SUMMARY)
}

fn build_user_payload(
    task: &Task,
    context: &StudyContext,
    user_message: &str,
    board_description: Option<&str>,
    user_memory: &str,
    update_user_memory: bool,
    allow_ai_draw: bool,
    user_turns: usize,
) -> String {
    let description = truncate_chars(
        task.description.as_deref().unwrap_or(""),
        220,
    );
    let board_has_content = board_description
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    // Instrucciones cortas: el detalle de draw_ops solo vive en el system prompt si allow_ai_draw.
    let instruction = match (allow_ai_draw, board_has_content) {
        (true, true) => {
            "Responde breve. Usa context + last_tutor_message + mensaje + pizarra. Conserva el ejercicio activo. Evalúa study_eval."
        }
        (true, false) => {
            "Responde breve. Usa context + last_tutor_message + mensaje. Conserva el ejercicio activo. Evalúa study_eval."
        }
        (false, true) => {
            "Responde breve. Usa context + last_tutor_message + mensaje + pizarra. Conserva el ejercicio activo. Evalúa study_eval."
        }
        (false, false) => {
            "Responde breve. Usa context + last_tutor_message + mensaje. Conserva el ejercicio activo. Ignora pizarra. Evalúa study_eval."
        }
    };

    let last_tutor = last_tutor_message(context);

    let mut payload = json!({
      "instruction": instruction,
      "update_user_memory": update_user_memory,
      "user_turns": user_turns,
      "study_passed_already": task.study_passed,
      "task": {
        "title": truncate_chars(&task.title, 120),
        "description": description,
        "course": task.course_name,
        "difficulty": task.difficulty_name,
        "difficulty_code": task.difficulty_code
      },
      "phase": context.tutor_phase,
      "topic_summary": truncate_chars(&context.topic_summary, 120),
      "context_summary": truncate_chars(&context.context_summary, MAX_CONTEXT_SUMMARY),
      "last_tutor_message": last_tutor,
      "user_memory_summary": truncate_chars(user_memory, MAX_USER_MEMORY),
      "hints_level": context.hints_level,
      "board_has_drawing": board_has_content,
      "child_message": truncate_chars(user_message, 800)
    });

    // Solo incluimos campos de dibujo/entrada de pizarra cuando aportan.
    if allow_ai_draw {
        payload
            .as_object_mut()
            .expect("payload object")
            .insert("allow_ai_draw".into(), json!(true));
    }
    if board_has_content {
        let obj = payload.as_object_mut().expect("payload object");
        obj.insert(
            "board_drawing".into(),
            json!(truncate_chars(
                board_description.unwrap_or(""),
                MAX_BOARD_DESCRIPTION
            )),
        );
    }

    payload.to_string()
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

    // Gemini 3.x gasta tokens en "thinking"; con max bajo la respuesta JSON sale vacía/cortada.
    let mut generation_config = json!({
      "maxOutputTokens": 4096,
      "responseMimeType": "application/json"
    });
    if model.contains("gemini-3") {
      generation_config["thinkingConfig"] = json!({ "thinkingLevel": "low" });
    } else if model.contains("gemini-2.5") {
      generation_config["thinkingConfig"] = json!({ "thinkingBudget": 0 });
      generation_config["temperature"] = json!(0.6);
    } else {
      generation_config["temperature"] = json!(0.6);
    }

    let body = json!({
      "systemInstruction": {
        "parts": [{ "text": system }]
      },
      "contents": [{
        "role": "user",
        "parts": parts
      }],
      "generationConfig": generation_config
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

    let block = payload
        .pointer("/promptFeedback/blockReason")
        .and_then(|v| v.as_str());
    if let Some(reason) = block {
        return Err(AppError::msg(format!(
            "Gemini bloqueó la solicitud ({reason})"
        )));
    }

    extract_candidate_text(&payload)
}

fn extract_candidate_text(payload: &Value) -> AppResult<String> {
    let finish = payload
        .pointer("/candidates/0/finishReason")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let parts = payload
        .pointer("/candidates/0/content/parts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            if finish == "MAX_TOKENS" {
                AppError::msg(
                    "Gemini se quedó sin tokens de salida (suele pasar por el modo thinking). Probá de nuevo o usá un modelo flash sin thinking alto.",
                )
            } else if finish.is_empty() {
                AppError::msg("Respuesta vacía de Gemini")
            } else {
                AppError::msg(format!("Respuesta vacía de Gemini ({finish})"))
            }
        })?;

    let mut texts = Vec::new();
    for part in parts {
        // En modelos con thinking, parts[0] puede ser thought sin texto útil
        if part.get("thought").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                texts.push(trimmed.to_string());
            }
        }
    }

    let joined = texts.join("\n").trim().to_string();
    if joined.is_empty() {
        if finish == "MAX_TOKENS" {
            return Err(AppError::msg(
                "Gemini gastó los tokens pensando y no alcanzó a responder. Reintentá; si sigue, bajá el thinking del modelo.",
            ));
        }
        return Err(AppError::msg(
            "Gemini no devolvió texto útil. Revisá GEMINI_MODEL / cuota de la API.",
        ));
    }

    Ok(joined)
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
        study_eval: {
            let eval = value.get("study_eval");
            StudyEval {
                passed: eval
                    .and_then(|v| v.get("passed"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                evidence: eval
                    .and_then(|v| v.get("evidence"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            }
        },
    })
}

fn gemini_credentials() -> AppResult<(String, String)> {
    let api_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| AppError::msg("Falta GEMINI_API_KEY en el archivo .env"))?;
    let api_key = api_key.trim().trim_matches('"').trim_matches('\'').to_string();
    if api_key.is_empty() {
        return Err(AppError::msg("Configura GEMINI_API_KEY en el archivo .env"));
    }
    let model = std::env::var("GEMINI_MODEL")
        .unwrap_or_else(|_| "gemini-2.0-flash".to_string());
    let model = model.trim().trim_matches('"').trim_matches('\'').to_string();
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
    allow_ai_draw: bool,
    user_turns: usize,
) -> AppResult<GeminiTutorReply> {
    let system = tutor_system_prompt(allow_ai_draw);
    let payload = build_user_payload(
        task,
        context,
        user_message,
        board_description,
        user_memory,
        update_user_memory,
        allow_ai_draw,
        user_turns,
    );
    let raw = call_gemini(api_key, model, &system, &payload, board_image_base64).await?;

    let mut reply = parse_tutor_reply(&raw).map_err(|_| {
        AppError::msg(
            "La IA respondió, pero no en el formato esperado. Probá enviar de nuevo (no gastamos un segundo intento automático para cuidar tokens).",
        )
    })?;

    if !allow_ai_draw {
        reply.draw_ops = Vec::new();
    }

    // Red de seguridad: no aprobar demasiado pronto aunque Gemini diga passed.
    if user_turns < 3 || task.study_passed {
        if task.study_passed {
            reply.study_eval.passed = true;
            if reply.study_eval.evidence.trim().is_empty() {
                reply.study_eval.evidence = "ya aprobado".into();
            }
        } else {
            reply.study_eval.passed = false;
        }
    }

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
    reply.context_summary = ensure_active_exercise_in_context(
        &reply.context_summary,
        &reply.exercise,
        &context.context_summary,
    );

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

async fn mark_study_passed(pool: &sqlx::MySqlPool, task_id: u64, user_id: u64) -> AppResult<()> {
    sqlx::query(
        r#"
        UPDATE tasks
        SET study_passed = 1
        WHERE id = ? AND user_id = ?
        "#,
    )
    .bind(task_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
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
    if reply.study_eval.passed {
        mark_study_passed(pool, context.task_id, user_id).await?;
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
    allow_ai_draw: Option<bool>,
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

    let allow_ai_draw = allow_ai_draw.unwrap_or(false);
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
        allow_ai_draw,
        user_turns,
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

    let study_passed = task.study_passed || reply.study_eval.passed;
    Ok(StudyChatResponse {
        reply,
        context,
        study_passed,
    })
}
