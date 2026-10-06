// Pure rules for Palm Drive: lanes, traffic spawning, collisions and scoring. No DOM, no three.js.
export const LANES = 3;
export const LANE_W = 2.3;
export const CAR_W = 1.7;
export const CAR_L = 3.8;
export const CONE_R = 0.45;
export const SPAWN_Z = 120;
export const MIN_SPEED = 14;
export const MAX_SPEED = 44;
export const ACCEL = 0.55;
export const ONCOMING = 9;

export type Kind = 'car' | 'cone';
export type Obstacle = { id: number; kind: Kind; lane: number; z: number; speed: number; hue: number };
export type State = {
  lane: number;
  x: number;
  speed: number;
  dist: number;
  time: number;
  obstacles: Obstacle[];
  nextSpawn: number;
  nextId: number;
  crashed: boolean;
  crashedWith: Obstacle | null;
};

export type Rng = () => number;

export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_W;

export function create(): State {
  return { lane: 1, x: 0, speed: MIN_SPEED, dist: 0, time: 0, obstacles: [], nextSpawn: 40, nextId: 1, crashed: false, crashedWith: null };
}

export function steer(s: State, dir: -1 | 1) {
  if (s.crashed) return;
  s.lane = Math.min(LANES - 1, Math.max(0, s.lane + dir));
}

/** Gap in meters between waves; tightens as you go. */
export const gapFor = (dist: number) => Math.max(22, 48 - dist / 60);

/** One wave of 1 or 2 obstacles, always leaving at least one lane open. */
export function spawnWave(s: State, rng: Rng = Math.random): Obstacle[] {
  const count = dist2(s.dist) && rng() < 0.55 ? 2 : 1;
  const lanes = [0, 1, 2].sort(() => rng() - 0.5).slice(0, count);
  const wave: Obstacle[] = lanes.map((lane) => {
    const kind: Kind = rng() < 0.6 ? 'car' : 'cone';
    return { id: s.nextId++, kind, lane, z: SPAWN_Z + (kind === 'cone' ? rng() * 6 : 0), speed: kind === 'car' ? ONCOMING + rng() * 4 : 0, hue: Math.floor(rng() * 360) };
  });
  s.obstacles.push(...wave);
  return wave;
}
const dist2 = (d: number) => d > 150;

/** Does the player's car at lateral position x touch this obstacle? */
export function hits(x: number, o: Obstacle): boolean {
  const ox = laneX(o.lane);
  if (o.kind === 'car') return Math.abs(o.z) < CAR_L && Math.abs(ox - x) < CAR_W;
  return Math.abs(o.z) < CAR_L / 2 + CONE_R && Math.abs(ox - x) < CAR_W / 2 + CONE_R;
}

export function step(s: State, dt: number, rng: Rng = Math.random) {
  if (s.crashed) return;
  s.time += dt;
  s.speed = Math.min(MAX_SPEED, s.speed + ACCEL * dt);
  const adv = s.speed * dt;
  s.dist += adv;
  const tx = laneX(s.lane);
  s.x += (tx - s.x) * Math.min(1, dt * 9);
  for (const o of s.obstacles) o.z -= adv + o.speed * dt;
  s.obstacles = s.obstacles.filter((o) => o.z > -12);
  s.nextSpawn -= adv;
  if (s.nextSpawn <= 0) {
    spawnWave(s, rng);
    s.nextSpawn = gapFor(s.dist);
  }
  for (const o of s.obstacles) {
    if (hits(s.x, o)) {
      s.crashed = true;
      s.crashedWith = o;
      break;
    }
  }
}

export const score = (s: State) => Math.floor(s.dist);
export const kmh = (s: State) => Math.round(s.speed * 3.6);
