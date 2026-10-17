import { create } from 'zustand';
import {
  brainDeleteConversation,
  brainGetConversations,
  brainGetMessages,
  brainQuery,
  type BrainConversation,
  type BrainMessage,
} from '../lib/tauri';
import { prepareAttachments } from '../lib/attachments/prepare';
import { MAX_ATTACHMENTS, type ChatAttachment } from '../lib/attachments/types';
import { useLlmStore } from './llmStore';

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

  addAttachment(a: ChatAttachment): 'added' | 'duplicate' | 'limit';
  removeAttachment(vaultPath: string): void;
  clearAttachments(): void;
  setNotices(notices: string[]): void;
  /** Replace the queue and hand a prompt to the chat panel. */
  askWithAttachments(attachments: ChatAttachment[], prompt: { text: string; send: boolean }): void;
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

  askWithAttachments(attachments, prompt) {
    set({
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
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  startNewConversation() {
    set({ currentConversationId: null, messages: [] });
  },

  async query(question, vaultPath) {
    const { currentConversationId, messages, pendingAttachments } = get();

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
