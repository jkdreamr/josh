// Computer players. Pure module: reads the world, sets each bot's heading. No DOM.
//
// Bots play the way people do: they leave home on a planned loop, keep an eye on whoever could reach their trail
// before they get back, and run home when it gets close. Four personalities change how big they loop, how nervous
// they are and how keen they are to cut someone off. They see other heads a beat late (a reaction delay), only within
// a few screens, and they think a few times a second, so they can be beaten and they make mistakes.
import { GRACE, SPEED, angleDiff, seenAt, type Player, type World } from './world.ts';

export const DEBUG: Record<string, number> = { head: 0, scared: 0, timeout: 0, plans: 0, noexit: 0, hunts: 0, ran: 0 };
export type Persona = 'cautious' | 'greedy' | 'hunter' | 'defender';
export const PERSONAS: readonly Persona[] = ['cautious', 'greedy', 'hunter', 'defender'];
export type Level = 0 | 1 | 2;

type State = 'home' | 'loop' | 'return' | 'hunt';

export type Mind = {
  persona: Persona;
  level: Level;
  state: State;
  wx: Float64Array;
  wy: Float64Array;
  wn: number;
  wi: number;
  /** Seconds until the next decision. */
  wait: number;
  /** How late this bot sees other heads, seconds. */
  react: number;
  /** How long to stay home before the next loop. */
  dwell: number;
  outSince: number;
  /** Hunt target: a trail cell and its owner, or (ram) the head itself. */
  prey: number;
  preyCell: number;
  ram: boolean;
  /** The planned loop has actually left home (so being home again means it is done). */
  left: boolean;
  /** Steering is re-checked every few ticks. */
  probeIn: number;
  heading: number;
  rng: () => number;
};

const TUNE = {
  cautious: { loop: [20, 36], width: [20, 36], nerve: 1.3, hunt: 0.15, maxOut: 7 },
  greedy: { loop: [48, 104], width: [40, 88], nerve: 0.65, hunt: 0.1, maxOut: 16 },
  hunter: { loop: [28, 52], width: [24, 48], nerve: 0.95, hunt: 0.85, maxOut: 10 },
  defender: { loop: [28, 52], width: [24, 48], nerve: 1.1, hunt: 0.45, maxOut: 9 },
} as const;

const LEVEL = [
  { think: 0.32, react: 0.55, sight: 110, look: 14, nerve: 0.7, jitter: 0.22, blunder: 0.05 },
  { think: 0.2, react: 0.35, sight: 150, look: 20, nerve: 1, jitter: 0.1, blunder: 0.015 },
  { think: 0.12, react: 0.2, sight: 190, look: 26, nerve: 1.15, jitter: 0.04, blunder: 0.004 },
] as const;

