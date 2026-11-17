// The royale's own HUD: the compass along the top (where you face, with pips for your marker, the next circle and the
// supply crates), how far the safe zone is, the big map that takes a click to mark a spot, the names and marks drawn
// on the maps, and the result panel at the end. The arithmetic is in hud-royale-math.ts.
import { forwardRef, useEffect, useImperativeHandle, useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Hud, MapState } from './hud.tsx';
import { bearingTo, compassOffset, headingOf, mapToWorld, placeLabels, worldToMap, type RoyaleResult } from './hud-royale-math.ts';
import type { World } from './world.ts';

const PIP = { marker: '#ffd56a', zone: '#ffffff', drop: '#3fb6ff' } as const;
const LETTERS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/** The compass, drawn every frame through a ref (no React renders): `yaw` is the view's, (x, z) where it is. */
export type CompassApi = { draw(yaw: number, x: number, z: number, s: MapState): void };

export const Compass = forwardRef<CompassApi, { h: Hud }>(function Compass({ h }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  /** The strip's size on screen, kept by a ResizeObserver so a frame never has to ask for it. */
  const size = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const fit = () => {
      size.current = { w: c.clientWidth, h: c.clientHeight };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  useImperativeHandle(ref, () => ({
    draw(yaw, x, z, s) {
      const c = cv.current;
      const { w, h } = size.current;
      if (!c || w < 10 || h < 10) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const heading = headingOf(yaw);
      // (a narrow strip, on a phone, shows less of the round, so its marks keep apart)
      const span = w >= 360 ? 160 : 110;
      const perDeg = w / span;
      const mid = w / 2;
      const top = 8;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      for (let d = Math.ceil((heading - span / 2) / 15) * 15; d <= heading + span / 2; d += 15) {
        const deg = ((d % 360) + 360) % 360;
        const px = mid + compassOffset(deg, heading) * perDeg;
        // (fading out toward the ends)
        g.globalAlpha = Math.max(0, 1 - (Math.abs(px - mid) / mid) ** 3);
        const name = LETTERS[deg];
        if (name && deg % 90 === 0) {
          g.font = '800 14px system-ui, sans-serif';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,0.6)';
          g.fillStyle = deg === 0 ? '#ff7a5c' : '#fff';
          g.strokeText(name, px, top + 9);
          g.fillText(name, px, top + 9);
        } else if (name) {
          g.font = '700 10px system-ui, sans-serif';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,0.55)';
          g.fillStyle = 'rgba(255,255,255,0.85)';
          g.strokeText(name, px, top + 9);
          g.fillText(name, px, top + 9);
        } else {
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(px - 1.5, top - 1, 3, 9);
          g.fillStyle = 'rgba(255,255,255,0.85)';
          g.fillRect(px - 0.75, top, 1.5, 7);
        }
      }
      g.globalAlpha = 1;
      // pips: the next circle's middle while you are outside it, supply crates with gear left, and your marker on top
      const pip = (tx: number, tz: number, col: string, big: boolean) => {
        const off = compassOffset(bearingTo(x, z, tx, tz), heading);
        // (held in from the strip's ends, clear of where it fades out)
        const edge = Math.abs(off * perDeg) > mid - 14;
        const px = Math.max(14, Math.min(w - 14, mid + off * perDeg));
        const r = big ? 5.5 : 4.5;
        // (a little arrowhead pointing down at the strip; dimmer when held at its end, the place being behind)
        g.globalAlpha = edge ? 0.6 : 1;
        g.beginPath();
        g.moveTo(px, top + 2);
        g.lineTo(px - r, top - r - 1);
        g.lineTo(px + r, top - r - 1);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.stroke();
        g.globalAlpha = 1;
      };
      const zn = s.zone;
      if (zn && Math.hypot(x - zn.nx, z - zn.nz) > zn.nr) pip(zn.nx, zn.nz, PIP.zone, false);
      if (s.drops) for (const d of s.drops) pip(d.x, d.z, PIP.drop, false);
      if (s.marker) pip(s.marker.x, s.marker.z, PIP.marker, true);
      // where you face: a notch over the middle and the heading under it
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(mid, top + 16);
      g.lineTo(mid - 4, top + 21);
      g.lineTo(mid + 4, top + 21);
      g.closePath();
      g.fill();
      const txt = String(Math.round(heading) % 360);
      g.font = '800 12px system-ui, sans-serif';
      const tw = Math.max(26, g.measureText(txt).width + 10);
      g.fillStyle = 'rgba(12,16,22,0.82)';
      g.fillRect(mid - tw / 2, top + 21, tw, 15);
      g.fillStyle = '#fff';
      g.fillText(txt, mid, top + 29);
    },
  }));
  const r = h.royale;
  const guide = r && h.alive && r.toNext > 0 ? r : null;
  return (
    <>
      <canvas ref={cv} className="g-ridgeline-compass" aria-hidden="true" />
      {guide && (
        <div className="g-ridgeline-zoneGuide" data-late={guide.late ? '1' : '0'}>
          safe zone {Math.round(guide.toNext)} m{guide.late ? '. move now' : ''}
        </div>
      )}
    </>
  );
});

