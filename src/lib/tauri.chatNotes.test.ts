import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { chatWriteNote, noteExists, readNoteTail } from './tauri';

const mockInvoke = vi.mocked(invoke);
beforeEach(() => { vi.clearAllMocks(); });

describe('chat note wrappers', () => {
  it('chatWriteNote sends camelCase args', async () => {
    mockInvoke.mockResolvedValue('/v/a.md' as never);
    await expect(chatWriteNote('a.md', 'x', 'create', '/v')).resolves.toBe('/v/a.md');
    expect(mockInvoke).toHaveBeenCalledWith('chat_write_note', {
      path: 'a.md', content: 'x', mode: 'create', vaultPath: '/v',
    });
  });
  it('noteExists', async () => {
    mockInvoke.mockResolvedValue(true as never);
    await expect(noteExists('a.md', '/v')).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('note_exists', { path: 'a.md', vaultPath: '/v' });
  });
  it('readNoteTail', async () => {
    mockInvoke.mockResolvedValue('t' as never);
    await expect(readNoteTail('a.md', '/v', 8)).resolves.toBe('t');
    expect(mockInvoke).toHaveBeenCalledWith('read_note_tail', { path: 'a.md', vaultPath: '/v', lines: 8 });
  });
});
