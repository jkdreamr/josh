import assert from 'node:assert/strict';
import test from 'node:test';
import { boatMetrics, callPower10, catchStroke, createRace, startSignal, step } from '../src/os/games/rowing.ts';

function makeHuman(distance: 500 | 1000 | 2000 = 500) {
  return createRace({ distance, boats: [{ kind: 'human' }] });
}

function runPiece(rate: number, distance: 500 | 1000 | 2000, dt = 1 / 240) {
  const race = makeHuman(distance);
  startSignal(race);
  const interval = 60 / rate;
  let nextCatch = 0;
  const cycleSplits: number[] = [];
  while (!race.finished && race.elapsed < 1200) {
    if (race.elapsed + 1e-9 >= nextCatch && catchStroke(race, 0) === 'caught') {
      const metrics = boatMetrics(race, 0);
      if (metrics.split !== null && metrics.strokes >= 20 && metrics.strokes <= 40) cycleSplits.push(metrics.split);
      nextCatch += interval;
    }
    step(race, dt);
  }
  return { race, splits: cycleSplits, metrics: boatMetrics(race, 0) };
}

test('rate is the time between catches', () => {
  const race = makeHuman();
  startSignal(race);
  assert.equal(catchStroke(race, 0), 'caught');
  step(race, 2);
  assert.equal(catchStroke(race, 0), 'caught');
  assert.ok(Math.abs(boatMetrics(race, 0).rate! - 30) < 1e-9);
});

test('split uses the completed catch-to-catch cycle', () => {
  const race = makeHuman();
  startSignal(race);
  catchStroke(race, 0);
  step(race, 1);
  race.elapsed = 5;
  race.boats[0].distance = 25;
  assert.equal(catchStroke(race, 0), 'caught');
  assert.equal(boatMetrics(race, 0).dps, 25);
  assert.equal(boatMetrics(race, 0).split, 100);
});

test('human pace calibration at 20, 34 and 40 spm', () => {
  const steady20 = runPiece(20, 1000);
  const steady34 = runPiece(34, 1000);
  const steady40 = runPiece(40, 500);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const split20 = average(steady20.splits);
  const split34 = average(steady34.splits);
  const split40 = steady40.metrics.avgSplit!;
  console.log(`calibration splits: 20spm=${split20.toFixed(2)}s 34spm=${average(steady34.splits).toFixed(2)}s 40spm=${split40.toFixed(2)}s`);
  assert.ok(split20 >= 104 && split20 <= 112, `20 spm: ${split20}`);
  assert.ok(average(steady34.splits) >= 88 && average(steady34.splits) <= 91, `34 spm: ${average(steady34.splits)}`);
  assert.ok(split40 >= 83 && split40 <= 88, `40 spm: ${split40}`);
});

test('legs recover during a rest after rowing at 44 spm', () => {
  const race = makeHuman(2000);
  startSignal(race);
  const interval = 60 / 44;
  let nextCatch = 0;
  while (boatMetrics(race, 0).strokes < 30) {
    if (race.elapsed + 1e-9 >= nextCatch && catchStroke(race, 0) === 'caught') nextCatch += interval;
    step(race, 1 / 240);
  }
  const legsAfterPiece = boatMetrics(race, 0).legs;
  step(race, 60);
  assert.ok(boatMetrics(race, 0).legs > legsAfterPiece);
});

test('high-rate fatigue and rushing make the crew slower', () => {
  const at30 = runPiece(30, 2000).metrics.elapsed;
  const at36 = runPiece(36, 2000).metrics.elapsed;
  const at38 = runPiece(38, 2000).metrics.elapsed;
  const at40 = runPiece(40, 2000).metrics.elapsed;
  const at44 = runPiece(44, 2000).metrics.elapsed;
  const at40_500 = runPiece(40, 500).metrics.finishTime!;
  const at70_500 = runPiece(70, 500).metrics.finishTime!;
  console.log(`comparison times: 2k@30=${at30.toFixed(2)}s 2k@36=${at36.toFixed(2)}s 2k@38=${at38.toFixed(2)}s 2k@40=${at40.toFixed(2)}s 2k@44=${at44.toFixed(2)}s 500@40=${at40_500.toFixed(2)}s 500@70=${at70_500.toFixed(2)}s`);
  assert.ok(at44 > at38, `44 spm ${at44} should be slower than 38 spm ${at38}`);
  assert.ok(at38 < at30, `38 spm ${at38} should be faster than 30 spm ${at30}`);
  assert.ok(at70_500 > at40_500, `70 spm ${at70_500} should be slower than 40 spm ${at40_500}`);
});

