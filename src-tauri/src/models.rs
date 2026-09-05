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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: u64,
    pub user_id: u64,
    pub course_id: u64,
    pub course_name: String,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub board_order: i32,
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
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub board_order: i32,
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
            title: self.title,
            description: self.description,
            status: TaskStatus::from_db(&self.status)?,
            board_order: self.board_order,
            due_date: self.due_date.to_string(),
            created_at: self.created_at.format("%Y-%m-%d %H:%M:%S").to_string(),
            updated_at: self.updated_at.format("%Y-%m-%d %H:%M:%S").to_string(),
        })
    }
}
