import { describe, it, expect } from 'vitest';
import { PRESETS, draftFromPreset, presetsForRoute } from './presets';
import { isCliEngine } from './types';

describe('PRESETS', () => {
  it('has unique ids and the 11 spec presets', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'claude-code',
      'gemini-cli',
      'anthropic-api',
      'gemini-api',
      'kimi-coding',
      'kimi-api',
      'zai-coding',
      'zai-api',
      'azure-openai',
      'azure-anthropic',
      'proxy',
    ]);
  });

  it('every preset declares engine, auth, auth header, help text and a route', () => {
    for (const p of PRESETS) {
      expect(p.engine, p.id).toBeTruthy();
      expect(p.auth, p.id).toBeTruthy();
      expect(p.authHeader, p.id).toBeTruthy();
      expect(p.help.length, p.id).toBeGreaterThan(10);
      expect(['subscription', 'apiKey', 'company']).toContain(p.route);
    }
  });

  it('CLI presets have no URL; HTTP presets have a valid URL (placeholders allowed)', () => {
    for (const p of PRESETS) {
      if (isCliEngine(p.engine)) {
        expect(p.baseUrl, p.id).toBeNull();
        expect(p.suggestedModels.length, p.id).toBeGreaterThan(0);
        continue;
      }
      if (p.id === 'proxy') {
        expect(p.baseUrl).toBe('');
        continue;
      }
      expect(p.baseUrl, p.id).toBeTruthy();
      const url = new URL((p.baseUrl as string).replace('<resource>', 'myresource'));
      expect(url.protocol, p.id).toBe('https:');
    }
  });

  it('API-key presets link to a page where the key is created', () => {
    for (const p of PRESETS.filter((x) => x.route === 'apiKey')) {
      expect(p.keyUrl, p.id).toMatch(/^https:\/\//);
      expect(p.auth.type).toBe('apiKey');
    }
  });

  it('wires the engine-specific auth the spec requires', () => {
    const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
    expect(byId['anthropic-api'].engine).toBe('anthropicMessages');
    expect(byId['anthropic-api'].authHeader).toBe('xApiKey');
    expect(byId['azure-openai'].auth.type).toBe('azureCli');
    expect(byId['azure-openai'].azureApiVersion).toBeTruthy();
    expect(byId['azure-anthropic'].engine).toBe('anthropicMessages');
    expect(byId['claude-code'].engine).toBe('cliClaude');
    expect(byId['gemini-cli'].engine).toBe('cliGemini');
  });
});

describe('presetsForRoute / draftFromPreset', () => {
  it('groups presets by route', () => {
    expect(presetsForRoute('subscription').map((p) => p.id)).toEqual(['claude-code', 'gemini-cli']);
    expect(presetsForRoute('company').map((p) => p.id)).toEqual(['azure-openai', 'azure-anthropic', 'proxy']);
    expect(presetsForRoute('apiKey')).toHaveLength(6);
  });

  it('builds an unsaved draft from a preset', () => {
    const p = PRESETS.find((x) => x.id === 'anthropic-api')!;
    const d = draftFromPreset(p);
    expect(d.id).toBe('');
    expect(d.presetId).toBe('anthropic-api');
    expect(d.name).toBe(p.name);
    expect(d.baseUrl).toBe('https://api.anthropic.com');
    expect(d.models).toEqual([p.suggestedModels[0]]);
    expect(d.extraHeaders).toEqual([]);
    expect(d.caCertPath).toBeNull();
  });

  it('the proxy draft starts with no models', () => {
    const d = draftFromPreset(PRESETS.find((x) => x.id === 'proxy')!);
    expect(d.models).toEqual([]);
  });
});
