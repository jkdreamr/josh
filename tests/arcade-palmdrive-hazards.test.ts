import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLASSES, KART_R, OFFROAD, RIVALS, createRace, hazardD, moveHazards, spawn, step, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race round the Red Barn, past the lights, with n hand-driven karts. */
function barn(n = 1): Race {
  return createRace({ cc: '100cc', course: 'barn', seed: 5, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), v, i: at.i, s: at.s, d: at.d, prog: s });
}

function run(r: Race, seconds: number, each?: () => void): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
    each?.();
  }
  return all;
}

const find = (r: Race, kind: LiveHazard['kind'], pick: (h: LiveHazard) => boolean = () => true) => {
  const h = r.hazards.find((x) => x.kind === kind && pick(x));
  assert.ok(h, `a ${kind} on the course`);
  return h;
};

test('the course puts its hazards where the layout says, and Palm Drive has none', () => {
  const r = barn();
  assert.ok(r.hazards.length > 0);
  for (const h of r.hazards) {
    const at = locate(r.track, h.x, h.z);
    assert.ok(Math.abs(at.d - h.at) < 0.2, `${h.kind} at s=${h.s}`);
  }
  assert.deepEqual(createRace({ cc: '100cc', seed: 5, racers: RIVALS }).hazards, []);
});

test('mud slows a kart like the grass, and splashes once on the way in; a star carries it straight through', () => {
  const r = barn(2);
  const [a, b] = r.karts;
  const bog = find(r, 'mud', (h) => h.d === 0 && h.r > 3.2);
  const top = CLASSES['100cc'].top;
  place(r, a, bog.s - 3, 0, top);
  place(r, b, 300, 0, top);
  const evs = run(r, 0.25);
  assert.ok(a.mud && !b.mud);
  assert.ok(a.v < top - 3, `slowed to ${a.v}`);
  assert.ok(b.v > top - 0.5, 'the kart on clean road keeps its speed');
  assert.equal(evs.filter((e) => e.t === 'mud' && e.k === a.idx).length, 1);
  // flat out in the mud it settles at grass speed
  for (let n = 0; n < 60 && a.mud; n++) {
    place(r, a, bog.s, 0, a.v);
    run(r, DT);
  }
  assert.ok(Math.abs(a.v - top * OFFROAD) < 1.5, `mud speed ${a.v}`);

  const c = barn();
  const k = c.karts[0];
  k.star = 3;
  place(c, k, bog.s - 3, 0, top);
  run(c, 0.25);
  assert.ok(!k.mud && k.v > top, 'a star is not slowed');
});

