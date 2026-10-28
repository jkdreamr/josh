import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRE_CD,
  TURN,
  aimAt,
  aimAligned,
  canvasToWorld,
  rotateToward,
  DIR_TURN,
  FWD,
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
  keyHeading,
  mulberry32,
  noInput,
  pickSpawns,
  spawnRound,
  standings,
  step,
  stickInput,
  toCanvas,
  touchLayout,
  traceShot,
  type Maze,
} from '../src/os/arcade/games/tank-maze/logic.ts';
import { makeMemory, STANDOFF, think } from '../src/os/arcade/games/tank-maze/bots.ts';
import { endPacket, inputPacket, parsePacket, rosterPacket, roundPacket, seatNames, statePacket, tankHolders, holdersLeft, tankName } from '../src/os/arcade/games/tank-maze/net.ts';
import { clipName, finalLine, freeSpans, layoutChips, listNames, packChipRows, packChips, rosterLine, type Span } from '../src/os/arcade/games/tank-maze/hud.ts';
import { formatTally } from '../src/os/arcade/kit/tally.ts';

const fire: TankInput = { turn: 0, move: 0, fire: true };
const idle: TankInput = { turn: 0, move: 0, fire: false };

test('pointer coordinates invert the maze render transform, including CSS scaling', () => {
  const size = { w: 820, h: 700 };
  const fit = fitBoard(touchLayout(size.w, size.h, 1, false).board, 8, 6, size.w);
  const rect = { left: 70, top: 90, width: 410, height: 350 };
  for (const pt of [{ x: 0, y: 0 }, { x: 2.5, y: 4.5 }, { x: 8, y: 6 }]) {
    const canvas = toCanvas(rect.left + (fit.ox + pt.x * fit.cell) / 2, rect.top + (fit.oy + pt.y * fit.cell) / 2, rect, size);
    const world = canvasToWorld(canvas, fit);
    assert.ok(Math.abs(world.x - pt.x) < 1e-9 && Math.abs(world.y - pt.y) < 1e-9);
  }
  assert.equal(aimAt({ x: 2, y: 2 }, { x: 2, y: 1 }), -Math.PI / 2);
});

test('rotateToward follows the shortest path and snaps without overshoot', () => {
  assert.ok(rotateToward(3, -3, 0.1) > 3);
  assert.ok(rotateToward(-3, 3, 0.1) < -3);
  assert.ok(Math.abs(rotateToward(0, 1, 0.2) - 0.2) < 1e-9);
  assert.equal(rotateToward(0.9, 1, 0.2), 1);
  assert.equal(rotateToward(1.1, 1, 0.2), 1);
  assert.equal(rotateToward(1, 1, 0.2), 1);
  assert.equal(rotateToward(3, -3, 0.4), -3);
  assert.ok(aimAligned(Math.PI, -Math.PI));
  assert.ok(!aimAligned(0, 0.1));
});

test('aim rotates at TURN without moving or firing; manual turn and dir take precedence', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 5, count: 2, target: 5 });
  w.phase = 'play';
  const t = w.tanks[0];
  t.a = 0;
  const { x, y } = t;
  step(w, [{ ...idle, aim: 1 }, idle]);
  assert.ok(Math.abs(t.a - TURN / 60) < 1e-9);
  assert.equal(t.x, x);
  assert.equal(t.y, y);
  assert.equal(w.shells.length, 0);
  for (let i = 0; i < 20; i++) step(w, [{ ...idle, aim: 1 }, idle]);
  assert.equal(t.a, 1);
  t.a = 0;
  step(w, [{ ...idle, turn: -1, aim: 1 }, idle]);
  assert.ok(Math.abs(t.a + TURN / 60) < 1e-9);
  t.a = 0;
  step(w, [{ ...idle, dir: -1, aim: 1 }, idle]);
  assert.ok(t.a < 0);
  t.a = 0;
  step(w, [{ ...idle, aim: NaN }, idle]);
  assert.equal(t.a, 0);
});

test('aim packets round trip and reject malformed headings', () => {
  const packet = inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, aim: -Math.PI / 2 });
  const parsed = parsePacket(JSON.parse(JSON.stringify(packet)));
  assert.ok(parsed?.k === 'in' && Math.abs(parsed.aim! + Math.PI / 2) < 0.001);
  for (const a of [9000, 1.5, '1', null, Infinity]) assert.equal(parsePacket({ ...packet, a }), null);
  const absent = parsePacket(inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0 }));
  assert.ok(absent?.k === 'in' && absent.aim === undefined);
});

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

