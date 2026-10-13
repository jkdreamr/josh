import { useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting } from '../../kit';
import { Avatar, Big, Countdown, Option, PassTo, PlayerList, Row, Screen, listNames, useCountdown, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  MIN_PLAYERS,
  ROLE_LABEL,
  describeCast,
  endNight,
  logLine,
  mafiaCount,
  maxMafia,
  newGame,
  nightChoices,
  nightOrder,
  pickAt,
  seatsOf,
  voteOut,
  winner,
  type Game,
  type NightResult,
  type Role,
  type Side,
} from './logic';
import { meta } from './meta';
import './mafia.css';

const COUNT = defineSetting('mafia:count', ['auto', '1', '2', '3'] as const, 'auto');
const DOCTOR = defineSetting('mafia:doctor', ['on', 'off'] as const, 'on');
const DETECTIVE = defineSetting('mafia:detective', ['on', 'off'] as const, 'on');
const REVEAL = defineSetting('mafia:reveal', ['show', 'secret'] as const, 'show');
const TIMER = defineSetting('mafia:timer', ['0', '120', '180', '300'] as const, '0');

const WORDS = ['no', 'one', 'two', 'three', 'four'];
/** Seat value the vote uses for "Nobody". */
const NOBODY = -1;

const ICON = {
  mafia: meta.glyph,
  doctor: 'M12 3l7 3v5.2c0 4.4-2.9 7.9-7 9.8c-4.1-1.9-7-5.4-7-9.8V6zM12 9v6M9 12h6',
  detective: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.3 15.3L20.5 20.5',
  villager: 'M3.5 11L12 4l8.5 7M6 9.2V20h12V9.2M10 20v-5.5h4V20',
  moon: 'M19.5 14.2A8 8 0 0 1 9.8 4.5A8 8 0 1 0 19.5 14.2z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  nobody: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M6.4 6.4l11.2 11.2',
} as const;

const Icon = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ROLE_CARD: Record<Role, { title: string; goal: string }> = {
  mafia: { title: 'Mafia', goal: 'Each night, pick someone to take. By day, blend in.' },
  doctor: { title: 'The Doctor', goal: 'Each night, protect one person from the mafia. It can be you.' },
  detective: { title: 'The Detective', goal: 'Each night, check one person to learn if they are mafia.' },
  villager: { title: 'A Villager', goal: 'Find the mafia and vote them out by day.' },
};

/** "Jo was ___." */
const ROLE_AS: Record<Role, string> = { mafia: 'Mafia', doctor: 'the Doctor', detective: 'the Detective', villager: 'a Villager' };

const ASK: Record<Role, { title: string; sub: string }> = {
  mafia: { title: 'Who Should the Mafia Take?', sub: "The mafia's top pick is taken tonight." },
  doctor: { title: 'Who Do You Protect?', sub: 'Whoever you pick is safe tonight, even you.' },
  detective: { title: 'Who Do You Investigate?', sub: "You'll find out if they are mafia." },
  villager: { title: 'Who Do You Suspect?', sub: 'Nothing happens. It just keeps everyone guessing.' },
};

type Step =
  | { s: 'setup' }
  | { s: 'deal-pass'; i: number }
  | { s: 'deal-see'; i: number }
  | { s: 'dusk' }
  | { s: 'night-pass'; k: number }
  | { s: 'night-act'; k: number }
  | { s: 'dawn'; result: NightResult; win: Side | null }
  | { s: 'day' }
  | { s: 'vote' }
  | { s: 'verdict'; seat: number | null; win: Side | null }
  | { s: 'done'; side: Side };

