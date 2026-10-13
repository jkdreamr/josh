import { useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useSetting } from '../../kit';
import { Avatar, Big, Chips, Countdown, Option, PassTo, Pile, PlayerList, Row, Screen, listNames, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { deal, imposterCount, maxImposters, secretsFor, vote, type Round, type Secret } from './logic';
import { meta } from './meta';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './words';
import './imposter.css';

const COUNT = defineSetting('imposter:count', ['1', '2', '3'] as const, '1');
const HINT = defineSetting('imposter:hint', ['category', 'none'] as const, 'category');
const TIMER = defineSetting('imposter:timer', ['0', '120', '180', '300'] as const, '0');
const parseDecks = (raw: unknown): CategoryId[] => {
  const ids = Array.isArray(raw) ? CATEGORY_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : CATEGORY_IDS;
};
const deckOptions = CATEGORY_IDS.map((id) => [id, CATEGORIES[id].label] as const);
const MIN = 3;

type Step =
  | { s: 'setup' }
  | { s: 'pass'; i: number; peek?: boolean }
  | { s: 'see'; i: number; peek?: boolean }
  | { s: 'talk' }
  | { s: 'peek' }
  | { s: 'vote' }
  | { s: 'caught'; seat: number; all: boolean }
  | { s: 'done'; crew: boolean; how: string };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [count, setCount] = useSetting(COUNT);
  const [hint, setHint] = useSetting(HINT);
  const [timer, setTimer] = useSetting(TIMER);
  const [decks, setDecks] = useStored<CategoryId[]>('imposter:decks', CATEGORY_IDS, parseDecks);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [out, setOut] = useState<number[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [tally, setTally] = useState({ crew: 0, imposters: 0 });
  const pile = useRef<{ key: string; pile: Pile<Secret> } | null>(null);
  const last = useRef<Secret | undefined>(undefined);
  const seconds = Number(timer);
  const clockRun = useCountdown(seconds || 1, {
    running: step.s === 'talk' && seconds > 0 && !timeUp,
    onEnd: () => {
      sfx.play('lose');
      setTimeUp(true);
    },
  });

  const toTalk = () => {
    setTimeUp(false);
    clockRun.reset(seconds || 1);
    setStep({ s: 'talk' });
  };

  const start = (names: string[]) => {
    const key = decks.join(',');
    if (pile.current?.key !== key) pile.current = { key, pile: new Pile(secretsFor(decks)) };
    const secret = pile.current.pile.draw(last.current);
    if (!secret) return;
    last.current = secret;
    setTable(names);
    setRound(deal(names.length, Number(count), secret));
    setOut([]);
    setPick(null);
    setStep({ s: 'pass', i: 0 });
  };

  const finish = (crew: boolean, how: string) => {
    sfx.play(crew ? 'win' : 'lose');
    setTally((t) => (crew ? { ...t, crew: t.crew + 1 } : { ...t, imposters: t.imposters + 1 }));
    setStep({ s: 'done', crew, how });
  };

  if (step.s === 'setup' || !round) {
    const n = players.length;
    const ready = n >= MIN;
    const want = Number(count);
    const capped = ready && want > maxImposters(n);
    return (
      <Screen
        key="setup"
        center={false}
        title="Imposter"
        sub="Everyone sees the secret word except the imposter. Give one-word clues, then vote out the faker."
        onEnter={ready ? () => start(players) : undefined}
        actions={
          <Big primary disabled={!ready} onClick={() => start(players)}>
            {ready ? 'Deal' : `Add ${MIN - n} More ${MIN - n === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <PlayerList min={MIN} />
        <Option label="Imposters" value={count} options={[['1', 'One'], ['2', 'Two'], ['3', 'Three']]} onChange={setCount} />
        {capped && <p className="g-imposter-note">{n} players get {imposterCount(want, n) === 1 ? 'one imposter' : `${imposterCount(want, n)} imposters`}. More need more players.</p>}
        <Option label="The Imposter Sees" value={hint} options={[['category', 'The Category'], ['none', 'Nothing']]} onChange={setHint} />
        <Option label="Clue Timer" value={timer} options={[['0', 'Off'], ['120', '2 Min'], ['180', '3 Min'], ['300', '5 Min']]} onChange={setTimer} />
        <Chips label="Categories" value={decks} options={deckOptions} onChange={setDecks} />
      </Screen>
    );
  }

  const name = (i: number) => table[i] ?? `Player ${i + 1}`;
  const label = CATEGORIES[round.category].label;
  const many = round.imposters.length > 1;

  if (step.s === 'pass') return <PassTo key={`pass-${step.i}-${step.peek ? 'p' : ''}`} name={name(step.i)} index={step.i} onReady={() => setStep({ s: 'see', i: step.i, peek: step.peek })} />;

  if (step.s === 'see') {
    const bad = round.imposters.includes(step.i);
    const nextSeat = step.i + 1;
    const next = () => {
      if (step.peek) setStep({ s: 'talk' });
      else if (nextSeat < table.length) setStep({ s: 'pass', i: nextSeat });
      else toTalk();
    };
    const go = step.peek ? 'Hide and Go Back' : nextSeat < table.length ? `Hide and Pass to ${name(nextSeat)}` : 'Hide and Start';
    return (
      <Screen key={`see-${step.i}`} onEnter={next} actions={<Big primary onClick={next}>{go}</Big>}>
        {bad ? (
          <div className="arcade-party-card g-imposter-bad">
            <small>You are</small>
            <strong>The Imposter</strong>
            <p>{hint === 'category' ? `The category is ${label}. Blend in and work out the word.` : 'No hints. Listen closely and blend in.'}</p>
          </div>
        ) : (
          <div className="arcade-party-card">
            <small>{label}</small>
            <strong className="g-imposter-word">{round.word}</strong>
            <p>Give a one-word clue when it's your turn. Not too obvious, someone is faking it.</p>
          </div>
        )}
      </Screen>
    );
  }

  const alive = table.map((_, i) => i).filter((i) => !out.includes(i));
  // Clues go around the circle from the first speaker, skipping anyone voted out.
  const order = Array.from({ length: table.length }, (_, k) => (round.first + k) % table.length).filter((i) => !out.includes(i));

  if (step.s === 'talk')
    return (
      <Screen
        key="talk"
        title={timeUp ? "Time's Up" : `${name(order[0])} Starts`}
        sub={timeUp ? 'Stop talking and vote.' : out.length ? 'Another round of clues, then vote again.' : 'Go around the circle. Everyone gives one word about the secret. Then vote.'}
        onEnter={() => {
          setPick(null);
          setStep({ s: 'vote' });
        }}
        actions={
          <>
            <Big
              primary
              onClick={() => {
                setPick(null);
                setStep({ s: 'vote' });
              }}
            >
              Vote
            </Big>
            <Big onClick={() => setStep({ s: 'peek' })}>Forgot the Word?</Big>
          </>
        }
      >
        {seconds > 0 && <Countdown left={clockRun.left} total={seconds} />}
        <ol className="g-imposter-order" aria-label="Clue order">
          {order.map((i) => (
            <li key={i}>
              <Avatar name={name(i)} index={i} size={24} />
              <span>{name(i)}</span>
            </li>
          ))}
        </ol>
        <p className="g-imposter-note">
          {many ? `${round.imposters.length} imposters` : 'One imposter'} among you.{hint === 'category' ? ` They know the category: ${label}.` : ''}
        </p>
      </Screen>
    );

  if (step.s === 'peek')
    return (
      <Screen key="peek" center={false} title="Who Needs a Look?" sub="Pass the phone to them next." actions={<Big onClick={() => setStep({ s: 'talk' })}>Back</Big>}>
        <div className="arcade-party-picks">
          {table.map((p, i) => (
            <button key={p} type="button" onClick={() => setStep({ s: 'pass', i, peek: true })}>
              <Avatar name={p} index={i} size={30} />
              <span>{p}</span>
            </button>
          ))}
        </div>
      </Screen>
    );

  if (step.s === 'vote') {
    const confirm = () => {
      if (pick === null) return;
      const r = vote(round, out, pick);
      if (r === 'innocent') {
        finish(false, `${name(pick)} was innocent.`);
        return;
      }
      sfx.play('coin');
      setOut([...out, pick]);
      setStep({ s: 'caught', seat: pick, all: r === 'caught-all' });
    };
    return (
      <Screen
        key="vote"
        center={false}
        title="Vote"
        sub="Count down from three and point. Tap whoever got the most votes. On a tie, talk it out and vote again."
        onEnter={pick !== null ? confirm : undefined}
        actions={
          <Row>
            <Big onClick={() => setStep({ s: 'talk' })}>Back</Big>
            <Big primary disabled={pick === null} onClick={confirm}>
              {pick === null ? 'Pick Someone' : `Vote Out ${name(pick)}`}
            </Big>
          </Row>
        }
      >
        <div className="arcade-party-picks">
          {alive.map((i) => (
            <button key={i} type="button" aria-pressed={pick === i} onClick={() => setPick(i)}>
              <Avatar name={name(i)} index={i} size={30} />
              <span>{name(i)}</span>
            </button>
          ))}
        </div>
      </Screen>
    );
  }

  if (step.s === 'caught') {
    const left = round.imposters.filter((i) => !out.includes(i)).length;
    if (!step.all)
      return (
        <Screen key="caught" title={`${name(step.seat)} Was an Imposter`} sub={`Nice. ${left === 1 ? 'One more is' : `${left} more are`} still out there. Another round of clues, then vote again.`} onEnter={toTalk} actions={<Big primary onClick={toTalk}>Keep Going</Big>}>
          <Avatar name={name(step.seat)} index={step.seat} size={72} />
        </Screen>
      );
    const guessers = many ? 'imposters' : name(step.seat);
    return (
      <Screen
        key="caught-all"
        title={many ? 'All Imposters Caught' : `Caught! ${name(step.seat)} Was the Imposter`}
        sub={`Last chance, ${guessers}: guess the secret word out loud. Get it right and you still win.`}
        actions={
          <Row>
            <Big onClick={() => finish(false, `Caught, but ${many ? 'the imposters' : name(step.seat)} guessed the word.`)}>They Got It</Big>
            <Big primary onClick={() => finish(true, `${many ? 'Every imposter' : name(step.seat)} caught, and the word stayed safe.`)}>
              Wrong Guess
            </Big>
          </Row>
        }
      >
        <Avatar name={name(step.seat)} index={step.seat} size={72} />
      </Screen>
    );
  }

  const imps = round.imposters.map(name);
  return (
    <Screen
      key="done"
      title={step.crew ? 'The Crew Wins' : many ? 'The Imposters Win' : 'The Imposter Wins'}
      sub={step.how}
      onEnter={() => start(table)}
      actions={
        <>
          <Big primary onClick={() => start(table)}>
            Next Round
          </Big>
          <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
        </>
      }
    >
      <div className="arcade-party-card is-plain g-imposter-answer">
        <small>The word was</small>
        <strong>{round.word}</strong>
        <p>
          {listNames(imps)} {imps.length > 1 ? 'were the imposters' : 'was the imposter'}.
        </p>
      </div>
      <ul className="arcade-party-scores" aria-label="Wins this session">
        <li className={step.crew ? 'is-hi' : undefined}>
          <span>Crew</span>
          <b>{tally.crew}</b>
        </li>
        <li className={step.crew ? undefined : 'is-hi'}>
          <span>Imposters</span>
          <b>{tally.imposters}</b>
        </li>
      </ul>
    </Screen>
  );
}
