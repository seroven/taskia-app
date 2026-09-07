-- Taskia schema
-- MySQL 8+
--
-- Si tu cliente SQL falla con error 1064 cerca del 2.º CREATE:
-- ejecuta cada bloque por separado (uno por uno), o usa:
--   node db/migrate.mjs
--
-- Nota: `role` va entre backticks porque es palabra reservada en MySQL 8.

CREATE DATABASE IF NOT EXISTS taskia
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE taskia;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Courses (fixed dropdown for tasks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_courses_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Difficulties (Bajo / Medio / Alto)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS difficulties (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_difficulties_code (code),
  UNIQUE KEY uq_difficulties_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tasks (Kanban)
-- status: pending -> in_progress -> studying -> done
-- task_kind: daily (due today) | project (custom due date)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  difficulty_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  task_kind ENUM('daily', 'project') NOT NULL DEFAULT 'daily',
  status ENUM('pending', 'in_progress', 'studying', 'done') NOT NULL DEFAULT 'pending',
  board_order INT NOT NULL DEFAULT 0,
  study_passed TINYINT(1) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tasks_user_id (user_id),
  KEY idx_tasks_course_id (course_id),
  KEY idx_tasks_difficulty_id (difficulty_id),
  KEY idx_tasks_status (status),
  KEY idx_tasks_task_kind (task_kind),
  KEY idx_tasks_due_date (due_date),
  KEY idx_tasks_created_at (created_at),
  KEY idx_tasks_user_status_order (user_id, status, board_order),
  CONSTRAINT fk_tasks_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_course
    FOREIGN KEY (course_id) REFERENCES courses (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_difficulty
    FOREIGN KEY (difficulty_id) REFERENCES difficulties (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Study sessions (rolling context summary for Gemini — not full chat history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_sessions (
  task_id BIGINT UNSIGNED NOT NULL,
  tutor_phase ENUM('understanding', 'practicing', 'reviewing') NOT NULL DEFAULT 'understanding',
  topic_summary TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  hints_level INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id),
  CONSTRAINT fk_study_sessions_task
    FOREIGN KEY (task_id) REFERENCES tasks (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Study chat messages (UI history; Gemini uses context_summary instead)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_study_messages_task_created (task_id, created_at),
  CONSTRAINT fk_study_messages_task
    FOREIGN KEY (task_id) REFERENCES tasks (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Study boards (Excalidraw scene per task)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_boards (
  task_id BIGINT UNSIGNED NOT NULL,
  board_json LONGTEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id),
  CONSTRAINT fk_study_boards_task
    FOREIGN KEY (task_id) REFERENCES tasks (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- User study memory (cross-task tutor memory; rolling summary)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_study_memory (
  user_id BIGINT UNSIGNED NOT NULL,
  memory_summary TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_study_memory_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: courses
-- ---------------------------------------------------------------------------
INSERT INTO courses (name) VALUES
  ('Matemáticas'),
  ('Física'),
  ('Química'),
  ('Programación'),
  ('Bases de datos'),
  ('Inglés'),
  ('Historia'),
  ('Estadística'),
  ('Algoritmos'),
  ('General') AS new_courses
ON DUPLICATE KEY UPDATE name = new_courses.name;

-- ---------------------------------------------------------------------------
-- Seed: difficulties
-- ---------------------------------------------------------------------------
INSERT INTO difficulties (code, name, sort_order) VALUES
  ('low', 'Bajo', 1),
  ('medium', 'Medio', 2),
  ('high', 'Alto', 3) AS new_difficulties
ON DUPLICATE KEY UPDATE
  name = new_difficulties.name,
  sort_order = new_difficulties.sort_order;
