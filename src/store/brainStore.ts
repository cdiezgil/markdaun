import { create } from 'zustand';
import {
  archiveSource,
  brainDeleteConversation,
  brainGetConversations,
  brainGetMessages,
  brainDigest,
  brainQuery,
  brainSetConversationScope,
  onDigestProgress,
  type DigestProgress,
  type InboxItem,
  type QueryScope,
  type BrainConversation,
  type BrainMessage,
} from '../lib/tauri';
import { prepareAttachments } from '../lib/attachments/prepare';
import { MAX_ATTACHMENTS, MAX_PDF_PAGES, type AttachmentInput, type ChatAttachment } from '../lib/attachments/types';
import { useLlmStore } from './llmStore';
import { useEditorStore } from './editorStore';
import { useVaultStore } from './vaultStore';
import { VAULT_SCOPE } from '../lib/chat/scope';

// ── Public types ───────────────────────────────────────────────────────────────

export type { BrainConversation as Conversation };
export type { BrainMessage };

// ── Store state & actions ─────────────────────────────────────────────────────

/** A prompt handed to the chat panel by another view (consumed once). */
export interface PendingPrompt {
  text: string;
  /** Send immediately instead of just filling the input. */
  send: boolean;
  nonce: number;
}

const NATIVE_PDF_ENGINES = new Set(['anthropicMessages', 'cliClaude']);

/** Does the active connection take PDFs natively (else pages + text are sent)? */
function activeTakesPdfNatively(): boolean {
  const { connections, active } = useLlmStore.getState();
  const conn = connections.find((c) => c.id === active?.connectionId);
  return !!conn && NATIVE_PDF_ENGINES.has(conn.engine);
}

/** What travels with a digestion besides the file path. */
async function digestPayload(
  item: InboxItem,
): Promise<{ attachments?: AttachmentInput[]; sourceText?: string }> {
  if (item.kind !== 'pdf' && item.kind !== 'image') return {};
  const att: ChatAttachment = {
    vaultPath: item.rel_path,
    absPath: item.path,
    name: item.name,
    kind: item.kind === 'pdf' ? 'pdf' : 'image',
  };
  let prepared;
  try {
    prepared = await prepareAttachments([att], { nativePdf: activeTakesPdfNatively() });
  } catch (e) {
    throw `attachment_error: ${e instanceof Error ? e.message : String(e)}`;
  }
  const derived = prepared.inputs[0]?.derived;
  // A PDF over the page limit is digested from its extracted text (in parts if needed).
  if (item.kind === 'pdf' && derived?.text && (derived.pageCount ?? 0) > MAX_PDF_PAGES) {
    return { sourceText: derived.text };
  }
  return { attachments: prepared.inputs };
}

export interface BrainState {
  conversations: BrainConversation[];
  currentConversationId: string | null;
  messages: BrainMessage[];
  filterQuery: string;
  isLoading: boolean;
  error: string | null;
  /** Files queued for the next message (cleared once sent). */
  pendingAttachments: ChatAttachment[];
  /** Non-blocking messages about the last send (e.g. PDF truncated). */
  notices: string[];
  pendingPrompt: PendingPrompt | null;
  /** What the conversation answers from; stored with the conversation. */
  scope: QueryScope;
  /** Name of the inbox source being digested right now. */
  digesting: string | null;
  /** Part progress of a large source being digested. */
  digestProgress: DigestProgress | null;

  /** An archive of the digested source is running. */
  archiving: boolean;
  /** Move the conversation's source to `<targetFolder>/Fuentes/`. */
  archiveDigestSource(conversationId: string, vaultPath: string, targetFolder: string): Promise<void>;

  /** Digest inbox items one after another, one conversation each. */
  digest(items: InboxItem[], vaultPath: string): Promise<void>;

  /** Start a fresh conversation scoped to one note (vault-relative path). */
  askAboutNote(relativePath: string): void;
  /** Change the scope; persisted right away when a conversation is open. */
  setScope(scope: QueryScope, vaultPath: string): Promise<void>;

