import React, { useState } from 'react';
import { FilePlus, FolderPlus, Settings } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SyncPanel } from '../Sync/SyncPanel';
import { useVaultStore } from '../../store/vaultStore';
import { VaultEmpty } from './VaultEmpty';
import { TreeNode, ENTRY_MIME } from './TreeNode';
import { NameDialog } from './NameDialog';
import { countVaultEntries, formatVaultCounts } from '../../lib/vaultCounts';

const ICON_BUTTON: React.CSSProperties = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink-muted)',
  cursor: 'pointer',
  padding: 0,
};

type CreateDialog = { parentPath: string } | null;

export function VaultTree() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const createUntitledNote = useVaultStore((s) => s.createUntitledNote);
  const navigate = useNavigate();
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
    await createFolder(dialog.parentPath, name);
    setDialog(null);
  }

  /** Notes are created as "Sin título" without asking; the H1 names them later. */
  async function newNote(parentPath?: string) {
    try {
      const path = await createUntitledNote(parentPath);
      navigate(`/editor/${encodeURIComponent(path)}`);
    } catch (e) {
      console.error('create note failed:', e);
    }
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
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
    const files = hasFiles ? Array.from(e.dataTransfer.files ?? []) : [];
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const contents = new Uint8Array(await file.arrayBuffer());
        await importFileData(vaultPath, file.name, contents);
      }
    }
  }

  const counts = formatVaultCounts(countVaultEntries(tree));

  return (
    <div
      style={{
        width: '100%',
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
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-1) var(--space-2) var(--space-4)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            lineHeight: '16px',
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--ink-muted)',
          }}
        >
          Bóveda
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => void newNote()}
            title="Nueva nota"
            aria-label="Nueva nota"
            data-testid="new-note-btn"
            className="md-hover"
            style={ICON_BUTTON}
          >
            <FilePlus size={18} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setDialog({ parentPath: useVaultStore.getState().selectedFolder ?? vaultPath })}
            title="Nueva carpeta"
            aria-label="Nueva carpeta"
            data-testid="new-folder-btn"
            className="md-hover"
            style={ICON_BUTTON}
          >
            <FolderPlus size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div
        onDragOver={handleRootDragOver}
        onDragLeave={() => setRootDropActive(false)}
        onDrop={handleRootDrop}
        style={{
          overflowY: 'auto',
          flex: 1,
          padding: '0 0 var(--space-2)',
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
            onCreateNote={(parentPath) => void newNote(parentPath)}
            onCreateFolder={(parentPath) => setDialog({ parentPath })}
          />
        ))}
      </div>
      <NameDialog
        open={dialog !== null}
        title="Nueva carpeta"
        onSubmit={submitDialog}
        onCancel={() => setDialog(null)}
      />
      <SyncPanel />
      <div
        data-testid="vault-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0 var(--space-2)',
          padding: 'var(--space-2) var(--space-1) var(--space-2) var(--space-2)',
          borderTop: '1px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            lineHeight: '16px',
            color: 'var(--ink-muted)',
          }}
        >
          {counts}
        </span>
        <Link
          to="/settings"
          title="Ajustes"
          aria-label="Ajustes"
          data-testid="settings-link"
          className="md-hover"
          style={ICON_BUTTON}
        >
          <Settings size={18} strokeWidth={1.5} />
        </Link>
      </div>
    </div>
  );
}
