import React, { useEffect } from 'react';
import { useVaultStore } from '../store/vaultStore';
import { useBrainStore } from '../store/brainStore';
import { useLlmStore } from '../store/llmStore';
import { SetupPrompt } from '../components/SecondBrain/SetupPrompt';
import { ChatPanel } from '../components/SecondBrain/ChatPanel';

export function SecondBrainView(): JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const active = useLlmStore((s) => s.active);
  const loaded = useLlmStore((s) => s.loaded);
  const loadLlm = useLlmStore((s) => s.load);
  const loadConversations = useBrainStore((s) => s.loadConversations);

  useEffect(() => {
    void loadLlm();
    if (vaultPath) {
      void loadConversations(vaultPath);
    }
  }, [vaultPath, loadLlm, loadConversations]);

  return (
    <div
      data-testid="second-brain-view"
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--bg)',
      }}
    >
      {!loaded ? null : !active ? (
        <SetupPrompt />
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChatPanel vaultPath={vaultPath ?? ''} />
        </div>
      )}
    </div>
  );
}
