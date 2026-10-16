import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PITS,
  SEEDS,
  STORE,
  TOTAL,
  apply,
  chooseMove,
  legalMoves,
  newBoard,
  newState,
  opposite,
  parsePacket,
  pitsOf,
  score,
  sow,
  winner,
  type Board,
  type Level,
  type Side,
  type State,
} from '../src/os/arcade/games/mancala/mancala.ts';
import { answer } from '../src/os/arcade/games/mancala/worker.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (b: Board) => b.reduce((s, v) => s + v, 0);
const HARD8 = { maxDepth: 8, budgetMs: 60000 };

test('newBoard: 4 seeds per pit, empty stores, total 48', () => {
  const b = newBoard();
  assert.equal(b.length, 14);
  for (const p of [...pitsOf(0), ...pitsOf(1)]) assert.equal(b[p], SEEDS);
  assert.equal(b[STORE[0]], 0);
  assert.equal(b[STORE[1]], 0);
  assert.equal(sum(b), TOTAL);
  assert.deepEqual(legalMoves(b, 0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(legalMoves(b, 1), [7, 8, 9, 10, 11, 12]);
});

test('opening pit 2 lands in the store for an extra turn', () => {
  const st = newState();
  const out = apply(st, 2)!;
  assert.deepEqual(out.result.path, [3, 4, 5, 6]);
  assert.equal(out.result.last, STORE[0]);
  assert.equal(out.result.extra, true);
  assert.equal(out.state.turn, 0);
  assert.equal(out.state.board[STORE[0]], 1);
});

test('sowing skips the opponent store', () => {
  const b = newBoard();
  b[5] = 9;
  const r = sow(b, 0, 5);
  assert.equal(r.board[13], 0);
  assert.ok(!r.path.includes(13));
  assert.equal(r.path.length, 9);
  const b2 = newBoard();
  b2[12] = 9;
  const r2 = sow(b2, 1, 12);
  assert.equal(r2.board[6], 0);
  assert.ok(!r2.path.includes(6));
});

test('capture: last seed in own empty pit takes the opposite pit too', () => {
  // Side 0: pit 0 has 2 seeds -> drops into 1 and 2. Make pit 2 empty, opposite (10) loaded.
  const b = [2, 0, 0, 0, 0, 0, 5, 0, 0, 0, 7, 0, 0, 3];
  const r = sow(b, 0, 0);
  assert.equal(r.last, 2);
  assert.deepEqual(r.capture, { pit: 2, opposite: 10, seeds: 8 });
  assert.equal(r.board[2], 0);
  assert.equal(r.board[10], 0);
  // Capturing pit 10 also emptied side 1's pits -> game over, and side 0's
  // remaining pit seed is swept into its store: 5 + 8 + 1 = 14.
  assert.equal(r.over, true);
  assert.deepEqual(r.sweep, [1, 0]);
  assert.equal(r.board[STORE[0]], 14);

  // Opposite empty -> no capture, seed stays (side 1 keeps a seed so the game continues).
  const b2 = [2, 0, 0, 0, 0, 0, 5, 1, 0, 0, 0, 0, 0, 3];
  const r2 = sow(b2, 0, 0);
  assert.equal(r2.capture, null);
  assert.equal(r2.board[2], 1);
  assert.equal(r2.board[STORE[0]], 5);

  // Landing in an empty pit on the opponent's side is never a capture.
  const b3 = [1, 0, 0, 0, 0, 2, 5, 0, 1, 0, 0, 0, 0, 3];
  const r3 = sow(b3, 0, 5);
  assert.deepEqual(r3.path, [6, 7]);
  assert.equal(r3.capture, null);
  assert.equal(r3.board[7], 1);

  // Side 1 capture: pit 7 drops one seed into pit 8 (empty), opposite (4) loaded.
  const b4 = [0, 0, 0, 0, 6, 0, 5, 1, 0, 0, 0, 0, 0, 3];
  const r4 = sow(b4, 1, 7);
  assert.equal(r4.last, 8);
  assert.deepEqual(r4.capture, { pit: 8, opposite: 4, seeds: 7 });
  assert.equal(r4.board[STORE[1]], 10);
});

test('end of game: emptying a side sweeps the other side and declares a winner', () => {
  // Side 0 has one seed left in pit 5; sowing it empties side 0.
  const b = [0, 0, 0, 0, 0, 1, 10, 2, 3, 0, 0, 0, 0, 7];
  const r = sow(b, 0, 5);
  assert.equal(r.over, true);
  assert.equal(r.extra, false);
  assert.deepEqual(r.sweep, [0, 5]);
  assert.equal(r.board[STORE[0]], 11);
  assert.equal(r.board[STORE[1]], 12);
  assert.equal(sum(r.board), sum(b));
  assert.equal(winner(r.board), 1);

  const tie = newBoard();
  tie[STORE[0]] = 24;
  tie[STORE[1]] = 24;
  for (const p of [...pitsOf(0), ...pitsOf(1)]) tie[p] = 0;
  assert.equal(winner(tie), null);
});

test('sow and apply never mutate; apply rejects illegal pits', () => {
  const b = newBoard();
  const copy = b.slice();
  sow(b, 0, 3);
  assert.deepEqual(b, copy);
  const st = newState();
  assert.equal(apply(st, 6), null);
  assert.equal(apply(st, 9), null);
  const st2 = { ...st, board: copy.map((v, i) => (i === 3 ? 0 : v)) };
  assert.equal(apply(st2, 3), null);
  const over = { ...st, over: true };
  assert.equal(apply(over, 0), null);
  const out = apply(st, 0)!;
  assert.deepEqual(st.board, copy);
  assert.equal(out.state.seq, 1);
  assert.equal(out.state.ply, 1);
});

test('300 random playouts: seeds conserved, games terminate, chooseMove stays legal', () => {
  const rng = mulberry32(12345);
  for (let g = 0; g < 300; g++) {
    let st: State = newState();
    let plies = 0;
    while (!st.over && plies < 300) {
      const legal = legalMoves(st.board, st.turn);
      // Sample a chooseMove call roughly every game/turn to check legality.
      if ((g + plies) % 7 === 0) {
        for (const level of [0, 1, 2] as Level[]) {
          const pit = chooseMove(st.board, st.turn, level, { rng, maxDepth: 6, budgetMs: 40 });
          assert.ok(legal.includes(pit), `level ${level} returned ${pit}`);
        }
      }
      const pit = legal[Math.floor(rng() * legal.length)];
      const out = apply(st, pit)!;
      assert.equal(sum(out.state.board), TOTAL);
      st = out.state;
      plies++;
    }
    assert.ok(st.over, `game ${g} did not terminate in 300 plies`);
  }
});

// Returns 1 if A wins, 0.5 for a tie, 0 if B wins. A plays side `aSide`.
function playMatch(rng: () => number, lvA: Level, lvB: Level, aSide: Side, optsA: object, optsB: object, openingPlies = 0): number {
  let st = newState();
  // Random opening plies to vary the positions.
  for (let i = 0; i < openingPlies && !st.over; i++) {
    const legal = legalMoves(st.board, st.turn);
    st = apply(st, legal[Math.floor(rng() * legal.length)])!.state;
  }
  let plies = 0;
  while (!st.over && plies < 400) {
    const isA = st.turn === aSide;
    const pit = chooseMove(st.board, st.turn, isA ? lvA : lvB, { rng, ...(isA ? optsA : optsB) });
    st = apply(st, pit)!.state;
    plies++;
  }
  const w = winner(st.board);
  if (w === null) return 0.5;
  return w === aSide ? 1 : 0;
}

test('hard beats easy convincingly', () => {
  const rng = mulberry32(999);
  let wins = 0;
  const t0 = Date.now();
  for (let g = 0; g < 20; g++) {
    wins += playMatch(rng, 2, 0, (g % 2) as Side, HARD8, {});
  }
  assert.ok(wins >= 18, `hard only won ${wins}/20 vs easy`);
  console.log(`hard vs easy: ${wins}/20 in ${Date.now() - t0}ms`);
});

test('normal beats easy', () => {
  const rng = mulberry32(4242);
  let wins = 0;
  const t0 = Date.now();
  for (let g = 0; g < 20; g++) {
    wins += playMatch(rng, 1, 0, (g % 2) as Side, {}, {});
  }
  assert.ok(wins >= 14, `normal only won ${wins}/20 vs easy`);
  console.log(`normal vs easy: ${wins}/20 in ${Date.now() - t0}ms`);
});

test('hard beats normal from varied openings', () => {
  const rng = mulberry32(777);
  let wins = 0;
  let losses = 0;
  const t0 = Date.now();
  for (let g = 0; g < 12; g++) {
    const r = playMatch(rng, 2, 1, (g % 2) as Side, HARD8, {}, 4);
    if (r === 1) wins++;
    else if (r === 0) losses++;
  }
  assert.ok(wins >= 7 && wins > losses, `hard ${wins} / losses ${losses} vs normal`);
  console.log(`hard vs normal: ${wins}W ${losses}L in ${Date.now() - t0}ms`);
});

test('hard respects its time budget and finds an extra-turn capture tactic', () => {
  const t0 = Date.now();
  const pit = chooseMove(newBoard(), 0, 2, { budgetMs: 300 });
  assert.ok(Date.now() - t0 < 700, `took ${Date.now() - t0}ms`);
  assert.ok(legalMoves(newBoard(), 0).includes(pit));

  // Side 0 has two moves. Sowing pit 0 captures opposite pit 11's 9 seeds
  // directly (store -> 14), but side 1 still has seeds so the game continues.
  // Sowing pit 5 lands in the store for an extra turn, then plays pit 0 for
  // the same capture, which empties side 0's pits and ends the game at once
  // with the store banked. Hard must prefer the extra-turn line.
  const tac = [1, 0, 0, 0, 0, 1, 4, 1, 0, 0, 0, 9, 0, 6];
  const pick = chooseMove(tac, 0, 2, { rng: mulberry32(1), ...HARD8 });
  assert.equal(pick, 5);
});

test('parsePacket accepts valid packets and rejects malformed ones', () => {
  const st = newState();
  assert.deepEqual(parsePacket({ t: 'hello' }), { t: 'hello' });
  assert.deepEqual(parsePacket({ t: 'pick', seq: 0, pit: 3 }), { t: 'pick', seq: 0, pit: 3 });
  assert.deepEqual(parsePacket({ t: 'sync', state: st }), { t: 'sync', state: st });
  assert.deepEqual(parsePacket({ t: 'move', seq: 2, pit: 0, state: st }), { t: 'move', seq: 2, pit: 0, state: st });

  assert.equal(parsePacket(null), null);
  assert.equal(parsePacket(42), null);
  assert.equal(parsePacket({ t: 'nope' }), null);
  assert.equal(parsePacket({ t: 'pick', seq: -1, pit: 3 }), null);
  assert.equal(parsePacket({ t: 'pick', seq: 0, pit: 6 }), null);
  assert.equal(parsePacket({ t: 'pick', seq: 0, pit: 13 }), null);
  assert.equal(parsePacket({ t: 'pick', seq: 0, pit: 1.5 }), null);
  assert.equal(parsePacket({ t: 'sync', state: { ...st, board: st.board.slice(1) } }), null);
  const bad = st.board.slice();
  bad[0] += 1;
  assert.equal(parsePacket({ t: 'sync', state: { ...st, board: bad } }), null);
  assert.equal(parsePacket({ t: 'sync', state: { ...st, turn: 2 } }), null);
  assert.equal(parsePacket({ t: 'move', seq: 0, pit: 1, state: { ...st, seq: -1 } }), null);
  const neg = st.board.slice();
  neg[0] = -1;
  neg[1] = 5;
  assert.equal(parsePacket({ t: 'sync', state: { ...st, board: neg } }), null);
});

test('worker answer returns a legal pit', () => {
  const r = answer({ id: 7, board: newBoard(), side: 0, level: 1 });
  assert.equal(r.id, 7);
  assert.ok(legalMoves(newBoard(), 0).includes(r.pit));
});
