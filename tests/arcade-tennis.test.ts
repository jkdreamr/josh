import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  DOUBLES_WIDTH,
  GRAVITY,
  SINGLES_WIDTH,
  STEP,
  TOSS_START,
  createWorld,
  hitServe,
  isInCourt,
  isInServiceBox,
  movePlayer,
  predictLanding,
  scorePoint,
  serveSide,
  solveShot,
  stepWorld,
  timingLabel,
  timingQuality,
  tossServe,
  type Level,
  type Command,
  type Spin3,
} from '../src/os/arcade/games/tennis/logic.ts';
import { characterSpaceBoneTarget, debugPoseAngles } from '../src/os/arcade/games/tennis/player.ts';
import { commandOf, configOf, moveOf, parsePacket, stateOf, swingOf } from '../src/os/arcade/games/tennis/net.ts';
import { chooseShot } from '../src/os/arcade/games/tennis/ai.ts';

function scriptedHumanPoints(level: Level, seed: number) {
  let completed = 0;
  let humanWins = 0;
  let rallyShots = 0;
  let rallies = 0;
  let matchSeed = seed;
  let matches = 0;
  while (completed < 300 && matches < 120) {
    matches++;
    const world = createWorld({
      level,
      length: 'game',
      players: [{ ai: null }, { ai: level }],
      seed: matchSeed++,
    });
    let serveQueued = false;
    let lastPressAt = -1;
    let currentRallyShots = 0;
    let jitterState = matchSeed | 0;
    const jitter = () => {
      jitterState = (Math.imul(jitterState, 1664525) + 1013904223) | 0;
      return (jitterState >>> 0) / 4294967296;
    };
    for (let step = 0; step < 180_000 && world.phase !== 'done' && completed < 300; step++) {
      const human = world.players[0]!;
      const commands: Command[] = [];
      if (world.serverSeat === human.seat && world.phase === 'serve-ready' && !serveQueued) {
        commands.push({ seat: human.seat, toss: true });
        serveQueued = true;
      } else if (world.serverSeat === human.seat && world.phase === 'serve-toss' && world.serveClock >= 0.52) {
        commands.push({ seat: human.seat, serve: true, swing: { kind: 'drive', aim: 0, delta: 0 } });
      }
      if (world.phase === 'serve-ready' && world.serveNumber === 2) serveQueued = false;

      if ((world.phase === 'rally' || world.phase === 'serve-flight') && world.ball.inPlay && world.ball.canHitTeam === human.team) {
        const interceptX = world.ball.p.x + world.ball.v.x * 0.22;
        const interceptZ = world.ball.p.z + world.ball.v.z * 0.22;
        const side = interceptX >= human.x ? 1 : -1;
        const targetX = interceptX - side * 0.75;
        const dx = targetX - human.x;
        const dz = interceptZ - human.z;
        const distanceToPlayer = Math.hypot(dx, dz);
        const moveLength = Math.max(distanceToPlayer, 0.001);
        commands.push({ seat: human.seat, move: { x: dx / moveLength, z: dz / moveLength } });

        const zoneDistance = Math.hypot(world.ball.p.x - (human.x + side * 0.75), world.ball.p.z - human.z);
        const closingSpeed = Math.max(4, Math.hypot(world.ball.v.x, world.ball.v.z) + 4);
        const timeToZone = Math.max(0, (zoneDistance - 1.3) / closingSpeed);
        const pressLead = 0.18 - (jitter() - 0.5) * 0.12;
        if (!human.pending && world.clock - lastPressAt >= 0.18 && timeToZone <= pressLead && zoneDistance <= 4) {
          commands.push({ seat: human.seat, swing: { kind: 'drive', aim: dx < -0.2 ? -1 : dx > 0.2 ? 1 : 0, delta: 0 } });
          lastPressAt = world.clock;
        }
      }

      const events = stepWorld(world, commands, STEP);
      for (const event of events) {
        if (event.type === 'hit') currentRallyShots++;
        else if (event.type === 'point') {
          completed++;
          if (event.winner === 0) humanWins++;
          rallyShots += currentRallyShots;
          rallies++;
          currentRallyShots = 0;
          serveQueued = false;
        }
      }
    }
  }
  return { completed, winRate: humanWins / completed, averageRally: rallyShots / rallies };
}

