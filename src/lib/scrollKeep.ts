/** Nearest ancestor (or `el` itself) that scrolls vertically, or null. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if (overflowY === 'auto' || overflowY === 'scroll') return n;
  }
  return null;
}

/**
 * Runs `replace` (which swaps the content under `el`) and puts the scroll
 * position of `el`'s scroll container back afterwards, best-effort.
 */
export function keepScroll(el: HTMLElement | null, replace: () => void): void {
  const scroller = scrollParent(el);
  const top = scroller?.scrollTop ?? 0;
  replace();
  if (scroller) scroller.scrollTop = top;
}
