# MarkDaun Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-and-dictate PWA for the user's MarkDaun vault (search, read with images and Mermaid, voice notes uploaded to `Entrada/`), plus desktop auto-transcription of audio that arrives by sync.

**Architecture:** A standalone Vite + React app in `mobile/`, talking to GitHub REST/GraphQL from the browser with the user's fine-grained PAT, storing notes, images and the upload queue in IndexedDB. Hosted on GitHub Pages at `/markdaun/`. The desktop gains one hook after each sync cycle (and once at startup) that enqueues transcription of new audio in `Entrada/`.

**Tech Stack:** React 18, TypeScript strict, Vite 5, Zustand 4, Vitest 1 + RTL + MSW, `idb`, `minisearch`, `markdown-it`, `dompurify`, `mermaid`, `vite-plugin-pwa`, Playwright; Rust (existing `voice/` + `git/runner.rs`).

**Spec:** `docs/superpowers/specs/2026-11-02-mobile-pwa-design.md` (read the "Settled after the builder review" section; it overrides earlier sections).

## Global Constraints

- TypeScript `"strict": true`; no `any` without a justifying comment. Rust `#![deny(warnings)]`.
- Tests ship in the same commit as the code. 80 % line coverage for `mobile/src` (excluding `main.tsx`).
- Conventional commits in English, imperative, **no `Co-Authored-By` or AI attribution**.
- **Never run `cargo fmt`, `prettier --write` or any repo-wide formatter.**
- One cargo build at a time; before cargo: `export ORT_LIB_LOCATION=$(ls -d ~/Library/Caches/ort.pyke.io/dfbin/aarch64-apple-darwin/*/onnxruntime | head -1)`.
- Design system is binding: colours, fonts, radii and spacing only via `var(--token)` from `design/tokens.css`; Geist / Geist Mono / Instrument Serif (H1 only); Lucide icons, stroke 1.5; one primary (gold) button per view; light + dark via `data-theme` and `prefers-color-scheme`.
- All user-facing copy in Spanish; code, identifiers and comments in English.
- PAT is sent only to `https://api.github.com`. The app writes only new files under `Entrada/`; it never overwrites or deletes remote files.
- Vite `base: '/markdaun/'`.
- Recording name: `Entrada/Nota de voz YYYY-MM-DD HH-mm.<ext>` (local time), numbered ` 2`, ` 3`… on collision. Extension map (from `src-tauri/src/voice/save.rs` `audio_ext`): `audio/mp4|audio/x-m4a|audio/aac|video/mp4 → m4a`, `audio/webm|video/webm → webm`, `audio/ogg|audio/opus → ogg`, `audio/wav|audio/x-wav|audio/wave → wav`, `audio/mpeg|audio/mp3 → mp3`. Upload commit message: `MarkDaun mobile (<device>) — <rfc3339>`.
- Recording cap: 30 minutes.
- Error kinds: `Offline`, `Unauthorized`, `Forbidden`, `NotFound`, `RateLimited`, `TooLarge`, `MicDenied`, `Unknown`.

## Review Focus

1. A recording made offline, app closed, reopened online days later → it uploads once, exactly once, and is removed from the queue only after a 201. (Task 6 test `survives reload and uploads once`.)
2. Two notes with the same file name in different folders → `[[name]]` opens the same-folder one, otherwise the shortest path. (Task 4 test `tie-break`.)
3. A note whose image path has spaces/accents and `../` (the recipes: `![…](../media/0413_completo.jpg)`) → the image loads. (Task 4 + Task 5 tests.)
4. Token revoked after setup → refresh shows "Token no válido" with a link to settings, local notes stay readable. (Task 8 test `unauthorized keeps notes`.)
5. A note with `<script>` or `onerror=` in raw HTML → nothing executes. (Task 4 test `sanitizes`.)

---

### Task 1: Scaffold `mobile/` and the Pages deploy

