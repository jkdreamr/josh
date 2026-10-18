// Unit tests for Roll Block logic and level data. Runs under plain node (type stripping).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bridgeOn,
  cells,
  initialState,
  parseLevel,
  roll,
  solve,
  step,
  swipeDir,
  type Block,
  type Dir,
  type LevelDef,
} from '../src/os/arcade/games/roll-block/logic.ts';
import { LEVELS } from '../src/os/arcade/games/roll-block/levels.ts';
import { recordClear, selectLevel, type Progress } from '../src/os/arcade/games/roll-block/storage.ts';

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const lvl = (def: LevelDef) => parseLevel(def);

test('roll() transitions for all 3 orientations x 4 directions', () => {
  const stand: Block = { x: 5, z: 5, o: 'stand' };
  assert.deepEqual(roll(stand, 'right'), { x: 6, z: 5, o: 'x' });
  assert.deepEqual(roll(stand, 'left'), { x: 3, z: 5, o: 'x' });
  assert.deepEqual(roll(stand, 'down'), { x: 5, z: 6, o: 'z' });
  assert.deepEqual(roll(stand, 'up'), { x: 5, z: 3, o: 'z' });

  const xb: Block = { x: 5, z: 5, o: 'x' };
  assert.deepEqual(roll(xb, 'right'), { x: 7, z: 5, o: 'stand' });
  assert.deepEqual(roll(xb, 'left'), { x: 4, z: 5, o: 'stand' });
  assert.deepEqual(roll(xb, 'down'), { x: 5, z: 6, o: 'x' });
  assert.deepEqual(roll(xb, 'up'), { x: 5, z: 4, o: 'x' });

  const zb: Block = { x: 5, z: 5, o: 'z' };
  assert.deepEqual(roll(zb, 'down'), { x: 5, z: 7, o: 'stand' });
  assert.deepEqual(roll(zb, 'up'), { x: 5, z: 4, o: 'stand' });
  assert.deepEqual(roll(zb, 'right'), { x: 6, z: 5, o: 'z' });
  assert.deepEqual(roll(zb, 'left'), { x: 4, z: 5, o: 'z' });
});

test('rolling then reversing returns to the start block', () => {
  const back: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const starts: Block[] = [
    { x: 5, z: 5, o: 'stand' },
    { x: 5, z: 5, o: 'x' },
    { x: 5, z: 5, o: 'z' },
  ];
  for (const b of starts) {
    for (const d of DIRS) {
      const r = roll(b, d);
      const r2 = roll(r, back[d]);
      // reversing lands on the same cells as the start (anchor may differ for orientations)
      const same = cells(b).every(([x, z]) => cells(r2).some(([x2, z2]) => x2 === x && z2 === z));
      assert.equal(r2.o, b.o, `${b.o} ${d} then ${back[d]} orientation`);
      assert.ok(same, `${b.o} ${d} then ${back[d]} cells`);
    }
  }
});

const simple = (rows: string[], switches?: LevelDef['switches']) => lvl({ id: 't', name: 't', par: 0, rows, switches });

test('step: half off the edge falls', () => {
  const l = simple(['###', '#S#', '#G#']);
  const s = initialState(l);
  const r = step(l, s, 'up'); // z-block covers z=-1,0 -> out of bounds
  assert.equal(r.outcome.kind, 'fall');
  assert.equal(r.state.moves, 1);
});

test('step: standing on F falls fragile, lying over F is ok', () => {
  const l = simple(['......', '.SF#FG', '......']);
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // lie over x2,3 (2 is F)
  assert.equal(r1.outcome.kind, 'ok');
  const r2 = step(l, r1.state, 'right'); // stand on F at x4
  assert.deepEqual(r2.outcome, { kind: 'fall', fragile: true });
});

