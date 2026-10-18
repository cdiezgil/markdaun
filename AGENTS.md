# MarkDaun — Marco Tecnológico

> Documento vivo del proyecto. Define las decisiones técnicas vinculantes para todos los agentes del pool.
> Actualizado por el Coordinador conforme el humano aprueba cambios de marco.

---

## 1. Qué es MarkDaun

Editor de escritorio **WYSIWYG para ficheros Markdown** (Win + Mac). El usuario ve texto formateado; en disco se almacena Markdown estándar. Sin plugins ni extensibilidad. Tres capacidades nucleares:

| Capacidad | Descripción |
|---|---|
| **Edición visual** | WYSIWYG sobre `.md`. Lo que escribes es lo que ves; el fichero en disco es Markdown limpio. |
| **Grafo de documentos** | Visualización del mapa de vínculos entre ficheros, al estilo Obsidian. |
| **Second Brain** | Integración nativa con un LLM (configurable) para retrieval semántico, síntesis y asistencia sobre el conjunto de notas. |
| **Sync GitHub** | Vinculación con un repositorio GitHub: el usuario configura cuenta + repo, y los ficheros se sincronizan local ↔ remoto. |

---

## 2. Stack tecnológico

### 2.1 App shell — Tauri 2.x

- **Por qué Tauri:** binario nativo ligero (~10 MB frente a ~150 MB de Electron), backend en Rust (rendimiento, seguridad de memoria), frontend web estándar.
- **Targets de compilación:** `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`.
- No se usa Electron. No se usa Capacitor ni ningún otro runtime.

### 2.2 Frontend

| Capa | Decisión |
|---|---|
| Framework UI | **React 18** + **TypeScript** |
| Bundler | **Vite** |
| Estilos | **Tailwind CSS** + **shadcn/ui** (componentes accesibles, sin opinión visual fuerte) |
| State management | **Zustand** (store global ligero; sin Redux) |
| Editor WYSIWYG | **TipTap 2.x** (basado en ProseMirror; convierte el documento interno a/desde Markdown con `tiptap-markdown`) |
| Grafo de ficheros | **React Flow** (renderizado de nodos/aristas; datos calculados en el backend Rust) |
| Router | **React Router v6** (navegación entre vistas: editor, grafo, settings) |

### 2.3 Backend Rust (Tauri commands)

El backend expone comandos Tauri al frontend. Sin servidor externo: todo corre en el proceso nativo.

| Módulo | Crate(s) principal(es) | Responsabilidad |
|---|---|---|
| File I/O | `std::fs`, `walkdir` | Leer/escribir `.md`, listar vault |
| Git sync | **`git2`** (libgit2 bindings) | Clone, fetch, pull, push, status sobre el repo configurado |
| Auth GitHub | **`keyring`** | Almacena el PAT de GitHub en el llavero del SO (Keychain en Mac, Credential Manager en Win) |
| LLM client | **`reqwest`** + **`serde_json`** | Llama a cualquier endpoint OpenAI-compatible (streaming) |
| Embeddings | **`fastembed`** | Genera embeddings locales de los documentos (sin llamada externa) |
| Vector store | **`sqlite-vec`** (extensión SQLite) | Índice semántico persistente en local |
| Config | **`serde`** + SQLite via **`rusqlite`** | Configuración de usuario (repo, endpoint LLM, modelo, etc.) |

### 2.4 Persistencia

```
~/MarkDaun/
├── vault/                  ← ficheros .md del usuario (su "bóveda")
│   └── ...
└── .markdaun/
    ├── config.db           ← SQLite: configuración app + índice de ficheros
    └── vectors.db          ← SQLite+sqlite-vec: embeddings para Second Brain
```

- Los `.md` son el formato fuente de verdad. No hay formato propietario.
- `config.db` y `vectors.db` son locales; no se sincronizan con GitHub (`.gitignore` del repo del usuario).

### 2.5 Sincronización GitHub

