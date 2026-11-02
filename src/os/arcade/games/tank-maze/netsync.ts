// Tank Maze's online play apart from the screen: how a guest drives its own tank and fires its own shots here and now,
// how the host takes its word for them, and where a guest shows everything else. Pure (no React, no DOM), so tests can
// run a host and a guest over a slow link.
//
// A guest's own tank. The guest drives it itself, straight away, on the host's physics (driveTank), and every input it
// sends says where the tank is. The host takes that word unless the game has moved the tank since (a new round: the
// tank's warp went up), and only as far as the tank could have gone: the word may move it at most a budget that refills
// a little faster than top speed (and turning speed), and the host drives its copy there in short hops, so a word never
// carries a tank through a wall. Should its copy still end up far from the word, the host moves the warp on and the
// guest takes the host's pose. Between words the host carries the tank on by its input, so the others see it move
// smoothly. A word that took longer than the quickest to arrive (the guest's inputs carry its clock) is carried on by its
// driving for the difference, so the host's copy keeps a steady distance behind the guest rather than jumping back
// whenever a word is late. Tanks barely push each other (half the overlap each way): a guest shoves itself off the
// tanks it sees, and the host shoves its copy off the tanks as they are now, rather than letting a word made from a
// stale view push someone else's tank.
//
// A guest's own shots. The guest fires at once, from its own barrel, as the host would: the shell (or fan, beam, mine)
// shows and sounds straight away and flies here on the host's physics. The input says the pose it fired from, rounded
// as the packet carries it, and the host fires that shot from there once its own cooldown allows (if the pose is near
// where it has the tank, with no wall between), so both shells fly the same path, the host's a round trip behind. The
// host judges every hit: a guest's shell that touches a tank here only hides until the host's word on it, and goes when
// the host's shell is gone. The host tags each shell with the fire count of the guest shot that made it, so the guest
// knows which is which, and a shot the host turned down (or sent another way) gives way to the host's own.
//
// Everything else. A guest shows other tanks, shells and mines on the host's clock (each state's tick), a little behind
// the newest word (INTERP) so there is nearly always a state either side to ease between, and lets the host's events
// (explosions, bounces, muzzle flashes) happen as that clock reaches them. The least delayed state sets the clock; it
// drifts up slowly so a slower link is followed too. (Pickups go by the newest state, so one the guest's own tank took
// goes as soon as the host says so, and the events about the guest's own tank happen as they arrive.)
import {
  DIR_TURN,
  FIRE_CD,
  FWD,
  IMMUNE,
  LASER_BOUNCES,
  LASER_LEN,
  SHELL_LIFE,
  SHELL_R,
  TANK_R,
  driveTank,
  mineDrop,
  moveShell,
  pushOut,
  shotShells,
  traceShot,
  type GameEvent,
  type Maze,
  type Pose,
  type Shell,
  type Special,
  type Tank,
  type TankInput,
  type World,
} from './logic.ts';
import { wirePose, type InputPacket, type NetEvent, type NetMine, type NetPickup, type NetShell, type NetTank, type StatePacket } from './net.ts';

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const posePart = (p: Pose): Pose => ({ x: p.x, y: p.y, a: p.a });

// -----------------------------------------------------------------------------------------------------------------
// Host: taking a guest's word

/** A guest's word may move its tank this far (cells) and turn it this much (radians) at once; both refill at a touch over top speed. */
const REACH_MAX = FWD * 0.75 + 0.2;
const SWING_MAX = DIR_TURN * 0.3 + 0.3;
const REFILL = 1.1;
/** The host drives its copy toward a guest's word in hops this long, pushing it out of walls after each. */
const HOP = 0.08;
/** The host's copy ending up further than this from a guest's word moves the warp on (the guest takes the host's pose). */
const OFF_MAX = 0.35;
/** How long the host holds a guest's shot for its own cooldown before giving up on it, and how far from its copy (plus driving since) a shot may leave. */
export const SHOT_WAIT = 0.4;
const SHOT_NEAR = 0.35;
const SHOT_TURN = 1.5;
/**
 * One side's clock against the other's (the host's reading of a guest's, a guest's of the host's): how fast it follows
 * a link that got slower (per message), and how far off it may be before it just jumps. And the most a late word is carried on.
 */
