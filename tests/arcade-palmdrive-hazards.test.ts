import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLASSES, KART_R, OFFROAD, RIVALS, createRace, hazardD, hazardS, hazardV, inBus, moveHazards, spawn, step, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { BUS_LEN, deltaS, headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

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
