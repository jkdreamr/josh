import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  FIVE_CARDS,
  LANES,
  MAX_BUSTS,
  POINTS,
  ROUND_SECONDS,
  breakdown,
  cardsLeft,
  createGame,
  currentCard,
  isRed,
  laneTotal,
  mulberry32,
  play,
  preview,
  rankLabel,
  tick,
  upcomingCard,
  type Breakdown,
  type Card,
  type PlayKind,
  type PlayResult,
  type State,
  type Suit,
} from './logic';
import { meta } from './meta';
import './blitz-21.css';

const suitPath: Record<Suit, string> = {
  hearts: 'M12 21.2C6.4 17.1 2 13.4 2 8.7 2 5.6 4.4 3.2 7.3 3.2c2 0 3.6 1 4.7 2.7 1.1-1.7 2.7-2.7 4.7-2.7 2.9 0 5.3 2.4 5.3 5.5 0 4.7-4.4 8.4-10 12.5z',
  diamonds: 'M12 2.2l7.6 9.8L12 21.8 4.4 12z',
  spades: 'M12 2.4C7.6 6.6 3.4 9.6 3.4 13.6c0 2.7 2.1 4.6 4.5 4.6 1.3 0 2.4-.5 3.2-1.4-.3 1.9-1 3.2-2.2 4.4h6.2c-1.2-1.2-1.9-2.5-2.2-4.4.8.9 1.9 1.4 3.2 1.4 2.4 0 4.5-1.9 4.5-4.6 0-4-4.2-7-8.6-11.2z',
  clubs: 'M12 2.6a4.4 4.4 0 0 0-3.6 6.9 4.4 4.4 0 1 0 2.6 7.3c-.3 1.9-1 3.2-2.2 4.4h6.4c-1.2-1.2-1.9-2.5-2.2-4.4a4.4 4.4 0 1 0 2.6-7.3A4.4 4.4 0 0 0 12 2.6z',
};
const suitName: Record<Suit, string> = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs' };
const rankName = (r: number) => (r === 1 ? 'Ace' : r === 11 ? 'Jack' : r === 12 ? 'Queen' : r === 13 ? 'King' : String(r));
const cardName = (c: Card) => `${rankName(c.rank)} of ${suitName[c.suit]}`;
const clock = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const num = (n: number) => n.toLocaleString('en-US');

type Ghost = { id: number; lane: number; kind: 'clear' | 'bust'; cards: Card[] };
type Floater = { id: number; lane: number; kind: 'clear' | 'bust'; title: string; points: number; streak: number };
type Summary = Breakdown;

export default function Game({ compact, onExit }: GameProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} setup={summary ? <Results b={summary} /> : undefined}>
      <Table onSummary={setSummary} />
    </GameShell>
  );
}

/** Every online round gets a fresh table, so a player who joins from the Start card never keeps a lobby deal. */
function Table({ onSummary }: { onSummary: (s: Summary | null) => void }) {
  const online = useOnline();
  return <Play key={online ? `round-${online.round}` : 'solo'} onSummary={onSummary} />;
}

function Results({ b }: { b: Breakdown }) {
  const rows: [string, string, number][] = [[`Clears ${b.clears} × ${POINTS.clear}`, '', b.clearPoints]];
  if (b.fiveCards) rows.push([`Five Card ${b.fiveCards} × ${POINTS.fiveCard}`, '', b.fivePoints]);
  if (b.blackjacks) rows.push([`Blackjack ${b.blackjacks} × ${POINTS.blackjack}`, '', b.blackjackPoints]);
  if (b.streakPoints) rows.push([`Streaks, Best ${b.bestStreak}`, '', b.streakPoints]);
  rows.push(['Time Bonus', '', b.timeBonus]);
  if (b.cleanBonus) rows.push(['No Busts', '', b.cleanBonus]);
  return (
    <div className="g-blitz-21-results">
      {rows.map(([label, , pts]) => (
        <div key={label} className={pts ? '' : 'is-zero'}>
          <span>{label}</span>
          <b>{num(pts)}</b>
        </div>
      ))}
      <div className="is-busts">
        <span>Busts</span>
        <b>
          {b.busts} of {MAX_BUSTS}
        </b>
      </div>
    </div>
  );
}

