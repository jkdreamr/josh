import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { apps, dockOrder, games, mobileDock, tabletDock } from './registry';
import { AppIcon, type IconKind } from './icons';
import { OSContext, useOS as useOSLocal, type AppId, type OpenArgs, type Origin, type OSApi } from './types';
import { folders, links, profile } from './data';
import Wallpaper from './Wallpaper';
import Banner from './Banner';
import HomeScreen, { originOf } from './HomeScreen';
import { clamp, useNow, useWeather, type Weather } from './hooks';

const MENU_H = 26;
const DOCK_SPACE = 78;
const MIN_W = 320;
const MIN_H = 220;
const DOCK_GAP = 4;
const DOCK_PAD_X = 6;
const DOCK_SEP = 7;
const DOCK_AMP = 0.5;
const DOCK_RADIUS = 2.6;
const DOCK_PAD_Y = 5;
const DOCK_BOTTOM = 6;
const DOCK_MAX_BASE = 46;

/** Resting icon size of the Mac Dock for a given display width (the Dock shrinks on narrow displays). */
function dockBaseFor(screenW: number, count: number, kSum: number) {
  const fixed = 2 * DOCK_PAD_X + (count - 1) * DOCK_GAP + DOCK_SEP + DOCK_GAP;
  return Math.floor(Math.min(DOCK_MAX_BASE, (screenW - 16 - fixed) / (count + DOCK_AMP * kSum)));
}

function dockKernelSum(count: number) {
  let max = 0;
  for (let p = 0; p <= count + 1e-8; p += 0.05) {
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += dockKernel(Math.abs(p - i));
    max = Math.max(max, sum);
  }
  return max;
}

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
  origin?: Origin;
};

type Props = {
  mobile: boolean;
  tablet?: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  restart: () => void;
  sleep: () => void;
  closeLid: () => void;
  camera: boolean;
  setCamera: (on: boolean) => void;
  apiRef?: RefObject<OSApi | null>;
};

