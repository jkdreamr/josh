// An online guest's own screen (a Mac playing the host's Mac, or anyone watching): the host's snapshots drawn on the
// host's clock, the guest's own player run on ahead of them by its own sticks, and its presses kept until the host has
// them. The host still decides everything (the ball, tackles, who has it); the guest only draws its own running before
// the host's word on it comes back, then folds that word in without a jump. Phones that steer a player on the host's
// screen draw nothing, so none of this is theirs. Pure, so tests/arcade-soccer-netplay.test.ts can play a host and a
// guest over a slow, jittery link.
import { movePlayer, nearestCarrier, restartStep, restartTaker, runFor, slideMotion, STEP, type Command, type Player, type Point, type World } from './logic.ts';
import { commandFromPacket, movePacket, type KickEvent, type MovePacket, type SnapshotPacket } from './net.ts';
import { setPieceStep } from './setpieces.ts';
import { worldMultipliers } from './ratings.ts';
import type { ControlCommand } from './input.ts';

/** The host sends a snapshot this often. */
export const SNAPSHOT_S = 0.05;
/** Every this many snapshots one also goes on the reliable channel, so a guest whose fast channel stalls still keeps up. */
export const KEYFRAME_EVERY = 10;
/** How long the host repeats a kick in its snapshots. */
export const KICK_CARRY_S = 0.3;
/** A press the host never confirms is given up after this long (the host was paused, or doesn't have the seat). */
const PRESS_REPEAT_S = 1;
/** The longest run of unconfirmed sticks the guest plays its player through; past it the host isn't taking them. */
const MAX_REPLAY_S = 0.6;
/** How quickly a correction fades into what is drawn: its time constant, and at most this fast (m/s) for a big one. */
export const FADE_S = 0.12;
const FADE_SPEED = 4;
/** A correction this big is a teleport (a restart lining everyone up), drawn at once. */
const SNAP_M = 3;
/** Older hosts send no match time, so their snapshots are drawn this long after they arrive, as before. */
const ARRIVAL_DELAY_S = 0.1;
const BALL = -1;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const turn = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
// (snapshots round their numbers, so the same kick can come back a few thousandths of a second apart)
const sameKick = (a: KickEvent, b: KickEvent) => a.playerId === b.playerId && a.action === b.action && Math.abs(a.time - b.time) < 0.02;

/**
 * The world between two snapshots, `t` of the way from a to b: positions, speeds and facing (the short way round)
 * blended, everything else as b has it. A player who moved more than 3 m (lined up for a restart) is drawn where b has him.
 * A fresh object each call, so the snapshots stay as the host sent them.
 */
export function blendWorld(a: World, b: World, t: number): World {
  const mix = (from: number, to: number) => from + (to - from) * t;
  const players = b.players.map((to, i) => {
    const from = a.players[i];
    if (!from || t >= 1 || Math.hypot(to.x - from.x, to.z - from.z) > 3) return { ...to };
    return {
      ...to, x: mix(from.x, to.x), z: mix(from.z, to.z), vx: mix(from.vx, to.vx), vz: mix(from.vz, to.vz),
      facing: turn(from.facing, to.facing, t), stamina: mix(from.stamina, to.stamina),
    };
  });
  const from = a.ball, to = b.ball;
  const ball = t >= 1 || Math.hypot(to.x - from.x, to.z - from.z) > 10 ? { ...to } : {
    ...to, x: mix(from.x, to.x), y: mix(from.y, to.y), z: mix(from.z, to.z),
    vx: mix(from.vx, to.vx), vy: mix(from.vy, to.vy), vz: mix(from.vz, to.vz),
  };
  return { ...b, players, ball };
}

/**
 * Snapshots on the host's clock. Each says when in the host's match it was taken; the least delayed one sets how far
 * the guest's clock runs ahead of the host's (drifting up slowly, so a slower connection is followed too), and the guest
 * draws behind the host by about one snapshot gap plus how late they tend to come. What is drawn moves on smoothly (up
 * to a tenth fast or slow to keep up), never goes back, and never passes the newest snapshot.
 */
export class SnapshotTimeline {
  private frames: { at: number; world: World }[] = [];
  private offset: number | null = null;
  private gap = SNAPSHOT_S;
  private late = 0;
  private arrival = false;
  private clock: number | null = null;
  private drawnAt: number | null = null;
  /** The host's match isn't moving on (paused, a card up between halves): the newest snapshots share one time. */
  stalled = false;

  get newest(): World | null {
    return this.frames[this.frames.length - 1]?.world ?? null;
  }

  /** How far behind the host's clock the guest draws. */
  delay() {
    return this.arrival ? ARRIVAL_DELAY_S : clamp(this.gap + 2 * this.late + 0.01, 0.06, 0.3);
  }

