// A round of Paper.io: who plays, bots thinking, respawns and the clock. Pure, so modes can be tested under node.
//
// Solo is classic Paper.io: one life against the bots (who come back after they crash, the way new players keep
// joining). Two players on one laptop and online rooms are timed matches: you respawn a few seconds after you crash
// and whoever holds the most land at the buzzer wins.
import { botNames, botTick, makeMind, personas, type Level } from './bots.ts';
import { PALETTE, SKINS, skinOf } from './skins.ts';
import { MAX_PLAYERS, addPlayer, createWorld, findSpawn, mulberry32, percent, ranking, spawnAt, step, type Kind, type Player, type World } from './world.ts';

export type Seat = { name: string; skin: number; kind: Extract<Kind, 'local' | 'remote'>; seat: number };

export type MatchOpts = {
  seed: number;
  humans: Seat[];
  bots: number;
  level: Level;
  /** Humans come back after crashing (timed matches); bots always do. */
  respawn: boolean;
  /** Round length in seconds; Infinity for a classic life. */
  duration: number;
  radius?: number;
};

export type Match = {
  w: World;
  opts: MatchOpts;
  humans: number[];
  bots: number[];
  rng: () => number;
  elapsed: number;
  over: boolean;
  /** Player id of the biggest human at the end, or null. */
  winner: number | null;
  order: number[];
};

export const HUMAN_RESPAWN = 3;
export const BOT_RESPAWN = [2.5, 5] as const;

/** Palette colors for a field: humans keep their skin's color unless someone took it first; bots get the rest. */
export function assignColors(humanSkins: number[], bots: number, rng: () => number): { humans: number[]; bots: number[] } {
  const used = new Set<number>();
  const humans = humanSkins.map((skin) => {
    let c = skinOf(skin).color;
    if (used.has(c)) c = [...PALETTE.keys()].find((i) => !used.has(i)) ?? c;
    used.add(c);
    return c;
  });
  const free = [...PALETTE.keys()].filter((i) => !used.has(i));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const out: number[] = [];
  for (let i = 0; i < bots; i++) out.push(free.length ? free[i % free.length] : i % PALETTE.length);
  return { humans, bots: out };
}

/** Bots wear a skin in their color when there is one (so players see what they could unlock), else a plain face. */
function botSkin(color: number, rng: () => number) {
  const fits = SKINS.filter((s) => s.color === color);
  return fits.length ? fits[Math.floor(rng() * fits.length)].id : rng() < 0.5 ? 0 : SKINS[Math.floor(rng() * SKINS.length)].id;
}

export function createMatch(opts: MatchOpts): Match {
  const rng = mulberry32(opts.seed ^ 0x9e3779b9);
  const w = createWorld({ radius: opts.radius, seed: opts.seed, authority: true });
  const botCount = Math.max(0, Math.min(MAX_PLAYERS - opts.humans.length, opts.bots));
  const colors = assignColors(
    opts.humans.map((h) => h.skin),
    botCount,
    rng,
  );
  const humans: number[] = [];
  opts.humans.forEach((h, i) => {
    const p = addPlayer(w, { name: h.name, color: colors.humans[i], skin: h.skin, kind: h.kind, seat: h.seat });
    humans.push(p.id);
  });
  const names = botNames(botCount, rng, opts.humans.map((h) => h.name.toLowerCase()));
  const kinds = personas(botCount, rng);
  const bots: number[] = [];
  for (let i = 0; i < botCount; i++) {
    const p = addPlayer(w, { name: names[i], color: colors.bots[i], skin: botSkin(colors.bots[i], rng), kind: 'bot' });
    p.mind = makeMind(kinds[i], opts.level, mulberry32(opts.seed * 31 + i * 977));
    bots.push(p.id);
  }
  const m: Match = { w, opts, humans, bots, rng, elapsed: 0, over: false, winner: null, order: [] };
  // humans first, spread out; bots fill in
  for (const id of humans) placeFresh(m, w.players[id], 0.9);
  for (const id of bots) placeFresh(m, w.players[id], 0.6);
  return m;
}

function placeFresh(m: Match, p: Player, minFree: number) {
  const spot = findSpawn(m.w, m.rng, minFree) ?? findSpawn(m.w, m.rng, 0.3);
  if (!spot) return false;
  spawnAt(m.w, p, spot.cx, spot.cy, spot.h);
  return true;
}

/** One fixed tick: bots decide, everyone moves, the dead come back when it is their time, the clock runs. */
export function matchTick(m: Match, dt = 1 / 60) {
  const { w } = m;
  for (const id of m.bots) {
    const p = w.players[id];
    if (p.alive) botTick(w, p, dt);
  }
  step(w);
  m.elapsed += dt;
  for (const p of w.players) {
    if (!p || p.alive || !p.joined) continue;
    if (p.respawnAt === Infinity) {
      if (p.kind === 'bot') p.respawnAt = w.time + BOT_RESPAWN[0] + m.rng() * (BOT_RESPAWN[1] - BOT_RESPAWN[0]);
      else if (m.opts.respawn && !m.over) p.respawnAt = w.time + HUMAN_RESPAWN;
      else p.respawnAt = -1;
    }
    if (p.respawnAt > 0 && w.time >= p.respawnAt && !m.over) {
      // bots only come back when there is room; humans always do
      if (!placeFresh(m, p, p.kind === 'bot' ? 0.85 : 0.5)) p.respawnAt = w.time + 1;
    }
  }
  if (!m.over && m.elapsed >= m.opts.duration) finish(m);
  if (!m.over) {
    for (const id of m.humans) {
      if (w.counts[id + 1] >= w.arenaCells) finish(m);
    }
  }
}

/** Ends a timed round: the biggest human wins. */
export function finish(m: Match) {
  if (m.over) return;
  m.over = true;
  m.order = standings(m);
  const best = m.order.find((id) => m.humans.includes(id));
  m.winner = best === undefined || m.w.counts[best + 1] <= 0 ? null : best;
}

/** Everyone by land now, biggest first; the dead (no land) last by id. */
export function standings(m: Match): number[] {
  const ids = m.w.players.filter(Boolean).map((p) => p.id);
  return ids.sort((a, b) => m.w.counts[b + 1] - m.w.counts[a + 1] || a - b);
}

/** Leaderboard place of a living player (1 is first), or 0 when dead. */
export function placeOf(w: World, id: number, buf: number[] = []): number {
  const order = ranking(w, buf);
  return order.indexOf(id) + 1;
}

export const pctOf = percent;
