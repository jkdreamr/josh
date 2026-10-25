import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aimChance, createInvaders, damageShieldAt, fireAlienShot, firePlayerShot, maxAlienShots, stepFormation, stepIntervalForCount, stepInvaders } from '../src/os/arcade/games/invaders/logic.ts';
import { fitCourt, viewHeight } from '../src/os/arcade/games/invaders/layout.ts';

test('formation marches and reverses with a drop at the edge', () => {
  const game = createInvaders();
  const start = game.aliens[0].x;
  stepFormation(game);
  assert.equal(game.aliens[0].x, start + 14);
  const edgeAlien = game.aliens.find((alien) => alien.col === 10)!;
  edgeAlien.x = 474;
  const beforeY = edgeAlien.y;
  assert.equal(stepFormation(game), true);
  assert.equal(game.direction, -1);
  assert.equal(edgeAlien.y, beforeY + 16);
});

test('formation interval speeds up as aliens are removed', () => {
  assert.ok(stepIntervalForCount(10) < stepIntervalForCount(55));
  assert.ok(stepIntervalForCount(1) < stepIntervalForCount(10));
});

test('shots score according to the alien row and remove the alien', () => {
  const game = createInvaders();
  const target = game.aliens.find((alien) => alien.points === 30)!;
  game.aliens = [target, { ...game.aliens[1], x: 400, y: 300 }];
  game.playerShots = [{ x: target.x + 12, y: target.y + 12, vy: -470 }];
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.aliens.length, 1);
  assert.equal(game.score, 30);
});

test('shield erosion removes a small cluster and blocks a shot', () => {
  const game = createInvaders();
  const shield = game.shields[0];
  const before = shield.cells.flat().filter(Boolean).length;
  assert.equal(damageShieldAt(game, shield.x + shield.cell * 4 + 3, shield.y + shield.cell * 3 + 3, () => 0), true);
  const after = shield.cells.flat().filter(Boolean).length;
  assert.ok(after < before);
  assert.ok(before - after <= 4);
  const shotGame = createInvaders();
  const targetShield = shotGame.shields[0];
  const cellsBeforeShot = targetShield.cells.flat().filter(Boolean).length;
  shotGame.playerShots = [{ x: targetShield.x + 3, y: targetShield.y + 50, vy: -470 }];
  stepInvaders(shotGame, 0.08, 0, () => 0);
  assert.equal(shotGame.playerShots.length, 0);
  assert.ok(targetShield.cells.flat().filter(Boolean).length < cellsBeforeShot);
});

test('ufo awards a deterministic bonus in the expected range', () => {
  for (const points of [50, 100, 150, 200, 300]) {
    const game = createInvaders();
    game.aliens = [{ ...game.aliens[0], x: 400, y: 300 }];
    game.ufo = { x: 140, direction: 1, points };
    game.playerShots = [{ x: 160, y: 78, vy: -470 }];
    stepInvaders(game, 0.01, 0, () => 0.5);
    assert.equal(game.score, points);
    assert.equal(game.ufo, null);
    assert.equal(game.pointsFlash?.value, points);
  }
});

test('waves advance with a lower starting formation', () => {
  const game = createInvaders();
  const firstY = game.aliens[0].y;
  game.aliens = [];
  stepInvaders(game, 0.02, 0, () => 0.5);
  stepInvaders(game, 1.2, 0, () => 0.5);
  assert.equal(game.wave, 2);
  assert.equal(game.aliens[0].y, firstY + 16);
  assert.ok(game.waveBanner > 0);
});

test('game ends when aliens reach the player row', () => {
  const game = createInvaders();
  game.aliens = [{ ...game.aliens[0], y: game.player.y - 30 }];
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.ended, true);
});

test('only two player shots may be on screen', () => {
  const game = createInvaders();
  assert.equal(firePlayerShot(game), true);
  assert.equal(firePlayerShot(game), true);
  assert.equal(firePlayerShot(game), false);
  assert.equal(game.playerShots.length, 2);
});

test('a hit downs the cannon briefly, clears enemy fire and holds the formation', () => {
  const game = createInvaders();
  game.alienShots = [{ x: game.player.x, y: game.player.y - 4, vy: 240 }, { x: 100, y: 300, vy: 240 }];
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.lives, 2);
  assert.ok(game.respawn > 0);
  assert.equal(game.alienShots.length, 0);
  const x = game.aliens[0].x;
  stepInvaders(game, 0.5, 1, () => 0.5);
  assert.equal(game.aliens[0].x, x);
  assert.equal(firePlayerShot(game), false);
  stepInvaders(game, 0.5, 0, () => 0.5);
  assert.equal(game.respawn, 0);
  assert.equal(firePlayerShot(game), true);
});

test('player shots knock enemy shots out of the air', () => {
  const game = createInvaders();
  game.playerShots = [{ x: 200, y: 400, vy: -470 }];
  game.alienShots = [{ x: 202, y: 394, vy: 240 }];
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.playerShots.length, 0);
  assert.equal(game.alienShots.length, 0);
});

test('enemy fire is capped and aims more often in later waves', () => {
  assert.ok(aimChance(5) > aimChance(1));
  const game = createInvaders();
  for (let i = 0; i < 10; i++) fireAlienShot(game, () => 0.99);
  assert.equal(game.alienShots.length, maxAlienShots(1));
  const aimed = createInvaders();
  aimed.player.x = 60;
  fireAlienShot(aimed, () => 0);
  assert.ok(Math.abs(aimed.alienShots[0].x - 57) < 20);
});

test('extra lives at 1,500 and every 5,000 after, up to five', () => {
  const game = createInvaders();
  game.aliens = [{ ...game.aliens[0], x: 400, y: 300 }, { ...game.aliens[1], x: 100, y: 200 }];
  game.score = 1490;
  game.playerShots = [{ x: 412, y: 310, vy: -470 }];
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.lives, 4);
  assert.equal(game.bonusAt, 5000);
  game.score = 20000;
  stepInvaders(game, 0.01, 0, () => 0.5);
  assert.equal(game.lives, 5);
});

test('short wide windows run the field between the pills, tall ones under them', () => {
  const lane = fitCourt(464, 157, { touch: false, ctrlLeft: 274, ctrlBottom: 44 });
  assert.equal(lane.hud.stack, true);
  assert.ok(lane.ox >= 90 && lane.ox + 500 * lane.sx <= 264);
  assert.ok(lane.oy + viewHeight * lane.sy <= 157);
  assert.ok(lane.sx > 0.3);
  const phone = fitCourt(390, 648, { touch: true, ctrlLeft: 200, ctrlBottom: 54 });
  assert.equal(phone.hud.stack, false);
  assert.ok(phone.oy >= 54);
  assert.ok(phone.oy + viewHeight * phone.sy <= 648 - 150);
  const wide = fitCourt(1440, 800, { touch: false, ctrlLeft: 1240, ctrlBottom: 44 });
  assert.equal(wide.sx, wide.sy);
});
