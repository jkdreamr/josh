import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Chips, Countdown, HowToPlay, Option, Pile, PlayerList, Row, Screen, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  FIRST_GAME,
  MIN_PLAYERS,
  bestTurn,
  buildTeams,
  canStart,
  finishTurn,
  isLastTurn,
  isOver,
  leader,
  nextOrder,
  points,
  roundLabel,
  scores,
  toggleCard,
  turnAt,
  wordsFor,
  type Card,
  type Entry,
  type Order,
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
  { name: 'Blue Team', short: 'Blue', color: '#4db4ff' },
  { name: 'Gold Team', short: 'Gold', color: '#ffc83d' },
] as const;
/** Team color as --team, and as the accent for kit cards inside it (dark ink reads on both colors). */
const teamStyle = (t: TeamIndex) =>
  ({
    ['--team' as string]: TEAMS[t].color,
    ['--accent' as string]: TEAMS[t].color,
    ['--on-accent' as string]: '#16120f',
    ['--party-accent-edge' as string]: `color-mix(in srgb, ${TEAMS[t].color} 52%, #000)`,
  }) as CSSProperties;

const STYLES: Record<TurnStyle, { label: string; hud: string; past: string; rule: string }> = {
  act: { label: 'Act It Out', hud: 'Act it out', past: 'acting it out', rule: 'No talking, no sounds, no pointing at things in the room.' },
  describe: { label: 'Describe It', hud: 'Describe it', past: 'describing', rule: 'Say anything but the word, part of it, or what it rhymes with.' },
};

const HOW = [
  <>
    Seats alternate between <b>Blue</b> and <b>Gold</b>. Teams take turns, and everyone gets a go.
  </>,
  <>On your turn, hold the phone so only you can see it. Get your team to say the word before the buzzer.</>,
  <>
    <b>Act it out:</b> no talking, no sounds, no pointing at things in the room. <b>Describe it:</b> say anything but the word, part of it, or a rhyme.
  </>,
  <>
    Tap <b>Got It</b> when someone says it. <b>Skip</b> is free, so don't get stuck.
  </>,
  <>After the buzzer, fix any mistakes. Most points after the last round wins.</>,
];

/** Seconds per beat of the 3-2-1, and how long Time's Up stays before the review. */
const BEAT = 0.7;
const HOLD = 1.6;

type Step = { s: 'setup' } | { s: 'turn' } | { s: 'count' } | { s: 'play' } | { s: 'up' } | { s: 'review' } | { s: 'done' };

