import React, { useState, useRef } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  FilePlus,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useIdeStore, idePickAndAddProject } from '../../store/ideStore';
import type { IdeProject } from '../../store/ideStore';
import type { VaultEntry } from '../../lib/tauri';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { fuzzyMatch } from '../../lib/fuzzy';

// ── Helpers ────────────────────────────────────────────────────────────────────

function displayName(entry: VaultEntry): string {
  return entry.kind === 'file' && entry.file_type === 'md'
    ? entry.name.replace(/\.md$/i, '')
    : entry.name;
}

function isMd(entry: VaultEntry): boolean {
  return entry.kind === 'file' && entry.file_type === 'md';
}

/**
 * Keep only branches that lead to .md files matching query.
 * Folders are preserved only if they contain (transitively) at least one match.
 */
function filterTree(entries: VaultEntry[], query: string): VaultEntry[] {
  const results: VaultEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'folder') {
      const filteredChildren = filterTree(entry.children ?? [], query);
      if (filteredChildren.length > 0) {
        results.push({ ...entry, children: filteredChildren });
      }
    } else if (isMd(entry) && fuzzyMatch(query, displayName(entry)) !== null) {
      results.push(entry);
    }
  }
  return results;
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const ICON_BUTTON: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--ink-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const MENU_BUTTON: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  padding: 'var(--space-2) var(--space-4)',
  fontSize: 14,
  color: 'var(--ink)',
  cursor: 'pointer',
};

// ── IdeRenameInput ─────────────────────────────────────────────────────────────

interface IdeRenameInputProps {
  entry: VaultEntry;
  onDone: () => void;
}

function IdeRenameInput({ entry, onDone }: IdeRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const newName = inputRef.current?.value.trim() ?? '';
    if (!newName || newName === entry.name) {
      onDone();
      return;
    }
    setError(null);
    try {
      await useIdeStore.getState().renameEntry(entry.path, newName);
      onDone();
    } catch (e) {
      const s = typeof e === 'string' ? e : String(e);
      if (s === 'already_exists') {
        setError('Ya existe un fichero con ese nombre.');
      } else {
        setError('Error al renombrar.');
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      onDone();
    }
  }

  return (
    <div style={{ padding: '0 var(--space-2)' }}>
      <input
        ref={inputRef}
        autoFocus
        defaultValue={entry.name}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit()}
        data-testid="ide-rename-input"
        style={{
          fontSize: 14,
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: '1px solid var(--daun)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px var(--space-2)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <span style={{ color: 'var(--danger)', fontSize: 12 }} data-testid="ide-rename-error">
          {error}
        </span>
      )}
    </div>
  );
}

// ── IdeTreeNode ────────────────────────────────────────────────────────────────

interface IdeTreeNodeProps {
  entry: VaultEntry;
  depth: number;
  /** Root path of the project that owns this entry — used to derive the project. */
  projectRoot: string;
  onCreateNote?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
}

