# Taskia — Gestión actual de llamadas a Gemini (para estimar costos)

Documento basado en el backend actual (`src-tauri/src/study.rs`) y el frontend de estudio.

---

## 1. Resumen ejecutivo

| Pregunta | Respuesta corta |
|---|---|
| ¿Se manda el chat completo? | **No** |
| ¿Cuántas llamadas Gemini por mensaje del niño? | **1** (`study_chat`) |
| ¿Hay llamada al abrir una tarea? | **No** (saludo **local**, 0 tokens) |
| ¿Qué crece con el tiempo? | Solo los **resúmenes** (con tope duro de caracteres) |
| ¿Qué más encarece? | **Imagen de pizarra** (toggle “Enviar pizarra”), **draw_ops** si “IA dibuja” está ON, y **thinking** en Gemini 3.x |

---

## 2. Cuándo se llama a la API

### 2.1 Abrir modo estudio (`study_load_session`)
- Carga tarea (MySQL), `study_sessions`, mensajes, pizarra.
- Si no hay mensajes: genera **saludo local** (plantilla con título/descripción).
- **No llama a Gemini.**

### 2.2 Enviar mensaje (`study_chat`)
- **Siempre 1** `generateContent` por envío exitoso.
- **No** hay reintento automático de “repair JSON” (si falla el formato → error en UI; no segunda llamada).

### 2.3 Guardar pizarra (`study_save_board`)
- Solo MySQL. **Sin Gemini.**

---

## 3. Endpoint y configuración

```
POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}
```

| Campo | Valor actual |
|---|---|
| Modelo | `GEMINI_MODEL` (default código: `gemini-2.0-flash`) |
| `responseMimeType` | `application/json` |
| `maxOutputTokens` | `4096` (tope; la respuesta útil suele ser mucho menor) |
| Gemini 3.x | `thinkingConfig.thinkingLevel = "low"` |
| Gemini 2.5 | `thinkingBudget = 0` (+ `temperature: 0.6`) |
| Otros | `temperature: 0.6` |

---

## 4. Estructura de cada request

Cada llamada tiene:

1. **`systemInstruction`** — prompt fijo del tutor  
2. **`contents[0].parts`** — payload de usuario (JSON en texto) + opcionalmente imagen PNG  

### 4.1 System prompt (fijo, ~mismo tamaño siempre)

Texto corto (~550–750 caracteres). Incluye:
- rol: tutor niño ~10 años, español, breve  
- no dar solución completa  
- usa `context_summary` + `user_memory_summary` (no historial)  
- pizarra opcional  
- contrato JSON de salida  

**Estimación tokens (input):** ~**150–250 tokens** por turno.

No crece con el tiempo.

---

### 4.2 Payload de usuario (texto JSON)

Se construye en `build_user_payload`. **No incluye** `study_messages` ni el board Excalidraw completo.

| Campo | Origen | Tope (chars) | ¿Crece? |
|---|---|---|---|
| `instruction` | fijo corto | ~120 | No |
| `update_user_memory` | bool | — | No (true cada 3º msg del niño) |
| `task.title` | MySQL | 120 | No (salvo editen la tarea) |
| `task.description` | MySQL | 220 | No |
| `task.course` / `difficulty` | MySQL | corto | No |
| `phase` | sesión | enum | Estable |
| `topic_summary` | sesión | 120 | Poco; topado |
| `context_summary` | sesión (esta tarea) | **400** | Sí, hasta el tope |
| `user_memory_summary` | perfil usuario | **600** | Sí, hasta el tope |
| `hints_level` | int | — | No relevante |
| `board_has_drawing` | bool | — | Solo si toggle ON |
| `board_drawing` | descripción elementos | **500** | Solo si toggle ON |
| `child_message` | mensaje actual | **800** | Por turno |

**Tamaño texto user payload:**

| Escenario | Chars aprox. | Tokens input aprox. |
|---|---|---|
| Turno típico (sin pizarra, resúmenes medios) | 800–1 500 | **250–450** |
| Turno “lleno” (todos los topes, sin imagen) | ~2 500–3 200 | **700–1 000** |
| + descripción pizarra (sin imagen) | +hasta 500 | **+150** |

Tras ~pocos turnos, `context_summary` y `user_memory` suelen **estabilizarse en el tope**; el input **no escala con N mensajes**.

---

### 4.3 Pizarra (opcional)

Solo si el toggle **“Enviar pizarra”** está ON **y** hay elementos:

1. **Texto** `board_drawing`: lista de hasta 40 elementos (tipo, coords, texto). Tope 500 chars al mandar.  
2. **Imagen** PNG export Excalidraw (`maxWidthOrHeight: 640`), como `inline_data` (`image/png` base64).  
3. Frase fija: *“Imagen de la pizarra del niño…”*

Tras enviar con pizarra, el toggle se **apaga solo**.

**Estimación tokens imagen (640px):** muy variable; para costeo usá un rango conservador **~500–2 000 tokens/imagen** (depende del cobro por imagen de Gemini). Es el factor que más puede subir el costo por turno.

---

## 5. Qué se pide en la respuesta (output)

JSON esperado:

```json
{
  "phase": "understanding|practicing|reviewing",
  "speak_to_child": "...",
  "ask_questions": [],
  "topic_summary": "...",
  "context_summary": "...",
  "user_memory_summary": "...",
  "exercise": null,
  "draw_ops": [],
  "hints_level": 0
}
```

