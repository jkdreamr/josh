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
  STRIKE_RADIUS,
  TOSS_START,
  classifyShot,
  createWorld,
  hitServe,
  isInCourt,
  isInServiceBox,
  movePlayer,
  predictContactPoint,
  predictLanding,
  scorePoint,
  serveSide,
  shouldSmash,
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
import { rallyCounterLabel } from '../src/os/arcade/games/tennis/replay.ts';

function instrumentedHumanPoints(level: Level, seed: number, targetPoints = 100) {
  let completed = 0;
  let humanWins = 0;
  let rallyShots = 0;
  let rallies = 0;
  let matchSeed = seed;
  const failures = { outsideZone: 0, height: 0, expired: 0, timingWhiff: 0 };
  const calls: Record<string, number> = {};
  const pointEnds: Record<string, number> = {};
  const landingSamples: Record<'human' | 'cpu', ReturnType<typeof predictLanding>[]> = { human: [], cpu: [] };
  let presses = 0;
  let hits = 0;
  while (completed < targetPoints) {
    const world = createWorld({
      level,
      length: 'three',
      players: [{ ai: null }, { ai: level }],
      seed: matchSeed++,
    });
    const human = world.players[0]!;
    let serveQueued = false;
    let currentRallyShots = 0;
    let lastHitter: 'human' | 'cpu' | null = null;
    let incomingShot = -1;
    let reactionAt = 0;
    let pressLead = 0.3;
    let pressed = false;
    let jitterState = matchSeed | 0;
    const jitter = () => {
      jitterState = (Math.imul(jitterState, 1664525) + 1013904223) | 0;
      return (jitterState >>> 0) / 4294967296;
    };
    for (let step = 0; step < 180_000 && world.phase !== 'done' && completed < targetPoints; step++) {
      const commands: Command[] = [];
      if (world.serverSeat === human.seat && world.phase === 'serve-ready' && !serveQueued) {
        commands.push({ seat: human.seat, toss: true });
        serveQueued = true;
      } else if (world.serverSeat === human.seat && world.phase === 'serve-toss' && world.serveClock >= 0.52) {
        commands.push({ seat: human.seat, serve: true, swing: { kind: 'drive', aim: 0, delta: 0 } });
      }
      if (world.phase === 'serve-ready' && world.serveNumber === 2) serveQueued = false;

      if ((world.phase === 'rally' || world.phase === 'serve-flight')
        && world.ball.inPlay && world.ball.canHitTeam === human.team) {
        if (incomingShot !== world.ball.rallyShot) {
          incomingShot = world.ball.rallyShot;
          reactionAt = world.clock + 0.25;
          pressLead = 0.3 + (jitter() - 0.5) * 0.3;
          pressed = false;
        }
        if (world.clock >= reactionAt) {
          const target = predictContactPoint(world.ball, human);
          const dx = target.x - human.x;
          const dz = target.z - human.z;
          const vx = world.ball.v.x - human.vx;
          const vz = world.ball.v.z - human.vz;
          const speedSq = vx ** 2 + vz ** 2;
          const timeToClosest = speedSq > 1e-6
            ? -((world.ball.p.x - human.x) * vx + (world.ball.p.z - human.z) * vz) / speedSq
            : 0;
          const moveLength = Math.hypot(dx, dz) || 1;
          commands.push({ seat: human.seat, move: { x: dx / moveLength, z: dz / moveLength } });
          if (world.phase === 'rally' && world.ball.bounces > 0
            && !pressed && !human.pending && timeToClosest >= 0 && timeToClosest <= pressLead) {
            commands.push({ seat: human.seat, swing: { kind: 'drive', aim: 0, delta: 0 } });
            pressed = true;
            presses++;
          }
        }
      }

      const pending = human.pending && { ...human.pending };
      const serverSeatBeforeStep = world.serverSeat;
      const events = stepWorld(world, commands, STEP);
      const humanHit = events.some((event) => event.type === 'hit' && event.seat === human.seat && !event.serve);
      if (humanHit) hits++;
      if (pending && !human.pending && !humanHit) {
        const receiving = world.ball.inPlay && world.ball.canHitTeam === human.team
          && (world.phase === 'rally' || (world.phase === 'serve-flight' && world.ball.bounces > 0));
        const distance = Math.hypot(world.ball.p.x - human.x, world.ball.p.z - human.z);
        const inHeight = world.ball.p.y >= 0.15 && world.ball.p.y <= 2.9;
        if (receiving && distance <= STRIKE_RADIUS && inHeight) {
          failures.timingWhiff++;
        } else if (receiving && distance > STRIKE_RADIUS) {
          failures.outsideZone++;
        } else if (receiving && !inHeight) {
          failures.height++;
        } else {
          failures.expired++;
        }
      }
      for (const event of events) {
        if (event.type === 'hit') {
          currentRallyShots++;
          lastHitter = event.seat === human.seat ? 'human' : 'cpu';
          const hitter = event.seat === human.seat ? 'human' : 'cpu';
          if (landingSamples[hitter].length < 3) {
            landingSamples[hitter].push(predictLanding(world.ball.p, world.ball.v, world.ball.spin));
          }
        } else if (event.type === 'call' && event.call === 'double fault') {
          lastHitter = serverSeatBeforeStep === human.seat ? 'human' : 'cpu';
        }
        else if (event.type === 'point') {
          completed++;
          if (event.winner === human.team) humanWins++;
          const callEvent = events.find((entry) => entry.type === 'call');
          const call = callEvent?.type === 'call' ? callEvent.call : world.lastCall || 'none';
          calls[call] = (calls[call] ?? 0) + 1;
          const halfWidth = (world.format === 'singles' ? SINGLES_WIDTH : DOUBLES_WIDTH) / 2;
          const reason = call === 'out'
            ? Math.abs(world.ball.p.z) > COURT_LENGTH / 2 + BALL_RADIUS ? 'out long'
              : Math.abs(world.ball.p.x) > halfWidth + BALL_RADIUS ? 'out wide' : 'wrong side'
            : call === 'point' ? currentRallyShots === 1 ? 'ace' : 'double bounce/unreachable'
              : call === 'fault' || call === 'double fault' ? 'serve fault'
                : call;
          const winner = event.winner === human.team ? 'human wins' : 'cpu wins';
          const hitter = world.ball.hitByTeam === human.team ? 'human' : 'cpu';
          const end = `${hitter} | ${reason} | shot ${currentRallyShots} | bounces ${world.ball.bounces} | ${winner}`;
          pointEnds[end] = (pointEnds[end] ?? 0) + 1;
          rallyShots += currentRallyShots;
          rallies++;
          currentRallyShots = 0;
          lastHitter = null;
          serveQueued = false;
          incomingShot = -1;
          pressed = false;
        }
      }
    }
    if (human.pending && completed >= targetPoints) failures.expired++;
  }
  return {
    completed,
    winRate: humanWins / completed,
    averageRally: rallyShots / rallies,
    presses,
    hits,
    failures,
    calls,
    pointEnds,
    landingSamples,
  };
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
  const apply = (name: 'idle' | 'toss' | 'forehand' | 'backhand' | 'slice' | 'lob', progress = 0) => {
    for (const bone of bones) bone.quaternion.copy(bindLocals.get(bone.name)!);
    root.updateMatrixWorld(true);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const bind = new Map(bones.map((bone) => [bone.name, rootWorld.clone().invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))]));
    const targets = new Map<string, THREE.Quaternion>();
    for (const bone of bones) {
      const parent = bone.parent;
      const parentName = parent?.isBone ? parent.name : null;
      const parentBind = parentName ? bind.get(parentName)! : parent ? rootWorld.clone().invert().multiply(parent.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Quaternion();
      const angle = debugPoseAngles(name, progress).get(bone.name) ?? [0, 0, 0];
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
  const handRight = bones.find((bone) => bone.name === 'hand_r')!;
  const forearmRight = bones.find((bone) => bone.name === 'lowerarm_r')!;
  const wrist = handRight.getWorldPosition(new THREE.Vector3());
  const elbow = forearmRight.getWorldPosition(new THREE.Vector3());
  const forearmAxis = wrist.sub(elbow).normalize();
  const handBindWorld = handRight.getWorldQuaternion(new THREE.Quaternion());
  const thumbSide = new THREE.Vector3(1, 0, 0).applyQuaternion(handBindWorld);
  const shaft = forearmAxis.addScaledVector(thumbSide, Math.tan(Math.PI / 6)).normalize();
  const stringsNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(handBindWorld);
  const racketX = shaft.clone().cross(stringsNormal).normalize();
  stringsNormal.crossVectors(racketX, shaft).normalize();
  const racketWorld = new THREE.Matrix4().makeBasis(racketX, shaft, stringsNormal);
  const racket = new THREE.Group();
  racket.position.set(0, 0.035, 0);
  racket.quaternion.copy(handBindWorld.invert().multiply(new THREE.Quaternion().setFromRotationMatrix(racketWorld)));
  handRight.add(racket);
  const racketHead = () => racket.localToWorld(new THREE.Vector3(0, 0.64, 0));
  apply('idle');
  assert.ok(get('hand_l').y < get('clavicle_l').y);
  assert.ok(get('hand_r').y < get('clavicle_r').y);
  apply('toss');
  assert.ok(get('hand_l').y > get('head').y);

  apply('forehand', 0.5);
  const forehandContact = racketHead();
  assert.ok(forehandContact.y > get('pelvis').y - 0.15, `forehand contact should reach waist height: ${forehandContact.y}`);
  assert.ok(forehandContact.y < get('pelvis').y + 0.45, `forehand contact should stay near waist height: ${forehandContact.y}`);
  assert.ok(forehandContact.z > 0.3, `forehand contact should be in front of the player: ${forehandContact.z}`);
  assert.ok(Math.abs(forehandContact.y - get('hand_r').y) < 0.35, 'forehand shaft should be near horizontal at contact');
  apply('backhand', 0.5);
  const backhandContact = racketHead();
  assert.ok(backhandContact.y > get('pelvis').y - 0.15, `backhand contact should reach waist height: ${backhandContact.y}`);
  assert.ok(backhandContact.y < get('pelvis').y + 0.45, `backhand contact should stay near waist height: ${backhandContact.y}`);
  assert.ok(backhandContact.z > 0.3, `backhand contact should be in front of the player: ${backhandContact.z}`);
  assert.ok(backhandContact.x < -0.2, `backhand contact should be on the opposite hitting side: ${backhandContact.x}`);
  assert.ok(Math.abs(backhandContact.y - get('hand_r').y) < 0.35, 'backhand shaft should be near horizontal at contact');
  const backhandGrip = racket.localToWorld(new THREE.Vector3(0, 0.12, 0));
  assert.ok(get('hand_l').distanceTo(backhandGrip) < 0.35, 'backhand should keep both hands on the racket grip');
  apply('slice', 0);
  const sliceStart = racketHead();
  apply('slice', 1);
  const sliceFinish = racketHead();
  assert.ok(sliceStart.y > sliceFinish.y + 0.2);
  assert.ok(sliceFinish.z > sliceStart.z);
  apply('lob', 0);
  const lobStart = racketHead();
  apply('lob', 1);
  const lobFinish = racketHead();
  assert.ok(lobFinish.y > lobStart.y + 0.2);
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
  assert.equal(world.match.points[1], 1);

  assert.deepEqual(timingQuality(-0.2).hit, true);
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

test('lateral movement keeps each player facing the opponent', () => {
  for (const team of [0, 1]) {
    const world = createWorld({ players: [{ ai: null }, { ai: null }] });
    const player = world.players[team]!;
    world.phase = 'rally';
    world.ball.inPlay = false;
    const facing = team === 0 ? Math.PI : 0;
    for (const x of [-1, 1]) {
      player.input = { x, z: 0 };
      for (let i = 0; i < 60; i++) movePlayer(world, player, STEP);
      assert.equal(player.facing, facing);
    }
  }
});

test('difficulty assist closes toward a predicted contact without overriding input', () => {
  const makeIncoming = (level: Level) => {
    const world = createWorld({ level });
    const player = world.players[0]!;
    const start = { x: player.x, z: player.z };
    world.phase = 'rally';
    world.ball.inPlay = true;
    world.ball.canHitTeam = player.team;
    world.ball.p = { x: player.x + 3, y: 1, z: player.z + 2 };
    world.ball.prev = { ...world.ball.p };
    world.ball.v = { x: 0, y: 0, z: 0 };
    return { world, player, start };
  };
  const easy = makeIncoming(0);
  const target = predictContactPoint(easy.world.ball, easy.player);
  assert.ok(target.x > easy.player.x && target.z > easy.player.z);
  movePlayer(easy.world, easy.player, STEP);
  assert.ok(easy.player.x > easy.start.x && easy.player.z > easy.start.z);

  const hard = makeIncoming(2);
  movePlayer(hard.world, hard.player, STEP);
  assert.equal(hard.player.x, hard.start.x);
  assert.equal(hard.player.z, hard.start.z);

  const opposing = makeIncoming(0);
  opposing.player.input = { x: -1, z: 0 };
  movePlayer(opposing.world, opposing.player, STEP);
  assert.ok(opposing.player.vx < 0);
});

test('buffered swings contact only in range and expire as whiffs', () => {
  const world = createWorld({ level: 2 });
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
  assert.equal(timingQuality(0.6).hit, true);

  const far = createWorld();
  far.level = 2;
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
  for (let i = 0; i < 72; i++) stepWorld(far, [], STEP);
  assert.ok(hitter.pending);
  for (let i = 0; i < 35; i++) stepWorld(far, [], STEP);
  assert.ok(hitter.pending);
  stepWorld(far, [], STEP);
  assert.equal(hitter.pending, null);
  assert.ok(hitter.swing > 0);
});

test('post-bounce returns connect when pressed 0–0.4 seconds before closest approach', () => {
  for (const secondsBeforeClosest of [0, 0.1, 0.2, 0.3, 0.4]) {
    const world = createWorld({ level: 2 });
    const player = world.players[0]!;
    world.phase = 'rally';
    world.clock = 1;
    world.ball.inPlay = true;
    world.ball.canHitTeam = player.team;
    world.ball.bounces = 1;
    world.ball.p = { x: player.x + secondsBeforeClosest * 3, y: 1, z: player.z };
    world.ball.prev = { ...world.ball.p };
    world.ball.v = { x: -3, y: 0, z: 0 };
    const events = stepWorld(world, [{ seat: player.seat, swing: { kind: 'drive', aim: 0, delta: 0 } }], STEP);
    const hit = events.find((event) => event.type === 'hit' && event.seat === player.seat);
    assert.ok(hit && hit.type === 'hit', `missed return with ${secondsBeforeClosest}s lead`);
    assert.ok(Number.isFinite(hit.delta ?? NaN));
  }
});

test('a rally stays live after the first bounce even if the ball passes the baseline', () => {
  const world = createWorld({ level: 2, players: [{ ai: null }, { ai: null }] });
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.canHitTeam = 1;
  world.ball.targetTeam = 1;
  world.ball.bounces = 1;
  world.ball.p = { x: 0, y: 1, z: -COURT_LENGTH / 2 - 0.49 };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: 0.2, z: -3 };

  const events = stepWorld(world, [], STEP);
  assert.equal(world.phase, 'rally');
  assert.equal(events.some((event) => event.type === 'point'), false);
});

test('a second bounce outside the court awards the rally to the hitter', () => {
  const world = createWorld({ level: 2, players: [{ ai: null }, { ai: null }] });
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.canHitTeam = 1;
  world.ball.targetTeam = 1;
  world.ball.bounces = 1;
  world.ball.p = { x: 0, y: BALL_RADIUS + 0.01, z: -COURT_LENGTH / 2 - 0.4 };
  world.ball.prev = { ...world.ball.p };
  world.ball.v = { x: 0, y: -2, z: -1 };

  const events = stepWorld(world, [], STEP);
  const point = events.find((event) => event.type === 'point');
  assert.ok(point && point.type === 'point');
  assert.equal(point.winner, world.ball.hitByTeam);
  assert.equal(world.lastCall, 'point');
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

test('predicted first bounce matches the simulated bounce within 15 cm', () => {
  const world = createWorld({ level: 2, players: [{ ai: null }, { ai: null }] });
  const from = { x: 0.8, y: 1.05, z: 8.6 };
  const target = { x: -1.3, z: -8.8 };
  const spin: Spin3 = { x: 0.8, y: 0.2, z: 42 };
  const velocity = solveShot(from, target, spin, 3.2);
  const predicted = predictLanding(from, velocity, spin);
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.canHitTeam = 1;
  world.ball.targetTeam = 1;
  world.ball.p = { ...from };
  world.ball.prev = { ...from };
  world.ball.v = { ...velocity };
  world.ball.spin = { ...spin };
  let actual: { x: number; z: number } | undefined;
  for (let i = 0; i < 900 && !actual; i++) {
    const events = stepWorld(world, [], STEP);
    const bounce = events.find((event) => event.type === 'bounce');
    if (bounce && bounce.type === 'bounce') actual = { x: bounce.x, z: bounce.z };
  }
  assert.ok(actual, 'simulation did not reach the first bounce');
  assert.ok(Math.hypot(predicted.x - actual.x, predicted.z - actual.z) <= 0.15,
    `predicted ${predicted.x.toFixed(3)}, ${predicted.z.toFixed(3)}; actual ${actual.x.toFixed(3)}, ${actual.z.toFixed(3)}`);
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

test('smash trigger and volley classification use the intended strike conditions', () => {
  assert.equal(shouldSmash(2.19), false);
  assert.equal(shouldSmash(2.2), true);
  assert.equal(shouldSmash(2.6, false), false);
  assert.equal(classifyShot('drive', 2.4, 9), 'smash');
  assert.equal(classifyShot('drive', 1.2, 5.9), 'volley');
  assert.equal(classifyShot('slice', 1.2, 5.9), 'slice');
});

test('Easy and Normal assisted smashes land inside the court', () => {
  for (const level of [0, 1] as const) {
    const world = createWorld({ level, players: [{ ai: null }, { ai: null }], seed: level + 300 });
    const player = world.players[0]!;
    world.phase = 'rally';
    world.ball.inPlay = true;
    world.ball.canHitTeam = player.team;
    world.ball.targetTeam = player.team;
    world.ball.p = { x: player.x, y: 2.4, z: player.z - 0.4 };
    world.ball.prev = { ...world.ball.p };
    world.ball.v = { x: 0, y: 0, z: -1 };
    player.pending = { kind: 'drive', at: world.clock, aim: 0 };
    const events = stepWorld(world, [], STEP);
    assert.ok(events.some((event) => event.type === 'hit' && event.kind === 'smash'), `level ${level} did not classify a floating ball as a smash`);
    const landing = predictLanding(world.ball.p, world.ball.v, world.ball.spin);
    assert.equal(landing.clearsNet, true);
    assert.equal(isInCourt(landing.x, landing.z, 'singles'), true);
  }
});

test('CPU shot variety varies by level and Normal/Hard tell lob, drop, crosscourt, and smash shots', () => {
  for (const level of [0, 1, 2] as const) {
    const world = createWorld({ level, players: [{ ai: level }, { ai: null }], seed: 800 + level });
    const cpu = world.players[0]!;
    world.players[1]!.z = 0;
    world.ball.p.y = 1;
    const counts = { drive: 0, slice: 0, lob: 0, smash: 0, volley: 0, angled: 0 };
    for (let index = 0; index < 800; index++) {
      const shot = chooseShot(world, cpu);
      counts[shot.kind]++;
      if (shot.aim !== 0) counts.angled++;
    }
    assert.ok(counts.drive > 0);
    if (level === 0) {
      assert.equal(counts.lob, 0);
      assert.equal(counts.smash, 0);
      assert.ok(counts.slice > 30);
    } else {
      assert.ok(counts.lob > 50, `level ${level} produced too few net lobs`);
      assert.ok(counts.slice > 35, `level ${level} produced too few drop shots`);
      assert.ok(counts.angled > 200, `level ${level} produced too few crosscourts`);
      world.ball.p.y = 2.4;
      assert.equal(chooseShot(world, cpu).kind, 'smash');
    }
  }
});

test('rally counter threshold is four shots', () => {
  assert.equal(rallyCounterLabel(3), '');
  assert.equal(rallyCounterLabel(4), 'Rally 4');
  assert.equal(rallyCounterLabel(11), 'Rally 11');
});

test('packets round-trip valid settings, swings, and host snapshots and reject bad ranges', () => {
  const config = configOf(4, 'doubles', 'three', 2);
  assert.deepEqual(parsePacket(config), { k: 'cfg', r: 4, format: 'doubles', length: 'three', level: 2 });
  const swing = swingOf(4, 7, { kind: 'slice', aim: -1, delta: -0.1, swipe: 400 });
  assert.equal(parsePacket(swing)?.k, 'sw');
  assert.equal(parsePacket({ ...swing, delta: 3 }), null);
  assert.equal(parsePacket({ ...swing, shot: -1 }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'cfg', r: 1, format: 'trios', length: 'game', level: 1 }), null);
  const smashPacket = parsePacket(swingOf(4, 8, { kind: 'smash', aim: 1, delta: 0 }));
  assert.equal(smashPacket?.k, 'sw');
  if (smashPacket?.k === 'sw') assert.equal(commandOf(smashPacket, 0)?.swing?.kind, 'smash');
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

test('instrumented 300-point human playability targets', () => {
  const easy = instrumentedHumanPoints(0, 91, 300);
  const normal = instrumentedHumanPoints(1, 173, 300);
  const hard = instrumentedHumanPoints(2, 287, 300);
  console.log(`gameplay diagnostics easy: ${(easy.winRate * 100).toFixed(1)}% wins, ${easy.averageRally.toFixed(2)} shots, ${easy.hits}/${easy.presses} returns, ${JSON.stringify(easy.failures)}`);
  console.log(`gameplay diagnostics normal: ${(normal.winRate * 100).toFixed(1)}% wins, ${normal.averageRally.toFixed(2)} shots, ${normal.hits}/${normal.presses} returns, ${JSON.stringify(normal.failures)}`);
  console.log(`gameplay diagnostics hard: ${(hard.winRate * 100).toFixed(1)}% wins, ${hard.averageRally.toFixed(2)} shots, ${hard.hits}/${hard.presses} returns, ${JSON.stringify(hard.failures)}`);
  console.log(`gameplay point ends: ${JSON.stringify({ easy: easy.pointEnds, normal: normal.pointEnds, hard: hard.pointEnds })}`);
  console.log(`gameplay landing samples: ${JSON.stringify({ easy: easy.landingSamples, normal: normal.landingSamples, hard: hard.landingSamples })}`);
  assert.equal(easy.completed, 300);
  assert.equal(normal.completed, 300);
  assert.equal(hard.completed, 300);
  assert.ok(easy.winRate >= 0.55, `easy win rate was ${(easy.winRate * 100).toFixed(1)}%`);
  assert.ok(normal.winRate >= 0.4 && normal.winRate <= 0.7,
    `normal win rate was ${(normal.winRate * 100).toFixed(1)}%`);
  assert.ok(easy.averageRally >= 5, `easy average rally was ${easy.averageRally.toFixed(2)} shots`);
  assert.ok(normal.averageRally >= 5, `normal average rally was ${normal.averageRally.toFixed(2)} shots`);
  assert.ok(easy.winRate >= normal.winRate, 'Easy should be at least as winnable as Normal');
  assert.ok(normal.winRate >= hard.winRate, 'Normal should be at least as winnable as Hard');
});
