// Tank Maze online: a guest drives its own tank and fires its own shots here and now, the host takes its word within
// limits and judges every hit, and a guest shows everything else on the host's clock (netsync.ts). The simulations at
// the bottom run a host and a guest over a slow, jittery link, with the old netcode and the new, and measure what the
// guest feels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMaze, createWorld, FWD, mulberry32, noInput, step, WALL_T, type Maze, type TankInput, type World } from '../src/os/arcade/games/tank-maze/logic.ts';
import { inputPacket, parsePacket, roundPacket, statePacket, wirePose, type InputPacket, type StatePacket } from '../src/os/arcade/games/tank-maze/net.ts';
import { covered, driverInput, hearInput, newDriver, newOwn, ownHear, ownReport, ownRound, ownStep, resetDriver, shotFired, sortEvents, Timeline, type Driver, type Own } from '../src/os/arcade/games/tank-maze/netsync.ts';

const STEP = 1 / 60;
const idle: TankInput = { turn: 0, move: 0, fire: false };
const drive = (dir: number): TankInput => ({ turn: 0, move: 0, fire: false, dir });

/** An open room: only the outer walls. */
function arena(cols: number, rows: number): Maze {
  const T = WALL_T / 2;
  const v = new Array<boolean>((cols + 1) * rows).fill(false);
  const h = new Array<boolean>((rows + 1) * cols).fill(false);
  for (let y = 0; y < rows; y++) v[y * (cols + 1)] = v[y * (cols + 1) + cols] = true;
  for (let x = 0; x < cols; x++) h[x] = h[rows * cols + x] = true;
  return { cols, rows, v, h, rects: [[-T, -T, WALL_T, rows + WALL_T], [cols - T, -T, WALL_T, rows + WALL_T], [-T, -T, cols + WALL_T, WALL_T], [-T, rows - T, cols + WALL_T, WALL_T]] };
}

/** Host (tank 0) and guest (tank 1) in a 10x6 room, in play, with no pickups to change anyone's shot. */
function room(maze?: Maze): World {
  const w = createWorld({ cols: 10, rows: 6, seed: 7, count: 2, target: 5 });
  if (maze) w.maze = maze;
  w.phase = 'play';
  w.pickups = [];
  w.pickupT = 1e9;
  Object.assign(w.tanks[0], { x: 7.45, y: 3, a: Math.PI / 2 });
  Object.assign(w.tanks[1], { x: 1.5, y: 1.5, a: 0 });
  return w;
}

const wire = <T>(p: unknown) => parsePacket(JSON.parse(JSON.stringify(p))) as T;

// -----------------------------------------------------------------------------------------------------------------
// Packets

test('the new packet fields round trip, and malformed ones read as absent', () => {
  const i = wire<InputPacket>(inputPacket({ k: 'in', roomRound: 2, turn: 0, move: 0, fireCount: 4, dir: 1, seq: 17, pose: { x: 3.456, y: 1.234, a: 5.5 }, warp: 3, shot: { x: 3.4, y: 1.2, a: -0.5 } }));
  assert.equal(i.seq, 17);
  assert.equal(i.warp, 3);
  // angles go out wrapped to [-pi, pi], rounded as wirePose rounds them
  assert.deepEqual(i.pose, wirePose({ x: 3.456, y: 1.234, a: 5.5 }));
  assert.ok(Math.abs(i.pose!.a - (5.5 - 2 * Math.PI)) < 0.001);
  assert.deepEqual(i.shot, { x: 3.4, y: 1.2, a: -0.5 });
  const raw = JSON.parse(JSON.stringify(inputPacket({ k: 'in', roomRound: 2, turn: 0, move: 0, fireCount: 4, seq: 1, pose: { x: 1, y: 1, a: 0 }, warp: 0 })));
  const bad = parsePacket({ ...raw, p: [1, 2], f: 'x', q: -1 });
  assert.ok(bad && bad.k === 'in' && bad.pose === undefined && bad.shot === undefined && bad.seq === undefined && bad.fireCount === 4);
  // a pose without a warp is no word on where the tank is
  assert.equal((parsePacket({ ...raw, w: undefined }) as InputPacket).pose, undefined);

  const s = wire<StatePacket>(
    statePacket({
      roomRound: 1, tick: 600, phase: 'play', phaseT: 0,
      tanks: [{ x: 1, y: 1, a: 0, alive: true, special: null, moving: false }, { x: 2, y: 2, a: 1, alive: true, special: 'triple', moving: false }],
      shells: [{ x: 1.5, y: 1.5, owner: 0, id: 9 }, { x: 2.5, y: 2.5, owner: 1, id: 12, tag: 4 }],
      pickups: [], mines: [], beams: [], scores: [0, 0], events: [],
      warps: [2, 5], acks: [0, 4], seqs: [0, 88],
    }),
  );
  assert.deepEqual(s.shells.map((x) => [x.id, x.tag]), [[9, undefined], [12, 4]]);
  assert.deepEqual([s.warps, s.acks, s.seqs], [[2, 5], [0, 4], [0, 88]]);
  const rawS = JSON.parse(JSON.stringify(statePacket({ ...s, warps: [1, 1] })));
  const badS = parsePacket({ ...rawS, wp: [1], fa: 'x', ak: [1, -2] }) as StatePacket;
  assert.ok(badS && badS.warps === undefined && badS.acks === undefined && badS.seqs === undefined);

  const r = wire<{ k: 'round'; warps?: number[]; tick?: number }>(
    roundPacket({ roomRound: 1, round: 2, seed: 5, cols: 10, rows: 6, seats: [0, 1], bots: [], scores: [1, 0], target: 5, level: 1, spawns: [{ x: 1, y: 1, a: 0 }, { x: 2, y: 2, a: 0 }], warps: [3, 3], tick: 1234 }),
  );
  assert.deepEqual([r.warps, r.tick], [[3, 3], 1234]);
});

