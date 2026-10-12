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
  type Game,
} from '../src/os/arcade/games/bubble-shooter/logic.ts';

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

test('seeded boards are deterministic and levelConfig scales', () => {
  const a = createGame({ seed: 42 });
  const b = createGame({ seed: 42 });
  assert.deepEqual(a.grid, b.grid);
  assert.equal(a.current, b.current);
  assert.equal(a.next, b.next);
  const c = createGame({ seed: 43 });
  assert.notDeepEqual(a.grid, c.grid);
  assert.equal(a.grid.length, 5);
  assert.ok(a.grid.every((row) => row.every((v) => v >= 0 && v < 4)));
  assert.equal(a.grid[0].length, COLS);
  assert.equal(a.grid[1].length, COLS - 1);
  assert.deepEqual(levelConfig(1), { rows: 5, colors: 4, dropEvery: 8, dropInterval: 32 });
  assert.deepEqual(levelConfig(3), { rows: 7, colors: 5, dropEvery: 6, dropInterval: 28 });
  assert.deepEqual(levelConfig(5), { rows: 9, colors: 6, dropEvery: 4, dropInterval: 24 });
  assert.deepEqual(levelConfig(20), { rows: 9, colors: 6, dropEvery: 4, dropInterval: 14 });
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

test('three in a row pop, two do not and count toward the drop', () => {
  const game = emptyGame();
  game.grid = [row0(), row0(COLS - 1)];
  game.grid[0][0] = 1;
  game.grid[1][0] = 1;
  game.current = 1;
  game.next = 0;
  game.dropEvery = 8;
  game.shotsUntilDrop = 8;
  game.effects.length = 0;
  // place at (1,1): neighbors of (1,1) include (0,1)? For odd row 1, c=1: neighbors (0,1),(0,2)... (0,0)? odd: upper (r-1,c),(r-1,c+1) = (0,1),(0,2). So (1,0) neighbors (0,0),(0,1).
  // Instead shoot at a spot adjacent to both (0,0) and (1,0): cell (1,0) is occupied; use empty (0,1): its neighbors include (0,0) and (1,0) (even row: lower neighbors (1,c-1),(1,c) = (1,0),(1,1)).
  game.grid[0][1] = 1;
  // now (0,0),(0,1),(1,0) occupied, all color 1; settle a new 1 at (0,2)
  game.grid[0][2] = -1;
  game.grid[0][9] = 3; // anchored leftover so the board is not cleared
  const target = { r: 0, c: 2 };
  game.shot = { points: [SHOOTER, cellCenter(game, 0, 2)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 1, target };
  step(game, 10);
  const pops = game.effects.filter((e) => e.type === 'pop');
  assert.equal(pops.length, 4); // the whole connected group of 4 pops
  assert.equal(game.score, 40);
  assert.equal(game.combo, 1);

  // two in a row: no pop, shotsUntilDrop decremented
  const g2 = emptyGame();
  g2.grid = [row0(), row0(COLS - 1)];
  g2.grid[0][0] = 2;
  g2.shotsUntilDrop = 5;
  g2.effects.length = 0;
  g2.shot = { points: [SHOOTER, cellCenter(g2, 0, 1)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 2, target: { r: 0, c: 1 } };
  step(g2, 10);
  assert.equal(g2.effects.filter((e) => e.type === 'pop').length, 0);
  assert.equal(g2.shotsUntilDrop, 4);
  assert.equal(getCell(g2, 0, 1), 2);
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

test('ceiling drops by shot count and timer, ends game past the deadline', () => {
  const game = emptyGame();
  game.grid = [row0()];
  game.grid[0][0] = 0;
  game.grid[0][5] = 0;
  game.dropEvery = 4;
  game.shotsUntilDrop = 4;
  game.dropInterval = 999;
  game.dropTimer = 999;
  // four non-popping shots at safe, non-adjacent cells trigger one drop
  const spots: [number, number][] = [[0, 1], [0, 3], [0, 7], [0, 9]];
  for (const [r, c] of spots) {
    game.effects.length = 0;
    game.shot = { points: [SHOOTER, cellCenter(game, r, c)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 5, target: { r, c } };
    step(game, 10);
  }
  assert.equal(game.ceiling, ROW_H);
  assert.equal(game.shotsUntilDrop, 4);
  assert.ok(game.effects.some((e) => e.type === 'ceiling'));
  // timed drop only ticks while aiming
  game.dropTimer = 0.05;
  const t0 = game.dropTimer;
  game.shot = { points: [SHOOTER, cellCenter(game, 0, 2)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 5, target: { r: 0, c: 2 } };
  step(game, 0.03);
  assert.equal(game.dropTimer, t0); // frozen mid-flight
  runShot(game);
  game.dropTimer = 0.05;
  step(game, 0.06);
  assert.equal(game.ceiling, 2 * ROW_H);
  // deadline: ceiling push moves lowest bubble past DEADLINE_Y
  const g2 = emptyGame();
  g2.grid = [row0()];
  g2.grid[0][0] = 0;
  g2.ceiling = DEADLINE_Y - 2 * R + 1; // bottom already 1 under? bottom = ceiling + 2R = DEADLINE_Y+1
  g2.dropTimer = 0.01;
  g2.effects.length = 0;
  step(g2, 0.02);
  assert.equal(g2.ended, true);
  assert.ok(g2.effects.some((e) => e.type === 'over'));
  assert.equal(fire(g2, Math.PI / 2), false);
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

test('clearing the board pays the level bonus and starts the next level', () => {
  const game = createGame({ seed: 9 });
  game.grid = [row0()];
  game.grid[0][0] = 1;
  game.grid[0][1] = 1;
  game.score = 100;
  game.effects.length = 0;
  game.shot = { points: [SHOOTER, cellCenter(game, 0, 2)], seg: 0, along: 0, pos: { ...SHOOTER }, color: 1, target: { r: 0, c: 2 } };
  step(game, 10);
  assert.equal(game.grid.length, 0);
  assert.ok(game.levelBanner > 0);
  assert.equal(game.score, 100 + 30 + 500);
  assert.ok(game.effects.some((e) => e.type === 'level' && e.bonus === 500 && e.level === 1));
  assert.equal(fire(game, Math.PI / 2), false);
  step(game, 1.7);
  assert.equal(game.level, 2);
  assert.equal(game.ceiling, 0);
  assert.equal(game.grid.length, 6);
  assert.equal(game.score, 630);
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
