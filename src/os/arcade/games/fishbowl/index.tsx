import { useEffect, useId, useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Countdown, HowToPlay, Option, PassTo, PlayerList, Screen, clock, mulberry32, useCountdown, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  MIN_PLAYERS,
  ROUNDS,
  SLIP_MAX,
  addSlip,
  bestTurn,
  bowlNow,
  bowlSize,
  buildTeams,
  builtInSlips,
  buzz,
  deal,
  endTurn,
  fix,
  giverNow,
  giverOf,
  isOver,
  leader,
  longestToken,
  markGot,
  markSkip,
  newMatch,
  points,
  replay,
  reviewRows,
  roundNow,
  scoreTable,
  teamNow,
  totals,
  toughest,
  type Match,
  type TeamIndex,
} from './logic';
import { meta } from './meta';
import { BUILT_IN } from './slips';
import './fishbowl.css';

const SOURCE = defineSetting('fishbowl:slips', ['write', 'builtin'] as const, 'write');
const EACH = defineSetting('fishbowl:each', ['3', '4', '5'] as const, '3');
const TIME = defineSetting('fishbowl:time', ['30', '45', '60'] as const, '45');

const TEAMS = [{ name: 'Goldfish' }, { name: 'Jellyfish' }] as const;
const teamClass = (t: TeamIndex) => `is-t${t}`;

const RULES = [
  { name: 'Describe It', rule: 'Say anything except the words on the slip.' },
  { name: 'One Word', rule: 'One word only. No gestures.' },
  { name: 'Act It Out', rule: 'No words, no sounds. Just act.' },
] as const;

/** How many characters wide a slip's text sizes itself for: its longest word, or a share of the whole for long slips. */
const slipLen = (text: string) => Math.max(6, longestToken(text), Math.ceil(Array.from(text).length / 3));

/** How long the Time stamp stays up before the review. */
const HOLD = 1.5;

type Step =
  | { s: 'setup' }
  | { s: 'pass-write'; i: number }
  | { s: 'write'; i: number }
  | { s: 'pass' }
  | { s: 'ready' }
  | { s: 'play' }
  | { s: 'up'; round: number }
  | { s: 'review'; round: number }
  | { s: 'break'; round: number }
  | { s: 'done' };

