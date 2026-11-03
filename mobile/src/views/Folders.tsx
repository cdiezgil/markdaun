import { useEffect, useState } from 'react';
import { FileText, Folder } from 'lucide-react';
import { TREE_KEY } from '../store/db';
import { isHidden } from '../notes/resolve';
import { useApp } from '../store/appStore';
import { folderHref, noteHref } from '../router';
import { BackBar, Page } from '../components/ui';

const collator = new Intl.Collator('es');

export function listFolder(paths: string[], folder: string): { folders: string[]; notes: string[] } {
  const prefix = folder ? `${folder}/` : '';
  const folders = new Set<string>();
  const notes: string[] = [];
  for (const p of paths) {
    if (isHidden(p) || !p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) folders.add(rest.slice(0, slash));
    else if (/\.md$/i.test(rest)) notes.push(rest);
  }
  return {
    folders: [...folders].sort(collator.compare),
    notes: notes.sort(collator.compare),
  };
}

export function FolderList({ path }: { path: string }) {
  const db = useApp((s) => s.db);
  const lastRefresh = useApp((s) => s.lastRefresh);
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void db?.get('tree', TREE_KEY).then((t) => {
      if (live) setPaths((t?.entries ?? []).filter((e) => e.type === 'blob').map((e) => e.path));
    });
    return () => {
      live = false;
    };
  }, [db, lastRefresh]);

  const { folders, notes } = listFolder(paths, path);
  const prefix = path ? `${path}/` : '';
  if (!folders.length && !notes.length) return <p className="muted">No hay notas aquí.</p>;
  return (
    <ul className="list">
      {folders.map((f) => (
        <li key={`d:${f}`}>
          <a href={folderHref(prefix + f)}>
            <Folder size={20} strokeWidth={1.5} aria-hidden /> {f}
          </a>
        </li>
      ))}
      {notes.map((n) => (
        <li key={`n:${n}`}>
          <a href={noteHref(prefix + n)}>
            <FileText size={20} strokeWidth={1.5} aria-hidden /> {n.replace(/\.md$/i, '')}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Folders({ path }: { path: string }) {
  const up = path.includes('/') ? folderHref(path.slice(0, path.lastIndexOf('/'))) : '#/';
  return (
    <Page>
      <BackBar title={path.split('/').pop() ?? ''} to={up} />
      <FolderList path={path} />
    </Page>
  );
}
