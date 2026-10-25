import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikeCircleSchedule } from '../src/os/arcade/games/dead-week/micro/bike-circle.ts';
import { burritoSchedule } from '../src/os/arcade/games/dead-week/micro/burrito.ts';
import { cardSwipeSchedule } from '../src/os/arcade/games/dead-week/micro/card-swipe.ts';
import { coffeePlan } from '../src/os/arcade/games/dead-week/micro/coffee.ts';
import { FOUNTAIN_TELEGRAPH, fountainSchedule } from '../src/os/arcade/games/dead-week/micro/fountain.ts';
import { margueriteSchedule } from '../src/os/arcade/games/dead-week/micro/marguerite.ts';
import { MICRO } from '../src/os/arcade/games/dead-week/micro/index.ts';
import { hooverLayout } from '../src/os/arcade/games/dead-week/micro/hoover.ts';
import { signPath } from '../src/os/arcade/games/dead-week/micro/sign-here.ts';
import { SQUIRREL_SPOTS, squirrelSchedule } from '../src/os/arcade/games/dead-week/micro/squirrel.ts';
import { treeLayout } from '../src/os/arcade/games/dead-week/micro/tree.ts';
import { MAX_TIER } from '../src/os/arcade/games/dead-week/plan.ts';
import type { Held, MicroGame, Outcome } from '../src/os/arcade/games/dead-week/micro/types.ts';

const emptyHeld: Held = { left: false, right: false, up: false, down: false, action: false };
const MAX_PACE = 1.75;

function scriptedOutcome(game: MicroGame, seed: number, difficulty: number): Outcome {
  const instance = game.create(seed, difficulty);
  const duration = game.duration(0);
  const held: Held = { left: false, right: false, up: false, down: false, action: false };
  for (let frame = 0; frame <= duration * 60; frame++) {
    const t = frame / 60;
    instance.update(1 / 60, t, held);
    if (frame === 8) instance.down?.(24, 68);
    if (frame === 14) instance.move?.(38, 61);
    if (frame === 20) instance.press?.('action');
    if (frame === 23) instance.up?.(38, 61);
    if (frame === 31) instance.release?.('action');
  }
  return instance.outcome;
}

function idleOutcome(game: MicroGame, seed: number, difficulty: number): Outcome {
  const instance = game.create(seed, difficulty);
  const duration = game.duration(4);
  for (let frame = 0; frame <= duration * 60; frame++) instance.update(1 / 60, frame / 60, emptyHeld);
  return instance.outcome === 'pending' ? instance.timeUp() : instance.outcome;
}

