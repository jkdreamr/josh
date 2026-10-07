import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPowerup, createBreakout, damageBrick, isLevelClear, paddleBounce, reflectBallAtWalls, stepBreakout, type Ball, type Brick } from '../src/os/arcade/games/breakout/logic.ts';

test('paddle hit angle follows impact offset and preserves speed', () => {
  const game = createBreakout();
  const ball: Ball = { x: game.paddle.x, y: 600, vx: 140, vy: -480, r: 7, attached: false };
  const speed = Math.hypot(ball.vx, ball.vy);
  assert.equal(paddleBounce(ball, game.paddle), 0);
  assert.ok(ball.vy < 0 && Math.abs(ball.vx) < 0.001);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - speed) < 0.001);
  ball.x = game.paddle.x + game.paddle.width / 2;
  const angle = paddleBounce(ball, game.paddle);
  assert.ok(Math.abs(angle - Math.PI / 3) < 0.001);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - speed) < 0.001);
  ball.x = game.paddle.x - game.paddle.width / 2;
  assert.ok(Math.abs(paddleBounce(ball, game.paddle) + Math.PI / 3) < 0.001);
});

test('side walls and ceiling reflect the ball', () => {
  const ball: Ball = { x: -3, y: -2, vx: -100, vy: -90, r: 7, attached: false };
  reflectBallAtWalls(ball, 500);
  assert.equal(ball.x, 7);
  assert.equal(ball.y, 7);
  assert.ok(ball.vx > 0 && ball.vy > 0);
});

test('brick damage decrements durability then removes the brick', () => {
  const game = createBreakout();
  const brick: Brick = { x: 10, y: 20, w: 35, h: 23, hp: 2, row: 0 };
  game.bricks = [brick];
  assert.equal(damageBrick(game, brick, () => 0.99), false);
  assert.equal(brick.hp, 1);
  assert.equal(damageBrick(game, brick, () => 0.99), true);
  assert.equal(game.bricks.length, 0);
  assert.equal(game.score, 20);
  assert.equal(isLevelClear(game), true);
});

test('substeps prevent a fast ball tunneling through a brick', () => {
  const game = createBreakout();
  const brick: Brick = { x: 100, y: 200, w: 35, h: 23, hp: 1, row: 0 };
  game.bricks = [brick];
  game.balls = [{ x: 115, y: 240, vx: 0, vy: -2400, r: 5, attached: false }];
  stepBreakout(game, 0.04, 0, null, () => 0.99);
  assert.equal(game.bricks.length, 0);
});

test('level clear is detected and the next level starts after a short banner', () => {
  const game = createBreakout();
  game.bricks = [];
  stepBreakout(game, 0.02);
  assert.ok(game.levelBanner > 0);
  stepBreakout(game, 1.2);
  assert.equal(game.level, 2);
  assert.ok(game.bricks.length > 0);
});

test('wide, multi and slow powerups affect play', () => {
  const game = createBreakout();
  const ball = game.balls[0];
  ball.attached = false;
  ball.vx = 100;
  ball.vy = -200;
  applyPowerup(game, 'wide');
  applyPowerup(game, 'slow');
  assert.ok(ball.vx < 100 && ball.vy > -200);
  applyPowerup(game, 'multi');
  assert.equal(game.balls.length, 3);
  stepBreakout(game, 0.1);
  assert.ok(game.paddle.width > game.paddle.baseWidth);
});

test('losing the final ball costs one life and ends after the third loss', () => {
  const game = createBreakout();
  game.balls = [{ x: 250, y: 715, vx: 0, vy: 100, r: 7, attached: false }];
  stepBreakout(game, 0.01);
  assert.equal(game.lives, 2);
  assert.equal(game.balls[0].attached, true);
  game.lives = 1;
  game.balls = [{ x: 250, y: 715, vx: 0, vy: 100, r: 7, attached: false }];
  stepBreakout(game, 0.01);
  assert.equal(game.ended, true);
});
