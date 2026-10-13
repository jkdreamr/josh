import { useRef, useState, type ReactNode } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting } from '../../kit';
import { Avatar, Big, Chips, Countdown, HowToPlay, Option, PassTo, Pile, PlayerList, Row, Screen, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { canSteal, cardFor, clueOrder, deal, imposterCount, maxImposters, pairsFor, playersFor, roundPoints, secretsFor, vote, type Mode, type Round, type Secret, type VoteResult } from './logic';
import { meta } from './meta';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './words';
import './imposter.css';

const COUNT = defineSetting('imposter:count', ['1', '2', '3'] as const, '1');
const HINT = defineSetting<Mode>('imposter:hint', ['category', 'none', 'similar'], 'category');
const TIMER = defineSetting('imposter:timer', ['0', '120', '180', '300'] as const, '0');
const parseDecks = (raw: unknown): CategoryId[] => {
  const ids = Array.isArray(raw) ? CATEGORY_IDS.filter((id) => raw.includes(id)) : [];
  return ids.length ? ids : CATEGORY_IDS;
};
const deckOptions = CATEGORY_IDS.map((id) => [id, CATEGORIES[id].label] as const);
const MIN = 3;
const NUMBER = ['', 'One', 'Two', 'Three'];

/** How long the room waits between the vote and the stamp, and when the drum hits land. */
const SUSPENSE = 1.75;
const BEATS = [0.05, 0.62, 1.06, 1.4];
/** Taps this soon after a reveal are a second tap on the skip, not a choice. */
const GUARD_MS = 350;

type Step =
  | { s: 'setup' }
  | { s: 'pass'; i: number; peek?: boolean }
  | { s: 'see'; i: number; peek?: boolean }
  | { s: 'talk' }
  | { s: 'peek' }
  | { s: 'vote' }
  | { s: 'verdict'; seat: number; result: VoteResult }
  | { s: 'done'; crew: boolean; how: string; news: boolean };

const sound = {
  drum(i: number) {
    const p = 1 + i * 0.06;
    sfx.tone({ freq: 150 * p, to: 70, dur: 0.14, type: 'triangle', vol: 0.3 });
    sfx.tone({ freq: 130 * p, to: 60, dur: 0.12, type: 'triangle', vol: 0.18, delay: 0.13 });
  },
  stamp(delay = 0) {
    sfx.tone({ freq: 210, to: 45, dur: 0.2, type: 'triangle', vol: 0.42, delay });
    sfx.tone({ freq: 1400, to: 300, dur: 0.04, type: 'square', vol: 0.08, delay });
  },
  guilty() {
    [523, 659, 784, 1047].forEach((f, i) => sfx.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.17, delay: 0.3 + i * 0.08 }));
  },
  innocent() {
    [392, 370, 349].forEach((f, i) => sfx.tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.18, delay: 0.32 + i * 0.24 }));
    sfx.tone({ freq: 330, to: 300, dur: 0.6, type: 'triangle', vol: 0.18, delay: 1.04 });
  },
  sly(delay = 0) {
    [784, 659, 523, 392].forEach((f, i) => sfx.tone({ freq: f, dur: 0.13, type: 'triangle', vol: 0.16, delay: delay + i * 0.09 }));
  },
};

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function rules(mode: Mode): ReactNode[] {
  const who =
    mode === 'category' ? 'who only gets the category.' : mode === 'none' ? 'who gets nothing at all.' : "who gets a close word and doesn't know it.";
  return [
    <>
      Tap <b>Deal</b> and pass the phone around. Everyone reads their card alone.
    </>,
    <>
      Everyone gets the same secret word except the <b>imposter</b>, {who}
    </>,
    <>
      Go around the circle. Each person says <b>one word</b> about the secret: enough to prove you know it, not enough to give it away.
    </>,
    <>Count to three and point. Tap whoever got the most votes.</>,
    mode === 'similar' ? (
      <>Vote out an innocent and the imposter wins. Catch every imposter and the crew wins.</>
    ) : (
      <>
        Vote out an innocent and the imposter wins. Catch the imposter and they get <b>one guess</b> at the word to steal it.
      </>
    ),
  ];
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
  const [timeUp, setTimeUp] = useState(false);
  const [roundNo, setRoundNo] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [gained, setGained] = useState<number[]>([]);
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
    const key = `${hint === 'similar' ? 'pairs' : 'words'}:${decks.join(',')}`;
    if (pile.current?.key !== key) pile.current = { key, pile: new Pile(hint === 'similar' ? pairsFor(decks) : secretsFor(decks)) };
    const secret = pile.current.pile.draw(last.current);
    if (!secret) return;
    last.current = secret;
    setTable(names);
    setRound(deal(names.length, Number(count), secret));
    setOut([]);
    setRoundNo((n) => n + 1);
    setStep({ s: 'pass', i: 0 });
  };

  const finish = (crew: boolean, how: string, news = false) => {
    if (!round) return;
    const pts = roundPoints(round, table.length, crew);
    setScores((s) => {
      const next = { ...s };
      table.forEach((p, i) => (next[p] = (next[p] ?? 0) + pts[i]));
      return next;
    });
    setGained(pts);
    if (crew) sfx.play('win');
    else if (news) {
      // The imposter's stamp lands on the case file a beat after it deals in.
      sound.stamp(0.76);
      sound.sly(1);
    } else sound.sly();
    setStep({ s: 'done', crew, how, news });
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
        sub="One of you doesn't know the word. Find them before they work it out."
        onEnter={ready ? () => start(players) : undefined}
        actions={
          <Big primary disabled={!ready} onClick={() => start(players)}>
            {ready ? 'Deal' : `Add ${MIN - n} More ${MIN - n === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <HowToPlay steps={rules(hint)} />
        <PlayerList min={MIN} />
        <div className="g-imposter-set">
          <Option
            label="The Imposter Gets"
            value={hint}
            options={[
              ['category', 'The Category'],
              ['none', 'Nothing'],
              ['similar', 'A Close Word'],
            ]}
            onChange={setHint}
          />
          {hint === 'similar' && <p className="g-imposter-note">They get a word close to yours and don't know they're the imposter.</p>}
        </div>
        <div className="g-imposter-set">
          <Option label="Imposters" value={count} options={[['1', 'One'], ['2', 'Two'], ['3', 'Three']]} onChange={setCount} />
          {capped && (
            <p className="g-imposter-note">
              {NUMBER[want]} imposters need {playersFor(want)} players. This table gets {imposterCount(want, n) === 1 ? 'one' : NUMBER[imposterCount(want, n)].toLowerCase()}.
            </p>
          )}
        </div>
        <Option label="Clue Timer" value={timer} options={[['0', 'Off'], ['120', '2 Min'], ['180', '3 Min'], ['300', '5 Min']]} onChange={setTimer} />
        <Chips label="Categories" value={decks} options={deckOptions} onChange={setDecks} />
      </Screen>
    );
  }

  const name = (i: number) => table[i] ?? `Player ${i + 1}`;
  const label = CATEGORIES[round.category].label;
  const many = round.imposters.length > 1;
  const similar = round.decoy !== undefined;

  if (step.s === 'pass')
    return (
      <PassTo
        key={`pass-${step.i}-${step.peek ? 'p' : ''}`}
        name={name(step.i)}
        index={step.i}
        note={step.peek ? 'Only they look. Everyone else, look away.' : undefined}
        onReady={() => setStep({ s: 'see', i: step.i, peek: step.peek })}
      />
    );

  if (step.s === 'see') {
    const card = cardFor(round, step.i);
    const nextSeat = step.i + 1;
    const next = () => {
      if (step.peek) setStep({ s: 'talk' });
      else if (nextSeat < table.length) setStep({ s: 'pass', i: nextSeat });
      else toTalk();
    };
    const go = step.peek ? 'Hide and Go Back' : nextSeat < table.length ? `Hide and Pass to ${name(nextSeat)}` : 'Hide and Start';
    const bad = card.kind === 'imposter';
    return (
      <Screen key={`see-${step.i}-${step.peek ? 'p' : ''}`} onEnter={next} actions={<Big primary onClick={next}>{go}</Big>}>
        <FileCard
          tab={bad && hint === 'none' ? 'Classified' : label}
          eyes={`Eyes only: ${name(step.i)}`}
          stamp={<Stamp>{bad ? 'Imposter' : 'Top Secret'}</Stamp>}
          foot={
            !bad
              ? 'Prove you know it without giving it away.'
              : hint === 'none'
                ? "You're the imposter. No word, no category. Listen, then bluff."
                : `You're the imposter. It's something in ${label}. Listen, then bluff.`
          }
        >
          {bad ? (
            <strong className="g-imposter-word">
              <span className="g-imposter-redact" role="img" aria-label="Redacted. You don't get the word." />
            </strong>
          ) : (
            <strong className="g-imposter-word">{card.word}</strong>
          )}
        </FileCard>
      </Screen>
    );
  }

  const alive = table.map((_, i) => i).filter((i) => !out.includes(i));
  const order = clueOrder(round, table.length, out);

  if (step.s === 'talk') {
    const left = round.imposters.filter((i) => !out.includes(i)).length;
    const toVote = () => setStep({ s: 'vote' });
    const note = similar
      ? `${left === 1 ? 'One player has' : `${NUMBER[left]} players have`} a different word. It might be you.`
      : `${left === 1 ? 'One imposter is' : `${NUMBER[left]} imposters are`} bluffing. ${hint === 'none' ? "They don't even know the category." : `They only know it's ${label}.`}`;
    return (
      <Screen key="talk" className="g-imposter-talk" onEnter={toVote} actions={<Big primary onClick={toVote}>Vote</Big>}>
        {seconds > 0 ? <Countdown left={clockRun.left} total={seconds} /> : <Avatar name={name(order[0])} index={order[0]} size={64} />}
        <p className="arcade-party-kicker">{timeUp ? "Time's up" : out.length ? 'Another round of clues' : 'Clue round'}</p>
        <h2 className="arcade-party-title is-huge">{timeUp ? 'Stop and Vote' : `${name(order[0])} Starts`}</h2>
        <ol className="g-imposter-order" aria-label="Clue order">
          {order.map((i, k) => (
            <li key={i} className={k === 0 ? 'is-first' : undefined}>
              <b>{k + 1}</b>
              <span>{name(i)}</span>
            </li>
          ))}
        </ol>
        <p className="g-imposter-note">{note}</p>
        <button type="button" className="g-imposter-link" onClick={() => setStep({ s: 'peek' })}>
          Forgot Your Word?
        </button>
      </Screen>
    );
  }

  if (step.s === 'peek')
    return (
      <Screen key="peek" center={false} title="Who Needs a Look?" sub="They see their card again. Pass them the phone." actions={<Big onClick={() => setStep({ s: 'talk' })}>Back</Big>}>
        <div className="arcade-party-picks">
          {alive.map((i) => (
            <button key={i} type="button" onClick={() => setStep({ s: 'pass', i, peek: true })}>
              <Avatar name={name(i)} index={i} size={30} />
              <span>{name(i)}</span>
            </button>
          ))}
        </div>
      </Screen>
    );

  if (step.s === 'vote')
    return (
      <Vote
        key="vote"
        alive={alive}
        name={name}
        onBack={() => setStep({ s: 'talk' })}
        onVote={(seat) => {
          const result = vote(round, out, seat);
          if (result !== 'innocent') setOut([...out, seat]);
          setStep({ s: 'verdict', seat, result });
        }}
      />
    );

  if (step.s === 'verdict') {
    const who = name(step.seat);
    const guilty = step.result !== 'innocent';
    const left = round.imposters.filter((i) => !out.includes(i)).length;
    const steal = step.result === 'caught-all' && canSteal(round);
    const caughtAll = many ? 'Every imposter caught' : `${who} got caught`;
    const closeCall = many ? 'Every imposter caught, each holding the wrong word.' : `${who} got caught holding the wrong word.`;
    let after: VerdictAfter;
    if (step.result === 'innocent')
      after = {
        line: `${who} was innocent.`,
        sub: many ? 'The imposters got away.' : 'The imposter got away.',
        actions: (
          <Big primary quiet onClick={() => finish(false, `You voted out ${who}, who was innocent.`, true)}>
            {many ? 'Reveal the Imposters' : 'Reveal the Imposter'}
          </Big>
        ),
        enter: () => finish(false, `You voted out ${who}, who was innocent.`, true),
      };
    else if (step.result === 'caught')
      after = {
        line: `${who} was an imposter.`,
        sub: `${left === 1 ? 'One more is' : `${NUMBER[left]} more are`} still out there. Another round of clues.`,
        actions: (
          <Big primary onClick={toTalk}>
            Back to Clues
          </Big>
        ),
        enter: toTalk,
      };
    else if (steal)
      after = {
        line: many ? 'Every imposter caught.' : `${who} was the imposter.`,
        sub: `${many ? 'They get one guess between them' : 'One guess at the word'}, out loud. Right steals the win.`,
        actions: (
          <Row>
            <Big quiet onClick={() => finish(true, `${caughtAll} and missed the word.`)}>Wrong Guess</Big>
            <Big quiet onClick={() => finish(false, `Caught, but ${many ? 'they' : who} named the word.`)}>Right Guess</Big>
          </Row>
        ),
      };
    else
      after = {
        line: many ? 'Every imposter caught.' : `${who} was the imposter.`,
        sub: many ? 'They had a different word and never knew it.' : `${who} had a different word and never knew it.`,
        actions: (
          <Big primary quiet onClick={() => finish(true, closeCall)}>
            See the Words
          </Big>
        ),
        enter: () => finish(true, closeCall),
      };
    return <Verdict key={`verdict-${step.seat}`} name={who} index={step.seat} guilty={guilty} question={`Was ${who} ${many ? 'an' : 'the'} imposter?`} after={after} />;
  }

  // Done: the case file, then the session scores.
  const imps = round.imposters;
  const ranked = table
    .map((p, i) => ({ p, i, total: scores[p] ?? 0, got: gained[i] ?? 0 }))
    .sort((a, b) => b.total - a.total || a.i - b.i);
  return (
    <Screen
      key="done"
      className="g-imposter-done"
      onEnter={() => start(table)}
      actions={
        <Row>
          <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
          <Big primary onClick={() => start(table)}>
            Next Round
          </Big>
        </Row>
      }
    >
      <p className="arcade-party-kicker">Round {roundNo}</p>
      <h2 className="arcade-party-title g-imposter-result" role="status">
        {step.crew ? 'The Crew Wins' : many ? 'The Imposters Win' : 'The Imposter Wins'}
      </h2>
      <p className="arcade-party-sub">{step.how}</p>
      <FileCard tab="Case closed" className="g-imposter-case">
        {similar ? (
          <div className="g-imposter-pair">
            <div>
              <span className="g-imposter-label">Crew word</span>
              <strong className="g-imposter-word">{round.word}</strong>
            </div>
            <div>
              <span className="g-imposter-label">{many ? 'Imposter word' : `${name(imps[0])}'s word`}</span>
              <strong className="g-imposter-word">{round.decoy}</strong>
            </div>
          </div>
        ) : (
          <div className="g-imposter-reveal">
            <span className="g-imposter-label">The word</span>
            <strong className="g-imposter-word">{round.word}</strong>
          </div>
        )}
        <div className={['g-imposter-culprits', step.news ? 'is-news' : ''].join(' ')}>
          <ul aria-label={many ? 'The imposters' : 'The imposter'}>
            {imps.map((i) => (
              <li key={i}>
                <Avatar name={name(i)} index={i} size={28} />
                <span>{name(i)}</span>
              </li>
            ))}
          </ul>
          <Stamp slam={step.news} delay={0.6}>
            {many ? 'Imposters' : 'Imposter'}
          </Stamp>
        </div>
      </FileCard>
      <div className="g-imposter-board">
        <span className="g-imposter-label">Scores</span>
        <ol className="arcade-party-scores" aria-label="Scores this session">
          {ranked.map(({ p, i, total, got }) => (
            <li key={p}>
              <Avatar name={p} index={i} size={26} />
              <span>{p}</span>
              {got > 0 && <em>+{got}</em>}
              <b>{total}</b>
            </li>
          ))}
        </ol>
      </div>
    </Screen>
  );
}

