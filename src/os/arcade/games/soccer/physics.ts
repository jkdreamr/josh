export type BallState = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; grounded: boolean; inNet: boolean };
export const BALL_RADIUS = 0.11;
const GRAVITY = 9.81;
const DRAG = 0.013;
const FIELD_X = 21;
const FIELD_Z = 13;
const GOAL_HALF = 2.5;
const GOAL_HEIGHT = 2.2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function stepBall(ball: BallState, dt: number) {
  let left = Math.min(0.05, Math.max(0, dt));
  const pieces = Math.max(1, Math.ceil(left / (1 / 120)));
  const h = pieces ? left / pieces : left;
  for (let i = 0; i < pieces; i++) {
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    const drag = Math.exp(-DRAG * speed * h);
    const spinAccel = ball.spin * ball.vx * h * 0.0038;
    ball.vx *= drag;
    ball.vz = ball.vz * drag + spinAccel;
    ball.spin *= Math.exp(-0.7 * h);
    if (!ball.grounded) ball.vy -= GRAVITY * h;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    ball.z += ball.vz * h;
    if (ball.y <= BALL_RADIUS) {
      ball.y = BALL_RADIUS;
      if (ball.vy < -0.45) {
        ball.vy = -ball.vy * 0.6;
        ball.vx *= 0.94;
        ball.vz *= 0.94;
        ball.spin += ball.vz * 0.12;
        ball.grounded = false;
      } else {
        ball.vy = 0;
        ball.grounded = true;
      }
      if (ball.grounded) {
        const horizontal = Math.hypot(ball.vx, ball.vz);
        const next = Math.max(0, horizontal - 2.2 * h) * Math.exp(-0.16 * h);
        if (horizontal > 0) {
          ball.vx *= next / horizontal;
          ball.vz *= next / horizontal;
        }
      }
    }
    if (ball.y < GOAL_HEIGHT && Math.abs(ball.z) < GOAL_HALF + 0.5 && Math.abs(ball.x) > FIELD_X - 0.08) {
      const end = Math.sign(ball.x);
      const postClear = Math.abs(ball.z) < GOAL_HALF - BALL_RADIUS;
      if (!postClear) {
        ball.x = end * (FIELD_X - BALL_RADIUS);
        ball.vx = -ball.vx * 0.7;
      } else if (ball.y > GOAL_HEIGHT - BALL_RADIUS && ball.y < GOAL_HEIGHT + 0.08) {
        ball.y = GOAL_HEIGHT - BALL_RADIUS;
        ball.vy = -Math.abs(ball.vy) * 0.7;
        ball.x = end * (FIELD_X - BALL_RADIUS);
        ball.vx = -ball.vx * 0.7;
      } else if (Math.abs(ball.x) > FIELD_X + 0.15) {
        ball.inNet = true;
        ball.vx *= Math.exp(-5 * h);
        ball.vz *= Math.exp(-5 * h);
        ball.vy *= Math.exp(-4 * h);
      }
    }
    if (Math.abs(ball.z) > FIELD_Z && Math.abs(ball.x) < FIELD_X - BALL_RADIUS) {
      ball.z = Math.sign(ball.z) * FIELD_Z;
      ball.vz = -ball.vz * 0.58;
    }
    if (Math.abs(ball.x) > FIELD_X + 3 && !ball.inNet) ball.vx *= 0.98;
  }
}

export function countsAsGoal(ball: BallState, previousX: number) {
  return Math.abs(ball.z) <= GOAL_HALF - BALL_RADIUS
    && ball.y <= GOAL_HEIGHT - BALL_RADIUS
    && ((previousX <= FIELD_X - BALL_RADIUS && ball.x > FIELD_X + BALL_RADIUS)
      || (previousX >= -FIELD_X + BALL_RADIUS && ball.x < -FIELD_X - BALL_RADIUS));
}

export function resolvePostCollision(ball: BallState, x: number, z: number, y: number) {
  const radius = 0.17;
  const dx = ball.x - x;
  const dy = ball.y - y;
  const dz = ball.z - z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= radius || d === 0) return false;
  const nx = dx / d, ny = dy / d, nz = dz / d;
  const dot = ball.vx * nx + ball.vy * ny + ball.vz * nz;
  if (dot < 0) {
    ball.vx -= 1.7 * dot * nx;
    ball.vy -= 1.7 * dot * ny;
    ball.vz -= 1.7 * dot * nz;
  }
  ball.x = x + nx * radius;
  ball.y = y + ny * radius;
  ball.z = z + nz * radius;
  return true;
}

export function createBall(): BallState {
  return { x: 0, y: BALL_RADIUS, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
}

export function clampBall(ball: BallState) {
  ball.x = clamp(ball.x, -80, 80);
  ball.y = clamp(ball.y, BALL_RADIUS, 40);
  ball.z = clamp(ball.z, -60, 60);
}
