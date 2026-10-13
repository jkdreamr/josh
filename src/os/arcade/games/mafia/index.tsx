import { useRef, useState, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting } from '../../kit';
import { Avatar, Big, Countdown, HowToPlay, Option, PassTo, PlayerList, Row, Screen, listNames, playerColor, useCountdown, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  MIN_PLAYERS,
  ROLE_LABEL,
  describeCast,
  endNight,
  fateLine,
  fates,
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

type Special = 'both' | 'doctor' | 'detective' | 'none';

const WORDS = ['no', 'one', 'two', 'three', 'four'];
/** Seat value the vote uses for "Nobody". */
const NOBODY = -1;

const ICON = {
  mafia: meta.glyph,
  doctor: 'M12 3l7 3v5.2c0 4.4-2.9 7.9-7 9.8c-4.1-1.9-7-5.4-7-9.8V6zM12 9v6M9 12h6',
  detective: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.3 15.3L20.5 20.5',
  villager: 'M3.5 11L12 4l8.5 7M6 9.2V20h12V9.2M10 20v-5.5h4V20',
  nobody: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M6.4 6.4l11.2 11.2',
} as const;

const Icon = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const RULES: ReactNode[] = [
  <>Pass the phone around. Everyone sees their role in secret and takes a turn at night, so nobody can tell who's who.</>,
  <>
    <b>Mafia</b> pick someone to take each night. They know who their crew is.
  </>,
  <>
    <b>The Doctor</b> protects one person a night, never the same one twice in a row.
  </>,
  <>
    <b>The Detective</b> checks one person a night and learns if they're mafia.
  </>,
  <>
    <b>Villagers</b> have no night power. They tap a name anyway.
  </>,
  <>Each morning you find out who was taken. Argue, then vote someone out. The town wins when the mafia are gone, the mafia when they match the town.</>,
];

/** The deal card. Every role gets the same cream card and three lines, so nothing about it shows across the table. */
const ROLE_CARD: Record<Role, { title: string; goal: string; more: string }> = {
  mafia: { title: 'Mafia', goal: 'Each night, pick someone to take. By day, act innocent.', more: '' },
  doctor: { title: 'The Doctor', goal: 'Each night, protect one person from the mafia. It can be you.', more: 'Never the same person two nights in a row.' },
  detective: { title: 'The Detective', goal: 'Each night, check one person to learn if they are mafia.', more: 'Only you see the answers.' },
  villager: { title: 'A Villager', goal: 'No night power. Find the mafia and vote them out by day.', more: 'You still tap a name at night, so you blend in.' },
};

/** "Jo was ___." */
const ROLE_AS: Record<Role, string> = { mafia: 'Mafia', doctor: 'the Doctor', detective: 'the Detective', villager: 'a Villager' };

/** The one line that changes on a night turn. The title, grid and button are the same for everyone. */
const ASK: Record<Role, string> = {
  mafia: "You're with the mafia. Pick someone to take tonight.",
  doctor: "You're the doctor. Pick someone to protect tonight.",
  detective: "You're the detective. Pick someone to check tonight.",
  villager: "You're a villager. Pick anyone, it changes nothing.",
};

type Step =
  | { s: 'setup' }
  | { s: 'pass'; k: number }
  | { s: 'role'; k: number }
  | { s: 'act'; k: number }
  | { s: 'dawn'; result: NightResult; win: Side | null }
  | { s: 'day' }
  | { s: 'vote' }
  | { s: 'verdict'; seat: number | null; win: Side | null }
  | { s: 'done'; side: Side };

// Sounds. Every role hears the same ones at night, so the speaker can't give anyone away either.
const thud = () => {
  sfx.tone({ freq: 150, to: 70, dur: 0.09, type: 'square', vol: 0.1 });
  sfx.noise(0.05, 0.1);
};
const heartbeat = (strong: boolean) => sfx.tone({ freq: strong ? 140 : 120, to: 55, dur: 0.16, type: 'triangle', vol: strong ? 0.42 : 0.3 });
const chime = (notes: number[], gap = 0.12, vol = 0.13) => notes.forEach((f, i) => sfx.tone({ freq: f, dur: 0.32, type: 'triangle', vol, delay: i * gap }));
const sting = () => {
  sfx.play('boom');
  sfx.tone({ freq: 196, to: 49, dur: 0.8, type: 'sawtooth', vol: 0.11 });
};
const nightfall = () => sfx.tone({ freq: 330, to: 140, dur: 0.6, type: 'triangle', vol: 0.12 });

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

/**
 * A beat of suspense before a reveal: `beats` (seconds in) call onBeat, then onReveal fires at `seconds`.
 * It runs on the game loop, so pausing holds it. The returned skip() reveals at once.
 */
function useSuspense(seconds: number, running: boolean, beats: readonly number[], onBeat: (i: number) => void, onReveal: () => void) {
  const t = useRef(0);
  const next = useRef(0);
  const done = useRef(false);
  const cb = useRef({ onBeat, onReveal });
  cb.current = { onBeat, onReveal };
  const reveal = () => {
    if (done.current) return;
    done.current = true;
    cb.current.onReveal();
  };
  useGameLoop((dt) => {
    if (!running || done.current) return;
    t.current += dt;
    while (next.current < beats.length && t.current >= beats[next.current]) cb.current.onBeat(next.current++);
    if (t.current >= seconds) reveal();
  });
  // A quick double tap on the button that started the beat shouldn't skip it.
  return { skip: () => (t.current > 0.45 ? reveal() : undefined) };
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

  const special: Special = doctor === 'on' ? (detective === 'on' ? 'both' : 'doctor') : detective === 'on' ? 'detective' : 'none';
  const setSpecial = (v: Special) => {
    setDoctor(v === 'both' || v === 'doctor' ? 'on' : 'off');
    setDetective(v === 'both' || v === 'detective' ? 'on' : 'off');
  };
  const castFor = (n: number) => ({ mafia: mafiaCount(count, n), doctor: doctor === 'on', detective: detective === 'on' });

  const deal = (names: string[]) => {
    if (names.length < MIN_PLAYERS) return;
    setTable(names);
    setGame(newGame(names.length, castFor(names.length)));
    setStep({ s: 'pass', k: 0 });
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
    step.s === 'pass' || step.s === 'role' || step.s === 'act'
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
          className="g-mafia-setup"
          title="Mafia"
          sub="No narrator needed. Everyone takes a secret turn at night, then the town argues and votes by day."
          onEnter={ready ? () => deal(players) : undefined}
          actions={
            <Big primary disabled={!ready} onClick={() => deal(players)}>
              {ready ? 'Deal Roles' : `Add ${MIN_PLAYERS - n} More ${MIN_PLAYERS - n === 1 ? 'Player' : 'Players'}`}
            </Big>
          }
        >
          <HowToPlay steps={RULES} />
          <PlayerList min={MIN_PLAYERS} />
          <Option label="Mafia" value={count} options={[['auto', 'Auto'], ['1', 'One'], ['2', 'Two'], ['3', 'Three']]} onChange={setCount} />
          <Option label="Special Roles" value={special} options={[['both', 'Both'], ['doctor', 'Doctor'], ['detective', 'Detective'], ['none', 'None']]} onChange={setSpecial} />
          {ready && (
            <p className="g-mafia-note">
              {capped ? 'The mafia must stay under half, so ' : ''}
              {n} players get {describeCast(n, cast)}
            </p>
          )}
          <Option label="When Someone Is Out" value={reveal} options={[['show', 'Show Role'], ['secret', 'Keep Secret']]} onChange={setReveal} />
          <Option label="Day Timer" value={timer} options={[['0', 'Off'], ['120', '2 Min'], ['180', '3 Min'], ['300', '5 Min']]} onChange={setTimer} />
        </Screen>
      );
    }

    const name = (i: number) => table[i] ?? `Player ${i + 1}`;
    const order = nightOrder(game.alive);
    const lines = game.log.map((e) => logLine(e, table, game.roles, showRole));
    const mafiaSeats = seatsOf(game.roles, 'mafia');

    if (step.s === 'pass') {
      const seat = order[step.k];
      return (
        <PassTo
          key={`pass-${game.night}-${step.k}`}
          name={name(seat)}
          index={seat}
          note={step.k === 0 ? `Night ${game.night} begins. Everyone else, look away.` : 'Everyone else, look away.'}
          onReady={() => setStep({ s: game.night === 1 ? 'role' : 'act', k: step.k })}
        />
      );
    }

    if (step.s === 'role') {
      const seat = order[step.k];
      const role = game.roles[seat];
      const mates = role === 'mafia' ? mafiaSeats.filter((s) => s !== seat).map(name) : [];
      const next = () => setStep({ s: 'act', k: step.k });
      return (
        <Screen key={`role-${step.k}`} onEnter={next} actions={<Big primary onClick={next}>Take My Turn</Big>}>
          <RoleCard role={role} mates={mates} />
        </Screen>
      );
    }

    if (step.s === 'act') {
      const seat = order[step.k];
      const nextK = step.k + 1;
      const done = () => {
        if (nextK < order.length) {
          setStep({ s: 'pass', k: nextK });
          return;
        }
        const { game: g, result } = endNight(game);
        setGame(g);
        chime([392, 587]);
        setStep({ s: 'dawn', result, win: winner(g.roles, g.alive) });
      };
      return (
        <NightTurn
          key={`act-${game.night}-${seat}`}
          game={game}
          seat={seat}
          name={name}
          nextLabel={nextK < order.length ? `Pass to ${name(order[nextK])}` : 'Wake Everyone'}
          onLock={(t) => setGame((g) => (g ? pickAt(g, seat, t) : g))}
          onDone={done}
        />
      );
    }

    if (step.s === 'dawn') {
      const { killed } = step.result;
      const win = step.win;
      return (
        <Morning
          key={`dawn-${game.night}`}
          night={game.night}
          victim={killed === null ? null : { name: name(killed), index: killed, role: showRole ? ROLE_AS[game.roles[killed]] : null }}
          nextLabel={win ? 'Reveal the Winner' : 'Start the Day'}
          onNext={() => (win ? finish(win) : toDay())}
        />
      );
    }

    if (step.s === 'day') {
      const left = mafiaSeats.filter((s) => game.alive[s]).length;
      const toVote = () => setStep({ s: 'vote' });
      return (
        <Screen
          key={`day-${game.night}`}
          className="g-mafia-day"
          kicker={timeUp ? `Day ${game.night}` : undefined}
          title={timeUp ? "Time's Up" : `Day ${game.night}`}
          sub={timeUp ? 'Stop talking. Time to vote.' : 'Talk it through, then vote someone out.'}
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
            {showRole ? (left === 1 ? 'One of them is mafia.' : `${WORDS[left] ?? left} of them are mafia.`.replace(/^\w/, (c) => c.toUpperCase())) : `The mafia started with ${WORDS[mafiaSeats.length] ?? mafiaSeats.length}.`}
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
      const left = mafiaSeats.filter((s) => game.alive[s]).length;
      return (
        <Verdict
          key={`verdict-${game.night}`}
          day={game.night - 1}
          out={seat === null ? null : { name: name(seat), index: seat, role: showRole ? game.roles[seat] : null }}
          mafiaLeft={left}
          nextLabel={win ? 'Reveal the Winner' : `Start Night ${game.night}`}
          onNext={() => {
            if (win) return finish(win);
            nightfall();
            setStep({ s: 'pass', k: 0 });
          }}
        />
      );
    }

    const town = step.side === 'town';
    const again = () => deal(table);
    const fate = fates(game);
    const row = (i: number) => (
      <li key={i} className={game.roles[i] === 'mafia' ? 'is-mafia' : undefined}>
        <Avatar name={name(i)} index={i} size={32} />
        <span>
          <b>{name(i)}</b>
          <small>{fateLine(fate[i])}</small>
        </span>
        <em>{ROLE_LABEL[game.roles[i]]}</em>
      </li>
    );
    const rank: Record<Role, number> = { mafia: 0, doctor: 1, detective: 2, villager: 3 };
    const townSeats = table.map((_, i) => i).filter((i) => game.roles[i] !== 'mafia').sort((a, b) => rank[game.roles[a]] - rank[game.roles[b]] || a - b);
    return (
      <Screen
        key="done"
        center={false}
        className={town ? 'g-mafia-day g-mafia-end' : 'g-mafia-end'}
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
        <div className="g-mafia-headline" role="status">
          <p className="arcade-party-kicker">Case closed</p>
          <h2 className="arcade-party-title is-huge">{town ? 'The Town Wins' : 'The Mafia Wins'}</h2>
        </div>
        <p className="arcade-party-sub">
          {town
            ? mafiaSeats.length === 1
              ? `${name(mafiaSeats[0])} was the mafia, and the town voted them out.`
              : `${listNames(mafiaSeats.map(name))} were the mafia. The town got every one.`
            : `${listNames(mafiaSeats.map(name))} ${mafiaSeats.length === 1 ? 'was' : 'were'} the mafia, and now nobody can outvote them.`}
        </p>
        <section className="g-mafia-cast" aria-label="Who was who">
          <h3 className="g-mafia-head">The Mafia</h3>
          <ul>{mafiaSeats.map(row)}</ul>
          <h3 className="g-mafia-head">The Town</h3>
          <ul>{townSeats.map(row)}</ul>
        </section>
        <p className="g-mafia-tally" aria-label={`This session: town ${tally.town}, mafia ${tally.mafia}`}>
          <span>This session</span>
          <span className={town ? 'is-hi' : undefined}>
            Town <b>{tally.town}</b>
          </span>
          <span className={town ? undefined : 'is-hi'}>
            Mafia <b>{tally.mafia}</b>
          </span>
        </p>
      </Screen>
    );
  };

  return (
    <>
      <div className="g-mafia-sky" data-time={time} aria-hidden="true">
        <i className="g-mafia-night" />
        <i className="g-mafia-sun" />
      </div>
      {view()}
    </>
  );
}

