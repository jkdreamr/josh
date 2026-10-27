import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLUBS, DEFAULT_CLUBS, KIT_CLASH, colorDistance, clubById, matchKits } from '../src/os/arcade/games/soccer/teams.ts';
import { BASELINE, multipliersFor, worldMultipliers } from '../src/os/arcade/games/soccer/ratings.ts';
import { createWorld, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { clearCup, createCup, cupSummary, loadCup, matchOutcome, recordUserResult, saveCup, userFixture } from '../src/os/arcade/games/soccer/cup.ts';
import { simulateShootout } from '../src/os/arcade/games/soccer/shootout.ts';
import { assignControllers, playerForSeat } from '../src/os/arcade/games/soccer/seats.ts';
import { parsePacket } from '../src/os/arcade/games/soccer/net.ts';

test('club rosters are deterministic and player ratings stay in range', () => {
  assert.equal(CLUBS.length, 16);
  assert.equal(new Set(CLUBS.map((club) => club.id)).size, CLUBS.length);
  assert.equal(new Set(CLUBS.map((club) => club.name)).size, CLUBS.length);
  assert.equal(new Set(CLUBS.map((club) => club.short)).size, CLUBS.length);
  for (const club of CLUBS) {
    assert.equal(club.players.length, 11);
    assert.equal(new Set(club.players.map((player) => player.name)).size, 11);
    for (const player of club.players) {
      for (const rating of [player.pace, player.shooting, player.passing, player.dribbling, player.defending, player.physical]) {
        assert.ok(Number.isInteger(rating) && rating >= 50 && rating <= 95);
      }
    }
    const average = (indices: number[], key: 'shooting' | 'passing' | 'defending') =>
      indices.reduce((sum, index) => sum + club.players[index]![key], 0) / indices.length;
    assert.ok(Math.abs(average([8, 9, 10], 'shooting') - club.ratings.attack) <= 3);
    assert.ok(Math.abs(average([5, 6, 7], 'passing') - club.ratings.midfield) <= 3);
    assert.ok(Math.abs(average([0, 1, 2, 3, 4], 'defending') - club.ratings.defense) <= 3);
    assert.ok(club.players[0]!.keeper);
    assert.ok(club.players.slice(1).every((player) => !player.keeper));
    assert.deepEqual(club, clubById(club.id));
  }
});

test('kit matching keeps shirts distinct and keepers clear of both kits', () => {
  for (const home of CLUBS) for (const away of CLUBS) {
    const kits = matchKits(home, away);
    assert.ok(colorDistance(kits.home.shirt, kits.away.shirt) >= KIT_CLASH);
    for (const keeper of kits.keepers) {
      assert.ok(colorDistance(keeper, kits.home.shirt) >= KIT_CLASH);
      assert.ok(colorDistance(keeper, kits.away.shirt) >= KIT_CLASH);
    }
    assert.ok(colorDistance(kits.keepers[0], kits.keepers[1]) >= KIT_CLASH);
  }
  const defaults = matchKits(clubById(DEFAULT_CLUBS[0]), clubById(DEFAULT_CLUBS[1]));
  assert.equal(defaults.home.shirt, '#d52f43');
  assert.equal(defaults.away.shirt, '#112744');
});

test('player multipliers use the 75 baseline and missing club worlds stay neutral', () => {
  assert.equal(BASELINE, 75);
  const baseline = { pace: 75, shooting: 75, passing: 75, dribbling: 75, defending: 75, physical: 75 };
  assert.deepEqual(multipliersFor(baseline, 'ST'), {
    speed: 1, shotPower: 1, shotSpread: 1, passError: 1, dribble: 1, tackle: 1, stamina: 1, keeperReach: 1, keeperReaction: 1,
  });
  const world = createWorld(123, 60, 1);
  assert.deepEqual(worldMultipliers(world, 0), {
    speed: 1, shotPower: 1, shotSpread: 1, passError: 1, dribble: 1, tackle: 1, stamina: 1, keeperReach: 1, keeperReaction: 1,
  });
  const rated = createWorld(123, 60, 1, [...DEFAULT_CLUBS]);
  assert.notDeepEqual(worldMultipliers(rated, 0), worldMultipliers(world, 0));
});

test('player multiplier bounds, keeper rules and monotonicity hold', () => {
  const player = (value: number) => ({
    pace: value, shooting: value, passing: value, dribbling: value, defending: value, physical: value,
    keeper: { diving: value, reflexes: value, handling: value, positioning: value },
  });
  const low = multipliersFor(player(50), 'GK'), high = multipliersFor(player(95), 'GK');
  assert.ok(low.speed >= 0.96 && high.speed <= 1.04 && low.speed < high.speed);
  assert.ok(low.shotPower >= 0.94 && high.shotPower <= 1.06 && low.shotPower < high.shotPower);
  assert.ok(low.shotSpread <= 1.2 && high.shotSpread >= 0.8 && low.shotSpread > high.shotSpread);
  assert.ok(low.passError <= 1.2 && high.passError >= 0.8 && low.passError > high.passError);
  assert.ok(low.dribble >= 0.92 && high.dribble <= 1.08 && low.dribble < high.dribble);
  assert.ok(low.tackle >= 0.85 && high.tackle <= 1.15 && low.tackle < high.tackle);
  assert.ok(low.stamina >= 0.9 && high.stamina <= 1.1 && low.stamina > high.stamina);
  assert.ok(low.keeperReach >= 0.9 && high.keeperReach <= 1.1 && low.keeperReach < high.keeperReach);
  assert.ok(low.keeperReaction >= 0.85 && high.keeperReaction <= 1.15 && low.keeperReaction > high.keeperReaction);
  assert.equal(multipliersFor(player(50), 'CB').keeperReach, 1);
  assert.equal(multipliersFor(player(50), 'CB').keeperReaction, 1);
});

test('cup creation, progression and shootouts are deterministic', () => {
  const cup = createCup(DEFAULT_CLUBS[0], 12345);
  assert.deepEqual(createCup(DEFAULT_CLUBS[0], 12345), cup);
  assert.equal(cup.rounds[0]!.length, 4);
  assert.equal(cup.rounds[1]!.length, 0);
  assert.equal(userFixture(cup)?.home, cup.user);
  const after = recordUserResult(cup, [2, 1]);
  assert.equal(after.round, 1);
  assert.equal(after.rounds[1]!.length, 2);
  assert.equal(userFixture(after)?.home, cup.user);
  assert.deepEqual(simulateShootout(123, clubById(DEFAULT_CLUBS[0]), clubById(DEFAULT_CLUBS[1])),
    simulateShootout(123, clubById(DEFAULT_CLUBS[0]), clubById(DEFAULT_CLUBS[1])));
  const shootout = simulateShootout(123, clubById(DEFAULT_CLUBS[0]), clubById(DEFAULT_CLUBS[1]));
  assert.notEqual(shootout.score[0], shootout.score[1]);
  const drawWin = recordUserResult(cup, [1, 1], [4, 3]);
  assert.equal(drawWin.out, false);
  assert.deepEqual(drawWin.rounds[0]![0]!.pens, [4, 3]);
  const drawLoss = recordUserResult(cup, [1, 1], [3, 4]);
  assert.equal(drawLoss.out, true);
  let champion = cup;
  for (let index = 0; index < 3; index++) {
    const fixture = userFixture(champion)!;
    champion = recordUserResult(champion, fixture.home === champion.user ? [1, 0] : [0, 1]);
  }
  assert.equal(champion.champion, champion.user);
  const lossFixture = userFixture(cup)!;
  const eliminated = recordUserResult(cup, lossFixture.home === cup.user ? [0, 1] : [1, 0]);
  assert.equal(eliminated.out, true);
  assert.ok(parsePacket({
    t: 'soccer', k: 'lobby', r: 1, seq: 1, comp: 'cup', mode: 'cpu', clubs: [...DEFAULT_CLUBS],
    focus: [0, 0], ready: [false, false], countdown: null, members: [{ seat: 0, role: 'host', side: 0 }], cup: cupSummary(cup),
  }));
});

test('cup outcomes wait for on-pitch shootouts and count finished penalties', () => {
  const world = createWorld();
  assert.deepEqual(matchOutcome(world), { score: [0, 0] });

  world.shootout = {
    kicks: [[true, false], [false]],
    turn: 1,
    first: 0,
    done: false,
    winner: null,
    round: 2,
  };
  assert.equal(matchOutcome(world), null);

  world.shootout.done = true;
  world.shootout.winner = 0;
  assert.deepEqual(matchOutcome(world), { score: [0, 0], pens: [1, 0] });
});

test('cup local storage round-trips and rejects malformed state', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    const cup = createCup(DEFAULT_CLUBS[0], 55);
    saveCup(cup);
    assert.deepEqual(loadCup(), cup);
    values.set('soccer:cup', '{bad');
    assert.equal(loadCup(), null);
    clearCup();
    assert.equal(values.has('soccer:cup'), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('config, lobby, role, navigation, and snapshot packets validate registry values', () => {
  const config = { t: 'soccer', k: 'cfg', r: 1, seq: 1, half: 4, level: 1, displayOnly: true, comp: 'quick', mode: 'cpu', clubs: [...DEFAULT_CLUBS] };
  assert.ok(parsePacket(config));
  assert.equal(parsePacket({ ...config, comp: 'practice' }), null);
  assert.equal(parsePacket({ ...config, comp: 'cup', mode: 'versus' }), null);
  const hi = { t: 'soccer', k: 'hi', r: 1, seq: 1, seat: 1, role: 'phone', side: 1 };
  assert.ok(parsePacket(hi));
  assert.equal(parsePacket({ ...hi, side: 2 }), null);
  const nav = { t: 'soccer', k: 'nav', r: 1, seq: 2, seat: 1, dx: 1, dy: 0, a: false, b: false };
  assert.ok(parsePacket(nav));
  assert.equal(parsePacket({ ...nav, dx: 2 }), null);
  const world = createWorld(20, 60, 1);
  assert.ok(parsePacket({ t: 'soccer', k: 's', r: 1, seq: 1, state: world }));
  assert.ok(parsePacket({ t: 'soccer', k: 's', r: 1, seq: 2, state: { ...world, clubs: [...DEFAULT_CLUBS] } }));
  assert.equal(parsePacket({ t: 'soccer', k: 's', r: 1, seq: 3, state: { ...world, clubs: ['unknown', DEFAULT_CLUBS[1]] } }), null);
});

test('controller assignment preserves standard seats and maps online players by side', () => {
  const members = [
    { seat: 0, role: 'host' as const, side: 0 as const },
    { seat: 1, role: 'phone' as const, side: 0 as const },
    { seat: 2, role: 'mac' as const, side: 1 as const },
    { seat: 3, role: 'phone' as const, side: 1 as const },
  ];
  assert.equal(assignControllers(members, 'versus', 'quick').get(1), playerForSeat(1, true, 'versus'));
  assert.equal(assignControllers(members, 'versus', 'quick').get(1), 6);
  const online = assignControllers(members, 'cpu', 'online');
  assert.equal(online.get(1), 6);
  assert.equal(online.get(3), 17);
  assert.equal(online.has(0), false);
  assert.equal(online.has(2), false);
  const onlineMacs = assignControllers([
    { seat: 0, role: 'host', side: 0 },
    { seat: 2, role: 'mac', side: 1 },
  ], 'cpu', 'online');
  assert.equal(onlineMacs.get(0), 6);
  assert.equal(onlineMacs.get(2), 17);
  const sideOnePhones = assignControllers([
    { seat: 2, role: 'phone', side: 1 },
    { seat: 3, role: 'phone', side: 1 },
  ], 'cpu', 'online');
  assert.equal(sideOnePhones.get(2), 17);
  assert.equal(sideOnePhones.get(3), 20);
});

test('rated simulation remains deterministic and cloneable over fixed steps', () => {
  const make = () => createWorld(9876, 60, 1, [...DEFAULT_CLUBS]);
  const first = make(), second = make();
  for (let index = 0; index < 300; index++) {
    stepWorld(first, 1 / 60, new Map());
    stepWorld(second, 1 / 60, new Map());
  }
  assert.deepEqual(first, second);
  const cloned = structuredClone(first) as World;
  assert.deepEqual(cloned, first);
});
