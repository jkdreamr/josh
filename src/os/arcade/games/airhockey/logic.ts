// Pure air hockey rules: puck and mallet physics, goals, serving, a beatable computer opponent. No DOM, no three.js.
export type V2 = { x: number; z: number };
export type Body = V2 & { vx: number; vz: number };
export type Mallet = Body & { r: number };
export type Mode = 'cpu' | '2p';
export type Difficulty = 'easy' | 'normal' | 'hard';

export const W = 2; // table width (x)
export const L = 3.4; // table length (z); player 0 defends +z, player 1 defends -z
export const GOAL_W = 0.72;
export const PUCK_R = 0.065;
export const MALLET_R = 0.12;
export const TO_WIN = 7;
export const MAX_SPEED = 7.5;
export const FRICTION = 0.35; // per second velocity loss fraction
export const WALL_E = 0.9;
export const SERVE_FREEZE = 0.9;
export const MALLET_SPEED = 3.8; // keyboard mallet speed

/** How a computer player plays. */
export type Skill = {
  /** top mallet speed, and how much faster it swings through a shot */
  speed: number;
  strike: number;
  /** seconds between decisions */
  react: number;
  /** shot and block accuracy, 0..1 */
  aim: number;
  /** how well it reads where an incoming puck will cross its line, bounces included, 0..1 */
  read: number;
  /** how often it banks a shot off a side wall */
  bank: number;
  /** how far forward it steps to meet an incoming puck, 0..1 */
  guard: number;
};

export const DIFF: Record<Difficulty, Skill> = {
  easy: { speed: 1.7, strike: 1.5, react: 0.4, aim: 0.4, read: 0.2, bank: 0, guard: 0 },
  normal: { speed: 2.6, strike: 1.8, react: 0.22, aim: 0.7, read: 0.6, bank: 0.2, guard: 0.5 },
  hard: { speed: 3.6, strike: 2, react: 0.1, aim: 0.92, read: 1, bank: 0.4, guard: 1 },
};

/** `power` is the puck's speed change on a mallet hit; `wallPower` its speed into a wall. */
export type Event = { wall?: boolean; hit?: 0 | 1; goal?: 0 | 1; win?: 0 | 1; power?: number; wallPower?: number; at?: V2 };

/** What one computer player remembers between frames. */
export type AiMem = { aiTimer: number; aiTarget: V2; aiShot: number | null; aiAttack: number; aiStrike: boolean };

export type State = {
  puck: Body & { r: number };
  mallets: [Mallet, Mallet];
  score: [number, number];
  mode: Mode;
  difficulty: Difficulty;
  freeze: number;
  t: number;
  winner: 0 | 1 | null;
  /** Side that was last scored on, who gets the puck. */
  serve: 0 | 1;
  aiTimer: number;
  aiTarget: V2;
  /** Where on the far goal line the current attack is aimed (outside the table for a bank shot). */
  aiShot: number | null;
  /** Seconds the current attack has run without a hit. */
  aiAttack: number;
  /** Swinging through the puck right now. */
  aiStrike: boolean;
};

export const half = (side: 0 | 1) => (side === 0 ? 1 : -1);

export function create(mode: Mode = 'cpu', difficulty: Difficulty = 'normal'): State {
  const s: State = {
    puck: { x: 0, z: 0, vx: 0, vz: 0, r: PUCK_R },
    mallets: [
      { x: 0, z: L / 2 - 0.35, vx: 0, vz: 0, r: MALLET_R },
      { x: 0, z: -(L / 2 - 0.35), vx: 0, vz: 0, r: MALLET_R },
    ],
    score: [0, 0],
    mode,
    difficulty,
    freeze: SERVE_FREEZE,
    t: 0,
    winner: null,
    serve: 0,
    aiTimer: 0,
    aiTarget: { x: 0, z: -(L / 2 - 0.35) },
    aiShot: null,
    aiAttack: 0,
    aiStrike: false,
  };
  placePuck(s, 0);
  return s;
}

