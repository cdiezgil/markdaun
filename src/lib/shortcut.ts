/** Global-shortcut helpers: build an accelerator from a key press and show it. */

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type Recorded =
  | { accelerator: string }
  | { pending: true }
  | { cancel: true }
  | { error: 'modifier' | 'key' };

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Tab: 'Tab',
};

function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');
}

/** Turns a keydown into a Tauri accelerator such as `Alt+Cmd+N`. */
export function acceleratorFromEvent(e: KeyLike, mac: boolean): Recorded {
  if (e.code === 'Escape') return { cancel: true };
  if (MODIFIER_CODES.test(e.code)) return { pending: true };
  const key = keyName(e.code);
  if (!key) return { error: 'key' };
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return { error: 'modifier' };
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push(mac ? 'Cmd' : 'Super');
  parts.push(key);
  return { accelerator: parts.join('+') };
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘', Super: '⌘' };

/** `Alt+Cmd+N` as `⌥⌘N` on macOS and with plain words elsewhere. */
export function formatAccelerator(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+');
  if (mac) return parts.map((p) => MAC_SYMBOLS[p] ?? p).join('');
  return parts.map((p) => (p === 'Cmd' || p === 'Super' ? 'Win' : p)).join('+');
}

export function shortcutErrorMessage(error: string): string {
  if (error === 'invalid_shortcut') {
    return 'Esa combinación no es válida. Incluye Ctrl, Alt o Cmd y una tecla.';
  }
  const taken = /^shortcut_unavailable:\s*(.*)$/.exec(error);
  if (taken) {
    return `No se pudo registrar el atajo: puede que lo esté usando otra aplicación (${taken[1]}). Elige otro.`;
  }
  return error;
}