test('older packets still parse, and new ones only add what older clients skip', () => {
  // an older guest's input and an older host's state: no new fields
  const i = parsePacket({ game: 'tank-maze', type: 'in', room: 1, turn: 0, move: 1, fc: 2 }) as InputPacket;
  assert.ok(i && i.seq === undefined && i.pose === undefined && i.shot === undefined);
  const s = parsePacket({ game: 'tank-maze', type: 's', room: 1, tick: 5, pt: 0, phase: 'play', tanks: [[100, 100, 0, 1, -1, 0]], shells: [[150, 150, 0]], scores: [0] }) as StatePacket;
  assert.ok(s && s.warps === undefined && s.shells[0].id === undefined);
  // new state packets keep every shell's and tank's first fields where older guests read them
  const raw = JSON.parse(JSON.stringify(statePacket({ roomRound: 1, tick: 5, phase: 'play', phaseT: 0, tanks: [{ x: 1, y: 1, a: 0, alive: true, special: null, moving: false }], shells: [{ x: 1.5, y: 1.5, owner: 0, id: 3, tag: 2 }], pickups: [], mines: [], beams: [], scores: [0], events: [], warps: [0], acks: [0], seqs: [0] })));
  assert.deepEqual(raw.shells[0].slice(0, 3), [150, 150, 0]);
  assert.deepEqual(raw.tanks[0], [100, 100, 0, 1, -1, 0]);
});

// -----------------------------------------------------------------------------------------------------------------
// Logic

test('a shot with a `from` pose leaves from that pose, not from where the tank is', () => {
  const w = room(arena(10, 6));
  const t = w.tanks[1];
  step(w, [idle, { ...idle, fire: true, from: { x: 4, y: 4, a: Math.PI / 2 } }]);
  assert.equal(w.shells.length, 1);
  const s = w.shells[0];
  assert.ok(Math.abs(s.x - 4) < 1e-9 && s.y > 4 && Math.abs(s.vx) < 1e-9 && s.vy > 0);
  assert.ok(Math.abs(t.x - 1.5) < 1e-9, 'the tank itself stays put');
});

// -----------------------------------------------------------------------------------------------------------------
// Host: taking a guest's word

const pose = (x: number, y: number, a = 0) => ({ x, y, a });
const word = (d: Driver, seq: number, p: { x: number; y: number; a: number }, warp: number, now: number, extra: Partial<InputPacket> = {}) =>
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: d.fc, seq, pose: p, warp, ...extra }, now);

test('the host takes a guest\'s word on its tank, but not through a wall, nor faster than it drives', () => {
  const w = room(arena(10, 6));
  const t = w.tanks[1];
  const d = newDriver(0);
  // a plain word: taken as said
  word(d, 1, pose(1.6, 1.5, 0.2), 0, 0.05);
  driverInput(w, t, d, 0, 0.05);
  assert.ok(Math.abs(t.x - 1.6) < 1e-9 && Math.abs(t.a - 0.2) < 1e-9);
  // an older input, overtaken on the fast channel, is dropped
  word(d, 1, pose(1.2, 1.5), 0, 0.06);
  assert.equal(d.pose, null);
  // a word for an old warp (the game moved the tank since) is not taken
  word(d, 2, pose(1.7, 1.5), 1, 0.07);
  driverInput(w, t, d, 0, 0.07);
  assert.ok(Math.abs(t.x - 1.6) < 1e-9);
  // a speed hack: one word five cells on after a tenth of a second gets no further than the budget allows
  word(d, 3, pose(6.6, 1.5), 0, 0.15);
  const r = driverInput(w, t, d, 0, 0.15);
  assert.ok(t.x < 1.6 + FWD * 0.75 + 0.25, `went to ${t.x}`);
  // ...and the host's copy is now far from the word, so it moves the warp on (the guest will take the host's pose)
  assert.equal(r.warp, 1);
  // through a wall: a room split by a wall at x = 3
  const m = arena(6, 3);
  m.rects.push([3 - WALL_T / 2, -WALL_T / 2, WALL_T, 3 + WALL_T]);
  const v = room(m);
  const u = v.tanks[1];
  Object.assign(u, { x: 2.7, y: 1.5, a: 0 });
  const e = newDriver(0);
  word(e, 1, pose(3.3, 1.5), 0, 1);
  driverInput(v, u, e, 0, 1);
  assert.ok(u.x < 3, `went through the wall to ${u.x}`);
});