export function placePuck(s: State, side: 0 | 1) {
  s.puck.x = 0;
  s.puck.z = half(side) * 0.55;
  s.puck.vx = 0;
  s.puck.vz = 0;
  s.serve = side;
  s.freeze = SERVE_FREEZE;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Clamps a mallet to its own half of the table. */
export function clampMallet(m: Mallet, side: 0 | 1) {
  m.x = clamp(m.x, -W / 2 + m.r, W / 2 - m.r);
  if (side === 0) m.z = clamp(m.z, m.r, L / 2 - m.r);
  else m.z = clamp(m.z, -(L / 2 - m.r), -m.r);
}

/** Moves a mallet toward a target point (pointer or AI), capped at maxSpeed when given. */
export function moveMalletTo(s: State, side: 0 | 1, target: V2, dt: number, maxSpeed = Infinity) {
  const m = s.mallets[side];
  const px = m.x;
  const pz = m.z;
  let dx = target.x - m.x;
  let dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  const maxStep = maxSpeed * dt;
  if (d > maxStep) {
    dx *= maxStep / d;
    dz *= maxStep / d;
  }
  m.x += dx;
  m.z += dz;
  clampMallet(m, side);
  if (dt > 0) {
    m.vx = (m.x - px) / dt;
    m.vz = (m.z - pz) / dt;
  }
}

/** Keyboard style movement: a direction vector per frame. */
export function nudgeMallet(s: State, side: 0 | 1, dirX: number, dirZ: number, dt: number) {
  const m = s.mallets[side];
  const len = Math.hypot(dirX, dirZ) || 1;
  moveMalletTo(s, side, { x: m.x + (dirX / len) * MALLET_SPEED * dt * 1.01, z: m.z + (dirZ / len) * MALLET_SPEED * dt * 1.01 }, dt, MALLET_SPEED);
  if (!dirX && !dirZ) {
    m.vx = 0;
    m.vz = 0;
  }
}

/** Keeps the puck inside the side walls and the end walls beside the goal mouths after a mallet shoves it. */
function containPuck(p: State['puck']) {
  const lim = W / 2 - p.r;
  if (Math.abs(p.x) > lim) {
    p.x = Math.sign(p.x) * lim;
    p.vx = -Math.sign(p.x) * Math.abs(p.vx) * WALL_E;
  }
  const end = L / 2 - p.r;
  if (Math.abs(p.x) >= GOAL_W / 2 - p.r * 0.3 && Math.abs(p.z) > end) {
    p.z = Math.sign(p.z) * end;
    p.vz = -Math.sign(p.z) * Math.abs(p.vz) * WALL_E;
  }
}

/** Resolves a mallet touching the puck; returns how much the puck's speed changed, or -1 when they don't touch. */
function collide(s: State, side: 0 | 1): number {
  const p = s.puck;
  const m = s.mallets[side];
  const dx = p.x - m.x;
  const dz = p.z - m.z;
  const d = Math.hypot(dx, dz);
  const min = p.r + m.r;
  if (d >= min || d === 0) return -1;
  const before = Math.hypot(p.vx, p.vz);
  const nx = dx / d;
  const nz = dz / d;
  // separate
  p.x = m.x + nx * (min + 1e-4);
  p.z = m.z + nz * (min + 1e-4);
  // relative velocity along the normal
  const rvx = p.vx - m.vx;
  const rvz = p.vz - m.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    const e = 0.85;
    p.vx -= (1 + e) * vn * nx;
    p.vz -= (1 + e) * vn * nz;
  }
  // the mallet always imparts a bit of its own motion, so a resting puck can be pushed
  p.vx += m.vx * 0.25;
  p.vz += m.vz * 0.25;
  const sp = Math.hypot(p.vx, p.vz);
  const minSp = 0.8;
  if (sp < minSp) {
    p.vx += nx * (minSp - sp);
    p.vz += nz * (minSp - sp);
  }
  containPuck(p);
  // pinned against a wall or into a corner: the mallet gives way instead of the puck passing through it
  for (let i = 0; i < 4; i++) {
    const ox = p.x - m.x;
    const oz = p.z - m.z;
    const od = Math.hypot(ox, oz);
    if (od >= min) break;
    const ux = od > 1e-6 ? ox / od : nx;
    const uz = od > 1e-6 ? oz / od : nz;
    m.x = p.x - ux * (min + 1e-4);
    m.z = p.z - uz * (min + 1e-4);
    clampMallet(m, side);
    const push = m.vx * ux + m.vz * uz;
    if (push > 0) {
      m.vx -= push * ux;
      m.vz -= push * uz;
    }
    // the mallet is against its own limit too: slide the puck out along the wall
    const rx = p.x - m.x;
    const rz = p.z - m.z;
    const rd = Math.hypot(rx, rz);
    if (rd < min && rd > 1e-6) {
      p.x = m.x + (rx / rd) * (min + 1e-4);
      p.z = m.z + (rz / rd) * (min + 1e-4);
      containPuck(p);
    }
  }
  return Math.max(0, vn < 0 ? -vn : 0, Math.hypot(p.vx, p.vz) - before);
}

