import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, Option, PassTo, PlayerList, Row, Screen, mulberry32, sips, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  CHOICES,
  QUESTIONS,
  advance,
  answer,
  boardBus,
  cardName,
  colorOf,
  rankName,
  rankPlural,
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
const MERCY = defineSetting('ride-the-bus:mercy', ['5', '10', '0'] as const, '5');
/** How long the row takes to sweep away after a miss on the bus, in seconds. */
const CLEAR_TIME = 0.5;

type Step = { s: 'setup' } | { s: 'pick'; seat: number | null } | { s: 'pass' } | { s: 'table' } | { s: 'results' } | { s: 'off' };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
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
  const clearLeft = useRef(-1);
  const afterClear = useRef<Game | null>(null);

  // The sweep after a miss on the bus runs on the game loop, so pausing holds it too.
  useGameLoop((dt) => {
    if (clearLeft.current < 0) return;
    clearLeft.current -= dt;
    if (clearLeft.current > 0) return;
    clearLeft.current = -1;
    const next = afterClear.current;
    afterClear.current = null;
    setClearing(false);
    if (next) setGame(next);
  });

  const name = (i: number) => table[i] ?? 'You';
  const solo = table.length < 2;

  const rideBus = (names: string[], seat: number) => {
    setTable(names);
    setGame(withMercy(startBus(names.length, seat), Number(mercy)));
    setStep(names.length > 1 ? { s: 'pass' } : { s: 'table' });
  };

  const begin = (names: string[]) => {
    setClearing(false);
    clearLeft.current = -1;
    afterClear.current = null;
    if (mode === 'bus') {
      if (names.length > 1) {
        setTable(names);
        setStep({ s: 'pick', seat: null });
      } else rideBus(names, 0);
      return;
    }
    setTable(names);
    setGame(withMercy(startGame(names.length), Number(mercy)));
    setStep(names.length > 1 ? { s: 'pass' } : { s: 'table' });
  };
  const roster = () => (players.length ? players : ['You']);

  if (step.s === 'setup' || (step.s !== 'pick' && !game)) {
    return (
      <Screen
        key="setup"
        center={false}
        title="Ride the Bus"
        sub="Red or black, higher or lower, inside or outside, then the suit. Whoever drinks the most rides the bus until they get all four in a row."
        onEnter={() => begin(roster())}
        actions={
          <Big primary onClick={() => begin(roster())}>
            Start
          </Big>
        }
      >
        <PlayerList min={0} />
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
          {!players.length
            ? mode === 'full'
              ? 'No names, so you play solo: four cards, then the bus.'
              : 'No names, so you play solo, straight onto the bus.'
            : mode === 'full'
              ? 'Everyone answers four cards, then the thirstiest rides the bus.'
              : 'Skip the warmup. Pick a rider and get on the bus.'}
        </p>
        <Option
          label="Mercy Rule"
          value={mercy}
          options={[
            ['5', '5 Tries'],
            ['10', '10 Tries'],
            ['0', 'Off'],
          ]}
          onChange={setMercy}
        />
        <DrinkNote />
      </Screen>
    );
  }

  if (step.s === 'pick') {
    const chosen = step.seat;
    const go = () => rideBus(table, chosen ?? Math.floor(Math.random() * table.length));
    return (
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
      </Screen>
    );
  }

  if (!game) return null;

  if (step.s === 'pass') {
    const bus = game.phase === 'bus';
    return (
      <PassTo
        key={`pass-${game.phase}-${game.seat}`}
        name={name(game.seat)}
        index={game.seat}
        note={bus ? 'You ride the bus. Four right in a row gets you off.' : 'Your turn for four cards. Everyone else, watch closely.'}
        onReady={() => setStep({ s: 'table' })}
      />
    );
  }

  if (step.s === 'results') {
    const rider = game.seat;
    // Most sips first; the rider leads any tie.
    const order = game.taken.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n || Number(b.i === rider) - Number(a.i === rider) || a.i - b.i);
    const board = () => {
      setGame(boardBus(game));
      setStep(solo ? { s: 'table' } : { s: 'pass' });
    };
    const most = game.taken[rider] ?? 0;
    const sub = solo
      ? `Playing solo, so you were always getting on. You took ${sips(most)}.`
      : game.tied.length > 1
        ? `Tied, so the cards chose ${name(rider)}.`
        : `Most sips taken, with ${sips(most)}.`;
    return (
      <Screen key="results" title={solo ? 'You Ride the Bus' : `${name(rider)} Rides the Bus`} sub={sub} onEnter={board} actions={<Big primary onClick={board}>Board the Bus</Big>}>
        <span className="g-ride-the-bus-rider">
          <Avatar name={name(rider)} index={rider} size={72} />
          <BusBadge />
        </span>
        {!solo && (
          <>
            <p className="arcade-party-kicker g-ride-the-bus-caption">Sips Taken</p>
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
          </>
        )}
      </Screen>
    );
  }

  if (step.s === 'off') {
    const again = () => {
      if (mode === 'bus' && table.length > 1) {
        setStep({ s: 'pick', seat: game.seat });
        return;
      }
      if (mode === 'bus') rideBus(table, 0);
      else begin(table);
    };
    return (
      <Screen
        key="off"
        title={game.mercy ? 'Mercy!' : 'Off the Bus!'}
        sub={
          game.mercy
            ? `${solo ? 'You' : name(game.seat)} rode it ${game.attempts} tries. That's plenty, off you get.`
            : game.attempts === 1
            ? `${solo ? 'You' : name(game.seat)} got all four on the first try. Legend.`
            : solo
              ? 'All four in a row. You made it.'
              : `${name(game.seat)} got all four in a row.`
        }
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
        {!game.mercy && <Confetti />}
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
            <span>{game.busSips === 1 ? 'Sip on the Bus' : 'Sips on the Bus'}</span>
          </div>
        </div>
      </Screen>
    );
  }

  const onAnswer = (guess: Guess) => {
    if (game.verdict || clearing) return;
    const next = answer(game, guess);
    if (!next.verdict) return;
    sfx.play(next.verdict.right ? 'coin' : 'lose');
    setGame(next);
  };

  const onNext = () => {
    if (!game.verdict || clearing) return;
    const kind = upcoming(game);
    const next = advance(game);
    if (kind === 'retry') {
      afterClear.current = next;
      clearLeft.current = CLEAR_TIME;
      setClearing(true);
      return;
    }
    if (kind === 'off' || kind === 'mercy') sfx.play('win');
    setGame(next);
    if (kind === 'player') setStep({ s: 'pass' });
    else if (kind === 'results') setStep({ s: 'results' });
    else if (kind === 'off' || kind === 'mercy') setStep({ s: 'off' });
  };

  return <TableView key={`table-${game.phase}-${game.seat}`} game={game} names={table} clearing={clearing} onAnswer={onAnswer} onNext={onNext} />;
}

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

