import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDGE, headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';
import {
  CASH_COST,
  CASH_T,
  DRAFT_BOOST,
  DRAFT_T,
  MAX_COINS,
  PLAYER_COLOR,
  RAMP_H,
  RIVALS,
  SLAM_COOL,
  SLAM_PAD,
  SLAM_T,
  TRICK_T,
  WOBBLE_T,
  createRace,
  giveItem,
  hitKart,
  onRamp,
  spawn,
  step,
  stolen,
  type Ev,
  type Kart,
  type Race,
  type ThingKind,
} from '../src/os/arcade/games/palmdrive/logic.ts';

const DT = 1 / 60;

/** A race already past the lights with n hand-driven karts. */
function race(n: number, seed = 11): Race {
  const racers = Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const }));
  return createRace({ cc: '100cc', seed, countdown: 0, racers });
}

/** Puts a kart at distance s along the loop, d to the right, facing down the road at speed v. */
function place(r: Race, k: Kart, s: number, d: number, v = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  k.x = p.x;
  k.z = p.z;
  k.h = headingOf(p.tx, p.tz);
  k.v = v;
  k.i = at.i;
  k.s = at.s;
  k.d = at.d;
  k.prog = s;
}

function tick(r: Race): Ev[] {
  step(r, DT);
  return r.events.splice(0);
}

function run(r: Race, seconds: number): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) all.push(...tick(r));
  return all;
}

const kinds = (evs: Ev[]) => evs.map((e) => e.t);
const only = <T extends Ev['t']>(evs: Ev[], t: T) => evs.filter((e): e is Extract<Ev, { t: T }> => e.t === t);
const right = (k: Kart) => ({ rx: -Math.cos(k.h), rz: Math.sin(k.h) });
const ahead = (k: Kart) => ({ fx: Math.sin(k.h), fz: Math.cos(k.h) });

/** Drops a banana or shell next to a kart: `along` meters ahead of it (negative is behind), moving at `speed` along its heading. */
function lob(r: Race, k: Kart, kind: ThingKind, along: number, speed = 0) {
  const { fx, fz } = ahead(k);
  return spawn(r, { kind, owner: -1, x: k.x + fx * along, z: k.z + fz * along, y: kind === 'banana' ? 0 : 0.35, vx: fx * speed, vz: fz * speed, vy: 0, grace: 0, target: -1, prog: 0 });
}

// ---------------------------------------------------------------------------------------------------------------
// Slam

/** Two karts side by side on the Palm Drive straight: the slammer 3 m left of the victim. */
function sideBySide() {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, -5, 15);
  place(r, b, 10, -2, 15);
  return { r, a, b };
}

test('a slam starts with a sideways dash toward the kart beside you', () => {
  const { r, a } = sideBySide();
  a.input.slam = true;
  const evs = tick(r);
  assert.deepEqual(only(evs, 'slam'), [{ t: 'slam', k: a.idx }]);
  assert.equal(a.slamT, SLAM_T);
  assert.equal(a.slamCool, SLAM_COOL);
  assert.equal(a.slamSide, 1);
  const { rx, rz } = right(a);
  assert.ok(a.kx * rx + a.kz * rz > 5, 'pushed to the right, toward the other kart');
  assert.equal(a.input.slam, false);
});

test('a slam shoves the kart beside you, makes it wobble and steals a coin', () => {
  const { r, a, b } = sideBySide();
  a.coins = 4;
  b.coins = 3;
  a.input.slam = true;
  tick(r);
  let landed: Extract<Ev, { t: 'slammed' }>[] = [];
  let vBefore = 0;
  for (let n = 0; n < 30 && !landed.length; n++) {
    vBefore = b.v;
    landed = only(tick(r), 'slammed');
  }
  assert.equal(landed.length, 1, 'the slam lands');
  assert.equal(landed[0].k, b.idx);
  assert.equal(landed[0].by, a.idx);
  assert.equal(b.wobble, WOBBLE_T);
  assert.ok(b.v < vBefore * 0.85, `victim slowed from ${vBefore} to ${b.v}`);
  assert.equal(b.coins, 2);
  assert.equal(a.coins, 5);
  assert.equal(a.earned, 1);
  assert.equal(b.earned, 0);
  assert.ok(a.slamHit, 'one slam lands once');
  const { rx, rz } = right(a);
  assert.ok(b.kx * rx + b.kz * rz > 8, 'the victim is knocked away from the slammer');
  const d0 = b.d;
  const after = run(r, 0.3);
  assert.ok(b.d > d0 + 1, `the victim slides right, ${d0} to ${b.d}`);
  assert.equal(only(after, 'slammed').length, 0, 'and it does not land again');
});

