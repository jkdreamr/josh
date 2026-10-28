import type * as T from 'three';
import { FIELD, teamDir, teamOf, type Team, type World } from './logic.ts';
import { createBall, stepBall, type BallState } from './physics.ts';
import { createReplayWorld } from './replay.ts';

export type FxKind = 'shot' | 'finesse' | 'volley' | 'through' | 'touch' | 'slide' | 'slide-dust' | 'tackle' | 'save' | 'post' | 'goal' | 'goal-impact';
export type FxEvent = {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  power: number;
  team: Team;
  t: number;
  playerId: number;
  finesse: boolean;
  grounded: boolean;
  inNet: boolean;
  debug: boolean;
};

const EVENT_CAPACITY = 16;
const RING_CAPACITY = 32;
const SAMPLE_STRIDE = 1 + 22 * 5 + 6;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);

export type FxDirector = {
  readonly timeScale: number;
  readonly animScale: number;
  readonly shake: number;
  readonly shakeX: number;
  readonly shakeY: number;
  readonly punch: number;
  readonly nudgeX: number;
  readonly goalPending: boolean;
  observe(world: World, simTime: number): void;
  tick(dt: number): void;
  renderWorld(current: World): World;
  drain(fn: (event: FxEvent) => void): void;
  replayProgress(progress: number): number;
  goalImpact(): void;
  setReducedMotion(on: boolean): void;
  trigger(kind: string, world: World, simTime: number): void;
  reset(): void;
};

