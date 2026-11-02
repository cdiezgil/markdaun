import { describe, it, expect } from 'vitest';
import { keepScroll, scrollParent } from './scrollKeep';

function tree() {
  const outer = document.createElement('div');
  outer.style.overflowY = 'auto';
  const inner = document.createElement('div');
  outer.appendChild(inner);
  document.body.appendChild(outer);
  return { outer, inner };
}

describe('scrollKeep', () => {
  it('finds the nearest scrolling ancestor', () => {
    const { outer, inner } = tree();
    expect(scrollParent(inner)).toBe(outer);
    expect(scrollParent(null)).toBeNull();
  });

  it('restores the scroll position after replacing the content', () => {
    const { outer, inner } = tree();
    outer.scrollTop = 120;
    keepScroll(inner, () => {
      outer.scrollTop = 0; // what a content swap does
    });
    expect(outer.scrollTop).toBe(120);
  });

  it('still runs the replacement without a scroll container', () => {
    const lone = document.createElement('div');
    let ran = false;
    keepScroll(lone, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
