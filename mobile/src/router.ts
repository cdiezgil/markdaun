import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'note'; path: string; q: string }
  | { name: 'folders'; path: string }
  | { name: 'settings' }
  | { name: 'setup' }
  | { name: 'record' };

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart, query = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  if (segs[0] === 'note' && segs.length > 1) {
    const q = new URLSearchParams(query).get('q') ?? '';
    return { name: 'note', path: segs.slice(1).map(dec).join('/'), q };
  }
  if (segs[0] === 'folders') return { name: 'folders', path: segs.slice(1).map(dec).join('/') };
  if (segs[0] === 'settings') return { name: 'settings' };
  if (segs[0] === 'setup') return { name: 'setup' };
  if (segs[0] === 'record') return { name: 'record' };
  return { name: 'home' };
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
export const noteHref = (path: string, q = '') => `#/note/${enc(path)}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
export const folderHref = (path: string) => (path ? `#/folders/${enc(path)}` : '#/');

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseHash(hash);
}
