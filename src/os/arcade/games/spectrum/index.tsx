import { useRef, useState, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, HowToPlay, Option, PassTo, Pile, PlayerList, Row, Screen, listNames, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { CARDS, deckFor, type Card } from './cards';
import { Dial } from './dial';
import {
  MIN_PLAYERS,
  NEEDLE_START,
  TOGETHER_CARDS,
  TOGETHER_MAX,
  addPoints,
  callPoints,
  clampDial,
  clueTip,
  makeTeams,
  otherTeam,
  psychicFor,
  randomTarget,
  rating,
  scoreGuess,
  scoresBefore,
  startScores,
  togetherDone,
  verdict,
  winner,
  type Mode,
  type Points,
  type Side,
  type Team,
} from './logic';
import { meta } from './meta';
import './spectrum.css';

const MODE = defineSetting('spectrum:mode', ['teams', 'together'] as const, 'teams');
const GOAL = defineSetting('spectrum:goal', ['10', '15'] as const, '10');
const DARK = defineSetting('spectrum:dark', ['off', 'on'] as const, 'off');

const TEAM_NAMES = ['Teal Team', 'Coral Team'] as const;
const TEAM_SHORT = ['Teal', 'Coral'] as const;

/** Steps where a double tap would skip something (the target, the guess, the call, the final score) ignore taps and Enter this long. */
const ARM = 800;
/** Once the shutter is open, the result stays up at least this long before Next counts. */
const SETTLE = 600;

type Turn = { card: Card; target: number; needle: number; points: Points; team: Team; seat: number; call?: Side; callPts: 0 | 1 };
type Match = { mode: Mode; names: string[]; goal: number; first: number; turn: number; scores: [number, number]; history: Turn[] };
type Deal = { card: Card; target: number };
type Step = { s: 'setup' } | { s: 'pass' } | { s: 'psychic' } | { s: 'guess' } | { s: 'call' } | { s: 'reveal' } | { s: 'end' };

/** The shutter swings for about a second after a short beat; a ratchet of clicks plays under it. */
function ratchet() {
  for (let i = 0; i < 9; i++) sfx.tone({ freq: 760 + i * 55, dur: 0.022, type: 'triangle', vol: 0.07, delay: 0.32 + i * 0.105 });
}

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [mode, setMode] = useSetting(MODE);
  const [goal, setGoal] = useSetting(GOAL);
  const [dark, setDark] = useSetting(DARK);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [match, setMatch] = useState<Match | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [needle, setNeedle] = useState(NEEDLE_START);
  const pile = useRef<{ dark: boolean; pile: Pile<Card> } | null>(null);
  const last = useRef<Card | undefined>(undefined);
  const spicy = useRef(false);

  const draw = (): Card => {
    // A new pile only when After Dark flips, so cards don't repeat across matches until the deck runs out.
    if (pile.current?.dark !== spicy.current) pile.current = { dark: spicy.current, pile: new Pile(deckFor(spicy.current)) };
    const card = pile.current.pile.draw(last.current) ?? CARDS[0];
    last.current = card;
    return card;
  };

  const dealTurn = () => {
    setDeal({ card: draw(), target: randomTarget() });
    setNeedle(NEEDLE_START);
    setStep({ s: 'pass' });
  };

  const start = (names: string[], m: Mode) => {
    spicy.current = dark === 'on';
    const first = m === 'teams' ? (Math.random() < 0.5 ? 0 : 1) : Math.floor(Math.random() * names.length);
    setMatch({ mode: m, names, goal: Number(goal), first, turn: 0, scores: m === 'teams' ? startScores(first as Team) : [0, 0], history: [] });
    dealTurn();
  };

  if (step.s === 'setup' || !match || !deal) {
    const m = mode;
    const n = players.length;
    const min = MIN_PLAYERS[m];
    const ready = n >= min;
    const teams = makeTeams(n);
    const go = () => start(players, m);
    return (
      <Screen
        key="setup"
        className="g-spectrum-screen g-spectrum-setup"
        center={false}
        title="Spectrum"
        sub="One player sees where the target hides and gives a clue. Everyone else turns the dial to find it."
        onEnter={ready ? go : undefined}
        actions={
          <Big primary disabled={!ready} onClick={go}>
            {ready ? 'Start' : `Add ${min - n} More ${min - n === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <HowToPlay steps={m === 'teams' ? teamRules(goal) : TOGETHER_RULES} />
        <PlayerList min={min} />
        <Option
          label="Mode"
          value={m}
          options={[
            ['teams', 'Teams'],
            ['together', 'Together'],
          ]}
          onChange={setMode}
        />
        {m === 'teams' ? (
          <>
            {!ready && n >= 2 && <p className="g-spectrum-note">Under 4 players? Together works with 2 or more.</p>}
            {ready && (
              <div className="g-spectrum-teams" aria-label="Teams">
                {teams.map((t, i) => (
                  <div key={i} className={`g-spectrum-team is-t${i}`}>
                    <b>{TEAM_NAMES[i]}</b>
                    <span>{listNames(t.map((s) => players[s]))}</span>
                  </div>
                ))}
              </div>
            )}
            <Option
              label="Play To"
              value={goal}
              options={[
                ['10', '10 Points'],
                ['15', '15 Points'],
              ]}
              onChange={setGoal}
            />
          </>
        ) : (
          <p className="g-spectrum-note">One team, {TOGETHER_CARDS} cards. How close to {TOGETHER_MAX} can you get?</p>
        )}
        <Option
          label="After Dark 18+"
          value={dark}
          options={[
            ['off', 'Off'],
            ['on', 'On'],
          ]}
          onChange={setDark}
        />
        {dark === 'on' && <p className="g-spectrum-note">After Dark is for groups who know each other well. The psychic can skip any card with New Card.</p>}
      </Screen>
    );
  }

  const { names, mode: mm } = match;
  const name = (i: number) => names[i] ?? `Player ${i + 1}`;
  const who = psychicFor(mm, names.length, match.turn, match.first);
  const psychic = name(who.seat);
  const teams = mm === 'teams';
  const over = teams ? winner(match.scores, match.goal) !== null : togetherDone(match.history.length);
  const lastTurn = match.history[match.history.length - 1];

  const finish = (call?: Side) => {
    const points = scoreGuess(deal.target, needle);
    const cp = teams && call ? callPoints(deal.target, needle, call) : 0;
    const turn: Turn = { card: deal.card, target: deal.target, needle, points, team: who.team, seat: who.seat, call, callPts: cp };
    ratchet();
    setMatch({ ...match, scores: teams ? addPoints(match.scores, who.team, points, cp) : [match.scores[0] + points, 0], history: [...match.history, turn] });
    setStep({ s: 'reveal' });
  };

  const next = () => {
    if (over) {
      sfx.play('win');
      setStep({ s: 'end' });
      return;
    }
    setMatch({ ...match, turn: match.turn + 1 });
    dealTurn();
  };

  if (step.s === 'pass')
    return (
      <PassTo
        key={`pass-${match.turn}`}
        className="g-spectrum-screen"
        name={psychic}
        index={who.seat}
        note={teams ? `You're the psychic for ${TEAM_NAMES[who.team]}. Nobody else looks.` : "You're the psychic this round. Nobody else looks."}
        onReady={() => setStep({ s: 'psychic' })}
      />
    );

  if (step.s === 'psychic') {
    const hide = () => setStep({ s: 'guess' });
    return (
      <Screen
        key={`psychic-${match.turn}`}
        className="g-spectrum-screen g-spectrum-play"
        arm={ARM}
        onEnter={hide}
        actions={
          <Row>
            <Big onClick={() => setDeal({ ...deal, card: draw() })}>New Card</Big>
            <Big primary onClick={hide}>
              Hide Target
            </Big>
          </Row>
        }
      >
        <p className="g-spectrum-secret">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 6.5s2.2 3.5 6 3.5 6-3.5 6-3.5M4.2 9.2L3 11M8 10v2.2M11.8 9.2L13 11" />
          </svg>
          Only {psychic} looks
        </p>
        <Board>
          <Dial card={deal.card} needle={null} target={deal.target} cover="open" />
        </Board>
        <div className="g-spectrum-tip">
          <p>Say one thing that lands on the 4. No numbers.</p>
          <p>{clueTip(deal.target, deal.card[0], deal.card[1])}</p>
        </div>
      </Screen>
    );
  }

  const bar = (flash?: Turn, shown?: boolean) => <ScoreBar match={match} team={flash ? flash.team : who.team} flash={flash} shown={shown} />;

  if (step.s === 'guess')
    return (
      <GuessScreen
        key={`guess-${match.turn}`}
        bar={bar()}
        card={deal.card}
        needle={needle}
        setNeedle={setNeedle}
        psychic={psychic}
        seat={who.seat}
        guessers={teams ? TEAM_NAMES[who.team] : 'Everyone else'}
        onLock={() => (teams ? setStep({ s: 'call' }) : finish())}
      />
    );

  if (step.s === 'call') return <CallScreen key={`call-${match.turn}`} bar={bar()} card={deal.card} needle={needle} caller={otherTeam(who.team)} onCall={finish} />;

  if (step.s === 'reveal' && lastTurn) {
    let sub: string;
    let called: ReactNode = null;
    if (teams) {
      const pts = lastTurn.points;
      sub = pts ? `${TEAM_NAMES[lastTurn.team]} scores ${pts}.` : `${TEAM_NAMES[lastTurn.team]} scores nothing.`;
      if (lastTurn.call) {
        // Named with the button's own word, so "called Right" can't be read as "called it right".
        const callers = otherTeam(lastTurn.team);
        const outcome = pts === 4 ? "Doesn't count on a bullseye." : lastTurn.callPts ? 'Correct, +1.' : 'Wrong side.';
        called = (
          <p className={`g-spectrum-called is-t${callers}`}>
            <Chevron side={lastTurn.call} />
            <span>
              {TEAM_SHORT[callers]} called <b>{lastTurn.call === 'left' ? 'Left' : 'Right'}</b>. {outcome}
            </span>
          </p>
        );
      }
    } else {
      const played = match.history.length;
      sub = played < TOGETHER_CARDS ? `${match.scores[0]} of ${played * 4} so far.` : `That was the last card.`;
    }
    const label = over ? (teams ? 'See Who Won' : 'See Your Score') : 'Next Turn';
    return <RevealScreen key={`reveal-${match.turn}`} turn={lastTurn} bar={(shown) => bar(lastTurn, shown)} sub={sub} called={called} label={label} onNext={next} />;
  }

  // The end of the match.
  const again = () => start(names, mm);
  const actions = (
    <>
      <Big primary onClick={again}>
        Play Again
      </Big>
      <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
    </>
  );
  if (teams) {
    const w = winner(match.scores, match.goal) ?? (match.scores[0] >= match.scores[1] ? 0 : 1);
    const lineup = makeTeams(names.length);
    const bulls = (t: Team) => match.history.filter((h) => h.team === t && h.points === 4).length;
    return (
      <Screen key="end" className="g-spectrum-screen" arm={ARM} kicker="Final score" title={`${TEAM_NAMES[w]} Wins`} onEnter={again} actions={actions}>
        <div className="g-spectrum-final" role="status">
          {([0, 1] as const).map((t) => (
            <div key={t} className={`g-spectrum-final-team is-t${t} ${t === w ? 'is-win' : ''}`}>
              <span className="g-spectrum-final-name">{TEAM_SHORT[t]}</span>
              <b>{match.scores[t]}</b>
              <small>{bulls(t) === 1 ? '1 bullseye' : `${bulls(t)} bullseyes`}</small>
              <span className="g-spectrum-final-who">{listNames(lineup[t].map(name))}</span>
            </div>
          ))}
        </div>
      </Screen>
    );
  }
  const total = match.scores[0];
  return (
    <Screen key="end" className="g-spectrum-screen" arm={ARM} onEnter={again} actions={actions}>
      <div className="g-spectrum-total" role="status">
        <p className="arcade-party-kicker">Your score</p>
        <p className="g-spectrum-total-num">
          <b>{total}</b>
          <span>of {TOGETHER_MAX}</span>
        </p>
        <p className="g-spectrum-rating">{rating(total)}</p>
      </div>
      <ul className="g-spectrum-history" aria-label="Every card">
        {match.history.map((t, i) => (
          <li key={i}>
            <Avatar name={name(t.seat)} index={t.seat} size={24} />
            <span>
              {t.card[0]} <em>to</em> {t.card[1]}
            </span>
            <b className={`g-spectrum-stamp is-p${t.points}`}>{t.points}</b>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

const TOGETHER_RULES = [
  <>
    Each turn one player is the <b>psychic</b>. They see a card with two extremes, like <b>Cold</b> and <b>Hot</b>, and where the target hides between them.
  </>,
  <>
    They give one clue that lands on the target. Just past the middle on Cold to Hot? <b>A warm bath.</b>
  </>,
  <>Everyone else talks it over, turns the needle and locks it in.</>,
  <>
    The middle of the target scores <b>4</b>, the bands either side <b>3</b>, the outer ones <b>2</b>.
  </>,
  <>
    Everyone plays as one team for {TOGETHER_CARDS} cards. A perfect game is {TOGETHER_MAX}.
  </>,
];

function teamRules(goal: string) {
  return [
    TOGETHER_RULES[0],
    TOGETHER_RULES[1],
    <>The psychic's team talks it over, turns the needle and locks it in.</>,
    TOGETHER_RULES[3],
    <>
      Then the other team calls <b>left</b> or <b>right</b>: which side of the needle is the target? Right call, 1 point. No call on a bullseye.
    </>,
    <>
      Teams take turns, first to {goal} wins. The team going second starts on 1 to even it out.
    </>,
  ];
}

/** The board and the card slotted under it, sized to fit what's left of the screen. */
function Board({ children }: { children: ReactNode }) {
  return <div className="g-spectrum-board">{children}</div>;
}

function ScoreBar({ match, team, flash, shown = true }: { match: Match; team: Team; flash?: Turn; shown?: boolean }) {
  if (match.mode === 'together') {
    const played = match.history.length;
    const card = Math.min(TOGETHER_CARDS, flash ? played : played + 1);
    const score = flash && !shown ? match.scores[0] - flash.points : match.scores[0];
    return (
      <div className="g-spectrum-bar">
        <span className="g-spectrum-chip">
          Card {card} of {TOGETHER_CARDS}
        </span>
        <span className="g-spectrum-chip">
          Score <b>{score}</b>
          {flash && shown && flash.points > 0 && <small>+{flash.points}</small>}
        </span>
      </div>
    );
  }
  const gain = (t: Team) => (!flash ? 0 : t === flash.team ? flash.points : flash.callPts);
  const scores = flash && !shown ? scoresBefore(match.scores, flash.team, flash.points, flash.callPts) : match.scores;
  return (
    <div className="g-spectrum-bar" aria-label="Scores">
      {([0, 1] as const).map((t) => (
        <span key={t} className={`g-spectrum-chip is-t${t} ${t === team ? 'is-up' : ''}`} style={{ order: t * 2 }}>
          <i aria-hidden="true" />
          {TEAM_SHORT[t]} <b>{scores[t]}</b>
          {shown && gain(t) > 0 && <small>+{gain(t)}</small>}
        </span>
      ))}
      <span className="g-spectrum-goal" style={{ order: 1 }}>
        to {match.goal}
      </span>
    </div>
  );
}

function GuessScreen({
  bar,
  card,
  needle,
  setNeedle,
  psychic,
  seat,
  guessers,
  onLock,
}: {
  bar: ReactNode;
  card: Card;
  needle: number;
  setNeedle: (fn: (v: number) => number) => void;
  psychic: string;
  seat: number;
  guessers: string;
  onLock: () => void;
}) {
  const shell = useShell();
  useKeys((code, e) => {
    const dir = code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
    if (!dir) return;
    setNeedle((v) => clampDial(v + dir * (e?.shiftKey ? 0.5 : 2)));
  });
  return (
    <Screen key="guess" className="g-spectrum-screen g-spectrum-play" arm={ARM} onEnter={onLock} actions={<Big primary onClick={onLock}>Lock It In</Big>}>
      {bar}
      <p className="g-spectrum-say">
        <Avatar name={psychic} index={seat} size={28} />
        <span>{psychic}, say your clue</span>
      </p>
      <Board>
        <Dial card={card} needle={needle} cover="close" onChange={(v) => setNeedle(() => v)} />
      </Board>
      <p className="g-spectrum-hint">
        {guessers}, {shell.touch ? 'drag or tap the dial.' : 'drag the dial or use the arrow keys.'}
      </p>
    </Screen>
  );
}

/** The arrow on the Left and Right buttons, and on the line that reports the call. */
function Chevron({ side }: { side: Side }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={side === 'left' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  );
}

function CallScreen({ bar, card, needle, caller, onCall }: { bar: ReactNode; card: Card; needle: number; caller: Team; onCall: (side: Side) => void }) {
  // An arrow still held or nudged a beat after Lock It In belongs to the guessers, not the call.
  const [shownAt] = useState(() => performance.now());
  useKeys((code, e) => {
    if (e?.repeat || performance.now() - shownAt < ARM) return;
    if (code === 'ArrowLeft' || code === 'KeyA') onCall('left');
    else if (code === 'ArrowRight' || code === 'KeyD') onCall('right');
  });
  return (
    <Screen
      key="call"
      className="g-spectrum-screen g-spectrum-play"
      arm={ARM}
      actions={
        <Row>
          <Big onClick={() => onCall('left')} className={`g-spectrum-side is-t${caller}`}>
            <Chevron side="left" />
            Left
          </Big>
          <Big onClick={() => onCall('right')} className={`g-spectrum-side is-t${caller}`}>
            Right
            <Chevron side="right" />
          </Big>
        </Row>
      }
    >
      {bar}
      <h2 className={`arcade-party-title g-spectrum-ask is-t${caller}`}>
        <span>{TEAM_NAMES[caller]}</span> Left or Right?
      </h2>
      <p className="g-spectrum-line">Which side of the needle is the target? Right call, 1 point.</p>
      <Board>
        <Dial card={card} needle={needle} cover="closed" />
      </Board>
    </Screen>
  );
}

function RevealScreen({ turn, bar, sub, called, label, onNext }: { turn: Turn; bar: (shown: boolean) => ReactNode; sub: string; called: ReactNode; label: string; onNext: () => void }) {
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);
  const show = () => {
    if (openedAt.current) return;
    openedAt.current = performance.now();
    setOpen(true);
    sfx.play(turn.points === 4 ? 'win' : turn.points > 0 ? 'coin' : 'lose');
  };
  // A tap before the shutter opens finishes the reveal. After it opens, the result stays up a moment, so the second
  // tap of a double tap can't skip it.
  const go = () => {
    if (!openedAt.current) show();
    else if (performance.now() - openedAt.current >= SETTLE) onNext();
  };
  return (
    <Screen
      key="reveal"
      className={`g-spectrum-screen g-spectrum-play g-spectrum-reveal ${open ? 'is-open' : ''}`}
      arm={ARM}
      onEnter={go}
      actions={
        <Big primary quiet={!open} onClick={go}>
          {open ? label : 'Reveal'}
        </Big>
      }
    >
      {bar(open)}
      <div className="g-spectrum-verdict" role="status">
        {open && (
          <>
            <h2 className="arcade-party-title">
              {verdict(turn.points)}
              <b className={`g-spectrum-stamp is-p${turn.points}`}>{turn.points ? `+${turn.points}` : '0'}</b>
            </h2>
            <div className="g-spectrum-result">
              <p className="g-spectrum-line">{sub}</p>
              {called}
            </div>
          </>
        )}
      </div>
      <Board>
        <Dial card={turn.card} needle={turn.needle} target={turn.target} cover={open ? 'shown' : 'reveal'} points={turn.points} onOpen={show} />
      </Board>
    </Screen>
  );
}
