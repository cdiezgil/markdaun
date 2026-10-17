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

/** Connect the vault to a GitHub repo (push existing files or clone). */
export async function githubConfigure(
  repoUrl: string,
  pat: string,
  vaultPath: string,
): Promise<'pushed' | 'cloned'> {
  return invoke<'pushed' | 'cloned'>('github_configure', {
    repoUrl,
    pat,
    vaultPath,
  });
}

/** Return the stored repo URL, or null if not configured. Never returns the PAT. */
export async function githubGetConfig(): Promise<string | null> {
  return invoke<string | null>('github_get_config');
}

/** Remove the GitHub configuration from the app. */
export async function githubDisconnect(): Promise<void> {
  return invoke<void>('github_disconnect');
}

/** Stage all changes, commit with a timestamped message, and push to origin/main. */
export async function githubPush(): Promise<void> {
  return invoke<void>('github_push');
}

/** Fetch origin/main and fast-forward (or reset hard if diverged). */
export async function githubPull(): Promise<void> {
  return invoke<void>('github_pull');
}

/** Return true if the vault has uncommitted local changes. */
export async function githubStatus(): Promise<boolean> {
  return invoke<boolean>('github_status');
}

// ── Second Brain / LLM commands ───────────────────────────────────────────────

export interface BrainConversation {
  id: string;
  title: string;
  created_at: string;
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
): Promise<BrainQueryResult> {
  return invoke<BrainQueryResult>('brain_query', {
    question,
    vaultPath: vaultPath,
    conversationId: conversationId ?? null,
    attachments: attachments && attachments.length > 0 ? attachments : null,
  });
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