  /** A snapshot taken at host time `at` (seconds; none from older hosts) arrived at local time `local`. */
  push(world: World, at: number | undefined, local: number) {
    this.arrival = at === undefined;
    const time = at ?? local;
    const newest = this.frames[this.frames.length - 1];
    if (newest && time <= newest.at) {
      if (time >= newest.at - 1) {
        // (the match stood still: the newest state at that time is the one to draw)
        if (time === newest.at) {
          newest.world = world;
          this.stalled = true;
        }
        return;
      }
      // (the host's clock started again: a new round on the same screen)
      this.frames = [];
      this.offset = this.clock = null;
    }
    this.stalled = false;
    if (newest && this.frames.length) this.gap += (Math.min(0.25, time - newest.at) - this.gap) * 0.1;
    const sample = local - time;
    // A packet more than 0.3 s later than the clock says is a stall or a pause just over, so the clock starts from it;
    // after a stall the next one on time takes it straight back.
    if (this.offset === null || sample < this.offset || sample > this.offset + 0.3) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.late += (sample - this.offset - this.late) * 0.1;
    this.frames.push({ at: time, world });
    if (this.frames.length > 40) this.frames.shift();
  }

  /** The host time to draw at local time `local`, or null before the first snapshot. */
  advance(local: number): number | null {
    const newest = this.frames[this.frames.length - 1];
    if (!newest || this.offset === null) return null;
    const target = local - this.offset - this.delay();
    const dt = this.drawnAt === null ? 0 : clamp(local - this.drawnAt, 0, 0.25);
    this.drawnAt = local;
    if (this.clock === null || Math.abs(target - this.clock) > 0.5) this.clock = target;
    else this.clock += dt * (1 + clamp((target - this.clock) * 2, -0.1, 0.1));
    this.clock = Math.min(this.clock, newest.at);
    while (this.frames.length > 2 && this.frames[1]!.at <= this.clock) this.frames.shift();
    return this.clock;
  }

  /** The world at host time `time`, blended from the snapshots either side of it. */
  sample(time: number): World | null {
    const frames = this.frames;
    if (!frames.length) return null;
    let i = 0;
    while (i + 1 < frames.length && frames[i + 1]!.at <= time) i++;
    const a = frames[i]!, b = frames[i + 1];
    if (!b || time <= a.at) return blendWorld(a.world, a.world, 1);
    return blendWorld(a.world, b.world, (time - a.at) / (b.at - a.at));
  }
}

/** The host's latest kicks, repeated in its next snapshots so a guest that lost the one that told it still hears it. */
export class KickCarry {
  private kicks: { kick: KickEvent; at: number }[] = [];

  note(kick: KickEvent, now: number) {
    this.kicks.push({ kick: { ...kick }, at: now });
    if (this.kicks.length > 2) this.kicks.shift();
  }

  recent(now: number): KickEvent[] | undefined {
    this.kicks = this.kicks.filter((entry) => now - entry.at <= KICK_CARRY_S);
    return this.kicks.length ? this.kicks.map((entry) => ({ ...entry.kick })) : undefined;
  }
}

/**
 * A guest's ear for kicks: each snapshot's kick is the oldest one not heard yet, from the snapshot itself or from the
 * ones the host carries on, so a kick whose snapshot was lost is still heard, once, and two in a row in order.
 */
export class KickHearing {
  private heard: KickEvent[] = [];

  hear(state: World, carried?: KickEvent[]) {
    const kick = [...(carried ?? []), state.kickEvent].find((entry) => entry && !this.heard.some((seen) => sameKick(seen, entry))) ?? null;
    state.kickEvent = kick;
    if (!kick) return;
    this.heard.push(kick);
    if (this.heard.length > 16) this.heard.shift();
  }
}

export type SentInput = { seq: number; at: number; command: Command };

/**
 * Player `id` of `world` (the newest snapshot) run on through the sticks the host hadn't taken yet when it sent it, the
 * way the host runs him: in 1/60 s steps from the first of them, each on the stick sent by then, the last step cut short
 * at `now`. Only his own running (the world around him stays as sent, and he wins no ball and tackles nobody until the
 * host says so). Null when he isn't a player the guest steers.
 */
