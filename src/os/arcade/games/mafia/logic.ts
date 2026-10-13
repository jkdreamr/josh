// Pure rules for Mafia: dealing roles, who can be picked at night, resolving the night and checking for a winner.
// No React or DOM, so the tests run it under plain node.
import { listNames, shuffle, type Rng } from '../../kit/party-core.ts';

export type Role = 'mafia' | 'doctor' | 'detective' | 'villager';
export type Side = 'town' | 'mafia';
export type MafiaWant = 'auto' | '1' | '2' | '3';
export type Cast = { mafia: number; doctor: boolean; detective: boolean };

export const MIN_PLAYERS = 5;

export const ROLE_LABEL: Record<Role, string> = { mafia: 'Mafia', doctor: 'Doctor', detective: 'Detective', villager: 'Villager' };

/**
 * Auto: 5 or 6 players get one mafia, 7 to 9 get two, 10 to 15 get three, 16 and up get four. (Four at 14 or 15
 * left a town with no special roles winning about 1 game in 20 when it voted blind; three keeps it near 1 in 6.)
 */
export function autoMafia(players: number): number {
  if (players >= 16) return 4;
  if (players >= 10) return 3;
  if (players >= 7) return 2;
  return 1;
}

/**
 * The most mafia a table can have: the town always starts with more than twice as many players. That keeps every deal
 * open: the first night's kill can't decide it, and a wrong vote on day 1 can't end it on the spot.
 * 5 and 6 players get 1, 7 to 9 up to 2, 10 to 12 up to 3.
 */
export const maxMafia = (players: number) => Math.max(1, Math.floor((players - 1) / 3));

/** The smallest table that can take `mafia` mafia. */
export const minPlayersFor = (mafia: number) => Math.max(1, Math.floor(mafia)) * 3 + 1;

/** How many mafia a table of `players` gets for a setting, clamped to maxMafia. */
export function mafiaCount(want: MafiaWant, players: number): number {
  const asked = want === 'auto' ? autoMafia(players) : Math.max(1, Math.floor(Number(want)) || 1);
  return Math.min(asked, maxMafia(players));
}

/** One role per seat. Mafia first, then the doctor and detective if there is room, everyone else a villager. */
export function assignRoles(players: number, cast: Cast, rng: Rng = Math.random): Role[] {
  const seats = shuffle(
    Array.from({ length: players }, (_, i) => i),
    rng,
  );
  const roles: Role[] = Array.from({ length: players }, () => 'villager');
  const mafia = Math.min(Math.max(1, Math.floor(cast.mafia)), maxMafia(players), players);
  let k = 0;
  for (; k < mafia; k++) roles[seats[k]] = 'mafia';
  if (cast.doctor && k < players) roles[seats[k++]] = 'doctor';
  if (cast.detective && k < players) roles[seats[k++]] = 'detective';
  return roles;
}

/** '2 mafia, a doctor, a detective and 3 villagers.' for the setup step. */
export function describeCast(players: number, cast: Cast): string {
  const mafia = Math.min(Math.max(1, cast.mafia), maxMafia(players));
  const doctor = cast.doctor && players > mafia;
  const detective = cast.detective && players > mafia + (doctor ? 1 : 0);
  const villagers = players - mafia - (doctor ? 1 : 0) - (detective ? 1 : 0);
  const parts = [`${mafia} mafia`];
  if (doctor) parts.push('a doctor');
  if (detective) parts.push('a detective');
  if (villagers > 0) parts.push(`${villagers} ${villagers === 1 ? 'villager' : 'villagers'}`);
  return `${listNames(parts)}.`;
}

export const seatsOf = (roles: readonly Role[], role: Role) => roles.flatMap((r, i) => (r === role ? [i] : []));

/** Living seats in seating order: the order the phone goes around at night. */
export const nightOrder = (alive: readonly boolean[]) => alive.flatMap((a, i) => (a ? [i] : []));

/** Why a night pick is refused: it's you, it's your crew, or the doctor's pick from last night. */
export type Refusal = 'self' | 'crew' | 'twice';
export type Choice = { seat: number; ok: boolean; why: Refusal | null };

/** Why `seat` can't pick `target` tonight, or null when they can. Players who are out aren't offered at all. */
export function refusal(roles: readonly Role[], seat: number, target: number, lastSaved: number | null = null): Refusal | null {
  const role = roles[seat];
  if (role === 'doctor') return target === lastSaved ? 'twice' : null;
  if (target === seat) return 'self';
  if (role === 'mafia' && roles[target] === 'mafia') return 'crew';
  return null;
}

/**
 * The players a seat sees on its night turn: every living player, drawn the same way for every role so a glance can't
 * tell them apart. Taps on a refused seat get a short note instead. Mafia can pick living non-mafia, the doctor anyone
 * but last night's pick (themself too), detectives and villagers anyone but themself.
 */
export function nightChoices(roles: readonly Role[], alive: readonly boolean[], seat: number, lastSaved: number | null = null): Choice[] {
  if (!alive[seat]) return [];
  return nightOrder(alive).map((i) => {
    const why = refusal(roles, seat, i, lastSaved);
    return { seat: i, ok: why === null, why };
  });
}

/** Just the seats a player may actually pick tonight. */
export const validTargets = (roles: readonly Role[], alive: readonly boolean[], seat: number, lastSaved: number | null = null) =>
  nightChoices(roles, alive, seat, lastSaved).flatMap((c) => (c.ok ? [c.seat] : []));

