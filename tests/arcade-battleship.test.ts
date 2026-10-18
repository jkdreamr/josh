import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FLEET,
  HIT,
  MISS,
  SIZE,
  SUNK,
  UNKNOWN,
  applyResult,
  boardGeometry,
  canPlace,
  chooseShot,
  consistent,
  densityMap,
  fleetCode,
  frameUnit,
  isCompleteFleet,
  newIntel,
  parseFleet,
  parseMsg,
  randomFleet,
  remainingLens,
  resolveShot,
  rotateShip,
  shipCells,
  type Fleet,
  type Level,
  type Rng,
  type ShotResult,
} from '../src/os/arcade/games/battleship/battleship.ts';

function seeded(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const handFleet: Fleet = [
  { id: 'flagship', r: 0, c: 0, horiz: true },
  { id: 'frigate', r: 1, c: 0, horiz: true },
  { id: 'corvette', r: 2, c: 0, horiz: true },
  { id: 'sub', r: 3, c: 0, horiz: true },
  { id: 'patrol', r: 4, c: 0, horiz: true },
];

test('random fleets are complete, in bounds, non-overlapping and contain 17 cells', () => {
  for (let seed = 0; seed < 500; seed++) {
    const fleet = randomFleet(seeded(seed));
    assert.equal(isCompleteFleet(fleet), true, `seed ${seed}`);
    const cells = fleet.flatMap(shipCells);
    assert.equal(cells.length, 17);
    assert.equal(new Set(cells).size, 17);
    assert.ok(cells.every((cell) => cell >= 0 && cell < SIZE * SIZE));
  }
});

test('placement rejects off-board and overlapping ships and rotates in place or along an edge', () => {
  assert.equal(canPlace([], { id: 'flagship', r: 0, c: 6, horiz: true }), false);
  assert.equal(canPlace([handFleet[0]], { id: 'patrol', r: 0, c: 4, horiz: true }), false);
  assert.deepEqual(rotateShip([{ id: 'patrol', r: 2, c: 3, horiz: true }], 'patrol'), {
    id: 'patrol', r: 2, c: 3, horiz: false,
  });
  assert.deepEqual(rotateShip([{ id: 'patrol', r: 4, c: 9, horiz: false }], 'patrol'), {
    id: 'patrol', r: 4, c: 8, horiz: true,
  });
  const boxed: Fleet = [
    { id: 'patrol', r: 0, c: 0, horiz: true },
    { id: 'frigate', r: 1, c: 0, horiz: true },
  ];
  assert.equal(rotateShip(boxed, 'patrol'), null);
});

test('shots report misses, hits, sunk ships and the final fleet', () => {
  const fired = new Uint8Array(SIZE * SIZE);
  const miss = resolveShot(handFleet, fired, 99);
  assert.deepEqual(miss, { cell: 99, hit: false, sunk: null, sunkCells: null, all: false });
  const firstHit = resolveShot(handFleet, fired, 0);
  assert.deepEqual(firstHit, { cell: 0, hit: true, sunk: null, sunkCells: null, all: false });

  const allFleetCells = handFleet.flatMap(shipCells);
  let final: ShotResult | null = null;
  for (const cell of allFleetCells.slice(0, -1)) {
    final = resolveShot(handFleet, fired, cell);
    fired[cell] = 1;
  }
  final = resolveShot(handFleet, fired, allFleetCells.at(-1)!);
  assert.equal(final.sunk, 'patrol');
  assert.deepEqual(final.sunkCells, shipCells(handFleet.at(-1)!));
  assert.equal(final.all, true);
  assert.equal(fired[allFleetCells.at(-1)!], 0, 'resolveShot does not mutate incoming shots');
});

test('intel records hits, misses, sunk ships and remaining lengths', () => {
  const intel = newIntel();
  applyResult(intel, { cell: 99, hit: false, sunk: null, sunkCells: null, all: false });
  applyResult(intel, { cell: 0, hit: true, sunk: null, sunkCells: null, all: false });
  applyResult(intel, { cell: 1, hit: true, sunk: 'flagship', sunkCells: [0, 1, 2, 3, 4], all: false });
  assert.equal(intel.cells[99], MISS);
  assert.equal(intel.cells[0], SUNK);
  assert.equal(intel.cells[1], SUNK);
  assert.equal(intel.cells[5], UNKNOWN);
  assert.deepEqual(intel.sunk, ['flagship']);
  assert.deepEqual(intel.sunkShips, [{ id: 'flagship', r: 0, c: 0, horiz: true }]);
  assert.deepEqual(remainingLens(intel), [4, 3, 3, 2]);
});

function play(level: Level, seed: number): { shots: number; maxHardMs: number } {
  const rng = seeded(seed);
  const fleet = randomFleet(rng);
  const intel = newIntel();
  const shots = new Uint8Array(SIZE * SIZE);
  let count = 0;
  let maxHardMs = 0;
  while (count < SIZE * SIZE) {
    const started = performance.now();
    const cell = chooseShot(intel, level, rng);
    if (level === 2) maxHardMs = Math.max(maxHardMs, performance.now() - started);
    assert.equal(intel.cells[cell], UNKNOWN, `level ${level} selected used cell ${cell}`);
    const result = resolveShot(fleet, shots, cell);
    applyResult(intel, result);
    shots[cell] = 1;
    count++;
    if (result.all) return { shots: count, maxHardMs };
  }
  assert.fail(`level ${level} did not finish within 100 shots`);
}

test('all AI levels finish 300 seeded games and keep their strength ordering', () => {
  const averages: number[] = [];
  let maxHardMs = 0;
  for (const level of [0, 1, 2] as const) {
    let total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const result = play(level, seed);
      total += result.shots;
      maxHardMs = Math.max(maxHardMs, result.maxHardMs);
    }
    averages[level] = total / 300;
  }
  console.log(`Battleship AI averages: easy=${averages[0].toFixed(2)}, normal=${averages[1].toFixed(2)}, hard=${averages[2].toFixed(2)}; hard max=${maxHardMs.toFixed(2)}ms`);
  assert.ok(averages[2] <= 54, `hard average ${averages[2].toFixed(2)} exceeds 54`);
  assert.ok(averages[1] <= 70, `normal average ${averages[1].toFixed(2)} exceeds 70`);
  assert.ok(averages[1] >= averages[2] + 4, 'normal should be at least four shots worse than hard');
  assert.ok(averages[0] >= 88, `easy average ${averages[0].toFixed(2)} is below 88`);
  assert.ok(maxHardMs < 20, `hard chooser took ${maxHardMs.toFixed(2)}ms`);
});

