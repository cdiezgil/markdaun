import MiniSearch from 'minisearch';

export type NoteInput = { path: string; text: string };
export type SearchHit = { path: string; title: string; folder: string; snippet: string };

const fold = (s: string): string => s.normalize('NFC').replace(/./gsu, (c) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
const processTerm = (t: string): string => fold(t);

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleOf(n: NoteInput): string {
  const m = /^# +(.+)$/m.exec(n.text);
  if (m) return m[1].trim();
  return (n.path.split('/').pop() ?? n.path).replace(/\.[^.]*$/, '');
}

type Doc = { id: string; title: string; path: string; body: string };
const toDoc = (n: NoteInput): Doc => ({ id: n.path, title: titleOf(n), path: n.path, body: n.text });

/** Plain text snippet with matched terms wrapped in <mark>; everything else HTML-escaped. */
function makeSnippet(body: string, terms: string[]): string {
  const text = body.normalize('NFC');
  const folded = fold(text);
  let at = -1;
  let len = 0;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = t.length;
    }
  }
  const radius = 60;
  const start = Math.max(0, (at < 0 ? 0 : at) - radius);
  const end = Math.min(text.length, (at < 0 ? 0 : at + len) + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  if (at < 0) return prefix + escapeHtml(text.slice(start, end).replace(/\s+/g, ' ')) + suffix;
  const before = text.slice(start, at).replace(/\s+/g, ' ');
  const hit = text.slice(at, at + len);
  const after = text.slice(at + len, end).replace(/\s+/g, ' ');
  return `${prefix}${escapeHtml(before)}<mark>${escapeHtml(hit)}</mark>${escapeHtml(after)}${suffix}`;
}

export class SearchIndex {
  private readonly mini = new MiniSearch<Doc>({
    fields: ['title', 'path', 'body'],
    storeFields: ['title', 'path', 'body'],
    processTerm,
  });

  update(changed: NoteInput[], removed: string[]): void {
    for (const p of removed) if (this.mini.has(p)) this.mini.discard(p);
    for (const n of changed) {
      if (this.mini.has(n.path)) this.mini.discard(n.path);
      this.mini.add(toDoc(n));
    }
    this.mini.vacuum().catch(() => undefined);
  }

  search(q: string): SearchHit[] {
    if (!q.trim()) return [];
    return this.mini
      .search(q, { prefix: true, fuzzy: 0.2, boost: { title: 3, path: 1.5 } })
      .map((r) => {
        const path = r.id as string;
        const slash = path.lastIndexOf('/');
        return {
          path,
          title: r.title as string,
          folder: slash < 0 ? '' : path.slice(0, slash),
          snippet: makeSnippet(r.body as string, r.terms),
        };
      });
  }
}

export function buildIndex(notes: NoteInput[]): SearchIndex {
  const idx = new SearchIndex();
  idx.update(notes, []);
  return idx;
}