function RoleCard({ role, mates }: { role: Role; mates: string[] }) {
  const card = ROLE_CARD[role];
  const more = role === 'mafia' ? (mates.length ? `Your crew: ${listNames(mates)}.` : 'No crew. It all comes down to you.') : card.more;
  return (
    <div className="arcade-party-card is-paper g-mafia-role">
      <Icon d={ICON[role]} size={40} />
      <small>You are</small>
      <strong>{card.title}</strong>
      <p>{card.goal}</p>
      <p className="g-mafia-more">{more}</p>
    </div>
  );
}

/** A newspaper-style mug shot: the player's initial on their color, printed in grey. */
const Photo = ({ name, index }: { name: string; index: number }) => (
  <span className="g-mafia-photo" style={{ ['--c' as string]: playerColor(index) }} aria-hidden="true">
    {Array.from(name)[0]?.toLocaleUpperCase() ?? '?'}
  </span>
);

/**
 * One player's secret night turn. Every role gets the same title, the same grid of every living player,
 * the same notes box, the same locked-in card and the same sounds, so a glance across the table can't tell them apart.
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
    thud();
    onLock(sel);
    setLocked(sel);
  };
  // A quick double tap on Lock In should not skip past the answer.
  const done = () => {
    if (performance.now() - lockedAt.current > 450) {
      sfx.play('select');
      onDone();
    }
  };
  const primary = locked !== null ? done : sel !== null ? lock : undefined;

  const notes: string[] = [];
  const crew = seatsOf(game.roles, 'mafia').filter((m) => m !== seat && game.alive[m]);
  if (role === 'mafia') {
    const later: string[] = [];
    for (const m of crew) {
      const p = game.picks[m];
      if (p === null || p === undefined) later.push(name(m));
      else notes.push(`${name(m)} wants ${name(p)}.`);
    }
    if (later.length) notes.push(`${listNames(later)} ${later.length === 1 ? 'picks' : 'pick'} after you.`);
    if (!crew.length) notes.push('No crew. The pick is all yours.');
  }
  if (role === 'doctor')
    notes.push(game.lastSaved === null ? 'You can protect yourself.' : `Last night you protected ${game.lastSaved === seat ? 'yourself' : name(game.lastSaved)}.`);
  if (role === 'detective') {
    for (const f of game.findings)
      if (f.night < game.night) notes.push(`Night ${f.night}: ${name(f.seat)}${game.alive[f.seat] ? '' : ' (out)'} ${f.mafia ? 'is mafia' : 'is not mafia'}.`);
    if (!notes.length) notes.push('No checks yet.');
  }
  if (role === 'villager') notes.push('Everyone taps, so nobody stands out.');

  const tag = (i: number) => (i === seat ? 'You' : role === 'mafia' && game.roles[i] === 'mafia' ? 'Crew' : role === 'doctor' && i === game.lastSaved ? 'Last night' : null);

  const file =
    locked === null
      ? null
      : role === 'mafia'
        ? { stamp: 'Marked', line: crew.length ? 'Most picks wins. Ties are random.' : game.roles.includes('doctor') ? "Gone by morning, unless the doctor guessed right." : 'Gone by morning.' }
        : role === 'doctor'
          ? { stamp: 'Safe', line: `${locked === seat ? "You're" : "They're"} safe from the mafia tonight.` }
          : role === 'detective'
            ? game.roles[locked] === 'mafia'
              ? { stamp: 'Mafia', line: `${name(locked)} is mafia.` }
              : { stamp: 'Clean', line: `${name(locked)} is not mafia.` }
            : { stamp: 'Noted', line: 'It changes nothing. Act natural.' };

  return (
    <Screen
      center={false}
      onEnter={primary}
      actions={
        <Big primary quiet disabled={!primary} onClick={() => primary?.()}>
          {locked !== null ? nextLabel : sel === null ? 'Pick Someone' : `Lock In ${name(sel)}`}
        </Big>
      }
    >
      <p className="arcade-party-kicker">Night {game.night}</p>
      <h2 className="arcade-party-title">{locked === null ? 'Make Your Pick' : 'Locked In'}</h2>
      <p className="arcade-party-sub">{ASK[role]}</p>
      <ul className="g-mafia-notes">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {file && locked !== null ? (
        <div className="arcade-party-card is-paper g-mafia-file">
          <Photo name={name(locked)} index={locked} />
          <strong>{name(locked)}</strong>
          <p>{file.line}</p>
          <b className="g-mafia-stamp">{file.stamp}</b>
        </div>
      ) : (
        <div className="arcade-party-picks" role="group" aria-label="Players">
          {choices.map((c) => {
            const t = tag(c.seat);
            return (
              <button key={c.seat} type="button" aria-pressed={sel === c.seat} disabled={!c.ok} onClick={() => choose(c.seat)}>
                <Avatar name={name(c.seat)} index={c.seat} size={30} />
                <span className="g-mafia-who">
                  <span>{name(c.seat)}</span>
                  {t && <em>{t}</em>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

/**
 * The morning news, the big moment of every round. Whoever took the last turn wakes the table, puts the phone
 * down, and a few heartbeats later the headline lands.
 */