export function makeMind(persona: Persona, level: Level, rng: () => number): Mind {
  return {
    persona,
    level,
    state: 'home',
    wx: new Float64Array(8),
    wy: new Float64Array(8),
    wn: 0,
    wi: 0,
    wait: rng() * 0.3,
    react: LEVEL[level].react * (0.8 + rng() * 0.5),
    dwell: 0.3 + rng() * 0.8,
    outSince: 0,
    prey: -1,
    preyCell: -1,
    ram: false,
    left: false,
    probeIn: 0,
    heading: NaN,
    rng,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const range = (rng: () => number, [a, b]: readonly [number, number]) => lerp(a, b, rng());

/** Cell index at a point, or -1 outside the grid. */
function cellAt(w: World, x: number, y: number) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= w.n || cy >= w.n ? -1 : cy * w.n + cx;
}

/** Inside the arena with room to spare. */
function inside(w: World, x: number, y: number, margin: number) {
  const dx = x - w.c;
  const dy = y - w.c;
  const lim = w.r - margin;
  return dx * dx + dy * dy < lim * lim;
}

/** Clamps a point into the arena. */
function clampIn(w: World, x: number, y: number, margin: number): [number, number] {
  const dx = x - w.c;
  const dy = y - w.c;
  const lim = w.r - margin;
  const d = Math.hypot(dx, dy);
  if (d <= lim) return [x, y];
  return [w.c + (dx / d) * lim, w.c + (dy / d) * lim];
}

/** Own trail older than the grace window: running into it is death. */
function ownTrail(w: World, p: Player, k: number) {
  return w.trail[k] === p.id + 1 && w.trailAt[k] < p.steps - GRACE - 2;
}

/**
 * The shortest straight way home that does not cross your own trail: 16 rays, first own cell on each.
 * Returns [distance, x, y] or null.
 */
export function wayHome(w: World, p: Player, maxDist = 320): [number, number, number] | null {
  const me = p.id + 1;
  let best: [number, number, number] | null = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let d = 3; d < maxDist; d += 3) {
      if (best && d >= best[0]) break;
      const x = p.x + ca * d;
      const y = p.y + sa * d;
      const k = cellAt(w, x, y);
      if (k < 0 || !w.arena[k]) break;
      if (d > 5 && ownTrail(w, p, k)) break;
      if (w.owner[k] === me) {
        // a turn costs a little: the head cannot spin on the spot
        const cost = d + Math.abs(angleDiff(a, p.h)) * 6;
        if (!best || cost < best[0]) best = [cost, x + ca * 8, y + sa * 8];
        break;
      }
    }
  }
  return best;
}

/** How far the head can go on heading `a` before its own old trail or the wall. */
function clearance(w: World, p: Player, a: number, look: number) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let d = 3; d <= look; d += 2.5) {
    const x = p.x + ca * d;
    const y = p.y + sa * d;
    if (!inside(w, x, y, 5)) return d;
    const k = cellAt(w, x, y);
    if (k < 0) return d;
    if (ownTrail(w, p, k)) return d;
  }
  return look + 1;
}

/** The nearest stretch of another player's trail this bot could reach before its owner gets back to it. */
function findPrey(w: World, p: Player, m: Mind, sight: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const q of w.players) {
    if (!q || q === p || !q.alive || !q.out || q.trailLen < 30) continue;
    const [qx, qy] = seenAt(w, q.id, m.react);
    if (Math.hypot(qx - p.x, qy - p.y) > sight * 1.3) continue;
    const step = Math.max(12, (q.trailLen / 40) | 0);
    for (let i = 0; i < q.trailLen; i += step) {
      const k = q.trail[i];
      if (w.trail[k] !== q.id + 1) continue;
      const y = (k / w.n) | 0;
      const x = k - y * w.n;
      const mine = Math.hypot(x - p.x, y - p.y);
      if (mine > sight || mine >= bestD) continue;
      // only worth it if we get there clearly first
      const theirs = Math.hypot(x - qx, y - qy);
      if (mine > theirs * 1.15 + 8) continue;
      bestD = mine;
      best = [q.id, k];
    }
  }
  return best;
}

/** Nearest living head (as this bot sees it) and its distance to any point of our trail and to our head. */
function threat(w: World, p: Player, m: Mind, sight: number): { trail: number; head: number; who: number } {
  let trail = Infinity;
  let head = Infinity;
  let who = -1;
  const stride = Math.max(4, (p.trailLen / 30) | 0);
  for (const q of w.players) {
    if (!q || q === p || !q.alive) continue;
    const [qx, qy] = seenAt(w, q.id, m.react);
    const dh = Math.hypot(qx - p.x, qy - p.y);
    if (dh > sight) continue;
    if (dh < head) {
      head = dh;
      if (q.out) who = q.id;
    }
    for (let i = 0; i < p.trailLen; i += stride) {
      const k = p.trail[i];
      const y = (k / w.n) | 0;
      const x = k - y * w.n;
      const d = Math.hypot(x - qx, y - qy);
      if (d < trail) trail = d;
    }
    if (p.trailLen) {
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < trail) trail = d;
    }
  }
  return { trail, head, who };
}

