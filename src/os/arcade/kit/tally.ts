export type TallyOptions = { names?: readonly string[]; lead?: number; to?: string };

/** Score line for a banner or Game Over card. Two sides: "3 to 1", `lead` first (default: the higher score, ties keep seat order). Three or more: "Red 1 · Green 0 · Blue 0" in seat order. */
export function formatTally(scores: readonly number[], opts: TallyOptions = {}): string {
  if (scores.length === 0) return '';
  if (scores.length === 1) return String(scores[0]);
  if (scores.length === 2) {
    const lead = opts.lead === 0 || opts.lead === 1 ? opts.lead : scores[1] > scores[0] ? 1 : 0;
    return `${scores[lead]} ${opts.to ?? 'to'} ${scores[1 - lead]}`;
  }
  return scores.map((score, i) => `${opts.names?.[i] ?? `P${i + 1}`} ${score}`).join(' · ');
}
