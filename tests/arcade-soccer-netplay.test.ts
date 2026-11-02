import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, STEP, stepWorld, transferControl, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { acceptMovePacket, consumeCommand, movePacket, parsePacket, snapshotPacket, trimSnapshot, type KickEvent, type MovePacket, type RemoteSeat, type SnapshotPacket } from '../src/os/arcade/games/soccer/net.ts';
import { blendWorld, GuestNet, KEYFRAME_EVERY, KickCarry, predictOwn, SnapshotTimeline, SNAPSHOT_S, type SentInput } from '../src/os/arcade/games/soccer/netplay.ts';
import type { ControlCommand } from '../src/os/arcade/games/soccer/input.ts';

/** A seeded random number generator, so a run is the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An open pitch: the ball parked in a corner, nobody else running, player 6 the guest's (seat 1) and 17 the host's own (seat 0). */
function openPitch(seed = 3) {
  const world = createWorld(seed, 300, 1);
  world.phase = 'live';
  world.restart = null;
  world.event = '';
  world.ball = { x: 45, y: 0.11, z: 30, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  for (const player of world.players) { player.human = false; player.controlled = false; }
  for (const id of [6, 17]) { world.players[id]!.human = true; world.players[id]!.controlled = true; }
  world.players[6]!.x = -20; world.players[6]!.z = 0;
  world.players[17]!.x = 10; world.players[17]!.z = -10;
  world.controlled = [6, 17];
  world.controlledSeats = [17, 6, null, null];
  return world;
}

const stick = (x: number, z: number, sprint = false): ControlCommand => ({
  move: { x, z }, aim: { x: 0, z: 0 }, action: null, pressed: false, heldAction: null, sprint, power: 0.1,
});

test('move packets say when the stick is already turned to the pitch, and snapshots carry match time and kicks', () => {
  const packet = { ...movePacket(1, 4, 1, stick(0.5, -0.25)), w: 1 as const };
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(packet))), packet);
  assert.equal(parsePacket({ ...packet, w: 2 }), null);
  assert.equal((parsePacket(movePacket(1, 4, 1, stick(1, 0))) as MovePacket).w, undefined);

  const world = createWorld();
  const kick: KickEvent = { playerId: 6, action: 'pass', power: 0.4567, time: 101.23456 };
  const snapshot = snapshotPacket(1, 9, trimSnapshot(world), [-1, 3, -1, -1], 12.345678, [kick]);
  const parsed = parsePacket(JSON.parse(JSON.stringify(snapshot))) as SnapshotPacket;
  assert.equal(parsed.at, 12.346);
  assert.deepEqual(parsed.kicks, [{ playerId: 6, action: 'pass', power: 0.457, time: 101.235 }]);
  assert.deepEqual(parsed.ack, [-1, 3, -1, -1]);
  // (a bad match time or kick list is left out, and the snapshot still counts)
  const bad = parsePacket({ ...JSON.parse(JSON.stringify(snapshot)), at: -1, kicks: [{ playerId: 99, action: 'pass', power: 0, time: 0 }] }) as SnapshotPacket;
  assert.ok(bad);
  assert.equal(bad.at, undefined);
  assert.equal(bad.kicks, undefined);
  // (an older host's snapshot has neither)
  const old = parsePacket({ t: 'soccer', k: 's', r: 1, seq: 2, state: trimSnapshot(world) }) as SnapshotPacket;
  assert.equal(old.at, undefined);
});