type Shown = { entry: Entry; n: number };
type Fx = { n: number; got: boolean; word: string; size: string };

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
  const [order, setOrder] = useState<Order>(FIRST_GAME);
  const [extra, setExtra] = useState(0);
  const [series, setSeries] = useState<[number, number]>([0, 0]);
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
  const word = useRef<HTMLElement | null>(null);

  const seconds = Number(time);
  const rounds = Number(roundsSetting);
  const total = rounds + extra;
  const teams: Teams = useMemo(() => buildTeams(table.length), [table.length]);
  const turn = turnAt(history.length, teams, style, order);
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
    setFx({ n: shown.n, got, word: shown.entry.word, size: word.current?.style.fontSize ?? '' });
    if (got) sfx.play('coin', 1 + Math.min(streak.current, 8) * 0.05);
    else sfx.play('blip', 0.7);
    streak.current = got ? streak.current + 1 : 0;
    setShown(draw());
  };

  useKeys((code, e) => {
    if (e?.repeat || step.s !== 'play') return;
    if (code === 'ArrowLeft') mark(false);
    else if (code === 'ArrowRight' || code === 'Space' || code === 'Enter') mark(true);
  });

  const fresh = () => {
    setHistory([]);
    setCards([]);
    setExtra(0);
    setStep({ s: 'turn' });
  };
  const begin = (names: string[]) => {
    setTable(names);
    setOrder(FIRST_GAME);
    setSeries([0, 0]);
    fresh();
  };
  const again = () => {
    setOrder(nextOrder(order, history));
    fresh();
  };
  const tiebreak = () => {
    setExtra((n) => n + 1);
    setStep({ s: 'turn' });
  };

  const next = () => {
    const all = [...history, finishTurn(turn, cards)];
    setHistory(all);
    setCards([]);
    if (!isOver(all.length, total)) return setStep({ s: 'turn' });
    const win = leader(scores(all));
    if (win !== null) setSeries((s) => (win === 0 ? [s[0] + 1, s[1]] : [s[0], s[1] + 1]));
    sfx.play(win === null ? 'lose' : 'win');
    setStep({ s: 'done' });
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
        sub="Act it out or talk around it while your team shouts guesses at you."
        onEnter={ready ? () => begin(players) : undefined}
        actions={
          <Big primary disabled={!ready} onClick={() => begin(players)}>
            {ready ? 'Start' : `Add ${short} More ${short === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <HowToPlay steps={HOW} />
        <PlayerList min={MIN_PLAYERS} />
        {n > 0 && <TeamList names={players} teams={buildTeams(n)} />}
        <Option label="Style" value={style} options={[['act', 'Act It Out'], ['describe', 'Describe It'], ['mix', 'Mix']]} onChange={setStyle} />
        <Option label="Turn Time" value={time} options={[['30', '30 Sec'], ['60', '60 Sec'], ['90', '90 Sec']]} onChange={setTime} />
        <Option label="Rounds" value={roundsSetting} options={[['3', '3'], ['5', '5'], ['8', '8']]} onChange={setRounds} />
        <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      </Screen>
    );
  }

  const team = TEAMS[turn.team];
  const how = STYLES[turn.style];
  const where = roundLabel(turn.round, rounds);

  if (step.s === 'turn')
    return (
      <Screen
        key={`turn-${turn.index}`}
        className="g-charades-turn"
        onEnter={startCount}
        actions={
          <Big primary onClick={startCount}>
            Go
          </Big>
        }
      >
        <Avatar name={name(turn.actor)} index={turn.actor} size={64} />
        <p className="arcade-party-kicker">Pass the phone to</p>
        <FitTitle text={name(turn.actor)} />
        <p className="arcade-party-sub">Hold it so only you can see the screen.</p>
        <div className="arcade-party-card g-charades-brief" style={teamStyle(turn.team)}>
          <small>
            {team.name}, {where.toLowerCase()}
          </small>
          <strong>{how.label}</strong>
          <p>{how.rule}</p>
        </div>
      </Screen>
    );

  if (step.s === 'count' || step.s === 'play' || step.s === 'up') {
    const live = step.s === 'play';
    const pts = points(cards);
    return (
      <Stage key={`stage-${turn.index}`} team={turn.team} className={[live && clock.left <= 10 ? 'is-low' : '', step.s === 'up' ? 'is-up' : ''].join(' ')}>
        <div className="g-charades-hud">
          <div className="g-charades-who">
            <b>{team.name}</b>
            <span>{how.hud}</span>
          </div>
          <Countdown left={clock.left} total={seconds} size={84} />
          <div className="g-charades-pts" aria-live="polite">
            <b key={`p${pts}`}>{pts}</b>
            <span>{pts === 1 ? 'point' : 'points'}</span>
            {fx?.got && (
              <i key={`f${fx.n}`} aria-hidden="true">
                +1
              </i>
            )}
          </div>
        </div>
        <div className="g-charades-wordbox" aria-live="polite">
          {step.s === 'count' ? (
            <div className="g-charades-card is-count">
              <small>{how.hud}</small>
              <strong key={beat} className="g-charades-beat">
                {beat}
              </strong>
            </div>
          ) : (
            shown && <WordCard key={`w${shown.n}`} entry={shown.entry} text={word} />
          )}
          {fx && step.s !== 'count' && (
            <div key={`out-${fx.n}`} className={`g-charades-card is-out ${fx.got ? 'is-got' : 'is-skip'}`} aria-hidden="true">
              <small>{fx.got ? 'Got It' : 'Skipped'}</small>
              <div className="g-charades-fit">
                <strong style={{ fontSize: fx.size || undefined }}>
                  <Words text={fx.word} />
                </strong>
              </div>
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
      </Stage>
    );
  }

  const sc = scores(history);

  if (step.s === 'review') {
    const pts = points(cards);
    const now: [number, number] = turn.team === 0 ? [sc[0] + pts, sc[1]] : [sc[0], sc[1] + pts];
    const lead = leader(now);
    const final = isLastTurn(turn.index, total);
    const up = turnAt(history.length + 1, teams, style, order);
    return (
      <Screen
        key={`review-${turn.index}`}
        center={false}
        kicker={where}
        title={lead === null ? 'All Tied Up' : `${TEAMS[lead].name} Leads`}
        onEnter={next}
        actions={
          <Big primary onClick={next}>
            {final ? 'Final Scores' : `Pass to ${name(up.actor)}`}
          </Big>
        }
      >
        <Tallies scores={now} plus={{ team: turn.team, n: pts, last: final }} />
        <div className="arcade-party-field g-charades-words">
          <span>
            {name(turn.actor)}'s turn{cards.length > 0 && <small>Tap a word to fix it</small>}
          </span>
          {cards.length > 0 ? (
            <ul className="g-charades-review" aria-label="Words this turn">
              {cards.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-pressed={c.got}
                    className={c.got ? 'is-got' : c.buzzer ? 'is-buzzer' : 'is-skip'}
                    // A tap leaves focus on the game, so Enter still passes the phone instead of flipping this word back.
                    onMouseDown={(e) => e.preventDefault()}
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
          ) : (
            <p className="g-charades-none">No words this turn.</p>
          )}
        </div>
      </Screen>
    );
  }

  const win = leader(sc);
  const best = bestTurn(history);
  const played = Math.ceil(history.length / 2);
  const games = series[0] + series[1];
  return (
    <Screen
      key={`done-${history.length}`}
      className="g-charades-done"
      center={false}
      kicker={extra ? `After ${rounds} rounds and ${extra === 1 ? 'a tiebreaker' : `${extra} tiebreakers`}` : `After ${played} rounds`}
      title={win === null ? "It's a Tie" : `${TEAMS[win].name} Wins`}
      sub={games > 1 ? `Tonight so far: Blue ${series[0]}, Gold ${series[1]}.` : undefined}
      onEnter={win === null ? tiebreak : again}
      actions={
        win === null ? (
          <>
            <Big primary onClick={tiebreak}>
              Play a Tiebreaker
            </Big>
            <Row>
              <Big onClick={again}>New Game</Big>
              <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
            </Row>
          </>
        ) : (
          <>
            <Big primary onClick={again}>
              Play Again
            </Big>
            <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
          </>
        )
      }
    >
      <Tallies scores={sc} win={win} names={table} teams={teams} />
      {best && (
        <div className="arcade-party-card is-paper g-charades-best">
          <small>Best turn</small>
          <strong>{name(best.actor)}</strong>
          <p>
            {best.points} {best.points === 1 ? 'point' : 'points'} for {TEAMS[best.team].short} in {best.round > rounds ? 'the tiebreaker' : `round ${best.round}`}, {STYLES[best.style].past}.
          </p>
        </div>
      )}
      <Rounds history={history} first={order.first} />
    </Screen>
  );
}

/**
 * Sizes big type to the largest font size that fits its parent without breaking inside a word, up to `max` px
 * (and, with `share`, that fraction of the parent's height). Refits when the parent resizes or a web font loads.
 */
function useFit(ref: RefObject<HTMLElement | null>, text: string, max: number, share = 0) {
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w) return;
      const top = share && h ? Math.min(max, h * share) : max;
      const fits = (px: number) => {
        el.style.fontSize = `${px}px`;
        return el.scrollWidth <= w + 1 && (!share || el.offsetHeight <= h * 0.9);
      };
      if (fits(top)) return;
      let lo = 12;
      let hi = top;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${Math.floor(lo)}px`;
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(box);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', fit);
    };
  }, [ref, text, max, share]);
}