const DRIFT = 0.02;
const RESYNC = 0.5;
const LATE_MAX = 0.25;
const STEP = 1 / 60;
/** An input this far behind the newest heard is from a guest that started counting again, not one overtaken on the way. */
const RESTART = 64;

/** What the host keeps about one guest's driving: its latest word, the shots it still owes it, and how far the word may still move the tank. */
export type Driver = {
  turn: -1 | 0 | 1;
  move: -1 | 0 | 1;
  dir?: number;
  aim?: number;
  /** The newest fire count heard, and the newest the host has dealt with (fired, or given up on). */
  fc: number;
  done: number;
  /** The newest input heard (older ones, overtaken on the fast channel, are dropped); -1 for guests that send none. */
  seq: number;
  /** Any input heard yet (a guest's count from before the first is history, not a shot to fire). */
  heard: boolean;
  /** Newer guests: where they say their tank is (not taken yet), the warp they say it for, and how much later than the quickest that word came (seconds). */
  pose: Pose | null;
  warp: number;
  late: number;
  /** Host time minus the guest's for its least delayed word (null before any). */
  clock: number | null;
  /** Newer guests' shots still to fire: the pose each left from, and when (host seconds) the host heard of it. */
  shots: { fc: number; from: Pose; at: number }[];
  /** The last pose taken on the guest's word, the budgets left, and when they were last topped up. */
  last: Pose | null;
  reach: number;
  swing: number;
  at: number;
};

export const newDriver = (now: number): Driver => ({ turn: 0, move: 0, fc: 0, done: 0, seq: -1, heard: false, pose: null, warp: 0, late: 0, clock: null, shots: [], last: null, reach: REACH_MAX, swing: SWING_MAX, at: now });

/** A new round: the tank was moved, so nothing the guest said about the last one counts. */
export function resetDriver(d: Driver, now: number) {
  d.pose = null;
  d.shots = [];
  d.done = d.fc;
  d.last = null;
  d.reach = REACH_MAX;
  d.swing = SWING_MAX;
  d.at = now;
}

/** The host hears a guest's input (host seconds `now`). */
export function hearInput(d: Driver, pkt: InputPacket, now: number) {
  if (pkt.seq !== undefined) {
    if (pkt.seq <= d.seq && pkt.seq > d.seq - RESTART) return;
    if (pkt.seq <= d.seq) d.heard = false;
    d.seq = pkt.seq;
  }
  if (!d.heard) {
    d.heard = true;
    d.done = pkt.fireCount;
  }
  d.turn = pkt.turn;
  d.move = pkt.move;
  d.dir = pkt.dir;
  d.aim = pkt.aim;
  d.fc = pkt.fireCount;
  let late = 0;
  if (pkt.time !== undefined) {
    const o = now - pkt.time / 1000;
    if (d.clock === null || o < d.clock || o - d.clock > RESYNC) d.clock = o;
    else d.clock += (o - d.clock) * DRIFT;
    late = Math.min(LATE_MAX, o - d.clock);
  }
  if (pkt.pose && pkt.warp !== undefined) {
    d.pose = pkt.pose;
    d.warp = pkt.warp;
    d.late = late;
  }
  if (pkt.shot && pkt.fireCount > d.done && !d.shots.some((s) => s.fc >= pkt.fireCount)) d.shots.push({ fc: pkt.fireCount, from: pkt.shot, at: now });
}

