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

Principio: **ninguna operación de sync borra ni sobrescribe datos de ningún lado sin confirmación explícita.** Sin force push, sin `reset --hard`. (Origen: incidente del 2026-10-18, un push forzado desde una bóveda "vacía" borró 1 101 notas del remoto; ver `docs/superpowers/specs/2026-10-18-safe-git-sync-design.md`.)

- El usuario configura: **URL del repositorio** + **Personal Access Token (PAT)**. El PAT se guarda en el llavero del SO vía `keyring`; **nunca en disco en claro**.
- Implementación: `git2` en Rust (`src-tauri/src/git/sync.rs`), sin depender de que el usuario tenga `git` instalado. La bóveda local (`vault/`) **es** el working directory del repo.
- **Conectar (dos pasos):** `github_connect_preview` hace fetch a un repo temporal (la bóveda no se toca) y clasifica: *remoto vacío* / *local vacío + remoto con notas* / *ambos con notas*. "Contenido local" excluye `.git/`, `.gitignore`, `.markdaun/`, `.DS_Store` y carpetas vacías. `github_connect_apply(choice)` aplica solo lo que el usuario aceptó:
  - remoto vacío: commit local (con padre si hay historial) y push normal, sin diálogo;
  - local vacío: diálogo "¿Descargarlas en esta carpeta?" → `download` (checkout del remoto, conservando `.markdaun/`);
  - ambos con contenido: diálogo "¿Sincronizar?" → `sync` (merge, historias no relacionadas incluidas, con commit de dos padres; luego push normal).
  - Cancelar = no llamar a apply: remoto y carpeta intactos. Si el estado cambió entre preview y apply (`state_changed`), no se toca nada.
- **Sync automático** (`sync_*`; orquestado en Rust por un planificador, inerte hasta que hay repo conectado). Un ciclo = commit local → fetch → merge → push normal (siempre con HEAD como padre y sin `+`; si el remoto se movió, merge y un reintento). Commit: `MarkDaun sync (<dispositivo>) — <rfc3339>`. Un solo candado por ciclo (`github_connect_apply` lo comparte); no hay push/pull manuales. El merge/fast-forward escribe primero el árbol en la bóveda (checkout seguro) y solo después mueve `main`; si el checkout falla, `main` no se mueve. La conexión queda ligada a la bóveda conectada (`github_vault_path` en `config.db`): en otra bóveda el sync está inerte; desconectar o conectar borra la pausa y la lista de conflictos.
  - **Disparadores:** arranque, foco de la ventana, despertar del sistema (salto del reloj), 30 s tras el último cambio (autosave y watcher de la bóveda, con debounce), cada 5 min, "Sincronizar ahora" desde el elemento de estado, y al salir.
  - **Sin conexión:** los commits quedan en local; reintentos con backoff 30 s → 60 s → 120 s → 300 s; estado "Sin conexión". Timeouts libgit2 (~10 s conexión, ~20 s lectura) cuentan como sin conexión. Tras 3 fallos seguidos no-offline (`PushRejected`, `Git`) → "Requiere revisión", pero los reintentos siguen (backoff con tope de 300 s, foco, cambios y manual); solo `Unauthorized` detiene los reintentos (hasta "Sincronizar ahora" o un cambio de configuración) y el clic en el estado abre los ajustes de GitHub.
  - **Conflictos:** se conservan **las dos versiones**: la ruta mantiene el contenido local y el remoto se guarda como `<nombre> (conflicto YYYY-MM-DD HH-mm).<ext>` en la misma carpeta. Edición en un lado y borrado en el otro: se conserva el fichero. Las copias de ciclos desatendidos se **acumulan** (persistidas en `config.db`) hasta `sync_dismiss_conflicts`; mientras haya, estado "Requiere revisión".
  - **Guardia de borrado:** si el árbol a subir quitaría más del 50 % de los ficheros de `origin/main` (y ≥ 10), no se sube. La pausa se persiste (`sync_paused_reason` en `config.db`): el push queda bloqueado pero commit/fetch/merge continúan; el diálogo ("Esta sincronización borraría N de M notas en GitHub. ¿Continuar?") aparece al arrancar y al pulsar el estado; `sync_confirm_deletions { deleted, total }` sube con confirmación solo hasta los borrados que vio el usuario (si ahora hay más, vuelve a pausar y preguntar) y limpia la pausa. Sin recuentos (tras reiniciar) el diálogo lanza primero un ciclo manual y muestra "Comprobando…".
  - **Editor:** antes de cada ciclo, Rust emite `sync-will-start`; el frontend vuelca el guardado pendiente, **retiene los guardados** y responde `sync_hold_ack` (Rust espera ≤ 2 s). Al terminar emite `sync-finished { changedPaths, state, conflicts }`: se liberan los guardados; si la nota abierta cambió en remoto, se recarga en silencio, o, con el buffer sucio, el remoto se guarda como copia de conflicto (`write_conflict_copy`) y el buffer conserva la ruta. Una nota con esa comprobación pendiente nunca se escribe antes de hacerla (guardado, retención, cambio de nota, salida); al vencer la red de seguridad de 60 s la nota abierta se compara con lo último leído/escrito antes de guardarla.
  - **Salir:** volcar guardados; si algo no pudo guardarse, confirmar; luego `sync_before_quit` (commit local + un ciclo acotado por los timeouts, esperando si ya hay uno en marcha; aviso "Sincronizando antes de salir…") y salir. Durante la salida el editor es de solo lectura; los guardados retenidos por un ciclo no se liberan antes de tiempo (espera acotada a 15 s). Si `quit_app` falla, `sync_cancel_quit` suelta el candado y reanuda el sync.
  - **Estados:** Al día · Sincronizando · Pendiente (cambios sin commit o commits por delante de `origin/main`) · Sin conexión · Requiere revisión.
