import { useEffect, useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Big, Chips, DrinkNote, HowToPlay, Option, Row, Screen, useDeck, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DECKS, DECK_IDS, DEFAULT_DECKS, asSentence, parseDecks, promptsFor, storyRoll, type DeckId, type Prompt } from './prompts';
import './never-have-i-ever.css';

type Mode = 'sips' | 'fingers';
const MODE = defineSetting('never-have-i-ever:mode', ['sips', 'fingers'] as const, 'sips');
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);
const modeNote: Record<Mode, string> = {
  sips: 'Done it? Take a sip.',
  fingers: 'Everyone starts with five fingers up. Done it? Fold one.',
};
const cardRule = (mode: Mode, story: boolean) =>
  mode === 'sips' ? (story ? 'Drink, then tell it' : 'Done it? Drink') : story ? 'Fold one, then tell it' : 'Done it? Fold a finger';

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
      title={
        <>
          <em>Never</em> Have I Ever
        </>
      }
      sub="Read a card out loud. Anyone who has done it drinks, and the room gets to ask questions."
      onEnter={start}
      actions={
        <Big primary onClick={start}>
          Deal
        </Big>
      }
    >
      <HowToPlay
        steps={[
          <>Whoever holds the phone reads the card out loud, starting with <b>never have I ever</b>, then passes it on.</>,
          <><b>Sips:</b> if you've done it, take a sip. No lying, the room will know.</>,
          <><b>Five Fingers:</b> everyone holds up five. Fold one for every card you've done. Last hand still up wins.</>,
          <>A card stamped <b>Story Time</b> means anyone who drinks has to tell the story.</>,
          <>Tap the card or press Space for the next one. Left arrow goes back.</>,
        ]}
      />
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      <Option label="Play With" value={mode} options={[['sips', 'Sips'], ['fingers', 'Five Fingers']]} onChange={setMode} />
      <p className="g-never-have-i-ever-note">{modeNote[mode]}</p>
      <DrinkNote />
    </Screen>
  );
}

function Deal({ items, mode, onSetup }: { items: Prompt[]; mode: Mode; onSetup: () => void }) {
  const shell = useShell();
  const deck = useDeck(items);
  const { card, next, back, dealt } = deck;
  // Which dealt cards are story cards, so going back shows the same card the same way.
  const stories = useRef(new Map<number, boolean>());
  if (card && !stories.current.has(dealt)) stories.current.set(dealt, storyRoll(!!stories.current.get(dealt - 1), Math.random()));
  const story = !!stories.current.get(dealt);

  useEffect(() => {
    if (!card) next();
  }, [card, next]);
  useEffect(() => {
    if (story) sfx.tone({ freq: 140, to: 70, dur: 0.09, type: 'triangle', vol: 0.22, delay: 0.2 });
    // Back can disable the focused button; keep keys working by handing focus back to the game.
    const active = document.activeElement;
    if (!active || active === document.body || (active as HTMLButtonElement).disabled) shell.root.current?.focus({ preventScroll: true });
  }, [dealt, story, shell.root]);

  const forward = () => {
    sfx.noise(0.05, 0.1);
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
          <Big primary quiet onClick={forward}>
            Next Card
          </Big>
          <Row>
            <Big onClick={back} disabled={!deck.canBack}>
              Back
            </Big>
            <Big onClick={onSetup}>Change Decks</Big>
          </Row>
        </>
      }
    >
      <div
        key={dealt}
        className={`arcade-party-card is-paper g-never-have-i-ever-card ${dealt % 2 ? 'is-left' : 'is-right'}`}
        onClick={forward}
        aria-live="polite"
      >
        <span className="g-never-have-i-ever-lead">Never have I ever</span>
        <strong>{asSentence(card.text)}</strong>
        {story && <span className="g-never-have-i-ever-stamp">Story Time</span>}
        <span className="g-never-have-i-ever-foot">
          <span>{DECKS[card.deck].label}</span>
          <span>{cardRule(mode, story)}</span>
        </span>
      </div>
    </Screen>
  );
}
