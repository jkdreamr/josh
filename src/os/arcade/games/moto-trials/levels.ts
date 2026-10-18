// Level definitions for Moto Trials. Pure data built by a tiny track DSL; no DOM.
import { buildWorld, type LoopGate, type PhysWorld, type Saw, type Seg } from './physics.ts';

export type Theme = {
  /** Sky gradient top to bottom. */
  skyTop: string;
  skyBot: string;
  /** Parallax silhouette layers, far to near. */
  far: string;
  mid: string;
  near: string;
  /** Terrain fill and the bright top edge. */
  ground: string;
  edge: string;
  /** Dust, ramps, saws. */
  dust: string;
  wood: string;
  saw: string;
  /** Soil band under the surface and speckles in the dirt body. */
  soil: string;
  speckle: string;
  /** Sun or moon disc + cloud tint. */
  sun: string;
  cloud: string;
  /** Foreground props scattered on flat ground. */
  prop: 'bush' | 'cactus' | 'pine' | 'rock' | 'cone';
  /** Decorative skyline: 'hills' | 'trees' | 'city' | 'rocks' | 'snow' */
  scenery: 'hills' | 'trees' | 'city' | 'rocks' | 'snow';
  /** Dimmer world for night themes. */
  night?: boolean;
};

export type Level = {
  id: string;
  name: string;
  theme: Theme;
  /** Physics world ready to use (fresh per call sites use cloneLevel). */
  segs: Seg[];
  saws: Saw[];
  loops: LoopGate[];
  killY: number;
  start: { x: number; y: number };
  checkpoints: number[];
  finishX: number;
  /** Gold, silver, bronze in ms, strictly increasing. */
  stars: [number, number, number];
  /** Background props (theme.prop) fixed in level space, left to right. Scenery only, no collider. */
  props: Prop[];
};

/** A scenery prop standing on the ground at x; k in 0..1 varies its size. */
export type Prop = { x: number; y: number; k: number };

type Built = Omit<Level, 'id' | 'name' | 'theme' | 'stars' | 'props'>;

const norm = (ax: number, ay: number, bx: number, by: number) => {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return { nx: -(by - ay) / len, ny: (bx - ax) / len, len };
};

