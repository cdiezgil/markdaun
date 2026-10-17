import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

const renderMermaid = vi.fn();
vi.mock('../../../lib/mermaid/render', () => ({
  renderMermaid: (...a: unknown[]) => renderMermaid(...a),
}));

import { MermaidCodeBlock, MERMAID_TEMPLATE } from './MermaidCodeBlock';

const NOTE = [
  '# Title',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  'Tail',
].join('\n');

let editor: Editor | null = null;

function Harness({ content }: { content: string }) {
  const ed = useEditor({
    extensions: [StarterKit.configure({ codeBlock: false }), MermaidCodeBlock, Markdown],
    content,
  });
  editor = ed;
  return <EditorContent editor={ed} />;
}

const md = () =>
  (editor!.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

beforeEach(() => {
  renderMermaid.mockReset();
  renderMermaid.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('markdown round trip', () => {
  it('serializes mermaid and other code blocks unchanged', async () => {
    render(<Harness content={NOTE} />);
    await waitFor(() => expect(editor).not.toBeNull());
    expect(md()).toBe(NOTE);
  });
});

describe('MermaidView', () => {
  it('shows the rendered SVG in render mode and keeps the source hidden', async () => {
    render(<Harness content={NOTE} />);
    expect(await screen.findByTestId('diagram')).toBeTruthy();
    expect(renderMermaid).toHaveBeenCalledWith('flowchart TD\n  A --> B');
    expect(screen.getByTestId('mermaid-source').hidden).toBe(true);
  });

  it('leaves other languages as plain code blocks', async () => {
    render(<Harness content={NOTE} />);
    await screen.findByTestId('diagram');
    expect(document.querySelectorAll('[data-testid="mermaid-block"]').length).toBe(1);
    expect(document.body.textContent).toContain('const a = 1;');
  });

  it('enters edit mode on diagram click and the pencil button', async () => {
    render(<Harness content={NOTE} />);
    const diagram = await screen.findByTestId('diagram');
    fireEvent.click(diagram);
    expect(screen.getByTestId('mermaid-source').hidden).toBe(false);
    fireEvent.keyDown(screen.getByTestId('mermaid-block'), { key: 'Escape' });
    expect(screen.getByTestId('mermaid-source').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Editar diagrama' }));
    expect(screen.getByTestId('mermaid-source').hidden).toBe(false);
  });

  it('leaves edit mode when the selection moves out of the block', async () => {
    render(<Harness content={NOTE} />);
    fireEvent.click(await screen.findByTestId('diagram'));
    expect(screen.getByTestId('mermaid-source').hidden).toBe(false);
    act(() => {
      editor!.commands.setTextSelection(1);
    });
    await waitFor(() => expect(screen.getByTestId('mermaid-source').hidden).toBe(true));
  });

  it('re-renders with a debounce after the source changes', async () => {
    render(<Harness content={NOTE} />);
    fireEvent.click(await screen.findByTestId('diagram'));
    renderMermaid.mockClear();
    act(() => {
      editor!.commands.insertContent('X');
      editor!.commands.insertContent('Y');
    });
    expect(renderMermaid).not.toHaveBeenCalled();
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    expect(renderMermaid.mock.calls[0][0]).toContain('XY');
  });

  it('keeps the last good SVG and shows the error for invalid source', async () => {
    render(<Harness content={NOTE} />);
    fireEvent.click(await screen.findByTestId('diagram'));
    renderMermaid.mockResolvedValue({ error: 'Parse error on line 1' });
    act(() => {
      editor!.commands.insertContent('!');
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Parse error on line 1');
    expect(screen.getByTestId('diagram')).toBeTruthy();
  });

  it('stays in edit mode with the error when it never rendered', async () => {
    renderMermaid.mockResolvedValue({ error: 'bad diagram' });
    render(<Harness content={NOTE} />);
    expect((await screen.findByRole('alert')).textContent).toContain('bad diagram');
    expect(screen.getByTestId('mermaid-source').hidden).toBe(false);
    expect(screen.queryByTestId('diagram')).toBeNull();
  });

  it('re-renders when the theme changes', async () => {
    render(<Harness content={NOTE} />);
    await screen.findByTestId('diagram');
    renderMermaid.mockClear();
    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
  });
});

describe('insertMermaid command', () => {
  it('inserts the template block and opens it in edit mode', async () => {
    render(<Harness content="Hola" />);
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.commands.insertMermaid();
    });
    expect(md()).toContain('```mermaid\n' + MERMAID_TEMPLATE + '\n```');
    await waitFor(() => expect(screen.getByTestId('mermaid-source').hidden).toBe(false));
  });
});
