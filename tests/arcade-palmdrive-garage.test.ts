import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANK_MAX, HAT_NAMES, HAT_PRICES, PAINTS, PODIUM, chooseHat, choosePaint, deposit, freshGarage, fromLook, lookOf, paintColor, parseGarage, payout } from '../src/os/arcade/games/palmdrive/garage.ts';
import { HATS, createRace } from '../src/os/arcade/games/palmdrive/logic.ts';
import { carOf, guestState, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';

test('a fresh garage has an empty bank and owns and wears the red paint and the cap', () => {
  assert.deepEqual(freshGarage(), { bank: 0, paints: ['red'], hats: ['cap'], paint: 'red', hat: 'cap' });
  assert.equal(PAINTS.find((p) => p.id === 'red')!.price, 0);
  assert.equal(HAT_PRICES.cap, 0);
  for (const h of HATS) assert.ok(HAT_NAMES[h] && Number.isFinite(HAT_PRICES[h]), h);
});

test('a saved garage is read back carefully: junk is a fresh garage, unknowns are dropped', () => {
  for (const raw of [null, '', '{', '[]', '"x"', '42']) assert.deepEqual(parseGarage(raw), freshGarage(), String(raw));
  const g = parseGarage(JSON.stringify({ bank: 120.7, paints: ['blue', 'nope', 'blue'], hats: ['tree', 42], paint: 'blue', hat: 'tree' }));
  assert.deepEqual(g, { bank: 120, paints: ['red', 'blue'], hats: ['cap', 'tree'], paint: 'blue', hat: 'tree' });
  assert.equal(parseGarage(JSON.stringify({ bank: -5 })).bank, 0);
  assert.equal(parseGarage(JSON.stringify({ bank: 1e12 })).bank, BANK_MAX);
  assert.equal(parseGarage(JSON.stringify({ bank: '12' })).bank, 0);
  // wearing something you do not own falls back to the starter kit
  const worn = parseGarage(JSON.stringify({ paints: ['red'], paint: 'gold', hats: ['cap'], hat: 'axe' }));
  assert.equal(worn.paint, 'red');
  assert.equal(worn.hat, 'cap');
});

test('paint and hats are bought once and then worn for free; you cannot buy what you cannot afford', () => {
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

test('paint and hat pack into one small number and back', () => {
  for (const p of PAINTS) {
    for (const hat of HATS) {
      const look = lookOf({ paint: p.id, hat });
      assert.ok(Number.isInteger(look) && look >= 0 && look < 256);
      assert.deepEqual(fromLook(look), { color: paintColor(p.id), hat });
    }
  }
  for (const bad of [-1, 1.5, PAINTS.length * 16, HATS.length, Number.NaN]) assert.equal(fromLook(bad), null, String(bad));
});

test('your look rides along with your kart online, and older packets without one still read', () => {
  const r = createRace({ cc: '100cc', seed: 3, countdown: 0, racers: [{ name: 'you', color: '#e53935', kind: 'player' }] });
  const k = r.karts[0];
  const look = lookOf({ paint: 'gold', hat: 'axe' });
  assert.equal(carOf(k).look, -1, 'no look unless given');
  const guest = parsePacket(JSON.parse(JSON.stringify(guestState(3, carOf(k, look)))));
  assert.ok(guest && guest.k === 's');
  assert.equal(guest.car.look, look);
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
