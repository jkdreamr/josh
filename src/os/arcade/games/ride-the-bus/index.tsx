import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, Option, PlayerList, Row, Screen, listNames, sips, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  ACE,
  CHOICES,
  QUESTIONS,
  advance,
  answer,
  boardBus,
  cardName,
  colorOf,
  isEdge,
  rankName,
  rankPlural,
  sipsFor,
  startBus,
  startGame,
  suitName,
  upcoming,
  withMercy,
  type Card,
  type Game,
  type Guess,
  type Suit,
} from './logic';
import { meta } from './meta';
import './ride-the-bus.css';

const MODE = defineSetting('ride-the-bus:mode', ['full', 'bus'] as const, 'full');
const MERCY = defineSetting('ride-the-bus:mercy', ['5', '10', '15'] as const, '5');
/** How long the row takes to sweep away after a miss on the bus, in seconds. */
const CLEAR_TIME = 0.5;
/** On the bus a verdict moves on by itself after this long, in seconds, unless someone taps first. */
const AUTO_RIGHT = 1.4;
/** A miss stays up longer, so the table can check the call against the card before the row is swept away. */
const AUTO_MISS = 3.2;
/**
 * Double-tap guards, in milliseconds. Answers and Next take turns in the same spot under the player's thumb, so the
 * second tap of a double tap would land on whichever just appeared: a call nobody made, or a verdict nobody read.
 * Each ignores taps for this long after it shows up: past a slow double tap (400 ms) with room for touch latency, and
 * Next also waits out the 0.2 s card turn first. Timestamps, not CSS, so reduced motion can't cut them short.
 */
const ANSWER_GUARD = 600;
const NEXT_GUARD = 450;
/** The rider reveal and getting off are reached by a tap on Next, with their own buttons in the same spot. */
const BIG_SCREEN_ARM = 700;
/**
 * When the turned card shows its face, in seconds: the last card on the bus turns slowly. Until then the board, the
 * button and the verdict keep the result to themselves.
 */
const REVEAL = 0.2;
const REVEAL_SLOW = 0.62;

type Step = { s: 'setup' } | { s: 'pick'; seat: number | null } | { s: 'table' } | { s: 'results' } | { s: 'off' };

const RULES: ReactNode[] = [
  <>
    Everyone gets four face-down cards and calls them in order: <b>red or black</b>, <b>higher or lower</b> than card one, <b>inside or outside</b> the first two,
    then the <b>suit</b>.
  </>,
  <>
    In order, the cards are worth 1, 2, 3 and 3 sips. <b>Wrong, you drink them. Right, you hand them out.</b>
  </>,
  <>A matching rank is always wrong: a tie is neither higher nor lower, and an edge is neither inside nor outside.</>,
  <>
    Most sips taken <b>rides the bus</b>: the same four calls, with fresh cards after every miss, until they get all four in a row.
  </>,
  <>
    The <b>mercy rule</b> lets the rider off after 5, 10 or 15 tries, so nobody rides all night.
  </>,
];

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

/* Sounds: the snap of a card, then a verdict once its face shows, a horn for the rider and the stop bell to get off. */

function flipSound(slow: boolean) {
  sfx.noise(0.05, 0.1);
  if (slow) sfx.tone({ freq: 196, to: 392, dur: REVEAL_SLOW, type: 'triangle', vol: 0.06 });
}

function verdictSound(right: boolean, delay: number) {
  if (right) {
    sfx.tone({ freq: 784, dur: 0.07, type: 'triangle', vol: 0.16, delay });
    sfx.tone({ freq: 1175, dur: 0.18, type: 'triangle', vol: 0.16, delay: delay + 0.07 });
  } else sfx.tone({ freq: 311, to: 104, dur: 0.42, type: 'triangle', vol: 0.2, delay });
}

function horn() {
  sfx.tone({ freq: 233, dur: 0.45, type: 'square', vol: 0.05 });
  sfx.tone({ freq: 277, dur: 0.45, type: 'square', vol: 0.05 });
}

function bell(times: number) {
  for (let i = 0; i < times; i++) {
    sfx.tone({ freq: 1568, dur: 0.6, type: 'sine', vol: 0.15, delay: i * 0.26 });
    sfx.tone({ freq: 4320, dur: 0.18, type: 'sine', vol: 0.03, delay: i * 0.26 });
  }
}

