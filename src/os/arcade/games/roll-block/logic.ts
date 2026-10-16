// Pure rules for Roll Block: a tall block tips across floating tiles and must drop upright into the hole.
// No DOM, no three.js; runs under `node --test` type stripping (no enums, no parameter properties).
// Grid: x grows right, z grows down (toward the camera). Row-major index = z * w + x.

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Orient = 'stand' | 'x' | 'z';
export type Block = { x: number; z: number; o: Orient };
export type SwitchDef = { kind: 'soft' | 'hard'; act: 'toggle' | 'on' | 'off'; bridges: string };
export type LevelDef = { id: string; name: string; par: number; rows: string[]; switches?: Record<string, SwitchDef> };
export type Tile = 'void' | 'floor' | 'goal' | 'fragile' | 'bridge' | 'switch';
export type Level = {
  def: LevelDef;
  w: number;
  h: number;
  tiles: Tile[];
  bridgeAt: (string | null)[];
  switchAt: (SwitchDef | null)[];
  start: Block;
  goal: [number, number];
  groups: string[];
  initialMask: number;
};
export type State = { block: Block; mask: number; moves: number };
export type Outcome = { kind: 'ok' } | { kind: 'fall'; fragile: boolean } | { kind: 'win' };

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

/** Every grid cell a block covers. 'x' spans (x,z),(x+1,z); 'z' spans (x,z),(x,z+1). */
export function cells(b: Block): [number, number][] {
  if (b.o === 'stand') return [[b.x, b.z]];
  if (b.o === 'x') return [[b.x, b.z], [b.x + 1, b.z]];
  return [[b.x, b.z], [b.x, b.z + 1]];
}

/** Tips the block one cell in direction d. up = -z, down = +z, left = -x, right = +x. */
export function roll(b: Block, d: Dir): Block {
  const { x, z, o } = b;
  if (o === 'stand') {
    if (d === 'right') return { x: x + 1, z, o: 'x' };
    if (d === 'left') return { x: x - 2, z, o: 'x' };
    if (d === 'down') return { x, z: z + 1, o: 'z' };
    return { x, z: z - 2, o: 'z' };
  }
  if (o === 'x') {
    if (d === 'right') return { x: x + 2, z, o: 'stand' };
    if (d === 'left') return { x: x - 1, z, o: 'stand' };
    return { x, z: z + (d === 'down' ? 1 : -1), o: 'x' };
  }
  if (d === 'down') return { x, z: z + 2, o: 'stand' };
  if (d === 'up') return { x, z: z - 1, o: 'stand' };
  return { x: x + (d === 'right' ? 1 : -1), z, o: 'z' };
}

