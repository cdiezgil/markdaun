/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

// Non-test sources loaded as raw text through Vite (no Node typings needed).
const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);

/** Extract top-level keys of the object literal starting at `start` (a '{'). */
function topLevelKeys(source: string, start: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      if (depth === 1) token = '';
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) {
        const last = token.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(last)) keys.push(last);
        break;
      }
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ',') {
      const t = token.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) keys.push(t);
      token = '';
    } else if (ch === ':') {
      keys.push(token.trim());
      token = '';
      // skip the value up to the next top-level comma
      let d = 0;
      for (i = i + 1; i < source.length; i++) {
        const c = source[i];
        if ('{[('.includes(c)) d++;
        else if ('}])'.includes(c)) {
          if (d === 0) {
            i--;
            break;
          }
          d--;
        } else if (c === ',' && d === 0) break;
      }
    } else {
      token += ch;
    }
  }
  return keys;
}

function findInvokeKeys(source: string): { cmd: string; key: string }[] {
  const found: { cmd: string; key: string }[] = [];
  const re = /\binvoke\s*(?:<[^>(]*>)?\s*\(\s*'([^']+)'\s*,\s*(\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    for (const key of topLevelKeys(source, braceIdx)) {
      found.push({ cmd: m[1], key });
    }
  }
  return found;
}

describe('invoke payload keys', () => {
  it('detects underscore keys in a sample (guard self-check)', () => {
    const sample = `invoke<void>('x', { vault_path: a, nested: { ok_key: 1 }, fine })`;
    expect(findInvokeKeys(sample).map((f) => f.key)).toEqual(['vault_path', 'nested', 'fine']);
  });

  it('uses camelCase top-level keys in every invoke call (Tauri 2 default)', () => {
    const offenders: string[] = [];
    let total = 0;
    for (const [file, content] of Object.entries(sources)) {
      for (const { cmd, key } of findInvokeKeys(content)) {
        total++;
        if (key.includes('_')) offenders.push(`${file}: ${cmd} -> ${key}`);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
