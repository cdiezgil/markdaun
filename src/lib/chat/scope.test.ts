import { describe, it, expect } from 'vitest';
import { scopeLabel, isVaultScope, VAULT_SCOPE } from './scope';

describe('scopeLabel', () => {
  it('names each kind of scope', () => {
    expect(scopeLabel(VAULT_SCOPE)).toBe('Toda la bóveda');
    expect(scopeLabel({ kind: 'notes', paths: ['Test/Primera nota.md'] })).toBe('Esta nota · Primera nota');
    expect(scopeLabel({ kind: 'notes', paths: ['a.md', 'b.md', 'c.md'] })).toBe('3 notas');
    expect(scopeLabel({ kind: 'folder', path: 'Mutua/X' })).toBe('Carpeta · Mutua/X');
  });

  it('isVaultScope', () => {
    expect(isVaultScope(VAULT_SCOPE)).toBe(true);
    expect(isVaultScope({ kind: 'folder', path: 'a' })).toBe(false);
  });
});