function IdeTreeNode({
  entry,
  depth,
  projectRoot,
  onCreateNote,
  onCreateFolder,
}: IdeTreeNodeProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  const activeFilePath = useIdeStore((s) => s.activeFilePath);
  const isActive = isMd(entry) && activeFilePath === entry.path;
  const isDisabled = entry.kind === 'file' && entry.file_type !== 'md';

  const paddingLeft = `calc(var(--space-2) + ${depth} * var(--space-4))`;
  const labelColor = isActive
    ? 'var(--daun)'
    : isDisabled
      ? 'var(--ink-muted)'
      : 'var(--ink)';

  function handleClick() {
    if (entry.kind === 'folder') {
      setExpanded((v) => !v);
    } else if (!isDisabled) {
      void useIdeStore.getState().openFile(entry.path);
      navigate(`/ide/editor/${encodeURIComponent(entry.path)}`);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!isDisabled) setRenaming(true);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }

  async function handleDeleteConfirm() {
    setShowDeleteDialog(false);
    await useIdeStore.getState().deleteEntry(entry.path);
  }

  if (renaming) {
    return (
      <div style={{ paddingLeft, height: 32, display: 'flex', alignItems: 'center' }}>
        <IdeRenameInput entry={entry} onDone={() => setRenaming(false)} />
      </div>
    );
  }

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
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
          cursor: isDisabled ? 'default' : 'pointer',
          userSelect: 'none',
          background: isActive ? 'var(--bg)' : undefined,
        }}
        className={isActive || isDisabled ? undefined : 'md-hover'}
        data-testid={`ide-node-${entry.name}`}
        data-file-type={entry.file_type}
      >
        {/* Chevron */}
        <span style={{ width: 14, height: 14, flexShrink: 0, display: 'inline-flex' }}>
          {entry.kind === 'folder' &&
            (expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} color="var(--ink-muted)" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} color="var(--ink-muted)" />
            ))}
        </span>
        {/* Icon */}
        {entry.kind === 'folder' ? (
          expanded ? (
            <FolderOpen size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          ) : (
            <Folder size={16} strokeWidth={1.5} color="var(--ink-muted)" />
          )
        ) : isMd(entry) ? (
          <FileText
            size={16}
            strokeWidth={1.5}
            color={isActive ? 'var(--daun)' : 'var(--ink-muted)'}
          />
        ) : (
          <File size={16} strokeWidth={1.5} color="var(--ink-muted)" />
        )}
        {/* Label */}
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
          data-testid={`ide-node-name-${entry.name}`}
        >
          {displayName(entry)}
        </span>
      </div>

      {/* Children */}
      {entry.kind === 'folder' && expanded &&
        (entry.children ?? []).map((child) => (
          <IdeTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            projectRoot={projectRoot}
            onCreateNote={onCreateNote}
            onCreateFolder={onCreateFolder}
          />
        ))}

      {/* Context menu */}
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
            minWidth: 150,
          }}
          data-testid="ide-context-menu"
          onMouseLeave={() => setContextMenuPos(null)}
        >
          {entry.kind === 'folder' && onCreateNote && (
            <button
              onClick={() => {
                setContextMenuPos(null);
                onCreateNote(entry.path);
              }}
              style={MENU_BUTTON}
              data-testid="ide-context-new-note"
            >
              Nueva nota
            </button>
          )}
          {entry.kind === 'folder' && onCreateFolder && (
            <button
              onClick={() => {
                setContextMenuPos(null);
                onCreateFolder(entry.path);
              }}
              style={MENU_BUTTON}
              data-testid="ide-context-new-folder"
            >
              Nueva carpeta
            </button>
          )}
          {!isDisabled && (
            <button
              onClick={() => {
                setContextMenuPos(null);
                setRenaming(true);
              }}
              style={MENU_BUTTON}
              data-testid="ide-context-rename"
            >
              Renombrar
            </button>
          )}
          <button
            onClick={() => {
              setContextMenuPos(null);
              setShowDeleteDialog(true);
            }}
            style={{ ...MENU_BUTTON, color: 'var(--danger)' }}
            data-testid="ide-context-delete"
          >
            Eliminar
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteDialog}
        title={`Eliminar ${entry.kind === 'folder' ? 'carpeta' : 'fichero'}`}
        message={`¿Seguro que quieres eliminar "${entry.name}"? Esta acción no se puede deshacer.`}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  );
}

// ── IdeProjectHeader ───────────────────────────────────────────────────────────

interface IdeProjectHeaderProps {
  project: IdeProject;
  onCreateNote: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
}

