import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COLS,
  DEADLINE_Y,
  FIELD_W,
  MIN_ANGLE,
  R,
  ROW_H,
  SHOOTER,
  aimAt,
  boardColors,
  cellCenter,
  clampAim,
  createGame,
  findFloating,
  findMatches,
  fire,
  getCell,
  inBounds,
  levelConfig,
  lowestBubbleBottom,
  neighbors,
  rowLength,
  step,
  swap,
  traceAim,
  BOMB,
  ICE,
  RAINBOW,
  STONE,
  hue,
  parseMap,
  rainbowColor,
  starsFor,
  type Game,
} from '../src/os/arcade/games/bubble-shooter/logic.ts';
import { LEVELS } from '../src/os/arcade/games/bubble-shooter/levels.ts';
import { parseProgress, recordClear, unlocked, totalStars } from '../src/os/arcade/games/bubble-shooter/progress.ts';

function emptyGame(seed = 1): Game {
  const game = createGame({ seed });
  game.grid = [];
  return game;
}

function row0(len = COLS): number[] {
  return new Array(len).fill(-1);
}

function runShot(game: Game): void {
  for (let i = 0; i < 600 && game.shot !== null; i++) step(game, 1 / 60);
  assert.equal(game.shot, null);
}

test('geometry: row lengths, centers, neighbors, bounds', () => {
  const game = emptyGame();
  assert.equal(rowLength(0), COLS);
  assert.equal(rowLength(1), COLS - 1);
  assert.equal(rowLength(2), COLS);
  assert.deepEqual(cellCenter(game, 0, 0), { x: R, y: R });
  assert.deepEqual(cellCenter(game, 1, 0), { x: 2 * R, y: R + ROW_H });
  assert.deepEqual(cellCenter(game, 2, 9), { x: R + 18 * R, y: R + 2 * ROW_H });

  const even = neighbors(2, 5).map((p) => `${p.r},${p.c}`).sort();
  assert.deepEqual(even, ['1,4', '1,5', '2,4', '2,6', '3,4', '3,5']);
  const odd = neighbors(3, 5).map((p) => `${p.r},${p.c}`).sort();
  assert.deepEqual(odd, ['2,5', '2,6', '3,4', '3,6', '4,5', '4,6']);
  assert.equal(neighbors(0, 0).length, 2);
  assert.deepEqual(
    neighbors(1, COLS - 2).map((p) => `${p.r},${p.c}`).sort(),
    ['0,8', '0,9', '1,7', '2,8', '2,9'],
  );
  assert.equal(inBounds(1, COLS - 1), false);
  assert.equal(inBounds(0, COLS - 1), true);
  assert.equal(inBounds(-1, 0), false);
});

test('traceAim straight up on an empty board lands in row 0', () => {
  const game = emptyGame();
  const { points, cell } = traceAim(game, Math.PI / 2);
  assert.equal(points.length, 2);
  assert.ok(cell !== null && cell.r === 0);
  const cc = cellCenter(game, cell!.r, cell!.c);
  assert.equal(points[1].x, cc.x);
  assert.equal(points[1].y, cc.y);
  assert.ok(Math.abs(cc.x - SHOOTER.x) <= R);
});

test('traceAim reflects off the left wall and stays in bounds', () => {
  const game = emptyGame();
  const { points } = traceAim(game, Math.PI - 0.3);
  assert.ok(points.length >= 3);
  assert.ok(Math.abs(points[1].x - R) < 1e-9);
  for (const p of points) {
    assert.ok(p.x >= R - 1e-9 && p.x <= FIELD_W - R + 1e-9);
  }
});

