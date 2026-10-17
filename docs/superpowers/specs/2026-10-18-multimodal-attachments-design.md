# Multimodal Attachments (images & PDFs in Second Brain) — Design

- **Date:** 2026-10-18
- **Status:** Approved (brainstorming)
- **Scope:** Sub-project A only — the LLM can "see" images and PDFs from the vault, answer about them and explain them in notes. Rendering text diagrams (Mermaid) in the editor is a separate, later sub-project.

## 1. Goal

Let the user ask the active LLM about any image or PDF in the vault (e.g. a JPG exported from Miro, a PDF with a pasted SVG diagram) and turn the explanation into a note, from three entry points: the chat, the image/PDF preview, and a note that embeds images.

## 2. Verified facts

- `claude -p --input-format stream-json --output-format stream-json --verbose --tools "" --no-session-persistence` accepts Anthropic content blocks on stdin: an `image` block (base64 PNG) and a `document` block (base64 PDF) were both answered correctly with the subscription login (manual test, Claude Code 2.1.212). The result is the line with `"type":"result"`, field `result`.
- Vision support depends on the model: Claude, GPT-4o/4.1 and Gemini models see images. Kimi / z.ai coding-plan models are text-only.

## 3. Entry points (UI copy in Spanish)

1. **Chat**
   - 📎 button opens a picker of vault files filtered to images and PDFs; dragging a file from the vault tree onto the chat also attaches it.
   - Attachments show as chips above the input (name, type icon, ✕). They are sent with the next message and then cleared.
   - Max 5 attachments per message.
2. **Preview panel** (image or PDF)
   - *Preguntar a la IA*: opens the Second Brain chat with the file attached and the input focused.
   - *Explicar en una nota*: attaches the file and sends a predefined prompt asking the model to explain the content and return a `markdaun-note` block with `mode="create"` and default `path` = same folder, same base name, `.md` (e.g. `diagramas/flujo.png` → `diagramas/flujo.md`), whose content starts with the embedded file (`![](flujo.png)` for images, `[flujo.pdf](flujo.pdf)` for PDFs) followed by the explanation. The existing proposal card handles create/rename/append.
3. **Note** (editor toolbar)
   - *Explicar imágenes de esta nota*: collects local images/PDFs referenced by the note (Markdown image/link syntax, paths resolved relative to the note, must stay inside the vault), attaches them (max 5; extra ones reported) together with the note text, and opens the chat with a predefined prompt. Remote URLs are skipped with a notice.

## 4. Attachment processing

Pure, testable normalisation step producing `Attachment { name, vault_path, kind: Image | Pdf, parts }`:

| Input | Processing |
|---|---|
| PNG, JPEG, GIF, WebP | Sent as-is; if the longest side > 1568 px, downscaled (keep aspect, re-encode PNG/JPEG). |
| SVG, other raster formats supported by the webview | Rasterized to PNG in the frontend (canvas), then same size rule. |
| PDF | Kept as PDF bytes **and**, when the target engine cannot take PDFs natively, rendered page by page to PNG plus extracted text with `pdf.js` in the frontend. |

Limits: PDF ≤ 20 MB and ≤ 20 pages (only the first 20 pages are used; the chat shows a notice); 5 attachments per message. Violations produce a clear Spanish error before sending.

Processing that needs a renderer (SVG, PDF pages/text) happens in the frontend; file reading, downscaling of raster images and sending happen in Rust.

## 5. Message model and engines

- `ChatMessage` gains structured content: a list of parts `Text(String) | Image { media_type, data_b64 } | Document { media_type, data_b64 }` (text-only messages keep working unchanged).
- `brain_query` accepts `attachments` (vault-relative paths plus any frontend-prepared derivatives: rasterized images, PDF page images, PDF text). Paths are validated inside the vault.
- Engine translation:

| Engine | Image | PDF |
|---|---|---|
| `AnthropicMessages` (API, Azure Foundry) | `image` block | `document` block (native) |
| `CliClaude` | `image` block via `--input-format stream-json` | `document` block (native) |
| `OpenAiCompat` (OpenAI, Azure OpenAI, Gemini API, Kimi, z.ai, LiteLLM) | `image_url` with data URI | page images + extracted text |
| `CliGemini` | temp-file copy referenced as `@path` in the prompt, with read-only approval mode | page images (as temp files) + extracted text |

- CLI Claude switches to stream-json input/output only when the turn has attachments; text-only turns keep the current path. Parse the `"type":"result"` line.

## 6. Vision capability

- Each model saved in a connection carries `vision: bool`. Presets provide defaults for known models (Claude, GPT-4o/4.1, Gemini → true; Kimi/z.ai coding plans → false; unknown → false).
- The wizard's validation step adds an optional *Probar visión* check that sends a tiny generated image and records the result.
- Existing connections are migrated with preset defaults.
- Sending attachments with a non-vision model is blocked in the UI: *"Este modelo no ve imágenes. Cambia de modelo en la barra inferior."* The backend also rejects it with a typed error (`VisionUnsupported`).

## 7. History

- Attachments are sent **only in the turn they are attached** (user decision). The stored user message keeps a reference list (`📎 flujo.png`), not the bytes. Follow-up turns contain only text history.

## 8. Testing (strict TDD)

- Rust: attachment validation (inside vault, size/page limits), raster downscale, each engine's request body with image/document parts against the fake HTTP server, CLI Claude with a fake binary asserting the stream-json stdin and parsing the result line, CLI Gemini temp-file references, `VisionUnsupported`, migration of `vision` flags, stored message references.
- Frontend: SVG rasterization and PDF page/text extraction helpers (with a small fixture PDF), attachment chips (add/remove/limit), drag from tree, preview buttons, note action collecting local images and skipping remote ones, non-vision warning, wizard *Probar visión*.

## 9. Out of scope

- Mermaid/PlantUML rendering in the editor (separate sub-project).
- Remote image URLs.
- Resending attachments in follow-up turns.
- OCR beyond what the model does itself.
