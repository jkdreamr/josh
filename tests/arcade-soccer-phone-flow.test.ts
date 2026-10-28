import assert from 'node:assert/strict';
import test from 'node:test';
import { createCup, recordUserResult, userFixture } from '../src/os/arcade/games/soccer/cup.ts';
import { nextCupFixtureText, hostLobbyStatus, lobbySetupOptions, phoneRoute, phoneStatusLine, postMatchPrimaryLabel, requiredPhones, sideForLobbyMember } from '../src/os/arcade/games/soccer/phone-flow.ts';
import { DEFAULT_CLUBS } from '../src/os/arcade/games/soccer/teams.ts';
import { reconnectedSeats } from '../src/os/arcade/games/soccer/net.ts';

test('quick phone lobby includes practice after the player modes', () => {
  assert.deepEqual(lobbySetupOptions('quick'), ['cpu', 'versus', 'coop', 'practice']);
});

test('phone requirements and second-player status match the selected setup', () => {
  assert.equal(requiredPhones('quick', 'practice'), 1);
  assert.equal(requiredPhones('quick', 'versus'), 2);
  assert.equal(requiredPhones('online', 'versus'), 0);
  assert.equal(hostLobbyStatus({ competition: 'quick', mode: 'versus', phoneCount: 1, guestMac: false }),
    'Scan the QR with a second iPhone to play 2 player');
});

test('host lobby assigns versus phone sides by seat while other modes stay home', () => {
  assert.equal(sideForLobbyMember('quick', 'versus', 'phone', 1, 1), 0);
  assert.equal(sideForLobbyMember('quick', 'versus', 'phone', 2, 0), 1);
  assert.equal(sideForLobbyMember('quick', 'cpu', 'phone', 2, 1), 0);
  assert.equal(sideForLobbyMember('quick', 'practice', 'phone', 1, 1), 0);
  assert.equal(sideForLobbyMember('online', 'cpu', 'mac', 2, 1), 1);
});

test('phone lobby lists connected phones and only routes to the picker in the lobby', () => {
  assert.equal(phoneStatusLine([{ seat: 2, role: 'phone' }, { seat: 1, role: 'phone' }]), 'Phone 1 ✓ · Phone 2 ✓');
  assert.equal(phoneRoute(0, false, 'lobby'), 'picker');
  assert.equal(phoneRoute(0, true), 'controller');
  assert.equal(phoneRoute(0, false, 'match'), 'controller');
  assert.equal(phoneRoute(2, false, 'lobby'), 'picker');
  assert.deepEqual(reconnectedSeats([1, 2], [2, 1]), []);
  assert.deepEqual(reconnectedSeats([1], [1, 2]), [2]);
});

test('post-match primary follows the competition and cup result', () => {
  assert.equal(postMatchPrimaryLabel('quick', false), 'Rematch');
  assert.equal(postMatchPrimaryLabel('cup', true), 'Next match');
  assert.equal(postMatchPrimaryLabel('cup', false), 'New cup');
});

test('cup result text names the next fixture in plain language', () => {
  const cup = createCup(DEFAULT_CLUBS[0].id, 42);
  const fixture = userFixture(cup)!;
  const advanced = recordUserResult(cup, fixture.home === cup.user ? [9, 0] : [0, 9]);
  assert.match(nextCupFixtureText(advanced) ?? '', /^Next: semi-final vs .+\.$/);
});