test('the host fires a guest\'s shot from its barrel, so the guest\'s shell flies the very same path', () => {
  const host = room(arena(10, 6));
  const guest = room(arena(10, 6));
  const own: Own = newOwn();
  ownRound(own, 0);
  const d = newDriver(0);
  // (the host has heard from the guest before: the first input of a match only says where its count stands)
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, seq: 0 }, 0);
  // the guest has turned a little and fires; its tank is a touch ahead of the host's copy
  Object.assign(guest.tanks[1], { x: 1.83, y: 1.71, a: 0.61 });
  Object.assign(host.tanks[1], { x: 1.8, y: 1.7, a: 0.5 });
  const r = ownStep(own, guest, 1, { ...idle, fire: true }, STEP, true, 0);
  assert.equal(r.fired, 'shell');
  assert.equal(own.shots.length, 1, 'the shell shows on the guest at once');
  const pkt = wire<InputPacket>(inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, ...ownReport(own, guest.tanks[1], 0) }));
  hearInput(d, pkt, 0.05);
  const hi = driverInput(host, host.tanks[1], d, 0, 0.05);
  const first = host.nextShell;
  step(host, [idle, hi.input]);
  assert.equal(shotFired(host, 1, d, hi.shot), 1);
  assert.equal(d.done, 1);
  const hs = host.shells.find((s) => s.id >= first)!;
  // fly both for six seconds (several bounces): the host's shell is the guest's, step for step
  const path = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < 360; i++) {
    path.set(Math.round(own.shots[0].s.age * 60), { x: own.shots[0].s.x, y: own.shots[0].s.y });
    ownStep(own, guest, 1, idle, STEP, true, (i + 1) * STEP);
  }
  let off = 0;
  for (let i = 0; i < 300; i++) {
    const p = path.get(Math.round(hs.age * 60));
    if (p) off = Math.max(off, Math.hypot(p.x - hs.x, p.y - hs.y));
    step(host, [idle, idle]);
  }
  assert.ok(off < 1e-9, `paths part by ${off}`);
});

test('the host holds a guest\'s shot for its cooldown, and gives up on a stale one', () => {
  const w = room(arena(10, 6));
  const t = w.tanks[1];
  const d = newDriver(0);
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, seq: 1 }, 0);
  t.cooldown = 0.1;
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 1, seq: 2, shot: pose(t.x, t.y, 0) }, 0);
  let fired = 0;
  for (let i = 0; i < 12; i++) {
    const r = driverInput(w, t, d, 0, i * STEP);
    step(w, [idle, r.input]);
    if (shotFired(w, 1, d, r.shot) !== null) fired++;
  }
  assert.equal(fired, 1, 'fired once its cooldown ran out');
  // a shot heard while the round is not in play is dropped, not fired later
  w.phase = 'settle';
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 2, seq: 3, shot: pose(t.x, t.y, 0) }, 1);
  driverInput(w, t, d, 0, 1);
  assert.equal(d.done, 2);
  assert.equal(d.shots.length, 0);
  // a new round: nothing from before counts
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 3, seq: 4, shot: pose(t.x, t.y, 0) }, 2);
  resetDriver(d, 2);
  assert.equal(d.shots.length, 0);
  assert.equal(d.done, 3);
  // a guest whose counts started over (its game was rebuilt) is heard again, its old shots not refired
  d.seq = 500;
  hearInput(d, { k: 'in', roomRound: 1, turn: 1, move: 0, fireCount: 1, seq: 2, shot: pose(t.x, t.y, 0) }, 3);
  assert.equal(d.turn, 1);
  assert.equal(d.done, 1);
  assert.equal(d.shots.length, 0);
});

test('an older guest is still driven by its input, and its first input fires nothing', () => {
  const w = room(arena(10, 6));
  const t = w.tanks[1];
  const d = newDriver(0);
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, dir: 0 }, 0);
  const x = t.x;
  let r = driverInput(w, t, d, 0, 0);
  assert.equal(r.input.fire, false, 'the old host fired once on a first input; that shot is gone');
  step(w, [idle, r.input]);
  assert.ok(t.x > x, 'driven by its input');
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 1, dir: 0 }, 0.05);
  r = driverInput(w, t, d, 0, 0.05);
  assert.ok(r.input.fire && r.input.from === undefined && r.shot === null, 'fires once per count, from where the host has it');
  assert.equal(driverInput(w, t, d, 0, 0.06).input.fire, false);
});

test('with an older host (no warps) a guest leaves its tank to the host', () => {
  const w = room(arena(10, 6));
  const own = newOwn();
  ownRound(own, undefined);
  assert.equal(own.active, false);
  const old = wire<StatePacket>(statePacket({ roomRound: 1, tick: 5, phase: 'play', phaseT: 0, tanks: w.tanks.map((t) => ({ ...t, special: null, moving: false })), shells: [], pickups: [], mines: [], beams: [], scores: [0, 0], events: [] }));
  assert.equal(ownHear(own, w.tanks[1], 1, old, 0.1), false);
  assert.equal(own.active, false);
  // and its input carries no word on where the tank is
  assert.equal(ownReport(own, w.tanks[1], 0.1).pose, undefined);
});

// -----------------------------------------------------------------------------------------------------------------
// Guest: its own shots and the host's word on them

