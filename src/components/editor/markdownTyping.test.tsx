import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';

vi.mock('../../lib/mermaid/render', () => ({ renderMermaid: vi.fn().mockResolvedValue({ svg: '<svg/>' }) }));

import { buildEditorExtensions } from './editorExtensions';

let editors: Editor[] = [];
function make(content = ''): Editor {
  const ed = new Editor({
    extensions: buildEditorExtensions({
      wikilinkOptions: { getVaultTree: () => [] },
      resolveImageSrc: (p) => `asset://resolved/${p}`,
    }),
    content,
  });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

/** Types text char by char through ProseMirror's text-input path (fires input rules). */
function type(ed: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}
const md = (ed: Editor) =>
  (ed.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
const html = (ed: Editor) => ed.getHTML();

describe('markdown typing: block rules', () => {
  it.each([
    ['# ', 'heading', { level: 1 }],
    ['## ', 'heading', { level: 2 }],
    ['### ', 'heading', { level: 3 }],
    ['- ', 'bulletList', undefined],
    ['* ', 'bulletList', undefined],
    ['1. ', 'orderedList', undefined],
    ['> ', 'blockquote', undefined],
    ['``` ', 'codeBlock', undefined],
  ])('"%s" creates %s', (typed, node, attrs) => {
    const ed = make();
    type(ed, typed);
    expect(ed.isActive(node, attrs)).toBe(true);
  });

  it('--- creates a horizontal rule', () => {
    const ed = make();
    type(ed, '---');
    expect(html(ed)).toContain('<hr');
  });
});

describe('markdown typing: inline rules', () => {
  it.each([
    ['**negrita**', '<strong>negrita</strong>'],
    ['*cursiva*', '<em>cursiva</em>'],
    ['_cursiva_', '<em>cursiva</em>'],
    ['~~tachado~~', '<s>tachado</s>'],
    ['`codigo`', '<code>codigo</code>'],
  ])('%s', (typed, expected) => {
    const ed = make();
    type(ed, typed);
    expect(html(ed)).toContain(expected);
  });

  it('==highlight==', () => {
    const ed = make();
    type(ed, '==marca==');
    expect(ed.view.dom.querySelector('mark[data-highlight]')?.textContent).toBe('marca');
  });

  it('[[wikilink]] (preceded by a space)', () => {
    const ed = make();
    type(ed, ' [[Nota]]');
    expect(md(ed)).toContain('[[Nota]]');
    expect(ed.view.dom.querySelector('[data-wikilink="Nota"]')).not.toBeNull();
  });

  it('#tag + space', () => {
    const ed = make();
    type(ed, '#idea ');
    expect(ed.view.dom.querySelector('[data-tag]')).not.toBeNull();
  });

  it('[text](url) becomes a link mark on the text', () => {
    const ed = make();
    type(ed, 'ver [aquí](https://example.com)');
    expect(html(ed)).toContain('href="https://example.com"');
    expect(ed.getText()).toBe('ver aquí');
  });

  it('[text](url) with an unsupported protocol is left alone', () => {
    const ed = make();
    type(ed, '[x](javascript:alert(1))');
    expect(html(ed)).not.toContain('<a ');
  });

  it('![alt](path) becomes an image node with a resolved src', () => {
    const ed = make();
    type(ed, '![foto](img/a.png)');
    expect(html(ed)).toContain('src="asset://resolved/img/a.png"');
    expect(html(ed)).toContain('alt="foto"');
  });

  it('![alt](https://..) keeps remote urls untouched', () => {
    const ed = make();
    type(ed, '![x](https://example.com/a.png)');
    expect(html(ed)).toContain('src="https://example.com/a.png"');
  });
});

describe('markdown typing: nothing fires inside code', () => {
  it('inline code', () => {
    const ed = make();
    ed.commands.toggleCode();
    type(ed, '**no** ==no== [a](https://x.com) ![i](p.png) ~~no~~');
    expect(html(ed)).not.toMatch(/<strong>|<s>|<a |<img|data-highlight/);
  });

  it('code blocks', () => {
    const ed = make();
    type(ed, '``` ');
    type(ed, '**no** ==no== [a](https://x.com) ![i](p.png) ~~no~~ # x');
    expect(html(ed)).not.toMatch(/<strong>|<s>|<a |<img|data-highlight|<h1/);
    expect(ed.getText()).toContain('**no** ==no==');
  });
});

describe('markdown round-trip is unchanged', () => {
  it('serializes new-rule output as standard Markdown', () => {
    const ed = make();
    type(ed, '[aquí](https://example.com)');
    expect(md(ed).trim()).toBe('[aquí](https://example.com)');
  });
});

describe('```mermaid + Enter', () => {
  it('turns the line into a mermaid block opened in edit mode', async () => {
    let ed: Editor | null = null;
    function Harness() {
      const e = useEditor({
        extensions: buildEditorExtensions({ wikilinkOptions: { getVaultTree: () => [] } }),
        content: '',
      });
      ed = e;
      return <EditorContent editor={e} />;
    }
    render(<Harness />);
    const e = ed as unknown as Editor;
    await act(async () => {
      type(e, '```mermaid');
      e.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
      );
    });
    expect(html(e)).toContain('language-mermaid');
    expect(e.state.selection.$from.parent.type.name).toBe('codeBlock');
    expect(e.view.dom.textContent).not.toContain('```mermaid');
    const block = e.view.dom.querySelector('[data-testid="mermaid-block"]');
    expect(block?.getAttribute('data-editing')).toBe('true');
  });

  it('plain ```js + Enter is unaffected', () => {
    const ed = make();
    type(ed, '```js');
    ed.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
    );
    expect(html(ed)).not.toContain('language-mermaid');
  });
});
