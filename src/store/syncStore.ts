import { create, UseBoundStore, StoreApi } from 'zustand';
import {
  githubConnectPreview,
  githubConnectApply,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
} from '../lib/tauri';
import type {
  ConnectChoice,
  ConnectPreview,
  ConnectResult,
  DeletionWarning,
} from '../lib/tauri';

export interface SyncConfig {
  repoUrl: string | null;
  isConnected: boolean;
}

export interface SyncStatus {
  hasChanges: boolean;
}

/** A connect awaiting the user's decision. Lives only in memory (holds the PAT). */
export interface PendingConnect {
  repoUrl: string;
  pat: string;
  vaultPath: string;
  preview: ConnectPreview;
}

interface SyncState {
  config: SyncConfig;
  status: SyncStatus;
  isLoading: boolean;
  error: string | null;
  connectAction: ConnectResult['action'] | null;
  /** Set when connecting needs the user to choose; nothing has been changed yet. */
  pendingConnect: PendingConnect | null;
  /** Set when a push was held back by the deletion guard. */
  pendingDeletion: DeletionWarning | null;
  /** Conflict copies created by the last merge (vault-relative paths). */
  conflicts: string[];
  /** Bumped whenever sync may have changed files on disk (reload the tree). */
  vaultChangeCount: number;

  loadConfig(): Promise<void>;
  /** Preview the remote; applies directly only when nothing could be lost. */
  connect(repoUrl: string, pat: string, vaultPath: string): Promise<void>;
  confirmConnect(choice: ConnectChoice): Promise<void>;
  cancelConnect(): void;
  disconnect(): Promise<void>;
  push(vaultPath: string, confirmDeletions?: boolean): Promise<void>;
  confirmDeletion(vaultPath: string): Promise<void>;
  cancelDeletion(): void;
  dismissConflicts(): void;
  pull(vaultPath: string): Promise<void>;
  checkStatus(vaultPath: string): Promise<void>;
}

function errorText(e: unknown): string {
  return typeof e === 'string' ? e : String(e);
}

export const useSyncStore: UseBoundStore<StoreApi<SyncState>> = create<SyncState>(
  (set, get) => {
    async function applyConnect(
      pending: PendingConnect,
      choice: ConnectChoice,
    ): Promise<void> {
      const { repoUrl, pat, vaultPath } = pending;
      const result = await githubConnectApply(repoUrl, pat, vaultPath, choice);
      set((s) => ({
        config: { repoUrl, isConnected: true },
        connectAction: result.action,
        conflicts: result.conflicts,
        isLoading: false,
        vaultChangeCount: s.vaultChangeCount + 1,
      }));
      await get().checkStatus(vaultPath);
    }

    return {
    config: { repoUrl: null, isConnected: false },
    status: { hasChanges: false },
    isLoading: false,
    error: null,
    connectAction: null,
    pendingConnect: null,
    pendingDeletion: null,
    conflicts: [],
    vaultChangeCount: 0,

    async loadConfig() {
      set({ error: null });
      try {
        const repoUrl = await githubGetConfig();
        set({
          config: { repoUrl, isConnected: repoUrl !== null },
        });
      } catch (e) {
        set({ error: typeof e === 'string' ? e : String(e) });
      }
    },

    async connect(repoUrl, pat, vaultPath) {
      set({ isLoading: true, error: null, connectAction: null, pendingConnect: null });
      try {
        const preview = await githubConnectPreview(repoUrl, pat, vaultPath);
        if (preview.case === 'remote_empty') {
          await applyConnect({ repoUrl, pat, vaultPath, preview }, 'sync');
          return;
        }
        // Remote already has notes: the user decides before anything changes.
        set({ isLoading: false, pendingConnect: { repoUrl, pat, vaultPath, preview } });
      } catch (e) {
        set({ isLoading: false, error: errorText(e) });
      }
    },

    async confirmConnect(choice) {
      const pending = get().pendingConnect;
      if (!pending) return;
      set({ isLoading: true, error: null, pendingConnect: null });
      try {
        await applyConnect(pending, choice);
      } catch (e) {
        set({ isLoading: false, error: errorText(e) });
      }
    },

    cancelConnect() {
      set({ pendingConnect: null });
    },

    async disconnect() {
      set({ isLoading: true, error: null });
      try {
        await githubDisconnect();
        set({
          config: { repoUrl: null, isConnected: false },
          status: { hasChanges: false },
          connectAction: null,
          isLoading: false,
        });
      } catch (e) {
        set({
          isLoading: false,
          error: typeof e === 'string' ? e : String(e),
        });
      }
    },

    async push(vaultPath, confirmDeletions = false) {
      set({ isLoading: true, error: null });
      try {
        const result = await githubPush(confirmDeletions);
        if (result.needsConfirmation) {
          set({ isLoading: false, pendingDeletion: result.needsConfirmation });
          return;
        }
        set((s) => ({
          isLoading: false,
          pendingDeletion: null,
          conflicts: result.conflicts,
          vaultChangeCount: s.vaultChangeCount + 1,
        }));
        await get().checkStatus(vaultPath);
      } catch (e) {
        set({ isLoading: false, error: errorText(e) });
      }
    },

    async confirmDeletion(vaultPath) {
      set({ pendingDeletion: null });
      await get().push(vaultPath, true);
    },

    cancelDeletion() {
      set({ pendingDeletion: null });
    },

    dismissConflicts() {
      set({ conflicts: [] });
    },

    async pull(vaultPath) {
      set({ isLoading: true, error: null });
      try {
        const result = await githubPull();
        set((s) => ({
          isLoading: false,
          conflicts: result.conflicts,
          vaultChangeCount: s.vaultChangeCount + 1,
        }));
        await get().checkStatus(vaultPath);
      } catch (e) {
        set({ isLoading: false, error: errorText(e) });
      }
    },

    async checkStatus(vaultPath) {
      try {
        const hasChanges = await githubStatus();
        set({ status: { hasChanges } });
      } catch {
        // If not configured or any error, just keep current state
        set({ status: { hasChanges: false } });
      }
    },
    };
  },
);
