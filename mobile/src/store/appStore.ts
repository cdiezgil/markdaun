import { create } from 'zustand';
import { deleteDB } from 'idb';
import { createClient, type GitHubClient, type RepoRef } from '../github/client';
import { AppError } from '../github/errors';
import { buildIndex, type SearchIndex } from '../notes/search';
import { isHidden } from '../notes/resolve';
import { deviceName, drainQueue, pendingCount } from '../capture/queue';
import { refresh } from '../sync/refresh';
import { openDb, TREE_KEY, type Db } from './db';

export const DB_NAME = 'markdaun';
export const THEME_KEY = 'markdaun:theme';
const CONFIG_KEY = 'config';

export interface Config extends RepoRef {
  token: string;
}
export type Theme = 'system' | 'light' | 'dark';
export type Status = 'idle' | 'refreshing' | 'offline' | 'error';

interface AppState {
  ready: boolean;
  db: Db | null;
  config: Config | null;
  status: Status;
  lastRefresh: number | null;
  error?: AppError;
  pending: number;
  notice?: string;
  theme: Theme;
  index: SearchIndex;
  mdPaths: string[];
  allPaths: string[];
  init(): Promise<void>;
  /** Resolves to a user-facing error message, or null on success. */
  connect(ref: RepoRef, token: string): Promise<string | null>;
  refreshNow(): Promise<void>;
  drain(): Promise<void>;
  signOut(): Promise<void>;
  setTheme(theme: Theme): void;
  setNotice(notice?: string): void;
  recount(): Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** User-facing Spanish message for an error. */
export function errorMessage(e: AppError): string {
  switch (e.kind) {
    case 'Unauthorized':
      return 'Token no válido o caducado';
    case 'Forbidden':
      return 'El token no puede escribir en el repositorio';
    case 'NotFound':
      return 'No encuentro el repositorio o la rama';
    case 'RateLimited': {
      if (!e.resetAt) return 'Límite de GitHub alcanzado; vuelve a intentarlo más tarde';
      const d = new Date(e.resetAt);
      return `Límite de GitHub alcanzado; vuelve a intentarlo a las ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    case 'Offline':
      return 'Sin conexión';
    case 'TooLarge':
      return 'El archivo es demasiado grande';
    default:
      return 'Algo ha fallado; vuelve a intentarlo';
  }
}

/** Spanish relative time: "hace un momento", "hace 5 min", "hace 3 h", "hace 2 días". */
export function relativeTime(then: number, now = Date.now()): string {
  const min = Math.floor(Math.max(0, now - then) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function asAppError(e: unknown): AppError {
  return e instanceof AppError ? e : new AppError('Unknown', e instanceof Error ? e.message : String(e));
}

function pathsOf(entries: { path: string; type: string }[]) {
  const allPaths = entries.filter((e) => e.type === 'blob' && !isHidden(e.path)).map((e) => e.path);
  return { allPaths, mdPaths: allPaths.filter((p) => /\.md$/i.test(p)) };
}

const clientFor = (c: Config): GitHubClient =>
  createClient(c.token, { owner: c.owner, repo: c.repo, branch: c.branch });

// Bumped whenever the connected repository changes or the user signs out; results of
// work started under an older generation are discarded.
let generation = 0;
let refreshing: { gen: number; run: Promise<void> } | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const NOTICE_MS = 4000;

let dbPromise: Promise<Db> | null = null;
function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = openDb(DB_NAME);
  return dbPromise;
}

const initial = () => ({
  ready: false,
  db: null as Db | null,
  config: null as Config | null,
  status: 'idle' as Status,
  lastRefresh: null as number | null,
  error: undefined as AppError | undefined,
  pending: 0,
  notice: undefined as string | undefined,
  index: buildIndex([]),
  mdPaths: [] as string[],
  allPaths: [] as string[],
});

export const useApp = create<AppState>((set, get) => {
  async function loadLocal(db: Db): Promise<void> {
    const [notes, tree, last] = await Promise.all([
      db.getAll('notes'),
      db.get('tree', TREE_KEY),
      db.get('meta', 'lastRefresh'),
    ]);
    set({
      index: buildIndex(notes),
      lastRefresh: typeof last === 'number' ? last : null,
      ...pathsOf(tree?.entries ?? []),
    });
  }

  return {
    ...initial(),
    theme: readTheme(),

    async init() {
      applyTheme(get().theme);
      const db = await getDb();
      const config = ((await db.get('meta', CONFIG_KEY)) as Config | undefined) ?? null;
      set({ db, config, pending: await pendingCount(db) });
      if (config) await loadLocal(db);
      set({ ready: true });
      if (config) {
        await get().refreshNow();
        await get().drain();
      }
    },

    async connect(ref, token) {
      const db = get().db ?? (await getDb());
      const prev = get().config;
      const changed = !prev || prev.owner !== ref.owner || prev.repo !== ref.repo || prev.branch !== ref.branch;
      if (prev && changed) {
        // Queued recordings carry no repository: switching now would upload them to the wrong one.
        const n = await pendingCount(db);
        if (n > 0) {
          return `Hay ${n} ${n === 1 ? 'nota de voz pendiente' : 'notas de voz pendientes'} de subir al repositorio actual. Espera a que se suban antes de cambiar.`;
        }
      }
      try {
        await createClient(token, ref).checkAccess();
      } catch (e) {
        return errorMessage(asAppError(e));
      }
      if (changed) {
        // Let an in-flight refresh of the old repository land (or fail) before wiping.
        // Its results are discarded (generation bump) but its db writes must finish first.
        generation++;
        await refreshing?.run.catch(() => undefined);
        // Notes of another repository must not linger next to the new one.
        for (const s of ['notes', 'tree', 'images'] as const) await db.clear(s);
        await db.delete('meta', 'lastRefresh');
        set({ index: buildIndex([]), mdPaths: [], allPaths: [], lastRefresh: null });
      }
      generation++;
      const config: Config = { ...ref, token };
      await db.put('meta', config, CONFIG_KEY);
      set({ db, config, ready: true, error: undefined, status: 'idle' });
      void get()
        .refreshNow()
        .then(() => get().drain());
      return null;
    },

    async refreshNow() {
      const { config, db } = get();
      if (!config || !db || refreshing?.gen === generation) return;
      const gen = generation;
      set({ status: 'refreshing', error: undefined });
      const run = (async () => {
        try {
          const result = await refresh(clientFor(config), db);
          if (gen !== generation) return;
          if (!result.skipped) await loadLocal(db);
          else set({ lastRefresh: Date.now() });
          if (gen === generation) set({ status: 'idle' });
        } catch (e) {
          // Local notes stay untouched on any failure.
          if (gen !== generation) return;
          const err = asAppError(e);
          set({ status: err.kind === 'Offline' ? 'offline' : 'error', error: err.kind === 'Offline' ? undefined : err });
        }
      })();
      refreshing = { gen, run };
      try {
        await run;
      } finally {
        if (refreshing?.run === run) refreshing = null;
      }
    },

    async drain() {
      const { config, db } = get();
      if (!config || !db) return;
      const gen = generation;
      try {
        const { lastError } = await drainQueue(db, clientFor(config), deviceName(navigator.userAgent));
        if (gen !== generation) return;
        set({ pending: await pendingCount(db) });
        if (!lastError) return;
        if (lastError.kind === 'Offline') set({ status: 'offline' });
        else set({ status: 'error', error: lastError });
      } catch (e) {
        // A closed database (sign-out) or any other failure must never surface as unhandled.
        if (gen === generation) set({ status: 'error', error: asAppError(e) });
      }
    },

    async recount() {
      const db = get().db;
      if (db) set({ pending: await pendingCount(db) });
    },

    async signOut() {
      const db = get().db;
      generation++;
      db?.close();
      dbPromise = null;
      await deleteDB(DB_NAME);
      set({ ...initial(), ready: true });
    },

    setTheme(theme) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* storage may be unavailable; the theme still applies for this session */
      }
      applyTheme(theme);
      set({ theme });
    },

    setNotice(notice) {
      clearTimeout(noticeTimer);
      set({ notice });
      if (notice) noticeTimer = setTimeout(() => set({ notice: undefined }), NOTICE_MS);
    },
  };
});

/** Test hook: forget the cached database handle. */
export function resetAppForTests(): void {
  dbPromise = null;
  refreshing = null;
  clearTimeout(noticeTimer);
  useApp.setState({ ...initial(), theme: readTheme() });
}