| Campo | Tope / nota | Tokens output típicos |
|---|---|---|
| `speak_to_child` | se trunca a **450** chars al guardar | 80–150 |
| `ask_questions` | 0–2 cortas | 20–60 |
| `topic_summary` | corto | 10–30 |
| `context_summary` | ≤400 chars | 50–120 |
| `user_memory_summary` | ≤600; a veces solo “repetir” | 0–150 |
| `exercise` | a menudo `null` | 0–80 |
| `draw_ops` | suele `[]` | 0–100 |

**Output típico útil:** ~**250–600 tokens**.  
**Output “pesado”** (ejercicio + draw_ops): ~**600–1 200 tokens**.  
`maxOutputTokens: 4096` es techo, no el promedio.

### Thinking (extra facturable en algunos modelos)
- **Gemini 3.x** con `thinkingLevel: low`: suma tokens de pensamiento (pueden ser cientos extra).  
- **2.5** con `thinkingBudget: 0`: intenta desactivar thinking.  
- **2.0-flash**: sin thinking típico → más predecible para costeo.

---

## 6. Memoria entre tareas (crecimiento)

| Dato | Persistencia | Enviado a Gemini | Crecimiento |
|---|---|---|---|
| Chat (`study_messages`) | MySQL (UI) | **No** | Ilimitado en DB; **0 impacto** en API |
| `context_summary` | `study_sessions` | Sí, ≤400 | Crece hasta tope y se reescribe |
| `user_memory_summary` | `user_study_memory` | Sí, ≤600 | Se **actualiza solo cada 3 mensajes** del niño |
| Pizarra | `study_boards` | Solo si toggle | No crece el prompt salvo envío puntual |

**Conclusión para costeo:** el costo por turno es **casi constante** (plateau), no lineal con “horas de chat”.

---

## 7. Fórmula sugerida para la otra app

### Por turno (sin pizarra)

```
input_tokens  ≈ 200 (system) + 350 (payload típico)  ≈ 550
output_tokens ≈ 400
thinking      ≈ 0 (flash 2.0)  o  200–800 (gemini-3 low, variable)
```

### Por turno (con pizarra)

```
input_tokens  ≈ 550 + 150 (desc) + 500–2000 (imagen)
output_tokens ≈ 400–700
```

### Mensual (ejemplo de uso)

```
turnos_mes = mensajes_dia * dias_activos
fraccion_con_pizarra = 0.1   # 10% de los envíos

costo ≈ turnos_mes * (
  (1 - f) * costo_turno_texto
  + f * costo_turno_con_imagen
)
```

### Escenarios orientativos (1 niño)

| Uso | Msgs/día | % con pizarra | Orden de magnitud (Flash barato) |
|---|---|---|---|
| Suave | 20 | 5% | Fracciones de $1–2 / mes |
| Medio | 50 | 10% | ~$1–4 / mes (orden) |
| Intenso | 100 | 20% | Aún suele caber en **$10/mes** si es Flash |

> Los precios exactos cambian; la otra app debe multiplicar tokens × tarifa vigente del modelo. Lo estable es la **estructura de tokens** de arriba.

---

## 8. Checklist para el estimador externo

Inputs a modelar:

1. `model` (flash vs 3.x thinking)  
2. `calls_per_day`  
3. `pct_with_board_image` (0–1)  
4. `avg_input_tokens_text` ≈ **500–800** (usar 650 default)  
5. `avg_output_tokens` ≈ **350–500** (usar 400 default)  
6. `avg_image_tokens` ≈ **1000** (default conservador)  
7. `thinking_tokens_per_call` ≈ `0` (2.0-flash) o `300` (3.x low)  

**No modelar:** longitud del historial de chat (no se envía).

---

## 9. Diagrama de flujo de costo

```
Abrir tarea ──► saludo local ──► $0

Niño envía mensaje
  ├─ toggle “Enviar pizarra” OFF ──► 1× generateContent (texto) ──► $ bajo ~constante
  ├─ toggle “Enviar pizarra” ON ───► 1× generateContent (texto + PNG) ──► $ más alto
  │     └─ toggle se apaga
  └─ toggle “IA dibuja” ON ────────► misma 1× call; output puede incluir draw_ops (+tokens salida)
        └─ toggle se mantiene (permiso sticky)

Cada 3er mensaje del niño: pide actualizar user_memory (mismo request; no +1 call)
```

---

## 10. Notas / riesgos que inflan el costo real

1. Reintentos manuales del usuario si hay error de cuota/formato.  
2. Modelo con thinking alto (evitar para free/barato).  
3. Abusar del toggle de pizarra.  
4. `draw_ops` largos en la respuesta (poco frecuente).  
5. Free tier: límites diarios distintos al pay-as-you-go.

---

## 11. Referencias de código

- Prompt + payload + llamada: `src-tauri/src/study.rs`
- Toggle pizarra / adjunto: `src/pages/StudyPage.tsx`, `src/components/study/StudyChat.tsx`, `src/components/study/ExcalidrawBoard.tsx`
- Topes: `MAX_CONTEXT_SUMMARY=400`, `MAX_USER_MEMORY=600`, `MAX_BOARD_DESCRIPTION=500`, `MAX_SPEAK=450`