/** A cream case file with a tab, an "eyes only" line, a stamp and a footnote. Crew and imposter cards share it, so they look alike across the table. */
function FileCard({ tab, eyes, stamp, foot, className, onClick, children }: { tab: ReactNode; eyes?: ReactNode; stamp?: ReactNode; foot?: ReactNode; className?: string; onClick?: () => void; children?: ReactNode }) {
  return (
    <div className={['arcade-party-card is-paper g-imposter-file', className ?? ''].join(' ')} onClick={onClick}>
      <span className="g-imposter-tab">{tab}</span>
      {eyes && <span className="g-imposter-eyes">{eyes}</span>}
      {children}
      {stamp}
      {foot && <p className="g-imposter-foot">{foot}</p>}
    </div>
  );
}

function Stamp({ children, blue, slam, delay = 0 }: { children: ReactNode; blue?: boolean; slam?: boolean; delay?: number }) {
  return (
    <span className={['g-imposter-stamp', blue ? 'is-blue' : '', slam ? 'is-slam' : ''].join(' ')} style={slam && delay ? { animationDelay: `${delay}s` } : undefined}>
      {children}
    </span>
  );
}

function Vote({ alive, name, onBack, onVote }: { alive: number[]; name: (i: number) => string; onBack: () => void; onVote: (seat: number) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const confirm = () => {
    if (pick !== null) onVote(pick);
  };
  // 1 to 9 pick a player from the keyboard.
  useKeys((code, e) => {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (!m || e?.repeat) return;
    const seat = alive[Number(m[1]) - 1];
    if (seat === undefined) return;
    sfx.play('select');
    setPick(seat);
  });
  return (
    <Screen
      className="g-imposter-vote"
      center={false}
      title="Who's the Imposter?"
      sub="Count to three and point. Tap whoever got the most votes. Tied? Talk it out and vote again."
      onEnter={pick !== null ? confirm : undefined}
      actions={
        <Row>
          <Big onClick={onBack}>Back</Big>
          <Big primary quiet disabled={pick === null} onClick={confirm}>
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

type VerdictAfter = { line: string; sub: string; actions: ReactNode; enter?: () => void };

/** The accused's file sits on screen for a drum roll, then the stamp lands. Tap or Enter skips the wait. */
function Verdict({ name, index, guilty, question, after }: { name: string; index: number; guilty: boolean; question: string; after: VerdictAfter }) {
  const [shown, setShown] = useState(false);
  const [hits, setHits] = useState(0);
  const done = useRef(false);
  const at = useRef(0);
  const t = useRef(0);
  const beat = useRef(0);
  const reveal = () => {
    if (done.current) return;
    done.current = true;
    at.current = performance.now();
    sound.stamp(0.15);
    if (guilty) sound.guilty();
    else sound.innocent();
    setShown(true);
  };
  useGameLoop((dt) => {
    if (done.current) return;
    t.current += dt;
    if (beat.current < BEATS.length && t.current >= BEATS[beat.current]) {
      sound.drum(beat.current++);
      setHits(beat.current);
    }
    if (t.current >= SUSPENSE) reveal();
  });
  const settled = () => performance.now() - at.current >= GUARD_MS;
  return (
    <Screen
      className="g-imposter-verdict"
      onEnter={shown ? () => settled() && after.enter?.() : reveal}
      actions={
        shown ? (
          <div
            className="g-imposter-guard"
            onClickCapture={(e) => {
              if (settled()) return;
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {after.actions}
          </div>
        ) : (
          <div className="g-imposter-hold" aria-hidden="true" />
        )
      }
    >
      {/* Each drum hit nudges the file, so the wait reads even with the sound off. */}
      <FileCard tab="Voted out" className={shown ? 'is-hit' : hits ? `is-beat-${hits % 2 ? 'a' : 'b'}` : undefined} onClick={reveal}>
        <Avatar name={name} index={index} size={64} />
        <strong className="g-imposter-name">{name}</strong>
        <div className="g-imposter-slot">
          {shown && (
            <Stamp blue={!guilty} slam>
              {guilty ? 'Imposter' : 'Innocent'}
            </Stamp>
          )}
        </div>
      </FileCard>
      <div className="g-imposter-ruling" role="status">
        <p className="g-imposter-line">{shown ? after.line : question}</p>
        <p className="arcade-party-sub">{shown ? after.sub : ' '}</p>
      </div>
    </Screen>
  );
}
