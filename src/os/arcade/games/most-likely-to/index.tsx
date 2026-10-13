import { useEffect, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting } from '../../kit';
import { Big, Chips, DrinkNote, Option, Row, Screen, useCountdown, useDeck, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DECKS, DECK_IDS, DEFAULT_DECKS, parseDecks, promptsFor, type DeckId, type Prompt } from './prompts';
import './most-likely-to.css';

type Rule = 'most' | 'each';
const RULE = defineSetting('most-likely-to:rule', ['most', 'each'] as const, 'most');
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);
const verdict: Record<Rule, string> = {
  most: 'Most fingers drinks. Tied? Everyone tied drinks.',
  each: 'Take a sip for every finger pointing at you.',
};

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [decks, setDecks] = useStored<DeckId[]>('most-likely-to:decks', DEFAULT_DECKS, parseDecks);
  const [rule, setRule] = useSetting(RULE);
  const [items, setItems] = useState<Prompt[] | null>(null);
  const start = () => setItems(promptsFor(decks));

  if (items) return <Deal items={items} rule={rule} onSetup={() => setItems(null)} />;
  return (
    <Screen
      key="setup"
      center={false}
      title="Most Likely To"
      sub="Read the card, count down from three, and everyone points at who fits it best. No pointing at yourself."
      onEnter={start}
      actions={
        <Big primary onClick={start}>
          Start
        </Big>
      }
    >
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      <Option label="Who Drinks" value={rule} options={[['most', 'Most Fingers'], ['each', 'A Sip Per Finger']]} onChange={setRule} />
      <DrinkNote />
    </Screen>
  );
}

type Phase = 'read' | 'count' | 'point';

function Deal({ items, rule, onSetup }: { items: Prompt[]; rule: Rule; onSetup: () => void }) {
  const deck = useDeck(items);
  const { card, next, back } = deck;
  const [phase, setPhase] = useState<Phase>('read');
  const count = useCountdown(3, {
    running: phase === 'count',
    onEnd: () => {
      sfx.play('win');
      setPhase('point');
    },
  });
  useEffect(() => {
    if (!card) next();
  }, [card, next]);

  const countDown = () => {
    count.reset(3);
    sfx.play('tick');
    setPhase('count');
  };
  const forward = () => {
    setPhase('read');
    next();
  };
  const primary = () => (phase === 'read' ? countDown() : phase === 'point' ? forward() : undefined);
  useKeys((code, e) => {
    if (e?.repeat) return;
    if (code === 'ArrowRight') forward();
    else if (code === 'ArrowLeft') {
      setPhase('read');
      back();
    }
  });
  if (!card) return null;
  return (
    <Screen
      key="deal"
      onEnter={primary}
      actions={
        <>
          <Big primary disabled={phase === 'count'} onClick={primary}>
            {phase === 'read' ? 'Count Down' : phase === 'count' ? 'Get Ready' : 'Next Card'}
          </Big>
          <Row>
            <Big
              onClick={() => {
                setPhase('read');
                back();
              }}
              disabled={!deck.canBack}
            >
              Back
            </Big>
            <Big onClick={onSetup}>Decks</Big>
          </Row>
        </>
      }
    >
      <div key={deck.dealt} className={`arcade-party-card g-most-likely-to-card is-${phase}`}>
        <small>{DECKS[card.deck].label}</small>
        <span className="g-most-likely-to-lead">Who's most likely to</span>
        <strong>{card.text}?</strong>
        {phase === 'read' && <p>Read it out loud, then count down.</p>}
        {phase === 'count' && (
          <span key={count.left} className="g-most-likely-to-count" aria-live="assertive">
            {count.left}
          </span>
        )}
        {phase === 'point' && (
          <div className="g-most-likely-to-point" aria-live="assertive">
            <b>Point!</b>
            <p>{verdict[rule]}</p>
          </div>
        )}
      </div>
      <p className="g-most-likely-to-count-note">
        {((deck.dealt - 1) % deck.total) + 1} of {deck.total}
      </p>
    </Screen>
  );
}