test('hard density excludes misses and sunk cells and favors placements through hits', () => {
  const intel = newIntel();
  intel.cells[0] = HIT;
  intel.cells[1] = HIT;
  intel.cells[9] = MISS;
  intel.cells[10] = SUNK;
  const density = densityMap(intel);
  assert.equal(density[9], 0);
  assert.equal(density[10], 0);
  assert.ok(density[2] > density[22]);
});

test('fleet codes round trip and reject incomplete, overlapping or malformed fleets', () => {
  const fleet = randomFleet(seeded(41));
  const code = fleetCode(fleet);
  assert.deepEqual(parseFleet(code), [...fleet].sort((a, b) => FLEET.findIndex((ship) => ship.id === a.id) - FLEET.findIndex((ship) => ship.id === b.id)));
  assert.equal(parseFleet('flagship:0,0,h'), null);
  assert.equal(parseFleet('flagship:0,0,h;frigate:0,0,h;corvette:2,0,h;sub:3,0,h;patrol:4,0,h'), null);
  assert.equal(parseFleet(`${code};bad:1,1,h`), null);
});

test('consistent verifies honest logs and rejects changed answers or fleets', () => {
  const fleet = handFleet;
  const shots = new Uint8Array(SIZE * SIZE);
  const log: ShotResult[] = [];
  for (const cell of [99, 0, 20, 1, 2, 3, 4]) {
    log.push(resolveShot(fleet, shots, cell));
    shots[cell] = 1;
  }
  assert.equal(consistent(fleet, log), true);
  const changed = log.map((result) => ({ ...result }));
  changed[0] = { ...changed[0], hit: true };
  assert.equal(consistent(fleet, changed), false);
  const moved = fleet.map((ship) => ({ ...ship }));
  moved[0] = { ...moved[0], r: 5 };
  assert.equal(consistent(moved, log), false);
});

