// Party Mix rules, kept pure so they run under node: which cards make a deck, in what order, who they name,
// how long each New Rule stays on, and where Back and Next lead.
import { shuffle, type Rng } from '../../kit/party-core.ts';
import { CARDS, THEMES, themesOf, type CardType, type Level, type Template } from './cards.ts';

export type Intensity = 'chill' | 'party' | 'wild' | 'dark';
export type Length = 'short' | 'normal' | 'long';
export type Kind = CardType | 'end';

/** Where a new table starts. The 18+ intensities are opt-in. */
export const DEFAULT_INTENSITY: Intensity = 'party';
/** The intensities that deal 18+ cards. */
export const ADULT: readonly Intensity[] = ['wild', 'dark'];
/** The highest card level each intensity deals. Wild and After Dark are the 18+ ones. */
export const LEVELS: Record<Intensity, Level> = { chill: 1, party: 2, wild: 3, dark: 4 };
/**
 * How strongly each level is favored at each intensity (lower comes up more): the hotter the setting, the more
 * of its own cards, with a few milder ones left in for pacing.
 */
export const WEIGHTS: Record<Intensity, Partial<Record<Level, number>>> = {
  chill: { 1: 1 },
  party: { 1: 1, 2: 0.6 },
  wild: { 1: 1, 2: 0.8, 3: 0.4 },
  dark: { 1: 1, 2: 1, 3: 0.55, 4: 0.3 },
};
/** Cards per deck, counting each New Rule and its Rule Over card. */
export const LENGTHS: Record<Length, number> = { short: 30, normal: 50, long: 80 };
/** New Rules per deck. */
export const RULES: Record<Length, number> = { short: 2, normal: 3, long: 5 };
/** How many cards a rule stays on for, at least and at most. */
export const LIFETIME: Record<Length, readonly [number, number]> = { short: [5, 7], normal: [6, 9], long: [7, 11] };
/** The share of each non-rule type in a deck. */
export const MIX: Record<Exclude<CardType, 'rule'>, number> = { challenge: 18, give: 14, everyone: 16, vote: 13, duel: 14, game: 11, wyr: 14 };
/** Types that name a player, so a deck opens on someone. */
export const OPENERS: readonly Kind[] = ['challenge', 'duel', 'give'];

/** A piece of card text: plain words, or the seat of a player whose name goes there. */
export type Part = string | { seat: number };

export type Card = {
  kind: Kind;
  level: Level;
  /** The template text, so the next deck can skip what this one dealt. */
  key: string;
  text: Part[];
  /** Would You Rather: the second option. */
  or?: Part[];
  /** Players named, in order. A Rule Over card repeats its rule's players. */
  seats: number[];
  /** A New Rule the named player writes on the spot, and its Rule Over card. */
  write?: boolean;
  /** New Rule and Rule Over cards: the rule's short name, where it starts and ends in the deck, and how many cards it lasts. */
  rule?: { label: Part[]; from: number; to: number; lasts: number };
};

const PLACEHOLDER = /\{p([12])\}/g;

/** How many different players a template names (0, 1 or 2). */
export function slots(t: Pick<Template, 'text' | 'or' | 'label' | 'end'>): number {
  let n = 0;
  for (const s of [t.text, t.or, t.label, t.end]) for (const m of (s ?? '').matchAll(PLACEHOLDER)) n = Math.max(n, Number(m[1]));
  return n;
}

/** Splits template text into parts, with {p1} and {p2} replaced by the given seats. */
export function fill(text: string, seats: readonly number[]): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const i = m.index ?? 0;
    if (i > at) out.push(text.slice(at, i));
    const seat = seats[Number(m[1]) - 1];
    out.push(seat === undefined ? m[0] : { seat });
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Card text with the names written in. */
export function plain(parts: readonly Part[], names: readonly string[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : (names[p.seat] ?? `Player ${p.seat + 1}`))).join('');
}

/** What naming someone ahead of their turn costs a pair: once is fine now and then, twice never. */
const EXTRA = [0, 1.5, 100];
const pairKey = (a: number, b: number) => (a < b ? a * 1000 + b : b * 1000 + a);

/**
 * Picks players fairly: everyone is named once before anyone is named again, and whoever was just named waits,
 * so nobody gets picked twice in a row. Within that, a card goes to whoever has had the fewest of its kind
 * (Give cards spread around, so do the risky ones), and a head-to-head card goes to the pair that has met least,
 * never the pair that just met.
 */
