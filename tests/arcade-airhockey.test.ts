import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIFF, GOAL_W, L, MALLET_R, MAX_SPEED, PUCK_R, TO_WIN, W, aiHit, aiTarget, clampMallet, create, moveMalletTo, newAiMem, nudgeMallet, placePuck, predictX, step, stepAI, type Difficulty } from '../src/os/arcade/games/airhockey/logic.ts';

const DT = 1 / 120;
const live = () => {
  const s = create();
  s.freeze = 0;
  return s;
};

test('the puck bounces off the side walls and keeps most of its speed', () => {
  const s = live();
  s.puck.x = W / 2 - PUCK_R - 0.01;
  s.puck.vx = 3;
  const ev = step(s, DT);
  assert.ok(ev.wall);
  assert.ok(s.puck.vx < 0);
  assert.ok(Math.abs(s.puck.vx) > 2.5);
  assert.ok(s.puck.x + PUCK_R <= W / 2 + 1e-9);
});

test('end walls outside the goal mouth bounce the puck back', () => {
  const s = live();
  s.puck.x = GOAL_W / 2 + 0.2;
  s.puck.z = -(L / 2 - PUCK_R - 0.005);
  s.puck.vz = -4;
  const ev = step(s, DT);
  assert.ok(ev.wall);
  assert.ok(s.puck.vz > 0);
});

test('a puck through the top goal scores for the bottom player and the loser serves', () => {
  const s = live();
  s.puck.x = 0;
  s.puck.z = -(L / 2 - 0.02);
  s.puck.vz = -6;
  let ev = {} as ReturnType<typeof step>;
  for (let i = 0; i < 20 && ev.goal === undefined; i++) ev = step(s, DT);
  assert.equal(ev.goal, 0);
  assert.deepEqual(s.score, [1, 0]);
  assert.equal(s.serve, 1);
  assert.ok(s.puck.z < 0, 'puck placed on the side that was scored on');
  assert.ok(s.freeze > 0);
});

test('a puck through the bottom goal scores for the top player', () => {
  const s = live();
  s.puck.z = L / 2 - 0.02;
  s.puck.vz = 6;
  let ev = {} as ReturnType<typeof step>;
  for (let i = 0; i < 20 && ev.goal === undefined; i++) ev = step(s, DT);
  assert.equal(ev.goal, 1);
  assert.deepEqual(s.score, [0, 1]);
});

test('the seventh goal wins and freezes play', () => {
  const s = live();
  s.score = [TO_WIN - 1, 2];
  s.puck.z = -(L / 2 - 0.02);
  s.puck.vz = -6;
  let ev = {} as ReturnType<typeof step>;
  for (let i = 0; i < 20 && ev.goal === undefined; i++) ev = step(s, DT);
  assert.equal(ev.win, 0);
  assert.equal(s.winner, 0);
  const before = { ...s.puck };
  step(s, DT);
  assert.deepEqual(s.puck, before);
});

test('mallets stay inside their own half and the table', () => {
  const s = create();
  s.mallets[0].x = 5;
  s.mallets[0].z = -1;
  clampMallet(s.mallets[0], 0);
  assert.ok(s.mallets[0].x <= W / 2 - s.mallets[0].r);
  assert.ok(s.mallets[0].z >= 0);
  s.mallets[1].z = 1;
  clampMallet(s.mallets[1], 1);
  assert.ok(s.mallets[1].z <= 0);
  moveMalletTo(s, 1, { x: 0, z: 5 }, 1);
  assert.ok(s.mallets[1].z <= 0);
});

test('a moving mallet knocks the puck away and gives it speed', () => {
  const s = live();
  s.puck.x = 0;
  s.puck.z = 0.5;
  s.mallets[1].x = 0.8; // keep the other mallet out of the puck's path
  const m = s.mallets[0];
  m.x = 0;
  m.z = 0.5 + PUCK_R + m.r + 0.02;
  // sweep the mallet up into the puck
  let hit = false;
  for (let i = 0; i < 30; i++) {
    moveMalletTo(s, 0, { x: 0, z: m.z - 0.05 }, DT);
    const ev = step(s, DT);
    if (ev.hit === 0) hit = true;
  }
  assert.ok(hit);
  assert.ok(s.puck.vz < -1, `puck heads up the table, vz=${s.puck.vz}`);
  assert.ok(Math.hypot(s.puck.vx, s.puck.vz) <= MAX_SPEED + 1e-9);
});

test('puck speed is capped and friction slows it', () => {
  const s = live();
  s.puck.vz = -50;
  step(s, DT);
  assert.ok(Math.hypot(s.puck.vx, s.puck.vz) <= MAX_SPEED + 1e-9);
  const s2 = live();
  s2.puck.vx = 2;
  for (let i = 0; i < 120; i++) step(s2, DT);
  assert.ok(Math.abs(s2.puck.vx) < 2);
});

test('touching the puck during the serve freeze starts play', () => {
  const s = create();
  assert.ok(s.freeze > 0);
  placePuck(s, 0);
  s.mallets[0].x = s.puck.x;
  s.mallets[0].z = s.puck.z + PUCK_R + s.mallets[0].r - 0.01;
  const ev = step(s, DT);
  assert.equal(ev.hit, 0);
  assert.equal(s.freeze, 0);
});

test('keyboard nudges move the mallet at a steady speed', () => {
  const s = create();
  const z0 = s.mallets[0].z;
  for (let i = 0; i < 60; i++) nudgeMallet(s, 0, 0, -1, DT);
  assert.ok(s.mallets[0].z < z0 - 0.5);
  nudgeMallet(s, 0, 0, 0, DT);
  assert.equal(s.mallets[0].vz, 0);
});