/** A host state for the guest (tank 1) with the given shells and acks. */
const stateFor = (tick: number, shells: { x: number; y: number; owner: number; id: number; tag?: number }[], done: number, warp = 0, at = { x: 1.5, y: 1.5, a: 0 }): StatePacket =>
  wire<StatePacket>(
    statePacket({
      roomRound: 1, tick, phase: 'play', phaseT: 0,
      tanks: [{ x: 7, y: 3, a: 0, alive: true, special: null, moving: false }, { ...at, alive: true, special: null, moving: false }],
      shells, pickups: [], mines: [], beams: [], scores: [0, 0], events: [], warps: [0, warp], acks: [0, done], seqs: [0, 0],
    }),
  );

test('a guest\'s shell is matched to the host\'s, goes when the host\'s goes, and gives way when the host turned the shot down', () => {
  const w = room(arena(10, 6));
  const own = newOwn();
  ownRound(own, 0);
  ownStep(own, w, 1, { ...idle, fire: true }, STEP, true, 0);
  const s0 = own.shots[0].s;
  // the host's state shows the shell (a few steps behind ours), tagged with our fire count
  ownHear(own, w.tanks[1], 1, stateFor(10, [{ x: s0.x, y: s0.y, owner: 1, id: 40, tag: 1 }], 1), 0.1);
  assert.equal(own.shots[0].host, 40);
  assert.deepEqual([...covered(own)], [40]);
  // the host's shell is gone (it hit something): ours goes too, and the host's copy a moment behind is not drawn either
  ownHear(own, w.tanks[1], 1, stateFor(13, [], 1), 0.2);
  assert.equal(own.shots.length, 0);
  assert.deepEqual([...covered(own)], [40]);
  ownHear(own, w.tanks[1], 1, stateFor(50, [], 1), 0.8);
  assert.equal(covered(own).size, 0);
  // a shot the host dealt with but has no shell for (turned down) gives way
  w.tanks[1].cooldown = 0;
  ownStep(own, w, 1, { ...idle, fire: true }, STEP, true, 0.3);
  assert.equal(own.shots.length, 1);
  ownHear(own, w.tanks[1], 1, stateFor(16, [], 1), 0.35);
  assert.equal(own.shots.length, 1, 'not dealt with yet: still flying');
  ownHear(own, w.tanks[1], 1, stateFor(19, [], 2), 0.4);
  assert.equal(own.shots.length, 0);
  // a shell the host sent another way gives way to the host's
  w.tanks[1].cooldown = 0;
  ownStep(own, w, 1, { ...idle, fire: true }, STEP, true, 0.5);
  ownHear(own, w.tanks[1], 1, stateFor(22, [{ x: 4, y: 4, owner: 1, id: 41, tag: 3 }], 3), 0.55);
  assert.equal(own.shots.length, 0);
});

test('a guest\'s shell that touches a tank hides until the host\'s flies on past it', () => {
  const w = room(arena(10, 6));
  Object.assign(w.tanks[0], { x: 3, y: 1.5 });
  const own = newOwn();
  ownRound(own, 0);
  ownStep(own, w, 1, { ...idle, fire: true }, STEP, true, 0);
  let i = 0;
  while (own.shots[0].hidden === null && i++ < 60) ownStep(own, w, 1, idle, STEP, true, i * STEP);
  const shot = own.shots[0];
  assert.ok(shot.hidden !== null, 'hid on reaching the tank');
  const touch = { x: shot.trail[shot.trail.length - 3], y: shot.trail[shot.trail.length - 2] };
  for (let k = 0; k < 20; k++) ownStep(own, w, 1, idle, STEP, true, (i + k) * STEP);
  // the host's shell is still short of the tank: still hidden
  ownHear(own, w.tanks[1], 1, stateFor(30, [{ x: touch.x - 0.2, y: touch.y, owner: 1, id: 7, tag: 1 }], 1), 1);
  assert.notEqual(own.shots[0].hidden, null);
  // the host's shell has flown on past where ours touched the tank (on the host, the tank was elsewhere): it shows again
  ownHear(own, w.tanks[1], 1, stateFor(33, [{ x: touch.x + 0.4, y: touch.y, owner: 1, id: 7, tag: 1 }], 1), 1.05);
  assert.equal(own.shots[0].hidden, null);
});

test('a guest takes the host\'s pose for its tank only when the warp moves on', () => {
  const w = room(arena(10, 6));
  const own = newOwn();
  ownRound(own, 0);
  Object.assign(w.tanks[1], { x: 2, y: 2 });
  ownHear(own, w.tanks[1], 1, stateFor(10, [], 0, 0, { x: 1.7, y: 2, a: 0 }), 0.1);
  assert.equal(w.tanks[1].x, 2, 'the host is a moment behind: ignored');
  assert.equal(ownHear(own, w.tanks[1], 1, stateFor(13, [], 0, 1, { x: 1.7, y: 2, a: 0 }), 0.2), true);
  assert.equal(w.tanks[1].x, 1.7);
  assert.equal(own.warp, 1);
});

// -----------------------------------------------------------------------------------------------------------------
// Guest: everything else on the host's clock

const snapAt = (t: number, x: number, shells: { x: number; y: number; owner: number; id?: number }[] = []) => ({
  t, tanks: [{ x, y: 1, a: 0, alive: true, special: null, moving: false }], shells, pickups: [], mines: [], beams: [],
});