/** A little track builder: a cursor walks left to right emitting one-sided segments. */
export function track() {
  let x = 0;
  let y = 0;
  const segs: Seg[] = [];
  const saws: Saw[] = [];
  const loops: LoopGate[] = [];
  const checkpoints: number[] = [];
  let finishX = 0;
  let minY = 0;

  const seg = (bx: number, by: number, kind?: string) => {
    const { nx, ny, len } = norm(x, y, bx, by);
    segs.push({ ax: x, ay: y, bx, by, nx, ny, len, kind });
    if (by < minY) minY = by;
    if (y < minY) minY = y;
    x = bx;
    y = by;
  };

  const api = {
    /** Flat ground. */
    flat(len: number, kind?: string) {
      seg(x + len, y, kind);
      return api;
    },
    /** Sloped ground, climbing dh meters over len. */
    slope(len: number, dh: number, kind?: string) {
      seg(x + len, y + dh, kind);
      return api;
    },
    /** A jump ramp: steep plank ending in a lip, airborne after it. */
    ramp(len: number, h: number) {
      const sx = x;
      const sy = y;
      seg(x + len * 0.8, y + h * 0.82, 'wood');
      seg(x + len, y + h, 'wood'); // the lip
      void sx;
      void sy;
      return api;
    },
    /**
     * A curved kicker: a wooden arc that bends from flat up to `deg` over `len` meters. A tight
     * curl at speed tips the nose up (or down for negative deg), so the rider has to lean to land.
     */
    kicker(len: number, deg: number, n = 6) {
      const a1 = (deg * Math.PI) / 180;
      const r = len / Math.sin(Math.abs(a1));
      const cx0 = x;
      const cy0 = y;
      const sgn = Math.sign(deg);
      for (let i = 1; i <= n; i++) {
        const t = (Math.abs(a1) * i) / n;
        seg(cx0 + r * Math.sin(t), cy0 + sgn * r * (1 - Math.cos(t)), 'wood');
      }
      return api;
    },
    /** A landing ramp: falls dh meters over len, steep at the top and easing out at the bottom. */
    land(len: number, dh: number) {
      seg(x + len * 0.5, y - dh * 0.62);
      seg(x + len * 0.3, y - dh * 0.3);
      seg(x + len * 0.2, y - dh * 0.08);
      return api;
    },
    /** An empty gap; landing ground is dy lower (negative) or higher. */
    gap(len: number, dy = 0) {
      x += len;
      y += dy;
      return api;
    },
    /** A whoop: up and back down. */
    bump(len: number, h: number) {
      seg(x + len / 2, y + h);
      seg(x + len, y);
      return api;
    },
    /** A ledge: the ground continues h meters lower. */
    drop(h: number) {
      y -= h;
      if (y < minY) minY = y;
      return api;
    },
    /** A tabletop jump: up slope, flat crown, down slope. */
    table(len: number, h: number) {
      seg(x + len * 0.3, y + h);
      seg(x + len * 0.55, y + h);
      seg(x + len * 0.85, y);
      seg(x + len, y);
      return api;
    },
    /**
     * A vertical loop standing on the ground ahead. Ridable counterclockwise: enter at the
     * bottom, up the far side ('in' gate), over the top and down the near side ('out' gate).
     * The flat ground passes straight underneath so a stalled bike just rolls through.
     */
    loop(r: number) {
      const cx = x + r;
      const cy = y + r;
      const idx = loops.length;
      const arc = (a0: number, a1: number, half: 'in' | 'out', n: number) => {
        for (let i = 0; i < n; i++) {
          const t0 = a0 + ((a1 - a0) * i) / n;
          const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
          const ax = cx + r * Math.cos(t0);
          const ay = cy + r * Math.sin(t0);
          const bx = cx + r * Math.cos(t1);
          const by = cy + r * Math.sin(t1);
          const { nx, ny, len } = norm(ax, ay, bx, by);
          segs.push({ ax, ay, bx, by, nx, ny, len, gate: { loop: idx, half }, kind: 'loop' });
        }
      };
      // 'in': bottom up the far (right) side to the top. 'out': top down the near (left) side,
      // stopping a few degrees short of the bottom so the exit rolls onto the flat.
      arc(-Math.PI / 2, Math.PI / 2, 'in', 16);
      arc(Math.PI / 2, (264 * Math.PI) / 180, 'out', 14);
      loops.push({ cx, cy, r, right: cx + r, phase: 'approach' });
      api.flat(2 * r);
      return api;
    },
    /** A spinning saw blade hanging in the air; absolute position relative to the cursor. */
    saw(dx: number, dy: number, r: number) {
      saws.push({ x: x + dx, y: y + dy, r });
      return api;
    },
    checkpoint() {
      checkpoints.push(x);
      return api;
    },
    finish() {
      finishX = x;
      return api;
    },
    done(): Built {
      const world = { segs, saws, loops, killY: minY - 14 };
      void world;
      return { segs, saws, loops: loops.map((l) => ({ ...l })), killY: minY - 14, start: { x: 4, y: y0start(segs) }, checkpoints, finishX };
    },
  };

  const y0start = (ss: Seg[]) => {
    // find ground height at x=4
    for (const s of ss) {
      if (s.ax <= 4 && s.bx >= 4) {
        const t = (4 - s.ax) / (s.len || 1);
        return s.ay + (s.by - s.ay) * Math.min(1, Math.max(0, t)) + 1.1;
      }
    }
    return 2;
  };
  return api;
}

