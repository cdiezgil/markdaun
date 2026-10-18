import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ActiveSelection,
  CliDetection,
  Connection,
  Engine,
  ProgressEvent,
  ValidateResult,
} from './llm/types';
import type { AttachmentInput } from './attachments/types';

export { invoke, convertFileSrc } from '@tauri-apps/api/core';
export { getCurrentWindow } from '@tauri-apps/api/window';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VaultEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  file_type: 'md' | 'image' | 'pdf' | 'other' | null;
  children: VaultEntry[] | null;
}

// ── Typed Tauri command wrappers ───────────────────────────────────────────────

/** Read the UTF-8 content of a note within the vault. */
export async function readNote(path: string, vaultPath: string): Promise<string> {
  return invoke<string>('read_note', { path, vaultPath });
}

/** Write content to a note within the vault (creates or overwrites). */
export async function writeNote(
  path: string,
  content: string,
  vaultPath: string,
): Promise<void> {
  return invoke<void>('write_note', { path, content, vaultPath });
}

export interface Backlink {
  path: string;
  name: string;
}

/** Notes in the vault that link to the given note (wikilink or Markdown link). */
export async function getBacklinks(path: string, vaultPath: string): Promise<Backlink[]> {
  return invoke<Backlink[]>('get_backlinks', { path, vaultPath });
}

/** Open the native file picker filtered to image types.
 *  Returns the absolute path selected, or null if cancelled. */
export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>('pick_image_file');
}

/** Return the currently configured vault path, or null if none. */
export async function getActiveVault(): Promise<string | null> {
  return invoke<string | null>('get_active_vault');
}

/** List the vault directory tree recursively. */
export async function listVaultTree(vaultPath: string): Promise<VaultEntry[]> {
  return invoke<VaultEntry[]>('list_vault_tree', { vaultPath });
}

/** Convert an absolute local path to a Tauri asset URL suitable for <img src>. */
export function convertAssetSrc(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

// ── GitHub Sync commands ───────────────────────────────────────────────────────

export type ConnectCase = 'remote_empty' | 'local_empty' | 'both_have_content';
export type ConnectChoice = 'download' | 'sync';

/** What connecting would do; nothing has been changed yet. */
export interface ConnectPreview {
  case: ConnectCase;
  remoteCount: number;
  localCount: number;
}

export interface ConnectResult {
  action: 'pushed' | 'cloned' | 'merged';
  /** Vault-relative paths of conflict copies created while merging. */
  conflicts: string[];
}

export interface DeletionWarning {
  deleted: number;
  total: number;
}

export interface SyncResult {
  /** Vault-relative paths of conflict copies created while merging. */
  conflicts: string[];
  /** Set when the push was NOT performed and needs the user's confirmation. */
  needsConfirmation: DeletionWarning | null;
}

/** Step 1 of connecting: compare vault and remote without changing anything. */
export async function githubConnectPreview(
  repoUrl: string,
  pat: string,
  vaultPath: string,
): Promise<ConnectPreview> {
  return invoke<ConnectPreview>('github_connect_preview', { repoUrl, pat, vaultPath });
}

/** Step 2 of connecting: apply what the user agreed to in the preview dialog. */
export async function githubConnectApply(
  repoUrl: string,
  pat: string,
  vaultPath: string,
  choice: ConnectChoice,
): Promise<ConnectResult> {
  return invoke<ConnectResult>('github_connect_apply', { repoUrl, pat, vaultPath, choice });
}

/** Return the stored repo URL, or null if not configured. Never returns the PAT. */
export async function githubGetConfig(): Promise<string | null> {
  return invoke<string | null>('github_get_config');
}

/** Remove the GitHub configuration from the app. */
export async function githubDisconnect(): Promise<void> {
  return invoke<void>('github_disconnect');
}

/**
 * Commit local changes, merge what is new on GitHub and push (never forced).
 * Resolves with `needsConfirmation` (and pushes nothing) when the push would
 * delete most of the remote notes and `confirmDeletions` is false.
 */
export async function githubPush(confirmDeletions = false): Promise<SyncResult> {
  return invoke<SyncResult>('github_push', { confirmDeletions });
}

/** Fetch origin/main and merge it; same-note conflicts keep both versions. */
export async function githubPull(): Promise<SyncResult> {
  return invoke<SyncResult>('github_pull');
}

/** Return true if the vault has uncommitted local changes. */
export async function githubStatus(): Promise<boolean> {
  return invoke<boolean>('github_status');
}

// ── Second Brain / LLM commands ───────────────────────────────────────────────

/** Which part of the vault Second Brain answers from (paths are vault-relative). */
export type QueryScope =
  | { kind: 'vault' }
  | { kind: 'notes'; paths: string[] }
  | { kind: 'folder'; path: string };

export interface BrainConversation {
  id: string;
  title: string;
  created_at: string;
  scope?: QueryScope;
  /** Digestion conversations: vault-relative path of the source being digested. */
  digest_source?: string | null;
  /** The digested source was already moved to its `Fuentes/` folder. */
  digest_archived?: boolean;
}

export interface BrainMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: string[] | null;
  created_at: string;
  /** Client-only: the question could not be answered (kept visible, not persisted state). */
  failed?: boolean;
  /** Client-only: answer produced without notes context. */
  warning?: string | null;
}