- Operaciones expuestas: `github_connect_preview`, `github_connect_apply`, `github_get_config`, `github_disconnect`, `github_status`, `sync_hold_ack`, `sync_trigger`, `sync_confirm_deletions`, `sync_dismiss_conflicts`, `sync_get_state`, `sync_before_quit`, `sync_cancel_quit`, `write_conflict_copy`.
- Los tests de sync usan repos bare locales (`file://`), sin red.

### 2.6 LLM — Second Brain

- **Conexiones múltiples:** el usuario guarda varias conexiones LLM (`config.db`, tabla `llm_connections`) mediante un asistente que valida de extremo a extremo (alcanzabilidad, credencial, modelos, completion de prueba) y **no persiste nada hasta que todo pasa** (token de validación de un solo uso). Un selector fijo abajo a la derecha elige conexión + modelo activos (`llm_set_active`). Ajustes → *Conexiones de IA* las gestiona.
- **Motores** (`src-tauri/src/llm/engines/`): `OpenAiCompat` (OpenAI, Gemini API, Kimi, z.ai, Azure OpenAI con `api-version`, LiteLLM y proxies corporativos), `AnthropicMessages` (Anthropic API, Anthropic en Azure Foundry) y puentes CLI `claude -p` / `gemini -p` para usar la suscripción del usuario con las CLI oficiales. **No hay OAuth directo con ningún proveedor** (Anthropic lo prohíbe a terceros).
- **Autenticación:** API key en el llavero del SO (servicio `markdaun`, cuenta `llm-connection:<id>`), token Entra ID vía `az account get-access-token` (caché en memoria, refresco con < 5 min de vida) o ninguna. Cabecera de auth configurable (`Authorization: Bearer`, `api-key`, `x-api-key`), cabeceras extra y CA raíz propia para proxies que interceptan TLS.
- **Puente CLI:** binarios resueltos con el shell de login (`zsh -lc 'command -v'` / `where`) porque las apps lanzadas desde el Dock no heredan `PATH`; ejecución en un directorio temporal vacío, un solo turno, sin herramientas, con `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` eliminadas del entorno del hijo y timeout de 120 s.
- **Errores tipados** (`LlmError`: `Unreachable`, `Unauthorized`, `TlsUntrusted`, `ModelNotFound`, `CliMissing`, `CliNotLoggedIn`, `Timeout`, `BadResponse`…) serializados como `{kind, detail}`; el frontend los traduce a mensaje + acción.
- **Retrieval:** al preguntar, se generan embeddings de la query con `fastembed` y se recuperan los fragmentos más relevantes del vault vía `sqlite-vec`. El contexto se inyecta en el prompt (RAG) y `brain_query` lo envía a la conexión activa.
- **Espejo de modelos (fallback):** los modelos descargados (Whisper `large-v3-turbo` y los 5 ficheros de `all-MiniLM-L6-v2-onnx`) se intentan primero en Hugging Face y, ante cualquier fallo (red, no-2xx, vacío, hash incorrecto), en una release pública de GitHub (`https://github.com/cdiezgil/markdaun/releases/download/models-v1/`). Tabla única en `src-tauri/src/models_mirror.rs` (URL base + sha256 por asset; los assets de MiniLM se llaman `all-MiniLM-L6-v2-onnx.<fichero>`). Ambas fuentes se verifican contra el sha256 fijo; si no coincide se borra el `.part` y se devuelve error; si fallan las dos, el error nombra ambas. El modelo `small` de Whisper **no** está en el espejo (solo Hugging Face). Para publicar una release nueva: `gh release create models-vN --repo cdiezgil/markdaun --title "Models vN" --notes "..." <ficheros con los nombres de asset exactos>`, calcular `shasum -a 256` de cada uno, y actualizar `MIRROR_BASE_URL` y `MIRROR_ASSETS` en `models_mirror.rs`. Test real (`#[ignore]`): `cargo test the_real_mirror -- --ignored`.
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
│   ├── README.md           ← Índice del sistema de diseño
│   ├── cdiezgil.md         ← Manual de marca (MarkDaun × cdiezgil)
│   ├── tokens.json         ← Tokens canónicos
│   ├── tokens.css          ← Variables CSS generadas
│   ├── components/         ← Button, Editor, Wikilink, Loader, Seal (referencia)
│   ├── icons/              ← Símbolo, logotipos y sello de marca (no modificar)
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

