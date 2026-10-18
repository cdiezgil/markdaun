import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';
import type { VaultEntry } from '../../../lib/tauri';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (label: string, exists?: boolean) => ReturnType;
    };
  }
}

/**
 * Where the extension reads the vault from. Everything is optional-by-design
 * so the extension has no dependency on the editor or on any store.
 */
export interface WikilinkOptions {
  /** Current vault tree; called at render time so `exists` is never stale. */
  getVaultTree: () => VaultEntry[];
  /** Notified when the vault tree may have changed; returns an unsubscribe. */
  subscribe?: (listener: () => void) => () => void;
  /** Called when an existing note's link is clicked. Omit for no navigation. */
  onOpen?: (entry: VaultEntry) => void;
}

const EXISTS_STYLE = 'color:var(--daun);text-decoration:underline;cursor:pointer';
const MISSING_STYLE = 'color:var(--amber);text-decoration:underline dashed;cursor:default';

/** Splits the inside of `[[...]]` into target and optional alias (verbatim). */
export function parseWikilinkBody(body: string): { label: string; alias: string | null } | null {
  const bar = body.indexOf('|');
  const label = bar === -1 ? body : body.slice(0, bar);
  const alias = bar === -1 ? null : body.slice(bar + 1);
  if (label.trim() === '' || /[[\]\n]/.test(body)) return null;
  return { label, alias };
}

/** The exact Markdown source for a wikilink. */
export function wikilinkToMarkdown(label: string, alias: string | null): string {
  return alias === null ? `[[${label}]]` : `[[${label}|${alias}]]`;
}

const patched = new WeakSet<MarkdownIt>();

/** markdown-it inline rule: `[[label]]` / `[[label|alias]]` -> span[data-wikilink]. */
function installWikilinkRule(md: MarkdownIt): void {
  if (patched.has(md)) return;
  patched.add(md);
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos, posMax } = state;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end < 0 || end >= posMax) return false;
    const parsed = parseWikilinkBody(src.slice(pos + 2, end));
    if (!parsed) return false;
    if (!silent) {
      const esc = md.utils.escapeHtml;
      const token = state.push('html_inline', '', 0);
      token.content =
        `<span data-wikilink="${esc(parsed.label)}"` +
        (parsed.alias !== null ? ` data-alias="${esc(parsed.alias)}"` : '') +
        `>${esc(wikilinkToMarkdown(parsed.label, parsed.alias))}</span>`;
    }
    state.pos = end + 2;
    return true;
  });
}

/**
 * WikilinkExtension — TC-11, TC-12
 *
 * Inline atom node for `[[note]]` / `[[note|alias]]`.
 * - Existing note → var(--daun), solid underline, clickable (`onOpen`).
 * - Missing note  → var(--amber), dashed underline, no navigation.
 * `exists` is resolved against `getVaultTree()` at render time and re-resolved
 * whenever `subscribe` fires, so it never goes stale.
 *
 * Displayed as the label only (the alias when present), without brackets.
 *
 * Markdown: parsed by a markdown-it inline rule (so loading a note yields
 * nodes) and serialised back to the exact original syntax.
 *
 * Read-only / outside the editor (e.g. rendering assistant Markdown):
 *   const ext = createWikilinkExtension({ getVaultTree, subscribe, onOpen });
 *   new Editor({ editable: false, extensions: [StarterKit, Markdown, TagExtension, ext], content });
 * No store or editor-only context is required; pass a plain `VaultEntry[]`
 * for a static tree.
 */
export function createWikilinkExtension(source: VaultEntry[] | WikilinkOptions) {
  const options: WikilinkOptions = Array.isArray(source) ? { getVaultTree: () => source } : source;
  const exists = (label: string) => findInTree(options.getVaultTree(), label) !== null;

  return Node.create({
    name: 'wikilink',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
      return {
        label: { default: '', rendered: false },
        alias: { default: null, rendered: false },
        // Legacy hint only; the rendered state always comes from the live vault.
        exists: { default: false, rendered: false },
      };
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, unknown> }) {
            state.write(
              wikilinkToMarkdown(
                node.attrs['label'] as string,
                (node.attrs['alias'] as string | null) ?? null,
              ),
            );
          },
          parse: { setup: installWikilinkRule },
        },
      };
    },

    addCommands() {
      return {
        insertWikilink:
          (label: string) =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { label, alias: null } }),
      };
    },

    addInputRules() {
      return [
        new InputRule({
          find: /(?:^|\s)\[\[([^[\]]+)\]\]$/,
          handler: ({ state, range, match }) => {
            const parsed = parseWikilinkBody(match[1] ?? '');
            const nodeType = state.schema.nodes['wikilink'];
            if (!parsed || !nodeType) return;
            // Keep the whitespace that preceded the brackets.
            const lead = (match[0] ?? '').length - (match[0] ?? '').trimStart().length;
            state.tr.replaceWith(
              range.from + lead,
              range.to,
              nodeType.create({ label: parsed.label, alias: parsed.alias }),
            );
          },
        }),
      ];
    },

    parseHTML() {
      return [
        {
          tag: 'span[data-wikilink]',
          getAttrs: (el) => {
            const dom = el as HTMLElement;
            return {
              label: dom.getAttribute('data-wikilink') ?? '',
              alias: dom.getAttribute('data-alias'),
            };
          },
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      const label = node.attrs['label'] as string;
      const alias = (node.attrs['alias'] as string | null) ?? null;
      const found = exists(label);
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-wikilink': label,
          ...(alias !== null ? { 'data-alias': alias } : {}),
          'data-exists': found ? 'true' : 'false',
          style: found ? EXISTS_STYLE : MISSING_STYLE,
          contenteditable: 'false',
        }),
        alias ?? label,
      ];
    },

    addNodeView() {
      return ({ node: initial }) => {
        let node = initial;
        const dom = document.createElement('span');
        dom.setAttribute('contenteditable', 'false');

        const paint = () => {
          const label = node.attrs['label'] as string;
          const alias = (node.attrs['alias'] as string | null) ?? null;
          const found = exists(label);
          dom.dataset['wikilink'] = label;
          if (alias !== null) dom.dataset['alias'] = alias;
          else delete dom.dataset['alias'];
          dom.dataset['exists'] = found ? 'true' : 'false';
          dom.textContent = alias ?? label;
          dom.style.cssText = found ? EXISTS_STYLE : MISSING_STYLE;
        };
        paint();

        dom.addEventListener('click', () => {
          const entry = findInTree(options.getVaultTree(), node.attrs['label'] as string);
          if (entry) options.onOpen?.(entry);
        });

        const unsubscribe = options.subscribe?.(paint);

        return {
          dom,
          update(next) {
            if (next.type !== node.type) return false;
            node = next;
            paint();
            return true;
          },
          destroy() {
            unsubscribe?.();
          },
        };
      };
    },
  });
}

// ── Helpers (exported for testing) ───────────────────────────────────────────

/** DFS search of the vault tree for a .md entry whose stem matches `label`. */
export function findInTree(tree: VaultEntry[], label: string): VaultEntry | null {
  for (const entry of tree) {
    if (entry.kind === 'file' && entry.file_type === 'md') {
      const stem = entry.name.replace(/\.md$/i, '');
      if (stem === label) return entry;
    }
    if (entry.children) {
      const found = findInTree(entry.children, label);
      if (found) return found;
    }
  }
  return null;
}