export interface BrainQueryResult {
  answer: string;
  sources: string[];
  conversation_id: string;
  message_id: string;
  /** e.g. `notes_context_unavailable: <detail>` when the answer has no notes context. */
  warning?: string | null;
}

/**
 * Run a RAG query against the vault.
 * Creates a new conversation if `conversationId` is not provided.
 */
export async function brainQuery(
  question: string,
  vaultPath: string,
  conversationId?: string,
  attachments?: AttachmentInput[],
  scope?: QueryScope,
): Promise<BrainQueryResult> {
  return invoke<BrainQueryResult>('brain_query', {
    question,
    vaultPath: vaultPath,
    conversationId: conversationId ?? null,
    attachments: attachments && attachments.length > 0 ? attachments : null,
    scope: scope ?? null,
  });
}

/** Change the scope stored with a conversation; returns the validated scope. */
export async function brainSetConversationScope(
  conversationId: string,
  vaultPath: string,
  scope: QueryScope,
): Promise<QueryScope> {
  return invoke<QueryScope>('brain_set_conversation_scope', { conversationId, vaultPath, scope });
}

/** List conversations for the given vault, most recent first. */
export async function brainGetConversations(
  vaultPath: string,
): Promise<BrainConversation[]> {
  return invoke<BrainConversation[]>('brain_get_conversations', { vaultPath: vaultPath });
}

/** Get all messages in a conversation. */
export async function brainGetMessages(conversationId: string): Promise<BrainMessage[]> {
  return invoke<BrainMessage[]>('brain_get_messages', { conversationId });
}

/** Delete a conversation and all its messages. */
export async function brainDeleteConversation(conversationId: string): Promise<void> {
  return invoke<void>('brain_delete_conversation', { conversationId });
}

/**
 * Fire-and-forget: re-embed a Markdown file into the vector index.
 * Errors are silently ignored (fire-and-forget semantics).
 */
export async function brainUpdateEmbedding(
  filePath: string,
  vaultPath: string,
): Promise<void> {
  return invoke<void>('brain_update_embedding', {
    filePath: filePath,
    vaultPath: vaultPath,
  });
}

// ── Notes from chat ────────────────────────────────────────────────────────────

/** Create or append a note (path relative to the vault). Returns the absolute path. */
export async function chatWriteNote(
  path: string,
  content: string,
  mode: 'create' | 'append',
  vaultPath: string,
): Promise<string> {
  return invoke<string>('chat_write_note', { path, content, mode, vaultPath });
}

export async function noteExists(path: string, vaultPath: string): Promise<boolean> {
  return invoke<boolean>('note_exists', { path, vaultPath });
}

