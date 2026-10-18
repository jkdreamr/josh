export const SIZE = 10;

export const FLEET = [
  { id: 'flagship', name: 'Flagship', len: 5 },
  { id: 'frigate', name: 'Frigate', len: 4 },
  { id: 'corvette', name: 'Corvette', len: 3 },
  { id: 'sub', name: 'Sub', len: 3 },
  { id: 'patrol', name: 'Patrol Boat', len: 2 },
] as const;

export type ShipId = typeof FLEET[number]['id'];
export type Ship = { id: ShipId; r: number; c: number; horiz: boolean };
export type Fleet = Ship[];
export type Rng = () => number;
export type ShotResult = { cell: number; hit: boolean; sunk: ShipId | null; sunkCells: number[] | null; all: boolean };
export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;
export const SUNK = 3;
export type Intel = { cells: Uint8Array; sunk: ShipId[]; sunkShips: Ship[] };
export type Level = 0 | 1 | 2;

export type Msg =
  | { game: 'battleship'; t: 'ready'; commit: string }
  | { game: 'battleship'; t: 'begin'; first: 0 | 1 }
  | { game: 'battleship'; t: 'shot'; n: number; cell: number }
  | { game: 'battleship'; t: 'answer'; n: number; res: ShotResult }
  | { game: 'battleship'; t: 'result'; n: number; shooter: 0 | 1; res: ShotResult; next: 0 | 1 }
  | { game: 'battleship'; t: 'reveal'; fleet: string; salt: string };

const fleetOrder = new Map<ShipId, number>(FLEET.map((ship, index) => [ship.id, index]));
const validShipId = (id: unknown): id is ShipId => typeof id === 'string' && fleetOrder.has(id as ShipId);
const validCell = (cell: unknown): cell is number => Number.isInteger(cell) && (cell as number) >= 0 && (cell as number) < SIZE * SIZE;
const pick = <T,>(values: T[], rng: Rng): T => values[Math.min(values.length - 1, Math.floor(Math.max(0, rng()) * values.length))];
const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function shipLen(id: ShipId): number {
  return FLEET[fleetOrder.get(id)!].len;
}

export function shipCells(s: Ship): number[] {
  const len = shipLen(s.id);
  return Array.from({ length: len }, (_, i) => (s.r + (s.horiz ? 0 : i)) * SIZE + s.c + (s.horiz ? i : 0));
}

export function fits(s: Ship): boolean {
  const len = shipLen(s.id);
  return Number.isInteger(s.r) && Number.isInteger(s.c) && inBounds(s.r, s.c) &&
    (s.horiz ? s.c + len <= SIZE : s.r + len <= SIZE);
}

export function canPlace(fleet: Fleet, s: Ship): boolean {
  if (!fits(s)) return false;
  const occupied = new Set(fleet.filter((other) => other.id !== s.id).flatMap(shipCells));
  return shipCells(s).every((cell) => !occupied.has(cell));
}

export function isCompleteFleet(fleet: Fleet): boolean {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return false;
  const ids = new Set(fleet.map((ship) => ship.id));
  if (ids.size !== FLEET.length || FLEET.some(({ id }) => !ids.has(id))) return false;
  const occupied = new Set<number>();
  for (const ship of fleet) {
    if (!validShipId(ship.id) || !fits(ship)) return false;
    for (const cell of shipCells(ship)) {
      if (occupied.has(cell)) return false;
      occupied.add(cell);
    }
  }
  return true;
}

export function randomFleet(rng: Rng): Fleet {
  const fleet: Fleet = [];
  for (const { id } of FLEET) {
    const options: Ship[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const horiz of [true, false]) {
          const ship = { id, r, c, horiz };
          if (fits(ship) && canPlace(fleet, ship)) options.push(ship);
        }
      }
    }
    if (!options.length) return randomFleet(rng);
    fleet.push(pick(options, rng));
  }
  return fleet;
}