test('step: lying across G is ok, standing on G wins', () => {
  const l = simple(['.....', '.S#G#', '.....']);
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // x covers 2,3 : G at 3
  assert.equal(r1.outcome.kind, 'ok');
  const l4 = simple(['#####', '#S##G', '#####']);
  const path = solve(l4)!;
  let st = initialState(l4);
  let last;
  for (const d of path) {
    const r = step(l4, st, d);
    st = r.state;
    last = r;
  }
  assert.equal(last!.outcome.kind, 'win');
});

test('step: switches trigger correctly', () => {
  // soft switch at 2 (lying triggers), bridge a at 4
  const l = simple(['.......', '.S1#aG#', '.......'], { '1': { kind: 'soft', act: 'on', bridges: 'a' } });
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // x covers 2,3 -> presses soft 1, a on
  assert.equal(r1.outcome.kind, 'ok');
  assert.deepEqual(r1.pressed, [[2, 1]]);
  assert.deepEqual(r1.changed, ['a']);
  assert.ok(bridgeOn(l, r1.state.mask, 'a'));
  const r2 = step(l, r1.state, 'right'); // stand on 4 = bridge on
  assert.equal(r2.outcome.kind, 'ok');
  const r3 = step(l, r2.state, 'right'); // x covers 5,6 -> G at 5 lying, not a win
  assert.equal(r3.outcome.kind, 'ok');
});

test('step: bridge off under block falls, on supports', () => {
  const l = simple(['.......', '.S#aaG#', '.......']);
  const s = initialState(l);
  const r = step(l, s, 'right'); // x covers 2,3: a at 3 is off
  assert.equal(r.outcome.kind, 'fall');
});

test('step: hard switch only fires standing', () => {
  // '1' hard at 2, a at 3: lying over the switch does not press it, so the a cell falls
  const l = simple(['......', '.S1aG#', '......'], { '1': { kind: 'hard', act: 'on', bridges: 'a' } });
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // x covers 2,3 : lies on hard switch, no press; a at3 off -> fall
  assert.equal(r1.outcome.kind, 'fall');
  assert.equal(r1.pressed.length, 0);
});

test('step: toggle restores mask when re-pressed', () => {
  const l = simple(['.......', '.S1#a#G', '.......'], { '1': { kind: 'soft', act: 'toggle', bridges: 'a' } });
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // lie over 2,3: press toggle -> a on
  assert.ok(bridgeOn(l, r1.state.mask, 'a'));
  assert.deepEqual(r1.changed, ['a']);
  const r2 = step(l, r1.state, 'left'); // back to stand at 1
  const r3 = step(l, r2.state, 'right'); // lie over 2,3 again -> toggle off
  assert.ok(!bridgeOn(l, r3.state.mask, 'a'));
  assert.deepEqual(r3.changed, ['a']);
});

test("step: 'on' act is idempotent", () => {
  const l = simple(['.......', '.S1#a#G', '.......'], {
    '1': { kind: 'soft', act: 'on', bridges: 'a' },
  });
  const s = initialState(l);
  const r1 = step(l, s, 'right'); // x covers 2,3 press '1' -> a on
  assert.deepEqual(r1.changed, ['a']);
  const r2 = step(l, r1.state, 'left'); // stand back at 1
  const r3 = step(l, r2.state, 'right'); // lie over 2,3 press '1' again: already on, no change
  assert.deepEqual(r3.changed, []);
  assert.equal(r3.pressed.length, 1);
});

test("step: 'off' act turns a bridge off", () => {
  const l = simple(['.......', '.S1#A#G', '.......'], {
    '1': { kind: 'soft', act: 'off', bridges: 'a' },
  });
  const s = initialState(l);
  assert.ok(bridgeOn(l, s.mask, 'a'));
  const r1 = step(l, s, 'right'); // x covers 2,3 press '1' -> a off
  assert.deepEqual(r1.changed, ['a']);
  assert.ok(!bridgeOn(l, r1.state.mask, 'a'));
  const r2 = step(l, r1.state, 'left');
  const r3 = step(l, r2.state, 'right'); // press again: already off, no change
  assert.deepEqual(r3.changed, []);
});