test('standings include a pending multiplayer point through the settle phase', () => {
  const w = createWorld({ cols: 6, rows: 6, seed: 23, count: 4, target: 5 });
  intoPlay(w);
  w.tanks[0].alive = false;
  w.tanks[2].alive = false;
  w.tanks[3].alive = false;
  step(w, w.tanks.map(() => idle));
  assert.equal(w.phase, 'settle');
  assert.deepEqual(w.scores, [0, 0, 0, 0]);
  assert.deepEqual(standings(w), [0, 1, 0, 0]);
  assert.equal(formatTally(standings(w), { names: ['Red', 'Green', 'Blue', 'Gold'], lead: 1 }), 'Red 0 · Green 1 · Blue 0 · Gold 0');
  runUntil(w, () => w.phase !== 'settle', 200);
  assert.deepEqual(w.scores, [0, 1, 0, 0]);
});

test('two-tank standings lead with the surviving tank during settle', () => {
  const w = createWorld({ cols: 6, rows: 6, seed: 24, count: 2, target: 5 });
  intoPlay(w);
  w.tanks[1].alive = false;
  step(w, w.tanks.map(() => idle));
  assert.equal(formatTally(standings(w), { lead: w.winner }), '1 to 0');
});

test('a survivor killed during settle loses the pending point', () => {
  const w = createWorld({ cols: 6, rows: 6, seed: 25, count: 2, target: 5 });
  intoPlay(w);
  w.tanks[1].alive = false;
  step(w, w.tanks.map(() => idle));
  assert.deepEqual(standings(w), [1, 0]);
  w.tanks[0].alive = false;
  step(w, w.tanks.map(() => idle));
  assert.equal(w.phase, 'settle');
  assert.equal(w.winner, -1);
  assert.deepEqual(standings(w), [0, 0]);
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

test('bots break standoffs: rounds with an idle tank still finish', () => {
  // An idle human (or one who walked away) used to leave bots parked, trading bank shots that came back
  // and cancelled their own next shell, or holding a mine they never dropped, so the round never ended.
  const dims = [[12, 6], [10, 6], [8, 6], [6, 9]];
  for (const level of [0, 1, 2] as const) {
    for (const count of [3, 4]) {
      for (let seed = 1; seed <= 4; seed++) {
        const [cols, rows] = dims[seed % dims.length];
        const w = createWorld({ cols, rows, seed: seed * 13 + count, count, target: 3 });
        const mems = w.tanks.map(() => makeMemory());
        const rngs = w.tanks.map((_, i) => mulberry32(seed * 100 + i));
        let steps = 0;
        let roundStart = 0;
        let round = w.round;
        let worst = 0;
        while (w.phase !== 'done' && steps - roundStart < 60 * 90) {
          step(w, w.tanks.map((t) => (t.id === 0 ? idle : think(w, t.id, level, mems[t.id], rngs[t.id]))));
          steps++;
          if (w.round !== round) {
            worst = Math.max(worst, (steps - roundStart) / 60);
            roundStart = steps;
            round = w.round;
          }
        }
        assert.ok(w.phase === 'done', `level ${level} ${count}P seed ${seed}: round stalled (scores ${w.scores})`);
        assert.ok(worst < 60, `level ${level} ${count}P seed ${seed}: a round took ${worst.toFixed(1)} s`);
      }
    }
  }
});

test('a bot holding a mine next to an idle enemy drops it', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 5, count: 2, target: 3 });
  intoPlay(w);
  w.tanks[0].x = 3.5;
  w.tanks[0].y = 2.5;
  w.tanks[1].x = 2.5;
  w.tanks[1].y = 2.5;
  w.tanks[1].a = 0; // facing the enemy, so it is never "behind"
  w.tanks[1].special = 'mine';
  const mem = makeMemory();
  const rng = mulberry32(3);
  const dropped = runUntil(w, () => w.mines.length > 0, 60 * 8, () => [idle, think(w, 1, 1, mem, rng)]);
  assert.ok(dropped >= 0, 'mine never dropped');
});