/** Move `p` toward (x, y) in short hops, out of the walls after each, as a tank drives there. */
function hop(m: Maze, p: { x: number; y: number; tread?: number }, x: number, y: number) {
  const n = Math.ceil(Math.hypot(x - p.x, y - p.y) / HOP);
  // (every hop the same length: a hop blocked by a wall never makes the next one longer)
  const sx = (x - p.x) / n;
  const sy = (y - p.y) / n;
  for (let i = 0; i < n; i++) {
    const ox = p.x;
    const oy = p.y;
    p.x += sx;
    p.y += sy;
    pushOut(m, p, TANK_R);
    p.x = Math.max(TANK_R, Math.min(m.cols - TANK_R, p.x));
    p.y = Math.max(TANK_R, Math.min(m.rows - TANK_R, p.y));
    if (p.tread !== undefined) p.tread += Math.hypot(p.x - ox, p.y - oy);
  }
}

/**
 * Take a guest's word on where its tank is, within its budgets, off any tank it would sit on (the guest only saw the
 * others a moment ago: where they are now is the host's to say), then carry it on by the guest's driving for as long
 * as the word was late. Returns how far from the word the host's copy ended up (before the shove and carrying it on).
 */
function takePose(w: Pick<World, 'maze' | 'tanks'>, t: Tank, d: Driver, pose: Pose, now: number): number {
  const m = w.maze;
  const dt = Math.max(0, Math.min(1, now - d.at));
  d.at = now;
  d.reach = Math.min(REACH_MAX, d.reach + FWD * REFILL * dt);
  d.swing = Math.min(SWING_MAX, d.swing + DIR_TURN * REFILL * dt);
  const from = d.last ?? posePart(t);
  const dx = pose.x - from.x;
  const dy = pose.y - from.y;
  const far = Math.hypot(dx, dy);
  const k = far > d.reach ? d.reach / far : 1;
  d.reach -= far * k;
  const turn = Math.max(-d.swing, Math.min(d.swing, wrapA(pose.a - from.a)));
  d.swing -= Math.abs(turn);
  const claim = { x: from.x + dx * k, y: from.y + dy * k, a: wrapA(from.a + turn) };
  d.last = claim;
  hop(m, t, claim.x, claim.y);
  t.a = claim.a;
  const off = Math.hypot(t.x - pose.x, t.y - pose.y);
  shoveOff(w, t.id);
  const driving: TankInput = { turn: d.turn, move: d.move, fire: false, ...(d.dir !== undefined ? { dir: d.dir } : {}), ...(d.aim !== undefined ? { aim: d.aim } : {}) };
  for (let left = d.late; left > 1e-6; left -= STEP) driveTank(m, t, driving, Math.min(STEP, left));
  return off;
}

/** Where the host fires a guest's shot from: the guest's barrel, if that was near where the host has the tank with no wall between, else the host's copy. */
function shotPose(m: Maze, t: Tank, shot: { from: Pose; at: number }, late: number, now: number): Pose {
  const from = shot.from;
  const near = SHOT_NEAR + FWD * (Math.max(0, Math.min(SHOT_WAIT, now - shot.at)) + late);
  if (Math.hypot(from.x - t.x, from.y - t.y) > near || Math.abs(wrapA(from.a - t.a)) > SHOT_TURN) return posePart(t);
  const probe = { x: t.x, y: t.y };
  hop(m, probe, from.x, from.y);
  return Math.hypot(probe.x - from.x, probe.y - from.y) < 0.02 ? from : posePart(t);
}

/**
 * The host's input for a guest's tank this step (host seconds `now`): its word on where the tank is taken first (when
 * it is for the tank's `warp`), then the guest's driving carries the tank on, and its oldest shot still owed is fired
 * if the cooldown allows. Returns the warp after (moved on when the host could not take the word) and the fire count
 * of the shot it tries, for shotFired once the step has run.
 */
