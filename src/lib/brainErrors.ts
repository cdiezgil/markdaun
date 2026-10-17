/** Human-readable (Spanish UI) messages for Second Brain errors and warnings. */

const LLM_MESSAGES: Record<string, string> = {
  'endpoint unreachable': 'No se pudo alcanzar el servidor del modelo. Revisa la conexión.',
  'credentials rejected': 'El proveedor rechazó las credenciales. Revisa la clave de la conexión.',
  'TLS certificate not trusted': 'El certificado TLS del servidor no es de confianza.',
  'model not found': 'El modelo seleccionado no existe en esta conexión.',
  'CLI not installed': 'La CLI del proveedor no está instalada.',
  'CLI not logged in': 'La CLI del proveedor no tiene la sesión iniciada.',
  'timed out': 'El modelo tardó demasiado en responder (tiempo agotado).',
};

const KIND_TO_DISPLAY: Record<string, string> = {
  Unreachable: 'endpoint unreachable',
  Unauthorized: 'credentials rejected',
  TlsUntrusted: 'TLS certificate not trusted',
  ModelNotFound: 'model not found',
  CliMissing: 'CLI not installed',
  CliNotLoggedIn: 'CLI not logged in',
  Timeout: 'timed out',
};

export const VISION_UNSUPPORTED_MESSAGE =
  'Este modelo no ve imágenes. Cambia de modelo en la barra inferior.';

function rawText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'kind' in e) {
    const { kind, detail } = e as { kind: string; detail?: string };
    if (kind === 'VisionUnsupported') return 'vision_unsupported';
    const known = KIND_TO_DISPLAY[kind];
    if (known) return `llm_error: ${known}`;
    return `llm_error: ${kind}${detail ? `: ${detail}` : ''}`;
  }
  return String(e);
}

export function describeBrainError(e: unknown): string {
  const text = rawText(e);
  if (text === 'not_configured') {
    return 'No hay ninguna conexión de IA activa. Configúrala en Ajustes → Conexiones de IA.';
  }
  if (text === 'vision_unsupported') return VISION_UNSUPPORTED_MESSAGE;
  if (text.startsWith('attachment_error:')) return text.slice('attachment_error:'.length).trim();
  if (text.startsWith('llm_error:')) {
    const detail = text.slice('llm_error:'.length).trim();
    return LLM_MESSAGES[detail] ?? `El modelo devolvió un error: ${detail}`;
  }
  return `No se pudo completar la consulta: ${text}`;
}

export function describeBrainWarning(w: string): string {
  const prefix = 'notes_context_unavailable:';
  if (w.startsWith(prefix)) {
    return `Respuesta sin contexto de tus notas (${w.slice(prefix.length).trim()}).`;
  }
  return w;
}
