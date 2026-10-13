import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pile, mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  DEFAULT_DECKS,
  DEFAULT_ROUNDS,
  FIRST_GAME,
  MIN_PLAYERS,
  bestTurn,
  buildTeams,
  canStart,
  finishTurn,
  isLastTurn,
  isOver,
  leader,
  nextOrder,
  other,
  points,
  roundLabel,
  roundsFor,
  SPICY_DECKS,
  scores,
  shownRounds,
  sittingOut,
  styleFor,
  tiebreakerName,
  toggleCard,
  totalTurns,
  turnAt,
  wordsFor,
  type Card,
  type Played,
} from '../src/os/arcade/games/charades/logic.ts';
import { DECKS, DECK_IDS } from '../src/os/arcade/games/charades/words.ts';

test('teams alternate seats around the circle', () => {
  assert.deepEqual(buildTeams(4), [[0, 2], [1, 3]]);
  assert.deepEqual(buildTeams(5), [[0, 2, 4], [1, 3]]);
  assert.deepEqual(buildTeams(0), [[], []]);
  const big = buildTeams(20);
  assert.equal(big[0].length, 10);
  assert.equal(big[1].length, 10);
  assert.ok(big[0].every((s) => s % 2 === 0));
  assert.ok(big[1].every((s) => s % 2 === 1));
});

test('it takes four players to start', () => {
  assert.equal(MIN_PLAYERS, 4);
  assert.equal(canStart(3), false);
  assert.equal(canStart(4), true);
  assert.equal(canStart(20), true);
});

test('teams alternate turns and each team rotates through its own members', () => {
  const teams = buildTeams(5); // Team 1: 0, 2, 4. Team 2: 1, 3.
  const order = Array.from({ length: 10 }, (_, i) => turnAt(i, teams, 'act'));
  assert.deepEqual(
    order.map((t) => t.team),
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  );
  assert.deepEqual(
    order.map((t) => t.actor),
    [0, 1, 2, 3, 4, 1, 0, 3, 2, 1],
  );
  assert.deepEqual(
    order.map((t) => t.round),
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  );
  assert.ok(order.every((t, i) => t.index === i));
});

