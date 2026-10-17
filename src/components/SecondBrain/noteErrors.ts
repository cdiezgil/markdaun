/** Human-readable text for chat-note backend error codes. */
export function humanizeNoteError(err: unknown): string {
  const msg = typeof err === 'string' ? err : String(err);
  if (msg === 'already_exists') return 'A note with that name already exists.';
  if (msg === 'not_found') return 'That note does not exist.';
  if (msg === 'invalid_path') return 'Invalid path: use a relative path ending in .md inside the vault.';
  if (msg.startsWith('io_error:')) return 'Disk error while writing the note.';
  return msg;
}
