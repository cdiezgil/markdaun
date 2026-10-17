import React from 'react';
import { Sparkles } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';

/** Shown in Second Brain until an AI connection is configured. */
export function SetupPrompt(): JSX.Element {
  const openWizard = useLlmStore((s) => s.openWizard);
  return (
    <div
      data-testid="setup-prompt"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        height: '100%',
        width: '100%',
        padding: 'var(--space-6)',
        fontFamily: 'var(--font-sans)',
        textAlign: 'center',
      }}
    >
      <Sparkles size={20} strokeWidth={1.5} color="var(--daun)" />
      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Conecta una IA</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-muted)', margin: 0, maxWidth: 'var(--measure)' }}>
        Usa tu suscripción, una API key o el endpoint de tu empresa para conversar con tus notas.
      </p>
      <button
        data-testid="setup-prompt-btn"
        onClick={() => openWizard()}
        style={{
          background: 'var(--daun)',
          color: 'var(--on-daun)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Configurar IA
      </button>
    </div>
  );
}
