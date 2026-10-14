// Pure rules for Chained: souls, ledges, the chain, lava, checkpoints and the modes. No DOM, no three.js.
//
// Souls move in a cylinder around the core. A soul is a point with a radius for the core and for its feet; ledges are
// one-way (you land on them from above and pass through from below). The chain is a distance constraint solved with
// position based dynamics: a standing soul holds against a steady pull and gets dragged by a sharp one, a soul in
// the air takes the whole correction, and two souls hanging off one standing soul pull it toward the edge.
//
// The simulation runs in fixed 1/120 s substeps so it plays the same at every frame rate and in the tests.
import {
  CHAIN_L,
  DIR,
  EDGE_TOL,
  FLOOR_Y,
  GRAVITY,
  JUMP_V,
  LAVA_Y,
  PAD_R,
  R_CORE,
  R_MAX,
  RUN,
  SOUL_R,
  SPRING_V,
  TOP,
  angDiff,
  buildLevel,
  pose,
  spawnAt,
  zoneIndex,
  type Level,
  type Platform,
  type Pose,
} from './level.ts';

export type Mode = 'normal' | 'beginner' | 'lava';
export const MODES = ['normal', 'beginner', 'lava'] as const;
export const isMode = (v: unknown): v is Mode => (MODES as readonly string[]).includes(v as string);
export const MODE_INFO: Record<Mode, { label: string; blurb: string }> = {
  normal: { label: 'Normal', blurb: 'No checkpoints. A fall only costs you height. Lava is just scenery.' },
  beginner: { label: 'Beginner', blurb: 'A beacon at every circle. Fall too far and the team starts again from the last one.' },
  lava: { label: 'Lava', blurb: 'The lava rises from the start. Touch it and the whole team is done.' },
};

export const SUB = 1 / 120;
export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const JUMP_CUT = 4;
export const ACCEL = 42;
export const AIR_ACCEL = 18;
export const FRICTION = 34;
export const ICE_ACCEL = 12;
export const ICE_FRICTION = 4;
export const AIR_FRICTION = 0.5;
export const MAX_FALL = 28;
export const MAX_H = 14;
/** Metres fallen for a hard landing. */
export const HARD_FALL = 6;
/** The lava in Lava mode: starts rising after LAVA_DELAY seconds, this fast (slower for one player climbing two souls). */
export const LAVA_RISE = 0.42;
export const LAVA_RISE_SOLO = 0.3;
export const LAVA_DELAY = 8;
/** Beginner: this far below the last beacon and the team goes back to it. */
export const FALL_TOO_FAR = 12;
export const RESPAWN_T = 1.3;
export const CRUMBLE_WARN = 0.9;
export const CRUMBLE_FALL = 1.6;
export const CRUMBLE_BACK = 5;
export const CRUMBLE_G = 12;
/** A standing soul holds against the chain pulling slower than this; a faster pull drags it. */
export const GRIP_V = 1.2;
/** How much of a yank a standing soul takes against a soul in the air (1), in position and in speed. */
export const YANK_W = 0.5;
export const YANK_K = 0.8;
/** The chain never kicks a soul faster than this in one substep (a teleport or a late packet is not a yank). */
export const CHAIN_KICK = 12;
/** Nor move one further than this in one substep: a big stretch is taken up over a few. */
export const CHAIN_STEP = 0.2;
/** A soul in the air this far below a rim, and this close to it, pulls itself up onto the ledge. */
export const MANTLE_H = 1.15;
export const MANTLE_REACH = 0.6;
/** How tall a soul is for bumping into the side of a ledge. */
export const SOUL_H = 0.9;
/** Two or more souls hanging off a standing one slide it toward the edge this fast (m/s). */
export const OVERLOAD = 1.6;
export const WIND_FROM = 98;
export const WIND_CYCLE = 9;
export const WIND_BUILD = 5.5;
export const WIND_GUST = 6.5;
export const WIND_END = 8;
export const WIND_AIR = 13;
export const WIND_GROUND = 5;
/** Time before the souls can move. */
export const COUNTDOWN = 1.2;
export const MAX_SOULS = 4;

export type Surface = 'stone' | 'ice' | 'metal' | 'none';
export type Input = { side: -1 | 0 | 1; fwd: -1 | 0 | 1; jump: boolean; hold: boolean };
export const idle = (): Input => ({ side: 0, fwd: 0, jump: false, hold: false });

export type SoulKind = 'local' | 'remote';
export type Soul = {
  idx: number;
  seat: number;
  name: string;
  color: string;
  kind: SoulKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** Platform id stood on, -1 in the air. */
  ground: number;
  coyote: number;
  buffer: number;
  cut: boolean;
  /** Facing, as a world yaw. */
  face: number;
  /** Seconds in the air, and the height the fall started from. */
  air: number;
  fallFrom: number;
  taut: boolean;
  hanging: boolean;
  /** When the chain last pulled on this soul. */
  tautAt: number;
  /** When the soul burned, or -1. */
  burned: number;
  /** Standing on the way out. */
  finished: boolean;
  /** Animation: stride phase, squash, the last spring launch, time since landing. */
  stride: number;
  squash: number;
  sprung: number;
  landed: number;
  surface: Surface;
  input: Input;
  /** Highest point reached. */
  best: number;
  /** Chain correction this substep, for the velocity update and the sounds. */
  cx: number;
  cy: number;
  cz: number;
  /** Moved by the chain this substep while standing, and when it was last yanked. */
  pulled: boolean;
  yanked: number;
  /** When the soul last pulled itself up over a rim. */
  mantled: number;
  /** Where the substep started, for keeping out of the sides of ledges. */
  px: number;
  pz: number;
  /** Remote souls: the last report and when it arrived. */
  net: { x: number; y: number; z: number; vx: number; vy: number; vz: number; at: number; flags: number } | null;
};

