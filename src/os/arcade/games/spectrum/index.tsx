import { useRef, useState, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Option, PassTo, Pile, PlayerList, Row, Screen, listNames, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { CARDS, type Card } from './cards';
import { CardLabels, Dial } from './dial';
import {
  MIN_PLAYERS,
  NEEDLE_START,
  TOGETHER_CARDS,
  TOGETHER_MAX,
  addPoints,
  callPoints,
  clampDial,
  makeTeams,
  otherTeam,
  psychicFor,
  randomTarget,
  rating,
  scoreGuess,
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

const TEAM_NAMES = ['Teal Team', 'Coral Team'] as const;
const TEAM_SHORT = ['Teal', 'Coral'] as const;

type Turn = { card: Card; target: number; needle: number; points: Points; team: Team; seat: number; call?: Side; callPts: 0 | 1 };
type Match = { mode: Mode; names: string[]; goal: number; first: number; turn: number; scores: [number, number]; history: Turn[] };
type Deal = { card: Card; target: number };
type Step = { s: 'setup' } | { s: 'pass' } | { s: 'psychic' } | { s: 'guess' } | { s: 'call' } | { s: 'reveal' } | { s: 'end' };

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
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [match, setMatch] = useState<Match | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [needle, setNeedle] = useState(NEEDLE_START);
  const pile = useRef<Pile<Card> | null>(null);
  const last = useRef<Card | undefined>(undefined);

  const draw = (): Card => {
    if (!pile.current) pile.current = new Pile(CARDS);
    const card = pile.current.draw(last.current) ?? CARDS[0];
    last.current = card;
    return card;
  };

  const dealTurn = () => {
    setDeal({ card: draw(), target: randomTarget() });
    setNeedle(NEEDLE_START);
    setStep({ s: 'pass' });
  };

  const start = (names: string[], m: Mode) => {
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
        className="g-spectrum-screen"
        center={false}
        title="Spectrum"
        sub="One player sees where the target hides between two extremes and gives a clue. Everyone else turns the dial."
        onEnter={ready ? go : undefined}
        actions={
          <Big primary disabled={!ready} onClick={go}>
            {ready ? 'Start' : `Add ${min - n} More ${min - n === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
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
            {!ready && n >= 2 && <p className="g-spectrum-note">Fewer than 4? Together works with 2 or more.</p>}
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
            {ready && <p className="g-spectrum-note">Teams sit alternating. The team that goes second starts with 1 point.</p>}
          </>
        ) : (
          <p className="g-spectrum-note">Everyone plays on one side. {TOGETHER_CARDS} cards, and see how close to {TOGETHER_MAX} you get.</p>
        )}
      </Screen>
    );
  }

  const { names, mode: mm } = match;
  const name = (i: number) => names[i] ?? `Player ${i + 1}`;
  const who = psychicFor(mm, names.length, match.turn, match.first);
  const psychic = name(who.seat);
  const teams = mm === 'teams';
  const guessers = teams ? TEAM_NAMES[who.team] : 'Everyone';
  const over = teams ? winner(match.scores, match.goal) !== null : togetherDone(match.history.length);
  const lastTurn = match.history[match.history.length - 1];

  const finish = (call?: Side) => {
    const points = scoreGuess(deal.target, needle);
    const cp = teams && call ? callPoints(deal.target, needle, call) : 0;
    const turn: Turn = { card: deal.card, target: deal.target, needle, points, team: who.team, seat: who.seat, call, callPts: cp };
    sfx.play(points === 4 ? 'win' : points > 0 ? 'coin' : 'lose');
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

  const bar = <ScoreBar match={match} team={who.team} />;

  if (step.s === 'pass')
    return (
      <PassTo
        key={`pass-${match.turn}`}
        name={psychic}
        index={who.seat}
        note={teams ? `${TEAM_NAMES[who.team]} is up. Only you look. Think of a clue.` : 'Only you look. Think of a clue.'}
        onReady={() => setStep({ s: 'psychic' })}
      />
    );

  if (step.s === 'psychic') {
    const hide = () => setStep({ s: 'guess' });
    return (
      <Screen
        key={`psychic-${match.turn}`}
        className="g-spectrum-screen"
        onEnter={hide}
        actions={
          <Row>
            <Big onClick={() => setDeal({ ...deal, card: draw() })}>New Card</Big>
            <Big primary onClick={hide}>
              Hide the Target
            </Big>
          </Row>
        }
      >
        <p className="g-spectrum-kicker">Only {psychic} sees this</p>
        <p className="g-spectrum-line">Give a clue that points at the 4. One idea, no numbers.</p>
        <CardLabels card={deal.card} />
        <div className="g-spectrum-dialbox">
          <Dial card={deal.card} needle={null} target={deal.target} bands="shown" />
        </div>
      </Screen>
    );
  }

  if (step.s === 'guess')
    return (
      <GuessScreen
        key={`guess-${match.turn}`}
        bar={bar}
        card={deal.card}
        needle={needle}
        setNeedle={setNeedle}
        psychic={psychic}
        seat={who.seat}
        guessers={guessers}
        onLock={() => (teams ? setStep({ s: 'call' }) : finish())}
      />
    );

  if (step.s === 'call') return <CallScreen key={`call-${match.turn}`} bar={bar} card={deal.card} needle={needle} caller={otherTeam(who.team)} onCall={finish} />;

  if (step.s === 'reveal' && lastTurn) {
    const pts = lastTurn.points;
    const callers = TEAM_NAMES[otherTeam(lastTurn.team)];
    let sub: string;
    if (teams) {
      const scored = `${TEAM_NAMES[lastTurn.team]} ${pts ? `scores ${pts}` : 'scores nothing'}.`;
      const call = !lastTurn.call ? '' : pts === 4 ? ` Bullseye, so the ${callers} call doesn't count.` : lastTurn.callPts ? ` ${callers} called ${lastTurn.call} and got it, +1.` : ` ${callers} called ${lastTurn.call}. No point.`;
      sub = scored + call;
    } else {
      const played = match.history.length;
      sub = played < TOGETHER_CARDS ? `${match.scores[0]} of a possible ${played * 4} so far.` : `That was the last card. ${match.scores[0]} of ${TOGETHER_MAX} in all.`;
    }
    const label = over ? (teams ? 'See Who Won' : 'See Your Score') : 'Next Turn';
    return (
      <Screen key={`reveal-${match.turn}`} className="g-spectrum-screen g-spectrum-reveal" onEnter={next} actions={<Big primary onClick={next}>{label}</Big>}>
        <ScoreBar match={match} team={lastTurn.team} flash={lastTurn} />
        <h2 className={`arcade-party-title g-spectrum-verdict is-p${pts}`}>
          {verdict(pts)}
          <span className="g-spectrum-pts">{pts ? `+${pts}` : '0'}</span>
        </h2>
        <p className="g-spectrum-line">{sub}</p>
        <CardLabels card={lastTurn.card} />
        <div className="g-spectrum-dialbox">
          <Dial card={lastTurn.card} needle={lastTurn.needle} target={lastTurn.target} bands="reveal" points={pts} />
        </div>
      </Screen>
    );
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
    const [a, b] = match.scores;
    return (
      <Screen key="end" className="g-spectrum-screen" title={`${TEAM_NAMES[w]} Wins`} sub={`${Math.max(a, b)} to ${Math.min(a, b)}. Great minds, mostly thinking alike.`} onEnter={again} actions={actions}>
        <div className={`g-spectrum-trophy is-t${w}`} aria-hidden="true">
          <svg viewBox="0 0 48 48" width="64" height="64">
            <path d="M15 8h18v9a9 9 0 0 1-18 0zM15 11H9v3a6 6 0 0 0 6 6M33 11h6v3a6 6 0 0 1-6 6M24 26v8M17 40h14M19 34h10v6H19z" />
          </svg>
        </div>
        <ul className="arcade-party-scores" aria-label="Final scores">
          {makeTeams(names.length).map((t, i) => (
            <li key={i} className={`g-spectrum-row is-t${i} ${i === w ? 'is-hi' : ''}`}>
              <i aria-hidden="true" />
              <span>
                {TEAM_NAMES[i]}
                <small>{listNames(t.map(name))}</small>
              </span>
              <b>{match.scores[i]}</b>
            </li>
          ))}
        </ul>
      </Screen>
    );
  }
  const total = match.scores[0];
  return (
    <Screen key="end" className="g-spectrum-screen" center={false} onEnter={again} actions={actions}>
      <p className="arcade-party-kicker">Your score</p>
      <p className="g-spectrum-total">
        <b>{total}</b>
        <span>/ {TOGETHER_MAX}</span>
      </p>
      <p className="g-spectrum-rating">{rating(total)}</p>
      <ul className="arcade-party-scores g-spectrum-history" aria-label="Every card">
        {match.history.map((t, i) => (
          <li key={i} className={t.points === 4 ? 'is-hi' : undefined}>
            <Avatar name={name(t.seat)} index={t.seat} size={24} />
            <span>
              {t.card[0]} <em>vs</em> {t.card[1]}
            </span>
            <b>{t.points}</b>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function ScoreBar({ match, team, flash }: { match: Match; team: Team; flash?: Turn }) {
  if (match.mode === 'together') {
    const played = match.history.length;
    const card = Math.min(TOGETHER_CARDS, flash ? played : played + 1);
    return (
      <div className="g-spectrum-bar">
        <span className="g-spectrum-chip">
          Card {card} of {TOGETHER_CARDS}
        </span>
        <span className={`g-spectrum-chip is-score ${flash ? 'is-flash' : ''}`} key={flash ? played : 'score'}>
          Score <b>{match.scores[0]}</b>
        </span>
      </div>
    );
  }
  const gain = (t: Team) => (!flash ? 0 : t === flash.team ? flash.points : flash.callPts);
  return (
    <div className="g-spectrum-bar" aria-label="Scores">
      {([0, 1] as const).map((t) => (
        <span key={t} className={`g-spectrum-chip is-t${t} ${t === team ? 'is-up' : ''} ${gain(t) ? 'is-flash' : ''}`} style={{ order: t * 2 }}>
          <i aria-hidden="true" />
          {TEAM_SHORT[t]} <b>{match.scores[t]}</b>
          {gain(t) > 0 && <small>+{gain(t)}</small>}
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
    <Screen key="guess" className="g-spectrum-screen" onEnter={onLock} actions={<Big primary onClick={onLock}>Lock It In</Big>}>
      {bar}
      <p className="g-spectrum-clue">
        <Avatar name={psychic} index={seat} size={24} />
        <span>
          <b>{psychic}'s clue:</b> say it out loud.
        </span>
      </p>
      <CardLabels card={card} />
      <div className="g-spectrum-dialbox">
        <Dial card={card} needle={needle} onChange={(v) => setNeedle(() => v)} />
      </div>
      <p className="g-spectrum-hint">
        {guessers}, {shell.touch ? 'drag or tap the dial.' : 'drag the dial or use the arrow keys.'}
      </p>
    </Screen>
  );
}

function CallScreen({ bar, card, needle, caller, onCall }: { bar: ReactNode; card: Card; needle: number; caller: Team; onCall: (side: Side) => void }) {
  useKeys((code, e) => {
    if (e?.repeat) return;
    if (code === 'ArrowLeft' || code === 'KeyA') onCall('left');
    else if (code === 'ArrowRight' || code === 'KeyD') onCall('right');
  });
  return (
    <Screen
      key="call"
      className="g-spectrum-screen"
      actions={
        <Row>
          <Big onClick={() => onCall('left')} className={`g-spectrum-side is-t${caller}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Left
          </Big>
          <Big onClick={() => onCall('right')} className={`g-spectrum-side is-t${caller}`}>
            Right
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </Big>
        </Row>
      }
    >
      {bar}
      <h2 className="arcade-party-title g-spectrum-ask">{TEAM_NAMES[caller]}: Left or Right?</h2>
      <p className="g-spectrum-line">Is the target left or right of the needle? Call it correctly for 1 point.</p>
      <CardLabels card={card} />
      <div className="g-spectrum-dialbox">
        <Dial card={card} needle={needle} />
      </div>
    </Screen>
  );
}

