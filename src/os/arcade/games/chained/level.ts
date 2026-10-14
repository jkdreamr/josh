// The tower: six circles stacked around a stone core, climbed in a spiral from the lava at the bottom to the stars at
// the top. Pure data and a deterministic generator, so every player climbs the same tower and times are comparable.
//
// Positions live in cylinder coordinates around the core. Arc lengths are measured at R_REF, the radius you tend to
// walk at, so a "3 m gap" means three metres of air between two ledges for someone hugging the core.

export const TOP = 120;
/** The core is solid: nothing goes inside this radius. */
export const R_CORE = 3;
/** Where arc lengths are measured. */
export const R_REF = R_CORE + 1.3;
/** The floor at the bottom of the pit is a ring this wide; beyond it is lava. */
export const R_FLOOR = 14;
/** Nothing goes further out than this (an invisible wall far out over the lava). */
export const R_MAX = R_FLOOR + 5;
export const FLOOR_Y = 0;
/** The lava sea. In Lava mode it starts here and rises. */
export const LAVA_Y = -2.6;
/** Which way round the spiral climbs: -1 is clockwise seen from above, which reads as rightwards on screen. */
export const DIR = -1;
export const START_A = 0;
export const START_R = R_CORE + 1.4;

// The numbers the climb is built around. logic.ts uses the same ones.
export const GRAVITY = 24;
export const JUMP_V = 10;
export const RUN = 6;
export const SPRING_V = 15.5;
/** Souls are this wide (radius) for the core and for feet hanging over an edge. */
export const SOUL_R = 0.34;
/** Feet may hang this far over an edge and still stand. */
export const EDGE_TOL = 0.26;
/** The chain between two souls. */
export const CHAIN_L = 7;
/** A spring is a pad this wide in the middle of its ledge; step on it and up you go. */
export const PAD_R = 0.6;
/** A plain jump lands on a ledge up to this much higher. */
export const MAX_RISE = 1.75;
/** How much of the theoretical reach the tower asks for. */
const REACH_MARGIN = 0.72;

export const jumpApex = (v0 = JUMP_V) => (v0 * v0) / (2 * GRAVITY);
/** Horizontal distance a running jump covers before landing `rise` metres above take-off (0 when the rise is out of reach). */
export function reach(rise: number, v0 = JUMP_V, run = RUN) {
  const disc = v0 * v0 - 2 * GRAVITY * rise;
  if (disc < 0) return 0;
  return (run * (v0 + Math.sqrt(disc))) / GRAVITY;
}
/** The widest gap the tower puts in front of a rise. */
export const maxGap = (rise: number, v0 = JUMP_V) => reach(rise, v0) * REACH_MARGIN;
/** The biggest rise the tower puts behind a gap. */
export function maxRise(gap: number, v0 = JUMP_V, cap = MAX_RISE) {
  const x = (gap / REACH_MARGIN) * (GRAVITY / RUN) - v0;
  if (x <= 0) return cap;
  return Math.min(cap, (v0 * v0 - x * x) / (2 * GRAVITY));
}

export type ZoneId = 'pit' | 'catacombs' | 'forge' | 'frost' | 'cathedral' | 'stars';
export type Palette = {
  /** Background gradient, top to bottom. */
  sky: [string, string, string];
  fog: string;
  fogNear: number;
  fogFar: number;
  /** Hemisphere light: sky and ground. */
  hemi: [string, string];
  sun: string;
  /** Platform stone, light and dark. */
  stone: [string, string];
  core: string;
  /** Torches, beacons, embers. */
  glow: string;
  /** The HUD tint for this zone. */
  ink: string;
};
export type Zone = { id: ZoneId; numeral: string; name: string; line: string; from: number; to: number; palette: Palette };

