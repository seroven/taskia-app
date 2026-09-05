mod auth;
mod courses;
mod db;
mod difficulties;
mod error;
mod models;
mod tasks;

use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::Manager;

use models::PublicUser;

pub struct AppState {
    pub pool: sqlx::MySqlPool,
    pub session: Arc<Mutex<Option<PublicUser>>>,
}

fn load_env() {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let env_path = manifest_dir.join("../.env");

    if env_path.exists() {
        let _ = dotenvy::from_path(&env_path);
    } else {
        let _ = dotenvy::dotenv();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env();

    tauri::Builder::default()
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::create_pool())
                .expect("No se pudo inicializar la conexión a MySQL");

            app.manage(AppState {
                pool,
                session: Arc::new(Mutex::new(None)),
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::register,
            auth::login,
            auth::logout,
            auth::current_user,
            courses::list_courses,
            difficulties::list_difficulties,
            tasks::list_tasks,
            tasks::create_task,
            tasks::update_task,
            tasks::move_task,
            tasks::reorder_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
