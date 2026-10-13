import assert from 'node:assert/strict';
import test from 'node:test';
import { dayKey, formatCount, isGameId, isStatsSummary, parseHit, periodStarts, shiftDay, type StatsSummary } from '../src/os/stats-core.ts';

test('dayKey rolls over at midnight in Palo Alto', () => {
  assert.equal(dayKey(new Date('2026-10-13T06:59:00Z')), '2026-10-12');
  assert.equal(dayKey(new Date('2026-10-13T07:00:00Z')), '2026-10-13');
  assert.equal(dayKey(new Date('2026-01-01T07:59:00Z')), '2025-12-31');
  assert.equal(dayKey(new Date('2026-01-01T08:00:00Z')), '2026-01-01');
  assert.equal(dayKey(new Date('2026-10-13T06:59:00Z'), 'UTC'), '2026-10-13');
});

test('shiftDay moves across months, years, leap days and DST changes', () => {
  assert.equal(shiftDay('2026-10-13', -6), '2026-10-07');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-11-01', 1), '2026-11-02');
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
});

test('periodStarts covers today, the last 7 days and the last 30 days', () => {
  assert.deepEqual(periodStarts('2026-10-13'), { today: '2026-10-13', week: '2026-10-07', month: '2026-09-14' });
});

test('parseHit accepts views and plays and rejects anything else', () => {
  const visitor = '3b241101-e2bb-4255-8caf-4136c566a962';
  assert.deepEqual(parseHit('view', JSON.stringify({ visitor })), { kind: 'view', visitor });
  assert.deepEqual(parseHit('play', JSON.stringify({ visitor, game: 'run-3d' })), { kind: 'play', visitor, game: 'run-3d' });
  assert.equal(parseHit('play', JSON.stringify({ visitor })), null);
  assert.equal(parseHit('play', JSON.stringify({ visitor, game: 'Not A Game' })), null);
  assert.equal(parseHit('view', JSON.stringify({ visitor: 'short' })), null);
  assert.equal(parseHit('view', JSON.stringify({ visitor: 'has spaces in it' })), null);
  assert.equal(parseHit('view', JSON.stringify([visitor])), null);
  assert.equal(parseHit('view', 'not json'), null);
  assert.equal(parseHit('view', JSON.stringify({ visitor, pad: 'x'.repeat(600) })), null);
  assert.equal(parseHit('click', JSON.stringify({ visitor })), null);
});

test('isGameId matches arcade folder names and app ids', () => {
  for (const id of ['2048', 'flappy', 'chicken-crossing', 'baduk']) assert.ok(isGameId(id), id);
  for (const id of ['', '-dino', 'dino-', 'Dino', 'a'.repeat(33), 'a b', 'x/../y']) assert.ok(!isGameId(id), id);
});

test('isStatsSummary checks the Worker response shape', () => {
  const counts = { today: 1, week: 2, month: 3, all: 4 };
  const summary: StatsSummary = {
    views: counts,
    plays: counts,
    visitors: counts,
    top: { today: [], week: [{ game: 'dino', plays: 2 }], month: [], all: [{ game: 'dino', plays: 4 }] },
    since: '2026-10-13',
  };
  assert.ok(isStatsSummary(summary));
  assert.ok(isStatsSummary({ ...summary, since: null }));
  assert.ok(!isStatsSummary(null));
  assert.ok(!isStatsSummary({ error: 'not found' }));
  assert.ok(!isStatsSummary({ ...summary, views: { ...counts, all: '4' } }));
  assert.ok(!isStatsSummary({ ...summary, top: { ...summary.top, all: [{ game: 'dino' }] } }));
  assert.ok(!isStatsSummary({ ...summary, since: 'yesterday' }));
});

test('formatCount is exact below a million and compact above', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1234), '1,234');
  assert.equal(formatCount(999_999), '999,999');
  assert.equal(formatCount(1_250_000), '1.3M');
});