test('Play Again hands the first turn to the other team and carries each rotation on', () => {
  const teams = buildTeams(5); // Blue: 0, 2, 4. Gold: 1, 3.
  const rounds = 3;
  const game1 = Array.from({ length: rounds * 2 }, (_, i) => turnAt(i, teams, 'act', FIRST_GAME));
  assert.deepEqual(
    game1.map((t) => t.actor),
    [0, 1, 2, 3, 4, 1],
  );
  const history = game1.map((t) => finishTurn(t, []));
  const order = nextOrder(FIRST_GAME, history);
  assert.equal(order.first, 1);
  assert.deepEqual(order.skip, [3, 3]);
  const game2 = Array.from({ length: rounds * 2 }, (_, i) => turnAt(i, teams, 'act', order));
  assert.deepEqual(
    game2.map((t) => t.team),
    [1, 0, 1, 0, 1, 0],
    'Gold opens the second game',
  );
  // Each team picks up with whoever was next in line: Gold had 1, 3, 1, so 3 is up; Blue had 0, 2, 4, so 0 is up.
  assert.deepEqual(
    game2.map((t) => t.actor),
    [3, 0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    game2.map((t) => t.round),
    [1, 1, 2, 2, 3, 3],
  );
  // The game still ends on the team that went second, so both teams get the same number of turns.
  assert.equal(game2[game2.length - 1].team, other(order.first));
  assert.equal(nextOrder(order, []).first, 0);
  assert.equal(other(0), 1);
  assert.equal(other(1), 0);
});

test('round labels count up, call the last round, and name a tiebreaker', () => {
  assert.equal(roundLabel(1, 5), 'Round 1 of 5');
  assert.equal(roundLabel(4, 5), 'Round 4 of 5');
  assert.equal(roundLabel(5, 5), 'Last round');
  assert.equal(roundLabel(6, 5), 'Tiebreaker');
  assert.equal(roundLabel(7, 5), 'Tiebreaker 2', 'a second tiebreaker is told apart from the first');
  assert.equal(roundLabel(1, 1), 'Round 1 of 1');
  assert.equal(tiebreakerName(1), 'Tiebreaker');
  assert.equal(tiebreakerName(3), 'Tiebreaker 3');
});

/** Seats that act at least once in a game of `rounds` rounds. */
const actors = (players: number, rounds: number, order = FIRST_GAME) => {
  const teams = buildTeams(players);
  return new Set(Array.from({ length: totalTurns(rounds) }, (_, i) => turnAt(i, teams, 'act', order).actor));
};

test('Everyone Once gives every player a turn, from 4 to 20 players, in the next game too', () => {
  for (let n = 4; n <= 20; n++) {
    const once = roundsFor('all', n);
    assert.equal(once, Math.ceil(n / 2), `${n} players: one round per member of the bigger team`);
    assert.equal(actors(n, once).size, n, `${n} players: everyone acts in game one`);
    assert.equal(sittingOut(n, once), 0);
    // Play Again carries each team's rotation on, and everyone still gets a turn.
    const teams = buildTeams(n);
    const history = Array.from({ length: totalTurns(once) }, (_, i) => finishTurn(turnAt(i, teams, 'act'), []));
    assert.equal(actors(n, once, nextOrder(FIRST_GAME, history)).size, n, `${n} players: everyone acts in game two`);
    // The default stretches to the same guarantee: five rounds, or Everyone Once when that is longer.
    const auto = roundsFor('auto', n);
    assert.equal(auto, Math.max(DEFAULT_ROUNDS, once));
    assert.equal(actors(n, auto).size, n, `${n} players: everyone acts by default`);
    assert.equal(shownRounds('auto', n), n > 10 ? 'all' : '5', `${n} players: the default reads as ${n > 10 ? 'Everyone Once' : '5'}`);
  }
});

test('fixed rounds stay fixed, and the setup can say who never gets a turn', () => {
  assert.equal(roundsFor('3', 20), 3);
  assert.equal(roundsFor('8', 4), 8);
  assert.equal(roundsFor('nonsense', 6), DEFAULT_ROUNDS);
  assert.equal(shownRounds('8', 20), '8');
  assert.equal(shownRounds('all', 4), 'all');
  for (const [n, rounds, out] of [
    [12, 5, 2],
    [20, 5, 10],
    [20, 8, 4],
    [9, 3, 3],
    [8, 5, 0],
    [4, 3, 0],
  ] as const) {
    assert.equal(sittingOut(n, rounds), out, `${n} players at ${rounds} rounds`);
    assert.equal(actors(n, rounds).size, n - out, `${n} players at ${rounds} rounds: the count matches play`);
  }
});

test('a fixed style stays put and Mix switches every round, the same for both teams', () => {
  for (let t = 0; t < 8; t++) {
    assert.equal(styleFor('act', t), 'act');
    assert.equal(styleFor('describe', t), 'describe');
  }
  assert.deepEqual(
    Array.from({ length: 8 }, (_, t) => styleFor('mix', t)),
    ['act', 'act', 'describe', 'describe', 'act', 'act', 'describe', 'describe'],
  );
  // Each team alternates on its own turns.
  const teams = buildTeams(4);
  const team1 = [0, 2, 4, 6].map((i) => turnAt(i, teams, 'mix').style);
  const team2 = [1, 3, 5, 7].map((i) => turnAt(i, teams, 'mix').style);
  assert.deepEqual(team1, ['act', 'describe', 'act', 'describe']);
  assert.deepEqual(team2, ['act', 'describe', 'act', 'describe']);
});

test('a point per word guessed, and toggling fixes mistakes without touching the original', () => {
  const cards: Card[] = [
    { word: 'Penguin', got: true },
    { word: 'Titanic', got: false },
    { word: 'Juggling', got: true },
    { word: 'Big Ben', got: false, buzzer: true },
  ];
  assert.equal(points(cards), 2);
  assert.equal(points([]), 0);
  const fixed = toggleCard(cards, 1);
  assert.equal(points(fixed), 3);
  assert.equal(cards[1].got, false, 'toggle returns a copy');
  const buzzer = toggleCard(fixed, 3);
  assert.equal(points(buzzer), 4);
  assert.equal(buzzer[3].buzzer, true, 'the buzzer mark survives a toggle');
  assert.equal(points(toggleCard(buzzer, 0)), 3);
  assert.deepEqual(toggleCard(cards, 9), cards, 'out of range is a no-op');
});

const play = (index: number, teams = buildTeams(4), got = 0, missed = 0): Played =>
  finishTurn(turnAt(index, teams, 'act'), [
    ...Array.from({ length: got }, (_, i) => ({ word: `g${i}`, got: true })),
    ...Array.from({ length: missed }, (_, i) => ({ word: `m${i}`, got: false })),
  ]);

test('scores add up per team and the leader can be a tie', () => {
  const history = [play(0, undefined, 3, 2), play(1, undefined, 5), play(2, undefined, 4, 1), play(3, undefined, 2)];
  assert.deepEqual(
    history.map((t) => t.points),
    [3, 5, 4, 2],
  );
  assert.deepEqual(scores(history), [7, 7]);
  assert.equal(leader(scores(history)), null);
  assert.equal(leader([8, 7]), 0);
  assert.equal(leader([2, 9]), 1);
  assert.deepEqual(scores([]), [0, 0]);
});

test('the game ends after every team has played the chosen number of rounds', () => {
  for (const rounds of [3, 5, 8]) {
    assert.equal(totalTurns(rounds), rounds * 2);
    assert.equal(isOver(rounds * 2 - 1, rounds), false);
    assert.equal(isOver(rounds * 2, rounds), true);
    assert.equal(isLastTurn(rounds * 2 - 2, rounds), false);
    assert.equal(isLastTurn(rounds * 2 - 1, rounds), true);
  }
  // The last turn always belongs to Team 2, so both teams get the same number of turns.
  assert.equal(turnAt(totalTurns(5) - 1, buildTeams(6), 'act').team, 1);
});

test('the best turn is the highest score, the earliest on a tie, and none when nobody scored', () => {
  const history = [play(0, undefined, 2), play(1, undefined, 6), play(2, undefined, 6), play(3, undefined, 1)];
  const best = bestTurn(history);
  assert.equal(best?.index, 1);
  assert.equal(best?.points, 6);
  assert.equal(bestTurn([play(0, undefined, 0, 3), play(1)]), null);
  assert.equal(bestTurn([]), null);
});

test('finishing a turn snapshots the cards', () => {
  const cards: Card[] = [{ word: 'Owl', got: true }];
  const played = finishTurn(turnAt(0, buildTeams(4), 'describe'), cards);
  cards.push({ word: 'Bat', got: true });
  assert.equal(played.cards.length, 1);
  assert.equal(played.points, 1);
  assert.equal(played.style, 'describe');
});

test('decks are full, unique and clean', () => {
  assert.ok(DECK_IDS.length >= 8 && DECK_IDS.length <= 10);
  for (const id of DECK_IDS) {
    const { label, words } = DECKS[id];
    assert.ok(words.length >= 45, `${label} has ${words.length} words`);
    assert.equal(new Set(words.map((w) => w.toLowerCase())).size, words.length, `${label} repeats a word`);
    for (const w of words) {
      assert.equal(w, w.trim());
      assert.ok(w.length > 0 && w.length <= 30, `${w} is too long`);
      assert.doesNotMatch(w, /[\u2013\u2014]/, `${w} has a dash`);
    }
  }
});

test('no word appears in two decks, so turning a deck off really removes it', () => {
  const seen = new Map<string, string>();
  for (const id of DECK_IDS)
    for (const w of DECKS[id].words) {
      const key = w.toLowerCase();
      assert.ok(!seen.has(key), `${w} is in ${seen.get(key)} and ${id}`);
      seen.set(key, id);
    }
});

test('words come from the chosen decks only, each once, and fall back to the default decks', () => {
  const animals = wordsFor(['animals']);
  assert.equal(animals.length, DECKS.animals.words.length);
  assert.ok(animals.every((e) => e.deck === 'animals'));
  const all = wordsFor(DECK_IDS);
  assert.equal(new Set(all.map((e) => e.word.toLowerCase())).size, all.length, 'no word repeats across decks');
  assert.deepEqual(wordsFor([]), wordsFor(DEFAULT_DECKS));
  const two = wordsFor(['sports', 'jobs']);
  assert.ok(two.some((e) => e.deck === 'jobs') && two.some((e) => e.deck === 'sports'));
  assert.ok(!two.some((e) => e.deck === 'animals'));
});

test('a seeded pile never repeats a word, skipped or not, until the deck runs out', () => {
  const entries = wordsFor(['animals', 'hard']);
  const pile = new Pile(entries, mulberry32(42));
  const seen = new Set<string>();
  let last;
  for (let i = 0; i < entries.length; i++) {
    const e = pile.draw(last);
    assert.ok(e);
    assert.ok(!seen.has(e.word), `${e.word} came back early`);
    seen.add(e.word);
    last = e;
  }
  assert.equal(seen.size, entries.length);
  // The next pass starts over without repeating the last word shown.
  assert.notEqual(pile.draw(last)?.word, last?.word);
  // Same seed, same order.
  const a = new Pile(entries, mulberry32(7));
  const b = new Pile(entries, mulberry32(7));
  for (let i = 0; i < 20; i++) assert.equal(a.draw()?.word, b.draw()?.word);
});

test('After Dark 18+ is its own deck, off by default, and only shows up when chosen', () => {
  assert.deepEqual([...SPICY_DECKS], ['dark']);
  const { label, words } = DECKS.dark;
  assert.match(label, /18\+/, 'labeled 18+ on its chip');
  assert.ok(words.length >= 45 && words.length <= 60, `about 50 words (got ${words.length})`);
  assert.ok(!DEFAULT_DECKS.includes('dark'), 'off for a new table');
  assert.ok(!DEFAULT_DECKS.includes('hard'));
  assert.ok(!wordsFor([]).some((e) => e.deck === 'dark'), 'no fallback ever deals it');
  assert.ok(!wordsFor(DEFAULT_DECKS).some((e) => e.deck === 'dark'));
  const dark = wordsFor(['dark']);
  assert.equal(dark.length, words.length);
  assert.ok(dark.every((e) => e.deck === 'dark'));
  for (const w of words) {
    assert.match(w, /^[A-Z0-9]/, `${w} is Title Case`);
    // The spice guide's hard lines: nothing about minors or school, consent or cruelty.
    assert.doesNotMatch(w, /\b(school|teen|minor|underage|student|kid|roofie|drugged|passed out|blackout|fat|ugly)\b/i, `${w} crosses a line`);
  }
});