test('step: switches do not rescue the move that lands on them', () => {
  // soft 'on' switch at 2 for bridge a at 3: lying covers both; the a cell is checked before the press
  const l = simple(['......', '.S1aG#', '......'], { '1': { kind: 'soft', act: 'on', bridges: 'a' } });
  const r = step(l, initialState(l), 'right');
  assert.equal(r.outcome.kind, 'fall');
});

test('parseLevel throws on bad levels', () => {
  assert.throws(() => simple(['###', '#G#', '###']), /no start S/);
  assert.throws(() => simple(['#####', '#SGG#', '#####']), /more than one G/);
  assert.throws(() => simple(['#####', '#S1G#', '#####']), /not defined/);
  assert.throws(() => simple(['#####', '#SAaG', '#####']), /mixes cases|no cells|upper/);
});

test('swipeDir maps to the best grid axis, null under threshold', () => {
  // camera tilted: +x projects right-down, +z projects left-down
  const axes = { x: [40, 15] as [number, number], z: [-38, 18] as [number, number] };
  assert.equal(swipeDir(50, 18, axes), 'right');
  assert.equal(swipeDir(-50, -18, axes), 'left');
  assert.equal(swipeDir(-44, 21, axes), 'down');
  assert.equal(swipeDir(42, -20, axes), 'up');
  assert.equal(swipeDir(10, 5, axes), null);
  assert.equal(swipeDir(10, 5, axes, 5), 'right');
});

// ---------- level data ----------

test('levels: count, unique ids and names, boards within 15x10', () => {
  assert.ok(LEVELS.length >= 18, `expected >= 18 levels, got ${LEVELS.length}`);
  const ids = new Set(LEVELS.map((l) => l.id));
  const names = new Set(LEVELS.map((l) => l.name));
  assert.equal(ids.size, LEVELS.length, 'duplicate level ids');
  assert.equal(names.size, LEVELS.length, 'duplicate level names');
  for (const def of LEVELS) {
    const l = lvl(def);
    assert.ok(l.w <= 15 && l.h <= 10, `${def.id} is ${l.w}x${l.h}`);
  }
});

test('levels: every level parses, solves in exactly par moves, replay wins', () => {
  for (const def of LEVELS) {
    const l = lvl(def);
    const path = solve(l);
    assert.ok(path, `${def.id} is unsolvable`);
    assert.equal(path.length, def.par, `${def.id} par ${def.par} != optimal ${path.length}`);
    let s = initialState(l);
    let outcome;
    for (let i = 0; i < path.length - 1; i++) {
      const r = step(l, s, path[i]);
      s = r.state;
      outcome = r.outcome;
      assert.equal(outcome.kind, 'ok', `${def.id} move ${i} (${path[i]}) outcome ${outcome.kind}`);
    }
    const last = step(l, s, path[path.length - 1]);
    assert.equal(last.outcome.kind, 'win', `${def.id} last move should win`);
  }
});

test('levels: mechanic coverage', () => {
  const withF = LEVELS.filter((d) => d.rows.join('').includes('F'));
  const soft = LEVELS.filter((d) => Object.values(d.switches ?? {}).some((s) => s.kind === 'soft'));
  const hard = LEVELS.filter((d) => Object.values(d.switches ?? {}).some((s) => s.kind === 'hard'));
  assert.ok(withF.length >= 3, `fragile levels: ${withF.length}`);
  assert.ok(soft.length >= 4, `soft switch levels: ${soft.length}`);
  assert.ok(hard.length >= 3, `hard switch levels: ${hard.length}`);
  assert.ok(LEVELS.filter((d) => d.par >= 15).length >= 5, 'need >= 5 levels with par >= 15');
});

test('levels: fragile tiles are load-bearing', () => {
  for (const def of LEVELS) {
    if (!def.rows.join('').includes('F')) continue;
    const d2 = { ...def, rows: def.rows.map((r) => r.replace(/F/g, '.')) };
    assert.equal(solve(parseLevel(d2)), null, `${def.id} solvable without its fragile tiles`);
  }
});