function pacedSolverOutcome(game: MicroGame, seed: number, difficulty: number, pace: number): Outcome {
  const instance = game.create(seed, difficulty);
  const frameCount = Math.ceil(game.duration(MAX_TIER) * 60);
  const gameDt = pace / 60;
  const bike = game.id === 'bike-circle' ? bikeCircleSchedule(seed, difficulty) : [];
  const burritos = game.id === 'burrito'
    ? burritoSchedule(seed, difficulty).map((drop) => ({ ...drop, impact: drop.at + 90 / drop.v }))
    : [];
  const squirrels = game.id === 'squirrel' ? squirrelSchedule(seed, difficulty) : [];
  const tree = game.id === 'tree' ? treeLayout(seed, difficulty).find((figure) => figure.isTree)! : null;
  const jets = game.id === 'fountain' ? fountainSchedule(seed, difficulty) : [];
  const signature = game.id === 'sign-here' ? signPath(seed, difficulty).checkpoints : [];
  const bell = game.id === 'hoover' ? hooverLayout(seed, difficulty) : null;
  const bus = game.id === 'marguerite' ? margueriteSchedule(seed, difficulty) : null;
  const coffee = game.id === 'coffee' ? coffeePlan(seed, difficulty) : null;
  const swipe = game.id === 'card-swipe' ? cardSwipeSchedule(seed, difficulty) : null;
  let bikeX = 50;
  let burritoTarget = 50;
  let burritoIndex = 0;
  let squirrelIndex = 0;
  let jetIndex = 0;
  let signatureIndex = 0;
  let busTapped = false;
  let coffeeStarted = false;
  let coffeeReleased = false;
  let bestSwipeFrame = -1;
  let bestSwipeDistance = Infinity;
  if (swipe) {
    const target = (swipe.lo + swipe.hi) / 2;
    for (let frame = 0; frame <= frameCount; frame++) {
      const expected = swipe.meterTime(swipe.meter((frame / 60) * pace));
      const distance = Math.abs(expected - target);
      if (distance < bestSwipeDistance) {
        bestSwipeFrame = frame;
        bestSwipeDistance = distance;
      }
    }
  }

  for (let frame = 0; frame <= frameCount; frame++) {
    const t = (frame / 60) * pace;
    if (instance.outcome !== 'pending') continue;

    if (game.id === 'bike-circle') {
      const threats = bike.flatMap((rider) => {
        const enter = rider.at + 85 / rider.speed;
        const exit = rider.at + 96 / rider.speed;
        const futureSteps = Math.max(0, Math.ceil((enter - t - 1e-9) / gameDt));
        const eventT = t + futureSteps * gameDt;
        if (eventT > exit || eventT > t + 0.7) return [];
        const y = -8 + Math.max(0, eventT - rider.at) * rider.speed;
        return [{ x: rider.x + rider.lean * Math.max(0, y - 77), steps: futureSteps + 1 }];
      });
      let target = 50;
      if (threats.length) {
        let bestScore = -Infinity;
        for (let candidate = 8; candidate <= 92; candidate++) {
          const alpha = Math.min(1, gameDt * 15);
          const margin = Math.min(...threats.map((threat) => {
            const predicted = bikeX + (candidate - bikeX) * (1 - (1 - alpha) ** threat.steps);
            return Math.abs(predicted - threat.x) - 9;
          }));
          const score = margin - Math.abs(candidate - bikeX) * 0.015;
          if (score > bestScore) {
            bestScore = score;
            target = candidate;
          }
        }
      }
      instance.move?.(target, 50);
      instance.update(gameDt, t, emptyHeld);
      bikeX += (target - bikeX) * Math.min(1, gameDt * 15);
      continue;
    }

    if (game.id === 'burrito') {
      while (burritoIndex < burritos.length && t > burritos[burritoIndex].impact + 0.14) burritoIndex++;
      const next = burritos[burritoIndex];
      if (next && next.impact - t < 0.95) burritoTarget = next.x;
      instance.move?.(burritoTarget, 86);
    }
    if (game.id === 'coffee' && !coffeeStarted) {
      instance.down?.(54, 60);
      coffeeStarted = true;
    }

    instance.update(gameDt, t, emptyHeld);
    if (instance.outcome !== 'pending') continue;

    switch (game.id) {
      case 'burrito':
      case 'snooze':
        break;
      case 'squirrel':
        if (squirrelIndex < squirrels.length && t >= squirrels[squirrelIndex].at + 0.1) {
          const spot = SQUIRREL_SPOTS[squirrels[squirrelIndex].spot];
          instance.down?.(spot.x, spot.y - 3);
          squirrelIndex++;
        }
        break;
      case 'tree':
        if (frame === 0 && tree) instance.down?.(tree.x, tree.y);
        break;
      case 'fountain':
        if (jetIndex < jets.length && t >= jets[jetIndex].at - FOUNTAIN_TELEGRAPH + 0.2) {
          instance.press?.('action');
          jetIndex++;
        }
        break;
      case 'sign-here':
        if (signatureIndex < signature.length) {
          const point = signature[signatureIndex];
          if (signatureIndex === 0) instance.down?.(point.x, point.y);
          else instance.move?.(point.x, point.y);
          signatureIndex++;
        }
        break;
      case 'hoover':
        if (bell && Math.abs(bell.markerAt(t) - bell.zoneCenter) <= bell.zoneWidth / 2) instance.press?.('action');
        break;
      case 'marguerite':
        if (bus && !busTapped && t >= bus.open + bus.window / 2) {
          instance.press?.('action');
          busTapped = true;
        }
        break;
      case 'coffee':
        if (coffee && !coffeeReleased && t >= coffee.mid / coffee.rate - gameDt) {
          instance.up?.(54, 60);
          coffeeReleased = true;
        }
        break;
      case 'card-swipe':
        if (frame === bestSwipeFrame) instance.press?.('action');
        break;
      case 'axe':
        instance.press?.('action');
        break;
    }
  }

  return instance.outcome === 'pending' ? instance.timeUp() : instance.outcome;
}

function renderContext(): CanvasRenderingContext2D {
  return new Proxy({}, {
    get: () => () => {},
    set: () => true,
  }) as CanvasRenderingContext2D;
}

test('all registry games have unique ids, lowercase commands, and bounded durations', () => {
  assert.equal(new Set(MICRO.map((game) => game.id)).size, MICRO.length);
  for (const game of MICRO) {
    assert.match(game.command, /!$/);
    assert.equal(game.command, game.command.toLowerCase());
    assert.ok(game.duration(0) >= game.duration(8), `${game.id} should get shorter at higher tiers`);
    assert.ok(game.duration(8) >= 2.5, `${game.id} should last at least 2.5 seconds`);
  }
});

test('registry games are deterministic for identical input scripts', () => {
  for (const game of MICRO) {
    assert.equal(scriptedOutcome(game, 9127, 0.58), scriptedOutcome(game, 9127, 0.58), game.id);
  }
});

test('idle outcomes follow each micro-game contract', () => {
  for (const game of MICRO) {
    const first = idleOutcome(game, 773, 0.5);
    const second = idleOutcome(game, 773, 0.5);
    assert.equal(first, second, `${game.id} idle result should be deterministic`);
    if (game.id === 'bike-circle' || game.id === 'fountain') continue;
    assert.equal(first, game.id === 'snooze' ? 'pass' : 'fail', `${game.id} idle result`);
  }
});

