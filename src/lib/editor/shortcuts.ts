import { isMac } from '../shortcut';

/** Single source of truth for the editor keyboard shortcuts. `Mod` = ⌘ on macOS, Ctrl elsewhere. */

export const SHORTCUT_GROUPS = ['Formato', 'Títulos', 'Bloques', 'Insertar', 'Ayuda'] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export type ShortcutId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'link'
  | 'wikilink'
  | 'table'
  | 'image'
  | 'diagram'
  | 'horizontalRule'
  | 'cheatSheet';

export interface ShortcutDef {
  id: ShortcutId;
  group: ShortcutGroup;
  /** Spanish label shown in the cheat sheet. */
  label: string;
  /** Unmodified key, lower-case (`b`, `1`, `-`, `/`). Mod is always implied. */
  key: string;
  shift?: boolean;
  alt?: boolean;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'bold', group: 'Formato', label: 'Negrita', key: 'b' },
  { id: 'italic', group: 'Formato', label: 'Cursiva', key: 'i' },
  { id: 'strike', group: 'Formato', label: 'Tachado', key: 'x', shift: true },
  { id: 'highlight', group: 'Formato', label: 'Resaltado', key: 'h', shift: true },
  { id: 'code', group: 'Formato', label: 'Código en línea', key: 'e' },
  { id: 'heading1', group: 'Títulos', label: 'Título 1', key: '1', alt: true },
  { id: 'heading2', group: 'Títulos', label: 'Título 2', key: '2', alt: true },
  { id: 'heading3', group: 'Títulos', label: 'Título 3', key: '3', alt: true },
  { id: 'paragraph', group: 'Títulos', label: 'Párrafo', key: '0', alt: true },
  { id: 'codeBlock', group: 'Bloques', label: 'Bloque de código', key: 'e', shift: true },
  { id: 'bulletList', group: 'Bloques', label: 'Lista con viñetas', key: '8', shift: true },
  { id: 'orderedList', group: 'Bloques', label: 'Lista numerada', key: '7', shift: true },
  { id: 'blockquote', group: 'Bloques', label: 'Cita', key: '9', shift: true },
  { id: 'link', group: 'Insertar', label: 'Enlace', key: 'k', shift: true },
  { id: 'wikilink', group: 'Insertar', label: 'Wikilink [[ ]]', key: 'l', shift: true },
  { id: 'table', group: 'Insertar', label: 'Tabla', key: 't', shift: true },
  { id: 'image', group: 'Insertar', label: 'Imagen', key: 'i', shift: true },
  { id: 'diagram', group: 'Insertar', label: 'Diagrama', key: 'm', shift: true },
  { id: 'horizontalRule', group: 'Insertar', label: 'Línea horizontal', key: '-', shift: true },
  { id: 'cheatSheet', group: 'Ayuda', label: 'Atajos de teclado', key: '/' },
];

export function shortcutById(id: ShortcutId): ShortcutDef {
  const found = SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown shortcut: ${id}`);
  return found;
}

/** The combo as a TipTap/ProseMirror key string, e.g. `Mod-Shift-x`. */
export function tiptapKey(s: ShortcutDef): string {
  return ['Mod', s.alt ? 'Alt' : '', s.shift ? 'Shift' : '', s.key].filter(Boolean).join('-');
}

/** Human-readable combo: `⇧⌘X` on macOS, `Ctrl+Shift+X` elsewhere. */
export function formatShortcut(s: ShortcutDef, mac: boolean = isMac()): string {
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) return `${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}⌘${key}`;
  return ['Ctrl', s.alt ? 'Alt' : '', s.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** Value for the `aria-keyshortcuts` attribute. */
export function ariaKeyShortcuts(s: ShortcutDef, mac: boolean = isMac()): string {
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  return [mac ? 'Meta' : 'Control', s.alt ? 'Alt' : '', s.shift ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+');
}

/** `Label · ⌘B` tooltip text. */
export function withShortcut(label: string, id: ShortcutId, mac: boolean = isMac()): string {
  return `${label} · ${formatShortcut(shortcutById(id), mac)}`;
}

export interface TypingRule {
  /** What the user types. */
  typed: string;
  /** What they get. */
  result: string;
}

/** Markdown typing rules listed in the cheat sheet (all enforced by input rules). */
export const MARKDOWN_TYPING_RULES: readonly TypingRule[] = [
  { typed: '# ', result: 'Título 1 (## y ### para 2 y 3)' },
  { typed: '- o * ', result: 'Lista con viñetas' },
  { typed: '1. ', result: 'Lista numerada' },
  { typed: '> ', result: 'Cita' },
  { typed: '```', result: 'Bloque de código (```mermaid + Intro: diagrama)' },
  { typed: '---', result: 'Línea horizontal' },
  { typed: '**texto**', result: 'Negrita' },
  { typed: '*texto* o _texto_', result: 'Cursiva' },
  { typed: '~~texto~~', result: 'Tachado' },
  { typed: '`texto`', result: 'Código en línea' },
  { typed: '==texto==', result: 'Resaltado' },
  { typed: '[texto](url)', result: 'Enlace' },
  { typed: '![alt](ruta)', result: 'Imagen' },
  { typed: '[[nota]]', result: 'Wikilink' },
  { typed: '#etiqueta ', result: 'Etiqueta' },
];