test('the court uses ITF dimensions and touching a line is in', () => {
  assert.equal(COURT_LENGTH, 23.77);
  assert.equal(SINGLES_WIDTH, 8.23);
  assert.equal(DOUBLES_WIDTH, 10.97);
  assert.equal(isInCourt(SINGLES_WIDTH / 2 + BALL_RADIUS, 0, 'singles'), true);
  assert.equal(isInCourt(SINGLES_WIDTH / 2 + BALL_RADIUS + 0.01, 0, 'singles'), false);
  assert.equal(isInCourt(0, COURT_LENGTH / 2 + BALL_RADIUS, 'singles'), true);
});

test('stepWorld advances a 0.1 second wall-clock frame', () => {
  const world = createWorld();
  stepWorld(world, [], 0.1);
  assert.ok(Math.abs(world.clock - 0.1) < 1e-8);
});

test('deuce, advantage, and match lengths score the full game', () => {
  const world = createWorld({ length: 'game' });
  world.match.points = [3, 3];
  scorePoint(world, 0);
  assert.deepEqual(world.match.points, [4, 3]);
  world.phase = 'rally';
  scorePoint(world, 1);
  assert.deepEqual(world.match.points, [4, 4]);
  world.phase = 'rally';
  scorePoint(world, 0);
  assert.deepEqual(world.match.points, [5, 4]);
  world.phase = 'rally';
  scorePoint(world, 0);
  assert.equal(world.match.games[0], 1);
  assert.equal(world.match.winner, 0);
  assert.equal(world.phase, 'done');

  const three = createWorld({ length: 'three' });
  three.match.games = [1, 1];
  three.match.points = [3, 0];
  scorePoint(three, 0);
  assert.equal(three.match.winner, 0);

  const set = createWorld({ length: 'set' });
  set.match.games = [6, 6];
  set.match.tiebreak = true;
  set.match.tbPoints = [6, 6];
  scorePoint(set, 0);
  assert.deepEqual(set.match.tbPoints, [7, 6]);
  assert.equal(set.match.winner, null);
  set.phase = 'rally';
  scorePoint(set, 0);
  assert.equal(set.match.winner, 0);
  assert.deepEqual(set.match.completedSets, [[7, 6]]);
});

test('server rotation covers every doubles player and boxes alternate', () => {
  const doubles = createWorld({ format: 'doubles', length: 'set' });
  const order = [0, 1, 2, 3, 0];
  for (let game = 0; game < 4; game++) {
    assert.equal(doubles.serverSeat, order[game]);
    doubles.match.points = [3, 0];
    scorePoint(doubles, 0);
    if (game < 3) doubles.phase = 'rally';
  }
  assert.equal(doubles.serverSeat, order[4]);

  const singles = createWorld();
  assert.equal(serveSide(singles), 0);
  singles.match.points = [1, 0];
  assert.equal(serveSide(singles), 1);
  singles.match.points = [2, 1];
  assert.equal(serveSide(singles), 1);
});