test('carried kicks are dropped before a snapshot outgrows the relay', () => {
  const state = trimSnapshot(createWorld());
  const ack = [-1, -1, -1, -1];
  const kicks: KickEvent[] = [{ playerId: 21, action: 'through', power: 0.725, time: 123.456 }, { playerId: 20, action: 'through', power: 0.725, time: 123.5 }];
  const size = (packet: SnapshotPacket) => new TextEncoder().encode(JSON.stringify({ t: 'msg', to: [1, 2, 3], d: { '~r': 999, d: packet } })).byteLength;
  assert.equal(snapshotPacket(1, 99999999, state, ack, 1234.5678, kicks).kicks?.length, 2);
  assert.equal(snapshotPacket(1, 99999999, state, ack, 1234.5678, [...kicks, ...kicks]).kicks?.length, 2);
  // A world padded to just under the limit: the kicks go, the snapshot stays.
  const padded = { ...state, pad: 'p'.repeat(8 * 1024 - 100 - size(snapshotPacket(1, 99999999, state, ack, 1234.5678))) };
  const full = snapshotPacket(1, 99999999, padded, ack, 1234.5678, kicks);
  assert.equal(full.kicks, undefined);
  assert.ok(size(full) <= 8 * 1024);
});

test('blending snapshots turns players the short way, lines up teleports at once, and leaves the snapshots alone', () => {
  const a = createWorld();
  const b = structuredClone(a);
  a.players[3]!.facing = Math.PI - 0.1;
  b.players[3]!.facing = -Math.PI + 0.1;
  b.players[4]!.x += 1;
  b.players[5]!.x += 20;
  b.ball.x += 2;
  b.kickEvent = { playerId: 4, action: 'pass', power: 0.5, time: 100 };
  const before = structuredClone([a, b]);
  const mid = blendWorld(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(mid.players[3]!.facing) - Math.PI) < 1e-9);
  assert.equal(mid.players[4]!.x, a.players[4]!.x + 0.5);
  assert.equal(mid.players[5]!.x, b.players[5]!.x);
  assert.equal(mid.ball.x, a.ball.x + 1);
  assert.equal(mid.kickEvent, b.kickEvent);
  assert.deepEqual([a, b], before);
  assert.notEqual(mid.players[4], b.players[4]);
});

test('the timeline draws on the host clock: steady, never back, never past the newest snapshot, and it follows a pause', () => {
  const timeline = new SnapshotTimeline();
  const random = rng(7);
  const arrivals: { at: number; local: number }[] = [];
  for (let at = 0; at < 20; at += SNAPSHOT_S) arrivals.push({ at, local: at + 0.05 + random() * 0.03 });
  // (a 2 s pause: the host's match time stands still while snapshots keep coming)
  for (let pause = 0; pause < 2; pause += SNAPSHOT_S) arrivals.push({ at: 20, local: 20 + pause + 0.05 + random() * 0.03 });
  for (let at = 20 + SNAPSHOT_S; at < 30; at += SNAPSHOT_S) arrivals.push({ at, local: at + 2 + 0.05 + random() * 0.03 });
  arrivals.sort((x, y) => x.local - y.local);
  let next = 0;
  let previous = -Infinity;
  let starved = 0;
  let frames = 0;
  const delays: number[] = [];
  for (let local = 0; local < 32; local += 1 / 60) {
    while (next < arrivals.length && arrivals[next]!.local <= local) {
      const { at } = arrivals[next++]!;
      const world = createWorld();
      world.players[0]!.x = at;
      timeline.push(world, at, local);
    }
    const time = timeline.advance(local);
    if (time === null) continue;
    assert.ok(time >= previous - 1e-9, `drawn time went back at ${local.toFixed(3)}`);
    previous = time;
    const world = timeline.sample(time)!;
    assert.ok(world.players[0]!.x <= timeline.newest!.players[0]!.x + 1e-9);
    if (local > 2 && local < 19.9 || local > 24 && local < 29.9) {
      frames++;
      if (time >= timeline.newest!.players[0]!.x - 1e-9) starved++;
      delays.push(local - 0.05 - (local > 21 ? 2 : 0) - time);
    }
  }
  const mean = delays.reduce((sum, value) => sum + value, 0) / delays.length;
  console.log(`timeline: drawn ${(mean * 1000).toFixed(0)} ms behind the host's newest, starved on ${starved} of ${frames} frames`);
  assert.ok(mean < 0.12, `drawn ${mean} s behind`);
  assert.ok(starved / frames < 0.03, `${starved} of ${frames} frames had no next snapshot`);
});

