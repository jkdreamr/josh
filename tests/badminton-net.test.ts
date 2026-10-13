import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFlight, newMatch, newStats } from '../src/os/games/badminton.ts';
import { parseGuestMessage, parseScore, parseSnapshot, trailPoint } from '../src/os/apps/badminton-net.ts';

const athlete = { x: -3, vx: 0.5, jump: 0, jumpVelocity: 0, swingStart: -1e9, intent: 'normal' };

test('guest messages are checked before the host uses them', () => {
  assert.deepEqual(parseGuestMessage({ t: 'in', c: { left: true, right: false, jump: false, soft: true } }), { t: 'in', c: { left: true, right: false, jump: false, soft: true } });
  assert.equal(parseGuestMessage({ t: 'in', c: { left: 1, right: false, jump: false, soft: false } }), null);
  assert.deepEqual(parseGuestMessage({ t: 'hit', intent: 'power' }), { t: 'hit', intent: 'power' });
  assert.deepEqual(parseGuestMessage({ t: 'hit' }), { t: 'hit' });
  assert.equal(parseGuestMessage({ t: 'hit', intent: 'nuke' }), null);
  assert.deepEqual(parseGuestMessage({ t: 'seek', x: 3.2 }), { t: 'seek', x: 3.2 });
  assert.deepEqual(parseGuestMessage({ t: 'seek', x: null }), { t: 'seek', x: null });
  assert.equal(parseGuestMessage({ t: 'seek', x: 1e9 }), null);
  assert.deepEqual(parseGuestMessage({ t: 'jump' }), { t: 'jump' });
  assert.deepEqual(parseGuestMessage({ t: 'go' }), { t: 'go' });
  assert.equal(parseGuestMessage({ t: 'serve-for-me' }), null);
  assert.equal(parseGuestMessage('hit'), null);
});

test('snapshots survive a JSON round trip and reject bad fields', () => {
  const flight = createFlight({ x: -2, y: 1.1 }, { vx: 8, vy: 4 }, 'a', 1, true);
  const snap = {
    t: 's', clock: 1234, phase: 'rally', a: athlete, b: { ...athlete, x: 3 }, flight,
    marks: [{ x: 2, at: 1000, kind: 'in' }], impact: { x: -2, y: 1.1, at: 1200, strong: false }, shake: 0, rallyShots: 1,
    lastShot: { type: 'serve', speed: 9 },
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.ok(parsed);
  assert.equal(parsed.flight?.shuttle.vx, 8);
  assert.equal(parsed.b.x, 3);
  assert.equal(parseSnapshot({ ...snap, phase: 'party' }), null);
  assert.equal(parseSnapshot({ ...snap, a: { ...athlete, x: 'left' } }), null);
  assert.equal(parseSnapshot({ ...snap, flight: { ...flight, status: 'gone' } }), null);
  assert.equal(parseSnapshot({ ...snap, flight: null })?.flight, null);
  assert.deepEqual(parseSnapshot({ ...snap, marks: [{ x: 1, at: 2, kind: 'boom' }] })?.marks, []);
});

test('score packets carry a real match', () => {
  const score = { t: 'm', match: newMatch('match'), stats: newStats(), phase: 'serve', call: { key: 3, title: 'Point to Ana', detail: '1 to 0' } };
  const parsed = parseScore(JSON.parse(JSON.stringify(score)));
  assert.ok(parsed);
  assert.equal(parsed.match.bestOf, 3);
  assert.equal(parsed.call?.key, 3);
  assert.equal(parseScore({ ...score, match: { ...score.match, points: { a: 'x', b: 0 } } }), null);
  assert.equal(parseScore({ ...score, match: { ...score.match, matchWinner: 'c' } }), null);
  assert.equal(parseScore({ ...score, stats: {} }), null);
  assert.equal(parseScore({ ...score, call: null })?.call, null);
});

test('the shuttle trail keeps spaced points and a fixed length', () => {
  let trail = trailPoint([], { x: 0, y: 1 });
  trail = trailPoint(trail, { x: 0.05, y: 1 });
  assert.equal(trail.length, 1, 'too close to add');
  for (let i = 1; i <= 20; i++) trail = trailPoint(trail, { x: i, y: 1 });
  assert.equal(trail.length, 14);
  assert.equal(trail.at(-1)?.x, 20);
});
