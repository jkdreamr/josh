export type Grid = number[][];
export type Direction = 'left' | 'right' | 'up' | 'down';
export type Position = [number, number];
export type TileMove = { from: Position; to: Position; value: number; merged: boolean };
export type MoveResult = { grid: Grid; moved: boolean; gained: number; moves: TileMove[] };
export type SpawnResult = { grid: Grid; position: Position | null; value: number };

export function emptyGrid(): Grid {
  return Array.from({ length: 4 }, () => [0, 0, 0, 0]);
}

export function spawn(grid: Grid, rand: () => number = Math.random): SpawnResult {
  const empty: Position[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) empty.push([r, c]);
  if (!empty.length) return { grid: grid.map((row) => [...row]), position: null, value: 0 };
  const index = Math.min(empty.length - 1, Math.max(0, Math.floor(rand() * empty.length)));
  const position = empty[index];
  const value = rand() < 0.1 ? 4 : 2;
  const next = grid.map((row) => [...row]);
  next[position[0]][position[1]] = value;
  return { grid: next, position, value };
}

export function createGame(rand: () => number = Math.random): Grid {
  let grid = emptyGrid();
  grid = spawn(grid, rand).grid;
  grid = spawn(grid, rand).grid;
  return grid;
}

export function move(grid: Grid, direction: Direction): MoveResult {
  const next = emptyGrid();
  const moves: TileMove[] = [];
  let gained = 0;
  for (let line = 0; line < 4; line++) {
    const positions: Position[] = [];
    for (let offset = 0; offset < 4; offset++) {
      if (direction === 'left') positions.push([line, offset]);
      else if (direction === 'right') positions.push([line, 3 - offset]);
      else if (direction === 'up') positions.push([offset, line]);
      else positions.push([3 - offset, line]);
    }
    const packed = positions.flatMap(([r, c]) => grid[r][c] ? [{ position: [r, c] as Position, value: grid[r][c] }] : []);
    const output: { value: number; sources: { position: Position; value: number }[]; merged: boolean }[] = [];
    for (let i = 0; i < packed.length; i++) {
      const current = packed[i];
      const last = output.at(-1);
      if (last && !last.merged && last.value === current.value) {
        last.value *= 2;
        last.merged = true;
        last.sources.push(current);
        gained += last.value;
      } else output.push({ value: current.value, sources: [current], merged: false });
    }
    output.forEach((tile, index) => {
      const [tr, tc] = positions[index];
      next[tr][tc] = tile.value;
      for (const source of tile.sources) moves.push({ from: source.position, to: [tr, tc], value: source.value, merged: tile.merged });
    });
  }
  const moved = next.some((row, r) => row.some((value, c) => value !== grid[r][c]));
  return { grid: next, moved, gained, moves };
}

export function canMove(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (!grid[r][c]) return true;
    if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
    if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
  }
  return false;
}

export type UndoState = { grid: Grid; score: number; used: boolean };

export function undo(state: UndoState, previous: { grid: Grid; score: number } | null): { state: UndoState; restored: boolean } {
  if (state.used || !previous) return { state: { ...state, used: true }, restored: false };
  return { state: { grid: previous.grid.map((row) => [...row]), score: previous.score, used: true }, restored: true };
}
