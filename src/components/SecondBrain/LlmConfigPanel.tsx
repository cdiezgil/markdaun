import React, { useState } from 'react';
import { useBrainStore } from '../../store/brainStore';

/**
 * Guided LLM configuration panel.
 * Rendered when `!isConfigured` in the SecondBrain view.
 */
export function LlmConfigPanel(): JSX.Element {
  const configure = useBrainStore((s) => s.configure);
  const isLoading = useBrainStore((s) => s.isLoading);
  const error = useBrainStore((s) => s.error);

  const [endpointUrl, setEndpointUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await configure(endpointUrl, apiKey.trim() || null, model);
  };

  return (
    <div
      data-testid="llm-config-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 'var(--space-6)',
      }}
    >
      <form
        onSubmit={handleSave}
        style={{
          width: '100%',
          maxWidth: 'var(--measure)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          fontFamily: 'var(--sans)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--sans)',
            fontWeight: 600,
            fontSize: '1.25rem',
            color: 'var(--ink)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Configura tu LLM
        </h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.875rem', margin: 0 }}>
          Conecta un endpoint compatible con OpenAI para empezar a conversar con tus notas.
        </p>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            color: 'var(--ink)',
            fontWeight: 500,
            fontSize: '0.875rem',
          }}
        >
          URL del endpoint
          <input
            data-testid="llm-endpoint-input"
            type="url"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://api.openai.com/v1/chat/completions"
            required
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--sans)',
              color: 'var(--ink)',
              fontSize: '0.875rem',
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            color: 'var(--ink)',
            fontWeight: 500,
            fontSize: '0.875rem',
          }}
        >
          API key{' '}
          <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>(Opcional)</span>
          <input
            data-testid="llm-apikey-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--sans)',
              color: 'var(--ink)',
              fontSize: '0.875rem',
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            color: 'var(--ink)',
            fontWeight: 500,
            fontSize: '0.875rem',
          }}
        >
          Modelo
          <input
            data-testid="llm-model-input"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            required
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--sans)',
              color: 'var(--ink)',
              fontSize: '0.875rem',
            }}
          />
        </label>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.875rem', margin: 0 }}>{error}</p>
        )}

        <button
          data-testid="llm-save-btn"
          type="submit"
          disabled={isLoading}
          style={{
            background: 'var(--daun)',
            color: 'var(--on-daun)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-4)',
            fontFamily: 'var(--sans)',
            fontWeight: 500,
            fontSize: '0.875rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {isLoading ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </form>
    </div>
  );
}
