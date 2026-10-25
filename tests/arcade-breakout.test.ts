import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLS, SLOW, applyPowerup, ballSpeed, chainBonus, createBreakout, damageBrick, fieldFor, isLevelClear, layoutCount, paddleBounce, reflectBallAtWalls, resizeBreakout, serve, stepBreakout, type Ball, type Brick } from '../src/os/arcade/games/breakout/logic.ts';

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
  const brick: Brick = { x: 10, y: 20, w: 35, h: 23, hp: 2, maxHp: 2, row: 0, col: 0 };
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
  const brick: Brick = { x: 100, y: 200, w: 35, h: 23, hp: 1, maxHp: 1, row: 0, col: 0 };
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
  assert.equal(game.level, 1);
  stepBreakout(game, 0.5);
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
  assert.equal(game.slowActive, true);
  ball.x = 250;
  ball.y = 400;
  game.bricks = [{ x: 0, y: 0, w: 10, h: 10, hp: 1, maxHp: 1, row: 0, col: 0 }];
  applyPowerup(game, 'multi');
  assert.equal(game.balls.length, 3);
  for (const b of game.balls) assert.ok(Math.abs(b.vy) >= Math.hypot(b.vx, b.vy) * 0.34, 'split balls never leave nearly flat');
  const before = { x: game.balls[0].x, y: game.balls[0].y };
  const vx = game.balls[0].vx;
  const vy = game.balls[0].vy;
  stepBreakout(game, 0.1);
  assert.ok(Math.abs(game.balls[0].x - (before.x + vx * 0.1 * SLOW)) < 0.01, 'slow ball moves at the slowed pace');
  assert.ok(Math.abs(game.balls[0].y - (before.y + vy * 0.1 * SLOW)) < 0.01);
  assert.ok(game.paddle.width > game.paddle.baseWidth);
  game.time = 11;
  stepBreakout(game, 0.01);
  assert.equal(game.slowActive, false);
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

test('the field fits the canvas: tall on a phone, wide and short in a small laptop window', () => {
  const phone = fieldFor(390, 648);
  assert.ok(phone.height > phone.width);
  assert.ok(phone.width * phone.scale <= 390.001 && phone.height * phone.scale <= 648.001);
  const laptop = fieldFor(464, 157);
  assert.ok(laptop.width > laptop.height * 2);
  assert.ok(laptop.height * laptop.scale > 150, 'the short laptop window uses its full height');
  const big = fieldFor(1400, 760);
  assert.ok(big.scale <= 1.4, 'a full screen game is not blown up');
});

test('every layout is eleven columns and brick count does not depend on the screen', () => {
  for (let level = 1; level <= layoutCount() * 2; level++) {
    const a = createBreakout(level, { width: 480, height: 760, top: 70, bottom: 30 });
    const b = createBreakout(level, { width: 1000, height: 360, top: 100, bottom: 22 });
    assert.equal(a.bricks.length, b.bricks.length);
    assert.ok(a.bricks.every((brick) => brick.col < COLS && brick.x >= 0 && brick.x + brick.w <= a.width));
    assert.ok(b.bricks.every((brick) => brick.y + brick.h < b.paddle.y - 40), 'bricks leave room above the paddle');
  }
  const lap = createBreakout(layoutCount() + 1);
  const first = createBreakout(1);
  assert.ok(lap.bricks.reduce((n, b) => n + b.hp, 0) > first.bricks.reduce((n, b) => n + b.hp, 0), 'the second lap is tougher');
});

test('resizing mid round keeps bricks, paddle and ball in place relative to the walls', () => {
  const game = createBreakout(1, { width: 500, height: 700, top: 70, bottom: 30 });
  game.paddle.x = 125;
  const count = game.bricks.length;
  const ball = game.balls[0];
  ball.attached = false;
  ball.x = 250;
  ball.y = 350;
  ball.vx = 0;
  ball.vy = -350;
  resizeBreakout(game, { width: 1000, height: 360, top: 100, bottom: 22 });
  assert.equal(game.bricks.length, count);
  assert.ok(Math.abs(game.paddle.x - 250) < 0.001);
  assert.ok(Math.abs(ball.x - 500) < 0.001);
  assert.ok(ball.y < game.paddle.y);
  assert.ok(Math.abs(ball.vy + 180) < 0.001, 'speed follows the field height');
  assert.ok(game.bricks.every((b) => b.x + b.w <= 1000 && b.y >= 100));
});

test('serving launches the waiting ball at the level speed, leaning with the paddle', () => {
  const game = createBreakout();
  game.paddle.vx = 400;
  assert.equal(serve(game, () => 0.9), true);
  const ball = game.balls[0];
  assert.equal(ball.attached, false);
  assert.ok(ball.vx > 0 && ball.vy < 0);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - ballSpeed(game)) < 0.001);
  assert.equal(serve(game), false);
  const later = createBreakout(6);
  assert.ok(ballSpeed(later) > ballSpeed(createBreakout(1)));
});

test('keyboard input still moves the paddle and stops at the walls', () => {
  const game = createBreakout();
  const x = game.paddle.x;
  for (let i = 0; i < 10; i++) stepBreakout(game, 1 / 60, 1);
  assert.ok(game.paddle.x > x + 20);
  for (let i = 0; i < 200; i++) stepBreakout(game, 1 / 60, -1);
  assert.ok(Math.abs(game.paddle.x - (game.paddle.width / 2 + 4)) < 0.001);
});

test('a ball hitting the side of a brick bounces sideways, and chains score more', () => {
  const game = createBreakout();
  game.bricks = [{ x: 200, y: 300, w: 40, h: 20, hp: 1, maxHp: 1, row: 0, col: 0 }, { x: 0, y: 0, w: 10, h: 10, hp: 1, maxHp: 1, row: 0, col: 1 }];
  game.balls = [{ x: 190, y: 310, vx: 300, vy: 10, r: 7, attached: false }];
  stepBreakout(game, 1 / 60, 0, null, () => 0.99);
  assert.ok(game.balls[0].vx < 0);
  assert.equal(game.bricks.length, 1);
  assert.equal(chainBonus(1), 0);
  assert.equal(chainBonus(3), 10);
  assert.equal(chainBonus(40), 30);
});