test('hay bales are solid: a kart driving into one bounces off and never ends up inside it', () => {
  const r = barn();
  const k = r.karts[0];
  const bale = find(r, 'hay');
  place(r, k, bale.s - 12, bale.d, 22);
  let closest = Infinity;
  const evs = run(r, 1.5, () => (closest = Math.min(closest, Math.hypot(k.x - bale.x, k.z - bale.z))));
  assert.ok(closest >= bale.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(evs.some((e) => e.t === 'wall' && e.k === k.idx), 'a thump');
  assert.equal(k.spin, 0, 'a bale does not spin you out');
  // stars go straight through
  const s = barn();
  const t = s.karts[0];
  t.star = 3;
  place(s, t, bale.s - 12, bale.d, 22);
  let near = Infinity;
  run(s, 1, () => (near = Math.min(near, Math.hypot(t.x - bale.x, t.z - bale.z))));
  assert.ok(near < bale.r, 'through the middle of it');
});

test('boulders up at the Dish are as solid as the bales', () => {
  const r = createRace({ cc: '100cc', course: 'dish', seed: 5, countdown: 0, racers: [{ name: 'p0', color: '#e53935', kind: 'player' }] });
  const k = r.karts[0];
  const rock = find(r, 'rock');
  place(r, k, rock.s - 12, rock.d, 22);
  let closest = Infinity;
  const evs = run(r, 1.5, () => (closest = Math.min(closest, Math.hypot(k.x - rock.x, k.z - rock.z))));
  assert.ok(closest >= rock.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(evs.some((e) => e.t === 'wall' && e.k === k.idx));
});

test('cows wander across the road and back on the race clock, the same on every screen', () => {
  const a = barn();
  const b = barn();
  const cow = find(a, 'cow');
  assert.ok(cow.swing && cow.swing > 0);
  const seen = new Set<number>();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 1200; i++) {
    step(a, DT);
    lo = Math.min(lo, cow.at);
    hi = Math.max(hi, cow.at);
    seen.add(cow.walk);
  }
  b.time = a.time;
  moveHazards(b);
  const twin = find(b, 'cow');
  assert.deepEqual([twin.x, twin.z, twin.at, twin.walk], [cow.x, cow.z, cow.at, cow.walk]);
  assert.ok(hi - lo > cow.swing * 1.8, 'right across');
  assert.ok(Math.abs(lo - (cow.d - cow.swing)) < 0.1 && Math.abs(hi - (cow.d + cow.swing)) < 0.1);
  assert.deepEqual([...seen].sort(), [-1, 1], 'and back again');
  assert.equal(hazardD(cow, a.time), cow.at);
  const at = locate(a.track, cow.x, cow.z);
  assert.ok(Math.abs(at.d - cow.at) < 0.2 && Math.abs(at.s - cow.s) < 1);
});

test('running into a cow spins you out and it moos; a mega kart ploughs on', () => {
  const r = barn();
  const k = r.karts[0];
  const cow = find(r, 'cow');
  place(r, k, cow.s - 4, cow.at, 18);
  const evs = run(r, 0.5);
  assert.ok(evs.some((e) => e.t === 'moo' && e.k === k.idx));
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin' && e.by === -1));
  const m = barn();
  const big = m.karts[0];
  big.mega = 3;
  const cow2 = find(m, 'cow');
  place(m, big, cow2.s - 4, cow2.at, 18);
  const quiet = run(m, 0.5);
  assert.ok(!quiet.some((e) => e.t === 'moo' || e.t === 'hit'));
});

test('shells break on hay bales', () => {
  const r = barn();
  const k = r.karts[0];
  const bale = find(r, 'hay');
  place(r, k, bale.s - 60, 0, 0);
  const from = pointAt(r.track, bale.s - 14, bale.d);
  const shell = spawn(r, { kind: 'green', owner: k.idx, x: from.x, z: from.z, y: 0.35, vx: from.tx * 42, vz: from.tz * 42, vy: 0, grace: 0, target: -1, prog: 0 });
  run(r, 0.6);
  assert.ok(!r.things.some((t) => t.id === shell.id), 'gone');
});

test('CPU drivers steer round the bales and the cow, and only some of them end up in the puddles', () => {
  const r = createRace({ cc: '150cc', course: 'barn', seed: 9, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
  const knocks = { bale: 0, cow: 0, mud: 0 };
  while (r.time < 600 && r.karts.some((k) => k.done === null)) {
    step(r, DT);
    for (const e of r.events.splice(0)) {
      if (e.t === 'moo') knocks.cow++;
      if (e.t === 'mud') knocks.mud++;
      if (e.t === 'wall') {
        const k = r.karts[e.k];
        if (r.hazards.some((h) => h.kind === 'hay' && Math.hypot(h.x - k.x, h.z - k.z) < h.r + 2)) knocks.bale++;
      }
    }
  }
  assert.ok(r.karts.every((k) => k.done !== null));
  // forty laps between them
  assert.ok(knocks.bale <= 8, `bales ${knocks.bale}`);
  assert.ok(knocks.cow <= 6, `cows ${knocks.cow}`);
  // the bog goes right across the road, so everyone goes through it every lap
  assert.ok(knocks.mud >= 40 && knocks.mud <= 110, `mud ${knocks.mud}`);
});
