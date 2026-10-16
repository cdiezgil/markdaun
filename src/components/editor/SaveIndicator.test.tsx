import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEditorStore } from '../../store/editorStore';
import SaveIndicator from './SaveIndicator';

beforeEach(() => {
  useEditorStore.setState({
    activeNotePath: null,
    activeNoteContent: null,
    vaultPath: null,
    vaultTree: [],
    saveStatus: 'idle',
  });
});

// ── TC-03: SaveIndicator ───────────────────────────────────────────────────────
describe('TC-03: SaveIndicator', () => {
  it('TC-03: shows empty text when saveStatus is idle', () => {
    useEditorStore.setState({ saveStatus: 'idle' });
    render(<SaveIndicator />);
    const el = screen.getByTestId('save-indicator');
    expect(el.textContent).toBe('');
    expect(el.dataset['saveStatus']).toBe('idle');
  });

  it('TC-03: shows "Guardando…" when saveStatus is saving', () => {
    useEditorStore.setState({ saveStatus: 'saving' });
    render(<SaveIndicator />);
    const el = screen.getByTestId('save-indicator');
    expect(el.textContent).toBe('Guardando…');
    expect(el.dataset['saveStatus']).toBe('saving');
  });

  it('TC-03: shows "Guardado" when saveStatus is saved', () => {
    useEditorStore.setState({ saveStatus: 'saved' });
    render(<SaveIndicator />);
    const el = screen.getByTestId('save-indicator');
    expect(el.textContent).toBe('Guardado');
    expect(el.dataset['saveStatus']).toBe('saved');
  });

  it('TC-03: has correct caption styles', () => {
    render(<SaveIndicator />);
    const el = screen.getByTestId('save-indicator');
    expect(el.style.fontSize).toBe('12px');
    expect(el.style.fontFamily).toBe('var(--font-sans)');
    expect(el.style.color).toBe('var(--ink-muted)');
  });

  it('TC-03: has role="status" and aria-live="polite"', () => {
    render(<SaveIndicator />);
    const el = screen.getByRole('status');
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
});