/** Last `lines` lines of an existing note (append preview). */
export async function readNoteTail(
  path: string,
  vaultPath: string,
  lines: number,
): Promise<string> {
  return invoke<string>('read_note_tail', { path, vaultPath, lines });
}

// ── LLM connections ────────────────────────────────────────────────────────────
// Payload keys must be camelCase (guarded by invokeArgs.test.ts).

/** Validate an unsaved connection end-to-end. Persists nothing. */
export async function llmValidate(draft: Connection, secret: string | null): Promise<ValidateResult> {
  return invoke<ValidateResult>('llm_validate', { draft, secret });
}

/** Test-complete one more model and add it to the validation token. */
export async function llmVerifyModel(
  draft: Connection,
  secret: string | null,
  token: string,
  model: string,
): Promise<void> {
  return invoke<void>('llm_verify_model', { draft, secret, token, model });
}

/** Does `model` actually see images? Sends a tiny generated image. Persists nothing. */
export async function llmTestVision(
  draft: Connection,
  secret: string | null,
  model: string,
): Promise<boolean> {
  return invoke<boolean>('llm_test_vision', { draft, secret, model });
}

/** Persist a validated connection (and its secret, in the OS keyring). */
export async function llmSaveConnection(
  draft: Connection,
  secret: string | null,
  validationToken: string,
): Promise<Connection> {
  return invoke<Connection>('llm_save_connection', { draft, secret, validationToken });
}

export async function llmListConnections(): Promise<Connection[]> {
  return invoke<Connection[]>('llm_list_connections');
}

export async function llmDeleteConnection(id: string): Promise<void> {
  return invoke<void>('llm_delete_connection', { id });
}

export async function llmSetActive(connectionId: string, model: string): Promise<ActiveSelection> {
  return invoke<ActiveSelection>('llm_set_active', { connectionId, model });
}

export async function llmGetActive(): Promise<ActiveSelection | null> {
  return invoke<ActiveSelection | null>('llm_get_active');
}

/** Is the claude / gemini CLI installed? (Login is checked by validation.) */
export async function llmDetectCli(engine: Engine): Promise<CliDetection> {
  return invoke<CliDetection>('llm_detect_cli', { engine });
}

/** Subscribe to validation progress events. Returns the unlisten function. */
export async function onLlmValidateProgress(cb: (e: ProgressEvent) => void): Promise<() => void> {
  return listen<ProgressEvent>('llm-validate-progress', (event) => cb(event.payload));
}

export interface IndexProgress {
  done: number;
  total: number;
}

/** Subscribe to Second Brain indexing progress (`brain-index-progress`). */
export async function onBrainIndexProgress(cb: (p: IndexProgress) => void): Promise<() => void> {
  return listen<IndexProgress>('brain-index-progress', (event) => cb(event.payload));
}

// ── Inbox, trash and digestion ─────────────────────────────────────────────────

export type InboxKind = 'md' | 'txt' | 'pdf' | 'image' | 'docx' | 'pptx' | 'audio' | 'other';

/** Transcription state of a voice recording. */
export interface VoiceInfo {
  state: 'downloading' | 'transcribing' | 'error';
  /** Error detail, when `state` is `error`. */
  detail: string | null;
  /** Model download progress (0..1), when known. */
  progress: number | null;
}

export interface InboxItem {
  name: string;
  /** Absolute path. */
  path: string;
  /** Vault-relative path (`Entrada/<name>`). */
  rel_path: string;
  kind: InboxKind;
  size: number;
  added_ms: number;
  /** Digestion handles this type (otherwise only *Descartar*). */
  supported: boolean;
  /** Voice recordings without a transcript note yet: what is happening to them. */
  voice?: VoiceInfo | null;
}

export interface TrashItem {
  id: string;
  name: string;
  /** Vault-relative location it came from. */
  original_path: string;
  deleted_ms: number;
  size: number;
}

export interface DigestResult {
  answer: string;
  conversation_id: string;
  message_id: string;
  parts: number;
}