const THEMES: Record<string, Theme> = {
  dawn: { skyTop: '#ffb36b', skyBot: '#ff7e5f', far: '#c96a4e', mid: '#a34e3e', near: '#7d3a30', ground: '#5a3226', edge: '#ffb36b', dust: '#d9a077', wood: '#8a5a34', saw: '#d8d8e0', soil: '#7a4630', speckle: 'rgba(0,0,0,0.18)', sun: '#fff0d8', cloud: 'rgba(255,236,220,0.55)', prop: 'bush', scenery: 'hills' },
  desert: { skyTop: '#7ec8e3', skyBot: '#ffe1a8', far: '#e8b36a', mid: '#c98d4e', near: '#9c6537', ground: '#6d4526', edge: '#ffd98e', dust: '#e0b37c', wood: '#8a5a34', saw: '#d8d8e0', soil: '#8a5a32', speckle: 'rgba(0,0,0,0.16)', sun: '#fff6d8', cloud: 'rgba(255,255,255,0.65)', prop: 'cactus', scenery: 'hills' },
  lagoon: { skyTop: '#7fd4c9', skyBot: '#d9f4e3', far: '#58a99a', mid: '#3d8577', near: '#2b6157', ground: '#4c3f33', edge: '#a8e6c9', dust: '#8fc9b0', wood: '#7a5a38', saw: '#d8d8e0', soil: '#63513a', speckle: 'rgba(0,0,0,0.16)', sun: '#fffbe8', cloud: 'rgba(255,255,255,0.7)', prop: 'bush', scenery: 'hills' },
  quarry: { skyTop: '#8fa3b8', skyBot: '#d9c8a8', far: '#77879c', mid: '#5d6b7f', near: '#454f61', ground: '#4a4038', edge: '#cfc0a5', dust: '#a89880', wood: '#7d5c36', saw: '#e0e0e8', soil: '#5d5045', speckle: 'rgba(0,0,0,0.22)', sun: '#f2ecdc', cloud: 'rgba(255,255,255,0.5)', prop: 'rock', scenery: 'rocks' },
  forest: { skyTop: '#9fd18b', skyBot: '#e8f2c8', far: '#5c8f52', mid: '#41713f', near: '#2c5230', ground: '#3f3325', edge: '#a8d97f', dust: '#8ba86b', wood: '#6e4f2e', saw: '#d8d8e0', soil: '#54452f', speckle: 'rgba(0,0,0,0.18)', sun: '#fffbe0', cloud: 'rgba(255,255,255,0.7)', prop: 'pine', scenery: 'trees' },
  autumn: { skyTop: '#e8a15c', skyBot: '#f5d9a8', far: '#b06a3e', mid: '#8a4f32', near: '#613a28', ground: '#4a3428', edge: '#f0be7a', dust: '#c99a68', wood: '#6e4a28', saw: '#d8dce4', soil: '#5d4030', speckle: 'rgba(0,0,0,0.18)', sun: '#ffe8c8', cloud: 'rgba(255,244,224,0.6)', prop: 'pine', scenery: 'trees' },
  neon: { skyTop: '#1b2140', skyBot: '#4a2a6e', far: '#352a55', mid: '#2a2144', near: '#1e1834', ground: '#241f33', edge: '#8f7ae0', dust: '#6a5a9e', wood: '#4a3a66', saw: '#c8c8f0', soil: '#332a4a', speckle: 'rgba(0,0,0,0.3)', sun: '#e8e2ff', cloud: 'rgba(60,50,100,0.5)', prop: 'cone', scenery: 'city', night: true },
  frost: { skyTop: '#b8cfe8', skyBot: '#eef4fb', far: '#9db6d4', mid: '#7d9cc0', near: '#5d7da0', ground: '#e8eef6', edge: '#ffffff', dust: '#dceaf8', wood: '#7a6248', saw: '#b8c8d8', soil: '#c2d2e4', speckle: 'rgba(90,110,140,0.18)', sun: '#ffffff', cloud: 'rgba(255,255,255,0.75)', prop: 'pine', scenery: 'snow' },
  canyon: { skyTop: '#e8633f', skyBot: '#ffc98a', far: '#b04a38', mid: '#8a3a30', near: '#5f2b24', ground: '#54281e', edge: '#ffab6e', dust: '#c97a50', wood: '#7a4a2e', saw: '#d8d8e0', soil: '#6d3624', speckle: 'rgba(0,0,0,0.2)', sun: '#ffe4c0', cloud: 'rgba(255,224,190,0.5)', prop: 'cactus', scenery: 'rocks' },
  storm: { skyTop: '#2e3444', skyBot: '#6a5a70', far: '#3c3a50', mid: '#302e42', near: '#242234', ground: '#2c2434', edge: '#9a8ab0', dust: '#6a5a80', wood: '#4a3a52', saw: '#d0d0e8', soil: '#3a3348', speckle: 'rgba(0,0,0,0.3)', sun: '#d8d4e8', cloud: 'rgba(70,64,92,0.5)', prop: 'cone', scenery: 'city', night: true },
};

