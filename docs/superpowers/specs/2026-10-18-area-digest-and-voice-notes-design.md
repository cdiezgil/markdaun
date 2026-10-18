# Area-first Digestion & Voice Notes — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Builds on:** inbox & digestion (#38), capture channels batch 1 (#40).

## A. Area-first digestion (all inbox items)

The user classifies; the model only refines inside the chosen area.

- **Areas** = the vault's top-level folders, excluding `Entrada/` and hidden folders (`.markdaun`, dot-folders). A vault with no top-level folders offers only "Bóveda (raíz)".
- *Digerir* and *Digerir seleccionados* open a small menu listing the areas; the choice applies to the whole selection. The last used area (persisted per vault in `config.db`) is pre-highlighted.
- The digestion prompt receives **only the chosen area's folder tree** (paths prefixed with the area) and an instruction that every proposed note must live inside that area. The vault note index stays complete (links may point anywhere).
- Proposal cards whose path falls outside the area are **rewritten into the area** (`<area>/<original path without its first segment if that segment is another area, else original path>`) and show a small notice "Ruta ajustada al área"; the folder stays editable.
- The digestion conversation title shows the area: "Digerir: acta.pdf · Mutua".
- Large-source chunking and consolidation keep working with the area restriction.

## B. Voice notes (from quick capture)

- **Recording UI:** a 🎙 button in the quick-capture window. While recording: elapsed time, input level meter, ⏹ to stop and save (also `Cmd/Ctrl+Enter`), `Esc` discards. Hard limit 30 min (auto-stop and save). Recording and text/image capture are mutually exclusive in one capture.
- **Capture:** recorded in the webview via `MediaRecorder`/Web Audio; the frontend sends the audio to Rust, which stores it as `Entrada/Nota de voz YYYY-MM-DD HH-mm.<ext>` (keep the recorder's container; convert to 16 kHz mono PCM internally for Whisper — decode with a Rust audio crate such as `symphonia`, resample with `rubato` or equivalent). macOS microphone permission: add `NSMicrophoneUsageDescription` ("MarkDaun usa el micrófono para grabar notas de voz.") to the bundle Info.plist; Tauri webview media permission must be granted.
- **Flow:** on stop the window closes immediately; the inbox shows the item with a "Transcribiendo…" state; transcription runs in the background; when done, the `.md` appears next to the audio. Failure leaves the audio in the inbox with "Error de transcripción" and a *Reintentar* action.
- **Transcription:** local Whisper via `whisper-rs` (whisper.cpp) with Metal acceleration on macOS.
  - Default model `large-v3-turbo` quantized (`ggml-large-v3-turbo-q5_0.bin`, ~550 MB); alternative `small` (~190 MB) selectable in Settings → *Notas de voz*.
  - Downloaded on first use from the official whisper.cpp model host (Hugging Face `ggerganov/whisper.cpp`) into the app data dir with progress (reuse the own downloader pattern from the embeddings fix: atomic `.part` + rename, relative redirects followed); checksum verified when published.
  - Model loaded once and kept in managed state; transcription in `spawn_blocking`.
  - Language auto-detected.
- **Result note** `Entrada/Nota de voz YYYY-MM-DD HH-mm.md`:
  ```
  # Nota de voz — 18 oct 2026, 14:32

  - Fecha: 2026-10-18 14:32
  - Duración: 3:12
  - Idioma: es
  - Modelo: large-v3-turbo
  - Audio: [Nota de voz 2026-10-18 14-32.m4a](Nota de voz 2026-10-18 14-32.m4a)

  ## Transcripción

  [00:00] …paragraph…

  [00:30] …paragraph…
  ```
  (timestamps every ~30 s at segment boundaries).
- **Digestion & archive:** the voice `.md` is a normal inbox item (area-first digestion). Archiving moves the `.md` and its linked audio file together to `<folder>/Fuentes/` and relinks (extend `archive_source` to move linked sibling media of the same stem, like `_assets`). The audio file itself is not listed as a separate inbox item while its `.md` exists (or is grouped under it).

## Testing (strict TDD)

- A: area listing (excludes Entrada/hidden), last-area persistence, prompt contains only the area tree, out-of-area path rewrite + notice, conversation title, chunking with area.
- B: recorder component with mocked MediaRecorder (start/stop/Esc/limit/level), Rust save of audio, voice `.md` formatting (durations, timestamps, metadata), model downloader against the fake HTTP server (progress, atomic write, checksum mismatch), audio decode/resample on a tiny fixture, a real local transcription test on a short committed Spanish fixture clip with the `small` model marked `#[ignore]` (run once in verification), background state transitions (Transcribiendo… → done / error → Reintentar), archive moves audio with the note.

## Out of scope

- Importing external audio files (iPhone memos, meeting recordings) — possible later.
- Speaker diarization.
- Recording from the main window.
