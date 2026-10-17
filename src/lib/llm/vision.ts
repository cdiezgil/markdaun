import type { Connection } from './types';

// Mirrors `vision_default` in src-tauri/src/llm/connection.rs.
const VISION_PREFIXES = [
  'claude', 'opus', 'sonnet', 'haiku', 'gpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-5', 'gemini', 'o3', 'o4', 'o1',
];
const TEXT_ONLY_PRESETS = new Set(['kimi-coding', 'kimi-api', 'zai-coding', 'zai-api']);

/** Default vision capability of a model (known families see images; unknown = no). */
export function visionDefault(model: string, presetId?: string | null): boolean {
  if (presetId && TEXT_ONLY_PRESETS.has(presetId)) return false;
  const m = model.toLowerCase();
  if (m.includes('kimi') || m.includes('glm')) return false;
  return VISION_PREFIXES.some((p) => m.startsWith(p) || m.includes(`/${p}`));
}

export function supportsVision(conn: Connection | undefined | null, model: string): boolean {
  return !!conn && (conn.visionModels ?? []).includes(model);
}
