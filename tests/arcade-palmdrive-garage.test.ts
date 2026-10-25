import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BANK_MAX,
  FLAMES,
  FLAME_COLORS,
  FLAME_NAMES,
  FLAME_PRICES,
  HAT_NAMES,
  HAT_PRICES,
  LOOK_MAX,
  PAINTS,
  PODIUM,
  WHEELS,
  WHEEL_NAMES,
  WHEEL_PRICES,
  WHEEL_TIPS,
  chooseFlame,
  chooseHat,
  choosePaint,
  chooseWheel,
  deposit,
  freshGarage,
  fromLook,
  lookFor,
  lookOf,
  paintColor,
  parseGarage,
  payout,
  type PaintId,
} from '../src/os/arcade/games/palmdrive/garage.ts';
import { HATS, RIVALS, createRace, soloRace, step, type Hat, type Race, type Racer } from '../src/os/arcade/games/palmdrive/logic.ts';
import { carOf, guestState, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';

/** The shelves as they were before wheels and boost trails, in the order a look counts them. */
const OLD_PAINTS: PaintId[] = ['red', 'cardinal', 'orange', 'gold', 'green', 'teal', 'blue', 'purple', 'pink', 'white', 'black', 'chrome'];
const OLD_HATS: Hat[] = ['cap', 'tree', 'top', 'bow', 'tower', 'axe', 'dish', 'claw'];
const HEX = /^#[0-9a-f]{6}$/;

test('a fresh garage has an empty bank and owns and wears the starter kit', () => {
  assert.deepEqual(freshGarage(), { bank: 0, paints: ['red'], hats: ['cap'], wheels: ['classic'], flames: ['orange'], paint: 'red', hat: 'cap', wheel: 'classic', flame: 'orange' });
  assert.equal(PAINTS.find((p) => p.id === 'red')!.price, 0);
  assert.equal(HAT_PRICES.cap, 0);
  assert.equal(WHEEL_PRICES.classic, 0);
  assert.equal(FLAME_PRICES.orange, 0);
});

test('every shelf: names and prices for everything, nothing doubled up, and room in a look for it all', () => {
  for (const h of HATS) assert.ok(HAT_NAMES[h] && HAT_PRICES[h] >= 0, h);
  for (const w of WHEELS) assert.ok(WHEEL_NAMES[w] && WHEEL_PRICES[w] >= 0 && HEX.test(WHEEL_TIPS[w]), w);
  for (const f of FLAMES) assert.ok(FLAME_NAMES[f] && FLAME_PRICES[f] >= 0 && FLAME_COLORS[f].every((c) => c === undefined || HEX.test(c)), f);
  for (const p of PAINTS) assert.ok(p.name && HEX.test(p.color) && (!('trim' in p) || HEX.test(p.trim)), p.id);
  for (const list of [PAINTS.map((p) => p.id), PAINTS.map((p) => p.name), HATS, HATS.map((h) => HAT_NAMES[h]), WHEELS, WHEELS.map((w) => WHEEL_NAMES[w]), FLAMES, FLAMES.map((f) => FLAME_NAMES[f])]) {
    assert.equal(new Set(list).size, list.length, list.join());
  }
  assert.ok(PAINTS.length <= 32 && HATS.length <= 16 && WHEELS.length <= 16 && FLAMES.length <= 16);
  // (the old things keep their places, so an old look still means the same; the new ones go on the end)
  assert.deepEqual(
    PAINTS.slice(0, OLD_PAINTS.length).map((p) => p.id),
    OLD_PAINTS,
  );
  assert.deepEqual(HATS.slice(0, OLD_HATS.length), OLD_HATS);
  // (and the new ones cost at least what the old fancy ones do: the starter kit is the only thing free)
  for (const p of PAINTS.slice(OLD_PAINTS.length)) assert.ok(p.price >= 40, p.id);
  for (const h of HATS.slice(OLD_HATS.length)) assert.ok(HAT_PRICES[h] >= 50, h);
  for (const w of WHEELS.slice(1)) assert.ok(WHEEL_PRICES[w] >= 40, w);
  for (const f of FLAMES.slice(1)) assert.ok(FLAME_PRICES[f] >= 40, f);
});

test('a saved garage is read back carefully: junk is a fresh garage, unknowns are dropped', () => {
  for (const raw of [null, '', '{', '[]', '"x"', '42']) assert.deepEqual(parseGarage(raw), freshGarage(), String(raw));
  const g = parseGarage(JSON.stringify({ bank: 120.7, paints: ['blue', 'nope', 'blue'], hats: ['tree', 42], wheels: ['gold', 'square'], flames: ['rainbow', null], paint: 'blue', hat: 'tree', wheel: 'gold', flame: 'rainbow' }));
  assert.deepEqual(g, { bank: 120, paints: ['red', 'blue'], hats: ['cap', 'tree'], wheels: ['classic', 'gold'], flames: ['orange', 'rainbow'], paint: 'blue', hat: 'tree', wheel: 'gold', flame: 'rainbow' });
  assert.equal(parseGarage(JSON.stringify({ bank: -5 })).bank, 0);
  assert.equal(parseGarage(JSON.stringify({ bank: 1e12 })).bank, BANK_MAX);
  assert.equal(parseGarage(JSON.stringify({ bank: '12' })).bank, 0);
  // wearing something you do not own falls back to the starter kit
  const worn = parseGarage(JSON.stringify({ paints: ['red'], paint: 'gold', hats: ['cap'], hat: 'axe', wheels: ['classic'], wheel: 'neon', flame: 'gold' }));
  assert.deepEqual([worn.paint, worn.hat, worn.wheel, worn.flame], ['red', 'cap', 'classic', 'orange']);
});

test('a save from before wheels and boost trails loads with everything in it, and the starter wheels and trail', () => {
  const old = { bank: 87, paints: ['red', 'cardinal', 'chrome'], hats: ['cap', 'tower', 'dish'], paint: 'chrome', hat: 'dish' };
  const g = parseGarage(JSON.stringify(old));
  assert.deepEqual(g, { ...old, wheels: ['classic'], flames: ['orange'], wheel: 'classic', flame: 'orange' });
  // it saves and loads again unchanged, and its look is the number it always was
  assert.deepEqual(parseGarage(JSON.stringify(g)), g);
  assert.equal(lookOf(g), OLD_PAINTS.indexOf('chrome') * 16 + OLD_HATS.indexOf('dish'));
});

test('everything is bought once and then worn for free; you cannot buy what you cannot afford', () => {
  const blue = PAINTS.find((p) => p.id === 'blue')!.price;
  let g = { ...freshGarage(), bank: blue + 5 };
  g = choosePaint(g, 'blue')!;
  assert.equal(g.bank, 5);
  assert.deepEqual([g.paint, g.paints], ['blue', ['red', 'blue']]);
  assert.equal(choosePaint(g, 'blue')!.bank, 5, 'owned paint is free');
  assert.equal(choosePaint(g, 'chrome'), null);
  assert.equal(choosePaint(g, 'red')!.paint, 'red');
  g = { ...g, bank: HAT_PRICES.tree };
  g = chooseHat(g, 'tree')!;
  assert.deepEqual([g.bank, g.hat, g.hats], [0, 'tree', ['cap', 'tree']]);
  assert.equal(chooseHat(g, 'axe'), null);
  assert.equal(chooseHat(g, 'cap')!.hat, 'cap');
  g = { ...g, bank: WHEEL_PRICES.spoke + FLAME_PRICES.stanford - 1 };
  g = chooseWheel(g, 'spoke')!;
  assert.deepEqual([g.bank, g.wheel, g.wheels], [FLAME_PRICES.stanford - 1, 'spoke', ['classic', 'spoke']]);
  assert.equal(chooseFlame(g, 'stanford'), null, 'a coin short');
  g = chooseFlame({ ...g, bank: g.bank + 1 }, 'stanford')!;
  assert.deepEqual([g.bank, g.flame, g.flames], [0, 'stanford', ['orange', 'stanford']]);
  assert.equal(chooseWheel(g, 'classic')!.wheel, 'classic');
  assert.equal(chooseFlame(g, 'orange')!.flame, 'orange');
  assert.equal(chooseWheel(chooseWheel(g, 'classic')!, 'spoke')!.bank, 0, 'owned wheels are free');
});

test('race coins and a podium bonus go in the bank, which never passes its cap', () => {
  assert.deepEqual(PODIUM, [10, 6, 4]);
  assert.equal(payout(12, 1), 22);
  assert.equal(payout(12, 2), 18);
  assert.equal(payout(12, 3), 16);
  assert.equal(payout(12, 4), 12);
  assert.equal(payout(12, 0), 12, 'out of time: just the coins');
  assert.equal(payout(7.9, 5), 7);
  assert.equal(payout(-3, 9), 0);
  const g = freshGarage();
  assert.equal(deposit(g, 22).bank, 22);
  assert.equal(deposit({ ...g, bank: BANK_MAX - 5 }, 50).bank, BANK_MAX);
  assert.equal(deposit({ ...g, bank: 8 }, -10).bank, 8);
});

test('your look (paint, hat, wheels and trail) packs into one small number and back', () => {
  const seen = new Set<number>();
  for (const p of PAINTS) {
    for (const hat of HATS) {
      for (const wheel of WHEELS) {
        for (const flame of FLAMES) {
          const look = lookOf({ paint: p.id, hat, wheel, flame });
          assert.ok(Number.isInteger(look) && look >= 0 && look < LOOK_MAX);
          assert.ok(!seen.has(look));
          seen.add(look);
          assert.deepEqual(fromLook(look), lookFor({ paint: p.id, hat, wheel, flame }));
        }
      }
    }
  }
  assert.deepEqual(lookFor({ paint: 'stanford', hat: 'band', wheel: 'cardinal', flame: 'stanford' }), {
    color: '#8c1515',
    hat: 'band',
    gear: { finish: 'stripe', trim: '#f6f6f8', wheels: 'cardinal', flame: 'stanford' },
  });
  assert.deepEqual(lookFor({ paint: 'blue', hat: 'cap', wheel: 'classic', flame: 'orange' }).gear, { finish: 'flat', trim: '#1e88e5', wheels: 'classic', flame: 'orange' });
  for (const bad of [-1, 1.5, PAINTS.length * 16, LOOK_MAX, WHEELS.length * 512, FLAMES.length * 8192, Number.NaN]) assert.equal(fromLook(bad), null, String(bad));
});

test('an old look (paint * 16 + hat) reads just as it did, with the starter wheels and trail', () => {
  OLD_PAINTS.forEach((paint, i) => {
    OLD_HATS.forEach((hat, j) => {
      const look = fromLook(i * 16 + j);
      assert.ok(look);
      assert.deepEqual([look.color, look.hat, look.gear.wheels, look.gear.flame], [paintColor(paint), hat, 'classic', 'orange']);
    });
  });
});

test('your look rides along with your kart online, and older packets without one still read', () => {
  const r = createRace({ cc: '100cc', seed: 3, countdown: 0, racers: [{ name: 'you', color: '#e53935', kind: 'player' }] });
  const k = r.karts[0];
  const look = lookOf({ paint: 'hotrod', hat: 'laurel', wheel: 'neon', flame: 'rainbow' });
  assert.equal(carOf(k).look, -1, 'no look unless given');
  const guest = parsePacket(JSON.parse(JSON.stringify(guestState(3, carOf(k, look)))));
  assert.ok(guest && guest.k === 's');
  assert.equal(guest.car.look, look);
  assert.deepEqual(fromLook(guest.car.look), lookFor({ paint: 'hotrod', hat: 'laurel', wheel: 'neon', flame: 'rainbow' }));
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(3, 1, '150cc', [0, 2], [{ seat: 0, ...carOf(k, look) }, { seat: 2, ...carOf(k) }]))));
  assert.ok(host && host.k === 'S');
  assert.deepEqual(
    host.cars.map((c) => c.look),
    [look, -1],
  );
  const old = parsePacket({ t: 'pk', r: 3, k: 's', c: [1, 2, 0, 0, 0, 0, 0, -1] });
  assert.ok(old && old.k === 's');
  assert.equal(old.car.look, -1);
});

