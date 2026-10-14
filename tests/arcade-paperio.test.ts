import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BRUSH,
  EDGE,
  GRACE,
  HIT,
  SPEED,
  START_R,
  TICK,
  addPlayer,
  advance,
  applyDeath,
  applyRuns,
  createWorld,
  drive,
  findSpawn,
  headOn,
  kill,
  loadOwners,
  ownerHash,
  percent,
  ranking,
  spawnAt,
  takeDirty,
  type Op,
  type Player,
  type World,
} from '../src/os/arcade/games/paperio/world.ts';
import { botNames, makeMind, personas, wayHome, type Mind } from '../src/os/arcade/games/paperio/bots.ts';
import { assignColors, createMatch, finish, matchTick, standings } from '../src/os/arcade/games/paperio/match.ts';
import { SKINS, earned, freshLocker, parseLocker, record } from '../src/os/arcade/games/paperio/skins.ts';

/** A small arena with players already placed. */
function world(radius = 120) {
  return createWorld({ radius, seed: 7 });
}

/** Walks a head through waypoints in short steps, like the game's ticks do. */
function walk(w: World, p: Player, pts: [number, number][]) {
  for (const [x, y] of pts) {
    const sx = p.rx;
    const sy = p.ry;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - sx, y - sy) / 0.5));
    for (let i = 1; i <= steps; i++) {
      p.x = sx + ((x - sx) * i) / steps;
      p.y = sy + ((y - sy) * i) / steps;
      drive(w, p, p.x, p.y);
      if (!p.alive) return;
    }
  }
}

const cellOf = (w: World, x: number, y: number) => Math.floor(y) * w.n + Math.floor(x);
const ownerAt = (w: World, x: number, y: number) => w.owner[cellOf(w, x, y)];

test('the arena is a disc, and you start on a round patch of your own land', () => {
  const w = world();
  const c = w.c;
  assert.equal(w.arena[cellOf(w, c, c)], 1);
  assert.equal(w.arena[cellOf(w, c + w.r + 2, c)], 0);
  const expected = Math.PI * w.r * w.r;
  assert.ok(Math.abs(w.arenaCells - expected) / expected < 0.01);
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  spawnAt(w, a, c, c);
  assert.ok(a.alive);
  assert.equal(ownerAt(w, c + 0.5, c + 0.5), 1);
  assert.equal(ownerAt(w, c + START_R - 2, c), 1);
  assert.equal(ownerAt(w, c + START_R + 3, c), 0);
  const blob = Math.PI * START_R * START_R;
  assert.ok(Math.abs(w.counts[1] - blob) / blob < 0.08);
  assert.ok(Math.abs(percent(w, 0) - (w.counts[1] / w.arenaCells) * 100) < 1e-9);
  assert.equal(w.counts.reduce((s, v) => s + v, 0), w.arenaCells);
});

test('leaving home draws a trail; coming back claims exactly the box you drew', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c, c);
  const before = w.counts[1];
  walk(w, a, [[c + 50.5, c + 0.5]]);
  assert.ok(a.out, 'outside your land you are out');
  assert.ok(a.trailLen > 0);
  assert.equal(w.trail[cellOf(w, c + 40, c)], 1);
  walk(w, a, [
    [c + 50.5, c + 40.5],
    [c + 0.5, c + 40.5],
    [c + 0.5, c + 0.5],
  ]);
  assert.ok(a.alive);
  assert.ok(!a.out, 'home again');
  assert.equal(a.trailLen, 0);
  // every cell inside the loop is ours now, and nothing is left as trail
  for (let y = c + 2; y < c + 39; y += 3) for (let x = c + 2; x < c + 49; x += 3) assert.equal(ownerAt(w, x, y), 1, `cell ${x},${y}`);
  assert.equal(w.trail.indexOf(1), -1);
  // outside the loop stays blank
  assert.equal(ownerAt(w, c + 60, c + 20), 0);
  assert.equal(ownerAt(w, c + 25, c + 50), 0);
  const gained = w.counts[1] - before;
  assert.ok(gained > 50 * 40 * 0.6 && gained < 58 * 48, `gained ${gained}`);
  const ev = w.events.find((e) => e.t === 'capture');
  assert.ok(ev && ev.t === 'capture' && ev.gained === gained);
  assert.equal(w.counts.reduce((s, v) => s + v, 0), w.arenaCells);
});

test('closing a loop takes enemy land inside it, and takes all of it if they had nothing else', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const b = addPlayer(w, { name: 'b', color: 1, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c - 60, c);
  // b's land: a small square well inside the loop a is about to draw, plus a strip outside it
  for (let y = c - 10; y < c + 10; y++) for (let x = c - 10; x < c + 10; x++) applyRuns(w, 1, [y, x, 1]);
  b.alive = true;
  b.joined = true;
  b.x = b.rx = c + 0.5;
  b.y = b.ry = c + 0.5;
  for (let y = c + 70; y < c + 75; y++) applyRuns(w, 1, [y, c - 5, 10]);
  const bLand = w.counts[2];
  walk(w, a, [
    [c - 30.5, c - 40.5],
    [c + 40.5, c - 40.5],
    [c + 40.5, c + 40.5],
    [c - 30.5, c + 40.5],
    [c - 60.5, c + 0.5],
  ]);
  assert.ok(a.alive && !a.out);
  assert.equal(ownerAt(w, c, c), 1, 'the enemy square is ours now');
  assert.equal(ownerAt(w, c, c + 72), 2, 'their land outside the loop is still theirs');
  assert.equal(w.counts[2], bLand - 400);
  assert.ok(b.alive, 'b keeps going with the land it has left');
  // now take the rest
  walk(w, a, [
    [c - 20.5, c + 35.5],
    [c - 20.5, c + 85.5],
    [c + 15.5, c + 85.5],
    [c + 15.5, c + 35.5],
  ]);
  assert.equal(w.counts[2], 0);
  assert.ok(!b.alive, 'with no land left you are wiped out');
  assert.equal(b.cause, 'wiped');
  assert.equal(b.killer, a.id);
  assert.equal(a.kills, 1);
});