function setPath(m: Mind, pts: [number, number][]) {
  m.wn = Math.min(pts.length, 8);
  for (let i = 0; i < m.wn; i++) {
    m.wx[i] = pts[i][0];
    m.wy[i] = pts[i][1];
  }
  m.wi = 0;
}

/** Somewhere on our own land a few cells away, to wander to between loops. */
function homeSpot(w: World, p: Player, m: Mind): [number, number] {
  const me = p.id + 1;
  for (let i = 0; i < 8; i++) {
    const a = p.h + (m.rng() - 0.5) * (1 + i * 0.6);
    const d = 10 + m.rng() * 14;
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const k = cellAt(w, x, y);
    if (k >= 0 && w.owner[k] === me && inside(w, x, y, 8)) return [x, y];
  }
  return [(p.minX + p.maxX) / 2 + 0.5, (p.minY + p.maxY) / 2 + 0.5];
}

/** Plans a loop out of home: out, across, back in. Tries a few directions and keeps the most promising. */
function planLoop(w: World, p: Player, m: Mind) {
  const t = TUNE[m.persona];
  const me = p.id + 1;
  let best: [number, number][] | null = null;
  let bestScore = -Infinity;
  for (let tries = 0; tries < 7; tries++) {
    const a = tries === 0 ? p.h + (m.rng() - 0.5) * 1.2 : m.rng() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // exit point: where our land ends in that direction
    let ex = p.x;
    let ey = p.y;
    let found = false;
    for (let d = 0; d < 280; d += 3) {
      const k = cellAt(w, p.x + ca * d, p.y + sa * d);
      if (k < 0 || !w.arena[k]) break;
      if (w.owner[k] !== me) {
        ex = p.x + ca * d;
        ey = p.y + sa * d;
        found = true;
        break;
      }
    }
    if (!found) continue;
    const L = range(m.rng, t.loop);
    const W = range(m.rng, t.width);
    const side = m.rng() < 0.5 ? 1 : -1;
    const nx = -sa * side;
    const ny = ca * side;
    const p1: [number, number] = [ex + ca * L, ey + sa * L];
    const p2: [number, number] = [p1[0] + nx * W, p1[1] + ny * W];
    const p3: [number, number] = [ex + nx * W, ey + ny * W];
    const p4: [number, number] = [ex + nx * W * 0.5 - ca * 12, ey + ny * W * 0.5 - sa * 12];
    let score = 0;
    if (!inside(w, p1[0], p1[1], 12) || !inside(w, p2[0], p2[1], 12)) score -= 40;
    // how much of the box is not ours yet (enemy land is a bonus for the greedy)
    for (let i = 0; i < 9; i++) {
      const u = (i % 3) / 2 + 0.17;
      const v = ((i / 3) | 0) / 2 + 0.17;
      const k = cellAt(w, ex + ca * L * u + nx * W * v, ey + sa * L * u + ny * W * v);
      if (k < 0 || !w.arena[k]) score -= 3;
      else if (w.owner[k] === 0) score += 2;
      else if (w.owner[k] !== me) score += m.persona === 'greedy' ? 3 : 1;
    }
    // other heads near the box are a worry
    for (const q of w.players) {
      if (!q || q === p || !q.alive) continue;
      const [qx, qy] = seenAt(w, q.id, m.react);
      const d = Math.hypot(qx - (ex + ca * L * 0.5), qy - (ey + sa * L * 0.5));
      if (d < L + W) score -= (L + W - d) * (m.persona === 'greedy' ? 0.08 : 0.25);
    }
    score += m.rng() * 4;
    if (score > bestScore) {
      bestScore = score;
      best = [clampIn(w, ex, ey, 8), clampIn(w, ...p1, 10), clampIn(w, ...p2, 10), clampIn(w, ...p3, 8), clampIn(w, ...p4, 8)];
    }
  }
  DEBUG.plans++;
  if (!best) {
    DEBUG.noexit++;
    // deep inside a big land: head for its edge first
    const a = m.rng() * Math.PI * 2;
    best = [clampIn(w, p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80, 16)];
  }
  setPath(m, best);
  m.state = 'loop';
  m.left = false;
}

