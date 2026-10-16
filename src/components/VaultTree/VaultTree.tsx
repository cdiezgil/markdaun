import React, { useEffect } from 'react';
import { FilePlus, FolderPlus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVaultStore } from '../../store/vaultStore';
import { VaultEmpty } from './VaultEmpty';
import { TreeNode } from './TreeNode';

export function VaultTree() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const createNote = useVaultStore((s) => s.createNote);
  const createFolder = useVaultStore((s) => s.createFolder);
  const importFiles = useVaultStore((s) => s.importFiles);
  const refreshTree = useVaultStore((s) => s.refreshTree);

  useEffect(() => {
    if (!vaultPath) return;

    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths as string[];
          // importFiles ya llama refreshTree internamente
          importFiles(vaultPath, paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [vaultPath, importFiles, refreshTree]);

  if (!vaultPath) {
    return <VaultEmpty />;
  }

  async function handleNewNote() {
    if (!vaultPath) return;
    const name = `nota-${Date.now()}`;
    await createNote(vaultPath, name);
  }

  async function handleNewFolder() {
    if (!vaultPath) return;
    const name = `carpeta-${Date.now()}`;
    await createFolder(vaultPath, name);
  }

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--surface-sunken)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      data-testid="vault-tree"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <button
          onClick={handleNewNote}
          title="Nueva nota"
          data-testid="new-note-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <FilePlus size={20} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleNewFolder}
          title="Nueva carpeta"
          data-testid="new-folder-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <FolderPlus size={20} strokeWidth={1.5} />
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-2) 0' }}>
        {tree.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  );
}