test('closing the mouth of a C-shaped land claims the whole hollow, even past the trail', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c - 70, c - 70);
  // a C: thick walls around a 60 x 60 hollow, open on the east side
  for (let y = c - 40; y <= c + 40; y++)
    for (let x = c - 40; x <= c + 40; x++) {
      const wall = x < c - 30 || y < c - 30 || y > c + 30;
      if (wall) applyRuns(w, 0, [y, x, 1]);
    }
  walk(w, a, [[c - 35.5, c - 35.5]]);
  assert.ok(!a.out);
  // across the mouth, from the top arm to the bottom arm
  walk(w, a, [
    [c + 35.5, c - 35.5],
    [c + 35.5, c + 35.5],
  ]);
  assert.ok(a.alive && !a.out);
  assert.equal(ownerAt(w, c - 20, c), 1, 'the far end of the hollow, nowhere near the trail');
  assert.equal(ownerAt(w, c + 20, c + 20), 1);
  assert.equal(ownerAt(w, c + 50, c), 0);
});

test('touching your own trail is death, and all your land goes blank', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c, c);
  walk(w, a, [
    [c + 50.5, c + 0.5],
    [c + 50.5, c + 30.5],
    [c + 35.5, c + 30.5],
    [c + 35.5, c - 10.5],
  ]);
  assert.ok(!a.alive);
  assert.equal(a.cause, 'self');
  assert.equal(a.killer, -1);
  assert.equal(w.counts[1], 0);
  assert.equal(w.trail.indexOf(1), -1);
  const ev = w.events.find((e) => e.t === 'die');
  assert.ok(ev && ev.t === 'die' && ev.cause === 'self');
});

test('the trail just laid behind you is safe; a full circle back into it is not', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c, c, 0);
  // straight out, then the tightest turn the head allows, held: it comes round into its own trail
  a.want = NaN;
  for (let i = 0; i < 80; i++) {
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
  }
  assert.ok(a.alive && a.out, 'running straight never trips over the fresh trail');
  a.turn = 1;
  let ticks = 0;
  while (a.alive && ticks++ < 600) {
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
  }
  assert.ok(!a.alive);
  assert.equal(a.cause, 'self');
  assert.ok(GRACE > BRUSH * 2, 'the grace window covers the brush reaching ahead');
});

test('running into someone else trail kills them, even crossing it diagonally at speed', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const b = addPlayer(w, { name: 'b', color: 1, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c - 60, c);
  spawnAt(w, b, c + 60, c - 60);
  walk(w, a, [[c + 30.5, c + 0.5]]);
  assert.ok(a.out && a.trailLen > 0);
  // b comes down at a steep diagonal in big jumps across a's trail
  b.rx = c + 10.3;
  b.ry = c - 20.7;
  drive(w, b, c - 6.9, c + 21.4);
  assert.ok(!a.alive);
  assert.equal(a.cause, 'cut');
  assert.equal(a.killer, b.id);
  assert.equal(b.kills, 1);
  assert.equal(w.counts[1], 0, 'their land is blank');
  assert.ok(b.alive);
});

