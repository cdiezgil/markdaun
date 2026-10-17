import { describe, it, expect } from 'vitest';
import { visionDefault, supportsVision } from './vision';
import { draftFromPreset, PRESETS } from './presets';
import type { Connection } from './types';

describe('visionDefault', () => {
  it('known vision families default to true', () => {
    for (const m of ['claude-sonnet-5-5', 'sonnet', 'opus', 'haiku', 'gpt-4o', 'gpt-4.1', 'gemini-2.5-pro', 'o4-mini']) {
      expect(visionDefault(m), m).toBe(true);
    }
  });

  it('text-only plans and unknown models default to false', () => {
    for (const m of ['kimi-for-coding', 'kimi-k3', 'glm-4.6', 'llama3', 'my-deployment']) {
      expect(visionDefault(m), m).toBe(false);
    }
  });

  it('coding-plan presets are text-only even for look-alike model names', () => {
    expect(visionDefault('gemini-2.5-pro', 'kimi-coding')).toBe(false);
    expect(visionDefault('glm-4.6', 'zai-coding')).toBe(false);
    expect(visionDefault('gemini-2.5-pro', 'gemini-api')).toBe(true);
  });
});

describe('supportsVision', () => {
  it('reads the per-model flag of the connection', () => {
    const c = { visionModels: ['a'] } as unknown as Connection;
    expect(supportsVision(c, 'a')).toBe(true);
    expect(supportsVision(c, 'b')).toBe(false);
    expect(supportsVision(undefined, 'a')).toBe(false);
  });
});

describe('preset drafts', () => {
  it('start with preset vision defaults', () => {
    const claude = draftFromPreset(PRESETS.find((p) => p.id === 'claude-code')!);
    expect(claude.visionModels).toEqual(claude.models);
    const kimi = draftFromPreset(PRESETS.find((p) => p.id === 'kimi-coding')!);
    expect(kimi.visionModels).toEqual([]);
  });
});