export default function Mafia({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

/** Number keys pick the nth player (0 is Nobody when offered), arrows step through them. */
function usePickKeys(options: readonly number[], sel: number | null, choose: ((seat: number) => void) | null) {
  useKeys((code) => {
    if (!choose || !options.length) return;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (digit) {
      const n = Number(digit[1]);
      const seats = options.filter((o) => o !== NOBODY);
      const v = n === 0 ? (options.includes(NOBODY) ? NOBODY : undefined) : seats[n - 1];
      if (v !== undefined) choose(v);
      return;
    }
    const dir = code === 'ArrowRight' || code === 'ArrowDown' ? 1 : code === 'ArrowLeft' || code === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    const at = sel === null ? (dir > 0 ? -1 : options.length) : options.indexOf(sel);
    choose(options[(at + dir + options.length) % options.length]);
  });
}

function Play() {
  const [players] = usePlayers();
  const [count, setCount] = useSetting(COUNT);
  const [doctor, setDoctor] = useSetting(DOCTOR);
  const [detective, setDetective] = useSetting(DETECTIVE);
  const [reveal, setReveal] = useSetting(REVEAL);
  const [timer, setTimer] = useSetting(TIMER);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [tally, setTally] = useState({ town: 0, mafia: 0 });
  const seconds = Number(timer);
  const showRole = reveal === 'show';
  const clockRun = useCountdown(seconds || 1, {
    running: step.s === 'day' && seconds > 0 && !timeUp,
    onEnd: () => {
      sfx.play('lose');
      setTimeUp(true);
    },
  });

  const castFor = (n: number) => ({ mafia: mafiaCount(count, n), doctor: doctor === 'on', detective: detective === 'on' });

  const deal = (names: string[]) => {
    if (names.length < MIN_PLAYERS) return;
    setTable(names);
    setGame(newGame(names.length, castFor(names.length)));
    setStep({ s: 'deal-pass', i: 0 });
  };

  const toDay = () => {
    setTimeUp(false);
    clockRun.reset(seconds || 1);
    setStep({ s: 'day' });
  };

  const finish = (side: Side) => {
    sfx.play(side === 'town' ? 'win' : 'lose');
    setTally((t) => ({ ...t, [side]: t[side] + 1 }));
    setStep({ s: 'done', side });
  };

  const time =
    step.s === 'dusk' || step.s === 'night-pass' || step.s === 'night-act'
      ? 'night'
      : step.s === 'dawn' || step.s === 'day' || step.s === 'vote' || step.s === 'verdict'
        ? 'day'
        : step.s === 'done'
          ? step.side === 'mafia'
            ? 'night'
            : 'day'
          : 'none';

  const view = () => {
    if (step.s === 'setup' || !game) {
      const n = players.length;
      const ready = n >= MIN_PLAYERS;
      const cast = castFor(n);
      const capped = ready && count !== 'auto' && Number(count) > maxMafia(n);
      return (
        <Screen
          key="setup"
          center={false}
          title="Mafia"
          sub="No narrator needed. Everyone takes a secret turn at night, then the town argues and votes by day."
          onEnter={ready ? () => deal(players) : undefined}
          actions={
            <Big primary disabled={!ready} onClick={() => deal(players)}>
              {ready ? 'Deal Roles' : `Add ${MIN_PLAYERS - n} More ${MIN_PLAYERS - n === 1 ? 'Player' : 'Players'}`}
            </Big>
          }
        >
          <PlayerList min={MIN_PLAYERS} />
          <Option label="Mafia" value={count} options={[['auto', 'Auto'], ['1', 'One'], ['2', 'Two'], ['3', 'Three']]} onChange={setCount} />
          {ready && (
            <p className="g-mafia-note">
              {capped ? 'The mafia must stay under half, so ' : ''}
              {n} players get {describeCast(n, cast)}
            </p>
          )}
          <Option label="Doctor" value={doctor} options={[['on', 'On'], ['off', 'Off']]} onChange={setDoctor} />
          <Option label="Detective" value={detective} options={[['on', 'On'], ['off', 'Off']]} onChange={setDetective} />
          <Option label="When Someone Is Out" value={reveal} options={[['show', 'Show Role'], ['secret', 'Keep Secret']]} onChange={setReveal} />
          <Option label="Day Timer" value={timer} options={[['0', 'Off'], ['120', '2 Min'], ['180', '3 Min'], ['300', '5 Min']]} onChange={setTimer} />
        </Screen>
      );
    }

    const name = (i: number) => table[i] ?? `Player ${i + 1}`;
    const order = nightOrder(game.alive);
    const lines = game.log.map((e) => logLine(e, table, game.roles, showRole));
    const mafiaSeats = seatsOf(game.roles, 'mafia');

    if (step.s === 'deal-pass')
      return <PassTo key={`deal-pass-${step.i}`} name={name(step.i)} index={step.i} onReady={() => setStep({ s: 'deal-see', i: step.i })} />;

    if (step.s === 'deal-see') {
      const role = game.roles[step.i];
      const mates = role === 'mafia' ? mafiaSeats.filter((s) => s !== step.i).map(name) : [];
      const nextSeat = step.i + 1;
      const next = () => setStep(nextSeat < table.length ? { s: 'deal-pass', i: nextSeat } : { s: 'dusk' });
      return (
        <Screen key={`deal-see-${step.i}`} onEnter={next} actions={<Big primary onClick={next}>{nextSeat < table.length ? `Hide and Pass to ${name(nextSeat)}` : 'Hide and Start'}</Big>}>
          <RoleCard role={role} mates={mates} />
        </Screen>
      );
    }

    if (step.s === 'dusk') {
      const begin = () => setStep({ s: 'night-pass', k: 0 });
      return (
        <Screen key={`dusk-${game.night}`} onEnter={begin} actions={<Big primary onClick={begin}>Begin the Night</Big>}>
          <span className="g-mafia-emblem is-moon">
            <Icon d={ICON.moon} size={34} />
          </span>
          <p className="arcade-party-kicker">Night {game.night}</p>
          <h2 className="arcade-party-title is-huge">Night Falls</h2>
          <p className="arcade-party-sub">Pass the phone around the circle. Everyone takes a turn so nobody can tell who's who.</p>
          <p className="g-mafia-note">{name(order[0])} goes first.</p>
        </Screen>
      );
    }

    if (step.s === 'night-pass') {
      const seat = order[step.k];
      return (
        <PassTo
          key={`night-pass-${game.night}-${step.k}`}
          name={name(seat)}
          index={seat}
          note={`Night ${game.night}. Everyone else, look away.`}
          onReady={() => setStep({ s: 'night-act', k: step.k })}
        />
      );
    }

    if (step.s === 'night-act') {
      const seat = order[step.k];
      const nextK = step.k + 1;
      const done = () => {
        if (nextK < order.length) {
          setStep({ s: 'night-pass', k: nextK });
          return;
        }
        const { game: g, result } = endNight(game);
        setGame(g);
        sfx.play(result.killed === null ? 'coin' : 'boom');
        setStep({ s: 'dawn', result, win: winner(g.roles, g.alive) });
      };
      return (
        <NightTurn
          key={`night-act-${game.night}-${seat}`}
          game={game}
          seat={seat}
          name={name}
          nextLabel={nextK < order.length ? `Done, Pass to ${name(order[nextK])}` : 'Done, Wake Everyone'}
          onLock={(t) => setGame((g) => (g ? pickAt(g, seat, t) : g))}
          onDone={done}
        />
      );
    }

    if (step.s === 'dawn') {
      const { killed } = step.result;
      const win = step.win;
      const next = () => (win ? finish(win) : toDay());
      return (
        <Screen key={`dawn-${game.night}`} className="g-mafia-sun" onEnter={next} actions={<Big primary onClick={next}>{win ? 'Reveal the Winner' : 'Start the Day'}</Big>}>
          {killed === null ? (
            <span className="g-mafia-emblem is-sun">
              <Icon d={ICON.sun} size={36} />
            </span>
          ) : (
            <Avatar name={name(killed)} index={killed} size={72} />
          )}
          <p className="arcade-party-kicker">Morning {game.night}</p>
          <h2 className="arcade-party-title is-huge">{killed === null ? 'Nobody Was Taken' : `${name(killed)} Was Taken`}</h2>
          <p className="arcade-party-sub">
            {killed === null ? 'Everyone made it through the night.' : showRole ? `${name(killed)} was ${ROLE_AS[game.roles[killed]]}.` : 'Their role stays a secret.'}
          </p>
          <TownLog lines={lines.slice(0, -1)} title="Earlier" />
        </Screen>
      );
    }

    if (step.s === 'day') {
      const left = mafiaSeats.filter((s) => game.alive[s]).length;
      const toVote = () => setStep({ s: 'vote' });
      return (
        <Screen
          key={`day-${game.night}`}
          className="g-mafia-sun"
          title={timeUp ? "Time's Up" : `Day ${game.night}`}
          sub={timeUp ? 'Stop talking and vote.' : 'Talk it out. Who seems shady? Vote when you are ready.'}
          onEnter={toVote}
          actions={
            <Big primary onClick={toVote}>
              Vote
            </Big>
          }
        >
          {seconds > 0 && <Countdown left={clockRun.left} total={seconds} />}
          <ul className="g-mafia-alive" aria-label="Still in">
            {order.map((i) => (
              <li key={i}>
                <Avatar name={name(i)} index={i} size={24} />
                <span>{name(i)}</span>
              </li>
            ))}
          </ul>
          <p className="g-mafia-note">
            {order.length} still in.{' '}
            {showRole ? (left === 1 ? 'One mafia is still out there.' : `${left} mafia are still out there.`) : `The mafia started with ${WORDS[mafiaSeats.length] ?? mafiaSeats.length}.`}
          </p>
          <TownLog lines={lines} />
        </Screen>
      );
    }

    if (step.s === 'vote')
      return (
        <VoteStep
          key={`vote-${game.night}`}
          living={order}
          name={name}
          lines={lines}
          onBack={() => setStep({ s: 'day' })}
          onVote={(seat) => {
            const g = voteOut(game, seat);
            setGame(g);
            sfx.play(seat === null ? 'blip' : 'hit');
            setStep({ s: 'verdict', seat, win: winner(g.roles, g.alive) });
          }}
        />
      );

    if (step.s === 'verdict') {
      const { seat, win } = step;
      const next = () => (win ? finish(win) : setStep({ s: 'dusk' }));
      const sub =
        seat === null
          ? "The town couldn't agree. Night falls again."
          : !showRole
            ? 'Their role stays a secret.'
            : game.roles[seat] === 'mafia'
              ? `${name(seat)} was Mafia. Nice work, town.`
              : `${name(seat)} was ${ROLE_AS[game.roles[seat]]}. Oops.`;
      return (
        <Screen key={`verdict-${game.night}`} className="g-mafia-sun" onEnter={next} actions={<Big primary onClick={next}>{win ? 'Reveal the Winner' : `Start Night ${game.night}`}</Big>}>
          {seat === null ? (
            <span className="g-mafia-emblem is-sun">
              <Icon d={ICON.nobody} size={34} />
            </span>
          ) : (
            <Avatar name={name(seat)} index={seat} size={72} />
          )}
          <p className="arcade-party-kicker">Day {game.night - 1}</p>
          <h2 className="arcade-party-title is-huge">{seat === null ? 'Nobody Is Out' : `${name(seat)} Is Out`}</h2>
          <p className="arcade-party-sub">{sub}</p>
          <TownLog lines={lines.slice(0, -1)} title="Earlier" />
        </Screen>
      );
    }

    const town = step.side === 'town';
    const again = () => deal(table);
    return (
      <Screen
        key="done"
        center={false}
        className={town ? 'g-mafia-sun' : undefined}
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
        <span className={`g-mafia-emblem is-top ${town ? 'is-sun' : 'is-moon'}`}>
          <Icon d={town ? ICON.villager : ICON.mafia} size={36} />
        </span>
        <h2 className="arcade-party-title is-huge">{town ? 'The Town Wins' : 'The Mafia Wins'}</h2>
        <p className="arcade-party-sub">
          {town ? `${mafiaSeats.length === 1 ? 'The mafia is' : 'Every mafia member is'} out. The streets are safe again.` : 'The mafia caught up with the town. Nobody is left to stop them.'}
        </p>
        <h3 className="g-mafia-head">Who Was Who</h3>
        <ul className="arcade-party-scores g-mafia-cast" aria-label="Who was who">
          {table.map((p, i) => (
            <li key={p} className={[game.alive[i] ? '' : 'is-out', game.roles[i] === 'mafia' ? 'is-mafia' : ''].join(' ').trim() || undefined}>
              <Avatar name={p} index={i} size={26} />
              <span>{p}</span>
              <b>{ROLE_LABEL[game.roles[i]]}</b>
            </li>
          ))}
        </ul>
        <h3 className="g-mafia-head">This Session</h3>
        <ul className="arcade-party-scores" aria-label="Wins this session">
          <li className={town ? 'is-hi' : undefined}>
            <span>Town</span>
            <b>{tally.town}</b>
          </li>
          <li className={town ? undefined : 'is-hi'}>
            <span>Mafia</span>
            <b>{tally.mafia}</b>
          </li>
        </ul>
      </Screen>
    );
  };

  return (
    <>
      <div className="g-mafia-sky" data-time={time} aria-hidden="true">
        <i className="g-mafia-night" />
        <i className="g-mafia-day" />
      </div>
      {view()}
    </>
  );
}

function RoleCard({ role, mates }: { role: Role; mates: string[] }) {
  const card = ROLE_CARD[role];
  return (
    <div className={`arcade-party-card g-mafia-role is-${role}`}>
      <Icon d={ICON[role]} size={44} />
      <small>You are</small>
      <strong>{card.title}</strong>
      <p>{card.goal}</p>
      {role === 'mafia' && <p className="g-mafia-crew">{mates.length ? `Your crew: ${listNames(mates)}.` : 'You work alone. Good luck.'}</p>}
    </div>
  );
}

/**
 * One player's secret night turn. Every role gets the same shape (a question, a grid of players, one button),
 * so a glance across the table can't tell them apart.
 */
function NightTurn({
  game,
  seat,
  name,
  nextLabel,
  onLock,
  onDone,
}: {
  game: Game;
  seat: number;
  name: (i: number) => string;
  nextLabel: string;
  onLock: (target: number) => void;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const lockedAt = useRef(0);
  const role = game.roles[seat];
  const ask = ASK[role];
  const choices = nightChoices(game.roles, game.alive, seat, game.lastSaved);
  const ok = choices.filter((c) => c.ok).map((c) => c.seat);
  const choose = (t: number) => {
    if (locked !== null || !ok.includes(t)) return;
    sfx.play('blip');
    setSel(t);
  };
  usePickKeys(ok, sel, locked === null ? choose : null);
  const lock = () => {
    if (sel === null || locked !== null) return;
    lockedAt.current = performance.now();
    onLock(sel);
    setLocked(sel);
  };
  // A quick double tap on Lock In should not skip past the answer.
  const done = () => {
    if (performance.now() - lockedAt.current > 450) onDone();
  };
  const primary = locked !== null ? done : sel !== null ? lock : undefined;

  const notes: string[] = [];
  if (role === 'mafia') {
    const later: string[] = [];
    for (const m of seatsOf(game.roles, 'mafia')) {
      if (m === seat || !game.alive[m]) continue;
      const p = game.picks[m];
      if (p === null || p === undefined) later.push(name(m));
      else notes.push(`${name(m)} wants ${name(p)}.`);
    }
    if (later.length) notes.push(`${listNames(later)} ${later.length === 1 ? 'picks' : 'pick'} after you.`);
  }
  if (role === 'doctor' && game.lastSaved !== null && game.alive[game.lastSaved])
    notes.push(`You protected ${game.lastSaved === seat ? 'yourself' : name(game.lastSaved)} last night, so pick someone else tonight.`);
  if (role === 'detective')
    for (const f of game.findings)
      if (f.night < game.night) notes.push(`Night ${f.night}: ${name(f.seat)}${game.alive[f.seat] ? '' : ' (out)'} ${f.mafia ? 'is Mafia' : 'is not Mafia'}.`);

  const mates = seatsOf(game.roles, 'mafia').filter((m) => m !== seat && game.alive[m]).length;
  const result =
    locked === null
      ? null
      : role === 'mafia'
        ? { small: 'Your pick', strong: name(locked), p: mates ? 'Locked in. Most picks wins, ties are random.' : 'Locked in. See you in the morning.' }
        : role === 'doctor'
          ? { small: 'Protected', strong: name(locked), p: `${locked === seat ? "You're" : "They're"} safe from the mafia tonight.` }
          : role === 'detective'
            ? { small: 'Investigation', strong: `${name(locked)} ${game.roles[locked] === 'mafia' ? 'is Mafia' : 'is not Mafia'}`, p: 'Use it wisely by day.' }
            : { small: 'Your hunch', strong: name(locked), p: 'Locked in. Act natural.' };

  return (
    <Screen
      center={false}
      onEnter={primary}
      actions={
        <Big primary disabled={!primary} onClick={() => primary?.()}>
          {locked !== null ? nextLabel : sel === null ? 'Pick Someone' : `Lock In ${name(sel)}`}
        </Big>
      }
    >
      <p className="arcade-party-kicker">
        Night {game.night} · {ROLE_LABEL[role]}
      </p>
      <h2 className="arcade-party-title">{ask.title}</h2>
      <p className="arcade-party-sub">{ask.sub}</p>
      {notes.length > 0 && (
        <ul className="g-mafia-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {result && locked !== null ? (
        <div className="arcade-party-card is-plain g-mafia-locked">
          <Avatar name={name(locked)} index={locked} size={56} />
          <small>{result.small}</small>
          <strong className={role === 'detective' ? (game.roles[locked] === 'mafia' ? 'is-bad' : 'is-good') : undefined}>{result.strong}</strong>
          <p>{result.p}</p>
        </div>
      ) : (
        <div className="arcade-party-picks" role="group" aria-label="Players">
          {choices.map((c) => (
            <button key={c.seat} type="button" aria-pressed={sel === c.seat} disabled={!c.ok} onClick={() => choose(c.seat)}>
              <Avatar name={name(c.seat)} index={c.seat} size={30} />
              <span>{c.seat === seat ? `${name(c.seat)} (You)` : name(c.seat)}</span>
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}

function VoteStep({
  living,
  name,
  lines,
  onBack,
  onVote,
}: {
  living: number[];
  name: (i: number) => string;
  lines: string[];
  onBack: () => void;
  onVote: (seat: number | null) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const options = [...living, NOBODY];
  const choose = (v: number) => {
    sfx.play('blip');
    setSel(v);
  };
  usePickKeys(options, sel, choose);
  const confirm = () => {
    if (sel !== null) onVote(sel === NOBODY ? null : sel);
  };
  return (
    <Screen
      center={false}
      className="g-mafia-sun"
      title="Vote"
      sub="Count down from three and point. Tap whoever got the most votes, or Nobody on a tie."
      onEnter={sel !== null ? confirm : undefined}
      actions={
        <Row>
          <Big onClick={onBack}>Back</Big>
          <Big primary disabled={sel === null} onClick={confirm}>
            {sel === null ? 'Pick Someone' : sel === NOBODY ? 'Nobody Goes' : `Vote Out ${name(sel)}`}
          </Big>
        </Row>
      }
    >
      <div className="arcade-party-picks" role="group" aria-label="Voted out">
        {living.map((i) => (
          <button key={i} type="button" aria-pressed={sel === i} onClick={() => choose(i)}>
            <Avatar name={name(i)} index={i} size={30} />
            <span>{name(i)}</span>
          </button>
        ))}
        <button type="button" className="g-mafia-nobody" aria-pressed={sel === NOBODY} onClick={() => choose(NOBODY)}>
          <Icon d={ICON.nobody} size={20} />
          <span>Nobody</span>
        </button>
      </div>
      <TownLog lines={lines} />
    </Screen>
  );
}

/** The public record, newest last. Long logs fold down to the latest few. */
function TownLog({ lines, title = 'Town Log' }: { lines: string[]; title?: string }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const long = lines.length > 4;
  const shown = long && !all ? lines.slice(-3) : lines;
  return (
    <section className="g-mafia-log" aria-label={title}>
      <h3 className="g-mafia-head">{title}</h3>
      <ol>
        {shown.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
      {long && (
        <button type="button" onClick={() => setAll(!all)}>
          {all ? 'Show Less' : `Show All ${lines.length}`}
        </button>
      )}
    </section>
  );
}