function Morning({
  night,
  victim,
  nextLabel,
  onNext,
}: {
  night: number;
  victim: { name: string; index: number; role: string | null } | null;
  nextLabel: string;
  onNext: () => void;
}) {
  const [phase, setPhase] = useState<'wake' | 'drum' | 'news'>('wake');
  const newsAt = useRef(0);
  const { skip } = useSuspense(
    1.9,
    phase === 'drum',
    [0.05, 0.33, 1.0, 1.28],
    (i) => heartbeat(i % 2 === 0),
    () => {
      newsAt.current = performance.now();
      setPhase('news');
      if (victim) sting();
      else chime([523, 659, 784], 0.07, 0.12);
    },
  );
  // Taps that land just as the headline does shouldn't skip past it.
  const next = () => performance.now() - newsAt.current > 600 && onNext();
  const primary = phase === 'wake' ? () => setPhase('drum') : phase === 'drum' ? skip : next;
  return (
    <Screen
      className="g-mafia-day"
      onEnter={primary}
      actions={
        <Big primary quiet={phase !== 'news'} onClick={primary}>
          {phase === 'news' ? nextLabel : 'Read the News'}
        </Big>
      }
    >
      {phase === 'wake' ? (
        <>
          <p className="arcade-party-kicker">Morning {night}</p>
          <h2 className="arcade-party-title is-huge">Everyone, Wake Up</h2>
          <p className="arcade-party-sub">Put the phone where everyone can see it.</p>
        </>
      ) : (
        <article className={`arcade-party-card is-paper g-mafia-paper ${phase === 'news' ? 'is-news' : ''}`}>
          <header>
            <span>The Daily Alibi</span>
            <small>Morning {night}</small>
          </header>
          <div className="g-mafia-story" role="status">
            {phase === 'drum' ? (
              <p className="g-mafia-wait">Last night<span>.</span><span>.</span><span>.</span></p>
            ) : victim ? (
              <>
                <Photo name={victim.name} index={victim.index} />
                <strong>{victim.name}</strong>
                <em>was taken in the night</em>
                <p>{victim.role ? `${victim.name} was ${victim.role}.` : 'Their role stays a secret.'}</p>
              </>
            ) : (
              <>
                <strong>Nobody Was Taken</strong>
                <p>The mafia came for someone, but the doctor got there first.</p>
              </>
            )}
          </div>
        </article>
      )}
    </Screen>
  );
}