function CardFace({ card, className = '', style, id }: { card: Card; className?: string; style?: CSSProperties; id?: number }) {
  const face = card.rank > 10;
  return (
    <div className={`g-blitz-21-card ${isRed(card) ? 'is-red' : ''} ${className}`} style={style} data-card={id} aria-hidden="true">
      <span className="g-blitz-21-corner">
        <b>{rankLabel(card.rank)}</b>
        <Suit suit={card.suit} />
      </span>
      {face ? (
        <span className="g-blitz-21-court">
          <b>{rankLabel(card.rank)}</b>
          <Suit suit={card.suit} />
        </span>
      ) : (
        <span className="g-blitz-21-pip">
          <Suit suit={card.suit} />
        </span>
      )}
      <span className="g-blitz-21-corner is-low">
        <b>{rankLabel(card.rank)}</b>
        <Suit suit={card.suit} />
      </span>
    </div>
  );
}

const Suit = ({ suit }: { suit: Suit }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={suitPath[suit]} fill="currentColor" />
  </svg>
);

function totalLabel(cards: Card[], tight: boolean) {
  if (!cards.length) return '0';
  const t = laneTotal(cards);
  if (t.soft === null) return String(t.hard);
  return tight ? `${t.hard}/${t.soft}` : `${t.hard} or ${t.soft}`;
}

/** What a column would become with the card on it, for the hover and keyboard preview. */
function hintFor(cards: Card[], card: Card): { kind: PlayKind; text: string } {
  const kind = preview(cards, card);
  const t = laneTotal([...cards, card]);
  if (kind === 'bust') return { kind, text: 'Bust' };
  if (kind === 'clear') return { kind, text: t.best === 21 ? '21' : 'Five Card' };
  return { kind, text: String(t.best) };
}

// A column fans up to four cards; the fifth always clears it.
const FAN_MIN = 0.27;
const FAN_MAX = 0.42;
const SHORT_HUD = 92;
const stackH = (fan: number) => 1.4 * (1 + fan * (FIVE_CARDS - 2));

const TOUCH_TOP = 60;

function layout(w: number, h: number, top = 44) {
  const wide = w >= h * 1.12;
  // Short windows (the framed laptop) put the HUD in its own column beside the deck, clear of the shell's top bar.
  const short = wide && h < 330;
  let cw: number;
  let room: number;
  if (short) {
    room = h - top - 6 - 30;
    const byW = (w - 24 - SHORT_HUD - 2 * 14 - 3 * 8) / (LANES * 1.16 + 1.75);
    const byDealer = (h - top - 6 - 20) / 1.54;
    cw = Math.min(byW, room / stackH(FAN_MIN), byDealer);
  } else if (wide) {
    room = h - 56 - 46 - 14;
    const byW = (w - 40 - 18 - 3 * 10) / (LANES * 1.16 + 1.8);
    // The dealer column stacks the HUD above the current card.
    const byDealer = (h - 60 - 110) / 1.54;
    cw = Math.min(byW, room / stackH(FAN_MIN), byDealer);
  } else {
    const byW = (w - 24 - 3 * 8) / (LANES * 1.16);
    const byH = (h - 56 - 40 - 46 - 24 - 28) / (stackH(FAN_MIN) + 1.4 * 0.95);
    cw = Math.min(byW, byH);
    room = h - 56 - 40 - 46 - 24 - 28 - Math.floor(cw) * 1.33;
  }
  cw = Math.max(short ? 26 : 30, Math.min(150, Math.floor(cw)));
  const ch = Math.round(cw * 1.4);
  // Height left over in a column goes to a wider fan, so more of each card shows.
  const fan = Math.max(FAN_MIN, Math.min(FAN_MAX, (room / ch - 1) / (FIVE_CARDS - 2)));
  const slotH = Math.ceil(ch * (1 + fan * (FIVE_CARDS - 2)));
  return { wide, short, cw, ch, fan, slotH, laneH: slotH + (short ? 30 : 46), tight: cw * 1.16 < 60 };
}