test('the timeline eases on the host\'s clock, drops overtaken states and pairs shells by id', () => {
  const tl = new Timeline();
  assert.equal(tl.at(5), null);
  // states every 50 ms of host time; arrival delays of 40-70 ms
  tl.push(snapAt(1.0, 1.0), [], 10.04);
  tl.push(snapAt(1.05, 1.1), [], 10.12);
  tl.push(snapAt(1.1, 1.2), [], 10.15);
  // the clock comes from the least delayed state (10.04 - 1.0), drifting up only slowly toward slower ones
  assert.ok(tl.offset! >= 9.04 && tl.offset! < 9.042, `offset ${tl.offset}`);
  assert.equal(tl.push(snapAt(1.05, 9), [], 10.2), false, 'an overtaken state is dropped');
  // shown 0.1 s behind the clock, on host time: not on when the states happened to arrive
  assert.ok(Math.abs(tl.at(10.19)! - (10.19 - tl.offset! - 0.1)) < 1e-12);
  assert.ok(Math.abs(tl.sample(1.05)!.tanks[0].x - 1.1) < 1e-9);
  assert.ok(Math.abs(tl.sample(1.075)!.tanks[0].x - 1.15) < 1e-9);
  // past the newest state a tank is carried on a little way, then held
  assert.ok(Math.abs(tl.sample(1.12)!.tanks[0].x - 1.24) < 1e-9);
  assert.ok(Math.abs(tl.sample(1.5)!.tanks[0].x - 1.3) < 1e-9);
  // shells by id: one dropped from the middle of the list does not swap the others over
  const tl2 = new Timeline();
  tl2.push(snapAt(0, 0, [{ x: 1, y: 1, owner: 0, id: 1 }, { x: 5, y: 5, owner: 0, id: 2 }, { x: 8, y: 1, owner: 0, id: 3 }]), [], 0);
  tl2.push(snapAt(0.05, 0, [{ x: 1.2, y: 1, owner: 0, id: 1 }, { x: 8.2, y: 1, owner: 0, id: 3 }]), [], 0.05);
  const sh = tl2.sample(0.04)!.shells;
  assert.deepEqual(sh.map((s) => [s.id, Math.round(s.x * 100) / 100]), [[1, 1.16], [3, 8.16]]);
  // events wait for the clock
  tl2.push(snapAt(0.1, 0), [{ id: 1, k: 'boom', a: 0, b: 0, x: 0, y: 0 }], 0.1);
  assert.equal(tl2.drain(0.09).events.length, 0);
  assert.equal(tl2.drain(0.1).events.length, 1);
  // a new round drops what came before it
  tl2.reset(0.2, false);
  assert.equal(tl2.push(snapAt(0.15, 0), [], 0.2), false);
  // a link that stays slower is followed within a second or so, not left starving past the newest state
  const tl3 = new Timeline();
  for (let i = 0; i < 20; i++) tl3.push(snapAt(i * 0.05, 0), [], i * 0.05 + 0.04);
  for (let i = 20; i < 40; i++) tl3.push(snapAt(i * 0.05, 0), [], i * 0.05 + 0.24);
  const newest = 39 * 0.05;
  assert.ok(tl3.at(39 * 0.05 + 0.24)! < newest + 0.02, `still showing ${tl3.at(39 * 0.05 + 0.24)! - newest} s past the newest state`);
});

test('a guest shows the events about its own tank at once and skips the shots it already showed', () => {
  const ev = (k: 'fire' | 'kill' | 'bounce' | 'boom' | 'pickup', a: number) => ({ id: 1, k, a, b: 0, x: 0, y: 0 });
  const r = sortEvents([ev('fire', 1), ev('bounce', 1), ev('kill', 1), ev('pickup', 1), ev('fire', 0), ev('kill', 0), ev('boom', 1)], 1, true);
  assert.deepEqual(r.now.map((e) => e.k), ['kill', 'pickup']);
  assert.deepEqual(r.later.map((e) => `${e.k}${e.a}`), ['fire0', 'kill0', 'boom1']);
  // watching, or with a host that drives our tank: everything on the clock
  assert.equal(sortEvents([ev('fire', 1), ev('kill', 1)], 1, false).later.length, 2);
});

// -----------------------------------------------------------------------------------------------------------------
// Host + guest over a slow link

/** One way of a fast (unordered) channel: each message on its own delay, some lost. */
class Wire {
  private q: { at: number; data: string }[] = [];
  private rand: () => number;
  private lat: number;
  private jit: number;
  private loss: number;
  constructor(rand: () => number, lat: number, jit: number, loss: number) {
    this.rand = rand;
    this.lat = lat;
    this.jit = jit;
    this.loss = loss;
  }
  send(now: number, data: unknown) {
    if (this.rand() < this.loss) return;
    this.q.push({ at: now + this.lat + this.rand() * this.jit, data: JSON.stringify(data) });
  }
  take(now: number): unknown[] {
    const due = this.q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at);
    this.q = this.q.filter((m) => m.at > now);
    return due.map((m) => JSON.parse(m.data));
  }
}

