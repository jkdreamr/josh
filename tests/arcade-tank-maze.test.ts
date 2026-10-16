import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRE_CD,
  MAX_SHELLS,
  MINE_ARM,
  SHELL_LIFE,
  type TankInput,
  type World,
  bfs,
  cellOf,
  circleFree,
  createMaze,
  createWorld,
  fitBoard,
  mulberry32,
  noInput,
  pickSpawns,
  spawnRound,
  step,
  stickInput,
  touchLayout,
  traceShot,
  type Maze,
} from '../src/os/arcade/games/tank-maze/logic.ts';
import { makeMemory, think } from '../src/os/arcade/games/tank-maze/bots.ts';
import { endPacket, inputPacket, parsePacket, roundPacket, statePacket } from '../src/os/arcade/games/tank-maze/net.ts';

const fire: TankInput = { turn: 0, move: 0, fire: true };
const idle: TankInput = { turn: 0, move: 0, fire: false };

/** Count interior walls still standing vs a fresh perfect maze would. */
const interiorWalls = (m: Maze) => {
  let n = 0;
  for (let y = 0; y < m.rows; y++) for (let x = 1; x < m.cols; x++) if (m.v[y * (m.cols + 1) + x]) n++;
  for (let y = 1; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.h[y * m.cols + x]) n++;
  return n;
};

/** Skip the ready countdown. */
const intoPlay = (w: World) => {
  for (let i = 0; i < 80 && w.phase === 'ready'; i++) step(w, w.tanks.map(() => idle));
};

/** Run the world until a condition or a step cap; returns steps run or -1. */
const runUntil = (w: World, cond: () => boolean, cap = 60 * 600, inputs: () => TankInput[] = () => w.tanks.map(() => idle)) => {
  for (let i = 0; i < cap; i++) {
    step(w, inputs());
    if (cond()) return i;
  }
  return -1;
};

// -----------------------------------------------------------------------------------------------------------------
// Maze

test('maze is deterministic per seed and differs across seeds', () => {
  const a = createMaze(8, 5, 42);
  const b = createMaze(8, 5, 42);
  assert.deepEqual(a.v, b.v);
  assert.deepEqual(a.h, b.h);
  const c = createMaze(8, 5, 43);
  assert.notDeepEqual(a.v.concat(a.h), c.v.concat(c.h));
});

test('every cell is reachable and outer walls are intact', () => {
  for (const [cols, rows, seed] of [
    [6, 6, 1],
    [10, 6, 7],
    [12, 6, 99],
    [7, 9, 1234],
  ] as const) {
    const m = createMaze(cols, rows, seed);
    const dist = bfs(m, [0]);
    for (let c = 0; c < cols * rows; c++) assert.ok(dist[c] >= 0, `cell ${c} unreachable in ${cols}x${rows} seed ${seed}`);
    for (let y = 0; y < rows; y++) {
      assert.ok(m.v[y * (cols + 1)], 'left outer wall');
      assert.ok(m.v[y * (cols + 1) + cols], 'right outer wall');
    }
    for (let x = 0; x < cols; x++) {
      assert.ok(m.h[x], 'top outer wall');
      assert.ok(m.h[rows * cols + x], 'bottom outer wall');
    }
  }
});

test('maze has loops: fewer interior walls than a perfect maze', () => {
  for (const [cols, rows] of [
    [8, 6],
    [10, 6],
    [12, 8],
  ] as const) {
    const perfect = cols * rows - 1;
    const m = createMaze(cols, rows, 5);
    // interior standing walls < perfect-maze interior walls (perfect maze opens exactly cells-1, so
    // standing interior walls = total interior - opened). Our loopy maze removes ~25% more.
    const totalInterior = (cols - 1) * rows + (rows - 1) * cols;
    assert.ok(interiorWalls(m) < totalInterior - perfect, `${cols}x${rows} should have loops`);
  }
});

