import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distTo, planNow } from '../src/os/arcade/games/mini-golf/bot.ts';
import { HOLES, TOTAL_PAR } from '../src/os/arcade/games/mini-golf/holes.ts';
import { MAX_STROKES, applyPutt, forfeitHole, holeDone, label, newMatch, nextUp, overDetail, startHole, total, winner, type Golfer } from '../src/os/arcade/games/mini-golf/match.ts';
import { parse } from '../src/os/arcade/games/mini-golf/net.ts';
import { CUP_R, CUP_V, DMAX, MIN_ROLL, R, WALL_R, captureSpeed, closestOnSeg, inside, pondK, restBall, segments, shotDistance, simulate, step, strike, type Ball } from '../src/os/arcade/games/mini-golf/physics.ts';
import type { Hole } from '../src/os/arcade/games/mini-golf/holes.ts';

const golfers = (n: number): Golfer[] => Array.from({ length: n }, (_, i) => ({ name: `G${i}`, color: '#fff', kind: 'human', level: 'normal', left: false }));

test('nine holes with tees and cups on the green', () => {
  assert.equal(HOLES.length, 9);
  assert.equal(new Set(HOLES.map((h) => h.name)).size, 9);
  assert.equal(TOTAL_PAR, HOLES.reduce((s, h) => s + h.par, 0));
  for (const h of HOLES) {
    assert.ok(inside(h.outline, h.tee.x, h.tee.z), `${h.name} tee`);
    assert.ok(inside(h.outline, h.cup.x, h.cup.z), `${h.name} cup`);
    assert.ok(distTo(h, h.tee.x, h.tee.z) < 50, `${h.name} cup reachable from the tee`);
    assert.ok(h.par >= 2 && h.par <= 4);
  }
});

test('putts are deterministic', () => {
  for (const h of HOLES) {
    const a = simulate(h, strike(restBall(h.tee.x, h.tee.z), 0.1, 0.7, 30));
    const b = simulate(h, strike(restBall(h.tee.x, h.tee.z), 0.1, 0.7, 30));
    assert.deepEqual(a, b);
    assert.notEqual(a.state, 'roll');
    if (a.state === 'rest') assert.ok(inside(h.outline, a.x, a.z), `${h.name} ball stays on the course`);
  }
});

test('a soft putt rolls a little and stops', () => {
  const h = HOLES[0];
  const end = simulate(h, strike(restBall(h.tee.x, h.tee.z), 0, 0.2, 0));
  assert.equal(end.state, 'rest');
  assert.ok(end.x > h.tee.x + 2.5 && end.x < h.tee.x + 4.2);
});

// A big flat green with the cup at (cx, 0).
const flat = (cx = 40) => ({ ...HOLES[0], ground: [], ponds: [], posts: [], movers: [], walls: [], loop: undefined, tee: { x: 0, z: 0 }, cup: { x: cx, z: 0 }, outline: [{ x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 }] });
const roll = (x: number, z: number, vx: number): Ball => ({ ...restBall(x, z), state: 'roll', vx });

test('putt distance grows in step with power, so short putts are short', () => {
  const h = flat();
  for (const [p, lo, hi] of [[0.1, 1.4, 1.9], [0.2, 3, 3.6], [0.5, 7.6, 8.8], [1, 15.5, 17.5]]) {
    const end = simulate(h, strike(restBall(0, 0), 0, p, 0));
    assert.ok(end.x > lo && end.x < hi, `power ${p} rolled ${end.x.toFixed(2)} ft`);
    assert.ok(Math.abs(end.x - shotDistance(p)) < 0.15, `preview length matches the roll at ${p}`);
  }
  const tiny = simulate(h, strike(restBall(0, 0), 0, 0.01, 0));
  assert.ok(tiny.x > MIN_ROLL - 0.05, 'the softest putt still moves the ball');
});

test('a light tap holes a short putt', () => {
  for (const [d, p] of [[1, 0.1], [2, 0.15], [3, 0.22]]) assert.equal(simulate(flat(d), strike(restBall(0, 0), 0, p, 0)).state, 'holed', `${d} ft at ${p}`);
});