type Link = { lat: number; jit: number; loss: number };

/** A point's path frame by frame: how often it stepped backward against its last step, and how often it stood still when it should be moving. */
class Track {
  private prev: { x: number; y: number } | null = null;
  private last: { x: number; y: number } | null = null;
  reversals = 0;
  stalls = 0;
  see(p: { x: number; y: number }, moving: boolean) {
    if (this.prev) {
      const m = { x: p.x - this.prev.x, y: p.y - this.prev.y };
      const len = Math.hypot(m.x, m.y);
      if (this.last && len > 1e-4 && m.x * this.last.x + m.y * this.last.y < 0) this.reversals++;
      if (moving && len < 1e-4) this.stalls++;
      if (len > 1e-4) this.last = m;
    }
    this.prev = { x: p.x, y: p.y };
  }
}

type Run = {
  /** Frames from the first frame of input until the guest's own tank moves on its screen. */
  respond: number;
  /** Frames from a fire press until the guest sees its shell, averaged. */
  shellShown: number;
  /** The guest's own tank on its screen: frames it stepped backward, or stood still mid-drive. */
  ownBack: number;
  ownStall: number;
  /** The host's tank on the guest's screen, the same. */
  hostBack: number;
  hostStall: number;
  /** The guest's tank on the host's screen, the same. */
  copyBack: number;
  copyStall: number;
  /** Where the host has the guest's tank against where the guest's screen shows it, while driving (cells). */
  errMean: number;
  errMax: number;
  /** Times the host moved the guest's warp on (the guest took the host's pose). */
  warps: number;
  /** Host shells of the guest's shots against the guest's own shells at the same age (cells), and own shells gone while the host's flew on. */
  pathOff: number;
  lost: number;
};

/** The guest's driving: right, down, left, stop; fire twice on the way. */
const guestDir = (t: number) => (t < 0.5 ? undefined : t < 1.7 ? 0 : t < 2.5 ? Math.PI / 2 : t < 3.7 ? Math.PI : undefined);
const FIRES = [1.0, 2.1];
/** Stretches of steady driving (well after each turn, allowing for the old guest's delay). */
const steady = (t: number) => (t >= 1.0 && t < 1.6) || (t >= 2.95 && t < 3.6);
/** The host drives round in circles the whole time. */
const hostDir = (t: number) => 2 * t;

