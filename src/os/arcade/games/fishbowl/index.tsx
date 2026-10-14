import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Countdown, HowToPlay, Option, PassTo, PlayerList, Screen, clock, listNames, mulberry32, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  Bursts,
  MIN_PLAYERS,
  ROUNDS,
  SLIP_MAX,
  addSlip,
  bestTurn,
  bowlNow,
  bowlSize,
  buildTeams,
  builtInBowl,
  buzz,
  deal,
  endTurn,
  fix,
  giverNow,
  giverOf,
  isOver,
  leader,
  markGot,
  markSkip,
  newMatch,
  parseBowl,
  points,
  pointsByRound,
  replay,
  reviewRows,
  roundNow,
  scoreTable,
  teamNow,
  totals,
  toughest,
  type Match,
  type SavedBowl,
  type TeamIndex,
} from './logic';
import { meta } from './meta';
import { AFTER_DARK, BUILT_IN } from './slips';
import './fishbowl.css';

const SOURCE = defineSetting('fishbowl:slips', ['write', 'builtin', 'last'] as const, 'write');
type Source = (typeof SOURCE.values)[number];
const EACH = defineSetting('fishbowl:each', ['3', '4', '5'] as const, '3');
const TIME = defineSetting('fishbowl:time', ['30', '45', '60'] as const, '45');
/** The 18+ mix-in for the built-in bowl. Off unless the group turns it on. */
const HEAT = defineSetting('fishbowl:heat', ['classic', 'dark'] as const, 'classic');

const TEAMS = [{ name: 'Goldfish' }, { name: 'Jellyfish' }] as const;
const teamClass = (t: TeamIndex) => `is-t${t}`;

const RULES = [
  { name: 'Describe It', rule: 'Say anything except the words on the slip.' },
  { name: 'One Word', rule: 'One word only. No gestures.' },
  { name: 'Act It Out', rule: 'No words, no sounds. Just act.' },
] as const;

/** How long the Time stamp stays up before the review, and each beat of the 3-2-1 before a turn (seconds). */
const HOLD = 1.5;
const BEAT = 0.7;
/** Milliseconds a step between turns ignores taps and keys, so a frantic Got It can't skip it. */
const ARM = 1000;

type Step =
  | { s: 'setup' }
  | { s: 'pass-write'; i: number }
  | { s: 'write'; i: number }
  | { s: 'ready' }
  | { s: 'count' }
  | { s: 'play' }
  | { s: 'up'; round: number }
  | { s: 'review'; round: number }
  | { s: 'break'; round: number }
  | { s: 'done' };