test('serve boxes, faults, double faults, and a net let behave correctly', () => {
  const world = createWorld();
  assert.equal(isInServiceBox(1.5, -8, 1, 0, 'singles'), true);
  assert.equal(isInServiceBox(-1.5, -8, 1, 0, 'singles'), false);
  assert.equal(tossServe(world, 0), true);
  assert.equal(world.phase, 'serve-toss');
  assert.equal(hitServe(world, 0, -0.02), true);
  assert.equal(world.phase, 'serve-flight');

  const fault = createWorld();
  fault.phase = 'serve-flight';
  fault.ball.inPlay = true;
  fault.ball.p = { x: 6, y: BALL_RADIUS + 0.001, z: -8 };
  fault.ball.v = { x: 0, y: -1, z: 0 };
  const first = stepWorld(fault, [], STEP);
  assert.equal(fault.serveNumber, 2);
  assert.ok(first.some((event) => event.type === 'call' && event.call === 'fault'));
  fault.phase = 'serve-flight';
  fault.ball.inPlay = true;
  fault.ball.p = { x: 6, y: BALL_RADIUS + 0.001, z: -8 };
  fault.ball.v = { x: 0, y: -1, z: 0 };
  const second = stepWorld(fault, [], STEP);
  assert.equal(fault.match.points[1], 1);
  assert.ok(second.some((event) => event.type === 'call' && event.call === 'double fault'));

  const letBall = createWorld();
  letBall.phase = 'serve-flight';
  letBall.ball.inPlay = true;
  letBall.ball.hitByTeam = 0;
  letBall.ball.netCord = true;
  letBall.ball.p = { x: 1.4, y: BALL_RADIUS + 0.001, z: -8 };
  letBall.ball.v = { x: 0, y: -1, z: 0 };
  const letEvents = stepWorld(letBall, [], STEP);
  assert.equal(letBall.phase, 'serve-ready');
  assert.equal(letBall.serveNumber, 1);
  assert.ok(letEvents.some((event) => event.type === 'call' && event.call === 'let'));
});

test('serve-ready ball follows its moving server and toss follows hand-height trajectory', () => {
  const moving = createWorld();
  const server = moving.players[moving.serverSeat]!;
  const startingX = server.x;
  stepWorld(moving, [{ seat: server.seat, move: { x: 1, z: 0 } }], 0.1);
  assert.ok(server.x > startingX);
  const cos = Math.cos(server.facing);
  const sin = Math.sin(server.facing);
  assert.ok(Math.abs(moving.ball.p.x - (server.x - 0.36 * cos + 0.035 * sin)) < 1e-6);
  assert.ok(Math.abs(moving.ball.p.z - (server.z + 0.36 * sin + 0.035 * cos)) < 1e-6);
  assert.deepEqual(moving.ball.prev, moving.ball.p);

  const toss = createWorld();
  assert.equal(tossServe(toss, toss.serverSeat), true);
  assert.equal(toss.ball.p.y, TOSS_START);
  for (let i = 0; i < Math.round(0.56 / STEP); i++) stepWorld(toss, [], STEP);
  const expected = TOSS_START + 5.5 * toss.serveClock - 0.5 * GRAVITY * toss.serveClock ** 2;
  assert.ok(Math.abs(toss.ball.p.y - expected) < 1e-6);
  assert.ok(Math.abs(toss.ball.p.y - 2.89) < 0.02);
});

test('character-space upper-arm rotation moves the hand forward and upward despite model yaw', () => {
  const root = new THREE.Group();
  root.rotation.y = 0.47;
  const shoulder = new THREE.Bone();
  shoulder.position.set(0, 1.5, 0);
  const upper = new THREE.Bone();
  upper.name = 'upperarm_r';
  upper.position.set(0.2, 0, 0);
  shoulder.add(upper);
  root.add(shoulder);
  const lower = new THREE.Bone();
  lower.position.set(0, -0.2, -0.35);
  upper.add(lower);
  const hand = new THREE.Bone();
  hand.name = 'hand_r';
  hand.position.set(0, -0.1, -0.15);
  lower.add(hand);
  root.updateMatrixWorld(true);
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
  const parentBindWorld = rootWorld.clone().invert().multiply(shoulder.getWorldQuaternion(new THREE.Quaternion()));
  const bindWorld = rootWorld.clone().invert().multiply(upper.getWorldQuaternion(new THREE.Quaternion()));
  const before = root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const target = characterSpaceBoneTarget(bindWorld, parentBindWorld, parentBindWorld, rotation);
  upper.quaternion.copy(shoulder.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rootWorld.clone().multiply(target)));
  root.updateMatrixWorld(true);
  const after = root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
  assert.ok(after.y > before.y + 0.3, `hand should move up: ${before.y} → ${after.y}`);
  assert.ok(after.z > before.z + 0.1, `hand should move forward: ${before.z} → ${after.z}`);
});

