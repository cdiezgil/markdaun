import { describe, it, expect } from 'vitest';
import { findInTree, createWikilinkExtension } from './WikilinkExtension';
import type { VaultEntry } from '../../../lib/tauri';

const TREE: VaultEntry[] = [
  {
    name: 'nota-b.md',
    path: '/vault/nota-b.md',
    kind: 'file',
    file_type: 'md',
    children: null,
  },
  {
    name: 'sub',
    path: '/vault/sub',
    kind: 'folder',
    file_type: null,
    children: [
      {
        name: 'nested.md',
        path: '/vault/sub/nested.md',
        kind: 'file',
        file_type: 'md',
        children: null,
      },
    ],
  },
];

// ── TC-11: wikilink for existing note ─────────────────────────────────────────
describe('TC-11: findInTree — existing note', () => {
  it('TC-11: returns entry when note exists at root level', () => {
    const result = findInTree(TREE, 'nota-b');
    expect(result).not.toBeNull();
    expect(result?.path).toBe('/vault/nota-b.md');
  });

  it('TC-11: returns entry when note exists in a nested folder', () => {
    const result = findInTree(TREE, 'nested');
    expect(result).not.toBeNull();
    expect(result?.path).toBe('/vault/sub/nested.md');
  });
});

// ── TC-12: wikilink for non-existing note ─────────────────────────────────────
describe('TC-12: findInTree — missing note', () => {
  it('TC-12: returns null when note does not exist in vault', () => {
    const result = findInTree(TREE, 'inexistente');
    expect(result).toBeNull();
  });

  it('TC-12: returns null for empty tree', () => {
    expect(findInTree([], 'any')).toBeNull();
  });
});

// ── Extension creation ────────────────────────────────────────────────────────
describe('createWikilinkExtension', () => {
  it('returns a TipTap extension with name "wikilink"', () => {
    const ext = createWikilinkExtension(TREE);
    expect(ext.name).toBe('wikilink');
  });

  it('extension has atom attribute set to true', () => {
    const ext = createWikilinkExtension(TREE);
    expect(ext.config.atom).toBe(true);
  });

  it('TC-11: existing note → exists attr is true via findInTree', () => {
    const entry = findInTree(TREE, 'nota-b');
    expect(entry).not.toBeNull();
    // exists = findInTree(...) !== null → true
    expect(entry !== null).toBe(true);
  });

  it('TC-12: missing note → exists attr is false via findInTree', () => {
    const entry = findInTree(TREE, 'inexistente');
    expect(entry).toBeNull();
    // exists = findInTree(...) !== null → false
    expect(entry !== null).toBe(false);
  });
});
