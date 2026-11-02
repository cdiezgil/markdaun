import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTokensCss } from '../../scripts/build-tokens.mjs';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const tokens = JSON.parse(read('design/tokens.json'));
const color = (name: string, theme: 'light' | 'dark'): string =>
  tokens.color.tokens.find((t: { name: string }) => t.name === name).value[theme];

describe('design tokens', () => {
  it('design/tokens.css is generated from tokens.json', () => {
    expect(read('design/tokens.css')).toBe(renderTokensCss(tokens));
  });

  it('public/tokens.css is the same file the app serves', () => {
    expect(read('public/tokens.css')).toBe(read('design/tokens.css'));
  });

  it('defines every theme in both explicit and OS-driven dark mode', () => {
    const css = renderTokensCss(tokens);
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain('--gold: #FFD700;');
    expect(css).toContain('--focus: var(--daun);');
  });

  it('uses the cdiezgil brand colours', () => {
    expect(color('bg', 'dark')).toBe('#0A1122');
    expect(color('gold', 'light')).toBe('#FFD700');
    expect(color('on-gold', 'dark')).toBe('#0A1122');
    expect(color('line', 'light')).toBe('#E5E5E5');
  });

  it('caps radii at 8px', () => {
    for (const { name, value } of tokens.radius.tokens) {
      if (name === 'radius-pill' || name === 'radius-icon') continue;
      expect(parseInt(value, 10)).toBeLessThanOrEqual(8);
    }
  });

  it('uses Geist and Geist Mono, with Instrument Serif only as the note-title exception', () => {
    expect(tokens.type.families.display).toMatch(/^"Instrument Serif"/);
    const displayStyles = tokens.type.groups
      .flatMap((g: { family: string; styles: Array<{ name: string; family?: string }> }) =>
        g.styles.map((s) => ({ name: s.name, family: s.family ?? g.family })))
      .filter((s: { family: string }) => s.family === 'display')
      .map((s: { name: string }) => s.name);
    expect(displayStyles).toEqual(['reading-h1']);
    expect(tokens.type.families.sans).toMatch(/^Geist,/);
    expect(tokens.type.families.mono).toMatch(/^"Geist Mono"/);
  });
});
