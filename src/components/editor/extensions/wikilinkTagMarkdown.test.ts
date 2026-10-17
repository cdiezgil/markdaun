import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import type { VaultEntry } from '../../../lib/tauri';
import { createWikilinkExtension } from './WikilinkExtension';
import { TagExtension } from './TagExtension';

const file = (name: string): VaultEntry => ({
  name,
  path: `/vault/${name}`,
  kind: 'file',
  file_type: 'md',
  children: null,
});

let editors: Editor[] = [];

function make(content: string, tree: VaultEntry[] = []): Editor {
  const ed = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false }),
      TagExtension,
      createWikilinkExtension(tree),
    ],
    content,
  });
  editors.push(ed);
  return ed;
}

const md = (ed: Editor) =>
  (ed.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

function nodes(ed: Editor, name: string) {
  const found: Array<Record<string, unknown>> = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === name) found.push(n.attrs);
  });
  return found;
}

afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

describe('loading Markdown', () => {
  it('creates wikilink and tag nodes', () => {
    const ed = make('Hola [[Nota de carlos]] y #pruebas');
    expect(nodes(ed, 'wikilink')).toHaveLength(1);
    expect(nodes(ed, 'wikilink')[0]?.['label']).toBe('Nota de carlos');
    expect(nodes(ed, 'tag')).toEqual([{ tag: '#pruebas' }]);
  });

  it('does not convert inside code blocks or inline code', () => {
    const ed = make('`[[a]] #b`\n\n```\n[[c]] #d\n```\n');
    expect(nodes(ed, 'wikilink')).toHaveLength(0);
    expect(nodes(ed, 'tag')).toHaveLength(0);
  });

  it('does not treat headings, URL fragments or mid-word # as tags', () => {
    const ed = make('# Title\n\nsee https://x.com/#anchor and a#b and C# lang and # alone');
    expect(nodes(ed, 'tag')).toHaveLength(0);
  });

  it('does not convert empty or unterminated brackets', () => {
    const ed = make('[[]] and [[open and [[a\nb]]');
    expect(nodes(ed, 'wikilink')).toHaveLength(0);
  });
});

describe('round trip', () => {
  const cases = [
    'Hola [[Nota de carlos]] y #pruebas',
    'Alias [[Nota|el alias]] here',
    '# Title\n\n- item [[a]]\n- item #tag-two/sub\n\n> quote [[q]]',
    '`[[a]] #b`\n\n```\n[[c]] #d\n```',
    'edge [[a]][[b]] #x, #y.',
    'see https://x.com/#anchor and a#b',
    '[[Solo]]',
  ];
  it.each(cases)('is byte-identical: %j', (input) => {
    expect(md(make(input))).toBe(input);
  });
});

describe('typing', () => {
  function type(ed: Editor, text: string) {
    for (const ch of text) {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp('handleTextInput', (f) =>
        f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
      );
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
    }
  }

  it('typing [[x]] serializes as [[x]] and keeps the preceding space', () => {
    const ed = make('');
    type(ed, 'a [[x]]');
    expect(nodes(ed, 'wikilink')).toHaveLength(1);
    expect(md(ed)).toBe('a [[x]]');
  });

  it('typing [[x|y]] keeps the alias', () => {
    const ed = make('');
    type(ed, '[[x|y]]');
    expect(md(ed)).toBe('[[x|y]]');
  });

  it('typing a tag keeps it editable until a space is typed', () => {
    const ed = make('');
    type(ed, '#pru');
    expect(nodes(ed, 'tag')).toHaveLength(0);
    type(ed, 'ebas ');
    expect(nodes(ed, 'tag')).toEqual([{ tag: '#pruebas' }]);
    expect(md(ed)).toBe('#pruebas ');
  });
});

describe('exists is computed against the current vault', () => {
  it('reflects tree changes without reloading', () => {
    let tree: VaultEntry[] = [];
    const listeners = new Set<() => void>();
    const ed = new Editor({
      extensions: [
        StarterKit,
        Markdown,
        createWikilinkExtension({
          getVaultTree: () => tree,
          subscribe: (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
          },
        }),
      ],
      content: '[[Nueva]]',
    });
    editors.push(ed);
    const el = () => ed.view.dom.querySelector('[data-wikilink]') as HTMLElement;
    expect(el().dataset['exists']).toBe('false');
    tree = [file('Nueva.md')];
    listeners.forEach((l) => l());
    expect(el().dataset['exists']).toBe('true');
  });

  it('opens the note on click only when it exists', () => {
    const opened: string[] = [];
    const tree = [file('Hay.md')];
    const ed = new Editor({
      extensions: [
        StarterKit,
        Markdown,
        createWikilinkExtension({ getVaultTree: () => tree, onOpen: (e) => opened.push(e.path) }),
      ],
      content: '[[Hay]] [[NoHay]]',
    });
    editors.push(ed);
    const els = ed.view.dom.querySelectorAll<HTMLElement>('[data-wikilink]');
    els[1]?.click();
    els[0]?.click();
    expect(opened).toEqual(['/vault/Hay.md']);
  });
});
