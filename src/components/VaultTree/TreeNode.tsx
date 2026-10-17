import React, { useState } from 'react';
import {
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
} from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { useFileNavigation } from '../../hooks/useFileNavigation';
import type { VaultEntry } from '../../store/vaultStore';
import { RenameInput } from './RenameInput';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';

interface TreeNodeProps {
  entry: VaultEntry;
  depth: number;
  /** Opens the new-note dialog with this folder as parent. */
  onCreateNote?: (parentPath: string) => void;
  /** Opens the new-folder dialog with this folder as parent. */
  onCreateFolder?: (parentPath: string) => void;
}

/** MIME type used to drag vault entries between tree nodes. */
export const ENTRY_MIME = 'application/x-markdaun-entry';

function getFileColor(fileType: VaultEntry['file_type']): string {
  switch (fileType) {
    case 'md':
      return 'var(--daun)';
    case 'image':
    case 'pdf':
      return 'var(--ink)';
    default:
      return 'var(--ink-muted)';
  }
}

function FileIcon({ fileType }: { fileType: VaultEntry['file_type'] }) {
  const color = getFileColor(fileType);
  switch (fileType) {
    case 'md':
      return <FileText size={20} strokeWidth={1.5} color={color} />;
    case 'image':
      return <Image size={20} strokeWidth={1.5} color={color} />;
    case 'pdf':
    case 'other':
    default:
      return <File size={20} strokeWidth={1.5} color={color} />;
  }
}

export function TreeNode({ entry, depth, onCreateNote, onCreateFolder }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const deleteEntry = useVaultStore((s) => s.deleteEntry);
  const moveEntry = useVaultStore((s) => s.moveEntry);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const { navigateToFile } = useFileNavigation();

  const paddingLeft = `calc(${depth} * var(--space-4))`;
  const fileColor = entry.kind === 'file' ? getFileColor(entry.file_type) : 'var(--ink-muted)';

  function handleClick() {
    if (entry.kind === 'folder') {
      setExpanded((v) => !v);
    } else {
      navigateToFile(entry);
    }
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData(ENTRY_MIME, entry.path);
    e.dataTransfer.effectAllowed = 'move';
  }

  function hasEntryPayload(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(ENTRY_MIME);
  }

  function handleDragOver(e: React.DragEvent) {
    if (entry.kind !== 'folder' || !hasEntryPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropActive(true);
  }

  function handleDragLeave() {
    setDropActive(false);
  }

  async function handleDrop(e: React.DragEvent) {
    setDropActive(false);
    if (entry.kind !== 'folder') return;
    const sourcePath = e.dataTransfer.getData(ENTRY_MIME);
    if (!sourcePath || sourcePath === entry.path) return;
    e.preventDefault();
    await moveEntry(sourcePath, entry.path);
    setExpanded(true);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    setRenaming(true);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setContextMenuPos(null);
  }

  async function handleDeleteConfirm() {
    setShowDeleteDialog(false);
    await deleteEntry(entry.path);
    await refreshTree();
  }

  if (renaming) {
    return (
      <div style={{ paddingLeft }}>
        <RenameInput entry={entry} onDone={() => setRenaming(false)} />
      </div>
    );
  }

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        draggable
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          paddingLeft,
          paddingTop: 'var(--space-1)',
          paddingBottom: 'var(--space-1)',
          cursor: entry.kind === 'file' && entry.file_type === 'other' ? 'default' : 'pointer',
          userSelect: 'none',
          background: dropActive ? 'var(--mark)' : undefined,
          outline: dropActive ? '1px dashed var(--daun)' : undefined,
        }}
        data-testid={`tree-node-${entry.name}`}
        data-file-type={entry.file_type}
      >
        {entry.kind === 'folder' ? (
          expanded ? (
            <FolderOpen size={20} strokeWidth={1.5} color="var(--ink-muted)" />
          ) : (
            <Folder size={20} strokeWidth={1.5} color="var(--ink-muted)" />
          )
        ) : (
          <FileIcon fileType={entry.file_type} />
        )}
        <span
          style={{ fontSize: 14, color: fileColor }}
          data-testid={`tree-node-name-${entry.name}`}
        >
          {entry.name}
        </span>
      </div>

      {entry.kind === 'folder' && expanded && entry.children?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onCreateNote={onCreateNote}
          onCreateFolder={onCreateFolder}
        />
      ))}

      {contextMenuPos && (
        <div
          style={{
            position: 'fixed',
            top: contextMenuPos.y,
            left: contextMenuPos.x,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-pop)',
            zIndex: 100,
            minWidth: 140,
          }}
          data-testid="context-menu"
          onMouseLeave={closeContextMenu}
        >
          {entry.kind === 'folder' && onCreateNote && (
            <button
              onClick={() => {
                closeContextMenu();
                onCreateNote(entry.path);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 14,
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              data-testid="context-new-note"
            >
              Nueva nota
            </button>
          )}
          {entry.kind === 'folder' && onCreateFolder && (
            <button
              onClick={() => {
                closeContextMenu();
                onCreateFolder(entry.path);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 14,
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              data-testid="context-new-folder"
            >
              Nueva carpeta
            </button>
          )}
          <button
            onClick={() => {
              closeContextMenu();
              setRenaming(true);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 14,
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
            data-testid="context-rename"
          >
            Renombrar
          </button>
          <button
            onClick={() => {
              closeContextMenu();
              setShowDeleteDialog(true);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 14,
              color: 'var(--danger)',
              cursor: 'pointer',
            }}
            data-testid="context-delete"
          >
            Eliminar
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteDialog}
        title={`Eliminar ${entry.kind === 'folder' ? 'carpeta' : 'fichero'}`}
        message={`¿Seguro que quieres eliminar "${entry.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  );
}
