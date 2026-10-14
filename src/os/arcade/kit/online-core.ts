export function advanceOnlineRound(round: number) {
  return round + 1;
}

/** Bots in seat order, named from the game's list or Bot 1, Bot 2 and so on, so every player sees the same names. */
export function botPlayers(seats: readonly number[], names: readonly string[] = []): { seat: number; name: string }[] {
  return seats.map((seat, i) => ({ seat, name: names[i] ?? `Bot ${i + 1}` }));
}

/** The round a start message begins: the server's shared number when it sends one, else the next local one. */
export function nextOnlineRound(round: number, server: number | null) {
  return server ?? advanceOnlineRound(round);
}

/** Final scores of a score race by seat. null means the player finished without a score. */
export type RaceScores = Record<number, number | null>;
export type RaceStanding = { seat: number; score: number | null; place: number | null };

/**
 * Standings of a score race among the seats still in the room. The best score places first;
 * players without a score place last. `done` once every seat has finished, and `winner` is the
 * single best seat (null for a tie or when nobody scored).
 */
export function raceStandings(scores: RaceScores, seats: number[], lowerIsBetter = false): { done: boolean; winner: number | null; standings: RaceStanding[] } {
  const finished = seats.filter((seat) => Object.hasOwn(scores, seat));
  const better = (a: number, b: number) => (lowerIsBetter ? a - b : b - a);
  const ranked = finished
    .map((seat) => ({ seat, score: scores[seat] }))
    .sort((a, b) => (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) || (a.score !== null && b.score !== null ? better(a.score, b.score) : 0) || a.seat - b.seat);
  const standings: RaceStanding[] = ranked.map(({ seat, score }) => ({
    seat,
    score,
    place: score === null ? null : 1 + ranked.filter((other) => other.score !== null && better(other.score, score) < 0).length,
  }));
  for (const seat of seats) if (!Object.hasOwn(scores, seat)) standings.push({ seat, score: null, place: null });
  const done = seats.length >= 2 && finished.length === seats.length;
  const leaders = standings.filter((entry) => entry.place === 1);
  return { done, winner: done && leaders.length === 1 ? leaders[0].seat : null, standings };
}

/** Parses a race packet from the room. Guests send their own score; the host sends everyone's. */
export function parseRacePacket(value: unknown): { t: 'race'; round: number; score: number | null } | { t: 'race-all'; round: number; scores: RaceScores } | null {
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (!Number.isSafeInteger(packet.round)) return null;
  const round = packet.round as number;
  const validScore = (score: unknown): score is number | null => score === null || (typeof score === 'number' && Number.isFinite(score));
  if (packet.t === 'race') return validScore(packet.score) ? { t: 'race', round, score: packet.score } : null;
  if (packet.t !== 'race-all' || !packet.scores || typeof packet.scores !== 'object') return null;
  const scores: RaceScores = {};
  for (const [key, score] of Object.entries(packet.scores as Record<string, unknown>)) {
    const seat = Number(key);
    if (Number.isInteger(seat) && seat >= 0 && seat < 16 && validScore(score)) scores[seat] = score;
  }
  return { t: 'race-all', round, scores };
}
