// Everything drawn over the 3D view: the round bar, health and ammo, the kill feed, the minimap, markers for the
// uplink and your team, the buy menu, the scoreboard, banners, the crosshair, hit markers and the scope.
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { Mode, Phase, ShopItem } from './match.ts';
import { ARMOR, NADES, WEAPONS, type WeaponId } from './weapons.ts';
import type { World } from './world.ts';

export type FeedItem = { id: number; killer: string; victim: string; kc: string; vc: string; w: string; head: boolean; mine: boolean };
export type Row = { name: string; team: number; k: number; d: number; a: number; cs: number; credits: number | null; alive: boolean; you: boolean };
export type Hud = {
  mode: Mode;
  phase: Phase;
  timer: number;
  round: number;
  score: [number, number];
  pips: [boolean[], boolean[]];
  site: string | null;
  cap: [number, number];
  onSite: [number, number];
  hp: number;
  armor: number;
  credits: number;
  gun: { name: string; mag: number; reserve: number; max: number; cls: string } | null;
  slot: number;
  guns: [WeaponId | null, WeaponId | null];
  frags: number;
  smokes: number;
  canBuy: boolean;
  alive: boolean;
  dead: { by: string; w: string; head: boolean; respawn: number } | null;
  watching: string | null;
  feed: FeedItem[];
  dm: { kills: number; top: number; topName: string; place: number; total: number } | null;
  scoped: boolean;
  reload: number;
  rows: Row[];
  owned: Partial<Record<ShopItem, boolean>>;
};

export const blankHud = (mode: Mode): Hud => ({
  mode,
  phase: 'buy',
  timer: 0,
  round: 1,
  score: [0, 0],
  pips: [[], []],
  site: null,
  cap: [0, 0],
  onSite: [0, 0],
  hp: 100,
  armor: 0,
  credits: 0,
  gun: null,
  slot: 1,
  guns: [null, null],
  frags: 0,
  smokes: 0,
  canBuy: false,
  alive: true,
  dead: null,
  watching: null,
  feed: [],
  dm: null,
  scoped: false,
  reload: 0,
  rows: [],
  owned: {},
});

const clock = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TopBar({ h }: { h: Hud }) {
  if (h.mode === 'dm' && h.dm) {
    return (
      <div className="g-ridgeline-top">
        <div className="g-ridgeline-score is-you">
          <b>{h.dm.kills}</b>
          <small>you</small>
        </div>
        <div className="g-ridgeline-clock">
          <b>{clock(h.timer)}</b>
          <small>first to 25</small>
        </div>
        <div className="g-ridgeline-score is-them">
          <b>{h.dm.top}</b>
          <small>{h.dm.topName}</small>
        </div>
      </div>
    );
  }
  const total = h.cap[0] + h.cap[1];
  return (
    <div className="g-ridgeline-top">
      <div className="g-ridgeline-score is-you">
        <b>{h.score[0]}</b>
        <span className="g-ridgeline-pips">{h.pips[0].map((a, i) => <i key={i} className={a ? 'is-on' : ''} />)}</span>
      </div>
      <div className="g-ridgeline-clock">
        <b>{clock(h.timer)}</b>
        <small>{h.phase === 'buy' ? 'buy phase' : h.phase === 'end' ? 'round over' : `round ${h.round}`}</small>
        {h.site && h.phase !== 'buy' && (
          <div className="g-ridgeline-cap" data-contest={h.onSite[0] > 0 && h.onSite[1] > 0 ? '1' : '0'}>
            <span className="g-ridgeline-capLetter">{h.site}</span>
            <span className="g-ridgeline-capBar is-you" style={{ width: `${(h.cap[0] / 10) * 100}%` }} />
            <span className="g-ridgeline-capBar is-them" style={{ width: `${(h.cap[1] / 10) * 100}%` }} />
            {total === 0 && <em>uplink {h.site} is live</em>}
          </div>
        )}
      </div>
      <div className="g-ridgeline-score is-them">
        <b>{h.score[1]}</b>
        <span className="g-ridgeline-pips">{h.pips[1].map((a, i) => <i key={i} className={a ? 'is-on' : ''} />)}</span>
      </div>
    </div>
  );
}