Todo el trabajo visual se rige por los ficheros de `design/`. **Son vinculantes**: ningún agente inventa colores, fuentes, radios ni espaciados propios. MarkDaun es un subproyecto de la marca personal **cdiezgil** (repositorio `cdiezgil/imagen-marca`) y hereda su identidad: Azul Marino, Oro, Gris Técnico, Geist, retícula de 8pt y texturas de la casa.

### 6.1 Fuente de verdad

| Fichero | Contenido |
|---|---|
| `design/cdiezgil.md` | Manual de marca: arquitectura de marca, principios, color, tipografía, símbolo, logotipo, sello, texturas, forma, movimiento y voz. Leer completo antes de cualquier trabajo visual. |
| `design/README.md` | Índice del sistema y cómo cambiar un token. |
| `design/tokens.json` | Todos los tokens de diseño (fuente canónica). |
| `design/tokens.css` | Variables CSS **generadas** con `npm run tokens`, que también copia el resultado a `public/tokens.css`. No se editan a mano. Usar siempre `var(--token)`, nunca valores en crudo. |
| `design/components/` | Muestras de referencia: Button, Editor, Wikilink, Loader, Seal. Las pautas de cada uno están en su `README.md`. |
| `design/AGENTS.md` | Instrucciones cortas para agentes. Leer en cada tarea visual. |
| `design/icons/` | Símbolo y logotipos de marca, solo en Navy `#0A1122` y Oro `#FFD700` (`app-icon.svg`, `app-icon-light.svg`, `mark.svg`, `tray.svg`, `logo.svg`, `seal.svg`). No modificar sin aprobación del humano. `src-tauri/icons/` se genera desde `app-icon.svg` con `npx tauri icon`. |

### 6.2 Temas

Dos temas, activados por `data-theme="dark"` o `prefers-color-scheme`:
- **Técnico** (claro): fondo `#FFFFFF`, texto Azul Marino `#0A1122`.
- **Marino** (oscuro): fondo `#0A1122`, superficies `#1A2235`.

El usuario lo elige en Ajustes → Apariencia (Sistema / Claro / Oscuro): se guarda en `localStorage` (`markdaun:theme`, `src/lib/theme.ts`) y pone `data-theme` en `<html>`. Todo color sale de Navy, Navy claro, Oro, Gris Técnico, Blanco o mezclas de ellos. Las únicas excepciones, todas por contraste, son el Oro oscurecido `#7A5E00` para texto en claro, el coral oscurecido para errores y avisos, y el esmeralda oscurecido en claro (ver `design/cdiezgil.md` §3.3).

### 6.3 Tokens clave

