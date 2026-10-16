// Computer tank brains for Tank Maze. Pure module, no DOM.
// A bot only ever produces a TankInput; it reads the same visible state a player sees.
import { bfs, cellOf, predictShell, SHELL_SPEED, traceShot, type Rng, type TankInput, type World } from './logic.ts';

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type BotMemory = {
  nextThink: number;
  path: number[];
  goal: number;
  reactAt: number;
  seenThreat: boolean;
  dodgeUntil: number;
  dodge: TankInput;
  /** Aim point for the current leg (doorway midpoint or enemy position), refreshed at replan. */
  ax: number;
  ay: number;
  /** The next cell's center, steered for once the tank reaches the doorway. */
  bx: number;
  by: number;
  /** A firing solution to align on, or null. */
  shot: number | null;
  shotAt: number;
  shotX: number;
  shotY: number;
  /** Time the current shot needs to reach its target; a bot waits that long before firing again. */
  shotTime: number;
  /** Where the tank has been sitting since `anchorAt`, to notice a standoff. */
  anchorX: number;
  anchorY: number;
  anchorAt: number;
  /** Until then the bot stops trading shots and drives at its target. */
  pushUntil: number;
  /** When the tank picked up the mine it is holding, or -1. */
  mineAt: number;
};

export const makeMemory = (): BotMemory => ({
  nextThink: 0,
  path: [],
  goal: -1,
  reactAt: 0,
  seenThreat: false,
  dodgeUntil: 0,
  dodge: { turn: 0, move: 0, fire: false },
  ax: 0,
  ay: 0,
  bx: 0,
  by: 0,
  shot: null,
  shotAt: -9,
  shotX: 0,
  shotY: 0,
  shotTime: 0,
  anchorX: NaN,
  anchorY: NaN,
  anchorAt: 0,
  pushUntil: -1,
  mineAt: -1,
});

/** Seconds a bot may sit in one spot before it breaks a standoff by charging. */
export const STANDOFF = 5;
/** Seconds the charge lasts. */
const PUSH = 2.5;

/** Steer the tank toward a point: turn to the heading, drive when roughly aligned. */
const steerTo = (t: { x: number; y: number; a: number }, x: number, y: number, bx = x, by = y): TankInput => {
  const input: TankInput = { turn: 0, move: 0, fire: false };
  // Sitting on the waypoint: the heading to it is noise, so head for the cell beyond it instead
  // (driving straight on from a doorway reached at an angle grinds into the wall beside it).
  if (Math.hypot(x - t.x, y - t.y) < 0.35) {
    if (Math.hypot(bx - t.x, by - t.y) < 0.35) {
      input.move = 1;
      return input;
    }
    x = bx;
    y = by;
  }
  const want = Math.atan2(y - t.y, x - t.x);
  const err = wrapA(want - t.a);
  if (Math.abs(err) > 2.6) {
    input.turn = err > 0 ? 1 : -1;
    input.move = -1; // backing up turns the nose around faster in tight corridors
    return input;
  }
  input.turn = Math.abs(err) < 0.1 ? 0 : err > 0 ? 1 : -1;
  input.move = Math.abs(err) < 0.6 ? 1 : 0;
  return input;
};

/** BFS path (cell list, own cell first) to a goal cell. Empty when unreachable. */
const pathTo = (w: World, from: number, goal: number): number[] => {
  if (from === goal) return [from];
  const dist = bfs(w.maze, [goal]);
  if (dist[from] < 0) return [];
  const path = [from];
  let c = from;
  const { cols, rows } = w.maze;
  const open = (c2: number) => dist[c2] === dist[c] - 1;
  let guard = cols * rows;
  while (c !== goal && guard-- > 0) {
    const cx = c % cols;
    const cy = (c / cols) | 0;
    const nbrs = [c - 1, c + 1, c - cols, c + cols].filter((n, i) => {
      if (n < 0 || n >= cols * rows) return false;
      if (i === 0 && (cx === 0 || w.maze.v[cy * (cols + 1) + cx])) return false;
      if (i === 1 && (cx === cols - 1 || w.maze.v[cy * (cols + 1) + cx + 1])) return false;
      if (i === 2 && (cy === 0 || w.maze.h[cy * cols + cx])) return false;
      if (i === 3 && (cy === rows - 1 || w.maze.h[(cy + 1) * cols + cx])) return false;
      return true;
    });
    const next = nbrs.find(open);
    if (next === undefined) return [];
    path.push(next);
    c = next;
  }
  return path;
};

