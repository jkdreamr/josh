import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnake, queueDirection, spawnFood, speedForLength, stepSnake, type SnakeState } from '../src/os/arcade/games/snake/logic.ts';

test('snake advances one cell in its current direction', () => {
  const state = createSnake(12, 10, () => 0);
  assert.equal(stepSnake(state, () => 0), 'moved');
  assert.deepEqual(state.segments[0], { x: 7, y: 5 });
  assert.equal(state.segments.length, 3);
});

test('eating food grows the body and awards points', () => {
  const state = createSnake(12, 10, () => 0);
  state.food = { x: state.segments[0].x + 1, y: state.segments[0].y };
  assert.equal(stepSnake(state, () => 0), 'ate');
  assert.equal(state.segments.length, 4);
  assert.equal(state.score, 10);
});

test('walls end the round', () => {
  const state = createSnake(8, 8, () => 0);
  state.segments = [{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }];
  state.direction = 'right';
  assert.equal(stepSnake(state), 'dead');
  assert.equal(state.alive, false);
});

test('self collision is fatal except for the tail cell that vacates', () => {
  const state = createSnake(8, 8, () => 0);
  state.segments = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }];
  state.direction = 'left';
  assert.equal(stepSnake(state), 'moved');
  assert.deepEqual(state.segments[0], { x: 1, y: 2 });
  const crash: SnakeState = { ...state, segments: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }], previous: [], direction: 'left', queue: [], alive: true, food: { x: 7, y: 7 } };
  assert.equal(stepSnake(crash), 'dead');
});

test('direction buffer rejects reversals and accepts two quick turns', () => {
  const state = createSnake(12, 10, () => 0);
  assert.equal(queueDirection(state, 'left'), false);
  assert.equal(queueDirection(state, 'up'), true);
  assert.equal(queueDirection(state, 'down'), false);
  assert.equal(queueDirection(state, 'left'), true);
  assert.equal(queueDirection(state, 'down'), false);
  assert.deepEqual(state.queue, ['up', 'left']);
  stepSnake(state);
  assert.equal(state.direction, 'up');
  stepSnake(state);
  assert.equal(state.direction, 'left');
});

test('food spawning never overlaps the snake and returns null on a full board', () => {
  const state = createSnake(6, 6, () => 0);
  const food = spawnFood(state, () => 0);
  assert.ok(food);
  assert.ok(!state.segments.some((p) => p.x === food.x && p.y === food.y));
  state.segments = Array.from({ length: state.cols * state.rows }, (_, i) => ({ x: i % state.cols, y: Math.floor(i / state.cols) }));
  assert.equal(spawnFood(state, () => 0), null);
});

test('speed increases with length and has a cap', () => {
  assert.ok(speedForLength(8) > speedForLength(3));
  assert.ok(speedForLength(50) >= speedForLength(8));
  assert.equal(speedForLength(100), 16);
});