export function driverInput(w: World, t: Tank, d: Driver, warp: number, now: number): { input: TankInput; warp: number; shot: number | null } {
  let next = warp;
  const play = w.phase === 'play' && t.alive;
  if (d.pose) {
    if (d.warp === warp && play && takePose(w, t, d, d.pose, now) > OFF_MAX) {
      next = warp + 1;
      d.last = posePart(t);
    }
    d.pose = null;
  }
  const input: TankInput = { turn: d.turn, move: d.move, fire: false, ...(d.dir !== undefined ? { dir: d.dir } : {}), ...(d.aim !== undefined ? { aim: d.aim } : {}) };
  while (d.shots.length && (d.shots[0].fc <= d.done || !play || now - d.shots[0].at > SHOT_WAIT)) d.done = Math.max(d.done, d.shots.shift()!.fc);
  const shot = d.shots[0];
  if (shot) {
    input.fire = true;
    input.from = shotPose(w.maze, t, shot, d.late, now);
    return { input, warp: next, shot: shot.fc };
  }
  // (an older guest: once per increment, from wherever the host has the tank)
  if (d.fc > d.done) {
    input.fire = true;
    d.done = d.fc;
  }
  return { input, warp: next, shot: null };
}

/** After the step: if tank `id` fired the shot driverInput tried, it is dealt with. Returns its fire count (to tag the shells it made), or null. */
export function shotFired(w: World, id: number, d: Driver, shot: number | null): number | null {
  if (shot === null || !w.events.some((e) => (e.k === 'fire' || e.k === 'laser' || e.k === 'mine') && e.id === id)) return null;
  if (d.shots[0]?.fc === shot) d.shots.shift();
  d.done = Math.max(d.done, shot);
  return shot;
}

// -----------------------------------------------------------------------------------------------------------------
// Guest: its own tank and shots

/** How much of a shot's path a guest keeps (steps), to check the host's shell runs along it, and how near it must be. */
const TRAIL = 90;
const TRAIL_NEAR = 0.12;
/** A hidden shell shows again once the host's has flown this far (seconds) past where it touched the tank here and is still out. */
const TOUCH_PAST = 0.08;
/** A shot the host never answers for goes after this long; a predicted mine shows this long at most. */
const SHOT_LOST = 2;
const MINE_SHOW = 1.5;
/** How long the host's copy of a shell of ours that is gone stays undrawn (it trails the newest word by INTERP). */
const SPENT = 0.5;

/** One of a guest's own shells, flying here ahead of the host's. */
export type Shot = {
  /** The fire count that made it, and its place in that shot's fan. */
  fc: number;
  k: number;
  s: Shell;
  /** Where it has been lately (x, y, age triples, newest last). */
  trail: number[];
  /** The host's id for it, once a state shows it. */
  host: number | null;
  /** Its age when it touched a tank here: it stays out of sight until the host's word on it. */
  hidden: number | null;
  born: number;
};

export type Own = {
  /** The host takes a guest's word on its tank (its states carry warps); until then the guest is shown the host's. */
  active: boolean;
  warp: number;
  /** Shots fired here, the pose the latest left from, and the newest the host says it has dealt with. */
  fc: number;
  shot: Pose | null;
  done: number;
  seq: number;
  shots: Shot[];
  nextShot: number;
  /** The host's ids for shells of ours it no longer has, and when we heard: their copies a moment behind are not drawn either. */
  spent: Map<number, number>;
  /** Mines dropped here, shown until the host's turn up. */
  mines: { x: number; y: number; at: number }[];
  /** When (local seconds) the latest laser left here: the host's beam for it is not drawn twice. */
  laserAt: number;
  /** Inputs sent lately, and the round trips the host's echo of them has timed (seconds; nothing steers by them, they are there to look at). */
  sent: { seq: number; at: number }[];
  rtts: number[];
};

/** A guest's own state for a new match; its counts carry on from the last (`prev`), so the host never hears one go back. */
export const newOwn = (prev?: Own): Own => ({ active: false, warp: -1, fc: prev?.fc ?? 0, shot: null, done: prev?.fc ?? 0, seq: prev?.seq ?? 0, shots: [], nextShot: 1, spent: new Map(), mines: [], laserAt: -1e9, sent: [], rtts: prev?.rtts.slice() ?? [] });

