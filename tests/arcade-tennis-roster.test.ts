import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, movePlayer, stepWorld } from '../src/os/arcade/games/tennis/logic.ts';
import { parsePacket, stateOf } from '../src/os/arcade/games/tennis/net.ts';
import { CHARACTER_IDS, characterOf, controlFactor, lineup, powerFactor, ROSTER, seatCharacter, speedFactor, STAT_NAMES, TEMPO_MAX } from '../src/os/arcade/games/tennis/roster.ts';

test('Tennis roster has six distinct characters with bounded stats', () => {
  assert.equal(ROSTER.length, 6);
  assert.equal(new Set(CHARACTER_IDS).size, 6);
  for (const character of ROSTER) {
    for (const stat of STAT_NAMES) assert.ok(character.stats[stat] >= 1 && character.stats[stat] <= 5, `${character.id} ${stat}`);
    const total = STAT_NAMES.reduce((sum, stat) => sum + character.stats[stat], 0);
    assert.ok(total >= 16 && total <= 18, `${character.id} total ${total}`);
  }
  assert.equal(characterOf('nope').id, 'josh');
});

test('Unassigned players keep neutral stats', () => {
  assert.equal(speedFactor(''), 1);
  assert.equal(powerFactor(undefined), 1);
  assert.equal(controlFactor(''), 1);
  assert.ok(speedFactor('cox') > speedFactor('stroke'));
  assert.ok(controlFactor('go') < controlFactor('stroke'));
});

test('Lineup puts the rival in seat 1 and never repeats a character', () => {
  for (let round = 0; round < 30; round++) {
    const random = () => (round * 0.137) % 1;
    const picks = lineup('josh', 'chef', 4, random);
    assert.equal(picks[0], 'josh');
    assert.equal(picks[1], 'chef');
    assert.equal(new Set(picks).size, 4);
    const randomRival = lineup('cox', 'random', 2, random);
    assert.equal(randomRival[0], 'cox');
    assert.notEqual(randomRival[1], 'cox');
  }
  assert.notEqual(lineup('josh', 'josh', 2, () => 0)[1], 'josh');
  assert.equal(new Set([0, 1, 2, 3].map((seat) => seatCharacter(seat, 4))).size, 4);
});

test('Faster characters cover more ground', () => {
  const run = (character: string) => {
    const world = createWorld({ players: [{ ai: null, character }, { ai: 1 }] });
    const player = world.players[0]!;
    world.phase = 'rally';
    player.input = { x: 1, z: 0 };
    const start = player.x;
    for (let i = 0; i < 60; i++) movePlayer(world, player, 1 / 120);
    return player.x - start;
  };
  assert.ok(run('cox') > run('stroke'));
});

test('Character and tempo survive online snapshots and invalid values are rejected', () => {
  const world = createWorld({ format: 'doubles', players: CHARACTER_IDS.slice(0, 4).map((character, seat) => ({ ai: seat ? 1 : null, character })) });
  world.players[0]!.tempo = 3;
  const packet = parsePacket(stateOf(2, world));
  assert.equal(packet?.k, 'S');
  if (packet?.k !== 'S') return;
  assert.deepEqual(packet.state.players.map((player) => player.character), CHARACTER_IDS.slice(0, 4));
  assert.equal(packet.state.players[0]!.tempo, 3);
  const bad = stateOf(2, world);
  bad.state.players[0]!.tempo = TEMPO_MAX + 1;
  assert.equal(parsePacket(bad), null);
  const badId = stateOf(2, world);
  badId.state.players[1]!.character = 'otter';
  assert.equal(parsePacket(badId), null);
});

test('Tempo stays within bounds through simulated play', () => {
  const world = createWorld({ seed: 9, players: [{ ai: 2, character: 'josh' }, { ai: 2, character: 'beat' }] });
  let maxTempo = 0;
  for (let i = 0; i < 120 * 90 && world.match.winner === null; i++) {
    stepWorld(world, [], 1 / 120);
    for (const player of world.players) {
      assert.ok(player.tempo >= 0 && player.tempo <= TEMPO_MAX);
      maxTempo = Math.max(maxTempo, player.tempo);
    }
  }
  assert.ok(maxTempo > 0, 'tempo should build during rallies');
});
