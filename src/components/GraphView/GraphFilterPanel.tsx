import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, RefreshCw, Folder, FolderOpen, ChevronRight, ChevronDown, Library } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import { useVaultStore } from '../../store/vaultStore';
import { buildFolderTree, middleTruncate, type FolderTreeNode } from '../../lib/graph/folderTree';

interface GraphFilterPanelProps {
  vaultPath: string;
}

const floating: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-pop)',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${active ? 'var(--daun)' : 'var(--line)'}`,
    background: active ? 'var(--mark)' : 'var(--surface)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '16px',
    fontWeight: 500,
    cursor: 'pointer',
  };
}

const rowStyle = (selected: boolean, depth: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  height: 28,
  padding: `0 var(--space-2) 0 calc(var(--space-2) + ${depth} * var(--space-4))`,
  border: 0,
  borderRadius: 'var(--radius-sm)',
  background: selected ? 'var(--mark)' : 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  fontSize: '13px',
  lineHeight: '18px',
  fontWeight: selected ? 600 : 400,
  textAlign: 'left',
  cursor: 'pointer',
});

function ancestorsOf(folder: string): string[] {
  const parts = folder.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

interface FolderPopoverProps {
  tree: FolderTreeNode[];
  selected: string;
  onSelect(folder: string): void;
}

function FolderPopover({ tree, selected, onSelect }: FolderPopoverProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestorsOf(selected)));
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (n: FolderTreeNode, depth: number): React.ReactNode => {
    const expanded = open.has(n.path);
    const hasKids = n.children.length > 0;
    const Icon = n.path === selected ? FolderOpen : Folder;
    return (
      <li key={n.path} role="none">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            data-testid={`folder-toggle-${n.path}`}
            aria-label={expanded ? `Contraer ${n.name}` : `Expandir ${n.name}`}
            aria-expanded={hasKids ? expanded : undefined}
            disabled={!hasKids}
            onClick={() => toggle(n.path)}
            style={{
              width: 20,
              height: 28,
              padding: 0,
              border: 0,
              background: 'transparent',
              visibility: hasKids ? 'visible' : 'hidden',
              cursor: 'pointer',
              marginLeft: `calc(${depth} * var(--space-4))`,
            }}
          >
            {expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            role="treeitem"
            aria-selected={n.path === selected}
            data-testid={`folder-option-${n.path}`}
            onClick={() => onSelect(n.path)}
            style={{ ...rowStyle(n.path === selected, 0), flex: 1, minWidth: 0 }}
          >
            <Icon size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.name}
            </span>
          </button>
        </div>
        {hasKids && expanded && (
          <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {n.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      data-testid="folder-popover"
      style={{
        ...floating,
        position: 'absolute',
        top: 'calc(100% + var(--space-2))',
        right: 0,
        zIndex: 20,
        width: 260,
        maxHeight: 320,
        overflowY: 'auto',
        padding: 'var(--space-2)',
      }}
    >
      <ul role="tree" aria-label="Carpetas" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        <li role="none">
          <button
            type="button"
            role="treeitem"
            aria-selected={selected === ''}
            data-testid="folder-option-root"
            onClick={() => onSelect('')}
            style={rowStyle(selected === '', 0)}
          >
            <Library size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
            Bóveda
          </button>
        </li>
        {tree.map((n) => renderNode(n, 0))}
      </ul>
    </div>
  );
}

/** Floating top-left panel: graph search + Enlaces / Etiquetas / Huérfanas / Carpetas chips. */
export function GraphFilterPanel({ vaultPath }: GraphFilterPanelProps) {
  const {
    showLinks,
    showTags,
    showOrphans,
    searchQuery,
    setShowLinks,
    setShowTags,
    setShowOrphans,
    setSearchQuery,
    loadGraph,
    folder,
    setFolder,
  } = useGraphStore();
  const vaultTree = useVaultStore((s) => s.tree);
  const folderTree = useMemo(() => buildFolderTree(vaultTree, vaultPath), [vaultTree, vaultPath]);
  const [popover, setPopover] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPopover(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const chips: Array<[string, string, boolean, (v: boolean) => void]> = [
    ['toggle-links', 'Enlaces', showLinks, setShowLinks],
    ['toggle-tags', 'Etiquetas', showTags, setShowTags],
    ['toggle-orphans', 'Huérfanas', showOrphans, setShowOrphans],
  ];

  return (
    <div
      data-testid="graph-controls"
      style={{
        ...floating,
        position: 'absolute',
        top: 'var(--space-6)',
        left: 'var(--space-6)',
        zIndex: 10,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2)',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 32,
          width: 200,
          padding: '0 10px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg)',
        }}
      >
        <Search size={15} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
        <input
          type="text"
          data-testid="graph-search"
          aria-label="Buscar en el grafo"
          placeholder="Buscar en el grafo"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            lineHeight: '18px',
            color: 'var(--ink)',
          }}
        />
      </label>
      {chips.map(([testId, label, active, set]) => (
        <button
          key={testId}
          type="button"
          data-testid={testId}
          aria-pressed={active}
          style={chipStyle(active)}
          onClick={() => set(!active)}
        >
          {label}
        </button>
      ))}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <button
          type="button"
          data-testid="toggle-folders"
          aria-haspopup="tree"
          aria-expanded={popover}
          style={chipStyle(folder !== '')}
          onClick={() => setPopover((o) => !o)}
        >
          {folder ? `Carpetas · ${middleTruncate(folder, 28)}` : 'Carpetas'}
        </button>
        {popover && (
          <FolderPopover
            tree={folderTree}
            selected={folder}
            onSelect={(f) => {
              setFolder(vaultPath, f);
              setPopover(false);
            }}
          />
        )}
      </div>
      <button
        type="button"
        aria-label="Recargar grafo"
        data-testid="reload-graph"
        onClick={() => {
          loadGraph(vaultPath).catch(console.error);
        }}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 0,
          borderRadius: 'var(--radius-md)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={16} strokeWidth={1.5} color="var(--ink-muted)" aria-hidden="true" />
      </button>
    </div>
  );
}