test('idle hands hang below the shoulders and toss hand rises above the head on the real rig', () => {
  const buffer = readFileSync('public/models/tennis/female.glb');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12))) as {
    nodes: Array<{ name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }>;
    skins: Array<{ joints: number[] }>;
  };
  const joints = new Set(json.skins[0]!.joints);
  const objects = json.nodes.map((node, index) => joints.has(index) ? new THREE.Bone() : new THREE.Group());
  const parents = new Set<number>();
  json.nodes.forEach((node, index) => {
    const object = objects[index]!;
    object.name = node.name ?? '';
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    for (const child of node.children ?? []) { object.add(objects[child]!); parents.add(child); }
  });
  const root = new THREE.Group();
  objects.forEach((object, index) => { if (!parents.has(index)) root.add(object); });
  const bones = json.skins[0]!.joints.map((index) => objects[index] as THREE.Bone);
  const depth = (bone: THREE.Bone) => {
    let value = 0;
    for (let parent = bone.parent; parent; parent = parent.parent) value++;
    return value;
  };
  bones.sort((a, b) => depth(a) - depth(b));
  const bindLocals = new Map(bones.map((bone) => [bone.name, bone.quaternion.clone()]));
  const apply = (name: 'idle' | 'toss') => {
    for (const bone of bones) bone.quaternion.copy(bindLocals.get(bone.name)!);
    root.updateMatrixWorld(true);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const bind = new Map(bones.map((bone) => [bone.name, rootWorld.clone().invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))]));
    const targets = new Map<string, THREE.Quaternion>();
    for (const bone of bones) {
      const parent = bone.parent;
      const parentName = parent?.isBone ? parent.name : null;
      const parentBind = parentName ? bind.get(parentName)! : parent ? rootWorld.clone().invert().multiply(parent.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Quaternion();
      const angle = debugPoseAngles(name).get(bone.name) ?? [0, 0, 0];
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...angle, 'XYZ'));
      const target = characterSpaceBoneTarget(bind.get(bone.name)!, parentBind, parentName ? targets.get(parentName) ?? parentBind : null, rotation);
      targets.set(bone.name, target);
      const parentWorld = parent?.getWorldQuaternion(new THREE.Quaternion()) ?? rootWorld.clone();
      bone.quaternion.copy(parentWorld.invert().multiply(rootWorld.clone().multiply(target)));
      bone.updateMatrixWorld(true);
    }
    root.updateMatrixWorld(true);
  };
  const get = (name: string) => bones.find((bone) => bone.name === name)!.getWorldPosition(new THREE.Vector3());
  apply('idle');
  assert.ok(get('hand_l').y < get('clavicle_l').y);
  assert.ok(get('hand_r').y < get('clavicle_r').y);
  apply('toss');
  assert.ok(get('hand_l').y > get('head').y);
});

test('net collision blocks the ball and timing maps direction and quality', () => {
  const world = createWorld();
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.p = { x: 0, y: 0.7, z: 0.01 };
  world.ball.v = { x: 0, y: -1, z: -8 };
  const events = stepWorld(world, [], STEP);
  assert.ok(events.some((event) => event.type === 'net'));
  assert.equal(world.match.points[0], 1);

  assert.deepEqual(timingQuality(-0.2).hit, false);
  assert.equal(timingQuality(-0.08).direction, -1);
  assert.equal(timingQuality(0.08).direction, 1);
  assert.equal(timingQuality(0).quality, 1);
  assert.equal(timingQuality(0.16).hit, true);
});