export class Picker {
  private last = -1;
  private readonly players: number;
  private readonly rng: Rng;
  /** Times each seat has been named. */
  readonly counts: number[];
  /** Cards of each kind each seat has had. */
  private readonly kinds = new Map<string, number[]>();
  /** Times each pair has been named together, by pairKey, overall and per kind (`kind:key`). */
  private readonly met = new Map<number | string, number>();
  /** The last pair named together, overall and per kind. */
  private readonly lastPair = new Map<string, number>();
  constructor(players: number, rng: Rng = Math.random) {
    this.players = players;
    this.rng = rng;
    this.counts = Array.from({ length: players }, () => 0);
  }
  private kindCount(kind: string | undefined, seat: number) {
    return kind === undefined ? 0 : (this.kinds.get(kind)?.[seat] ?? 0);
  }
  private name(seat: number, kind?: string) {
    this.counts[seat]++;
    if (kind !== undefined) {
      const list = this.kinds.get(kind) ?? Array.from({ length: this.players }, () => 0);
      list[seat]++;
      this.kinds.set(kind, list);
    }
  }
  /** One player for a card of `kind`, never one of `not`. */
  take(not: readonly number[] = [], kind?: string): number {
    const open = Array.from({ length: this.players }, (_, s) => s).filter((s) => !not.includes(s));
    if (!open.length) return 0;
    const low = Math.min(...open.map((s) => this.counts[s]));
    const due = open.filter((s) => this.counts[s] === low);
    const fresh = due.length > 1 ? due.filter((s) => s !== this.last) : due;
    // Among those due, whoever has had the fewest cards of this kind. A fresh random draw breaks ties,
    // so each round goes in a new order.
    let best = fresh[0];
    let bestK = Infinity;
    for (const s of fresh) {
      const k = this.kindCount(kind, s) + this.rng() * 0.5;
      if (k < bestK) {
        bestK = k;
        best = s;
      }
    }
    this.last = best;
    this.name(best, kind);
    return best;
  }
  /** Two different players for a card of `kind`, chosen as a pair. */
  pair(kind?: string): [number, number] {
    if (this.players < 2) return [0, 0];
    const low = Math.min(...this.counts);
    const lastAny = this.lastPair.get('*');
    const lastKind = kind === undefined ? undefined : this.lastPair.get(kind);
    let best: { a: number; b: number; k: number } | null = null;
    for (let a = 0; a < this.players; a++)
      for (let b = a + 1; b < this.players; b++) {
        const key = pairKey(a, b);
        // Meeting less beats strict turn order: one extra name now and then evens out, the same two
        // facing off all night doesn't. Never the pair that just met, unless there is no other pair.
        const k =
          (this.met.get(`${kind}:${key}`) ?? 0) * 6 +
          (this.met.get(key) ?? 0) * 2 +
          (key === lastKind ? 300 : 0) +
          (key === lastAny ? 20 : 0) +
          EXTRA[Math.min(2, this.counts[a] - low)] +
          EXTRA[Math.min(2, this.counts[b] - low)] +
          (a === this.last || b === this.last ? 1 : 0) +
          (this.kindCount(kind, a) + this.kindCount(kind, b)) * 0.5 +
          this.rng() * 0.5;
        if (!best || k < best.k) best = { a, b, k };
      }
    const { a, b } = best!;
    const key = pairKey(a, b);
    this.met.set(key, (this.met.get(key) ?? 0) + 1);
    this.met.set(`${kind}:${key}`, (this.met.get(`${kind}:${key}`) ?? 0) + 1);
    this.lastPair.set('*', key);
    if (kind !== undefined) this.lastPair.set(kind, key);
    // Whoever reads first is a coin flip, so the same name doesn't always lead.
    const pair: [number, number] = this.rng() < 0.5 ? [a, b] : [b, a];
    this.name(a, kind);
    this.name(b, kind);
    this.last = pair[1];
    return pair;
  }
}

/** Every template an intensity can deal to this many players. */
export function eligible(intensity: Intensity, players: number, cards: readonly Template[] = CARDS): Template[] {
  return cards.filter((c) => c.level <= LEVELS[intensity] && (c.min ?? 2) <= players && slots(c) <= players);
}

