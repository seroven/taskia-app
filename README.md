# Taskia

App de escritorio para gestionar tareas con apoyo de Gemini.

## Stack

- **Tauri 2** + **React** + **TypeScript** + **Vite**
- MySQL (vía backend Rust / `sqlx`)
- Gemini API

## Requisitos

- Node.js 20+
- Rust (rustup)
- Visual Studio Build Tools (C++ / MSVC) en Windows
- WebView2 (incluido en Windows 10/11 modernos)

## Configuración

1. Copia `.env.example` a `.env` (ya existe `.env` vacío) y completa:

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
GEMINI_API_KEY=
```

Las variables se cargan en el backend de Tauri (`src-tauri`) al iniciar.

## Scripts

```bash
npm run dev            # Solo frontend (Vite)
npm run dev:desktop    # App de escritorio (Tauri)
npm run build          # Build frontend
npm run build:desktop  # Build instalable
node db/migrate.mjs    # Crear/actualizar tablas MySQL
```

## Flujo actual

1. Login / registro (usuario, correo, contraseña → rol `user`)
2. Tablero Kanban con columnas: Pendiente → En proceso → En estudio → Terminado
3. Filtro por fecha de creación (hoy por defecto), fecha de realización y curso
4. Rol `admin` entra a un panel placeholder
