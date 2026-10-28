import assert from 'node:assert/strict';
import {
  distance,
  FIELD,
  nearestCarrier,
  STEP,
  type World,
  type Restart,
  type Team,
} from '../../src/os/arcade/games/soccer/logic.ts';

export function globalInvariants() {
  let score = [0, 0],
    half = 1,
    clock = Infinity,
    still = 0;
  let anchor: { x: number; z: number } | null = null;
  const overlaps = new Map<string, number>();
  return (w: World, frame: number, paused = false) => {
    const label = 'frame ' + frame;
    for (const entity of [...w.players, w.ball])
      for (const [key, value] of Object.entries(entity))
        if (typeof value === 'number') assert.ok(Number.isFinite(value), label + ' nonfinite ' + key);
    for (const p of w.players.filter((p) => !p.sentOff)) {
      assert.ok(
        Math.abs(p.x) <= FIELD.length / 2 + 0.01 && Math.abs(p.z) <= FIELD.width / 2 + 0.01,
        label + ' out of bounds ' + p.id,
      );
    }
    for (let a = 0; a < w.players.length; a++)
      for (let b = a + 1; b < w.players.length; b++) {
        const p = w.players[a]!,
          q = w.players[b]!,
          key = a + ':' + b;
        const duration =
          !p.sentOff && !q.sentOff && distance(p, q) < 0.45 ? (overlaps.get(key) ?? 0) + (paused ? 0 : STEP) : 0;
        overlaps.set(key, duration);
        assert.ok(duration <= 0.5, label + ' sustained overlap ' + key);
      }
    for (const t of [0, 1]) assert.ok(w.score[t]! >= score[t]!, label + ' score decreased');
    if (w.half === half) assert.ok(w.clock <= clock + 1e-8, label + ' clock increased within half');
    score = [...w.score];
    half = w.half;
    clock = w.clock;
    if (w.phase === 'live' && !nearestCarrier(w)) {
      if (!anchor || distance(anchor, w.ball) > 0.5) {
        anchor = { ...w.ball };
        still = 0;
      }
      if (!paused) still += STEP;
      assert.ok(still <= 3, label + ' loose ball stuck for >3s');
    } else {
      still = 0;
      anchor = null;
    }
    if (w.phase === 'restart' && w.event === 'offside') {
      assert.equal(w.restart, 'free-kick');
      assert.ok(w.rules?.indirect);
    }
    if (w.phase === 'restart' && w.event === 'foul') assert.ok(w.restart === 'free-kick' || w.restart === 'penalty');
    if (w.phase === 'restart' && ['corner', 'goal-kick', 'kick-in'].includes(w.restart ?? '')) {
      assert.notEqual(w.restartTeam, w.lastTouch, label + ' restart must oppose last touch');
      if (w.restart !== 'kick-in') {
        const defending = w.restartAt.x > 0 ? (w.endsSwapped ? 0 : 1) : w.endsSwapped ? 1 : 0;
        assert.equal(
          w.restartTeam,
          w.restart === 'corner' ? 1 - defending : defending,
          label + ' goal-line restart cause',
        );
      }
    }
    if (w.setPiece)
      assert.equal(
        w.setPiece.kind,
        w.restart === 'kick-in' ? 'throw-in' : w.restart,
        label + ' restart/set-piece mismatch',
      );
  };
}
export const passReached = (id: number) => (w: World) => w.lastToucherId === id && w.carrierId === id;
export const restartBecame = (kind: Restart, team: Team) => (w: World) =>
  w.phase === 'restart' && w.restart === kind && w.restartTeam === team;
export const goalScored = (team: Team) => (w: World) => w.score[team] > 0;
export function eventually(predicate: (w: World) => boolean) {
  let seen = false;
  return {
    observe(w: World) {
      seen ||= predicate(w);
    },
    assert(message: string) {
      assert.ok(seen, message);
    },
  };
}
