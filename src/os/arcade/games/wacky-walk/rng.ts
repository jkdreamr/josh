export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...numbers: number[]): number {
  let value = 0x811c9dc5;
  for (const number of numbers) {
    const bits = Number.isFinite(number) ? Math.trunc(number * 1_000_003) >>> 0 : 0;
    value ^= bits;
    value = Math.imul(value, 0x01000193) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value ^= value >>> 15;
  }
  return value >>> 0;
}
