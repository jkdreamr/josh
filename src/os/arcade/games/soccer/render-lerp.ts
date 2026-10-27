import type { World } from './logic.ts';

export type Snapshot = {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  facing: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  ball: Float32Array;
};

export function createSnapshot(world: World): Snapshot {
  return {
    x: new Float32Array(world.players.length),
    y: new Float32Array(world.players.length),
    z: new Float32Array(world.players.length),
    facing: new Float32Array(world.players.length),
    vx: new Float32Array(world.players.length),
    vz: new Float32Array(world.players.length),
    ball: new Float32Array(3),
  };
}

export function captureSnapshot(world: World, snapshot: Snapshot) {
  for (let i = 0; i < world.players.length; i++) {
    const player = world.players[i]!;
    snapshot.x[i] = player.x;
    snapshot.y[i] = 'y' in player ? Number(player.y) : 0;
    snapshot.z[i] = player.z;
    snapshot.facing[i] = player.facing;
    snapshot.vx[i] = player.vx;
    snapshot.vz[i] = player.vz;
  }
  snapshot.ball[0] = world.ball.x;
  snapshot.ball[1] = world.ball.y;
  snapshot.ball[2] = world.ball.z;
  return snapshot;
}

const lerp = (a: number, b: number, alpha: number) => a + (b - a) * alpha;
const angleDelta = (from: number, to: number) => {
  const difference = (to - from + Math.PI) % (Math.PI * 2);
  return (difference < 0 ? difference + Math.PI * 2 : difference) - Math.PI;
};

export function interpolateInto(out: World, prev: Snapshot, current: World, alpha: number) {
  const t = Math.max(0, Math.min(1, alpha));
  const outWorld = out as unknown as Record<string, unknown>;
  const currentWorld = current as unknown as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    if (key !== 'players' && key !== 'ball') outWorld[key] = currentWorld[key];
  }
  for (let i = 0; i < current.players.length; i++) {
    const from = prev.x[i]!;
    const fromZ = prev.z[i]!;
    const to = current.players[i]!;
    const player = out.players[i]!;
    Object.assign(player, to);
    const snap = Math.hypot(to.x - from, to.z - fromZ) > 3;
    player.x = snap ? to.x : lerp(from, to.x, t);
    player.z = snap ? to.z : lerp(fromZ, to.z, t);
    player.facing = snap ? to.facing : prev.facing[i]! + angleDelta(prev.facing[i]!, to.facing) * t;
    player.vx = snap ? to.vx : lerp(prev.vx[i]!, to.vx, t);
    player.vz = snap ? to.vz : lerp(prev.vz[i]!, to.vz, t);
    if ('y' in to) {
      const y = (to as typeof to & { y: number }).y;
      (player as typeof player & { y: number }).y = snap ? y : lerp(prev.y[i]!, y, t);
    }
  }
  Object.assign(out.ball, current.ball);
  const ballSnap = Math.hypot(
    current.ball.x - prev.ball[0]!,
    current.ball.y - prev.ball[1]!,
    current.ball.z - prev.ball[2]!,
  ) > 3;
  out.ball.x = ballSnap ? current.ball.x : lerp(prev.ball[0]!, current.ball.x, t);
  out.ball.y = ballSnap ? current.ball.y : lerp(prev.ball[1]!, current.ball.y, t);
  out.ball.z = ballSnap ? current.ball.z : lerp(prev.ball[2]!, current.ball.z, t);
  return out;
}