**Files:**
- Create: `mobile/package.json`, `mobile/tsconfig.json`, `mobile/vite.config.ts`, `mobile/index.html`, `mobile/src/main.tsx`, `mobile/src/App.tsx`, `mobile/src/App.test.tsx`, `mobile/src/test/setup.ts`, `mobile/src/styles.css`, `mobile/public/` icons
- Create: `.github/workflows/mobile-pages.yml`
- Modify: root `vite.config.ts` (or `vitest.config.*`) so root `npm test` excludes `mobile/**`

**Interfaces:**
- Produces: `npm --prefix mobile test`, `npm --prefix mobile run build` (output `mobile/dist`), `App` component mounted at `#root`.

- [ ] **Step 1:** Write `App.test.tsx`: `renders the setup screen when no config exists` — expects text `Conecta tu repositorio`.
- [ ] **Step 2:** Run `npm --prefix mobile test` → FAIL.
- [ ] **Step 3:** Scaffold: own `package.json` (deps from Tech Stack), strict tsconfig, `vite.config.ts` with `base: '/markdaun/'`, `@vitejs/plugin-react`, `vite-plugin-pwa` (manifest name `MarkDaun`, short_name `MarkDaun`, `display: standalone`, theme colour `#0A1122`, icons generated from `design/icons/app-icon.svg` as 192/512 PNG), Vitest jsdom env with `fake-indexeddb/auto` in setup. `styles.css` imports `../../design/tokens.css` and the Google Fonts URL from AGENTS.md §6.4. `index.html` carries the CSP meta:
  `default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; media-src 'self' blob:` (fonts added to the spec's CSP — ruling: the design system mandates Google Fonts).
  `App` renders a placeholder setup heading until Task 8.
- [ ] **Step 4:** Workflow `mobile-pages.yml`: on push to `main` with paths `mobile/**`, `design/**`; `npm ci && npm test && npm run build` in `mobile/`; deploy `mobile/dist` with `actions/upload-pages-artifact` + `actions/deploy-pages`.
- Enabling Pages on `cdiezgil/markdaun` (Settings → Pages → Source: GitHub Actions) is an outward action: the controller asks the user before doing it; the implementer only writes the workflow.
- [ ] **Step 5:** Run `npm --prefix mobile test` and `npm --prefix mobile run build` → PASS / build ok; run root `npm test` → still green and does not pick up `mobile/`.
- [ ] **Step 6:** Commit `feat(mobile): scaffold the PWA and its Pages deploy`.

### Task 2: GitHub client

**Files:**
- Create: `mobile/src/github/client.ts`, `mobile/src/github/errors.ts`, `mobile/src/github/client.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorKind = 'Offline'|'Unauthorized'|'Forbidden'|'NotFound'|'RateLimited'|'TooLarge'|'MicDenied'|'Unknown'`; `class AppError extends Error { kind: ErrorKind; resetAt?: number; status?: number }`.
  - `interface RepoRef { owner: string; repo: string; branch: string }`
  - `interface TreeEntry { path: string; sha: string; type: 'blob'|'tree'; size?: number }`
  - `createClient(token: string, ref: RepoRef, fetchImpl?: typeof fetch): GitHubClient` with:
    - `checkAccess(): Promise<void>` — `GET /repos/{o}/{r}` and `GET /repos/{o}/{r}/branches/{branch}`.
    - `getTree(): Promise<{ sha: string; entries: TreeEntry[] }>` — recursive tree; if `truncated`, walk subtrees.
    - `fetchTexts(items: {path: string; sha: string}[]): Promise<Map<string, string>>` — GraphQL batches of 50 aliases (`object(expression: "<branch>:<path>") { ... on Blob { text isTruncated } }`); `text == null || isTruncated` → REST `GET /repos/{o}/{r}/git/blobs/{sha}` with `Accept: application/vnd.github.raw`.
    - `getRaw(path: string): Promise<Blob>` — contents API with `Accept: application/vnd.github.raw`.
    - `putNewFile(path: string, content: Blob, message: string): Promise<'created'|'exists'>` — `PUT /contents/{path}` base64, never sends `sha`; 422 → `'exists'`; 409 → retry 3× with 1 s/2 s/4 s backoff.
- Error mapping: network `TypeError` → `Offline`; 401 → `Unauthorized`; 403 with `x-ratelimit-remaining: 0` → `RateLimited` (`resetAt` from `x-ratelimit-reset`*1000); other 403 → `Forbidden`; 404 → `NotFound`; 413 → `TooLarge`; else `Unknown`.
- All requests: `Authorization: Bearer <token>`, `X-GitHub-Api-Version: 2022-11-28`. Paths URL-encoded per segment.

- [ ] **Step 1:** Tests with MSW: `maps statuses to error kinds` (401, 403+ratelimit, 403, 404, 413, network); `fetchTexts batches 120 paths into 3 GraphQL calls`; `falls back to REST raw for null or truncated text`; `walks subtrees when tree is truncated`; `putNewFile returns exists on 422 and never sends sha`; `putNewFile retries 409 then succeeds`; `encodes spaces and accents in paths`; `never calls a host other than api.github.com`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(mobile): add the GitHub client with typed errors`.

### Task 3: Local store and refresh

**Files:**
- Create: `mobile/src/store/db.ts`, `mobile/src/sync/refresh.ts`, `mobile/src/sync/refresh.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `TreeEntry` (Task 2).
- Produces:
  - `openDb(): Promise<Db>` (idb, db name `markdaun`), stores `notes` (key path; `{path, sha, text}`), `tree` (single record `{sha, entries: TreeEntry[]}`), `images` (key sha; Blob), `queue` (Task 6), `meta` (key/value: `config`, `lastRefresh`).
  - `refresh(client: GitHubClient, db: Db): Promise<{ changed: string[]; removed: string[]; skipped: boolean }>` — unchanged root sha → `skipped`; otherwise store new tree, fetch new/changed `.md` blobs, delete removed notes, set `lastRefresh`.
  - Hidden paths (any segment starting with `.`) are excluded everywhere.
- [ ] **Step 1:** Tests (fake-indexeddb, fake client): `first refresh stores every md`; `second refresh with same sha is skipped`; `changed sha refetches only that note`; `removed path is deleted locally`; `ignores dot paths and non-md for notes but keeps them in the tree`; `a failed fetch leaves the previous tree sha so the next refresh retries`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Commit `feat(mobile): store notes locally and refresh incrementally`.

### Task 4: Search, link resolution and rendering

**Files:**
- Create: `mobile/src/notes/resolve.ts`, `mobile/src/notes/search.ts`, `mobile/src/notes/render.ts`, tests beside each

**Interfaces:**
- Produces:
  - `resolveWikilink(label: string, fromPath: string, mdPaths: string[]): string | null` — strip `|alias` and `#heading`; match `.md` stem case-insensitively; tie-break: same folder as `fromPath`, then shortest path, then alphabetical.
  - `resolveImagePath(src: string, fromPath: string, allPaths: string[]): string | null` — decode URI; `http(s):` → returned as-is marker (`null` path, caller uses URL); leading `/` → vault root; otherwise relative to note folder with `..` normalisation; `![[file]]` form resolved by file name with the same tie-break.
  - `buildIndex(notes: {path: string; text: string}[]): SearchIndex`; `SearchIndex.update(changed, removed)`; `SearchIndex.search(q: string): {path: string; title: string; folder: string; snippet: string}[]` — MiniSearch, fields title/path/body, `processTerm` lower-case + NFD diacritic strip, prefix + fuzzy 0.2; title = first `# ` line or file stem.
  - `renderNote(md: string, ctx: { path: string; mdPaths: string[]; allPaths: string[] }): { html: string; images: string[]; hasMermaid: boolean }` — markdown-it (GFM tables, task lists disabled), front matter stripped, `[[…]]` → `<a data-note="<path>">` or `<span class="broken">`, `#tag` → `<span class="tag">`, `==x==` → `<mark>`, images → `<img data-src="<vault path>">`, ```` ```mermaid ```` → `<div class="mermaid-src">`; output through DOMPurify (allow `data-note`, `data-src`).
- [ ] **Step 1:** Tests: `tie-break` (same folder > shortest > alpha); `alias and heading`; `relative ../ image` using `Personal/Recetas/scoolinary/x/receta.md` + `../media/0413_completo.jpg`; `encoded spaces and accents`; `root-absolute`; `obsidian embed`; `search ignores accents and case` (`"limon"` finds `Limón`); `search snippet highlights`; `renders broken link as broken`; `sanitizes` (`<script>`, `<img onerror>` removed); `detects mermaid`; `strips front matter`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Commit `feat(mobile): add search, link resolution and note rendering`.

### Task 5: Image cache

**Files:**
- Create: `mobile/src/notes/images.ts`, `mobile/src/notes/images.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3), `GitHubClient.getRaw` (Task 2), tree entries for path → sha.
- Produces: `loadImage(path: string, deps: { db: Db; client: GitHubClient | null }): Promise<string | null>` — object URL; cached by blob sha in `images`; offline/uncached → `null`. Concurrency limit 4.
- [ ] **Step 1:** Tests: `fetches once then serves from cache`; `returns null offline when not cached`; `refetches when sha changed`; `never fetches more than 4 at once`.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat(mobile): cache note images on demand`.

### Task 6: Upload queue

**Files:**
- Create: `mobile/src/capture/queue.ts`, `mobile/src/capture/queue.test.ts`

**Interfaces:**
- Consumes: `Db`, `GitHubClient.putNewFile`, `AppError`.
- Produces:
  - `recordingName(at: Date, mime: string, n: number): string` — `Entrada/Nota de voz YYYY-MM-DD HH-mm[ n].<ext>`; unknown mime → throws `AppError('Unknown')`.
  - `enqueue(db: Db, blob: Blob, mime: string, at: Date): Promise<void>`
  - `pendingCount(db: Db): Promise<number>`
  - `drainQueue(db: Db, client: GitHubClient, device: string): Promise<{ uploaded: number; lastError?: AppError }>` — strictly sequential, oldest first; on `'exists'` try `n+1` up to 50; delete the entry only after `'created'`; stop at the first error (keep entry); a module-level guard prevents two drains at once.
  - `deviceName(ua: string): string` — `Android`, `iPhone`, `iPad` or `Móvil` from the user agent; used in the commit message.
- [ ] **Step 1:** Tests: `names match the desktop format` (`2026-11-02T09:05` + `audio/webm;codecs=opus` → `Entrada/Nota de voz 2026-11-02 09-05.webm`; `audio/mp4` → `.m4a`; n=2 → `… 09-05 2.webm`); `uploads sequentially oldest first`; `exists moves to next number`; `keeps entry on failure`; `survives reload and uploads once` (reopen db between enqueue and drain, run two concurrent drains → one PUT); `commit message format`.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat(mobile): queue voice notes and upload them to Entrada`.

