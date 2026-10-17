import { create } from 'zustand';
import {
  llmDeleteConnection,
  llmGetActive,
  llmListConnections,
  llmSetActive,
} from '../lib/tauri';
import { asLlmError, describeLlmError } from '../lib/llm/errors';
import type { ActiveSelection, Connection } from '../lib/llm/types';

export interface LlmState {
  connections: Connection[];
  active: ActiveSelection | null;
  /** True after the first load attempt (avoids flashing the empty state). */
  loaded: boolean;
  error: string | null;
  wizardOpen: boolean;
  /** Connection being edited / duplicated (id '' for a duplicate); null = new. */
  editing: Connection | null;

  load(): Promise<void>;
  setActive(connectionId: string, model: string): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  openWizard(editing?: Connection | null): void;
  closeWizard(): void;
}

const fail = (e: unknown): string => describeLlmError(asLlmError(e)).message;

export const useLlmStore = create<LlmState>((set, get) => ({
  connections: [],
  active: null,
  loaded: false,
  error: null,
  wizardOpen: false,
  editing: null,

  async load() {
    try {
      const [connections, active] = await Promise.all([llmListConnections(), llmGetActive()]);
      set({ connections: connections ?? [], active: active ?? null, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: fail(e) });
    }
  },

  async setActive(connectionId, model) {
    try {
      const active = await llmSetActive(connectionId, model);
      set({ active, error: null });
    } catch (e) {
      set({ error: fail(e) });
    }
  },

  async deleteConnection(id) {
    try {
      await llmDeleteConnection(id);
      await get().load();
    } catch (e) {
      set({ error: fail(e) });
    }
  },

  openWizard(editing = null) {
    set({ wizardOpen: true, editing });
  },

  closeWizard() {
    set({ wizardOpen: false, editing: null });
  },
}));