- El usuario configura: **URL del repositorio** + **Personal Access Token (PAT)**.
- El PAT se guarda en el llavero del SO vía `keyring`; **nunca en disco en claro**.
- Operaciones expuestas: `clone_repo`, `pull`, `push` (commit automático con mensaje timestamped), `status` (ficheros modificados/sin trackear).
- Implementación: `git2` en Rust, sin dependencia de que el usuario tenga `git` instalado.
- La bóveda local (`vault/`) **es** el working directory del repo clonado.

### 2.6 LLM — Second Brain

- **Conexiones múltiples:** el usuario guarda varias conexiones LLM (`config.db`, tabla `llm_connections`) mediante un asistente que valida de extremo a extremo (alcanzabilidad, credencial, modelos, completion de prueba) y **no persiste nada hasta que todo pasa** (token de validación de un solo uso). Un selector fijo abajo a la derecha elige conexión + modelo activos (`llm_set_active`). Ajustes → *Conexiones de IA* las gestiona.
- **Motores** (`src-tauri/src/llm/engines/`): `OpenAiCompat` (OpenAI, Gemini API, Kimi, z.ai, Azure OpenAI con `api-version`, LiteLLM y proxies corporativos), `AnthropicMessages` (Anthropic API, Anthropic en Azure Foundry) y puentes CLI `claude -p` / `gemini -p` para usar la suscripción del usuario con las CLI oficiales. **No hay OAuth directo con ningún proveedor** (Anthropic lo prohíbe a terceros).
- **Autenticación:** API key en el llavero del SO (servicio `markdaun`, cuenta `llm-connection:<id>`), token Entra ID vía `az account get-access-token` (caché en memoria, refresco con < 5 min de vida) o ninguna. Cabecera de auth configurable (`Authorization: Bearer`, `api-key`, `x-api-key`), cabeceras extra y CA raíz propia para proxies que interceptan TLS.
- **Puente CLI:** binarios resueltos con el shell de login (`zsh -lc 'command -v'` / `where`) porque las apps lanzadas desde el Dock no heredan `PATH`; ejecución en un directorio temporal vacío, un solo turno, sin herramientas, con `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` eliminadas del entorno del hijo y timeout de 120 s.
- **Errores tipados** (`LlmError`: `Unreachable`, `Unauthorized`, `TlsUntrusted`, `ModelNotFound`, `CliMissing`, `CliNotLoggedIn`, `Timeout`, `BadResponse`…) serializados como `{kind, detail}`; el frontend los traduce a mensaje + acción.
- **Retrieval:** al preguntar, se generan embeddings de la query con `fastembed` y se recuperan los fragmentos más relevantes del vault vía `sqlite-vec`. El contexto se inyecta en el prompt (RAG) y `brain_query` lo envía a la conexión activa.
- **Embeddings del vault:** locales (`fastembed`), regenerados de forma incremental al guardar un fichero (background task Rust). Este diseño solo cubre el chat.
- Todos los secretos viven solo en el llavero del SO; el webview ve un secreto una única vez, al pegarlo en el asistente. Sin streaming por ahora.

### 2.7 Canales de captura

Todo lo capturado aterriza en `Entrada/` (ver `docs/superpowers/specs/2026-10-18-capture-channels-design.md`).

