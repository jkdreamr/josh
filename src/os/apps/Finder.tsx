import { useEffect, useState, useRef } from 'react';
import { folders, folderById, type Entry, type FolderId } from '../data';
import { AppIcon } from '../icons';
import { useOS, type AppProps } from '../types';
import { ExternalIcon, Favicon, hostOf } from '../util';

const folderTint: Record<FolderId, string> = { school: '#8c1515', work: '#2f6fed', projects: '#7c5cff', music: '#ff5500' };

export default function Finder({ args }: AppProps) {
  const os = useOS();
  const [folder, setFolder] = useState<FolderId>(args.folder ?? 'projects');
  const [sel, setSel] = useState<Entry | null>(null);
  const tapType = useRef('');

  useEffect(() => {
    if (args.folder) {
      setFolder(args.folder);
      setSel(null);
    }
  }, [args.nonce, args.folder]);

  const f = folderById(folder);
  const openEntry = (e: Entry) => e.href && os.openUrl(e.href);

  return (
    <div className="finder">
      <aside className="finder-side" data-drag>
        <div className="side-head" data-drag />
        <p className="side-label">Favorites</p>
        {folders.map((x) => (
          <button
            key={x.id}
            className={`side-item ${x.id === folder ? 'is-sel' : ''}`}
            onClick={() => {
              setFolder(x.id);
              setSel(null);
            }}
          >
            <svg width="15" height="13" viewBox="0 0 24 20" fill={folderTint[x.id]} aria-hidden="true">
              <path d="M2 4a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
            </svg>
            {x.label}
            <span className="side-count">{x.entries.length}</span>
          </button>
        ))}
        <p className="side-label">Desktop</p>
        <button className="side-item" onClick={() => os.open('notes', { note: 'about' })}>
          <svg width="13" height="15" viewBox="0 0 20 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 2h9l5 5v15H3z" /></svg>
          about me.txt
        </button>
        <p className="side-label">Tags</p>
        <div className="side-tags">
          {['#ff5f57', '#febc2e', '#28c840', '#2f8cff', '#bf5af2'].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </div>
      </aside>
      <div className="finder-main">
        <header className="finder-bar" data-drag>
          <b>{f.label}</b>
          <span className="finder-sub">{f.entries.length} items</span>
        </header>
        <div className="finder-content">
          <div className="finder-grid" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
            {f.entries.map((e) => (
              <button
                key={e.name}
                className={`finder-item ${sel?.name === e.name ? 'is-sel' : ''}`}
                onPointerDown={(event) => {
                  setSel(e);
                  tapType.current = event.pointerType;
                }}
                onClick={(event) => {
                  if (event.detail === 0) setSel(e);
                  else if (tapType.current === 'touch') openEntry(e);
                }}
                onDoubleClick={() => openEntry(e)}
              >
                <Favicon url={e.href} name={e.name} size={54} radius={14} />
                <span className="fi-name">{e.name}</span>
                {(e.role || e.meta) && <span className="fi-meta">{e.role ?? e.meta}</span>}
              </button>
            ))}
          </div>
          <aside className={`finder-preview ${sel ? 'is-on' : ''}`}>
            {sel ? (
              <>
                <Favicon url={sel.href} name={sel.name} size={84} radius={20} />
                <h3>{sel.name}</h3>
                {sel.role && <p className="fp-role">{sel.role}</p>}
                {sel.meta && <p className="fp-meta">{sel.meta}</p>}
                {sel.blurb && <p className="fp-blurb">{sel.blurb}</p>}
                {sel.href ? (
                  <button className="btn btn-primary" onClick={() => openEntry(sel)}>
                    Open {hostOf(sel.href).split('/')[0]} <ExternalIcon size={11} />
                  </button>
                ) : (
                  <p className="fp-note">no link, just a good memory.</p>
                )}
              </>
            ) : (
              <div className="fp-empty">
                <AppIcon kind="folder" size={64} />
                <p>Select an item to preview it.{os.mobile ? '' : ' Double-click to open.'}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