test('heads that meet: the one at home wins, two heads out in the open both crash', () => {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const b = addPlayer(w, { name: 'b', color: 1, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c - 40, c);
  spawnAt(w, b, c + 40, c);
  // a at home, b out on a's land
  walk(w, b, [[c - 30.5, c + 0.5]]);
  assert.ok(b.out && !a.out);
  a.x = c - 32;
  a.y = c + 0.5;
  b.x = a.x + HIT * 0.5;
  b.y = a.y;
  headOn(w);
  assert.ok(a.alive);
  assert.ok(!b.alive);
  assert.equal(b.cause, 'head');
  assert.equal(b.killer, a.id);
  // two heads out in the open
  const w2 = world();
  const p = addPlayer(w2, { name: 'p', color: 0, kind: 'local' });
  const q = addPlayer(w2, { name: 'q', color: 1, kind: 'local' });
  spawnAt(w2, p, c - 50, c);
  spawnAt(w2, q, c + 50, c);
  walk(w2, p, [[c - 5.5, c + 0.5]]);
  walk(w2, q, [[c + 1.5, c + 0.5]]);
  assert.ok(p.out && q.out);
  headOn(w2);
  assert.ok(!p.alive && !q.alive);
});

test('the arena wall stops heads; they slide along it', () => {
  const w = world(80);
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  spawnAt(w, a, Math.floor(w.c), Math.floor(w.c), 0);
  a.h = 0;
  for (let i = 0; i < 600; i++) {
    a.want = 0.3;
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
    const d = Math.hypot(a.x - w.c, a.y - w.c);
    assert.ok(d <= w.r - EDGE + 1e-6, `inside the wall (${d})`);
  }
});

test('a walk between points rounded to hundredths lands exactly on the end cell, however the corners tie', () => {
  // online samples are rounded to 0.01, so segments can end exactly on a grid corner; these two used to step past
  // the end cell and walk a seven cell wide trail all the way to the edge of the map
  const cases: [[number, number], [number, number]][] = [
    [[460.7, 437.5], [461, 436]],
    [[440.7, 461.5], [441, 460]],
  ];
  for (const [[x0, y0], [x1, y1]] of cases) {
    const w = createWorld({ seed: 3 });
    const p = addPlayer(w, { name: 'guest', color: 0, kind: 'remote' });
    spawnAt(w, p, 300, 300);
    p.x = p.rx = x0;
    p.y = p.ry = y0;
    const steps = p.steps;
    drive(w, p, x1, y1);
    assert.equal(p.cell, Math.floor(y1) * w.n + Math.floor(x1), `${x0},${y0} -> ${x1},${y1} ends on its cell`);
    assert.equal(p.steps - steps, Math.abs(Math.floor(x1) - Math.floor(x0)) + Math.abs(Math.floor(y1) - Math.floor(y0)));
    assert.ok(p.trailLen < 60, `a short trail (${p.trailLen})`);
  }
  // and a long diagonal still visits a 4-connected path cell by cell to its end
  const w = createWorld({ seed: 3 });
  const p = addPlayer(w, { name: 'guest', color: 0, kind: 'remote' });
  spawnAt(w, p, 300, 300);
  p.x = p.rx = 400.25;
  p.y = p.ry = 400.75;
  const steps = p.steps;
  drive(w, p, 437.5, 351);
  assert.equal(p.cell, 351 * w.n + 437);
  assert.equal(p.steps - steps, 37 + 49);
});

/** Drives a head straight at the east wall from inside, at `approach` radians off straight in, then `slide` more ticks. */
function toWall(approach: number, slide: number) {
  const w = world();
  const a = addPlayer(w, { name: 'a', color: 0, kind: 'local' });
  const c = Math.floor(w.c);
  spawnAt(w, a, c + 60, c, approach);
  a.want = approach;
  for (let i = 0; i < 600 && Math.hypot(a.x - w.c, a.y - w.c) < w.r - EDGE - 1e-3; i++) {
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
  }
  for (let i = 0; i < slide; i++) {
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
  }
  return { w, a };
}

test('turning back off the wall curves away from it instead of reversing over the trail along it', () => {
  for (const slide of [10, 20, 40]) {
    const { w, a } = toWall(0.5, slide);
    assert.ok(a.alive && a.out);
    assert.ok(Math.hypot(a.x - w.c, a.y - w.c) > w.r - EDGE - 0.01, 'on the wall');
    // the mouse points back the way we came: the short turn goes through "straight into the wall"
    a.want = -2.2;
    for (let i = 0; i < 60 && a.alive; i++) {
      advance(w, a, TICK);
      drive(w, a, a.x, a.y);
    }
    assert.ok(a.alive, `still alive after sliding ${slide} ticks (${a.cause})`);
    assert.ok(Math.hypot(a.x - w.c, a.y - w.c) < w.r - EDGE - 8, 'it came off the wall');
  }
  // with nothing behind it on the wall, the short way is fine and it keeps it
  const { w, a } = toWall(0.15, 0);
  a.want = -1.4;
  for (let i = 0; i < 60 && a.alive; i++) {
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
  }
  assert.ok(a.alive);
});

test('a head that runs into the wall keeps its speed along it', () => {
  const { w, a } = toWall(0.7, 0);
  a.want = NaN;
  a.turn = 0;
  let moved = 0;
  for (let i = 0; i < 120; i++) {
    const x = a.x;
    const y = a.y;
    advance(w, a, TICK);
    drive(w, a, a.x, a.y);
    if (i >= 60) moved += Math.hypot(a.x - x, a.y - y);
    assert.ok(Math.hypot(a.x - w.c, a.y - w.c) <= w.r - EDGE + 1e-6);
  }
  assert.ok(moved >= 0.9 * SPEED, `slides on at ${moved.toFixed(1)} cells a second`);
  assert.ok(a.alive);
  // pointing straight out of the arena, it settles against the wall instead of jittering on its own trail
  const b = toWall(0.3, 0);
  for (let i = 0; i < 600; i++) {
    b.a.want = Math.atan2(b.a.y - b.w.c, b.a.x - b.w.c) + 0.02;
    advance(b.w, b.a, TICK);
    drive(b.w, b.a, b.a.x, b.a.y);
  }
  assert.ok(b.a.alive, `held against the wall (${b.a.cause})`);
});

test('guests mirror the host: runs and deaths applied in order give the same board', () => {
  const host = world();
  const guest = createWorld({ radius: 120, seed: 1, authority: false });
  const ops: Op[] = [];
  host.onOp = (op) => ops.push(op);
  const hp = [addPlayer(host, { name: 'a', color: 0, kind: 'local' }), addPlayer(host, { name: 'b', color: 1, kind: 'local' })];
  const gp = [addPlayer(guest, { name: 'a', color: 0, kind: 'ghost' }), addPlayer(guest, { name: 'b', color: 1, kind: 'ghost' })];
  const c = Math.floor(host.c);
  spawnAt(host, hp[0], c - 30, c);
  spawnAt(host, hp[1], c + 40, c + 40);
  walk(host, hp[0], [
    [c + 20.5, c - 20.5],
    [c + 20.5, c + 20.5],
    [c - 30.5, c + 0.5],
  ]);
  walk(host, hp[1], [
    [c + 40.5, c - 10.5],
    [c - 40.5, c + 50.5],
    [c + 40.5, c + 40.5],
  ]);
  kill(host, hp[0], 1, 'cut');
  for (const op of ops) {
    if (op.k === 'spawn') spawnAt(guest, gp[op.id], op.cx, op.cy, op.h);
    else if (op.k === 'cap') applyRuns(guest, op.id, op.runs);
    else applyDeath(guest, op.id, op.by, op.cause);
  }
  assert.equal(ownerHash(guest), ownerHash(host));
  assert.deepEqual([...guest.counts.slice(0, 3)], [...host.counts.slice(0, 3)]);
  // a full resync lands on the same board too
  const fresh = createWorld({ radius: 120, seed: 1, authority: false });
  addPlayer(fresh, { name: 'a', color: 0, kind: 'ghost' });
  addPlayer(fresh, { name: 'b', color: 1, kind: 'ghost' });
  loadOwners(fresh, host.owner);
  assert.equal(ownerHash(fresh), ownerHash(host));
  assert.ok(takeDirty(fresh));
});

test('spawn spots are mostly blank ground away from other heads', () => {
  const w = world();
  for (let i = 0; i < 4; i++) {
    const p = addPlayer(w, { name: `p${i}`, color: i, kind: 'bot' });
    const s = findSpawn(w);
    assert.ok(s);
    spawnAt(w, p, s.cx, s.cy, s.h);
  }
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) > START_R * 1.5);
  assert.deepEqual(ranking(w).length, 4);
});

