import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_R, COURT, PADDLE, PADDLE_SPEED, WIN_SCORE, aiStep, createAi, createMatch, movePaddle, paddleX, predictY, serve, step } from '../src/os/arcade/games/pong/pong.ts';

const fixed = (v: number) => () => v;

test('a new match holds the ball at center and serves after the delay', () => {
  const m = createMatch(1);
  assert.deepEqual(m.score, [0, 0]);
  assert.equal(m.winner, null);
  assert.ok(m.serveIn > 0);
  const ev = step(m, m.serveIn + 0.01, [], fixed(0.5));
  assert.ok(ev.some((e) => e.kind === 'serve'));
  assert.ok(m.ball.vx > 0, 'serve travels toward side 1');
});

test('serve toward side 0 moves left', () => {
  const m = createMatch(0);
  serve(m, fixed(0.5));
  assert.ok(m.ball.vx < 0);
  assert.equal(m.ball.vy, 0);
});

test('the ball bounces off the top and bottom walls', () => {
  const m = createMatch();
  m.serveIn = 0;
  Object.assign(m.ball, { x: 80, y: BALL_R + 0.5, vx: 0, vy: -60 });
  const ev = step(m, 0.05);
  assert.ok(m.ball.vy > 0);
  assert.ok(m.ball.y >= BALL_R);
  assert.equal(ev[0].kind, 'wall');
  Object.assign(m.ball, { x: 80, y: COURT.h - BALL_R - 0.5, vx: 0, vy: 60 });
  step(m, 0.05, ev);
  assert.ok(m.ball.vy < 0);
});

test('a paddle returns the ball and a moving paddle adds spin', () => {
  const still = createMatch();
  still.serveIn = 0;
  still.paddles[0].y = 50;
  Object.assign(still.ball, { x: paddleX(0) + PADDLE.w / 2 + BALL_R + 1, y: 50, vx: -60, vy: 0 });
  const ev = step(still, 1 / 30);
  assert.equal(ev[0].kind, 'paddle');
  assert.ok(still.ball.vx > 0, 'ball heads back');
  assert.equal(still.rally, 1);
  assert.equal(still.ball.spin, 0, 'a still paddle adds no spin');

  const moving = createMatch();
  moving.serveIn = 0;
  moving.paddles[0].y = 50;
  moving.paddles[0].vy = PADDLE_SPEED;
  Object.assign(moving.ball, { x: paddleX(0) + PADDLE.w / 2 + BALL_R + 1, y: 50, vx: -60, vy: 0 });
  step(moving, 1 / 30);
  assert.ok(moving.ball.spin > 0, 'an upward moving paddle spins the ball');
  assert.ok(moving.ball.vy > still.ball.vy, 'paddle velocity deflects the ball');
  assert.ok(Math.hypot(moving.ball.vx, moving.ball.vy) > 60, 'returns speed the ball up');
});

test('a ball that passes a paddle is a point and the loser receives the serve', () => {
  const m = createMatch();
  m.serveIn = 0;
  Object.assign(m.ball, { x: COURT.w - 1, y: 10, vx: 200, vy: 0 });
  m.paddles[1].y = 90;
  const ev = step(m, 0.1);
  assert.ok(ev.some((e) => e.kind === 'score' && e.side === 0));
  assert.deepEqual(m.score, [1, 0]);
  assert.equal(m.serveTo, 1);
  assert.ok(m.serveIn > 0);
  assert.equal(m.ball.vx, 0);
});

test('first to 11 wins and the match stops', () => {
  const m = createMatch();
  m.serveIn = 0;
  m.score = [WIN_SCORE - 1, 3];
  Object.assign(m.ball, { x: COURT.w - 1, y: 10, vx: 200, vy: 0 });
  m.paddles[1].y = 90;
  const ev = step(m, 0.1);
  assert.equal(m.winner, 0);
  assert.ok(ev.some((e) => e.kind === 'win' && e.side === 0));
  const before = structuredClone(m);
  step(m, 0.5);
  assert.deepEqual(m, before, 'nothing moves after the win');
});

test('predictY folds wall bounces', () => {
  const b = { x: 80, y: 50, vx: 40, vy: 0, spin: 0 };
  assert.ok(Math.abs(predictY(b, 150) - 50) < 1e-9);
  const diag = { x: 80, y: 50, vx: 40, vy: 40, spin: 0 };
  // Travels 70 across and 70 down: hits the floor and comes back up.
  const y = predictY(diag, 150);
  const span = COURT.h - BALL_R * 2;
  const raw = 50 - BALL_R + 70;
  assert.ok(Math.abs(y - (span - (raw - span) + BALL_R)) < 1e-9);
  assert.equal(predictY(b, 10), 50, 'ball moving away: no prediction');
});

test('the computer paddle moves toward the predicted crossing and respects its speed', () => {
  const m = createMatch();
  m.serveIn = 0;
  Object.assign(m.ball, { x: 100, y: 20, vx: 80, vy: 0 });
  const ai = createAi();
  const start = m.paddles[1].y;
  aiStep(m, 1, 2, ai, 1 / 60, fixed(0.5));
  assert.ok(m.paddles[1].y < start, 'moves up toward y=20');
  assert.ok(start - m.paddles[1].y <= 100 / 60 + 1e-9);
  for (let i = 0; i < 120; i++) aiStep(m, 1, 2, ai, 1 / 60, fixed(0.5));
  assert.ok(Math.abs(m.paddles[1].y - 20) < 1.5);
});

test('paddles stay inside the court', () => {
  const p = { y: 50, vy: 0 };
  movePaddle(p, -500, 0.1);
  assert.equal(p.y, PADDLE.h / 2);
  movePaddle(p, 500, 0.1);
  assert.equal(p.y, COURT.h - PADDLE.h / 2);
  assert.ok(p.vy > 0);
});
