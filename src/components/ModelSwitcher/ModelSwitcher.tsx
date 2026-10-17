import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronUp, Sparkles } from 'lucide-react';
import { useLlmStore } from '../../store/llmStore';

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: 'transparent',
  color: 'var(--ink-muted)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-2)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-2)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--ink)',
  cursor: 'pointer',
  textAlign: 'left',
};

/** Status-bar item: "<connection> · <model>" + popover (opens upwards) to switch. */
export function ModelSwitcher(): JSX.Element | null {
  const connections = useLlmStore((s) => s.connections);
  const active = useLlmStore((s) => s.active);
  const loaded = useLlmStore((s) => s.loaded);
  const load = useLlmStore((s) => s.load);
  const setActive = useLlmStore((s) => s.setActive);
  const openWizard = useLlmStore((s) => s.openWizard);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!loaded) return null;

  const activeConn = connections.find((c) => c.id === active?.connectionId);
  const label = activeConn && active ? `${activeConn.name} · ${active.model}` : 'Elegir modelo';

  return (
    <div
      ref={ref}
      data-testid="model-switcher"
      style={{ position: 'relative' }}
    >
      {connections.length === 0 ? (
        <button data-testid="model-pill" style={pillStyle} onClick={() => openWizard()}>
          <Sparkles size={14} strokeWidth={1.5} color="var(--daun)" />
          Configurar IA
        </button>
      ) : (
        <>
          {open && (
            <div
              data-testid="model-popover"
              role="listbox"
              style={{
                position: 'absolute',
                right: 0,
                zIndex: 40,
                bottom: 'calc(100% + var(--space-2))',
                minWidth: 240,
                maxHeight: '60vh',
                overflow: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-pop)',
                padding: 'var(--space-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              {connections.map((c) => (
                <div key={c.id} role="group" aria-label={c.name}>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 12,
                      color: 'var(--ink-muted)',
                      padding: 'var(--space-1) var(--space-2)',
                    }}
                  >
                    {c.name}
                  </div>
                  {c.models.map((m) => {
                    const selected = active?.connectionId === c.id && active.model === m;
                    return (
                      <button
                        key={m}
                        role="option"
                        aria-selected={selected}
                        data-testid={`model-option-${c.id}-${m}`}
                        style={rowStyle}
                        onClick={async () => {
                          await setActive(c.id, m);
                          setOpen(false);
                        }}
                      >
                        <span>{m}</span>
                        {selected && <Check size={14} strokeWidth={1.5} color="var(--daun)" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div
                style={{
                  borderTop: '1px solid var(--line)',
                  paddingTop: 'var(--space-2)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <button
                  data-testid="model-add"
                  style={rowStyle}
                  onClick={() => {
                    setOpen(false);
                    openWizard();
                  }}
                >
                  + Añadir conexión
                </button>
                <button
                  data-testid="model-manage"
                  style={rowStyle}
                  onClick={() => {
                    setOpen(false);
                    navigate('/settings');
                  }}
                >
                  Gestionar
                </button>
              </div>
            </div>
          )}
          <button
            data-testid="model-pill"
            style={pillStyle}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span>{label}</span>
            <ChevronUp size={14} strokeWidth={1.5} color="var(--ink-muted)" />
          </button>
        </>
      )}
    </div>
  );
}
