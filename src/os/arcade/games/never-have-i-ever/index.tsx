import { useEffect, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting } from '../../kit';
import { Big, Chips, DrinkNote, Option, Row, Screen, useDeck, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DECKS, DECK_IDS, DEFAULT_DECKS, parseDecks, promptsFor, type DeckId, type Prompt } from './prompts';
import './never-have-i-ever.css';

type Mode = 'sips' | 'fingers';
const MODE = defineSetting('never-have-i-ever:mode', ['sips', 'fingers'] as const, 'sips');
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);
const rule: Record<Mode, string> = {
  sips: 'If you have, take a sip.',
  fingers: 'If you have, put a finger down. Out of fingers? Finish your drink.',
};

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [decks, setDecks] = useStored<DeckId[]>('never-have-i-ever:decks', DEFAULT_DECKS, parseDecks);
  const [mode, setMode] = useSetting(MODE);
  const [items, setItems] = useState<Prompt[] | null>(null);
  const start = () => setItems(promptsFor(decks));

  if (items) return <Deal items={items} mode={mode} onSetup={() => setItems(null)} />;
  return (
    <Screen
      key="setup"
      center={false}
      title="Never Have I Ever"
      sub="Read each card out loud. Anyone who has done it drinks. Bonus points for the story."
      onEnter={start}
      actions={
        <Big primary onClick={start}>
          Start
        </Big>
      }
    >
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      <Option label="Play With" value={mode} options={[['sips', 'Sips'], ['fingers', 'Five Fingers']]} onChange={setMode} />
      <p className="g-never-have-i-ever-how">
        {mode === 'sips' ? 'Everyone who has done it takes a sip.' : 'Everyone holds up five fingers. Done it? Put one down. Last one with fingers up wins.'}
      </p>
      <DrinkNote />
    </Screen>
  );
}

function Deal({ items, mode, onSetup }: { items: Prompt[]; mode: Mode; onSetup: () => void }) {
  const deck = useDeck(items);
  const { card, next, back } = deck;
  useEffect(() => {
    if (!card) next();
  }, [card, next]);
  const forward = () => {
    sfx.play('blip', 1.2);
    next();
  };
  useKeys((code, e) => {
    if (e?.repeat) return;
    if (code === 'ArrowRight') forward();
    else if (code === 'ArrowLeft') back();
  });
  if (!card) return null;
  return (
    <Screen
      key="deal"
      onEnter={forward}
      actions={
        <>
          <Big primary onClick={next}>
            Next Card
          </Big>
          <Row>
            <Big onClick={back} disabled={!deck.canBack}>
              Back
            </Big>
            <Big onClick={onSetup}>Decks</Big>
          </Row>
        </>
      }
    >
      <div key={deck.dealt} className="arcade-party-card g-never-have-i-ever-card" role="button" aria-label="Next card" onClick={forward}>
        <small>{DECKS[card.deck].label}</small>
        <span className="g-never-have-i-ever-lead">Never have I ever</span>
        <strong>{card.text}.</strong>
        <p>{rule[mode]}</p>
      </div>
      <p className="g-never-have-i-ever-count">
        {((deck.dealt - 1) % deck.total) + 1} of {deck.total}
      </p>
    </Screen>
  );
}