/** The vote's result. With roles shown, a short beat before the role lands. */
function Verdict({
  day,
  out,
  mafiaLeft,
  nextLabel,
  onNext,
}: {
  day: number;
  out: { name: string; index: number; role: Role | null } | null;
  mafiaLeft: number;
  nextLabel: string;
  onNext: () => void;
}) {
  const beat = !!out?.role;
  const [shown, setShown] = useState(!beat);
  const shownAt = useRef(performance.now());
  const { skip } = useSuspense(1.1, beat && !shown, [0.05, 0.55], (i) => heartbeat(i === 0), () => {
    shownAt.current = performance.now();
    setShown(true);
    if (out?.role === 'mafia') chime([392, 494, 587, 784], 0.08, 0.14);
    else sfx.play('lose');
  });
  // A double tap on Vote Out, or a tap just as the role lands, shouldn't skip the verdict.
  const primary = shown ? () => performance.now() - shownAt.current > 500 && onNext() : skip;
  const role = out?.role ?? null;
  const sub = !out
    ? "The town couldn't agree on anyone."
    : !role
      ? 'Their role stays a secret.'
      : role === 'mafia'
        ? mafiaLeft === 0
          ? 'That was the last of them.'
          : `${WORDS[mafiaLeft] ?? mafiaLeft} to go.`.replace(/^\w/, (c) => c.toUpperCase())
        : 'The mafia is still out there.';
  return (
    <Screen className="g-mafia-day" onEnter={primary} actions={<Big primary onClick={primary}>{shown ? nextLabel : 'Reveal'}</Big>}>
      {out ? (
        <Photo name={out.name} index={out.index} />
      ) : (
        <span className="g-mafia-nobody-mark">
          <Icon d={ICON.nobody} size={32} />
        </span>
      )}
      <div className="g-mafia-headline" role="status">
        <p className="arcade-party-kicker">Day {day}</p>
        <h2 className="arcade-party-title is-huge">{out ? `${out.name} Is Out` : 'Nobody Is Out'}</h2>
      </div>
      {role ? (
        <div className={`g-mafia-reveal ${shown ? 'is-shown' : ''}`} aria-live="polite">
          {shown ? (
            <>
              <p>
                {out?.name} was <b className={role === 'mafia' ? 'is-mafia' : undefined}>{ROLE_AS[role]}</b>.
              </p>
              <p className="arcade-party-sub">{sub}</p>
            </>
          ) : (
            <p>
              {out?.name} was<span>.</span>
              <span>.</span>
              <span>.</span>
            </p>
          )}
        </div>
      ) : (
        <p className="arcade-party-sub">{sub}</p>
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
      className="g-mafia-day"
      title="Vote"
      sub="On three, everyone points. Tap whoever got the most votes, or Nobody on a tie."
      onEnter={sel !== null ? confirm : undefined}
      actions={
        <Row>
          <Big onClick={onBack}>Back</Big>
          <Big primary quiet disabled={sel === null} onClick={confirm}>
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
