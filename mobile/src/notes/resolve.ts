/** Vault paths are POSIX, vault-relative, without leading slash. */

const nfc = (s: string) => s.normalize('NFC');

export const isHidden = (path: string): boolean => path.split('/').some((s) => s.startsWith('.'));

const dirname = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const stem = (p: string): string => basename(p).replace(/\.[^.]*$/, '');

/** Same folder as `from` first, then shortest path, then alphabetical. */
function pickBest(candidates: string[], fromPath: string): string | null {
  const folder = dirname(fromPath);
  const sorted = [...candidates].sort((a, b) => {
    const sa = dirname(a) === folder ? 0 : 1;
    const sb = dirname(b) === folder ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted[0] ?? null;
}

export function resolveWikilink(label: string, fromPath: string, mdPaths: string[]): string | null {
  const target = nfc(label.split('|')[0].split('#')[0].trim()).toLowerCase();
  if (!target) return null;
  const wanted = target.replace(/\.md$/, '');
  const hits = mdPaths.filter((p) => {
    if (isHidden(p)) return false;
    const full = nfc(p).toLowerCase().replace(/\.md$/, '');
    return wanted.includes('/')
      ? full === wanted || full.endsWith('/' + wanted)
      : nfc(stem(p)).toLowerCase() === wanted;
  });
  return pickBest(hits, fromPath);
}

/** Obsidian `![[file.png|200]]`: resolved by file name with the same tie-break. */
export function resolveEmbed(name: string, fromPath: string, allPaths: string[]): string | null {
  const wanted = nfc(name.split('|')[0].split('#')[0].trim()).toLowerCase();
  if (!wanted) return null;
  const hits = allPaths.filter(
    (p) => !isHidden(p) && (nfc(basename(p)).toLowerCase() === wanted || nfc(p).toLowerCase().endsWith('/' + wanted) || nfc(p).toLowerCase() === wanted),
  );
  return pickBest(hits, fromPath);
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Normalise `a/./b/../c`; null when it climbs above the vault root. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

export function resolveImagePath(src: string, fromPath: string, allPaths: string[]): string | null {
  const raw = src.trim();
  if (/^https?:/i.test(raw)) return raw;
  const clean = decode(raw.split('#')[0].split('?')[0]);
  if (!clean) return null;
  const joined = clean.startsWith('/') ? clean : (dirname(fromPath) ? dirname(fromPath) + '/' : '') + clean;
  const norm = normalise(joined);
  if (!norm || isHidden(norm)) return null;
  const key = nfc(norm);
  return allPaths.find((p) => nfc(p) === key) ?? null;
}
