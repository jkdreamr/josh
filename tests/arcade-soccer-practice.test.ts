import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeState, createPracticeWorld, createTutorial, markTutorialSeen, readBest, selectDrill, SLALOM_CONES, stepPractice, stepTutorial, supportTarget, tutorialSeen, TUTORIAL_SECONDS, type DrillId } from '../src/os/arcade/games/soccer/practice.ts';
import { distance, nearestCarrier, STEP, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { parsePacket } from '../src/os/arcade/games/soccer/net.ts';
import { playerForSeat, seatForPlayer } from '../src/os/arcade/games/soccer/seats.ts';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
};

const human = (world: World) => world.players[world.controlled[0]]!;
const toward = (from: { x: number; z: number }, to: { x: number; z: number }) => {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
};

function run(drill: DrillId, seconds: number, bot: (world: World, state: ReturnType<typeof createPracticeState>, frame: number) => Command | null, seed = 41, level: 'easy' | 'normal' | 'hard' = 'normal') {
  const state = createPracticeState(drill, null);
  const world = createPracticeWorld(seed, state);
  for (let frame = 0; frame < seconds / STEP && state.phase !== 'done'; frame++) {
    const command = bot(world, state, frame);
    stepPractice(state, world, STEP, command ? new Map([[world.controlled[0], command]]) : new Map(), level, frame);
  }
  return { state, world };
}

test('free play keeps the own keeper benched, has no clock, and teammates offer open lanes', () => {
  let open = 0, samples = 0;
  const { state, world } = run('free', 240, (world, state, frame) => {
    const player = human(world);
    assert.notEqual(player.slot, 'GK');
    assert.ok(world.phase === 'live');
    if (frame > 120 && frame % 30 === 0) {
      const carrier = nearestCarrier(world);
      if (carrier?.id === player.id) {
        for (const id of state.active) {
          const mate = world.players[id]!;
          if (mate.team !== 0 || mate.id === player.id) continue;
          samples++;
          const keeper = world.players[11]!;
          const dx = mate.x - player.x, dz = mate.z - player.z;
          const t = Math.max(0, Math.min(1, ((keeper.x - player.x) * dx + (keeper.z - player.z) * dz) / (dx * dx + dz * dz)));
          if (Math.hypot(keeper.x - (player.x + dx * t), keeper.z - (player.z + dz * t)) > 2 && distance(mate, player) < 32) open++;
        }
      }
    }
    const carrying = nearestCarrier(world)?.id === player.id;
    return { move: carrying ? toward(player, { x: 30, z: frame % 600 < 300 ? -10 : 10 }) : toward(player, world.ball), sprint: !carrying };
  });
  const benchedKeeper = world.players[0]!;
  assert.equal(benchedKeeper.human, false);
  assert.equal(world.players.filter((p) => p.team === 1 && state.active.includes(p.id)).length, 1);
  assert.ok(samples > 20 && open / samples > 0.9, `${open}/${samples}`);
  for (const id of state.active) if (world.players[id]!.team === 0 && id !== world.controlled[0]) assert.ok(distance(supportTarget(world, state, id), world.ball) > 6);
});

test('free play respawns the ball instantly at the shooter after a goal', () => {
  const state = createPracticeState('free', null);
  const world = createPracticeWorld(5, state);
  const player = human(world);
  world.ball = { ...world.ball, x: 52.3, z: 0.5, y: 0.5, vx: 30, vz: 0, vy: 0, grounded: false };
  world.lastTouch = 0; world.lastToucherId = player.id; world.carrierId = null;
  stepPractice(state, world, STEP, new Map(), 'normal', 0);
  assert.equal(state.score, 1);
  assert.equal(world.phase, 'live');
  assert.ok(distance(world.ball, human(world)) < 1);
});

test('passing gates score passes through the lit gate and save the best', () => {
  store.clear();
  const { state } = run('passing', 50, (world, state, frame) => {
    const player = human(world);
    const gate = state.gate!;
    const target = world.players[gate.target]!;
    const carrying = nearestCarrier(world)?.id === player.id;
    const ready = carrying && frame % 40 === 0;
    return { move: { x: 0, z: 0 }, action: ready ? 'pass' : null, pressed: ready, power: 0.35, aim: toward(player, target) };
  });
  assert.equal(state.phase, 'done');
  assert.ok(state.score >= 5, `gates ${state.score}`);
  assert.equal(readBest('passing'), state.score);
});