test('a parked bot charges after the standoff timeout', () => {
  const w = createWorld({ cols: 8, rows: 6, seed: 9, count: 2, target: 3 });
  intoPlay(w);
  const mem = makeMemory();
  const rng = mulberry32(1);
  think(w, 1, 1, mem, rng);
  w.time += STANDOFF + 0.1;
  think(w, 1, 1, mem, rng);
  assert.ok(mem.pushUntil > w.time, 'standoff did not start a charge');
  assert.equal(mem.shot, null, 'no shooting while charging');
});

// -----------------------------------------------------------------------------------------------------------------
// stickInput

test('stickInput points the tank where the stick points, never reversing', () => {
  assert.deepEqual(stickInput(0, 0), { turn: 0, move: 0, fire: false });
  assert.deepEqual(stickInput(Math.PI, 0.1), { turn: 0, move: 0, fire: false });
  assert.deepEqual(stickInput(0, 1), { turn: 0, move: 0, fire: false, dir: 0 });
  // a stick pulled behind the tank is a heading, not a reverse
  const back = stickInput(-Math.PI / 2, 1);
  assert.equal(back.move, 0);
  assert.ok(Math.abs(back.dir! + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(stickInput(3 * Math.PI, 1).dir! - Math.PI) < 1e-9);
});

test('keyHeading maps held keys to screen directions', () => {
  assert.equal(keyHeading(false, false, false, false), undefined);
  assert.equal(keyHeading(false, false, false, true), 0);
  assert.equal(keyHeading(false, true, false, false), Math.PI / 2);
  assert.equal(keyHeading(false, false, true, false), Math.PI);
  assert.equal(keyHeading(true, false, false, false), -Math.PI / 2);
  assert.ok(Math.abs(keyHeading(true, false, false, true)! + Math.PI / 4) < 1e-9);
  assert.equal(keyHeading(false, false, true, true), undefined);
  assert.equal(keyHeading(true, true, false, false), undefined);
});

test('a dir input turns the tank to face it and drives that way on screen', () => {
  // open 5x5 room, tank in the middle facing right
  const open = (): World => {
    const w = createWorld({ cols: 5, rows: 5, seed: 3, count: 2, target: 5 });
    w.maze.rects = [];
    w.phase = 'play';
    w.tanks[0].x = 2.5;
    w.tanks[0].y = 2.5;
    w.tanks[0].a = 0;
    w.tanks[1].x = 4.5;
    w.tanks[1].y = 4.5;
    w.pickups = [];
    return w;
  };
  // hold "left" for 0.4 s: faces left and has moved left, never right of the start
  const w = open();
  const left = { turn: 0, move: 0, fire: false, dir: Math.PI } as TankInput;
  let maxX = w.tanks[0].x;
  for (let i = 0; i < 24; i++) {
    step(w, [left, idle]);
    maxX = Math.max(maxX, w.tanks[0].x);
  }
  const t = w.tanks[0];
  assert.ok(Math.abs(Math.abs(t.a) - Math.PI) < 1e-6, `not facing left: ${t.a}`);
  assert.ok(t.x < 2.5 - FWD * 0.4 * 0.9, `did not drive left: ${t.x}`);
  assert.ok(maxX <= 2.5 + 1e-9, 'drifted right');
  assert.ok(Math.abs(t.y - 2.5) < 1e-6);
  // a quarter turn finishes within a few frames
  const u = open();
  step(u, [{ turn: 0, move: 0, fire: false, dir: -Math.PI / 2 }, idle]);
  assert.ok(Math.abs(u.tanks[0].a) > 0 && Math.abs(u.tanks[0].a) <= DIR_TURN / 60 + 1e-9);
  for (let i = 0; i < 8; i++) step(u, [{ turn: 0, move: 0, fire: false, dir: -Math.PI / 2 }, idle]);
  assert.ok(Math.abs(u.tanks[0].a + Math.PI / 2) < 1e-9, 'quarter turn not done in 9 frames');
  assert.ok(u.tanks[0].y < 2.5);
  // firing still leaves along the barrel
  step(u, [{ turn: 0, move: 0, fire: true, dir: -Math.PI / 2 }, idle]);
  assert.equal(u.shells.length, 1);
  assert.ok(u.shells[0].vy < 0 && Math.abs(u.shells[0].vx) < 1e-9);
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
  assert.ok(pi && pi.k === 'in' && pi.fireCount === 3 && pi.dir === undefined);
  const di = parsePacket(inputPacket({ k: 'in', roomRound: 1, turn: 0, move: 0, fireCount: 0, dir: -Math.PI / 2 }));
  assert.ok(di && di.k === 'in' && Math.abs(di.dir! + Math.PI / 2) < 0.001);
  const e = parsePacket(endPacket({ k: 'end', roomRound: 1, winner: 2, champ: 2, scores: [5, 3], rounds: 9 }));
  assert.ok(e && e.k === 'end' && e.winner === 2 && e.names === undefined);
});

test('round and end packets carry the host tank names', () => {
  const base = { roomRound: 2, round: 1, seed: 7, cols: 10, rows: 6, seats: [0, 1, 3], bots: [3], scores: [0, 0, 0], target: 3, level: 1 as const };
  const spawns = [0, 1, 2].map((i) => ({ x: i + 0.5, y: 0.5, a: 0 }));
  const names = ['R2Host', 'R2Guest (Left)', 'Bot 1'];
  const r = parsePacket(JSON.parse(JSON.stringify(roundPacket({ ...base, spawns, names }))));
  assert.ok(r && r.k === 'round');
  assert.deepEqual(r.names, names);
  // a wrong-length or malformed list reads as absent
  const bad = parsePacket({ ...JSON.parse(JSON.stringify(roundPacket({ ...base, spawns }))), names: ['A', 'B'] });
  assert.ok(bad && bad.k === 'round' && bad.names === undefined);
  const e = parsePacket(JSON.parse(JSON.stringify(endPacket({ k: 'end', roomRound: 2, winner: null, champ: 3, scores: [1, 2, 3], rounds: 6, names }))));
  assert.ok(e && e.k === 'end');
  assert.deepEqual(e.names, names);
  assert.equal(parsePacket({ ...endPacket({ k: 'end', roomRound: 2, winner: null, champ: 3, scores: [1, 2, 3], rounds: 6 }), names: [1, 2, 3] })?.k, 'end');
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

test('seatNames gives a bot that takes over a departed seat a fresh number', () => {
  // host + guest + two room bots; the guest left, so their seat has no player and no listed bot
  const names = seatNames([0, 1, 2, 3], [{ seat: 0, name: 'Josh' }], [{ seat: 2, name: 'Bot 1' }, { seat: 3, name: 'Bot 2' }]);
  assert.deepEqual(names, ['Josh', 'Bot 3', 'Bot 1', 'Bot 2']);
  assert.equal(new Set(names).size, names.length);
  // two seats left at once still get distinct names, and a player named like a bot is never shared
  const two = seatNames([0, 1, 2, 3], [{ seat: 0, name: 'Bot 3' }], [{ seat: 3, name: 'Bot 1' }]);
  assert.deepEqual(two, ['Bot 3', 'Bot 2', 'Bot 4', 'Bot 1']);
  assert.deepEqual(seatNames([0, 1], [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }], []), ['A', 'B']);
});

// Host, a guest who left mid-match (their tank now driven by a bot) and two room bots; First To 3, seven rounds in.
const hostRoster = {
  roomRound: 4,
  round: 7,
  seed: 123456789,
  cols: 10,
  rows: 6,
  target: 3,
  level: 1,
  seats: [0, 1, 2, 3],
  bots: [2, 3],
  departed: [1],
  names: ['Host-R3', 'Guest-R3 (Left)', 'Bot 1', 'Bot 2'],
  scores: [1, 1, 3, 0],
};

/** What a client's Game Over line says, given its roster, the room's live players, and which seat is "You". */
const overLine = (r: { seats: number[]; bots: number[]; departed: number[]; names: string[] }, scores: number[], players: { seat: number; name: string }[], me: number, rounds: number) =>
  finalLine(
    r.seats.map((seat, i) => (seat === me ? 'You' : tankName(r.names[i], seat, { bots: r.bots, departed: new Set(r.departed) }, players.find((p) => p.seat === seat)?.name))),
    scores,
    rounds,
  );

test('roster packets round trip and carry the whole match roster', () => {
  const r = parsePacket(JSON.parse(JSON.stringify(rosterPacket(hostRoster))));
  assert.ok(r && r.k === 'roster');
  assert.deepEqual(r, { k: 'roster', ...hostRoster });
  // names and scores must cover every seat; bad seat lists are rejected
  const raw = JSON.parse(JSON.stringify(rosterPacket(hostRoster)));
  assert.equal(parsePacket({ ...raw, names: ['A', 'B'] }), null);
  assert.equal(parsePacket({ ...raw, scores: [1, 2, 3] }), null);
  assert.equal(parsePacket({ ...raw, departed: [9] }), null);
  assert.equal(parsePacket({ ...raw, seats: [1, 2] }), null);
  assert.equal(parsePacket({ ...raw, cols: 99 }), null);
});

test('a spectator who joined mid-round maps every name to the same score as the host', () => {
  // the room after the guest left: only the host is a player, and the room renumbered its bots
  const players = [{ seat: 0, name: 'Host-R3' }];
  const host = overLine(hostRoster, hostRoster.scores, players, 0, 7);
  assert.equal(host, 'Bot 1 3, You 1, Guest-R3 (Left) 1 and Bot 2 0 after 7 rounds.');
  // a fresh phone watcher (seat -1) knows nothing but what the host sent it
  const r = parsePacket(JSON.parse(JSON.stringify(rosterPacket(hostRoster))));
  assert.ok(r && r.k === 'roster');
  const watcher = overLine(r, r.scores, players, -1, 7);
  assert.equal(watcher, 'Bot 1 3, Host-R3 1, Guest-R3 (Left) 1 and Bot 2 0 after 7 rounds.');
  // bots never read as left, and no score is dropped
  assert.ok(!/Bot \d \(Left\)/.test(watcher));
  assert.ok(watcher.includes('Bot 2 0'));
  // the Game Over packet carries the same seats, so a watcher that missed the roster still matches the champ seat
  const e = parsePacket(JSON.parse(JSON.stringify(endPacket({ k: 'end', roomRound: 4, winner: null, champ: 2, scores: hostRoster.scores, rounds: 7, names: hostRoster.names, seats: hostRoster.seats, bots: hostRoster.bots }))));
  assert.ok(e && e.k === 'end' && e.seats && e.bots && e.names);
  assert.equal(e.names[e.seats.indexOf(e.champ!)], 'Bot 1');
  assert.equal(overLine({ seats: e.seats, bots: e.bots, departed: [], names: e.names }, e.scores, players, -1, e.rounds), watcher);
  // an older host's end packet without seats still parses
  const old = parsePacket({ game: 'tank-maze', type: 'end', room: 4, winner: null, champ: 2, scores: [1, 1, 3, 0], rounds: 7 });
  assert.ok(old && old.k === 'end' && old.seats === undefined);
});

test('tankName tags people who have gone, never bots', () => {
  const roster = { bots: [2, 3], departed: new Set([1]) };
  assert.equal(tankName('Bot 1', 2, roster, undefined), 'Bot 1');
  assert.equal(tankName('Guest (Left)', 1, roster, undefined), 'Guest (Left)');
  assert.equal(tankName('Host', 0, roster, 'Host'), 'Host');
  // someone who left after the last roster
  assert.equal(tankName('Host', 0, roster, undefined), 'Host (Left)');
  // the departed seat's player is back in the room while a bot still drives the tank
  assert.equal(tankName('Guest', 1, roster, 'Guest'), 'Guest (Bot)');
  assert.equal(tankName('Guest', 1, roster, 'Someone Else'), 'Guest (Left)');
});

test('malformed packets are rejected', () => {
  assert.equal(parsePacket(null), null);
  assert.equal(parsePacket('x'), null);
  assert.equal(parsePacket({}), null);
  assert.equal(parsePacket({ game: 'other', type: 's' }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'round', room: 'x' }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'round', room: 1, round: 1, seed: 1, cols: 99, rows: 6, seats: [0], bots: [], scores: [0], target: 5, level: 0, spawns: [{ x: 1, y: 1, a: 0 }] }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'in', room: 1, turn: 2, move: 0, fc: 0 }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'in', room: 1, turn: 0, move: 0, fc: 0, d: 9000 }), null);
  assert.equal(parsePacket({ game: 'tank-maze', type: 'in', room: 1, turn: 0, move: 0, fc: 0, d: 1.5 }), null);
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

