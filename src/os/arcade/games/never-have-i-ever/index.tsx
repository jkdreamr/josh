import { useCallback, useEffect, useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Big, Chips, DrinkNote, HowToPlay, Option, Row, Screen, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DECKS, DECK_IDS, DEFAULT_DECKS, asSentence, drawFresh, markSeen, parseDecks, promptsFor, storyRoll, type DeckId, type Prompt } from './prompts';
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
/** Two advances closer than this are one double tap, not two cards read. */
const DOUBLE_TAP = 350;

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
  // Every card read out this session, so a trip back to setup never deals them again until the decks run dry.
  const [seen] = useState(() => new Set<string>());
  const start = () => setItems(promptsFor(decks));

  if (items) return <Deal items={items} seen={seen} mode={mode} onSetup={() => setItems(null)} />;
  return (
    <Screen
      key="setup"
      center={false}
      className="g-never-have-i-ever-setup"
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
          <>Whoever holds the phone reads the card out loud, starting with <b>never have I ever</b>, then taps for the next one and passes the phone on.</>,
          <><b>Sips:</b> if you’ve done it, take a sip. No lying, the room will know.</>,
          <><b>Five Fingers:</b> everyone holds up five. Fold one for every card you’ve done. Last hand still up wins.</>,
          <>A card stamped <b>Story Time</b> means anyone who drinks or folds owes the room the story.</>,
        ]}
      />
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      {decks.includes('after') && <p className="g-never-have-i-ever-note">After Dark is the boldest deck. It’s for groups who know each other well.</p>}
      <Option label="Play With" value={mode} options={[['sips', 'Sips'], ['fingers', 'Five Fingers']]} onChange={setMode} />
      <p className="g-never-have-i-ever-note">{modeNote[mode]}</p>
      <DrinkNote />
    </Screen>
  );
}

/** Deals cards this session hasn't seen yet, with Back through the ones already dealt. */
function useFreshDeck(items: readonly Prompt[], seen: Set<string>) {
  const deck = useRef<{ dealt: Prompt[]; pos: number } | null>(null);
  if (!deck.current) {
    const first = drawFresh(items, seen);
    deck.current = { dealt: first ? [first] : [], pos: first ? 0 : -1 };
  }
  const [, redraw] = useState(0);
  const { dealt, pos } = deck.current;
  const card = pos >= 0 ? dealt[pos] : undefined;
  useEffect(() => {
    if (card) markSeen(items, seen, card.text);
  }, [card, items, seen]);
  const next = useCallback(() => {
    const d = deck.current;
    if (!d) return;
    if (d.pos + 1 < d.dealt.length) d.pos++;
    else {
      const c = drawFresh(items, seen, d.dealt[d.pos]?.text);
      if (!c) return;
      d.dealt.push(c);
      d.pos = d.dealt.length - 1;
    }
    redraw((n) => n + 1);
  }, [items, seen]);
  const back = useCallback(() => {
    const d = deck.current;
    if (!d || d.pos <= 0) return;
    d.pos--;
    redraw((n) => n + 1);
  }, []);
  return { card, next, back, canBack: pos > 0, dealt: pos + 1 };
}

function Deal({ items, seen, mode, onSetup }: { items: Prompt[]; seen: Set<string>; mode: Mode; onSetup: () => void }) {
  const shell = useShell();
  const deck = useFreshDeck(items, seen);
  const { card, next, back, dealt } = deck;
  // Which dealt cards are story cards, so going back shows the same card the same way.
  const stories = useRef(new Map<number, boolean>());
  if (card && !stories.current.has(dealt)) stories.current.set(dealt, storyRoll(!!stories.current.get(dealt - 1), Math.random()));
  const story = !!stories.current.get(dealt);
  // The card, the button and the keys all advance; a double tap on any of them only moves one card.
  const lastMove = useRef(-Infinity);

  useEffect(() => {
    if (story) sfx.tone({ freq: 140, to: 70, dur: 0.09, type: 'triangle', vol: 0.22, delay: 0.2 });
    // Back can disable the focused button; keep keys working by handing focus back to the game.
    const active = document.activeElement;
    if (!active || active === document.body || (active as HTMLButtonElement).disabled) shell.root.current?.focus({ preventScroll: true });
  }, [dealt, story, shell.root]);

  const forward = () => {
    const now = performance.now();
    if (now - lastMove.current < DOUBLE_TAP) return;
    lastMove.current = now;
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
            <Big onClick={onSetup}>Change Setup</Big>
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