test('a slam on a kart with no coins knocks it about but steals nothing', () => {
  const { r, a, b } = sideBySide();
  a.input.slam = true;
  const landed = only(run(r, 0.5), 'slammed');
  assert.equal(landed.length, 1);
  assert.equal(landed[0].coin, false);
  assert.equal(b.wobble > 0, true);
  assert.equal(a.coins, 0);
  assert.equal(a.earned, 0);
});

/** You and someone else's kart online, side by side (theirs only moves when the network says so, so it waits). */
function withRemote() {
  const r = createRace({ cc: '100cc', seed: 11, countdown: 0, racers: [{ name: 'you', color: PLAYER_COLOR, kind: 'player', seat: 0 }, { name: 'them', color: '#1e88e5', kind: 'remote', seat: 1 }] });
  const [me, them] = r.karts;
  place(r, me, 10, -5, 4);
  place(r, them, 10, -2.5, 0);
  return { r, me, them };
}

test('online, slamming someone else waits for their client to hand over the coin', () => {
  const { r, me, them } = withRemote();
  me.coins = 2;
  me.input.slam = true;
  const landed = only(run(r, 0.5), 'slammed');
  assert.equal(landed.length, 1, 'it lands on our screen');
  assert.deepEqual([landed[0].k, landed[0].by, landed[0].coin], [them.idx, me.idx, false]);
  assert.equal(me.coins, 2, 'no coin until they say so');
  assert.equal(them.wobble, 0, 'their kart is theirs to knock');
  stolen(r, me);
  assert.equal(me.coins, 3);
  assert.equal(me.earned, 1);
  assert.deepEqual(only(r.events.splice(0), 'coin'), [{ t: 'coin', k: me.idx }]);
});

test('online, a slam from someone else lands on your kart a little before the karts touch', () => {
  const { r, me, them } = withRemote();
  me.coins = 3;
  // their slam as the network shows it: live, and their kart just short of ours
  const { rx, rz } = right(me);
  them.x = me.x + rx * (2 * 1.05 + SLAM_PAD / 2);
  them.z = me.z + rz * (2 * 1.05 + SLAM_PAD / 2);
  them.slamT = 0.15;
  them.slamHit = false;
  const landed = only(tick(r), 'slammed');
  assert.equal(landed.length, 1);
  assert.deepEqual([landed[0].k, landed[0].by, landed[0].coin], [me.idx, them.idx, true]);
  assert.equal(me.coins, 2);
  assert.equal(me.wobble, WOBBLE_T);
  assert.ok(me.kx * rx + me.kz * rz < -5, 'knocked away from them');
  assert.equal(only(run(r, 0.2), 'slammed').length, 0, 'once');
  // with nobody slamming, karts that close just drive side by side
  const calm = withRemote();
  calm.them.x = calm.me.x + rx * 2.3;
  calm.them.z = calm.me.z + rz * 2.3;
  assert.equal(only(run(calm.r, 0.2), 'slammed').length, 0);
});

test('a starred kart shrugs off a slam', () => {
  const { r, a, b } = sideBySide();
  b.star = 5;
  b.coins = 3;
  a.input.slam = true;
  const evs = run(r, 0.5);
  assert.ok(kinds(evs).includes('slam'));
  assert.ok(!kinds(evs).includes('slammed'));
  assert.ok(only(evs, 'hit').some((e) => e.k === a.idx && e.by === b.idx), 'the slammer bounced off the star');
  assert.equal(b.wobble, 0);
  assert.equal(b.coins, 3);
  assert.equal(a.coins, 0);
  assert.equal(a.earned, 0);
});