test('the guest player predicted from unconfirmed sticks lands where the host runs him', () => {
  const host = openPitch();
  const base = structuredClone(host);
  const inputs: SentInput[] = [];
  const pattern = [stick(1, 0), stick(1, 0, true), stick(0.2, 0.9, true), stick(-0.7, 0.7), stick(0, 0)];
  for (let i = 0; i < 24; i++) {
    const command = pattern[Math.floor(i / 5)]!;
    inputs.push({ seq: i, at: 10 + i * STEP, command });
    stepWorld(host, STEP, new Map([[6, { ...command }]]));
  }
  const predicted = predictOwn(base, 6, inputs, 10 + 24 * STEP)!;
  assert.ok(Math.hypot(predicted.x - host.players[6]!.x, predicted.z - host.players[6]!.z) < 1e-9);
  assert.ok(Math.abs(predicted.facing - host.players[6]!.facing) < 1e-9);
  // Half a step on, it is half way through the next step.
  const half = predictOwn(base, 6, inputs, 10 + 24.5 * STEP)!;
  assert.ok(Math.abs(half.x - host.players[6]!.x) < 0.02);
  // Nothing unconfirmed, or too much (the host isn't taking them): drawn where the host has him.
  assert.equal(predictOwn(base, 6, [], 11)!.x, base.players[6]!.x);
  assert.equal(predictOwn(base, 6, inputs, 11)!.x, base.players[6]!.x);
  // Not a human: not the guest's to predict.
  assert.equal(predictOwn(base, 5, inputs, 10.2), null);
  // During a goal nobody runs.
  base.phase = 'goal';
  assert.equal(predictOwn(base, 6, inputs, 10 + 24 * STEP)!.x, base.players[6]!.x);
});

test('a kick in a lost snapshot is heard from the next one, once', () => {
  const net = new GuestNet();
  const world = trimSnapshot(createWorld());
  const kick: KickEvent = { playerId: 4, action: 'shoot', power: 0.8, time: 99.5 };
  const carry = new KickCarry();
  carry.note(kick, 1);
  // Snapshot 1 (with the kick) is lost; 2 and 3 repeat it.
  const second = net.receive(snapshotPacket(1, 2, structuredClone(world), [-1, -1, -1, -1], 1.05, carry.recent(1.05)), 1, 1.1)!;
  assert.deepEqual(second.kickEvent, kick);
  const third = net.receive(snapshotPacket(1, 3, structuredClone(world), [-1, -1, -1, -1], 1.1, carry.recent(1.1)), 1, 1.15)!;
  assert.equal(third.kickEvent, null);
  // The kick the snapshot itself says, rounded as snapshots are, isn't heard twice either.
  const fourth = { ...structuredClone(world), kickEvent: { ...kick, time: 99.5004 } };
  assert.equal(net.receive(snapshotPacket(1, 4, fourth, [-1, -1, -1, -1], 1.15), 1, 1.2)!.kickEvent, null);
  // An older snapshot than the newest is dropped.
  assert.equal(net.receive(snapshotPacket(1, 3, structuredClone(world), [-1, -1, -1, -1], 1.1), 1, 1.25), null);
  assert.equal(carry.recent(1.5), undefined);
});