test('bots play: they claim land, mostly survive and stay inside the arena', () => {
  const m = createMatch({ seed: 11, humans: [], bots: 8, level: 1, respawn: false, duration: Infinity });
  let caps = 0;
  let deaths = 0;
  let self = 0;
  for (let i = 0; i < 60 * 90; i++) {
    matchTick(m);
    for (const e of m.w.events) {
      if (e.t === 'capture') caps++;
      if (e.t === 'die') {
        deaths++;
        if (e.cause === 'self') self++;
      }
    }
    m.w.events.length = 0;
    if (i % 60 === 0)
      for (const p of m.w.players) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'no NaN heads');
        if (p.alive) assert.ok(Math.hypot(p.x - m.w.c, p.y - m.w.c) <= m.w.r);
      }
  }
  assert.ok(caps > 60, `bots capture often (${caps})`);
  assert.ok(self <= 6, `few self crashes (${self})`);
  assert.ok(deaths < 40, `the field is not a bloodbath (${deaths})`);
  const biggest = Math.max(...m.w.players.map((p) => percent(m.w, p.id)));
  assert.ok(biggest > 2, `someone grows (${biggest.toFixed(1)}%)`);
  assert.equal(m.w.counts.reduce((s, v) => s + v, 0), m.w.arenaCells);
});

test('bots run home when a head gets near their trail, and see other heads late', () => {
  const w = world();
  const b = addPlayer(w, { name: 'bot', color: 0, kind: 'bot' });
  const c = Math.floor(w.c);
  spawnAt(w, b, c, c);
  b.mind = makeMind('cautious', 1, () => 0.5);
  walk(w, b, [[c + 60.5, c + 0.5]]);
  const home = wayHome(w, b);
  assert.ok(home, 'a way home');
  assert.ok(home[1] < c + 40, 'home is back toward the land');
  assert.equal(botNames(5, () => 0.3).length, 5);
  assert.equal(new Set(botNames(20, () => 0.7)).size, 20);
  const mix = personas(4, () => 0.2);
  assert.equal(new Set(mix).size, 4, 'the first four bots are one of each');
});

test('bots never circle a waypoint forever: a short dip out of their land still ends the loop', () => {
  // seed 1 used to leave a cautious bot circling a waypoint on its own land for the rest of the game
  const m = createMatch({ seed: 1, humans: [], bots: 12, level: 0, respawn: false, duration: Infinity });
  const since = new Float64Array(16).fill(-1);
  let worst = 0;
  for (let i = 0; i < 60 * 200; i++) {
    matchTick(m);
    m.w.events.length = 0;
    for (const p of m.w.players) {
      const mind = p.mind as Mind;
      if (p.alive && mind.state === 'loop' && !mind.left && !p.out) {
        if (since[p.id] < 0) since[p.id] = m.w.time;
        worst = Math.max(worst, m.w.time - since[p.id]);
      } else since[p.id] = -1;
    }
  }
  assert.ok(worst < 10, `longest wait at home on an unfinished loop: ${worst.toFixed(1)} s`);
});

test('a timed match ends at the buzzer with the biggest human on top', () => {
  const m = createMatch({
    seed: 3,
    humans: [
      { name: 'p1', skin: 0, kind: 'local', seat: -1 },
      { name: 'p2', skin: 1, kind: 'local', seat: -1 },
    ],
    bots: 2,
    level: 0,
    respawn: true,
    duration: 2,
  });
  assert.notEqual(m.w.players[0].color, m.w.players[1].color);
  for (let i = 0; i < 60 * 2 + 5; i++) matchTick(m);
  assert.ok(m.over);
  assert.ok(m.winner === 0 || m.winner === 1);
  const order = standings(m);
  assert.equal(order.length, 4);
  finish(m);
  const colors = assignColors([0, 0], 5, () => 0.5);
  assert.notEqual(colors.humans[0], colors.humans[1], 'two humans never share a color');
  assert.equal(new Set([...colors.humans, ...colors.bots]).size, 7);
});