test('finishing runs ten shots and scores goals', () => {
  store.clear();
  const { state } = run('finishing', 120, (world, state, frame) => {
    const player = human(world);
    const fire = nearestCarrier(world)?.id === player.id && state.shot.timer > 0.4 && !state.shot.taken;
    const side = state.attempt % 2 ? 1 : -1;
    return { move: { x: 0, z: 0 }, action: fire ? (state.attempt >= 6 ? 'finesse' : 'shoot') : null, pressed: fire, power: 0.6, aim: { x: 0.44, z: side * 0.9 } };
  }, 41, 'easy');
  assert.equal(state.phase, 'done');
  assert.equal(state.attempt, 10);
  assert.ok(state.score > 0);
  assert.equal(readBest('finishing'), state.score);
});

test('dribble slalom times three weaving runs and keeps the fastest', () => {
  store.clear();
  const { state } = run('slalom', 120, (world, state) => {
    const player = human(world);
    const next = state.run.next;
    const cone = SLALOM_CONES[next];
    const target = cone ? { x: cone.x + 1, z: (next % 2 === 0 ? -1 : 1) * 2.2 } : { x: 40, z: 0 };
    return { move: toward(player, target), sprint: !cone };
  });
  assert.equal(state.phase, 'done', JSON.stringify(state.run));
  assert.equal(state.runs.length, 3);
  assert.ok(state.score > 3 && state.score < 20, `${state.score}`);
  assert.equal(readBest('slalom'), state.score);
  assert.ok(state.events.length >= 0);
});

test('defending reps end when the dribbler beats an idle defender', () => {
  const { state } = run('defending', 80, () => null);
  assert.equal(state.phase, 'done');
  assert.equal(state.attempt, 5);
  assert.equal(state.score, 0);
});

test('defending rewards winning the ball', () => {
  const { state } = run('defending', 90, (world) => {
    const player = human(world);
    const ball = world.ball;
    const near = distance(player, ball) < 1.6;
    return { move: toward(player, ball), action: near ? 'tackle' : null, pressed: near, contain: !near };
  });
  assert.equal(state.phase, 'done');
  assert.ok(state.score >= 1, `won ${state.score}`);
});

test('switching drills resets state and roster', () => {
  const state = createPracticeState('free', null);
  const world = createPracticeWorld(9, state);
  selectDrill(state, world, 'defending');
  assert.equal(state.drill, 'defending');
  assert.deepEqual(state.active, [6, 20, 11]);
  assert.equal(nearestCarrier(world)?.id, 20);
});

test('tutorial walks move, pass, shoot within twenty seconds and is shown once', () => {
  store.clear();
  let tutorial = createTutorial();
  const steps = new Set<string>();
  for (let t = 0; t < 30 && !tutorial.finished; t += STEP) {
    steps.add(tutorial.step);
    tutorial = stepTutorial(tutorial, { moving: true, passed: t > 2, shot: t > 3 }, STEP);
  }
  assert.deepEqual([...steps], ['move', 'pass', 'shoot', 'done']);
  assert.ok(tutorial.total < 6);
  let idle = createTutorial();
  while (!idle.finished) idle = stepTutorial(idle, { moving: false, passed: false, shot: false }, STEP);
  assert.ok(idle.total <= TUTORIAL_SECONDS + STEP);
  assert.equal(tutorialSeen(), false);
  markTutorialSeen();
  assert.equal(tutorialSeen(), true);
});

test('practice mode travels over the network and maps phones to the home side', () => {
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 1, half: 4, level: 1, displayOnly: true, mode: 'practice' })?.k, 'cfg');
  assert.deepEqual(parsePacket({ t: 'soccer', k: 'pd', r: 1, seq: 2, seat: 1, pick: 'slalom' }), { t: 'soccer', k: 'pd', r: 1, seq: 2, seat: 1, pick: 'slalom' });
  assert.equal(parsePacket({ t: 'soccer', k: 'pd', r: 1, seq: 2, seat: 9, pick: 'slalom' }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'pp', r: 1, seq: 3, drill: 'free', prompt: 'x', hint: '', score: '0', best: '', done: false, tutorial: '' })?.k, 'pp');
  assert.equal(parsePacket({ t: 'soccer', k: 'pp', r: 1, seq: 3, drill: 'free', prompt: 'x'.repeat(400), hint: '', score: '0', best: '', done: false, tutorial: '' }), null);
  assert.equal(playerForSeat(1, true, 'practice'), 6);
  assert.equal(seatForPlayer(6, true, 'practice'), 1);
});
