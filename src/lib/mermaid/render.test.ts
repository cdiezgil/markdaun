import { describe, it, expect, vi, beforeEach } from 'vitest';

const initialize = vi.fn();
const render = vi.fn();
const factory = vi.fn(() => ({ default: { initialize, render } }));
vi.mock('mermaid', () => factory());

import { getThemeVariables, renderMermaid, __resetMermaidForTests } from './render';

const TOKENS: Record<string, string> = {
  '--font-sans': "'Geist Test', sans-serif",
  '--bg': '#F7F5EF',
  '--surface': '#FFFFFF',
  '--surface-sunken': '#EEEBE2',
  '--line-strong': '#C9C4B5',
  '--ink': '#1B2420',
  '--daun': '#2F6B4F',
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetMermaidForTests();
  for (const [k, v] of Object.entries(TOKENS)) document.documentElement.style.setProperty(k, v);
  render.mockResolvedValue({ svg: '<svg id="x"></svg>' });
});

describe('getThemeVariables', () => {
  it('maps design tokens read from CSS custom properties', () => {
    const v = getThemeVariables();
    expect(v.background).toBe('#F7F5EF');
    expect(v.primaryColor).toBe('#FFFFFF');
    expect(v.primaryBorderColor).toBe('#C9C4B5');
    expect(v.lineColor).toBe('#C9C4B5');
    expect(v.textColor).toBe('#1B2420');
    expect(v.primaryTextColor).toBe('#1B2420');
    expect(v.secondaryColor).toBe('#EEEBE2');
    expect(v.tertiaryColor).toBe('#2F6B4F');
    expect(v.fontFamily).toBe("'Geist Test', sans-serif");
  });
});

describe('renderMermaid', () => {
  it('imports mermaid lazily and only once', async () => {
    expect(factory).not.toHaveBeenCalled();
    await renderMermaid('flowchart TD\n A-->B');
    await renderMermaid('flowchart TD\n A-->C');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('initializes in strict mode without startOnLoad, base theme and no html labels', async () => {
    await renderMermaid('flowchart TD\n A-->B');
    const cfg = initialize.mock.calls[0][0];
    expect(cfg.securityLevel).toBe('strict');
    expect(cfg.startOnLoad).toBe(false);
    expect(cfg.theme).toBe('base');
    expect(cfg.flowchart.htmlLabels).toBe(false);
    expect(cfg.themeVariables.textColor).toBe('#1B2420');
  });

  it('returns the svg with unique ids per call', async () => {
    const a = await renderMermaid('flowchart TD\n A-->B');
    await renderMermaid('flowchart TD\n A-->B');
    expect(a).toEqual({ svg: '<svg id="x"></svg>' });
    expect(render.mock.calls[0][0]).not.toBe(render.mock.calls[1][0]);
    expect(render.mock.calls[0][1]).toBe('flowchart TD\n A-->B');
  });

  it('returns an error message when mermaid throws', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'));
    expect(await renderMermaid('nope')).toEqual({ error: 'Parse error on line 2' });
  });

  it('returns an error when the module fails to load', async () => {
    render.mockRejectedValue('boom');
    expect(await renderMermaid('nope')).toEqual({ error: 'boom' });
  });
});