test('guide equals result for ~200 angles', () => {
  for (let i = 0; i < 200; i++) {
    const game = createGame({ seed: 7 });
    const angle = MIN_ANGLE + (Math.PI - 2 * MIN_ANGLE) * (i / 199);
    const { cell } = traceAim(game, angle);
    assert.ok(cell !== null);
    const color = game.current;
    game.effects.length = 0;
    assert.equal(fire(game, angle), true);
    runShot(game);
    const placed = getCell(game, cell!.r, cell!.c);
    if (placed !== color) {
      // popped or dropped: a pop/stick effect at that cell's center was emitted
      const cc = cellCenter(game, cell!.r, cell!.c);
      const saw = game.effects.some(
        (e) => (e.type === 'pop' || e.type === 'stick') && e.x === cc.x && e.y === cc.y,
      );
      assert.ok(saw, `angle ${angle}: cell ${cell!.r},${cell!.c} lost without an effect`);
    }
  }
});

test('floating clusters drop and score by the formula', () => {
  const game = emptyGame();
  game.grid = [row0(), row0(COLS - 1), row0()];
  // row0: three color-1 cells (0,0),(0,1),(0,2); hang cluster under (0,2)
  game.grid[0][0] = 1;
  game.grid[0][1] = 1;
  game.grid[0][2] = 1;
  game.grid[1][1] = 3; // neighbor of (0,2) (odd row: upper (0,1),(0,2))
  game.grid[2][1] = 4; // neighbor of (1,1)
  game.grid[0][9] = 5; // anchored leftover so the board is not cleared
  game.effects.length = 0;
  game.shot = { points: [SHOOTER, cellCenter(game, 0, 3)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 1, target: { r: 0, c: 3 } };
  step(game, 10);
  assert.equal(game.effects.filter((e) => e.type === 'pop').length, 4);
  const drops = game.effects.filter((e) => e.type === 'drop');
  assert.equal(drops.length, 2);
  assert.equal(getCell(game, 1, 1), -1);
  assert.equal(getCell(game, 2, 1), -1);
  // points = (10*4 + 25*2*ceil(2/4)) * 1 = 40 + 50 = 90
  assert.equal(game.score, 90);
});

test('combo streak doubles points and a miss resets it', () => {
  const game = emptyGame();
  game.grid = [row0()];
  game.grid[0][0] = 1;
  game.grid[0][1] = 1;
  game.grid[0][5] = 2;
  game.grid[0][6] = 2;
  game.grid[0][9] = 3;
  game.effects.length = 0;
  const shoot = (color: number, target: { r: number; c: number }) => {
    game.shot = { points: [SHOOTER, cellCenter(game, target.r, target.c)], seg: 0, along: 0, pos: { ...SHOOTER }, color, target };
    step(game, 10);
  };
  shoot(1, { r: 0, c: 2 });
  assert.equal(game.combo, 1);
  assert.equal(game.score, 30);
  const before = game.score;
  shoot(2, { r: 0, c: 7 });
  assert.equal(game.combo, 2);
  assert.equal(game.score - before, 60); // 30 * combo 2
  assert.equal(game.bestCombo, 2);
  const beforeMiss = game.score;
  shoot(5, { r: 0, c: 4 }); // no match
  assert.equal(game.combo, 0);
  assert.equal(game.score, beforeMiss);
  assert.equal(game.bestCombo, 2);
});

test('swap exchanges current/next and emits swap; used colors re-roll to board colors', () => {
  const game = createGame({ seed: 5 });
  const cur = game.current;
  const nxt = game.next;
  game.effects.length = 0;
  assert.equal(swap(game), true);
  assert.equal(game.current, nxt);
  assert.equal(game.next, cur);
  assert.ok(game.effects.some((e) => e.type === 'swap'));
  // after the last bubble of a color is cleared, current/next re-roll to live colors
  game.grid = [row0()];
  game.grid[0][0] = 1;
  game.grid[0][1] = 1;
  game.grid[0][4] = 2;
  game.current = 5; // not on board
  game.next = 5;
  game.shot = { points: [SHOOTER, cellCenter(game, 0, 2)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 1, target: { r: 0, c: 2 } };
  step(game, 10);
  const on = boardColors(game);
  assert.ok(on.includes(game.current) && on.includes(game.next));
});

test('aimAt and clampAim clamp to the allowed fan', () => {
  const from = { x: 200, y: 500 };
  assert.equal(aimAt(from, { x: 200, y: 100 }), Math.PI / 2);
  assert.equal(aimAt(from, { x: 50, y: 600 }), Math.PI - MIN_ANGLE);
  assert.equal(aimAt(from, { x: 350, y: 600 }), MIN_ANGLE);
  assert.equal(clampAim(0.01), MIN_ANGLE);
  assert.equal(clampAim(Math.PI - 0.01), Math.PI - MIN_ANGLE);
  assert.equal(clampAim(Math.PI / 2), Math.PI / 2);
});

test('findMatches and findFloating on hand-built grids', () => {
  const game = emptyGame();
  game.grid = [row0(), row0(COLS - 1), row0()];
  game.grid[0][0] = 1;
  game.grid[1][0] = 1;
  game.grid[2][0] = 1;
  game.grid[2][9] = 2; // isolated? (2,9) neighbors include (1,8) which is empty -> floating
  const m = findMatches(game, 1, 0);
  assert.equal(m.length, 3);
  const f = findFloating(game);
  assert.deepEqual(f, [{ r: 2, c: 9 }]);
  assert.equal(lowestBubbleBottom(game), cellCenter(game, 2, 9).y + R);
});

/** Finds an angle whose guide lands exactly in (r, c), then fires it. */
function shootAt(game: Game, r: number, c: number): void {
  for (let a = MIN_ANGLE; a <= Math.PI - MIN_ANGLE; a += 0.0005) {
    const t = traceAim(game, a);
    if (t.cell && t.cell.r === r && t.cell.c === c) {
      assert.ok(fire(game, a));
      runShot(game);
      return;
    }
  }
  assert.fail(`no angle lands in ${r},${c}`);
}

function levelGame(level: number, grid: number[][]): Game {
  const game = createGame({ mode: 'levels', level, seed: 3 });
  game.grid = grid;
  game.effects.length = 0;
  return game;
}

test('endless boards are deterministic and levelConfig ramps up', () => {
  assert.deepEqual(createGame({ seed: 42 }).grid, createGame({ seed: 42 }).grid);
  assert.notDeepEqual(createGame({ seed: 42 }).grid, createGame({ seed: 43 }).grid);
  assert.deepEqual(levelConfig(1), { rows: 6, colors: 4, dropEvery: 6, dropInterval: 12, specials: 0 });
  assert.equal(levelConfig(3).colors, 5);
  assert.equal(levelConfig(3).dropEvery, 5);
  assert.deepEqual(levelConfig(30), { rows: 6, colors: 8, dropEvery: 2, dropInterval: 5, specials: 0.16 });
  const g = createGame({ seed: 42 });
  assert.equal(g.mode, 'endless');
  assert.equal(g.shotsLeft, Infinity);
  assert.equal(g.grid.length, 6);
  for (const row of g.grid) for (const v of row) assert.ok(v >= 0 && v < 4);
});

test('every level parses, has a fair shot budget and brings in specials after their intro', () => {
  assert.ok(LEVELS.length >= 30);
  const intro = { stone: LEVELS.findIndex((l) => l.map.some((m) => m.includes('#'))), bomb: LEVELS.findIndex((l) => l.map.some((m) => m.includes('*'))), ice: LEVELS.findIndex((l) => l.map.some((m) => /[A-Z]/.test(m))) };
  assert.ok(intro.stone > 5 && intro.bomb > intro.stone && intro.ice > intro.bomb);
  for (const k of ['stone', 'bomb', 'ice'] as const) assert.ok(LEVELS[intro[k]].tip, `level ${intro[k] + 1} explains the ${k}`);
  let maxHues = 0;
  LEVELS.forEach((def, i) => {
    const grid = parseMap(def.map);
    const hues = new Set(grid.flat().map(hue).filter((h) => h >= 0));
    assert.ok(hues.size >= 3, `level ${i + 1} colors`);
    if (i < 6) assert.ok(hues.size <= 5, `level ${i + 1} starts simple`);
    maxHues = Math.max(maxHues, hues.size);
    const [two, three] = def.stars;
    assert.ok(two >= 1 && two < three && three < def.shots, `level ${i + 1} stars`);
    const g = createGame({ mode: 'levels', level: i + 1, seed: 1 });
    assert.equal(g.shotsLeft, def.shots);
    assert.equal(g.def, def);
    assert.ok(lowestBubbleBottom(g) < DEADLINE_Y - ROW_H, `level ${i + 1} leaves room`);
  });
  assert.equal(maxHues, 8);
  assert.throws(() => parseMap(['r r r']));
  assert.throws(() => parseMap(['r r r r r r r r r x']));
});

test('every shot counts toward the next drop; endless pushes a row in on top', () => {
  const game = emptyGame();
  game.level = 1;
  game.grid = [row0()];
  game.grid[0][0] = 1;
  game.current = 2;
  game.next = 3;
  game.dropEvery = 2;
  game.shotsUntilDrop = 2;
  shootAt(game, 0, 9);
  assert.equal(game.shotsUntilDrop, 1);
  shootAt(game, 0, 8);
  assert.equal(game.parity, 1);
  assert.equal(game.pushed, 1);
  assert.equal(game.grid[0].length, rowLength(0, 1));
  assert.equal(game.grid[1][0], 1);
  assert.equal(cellCenter(game, 0, 0).x, 2 * R);
  assert.equal(cellCenter(game, 1, 0).x, R);
  assert.deepEqual(neighbors(1, 0, 1).map((p) => `${p.r},${p.c}`).sort(), ['0,0', '1,1', '2,0'].sort());
  assert.equal(game.shotsUntilDrop, 2);
  assert.ok(game.effects.some((e) => e.type === 'ceiling'));
  assert.equal(game.shotsLeft, Infinity);
});

test('levels drop the ceiling by shots and by timer, and end at the line', () => {
  const game = createGame({ mode: 'levels', level: 7, seed: 4 });
  game.shotsUntilDrop = 1;
  assert.ok(fire(game, Math.PI / 2));
  runShot(game);
  assert.equal(game.ceiling, ROW_H);
  assert.equal(game.shotsUntilDrop, game.dropEvery);

  const timed = createGame({ mode: 'levels', level: LEVELS.findIndex((l) => l.time > 0) + 1, seed: 4 });
  timed.dropTimer = 0.5;
  step(timed, 0.6);
  assert.equal(timed.ceiling, ROW_H);
  timed.ceiling = DEADLINE_Y;
  timed.dropTimer = 0.1;
  step(timed, 0.2);
  assert.ok(timed.ended);
  assert.equal(timed.outcome, 'line');
});

test('clearing a level ends it with stars from the shots left; running out fails it', () => {
  const grid = [row0()];
  grid[0][0] = 0;
  grid[0][1] = 0;
  const game = levelGame(1, grid);
  game.current = 0;
  game.shotsLeft = 10;
  shootAt(game, 0, 2);
  assert.equal(game.outcome, 'clear');
  assert.ok(game.ended);
  assert.equal(game.shotsLeft, 9);
  assert.equal(game.stars, starsFor(LEVELS[0], 9));
  assert.ok(game.effects.some((e) => e.type === 'clear' && e.bonus === 1000 + 150 * 9));
  assert.equal(starsFor(LEVELS[0], LEVELS[0].stars[1]), 3);
  assert.equal(starsFor(LEVELS[0], LEVELS[0].stars[0]), 2);
  assert.equal(starsFor(LEVELS[0], 0), 1);

  const grid2 = [row0()];
  grid2[0][0] = 0;
  grid2[0][5] = 1;
  const last = levelGame(1, grid2);
  last.current = 1;
  last.shotsLeft = 1;
  assert.equal(swap(last), false);
  shootAt(last, 0, 9);
  assert.equal(last.outcome, 'shots');
  assert.equal(fire(last, Math.PI / 2), false);
});

test('a bomb clears the ring around it when hit', () => {
  const game = emptyGame();
  game.grid = [row0(), row0(COLS - 1)];
  game.grid[0][0] = 1;
  game.grid[0][1] = BOMB;
  game.grid[0][2] = 2;
  game.grid[0][3] = 3;
  game.grid[1][0] = 4;
  game.current = 0;
  game.next = 0;
  shootAt(game, 1, 1);
  assert.ok(game.effects.some((e) => e.type === 'blast'));
  assert.equal(getCell(game, 0, 0), -1);
  assert.equal(getCell(game, 0, 1), -1);
  assert.equal(getCell(game, 0, 2), -1);
  assert.equal(getCell(game, 1, 0), -1);
  assert.equal(getCell(game, 1, 1), -1);
  assert.equal(getCell(game, 0, 3), 3);
});

test('ice never matches until a shot lands or a pop happens beside it', () => {
  const game = emptyGame();
  game.grid = [row0()];
  game.grid[0][0] = ICE + 1;
  game.grid[0][1] = ICE + 1;
  game.grid[0][9] = 3;
  assert.deepEqual(findMatches(game, 0, 0), []);
  game.current = 1;
  game.next = 1;
  shootAt(game, 0, 2);
  assert.equal(getCell(game, 0, 1), 1);
  assert.equal(getCell(game, 0, 0), ICE + 1);
  assert.equal(getCell(game, 0, 2), 1);

  const pop = emptyGame();
  pop.grid = [row0()];
  pop.grid[0][0] = ICE + 2;
  pop.grid[0][1] = 1;
  pop.grid[0][2] = 1;
  pop.grid[0][9] = 3;
  pop.current = 1;
  shootAt(pop, 0, 3);
  assert.equal(getCell(pop, 0, 0), 2);
  assert.ok(pop.effects.some((e) => e.type === 'thaw'));
});

test('stones never pop but fall once cut loose', () => {
  const game = emptyGame();
  game.grid = [row0(), row0(COLS - 1)];
  game.grid[0][0] = 1;
  game.grid[0][1] = 1;
  game.grid[1][0] = STONE;
  game.grid[0][9] = 3;
  game.current = 1;
  shootAt(game, 0, 2);
  assert.equal(getCell(game, 1, 0), -1);
  assert.ok(game.effects.some((e) => e.type === 'drop' && e.color === STONE));
  assert.equal(getCell(game, 0, 9), 3);
});

test('a rainbow bubble takes the color that pops the most, and combos earn one', () => {
  const game = emptyGame();
  game.grid = [row0()];
  game.grid[0][0] = 2;
  game.grid[0][1] = 2;
  game.grid[0][3] = 1;
  game.grid[0][9] = 4;
  assert.equal(rainbowColor(game, 0, 2), 2);
  game.current = RAINBOW;
  game.next = 4;
  game.combo = 3;
  shootAt(game, 0, 2);
  assert.equal(getCell(game, 0, 0), -1);
  assert.equal(getCell(game, 0, 3), 1);
  assert.equal(game.combo, 4);
  assert.ok(game.next === RAINBOW || game.current === RAINBOW);
  assert.ok(game.effects.some((e) => e.type === 'rainbow'));
});

test('campaign progress parses safely and unlocks in order', () => {
  assert.deepEqual(parseProgress(null), { stars: {}, best: {} });
  assert.deepEqual(parseProgress('not json'), { stars: {}, best: {} });
  const p = parseProgress(JSON.stringify({ stars: { '1': 3, '2': 9, nope: 2, '3': -1 }, best: { '1': 1200, '2': 'x' } }));
  assert.deepEqual(p, { stars: { '1': 3 }, best: { '1': 1200 } });
  assert.ok(unlocked(p, '1') && unlocked(p, '2') && !unlocked(p, '3'));
  assert.equal(recordClear(p, '2', 2, 800), true);
  assert.equal(recordClear(p, '2', 1, 100), false);
  assert.deepEqual([p.stars['2'], p.best['2']], [2, 800]);
  assert.equal(totalStars(p), 5);
});
