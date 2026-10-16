import React, { useRef, useState } from 'react';
import { useVaultStore } from '../../store/vaultStore';
import type { VaultEntry } from '../../store/vaultStore';

interface RenameInputProps {
  entry: VaultEntry;
  onDone: () => void;
}

export function RenameInput({ entry, onDone }: RenameInputProps) {
  const renameEntry = useVaultStore((s) => s.renameEntry);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleCommit() {
    const newName = inputRef.current?.value.trim() ?? '';
    if (!newName || newName === entry.name) {
      onDone();
      return;
    }
    setError(null);
    try {
      await renameEntry(entry.path, newName);
      await refreshTree();
      onDone();
    } catch (e) {
      const errStr = typeof e === 'string' ? e : String(e);
      if (errStr === 'already_exists') {
        setError('Ya existe un fichero con ese nombre.');
      } else {
        setError('Error al renombrar el fichero.');
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    } else if (e.key === 'Escape') {
      onDone();
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        autoFocus
        defaultValue={entry.name}
        onKeyDown={handleKeyDown}
        onBlur={handleCommit}
        style={{
          fontSize: 14,
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: '1px solid var(--daun)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px var(--space-2)',
          outline: 'none',
          width: '100%',
        }}
        data-testid="rename-input"
      />
      {error && (
        <span
          style={{ color: 'var(--danger)', fontSize: 12 }}
          data-testid="rename-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}
