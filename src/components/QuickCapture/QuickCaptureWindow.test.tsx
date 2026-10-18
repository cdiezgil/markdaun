import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QuickCaptureWindow } from './QuickCaptureWindow';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

let openHandler: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  openHandler = undefined;
  mockInvoke.mockResolvedValue({ kind: 'note', rel_path: 'Entrada/x.md', clipped: null, failure: null } as never);
  mockListen.mockImplementation((async (name: string, cb: () => void) => {
    if (name === 'quick-capture-open') openHandler = cb;
    return () => {};
  }) as never);
});

const box = () => screen.getByPlaceholderText('Escribe, pega una URL o una imagen…') as HTMLTextAreaElement;

function pasteImage(el: HTMLElement) {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'captura.png', { type: 'image/png' });
  fireEvent.paste(el, {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] },
  });
}

describe('QuickCaptureWindow', () => {
  it('starts empty with the save button disabled and focus in the text box', () => {
    render(<QuickCaptureWindow />);
    expect(box()).toHaveFocus();
    expect(screen.getByRole('button', { name: /guardar en entrada/i })).toBeDisabled();
  });

  it('saves the text with the button', async () => {
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'una idea' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar en entrada/i }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('quick_capture_save', { text: 'una idea', imageB64: null }),
    );
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('saves with %s+Enter', async (_n, mods) => {
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'rápido' } });
    fireEvent.keyDown(box(), { key: 'Enter', ...mods });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quick_capture_save', { text: 'rápido', imageB64: null }));
  });

  it('a plain Enter only adds a new line', () => {
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'a' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('Esc closes without saving', async () => {
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'no guardar' } });
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('quick_capture_hide'));
    expect(mockInvoke).not.toHaveBeenCalledWith('quick_capture_save', expect.anything());
  });

  it('pasting an image shows a thumbnail chip and saves it as base64', async () => {
    render(<QuickCaptureWindow />);
    pasteImage(box());
    const chip = await screen.findByTestId('image-chip');
    expect(chip.querySelector('img')).not.toBeNull();
    expect(screen.getByRole('button', { name: /guardar en entrada/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /guardar en entrada/i }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const [cmd, args] = mockInvoke.mock.calls[0] as [string, { text: string; imageB64: string }];
    expect(cmd).toBe('quick_capture_save');
    expect(args.text).toBe('');
    expect(atob(args.imageB64)).toBe('\x89PNG');
  });

  it('keeps one image per capture and lets the user remove it', async () => {
    render(<QuickCaptureWindow />);
    pasteImage(box());
    await screen.findByTestId('image-chip');
    pasteImage(box());
    expect(screen.getAllByTestId('image-chip')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /quitar imagen/i }));
    expect(screen.queryByTestId('image-chip')).toBeNull();
  });

  it('pasting plain text is left to the text box', () => {
    render(<QuickCaptureWindow />);
    const ev = { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } };
    expect(fireEvent.paste(box(), ev)).toBe(true); // not default-prevented
  });

  it('shows what went wrong and keeps the text', async () => {
    mockInvoke.mockRejectedValueOnce('no_vault');
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'importante' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar en entrada/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Abre una bóveda');
    expect(box().value).toBe('importante');
    expect(screen.getByRole('button', { name: /guardar en entrada/i })).toBeEnabled();
  });

  it('blocks a second save while one is running', async () => {
    let finish: (v: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    render(<QuickCaptureWindow />);
    fireEvent.change(box(), { target: { value: 'x' } });
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(await screen.findByRole('button', { name: /guardando/i })).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: 'note' }));
  });

  it('starts fresh every time the window is shown', async () => {
    render(<QuickCaptureWindow />);
    await waitFor(() => expect(openHandler).toBeDefined());
    fireEvent.change(box(), { target: { value: 'viejo' } });
    pasteImage(box());
    await screen.findByTestId('image-chip');
    act(() => openHandler!());
    expect(box().value).toBe('');
    expect(screen.queryByTestId('image-chip')).toBeNull();
    expect(box()).toHaveFocus();
  });

  it('has a drag strip because the window has no title bar', () => {
    const { container } = render(<QuickCaptureWindow />);
    expect(container.querySelector('[data-tauri-drag-region]')).not.toBeNull();
  });
});
