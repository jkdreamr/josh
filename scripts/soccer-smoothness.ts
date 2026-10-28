import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from '../src/os/arcade/games/soccer/logic.ts';
import type { CameraGoal } from '../src/os/arcade/games/soccer/camera.ts';

// Optional checkout argument lets the identical fixtures run against the pre-spring scene.
const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const url = (file: string) => pathToFileURL(resolve(root, file)).href;
const THREE = await import(url('src/os/arcade/kit/three-lib.ts')) as typeof import('../src/os/arcade/kit/three-lib.ts');
const { createWorld, movePlayer, stepWorld, STEP, FIELD, teamDir } = await import(url('src/os/arcade/games/soccer/logic.ts')) as typeof import('../src/os/arcade/games/soccer/logic.ts');
const { computeAI } = await import(url('src/os/arcade/games/soccer/ai.ts')) as typeof import('../src/os/arcade/games/soccer/ai.ts');
const source = readFileSync(resolve(root, 'src/os/arcade/games/soccer/scene.ts'), 'utf8');
let cameraUpdate: (world: ReturnType<typeof createWorld>, dt: number) => CameraGoal;
if (source.includes('createCameraRig')) {
  const { broadcastGoal, createCameraRig, stepCameraRig } = await import(url('src/os/arcade/games/soccer/camera.ts')) as typeof import('../src/os/arcade/games/soccer/camera.ts');
  const rig = createCameraRig();
  cameraUpdate = (world, dt) => {
    stepCameraRig(rig, broadcastGoal(world, 0, 16 / 9), dt);
    return { position: { ...rig.position }, target: { ...rig.target.value }, fov: rig.zoom.value.x };
  };
} else {
  const declarations = source.slice(source.indexOf('  const target = new THREE.Vector3'), source.indexOf('  const debug = typeof location'));
  const body = source.slice(source.indexOf('    const portrait = camera.aspect'), source.indexOf('    frustumMatrix.multiplyMatrices'));
  if (!declarations || !body) throw new Error('Unsupported baseline scene camera');
  const legacy = `const camera = new THREE.PerspectiveCamera(34, 16/9, .1, 180);
    const cameraDirection = new THREE.Vector3(), actors = new Map();
    let lastViewBasis, introStartedAt = null;
    const reticle = {rotation:{set(){}}, scale:{setScalar(){}},position:{set(){}}};
    ${declarations}
    return (world, dt) => {
      const cameraMode = 'broadcast', humanTeam = 0, time = 0;
      const controlledPlayer = world.players.find(p => p.id === world.controlled[0]);
      ${body}
      return {position:camera.position.clone(), target:lookAt.clone(), fov:camera.fov};
    };`;
  cameraUpdate = new Function('THREE', 'FIELD', 'teamDir', 'damp',
    stripTypeScriptTypes(`function setup(){${legacy}}`).concat('\nreturn setup();'))(
    THREE, FIELD, teamDir, (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt)));
}

const world = createWorld(); world.phase = 'live'; world.restart = null;
world.players[6]!.x = world.players[6]!.z = 0;
world.players[8]!.x = 35; world.players[8]!.z = 25;
let last = cameraUpdate(world, 0), switchMax = 0, passMax = 0, lookMax = 0;
const gap = (a: CameraGoal['position'], b: CameraGoal['position']) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
for (let frame = 0; frame < 480; frame++) {
  if (frame === 120) world.controlled[0] = 8;
  if (frame >= 240 && frame < 300) { world.ball.vx = 20; world.ball.x += 20 * STEP; }
  else world.ball.vx = 0;
  if (frame === 300) world.controlled[0] = 6;
  const next = cameraUpdate(world, STEP);
  if (frame >= 120 && frame < 240) switchMax = Math.max(switchMax, gap(last.position, next.position));
  if (frame >= 240) passMax = Math.max(passMax, gap(last.position, next.position));
  if (frame >= 120) lookMax = Math.max(lookMax, gap(last.target, next.target));
  last = next;
}

const switches: number[] = [];
for (const seed of [1, 7, 42, 71423, 9142]) {
  const w = createWorld(seed, 120), ai = [new Map(), new Map()];
  let changes = 0;
  for (let tick = 0; tick < 3600; tick++) {
    const commands = new Map<number, Command>();
    for (const team of [0, 1] as const) {
      for (const [id, command] of computeAI(w, 'normal', STEP, tick, team, ai[team])) commands.set(id, command);
    }
    const player = w.players[w.controlled[0]]!, distance = Math.hypot(w.ball.x - player.x, w.ball.z - player.z);
    commands.set(player.id, {
      move: { x: (w.ball.x - player.x) / Math.max(1.4, distance), z: (w.ball.z - player.z) / Math.max(1.4, distance) }, sprint: distance > 3,
      ...(distance < 0.64 && tick % 90 === 0 ? { action: 'pass', pressed: true, power: 0.45, aim: { x: 1, z: 0 } } : {}),
    });
    const before = w.controlled[0]; stepWorld(w, STEP, commands);
    if (w.controlled[0] !== before) changes++;
  }
  switches.push(changes);
}
const player = createWorld().players[6]!; player.x = player.z = 0;
let first = 0, jog = 0;
for (let frame = 1; frame <= 30; frame++) {
  movePlayer(player, { x: 1, z: 0 }, false, false, STEP);
  if (!first && player.x > 0.001) first = frame;
  if (!jog && player.vx >= 7 - 1e-9) jog = frame;
}
console.log(JSON.stringify({ switchMax, passMax, lookMax, switches, changesPerMinute: switches.reduce((a, b) => a + b, 0) / switches.length,
  firstMovementMs: first * STEP * 1000, jogMs: jog * STEP * 1000 }, null, 2));
