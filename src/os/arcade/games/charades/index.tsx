import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Chips, Countdown, Option, PassTo, Pile, PlayerList, Screen, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  MIN_PLAYERS,
  bestTurn,
  buildTeams,
  canStart,
  finishTurn,
  isLastTurn,
  isOver,
  leader,
  longestToken,
  points,
  scores,
  toggleCard,
  turnAt,
  wordsFor,
  type Card,
  type Entry,
  type Played,
  type TeamIndex,
  type Teams,
  type TurnStyle,
} from './logic';
import { meta } from './meta';
import { DECKS, DECK_IDS, type DeckId } from './words';
import './charades.css';

const STYLE = defineSetting('charades:style', ['act', 'describe', 'mix'] as const, 'act');
const TIME = defineSetting('charades:time', ['30', '60', '90'] as const, '60');
const ROUNDS = defineSetting('charades:rounds', ['3', '5', '8'] as const, '5');
const DEFAULT_DECKS = DECK_IDS.filter((id) => id !== 'hard');
const parseDecks = (raw: unknown): DeckId[] => {
  const ids = Array.isArray(raw) ? DECK_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : DEFAULT_DECKS;
};
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);

const TEAMS = [
  { name: 'Team 1', color: '#2ec5f0' },
  { name: 'Team 2', color: '#a77bff' },
] as const;
const teamStyle = (t: TeamIndex) => ({ ['--team' as string]: TEAMS[t].color }) as CSSProperties;
const other = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);

const STYLES: Record<TurnStyle, { label: string; verb: string; rule: string }> = {
  act: { label: 'Act It Out', verb: 'Acts', rule: 'No talking, no sounds, no pointing at things in the room.' },
  describe: { label: 'Describe It', verb: 'Describes', rule: 'Say anything except the word, part of it, or what it rhymes with.' },
};

/** Seconds per beat of the 3-2-1, and how long Time's Up stays before the review. */
const BEAT = 0.7;
const HOLD = 1.6;

type Step =
  | { s: 'setup' }
  | { s: 'pass' }
  | { s: 'ready' }
  | { s: 'count' }
  | { s: 'play' }
  | { s: 'up' }
  | { s: 'review' }
  | { s: 'board'; last: Played }
  | { s: 'done' };

