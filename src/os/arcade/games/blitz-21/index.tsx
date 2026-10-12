import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
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
  play,
  rankLabel,
  tick,
  upcomingCard,
  type Breakdown,
  type Card,
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
      <Play onSummary={setSummary} />
    </GameShell>
  );
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

function CardFace({ card, className = '', style }: { card: Card; className?: string; style?: CSSProperties }) {
  const face = card.rank > 10;
  return (
    <div className={`g-blitz-21-card ${isRed(card) ? 'is-red' : ''} ${className}`} style={style} aria-hidden="true">
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

function totalLabel(cards: Card[]) {
  if (!cards.length) return '0';
  const t = laneTotal(cards);
  return t.soft !== null ? `${t.hard} or ${t.soft}` : String(t.hard);
}

function layout(w: number, h: number) {
  const wide = w >= h * 1.12;
  // Short windows move the HUD into the top bar so the columns get the height.
  const short = wide && h < 330;
  // A column holds up to four fanned cards plus its total and card count.
  const laneH = (cw: number) => cw * 1.4 * (1 + 0.27 * (FIVE_CARDS - 2)) + 46;
  let cw: number;
  if (short) {
    const byW = (w - 24 - 18 - 3 * 10) / (LANES * 1.16 + 1.8);
    const byH = (h - 44 - 6 - 36) / (1.4 * (1 + 0.27 * (FIVE_CARDS - 2)));
    const byDealer = (h - 54) / 1.54;
    cw = Math.min(byW, byH, byDealer);
  } else if (wide) {
    const byW = (w - 40 - 18 - 3 * 10) / (LANES * 1.16 + 1.8);
    const byH = (h - 56 - 46 - 14) / (1.4 * (1 + 0.27 * (FIVE_CARDS - 2)));
    // The dealer column stacks the HUD above the current card.
    const byDealer = (h - 60 - 110) / 1.54;
    cw = Math.min(byW, byH, byDealer);
  } else {
    const byW = (w - 24 - 3 * 8) / (LANES * 1.16);
    const byH = (h - 56 - 40 - 46 - 24 - 28) / (1.4 * (1 + 0.27 * (FIVE_CARDS - 2)) + 1.4 * 0.95);
    cw = Math.min(byW, byH);
  }
  cw = Math.max(short ? 26 : 30, Math.min(128, Math.floor(cw)));
  return { wide, short, cw, laneH: Math.round(short ? laneH(cw) - 10 : laneH(cw)) };
}

function Play({ onSummary }: { onSummary: (s: Summary | null) => void }) {
  const shell = useShell();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const board = useRef<HTMLDivElement | null>(null);
  const st = useRef<State>(createGame());
  const [, render] = useReducer((n: number) => n + 1, 0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [lastPlaced, setLastPlaced] = useState<number | null>(null);
  const fxId = useRef(0);
  const lastNow = useRef<number | null>(null);
  const shownSecond = useRef(Math.ceil(ROUND_SECONDS));
  const endDelay = useRef<number | null>(null);

  useEffect(() => onSummary(null), [onSummary]);
  useEffect(() => {
    lastNow.current = null;
  }, [shell.status, shell.active]);
  const { setScore } = shell;
  useEffect(() => {
    setScore(0);
  }, [setScore]);

  const finish = () => {
    const s = st.current;
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
      setFloaters((f) => [...f, { id, lane: r.lane, kind: 'bust', title: 'Bust', points: 0, streak: 0 }]);
      sfx.play('hit');
      sfx.noise(0.14, 0.16);
      board.current?.animate?.(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
        { duration: 300, easing: 'ease-out' },
      );
      return;
    }
    const title = r.blackjack ? 'Blackjack' : r.fiveCard && r.total !== 21 ? 'Five Card' : r.fiveCard ? 'Five Card 21' : '21';
    setFloaters((f) => [...f, { id, lane: r.lane, kind: 'clear', title, points: r.points, streak: r.streak }]);
    const pitch = 1 + Math.min(6, r.streak - 1) * 0.08;
    sfx.play('coin', pitch);
    if (r.fiveCard || r.blackjack) sfx.tone({ freq: 1568 * pitch, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.14 });
  };

  const place = (lane: number) => {
    if (shell.status !== 'playing') return;
    const out = play(st.current, lane);
    if (!out) return;
    st.current = out.state;
    setLastPlaced(out.result.card.id);
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
      if (cursor === null) setCursor(0);
      else place(cursor);
    }
  });

  useGameLoop(() => {
    const now = performance.now();
    const dt = lastNow.current === null ? 0 : Math.min(0.25, (now - lastNow.current) / 1000);
    lastNow.current = now;
    if (endDelay.current !== null) {
      endDelay.current -= dt;
      if (endDelay.current <= 0) {
        endDelay.current = null;
        finish();
      }
      return;
    }
    const before = st.current;
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
  const card = currentCard(s);
  const upcoming = upcomingCard(s);
  const { wide, short, cw, laneH } = layout(size.w, size.h);
  const vars = { '--cw0': `${cw}px`, '--cw': `${cw}px`, '--ch': `${Math.round(cw * 1.4)}px`, '--lane-h': `${laneH}px` } as CSSProperties;
  const low = s.timeLeft <= 10;

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
    <div ref={ref} className={`g-blitz-21-stage ${wide ? 'is-wide' : 'is-tall'}${short ? ' is-short' : ''}`} style={vars}>
      {(!wide || short) && hud}
      <div className="g-blitz-21-play">
        {wide && dealer}
        <div className="g-blitz-21-lanes" ref={board}>
          {s.lanes.map((cards, i) => {
            const ghost = ghosts.find((g) => g.lane === i);
            const t = laneTotal(cards);
            return (
              <div
                key={i}
                role="button"
                aria-label={`Column ${i + 1}, total ${totalLabel(cards)}`}
                className={`g-blitz-21-lane ${cursor === i ? 'is-cursor' : ''} ${t.soft !== null ? 'is-soft' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setCursor(null);
                  place(i);
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="g-blitz-21-total" key={`t-${cards.length}`}>
                  {totalLabel(cards)}
                </div>
                <div className="g-blitz-21-slot">
                  {!cards.length && <div className="g-blitz-21-hole" />}
                  {cards.map((c, k) => (
                    <CardFace key={c.id} card={c} className={c.id === lastPlaced ? 'is-drop' : ''} style={{ top: `calc(var(--ch) * ${0.27 * k})` }} />
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
                        <CardFace key={c.id} card={c} style={{ top: `calc(var(--ch) * ${0.27 * Math.min(k, FIVE_CARDS - 2)})` }} />
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
