import {
  DEFAULT_AZURE_SCOPE,
  type AuthHeader,
  type AuthSource,
  type Connection,
  type Engine,
} from './types';

export type Route = 'subscription' | 'apiKey' | 'company';
export type PresetIcon = 'terminal' | 'key' | 'cloud' | 'building';

export interface Preset {
  id: string;
  name: string;
  route: Route;
  icon: PresetIcon;
  engine: Engine;
  /** null for CLI engines; '' when the user must supply it (proxy). */
  baseUrl: string | null;
  auth: AuthSource;
  authHeader: AuthHeader;
  azureApiVersion: string | null;
  /** Page where the user creates the key. */
  keyUrl: string | null;
  /** Fallback when the endpoint does not list models; first one is tested by default. */
  suggestedModels: string[];
  help: string;
  /** CLI presets: command that starts the interactive login. */
  cliLogin?: string;
}

// Endpoint URLs and model names are re-verified against provider docs in the
// "Verify preset endpoints" step of this task; keep this table the single source.
export const PRESETS: Preset[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    route: 'subscription',
    icon: 'terminal',
    engine: 'cliClaude',
    baseUrl: null,
    auth: { type: 'none' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['opus', 'sonnet', 'haiku'],
    help: 'Usa tu suscripción de Claude a través de la CLI oficial. No se guarda ninguna clave.',
    cliLogin: 'claude',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    route: 'subscription',
    icon: 'terminal',
    engine: 'cliGemini',
    baseUrl: null,
    auth: { type: 'none' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    help: 'Usa tu cuenta de Google a través de la CLI oficial de Gemini. Ojo: Google ya no soporta Gemini Code Assist para particulares en esta CLI (las cuentas migran a Antigravity, que no tiene CLI usable); si tu cuenta se vio afectada, usa Gemini API con clave.',
    cliLogin: 'gemini',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    route: 'apiKey',
    icon: 'key',
    engine: 'anthropicMessages',
    baseUrl: 'https://api.anthropic.com',
    auth: { type: 'apiKey' },
    authHeader: 'xApiKey',
    azureApiVersion: null,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    suggestedModels: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
    help: 'Clave de la consola de Anthropic (facturación por uso).',
  },
  {
    id: 'gemini-api',
    name: 'Gemini API',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://aistudio.google.com/apikey',
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    help: 'Clave de Google AI Studio, vía el endpoint compatible con OpenAI.',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding Plan',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.kimi.com/coding/v1',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://www.kimi.com/code/console',
    suggestedModels: ['kimi-for-coding'],
    help: 'Clave del plan Kimi Coding (cuota de suscripción).',
  },
  {
    id: 'kimi-api',
    name: 'Kimi (pago por uso)',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.moonshot.ai/v1',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://platform.kimi.ai',
    suggestedModels: ['kimi-k3', 'kimi-k2.7-code-highspeed'],
    help: 'Clave de la plataforma Moonshot (facturación por uso).',
  },
  {
    id: 'zai-coding',
    name: 'z.ai Coding Plan',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    suggestedModels: ['glm-4.6', 'glm-4.5-air'],
    help: 'Clave del plan GLM Coding de z.ai.',
  },
  {
    id: 'zai-api',
    name: 'z.ai (pago por uso)',
    route: 'apiKey',
    icon: 'key',
    engine: 'openAiCompat',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    suggestedModels: ['glm-4.6', 'glm-4.5-air'],
    help: 'Clave de z.ai con facturación por uso.',
  },
  {
    id: 'azure-openai',
    name: 'Azure Foundry — OpenAI',
    route: 'company',
    icon: 'cloud',
    engine: 'openAiCompat',
    baseUrl: 'https://<resource>.openai.azure.com',
    auth: { type: 'azureCli', scope: DEFAULT_AZURE_SCOPE },
    authHeader: 'bearer',
    azureApiVersion: '2024-10-21',
    keyUrl: null,
    suggestedModels: ['gpt-4.1'],
    help: 'Sustituye <resource> por el nombre de tu recurso. El modelo es el nombre de tu despliegue. Inicia sesión con `az login` o usa una clave.',
  },
  {
    id: 'azure-anthropic',
    name: 'Azure Foundry — Anthropic',
    route: 'company',
    icon: 'cloud',
    engine: 'anthropicMessages',
    baseUrl: 'https://<resource>.services.ai.azure.com/anthropic',
    // Foundry's Anthropic route requires the ai.azure.com scope (MS docs); the
    // cognitiveservices scope is only valid for *.openai.azure.com.
    auth: { type: 'azureCli', scope: 'https://ai.azure.com/.default' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: ['claude-sonnet-5'],
    help: 'Modelos Claude alojados en Azure Foundry. Sustituye <resource> por tu recurso. Inicia sesión con `az login` o usa una clave.',
  },
  {
    id: 'proxy',
    name: 'LiteLLM / proxy compatible con OpenAI',
    route: 'company',
    icon: 'building',
    engine: 'openAiCompat',
    baseUrl: '',
    auth: { type: 'apiKey' },
    authHeader: 'bearer',
    azureApiVersion: null,
    keyUrl: null,
    suggestedModels: [],
    help: 'Cualquier endpoint compatible con OpenAI. En Avanzado puedes cambiar la cabecera de autenticación, añadir cabeceras y un certificado raíz propio.',
  },
];

export function presetsForRoute(route: Route): Preset[] {
  return PRESETS.filter((p) => p.route === route);
}

/** Unsaved connection draft (id = '') pre-filled from a preset. */
export function draftFromPreset(p: Preset): Connection {
  return {
    id: '',
    name: p.name,
    presetId: p.id,
    engine: p.engine,
    baseUrl: p.baseUrl,
    auth: p.auth,
    authHeader: p.authHeader,
    extraHeaders: [],
    caCertPath: null,
    azureApiVersion: p.azureApiVersion,
    models: p.suggestedModels.slice(0, 1),
  };
}