function prompt(game: Game): string {
  const [a, b] = game.hand;
  switch (game.shown) {
    case 0:
      return game.phase === 'bus' ? 'Four right in a row gets you off.' : 'Guess the color of the first card.';
    case 1:
      return `Than the ${rankName(a.rank)} of ${suitName(a.suit)}. A tie is wrong.`;
    case 2: {
      if (a.rank === b.rank) return `Both cards are ${rankPlural(a.rank)}, so inside can't win.`;
      const [lo, hi] = a.rank < b.rank ? [a, b] : [b, a];
      return `Of the ${rankName(lo.rank)} and the ${rankName(hi.rank)}. Matching either one is wrong.`;
    }
    default:
      return 'One in four. Trust your gut.';
  }
}

function TableView({ game, names, clearing, onAnswer, onNext }: { game: Game; names: string[]; clearing: boolean; onAnswer: (g: Guess) => void; onNext: () => void }) {
  const shell = useShell();
  const { verdict } = game;
  const bus = game.phase === 'bus';
  const q = game.shown;
  const choices = verdict ? [] : (CHOICES[q] ?? []);
  const who = names[game.seat] ?? 'You';
  const solo = names.length < 2;

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
    kind === 'card' ? 'Next Card' : kind === 'player' ? `Pass to ${names[game.seat + 1] ?? 'Next'}` : kind === 'results' ? 'Who Rides the Bus?' : kind === 'retry' ? 'Start Over' : kind === 'mercy' ? 'Mercy, Get Off' : 'Get Off the Bus';

  let banner = '';
  let detail = '';
  if (verdict) {
    const it = `It was the ${cardName(verdict.card)}.`;
    if (bus) {
      banner = verdict.right ? (verdict.q === QUESTIONS - 1 ? 'Right! Four in a row.' : `Right! ${QUESTIONS - verdict.q - 1} to go.`) : `Wrong. Drink ${sips(verdict.sips)}.`;
      detail = verdict.right ? it : `${it} Back to the first card with fresh ones.`;
    } else {
      banner = verdict.right ? `Right! Give out ${sips(verdict.sips)}.` : `Wrong. Drink ${sips(verdict.sips)}.`;
      detail = verdict.right && !solo ? `${it} Hand them to anyone.` : it;
    }
  }

  const actions = verdict ? (
    <Big key={`next-${game.deals}-${q}`} primary disabled={clearing} onClick={onNext}>
      {nextLabel}
    </Big>
  ) : (
    <div key={`answers-${game.deals}-${q}`} className={`g-ride-the-bus-answers is-${choices.length}`} role="group" aria-label={TITLES[q]}>
      {choices.map((g, i) => (
        <button key={g} type="button" className={`g-ride-the-bus-answer is-${g}`} onClick={() => onAnswer(g)} aria-keyshortcuts={keyFor(choices.length, i)}>
          <AnswerIcon guess={g} />
          <span>{ANSWER_LABEL[g]}</span>
          {!shell.touch && <kbd aria-hidden="true">{choices.length === 2 ? (i === 0 ? '←' : '→') : i + 1}</kbd>}
        </button>
      ))}
    </div>
  );

  return (
    <Screen className="g-ride-the-bus-table" center={false} onEnter={verdict && !clearing ? onNext : undefined} actions={actions}>
      <div className="g-ride-the-bus-hud">
        <span className="g-ride-the-bus-who">
          <Avatar name={who} index={game.seat} size={26} />
          <b>{who}</b>
          {bus && <BusBadge small />}
        </span>
        <span className="g-ride-the-bus-pills">
          {bus ? (
            <>
              <span>Try {game.attempts}</span>
              <span className={game.busSips ? 'is-hot' : undefined}>{sips(game.busSips)}</span>
            </>
          ) : (
            <span className={game.taken[game.seat] ? 'is-hot' : undefined}>{sips(game.taken[game.seat] ?? 0)} taken</span>
          )}
        </span>
      </div>
      <div className="g-ride-the-bus-stage">
        <div key={game.deals} className={`g-ride-the-bus-row ${clearing ? 'is-clearing' : ''}`} role="list" aria-label="Cards">
          {Array.from({ length: QUESTIONS }, (_, i) => (
            <Slot key={i} card={game.hand[i]} index={i} up={i < game.shown} mark={game.marks[i]} current={!verdict && i === game.shown} />
          ))}
        </div>
        {verdict ? (
          <div key={`verdict-${game.deals}-${verdict.q}`} className="g-ride-the-bus-ask">
            <p className={`g-ride-the-bus-verdict ${verdict.right ? 'is-right' : 'is-wrong'}`} role="status">
              <VerdictIcon right={verdict.right} />
              <span>{banner}</span>
            </p>
            <p className="arcade-party-sub">{detail}</p>
          </div>
        ) : (
          <div key={`ask-${game.deals}-${q}`} className="g-ride-the-bus-ask">
            <p className="arcade-party-kicker">
              Card {q + 1} of {QUESTIONS} &middot; {bus ? `Miss Drinks ${q + 1}` : sips(q + 1)}
            </p>
            <h2 className="arcade-party-title g-ride-the-bus-q">{TITLES[q]}</h2>
            <p className="arcade-party-sub">{prompt(game)}</p>
          </div>
        )}
      </div>
      {!bus && !solo && (
        <ol ref={standings} className="g-ride-the-bus-standings" aria-label="Sips taken so far">
          {names.map((n, i) => (
            <li key={n} className={i === game.seat ? 'is-on' : undefined}>
              <Avatar name={n} index={i} size={20} />
              <span>{n}</span>
              <b>{game.taken[i] ?? 0}</b>
            </li>
          ))}
        </ol>
      )}
    </Screen>
  );
}