test('human movement follows input, respects speed and court bounds, and has no AI drift', () => {
  const world = createWorld();
  const human = world.players[0]!;
  world.phase = 'rally';
  world.ball.inPlay = false;
  const start = { x: human.x, z: human.z };
  for (let i = 0; i < 120; i++) stepWorld(world, i === 0 ? [{ seat: 0, move: { x: 1, z: -1 } }] : [], STEP);
  assert.ok(Math.hypot(human.vx, human.vz) <= 6.001);
  assert.notEqual(human.x, start.x);
  assert.notEqual(human.z, start.z);
  assert.ok(human.x <= SINGLES_WIDTH / 2 + 1.5);
  assert.ok(human.z <= COURT_LENGTH / 2 + 3);
  assert.ok(human.z >= 0.4);

  const stationary = createWorld();
  stationary.phase = 'rally';
  stationary.ball.inPlay = false;
  const player = stationary.players[0]!;
  const position = { x: player.x, z: player.z };
  for (let i = 0; i < 120; i++) stepWorld(stationary, [], STEP);
  assert.deepEqual({ x: player.x, z: player.z }, position);

  player.x = SINGLES_WIDTH / 2 + 2;
  player.z = 1;
  player.input = { x: 1, z: -1 };
  movePlayer(stationary, player, STEP);
  for (let i = 0; i < 360; i++) movePlayer(stationary, player, STEP);
  assert.ok(player.x <= SINGLES_WIDTH / 2 + 1.5);
  assert.ok(player.z >= 0.4);
});

test('buffered swings contact only in range and expire as whiffs', () => {
  const world = createWorld();
  const player = world.players[0]!;
  world.phase = 'rally';
  world.clock = 1;
  world.ball.inPlay = true;
  world.ball.canHitTeam = player.team;
  world.ball.p = { x: player.x + 0.75, y: 1, z: player.z };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: 0, z: 0 };
  player.pending = { kind: 'slice', at: 0.7, aim: 0 };
  const contact = stepWorld(world, [], STEP).find((event) => event.type === 'hit' && event.seat === player.seat);
  assert.ok(contact && contact.type === 'hit');
  assert.ok(Math.abs(contact.delta ?? 1) < 0.02);
  assert.equal(player.pending, null);
  assert.equal(timingLabel(contact.delta ?? 1), 'perfect');
  assert.equal(timingLabel(-0.2), 'early');
  assert.equal(timingLabel(0.2), 'late');
  assert.equal(timingQuality(0).quality, 1);
  assert.equal(timingQuality(-0.1).direction, -1);
  assert.equal(timingQuality(0.1).direction, 1);

  const far = createWorld();
  const hitter = far.players[0]!;
  far.phase = 'rally';
  far.ball.inPlay = true;
  far.ball.canHitTeam = hitter.team;
  far.ball.p = { x: hitter.x + 3, y: 8, z: hitter.z };
  far.ball.prev = { ...far.ball.p };
  far.ball.v = { x: 0, y: 0, z: 0 };
  const queued = stepWorld(far, [{ seat: hitter.seat, swing: { kind: 'lob', aim: 0, delta: 0 } }], STEP);
  assert.equal(queued.some((event) => event.type === 'hit'), false);
  assert.ok(hitter.pending);
  for (let i = 0; i < 73; i++) stepWorld(far, [], STEP);
  assert.equal(hitter.pending, null);
  assert.ok(hitter.swing > 0);
});

test('a returner can queue during a serve flight but cannot hit before the bounce', () => {
  const world = createWorld({ players: [{ ai: 1 }, { ai: null }] });
  const returner = world.players[1]!;
  assert.equal(Math.abs(returner.z), COURT_LENGTH / 2 + 0.8);
  assert.equal(Math.abs(returner.x), 2.05);
  world.phase = 'serve-flight';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.canHitTeam = returner.team;
  world.ball.targetTeam = returner.team;
  world.ball.p = { x: returner.x + 0.75, y: 1, z: returner.z };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: 0, z: 0 };
  const command = { seat: returner.seat, swing: { kind: 'drive' as const, aim: 0 as const, delta: 0 } };
  assert.equal(stepWorld(world, [command], STEP).some((event) => event.type === 'hit' && event.seat === returner.seat), false);
  assert.ok(returner.pending);
  returner.pending.at = world.clock - 0.3 + STEP;
  world.ball.bounces = 1;
  world.ball.p = { x: returner.x + 0.75, y: 1, z: returner.z };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: 0, z: 0 };
  assert.ok(stepWorld(world, [], STEP).some((event) => event.type === 'hit' && event.seat === returner.seat));
});

