import { create } from 'zustand';
import {
  brainConfigure,
  brainDeleteConversation,
  brainGetConfig,
  brainGetConversations,
  brainGetMessages,
  brainQuery,
  type BrainConversation,
  type BrainConfig,
  type BrainMessage,
} from '../lib/tauri';

// ── Public types ───────────────────────────────────────────────────────────────

export type { BrainConversation as Conversation };
export type { BrainMessage };
export type { BrainConfig };

// ── Store state & actions ─────────────────────────────────────────────────────

export interface BrainState {
  isConfigured: boolean;
  config: BrainConfig;
  conversations: BrainConversation[];
  currentConversationId: string | null;
  messages: BrainMessage[];
  filterQuery: string;
  isLoading: boolean;
  error: string | null;

  // Derived: conversations filtered by filterQuery (on title).
  // Computed inline — not stored state.
  filteredConversations: () => BrainConversation[];

  loadConfig(): Promise<void>;
  configure(endpointUrl: string, apiKey: string | null, model: string): Promise<void>;
  loadConversations(vaultPath: string): Promise<void>;
  selectConversation(id: string): Promise<void>;
  startNewConversation(): void;
  query(question: string, vaultPath: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  setFilterQuery(q: string): void;
}

export const useBrainStore = create<BrainState>((set, get) => ({
  isConfigured: false,
  config: { endpoint_url: null, model: null },
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

  async loadConfig() {
    try {
      const config = await brainGetConfig();
      set({
        config,
        isConfigured: !!(config.endpoint_url && config.model),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  async configure(endpointUrl, apiKey, model) {
    set({ isLoading: true, error: null });
    try {
      await brainConfigure(endpointUrl, apiKey, model);
      set({
        config: { endpoint_url: endpointUrl, model },
        isConfigured: true,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

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
      // Remove optimistic message on failure.
      const prevMessages = get().messages.filter((m) => m.id !== optimisticUser.id);
      set({ messages: prevMessages, error: String(e), isLoading: false });
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