const isBridgeChar = (ch: string) => (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
const isSwitchChar = (ch: string) => ch >= '1' && ch <= '9';

/** Parses rows + switch defs into a Level. Throws with a clear message on anything invalid. */
export function parseLevel(def: LevelDef): Level {
  if (!def.rows.length) throw new Error(`level ${def.id}: no rows`);
  const w = def.rows[0].length;
  const h = def.rows.length;
  if (!w) throw new Error(`level ${def.id}: empty row`);
  const tiles: Tile[] = new Array(w * h).fill('void');
  const bridgeAt: (string | null)[] = new Array(w * h).fill(null);
  const switchAt: (SwitchDef | null)[] = new Array(w * h).fill(null);
  let start: Block | null = null;
  let goal: [number, number] | null = null;
  const groupCase = new Map<string, boolean>(); // group letter -> started on (uppercase)

  for (let z = 0; z < h; z++) {
    const row = def.rows[z];
    if (row.length !== w) throw new Error(`level ${def.id}: row ${z} has width ${row.length}, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const i = z * w + x;
      if (ch === '.') continue;
      if (ch === '#') tiles[i] = 'floor';
      else if (ch === 'S') {
        if (start) throw new Error(`level ${def.id}: more than one S`);
        tiles[i] = 'floor';
        start = { x, z, o: 'stand' };
      } else if (ch === 'G') {
        if (goal) throw new Error(`level ${def.id}: more than one G`);
        tiles[i] = 'goal';
        goal = [x, z];
      } else if (ch === 'F') tiles[i] = 'fragile';
      else if (isBridgeChar(ch)) {
        const g = ch.toLowerCase();
        const on = ch === ch.toUpperCase();
        const prev = groupCase.get(g);
        if (prev !== undefined && prev !== on) throw new Error(`level ${def.id}: bridge group '${g}' mixes cases`);
        groupCase.set(g, on);
        tiles[i] = 'bridge';
        bridgeAt[i] = g;
      } else if (isSwitchChar(ch)) {
        const sw = def.switches?.[ch];
        if (!sw) throw new Error(`level ${def.id}: switch '${ch}' at ${x},${z} is not defined`);
        if (!/^[a-f]+$/.test(sw.bridges)) throw new Error(`level ${def.id}: switch '${ch}' bridges '${sw.bridges}' is invalid`);
        tiles[i] = 'switch';
        switchAt[i] = sw;
      } else throw new Error(`level ${def.id}: unknown glyph '${ch}' at ${x},${z}`);
    }
  }
  if (!start) throw new Error(`level ${def.id}: no start S`);
  if (!goal) throw new Error(`level ${def.id}: no goal G`);

  // every defined switch must appear on the board, and its groups must have bridge cells
  const used = new Set<SwitchDef>();
  for (const sw of switchAt) if (sw) used.add(sw);
  for (const key of Object.keys(def.switches ?? {})) {
    const sw = def.switches![key];
    if (!used.has(sw)) throw new Error(`level ${def.id}: switch '${key}' is defined but never used`);
    for (const g of sw.bridges) if (!groupCase.has(g)) throw new Error(`level ${def.id}: switch '${key}' references group '${g}' with no cells`);
  }

  const groups = [...groupCase.keys()].sort();
  let initialMask = 0;
  groups.forEach((g, i) => {
    if (groupCase.get(g)) initialMask |= 1 << i;
  });
  return { def, w, h, tiles, bridgeAt, switchAt, start, goal, groups, initialMask };
}

export function initialState(level: Level): State {
  return { block: { ...level.start }, mask: level.initialMask, moves: 0 };
}

/** True while group g's bridge cells are solid in this mask. */
export function bridgeOn(level: Level, mask: number, group: string): boolean {
  const i = level.groups.indexOf(group);
  return i >= 0 && (mask & (1 << i)) !== 0;
}

/**
 * Advances one roll. Order: move, support check against the pre-move mask (switches never rescue
 * the move that lands on them), fragile stand falls, goal stand wins, then switches fire
 * (soft always, hard only standing), then moves ticks up in every outcome.
 */
export function step(level: Level, s: State, d: Dir): { state: State; outcome: Outcome; pressed: [number, number][]; changed: string[] } {
  const nb = roll(s.block, d);
  const { w, h } = level;
  const next: State = { block: nb, mask: s.mask, moves: s.moves + 1 };
  const empty = { pressed: [] as [number, number][], changed: [] as string[] };

  for (const [x, z] of cells(nb)) {
    if (x < 0 || x >= w || z < 0 || z >= h) return { state: next, outcome: { kind: 'fall', fragile: false }, ...empty };
    const i = z * w + x;
    const t = level.tiles[i];
    if (t === 'void') return { state: next, outcome: { kind: 'fall', fragile: false }, ...empty };
    if (t === 'bridge' && !bridgeOn(level, s.mask, level.bridgeAt[i]!)) {
      return { state: next, outcome: { kind: 'fall', fragile: false }, ...empty };
    }
  }

  const i0 = nb.z * w + nb.x;
  if (nb.o === 'stand') {
    if (level.tiles[i0] === 'fragile') return { state: next, outcome: { kind: 'fall', fragile: true }, ...empty };
    if (level.tiles[i0] === 'goal') return { state: next, outcome: { kind: 'win' }, ...empty };
  }

  const pressed: [number, number][] = [];
  const changed: string[] = [];
  let mask = s.mask;
  for (const [x, z] of cells(nb)) {
    const sw = level.switchAt[z * w + x];
    if (!sw) continue;
    if (sw.kind === 'hard' && nb.o !== 'stand') continue;
    pressed.push([x, z]);
    for (const g of sw.bridges) {
      const bit = 1 << level.groups.indexOf(g);
      const was = (mask & bit) !== 0;
      const is = sw.act === 'toggle' ? !was : sw.act === 'on';
      if (is !== was) {
        mask = is ? mask | bit : mask & ~bit;
        changed.push(g);
      }
    }
  }
  next.mask = mask;
  return { state: next, outcome: { kind: 'ok' }, pressed, changed };
}

/** BFS over (x,z,o,mask) for the shortest winning move list, or null when the level cannot be solved. */
export function solve(level: Level): Dir[] | null {
  const start = initialState(level);
  const key = (b: Block, mask: number) => `${b.x},${b.z},${b.o},${mask}`;
  const seen = new Set<string>([key(start.block, start.mask)]);
  const queue: { s: State; path: Dir[] }[] = [{ s: start, path: [] }];
  for (let qi = 0; qi < queue.length; qi++) {
    const { s, path } = queue[qi];
    for (const d of DIRS) {
      const { state, outcome } = step(level, s, d);
      if (outcome.kind === 'win') return [...path, d];
      if (outcome.kind === 'fall') continue;
      const k = key(state.block, state.mask);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ s: state, path: [...path, d] });
    }
  }
  return null;
}

/**
 * Maps a screen-space swipe to a grid direction. axes gives the screen-space vectors of one +x and
 * one +z grid step under the current camera; the grid dir whose screen vector best matches (dx,dy)
 * by cosine wins. Returns null under the threshold (default 24px).
 */
export function swipeDir(dx: number, dy: number, axes: { x: [number, number]; z: [number, number] }, threshold = 24): Dir | null {
  const len = Math.hypot(dx, dy);
  if (len < threshold) return null;
  const cands: { d: Dir; v: [number, number] }[] = [
    { d: 'right', v: axes.x },
    { d: 'left', v: [-axes.x[0], -axes.x[1]] },
    { d: 'down', v: axes.z },
    { d: 'up', v: [-axes.z[0], -axes.z[1]] },
  ];
  let best: Dir | null = null;
  let bestCos = -Infinity;
  for (const c of cands) {
    const vl = Math.hypot(c.v[0], c.v[1]);
    if (!vl) continue;
    const cos = (dx * c.v[0] + dy * c.v[1]) / (len * vl);
    if (cos > bestCos) {
      bestCos = cos;
      best = c.d;
    }
  }
  return best;
}