function IdeProjectHeader({ project, onCreateNote, onCreateFolder }: IdeProjectHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  function handleMoreClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setMenuPos(null);
  }

  async function handleForget() {
    closeMenu();
    await useIdeStore.getState().removeProject(project.rootPath);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-3) var(--space-1) var(--space-4)',
        marginTop: 'var(--space-2)',
      }}
      data-testid={`ide-project-header-${project.name}`}
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
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {project.name}
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        <button
          onClick={() => onCreateNote(project.rootPath)}
          title="Nueva nota"
          aria-label="Nueva nota"
          className="md-hover"
          style={ICON_BUTTON}
          data-testid="ide-project-new-note"
        >
          <FilePlus size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => onCreateFolder(project.rootPath)}
          title="Nueva carpeta"
          aria-label="Nueva carpeta"
          className="md-hover"
          style={ICON_BUTTON}
          data-testid="ide-project-new-folder"
        >
          <FolderPlus size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleMoreClick}
          title="Opciones del proyecto"
          aria-label="Opciones del proyecto"
          className="md-hover"
          style={ICON_BUTTON}
          data-testid="ide-project-more"
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </button>
      </div>

      {menuOpen && menuPos && (
        <div
          style={{
            position: 'fixed',
            top: menuPos.y,
            left: menuPos.x,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-pop)',
            zIndex: 100,
            minWidth: 160,
          }}
          onMouseLeave={closeMenu}
          data-testid="ide-project-menu"
        >
          <button
            onClick={() => void handleForget()}
            style={{ ...MENU_BUTTON, color: 'var(--danger)' }}
            data-testid="ide-forget-folder"
          >
            Olvidar carpeta
          </button>
        </div>
      )}
    </div>
  );
}

// ── FilteredTreeNode ──────────────────────────────────────────────────────────
//
// Renders a single entry in search mode:
//   - Folders: always expanded (no toggle), muted — just structural context
//   - Files (.md, guaranteed by filterTree): clickable with fuzzy highlight

function FilteredTreeNode({
  entry,
  depth,
  query,
}: {
  entry: VaultEntry;
  depth: number;
  query: string;
}) {
  const navigate = useNavigate();
  const activeFilePath = useIdeStore((s) => s.activeFilePath);
  const paddingLeft = `calc(var(--space-2) + ${depth} * var(--space-4))`;

  if (entry.kind === 'folder') {
    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            paddingLeft,
            paddingRight: 'var(--space-2)',
            marginInline: 'var(--space-2)',
          }}
        >
          {/* Spacer mirrors the chevron width used in normal mode */}
          <span style={{ width: 14, flexShrink: 0 }} />
          <FolderOpen size={15} strokeWidth={1.5} color="var(--ink-muted)" />
          <span
            style={{
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-sans)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.name}
          </span>
        </div>
        {(entry.children ?? []).map((child) => (
          <FilteredTreeNode key={child.path} entry={child} depth={depth + 1} query={query} />
        ))}
      </>
    );
  }

  // .md file (guaranteed by filterTree)
  const isActive = activeFilePath === entry.path;
  const title = displayName(entry);
  const m = fuzzyMatch(query, title);
  const indices = new Set(m?.indices ?? []);

  function handleClick() {
    void useIdeStore.getState().openFile(entry.path);
    navigate(`/ide/editor/${encodeURIComponent(entry.path)}`);
  }

  return (
    <div
      onClick={handleClick}
      data-testid={`ide-search-result-${entry.name}`}
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
        cursor: 'pointer',
        background: isActive ? 'var(--bg)' : undefined,
      }}
      className={isActive ? undefined : 'md-hover'}
    >
      <span style={{ width: 14, flexShrink: 0 }} />
      <FileText
        size={16}
        strokeWidth={1.5}
        color={isActive ? 'var(--daun)' : 'var(--ink-muted)'}
      />
      <span
        style={{
          fontSize: 14,
          lineHeight: '20px',
          color: isActive ? 'var(--daun)' : 'var(--ink)',
          fontWeight: isActive ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title.split('').map((ch, i) =>
          indices.has(i) ? (
            <mark key={i} style={{ background: 'var(--mark)', color: 'inherit', padding: 0 }}>
              {ch}
            </mark>
          ) : (
            ch
          ),
        )}
      </span>
    </div>
  );
}

// ── IdeTree (root) ─────────────────────────────────────────────────────────────