const nearestEnemy = (w: World, id: number) => {
  const me = w.tanks[id];
  let best = -1;
  let bd = Infinity;
  for (const t of w.tanks) {
    if (!t.alive || t.id === id) continue;
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    if (d < bd) {
      bd = d;
      best = t.id;
    }
  }
  return best;
};

/** Would a shell fired now from this tank at `angle` hit an enemy before itself? */
const shotHits = (w: World, id: number, angle: number, maxBounces: number): number => {
  const t = w.tanks[id];
  const tr = traceShot(w, t.x, t.y, angle, maxBounces, 20, id);
  if (tr.hit < 0) return -1;
  return tr.hit === id ? -2 : tr.hit;
};

/** Pick a fire heading: samples candidate angles, prefers one whose trace hits an enemy. */
function pickShot(w: World, id: number, level: 0 | 1 | 2, rng: Rng): number | null {
  const t = w.tanks[id];
  const samples = level === 2 ? 64 : level === 1 ? 16 : 8;
  const bounces = level === 2 ? 3 : level === 1 ? 1 : 0;
  // Cheapest first: aim straight at the nearest enemy and check the trace.
  const foe = nearestEnemy(w, id);
  if (foe >= 0) {
    const direct = Math.atan2(w.tanks[foe].y - t.y, w.tanks[foe].x - t.x);
    const res = shotHits(w, id, direct, bounces);
    if (res >= 0) return direct;
  }
  let bestAngle: number | null = null;
  let bestErr = Infinity;
  const base = foe >= 0 ? Math.atan2(w.tanks[foe].y - t.y, w.tanks[foe].x - t.x) : t.a;
  for (let i = 0; i < samples; i++) {
    const off = (i / samples) * Math.PI * 2 - Math.PI;
    const a = t.a + off;
    const res = shotHits(w, id, a, bounces);
    if (res === -2) continue; // never fire a shot that hits ourselves first
    if (res < 0) continue;
    const err = Math.abs(wrapA(a - base)) + rng() * 0.2;
    if (err < bestErr) {
      bestErr = err;
      bestAngle = a;
    }
  }
  return bestAngle;
}

/** Does this tank have a shell in flight younger than `secs`? */
const ownShellIn = (w: World, id: number, secs: number) => w.shells.some((s) => s.owner === id && s.age < secs);

/** Distance the closest predicted shell path point comes to the tank, within `secs`. */
function threat(w: World, id: number, secs: number): number {
  const t = w.tanks[id];
  let worst = Infinity;
  for (const s of w.shells) {
    if (s.owner === id && s.age < 0.2) continue;
    for (const p of predictShell(w, s, secs)) {
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < worst) worst = d;
    }
  }
  for (const m of w.mines) {
    if (m.age < 1) continue;
    const d = Math.hypot(m.x - t.x, m.y - t.y);
    if (d - 0.7 < worst) worst = d - 0.7 + 0.01;
  }
  return worst;
}