test('spawn cells are distinct and far apart', () => {
  const m = createMaze(10, 6, 77);
  const spots = pickSpawns(m, 4, mulberry32(9));
  const cells = spots.map((s) => s.cy * m.cols + s.cx);
  assert.equal(new Set(cells).size, 4);
  const dist = bfs(m, [cells[0]]);
  for (let i = 1; i < cells.length; i++) assert.ok(dist[cells[i]] >= 4, 'spawns should be well separated');
});

// -----------------------------------------------------------------------------------------------------------------
// Tanks and shells

test('a tank cannot drive through a wall', () => {
  // 2x1 maze keeps the outer wall between the two cells: drive right, stay in cell 0.
  const m = createMaze(2, 1, 3);
  const w = createWorld({ cols: 2, rows: 1, seed: 3, count: 1, target: 5 });
  w.maze = m;
  const t = w.tanks[0];
  t.x = 0.5;
  t.y = 0.5;
  t.a = 0; // facing +x, wall at x=1 if v[1] is up; force it
  w.maze.v[1] = true;
  w.phase = 'play';
  for (let i = 0; i < 120; i++) step(w, [{ turn: 0, move: 1, fire: false }]);
  assert.ok(t.x < 1, `tank crossed the wall (x=${t.x})`);
});

test('a shell reflects off a wall and never tunnels even at big dt', () => {
  const w = createWorld({ cols: 4, rows: 3, seed: 8, count: 1, target: 5 });
  // corridor: tank in a cell, fire straight at the left wall
  const t = w.tanks[0];
  t.x = 2.5;
  t.y = 1.5;
  t.a = Math.PI; // facing -x
  w.phase = 'play';
  step(w, [fire]);
  const s = w.shells[0];
  assert.ok(s, 'shell spawned');
  const vx0 = s.vx;
  let bounced = false;
  for (let i = 0; i < 240; i++) {
    step(w, [idle], 1 / 60);
    if (s.vx !== vx0) {
      bounced = true;
      break;
    }
  }
  assert.ok(bounced, 'shell should bounce off the left wall');
  assert.ok(s.x > 0, 'shell should stay inside the maze');
  // high dt: still no tunneling
  s.x = 3.5;
  s.y = 1.5;
  s.vx = -3.2;
  s.vy = 0;
  s.age = 0;
  for (let i = 0; i < 20; i++) step(w, [idle], 0.5);
  assert.ok(s.x > 0 && s.x < 4, 'shell tunneled out at high dt');
});

test('owner immunity: a shell cannot kill its owner instantly, but can after a ricochet', () => {
  const w = createWorld({ cols: 3, rows: 1, seed: 4, count: 1, target: 5 });
  const t = w.tanks[0];
  t.x = 1.5;
  t.y = 0.5;
  t.a = Math.PI; // fire at left wall -> ricochet back into the tank
  w.phase = 'play';
  step(w, [fire]);
  assert.ok(t.alive, 'muzzle blast must not suicide');
  const steps = runUntil(w, () => !t.alive, 600);
  assert.ok(steps > 0, 'own ricochet should eventually kill the tank');
});

test('shell cap of 5 and fire cooldown', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 11, count: 1, target: 5 });
  w.phase = 'play';
  const t = w.tanks[0];
  let fired = 0;
  for (let i = 0; i < 600; i++) {
    const wantFire = t.cooldown <= 0;
    step(w, [wantFire ? fire : idle]);
    if (wantFire) fired++;
  }
  assert.ok(fired > 3, 'should have fired multiple times');
  assert.ok(w.shells.filter((s) => s.owner === 0).length <= MAX_SHELLS, 'never more than 5 live shells');
});

test('two shells annihilate each other', () => {
  const w = createWorld({ cols: 5, rows: 1, seed: 2, count: 1, target: 5 });
  w.phase = 'play';
  w.shells.push({ id: 1, owner: 0, x: 1.5, y: 0.5, vx: 3.2, vy: 0, age: 1, volley: 0 });
  w.shells.push({ id: 2, owner: 0, x: 3.5, y: 0.5, vx: -3.2, vy: 0, age: 1, volley: 0 });
  const steps = runUntil(w, () => w.shells.length === 0, 600);
  assert.ok(steps > 0, 'shells should meet and vanish');
});

// -----------------------------------------------------------------------------------------------------------------
// Pickups

