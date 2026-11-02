import React, { useState } from 'react';
import { applyTheme, readThemePreference, saveThemePreference, type ThemePreference } from '../../lib/theme';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

/** Settings → Apariencia: follow the OS theme or force light/dark. */
export function AppearanceSettings(): JSX.Element {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  const choose = (next: ThemePreference) => {
    setTheme(next);
    saveThemePreference(next);
    applyTheme(next);
  };

  return (
    <section data-testid="appearance-section" style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 'var(--space-2)' }}>Apariencia</h2>
      <p style={{ fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)', margin: '0 0 var(--space-3)' }}>
        Sistema sigue el modo claro u oscuro de tu equipo.
      </p>
      <div
        role="radiogroup"
        aria-label="Tema"
        style={{
          display: 'inline-flex',
          padding: 2,
          gap: 2,
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
        }}
      >
        {OPTIONS.map(({ value, label }) => {
          const checked = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => choose(value)}
              style={{
                height: 28,
                padding: '0 var(--space-4)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: checked ? 'var(--bg)' : 'transparent',
                boxShadow: checked ? '0 0 0 1px var(--line-strong)' : 'none',
                color: checked ? 'var(--ink)' : 'var(--ink-muted)',
                fontSize: 13,
                fontWeight: checked ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