test('rendering registry games at several times does not throw', () => {
  const ctx = renderContext();
  for (const game of MICRO) {
    const instance = game.create(391, 0.63);
    for (const t of [0, 1, 2]) assert.doesNotThrow(() => instance.render(ctx, t), `${game.id} at ${t}s`);
  }
});

test('squirrels can be swatted at their seeded pop times', () => {
  const seed = 321;
  const difficulty = 0.82;
  const schedule = squirrelSchedule(seed, difficulty);
  const instance = MICRO.find((game) => game.id === 'squirrel')!.create(seed, difficulty);
  const spots = [{ x: 18, y: 55 }, { x: 43, y: 48 }, { x: 76, y: 56 }, { x: 27, y: 78 }, { x: 57, y: 75 }, { x: 84, y: 79 }];
  for (const pop of schedule) {
    if (instance.outcome !== 'pending') break;
    instance.update(1 / 60, pop.at + 0.1, emptyHeld);
    const spot = spots[pop.spot];
    instance.down?.(spot.x, spot.y - 3);
  }
  assert.equal(instance.outcome, 'pass');
});

test('tapping the tree passes and a student fails', () => {
  const layout = treeLayout(431, 0.72);
  for (let i = 0; i < layout.length; i++) {
    for (const other of layout.slice(i + 1)) {
      assert.ok(Math.hypot(layout[i].x - other.x, layout[i].y - other.y) > 14.4, 'student figures should not overlap');
    }
  }
  const mascot = layout.find((figure) => figure.isTree)!;
  const student = layout.find((figure) => !figure.isTree)!;
  const game = MICRO.find((entry) => entry.id === 'tree')!;
  const win = game.create(431, 0.72);
  win.down?.(mascot.x, mascot.y);
  assert.equal(win.outcome, 'pass');
  const lose = game.create(431, 0.72);
  lose.down?.(student.x, student.y);
  assert.equal(lose.outcome, 'fail');
});

test('tracing the seeded signature checkpoints passes', () => {
  const path = signPath(2468, 0.72);
  const instance = MICRO.find((game) => game.id === 'sign-here')!.create(2468, 0.72);
  instance.down?.(path.checkpoints[0].x, path.checkpoints[0].y);
  for (const point of path.checkpoints.slice(1)) {
    instance.move?.(point.x, point.y);
    if (instance.outcome !== 'pending') break;
  }
  assert.equal(instance.outcome, 'pass');
});

test('jumping during each fountain warning survives 20 seeds at both speed extremes', () => {
  const game = MICRO.find((entry) => entry.id === 'fountain')!;
  for (const difficulty of [0, 1]) {
    for (let seed = 0; seed < 20; seed++) {
      const jets = fountainSchedule(seed, difficulty);
      const instance = game.create(seed, difficulty);
      let nextJet = 0;
      for (let frame = 0; frame <= Math.ceil(game.duration(MAX_TIER) * 60); frame++) {
        const realT = frame / 60;
        const t = realT * MAX_PACE;
        instance.update((1 / 60) * MAX_PACE, t, emptyHeld);
        if (nextJet < jets.length && t >= jets[nextJet].at - FOUNTAIN_TELEGRAPH + 0.2) {
          instance.press?.('action');
          nextJet++;
        }
        if (instance.outcome === 'fail') break;
      }
      assert.equal(instance.timeUp(), 'pass', `seed ${seed} at difficulty ${difficulty}`);
    }
  }
});

test('stopping the hoover bell inside its seeded zone passes', () => {
  const seed = 157;
  const difficulty = 0.9;
  const layout = hooverLayout(seed, difficulty);
  const game = MICRO.find((entry) => entry.id === 'hoover')!;
  const instance = game.create(seed, difficulty);
  for (let frame = 0; frame <= game.duration(8) * 120; frame++) {
    const t = frame / 120;
    instance.update(1 / 120, t, emptyHeld);
    if (Math.abs(layout.markerAt(t) - layout.zoneCenter) <= layout.zoneWidth / 2) {
      instance.press?.('action');
      break;
    }
  }
  assert.equal(instance.outcome, 'pass');
});

test('perfect solvers pass every micro-game at difficulty one and maximum pace', () => {
  for (const game of MICRO) {
    let passes = 0;
    const failedSeeds: number[] = [];
    for (let seed = 0; seed < 20; seed++) {
      if (pacedSolverOutcome(game, seed, 1, MAX_PACE) === 'pass') passes++;
      else failedSeeds.push(seed);
    }
    assert.ok(passes >= 18, `${game.id} passed ${passes}/20 at pace ${MAX_PACE}; failed seeds: ${failedSeeds.join(', ')}`);
  }
});