test('levels: optimal solution triggers every kind of switch present', () => {
  for (const def of LEVELS) {
    const kindsNeeded = new Set(Object.values(def.switches ?? {}).map((s) => s.kind));
    if (!kindsNeeded.size) continue;
    const l = lvl(def);
    const path = solve(l)!;
    let s = initialState(l);
    const kindsHit = new Set<string>();
    const pressed = new Set<string>();
    for (const d of path) {
      const r = step(l, s, d);
      s = r.state;
      for (const [x, z] of r.pressed) {
        kindsHit.add(l.switchAt[z * l.w + x]!.kind);
        pressed.add(`${x},${z}`);
      }
    }
    for (const k of kindsNeeded) assert.ok(kindsHit.has(k), `${def.id}: optimal path never triggers a ${k} switch`);
    for (let i = 0; i < l.switchAt.length; i++) {
      if (l.switchAt[i]) assert.ok(pressed.has(`${i % l.w},${Math.floor(i / l.w)}`), `${def.id}: switch at ${i} unused in optimal path`);
    }
  }
});

// ---------- level design quality ----------

const walkSet = (def: LevelDef) => {
  const l = lvl(def);
  const s = new Set<string>();
  for (let z = 0; z < l.h; z++)
    for (let x = 0; x < l.w; x++) if (l.tiles[z * l.w + x] !== 'void') s.add(`${x},${z}`);
  return s;
};

// Non-fall, non-win states reachable from the start (BFS over block positions only).
const reachableStates = (def: LevelDef) => {
  const l = lvl(def);
  const start = initialState(l);
  const key = (b: Block, m: number) => `${b.x},${b.z},${b.o},${m}`;
  const seen = new Set([key(start.block, start.mask)]);
  const queue = [start];
  while (queue.length) {
    const s = queue.shift()!;
    for (const d of DIRS) {
      const r = step(l, s, d);
      if (r.outcome.kind !== 'ok') continue;
      const k = key(r.state.block, r.state.mask);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r.state);
      }
    }
  }
  return seen.size;
};

// Longest straight run of walkable cells along one row/column with void on BOTH perpendicular sides.
const longestCorridor = (def: LevelDef) => {
  const l = lvl(def);
  const walk = (x: number, z: number) => x >= 0 && z >= 0 && x < l.w && z < l.h && l.tiles[z * l.w + x] !== 'void';
  const corridor = (x: number, z: number, dx: number, dz: number) =>
    walk(x, z) && !walk(x + dz, z + dx) && !walk(x - dz, z - dx);
  let best = 0;
  for (let z = 0; z < l.h; z++)
    for (let x = 0; x < l.w; x++) {
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        let run = 0;
        let cx = x;
        let cz = z;
        while (corridor(cx, cz, dx, dz)) {
          run++;
          cx += dx;
          cz += dz;
        }
        best = Math.max(best, run);
      }
    }
  return best;
};

