// Pure Pong rules: court, ball, paddles, spin, scoring and the computer player. No DOM.

export const COURT = { w: 160, h: 100 } as const;
export const PADDLE = { w: 2.6, h: 18, inset: 7 } as const;
export const BALL_R = 1.8;
export const WIN_SCORE = 11;
export const SERVE_DELAY = 0.9;
export const PADDLE_SPEED = 95;
const BASE_SPEED = 62;
const MAX_SPEED = 150;
const SPEED_UP = 1.045;
const SPIN_FROM_PADDLE = 0.55;
const SPIN_DECAY = 1.6;

export type Side = 0 | 1;
export type Ball = { x: number; y: number; vx: number; vy: number; spin: number };
export type Paddle = { y: number; vy: number };
export type Match = {
  ball: Ball;
  paddles: [Paddle, Paddle];
  score: [number, number];
  /** Seconds until the held ball is released. */
  serveIn: number;
  /** Which side the next serve travels toward. */
  serveTo: Side;
  rally: number;
  winner: Side | null;
  time: number;
};
export type PongEvent =
  | { kind: 'wall'; x: number; y: number }
  | { kind: 'paddle'; side: Side; x: number; y: number; speed: number }
  | { kind: 'score'; side: Side; x: number; y: number }
  | { kind: 'serve' }
  | { kind: 'win'; side: Side };

export type Rng = () => number;

export const paddleX = (side: Side) => (side === 0 ? PADDLE.inset : COURT.w - PADDLE.inset);
export const other = (s: Side): Side => (s === 0 ? 1 : 0);

export function createMatch(serveTo: Side = 1): Match {
  const m: Match = {
    ball: { x: COURT.w / 2, y: COURT.h / 2, vx: 0, vy: 0, spin: 0 },
    paddles: [{ y: COURT.h / 2, vy: 0 }, { y: COURT.h / 2, vy: 0 }],
    score: [0, 0],
    serveIn: SERVE_DELAY,
    serveTo,
    rally: 0,
    winner: null,
    time: 0,
  };
  return m;
}

/** Release the held ball toward `m.serveTo` at a gentle random angle. */
export function serve(m: Match, rng: Rng = Math.random) {
  const dir = m.serveTo === 0 ? -1 : 1;
  const angle = (rng() - 0.5) * 0.9;
  m.ball.x = COURT.w / 2;
  m.ball.y = COURT.h / 2;
  m.ball.vx = Math.cos(angle) * BASE_SPEED * dir;
  m.ball.vy = Math.sin(angle) * BASE_SPEED;
  m.ball.spin = 0;
  m.rally = 0;
  m.serveIn = 0;
}

/** Move a paddle by dy (court units) and remember its velocity for spin. */
export function movePaddle(p: Paddle, dy: number, dt: number) {
  const half = PADDLE.h / 2;
  const before = p.y;
  p.y = clamp(p.y + dy, half, COURT.h - half);
  p.vy = dt > 0 ? (p.y - before) / dt : 0;
}

/** Steer a paddle toward a target y with the paddle speed limit (used by pointer and computer input). */
export function steerPaddle(p: Paddle, targetY: number, dt: number, speed = PADDLE_SPEED) {
  const d = targetY - p.y;
  const max = speed * dt;
  movePaddle(p, clamp(d, -max, max), dt);
}

