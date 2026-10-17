import { describe, it, expect } from 'vitest';
import { describeBrainError, describeBrainWarning } from './brainErrors';

describe('describeBrainError', () => {
  it('maps not_configured', () => {
    expect(describeBrainError('not_configured')).toMatch(/conexión/i);
  });

  it('maps known LlmError messages carried by llm_error', () => {
    expect(describeBrainError('llm_error: credentials rejected')).toMatch(/credenciales/i);
    expect(describeBrainError('llm_error: endpoint unreachable')).toMatch(/alcanzar/i);
    expect(describeBrainError('llm_error: timed out')).toMatch(/tiempo/i);
    expect(describeBrainError('llm_error: model not found')).toMatch(/modelo/i);
    expect(describeBrainError('llm_error: CLI not installed')).toMatch(/CLI/);
    expect(describeBrainError('llm_error: CLI not logged in')).toMatch(/sesión/i);
    expect(describeBrainError('llm_error: TLS certificate not trusted')).toMatch(/certificado/i);
  });

  it('keeps the detail of unknown llm errors', () => {
    expect(describeBrainError('llm_error: bad response: boom')).toContain('boom');
  });

  it('maps serialized LlmError objects', () => {
    expect(describeBrainError({ kind: 'Unauthorized' })).toMatch(/credenciales/i);
    expect(describeBrainError({ kind: 'BadResponse', detail: 'x' })).toContain('x');
  });

  it('falls back to the raw text', () => {
    expect(describeBrainError('db_error: disk full')).toContain('disk full');
    expect(describeBrainError(new Error('kaput'))).toContain('kaput');
  });
});

describe('describeBrainWarning', () => {
  it('explains missing notes context and keeps the detail', () => {
    const msg = describeBrainWarning('notes_context_unavailable: embed_error: x');
    expect(msg).toMatch(/notas/i);
    expect(msg).toContain('embed_error: x');
  });

  it('passes unknown warnings through', () => {
    expect(describeBrainWarning('other')).toBe('other');
  });
});

describe('attachment errors', () => {
  it('explains vision_unsupported with the bottom-bar hint', () => {
    expect(describeBrainError('vision_unsupported')).toBe(
      'Este modelo no ve imágenes. Cambia de modelo en la barra inferior.',
    );
    expect(describeBrainError({ kind: 'VisionUnsupported' })).toMatch(/no ve imágenes/);
  });

  it('shows attachment_error details as they come (already Spanish)', () => {
    expect(describeBrainError('attachment_error: «a.pdf» supera el límite de 20 MB para PDF.')).toBe(
      '«a.pdf» supera el límite de 20 MB para PDF.',
    );
  });
});