export type Ev =
  | { t: 'go' }
  | { t: 'jump'; i: number }
  | { t: 'land'; i: number; hard: boolean; surface: Surface }
  | { t: 'mantle'; i: number }
  | { t: 'step'; i: number; surface: Surface }
  | { t: 'taut'; i: number; j: number; speed: number }
  | { t: 'yank'; i: number; speed: number }
  | { t: 'hang'; i: number }
  | { t: 'crumble'; id: number; phase: 'warn' | 'fall' }
  | { t: 'spring'; i: number }
  | { t: 'checkpoint'; cp: number; i: number }
  | { t: 'zone'; zone: number }
  | { t: 'burn'; i: number }
  | { t: 'respawn'; cp: number }
  | { t: 'win'; time: number }
  | { t: 'lose'; height: number }
  | { t: 'gust'; dir: number; phase: 'build' | 'gust' };

export type Game = {
  mode: Mode;
  level: Level;
  souls: Soul[];
  /** Soul indexes in chain order. */
  chain: number[];
  /** Decides respawns and the result (solo, shared keyboard, or the host online). */
  authority: boolean;
  /** One player climbing both souls: the lava gives them more time. */
  solo: boolean;
  time: number;
  lava: number;
  /** The team's checkpoint and which beacons have been lit. */
  cp: number;
  lit: boolean[];
  zone: number;
  crumbles: Map<number, number>;
  respawn: { cp: number; at: number } | null;
  won: number | null;
  lost: { height: number } | null;
  gustPhase: 'calm' | 'build' | 'gust';
  events: Ev[];
  acc: number;
  started: boolean;
};

export type SoulSpec = { seat: number; name: string; color: string; kind: SoulKind };

export function createGame(opts: { mode: Mode; souls: SoulSpec[]; authority?: boolean; countdown?: number; level?: Level; solo?: boolean }): Game {
  const level = opts.level ?? buildLevel();
  const n = Math.min(MAX_SOULS, opts.souls.length);
  const souls: Soul[] = opts.souls.slice(0, n).map((spec, idx) => {
    const at = spawnAt(level, 0, idx, n);
    return {
      idx,
      seat: spec.seat,
      name: spec.name,
      color: spec.color,
      kind: spec.kind,
      x: at.x,
      y: at.y,
      z: at.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      ground: level.floor.id,
      coyote: 0,
      buffer: 0,
      cut: true,
      face: at.a + (DIR < 0 ? Math.PI / 2 : -Math.PI / 2),
      air: 0,
      fallFrom: at.y,
      taut: false,
      hanging: false,
      tautAt: -9,
      burned: -1,
      finished: false,
      stride: 0,
      squash: 0,
      sprung: -9,
      landed: -9,
      surface: 'stone',
      input: idle(),
      best: at.y,
      cx: 0,
      cy: 0,
      cz: 0,
      pulled: false,
      yanked: -9,
      mantled: -9,
      px: at.x,
      pz: at.z,
      net: null,
    };
  });
  return {
    mode: opts.mode,
    level,
    souls,
    chain: souls.map((s) => s.idx),
    authority: opts.authority ?? true,
    solo: !!opts.solo,
    time: -(opts.countdown ?? COUNTDOWN),
    lava: LAVA_Y,
    cp: 0,
    lit: level.checkpoints.map((_, i) => i === 0),
    zone: 0,
    crumbles: new Map(),
    respawn: null,
    won: null,
    lost: null,
    gustPhase: 'calm',
    events: [],
    acc: 0,
    started: false,
  };
}

export const lavaAt = (mode: Mode, t: number, solo = false) => (mode === 'lava' ? LAVA_Y + Math.max(0, t - LAVA_DELAY) * (solo ? LAVA_RISE_SOLO : LAVA_RISE) : LAVA_Y);

/** The wind above the cathedral: which way it blows and how hard, by time. */
export function windAt(t: number): { phase: 'calm' | 'build' | 'gust'; dir: number; strength: number } {
  if (t < 0) return { phase: 'calm', dir: 1, strength: 0 };
  const cycle = Math.floor(t / WIND_CYCLE);
  const u = t - cycle * WIND_CYCLE;
  const dir = cycle % 2 === 0 ? 1 : -1;
  if (u < WIND_BUILD) return { phase: 'calm', dir, strength: 0 };
  if (u < WIND_GUST) return { phase: 'build', dir, strength: (u - WIND_BUILD) / (WIND_GUST - WIND_BUILD) };
  if (u < WIND_END) return { phase: 'gust', dir, strength: 1 };
  return { phase: 'calm', dir, strength: 0 };
}

export const radiusOf = (s: { x: number; z: number }) => Math.hypot(s.x, s.z);
export const angleOf = (s: { x: number; z: number }) => Math.atan2(s.z, s.x);
export const heightOf = (g: Game) => Math.max(...g.souls.map((s) => s.y));
export const teamBest = (g: Game) => Math.max(...g.souls.map((s) => s.best));

export function fmtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const surfaceOf = (p: Platform | undefined): Surface => (!p ? 'none' : p.kind === 'ice' ? 'ice' : p.kind === 'lift' || p.kind === 'spring' ? 'metal' : 'stone');