| Categoría | Tokens principales |
|---|---|
| **Fondos** | `--bg` · `--surface` · `--surface-sunken` |
| **Separadores** | `--line` · `--line-strong` |
| **Texto** | `--ink` · `--ink-muted` |
| **Acento de texto** | `--daun` · `--daun-strong` · `--on-daun`: enlaces, activo, foco. Oro en Marino y Oro profundo `#7A5E00` en Técnico. |
| **Acción principal** | `--gold` · `--gold-strong` · `--on-gold`: botón primario Oro `#FFD700` con texto Azul Marino. Uno por vista. Nunca `--gold` como color de texto. |
| **Tinte de Oro** | `--sap` · `--on-sap` (chips de etiqueta) |
| **Especiales** | `--mark` (resaltado) · `--selection` · `--amber` y `--danger` (coral) · `--success` (esmeralda) · `--focus` · `--navy` · `--logo` (hoja del símbolo: Navy en claro, Oro en oscuro) |
| **Texturas** | `--texture-dots` (grafo, ajustes, vacíos) · `--texture-diagonal` (loaders) · `--texture-metal` (splash, Acerca de) |
| **Espaciado** | `--space-1` (4px) … `--space-16` (64px). Retícula de 8pt; los medios pasos de 4px solo se usan dentro de controles. |
| **Radios** | `--radius-sm` (4) · `--radius-md` (6) · `--radius-lg` (8) · `--radius-pill` (999px). Máximo 8px. |
| **Sombra** | `--shadow-pop`: única sombra del sistema, solo para elementos flotantes. |
| **Movimiento** | `--ease` · `--dur-panel` (160ms) · `--dur-palette` (240ms) |
| **Layout** | `--measure` (88ch) · `--sidebar-width` (264px) · `--toolbar-height` (44px) |

Los nombres `daun` y `sap` vienen de la identidad anterior y se mantienen como nombres de rol.

### 6.4 Tipografía

**Geist** (pesos 300, 400, 500 y 700; nada de 600) y **Geist Mono** para el editor y el código. **Excepción aprobada:** `--font-display` = Instrument Serif 400, solo para títulos de nota (H1 del editor y tarjeta del grafo). El logotipo y las cabeceras de vista van en Geist Bold.

| Peso | Uso |
|---|---|
| Light 300 | Cuerpo de lectura, cifras y tablas (números tabulares) |
| Regular 400 | Interfaz, editor |
| Medium 500 | Etiquetas de controles y pestañas |
| Bold 700 | Títulos, botón primario, logotipo |

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif&display=swap">
```

### 6.5 Componentes de referencia

- **Button**: cuatro variantes (primario `gold`/`on-gold` en Bold, secundario *ghost* con contorno, fantasma y destructivo). Solo un primario por vista; sin sombra.
- **Editor**: fondo `bg`, sintaxis en `ink-muted`, contenido en `ink`, enlaces en `daun`, selección `selection`, cursor `daun` de 2px y ancho máximo `--measure`.
- **Wikilink**:
  - `[[enlace]]` existente en `daun` y subrayado;
  - enlace roto en `amber` y subrayado discontinuo;
  - `#etiqueta` como chip `sap`/`on-sap`;
  - `==resaltado==` con fondo `mark`.
- **Loader**: barra con la textura de líneas diagonales (`.md-loader`).
- **Seal**: `by { cdiezgil }` en la barra de estado (`src/components/Brand/Seal.tsx`). Nunca en la cabecera.

### 6.6 Iconografía de interfaz

Iconos **Lucide** lineales, `stroke-width: 1.5`, cuadrícula de 20px. Color `ink-muted` en reposo y `daun` cuando están activos. Nunca iconos rellenos.

### 6.7 Movimiento

160ms con `cubic-bezier(.2,.7,.2,1)` para paneles y 240ms para la paleta de comandos. Sin rebotes.

---

## 7. Convenciones para los agentes

- **Rama base del repo:** `main`.
- **Rama de trabajo de agentes:** `agents/<n>-<slug>` (ver `agents/_github.md`).
- Todo código nuevo en TypeScript strict (`"strict": true` en `tsconfig.json`).
- Todo código Rust con `#![deny(warnings)]` activo.
- Ningún `any` en TypeScript sin comentario justificado.
- Commits en inglés, imperativos (`Add`, `Fix`, `Refactor`…).
- Los tests se entregan en el mismo commit que el código de producción. No hay "añadir tests después".
