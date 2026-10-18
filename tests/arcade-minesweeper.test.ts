import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleared, createGame, LEVELS, neighbors, reveal, tick, toggleFlag, type Level, type MinesGame, type Position } from '../src/os/arcade/games/minesweeper/logic.ts';
import { generate, solve } from '../src/os/arcade/games/minesweeper/solver.ts';

function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function prepared(level: Level, mines: Position[]): MinesGame {
  const game = createGame(level);
  game.mineTotal = mines.length;
  game.placed = true;
  for (const [r, c] of mines) game.board[r][c].mine = true;
  for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) {
    game.board[r][c].adjacent = neighbors(game, r, c).filter(([nr, nc]) => game.board[nr][nc].mine).length;
  }
  return game;
}

test('first reveal protects the clicked cell and every neighbor on every level', () => {
  for (const level of Object.keys(LEVELS) as Level[]) for (let seed = 1; seed <= 12; seed++) {
    const game = createGame(level);
    const row = Math.floor(game.rows / 2);
    const col = Math.floor(game.cols / 2);
    const result = reveal(game, row, col, seeded(seed));
    assert.equal(result.lost, false, `${level} seed ${seed}`);
    assert.equal(game.board.flat().filter((cell) => cell.mine).length, LEVELS[level].mines);
    assert.equal(game.board[row][col].mine, false);
    for (const [r, c] of neighbors(game, row, col)) assert.equal(game.board[r][c].mine, false);
    assert.equal(game.board[row][col].adjacent, 0);
    assert.equal(game.board[row][col].revealed, true);
  }
});

test('iterative flood fill opens zero cells and their numbered border', () => {
  const game = prepared('beginner', [[0, 0]]);
  const result = reveal(game, 8, 8);
  assert.equal(result.lost, false);
  assert.ok(result.revealed.length > 50);
  assert.equal(game.board[0][0].revealed, false);
  assert.equal(game.board[0][1].adjacent, 1);
  assert.equal(game.board[0][1].revealed, true);
  assert.equal(result.revealed.length, game.revealed);
});

test('a correctly flagged chord reveals remaining neighbors', () => {
  const game = prepared('beginner', [[0, 0]]);
  reveal(game, 1, 1);
  assert.equal(game.board[1][1].adjacent, 1);
  assert.equal(toggleFlag(game, 0, 0), true);
  const result = reveal(game, 1, 1);
  assert.equal(result.lost, false);
  assert.equal(game.board[1][2].revealed, true);
  assert.equal(game.board[0][0].revealed, false);
});

test('a chord with a wrong flag can reveal a mine and lose', () => {
  const game = prepared('beginner', [[0, 0]]);
  reveal(game, 1, 1);
  toggleFlag(game, 0, 1);
  const result = reveal(game, 1, 1);
  assert.equal(result.lost, true);
  assert.deepEqual(result.clickedMine, [0, 0]);
  assert.equal(game.board[0][0].revealed, true);
  assert.equal(game.board[0][1].wrongFlag, true);
});

test('flags toggle only unrevealed cells and the remaining mine count can go negative', () => {
  const game = createGame('beginner');
  assert.equal(game.mineTotal - game.flags, 10);
  assert.equal(toggleFlag(game, 0, 0), true);
  assert.equal(game.mineTotal - game.flags, 9);
  assert.equal(toggleFlag(game, 0, 0), true);
  assert.equal(game.mineTotal - game.flags, 10);
  for (let i = 0; i < 12; i++) toggleFlag(game, Math.floor(i / game.cols), i % game.cols);
  assert.equal(game.mineTotal - game.flags, -2);
  reveal(game, 8, 8, seeded(7));
  assert.equal(toggleFlag(game, 8, 8), false);
});

test('winning reveals every safe cell and automatically flags remaining mines', () => {
  const game = prepared('beginner', [[0, 0]]);
  let result = reveal(game, 8, 8);
  if (!result.won) {
    for (let r = 0; r < game.rows && !game.won; r++) for (let c = 0; c < game.cols && !game.won; c++) {
      if (!game.board[r][c].mine && !game.board[r][c].revealed) result = reveal(game, r, c);
    }
  }
  assert.equal(game.won, true);
  assert.equal(game.flags, game.mineTotal);
  assert.equal(game.board[0][0].flagged, true);
  assert.equal(result.won, true);
});

test('the clock begins at first reveal and stops once the round ends', () => {
  const game = createGame('beginner');
  tick(game, 12);
  assert.equal(game.seconds, 0);
  reveal(game, 4, 4, seeded(3));
  tick(game, 1.25);
  assert.equal(game.seconds, 1.25);
  game.over = true;
  tick(game, 2);
  assert.equal(game.seconds, 1.25);
});

test('every board can be cleared without guessing, from the middle or a corner', () => {
  for (const level of Object.keys(LEVELS) as Level[]) for (let seed = 1; seed <= 25; seed++) {
    const { rows, cols, mines } = LEVELS[level];
    for (const [row, col] of [[Math.floor(rows / 2), Math.floor(cols / 2)], [0, 0], [rows - 1, cols - 1]] as Position[]) {
      const out = generate(rows, cols, mines, row, col, { rand: seeded(seed * 31 + row), budgetMs: 2000 });
      assert.equal(out.solvable, true, `${level} seed ${seed} at ${row},${col}`);
      assert.equal(out.mines.reduce((sum, m) => sum + m, 0), mines);
      assert.equal(solve(rows, cols, out.mines, row * cols + col).solved, true);
      for (const [r, c] of [[row, col], ...neighbors({ rows, cols }, row, col)]) assert.equal(out.mines[r * cols + c], 0);
    }
  }
});

test('the solver refuses a coin flip', () => {
  // The last mine of a 2x3 strip could sit in either left square, and nothing tells them apart.
  const mines = Uint8Array.from([0, 0, 0, 1, 0, 0]);
  assert.equal(solve(2, 3, mines, 2).solved, false);
  // Here the pair rule finds it: the 1 in the middle sees everything the 1 above it sees.
  const easy = Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(solve(3, 3, easy, 0).solved, true);
});

test('generation stays fast enough for a first tap on expert', () => {
  let worst = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = performance.now();
    reveal(createGame('expert'), 8, 15, seeded(seed));
    worst = Math.max(worst, performance.now() - t);
  }
  assert.ok(worst < 400, `slowest expert first dig took ${worst.toFixed(0)}ms`);
});

test('cleared reports the share of safe squares uncovered', () => {
  const game = prepared('beginner', [[0, 0]]);
  assert.equal(cleared(game), 0);
  reveal(game, 0, 1);
  assert.equal(cleared(game), 1 / 80);
});
