use serde::Deserialize;
use sqlx::MySqlPool;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{PublicUser, UserRow, UserRole};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterPayload {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
}

fn validate_credentials(username: &str, email: Option<&str>, password: &str) -> AppResult<()> {
    let username = username.trim();
    if username.len() < 3 {
        return Err(AppError::msg("El usuario debe tener al menos 3 caracteres"));
    }
    if password.len() < 6 {
        return Err(AppError::msg("La contraseña debe tener al menos 6 caracteres"));
    }
    if let Some(email) = email {
        let email = email.trim();
        if !email.contains('@') || email.len() < 5 {
            return Err(AppError::msg("Correo inválido"));
        }
    }
    Ok(())
}

async fn find_user_by_username(pool: &MySqlPool, username: &str) -> AppResult<Option<UserRow>> {
    let row = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, username, email, password_hash, role
        FROM users
        WHERE username = ?
        LIMIT 1
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

#[tauri::command]
pub async fn register(
    payload: RegisterPayload,
    state: State<'_, AppState>,
) -> AppResult<PublicUser> {
    validate_credentials(&payload.username, Some(&payload.email), &payload.password)?;

    let username = payload.username.trim().to_string();
    let email = payload.email.trim().to_lowercase();

    if find_user_by_username(&state.pool, &username).await?.is_some() {
        return Err(AppError::msg("Ese nombre de usuario ya existe"));
    }

    let existing_email = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = ?",
    )
    .bind(&email)
    .fetch_one(&state.pool)
    .await?;

    if existing_email > 0 {
        return Err(AppError::msg("Ese correo ya está registrado"));
    }

    let password_hash = bcrypt::hash(payload.password, bcrypt::DEFAULT_COST)?;

    let result = sqlx::query(
        r#"
        INSERT INTO users (username, email, password_hash, role)
        VALUES (?, ?, ?, 'user')
        "#,
    )
    .bind(&username)
    .bind(&email)
    .bind(&password_hash)
    .execute(&state.pool)
    .await?;

    let user = PublicUser {
        id: result.last_insert_id(),
        username,
        email,
        role: UserRole::User,
    };

    *state.session.lock().await = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub async fn login(payload: LoginPayload, state: State<'_, AppState>) -> AppResult<PublicUser> {
    validate_credentials(&payload.username, None, &payload.password)?;

    let username = payload.username.trim();
    let row = find_user_by_username(&state.pool, username)
        .await?
        .ok_or_else(|| AppError::msg("Usuario o contraseña incorrectos"))?;

    let valid = bcrypt::verify(payload.password, &row.password_hash)?;
    if !valid {
        return Err(AppError::msg("Usuario o contraseña incorrectos"));
    }

    let user = row.into_public();
    *state.session.lock().await = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> AppResult<()> {
    *state.session.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn current_user(state: State<'_, AppState>) -> AppResult<Option<PublicUser>> {
    Ok(state.session.lock().await.clone())
}

pub async fn require_user(state: &State<'_, AppState>) -> AppResult<PublicUser> {
    state
        .session
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::msg("Debes iniciar sesión"))
}
