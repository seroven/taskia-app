use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use std::env;
use std::time::Duration;

use crate::error::{AppError, AppResult};

pub async fn create_pool() -> AppResult<MySqlPool> {
    let host = env::var("MYSQL_HOST").unwrap_or_else(|_| "localhost".into());
    let port = env::var("MYSQL_PORT").unwrap_or_else(|_| "3306".into());
    let user = env::var("MYSQL_USER").map_err(|_| AppError::msg("MYSQL_USER no configurado"))?;
    let password = env::var("MYSQL_PASSWORD").unwrap_or_default();
    let database =
        env::var("MYSQL_DATABASE").map_err(|_| AppError::msg("MYSQL_DATABASE no configurado"))?;

    let url = format!("mysql://{user}:{password}@{host}:{port}/{database}");

    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&url)
        .await
        .map_err(|err| AppError::msg(format!("No se pudo conectar a MySQL: {err}")))?;

    Ok(pool)
}