/** One direction of a link: fast messages get lost, reliable ones arrive in order and a lost one holds up the rest. */
class Wire {
  private queue: { at: number; deliver: (now: number) => void }[] = [];
  private lastReliable = 0;
  private readonly latency: number;
  private readonly jitter: number;
  private readonly loss: number;
  private readonly rto: number;
  private readonly random: () => number;
  constructor(latency: number, jitter: number, loss: number, rto: number, random: () => number) {
    this.latency = latency;
    this.jitter = jitter;
    this.loss = loss;
    this.rto = rto;
    this.random = random;
  }
  fast(now: number, deliver: (now: number) => void) {
    if (this.random() < this.loss) return;
    this.queue.push({ at: now + this.latency + this.random() * this.jitter, deliver });
  }
  reliable(now: number, deliver: (now: number) => void) {
    const at = Math.max(this.lastReliable, now + this.latency + this.random() * this.jitter + (this.random() < this.loss ? this.rto : 0));
    this.lastReliable = at;
    this.queue.push({ at, deliver });
  }
  due(now: number) {
    const ready = this.queue.filter((entry) => entry.at <= now).sort((a, b) => a.at - b.at);
    this.queue = this.queue.filter((entry) => entry.at > now);
    for (const entry of ready) entry.deliver(now);
  }
}

/** The guest's drawing as it was: snapshots stamped on arrival, drawn 100 ms after it, redrawn 30 times a second. */
function oldRenderState(frames: { time: number; world: World }[], now: number, fallback: World) {
  if (!frames.length) return fallback;
  const target = now - 0.1;
  let before = frames[0]!;
  for (const frame of frames) {
    if (frame.time <= target) before = frame;
    else {
      const span = frame.time - before.time;
      if (!(span > 0)) return frame.world;
      const t = Math.min(1, Math.max(0, (target - before.time) / span));
      const mix = (from: number, to: number) => from + (to - from) * t;
      return {
        ...before.world,
        players: frame.world.players.map((player, i) => {
          const previous = before.world.players[i]!;
          return { ...player, x: mix(previous.x, player.x), z: mix(previous.z, player.z) };
        }),
        ball: { ...frame.world.ball, x: mix(before.world.ball.x, frame.world.ball.x), z: mix(before.world.ball.z, frame.world.ball.z) },
      };
    }
  }
  return before.world;
}

type Link = { name: string; latency: number; jitter: number; loss: number };
type Metrics = { response: number; backward: number; worstBack: number; ownBehind: number; ownMiss: number; remoteError: number; remoteHitches: number; frames: number };

/**
 * A host and a guest over a link, 60 frames a second each: the guest runs its player (6) round the open pitch while
 * the host runs its own (17) in a steady circle. `old` plays the netcode as it was (reliable everything, drawn by
 * arrival time 100 ms late at 30 Hz, no prediction), otherwise as it is now.
 */
