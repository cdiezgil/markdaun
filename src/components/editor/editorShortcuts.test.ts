import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { buildEditorExtensions } from './editorExtensions';
import { SHORTCUTS, shortcutById, type ShortcutDef } from '../../lib/editor/shortcuts';
import { EDITOR_ACTION_EVENT } from './extensions/EditorShortcuts';

let editors: Editor[] = [];
function make(content: string): Editor {
  const ed = new Editor({
    extensions: buildEditorExtensions({ wikilinkOptions: { getVaultTree: () => [] } }),
    content,
  });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

const KEY_CODES: Record<string, number> = { '-': 189, '/': 191 };
function keyCodeOf(k: string): number {
  if (KEY_CODES[k]) return KEY_CODES[k];
  return /\d/.test(k) ? 48 + Number(k) : k.toUpperCase().charCodeAt(0);
}

/** Dispatches a keydown matching the shortcut definition (Mod = Ctrl in jsdom). */
function press(ed: Editor, s: Pick<ShortcutDef, 'key' | 'shift' | 'alt'>, mod = true): boolean {
  const ev = new KeyboardEvent('keydown', {
    key: s.shift && s.key === '-' ? '_' : s.shift && s.key.length === 1 && /[a-z]/.test(s.key) ? s.key.toUpperCase() : s.key,
    keyCode: keyCodeOf(s.key),
    ctrlKey: mod,
    shiftKey: !!s.shift,
    altKey: !!s.alt,
    bubbles: true,
    cancelable: true,
  });
  ed.view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
}
const run = (ed: Editor, id: Parameters<typeof shortcutById>[0]) => press(ed, shortcutById(id));
const html = (ed: Editor) => ed.getHTML();

describe('editor shortcuts', () => {
  it('bold / italic', () => {
    const ed = make('hola');
    ed.commands.selectAll();
    run(ed, 'bold');
    expect(html(ed)).toContain('<strong>hola</strong>');
    run(ed, 'bold');
    ed.commands.selectAll();
    run(ed, 'italic');
    expect(html(ed)).toContain('<em>hola</em>');
  });

  it('strike moves to Mod-Shift-X and old Mod-Shift-S no longer acts', () => {
    const ed = make('hola');
    ed.commands.selectAll();
    press(ed, { key: 's', shift: true });
    expect(html(ed)).not.toContain('<s>');
    run(ed, 'strike');
    expect(html(ed)).toContain('<s>hola</s>');
  });

  it('highlight', () => {
    const ed = make('hola');
    ed.commands.selectAll();
    run(ed, 'highlight');
    expect(ed.view.dom.querySelector('mark[data-highlight]')?.textContent).toBe('hola');
  });

  it('inline code', () => {
    const ed = make('hola');
    ed.commands.selectAll();
    run(ed, 'code');
    expect(html(ed)).toContain('<code>hola</code>');
  });

  it('code block moves to Mod-Shift-E; old Mod-Alt-C no longer acts', () => {
    const ed = make('hola');
    press(ed, { key: 'c', alt: true });
    expect(ed.isActive('codeBlock')).toBe(false);
    run(ed, 'codeBlock');
    expect(ed.isActive('codeBlock')).toBe(true);
  });

  it('headings and paragraph', () => {
    const ed = make('hola');
    run(ed, 'heading1');
    expect(ed.isActive('heading', { level: 1 })).toBe(true);
    run(ed, 'heading2');
    expect(ed.isActive('heading', { level: 2 })).toBe(true);
    run(ed, 'heading3');
    expect(ed.isActive('heading', { level: 3 })).toBe(true);
    run(ed, 'paragraph');
    expect(ed.isActive('paragraph')).toBe(true);
  });

  it('lists', () => {
    const ed = make('hola');
    run(ed, 'bulletList');
    expect(ed.isActive('bulletList')).toBe(true);
    run(ed, 'bulletList');
    run(ed, 'orderedList');
    expect(ed.isActive('orderedList')).toBe(true);
  });

  it('blockquote moves to Mod-Shift-9; old Mod-Shift-B no longer acts', () => {
    const ed = make('hola');
    press(ed, { key: 'b', shift: true });
    expect(ed.isActive('blockquote')).toBe(false);
    run(ed, 'blockquote');
    expect(ed.isActive('blockquote')).toBe(true);
  });

  it('horizontal rule', () => {
    const ed = make('hola');
    run(ed, 'horizontalRule');
    expect(html(ed)).toContain('<hr');
  });

  it('wikilink without selection inserts [[]] with the caret between brackets', () => {
    const ed = make('');
    run(ed, 'wikilink');
    expect(ed.getText()).toBe('[[]]');
    expect(ed.state.selection.from).toBe(3);
    expect(ed.state.selection.empty).toBe(true);
  });

  it('wikilink with a selection wraps it', () => {
    const ed = make('mi nota');
    ed.commands.selectAll();
    run(ed, 'wikilink');
    const md = (ed.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
    expect(md.trim()).toBe('[[mi nota]]');
  });

  it('diagram inserts a mermaid block', () => {
    const ed = make('hola');
    run(ed, 'diagram');
    expect(html(ed)).toContain('language-mermaid');
  });

  it.each(['link', 'table', 'image'] as const)('%s emits a UI action event', (id) => {
    const ed = make('hola');
    const seen: string[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener(EDITOR_ACTION_EVENT, h);
    const prevented = run(ed, id);
    window.removeEventListener(EDITOR_ACTION_EVENT, h);
    expect(seen).toEqual([id]);
    expect(prevented).toBe(true);
  });

  it('does not bind Mod-K (global note search) nor Mod-/ (handled app-wide)', () => {
    const ed = make('hola');
    const seen: string[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener(EDITOR_ACTION_EVENT, h);
    const k = press(ed, { key: 'k' });
    window.removeEventListener(EDITOR_ACTION_EVENT, h);
    expect(k).toBe(false);
    expect(seen).toEqual([]);
  });

  it('every editor-level shortcut in the map is handled', () => {
    const handled = SHORTCUTS.filter((s) => s.id !== 'cheatSheet');
    expect(handled.length).toBe(SHORTCUTS.length - 1);
    for (const s of handled) {
      const ed = make('hola');
      expect(press(ed, s), s.id).toBe(true);
    }
  });
});