test('skins unlock at their milestones and a broken save is safe', () => {
  const l = freshLocker();
  assert.deepEqual(l.have, [0, 1, 2]);
  const r1 = record(l, { pct: 12, kills: 3, game: true });
  assert.ok(r1.fresh.some((s) => s.key === 'tree'));
  assert.ok(!r1.fresh.some((s) => s.key === 'cox'));
  const r2 = record(r1.locker, { pct: 30, kills: 7, streak: 3, first: true, game: true });
  for (const key of ['cox', 'oar', 'pi', 'dish']) assert.ok(r2.locker.have.includes(SKINS.find((s) => s.key === key)!.id), key);
  assert.equal(r2.locker.stats.kills, 10);
  assert.ok(earned({ kind: 'pct', n: 100 }, { ...r2.locker.stats, best: 100 }));
  assert.deepEqual(parseLocker('not json'), freshLocker());
  const parsed = parseLocker(JSON.stringify({ have: [0, 99, 'x'], pick: 99, stats: { best: 55, kills: -4, games: 2 } }));
  assert.equal(parsed.pick, 0);
  assert.ok(parsed.have.includes(SKINS.find((s) => s.key === 'hoover')!.id), 'earned skins come back from the stats');
  assert.equal(parsed.stats.kills, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Online: packets and a whole room in memory

import { F_ALIVE, F_OUT, decodeRows, encodeRows, endPacket, helloPacket, initPacket, movePacket, opPackets, parsePacket, pausePacket, quant, resyncPacket, snapshotPackets, splitOp, statePacket, MAX_BYTES, type NetOp } from '../src/os/arcade/games/paperio/net.ts';
import { GO, Track, guestCtl, hostCtl } from '../src/os/arcade/games/paperio/session.ts';
import { botTick } from '../src/os/arcade/games/paperio/bots.ts';
import type { Ctl, Net } from '../src/os/arcade/games/paperio/ctl.ts';
import { mulberry32 } from '../src/os/arcade/games/paperio/world.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('packets round trip through JSON, and junk or other games’ packets are ignored', () => {
  const roster = [
    { id: 0, seat: 0, name: 'josh', color: 0, skin: 4, bot: false },
    { id: 1, seat: -1, name: 'hoover', color: 13, skin: 10, bot: true },
  ];
  const i = parsePacket(clone(initPacket(3, 360, 180, 2.5, roster)));
  assert.deepEqual(i, { k: 'I', round: 3, radius: 360, duration: 180, go: 2.5, roster });
  const ops: NetOp[] = [
    { k: 'spawn', id: 2, cx: 100, cy: 220, h: -1.234 },
    { k: 'cap', id: 2, runs: [10, 5, 3, 10, 20, 4, 11, 6, 2, 400, 1, 7] },
    { k: 'die', id: 1, by: 2, cause: 'cut' },
    { k: 'die', id: 4, by: -1, cause: 'self' },
    { k: 'look', id: 3, color: 7, skin: 9 },
  ];
  const packs = opPackets(3, 17, ops);
  assert.equal(packs.length, 1);
  const o = parsePacket(clone(packs[0]));
  assert.ok(o && o.k === 'O');
  assert.equal(o.seq, 17);
  assert.deepEqual(o.ops, ops);
  // big captures split into pieces that each fit, and every message stays under the room cap
  const big: NetOp = { k: 'cap', id: 5, runs: Array.from({ length: 3000 }, (_, j) => [j, (j * 7) % 600, 1 + (j % 50)]).flat() };
  const pieces = splitOp(big);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.slice(1).every((p) => 'more' in p));
  const msgs = opPackets(3, 1, pieces);
  for (const m of msgs) assert.ok(JSON.stringify(m).length < 8 * 1024, 'under 8 KB');
  const back = msgs.flatMap((m) => (parsePacket(clone(m)) as { ops: NetOp[] }).ops);
  assert.deepEqual(back.flatMap((p) => (p.k === 'cap' ? p.runs : [])), (big as { runs: number[] }).runs);
  const st = parsePacket(clone(statePacket(3, 600, 12.34, 0, 40, 123456, [{ id: 1, x: 10.04, y: 20.06, h: 1.5, f: F_ALIVE | F_OUT, kills: 2, life: 3 }])));
  assert.ok(st && st.k === 'S');
  assert.equal(st.hash, 123456);
  assert.deepEqual(st.heads[0], { id: 1, x: 10, y: 20.1, h: 1.5, f: 3, kills: 2, life: 3 });
  assert.equal(parsePacket(clone(statePacket(3, 600, 1, 0, 40, null, [])))?.k, 'S');
  const mv = parsePacket(clone(movePacket(3, 2, 99, [quant(10.123), quant(20.456), quant(11), quant(21)], 0.5, true)));
  assert.deepEqual(mv, { k: 'M', round: 3, life: 2, seq: 99, pts: [10.12, 20.46, 11, 21], h: 0.5, dead: true });
  assert.deepEqual(parsePacket(clone(endPacket(3, 1, [1, 0], [40.5, 3.25]))), { k: 'E', round: 3, winner: 1, order: [1, 0], pct: [40.5, 3.25] });
  assert.deepEqual(parsePacket(clone(helloPacket(3, 5))), { k: 'H', round: 3, skin: 5 });
  assert.deepEqual(parsePacket(clone(resyncPacket(3))), { k: 'Q', round: 3 });
  assert.deepEqual(parsePacket(clone(pausePacket(3, true))), { k: 'P', round: 3, away: true });
  assert.deepEqual(parsePacket(clone(pausePacket(3, false))), { k: 'P', round: 3, away: false });
  assert.equal(parsePacket({ t: 'po', r: 3, k: 'P', a: 2 }), null);
  for (const junk of [null, 5, 'x', {}, { t: 'pk', r: 1, k: 'S' }, { t: 'po', r: 1.5, k: 'Q' }, { t: 'po', r: 1, k: 'O', s: 1, o: [['c', 1, 0, -5, 3]] }, { t: 'po', r: 1, k: 'O', s: 1, o: [['d', 99, 0, 0]] }, { t: 'po', r: 1, k: 'M', l: 1, s: 1, p: [1], h: 0 }, { t: 'po', r: 1, k: 'Z', z: 1, s: 1, i: 3, of: 2, y0: 0, rows: [] }])
    assert.equal(parsePacket(junk), null, JSON.stringify(junk));
});