export interface DigestProgress {
  /** Vault-relative source being digested. */
  source: string;
  part: number;
  total: number;
  /** The final consolidation turn is running. */
  consolidating: boolean;
}

/** What clipping a URL into the inbox produced. */
export interface ClipSummary {
  path: string;
  rel_path: string;
  title: string;
  /** False when only a note with the link and the failure reason was written. */
  clipped: boolean;
  failure: string | null;
  words: number;
  images_downloaded: number;
  images_failed: number;
}

export interface ArchiveOutcome {
  path: string;
  rewritten: string[];
}

/** Creates `Entrada/` when missing; returns its absolute path. */
export async function inboxEnsure(vaultPath: string): Promise<string> {
  return invoke<string>('inbox_ensure', { vaultPath });
}

/**
 * Copies files given by native OS paths into `Entrada/`.
 * Uses the Rust `import_files` command so WKWebView binary-read restrictions don't apply.
 */
export async function inboxImportFiles(vaultPath: string, sourcePaths: string[]): Promise<void> {
  const inboxPath = await inboxEnsure(vaultPath);
  await invoke('import_files', { destFolderPath: inboxPath, sourcePaths, vaultPath });
}

export async function inboxList(vaultPath: string): Promise<InboxItem[]> {
  return invoke<InboxItem[]>('inbox_list', { vaultPath });
}

/** Clips a web page into `Entrada/` (a failure note when it cannot be clipped). */
export async function inboxClipUrl(url: string, vaultPath: string): Promise<ClipSummary> {
  return invoke<ClipSummary>('inbox_clip_url', { url, vaultPath });
}

/** Moves an inbox item to the vault trash (nothing is deleted). */
export async function inboxDiscard(path: string, vaultPath: string): Promise<void> {
  return invoke<void>('inbox_discard', { path, vaultPath });
}

export async function trashList(vaultPath: string): Promise<TrashItem[]> {
  return invoke<TrashItem[]>('trash_list', { vaultPath });
}

/** Puts a trashed item back; returns its absolute path. */
export async function trashRestore(id: string, vaultPath: string): Promise<string> {
  return invoke<string>('trash_restore', { id, vaultPath });
}

export async function trashDelete(id: string, vaultPath: string): Promise<void> {
  return invoke<void>('trash_delete', { id, vaultPath });
}

/** Moves a digested source to `<targetFolder>/Fuentes/` rewriting links. */
export async function archiveSource(
  path: string,
  targetFolder: string,
  vaultPath: string,
  conversationId?: string,
): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>('archive_source', {
    path,
    targetFolder,
    vaultPath,
    conversationId: conversationId ?? null,
  });
}

/**
 * Digest one inbox source into a dedicated conversation. `.md`/`.txt` are read
 * by the backend; PDFs and images travel as `attachments`, or as `sourceText`
 * when a PDF is too large to attach.
 */
export async function brainDigest(
  sourcePath: string,
  vaultPath: string,
  attachments?: AttachmentInput[],
  sourceText?: string,
  area?: string,
): Promise<DigestResult> {
  return invoke<DigestResult>('brain_digest', {
    sourcePath,
    vaultPath,
    attachments: attachments && attachments.length > 0 ? attachments : null,
    sourceText: sourceText ?? null,
    area: area ?? null,
  });
}

/** Digestion areas: the vault's top-level folders (without `Entrada/`). */
export async function inboxListAreas(vaultPath: string): Promise<string[]> {
  return invoke<string[]>('inbox_list_areas', { vaultPath });
}

/** Area used by the previous digestion ('' = vault root); null if never set. */
export async function inboxGetLastArea(vaultPath: string): Promise<string | null> {
  return invoke<string | null>('inbox_get_last_area', { vaultPath });
}

export async function inboxSetLastArea(vaultPath: string, area: string): Promise<void> {
  return invoke<void>('inbox_set_last_area', { vaultPath, area });
}

/** Subscribe to multi-part digestion progress (`digest-progress`). */
export async function onDigestProgress(cb: (p: DigestProgress) => void): Promise<() => void> {
  return listen<DigestProgress>('digest-progress', (event) => cb(event.payload));
}