const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Seeded prop spots on gentle dirt: never on wood, in a gap, on a steep face or under a loop. */
export function propsFor(id: string, segs: Seg[], finishX: number): Prop[] {
  const seed = (parseInt(id.slice(6), 10) || 1) * 91;
  const loops = segs.filter((s) => s.kind === 'loop');
  const surface = (x: number) => {
    let best: Seg | null = null;
    let by = -Infinity;
    for (const s of segs) {
      if (s.kind === 'loop' || x < Math.min(s.ax, s.bx) || x > Math.max(s.ax, s.bx)) continue;
      const y = s.ay + ((s.by - s.ay) * (x - s.ax)) / (s.bx - s.ax || 1);
      if (y > by) {
        by = y;
        best = s;
      }
    }
    return best ? { y: by, wood: best.kind === 'wood' } : null;
  };
  const out: Prop[] = [];
  let x = 6;
  for (let i = 0; x < finishX + 8; i++) {
    x += 7 + hash(i + seed) * 9;
    const g = surface(x);
    const g0 = surface(x - 1.5);
    const g1 = surface(x + 1.5);
    if (!g || !g0 || !g1 || g.wood || g0.wood || g1.wood || Math.abs(g1.y - g0.y) > 0.6) continue;
    if (loops.some((s) => Math.abs(s.ax - x) < 1.5 || Math.abs(s.bx - x) < 1.5 || (x - s.ax) * (x - s.bx) < 0)) continue;
    out.push({ x, y: g.y, k: hash(x * 3.7 + seed) });
  }
  return out;
}

function lvl(id: string, name: string, theme: Theme, stars: [number, number, number], built: Built): Level {
  return { id, name, theme, stars, ...built, props: propsFor(id, built.segs, built.finishX) };
}

/** The ten tracks. Each is built fresh per run through freshLevel below. */
const BUILDERS: Record<string, () => Built> = {
  // 1-2 teach the kicker: big soft jumps that land on gas alone, room to try a first flip
  'level-1': () =>
    track()
      .flat(18)
      .bump(10, 0.7)
      .flat(10)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 4)
      .flat(10)
      .bump(12, 1.0)
      .flat(10)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(14, 3.5)
      .flat(8)
      .table(12, 1.2)
      .flat(12)
      .kicker(5, 22)
      .gap(2, -1)
      .land(12, 4)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
  'level-2': () =>
    track()
      .flat(16)
      .slope(12, 2.4)
      .slope(10, -2.4)
      .flat(10)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 4.5)
      .flat(6)
      .bump(14, 1.8)
      .flat(12)
      .kicker(5, 28)
      .gap(3, -1)
      .land(16, 6)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 4)
      .flat(6)
      .bump(10, 1.3)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .finish()
      .flat(10)
      .done(),
  // 3 on: at least one section that throws a gas-only rider on their head
  'level-3': () =>
    track()
      .flat(30)
      .loop(3.0)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(16, 4)
      .flat(14)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(14, 3.5)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .loop(3.0)
      .flat(8)
      .finish()
      .flat(10)
      .done(),
  'level-4': () =>
    track()
      .flat(14)
      .slope(8, 2.8)
      .drop(2.8)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .drop(2)
      .flat(14)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(12)
      .slope(6, 1.5)
      .kicker(4, 25)
      .gap(3, -1.5)
      .land(16, 6)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(12, 3)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
  // 5-8: two precision sections each, a big double flip jump
  'level-5': () =>
    track()
      .flat(16)
      .bump(12, 1.6)
      .flat(10)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(16, 5)
      .flat(14)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(12)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(14)
      .checkpoint()
      .flat(4)
      .slope(16, 4)
      .flat(12)
      .kicker(5, 25)
      .saw(10, 2.6, 0.9)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .loop(3.0)
      .flat(8)
      .finish()
      .flat(10)
      .done(),
  'level-6': () =>
    track()
      .flat(16)
      .slope(10, 2)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .saw(-9, 1.6, 0.9)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(12)
      .kicker(5, 25)
      .saw(10, 2.6, 0.9)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 4)
      .flat(12)
      .slope(6, 1.5)
      .kicker(4, 25)
      .gap(3, -1.5)
      .land(16, 6)
      .flat(12)
      .finish()
      .flat(10)
      .done(),
  'level-7': () =>
    track()
      .flat(14)
      .slope(10, 4)
      .drop(4)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(14)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 35)
      .gap(4, -3)
      .land(22, 11)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(14, 4)
      .flat(12)
      .kicker(2.5, 50)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
  'level-8': () =>
    track()
      .flat(26)
      .loop(3.0)
      .flat(6)
      .loop(3.0)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(12)
      .kicker(5, 25)
      .saw(10, 2.6, 0.9)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(14, 4)
      .flat(14)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
  // 9-10: linked precision runs, nowhere to just hold gas
  'level-9': () =>
    track()
      .flat(16)
      .slope(12, 3)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(14)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .kicker(5, 25)
      .saw(10, 2.6, 0.9)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .slope(6, 1.5)
      .kicker(4, 25)
      .gap(3, -1.5)
      .land(16, 6)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(14, 4)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
  'level-10': () =>
    track()
      .flat(16)
      .slope(10, 3)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 35)
      .gap(4, -3)
      .land(22, 11)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(16, 5)
      .flat(14)
      .kicker(2.5, 50)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .kicker(5, 25)
      .saw(10, 2.6, 0.9)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .kicker(3, 45)
      .gap(3, -1)
      .land(14, 5)
      .flat(12)
      .checkpoint()
      .flat(28)
      .loop(3.0)
      .flat(6)
      .slope(18, 6)
      .flat(14)
      .kicker(6, 32)
      .gap(3, -2)
      .land(20, 9)
      .flat(12)
      .checkpoint()
      .flat(4)
      .slope(14, 4)
      .flat(12)
      .slope(6, 1.5)
      .kicker(4, 25)
      .saw(11, 3.4, 0.9)
      .gap(3, -1.5)
      .land(16, 6)
      .flat(12)
      .kicker(5, 25)
      .gap(3, -1)
      .land(14, 5)
      .flat(10)
      .finish()
      .flat(10)
      .done(),
};