test('the cup is sized like a real one and takes firm putts through the middle', () => {
  assert.ok(CUP_R / R > 2.3 && CUP_R / R < 2.7);
  const h = flat(5);
  const edge = 5 - CUP_R - 0.005;
  assert.equal(simulate(h, roll(edge, 0.8 * CUP_R, 3.3)).state, 'holed', 'slow ball dropping on the edge');
  assert.notEqual(simulate(h, roll(edge, 0.8 * CUP_R, 4.2)).state, 'holed', 'quick ball on the edge lips out');
  assert.equal(simulate(h, roll(edge, 0, 4.8)).state, 'holed', 'firm ball through the middle');
  assert.equal(simulate(h, roll(edge, 0, 5.6)).state, 'holed', 'a firm putt dead center drops');
  assert.notEqual(simulate(h, roll(edge, 0, 7.5)).state, 'holed', 'a blast hops over');
});

test('capture speed falls off from the middle of the cup to the rim', () => {
  assert.equal(captureSpeed(0), CUP_V);
  assert.ok(captureSpeed(0.5 * CUP_R) > 0.85 * CUP_V);
  assert.ok(captureSpeed(0.9 * CUP_R) < 0.5 * CUP_V);
  assert.equal(captureSpeed(CUP_R), 0);
});

test('a ball too quick for the cup lips out: it slows and turns toward the side the cup was on', () => {
  const h = flat(5);
  for (const side of [1, -1]) {
    const b = roll(5 - CUP_R - 0.05, side * 0.6 * CUP_R, 5.5);
    let lipped = false;
    for (let i = 0; i < 400 && b.state === 'roll' && !lipped; i++) lipped = step(h, b).lip;
    assert.ok(lipped, 'lips out');
    assert.notEqual(b.state, 'holed');
    assert.ok(Math.hypot(b.vx, b.vz) < 5.5 * 0.85, 'loses pace on the rim');
    assert.ok(Math.sign(b.vz) === -side, 'turned toward the cup side');
  }
  const hop = roll(5 - CUP_R - 0.05, 0, 7.5);
  while (hop.state === 'roll' && hop.x < 5 + CUP_R + 0.1) step(h, hop);
  assert.ok(Math.abs(hop.vz) < 1e-9, 'dead center it hops straight on');
});

test('the cup is swept, so a ball that clears it in one step still meets the rim', () => {
  const h = flat(5);
  const b = roll(5 - 0.07, 0.335, 18);
  assert.ok(Math.hypot(b.x - 5, b.z) > CUP_R, 'starts off the cup');
  const ev = step(h, b);
  assert.ok(b.x > 5 && Math.hypot(b.x - 5, b.z) > CUP_R, 'stepped clean over the cup');
  assert.ok(ev.lip, 'met the rim on the way');
  const slow = roll(5 - CUP_R - 0.04, 0.2, 0.9);
  assert.equal(simulate(h, slow).state, 'holed');
});

test('a ball that dies hanging on the lip tips in', () => {
  const h = flat(5);
  assert.equal(simulate(h, roll(4.65, CUP_R + 0.02, 0.9)).state, 'holed');
});

// Putts aimed at the cup from every clear lie around it on every hole, over a range of pace and aim errors.
const clearLine = (h: Hole, x: number, z: number) => {
  if (!inside(h.outline, x, z) || (h.ponds.length && pondK(h, x, z) < 1.3)) return false;
  for (let k = 0; k <= 40; k++) {
    const px = x + ((h.cup.x - x) * k) / 40;
    const pz = z + ((h.cup.z - z) * k) / 40;
    for (const s of segments(h)) {
      const c = closestOnSeg(s, px, pz);
      if (Math.hypot(px - c.x, pz - c.z) < WALL_R + 0.12) return false;
    }
    if (h.posts.some((p) => Math.hypot(px - p.x, pz - p.z) < p.r + R + 0.12)) return false;
    for (const m of h.movers) {
      const mx = m.k === 'sweep' ? m.x : (m.ax + m.bx) / 2;
      const mz = m.k === 'sweep' ? m.z : (m.az + m.bz) / 2;
      const rr = m.k === 'sweep' ? m.len + 0.4 : Math.hypot(m.bx - m.ax, m.bz - m.az) / 2 + 0.8;
      if (Math.hypot(px - mx, pz - mz) < rr) return false;
    }
    if (h.loop && Math.hypot(px - h.loop.x, pz - h.loop.z) < 1.2) return false;
  }
  return true;
};