export type CrumbleState = { phase: 'none' | 'warn' | 'fall' | 'gone'; t: number; drop: number };
/** What a crumbling ledge is doing right now. */
export function crumbleState(g: Game, id: number, out: CrumbleState = { phase: 'none', t: 0, drop: 0 }): CrumbleState {
  const at = g.crumbles.get(id);
  out.phase = 'none';
  out.t = 0;
  out.drop = 0;
  if (at === undefined) return out;
  const t = g.time - at;
  out.t = t;
  if (t < CRUMBLE_WARN) out.phase = 'warn';
  else if (t < CRUMBLE_WARN + CRUMBLE_FALL) {
    out.phase = 'fall';
    out.drop = 0.5 * CRUMBLE_G * (t - CRUMBLE_WARN) ** 2;
  } else out.phase = 'gone';
  return out;
}

const landable = (g: Game, p: Platform) => {
  const at = g.crumbles.get(p.id);
  return at === undefined || g.time - at < CRUMBLE_WARN;
};

/** True when a point is over a ledge (with the feet allowed to hang EDGE_TOL over an edge). */
export function over(p: Platform, a: number, x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r < p.r0 - EDGE_TOL || r > p.r1 + EDGE_TOL) return false;
  if (p.kind === 'floor') return true;
  return Math.abs(angDiff(Math.atan2(z, x), a)) <= p.span + EDGE_TOL / Math.max(1, r);
}

const scratch: Pose = { a: 0, y: 0, va: 0, vy: 0 };
const scratch0: Pose = { a: 0, y: 0, va: 0, vy: 0 };

/** The ledge a falling soul lands on this substep: the highest top it crossed from above. */
function landing(g: Game, s: Soul, yPrev: number, t0: number, t1: number): Platform | null {
  let best: Platform | null = null;
  let bestTop = -Infinity;
  for (const p of g.level.platforms) {
    if (p.y + p.amp + 0.5 < s.y || p.y - p.amp - 2 > yPrev) continue;
    if (!landable(g, p)) continue;
    const q1 = pose(p, t1, scratch);
    if (s.y > q1.y + 1e-6) continue;
    const q0 = pose(p, t0, scratch0);
    if (yPrev < q0.y - 0.03) continue;
    if (s.vy - q1.vy > 0.01) continue;
    if (!over(p, q1.a, s.x, s.z)) continue;
    if (q1.y > bestTop) {
      bestTop = q1.y;
      best = p;
    }
  }
  return best;
}

export function scheduleRespawn(g: Game, cp: number, at = g.time + RESPAWN_T) {
  if (g.respawn && g.respawn.at <= at) return;
  g.respawn = { cp, at };
}

/** Puts the team on a beacon, standing still. */
export function doRespawn(g: Game, cp: number) {
  g.respawn = null;
  g.cp = Math.max(g.cp, cp);
  g.crumbles.clear();
  const live = g.chain;
  live.forEach((idx, slot) => {
    const s = g.souls[idx];
    const at = spawnAt(g.level, cp, slot, live.length);
    s.x = at.x;
    s.y = at.y;
    s.z = at.z;
    s.vx = s.vy = s.vz = 0;
    s.grounded = true;
    s.ground = g.level.checkpoints[Math.min(cp, g.level.checkpoints.length - 1)].id;
    s.burned = -1;
    s.air = 0;
    s.fallFrom = s.y;
    s.coyote = 0;
    s.buffer = 0;
    s.taut = s.hanging = false;
    s.finished = false;
    s.face = at.a + (DIR < 0 ? Math.PI / 2 : -Math.PI / 2);
  });
  g.events.push({ t: 'respawn', cp });
}

/** Marks a soul burned: it stops where it is until the team respawns (or the climb is lost). */
export function burn(g: Game, s: Soul) {
  if (s.burned >= 0) return;
  s.burned = g.time;
  s.vx = s.vy = s.vz = 0;
  s.grounded = false;
  s.ground = -1;
  g.events.push({ t: 'burn', i: s.idx });
  if (g.mode === 'lava') lose(g);
  else if (g.authority) scheduleRespawn(g, g.mode === 'beginner' ? g.cp : 0);
}

export function lose(g: Game) {
  if (g.lost || g.won !== null) return;
  g.lost = { height: teamBest(g) };
  g.events.push({ t: 'lose', height: g.lost.height });
}

export function win(g: Game, time = g.time) {
  if (g.won !== null || g.lost) return;
  g.won = time;
  g.events.push({ t: 'win', time });
}

/** A remote soul's report. flags: 1 grounded, 2 finished, 4 burned, 8 hanging. */
export function applyRemote(g: Game, s: Soul, r: { x: number; y: number; z: number; vx: number; vy: number; vz: number; flags: number }) {
  s.net = { ...r, at: g.time };
  if (s.net.flags & 4 && s.burned < 0) {
    s.burned = g.time;
    g.events.push({ t: 'burn', i: s.idx });
    if (g.mode === 'lava') lose(g);
  }
  if (!(s.net.flags & 4)) s.burned = -1;
}

export const flagsOf = (s: Soul) => (s.grounded ? 1 : 0) | (s.finished ? 2 : 0) | (s.burned >= 0 ? 4 : 0) | (s.hanging ? 8 : 0);

