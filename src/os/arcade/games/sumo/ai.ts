import { CAR_RADIUS, type Car, type Input, type Level, type World } from './logic.ts';

const margins = [3, 2.2, 1.6] as const;
const rethink = [0.45, 0.2, 0.08] as const;
const noises = [Math.PI / 7.2, Math.PI / 18, 0] as const;

const unit = (x: number, y: number): Input => {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length, dash: false } : { x, y, dash: false };
};

function aimAt(world: World, car: Car, level: Level, rng: () => number) {
  const opponents = world.cars.filter((other) => other.id !== car.id && !other.out && !other.falling);
  if (!opponents.length) {
    car.aiTarget = -1;
    car.aiAimX = 0;
    car.aiAimZ = 0;
    return;
  }
  const ranked = opponents
    .map((other) => ({ other, distance: Math.hypot(other.x - car.x, other.z - car.z) }))
    .sort((a, b) => level === 2 ? Math.hypot(b.other.x, b.other.z) - Math.hypot(a.other.x, a.other.z) : a.distance - b.distance);
  const target = level === 0 ? ranked[Math.floor(rng() * Math.min(3, ranked.length))].other : ranked[0].other;
  car.aiTarget = target.id;
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const edge = Math.hypot(target.x, target.z);
  const outwardX = edge > 0.1 ? target.x / edge : 0;
  const outwardZ = edge > 0.1 ? target.z / edge : 0;
  const smallFloat = world.radius <= 6.5;
  if (smallFloat && edge > 0.1) {
    const distance = Math.hypot(dx, dz);
    if (distance <= 3.5) {
      car.aiAimX = car.x + outwardX * 5;
      car.aiAimZ = car.z + outwardZ * 5;
    } else {
      const staging = level === 0 ? 0.8 : 1.4;
      car.aiAimX = target.x - outwardX * staging;
      car.aiAimZ = target.z - outwardZ * staging;
    }
    return;
  }
  let angle = Math.atan2(dx, dz);
  if (level === 2) {
    angle = Math.atan2(outwardX, outwardZ);
    car.aiAimX = target.x + outwardX * 0.6;
    car.aiAimZ = target.z + outwardZ * 0.6;
  } else {
    angle += (rng() * 2 - 1) * noises[level];
    const distance = Math.hypot(dx, dz);
    car.aiAimX = car.x + Math.sin(angle) * distance;
    car.aiAimZ = car.z + Math.cos(angle) * distance;
  }
}

function toward(car: Car, x: number, z: number) {
  return unit(x - car.x, z - car.z);
}

function safetyMargin(world: World, level: Level) {
  return Math.min(margins[level], world.radius * 0.3);
}

function shouldCharge(world: World, car: Car, target: Car | undefined, level: Level, dir: Input, rng: () => number) {
  if (!target || car.cool > 0 || car.charge > 0 || car.dashT > 0) return false;
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const distance = Math.hypot(dx, dz);
  const forwardX = Math.sin(car.yaw);
  const forwardZ = Math.cos(car.yaw);
  const dot = distance ? (dx * forwardX + dz * forwardZ) / distance : 1;
  const maxDistance = level === 0 ? 5 : level === 1 ? 7 : 9;
  if (distance > maxDistance || dot <= (level === 0 ? 0.2 : 0.45) || Math.hypot(dir.x, dir.y) < 0.4) return false;
  const aimLength = Math.hypot(dir.x, dir.y) || 1;
  const dashX = dir.x / aimLength;
  const dashZ = dir.y / aimLength;
  const charge = level === 0 ? 0.28 : level === 1 ? 0.5 : 1;
  const speed = 9 + 11 * charge;
  const projected = Math.hypot(car.x + (car.vx + dashX * speed) * 0.45, car.z + (car.vz + dashZ * speed) * 0.45);
  if (projected > world.radius - safetyMargin(world, level)) return false;
  return level === 0 ? rng() < 0.18 : true;
}

export function think(world: World, id: number, level: Level, rng: () => number = world.random): Input {
  const car = world.cars[id];
  if (!car || car.out || car.falling) return { x: 0, y: 0, dash: false };

  car.aiTimer -= 1 / 60;
  const target = world.cars[car.aiTarget];
  if (car.aiTimer <= 0 || !target || target.out || target.falling) {
    aimAt(world, car, level, rng);
    car.aiTimer = rethink[level];
  }
  const foe = world.cars[car.aiTarget];
  let dir = toward(car, car.aiAimX, car.aiAimZ);
  const targetRadius = world.radius - safetyMargin(world, level);

  if (level === 2 && Math.hypot(car.x, car.z) > targetRadius) {
    const incoming = world.cars.find((other) => other.id !== car.id && !other.out && !other.falling && other.dashT > 0 && Math.hypot(other.x - car.x, other.z - car.z) < 4);
    if (incoming) {
      const awayX = car.x - incoming.x;
      const awayZ = car.z - incoming.z;
      const side = Math.sign(car.x * awayZ - car.z * awayX) || 1;
      dir = unit(-awayZ * side, awayX * side);
    }
  }

  const predictedX = car.x + car.vx * 0.45;
  const predictedZ = car.z + car.vz * 0.45;
  const futureDash = car.aiDashReady ? (9 + 11 * car.charge) * 0.35 : 0;
  const predictedDistance = Math.hypot(predictedX + Math.sin(car.yaw) * futureDash, predictedZ + Math.cos(car.yaw) * futureDash);
  const edgeRisk = predictedDistance > targetRadius;
  if (edgeRisk) {
    const engaged = foe && !foe.out && !foe.falling && Math.hypot(foe.x - car.x, foe.z - car.z) <= 3.5;
    if (!engaged) dir = toward(car, 0, 0);
    car.aiDashReady = false;
    car.aiDashHold = 0;
  }

  if (car.aiDashHold > 0) {
    car.aiDashHold -= 1 / 60;
    if (car.charge >= (level === 2 ? 0.98 : level === 1 ? 0.48 : 0.27) || edgeRisk || car.cool > 0) {
      car.aiDashHold = 0;
      car.aiDashReady = false;
      return { ...dir, dash: false };
    }
    return { ...dir, dash: true };
  }

  if (!edgeRisk && shouldCharge(world, car, foe, level, dir, rng)) {
    car.aiDashHold = level === 2 ? 0.7 : level === 1 ? 0.35 : 0.2;
    car.aiDashReady = true;
    return { ...dir, dash: true };
  }
  car.aiDashReady = false;
  return { ...dir, dash: false };
}

export const safeMargin = (level: Level) => margins[level];
export const carRadius = CAR_RADIUS;