### Task 7: Recorder

**Files:**
- Create: `mobile/src/capture/useRecorder.ts`, `mobile/src/capture/Recorder.tsx`, `mobile/src/capture/Recorder.test.tsx`

**Interfaces:**
- Produces: `useRecorder(): { state: 'idle'|'recording'|'saving'; elapsedMs: number; error?: AppError; start(): Promise<void>; stop(): Promise<{ blob: Blob; mime: string; at: Date } | null> }` — `getUserMedia({audio:true})`; denied → `MicDenied`; prefers `audio/webm;codecs=opus`, then `audio/mp4`; auto-stop at 30 min; Wake Lock when available, released on stop; tracks stopped on stop/unmount.
  `<Recorder onSaved={() => void} />` — full-screen recording view: elapsed `mm:ss`, stop button; on stop calls `enqueue` and `onSaved`. Copy: `Grabando…`, `Detener`, after save the caller shows `Nota guardada; se subirá a Entrada`.
- [ ] **Step 1:** Tests with a fake `MediaRecorder`/`getUserMedia`: `records and enqueues`; `mic denied shows explanation` (`Permite el micrófono en los ajustes del navegador`); `auto-stops at 30 minutes` (fake timers); `releases tracks on unmount`.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat(mobile): record voice notes`.

### Task 8: Screens and app wiring

**Files:**
- Create: `mobile/src/store/appStore.ts`, `mobile/src/views/Setup.tsx`, `mobile/src/views/Home.tsx`, `mobile/src/views/NoteView.tsx`, `mobile/src/views/Folders.tsx`, `mobile/src/views/Settings.tsx`, `mobile/src/components/Mermaid.tsx`, tests beside each
- Modify: `mobile/src/App.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `useApp` (Zustand): `config | null`, `status: 'idle'|'refreshing'|'offline'|'error'`, `lastRefresh`, `error?: AppError`, `pending: number`, actions `connect(ref, token)`, `refreshNow()`, `drain()`, `signOut()`, `setTheme('system'|'light'|'dark')` (stored in `localStorage` key `markdaun:theme`, sets `data-theme`).
- Navigation: hash routes `#/`, `#/note/<path>`, `#/folders/<path>`, `#/settings`, `#/record` (works on Pages without server rewrites).
- Triggers: refresh + drain on start, on `visibilitychange` → visible, on `online`; pull-to-refresh on Home.
- Copy (exact): Setup heading `Conecta tu repositorio`, fields `Repositorio (usuario/nombre)`, `Rama`, `Token de GitHub`, help text explaining a fine-grained token with only this repo and *Contents: Read and write*, button `Conectar`. Home: search placeholder `Buscar en tus notas`, primary button `Dictar nota`, pending line `N notas pendientes de subir`, status `Actualizado hace X` / `Actualizando…` / `Sin conexión`. Errors: `Unauthorized` → `Token no válido o caducado` + link `Abrir ajustes`; `Forbidden` → `El token no puede escribir en el repositorio`; `NotFound` → `No encuentro el repositorio o la rama`; `RateLimited` → `Límite de GitHub alcanzado; vuelve a intentarlo a las HH:mm`; `Offline` → `Sin conexión`. Settings: `Cambiar repositorio`, `Cerrar sesión` (confirms, wipes IndexedDB and config), `Apariencia` (Sistema / Claro / Oscuro).
- NoteView: renders `renderNote` HTML; `data-note` links navigate; `data-src` images load lazily via IntersectionObserver + `loadImage` (placeholder when `null`); Mermaid component lazy-imports `mermaid` only when `hasMermaid`; search hit opens scrolled to the first match. H1 in `--font-display`.
- [ ] **Step 1:** Tests: `setup validates then shows home`; `setup shows NotFound message`; `home search lists results and opens a note`; `wikilink tap navigates`; `unauthorized keeps notes` (refresh 401 → message + notes still listed); `pending count updates after recording`; `sign out wipes data`; `theme persists`.
- [ ] **Step 2–4:** fail → implement → pass; coverage `npm --prefix mobile run test -- --coverage` ≥ 80 % lines.
- [ ] **Step 5:** Commit `feat(mobile): add the setup, home, note, folder and settings screens`.