export function rotateShip(fleet: Fleet, id: ShipId): Ship | null {
  const ship = fleet.find((candidate) => candidate.id === id);
  if (!ship) return null;
  const len = shipLen(id);
  let candidate: Ship = { ...ship, horiz: !ship.horiz };
  if (!fits(candidate)) {
    candidate = candidate.horiz
      ? { ...candidate, c: SIZE - len }
      : { ...candidate, r: SIZE - len };
  }
  return canPlace(fleet, candidate) ? candidate : null;
}

export function resolveShot(fleet: Fleet, shotsAgainst: Uint8Array, cell: number): ShotResult {
  const ship = fleet.find((candidate) => shipCells(candidate).includes(cell));
  if (!ship) return { cell, hit: false, sunk: null, sunkCells: null, all: false };
  const cells = shipCells(ship);
  const sunk = cells.every((part) => part === cell || shotsAgainst[part] === 1);
  const all = sunk && fleet.every((candidate) => candidate.id === ship.id || shipCells(candidate).every((part) => shotsAgainst[part] === 1));
  return { cell, hit: true, sunk: sunk ? ship.id : null, sunkCells: sunk ? cells : null, all };
}

export function newIntel(): Intel {
  return { cells: new Uint8Array(SIZE * SIZE), sunk: [], sunkShips: [] };
}

function shipFromCells(id: ShipId, cells: number[]): Ship {
  const sorted = [...cells].sort((a, b) => a - b);
  const r = Math.floor(sorted[0] / SIZE);
  const c = sorted[0] % SIZE;
  return { id, r, c, horiz: sorted.every((cell) => Math.floor(cell / SIZE) === r) };
}

export function applyResult(intel: Intel, result: ShotResult): void {
  intel.cells[result.cell] = result.hit ? HIT : MISS;
  if (result.sunk && result.sunkCells) {
    for (const cell of result.sunkCells) intel.cells[cell] = SUNK;
    if (!intel.sunk.includes(result.sunk)) {
      intel.sunk.push(result.sunk);
      intel.sunkShips.push(shipFromCells(result.sunk, result.sunkCells));
    }
  }
}

export function remainingLens(intel: Intel): number[] {
  return FLEET.filter(({ id }) => !intel.sunk.includes(id)).map(({ len }) => len);
}

function activeHits(intel: Intel): number[] {
  return Array.from(intel.cells, (value, cell) => value === HIT ? cell : -1).filter((cell) => cell >= 0);
}

function unknownCells(intel: Intel): number[] {
  return Array.from(intel.cells, (value, cell) => value === UNKNOWN ? cell : -1).filter((cell) => cell >= 0);
}

function orthogonalNeighbors(cell: number): number[] {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([row, col]) => inBounds(row, col))
    .map(([row, col]) => row * SIZE + col);
}

function normalShot(intel: Intel, rng: Rng): number {
  const hits = activeHits(intel);
  const unknown = unknownCells(intel);
  if (hits.length) {
    const endpoints = new Set<number>();
    for (const hit of hits) {
      const row = Math.floor(hit / SIZE);
      const col = hit % SIZE;
      const sameRow = hits.filter((other) => Math.floor(other / SIZE) === row);
      if (sameRow.length > 1) {
        const min = Math.min(...sameRow.map((other) => other % SIZE));
        const max = Math.max(...sameRow.map((other) => other % SIZE));
        if (min > 0) endpoints.add(row * SIZE + min - 1);
        if (max < SIZE - 1) endpoints.add(row * SIZE + max + 1);
      }
      const sameCol = hits.filter((other) => other % SIZE === col);
      if (sameCol.length > 1) {
        const min = Math.min(...sameCol.map((other) => Math.floor(other / SIZE)));
        const max = Math.max(...sameCol.map((other) => Math.floor(other / SIZE)));
        if (min > 0) endpoints.add((min - 1) * SIZE + col);
        if (max < SIZE - 1) endpoints.add((max + 1) * SIZE + col);
      }
    }
    const lineTargets = [...endpoints].filter((cell) => intel.cells[cell] === UNKNOWN);
    if (lineTargets.length) return pick(lineTargets, rng);

    const neighbors = new Set(hits.flatMap(orthogonalNeighbors));
    const available = [...neighbors].filter((cell) => intel.cells[cell] === UNKNOWN);
    if (available.length) return pick(available, rng);
  }

  const remaining = remainingLens(intel);
  const parity = remaining.length ? Math.min(...remaining) : 2;
  const hunt = unknown.filter((cell) => {
    const row = Math.floor(cell / SIZE);
    const col = cell % SIZE;
    return (row + col) % (parity === 2 ? 2 : parity) === 0;
  });
  return pick(hunt.length ? hunt : unknown, rng);
}

