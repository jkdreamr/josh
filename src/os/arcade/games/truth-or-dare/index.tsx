import { useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, Option, PlayerList, Row, Screen, listNames, sips, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DEFAULT_SPICE, EMPTY, SPICES, cardsFor, drawFresh, markSeen, most, nextSeat, recordLine, times, type Card, type Kind, type Tally } from './prompts';
import './truth-or-dare.css';

const SPICE = defineSetting('truth-or-dare:spice', SPICES, DEFAULT_SPICE);
const spiceNote = {
  mild: '',
  spicy: 'Spicy mixes 18+ cards in with the mild ones, about half and half.',
  after: 'After Dark mixes the boldest cards in with Spicy. It’s for groups who know each other well.',
} as const;
const PENALTY = defineSetting('truth-or-dare:penalty', ['2', '3', 'group'] as const, '2');
type Penalty = (typeof PENALTY.values)[number];
const penaltyShort = (p: Penalty) => (p === 'group' ? 'the group picks your punishment' : sips(Number(p)));
const penaltyFor = (p: Penalty, who: string | null) =>
  p === 'group' ? `${who ? `${who}, the` : 'The'} group picks your punishment.` : `${who ? `${who}, take` : 'Take'} ${sips(Number(p))}.`;

type Step = { s: 'setup' } | { s: 'choose' } | { s: 'card'; card: Card; chicken?: boolean };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const [players] = usePlayers();
  const [spice, setSpice] = useSetting(SPICE);
  const [penalty, setPenalty] = useSetting(PENALTY);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [seat, setSeat] = useState(0);
  // Turns taken and cards drawn this session; each one keys its step so the kit's tap guard runs on every change.
  const [turn, setTurn] = useState(0);
  const [draws, setDraws] = useState(0);
  // Records by name and every card shown, kept through a trip back to setup. Restart clears them.
  const [records, setRecords] = useState<Record<string, Tally>>({});
  const [seen] = useState(() => new Set<string>());
  const [last, setLast] = useState<string | undefined>();
  const who = table.length ? table[seat % table.length] : null;

  const start = () => {
    // Back from setup mid-game: whoever was up still goes next, if they're still playing.
    const at = who ? players.indexOf(who) : -1;
    setTable(players);
    setSeat(at >= 0 ? at : 0);
    setStep({ s: 'choose' });
  };
  const deal = (k: Kind) => {
    const cards = cardsFor(k, spice);
    const card = drawFresh(cards, seen, last);
    if (!card) return;
    markSeen(cards, seen, card.text);
    setLast(card.text);
    setDraws((n) => n + 1);
    setStep({ s: 'card', card });
  };
  const choose = (kind: Kind | 'random') => {
    const k: Kind = kind === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : kind;
    if (k === 'truth') sfx.tone({ freq: 660, to: 880, dur: 0.12, type: 'triangle', vol: 0.18 });
    else {
      sfx.tone({ freq: 196, to: 98, dur: 0.16, type: 'sawtooth', vol: 0.16 });
      sfx.noise(0.12, 0.12);
    }
    deal(k);
  };
  /** A card that can't be done here, or that someone said no to: another of the same kind, free. */
  const redraw = () => {
    if (step.s !== 'card' || step.chicken) return;
    sfx.noise(0.05, 0.1);
    deal(step.card.kind);
  };
  const note = (key: keyof Tally) => {
    if (!who) return;
    setRecords((r) => ({ ...r, [who]: { ...(r[who] ?? EMPTY), [key]: (r[who]?.[key] ?? 0) + 1 } }));
  };
  const nextTurn = () => {
    setSeat((s) => nextSeat(s, table.length));
    setTurn((t) => t + 1);
    setStep({ s: 'choose' });
  };
  const done = () => {
    if (step.s !== 'card' || step.chicken) return;
    sfx.play('coin');
    note(step.card.kind);
    nextTurn();
  };
  const chickenOut = () => {
    if (step.s !== 'card' || step.chicken) return;
    sfx.play('lose');
    note('chicken');
    // The buttons that had focus are about to be swapped for Next Player; keep Enter working.
    shell.root.current?.focus({ preventScroll: true });
    setStep({ ...step, chicken: true });
  };

  useKeys((code, e) => {
    if (e?.repeat) return;
    if (step.s === 'choose') {
      if (code === 'KeyT' || code === 'ArrowLeft') choose('truth');
      else if (code === 'KeyD' || code === 'ArrowRight') choose('dare');
      else if (code === 'KeyR') choose('random');
    } else if (step.s === 'card' && !step.chicken) {
      if (code === 'KeyC') chickenOut();
      else if (code === 'KeyN') redraw();
    }
  });

  if (step.s === 'setup') {
    const going = turn > 0 || draws > 0;
    const chicken = most(records, Object.keys(records), 'chicken');
    const daring = most(records, Object.keys(records), 'dare');
    return (
      <Screen
        key="setup"
        center={false}
        className="g-truth-or-dare-setup"
        title="Truth or Dare"
        sub="Go around the circle. Answer the truth, do the dare, or chicken out and drink."
        onEnter={start}
        actions={
          <Big primary onClick={start}>
            {going ? 'Keep Playing' : 'Start'}
          </Big>
        }
      >
        {going && Object.keys(records).length > 0 && (
          <div className="g-truth-or-dare-session" role="status">
            <p>
              <b>Biggest chicken</b>
              <span>{chicken ? `${listNames(chicken.names)}, ${times(chicken.n)}${chicken.names.length > 1 ? ' each' : ''}` : 'Nobody yet'}</span>
            </p>
            {daring && (
              <p>
                <b>Most dares</b>
                <span>
                  {listNames(daring.names)}, {daring.n}
                  {daring.names.length > 1 ? ' each' : ''}
                </span>
              </p>
            )}
          </div>
        )}
        <HowToPlay
          steps={[
            <>Add names to go around the circle in order, or skip them and pass the phone however you like.</>,
            <>On your turn, pick <b>Truth</b> or <b>Dare</b>. Can’t decide? <b>Surprise Me</b>.</>,
            <>Answer honestly or do the dare, then tap <b>Done</b>.</>,
            <>Can’t do it here, or the other person says no? <b>Draw Another</b>. That one’s free.</>,
            <>Just won’t? <b>Chicken Out</b> and take the penalty below. Your record follows you around the circle.</>,
          ]}
        />
        <PlayerList min={0} label="Players" />
        <Option label="Spice" value={spice} options={[['mild', 'Mild'], ['spicy', 'Spicy 18+'], ['after', 'After Dark 18+']]} onChange={setSpice} />
        {spiceNote[spice] && <p className="g-truth-or-dare-note is-field">{spiceNote[spice]}</p>}
        <Option label="Chicken Out Costs" value={penalty} options={[['2', '2 Sips'], ['3', '3 Sips'], ['group', 'Group Picks']]} onChange={setPenalty} />
        <p className="g-truth-or-dare-note">
          Can’t do a card, or someone says no? Draw another, free. Chickening out is for when you just won’t.
        </p>
        <DrinkNote />
      </Screen>
    );
  }

  if (step.s === 'choose') {
    const record = who ? recordLine(records[who] ?? EMPTY) : '';
    return (
      <Screen
        key={`choose-${turn}`}
        className="g-truth-or-dare-choose"
        onEnter={() => choose('random')}
        actions={
          <>
            <Big quiet onClick={() => choose('random')}>
              Surprise Me
            </Big>
            <Big className="g-truth-or-dare-link" onClick={() => setStep({ s: 'setup' })}>
              Change Setup
            </Big>
          </>
        }
      >
        {who && <Avatar name={who} index={seat} size={56} />}
        <h2 className={`arcade-party-title g-truth-or-dare-name ${who && who.length > 9 ? 'is-long' : ''}`}>{who ?? (turn ? 'Next Player' : 'First Player')}</h2>
        <p className="arcade-party-sub">{record ? `So far: ${record}` : 'Truth or dare?'}</p>
        <div className="g-truth-or-dare-picks">
          <button type="button" className="is-truth" onClick={() => choose('truth')} aria-keyshortcuts="T">
            <b>Truth</b>
            <span>Answer honestly</span>
          </button>
          <button type="button" className="is-dare" onClick={() => choose('dare')} aria-keyshortcuts="D">
            <b>Dare</b>
            <span>Do it or drink</span>
          </button>
        </div>
      </Screen>
    );
  }

  const { card, chicken } = step;
  return (
    <Screen
      key={`card-${draws}-${chicken ? 'chicken' : 'play'}`}
      onEnter={chicken ? nextTurn : done}
      actions={
        chicken ? (
          <Big primary onClick={nextTurn}>
            Next Player
          </Big>
        ) : (
          <>
            <Big quiet className="g-truth-or-dare-link" onClick={redraw}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Draw Another
            </Big>
            <Row>
              <Big quiet onClick={chickenOut}>
                Chicken Out
              </Big>
              <Big primary quiet onClick={done}>
                Done
              </Big>
            </Row>
          </>
        )
      }
    >
      <div className={`arcade-party-card g-truth-or-dare-card is-${card.kind} ${card.kind === 'truth' ? 'is-paper' : ''} ${chicken ? 'is-chicken' : ''}`}>
        <span className="g-truth-or-dare-head">
          <b>{card.kind === 'truth' ? 'Truth' : 'Dare'}</b>
          {who && <span>for {who}</span>}
          {card.tier !== 'mild' && <i aria-label="18 plus">18+</i>}
        </span>
        <strong aria-live="polite">{card.text}</strong>
        <span className="g-truth-or-dare-foot">Or chicken out: {penaltyShort(penalty)}</span>
        {chicken && (
          <span className="g-truth-or-dare-stamp" aria-hidden="true">
            Chicken
          </span>
        )}
      </div>
      {chicken && (
        <p className="g-truth-or-dare-verdict" role="status">
          {penaltyFor(penalty, who)}
        </p>
      )}
    </Screen>
  );
}
