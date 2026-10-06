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
export const MALLET_SPEED = 3.4; // keyboard mallet speed

export const DIFF: Record<Difficulty, { speed: number; react: number; aim: number }> = {
  easy: { speed: 1.5, react: 0.55, aim: 0.5 },
  normal: { speed: 2.3, react: 0.3, aim: 0.8 },
  hard: { speed: 3.3, react: 0.12, aim: 1 },
};

export type Event = { wall?: boolean; hit?: 0 | 1; goal?: 0 | 1; win?: 0 | 1 };

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
  if (side === 0) m.z = clamp(m.z, m.r * 0.5, L / 2 - m.r);
  else m.z = clamp(m.z, -(L / 2 - m.r), -m.r * 0.5);
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

function collide(s: State, side: 0 | 1): boolean {
  const p = s.puck;
  const m = s.mallets[side];
  const dx = p.x - m.x;
  const dz = p.z - m.z;
  const d = Math.hypot(dx, dz);
  const min = p.r + m.r;
  if (d >= min || d === 0) return false;
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
  return true;
}

export function step(s: State, dt: number): Event {
  const ev: Event = {};
  if (s.winner !== null) return ev;
  s.t += dt;
  const p = s.puck;
  if (s.freeze > 0) {
    s.freeze -= dt;
    // the mallets can still touch the puck during the freeze, which starts play
    for (const side of [0, 1] as const) if (collide(s, side)) {
      s.freeze = 0;
      ev.hit = side;
    }
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

  // side walls
  if (p.x - p.r < -W / 2) {
    p.x = -W / 2 + p.r;
    p.vx = Math.abs(p.vx) * WALL_E;
    ev.wall = true;
  } else if (p.x + p.r > W / 2) {
    p.x = W / 2 - p.r;
    p.vx = -Math.abs(p.vx) * WALL_E;
    ev.wall = true;
  }
  // end walls and goals
  const inMouth = Math.abs(p.x) < GOAL_W / 2 - p.r * 0.3;
  if (p.z + p.r > L / 2) {
    if (inMouth) {
      if (p.z - p.r > L / 2) return goal(s, 1, ev);
    } else {
      p.z = L / 2 - p.r;
      p.vz = -Math.abs(p.vz) * WALL_E;
      ev.wall = true;
    }
  } else if (p.z - p.r < -L / 2) {
    if (inMouth) {
      if (p.z + p.r < -L / 2) return goal(s, 0, ev);
    } else {
      p.z = -L / 2 + p.r;
      p.vz = Math.abs(p.vz) * WALL_E;
      ev.wall = true;
    }
  }
  for (const side of [0, 1] as const) if (collide(s, side)) ev.hit = side;
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

/** Where the computer (side 1, defending -z) wants its mallet. */
export function aiTarget(s: State, rng: () => number = Math.random): V2 {
  const d = DIFF[s.difficulty];
  const p = s.puck;
  const m = s.mallets[1];
  const homeZ = -(L / 2 - 0.4);
  const towardUs = p.vz < 0;
  const inOurHalf = p.z < 0;
  if (inOurHalf && (towardUs || Math.hypot(p.vx, p.vz) < 1.2 || p.z < m.z + 0.2)) {
    const sp = Math.hypot(p.vx, p.vz);
    const lead = clamp(sp * 0.12, 0, 0.35);
    const aimX = p.x * 0.15 * d.aim + (rng() - 0.5) * (1 - d.aim) * 0.3;
    const behind = m.z < p.z - PUCK_R - m.r * 0.5 && Math.abs(m.x - p.x) < 0.32;
    // once lined up behind the puck, swing through it toward the far goal; otherwise get behind it first
    if (behind) return { x: p.x - aimX, z: Math.min(p.z + 0.6, -m.r) };
    return { x: p.x - aimX, z: Math.min(p.z - PUCK_R - m.r - 0.1 - lead, -m.r) };
  }
  // defend: shadow the puck's x in front of the goal
  const predictX = p.vz < 0 && Math.abs(p.vz) > 0.05 ? p.x + (p.vx * (homeZ - p.z)) / p.vz : p.x;
  return { x: clamp(predictX * 0.8, -W / 2 + m.r, W / 2 - m.r), z: homeZ };
}

/** Advances the computer mallet; it only re-decides every `react` seconds so it can be beaten. */
export function stepAI(s: State, dt: number, rng: () => number = Math.random) {
  const d = DIFF[s.difficulty];
  s.aiTimer -= dt;
  if (s.aiTimer <= 0) {
    s.aiTarget = aiTarget(s, rng);
    s.aiTimer = d.react;
  }
  moveMalletTo(s, 1, s.aiTarget, dt, d.speed);
}

export const scoreline = (s: State) => `${s.score[0]} : ${s.score[1]}`;