test('parseMsg accepts valid packets and rejects invalid tags and fields', () => {
  const sunk: ShotResult = { cell: 4, hit: true, sunk: 'patrol', sunkCells: [3, 4], all: false };
  const packets: unknown[] = [
    { game: 'battleship', t: 'ready', commit: 'a'.repeat(64) },
    { game: 'battleship', t: 'begin', first: 1 },
    { game: 'battleship', t: 'shot', n: 2, cell: 99 },
    { game: 'battleship', t: 'answer', n: 2, res: sunk },
    { game: 'battleship', t: 'result', n: 2, shooter: 0, res: sunk, next: 1 },
    { game: 'battleship', t: 'reveal', fleet: fleetCode(handFleet), salt: 'b'.repeat(32) },
  ];
  for (const packet of packets) assert.ok(parseMsg(packet), JSON.stringify(packet));
  for (const packet of [
    { game: 'wrong', t: 'begin', first: 0 },
    { t: 'begin', first: 0 },
    { game: 'battleship', t: 'shot', n: 0.5, cell: 1 },
    { game: 'battleship', t: 'shot', n: 0, cell: 100 },
    { game: 'battleship', t: 'answer', n: 1, res: { ...sunk, sunk: 'unknown' } },
    { game: 'battleship', t: 'ready', commit: 'not-a-hash' },
  ]) assert.equal(parseMsg(packet), null, JSON.stringify(packet));
});

test('frame unit undoes a shrinking device frame and ignores unscaled or projected layouts', () => {
  assert.equal(frameUnit(820, 820), 1);
  assert.equal(frameUnit(0, 820), 1);
  assert.equal(frameUnit(670, 0), 1);
  assert.equal(frameUnit(900, 820), 1);
  assert.equal(frameUnit(50, 820), 1);
  const u = frameUnit(820 * 0.8175, 820);
  assert.ok(Math.abs(u - 1 / 0.8175) < 1e-9);
  // 14px game text then renders at 14px on screen in the framed iPad, not ~11px.
  assert.ok(14 * u * 0.8175 >= 13.99);
});

test('board geometry is unchanged at unit scale', () => {
  assert.deepEqual(boardGeometry(820, 997, true, 64), {
    portrait: true, targetCell: 79, targetX: 0, targetY: 0, ownCell: 79, ownX: 0, ownY: 0,
    placeCell: 79, placeX: 16, placeY: 96, toolsX: 245, toolsY: 907, fireX: 0, fireY: 0,
  });
  assert.deepEqual(boardGeometry(820, 997, false, 64), {
    portrait: true, targetCell: 53, targetX: 140.5, targetY: 67.5, ownCell: 30, ownX: 255.5, ownY: 676.5,
    placeCell: 53, placeX: 0, placeY: 0, toolsX: 0, toolsY: 0, fireX: 350, fireY: 616.5,
  });
  assert.deepEqual(boardGeometry(464, 157, false, 40), {
    portrait: false, targetCell: 10, targetX: 132, targetY: 42, ownCell: 7, ownX: 253, ownY: 57,
    placeCell: 10, placeX: 0, placeY: 0, toolsX: 0, toolsY: 0, fireX: 232.5, fireY: 103,
  });
  assert.deepEqual(boardGeometry(390, 700, true, 88), {
    portrait: true, targetCell: 36, targetX: 0, targetY: 0, ownCell: 36, ownX: 0, ownY: 0,
    placeCell: 36, placeX: 16, placeY: 174.5, toolsX: 30, toolsY: 555.5, fireX: 0, fireY: 0,
  });
});

test('scaled board geometry leaves room for the scaled labels, fire button and tools', () => {
  const u = 1 / 0.8175;
  const w = 820;
  const h = 997;
  const top = Math.round(64 * u);
  const place = boardGeometry(w, h, true, top, u);
  const placeSide = place.placeCell * 10 + 9;
  assert.ok(place.placeX >= 15 * u, 'row labels stay on the stage');
  assert.ok(place.placeX + placeSide <= w, 'board stays on the stage');
  assert.ok(place.toolsY >= place.placeY + placeSide + 12 * u - 1e-9 || place.toolsY === top + (h - top - 8) - 52 * u);
  assert.ok(place.toolsY + 50 * u <= h, 'tools stay on the stage');

  const battle = boardGeometry(w, h, false, top, u);
  const targetSide = battle.targetCell * 10 + 9;
  const ownSide = battle.ownCell * 10 + 9;
  assert.ok(battle.targetX >= 15 * u);
  assert.equal(battle.fireY, battle.targetY + targetSide + 10 * u);
  assert.equal(battle.ownY, battle.fireY + 50 * u + 10 * u);
  assert.ok(battle.ownY + ownSide <= h);
  assert.ok(Math.abs(battle.fireX + 60 * u - w / 2) < 1e-9, 'fire is centered');
});