function moveSoul(g: Game, s: Soul, dt: number, t0: number, t1: number) {
  const ev = g.events;
  const { level } = g;
  const yPrev = s.y;
  s.px = s.x;
  s.pz = s.z;
  const wasGrounded = s.grounded;
  const standing = s.grounded ? level.platforms[s.ground] : undefined;
  s.surface = surfaceOf(standing);

  // ride a lift or a swing
  if (standing && (standing.kind === 'lift' || standing.kind === 'swing')) {
    const q0 = pose(standing, t0, scratch0);
    const q1 = pose(standing, t1, scratch);
    s.y += q1.y - q0.y;
    const da = q1.a - q0.a;
    if (da !== 0) {
      const c = Math.cos(da);
      const sn = Math.sin(da);
      const x = s.x * c - s.z * sn;
      const z = s.x * sn + s.z * c;
      s.x = x;
      s.z = z;
    }
  }

  const moving = g.time >= 0 && g.won === null && s.burned < 0;
  const inp = moving ? s.input : idle();
  const r = Math.max(0.001, Math.hypot(s.x, s.z));
  const ca = s.x / r;
  const sa = s.z / r;
  // screen right is -u_theta, into the screen is -u_r (the camera stands outside looking at the core)
  let dx = inp.side * sa * DIR * -1 - inp.fwd * ca;
  let dz = inp.side * -ca * DIR * -1 - inp.fwd * sa;
  const dl = Math.hypot(dx, dz);
  if (dl > 1) {
    dx /= dl;
    dz /= dl;
  }
  const ice = s.surface === 'ice';
  const accel = !s.grounded ? AIR_ACCEL : ice ? ICE_ACCEL : ACCEL;
  const friction = !s.grounded ? AIR_FRICTION : ice ? ICE_FRICTION : FRICTION;
  if (dl > 0.01) {
    const tx = dx * RUN;
    const tz = dz * RUN;
    const ex = tx - s.vx;
    const ez = tz - s.vz;
    const el = Math.hypot(ex, ez);
    const k = Math.min(1, (accel * dt) / Math.max(1e-6, el));
    s.vx += ex * k;
    s.vz += ez * k;
  } else {
    const vl = Math.hypot(s.vx, s.vz);
    if (vl > 0) {
      const k = Math.max(0, 1 - (friction * dt) / vl);
      s.vx *= k;
      s.vz *= k;
    }
  }

  // the wind above the cathedral
  if (s.y > WIND_FROM) {
    const w = windAt(g.time);
    if (w.phase === 'gust') {
      const push = (s.grounded ? (ice ? WIND_AIR : WIND_GROUND) : WIND_AIR) * w.dir * DIR;
      s.vx += -sa * push * dt;
      s.vz += ca * push * dt;
    }
  }

  // jumping
  if (inp.jump) s.buffer = JUMP_BUFFER;
  else s.buffer = Math.max(0, s.buffer - dt);
  if (moving && s.buffer > 0 && (s.grounded || s.coyote > 0)) {
    s.vy = JUMP_V;
    if (standing && standing.kind === 'lift') s.vy += Math.max(0, pose(standing, t1, scratch).vy);
    if (standing && standing.kind === 'swing') {
      const va = pose(standing, t1, scratch).va * r;
      s.vx += -sa * va;
      s.vz += ca * va;
    }
    s.grounded = false;
    s.ground = -1;
    s.coyote = 0;
    s.buffer = 0;
    s.cut = false;
    s.air = 0;
    s.fallFrom = s.y;
    ev.push({ t: 'jump', i: s.idx });
  }
  if (!s.grounded && !inp.hold && !s.cut && s.vy > JUMP_CUT) {
    s.vy = JUMP_CUT;
    s.cut = true;
  }

  // gravity and motion
  if (!s.grounded) {
    s.coyote = Math.max(0, s.coyote - dt);
    s.air += dt;
    s.vy = Math.max(-MAX_FALL, s.vy - GRAVITY * dt);
    if (s.vy < 0 && s.y > s.fallFrom) s.fallFrom = s.y;
  } else if (standing && standing.kind === 'lift') s.vy = pose(standing, t1, scratch).vy;
  const hl = Math.hypot(s.vx, s.vz);
  if (hl > MAX_H) {
    s.vx *= MAX_H / hl;
    s.vz *= MAX_H / hl;
  }
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.y += s.vy * dt;

  // the core, the far wall and the sides of ledges
  clampRadius(s);
  slabSides(g, s);

  // standing: stay on the ledge or step off it
  if (s.grounded && standing) {
    const q1 = pose(standing, t1, scratch);
    if (!landable(g, standing) || !over(standing, q1.a, s.x, s.z)) {
      s.grounded = false;
      s.ground = -1;
      s.coyote = COYOTE;
      s.air = 0;
      s.fallFrom = s.y;
      s.vy = standing.kind === 'lift' ? q1.vy : 0;
    } else {
      s.y = q1.y;
      s.vy = standing.kind === 'lift' ? q1.vy : 0;
    }
  }

  // landing, or pulling up over a rim just above
  if (!s.grounded) {
    const p = landing(g, s, yPrev, t0, t1);
    if (p) landOn(g, s, p, t1, moving, wasGrounded);
    else if (moving) mantle(g, s, dx, dz);
  }
  // the pad in the middle of a spring ledge
  if (s.grounded && moving && level.platforms[s.ground].kind === 'spring') {
    const p = level.platforms[s.ground];
    const mid = (p.r0 + p.r1) / 2;
    if (Math.hypot(Math.cos(p.a) * mid - s.x, Math.sin(p.a) * mid - s.z) <= PAD_R) {
      s.vy = SPRING_V;
      s.grounded = false;
      s.ground = -1;
      s.cut = true;
      s.sprung = g.time;
      s.fallFrom = s.y;
      s.air = 0;
      ev.push({ t: 'spring', i: s.idx });
    }
  }
  s.finished = s.grounded && s.ground === level.goal.id;

  // facing and footsteps
  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0.6) {
    const want = Math.atan2(s.vz, s.vx);
    s.face += angDiff(want, s.face) * Math.min(1, 14 * dt);
  }
  if (s.grounded && speed > 1) {
    const before = Math.floor(s.stride);
    s.stride += (speed * dt) / 1.7;
    if (Math.floor(s.stride) !== before) ev.push({ t: 'step', i: s.idx, surface: s.surface });
  }
  s.squash = Math.max(0, s.squash - dt * 4);
  s.best = Math.max(s.best, s.y);

  // the zone the team has reached
  const zone = zoneIndex(s.y);
  if (s.grounded && zone > g.zone) {
    g.zone = zone;
    ev.push({ t: 'zone', zone });
  }

  // lava
  if (s.y < g.lava + 0.08 && moving) burn(g, s);
  else if (g.authority && g.mode === 'beginner' && moving && s.y < g.level.checkpoints[g.cp].y - FALL_TOO_FAR) scheduleRespawn(g, g.cp, g.time + 0.5);
}

