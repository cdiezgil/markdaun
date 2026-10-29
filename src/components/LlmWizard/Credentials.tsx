import React, { useCallback, useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { llmDetectCli, llmOAuthLoginGoogle, llmOAuthStartAnthropic, llmOAuthFinishAnthropic, llmOAuthStatus } from '../../lib/tauri';
import { openExternal } from '../../lib/openExternal';
import {
  DEFAULT_AZURE_SCOPE,
  isCliEngine,
  type AuthHeader,
  type CliDetection,
  type Connection,
  type OAuthTokens,
} from '../../lib/llm/types';
import type { Preset } from '../../lib/llm/presets';
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
  preset: Preset | null;
  draft: Connection;
  secret: string;
  onChange: (draft: Connection) => void;
  onSecret: (secret: string) => void;
  onBack: () => void;
  onNext: () => void;
}

type AuthChoice = 'token' | 'az' | 'none';

function authChoice(d: Connection): AuthChoice {
  if (d.auth.type === 'azureCli') return 'az';
  if (d.auth.type === 'none') return 'none';
  return 'token';
}

function parseHeaders(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (name && value) out.push([name, value]);
  }
  return out;
}

function formatHeaders(h: [string, string][]): string {
  return h.map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function Credentials({ preset, draft, secret, onChange, onSecret, onBack, onNext }: Props): JSX.Element {
  const isCli = isCliEngine(draft.engine);
  const isOAuth = draft.auth.type === 'oauth';
  const isEditing = draft.id !== '';
  const [cli, setCli] = useState<CliDetection | null>(null);
  const [headersText, setHeadersText] = useState(formatHeaders(draft.extraHeaders));
  // OAuth state
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'pending' | 'paste' | 'done' | 'error'>('idle');
  const [oauthEmail, setOauthEmail] = useState<string | undefined>();
  const [oauthError, setOauthError] = useState<string | undefined>();
  const [anthropicVerifier, setAnthropicVerifier] = useState('');
  const [pastedCode, setPastedCode] = useState('');

  const check = useCallback(() => {
    llmDetectCli(draft.engine)
      .then((d) => setCli(d ?? { installed: false, path: null }))
      .catch(() => setCli({ installed: false, path: null }));
  }, [draft.engine]);

  useEffect(() => {
    if (isCli) check();
  }, [isCli, check]);

  // On mount: check if already logged in for OAuth presets
  useEffect(() => {
    if (!isOAuth || draft.auth.type !== 'oauth') return;
    llmOAuthStatus(draft.auth.provider)
      .then((s) => {
        if (s.loggedIn) {
          setOauthEmail(s.email);
          setOauthStatus('done');
        }
      })
      .catch(() => {});
  }, [isOAuth, draft.auth]);

  const patch = (p: Partial<Connection>) => onChange({ ...draft, ...p });
  const choice = authChoice(draft);
  const showSecret = !isCli && choice === 'token';
  const model = draft.models[0] ?? '';

  const urlOk = /^https?:\/\/[^\s<>]+$/.test(draft.baseUrl ?? '');
  const modelOk = model.trim() !== '';
  const secretOk = !showSecret || secret.trim() !== '' || isEditing;
  const oauthOk = isOAuth ? oauthStatus === 'done' : true;
  const canContinue = isCli
    ? Boolean(cli?.installed) && modelOk
    : isOAuth
    ? oauthOk && modelOk
    : urlOk && modelOk && secretOk;

  const connectGoogle = async () => {
    setOauthStatus('pending');
    setOauthError(undefined);
    try {
      const tokens: OAuthTokens = await llmOAuthLoginGoogle();
      setOauthEmail(tokens.email);
      setOauthStatus('done');
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e));
      setOauthStatus('error');
    }
  };

  const startAnthropic = async () => {
    setOauthStatus('pending');
    setOauthError(undefined);
    try {
      const [url, verifier] = await llmOAuthStartAnthropic();
      setAnthropicVerifier(verifier);
      await openExternal(url);
      setOauthStatus('paste');
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e));
      setOauthStatus('error');
    }
  };

  const finishAnthropic = async () => {
    setOauthStatus('pending');
    setOauthError(undefined);
    try {
      const tokens: OAuthTokens = await llmOAuthFinishAnthropic(pastedCode, anthropicVerifier);
      setOauthEmail(tokens.email);
      setOauthStatus('done');
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e));
      setOauthStatus('error');
    }
  };

  const setAuth = (c: AuthChoice) => {
    if (c === 'az') patch({ auth: { type: 'azureCli', scope: DEFAULT_AZURE_SCOPE } });
    else if (c === 'none') patch({ auth: { type: 'none' } });
    else patch({ auth: { type: 'apiKey' } });
  };

  const pickCa = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: 'Certificado (PEM)', extensions: ['pem', 'crt', 'cer'] }],
    });
    if (typeof picked === 'string') patch({ caCertPath: picked });
  };

  return (
    <div data-testid="step-credentials" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={title}>{preset?.name ?? draft.name}</h2>
      {preset && <p style={muted}>{preset.help}</p>}

      {/* ── OAuth panel ─────────────────────────────────────────────── */}
      {isOAuth && draft.auth.type === 'oauth' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Google — full local callback */}
          {draft.auth.provider === 'google' && (
            <>
              {oauthStatus === 'done' && (
                <p style={{ ...muted, color: 'var(--daun)' }}>
                  ✓ Conectado{oauthEmail ? ` como ${oauthEmail}` : ''}
                </p>
              )}
              {oauthStatus === 'pending' && (
                <p style={muted}>Esperando la autorización en el navegador… (máx. 5 min)</p>
              )}
              {oauthStatus !== 'done' && (
                <button
                  data-testid="oauth-connect-google"
                  style={{ ...primaryButton, alignSelf: 'flex-start' }}
                  disabled={oauthStatus === 'pending'}
                  onClick={() => void connectGoogle()}
                >
                  {oauthStatus === 'pending' ? 'Conectando…' : 'Conectar con Google'}
                </button>
              )}
              {oauthStatus === 'done' && (
                <button
                  style={{ ...ghostButton, alignSelf: 'flex-start' }}
                  onClick={() => { setOauthStatus('idle'); setOauthEmail(undefined); }}
                >
                  Cambiar cuenta
                </button>
              )}
            </>
          )}

          {/* Anthropic — paste code */}
          {draft.auth.provider === 'anthropic' && (
            <>
              {oauthStatus === 'done' && (
                <p style={{ ...muted, color: 'var(--daun)' }}>
                  ✓ Conectado{oauthEmail ? ` como ${oauthEmail}` : ''}
                </p>
              )}
              {oauthStatus === 'idle' || oauthStatus === 'error' ? (
                <button
                  data-testid="oauth-connect-anthropic"
                  style={{ ...primaryButton, alignSelf: 'flex-start' }}
                  onClick={() => void startAnthropic()}
                >
                  Conectar con Anthropic
                </button>
              ) : null}
              {(oauthStatus === 'paste') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <p style={muted}>
                    El navegador se ha abierto en claude.ai. Autoriza el acceso y luego copia
                    el código que aparece en la barra de dirección del navegador.
                  </p>
                  <input
                    data-testid="oauth-paste-code"
                    style={input}
                    placeholder="Pega aquí el código de autorización"
                    value={pastedCode}
                    onChange={(e) => setPastedCode(e.target.value)}
                  />
                  <button
                    data-testid="oauth-finish-anthropic"
                    style={{ ...primaryButton, alignSelf: 'flex-start' }}
                    disabled={!pastedCode.trim()}
                    onClick={() => void finishAnthropic()}
                  >
                    Confirmar
                  </button>
                </div>
              )}
              {oauthStatus === 'pending' && <p style={muted}>Intercambiando token…</p>}
              {oauthStatus === 'done' && (
                <button
                  style={{ ...ghostButton, alignSelf: 'flex-start' }}
                  onClick={() => { setOauthStatus('idle'); setOauthEmail(undefined); setPastedCode(''); }}
                >
                  Cambiar cuenta
                </button>
              )}
            </>
          )}

          {oauthError && <p style={errorText}>{oauthError}</p>}
        </div>
      )}

      {/* ── Model selector (always shown, also for OAuth) ────────────── */}

      {/* ── CLI / API-key panels (skip for OAuth) ─────────────── */}
      {!isOAuth && isCli ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p data-testid="cli-status" style={{ ...muted, color: cli?.installed ? 'var(--daun)' : 'var(--ink-muted)' }}>
            {cli === null ? 'Comprobando…' : cli.installed ? `Instalado (${cli.path})` : 'No encontrado'}
          </p>
          <p data-testid="cli-instructions" style={muted}>
            Si aún no has iniciado sesión, ejecuta{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>{preset?.cliLogin ?? draft.engine}</code> en una terminal
            y completa el acceso. La sesión se comprueba en el siguiente paso.
          </p>
          <button data-testid="cli-check-again" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={check}>
            Comprobar de nuevo
          </button>
        </div>
      ) : !isOAuth ? (
        <>
          <div style={field}>
            <label style={label} htmlFor="base-url">URL del endpoint</label>
            <input
              id="base-url"
              data-testid="base-url-input"
              style={input}
              value={draft.baseUrl ?? ''}
              placeholder="https://…"
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </div>

          {preset?.route === 'company' && (
            <div style={field}>
              <label style={label} htmlFor="auth">Autenticación</label>
              <select
                id="auth"
                data-testid="auth-select"
                style={input}
                value={choice}
                onChange={(e) => setAuth(e.target.value as AuthChoice)}
              >
                <option value="token">Token o clave</option>
                <option value="az">Azure CLI (az login)</option>
                <option value="none">Sin autenticación</option>
              </select>
            </div>
          )}

          {showSecret && (
            <div style={field}>
              <label style={label} htmlFor="secret">API key o token</label>
              <input
                id="secret"
                data-testid="secret-input"
                type="password"
                autoComplete="off"
                style={input}
                value={secret}
                placeholder={isEditing ? 'Dejar en blanco para mantener la actual' : 'Pega aquí tu clave'}
                onChange={(e) => onSecret(e.target.value)}
              />
              {preset?.keyUrl && (
                <button
                  data-testid="open-key-page"
                  style={{ ...secondaryButton, alignSelf: 'flex-start' }}
                  onClick={() => void openExternal(preset.keyUrl as string)}
                >
                  Abrir página para crear la clave
                </button>
              )}
            </div>
          )}
        </>
      ) : null}

      <div style={field}>
        <label style={label} htmlFor="test-model">
          {isCli ? 'Modelo' : 'Modelo (o despliegue) con el que probar'}
        </label>
        <input
          id="test-model"
          data-testid="test-model-input"
          list="suggested-models"
          style={input}
          value={model}
          onChange={(e) => patch({ models: [e.target.value] })}
        />
        <datalist id="suggested-models">
          {(preset?.suggestedModels ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {!isCli && !isOAuth && (
        <details data-testid="advanced">
          <summary style={{ ...label, cursor: 'pointer' }}>Avanzado</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <div style={field}>
              <label style={label} htmlFor="auth-header">Cabecera de autenticación</label>
              <select
                id="auth-header"
                data-testid="auth-header-select"
                style={input}
                value={draft.authHeader}
                onChange={(e) => patch({ authHeader: e.target.value as AuthHeader })}
              >
                <option value="bearer">Authorization: Bearer</option>
                <option value="apiKey">api-key</option>
                <option value="xApiKey">x-api-key</option>
              </select>
            </div>
            <div style={field}>
              <label style={label} htmlFor="extra-headers">Cabeceras extra (una por línea, «Nombre: valor»)</label>
              <textarea
                id="extra-headers"
                data-testid="extra-headers-input"
                style={{ ...input, minHeight: 64, fontFamily: 'var(--font-mono)' }}
                value={headersText}
                onChange={(e) => {
                  setHeadersText(e.target.value);
                  patch({ extraHeaders: parseHeaders(e.target.value) });
                }}
              />
            </div>
            {draft.azureApiVersion !== null && (
              <div style={field}>
                <label style={label} htmlFor="azure-version">Versión de API de Azure</label>
                <input
                  id="azure-version"
                  data-testid="azure-api-version-input"
                  style={input}
                  value={draft.azureApiVersion}
                  onChange={(e) => patch({ azureApiVersion: e.target.value })}
                />
              </div>
            )}
            <div style={field}>
              <label style={label} htmlFor="ca-path">Certificado raíz propio (PEM)</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input id="ca-path" data-testid="ca-path" readOnly style={input} value={draft.caCertPath ?? ''} />
                <button data-testid="pick-ca" style={secondaryButton} onClick={() => void pickCa()}>
                  Elegir archivo…
                </button>
                <button data-testid="clear-ca" style={ghostButton} onClick={() => patch({ caCertPath: null })}>
                  Quitar
                </button>
              </div>
            </div>
          </div>
        </details>
      )}

      {!canContinue && !isCli && draft.baseUrl && !urlOk && (
        <p style={errorText}>La URL debe empezar por http:// o https:// y no contener marcadores como &lt;resource&gt;.</p>
      )}

      <div style={footer}>
        <button data-testid="wizard-back" style={ghostButton} onClick={onBack}>
          Atrás
        </button>
        <button
          data-testid="credentials-next"
          style={disabled(primaryButton, !canContinue)}
          disabled={!canContinue}
          onClick={onNext}
        >
          Validar conexión
        </button>
      </div>
    </div>
  );
}
