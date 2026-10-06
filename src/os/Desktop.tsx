import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type MutableRefObject } from 'react';
import { apps, dockOrder, mobileDock } from './registry';
import { AppIcon, type IconKind } from './icons';
import { OSContext, useOS as useOSLocal, type AppId, type OpenArgs, type OSApi } from './types';
import { folders, links, profile } from './data';
import Wallpaper from './Wallpaper';
import { clamp, pacificTime, useNow, useWeather, type Weather } from './hooks';

const MENU_H = 26;
const DOCK_SPACE = 78;
const MIN_W = 320;
const MIN_H = 220;

type Win = {
  id: AppId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
  args: OpenArgs;
  state: 'opening' | 'open' | 'closing';
};

type Props = {
  mobile: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  restart: () => void;
  sleep: () => void;
  apiRef?: MutableRefObject<OSApi | null>;
};

/** Routes a URL to the in-desktop app that best represents it. */
function routeUrl(url: string): { id: AppId; args: OpenArgs } {
  const u = url.toLowerCase();
  if (u.includes('instagram.com/atkelix')) return { id: 'instagram', args: { account: 'music' } };
  if (u.includes('instagram.com')) return { id: 'instagram', args: { account: 'personal' } };
  if (u.includes('x.com/joshuaykoo') || u.includes('twitter.com/joshuaykoo')) return { id: 'x', args: {} };
  if (u.includes('linkedin.com/in/joshuaykoo')) return { id: 'linkedin', args: {} };
  if (u.includes('github.com/jkdreamr')) return { id: 'github', args: {} };
  if (u.includes('soundcloud.com/atkelix')) return { id: 'soundcloud', args: {} };
  if (u.includes('open.spotify.com/album/2ckdlszbkvukyqvswziiup')) return { id: 'spotify', args: {} };
  if (u.startsWith('mailto:')) return { id: 'mail', args: {} };
  return { id: 'chrome', args: { url } };
}