test('putts aimed at the cup drop on every hole unless they are hit far too hard', () => {
  for (const h of HOLES) {
    const rate: Record<string, [number, number]> = {};
    let lies = 0;
    for (const d of [1, 2.5, 4]) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = h.cup.x + Math.cos(ang) * d;
        const z = h.cup.z + Math.sin(ang) * d;
        if (!clearLine(h, x, z)) continue;
        lies++;
        const base = Math.atan2(h.cup.z - z, h.cup.x - x);
        // Pace is how far past the cup it would roll on a flat green; aim is how far off center it is.
        for (const past of [1, 2, 4, 6, 14]) {
          for (const aim of [0, 0.25, 0.5, 0.75]) {
            for (const side of [1, -1]) {
              const end = simulate(h, strike(restBall(x, z), base + side * Math.asin((aim * CUP_R) / d), Math.min(1, (d + past) / DMAX), 0));
              const key = `${past} ${aim}`;
              rate[key] ??= [0, 0];
              rate[key][1]++;
              if (end.state === 'holed') rate[key][0]++;
            }
          }
        }
      }
    }
    assert.ok(lies >= 4, `${h.name} has clear lies near the cup`);
    const pct = (k: string) => rate[k][0] / rate[k][1];
    for (const past of [1, 2, 4]) for (const aim of [0, 0.25, 0.5]) assert.equal(pct(`${past} ${aim}`), 1, `${h.name}: ${past} ft past, ${aim} of the cup off center`);
    // Firm putts on the sloped greens can break a little before they reach the cup.
    for (const aim of [0, 0.25, 0.5]) assert.ok(pct(`6 ${aim}`) >= 0.95, `${h.name}: 6 ft past, ${aim} off center dropped ${pct(`6 ${aim}`)}`);
    for (const past of [1, 2, 4]) assert.ok(pct(`${past} 0.75`) >= 0.9, `${h.name}: near the edge at ${past} ft past dropped ${pct(`${past} 0.75`)}`);
    assert.ok(pct('6 0.75') < 0.7, `${h.name}: a firm putt that only clips the edge can lip out`);
    assert.ok(pct('14 0') < 0.8, `${h.name}: a blast from close can hop the cup`);
  }
});

test('Palm Drive can be aced and the Dish loop can be cleared', () => {
  const h = HOLES[0];
  assert.equal(simulate(h, strike(restBall(h.tee.x, h.tee.z), -0.22, 0.9, 0)).state, 'holed');
  const dish = HOLES[3];
  const looped = simulate(dish, strike(restBall(dish.tee.x, dish.tee.z), 0, 0.9, 0));
  assert.ok(looped.x > dish.loop!.x + 1, 'full speed makes it round the loop');
  const weak = simulate(dish, strike(restBall(dish.tee.x, dish.tee.z), 0, 0.6, 0));
  assert.ok(weak.x < dish.loop!.x, 'too soft and it rolls back out');
});

test('Lake Lagunita takes balls hit straight at it', () => {
  const h = HOLES[4];
  const end = simulate(h, strike(restBall(h.tee.x, h.tee.z), 0.02, 0.6, 0));
  assert.equal(end.state, 'water');
});

test('water costs a stroke and replays from the same spot', () => {
  const m = newMatch(golfers(1));
  startHole(m, 4);
  const h = HOLES[4];
  const from = { x: h.tee.x, z: h.tee.z };
  const end = simulate(h, strike(restBall(from.x, from.z), 0.02, 0.6, 0));
  assert.equal(applyPutt(m, 0, from, end), 'water');
  assert.equal(m.lies[0].strokes, 2);
  assert.equal(m.lies[0].ball.x, from.x);
  assert.equal(m.lies[0].ball.state, 'rest');
});