export function Vitals({ h }: { h: Hud }) {
  return (
    <div className="g-ridgeline-vitals">
      <div className="g-ridgeline-hp">
        <b>{Math.ceil(h.hp)}</b>
        <span className="g-ridgeline-hpBar">
          <i style={{ width: `${h.hp}%` }} className={h.hp < 35 ? 'is-low' : ''} />
        </span>
      </div>
      <div className="g-ridgeline-armor" data-on={h.armor > 0 ? '1' : '0'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" />
        </svg>
        <b>{Math.ceil(h.armor)}</b>
      </div>
      {h.mode === 'uplink' && (
        <div className="g-ridgeline-credits">
          <span>¤</span>
          {h.credits}
        </div>
      )}
    </div>
  );
}

export function Ammo({ h }: { h: Hud }) {
  const g = h.gun;
  return (
    <div className="g-ridgeline-ammo">
      {g && (
        <>
          <div className="g-ridgeline-mag">
            <b className={g.mag <= Math.ceil(g.max * 0.25) ? 'is-low' : ''}>{g.mag}</b>
            <span>/ {h.mode === 'dm' ? '∞' : g.reserve}</span>
          </div>
          <div className="g-ridgeline-gunName">{g.name}</div>
          {h.reload > 0 && (
            <div className="g-ridgeline-reload">
              <i style={{ width: `${h.reload * 100}%` }} />
            </div>
          )}
        </>
      )}
      <div className="g-ridgeline-slots">
        {h.guns.map((id, i) => (
          <span key={i} className={i === h.slot ? 'is-on' : ''} data-empty={id ? '0' : '1'}>
            <kbd>{i + 1}</kbd>
            {id ? WEAPONS[id].name : '-'}
          </span>
        ))}
        <span data-empty={h.frags ? '0' : '1'}>
          <kbd>3</kbd>frag {h.frags}
        </span>
        <span data-empty={h.smokes ? '0' : '1'}>
          <kbd>4</kbd>smoke {h.smokes}
        </span>
      </div>
    </div>
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div className="g-ridgeline-feed" aria-live="polite">
      {items.map((f) => (
        <div key={f.id} className={f.mine ? 'is-mine' : ''}>
          <b style={{ color: f.kc }}>{f.killer}</b>
          <span className="g-ridgeline-feedW">
            {f.w}
            {f.head ? ' ◎' : ''}
          </span>
          <b style={{ color: f.vc }}>{f.victim}</b>
        </div>
      ))}
    </div>
  );
}

export type Banner = { title: string; sub: string; tone: 'win' | 'loss' | 'info'; key: number };
export function BannerView({ b }: { b: Banner | null }) {
  if (!b) return null;
  return (
    <div key={b.key} className={`g-ridgeline-banner is-${b.tone}`}>
      <b>{b.title}</b>
      {b.sub && <small>{b.sub}</small>}
    </div>
  );
}

const SHOP: { group: string; items: ShopItem[] }[] = [
  { group: 'Sidearms', items: ['wren', 'bulwark'] },
  { group: 'SMG and shotgun', items: ['hornet', 'mauler'] },
  { group: 'Rifles', items: ['kestrel', 'lancer'] },
  { group: 'Sniper', items: ['longbow'] },
  { group: 'Armor', items: ['light', 'heavy'] },
  { group: 'Grenades', items: ['frag', 'smoke'] },
];
export const SHOP_ORDER = SHOP.flatMap((g) => g.items);

const itemName = (i: ShopItem) => (i === 'light' ? 'Light Armor' : i === 'heavy' ? 'Heavy Armor' : i === 'frag' ? 'Frag' : i === 'smoke' ? 'Smoke' : WEAPONS[i].name);
const itemPrice = (i: ShopItem) => (i === 'light' || i === 'heavy' ? ARMOR[i].price : i === 'frag' || i === 'smoke' ? NADES[i].price : WEAPONS[i].price);
const itemLine = (i: ShopItem) => {
  if (i === 'light') return 'soaks 25';
  if (i === 'heavy') return 'soaks 50';
  if (i === 'frag') return 'big blast, 2 s fuse';
  if (i === 'smoke') return 'blocks sight 15 s';
  const w = WEAPONS[i];
  const dmg = w.pellets > 1 ? `${w.pellets}x${w.dmg}` : `${w.dmg}`;
  return `${dmg} dmg, ${w.rpm} rpm, ${w.mag} rounds${w.scope ? ', scoped' : ''}`;
};

export function BuyMenu({ h, onBuy, onClose }: { h: Hud; onBuy: (i: ShopItem) => void; onClose: () => void }) {
  return (
    <div className="g-ridgeline-buy" onPointerDown={(e) => e.stopPropagation()}>
      <div className="g-ridgeline-buyHead">
        <b>Buy</b>
        <span className="g-ridgeline-buyCredits">¤ {h.credits}</span>
        <span className="g-ridgeline-buyTime">{clock(h.timer)}</span>
        <button type="button" className="g-ridgeline-x" onClick={onClose} aria-label="Close the buy menu">
          ✕
        </button>
      </div>
      <div className="g-ridgeline-buyGrid">
        {SHOP.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map((i) => {
              const owned = !!h.owned[i];
              const price = itemPrice(i);
              const short = !owned && price > h.credits;
              return (
                <button key={i} type="button" disabled={owned || short} className={owned ? 'is-owned' : ''} onClick={() => onBuy(i)}>
                  <b>{itemName(i)}</b>
                  <span>{itemLine(i)}</span>
                  <em>{owned ? 'owned' : price === 0 ? 'free' : `¤ ${price}`}</em>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <p className="g-ridgeline-buyNote">guns you keep alive carry over. a gun or armor swapped in the same buy phase is refunded.</p>
    </div>
  );
}

export function Scoreboard({ rows, mode }: { rows: Row[]; mode: Mode }) {
  const teams = mode === 'uplink' ? [0, 1] : [-1];
  return (
    <div className="g-ridgeline-board">
      {teams.map((t) => (
        <table key={t} className={t === 1 ? 'is-them' : 'is-you'}>
          <thead>
            <tr>
              <th>{t === 0 ? 'Your team' : t === 1 ? 'Enemy team' : 'Players'}</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>Score</th>
              {t === 0 && <th>¤</th>}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => t < 0 || r.team === t)
              .map((r, i) => (
                <tr key={i} className={`${r.you ? 'is-you' : ''} ${r.alive ? '' : 'is-dead'}`}>
                  <td>{r.name}</td>
                  <td>{r.k}</td>
                  <td>{r.d}</td>
                  <td>{r.a}</td>
                  <td>{r.cs}</td>
                  {t === 0 && <td>{r.credits ?? ''}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

export function DeathPanel({ h, touch }: { h: Hud; touch: boolean }) {
  if (h.alive || !h.dead) return null;
  return (
    <div className="g-ridgeline-dead">
      <small>knocked out by</small>
      <b>{h.dead.by}</b>
      <span>
        {h.dead.w}
        {h.dead.head ? ', headshot' : ''}
      </span>
      {h.mode === 'dm' ? <em>back in {Math.max(0, Math.ceil(h.dead.respawn))}</em> : h.watching ? <em>watching {h.watching}{touch ? ', tap to switch' : ', click to switch'}</em> : <em>your team is out</em>}
    </div>
  );
}

export function Scope({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <div className="g-ridgeline-scope" aria-hidden="true">
      <div className="g-ridgeline-scopeLens">
        <i className="is-h" />
        <i className="is-v" />
      </div>
    </div>
  );
}

/** Crosshair, hit marker and damage arcs, moved every frame through refs (no React renders). */
export type FastHud = { set(spread: number, show: boolean): void; hit(kill: boolean, head: boolean): void; hurt(angle: number): void; tick(dt: number): void };
export const Reticle = forwardRef<FastHud, { shotgun: boolean }>(function Reticle({ shotgun }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const hitEl = useRef<HTMLDivElement>(null);
  const arcs = useRef<HTMLDivElement>(null);
  const hitT = useRef(0);
  const hurts = useRef<{ a: number; t: number; el: HTMLElement }[]>([]);
  useImperativeHandle(ref, () => ({
    set(spread, show) {
      const el = root.current;
      if (!el) return;
      el.style.setProperty('--gap', `${Math.min(80, 3 + spread)}px`);
      el.style.opacity = show ? '1' : '0';
    },
    hit(kill, head) {
      const el = hitEl.current;
      if (!el) return;
      hitT.current = kill ? 0.45 : 0.22;
      el.dataset.kind = kill ? 'kill' : head ? 'head' : 'hit';
      el.style.opacity = '1';
    },
    hurt(angle) {
      const box = arcs.current;
      if (!box) return;
      const el = document.createElement('i');
      box.appendChild(el);
      hurts.current.push({ a: angle, t: 1.2, el });
      if (hurts.current.length > 6) hurts.current.shift()?.el.remove();
    },
    tick(dt) {
      if (hitT.current > 0) {
        hitT.current -= dt;
        if (hitT.current <= 0 && hitEl.current) hitEl.current.style.opacity = '0';
      }
      hurts.current = hurts.current.filter((h) => {
        h.t -= dt;
        if (h.t <= 0) {
          h.el.remove();
          return false;
        }
        h.el.style.transform = `rotate(${h.a}rad)`;
        h.el.style.opacity = String(Math.min(1, h.t * 1.5));
        return true;
      });
    },
  }));
  useEffect(
    () => () => {
      for (const h of hurts.current) h.el.remove();
    },
    [],
  );
  return (
    <>
      <div ref={root} className={`g-ridgeline-cross${shotgun ? ' is-ring' : ''}`} aria-hidden="true">
        <i className="is-t" />
        <i className="is-b" />
        <i className="is-l" />
        <i className="is-r" />
        <b />
      </div>
      <div ref={hitEl} className="g-ridgeline-hit" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div ref={arcs} className="g-ridgeline-arcs" aria-hidden="true" />
    </>
  );
});

/** The minimap: the baked map picture, uplinks, your team, enemies your team can see, and you. Drawn on demand. */
export type MinimapApi = { draw(s: MapState): void };
export type MapState = { x: number; z: number; yaw: number; site: number; live: boolean; mates: { x: number; z: number }[]; foes: { x: number; z: number }[] };
export const Minimap = forwardRef<MinimapApi, { world: World; big?: boolean }>(function Minimap({ world, big }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const mm = world.minimap;
    const c = document.createElement('canvas');
    c.width = mm.size;
    c.height = mm.size;
    const g = c.getContext('2d');
    if (g) g.putImageData(new ImageData(new Uint8ClampedArray(mm.data), mm.size, mm.size), 0, 0);
    img.current = c;
  }, [world]);
  useImperativeHandle(ref, () => ({
    draw(s) {
      const c = cv.current;
      const src = img.current;
      if (!c || !src) return;
      const g = c.getContext('2d');
      if (!g) return;
      const size = c.width;
      const mm = world.minimap;
      const view = big ? mm.span : 70;
      const scale = size / (2 * view);
      const cx = big ? 0 : s.x;
      const cz = big ? 0 : s.z;
      const toX = (x: number) => (x - cx) * scale + size / 2;
      const toY = (z: number) => (z - cz) * scale + size / 2;
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath();
      if (big) g.rect(0, 0, size, size);
      else g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.clip();
      const k = mm.size / (2 * mm.span);
      g.imageSmoothingEnabled = true;
      g.drawImage(src, (cx - view + mm.span) * k, (cz - view + mm.span) * k, 2 * view * k, 2 * view * k, 0, 0, size, size);
      world.sites.forEach((site, i) => {
        const on = s.live && i === s.site;
        g.fillStyle = on ? '#ffd56a' : 'rgba(255,255,255,0.75)';
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.font = `bold ${big ? 16 : 12}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const px = toX(site.x);
        const py = toY(site.z);
        if (on) {
          g.beginPath();
          g.arc(px, py, 9 * scale + 3, 0, Math.PI * 2);
          g.strokeStyle = 'rgba(255,213,106,0.9)';
          g.lineWidth = 2;
          g.stroke();
        }
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.strokeText(site.name, px, py);
        g.fillText(site.name, px, py);
      });
      const dot = (x: number, z: number, col: string, r: number) => {
        g.beginPath();
        g.arc(toX(x), toY(z), r, 0, Math.PI * 2);
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.lineWidth = 1;
        g.stroke();
      };
      for (const p of s.mates) dot(p.x, p.z, '#4fb4ff', big ? 4 : 3.5);
      for (const p of s.foes) dot(p.x, p.z, '#ff5a3c', big ? 4 : 3.5);
      // you: an arrow along the view
      const px = toX(s.x);
      const py = toY(s.z);
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      g.save();
      g.translate(px, py);
      g.rotate(Math.atan2(fz, fx) + Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2.5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.stroke();
      g.restore();
      g.restore();
    },
  }));
  return <canvas ref={cv} width={big ? 360 : 168} height={big ? 360 : 168} className={big ? 'g-ridgeline-bigmap' : 'g-ridgeline-minimap'} />;
});

/** Screen markers: the live uplink and your teammates' names, placed every frame through refs. */
export type MarkersApi = { place(list: { key: string; x: number; y: number; on: boolean; text: string; sub?: string; kind: 'site' | 'mate' }[]): void };
export const Markers = forwardRef<MarkersApi, { children?: ReactNode }>(function Markers(_, ref) {
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  useImperativeHandle(ref, () => ({
    place(list) {
      const root = box.current;
      if (!root) return;
      const seen = new Set<string>();
      for (const m of list) {
        seen.add(m.key);
        let el = els.current.get(m.key);
        if (!el) {
          el = document.createElement('div');
          el.className = `g-ridgeline-mark is-${m.kind}`;
          el.innerHTML = '<b></b><small></small>';
          root.appendChild(el);
          els.current.set(m.key, el);
        }
        el.style.display = m.on ? '' : 'none';
        if (!m.on) continue;
        el.style.transform = `translate(${m.x}px, ${m.y}px)`;
        const b = el.firstChild as HTMLElement;
        const s = el.lastChild as HTMLElement;
        if (b.textContent !== m.text) b.textContent = m.text;
        const sub = m.sub ?? '';
        if (s.textContent !== sub) s.textContent = sub;
      }
      for (const [k, el] of els.current)
        if (!seen.has(k)) {
          el.remove();
          els.current.delete(k);
        }
    },
  }));
  return <div ref={box} className="g-ridgeline-marks" aria-hidden="true" />;
});
