import { COURSE_NAMES, LIMITS } from './courses.ts';
import { hash } from './rng.ts';
import type { CourseId, Entrant, Phase, RaceId } from './types.ts';

export const INTRO = 4;
export const COUNT = 3;
export const OUTRO = 5;

export type Show = {
  seed: number;
  race: RaceId;
  entrants: Entrant[];
  round: number;
  phase: Phase;
  phaseT: number;
  /** Course clock, including the intro and countdown for this round. */
  clock: number;
  inRound: number[];
  out: number[];
  finished: number[];
  fallen: number[];
  qualified: number[];
  quota: number;
  winner: number | null;
};

export function quotas(n: number): [number, number] {
  const count = Math.max(0, Math.floor(n));
  const first = count >= 4 ? Math.max(3, Math.min(count - 1, Math.round(count * 0.6))) : count;
  const second = first <= 2 ? first : survivalQuota(first);
  return [first, second];
}

function survivalQuota(n: number): number {
  return Math.max(2, Math.min(Math.round(n * 0.5), n - 1));
}

export function pickRace(seed: number, choice: RaceId | 'random'): RaceId {
  if (choice !== 'random') return choice;
  const races: RaceId[] = ['oval', 'fountain', 'palm'];
  return races[hash(seed) % races.length];
}

export function courseOf(show: Show, round = show.round): CourseId {
  return round === 0 ? show.race : round === 1 ? 'tiles' : 'hoover';
}

export function createShow(entrants: Entrant[], seed: number, race: RaceId): Show {
  const roster = entrants.slice(0, 20);
  const [quota] = quotas(roster.length);
  return {
    seed: seed >>> 0, race, entrants: roster, round: 0, phase: 'intro', phaseT: 0, clock: 0,
    inRound: roster.map((entrant) => entrant.id), out: [], finished: [], fallen: [], qualified: [],
    quota, winner: null,
  };
}

export function playTime(show: Show): number {
  return Math.max(0, show.clock - INTRO - COUNT);
}

export function stillRunning(show: Show): number[] {
  return show.inRound.filter((id) => !show.finished.includes(id) && !show.fallen.includes(id));
}

export function markFinish(show: Show, id: number): boolean {
  if (show.phase !== 'play' || show.round === 1 || !show.inRound.includes(id) || show.finished.includes(id) || show.fallen.includes(id)) return false;
  show.finished.push(id);
  return true;
}

export function markFall(show: Show, id: number): boolean {
  if (show.phase !== 'play' || show.round !== 1 || !show.inRound.includes(id) || show.finished.includes(id) || show.fallen.includes(id)) return false;
  show.fallen.push(id);
  return true;
}

export function statusOf(show: Show, id: number): 'running' | 'qualified' | 'eliminated' | 'winner' | 'done' {
  if (show.winner === id) return 'winner';
  if (show.out.includes(id)) return 'eliminated';
  if (show.qualified.includes(id) || (show.round !== 1 && show.finished.includes(id))) return 'qualified';
  if (show.phase === 'done') return 'done';
  return show.inRound.includes(id) ? 'running' : 'done';
}

export function placeOf(show: Show, id: number): number | null {
  if (show.phase !== 'done' && show.winner === null) return null;
  if (show.winner === id) return 1;
  const eliminated = show.out.indexOf(id);
  return eliminated < 0 ? null : show.entrants.length - eliminated;
}

function topByProgress(ids: number[], progress: (id: number) => number): number[] {
  return [...ids].sort((a, b) => progress(b) - progress(a));
}

function concludePlay(show: Show, progress: (id: number) => number, timedOut: boolean): void {
  const active = stillRunning(show);
  const kind = show.round === 1 ? 'survival' : show.round === 2 ? 'final' : 'race';
  let qualified: number[] = [];
  if (kind === 'race') {
    qualified = show.finished.slice(0, show.quota);
    const minimum = Math.min(timedOut ? 4 : 2, show.inRound.length);
    if (qualified.length < minimum) {
      const candidates = topByProgress(active.filter((id) => !qualified.includes(id)), progress);
      qualified.push(...candidates.slice(0, minimum - qualified.length));
    }
  } else if (kind === 'survival') {
    qualified = active;
    const minimum = Math.min(2, show.inRound.length);
    if (qualified.length < minimum) {
      const fallers = show.fallen.slice().reverse();
      qualified.push(...fallers.filter((id) => !qualified.includes(id)).slice(0, minimum - qualified.length));
    }
    qualified = qualified.slice(0, show.quota);
  } else {
    const winner = show.finished[0] ?? topByProgress(show.inRound, progress)[0] ?? null;
    show.winner = winner;
    qualified = winner === null ? [] : [winner];
  }
  show.qualified = qualified;
  for (const id of show.inRound) if (!qualified.includes(id) && !show.out.includes(id)) show.out.push(id);
  show.phase = 'outro';
  show.phaseT = 0;
}

function completeRound(show: Show): void {
  if (show.round >= 2 || show.qualified.length <= 1) {
    if (show.winner === null) show.winner = show.qualified[0] ?? null;
    show.phase = 'done';
    show.phaseT = 0;
    return;
  }
  show.round = show.round === 0 && show.qualified.length <= 2 ? 2 : show.round + 1;
  show.inRound = [...show.qualified];
  show.finished = [];
  show.fallen = [];
  show.qualified = [];
  show.quota = show.round === 1 ? survivalQuota(show.inRound.length) : 1;
  show.clock = 0;
  show.phaseT = 0;
  show.phase = 'intro';
}

export function stepShow(show: Show, dt: number, progress: (id: number) => number): boolean {
  if (show.phase === 'done') return false;
  const beforeRound = show.round, beforePhase = show.phase;
  dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  show.clock += dt;
  show.phaseT += dt;
  if (show.phase === 'intro' && show.phaseT >= INTRO) {
    show.phaseT -= INTRO;
    show.phase = 'count';
  }
  if (show.phase === 'count' && show.phaseT >= COUNT) {
    show.phaseT -= COUNT;
    show.phase = 'play';
  }
  if (show.phase === 'play') {
    const timeLimit = LIMITS[courseOf(show)];
    const timedOut = playTime(show) >= timeLimit;
    const ending = show.round === 1
      ? stillRunning(show).length <= show.quota || timedOut
      : show.round === 2
        ? show.finished.length > 0 || timedOut
        : show.finished.length >= show.quota || stillRunning(show).length === 0 || timedOut;
    if (ending) concludePlay(show, progress, timedOut);
  }
  if (show.phase === 'outro' && show.phaseT >= OUTRO) completeRound(show);
  return beforeRound !== show.round || beforePhase !== show.phase;
}

export const courseNameOf = (show: Show) => COURSE_NAMES[courseOf(show)];