/** Puts a soul down on a ledge and does what the ledge does: springs launch, crumbles start, beacons light. */
function landOn(g: Game, s: Soul, p: Platform, t1: number, _moving: boolean, wasGrounded: boolean) {
  const ev = g.events;
  const q1 = pose(p, t1, scratch);
  s.y = q1.y;
  s.grounded = true;
  s.ground = p.id;
  s.coyote = 0;
  s.cut = true;
  s.landed = g.time;
  const fell = s.fallFrom - s.y;
  s.squash = Math.min(1, 0.35 + fell / 8);
  s.surface = surfaceOf(p);
  if (!wasGrounded) ev.push({ t: 'land', i: s.idx, hard: fell > HARD_FALL, surface: s.surface });
  s.air = 0;
  s.fallFrom = s.y;
  s.vy = p.kind === 'lift' ? q1.vy : 0;
  if (p.kind === 'crumble' && !g.crumbles.has(p.id)) {
    g.crumbles.set(p.id, g.time);
    ev.push({ t: 'crumble', id: p.id, phase: 'warn' });
  }
  if (p.cp > g.cp && g.time >= 0) {
    g.cp = p.cp;
    ev.push({ t: 'checkpoint', cp: p.cp, i: s.idx });
  }
  if (p.cp >= 0) g.lit[p.cp] = true;
}

/**
 * A soul in the air just below a rim pulls itself up onto the ledge when the chain is carrying it there or it is
 * pushing toward the rim (dx, dz is its input direction). Falling fast, it just falls.
 */
function mantle(g: Game, s: Soul, dx: number, dz: number): boolean {
  if (s.vy > 1.5 || s.vy < -9) return false;
  const pushing = Math.hypot(dx, dz) > 0.3;
  if (!s.hanging && !s.taut && !pushing) return false;
  const r = Math.hypot(s.x, s.z);
  const ang = Math.atan2(s.z, s.x);
  for (const p of g.level.platforms) {
    if (p.kind === 'floor' || !landable(g, p)) continue;
    if (p.y + p.amp < s.y || p.y - p.amp - MANTLE_H - 0.5 > s.y) continue;
    const q = pose(p, g.time, scratch);
    if (s.y > q.y - 0.05 || s.y < q.y - MANTLE_H) continue;
    const rr = Math.min(p.r1, Math.max(p.r0, r));
    const da = Math.min(p.span, Math.max(-p.span, angDiff(ang, q.a)));
    const ex = Math.cos(q.a + da) * rr;
    const ez = Math.sin(q.a + da) * rr;
    const dist = Math.hypot(ex - s.x, ez - s.z);
    if (dist > MANTLE_REACH || dist < 0.02) continue;
    if (!s.hanging && !s.taut && (dx * (ex - s.x) + dz * (ez - s.z)) / dist < 0.4) continue;
    // up and a step in from the rim
    const mid = (p.r0 + p.r1) / 2;
    const ix = Math.cos(q.a) * mid - ex;
    const iz = Math.sin(q.a) * mid - ez;
    const il = Math.hypot(ix, iz) || 1;
    s.x = ex + (ix / il) * 0.45;
    s.z = ez + (iz / il) * 0.45;
    s.y = q.y + 0.01;
    s.vx = s.vz = 0;
    s.vy = 0;
    s.mantled = g.time;
    s.fallFrom = s.y;
    landOn(g, s, p, g.time, true, true);
    g.events.push({ t: 'mantle', i: s.idx });
    return true;
  }
  return false;
}

/**
 * Keeps a soul out of the sides of ledges: it can jump up through a slab, but it cannot walk or swing into one from
 * the side. Pushed back to the nearest side, a soul's width clear, with its speed into the slab removed.
 */
function slabSides(g: Game, s: Soul) {
  // jumping up through a slab is allowed, and a taut chain drags a soul through anything
  if (s.vy > 0.5 || s.taut) return;
  const r = Math.hypot(s.x, s.z);
  const ang = Math.atan2(s.z, s.x);
  const rp = Math.hypot(s.px, s.pz);
  const ap = Math.atan2(s.pz, s.px);
  for (const p of g.level.platforms) {
    if (p.kind === 'floor' || (s.grounded && s.ground === p.id) || !landable(g, p)) continue;
    if (p.y + p.amp < s.y - 0.05 || p.y - p.amp - p.h > s.y + SOUL_H) continue;
    const q = pose(p, g.time, scratch);
    if (s.y >= q.y - 0.02 || s.y + SOUL_H <= q.y - p.h) continue;
    const da = angDiff(ang, q.a);
    if (r < p.r0 - 0.02 || r > p.r1 + 0.02 || Math.abs(da) > p.span + 0.02 / r) continue;
    const dap = angDiff(ap, q.a);
    if (rp >= p.r0 && rp <= p.r1 && Math.abs(dap) <= p.span) continue;
    // the nearest way out: inward, outward, or round either side
    const clear = SOUL_R * 0.7;
    const dOut = p.r1 - r;
    const dIn = p.r0 > R_CORE + 0.5 ? r - p.r0 : Infinity;
    const dSide = (p.span - Math.abs(da)) * r;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    if (dOut <= dIn && dOut <= dSide) {
      const k = (p.r1 + clear) / r;
      s.x *= k;
      s.z *= k;
      const vr = s.vx * ca + s.vz * sa;
      if (vr < 0) {
        s.vx -= vr * ca;
        s.vz -= vr * sa;
      }
    } else if (dIn <= dSide) {
      const k = (p.r0 - clear) / r;
      s.x *= k;
      s.z *= k;
      const vr = s.vx * ca + s.vz * sa;
      if (vr > 0) {
        s.vx -= vr * ca;
        s.vz -= vr * sa;
      }
    } else {
      const side = da >= 0 ? 1 : -1;
      const na = q.a + side * (p.span + clear / r);
      s.x = Math.cos(na) * r;
      s.z = Math.sin(na) * r;
      // tangential speed toward the slab goes
      const tx = -Math.sin(na);
      const tz = Math.cos(na);
      const vt = s.vx * tx + s.vz * tz;
      if (vt * side < 0) {
        s.vx -= vt * tx;
        s.vz -= vt * tz;
      }
    }
  }
}

