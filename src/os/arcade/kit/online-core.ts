export function advanceOnlineRound(round: number) {
  return round + 1;
}

/** The round a start message begins: the server's shared number when it sends one, else the next local one. */
export function nextOnlineRound(round: number, server: number | null) {
  return server ?? advanceOnlineRound(round);
}
