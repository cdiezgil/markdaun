import type { QueryScope } from '../tauri';

export const VAULT_SCOPE: QueryScope = { kind: 'vault' };

export const isVaultScope = (s: QueryScope): boolean => s.kind === 'vault';

const stem = (p: string): string => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

/** Text of the context chip (without the "@"). */
export function scopeLabel(scope: QueryScope): string {
  switch (scope.kind) {
    case 'vault':
      return 'Toda la bóveda';
    case 'folder':
      return `Carpeta · ${scope.path}`;
    case 'notes':
      return scope.paths.length === 1 ? `Esta nota · ${stem(scope.paths[0] ?? '')}` : `${scope.paths.length} notas`;
  }
}
