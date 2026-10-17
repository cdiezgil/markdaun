import React, { useEffect } from 'react';
import { useVaultStore } from '../store/vaultStore';
import { useBrainStore } from '../store/brainStore';
import { useLlmStore } from '../store/llmStore';
import { SetupPrompt } from '../components/SecondBrain/SetupPrompt';
import { ConversationList } from '../components/SecondBrain/ConversationList';
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
        <>
          {/* Left: conversation history sidebar */}
          <div
            style={{
              width: 240,
              background: 'var(--surface-sunken)',
              borderRight: '1px solid var(--line)',
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ConversationList vaultPath={vaultPath ?? ''} />
          </div>

          {/* Right: chat area */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPanel vaultPath={vaultPath ?? ''} />
          </div>
        </>
      )}
    </div>
  );
}
