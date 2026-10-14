import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPlaying, onPlaying, reportPlaying } from '../src/os/arcade/playing.ts';
import { badgeLabel, badgeOf, setBadge } from '../src/os/badges.ts';
import { PANEL_GAP, sidePanel } from '../src/os/placement.ts';

const screen = { w: 1280, top: 32, bottom: 700 };

test('sidePanel docks down the right edge, full height', () => {
  const { panel, moves } = sidePanel(screen, 380, []);
  assert.deepEqual(panel, { x: 1280 - 380 - PANEL_GAP, y: 32, w: 380, h: 668 });
  assert.equal(moves.size, 0);
});

test('sidePanel slides a window it would cover to the left, as far as it needs', () => {
  const { panel, moves } = sidePanel(screen, 380, [{ id: 'arcade', x: 290, y: 60, w: 700, h: 600 }]);
  assert.equal(moves.get('arcade'), panel.x - PANEL_GAP - 700);
  assert.ok(moves.get('arcade')! + 700 <= panel.x - PANEL_GAP);
});

test('sidePanel leaves windows that are already clear, and stops a wide one at the left edge', () => {
  const { moves } = sidePanel(screen, 380, [
    { id: 'notes', x: 20, y: 60, w: 400, h: 300 },
    { id: 'arcade', x: 180, y: 60, w: 920, h: 600 },
  ]);
  assert.equal(moves.has('notes'), false);
  assert.equal(moves.get('arcade'), PANEL_GAP);
});

test('sidePanel never moves a window right, and fits a small screen', () => {
  const { moves } = sidePanel(screen, 380, [{ id: 'chrome', x: 4, y: 60, w: 1100, h: 600 }]);
  assert.equal(moves.has('chrome'), false);
  const small = sidePanel({ w: 300, top: 30, bottom: 500 }, 380, []);
  assert.equal(small.panel.w, 300 - 2 * PANEL_GAP);
  assert.equal(small.panel.x, PANEL_GAP);
});

test('badges count up, clear at zero, and say 99+ past that', () => {
  assert.equal(badgeOf('lounge'), 0);
  setBadge('lounge', 3);
  assert.equal(badgeOf('lounge'), 3);
  setBadge('lounge', -2);
  assert.equal(badgeOf('lounge'), 0);
  assert.equal(badgeLabel(7), '7');
  assert.equal(badgeLabel(100), '99+');
});

test('playing shows the game opened (or brought to the front) last, and nothing once they all close', () => {
  const changes: (string | null)[] = [];
  const off = onPlaying(() => changes.push(currentPlaying()?.game ?? null));
  assert.equal(currentPlaying(), null);
  const snake = reportPlaying({ game: 'snake' });
  const omok = reportPlaying({ game: 'omok', room: 'WXYZ' });
  assert.deepEqual(currentPlaying(), { game: 'omok', room: 'WXYZ' });
  snake.touch();
  assert.deepEqual(currentPlaying(), { game: 'snake' });
  snake.touch();
  snake.stop();
  assert.deepEqual(currentPlaying(), { game: 'omok', room: 'WXYZ' });
  omok.stop();
  omok.touch();
  assert.equal(currentPlaying(), null);
  off();
  // Listeners only hear real changes: bringing snake forward again while it was in front said nothing.
  assert.deepEqual(changes, ['snake', 'omok', 'snake', 'omok', null]);
});
