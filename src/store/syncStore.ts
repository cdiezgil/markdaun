import { create, UseBoundStore, StoreApi } from 'zustand';
import {
  githubConnectPreview,
  githubConnectApply,
  githubGetConfig,
  githubDisconnect,
  syncTrigger,
  syncConfirmDeletions,
  syncDismissConflicts,
  syncGetState,
} from '../lib/tauri';
import type {
  ConnectChoice,
  ConnectPreview,
  ConnectResult,
  DeletionWarning,
  SyncState,
} from '../lib/tauri';

export type SyncIndicator = 'upToDate' | 'syncing' | 'pending' | 'offline' | 'needsReview';

/**
 * What the status bar shows. `running` is whether a cycle is in flight right
 * now (the scheduler view may lag a `sync-will-start` event).
 */
export function indicatorFor(s: SyncState, running: boolean): SyncIndicator {
  if (s.view.halted || s.pausedReason !== null || s.pendingConflicts.length > 0) {
    return 'needsReview';
  }
  if (running) return 'syncing';
  if (s.view.offline) return 'offline';
  if (s.status.uncommitted || s.status.ahead > 0 || s.view.pendingDebounce) return 'pending';
  return 'upToDate';
}

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

interface SyncStoreState {
  config: SyncConfig;
  /** Derived from `state`: uncommitted edits or unpushed commits. */
  status: SyncStatus;
  /** Last cycle result / snapshot from the backend; null until first known. */
  state: SyncState | null;
  /** A connect or disconnect is in flight. */
  connecting: boolean;
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
  /** Store a `sync-finished` payload (or a `sync_get_state` result). */
  applyFinished(payload: SyncState): void;
  loadState(): Promise<void>;
  syncNow(): Promise<void>;
  confirmDeletion(): Promise<void>;
  cancelDeletion(): void;
  dismissConflicts(): Promise<void>;
}

function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'kind' in e) return JSON.stringify(e);
  return String(e);
}

export const useSyncStore: UseBoundStore<StoreApi<SyncStoreState>> = create<SyncStoreState>(
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
        connecting: false,
        vaultChangeCount: s.vaultChangeCount + 1,
      }));
      await get().loadState();
    }

    return {
    config: { repoUrl: null, isConnected: false },
    status: { hasChanges: false },
    state: null,
    connecting: false,
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
      set({ connecting: true, error: null, connectAction: null, pendingConnect: null });
      try {
        const preview = await githubConnectPreview(repoUrl, pat, vaultPath);
        if (preview.case === 'remote_empty') {
          await applyConnect({ repoUrl, pat, vaultPath, preview }, 'sync');
          return;
        }
        // Remote already has notes: the user decides before anything changes.
        set({ connecting: false, pendingConnect: { repoUrl, pat, vaultPath, preview } });
      } catch (e) {
        set({ connecting: false, error: errorText(e) });
      }
    },

    async confirmConnect(choice) {
      const pending = get().pendingConnect;
      if (!pending) return;
      set({ connecting: true, error: null, pendingConnect: null });
      try {
        await applyConnect(pending, choice);
      } catch (e) {
        set({ connecting: false, error: errorText(e) });
      }
    },

    cancelConnect() {
      set({ pendingConnect: null });
    },

    async disconnect() {
      set({ connecting: true, error: null });
      try {
        await githubDisconnect();
        set({
          config: { repoUrl: null, isConnected: false },
          status: { hasChanges: false },
          connectAction: null,
          connecting: false,
        });
      } catch (e) {
        set({
          connecting: false,
          error: typeof e === 'string' ? e : String(e),
        });
      }
    },

    applyFinished(payload) {
      set((s) => {
        const asked = payload.report?.needsConfirmation ?? null;
        return {
          state: payload,
          status: { hasChanges: payload.status.uncommitted || payload.status.ahead > 0 },
          // Connect-time conflict copies are not persisted backend-side: only
          // replace the list when the backend has some, never wipe it here
          // (dismissConflicts clears it explicitly).
          conflicts: payload.pendingConflicts.length > 0 ? payload.pendingConflicts : s.conflicts,
          // Keep the question while the deletion pause persists (the counts
          // only travel with the cycle report).
          pendingDeletion:
            asked ?? (payload.pausedReason === 'deletion' ? s.pendingDeletion : null),
          vaultChangeCount:
            (payload.report?.changedPaths.length ?? 0) > 0
              ? s.vaultChangeCount + 1
              : s.vaultChangeCount,
        };
      });
    },

    async loadState() {
      try {
        get().applyFinished(await syncGetState());
      } catch {
        // Not configured yet or backend not ready: keep what we have.
      }
    },

    async syncNow() {
      try {
        await syncTrigger('manual');
      } catch (e) {
        set({ error: errorText(e) });
      }
    },

    async confirmDeletion() {
      set({ pendingDeletion: null });
      try {
        await syncConfirmDeletions();
      } catch (e) {
        set({ error: errorText(e) });
      }
    },

    cancelDeletion() {
      set({ pendingDeletion: null });
    },

    async dismissConflicts() {
      set({ conflicts: [] });
      try {
        get().applyFinished(await syncDismissConflicts());
      } catch (e) {
        set({ error: errorText(e) });
      }
    },
    };
  },
);