export function densityMap(intel: Intel): Float64Array {
  const density = new Float64Array(SIZE * SIZE);
  const remaining = remainingLens(intel);
  const hits = intel.cells.reduce((count, value) => count + (value === HIT ? 1 : 0), 0);
  for (const len of remaining) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const horiz of [true, false]) {
          if ((horiz && c + len > SIZE) || (!horiz && r + len > SIZE)) continue;
          const cells = Array.from({ length: len }, (_, i) => (r + (horiz ? 0 : i)) * SIZE + c + (horiz ? i : 0));
          if (cells.some((cell) => intel.cells[cell] === MISS || intel.cells[cell] === SUNK)) continue;
          const hitCount = cells.reduce((count, cell) => count + (intel.cells[cell] === HIT ? 1 : 0), 0);
          const weight = hits > 0 && hitCount > 0 ? 50 ** hitCount : 1;
          for (const cell of cells) if (intel.cells[cell] === UNKNOWN) density[cell] += weight;
        }
      }
    }
  }
  return density;
}

function hardShot(intel: Intel, rng: Rng): number {
  const unknown = unknownCells(intel);
  const density = densityMap(intel);
  let max = -Infinity;
  let best: number[] = [];
  for (const cell of unknown) {
    if (density[cell] > max) {
      max = density[cell];
      best = [cell];
    } else if (density[cell] === max) best.push(cell);
  }
  return pick(best.length ? best : unknown, rng);
}

export function chooseShot(intel: Intel, level: Level, rng: Rng): number {
  const unknown = unknownCells(intel);
  if (!unknown.length) throw new Error('no unknown cells remain');
  if (level === 0) return pick(unknown, rng);
  if (level === 1) return normalShot(intel, rng);
  return hardShot(intel, rng);
}

export function fleetCode(fleet: Fleet): string {
  return [...fleet]
    .sort((a, b) => (fleetOrder.get(a.id) ?? Infinity) - (fleetOrder.get(b.id) ?? Infinity))
    .map(({ id, r, c, horiz }) => `${id}:${r},${c},${horiz ? 'h' : 'v'}`)
    .join(';');
}

export function parseFleet(code: unknown): Fleet | null {
  if (typeof code !== 'string' || !code) return null;
  const ships: Fleet = [];
  for (const part of code.split(';')) {
    const match = /^([a-z]+):(0|[1-9]\d?),(0|[1-9]\d?),([hv])$/.exec(part);
    if (!match || !validShipId(match[1])) return null;
    const [, rawId, rawR, rawC, direction] = match;
    const ship: Ship = { id: rawId as ShipId, r: Number(rawR), c: Number(rawC), horiz: direction === 'h' };
    if (!fits(ship)) return null;
    ships.push(ship);
  }
  return isCompleteFleet(ships) && fleetCode(ships) === code ? ships : null;
}

function sameResult(a: ShotResult, b: ShotResult): boolean {
  return a.cell === b.cell && a.hit === b.hit && a.sunk === b.sunk && a.all === b.all &&
    (a.sunkCells === null ? b.sunkCells === null : !!b.sunkCells && a.sunkCells.length === b.sunkCells.length &&
      a.sunkCells.every((cell, index) => cell === b.sunkCells![index]));
}

