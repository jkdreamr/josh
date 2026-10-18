import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { defineSetting, GameShell, Segmented, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  autoStep,
  bestMove,
  canAutoFinish,
  canMove,
  clock,
  deal,
  drawStock,
  finalScore,
  FOUNDATIONS,
  foundationFor,
  hasMoves,
  isDealRequest,
  isRed,
  isWon,
  move,
  parseDeal,
  pileCards,
  randomSeed,
  redealFor,
  score,
  shortcut,
  TABLEAU,
  TIME_LIMIT,
  undo,
  type Card,
  type Draw,
  type Pile,
  type State,
  type Suit,
} from './logic';
import { meta } from './meta';
import './solitaire.css';

const DRAW = defineSetting('solitaire:draw', ['1', '3'] as const, '1');
const drawOptions = [
  ['1', 'Draw 1'],
  ['3', 'Draw 3'],
] as const;

const suitPath: Record<Suit, string> = {
  hearts: 'M12 21.2C6.4 17.1 2 13.4 2 8.7 2 5.6 4.4 3.2 7.3 3.2c2 0 3.6 1 4.7 2.7 1.1-1.7 2.7-2.7 4.7-2.7 2.9 0 5.3 2.4 5.3 5.5 0 4.7-4.4 8.4-10 12.5z',
  diamonds: 'M12 2.2l7.6 9.8L12 21.8 4.4 12z',
  spades: 'M12 2.4C7.6 6.6 3.4 9.6 3.4 13.6c0 2.7 2.1 4.6 4.5 4.6 1.3 0 2.4-.5 3.2-1.4-.3 1.9-1 3.2-2.2 4.4h6.2c-1.2-1.2-1.9-2.5-2.2-4.4.8.9 1.9 1.4 3.2 1.4 2.4 0 4.5-1.9 4.5-4.6 0-4-4.2-7-8.6-11.2z',
  clubs: 'M12 2.6a4.4 4.4 0 0 0-3.6 6.9 4.4 4.4 0 1 0 2.6 7.3c-.3 1.9-1 3.2-2.2 4.4h6.4c-1.2-1.2-1.9-2.5-2.2-4.4a4.4 4.4 0 1 0 2.6-7.3A4.4 4.4 0 0 0 12 2.6z',
};
const rankLabel = (r: number) => (r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r));
const rankName = (r: number) => (r === 1 ? 'Ace' : r === 11 ? 'Jack' : r === 12 ? 'Queen' : r === 13 ? 'King' : String(r));
const suitName: Record<Suit, string> = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs' };
const cardName = (c: Card) => `${rankName(c.rank)} of ${suitName[c.suit]}`;
const ALL_PILES: Pile[] = ['stock', 'waste', ...FOUNDATIONS, ...TABLEAU];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<HostSetup />}>
      <Play />
    </GameShell>
  );
}

function Setup() {
  return <DrawPicker />;
}

/** Online, the host picks the draw for everyone; the round's deal carries it. */
function HostSetup() {
  const online = useOnline();
  if (!online?.isHost) return null;
  return <DrawPicker />;
}

/** Touch gets taller segments and larger text, since the iPad frame scales the page to about 0.82. */
function DrawPicker() {
  const { touch } = useShell();
  const [draw, setDraw] = useSetting(DRAW);
  return (
    <div className={`g-solitaire-field${touch ? ' is-touch' : ''}`} role="group" aria-label="Draw">
      <span aria-hidden="true">Draw</span>
      <Segmented value={draw} options={drawOptions} onChange={setDraw} className={`g-solitaire-seg${touch ? ' is-touch' : ''}`} />
    </div>
  );
}

type Pos = { x: number; y: number };
type Layout = {
  cw: number;
  ch: number;
  side: boolean;
  /** Narrow stages keep the HUD under the table so it clears the shell's controls. */
  low: boolean;
  top: number;
  slot: Record<Pile, Pos>;
  /** Where the waste fans: along x on the top row, along y in the side column. */
  fan: Pos;
  /** Face-down and face-up offsets for each tableau column, squeezed to fit. */
  offs: { down: number; up: number }[];
  bottom: number;
};

