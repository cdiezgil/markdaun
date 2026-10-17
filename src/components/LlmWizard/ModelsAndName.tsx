import React, { useMemo, useState } from 'react';
import { llmSaveConnection, llmTestVision, llmVerifyModel } from '../../lib/tauri';
import { asLlmError, describeLlmError } from '../../lib/llm/errors';
import type { Connection, LlmError, ValidateResult } from '../../lib/llm/types';
import { visionDefault } from '../../lib/llm/vision';
import {
  disabled,
  errorText,
  field,
  footer,
  ghostButton,
  input,
  label,
  muted,
  primaryButton,
  secondaryButton,
  title,
} from './styles';

interface Props {
  draft: Connection;
  result: ValidateResult;
  secret: string;
  /** Preset suggestions shown even when the endpoint lists nothing. */
  suggested: string[];
  onSaved: (saved: Connection) => void;
  onBack: () => void;
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

export function ModelsAndName({ draft, result, secret, suggested, onSaved, onBack }: Props): JSX.Element {
  const [extra, setExtra] = useState<string[]>([]);
  const [verified, setVerified] = useState<Set<string>>(new Set(result.verified));
  const [selected, setSelected] = useState<string[]>(draft.models.slice(0, 1));
  const [name, setName] = useState(draft.name);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LlmError | null>(null);
  // Per-model vision flag: preset default, overridden by «Probar visión».
  const [vision, setVision] = useState<Record<string, boolean>>({});
  const [probing, setProbing] = useState<string | null>(null);

  const candidates = useMemo(
    () => uniq([...result.available, ...suggested, ...draft.models, ...extra]),
    [result.available, suggested, draft.models, extra],
  );
  const secretOrNull = secret.trim() === '' ? null : secret;

  const select = async (model: string) => {
    setError(null);
    if (!verified.has(model)) {
      setBusy(model);
      try {
        await llmVerifyModel(draft, secretOrNull, result.token, model);
        setVerified((v) => new Set(v).add(model));
      } catch (e) {
        setError(asLlmError(e));
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    setSelected((s) => (s.includes(model) ? s : [...s, model]));
  };

  const toggle = (model: string) => {
    if (selected.includes(model)) {
      setSelected((s) => s.filter((m) => m !== model));
    } else {
      void select(model);
    }
  };

  const addCustom = () => {
    const m = custom.trim();
    if (!m) return;
    setCustom('');
    setExtra((x) => uniq([...x, m]));
    void select(m);
  };

  const sees = (m: string): boolean => {
    if (m in vision) return vision[m];
    // Editing a saved connection keeps its stored flags for models it already had.
    if (draft.id !== '' && draft.models.includes(m)) return (draft.visionModels ?? []).includes(m);
    return visionDefault(m, draft.presetId);
  };

  const probeVision = async (model: string) => {
    setError(null);
    setProbing(model);
    try {
      const ok = await llmTestVision(draft, secretOrNull, model);
      setVision((v) => ({ ...v, [model]: ok }));
    } catch (e) {
      setError(asLlmError(e));
    }
    setProbing(null);
  };

  const canSave = name.trim() !== '' && selected.length > 0 && !saving && busy === null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Keep the candidate order so the first listed selection becomes the default.
      const models = candidates.filter((m) => selected.includes(m));
      const visionModels = models.filter(sees);
      const saved = await llmSaveConnection(
        { ...draft, name: name.trim(), models, visionModels },
        secretOrNull,
        result.token,
      );
      onSaved(saved);
    } catch (e) {
      setError(asLlmError(e));
      setSaving(false);
    }
  };

  const view = error ? describeLlmError(error, draft.engine) : null;

  return (
    <div data-testid="step-models" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>Modelos y nombre</h2>
      <p style={muted}>Elige los modelos que aparecerán en el selector.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {candidates.map((m) => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
            <input
              type="checkbox"
              data-testid={`model-${m}`}
              checked={selected.includes(m)}
              disabled={busy !== null}
              onChange={() => toggle(m)}
            />
            <span>{m}</span>
            {busy === m && <span style={muted}>probando…</span>}
            {busy !== m && !verified.has(m) && !selected.includes(m) && (
              <span style={muted}>(se probará al elegirlo)</span>
            )}
            {selected.includes(m) && (
              <>
                <span data-testid={`vision-${m}`} style={muted}>
                  · {sees(m) ? 'Ve imágenes' : 'Solo texto'}
                </span>
                <button
                  type="button"
                  data-testid={`test-vision-${m}`}
                  style={ghostButton}
                  disabled={probing !== null || busy !== null}
                  onClick={() => void probeVision(m)}
                >
                  {probing === m ? 'Probando visión…' : 'Probar visión'}
                </button>
              </>
            )}
          </label>
        ))}
      </div>

      {selected.some((m) => !sees(m)) && (
        <p data-testid="vision-warning" style={muted}>
          Algún modelo elegido no verá imágenes ni PDFs: no podrás adjuntarlos al chat con él.
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          data-testid="custom-model-input"
          style={input}
          value={custom}
          placeholder="Otro modelo o despliegue"
          onChange={(e) => setCustom(e.target.value)}
        />
        <button data-testid="add-model" style={secondaryButton} onClick={addCustom}>
          Añadir
        </button>
      </div>

      <div style={field}>
        <label style={label} htmlFor="connection-name">Nombre de la conexión</label>
        <input
          id="connection-name"
          data-testid="connection-name"
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {view && (
        <div data-testid="models-error" role="alert">
          <p style={{ ...errorText, fontWeight: 500 }}>{view.message}</p>
          <p style={muted}>{view.action}</p>
        </div>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <button
          data-testid="save-btn"
          style={disabled(primaryButton, !canSave)}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