- **Office:** `.docx`/`.pptx` se extraen a Markdown con `zip` + `quick-xml` (`capture/office.rs`); la entrada los digiere y el indexador los indexa por su texto.
- **Recortes web:** `capture/clip.rs`. Legibilidad con `dom_smoothie` (MIT, port de Readability.js), HTML→Markdown con `htmd` (Apache-2.0), reescritura de imágenes con `dom_query`. Descartados: `readability` (sin mantenimiento) y `html2md` (GPL).
- **Captura rápida:** ventana `quick-capture` (hash `#quick-capture` del mismo bundle), atajo global con `tauri-plugin-global-shortcut` (configurable, `config.db`), aviso con `tauri-plugin-notification`.
- **Menú de barra:** icono de bandeja (`tray-icon`); cerrar la ventana la oculta y *Salir* pasa por la guarda de cambios sin sincronizar.
- **Digestión por áreas:** el usuario elige el área (carpeta de primer nivel, sin `Entrada/` ni ocultas; `''` = raíz) antes de digerir; el prompt solo ofrece el árbol de esa área y las rutas fuera de ella se reescriben (`adjusted="true"` en el bloque). Última área por bóveda en `config.db` (`last_digest_area:<vault>`). Ver `docs/superpowers/specs/2026-10-18-area-digest-and-voice-notes-design.md`.
- **Notas de voz:** el 🎙 de la captura rápida graba con `MediaRecorder` (mp4/AAC en WKWebView, webm/Opus en WebView2) y guarda `Entrada/Nota de voz <fecha>.<ext>`. `voice/`: decodificación con `symphonia` (+ `symphonia-adapter-libopus` para Opus) y remuestreo propio a 16 kHz mono; transcripción local con `whisper-rs` (whisper.cpp, Metal en macOS; `cmake` necesario para compilar); modelos `large-v3-turbo` q5_0 (por defecto) y `small` q5_1 descargados de Hugging Face `ggerganov/whisper.cpp` al directorio de datos (`whisper/`) con descargador propio (`.part` + rename, redirecciones manuales; sha256 del `X-Linked-Etag` del primer salto, no del `ETag` del CDN). La transcripción corre en segundo plano (un trabajo a la vez), estados en `VoiceJobs`, evento `voice-changed`; el `.md` resultante convive con el audio, que se archiva/descarta junto a la nota. Permiso de micrófono: `src-tauri/Info.plist` (`NSMicrophoneUsageDescription`), `Entitlements.plist` y política de webview (`capture/permissions.rs`: solo `quick-capture`). Ajustes → *Notas de voz* elige modelo.

---

## 3. Testing

**Cobertura obligatoria en todo el código.** Sin excepción: todo módulo nuevo lleva sus tests.

| Capa | Framework | Tipo de tests |
|---|---|---|
| Rust (Tauri backend) | `cargo test` (built-in) | Unit tests por módulo, integration tests de commands Tauri |
| React frontend | **Vitest** + **React Testing Library** | Unit + component tests |
| E2E app completa | **Playwright** (modo Tauri/WebDriver) | Flujos críticos: abrir fichero, editar, guardar, sincronizar |

- **Cobertura mínima:** 80% en líneas para código de producción.
- Los tests de Rust viven en `src-tauri/src/<módulo>/tests.rs` (módulo `#[cfg(test)]`).
- Los tests de React viven junto al componente (`ComponentName.test.tsx`).
- Los tests E2E viven en `e2e/`.
- CI/CD (GitHub Actions): `cargo test` + `vitest run` + `playwright test` en cada PR.

---

## 4. Estructura de carpetas del repo

```
markdaun/
├── src/                    ← Frontend React
│   ├── components/
│   ├── views/              ← Editor, Graph, Settings
│   ├── store/              ← Zustand stores
│   ├── hooks/
│   └── lib/                ← utils, tiptap extensions, api calls a Tauri
├── src-tauri/              ← Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/       ← Tauri commands expuestos al frontend
│   │   ├── fs/             ← file I/O
│   │   ├── git/            ← git2 sync
│   │   ├── llm/            ← LLM client + RAG
│   │   └── db/             ← SQLite, config, vectors
│   └── Cargo.toml
├── design/                 ← Sistema de diseño (fuente de verdad visual)
│   ├── README.md           ← Libro de marca
│   ├── tokens.json         ← Tokens canónicos
│   ├── tokens.css          ← Variables CSS generadas
│   ├── components/         ← Button, Editor, Wikilink (referencia)
│   ├── icons/              ← Iconos de marca (no modificar)
│   └── AGENTS.md           ← Instrucciones de diseño para agentes
├── e2e/                    ← Playwright E2E tests
├── public/
├── vite.config.ts
├── tailwind.config.ts
├── package.json
└── AGENTS.md               ← este fichero
```

---

## 5. Decisiones fuera de alcance (no se implementa)

- Sistema de plugins o extensiones.
- Colaboración en tiempo real (multiplayer).
- Almacenamiento propio en cloud (solo GitHub como backend de sync).
- Mobile (iOS/Android).
- Exportación a PDF/Word u otros formatos (solo `.md`).

---

## 6. Sistema de diseño

Todo el trabajo visual se rige por los ficheros de `design/`. **Son vinculantes**: ningún agente inventa colores, fuentes, radios ni espaciados propios.

