import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Guard for the design-system rule "CSS variables only": no literal hex
 * colours, rgb()/rgba() literals, font-family values other than token
 * variables, or border-radius px literals in production sources.
 */

const SRC = join(process.cwd(), 'src');

/**
 * Directories that still contain violations and are cleared in a later
 * slice. Paths are POSIX-style, relative to the repo root.
 */
const ALLOWLIST: readonly string[] = [];

const isProduction = (path: string) =>
  !/\.test\.(ts|tsx)$/.test(path) && !path.startsWith('src/test/');

export interface Violation {
  line: number;
  rule: string;
  text: string;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');
}

const RULES: Array<{ rule: string; test: (line: string) => boolean }> = [
  { rule: 'hex colour', test: (l) => /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/.test(l) },
  { rule: 'rgb()/rgba() literal', test: (l) => /\brgba?\(/.test(l) },
  {
    rule: 'font-family literal',
    test: (l) => {
      const css = /font-family\s*:\s*(.*)/.exec(l);
      if (css) return !/^['"]?\s*(?:var\(--|inherit\b)/.test(css[1].trim());
      // JS/TS: only string literals are values; type annotations and calls are not.
      const js = /fontFamily\s*:\s*(['"`])(.*)/.exec(l);
      return !!js && !/^\s*(?:var\(--|inherit\b)/.test(js[2]);
    },
  },
  {
    rule: 'border-radius px literal',
    test: (l) =>
      /border-radius\s*:\s*[^;]*\d+px/.test(l) ||
      /borderRadius\s*:\s*(?:\d+\s*[,}]|['"][^'"]*\d+px)/.test(l),
  },
];

export function findViolations(source: string): Violation[] {
  const out: Violation[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, i) => {
      for (const { rule, test } of RULES) {
        if (test(text)) out.push({ line: i + 1, rule, text: text.trim() });
      }
    });
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('findViolations (scanner)', () => {
  it('flags hex, rgba, font-family and px radius literals', () => {
    expect(findViolations('color: #fff;').map((v) => v.rule)).toEqual(['hex colour']);
    expect(findViolations("background: '#2E6A4F'")).toHaveLength(1);
    expect(findViolations('box-shadow: 0 1px rgba(0,0,0,.1)')).toHaveLength(1);
    expect(findViolations("fontFamily: 'Georgia, serif'")).toHaveLength(1);
    expect(findViolations('font-family: Times;')).toHaveLength(1);
    expect(findViolations('border-radius: 4px;')).toHaveLength(1);
    expect(findViolations('borderRadius: 4,')).toHaveLength(1);
    expect(findViolations("borderRadius: '6px'")).toHaveLength(1);
  });

  it('accepts token variables and non-px radii', () => {
    expect(findViolations("fontFamily: 'var(--font-mono)'")).toHaveLength(0);
    expect(findViolations('font-family: var(--font-sans);')).toHaveLength(0);
    expect(findViolations('font-family: inherit;')).toHaveLength(0);
    expect(findViolations('  fontFamily: string;')).toHaveLength(0);
    expect(findViolations("  fontFamily: token('--font-sans'),")).toHaveLength(0);
    expect(findViolations("borderRadius: 'var(--radius-md)'")).toHaveLength(0);
    expect(findViolations("borderRadius: '50%'")).toHaveLength(0);
    expect(findViolations('border-radius: 0;')).toHaveLength(0);
  });

  it('ignores comments', () => {
    expect(findViolations('// color: #fff')).toHaveLength(0);
    expect(findViolations('/* border-radius: 4px */')).toHaveLength(0);
  });
});

describe('design-token guard', () => {
  const files = walk(SRC)
    .filter((f) => /\.(ts|tsx|css)$/.test(f))
    .map((f) => ({ rel: relative(process.cwd(), f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter(({ rel }) => isProduction(rel));

  it('scans production sources', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.rel === 'src/App.tsx')).toBe(true);
    expect(files.some((f) => f.rel === 'src/styles/global.css')).toBe(true);
  });

  it('has no literal colours, fonts or radii outside the allowlist', () => {
    const report: string[] = [];
    for (const { rel, text } of files) {
      if (ALLOWLIST.some((prefix) => rel.startsWith(prefix))) continue;
      for (const v of findViolations(text)) {
        report.push(`${rel}:${v.line} [${v.rule}] ${v.text}`);
      }
    }
    expect(report).toEqual([]);
  });
});
