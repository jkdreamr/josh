import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commandsAt,
  createReplayWorld,
  loadRecording,
  recordFrames,
  runReplay,
  validateRecording,
} from './soccer-replay/format.ts';
import { eventually, globalInvariants, goalScored, passReached, restartBecame } from './soccer-replay/invariants.ts';
import {
  createWorld,
  nearestCarrier,
  type Restart,
  type Team,
  type World,
} from '../src/os/arcade/games/soccer/logic.ts';

test('input recording is deterministic including CPU decisions', () => {
  const r = loadRecording('kickoff');
  assert.deepEqual(runReplay(r, globalInvariants()), runReplay(r, globalInvariants()));
});
test('park defaults reproduce explicit placements and reject invalid options', () => {
  const compact = loadRecording('direction-0');
  const expanded = structuredClone(compact);
  expanded.setup!.park = false;
  expanded.setup!.players = Object.fromEntries(
    createReplayWorld(compact).players.map((player) => [
      player.id,
      { x: player.x, z: player.z, vx: player.vx, vz: player.vz, facing: player.facing },
    ]),
  );
  assert.deepEqual(runReplay(compact), runReplay(expanded));
  assert.throws(() => validateRecording({ ...compact, setup: { name: 'live', park: 'yes' } }));
  assert.throws(() => validateRecording({ ...compact, cpuRestarts: 'yes' }));
});
test('RLE round trips multiple seats, empty frames and gaps without aliasing', () => {
  const frames = [
    new Map(),
    new Map([
      [0, { move: { x: 1, z: 0 } }],
      [1, { move: { x: 0, z: 1 } }],
    ]),
    new Map([[0, { move: { x: 1, z: 0 } }]]),
  ];
  const runs = recordFrames(frames);
  assert.equal(runs.length, 2);
  assert.equal(runs[0]!.to, 2);
  const r = { ...loadRecording('phone'), seats: { 0: 6, 1: 9 }, frames: 3, commands: runs, presence: [] };
  for (let f = 0; f < 3; f++)
    for (const seat of [0, 1])
      assert.deepEqual(commandsAt(r, f).get(seat), frames[f]!.get(seat) ?? { move: { x: 0, z: 0 } });
  frames[1]!.get(0)!.move.x = 0;
  assert.equal(runs[0]!.command.move.x, 1);
  assert.deepEqual(recordFrames([]), []);
});
test('recording rejects malformed version, ranges, seats, commands and nonfinite data', () => {
  const base = loadRecording('kickoff');
  for (const patch of [
    { version: 2 },
    { seed: NaN },
    { frames: 0 },
    { level: 'expert' },
    { clubs: ['missing', 'northshore'] },
    { seats: { 0: 22 } },
    { commands: [{ from: 2, to: 1, seat: 0, command: { move: { x: 0, z: 0 } } }] },
    { commands: [{ from: 0, to: 0, seat: 99, command: { move: { x: 0, z: 0 } } }] },
    { commands: [...base.commands, ...base.commands] },
    { commands: [{ from: 0, to: 0, seat: 0, command: { move: { x: Infinity, z: 0 } } }] },
  ])
    assert.throws(() => validateRecording({ ...base, ...patch }));
  for (const command of [
    { move: { x: 0, z: 0 }, pressed: 'yes' },
    { move: { x: 0, z: 0 }, aim: { x: 1 } },
    { move: { x: 0, z: 0 }, power: 2 },
  ])
    assert.throws(() => validateRecording({ ...base, commands: [{ from: 0, to: 0, seat: 0, command }] }));
  for (const setup of [
    { name: 'live', players: { 6: { x: 'zero' } } },
    { name: 'live', players: { 6: { team: 1 } } },
    { name: 'live', ball: { grounded: 1 } },
    { name: 'live', carrierId: 22 },
  ])
    assert.throws(() => validateRecording({ ...base, setup }));
  assert.throws(() => loadRecording('../kickoff'));
});
function scenario(
  name: string,
  predicate: (w: ReturnType<typeof runReplay>) => boolean,
  message: string,
  todo?: string,
) {
  test(name, { todo }, () => {
    const invariant = globalInvariants(),
      event = eventually(predicate);
    runReplay(loadRecording(name), (w, f, p) => {
      invariant(w, f, p);
      event.observe(w);
    });
    event.assert(message);
  });
}
scenario('kickoff', passReached(5), 'kickoff pass reaches the intended teammate');
for (let direction = 0; direction < 8; direction++) {
  test('direction-' + direction + ': selection and reception', () => {
    const recording = loadRecording('direction-' + direction);
    const passerId = recording.seats[0]!;
    const initial = createReplayWorld(recording);
    const passer = initial.players.find((player) => player.id === passerId)!;
    const stick = recording.commands[0]!.command.move;
    const candidates = initial.players
      .filter((player) => player.id !== passerId && player.team === passer.team)
      .map((player) => {
        const x = player.x - passer.x;
        const z = player.z - passer.z;
        return { id: player.id, alignment: (x * stick.x + z * stick.z) / Math.hypot(x, z) };
      })
      .sort((a, b) => b.alignment - a.alignment);
    const intendedId = candidates[0]!.id;
    const invariant = globalInvariants();
    const selected = eventually((world) => world.passTarget === intendedId);
    const received = eventually(passReached(intendedId));
    runReplay(recording, (world, frame, paused) => {
      invariant(world, frame, paused);
      selected.observe(world);
      received.observe(world);
    });
    selected.assert('stick selects the teammate with the best bearing');
    received.assert('pass reaches that teammate');
  });
}
scenario(
  'through',
  (w) => w.passTarget === 9 && (w.passPoint?.x ?? 0) > w.players[9]!.x + 2,
  'through ball leads runner into space',
);
test('cross is a lob that reaches the penalty area or teammate', () => {
  const invariant = globalInvariants();
  const lob = eventually((world) => world.kickEvent?.playerId === 6 && world.kickEvent.action === 'lob');
  const arrived = eventually(
    (world) => (world.ball.x > 36 && Math.abs(world.ball.z) < 20 && world.ball.y > 0.2) || passReached(9)(world),
  );
  runReplay(loadRecording('cross'), (world, frame, paused) => {
    invariant(world, frame, paused);
    lob.observe(world);
    arrived.observe(world);
  });
  lob.assert('cross uses the lob action');
  arrived.assert('cross reaches penalty area or teammate');
});
scenario('goal', goalScored(0), 'shot scores');
test('save: keeper holds or parries without conceding', () => {
  const invariant = globalInvariants();
  const touched = eventually((world) => world.lastToucherId === 11);
  runReplay(loadRecording('save'), (world, frame, paused) => {
    invariant(world, frame, paused);
    touched.observe(world);
    assert.deepEqual(world.score, [0, 0]);
    assert.ok(!world.ball.inNet);
  });
  touched.assert('keeper touched the shot');
});