test('strokes are capped and the hole is picked up', () => {
  const m = newMatch(golfers(1));
  const h = HOLES[0];
  let out = '';
  for (let i = 0; i < MAX_STROKES; i++) out = applyPutt(m, 0, h.tee, restBall(h.tee.x + 0.1, h.tee.z));
  assert.equal(out, 'pickup');
  assert.equal(m.card[0][0], MAX_STROKES);
  assert.ok(holeDone(m));
});

test('farthest from the cup putts next, winner is the lowest total', () => {
  const m = newMatch(golfers(3));
  assert.equal(nextUp(m), 0);
  applyPutt(m, 0, HOLES[0].tee, restBall(10, 0));
  applyPutt(m, 1, HOLES[0].tee, restBall(4, 0));
  applyPutt(m, 2, HOLES[0].tee, restBall(8, 0));
  assert.equal(nextUp(m), 1);
  m.card = [[2, 3], [3, 3], [2, 4]].map((r) => [...r, ...Array(7).fill(-1)]);
  assert.equal(total(m, 0), 5);
  assert.equal(winner(m), 0);
  m.card[1][0] = 2;
  assert.equal(winner(m), null);
  m.golfers[1].left = true;
  assert.equal(winner(m), 0);
  forfeitHole(m, 0);
  assert.equal(m.lies[0].done, true);
});

test('online game over names the winner score and the people in the room', () => {
  const m = newMatch([...golfers(2), { name: 'Ellie', color: '#fff', kind: 'bot', level: 'normal', left: false }]);
  m.card = [[7, 7, 7], [6, 6, 6], [2, 3, 2]].map((r) => [...r, ...Array(6).fill(-1)]);
  const w = winner(m);
  assert.equal(w, 2);
  const d = overDetail(m, 0, w, ['You', 'Sam']);
  assert.match(d, /Ellie took 7 strokes/);
  assert.match(d, /You took 21/);
  assert.match(d, /2 people here: You and Sam/);
  assert.match(overDetail(m, 2, 2, ['Sam']), /^You took 7 strokes\. 1 person here: Sam\.$/);
});

test('score names', () => {
  assert.equal(label(1, 3), 'Hole in One');
  assert.equal(label(2, 3), 'Birdie');
  assert.equal(label(3, 3), 'Par');
  assert.equal(label(5, 3), 'Double Bogey');
  assert.equal(label(7, 3), '+4');
});

test('computer golfers play every hole sensibly', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    let strokes = 0;
    for (const [i, h] of HOLES.entries()) {
      let b = restBall(h.tee.x, h.tee.z);
      let n = 0;
      while (n < MAX_STROKES && b.state !== 'holed') {
        const plan = planNow(h, b, b.t, level, 17 + i * 31 + n);
        const end = simulate(h, strike(b, plan.angle, plan.power, b.t));
        n += end.state === 'water' ? 2 : 1;
        b = end.state === 'water' ? restBall(b.x, b.z, end.t) : end.state === 'holed' ? end : { ...end, state: 'rest' };
      }
      strokes += Math.min(n, MAX_STROKES);
    }
    assert.ok(strokes <= TOTAL_PAR + (level === 'easy' ? 24 : level === 'normal' ? 14 : 8), `${level} took ${strokes}`);
    assert.ok(strokes >= 16, `${level} is not superhuman (${strokes})`);
  }
});

test('packets are validated', () => {
  assert.equal(parse(null), null);
  assert.equal(parse({ game: 'other', k: 'hello', round: 1 }), null);
  assert.equal(parse({ game: 'mini-golf', k: 'shot', round: 1, hole: 0, n: 0, a: 0, p: 3, t: 0, x: 0, z: 0 }), null);
  assert.ok(parse({ game: 'mini-golf', k: 'shot', round: 1, hole: 0, n: 0, a: 0.4, p: 0.5, t: 10, x: 0, z: 0 }));
  assert.ok(parse({ game: 'mini-golf', k: 'hello', round: 2 }));
});