function Play() {
  const shell = useShell();
  const [players] = usePlayers();
  const [mode, setMode] = useSetting(MODE);
  const [mercy, setMercy] = useSetting(MERCY);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [clearing, setClearing] = useState(false);
  /** Seconds the verdict on screen waits before moving on by itself (0: it waits for a tap). */
  const [auto, setAuto] = useState(0);
  /** False while a card is turning: the table still shows the call it was made on. */
  const [revealed, setRevealed] = useState(true);
  const before = useRef<Game | null>(null);
  const revealLeft = useRef(-1);
  /** When the verdict on screen became live (its card face up and Next showing), for the double-tap guard. */
  const liveAt = useRef(0);
  /** Bus rides this session, by name, for the tally on the way off. */
  const [rides, setRides] = useState<Record<string, number>>({});
  const clearLeft = useRef(-1);
  const afterClear = useRef<Game | null>(null);
  const autoLeft = useRef(-1);
  const next = useRef<() => void>(() => {});

  // The card turning, the sweep after a miss and the bus's own pace all run on the game loop, so pausing holds them.
  useGameLoop((dt) => {
    if (revealLeft.current >= 0) {
      revealLeft.current -= dt;
      if (revealLeft.current <= 0) {
        revealLeft.current = -1;
        liveAt.current = performance.now();
        setRevealed(true);
      }
    }
    if (clearLeft.current >= 0) {
      clearLeft.current -= dt;
      if (clearLeft.current <= 0) {
        clearLeft.current = -1;
        const g = afterClear.current;
        afterClear.current = null;
        setClearing(false);
        if (g) setGame(g);
      }
    }
    if (autoLeft.current >= 0) {
      autoLeft.current -= dt;
      if (autoLeft.current <= 0) {
        autoLeft.current = -1;
        next.current();
      }
    }
  });

  const name = (i: number) => table[i] ?? 'You';
  const solo = table.length < 2;

  const settle = () => {
    setClearing(false);
    clearLeft.current = -1;
    afterClear.current = null;
    autoLeft.current = -1;
    setAuto(0);
    revealLeft.current = -1;
    setRevealed(true);
  };

  const rideBus = (names: string[], seat: number) => {
    settle();
    setTable(names);
    setGame(withMercy(startBus(names.length, seat), Number(mercy)));
    setStep({ s: 'table' });
  };

  const begin = (names: string[]) => {
    settle();
    setTable(names);
    if (mode === 'bus') {
      if (names.length > 1) setStep({ s: 'pick', seat: null });
      else rideBus(names, 0);
      return;
    }
    setGame(withMercy(startGame(names.length), Number(mercy)));
    setStep({ s: 'table' });
  };
  const roster = () => (players.length ? players : ['You']);

  const onAnswer = (guess: Guess) => {
    if (!game || game.verdict || clearing) return;
    const g = answer(game, guess);
    if (!g.verdict) return;
    const slow = slowTurn(g);
    flipSound(slow);
    verdictSound(g.verdict.right, slow ? REVEAL_SLOW : REVEAL);
    const kind = upcoming(g);
    // A miss on a matching rank waits for a tap: the table will want to argue that one.
    const edge = !g.verdict.right && isEdge(g.hand, g.verdict.q);
    const wait = g.phase !== 'bus' || edge ? 0 : kind === 'card' ? AUTO_RIGHT : kind === 'retry' ? AUTO_MISS + (slow ? REVEAL_SLOW - REVEAL : 0) : 0;
    autoLeft.current = wait || -1;
    setAuto(wait);
    before.current = game;
    revealLeft.current = slow ? REVEAL_SLOW : REVEAL;
    setRevealed(false);
    setGame(g);
  };

  const onNext = () => {
    if (!game?.verdict || clearing || !revealed) return;
    autoLeft.current = -1;
    setAuto(0);
    const kind = upcoming(game);
    const g = advance(game);
    if (kind === 'retry') {
      afterClear.current = g;
      clearLeft.current = CLEAR_TIME;
      setClearing(true);
      return;
    }
    if (kind === 'results') {
      horn();
      // Playing solo there is nobody to compare with, so the one player boards straight away.
      if (game.count < 2) setGame(boardBus(g));
      else {
        setGame(g);
        setStep({ s: 'results' });
      }
      return;
    }
    setGame(g);
    if (kind === 'off' || kind === 'mercy') {
      bell(kind === 'off' ? 2 : 1);
      const rider = name(game.seat);
      setRides((r) => ({ ...r, [rider]: (r[rider] ?? 0) + 1 }));
      setStep({ s: 'off' });
    }
  };
  next.current = onNext;
  /** Next from a person (button, table or Enter), as opposed to the bus moving on by itself. */
  const tapNext = (sound = false) => {
    if (performance.now() - liveAt.current < NEXT_GUARD) return;
    if (sound) sfx.play('select');
    onNext();
  };

  // One status line that outlives every step, so screen readers hear each verdict and reveal as it lands.
  let said = '';
  if (game && step.s === 'table' && game.verdict && revealed) {
    const v = verdictCopy(game, name(game.seat), solo);
    said = `${v.big}. ${v.detail}`;
  } else if (game && step.s === 'results') said = `${name(game.seat)} rides the bus. ${riderNote(game, name)}`;
  else if (game && step.s === 'off') said = `${game.mercy ? 'Mercy rule' : 'Off the bus'}. ${offNote(game, solo ? 'You' : name(game.seat))}`;
  const out = (view: ReactNode) => (
    <>
      {view}
      <p className="g-ride-the-bus-sr" role="status">
        {said}
      </p>
    </>
  );

  if (step.s === 'setup' || (step.s !== 'pick' && !game)) {
    return out(
      <Screen
        key="setup"
        center={false}
        title={<Sign>Ride the Bus</Sign>}
        sub="Four cards each. Whoever drinks the most rides the bus."
        onEnter={() => begin(roster())}
        actions={
          <Big primary onClick={() => begin(roster())}>
            Deal
          </Big>
        }
      >
        <HowToPlay steps={RULES} />
        <PlayerList min={0} emptyHint="Optional. With no names you ride solo." />
        <Option
          label="Mode"
          value={mode}
          options={[
            ['full', 'Full Game'],
            ['bus', 'Just the Bus'],
          ]}
          onChange={setMode}
        />
        <p className="g-ride-the-bus-note">
          {mode === 'bus'
            ? players.length > 1
              ? 'Skip the warmup. Pick a rider and go.'
              : 'Skip the warmup and go straight to the bus.'
            : players.length > 1
              ? 'Everyone calls four cards, then the most sips rides.'
              : 'Call four cards, then ride the bus.'}
        </p>
        <Option
          label="Mercy Rule"
          value={mercy}
          options={[
            ['5', '5 Tries'],
            ['10', '10 Tries'],
            ['15', '15 Tries'],
          ]}
          onChange={setMercy}
        />
        <DrinkNote />
      </Screen>,
    );
  }

  if (step.s === 'pick') {
    const chosen = step.seat;
    const go = () => rideBus(table, chosen ?? Math.floor(Math.random() * table.length));
    return out(
      <Screen
        key="pick"
        center={false}
        title="Who Rides the Bus?"
        sub="Pick the rider, or let the cards choose."
        onEnter={go}
        actions={
          <Row>
            <Big onClick={() => setStep({ s: 'setup' })}>Back</Big>
            <Big primary onClick={go}>
              {chosen === null ? 'Random Rider' : `${name(chosen)} Rides`}
            </Big>
          </Row>
        }
      >
        <div className="arcade-party-picks">
          {table.map((p, i) => (
            <button
              key={p}
              type="button"
              aria-pressed={chosen === i}
              onClick={() => {
                sfx.play('blip');
                setStep({ s: 'pick', seat: i });
                // Hand focus back to the game so Enter confirms instead of pressing this button again.
                shell.root.current?.focus({ preventScroll: true });
              }}
            >
              <Avatar name={p} index={i} size={30} />
              <span>{p}</span>
            </button>
          ))}
        </div>
      </Screen>,
    );
  }

  if (!game) return out(null);

  if (step.s === 'results') {
    // Only a table of two or more gets here; a solo player boards straight from the last card.
    const rider = game.seat;
    // Most sips first; the rider leads any tie.
    const order = game.taken.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n || Number(b.i === rider) - Number(a.i === rider) || a.i - b.i);
    const board = () => {
      setGame(boardBus(game));
      setStep({ s: 'table' });
    };
    return out(
      <Screen
        key="results"
        arm={BIG_SCREEN_ARM}
        className="g-ride-the-bus-results"
        kicker="Riding the bus"
        title={<Sign>{name(rider)}</Sign>}
        sub={riderNote(game, name)}
        onEnter={board}
        actions={
          <Big primary onClick={board}>
            Board the Bus
          </Big>
        }
      >
        <ul className="arcade-party-scores" aria-label="Sips taken">
          {order.map(({ n, i }) => (
            <li key={i} className={i === rider ? 'is-hi' : undefined}>
              <Avatar name={name(i)} index={i} size={26} />
              <span>{name(i)}</span>
              {game.tied.length > 1 && game.tied.includes(i) && <small className="g-ride-the-bus-tie">Tied</small>}
              <b>{n}</b>
            </li>
          ))}
        </ul>
      </Screen>,
    );
  }

  if (step.s === 'off') {
    const who = solo ? 'You' : name(game.seat);
    const again = () => {
      if (mode === 'bus' && table.length > 1) {
        setStep({ s: 'pick', seat: game.seat });
        return;
      }
      if (mode === 'bus') rideBus(table, 0);
      else begin(table);
    };
    const counts = Object.entries(rides).sort((a, b) => b[1] - a[1]);
    const tonight =
      solo || counts.reduce((n, [, c]) => n + c, 0) < 2
        ? ''
        : counts.length === 1
          ? `${counts[0][0]} has ridden ${counts[0][1]} times tonight.`
          : `Bus rides tonight: ${listNames(counts.map(([n, c]) => `${n} ${c}`))}.`;
    return out(
      <Screen
        key="off"
        arm={BIG_SCREEN_ARM}
        className="g-ride-the-bus-off"
        title={<Sign>{game.mercy ? 'Mercy Rule' : 'Off the Bus'}</Sign>}
        sub={offNote(game, who)}
        onEnter={again}
        actions={
          <>
            <Big primary onClick={again}>
              Play Again
            </Big>
            <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
          </>
        }
      >
        <div className="g-ride-the-bus-row is-done" role="list" aria-label={game.mercy ? 'The last cards' : 'The winning cards'}>
          {game.hand.map((card, i) => (
            <Slot key={card.id} card={card} index={i} up={i < game.marks.length} mark={game.marks[i]} />
          ))}
        </div>
        <div className="g-ride-the-bus-stats">
          <div>
            <b>{game.attempts}</b>
            <span>{game.attempts === 1 ? 'Try' : 'Tries'}</span>
          </div>
          <div>
            <b>{game.busSips}</b>
            <span>{game.busSips === 1 ? 'Sip on the bus' : 'Sips on the bus'}</span>
          </div>
          {game.mercy && (
            <div>
              <b>
                {game.best}
                <small>/{QUESTIONS}</small>
              </b>
              <span>Best run</span>
            </div>
          )}
        </div>
        {tonight && <p className="g-ride-the-bus-tonight">{tonight}</p>}
      </Screen>,
    );
  }

  return out(
    <TableView
      key={`table-${game.phase}-${game.seat}`}
      game={game}
      names={table}
      before={revealed ? null : before.current}
      clearing={clearing}
      auto={auto}
      onAnswer={onAnswer}
      onNext={tapNext}
    />,
  );
}