/** The mafia's target: the most picked living non-mafia, a random one among ties, or null with no picks. */
export function mafiaTarget(roles: readonly Role[], alive: readonly boolean[], picks: readonly (number | null)[], rng: Rng = Math.random): number | null {
  const counts = new Map<number, number>();
  for (const seat of seatsOf(roles, 'mafia')) {
    const t = picks[seat];
    if (!alive[seat] || t === null || t === undefined || !alive[t] || roles[t] === 'mafia') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  const tied = [...counts.keys()].filter((t) => counts.get(t) === top).sort((a, b) => a - b);
  return tied.length === 1 ? tied[0] : tied[Math.floor(rng() * tied.length)];
}

export type NightResult = {
  /** Who the mafia went for, or null when they picked nobody. */
  target: number | null;
  /** Who the doctor protected, or null. */
  saved: number | null;
  /** Who was taken: the target unless the doctor protected them. */
  killed: number | null;
};

export function resolveNight(roles: readonly Role[], alive: readonly boolean[], picks: readonly (number | null)[], rng: Rng = Math.random): NightResult {
  const target = mafiaTarget(roles, alive, picks, rng);
  const doctor = seatsOf(roles, 'doctor').find((s) => alive[s]);
  const pickOf = doctor === undefined ? null : picks[doctor];
  const saved = pickOf !== null && pickOf !== undefined && alive[pickOf] ? pickOf : null;
  return { target, saved, killed: target !== null && target !== saved ? target : null };
}

/** The town wins once no mafia are left; the mafia win once they are at least as many as everyone else. */
export function winner(roles: readonly Role[], alive: readonly boolean[]): Side | null {
  let mafia = 0;
  let others = 0;
  roles.forEach((r, i) => {
    if (!alive[i]) return;
    if (r === 'mafia') mafia++;
    else others++;
  });
  if (mafia === 0) return 'town';
  if (mafia >= others) return 'mafia';
  return null;
}

export type Finding = { night: number; seat: number; mafia: boolean };
export type LogEntry = { phase: 'night' | 'day'; n: number; seat: number | null };

export type Game = {
  roles: Role[];
  alive: boolean[];
  /** The current night, and the day that follows it. Starts at 1. */
  night: number;
  /** Tonight's pick per seat. */
  picks: (number | null)[];
  /** Who the doctor protected last night (they can't pick them again tonight). */
  lastSaved: number | null;
  /** What the detective learned, night by night. */
  findings: Finding[];
  log: LogEntry[];
};

export function newGame(players: number, cast: Cast, rng: Rng = Math.random): Game {
  const roles = assignRoles(players, cast, rng);
  return { roles, alive: roles.map(() => true), night: 1, picks: roles.map(() => null), lastSaved: null, findings: [], log: [] };
}

/** Records one night pick. Invalid picks are ignored. A detective's pick also records what they learned. */
export function pickAt(game: Game, seat: number, target: number): Game {
  if (!validTargets(game.roles, game.alive, seat, game.lastSaved).includes(target)) return game;
  const picks = game.picks.slice();
  picks[seat] = target;
  const findings =
    game.roles[seat] === 'detective'
      ? [...game.findings.filter((f) => f.night !== game.night), { night: game.night, seat: target, mafia: game.roles[target] === 'mafia' }]
      : game.findings;
  return { ...game, picks, findings };
}

/** Morning: resolve tonight's picks, take the victim out, log it and clear the picks for the next night. */
export function endNight(game: Game, rng: Rng = Math.random): { game: Game; result: NightResult } {
  const result = resolveNight(game.roles, game.alive, game.picks, rng);
  const alive = game.alive.slice();
  if (result.killed !== null) alive[result.killed] = false;
  const doctor = seatsOf(game.roles, 'doctor').find((s) => game.alive[s]);
  const lastSaved = doctor === undefined ? null : (game.picks[doctor] ?? null);
  return {
    result,
    game: { ...game, alive, lastSaved, picks: game.roles.map(() => null), log: [...game.log, { phase: 'night', n: game.night, seat: result.killed }] },
  };
}

/** The day's vote: take the chosen living player out (or nobody), log it and move on to the next night. */
export function voteOut(game: Game, seat: number | null): Game {
  const out = seat !== null && game.alive[seat] === true ? seat : null;
  const alive = game.alive.slice();
  if (out !== null) alive[out] = false;
  return { ...game, alive, night: game.night + 1, log: [...game.log, { phase: 'day', n: game.night, seat: out }] };
}

/** How each seat left the game (the night they were taken or the day they were voted out), or null for survivors. */
export function fates(game: Pick<Game, 'roles' | 'log'>): (LogEntry | null)[] {
  const out: (LogEntry | null)[] = game.roles.map(() => null);
  for (const e of game.log) if (e.seat !== null && out[e.seat] === null) out[e.seat] = e;
  return out;
}

/** 'Taken on night 2', 'Voted out on day 1', 'Survived'. */
export const fateLine = (fate: LogEntry | null) => (!fate ? 'Survived' : fate.phase === 'night' ? `Taken on night ${fate.n}` : `Voted out on day ${fate.n}`);

/** 'Night 1: Jo was taken.', 'Day 2: Sam (Mafia) voted out.' */
export function logLine(entry: LogEntry, names: readonly string[], roles: readonly Role[], showRole: boolean): string {
  const when = `${entry.phase === 'night' ? 'Night' : 'Day'} ${entry.n}`;
  const what = entry.phase === 'night' ? 'was taken' : 'voted out';
  if (entry.seat === null) return `${when}: Nobody ${what}.`;
  const who = names[entry.seat] ?? `Player ${entry.seat + 1}`;
  return `${when}: ${who}${showRole ? ` (${ROLE_LABEL[roles[entry.seat]]})` : ''} ${what}.`;
}