const keyFor = (n: number, i: number) => (n === 2 ? `${i === 0 ? 'ArrowLeft' : 'ArrowRight'} ${i + 1}` : String(i + 1));

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
const T = 28;
const B = 112;
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
      <text x="12" y="22" textAnchor="middle" fontSize="17" letterSpacing={label.length > 1 ? -1.4 : 0}>
        {label}
      </text>
      <Pip suit={card.suit} x={12} y={31} size={11} />
    </>
  );
  let middle;
  if (card.rank === 14) middle = <Pip suit={card.suit} x={50} y={70} size={card.suit === 'spades' ? 48 : 42} />;
  else if (card.rank > 10)
    middle = (
      <>
        <rect x="24" y="18" width="52" height="104" rx="5" className="g-ride-the-bus-court" />
        <Pip suit={card.suit} x={50} y={36} size={14} />
        <text x="50" y="84" textAnchor="middle" fontSize="40">
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

function Slot({ card, index, up, mark, current }: { card?: Card; index: number; up: boolean; mark?: boolean; current?: boolean }) {
  const cls = ['g-ride-the-bus-slot', up ? 'is-up' : '', current ? 'is-current' : '', mark === true ? 'is-right' : mark === false ? 'is-wrong' : ''].join(' ');
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
        <path d={arrow} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return <SuitIcon suit={guess as Suit} className={`g-ride-the-bus-sicon ${colorOf({ id: 0, rank: 2, suit: guess as Suit }) === 'red' ? 'is-red' : ''}`} />;
}

/* Off the bus */

const CONFETTI = (() => {
  const rng = mulberry32(21);
  const colors = ['#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#ff375f', '#bf5af2', '#ffffff'];
  return Array.from({ length: 26 }, (_, i) => ({
    x: Math.round(rng() * 100),
    delay: Math.round(rng() * 500) / 1000,
    dur: 1.6 + Math.round(rng() * 1000) / 1000,
    spin: Math.round(rng() * 720 - 360),
    drift: Math.round(rng() * 80 - 40),
    color: colors[i % colors.length],
    wide: rng() > 0.5,
  }));
})();

function Confetti() {
  return (
    <div className="g-ride-the-bus-confetti" aria-hidden="true">
      {CONFETTI.map((p, i) => (
        <i
          key={i}
          className={p.wide ? 'is-wide' : undefined}
          style={{ left: `${p.x}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, '--spin': `${p.spin}deg`, '--drift': `${p.drift}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}