export function predictOwn(world: World, id: number, inputs: readonly SentInput[], now: number): Player | null {
  const base = world.players[id];
  if (!base || !base.human || base.sentOff) return null;
  const own: Player = { ...base, slide: base.slide && { ...base.slide } };
  const start = inputs[0]?.at;
  if (start === undefined || !(now > start) || now - start > MAX_REPLAY_S) return own;
  const carrier = nearestCarrier(world);
  let taker: Player | undefined;
  if (world.phase === 'restart' && !world.setPiece) {
    taker = restartTaker(world);
    // (the host hands a kickoff to a human first, and nobody moves that step)
    if (world.restart === 'kickoff' && !taker.human
      && world.players.some((player) => player.team === world.restartTeam && player.human && !player.sentOff)) taker = undefined;
  }
  const steps = (now - start) / STEP;
  let input = 0;
  for (let step = 0; step < steps; step++) {
    const at = start + step * STEP;
    while (input + 1 < inputs.length && inputs[input + 1]!.at <= at + 1e-6) input++;
    const part = Math.min(1, steps - step);
    const from = part < 1 ? { x: own.x, z: own.z, vx: own.vx, vz: own.vz, facing: own.facing } : null;
    runOwn(world, own, inputs[input]!.command, carrier, taker);
    if (from) {
      own.x = from.x + (own.x - from.x) * part;
      own.z = from.z + (own.z - from.z) * part;
      own.vx = from.vx + (own.vx - from.vx) * part;
      own.vz = from.vz + (own.vz - from.vz) * part;
      own.facing = turn(from.facing, own.facing, part);
    }
  }
  return own;
}

/** One host step of the guest's own player, as stepWorld (or a restart's own step) would move him. */
function runOwn(world: World, p: Player, command: Command, carrier: Player | undefined, taker: Player | undefined) {
  if (world.phase === 'live') {
    if (p.slide) {
      slideMotion(p, STEP);
      p.slide.t += STEP;
      if (p.slide.t >= 0.95) { p.slide = null; p.action = 'idle'; }
      return;
    }
    const run = runFor(world, p, command, carrier, false);
    if (!run) return;
    const multipliers = worldMultipliers(world, p.id);
    movePlayer(p, run.input, run.sprint, run.carrying, STEP, run.jockey || !!run.contain, multipliers.speed, multipliers.stamina, multipliers.dribble);
    if ((run.jockey || run.contain) && run.enemy) p.facing = Math.atan2(run.enemy.x - p.x, run.enemy.z - p.z);
  } else if (world.phase === 'restart') {
    const setPiece = world.setPiece;
    if (setPiece) {
      const keeper = setPiece.kind === 'penalty' && p.team !== world.restartTeam && p.slot === 'GK';
      if (setPiece.takerId !== p.id && !keeper) setPieceStep(world, p, command, STEP);
    } else if (taker) restartStep(world, p, command, taker, STEP);
  }
}

/** Offsets that fade away: what is drawn moves to where it should be without a jump. */
class Fade {
  private offsets = new Map<number, Point>();

  /** Where `id` should be drawn just moved by (dx, dz) without it moving: hold it there, and let it go over FADE_S. */
  shift(id: number, dx: number, dz: number) {
    const offset = this.offsets.get(id) ?? { x: 0, z: 0 };
    offset.x -= dx;
    offset.z -= dz;
    if (Math.hypot(offset.x, offset.z) > SNAP_M) this.offsets.delete(id);
    else this.offsets.set(id, offset);
  }

  decay(dt: number) {
    const keep = Math.exp(-dt / FADE_S);
    for (const [id, offset] of this.offsets) {
      const length = Math.hypot(offset.x, offset.z);
      const left = Math.max(length * keep, length - FADE_SPEED * dt);
      if (left < 0.002) {
        this.offsets.delete(id);
        continue;
      }
      offset.x *= left / length;
      offset.z *= left / length;
    }
  }

  get(id: number) {
    return this.offsets.get(id);
  }

  players() {
    return [...this.offsets].filter(([id]) => id !== BALL);
  }
}

/**
 * A guest's end of the match. receive() takes the host's snapshots, outgoing() makes its move packets (sent on the fast
 * channel: a newer one replaces a lost one), pressed() keeps a press going out until a snapshot confirms the host has a
 * packet with it, and draw() gives the world to draw this frame: the host's, a little behind its clock, with the guest's
 * own player where its own sticks have run him since (and the ball at his feet while he has it).
 */
export class GuestNet {
  readonly timeline = new SnapshotTimeline();
  private seq = 0;
  private snapshotSeq = -1;
  private acked = -1;
  private log: SentInput[] = [];
  private press: { id: number; at: number; first: number | null; edge: Partial<ControlCommand> } | null = null;
  private pressId = 0;
  private kicks = new KickHearing();
  private fade = new Fade();
  private drawn: { id: number; predicted: boolean; base: World; acked: number; stalled: boolean } | null = null;
  private carry: Point | null = null;
  private drawnAt: number | null = null;

