import { describe, it, expect } from 'vitest';
import { HighlightExtension } from './HighlightExtension';

// ── TC-19: HighlightExtension ─────────────────────────────────────────────────
describe('TC-19: HighlightExtension', () => {
  it('TC-19: has name "highlight"', () => {
    expect(HighlightExtension.name).toBe('highlight');
  });

  it('TC-19: parses <mark[data-highlight]> from HTML', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseRules = (HighlightExtension.config.parseHTML as any)?.call({}) as
      | Array<{ tag: string }>
      | undefined;
    expect(parseRules).toBeDefined();
    expect(parseRules?.[0]?.tag).toBe('mark[data-highlight]');
  });

  it('TC-19: renderHTML returns mark element with design tokens', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderFn = HighlightExtension.config.renderHTML as any;
    const result = renderFn?.call({}, {
      mark: {},
      HTMLAttributes: {},
    }) as unknown[];
    // result = ['mark', {…attrs}, 0]
    expect(result[0]).toBe('mark');
    const attrs = result[1] as Record<string, string>;
    expect(attrs['style']).toContain('var(--mark)');
    expect(attrs['style']).toContain('var(--ink)');
    expect(attrs['data-highlight']).toBe('');
  });

  it('TC-19: extension defines addInputRules', () => {
    // addInputRules is defined
    expect(typeof HighlightExtension.config.addInputRules).toBe('function');
  });
});