type Fx = { n: number; got: boolean; text: string };

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
  const [source, setSource] = useSetting(SOURCE);
  const [eachSetting, setEach] = useSetting(EACH);
  const [time, setTime] = useSetting(TIME);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [written, setWritten] = useState<string[][]>([]);
  const [slips, setSlips] = useState<string[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const fxN = useRef(0);
  const lastTap = useRef(0);
  const streak = useRef(0);
  const hold = useRef(0);

  const seconds = Number(time);
  const each = Number(eachSetting);
  const name = (seat: number) => table[seat] ?? `Player ${seat + 1}`;

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

  // The Time stamp holds for a beat before the review, and waits while the game is paused.
  useGameLoop((dt) => {
    if (step.s !== 'up') return;
    hold.current += dt;
    if (hold.current >= HOLD) {
      hold.current = -Infinity;
      setStep({ s: 'review', round: step.round });
    }
  });

  const mark = (got: boolean) => {
    if (step.s !== 'play' || !match || match.slip === null) return;
    if (!got && bowlNow(match).length < 2) return;
    const now = performance.now();
    if (now - lastTap.current < 160) return;
    lastTap.current = now;
    setFx({ n: ++fxN.current, got, text: slips[match.slip] ?? '' });
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
    if (code === 'ArrowRight') mark(true);
    else if (code === 'ArrowLeft') mark(false);
  });

  const begin = (names: string[], bowl: string[]) => {
    setSlips(bowl);
    setMatch(newMatch(bowl.length, buildTeams(names.length), 0));
    setStep({ s: 'pass' });
  };

  const start = () => {
    const names = players.slice();
    setTable(names);
    setFx(null);
    if (source === 'builtin') begin(names, builtInSlips(BUILT_IN, bowlSize(names.length)));
    else {
      setWritten(names.map(() => []));
      setStep({ s: 'pass-write', i: 0 });
    }
  };

  const playOn = () => {
    if (!match) return;
    if (match.carry === null) clockRun.reset(seconds);
    streak.current = 0;
    setFx(null);
    setMatch(deal(match));
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
    return (
      <Screen
        key="setup"
        className="g-fishbowl-setup"
        center={false}
        onEnter={ready ? start : undefined}
        actions={
          <Big primary disabled={!ready} onClick={start}>
            {!ready ? `Add ${short} More ${short === 1 ? 'Player' : 'Players'}` : source === 'builtin' ? 'Fill the Bowl' : 'Write the Slips'}
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
        <Option
          label="Slips"
          value={source}
          options={[
            ['write', 'Write Our Own'],
            ['builtin', 'Use the Built-in Bowl'],
          ]}
          onChange={setSource}
        />
        {source === 'write' ? (
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
          <p className="g-fishbowl-hint">{bowlSize(Math.max(n, MIN_PLAYERS))} slips of famous people, characters, places and things. Nobody has to type.</p>
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
      begin(table, written.flat());
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

  /* Handoff to the clue giver */
  if (step.s === 'pass') {
    const firstTurn = match.turns.length === 0 && match.cards.length === 0;
    return (
      <PassTo
        key={`pass-${match.turns.length}`}
        className={`g-fishbowl-pass ${teamClass(team)}`}
        name={name(giver)}
        index={giver}
        note={
          <>
            {firstTurn ? `${count} slips in the bowl. ` : ''}You give clues for <TeamTag t={team} />. Nobody else looks at the screen.
          </>
        }
        onReady={() => setStep({ s: 'ready' })}
      />
    );
  }

  /* Ready: the round's rule, big */
  if (step.s === 'ready') {
    const left = bowlNow(match).length;
    const carry = match.carry !== null;
    const rule = RULES[Math.min(round, ROUNDS - 1)];
    return (
      <Screen
        key={`ready-${match.turns.length}-${round}`}
        className={`g-fishbowl-ready ${teamClass(team)}`}
        onEnter={playOn}
        actions={
          <Big primary quiet onClick={playOn}>
            {carry ? `Start With ${clock(clockRun.left)}` : 'Start the Clock'}
          </Big>
        }
      >
        <Bowl left={left} total={count} size={136} refill={left === count} />
        <p className="g-fishbowl-roundno">
          Round {round + 1} of {ROUNDS}
        </p>
        <h2 className="g-fishbowl-rulename">{rule.name}</h2>
        <p className="g-fishbowl-ruletext">{rule.rule}</p>
        {carry ? (
          <p className="g-fishbowl-carry">
            <Avatar name={name(giver)} index={giver} size={22} />
            <span>
              {name(giver)} keeps <b>{clock(clockRun.left)}</b> from round {round}
            </span>
          </p>
        ) : (
          <p className="g-fishbowl-facts">
            <TeamTag t={team} chip />
            <span>{name(giver)} gives clues</span>
            <span>{seconds} sec</span>
          </p>
        )}
      </Screen>
    );
  }

  /* Play */
  if (step.s === 'play' || step.s === 'up') {
    const live = step.s === 'play';
    const playRound = step.s === 'up' ? step.round : round;
    const rule = RULES[Math.min(playRound, ROUNDS - 1)];
    const left = bowlNow(match).length;
    const lastOne = left < 2;
    // When time runs out the slip in hand goes back in the bowl as the last card; it stays on screen under the stamp.
    const inHand = live ? match.slip : (match.cards[match.cards.length - 1]?.slip ?? null);
    const text = inHand !== null ? (slips[inHand] ?? '') : '';
    const slipKey = live ? match.cards.length : match.cards.length - 1;
    const pts = points(match.cards);
    const len = slipLen(text);
    return (
      <Screen
        key={`play-${match.turns.length}`}
        className={`g-fishbowl-play ${teamClass(team)} ${live ? '' : 'is-up'}`}
        center={false}
        onEnter={live ? () => mark(true) : undefined}
        actions={
          <div className="g-fishbowl-keys">
            <button type="button" className="arcade-party-btn g-fishbowl-skip" disabled={!live || lastOne} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 7L4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{lastOne ? 'Last Slip' : 'Skip'}</span>
              {!touch && !lastOne && <kbd>Left</kbd>}
            </button>
            <button type="button" className="arcade-party-btn is-primary g-fishbowl-got" disabled={!live} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Got It</span>
              {!touch && <kbd>Right or Space</kbd>}
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
          {text && (
            <div key={`slip-${slipKey}`} className={`g-fishbowl-slip ${slipKey % 2 ? 'is-tilt' : ''}`} style={{ ['--len' as string]: len }}>
              <strong>{text}</strong>
            </div>
          )}
          {fx && live && (
            <div
              key={`out-${fx.n}`}
              className={`g-fishbowl-slip is-out ${fx.got ? 'is-got' : 'is-skip'}`}
              aria-hidden="true"
              style={{
                ['--len' as string]: slipLen(fx.text),
              }}
            >
              <strong>{fx.text}</strong>
              <em>{fx.got ? 'Got It' : 'Back In'}</em>
            </div>
          )}
          {!live && (
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
    const next = () => {
      if (over) return finish(after);
      setMatch(after);
      setStep({ s: 'pass' });
    };
    return (
      <Screen
        key={`review-${match.turns.length}`}
        className={`g-fishbowl-review ${teamClass(team)}`}
        center={false}
        kicker="Time's up"
        title={`${pts} for ${TEAMS[team].name}`}
        onEnter={next}
        actions={
          <Big primary onClick={next}>
            {over ? 'See Who Won' : `Pass to ${name(nextGiver)}`}
          </Big>
        }
      >
        <Board scores={sc} plus={{ team, n: pts }} />
        <Rows match={match} round={step.round} slips={slips} onFix={(slip) => setMatch(fix(match, slip, step.round))} />
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
    const go = () => {
      if (over) finish(endTurn(match));
      else if (reopened) playOn();
      else {
        sfx.play('select');
        setStep({ s: 'ready' });
      }
    };
    return (
      <Screen
        key={`break-${r}`}
        className={`g-fishbowl-break ${teamClass(team)}`}
        center={false}
        onEnter={go}
        actions={
          <Big primary quiet={!over && !reopened} onClick={go}>
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
        <Rows match={match} round={r} slips={slips} onFix={(slip) => setMatch(fix(match, slip, r))} />
      </Screen>
    );
  }

  /* Final */
  const tableScores = scoreTable(match.turns);
  const sc = totals(tableScores);
  const win = leader(sc);
  const best = bestTurn(match.turns);
  const tough = toughest(match.turns);
  const again = () => {
    setFx(null);
    setMatch(replay(match));
    setStep({ s: 'pass' });
  };
  return (
    <Screen
      key="done"
      className={`g-fishbowl-done ${win === null ? '' : teamClass(win)}`}
      center={false}
      kicker="After three rounds"
      title={win === null ? "It's a Tie" : `${TEAMS[win].name} Win`}
      onEnter={again}
      actions={
        <>
          <Big primary onClick={again}>
            Play This Bowl Again
          </Big>
          <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
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
            <li>
              <small>Best turn</small>
              <p className={teamClass(best.turn.team)}>
                <b>{name(best.turn.giver)}</b> got {best.points} in one turn
              </p>
            </li>
          )}
          {tough && (
            <li>
              <small>Hardest slip</small>
              <p>
                <q>{slips[tough.slip]}</q>, skipped {tough.skips} times
              </p>
            </li>
          )}
        </ul>
      )}
    </Screen>
  );
}

/** One player's private slip writing: add them one by one, remove any, and nobody else's are visible. */
function Write({ name, max, slips, onChange, next, onDone }: { name: string; max: number; slips: string[]; onChange: (s: string[]) => void; next: string; onDone: () => void }) {
  const shell = useShell();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const full = slips.length >= max;
  useEffect(() => {
    if (full) shell.root.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
  }, [full, shell.root]);
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
                <span>{s}</span>
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

/** This turn's slips in one round, as paper strips: tap to flip between guessed and back in the bowl. */
function Rows({ match, round, slips, onFix }: { match: Match; round: number; slips: string[]; onFix: (slip: number) => void }) {
  const rows = reviewRows(match.cards, round);
  if (!rows.length) return <p className="g-fishbowl-label">Nothing came out of the bowl this turn.</p>;
  return (
    <>
      <p className="g-fishbowl-label">This turn. Tap a slip to fix it.</p>
      <ul className="g-fishbowl-rows" aria-label="Slips this turn">
        {rows.map((row) => (
          <li key={row.slip}>
            <button
              type="button"
              aria-pressed={row.got}
              className={row.got ? 'is-got' : undefined}
              // A tap shouldn't leave focus here, or Enter would flip the slip again instead of moving on.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                sfx.play(row.got ? 'blip' : 'coin', row.got ? 0.7 : 1);
                onFix(row.slip);
              }}
            >
              <span>{slips[row.slip]}</span>
              <em>
                {row.got && (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {row.got ? 'Got It' : row.buzzer ? 'At the Buzzer' : row.skips > 1 ? `Skipped ${row.skips}x` : 'Skipped'}
              </em>
            </button>
          </li>
        ))}
      </ul>
    </>
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