  addAttachment(a: ChatAttachment): 'added' | 'duplicate' | 'limit';
  removeAttachment(vaultPath: string): void;
  clearAttachments(): void;
  setNotices(notices: string[]): void;
  /** Replace the queue and hand a prompt to the chat panel. */
  askWithAttachments(
    attachments: ChatAttachment[],
    prompt: { text: string; send: boolean },
    notices?: string[],
  ): void;
  consumePendingPrompt(): void;

  // Derived: conversations filtered by filterQuery (on title).
  // Computed inline — not stored state.
  filteredConversations: () => BrainConversation[];

  loadConversations(vaultPath: string): Promise<void>;
  selectConversation(id: string): Promise<void>;
  startNewConversation(): void;
  query(question: string, vaultPath: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  setFilterQuery(q: string): void;
}

export const useBrainStore = create<BrainState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  filterQuery: '',
  isLoading: false,
  error: null,
  pendingAttachments: [],
  notices: [],
  pendingPrompt: null,
  scope: VAULT_SCOPE,
  digesting: null,
  digestProgress: null,
  archiving: false,

  async archiveDigestSource(conversationId, vaultPath, targetFolder) {
    const source = get().conversations.find((c) => c.id === conversationId)?.digest_source;
    if (!source) return;
    const abs = `${vaultPath.replace(/[\\/]+$/, '')}/${source}`;
    set({ archiving: true, error: null });
    try {
      const editor = useEditorStore.getState();
      const out = await editor.runRelocation(() => archiveSource(abs, targetFolder, vaultPath, conversationId));
      await useVaultStore.getState().refreshTree();
      await useEditorStore.getState().applyRelocation(abs, out.path, out.rewritten ?? []);
      const conversations = await brainGetConversations(vaultPath).catch(() => get().conversations);
      set({ conversations });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ archiving: false });
    }
  },

  async digest(items, vaultPath) {
    let unlisten: (() => void) | undefined;
    let current = '';
    try {
      unlisten = await onDigestProgress((p) => {
        if (p.source === current) set({ digestProgress: p });
      });
    } catch {
      /* progress is optional */
    }
    try {
      for (const item of items) {
        current = item.rel_path;
        set({
          digesting: item.name,
          digestProgress: null,
          isLoading: true,
          error: null,
          notices: [],
          currentConversationId: null,
          messages: [],
          pendingAttachments: [],
          scope: VAULT_SCOPE,
        });
        try {
          const { attachments, sourceText } = await digestPayload(item);
          const result = await brainDigest(item.rel_path, vaultPath, attachments, sourceText);
          const conversations = await brainGetConversations(vaultPath).catch(() => get().conversations);
          set({ conversations });
          await get().selectConversation(result.conversation_id);
        } catch (e) {
          set({ error: String(e) });
          break;
        }
      }
    } finally {
      unlisten?.();
      set({ digesting: null, digestProgress: null, isLoading: false });
    }
  },

  askAboutNote(relativePath) {
    set({
      scope: { kind: 'notes', paths: [relativePath] },
      currentConversationId: null,
      messages: [],
      error: null,
      notices: [],
      pendingAttachments: [],
    });
  },

  async setScope(scope, vaultPath) {
    set({ scope });
    const id = get().currentConversationId;
    if (!id) return;
    try {
      await brainSetConversationScope(id, vaultPath, scope);
      set({
        conversations: get().conversations.map((c) => (c.id === id ? { ...c, scope } : c)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── Attachments ──────────────────────────────────────────────────────────────

  addAttachment(a) {
    const { pendingAttachments } = get();
    if (pendingAttachments.some((p) => p.vaultPath === a.vaultPath)) return 'duplicate';
    if (pendingAttachments.length >= MAX_ATTACHMENTS) return 'limit';
    set({ pendingAttachments: [...pendingAttachments, a] });
    return 'added';
  },

  removeAttachment(vaultPath) {
    set({ pendingAttachments: get().pendingAttachments.filter((a) => a.vaultPath !== vaultPath) });
  },

  clearAttachments() {
    set({ pendingAttachments: [] });
  },

  setNotices(notices) {
    set({ notices });
  },

  askWithAttachments(attachments, prompt, notices = []) {
    set({
      notices,
      pendingAttachments: attachments.slice(0, MAX_ATTACHMENTS),
      currentConversationId: null,
      messages: [],
      error: null,
      pendingPrompt: { ...prompt, nonce: Date.now() + Math.random() },
    });
  },

  consumePendingPrompt() {
    set({ pendingPrompt: null });
  },

  // ── Derived ──────────────────────────────────────────────────────────────────

  filteredConversations() {
    const { conversations, filterQuery } = get();
    if (!filterQuery.trim()) return conversations;
    const q = filterQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  },

  // ── Actions ───────────────────────────────────────────────────────────────────

  async loadConversations(vaultPath) {
    try {
      const conversations = await brainGetConversations(vaultPath);
      set({ conversations });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async selectConversation(id) {
    set({ isLoading: true, error: null });
    try {
      const messages = await brainGetMessages(id);
      set({
        currentConversationId: id,
        messages,
        scope: get().conversations.find((c) => c.id === id)?.scope ?? VAULT_SCOPE,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  startNewConversation() {
    set({ currentConversationId: null, messages: [], scope: VAULT_SCOPE });
  },

  async query(question, vaultPath) {
    const { currentConversationId, messages, pendingAttachments, scope } = get();

    // Optimistic: append user message immediately (with the same reference list
    // the backend stores instead of the bytes).
    const refs = pendingAttachments.map((a) => `📎 ${a.name}`).join('\n');
    const optimisticUser: BrainMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: refs ? `${question}\n\n${refs}` : question,
      sources: null,
      created_at: new Date().toISOString(),
    };
    set({ messages: [...messages, optimisticUser], isLoading: true, error: null, notices: [] });

    try {
      let inputs;
      if (pendingAttachments.length > 0) {
        try {
          const prepared = await prepareAttachments(pendingAttachments, {
            nativePdf: activeTakesPdfNatively(),
          });
          inputs = prepared.inputs;
          set({ notices: prepared.notices });
        } catch (e) {
          throw `attachment_error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const result = await brainQuery(
        question,
        vaultPath,
        currentConversationId ?? undefined,
        inputs,
        scope,
      );
      // Attachments travel with this turn only.
      set({ pendingAttachments: [] });

      const assistantMsg: BrainMessage = {
        id: result.message_id,
        role: 'assistant',
        content: result.answer,
        sources: result.sources.length > 0 ? result.sources : null,
        created_at: new Date().toISOString(),
        warning: result.warning ?? null,
      };

      // Replace optimistic user message with real one from the result (same content).
      const realUser: BrainMessage = {
        ...optimisticUser,
        id: `user-${result.message_id}`,
      };

      const prevMessages = get().messages.filter((m) => m.id !== optimisticUser.id);
      set({
        messages: [...prevMessages, realUser, assistantMsg],
        currentConversationId: result.conversation_id,
        isLoading: false,
      });

      // Reload conversation list to show the new/updated entry.
      const convs = await brainGetConversations(vaultPath).catch(() => get().conversations);
      set({ conversations: convs });
    } catch (e) {
      // Keep the question visible, marked as failed, so the user sees what went wrong.
      const messagesNow = get().messages.map((m) =>
        m.id === optimisticUser.id ? { ...m, failed: true } : m,
      );
      set({ messages: messagesNow, error: String(e), isLoading: false });
    }
  },

  async deleteConversation(id) {
    try {
      await brainDeleteConversation(id);
      const conversations = get().conversations.filter((c) => c.id !== id);
      // If deleted conversation was selected, reset.
      const currentConversationId =
        get().currentConversationId === id ? null : get().currentConversationId;
      const msgs = currentConversationId === null ? [] : get().messages;
      set({ conversations, currentConversationId, messages: msgs });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setFilterQuery(q) {
    set({ filterQuery: q });
  },
}));
