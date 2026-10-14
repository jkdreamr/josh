// A careful pair of souls that climbs the tower by taking turns, the way a solo player swaps between them. Shared by
// the tests and by debugging scripts.
import { CHAIN_L, DIR, JUMP_V, MAX_RISE, R_CORE, SPRING_V, angDiff, buildLevel, pose, reach } from '../src/os/arcade/games/chained/level.ts';
import { createGame, crumbleState, step, type Game, type Input, type Soul } from '../src/os/arcade/games/chained/logic.ts';

export const DT = 1 / 60;
const idle: Input = { side: 0, fwd: 0, jump: false, hold: false };
const arcOf = (s: { x: number; z: number }) => Math.atan2(s.z, s.x);

export type Bot = { active: number; last: number[]; holdUntil: number; sinceSwap: number; jumpedAt: number };

/** Which route step a soul is on (the last ledge it stood on). */
export function stepOf(g: Game, s: Soul, bot: Bot) {
  if (s.grounded && s.ground >= 0) {
    const p = g.level.platforms[s.ground];
    if (p.seq >= 0) bot.last[s.idx] = p.seq;
  }
  return bot.last[s.idx];
}

export function drive(g: Game, bot: Bot): void {
  const me = g.souls[bot.active];
  const other = g.souls[1 - bot.active];
  const myStep = stepOf(g, me, bot);
  const otherStep = stepOf(g, other, bot);
  bot.sinceSwap += DT;
  for (const s of g.souls) s.input = { ...idle };
  // the lower soul climbs; a soul left hanging gets hauled by the one still standing; nobody waits on a
  // crumbling ledge; and nobody is handed over while still sliding (on ice it would slide off the end)
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
    bot.active = other.idx;
    bot.sinceSwap = 0;
    return true;
  };
  if (bot.sinceSwap > 0.4) {
    if (me.hanging && other.grounded) {
      bot.active = other.idx;
      bot.sinceSwap = 0;
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
    me.input = { side, fwd, jump: false, hold: g.time < bot.holdUntil };
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
  // the air between here and the target's near edge; the tower never asks for more than 0.72 of a jump's reach
  const air = dist - 0.9;
  const canReach = rise <= (launch > JUMP_V ? 4.3 : MAX_RISE + 0.05) && air <= reach(Math.max(0, rise), launch) * (edge < 0.5 ? 0.95 : 0.78) && dist > -0.4;
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
  if (other.grounded && !other.hanging && here.kind !== 'crumble' && follow(beyond) > CHAIN_L - 0.8 && follow(beyond) > mine + 1 && bot.sinceSwap > 0.4) {
    handOver();
    return;
  }
  const jump = canReach && (speed > 4.5 || dist < 0.6 || edge < 0.5) && (edge < 1.6 || dist < 2.2);
  if (target.kind === 'lift' || target.kind === 'swing' || here.kind === 'lift' || here.kind === 'swing') {
    // wait right at the edge for the ride to line up
    const wait = !canReach && edge < 1.2;
    me.input = { side: wait ? (edge > 0.4 ? 1 : edge < 0.15 ? -1 : 0) : 1, fwd, jump, hold: true };
  } else {
    // never walk off the end: stop short if the jump is not on yet, and on ice start braking well before the end
    let side: -1 | 0 | 1 = dist > 0.15 ? (edge < 0.45 && !jump ? 0 : 1) : dist < -0.6 ? -1 : 0;
    if (here.kind === 'ice' && !jump && side === 1 && edge < 3.2 && speed > 2 && !canReach) side = -1;
    me.input = { side, fwd, jump, hold: true };
  }
  // one press per jump, like a thumb on a key, never a held button that re-fires on landing
  if (jump && g.time - bot.jumpedAt < 0.35) me.input.jump = false;
  else if (jump) {
    bot.jumpedAt = g.time;
    bot.holdUntil = g.time + 0.3;
  }
}

export function climb(mode: 'normal' | 'beginner' | 'lava', limit = 900, onStuck?: (g: Game, bot: Bot) => void) {
  const lv = buildLevel();
  const g = createGame({ mode, souls: [0, 1].map((seat) => ({ seat, name: `p${seat}`, color: '#fff', kind: 'local' as const })), countdown: 0, level: lv, solo: true });
  const bot: Bot = { active: 0, last: [0, 0], holdUntil: 0, sinceSwap: 0, jumpedAt: -9 };
  let bestStep = 0;
  // progress is the pair's top step going up, counting again after a fall
  let mark = 0;
  let lastProgress = 0;
  while (g.won === null && !g.lost && g.time < limit) {
    drive(g, bot);
    step(g, DT);
    const top = Math.max(bot.last[0], bot.last[1]);
    bestStep = Math.max(bestStep, top);
    if (top > mark || top < mark - 2) {
      mark = top;
      lastProgress = g.time;
    }
    if (g.time - lastProgress > 60) {
      const where = g.souls.map((s) => `${s.idx}: step ${bot.last[s.idx]} ${lv.route[bot.last[s.idx]].kind} y ${s.y.toFixed(1)} r ${Math.hypot(s.x, s.z).toFixed(1)} grounded ${s.grounded} hanging ${s.hanging}`);
      const next = lv.route[bestStep + 1];
      onStuck?.(g, bot);
      throw new Error(`stuck at step ${bestStep} (${lv.route[bestStep].kind} at ${lv.route[bestStep].y.toFixed(1)} m), next ${next?.kind} at ${next?.y.toFixed(1)} m\n${where.join('\n')}`);
    }
  }
  return { g, time: g.time, bestStep, lv };
}