test('laser reflects and kills the first tank it reaches', () => {
  const w = createWorld({ cols: 5, rows: 4, seed: 0, count: 2, target: 5 });
  w.phase = 'play';
  const a = w.tanks[0];
  const b = w.tanks[1];
  // same bank-shot scene as the traceShot test: no direct line, reachable by a ricochet
  a.x = 0.5;
  a.y = 0.5;
  a.a = 5.890486225480862;
  a.special = 'laser';
  b.x = 4.5;
  b.y = 1.5;
  step(w, [fire, idle]);
  assert.ok(w.beams.length === 1, 'beam drawn');
  assert.ok(w.beams[0].pts.length > 4, 'beam bounced at least once');
  assert.ok(!b.alive, 'laser killed the target around the corner');
  assert.equal(a.special, null, 'laser consumed');
});

test('triple fires a 3-shell fan for 3 shots', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 9, count: 2, target: 5 });
  w.phase = 'play';
  const t = w.tanks[0];
  t.special = 'triple';
  step(w, [fire, idle]);
  assert.equal(w.shells.length, 3, 'first fan fires 3 shells');
  const angles = w.shells.map((s) => Math.atan2(s.vy, s.vx));
  assert.ok(Math.abs(angles[1] - angles[0]) > 0.1, 'fan spreads');
  // wait out the cooldown then fire twice more (clear shells so ricochets can't kill the tank mid-test)
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 20; i++) {
      w.shells = [];
      step(w, [idle, idle]);
    }
    step(w, [fire, idle]);
    assert.equal(w.shells.length, 3, `fan ${k + 2} fires 3 shells`);
  }
  for (let i = 0; i < 20; i++) {
    w.shells = [];
    step(w, [idle, idle]);
  }
  step(w, [fire, idle]);
  assert.equal(w.shells.length, 1, 'after 3 fans, back to single shells');
});

test('mine arms after 1 s, then its blast kills tanks in radius', () => {
  const w = createWorld({ cols: 5, rows: 3, seed: 12, count: 2, target: 5 });
  w.phase = 'play';
  const a = w.tanks[0];
  const b = w.tanks[1];
  a.x = 2.5;
  a.y = 1.5;
  a.a = 0;
  a.special = 'mine';
  step(w, [fire, idle]);
  assert.equal(w.mines.length, 1, 'mine dropped');
  assert.equal(a.special, null);
  // walk b onto it before arming: teleport it (tanks are already placed, moving takes sim time)
  b.x = w.mines[0].x;
  b.y = w.mines[0].y;
  step(w, [idle, idle]);
  assert.ok(b.alive, 'mine does not trigger before arming');
  // keep it there past arm time
  for (let i = 0; i < Math.ceil(MINE_ARM * 60) + 2 && b.alive; i++) {
    b.x = w.mines[0].x;
    b.y = w.mines[0].y;
    step(w, [idle, idle]);
  }
  assert.ok(!b.alive, 'mine blast kills in radius once armed');
});

// -----------------------------------------------------------------------------------------------------------------
// Rounds

test('settle: last survivor scores, double KO is a draw, target ends the match', () => {
  const w = createWorld({ cols: 6, rows: 6, seed: 21, count: 2, target: 1 });
  intoPlay(w);
  w.tanks[1].alive = false;
  const steps = runUntil(w, () => w.phase === 'done', 600);
  assert.ok(steps > 0);
  assert.equal(w.scores[0], 1);
  assert.equal(w.phase, 'done');
  assert.equal(w.winner, 0);

  // double KO during the settle window draws the round
  const w2 = createWorld({ cols: 6, rows: 6, seed: 22, count: 2, target: 3 });
  intoPlay(w2);
  // shell kills tank 1, settle starts; then last tank dies to a ricochet before settle ends
  w2.tanks[1].alive = false;
  step(w2, [idle, idle]);
  assert.equal(w2.phase, 'settle');
  w2.tanks[0].alive = false;
  for (let i = 0; i < 60 * 3; i++) step(w2, [idle, idle]);
  assert.equal(w2.scores[0] + w2.scores[1], 0, 'double KO: nobody scores');
  assert.equal(w2.round, 2, 'a new round starts');
  assert.equal(w2.phase, 'ready');
});

