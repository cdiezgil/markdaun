import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { HighlightExtension } from './HighlightExtension';
import { TagExtension } from './TagExtension';
import { createWikilinkExtension } from './WikilinkExtension';

let editors: Editor[] = [];
function make(content: string): Editor {
  const ed = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false }),
      HighlightExtension,
      TagExtension,
      createWikilinkExtension([]),
    ],
    content,
  });
  editors.push(ed);
  return ed;
}
const md = (ed: Editor) =>
  (ed.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
const marks = (ed: Editor) => ed.view.dom.querySelectorAll('mark[data-highlight]').length;

afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

describe('highlight markdown', () => {
  it('parses ==text== into a highlight mark', () => {
    const ed = make('a ==hola mundo== b');
    expect(marks(ed)).toBe(1);
    expect(ed.view.dom.querySelector('mark')?.textContent).toBe('hola mundo');
  });

  it('does not convert inside code', () => {
    const ed = make('`==a==`\n\n```\n==b==\n```');
    expect(marks(ed)).toBe(0);
  });

  it('ignores unterminated, empty and spaced delimiters', () => {
    expect(marks(make('==open and ==== and == x =='))).toBe(0);
  });

  it.each([
    'a ==hola mundo== b',
    '==solo==',
    'mix ==**bold** and *em*== end',
    'with [[Nota]] and #tag ==hl [[Otra]] #t== done',
    '# Title ==x==\n\n- item ==y==\n\n> q ==z==',
    '`==a==`\n\n```\n==b==\n```',
    'two ==a== and ==b==',
  ])('round trips byte-identically: %j', (input) => {
    expect(md(make(input))).toBe(input);
  });

  it('typing ==x== serializes unchanged', () => {
    const ed = make('');
    for (const ch of 'a ==x==') {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp('handleTextInput', (f) =>
        f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
      );
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
    }
    expect(marks(ed)).toBe(1);
    expect(md(ed)).toBe('a ==x==');
  });
});