function restartTaken(kind: Restart, team: Team) {
  let awardedAt: number | undefined;
  let taken = false;
  return {
    observe(world: World, frame: number) {
      if (awardedAt === undefined && restartBecame(kind, team)(world)) awardedAt = frame;
      if (
        awardedAt !== undefined &&
        world.phase === 'live' &&
        world.kickEvent &&
        world.players.find((player) => player.id === world.kickEvent!.playerId)?.team === team
      ) {
        assert.ok(frame - awardedAt <= 900, 'CPU takes restart within 15 seconds');
        taken = true;
      }
    },
    assert() {
      assert.notEqual(awardedAt, undefined, 'correct restart awarded to correct team');
      assert.ok(taken, 'CPU takes restart and returns play to live');
    },
  };
}

for (const [name, kind, team] of [
  ['offside', 'free-kick', 1],
  ['corner', 'corner', 0],
  ['goal-kick', 'goal-kick', 1],
] as const) {
  test(name + ': awarded then taken by CPU', () => {
    const recording = loadRecording(name);
    recording.cpuRestarts = true;
    const invariant = globalInvariants();
    const restart = restartTaken(kind, team);
    const offside = eventually((world) => world.event === 'offside' && !!world.rules?.indirect);
    runReplay(recording, (world, frame, paused) => {
      invariant(world, frame, paused);
      restart.observe(world, frame);
      offside.observe(world);
    });
    restart.assert();
    if (name === 'offside') offside.assert('offside awards an indirect free kick');
  });
}
scenario(
  'kick-in',
  restartBecame('kick-in', 1),
  'boundary cause awards correct restart',
  'stepBall bounces at touchline before resolveBoundary can award a throw-in',
);

