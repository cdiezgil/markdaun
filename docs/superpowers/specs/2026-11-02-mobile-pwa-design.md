# MarkDaun mobile (PWA) — design

Date: 2026-11-02 · Status: proposed · Project 3 of the chain (automatic sync ✅ → **mobile app** → vector index publication + Brain on mobile)

## Intent

The user wants their notes with them anywhere, from their phone. The typical moment: in the middle of a meeting, they need to check a fact or a topic from another meeting's notes. They also want to create new notes only by dictation: record audio, the audio lands in `Entrada/`, and the Mac transcribes it and later digests it into notes, as it already does for desktop voice notes.

The user has a Google Pixel and will likely share the app with colleagues who use iPhones. Each person configures their own GitHub repo.

## Goals

- Read any note in the vault from the phone, rendered (headings, lists, tables, links, highlights, tags, images and Mermaid diagrams).
- Full-text search across all notes, working offline.
- Dictate a new note in one tap. The audio is uploaded to `Entrada/` of the user's repo, and the Mac transcribes it automatically when it arrives by sync.
- Works on Android and iOS without app stores, accounts or a build toolchain.

## Non-goals (v1)

- Editing notes, renaming, deleting, or creating notes by typing.
- The Brain / semantic search (phase two, together with publishing `vectors.db`).
- The graph view.
- Transcribing on the phone.
- Background sync while the app is closed, push notifications.

## Anti-goals: a failure even if it "works"

