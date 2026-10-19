export type ShellView = 'notes' | 'graph' | 'brain' | 'ide' | 'settings';

/** Which top-level view a route belongs to (drives tabs and status bar). */
export function viewForPath(pathname: string): ShellView {
  if (pathname.startsWith('/graph')) return 'graph';
  if (pathname.startsWith('/brain')) return 'brain';
  if (pathname.startsWith('/ide')) return 'ide';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'notes';
}

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