// How many times each switch cell is triggered when replaying the optimal solution.
const optimalPressCounts = (def: LevelDef) => {
  const l = lvl(def);
  const counts = new Map<string, number>();
  let s = initialState(l);
  for (const d of solve(l)!) {
    const r = step(l, s, d);
    s = r.state;
    for (const [x, z] of r.pressed) {
      const k = `${x},${z}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
};

test('levels: depth and open rows (no one-row mazes)', () => {
  for (const def of LEVELS) {
    if (def.id === 'l01' || def.id === 'l02') continue;
    const l = lvl(def);
    assert.ok(l.h >= 4, `${def.id}: only ${l.h} rows deep`);
    const openRows = def.rows.filter((r) => (r.match(/[^.]/g) ?? []).length >= 3).length;
    assert.ok(openRows >= 3, `${def.id}: only ${openRows} rows with >= 3 walkable tiles`);
    const corr = longestCorridor(def);
    assert.ok(corr <= 5, `${def.id}: one-tile corridor of ${corr} tiles`);
  }
});

test('levels: shapes are pairwise distinct (jaccard < 0.6)', () => {
  const sets = LEVELS.map(walkSet);
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      let inter = 0;
      for (const c of sets[i]) if (sets[j].has(c)) inter++;
      const union = sets[i].size + sets[j].size - inter;
      const jac = inter / union;
      assert.ok(jac < 0.6, `${LEVELS[i].id} ~ ${LEVELS[j].id}: jaccard ${jac.toFixed(2)}`);
    }
  }
});

test('levels: par curve', () => {
  const pars = LEVELS.map((d) => d.par);
  assert.ok(pars[0] >= 6 && pars[0] <= 12, `level 1 par ${pars[0]}`);
  LEVELS.forEach((d, i) => {
    if (i >= 6) assert.ok(d.par >= 10, `${d.id}: par ${d.par} < 10`);
  });
  assert.ok(pars.filter((p) => p >= 30).length >= 3, 'need >= 3 levels with par >= 30');
  const last5 = pars.slice(-5);
  const avg = last5.reduce((a, b) => a + b, 0) / last5.length;
  assert.ok(avg >= 24, `average par of last 5 is ${avg}`);
});

test('levels: reachable non-fall state count >= 30 from l04 on', () => {
  for (const def of LEVELS) {
    const idx = LEVELS.indexOf(def);
    if (idx < 3) continue;
    const r = reachableStates(def);
    assert.ok(r >= 30, `${def.id}: only ${r} reachable states`);
  }
});

test('levels: some optimal solution presses the same switch twice, some level uses off', () => {
  const revisit = LEVELS.some((def) => {
    const counts = optimalPressCounts(def);
    return [...counts.values()].some((n) => n >= 2);
  });
  assert.ok(revisit, 'no level presses the same switch cell twice in its optimal path');
  const hasOff = LEVELS.some((def) => Object.values(def.switches ?? {}).some((s) => s.act === 'off'));
  assert.ok(hasOff, "no level uses act 'off'");
});

test('recordClear: beating the last level with others unplayed is a normal clear, not the end', () => {
  const ids = LEVELS.map((d) => d.id);
  const last = ids.length - 1;
  const p: Progress = { current: 0, best: { [ids[0]]: 9, [ids[1]]: 9, [ids[3]]: 9, [ids[6]]: 9, [ids[10]]: 9 } };
  const c = recordClear(p, ids, last, 31);
  assert.equal(c.allCleared, false);
  assert.equal(c.next, 2, 'next goes to the first unplayed level');
  assert.equal(c.progress.current, 2);
  assert.equal(c.progress.best[ids[last]], 31);
  assert.equal(c.prev, undefined);
});

test('recordClear: all cleared only once every level has a best', () => {
  const ids = LEVELS.map((d) => d.id);
  const all = Object.fromEntries(ids.map((id) => [id, 50]));
  const missing5 = { ...all };
  delete missing5[ids[4]];
  const c = recordClear({ current: 4, best: missing5 }, ids, 4, 20);
  assert.equal(c.allCleared, true, 'finishing the final unplayed level ends the campaign');
  assert.equal(c.progress.current, 0);
  const replayMid = recordClear({ current: 4, best: all }, ids, 4, 60);
  assert.equal(replayMid.allCleared, false, 'replaying a middle level after finishing is a normal clear');
  assert.equal(replayMid.best, 50);
  assert.equal(replayMid.next, 5);
  const replayLast = recordClear({ current: ids.length - 1, best: all }, ids, ids.length - 1, 40);
  assert.equal(replayLast.allCleared, true);
  assert.equal(replayLast.best, 40);
  const mid = recordClear({ current: 2, best: {} }, ids, 2, 7);
  assert.equal(mid.allCleared, false);
  assert.equal(mid.next, 3);
  assert.equal(mid.progress.current, 3);
});

test('selectLevel: a picked level is the one a restart reopens', () => {
  const p: Progress = { current: 2, best: { a: 3 } };
  const s = selectLevel(p, 0);
  assert.equal(s.current, 0);
  assert.deepEqual(s.best, p.best);
  assert.equal(p.current, 2, 'input not mutated');
});