### Task 9: End-to-end test

**Files:**
- Create: `mobile/e2e/app.spec.ts`, `mobile/playwright.config.ts`, `mobile/e2e/fixtures/` (small fake repo: 3 notes incl. one with `../media/x.jpg`, one Mermaid, duplicate names)

**Interfaces:**
- Consumes: built PWA (`vite preview`), GitHub API mocked with `page.route('https://api.github.com/**')`.
- [ ] **Step 1:** Spec in Pixel 7 + iPhone 13 device profiles (Chromium for both; `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`): setup → home → search `limon` → open note → image visible → wikilink → back → `Dictar nota` → stop after 2 s → pending 1 → network back → one PUT to `Entrada/Nota de voz …webm` → pending 0. Offline reload (context offline) still shows notes.
- [ ] **Step 2:** Run `npx --prefix mobile playwright test` → PASS. Add `test:e2e` script; add it to the Pages workflow before build.
- [ ] **Step 3:** Commit `test(mobile): cover the main flow end to end`.

### Task 10: Desktop auto-transcription of synced audio

**Files:**
- Create: `src-tauri/src/voice/auto.rs`, `src-tauri/src/voice/auto_tests.rs`, `src-tauri/src/voice/fixtures/voz-android.webm`
- Modify: `src-tauri/src/voice/mod.rs`, `src-tauri/src/git/runner.rs` (after `host.reindex()` near line 632), `src-tauri/src/commands/voice_cmd.rs` (make `start_job` reachable as `pub(crate)`), app setup where `VoiceJobs` is managed (startup scan), `src-tauri/src/voice/transcribe_tests.rs`

