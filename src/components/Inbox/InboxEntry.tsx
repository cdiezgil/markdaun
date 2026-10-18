import React, { useEffect } from 'react';
import { Inbox } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useVaultStore } from '../../store/vaultStore';
import { useInboxStore } from '../../store/inboxStore';

/** First sidebar entry: "Entrada · N", above the vault tree. */
export function InboxEntry(): JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const count = useInboxStore((s) => s.items.length);
  const load = useInboxStore((s) => s.load);

  // Imports, drops and archiving change the inbox: refresh with the tree.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, tree, load]);

  return (
    <NavLink
      to="/inbox"
      data-testid="inbox-entry"
      className="md-hover"
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        margin: '0 var(--space-2) var(--space-1)',
        padding: 'var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        lineHeight: '20px',
        color: isActive ? 'var(--daun)' : 'var(--ink)',
        fontWeight: isActive ? 500 : 400,
      })}
    >
      <Inbox size={16} strokeWidth={1.5} />
      <span>{count > 0 ? `Entrada · ${count}` : 'Entrada'}</span>
    </NavLink>
  );
}
