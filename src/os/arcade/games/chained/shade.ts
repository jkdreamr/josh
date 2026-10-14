// The shades: the pair of souls the game itself climbs with in a race, and the careful pair the tests climb with.
//
// A shade team climbs the way a solo player does, one soul at a time: the lower soul climbs, a soul left hanging
// gets hauled by the one still standing, nobody waits on a crumbling ledge, and nobody is handed over while still
// sliding on ice. The easier settings run slower, hesitate at every edge and take their time to swap. Everything is
// seeded, so the same race plays out the same way on the host and in the tests.
import { CHAIN_L, DIR, JUMP_V, MAX_RISE, R_CORE, RUN, SPRING_V, angDiff, buildLevel, mulberry, pose, reach } from './level.ts';
import { createGame, crumbleState, step, type Game, type Input, type Mode, type Soul } from './logic.ts';

export const DT = 1 / 60;
const idle: Input = { side: 0, fwd: 0, jump: false, hold: false };
const arcOf = (s: { x: number; z: number }) => Math.atan2(s.z, s.x);

export type ShadeLevel = 'slow' | 'even' | 'swift';
export const SHADE_LEVELS = ['slow', 'even', 'swift'] as const;
export const isShadeLevel = (v: unknown): v is ShadeLevel => (SHADE_LEVELS as readonly string[]).includes(v as string);
/** How the shades climb on each setting: run speed as a share of a full run, seconds of dithering at an edge, extra seconds before a swap. */
export const SHADE_INFO: Record<ShadeLevel, { label: string; blurb: string; pace: number; hesitate: number; swap: number }> = {
  slow: { label: 'Slow', blurb: 'The shades dawdle at every edge. A first race.', pace: 0.84, hesitate: 0.9, swap: 0.6 },
  even: { label: 'Even', blurb: 'The shades climb about as fast as a steady player.', pace: 0.92, hesitate: 0.35, swap: 0.3 },
  swift: { label: 'Swift', blurb: 'The shades never hesitate. Beat them and you have earned it.', pace: 1, hesitate: 0, swap: 0 },
};
export const SHADE_NAMES = ['Cinder', 'Soot'];

export type Shade = {
  team: number;
  /** The soul being steered (a soul index). */
  active: number;
  /** The route step each soul last stood on, by soul index. */
  last: number[];
  holdUntil: number;
  sinceSwap: number;
  jumpedAt: number;
  /** No jump before this time: the pause at an edge on the easier settings. */
  readyAt: number;
  hesitate: number;
  swapWait: number;
  grounded: boolean;
  rng: () => number;
};

export function createShade(g: Game, team: number, level: ShadeLevel = 'swift', seed = 7): Shade {
  const info = SHADE_INFO[level];
  return {
    team,
    active: g.chains[team][0],
    last: g.souls.map(() => 0),
    holdUntil: 0,
    sinceSwap: 0,
    jumpedAt: -9,
    readyAt: -9,
    hesitate: info.hesitate,
    swapWait: info.swap,
    grounded: true,
    rng: mulberry(seed * 7919 + team * 131),
  };
}

/** Gives every team of shade souls a shade to drive it, run from inside step(). Returns them, for the tests. */
export function attachShades(g: Game, level: ShadeLevel, seed = 7): Shade[] {
  const shades: Shade[] = [];
  for (let team = 0; team < g.teams; team++) {
    const souls = g.chains[team].map((i) => g.souls[i]);
    if (!souls.length || !souls.every((s) => s.driver === 'shade' && s.kind === 'local')) continue;
    shades.push(createShade(g, team, level, seed));
  }
  if (shades.length) g.drivers.push((game, dt) => shades.forEach((sh) => driveShade(game, sh, dt)));
  return shades;
}

/** Which route step a soul is on (the last ledge it stood on). */
export function stepOf(g: Game, s: Soul, sh: Shade) {
  if (s.grounded && s.ground >= 0) {
    const p = g.level.platforms[s.ground];
    if (p.seq >= 0) sh.last[s.idx] = p.seq;
  }
  return sh.last[s.idx];
}

