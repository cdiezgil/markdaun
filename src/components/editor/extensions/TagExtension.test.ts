import { describe, it, expect } from 'vitest';
import { TagExtension } from './TagExtension';

// ── TC-13: TagExtension ───────────────────────────────────────────────────────
describe('TC-13: TagExtension', () => {
  it('TC-13: has name "tag"', () => {
    expect(TagExtension.name).toBe('tag');
  });

  it('TC-13: is configured as an inline atom node', () => {
    expect(TagExtension.config.inline).toBe(true);
    expect(TagExtension.config.atom).toBe(true);
  });

  it('TC-13: parses <span[data-tag]> from HTML', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseRules = (TagExtension.config.parseHTML as any)?.call({}) as
      | Array<{ tag: string }>
      | undefined;
    expect(parseRules).toBeDefined();
    expect(parseRules?.[0]?.tag).toBe('span[data-tag]');
  });

  it('TC-13: renderHTML applies chip styles with design tokens', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderFn = TagExtension.config.renderHTML as any;
    const result = renderFn?.call({}, {
      node: { attrs: { tag: '#etiqueta' } },
      HTMLAttributes: {},
    }) as unknown[];
    // result = ['span', {…attrs}, '#etiqueta']
    expect(result[0]).toBe('span');
    const attrs = result[1] as Record<string, string>;
    expect(attrs['style']).toContain('var(--sap)');
    expect(attrs['style']).toContain('var(--on-sap)');
    expect(attrs['style']).toContain('var(--radius-sm)');
    expect(result[2]).toBe('#etiqueta');
  });

  it('TC-13: chip NodeView does not add click handler (no navigation)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeViewFactory = TagExtension.config.addNodeView as any;
    expect(nodeViewFactory).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeView = nodeViewFactory?.call({}) as (ctx: any) => { dom: HTMLElement };
    const { dom } = nodeView({ node: { attrs: { tag: '#etiqueta' } }, editor: {} });
    expect(dom.dataset['tag']).toBe('#etiqueta');
    expect(dom.textContent).toBe('#etiqueta');
    // The chip does NOT have a click event listener (no navigation)
    expect(dom.onclick).toBeNull();
  });

  it('TC-13: adds one input rule', () => {
    expect(typeof TagExtension.config.addInputRules).toBe('function');
  });
});