/** One decision: keep going, run home, plan the next loop or go hunting. */
function think(w: World, p: Player, m: Mind) {
  const L = LEVEL[m.level];
  const t = TUNE[m.persona];
  const blunder = m.rng() < L.blunder;
  if (p.out) {
    if (!m.left) {
      m.left = true;
      m.outSince = w.time;
    }
    if (m.state === 'home') m.state = 'loop';
    const home = wayHome(w, p);
    const danger = threat(w, p, m, L.sight);
    const homeD = home ? home[0] : 160;
    const nerve = t.nerve * L.nerve;
    const outFor = w.time - m.outSince;
    const scared = !blunder && (danger.trail < homeD * nerve + 6 || danger.head < 18);
    if ((scared || outFor > t.maxOut) && m.state !== 'return') {
      DEBUG[scared ? (danger.head < 18 ? 'head' : 'scared') : 'timeout']++;
      if (home) setPath(m, [[home[1], home[2]]]);
      else setPath(m, [[(p.minX + p.maxX) / 2, (p.minY + p.maxY) / 2]]);
      m.state = 'return';
    } else if (m.state === 'return' && home) {
      // keep re-aiming at the nearest way home
      setPath(m, [[home[1], home[2]]]);
    }
    if (m.state === 'hunt') {
      const q = w.players[m.prey];
      if (m.ram || !q || !q.alive || !q.out || w.trail[m.preyCell] !== m.prey + 1) {
        if (home) setPath(m, [[home[1], home[2]]]);
        m.state = 'return';
      }
    } else if (m.state === 'loop' && !scared && m.rng() < t.hunt * 0.5 && homeD < 50) {
      const prey = findPrey(w, p, m, L.sight * 0.6);
      if (prey) startHunt(w, m, prey);
    }
    return;
  }
  // at home: still on the way out of a planned loop, or back from one
  if (m.state === 'loop' && !m.left) return;
  if (m.state !== 'home' && m.state !== 'hunt') {
    m.state = 'home';
    m.dwell = (m.persona === 'greedy' ? 0.1 : m.persona === 'cautious' ? 0.5 : 0.3) + m.rng() * 0.6;
    setPath(m, [homeSpot(w, p, m)]);
  }
  if (m.state === 'hunt') {
    const q = w.players[m.prey];
    if (!q || !q.alive || !q.out || (!m.ram && w.trail[m.preyCell] !== m.prey + 1)) m.state = 'home';
    else if (m.ram) {
      const [qx, qy] = seenAt(w, q.id, m.react);
      const k = cellAt(w, qx, qy);
      // chase only while they are on our land
      if (k < 0 || w.owner[k] !== p.id + 1) m.state = 'home';
      else setPath(m, [[qx, qy]]);
    }
    return;
  }
  if (m.rng() < t.hunt) {
    const prey = findPrey(w, p, m, L.sight * (m.persona === 'defender' ? 0.5 : 0.8));
    if (prey) {
      startHunt(w, m, prey);
      return;
    }
  }
  // defenders ram intruders: a head out on our land loses a head-on with us
  if (m.persona === 'defender' || (m.persona === 'hunter' && m.level === 2)) {
    for (const q of w.players) {
      if (!q || q === p || !q.alive || !q.out) continue;
      const [qx, qy] = seenAt(w, q.id, m.react);
      const k = cellAt(w, qx, qy);
      if (k >= 0 && w.owner[k] === p.id + 1 && Math.hypot(qx - p.x, qy - p.y) < 60) {
        setPath(m, [[qx, qy]]);
        m.state = 'hunt';
        m.prey = q.id;
        m.preyCell = -1;
        m.ram = true;
        return;
      }
    }
  }
  m.dwell -= L.think;
  if (m.dwell <= 0) planLoop(w, p, m);
}

