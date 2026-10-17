/** Human-readable text for chat-note backend error codes. */
export function humanizeNoteError(err: unknown): string {
  const msg = typeof err === 'string' ? err : String(err);
  if (msg === 'already_exists') return 'Ya existe una nota con ese nombre.';
  if (msg === 'not_found') return 'Esa nota no existe.';
  if (msg === 'invalid_path') return 'Ruta no válida: usa una ruta relativa dentro de la bóveda que termine en .md.';
  if (msg.startsWith('io_error:')) return 'Error de disco al escribir la nota.';
  return msg;
}
