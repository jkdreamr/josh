import assert from 'node:assert/strict';
import test from 'node:test';
import {
  caretMeasurementRange,
  findAdjacentVisualCaretOffset,
  groupCaretPointsByLine,
  moveCaretSelection,
  moveCaretToDocumentBoundary,
  moveCaretToLogicalBoundary,
  moveLogicalCaret,
  selectionFocus,
  type CaretSelection,
} from '../src/os/laptop3d/typing.ts';

test('caret measurement is limited to the previous, current, and next logical lines', () => {
  const value = Array.from({ length: 101 }, (_, index) => `line ${index}`).join('\n');
  const offset = value.indexOf('line 50') + 4;
  const previousLineStart = value.indexOf('line 49');
  const nextLineStart = value.indexOf('line 51');
  const nextLineEnd = value.indexOf('\n', nextLineStart);
  const lastLineStart = value.lastIndexOf('\n', value.length - 1) + 1;
  const lineBeforeLastStart = value.lastIndexOf('\n', lastLineStart - 2) + 1;

  assert.deepEqual(caretMeasurementRange(value, offset), { start: previousLineStart, end: nextLineEnd });
  assert.ok(nextLineEnd - previousLineStart < value.length / 2);
  assert.deepEqual(caretMeasurementRange(value, 0), {
    start: 0,
    end: value.indexOf('\n', value.indexOf('\n') + 1),
  });
  assert.deepEqual(caretMeasurementRange(value, value.length), { start: lineBeforeLastStart, end: value.length });
});

test('visual caret movement chooses the closest x on the adjacent measured line', () => {
  const lines = groupCaretPointsByLine([
    { offset: 0, x: 0, y: 0 },
    { offset: 1, x: 10, y: 0.1 },
    { offset: 2, x: 20, y: 0.2 },
    { offset: 3, x: 0, y: 20 },
    { offset: 4, x: 10, y: 20.1 },
    { offset: 5, x: 20, y: 20.2 },
  ]);

  assert.equal(lines.length, 2);
  assert.equal(findAdjacentVisualCaretOffset(lines, 4, 'up', 18, 5), 2);
  assert.equal(findAdjacentVisualCaretOffset(lines, 1, 'down', 19, 5), 5);
});

test('visual caret movement preserves both positions at a soft-wrap boundary', () => {
  const lines = groupCaretPointsByLine([
    { offset: 0, x: 0, y: 0 },
    { offset: 1, x: 10, y: 0 },
    { offset: 2, x: 20, y: 0, affinity: 'upstream' },
    { offset: 2, x: 0, y: 20, affinity: 'downstream' },
    { offset: 3, x: 10, y: 20 },
  ]);

  assert.equal(lines.length, 2);
  assert.equal(findAdjacentVisualCaretOffset(lines, 3, 'up', 19, 3), 2);
  assert.equal(findAdjacentVisualCaretOffset(lines, 2, 'down', 0, 3), 3);
  assert.equal(findAdjacentVisualCaretOffset(lines, 2, 'down', 0, 3, 0), 2);
});

test('visual caret movement snaps subpixel ties to the earlier caret', () => {
  const lines = groupCaretPointsByLine([
    { offset: 1, x: 9.9, y: 0 },
    { offset: 2, x: 10.1, y: 0 },
    { offset: 3, x: 10.25, y: 20 },
  ]);

  assert.equal(findAdjacentVisualCaretOffset(lines, 3, 'up', 10.25, 3), 1);
});

test('logical-line movement clamps on short lines and keeps the original goal column', () => {
  const value = 'abcdef\nxy\nabcdef';
  const firstDown = moveLogicalCaret(value, 5, 'down');
  assert.deepEqual(firstDown, { offset: 9, goalColumn: 5 });

  const secondDown = moveLogicalCaret(value, firstDown.offset, 'down', firstDown.goalColumn);
  assert.deepEqual(secondDown, { offset: 15, goalColumn: 5 });

  const firstUp = moveLogicalCaret(value, secondDown.offset, 'up', secondDown.goalColumn);
  assert.deepEqual(firstUp, { offset: 9, goalColumn: 5 });
  assert.deepEqual(moveLogicalCaret(value, firstUp.offset, 'up', firstUp.goalColumn), { offset: 5, goalColumn: 5 });
});

test('vertical movement stays at the document edges on the first and last lines', () => {
  const value = 'abc\nde';
  assert.deepEqual(moveLogicalCaret(value, 0, 'up'), { offset: 0, goalColumn: 0 });
  assert.deepEqual(moveLogicalCaret(value, value.length, 'down'), { offset: value.length, goalColumn: 2 });

  const lines = groupCaretPointsByLine([
    { offset: 0, x: 0, y: 0 },
    { offset: 1, x: 10, y: 0 },
    { offset: 2, x: 0, y: 20 },
    { offset: 3, x: 10, y: 20 },
  ]);
  assert.equal(findAdjacentVisualCaretOffset(lines, 0, 'up', 10, 3), 0);
  assert.equal(findAdjacentVisualCaretOffset(lines, 3, 'down', 10, 3), 3);
});

test('shifted vertical movement retains its selection anchor', () => {
  let selection: CaretSelection = { start: 4, end: 4, direction: 'none' };
  selection = moveCaretSelection(selection, 1, true);
  assert.deepEqual(selection, { start: 1, end: 4, direction: 'backward' });
  assert.equal(selectionFocus(selection), 1);

  selection = moveCaretSelection(selection, 0, true);
  assert.deepEqual(selection, { start: 0, end: 4, direction: 'backward' });
  selection = moveCaretSelection(selection, 5, true);
  assert.deepEqual(selection, { start: 4, end: 5, direction: 'forward' });
});

test('Command+Up and Command+Down move to document boundaries and extend with Shift', () => {
  const selection: CaretSelection = { start: 2, end: 4, direction: 'forward' };
  assert.deepEqual(moveCaretToDocumentBoundary(selection, 6, 'up', false), {
    start: 0,
    end: 0,
    direction: 'none',
  });
  assert.deepEqual(moveCaretToDocumentBoundary(selection, 6, 'down', false), {
    start: 6,
    end: 6,
    direction: 'none',
  });
  const shiftUp = moveCaretToDocumentBoundary(selection, 6, 'up', true);
  assert.deepEqual(shiftUp, { start: 0, end: 2, direction: 'backward' });
  assert.deepEqual(moveCaretToDocumentBoundary(shiftUp, 6, 'down', true), {
    start: 2,
    end: 6,
    direction: 'forward',
  });
});

test('Option+Up and Option+Down move between logical line boundaries', () => {
  const value = 'first\nsecond\nthird';
  assert.equal(moveCaretToLogicalBoundary(value, 9, 'up'), 6);
  assert.equal(moveCaretToLogicalBoundary(value, 6, 'up'), 0);
  assert.equal(moveCaretToLogicalBoundary(value, 3, 'down'), 5);
  assert.equal(moveCaretToLogicalBoundary(value, 5, 'down'), 12);
  assert.equal(moveCaretToLogicalBoundary(value, 12, 'down'), value.length);
});