function layout(w: number, h: number, s: State, touch: boolean): Layout {
  const top = touch ? 62 : 48;
  const pad = 8;
  const low = w < 560;
  const foot = low ? (touch ? 62 : 46) : 0;
  const H = Math.max(60, h - top - pad - foot);
  const gap = (cw: number) => Math.max(4, Math.min(14, Math.round(cw * 0.12)));
  const topRow = () => {
    const byW = Math.min((w - 2 * pad) / (7 + 6 * 0.12), (w - 2 * pad - 6 * 4) / 7);
    const byH = (H - 10) / (1.4 * 2.3);
    return Math.min(byW, byH);
  };
  const sideCol = () => {
    const byW = Math.min((w - 2 * pad) / (10 + 11 * 0.12), (w - 2 * pad - 11 * 4) / 10);
    const byH = (H - 8) / (1.4 * 2.12);
    return Math.min(byW, byH);
  };
  const a = topRow();
  const b = sideCol();
  const side = b > a * 1.04;
  const cw = Math.max(24, Math.min(112, Math.floor(side ? b : a)));
  const ch = Math.round(cw * 1.4);
  const g = gap(cw);
  const slot = {} as Record<Pile, Pos>;
  let tabY: number;
  let fan: Pos;
  if (!side) {
    const total = 7 * cw + 6 * g;
    const x0 = Math.round((w - total) / 2);
    const col = (i: number) => x0 + i * (cw + g);
    slot.stock = { x: col(0), y: top };
    slot.waste = { x: col(1), y: top };
    FOUNDATIONS.forEach((f, i) => (slot[f] = { x: col(3 + i), y: top }));
    tabY = top + ch + Math.max(8, Math.round(ch * 0.14));
    TABLEAU.forEach((t, i) => (slot[t] = { x: col(i), y: tabY }));
    fan = { x: Math.round(cw * 0.3), y: 0 };
  } else {
    const sg = g * 2;
    const total = 10 * cw + 7 * g + 2 * sg;
    const x0 = Math.round((w - total) / 2);
    const gy = Math.max(6, Math.round(ch * 0.1));
    slot.stock = { x: x0, y: top };
    slot.waste = { x: x0, y: top + ch + gy };
    const tx = x0 + cw + sg;
    TABLEAU.forEach((t, i) => (slot[t] = { x: tx + i * (cw + g), y: top }));
    const fx = tx + 7 * cw + 6 * g + sg;
    FOUNDATIONS.forEach((f, i) => (slot[f] = { x: fx + (i % 2) * (cw + g), y: top + Math.floor(i / 2) * (ch + gy) }));
    tabY = top;
    fan = { x: 0, y: Math.round(ch * 0.17) };
  }
  const bottom = h - pad - foot;
  const room = bottom - tabY - ch;
  const offs = s.tab.map((col) => {
    const downs = col.filter((c) => !c.up).length;
    const ups = Math.max(0, col.length - downs - 1);
    let down = Math.max(4, Math.round(ch * 0.11));
    let up = Math.round(ch * 0.27);
    if (downs * down + ups * up > room) {
      down = Math.max(3, Math.min(down, Math.floor((room - ups * up) / Math.max(1, downs))));
      if (downs * down + ups * up > room) up = Math.max(6, Math.floor((room - downs * down) / Math.max(1, ups)));
    }
    return { down, up };
  });
  return { cw, ch, side, low, top, slot, fan, offs, bottom };
}

