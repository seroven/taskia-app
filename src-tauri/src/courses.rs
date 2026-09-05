use tauri::State;

use crate::error::AppResult;
use crate::models::Course;
use crate::AppState;

#[tauri::command]
pub async fn list_courses(state: State<'_, AppState>) -> AppResult<Vec<Course>> {
    let rows = sqlx::query_as::<_, Course>(
        r#"
        SELECT id, name
        FROM courses
        WHERE is_active = 1
        ORDER BY name ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(rows)
}
