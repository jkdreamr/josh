/* Copyright (c) 2026 Web KatRain Contributors. MIT License.
 * Feature and ladder logic derived from KataGo, MIT. See ./LICENSE.md
 */
import { BLACK, play, type Color, type GameState, type Stone } from '../go.ts';
import { computeAreaMapV7KataGo, computeLadderedStonesV7KataGoInto, computeLadderFeaturesV7KataGoInto, computeLibertyMap, setBoardSize, type StoneColor } from './fastBoard.ts';

export type HistoryMove = { player: Color; move: number };
const SIZE = 9;
const CHANNELS = 22;
const FLIP = (color: Color): Color => color === BLACK ? -1 : 1;
const toFastColor = (color: Stone): StoneColor => color === 1 ? 1 : color === -1 ? 2 : 0;

export function moveHistory(state: GameState): HistoryMove[] {
  return state.past.map((before, index) => {
    const after = state.past[index + 1] ?? state;
    return {
      player: before.toPlay,
      move: after.lastMove ? after.lastMove.y * SIZE + after.lastMove.x : -1,
    };
  });
}

export function symmetryIndex(symmetry: number, position: number): number {
  const x = position % SIZE;
  const y = Math.floor(position / SIZE);
  const reflectedX = symmetry >= 4 ? SIZE - 1 - x : x;
  let tx = reflectedX;
  let ty = y;
  switch (symmetry % 4) {
    case 1: tx = SIZE - 1 - y; ty = reflectedX; break;
    case 2: tx = SIZE - 1 - reflectedX; ty = SIZE - 1 - y; break;
    case 3: tx = y; ty = SIZE - 1 - reflectedX; break;
  }
  return ty * SIZE + tx;
}

function boardFromState(state: GameState): Uint8Array {
  return Uint8Array.from(state.board, toFastColor);
}

function koPointAfterMove(
  current: readonly Stone[],
  previous: readonly Stone[] | undefined,
  move: GameState['lastMove'],
  player: Color | undefined,
): number {
  if (!previous || !move || !player) return -1;
  const moveIndex = move.y * SIZE + move.x;
  if (previous[moveIndex] !== 0 || current[moveIndex] !== player) return -1;
  let changed = 0;
  let captured = -1;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] === previous[index]) continue;
    changed += 1;
    if (index !== moveIndex) {
      if (previous[index] !== -player || current[index] !== 0) return -1;
      captured = index;
    }
  }
  return changed === 2 ? captured : -1;
}

export function encodeV7(state: GameState, symmetry = 0): { spatial: Float32Array; global: Float32Array } {
  setBoardSize(SIZE);
  const spatial = new Float32Array(SIZE * SIZE * CHANNELS);
  const global = new Float32Array(19);
  const place = (index: number, channel: number): void => {
    const transformed = symmetryIndex(symmetry, index);
    spatial[transformed * CHANNELS + channel] = 1;
  };
  for (let position = 0; position < SIZE * SIZE; position += 1) spatial[symmetryIndex(symmetry, position) * CHANNELS] = 1;
  const board = boardFromState(state);
  const liberties = computeLibertyMap(board);
  for (let position = 0; position < board.length; position += 1) {
    const stone = state.board[position]!;
    if (stone === state.toPlay) place(position, 1);
    else if (stone === -state.toPlay) place(position, 2);
    if (stone !== 0) {
      const liberty = liberties[position]!;
      if (liberty === 1) place(position, 3);
      else if (liberty === 2) place(position, 4);
      else if (liberty === 3) place(position, 5);
    }
    if (stone === 0) {
      const result = play(state, position % SIZE, Math.floor(position / SIZE));
      if (!result.ok && result.reason === 'ko') place(position, 6);
    }
  }

  const history = moveHistory(state);
  const maxTurns = state.consecutivePasses >= 2 ? 1 : 5;
  for (let offset = 0; offset < maxTurns && offset < history.length; offset += 1) {
    const entry = history[history.length - 1 - offset]!;
    if (entry.player !== (offset % 2 === 0 ? FLIP(state.toPlay) : state.toPlay)) break;
    if (entry.move === -1) global[offset] = 1;
    else place(entry.move, 9 + offset);
  }
  global[5] = (state.toPlay === 1 ? -7.5 : 7.5) / 20;
  global[6] = 1;
  global[7] = 0.5;
  global[14] = state.consecutivePasses > 0 ? 1 : 0;
  global[18] = state.toPlay === 1 ? -0.5 : 0.5;

  const currentLadder = new Uint8Array(81);
  const currentWorking = new Uint8Array(81);
  const previousState = state.past.at(-1);
  const previousPreviousState = state.past.at(-2);
  const currentKoPoint = koPointAfterMove(state.board, previousState?.board, state.lastMove, previousState?.toPlay);
  computeLadderFeaturesV7KataGoInto({
    stones: board,
    koPoint: currentKoPoint,
    currentPlayer: toFastColor(state.toPlay),
    outLadderedStones: currentLadder,
    outLadderWorkingMoves: currentWorking,
  });
  const included = Math.min(maxTurns, history.length);
  const previous = included >= 1 && previousState ? boardFromState(previousState as GameState) : board;
  const previousPrevious = included >= 2 && previousPreviousState
    ? boardFromState(previousPreviousState as GameState)
    : previous;
  const previousKoPoint = included >= 1 && previousState
    ? koPointAfterMove(previousState.board, previousPreviousState?.board, previousState.lastMove, previousPreviousState?.toPlay)
    : currentKoPoint;
  const previousLadder = new Uint8Array(81);
  const previousPreviousLadder = new Uint8Array(81);
  computeLadderedStonesV7KataGoInto({ stones: previous, koPoint: previousKoPoint, outLadderedStones: previousLadder });
  computeLadderedStonesV7KataGoInto({ stones: previousPrevious, koPoint: -1, outLadderedStones: previousPreviousLadder });
  for (let position = 0; position < 81; position += 1) {
    if (currentLadder[position]) place(position, 14);
    if (previousLadder[position]) place(position, 15);
    if (previousPreviousLadder[position]) place(position, 16);
    if (currentWorking[position]) place(position, 17);
  }
  const area = computeAreaMapV7KataGo(board);
  for (let position = 0; position < 81; position += 1) {
    if (area[position] === toFastColor(state.toPlay)) place(position, 18);
    else if (area[position] === toFastColor(-state.toPlay as Color)) place(position, 19);
  }
  return { spatial, global };
}