test('snapshots rebuild the board exactly, in chunks under the room cap', () => {
  const w = createWorld({ radius: 360, seed: 2 });
  const rng = mulberry32(5);
  for (let k = 0; k < 4000; k++) {
    const y = Math.floor(rng() * w.n);
    const x = Math.floor(rng() * w.n);
    applyRuns(w, Math.floor(rng() * 6), [y, x, 1 + Math.floor(rng() * 30)].map((v, i) => (i === 2 ? Math.min(v, w.n - x) : v)));
  }
  const packs = snapshotPackets(1, 1, 50, w.owner, w.n);
  assert.ok(packs.length > 1);
  for (const p of packs) assert.ok(JSON.stringify(p).length < MAX_BYTES + 2048);
  const grid = new Uint8Array(w.n * w.n);
  for (const p of packs) {
    const z = parsePacket(clone(p));
    assert.ok(z && z.k === 'Z');
    assert.ok(decodeRows(grid, w.n, z.y0, z.rows));
  }
  assert.deepEqual(grid, w.owner);
  assert.equal(decodeRows(grid, w.n, 0, [[0, w.n + 1]]), false, 'rows must add up to the width');
  assert.deepEqual(encodeRows(new Uint8Array([1, 1, 0, 2]), 4, 0, 0), [[1, 2, 0, 1, 2, 1]]);
});

test('remote heads are drawn between states, and late or duplicate states are dropped', () => {
  const t = new Track();
  const pose = { x: 0, y: 0, h: 0, alive: true, out: false };
  t.push(1, 0, 0, 0, F_ALIVE);
  t.push(1.1, 10, 0, 0, F_ALIVE | F_OUT);
  t.push(1.05, 99, 99, 0, 0);
  t.push(1.1, 99, 99, 0, 0);
  assert.equal(t.size, 2);
  t.sample(1.05, pose);
  assert.ok(Math.abs(pose.x - 5) < 1e-9);
  // a respawn far away snaps instead of sliding across the map
  t.push(1.2, 300, 300, 0, F_ALIVE);
  t.sample(1.15, pose);
  assert.equal(pose.x, 300);
});

/** A room in memory: reliable messages arrive in order after a delay; fast ones can be late, out of order or lost. */
class MemRoom {
  now = 0;
  players: { seat: number; name: string }[] = [];
  private queue: { at: number; from: number; to: number; d: unknown; order: number }[] = [];
  private listeners = new Map<number, Set<(from: number, d: unknown) => void>>();
  private lastReliable = new Map<string, number>();
  private n = 0;
  rng = mulberry32(99);
  loss = 0;
  /** Drop the next reliable message from the host to this seat (a gap the guest must notice). */
  dropNextTo: number | null = null;
  reports: (number | null)[] = [];
  bytes = 0;
  latency = 0.04;
  jitter = 0.03;

  net(seat: number, round = 1): Net {
    return {
      seat,
      round,
      isHost: seat === 0,
      players: () => this.players,
      send: (d, opts) => {
        const to = seat === 0 ? (opts?.to !== undefined ? [opts.to] : this.players.map((p) => p.seat).filter((s) => s !== 0)) : [0];
        const text = JSON.stringify(d);
        this.bytes += text.length;
        assert.ok(text.length < 8 * 1024, `message under 8 KB (${text.length})`);
        for (const r of to) {
          if (opts?.fast) {
            if (this.rng() < this.loss) continue;
            this.queue.push({ at: this.now + this.latency + this.rng() * this.jitter, from: seat, to: r, d: JSON.parse(text), order: this.n++ });
          } else {
            if (seat === 0 && this.dropNextTo === r) {
              this.dropNextTo = null;
              continue;
            }
            const key = `${seat}>${r}`;
            const at = Math.max(this.lastReliable.get(key) ?? 0, this.now + this.latency);
            this.lastReliable.set(key, at);
            this.queue.push({ at, from: seat, to: r, d: JSON.parse(text), order: this.n++ });
          }
        }
      },
      onMessage: (fn) => {
        let set = this.listeners.get(seat);
        if (!set) this.listeners.set(seat, (set = new Set()));
        set.add(fn);
        return () => set.delete(fn);
      },
      report: (winner) => this.reports.push(winner),
    };
  }

  pump() {
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.queue.length && this.queue[0].at <= this.now) {
      const m = this.queue.shift()!;
      if (!this.players.some((p) => p.seat === m.to)) continue;
      for (const fn of this.listeners.get(m.to) ?? []) fn(m.from, m.d);
    }
  }
}

/**
 * Rounds whose result is showing. Like the game: once a round is over the page asks for the result once, the shell
 * shows it, and the loop stops, so that page never runs another frame or tick of the round.
 */