test('a fresh maze each round', () => {
  const w = createWorld({ cols: 6, rows: 6, seed: 33, count: 2, target: 5 });
  intoPlay(w);
  const first = w.maze.v.concat(w.maze.h);
  w.tanks[1].alive = false;
  runUntil(w, () => w.round === 2 && w.phase === 'play', 600);
  assert.equal(w.round, 2);
  const second = w.maze.v.concat(w.maze.h);
  assert.notDeepEqual(first, second, 'round 2 has a new maze');
  assert.ok(w.tanks.every((t) => t.alive), 'tanks respawn');
});

// -----------------------------------------------------------------------------------------------------------------
// traceShot

test('traceShot finds a bank shot where no direct line exists', () => {
  // seed 0 5x4: tank A top-left cell, tank B in the right column. The corridor between them is walled
  // off, but a shot angled down-right banks off two walls into B (found by angle sweep).
  const w = createWorld({ cols: 5, rows: 4, seed: 0, count: 2, target: 5 });
  const a = w.tanks[0];
  const b = w.tanks[1];
  a.x = 0.5;
  a.y = 0.5;
  b.x = 4.5;
  b.y = 1.5;
  const direct = traceShot(w, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), 0, 20, 0);
  assert.notEqual(direct.hit, 1, 'direct line should be walled');
  const bounce = traceShot(w, a.x, a.y, 5.890486225480862, 2, 20, 0);
  assert.equal(bounce.hit, 1, `bank shot should hit the enemy (pts ${JSON.stringify(bounce.pts)})`);
  assert.ok(bounce.pts.length >= 6, 'path reflects at least twice');
});

// -----------------------------------------------------------------------------------------------------------------
// Bots

test('hard bot finds and fires a bank shot with no direct line', () => {
  // same walled scene as the traceShot test
  const w = createWorld({ cols: 5, rows: 4, seed: 0, count: 2, target: 5 });
  const a = w.tanks[0];
  const b = w.tanks[1];
  a.x = 0.5;
  a.y = 0.5;
  b.x = 4.5;
  b.y = 1.5;
  w.phase = 'play';
  const mem = makeMemory();
  const rng = mulberry32(5);
  // run the bot for a bit; it should eventually fire a trace that hits the enemy
  let firedHit = false;
  for (let i = 0; i < 60 * 6 && b.alive; i++) {
    const input = think(w, 0, 2, mem, rng);
    step(w, [input, idle]);
    if (!b.alive) firedHit = true;
  }
  assert.ok(firedHit, 'hard bot should land a bank shot');
});

test('normal/hard bots dodge an incoming shell most of the time', () => {
  // corridor: shell flying straight at the bot; count survivals over seeds
  for (const level of [1, 2] as const) {
    let survived = 0;
    const trials = 8;
    for (let s = 0; s < trials; s++) {
      const w = createWorld({ cols: 9, rows: 3, seed: s, count: 2, target: 5 });
      w.phase = 'play';
      const t = w.tanks[0];
      const foe = w.tanks[1];
      t.x = 4.5;
      t.y = 1.5;
      t.a = 0;
      foe.x = 0.5;
      foe.y = 0.5;
      // incoming shell on the tank's row
      w.shells.push({ id: 99, owner: 1, x: 7.5, y: 1.5, vx: -3.2, vy: 0, age: 1, volley: 0 });
      const mem = makeMemory();
      const rng = mulberry32(100 + s);
      let steps = 0;
      while (t.alive && steps < 60 * 3) {
        const input = think(w, 0, level, mem, rng);
        step(w, [input, idle]);
        steps++;
      }
      if (t.alive) survived++;
    }
    assert.ok(survived >= trials / 2, `level ${level} dodged only ${survived}/${trials}`);
  }
});

