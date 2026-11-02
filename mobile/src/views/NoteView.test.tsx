import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { deleteDB } from 'idb';
import { DB_NAME, resetAppForTests, useApp } from '../store/appStore';
import { openDb, TREE_KEY } from '../store/db';
import { NoteView } from './NoteView';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, src: string) => ({ svg: `<svg data-src-text="${src.length}"></svg>` })),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

let observers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];

async function setup(text: string, withImage = false) {
  const db = await openDb(DB_NAME);
  await db.put('notes', { path: 'n.md', sha: 's', text });
  if (withImage) {
    await db.put('tree', { sha: 't', entries: [{ path: 'pic.png', sha: 'img1', type: 'blob' }] }, TREE_KEY);
    await db.put('images', new Blob([new Uint8Array([1])]), 'img1');
  }
  useApp.setState({
    db,
    config: { owner: 'o', repo: 'r', branch: 'main', token: 't' },
    mdPaths: ['n.md'],
    allPaths: withImage ? ['n.md', 'pic.png'] : ['n.md'],
  });
  return db;
}

beforeEach(async () => {
  await deleteDB(DB_NAME);
  resetAppForTests();
  observers = [];
  mermaid.initialize.mockClear();
  mermaid.render.mockClear();
});
afterEach(() => {
  cleanup();
  useApp.getState().db?.close();
  vi.unstubAllGlobals();
});

describe('NoteView', () => {
  it('loads vault images lazily via IntersectionObserver', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        els: Element[] = [];
        constructor(public cb: IntersectionObserverCallback) {
          observers.push(this);
        }
        observe(e: Element) {
          this.els.push(e);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    await setup('![[pic.png]]', true);
    const { container } = render(<NoteView path="n.md" q="" />);
    const img = await waitFor(() => {
      const el = container.querySelector('img[data-src]');
      expect(el).not.toBeNull();
      return el as HTMLImageElement;
    });
    expect(observers[0].els).toContain(img);
    expect(img.getAttribute('src')).toBeNull(); // not loaded before it is visible
    await act(async () => {
      observers[0].cb([{ isIntersecting: true, target: img } as unknown as IntersectionObserverEntry], observers[0] as never);
    });
    await waitFor(() => expect(img.getAttribute('src')).toBe('blob:fake'));
  });

  it('shows a placeholder when the image cannot be loaded (no IntersectionObserver)', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await setup('![[missing.png]] y ![a](pic.png)', false);
    useApp.setState({ allPaths: ['n.md', 'pic.png'] }); // resolvable path but absent from the tree
    const { container } = render(<NoteView path="n.md" q="" />);
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
    await waitFor(() => expect(container.querySelectorAll('.broken').length).toBe(2));
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders mermaid blocks lazily with the dark theme', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    await setup('```mermaid\ngraph TD; A-->B\n```');
    const { container } = render(<NoteView path="n.md" q="" />);
    await waitFor(() => expect(container.querySelector('.mermaid-done svg')).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    document.documentElement.removeAttribute('data-theme');
  });

  it('keeps the source when a diagram fails and does not load mermaid without blocks', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('parse'));
    await setup('```mermaid\nbroken\n```');
    const { container } = render(<NoteView path="n.md" q="" />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(container.querySelector('.mermaid-src')).not.toBeNull();
    cleanup();
    mermaid.initialize.mockClear();
    await useApp.getState().db!.put('notes', { path: 'n.md', sha: 's', text: 'plain' });
    render(<NoteView path="n.md" q="" />);
    await screen.findByText('plain');
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });

  it('scrolls to the first match of the query', async () => {
    const targets: (string | null)[] = [];
    const scroll = vi.fn(function (this: Element) {
      targets.push(this.textContent);
    });
    Element.prototype.scrollIntoView = scroll;
    await setup('uno\n\ndos TOMATE tres\n\notro');
    render(<NoteView path="n.md" q="tomate" />);
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(targets[0]).toBe('dos TOMATE tres');
  });
});
