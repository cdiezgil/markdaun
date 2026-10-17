import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { openExternal } from './openExternal';

const mockOpen = vi.mocked(openUrl);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('openExternal', () => {
  it('opens https URLs in the system browser', async () => {
    await openExternal('https://console.anthropic.com/settings/keys');
    expect(mockOpen).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');
  });

  it('refuses anything that is not https', async () => {
    await openExternal('http://example.com');
    await openExternal('javascript:alert(1)');
    await openExternal('file:///etc/passwd');
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
