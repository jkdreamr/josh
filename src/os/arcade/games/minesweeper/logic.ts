export type Level = 'beginner' | 'intermediate' | 'expert';
export type Position = [number, number];
export type Cell = { mine: boolean; adjacent: number; revealed: boolean; flagged: boolean; wrongFlag: boolean };
export type MinesBoard = Cell[][];

export const LEVELS: Record<Level, { rows: number; cols: number; mines: number }> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};

export type MinesGame = {
  level: Level;
  rows: number;
  cols: number;
  mineTotal: number;
  board: MinesBoard;
  placed: boolean;
  started: boolean;
  over: boolean;
  won: boolean;
  flags: number;
  revealed: number;
  seconds: number;
  clickedMine: Position | null;
};

export type RevealResult = { changed: boolean; revealed: Position[]; lost: boolean; won: boolean; clickedMine: Position | null };

const makeCell = (): Cell => ({ mine: false, adjacent: 0, revealed: false, flagged: false, wrongFlag: false });

export function createGame(level: Level = 'beginner'): MinesGame {
  const { rows, cols, mines } = LEVELS[level];
  return {
    level,
    rows,
    cols,
    mineTotal: mines,
    board: Array.from({ length: rows }, () => Array.from({ length: cols }, makeCell)),
    placed: false,
    started: false,
    over: false,
    won: false,
    flags: 0,
    revealed: 0,
    seconds: 0,
    clickedMine: null,
  };
}

export function neighbors(game: Pick<MinesGame, 'rows' | 'cols'>, row: number, col: number): Position[] {
  const result: Position[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < game.rows && c >= 0 && c < game.cols) result.push([r, c]);
  }
  return result;
}

function placeMines(game: MinesGame, safeRow: number, safeCol: number, rand: () => number) {
  const protectedCells = new Set([`${safeRow}:${safeCol}`, ...neighbors(game, safeRow, safeCol).map(([r, c]) => `${r}:${c}`)]);
  const available: Position[] = [];
  for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) if (!protectedCells.has(`${r}:${c}`)) available.push([r, c]);
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rand() * (i + 1))));
    [available[i], available[j]] = [available[j], available[i]];
  }
  for (const [r, c] of available.slice(0, game.mineTotal)) game.board[r][c].mine = true;
  for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) {
    game.board[r][c].adjacent = neighbors(game, r, c).filter(([nr, nc]) => game.board[nr][nc].mine).length;
  }
  game.placed = true;
}

function checkWin(game: MinesGame): boolean {
  if (game.revealed !== game.rows * game.cols - game.mineTotal) return false;
  game.won = true;
  game.over = true;
  for (const row of game.board) for (const cell of row) if (cell.mine) cell.flagged = true;
  game.flags = game.mineTotal;
  return true;
}

function lose(game: MinesGame, row: number, col: number): Position[] {
  game.over = true;
  game.clickedMine = [row, col];
  const revealed: Position[] = [];
  for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) {
    const cell = game.board[r][c];
    if (cell.mine && !cell.revealed) {
      cell.revealed = true;
      revealed.push([r, c]);
    }
    if (cell.flagged && !cell.mine) cell.wrongFlag = true;
  }
  return revealed;
}

function flood(game: MinesGame, row: number, col: number): Position[] {
  const queue: Position[] = [[row, col]];
  const revealed: Position[] = [];
  const queued = new Set([`${row}:${col}`]);
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    const cell = game.board[r][c];
    if (cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    game.revealed++;
    revealed.push([r, c]);
    if (!cell.adjacent) for (const [nr, nc] of neighbors(game, r, c)) {
      const key = `${nr}:${nc}`;
      if (!queued.has(key) && !game.board[nr][nc].revealed && !game.board[nr][nc].flagged) {
        queued.add(key);
        queue.push([nr, nc]);
      }
    }
  }
  return revealed;
}

export function reveal(game: MinesGame, row: number, col: number, rand: () => number = Math.random): RevealResult {
  if (game.over || row < 0 || row >= game.rows || col < 0 || col >= game.cols) return { changed: false, revealed: [], lost: false, won: game.won, clickedMine: null };
  const cell = game.board[row][col];
  if (cell.flagged) return { changed: false, revealed: [], lost: false, won: game.won, clickedMine: null };
  if (!game.placed) {
    placeMines(game, row, col, rand);
    game.started = true;
  }
  if (cell.revealed) {
    const near = neighbors(game, row, col);
    if (!cell.adjacent || near.filter(([r, c]) => game.board[r][c].flagged).length !== cell.adjacent) {
      return { changed: false, revealed: [], lost: false, won: game.won, clickedMine: null };
    }
    const revealed: Position[] = [];
    for (const [r, c] of near) {
      const target = game.board[r][c];
      if (!target.flagged && !target.revealed) {
        if (target.mine) {
          const mines = lose(game, r, c);
          return { changed: true, revealed: [...revealed, ...mines], lost: true, won: false, clickedMine: [r, c] };
        }
        revealed.push(...flood(game, r, c));
      }
    }
    const won = checkWin(game);
    return { changed: revealed.length > 0, revealed, lost: false, won, clickedMine: null };
  }
  if (cell.mine) {
    const mines = lose(game, row, col);
    return { changed: true, revealed: mines, lost: true, won: false, clickedMine: [row, col] };
  }
  const opened = flood(game, row, col);
  const won = checkWin(game);
  return { changed: opened.length > 0, revealed: opened, lost: false, won, clickedMine: null };
}

export function toggleFlag(game: MinesGame, row: number, col: number): boolean {
  if (game.over || row < 0 || row >= game.rows || col < 0 || col >= game.cols) return false;
  const cell = game.board[row][col];
  if (cell.revealed) return false;
  cell.flagged = !cell.flagged;
  game.flags += cell.flagged ? 1 : -1;
  return true;
}

export function tick(game: MinesGame, dt: number): void {
  if (game.started && !game.over) game.seconds += Math.max(0, dt);
}