/** The big map's frame. In a royale a click (a tap) on it marks a spot; one on the mark, or a right click, clears it. */
export function BigMapFrame({ royale, span, mark, touch, children }: { royale: boolean; span: number; mark: { current: { x: number; z: number } | null }; touch: boolean; children: ReactNode }) {
  const onMark = (p: { x: number; z: number } | null) => {
    mark.current = p;
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const marker = mark.current;
    if (!royale) return;
    e.stopPropagation();
    const c = e.currentTarget.querySelector('canvas');
    if (!c) return;
    const box = c.getBoundingClientRect();
    const w = c.clientWidth;
    const h = c.clientHeight;
    const px = e.clientX - box.left - c.clientLeft;
    const py = e.clientY - box.top - c.clientTop;
    if (w <= 0 || h <= 0 || px < 0 || py < 0 || px > w || py > h) return;
    e.preventDefault();
    if (e.button === 2) return onMark(null);
    if (e.button !== 0) return;
    if (marker) {
      const at = worldToMap(marker.x, marker.z, w, h, span);
      if (Math.hypot(at.x - px, at.y - py) <= 12) return onMark(null);
    }
    onMark(mapToWorld(px, py, w, h, span));
  };
  return (
    <div className="g-ridgeline-bigmapWrap" data-mark={royale ? '1' : '0'} onPointerDown={onDown} onContextMenu={royale ? (e) => e.preventDefault() : undefined}>
      {children}
      {royale && <p className="g-ridgeline-mapHint">{touch ? 'tap to mark a spot, tap the mark to clear it' : 'click to mark a spot, right click (or click the mark) to clear it. M closes the map'}</p>}
    </div>
  );
}

/** Royale, the big map: every town's name, none drawn over another (the more important places first). */
export function drawTownNames(g: CanvasRenderingContext2D, world: World, toX: (x: number) => number, toY: (z: number) => number) {
  const towns = world.towns.filter((t) => Math.abs(t.x) <= world.arena && Math.abs(t.z) <= world.arena).sort((a, b) => rank(a.site) - rank(b.site));
  g.font = '600 10px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.fillStyle = 'rgba(255,255,255,0.88)';
  // (a name by the edge is moved in far enough to be read whole)
  const W = g.canvas.width;
  const H = g.canvas.height;
  const at = placeLabels(
    towns.map((t) => {
      const w = g.measureText(t.name).width;
      return { x: Math.max(w / 2 + 3, Math.min(W - w / 2 - 3, toX(t.x))), y: Math.max(9, Math.min(H - 9, toY(t.z))), w, h: 11 };
    }),
  );
  towns.forEach((t, i) => {
    const p = at[i];
    if (!p) return;
    g.strokeText(t.name, p.x, p.y);
    g.fillText(t.name, p.x, p.y);
  });
}
/** (the towns round the old sites, then the two on the flanks, then the rest) */
const rank = (site: number) => (site >= 0 ? 0 : site === -1 ? 1 : 2);

/** Royale, both maps: a thin line from you to the nearest edge of the next circle while you are outside it, and your
 * marker (held to the minimap's rim when it is further off than the minimap shows). */
export function drawRoyaleMarks(g: CanvasRenderingContext2D, s: MapState, toX: (x: number) => number, toY: (z: number) => number, size: number, big: boolean) {
  if (s.guide) {
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = big ? 1.5 : 1.25;
    g.beginPath();
    g.moveTo(toX(s.x), toY(s.z));
    g.lineTo(toX(s.guide.x), toY(s.guide.z));
    g.stroke();
  }
  if (s.marker) {
    let px = toX(s.marker.x);
    let py = toY(s.marker.z);
    const r = big ? 6 : 5;
    if (!big) {
      const ox = px - size / 2;
      const oy = py - size / 2;
      const ol = Math.hypot(ox, oy);
      const rim = size / 2 - r - 3;
      if (ol > rim) {
        px = size / 2 + (ox / ol) * rim;
        py = size / 2 + (oy / ol) * rim;
      }
    }
    // a pin: a round head over the spot, its point on it
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - r * 0.8, py - r * 1.4);
    g.arc(px, py - r * 1.7, r, Math.PI * 0.8, Math.PI * 0.2);
    g.closePath();
    g.fillStyle = PIP.marker;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.stroke();
    g.beginPath();
    g.arc(px, py - r * 1.7, r * 0.38, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fill();
  }
}

const clock = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The end of your royale: the place, big, then how it went, and the score as the game over card will have it. */
export function RoyaleResultPanel({ r, dead }: { r: RoyaleResult | null; dead: Hud['dead'] }) {
  if (!r) return null;
  const cells: [string, string][] = [
    ['kills', String(r.kills)],
    ['damage', String(r.damage)],
    ['headshot kills', String(r.heads)],
    ['longest knockout', r.kills ? `${r.longest} m` : '-'],
    ['survived', clock(r.time)],
    ['best gun', r.gun ?? '-'],
  ];
  return (
    <div className="g-ridgeline-result" role="status" aria-live="polite" data-won={r.won ? '1' : '0'}>
      <small>{r.won ? 'winner' : 'your place'}</small>
      <b>{r.won ? 'Last one standing' : `#${r.place} of ${r.total}`}</b>
      {!r.won && dead && (
        <span className="g-ridgeline-resultBy">
          knocked out by {dead.by}
          {dead.w ? `, ${dead.w}` : ''}
          {dead.head ? ', headshot' : ''}
        </span>
      )}
      <dl>
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="g-ridgeline-resultScore">
        score <b>{r.score}</b>
        <small>
          {r.combat} combat + {r.bonus} for the place
        </small>
      </p>
    </div>
  );
}