test('bots never fire a shot whose trace hits themselves first', () => {
  for (const level of [0, 1, 2] as const) {
    for (let s = 0; s < 12; s++) {
      const w = createWorld({ cols: 7, rows: 5, seed: s * 17 + level, count: 3, target: 5 });
      w.phase = 'play';
      const mems = w.tanks.map(() => makeMemory());
      const rngs = w.tanks.map((_, i) => mulberry32(s * 131 + i));
      for (let i = 0; i < 60 * 4; i++) {
        const inputs = w.tanks.map((t) => think(w, t.id, level, mems[t.id], rngs[t.id]));
        // check every shot about to be fired
        for (const t of w.tanks) {
          if (inputs[t.id].fire && t.alive) {
            const tr = traceShot(w, t.x, t.y, t.a, level === 2 ? 3 : level === 1 ? 1 : 0, 20, t.id);
            assert.notEqual(tr.hit, t.id, `level ${level} bot ${t.id} fired into itself (seed ${s})`);
          }
        }
        step(w, inputs);
        if (w.phase !== 'play') break;
      }
    }
  }
});

test('full bot-vs-bot matches finish in bounded time on every level', () => {
  for (const level of [0, 1, 2] as const) {
    for (const count of [2, 3, 4]) {
      const w = createWorld({ cols: 8, rows: 6, seed: 40 + level * 7 + count, count, target: 3 });
      const mems = w.tanks.map(() => makeMemory());
      const rngs = w.tanks.map((_, i) => mulberry32(level * 1000 + count * 100 + i));
      let steps = 0;
      const cap = 60 * 60 * 10; // 10 min sim time
      while (w.phase !== 'done' && steps < cap) {
        step(w, w.tanks.map((t) => think(w, t.id, level, mems[t.id], rngs[t.id])));
        steps++;
      }
      assert.ok(w.phase === 'done', `level ${level} ${count}P match did not finish (${steps} steps)`);
    }
  }
});

// -----------------------------------------------------------------------------------------------------------------
// stickInput

test('stickInput maps stick deflection to tank input', () => {
  assert.deepEqual(stickInput(0, 0, 0), { turn: 0, move: 0, fire: false });
  assert.deepEqual(stickInput(0, 0, 1), { turn: 0, move: 1, fire: false });
  assert.deepEqual(stickInput(0, Math.PI / 2, 1), { turn: 1, move: 0, fire: false });
  const back = stickInput(0, Math.PI, 1);
  assert.equal(back.move, -1);
  assert.equal(stickInput(0, 0.2, 1).turn, 1);
  assert.equal(stickInput(0, -0.2, 1).turn, -1);
  assert.equal(stickInput(0, Math.PI, 0.1).move, 0);
});

// -----------------------------------------------------------------------------------------------------------------
// Net

test('round packet round trips', () => {
  const p = roundPacket({
    roomRound: 2,
    round: 3,
    seed: 12345,
    cols: 10,
    rows: 6,
    seats: [0, 1, 3],
    bots: [3],
    scores: [1, 0, 2],
    target: 5,
    level: 2,
    spawns: [
      { x: 0.5, y: 0.5, a: 1.1 },
      { x: 9.5, y: 5.5, a: -2.2 },
      { x: 5.5, y: 2.5, a: 0.4 },
    ],
  });
  const parsed = parsePacket(JSON.parse(JSON.stringify(p)));
  assert.ok(parsed && parsed.k === 'round');
  if (parsed.k === 'round') {
    assert.equal(parsed.seed, 12345);
    assert.deepEqual(parsed.seats, [0, 1, 3]);
    assert.deepEqual(parsed.bots, [3]);
    assert.deepEqual(parsed.scores, [1, 0, 2]);
    assert.equal(parsed.spawns.length, 3);
    assert.ok(Math.abs(parsed.spawns[1].a + 2.2) < 0.01);
  }
});

