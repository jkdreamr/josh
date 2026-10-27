export type ClockSample = { rtt: number; off: number };

export function addSample(samples: readonly ClockSample[], c: number, h: number, now: number): ClockSample[] {
  const rtt = now - c;
  return [...samples, { rtt, off: h + rtt / 2 - now }].slice(-8);
}

export function offsetOf(samples: readonly ClockSample[]): number | null {
  if (!samples.length) return null;
  return samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).off;
}
