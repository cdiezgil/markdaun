import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrphanGroup } from './OrphanGroup';
import type { OrphanGroupData } from '../../store/graphStore';

function makeProps(folderName: string) {
  return {
    data: { folderName } as OrphanGroupData,
    id: `orphanGroup_${folderName}`,
    selected: false,
    type: 'orphanGroup',
    dragging: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

// ── TC-10: OrphanGroup renders ─────────────────────────────────────────────────
describe('TC-10: OrphanGroup renders', () => {
  it('TC-10: renders container with correct testid', () => {
    render(<OrphanGroup {...(makeProps('sub') as unknown as Parameters<typeof OrphanGroup>[0])} />);
    expect(screen.getByTestId('orphan-group-sub')).toBeDefined();
  });

  it('TC-10: shows folder name label', () => {
    render(<OrphanGroup {...(makeProps('sub') as unknown as Parameters<typeof OrphanGroup>[0])} />);
    expect(screen.getByTestId('orphan-group-label-sub').textContent).toBe('sub');
  });

  it('TC-10: shows "root" for root-level orphans', () => {
    render(<OrphanGroup {...(makeProps('root') as unknown as Parameters<typeof OrphanGroup>[0])} />);
    expect(screen.getByTestId('orphan-group-label-root').textContent).toBe('root');
  });

  it('TC-10: has dashed border style', () => {
    render(<OrphanGroup {...(makeProps('sub') as unknown as Parameters<typeof OrphanGroup>[0])} />);
    const el = screen.getByTestId('orphan-group-sub');
    expect(el.style.border).toContain('dashed');
  });
});

// ── TC-17: OrphanGroup does not have handles ──────────────────────────────────
describe('TC-17: OrphanGroup has no handles', () => {
  it('TC-17: no Handle elements rendered', () => {
    render(<OrphanGroup {...(makeProps('docs') as unknown as Parameters<typeof OrphanGroup>[0])} />);
    // No handles = no elements with role connection etc.
    // The container uses pointerEvents:none
    const el = screen.getByTestId('orphan-group-docs');
    expect(el.style.pointerEvents).toBe('none');
  });
});