function play(link: Link, old: boolean, seed = 11): Metrics {
  const random = rng(seed);
  const up = new Wire(link.latency, link.jitter, link.loss, 0.2, random);
  const down = new Wire(link.latency, link.jitter, link.loss, 0.2, random);
  const host = openPitch();
  const hostTrack: { t: number; own: { x: number; z: number }; remote: { x: number; z: number } }[] = [];
  let seat: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  let remote: Command | undefined;
  let accumulator = 0, snapshotTimer = 0, simTime = 0, snapshotSeq = 0;
  const guest = new GuestNet();
  let latest: World | null = null;
  const oldFrames: { time: number; world: World }[] = [];
  let oldSeq = -1, oldSeq2 = 0, oldTimer = 0, oldDrawn: World | null = null, oldDirty = false;
  // The guest's stick: still, then right, down, a sprint up-left, then right again (a segment a second or two each).
  const segments = [
    { until: 1, move: stick(0, 0) }, { until: 3.5, move: stick(1, 0) }, { until: 5.5, move: stick(0, 1) },
    { until: 8, move: stick(-0.7071, -0.7071, true) }, { until: 10.5, move: stick(1, 0) }, { until: 11.5, move: stick(0, 0) },
  ];
  const segmentAt = (t: number) => segments.findIndex((segment) => t < segment.until);
  const hostStick = (t: number): Command => ({ move: { x: Math.cos(t * 0.8), z: Math.sin(t * 0.8) }, sprint: false });
  const metrics: Metrics = { response: -1, backward: 0, worstBack: 0, ownBehind: 0, ownMiss: 0, remoteError: 0, remoteHitches: 0, frames: 0 };
  let previousOwn: { x: number; z: number } | null = null;
  let previousRemote: { x: number; z: number } | null = null;
  let restX: number | null = null;
  const misses: { t: number; x: number; z: number }[] = [];
  let arrived = false;
  const receive = (json: string, now: number) => {
    const packet = parsePacket(JSON.parse(json)) as SnapshotPacket;
    if (old) {
      if (packet.seq <= oldSeq) return;
      oldSeq = packet.seq;
      oldFrames.push({ time: now, world: packet.state });
      if (oldFrames.length > 12) oldFrames.shift();
      latest = packet.state;
      arrived = true;
    } else latest = guest.receive(packet, 1, now) ?? latest;
  };
  const accept = (json: string) => {
    const accepted = acceptMovePacket(seat, remote, parsePacket(JSON.parse(json)) as MovePacket, false);
    seat = accepted.seat;
    if (accepted.command) remote = accepted.command;
  };
  const hostAt = (t: number) => {
    let i = hostTrack.length - 1;
    while (i > 0 && hostTrack[i]!.t > t) i--;
    return hostTrack[Math.max(0, i)]!;
  };
  for (let frame = 0; frame < 60 * 11.5; frame++) {
    const t = frame / 60;
    // The host's frame (a few ms after the guest's).
    const hostNow = t + 0.004;
    up.due(hostNow);
    accumulator += 1 / 60;
    while (accumulator >= STEP - 1e-9) {
      accumulator -= STEP;
      simTime += STEP;
      const commands = new Map<number, Command>([[17, hostStick(simTime)]]);
      if (remote) {
        commands.set(6, { ...remote });
        remote = consumeCommand(remote);
      }
      stepWorld(host, STEP, commands);
    }
    hostTrack.push({ t: hostNow, own: { x: host.players[6]!.x, z: host.players[6]!.z }, remote: { x: host.players[17]!.x, z: host.players[17]!.z } });
    snapshotTimer += 1 / 60;
    if (snapshotTimer >= SNAPSHOT_S - 1e-9) {
      snapshotTimer -= SNAPSHOT_S;
      const state = trimSnapshot(host);
      const ack = [-1, seat.seq, -1, -1];
      if (old) {
        const packet = JSON.stringify({ t: 'soccer', k: 's', r: 1, seq: snapshotSeq++, state, ack });
        down.reliable(hostNow, (now) => receive(packet, now));
      } else {
        const seq = snapshotSeq++;
        const packet = JSON.stringify(snapshotPacket(1, seq, state, ack, simTime));
        down.fast(hostNow, (now) => receive(packet, now));
        if (seq % KEYFRAME_EVERY === 0) down.reliable(hostNow, (now) => receive(packet, now));
      }
    }
    // The guest's frame.
    arrived = false;
    down.due(t);
    const segment = segments[segmentAt(t)]!;
    const command = segment.move;
    if (old) {
      const packet = JSON.stringify(movePacket(1, oldSeq2++, 1, command));
      up.reliable(t, () => accept(packet));
    } else {
      const { packet, reliable } = guest.outgoing(1, 1, command, t);
      const json = JSON.stringify(packet);
      up.fast(t, () => accept(json));
      if (reliable) up.reliable(t, () => accept(json));
    }
    let drawn: World | null;
    if (old) {
      oldTimer += 1 / 60;
      if (oldTimer >= 1 / 30) { oldTimer %= 1 / 30; oldDirty = true; }
      if (arrived || oldDirty || !oldDrawn) {
        oldDirty = false;
        oldDrawn = latest ? oldRenderState(oldFrames, t, latest) : null;
      }
      drawn = oldDrawn;
    } else drawn = guest.draw(t, 6);
    if (!drawn) continue;
    const own = drawn.players[6]!;
    const other = drawn.players[17]!;
    // How soon the guest sees its player move once the stick goes right at 1 s.
    if (t >= 1 - 1e-9 && restX === null) restX = own.x;
    if (restX !== null && metrics.response < 0 && own.x > restX + 0.001) metrics.response = Math.round((t - 1) * 60);
    // Steady running: from 0.6 s into a segment to its end, nothing drawn should go backwards.
    const index = segmentAt(t);
    const start = index > 0 ? segments[index - 1]!.until : 0;
    const steady = t > 2 && t - start > 0.6 && Math.hypot(segment.move.move.x, segment.move.move.z) > 0;
    if (steady && previousOwn) {
      const d = segment.move.move;
      const length = Math.hypot(d.x, d.z);
      const along = ((own.x - previousOwn.x) * d.x + (own.z - previousOwn.z) * d.z) / length;
      if (along < -0.002) { metrics.backward++; metrics.worstBack = Math.max(metrics.worstBack, -along); }
      const truth = hostAt(t);
      const behind = ((truth.own.x - own.x) * d.x + (truth.own.z - own.z) * d.z) / length;
      metrics.ownBehind += behind;
      // (and how far from where the host will have him once the sticks sent so far reach it, worked out at the end)
      misses.push({ t: t + link.latency + link.jitter / 2, x: own.x, z: own.z });
      metrics.remoteError += Math.hypot(truth.remote.x - other.x, truth.remote.z - other.z);
      metrics.frames++;
      // The host's runner covers about the same ground every frame; a hitch is a frame that shows well under or over it.
      if (previousRemote) {
        const step = Math.hypot(other.x - previousRemote.x, other.z - previousRemote.z);
        const expected = 7 / 60;
        if (step < expected * 0.4 || step > expected * 1.6) metrics.remoteHitches++;
      }
    }
    previousOwn = { x: own.x, z: own.z };
    previousRemote = { x: other.x, z: other.z };
  }
  metrics.ownBehind /= metrics.frames;
  for (const miss of misses) {
    const due = hostAt(miss.t);
    metrics.ownMiss += Math.hypot(due.own.x - miss.x, due.own.z - miss.z) / misses.length;
  }
  metrics.remoteError /= metrics.frames;
  return metrics;
}

