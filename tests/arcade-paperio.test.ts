import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BRUSH,
  EDGE,
  GRACE,
  HIT,
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
import { botNames, makeMind, personas, wayHome } from '../src/os/arcade/games/paperio/bots.ts';
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
