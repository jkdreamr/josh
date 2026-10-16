export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export type Card = { id: number; rank: number; suit: Suit; up: boolean };
export type Draw = 1 | 3;
export type Pile = 'stock' | 'waste' | 'f0' | 'f1' | 'f2' | 'f3' | 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6';

export const FOUNDATIONS: readonly Pile[] = ['f0', 'f1', 'f2', 'f3'];
export const TABLEAU: readonly Pile[] = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
export const POINTS = {
  wasteToTableau: 5,
  toFoundation: 10,
  reveal: 5,
  foundationToTableau: -15,
  recycle1: -100,
  recycle3: -20,
  undo: 10,
  win: 500,
  timePerSecond: 2,
};
export const TIME_LIMIT = 15 * 60;
export const MAX_SCORE = 20_000;

export type Snapshot = {
  stock: Card[];
  waste: Card[];
  found: Card[][];
  tab: Card[][];
  points: number;
  moves: number;
  passes: number;
  fan: number;
};

export type State = Snapshot & {
  draw: Draw;
  seed: number;
  penalty: number;
  undos: number;
  history: Snapshot[];
};

export type DealMsg = { t: 'deal'; seed: number; draw: Draw };

const isFoundation = (pile: Pile): boolean => FOUNDATIONS.includes(pile);
const isTableau = (pile: Pile): boolean => TABLEAU.includes(pile);

export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isRed = (c: { suit: Suit }): boolean => c.suit === 'hearts' || c.suit === 'diamonds';

export function makeCard(id: number, up = false): Card {
  const suit = SUITS[Math.floor(id / 13) % SUITS.length] ?? SUITS[0];
  return { id, rank: (id % 13) + 1, suit, up };
}

