import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// Node >= 22 exposes an experimental `localStorage` global that shadows jsdom's (and is
// undefined without --localstorage-file). Provide a plain in-memory Storage when missing.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.clear !== 'function') {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