/** Splits `total` over the weights, never giving a type more than it has. */
export function quotas<K extends string>(total: number, weights: Record<K, number>, have: Record<K, number>): Record<K, number> {
  const keys = (Object.keys(weights) as K[]).filter((k) => weights[k] > 0 && have[k] > 0);
  const out = Object.fromEntries((Object.keys(weights) as K[]).map((k) => [k, 0])) as Record<K, number>;
  let left = Math.min(total, keys.reduce((n, k) => n + have[k], 0));
  while (left > 0) {
    const open = keys.filter((k) => out[k] < have[k]);
    const sum = open.reduce((n, k) => n + weights[k], 0);
    const share = open.map((k) => ({ k, exact: (left * weights[k]) / sum }));
    let given = 0;
    for (const { k, exact } of share) {
      const n = Math.min(Math.floor(exact), have[k] - out[k]);
      out[k] += n;
      given += n;
    }
    // Hand out what rounding left over, largest remainder first.
    if (given === 0)
      for (const { k } of share.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
        if (given === left) break;
        if (out[k] < have[k]) {
          out[k]++;
          given++;
        }
      }
    left -= given;
  }
  return out;
}

/** True when some kind shows up three times in a row. */
export function hasTriple(kinds: readonly Kind[]): boolean {
  return kinds.some((k, i) => i >= 2 && k === kinds[i - 1] && k === kinds[i - 2]);
}

/**
 * Shuffles cards so no kind comes up three times in a row, opening on a card that names someone when it can.
 * Exported for tests; works on anything with a `kind`.
 */