/** Try candidate inputs for a short lookahead; keep the one whose future self is least threatened. */
function dodge(w: World, id: number, rng: Rng): TankInput {
  const cands: TankInput[] = [
    { turn: 0, move: 1, fire: false },
    { turn: 0, move: -1, fire: false },
    { turn: 1, move: 1, fire: false },
    { turn: -1, move: 1, fire: false },
    { turn: 1, move: -1, fire: false },
    { turn: -1, move: -1, fire: false },
    { turn: 0, move: 0, fire: false },
  ];
  const t = w.tanks[id];
  let best = cands[cands.length - 1];
  let bd = -Infinity;
  for (const c of cands) {
    // coarse prediction: integrate the tank for ~0.45s, then measure shell clearance
    let x = t.x;
    let y = t.y;
    let a = t.a;
    for (let i = 0; i < 27; i++) {
      a = wrapA(a + c.turn * 3.8 * (1 / 60));
      if (c.move !== 0) {
        x += Math.cos(a) * (c.move > 0 ? 1.9 : 1.3) * c.move * (1 / 60);
        y += Math.sin(a) * (c.move > 0 ? 1.9 : 1.3) * c.move * (1 / 60);
      }
    }
    const ghost: World = { ...w, tanks: [{ ...t, x, y, a }] as World['tanks'] };
    const d = threat(ghost, 0, 1.0) + rng() * 0.05;
    if (d > bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * One bot decision. `memory` persists across calls (replan cadence lives there, staggered by tank id).
 * Level: 0 easy (line of sight only, slow, sloppy), 1 normal (one bounce, some dodging), 2 hard (bank shots, dodging).
 */
export function think(w: World, id: number, level: 0 | 1 | 2, memory: BotMemory, rng: Rng): TankInput {
  const t = w.tanks[id];
  const idle: TankInput = { turn: 0, move: 0, fire: false };
  if (!t.alive || w.phase !== 'play') return idle;
  const now = w.time;

  // Dodging is urgent and cheap enough to check every step on Normal/Hard.
  if (level >= 1 && now >= memory.dodgeUntil) {
    const danger = threat(w, id, level === 2 ? 1.1 : 0.8);
    if (danger < 0.35) {
      if (!memory.seenThreat) {
        memory.seenThreat = true;
        memory.reactAt = now + (level === 2 ? 0.05 : 0.12);
      } else if (now >= memory.reactAt && (level === 2 || rng() < 0.8)) {
        memory.dodge = dodge(w, id, rng);
        memory.dodgeUntil = now + 0.3;
        return memory.dodge;
      }
    } else {
      memory.seenThreat = false;
    }
    if (now < memory.dodgeUntil) return memory.dodge;
  }

  const foe = nearestEnemy(w, id);
  if (foe < 0) return idle;

  // Standoff: parked in one spot too long (trading shots that cancel out, or stuck on a corner),
  // so stop shooting for a moment and drive at the target.
  if (!(Math.hypot(t.x - memory.anchorX, t.y - memory.anchorY) < 0.6)) {
    memory.anchorX = t.x;
    memory.anchorY = t.y;
    memory.anchorAt = now;
  } else if (now - memory.anchorAt > STANDOFF) {
    memory.pushUntil = now + PUSH;
    memory.anchorAt = now;
    memory.shot = null;
    memory.path = [];
    memory.nextThink = now;
  }
  if (t.special === 'mine' && memory.mineAt < 0) memory.mineAt = now;
  if (t.special !== 'mine') memory.mineAt = -1;

  // Heavy planning (path, firing solution) is throttled; steering itself is recomputed every step so
  // the bang-bang turn doesn't oscillate around its deadband between replans.
  const me = cellOf(w.maze, t.x, t.y);
  if (now >= memory.nextThink) {
    memory.nextThink = now + (level === 0 ? 0.2 : 0.14) + id * 0.01;

    // Pick a destination: nearest enemy, or a close pickup on Normal/Hard.
    let goal = cellOf(w.maze, w.tanks[foe].x, w.tanks[foe].y);
    if (level >= 1 && !t.special) {
      const dist = bfs(w.maze, [me]);
      for (const p of w.pickups) {
        const pc = p.cy * w.maze.cols + p.cx;
        if (dist[pc] >= 0 && dist[pc] <= 4 && dist[pc] < dist[goal] / 2) goal = pc;
      }
    }
    if (memory.goal !== goal || !memory.path.length || memory.path[0] !== me) {
      memory.goal = goal;
      memory.path = pathTo(w, me, goal);
    }
    if (me === goal || !memory.path.length) {
      memory.ax = memory.bx = w.tanks[foe].x;
      memory.ay = memory.by = w.tanks[foe].y;
    } else {
      // Aim at the doorway between this cell and the next (the midpoint of their centers): driving at
      // the next cell's center grinds on the wall beside the opening and the tank never crosses.
      const next = memory.path[1];
      memory.ax = (me % w.maze.cols + (next % w.maze.cols)) / 2 + 0.5;
      memory.ay = (((me / w.maze.cols) | 0) + ((next / w.maze.cols) | 0)) / 2 + 0.5;
      memory.bx = (next % w.maze.cols) + 0.5;
      memory.by = ((next / w.maze.cols) | 0) + 0.5;
    }

    // Firing solution (sloppy on Easy).
    let shot = now < memory.pushUntil ? null : pickShot(w, id, level, rng);
    if (shot !== null && level === 0) shot += (rng() - 0.5) * 0.3;
    memory.shot = shot;
    memory.shotTime = shot === null ? 0 : traceShot(w, t.x, t.y, shot, level === 2 ? 3 : level === 1 ? 1 : 0, 20, id).len / SHELL_SPEED;
    memory.shotAt = now;
    memory.shotX = t.x;
    memory.shotY = t.y;
  }

  // Specials: use them sensibly.
  if (t.special === 'mine') {
    const input = steerTo(t, memory.ax, memory.ay, memory.bx, memory.by);
    // Drop it in a corridor while an enemy is roughly behind us, or right on top of one, or once it
    // has been held a while: holding a mine means no shells, so a bot that never drops it never shoots.
    const behind = wrapA(Math.atan2(w.tanks[foe].y - t.y, w.tanks[foe].x - t.x) - t.a);
    const close = Math.hypot(w.tanks[foe].x - t.x, w.tanks[foe].y - t.y) < 1.2;
    if (Math.abs(behind) > 2.1 || close || now - memory.mineAt > 6) input.fire = true;
    return input;
  }

  // A stale firing solution (computed from a spot we have since left) is dropped.
  if (memory.shot !== null && (now - memory.shotAt > 2 || Math.hypot(t.x - memory.shotX, t.y - memory.shotY) > 0.6)) memory.shot = null;

  if (t.special === 'laser') {
    const res = shotHits(w, id, t.a, 5);
    const input = steerTo(t, memory.ax, memory.ay, memory.bx, memory.by);
    if (res >= 0) {
      input.fire = true;
      return input;
    }
    // line the turret up on a traced beam instead of wandering
    if (memory.shot !== null) {
      const err = wrapA(memory.shot - t.a);
      input.turn = Math.abs(err) < 0.08 ? 0 : err > 0 ? 1 : -1;
      input.move = Math.abs(err) < 0.5 ? input.move : 0;
      if (Math.abs(err) < 0.08) input.fire = true;
    }
    return input;
  }

  // Normal firing: align on the solution and take it when the turret is there.
  const ready = now >= memory.reactAt;
  if (memory.shot !== null) {
    const err = wrapA(memory.shot - t.a);
    const tol = level === 0 ? 0.18 : level === 1 ? 0.12 : 0.08;
    const input = steerTo(t, memory.ax, memory.ay, memory.bx, memory.by);
    // Turning toward the shot wins over steering while the error is large.
    if (Math.abs(err) > tol) {
      input.turn = err > 0 ? 1 : -1;
      if (Math.abs(err) > 1.2) input.move = 0;
    } else if (ready) {
      input.turn = err > 0.05 ? 1 : err < -0.05 ? -1 : 0;
      // Re-check the live trace before pulling the trigger: the solution was computed a few steps and
      // a small turn ago, and a shot that now comes back to us first is never taken.
      if (level > 0 && shotHits(w, id, t.a, level === 2 ? 3 : 1) === -2) {
        memory.shot = null;
      } else if (ownShellIn(w, id, memory.shotTime + 0.15)) {
        // Wait for the last shell to land: firing again down a line that comes back on itself
        // just cancels the shell already on its way.
      } else if (level === 0 ? rng() < 0.5 : true) {
        input.fire = true;
      }
    }
    if (level === 0 && rng() < 0.02) memory.reactAt = now + 0.45;
    return input;
  }

  return steerTo(t, memory.ax, memory.ay, memory.bx, memory.by);
}