test('toCanvas maps a scaled-down canvas back to logical pixels', () => {
  // Framed iPad: the canvas draws at 820x1078 but shows at 670x881, and the bottom stick lives in
  // logical pixels, so an unscaled touch on the lower band missed it.
  const size = { w: 820, h: 1078 };
  const rect = { left: 75, top: 150, width: 670, height: 881 };
  const lay = touchLayout(size.w, size.h, 2, true);
  const bottom = lay.zones.find((z) => !z.flip)!;
  const inZone = (p: { x: number; y: number }) => p.x >= bottom.x && p.x < bottom.x + bottom.w && p.y >= bottom.y && p.y < bottom.y + bottom.h;
  const cx = rect.left + 240;
  const cy = rect.top + rect.height - 40;
  assert.ok(inZone(toCanvas(cx, cy, rect, size)), 'scaled touch lands in the bottom zone');
  assert.ok(!inZone({ x: cx - rect.left, y: cy - rect.top }), 'the old unscaled math misses it');
  const corner = toCanvas(rect.left + rect.width, rect.top + rect.height, rect, size);
  assert.deepEqual(corner, { x: 820, y: 1078 });
  assert.deepEqual(toCanvas(10, 20, { left: 0, top: 0, width: 820, height: 1078 }, size), { x: 10, y: 20 });
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

test('hud chips skip the online badge and the shell controls', () => {
  const spans = freeSpans(12, 417, [{ x0: 273, x1: 328 }]);
  assert.deepEqual(spans, [{ x0: 12, x1: 265 }, { x0: 336, x1: 417 }]);
  const xs = packChips([100, 100, 40, 30], spans, 8);
  assert.ok(xs);
  const ws = [100, 100, 40, 30];
  for (let i = 0; i < 4; i++) {
    const inside = spans.some((s) => xs[i] >= s.x0 - 1e-9 && xs[i] + ws[i] <= s.x1 + 1e-9);
    assert.ok(inside, `chip ${i} at ${xs[i]} overlaps a blocked span`);
  }
  assert.equal(packChips([200, 200, 200], spans, 8), null);
});

test('hud chips that miss the row beside the controls wrap to a second row', () => {
  // phone portrait: four chips, only ~100px left of the 40px touch controls
  const row1 = freeSpans(12, 116, []);
  const row2 = freeSpans(12, 378, []);
  const ws = [70, 84, 76, 74];
  assert.equal(packChips(ws, row1, 14), null);
  const placed = packChipRows(ws, [row1, row2], 14);
  assert.ok(placed);
  assert.deepEqual(placed.map((p) => p.row), [0, 1, 1, 1]);
  const rowSpans = [row1, row2];
  placed.forEach((p, i) => {
    assert.ok(rowSpans[p.row].some((s) => p.x >= s.x0 - 1e-9 && p.x + ws[i] <= s.x1 + 1e-9), `chip ${i} leaves its row`);
  });
  // a row with room keeps everything on row 0
  assert.ok(packChipRows(ws, [freeSpans(12, 600, []), row2], 14)?.every((p) => p.row === 0));
  assert.equal(packChipRows([400], [row1, row2], 14), null);
});

// rough text metrics: about 0.56em per character
const measure = (text: string, px: number) => text.length * px * 0.56;
const inSpans = (x: number, w: number, spans: readonly Span[]) => spans.some((s) => x >= s.x0 - 1e-9 && x + w <= s.x1 + 1e-9);

test('score chips in a short framed window stay clear of the controls', () => {
  // 1280x720 framed laptop: a 464x198 stage, controls from x270
  const row1 = freeSpans(12, 262, []);
  const row2 = freeSpans(12, 452, []);
  const labels = ['You', 'Green', 'Blue', 'Gold'].map((name, i) => ({ name, score: `${i}` }));
  const fit = layoutChips(labels, row1, row2, { u: 1, rowH: 26, wrap: false, measure });
  assert.ok(fit.fits);
  assert.ok(fit.placed.every((p) => p.row === 0));
  fit.placed.forEach((p, i) => assert.ok(inSpans(p.x, fit.widths[i], row1), `chip ${i} runs under the controls`));
  assert.ok(fit.font >= 11.25);
});

test('score chips go around the online badge, shortening long names', () => {
  // desktop guest: a 523px stage, controls from x335, the badge at x150-205
  const row1 = freeSpans(12, 327, [{ x0: 150, x1: 205 }]);
  const row2 = freeSpans(12, 511, []);
  const labels = ['R2Guest', 'R2Host Longname', 'Bot 1', 'Bot 2'].map((name) => ({ name, score: '2' }));
  const fit = layoutChips(labels, row1, row2, { u: 1, rowH: 26, wrap: false, measure });
  fit.placed.forEach((p, i) => assert.ok(inSpans(p.x, fit.widths[i], fit.placed[i].row ? row2 : row1), `chip ${i} overlaps`));
  // tall stages wrap to a second row before clipping names
  const tall = layoutChips(labels, freeSpans(12, 116, []), freeSpans(12, 378, []), { u: 1, rowH: 44, wrap: true, measure });
  assert.ok(tall.fits);
  assert.deepEqual(tall.names, labels.map((l) => l.name));
  assert.ok(tall.placed.some((p) => p.row === 1));
});

test('clipped chip names keep their Left or Bot tag', () => {
  assert.equal(clipName('Bot 1', 5), 'Bot 1');
  assert.equal(clipName('Green Tester (Left)', 6), 'Green… (Left)');
  assert.equal(clipName('Somebody (Bot)', 24), 'Somebody (Bot)');
});

test('a taller hud band and larger touch controls push the board down', () => {
  const one = touchLayout(390, 728, 1, true);
  const two = touchLayout(390, 728, 1, true, 94);
  assert.equal(two.hud, 94);
  assert.equal(two.board.y, 94);
  assert.equal(two.board.y + two.board.h, one.board.y + one.board.h);
  // the default pill reach still applies when the measured one is smaller
  const land = touchLayout(844, 274, 1, true).board;
  const small = fitBoard(land, 12, 6, 844, { w: 100, h: 20 });
  assert.deepEqual(small, fitBoard(land, 12, 6, 844));
  // 40px touch controls: 272px wide, 62px tall from the top-right corner
  const big = fitBoard(land, 12, 6, 844, { w: 272, h: 62 });
  const right = big.ox + big.cell * 12;
  assert.ok(right <= 844 - 272 + 1e-9 || big.oy >= 62 - 1e-9, 'maze slides under the controls');
});

test('game over copy labels every score and lists the people in the room', () => {
  assert.equal(finalLine(['You', 'Green Tester', 'Bot 1', 'Bot 2'], [0, 0, 2, 3], 6), 'Bot 2 3, Bot 1 2, You 0 and Green Tester 0 after 6 rounds.');
  assert.equal(finalLine(['Red', 'Green', 'Blue'], [3, 1, 0], 1), 'Red 3, Green 1 and Blue 0 after 1 round.');
  assert.equal(rosterLine(['You', 'Green Tester']), '2 people here: You and Green Tester.');
  assert.equal(rosterLine(['You']), 'Just you here.');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
});

test('only someone who drove a tank this match is announced as having left', () => {
  // Host 0, guest 1, bots 2 and 3.
  const roster = { seats: [0, 1, 2, 3], bots: [2, 3], departed: new Set<number>() };
  let holders = tankHolders([0, 1], roster);
  assert.deepEqual([...holders], [0, 1]);

  // The guest leaves mid-round: announced, and a bot keeps their tank.
  let step = holdersLeft(holders, [0], roster, 0);
  assert.deepEqual(step.left, [1]);
  holders = step.holders;
  roster.departed.add(1);

  // A fresh phone takes the vacated seat as a waiting player, then switches to Watch: nobody is announced.
  step = holdersLeft(holders, [0, 1], roster, 0);
  assert.deepEqual(step.left, []);
  holders = step.holders;
  assert.deepEqual([...holders], [0]);
  step = holdersLeft(holders, [0], roster, 0);
  assert.deepEqual(step.left, []);

  // The same holds on a watcher's client, and even if the departure hadn't reached its roster yet.
  const late = { seats: [0, 1, 2, 3], bots: [2, 3], departed: new Set<number>() };
  const watcher = holdersLeft(tankHolders([0, 1], late), [0], late, -1);
  assert.deepEqual(watcher.left, [1]);
  assert.deepEqual(holdersLeft(watcher.holders, [0, 1], late, -1).left, []);
  assert.deepEqual(holdersLeft(holdersLeft(watcher.holders, [0, 1], late, -1).holders, [0], late, -1).left, []);

  // Next match the newcomer does drive seat 1, so leaving then is announced.
  const next = { seats: [0, 1, 2, 3], bots: [2, 3], departed: new Set<number>() };
  assert.deepEqual(holdersLeft(tankHolders([0, 1], next), [0], next, 0).left, [1]);
  // Bots and seats already handed to a bot never count.
  assert.deepEqual([...tankHolders([0, 1, 2], { seats: [0, 1, 2], bots: [2], departed: new Set([1]) })], [0]);
});
