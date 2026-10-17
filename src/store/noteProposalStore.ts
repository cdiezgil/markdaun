import { create } from 'zustand';
import type { ProposalStatus } from '../components/SecondBrain/NoteProposalCard';

export interface ProposalState {
  status: ProposalStatus;
  absolutePath?: string;
}

interface NoteProposalStore {
  /** In-memory per-message card state, keyed `${messageId}:${blockIndex}`. */
  states: Record<string, ProposalState>;
  set(key: string, state: ProposalState): void;
}

export const useNoteProposalStore = create<NoteProposalStore>((set) => ({
  states: {},
  set: (key, state) => set((s) => ({ states: { ...s.states, [key]: state } })),
}));
