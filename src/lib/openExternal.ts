import { openUrl } from '@tauri-apps/plugin-opener';

/** Open an https link in the system browser. Anything else is ignored. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) return;
  await openUrl(url);
}