function clampRadius(s: Soul) {
  const r = Math.hypot(s.x, s.z);
  if (r < R_CORE + SOUL_R) {
    const k = (R_CORE + SOUL_R) / Math.max(1e-6, r);
    s.x *= k;
    s.z *= k;
    const ca = s.x / (R_CORE + SOUL_R);
    const sa = s.z / (R_CORE + SOUL_R);
    const vr = s.vx * ca + s.vz * sa;
    if (vr < 0) {
      s.vx -= vr * ca;
      s.vz -= vr * sa;
    }
  } else if (r > R_MAX) {
    const k = R_MAX / r;
    s.x *= k;
    s.z *= k;
    const ca = s.x / R_MAX;
    const sa = s.z / R_MAX;
    const vr = s.vx * ca + s.vz * sa;
    if (vr > 0) {
      s.vx -= vr * ca;
      s.vz -= vr * sa;
    }
  }
}

function moveRemote(g: Game, s: Soul, dt: number) {
  const n = s.net;
  if (!n) return;
  const age = Math.min(0.3, Math.max(0, g.time - n.at));
  const tx = n.x + n.vx * age;
  const ty = n.y + n.vy * age;
  const tz = n.z + n.vz * age;
  const k = 1 - Math.exp(-14 * dt);
  s.x += (tx - s.x) * k;
  s.y += (ty - s.y) * k;
  s.z += (tz - s.z) * k;
  s.vx = n.vx;
  s.vy = n.vy;
  s.vz = n.vz;
  s.grounded = !!(n.flags & 1);
  s.finished = !!(n.flags & 2);
  s.hanging = !!(n.flags & 8);
  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0.6) s.face += angDiff(Math.atan2(s.vz, s.vx), s.face) * Math.min(1, 14 * dt);
  s.best = Math.max(s.best, s.y);
  if (s.grounded && speed > 1) {
    const before = Math.floor(s.stride);
    s.stride += (speed * dt) / 1.7;
    if (Math.floor(s.stride) !== before) g.events.push({ t: 'step', i: s.idx, surface: 'stone' });
  }
  s.squash = Math.max(0, s.squash - dt * 4);
}

/** Souls in the chain, in order, skipping anyone who burned. */
const links = (g: Game) => g.chain.filter((i) => g.souls[i].burned < 0);