export function arrange<T extends { kind: Kind }>(cards: readonly T[], rng: Rng = Math.random): T[] {
  const left = shuffle(cards, rng);
  const out: T[] = [];
  while (left.length) {
    const n = out.length;
    const prev = n ? out[n - 1].kind : null;
    const blocked = n >= 2 && out[n - 1].kind === out[n - 2].kind ? out[n - 1].kind : null;
    let i = n === 0 ? left.findIndex((c) => OPENERS.includes(c.kind)) : -1;
    // Rather a change of kind every card; two in a row only when the pile runs out of others.
    if (i < 0) i = left.findIndex((c) => c.kind !== prev);
    if (i < 0) i = left.findIndex((c) => c.kind !== blocked);
    if (i < 0) i = 0;
    out.push(left.splice(i, 1)[0]);
  }
  // A pile that ends on one kind can still leave a triple: swap the odd one out with a card further up.
  // `bad(p)`: a triple runs through position p.
  const bad = (p: number) => [p, p + 1, p + 2].some((j) => j >= 2 && j < out.length && out[j].kind === out[j - 1].kind && out[j].kind === out[j - 2].kind);
  for (let i = 2; i < out.length; i++) {
    if (out[i].kind !== out[i - 1].kind || out[i].kind !== out[i - 2].kind) continue;
    for (let j = 1; j < out.length; j++) {
      if (out[j].kind === out[i].kind) continue;
      [out[i], out[j]] = [out[j], out[i]];
      if (!bad(i) && !bad(j)) break;
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

export type DeckOptions = {
  players: number;
  intensity: Intensity;
  length: Length;
  rng?: Rng;
  /** Template texts from the last deck. They are dealt again only when nothing fresh is left. */
  avoid?: ReadonlySet<string>;
  cards?: readonly Template[];
};

/** Builds a full deck: a mix of types at the chosen intensity, New Rules with their Rule Over cards, and names filled in. */
export function buildDeck({ players, intensity, length, rng = Math.random, avoid, cards = CARDS }: DeckOptions): Card[] {
  const weights = WEIGHTS[intensity];
  // One ranking for the whole pool, lower first: cards at the chosen intensity come up more often, cards from the
  // last deck wait their turn.
  const pool = eligible(intensity, players, cards)
    .map((t) => ({ t, k: rng() * (weights[t.level] ?? 1) + (avoid?.has(t.text) ? 1 : 0) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);
  // Each topic shows up once a deck (a few broad ones twice), so two cards never ask the same thing.
  const topics = new Map<string, number>();
  const limit = new Map(THEMES.map((th) => [th.id, th.max ?? 1]));
  const free = (t: Template) => themesOf(t).every((id) => (topics.get(id) ?? 0) < (limit.get(id) ?? 1));
  const taken = new Set<Template>();
  const take = (t: Template) => {
    taken.add(t);
    for (const id of themesOf(t)) topics.set(id, (topics.get(id) ?? 0) + 1);
  };
  /** Takes cards in ranked order while `room` says so: topics free first, then (when `any`, for a tiny pool) any card. */
  const gather = (ok: (t: Template) => boolean, room: () => boolean, any = true) => {
    for (const strict of any ? [true, false] : [true])
      for (const t of pool) {
        if (!room()) return;
        if (!taken.has(t) && ok(t) && (!strict || free(t))) take(t);
      }
  };

  gather(
    (t) => t.type === 'rule',
    () => taken.size < RULES[length],
  );
  const rules = pool.filter((t) => taken.has(t));
  const types = Object.keys(MIX) as (keyof typeof MIX)[];
  const want = quotas(
    LENGTHS[length] - rules.length * 2,
    MIX,
    Object.fromEntries(types.map((t) => [t, pool.filter((x) => x.type === t).length])) as Record<keyof typeof MIX, number>,
  );
  const goal = types.reduce((n, t) => n + want[t], 0);
  const got = (type?: CardType) => [...taken].filter((t) => t.type !== 'rule' && (!type || t.type === type)).length;
  // Each type up to its share, then whatever has a free topic makes up for a type that ran short.
  for (const type of types)
    gather(
      (t) => t.type === type,
      () => got(type) < want[type],
      false,
    );
  gather(
    (t) => t.type !== 'rule',
    () => got() < goal,
  );
  const body = arrange(
    pool.filter((t) => taken.has(t) && t.type !== 'rule').map((tpl) => ({ kind: tpl.type as Kind, tpl })),
    rng,
  );
  const total = body.length + rules.length * 2;

  // Each rule starts a little way into its own stretch of the deck and ends before the next stretch begins.
  const [shortest, longest] = LIFETIME[length];
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  const spans: { from: number; to: number }[] = [];
  rules.forEach((_, r) => {
    const lo = Math.floor((r * total) / rules.length);
    const hi = Math.floor(((r + 1) * total) / rules.length);
    const from = lo + 2 + Math.floor(rng() * Math.max(1, Math.floor((hi - lo) / 5)));
    const lasts = Math.max(1, Math.min(shortest + Math.floor(rng() * (longest - shortest + 1)), hi - from - 3));
    starts.set(from, r);
    ends.set(from + lasts + 1, r);
    spans.push({ from, to: from + lasts + 1 });
  });

  const pick = new Picker(players, rng);
  const ruleSeats: number[][] = [];
  const deck: Card[] = [];
  let next = 0;
  for (let i = 0; i < total; i++) {
    const r = starts.get(i) ?? ends.get(i);
    const isStart = starts.has(i);
    const tpl = r === undefined ? body[next++].tpl : rules[r];
    const seats: number[] = [];
    const kind = r === undefined || isStart ? tpl.type : 'end';
    if (kind !== 'end') {
      const n = slots(tpl);
      if (n === 2) seats.push(...pick.pair(kind));
      else if (n === 1) seats.push(pick.take([], kind));
    } else seats.push(...ruleSeats[r!]);
    if (r !== undefined && isStart) ruleSeats[r] = seats;
    const card: Card = { kind, level: tpl.level, key: tpl.text, text: fill(r !== undefined && !isStart ? (tpl.end ?? '') : tpl.text, seats), seats };
    if (tpl.or) card.or = fill(tpl.or, seats);
    if (tpl.write) card.write = true;
    if (r !== undefined) card.rule = { label: fill(tpl.label ?? '', seats), from: spans[r].from, to: spans[r].to, lasts: spans[r].to - spans[r].from - 1 };
    deck.push(card);
  }
  return deck;
}

/** Rules in force while card `at` is showing: started before it, and their Rule Over card is still to come. */
export function activeRules(deck: readonly Card[], at: number): Card[] {
  return deck.filter((c, i) => c.kind === 'rule' && c.rule && i === c.rule.from && c.rule.from < at && at < c.rule.to);
}

/**
 * Where Next (+1) and Back (-1) lead from a spot in the deck. Spots run 0 to deck length,
 * where the length itself is the end screen. Back from the first card stays put.
 */
export function step(at: number, dir: 1 | -1, total: number): number {
  return Math.max(0, Math.min(total, at + dir));
}

export type Stats = {
  cards: number;
  duels: number;
  rules: number;
  /** Times each seat was named (a Rule Over card doesn't count again). */
  named: number[];
  most: { seats: number[]; times: number };
  least: { seats: number[]; times: number };
};

/** A few numbers for the end screen. */
export function stats(deck: readonly Card[], players: number): Stats {
  const named = Array.from({ length: players }, () => 0);
  for (const c of deck) if (c.kind !== 'end') for (const s of new Set(c.seats)) if (s < players) named[s]++;
  const hi = Math.max(0, ...named);
  const lo = Math.min(...named);
  const seatsAt = (n: number) => named.flatMap((v, s) => (v === n ? [s] : []));
  return {
    cards: deck.length,
    duels: deck.filter((c) => c.kind === 'duel').length,
    rules: deck.filter((c) => c.kind === 'rule').length,
    named,
    most: { seats: seatsAt(hi), times: hi },
    least: { seats: seatsAt(lo), times: lo },
  };
}