test('a guest over a slow, jittery link sees its own player move at once, with no backward snaps and others smooth', () => {
  const links: Link[] = [
    { name: 'RTT 60 ms', latency: 0.025, jitter: 0.01, loss: 0.01 },
    { name: 'RTT 100 ms', latency: 0.04, jitter: 0.02, loss: 0.01 },
    { name: 'RTT 150 ms', latency: 0.06, jitter: 0.03, loss: 0.02 },
  ];
  for (const link of links) {
    const before = play(link, true);
    const after = play(link, false);
    const line = (m: Metrics) => `own moves after ${m.response} frames, ${m.backward} backward steps (worst ${(m.worstBack * 100).toFixed(1)} cm), `
      + `own ${(m.ownBehind * 100).toFixed(0)} cm behind the host on average (${(m.ownMiss * 100).toFixed(0)} cm from where the host will have him), `
      + `remote player ${(m.remoteError * 100).toFixed(0)} cm from the host, ${m.remoteHitches}/${m.frames} hitched frames`;
    console.log(`${link.name} before: ${line(before)}`);
    console.log(`${link.name} after:  ${line(after)}`);
    assert.ok(after.response >= 0 && after.response <= 1, `own player moved after ${after.response} frames`);
    assert.equal(after.backward, 0, `${after.backward} backward steps`);
    assert.ok(after.remoteHitches <= after.frames * 0.02, `${after.remoteHitches} hitched frames`);
    assert.ok(after.response < before.response);
    assert.ok(after.ownMiss < 0.15 && after.ownMiss < before.ownMiss / 5, `own player ${after.ownMiss} m from where the host will have him`);
  }
});

