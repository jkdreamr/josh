import assert from 'node:assert/strict';
import { createMatchStatsObserver, simulateCpuMatch, type Level } from '../../src/os/arcade/games/soccer/ai.ts';
import { globalInvariants } from './invariants.ts';
import { BALANCE } from './bands.ts';

export const PAIRS: readonly (readonly [Level, Level])[] = [
  ['easy', 'easy'],
  ['normal', 'normal'],
  ['hard', 'hard'],
  ['normal', 'easy'],
  ['hard', 'normal'],
  ['hard', 'easy'],
];
export type Row = {
  home: Level;
  away: Level;
  matches: number;
  goals: number;
  maxGoals: number;
  shots: number;
  onTarget: number;
  passes: number[];
  completed: number[];
  possession: number[];
  fouls: number;
  offsides: number;
  reds: number;
  wins: number;
  losses: number;
  stuck: number;
  invariantErrors: number;
  unfinished: number;
  examples: string[];
};
export function emptyRow(home: Level, away: Level): Row {
  return {
    home,
    away,
    matches: 0,
    goals: 0,
    maxGoals: 0,
    shots: 0,
    onTarget: 0,
    passes: [0, 0],
    completed: [0, 0],
    possession: [0, 0],
    fouls: 0,
    offsides: 0,
    reds: 0,
    wins: 0,
    losses: 0,
    stuck: 0,
    invariantErrors: 0,
    unfinished: 0,
    examples: [],
  };
}
export function runRow(home: Level, away: Level, seeds: readonly number[], seconds = 480): Row {
  assert.ok(seeds.length > 0 && seeds.every(Number.isSafeInteger), 'nonempty integer seeds required');
  assert.ok(seconds > 0 && Number.isFinite(seconds));
  const row = emptyRow(home, away);
  for (const seed of seeds) {
    const observer = createMatchStatsObserver();
    const invariant = globalInvariants();
    let frame = 0;
    let previousError = '';
    const world = simulateCpuMatch(seed, home, away, seconds, (world) => {
      observer.observe(world);
      let currentError = '';
      try {
        invariant(world, frame);
      } catch (error) {
        const message = (error as Error).message;
        currentError = message.replace(/frame \d+ /, '');
        if (currentError !== previousError) {
          row.invariantErrors++;
          if (message.includes('stuck')) row.stuck++;
          if (row.examples.length < 5) row.examples.push('seed ' + seed + ' ' + message);
        }
      }
      previousError = currentError;
      frame++;
    });
    row.matches++;
    if (world.phase !== 'full-time') row.unfinished++;
    const goals = world.score[0] + world.score[1];
    row.goals += goals;
    row.maxGoals = Math.max(row.maxGoals, goals);
    row.wins += Number(world.score[0] > world.score[1]);
    row.losses += Number(world.score[0] < world.score[1]);
    for (const team of [0, 1]) {
      const stats = observer.stats.teams[team]!;
      row.shots += stats.shots;
      row.onTarget += stats.shotsOnTarget;
      row.passes[team]! += stats.passesAttempted;
      row.completed[team]! += stats.passesCompleted;
      row.possession[team]! += stats.possessionTicks;
      row.fouls += world.rules!.stats.fouls[team]!;
      row.offsides += world.rules!.stats.offsides[team]!;
      row.reds += world.rules!.stats.reds[team]!;
    }
  }
  return row;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const ratio = (numerator: number, denominator: number) => (denominator ? numerator / denominator : NaN);
export function metrics(row: Row) {
  return {
    goals: ratio(row.goals, row.matches),
    shotsPerGoal: ratio(row.shots, row.goals),
    save: ratio(row.onTarget - row.goals, row.onTarget),
    completion: ratio(sum(row.completed), sum(row.passes)),
    homeCompletion: ratio(row.completed[0]!, row.passes[0]!),
    awayCompletion: ratio(row.completed[1]!, row.passes[1]!),
    possession: ratio(row.possession[0]!, sum(row.possession)),
    fouls: ratio(row.fouls, 2 * row.matches),
    offsides: ratio(row.offsides, 2 * row.matches),
  };
}
export function failures(row: Row, balance = true): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  check(row.matches > 0, 'no matches');
  check(row.unfinished === 0, 'unfinished matches: ' + row.unfinished);
  check(row.invariantErrors === 0, 'invariant episodes: ' + row.invariantErrors + ' (' + row.examples.join('; ') + ')');
  check(row.stuck === 0, 'stuck-ball episodes: ' + row.stuck);
  const m = metrics(row);
  if (row.home === row.away && balance) {
    const band = (key: keyof typeof m, bounds: readonly [number, number]) =>
      check(
        Number.isFinite(m[key]) && m[key] >= bounds[0] && m[key] <= bounds[1],
        key + ' ' + m[key] + ' outside ' + bounds.join('–'),
      );
    band('goals', BALANCE.goals);
    check(row.maxGoals <= BALANCE.maxGoals, 'max match goals ' + row.maxGoals + ' > ' + BALANCE.maxGoals);
    band('shotsPerGoal', BALANCE.shotsPerGoal);
    band('completion', BALANCE.completion);
    band('homeCompletion', BALANCE.completion);
    band('awayCompletion', BALANCE.completion);
    band('possession', BALANCE.possession);
    check(
      Math.abs(row.wins - row.losses) / row.matches <= BALANCE.homeWinLossGap / BALANCE.homeSampleSize,
      'home W/L bias ' + row.wins + '/' + row.losses,
    );
    check(m.fouls <= BALANCE.fouls, 'fouls/team ' + m.fouls + ' > ' + BALANCE.fouls);
    check(m.offsides <= BALANCE.offsides, 'offsides/team ' + m.offsides + ' > ' + BALANCE.offsides);
    check(row.reds === BALANCE.reds, 'red cards ' + row.reds + ' != ' + BALANCE.reds);
  } else if (row.home !== row.away && balance) {
    check(
      (row.wins - row.losses) / row.matches > BALANCE.ladderGap / BALANCE.ladderSampleSize,
      'ladder W/L ' + row.wins + '/' + row.losses + ' must have >20% win-loss margin',
    );
    if (row.home === 'hard' && row.away === 'easy') {
      check(row.wins / row.matches >= BALANCE.hardEasyWins / BALANCE.ladderSampleSize, 'hard/easy wins <70%');
      check(row.losses / row.matches <= BALANCE.hardEasyLosses / BALANCE.ladderSampleSize, 'hard/easy losses >10%');
    }
  }
  return errors;
}
export function table(rows: Row[]): string {
  const lines = [
    'pair | n | goals [1–5; max 8] | shots/goal [3–10] | save% [no existing band] | pass% [65–90, both sides] | home poss% [35–65] | fouls/team [≤2] | offside/team [≤2.5] | W/D/L | stuck [0] | invariants [0] | result',
  ];
  for (const row of rows) {
    const m = metrics(row);
    const number = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
    lines.push(
      [
        row.home + '/' + row.away,
        row.matches,
        number(m.goals) + '; max ' + row.maxGoals,
        number(m.shotsPerGoal),
        number(m.save * 100),
        number(m.completion * 100) + ' (' + number(m.homeCompletion * 100) + '/' + number(m.awayCompletion * 100) + ')',
        number(m.possession * 100),
        number(m.fouls),
        number(m.offsides),
        row.wins + '/' + (row.matches - row.wins - row.losses) + '/' + row.losses,
        row.stuck,
        row.invariantErrors,
        failures(row).length ? 'FAIL' : 'PASS',
      ].join(' | '),
    );
  }
  lines.push(
    'Same-level bands apply to same-level rows only. Cross-level ladder: (W-L)/n > 2/10; hard/easy W/n ≥ 7/10, L/n ≤ 1/10.',
  );
  lines.push(
    'Same-level home bias: |W-L|/n ≤ 3/8; reds = 0. Save% = (shotsOnTarget-goals)/shotsOnTarget; no empirical band exists.',
  );
  return lines.join('\n');
}