// ── Quick capture, shortcut and quit guard ─────────────────────────────────────

export interface QuickSummary {
  kind: 'note' | 'image' | 'clip' | 'voice';
  /** Vault-relative path of the main item written. */
  rel_path: string;
  /** For clips: whether the page could be clipped. */
  clipped: boolean | null;
  failure: string | null;
}

export interface QuickConfig {
  shortcut: string;
  default_shortcut: string;
  /** Why the shortcut is not active (e.g. taken by another app). */
  error: string | null;
}

/** Saves a quick capture into `Entrada/`; `imageB64` is the pasted image as base64. */
export async function quickCaptureSave(text: string, imageB64?: string): Promise<QuickSummary> {
  return invoke<QuickSummary>('quick_capture_save', { text, imageB64: imageB64 ?? null });
}

/** Saves a voice recording (base64 of the recorder's container) into `Entrada/` and starts transcribing it. */
export async function quickCaptureSaveAudio(audioB64: string, mime: string): Promise<QuickSummary> {
  return invoke<QuickSummary>('quick_capture_save_audio', { audioB64, mime });
}

export async function quickCaptureHide(): Promise<void> {
  return invoke<void>('quick_capture_hide');
}

export async function quickCaptureGetConfig(): Promise<QuickConfig> {
  return invoke<QuickConfig>('quick_capture_get_config');
}

/** Rejects with `invalid_shortcut` or `shortcut_unavailable: <reason>`. */
export async function quickCaptureSetShortcut(shortcut: string): Promise<QuickConfig> {
  return invoke<QuickConfig>('quick_capture_set_shortcut', { shortcut });
}

/** Really quits the app (call it after the unsynced-changes guard). */
export async function quitApp(): Promise<void> {
  return invoke<void>('quit_app');
}

/** A capture was saved from the quick-capture window (`inbox-captured`). */
export async function onInboxCaptured(cb: (s: QuickSummary) => void): Promise<() => void> {
  return listen<QuickSummary>('inbox-captured', (event) => cb(event.payload));
}

/** The user chose *Salir* (tray, Cmd+Q): run the exit guard (`request-quit`). */
export async function onRequestQuit(cb: () => void): Promise<() => void> {
  return listen('request-quit', () => cb());
}

/** The quick-capture window was shown (`quick-capture-open`). */
export async function onQuickCaptureOpen(cb: () => void): Promise<() => void> {
  return listen('quick-capture-open', () => cb());
}

// ── Voice notes ────────────────────────────────────────────────────────────────

export interface VoiceModelInfo {
  id: string;
  label: string;
  approx_mb: number;
  downloaded: boolean;
}

export interface VoiceConfig {
  /** Selected model id. */
  model: string;
  models: VoiceModelInfo[];
}

export interface VoiceModelProgress {
  id: string;
  done: number;
  total: number | null;
}

/** Retries the transcription of a recording that failed or was interrupted. */
export async function voiceRetry(vaultPath: string, relPath: string): Promise<void> {
  return invoke<void>('voice_retry', { vaultPath, relPath });
}

export async function voiceGetConfig(): Promise<VoiceConfig> {
  return invoke<VoiceConfig>('voice_get_config');
}

export async function voiceSetModel(model: string): Promise<VoiceConfig> {
  return invoke<VoiceConfig>('voice_set_model', { model });
}

/** Downloads a model ahead of time; progress arrives on `voice-model-progress`. */
export async function voiceDownloadModel(model: string): Promise<VoiceConfig> {
  return invoke<VoiceConfig>('voice_download_model', { model });
}

/** A transcription changed state (`voice-changed`): refresh the inbox. */
export async function onVoiceChanged(cb: () => void): Promise<() => void> {
  return listen('voice-changed', () => cb());
}

export async function onVoiceModelProgress(cb: (p: VoiceModelProgress) => void): Promise<() => void> {
  return listen<VoiceModelProgress>('voice-model-progress', (event) => cb(event.payload));
}
