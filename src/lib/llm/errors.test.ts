import { describe, it, expect } from 'vitest';
import { asLlmError, describeLlmError } from './errors';
import type { LlmErrorKind } from './types';

const ALL_KINDS: LlmErrorKind[] = [
  'Unreachable',
  'Unauthorized',
  'TlsUntrusted',
  'ModelNotFound',
  'CliMissing',
  'CliNotLoggedIn',
  'Timeout',
  'BadResponse',
  'NotValidated',
  'Storage',
];

describe('describeLlmError', () => {
  it('gives every kind a non-empty message and action', () => {
    for (const kind of ALL_KINDS) {
      const v = describeLlmError({ kind, detail: 'x' });
      expect(v.message.length).toBeGreaterThan(5);
      expect(v.action.length).toBeGreaterThan(5);
    }
  });

  it('TlsUntrusted points at the Advanced root certificate', () => {
    const v = describeLlmError({ kind: 'TlsUntrusted' });
    expect(v.action).toMatch(/certificado ra[ií]z/i);
    expect(v.action).toMatch(/Avanzado/);
  });

  it('is engine-aware for missing CLIs and logins', () => {
    expect(describeLlmError({ kind: 'CliMissing' }, 'cliClaude').message).toMatch(/Claude Code/);
    expect(describeLlmError({ kind: 'CliMissing' }, 'cliGemini').message).toMatch(/Gemini CLI/);
    expect(describeLlmError({ kind: 'CliMissing' }, 'openAiCompat').message).toMatch(/Azure CLI/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'cliClaude').action).toMatch(/claude/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'cliGemini').action).toMatch(/gemini/);
    expect(describeLlmError({ kind: 'CliNotLoggedIn' }, 'openAiCompat').action).toMatch(/az login/);
  });

  it('includes the detail of a bad response', () => {
    expect(describeLlmError({ kind: 'BadResponse', detail: 'status 500: boom' }).message).toMatch(/status 500: boom/);
  });
});

describe('asLlmError', () => {
  it('passes typed errors through', () => {
    expect(asLlmError({ kind: 'Timeout' })).toEqual({ kind: 'Timeout' });
  });
  it('wraps anything else as BadResponse', () => {
    expect(asLlmError('boom')).toEqual({ kind: 'BadResponse', detail: 'boom' });
    expect(asLlmError(new Error('x'))).toEqual({ kind: 'BadResponse', detail: 'Error: x' });
    expect(asLlmError(null)).toEqual({ kind: 'BadResponse', detail: 'null' });
  });
});