export function createFxDirector(opts: { reducedMotion?: boolean } = {}): FxDirector {
  const events: FxEvent[] = Array.from({ length: EVENT_CAPACITY }, () => ({
    kind: 'touch', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
    power: 0, team: 0, t: 0, playerId: -1, finesse: false, grounded: true, inNet: false, debug: false,
  }));
  const samples = new Float32Array(RING_CAPACITY * SAMPLE_STRIDE);
  const previousActions = new Array<string>(22).fill('');
  const previousSlideWon = new Uint8Array(22);
  const slideDustAt = new Float64Array(22);
  const previousBall = new Float64Array(6);
  const previousScore = new Int16Array(2);
  let eventHead = 0;
  let eventCount = 0;
  let sampleHead = 0;
  let sampleCount = 0;
  let previousEvent = '';
  let previousKickPlayer = -2;
  let previousKickTime = -1;
  let previousKickAction = '';
  let previousSimTime = 0;
  let latestSimTime = 0;
  let displayTime = 0;
  let displayed = false;
  let following = true;
  let lastTouchAt = -Infinity;
  let timeScale = 1;
  let hitStopRemaining = 0;
  let hitStopDuration = 0;
  let shake = 0;
  let shakeClock = 0;
  let shakeX = 0;
  let shakeY = 0;
  let punch = 0;
  let punchPeak = 0;
  let punchTime = 0;
  let nudgeX = 0;
  let nudgeFrom = 0;
  let nudgeTarget = 0;
  let nudgeTime = 0;
  let goalPending = false;
  let reducedMotion = !!opts.reducedMotion;
  let pooledWorld: World | null = null;
  let observedWorld: World | null = null;

  slideDustAt.fill(-Infinity);

  const armHitStop = (duration: number) => {
    if (duration <= hitStopRemaining) return;
    hitStopRemaining = duration;
    hitStopDuration = duration;
  };

  const armPunch = (amount: number) => {
    if (amount >= punchPeak && punchTime > 0) return;
    punchPeak = amount;
    punchTime = 0;
    punch = amount;
  };

  const applyEvent = (kind: FxKind, power: number, team: Team, swapped: boolean) => {
    if (kind === 'goal-impact') {
      if (reducedMotion) return;
      armHitStop(0.09);
      shake = Math.max(shake, 0.16);
      armPunch(-3.4);
      return;
    }
    if (reducedMotion) {
      if (kind === 'through') {
        nudgeX = 0;
        nudgeTarget = 0;
      }
      return;
    }
    if ((kind === 'shot' || kind === 'finesse') && power >= 0.75) {
      armHitStop(0.06);
      shake = Math.max(shake, 0.05 * power);
      if (power > 0.8) armPunch(-1.2);
    } else if (kind === 'volley') {
      armHitStop(0.075);
      shake = Math.max(shake, 0.07);
      armPunch(-1.4);
    } else if (kind === 'save' && power >= 0.75) {
      armHitStop(0.07);
      shake = Math.max(shake, 0.08);
    } else if (kind === 'post') {
      armHitStop(0.055);
      shake = Math.max(shake, 0.12);
      armPunch(-1.6);
    }
    if (kind === 'through') {
      nudgeFrom = nudgeX;
      nudgeTarget = 3.5 * teamDir(team, swapped);
      nudgeTime = 0;
    }
  };

  const queueEvent = (
    kind: FxKind,
    world: World,
    simTime: number,
    power = 0,
    team: Team = 0,
    playerId = -1,
    finesse = false,
    x = world.ball.x,
    y = world.ball.y,
    z = world.ball.z,
    vx = world.ball.vx,
    vy = world.ball.vy,
    vz = world.ball.vz,
    spin = world.ball.spin,
    grounded = world.ball.grounded,
    inNet = world.ball.inNet,
    swapped = world.endsSwapped,
    debug = false,
  ) => {
    if (eventCount === EVENT_CAPACITY) {
      eventHead = (eventHead + 1) % EVENT_CAPACITY;
      eventCount--;
    }
    const index = (eventHead + eventCount) % EVENT_CAPACITY;
    const event = events[index]!;
    event.kind = kind;
    event.x = x;
    event.y = y;
    event.z = z;
    event.vx = vx;
    event.vy = vy;
    event.vz = vz;
    event.spin = spin;
    event.power = power;
    event.team = team;
    event.t = simTime;
    event.playerId = playerId;
    event.finesse = finesse;
    event.grounded = grounded;
    event.inNet = inNet;
    event.debug = debug;
    eventCount++;
    applyEvent(kind, power, team, swapped);
  };

  const storeSample = (world: World, simTime: number) => {
    if (sampleCount === RING_CAPACITY) {
      sampleHead = (sampleHead + 1) % RING_CAPACITY;
      sampleCount--;
    }
    const slot = (sampleHead + sampleCount) % RING_CAPACITY;
    let offset = slot * SAMPLE_STRIDE;
    samples[offset++] = simTime;
    for (let i = 0; i < 22; i++) {
      const player = world.players[i]!;
      samples[offset++] = player.x;
      samples[offset++] = player.z;
      samples[offset++] = player.vx;
      samples[offset++] = player.vz;
      samples[offset++] = player.facing;
    }
    const ball = world.ball;
    samples[offset++] = ball.x;
    samples[offset++] = ball.y;
    samples[offset++] = ball.z;
    samples[offset++] = ball.vx;
    samples[offset++] = ball.vy;
    samples[offset] = ball.vz;
    sampleCount++;
    latestSimTime = simTime;
    if (!displayed) {
      displayTime = simTime;
      displayed = true;
    }
  };

  const observe = (world: World, simTime: number) => {
    observedWorld = world;
    const ball = world.ball;
    const kick = world.kickEvent;
    const newKick = !!kick && (
      kick.playerId !== previousKickPlayer
      || kick.time !== previousKickTime
      || kick.action !== previousKickAction
    );
    const keeperEvent = world.event !== previousEvent && (world.event === 'keeper parries' || world.event === 'keeper claims it');

    if (newKick && kick) {
      const team = teamOf(kick.playerId);
      const volley = previousBall[1]! > 0.45 && (kick.action === 'shoot' || kick.action === 'finesse');
      if (kick.action === 'shoot' || kick.action === 'finesse') {
        const kind: FxKind = volley ? 'volley' : kick.action === 'finesse' ? 'finesse' : 'shot';
        queueEvent(kind, world, simTime, kick.power, team, kick.playerId, kick.action === 'finesse');
      } else if (kick.action === 'through') {
        queueEvent('through', world, simTime, kick.power, team, kick.playerId);
      } else if ((kick.action === 'pass' || kick.action === 'lob') && kick.power > 0.75) {
        queueEvent('touch', world, simTime, kick.power, team, kick.playerId);
      }
    }

    for (let i = 0; i < 22; i++) {
      const player = world.players[i]!;
      const slideWon = player.slide?.won ? 1 : 0;
      if (player.action === 'slide' && previousActions[i] !== 'slide') {
        queueEvent('slide', world, simTime, 0, player.team, player.id, false, player.x, 0, player.z, player.vx, 0, player.vz, 0);
        slideDustAt[i] = simTime;
      }
      if (player.action === 'slide' && simTime - slideDustAt[i]! >= 0.06) {
        queueEvent('slide-dust', world, simTime, 0, player.team, player.id, false, player.x, 0, player.z, player.vx, 0, player.vz, 0);
        slideDustAt[i] = simTime;
      }
      if (player.action === 'tackle' && previousActions[i] !== 'tackle') {
        queueEvent('tackle', world, simTime, 0, player.team, player.id, false, player.x, 0, player.z, player.vx, 0, player.vz, 0);
      }
      if (!previousSlideWon[i] && slideWon) {
        queueEvent('tackle', world, simTime, 0, player.team, player.id, false, player.x, 0, player.z, player.vx, 0, player.vz, 0);
      }
      previousActions[i] = player.action;
      previousSlideWon[i] = slideWon;
    }

    if (keeperEvent) {
      const speed = Math.hypot(previousBall[3]!, previousBall[4]!, previousBall[5]!);
      if (world.event === 'keeper parries') queueEvent('save', world, simTime, 1, 0);
      else if (speed > 12) queueEvent('save', world, simTime, 0.5, 0);
    }

    const ballSpeed = Math.hypot(ball.vx, ball.vz);
    const previousSpeed = Math.hypot(previousBall[3]!, previousBall[5]!);
    const flipped = Math.sign(ball.vx) !== Math.sign(previousBall[3]!) && Math.abs(previousBall[3]!) > 6;
    const nearPost = Math.abs(Math.abs(ball.z) - FIELD.goalWidth / 2) < 0.35 || Math.abs(ball.y - FIELD.goalHeight) < 0.3;
    if (Math.abs(ball.x) > FIELD.length / 2 - 0.6 && flipped && nearPost && !keeperEvent) {
      queueEvent('post', world, simTime);
    }
    let nearPlayer = false;
    for (let i = 0; i < 22; i++) {
      const player = world.players[i]!;
      const dx = player.x - ball.x;
      const dz = player.z - ball.z;
      if (dx * dx + dz * dz < 1) {
        nearPlayer = true;
        break;
      }
    }
    if (!newKick && ball.grounded && Math.abs(ballSpeed - previousSpeed) > 5 && nearPlayer && simTime - lastTouchAt >= 0.25) {
      queueEvent('touch', world, simTime);
      lastTouchAt = simTime;
    }

    if (world.score[0] !== previousScore[0] || world.score[1] !== previousScore[1]) {
      const team: Team = world.score[0] > previousScore[0] ? 0 : 1;
      goalPending = true;
      queueEvent('goal', world, simTime, 1, team);
    }

    previousBall[0] = ball.x;
    previousBall[1] = ball.y;
    previousBall[2] = ball.z;
    previousBall[3] = ball.vx;
    previousBall[4] = ball.vy;
    previousBall[5] = ball.vz;
    previousScore[0] = world.score[0];
    previousScore[1] = world.score[1];
    previousEvent = world.event;
    previousKickPlayer = kick?.playerId ?? -2;
    previousKickTime = kick?.time ?? -1;
    previousKickAction = kick?.action ?? '';
    previousSimTime = simTime;
    storeSample(world, simTime);
  };

  const tick = (dt: number) => {
    const step = Math.max(0, dt);
    shakeClock += step;
    hitStopRemaining = Math.max(0, hitStopRemaining - step);
    timeScale = hitStopRemaining > 0
      ? hitStopRemaining > hitStopDuration * 0.4
        ? 0.12
        : 0.12 + 0.88 * smoothstep(1 - hitStopRemaining / (hitStopDuration * 0.4))
      : 1;
    shake *= Math.exp(-step / 0.12);
    shakeX = shake * (Math.sin(shakeClock * 31) + Math.sin(shakeClock * 47 + 1.7)) * 0.5;
    shakeY = shake * (Math.sin(shakeClock * 37 + 0.8) + Math.sin(shakeClock * 53 + 2.1)) * 0.5;
    punchTime += step;
    if (punchTime <= 0.08) punch = punchPeak * smoothstep(punchTime / 0.08);
    else if (punchTime <= 0.58) punch = punchPeak * (1 - smoothstep((punchTime - 0.08) / 0.5));
    else {
      punch = 0;
      punchPeak = 0;
    }
    nudgeTime += step;
    if (nudgeTime <= 0.3) {
      const amount = smoothstep(nudgeTime / 0.3);
      nudgeX = nudgeFrom + (nudgeTarget - nudgeFrom) * amount;
    } else if (nudgeTime <= 1.5) {
      nudgeX = nudgeTarget * (1 - smoothstep((nudgeTime - 0.3) / 1.2));
    } else {
      nudgeX = 0;
      nudgeTarget = 0;
      nudgeFrom = 0;
    }
    if (displayed) {
      const lag = latestSimTime - displayTime;
      if (lag > 1e-4) displayTime += step * (timeScale < 1 ? timeScale : 1.35);
      if (displayTime > latestSimTime) displayTime = latestSimTime;
      if (latestSimTime - displayTime > 0.12) displayTime = latestSimTime - 0.12;
    }
    following = hitStopRemaining <= 0 && latestSimTime - displayTime <= 1e-4;
    if (reducedMotion) {
      timeScale = 1;
      shake = 0;
      shakeX = 0;
      shakeY = 0;
      punch = 0;
      nudgeX = 0;
    }
  };

  const renderWorld = (current: World) => {
    if (following) {
      displayTime = latestSimTime;
      return current;
    }
    if (reducedMotion || current.phase !== 'live' || latestSimTime - displayTime < 1e-4 || sampleCount < 2) {
      if (current.phase !== 'live') displayTime = latestSimTime;
      return current;
    }
    if (!pooledWorld) pooledWorld = createReplayWorld(current);
    let beforeSlot = sampleHead;
    let afterSlot = sampleHead;
    let beforeTime = samples[sampleHead * SAMPLE_STRIDE]!;
    let afterTime = beforeTime;
    for (let i = 1; i < sampleCount; i++) {
      const slot = (sampleHead + i) % RING_CAPACITY;
      const time = samples[slot * SAMPLE_STRIDE]!;
      if (time <= displayTime) {
        beforeSlot = slot;
        beforeTime = time;
      }
      if (time >= displayTime) {
        afterSlot = slot;
        afterTime = time;
        break;
      }
      afterSlot = slot;
      afterTime = time;
    }
    const amount = afterTime > beforeTime ? clamp((displayTime - beforeTime) / (afterTime - beforeTime), 0, 1) : 0;
    const beforeOffset = beforeSlot * SAMPLE_STRIDE;
    const afterOffset = afterSlot * SAMPLE_STRIDE;
    let a = beforeOffset + 1;
    let b = afterOffset + 1;
    for (let i = 0; i < 22; i++) {
      const player = current.players[i]!;
      const rendered = pooledWorld.players[i]!;
      Object.assign(rendered, player);
      rendered.x = samples[a]! + (samples[b]! - samples[a]!) * amount;
      rendered.z = samples[a + 1]! + (samples[b + 1]! - samples[a + 1]!) * amount;
      rendered.vx = samples[a + 2]! + (samples[b + 2]! - samples[a + 2]!) * amount;
      rendered.vz = samples[a + 3]! + (samples[b + 3]! - samples[a + 3]!) * amount;
      rendered.facing = samples[a + 4]! + (samples[b + 4]! - samples[a + 4]!) * amount;
      a += 5;
      b += 5;
    }
    a = beforeOffset + 1 + 22 * 5;
    b = afterOffset + 1 + 22 * 5;
    Object.assign(pooledWorld.ball, current.ball);
    pooledWorld.ball.x = samples[a]! + (samples[b]! - samples[a]!) * amount;
    pooledWorld.ball.y = samples[a + 1]! + (samples[b + 1]! - samples[a + 1]!) * amount;
    pooledWorld.ball.z = samples[a + 2]! + (samples[b + 2]! - samples[a + 2]!) * amount;
    pooledWorld.ball.vx = samples[a + 3]! + (samples[b + 3]! - samples[a + 3]!) * amount;
    pooledWorld.ball.vy = samples[a + 4]! + (samples[b + 4]! - samples[a + 4]!) * amount;
    pooledWorld.ball.vz = samples[a + 5]! + (samples[b + 5]! - samples[a + 5]!) * amount;
    const players = pooledWorld.players;
    const ball = pooledWorld.ball;
    Object.assign(pooledWorld, current);
    pooledWorld.players = players;
    pooledWorld.ball = ball;
    return pooledWorld;
  };

  const drain = (fn: (event: FxEvent) => void) => {
    while (eventCount > 0) {
      const event = events[eventHead]!;
      eventHead = (eventHead + 1) % EVENT_CAPACITY;
      eventCount--;
      fn(event);
    }
  };

  const goalImpact = () => {
    if (!goalPending || !observedWorld) return;
    goalPending = false;
    queueEvent('goal-impact', observedWorld, previousSimTime, 1, 0, -1, false);
  };

  const replayProgress = (progress: number) => {
    const p = clamp(progress, 0, 1);
    const value = reducedMotion
      ? Math.min(1, p / 0.88)
      : p <= 0.5
        ? p * 1.5
        : p <= 0.88
          ? 0.75 + (p - 0.5) * (0.25 / 0.38)
          : 1;
    if (value >= 1) goalImpact();
    return value;
  };

  const setReducedMotion = (on: boolean) => {
    reducedMotion = on;
    if (on) {
      timeScale = 1;
      hitStopRemaining = 0;
      hitStopDuration = 0;
      shake = 0;
      shakeX = 0;
      shakeY = 0;
      punch = 0;
      punchPeak = 0;
      nudgeX = 0;
      nudgeFrom = 0;
      nudgeTarget = 0;
      nudgeTime = 0;
    }
  };

  const trigger = (kind: string, world: World, simTime: number) => {
    observedWorld = world;
    const actualKind: FxKind = kind === 'power-shot' ? 'shot'
      : kind === 'curl' ? 'finesse'
        : kind === 'phone-goal' ? 'goal'
          : kind === 'phone-shot' ? 'shot'
            : kind === 'dust' ? 'slide'
              : kind === 'save-weak' || kind === 'save-strong' ? 'save'
                : kind as FxKind;
    const power = kind === 'power-shot' ? 0.95 : kind === 'save-weak' ? 0.5 : kind === 'save-strong' ? 1 : 0.9;
    const playerId = world.controlled[0];
    let slidePlayer: World['players'][number] | undefined;
    if (actualKind === 'slide') {
      for (const player of world.players) {
        if (!slidePlayer || Math.hypot(world.ball.x - player.x, world.ball.z - player.z) < Math.hypot(world.ball.x - slidePlayer.x, world.ball.z - slidePlayer.z)) slidePlayer = player;
      }
    }
    const effectPlayerId = slidePlayer?.id ?? playerId;
    if (actualKind === 'goal') {
      goalPending = true;
      queueEvent('goal', world, simTime, 1, world.lastTouch);
      goalImpact();
      return;
    }
    if (!['shot', 'finesse', 'volley', 'through', 'touch', 'slide', 'slide-dust', 'tackle', 'save', 'post', 'goal-impact'].includes(actualKind)) return;
    const synthetic = kind === 'power-shot' || kind === 'curl' || kind === 'volley';
    const speed = Math.hypot(world.ball.vx, world.ball.vy, world.ball.vz);
    const vx = synthetic && speed < 9 ? 18 : world.ball.vx;
    const vz = synthetic && speed < 9 ? 3 : world.ball.vz;
    const x = slidePlayer?.x ?? world.ball.x;
    const y = actualKind === 'slide' ? 0.04 : world.ball.y;
    const z = slidePlayer?.z ?? world.ball.z;
    queueEvent(actualKind, world, simTime, power, teamOf(effectPlayerId), effectPlayerId, actualKind === 'finesse',
      x, y, z, vx, world.ball.vy, vz, world.ball.spin,
      world.ball.grounded, world.ball.inNet, world.endsSwapped, true);
  };

  const reset = () => {
    eventHead = 0;
    eventCount = 0;
    sampleHead = 0;
    sampleCount = 0;
    previousActions.fill('');
    previousSlideWon.fill(0);
    slideDustAt.fill(-Infinity);
    previousBall.fill(0);
    previousScore.fill(0);
    previousEvent = '';
    previousKickPlayer = -2;
    previousKickTime = -1;
    previousKickAction = '';
    previousSimTime = 0;
    latestSimTime = 0;
    displayTime = 0;
    displayed = false;
    following = true;
    lastTouchAt = -Infinity;
    timeScale = 1;
    hitStopRemaining = 0;
    hitStopDuration = 0;
    shake = 0;
    shakeClock = 0;
    shakeX = 0;
    shakeY = 0;
    punch = 0;
    punchPeak = 0;
    punchTime = 0;
    nudgeX = 0;
    nudgeFrom = 0;
    nudgeTarget = 0;
    nudgeTime = 0;
    goalPending = false;
    pooledWorld = null;
    observedWorld = null;
  };

  return {
    get timeScale() { return reducedMotion ? 1 : timeScale; },
    get animScale() { return reducedMotion ? 1 : timeScale; },
    get shake() { return reducedMotion ? 0 : shake; },
    get shakeX() { return reducedMotion ? 0 : shakeX; },
    get shakeY() { return reducedMotion ? 0 : shakeY; },
    get punch() { return reducedMotion ? 0 : punch; },
    get nudgeX() { return reducedMotion ? 0 : nudgeX; },
    get goalPending() { return goalPending; },
    observe,
    tick,
    renderWorld,
    drain,
    replayProgress,
    goalImpact,
    setReducedMotion,
    trigger,
    reset,
  };
}