const shown = new WeakSet<Ctl>();
function endIfOver(c: Ctl) {
  if (shown.has(c) || !c.isOver()) return;
  shown.add(c);
  c.online?.finish();
  c.online?.result();
}

/** Runs a host and guests for `secs`, each human steered by the bot brain on its own copy of the world. */
function play(room: MemRoom, ctls: Ctl[], secs: number, steer = true) {
  const dt = 1 / 60;
  for (let i = 0; i < secs * 60; i++) {
    room.now += dt;
    for (const c of ctls) {
      if (shown.has(c)) continue;
      c.frame?.(dt);
      if (steer)
        for (const id of c.locals) {
          const p = c.w.players[id];
          if (p?.alive) {
            p.mind ??= makeMind('defender', 1, mulberry32(id * 7 + 1));
            botTick(c.w, p, dt);
          }
        }
      c.tick();
      c.w.events.length = 0;
      endIfOver(c);
    }
    room.pump();
  }
}

/** Stops everyone and lets the last messages land. */
function settle(room: MemRoom, ctls: Ctl[], secs = 3) {
  const dt = 1 / 60;
  for (let i = 0; i < secs * 60; i++) {
    room.now += dt;
    for (const c of ctls) {
      if (shown.has(c)) continue;
      c.frame?.(dt);
      endIfOver(c);
    }
    room.pump();
  }
}

function room3(loss = 0) {
  const room = new MemRoom();
  room.loss = loss;
  room.players = [
    { seat: 0, name: 'host' },
    { seat: 1, name: 'ana' },
    { seat: 2, name: 'ben' },
  ];
  const host = hostCtl(room.net(0), { skin: 0, fill: 6, level: 1, length: 1.5, seed: 21 });
  const guests = [guestCtl(room.net(1), { skin: 4, fill: 0, level: 1, length: 1 }), guestCtl(room.net(2), { skin: 6, fill: 0, level: 1, length: 1 })];
  return { room, host, guests, all: [host, ...guests] };
}

test('online: guests see the same board as the host, and their own heads where they drove them', () => {
  const { room, host, guests, all } = room3();
  play(room, all, GO + 25);
  for (const g of guests) assert.ok(g.online?.ready(), 'guests joined');
  assert.equal(guests[0].w.players.length, host.w.players.length);
  assert.equal(guests[0].w.players[guests[0].locals[0]].color, SKINS[4].color, 'a guest wears its skin color');
  assert.equal(host.w.players[guests[0].locals[0]].skin, 4);
  // the host walked each guest's head where the guest said it went
  for (const g of guests) {
    const id = g.locals[0];
    const mine = g.w.players[id];
    const theirs = host.w.players[id];
    if (mine.alive && theirs.alive) assert.ok(Math.hypot(mine.x - theirs.x, mine.y - theirs.y) < 12, 'host has the guest head close to where it is');
  }
  settle(room, all);
  for (const g of guests) {
    assert.equal(ownerHash(g.w), ownerHash(host.w), 'same board after the last ops land');
    for (const p of host.w.players) assert.equal(g.w.players[p.id].alive, p.alive, `${p.name} alive matches`);
  }
  const caps = host.w.players.filter((p) => p.seat > 0).map((p) => p.peak);
  assert.ok(caps.every((pc) => pc > 0.3), 'guests captured land through the host');
  assert.ok(room.bytes / 28 < 60_000, `bandwidth stays small (${(room.bytes / 28 / 1024).toFixed(1)} KB/s)`);
  for (const c of all) c.dispose();
});

test('online: lost and shuffled fast packets cost nothing, a lost op is noticed and resynced', () => {
  const { room, host, guests, all } = room3(0.3);
  play(room, all, GO + 8);
  // lose one reliable message to the first guest: a gap in the numbered ops
  room.dropNextTo = 1;
  play(room, all, 14);
  settle(room, all, 5);
  for (const g of guests) assert.equal(ownerHash(g.w), ownerHash(host.w), 'boards agree again');
  for (const c of all) c.dispose();
});

test('online: cutting a guest trail kills that guest on every screen, and leavers are out for good', () => {
  const room = new MemRoom();
  room.players = [
    { seat: 0, name: 'host' },
    { seat: 1, name: 'ana' },
  ];
  const host = hostCtl(room.net(0), { skin: 0, fill: 0, level: 1, length: 2, seed: 8 });
  const guest = guestCtl(room.net(1), { skin: 1, fill: 0, level: 1, length: 2 });
  play(room, [host, guest], GO + 0.5, false);
  assert.ok(guest.online?.ready());
  const gid = guest.locals[0];
  const hid = host.locals[0];
  const gp = guest.w.players[gid];
  // the guest heads straight out of its land for a while
  gp.want = gp.h;
  for (let i = 0; i < 60; i++) {
    room.now += 1 / 60;
    host.frame?.(1 / 60);
    guest.frame?.(1 / 60);
    gp.want = gp.h;
    guest.tick();
    host.tick();
    room.pump();
  }
  settle(room, [host, guest], 0.5);
  const target = host.w.players[gid];
  assert.ok(target.out && target.trailLen > 0, 'the host sees the guest out with a trail');
  // the host's head teleports across that trail (a cut)
  const k = target.trail[Math.floor(target.trailLen / 2)];
  const ty = Math.floor(k / host.w.n);
  const tx = k - ty * host.w.n;
  const hp = host.w.players[hid];
  hp.rx = tx + 0.5;
  hp.ry = ty - 6.5;
  drive(host.w, hp, tx + 0.5, ty + 6.5);
  assert.ok(!host.w.players[gid].alive);
  settle(room, [host, guest], 1);
  assert.ok(!guest.w.players[gid].alive, 'the guest sees itself cut');
  assert.equal(guest.w.players[gid].cause, 'cut');
  assert.equal(guest.w.players[hid].kills, 1);
  // a guest who leaves is removed and never respawns
  room.players = [{ seat: 0, name: 'host' }];
  settle(room, [host], 5);
  assert.equal(host.w.players[gid].respawnAt, -1);
  assert.ok(!host.w.players[gid].alive);
  host.dispose();
  guest.dispose();
});