**Interfaces:**
- Produces: `pub fn pending_transcriptions(vault: &Path, candidates: &[String], jobs: &VoiceJobs) -> Vec<String>` — keeps vault-relative paths directly inside `Entrada/` (no subfolder) whose extension is in `AUDIO_EXTS`, that exist on disk, with no `<stem>.md` sibling, and not `jobs.is_active`. Startup uses all files in `Entrada/` as candidates.
- Runner: after a cycle, `pending_transcriptions(vault, &changed, jobs)` → `start_job` for each (jobs already serialise via `EngineState::queue`).
- [ ] **Step 1:** Fixture: generate `voz-android.webm` with headless Chromium MediaRecorder (`--use-file-for-fake-audio-capture=src-tauri/src/voice/fixtures/voz-prueba.wav`, `audio/webm;codecs=opus`, 3 s) via a throwaway Playwright script in the scratchpad; commit only the `.webm`. The existing `voz-prueba.m4a` (WKWebView, same engine as iOS Safari) covers iOS.
- [ ] **Step 2:** Tests: `picks new audio in Entrada`; `skips audio with transcript`; `skips numbered stem with transcript` (`Nota de voz 2026-11-02 09-05 2.webm` + `.md`); `skips subfolders and non-audio`; `skips active jobs`; `skips missing files`; in `transcribe_tests.rs`: `decodes android webm` (decode to non-empty 16 kHz samples; transcription test stays `#[ignore]` if it needs the model).
- [ ] **Step 3:** Run `cargo test --manifest-path src-tauri/Cargo.toml voice::` → FAIL. **Step 4:** Implement + wire runner and startup. If the webm does not decode, fix the decode path in `voice/audio.rs` within this task.
- [ ] **Step 5:** `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → PASS.
- [ ] **Step 6:** Commit `feat(voice): transcribe audio that arrives in Entrada by sync`.

### Task 11: Docs

**Files:**
- Modify: `AGENTS.md` (§2.7 voice notes, §4 tree, §5, new §2.8 Mobile PWA), `mobile/README.md` (create)

- [ ] **Step 1:** AGENTS.md: §5 `Mobile (iOS/Android)` → `Apps móviles nativas (la PWA de §2.8 sí está en alcance)`; §4 add `mobile/ ← PWA móvil (lectura + dictado)`; §2.7 add that audio arriving in `Entrada/` by sync is transcribed automatically after the cycle and at startup; new §2.8: what the PWA does, GitHub REST/GraphQL from the browser, PAT in browser storage (fine-grained, one repo), hosted at `cdiezgil.github.io/markdaun/`, **no other GitHub Pages site may be published under `cdiezgil` without first moving the app to its own domain**, writes only new files in `Entrada/`. `mobile/README.md`: install on Android/iOS ("Añadir a pantalla de inicio"), creating the token, dev commands.
- [ ] **Step 2:** Commit `docs: describe the mobile PWA`.