function simulate(mode: 'old' | 'new', link: Link, seed: number, maze = false): Run {
  const rand = mulberry32(seed);
  const up = new Wire(rand, link.lat, link.jit, link.loss);
  const down = new Wire(rand, link.lat, link.jit, link.loss);
  // (in a real maze the guest drives into walls and slides along them, and the host bumps around)
  const walls = () => (maze ? createMaze(10, 6, seed) : arena(10, 6));
  const host = room(walls());
  const guest = room(walls());
  const me = 1;
  // new
  const d = newDriver(0);
  hearInput(d, { k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, seq: 0 }, 0);
  const tags = new Map<number, number>();
  let warp = 0;
  const own = newOwn();
  ownRound(own, 0);
  const tl = new Timeline();
  // old
  // (the old host started a guest's count at -1, so its first input fired a shot; in a real round that lands in the
  // countdown and is dropped, so the old run starts it where that leaves it)
  const oldIn = { turn: 0 as -1 | 0 | 1, move: 0 as -1 | 0 | 1, dir: undefined as number | undefined, fc: 0, lastFc: 0 };
  const oldSnaps: { at: number; tanks: { x: number; y: number }[]; shells: { x: number; y: number }[] }[] = [];
  let oldFc = 0;
  let lastSent = { dir: undefined as number | undefined, fc: 0, t: -1 };
  let lastNet = -1e9;

  let respond = -1;
  let ownPrev: { x: number; y: number } | null = null;
  const ownTrack = new Track();
  const hostTrack = new Track();
  const copyTrack = new Track();
  const errs: number[] = [];
  const fired: number[] = [];
  const shown: number[] = [];
  const hostPaths = new Map<number, Map<number, { x: number; y: number }>>();
  const guestPaths = new Map<number, Map<number, { x: number; y: number }>>();
  let lost = 0;

  for (let f = 0; f < 6 * 60; f++) {
    const now = f * STEP;
    const nowMs = now * 1000;
    // ---- host frame
    for (const msg of up.take(now)) {
      const pkt = parsePacket(msg);
      if (!pkt || pkt.k !== 'in') continue;
      if (mode === 'new') hearInput(d, pkt, host.time);
      else Object.assign(oldIn, { turn: pkt.turn, move: pkt.move, dir: pkt.dir, fc: pkt.fireCount });
    }
    const inputs: TankInput[] = [drive(hostDir(now)), noInput];
    let shot: number | null = null;
    if (mode === 'new') {
      const r = driverInput(host, host.tanks[me], d, warp, host.time);
      warp = r.warp;
      inputs[me] = r.input;
      shot = r.shot;
    } else {
      const fire = oldIn.fc > oldIn.lastFc;
      if (fire) oldIn.lastFc = oldIn.fc;
      inputs[me] = { turn: oldIn.turn, move: oldIn.move, fire, ...(oldIn.dir !== undefined ? { dir: oldIn.dir } : {}) };
    }
    const first = host.nextShell;
    step(host, inputs, STEP);
    // (a round that never ends: a shell that finds a tank is spent, but the tank drives on, so the run measures only the link)
    for (const t of host.tanks) t.alive = true;
    host.phase = 'play';
    const tag = mode === 'new' ? shotFired(host, me, d, shot) : null;
    for (const s of host.shells) {
      if (s.owner !== me) continue;
      if (tag !== null && s.id >= first) tags.set(s.id, tag);
      if (!hostPaths.has(s.id)) hostPaths.set(s.id, new Map());
      hostPaths.get(s.id)!.set(Math.round(s.age * 60), { x: s.x, y: s.y });
    }
    copyTrack.see(host.tanks[me], false);
    if (nowMs - lastNet > 40) {
      lastNet = nowMs;
      const base = {
        roomRound: 1, tick: Math.round(host.time * 60), phase: 'play' as const, phaseT: 0,
        tanks: host.tanks.map((t) => ({ x: t.x, y: t.y, a: t.a, alive: t.alive, special: t.special, moving: false })),
        pickups: [], mines: [], beams: [], scores: [0, 0], events: [],
      };
      down.send(
        now,
        mode === 'new'
          ? statePacket({ ...base, shells: host.shells.map((s) => ({ x: s.x, y: s.y, owner: s.owner, id: s.id, tag: tags.get(s.id) })), warps: [0, warp], acks: [0, d.done], seqs: [0, Math.max(0, d.seq)] })
          : statePacket({ ...base, shells: host.shells.map((s) => ({ x: s.x, y: s.y, owner: s.owner })) }),
      );
    }

    // ---- guest frame
    for (const msg of down.take(now)) {
      const pkt = parsePacket(msg);
      if (!pkt || pkt.k !== 's') continue;
      if (mode === 'new') {
        const snap = { t: pkt.tick / 60, tanks: pkt.tanks, shells: pkt.shells, pickups: pkt.pickups, mines: pkt.mines, beams: pkt.beams };
        const before = new Set(own.shots);
        if (tl.push(snap, [], now)) ownHear(own, guest.tanks[me], me, pkt, now);
        // a shell of ours gone here while the host's still flies
        for (const s of before) if (!own.shots.includes(s) && host.shells.some((h) => tags.get(h.id) === s.fc)) lost++;
      } else {
        oldSnaps.push({ at: nowMs, tanks: pkt.tanks.map((t) => ({ x: t.x, y: t.y })), shells: pkt.shells.map((s) => ({ x: s.x, y: s.y })) });
        if (oldSnaps.length > 3) oldSnaps.shift();
      }
    }
    const dir = guestDir(now);
    const fire = FIRES.some((t) => Math.abs(t - now) < STEP / 2);
    const input: TankInput = { ...(dir === undefined ? idle : drive(dir)), fire };
    if (fire) fired.push(f);
    let ownShown: { x: number; y: number };
    let hostShown: { x: number; y: number } | null = null;
    let shells = 0;
    if (mode === 'new') {
      const at = tl.at(now);
      const view = at === null ? null : tl.sample(at);
      if (view) {
        hostShown = { x: view.tanks[0].x, y: view.tanks[0].y };
        Object.assign(guest.tanks[0], hostShown, { a: view.tanks[0].a });
      }
      ownStep(own, guest, me, input, STEP, true, now);
      for (const s of own.shots) {
        if (!guestPaths.has(s.fc * 10 + s.k)) guestPaths.set(s.fc * 10 + s.k, new Map());
        guestPaths.get(s.fc * 10 + s.k)!.set(Math.round(s.s.age * 60), { x: s.s.x, y: s.s.y });
      }
      const flying = covered(own);
      shells = (view?.shells ?? []).filter((s) => s.owner === me && (s.id === undefined || !flying.has(s.id))).length + own.shots.filter((s) => s.hidden === null).length;
      ownShown = { x: guest.tanks[me].x, y: guest.tanks[me].y };
      if (dir !== lastSent.dir || own.fc !== lastSent.fc || nowMs - lastSent.t > 33) {
        lastSent = { dir, fc: own.fc, t: nowMs };
        up.send(now, inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, dir, ...ownReport(own, guest.tanks[me], now) }));
      }
    } else {
      if (fire) oldFc++;
      if (dir !== lastSent.dir || fire || nowMs - lastSent.t > 33) {
        lastSent = { dir, fc: oldFc, t: nowMs };
        up.send(now, inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, dir, fireCount: oldFc }));
      }
      // the old guest: everyone, its own tank too, eased between the last two states 90 ms behind their arrival
      ownShown = { x: guest.tanks[me].x, y: guest.tanks[me].y };
      if (oldSnaps.length) {
        const a = oldSnaps[Math.max(0, oldSnaps.length - 2)];
        const b = oldSnaps[oldSnaps.length - 1];
        const fr = oldSnaps.length === 1 ? 1 : Math.max(0, Math.min(1.5, (nowMs - 90 - a.at) / Math.max(1, b.at - a.at)));
        const lerp = (i: number) => ({ x: a.tanks[i].x + (b.tanks[i].x - a.tanks[i].x) * fr, y: a.tanks[i].y + (b.tanks[i].y - a.tanks[i].y) * fr });
        ownShown = lerp(me);
        hostShown = lerp(0);
        shells = Math.min(a.shells.length, b.shells.length);
      }
    }
    while (shown.length < fired.length && shells > shown.length) shown.push(f - fired[shown.length]);

    // ---- what each screen shows
    if (respond < 0 && dir !== undefined && ownPrev && Math.hypot(ownShown.x - ownPrev.x, ownShown.y - ownPrev.y) > 1e-4) respond = f - 30;
    ownPrev = ownShown;
    ownTrack.see(ownShown, !maze && steady(now));
    if (hostShown) hostTrack.see(hostShown, !maze && now > 1);
    if (now >= 0.6 && now < 3.7) errs.push(Math.hypot(host.tanks[me].x - ownShown.x, host.tanks[me].y - ownShown.y));
  }
  // (the guest's tank as the host shows it: stalls only count on steady stretches, judged afterward)
  let pathOff = 0;
  for (const [id, hp] of hostPaths) {
    const gp = guestPaths.get((tags.get(id) ?? -1) * 10);
    if (!gp) continue;
    for (const [age, p] of hp) {
      const q = gp.get(age);
      if (q) pathOff = Math.max(pathOff, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    respond,
    shellShown: mean(shown),
    ownBack: ownTrack.reversals,
    ownStall: ownTrack.stalls,
    hostBack: hostTrack.reversals,
    hostStall: hostTrack.stalls,
    copyBack: copyTrack.reversals,
    copyStall: copyTrack.stalls,
    errMean: mean(errs),
    errMax: Math.max(...errs),
    warps: warp,
    pathOff,
    lost,
  };
}

const LINKS: [string, Link][] = [
  ['RTT 60-150 ms, 1% loss', { lat: 0.03, jit: 0.045, loss: 0.01 }],
  ['RTT 140-160 ms', { lat: 0.07, jit: 0.01, loss: 0 }],
];

const table = (name: string, runs: Record<'old' | 'new', Run[]>) => {
  const avg = (rs: Run[], k: keyof Run) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  const max = (rs: Run[], k: keyof Run) => Math.max(...rs.map((r) => r[k]));
  return (['old', 'new'] as const).map((mode) => {
    const rs = runs[mode];
    return (
      `${name.padEnd(30)} ${mode.padEnd(4)} respond ${avg(rs, 'respond').toFixed(1)} frames, shell shown ${avg(rs, 'shellShown').toFixed(1)} frames | ` +
      `own tank back ${avg(rs, 'ownBack').toFixed(1)} stall ${avg(rs, 'ownStall').toFixed(1)} | host tank on guest back ${avg(rs, 'hostBack').toFixed(1)} stall ${avg(rs, 'hostStall').toFixed(1)} | ` +
      `guest tank on host back ${avg(rs, 'copyBack').toFixed(1)} | host-vs-guest ${avg(rs, 'errMean').toFixed(3)} mean ${max(rs, 'errMax').toFixed(3)} max` +
      (mode === 'new' ? ` | warps ${max(rs, 'warps')}, shell paths apart ${max(rs, 'pathOff').toExponential(1)}, shells lost early ${max(rs, 'lost')}` : '')
    );
  });
};

test('over a slow, jittery link a guest drives and fires at once, never snaps back, and sees the host smoothly', () => {
  const rows: string[] = [];
  for (const maze of [false, true]) {
    for (const [name, link] of LINKS) {
      const runs = { old: [] as Run[], new: [] as Run[] };
      for (let seed = 1; seed <= 6; seed++) for (const mode of ['old', 'new'] as const) runs[mode].push(simulate(mode, link, seed, maze));
      const lines = table(`${maze ? 'maze' : 'open room'}, ${name}`, runs);
      rows.push(...lines);
      console.log(lines.join('\n'));
      const n = runs.new;
      const max = (k: keyof Run) => Math.max(...n.map((r) => r[k]));
      const avg = (rs: Run[], k: keyof Run) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
      assert.ok(max('respond') <= 0, 'own tank moves on the frame its input starts');
      assert.ok(max('shellShown') <= 0, 'own shell shows on the frame it is fired');
      assert.equal(max('ownBack'), 0, 'no backward snaps of the own tank');
      assert.equal(max('ownStall'), 0, 'the own tank never stutters while driving');
      // (in a maze the host's own tank really does bounce back off walls as it circles)
      if (!maze) assert.equal(max('hostBack'), 0, 'no backward jumps of the host tank');
      assert.equal(max('hostStall'), 0, 'the host tank never stutters');
      if (!maze) assert.ok(max('copyBack') <= 4, 'the guest\'s tank on the host steps back only where the guest turned');
      assert.equal(max('warps'), 0, 'the host takes an honest guest\'s word every time');
      assert.ok(max('pathOff') < 1e-9, 'the guest\'s shells fly the host\'s path');
      assert.equal(max('lost'), 0, 'no shell of ours goes while the host\'s flies');
      assert.ok(avg(n, 'errMean') < avg(runs.old, 'errMean'), 'the host has the guest\'s tank nearer where the guest sees it');
      assert.ok(max('errMax') < 0.35, 'the host never strays far from the guest\'s tank');
    }
  }
});
