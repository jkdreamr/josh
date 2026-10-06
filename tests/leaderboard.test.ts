import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSubmission } from '../src/pages/api/leaderboard.ts';

test('leaderboard validation normalizes names and accepts valid results', () => {
  assert.deepEqual(validateSubmission({ distance: 500, name: '  jo\u0007sh  ', timeMs: 80_000 }), {
    value: { distance: 500, name: 'josh', timeMs: 80_000 },
  });
});

test('leaderboard validation rejects invalid distances, names, and times', () => {
  assert.equal(validateSubmission({ distance: 750, name: 'josh', timeMs: 100_000 }).error, 'invalid distance');
  assert.equal(validateSubmission({ distance: 500, name: '   ', timeMs: 100_000 }).error, 'invalid name');
  assert.equal(validateSubmission({ distance: 500, name: '12345678901234567', timeMs: 100_000 }).error, 'invalid name');
  assert.equal(validateSubmission({ distance: 500, name: 'josh', timeMs: NaN }).error, 'invalid time');
  assert.equal(validateSubmission({ distance: 500, name: 'josh', timeMs: 71_702 }).error, 'invalid time');
  assert.equal(validateSubmission({ distance: 500, name: 'josh', timeMs: 1_200_001 }).error, 'invalid time');
  assert.equal(validateSubmission({ distance: 500, name: 'josh', timeMs: 80_000 }).error, undefined);
});
