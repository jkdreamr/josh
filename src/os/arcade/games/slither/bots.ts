import {
  BOOST_MIN, SPEED, angleDiff, maxTurnRate, nearbyBody, radiusOf,
  type BodyGrid, type Level, type Snake, type World,
} from './world.ts';

const VIEW = 660;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const direction = (x: number, y: number) => Math.atan2(y, x);

type Aim = { angle: number; target: Snake | null; distance: number; flee: boolean; encircle: boolean };

function chooseAim(world: World, snake: Snake, level: Level, rng: () => number): Aim {
  let pellet: { x: number; y: number; score: number } | null = null;
  for (const p of world.pellets) {
    const dx = p.x - snake.x;
    const dy = p.y - snake.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > VIEW * VIEW) continue;
    const d = Math.sqrt(distanceSquared);
    const turn = Math.abs(angleDiff(direction(dx, dy), snake.angle));
    const score = level === 'easy' ? d + turn * 45 - p.value * 2 : d / (0.8 + p.value * 0.16) + turn * (level === 'hard' ? 30 : 42);
    if (!pellet || score < pellet.score) pellet = { x: p.x, y: p.y, score };
  }

  let target: Snake | null = null;
  let targetD = VIEW + 1;
  let threat: Snake | null = null;
  let threatD = VIEW + 1;
  for (const other of world.snakes) {
    if (!other.alive || other === snake) continue;
    const d = Math.hypot(other.x - snake.x, other.y - snake.y);
    if (d > VIEW) continue;
    if (other.mass > snake.mass * 1.2 && d < threatD) {
      threat = other;
      threatD = d;
    }
    if (level === 'hard' && other.mass < snake.mass * 0.82 && d < targetD) {
      target = other;
      targetD = d;
    }
  }
  if (threat && threatD < 500 && (!target || threatD < targetD * 0.8)) {
    const away = direction(snake.x - threat.x, snake.y - threat.y);
    return { angle: away + (rng() - 0.5) * 0.12, target: threat, distance: threatD, flee: true, encircle: false };
  }
  if (target) {
    const lead = clamp(targetD / 260, 0.3, 1.25);
    const tx = target.x + target.vx * lead;
    const ty = target.y + target.vy * lead;
    let angle = direction(tx - snake.x, ty - snake.y);
    const encircle = snake.mass > target.mass * 1.9 && snake.mass > 34 && targetD < 420;
    if (encircle) {
      const around = direction(snake.x - target.x, snake.y - target.y);
      const sign = snake.id % 2 ? 1 : -1;
      const orbit = around + sign * 0.9;
      const orbitR = Math.max(75, Math.min(170, targetD * 0.62));
      const gx = target.x + Math.cos(orbit) * orbitR;
      const gy = target.y + Math.sin(orbit) * orbitR;
      angle = direction(gx - snake.x, gy - snake.y);
    }
    return { angle: angle + (level === 'easy' ? (rng() - 0.5) * 0.24 : 0), target, distance: targetD, flee: false, encircle };
  }
  if (pellet) return { angle: direction(pellet.x - snake.x, pellet.y - snake.y), target: null, distance: Math.hypot(pellet.x - snake.x, pellet.y - snake.y), flee: false, encircle: false };
  const toCenter = direction(-snake.x, -snake.y);
  return { angle: toCenter + (rng() - 0.5) * 0.4, target: null, distance: Infinity, flee: false, encircle: false };
}

function safeTime(world: World, snake: Snake, heading: number, grid: BodyGrid) {
  const turnRate = maxTurnRate(snake);
  const maxHeading = turnRate * 0.86;
  const turn = clamp(angleDiff(heading, snake.angle), -maxHeading, maxHeading);
  const desired = snake.angle + turn;
  const duration = 1.2;
  const samples = 16;
  let x = snake.x;
  let y = snake.y;
  let a = snake.angle;
  const speed = snake.mass > BOOST_MIN ? SPEED + 12 : SPEED;
  for (let i = 1; i <= samples; i++) {
    const dt = duration / samples;
    a += clamp(angleDiff(desired, a), -turnRate * dt, turnRate * dt);
    x += Math.cos(a) * speed * dt;
    y += Math.sin(a) * speed * dt;
    const margin = radiusOf(snake.mass) + 6;
    if (Math.hypot(x, y) + margin >= world.radius) return (i - 1) / samples;
    const nearby = nearbyBody(grid, x, y, margin + 28);
    for (const item of nearby) {
      if (item.snake === snake) continue;
      const reach = radiusOf(snake.mass) + radiusOf(item.snake.mass) + 5;
      const dx = x - item.point.x;
      const dy = y - item.point.y;
      if (dx * dx + dy * dy < reach * reach) return (i - 1) / samples;
    }
  }
  return 1;
}

/** Choose only from reachable headings that have a clear body and arena corridor. */
export function think(world: World, snake: Snake, level: Level, grid: BodyGrid, rng: () => number = world.random): { target: number; boost: boolean } {
  const aim = chooseAim(world, snake, level, rng);
  const maxOffset = maxTurnRate(snake) * 0.9;
  const candidates = 23;
  let chosen = snake.angle;
  let best = -Infinity;
  const weight = level === 'hard' ? 1.8 : level === 'normal' ? 1.25 : 0.78;
  for (let i = 0; i < candidates; i++) {
    const offset = -maxOffset + (2 * maxOffset * i) / (candidates - 1);
    const heading = snake.angle + offset;
    const survivable = safeTime(world, snake, heading, grid);
    const alignment = Math.cos(angleDiff(heading, aim.angle));
    const centerBias = Math.hypot(snake.x, snake.y) > world.radius * 0.7
      ? Math.cos(angleDiff(heading, Math.atan2(-snake.y, -snake.x))) * 0.25
      : 0;
    const score = survivable * 12 + alignment * weight + centerBias + (rng() - 0.5) * (level === 'easy' ? 0.055 : 0.012);
    if (score > best) {
      best = score;
      chosen = heading;
    }
  }
  const boost = snake.mass > BOOST_MIN && (
    (level === 'hard' && aim.target !== null && !aim.flee && aim.distance < 390) ||
    (aim.flee && aim.distance < 230) ||
    (level === 'normal' && aim.target !== null && aim.distance < 240 && rng() < 0.35)
  );
  return { target: chosen, boost };
}