test('the same catch schedule is independent of caller frame rate', () => {
  function finishAt(dt: number) {
    const race = makeHuman();
    startSignal(race);
    let nextCatch = 0;
    while (!race.finished && race.elapsed < 600) {
      if (race.elapsed + 1e-9 >= nextCatch && catchStroke(race, 0) === 'caught') nextCatch += 2;
      step(race, dt);
    }
    return boatMetrics(race, 0).finishTime;
  }
  assert.ok(Math.abs(finishAt(1 / 30)! - finishAt(1 / 144)!) < 0.001);
});

test('finish time is interpolated inside the crossing step', () => {
  const race = makeHuman();
  startSignal(race);
  const boat = race.boats[0];
  boat.distance = 499.99;
  boat.speed = 5;
  const previousDistance = boat.distance;
  const previousSpeed = boat.speed;
  const h = 1 / 240;
  const nextSpeed = previousSpeed - (12 * previousSpeed * previousSpeed / 870) * h;
  const nextDistance = previousDistance + nextSpeed * h;
  step(race, h);
  const expected = ((500 - previousDistance) / (nextDistance - previousDistance)) * h;
  assert.ok(Math.abs(boatMetrics(race, 0).finishTime! - expected) < 1e-9);
});

test('catches before Row! are false starts', () => {
  const race = makeHuman();
  assert.equal(catchStroke(race, 0), 'false-start');
  assert.equal(boatMetrics(race, 0).strokes, 0);
});

test('power ten is limited per distance and applies ten catches', () => {
  const race = makeHuman(500);
  startSignal(race);
  assert.equal(callPower10(race, 0), true);
  assert.equal(callPower10(race, 0), false);
  assert.equal(boatMetrics(race, 0).power10, 1);
  assert.equal(boatMetrics(race, 0).power10Max, 2);
  assert.equal(boatMetrics(race, 0).power10Left, 10);
  for (let i = 0; i < 10; i += 1) {
    if (i) step(race, 2);
    catchStroke(race, 0);
  }
  assert.equal(boatMetrics(race, 0).power10Left, 0);
  assert.equal(callPower10(race, 0), true);
  step(race, 2);
  catchStroke(race, 0);
  assert.equal(boatMetrics(race, 0).power10Left, 9);
  const twoK = makeHuman(2000);
  startSignal(twoK);
  assert.equal(callPower10(twoK, 0), true);
  assert.equal(callPower10(twoK, 0), false);
  for (let call = 0; call < 2; call += 1) {
    for (let stroke = 0; stroke < 10; stroke += 1) {
      if (stroke || call) step(twoK, 2);
      catchStroke(twoK, 0);
    }
  }
  assert.equal(callPower10(twoK, 0), true);
});

test('bots finish within 0.2 seconds of their target split at every distance', () => {
  for (const distance of [500, 1000, 2000] as const) {
    for (const [profile, split] of [['jv', 93], ['cal', 86], ['world', 79.67]] as const) {
      const race = createRace({ distance, boats: [{ kind: 'bot', profile }] });
      startSignal(race);
      while (!race.finished && race.elapsed < 1200) step(race, 1 / 240);
      const actual = boatMetrics(race, 0).finishTime!;
      assert.ok(Math.abs(actual - split * distance / 500) <= 0.2, `${profile} ${distance}m: ${actual}`);
    }
  }
});