  /** A snapshot from seat `seat`'s host: the world to keep as the newest (with a kick it lost filled in), or null for an old one. */
  receive(packet: SnapshotPacket, seat: number, local: number): World | null {
    // (one older than the newest here came late off the fast channel; one far older means the host counts afresh)
    if (packet.seq <= this.snapshotSeq && packet.seq > this.snapshotSeq - 200) return null;
    this.snapshotSeq = packet.seq;
    const state = packet.state;
    this.kicks.hear(state, packet.kicks);
    const ack = packet.ack?.[seat];
    if (ack !== undefined && ack > this.acked) this.acked = ack;
    if (this.press && this.press.first !== null && this.acked >= this.press.first) this.press = null;
    this.timeline.push(state, packet.at, local);
    return state;
  }

  /** The guest pressed something this frame (a pass, a shot, a switch): it goes out with every packet until the host has it. */
  pressed(edge: Partial<ControlCommand>, local: number) {
    this.press = { id: this.pressId++, at: local, first: null, edge };
  }

  /** The move packet to send now: the stick as it is, with the latest press on it until confirmed (its first packet also goes reliably). */
  outgoing(round: number, seat: number, command: ControlCommand, local: number): { packet: MovePacket; reliable: boolean } {
    if (this.press && local - this.press.at > PRESS_REPEAT_S) this.press = null;
    const press = this.press;
    const seq = this.seq++;
    const packet: MovePacket = { ...movePacket(round, seq, seat, press ? { ...command, ...press.edge } : command, press?.id), w: 1 };
    const reliable = !!press && press.first === null;
    if (press && press.first === null) press.first = seq;
    this.log.push({ seq, at: local, command: commandFromPacket(packet) });
    if (this.log.length > 120) this.log.shift();
    return { packet, reliable };
  }

  /** The world to draw at local time `local`, with player `id` (the guest's own; null for none) predicted. Null before any snapshot. */
  draw(local: number, id: number | null): World | null {
    const time = this.timeline.advance(local);
    const newest = this.timeline.newest;
    const world = time === null ? null : this.timeline.sample(time);
    if (!world || !newest) return null;
    this.fade.decay(this.drawnAt === null ? 0 : clamp(local - this.drawnAt, 0, 0.25));
    this.drawnAt = local;
    const stalled = this.timeline.stalled;
    const run = (base: World, who: number, acked: number, held: boolean) =>
      predictOwn(base, who, held ? [] : this.log.filter((entry) => entry.seq > acked), local);
    const own = id === null ? null : run(newest, id, this.acked, stalled);
    const shared = id === null ? undefined : world.players[id];
    // A new snapshot, a switch to another player, or prediction starting or stopping moves where a player should be
    // drawn without him moving: the difference fades out rather than showing as a jump.
    const last = this.drawn;
    const same = !!own && last?.predicted === true && last.id === id;
    if (last?.predicted && (!same || last.base !== newest || last.acked !== this.acked || last.stalled !== stalled)) {
      const before = run(last.base, last.id, last.acked, last.stalled);
      const after = same ? own : world.players[last.id];
      if (before && after) this.fade.shift(last.id, after.x - before.x, after.z - before.z);
    }
    if (own && shared && !same) this.fade.shift(own.id, own.x - shared.x, own.z - shared.z);
    if (own && shared) world.players[own.id] = { ...shared, x: own.x, z: own.z, vx: own.vx, vz: own.vz, facing: own.facing, stamina: own.stamina };
    for (const [who, offset] of this.fade.players()) {
      const player = world.players[who];
      if (player) world.players[who] = { ...player, x: player.x + offset.x, z: player.z + offset.z };
    }
    // The ball at his feet goes where he is drawn, until the host's (older) picture has it leave them.
    const ball = world.ball;
    const me = own ? world.players[own.id]! : null;
    const carry = me && shared && (world.carrierId === me.id || newest.carrierId === me.id) && ball.y < 0.75
      && Math.hypot(ball.x - shared.x, ball.z - shared.z) < 1.2 ? { x: me.x - shared.x, z: me.z - shared.z } : null;
    if (!carry !== !this.carry) this.fade.shift(BALL, (carry?.x ?? 0) - (this.carry?.x ?? 0), (carry?.z ?? 0) - (this.carry?.z ?? 0));
    this.carry = carry;
    const ballOffset = this.fade.get(BALL);
    if (carry || ballOffset) world.ball = { ...ball, x: ball.x + (carry?.x ?? 0) + (ballOffset?.x ?? 0), z: ball.z + (carry?.z ?? 0) + (ballOffset?.z ?? 0) };
    this.drawn = id === null ? null : { id, predicted: !!own, base: newest, acked: this.acked, stalled };
    this.log = this.log.filter((entry) => entry.seq > this.acked);
    return world;
  }
}