test('the computer defends its goal when the puck is far and attacks when it is close', () => {
  const s = live();
  s.puck.z = 1.2;
  s.puck.vz = 1;
  const def = aiTarget(s, () => 0.5);
  assert.ok(def.z < -1.2, 'back near its own goal');
  s.puck.z = -0.8;
  s.puck.vz = -1;
  s.puck.x = 0.3;
  s.mallets[1].x = -0.6; // not lined up yet
  const atk = aiTarget(s, () => 0.5);
  assert.ok(atk.z < s.puck.z, 'gets behind the puck');
  assert.ok(Math.abs(atk.x - s.puck.x) < 0.3);
  s.mallets[1].x = 0.3; // lined up behind it: swing through toward the far goal
  const swing = aiTarget(s, () => 0.5);
  assert.ok(swing.z > s.puck.z && swing.z < 0, 'swings through the puck without crossing the centre');
});

test('the computer never crosses the centre line and is slower on easy', () => {
  for (const diff of ['easy', 'hard'] as const) {
    const s = create('cpu', diff);
    s.freeze = 0;
    s.puck.z = 0.5;
    s.puck.vz = 0;
    for (let i = 0; i < 240; i++) {
      stepAI(s, DT, () => 0.5);
      assert.ok(s.mallets[1].z <= 0);
    }
  }
  assert.ok(DIFF.easy.speed < DIFF.hard.speed);
  const a = create('cpu', 'easy');
  const b = create('cpu', 'hard');
  for (const s of [a, b]) {
    s.freeze = 0;
    s.puck.x = 0.8;
    s.puck.z = -0.6;
    s.aiTimer = 0;
    stepAI(s, 0.1, () => 0.5);
  }
  const da = Math.hypot(a.mallets[1].x, a.mallets[1].z + (L / 2 - 0.35));
  const db = Math.hypot(b.mallets[1].x, b.mallets[1].z + (L / 2 - 0.35));
  assert.ok(db > da, 'hard moves further in the same time');
});

test('a mallet pressing the puck into a corner gives way instead of pinning it', () => {
  const s = live();
  s.puck.x = W / 2 - PUCK_R;
  s.puck.z = -(L / 2 - PUCK_R);
  s.puck.vx = 0;
  s.puck.vz = 0;
  let hits = 0;
  for (let i = 0; i < 240; i++) {
    moveMalletTo(s, 1, { x: W / 2, z: -L / 2 }, DT, 3);
    const e = step(s, DT);
    if (e.hit !== undefined && (e.power ?? 0) > 0.3) hits++;
    const d = Math.hypot(s.puck.x - s.mallets[1].x, s.puck.z - s.mallets[1].z);
    assert.ok(d >= PUCK_R + MALLET_R - 1e-3, 'mallet and puck never overlap');
    assert.ok(Math.abs(s.puck.x) <= W / 2 - PUCK_R + 1e-9);
  }
  assert.ok(hits < 60, `no machine-gun hits while pinned (${hits})`);
});

test('predictX follows the puck off the side walls', () => {
  assert.equal(predictX(0, 0, 0, -1, -1), 0);
  assert.ok(Math.abs(predictX(0, 0, 1, -1, -0.5) - 0.5) < 1e-9);
  const lim = W / 2 - PUCK_R;
  const x = predictX(0, 0, 1, -1, -(lim + 0.2));
  assert.ok(Math.abs(x - (lim - 0.2)) < 1e-9, 'one bounce off the right wall');
  assert.equal(predictX(0.3, 0, 1, 1, -1), 0.3, 'a puck moving away keeps its x');
});

test('the computer can play the bottom side too, mirrored', () => {
  const s = live();
  const mem = newAiMem(0);
  s.puck.x = 0.2;
  s.puck.z = -1;
  s.puck.vz = 3;
  const t = aiTarget(s, () => 0.5, 0, mem);
  assert.ok(t.z > 1, 'blocks near its own goal at the bottom');
  assert.ok(Math.abs(t.x - 0.2) < 0.3);
  s.puck.z = 0.8;
  s.puck.vz = 0;
  for (let i = 0; i < 240; i++) {
    stepAI(s, DT, () => 0.5, 0, mem);
    assert.ok(s.mallets[0].z >= 0);
  }
});

test('harder computers win more often, and every level lets the puck reach a goal', () => {
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const play = (top: Difficulty, bottom: Difficulty) => {
    const s = create('cpu', top);
    const mem = newAiMem(0);
    for (let t = 0; t < 240 && s.winner === null; t += DT) {
      stepAI(s, DT, rng);
      s.difficulty = bottom;
      stepAI(s, DT, rng, 0, mem);
      s.difficulty = top;
      const e = step(s, DT);
      if (e.hit === 1 && (e.power ?? 0) > 0.3) aiHit(s);
      if (e.hit === 0 && (e.power ?? 0) > 0.3) aiHit(mem);
    }
    return s.score;
  };
  const tally = (top: Difficulty, bottom: Difficulty) => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 4; i++) {
      const [x, y] = play(top, bottom);
      a += y;
      b += x;
    }
    return { top: a, bottom: b };
  };
  const hardVsEasy = tally('hard', 'easy');
  assert.ok(hardVsEasy.top > hardVsEasy.bottom * 2, `hard beats easy (${hardVsEasy.top}-${hardVsEasy.bottom})`);
  assert.ok(hardVsEasy.top + hardVsEasy.bottom >= 20, 'matches move along');
  const normalVsEasy = tally('normal', 'easy');
  assert.ok(normalVsEasy.top > normalVsEasy.bottom, `normal beats easy (${normalVsEasy.top}-${normalVsEasy.bottom})`);
});
