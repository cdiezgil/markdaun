import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// Node >= 22 exposes an experimental `localStorage` global that shadows jsdom's (and warns or is
// unusable without --localstorage-file). Always install a plain in-memory Storage, without reading
// the original global.
{
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
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}
