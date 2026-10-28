import assert from 'node:assert/strict';
import test from 'node:test';
import { createCup, recordUserResult, userFixture } from '../src/os/arcade/games/soccer/cup.ts';
import { hasLobbyPhoneMember, nextCupFixtureText, hostLobbyStatus, lobbySetupOptions, phoneRoute, phoneStatusLine, postMatchPrimaryLabel, requiredPhones, sideForLobbyMember } from '../src/os/arcade/games/soccer/phone-flow.ts';
import { DEFAULT_CLUBS } from '../src/os/arcade/games/soccer/teams.ts';
import { postMatchNavPacket, repeatPostMatchNav } from '../src/os/arcade/games/soccer/post-match-nav.ts';

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

test('phone picker waits for the lobby to register its seat before sending input', () => {
  const members = [{ seat: 0, role: 'host' as const }, { seat: 2, role: 'phone' as const }];
  assert.equal(hasLobbyPhoneMember(members, 1), false);
  assert.equal(hasLobbyPhoneMember(members, 0), false);
  assert.equal(hasLobbyPhoneMember(members, 2), true);
});

test('phone lobby lists connected phones and routes to the picker only in the lobby', () => {
  assert.equal(phoneStatusLine([{ seat: 2, role: 'phone' }, { seat: 1, role: 'phone' }]), 'Phone 1 ✓ · Phone 2 ✓');
  assert.equal(phoneStatusLine([{ seat: 6, role: 'phone', side: 1 }, { seat: 2, role: 'phone', side: 0 }], [true, false]), 'Phone 1 ready · Phone 2 ✓');
  assert.equal(phoneRoute(0, false, 'lobby'), 'picker');
  assert.equal(phoneRoute(0, true), 'controller');
  assert.equal(phoneRoute(0, false, 'match'), 'controller');
  assert.equal(phoneRoute(2, false, 'lobby'), 'picker');
});

test('post-match phone stick navigation respects direction, repeat timing, and packet sequence', () => {
  const initial = { seq: -1, edge: -1, direction: 0 as const, changedAt: 0 };
  const up = postMatchNavPacket(initial, { seq: 1, z: -0.8, buttons: 0 }, 1000);
  assert.equal(up.move, -1);
  assert.equal(up.state.direction, -1);
  assert.equal(postMatchNavPacket(up.state, { seq: 2, z: -0.2, buttons: 0 }, 1200).move, 0);
  const repeat = repeatPostMatchNav(up.state, 1320);
  assert.equal(repeat.move, -1);
  assert.equal(repeatPostMatchNav(repeat.state, 1420).move, 0);
  assert.equal(postMatchNavPacket(repeat.state, { seq: 3, z: 0.8, buttons: 0 }, 1500).move, 1);
  assert.equal(postMatchNavPacket(up.state, { seq: 1, z: 0.8, buttons: 0 }, 1600).move, 0);
});

test('post-match phone A chooses once per fresh button edge', () => {
  const first = postMatchNavPacket({ seq: -1, edge: -1, direction: 0, changedAt: 0 }, { seq: 1, z: 0, e: 1, buttons: 1 }, 1000);
  assert.equal(first.choose, true);
  const repeated = postMatchNavPacket(first.state, { seq: 2, z: 0, e: 1, buttons: 1 }, 1100);
  assert.equal(repeated.choose, false);
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