test('shot solving lands flat, topspin, slice, and lob shots near their target', () => {
  const from = { x: 0.8, y: 1.05, z: 8.6 };
  const target = { x: -1.3, z: -8.8 };
  const spins: Array<[Spin3, number]> = [
    [{ x: 0, y: 0, z: 0 }, 2.1],
    [{ x: 0.8, y: 0.2, z: 42 }, 2.1],
    [{ x: -0.4, y: 0.3, z: -28 }, 2.2],
    [{ x: 0.2, y: 0, z: 12 }, 7.1],
  ];
  for (const [spin, apex] of spins) {
    const velocity = solveShot(from, target, spin, apex);
    const landing = predictLanding(from, velocity, spin, 4);
    assert.ok(Math.hypot(landing.x - target.x, landing.z - target.z) <= 0.15,
      `landing was ${landing.x.toFixed(3)}, ${landing.z.toFixed(3)} with ${Math.hypot(landing.x - target.x, landing.z - target.z).toFixed(3)}m error`);
    assert.equal(landing.clearsNet, true);
  }
});

test('AI matches complete at every level with live rallies', () => {
  for (const level of [0, 1, 2] as const satisfies readonly Level[]) {
    const world = createWorld({
      level,
      length: 'game',
      players: [{ name: 'Player A', ai: level }, { name: 'Player B', ai: level }],
      seed: 22 + level,
    });
    let hits = 0;
    let rallyHits = 0;
    let maxRally = 0;
    let elapsed = 0;
    for (let i = 0; i < 180_000 && world.match.winner === null; i++) {
      const events = stepWorld(world, [], STEP);
      for (const event of events) {
        if (event.type === 'hit') {
          hits++;
          rallyHits++;
        }
        if (event.type === 'point') {
          maxRally = Math.max(maxRally, rallyHits);
          rallyHits = 0;
        }
      }
      elapsed += STEP;
    }
    assert.notEqual(world.match.winner, null, `level ${level} did not finish`);
    assert.ok(elapsed < 600, `level ${level} stalled for ${elapsed}s`);
    assert.ok(hits >= 4, `level ${level} had only ${hits} total hits`);
    if (level === 2) assert.ok(maxRally >= 3, `hard rallies peaked at only ${maxRally} hits`);
  }
});

test('hard CPU aims away from opponents and favors deep drives', () => {
  const world = createWorld({ seed: 4 });
  world.random = () => 0.5;
  const cpu = world.players[0]!;
  cpu.ai = 2;
  world.players[1]!.x = -3.5;
  const hardShot = chooseShot(world, cpu);
  assert.equal(hardShot.aim, 1);
  assert.equal(hardShot.kind, 'drive');

  world.format = 'doubles';
  cpu.z = 0;
  assert.equal(chooseShot(world, cpu).kind, 'drive');

  cpu.ai = 0;
  assert.equal(chooseShot(world, cpu).aim, 0);
});

test('packets round-trip valid settings, swings, and host snapshots and reject bad ranges', () => {
  const config = configOf(4, 'doubles', 'three', 2);
  assert.deepEqual(parsePacket(config), { k: 'cfg', r: 4, format: 'doubles', length: 'three', level: 2 });
  const swing = swingOf(4, 7, { kind: 'slice', aim: -1, delta: -0.1, swipe: 400 });
  assert.equal(parsePacket(swing)?.k, 'sw');
  assert.equal(parsePacket({ ...swing, delta: 3 }), null);
  assert.equal(parsePacket({ ...swing, shot: -1 }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'cfg', r: 1, format: 'trios', length: 'game', level: 1 }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'sw', r: 1, shot: 1, delta: 0, kind: 'smash', aim: 0, swipe: 0 }), null);
  const snapshot = JSON.parse(JSON.stringify(stateOf(4, createWorld({ format: 'doubles' }))));
  const parsed = parsePacket(snapshot);
  assert.equal(parsed?.k, 'S');
  if (parsed?.k === 'S') assert.equal(parsed.state.players.length, 4);
  assert.equal(parsePacket({ ...snapshot, state: { ...snapshot.state, ball: { ...snapshot.state.ball, p: { x: 100, y: 1, z: 0 } } } }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'ev', r: 1, event: { type: 'call', call: 'match-ish' } }), null);
});