test('the garage is just for show: the fanciest looks race exactly like the starter kit, on wheels and on the water', () => {
  const plain: Racer[] = RIVALS.map((rc) => ({ ...rc }));
  const fancy: Racer[] = RIVALS.map((rc, i) => ({
    ...rc,
    ...lookFor({ paint: PAINTS[PAINTS.length - 1 - i].id, hat: HATS[HATS.length - 1 - i], wheel: WHEELS[WHEELS.length - 1 - (i % WHEELS.length)], flame: FLAMES[FLAMES.length - 1 - i] }),
  }));
  const where = (r: Race) => r.karts.map((k) => [k.x, k.z, k.h, k.v, k.lap, k.coins, k.item]);
  for (const course of ['palm', 'slough'] as const) {
    const a = createRace({ cc: '150cc', course, seed: 11, racers: plain });
    const b = createRace({ cc: '150cc', course, seed: 11, racers: fancy });
    for (let i = 0; i < 60 * 40; i++) {
      step(a, 1 / 60);
      step(b, 1 / 60);
    }
    assert.deepEqual(where(b), where(a), course);
  }
  // and a solo race with a look is the same race as one without
  const solo = soloRace('100cc', 4, lookFor({ paint: 'pearl', hat: 'prop', wheel: 'chunky', flame: 'gold' }));
  const base = soloRace('100cc', 4);
  for (let i = 0; i < 600; i++) {
    step(solo, 1 / 60);
    step(base, 1 / 60);
  }
  assert.deepEqual(where(solo), where(base));
  assert.equal(solo.karts[solo.me].gear?.wheels, 'chunky');
});