test('with nobody beside, a slam goes the way you steer, or toward the middle of the road', () => {
  for (const [d, steer, side] of [
    [-2, 0, 1],
    [2, 0, -1],
    [-2, -1, -1],
    [2, 1, 1],
  ]) {
    const r = race(1);
    const [k] = r.karts;
    place(r, k, 10, d, 15);
    k.input.steer = steer;
    k.input.slam = true;
    assert.deepEqual(only(tick(r), 'slam'), [{ t: 'slam', k: k.idx }]);
    assert.equal(k.slamSide, side, `d ${d}, steer ${steer}`);
  }
});

test('a slam needs speed and waits out its cooldown', () => {
  const r = race(1);
  const [k] = r.karts;
  place(r, k, 10, -2, 2);
  k.input.slam = true;
  assert.ok(!kinds(tick(r)).includes('slam'), 'too slow to slam');
  k.v = 15;
  k.input.slam = true;
  assert.ok(kinds(tick(r)).includes('slam'));
  run(r, 0.5);
  assert.equal(k.y, 0, 'back on the ground');
  assert.ok(k.slamCool > 0);
  k.input.slam = true;
  assert.ok(!kinds(tick(r)).includes('slam'), 'still cooling down');
  run(r, SLAM_COOL);
  assert.equal(k.slamCool, 0);
  k.input.slam = true;
  assert.ok(kinds(tick(r)).includes('slam'), 'ready again');
});

// ---------------------------------------------------------------------------------------------------------------
// Slipstream

/** A leader at speed on the straight and a follower `gap` meters behind it, `side` meters across. */
function convoy(gap: number, side: number) {
  const r = race(2);
  const [lead, tail] = r.karts;
  place(r, lead, 20 + gap, -2, 20);
  place(r, tail, 20, -2 + side, 20);
  return { r, lead, tail };
}

test('tucking in behind a fast kart charges a slipstream boost', () => {
  const { r, tail } = convoy(10, 0);
  const early = run(r, DRAFT_T - 0.1);
  assert.ok(!kinds(early).includes('draft'), 'not before the slipstream has built up');
  assert.ok(tail.draft > 0.8);
  let got: Ev[] = [];
  for (let n = 0; n < 20 && !got.length; n++) got = only(tick(r), 'draft');
  assert.deepEqual(got, [{ t: 'draft', k: tail.idx }]);
  assert.equal(tail.boost, DRAFT_BOOST);
  assert.equal(tail.draft, 0);
});

