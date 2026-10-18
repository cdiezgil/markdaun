import { describe, it, expect, beforeEach } from 'vitest';
import { useNoteProposalStore } from './noteProposalStore';

beforeEach(() => useNoteProposalStore.setState({ states: {}, counter: 0 }));

describe('noteProposalStore', () => {
  it('stamps accepted cards in acceptance order', () => {
    const { set } = useNoteProposalStore.getState();
    set('a:0', { status: 'created', absolutePath: '/v/A.md' });
    set('a:1', { status: 'discarded' });
    set('b:0', { status: 'appended', absolutePath: '/v/B.md' });
    const s = useNoteProposalStore.getState().states;
    expect(s['a:0'].seq).toBe(1);
    expect(s['b:0'].seq).toBe(2);
    expect(s['a:1'].seq).toBeUndefined();
  });
});
