import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '../github/client';
import { loadImage } from '../notes/images';
import { renderNote } from '../notes/render';
import { useApp } from '../store/appStore';
import { navigate, noteHref } from '../router';
import { BackBar, Page } from '../components/ui';
import { Mermaid } from '../components/Mermaid';

function scrollToFirstMatch(root: HTMLElement, q: string): void {
  const needle = q.trim().toLowerCase();
  if (!needle) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? '').toLowerCase().includes(needle)) {
      n.parentElement?.scrollIntoView?.({ block: 'center' });
      return;
    }
  }
}

export function NoteView({ path, q }: { path: string; q: string }) {
  const db = useApp((s) => s.db);
  const config = useApp((s) => s.config);
  const mdPaths = useApp((s) => s.mdPaths);
  const allPaths = useApp((s) => s.allPaths);
  const lastRefresh = useApp((s) => s.lastRefresh);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void db?.get('notes', path).then((n) => live && setText(n ? n.text : null));
    return () => {
      live = false;
    };
  }, [db, path, lastRefresh]);

  const rendered = useMemo(
    () => (text == null ? null : renderNote(text, { path, mdPaths, allPaths })),
    [text, path, mdPaths, allPaths],
  );
  const title = (path.split('/').pop() ?? path).replace(/\.md$/i, '');

  // Lazy images: load when they approach the viewport.
  useEffect(() => {
    const root = box.current;
    if (!root || !db || !rendered) return;
    const client = config ? createClient(config.token, config) : null;
    let live = true;
    const load = async (img: HTMLImageElement) => {
      const src = img.getAttribute('data-src');
      if (!src) return;
      img.removeAttribute('data-src');
      const url = await loadImage(src, { db, client });
      if (!live) return;
      if (url) img.src = url;
      else {
        const span = document.createElement('span');
        span.className = 'broken';
        span.textContent = img.alt || src;
        img.replaceWith(span);
      }
    };
    const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-src]')];
    if (typeof IntersectionObserver === 'undefined') {
      imgs.forEach((i) => void load(i));
      return () => {
        live = false;
      };
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        void load(e.target as HTMLImageElement);
      }
    }, { rootMargin: '200px' });
    imgs.forEach((i) => io.observe(i));
    return () => {
      live = false;
      io.disconnect();
    };
  }, [rendered, db, config]);

  // Give note links a real href so they are focusable and announced as links.
  useEffect(() => {
    box.current?.querySelectorAll('a[data-note]').forEach((a) => {
      a.setAttribute('href', noteHref(a.getAttribute('data-note') ?? ''));
    });
  }, [rendered]);

  useEffect(() => {
    if (rendered && box.current) scrollToFirstMatch(box.current, q);
  }, [rendered, q]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-note]');
    if (!a) return;
    e.preventDefault();
    navigate(noteHref(a.getAttribute('data-note') ?? ''));
  };

  return (
    <Page>
      <BackBar title={title} to="#/" />
      {text === null && <p className="muted">No encuentro esta nota.</p>}
      {rendered && (
        <>
          {/* eslint-disable-next-line */}
          <article ref={box} className="note" onClick={onClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />
          {rendered.hasMermaid && <Mermaid container={box} html={rendered.html} />}
        </>
      )}
    </Page>
  );
}
