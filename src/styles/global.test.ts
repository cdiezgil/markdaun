import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('src/styles/global.css');
const main = read('src/main.tsx');
const html = read('index.html');

describe('global styles', () => {
  it('is imported once at the app root', () => {
    expect(main).toContain("import './styles/global.css'");
  });

  it('loads tokens.css once and the Google Fonts link', () => {
    expect(html.match(/tokens\.css/g)).toHaveLength(1);
    expect(html).toContain('family=Geist:wght@400;500;600');
    expect(html).toContain('family=Instrument+Serif');
  });

  it('sets body typography and colours from tokens', () => {
    expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/body\s*{[^}]*color:\s*var\(--ink\)/);
    expect(css).toMatch(/body\s*{[^}]*background:\s*var\(--bg\)/);
  });

  it('removes the window frame: full viewport, no margin', () => {
    expect(css).toMatch(/body\s*{[^}]*margin:\s*0/);
    expect(css).toMatch(/#root\s*{[^}]*height:\s*100%/);
  });

  it('styles thin 8px scrollbars with a transparent track', () => {
    expect(css).toMatch(/::-webkit-scrollbar\s*{[^}]*width:\s*8px/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*{[^}]*background:\s*var\(--line-strong\)/);
    expect(css).toMatch(/::-webkit-scrollbar-track\s*{[^}]*background:\s*transparent/);
  });

  it('makes form controls inherit the sans font', () => {
    expect(css).toMatch(/button,\s*input,\s*textarea,\s*select\s*{[^}]*font-family:\s*inherit/);
  });
});
