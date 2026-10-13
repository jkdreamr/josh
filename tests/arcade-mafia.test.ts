import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  assignRoles,
  autoMafia,
  describeCast,
  endNight,
  logLine,
  mafiaCount,
  mafiaTarget,
  maxMafia,
  newGame,
  nightChoices,
  nightOrder,
  pickAt,
  resolveNight,
  seatsOf,
  validTargets,
  voteOut,
  winner,
  type Game,
  type Role,
} from '../src/os/arcade/games/mafia/logic.ts';

const count = (roles: Role[], role: Role) => roles.filter((r) => r === role).length;
const all = (n: number) => Array.from({ length: n }, () => true);
/** A fixed table: seats 0 and 1 mafia, 2 doctor, 3 detective, 4 to 6 villagers. */
const ROLES: Role[] = ['mafia', 'mafia', 'doctor', 'detective', 'villager', 'villager', 'villager'];
const fixed = (over: Partial<Game> = {}): Game => ({
  roles: ROLES.slice(),
  alive: all(ROLES.length),
  night: 1,
  picks: ROLES.map(() => null),
  lastSaved: null,
  findings: [],
  log: [],
  ...over,
});

test('auto mafia count follows the table size', () => {
  const expect: [number, number][] = [
    [5, 1], [6, 1], [7, 2], [9, 2], [10, 3], [13, 3], [14, 4], [20, 4],
  ];
  for (const [players, mafia] of expect) {
    assert.equal(autoMafia(players), mafia, `${players} players`);
    assert.equal(mafiaCount('auto', players), mafia, `${players} players`);
  }
});

test('mafia always start as fewer than half the players', () => {
  for (let players = 3; players <= 20; players++) {
    for (const want of ['auto', '1', '2', '3'] as const) {
      const m = mafiaCount(want, players);
      assert.ok(m >= 1, `${want} at ${players}`);
      assert.ok(m * 2 < players, `${want} at ${players} gives ${m}`);
      assert.ok(m <= maxMafia(players));
    }
  }
  assert.equal(mafiaCount('3', 5), 2);
  assert.equal(mafiaCount('3', 6), 2);
  assert.equal(mafiaCount('3', 7), 3);
  assert.equal(mafiaCount('2', 5), 2);
  assert.equal(mafiaCount('1', 12), 1);
});

test('roles are dealt with the asked counts and deterministically for a seed', () => {
  for (let players = 5; players <= 20; players++) {
    const mafia = mafiaCount('auto', players);
    const roles = assignRoles(players, { mafia, doctor: true, detective: true }, mulberry32(players));
    assert.equal(roles.length, players);
    assert.equal(count(roles, 'mafia'), mafia);
    assert.equal(count(roles, 'doctor'), 1);
    assert.equal(count(roles, 'detective'), 1);
    assert.equal(count(roles, 'villager'), players - mafia - 2);
  }
  const off = assignRoles(8, { mafia: 2, doctor: false, detective: false }, mulberry32(3));
  assert.equal(count(off, 'doctor') + count(off, 'detective'), 0);
  assert.equal(count(off, 'villager'), 6);
  assert.deepEqual(assignRoles(9, { mafia: 2, doctor: true, detective: true }, mulberry32(42)), assignRoles(9, { mafia: 2, doctor: true, detective: true }, mulberry32(42)));
  // Asking for too many mafia still keeps them a minority.
  assert.equal(count(assignRoles(5, { mafia: 4, doctor: true, detective: true }, mulberry32(1)), 'mafia'), 2);
});

test('the deal moves the mafia around between seeds', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 30; seed++) seen.add(seatsOf(assignRoles(6, { mafia: 1, doctor: true, detective: true }, mulberry32(seed)), 'mafia').join());
  assert.ok(seen.size >= 4, `only ${seen.size} different mafia seats`);
});

test('describeCast reads naturally', () => {
  assert.equal(describeCast(7, { mafia: 2, doctor: true, detective: true }), '2 mafia, a doctor, a detective and 3 villagers.');
  assert.equal(describeCast(5, { mafia: 1, doctor: false, detective: true }), '1 mafia, a detective and 3 villagers.');
  assert.equal(describeCast(5, { mafia: 2, doctor: true, detective: true }), '2 mafia, a doctor, a detective and 1 villager.');
  assert.equal(describeCast(6, { mafia: 1, doctor: false, detective: false }), '1 mafia and 5 villagers.');
});

