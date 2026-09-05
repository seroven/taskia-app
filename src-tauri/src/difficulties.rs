use tauri::State;

use crate::error::AppResult;
use crate::models::Difficulty;
use crate::AppState;

#[tauri::command]
pub async fn list_difficulties(state: State<'_, AppState>) -> AppResult<Vec<Difficulty>> {
    let rows = sqlx::query_as::<_, Difficulty>(
        r#"
        SELECT id, code, name, sort_order
        FROM difficulties
        ORDER BY sort_order ASC, id ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(rows)
}