test('state and input packets round trip', () => {
  const s = statePacket({
    k: 's',
    roomRound: 1,
    tick: 99,
    phase: 'play',
    phaseT: 0,
    tanks: [
      { x: 1.23, y: 4.56, a: 0.707, alive: true, special: 'laser', moving: true },
      { x: 7, y: 2, a: -1, alive: false, special: null, moving: false },
    ],
    shells: [{ x: 2.5, y: 3.5, owner: 1 }],
    pickups: [{ kind: 'mine', x: 4.5, y: 1.5 }],
    mines: [{ x: 3.3, y: 2.2, armed: true }],
    beams: [{ owner: 0, pts: [1, 1, 2.5, 1, 2.5, 3] }],
    scores: [2, 1],
    events: [{ id: 7, k: 'kill', a: 1, b: 0, x: 4.4, y: 2.2 }],
  });
  const parsed = parsePacket(JSON.parse(JSON.stringify(s)));
  assert.ok(parsed && parsed.k === 's');
  if (parsed.k === 's') {
    assert.equal(parsed.tanks.length, 2);
    assert.equal(parsed.tanks[0].special, 'laser');
    assert.equal(parsed.tanks[1].alive, false);
    assert.equal(parsed.events[0].k, 'kill');
    assert.ok(Math.abs(parsed.events[0].x - 4.4) < 0.01);
    assert.equal(parsed.beams[0].pts.length, 6);
  }
  const i = inputPacket({ k: 'in', roomRound: 1, turn: -1, move: 1, fireCount: 3 });
  const pi = parsePacket(i);
  assert.ok(pi && pi.k === 'in' && pi.fireCount === 3);
  const e = parsePacket(endPacket({ k: 'end', roomRound: 1, winner: 2, champ: 2, scores: [5, 3], rounds: 9 }));
  assert.ok(e && e.k === 'end' && e.winner === 2);
});

test('end packet champ rides along while winner stays null', () => {
  // a bot tank won the match: nobody gets the room win (winner null) but guests
  // still need the champ seat to title the Game Over card correctly
  const e = parsePacket(endPacket({ k: 'end', roomRound: 3, winner: null, champ: 2, scores: [0, 0, 5], rounds: 7 }));
  assert.ok(e && e.k === 'end');
  assert.equal(e.winner, null);
  assert.equal(e.champ, 2);
  // older hosts without a champ field still parse, as a draw
  const old = parsePacket({ game: 'tank-maze', type: 'end', room: 3, winner: null, scores: [1, 1], rounds: 4 });
  assert.ok(old && old.k === 'end');
  assert.equal(old.champ, null);
  // malformed champ is rejected
  assert.equal(parsePacket({ game: 'tank-maze', type: 'end', room: 1, winner: null, champ: 9, scores: [0], rounds: 1 }), null);
});

test('malformed packets are rejected', () => {
  assert.equal(parsePacket(null), null);
  assert.equal(parsePacket('x'), null);
  assert.equal(parsePacket({}), null);
  assert.equal(parsePacket({ game: 'other', type: 's' }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'round', room: 'x' }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'round', room: 1, round: 1, seed: 1, cols: 99, rows: 6, seats: [0], bots: [], scores: [0], target: 5, level: 0, spawns: [{ x: 1, y: 1, a: 0 }] }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'in', room: 1, turn: 2, move: 0, fc: 0 }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 's', room: 1, tick: 1, pt: 0, phase: 'nope', tanks: [], shells: [], scores: [] }), null);
});

test('fireCount increments map to shots with cooldown', () => {
  // host-side logic: a guest's input fires once per fireCount increment, gated by cooldown
  const w = createWorld({ cols: 8, rows: 6, seed: 5, count: 2, target: 5 });
  w.phase = 'play';
  const t = w.tanks[0];
  let lastFc = 0;
  const apply = (fc: number) => {
    const fire = fc > lastFc;
    if (fire) lastFc = fc;
    step(w, [{ turn: 0, move: 0, fire }, idle]);
  };
  apply(1);
  assert.equal(w.shells.filter((s) => s.owner === 0).length, 1, 'first increment fires');
  apply(1); // same count resent: no new shot
  assert.equal(w.shells.filter((s) => s.owner === 0).length, 1);
  apply(2); // inside cooldown: increment seen but cooldown blocks... should queue? host fires when allowed
  // cooldown is 0.18s; let it expire then fire again via a fresh increment
  for (let i = 0; i < Math.ceil(FIRE_CD * 60) + 2; i++) step(w, [idle, idle]);
  apply(3);
  assert.ok(w.shells.filter((s) => s.owner === 0).length >= 2, 'later increment fires after cooldown');
});

