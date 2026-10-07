import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { apps, dockOrder, games, mobileDock, tabletDock } from './registry';
import { AppIcon, type IconKind } from './icons';
import { useOS as useOSLocal, type Origin } from './types';
import { folders, profile } from './data';
import { clamp, pacificTime, useNow, useWeather } from './hooks';

type Item = { key: string; label: string; icon: IconKind; run: (from: Origin) => void };
type Sample = { x: number; t: number };

/** Where an icon sits on the screen, in screen px, so an app can zoom out of it. */
export function originOf(el: Element | null): Origin | undefined {
  const icon = el?.querySelector('.icon-tile, .icon-bare') ?? el;
  const screen = el?.closest<HTMLElement>('.desktop');
  if (!icon || !screen) return undefined;
  const r = icon.getBoundingClientRect();
  const s = screen.getBoundingClientRect();
  const k = screen.offsetWidth / (s.width || 1);
  return { x: (r.left - s.left) * k, y: (r.top - s.top) * k, w: r.width * k, h: r.height * k };
}

/**
 * iOS / iPadOS home screen: apps live on fixed-size pages (4 columns on iPhone, 5 or 6 on iPad)
 * that you swipe between, with the dock pinned below. The screen itself never scrolls.
 */
export default function HomeScreen() {
  const os = useOSLocal();
  const now = useNow(15_000);
  const weather = useWeather();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [offset, setOffset] = useState<number | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; active: boolean; samples: Sample[] } | null>(null);
  const swiped = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const dock = os.tablet ? tabletDock : mobileDock;
  const items = useMemo<Item[]>(
    () => [
      ...dockOrder.filter((id) => !dock.includes(id)).map((id) => ({ key: id, label: apps[id].title, icon: apps[id].icon, run: (from: Origin) => os.open(id, {}, from) })),
      ...games.filter((id) => !dockOrder.includes(id) && !dock.includes(id)).map((id) => ({ key: id, label: apps[id].title, icon: apps[id].icon, run: (from: Origin) => os.open(id, {}, from) })),
      ...folders.map((f) => ({ key: f.id, label: f.label, icon: 'folder' as IconKind, run: (from: Origin) => os.open('finder', { folder: f.id }, from) })),
    ],
    [dock, os],
  );

  const landscape = box.w > box.h;
  const cols = os.tablet ? (landscape ? 6 : 5) : landscape ? 6 : 4;
  const rows = box.h ? clamp(Math.floor(box.h / (os.tablet ? 124 : 100)), 2, 6) : 6;
  const widgets = !(landscape && !os.tablet) && rows >= 4;
  const perPage = cols * rows;
  const pages = useMemo(() => {
    const out: Item[][] = [];
    const firstCap = Math.max(perPage - (widgets ? 8 : 0), cols);
    out.push(items.slice(0, firstCap));
    for (let i = firstCap; i < items.length; i += perPage) out.push(items.slice(i, i + perPage));
    return out;
  }, [items, perPage, widgets, cols]);
  const count = pages.length;

  useEffect(() => {
    if (page > count - 1) setPage(count - 1);
  }, [count, page]);

  const scale = () => {
    const el = rootRef.current;
    return el ? el.offsetWidth / (el.getBoundingClientRect().width || 1) : 1;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || count < 2) return;
    swiped.current = false;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, samples: [{ x: 0, t: e.timeStamp }] };
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const k = scale();
    const dx = (e.clientX - d.x0) * k;
    const dy = (e.clientY - d.y0) * k;
    if (!d.active) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      d.active = true;
      swiped.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const p = pageRef.current;
    const w = box.w || 1;
    // Past the first or last page the track only gives a little, like iOS.
    const over = (p === 0 && dx > 0) || (p === count - 1 && dx < 0);
    const x = over ? dx * 0.28 : dx;
    d.samples.push({ x, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    setOffset(clamp(x, -w, w));
  };

  const finish = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const last = d.samples[d.samples.length - 1];
    const first = d.samples.find((s) => last.t - s.t < 120) ?? d.samples[0];
    const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const w = box.w || 1;
    let next = pageRef.current;
    if (!cancelled) {
      if (last.x < -w * 0.3 || velocity < -0.4) next += 1;
      else if (last.x > w * 0.3 || velocity > 0.4) next -= 1;
    }
    setPage(clamp(next, 0, count - 1));
    setOffset(null);
  };

  const iconSize = os.tablet ? 68 : 58;
  const trackStyle = {
    transform: `translate3d(calc(${-page * 100}% + ${offset ?? 0}px), 0, 0)`,
    transition: offset === null ? 'transform 0.42s cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none',
  };

  return (
    <div
      ref={rootRef}
      className={`home ${count > 1 ? 'has-pages' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onClickCapture={(e) => {
        if (!swiped.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div ref={trackRef} className="home-track" style={trackStyle}>
        {pages.map((list, i) => (
          <div
            key={i}
            className="home-page"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
            aria-hidden={i !== page || undefined}
          >
            {i === 0 && widgets && (
              <>
                <div className="widget widget-clock">
                  <small>Palo Alto</small>
                  <b>{pacificTime(now)}</b>
                  <span>{weather ? `${weather.temp}° · ${weather.label}` : now.toLocaleDateString('en-US', { weekday: 'long' })}</span>
                </div>
                <button className="widget widget-hi" onClick={(e) => os.open('notes', { note: 'about' }, originOf(e.currentTarget))}>
                  <small>hi, i'm</small>
                  <b>{profile.name.toLowerCase()}</b>
                  <span>cs + math @ stanford · cox · builder</span>
                </button>
              </>
            )}
            {list.map((it) => (
              <button key={it.key} className="home-app" onClick={(e) => it.run(originOf(e.currentTarget)!)} tabIndex={i === page ? 0 : -1}>
                <AppIcon kind={it.icon} size={iconSize} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="home-dots" role="tablist" aria-label="Home Screen pages">
          {pages.map((_, i) => (
            <button key={i} role="tab" aria-selected={i === page} aria-label={`Page ${i + 1}`} className={i === page ? 'is-cur' : ''} onClick={() => setPage(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