/** TC-01 · TC-02 · TC-03 · TC-04 · TC-05 · TC-06 · TC-08 · TC-09 · TC-10 · TC-11 · TC-12 */
export function IdeTree() {
  const projects = useIdeStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  async function handleOpenFolder() {
    if (adding) return;
    setAdding(true);
    try {
      await idePickAndAddProject();
    } catch (e) {
      console.error('IDE open folder failed:', e);
    } finally {
      setAdding(false);
    }
  }

  async function handleCreateNote(parentPath: string) {
    const name = 'Sin título.md';
    try {
      const newPath = await useIdeStore.getState().createFile(parentPath, name);
      await useIdeStore.getState().openFile(newPath);
    } catch (e) {
      console.error('IDE create note failed:', e);
    }
  }

  async function handleCreateFolder(parentPath: string) {
    const folderName = prompt('Nombre de la carpeta:');
    if (!folderName) return;
    try {
      await useIdeStore.getState().createFolder(parentPath, folderName);
    } catch (e) {
      console.error('IDE create folder failed:', e);
    }
  }

  // Build filtered tree per project for search mode
  const trimmedQuery = query.trim();
  const filteredProjects = trimmedQuery !== ''
    ? projects
        .map((p) => ({ ...p, filtered: filterTree(p.tree, trimmedQuery) }))
        .filter((p) => p.filtered.length > 0)
    : [];

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
      data-testid="ide-tree"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-3) var(--space-2) var(--space-4)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--ink-muted)',
          }}
        >
          IDE
        </span>
        <button
          onClick={() => void handleOpenFolder()}
          disabled={adding}
          title="Abrir carpeta"
          aria-label="Abrir carpeta"
          className="md-hover"
          style={ICON_BUTTON}
          data-testid="ide-open-folder-btn"
        >
          <FolderPlus size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* Search */}
      <div
        style={{
          position: 'relative',
          margin: '0 var(--space-3) var(--space-2)',
          flexShrink: 0,
        }}
      >
        <Search
          size={14}
          strokeWidth={1.5}
          color="var(--ink-muted)"
          style={{
            position: 'absolute',
            left: 'var(--space-2)',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar fichero…"
          data-testid="ide-search-input"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            paddingLeft: 'var(--space-6)',
            paddingRight: 'var(--space-2)',
            height: 28,
            fontSize: 13,
            fontFamily: 'var(--font-sans)',
            color: 'var(--ink)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
          }}
        />
      </div>

      {/* Scrollable content */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '0 0 var(--space-2)' }}
        data-testid="ide-tree-scroll"
      >
        {trimmedQuery !== '' ? (
          filteredProjects.length > 0 ? (
            filteredProjects.map(({ rootPath, name, filtered }) => (
              <div key={rootPath} data-testid={`ide-search-project-${name}`}>
                {/* Project mini-header: disambiguates results across open projects */}
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-muted)',
                    padding: 'var(--space-3) var(--space-4) var(--space-1)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  {name}
                </div>
                {filtered.map((entry) => (
                  <FilteredTreeNode key={entry.path} entry={entry} depth={0} query={trimmedQuery} />
                ))}
              </div>
            ))
          ) : (
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-muted)',
                textAlign: 'center',
                marginTop: 'var(--space-4)',
                fontFamily: 'var(--font-sans)',
              }}
              data-testid="ide-search-empty"
            >
              Sin resultados
            </p>
          )
        ) : projects.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--ink-muted)',
              textAlign: 'center',
              marginTop: 'var(--space-6)',
              padding: '0 var(--space-4)',
              fontFamily: 'var(--font-sans)',
            }}
            data-testid="ide-empty-state"
          >
            Abre una carpeta para empezar.
          </p>
        ) : (
          projects.map((project) => (
            <div key={project.rootPath} data-testid={`ide-project-${project.name}`}>
              <IdeProjectHeader
                project={project}
                onCreateNote={(p) => void handleCreateNote(p)}
                onCreateFolder={(p) => void handleCreateFolder(p)}
              />
              {project.tree.map((entry) => (
                <IdeTreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  projectRoot={project.rootPath}
                  onCreateNote={(p) => void handleCreateNote(p)}
                  onCreateFolder={(p) => void handleCreateFolder(p)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