export const ZONES: Zone[] = [
  {
    id: 'pit',
    numeral: 'I',
    name: 'The Pit',
    line: 'where the fire never sleeps',
    from: 0,
    to: 20,
    palette: { sky: ['#1b0806', '#4a140c', '#8a2a10'], fog: '#3a100b', fogNear: 16, fogFar: 46, hemi: ['#ff9a6a', '#2a0804'], sun: '#ffb080', stone: ['#6a4038', '#3c2521'], core: '#301c18', glow: '#ff7a2a', ink: '#ff9e6e' },
  },
  {
    id: 'catacombs',
    numeral: 'II',
    name: 'The Catacombs',
    line: 'the stones remember every fall',
    from: 20,
    to: 40,
    palette: { sky: ['#101116', '#1e2027', '#2d3038'], fog: '#1a1c23', fogNear: 14, fogFar: 44, hemi: ['#aab3c8', '#15171c'], sun: '#cfd7e6', stone: ['#73757b', '#45474d'], core: '#3a3b40', glow: '#8fe3a0', ink: '#b9e8c4' },
  },
  {
    id: 'forge',
    numeral: 'III',
    name: 'The Forge',
    line: 'iron, steam and a thousand sparks',
    from: 40,
    to: 60,
    palette: { sky: ['#160f0a', '#3a2010', '#6a3a12'], fog: '#2a1a10', fogNear: 15, fogFar: 46, hemi: ['#ffc27d', '#2a1408'], sun: '#ffd9a0', stone: ['#5b5048', '#33302e'], core: '#262a30', glow: '#ffa63a', ink: '#ffc98a' },
  },
  {
    id: 'frost',
    numeral: 'IV',
    name: 'The Frozen Lake',
    line: 'the cold at the bottom of everything, turned upside down',
    from: 60,
    to: 80,
    palette: { sky: ['#08131f', '#1a3650', '#3b6a8c'], fog: '#1e3a52', fogNear: 18, fogFar: 54, hemi: ['#d6ecff', '#1a2e44'], sun: '#eef8ff', stone: ['#c6e6f6', '#86b9d4'], core: '#355772', glow: '#9fe0ff', ink: '#cfeeff' },
  },
  {
    id: 'cathedral',
    numeral: 'V',
    name: 'The Cathedral',
    line: 'light through broken glass',
    from: 80,
    to: 100,
    palette: { sky: ['#150e28', '#2d1f4e', '#4a2f6a'], fog: '#2a1e44', fogNear: 16, fogFar: 50, hemi: ['#e8ccff', '#1c1230'], sun: '#ffe9c8', stone: ['#8f8299', '#5a4f66'], core: '#484056', glow: '#ffd27a', ink: '#e9d2ff' },
  },
  {
    id: 'stars',
    numeral: 'VI',
    name: 'The Stars',
    line: 'and thence we came forth to see again the stars',
    from: 100,
    to: TOP,
    palette: { sky: ['#02030a', '#0b1030', '#1c2a5a'], fog: '#0c1230', fogNear: 20, fogFar: 70, hemi: ['#c2ceff', '#0a0d24'], sun: '#ffffff', stone: ['#8891b4', '#5a6184'], core: '#3b4160', glow: '#ffffff', ink: '#dfe6ff' },
  },
];

export const zoneIndex = (y: number) => Math.max(0, Math.min(ZONES.length - 1, ZONES.findIndex((z) => y < z.to) === -1 ? ZONES.length - 1 : ZONES.findIndex((z) => y < z.to)));
export const zoneAt = (y: number) => ZONES[zoneIndex(y)];

export type PlatformKind = 'floor' | 'stone' | 'crumble' | 'lift' | 'swing' | 'ice' | 'spring' | 'checkpoint' | 'goal';
export type Platform = {
  id: number;
  kind: PlatformKind;
  zone: number;
  /** Centre angle in radians. Cumulative along the climb (not wrapped), so neighbours differ by small numbers. */
  a: number;
  /** Half width in radians. */
  span: number;
  r0: number;
  r1: number;
  /** Top at rest. Lifts travel amp either side of it. */
  y: number;
  h: number;
  /** Lift: metres of travel either way. Swing: radians either way. */
  amp: number;
  period: number;
  phase: number;
  /** Checkpoint number, -1 for none. The floor is 0. */
  cp: number;
  /** Position along the route. */
  seq: number;
};
export type Level = { platforms: Platform[]; route: Platform[]; checkpoints: Platform[]; floor: Platform; goal: Platform };

export type Pose = { a: number; y: number; va: number; vy: number };
/** Where a platform is at time t: lifts bob, swings sway, everything else stays put. */
export function pose(p: Platform, t: number, out: Pose = { a: 0, y: 0, va: 0, vy: 0 }): Pose {
  out.a = p.a;
  out.y = p.y;
  out.va = 0;
  out.vy = 0;
  if (p.kind === 'lift' || p.kind === 'swing') {
    const w = (Math.PI * 2) / p.period;
    const s = Math.sin(w * t + p.phase);
    const c = Math.cos(w * t + p.phase) * w;
    if (p.kind === 'lift') {
      out.y += p.amp * s;
      out.vy = p.amp * c;
    } else {
      out.a += p.amp * s;
      out.va = p.amp * c;
    }
  }
  return out;
}

