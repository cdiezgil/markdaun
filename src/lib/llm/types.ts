// TypeScript mirrors of the Rust types in src-tauri/src/llm (serde camelCase).

export type Engine = 'openAiCompat' | 'anthropicMessages' | 'cliClaude' | 'cliGemini';

export type AuthSource =
  | { type: 'none' }
  | { type: 'apiKey' }
  | { type: 'azureCli'; scope: string };

export type AuthHeader = 'bearer' | 'apiKey' | 'xApiKey';

export interface Connection {
  /** Empty string for an unsaved draft. */
  id: string;
  name: string;
  presetId: string | null;
  engine: Engine;
  baseUrl: string | null;
  auth: AuthSource;
  authHeader: AuthHeader;
  extraHeaders: [string, string][];
  caCertPath: string | null;
  azureApiVersion: string | null;
  models: string[];
  /** Subset of `models` that accept images / PDFs. */
  visionModels: string[];
}

export const DEFAULT_AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';

export function isCliEngine(engine: Engine): boolean {
  return engine === 'cliClaude' || engine === 'cliGemini';
}

export type LlmErrorKind =
  | 'Unreachable'
  | 'Unauthorized'
  | 'TlsUntrusted'
  | 'ModelNotFound'
  | 'CliMissing'
  | 'CliNotLoggedIn'
  | 'Timeout'
  | 'VisionUnsupported'
  | 'BadResponse'
  | 'NotValidated'
  | 'Storage';

export interface LlmError {
  kind: LlmErrorKind;
  detail?: string;
}

export type StepId = 'reach' | 'credential' | 'models' | 'completion';
export type StepStatus = 'running' | 'ok' | 'failed';

/** Payload of the `llm-validate-progress` event. */
export interface ProgressEvent {
  step: StepId;
  status: StepStatus;
  detail?: string | null;
  error?: LlmError | null;
}

export interface ValidateResult {
  token: string;
  /** Models listed by the endpoint (empty = unlisted). */
  available: string[];
  /** Models that may be saved without further checks. */
  verified: string[];
}

export interface ActiveSelection {
  connectionId: string;
  model: string;
}

export interface CliDetection {
  installed: boolean;
  path: string | null;
}
