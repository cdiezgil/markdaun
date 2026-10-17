import type { Engine, LlmError, LlmErrorKind } from './types';

export interface ErrorView {
  message: string;
  action: string;
}

const KINDS: LlmErrorKind[] = [
  'Unreachable',
  'Unauthorized',
  'TlsUntrusted',
  'ModelNotFound',
  'CliMissing',
  'CliNotLoggedIn',
  'Timeout',
  'VisionUnsupported',
  'BadResponse',
  'NotValidated',
  'Storage',
];

/** Normalize whatever `invoke` rejected with into a typed LlmError. */
export function asLlmError(e: unknown): LlmError {
  if (e && typeof e === 'object' && 'kind' in e && KINDS.includes((e as LlmError).kind)) {
    return e as LlmError;
  }
  return { kind: 'BadResponse', detail: String(e) };
}

export function describeLlmError(err: LlmError, engine?: Engine): ErrorView {
  switch (err.kind) {
    case 'Unreachable':
      return {
        message: 'No se pudo conectar con el endpoint.',
        action: 'Comprueba la URL y tu conexión a internet o VPN.',
      };
    case 'Unauthorized':
      return {
        message: 'El endpoint rechazó las credenciales.',
        action: 'Revisa la clave o el token e inténtalo de nuevo.',
      };
    case 'TlsUntrusted':
      return {
        message: 'No se confía en el certificado TLS del endpoint.',
        action:
          'Tu empresa puede estar interceptando TLS. Añade su certificado raíz en Avanzado.',
      };
    case 'ModelNotFound':
      return {
        message: 'El modelo no existe en este endpoint.',
        action: 'Elige otro modelo o revisa la URL.',
      };
    case 'CliMissing':
      if (engine === 'cliClaude') {
        return {
          message: 'Claude Code no está instalado.',
          action: 'Instálalo, ejecuta `claude` para iniciar sesión y pulsa Comprobar de nuevo.',
        };
      }
      if (engine === 'cliGemini') {
        return {
          message: 'Gemini CLI no está instalado.',
          action: 'Instálalo, ejecuta `gemini` para iniciar sesión y pulsa Comprobar de nuevo.',
        };
      }
      return {
        message: 'Azure CLI (`az`) no está instalado.',
        action: 'Instala Azure CLI, ejecuta `az login` y vuelve a intentarlo.',
      };
    case 'CliNotLoggedIn':
      if (engine === 'cliClaude') {
        return { message: 'Claude Code no tiene sesión iniciada.', action: 'Ejecuta `claude` e inicia sesión.' };
      }
      if (engine === 'cliGemini') {
        return { message: 'Gemini CLI no tiene sesión iniciada.', action: 'Ejecuta `gemini` e inicia sesión.' };
      }
      return { message: 'Azure CLI no tiene sesión iniciada.', action: 'Ejecuta `az login`.' };
    case 'Timeout':
      return {
        message: 'La petición tardó demasiado.',
        action: 'Inténtalo de nuevo; si persiste, revisa la red.',
      };
    case 'VisionUnsupported':
      return {
        message: 'Este modelo no ve imágenes.',
        action: 'Elige otro modelo en la barra inferior.',
      };
    case 'BadResponse':
      return {
        message: `Respuesta inesperada${err.detail ? `: ${err.detail}` : '.'}`,
        action: 'Comprueba que la URL apunta a una API compatible.',
      };
    case 'NotValidated':
      return {
        message: 'La conexión no está validada.',
        action: 'Vuelve a ejecutar la validación.',
      };
    case 'Storage':
      return {
        message: 'No se pudo guardar la configuración.',
        action: err.detail ? `Error de almacenamiento: ${err.detail}` : 'Inténtalo de nuevo.',
      };
  }
}
