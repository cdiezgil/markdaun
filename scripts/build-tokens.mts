// Generates design/tokens.css (and its served copy public/tokens.css) from
// design/tokens.json. Run with: npm run tokens
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Themed = { light: string; dark: string };
type Token = { name: string; value: string | Themed; size?: string };
type TypeStyle = {
  name: string;
  family?: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
  fontStyle?: string;
  fontVariantNumeric?: string;
};
type Tokens = {
  name: string;
  color: { tokens: Token[] };
  texture: { tokens: Token[] };
  type: { families: Record<string, string>; groups: Array<{ family: string; styles: TypeStyle[] }> };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
  motion: { tokens: Token[] };
  layout: { tokens: Token[] };
};

const ref = (value: string): string => value.replace(/^\{(.+)\}$/, 'var(--$1)');

function themeBlock(tokens: Token[], theme: keyof Themed, indent: string): string[] {
  return tokens.map(({ name, value }) =>
    `${indent}--${name}: ${typeof value === 'string' ? ref(value) : value[theme]};`,
  );
}

/** Renders the CSS custom properties and type classes for a tokens.json document. */
export function renderTokensCss(tokens: Tokens): string {
  const themed = [...tokens.color.tokens, ...tokens.texture.tokens, ...tokens.shadow.tokens];
  const fixed = [
    ...tokens.spacing.tokens,
    ...tokens.radius.tokens,
    ...tokens.motion.tokens,
    ...tokens.layout.tokens,
  ];
  const out: string[] = [`/* ${tokens.name} — generado desde tokens.json (npm run tokens). No editar a mano. */`];

  out.push(':root, [data-theme="light"] {', ...themeBlock(themed, 'light', '  '), '}');
  out.push('[data-theme="dark"] {', ...themeBlock(themed, 'dark', '  '), '}');
  out.push(
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    ...themeBlock(themed, 'dark', '    '),
    '  }',
    '}',
  );

  out.push(':root {');
  for (const { name, value } of fixed) out.push(`  --${name}: ${value as string};`);
  for (const [family, stack] of Object.entries(tokens.type.families)) out.push(`  --font-${family}: ${stack};`);
  out.push('}');

  for (const group of tokens.type.groups) {
    for (const s of group.styles) {
      const decls = [
        `font-family: var(--font-${s.family ?? group.family});`,
        `font-size: ${s.fontSize};`,
        `line-height: ${s.lineHeight};`,
        `font-weight: ${s.fontWeight};`,
        s.letterSpacing && `letter-spacing: ${s.letterSpacing};`,
        s.fontStyle && `font-style: ${s.fontStyle};`,
        s.fontVariantNumeric && `font-variant-numeric: ${s.fontVariantNumeric};`,
      ].filter(Boolean);
      out.push(`.${s.name} { ${decls.join(' ')} }`);
    }
  }

  for (const { name, size } of tokens.texture.tokens) {
    const cls = name.replace('texture-', 'bg-');
    out.push(`.${cls} { background-image: var(--${name});${size && size !== 'auto' ? ` background-size: ${size};` : ''} }`);
  }

  return `${out.join('\n')}\n`;
}

if (process.argv[1]?.endsWith('build-tokens.mts')) {
  const root = join(import.meta.dirname, '..');
  const tokens = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8')) as Tokens;
  const css = renderTokensCss(tokens);
  for (const target of ['design/tokens.css', 'public/tokens.css']) writeFileSync(join(root, target), css);
  console.log('tokens.css generated');
}
