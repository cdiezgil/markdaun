import { useEffect, type RefObject } from 'react';

let counter = 0;

/** Renders every `.mermaid-src` block inside `container`; loads mermaid only when there is one. */
export function Mermaid({ container, html }: { container: RefObject<HTMLElement>; html: string }) {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const blocks = [...root.querySelectorAll<HTMLElement>('.mermaid-src')];
    if (!blocks.length) return;
    let live = true;
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        const dark =
          document.documentElement.getAttribute('data-theme') === 'dark' ||
          (!document.documentElement.getAttribute('data-theme') &&
            window.matchMedia?.('(prefers-color-scheme: dark)').matches);
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
        for (const el of blocks) {
          if (!live) return;
          try {
            const { svg } = await mermaid.render(`mmd-${counter++}`, el.textContent ?? '');
            if (live) {
              el.innerHTML = svg;
              el.classList.remove('mermaid-src');
              el.classList.add('mermaid-done');
            }
          } catch {
            /* leave the source visible when a diagram does not parse */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [container, html]);
  return null;
}
