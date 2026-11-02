import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../github/errors';
import { errorMessage, relativeTime, useApp } from './appStore';
import { resetPersistenceRequest } from '../capture/queue';
import { parseHash, noteHref, folderHref } from '../router';
import { listFolder } from '../views/Folders';

describe('errorMessage', () => {
  it.each([
    ['Unauthorized', 'Token no válido o caducado'],
    ['Forbidden', 'El token no puede escribir en el repositorio'],
    ['NotFound', 'No encuentro el repositorio o la rama'],
    ['Offline', 'Sin conexión'],
    ['TooLarge', 'El archivo es demasiado grande'],
    ['Unknown', 'Algo ha fallado; vuelve a intentarlo'],
  ] as const)('%s', (kind, text) => {
    expect(errorMessage(new AppError(kind))).toBe(text);
  });

  it('formats the rate limit reset time as HH:mm', () => {
    const at = new Date(2026, 10, 2, 9, 5).getTime();
    expect(errorMessage(new AppError('RateLimited', undefined, { resetAt: at }))).toBe(
      'Límite de GitHub alcanzado; vuelve a intentarlo a las 09:05',
    );
    expect(errorMessage(new AppError('RateLimited'))).toContain('más tarde');
  });
});

describe('relativeTime', () => {
  const now = 10_000_000_000;
  it.each([
    [0, 'hace un momento'],
    [5 * 60_000, 'hace 5 min'],
    [3 * 3_600_000, 'hace 3 h'],
    [24 * 3_600_000, 'hace 1 día'],
    [3 * 24 * 3_600_000, 'hace 3 días'],
  ])('%i ms ago', (ago, text) => {
    expect(relativeTime(now - ago, now)).toBe(text);
  });
});

describe('router', () => {
  it('parses every route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/note/a%20b/c.md?q=hola')).toEqual({ name: 'note', path: 'a b/c.md', q: 'hola' });
    expect(parseHash('#/note/x.md')).toEqual({ name: 'note', path: 'x.md', q: '' });
    expect(parseHash('#/folders/A/B')).toEqual({ name: 'folders', path: 'A/B' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/setup')).toEqual({ name: 'setup' });
    expect(parseHash('#/record')).toEqual({ name: 'record' });
    expect(parseHash('#/note/%E0%A4%A')).toMatchObject({ name: 'note' });
  });
  it('round-trips hrefs', () => {
    expect(parseHash(noteHref('Café/ñ.md', 'a&b'))).toEqual({ name: 'note', path: 'Café/ñ.md', q: 'a&b' });
    expect(folderHref('')).toBe('#/');
    expect(parseHash(folderHref('A b'))).toEqual({ name: 'folders', path: 'A b' });
  });
});

describe('listFolder', () => {
  it('sorts folders first, then notes, with the es locale and hides dot paths', () => {
    const paths = ['b.md', 'Á.md', 'z/n.md', 'a/n.md', '.git/x.md', 'a/.h/y.md', 'img.png', 'a/sub/q.md'];
    expect(listFolder(paths, '')).toEqual({ folders: ['a', 'z'], notes: ['Á.md', 'b.md'] });
    expect(listFolder(paths, 'a')).toEqual({ folders: ['sub'], notes: ['n.md'] });
  });
});

describe('init', () => {
  it('requests persistent storage', async () => {
    resetPersistenceRequest();
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', {
      value: { persist, persisted: async () => false },
      configurable: true,
    });
    await useApp.getState().init();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(useApp.getState().ready).toBe(true);
  });

  it('still initialises without the Storage API', async () => {
    resetPersistenceRequest();
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    await useApp.getState().init();
    expect(useApp.getState().ready).toBe(true);
  });
});