- The PAT going anywhere other than `api.github.com`.
- The phone writing anything outside `Entrada/`, or overwriting/deleting any file.
- Losing a recording: a recording is deleted from the phone only after GitHub confirmed the upload.
- Downloading all images up front (≈3 700 images, 215 MB in the user's vault).
- A first load that exhausts the GitHub API rate limit.

## Decisions taken with the user

- **PWA instead of Tauri mobile.** On the phone nothing needs Rust: it is HTTP to GitHub, local storage, search and audio recording. A PWA avoids the Android toolchain (not installed on the Mac: Homebrew Rust without rustup, no NDK), avoids TestFlight and the Apple developer fee for iPhone colleagues, and is less code. Accepted trade-offs: the PAT lives in browser storage instead of the OS keystore (mitigated with a fine-grained PAT limited to one repo); queued uploads only go out while the app is open; iOS may evict local data of an app unused for weeks (it is re-downloaded, nothing is lost).
- **Home screen:** a search box and a large "Dictar nota" button. The folder tree is secondary.
- **Notes text:** all `.md` files are kept on the phone (≈4 000 notes, 18 MB in the user's vault) so search works offline.
- **Images:** downloaded when a note that shows them is opened, then cached for next time. Never all at once.
- **Diagrams:** the vault only uses Mermaid fenced blocks (7 notes); render them with Mermaid.
- **Offline dictation:** the recording is queued on the phone and uploaded automatically when connectivity returns.
- **Wikilinks** are tappable and open the linked note.
- **Per-user setup:** each user enters their own repo and PAT.

## How it works (builder's calls marked *[call]*)

### Code and hosting

- A separate Vite + React 18 + TypeScript (strict) + Zustand app in `mobile/` of this repo *[call]*, sharing the design system (`design/tokens.css`, Geist, Lucide icons, Navy/Gold themes, light and dark). It does not import desktop code that depends on Tauri.
- Deployed as static files to GitHub Pages of `cdiezgil/markdaun` (public) by a GitHub Actions workflow on push to `main` touching `mobile/` *[call]*. The site holds no user data.
- PWA manifest + service worker (e.g. `vite-plugin-pwa`) so the app installs to the home screen and opens offline *[call]*. Icon from `design/icons/app-icon.svg`.
- Content-Security-Policy limits `connect-src` to `https://api.github.com` (plus `self`) *[call]*.

### Setup

- First launch: repo (`owner/name`), branch (default `main`) and a fine-grained PAT. The screen explains how to create one: only this repo, *Contents: Read and write*.
- Validate before saving: the repo and branch are reachable with the token (read-only checks). Write permission is **not** probed at setup: no reliable non-mutating check exists for fine-grained tokens, and a test write would break the "only add to `Entrada/`" rule. A missing write permission surfaces on the first upload as `Forbidden`, with the recording kept in the queue. Errors are typed and shown in Spanish (bad token, repo not found, offline).
- Settings: change repo/token, sign out (wipes all local data), theme (Sistema / Claro / Oscuro).

### Getting the notes

- Local store in IndexedDB *[call]*: per `.md` path, its blob SHA and text; plus the last seen tree SHA.
- Refresh: on app open, on returning to the foreground, and by pull-to-refresh. Steps:
  1. `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` gives every path with its blob SHA. If the root tree SHA is unchanged, stop.
  2. Diff against the local store: new or changed `.md` blobs are downloaded, removed paths are deleted locally.
  3. Download text in **batches**, not one request per file: the first load of ≈4 000 notes must not exhaust the 5 000 requests/hour limit. Suggested: GraphQL `repository.object(expression: "<branch>:<path>") { ... on Blob { text } }` with many aliases per query *[call]*.
- If the tree response is `truncated`, fall back to walking subtrees *[call]*.
- Hidden paths (`.git`, `.markdaun`, dotfiles) are ignored. Non-`.md` files are kept only as entries in the tree (for image lookup and the folder view).
- A discreet state line shows "Actualizado hace X" / "Sin conexión" / "Actualizando…".

### Search

- Local full-text index over title (H1 or file name), path and body, accent- and case-insensitive (Spanish) *[call: MiniSearch or similar]*, updated incrementally after each refresh.
- Results show title, folder and a snippet with the match highlighted; they open the note scrolled to the first match *[call]*.

### Reading

- Markdown → HTML (e.g. `markdown-it`) with the vault's dialect: `[[wikilinks]]` (resolved like the desktop: by file name, case-insensitive; broken links in `amber` dashed underline), `#tags` as chips, `==highlight==`, GFM tables and task lists (read-only) *[call]*.
- Output is sanitized (e.g. DOMPurify) since notes may contain raw HTML.
- Mermaid blocks are rendered client-side, lazy-loaded only when a note contains one.
- Images: relative paths are resolved against the note's folder (and vault-root paths, as the desktop does). Each image is fetched with the PAT via `GET /repos/{o}/{r}/contents/{path}` with `Accept: application/vnd.github.raw`, stored as a blob (Cache Storage or IndexedDB) keyed by blob SHA, and shown via object URL. Lazy-loaded as it scrolls into view. Offline and not cached: a placeholder.
- Folder view: browse the vault tree; tapping a note opens it.
- Front matter, if present, is hidden *[call]*.

### Dictation

- "Dictar nota" asks for the microphone, records with `MediaRecorder` (Android Chrome: webm/Opus; iOS Safari: mp4/AAC), shows elapsed time and a stop button. Recording keeps the screen awake where the Wake Lock API is available *[call]*.
- Cap: 30 minutes per recording *[call]*.
- On stop, the recording is stored in IndexedDB in an **upload queue** and the user returns to the home screen with a notice "Nota guardada; se subirá a Entrada".
- Upload: `PUT /repos/{o}/{r}/contents/Entrada/Nota de voz YYYY-MM-DD HH-mm.<ext>` (base64 content, commit message `MarkDaun mobile (<device>) — <rfc3339>`, branch). The name uses the recording's local time and the same format the desktop parses (`parse_recorded` in `src-tauri/src/voice/jobs.rs`); extension from the MIME type with the same mapping as `audio_ext` in `src-tauri/src/voice/save.rs` (webm, m4a, ogg…).
  - If the path already exists (HTTP 422 / sha required), retry with ` 2`, ` 3`… appended, as the desktop does. Never overwrite.
  - On success the queue entry is removed. On failure it stays and is retried on the next app open, `online` event, or manual retry. The home screen shows "N notas pendientes de subir".
- Uploads larger than the Contents API limit are rejected before recording ends: the 30 min cap keeps files far below it *[call; the builder verifies the limit]*.

### Desktop change: auto-transcribe audio that arrives by sync

Today a recording that appears in `Entrada/` without a transcript and without a running job shows as "interrumpido" and needs a manual retry (`inbox_list_with_jobs` in `src-tauri/src/commands/inbox.rs`). Change:

- After a sync cycle whose `changedPaths` contain an audio file directly in `Entrada/` with no sibling `<stem>.md`, the desktop enqueues its transcription automatically (same `VoiceJobs` path, one job at a time).
- On app start, the same check runs once over `Entrada/` for audio that arrived while the app was closed *[call]*.
- The transcript `.md` is then committed and pushed by the normal automatic sync.
- Two Macs: the user never uses both at once, so a duplicate transcription is unlikely; if it happens, the existing conflict-copy rule keeps both versions. Accepted.
- Digestion into notes stays as today (the user does it on the Mac).

## Errors

Typed errors mapped to Spanish messages with an action: `Offline`, `Unauthorized` (token invalid or expired → open settings), `Forbidden` (no write permission), `NotFound` (repo/branch), `RateLimited` (show when it resets), `TooLarge`, `MicDenied` (explain how to allow the mic), `Unknown`.

## Testing

- Vitest + React Testing Library for: tree diff, batched fetch, search index, Markdown rendering (wikilinks, tags, highlight, images resolution, sanitizing), upload queue (success, failure, name collision, offline), setup validation. GitHub API mocked (e.g. MSW) *[call]*.
- Playwright in mobile viewport against the built PWA with the API mocked: setup → refresh → search → open note with image → record (fake media stream) → queued → uploaded.
- Desktop (Rust): auto-enqueue of an audio arriving by sync; no enqueue when the `.md` already exists or the file is outside `Entrada/`.
- 80 % line coverage (AGENTS.md §3).

## Docs to update

- AGENTS.md §5: replace "Mobile (iOS/Android)" with "Native mobile apps"; add a section describing the mobile PWA (read + voice capture, GitHub REST/GraphQL from the browser, PAT in browser storage, hosted on GitHub Pages).
- AGENTS.md §4: add `mobile/`.
- AGENTS.md §2.7 (voice notes): audio arriving by sync is transcribed automatically.

## Settled after the builder review *[calls]*

These override the sections above where they are more specific.

1. **Origin and the PAT.** GitHub Pages serves the app at `cdiezgil.github.io/markdaun/`; browser storage is shared by every Pages site of that account. The account has no other Pages site today, so this is an accepted risk, written in AGENTS.md: no other Pages site may be published under `cdiezgil` without moving the app to its own domain first. Vite `base` is `/markdaun/`.
2. **Wikilinks** resolve like the desktop (`src-tauri/src/graph/links.rs`: `.md` stem, case-insensitive), with a deterministic tie-break when several notes share a name: same folder first, then the shortest path, then alphabetical. `[[name|alias]]` shows the alias; `[[name#heading]]` opens the note (scrolling to the heading is optional).
3. **Image paths** that must work: relative to the note (including `../`), vault-root absolute (`/…`), URL-encoded names (spaces, accents), and Obsidian embeds `![[file.png]]` resolved by file name with the same tie-break as wikilinks. External `http(s)` images load as-is if CSP allows them; otherwise a placeholder.
4. **Phone recordings on the desktop.** A real Android Chrome webm/Opus recording and an iOS Safari mp4 recording are added as Rust test fixtures and must decode and transcribe through `voice/`. If decoding fails, hardening the decode path is part of this project.
5. **Auto-transcription trigger** skips audio that already has a `<stem>.md` (including numbered names like `… 2`) and audio with a job already queued or running.
6. **Uploads are strictly sequential** (one PUT at a time). HTTP 409 is retried with backoff (up to 3 times); 422 "already exists" moves to the next numbered name.
7. **Fetching text:** GraphQL batches, but any blob with `text == null` or `isTruncated` is fetched individually via REST raw (`Accept: application/vnd.github.raw`). Batch size is kept under GraphQL node/time limits. `RateLimited` shows the reset time.
8. **CSP** via `<meta>`: `connect-src 'self' https://api.github.com`, `img-src 'self' blob: data: https:`, `style-src 'self' 'unsafe-inline'` (Mermaid), `script-src 'self'`. `frame-ancestors` cannot be set via meta; accepted.
9. **Minimum platforms:** Android Chrome current; iOS 14.3+ for recording (Wake Lock only from 16.4, used when available).

## Left to the builder

Internal module layout of `mobile/`, exact libraries within the calls above, batch sizes, cache eviction policy for images, exact copy text, and the Pages workflow details.
