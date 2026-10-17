import React, { useEffect, useState } from 'react';
import { Check, Circle, Loader2, X } from 'lucide-react';
import { llmValidate, onLlmValidateProgress } from '../../lib/tauri';
import { asLlmError, describeLlmError } from '../../lib/llm/errors';
import {
  isCliEngine,
  type Connection,
  type LlmError,
  type StepId,
  type ValidateResult,
} from '../../lib/llm/types';
import {
  disabled,
  errorText,
  footer,
  ghostButton,
  muted,
  primaryButton,
  secondaryButton,
  title,
} from './styles';

interface Props {
  draft: Connection;
  secret: string;
  onSuccess: (result: ValidateResult) => void;
  onContinue: () => void;
  onBack: () => void;
}

type Status = 'pending' | 'running' | 'ok' | 'failed';

const ORDER: StepId[] = ['reach', 'credential', 'models', 'completion'];

function labels(cli: boolean): Record<StepId, string> {
  return cli
    ? {
        reach: 'CLI instalado',
        credential: 'Sesión iniciada',
        models: 'Modelos disponibles',
        completion: 'Respuesta de prueba',
      }
    : {
        reach: 'Endpoint accesible',
        credential: 'Credencial válida',
        models: 'Modelos listados',
        completion: 'Respuesta de prueba',
      };
}

const INITIAL: Record<StepId, Status> = {
  reach: 'pending',
  credential: 'pending',
  models: 'pending',
  completion: 'pending',
};

export function Validation({ draft, secret, onSuccess, onContinue, onBack }: Props): JSX.Element {
  const [statuses, setStatuses] = useState<Record<StepId, Status>>(INITIAL);
  const [details, setDetails] = useState<Partial<Record<StepId, string>>>({});
  const [error, setError] = useState<LlmError | null>(null);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cli = isCliEngine(draft.engine);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setStatuses(INITIAL);
    setDetails({});
    setError(null);
    setDone(false);

    (async () => {
      unlisten = await onLlmValidateProgress((e) => {
        if (cancelled) return;
        setStatuses((s) => ({ ...s, [e.step]: e.status }));
        if (e.detail) setDetails((d) => ({ ...d, [e.step]: e.detail as string }));
        if (e.error) setError(e.error);
      });
      try {
        const result = await llmValidate(draft, secret.trim() === '' ? null : secret);
        if (cancelled) return;
        setDone(true);
        onSuccess(result);
      } catch (e) {
        if (!cancelled) setError(asLlmError(e));
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // `draft`/`secret` are frozen for the lifetime of this step; only retry re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const text = labels(cli);
  const view = error ? describeLlmError(error, draft.engine) : null;

  return (
    <div data-testid="step-validation" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Validando la conexión</h2>
      <p style={muted}>No se guarda nada hasta que todo pase.</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {ORDER.map((id) => {
          const st = statuses[id];
          return (
            <li
              key={id}
              data-testid={`step-${id}`}
              data-status={st}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}
            >
              {st === 'ok' && <Check size={16} strokeWidth={1.5} color="var(--daun)" />}
              {st === 'failed' && <X size={16} strokeWidth={1.5} color="var(--danger)" />}
              {st === 'running' && <Loader2 size={16} strokeWidth={1.5} color="var(--ink-muted)" />}
              {st === 'pending' && <Circle size={16} strokeWidth={1.5} color="var(--ink-muted)" />}
              <span style={{ color: st === 'pending' ? 'var(--ink-muted)' : 'var(--ink)' }}>{text[id]}</span>
              {details[id] && <span style={muted}>· {details[id]}</span>}
            </li>
          );
        })}
      </ol>

      {view && (
        <div data-testid="validation-error" role="alert">
          <p style={{ ...errorText, fontWeight: 500 }}>{view.message}</p>
          <p style={muted}>{view.action}</p>
        </div>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {error && (
            <button data-testid="validation-retry" style={secondaryButton} onClick={() => setAttempt((a) => a + 1)}>
              Reintentar
            </button>
          )}
          {done && !error && (
            <button
              data-testid="validation-continue"
              style={disabled(primaryButton, false)}
              onClick={onContinue}
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