type Shown = { entry: Entry; n: number };
type Fx = { n: number; got: boolean; word: string };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [style, setStyle] = useSetting(STYLE);
  const [time, setTime] = useSetting(TIME);
  const [roundsSetting, setRounds] = useSetting(ROUNDS);
  const [decks, setDecks] = useStored<DeckId[]>('charades:decks', DEFAULT_DECKS, parseDecks);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [history, setHistory] = useState<Played[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [beat, setBeat] = useState(3);
  const pile = useRef<{ key: string; pile: Pile<Entry> } | null>(null);
  const last = useRef<Entry | undefined>(undefined);
  const phase = useRef({ t: 0, beat: 3, done: true });
  const lastTap = useRef(0);
  const streak = useRef(0);
  const dealt = useRef(0);

  const seconds = Number(time);
  const rounds = Number(roundsSetting);
  const teams: Teams = useMemo(() => buildTeams(table.length), [table.length]);
  const turn = turnAt(history.length, teams, style);
  const name = (seat: number) => table[seat] ?? `Player ${seat + 1}`;

  const draw = (): Shown | null => {
    const key = decks.join(',');
    if (pile.current?.key !== key) pile.current = { key, pile: new Pile(wordsFor(decks)) };
    const entry = pile.current.pile.draw(last.current);
    if (!entry) return null;
    last.current = entry;
    return { entry, n: ++dealt.current };
  };

  const timeUp = () => {
    sfx.tone({ freq: 150, to: 110, dur: 0.8, type: 'sawtooth', vol: 0.22 });
    sfx.tone({ freq: 157, to: 116, dur: 0.8, type: 'square', vol: 0.09 });
    if (shown) setCards((c) => [...c, { word: shown.entry.word, got: false, buzzer: true }]);
    phase.current = { t: 0, beat: 0, done: false };
    setStep({ s: 'up' });
  };
  const clock = useCountdown(seconds, { running: step.s === 'play', onEnd: timeUp });

  const go = () => {
    streak.current = 0;
    lastTap.current = 0;
    setCards([]);
    setFx(null);
    setShown(draw());
    clock.reset(seconds);
    sfx.tone({ freq: 660, to: 1320, dur: 0.22, type: 'square', vol: 0.14 });
    setStep({ s: 'play' });
  };

  const startCount = () => {
    phase.current = { t: 0, beat: 3, done: false };
    setBeat(3);
    setFx(null);
    setShown(null);
    clock.reset(seconds);
    sfx.play('tick');
    setStep({ s: 'count' });
  };

  // The 3-2-1 before a turn and the Time's Up hold after it, both paused with the game.
  useGameLoop((dt) => {
    const p = phase.current;
    if (p.done || (step.s !== 'count' && step.s !== 'up')) return;
    p.t += dt;
    if (step.s === 'count') {
      const n = 3 - Math.floor(p.t / BEAT);
      if (n <= 0) {
        p.done = true;
        go();
      } else if (n !== p.beat) {
        p.beat = n;
        setBeat(n);
        sfx.play('tick', n === 1 ? 1.3 : 1.1);
      }
    } else if (p.t >= HOLD) {
      p.done = true;
      setStep({ s: 'review' });
    }
  });

  const mark = (got: boolean) => {
    if (step.s !== 'play' || !shown) return;
    const now = performance.now();
    if (now - lastTap.current < 180) return;
    lastTap.current = now;
    setCards((c) => [...c, { word: shown.entry.word, got }]);
    setFx({ n: shown.n, got, word: shown.entry.word });
    if (got) sfx.play('coin', 1 + Math.min(streak.current, 8) * 0.05);
    else sfx.play('blip', 0.7);
    streak.current = got ? streak.current + 1 : 0;
    setShown(draw());
  };

  useKeys((code, e) => {
    if (e?.repeat || step.s !== 'play') return;
    if (code === 'ArrowLeft') mark(false);
    else if (code === 'ArrowRight' || code === 'Space') mark(true);
  });

  const start = (names: string[]) => {
    setTable(names);
    setHistory([]);
    setCards([]);
    setStep({ s: 'pass' });
  };

  const next = () => {
    const played = finishTurn(turn, cards);
    const all = [...history, played];
    setHistory(all);
    setCards([]);
    if (isOver(all.length, rounds)) {
      sfx.play('win');
      setStep({ s: 'done' });
    } else setStep({ s: 'board', last: played });
  };

  if (step.s === 'setup' || table.length < MIN_PLAYERS) {
    const n = players.length;
    const ready = canStart(n);
    const short = MIN_PLAYERS - n;
    return (
      <Screen
        key="setup"
        center={false}
        title="Charades"
        sub="Two teams take turns against the clock. Act it out or talk around it while your team shouts guesses."
        onEnter={ready ? () => start(players) : undefined}
        actions={
          <Big primary disabled={!ready} onClick={() => start(players)}>
            {ready ? 'Start' : `Add ${short} More ${short === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <PlayerList min={MIN_PLAYERS} />
        {n > 0 && <TeamList names={players} teams={buildTeams(n)} />}
        <Option label="Style" value={style} options={[['act', 'Act It Out'], ['describe', 'Describe It'], ['mix', 'Mix']]} onChange={setStyle} />
        <Option label="Turn Time" value={time} options={[['30', '30 Sec'], ['60', '60 Sec'], ['90', '90 Sec']]} onChange={setTime} />
        <Option label="Play To" value={roundsSetting} options={[['3', '3 Rounds'], ['5', '5 Rounds'], ['8', '8 Rounds']]} onChange={setRounds} />
        <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      </Screen>
    );
  }

  const team = TEAMS[turn.team];
  const how = STYLES[turn.style];

  if (step.s === 'pass')
    return <PassTo key={`pass-${turn.index}`} name={name(turn.actor)} index={turn.actor} note="Your team guesses. Everyone else, no peeking." onReady={() => setStep({ s: 'ready' })} />;

  if (step.s === 'ready')
    return (
      <Screen
        key={`ready-${turn.index}`}
        title={`${team.name}, Round ${turn.round}`}
        sub="Hold the phone so only you can see the word."
        onEnter={startCount}
        actions={
          <Big primary onClick={startCount}>
            Go
          </Big>
        }
      >
        <div className="arcade-party-card g-charades-ready" style={{ ...teamStyle(turn.team), ['--accent' as string]: team.color }}>
          <Avatar name={name(turn.actor)} index={turn.actor} size={56} />
          <small>{how.label}</small>
          <strong>
            {name(turn.actor)} {how.verb}
          </strong>
          <p>{how.rule}</p>
        </div>
        <ul className="g-charades-facts">
          <li>{seconds} seconds</li>
          <li>{isLastTurn(turn.index, rounds) ? 'Last turn' : `Round ${turn.round} of ${rounds}`}</li>
          <li>Skips cost nothing</li>
        </ul>
      </Screen>
    );

  if (step.s === 'count' || step.s === 'play' || step.s === 'up') {
    const live = step.s === 'play';
    const low = live && clock.left <= 10;
    const pts = points(cards);
    return (
      <Stage key={`stage-${turn.index}`} className={[low ? 'is-low' : '', step.s === 'up' ? 'is-up' : ''].join(' ')} team={turn.team}>
        <div className="g-charades-hud">
          <div className="g-charades-who">
            <b>{team.name}</b>
            <span>{how.label}</span>
          </div>
          <Countdown left={clock.left} total={seconds} size={84} />
          <div className="g-charades-pts" aria-live="polite">
            <b key={`p${pts}`}>{pts}</b>
            <span>{pts === 1 ? 'Point' : 'Points'}</span>
            {fx?.got && <i key={`f${fx.n}`}>+1</i>}
          </div>
        </div>
        <div className="g-charades-wordbox">
          {step.s === 'count' ? (
            <div className="g-charades-card is-count">
              <small>{name(turn.actor)} {how.verb.toLowerCase()}</small>
              <strong key={beat} className="g-charades-beat">
                {beat}
              </strong>
              <p>Get ready</p>
            </div>
          ) : (
            shown && (
              <div key={`w${shown.n}`} className="g-charades-card" style={{ ['--len' as string]: Math.max(5, longestToken(shown.entry.word)) }}>
                <small>{DECKS[shown.entry.deck].label}</small>
                <strong>{shown.entry.word}</strong>
              </div>
            )
          )}
          {fx && step.s !== 'count' && (
            <div key={`out-${fx.n}`} className={`g-charades-card is-out ${fx.got ? 'is-got' : 'is-skip'}`} style={{ ['--len' as string]: Math.max(5, longestToken(fx.word)) }} aria-hidden="true">
              <small>{fx.got ? 'Got It' : 'Skipped'}</small>
              <strong>{fx.word}</strong>
            </div>
          )}
          {step.s === 'up' && (
            <div className="g-charades-stamp" role="status">
              <span>Time's Up</span>
            </div>
          )}
        </div>
        <Zone kind="skip" disabled={!live} onPress={() => mark(false)} />
        <Zone kind="got" disabled={!live} onPress={() => mark(true)} />
        {fx && <div key={`flash-${fx.n}`} className={`g-charades-flash ${fx.got ? 'is-got' : 'is-skip'}`} aria-hidden="true" />}
      </Stage>
    );
  }

  const lastTurn = isLastTurn(turn.index, rounds);

  if (step.s === 'review') {
    const pts = points(cards);
    return (
      <Screen
        key={`review-${turn.index}`}
        center={false}
        title="Time's Up"
        sub={cards.length ? 'Tap a word to fix a mistake.' : 'No words this turn. It happens.'}
        onEnter={next}
        actions={
          <Big primary onClick={next}>
            {lastTurn ? 'See Final Scores' : `Next: ${TEAMS[other(turn.team)].name}`}
          </Big>
        }
      >
        <div className="g-charades-total" style={teamStyle(turn.team)}>
          <b key={pts}>{pts}</b>
          <span>
            {pts === 1 ? 'point' : 'points'} for {team.name}
          </span>
        </div>
        {cards.length > 0 && (
          <ul className="g-charades-review" aria-label="Words this turn">
            {cards.map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={c.got}
                  className={c.got ? 'is-got' : c.buzzer ? 'is-buzzer' : 'is-skip'}
                  onClick={() => {
                    sfx.play(c.got ? 'blip' : 'coin', c.got ? 0.7 : 1);
                    setCards(toggleCard(cards, i));
                  }}
                >
                  <span>{c.word}</span>
                  <em>
                    {c.got && (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {c.got ? 'Got It' : c.buzzer ? 'At the Buzzer' : 'Skipped'}
                  </em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Screen>
    );
  }

  const sc = scores(history);

  if (step.s === 'board') {
    const lead = leader(sc);
    const pass = () => setStep({ s: 'pass' });
    return (
      <Screen
        key={`board-${turn.index}`}
        title={lead === null ? 'All Tied Up' : `${TEAMS[lead].name} Leads`}
        sub={`${lastTurn ? 'Last turn' : `Round ${turn.round} of ${rounds}`}. ${team.name} is up and ${name(turn.actor)} ${how.verb.toLowerCase()}.`}
        onEnter={pass}
        actions={
          <Big primary onClick={pass}>
            Pass to {name(turn.actor)}
          </Big>
        }
      >
        <Tallies scores={sc} names={table} teams={teams} plus={{ team: step.last.team, n: step.last.points }} tag={[turn.team, 'Up Next']} />
        <Rounds history={history} rounds={rounds} next={turn.index} />
      </Screen>
    );
  }

  const win = leader(sc);
  const best = bestTurn(history);
  const [hi, lo] = sc[0] >= sc[1] ? sc : [sc[1], sc[0]];
  return (
    <Screen
      key="done"
      className="g-charades-done"
      title={win === null ? "It's a Tie" : `${TEAMS[win].name} Wins`}
      sub={win === null ? `${hi} each after ${rounds} rounds. Rematch?` : `${hi} to ${lo} after ${rounds} rounds.`}
      onEnter={() => start(table)}
      actions={
        <>
          <Big primary onClick={() => start(table)}>
            Play Again
          </Big>
          <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
        </>
      }
    >
      <Confetti colors={win === null ? [TEAMS[0].color, TEAMS[1].color, meta.accent] : [TEAMS[win].color, meta.accent, '#ffd23f']} />
      <Tallies scores={sc} names={table} teams={teams} hi={win} tag={win === null ? undefined : [win, 'Winner']} />
      {best && (
        <div className="arcade-party-card is-plain g-charades-best">
          <small>Best Turn</small>
          <strong>
            {name(best.actor)}, {best.points} {best.points === 1 ? 'Point' : 'Points'}
          </strong>
          <p>
            {TEAMS[best.team].name}, round {best.round}, {best.style === 'act' ? 'acting it out' : 'describing'}.
          </p>
        </div>
      )}
    </Screen>
  );
}

/** The full-screen play area: refocuses the game so the arrow keys and Space work right after Go. */
function Stage({ team, className, children }: { team: TeamIndex; className: string; children: ReactNode }) {
  const shell = useShell();
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !shell.root.current?.contains(active)) shell.root.current?.focus({ preventScroll: true });
  }, [shell.root]);
  return (
    <div className={`g-charades-stage ${className}`} style={teamStyle(team)}>
      <div className="g-charades-play">{children}</div>
    </div>
  );
}

function Zone({ kind, disabled, onPress }: { kind: 'skip' | 'got'; disabled: boolean; onPress: () => void }) {
  const { touch } = useShell();
  const got = kind === 'got';
  return (
    <button
      type="button"
      className={`g-charades-zone is-${kind}`}
      disabled={disabled}
      aria-label={got ? 'Got It' : 'Skip'}
      // Keep focus on the game, so Space always means Got It instead of clicking the last zone tapped.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {got ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span>{got ? 'Got It' : 'Skip'}</span>
      {!touch && <kbd>{got ? 'Right or Space' : 'Left arrow'}</kbd>}
    </button>
  );
}

function Tallies({
  scores: sc,
  names,
  teams,
  hi = null,
  plus,
  tag,
}: {
  scores: [number, number];
  names: string[];
  teams: Teams;
  hi?: TeamIndex | null;
  plus?: { team: TeamIndex; n: number };
  tag?: [TeamIndex, string];
}) {
  return (
    <div className="g-charades-tallies">
      {([0, 1] as const).map((t) => (
        <div key={t} className={`g-charades-tally ${hi === t ? 'is-hi' : ''} ${tag?.[0] === t ? 'is-tagged' : ''}`} style={teamStyle(t)}>
          {tag?.[0] === t && <small>{tag[1]}</small>}
          <span className="g-charades-tally-name">{TEAMS[t].name}</span>
          <b>{sc[t]}</b>
          {plus?.team === t && <em>+{plus.n}</em>}
          <span className="g-charades-faces" role="img" aria-label={names.length ? teams[t].map((s) => names[s]).join(', ') : undefined}>
            {teams[t].map((s) => (
              <Avatar key={s} name={names[s] ?? '?'} index={s} size={22} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Rounds({ history, rounds, next }: { history: Played[]; rounds: number; next: number }) {
  return (
    <table className="g-charades-rounds" aria-label="Points by round">
      <thead>
        <tr>
          <th scope="col">Round</th>
          {TEAMS.map((t, i) => (
            <th key={i} scope="col" style={teamStyle(i as TeamIndex)}>
              {t.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rounds }, (_, r) => (
          <tr key={r}>
            <th scope="row">{r + 1}</th>
            {([0, 1] as const).map((t) => {
              const i = r * 2 + t;
              const played = history[i];
              return (
                <td key={t} className={played ? undefined : i === next ? 'is-next' : 'is-empty'} style={i === next ? teamStyle(t) : undefined}>
                  {played ? played.points : i === next ? 'Next' : '\u00b7'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamList({ names, teams }: { names: string[]; teams: Teams }) {
  return (
    <div className="arcade-party-field">
      <span>Teams</span>
      <div className="g-charades-teams">
        {([0, 1] as const).map((t) => (
          <section key={t} className="g-charades-team" style={teamStyle(t)} aria-label={TEAMS[t].name}>
            <h3>
              {TEAMS[t].name}
              <em>{teams[t].length}</em>
            </h3>
            {teams[t].length ? (
              <ul>
                {teams[t].map((s) => (
                  <li key={names[s]}>
                    <Avatar name={names[s]} index={s} size={22} />
                    <span>{names[s]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Next player joins here.</p>
            )}
          </section>
        ))}
      </div>
      <small>Seats alternate between teams.{teams[0].length !== teams[1].length ? ' Team 1 gets the extra player.' : ''}</small>
    </div>
  );
}

const CONFETTI = Array.from({ length: 22 }, (_, i) => ({ x: (i * 37) % 100, d: (i % 7) * 0.12, r: (i * 53) % 360, s: 0.8 + ((i * 29) % 5) / 10 }));

function Confetti({ colors }: { colors: string[] }) {
  return (
    <div className="g-charades-confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <i key={i} style={{ left: `${c.x}%`, background: colors[i % colors.length], animationDelay: `${c.d}s`, ['--r' as string]: `${c.r}deg`, ['--s' as string]: c.s }} />
      ))}
    </div>
  );
}