test('movement packets round-trip quantized axes and reject malformed input', () => {
  const packet = moveOf(7, { x: 0.236, z: -0.876 });
  assert.equal(packet.x, 0.24);
  assert.equal(packet.z, -0.88);
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(packet))), { k: 'mv', r: 7, x: 0.24, z: -0.88 });
  assert.equal(parsePacket({ ...packet, x: Number.NaN }), null);
  assert.equal(parsePacket({ ...packet, x: 1.01 }), null);
  assert.equal(parsePacket({ ...packet, r: undefined }), null);
  assert.equal(parsePacket({ ...packet, r: 1.5 }), null);
  assert.equal(parsePacket({ ...packet, k: 'sw' }), null);
});

test('guest movement and buffered shots reach the authoritative host', () => {
  const host = createWorld({ players: [{ ai: 1 }, { ai: null }] });
  const guest = host.players[1]!;
  host.phase = 'rally';
  host.ball.inPlay = false;
  const movePacket = parsePacket(JSON.parse(JSON.stringify(moveOf(1, { x: 1, z: 0 }))));
  assert.ok(movePacket?.k === 'mv');
  if (movePacket?.k !== 'mv') return;
  const startX = guest.x;
  const moveCommand = commandOf(movePacket, guest.seat);
  assert.ok(moveCommand);
  stepWorld(host, moveCommand ? [moveCommand] : [], STEP);
  assert.notEqual(guest.x, startX);

  host.ball.inPlay = true;
  host.ball.canHitTeam = guest.team;
  host.ball.targetTeam = 1 - guest.team;
  host.ball.p = { x: guest.x + 3, y: 8, z: guest.z + 1.1 };
  host.ball.prev = { ...host.ball.p };
  host.ball.v = { x: 0, y: 0, z: 0 };
  const swingPacket = parsePacket(JSON.parse(JSON.stringify(swingOf(1, host.ball.rallyShot, { kind: 'slice', aim: 0, delta: 0 }))));
  assert.ok(swingPacket?.k === 'sw');
  if (swingPacket?.k !== 'sw') return;
  const swingCommand = commandOf(swingPacket, guest.seat);
  assert.ok(swingCommand);
  stepWorld(host, swingCommand ? [swingCommand] : [], STEP);
  for (let i = 0; i < 35; i++) stepWorld(host, [], STEP);
  guest.input = { x: 0, z: 0 };
  guest.vx = 0;
  guest.vz = 0;
  guest.pending!.at = host.clock - 0.3 + STEP;
  host.ball.p = { x: guest.x + 0.75, y: 1, z: guest.z + 1.1 };
  host.ball.prev = { ...host.ball.p };
  const events = stepWorld(host, [], STEP);
  assert.ok(events.some((event) => event.type === 'hit' && event.seat === guest.seat));
});

test('scripted human wins enough 300-point rallies against easy and normal CPUs', () => {
  const easy = scriptedHumanPoints(0, 91);
  const normal = scriptedHumanPoints(1, 173);
  console.log(`scripted human: easy wins ${(easy.winRate * 100).toFixed(1)}%, average ${easy.averageRally.toFixed(2)} shots; normal wins ${(normal.winRate * 100).toFixed(1)}%, average ${normal.averageRally.toFixed(2)} shots`);
  assert.equal(easy.completed, 300);
  assert.equal(normal.completed, 300);
  assert.ok(easy.winRate >= 0.35, `easy win rate was ${(easy.winRate * 100).toFixed(1)}%`);
  assert.ok(normal.winRate >= 0.2, `normal win rate was ${(normal.winRate * 100).toFixed(1)}%`);
  assert.ok(easy.averageRally >= 4, `easy average rally was ${easy.averageRally.toFixed(2)} shots`);
  assert.ok(normal.averageRally >= 4, `normal average rally was ${normal.averageRally.toFixed(2)} shots`);
});