/**
 * A new round (or a world rebuilt from the host's): the tank was placed afresh, and no shot from before is still out.
 * `warp` is the tank's from the host's round packet; without one (-1) the host's next state places the tank.
 */
export function ownRound(own: Own, warp: number | undefined) {
  own.active = warp !== undefined && warp >= 0;
  own.warp = warp ?? -1;
  own.done = own.fc;
  own.shots = [];
  own.spent.clear();
  own.mines = [];
}

/** The fields a guest's input adds about its own tank (and remembers when it sent them). */
export function ownReport(own: Own, t: Tank, now: number): Pick<InputPacket, 'seq' | 'pose' | 'warp' | 'time' | 'shot' | 'fireCount'> {
  const seq = ++own.seq;
  own.sent.push({ seq, at: now });
  if (own.sent.length > 40) own.sent.shift();
  return { seq, fireCount: own.fc, time: now * 1000, ...(own.active ? { pose: wirePose(t), warp: own.warp } : {}), ...(own.shot ? { shot: own.shot } : {}) };
}

export type OwnStep = { fired: 'shell' | 'laser' | 'mine' | null; beam?: number[]; bounces: { x: number; y: number }[] };

/**
 * One step of a guest's own tank, as the host will run it: drive (unless the round is not in play here), shove off the
 * tanks it sees, fire, then fly its shells. `w.tanks` is what the guest sees, its own tank (`me`) included.
 */
export function ownStep(own: Own, w: Pick<World, 'maze' | 'tanks'>, me: number, input: TankInput, dt: number, play: boolean, now: number): OwnStep {
  const out: OwnStep = { fired: null, bounces: [] };
  const t = w.tanks[me];
  if (!t) return out;
  t.cooldown = Math.max(0, t.cooldown - dt);
  t.recoil = Math.max(0, t.recoil - dt * 6);
  if (play && t.alive) {
    driveTank(w.maze, t, input, dt);
    shoveOff(w, me);
    if (input.fire && t.cooldown <= 0) fireOwn(own, w, t, now, out);
  }
  flyShots(own, w, me, dt, now, out);
  return out;
}

/** Push tank `me` off any tank it sits on, moving only itself (the host's step pushes both half way). */
function shoveOff(w: Pick<World, 'maze' | 'tanks'>, me: number) {
  const t = w.tanks[me];
  for (const o of w.tanks) {
    if (o.id === me || !o.alive) continue;
    const dx = t.x - o.x;
    const dy = t.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= TANK_R * 2 || d < 1e-6) continue;
    t.x += (dx / d) * (TANK_R * 2 - d);
    t.y += (dy / d) * (TANK_R * 2 - d);
    pushOut(w.maze, t, TANK_R);
  }
}

function fireOwn(own: Own, w: Pick<World, 'maze' | 'tanks'>, t: Tank, now: number, out: OwnStep) {
  // (the pose as the packet will carry it, so the host's shot leaves from exactly here)
  const from = wirePose(t);
  own.fc++;
  own.shot = from;
  t.cooldown = FIRE_CD;
  if (t.special === 'laser') {
    t.special = null;
    t.recoil = 1;
    out.fired = 'laser';
    out.beam = traceShot(w, from.x, from.y, from.a, LASER_BOUNCES, LASER_LEN, t.id).pts;
    own.laserAt = now;
    return;
  }
  if (t.special === 'mine') {
    t.special = null;
    out.fired = 'mine';
    own.mines.push({ ...mineDrop(w.maze, from), at: now });
    return;
  }
  if (t.special === 'triple') {
    t.fans = 3;
    t.special = null;
  }
  const shot = shotShells(w.maze, from, t.fans > 0);
  const volley = shot.shells.length > 1 ? own.nextShot : 0;
  shot.shells.forEach((s, k) => {
    if (own.shots.length >= shot.cap) return;
    own.shots.push({ fc: own.fc, k, s: { id: own.nextShot++, owner: t.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, age: 0, volley }, trail: [s.x, s.y, 0], host: null, hidden: null, born: now });
  });
  if (t.fans > 0) t.fans--;
  t.recoil = 1;
  out.fired = 'shell';
}