export function step(m: Match, dt: number, events: PongEvent[] = [], rng: Rng = Math.random): PongEvent[] {
  if (m.winner !== null || dt <= 0) return events;
  m.time += dt;
  if (m.serveIn > 0) {
    m.serveIn -= dt;
    if (m.serveIn <= 0) {
      serve(m, rng);
      events.push({ kind: 'serve' });
    }
    return events;
  }
  const b = m.ball;
  // Spin bends the flight path and fades out.
  b.vy += b.spin * dt * 30;
  b.spin -= b.spin * Math.min(1, SPIN_DECAY * dt);
  const px = b.x;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.y < BALL_R) {
    b.y = BALL_R + (BALL_R - b.y);
    b.vy = Math.abs(b.vy);
    events.push({ kind: 'wall', x: b.x, y: 0 });
  } else if (b.y > COURT.h - BALL_R) {
    b.y = COURT.h - BALL_R - (b.y - (COURT.h - BALL_R));
    b.vy = -Math.abs(b.vy);
    events.push({ kind: 'wall', x: b.x, y: COURT.h });
  }

  for (const side of [0, 1] as Side[]) {
    const face = paddleX(side) + (side === 0 ? PADDLE.w / 2 : -PADDLE.w / 2);
    const toward = side === 0 ? b.vx < 0 : b.vx > 0;
    if (!toward) continue;
    const crossed = side === 0 ? px - BALL_R >= face && b.x - BALL_R <= face : px + BALL_R <= face && b.x + BALL_R >= face;
    if (!crossed) continue;
    const p = m.paddles[side];
    const t = (face - (side === 0 ? px - BALL_R : px + BALL_R)) / (b.x - px || 1);
    const yAt = b.y - b.vy * dt * (1 - clamp(t, 0, 1));
    const half = PADDLE.h / 2 + BALL_R;
    if (Math.abs(yAt - p.y) > half) continue;
    const speed = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * SPEED_UP);
    const offset = clamp((yAt - p.y) / half, -1, 1);
    const angle = offset * 0.95 + clamp(p.vy / PADDLE_SPEED, -1, 1) * 0.25;
    const dir = side === 0 ? 1 : -1;
    b.vx = Math.cos(angle) * speed * dir;
    b.vy = Math.sin(angle) * speed;
    b.spin = clamp(p.vy / PADDLE_SPEED, -1, 1) * SPIN_FROM_PADDLE * (speed / BASE_SPEED);
    b.x = face + dir * (BALL_R + 0.01);
    m.rally++;
    events.push({ kind: 'paddle', side, x: b.x, y: b.y, speed });
  }

  if (b.x < -BALL_R * 2 || b.x > COURT.w + BALL_R * 2) {
    const scorer: Side = b.x < 0 ? 1 : 0;
    m.score[scorer]++;
    events.push({ kind: 'score', side: scorer, x: b.x < 0 ? 0 : COURT.w, y: b.y });
    b.vx = 0;
    b.vy = 0;
    b.spin = 0;
    b.x = COURT.w / 2;
    b.y = COURT.h / 2;
    if (m.score[scorer] >= WIN_SCORE) {
      m.winner = scorer;
      events.push({ kind: 'win', side: scorer });
    } else {
      m.serveTo = other(scorer);
      m.serveIn = SERVE_DELAY;
    }
  }
  return events;
}

/** Where the ball will cross x, folding wall bounces. Returns the current y when the ball is not heading there. */
export function predictY(b: Ball, x: number): number {
  const dx = x - b.x;
  if (b.vx === 0 || Math.sign(dx) !== Math.sign(b.vx)) return b.y;
  const t = dx / b.vx;
  const span = COURT.h - BALL_R * 2;
  let y = b.y - BALL_R + b.vy * t;
  const period = span * 2;
  y = ((y % period) + period) % period;
  if (y > span) y = period - y;
  return y + BALL_R;
}

export type AiLevel = 0 | 1 | 2;
export type AiState = { target: number; think: number };
const AI = [
  { speed: 52, error: 9, every: 0.34, idle: 0.25 },
  { speed: 74, error: 4.5, every: 0.18, idle: 0.5 },
  { speed: 100, error: 1.2, every: 0.07, idle: 0.85 },
] as const;

export const createAi = (): AiState => ({ target: COURT.h / 2, think: 0 });

/** Computer paddle: re-aims every so often at a noisy prediction, drifts to center while the ball leaves. */
export function aiStep(m: Match, side: Side, level: AiLevel, ai: AiState, dt: number, rng: Rng = Math.random) {
  const cfg = AI[level];
  const b = m.ball;
  const toward = side === 0 ? b.vx < 0 : b.vx > 0;
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = cfg.every;
    if (m.serveIn > 0 || b.vx === 0) ai.target = COURT.h / 2;
    else if (toward) ai.target = predictY(b, paddleX(side)) + (rng() * 2 - 1) * cfg.error;
    else ai.target = COURT.h / 2 + (b.y - COURT.h / 2) * (1 - cfg.idle);
  }
  steerPaddle(m.paddles[side], ai.target, dt, cfg.speed);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
