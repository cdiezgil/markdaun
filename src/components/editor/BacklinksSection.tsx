import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getBacklinks, type Backlink } from '../../lib/tauri';

interface BacklinksSectionProps {
  notePath: string;
  vaultPath: string;
}

/** "Enlazada desde": notes that link to the open note. Renders nothing when there are none. */
export default function BacklinksSection({ notePath, vaultPath }: BacklinksSectionProps) {
  const navigate = useNavigate();
  const [links, setLinks] = useState<Backlink[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    getBacklinks(notePath, vaultPath)
      .then((result) => {
        if (!cancelled) setLinks(result);
      })
      .catch(() => {
        if (!cancelled) setLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notePath, vaultPath]);

  if (links.length === 0) return null;

  return (
    <section
      aria-label="Backlinks"
      data-testid="backlinks-section"
      style={{
        borderTop: '1px solid var(--line)',
        paddingTop: 'var(--space-5)',
        marginTop: 'var(--space-8)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--ink)' }}>
          Enlazada desde
        </h2>
        <span
          data-testid="backlinks-count"
          style={{
            fontSize: 11,
            lineHeight: '16px',
            fontWeight: 500,
            padding: '0 7px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--line)',
            color: 'var(--ink-muted)',
          }}
        >
          {links.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {links.map((link) => (
          <a
            key={link.path}
            href={`/editor/${encodeURIComponent(link.path)}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/editor/${encodeURIComponent(link.path)}`);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 30,
              padding: '0 10px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
              lineHeight: '18px',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            <FileText size={14} strokeWidth={1.5} color="var(--daun)" aria-hidden="true" />
            {link.name}
          </a>
        ))}
      </div>
    </section>
  );
}