/** Decides this frame's inputs for the two souls of a shade team. Touches no other soul. */
export function driveShade(g: Game, sh: Shade, dt: number): void {
  const chain = g.chains[sh.team];
  if (chain.length < 2) return;
  const me = g.souls[sh.active];
  const other = g.souls[chain[0] === sh.active ? chain[1] : chain[0]];
  const myStep = stepOf(g, me, sh);
  const otherStep = stepOf(g, other, sh);
  sh.sinceSwap += dt;
  me.input = { ...idle };
  other.input = { ...idle };
  // landing: a pause before the next jump on the easier settings, like a thumb finding the key again
  if (me.grounded && !sh.grounded) sh.readyAt = g.time + sh.hesitate * (0.5 + sh.rng());
  sh.grounded = me.grounded;
  const ready = g.time >= sh.readyAt;
  const onCrumble = (s: Soul) => s.grounded && s.ground >= 0 && g.level.platforms[s.ground].kind === 'crumble';
  const mySpeed = Math.hypot(me.vx, me.vz);
  const onward = (s: Soul) => {
    const rr = Math.hypot(s.x, s.z) || 1;
    return s.vx * (s.z / rr) - s.vz * (s.x / rr);
  };
  const brake = (s: Soul): Input => ({ side: onward(s) > 0 ? -1 : 1, fwd: 0, jump: false, hold: false });
  const handOver = () => {
    if (me.grounded && mySpeed > 1.2 && me.ground >= 0 && g.level.platforms[me.ground].kind === 'ice') {
      me.input = brake(me);
      return false;
    }
    sh.active = other.idx;
    sh.sinceSwap = 0;
    sh.grounded = other.grounded;
    sh.readyAt = g.time + sh.hesitate * 0.5;
    return true;
  };
  const swapOk = sh.sinceSwap > 0.4 + sh.swapWait;
  if (swapOk) {
    if (me.hanging && other.grounded) {
      handOver();
      return;
    }
    if (onCrumble(other) && !onCrumble(me) && me.grounded) {
      handOver();
      return;
    }
    if (!other.hanging && otherStep < myStep && other.grounded && me.grounded && !onCrumble(me)) {
      handOver();
      return;
    }
    // on the same ledge but the chain is nearly out: bring the other one forward first
    const apart = Math.hypot(me.x - other.x, me.y - other.y, me.z - other.z);
    if (otherStep <= myStep && other.grounded && me.grounded && apart > CHAIN_L - 1.2 && !onCrumble(me)) {
      handOver();
      return;
    }
  }
  if (!me.grounded) {
    // in the air: steer for the landing spot of the next ledge (a spring throws you past it otherwise)
    const next = g.level.route[Math.min(g.level.route.length - 1, myStep + 1)];
    const nq = pose(next, g.time);
    const rr = Math.max(1, Math.hypot(me.x, me.z));
    const land = nq.a - DIR * next.span + DIR * (0.9 / rr);
    const ahead = angDiff(land, arcOf(me)) * DIR * rr;
    // brake in the air once the landing spot is within stopping distance, so short ledges are not overshot
    const v = me.vx * (me.z / rr) - me.vz * (me.x / rr);
    const stop = (v * v) / (2 * 18);
    const side: -1 | 0 | 1 = me.hanging ? 0 : ahead > stop + 0.25 ? 1 : ahead < -0.25 || v > 1.5 ? -1 : 0;
    const fwd: -1 | 0 | 1 = rr > next.r0 + 1.4 ? 1 : rr < next.r0 + 0.8 ? -1 : 0;
    me.input = { side, fwd, jump: false, hold: g.time < sh.holdUntil };
    return;
  }
  if (other.hanging) {
    // haul: walk onwards and inwards, away from the edge
    me.input = { side: 1, fwd: Math.hypot(me.x, me.z) > R_CORE + 1.0 ? 1 : 0, jump: false, hold: false };
    return;
  }
  const target = g.level.route[Math.min(g.level.route.length - 1, myStep + 1)];
  if (target.seq <= myStep) return;
  const q = pose(target, g.time);
  const r = Math.hypot(me.x, me.z);
  const myA = arcOf(me);
  // land a stride past the near edge
  const landing = q.a - DIR * target.span + DIR * ((target.kind === 'spring' ? 0.6 : 0.9) / Math.max(r, 1));
  const ahead = angDiff(landing, myA) * DIR; // radians onwards to the landing point
  const dist = ahead * r;
  const rise = q.y - me.y;
  const wantR = target.r0 + 1.1;
  const fwd: -1 | 0 | 1 = r > wantR + 0.25 ? 1 : r < wantR - 0.25 ? -1 : 0;
  const here = g.level.platforms[me.ground];
  const launch = here.kind === 'spring' ? SPRING_V : JUMP_V;
  const hq = pose(here, g.time);
  const edge = angDiff(hq.a + DIR * here.span, myA) * DIR * r; // metres to the far edge of this ledge
  const speed = Math.hypot(me.vx, me.vz);
  // the air between here and the target's near edge; the tower never asks for more than 0.72 of a full jump's reach
  const air = dist - 0.9;
  const canReach = rise <= (launch > JUMP_V ? 4.3 : MAX_RISE + 0.05) && air <= reach(Math.max(0, rise), launch, RUN * me.pace) * (edge < 0.5 ? 0.95 : 0.78) && dist > -0.4;
  // a crumbled ledge is not there to land on: wait at the edge for it to come back
  if (target.kind === 'crumble' && crumbleState(g, target.id).phase !== 'none') {
    me.input = { side: edge < 0.6 ? -1 : edge < 1.2 ? 0 : 1, fwd, jump: false, hold: false };
    return;
  }
  // the chain: never land somewhere the other soul cannot follow from where it stands (the ledge after a crumbling
  // one counts, since nobody waits on those); bring it forward instead
  const landAt = (p: typeof target, pq: ReturnType<typeof pose>) => {
    const la = pq.a - DIR * p.span + DIR * (0.9 / Math.max(r, 1));
    const lr = p.r0 + 1.1;
    return { x: Math.cos(la) * lr, y: pq.y, z: Math.sin(la) * lr };
  };
  const follow = (p: typeof target) => {
    const at = landAt(p, pose(p, g.time));
    return Math.hypot(at.x - other.x, at.y - other.y, at.z - other.z);
  };
  const beyond = target.kind === 'crumble' ? g.level.route[Math.min(g.level.route.length - 1, target.seq + 1)] : target;
  const mine = (() => {
    const at = landAt(beyond, pose(beyond, g.time));
    return Math.hypot(at.x - me.x, at.y - me.y, at.z - me.z);
  })();
  if (other.grounded && !other.hanging && here.kind !== 'crumble' && follow(beyond) > CHAIN_L - 0.8 && follow(beyond) > mine + 1 && swapOk) {
    handOver();
    return;
  }
  const jump = ready && canReach && (speed > 4.5 || dist < 0.6 || edge < 0.5) && (edge < 1.6 || dist < 2.2);
  if (target.kind === 'lift' || target.kind === 'swing' || here.kind === 'lift' || here.kind === 'swing') {
    // wait right at the edge for the ride to line up
    const wait = !(canReach && ready) && edge < 1.2;
    me.input = { side: wait ? (edge > 0.4 ? 1 : edge < 0.15 ? -1 : 0) : 1, fwd, jump, hold: true };
  } else {
    // never walk off the end: stop short if the jump is not on yet, and on ice start braking well before the end
    let side: -1 | 0 | 1 = dist > 0.15 ? (edge < 0.45 && !jump ? 0 : 1) : dist < -0.6 ? -1 : 0;
    if (here.kind === 'ice' && !jump && side === 1 && edge < 3.2 && speed > 2 && !(canReach && ready)) side = -1;
    me.input = { side, fwd, jump, hold: true };
  }
  // one press per jump, like a thumb on a key, never a held button that re-fires on landing
  if (jump && g.time - sh.jumpedAt < 0.35) me.input.jump = false;
  else if (jump) {
    sh.jumpedAt = g.time;
    sh.holdUntil = g.time + 0.3;
  }
}