function WordCard({ entry, text }: { entry: Entry; text: RefObject<HTMLElement | null> }) {
  useFit(text, entry.word, 160, 0.62);
  return (
    <div className="g-charades-card">
      <small>{DECKS[entry.deck].label}</small>
      <div className="g-charades-fit">
        <strong ref={text}>
          <Words text={entry.word} />
        </strong>
      </div>
    </div>
  );
}

/** A phrase that may wrap between words but never inside one, not even at a hyphen (Yo-yo, Spider-Man). */
const Words = ({ text }: { text: string }) => (
  <>
    {text.split(' ').map((w, i) => (
      <Fragment key={i}>
        {i > 0 && ' '}
        <span className="g-charades-nb">{w}</span>
      </Fragment>
    ))}
  </>
);

/** The next actor's name, as big as one line allows. */
function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useFit(ref, text, 64);
  return (
    <h2 className="arcade-party-title g-charades-name">
      <span ref={ref}>{text}</span>
    </h2>
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
    <div className={`arcade-party g-charades-stage ${className}`} style={teamStyle(team)}>
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
      {!touch && <kbd>{got ? '→ or Space' : '← key'}</kbd>}
    </button>
  );
}

/** Both teams' totals. On the review, the team that just played shows what this turn added; at the end, the winner is stamped. */
function Tallies({
  scores: sc,
  plus,
  win,
  names,
  teams,
}: {
  scores: [number, number];
  plus?: { team: TeamIndex; n: number; last: boolean };
  win?: TeamIndex | null;
  names?: string[];
  teams?: Teams;
}) {
  return (
    <div className="g-charades-tallies" aria-live="polite">
      {([0, 1] as const).map((t) => (
        <div key={t} className={`g-charades-tally ${win === t ? 'is-win' : ''}`} style={teamStyle(t)}>
          <span className="g-charades-tally-name">{TEAMS[t].name}</span>
          <b>{sc[t]}</b>
          {win === t && <i className="g-charades-winner">Winner</i>}
          {plus?.team === t && <em>+{plus.n} this turn</em>}
          {plus && plus.team !== t && <em className={`is-idle ${plus.last ? 'is-blank' : ''}`}>Up next</em>}
          {names && teams && (
            <span className="g-charades-faces" role="img" aria-label={teams[t].map((s) => names[s]).join(', ')}>
              {teams[t].map((s) => (
                <Avatar key={s} name={names[s] ?? '?'} index={s} size={22} />
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Rounds({ history, first }: { history: Played[]; first: TeamIndex }) {
  const rows = Math.ceil(history.length / 2);
  return (
    <table className="g-charades-rounds" aria-label="Points by round">
      <thead>
        <tr>
          <th scope="col">Round</th>
          {TEAMS.map((t, i) => (
            <th key={i} scope="col" style={teamStyle(i as TeamIndex)}>
              {t.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            <th scope="row">{r + 1}</th>
            {([0, 1] as const).map((t) => {
              const played = history[r * 2 + ((t + first) % 2)];
              return <td key={t}>{played ? played.points : '·'}</td>;
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
      <small>Seats alternate between teams.{teams[0].length !== teams[1].length ? ' Blue gets the extra player.' : ''}</small>
    </div>
  );
}
