use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    User,
    Admin,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "admin" => Self::Admin,
            _ => Self::User,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Studying,
    Done,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Studying => "studying",
            Self::Done => "done",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(Self::Pending),
            "in_progress" => Ok(Self::InProgress),
            "studying" => Ok(Self::Studying),
            "done" => Ok(Self::Done),
            other => Err(format!("Estado inválido: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Daily,
    Project,
}

impl TaskKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Project => "project",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "daily" => Ok(Self::Daily),
            "project" => Ok(Self::Project),
            other => Err(format!("Tipo de tarea inválido: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicUser {
    pub id: u64,
    pub username: String,
    pub email: String,
    pub role: UserRole,
}

#[derive(Debug, FromRow)]
pub struct UserRow {
    pub id: u64,
    pub username: String,
    pub email: String,
    pub password_hash: String,
    pub role: String,
}

impl UserRow {
    pub fn into_public(self) -> PublicUser {
        PublicUser {
            id: self.id,
            username: self.username,
            email: self.email,
            role: UserRole::from_db(&self.role),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Course {
    pub id: u64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Difficulty {
    pub id: u64,
    pub code: String,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: u64,
    pub user_id: u64,
    pub course_id: u64,
    pub course_name: String,
    pub difficulty_id: u64,
    pub difficulty_code: String,
    pub difficulty_name: String,
    pub title: String,
    pub description: Option<String>,
    pub task_kind: TaskKind,
    pub status: TaskStatus,
    pub board_order: i32,
    pub study_passed: bool,
    pub due_date: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
pub struct TaskRow {
    pub id: u64,
    pub user_id: u64,
    pub course_id: u64,
    pub course_name: String,
    pub difficulty_id: u64,
    pub difficulty_code: String,
    pub difficulty_name: String,
    pub title: String,
    pub description: Option<String>,
    pub task_kind: String,
    pub status: String,
    pub board_order: i32,
    pub study_passed: i8,
    pub due_date: chrono::NaiveDate,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

impl TaskRow {
    pub fn into_task(self) -> Result<Task, String> {
        Ok(Task {
            id: self.id,
            user_id: self.user_id,
            course_id: self.course_id,
            course_name: self.course_name,
            difficulty_id: self.difficulty_id,
            difficulty_code: self.difficulty_code,
            difficulty_name: self.difficulty_name,
            title: self.title,
            description: self.description,
            task_kind: TaskKind::from_db(&self.task_kind)?,
            status: TaskStatus::from_db(&self.status)?,
            board_order: self.board_order,
            study_passed: self.study_passed != 0,
            due_date: self.due_date.to_string(),
            created_at: format_utc_naive_as_local(self.created_at),
            updated_at: format_utc_naive_as_local(self.updated_at),
        })
    }
}

fn format_utc_naive_as_local(value: chrono::NaiveDateTime) -> String {
    use chrono::{Local, TimeZone, Utc};
    Utc.from_utc_datetime(&value)
        .with_timezone(&Local)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}