function flyShots(own: Own, w: Pick<World, 'maze' | 'tanks'>, me: number, dt: number, now: number, out: OwnStep) {
  const events: GameEvent[] = [];
  const fx = { maze: w.maze, events };
  for (const shot of own.shots) {
    shot.s.age += dt;
    moveShell(fx, shot.s, dt);
    shot.trail.push(shot.s.x, shot.s.y, shot.s.age);
    if (shot.trail.length > TRAIL * 3) shot.trail.splice(0, 3);
  }
  for (const e of events) if (e.k === 'bounce') out.bounces.push({ x: e.x, y: e.y });
  own.shots = own.shots.filter((shot) => shot.s.age <= SHELL_LIFE);
  // A shell that reaches a tank here (ours once it is clear of the barrel), or another of ours, hides until the host says.
  const reach = (TANK_R + SHELL_R) ** 2;
  for (const shot of own.shots) {
    if (shot.hidden !== null) continue;
    for (const tk of w.tanks) {
      if (!tk.alive || (tk.id === me && shot.s.age < IMMUNE)) continue;
      if ((tk.x - shot.s.x) ** 2 + (tk.y - shot.s.y) ** 2 < reach) {
        shot.hidden = shot.s.age;
        break;
      }
    }
  }
  for (let i = 0; i < own.shots.length; i++) {
    for (let j = i + 1; j < own.shots.length; j++) {
      const a = own.shots[i].s;
      const b = own.shots[j].s;
      if ((a.volley !== 0 && a.volley === b.volley) || (a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (SHELL_R * 2) ** 2) continue;
      own.shots[i].hidden ??= a.age;
      own.shots[j].hidden ??= b.age;
    }
  }
}

/** How far (x, y) is from a shot's trail, and how old the shot was at the nearest point of it. */
function onTrail(trail: number[], x: number, y: number): { off: number; age: number } {
  let off = Math.hypot(x - trail[0], y - trail[1]);
  let age = trail[2];
  for (let i = 0; i + 5 < trail.length; i += 3) {
    const lx = trail[i + 3] - trail[i];
    const ly = trail[i + 4] - trail[i + 1];
    const l2 = lx * lx + ly * ly;
    const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - trail[i]) * lx + (y - trail[i + 1]) * ly) / l2)) : 0;
    const d = Math.hypot(x - (trail[i] + lx * f), y - (trail[i + 1] + ly * f));
    if (d <= off) {
      off = d;
      age = trail[i + 2] + (trail[i + 5] - trail[i + 2]) * f;
    }
  }
  return { off, age };
}

/**
 * A guest hears a state from the host (newer than any before it; local seconds `now`) about its own tank `t` (tank
 * `me`): the round trip it closes, the shots the host has dealt with, and whether the host moved the tank (its warp
 * went up: the guest takes the host's pose, and says so). Its shells are matched to the host's, and the ones the host
 * no longer has (or sent another way) go. Returns whether the tank was moved.
 */