test('online: the host calls time and everyone reports the same winner, though its loop stops at once', () => {
  const { room, host, guests, all } = room3();
  play(room, all, GO + 1.5 * 60 + 2);
  assert.ok(host.isOver());
  assert.ok(shown.has(host), 'the host page showed its result and ran no more frames');
  settle(room, all, 2);
  for (const g of guests) {
    assert.ok(g.isOver(), 'the end reached the guest');
    assert.deepEqual(g.online?.result().order, host.online?.result().order);
    assert.equal(g.online?.result().winner, host.online?.result().winner);
  }
  assert.equal(room.reports.length, 3);
  assert.ok(room.reports.every((r) => r === room.reports[0]));
  for (const c of all) c.dispose();
});

test('online: a round the host ends itself reaches everyone too', () => {
  const { room, host, guests, all } = room3();
  play(room, all, GO + 4);
  host.online!.finish();
  assert.ok(host.isOver());
  shown.add(host);
  settle(room, all, 1);
  for (const g of guests) assert.ok(g.isOver());
  assert.equal(room.reports.length, 3);
  for (const c of all) c.dispose();
});

test('online: while the host page is hidden, everyone holds still, then carries on from there', () => {
  const { room, host, guests, all } = room3();
  play(room, all, GO + 6);
  host.online!.setAway(true);
  // a hidden page runs no frames or ticks, but its messages still arrive; let what is on the way land first
  play(room, guests, 0.5);
  const g = guests[0];
  const id = g.locals[0];
  const mine = g.w.players[id];
  const seen = host.w.players[id];
  const before = { elapsed: g.elapsed(), land: [...g.w.counts], x: mine.x, y: mine.y, hx: seen.x, hy: seen.y, hash: ownerHash(host.w) };
  play(room, guests, 20);
  for (const gc of guests) assert.equal(gc.online?.status(), 'the host stepped away');
  assert.ok(Math.abs(g.elapsed() - before.elapsed) < 1e-9, 'the round clock holds');
  assert.deepEqual([...g.w.counts], before.land, 'nobody claims anything');
  assert.deepEqual([mine.x, mine.y], [before.x, before.y], 'our own head waits too');
  assert.deepEqual([seen.x, seen.y, ownerHash(host.w)], [before.hx, before.hy, before.hash], 'the host walked nothing meanwhile');
  host.online!.setAway(false);
  play(room, all, 6);
  for (const gc of guests) assert.equal(gc.online?.status(), null);
  assert.ok(g.elapsed() > before.elapsed + 5, 'the clock runs again');
  settle(room, all);
  for (const gc of guests) assert.equal(ownerHash(gc.w), ownerHash(host.w), 'same board after the pause');
  for (const c of all) c.dispose();
});

test('online: a host that goes quiet without a word (a phone asleep) also holds everyone after a moment', () => {
  const { room, guests, all } = room3();
  play(room, all, GO + 4);
  const g = guests[0];
  const t0 = g.elapsed();
  play(room, guests, 5);
  assert.ok(g.elapsed() - t0 < 1.3, `guests stop soon after the host goes quiet (${(g.elapsed() - t0).toFixed(2)} s)`);
  assert.equal(g.online?.status(), 'waiting for the host');
  play(room, all, 2);
  assert.equal(g.online?.status(), null);
  for (const c of all) c.dispose();
});

test('online: someone who joins mid round is sent nothing of it (they play the next one)', () => {
  const { room, all } = room3();
  play(room, all, GO + 2);
  room.players.push({ seat: 3, name: 'cy' });
  let got = 0;
  const off = room.net(3).onMessage(() => got++);
  play(room, all, 4);
  assert.equal(got, 0);
  off();
  for (const c of all) c.dispose();
});

import { BPM, SONG, STEPS, Sequencer, midi } from '../src/os/arcade/games/paperio/music.ts';

test('the soundtrack loops, and its tension layer only plays while you are out', () => {
  assert.equal(midi('A4'), 69);
  assert.equal(SONG.length, STEPS);
  assert.ok(SONG.every((notes) => notes.every((n) => Number.isFinite(n.midi) && n.len > 0)));
  const calm: string[] = [];
  const tense: string[] = [];
  new Sequencer((n) => calm.push(n.voice)).tick(10, false, 2);
  new Sequencer((n) => tense.push(n.voice)).tick(10, true, 2);
  assert.ok(!calm.includes('tick'));
  assert.ok(tense.includes('tick'));
  assert.ok(tense.length > calm.length);
  // two seconds of music is about the right number of sixteenths
  const steps = Math.round(2.05 / (60 / BPM / 4));
  const seq = new Sequencer(() => {});
  seq.tick(10, false, 2);
  assert.ok(Math.abs(seq.step - steps) <= 1);
});