export function consistent(fleet: Fleet, log: ShotResult[]): boolean {
  if (!isCompleteFleet(fleet) || !Array.isArray(log)) return false;
  const shots = new Uint8Array(SIZE * SIZE);
  for (const answer of log) {
    if (!answer || !validCell(answer.cell) || shots[answer.cell]) return false;
    const expected = resolveShot(fleet, shots, answer.cell);
    if (!sameResult(expected, answer)) return false;
    shots[answer.cell] = 1;
  }
  return true;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parseShotResult(value: unknown): ShotResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!exactKeys(result, ['cell', 'hit', 'sunk', 'sunkCells', 'all']) || !validCell(result.cell) ||
      typeof result.hit !== 'boolean' || !(result.sunk === null || validShipId(result.sunk)) ||
      typeof result.all !== 'boolean' || !(result.sunkCells === null || Array.isArray(result.sunkCells))) return null;
  if (result.sunkCells !== null) {
    const cells = result.sunkCells as unknown[];
    if (!result.sunk || !result.hit || cells.length !== shipLen(result.sunk as ShipId) ||
        cells.some((cell) => !validCell(cell)) || new Set(cells).size !== cells.length || !cells.includes(result.cell)) return null;
    const ship = shipFromCells(result.sunk as ShipId, cells as number[]);
    if (!fits(ship) || shipCells(ship).some((cell) => !cells.includes(cell))) return null;
  } else if (result.sunk !== null || result.all) return null;
  return result as unknown as ShotResult;
}

export function parseMsg(value: unknown): Msg | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const msg = value as Record<string, unknown>;
  if (msg.game !== 'battleship' || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case 'ready':
      return exactKeys(msg, ['game', 't', 'commit']) && typeof msg.commit === 'string' && /^(?:[0-9a-f]{64})?$/.test(msg.commit)
        ? msg as Msg : null;
    case 'begin':
      return exactKeys(msg, ['game', 't', 'first']) && (msg.first === 0 || msg.first === 1) ? msg as Msg : null;
    case 'shot':
      return exactKeys(msg, ['game', 't', 'n', 'cell']) && Number.isSafeInteger(msg.n) && (msg.n as number) >= 0 && validCell(msg.cell)
        ? msg as Msg : null;
    case 'answer': {
      const res = parseShotResult(msg.res);
      return exactKeys(msg, ['game', 't', 'n', 'res']) && Number.isSafeInteger(msg.n) && (msg.n as number) >= 0 && res
        ? { game: 'battleship', t: 'answer', n: msg.n as number, res } : null;
    }
    case 'result': {
      const res = parseShotResult(msg.res);
      return exactKeys(msg, ['game', 't', 'n', 'shooter', 'res', 'next']) && Number.isSafeInteger(msg.n) && (msg.n as number) >= 0 &&
        (msg.shooter === 0 || msg.shooter === 1) && (msg.next === 0 || msg.next === 1) && res
        ? { game: 'battleship', t: 'result', n: msg.n as number, shooter: msg.shooter, res, next: msg.next } : null;
    }
    case 'reveal':
      return exactKeys(msg, ['game', 't', 'fleet', 'salt']) && !!parseFleet(msg.fleet) && typeof msg.salt === 'string' && /^[0-9a-f]{32}$/.test(msg.salt)
        ? msg as Msg : null;
    default:
      return null;
  }
}

/** Layout units per CSS px: 1/scale when a device frame shrinks the game (iPad), else 1. */
export function frameUnit(screenWidth: number, layoutWidth: number): number {
  if (!(screenWidth > 0) || !(layoutWidth > 0)) return 1;
  const scale = screenWidth / layoutWidth;
  return scale > 0.2 && scale < 0.99 ? Math.min(2, 1 / scale) : 1;
}

