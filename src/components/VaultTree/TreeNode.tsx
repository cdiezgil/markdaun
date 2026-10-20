import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
} from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { useEditorStore } from '../../store/editorStore';
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
  /** Triggers a force-reindex of this folder and all its subfolders. */
  onReindexFolder?: (path: string) => void;
}

/** MIME type used to drag vault entries between tree nodes. */
export const ENTRY_MIME = 'application/x-markdaun-entry';

/** Label colour: unsupported file types read as disabled, the rest as ink. */
function getFileColor(fileType: VaultEntry['file_type']): string {
  return fileType === 'other' ? 'var(--ink-muted)' : 'var(--ink)';
}

/** Notes are shown without their `.md` extension. */
function displayName(entry: VaultEntry): string {
  return entry.kind === 'file' && entry.file_type === 'md'
    ? entry.name.replace(/\.md$/i, '')
    : entry.name;
}

function FileIcon({ fileType, active }: { fileType: VaultEntry['file_type']; active: boolean }) {
  const props = { size: 16, strokeWidth: 1.5, color: active ? 'var(--daun)' : 'var(--ink-muted)' };
  switch (fileType) {
    case 'md':
      return <FileText {...props} />;
    case 'image':
      return <Image {...props} />;
    default:
      return <File {...props} />;
  }
}

export function TreeNode({ entry, depth, onCreateNote, onCreateFolder, onReindexFolder }: TreeNodeProps) {
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
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const selectNoteLocation = useVaultStore((s) => s.selectNoteLocation);
  const isIndexing = useVaultStore((s) => s.isIndexing);
  const { navigateToFile } = useFileNavigation();

  const activeNotePath = useEditorStore((s) => s.activeNotePath);
  const isActive = entry.kind === 'file' && entry.file_type === 'md' && activeNotePath === entry.path;

  const paddingLeft = `calc(var(--space-2) + ${depth} * var(--space-4))`;
  const labelColor = isActive
    ? 'var(--daun)'
    : entry.kind === 'file'
      ? getFileColor(entry.file_type)
      : 'var(--ink)';

  function handleClick() {
    if (entry.kind === 'folder') {
      selectFolder(entry.path);
      setExpanded((v) => !v);
    } else {
      selectNoteLocation(entry.path);
      navigateToFile(entry);
    }
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData(ENTRY_MIME, entry.path);
    e.dataTransfer.effectAllowed = 'copyMove';
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
          gap: 6,
          height: 32,
          boxSizing: 'border-box',
          marginInline: 'var(--space-2)',
          paddingLeft,
          paddingRight: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-sans)',
          cursor: entry.kind === 'file' && entry.file_type === 'other' ? 'default' : 'pointer',
          userSelect: 'none',
          background: dropActive ? 'var(--mark)' : isActive ? 'var(--bg)' : undefined,
          outline: dropActive ? '1px dashed var(--daun)' : undefined,
        }}
        className={isActive ? undefined : 'md-hover'}
        data-testid={`tree-node-${entry.name}`}
        data-file-type={entry.file_type}
      >
        <span style={{ width: 14, height: 14, flexShrink: 0, display: 'inline-flex' }}>
          {entry.kind === 'folder' &&
            (expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} color="var(--ink-muted)" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} color="var(--ink-muted)" />
            ))}
        </span>
        {entry.kind === 'folder' ? (
          expanded ? (
            <FolderOpen size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          ) : (
            <Folder size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          )
        ) : (
          <FileIcon fileType={entry.file_type} active={isActive} />
        )}
        <span
          style={{
            fontSize: 14,
            lineHeight: '20px',
            color: labelColor,
            fontWeight: isActive ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid={`tree-node-name-${entry.name}`}
        >
          {displayName(entry)}
        </span>
      </div>

      {entry.kind === 'folder' && expanded && entry.children?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onCreateNote={onCreateNote}
          onCreateFolder={onCreateFolder}
          onReindexFolder={onReindexFolder}
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
          {entry.kind === 'folder' && onReindexFolder && (
            <button
              disabled={isIndexing}
              onClick={() => {
                closeContextMenu();
                onReindexFolder(entry.path);
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
                cursor: isIndexing ? 'not-allowed' : 'pointer',
                opacity: isIndexing ? 0.5 : 1,
              }}
              data-testid="context-reindex-folder"
            >
              Reindexar carpeta
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