test('spawnRound with dims rebuilds the maze at those dims', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 11, count: 3, target: 5 });
  w.scores[0] = 2;
  spawnRound(w, 77, { cols: 10, rows: 5 });
  assert.equal(w.maze.cols, 10);
  assert.equal(w.maze.rows, 5);
  assert.equal(w.seed, 77);
  // scores survive a respawn
  assert.equal(w.scores[0], 2);
  const dist = bfs(w.maze, [0]);
  for (let c = 0; c < 10 * 5; c++) assert.ok(dist[c] >= 0, `cell ${c} unreachable`);
  for (let y = 0; y < 5; y++) {
    assert.ok(w.maze.v[y * 11]);
    assert.ok(w.maze.v[y * 11 + 10]);
  }
  for (let x = 0; x < 10; x++) {
    assert.ok(w.maze.h[x]);
    assert.ok(w.maze.h[5 * 10 + x]);
  }
  for (const t of w.tanks) {
    assert.ok(t.x >= 0 && t.x < 10 && t.y >= 0 && t.y < 5, 'tank inside maze');
    assert.ok(circleFree(w.maze, t.x, t.y, 0.26), `tank ${t.id} not in a free cell`);
  }
});

test('fitBoard stays inside the board and clear of the control pill', () => {
  const R = (w: number) => ({ x: w - 176, y: 0, w: 176, h: 50 });
  for (const [w, h, cols, rows] of [
    [464, 157, 8, 6],
    [601, 260, 12, 6],
    [1280, 680, 12, 6],
    [390, 600, 6, 10],
    [320, 400, 6, 7],
  ] as const) {
    const board = { x: 0, y: 34, w, h: h - 34 };
    const f = fitBoard(board, cols, rows, w);
    const bw = f.cell * cols;
    const bh = f.cell * rows;
    assert.ok(f.cell > 0, `${w}x${h}: positive cell`);
    assert.ok(f.ox >= board.x + 8 - 1e-9 && f.ox + bw <= board.x + board.w - 8 + 1e-9, `${w}x${h}: horizontal bounds`);
    assert.ok(f.oy >= board.y + 8 - 1e-9 && f.oy + bh <= board.y + board.h - 8 + 1e-9, `${w}x${h}: vertical bounds`);
    const r = R(w);
    const overlap = f.ox + bw > r.x && f.ox < r.x + r.w && f.oy + bh > r.y && f.oy < r.y + r.h;
    assert.ok(!overlap, `${w}x${h}: maze under the control pill`);
  }
});

test('touchLayout keeps touch zones off the board', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // phone landscape 2P: side columns flank the board, never covering it
  const land = touchLayout(844, 390, 2, true);
  assert.equal(land.zones.length, 2);
  for (const z of land.zones) assert.ok(!overlap(z, land.board), `landscape zone over board: ${JSON.stringify(z)}`);
  assert.ok(land.zones[0].x + land.zones[0].w <= land.board.x, 'P1 column left of the board');
  assert.ok(land.zones[1].x >= land.board.x + land.board.w, 'P2 column right of the board');
  // phone portrait 2P: the board sits between the two bands
  const port = touchLayout(390, 844, 2, true);
  assert.equal(port.zones.length, 2);
  const p2 = port.zones.find((z) => z.flip)!;
  const p1 = port.zones.find((z) => !z.flip)!;
  assert.ok(port.board.y >= p2.y + p2.h, 'board below the flipped P2 band');
  assert.ok(port.board.y + port.board.h <= p1.y, 'board above the P1 band');
  // 1P touch: single band at the bottom
  const solo = touchLayout(390, 844, 1, true);
  assert.equal(solo.zones.length, 1);
  assert.ok(solo.board.y + solo.board.h <= solo.zones[0].y);
  // no touch: the board owns everything below the HUD
  const desk = touchLayout(1440, 900, 3, false);
  assert.equal(desk.zones.length, 0);
  assert.ok(desk.board.h === 900 - desk.hud);
});