test('every press reaches the host exactly once over a lossy link', () => {
  const random = rng(5);
  const up = new Wire(0.05, 0.03, 0.25, 0.2, random);
  const down = new Wire(0.05, 0.03, 0.25, 0.2, random);
  const guest = new GuestNet();
  const world = trimSnapshot(openPitch());
  let seat: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  let remote: Command | undefined;
  let applied = 0, pressed = 0, snapshotSeq = 0;
  for (let frame = 0; frame < 60 * 12; frame++) {
    const t = frame / 60;
    up.due(t);
    // The host's step takes the pending press once.
    if (remote?.pressed && remote.action === 'pass') applied++;
    if (remote) remote = consumeCommand(remote);
    if (frame % 3 === 0) {
      const packet = JSON.stringify(snapshotPacket(1, snapshotSeq++, structuredClone(world), [-1, seat.seq, -1, -1], t));
      down.fast(t, (now) => guest.receive(parsePacket(JSON.parse(packet)) as SnapshotPacket, 1, now));
    }
    down.due(t);
    const command = stick(1, 0);
    if (frame % 24 === 0 && t < 10) {
      pressed++;
      guest.pressed({ action: 'pass', pressed: true, power: 0.4, aim: { x: 1, z: 0 } }, t);
    }
    const { packet, reliable } = guest.outgoing(1, 1, command, t);
    const json = JSON.stringify(packet);
    const deliver = () => {
      const accepted = acceptMovePacket(seat, remote, parsePacket(JSON.parse(json)) as MovePacket, false);
      seat = accepted.seat;
      if (accepted.command) remote = accepted.command;
    };
    up.fast(t, deliver);
    if (reliable) up.reliable(t, deliver);
  }
  assert.equal(applied, pressed);
});

test('a switch to another player and a host pause fade in without a jump', () => {
  const random = rng(9);
  const up = new Wire(0.05, 0.02, 0, 0.2, random);
  const down = new Wire(0.05, 0.02, 0, 0.2, random);
  const host = openPitch();
  host.players[9]!.x = -15;
  host.players[9]!.z = 8;
  const guest = new GuestNet();
  let seat: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  let remote: Command | undefined;
  let simTime = 0, snapshotSeq = 0;
  let latest: World | null = null;
  const previous = new Map<number, { x: number; z: number }>();
  let worst = 0;
  for (let frame = 0; frame < 60 * 5; frame++) {
    const t = frame / 60;
    up.due(t);
    // The host passes control from 6 to 9 at 1.5 s, and stands its match still from 3 s to 3.8 s.
    if (frame === 90) transferControl(host, 0, 9, 6);
    const paused = t >= 3 && t < 3.8;
    if (!paused) {
      simTime += STEP;
      const commands = new Map<number, Command>();
      const mine = host.controlledSeats![1]!;
      if (remote) {
        commands.set(mine, { ...remote });
        remote = consumeCommand(remote);
      }
      stepWorld(host, STEP, commands);
    }
    if (frame % 3 === 0) {
      const json = JSON.stringify(snapshotPacket(1, snapshotSeq++, trimSnapshot(host), [-1, seat.seq, -1, -1], simTime));
      down.fast(t, (now) => { latest = guest.receive(parsePacket(JSON.parse(json)) as SnapshotPacket, 1, now) ?? latest; });
    }
    down.due(t);
    const { packet } = guest.outgoing(1, 1, stick(0.8, 0.6, true), t);
    const json = JSON.stringify(packet);
    up.fast(t, () => {
      const accepted = acceptMovePacket(seat, remote, parsePacket(JSON.parse(json)) as MovePacket, false);
      seat = accepted.seat;
      if (accepted.command) remote = accepted.command;
    });
    const drawn = latest && guest.draw(t, (latest as World).controlledSeats![1] ?? null);
    if (!drawn) continue;
    for (const id of [6, 9]) {
      const player = drawn.players[id]!;
      const last = previous.get(id);
      if (last) worst = Math.max(worst, Math.hypot(player.x - last.x, player.z - last.z));
      previous.set(id, { x: player.x, z: player.z });
    }
  }
  // A sprinter covers 15 cm a frame; anything much past that is a jump.
  assert.ok(worst < 0.3, `a player moved ${worst} m in one frame`);
});