export function ownHear(own: Own, t: Tank, me: number, pkt: StatePacket, now: number): boolean {
  own.active = !!pkt.warps;
  if (!pkt.warps) return false;
  const seq = pkt.seqs?.[me];
  const sent = own.sent.findIndex((s) => s.seq === seq);
  if (sent >= 0) {
    own.rtts.push(now - own.sent[sent].at);
    if (own.rtts.length > 20) own.rtts.shift();
    own.sent.splice(0, sent + 1);
  }
  own.done = Math.max(own.done, pkt.acks?.[me] ?? 0);
  const host = pkt.tanks[me];
  let moved = false;
  if (host) {
    if (pkt.warps[me] !== own.warp) {
      own.warp = pkt.warps[me];
      t.x = host.x;
      t.y = host.y;
      t.a = host.a;
      moved = true;
    }
    t.alive = host.alive;
    // (the host's word on our special counts once it has dealt with every shot we fired)
    if (own.done >= own.fc && host.special !== t.special) {
      if (host.special) t.fans = 0;
      t.special = host.special;
    }
  }
  const ours = pkt.shells.filter((s): s is NetShell & { id: number } => s.owner === me && s.id !== undefined);
  for (const [id, at] of own.spent) if (now - at > SPENT) own.spent.delete(id);
  own.shots = own.shots.filter((shot) => {
    if (shot.host === null) {
      const fan = ours.filter((s) => s.tag === shot.fc).sort((a, b) => a.id - b.id);
      const mate = fan[shot.k];
      if (mate) shot.host = mate.id;
      // (the host dealt with that shot and has no shell for it: turned down, or gone before any state showed it)
      else return shot.fc > own.done && now - shot.born < SHOT_LOST;
    }
    const mate = ours.find((s) => s.id === shot.host);
    if (!mate) {
      own.spent.set(shot.host!, now);
      return false;
    }
    const on = onTrail(shot.trail, mate.x, mate.y);
    if (on.off > TRAIL_NEAR) return false;
    // (the host's shell has flown on past where this one touched a tank here: it missed)
    if (shot.hidden !== null && on.age > shot.hidden + TOUCH_PAST) shot.hidden = null;
    return true;
  });
  return moved;
}

/** The host's ids for the shells a guest is flying itself, or has just seen go (so the host's copies are not drawn too). */
export const covered = (own: Own) => new Set([...own.shots.flatMap((s) => (s.host === null ? [] : [s.host])), ...own.spent.keys()]);

/** Mines a guest dropped, still to show: until one of the host's lands near it, or a while has gone by. */
export function ownMines(own: Own, host: readonly { x: number; y: number }[], now: number) {
  own.mines = own.mines.filter((m) => now - m.at < MINE_SHOW && !host.some((h) => Math.hypot(h.x - m.x, h.y - m.y) < 0.2));
  return own.mines;
}

// -----------------------------------------------------------------------------------------------------------------
// Guest: everything else, on the host's clock

/** How far behind the host's newest word a guest shows the others, and how far past it a tank may be carried on. */
export const INTERP = 0.1;
const EXTRA = 0.05;
const SNAPS = 12;
/** A tank that moved further than this between two states was put there (a new round), not driven. */
const TELEPORT = 1.5;

export type Snap = { t: number; tanks: NetTank[]; shells: NetShell[]; pickups: NetPickup[]; mines: NetMine[]; beams: { owner: number; pts: number[] }[] };
export type ViewTank = { x: number; y: number; a: number; alive: boolean; special: Special | null };
export type View = { tanks: ViewTank[]; shells: NetShell[]; pickups: NetPickup[]; mines: NetMine[] };

/** A guest's states from the host, on the host's clock, and the events and beams in them still to happen. */
export class Timeline {
  snaps: Snap[] = [];
  /** Local time minus host time for the least delayed state (null until the first). */
  offset: number | null = null;
  /** States at or before this host time are from before the round now showing. */
  private floor = -Infinity;
  private due: { t: number; events: NetEvent[]; beams: Snap['beams'] }[] = [];

  /** Takes a state the host sent at host time `snap.t` that arrived at local time `now`; false for one older than what it has. */
  push(snap: Snap, events: NetEvent[], now: number): boolean {
    const last = this.snaps.at(-1);
    if (snap.t <= this.floor || (last && snap.t <= last.t)) return false;
    const o = now - snap.t;
    if (this.offset === null || o < this.offset || o - this.offset > RESYNC) this.offset = o;
    // (a link that stays slower would leave the others standing past the newest state: follow it sooner)
    else this.offset += (o - this.offset) * (o - this.offset > INTERP / 2 ? DRIFT * 5 : DRIFT);
    this.snaps.push(snap);
    if (this.snaps.length > SNAPS) this.snaps.shift();
    this.due.push({ t: snap.t, events, beams: snap.beams });
    return true;
  }

