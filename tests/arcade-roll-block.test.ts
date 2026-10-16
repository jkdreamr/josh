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
