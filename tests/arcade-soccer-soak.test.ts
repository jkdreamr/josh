import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failures, metrics, PAIRS, runRow, emptyRow } from './soccer-replay/soak.ts';
import { seedList } from '../scripts/soccer-soak.ts';

for (const [home, away] of PAIRS) {
  const todo =
    home === 'easy' && away === 'easy'
      ? 'main seed 47: players 9/10 overlap >0.5 s at frame 3420'
      : home === 'normal' && away === 'normal'
        ? 'seed 47: ST/RW (9/10, 20/21) placed <0.45 m apart through goal-kick restarts at frames ~12623/13321 (restart placement, same as easy/easy)'
      : home === 'hard' && away === 'easy'
        ? 'main seed 47: players 20/21 overlap at frame 2334; uncontrolled ball stuck >3 s at frame 3613'
        : undefined;
  test('fast full-match soak: ' + home + '/' + away, { todo }, () => {
    const row = runRow(home, away, [47], 240);
    assert.deepEqual(failures(row, false), []);
    assert.ok(row.shots > 0);
    const measured = metrics(row);
    const { shotsPerGoal, save, ...alwaysDefined } = measured;
    assert.ok(Object.values(alwaysDefined).every(Number.isFinite));
    assert.ok(row.goals ? Number.isFinite(shotsPerGoal) : Number.isNaN(shotsPerGoal));
    assert.ok(row.onTarget ? Number.isFinite(save) : Number.isNaN(save));
  });
}

test('soak rejects empty and invalid seed/duration inputs', () => {
  assert.throws(() => runRow('normal', 'normal', []));
  assert.throws(() => runRow('normal', 'normal', [NaN]));
  assert.throws(() => runRow('normal', 'normal', [1], 0));
  assert.ok(failures(emptyRow('normal', 'normal')).includes('no matches'));
  assert.deepEqual(
    seedList([], {}),
    Array.from({ length: 50 }, (_, i) => (i + 1) * 113),
  );
  assert.deepEqual(seedList(['--seeds', '2', '--start', '3'], {}), [339, 452]);
  assert.deepEqual(seedList([], { SOCCER_SOAK_SEEDS: '1', SOCCER_SOAK_START: '2' }), [226]);
  for (const args of [['--seeds', '0'], ['--seeds'], ['--start', 'NaN'], ['--bad']])
    assert.throws(() => seedList(args, {}));
});

test('balance validator reports all normal and ladder failures without hiding invariants', () => {
  const row = emptyRow('normal', 'normal');
  Object.assign(row, {
    matches: 10,
    goals: 60,
    maxGoals: 9,
    shots: 60,
    onTarget: 60,
    passes: [10, 10],
    completed: [1, 1],
    possession: [99, 1],
    fouls: 50,
    offsides: 60,
    reds: 1,
    wins: 10,
    stuck: 1,
    invariantErrors: 1,
    unfinished: 1,
  });
  const errors = failures(row);
  for (const label of [
    'goals',
    'max match goals',
    'shotsPerGoal',
    'completion',
    'homeCompletion',
    'awayCompletion',
    'possession',
    'fouls',
    'offsides',
    'red cards',
    'home W/L',
    'stuck-ball',
    'invariant',
    'unfinished',
  ])
    assert.ok(
      errors.some((error) => error.includes(label)),
      label,
    );
  const ladder = emptyRow('hard', 'easy');
  Object.assign(ladder, { matches: 10, wins: 3, losses: 5 });
  assert.equal(failures(ladder).length, 3);
});