/** Why this rider: the most sips, or a tie the cards broke. */
function riderNote(game: Game, name: (i: number) => string): string {
  const most = game.taken[game.seat] ?? 0;
  return game.tied.length > 1 ? `Tied on ${sips(most)}, so the cards picked ${name(game.seat)}.` : `${sips(most)}, the most at the table.`;
}

/** How the ride ended. */
function offNote(game: Game, who: string): string {
  if (game.mercy) return `${who} rode it for ${game.attempts} tries. That's enough, off you get.`;
  return game.attempts === 1 ? `${who} got all four on the first try.` : `${who} got all four in a row on try ${game.attempts}.`;
}

/** The last card of a bus attempt turns slowly: true while it is asked and once it has turned. */
const slowTurn = (game: Game) => game.phase === 'bus' && (game.verdict ? game.verdict.q : game.shown) === QUESTIONS - 1;

const ANSWER_LABEL: Record<Guess, string> = {
  red: 'Red',
  black: 'Black',
  higher: 'Higher',
  lower: 'Lower',
  inside: 'Inside',
  outside: 'Outside',
  spades: 'Spades',
  hearts: 'Hearts',
  clubs: 'Clubs',
  diamonds: 'Diamonds',
};
const TITLES = ['Red or Black?', 'Higher or Lower?', 'Inside or Outside?', 'Which Suit?'];