function startHunt(w: World, m: Mind, prey: [number, number]) {
  DEBUG.hunts++;
  const [id, k] = prey;
  const y = (k / w.n) | 0;
  setPath(m, [[k - y * w.n + 0.5, y + 0.5]]);
  m.state = 'hunt';
  m.prey = id;
  m.preyCell = k;
  m.ram = false;
}

/** Runs a bot for one tick: thinks now and then, steers every tick, dodges its own trail and the wall. */
export function botTick(w: World, p: Player, dt: number) {
  const m = p.mind as Mind | null;
  if (!m || !p.alive) return;
  const L = LEVEL[m.level];
  m.wait -= dt;
  if (m.wait <= 0) {
    m.wait = L.think * (0.75 + m.rng() * 0.5);
    think(w, p, m);
  }
  // follow the waypoints
  let target = NaN;
  while (m.wi < m.wn) {
    const dx = m.wx[m.wi] - p.x;
    const dy = m.wy[m.wi] - p.y;
    if (dx * dx + dy * dy < 36) {
      m.wi++;
      continue;
    }
    target = Math.atan2(dy, dx);
    break;
  }
  if (m.wi >= m.wn) {
    if (m.state === 'hunt' && !m.ram) m.state = p.out ? 'return' : 'home';
    if (p.out) {
      DEBUG.ran++;
      // ran out of plan while still outside: aim home now
      const home = wayHome(w, p);
      if (home) {
        setPath(m, [[home[1], home[2]]]);
        target = Math.atan2(home[2] - p.y, home[1] - p.x);
      } else target = p.h;
    } else target = Number.isNaN(m.heading) ? p.h : m.heading;
  }
  target += (m.rng() - 0.5) * L.jitter;
  // dodge: keep the wanted heading if it is clear, else the nearest clear one
  m.probeIn -= 1;
  if (m.probeIn <= 0) {
    m.probeIn = 3;
    const look = L.look;
    let pick = target;
    if (clearance(w, p, target, look) <= look) {
      let bestClear = -1;
      for (let i = 1; i <= 8; i++) {
        for (let s = 1; s >= -1; s -= 2) {
          const a = target + s * i * 0.35;
          const c = clearance(w, p, a, look);
          if (c > look) {
            pick = a;
            bestClear = Infinity;
            break;
          }
          if (c > bestClear) {
            bestClear = c;
            pick = a;
          }
        }
        if (bestClear === Infinity) break;
      }
    }
    m.heading = pick;
  } else if (Number.isNaN(m.heading)) m.heading = target;
  else {
    // between probes, follow the target unless the last probe steered away from it
    const off = Math.abs(angleDiff(m.heading, target));
    if (off < 0.2) m.heading = target;
  }
  p.want = m.heading;
}

/** Bots move at the same speed as everyone. Exposed for tests. */
export const BOT_SPEED = SPEED;

const NAMES = [
  'hoover',
  'lake lag',
  'the dish',
  'coho',
  'tresidder',
  'memchu',
  'bow seat',
  'stroke seat',
  'erg king',
  'cantor',
  'frosoco',
  'big game',
  'redwood',
  'sand hill',
  'el camino',
  'the oval',
  'arbo',
  'rodin',
  'bing',
  'wilbur',
  'roble',
  'lagunita',
  'tree',
  'coupa',
  'axe',
  'packard',
  'gates',
  'huang',
  'jsq',
  'math corner',
] as const;

/** Bot names: a light campus flavor, never two the same in one round. */
export function botNames(count: number, rng: () => number, taken: string[] = []): string[] {
  const pool = NAMES.filter((n) => !taken.includes(n));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (!pool.length) {
      out.push(`bot ${i + 1}`);
      continue;
    }
    const j = Math.floor(rng() * pool.length);
    out.push(pool.splice(j, 1)[0]);
  }
  return out;
}

/** Personalities for a field of bots: a mix of all four, then random. */
export function personas(count: number, rng: () => number): Persona[] {
  const out: Persona[] = [];
  const off = Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) out.push(i < PERSONAS.length ? PERSONAS[(i + off) % 4] : PERSONAS[Math.floor(rng() * 4)]);
  return out;
}