function solveChain(g: Game, dt: number) {
  const live = links(g);
  for (const i of live) {
    const s = g.souls[i];
    s.cx = s.cy = s.cz = 0;
    s.pulled = false;
  }
  const tautNow = new Set<string>();
  for (let iter = 0; iter < 2; iter++) {
    for (let k = 0; k + 1 < live.length; k++) {
      const a = g.souls[live[k]];
      const b = g.souls[live[k + 1]];
      // the chain runs straight between two souls, or bends over the rim of the ledge one of them stands on while
      // the other hangs below it (so hauling lifts, the way a rope over an edge does)
      let d: number;
      let ax: number;
      let ay: number;
      let az: number;
      let bx: number;
      let by: number;
      let bz: number;
      const viaA = a.grounded && !b.grounded && a.ground >= 0 && rimPoint(g, g.level.platforms[a.ground], b, rim) && Math.hypot(rim.x - a.x, rim.z - a.z) > 0.35;
      const viaB = !viaA && b.grounded && !a.grounded && b.ground >= 0 && rimPoint(g, g.level.platforms[b.ground], a, rim) && Math.hypot(rim.x - b.x, rim.z - b.z) > 0.35;
      if (viaA || viaB) {
        const dA = Math.max(1e-4, Math.hypot(rim.x - a.x, rim.y - a.y, rim.z - a.z));
        const dB = Math.max(1e-4, Math.hypot(rim.x - b.x, rim.y - b.y, rim.z - b.z));
        d = dA + dB;
        ax = (rim.x - a.x) / dA;
        ay = (rim.y - a.y) / dA;
        az = (rim.z - a.z) / dA;
        bx = (rim.x - b.x) / dB;
        by = (rim.y - b.y) / dB;
        bz = (rim.z - b.z) / dB;
      } else {
        const nx = b.x - a.x;
        const ny = b.y - a.y;
        const nz = b.z - a.z;
        d = Math.max(1e-4, Math.hypot(nx, ny, nz));
        ax = nx / d;
        ay = ny / d;
        az = nz / d;
        bx = -ax;
        by = -ay;
        bz = -az;
        // a standing soul right at the rim with the other hanging below it is pulled sideways over the edge
        if (a.grounded && !b.grounded && b.y < a.y - 0.5) {
          const hl = Math.hypot(nx, nz);
          if (hl > 1e-3) {
            ax = nx / hl;
            ay = 0;
            az = nz / hl;
          }
        } else if (b.grounded && !a.grounded && a.y < b.y - 0.5) {
          const hl = Math.hypot(nx, nz);
          if (hl > 1e-3) {
            bx = -nx / hl;
            by = 0;
            bz = -nz / hl;
          }
        }
      }
      if (d <= CHAIN_L) continue;
      const stretch = d - CHAIN_L;
      if (iter === 0) tautNow.add(`${a.idx}:${b.idx}`);
      // a standing soul holds against a slow pull and takes a share of a sharp one (a yank carries momentum);
      // with two or more souls hanging off it, it gives way to any pull. Sharp means the two ends are moving
      // apart along the rope faster than GRIP_V, not that the rope happens to be long right now.
      const parting = -(a.vx * ax + a.vy * ay + a.vz * az) - (b.vx * bx + b.vy * by + b.vz * bz);
      const yank = parting >= GRIP_V;
      const overA = a.grounded && hangingBeyond(g, live, k + 1, 1) >= 2;
      const overB = b.grounded && hangingBeyond(g, live, k, -1) >= 2;
      const fullA = !a.grounded || overA ? 1 : yank ? YANK_W : 0;
      const fullB = !b.grounded || overB ? 1 : yank ? YANK_W : 0;
      const wa = a.kind === 'remote' ? 0 : fullA;
      const wb = b.kind === 'remote' ? 0 : fullB;
      if (wa + wb === 0) continue;
      // online, each side moves only its own share and trusts the other to move theirs
      const total = Math.max(1e-6, fullA + fullB);
      const sa = Math.min(CHAIN_STEP, (stretch * wa) / total);
      const sb = Math.min(CHAIN_STEP, (stretch * wb) / total);
      // the ledge takes the vertical part of a pull on a standing soul
      if (sa > 0) {
        const ky = a.grounded ? 0 : 1;
        a.x += ax * sa;
        a.y += ay * sa * ky;
        a.z += az * sa;
        a.cx += ax * sa;
        a.cy += ay * sa * ky;
        a.cz += az * sa;
        if (a.grounded) a.pulled = true;
      }
      if (sb > 0) {
        const ky = b.grounded ? 0 : 1;
        b.x += bx * sb;
        b.y += by * sb * ky;
        b.z += bz * sb;
        b.cx += bx * sb;
        b.cy += by * sb * ky;
        b.cz += bz * sb;
        if (b.grounded) b.pulled = true;
      }
    }
  }

  // the chain snapping taut
  for (let k = 0; k + 1 < live.length; k++) {
    const a = g.souls[live[k]];
    const b = g.souls[live[k + 1]];
    if (!tautNow.has(`${a.idx}:${b.idx}`) || (a.taut && b.taut)) continue;
    const nx = b.x - a.x;
    const ny = b.y - a.y;
    const nz = b.z - a.z;
    const d = Math.max(1e-6, Math.hypot(nx, ny, nz));
    const closing = Math.abs(((b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz) / d);
    g.events.push({ t: 'taut', i: a.idx, j: b.idx, speed: closing });
  }
  for (const i of live) g.souls[i].taut = false;
  for (let k = 0; k + 1 < live.length; k++) {
    const a = g.souls[live[k]];
    const b = g.souls[live[k + 1]];
    if (tautNow.has(`${a.idx}:${b.idx}`)) {
      a.taut = b.taut = true;
      a.tautAt = b.tautAt = g.time;
    }
  }

  // velocities follow the corrections (a standing soul only sideways: the ledge takes the rest)
  for (const i of live) {
    const s = g.souls[i];
    if (s.kind !== 'local') continue;
    const c = Math.hypot(s.cx, s.cy, s.cz);
    if (c === 0) continue;
    const k = Math.min(s.grounded ? YANK_K : 1, (CHAIN_KICK * dt) / c);
    s.vx += (s.cx / dt) * k;
    s.vz += (s.cz / dt) * k;
    if (!s.grounded) s.vy += (s.cy / dt) * k;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (sp > MAX_FALL) {
      s.vx *= MAX_FALL / sp;
      s.vy *= MAX_FALL / sp;
      s.vz *= MAX_FALL / sp;
    }
    if (s.grounded && s.pulled && g.time - s.yanked > 0.6) {
      s.yanked = g.time;
      g.events.push({ t: 'yank', i: s.idx, speed: c / dt });
    }
    if (!s.grounded) {
      s.vx *= 0.995;
      s.vz *= 0.995;
    }
    clampRadius(s);
    slabSides(g, s);
  }

  // hanging: in the air on a taut chain with a neighbour well above
  for (let k = 0; k < live.length; k++) {
    const s = g.souls[live[k]];
    if (s.kind !== 'local') continue;
    const up = (live[k - 1] !== undefined && g.souls[live[k - 1]].y - s.y > 1) || (live[k + 1] !== undefined && g.souls[live[k + 1]].y - s.y > 1);
    // a swing on the chain goes slack for a moment at the top: still hanging
    const hanging = !s.grounded && up && g.time - s.tautAt < 0.5 && s.vy < 6;
    if (hanging && !s.hanging) g.events.push({ t: 'hang', i: s.idx });
    s.hanging = hanging;
  }

  // overloaded: two or more souls hanging off a standing one drag it toward where the chain leaves the ledge,
  // unless it walks away
  for (let k = 0; k < live.length; k++) {
    const s = g.souls[live[k]];
    if (s.kind !== 'local' || !s.grounded || s.ground < 0) continue;
    const ahead = hangingBeyond(g, live, k + 1, 1);
    const behind = hangingBeyond(g, live, k - 1, -1);
    if (Math.max(ahead, behind) < 2) continue;
    const n = g.souls[live[k + (ahead >= behind ? 1 : -1)]];
    const p = g.level.platforms[s.ground];
    let tx = n.x;
    let tz = n.z;
    if (rimPoint(g, p, n, rim)) {
      tx = rim.x;
      tz = rim.z;
    }
    const dx = tx - s.x;
    const dz = tz - s.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-3) continue;
    const slide = Math.min(dl + 0.3, OVERLOAD * dt);
    s.x += (dx / dl) * slide;
    s.z += (dz / dl) * slide;
    s.pulled = true;
  }

  // a standing soul moved by the chain stays on its ledge or is pulled off it
  for (const i of live) {
    const s = g.souls[i];
    if (s.kind !== 'local' || !s.grounded) continue;
    const p = g.level.platforms[s.ground];
    const q = pose(p, g.time, scratch);
    if (over(p, q.a, s.x, s.z)) {
      s.y = q.y;
      if (p.kind !== 'lift') s.vy = 0;
    } else {
      s.grounded = false;
      s.ground = -1;
      s.coyote = 0;
      s.air = 0;
      s.fallFrom = s.y;
    }
  }
}