export function shuffled(seed: number): Card[] {
  const deck = Array.from({ length: 52 }, (_, id) => makeCard(id));
  const random = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function snapshotOf(s: State): Snapshot {
  return {
    stock: [...s.stock],
    waste: [...s.waste],
    found: s.found.map((pile) => [...pile]),
    tab: s.tab.map((pile) => [...pile]),
    points: s.points,
    moves: s.moves,
    passes: s.passes,
    fan: s.fan,
  };
}

function withHistory(s: State): Snapshot[] {
  return [...s.history, snapshotOf(s)].slice(-500);
}

/** The same shuffle dealt for a new draw setting, while the deal is still untouched; null when nothing should change. */
export function redealFor(s: State, draw: Draw): State | null {
  if (s.draw === draw || s.history.length) return null;
  return deal(s.seed, draw);
}

export function deal(seed: number, draw: Draw): State {
  const deck = shuffled(seed);
  const tab = Array.from({ length: 7 }, () => [] as Card[]);
  for (let row = 0; row < 7; row++) {
    for (let column = row; column < 7; column++) {
      const card = deck.pop();
      if (card) tab[column].push(card);
    }
  }
  for (const pile of tab) {
    const top = pile[pile.length - 1];
    if (top) pile[pile.length - 1] = { ...top, up: true };
  }

  return {
    stock: deck,
    waste: [],
    found: [[], [], [], []],
    tab,
    points: 0,
    moves: 0,
    passes: 0,
    fan: 0,
    draw,
    seed,
    penalty: 0,
    undos: 0,
    history: [],
  };
}

export function pileCards(s: State, p: Pile): Card[] {
  if (p === 'stock') return [...s.stock];
  if (p === 'waste') return [...s.waste];
  if (isFoundation(p)) return [...s.found[FOUNDATIONS.indexOf(p)]];
  if (isTableau(p)) return [...s.tab[TABLEAU.indexOf(p)]];
  return [];
}

export function score(s: State): number {
  return Math.max(0, s.points - s.penalty);
}

export function drawStock(s: State): State | null {
  if (s.stock.length === 0 && s.waste.length === 0) return null;

  if (s.stock.length > 0) {
    const count = Math.min(s.draw, s.stock.length);
    const stock = [...s.stock];
    const waste = [...s.waste];
    for (let i = 0; i < count; i++) {
      const card = stock.pop();
      if (card) waste.push({ ...card, up: true });
    }
    return {
      ...s,
      stock,
      waste,
      fan: count,
      moves: s.moves + 1,
      history: withHistory(s),
    };
  }

  const points = s.points + (s.draw === 1 ? POINTS.recycle1 : POINTS.recycle3);
  return {
    ...s,
    stock: [...s.waste].reverse().map((card) => ({ ...card, up: false })),
    waste: [],
    points,
    fan: 0,
    passes: s.passes + 1,
    moves: s.moves + 1,
    history: withHistory(s),
  };
}

function sourceCards(s: State, p: Pile): Card[] | null {
  if (p === 'stock') return null;
  if (p === 'waste') return s.waste;
  if (isFoundation(p)) return s.found[FOUNDATIONS.indexOf(p)] ?? null;
  if (isTableau(p)) return s.tab[TABLEAU.indexOf(p)] ?? null;
  return null;
}

function validRun(cards: Card[], index: number): boolean {
  if (index < 0 || index >= cards.length) return false;
  for (let i = index; i < cards.length; i++) {
    if (!cards[i].up) return false;
    if (i > index && (cards[i - 1].rank !== cards[i].rank + 1 || isRed(cards[i - 1]) === isRed(cards[i]))) {
      return false;
    }
  }
  return true;
}

function canPlaceOnFoundation(s: State, card: Card, to: Pile): boolean {
  if (!isFoundation(to)) return false;
  const pile = s.found[FOUNDATIONS.indexOf(to)];
  if (!pile) return false;
  if (pile.length === 0) return card.rank === 1;
  const top = pile[pile.length - 1];
  return top.suit === card.suit && card.rank === top.rank + 1;
}

export function canMove(s: State, from: Pile, index: number, to: Pile): boolean {
  if (from === to || !Number.isInteger(index)) return false;
  const cards = sourceCards(s, from);
  if (!cards || index < 0 || index >= cards.length) return false;
  if (from === 'waste' || isFoundation(from)) {
    if (index !== cards.length - 1) return false;
  } else if (isTableau(from)) {
    if (!validRun(cards, index)) return false;
  }

  const moving = cards.slice(index);
  const first = moving[0];
  if (!first) return false;

  if (isFoundation(to)) return moving.length === 1 && canPlaceOnFoundation(s, first, to);
  if (!isTableau(to)) return false;

  const target = s.tab[TABLEAU.indexOf(to)];
  if (!target) return false;
  if (target.length === 0) return first.rank === 13;
  const top = target[target.length - 1];
  return top.up && isRed(top) !== isRed(first) && top.rank - 1 === first.rank;
}

export function move(s: State, from: Pile, index: number, to: Pile): State | null {
  if (!canMove(s, from, index, to)) return null;
  const source = sourceCards(s, from);
  if (!source) return null;
  const moving = source.slice(index);
  const next: State = {
    ...s,
    stock: [...s.stock],
    waste: [...s.waste],
    found: s.found.map((pile) => [...pile]),
    tab: s.tab.map((pile) => [...pile]),
    history: withHistory(s),
  };

  if (from === 'waste') next.waste.splice(index);
  else if (isFoundation(from)) next.found[FOUNDATIONS.indexOf(from)].splice(index);
  else if (isTableau(from)) next.tab[TABLEAU.indexOf(from)].splice(index);

  if (isFoundation(to)) next.found[FOUNDATIONS.indexOf(to)].push(...moving);
  else if (isTableau(to)) next.tab[TABLEAU.indexOf(to)].push(...moving);

  let points = s.points;
  if (from === 'waste' && isTableau(to)) points += POINTS.wasteToTableau;
  if (isFoundation(to) && !isFoundation(from)) points += POINTS.toFoundation;
  if (isFoundation(from) && isTableau(to)) points += POINTS.foundationToTableau;
  if (isTableau(from)) {
    const sourcePile = next.tab[TABLEAU.indexOf(from)];
    const newTop = sourcePile[sourcePile.length - 1];
    if (newTop && !newTop.up) {
      sourcePile[sourcePile.length - 1] = { ...newTop, up: true };
      points += POINTS.reveal;
    }
  }

  let fan = s.fan;
  if (from === 'waste') fan = next.waste.length ? Math.max(1, fan - 1) : 0;
  return { ...next, points, fan, moves: s.moves + 1 };
}

export function foundationFor(s: State, from: Pile, index: number): Pile | null {
  const cards = sourceCards(s, from);
  const card = cards?.[index];
  if (!card) return null;
  if (isFoundation(from) || from === 'waste') {
    if (index !== cards.length - 1) return null;
  } else if (isTableau(from)) {
    if (index !== cards.length - 1 || !card.up) return null;
  } else return null;

  const accepting = FOUNDATIONS.filter((pile) => canMove(s, from, index, pile));
  if (card.rank === 1) return accepting[0] ?? null;
  return accepting.find((pile) => s.found[FOUNDATIONS.indexOf(pile)].some((c) => c.suit === card.suit))
    ?? accepting[0]
    ?? null;
}

export function bestMove(s: State, from: Pile, index: number): Pile | null {
  const cards = sourceCards(s, from);
  if (!cards || index < 0 || index >= cards.length) return null;
  const moving = cards[index];
  if (!moving) return null;

  if (index === cards.length - 1) {
    const foundation = foundationFor(s, from, index);
    if (foundation) return foundation;
  }

  const start = isTableau(from) ? (TABLEAU.indexOf(from) + 1) % TABLEAU.length : 0;
  const targetOrder = TABLEAU.map((_, offset) => TABLEAU[(start + offset) % TABLEAU.length]);
  for (const target of targetOrder) {
    if (s.tab[TABLEAU.indexOf(target)].length > 0 && canMove(s, from, index, target)) return target;
  }

  const sourceIsPointlessKingMove = isTableau(from) && index === 0 && moving.rank === 13;
  if (moving.rank === 13 && !sourceIsPointlessKingMove) {
    for (const target of targetOrder) {
      if (s.tab[TABLEAU.indexOf(target)].length === 0 && canMove(s, from, index, target)) return target;
    }
  }
  return null;
}

export function undo(s: State): State | null {
  const previous = s.history[s.history.length - 1];
  if (!previous) return null;
  return {
    ...previous,
    stock: [...previous.stock],
    waste: [...previous.waste],
    found: previous.found.map((pile) => [...pile]),
    tab: previous.tab.map((pile) => [...pile]),
    draw: s.draw,
    seed: s.seed,
    penalty: s.penalty + POINTS.undo,
    undos: s.undos + 1,
    history: s.history.slice(0, -1),
  };
}

export function isWon(s: State): boolean {
  return s.found.every((pile) => pile.length === 13);
}

export function canAutoFinish(s: State): boolean {
  return !isWon(s) && s.stock.length === 0 && s.waste.length === 0 && s.tab.every((pile) => pile.every((card) => card.up));
}

export function autoStep(s: State): { state: State; from: Pile; index: number; to: Pile } | null {
  let selected: { from: Pile; index: number; to: Pile; rank: number } | null = null;
  for (const from of TABLEAU) {
    const pile = s.tab[TABLEAU.indexOf(from)];
    const index = pile.length - 1;
    const card = pile[index];
    if (!card) continue;
    const to = foundationFor(s, from, index);
    if (!to) continue;
    if (!selected || card.rank < selected.rank) selected = { from, index, to, rank: card.rank };
  }
  if (!selected) return null;
  const state = move(s, selected.from, selected.index, selected.to);
  if (!state) return null;
  return { state, from: selected.from, index: selected.index, to: selected.to };
}

function cardFitsFoundation(s: State, card: Card): boolean {
  return FOUNDATIONS.some((pile) => canPlaceOnFoundation(s, card, pile));
}

function cardFitsTableau(s: State, card: Card): boolean {
  return TABLEAU.some((pile) => {
    const target = s.tab[TABLEAU.indexOf(pile)];
    if (target.length === 0) return card.rank === 13;
    const top = target[target.length - 1];
    return top.up && isRed(top) !== isRed(card) && top.rank - 1 === card.rank;
  });
}

export function hasMoves(s: State): boolean {
  for (const from of [...TABLEAU, 'waste'] as Pile[]) {
    const pile = sourceCards(s, from);
    const index = pile ? pile.length - 1 : -1;
    if (index >= 0 && foundationFor(s, from, index)) return true;
  }

  for (const from of TABLEAU) {
    const pile = s.tab[TABLEAU.indexOf(from)];
    for (let index = 1; index < pile.length; index++) {
      if (!pile[index - 1].up && validRun(pile, index) && TABLEAU.some((to) => canMove(s, from, index, to))) return true;
      if (pile[index].rank === 13 && validRun(pile, index) && TABLEAU.some((to) =>
        s.tab[TABLEAU.indexOf(to)].length === 0 && canMove(s, from, index, to))) return true;
    }
  }

  const wasteTop = s.waste.length - 1;
  if (wasteTop >= 0 && TABLEAU.some((to) => canMove(s, 'waste', wasteTop, to))) return true;

  for (const card of [...s.stock, ...s.waste]) {
    if (cardFitsFoundation(s, card) || cardFitsTableau(s, card)) return true;
  }
  return false;
}

export function finalScore(s: State, seconds: number): { base: number; win: number; time: number; total: number } {
  const base = score(s);
  const won = isWon(s);
  const win = won ? POINTS.win : 0;
  const time = won ? Math.max(0, Math.round((TIME_LIMIT - seconds) * POINTS.timePerSecond)) : 0;
  return { base, win, time, total: Math.min(MAX_SCORE, base + win + time) };
}

export const clock = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function parseDeal(d: unknown): DealMsg | null {
  if (!d || typeof d !== 'object') return null;
  const message = d as { t?: unknown; seed?: unknown; draw?: unknown };
  if (
    message.t !== 'deal'
    || !Number.isInteger(message.seed)
    || (message.seed as number) < 0
    || (message.seed as number) > 2 ** 32 - 1
    || (message.draw !== 1 && message.draw !== 3)
  ) return null;
  return { t: 'deal', seed: message.seed as number, draw: message.draw };
}

export const isDealRequest = (d: unknown): boolean =>
  !!d && typeof d === 'object' && (d as { t?: unknown }).t === 'deal?';

export const randomSeed = (): number => (Math.random() * 2 ** 32) >>> 0;