export const TAU = Math.PI * 2;
/** Shortest signed angle from b to a. */
export const angDiff = (a: number, b: number) => ((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
/** Arc metres at R_REF to radians. */
export const rad = (m: number) => m / R_REF;

/** Deterministic generator (mulberry32). */
export function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Recipe = {
  rise: [number, number];
  gap: [number, number];
  width: [number, number];
  depth: [number, number];
  /** Chance of each special kind per step; the rest are stone. */
  kinds: [PlatformKind, number][];
  /** A wide resting ledge every this many steps. */
  rest: number;
  /** Platforms float this far off the core. */
  off: number;
};

const RECIPES: Recipe[] = [
  { rise: [0.9, 1.45], gap: [0.4, 1.9], width: [3.4, 5.0], depth: [3.0, 4.0], kinds: [], rest: 7, off: 0 },
  { rise: [1.1, 1.65], gap: [1.0, 2.5], width: [2.4, 4.0], depth: [2.6, 3.6], kinds: [['crumble', 0.42]], rest: 8, off: 0 },
  { rise: [1.1, 1.6], gap: [1.2, 2.7], width: [2.6, 4.0], depth: [2.6, 3.4], kinds: [['lift', 0.3], ['spring', 0.2]], rest: 8, off: 0 },
  { rise: [1.0, 1.6], gap: [1.4, 2.9], width: [3.0, 4.6], depth: [2.8, 3.8], kinds: [['ice', 0.72]], rest: 9, off: 0 },
  { rise: [1.2, 1.7], gap: [1.8, 3.0], width: [2.2, 3.4], depth: [2.4, 3.2], kinds: [['swing', 0.34], ['crumble', 0.2]], rest: 8, off: 0 },
  { rise: [1.2, 1.7], gap: [2.0, 3.2], width: [2.0, 3.0], depth: [2.2, 3.0], kinds: [['spring', 0.16]], rest: 7, off: 0.7 },
];

export const SEED = 1013;
/** Platform thickness. */
export const THICK = 0.55;

/**
 * Builds the tower. Every step is placed inside what a running jump can do: the gap is chosen first, then the rise is
 * capped by maxRise(gap). Lifts are reached at the bottom of their travel and left from the top; swings are reached
 * at their nearest approach and left from their farthest; a spring's launch decides the step after it.
 */
export function buildLevel(seed = SEED): Level {
  const rng = mulberry(seed);
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const platforms: Platform[] = [];
  const route: Platform[] = [];
  const checkpoints: Platform[] = [];

  const floor: Platform = { id: 0, kind: 'floor', zone: 0, a: START_A, span: Math.PI, r0: R_CORE, r1: R_FLOOR, y: FLOOR_Y, h: 1.2, amp: 0, period: 1, phase: 0, cp: 0, seq: 0 };
  platforms.push(floor);
  route.push(floor);
  checkpoints.push(floor);

  // the running edge of the climb, in arc metres (increasing) and height
  let s = 1.2; // the start position is a metre behind the first ledge
  let y = FLOOR_Y;
  // what the last step hands to the next: a plain jump, or a spring's launch
  let launch = JUMP_V;
  let fromTop = y; // the height the next jump leaves from (a lift's top, a stone's top)
  let sinceRest = 0;
  let crumbleRun = 0;
  let cp = 1;
  let zone = 0;

  const add = (p: Omit<Platform, 'id' | 'seq'>) => {
    const full: Platform = { ...p, id: platforms.length, seq: route.length };
    platforms.push(full);
    route.push(full);
    return full;
  };

  let guard = 0;
  while (fromTop < TOP - 1.7 && guard++ < 400) {
    zone = zoneIndex(Math.min(TOP - 0.01, fromTop + 0.01));
    const rc = RECIPES[zone];
    const newZone = zone > 0 && (checkpoints[checkpoints.length - 1]?.zone ?? 0) < zone && route[route.length - 1].zone < zone;
    const lastKind = route[route.length - 1].kind;

    // the step
    let kind: PlatformKind = 'stone';
    let gap: number;
    let rise: number;
    let width: number;
    let depth = between(rc.depth[0], rc.depth[1]);
    const first = route.length === 1;

    if (launch > JUMP_V) {
      // landing a spring: high and forgiving
      rise = Math.min(between(3.0, 3.9), maxRise(0, launch, 4.2), Math.max(0.8, TOP - 1.7 - fromTop));
      gap = Math.min(between(1.4, 2.6), maxGap(rise, launch) * 0.85);
      width = between(3.4, 4.6);
      kind = zone === 3 ? 'ice' : 'stone';
    } else if (first) {
      gap = 0.9;
      rise = 1.0;
      width = 4.4;
    } else if (newZone) {
      // every circle opens on a wide ledge with a beacon
      gap = between(0.6, 1.4);
      rise = Math.min(between(0.9, 1.3), maxRise(gap));
      width = 6.5;
      depth = Math.max(depth, 3.6);
      kind = 'checkpoint';
    } else if (sinceRest >= rc.rest) {
      gap = between(rc.gap[0], Math.min(rc.gap[1], 2.2));
      rise = Math.min(between(rc.rise[0], rc.rise[1]), maxRise(gap));
      width = between(4.8, 6.0);
    } else {
      gap = between(rc.gap[0], rc.gap[1]);
      rise = Math.min(between(rc.rise[0], rc.rise[1]), maxRise(gap));
      width = between(rc.width[0], rc.width[1]);
      let roll = rng();
      for (const [k, chance] of rc.kinds) {
        if (roll < chance) {
          kind = k;
          break;
        }
        roll -= chance;
      }
      // a crumbling ledge is a stepping stone: short, with a hop either side, so a soul can wait on the ledge before
      // it while the other crosses to the ledge after it on one chain; never two in a row
      if (kind === 'crumble' && (crumbleRun >= 1 || lastKind === 'lift' || lastKind === 'swing' || lastKind === 'spring')) kind = 'stone';
      if (kind === 'crumble') {
        gap = Math.min(gap, 1.1);
        rise = Math.min(rise, 1.3);
      }
      if (lastKind === 'crumble') {
        gap = Math.min(gap, 1.1);
        rise = Math.min(rise, 1.3);
        if (kind !== 'stone' && kind !== 'ice') kind = 'stone';
      }
      if ((kind === 'lift' || kind === 'swing' || kind === 'spring') && (lastKind === 'lift' || lastKind === 'swing' || lastKind === 'spring')) kind = 'stone';
      if ((kind === 'lift' || kind === 'spring') && fromTop + 6.5 > TOP - 1.7) kind = 'stone';
      if (kind === 'swing' && fromTop + 3.5 > TOP - 1.7) kind = 'stone';
    }

    let a: number;
    let top: number;
    let amp = 0;
    let period = 1;
    let phase = 0;

    if (kind === 'lift') {
      amp = between(1.2, 1.8);
      period = between(3.2, 4.4);
      phase = rng() * TAU;
      width = between(2.6, 3.4);
      depth = Math.min(depth, 3.0);
      const low = fromTop + Math.min(rise, 1.3);
      top = low + amp; // rest height is the middle of its travel
      a = DIR * rad(s + gap + width / 2);
      s += gap + width;
      fromTop = top + amp;
    } else if (kind === 'swing') {
      const sway = between(1.4, 2.2);
      amp = rad(sway);
      period = between(3.6, 5.0);
      phase = rng() * TAU;
      width = between(2.4, 3.2);
      top = fromTop + rise;
      // nearest approach to the last ledge leaves `gap`; the next ledge is measured from its farthest reach
      a = DIR * rad(s + gap + sway + width / 2);
      s += gap + sway * 2 + width;
      fromTop = top;
    } else {
      if (kind === 'spring') {
        width = 3.0;
        depth = Math.min(depth, 2.8);
      }
      if (kind === 'crumble') width = Math.min(width, 2.6);
      top = fromTop + rise;
      a = DIR * rad(s + gap + width / 2);
      s += gap + width;
      fromTop = top;
    }

    const r0 = R_CORE + rc.off;
    const p = add({ kind, zone, a, span: rad(width) / 2, r0, r1: r0 + depth, y: top, h: THICK, amp, period, phase, cp: kind === 'checkpoint' ? cp : -1 });
    if (kind === 'checkpoint') {
      checkpoints.push(p);
      cp++;
    }
    y = top;
    launch = kind === 'spring' ? SPRING_V : JUMP_V;
    sinceRest = width >= 4.8 || kind === 'checkpoint' ? 0 : sinceRest + 1;
    crumbleRun = kind === 'crumble' ? crumbleRun + 1 : 0;
  }

  // the way out: a wide round ledge at the very top, reached with an easy hop
  const gap = 1.0;
  const width = 9;
  const goal = add({ kind: 'goal', zone: ZONES.length - 1, a: DIR * rad(s + gap + width / 2), span: rad(width) / 2, r0: R_CORE, r1: R_CORE + 4.6, y: TOP, h: THICK + 0.2, amp: 0, period: 1, phase: 0, cp });
  checkpoints.push(goal);
  return { platforms, route, checkpoints, floor, goal };
}

/** A spawn spot on a checkpoint ledge: souls line up along the arc a metre apart. */
export function spawnAt(level: Level, cp: number, slot: number, slots: number): { x: number; y: number; z: number; a: number } {
  const p = level.checkpoints[Math.max(0, Math.min(level.checkpoints.length - 1, cp))];
  const r = p.kind === 'floor' ? START_R : p.r0 + 1.3;
  const off = (slot - (slots - 1) / 2) * 1.05;
  const a = p.a + DIR * (-off / r);
  return { x: Math.cos(a) * r, y: p.y, z: Math.sin(a) * r, a };
}

/** How much of the climb a height is, 0 to 1. */
export const progress = (y: number) => Math.max(0, Math.min(1, y / TOP));