type Deal = { t: 'deal'; seed: number };
const parseDeal = (d: unknown): Deal | null => {
  const m = d as { t?: unknown; seed?: unknown } | null;
  return m && m.t === 'deal' && Number.isInteger(m.seed) && (m.seed as number) >= 0 && (m.seed as number) < 2 ** 32 ? { t: 'deal', seed: m.seed as number } : null;
};
const isDealAsk = (d: unknown) => !!d && typeof d === 'object' && (d as { t?: unknown }).t === 'deal?';
const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
const dealFrom = (seed: number) => createGame(mulberry32(seed));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function Play({ onSummary }: { onSummary: (s: Summary | null) => void }) {
  const shell = useShell();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const board = useRef<HTMLDivElement | null>(null);
  // Online, the host shuffles and everyone in the race plays the same deck. A guest waits for it.
  const seed = useRef(randomSeed());
  const st = useRef<State | null>(online && !online.isHost ? null : dealFrom(seed.current));
  const [, render] = useReducer((n: number) => n + 1, 0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const fxId = useRef(0);
  const lastNow = useRef<number | null>(null);
  const shownSecond = useRef(Math.ceil(ROUND_SECONDS));
  const endDelay = useRef<number | null>(null);
  const flight = useRef<{ id: number; from: DOMRect } | null>(null);

  useEffect(() => onSummary(null), [onSummary]);
  useEffect(() => {
    lastNow.current = null;
  }, [shell.status, shell.active]);
  const { setScore } = shell;
  useEffect(() => {
    setScore(0);
  }, [setScore]);

  const onlineRef = useRef(online);
  onlineRef.current = online;
  const isOnline = !!online;
  const isHost = !!online?.isHost;
  useEffect(() => {
    const room = onlineRef.current;
    if (!room) return;
    const off = room.onMessage((from, d) => {
      if (room.isHost) {
        if (isDealAsk(d)) room.send({ t: 'deal', seed: seed.current }, { to: from });
        return;
      }
      const m = parseDeal(d);
      const cur = st.current;
      if (!m || from !== 0 || (cur && (cur.tally.placed > 0 || seed.current === m.seed))) return;
      seed.current = m.seed;
      st.current = dealFrom(m.seed);
      render();
    });
    if (room.isHost) {
      room.send({ t: 'deal', seed: seed.current });
      return off;
    }
    room.send({ t: 'deal?' }, { to: 0 });
    const ask = window.setInterval(() => {
      if (!st.current) onlineRef.current?.send({ t: 'deal?' }, { to: 0 });
    }, 1200);
    // If the host never answers, play a shuffle of our own rather than sit at an empty table.
    const fallback = window.setTimeout(() => {
      if (st.current) return;
      st.current = dealFrom(seed.current);
      render();
    }, 5000);
    return () => {
      off();
      window.clearInterval(ask);
      window.clearTimeout(fallback);
    };
  }, [isOnline, isHost]);

  // A phone or iPad frame scales the game down; text and touch targets grow by the inverse so they stay full size.
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = shell.touch && k > 0.3 && k < 0.98 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
        el.style.setProperty('--g-blitz-21-u', String(u));
      });
    };
    measure();
    const late = window.setTimeout(measure, 700);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-blitz-21-u');
    };
  }, [shell.root, shell.touch, shell.status]);

  // The placed card flies from the deck to its column.
  useLayoutEffect(() => {
    const f = flight.current;
    const root = ref.current;
    flight.current = null;
    if (!f || !root) return;
    const el = root.querySelector<HTMLElement>(`[data-card="${f.id}"]`);
    if (!el?.animate) return;
    const to = el.getBoundingClientRect();
    const k = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    if (!to.width || !k) return;
    const dx = (f.from.left - to.left) / k;
    const dy = (f.from.top - to.top) / k;
    const sc = f.from.width / to.width;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, transformOrigin: '0 0', zIndex: 6 },
        { transform: 'translate(0, 0) scale(1)', transformOrigin: '0 0', zIndex: 6 },
      ],
      { duration: 190, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    );
  });

  const finish = () => {
    const s = st.current;
    if (!s) return;
    const b = breakdown(s);
    onSummary(b);
    const title = s.over === 'deck' ? 'Deck Cleared' : s.over === 'time' ? 'Time Is Up' : 'Three Busts';
    const detail =
      s.over === 'deck'
        ? `All 52 cards played with ${clock(s.timeLeft)} left.`
        : s.over === 'time'
          ? `${cardsLeft(s)} cards were still in the deck.`
          : `${s.tally.placed} cards played before the third bust.`;
    sfx.play(s.over === 'deck' ? 'win' : 'lose');
    shell.gameOver(b.total, { title, detail });
  };

  const feedback = (r: PlayResult) => {
    if (r.kind === 'place') {
      sfx.tone({ freq: 340 + r.cards.length * 70, to: 260 + r.cards.length * 60, dur: 0.06, type: 'triangle', vol: 0.14 });
      return;
    }
    const id = ++fxId.current;
    setGhosts((g) => [...g.filter((x) => x.lane !== r.lane), { id, lane: r.lane, kind: r.kind as 'clear' | 'bust', cards: r.cards }]);
    if (r.kind === 'bust') {
      setFloaters((f) => [...f.filter((x) => x.lane !== r.lane), { id, lane: r.lane, kind: 'bust', title: 'Bust', points: 0, streak: 0 }]);
      sfx.play('hit');
      sfx.noise(0.14, 0.16);
      board.current?.animate?.(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
        { duration: 300, easing: 'ease-out' },
      );
      return;
    }
    const title = r.blackjack ? 'Blackjack' : r.fiveCard && r.total !== 21 ? 'Five Card' : r.fiveCard ? 'Five Card 21' : '21';
    setFloaters((f) => [...f.filter((x) => x.lane !== r.lane), { id, lane: r.lane, kind: 'clear', title, points: r.points, streak: r.streak }]);
    const pitch = 1 + Math.min(6, r.streak - 1) * 0.08;
    sfx.play('coin', pitch);
    if (r.fiveCard || r.blackjack) sfx.tone({ freq: 1568 * pitch, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.14 });
  };

  const place = (lane: number) => {
    const cur = st.current;
    if (shell.status !== 'playing' || !cur) return;
    const out = play(cur, lane);
    if (!out) return;
    const from = ref.current?.querySelector('.g-blitz-21-current .g-blitz-21-card');
    flight.current = from && !reducedMotion() ? { id: out.result.card.id, from: from.getBoundingClientRect() } : null;
    st.current = out.state;
    feedback(out.result);
    shell.setScore(out.state.score);
    if (out.state.over) endDelay.current = 0.75;
    render();
  };

  useKeys((code, e) => {
    if (e?.repeat) return;
    const digit = /^(Digit|Numpad)([1-4])$/.exec(code);
    if (digit) {
      const lane = Number(digit[2]) - 1;
      setCursor(lane);
      place(lane);
    } else if (code === 'ArrowLeft' || code === 'KeyA') setCursor((c) => (c === null ? 0 : (c + LANES - 1) % LANES));
    else if (code === 'ArrowRight' || code === 'KeyD') setCursor((c) => (c === null ? 0 : (c + 1) % LANES));
    else if (code === 'Space' || code === 'Enter' || code === 'ArrowDown' || code === 'KeyS') {
      e?.preventDefault();
      if (cursor === null) setCursor(0);
      else place(cursor);
    }
  });

  useGameLoop(() => {
    const now = performance.now();
    const dt = lastNow.current === null ? 0 : Math.min(0.25, (now - lastNow.current) / 1000);
    lastNow.current = now;
    const before = st.current;
    if (!before) return;
    if (endDelay.current !== null) {
      endDelay.current -= dt;
      if (endDelay.current <= 0) {
        endDelay.current = null;
        finish();
      }
      return;
    }
    st.current = tick(before, dt);
    const sec = Math.ceil(st.current.timeLeft);
    if (sec !== shownSecond.current) {
      shownSecond.current = sec;
      if (sec <= 10 && sec > 0) sfx.play('tick', sec <= 5 ? 1.25 : 1);
      render();
    }
    if (st.current.over && !before.over) {
      endDelay.current = 0.35;
      render();
    }
  });

  const s = st.current;
  // The touch toolbar is taller, so short windows start the columns below it.
  const L = layout(size.w, size.h, shell.touch ? TOUCH_TOP : 44);
  const { wide, short, cw } = L;
  const vars = {
    '--cw0': `${cw}px`,
    '--cw': `${cw}px`,
    '--ch': `${L.ch}px`,
    '--fan': L.fan,
    '--slot-h': `${L.slotH}px`,
    '--lane-h': `${L.laneH}px`,
    ...(short && shell.touch ? { paddingTop: TOUCH_TOP } : {}),
  } as CSSProperties;
  const stageClass = `g-blitz-21-stage ${wide ? 'is-wide' : 'is-tall'}${short ? ' is-short' : ''}`;

  if (!s)
    return (
      <div ref={ref} className={stageClass} style={vars}>
        <p className="g-blitz-21-wait">Shuffling the host's deck</p>
      </div>
    );

  const card = currentCard(s);
  const upcoming = upcomingCard(s);
  const low = s.timeLeft <= 10;
  const aim = hover ?? cursor;

  const hud = (
    <div className="g-blitz-21-hud">
      <div className={`g-blitz-21-time ${low ? 'is-low' : ''}`}>
        <b>{clock(s.timeLeft)}</b>
        <span className="g-blitz-21-bar">
          <i style={{ width: `${(s.timeLeft / ROUND_SECONDS) * 100}%` }} />
        </span>
      </div>
      <div className="g-blitz-21-busts" aria-label={`${s.busts} of ${MAX_BUSTS} busts`}>
        <span>Busts</span>
        {Array.from({ length: MAX_BUSTS }, (_, i) => (
          <i key={i} className={i < s.busts ? 'is-on' : ''} />
        ))}
      </div>
      <div className={`g-blitz-21-streak ${s.streak >= 2 ? 'is-on' : ''}`} key={`streak-${s.streak}`}>
        Streak {s.streak}
      </div>
    </div>
  );

  const dealer = (
    <div className="g-blitz-21-dealer">
      {wide && !short && hud}
      <div className="g-blitz-21-draw">
        <div className="g-blitz-21-current">
          {cardsLeft(s) > 1 && <div className="g-blitz-21-back is-pile" />}
          {card ? <CardFace key={card.id} card={card} className="is-deal" /> : <div className="g-blitz-21-empty" />}
        </div>
        <div className="g-blitz-21-side">
          <div className="g-blitz-21-next">
            <span>Next</span>
            {upcoming ? <CardFace key={upcoming.id} card={upcoming} className="is-small" /> : <div className="g-blitz-21-empty is-small" />}
          </div>
          <span className="g-blitz-21-left">{cardsLeft(s)} Left</span>
        </div>
      </div>
      <p className="g-blitz-21-sr" aria-live="polite">
        {card ? `Current card ${cardName(card)}` : ''}
      </p>
    </div>
  );

  return (
    <div ref={ref} className={stageClass} style={vars}>
      {!wide && hud}
      <div className="g-blitz-21-play">
        {short && hud}
        {wide && dealer}
        <div className="g-blitz-21-lanes" ref={board}>
          {s.lanes.map((cards, i) => {
            const ghost = ghosts.find((g) => g.lane === i);
            const t = laneTotal(cards);
            const hint = aim === i && card && shell.status === 'playing' ? hintFor(cards, card) : null;
            return (
              <div
                key={i}
                role="button"
                aria-label={`Column ${i + 1}, total ${totalLabel(cards, false)}`}
                className={[
                  'g-blitz-21-lane',
                  cursor === i ? 'is-cursor' : '',
                  t.soft !== null ? 'is-soft' : '',
                  hint ? `is-aim is-will-${hint.kind}` : '',
                  ghost ? `is-${ghost.kind}ing` : '',
                ].join(' ')}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setCursor(null);
                  place(i);
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setHover(i);
                }}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="g-blitz-21-total" key={`t-${cards.length}`}>
                  {totalLabel(cards, L.tight)}
                </div>
                <div className="g-blitz-21-slot">
                  {!cards.length && <div className="g-blitz-21-hole" />}
                  {cards.map((c, k) => (
                    <CardFace key={c.id} card={c} id={c.id} style={{ top: `calc(var(--ch) * var(--fan) * ${k})` }} />
                  ))}
                  {ghost && (
                    <div
                      key={ghost.id}
                      className={`g-blitz-21-ghost is-${ghost.kind}`}
                      onAnimationEnd={(e) => {
                        if (e.target === e.currentTarget) setGhosts((g) => g.filter((x) => x.id !== ghost.id));
                      }}
                    >
                      {ghost.cards.map((c, k) => (
                        <CardFace key={c.id} card={c} id={c.id} style={{ top: `calc(var(--ch) * var(--fan) * ${Math.min(k, FIVE_CARDS - 2)})` }} />
                      ))}
                    </div>
                  )}
                  {floaters
                    .filter((f) => f.lane === i)
                    .map((f) => (
                      <div
                        key={f.id}
                        className={`g-blitz-21-float is-${f.kind}`}
                        onAnimationEnd={(e) => {
                          if (e.target === e.currentTarget) setFloaters((all) => all.filter((x) => x.id !== f.id));
                        }}
                      >
                        <b>{f.title}</b>
                        {f.points > 0 && <span>+{num(f.points)}</span>}
                        {f.streak >= 2 && <em>Streak {f.streak}</em>}
                      </div>
                    ))}
                </div>
                {hint && <div className={`g-blitz-21-hint is-${hint.kind}`}>{hint.text}</div>}
                <div className="g-blitz-21-count" aria-hidden="true">
                  {Array.from({ length: FIVE_CARDS }, (_, k) => (
                    <i key={k} className={k < cards.length ? 'is-on' : ''} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!wide && dealer}
    </div>
  );
}
