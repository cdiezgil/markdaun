import { create, UseBoundStore, StoreApi } from 'zustand';
import {
  githubConfigure,
  githubGetConfig,
  githubDisconnect,
  githubPush,
  githubPull,
  githubStatus,
} from '../lib/tauri';

export interface SyncConfig {
  repoUrl: string | null;
  isConnected: boolean;
}

export interface SyncStatus {
  hasChanges: boolean;
}

interface SyncState {
  config: SyncConfig;
  status: SyncStatus;
  isLoading: boolean;
  error: string | null;
  connectAction: 'pushed' | 'cloned' | null;

  loadConfig(): Promise<void>;
  connect(repoUrl: string, pat: string, vaultPath: string): Promise<void>;
  disconnect(): Promise<void>;
  push(vaultPath: string): Promise<void>;
  pull(vaultPath: string): Promise<void>;
  checkStatus(vaultPath: string): Promise<void>;
}

export const useSyncStore: UseBoundStore<StoreApi<SyncState>> = create<SyncState>(
  (set, get) => ({
    config: { repoUrl: null, isConnected: false },
    status: { hasChanges: false },
    isLoading: false,
    error: null,
    connectAction: null,

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
      set({ isLoading: true, error: null, connectAction: null });
      try {
        const action = await githubConfigure(repoUrl, pat, vaultPath);
        set({
          config: { repoUrl, isConnected: true },
          connectAction: action,
          isLoading: false,
        });
        await get().checkStatus(vaultPath);
      } catch (e) {
        set({
          isLoading: false,
          error: typeof e === 'string' ? e : String(e),
        });
      }
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

    async push(vaultPath) {
      set({ isLoading: true, error: null });
      try {
        await githubPush();
        set({ isLoading: false });
        await get().checkStatus(vaultPath);
      } catch (e) {
        set({
          isLoading: false,
          error: typeof e === 'string' ? e : String(e),
        });
      }
    },

    async pull(vaultPath) {
      set({ isLoading: true, error: null });
      try {
        await githubPull();
        set({ isLoading: false });
        await get().checkStatus(vaultPath);
      } catch (e) {
        set({
          isLoading: false,
          error: typeof e === 'string' ? e : String(e),
        });
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
  }),
);
