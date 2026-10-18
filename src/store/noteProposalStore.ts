import { create } from 'zustand';
import type { ProposalStatus } from '../components/SecondBrain/NoteProposalCard';

export interface ProposalState {
  status: ProposalStatus;
  absolutePath?: string;
  /** Acceptance order across the session (accepted cards only). */
  seq?: number;
}

interface NoteProposalStore {
  /** In-memory per-message card state, keyed `${messageId}:${blockIndex}`. */
  states: Record<string, ProposalState>;
  /** Accepted cards so far; stamps `seq`. */
  counter: number;
  set(key: string, state: ProposalState): void;
}

export const useNoteProposalStore = create<NoteProposalStore>((set) => ({
  states: {},
  counter: 0,
  set: (key, state) =>
    set((s) => {
      const accepted = state.status === 'created' || state.status === 'appended';
      if (!accepted) return { states: { ...s.states, [key]: state } };
      const seq = state.seq ?? s.counter + 1;
      return { states: { ...s.states, [key]: { ...state, seq } }, counter: Math.max(s.counter, seq) };
    }),
}));
