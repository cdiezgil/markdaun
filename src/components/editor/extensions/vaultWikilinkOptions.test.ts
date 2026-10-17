import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../../../store/editorStore';
import { vaultStoreWikilinkOptions } from './vaultWikilinkOptions';
import type { VaultEntry } from '../../../lib/tauri';

const entry: VaultEntry = { name: 'a.md', path: '/v/a.md', kind: 'file', file_type: 'md', children: null };

beforeEach(() => useEditorStore.setState({ vaultTree: [] }));

describe('vaultStoreWikilinkOptions', () => {
  it('reads the live tree and notifies only when the tree changes', () => {
    const listener = vi.fn();
    const off = vaultStoreWikilinkOptions.subscribe!(listener);
    useEditorStore.setState({ activeNoteContent: 'x' });
    expect(listener).not.toHaveBeenCalled();
    useEditorStore.setState({ vaultTree: [entry] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(vaultStoreWikilinkOptions.getVaultTree()).toEqual([entry]);
    off();
    useEditorStore.setState({ vaultTree: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('opens the note through the store', () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({ openNote });
    vaultStoreWikilinkOptions.onOpen!(entry);
    expect(openNote).toHaveBeenCalledWith('/v/a.md');
  });
});