function touch(s: State, ev: Event) {
  for (const side of [0, 1] as const) {
    const power = collide(s, side);
    if (power < 0) continue;
    ev.hit = side;
    ev.power = Math.max(ev.power ?? 0, power);
    ev.at = { x: s.puck.x, z: s.puck.z };
  }
}

export function step(s: State, dt: number): Event {
  const ev: Event = {};
  if (s.winner !== null) return ev;
  s.t += dt;
  const p = s.puck;
  if (s.freeze > 0) {
    s.freeze -= dt;
    // the mallets can still touch the puck during the freeze, which starts play
    touch(s, ev);
    if (ev.hit !== undefined) s.freeze = 0;
    return ev;
  }
  const f = Math.max(0, 1 - FRICTION * dt);
  p.vx *= f;
  p.vz *= f;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > MAX_SPEED) {
    p.vx *= MAX_SPEED / sp;
    p.vz *= MAX_SPEED / sp;
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  const wall = (v: number) => {
    ev.wall = true;
    ev.wallPower = Math.max(ev.wallPower ?? 0, Math.abs(v));
    ev.at = { x: p.x, z: p.z };
  };
  // side walls
  if (p.x - p.r < -W / 2) {
    wall(p.vx);
    p.x = -W / 2 + p.r;
    p.vx = Math.abs(p.vx) * WALL_E;
  } else if (p.x + p.r > W / 2) {
    wall(p.vx);
    p.x = W / 2 - p.r;
    p.vx = -Math.abs(p.vx) * WALL_E;
  }
  // end walls and goals
  const inMouth = Math.abs(p.x) < GOAL_W / 2 - p.r * 0.3;
  if (p.z + p.r > L / 2) {
    if (inMouth) {
      if (p.z - p.r > L / 2) return goal(s, 1, ev);
    } else {
      wall(p.vz);
      p.z = L / 2 - p.r;
      p.vz = -Math.abs(p.vz) * WALL_E;
    }
  } else if (p.z - p.r < -L / 2) {
    if (inMouth) {
      if (p.z + p.r < -L / 2) return goal(s, 0, ev);
    } else {
      wall(p.vz);
      p.z = -L / 2 + p.r;
      p.vz = Math.abs(p.vz) * WALL_E;
    }
  }
  touch(s, ev);
  return ev;
}

function goal(s: State, scorer: 0 | 1, ev: Event): Event {
  s.score[scorer]++;
  ev.goal = scorer;
  if (s.score[scorer] >= TO_WIN) {
    s.winner = scorer;
    ev.win = scorer;
    s.puck.vx = 0;
    s.puck.vz = 0;
    return ev;
  }
  placePuck(s, scorer === 0 ? 1 : 0);
  return ev;
}

/** Where a puck moving along (vx, vz) crosses the line z = zLine, bouncing off the side walls on the way. */
export function predictX(px: number, pz: number, vx: number, vz: number, zLine: number): number {
  if (Math.abs(vz) < 1e-3 || (zLine - pz) / vz < 0) return px;
  const x = px + (vx * (zLine - pz)) / vz;
  const lo = -W / 2 + PUCK_R;
  const span = W - 2 * PUCK_R;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  if (u > span) u = 2 * span - u;
  return lo + u;
}

/**
 * Where a computer mallet wants to be. It thinks in its own frame, defending -z (side 1 already does; side 0 is
 * mirrored), and mutates `mem` only to remember which shot it is lining up.
 */