test('penalty: correct team takes a shot that resolves', () => {
  const invariant = globalInvariants();
  const restart = restartTaken('penalty', 0);
  let shot = false;
  let resolved = false;
  runReplay(loadRecording('penalty'), (world, frame, paused) => {
    invariant(world, frame, paused);
    restart.observe(world, frame);
    if (world.kickEvent?.action === 'shoot') shot = true;
    if (
      shot &&
      (world.score[0] > 0 || world.lastToucherId === 11 || (world.phase === 'restart' && world.restart !== 'penalty'))
    )
      resolved = true;
  });
  restart.assert();
  assert.ok(shot, 'penalty taken as a shot');
  assert.ok(resolved, 'penalty ends in goal, keeper touch or miss');
});
test('foul: tackle gives advantage then stoppage on lost possession', () => {
  const inv = globalInvariants(),
    advantage = eventually((w) => !!w.rules?.advantage),
    stoppage = eventually(restartBecame('free-kick', 1));
  const recording = loadRecording('foul');
  recording.cpuRestarts = true;
  const restart = restartTaken('free-kick', 1);
  runReplay(recording, (w, f, p) => {
    inv(w, f, p);
    advantage.observe(w);
    stoppage.observe(w);
    restart.observe(w, f);
  });
  advantage.assert('fouled team retains advantage');
  stoppage.assert('advantage recalled on loss');
  restart.assert();
});
test('stuck corner ball is collected or moved within three seconds', () => {
  const inv = globalInvariants(),
    resolved = eventually(
      (w) => w.carrierId != null || Math.hypot(w.ball.x - 52.25, w.ball.z - 33.65) > 1 || w.phase !== 'live',
    );
  runReplay(loadRecording('stuck'), (w, f, p) => {
    inv(w, f, p);
    if (f <= 180) resolved.observe(w);
  });
  resolved.assert('corner ball resolved within 3 seconds');
});
test('phone disconnect freezes all state and rejoin resumes without catchup', () => {
  const inv = globalInvariants();
  let before: ReturnType<typeof runReplay>, last: ReturnType<typeof runReplay>;
  runReplay(loadRecording('phone'), (w, f, p) => {
    inv(w, f, p);
    if (f === 29) before = structuredClone(w);
    if (p) assert.deepEqual(w, before);
    if (f === 90) assert.ok(w.clock < before.clock && before.clock - w.clock < 0.02);
    last = structuredClone(w);
  });
  assert.ok(last!.clock < before!.clock);
  const uninterrupted = loadRecording('phone');
  uninterrupted.frames = 90;
  uninterrupted.presence = [];
  assert.deepEqual(last!, runReplay(uninterrupted));
});

test('global invariants reject nonfinite, overlap, stranded ball, score, clock, restart and bounds regressions', () => {
  const world = () => {
    const w = createWorld();
    w.phase = 'live';
    w.restart = null;
    return w;
  };
  const nan = world();
  nan.ball.vx = NaN;
  assert.throws(() => globalInvariants()(nan, 0), /nonfinite/);
  const inf = world();
  inf.players[0]!.vx = Infinity;
  assert.throws(() => globalInvariants()(inf, 0), /nonfinite/);
  const bounds = world();
  bounds.players[0]!.x = 60;
  assert.throws(() => globalInvariants()(bounds, 0), /out of bounds/);
  const overlap = world();
  Object.assign(overlap.players[1]!, { x: overlap.players[0]!.x, z: overlap.players[0]!.z });
  const overlapping = globalInvariants();
  for (let f = 0; f < 29; f++) overlapping(overlap, f);
  assert.throws(() => {
    for (let f = 29; f < 32; f++) overlapping(overlap, f);
  }, /overlap/);
  const stuck = world();
  stuck.ball.x = 50;
  stuck.ball.z = 30;
  const stranded = globalInvariants();
  for (let f = 0; f < 180; f++) stranded(stuck, f);
  assert.throws(() => stranded(stuck, 180), /stuck/);
  const wedged = world();
  Object.assign(wedged.ball, { x: 0, z: 0 });
  Object.assign(wedged.players[1]!, { x: 0.8, z: 0 });
  Object.assign(wedged.players[2]!, { x: -0.8, z: 0 });
  assert.equal(nearestCarrier(wedged), undefined);
  const wedgedInvariant = globalInvariants();
  for (let frame = 0; frame < 180; frame++) wedgedInvariant(wedged, frame);
  assert.throws(() => wedgedInvariant(wedged, 180), /stuck/);
  const score = world(),
    scoring = globalInvariants();
  score.score[0] = 1;
  scoring(score, 0);
  score.score[0] = 0;
  assert.throws(() => scoring(score, 1), /score decreased/);
  const clock = world(),
    timing = globalInvariants();
  timing(clock, 0);
  clock.clock += 1;
  assert.throws(() => timing(clock, 1), /clock increased/);
  const restart = world();
  restart.phase = 'restart';
  restart.restart = 'kick-in';
  restart.restartTeam = restart.lastTouch;
  assert.throws(() => globalInvariants()(restart, 0), /oppose last touch/);
});
test('global invariants allow a brief overlap, halftime clock reset, paused time and sent-off players', () => {
  const w = createWorld(),
    inv = globalInvariants();
  inv(w, 0);
  w.clock -= 10;
  inv(w, 1);
  w.half = 2;
  w.clock = w.halfLength;
  inv(w, 2);
  w.players[0]!.sentOff = true;
  w.players[0]!.z = -36;
  inv(w, 3);
  for (let f = 4; f < 200; f++) inv(w, f, true);
});
