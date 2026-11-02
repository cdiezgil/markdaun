export type ErrorKind =
  | 'Offline'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'RateLimited'
  | 'TooLarge'
  | 'MicDenied'
  | 'Unknown';

export class AppError extends Error {
  kind: ErrorKind;
  resetAt?: number;
  status?: number;

  constructor(kind: ErrorKind, message?: string, extra: { resetAt?: number; status?: number } = {}) {
    super(message ?? kind);
    this.name = 'AppError';
    this.kind = kind;
    this.resetAt = extra.resetAt;
    this.status = extra.status;
  }
}
