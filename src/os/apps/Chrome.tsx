import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { embeds, folders, links, type Entry } from '../data';
import { useOS, type AppProps } from '../types';
import { ExternalIcon, Favicon, hostOf, openExternal } from '../util';

type Tab = { id: number; history: string[]; idx: number; reload: number };
type View = { kind: 'newtab' } | { kind: 'frame'; src: string; known: boolean } | { kind: 'blocked'; entry?: Entry };

const NEWTAB = 'chrome://newtab';
const allEntries = folders.flatMap((f) => f.entries);

function entryFor(url: string) {
  const h = hostOf(url);
  return allEntries.find((e) => e.href && hostOf(e.href) === h);
}

function resolve(url: string): View {
  if (url === NEWTAB) return { kind: 'newtab' };
  const u = url.toLowerCase();
  if (u.includes('youtube.com/watch') || u.includes('youtu.be/')) {
    const id = new URL(url).searchParams.get('v') ?? url.split('/').pop() ?? '';
    return { kind: 'frame', src: id === 'nw2rOUypDHE' ? embeds.youtube : `https://www.youtube-nocookie.com/embed/${id}`, known: true };
  }
  if (u.includes('open.spotify.com/album/2ckdl')) return { kind: 'frame', src: embeds.spotify, known: true };
  if (u.includes('soundcloud.com/atkelix')) return { kind: 'frame', src: embeds.soundcloud, known: true };
  const entry = entryFor(url);
  if (entry) return entry.embeddable ? { kind: 'frame', src: entry.href!, known: true } : { kind: 'blocked', entry };
  if (/(^|\.)(google|x|twitter|instagram|linkedin|facebook|github|stanford|crv|cognition|near|panteracapital)\.[a-z]+/.test(hostOf(url)))
    return { kind: 'blocked' };
  return { kind: 'frame', src: url, known: false };
}

function normalize(input: string): string {
  const s = input.trim();
  if (!s) return NEWTAB;
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

const display = (url: string) => (url === NEWTAB ? '' : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));

let tabSeq = 1;

const shortcuts: { name: string; url: string }[] = [
  ...folders.find((f) => f.id === 'projects')!.entries.map((e) => ({ name: e.name, url: e.href! })),
  { name: 'fairytale MV', url: links.youtube },
  { name: 'Cognition', url: 'https://cognition.ai/' },
  { name: 'CRV', url: 'https://www.crv.com/' },
  { name: 'GitHub', url: links.github },
  { name: 'LinkedIn', url: links.linkedin },
];