// Star times from the test autopilot: silver sits a little over a clean ride with no flips, gold needs that
// clean lean control plus most of the flips a stunt rider can land (about a second off per flip).
const META_ROWS: [string, string, Theme, [number, number, number]][] = [
  ['level-1', 'First Gear', THEMES.dawn, [17_500, 22_500, 30_000]],
  ['level-2', 'Dune Hop', THEMES.desert, [16_500, 22_500, 30_000]],
  ['level-3', 'Loop Lagoon', THEMES.lagoon, [19_500, 26_000, 35_000]],
  ['level-4', 'Quarry Run', THEMES.quarry, [17_000, 24_000, 32_000]],
  ['level-5', 'Pine Ridge', THEMES.forest, [28_500, 36_000, 48_000]],
  ['level-6', 'Sawmill Sprint', THEMES.autumn, [23_500, 30_000, 41_000]],
  ['level-7', 'Neon Drop', THEMES.neon, [19_500, 29_000, 39_000]],
  ['level-8', 'Frostbite', THEMES.frost, [28_000, 37_000, 50_000]],
  ['level-9', 'Canyon Cross', THEMES.canyon, [25_500, 34_500, 47_000]],
  ['level-10', 'Last Lap', THEMES.storm, [36_000, 48_000, 64_000]],
];

export const LEVEL_IDS = Object.keys(BUILDERS);

/** Fresh level (segments are shared, but the gate states in world loops are new objects). */
export function getLevel(id: string): Level {
  const i = LEVEL_IDS.indexOf(id);
  const row = META_ROWS[i >= 0 ? i : 0];
  return lvl(row[0], row[1], row[2], row[3], BUILDERS[row[0]]());
}

export const LEVELS: Level[] = META_ROWS.map((r) => getLevel(r[0]));

/** A physics world for a level with fresh loop gate state. */
export function worldOf(level: Level): PhysWorld {
  return buildWorld(level.segs, level.saws, level.loops.map((l) => ({ ...l })), level.killY);
}