  /** A new round (states up to host time `t` are stale), or with `fresh` a new match (the host's clock starts over). */
  reset(t: number | undefined, fresh: boolean) {
    this.snaps = [];
    this.due = [];
    this.floor = fresh ? (t ?? -Infinity) : Math.max(this.floor, t ?? -Infinity);
    if (fresh) this.offset = null;
  }

  /** The host time to show at local time `now`, or null before any state. */
  at(now: number): number | null {
    return this.offset === null ? null : now - this.offset - INTERP;
  }

  /** The events and beams whose time has come by host time `at`. */
  drain(at: number): { events: NetEvent[]; beams: Snap['beams'] } {
    const events: NetEvent[] = [];
    const beams: Snap['beams'] = [];
    while (this.due.length && this.due[0].t <= at) {
      const d = this.due.shift()!;
      events.push(...d.events);
      beams.push(...d.beams);
    }
    return { events, beams };
  }

  /** Everything as it was at host time `at`, eased between the states either side (or null before any). */
  sample(at: number): View | null {
    const sn = this.snaps;
    if (!sn.length) return null;
    let older = sn[0];
    let newer = sn[0];
    for (let i = 1; i < sn.length; i++) {
      older = sn[i - 1];
      newer = sn[i];
      if (newer.t >= at) break;
    }
    const span = newer.t - older.t;
    const f = span > 0 ? Math.max(0, Math.min(1 + EXTRA / span, (at - older.t) / span)) : 1;
    const past = f >= 1;
    const tanks = newer.tanks.map((b, i): ViewTank => {
      const a = older.tanks[i] ?? b;
      if (Math.hypot(b.x - a.x, b.y - a.y) > TELEPORT) return { x: b.x, y: b.y, a: b.a, alive: b.alive, special: b.special };
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, a: a.a + wrapA(b.a - a.a) * f, alive: past ? b.alive : a.alive, special: past ? b.special : a.special };
    });
    const g = Math.min(1, f);
    const shells: NetShell[] = [];
    if (newer.shells.every((s) => s.id !== undefined) && older.shells.every((s) => s.id !== undefined)) {
      // by id: one only in the newer state was fired between the two, one only in the older is gone by the newer
      const before = new Map(older.shells.map((s) => [s.id, s]));
      for (const b of newer.shells) {
        const a = before.get(b.id);
        if (a) shells.push({ ...b, x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g });
        else if (g >= 0.5) shells.push(b);
      }
      if (g < 0.5) for (const a of older.shells) if (!newer.shells.some((b) => b.id === a.id)) shells.push(a);
    } else {
      // (an older host: no ids, so the two lists are paired in order)
      const n = Math.min(older.shells.length, newer.shells.length);
      for (let i = 0; i < n; i++) shells.push({ ...newer.shells[i], x: older.shells[i].x + (newer.shells[i].x - older.shells[i].x) * g, y: older.shells[i].y + (newer.shells[i].y - older.shells[i].y) * g });
    }
    // (pickups as the newest state has them: one our own tank took goes as soon as the host says so)
    return { tanks, shells, pickups: sn[sn.length - 1].pickups, mines: (past ? newer : older).mines };
  }
}

/**
 * The host's events, sorted for a guest showing tank `me` (-1 for a watcher): the ones about its own tank (its death,
 * its pickups) happen as they arrive, since its tank is shown as it is now; the shots it fired itself (and their
 * bounces) it has already shown when `self`; everything else waits for the host's clock.
 */
export function sortEvents(events: NetEvent[], me: number, self: boolean): { now: NetEvent[]; later: NetEvent[] } {
  const now: NetEvent[] = [];
  const later: NetEvent[] = [];
  for (const e of events) {
    if (self && e.a === me && (e.k === 'fire' || e.k === 'laser' || e.k === 'mine' || e.k === 'bounce')) continue;
    if (self && e.a === me && (e.k === 'kill' || e.k === 'pickup')) now.push(e);
    else later.push(e);
  }
  return { now, later };
}
