// One player's run through a scheduled game: the command flash, then each micro-game part on its slot of the clock,
// judged locally so lag never decides anything. Pure logic, the canvas drawing lives in index.tsx and draw.ts.
import { microById } from './micro/index.ts';
import type { Held, Key, MicroGame, MicroInstance, Outcome } from './micro/types.ts';
import { bossPart, commandTime, planGame, type Plan } from './plan.ts';
import { mix } from './rng.ts';
import type { Curse } from './rules.ts';

export type Part = { game: MicroGame; inst: MicroInstance | null; from: number; to: number };
export type Local = {
  n: number;
  plan: Plan;
  start: number;
  /** When the command flash ends and play starts, relative to start. */
  cmd: number;
  end: number;
  parts: Part[];
  outcome: Outcome;
  decidedAt: number;
  playing: boolean;
  curse: Curse | null;
  cursedMe: boolean;
  /** A decoy shows this command first, to everyone (only the cursed get fooled by it). */
  decoy: string | null;
};

const DECOYS = ['dance!', 'study!', 'nap!', 'cry!', 'panic!', 'email!', 'recycle!'];

/** `playing` is false for ghosts, spectators and late joiners: they watch the clock but play nothing. */
export function startLocal(seed: number, n: number, start: number, curse: Curse | null, cursedMe: boolean, playing: boolean): Local {
  const plan = planGame(seed, n);
  const cmd = commandTime(plan.tier, curse === 'decoy');
  let t = cmd;
  const parts: Part[] = plan.ids.map((id, i) => {
    const game = microById.get(id)!;
    const d = plan.boss ? bossPart(game.duration(plan.tier)) : game.duration(plan.tier);
    const part: Part = { game, inst: null, from: t, to: t + d };
    t += d;
    void i;
    return part;
  });
  const decoy = curse === 'decoy' ? DECOYS[mix(seed, n, 5) % DECOYS.length] : null;
  return { n, plan, start, cmd, end: t, parts, outcome: playing ? 'pending' : 'fail', decidedAt: -1, playing, curse, cursedMe, decoy };
}

export const elapsed = (L: Local, now: number) => now - L.start;

export function partAt(L: Local, now: number): { part: Part; index: number } | null {
  const e = elapsed(L, now);
  if (e < L.cmd) return null;
  for (let i = 0; i < L.parts.length; i++) if (e < L.parts[i].to) return { part: L.parts[i], index: i };
  return { part: L.parts[L.parts.length - 1], index: L.parts.length - 1 };
}

function ensure(L: Local, index: number) {
  const p = L.parts[index];
  if (!p.inst) p.inst = p.game.create(mix(L.plan.seed, L.n, index, 3), L.plan.difficulty);
  return p.inst;
}

/** Advance the local game. Returns the outcome the moment it's decided (once), otherwise null. */
export function stepLocal(L: Local, now: number, dt: number, held: Held): Outcome | null {
  if (!L.playing || L.outcome !== 'pending') return null;
  const at = partAt(L, now);
  if (!at) return null;
  // close out earlier parts we skipped past (a hitch longer than a part)
  for (let i = 0; i < at.index; i++) {
    const inst = ensure(L, i);
    if (inst.outcome === 'pending') inst.outcome = inst.timeUp();
    if (inst.outcome === 'fail') return decide(L, 'fail', now);
  }
  const inst = ensure(L, at.index);
  const e = elapsed(L, now);
  const local = e - at.part.from;
  if (inst.outcome === 'pending') inst.update(dt, local, held);
  if (inst.outcome === 'pending' && e >= at.part.to) inst.outcome = inst.timeUp();
  if (inst.outcome === 'fail') return decide(L, 'fail', now);
  const last = at.index === L.parts.length - 1;
  if (inst.outcome === 'pass' && last) return decide(L, 'pass', now);
  return null;
}

function decide(L: Local, o: 'pass' | 'fail', now: number) {
  L.outcome = o;
  L.decidedAt = now;
  return o;
}

/** The live instance taking input right now, if any. */
export function active(L: Local, now: number): MicroInstance | null {
  if (!L.playing || L.outcome !== 'pending') return null;
  const at = partAt(L, now);
  if (!at || elapsed(L, now) >= at.part.to) return null;
  return ensure(L, at.index);
}

/** The micro-game whose arena should be drawn now (the next one during the command flash). */
export function shown(L: Local, now: number): { part: Part; index: number; t: number } {
  const at = partAt(L, now) ?? { part: L.parts[0], index: 0 };
  return { ...at, t: Math.max(0, elapsed(L, now) - at.part.from) };
}

export const mirrorKey = (k: Key, flip: boolean): Key => (!flip ? k : k === 'left' ? 'right' : k === 'right' ? 'left' : k);
export function mirrorHeld(h: Held, flip: boolean): Held {
  return flip ? { ...h, left: h.right, right: h.left } : h;
}