export default function Chrome({ args }: AppProps) {
  const os = useOS();
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: tabSeq++, history: [args.url ?? NEWTAB], idx: 0, reload: 0 }]);
  const [cur, setCur] = useState(() => tabs[0].id);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!args.url) return;
    const url = args.url;
    setTabs((ts) => {
      const hit = ts.find((t) => t.history[t.idx] === url);
      if (hit) {
        setCur(hit.id);
        return ts;
      }
      const t = { id: tabSeq++, history: [url], idx: 0, reload: 0 };
      setCur(t.id);
      return [...ts, t];
    });
  }, [args.nonce, args.url]);

  const tab = tabs.find((t) => t.id === cur) ?? tabs[0];
  const url = tab.history[tab.idx];
  const view = useMemo(() => resolve(url), [url]);
  const [addr, setAddr] = useState(display(url));
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setAddr(display(url));
    setLoading(view.kind === 'frame');
  }, [url, tab.id, tab.reload, view.kind]);

  const patch = (fn: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.id === tab.id ? fn(t) : t)));
  const navigate = (to: string) => patch((t) => ({ ...t, history: [...t.history.slice(0, t.idx + 1), to], idx: t.idx + 1 }));
  const go = (to: string) => {
    if (to.includes('google.com/search')) {
      openExternal(to);
      return;
    }
    navigate(to);
  };
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    go(normalize(addr));
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const newTab = () => {
    const t = { id: tabSeq++, history: [NEWTAB], idx: 0, reload: 0 };
    setTabs((ts) => [...ts, t]);
    setCur(t.id);
  };
  const closeTab = (id: number) => {
    if (tabs.length === 1) {
      os.close('chrome');
      return;
    }
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === cur) setCur(rest[Math.max(0, i - 1)].id);
  };

  const titleOf = (t: Tab) => {
    const u = t.history[t.idx];
    if (u === NEWTAB) return 'New Tab';
    const e = entryFor(u);
    if (e) return e.name;
    if (u.includes('youtube')) return 'fairytale - YouTube';
    return hostOf(u);
  };

  return (
    <div className="chrome">
      <div className="chrome-tabs" data-drag>
        {tabs.map((t) => (
          <div key={t.id} className={`ctab ${t.id === tab.id ? 'is-cur' : ''}`}>
            <button className="ctab-main" onClick={() => setCur(t.id)}>
              {t.history[t.idx] === NEWTAB ? <span className="ctab-dot" /> : <Favicon url={t.history[t.idx]} name={titleOf(t)} size={14} radius={3} />}
              <span className="ctab-title">{titleOf(t)}</span>
            </button>
            <button className="ctab-x" aria-label="Close tab" onClick={() => closeTab(t.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="ctab-new" aria-label="New tab" onClick={newTab}>
          +
        </button>
      </div>
      <div className="chrome-bar">
        <button aria-label="Back" disabled={tab.idx === 0} onClick={() => patch((t) => ({ ...t, idx: t.idx - 1 }))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button aria-label="Forward" disabled={tab.idx >= tab.history.length - 1} onClick={() => patch((t) => ({ ...t, idx: t.idx + 1 }))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </button>
        <button aria-label="Reload" onClick={() => patch((t) => ({ ...t, reload: t.reload + 1 }))}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
        </button>
        <form className="omnibox" onSubmit={submit}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <input value={addr} onChange={(e) => setAddr(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Search Google or type a URL" aria-label="Address" spellCheck={false} />
        </form>
        <button aria-label="Open in a real tab" title="Open in a real tab" disabled={url === NEWTAB} onClick={() => openExternal(url)}>
          <ExternalIcon size={14} />
        </button>
      </div>
      <div className="chrome-view">
        {view.kind === 'newtab' && <NewTab onGo={go} />}
        {view.kind === 'blocked' && <Blocked url={url} entry={view.entry} />}
        {view.kind === 'frame' && (
          <>
            {loading && <div className="chrome-loading"><span /></div>}
            <iframe
              key={`${tab.id}-${tab.reload}-${view.src}`}
              src={view.src}
              title={titleOf(tab)}
              onLoad={() => setLoading(false)}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {!view.known && (
              <div className="chrome-hint">
                Blank page? Some sites refuse to load inside other sites.
                <button onClick={() => openExternal(url)}>
                  Open {hostOf(url)} <ExternalIcon size={10} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewTab({ onGo }: { onGo: (url: string) => void }) {
  const [q, setQ] = useState('');
  const h = new Date().getHours();
  const greet = h < 5 ? 'up late?' : h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
  return (
    <div className="newtab">
      <h1>
        {greet}
        <span>.</span>
      </h1>
      <p className="newtab-sub">here are a few things i’ve built and places i’ve been.</p>
      <form
        className="newtab-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onGo(normalize(q));
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Google or type a URL" aria-label="Search" />
      </form>
      <div className="shortcuts">
        {shortcuts.map((s) => (
          <button key={s.name} className="shortcut" onClick={() => onGo(s.url)}>
            <Favicon url={s.url} name={s.name} size={46} radius={23} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Blocked({ url, entry }: { url: string; entry?: Entry }) {
  const host = hostOf(url);
  return (
    <div className="blocked">
      <Favicon url={url} name={entry?.name ?? host} size={72} radius={18} />
      <h2>{entry?.name ?? host}</h2>
      {entry && (entry.role || entry.meta) && <p className="blocked-meta">{[entry.role, entry.meta].filter(Boolean).join(' · ')}</p>}
      {entry?.blurb && <p className="blocked-meta">{entry.blurb}</p>}
      <p className="blocked-note">{host} doesn’t allow itself to be shown inside other websites, so here’s a door instead.</p>
      <button className="btn btn-primary" onClick={() => openExternal(url)}>
        Open {host} <ExternalIcon size={11} />
      </button>
    </div>
  );
}
