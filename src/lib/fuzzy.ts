/**
 * Small in-house fuzzy scorer for the ⌘K note search (no dependency).
 *
 * A query matches when its characters appear in order in the text. The best
 * alignment is chosen with a tiny DP so that prefix, word-start and
 * consecutive matches outrank scattered ones. Matching ignores case and
 * diacritics ("nota" matches "Nóta").
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the ORIGINAL text of the matched characters. */
  indices: number[];
}

const SEPARATORS = new Set(['/', '-', '_', '.', ' ']);
const BASE = 1;
const CONSECUTIVE_BONUS = 6;
const WORD_START_BONUS = 8;
const PREFIX_BONUS = 4;
const GAP_PENALTY = 0.5;

/** One normalised char per original UTF-16 unit, so indices stay aligned. */
function fold(s: string): string[] {
  return Array.from(s, (ch) => ch).flatMap((ch) => {
    const base = ch.normalize('NFD')[0].toLowerCase();
    // Keep one entry per UTF-16 unit of the original char.
    return ch.length === 1 ? [base] : [base, ''];
  });
}

function isWordStart(text: string, j: number): boolean {
  return j === 0 || SEPARATORS.has(text[j - 1]);
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.replace(/\s+/g, '')).filter((c) => c !== '');
  if (q.length === 0) return { score: 0, indices: [] };
  const t = fold(text);
  const raw = Array.from(text);
  void raw;

  // Cheap subsequence check before the DP.
  let qi = 0;
  for (let j = 0; j < t.length && qi < q.length; j++) if (t[j] === q[qi]) qi++;
  if (qi < q.length) return null;

  const n = q.length;
  const m = t.length;
  const NEG = -Infinity;
  // best[i][j]: best score with q[i] matched at t[j]; from[i][j]: previous j.
  const best: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(NEG));
  const from: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (t[j] !== q[i]) continue;
      let bonus = BASE;
      if (isWordStart(text, j)) bonus += WORD_START_BONUS;
      if (j === 0) bonus += PREFIX_BONUS;
      if (i === 0) {
        best[i][j] = bonus;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === NEG) continue;
        const link = k === j - 1 ? CONSECUTIVE_BONUS : -GAP_PENALTY * (j - k - 1);
        const s = best[i - 1][k] + bonus + link;
        if (s > best[i][j]) {
          best[i][j] = s;
          from[i][j] = k;
        }
      }
    }
  }

  let endJ = -1;
  let score = NEG;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] > score) {
      score = best[n - 1][j];
      endJ = j;
    }
  }
  if (endJ < 0) return null;

  const indices: number[] = [];
  for (let i = n - 1, j = endJ; i >= 0; i--) {
    indices.unshift(j);
    j = from[i][j];
  }
  return { score, indices };
}

export interface NoteRef {
  name: string;
  path: string;
}

export interface NoteSearchResult {
  item: NoteRef;
  /** File name without the `.md` extension. */
  title: string;
  /** Folder relative to the vault ('' for the vault root). */
  dir: string;
  titleIndices: number[];
  dirIndices: number[];
  score: number;
}

const NAME_WEIGHT = 2;

/**
 * Ranks notes against `query` by name (weighted x2) and relative path.
 * Empty/blank queries return nothing. Ties keep the input order.
 */
export function searchNotes(
  query: string,
  notes: NoteRef[],
  vaultPath: string | null,
  limit = 20,
): NoteSearchResult[] {
  if (query.trim() === '') return [];
  const results: Array<NoteSearchResult & { order: number }> = [];

  notes.forEach((item, order) => {
    const title = item.name.replace(/\.md$/i, '');
    const rel =
      vaultPath && item.path.startsWith(vaultPath + '/')
        ? item.path.slice(vaultPath.length + 1)
        : item.path;
    const slash = rel.lastIndexOf('/');
    const dir = slash >= 0 ? rel.slice(0, slash) : '';
    const relNoExt = rel.replace(/\.md$/i, '');

    const byName = fuzzyMatch(query, title);
    const byPath = fuzzyMatch(query, relNoExt);
    if (!byName && !byPath) return;

    const nameScore = byName ? byName.score * NAME_WEIGHT : -Infinity;
    const pathScore = byPath ? byPath.score : -Infinity;

    if (nameScore >= pathScore) {
      results.push({
        item, title, dir, titleIndices: byName!.indices, dirIndices: [],
        score: nameScore, order,
      });
    } else {
      // Path-only hit: indices over relNoExt; split into the folder part (highlighted
      // under the title) and the title part.
      const titleStart = dir ? dir.length + 1 : 0;
      results.push({
        item,
        title,
        dir,
        titleIndices: byPath!.indices.filter((i) => i >= titleStart).map((i) => i - titleStart),
        dirIndices: byPath!.indices.filter((i) => i < dir.length),
        score: pathScore,
        order,
      });
    }
  });

  results.sort((a, b) => b.score - a.score || a.order - b.order);
  return results.slice(0, limit).map(({ order: _order, ...r }) => r);
}