/** Board top under a status pill that wrapped below the toolbar; the column labels sit 15 units above the board. */
export function boardTopBelow(statusBottom: number, u = 1): number {
  return Math.ceil(statusBottom + 18 * u);
}

/** Board placement inside the stage; fixed-size chrome (buttons, labels, gaps) grows with u. */
export function boardGeometry(w: number, h: number, placing: boolean, top: number, u = 1) {
  const wide = w / Math.max(1, h) >= 1.25 || h < 220;
  const bottom = h < 220 ? 4 : 8;
  const available = Math.max(1, h - top - bottom);
  if (placing) {
    if (wide) {
      const cell = Math.floor(Math.max(7, Math.min((available - 9) / 10, (w - 187 * u) / 10)));
      const side = cell * 10 + 9;
      const x = Math.max(8, (w - side - 162 * u) / 2);
      return {
        portrait: false, targetCell: cell, targetX: 0, targetY: 0, ownCell: cell, ownX: 0, ownY: 0,
        placeCell: cell, placeX: x, placeY: top + (available - side) / 2,
        toolsX: x + side + 20 * u, toolsY: top + (available - 108 * u) / 2,
        fireX: 0, fireY: 0,
      };
    }
    const cell = Math.floor(Math.max(18, Math.min((w - 24 * u) / 10, (available - 65 * u) / 10)));
    const side = cell * 10 + 9;
    const placeY = top + Math.max(4, (available - side - 62 * u) / 2);
    return {
      portrait: true, targetCell: cell, targetX: 0, targetY: 0, ownCell: cell, ownX: 0, ownY: 0,
      placeCell: cell, placeX: Math.max(16 * u, (w - side) / 2), placeY,
      toolsX: Math.max(10 * u, (w - 330 * u) / 2), toolsY: Math.min(placeY + side + 12 * u, top + available - 52 * u),
      fireX: 0, fireY: 0,
    };
  }
  if (wide) {
    const cell = Math.floor(Math.max(7, Math.min((available - 9) / 10, (w - 42 * u) / 16.2)));
    const ownCell = Math.max(7, Math.floor(cell * 0.62));
    const targetSide = cell * 10 + 9;
    const ownSide = ownCell * 10 + 9;
    const gap = Math.max(12 * u, cell * 0.55);
    const x = Math.max(6 * u, (w - targetSide - ownSide - gap) / 2);
    const y = top + (available - targetSide) / 2;
    const ownX = x + targetSide + gap;
    const ownY = y + (targetSide - ownSide) / 2;
    return {
      portrait: false, targetCell: cell, targetX: x, targetY: y, ownCell, ownX, ownY,
      placeCell: cell, placeX: 0, placeY: 0,
      toolsX: 0, toolsY: 0,
      fireX: Math.min(w - 128 * u, Math.max(8 * u, ownX + (ownSide - 120 * u) / 2)),
      fireY: Math.min(ownY + ownSide + 10 * u, h - bottom - 50 * u),
    };
  }
  const cell = Math.floor(Math.max(18, Math.min((w - 24 * u) / 10, (available - 92 * u) / 15.8)));
  const ownCell = Math.max(12, Math.floor(cell * 0.58));
  const targetSide = cell * 10 + 9;
  const ownSide = ownCell * 10 + 9;
  const gapAbove = 8 * u;
  const fireHeight = 50 * u;
  // The own board's column labels sit 15 units above it, so leave them clear of Fire.
  const gapBelow = 18 * u;
  const total = targetSide + gapAbove + fireHeight + gapBelow + ownSide;
  const y = top + Math.max(0, (available - total) / 2);
  return {
    portrait: true, targetCell: cell, targetX: (w - targetSide) / 2, targetY: y,
    ownCell, ownX: (w - ownSide) / 2, ownY: y + targetSide + gapAbove + fireHeight + gapBelow,
    placeCell: cell, placeX: 0, placeY: 0,
    toolsX: 0, toolsY: 0, fireX: (w - 120 * u) / 2, fireY: y + targetSide + gapAbove,
  };
}
