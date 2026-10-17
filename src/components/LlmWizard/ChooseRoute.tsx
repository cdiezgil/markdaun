import React from 'react';
import { Building2, KeyRound, Terminal } from 'lucide-react';
import type { Route } from '../../lib/llm/presets';
import { card, cardGrid, muted, title } from './styles';

interface Props {
  onSelect: (route: Route) => void;
}

const ROUTES: { id: Route; title: string; text: string; Icon: typeof Terminal }[] = [
  {
    id: 'subscription',
    title: 'Usar mi suscripción',
    text: 'Claude Code o Gemini CLI con tu cuenta. Sin claves.',
    Icon: Terminal,
  },
  {
    id: 'apiKey',
    title: 'Tengo una API key',
    text: 'Anthropic, Gemini, Kimi o z.ai con tu propia clave.',
    Icon: KeyRound,
  },
  {
    id: 'company',
    title: 'Endpoint o proxy de mi empresa',
    text: 'Azure Foundry, LiteLLM u otro endpoint compatible con OpenAI.',
    Icon: Building2,
  },
];

export function ChooseRoute({ onSelect }: Props): JSX.Element {
  return (
    <div data-testid="step-route" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>¿Cómo quieres conectarte?</h2>
      <div style={cardGrid}>
        {ROUTES.map(({ id, title: t, text, Icon }) => (
          <button key={id} data-testid={`route-${id}`} style={card} onClick={() => onSelect(id)}>
            <Icon size={20} strokeWidth={1.5} color="var(--daun)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t}</span>
            <span style={muted}>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