export default function Desktop({ mobile, fullscreen, toggleFullscreen, restart, sleep, apiRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 625 });
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [toast, setToast] = useState(false);
  const zTop = useRef(10);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  // Keep windows reachable when the screen changes size (e.g. entering/leaving full screen).
  useEffect(() => {
    setWins((ws) =>
      ws.map((w) => {
        const nw = Math.min(w.w, size.w - 16);
        const nh = Math.min(w.h, size.h - MENU_H - 12);
        return { ...w, w: nw, h: nh, x: clamp(w.x, 8 - nw / 2, size.w - nw / 2), y: clamp(w.y, MENU_H + 4, size.h - 60) };
      }),
    );
  }, [size.w, size.h]);

  const focus = useCallback((id: AppId) => {
    setWins((ws) => {
      const top = ws.reduce((m, w) => (w.min ? m : Math.max(m, w.z)), 0);
      const target = ws.find((w) => w.id === id);
      if (target && target.z === top && !target.min) return ws;
      zTop.current += 1;
      return ws.map((w) => (w.id === id ? { ...w, z: zTop.current, min: false } : w));
    });
  }, []);

  const open = useCallback((id: AppId, args: OpenArgs = {}) => {
    const def = apps[id];
    const { w: W, h: H } = sizeRef.current;
    zTop.current += 1;
    const z = zTop.current;
    setWins((ws) => {
      const existing = ws.find((w) => w.id === id);
      if (existing) return ws.map((w) => (w.id === id ? { ...w, z, min: false, state: w.state === 'closing' ? 'open' : w.state, args: { ...args, nonce: Date.now() } } : w));
      const availH = H - MENU_H - DOCK_SPACE;
      const w = Math.round(Math.min(def.w, W * 0.86));
      const h = Math.round(Math.min(def.h, availH - 10));
      const n = ws.filter((x) => !x.min).length % 6;
      const x = Math.round(clamp((W - w) / 2 + (n - 2) * 26, 8, W - w - 8));
      const y = Math.round(clamp(MENU_H + (availH - h) / 2 + (n - 2) * 22, MENU_H + 6, H - h - 8));
      return [...ws, { id, x, y, w, h, z, min: false, max: false, args: { ...args, nonce: Date.now() }, state: 'opening' }];
    });
  }, []);

  const close = useCallback((id: AppId) => {
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, state: 'closing' } : w)));
    setTimeout(() => setWins((ws) => ws.filter((w) => !(w.id === id && w.state === 'closing'))), 200);
  }, []);

  const minimize = useCallback((id: AppId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w))), []);
  const toggleMax = useCallback((id: AppId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, max: !w.max } : w))), []);

  const openUrl = useCallback(
    (url: string) => {
      const r = routeUrl(url);
      open(r.id, r.args);
    },
    [open],
  );

  const api: OSApi = useMemo(
    () => ({ open, close, openUrl, mobile, fullscreen, toggleFullscreen, restart, sleep, openLauncher: () => setLauncher(true) }),
    [open, close, openUrl, mobile, fullscreen, toggleFullscreen, restart, sleep],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [api, apiRef]);

  // Welcome notification.
  useEffect(() => {
    const t1 = setTimeout(() => setToast(true), 1400);
    const t2 = setTimeout(() => setToast(false), 9800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLauncher((v) => !v);
      } else if (e.key === 'Escape' && launcher) {
        setLauncher(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launcher]);

  const scaleOf = () => {
    const el = rootRef.current!;
    const r = el.getBoundingClientRect();
    return { x: r.width / el.offsetWidth || 1, y: r.height / el.offsetHeight || 1 };
  };

  const startDrag = (e: RPointerEvent, id: AppId) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || !t.closest('[data-drag]') || t.closest('button, a, input, textarea, select, [data-nodrag]')) return;
    const win = winsRef.current.find((w) => w.id === id);
    if (!win || mobile || win.max) return;
    e.preventDefault();
    const s = scaleOf();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: ox, y: oy } = win;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const { w: W, h: H } = sizeRef.current;
      const nx = clamp(ox + (ev.clientX - sx) / s.x, 60 - win.w, W - 60);
      const ny = clamp(oy + (ev.clientY - sy) / s.y, MENU_H, H - 40);
      setWins((ws) => ws.map((w) => (w.id === id ? { ...w, x: nx, y: ny } : w)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const startResize = (e: RPointerEvent, id: AppId, edge: 'r' | 'b' | 'rb') => {
    e.preventDefault();
    e.stopPropagation();
    const win = winsRef.current.find((w) => w.id === id);
    if (!win) return;
    focus(id);
    const s = scaleOf();
    const sx = e.clientX;
    const sy = e.clientY;
    const { w: ow, h: oh } = win;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const { w: W, h: H } = sizeRef.current;
      const nw = edge === 'b' ? ow : clamp(ow + (ev.clientX - sx) / s.x, MIN_W, W - win.x);
      const nh = edge === 'r' ? oh : clamp(oh + (ev.clientY - sy) / s.y, MIN_H, H - win.y);
      setWins((ws) => ws.map((w) => (w.id === id ? { ...w, w: nw, h: nh } : w)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const visible = wins.filter((w) => !w.min && w.state !== 'closing');
  const active = visible.length ? visible.reduce((a, b) => (a.z > b.z ? a : b)) : null;
  const activeTitle = active ? apps[active.id].title : 'Finder';

  return (
    <OSContext.Provider value={api}>
      <div ref={rootRef} className={`desktop ${mobile ? 'is-mobile' : ''} ${dragging ? 'is-dragging' : ''}`}>
        <Wallpaper />
        {mobile ? <StatusBar /> : <MenuBar title={activeTitle} wins={wins} onFocus={focus} onClose={close} />}

        {mobile ? <HomeScreen /> : <DesktopIcons />}

        {wins.map((w) => {
          const def = apps[w.id];
          const C = def.Component;
          const isActive = active?.id === w.id;
          const style = mobile
            ? { zIndex: w.z }
            : w.max
              ? { zIndex: w.z, left: 0, top: MENU_H, width: size.w, height: size.h - MENU_H }
              : { zIndex: w.z, left: w.x, top: w.y, width: w.w, height: w.h };
          return (
            <section
              key={w.id}
              className={[
                'win',
                `win-${w.id}`,
                `frame-${def.frame ?? 'standard'}`,
                `theme-${def.theme ?? 'light'}`,
                isActive ? 'is-active' : 'is-inactive',
                w.min ? 'is-min' : '',
                w.max ? 'is-max' : '',
                `st-${w.state}`,
              ].join(' ')}
              style={style}
              aria-label={def.title}
              aria-hidden={w.min || undefined}
              onPointerDownCapture={() => focus(w.id)}
              onPointerDown={(e) => startDrag(e, w.id)}
              onDoubleClick={(e) => {
                const t = e.target as HTMLElement;
                if (!mobile && t.closest('[data-drag]') && !t.closest('button, a, input, [data-nodrag]')) toggleMax(w.id);
              }}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget && w.state === 'opening')
                  setWins((ws) => ws.map((x) => (x.id === w.id && x.state === 'opening' ? { ...x, state: 'open' } : x)));
              }}
            >
              {mobile ? (
                <header className="mbar">
                  <button onClick={() => close(w.id)} aria-label={`Close ${def.title}`}>
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2L2 8l6 6" /></svg>
                    Home
                  </button>
                  <b>{def.title}</b>
                </header>
              ) : (
                <>
                  <div className="traffic" data-nodrag>
                    <button className="tl tl-close" aria-label={`Close ${def.title}`} onClick={() => close(w.id)}>
                      <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
                    </button>
                    <button className="tl tl-min" aria-label="Minimize" onClick={() => minimize(w.id)}>
                      <svg viewBox="0 0 10 10"><path d="M2.5 5h5" /></svg>
                    </button>
                    <button className="tl tl-max" aria-label="Zoom" onClick={() => toggleMax(w.id)}>
                      <svg viewBox="0 0 10 10"><path d="M3 6.8V3h3.8zM7 3.2V7H3.2z" /></svg>
                    </button>
                  </div>
                  {(def.frame ?? 'standard') === 'standard' && (
                    <header className="titlebar" data-drag>
                      <span>{def.title}</span>
                    </header>
                  )}
                </>
              )}
              <div className="win-body">
                <C args={w.args} />
              </div>
              {!mobile && !w.max && (
                <>
                  <i className="rz rz-r" onPointerDown={(e) => startResize(e, w.id, 'r')} />
                  <i className="rz rz-b" onPointerDown={(e) => startResize(e, w.id, 'b')} />
                  <i className="rz rz-rb" onPointerDown={(e) => startResize(e, w.id, 'rb')} />
                </>
              )}
            </section>
          );
        })}

        <Dock wins={wins} onFocus={focus} active={active?.id ?? null} screenW={size.w} />

        <div className={`toast ${toast ? 'is-on' : ''}`} role="status">
          <button
            onClick={() => {
              setToast(false);
              open('messages');
            }}
          >
            <AppIcon kind="messages" size={34} />
            <span className="toast-text">
              <b>Josh</b>
              <span>hey, welcome to my computer. poke around — or text me.</span>
            </span>
            <small>now</small>
          </button>
        </div>

        {launcher && <Launcher onClose={() => setLauncher(false)} />}
      </div>
    </OSContext.Provider>
  );
}

/* ---------------------------------- menu bar ---------------------------------- */

type MenuItem = { label: string; hint?: string; action?: () => void } | 'sep';

function Menu({ label, items, bold, className }: { label: ReactNode; items: MenuItem[]; bold?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div className={`menu ${className ?? ''} ${open ? 'is-open' : ''}`} ref={ref}>
      <button className={`menu-btn ${bold ? 'is-bold' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={!it.action}
                onClick={() => {
                  setOpen(false);
                  it.action?.();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function WeatherIcon({ icon }: { icon: Weather['icon'] }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };
  if (icon === 'sun')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (icon === 'moon')
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      </svg>
    );
  if (icon === 'rain' || icon === 'storm')
    return (
      <svg {...common}>
        <path d="M7 15a4 4 0 1 1 1-7.9A5.5 5.5 0 0 1 18.5 9 3.5 3.5 0 0 1 18 16H7" />
        <path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M7 18a4.5 4.5 0 1 1 1.2-8.8A5.8 5.8 0 0 1 19 10.5 3.8 3.8 0 0 1 18 18z" />
    </svg>
  );
}

function MenuBar({ title, wins, onFocus, onClose }: { title: string; wins: Win[]; onFocus: (id: AppId) => void; onClose: (id: AppId) => void }) {
  const os = useOSLocal();
  const now = useNow(15_000);
  const weather = useWeather();
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const openWins = wins.filter((w) => w.state !== 'closing');
  return (
    <div className="menubar">
      <div className="mb-left">
        <Menu
          className="mb-logo"
          label={<span className="logo-mark">jk</span>}
          items={[
            { label: 'About This Josh', action: () => os.open('about') },
            'sep',
            { label: 'Search…', hint: '⌘K', action: os.openLauncher },
            { label: os.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', hint: os.fullscreen ? 'esc' : undefined, action: os.toggleFullscreen },
            'sep',
            { label: 'Sleep', action: os.sleep },
            { label: 'Restart…', action: os.restart },
          ]}
        />
        <Menu bold label={title} items={[{ label: `About ${title}`, action: () => os.open('about') }, 'sep', { label: 'Hide Others' }, { label: 'Quit', action: () => wins.length && onClose(wins.reduce((a, b) => (a.z > b.z ? a : b)).id) }]} />
        <Menu
          className="mb-hide-sm"
          label="Go"
          items={[
            ...folders.map((f) => ({ label: f.label, action: () => os.open('finder', { folder: f.id }) })),
            'sep' as const,
            { label: 'About Me', action: () => os.open('notes') },
            { label: 'Side Projects in Chrome', action: () => os.open('chrome') },
          ]}
        />
        <Menu
          className="mb-hide-sm"
          label="Window"
          items={openWins.length ? openWins.map((w) => ({ label: apps[w.id].title, action: () => onFocus(w.id) })) : [{ label: 'No windows open' }]}
        />
        <Menu
          className="mb-hide-sm"
          label="Help"
          items={[
            { label: 'Search anything', hint: '⌘K', action: os.openLauncher },
            { label: 'Text Josh', action: () => os.open('messages') },
            { label: 'Email Josh', action: () => os.open('mail') },
          ]}
        />
      </div>
      <div className="mb-right">
        {weather && (
          <span className="mb-item mb-weather" title={`${weather.label} in Palo Alto`}>
            <WeatherIcon icon={weather.icon} />
            {weather.temp}° <span className="mb-hide-sm">Palo Alto</span>
          </span>
        )}
        <button className="mb-item mb-icon" onClick={os.toggleFullscreen} aria-label={os.fullscreen ? 'Exit full screen' : 'Full screen'} title={os.fullscreen ? 'Exit full screen (esc)' : 'Full screen'}>
          {os.fullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          )}
        </button>
        <span className="mb-item mb-icon mb-hide-sm" aria-hidden="true">
          <svg width="16" height="12" viewBox="0 0 24 18" fill="currentColor"><path d="M12 3.5c3.6 0 6.9 1.4 9.4 3.7l1.6-1.7A15.8 15.8 0 0 0 12 1.2 15.8 15.8 0 0 0 1 5.5l1.6 1.7A13.4 13.4 0 0 1 12 3.5zm0 4.6c2.4 0 4.6.9 6.2 2.4l1.6-1.7A11.3 11.3 0 0 0 12 5.8c-3 0-5.8 1.2-7.8 3l1.6 1.7A9 9 0 0 1 12 8.1zm0 4.6c1.2 0 2.2.4 3 1.1L12 17l-3-3.2c.8-.7 1.8-1.1 3-1.1z" /></svg>
        </span>
        <span className="mb-item mb-icon mb-hide-sm" aria-hidden="true">
          <svg width="24" height="12" viewBox="0 0 28 13"><rect x=".5" y=".5" width="23" height="12" rx="3.2" fill="none" stroke="currentColor" opacity=".55" /><rect x="2.2" y="2.2" width="16.5" height="8.6" rx="1.8" fill="currentColor" /><path d="M25.2 4.4v4.2c.9-.3 1.5-1.2 1.5-2.1s-.6-1.8-1.5-2.1z" fill="currentColor" opacity=".55" /></svg>
        </span>
        <button className="mb-item mb-icon" onClick={os.openLauncher} aria-label="Search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></svg>
        </button>
        <span className="mb-item mb-clock">
          <span className="mb-hide-sm">{date}&nbsp;&nbsp;</span>
          {time}
        </span>
      </div>
    </div>
  );
}

function StatusBar() {
  const now = useNow(15_000);
  return (
    <div className="statusbar">
      <span>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</span>
      <span className="sb-right">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx=".8" /><rect x="4.5" y="5" width="3" height="6" rx=".8" /><rect x="9" y="2.5" width="3" height="8.5" rx=".8" /><rect x="13.5" y="0" width="3" height="11" rx=".8" /></svg>
        <svg width="25" height="12" viewBox="0 0 28 13"><rect x=".5" y=".5" width="23" height="12" rx="3.2" fill="none" stroke="currentColor" opacity=".55" /><rect x="2.2" y="2.2" width="16.5" height="8.6" rx="1.8" fill="currentColor" /><path d="M25.2 4.4v4.2c.9-.3 1.5-1.2 1.5-2.1s-.6-1.8-1.5-2.1z" fill="currentColor" opacity=".55" /></svg>
      </span>
    </div>
  );
}

/* ------------------------------- desktop icons -------------------------------- */

type DesktopItem = { key: string; label: string; icon: IconKind; run: (os: OSApi) => void };

const desktopItems: DesktopItem[] = [
  { key: 'about', label: 'about me.txt', icon: 'doc', run: (os) => os.open('notes', { note: 'about' }) },
  ...folders.map<DesktopItem>((f) => ({ key: f.id, label: f.label, icon: 'folder', run: (os) => os.open('finder', { folder: f.id }) })),
  { key: 'coxbox', label: 'Cox Box', icon: 'coxbox', run: (os) => os.open('coxbox') },
];

function DesktopIcons() {
  const os = useOSLocal();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="desk-icons" onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
      {desktopItems.map((it) => (
        <button
          key={it.key}
          className={`desk-icon ${sel === it.key ? 'is-sel' : ''}`}
          onClick={() => {
            setSel(it.key);
            it.run(os);
          }}
        >
          <AppIcon kind={it.icon} size={52} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

function HomeScreen() {
  const os = useOSLocal();
  const now = useNow(15_000);
  const weather = useWeather();
  const items: { key: string; label: string; icon: IconKind; run: () => void }[] = [
    ...dockOrder.filter((id) => !mobileDock.includes(id)).map((id) => ({ key: id, label: apps[id].title, icon: apps[id].icon, run: () => os.open(id) })),
    ...folders.map((f) => ({ key: f.id, label: f.label, icon: 'folder' as IconKind, run: () => os.open('finder', { folder: f.id }) })),
  ];
  return (
    <div className="home">
      <div className="home-widgets">
        <div className="widget widget-clock">
          <small>Palo Alto</small>
          <b>{pacificTime(now)}</b>
          <span>{weather ? `${weather.temp}° · ${weather.label}` : now.toLocaleDateString('en-US', { weekday: 'long' })}</span>
        </div>
        <button className="widget widget-hi" onClick={() => os.open('notes', { note: 'about' })}>
          <small>hi, i'm</small>
          <b>{profile.name.toLowerCase()}</b>
          <span>cs + math @ stanford · cox · builder</span>
        </button>
      </div>
      <div className="home-grid">
        {items.map((it) => (
          <button key={it.key} className="home-app" onClick={it.run}>
            <AppIcon kind={it.icon} size={58} />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------ dock ------------------------------------ */

function Dock({ wins, onFocus, active, screenW }: { wins: Win[]; onFocus: (id: AppId) => void; active: AppId | null; screenW: number }) {
  const os = useOSLocal();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids: AppId[] = os.mobile ? mobileDock : [...dockOrder];
  const base = os.mobile ? 58 : Math.round(Math.max(28, Math.min(46, (screenW - 80) / (ids.length + 1) - 4)));

  const scaleFor = (id: string) => {
    if (os.mobile || mouseX === null) return 1;
    const el = refs.current[id];
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    const d = Math.abs(mouseX - (r.left + r.width / 2)) / (r.width / (el.offsetWidth || 1));
    return 1 + 0.55 * Math.max(0, 1 - d / 150);
  };

  const click = (id: AppId) => {
    const w = wins.find((x) => x.id === id && x.state !== 'closing');
    if (w) onFocus(id);
    else os.open(id);
  };

  return (
    <nav className="dock-wrap" aria-label="Dock">
      <div className="dock" onPointerMove={(e) => e.pointerType === 'mouse' && setMouseX(e.clientX)} onPointerLeave={() => setMouseX(null)}>
        {ids.map((id) => {
          const s = scaleFor(id);
          const running = wins.some((w) => w.id === id && w.state !== 'closing');
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[id] = el;
              }}
              className={`dock-item ${running ? 'is-running' : ''} ${active === id ? 'is-front' : ''}`}
              style={{ width: base * s, height: base * s }}
              onClick={() => click(id)}
              aria-label={apps[id].title}
            >
              <AppIcon kind={apps[id].icon} size={base * s} />
              <span className="dock-tip">{apps[id].title}</span>
            </button>
          );
        })}
        {!os.mobile && (
          <>
            <span className="dock-sep" />
            <button
              ref={(el) => {
                refs.current.trash = el;
              }}
              className={`dock-item ${wins.some((w) => w.id === 'trash') ? 'is-running' : ''}`}
              style={{ width: base * scaleFor('trash'), height: base * scaleFor('trash') }}
              onClick={() => click('trash')}
              aria-label="Trash"
            >
              <AppIcon kind="trash" size={base * scaleFor('trash')} />
              <span className="dock-tip">Trash</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

/* ---------------------------------- launcher ---------------------------------- */

type Hit = { key: string; label: string; sub: string; icon: IconKind; run: (os: OSApi) => void; hay: string };

function buildIndex(): Hit[] {
  const hits: Hit[] = [];
  for (const id of [...dockOrder, 'about' as AppId, 'trash' as AppId]) {
    const a = apps[id];
    hits.push({ key: `app-${id}`, label: a.title, sub: 'Application', icon: a.icon, run: (os) => os.open(id), hay: `${a.title} ${a.keywords ?? ''}` });
  }
  for (const f of folders) {
    hits.push({ key: `folder-${f.id}`, label: f.label, sub: 'Folder', icon: 'folder', run: (os) => os.open('finder', { folder: f.id }), hay: f.label });
    for (const e of f.entries) {
      hits.push({
        key: `entry-${f.id}-${e.name}`,
        label: e.name,
        sub: [e.role, e.meta].filter(Boolean).join(' · ') || f.label,
        icon: 'doc',
        run: (os) => (e.href ? os.openUrl(e.href) : os.open('finder', { folder: f.id })),
        hay: `${e.name} ${e.role ?? ''} ${e.meta ?? ''} ${f.label}`,
      });
    }
  }
  hits.push({ key: 'email', label: 'Email Josh', sub: profile.email, icon: 'mail', run: (os) => os.open('mail'), hay: 'email contact mail reach' });
  hits.push({ key: 'yt', label: 'fairytale (music video)', sub: 'YouTube', icon: 'youtube', run: (os) => os.openUrl(links.youtube), hay: 'fairytale youtube video mv dejavu' });
  return hits;
}

function Launcher({ onClose }: { onClose: () => void }) {
  const os = useOSLocal();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const index = useMemo(buildIndex, []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return index.filter((h) => h.key.startsWith('app-')).slice(0, 8);
    const terms = s.split(/\s+/);
    return index
      .map((h) => {
        const hay = h.hay.toLowerCase();
        const label = h.label.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return null;
        const score = (label.startsWith(s) ? 0 : label.includes(s) ? 1 : 2) + (h.key.startsWith('app-') ? 0 : 0.5);
        return { h, score };
      })
      .filter((x): x is { h: Hit; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .slice(0, 9)
      .map((x) => x.h);
  }, [q, index]);

  useEffect(() => setI(0), [q]);

  const run = (h: Hit | undefined) => {
    if (!h) return;
    onClose();
    h.run(os);
  };

  return (
    <div className="launcher-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="launcher" role="dialog" aria-label="Search">
        <div className="launcher-input">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></svg>
          <input
            autoFocus
            value={q}
            placeholder="Search Josh's computer"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((v) => Math.min(v + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((v) => Math.max(v - 1, 0));
              } else if (e.key === 'Enter') run(results[i]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="launcher-list">
          {results.length === 0 && <li className="launcher-empty">No results for “{q}”</li>}
          {results.map((h, n) => (
            <li key={h.key}>
              <button className={n === i ? 'is-sel' : ''} onPointerEnter={() => setI(n)} onClick={() => run(h)}>
                <AppIcon kind={h.icon} size={26} />
                <span className="l-label">{h.label}</span>
                <span className="l-sub">{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