/** The slip flying out after Got It or Skip, drawn at the size it had in hand. */
type Fx = { n: number; got: boolean; text: string; size: string; broken: boolean };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const { touch } = useShell();
  const [players] = usePlayers();
  const [sourceSetting, setSource] = useSetting(SOURCE);
  const [saved, setSaved] = useStored<SavedBowl | null>('fishbowl:bowl', null, parseBowl);
  const [eachSetting, setEach] = useSetting(EACH);
  const [time, setTime] = useSetting(TIME);
  const [heat, setHeat] = useSetting(HEAT);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [written, setWritten] = useState<string[][]>([]);
  const [slips, setSlips] = useState<string[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [beat, setBeat] = useState(3);
  const fxN = useRef(0);
  const lastTap = useRef(0);
  const streak = useRef(0);
  const hold = useRef(0);
  const countIn = useRef({ t: 0, beat: 0 });
  const slipText = useRef<HTMLElement | null>(null);
  const fresh = useBursts();
  const shownAt = useRef(0);
  const playAt = useRef(0);

  const source: Source = sourceSetting === 'last' && !saved ? 'write' : sourceSetting;
  const seconds = Number(time);
  const each = Number(eachSetting);
  const name = (seat: number) => table[seat] ?? `Player ${seat + 1}`;

  // Every new step notes when it appeared, so a burst of taps that started on the step before can be told apart.
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, [step]);
  /** Wraps a between-turns action so only a press that started on this step runs it. */
  const guarded = (fn: () => void) => () => {
    if (fresh(shownAt.current)) fn();
  };

  const timeUp = () => {
    if (!match) return;
    sfx.tone({ freq: 150, to: 110, dur: 0.8, type: 'sawtooth', vol: 0.2 });
    sfx.tone({ freq: 157, to: 116, dur: 0.8, type: 'square', vol: 0.08 });
    hold.current = 0;
    setStep({ s: 'up', round: roundNow(match) });
    setMatch(buzz(match));
  };
  const clockRun = useCountdown(seconds, {
    running: step.s === 'play',
    onEnd: timeUp,
  });

  // The 3-2-1 before a turn, and the Time stamp's hold before the review. Both wait while the game is paused.
  useGameLoop((dt) => {
    if (step.s === 'up') {
      hold.current += dt;
      if (hold.current >= HOLD) {
        hold.current = -Infinity;
        setStep({ s: 'review', round: step.round });
      }
    } else if (step.s === 'count') {
      const c = countIn.current;
      if (c.beat <= 0) return;
      c.t += dt;
      const n = 3 - Math.floor(c.t / BEAT);
      if (n <= 0) {
        c.beat = 0;
        go();
      } else if (n !== c.beat) {
        c.beat = n;
        setBeat(n);
        sfx.play('tick', n === 1 ? 1.3 : 1.1);
      }
    }
  });

  const mark = (got: boolean) => {
    if (step.s !== 'play' || !match || match.slip === null) return;
    if (!got && bowlNow(match).length < 2) return;
    // Presses still coming from before the slip showed (mashing through the 3-2-1) never score it.
    if (!fresh(playAt.current)) return;
    const now = performance.now();
    if (now - lastTap.current < 160) return;
    lastTap.current = now;
    const el = slipText.current;
    setFx({ n: ++fxN.current, got, text: slips[match.slip] ?? '', size: el?.style.fontSize ?? '', broken: !!el?.classList.contains('is-broken') });
    if (!got) {
      sfx.noise(0.09, 0.05);
      sfx.tone({ freq: 380, to: 240, dur: 0.12, type: 'triangle', vol: 0.12 });
      streak.current = 0;
      setMatch(markSkip(match));
      return;
    }
    const round = roundNow(match);
    const r = markGot(match, clockRun.left);
    setMatch(r.match);
    if (r.ended === 'none') {
      sfx.play('coin', 1 + Math.min(streak.current, 8) * 0.05);
      streak.current++;
      return;
    }
    sfx.play('win');
    setStep({ s: 'break', round });
  };

  useKeys((code, e) => {
    if (e?.repeat || step.s !== 'play') return;
    if (code === 'ArrowRight' || code === 'Space' || code === 'Enter') mark(true);
    else if (code === 'ArrowLeft') mark(false);
  });

  const begin = (names: string[], bowl: string[]) => {
    setSlips(bowl);
    setMatch(newMatch(bowl.length, buildTeams(names.length), 0));
    setStep({ s: 'ready' });
  };

  const start = () => {
    const names = players.slice();
    setTable(names);
    setFx(null);
    if (source === 'builtin') begin(names, builtInBowl(BUILT_IN, bowlSize(names.length), heat === 'dark' ? AFTER_DARK : []));
    else if (source === 'last' && saved) begin(names, saved.slips);
    else {
      setWritten(names.map(() => []));
      setStep({ s: 'pass-write', i: 0 });
    }
  };

  /** 3, 2, 1, then the first slip comes out. Carried time stays on the clock. */
  const startCount = () => {
    if (!match) return;
    if (match.carry === null) clockRun.reset(seconds);
    countIn.current = { t: 0, beat: 3 };
    setBeat(3);
    streak.current = 0;
    setFx(null);
    sfx.play('tick', 1.1);
    setStep({ s: 'count' });
  };

  const go = () => {
    if (!match) return;
    setMatch(deal(match));
    playAt.current = performance.now();
    sfx.tone({ freq: 520, to: 1040, dur: 0.18, type: 'square', vol: 0.11 });
    setStep({ s: 'play' });
  };

  const finish = (m: Match) => {
    setMatch(m);
    sfx.play('win');
    setStep({ s: 'done' });
  };

  /* Setup */
  if (step.s === 'setup' || table.length < MIN_PLAYERS) {
    const n = players.length;
    const ready = n >= MIN_PLAYERS;
    const short = MIN_PLAYERS - n;
    const sources: (readonly [Source, string])[] = saved
      ? [
          ['write', 'Write Our Own'],
          ['builtin', 'Built-in'],
          ['last', 'Last Bowl'],
        ]
      : [
          ['write', 'Write Our Own'],
          ['builtin', 'Built-in Bowl'],
        ];
    const writers = saved ? (saved.by.length > 4 ? `${saved.by.slice(0, 3).join(', ')} and ${saved.by.length - 3} more` : listNames(saved.by)) : '';
    return (
      <Screen
        key="setup"
        className="g-fishbowl-setup"
        center={false}
        onEnter={ready ? start : undefined}
        actions={
          <Big primary disabled={!ready} onClick={start}>
            {!ready ? `Add ${short} More ${short === 1 ? 'Player' : 'Players'}` : source === 'builtin' ? 'Fill the Bowl' : source === 'last' ? 'Use the Last Bowl' : 'Write the Slips'}
          </Big>
        }
      >
        <header className="g-fishbowl-head">
          <Bowl left={22} total={22} size={92} />
          <div>
            <h2 className="arcade-party-title">Fishbowl</h2>
            <p className="arcade-party-sub">Fill a bowl with names, then guess the same slips three rounds running, with fewer words each time.</p>
          </div>
        </header>
        <HowToPlay
          steps={[
            'Everyone secretly writes a few names on slips: people, characters, places, things. They all go in the bowl.',
            'Two teams take turns. The clue giver pulls slips and gets their team to guess as many as they can before time runs out.',
            <>
              Round 1, <b>Describe It</b>: say anything but the words on the slip. Round 2, <b>One Word</b>. Round 3, <b>Act It Out</b>, no sounds at all.
            </>,
            'Skip as often as you like. The slip goes back in the bowl.',
            'When the bowl empties, the round ends and the clue giver keeps their leftover time for the next one.',
            'Same slips every round, so the jokes build. Most slips after three rounds wins.',
          ]}
        />
        <PlayerList min={MIN_PLAYERS} />
        {n > 0 && <TeamsPreview names={players} />}
        <Option label="Slips" value={source} options={sources} onChange={setSource} />
        {source === 'last' && saved ? (
          <p className="g-fishbowl-hint">
            The {saved.slips.length} slips {writers ? `${writers} wrote` : 'written'} last time. Nobody has to type.
          </p>
        ) : source === 'write' ? (
          <Option
            label="Slips Each"
            value={eachSetting}
            options={[
              ['3', '3'],
              ['4', '4'],
              ['5', '5'],
            ]}
            onChange={setEach}
          />
        ) : (
          <>
            <Option
              label="Built-in Bowl"
              value={heat}
              options={[
                ['classic', 'Classic'],
                ['dark', 'After Dark 18+'],
              ]}
              onChange={setHeat}
            />
            <p className="g-fishbowl-hint">
              {heat === 'dark'
                ? `${bowlSize(Math.max(n, MIN_PLAYERS))} slips, half of them 18+: hookups, kinks and steamy movie scenes. For groups who know each other well.`
                : `${bowlSize(Math.max(n, MIN_PLAYERS))} slips of famous people, characters, places and things. Nobody has to type.`}
            </p>
          </>
        )}
        <Option
          label="Turn Time"
          value={time}
          options={[
            ['30', '30 Sec'],
            ['45', '45 Sec'],
            ['60', '60 Sec'],
          ]}
          onChange={setTime}
        />
      </Screen>
    );
  }

  /* Writing slips */
  if (step.s === 'pass-write')
    return <PassTo key={`pass-write-${step.i}`} name={name(step.i)} index={step.i} note={`Write ${each} slips in secret. Nobody else looks.`} onReady={() => setStep({ s: 'write', i: step.i })} />;

  if (step.s === 'write') {
    const i = step.i;
    const last = i + 1 >= table.length;
    const done = () => {
      if ((written[i]?.length ?? 0) < each) return;
      if (!last) return setStep({ s: 'pass-write', i: i + 1 });
      const bowl = written.flat();
      // Kept on this device, so a reload or a Restart can deal the same bowl without anyone writing again.
      setSaved({ slips: bowl, by: table.slice() });
      begin(table, bowl);
    };
    const teams = buildTeams(table.length);
    return (
      <Write
        key={`write-${i}`}
        name={name(i)}
        max={each}
        slips={written[i] ?? []}
        onChange={(own) => setWritten(written.map((w, k) => (k === i ? own : w)))}
        next={name(last ? teams[0][0] : i + 1)}
        onDone={done}
      />
    );
  }

  if (!match) return null;
  const teams = match.teams;
  const team = teamNow(match);
  const giver = giverNow(match);
  const round = roundNow(match);
  const count = match.count;

  /* The phone goes to the clue giver, with the round's rule big enough for the room. */
  if (step.s === 'ready') {
    const left = bowlNow(match).length;
    const carry = match.carry !== null;
    const rule = RULES[Math.min(round, ROUNDS - 1)];
    const startIt = guarded(startCount);
    return (
      <Screen
        key={`ready-${match.turns.length}-${round}`}
        className={`g-fishbowl-ready ${teamClass(team)}`}
        arm={ARM}
        onEnter={startIt}
        actions={
          <Big primary quiet onClick={startIt}>
            {carry ? `Start With ${clock(clockRun.left)}` : 'Start the Clock'}
          </Big>
        }
      >
        <div className="g-fishbowl-hand">
          <Avatar name={name(giver)} index={giver} size={52} />
          <p className="arcade-party-kicker">{carry ? 'Still your turn' : 'Pass the phone to'}</p>
          <FitName text={name(giver)} />
          <p className="g-fishbowl-facts">
            <TeamTag t={team} chip />
            {carry ? (
              <span>
                Keeps <b>{clock(clockRun.left)}</b>
              </span>
            ) : (
              <span>{seconds} sec to give clues</span>
            )}
          </p>
        </div>
        <div className="g-fishbowl-round">
          <div className="g-fishbowl-stock">
            <Bowl left={left} total={count} size={88} refill={left === count} />
            <span>{left} in the bowl</span>
          </div>
          <div>
            <p className="g-fishbowl-roundno">
              Round {round + 1} of {ROUNDS}
            </p>
            <h3 className="g-fishbowl-rulename">{rule.name}</h3>
            <p className="g-fishbowl-ruletext">{rule.rule}</p>
          </div>
        </div>
      </Screen>
    );
  }

  /* Play: the 3-2-1, the slips, and the Time stamp when the clock runs out */
  if (step.s === 'count' || step.s === 'play' || step.s === 'up') {
    const live = step.s === 'play';
    const playRound = step.s === 'up' ? step.round : round;
    const rule = RULES[Math.min(playRound, ROUNDS - 1)];
    const left = bowlNow(match).length;
    const lastOne = left < 2;
    // When time runs out the slip in hand goes back in the bowl as the last card; it stays on screen under the stamp.
    const inHand = live ? match.slip : step.s === 'up' ? (match.cards[match.cards.length - 1]?.slip ?? null) : null;
    const text = inHand !== null ? (slips[inHand] ?? '') : '';
    const slipKey = live ? match.cards.length : match.cards.length - 1;
    const pts = points(match.cards);
    return (
      <Screen
        key={`play-${match.turns.length}`}
        className={`g-fishbowl-play ${teamClass(team)} ${step.s === 'up' ? 'is-up' : ''}`}
        center={false}
        actions={
          <div className="g-fishbowl-keys">
            <button type="button" className="arcade-party-btn g-fishbowl-skip" disabled={!live || lastOne} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 7L4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{lastOne ? 'Last Slip' : 'Skip'}</span>
              {!touch && !lastOne && <kbd>← key</kbd>}
            </button>
            <button type="button" className="arcade-party-btn is-primary g-fishbowl-got" disabled={!live} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Got It</span>
              {!touch && <kbd>→ or Space</kbd>}
            </button>
          </div>
        }
      >
        <div className="g-fishbowl-top">
          <div className="g-fishbowl-who">
            <TeamTag t={team} chip />
            <span className="g-fishbowl-pts" aria-live="polite">
              <b key={pts}>{pts}</b> this turn
            </span>
          </div>
          <Countdown left={clockRun.left} total={seconds} size={76} />
          <div className="g-fishbowl-left">
            <Bowl left={left} total={count} size={56} />
            <span>{left} left</span>
          </div>
          <div className="g-fishbowl-rule">
            <i aria-hidden="true">{playRound + 1}</i>
            <div>
              <b>{rule.name}</b>
              <span>{rule.rule}</span>
            </div>
          </div>
        </div>
        <div className="g-fishbowl-desk">
          {step.s === 'count' ? (
            <div className="g-fishbowl-slip is-back" role="status" aria-label={`First slip in ${beat}`}>
              <span key={beat} className="g-fishbowl-beat" aria-hidden="true">
                {beat}
              </span>
            </div>
          ) : (
            text && <Slip key={`slip-${slipKey}`} text={text} tilt={slipKey % 2 === 1} textRef={slipText} />
          )}
          {fx && live && (
            <div key={`out-${fx.n}`} className={`g-fishbowl-slip is-out ${fx.got ? 'is-got' : 'is-skip'}`} aria-hidden="true">
              <div className="g-fishbowl-fit">
                <strong className={fx.broken ? 'is-broken' : undefined} style={{ fontSize: fx.size || undefined }}>
                  <Words text={fx.text} />
                </strong>
              </div>
              <em>{fx.got ? 'Got It' : 'Back In'}</em>
            </div>
          )}
          {step.s === 'up' && (
            <div className="g-fishbowl-stamp" role="status">
              <span>Time's Up</span>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  /* Review after the clock runs out */
  if (step.s === 'review') {
    const pts = points(match.cards);
    const after = endTurn(match);
    const over = isOver(match);
    const nextGiver = giverOf(teams, match.turns.length + 1, match.first);
    const sc = totals(scoreTable(match.turns, { team, cards: match.cards }));
    const now = roundNow(match);
    const split = pointsByRound(match.cards);
    const next = guarded(() => {
      if (over) return finish(after);
      setMatch(after);
      setStep({ s: 'ready' });
    });
    return (
      <Screen
        key={`review-${match.turns.length}`}
        className={`g-fishbowl-review ${teamClass(team)}`}
        center={false}
        arm={ARM}
        kicker="Time's up"
        title={`${pts} for ${TEAMS[team].name}`}
        sub={split.length > 1 ? `${listNames(split.map((r) => `${r.points} in round ${r.round + 1}`))}.` : undefined}
        onEnter={next}
        actions={
          <Big primary onClick={next}>
            {over ? 'See Who Won' : `Pass to ${name(nextGiver)}`}
          </Big>
        }
      >
        <Board scores={sc} plus={{ team, n: pts }} />
        <Rows match={match} round={step.round} slips={slips} who={name(giver)} split={split.length > 1} onFix={(slip) => setMatch(fix(match, slip, step.round))} />
        <p className="g-fishbowl-hint">
          {over
            ? 'That was the last slip of the game.'
            : now > step.round
              ? `That empties the bowl. Round ${now + 1}, ${RULES[now].name}, starts next turn.`
              : `${bowlNow(match).length} of ${count} slips left in round ${now + 1}.`}
        </p>
      </Screen>
    );
  }

  /* The bowl emptied mid-turn */
  if (step.s === 'break') {
    const r = step.round;
    const now = roundNow(match);
    const reopened = now === r;
    const over = now >= ROUNDS;
    const roundScores = scoreTable(match.turns, { team, cards: match.cards })[r];
    const left = clock(clockRun.left);
    const go = guarded(() => {
      if (over) finish(endTurn(match));
      else if (reopened) startCount();
      else {
        sfx.play('select');
        setStep({ s: 'ready' });
      }
    });
    return (
      <Screen
        key={`break-${r}`}
        className={`g-fishbowl-break ${teamClass(team)}`}
        center={false}
        arm={ARM}
        onEnter={go}
        actions={
          <Big primary quiet={!over} onClick={go}>
            {over ? 'See Who Won' : reopened ? `Keep Going With ${left}` : `On to Round ${now + 1}`}
          </Big>
        }
      >
        <div className="g-fishbowl-empty" role="status">
          <Bowl left={reopened ? bowlNow(match).length : 0} total={count} size={112} />
          <div>
            <p className="arcade-party-kicker">{reopened ? `Round ${r + 1}` : `Round ${r + 1} is done`}</p>
            <h2 className="arcade-party-title">{reopened ? 'Not Empty Yet' : "Bowl's Empty"}</h2>
            <p className="arcade-party-sub">
              {over ? 'Check the last slips, then see who won.' : reopened ? `A slip went back in. ${name(giver)} plays on with ${left}.` : `${name(giver)} keeps ${left} for round ${now + 1}.`}
            </p>
          </div>
        </div>
        <div className="g-fishbowl-roundscore">
          <span>Round {r + 1}</span>
          {([0, 1] as const).map((t) => (
            <span key={t} className={teamClass(t)}>
              <TeamTag t={t} /> <b>{roundScores[t]}</b>
            </span>
          ))}
        </div>
        <Rows match={match} round={r} slips={slips} who={name(giver)} split={pointsByRound(match.cards).length > 1} onFix={(slip) => setMatch(fix(match, slip, r))} />
      </Screen>
    );
  }

  /* Final */
  const tableScores = scoreTable(match.turns);
  const sc = totals(tableScores);
  const win = leader(sc);
  const best = bestTurn(match.turns);
  const tough = toughest(match.turns);
  const again = guarded(() => {
    setFx(null);
    setMatch(replay(match));
    setStep({ s: 'ready' });
  });
  const change = guarded(() => setStep({ s: 'setup' }));
  return (
    <Screen
      key="done"
      className={`g-fishbowl-done ${win === null ? '' : teamClass(win)}`}
      center={false}
      arm={ARM}
      kicker="After three rounds"
      title={win === null ? "It's a Tie" : `${TEAMS[win].name} Win`}
      onEnter={again}
      actions={
        <>
          <Big primary onClick={again}>
            Play This Bowl Again
          </Big>
          <Big onClick={change}>Change Setup</Big>
        </>
      }
    >
      <div role="status" className="g-fishbowl-final">
        <Board scores={sc} hi={win} />
      </div>
      <table className="g-fishbowl-table" aria-label="Slips by round">
        <thead>
          <tr>
            <th scope="col">Round</th>
            {([0, 1] as const).map((t) => (
              <th key={t} scope="col" className={teamClass(t)}>
                {TEAMS[t].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableScores.map((row, r) => (
            <tr key={r}>
              <th scope="row">
                <i>{r + 1}</i>
                {RULES[r].name}
              </th>
              {row.map((v, t) => (
                <td key={t} className={v > row[1 - t] ? 'is-more' : undefined}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(best || tough) && (
        <ul className="g-fishbowl-notes">
          {best && (
            <li className={teamClass(best.turn.team)}>
              <small>Best turn</small>
              <FitText text={name(best.turn.giver)} className="g-fishbowl-note" />
              <p>
                {best.points} {best.points === 1 ? 'slip' : 'slips'} for {TEAMS[best.turn.team].name}
              </p>
            </li>
          )}
          {tough && (
            <li>
              <small>Hardest slip</small>
              <FitText text={slips[tough.slip] ?? ''} className="g-fishbowl-note" />
              <p>Skipped {tough.skips} times</p>
            </li>
          )}
        </ul>
      )}
    </Screen>
  );
}

/**
 * Notes every tap and action key inside the game into a Bursts tracker (see logic.ts). Returns a check: does the press
 * in progress belong to a step that appeared at `since`?
 */
function useBursts() {
  const shell = useShell();
  const bursts = useRef(new Bursts());
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    const tap = () => bursts.current.note(performance.now());
    const key = (e: KeyboardEvent) => {
      if (!e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight')) tap();
    };
    // Capture, so the press is noted before any button or key handler acts on it.
    el.addEventListener('pointerdown', tap, true);
    el.addEventListener('keydown', key, true);
    return () => {
      el.removeEventListener('pointerdown', tap, true);
      el.removeEventListener('keydown', key, true);
    };
  }, [shell.root]);
  return useCallback((since: number) => bursts.current.fresh(since, performance.now()), []);
}

/**
 * Sizes text to the largest font size, up to its CSS size (and `tall` times its box's height), at which every word
 * fits its box on one line. Only when even `min` px can't hold the longest word does it let words break, as a last
 * resort (`is-broken`). With `tall` the text must also fit the box's height. Refits when the box resizes or a font loads.
 */
function useFit(ref: RefObject<HTMLElement | null>, text: string, { min = 12, tall = 0 }: { min?: number; tall?: number } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    let size = '';
    const fit = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      size = `${w}x${tall ? h : 0}`;
      if (!w) return;
      el.style.fontSize = '';
      el.classList.remove('is-broken');
      const css = parseFloat(getComputedStyle(el).fontSize) || 16;
      const top = tall && h ? Math.max(min, Math.min(css, h * tall)) : css;
      const fits = (px: number) => {
        el.style.fontSize = `${px}px`;
        return el.scrollWidth <= w + 1 && (!tall || el.offsetHeight <= h + 1);
      };
      const largest = () => {
        if (fits(top)) return true;
        if (!fits(min)) return false;
        let lo = min;
        let hi = top;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        el.style.fontSize = `${Math.floor(lo)}px`;
        return true;
      };
      if (largest()) return;
      // At the smallest size, so the word breaks as few times as it can.
      el.classList.add('is-broken');
      el.style.fontSize = `${min}px`;
    };
    fit();
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (`${box.clientWidth}x${tall ? box.clientHeight : 0}` !== size) fit();
          });
    ro?.observe(box);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', fit);
    };
  }, [ref, text, min, tall]);
}

/** A slip's text: it wraps between words but never inside one, not even at a hyphen (Spider-Man, Jean-Claude). */
const Words = ({ text }: { text: string }) => (
  <>
    {text.split(' ').map((w, i) => (
      <Fragment key={i}>
        {i > 0 && ' '}
        <span className="g-fishbowl-nb">{w}</span>
      </Fragment>
    ))}
  </>
);

/** The slip in the clue giver's hand, as big as the paper allows. */
function Slip({ text, tilt, textRef }: { text: string; tilt: boolean; textRef: RefObject<HTMLElement | null> }) {
  useFit(textRef, text, { min: 12, tall: 0.5 });
  return (
    <div className={`g-fishbowl-slip ${tilt ? 'is-tilt' : ''}`}>
      <div className="g-fishbowl-fit">
        <strong ref={textRef}>
          <Words text={text} />
        </strong>
      </div>
    </div>
  );
}

/** A line of slip or name text that shrinks to keep its longest word whole. Sized by its CSS font size. */
function FitText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useFit(ref, text);
  return (
    <span className={['g-fishbowl-line', className ?? ''].join(' ')}>
      <span ref={ref}>
        <Words text={text} />
      </span>
    </span>
  );
}

/** The next clue giver's name, as big as one line allows. */
function FitName({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useFit(ref, text, { min: 22 });
  return (
    <h2 className="arcade-party-title g-fishbowl-name">
      <span ref={ref}>{text}</span>
    </h2>
  );
}

/** One player's private slip writing: add them one by one, remove any, and nobody else's are visible. */
function Write({ name, max, slips, onChange, next, onDone }: { name: string; max: number; slips: string[]; onChange: (s: string[]) => void; next: string; onDone: () => void }) {
  const shell = useShell();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const full = slips.length >= max;
  const fullNow = useRef(full);
  fullNow.current = full;
  useEffect(() => {
    if (full) shell.root.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
  }, [full, shell.root]);
  // The second tap of a double tap on the handoff lands here and pulls focus off the field, which closes the phone's
  // keyboard. For a moment after the step appears, focus that falls back to the game goes straight back to the field.
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const shown = performance.now();
    const back = (e: FocusEvent) => {
      if (e.target === root && !fullNow.current && performance.now() - shown < 1500) input.current?.focus({ preventScroll: true });
    };
    root.addEventListener('focusin', back);
    return () => root.removeEventListener('focusin', back);
  }, [shell.root]);
  const add = () => {
    const r = addSlip(slips, draft, max);
    if (!r.ok) return setNote(r.reason);
    sfx.play('blip');
    onChange(r.slips);
    setDraft('');
    setNote('');
  };
  const need = max - slips.length;
  return (
    <Screen
      key="write"
      className="g-fishbowl-write"
      center={false}
      title={`${name}'s Slips`}
      sub={`Write ${max} names the whole room knows. Inside jokes welcome.`}
      onEnter={full ? onDone : undefined}
      actions={
        <Big primary disabled={!full} onClick={onDone}>
          {full ? `Done, Pass to ${next}` : `Write ${need} More`}
        </Big>
      }
    >
      <div className="arcade-party-field">
        <form
          className="arcade-party-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            ref={input}
            className="arcade-input"
            type="text"
            aria-label="New slip"
            placeholder={full ? 'All written' : 'A person, place or thing'}
            maxLength={SLIP_MAX}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
            spellCheck={false}
            disabled={full}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (note) setNote('');
            }}
            onKeyDown={(e) => {
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
            }}
          />
          <button type="submit" className="arcade-btn" disabled={full || !draft.trim()}>
            Add
          </button>
        </form>
        <small className={note ? 'is-note' : undefined} aria-live="polite">
          {note || (full ? 'All in. Only you have seen these.' : 'Only you see these. Tap one to take it back out.')}
        </small>
      </div>
      <ol className="g-fishbowl-mine" aria-label={`${slips.length} of ${max} slips written`}>
        {Array.from({ length: max }, (_, k) => {
          const s = slips[k];
          return s !== undefined ? (
            <li key={`${k}-${s}`} className="is-filled">
              <button
                type="button"
                aria-label={`Remove ${s}`}
                onClick={() => {
                  sfx.play('hit', 1.4);
                  onChange(slips.filter((_, j) => j !== k));
                }}
              >
                <FitText text={s} />
                <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ) : (
            <li key={`empty-${k}`} className="is-empty">
              Slip {k + 1}
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}

/**
 * This turn's slips in one round, as paper strips: tap to flip between guessed and back in the bowl. In round 1 a slip
 * that goes back in the bowl is still a secret from the other team, so it stays face down until someone taps it.
 */
function Rows({ match, round, slips, who, split, onFix }: { match: Match; round: number; slips: string[]; who: string; split: boolean; onFix: (slip: number) => void }) {
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set());
  const rows = reviewRows(match.cards, round);
  if (!rows.length) return <p className="g-fishbowl-hint">Nothing came out of the bowl this turn.</p>;
  const show = (slip: number) => setShown(new Set(shown).add(slip));
  return (
    <div className="arcade-party-field g-fishbowl-list">
      <span>
        {split ? `${who}'s round ${round + 1} slips` : `${who}'s slips`}
        <small>Tap one to fix it</small>
      </span>
      <ul className="g-fishbowl-rows" aria-label="Slips this turn">
        {rows.map((row) => {
          const what = row.got ? 'Got It' : row.buzzer ? 'At the Buzzer' : row.skips > 1 ? `Skipped ${row.skips}x` : 'Skipped';
          const hidden = round === 0 && !row.got && !shown.has(row.slip);
          return (
            <li key={row.slip}>
              <button
                type="button"
                aria-pressed={hidden ? undefined : row.got}
                aria-label={hidden ? `Hidden slip, ${what.toLowerCase()}. Show it.` : undefined}
                className={row.got ? 'is-got' : hidden ? 'is-hidden' : undefined}
                // A tap shouldn't leave focus here, or Enter would flip the slip again instead of moving on.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  show(row.slip);
                  if (hidden) return sfx.play('blip', 1.2);
                  sfx.play(row.got ? 'blip' : 'coin', row.got ? 0.7 : 1);
                  onFix(row.slip);
                }}
              >
                {hidden ? (
                  <span className="g-fishbowl-veil">
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
                    </svg>
                    Tap to show
                  </span>
                ) : (
                  <FitText text={slips[row.slip] ?? ''} />
                )}
                <em>
                  {row.got && (
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {what}
                </em>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Board({ scores, plus, hi = null }: { scores: [number, number]; plus?: { team: TeamIndex; n: number }; hi?: TeamIndex | null }) {
  return (
    <div className="g-fishbowl-board">
      {([0, 1] as const).map((t) => (
        <div key={t} className={`g-fishbowl-side ${teamClass(t)} ${hi === t ? 'is-hi' : ''}`}>
          <TeamTag t={t} />
          <b>{scores[t]}</b>
          {plus?.team === t && plus.n > 0 && <em>+{plus.n}</em>}
        </div>
      ))}
    </div>
  );
}

function TeamsPreview({ names }: { names: string[] }) {
  const teams = buildTeams(names.length);
  return (
    <div className="arcade-party-field">
      <span>Teams</span>
      <div className="g-fishbowl-teams">
        {([0, 1] as const).map((t) => (
          <section key={t} className={`g-fishbowl-team ${teamClass(t)}`} aria-label={TEAMS[t].name}>
            <h3>
              <TeamTag t={t} />
              <em>{teams[t].length}</em>
            </h3>
            {teams[t].length ? (
              <ul>
                {teams[t].map((s) => (
                  <li key={names[s]}>
                    <Avatar name={names[s]} index={s} size={20} />
                    <span>{names[s]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>The next player joins here.</p>
            )}
          </section>
        ))}
      </div>
      <small>Seats alternate, so teammates never sit side by side.</small>
    </div>
  );
}

function TeamTag({ t, chip }: { t: TeamIndex; chip?: boolean }) {
  return (
    <span className={`g-fishbowl-tag ${teamClass(t)} ${chip ? 'is-chip' : ''}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {t === 0 ? (
          <>
            <path d="M3 12c3.2-4.6 9.4-5 13.6 0-4.2 5-10.4 4.6-13.6 0z" fill="currentColor" />
            <path d="M16 12l5-4v8z" fill="currentColor" />
          </>
        ) : (
          <>
            <path d="M4.5 12a7.5 7.5 0 0 1 15 0z" fill="currentColor" />
            <path d="M8 13.5c-1 2 1 3.5 0 6M12 13.5c-1 2 1 3.5 0 6.5M16 13.5c-1 2 1 3.5 0 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
      {TEAMS[t].name}
    </span>
  );
}

/* The bowl: a glass fishbowl with folded paper slips piled inside, one shape per slip up to a point. */
const BODY = 'M38.4 20A42 42 0 1 0 81.6 20';
const SHINE = 'M29.2 41.6A34 34 0 0 0 28 67.6';
const MAX_SHOWN = 30;
const SPOTS = (() => {
  const rng = mulberry32(23);
  const out: { x: number; y: number; r: number }[] = [];
  for (let row = 0; out.length < MAX_SHOWN + 6; row++) {
    const y = 88 - row * 6.4;
    if (y < 30) break;
    const hw = Math.sqrt(Math.max(0, 40 * 40 - (y - 56) ** 2)) - 8;
    const n = Math.max(1, Math.floor((hw * 2) / 12.5));
    const gap = (hw * 2) / n;
    for (let k = 0; k < n; k++)
      out.push({
        x: 60 - hw + gap * (k + 0.5) + (rng() - 0.5) * 3,
        y: y + (rng() - 0.5) * 2.4,
        r: Math.round((rng() - 0.5) * 80),
      });
  }
  return out;
})();

function Bowl({ left, total, size, refill }: { left: number; total: number; size: number; refill?: boolean }) {
  const clip = `g-fishbowl-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const cap = Math.min(MAX_SHOWN, total);
  const shown = total <= 0 || left <= 0 ? 0 : Math.max(1, Math.round((cap * Math.min(left, total)) / total));
  return (
    <svg className={`g-fishbowl-bowl ${refill ? 'is-refill' : ''}`} viewBox="0 0 120 106" width={size} height={Math.round((size * 106) / 120)} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="60" cy="56" r="39.6" />
        </clipPath>
      </defs>
      <ellipse className="g-fishbowl-floor" cx="60" cy="101.5" rx="28" ry="3" />
      <path className="g-fishbowl-inside" d={`${BODY}z`} />
      <g clipPath={`url(#${clip})`}>
        {SPOTS.slice(0, shown).map((p, i) => (
          <g key={i} className="g-fishbowl-drop" style={{ ['--i' as string]: Math.min(i, 24) }}>
            <g className="g-fishbowl-paper" transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.r})`}>
              <rect x="-7.5" y="-4" width="15" height="8" rx="1.2" />
              <path d="M0-4v8" />
            </g>
          </g>
        ))}
      </g>
      <path className="g-fishbowl-glass" d={BODY} />
      <rect className="g-fishbowl-lip" x="33" y="15" width="54" height="7" rx="3.5" />
      <path className="g-fishbowl-shine" d={SHINE} />
    </svg>
  );
}