test('night choices per role', () => {
  const alive = all(7);
  alive[5] = false;
  assert.deepEqual(nightOrder(alive), [0, 1, 2, 3, 4, 6]);
  // Mafia: living non-mafia only.
  assert.deepEqual(validTargets(ROLES, alive, 0), [2, 3, 4, 6]);
  // Doctor: anyone living, themself included.
  assert.deepEqual(validTargets(ROLES, alive, 2), [0, 1, 2, 3, 4, 6]);
  // But not the same person two nights in a row: shown, disabled.
  assert.deepEqual(validTargets(ROLES, alive, 2, 4), [0, 1, 2, 3, 6]);
  assert.deepEqual(
    nightChoices(ROLES, alive, 2, 2).filter((c) => !c.ok),
    [{ seat: 2, ok: false }],
  );
  // Detective and villagers: anyone living but themself.
  assert.deepEqual(validTargets(ROLES, alive, 3), [0, 1, 2, 4, 6]);
  assert.deepEqual(validTargets(ROLES, alive, 4), [0, 1, 2, 3, 6]);
  // The dead don't act.
  assert.deepEqual(validTargets(ROLES, alive, 5), []);
});

test('the mafia take their most picked target, ties broken by the rng', () => {
  const alive = all(7);
  assert.equal(mafiaTarget(ROLES, alive, [4, 4, 2, 0, 1, 1, 1]), 4);
  // Non-mafia picks never count toward the mafia's target.
  assert.equal(mafiaTarget(ROLES, alive, [4, null, 6, 6, 6, 6, 6]), 4);
  // Tie: rng 0 picks the lowest seat, rng near 1 the highest.
  assert.equal(mafiaTarget(ROLES, alive, [4, 6, null, null, null, null, null], () => 0), 4);
  assert.equal(mafiaTarget(ROLES, alive, [4, 6, null, null, null, null, null], () => 0.999), 6);
  const seen = new Set<number | null>();
  const rng = mulberry32(5);
  for (let i = 0; i < 40; i++) seen.add(mafiaTarget(ROLES, alive, [4, 6, null, null, null, null, null], rng));
  assert.deepEqual([...seen].sort(), [4, 6]);
  // Dead mafia don't vote, and picks of dead or mafia players are ignored.
  const someDead = all(7);
  someDead[1] = false;
  assert.equal(mafiaTarget(ROLES, someDead, [4, 6, null, null, null, null, null]), 4);
  assert.equal(mafiaTarget(ROLES, alive, [1, 0, null, null, null, null, null]), null);
  assert.equal(mafiaTarget(ROLES, alive, ROLES.map(() => null)), null);
});

test('the doctor saves the target, otherwise the target is taken', () => {
  const alive = all(7);
  assert.deepEqual(resolveNight(ROLES, alive, [4, 4, 4, 0, 0, 0, 0]), { target: 4, saved: 4, killed: null });
  assert.deepEqual(resolveNight(ROLES, alive, [4, 4, 5, 0, 0, 0, 0]), { target: 4, saved: 5, killed: 4 });
  // The doctor can save themself.
  assert.deepEqual(resolveNight(ROLES, alive, [2, 2, 2, 0, 0, 0, 0]), { target: 2, saved: 2, killed: null });
  // A dead doctor saves nobody.
  const noDoc = all(7);
  noDoc[2] = false;
  assert.deepEqual(resolveNight(ROLES, noDoc, [4, 4, 4, 0, 0, 0, 0]), { target: 4, saved: null, killed: 4 });
});

test('win check', () => {
  assert.equal(winner(ROLES, all(7)), null);
  // No mafia left: town wins.
  assert.equal(winner(ROLES, [false, false, true, true, true, true, true]), 'town');
  // Mafia equal to everyone else: mafia wins.
  assert.equal(winner(ROLES, [true, true, true, true, false, false, false]), 'mafia');
  assert.equal(winner(ROLES, [true, false, true, false, false, false, false]), 'mafia');
  // One fewer than the rest: still going.
  assert.equal(winner(ROLES, [true, true, true, true, true, false, false]), null);
  // Nobody wins at the start of any legal deal.
  for (let players = 5; players <= 20; players++) {
    const roles = assignRoles(players, { mafia: mafiaCount('3', players), doctor: true, detective: true }, mulberry32(players));
    assert.equal(winner(roles, all(players)), null, `${players} players`);
  }
});

