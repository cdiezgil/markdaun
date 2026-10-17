import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** WCAG 2.x contrast of the design tokens' text pairs, per theme. */

const css = readFileSync(join(process.cwd(), 'design', 'tokens.css'), 'utf8');

function themeTokens(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const THEMES = {
  light: themeTokens(/:root, \[data-theme="light"\] \{([^}]*)\}/),
  dark: themeTokens(/\[data-theme="dark"\] \{([^}]*)\}/),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background] token pairs that carry text in the shell. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'surface-sunken'],
  ['ink-muted', 'bg'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'surface-sunken'],
  ['daun', 'bg'],
  ['daun', 'surface-sunken'],
  ['on-daun', 'daun'],
  ['on-sap', 'sap'],
  ['ink', 'mark'],
  ['amber', 'bg'],
  ['amber', 'surface-sunken'],
  ['danger', 'bg'],
];

describe('design token contrast', () => {
  it('parses both themes', () => {
    expect(THEMES.light.bg).toBe('#F7F5EF');
    expect(THEMES.dark.bg).toBe('#111816');
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${theme}: ${fg} on ${bg} is >= 4.5:1`, () => {
        expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
