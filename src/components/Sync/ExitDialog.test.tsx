import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExitDialog } from './ExitDialog';

const defaultProps = {
  open: true,
  isSyncing: false,
  onSyncAndQuit: vi.fn(),
  onQuit: vi.fn(),
  onCancel: vi.fn(),
};

describe('ExitDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TC-28: dialog renders with three buttons ─────────────────────────────

  it('TC-28: renders all three buttons when open=true', () => {
    render(<ExitDialog {...defaultProps} />);
    expect(screen.getByTestId('exit-sync-quit-btn')).toBeDefined();
    expect(screen.getByTestId('exit-quit-btn')).toBeDefined();
    expect(screen.getByTestId('exit-cancel-btn')).toBeDefined();
  });

  it('TC-28b: renders nothing when open=false', () => {
    render(<ExitDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });

  // ─── TC-29: Sincronizar y salir calls onSyncAndQuit ───────────────────────

  it('TC-29: clicking sync-quit button calls onSyncAndQuit', () => {
    const onSyncAndQuit = vi.fn();
    render(<ExitDialog {...defaultProps} onSyncAndQuit={onSyncAndQuit} />);
    fireEvent.click(screen.getByTestId('exit-sync-quit-btn'));
    expect(onSyncAndQuit).toHaveBeenCalledOnce();
  });

  // ─── TC-30: Salir sin sincronizar calls onQuit ────────────────────────────

  it('TC-30: clicking quit button calls onQuit', () => {
    const onQuit = vi.fn();
    render(<ExitDialog {...defaultProps} onQuit={onQuit} />);
    fireEvent.click(screen.getByTestId('exit-quit-btn'));
    expect(onQuit).toHaveBeenCalledOnce();
  });

  // ─── TC-31: Cancelar calls onCancel, Escape calls onCancel ───────────────

  it('TC-31: clicking cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(<ExitDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('exit-cancel-btn'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('TC-31b: pressing Escape calls onCancel', () => {
    const onCancel = vi.fn();
    render(<ExitDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows spinner text when isSyncing=true', () => {
    render(<ExitDialog {...defaultProps} isSyncing />);
    expect(screen.getByTestId('exit-sync-quit-btn').textContent).toBe('Sincronizando…');
  });

  it('buttons are disabled when isSyncing=true', () => {
    render(<ExitDialog {...defaultProps} isSyncing />);
    expect((screen.getByTestId('exit-sync-quit-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('exit-quit-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('exit-cancel-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});
