import { describe, it, expect } from 'vitest';
import { firstAcceptedFolder, folderOf, isNewFolder, digestProgressLabel } from './digest';
import type { ProposalState } from '../../store/noteProposalStore';

const st = (status: ProposalState['status'], absolutePath: string | undefined, seq: number): ProposalState => ({
  status,
  absolutePath,
  seq,
});

describe('folderOf / isNewFolder', () => {
  it('takes the folder part of a vault-relative path', () => {
    expect(folderOf('Mutua/ProyectoX/Acta.md')).toBe('Mutua/ProyectoX');
    expect(folderOf('Acta.md')).toBe('');
    expect(folderOf(' Mutua/Acta.md ')).toBe('Mutua');
  });

  it('flags folders missing from the vault, never the root', () => {
    const folders = ['', 'Personal', 'Mutua', 'Mutua/ProyectoX'];
    expect(isNewFolder('Personal/A.md', folders)).toBe(false);
    expect(isNewFolder('A.md', folders)).toBe(false);
    expect(isNewFolder('Mutua/ProyectoY/A.md', folders)).toBe(true);
    expect(isNewFolder('Nueva/A.md', folders)).toBe(true);
  });
});

describe('firstAcceptedFolder', () => {
  const states: Record<string, ProposalState> = {
    'm1:0': st('discarded', undefined, 1),
    'm1:1': st('created', '/v/Mutua/ProyectoX/B.md', 3),
    'm2:0': st('created', '/v/Personal/A.md', 2),
    'x9:0': st('created', '/v/Otra/Z.md', 1),
    'm2:1': st('pending', undefined, 4),
  };

  it('is the folder of the earliest accepted card of those messages', () => {
    expect(firstAcceptedFolder(states, ['m1', 'm2'], '/v')).toBe('Personal');
  });

  it('is null when nothing was accepted', () => {
    expect(firstAcceptedFolder({ 'm1:0': st('pending', undefined, 1) }, ['m1'], '/v')).toBeNull();
    expect(firstAcceptedFolder(states, [], '/v')).toBeNull();
  });

  it('returns the root as an empty string', () => {
    expect(firstAcceptedFolder({ 'm1:0': st('appended', '/v/Nota.md', 1) }, ['m1'], '/v/')).toBe('');
  });
});

describe('digestProgressLabel', () => {
  it('names the part or the consolidation', () => {
    expect(digestProgressLabel({ source: 's', part: 2, total: 5, consolidating: false })).toBe('Parte 2/5');
    expect(digestProgressLabel({ source: 's', part: 5, total: 5, consolidating: true })).toBe('Consolidando notas…');
    expect(digestProgressLabel(null)).toBeNull();
  });
});
