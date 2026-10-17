/** Lazy Mermaid loader and renderer. Mermaid is code-split and imported on first use. */

type MermaidApi = typeof import('mermaid').default;

export interface ThemeVariables {
  background: string;
  primaryColor: string;
  primaryBorderColor: string;
  lineColor: string;
  textColor: string;
  primaryTextColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  fontFamily: string;
}

export type RenderResult = { svg: string } | { error: string };

let loader: Promise<MermaidApi> | null = null;
let counter = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!loader) {
    loader = import('mermaid').then((m) => m.default);
    loader.catch(() => {
      loader = null; // allow a retry after a failed load
    });
  }
  return loader;
}

/** Test hook: forget the cached module and id counter. */
export function __resetMermaidForTests(): void {
  loader = null;
  counter = 0;
}

/** Reads the design tokens from computed CSS custom properties (never hard-coded). */
export function getThemeVariables(el: Element = document.documentElement): ThemeVariables {
  const css = getComputedStyle(el);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: token('--bg'),
    primaryColor: token('--surface'),
    primaryBorderColor: token('--line-strong'),
    lineColor: token('--line-strong'),
    textColor: token('--ink'),
    primaryTextColor: token('--ink'),
    secondaryColor: token('--surface-sunken'),
    tertiaryColor: token('--daun'),
    fontFamily: 'Geist, sans-serif',
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function renderMermaid(source: string): Promise<RenderResult> {
  const id = `mermaid-${++counter}`;
  try {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: getThemeVariables(),
      flowchart: { htmlLabels: false },
    });
    const { svg } = await mermaid.render(id, source);
    return { svg };
  } catch (e) {
    // Mermaid leaves its temporary error element in the body on failure.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    return { error: messageOf(e) };
  }
}