/** Where every card sits, and its stacking order. */
function placeCards(s: State, L: Layout) {
  const out = new Map<number, { x: number; y: number; z: number; pile: Pile; index: number }>();
  s.stock.forEach((c, i) => {
    const lift = Math.min(3, Math.floor(i / 8));
    out.set(c.id, { x: L.slot.stock.x - lift, y: L.slot.stock.y - lift, z: 10 + i, pile: 'stock', index: i });
  });
  const shown = s.fan;
  s.waste.forEach((c, i) => {
    const k = i - (s.waste.length - shown);
    const step = Math.max(0, k);
    out.set(c.id, { x: L.slot.waste.x + L.fan.x * step, y: L.slot.waste.y + L.fan.y * step, z: 100 + i, pile: 'waste', index: i });
  });
  FOUNDATIONS.forEach((f, fi) =>
    s.found[fi].forEach((c, i) => out.set(c.id, { x: L.slot[f].x, y: L.slot[f].y, z: 200 + i, pile: f, index: i })),
  );
  TABLEAU.forEach((t, ti) => {
    let y = L.slot[t].y;
    s.tab[ti].forEach((c, i) => {
      out.set(c.id, { x: L.slot[t].x, y, z: 300 + i, pile: t, index: i });
      y += c.up ? L.offs[ti].up : L.offs[ti].down;
    });
  });
  return out;
}

type Point = { x: number; y: number };
/** Inverse of the projective map that takes the stage's unit square to its on-screen corners (the laptop screen is a 3D plane). */
function toLocal(p: Point, q: [Point, Point, Point, Point], w: number, h: number): Point | null {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, hh: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x;
    d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y;
    g = 0; hh = 0;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y; f = p0.y;
  }
  // Solve [a b c; d e f; g h 1] * (u, v, 1) ~ (x, y, 1) for u, v.
  const A = a - g * p.x, B = b - hh * p.x, C = p.x - c;
  const D = d - g * p.y, E = e - hh * p.y, F = p.y - f;
  const det = A * E - B * D;
  if (Math.abs(det) < 1e-12) return null;
  const u = (C * E - B * F) / det;
  const v = (A * F - C * D) / det;
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u * w, y: v * h } : null;
}

type Press = { pid: number; pile: Pile; index: number; start: Point; at: number; moved: boolean; quad: [Point, Point, Point, Point] };
type Drag = { ids: number[]; dx: number; dy: number };
type Bounce = { card: Card; x: number; y: number; vx: number; vy: number };