export function aiTarget(s: State, rng: () => number = Math.random, side: 0 | 1 = 1, mem: AiMem = s): V2 {
  const d = DIFF[s.difficulty];
  const k = side === 1 ? 1 : -1;
  const m = s.mallets[side];
  const px = s.puck.x;
  const pz = s.puck.z * k;
  const vx = s.puck.vx;
  const vz = s.puck.vz * k;
  const mx = m.x;
  const mz = m.z * k;
  const out = (x: number, z: number): V2 => ({ x: clamp(x, -W / 2 + m.r, W / 2 - m.r), z: clamp(z, -(L / 2 - m.r), -m.r) * k });
  const homeZ = -(L / 2 - 0.38);
  const sp = Math.hypot(vx, vz);
  const coming = vz < -0.4;
  const reach = MALLET_R + PUCK_R;
  mem.aiStrike = false;

  if (pz < 0 && (sp < 1.4 || !coming || pz < mz + 0.04)) {
    // attack: pick a spot on the far goal (or its mirror image past a side wall, for a bank shot) and drive through the puck toward it
    if (mem.aiShot === null) {
      let gx = (rng() - 0.5) * GOAL_W * 0.6 + (rng() - 0.5) * (1 - d.aim) * 1.4;
      if (rng() < d.bank) {
        const wall = (px >= 0 ? 1 : -1) * (W / 2 - PUCK_R);
        gx = 2 * wall - gx;
      }
      mem.aiShot = gx;
    }
    const lead = Math.min(0.12, sp * 0.04);
    const qx = px + vx * lead;
    const qz = pz + vz * lead;
    let dx = mem.aiShot - qx;
    let dz = L / 2 - qz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const along = (qx - mx) * dx + (qz - mz) * dz;
    const lateral = Math.abs((qx - mx) * dz - (qz - mz) * dx);
    const ax = qx - dx * (reach + 0.09);
    const az = qz - dz * (reach + 0.09);
    const cornered = Math.abs(ax) > W / 2 - m.r + 0.04 || az < -(L / 2 - m.r) - 0.04;
    // lined up behind the puck: swing through it
    if (along > reach * 0.5 && lateral < 0.05 + 0.07 * (1 - d.aim)) {
      mem.aiStrike = true;
      return out(qx + dx * 0.55, qz + dz * 0.55);
    }
    // no room to get behind it (against a wall), or the setup is taking too long: poke it, then back off so it
    // can come out of a corner instead of being pinned there
    if (cornered || mem.aiAttack > 1.6) {
      if (mem.aiAttack > 3.2) mem.aiAttack = 0;
      const hx = qx - mx;
      const hz = qz - mz;
      const hl = Math.hypot(hx, hz) || 1;
      if (hl < reach + 0.04 || mem.aiAttack > 2.4) return out(qx * 0.4, qz + 0.45);
      return out(qx + (hx / hl) * 0.12, qz + (hz / hl) * 0.12);
    }
    // otherwise get behind it first, stepping around it rather than through it
    if (along < reach) {
      const sideStep = (qx - mx) * dz - (qz - mz) * dx > 0 ? -1 : 1;
      return out(ax + dz * sideStep * reach * 0.6, az - dx * sideStep * reach * 0.6);
    }
    return out(ax, az);
  }
  mem.aiShot = null;
  if (coming) {
    // block: meet the puck where it will cross our line (harder computers step forward to meet it sooner)
    const zLine = homeZ + 0.24 * d.guard;
    const seen = px + (predictX(px, pz, vx, vz, zLine) - px) * d.read;
    const x = seen + (rng() - 0.5) * (1 - d.aim) * 0.6;
    return out(x, zLine);
  }
  // wait: stand on the line between our goal and the puck
  const gx = px;
  const gz = pz + L / 2;
  const gl = Math.hypot(gx, gz) || 1;
  const r = L / 2 + homeZ + 0.06 * d.guard;
  return out((gx / gl) * r * (0.6 + 0.6 * d.guard), -L / 2 + (gz / gl) * r);
}

/** Advances a computer mallet; it only re-decides every `react` seconds so it can be beaten. */
export function stepAI(s: State, dt: number, rng: () => number = Math.random, side: 0 | 1 = 1, mem: AiMem = s) {
  const d = DIFF[s.difficulty];
  mem.aiTimer -= dt;
  if (mem.aiShot !== null) mem.aiAttack += dt;
  else mem.aiAttack = 0;
  if (mem.aiTimer <= 0) {
    mem.aiTarget = aiTarget(s, rng, side, mem);
    mem.aiTimer = d.react;
  }
  moveMalletTo(s, side, mem.aiTarget, dt, d.speed * (mem.aiStrike ? d.strike : 1));
}

/** Call after a step: a hit by this computer ends its current attack, so the next one picks a new shot. */
export function aiHit(mem: AiMem) {
  mem.aiShot = null;
  mem.aiAttack = 0;
  mem.aiStrike = false;
  mem.aiTimer = Math.min(mem.aiTimer, 0.05);
}

export const newAiMem = (side: 0 | 1): AiMem => ({ aiTimer: 0, aiTarget: { x: 0, z: half(side) * (L / 2 - 0.35) }, aiShot: null, aiAttack: 0, aiStrike: false });

export const scoreline = (s: State) => `${s.score[0]} : ${s.score[1]}`;
