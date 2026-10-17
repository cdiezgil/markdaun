import React, { useState } from 'react';
import { FilePlus, FolderPlus, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SyncPanel } from '../Sync/SyncPanel';
import { useVaultStore } from '../../store/vaultStore';
import { VaultEmpty } from './VaultEmpty';
import { TreeNode, ENTRY_MIME } from './TreeNode';
import { NameDialog } from './NameDialog';

type CreateDialog = { type: 'note' | 'folder'; parentPath: string } | null;

export function VaultTree() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const createNote = useVaultStore((s) => s.createNote);
  const createFolder = useVaultStore((s) => s.createFolder);
  const moveEntry = useVaultStore((s) => s.moveEntry);
  const importFileData = useVaultStore((s) => s.importFileData);

  const [dialog, setDialog] = useState<CreateDialog>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  if (!vaultPath) {
    return <VaultEmpty />;
  }

  async function submitDialog(name: string) {
    if (!dialog) return;
    if (dialog.type === 'note') {
      await createNote(dialog.parentPath, name);
    } else {
      await createFolder(dialog.parentPath, name);
    }
    setDialog(null);
  }

  function hasEntryPayload(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(ENTRY_MIME);
  }

  function handleRootDragOver(e: React.DragEvent) {
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
    if (!hasEntryPayload(e) && !hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasEntryPayload(e) ? 'move' : 'copy';
    setRootDropActive(true);
  }

  async function handleRootDrop(e: React.DragEvent) {
    setRootDropActive(false);
    if (!vaultPath) return;

    // Internal moves take priority over external files.
    const sourcePath = e.dataTransfer.getData(ENTRY_MIME);
    if (sourcePath && sourcePath !== vaultPath) {
      e.preventDefault();
      await moveEntry(sourcePath, vaultPath);
      return;
    }

    // External files dropped from the OS: import bytes into the vault root.
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const contents = new Uint8Array(await file.arrayBuffer());
        await importFileData(vaultPath, file.name, contents);
      }
    }
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
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Settings icon — left side */}
        <Link
          to="/settings"
          title="Ajustes"
          data-testid="settings-link"
          style={{
            color: 'var(--ink-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Settings size={20} strokeWidth={1.5} />
        </Link>
        {/* Spacer */}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setDialog({ type: 'note', parentPath: vaultPath })}
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
          onClick={() => setDialog({ type: 'folder', parentPath: vaultPath })}
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
      <div
        onDragOver={handleRootDragOver}
        onDragLeave={() => setRootDropActive(false)}
        onDrop={handleRootDrop}
        style={{
          overflowY: 'auto',
          flex: 1,
          padding: 'var(--space-2) 0',
          background: rootDropActive ? 'var(--mark)' : undefined,
          outline: rootDropActive ? '1px dashed var(--daun)' : undefined,
          outlineOffset: -2,
        }}
        data-testid="vault-tree-scroll"
      >
        {tree.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            onCreateNote={(parentPath) => setDialog({ type: 'note', parentPath })}
            onCreateFolder={(parentPath) => setDialog({ type: 'folder', parentPath })}
          />
        ))}
      </div>
      <NameDialog
        open={dialog !== null}
        title={dialog?.type === 'folder' ? 'Nueva carpeta' : 'Nueva nota'}
        hint={dialog?.type === 'note' ? 'Se añadirá la extensión .md automáticamente.' : undefined}
        onSubmit={submitDialog}
        onCancel={() => setDialog(null)}
      />
      <SyncPanel />
    </div>
  );
}