function prompt(game: Game, who: string, solo: boolean): string {
  const [a, b] = game.hand;
  const bus = game.phase === 'bus';
  switch (game.shown) {
    case 0:
      if (bus) {
        if (game.limit && game.attempts >= game.limit) return 'Last try before the mercy rule.';
        return game.attempts > 1 ? 'Fresh cards. Four right in a row gets you off.' : 'Four right in a row gets you off.';
      }
      return solo ? "Wrong, you drink. Right, you don't." : `${who}'s turn. Wrong drinks, right gives.`;
    case 1: {
      const than = `Than the ${rankName(a.rank)} of ${suitName(a.suit)}.`;
      if (a.rank === ACE) return `${than} Nothing beats an ace.`;
      if (a.rank === 2) return `${than} Nothing goes under a 2.`;
      return `${than} A tie is wrong.`;
    }
    case 2: {
      if (a.rank === b.rank) return `Both cards are ${rankPlural(a.rank)}, so inside can't win.`;
      const [lo, hi] = a.rank < b.rank ? [a, b] : [b, a];
      return `Of the ${rankName(lo.rank)} and the ${rankName(hi.rank)}. Matching either one is wrong.`;
    }
    default:
      return bus ? "Get the suit and you're off." : 'One in four.';
  }
}

/** The big word for the table and the line under it. */
function verdictCopy(game: Game, who: string, solo: boolean): { big: string; detail: string } {
  const v = game.verdict;
  if (!v) return { big: '', detail: '' };
  const called = `${solo ? 'You' : who} called ${ANSWER_LABEL[v.guess].toLowerCase()}.`;
  const it = `It's the ${cardName(v.card)}.`;
  const edge = !v.right && isEdge(game.hand, v.q) ? " Same rank, so it's wrong." : '';
  if (game.phase === 'bus') {
    if (v.right) {
      const left = QUESTIONS - v.q - 1;
      return { big: left ? `${left} to go` : 'Four in a row', detail: `${called} ${it}` };
    }
    if (upcoming(game) === 'mercy') return { big: `Drink ${v.sips}`, detail: `${called} ${it}${edge} That was the last try.` };
    return { big: `Drink ${v.sips}`, detail: `${called} ${it}${edge} Back to card one.` };
  }
  if (v.right) return { big: solo ? 'Right' : `Give out ${v.sips}`, detail: `${called} ${it}` };
  return { big: `Drink ${v.sips}`, detail: `${called} ${it}${edge}` };
}