/** Routes a URL to the in-desktop app that best represents it. */
function routeUrl(url: string): { id: AppId; args: OpenArgs } {
  const u = url.toLowerCase();
  if (u.includes('venmo.com/u/josdreamr')) return { id: 'venmo', args: {} };
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

export default function Desktop({ mobile, tablet = false, fullscreen, toggleFullscreen, restart, sleep, closeLid, camera, setCamera, apiRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 625 });
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [toast, setToast] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; icon?: string } | null>(null);
  const zTop = useRef(10);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      sizeRef.current = { w: el.offsetWidth, h: el.offsetHeight };
      setSize(sizeRef.current);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
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

  const open = useCallback((id: AppId, args: OpenArgs = {}, from?: Origin) => {
    const def = apps[id];
    const { w: W, h: H } = sizeRef.current;
    zTop.current += 1;
    const z = zTop.current;
    setWins((ws) => {
      const existing = ws.find((w) => w.id === id);
      if (existing)
        return ws.map((w) =>
          w.id === id ? { ...w, z, min: false, state: w.state === 'closing' ? 'open' : w.state, args: { ...args, nonce: Date.now() }, origin: from ?? w.origin } : w,
        );
      const availH = H - MENU_H - DOCK_SPACE;
      const w = Math.round(Math.min(def.w, W * 0.86));
      const h = Math.round(Math.min(def.h, availH - 10));
      const n = ws.filter((x) => !x.min).length % 6;
      const x = Math.round(clamp((W - w) / 2 + n * 26, 8, W - w - 8));
      const y = Math.round(clamp(MENU_H + (availH - h) / 2 + n * 22, MENU_H + 6, H - h - DOCK_SPACE));
      return [...ws, { id, x, y, w, h, z, min: false, max: false, args: { ...args, nonce: Date.now() }, state: 'opening', origin: from }];
    });
  }, []);

  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    open('notes', { note: 'about' });
  }, [open]);

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
    () => ({ open, close, openUrl, mobile, tablet, fullscreen, toggleFullscreen, restart, sleep, closeLid, openLauncher: () => setLauncher(true), camera, setCamera }),
    [open, close, openUrl, mobile, tablet, fullscreen, toggleFullscreen, restart, sleep, closeLid, camera, setCamera],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [api, apiRef]);

  // Welcome notification. The banner itself handles auto-dismiss, hover and swipes.
  useEffect(() => {
    const t = setTimeout(() => setToast(true), 1400);
    return () => clearTimeout(t);
  }, []);
  const dismissToast = useCallback(() => setToast(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLauncher((v) => !v);
      } else if (e.key === 'Escape') {
        if (launcher) setLauncher(false);
        if (ctx) setCtx(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launcher, ctx]);

  useEffect(() => {
    if (!ctx) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.ctx-menu')) setCtx(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', () => setCtx(null));
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [ctx]);

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

  // A zoomed Mac window fills the space between the menu bar and the top of the Dock.
  const dockCount = dockOrder.length + 1;
  const dockTop = size.h - DOCK_BOTTOM - 2 * DOCK_PAD_Y - dockBaseFor(size.w, dockCount, dockKernelSum(dockCount)) - 4;

  /** Swipe up on the home indicator: the app follows the finger, shrinking toward its icon. */
  const startHomeSwipe = (e: RPointerEvent<HTMLButtonElement>, id: AppId) => {
    if (e.button !== 0) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-win="${id}"]`);
    if (!el) return;
    const btn = e.currentTarget;
    const s = scaleOf();
    const y0 = e.clientY;
    const x0 = e.clientX;
    const H = sizeRef.current.h;
    const samples: { y: number; t: number }[] = [{ y: 0, t: e.timeStamp }];
    let moved = false;
    btn.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = (ev.clientY - y0) / s.y;
      const dx = (ev.clientX - x0) / s.x;
      if (!moved && Math.abs(dy) < 6) return;
      moved = true;
      samples.push({ y: dy, t: ev.timeStamp });
      if (samples.length > 6) samples.shift();
      const p = clamp(-dy / (H * 0.45), 0, 1);
      const k = 1 - 0.55 * p;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx * 0.5}px, ${Math.min(0, dy) * 0.75 + Math.max(0, dy) * 0.12}px) scale(${k})`;
      el.style.borderRadius = `${p * 44}px`;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', cancel);
      const last = samples[samples.length - 1];
      const first = samples.find((smp) => last.t - smp.t < 120) ?? samples[0];
      const v = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      if (!moved || -last.y > H * 0.16 || v < -0.5) {
        el.style.transition = '';
        close(id);
        return;
      }
      el.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.9, 0.25, 1.08), border-radius 0.4s ease';
      el.style.transform = '';
      el.style.borderRadius = '';
      setTimeout(() => {
        el.style.transition = '';
      }, 420);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', cancel);
      el.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.9, 0.25, 1.08), border-radius 0.4s ease';
      el.style.transform = '';
      el.style.borderRadius = '';
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', cancel);
  };

  const onContextMenu = (e: RMouseEvent<HTMLDivElement>) => {
    if (mobile) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable], iframe, video')) return;
    e.preventDefault();
    if (t.closest('.win, .menubar, .dock-wrap, .banner, .launcher-scrim')) {
      setCtx(null);
      return;
    }
    const root = rootRef.current!;
    const r = root.getBoundingClientRect();
    const s = scaleOf();
    const x = (e.clientX - r.left) / s.x;
    const y = (e.clientY - r.top) / s.y;
    setCtx({ x, y, icon: t.closest<HTMLElement>('.desk-icon')?.dataset.key });
  };

  return (
    <OSContext.Provider value={api}>
      <div
        ref={rootRef}
        className={`desktop ${mobile ? 'is-mobile' : ''} ${tablet ? 'is-tablet' : ''} ${mobile && active && apps[active.id].theme !== 'dark' ? 'sb-ink' : ''} ${dragging ? 'is-dragging' : ''}`}
        onContextMenu={onContextMenu}
      >
        <Wallpaper />
        {mobile ? <StatusBar /> : <MenuBar title={activeTitle} wins={wins} onFocus={focus} onClose={close} />}

        {mobile ? <HomeScreen /> : <DesktopIcons />}

        {wins.map((w) => {
          const def = apps[w.id];
          const C = def.Component;
          const isActive = active?.id === w.id;
          const o = w.origin;
          const style = mobile
            ? ({
                zIndex: w.z,
                ...(o
                  ? {
                      '--ox': `${o.x + o.w / 2 - size.w / 2}px`,
                      '--oy': `${o.y + o.h / 2 - size.h / 2}px`,
                      '--os': `${Math.max(o.w / size.w, 0.05)}`,
                      '--or': `${(0.225 * o.w) / Math.max(o.w / size.w, 0.05)}px`,
                    }
                  : {}),
              } as CSSProperties)
            : w.max
              ? { zIndex: w.z, left: 0, top: MENU_H, width: size.w, height: dockTop - MENU_H }
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
              data-win={w.id}
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
        {mobile && active && <button className="home-ind" aria-label="Go to Home Screen" onPointerDown={(e) => startHomeSwipe(e, active.id)} />}

        <Banner show={toast} mobile={mobile} onDismiss={dismissToast} onOpen={() => open('messages')}>
          <AppIcon kind="messages" size={mobile ? 38 : 34} />
          <span className="toast-text">
            <b>Josh</b>
            <span>hey, welcome to my {mobile ? (tablet ? 'ipad' : 'phone') : 'computer'}. poke around, or text me.</span>
          </span>
          <small>now</small>
        </Banner>

        {ctx && (
          <ContextMenu
            x={ctx.x}
            y={ctx.y}
            screen={{ w: size.w, h: dockTop }}
            onClose={() => setCtx(null)}
            items={
              ctx.icon
                ? [
                    { label: 'Open', action: () => desktopItems.find((d) => d.key === ctx.icon)?.run(api) },
                    'sep',
                    { label: 'Get Info', action: () => open('about') },
                  ]
                : [
                    { label: 'New Folder' },
                    { label: 'Get Info', action: () => open('about') },
                    { label: 'Change Wallpaper…' },
                    'sep',
                    { label: 'Search…', hint: '⌘K', action: () => setLauncher(true) },
                    { label: 'Clean Up', action: () => undefined },
                    'sep',
                    { label: 'Text Josh', action: () => open('messages') },
                    { label: 'Email Josh', action: () => open('mail') },
                  ]
            }
          />
        )}

        {launcher && <Launcher onClose={() => setLauncher(false)} />}
      </div>
    </OSContext.Provider>
  );
}

/* ---------------------------------- menu bar ---------------------------------- */

type MenuItem = { label: string; hint?: string; action?: () => void } | 'sep';

function MenuItems({ items, onPick }: { items: MenuItem[]; onPick: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={!it.action}
            onClick={() => {
              onPick();
              it.action?.();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </>
  );
}

/** One menu bar title. Menus share a single open slot so sliding across titles switches menus, like macOS. */
function Menu({
  id,
  openId,
  setOpenId,
  label,
  items,
  bold,
  className,
}: {
  id: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  label: ReactNode;
  items: MenuItem[];
  bold?: boolean;
  className?: string;
}) {
  const open = openId === id;
  return (
    <div
      className={`menu ${className ?? ''} ${open ? 'is-open' : ''}`}
      data-menu={id}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && openId !== null && openId !== id) setOpenId(id);
      }}
    >
      <button
        className={`menu-btn ${bold ? 'is-bold' : ''}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          setOpenId(open ? null : id);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <MenuItems items={items} onPick={() => setOpenId(null)} />
        </div>
      )}
    </div>
  );
}

/** Right-click menu on the desktop. */
function ContextMenu({ x, y, screen, items, onClose }: { x: number; y: number; screen: { w: number; h: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Keep the menu on screen: flip left past the right edge, and never run under the Dock.
    setPos({ x: x + w > screen.w - 6 ? Math.max(6, x - w) : x, y: clamp(y, MENU_H + 4, Math.max(MENU_H + 4, screen.h - h - 6)) });
  }, [x, y, screen.w, screen.h]);
  return (
    <div ref={ref} className="menu-pop ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      <MenuItems items={items} onPick={onClose} />
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
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openId === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!barRef.current?.contains(t) || !t.closest('.menu')) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onKey as unknown as () => void);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onKey as unknown as () => void);
    };
  }, [openId]);
  const shared = { openId, setOpenId };
  return (
    <div className="menubar" ref={barRef}>
      <div className="mb-left">
        <Menu
          id="logo"
          {...shared}
          className="mb-logo"
          label={<span className="logo-mark">jk</span>}
          items={[
            { label: 'About This Josh', action: () => os.open('about') },
            'sep',
            { label: 'Search…', hint: '⌘K', action: os.openLauncher },
            { label: os.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', hint: os.fullscreen ? 'esc' : undefined, action: os.toggleFullscreen },
            'sep',
            { label: 'Sleep', action: os.sleep },
            ...(os.mobile ? [] : [{ label: 'Close Lid', action: os.closeLid }]),
            { label: 'Restart…', action: os.restart },
          ]}
        />
        <Menu id="app" {...shared} bold label={title} items={[{ label: `About ${title}`, action: () => os.open('about') }, 'sep', { label: 'Hide Others' }, { label: 'Quit', action: () => wins.length && onClose(wins.reduce((a, b) => (a.z > b.z ? a : b)).id) }]} />
        <Menu
          id="go"
          {...shared}
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
          id="window"
          {...shared}
          className="mb-hide-sm"
          label="Window"
          items={openWins.length ? openWins.map((w) => ({ label: apps[w.id].title, action: () => onFocus(w.id) })) : [{ label: 'No windows open' }]}
        />
        <Menu
          id="help"
          {...shared}
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
  const os = useOSLocal();
  const now = useNow(15_000);
  return (
    <div className="statusbar">
      <span>
        {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}
        {os.tablet && <span className="sb-date">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}</span>}
      </span>
      <span className="sb-right">
        {os.camera && <span className="sb-cam" role="img" aria-label="Camera in use" />}
        {os.tablet && os.fullscreen && (
          <button className="sb-exit" onClick={os.toggleFullscreen} aria-label="Exit full screen">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
          </button>
        )}
        {!os.tablet && <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx=".8" /><rect x="4.5" y="5" width="3" height="6" rx=".8" /><rect x="9" y="2.5" width="3" height="8.5" rx=".8" /><rect x="13.5" y="0" width="3" height="11" rx=".8" /></svg>}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 11.6 5.7 9.3a3.3 3.3 0 0 1 4.6 0z" /><path d="M3.5 7.1a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0z" /><path d="M1.2 4.8a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0z" /></svg>
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
  ...games.filter((id) => id !== 'coxbox').map<DesktopItem>((id) => ({ key: id, label: apps[id].title, icon: apps[id].icon, run: (os) => os.open(id) })),
];

function DesktopIcons() {
  const os = useOSLocal();
  const [sel, setSel] = useState<string[]>([]);
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const tapType = useRef('');
  const bandStart = useRef<{ pointerId: number; x: number; y: number; clientX: number; clientY: number; active: boolean } | null>(null);

  const screenPoint = (clientX: number, clientY: number) => {
    const screen = screenRef.current;
    if (!screen) return { x: clientX, y: clientY };
    const rect = screen.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * screen.offsetWidth) / (rect.width || 1),
      y: ((clientY - rect.top) * screen.offsetHeight) / (rect.height || 1),
    };
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setSel([]);
    if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;

    const screen = e.currentTarget.closest<HTMLDivElement>('.desktop');
    if (!screen) return;
    screenRef.current = screen;
    const point = screenPoint(e.clientX, e.clientY);
    bandStart.current = { pointerId: e.pointerId, ...point, clientX: e.clientX, clientY: e.clientY, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const start = bandStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    if (!start.active && Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY) <= 3) return;
    start.active = true;

    const a = { x: start.x, y: start.y };
    const b = screenPoint(e.clientX, e.clientY);
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const right = Math.max(a.x, b.x);
    const bottom = Math.max(a.y, b.y);
    const screen = screenRef.current;
    const screenRect = screen?.getBoundingClientRect();
    const scaleX = screen && screenRect ? screen.offsetWidth / (screenRect.width || 1) : 1;
    const scaleY = screen && screenRect ? screen.offsetHeight / (screenRect.height || 1) : 1;
    const areaRect = e.currentTarget.getBoundingClientRect();
    const areaLeft = screenRect ? (areaRect.left - screenRect.left) * scaleX : 0;
    const areaTop = screenRect ? (areaRect.top - screenRect.top) * scaleY : 0;
    const areaRight = areaLeft + areaRect.width * scaleX;
    const areaBottom = areaTop + areaRect.height * scaleY;
    const bandLeft = Math.max(areaLeft, left);
    const bandTop = Math.max(areaTop, top);
    const bandRight = Math.min(areaRight, right);
    const bandBottom = Math.min(areaBottom, bottom);
    const keys = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.desk-icon'))
      .filter((icon) => {
        const rect = icon.getBoundingClientRect();
        const iconLeft = screenRect ? (rect.left - screenRect.left) * scaleX : rect.left;
        const iconTop = screenRect ? (rect.top - screenRect.top) * scaleY : rect.top;
        const iconRight = screenRect ? (rect.right - screenRect.left) * scaleX : rect.right;
        const iconBottom = screenRect ? (rect.bottom - screenRect.top) * scaleY : rect.bottom;
        return iconLeft <= bandRight && iconRight >= bandLeft && iconTop <= bandBottom && iconBottom >= bandTop;
      })
      .map((icon) => icon.dataset.key)
      .filter((key): key is string => Boolean(key));

    setSel(keys);
    setBand({ left: bandLeft - areaLeft, top: bandTop - areaTop, width: bandRight - bandLeft, height: bandBottom - bandTop });
  };

  const endPointer = (e: RPointerEvent<HTMLDivElement>) => {
    if (bandStart.current?.pointerId !== e.pointerId) return;
    bandStart.current = null;
    setBand(null);
  };

  return (
    <div
      className="desk-icons"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.repeat || !sel.length) return;
        const key = (e.target as HTMLElement).closest<HTMLElement>('.desk-icon')?.dataset.key;
        const item = desktopItems.find((entry) => entry.key === key && sel.includes(entry.key));
        if (!item) return;
        e.preventDefault();
        item.run(os);
      }}
    >
      {desktopItems.map((it) => (
        <button
          key={it.key}
          data-key={it.key}
          className={`desk-icon ${sel.includes(it.key) ? 'is-sel' : ''}`}
          onFocus={() => setSel([it.key])}
          onPointerDown={(e) => {
            setSel([it.key]);
            tapType.current = e.pointerType;
          }}
          onClick={() => tapType.current === 'touch' && it.run(os)}
          onDoubleClick={() => it.run(os)}
        >
          <AppIcon kind={it.icon} size={52} />
          <span>{it.label}</span>
        </button>
      ))}
      {band && <div aria-hidden="true" className="selection-marquee" style={band} />}
    </div>
  );
}

/* ------------------------------------ dock ------------------------------------ */

type DockSpring = { s: number; v: number };

function dockKernel(d: number) {
  return d >= DOCK_RADIUS ? 0 : (1 + Math.cos((Math.PI * d) / DOCK_RADIUS)) / 2;
}

function Dock({ wins, onFocus, active, screenW }: { wins: Win[]; onFocus: (id: AppId) => void; active: AppId | null; screenW: number }) {
  const os = useOSLocal();
  const [hovered, setHovered] = useState<AppId | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scaleRefs = useRef<Record<string, DockSpring>>({});
  const pointerP = useRef<number | null>(null);
  const hoveredRef = useRef<AppId | null>(null);
  const frameRef = useRef<number | null>(null);
  const previousTime = useRef(0);
  const ids = useMemo(() => (os.mobile ? (os.tablet ? tabletDock : mobileDock) : [...dockOrder]), [os.mobile, os.tablet]);
  const items = useMemo(() => (os.mobile ? ids : [...ids, 'trash' as AppId]), [ids, os.mobile]);
  const count = items.length;
  const kSum = useMemo(() => dockKernelSum(count), [count]);
  const fixed = 2 * DOCK_PAD_X + (count - 1) * DOCK_GAP + (os.mobile ? 0 : DOCK_SEP + DOCK_GAP);
  const base = os.mobile ? (os.tablet ? 62 : 58) : dockBaseFor(screenW, count, kSum);
  const pitch = base + DOCK_GAP;
  const width0 = fixed + count * base;
  const configRef = useRef({ items, base, pitch, count, width0, screenW, reducedMotion, mobile: os.mobile });
  configRef.current = { items, base, pitch, count, width0, screenW, reducedMotion, mobile: os.mobile };

  const applyScale = useCallback((id: string, scale: number) => {
    const button = itemRefs.current[id];
    if (!button) return;
    const size = configRef.current.base * scale;
    button.style.width = `${size}px`;
    const icon = button.firstElementChild as HTMLElement | null;
    if (icon) {
      icon.style.width = `${size}px`;
      icon.style.height = `${size}px`;
    }
  }, []);

  const positionLabel = useCallback(() => {
    const label = labelRef.current;
    const wrap = wrapRef.current;
    const dock = dockRef.current;
    const id = hoveredRef.current;
    const button = id ? itemRefs.current[id] : null;
    if (!label || !wrap || !dock || !button) return;
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = button;
    while (node && node !== wrap) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    const s = id ? scaleRefs.current[id]?.s ?? 1 : 1;
    const labelWidth = label.offsetWidth;
    const labelHeight = label.offsetHeight;
    const wrapLeft = wrap.offsetLeft;
    const wrapTop = wrap.offsetTop;
    const center = wrapLeft + x + button.offsetWidth / 2;
    const left = Math.max(6 + labelWidth / 2, Math.min(configRef.current.screenW - 6 - labelWidth / 2, center));
    const tileTop = wrapTop + y - configRef.current.base * (s - 1);
    const top = Math.max(MENU_H + 4, tileTop - labelHeight - 8);
    label.style.transform = `translate3d(${left - wrapLeft - labelWidth / 2}px, ${top - wrapTop}px, 0)`;
  }, []);

  const animate = useCallback((time: number) => {
    frameRef.current = null;
    const dt = Math.min((time - (previousTime.current || time)) / 1000, 1 / 30);
    previousTime.current = time;
    const { items: currentItems, base: currentBase, pitch: currentPitch, reducedMotion: reduce } = configRef.current;
    const p = reduce ? null : pointerP.current;
    const stiffness = p === null ? 170 : 900;
    const damping = 2 * Math.sqrt(stiffness);
    const stepCount = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / stepCount;
    let moving = false;

    currentItems.forEach((id, index) => {
      const center = DOCK_PAD_X + index * currentPitch + currentBase / 2 + (id === 'trash' ? DOCK_SEP + DOCK_GAP : 0);
      const target = p === null ? 1 : 1 + DOCK_AMP * dockKernel(Math.abs(p - center) / currentPitch);
      const spring = (scaleRefs.current[id] ??= { s: 1, v: 0 });
      for (let step = 0; step < stepCount; step += 1) {
        const acceleration = stiffness * (target - spring.s) - damping * spring.v;
        spring.v += acceleration * stepDt;
        spring.s += spring.v * stepDt;
      }
      if (Math.abs(spring.s - target) < 0.001 && Math.abs(spring.v) < 0.01) {
        spring.s = target;
        spring.v = 0;
      } else {
        moving = true;
      }
      applyScale(id, spring.s);
    });
    positionLabel();
    if (moving) frameRef.current = requestAnimationFrame(animate);
    else previousTime.current = 0;
  }, [applyScale, positionLabel]);

  const requestAnimation = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      pointerP.current = null;
      dockRef.current?.classList.remove('is-mag');
      requestAnimation();
    }
  }, [reducedMotion, requestAnimation]);

  useEffect(() => {
    items.forEach((id) => applyScale(id, scaleRefs.current[id]?.s ?? 1));
    positionLabel();
    requestAnimation();
  }, [applyScale, base, items, positionLabel, requestAnimation]);

  useEffect(() => {
    positionLabel();
  }, [hovered, positionLabel]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const setHoveredItem = (id: AppId | null) => {
    hoveredRef.current = id;
    setHovered(id);
    if (id) requestAnimation();
  };

  const click = (id: AppId, el: HTMLElement) => {
    const w = wins.find((x) => x.id === id && x.state !== 'closing');
    if (w) onFocus(id);
    else os.open(id, {}, os.mobile ? originOf(el) : undefined);
  };

  return (
    <nav ref={wrapRef} className="dock-wrap" aria-label="Dock">
      <div
        ref={dockRef}
        className="dock"
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || configRef.current.reducedMotion || configRef.current.mobile) return;
          const dock = dockRef.current;
          if (!dock) return;
          const rect = dock.getBoundingClientRect();
          const scale = dock.offsetWidth / rect.width || 1;
          pointerP.current = (e.clientX - (rect.left + rect.width / 2)) * scale + configRef.current.width0 / 2;
          dock.classList.add('is-mag');
          requestAnimation();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          pointerP.current = null;
          dockRef.current?.classList.remove('is-mag');
          setHoveredItem(null);
          requestAnimation();
        }}
      >
        {!os.mobile && <span className="dock-hotzone" aria-hidden="true" style={{ height: base * DOCK_AMP + 2 }} />}
        {ids.map((id) => {
          const running = wins.some((w) => w.id === id && w.state !== 'closing');
          return (
            <button
              key={id}
              ref={(el) => {
                itemRefs.current[id] = el;
              }}
              className={`dock-item ${running ? 'is-running' : ''} ${active === id ? 'is-front' : ''}`}
              style={{ width: base, height: base }}
              onClick={(e) => click(id, e.currentTarget)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHoveredItem(id)}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse' && !dockRef.current?.contains(e.relatedTarget as Node | null)) setHoveredItem(null);
              }}
              aria-label={apps[id].title}
            >
              <AppIcon kind={apps[id].icon} size={base} />
            </button>
          );
        })}
        {!os.mobile && (
          <>
            <span className="dock-sep" />
            <button
              ref={(el) => {
                itemRefs.current.trash = el;
              }}
              className={`dock-item ${wins.some((w) => w.id === 'trash') ? 'is-running' : ''}`}
              style={{ width: base, height: base }}
              onClick={(e) => click('trash', e.currentTarget)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHoveredItem('trash')}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse' && !dockRef.current?.contains(e.relatedTarget as Node | null)) setHoveredItem(null);
              }}
              aria-label="Trash"
            >
              <AppIcon kind="trash" size={base} />
            </button>
          </>
        )}
      </div>
      <div ref={labelRef} className={`dock-label ${hovered ? 'is-visible' : ''}`} role="tooltip">
        {hovered ? apps[hovered].title : ''}
      </div>
    </nav>
  );
}

/* ---------------------------------- launcher ---------------------------------- */

type Hit = { key: string; label: string; sub: string; icon: IconKind; run: (os: OSApi) => void; hay: string };

function buildIndex(): Hit[] {
  const hits: Hit[] = [];
  for (const id of [...dockOrder, ...games.filter((game) => !dockOrder.includes(game)), 'about' as AppId, 'trash' as AppId]) {
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