/** The tests' careful pair: two souls on one chain, climbed like a solo player, at full pace. */
export function climb(mode: Mode, limit = 900, onStuck?: (g: Game, sh: Shade) => void) {
  const lv = buildLevel();
  const g = createGame({ mode, souls: [0, 1].map((seat) => ({ seat, name: `p${seat}`, color: '#fff', kind: 'local' as const })), countdown: 0, level: lv, solo: true });
  const sh = createShade(g, 0, 'swift');
  let bestStep = 0;
  // progress is the pair's top step going up, counting again after a fall
  let mark = 0;
  let lastProgress = 0;
  while (g.won === null && !g.lost && g.time < limit) {
    driveShade(g, sh, DT);
    step(g, DT);
    const top = Math.max(sh.last[0], sh.last[1]);
    bestStep = Math.max(bestStep, top);
    if (top > mark || top < mark - 2) {
      mark = top;
      lastProgress = g.time;
    }
    if (g.time - lastProgress > 60) {
      const where = g.souls.map((s) => `${s.idx}: step ${sh.last[s.idx]} ${lv.route[sh.last[s.idx]].kind} y ${s.y.toFixed(1)} r ${Math.hypot(s.x, s.z).toFixed(1)} grounded ${s.grounded} hanging ${s.hanging}`);
      const next = lv.route[bestStep + 1];
      onStuck?.(g, sh);
      throw new Error(`stuck at step ${bestStep} (${lv.route[bestStep].kind} at ${lv.route[bestStep].y.toFixed(1)} m), next ${next?.kind} at ${next?.y.toFixed(1)} m\n${where.join('\n')}`);
    }
  }
  return { g, time: g.time, bestStep, lv };
}