function Stat({ label, value, of, hot }: { label: string; value: number; of?: number; hot?: boolean }) {
  return (
    <div className={hot ? 'is-hot' : undefined}>
      <dt>{label}</dt>
      <dd>
        {value}
        {of !== undefined && (
          <small>
            <span aria-hidden="true">/{of}</span>
            <span className="g-ride-the-bus-sr"> of {of}</span>
          </small>
        )}
      </dd>
    </div>
  );
}

function TableView({
  game,
  before,
  names,
  clearing,
  auto,
  onAnswer,
  onNext,
}: {
  game: Game;
  /** The table as it was before the card now turning, until its face shows. */
  before: Game | null;
  names: string[];
  clearing: boolean;
  auto: number;
  onAnswer: (g: Guess) => void;
  /** Moves on from the verdict; `sound` plays the tap's click. */
  onNext: (sound?: boolean) => void;
}) {
  const shell = useShell();
  const { verdict } = game;
  const bus = game.phase === 'bus';
  const q = game.shown;
  const choices = verdict ? [] : (CHOICES[q] ?? []);
  const who = names[game.seat] ?? 'You';
  const solo = names.length < 2;
  // What the board and the call show: the table before the answer until the card's face is up.
  const face = before ?? game;
  const turning = !!verdict && !!before;
  const live = !!verdict && !turning && !clearing;

  useKeys((code, e) => {
    if (e?.repeat || verdict || clearing || !choices.length) return;
    let i = -1;
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (digit) i = Number(digit[1]) - 1;
    else if (choices.length === 2) {
      if (code === 'ArrowLeft' || (q === 1 && code === 'ArrowUp')) i = 0;
      else if (code === 'ArrowRight' || (q === 1 && code === 'ArrowDown')) i = 1;
    }
    if (i >= 0 && i < choices.length) onAnswer(choices[i]);
  });

  // The answer buttons vanish once answered; keep focus in the game so Enter still means Next.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) shell.root.current?.focus({ preventScroll: true });
  }, [verdict, game.deals, shell.root]);

  // On a narrow strip that scrolls sideways, bring whoever is playing into view.
  const standings = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const strip = standings.current;
    const chip = strip?.children[game.seat] as HTMLElement | undefined;
    if (!strip || !chip || strip.scrollWidth <= strip.clientWidth) return;
    const a = strip.getBoundingClientRect();
    const b = chip.getBoundingClientRect();
    strip.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
  }, [game.seat]);

  const kind = upcoming(game);
  const nextLabel =
    kind === 'card'
      ? 'Next Card'
      : kind === 'player'
        ? `Pass to ${names[game.seat + 1] ?? 'Next'}`
        : kind === 'results'
          ? solo
            ? 'Board the Bus'
            : 'Who Rides the Bus?'
          : kind === 'retry'
            ? 'Deal Again'
            : 'Get Off the Bus';
  const slow = slowTurn(game);
  const { big, detail } = verdictCopy(game, who, solo);
  const lastTry = bus && face.limit > 0 && face.attempts >= face.limit;
  const ask = face.shown;

  // Nothing to press while a card turns or the row is swept away after a miss: an empty spot can't take a stray tap.
  const actions =
    turning || clearing ? (
      <div className="g-ride-the-bus-hold" aria-hidden="true" />
    ) : verdict ? (
      <div key={`next-${game.deals}-${q}`} className={`g-ride-the-bus-next ${auto ? 'is-auto' : ''}`} style={{ '--auto': `${Math.max(0.1, auto - (slow ? REVEAL_SLOW : REVEAL))}s` } as CSSProperties}>
        <Big primary quiet onClick={() => onNext(true)}>
          {nextLabel}
        </Big>
      </div>
    ) : (
      <Answers key={`answers-${game.deals}-${q}`} q={q} choices={choices} keys={!shell.touch} onAnswer={onAnswer} />
    );

  return (
    <Screen className={`g-ride-the-bus-table ${bus ? 'is-bus' : ''}`} center={false} onEnter={live ? onNext : undefined} actions={actions}>
      {/* While a verdict shows, a tap anywhere on the table moves on; the button below does the same. */}
      <div
        className={`g-ride-the-bus-tap ${live ? 'is-live' : ''}`}
        style={{ '--reveal': `${slow ? REVEAL_SLOW : REVEAL}s` } as CSSProperties}
        onClick={live ? () => onNext(true) : undefined}
      >
        <div className="g-ride-the-bus-hud">
          <span className="g-ride-the-bus-who">
            <Avatar name={who} index={game.seat} size={32} />
            <b>{who}</b>
            {bus && <BusBadge small />}
          </span>
          <dl className="g-ride-the-bus-board">
            {bus ? (
              <>
                <Stat label={lastTry ? 'Last try' : 'Try'} value={face.attempts} of={face.limit || undefined} hot={lastTry} />
                <Stat label="Sips" value={face.busSips} />
                <Stat label="Best" value={face.best} of={QUESTIONS} />
              </>
            ) : (
              <>
                <Stat label="Drank" value={face.taken[face.seat] ?? 0} />
                {!solo && <Stat label="Gave" value={face.given[face.seat] ?? 0} />}
              </>
            )}
          </dl>
        </div>
        <div className="g-ride-the-bus-stage">
          <div key={game.deals} className={`g-ride-the-bus-row ${clearing ? 'is-clearing' : ''} ${slow ? 'is-slow' : ''}`} role="list" aria-label="Cards">
            {Array.from({ length: QUESTIONS }, (_, i) => (
              <Slot
                key={i}
                card={game.hand[i]}
                index={i}
                up={i < game.shown}
                mark={game.marks[i]}
                current={!verdict && i === game.shown}
                turned={!!verdict && !clearing && i === game.shown - 1}
              />
            ))}
          </div>
          {verdict && !turning ? (
            <div key={`verdict-${game.deals}-${verdict.q}`} className="g-ride-the-bus-ask">
              <p className={`g-ride-the-bus-verdict ${verdict.right ? 'is-right' : 'is-wrong'}`} aria-hidden="true">
                <VerdictIcon right={verdict.right} />
                <span>{big}</span>
              </p>
              <p className="arcade-party-sub g-ride-the-bus-detail" aria-hidden="true">
                {detail}
              </p>
            </div>
          ) : (
            <div key={`ask-${game.deals}-${ask}`} className="g-ride-the-bus-ask">
              <p className="arcade-party-kicker">
                {bus && ask === QUESTIONS - 1 ? 'Last card' : `Card ${ask + 1} of ${QUESTIONS}`} &middot; {bus ? `a miss drinks ${sipsFor(ask)}` : sips(sipsFor(ask))}
              </p>
              <h2 className="arcade-party-title g-ride-the-bus-q">{TITLES[ask]}</h2>
              <p className="arcade-party-sub">{prompt(face, who, solo)}</p>
            </div>
          )}
        </div>
        {!bus && !solo && (
          <ol ref={standings} className="g-ride-the-bus-standings" aria-label="Sips taken so far">
            {names.map((n, i) => (
              <li key={n} className={i === game.seat ? 'is-on' : undefined}>
                <Avatar name={n} index={i} size={22} />
                <span>{n}</span>
                <b>{face.taken[i] ?? 0}</b>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Screen>
  );
}

const keyFor = (n: number, i: number) => (n === 2 ? `${i === 0 ? 'ArrowLeft' : 'ArrowRight'} ${i + 1}` : String(i + 1));

/**
 * The answer buttons for one question. Mounted fresh for every question (keyed by hand and card), so a tap that
 * arrives within ANSWER_GUARD of them appearing belongs to the button that was there before, and is dropped.
 */
function Answers({ q, choices, keys, onAnswer }: { q: number; choices: readonly Guess[]; keys: boolean; onAnswer: (g: Guess) => void }) {
  const [shownAt] = useState(() => performance.now());
  return (
    <div className={`g-ride-the-bus-answers is-${choices.length}`} role="group" aria-label={TITLES[q]}>
      {choices.map((g, i) => (
        <button
          key={g}
          type="button"
          className={`g-ride-the-bus-answer is-${g}`}
          onClick={() => {
            if (performance.now() - shownAt < ANSWER_GUARD) return;
            onAnswer(g);
          }}
          aria-keyshortcuts={keyFor(choices.length, i)}
        >
          <AnswerIcon guess={g} />
          <span>{ANSWER_LABEL[g]}</span>
          {keys && <kbd aria-hidden="true">{choices.length === 2 ? (i === 0 ? '←' : '→') : i + 1}</kbd>}
        </button>
      ))}
    </div>
  );
}

/* Cards */

// Suit shapes in a 24x24 box (the same drawings Blitz 21 uses).
const SUIT_PATH: Record<Suit, string> = {
  hearts: 'M12 21.2C6.4 17.1 2 13.4 2 8.7 2 5.6 4.4 3.2 7.3 3.2c2 0 3.6 1 4.7 2.7 1.1-1.7 2.7-2.7 4.7-2.7 2.9 0 5.3 2.4 5.3 5.5 0 4.7-4.4 8.4-10 12.5z',
  diamonds: 'M12 2.2l7.6 9.8L12 21.8 4.4 12z',
  spades: 'M12 2.4C7.6 6.6 3.4 9.6 3.4 13.6c0 2.7 2.1 4.6 4.5 4.6 1.3 0 2.4-.5 3.2-1.4-.3 1.9-1 3.2-2.2 4.4h6.2c-1.2-1.2-1.9-2.5-2.2-4.4.8.9 1.9 1.4 3.2 1.4 2.4 0 4.5-1.9 4.5-4.6 0-4-4.2-7-8.6-11.2z',
  clubs: 'M12 2.6a4.4 4.4 0 0 0-3.6 6.9 4.4 4.4 0 1 0 2.6 7.3c-.3 1.9-1 3.2-2.2 4.4h6.4c-1.2-1.2-1.9-2.5-2.2-4.4a4.4 4.4 0 1 0 2.6-7.3A4.4 4.4 0 0 0 12 2.6z',
};

const SuitIcon = ({ suit, className }: { suit: Suit; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d={SUIT_PATH[suit]} fill="currentColor" />
  </svg>
);

// Pip spots on a 100 by 140 card: three columns, rows from the top pip to the bottom pip.
const L = 32;
const C = 50;
const R = 68;
const T = 30;
const B = 110;
const at = (f: number) => T + (B - T) * f;
const sides = (...fs: number[]): [number, number][] => fs.flatMap((f) => [[L, at(f)], [R, at(f)]] as [number, number][]);
const PIPS: Record<number, [number, number][]> = {
  2: [[C, T], [C, B]],
  3: [[C, T], [C, at(0.5)], [C, B]],
  4: sides(0, 1),
  5: [...sides(0, 1), [C, at(0.5)]],
  6: sides(0, 0.5, 1),
  7: [...sides(0, 0.5, 1), [C, at(0.25)]],
  8: [...sides(0, 0.5, 1), [C, at(0.25)], [C, at(0.75)]],
  9: [...sides(0, 1 / 3, 2 / 3, 1), [C, at(0.5)]],
  10: [...sides(0, 1 / 3, 2 / 3, 1), [C, at(1 / 6)], [C, at(5 / 6)]],
};

function Pip({ suit, x, y, size }: { suit: Suit; x: number; y: number; size: number }) {
  // Pips below the middle are drawn upside down, like a printed deck.
  const flip = y > 70.5 ? `rotate(180 ${x} ${y}) ` : '';
  return <path d={SUIT_PATH[suit]} transform={`${flip}translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`} />;
}

function CardFace({ card }: { card: Card }) {
  const label = card.rank > 10 ? 'JQKA'[card.rank - 11] : String(card.rank);
  const corner = (
    <>
      <text x="12" y="25" textAnchor="middle" fontSize="22">
        {label}
      </text>
      <Pip suit={card.suit} x={12} y={34} size={11} />
    </>
  );
  let middle;
  if (card.rank === ACE) middle = <Pip suit={card.suit} x={50} y={70} size={card.suit === 'spades' ? 48 : 42} />;
  else if (card.rank > 10)
    middle = (
      <>
        <rect x="25" y="20" width="50" height="100" rx="4" className="g-ride-the-bus-court" />
        <Pip suit={card.suit} x={50} y={36} size={14} />
        <text x="50" y="87" textAnchor="middle" fontSize="50">
          {label}
        </text>
        <Pip suit={card.suit} x={50} y={104} size={14} />
      </>
    );
  else middle = PIPS[card.rank]?.map(([x, y], i) => <Pip key={i} suit={card.suit} x={x} y={y} size={16} />);
  return (
    <svg className={`g-ride-the-bus-svg ${colorOf(card) === 'red' ? 'is-red' : ''}`} viewBox="0 0 100 140" aria-hidden="true">
      <g fill="currentColor">
        {corner}
        <g transform="rotate(180 50 70)">{corner}</g>
        {middle}
      </g>
    </svg>
  );
}

function Slot({ card, index, up, mark, current, turned }: { card?: Card; index: number; up: boolean; mark?: boolean; current?: boolean; turned?: boolean }) {
  const cls = [
    'g-ride-the-bus-slot',
    up ? 'is-up' : '',
    current ? 'is-current' : '',
    turned ? 'is-turned' : '',
    mark === true ? 'is-right' : mark === false ? 'is-wrong' : '',
  ].join(' ');
  return (
    <div role="listitem" className={cls} style={{ '--i': index } as CSSProperties} aria-label={up && card ? cardName(card) : `Card ${index + 1}, face down`}>
      <div className="g-ride-the-bus-flip">
        <div className="g-ride-the-bus-face">{up && card && <CardFace card={card} />}</div>
        <div className="g-ride-the-bus-back">
          <BusMark />
        </div>
      </div>
      {mark !== undefined && up && (
        <span className={`g-ride-the-bus-mark ${mark ? 'is-right' : 'is-wrong'}`} aria-hidden="true">
          <VerdictIcon right={mark} />
        </span>
      )}
    </div>
  );
}

/* Icons */

const BUS = 'M6.5 3h11A2.5 2.5 0 0 1 20 5.5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5.5A2.5 2.5 0 0 1 6.5 3zM4 7.5h16M4 12.5h16M12 7.5v5M7.5 15.25h1M15.5 15.25h1M7 18v2.5M17 18v2.5';

const BusMark = () => (
  <span className="g-ride-the-bus-emblem">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={BUS} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

const BusBadge = ({ small }: { small?: boolean }) => (
  <span className={`g-ride-the-bus-badge ${small ? 'is-small' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d={BUS} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/** A bus stop sign: the game's title plate, also used for whoever rides and for getting off. */
const Sign = ({ children }: { children: ReactNode }) => (
  <span className="g-ride-the-bus-sign">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={BUS} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>{children}</span>
  </span>
);

const VerdictIcon = ({ right }: { right: boolean }) => (
  <svg className="g-ride-the-bus-vicon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={right ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6.5 6.5l11 11M17.5 6.5l-11 11'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ARROWS: Partial<Record<Guess, string>> = {
  higher: 'M12 19V5M5.5 11.5L12 5l6.5 6.5',
  lower: 'M12 5v14M5.5 12.5L12 19l6.5-6.5',
  inside: 'M3 12h6M6.5 8.5L9.5 12l-3 3.5M21 12h-6M17.5 8.5L14.5 12l3 3.5M12 5v14',
  outside: 'M9 12H3M5.5 8.5L2.5 12l3 3.5M15 12h6M18.5 8.5l3 3.5-3 3.5M12 5v14',
};

function AnswerIcon({ guess }: { guess: Guess }) {
  if (guess === 'red' || guess === 'black') {
    const [a, b]: Suit[] = guess === 'red' ? ['hearts', 'diamonds'] : ['spades', 'clubs'];
    return (
      <span className="g-ride-the-bus-duo" aria-hidden="true">
        <SuitIcon suit={a} />
        <SuitIcon suit={b} />
      </span>
    );
  }
  const arrow = ARROWS[guess];
  if (arrow)
    return (
      <svg className="g-ride-the-bus-aicon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={arrow} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  const suit = guess as Suit;
  return <SuitIcon suit={suit} className={`g-ride-the-bus-sicon ${colorOf({ id: 0, rank: 2, suit }) === 'red' ? 'is-red' : ''}`} />;
}
