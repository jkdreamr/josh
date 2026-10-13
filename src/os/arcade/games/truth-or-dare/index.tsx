import { useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting } from '../../kit';
import { Avatar, Big, DrinkNote, Option, Pile, PlayerList, Screen, sips, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { cardsFor, nextSeat, type Card, type Kind, type Spice } from './prompts';
import './truth-or-dare.css';

const SPICE = defineSetting('truth-or-dare:spice', ['mild', 'spicy'] as const, 'mild');
const PENALTY = defineSetting('truth-or-dare:penalty', ['2', '4', 'finish'] as const, '2');
type Penalty = (typeof PENALTY.values)[number];
const penaltyText = (p: Penalty) => (p === 'finish' ? 'finish your drink' : `drink ${sips(Number(p))}`);

type Step = { s: 'setup' } | { s: 'choose' } | { s: 'card'; card: Card } | { s: 'chicken' };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [spice, setSpice] = useSetting(SPICE);
  const [penalty, setPenalty] = useSetting(PENALTY);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [seat, setSeat] = useState(0);
  const [turn, setTurn] = useState(0);
  const piles = useRef<{ spice: Spice; truth: Pile<Card>; dare: Pile<Card>; last?: Card } | null>(null);

  const start = () => {
    setTable(players);
    setSeat(0);
    setTurn(0);
    piles.current = { spice, truth: new Pile(cardsFor('truth', spice)), dare: new Pile(cardsFor('dare', spice)) };
    setStep({ s: 'choose' });
  };
  const choose = (kind: Kind | 'random') => {
    const p = piles.current;
    if (!p) return;
    const k: Kind = kind === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : kind;
    const card = p[k].draw(p.last);
    if (!card) return;
    p.last = card;
    sfx.play(k === 'truth' ? 'select' : 'jump');
    setStep({ s: 'card', card });
  };
  const nextTurn = () => {
    setSeat((s) => nextSeat(s, table.length));
    setTurn((t) => t + 1);
    setStep({ s: 'choose' });
  };
  const who = table.length ? table[seat % table.length] : null;

  useKeys((code, e) => {
    if (e?.repeat || step.s !== 'choose') return;
    if (code === 'KeyT' || code === 'ArrowLeft') choose('truth');
    else if (code === 'KeyD' || code === 'ArrowRight') choose('dare');
    else if (code === 'KeyR') choose('random');
  });

  if (step.s === 'setup')
    return (
      <Screen
        key="setup"
        center={false}
        title="Truth or Dare"
        sub="Turns go around the circle. Answer the truth, do the dare, or chicken out and drink."
        onEnter={start}
        actions={
          <Big primary onClick={start}>
            Start
          </Big>
        }
      >
        <PlayerList min={0} label="Players (optional)" />
        <Option label="Spice" value={spice} options={[['mild', 'Mild'], ['spicy', 'Spicy 18+']]} onChange={setSpice} />
        <Option label="Chicken Out" value={penalty} options={[['2', '2 Sips'], ['4', '4 Sips'], ['finish', 'Finish It']]} onChange={setPenalty} />
        <p className="g-truth-or-dare-note">Anyone can pass on anything. Dares that involve someone else need their yes.</p>
        <DrinkNote />
      </Screen>
    );

  if (step.s === 'choose')
    return (
      <Screen key={`choose-${turn}`} onEnter={() => choose('random')} actions={<Big onClick={() => choose('random')}>Surprise Me</Big>}>
        {who && <Avatar name={who} index={seat} size={64} />}
        <h2 className="arcade-party-title">{who ? `${who}'s Turn` : turn ? 'Next Player' : 'First Player'}</h2>
        <p className="arcade-party-sub">Truth or dare?</p>
        <div className="g-truth-or-dare-picks">
          <button type="button" className="is-truth" onClick={() => choose('truth')}>
            <b>Truth</b>
            <span>Answer honestly</span>
          </button>
          <button type="button" className="is-dare" onClick={() => choose('dare')}>
            <b>Dare</b>
            <span>Do the thing</span>
          </button>
        </div>
      </Screen>
    );

  if (step.s === 'card') {
    const { card } = step;
    return (
      <Screen
        key={`card-${turn}`}
        onEnter={nextTurn}
        actions={
          <>
            <Big primary onClick={nextTurn}>
              Done, Next Player
            </Big>
            <Big
              onClick={() => {
                sfx.play('lose');
                setStep({ s: 'chicken' });
              }}
            >
              Chicken Out
            </Big>
          </>
        }
      >
        {who && <p className="arcade-party-kicker">{who}</p>}
        <div className={`arcade-party-card g-truth-or-dare-card is-${card.kind}`}>
          <small>{card.spicy ? `Spicy ${card.kind}` : card.kind}</small>
          <strong>{card.text}</strong>
          <p>Or chicken out and {penaltyText(penalty)}.</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen key={`chicken-${turn}`} title="Chicken!" sub={`${who ?? 'You'}, ${penaltyText(penalty)}.`} onEnter={nextTurn} actions={<Big primary onClick={nextTurn}>Next Player</Big>}>
      <svg className="g-truth-or-dare-chicken" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6.5a3 3 0 0 1 6 0v3.5c2.5.5 4.5 2.5 4.5 5.5a5.5 5.5 0 0 1-11 0V12M9 6.5L7 8l2 1M12.5 5.5v.01M10.5 3.5c.5-1 1.5-1.5 2.5-1M11 21v1.5M15 21v1.5" />
      </svg>
    </Screen>
  );
}