export function phoneFx(previousScore: readonly [number, number], previousKickKey: string | null, world: World, team: Team) {
  if (world.score[team] > previousScore[team]) return 'goal-for' as const;
  if (world.score[1 - team]! > previousScore[1 - team]!) return 'goal-against' as const;
  const kick = world.kickEvent;
  if (!kick || (kick.action !== 'shoot' && kick.action !== 'finesse')) return null;
  const key = `${kick.playerId}:${kick.time}:${kick.action}`;
  return key !== previousKickKey && teamOf(kick.playerId) === team ? 'shot' as const : null;
}

export function haptic(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

export type FxLayer = {
  update(director: FxDirector, ball: T.Vector3, ballVel: Pick<BallState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>, camera: T.PerspectiveCamera, dt: number): void;
  warm(on: boolean): void;
  applyCamera(camera: T.PerspectiveCamera): void;
  restoreCamera(camera: T.PerspectiveCamera): void;
  dispose(): void;
};

export function createFxLayer(THREE: typeof import('three'), scene: T.Scene): FxLayer {
  const trailPoints = 24;
  const trailPositions = new Float32Array(trailPoints * 3);
  const trailPositionAttribute = new THREE.BufferAttribute(new Float32Array(trailPoints * 2 * 3), 3);
  const trailAlpha = new THREE.BufferAttribute(new Float32Array(trailPoints * 2), 1);
  const trailColors = new THREE.BufferAttribute(new Float32Array(trailPoints * 2 * 3), 3);
  const trailIndices = new Uint16Array((trailPoints - 1) * 6);
  for (let i = 0; i < trailPoints - 1; i++) {
    const offset = i * 6;
    const vertex = i * 2;
    trailIndices[offset] = vertex;
    trailIndices[offset + 1] = vertex + 1;
    trailIndices[offset + 2] = vertex + 2;
    trailIndices[offset + 3] = vertex + 1;
    trailIndices[offset + 4] = vertex + 3;
    trailIndices[offset + 5] = vertex + 2;
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', trailPositionAttribute);
  trailGeometry.setAttribute('alpha', trailAlpha);
  trailGeometry.setAttribute('color', trailColors);
  trailGeometry.setIndex(new THREE.BufferAttribute(trailIndices, 1));
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.5 } },
    vertexShader: 'attribute float alpha; attribute vec3 color; varying float vAlpha; varying vec3 vColor; void main(){ vAlpha=alpha; vColor=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uOpacity; varying float vAlpha; varying vec3 vColor; void main(){ gl_FragColor=vec4(vColor,vAlpha*uOpacity); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Mesh(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);
  const warmColor = new THREE.Color('#fff1d6');
  const finesseColor = new THREE.Color('#bfefff');
  let trailCount = 0;
  let trailAge = 1;
  let trailSampleTime = 0;
  let trailDebug = false;
  let trailTint = warmColor;

  const curlPositions = new Float32Array(24 * 3);
  const curlGeometry = new THREE.BufferGeometry();
  const curlAttribute = new THREE.BufferAttribute(curlPositions, 3);
  curlGeometry.setAttribute('position', curlAttribute);
  const curlMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.42 }, uPointScale: { value: 1 } },
    vertexShader: `
      uniform float uPointScale;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(0.1 * uPointScale / max(1.0, -mvPosition.z), 1.0, 8.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      void main() {
        float edge = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.15, 0.5, edge)) * uOpacity;
        gl_FragColor = vec4(0.75, 0.94, 1.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const curl = new THREE.Points(curlGeometry, curlMaterial);
  curl.frustumCulled = false;
  curl.visible = false;
  scene.add(curl);
  const scratchBall = createBall();
  let curlAge = 1;

  const puffTextureCanvas = document.createElement('canvas');
  puffTextureCanvas.width = 64;
  puffTextureCanvas.height = 64;
  const puffContext = puffTextureCanvas.getContext('2d')!;
  const puffGradient = puffContext.createRadialGradient(32, 32, 2, 32, 32, 31);
  puffGradient.addColorStop(0, 'rgba(255,255,255,0.72)');
  puffGradient.addColorStop(0.32, 'rgba(255,255,255,0.35)');
  puffGradient.addColorStop(1, 'rgba(255,255,255,0)');
  puffContext.fillStyle = puffGradient;
  puffContext.fillRect(0, 0, 64, 64);
  const puffTexture = new THREE.CanvasTexture(puffTextureCanvas);
  const puffGeometry = new THREE.PlaneGeometry(1, 1);
  const puffGroundQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const puffs: T.Mesh[] = [];
  const puffMaterials: T.MeshBasicMaterial[] = [];
  const puffLife = new Float32Array(32);
  const puffAgeAt = new Float32Array(32);
  const puffStart = new Float32Array(32 * 3);
  const puffVelocity = new Float32Array(32 * 2);
  const puffDust = new Uint8Array(32);
  let layerElapsed = 0;
  for (let i = 0; i < 32; i++) {
    const material = new THREE.MeshBasicMaterial({ map: puffTexture, color: '#9fbf7e', transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Mesh(puffGeometry, material);
    sprite.visible = false;
    scene.add(sprite);
    puffs.push(sprite);
    puffMaterials.push(material);
  }

  const ringGeometry = new THREE.RingGeometry(0.78, 1, 48);
  const rings: T.Mesh[] = [];
  const ringMaterials: T.MeshBasicMaterial[] = [];
  const ringStarted = new Float32Array(3);
  const ringLife = new Float32Array(3);
  const ringLook = new THREE.Vector3();
  let ringCursor = 0;
  for (let i = 0; i < 3; i++) {
    const material = new THREE.MeshBasicMaterial({ color: '#fff1d6', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    rings.push(mesh);
    ringMaterials.push(material);
  }

  const cameraPosition = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraWorldRight = new THREE.Vector3();
  const cameraWorldUp = new THREE.Vector3();
  const warmObjects = [trail, curl, ...puffs, ...rings];
  let warmVisibility: boolean[] | null = null;
  let savedFov = 0;
  let cameraApplied = false;
  let currentDirector: FxDirector | null = null;

  const puffCountFor = (event: FxEvent) => {
    if (event.kind === 'slide') return 3;
    if (event.kind === 'slide-dust') return 1;
    if (event.kind === 'tackle') return 3;
    if (event.kind === 'touch') return 2;
    if ((event.kind === 'shot' || event.kind === 'volley' || event.kind === 'finesse') && event.power >= 0.7) return 2;
    return 0;
  };

  const spawnPuff = (event: FxEvent, dust: boolean) => {
    let index = -1;
    let oldest = Infinity;
    for (let i = 0; i < 32; i++) {
      if (puffLife[i]! <= 0) {
        index = i;
        break;
      }
      if (puffAgeAt[i]! < oldest) {
        oldest = puffAgeAt[i]!;
        index = i;
      }
    }
    if (index < 0) return;
    const sprite = puffs[index]!;
    const material = puffMaterials[index]!;
    const base = index * 3;
    const velocity = index * 2;
    puffAgeAt[index] = layerElapsed;
    puffLife[index] = 0.5 + (index % 4) * 0.1;
    puffDust[index] = dust ? 1 : 0;
    const angle = index * 2.399963229728653;
    puffStart[base] = event.x + Math.cos(angle) * (dust ? 0.25 : 0);
    puffStart[base + 1] = event.y + (dust ? 0.04 : 0);
    puffStart[base + 2] = event.z + Math.sin(angle) * (dust ? 0.25 : 0);
    puffVelocity[velocity] = Math.cos(angle) * (dust ? 0.7 : 0.42);
    puffVelocity[velocity + 1] = Math.sin(angle) * (dust ? 0.7 : 0.42);
    material.color.set(dust ? '#c8b28a' : '#9fbf7e');
    material.opacity = dust ? 0.72 : 0.45;
    material.map = puffTexture;
    material.depthTest = true;
    sprite.position.set(event.x, event.y, event.z);
    sprite.scale.setScalar(dust ? 0.95 : 0.35);
    sprite.renderOrder = 0;
    sprite.visible = true;
  };

  const onEvent = (event: FxEvent) => {
    if (event.kind === 'shot' || event.kind === 'volley' || event.kind === 'finesse') {
      if (event.power >= 0.6 || event.finesse) {
        trailAge = 0;
        trailDebug = event.debug;
        trailSampleTime = event.debug ? layerElapsed : -1;
        trailCount = event.debug ? trailPoints : 0;
        trailTint = event.finesse ? finesseColor : warmColor;
        trail.visible = true;
        if (event.debug) {
          for (let i = 0; i < trailPoints; i++) {
            const offset = i * 3;
            const time = i * 0.025;
            trailPositions[offset] = event.x - event.vx * time;
            trailPositions[offset + 1] = event.y - event.vy * time;
            trailPositions[offset + 2] = event.z - event.vz * time;
          }
        }
      }
      if (event.finesse) {
        scratchBall.x = event.x;
        scratchBall.y = event.y;
        scratchBall.z = event.z;
        scratchBall.vx = event.vx;
        scratchBall.vy = event.vy;
        scratchBall.vz = event.vz;
        scratchBall.spin = event.spin;
        scratchBall.grounded = event.grounded;
        scratchBall.inNet = event.inNet;
        for (let i = 0; i < 24; i++) {
          stepBall(scratchBall, 0.05);
          const offset = i * 3;
          curlPositions[offset] = scratchBall.x;
          curlPositions[offset + 1] = scratchBall.y;
          curlPositions[offset + 2] = scratchBall.z;
        }
        curlAttribute.needsUpdate = true;
        curlAge = 0;
        curl.visible = true;
      }
    }
    if (event.kind === 'volley') {
      const index = ringCursor;
      ringCursor = (ringCursor + 1) % rings.length;
      const ring = rings[index]!;
      const material = ringMaterials[index]!;
      ringStarted[index] = layerElapsed;
      ringLife[index] = 0.28;
      ring.position.set(event.x, Math.max(event.y, 0.2), event.z);
      ringLook.set(event.x + event.vx, event.y + event.vy, event.z + event.vz);
      ring.lookAt(ringLook);
      ring.scale.setScalar(0.3);
      material.opacity = 0.45;
      ring.visible = true;
    }
    const count = puffCountFor(event);
    for (let i = 0; i < count; i++) spawnPuff(event, event.kind === 'slide' || event.kind === 'slide-dust');
  };

  const update = (
    director: FxDirector,
    ball: T.Vector3,
    ballVel: Pick<BallState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>,
    camera: T.PerspectiveCamera,
    dt: number,
  ) => {
    currentDirector = director;
    const step = Math.max(0, dt);
    layerElapsed += step;
    director.drain(onEvent);
    const speed = Math.hypot(ballVel.vx, ballVel.vy, ballVel.vz);
    trailAge += step;
    if (trail.visible) {
      if (trailAge > 0.9 || (speed < 9 && !trailDebug)) {
        trail.visible = false;
        trailCount = 0;
        trailDebug = false;
      } else if (trailSampleTime < 0 || layerElapsed - trailSampleTime >= 0.025) {
        if (trailCount < trailPoints) trailCount++;
        else trailPositions.copyWithin(3, 0, (trailPoints - 1) * 3);
        trailPositions[0] = ball.x;
        trailPositions[1] = ball.y;
        trailPositions[2] = ball.z;
        trailSampleTime = layerElapsed;
      }
      const positionArray = trailPositionAttribute.array as Float32Array;
      const alphaArray = trailAlpha.array as Float32Array;
      const colorArray = trailColors.array as Float32Array;
      for (let i = 0; i < trailCount; i++) {
        const point = i * 3;
        const previous = Math.max(0, i - 1) * 3;
        const next = Math.min(trailCount - 1, i + 1) * 3;
        const dx = trailPositions[previous]! - trailPositions[next]!;
        const dz = trailPositions[previous + 2]! - trailPositions[next + 2]!;
        const length = Math.hypot(dx, dz) || 1;
        const sideX = -dz / length;
        const sideZ = dx / length;
        const taper = 0.08 * (1 - i / Math.max(1, trailPoints - 1));
        const vertex = i * 2;
        positionArray[vertex * 3] = trailPositions[point]! + sideX * taper;
        positionArray[vertex * 3 + 1] = trailPositions[point + 1]!;
        positionArray[vertex * 3 + 2] = trailPositions[point + 2]! + sideZ * taper;
        positionArray[(vertex + 1) * 3] = trailPositions[point]! - sideX * taper;
        positionArray[(vertex + 1) * 3 + 1] = trailPositions[point + 1]!;
        positionArray[(vertex + 1) * 3 + 2] = trailPositions[point + 2]! - sideZ * taper;
        const alpha = 1 - i / Math.max(1, trailCount - 1);
        alphaArray[vertex] = alpha;
        alphaArray[vertex + 1] = alpha;
        for (let side = 0; side < 2; side++) {
          const colorOffset = (vertex + side) * 3;
          colorArray[colorOffset] = trailTint.r;
          colorArray[colorOffset + 1] = trailTint.g;
          colorArray[colorOffset + 2] = trailTint.b;
        }
      }
      trailPositionAttribute.needsUpdate = true;
      trailAlpha.needsUpdate = true;
      trailColors.needsUpdate = true;
      trailGeometry.setDrawRange(0, Math.max(0, (trailCount - 1) * 6));
    }
    if (curl.visible) {
      curlAge += step;
      curlMaterial.uniforms.uOpacity!.value = 0.42 * Math.max(0, 1 - curlAge / 0.5);
      if (curlAge >= 0.5) curl.visible = false;
    }
    curlMaterial.uniforms.uPointScale!.value = (window.innerHeight * (window.devicePixelRatio || 1)) / (2 * Math.tan(camera.fov * Math.PI / 360));
    for (let i = 0; i < 32; i++) {
      const life = puffLife[i]!;
      if (life <= 0) continue;
      const age = layerElapsed - puffAgeAt[i]!;
      const progress = Math.min(1, age / life);
      const base = i * 3;
      const velocity = i * 2;
      const sprite = puffs[i]!;
      sprite.quaternion.copy(puffDust[i] ? puffGroundQuaternion : camera.quaternion);
      sprite.position.set(
        puffStart[base]! + puffVelocity[velocity]! * age,
        puffStart[base + 1]! + (puffDust[i] ? 0.12 : 0.3) * progress,
        puffStart[base + 2]! + puffVelocity[velocity + 1]! * age,
      );
      sprite.scale.setScalar(puffDust[i] ? 0.95 + progress : 0.35 + 0.85 * progress);
      puffMaterials[i]!.opacity = (puffDust[i] ? 0.72 : 0.45) * (1 - progress);
      if (age >= life) {
        puffLife[i] = 0;
        sprite.visible = false;
      }
    }
    for (let i = 0; i < rings.length; i++) {
      const life = ringLife[i]!;
      if (life <= 0) continue;
      const age = layerElapsed - ringStarted[i]!;
      const progress = Math.min(1, age / life);
      rings[i]!.scale.setScalar(0.3 + 1.9 * progress);
      ringMaterials[i]!.opacity = 0.5 * (1 - progress);
      if (age >= life) {
        ringLife[i] = 0;
        rings[i]!.visible = false;
      }
    }
    void camera;
  };

  const applyCamera = (camera: T.PerspectiveCamera) => {
    if (!currentDirector) return;
    cameraPosition.copy(camera.position);
    savedFov = camera.fov;
    cameraWorldRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    cameraWorldUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    cameraRight.copy(cameraWorldRight).multiplyScalar(currentDirector.shakeX);
    cameraUp.copy(cameraWorldUp).multiplyScalar(currentDirector.shakeY);
    camera.position.add(cameraRight).add(cameraUp);
    camera.position.x += currentDirector.nudgeX;
    camera.fov += currentDirector.punch;
    camera.updateProjectionMatrix();
    cameraApplied = true;
  };

  const restoreCamera = (camera: T.PerspectiveCamera) => {
    if (!cameraApplied) return;
    camera.position.copy(cameraPosition);
    camera.fov = savedFov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    cameraApplied = false;
  };

  const dispose = () => {
    scene.remove(trail, curl);
    for (const sprite of puffs) scene.remove(sprite);
    for (const ring of rings) scene.remove(ring);
    trailGeometry.dispose();
    trailMaterial.dispose();
    curlGeometry.dispose();
    curlMaterial.dispose();
    for (const material of puffMaterials) material.dispose();
    for (const material of ringMaterials) material.dispose();
    ringGeometry.dispose();
    puffTexture.dispose();
  };

  const warm = (on: boolean) => {
    if (on) {
      if (warmVisibility) return;
      warmVisibility = warmObjects.map((object) => object.visible);
      for (const object of warmObjects) object.visible = true;
    } else if (warmVisibility) {
      warmObjects.forEach((object, index) => { object.visible = warmVisibility![index]!; });
      warmVisibility = null;
    }
  };

  return { update, warm, applyCamera, restoreCamera, dispose };
}