test('no slipstream from a lane over or from too far back', () => {
  for (const [gap, side] of [
    [10, -3],
    [10, 3],
    [20, 0],
  ]) {
    const { r, lead, tail } = convoy(gap, side);
    const evs = run(r, 2);
    assert.ok(!kinds(evs).includes('draft'), `gap ${gap}, side ${side}`);
    assert.equal(tail.boost, 0);
    assert.equal(lead.boost, 0);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Trailing shield

/** One kart parked on the straight holding `item` out behind it. */
function trailing(item: 'banana' | 'green' | 'red' | 'mushroom') {
  const r = race(1);
  const [k] = r.karts;
  place(r, k, 15, -2, 0);
  giveItem(r, k, item, 0);
  k.input.hold = true;
  tick(r);
  return { r, k };
}

test('holding a banana or shell trails it behind; other items do not', () => {
  for (const item of ['banana', 'green', 'red'] as const) assert.equal(trailing(item).k.trail, true, item);
  assert.equal(trailing('mushroom').k.trail, false);
  const { r, k } = trailing('banana');
  k.input.hold = false;
  tick(r);
  assert.equal(k.trail, false, 'let go');
});

test('a trailing banana blocks a banana from behind', () => {
  const { r, k } = trailing('banana');
  lob(r, k, 'banana', -1.2);
  const evs = tick(r);
  assert.ok(kinds(evs).includes('block'));
  assert.ok(!kinds(evs).includes('hit'));
  assert.equal(k.item, null);
  assert.equal(k.uses, 0);
  assert.equal(k.trail, false);
  assert.equal(k.spin, 0);
});

test('a trailing shell blocks a green shell from behind', () => {
  const { r, k } = trailing('green');
  lob(r, k, 'green', -6, 42);
  const evs = run(r, 0.3);
  assert.deepEqual(only(evs, 'block').map((e) => e.k), [k.idx]);
  assert.ok(!kinds(evs).includes('hit'));
  assert.equal(k.item, null);
  assert.equal(k.tumble, 0);
  assert.equal(r.things.length, 0, 'the shell broke');
});

test('a trailing shield does not cover the front, and a hit loses the held item', () => {
  const banana = trailing('banana');
  lob(banana.r, banana.k, 'banana', 1.2);
  const evs = tick(banana.r);
  assert.ok(!kinds(evs).includes('block'));
  assert.ok(only(evs, 'hit').some((e) => e.k === banana.k.idx && e.how === 'spin'));
  assert.ok(banana.k.spin > 0);
  assert.equal(banana.k.item, null);
  assert.equal(banana.k.trail, false);

  const shell = trailing('red');
  lob(shell.r, shell.k, 'green', 6, -42);
  const more = run(shell.r, 0.3);
  assert.ok(!kinds(more).includes('block'));
  assert.ok(only(more, 'hit').some((e) => e.k === shell.k.idx && e.how === 'tumble'));
  assert.equal(shell.k.item, null);
});

// ---------------------------------------------------------------------------------------------------------------
// Ramps

test('the track has ramps and onRamp finds them only near the lip', () => {
  const r = race(1);
  assert.ok(r.ramps.length >= 2);
  for (const ramp of r.ramps) {
    const up = onRamp(r, { s: ramp.s - 1, d: ramp.d });
    assert.ok(up, `on the wedge at s ${ramp.s}`);
    assert.equal(up.ramp, ramp);
    assert.ok(Math.abs(up.ds + 1) < 1e-6);
    assert.ok(up.height > 0 && up.height < RAMP_H);
    assert.equal(onRamp(r, ramp)?.height, RAMP_H, 'full height at the lip');
    assert.equal(onRamp(r, { s: ramp.s - 10, d: ramp.d }), null, 'before it');
    assert.equal(onRamp(r, { s: ramp.s + 5, d: ramp.d }), null, 'past it');
    assert.equal(onRamp(r, { s: ramp.s - 1, d: ramp.d + ramp.w / 2 + 0.5 }), null, 'beside it');
  }
});

/** One kart heading for the Palm Drive kicker at speed; returns it once it has flown off the lip. */
function launch() {
  const r = race(1);
  const [k] = r.karts;
  const kicker = r.ramps.find((rp) => rp.s < 100)!;
  place(r, k, kicker.s - 12, kicker.d, 20);
  let evs: Ev[] = [];
  for (let n = 0; n < 60 && !kinds(evs).includes('ramp'); n++) evs = tick(r);
  assert.deepEqual(only(evs, 'ramp'), [{ t: 'ramp', k: k.idx }]);
  assert.equal(k.air, true);
  assert.ok(k.y > 0 && k.vy > 0);
  return { r, k };
}

/** Steps until the kart touches down; all the events on the way. */
function land(r: Race, k: Kart) {
  const all: Ev[] = [];
  for (let n = 0; n < 120 && k.air; n++) all.push(...tick(r));
  assert.equal(k.air, false, 'landed');
  assert.equal(k.y, 0);
  return all;
}

test('a trick off a ramp pays a boost on landing', () => {
  const { r, k } = launch();
  assert.ok(k.trickT > 0);
  k.input.hop = true;
  assert.ok(kinds(tick(r)).includes('trick'));
  assert.equal(k.trick, true);
  const evs = land(r, k);
  assert.deepEqual(only(evs, 'turbo'), [{ t: 'turbo', k: k.idx, level: 1 }]);
  assert.ok(k.boost > TRICK_T - 0.05 && k.boost <= TRICK_T, `boost ${k.boost}`);
  assert.equal(k.trick, false);
});

test('no trick, no boost', () => {
  const { r, k } = launch();
  const evs = land(r, k);
  assert.ok(!kinds(evs).includes('trick'));
  assert.ok(!kinds(evs).includes('turbo'));
  assert.equal(k.boost, 0);
});

test('a trick has to be pulled while the window is open', () => {
  const { r, k } = launch();
  while (k.trickT > 0) tick(r);
  assert.equal(k.air, true, 'still flying');
  k.input.hop = true;
  const evs = [...tick(r), ...land(r, k)];
  assert.ok(!kinds(evs).includes('trick'));
  assert.equal(k.boost, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Cash and coins

test('cashing in coins buys a short boost', () => {
  const r = race(1);
  const [k] = r.karts;
  place(r, k, 15, -2, 15);
  k.coins = CASH_COST + 2;
  k.input.cash = true;
  const evs = tick(r);
  assert.deepEqual(only(evs, 'cash'), [{ t: 'cash', k: k.idx }]);
  assert.equal(k.coins, 2);
  assert.ok(k.boost >= CASH_T);
  assert.equal(k.input.cash, false);
});

test('cashing in with too few coins does nothing', () => {
  const r = race(1);
  const [k] = r.karts;
  place(r, k, 15, -2, 15);
  k.coins = CASH_COST - 1;
  k.input.cash = true;
  const evs = tick(r);
  assert.ok(!kinds(evs).includes('cash'));
  assert.equal(k.coins, CASH_COST - 1);
  assert.equal(k.boost, 0);
});

/** Parks the kart on top of a coin and lets one frame pass. */
function grab(r: Race, k: Kart, n: number) {
  const c = r.lay.coins[n];
  place(r, k, c.s, c.d, 0);
  return only(tick(r), 'coin').length;
}

test('coins stop at the cap', () => {
  const r = race(1);
  const [k] = r.karts;
  k.coins = MAX_COINS - 2;
  let got = 0;
  for (let n = 0; n < 5; n++) got += grab(r, k, n);
  assert.equal(got, 5);
  assert.equal(k.coins, MAX_COINS);
  assert.equal(k.earned, 5);
});

test('earned counts every coin picked up, even ones lost later', () => {
  const r = race(1);
  const [k] = r.karts;
  for (let n = 0; n < 4; n++) grab(r, k, n);
  assert.equal(k.coins, 4);
  assert.equal(k.earned, 4);
  assert.ok(hitKart(r, k, 'tumble', -1));
  assert.equal(k.coins, 1);
  assert.equal(k.earned, 4);
  grab(r, k, 10);
  assert.equal(k.coins, 2);
  assert.equal(k.earned, 5);
});

// ---------------------------------------------------------------------------------------------------------------
// CPU drivers

test('CPU drivers slam, draft and cash in, and nobody leaves the track', () => {
  const r = createRace({ cc: '150cc', seed: 2024, countdown: 0, laps: 3, racers: [...RIVALS, { name: 'you', color: PLAYER_COLOR, kind: 'player' }] });
  r.karts[r.me].auto = true;
  const seen = new Map<Ev['t'], number>();
  let worst = 0;
  for (let n = 0; n < 60 * 240 && r.karts.some((k) => k.done === null); n++) {
    for (const e of tick(r)) seen.set(e.t, (seen.get(e.t) ?? 0) + 1);
    for (const k of r.karts) worst = Math.max(worst, Math.abs(locate(r.track, k.x, k.z, k.i).d));
  }
  assert.ok(r.karts.every((k) => k.done !== null), 'everyone finished');
  for (const t of ['slam', 'slammed', 'draft', 'cash'] as const) assert.ok((seen.get(t) ?? 0) > 0, `no ${t} event`);
  assert.ok(worst < EDGE, `a kart reached ${worst} m from the center line`);
});