const rim = { x: 0, y: 0, z: 0 };
/**
 * Where the chain bends when `s` stands on ledge p and `h` hangs below it: the nearest point of the ledge's rim.
 * False when h is not below the top (the chain runs straight).
 */
function rimPoint(g: Game, p: Platform, h: Soul, out: { x: number; y: number; z: number }) {
  if (p.kind === 'floor') return false;
  const q = pose(p, g.time, scratch);
  if (h.y > q.y - 0.2) return false;
  const hr = Math.hypot(h.x, h.z);
  const da = angDiff(Math.atan2(h.z, h.x), q.a);
  let r = Math.min(p.r1, Math.max(p.r0, hr));
  let a = q.a + Math.min(p.span, Math.max(-p.span, da));
  if (hr >= p.r0 && hr <= p.r1 && Math.abs(da) <= p.span) {
    // under the ledge: the rope still bends at the nearest point of the rim, never straight up through the slab
    const dOut = p.r1 - hr;
    const dIn = p.r0 > R_CORE + 0.5 ? hr - p.r0 : Infinity;
    const dSide = (p.span - Math.abs(da)) * hr;
    if (dOut <= dIn && dOut <= dSide) r = p.r1;
    else if (dIn <= dSide) r = p.r0;
    else a = q.a + (da >= 0 ? p.span : -p.span);
  }
  out.x = Math.cos(a) * r;
  out.y = q.y;
  out.z = Math.sin(a) * r;
  return true;
}

/** How many souls in a row are hanging, walking the chain from `from` in direction `dir`. */
function hangingBeyond(g: Game, live: number[], from: number, dir: 1 | -1) {
  let n = 0;
  for (let k = from; k >= 0 && k < live.length; k += dir) {
    const s = g.souls[live[k]];
    if (!s.grounded && s.taut) n++;
    else break;
  }
  return n;
}

function substep(g: Game, dt: number) {
  const t0 = g.time;
  g.time += dt;
  const t1 = g.time;
  if (!g.started && g.time >= 0) {
    g.started = true;
    g.events.push({ t: 'go' });
  }
  g.lava = lavaAt(g.mode, g.time, g.solo);
  if (g.lost) return;

  if (g.respawn && g.time >= g.respawn.at) doRespawn(g, g.respawn.cp);

  for (const [id, at] of g.crumbles) {
    const t = g.time - at;
    if (t >= CRUMBLE_WARN && t - dt < CRUMBLE_WARN) g.events.push({ t: 'crumble', id, phase: 'fall' });
    if (t > CRUMBLE_BACK) g.crumbles.delete(id);
  }

  for (const s of g.souls) {
    if (s.burned >= 0) continue;
    if (s.kind === 'local') moveSoul(g, s, dt, t0, t1);
    else moveRemote(g, s, dt);
  }
  solveChain(g, dt);

  // the wind, for the sound and the particles
  const w = windAt(g.time);
  if (w.phase !== g.gustPhase) {
    g.gustPhase = w.phase;
    if (w.phase !== 'calm' && heightOf(g) > WIND_FROM - 6) g.events.push({ t: 'gust', dir: w.dir, phase: w.phase });
  }

  // the way out: everyone standing on the top ledge
  if (g.authority && g.won === null && g.time > 0) {
    const live = links(g);
    if (live.length === g.chain.length && live.every((i) => g.souls[i].finished)) win(g);
  }
}

/** Advances the game by dt seconds in fixed substeps. Events pile up in g.events for the caller to drain. */
export function step(g: Game, dt: number) {
  g.acc += Math.min(dt, 0.25);
  let n = 0;
  while (g.acc >= SUB && n++ < 40) {
    g.acc -= SUB;
    substep(g, SUB);
  }
}

/** Standing room: the ledge a soul is on, or null. */
export const standingOn = (g: Game, s: Soul) => (s.grounded && s.ground >= 0 ? g.level.platforms[s.ground] : null);

/** A soul's angle and radius, for the camera and the HUD. */
export const cylOf = (s: { x: number; z: number }) => ({ a: Math.atan2(s.z, s.x), r: Math.hypot(s.x, s.z) });

/** Souls this one is chained to. */
export function neighbours(g: Game, idx: number): Soul[] {
  const k = g.chain.indexOf(idx);
  const out: Soul[] = [];
  if (k > 0) out.push(g.souls[g.chain[k - 1]]);
  if (k >= 0 && k + 1 < g.chain.length) out.push(g.souls[g.chain[k + 1]]);
  return out;
}

export { FLOOR_Y, TOP, LAVA_Y };