function Play() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const fx = useCanvas();
  const corners = useRef<(HTMLDivElement | null)[]>([]);
  const [drawSetting] = useSetting(DRAW);
  const localDraw: Draw = drawSetting === '3' ? 3 : 1;
  const [s, setS] = useState<State | null>(() => (online && !online.isHost ? null : deal(randomSeed(), localDraw)));
  const st = useRef<State | null>(s);
  st.current = s;
  const elapsed = useRef(0);
  const [sec, setSec] = useState(0);
  const lastNow = useRef<number | null>(null);
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [fly, setFly] = useState<Set<number>>(new Set());
  const [nope, setNope] = useState<number | null>(null);
  const lastTap = useRef<{ id: number; at: number } | null>(null);
  const phase = useRef<'play' | 'auto' | 'cascade' | 'done'>('play');
  const [, setPhaseView] = useState('play');
  const autoAcc = useRef(0);
  const cascade = useRef<{ queue: Card[]; live: Bounce[]; t: number; next: number; from: Map<number, Pos> } | null>(null);
  const timers = useRef<number[]>([]);
  const result = useRef<ReturnType<typeof finalScore> | null>(null);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    lastNow.current = null;
  }, [shell.status, shell.active]);
  const { setScore } = shell;
  useEffect(() => {
    setScore(0);
  }, [setScore]);

  // Online: the host deals and shares the seed, so everyone in the round plays the same cards.
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const isOnline = !!online;
  const isHost = !!online?.isHost;
  useEffect(() => {
    const room = onlineRef.current;
    if (!room) return;
    const off = room.onMessage((from, d) => {
      const cur = st.current;
      if (room.isHost) {
        if (isDealRequest(d) && cur) room.send({ t: 'deal', seed: cur.seed, draw: cur.draw }, { to: from });
        return;
      }
      const m = parseDeal(d);
      const had = st.current;
      if (m && from === 0 && (!had || had.seed !== m.seed || had.draw !== m.draw)) {
        const next = deal(m.seed, m.draw);
        st.current = next;
        elapsed.current = 0;
        setSec(0);
        setS(next);
      }
    });
    let ask = 0;
    if (room.isHost && st.current) room.send({ t: 'deal', seed: st.current.seed, draw: st.current.draw });
    else if (!room.isHost) {
      // A guest never plays its own shuffle; it waits for the host's seed.
      if (st.current) {
        st.current = null;
        setS(null);
      }
      room.send({ t: 'deal?' }, { to: 0 });
      ask = window.setInterval(() => {
        if (!st.current) onlineRef.current?.send({ t: 'deal?' }, { to: 0 });
        else window.clearInterval(ask);
      }, 1500);
    }
    return () => {
      off();
      window.clearInterval(ask);
    };
  }, [isOnline, isHost]);

  // Play mounts behind the Start card, so a draw picked there redeals the untouched shuffle before the first move.
  useEffect(() => {
    const cur = st.current;
    const room = onlineRef.current;
    if (shell.status !== 'ready' || !cur || (room && !room.isHost)) return;
    const next = redealFor(cur, localDraw);
    if (!next) return;
    st.current = next;
    setS(next);
    room?.send({ t: 'deal', seed: next.seed, draw: next.draw });
  }, [shell.status, localDraw, s]);

  const L = s ? layout(size.w, size.h, s, shell.touch) : null;
  const playing = shell.status === 'playing';

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
  };

  const commit = (next: State, ids: number[], sound: 'place' | 'home' | 'draw' | 'undo' = 'place') => {
    setS(next);
    st.current = next;
    setScore(score(next));
    if (ids.length) {
      setFly(new Set(ids));
      later(() => setFly(new Set()), 260);
    }
    if (sound === 'home') {
      const top = ids.length ? next.found.find((f) => f.some((c) => c.id === ids[0])) : undefined;
      sfx.tone({ freq: 520 + (top?.length ?? 1) * 45, to: 700 + (top?.length ?? 1) * 50, dur: 0.08, type: 'triangle', vol: 0.12 });
    } else if (sound === 'draw') sfx.noise(0.05, 0.08);
    else if (sound === 'undo') sfx.tone({ freq: 420, to: 300, dur: 0.07, type: 'sine', vol: 0.1 });
    else sfx.tone({ freq: 300, to: 220, dur: 0.05, type: 'triangle', vol: 0.12 });
    if (isWon(next)) beginWin(next);
    else if (canAutoFinish(next) && phase.current === 'play') {
      phase.current = 'auto';
      autoAcc.current = -0.25;
      setPhaseView('auto');
    }
  };

  const beginWin = (won: State) => {
    if (phase.current === 'cascade' || phase.current === 'done') return;
    result.current = finalScore(won, elapsed.current);
    phase.current = 'cascade';
    setPhaseView('cascade');
    sfx.play('win');
    const queue: Card[] = [];
    for (let r = 12; r >= 0; r--) for (let f = 0; f < 4; f++) if (won.found[f][r]) queue.push(won.found[f][r]);
    const from = new Map<number, Pos>();
    if (L) FOUNDATIONS.forEach((f, i) => won.found[i].forEach((c) => from.set(c.id, L.slot[f])));
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    cascade.current = { queue: reduce ? [] : queue, live: [], t: reduce ? 4 : 0, next: 0.35, from };
    const c = fx.ctx();
    c?.clearRect(0, 0, fx.size.w, fx.size.h);
  };

  const finish = (reason: 'won' | 'time' | 'quit') => {
    if (phase.current === 'done') return;
    phase.current = 'done';
    setPhaseView('done');
    const cur = st.current;
    if (!cur) return;
    const r = result.current ?? finalScore(cur, elapsed.current);
    const found = cur.found.reduce((n, f) => n + f.length, 0);
    if (reason === 'won') {
      shell.gameOver(r.total, { title: 'You Win', detail: `Cleared in ${clock(elapsed.current)}. Time bonus ${r.time.toLocaleString('en-US')}.` });
    } else {
      if (reason === 'time') sfx.play('lose');
      shell.gameOver(r.total, { title: reason === 'time' ? 'Time Is Up' : 'Game Over', detail: `${found} of 52 cards home in ${clock(elapsed.current)}.` });
    }
  };

  const tryMove = (from: Pile, index: number, to: Pile | null, ids: number[]) => {
    const cur = st.current;
    if (!cur || !to) return false;
    const next = move(cur, from, index, to);
    if (!next) return false;
    commit(next, ids, to.startsWith('f') ? 'home' : 'place');
    return true;
  };

  const shake = (id: number) => {
    setNope(id);
    sfx.tone({ freq: 160, to: 120, dur: 0.08, type: 'square', vol: 0.05 });
    later(() => setNope((n) => (n === id ? null : n)), 320);
  };

  const idsFrom = (cur: State, pile: Pile, index: number) => pileCards(cur, pile).slice(index).map((c) => c.id);

  const tap = (pile: Pile, index: number) => {
    const cur = st.current;
    if (!cur) return;
    const cards = pileCards(cur, pile);
    const card = cards[index];
    if (!card) return;
    const now = performance.now();
    const again = lastTap.current && lastTap.current.id === card.id && now - lastTap.current.at < 380;
    lastTap.current = { id: card.id, at: now };
    const ids = idsFrom(cur, pile, index);
    if (again) {
      if (!tryMove(pile, index, foundationFor(cur, pile, index), ids)) lastTap.current = null;
      return;
    }
    if (!tryMove(pile, index, bestMove(cur, pile, index), ids)) shake(card.id);
  };

  const drawCard = () => {
    const cur = st.current;
    if (!cur || phase.current !== 'play') return;
    const next = drawStock(cur);
    if (!next) return;
    commit(next, next.waste.slice(-next.fan).map((c) => c.id), 'draw');
  };

  const doUndo = () => {
    const cur = st.current;
    if (!cur || phase.current !== 'play' || shell.status !== 'playing') return;
    const next = undo(cur);
    if (next) commit(next, [], 'undo');
  };

  /** A column's play from the keyboard: home first, then the longest run that fits somewhere. */
  const playColumn = (pile: Pile) => {
    const cur = st.current;
    if (!cur) return;
    const cards = pileCards(cur, pile);
    if (!cards.length) return;
    const topI = cards.length - 1;
    const home = foundationFor(cur, pile, topI);
    if (home) return void tryMove(pile, topI, home, [cards[topI].id]);
    for (let i = 0; i < cards.length; i++) {
      if (!cards[i].up) continue;
      const to = bestMove(cur, pile, i);
      if (to && tryMove(pile, i, to, idsFrom(cur, pile, i))) return;
    }
    shake(cards[topI].id);
  };

  useKeys((code, e) => {
    if (e?.repeat || phase.current !== 'play' || !st.current) return;
    const k = shortcut(code);
    if (k?.t === 'column') playColumn(TABLEAU[k.col]);
    else if (k?.t === 'waste') {
      const w = st.current.waste;
      if (w.length) tap('waste', w.length - 1);
    } else if (k?.t === 'draw') drawCard();
    else if (k?.t === 'undo') doUndo();
  });

  /**
   * A clicked button keeps focus, and the shell lets Space and Enter through to a focused button, so they would
   * click it again instead of drawing. A pointer click hands focus back to the game (a disabled button drops it).
   */
  const clicked = (fn: () => void) => (e: RMouseEvent<HTMLButtonElement>) => {
    fn();
    if (e.detail > 0) shell.root.current?.focus({ preventScroll: true });
  };

  useGameLoop((dt0) => {
    const now = performance.now();
    const dt = lastNow.current === null ? 0 : Math.min(0.25, (now - lastNow.current) / 1000);
    lastNow.current = now;
    const cur = st.current;
    if (!cur) return;
    if (phase.current === 'play') {
      elapsed.current += dt;
      const sNow = Math.floor(elapsed.current);
      if (sNow !== sec) setSec(sNow);
      if (elapsed.current >= TIME_LIMIT) finish('time');
    } else if (phase.current === 'auto') {
      autoAcc.current += dt;
      if (autoAcc.current >= 0.085) {
        autoAcc.current = 0;
        const step = autoStep(cur);
        if (step) commit(step.state, [pileCards(step.state, step.to).at(-1)!.id], 'home');
        else if (!isWon(cur)) {
          phase.current = 'play';
          setPhaseView('play');
        }
      }
    } else if (phase.current === 'cascade' && cascade.current && L) {
      const k = cascade.current;
      k.t += dt0;
      k.next -= dt0;
      if (k.next <= 0 && k.queue.length) {
        k.next = 0.075;
        const card = k.queue.shift()!;
        const p = k.from.get(card.id) ?? L.slot.f0;
        const dir = Math.random() < 0.5 ? -1 : 1;
        k.live.push({ card, x: p.x, y: p.y, vx: dir * (L.cw * (2 + Math.random() * 3.2)), vy: -L.ch * (Math.random() * 2.4) });
      }
      const gravity = L.ch * 16;
      const floor = size.h - L.ch;
      const c = fx.ctx();
      for (const b of k.live) {
        b.vy += gravity * dt0;
        b.x += b.vx * dt0;
        b.y += b.vy * dt0;
        if (b.y > floor) {
          b.y = floor;
          b.vy = -Math.abs(b.vy) * 0.72;
        }
        if (c) paintCard(c, b.card, b.x, b.y, L.cw, L.ch);
      }
      k.live = k.live.filter((b) => b.x > -L.cw && b.x < size.w);
      if ((!k.queue.length && !k.live.length) || k.t > 6.5) finish('won');
    }
  });

  const local = (e: { clientX: number; clientY: number }, quad?: Press['quad']): Point | null => {
    const q = quad ?? readQuad();
    return q ? toLocal({ x: e.clientX, y: e.clientY }, q, size.w, size.h) : null;
  };
  const readQuad = (): Press['quad'] | null => {
    if (corners.current.length !== 4 || corners.current.some((el) => !el)) return null;
    return corners.current.map((el) => {
      const r = el!.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }) as Press['quad'];
  };

  const dropTarget = (cur: State, from: Pile, index: number, d: Drag): Pile | null => {
    if (!L) return null;
    const placed = placeCards(cur, L);
    const p = placed.get(d.ids[0]);
    if (!p) return null;
    const cx = p.x + d.dx;
    const cy = p.y + d.dy;
    let best: Pile | null = null;
    let bestArea = 0;
    for (const pile of [...FOUNDATIONS, ...TABLEAU]) {
      if (pile === from || !canMove(cur, from, index, pile)) continue;
      const base = L.slot[pile];
      const cards = pileCards(cur, pile);
      const last = cards.length ? placed.get(cards[cards.length - 1].id)! : base;
      const x0 = base.x - 4, x1 = base.x + L.cw + 4;
      const y0 = base.y - 6, y1 = (pile.startsWith('t') ? Math.max(last.y, base.y) : base.y) + L.ch + (pile.startsWith('t') ? L.ch * 0.6 : 6);
      const ox = Math.max(0, Math.min(cx + L.cw, x1) - Math.max(cx, x0));
      const oy = Math.max(0, Math.min(cy + L.ch, y1) - Math.max(cy, y0));
      if (ox * oy > bestArea) {
        bestArea = ox * oy;
        best = pile;
      }
    }
    return best;
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!playing || !shell.active || !e.isPrimary || e.button !== 0 || phase.current !== 'play' || !st.current || press.current) return;
    sfx.unlock();
    const el = (e.target as Element).closest<HTMLElement>('[data-pile]');
    if (!el) return;
    const pile = el.dataset.pile as Pile;
    const index = Number(el.dataset.index ?? -1);
    if (pile === 'stock') {
      e.preventDefault();
      drawCard();
      return;
    }
    const cur = st.current;
    const card = pileCards(cur, pile)[index];
    if (!card || !card.up) return;
    // Waste and foundations only give up their top card; a tableau run must be in sequence to lift.
    if (pile === 'waste' || pile.startsWith('f')) {
      if (index !== pileCards(cur, pile).length - 1) return;
    }
    const quad = readQuad();
    if (!quad) return;
    const start = local(e, quad);
    if (!start) return;
    e.preventDefault();
    press.current = { pid: e.pointerId, pile, index, start, at: performance.now(), moved: false, quad };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      press.current = null;
    }
  };
  const movable = (cur: State, pile: Pile, index: number) => {
    if (!pile.startsWith('t')) return true;
    const run = pileCards(cur, pile).slice(index);
    return run.every((c, i) => c.up && (i === 0 || (c.rank === run[i - 1].rank - 1 && isRed(c) !== isRed(run[i - 1]))));
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    const cur = st.current;
    if (!p || p.pid !== e.pointerId || !cur) return;
    const at = local(e, p.quad);
    if (!at) return;
    const dx = at.x - p.start.x;
    const dy = at.y - p.start.y;
    if (!p.moved && Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 4 : 8)) return;
    if (!p.moved) {
      if (!movable(cur, p.pile, p.index)) return;
      p.moved = true;
    }
    dragRef.current = { ids: idsFrom(cur, p.pile, p.index), dx, dy };
    setDrag(dragRef.current);
  };
  const endPress = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = press.current;
    if (!p || p.pid !== e.pointerId) return;
    press.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const cur = st.current;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!cur || cancelled) return;
    if (!p.moved) {
      tap(p.pile, p.index);
      return;
    }
    const at = local(e, p.quad);
    const final = d && at ? { ...d, dx: at.x - p.start.x, dy: at.y - p.start.y } : d;
    if (!final) return;
    const to = dropTarget(cur, p.pile, p.index, final);
    if (!tryMove(p.pile, p.index, to, final.ids)) sfx.tone({ freq: 240, to: 200, dur: 0.05, type: 'triangle', vol: 0.06 });
  };
  useEffect(() => {
    if (!playing || !shell.active) {
      press.current = null;
      dragRef.current = null;
      setDrag(null);
    }
  }, [playing, shell.active]);

  const placed = s && L ? placeCards(s, L) : null;
  const vars = L ? ({ '--cw': `${L.cw}px`, '--ch': `${L.ch}px` } as CSSProperties) : undefined;
  const stuck = !!s && phase.current === 'play' && !hasMoves(s);
  const left = TIME_LIMIT - sec;
  const dragSet = drag ? new Set(drag.ids) : null;

  return (
    <div
      ref={ref}
      className={`g-solitaire-stage${L?.side ? ' is-side' : ''}${L?.low ? ' is-low' : ''}${shell.touch ? ' is-touch' : ''}${online ? ' is-online' : ''}${drag ? ' is-dragging' : ''}`}
      style={vars}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => endPress(e, false)}
      onPointerCancel={(e) => endPress(e, true)}
      onLostPointerCapture={(e) => endPress(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`g-solitaire-corner is-c${i}`} ref={(el) => void (corners.current[i] = el)} />
      ))}
      <div className="g-solitaire-hud">
        {/* Online, the shell's connection badge sits at the top center, so the HUD parts around it. */}
        <span className="g-solitaire-hud-l">
          <span className={`g-solitaire-time${left <= 60 ? ' is-late' : ''}`} aria-label={`Time ${clock(sec)}`}>
            {clock(sec)}
          </span>
          {s && <span className="g-solitaire-mode">Draw {s.draw}</span>}
        </span>
        <button type="button" className="g-solitaire-btn" disabled={!s?.history.length || phase.current !== 'play'} onClick={clicked(doUndo)}>
          Undo
        </button>
      </div>
      {s && L && placed && (
        <>
          {ALL_PILES.map((pile) => {
            const p = L.slot[pile];
            const isF = pile.startsWith('f');
            const empty = pile === 'stock' && !s.stock.length;
            return (
              <div
                key={pile}
                data-pile={pile === 'stock' ? 'stock' : undefined}
                className={`g-solitaire-slot is-${pile === 'stock' ? 'stock' : pile === 'waste' ? 'waste' : isF ? 'found' : 'tab'}`}
                style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              >
                {isF && <span>A</span>}
                {empty && s.waste.length > 0 && (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
          {[...placed.entries()].map(([id, p]) => {
            const card = pileCards(s, p.pile)[p.index];
            const lifted = dragSet?.has(id);
            const x = p.x + (lifted ? drag!.dx : 0);
            const y = p.y + (lifted ? drag!.dy : 0);
            const z = lifted ? 2000 + p.index : fly.has(id) ? 1000 + p.z : p.z;
            return (
              <CardView
                key={id}
                card={card}
                pile={p.pile}
                index={p.index}
                className={`${lifted ? 'is-lifted' : ''}${fly.has(id) ? ' is-fly' : ''}${nope === id ? ' is-nope' : ''}`}
                style={{ transform: `translate(${x}px, ${y}px)`, zIndex: z }}
              />
            );
          })}
        </>
      )}
      {!s && <div className="g-solitaire-wait">Shuffling</div>}
      {stuck && playing && (
        <div className="g-solitaire-toast" role="status">
          <span>No moves left</span>
          {s?.history.length ? (
            <button type="button" className="g-solitaire-btn" onClick={clicked(doUndo)}>
              Undo
            </button>
          ) : null}
          <button type="button" className="g-solitaire-btn is-primary" onClick={() => finish('quit')}>
            End Game
          </button>
        </div>
      )}
      <canvas
        ref={fx.ref}
        className={`g-solitaire-fx${phase.current === 'cascade' ? ' is-on' : ''}`}
        onPointerDown={() => phase.current === 'cascade' && finish('won')}
      />
      <p className="g-solitaire-sr" aria-live="polite">
        {s?.waste.length ? `Waste ${cardName(s.waste[s.waste.length - 1])}` : ''}
      </p>
    </div>
  );
}

function CardView({ card, pile, index, className, style }: { card: Card; pile: Pile; index: number; className: string; style: CSSProperties }) {
  const face = card.rank > 10;
  return (
    <div
      data-pile={pile}
      data-index={index}
      className={`g-solitaire-card${card.up ? ' is-up' : ''}${isRed(card) ? ' is-red' : ''} ${className}`}
      style={style}
      aria-label={card.up ? cardName(card) : 'Face Down Card'}
    >
      {card.up ? (
        <div className="g-solitaire-face" key="up">
          <span className="g-solitaire-rank">{rankLabel(card.rank)}</span>
          <SuitIcon suit={card.suit} className="g-solitaire-csuit" />
          {face ? (
            <span className="g-solitaire-court">
              <b>{rankLabel(card.rank)}</b>
              <SuitIcon suit={card.suit} />
            </span>
          ) : (
            <SuitIcon suit={card.suit} className={`g-solitaire-pip${card.rank === 1 ? ' is-ace' : ''}`} />
          )}
        </div>
      ) : (
        <div className="g-solitaire-back" key="down" />
      )}
    </div>
  );
}

const SuitIcon = ({ suit, className }: { suit: Suit; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={suitPath[suit]} fill="currentColor" />
  </svg>
);

const paths = new Map<Suit, Path2D>();
function paintCard(c: CanvasRenderingContext2D, card: Card, x: number, y: number, cw: number, ch: number) {
  const red = isRed(card);
  c.fillStyle = '#fdfcf8';
  c.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(x, y, cw, ch, cw * 0.08);
  c.fill();
  c.stroke();
  const ink = red ? '#d1262f' : '#1b1d22';
  c.fillStyle = ink;
  c.font = `700 ${Math.round(cw * 0.34)}px -apple-system, system-ui, sans-serif`;
  c.textBaseline = 'top';
  c.fillText(rankLabel(card.rank), x + cw * 0.08, y + cw * 0.07);
  let p = paths.get(card.suit);
  if (!p && typeof Path2D !== 'undefined') {
    p = new Path2D(suitPath[card.suit]);
    paths.set(card.suit, p);
  }
  if (!p) return;
  const draw = (px: number, py: number, s: number) => {
    c.save();
    c.translate(px, py);
    c.scale(s / 24, s / 24);
    c.fill(p!);
    c.restore();
  };
  draw(x + cw * 0.66, y + cw * 0.08, cw * 0.26);
  draw(x + cw * 0.22, y + ch * 0.38, cw * 0.56);
}
