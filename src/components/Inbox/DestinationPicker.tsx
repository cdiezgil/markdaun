import React, { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';

export interface DestinationPickerProps {
  /** All vault folders at any depth (relative paths, e.g. "A", "A/B"). Includes Entrada/. */
  folders: string[];
  onConfirm(destPath: string): void;
  onClose(): void;
}

// ─── Tree model (same logic as AreaMenu) ─────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  for (const p of paths) {
    const parts = p.split('/');
    let siblings = root;
    let cumPath = '';
    for (let i = 0; i < parts.length; i++) {
      cumPath = i === 0 ? parts[i] : `${cumPath}/${parts[i]}`;
      if (!byPath.has(cumPath)) {
        const node: TreeNode = { name: parts[i], path: cumPath, children: [] };
        byPath.set(cumPath, node);
        siblings.push(node);
      }
      siblings = byPath.get(cumPath)!.children;
    }
  }
  return root;
}

/** Returns all ancestor paths of `path`, from shallowest to deepest. */
function ancestors(path: string): string[] {
  const parts = path.split('/');
  const result: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    result.push(parts.slice(0, i).join('/'));
  }
  return result;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROW_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
  gap: 0,
  padding: 0,
};

// ─── TreeRow ─────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle(path: string): void;
  onSelect(path: string): void;
}

function TreeRow({ node, depth, expanded, selected, onToggle, onSelect }: TreeRowProps): JSX.Element {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          borderRadius: 'var(--radius-sm)',
          background: isSelected ? 'var(--selection)' : 'transparent',
        }}
      >
        {/* Indent spacer */}
        <span style={{ display: 'inline-block', width: depth * 16 + 4, flexShrink: 0 }} />

        {/* Chevron toggle */}
        <button
          tabIndex={-1}
          aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.path);
          }}
          style={{
            ...ROW_BASE,
            width: 20,
            height: 24,
            flexShrink: 0,
            justifyContent: 'center',
            color: hasChildren ? 'var(--ink-muted)' : 'transparent',
            cursor: hasChildren ? 'pointer' : 'default',
          }}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            style={{
              transition: 'transform 160ms cubic-bezier(.2,.7,.2,1)',
              transform: isExpanded ? 'rotate(90deg)' : 'none',
            }}
          />
        </button>

        {/* Folder + label */}
        <button
          data-testid={`dest-${node.path}`}
          onClick={() => onSelect(node.path)}
          style={{
            ...ROW_BASE,
            flex: 1,
            gap: 'var(--space-2)',
            padding: 'var(--space-1) var(--space-2) var(--space-1) var(--space-1)',
            justifyContent: 'flex-start',
            background: 'transparent',
          }}
        >
          {isExpanded && hasChildren ? (
            <FolderOpen size={14} strokeWidth={1.5} color={isSelected ? 'var(--daun)' : 'var(--ink-muted)'} />
          ) : (
            <Folder size={14} strokeWidth={1.5} color={isSelected ? 'var(--daun)' : 'var(--ink-muted)'} />
          )}
          <span style={{ color: isSelected ? 'var(--daun)' : 'var(--ink)' }}>{node.name}</span>
        </button>
      </div>

      {isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

// ─── DestinationPicker ────────────────────────────────────────────────────────

/** Floating picker: select a vault folder as the import destination. */
export function DestinationPicker({ folders, onConfirm, onClose }: DestinationPickerProps): JSX.Element {
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleSelect = (path: string) => {
    setSelected(path);
    // Expand ancestors when selecting a nested node.
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestors(path)) next.add(a);
      return next;
    });
  };

  return (
    <div
      data-testid="destination-picker"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        zIndex: 10,
        minWidth: 260,
        maxHeight: 440,
        display: 'flex',
        flexDirection: 'column',
        marginTop: 'var(--space-1)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        outline: 'none',
      }}
    >
      {/* Header — fixed */}
      <div
        style={{
          padding: 'var(--space-2) var(--space-3) var(--space-1)',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: 'var(--ink-muted)',
          flexShrink: 0,
        }}
      >
        ¿En qué carpeta importar?
      </div>

      {/* Scrollable tree area */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '0 var(--space-2)' }}>
        {/* Vault root option */}
        <button
          data-testid="dest-root"
          onClick={() => setSelected('')}
          style={{
            ...ROW_BASE,
            gap: 'var(--space-2)',
            padding: 'var(--space-1) var(--space-3)',
            marginBottom: 'var(--space-1)',
            justifyContent: 'flex-start',
            background: selected === '' ? 'var(--selection)' : 'transparent',
          }}
        >
          <Folder size={14} strokeWidth={1.5} color={selected === '' ? 'var(--daun)' : 'var(--ink-muted)'} />
          <span style={{ color: selected === '' ? 'var(--daun)' : 'var(--ink)' }}>Bóveda (raíz)</span>
        </button>

        {/* Folder tree */}
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selected={selected}
            onToggle={toggle}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Action buttons — sticky footer, always visible */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          justifyContent: 'flex-end',
          padding: 'var(--space-2) var(--space-3)',
          borderTop: '1px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <button
          data-testid="cancel-import"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 28,
            padding: '0 var(--space-3)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancelar
        </button>
        <button
          data-testid="confirm-import"
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) onConfirm(selected);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 28,
            padding: '0 var(--space-3)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            cursor: selected !== null ? 'pointer' : 'default',
            opacity: selected !== null ? 1 : 0.5,
          }}
        >
          Importar aquí
        </button>
      </div>
    </div>
  );
}
