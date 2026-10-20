import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';

export interface AreaMenuProps {
  /** All vault folders at any depth (relative paths, e.g. "A", "A/B", "A/B/C"). */
  areas: string[];
  /** Area used last time ('' = vault root); highlighted and auto-expanded. */
  lastArea: string | null;
  /** How many items the choice applies to. */
  count: number;
  onChoose(area: string): void;
  onClose(): void;
}

// ─── Tree model ───────────────────────────────────────────────────────────────

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
  onChoose(path: string): void;
}

function TreeRow({ node, depth, expanded, selected, onToggle, onChoose }: TreeRowProps): JSX.Element {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', width: '100%', borderRadius: 'var(--radius-sm)',
          background: isSelected ? 'var(--selection)' : 'transparent' }}
      >
        {/* Indent spacer */}
        <span style={{ display: 'inline-block', width: depth * 16 + 4, flexShrink: 0 }} />

        {/* Chevron toggle */}
        <button
          tabIndex={-1}
          aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(node.path); }}
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
            style={{ transition: 'transform 160ms cubic-bezier(.2,.7,.2,1)', transform: isExpanded ? 'rotate(90deg)' : 'none' }}
          />
        </button>

        {/* Folder + label — clicking selects the area */}
        <button
          role="menuitem"
          data-testid={`area-${node.path}`}
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => onChoose(node.path)}
          style={{
            ...ROW_BASE,
            flex: 1,
            gap: 'var(--space-2)',
            padding: 'var(--space-1) var(--space-2) var(--space-1) var(--space-1)',
            justifyContent: 'flex-start',
            background: 'transparent',
          }}
        >
          {isExpanded && hasChildren
            ? <FolderOpen size={14} strokeWidth={1.5} color={isSelected ? 'var(--daun)' : 'var(--ink-muted)'} />
            : <Folder     size={14} strokeWidth={1.5} color={isSelected ? 'var(--daun)' : 'var(--ink-muted)'} />}
          <span style={{ color: isSelected ? 'var(--daun)' : 'var(--ink)' }}>{node.name}</span>
        </button>
      </div>

      {isExpanded && node.children.map((child) => (
        <TreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          selected={selected}
          onToggle={onToggle}
          onChoose={onChoose}
        />
      ))}
    </>
  );
}

// ─── AreaMenu ─────────────────────────────────────────────────────────────────

/** Floating menu: pick the area (folder) for the digestion. */
export function AreaMenu({ areas, lastArea, count, onChoose, onClose }: AreaMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(areas), [areas]);

  // Start with lastArea's full branch expanded.
  // Expand only the ancestors of lastArea so the branch is visible but
  // the selected node itself starts collapsed (user opens it if needed).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (lastArea) {
      for (const a of ancestors(lastArea)) initial.add(a);
    }
    return initial;
  });

  useEffect(() => { ref.current?.focus(); }, []);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      aria-label="Elegir área"
      data-testid="area-menu"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        zIndex: 10,
        minWidth: 240,
        maxHeight: 360,
        overflowY: 'auto',
        marginTop: 'var(--space-1)',
        padding: 'var(--space-2)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        outline: 'none',
      }}
    >
      <div style={{ padding: 'var(--space-1) var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 'var(--space-1)' }}>
        {count === 1 ? '¿En qué área va esto?' : `¿En qué área van estos ${count}?`}
      </div>

      {/* Vault root option */}
      <button
        role="menuitem"
        data-testid="area-root"
        aria-current={lastArea === '' ? 'true' : undefined}
        onClick={() => onChoose('')}
        style={{
          ...ROW_BASE,
          gap: 'var(--space-2)',
          padding: 'var(--space-1) var(--space-3)',
          marginBottom: 'var(--space-1)',
          justifyContent: 'flex-start',
          background: lastArea === '' ? 'var(--selection)' : 'transparent',
        }}
      >
        <Folder size={14} strokeWidth={1.5} color={lastArea === '' ? 'var(--daun)' : 'var(--ink-muted)'} />
        <span style={{ color: lastArea === '' ? 'var(--daun)' : 'var(--ink)' }}>Bóveda (raíz)</span>
      </button>

      {/* Folder tree */}
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selected={lastArea ?? null}
          onToggle={toggle}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}
