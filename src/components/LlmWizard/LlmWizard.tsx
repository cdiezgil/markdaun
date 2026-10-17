import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';
import { PRESETS, draftFromPreset, type Preset, type Route } from '../../lib/llm/presets';
import type { Connection, ValidateResult } from '../../lib/llm/types';
import { ChooseRoute } from './ChooseRoute';
import { ChooseProvider } from './ChooseProvider';
import { Credentials } from './Credentials';
import { Validation } from './Validation';
import { ModelsAndName } from './ModelsAndName';
import { ghostButton, modal, muted, overlay } from './styles';

type StepId = 'route' | 'provider' | 'credentials' | 'validation' | 'models';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'route', label: 'Ruta' },
  { id: 'provider', label: 'Proveedor' },
  { id: 'credentials', label: 'Credenciales' },
  { id: 'validation', label: 'Validación' },
  { id: 'models', label: 'Modelos' },
];

/** Full-screen setup wizard. Mounted once in App; driven by llmStore. */
export function LlmWizard(): JSX.Element | null {
  const wizardOpen = useLlmStore((s) => s.wizardOpen);
  const editing = useLlmStore((s) => s.editing);
  const closeWizard = useLlmStore((s) => s.closeWizard);
  const load = useLlmStore((s) => s.load);

  const [step, setStep] = useState<StepId>(editing ? 'credentials' : 'route');
  const [route, setRoute] = useState<Route | null>(null);
  const [preset, setPreset] = useState<Preset | null>(
    editing ? PRESETS.find((p) => p.id === editing.presetId) ?? null : null,
  );
  const [draft, setDraft] = useState<Connection | null>(editing);
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState<ValidateResult | null>(null);

  if (!wizardOpen) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const finish = async () => {
    await load();
    closeWizard();
  };

  return (
    <div data-testid="llm-wizard" style={overlay} role="dialog" aria-modal="true" aria-label="Configurar IA">
      <div style={modal}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <ol
            aria-label="Pasos"
            style={{ display: 'flex', gap: 'var(--space-3)', listStyle: 'none', margin: 0, padding: 0 }}
          >
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                aria-current={s.id === step ? 'step' : undefined}
                style={{
                  ...muted,
                  color: i === stepIndex ? 'var(--daun)' : 'var(--ink-muted)',
                  fontWeight: i === stepIndex ? 600 : 400,
                }}
              >
                {s.label}
              </li>
            ))}
          </ol>
          <button data-testid="wizard-close" aria-label="Cerrar" style={ghostButton} onClick={closeWizard}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {step === 'route' && (
          <ChooseRoute
            onSelect={(r) => {
              setRoute(r);
              setStep('provider');
            }}
          />
        )}

        {step === 'provider' && route && (
          <ChooseProvider
            route={route}
            onBack={() => setStep('route')}
            onSelect={(p) => {
              setPreset(p);
              setDraft(draftFromPreset(p));
              setSecret('');
              setStep('credentials');
            }}
          />
        )}

        {step === 'credentials' && draft && (
          <Credentials
            preset={preset}
            draft={draft}
            secret={secret}
            onChange={setDraft}
            onSecret={setSecret}
            onBack={() => (editing ? closeWizard() : setStep('provider'))}
            onNext={() => {
              setResult(null);
              setStep('validation');
            }}
          />
        )}

        {step === 'validation' && draft && (
          <Validation
            draft={draft}
            secret={secret}
            onSuccess={setResult}
            onContinue={() => setStep('models')}
            onBack={() => setStep('credentials')}
          />
        )}

        {step === 'models' && draft && result && (
          <ModelsAndName
            draft={draft}
            result={result}
            secret={secret}
            suggested={preset?.suggestedModels ?? []}
            onBack={() => setStep('credentials')}
            onSaved={() => void finish()}
          />
        )}
      </div>
    </div>
  );
}
