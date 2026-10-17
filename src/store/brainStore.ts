import { create } from 'zustand';
import {
  brainDeleteConversation,
  brainGetConversations,
  brainGetMessages,
  brainQuery,
  type BrainConversation,
  type BrainMessage,
} from '../lib/tauri';

// ── Public types ───────────────────────────────────────────────────────────────

export type { BrainConversation as Conversation };
export type { BrainMessage };

// ── Store state & actions ─────────────────────────────────────────────────────

export interface BrainState {
  conversations: BrainConversation[];
  currentConversationId: string | null;
  messages: BrainMessage[];
  filterQuery: string;
  isLoading: boolean;
  error: string | null;

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
    const { currentConversationId, messages } = get();

    // Optimistic: append user message immediately.
    const optimisticUser: BrainMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: question,
      sources: null,
      created_at: new Date().toISOString(),
    };
    set({ messages: [...messages, optimisticUser], isLoading: true, error: null });

    try {
      const result = await brainQuery(question, vaultPath, currentConversationId ?? undefined);

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
