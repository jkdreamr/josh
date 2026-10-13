import { useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, Option, Pile, PlayerList, Row, Screen, sips, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { EMPTY, cardsFor, nextSeat, recordLine, type Card, type Kind, type Tally } from './prompts';
import './truth-or-dare.css';

const SPICE = defineSetting('truth-or-dare:spice', ['mild', 'spicy'] as const, 'mild');
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
  const [turn, setTurn] = useState(0);
  const [tally, setTally] = useState<Tally[]>([]);
  const piles = useRef<{ truth: Pile<Card>; dare: Pile<Card>; last?: Card } | null>(null);

  const start = () => {
    setTable(players);
    setSeat(0);
    setTurn(0);
    setTally(players.map(() => EMPTY));
    piles.current = { truth: new Pile(cardsFor('truth', spice)), dare: new Pile(cardsFor('dare', spice)) };
    setStep({ s: 'choose' });
  };
  const choose = (kind: Kind | 'random') => {
    const p = piles.current;
    if (!p) return;
    const k: Kind = kind === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : kind;
    const card = p[k].draw(p.last);
    if (!card) return;
    p.last = card;
    if (k === 'truth') sfx.tone({ freq: 660, to: 880, dur: 0.12, type: 'triangle', vol: 0.18 });
    else {
      sfx.tone({ freq: 196, to: 98, dur: 0.16, type: 'sawtooth', vol: 0.16 });
      sfx.noise(0.12, 0.12);
    }
    setStep({ s: 'card', card });
  };
  const note = (key: keyof Tally) => setTally((t) => t.map((r, i) => (i === seat ? { ...r, [key]: r[key] + 1 } : r)));
  const nextTurn = () => {
    setSeat((s) => nextSeat(s, table.length));
    setTurn((t) => t + 1);
    setStep({ s: 'choose' });
  };
  const done = () => {
    if (step.s !== 'card') return;
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
  const who = table.length ? table[seat % table.length] : null;

  useKeys((code, e) => {
    if (e?.repeat) return;
    if (step.s === 'choose') {
      if (code === 'KeyT' || code === 'ArrowLeft') choose('truth');
      else if (code === 'KeyD' || code === 'ArrowRight') choose('dare');
      else if (code === 'KeyR') choose('random');
    } else if (step.s === 'card' && code === 'KeyC') chickenOut();
  });

  if (step.s === 'setup')
    return (
      <Screen
        key="setup"
        center={false}
        title="Truth or Dare"
        sub="Go around the circle. Answer the truth, do the dare, or chicken out and drink."
        onEnter={start}
        actions={
          <Big primary onClick={start}>
            Start
          </Big>
        }
      >
        <HowToPlay
          steps={[
            <>Add names to go around the circle in order, or skip them and pass the phone however you like.</>,
            <>On your turn, pick <b>Truth</b> or <b>Dare</b>. Can't decide? <b>Surprise Me</b>.</>,
            <>Answer honestly or do the dare, then tap <b>Done</b>.</>,
            <>Won't do it? <b>Chicken Out</b> and take the penalty below. Your record shows up on your next turn.</>,
            <>Keys: T or D to pick, Enter for Done, C to chicken out.</>,
          ]}
        />
        <PlayerList min={0} label="Players" />
        <Option label="Spice" value={spice} options={[['mild', 'Mild'], ['spicy', 'Spicy 18+']]} onChange={setSpice} />
        <Option label="Chicken Out Costs" value={penalty} options={[['2', '2 Sips'], ['3', '3 Sips'], ['group', 'Group Picks']]} onChange={setPenalty} />
        <p className="g-truth-or-dare-note">Anyone can pass on anything. A dare that involves someone else needs their yes.</p>
        <DrinkNote />
      </Screen>
    );

  if (step.s === 'choose') {
    const record = who ? recordLine(tally[seat % table.length] ?? EMPTY) : '';
    return (
      <Screen key={`choose-${turn}`} onEnter={() => choose('random')} actions={<Big quiet onClick={() => choose('random')}>Surprise Me</Big>}>
        {who && <Avatar name={who} index={seat} size={56} />}
        <h2 className={`arcade-party-title g-truth-or-dare-name ${who && who.length > 9 ? 'is-long' : ''}`}>{who ?? (turn ? 'Next Player' : 'First Player')}</h2>
        <p className="arcade-party-sub">{record || 'Truth or dare?'}</p>
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
      key={`card-${turn}`}
      onEnter={chicken ? nextTurn : done}
      actions={
        chicken ? (
          <Big primary onClick={nextTurn}>
            Next Player
          </Big>
        ) : (
          <Row>
            <Big quiet onClick={chickenOut}>
              Chicken Out
            </Big>
            <Big primary quiet onClick={done}>
              Done
            </Big>
          </Row>
        )
      }
    >
      <div className={`arcade-party-card g-truth-or-dare-card is-${card.kind} ${card.kind === 'truth' ? 'is-paper' : ''} ${chicken ? 'is-chicken' : ''}`}>
        <span className="g-truth-or-dare-head">
          <b>{card.kind === 'truth' ? 'Truth' : 'Dare'}</b>
          {who && <span>for {who}</span>}
          {card.spicy && <i aria-label="18 plus">18+</i>}
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
