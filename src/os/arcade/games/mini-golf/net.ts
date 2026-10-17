// Online packets. The host simulates every putt and owns the scorecard; guests send aims and draw results.
export const GAME = 'mini-golf';
export type Sync = {
  game: typeof GAME;
  k: 'sync';
  round: number;
  hole: number;
  phase: 'play' | 'card' | 'over';
  t: number;
  seats: number[];
  golfers: { name: string; color: string; kind: 'human' | 'bot'; left: boolean }[];
  lies: { x: number; z: number; strokes: number; done: boolean }[];
  card: number[][];
  order: number[];
};
export type Shot = { game: typeof GAME; k: 'shot'; round: number; hole: number; n: number; a: number; p: number; t: number; x: number; z: number };
export type Result = { game: typeof GAME; k: 'res'; round: number; hole: number; g: number; a: number; p: number; t: number; fx: number; fz: number; ex: number; ez: number; st: 'holed' | 'water' | 'rest'; strokes: number; done: boolean };
export type Hello = { game: typeof GAME; k: 'hello'; round: number };
export type Packet = Sync | Shot | Result | Hello;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parse(d: unknown): Packet | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.game !== GAME || !num(o.round)) return null;
  if (o.k === 'hello') return o as Hello;
  if (o.k === 'shot') return num(o.hole) && num(o.n) && num(o.a) && num(o.p) && num(o.t) && num(o.x) && num(o.z) && o.p >= 0 && o.p <= 1 ? (o as Shot) : null;
  if (o.k === 'res') return num(o.g) && num(o.ex) && num(o.ez) && num(o.fx) && num(o.fz) && num(o.strokes) && (o.st === 'holed' || o.st === 'water' || o.st === 'rest') ? (o as Result) : null;
  if (o.k === 'sync') return num(o.hole) && num(o.t) && Array.isArray(o.seats) && Array.isArray(o.golfers) && Array.isArray(o.lies) && Array.isArray(o.card) && Array.isArray(o.order) ? (o as Sync) : null;
  return null;
}