test('a full night: picks, the detective learns, the morning resolves and logs', () => {
  let g = fixed();
  g = pickAt(g, 0, 4);
  g = pickAt(g, 1, 4);
  g = pickAt(g, 2, 6);
  g = pickAt(g, 3, 1);
  g = pickAt(g, 4, 0);
  // Invalid picks are ignored: mafia can't pick mafia, villagers can't pick themselves.
  assert.equal(pickAt(g, 0, 1), g);
  assert.equal(pickAt(g, 5, 5), g);
  assert.deepEqual(g.findings, [{ night: 1, seat: 1, mafia: true }]);
  const { game, result } = endNight(g, () => 0);
  assert.deepEqual(result, { target: 4, saved: 6, killed: 4 });
  assert.equal(game.alive[4], false);
  assert.equal(game.lastSaved, 6);
  assert.deepEqual(game.picks, ROLES.map(() => null));
  assert.deepEqual(game.log, [{ phase: 'night', n: 1, seat: 4 }]);
  assert.equal(game.night, 1);

  // The doctor can't protect last night's pick again.
  assert.equal(pickAt(game, 2, 6), game);
  assert.notEqual(pickAt(game, 2, 5), game);

  const day = voteOut(game, 0);
  assert.equal(day.alive[0], false);
  assert.equal(day.night, 2);
  assert.deepEqual(day.log.at(-1), { phase: 'day', n: 1, seat: 0 });
  assert.equal(winner(day.roles, day.alive), null);
});

test('a saved night keeps everyone, and voting nobody just moves on', () => {
  let g = fixed();
  g = pickAt(g, 0, 3);
  g = pickAt(g, 1, 3);
  g = pickAt(g, 2, 3);
  const { game, result } = endNight(g);
  assert.equal(result.killed, null);
  assert.deepEqual(game.alive, all(7));
  assert.deepEqual(game.log, [{ phase: 'night', n: 1, seat: null }]);
  const next = voteOut(game, null);
  assert.deepEqual(next.alive, all(7));
  assert.equal(next.night, 2);
  assert.deepEqual(next.log.at(-1), { phase: 'day', n: 1, seat: null });
  // Voting out someone already out changes nothing but the log.
  const dead = voteOut({ ...game, alive: [true, true, true, true, false, true, true] }, 4);
  assert.equal(dead.log.at(-1)?.seat, null);
});

test('detective findings keep one answer per night', () => {
  let g = fixed();
  g = pickAt(g, 3, 4);
  g = pickAt(g, 3, 0);
  assert.deepEqual(g.findings, [{ night: 1, seat: 0, mafia: true }]);
  g = { ...endNight(g).game, night: 2 };
  g = pickAt(g, 3, 5);
  assert.deepEqual(g.findings, [
    { night: 1, seat: 0, mafia: true },
    { night: 2, seat: 5, mafia: false },
  ]);
});

test('voting the mafia out until none are left ends in a town win', () => {
  let g = fixed();
  g = voteOut(g, 0);
  assert.equal(winner(g.roles, g.alive), null);
  g = voteOut(g, 1);
  assert.equal(winner(g.roles, g.alive), 'town');
});

test('the mafia win once they catch up', () => {
  // 1 mafia, 5 players: two kills and the town is down to 1 against 1.
  let g: Game = { ...fixed(), roles: ['mafia', 'doctor', 'detective', 'villager', 'villager'], alive: all(5), picks: Array(5).fill(null) };
  g = pickAt(g, 0, 3);
  g = endNight(g).game;
  g = voteOut(g, 4);
  assert.equal(winner(g.roles, g.alive), null);
  g = pickAt(g, 0, 2);
  g = pickAt(g, 1, 1);
  g = endNight(g).game;
  assert.deepEqual(g.alive, [true, true, false, false, false]);
  assert.equal(winner(g.roles, g.alive), 'mafia');
});

test('newGame starts on night one with everyone in', () => {
  const g = newGame(8, { mafia: 2, doctor: true, detective: false }, mulberry32(9));
  assert.equal(g.night, 1);
  assert.deepEqual(g.alive, all(8));
  assert.equal(count(g.roles, 'mafia'), 2);
  assert.equal(count(g.roles, 'detective'), 0);
  assert.equal(g.lastSaved, null);
});

test('log lines with and without roles', () => {
  const names = ['Josh', 'Sam', 'Alex', 'Jordan', 'Riley', 'Jo', 'Max'];
  assert.equal(logLine({ phase: 'night', n: 1, seat: 5 }, names, ROLES, false), 'Night 1: Jo was taken.');
  assert.equal(logLine({ phase: 'night', n: 2, seat: 2 }, names, ROLES, true), 'Night 2: Alex (Doctor) was taken.');
  assert.equal(logLine({ phase: 'night', n: 3, seat: null }, names, ROLES, true), 'Night 3: Nobody was taken.');
  assert.equal(logLine({ phase: 'day', n: 1, seat: 1 }, names, ROLES, false), 'Day 1: Sam voted out.');
  assert.equal(logLine({ phase: 'day', n: 1, seat: 1 }, names, ROLES, true), 'Day 1: Sam (Mafia) voted out.');
  assert.equal(logLine({ phase: 'day', n: 4, seat: null }, names, ROLES, false), 'Day 4: Nobody voted out.');
});
