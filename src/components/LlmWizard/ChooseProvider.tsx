import React from 'react';
import { Building2, Cloud, KeyRound, Terminal } from 'lucide-react';
import { presetsForRoute, type Preset, type PresetIcon, type Route } from '../../lib/llm/presets';
import { card, cardGrid, footer, ghostButton, muted, title } from './styles';

interface Props {
  route: Route;
  onSelect: (preset: Preset) => void;
  onBack: () => void;
}

const ICONS: Record<PresetIcon, typeof Terminal> = {
  terminal: Terminal,
  key: KeyRound,
  cloud: Cloud,
  building: Building2,
};

export function ChooseProvider({ route, onSelect, onBack }: Props): JSX.Element {
  return (
    <div data-testid="step-provider" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Elige el proveedor</h2>
      <div style={cardGrid}>
        {presetsForRoute(route).map((p) => {
          const Icon = ICONS[p.icon];
          return (
            <button key={p.id} data-testid={`preset-${p.id}`} style={card} onClick={() => onSelect(p)}>
              <Icon size={20} strokeWidth={1.5} color="var(--daun)" />
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
              <span style={muted}>{p.help}</span>
            </button>
          );
        })}
      </div>
      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
      </div>
    </div>
  );
}