### 6.1 Fuente de verdad

| Fichero | Contenido |
|---|---|
| `design/README.md` | Libro de marca: principios, icono, logotipo, color, tipografía, espacio, movimiento, voz. Leer completo antes de cualquier trabajo visual. |
| `design/tokens.json` | Todos los tokens de diseño en JSON (fuente canónica). |
| `design/tokens.css` | Variables CSS generadas desde `tokens.json`. Usar siempre `var(--token)`, nunca valores en crudo. |
| `design/components/` | Muestras de referencia: Button, Editor, Wikilink. Pautas de cada componente en su `README.md`. |
| `design/AGENTS.md` | Instrucciones cortas para agentes. Leer en cada tarea visual. |
| `design/icons/` | Iconos de marca (`app-icon.svg`, `mark.svg`, `app-icon-light.svg`). No modificar. |

### 6.2 Temas

Dos temas, activados por `data-theme="dark"` o `prefers-color-scheme`:
- **Papel** (claro): fondo `#F7F5EF`, base cálida.
- **Humus** (oscuro): fondo `#111816`, humus profundo.

### 6.3 Tokens clave

| Categoría | Tokens principales |
|---|---|
| **Fondos** | `--bg` · `--surface` · `--surface-sunken` |
| **Separadores** | `--line` · `--line-strong` |
| **Texto** | `--ink` · `--ink-muted` |
| **Marca** | `--daun` · `--daun-strong` · `--on-daun` |
| **Acento** | `--sap` · `--on-sap` |
| **Especiales** | `--mark` (resaltado) · `--selection` · `--amber` · `--danger` · `--focus` |
| **Espaciado** | `--space-1` (4px) … `--space-16` (64px) — retícula de 4px |
| **Radios** | `--radius-sm` (6) · `--radius-md` (10) · `--radius-lg` (16) · `--radius-pill` (999px) |
| **Sombra** | `--shadow-pop` — única sombra del sistema, solo para elementos flotantes |
| **Layout** | `--measure` (88ch) · `--sidebar-width` (264px) · `--toolbar-height` (44px) |

### 6.4 Tipografía

| Rol | Familia | Uso |
|---|---|---|
| `display` | Instrument Serif | Títulos grandes, H1 renderizado, logotipo. Nunca < 24px. |
| `sans` | Geist | Toda la interfaz: menús, paneles, botones, cuerpo de lectura. |
| `mono` | Geist Mono | El editor WYSIWYG. Toda la escritura y el código. |

Pesos permitidos: 400, 500 y 600. Carga de fuentes:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">
```

### 6.5 Componentes de referencia

- **Button** — 4 variantes: primario (`daun`/`on-daun`), secundario, fantasma, destructivo. Solo un primario por vista.
- **Editor** — fondo `bg`, sintaxis en `ink-muted`, contenido en `ink`, enlaces en `daun`, selección `selection`, cursor `daun` 2px, máx. `--measure`.
- **Wikilink** — `[[enlace]]` existente en `daun` + subrayado; enlace roto en `amber` + subrayado discontinuo; `#etiqueta` como chip `sap`/`on-sap`; `==resaltado==` con fondo `mark`.

### 6.6 Iconografía de interfaz

Iconos **Lucide**, `stroke-width: 1.5`, cuadrícula 20px, terminaciones redondeadas. Color `ink-muted` en reposo, `daun` cuando activos.

### 6.7 Movimiento

160ms `cubic-bezier(.2,.7,.2,1)` para paneles. 240ms para paleta de comandos. Sin rebotes.

---

## 7. Convenciones para los agentes

- **Rama base del repo:** `main`.
- **Rama de trabajo de agentes:** `agents/<n>-<slug>` (ver `agents/_github.md`).
- Todo código nuevo en TypeScript strict (`"strict": true` en `tsconfig.json`).
- Todo código Rust con `#![deny(warnings)]` activo.
- Ningún `any` en TypeScript sin comentario justificado.
- Commits en inglés, imperativos (`Add`, `Fix`, `Refactor`…).
- Los tests se entregan en el mismo commit que el código de producción. No hay "añadir tests después".
