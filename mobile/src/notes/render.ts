import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { resolveEmbed, resolveImagePath, resolveWikilink } from './resolve';

export type RenderContext = { path: string; mdPaths: string[]; allPaths: string[] };
export type Rendered = { html: string; images: string[]; hasMermaid: boolean };

type Env = { ctx: RenderContext; images: Set<string>; mermaid: boolean };

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

const esc = (s: string) => md.utils.escapeHtml(s);

function pushHtml(state: StateInline, html: string) {
  const t = state.push('html_inline', '', 0);
  t.content = html;
}

function imgHtml(vaultOrUrl: string, alt: string, env: Env): string {
  if (/^https?:/i.test(vaultOrUrl)) return `<img src="${esc(vaultOrUrl)}" alt="${esc(alt)}">`;
  env.images.add(vaultOrUrl);
  return `<img data-src="${esc(vaultOrUrl)}" alt="${esc(alt)}">`;
}

// [[note|alias]] and ![[embed]]
md.inline.ruler.before('image', 'embed', (state, silent) => {
  const s = state.src;
  const pos = state.pos;
  if (s.charCodeAt(pos) !== 0x21 || !s.startsWith('![[', pos)) return false;
  const end = s.indexOf(']]', pos + 3);
  if (end < 0) return false;
  const inner = s.slice(pos + 3, end);
  if (!inner || inner.includes('\n')) return false;
  if (!silent) {
    const env = state.env as Env;
    const target = resolveEmbed(inner, env.ctx.path, env.ctx.allPaths);
    const name = inner.split('|')[0].trim();
    if (target && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(target)) pushHtml(state, imgHtml(target, name, env));
    else if (target) pushHtml(state, `<a data-note="${esc(target)}">${esc(name)}</a>`);
    else pushHtml(state, `<span class="broken">${esc(name)}</span>`);
  }
  state.pos = end + 2;
  return true;
});

md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const s = state.src;
  const pos = state.pos;
  if (!s.startsWith('[[', pos)) return false;
  const end = s.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = s.slice(pos + 2, end);
  if (!inner.trim() || inner.includes('\n')) return false;
  if (!silent) {
    const env = state.env as Env;
    const target = resolveWikilink(inner, env.ctx.path, env.ctx.mdPaths);
    const pipe = inner.indexOf('|');
    const shown = (pipe >= 0 ? inner.slice(pipe + 1) : inner.split('#')[0] || inner).trim();
    pushHtml(
      state,
      target
        ? `<a data-note="${esc(target)}">${esc(shown)}</a>`
        : `<span class="broken">${esc(shown)}</span>`,
    );
  }
  state.pos = end + 2;
  return true;
});

md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
  const s = state.src;
  const pos = state.pos;
  if (!s.startsWith('==', pos) || s[pos + 2] === '=' || /\s/.test(s[pos + 2] ?? ' ')) return false;
  const end = s.indexOf('==', pos + 2);
  if (end < 0 || /\s/.test(s[end - 1])) return false;
  if (!silent) {
    pushHtml(state, '<mark>');
    const saved = state.pos;
    const savedMax = state.posMax;
    state.pos = pos + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.pos = saved;
    state.posMax = savedMax;
    pushHtml(state, '</mark>');
  }
  state.pos = end + 2;
  return true;
});

md.inline.ruler.before('emphasis', 'tag', (state, silent) => {
  const s = state.src;
  const pos = state.pos;
  if (s.charCodeAt(pos) !== 0x23) return false;
  if (pos > 0 && !/\s/.test(s[pos - 1])) return false;
  const m = /^#([\p{L}\p{N}_/-]+)/u.exec(s.slice(pos));
  if (!m || /^\d+$/.test(m[1])) return false;
  if (!silent) pushHtml(state, `<span class="tag">#${esc(m[1])}</span>`);
  state.pos = pos + m[0].length;
  return true;
});

md.renderer.rules.image = (tokens, idx, _o, env: Env) => {
  const t = tokens[idx];
  const src = t.attrGet('src') ?? '';
  const alt = t.content;
  const resolved = resolveImagePath(src, env.ctx.path, env.ctx.allPaths);
  return resolved ? imgHtml(resolved, alt, env) : `<span class="broken">${esc(alt || src)}</span>`;
};

md.renderer.rules.fence = (tokens, idx, _o, env: Env) => {
  const t = tokens[idx];
  const lang = t.info.trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') {
    env.mermaid = true;
    return `<div class="mermaid-src">${esc(t.content)}</div>\n`;
  }
  const cls = lang ? ` class="language-${esc(lang)}"` : '';
  return `<pre><code${cls}>${esc(t.content)}</code></pre>\n`;
};

// Links to other notes via normal Markdown syntax resolve to data-note; external ones open in a new tab.
md.renderer.rules.link_open = (tokens, idx, _o, env: Env) => {
  const href = tokens[idx].attrGet('href') ?? '';
  if (/^https?:/i.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return '<a>';
  let decoded = href.split('#')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw */
  }
  const target = decoded.toLowerCase().endsWith('.md')
    ? resolveImagePath(decoded, env.ctx.path, env.ctx.mdPaths)
    : null;
  return target ? `<a data-note="${esc(target)}">` : '<a class="broken">';
};

export function renderNote(source: string, ctx: RenderContext): Rendered {
  const env: Env = { ctx, images: new Set(), mermaid: false };
  const html = md.render(source.replace(FRONT_MATTER, ''), env);
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-note', 'data-src', 'target'],
    ALLOW_DATA_ATTR: false,
  });
  return { html: clean, images: [...env.images], hasMermaid: env.mermaid };
}
