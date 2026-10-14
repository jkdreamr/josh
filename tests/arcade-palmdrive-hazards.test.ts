import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLASSES, KART_R, OFFROAD, RIVALS, SPLASH_T, createRace, hazardD, hazardS, hazardV, inBus, moveHazards, spawn, step, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { BALL_WINDOW, BUS_LEN, CART_LEN, ballDue, ballNear, ballSince, deltaS, headingOf, locate, pointAt, wrapAngle } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race round the Red Barn, past the lights, with n hand-driven karts. */
function barn(n = 1): Race {
  return createRace({ cc: '100cc', course: 'barn', seed: 5, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

/** The same at Hoover Nights. */
function hoover(n = 1, seed = 5): Race {
  return createRace({ cc: '100cc', course: 'hoover', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
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

/** A race round the Main Quad, past the lights, with n hand-driven karts. */
function quad(n = 1): Race {
  return createRace({ cc: '100cc', course: 'quad', seed: 5, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

test('planters on the Main Quad are solid, and shells break on them', () => {
  const r = quad();
  const k = r.karts[0];
  const planter = find(r, 'planter');
  place(r, k, planter.s - 12, planter.d, 22);
  let closest = Infinity;
  const evs = run(r, 1.5, () => (closest = Math.min(closest, Math.hypot(k.x - planter.x, k.z - planter.z))));
  assert.ok(closest >= planter.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(evs.some((e) => e.t === 'wall' && e.k === k.idx), 'a thump');
  assert.equal(k.spin, 0, 'a planter does not spin you out');
  const s = quad();
  place(s, s.karts[0], planter.s - 60, 0, 0);
  // thrown straight at it from just round the corner
  const from = pointAt(s.track, planter.s - 14, planter.d);
  const [dx, dz] = [planter.x - from.x, planter.z - from.z].map((v) => (v / Math.hypot(planter.x - from.x, planter.z - from.z)) * 42);
  const shell = spawn(s, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: dx, vz: dz, vy: 0, grace: 0, target: -1, prog: 0 });
  run(s, 0.6);
  assert.ok(!s.things.some((t) => t.id === shell.id), 'the shell is gone');
});

test('cyclists ride across the road and back on the race clock, quicker than the cows, the same on every screen', () => {
  const a = quad();
  const b = quad();
  const bike = find(a, 'bike');
  const cow = find(barn(), 'cow');
  assert.ok(bike.swing && bike.swing > 0 && bike.r < cow.r, 'smaller than a cow');
  assert.ok(bike.swing * (bike.speed ?? 0) > 2 * cow.swing! * (cow.speed ?? 0), 'and a lot quicker across');
  const seen = new Set<number>();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 600; i++) {
    step(a, DT);
    lo = Math.min(lo, bike.at);
    hi = Math.max(hi, bike.at);
    seen.add(bike.walk);
  }
  b.time = a.time;
  moveHazards(b);
  const twin = find(b, 'bike');
  assert.deepEqual([twin.x, twin.z, twin.at, twin.walk], [bike.x, bike.z, bike.at, bike.walk]);
  assert.ok(hi - lo > bike.swing * 1.8, 'right across');
  assert.deepEqual([...seen].sort(), [-1, 1], 'and back again');
  const slope = (hazardD(bike, a.time + 0.001) - hazardD(bike, a.time - 0.001)) / 0.002;
  assert.ok(Math.abs(hazardV(bike, a.time) - slope) < 0.01, 'its speed matches its path');
});

test('riding into a cyclist spins you out with a ding of the bell; a star ploughs on', () => {
  const r = quad();
  const k = r.karts[0];
  const bike = find(r, 'bike');
  place(r, k, bike.s - 4, bike.at, 18);
  const evs = run(r, 0.5);
  assert.ok(evs.some((e) => e.t === 'ding' && e.k === k.idx));
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin' && e.by === -1));
  assert.ok(!evs.some((e) => e.t === 'moo'));
  const s = quad();
  const star = s.karts[0];
  star.star = 3;
  const bike2 = find(s, 'bike');
  place(s, star, bike2.s - 4, bike2.at, 18);
  assert.ok(!run(s, 0.5).some((e) => e.t === 'ding' || e.t === 'hit'));
});

test('a cyclist riding into the side of a kart that is barely moving still knocks it spinning', () => {
  const r = quad();
  const k = r.karts[0];
  const bike = find(r, 'bike');
  // wait until the bike is crossing the middle of the road at speed, then park a kart just ahead of it
  while (Math.abs(hazardV(bike, r.time)) < bike.swing! * (bike.speed ?? 0) * 0.95) run(r, DT);
  const ahead = hazardV(bike, r.time) > 0 ? 1 : -1;
  place(r, k, bike.s, bike.at + ahead * (bike.r + KART_R + 0.4), 0);
  const evs = run(r, 0.4);
  assert.ok(evs.some((e) => e.t === 'ding' && e.k === k.idx), 'rung');
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin'));
});

test('CPU drivers round the Main Quad steer round the planters and time their way past the cyclists', () => {
  const r = createRace({ cc: '150cc', course: 'quad', seed: 9, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
  const knocks = { planter: 0, bike: 0 };
  while (r.time < 600 && r.karts.some((k) => k.done === null)) {
    step(r, DT);
    for (const e of r.events.splice(0)) {
      if (e.t === 'ding') knocks.bike++;
      if (e.t === 'wall') {
        const k = r.karts[e.k];
        if (r.hazards.some((h) => h.kind === 'planter' && Math.hypot(h.x - k.x, h.z - k.z) < h.r + 2)) knocks.planter++;
      }
    }
  }
  assert.ok(r.karts.every((k) => k.done !== null));
  // forty laps between them, past five planters and five cyclists every lap
  assert.ok(knocks.planter <= 6, `planters ${knocks.planter}`);
  assert.ok(knocks.bike <= 8, `bikes ${knocks.bike}`);
});

test('a CPU on a boost brakes for a swerve it cannot make, but not for the bend on the way to it', () => {
  /** Whether a lone CPU coming out of the corner before the planter on the west side, lined up on it at speed, brakes. */
  const brakes = (boost: number, across = 0) => {
    const r = createRace({ cc: '200cc', course: 'quad', seed: 5, countdown: 0, racers: [RIVALS[0]] });
    const [k] = r.karts;
    const planter = find(r, 'planter', (h) => Math.abs(h.s - 588) < 1);
    place(r, k, planter.s - 22, planter.d, 34);
    // turned `across` radians off the line of the road, toward the planter's side of it
    const p = pointAt(r.track, k.s);
    const side = Math.sign(planter.d);
    k.h = headingOf(p.tx * Math.cos(across) - p.tz * side * Math.sin(across), p.tz * Math.cos(across) + p.tx * side * Math.sin(across));
    k.boost = boost;
    step(r, DT);
    return k.input.brake;
  };
  assert.equal(brakes(0), true, 'off a boost it slows for the corner and the swerve together');
  assert.equal(brakes(1), false, 'on a boost the corner is no reason to brake, and the swerve past the planter is an easy one');
  assert.equal(brakes(1, 0.45), true, 'but angled across the road at a boost\'s speed it cannot straighten up in time');
  // oil on the apex of a bend at Hoover Nights: on a boost it still slows to make the bend on a line round the slick
  const r = createRace({ cc: '200cc', course: 'hoover', seed: 5, countdown: 0, racers: [RIVALS[0]] });
  const [k] = r.karts;
  const oil = find(r, 'oil', (h) => Math.abs(h.s - 664) < 1);
  place(r, k, oil.s - 24, oil.d, 38);
  k.boost = 1;
  step(r, DT);
  assert.equal(k.input.brake, true, 'slows for oil on a bend');
});

test('oil spins you out; a star skates straight over it', () => {
  const r = hoover();
  const k = r.karts[0];
  const oil = find(r, 'oil');
  place(r, k, oil.s - 6, oil.d, 18);
  const evs = run(r, 0.6);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin' && e.by === -1), 'spun out');
  assert.ok(k.spin > 0 || k.safe > 0);
  const s = hoover();
  const t = s.karts[0];
  t.star = 3;
  place(s, t, oil.s - 6, oil.d, 18);
  let near = Infinity;
  const quiet = run(s, 0.6, () => (near = Math.min(near, Math.hypot(t.x - oil.x, t.z - oil.z))));
  assert.ok(near < oil.r, 'right through it');
  assert.ok(!quiet.some((e) => e.t === 'hit'));
});

test('the buses drive their laps on the race clock, the same on every screen', () => {
  const a = hoover(1, 5);
  const b = hoover(1, 77);
  const buses = a.hazards.filter((h) => h.kind === 'bus');
  assert.equal(buses.length, 2);
  // waiting at their stops until the green light
  const c = createRace({ cc: '100cc', course: 'hoover', seed: 5, racers: RIVALS });
  run(c, 2);
  assert.ok(c.time < 0);
  for (const h of c.hazards.filter((x) => x.kind === 'bus')) assert.equal(h.along, h.s);
  run(a, 7);
  b.time = a.time;
  moveHazards(b);
  buses.forEach((h, i) => {
    const twin = b.hazards.filter((x) => x.kind === 'bus')[i];
    assert.deepEqual([twin.x, twin.z, twin.along, twin.tx, twin.tz], [h.x, h.z, h.along, h.tx, h.tz]);
    assert.ok(Math.abs(deltaS(a.track, h.s, h.along) - h.drive! * a.time) < 0.01, 'steadily on from its stop');
    assert.equal(hazardS(a.track, h, a.time), h.along);
    // in its own lane, facing down the road
    const at = locate(a.track, h.x, h.z);
    assert.ok(Math.abs(at.d - h.d) < 0.2 && Math.abs(deltaS(a.track, at.s, h.along)) < 1);
    assert.ok(Math.abs(h.tx - at.tx) < 0.05 && Math.abs(h.tz - at.tz) < 0.05);
  });
  // and round the lap and back past their stops
  const bus = buses[0];
  const lap = a.track.length / bus.drive!;
  a.time = lap + 3;
  moveHazards(a);
  assert.ok(Math.abs(deltaS(a.track, bus.s, bus.along) - bus.drive! * 3) < 0.01, `round again at s=${bus.along}`);
  assert.ok(a.hazards.filter((h) => h.kind === 'bus').every((h) => h.along >= 0 && h.along < a.track.length));
});

/** A kart driving up behind a bus, in its lane, and the bus itself. */
function behindBus(r: Race, k: Kart, gap: number, v: number) {
  const bus = find(r, 'bus');
  place(r, k, bus.along - BUS_LEN / 2 - gap, bus.d, v);
  return bus;
}

test('a bus is solid: run into the back of one and you bounce off, spin out and it honks', () => {
  const r = hoover();
  const k = r.karts[0];
  const bus = behindBus(r, k, 8, 24);
  let inside = false;
  const evs = run(r, 1.2, () => (inside ||= inBus(bus, k.x, k.z, KART_R - 0.05) !== null));
  assert.ok(!inside, 'never ends up inside it');
  assert.ok(evs.some((e) => e.t === 'honk' && e.k === k.idx), 'the horn');
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin' && e.by === -1), 'spun out');
  assert.ok(deltaS(r.track, k.s, bus.along) > BUS_LEN / 2, 'left behind it');
});

test('a bus runs down a kart sitting in its lane and shoves it along', () => {
  const r = hoover();
  const k = r.karts[0];
  const bus = find(r, 'bus');
  // just ahead of the bus's nose, stopped with the brake on
  r.time = 2;
  moveHazards(r);
  place(r, k, bus.along + BUS_LEN / 2 + 1.5, bus.d, 0);
  k.input.brake = true;
  const from = k.s;
  const evs = run(r, 0.6);
  assert.ok(evs.some((e) => e.t === 'honk' && e.k === k.idx));
  assert.ok(deltaS(r.track, from, k.s) > 2, 'pushed on ahead');
  assert.equal(inBus(bus, k.x, k.z, KART_R - 0.05), null);
});

test('brushing past a bus only nudges you away; passing on the free side is clear', () => {
  const r = hoover(2);
  const [a, b] = r.karts;
  // the bus that comes round onto the start straight first
  const bus = r.hazards.filter((h) => h.kind === 'bus').sort((p, q) => q.s - p.s)[0];
  r.time = (r.track.length - bus.s + 20) / bus.drive!;
  moveHazards(r);
  assert.ok(bus.along > 10 && bus.along < 40, `on the straight at s=${bus.along}`);
  // a little closer than the side of the bus, at the same speed: pushed out sideways, no spin
  const side = -Math.sign(bus.d);
  place(r, a, bus.along, bus.d + side * (bus.r + KART_R - 0.3), bus.drive);
  // well out in the free lane, overtaking
  place(r, b, bus.along - 20, -bus.d, 22);
  const evs = run(r, 3);
  assert.ok(!evs.some((e) => e.t === 'honk' || e.t === 'hit'), 'nobody spun');
  assert.equal(inBus(bus, a.x, a.z, KART_R - 0.05), null, 'pushed out');
  assert.ok(deltaS(r.track, bus.along, b.s) > BUS_LEN, 'got past');
});

test('shells break on a bus; stars, megas and bullets plough straight through one', () => {
  const r = hoover();
  const k = r.karts[0];
  const bus = find(r, 'bus');
  place(r, k, bus.along - 60, 0, 0);
  const from = pointAt(r.track, bus.along - 16, bus.d);
  const shell = spawn(r, { kind: 'green', owner: k.idx, x: from.x, z: from.z, y: 0.35, vx: from.tx * 42, vz: from.tz * 42, vy: 0, grace: 0, target: -1, prog: 0 });
  run(r, 0.6);
  assert.ok(!r.things.some((t) => t.id === shell.id), 'gone');
  // nosing into the back of a bus: an ordinary kart is thrown back out, a star, mega or bullet drives on into it
  for (const power of [null, 'star', 'mega', 'bullet'] as const) {
    const s = hoover();
    const t = s.karts[0];
    if (power) t[power] = 3;
    const b = find(s, 'bus');
    place(s, t, b.along - BUS_LEN / 2 - KART_R + 0.6, b.d, 24);
    const evs = run(s, 3 * DT);
    if (power) {
      assert.ok(inBus(b, t.x, t.z, 0) !== null, `${power}: still going through it`);
      assert.ok(!evs.some((e) => e.t === 'honk' || e.t === 'hit'), `${power}: untouched`);
    } else {
      assert.equal(inBus(b, t.x, t.z, KART_R - 0.05), null, 'thrown out');
      assert.ok(evs.some((e) => e.t === 'honk'));
    }
  }
});

test('CPU drivers get past the buses on the free side and mostly miss the oil', () => {
  const r = createRace({ cc: '150cc', course: 'hoover', seed: 9, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
  const knocks = { bus: 0, oil: 0 };
  const buses = r.hazards.filter((h) => h.kind === 'bus');
  // which side of each bus each kart was on last frame, to count overtakes
  const behind = r.karts.map(() => buses.map(() => false));
  let passes = 0;
  while (r.time < 600 && r.karts.some((k) => k.done === null)) {
    step(r, DT);
    r.karts.forEach((k, i) =>
      buses.forEach((h, j) => {
        const ds = deltaS(r.track, h.along, k.s);
        if (behind[i][j] && ds > 0 && ds < 15 && k.done === null) passes++;
        behind[i][j] = ds < 0 && ds > -15;
      }),
    );
    for (const e of r.events.splice(0)) {
      if (e.t === 'honk') knocks.bus++;
      if (e.t === 'hit' && e.by === -1) {
        const k = r.karts[e.k];
        if (r.hazards.some((h) => h.kind === 'oil' && Math.hypot(h.x - k.x, h.z - k.z) < h.r + 1)) knocks.oil++;
      }
    }
  }
  assert.ok(r.karts.every((k) => k.done !== null));
  // forty laps between them, past the buses dozens of times
  assert.ok(passes >= 30, `${passes} passes`);
  assert.ok(knocks.bus <= 6, `buses ${knocks.bus}`);
  assert.ok(knocks.oil <= 10, `oil ${knocks.oil}`);
});

/** A race round the golf course, past the lights, with n hand-driven karts. */
function golf(n = 1, seed = 5): Race {
  return createRace({ cc: '100cc', course: 'golf', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

test('a bunker slows you like mud, with a puff of sand on the way in; a star blasts straight through', () => {
  const r = golf();
  const k = r.karts[0];
  const bunker = find(r, 'sand', (h) => h.d === 0);
  const top = CLASSES['100cc'].top;
  place(r, k, bunker.s - 4, 0, top);
  const evs = run(r, 0.25);
  assert.ok(k.mud && k.sand, 'in the sand');
  assert.ok(k.v < top - 3, `slowed to ${k.v}`);
  assert.equal(evs.filter((e) => e.t === 'sand' && e.k === k.idx).length, 1);
  assert.ok(!evs.some((e) => e.t === 'mud'), 'sand, not mud');
  const s = golf();
  const t = s.karts[0];
  t.star = 3;
  place(s, t, bunker.s - 4, 0, top);
  run(s, 0.25);
  assert.ok(!t.mud && !t.sand && t.v > top, 'a star is not slowed');
});

/** A kart on the island green's loop, out on the grass on the inside and turned toward the pond. */
function wide(r: Race, k: Kart, s = 470, v = 14) {
  place(r, k, s, -7.2, v);
  const p = pointAt(r.track, s);
  k.h = headingOf(p.tx, p.tz) + 0.6;
}

test('run wide into a pond and you splash, sit there a moment and are fished out onto the road facing the right way', () => {
  const r = golf();
  const k = r.karts[0];
  wide(r, k);
  const evs = run(r, 0.6);
  assert.equal(evs.filter((e) => e.t === 'splash' && e.k === k.idx).length, 1, 'one splash');
  assert.ok(k.sunk > 0 && k.v === 0, 'in the water');
  const wet = { x: k.x, z: k.z };
  // it goes nowhere while it waits, and can't use an item
  k.item = 'mushroom';
  k.uses = 1;
  k.input.use = true;
  run(r, 0.2);
  assert.equal(k.item, 'mushroom');
  assert.ok(Math.hypot(k.x - wet.x, k.z - wet.z) < 0.01, 'stays put');
  const out: Ev[] = [];
  while (k.sunk > 0 && r.time < 5) out.push(...run(r, DT));
  const left = r.time;
  assert.ok(!out.some((e) => e.t === 'splash'), 'no second splash');
  assert.equal(k.sunk, 0, 'fished out');
  // back on the road, facing down it, with a moment's grace
  const at = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(at.d) <= 4.01, `set down on the road at d=${at.d}`);
  assert.ok(Math.abs(wrapAngle(k.h - headingOf(at.tx, at.tz))) < 0.05, 'facing the right way');
  assert.ok(k.safe > 0);
  assert.ok(left > 1 && left < 0.6 + 0.2 + SPLASH_T, `out after ${left}`);
  // it costs the wait and a start from a standstill: a couple of seconds
  assert.ok(SPLASH_T >= 1 && SPLASH_T <= 1.6);
  assert.ok(k.v < 3, `starting again at ${k.v}`);
});

test('flying over the edge of a pond keeps you dry, and a pond never reaches a kart on the road', () => {
  const r = golf();
  const k = r.karts[0];
  wide(r, k);
  k.y = 1.2;
  k.vy = 3;
  const evs = run(r, 0.15);
  assert.ok(!evs.some((e) => e.t === 'splash'), 'over the water');
  // right on the curb on the inside of the loop, all the way round: dry
  const s = golf();
  const t = s.karts[0];
  for (let at = 395; at < 610; at += 5) {
    place(s, t, at, -s.track.half - 0.5, 18);
    assert.ok(!run(s, 2 * DT).some((e) => e.t === 'splash'), `wet on the curb at s=${at}`);
  }
});

test('golf balls come down on the race clock, the same on every screen, with a window either side of touchdown', () => {
  const a = golf();
  const ball = find(a, 'ball');
  const every = ball.every!;
  // touchdowns at phase + n * every
  for (let n = 0; n < 4; n++) {
    const when = (ball.phase ?? 0) + n * every;
    assert.ok(Math.abs(ballNear(ball, when)) < 1e-9);
    assert.ok(Math.abs(ballNear(ball, when - 0.1) + 0.1) < 1e-9, 'still coming down');
    assert.ok(Math.abs(ballNear(ball, when + 0.1) - 0.1) < 1e-9, 'bouncing away');
    assert.ok(ballDue(ball, when - 0.5, when + 0.5) && !ballDue(ball, when + 0.5, when + every - 0.5));
  }
  assert.ok(ballSince(ball, 3.3) >= 0 && ballSince(ball, 3.3) < every);
});

/** The next race time a ball comes down after `from`. */
const nextLanding = (h: LiveHazard, from: number) => from + ((h.every! - ballSince(h, from)) % h.every!);

test('a golf ball landing on your kart bonks it into a spin; between balls, high in the air or under a star it is harmless', () => {
  for (const how of ['bonk', 'between', 'air', 'star'] as const) {
    const r = golf();
    const k = r.karts[0];
    const ball = find(r, 'ball', (h) => h.s > 800);
    const due = nextLanding(ball, 2);
    // parked on the spot a moment before it lands (or halfway between two balls)
    r.time = how === 'between' ? due + ball.every! / 2 - 0.4 : due - 0.4;
    place(r, k, ball.s, ball.d, 0);
    k.input.brake = true;
    if (how === 'star') k.star = 3;
    const evs =
      how === 'air'
        ? // sailing over it off a jump
          run(r, 0.8, () => {
            k.y = 1.6;
            k.vy = 0;
            place(r, k, ball.s, ball.d, 0);
          })
        : run(r, 0.8);
    const bonked = evs.some((e) => e.t === 'plink' && e.k === k.idx) && evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin');
    assert.equal(bonked, how === 'bonk', how);
  }
  // a kart beside the spot, out of reach, is fine
  const r = golf();
  const k = r.karts[0];
  const ball = find(r, 'ball', (h) => h.s > 800);
  r.time = nextLanding(ball, 2) - 0.4;
  place(r, k, ball.s, ball.d - Math.sign(ball.d || 1) * (ball.r + KART_R + 0.3), 0);
  k.input.brake = true;
  assert.ok(!run(r, 0.8).some((e) => e.t === 'plink'));
  assert.ok(BALL_WINDOW > 0.1 && BALL_WINDOW < 0.3);
});

test('golfers walk across with their bags on the race clock: run into one and you spin out and they shout fore', () => {
  const a = golf();
  const b = golf();
  const g = find(a, 'golfer');
  assert.ok(g.swing && g.swing > 0 && (g.speed ?? 0) <= 0.7, 'walking');
  run(a, 5);
  b.time = a.time;
  moveHazards(b);
  const twin = find(b, 'golfer');
  assert.deepEqual([twin.x, twin.z, twin.at, twin.walk], [g.x, g.z, g.at, g.walk]);
  // a foursome crosses together, one behind the other
  const lead = find(a, 'golfer', (h) => h.s > 490 && h.s < 500);
  const four = a.hazards.filter((h) => h.kind === 'golfer' && h.phase === lead.phase && h.speed === lead.speed);
  assert.equal(four.length, 4);
  for (const h of four) assert.equal(h.at, four[0].at);
  const r = golf();
  const k = r.karts[0];
  const walker = find(r, 'golfer');
  place(r, k, walker.s - 4, walker.at, 18);
  const evs = run(r, 0.5);
  assert.ok(evs.some((e) => e.t === 'fore' && e.k === k.idx), 'fore!');
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin' && e.by === -1));
});

test('golf carts drive their rounds like the buses: run into the back of one and you spin out to its beep-beep', () => {
  const a = golf(1, 5);
  const b = golf(1, 77);
  const carts = a.hazards.filter((h) => h.kind === 'cart' && h.drive);
  assert.equal(carts.length, 3);
  run(a, 6);
  b.time = a.time;
  moveHazards(b);
  carts.forEach((h, i) => {
    const twin = b.hazards.filter((x) => x.kind === 'cart' && x.drive)[i];
    assert.deepEqual([twin.x, twin.z, twin.along], [h.x, h.z, h.along]);
    assert.ok(Math.abs(deltaS(a.track, h.s, h.along) - h.drive! * a.time) < 0.01);
  });
  const r = golf();
  const k = r.karts[0];
  const cart = find(r, 'cart', (h) => !!h.drive);
  place(r, k, cart.along - CART_LEN / 2 - 8, cart.d, 22);
  let inside = false;
  const evs = run(r, 1.2, () => (inside ||= inBus(cart, k.x, k.z, KART_R - 0.05) !== null));
  assert.ok(!inside, 'never ends up inside it');
  assert.ok(evs.some((e) => e.t === 'toot' && e.k === k.idx), 'beep-beep');
  assert.ok(!evs.some((e) => e.t === 'honk'), 'a cart is not a bus');
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin'));
  assert.ok(CART_LEN < BUS_LEN / 2);
});

test('carts crossing on the cart paths go back and forth, and running into one spins you out too', () => {
  const r = golf();
  const cart = find(r, 'cart', (h) => !!h.swing);
  let lo = Infinity;
  let hi = -Infinity;
  run(r, (Math.PI * 2) / (cart.speed ?? 1), () => {
    lo = Math.min(lo, cart.at);
    hi = Math.max(hi, cart.at);
  });
  assert.ok(hi - lo > cart.swing! * 1.8, 'right across');
  const s = golf();
  const k = s.karts[0];
  const c2 = find(s, 'cart', (h) => !!h.swing);
  place(s, k, c2.s - 4, c2.at, 18);
  const evs = run(s, 0.5);
  assert.ok(evs.some((e) => e.t === 'toot' && e.k === k.idx));
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === k.idx && e.how === 'spin'));
});

test('flagsticks are solid but small: a thump, no spin, and shells break on them', () => {
  const r = golf();
  const k = r.karts[0];
  const pin = find(r, 'pin');
  assert.ok(pin.r <= 0.6);
  place(r, k, pin.s - 12, pin.d, 22);
  let closest = Infinity;
  const evs = run(r, 1.2, () => (closest = Math.min(closest, Math.hypot(k.x - pin.x, k.z - pin.z))));
  assert.ok(closest >= pin.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(evs.some((e) => e.t === 'wall' && e.k === k.idx));
  assert.equal(k.spin, 0);
  const s = golf();
  place(s, s.karts[0], pin.s - 60, 0, 0);
  const from = pointAt(s.track, pin.s - 14, pin.d);
  const [dx, dz] = [pin.x - from.x, pin.z - from.z].map((v) => (v / Math.hypot(pin.x - from.x, pin.z - from.z)) * 42);
  const shell = spawn(s, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: dx, vz: dz, vy: 0, grace: 0, target: -1, prog: 0 });
  run(s, 0.6);
  assert.ok(!s.things.some((th) => th.id === shell.id), 'the shell is gone');
});

test('CPU drivers round the golf course mostly miss the carts, golfers, balls and flagsticks, and stay out of the water', () => {
  const r = createRace({ cc: '150cc', course: 'golf', seed: 9, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
  const knocks = { toot: 0, fore: 0, plink: 0, splash: 0, pin: 0, sand: 0 };
  while (r.time < 600 && r.karts.some((k) => k.done === null)) {
    step(r, DT);
    for (const e of r.events.splice(0)) {
      if (e.t === 'toot' || e.t === 'fore' || e.t === 'plink' || e.t === 'splash' || e.t === 'sand') knocks[e.t]++;
      if (e.t === 'wall') {
        const k = r.karts[e.k];
        if (r.hazards.some((h) => h.kind === 'pin' && Math.hypot(h.x - k.x, h.z - k.z) < h.r + 2)) knocks.pin++;
      }
    }
  }
  assert.ok(r.karts.every((k) => k.done !== null));
  // forty laps between them, past three carts on their rounds, two crossings, eight golfers and a dozen balls a lap
  assert.ok(knocks.toot <= 8, `carts ${knocks.toot}`);
  assert.ok(knocks.fore <= 8, `golfers ${knocks.fore}`);
  assert.ok(knocks.plink <= 10, `balls ${knocks.plink}`);
  assert.ok(knocks.pin <= 6, `flagsticks ${knocks.pin}`);
  assert.ok(knocks.splash <= 2, `splashes ${knocks.splash}`);
  // seven bunkers a lap: they get some of it, not most
  assert.ok(knocks.sand <= 120, `bunkers ${knocks.sand}`);
});
