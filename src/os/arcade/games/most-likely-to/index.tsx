import { useEffect, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Chips, DrinkNote, HowToPlay, Option, PlayerList, Row, Screen, useCountdown, useDeck, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { DECKS, DECK_IDS, DEFAULT_DECKS, crown, leadLine, parseDecks, promptsFor, standings, type DeckId, type Prompt, type Title } from './prompts';
import './most-likely-to.css';

type Rule = 'most' | 'each';
const RULE = defineSetting('most-likely-to:rule', ['most', 'each'] as const, 'most');
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);
const ruleLine: Record<Rule, string> = {
  most: 'Most fingers drinks. Tied? Everyone tied drinks.',
  each: 'A sip for every finger pointing at you.',
};
/** Seconds of countdown before everyone points. */
const COUNT = 3;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [decks, setDecks] = useStored<DeckId[]>('most-likely-to:decks', DEFAULT_DECKS, parseDecks);
  const [rule, setRule] = useSetting(RULE);
  const [items, setItems] = useState<Prompt[] | null>(null);
  // Titles won this session. They survive a trip back to the decks; Restart clears them.
  const [titles, setTitles] = useState<Title[]>([]);
  const start = () => setItems(promptsFor(decks));

  if (items)
    return (
      <Deal
        items={items}
        rule={rule}
        players={players.length >= 2 ? players : []}
        titles={titles}
        onCrown={(text, name) => setTitles((t) => crown(t, text, name))}
        onSetup={() => setItems(null)}
      />
    );
  return (
    <Screen
      key="setup"
      center={false}
      title="Most Likely To"
      sub="Read the card, count down from three, and everyone points at once. No pointing at yourself."
      onEnter={start}
      actions={
        <Big primary onClick={start}>
          Deal
        </Big>
      }
    >
      <HowToPlay
        steps={[
          <>Read the card out loud: <b>who's most likely to</b> do the thing?</>,
          <>Hit <b>Count Down</b>. On <b>Point</b>, everyone points at someone at the same time. No changing your mind.</>,
          <><b>Most Fingers:</b> the person with the most fingers on them drinks, and ties all drink. <b>A Sip Per Finger:</b> a sip for every finger on you.</>,
          <>Added names? Tap whoever got the most fingers to give them the title. The table keeps score all night.</>,
          <>Space or Enter moves things along. Number keys pick a name.</>,
        ]}
      />
      <PlayerList min={0} label="Players" emptyHint="Optional. Add names and the room hands out titles all night." />
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      <Option label="Who Drinks" value={rule} options={[['most', 'Most Fingers'], ['each', 'A Sip Per Finger']]} onChange={setRule} />
      <DrinkNote />
    </Screen>
  );
}

type Phase = 'read' | 'count' | 'point' | 'board';

function Deal({
  items,
  rule,
  players,
  titles,
  onCrown,
  onSetup,
}: {
  items: Prompt[];
  rule: Rule;
  players: string[];
  titles: Title[];
  onCrown: (text: string, name: string | null) => void;
  onSetup: () => void;
}) {
  const shell = useShell();
  const deck = useDeck(items);
  const { card, next, back } = deck;
  const [phase, setPhase] = useState<Phase>('read');
  const point = () => {
    sfx.noise(0.16, 0.16);
    sfx.tone({ freq: 392, to: 1046, dur: 0.24, type: 'sawtooth', vol: 0.14 });
    try {
      navigator.vibrate?.(70);
    } catch {
      /* no haptics here */
    }
    setPhase('point');
  };
  const count = useCountdown(COUNT, { running: phase === 'count', tick: false, onEnd: point });

  useEffect(() => {
    if (!card) next();
  }, [card, next]);
  // Three short beeps on the way down; the high one is saved for Point.
  useEffect(() => {
    if (phase === 'count' && count.left > 0) sfx.tone({ freq: 523, dur: 0.07, type: 'square', vol: 0.12 });
  }, [phase, count.left]);
  // A phase change can unmount or disable the button that had focus; keep the keys working.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || (active as HTMLButtonElement).disabled) shell.root.current?.focus({ preventScroll: true });
  }, [phase, deck.dealt, shell.root]);

  const table = standings(players, titles);
  const lead = leadLine(table);
  const winner = card ? (titles.find((t) => t.text === card.text)?.name ?? null) : null;

  const countDown = () => {
    count.reset(COUNT);
    setPhase('count');
  };
  const forward = () => {
    sfx.noise(0.05, 0.1);
    setPhase('read');
    next();
  };
  const previous = () => {
    setPhase('read');
    back();
  };
  const pick = (name: string) => {
    if (!card) return;
    const off = winner === name;
    sfx.play(off ? 'blip' : 'coin');
    onCrown(card.text, off ? null : name);
  };
  const primary = () => (phase === 'read' ? countDown() : phase === 'count' ? point() : phase === 'point' ? forward() : setPhase('read'));

  useKeys((code, e) => {
    if (e?.repeat) return;
    if (phase === 'board') return;
    if (code === 'ArrowRight') forward();
    else if (code === 'ArrowLeft') previous();
    else if (phase === 'point' && /^Digit[1-9]$/.test(code)) {
      const name = players[Number(code.slice(5)) - 1];
      if (name) pick(name);
    }
  });
  if (!card) return null;

  if (phase === 'board')
    return (
      <Screen
        key="board"
        center={false}
        title="Titles So Far"
        sub={lead ? `${lead}.` : 'Nobody has a title yet.'}
        onEnter={primary}
        actions={
          <Big primary onClick={primary}>
            Back to the Cards
          </Big>
        }
      >
        <ol className="arcade-party-scores g-most-likely-to-board">
          {table.map((s) => (
            <li key={s.name} className={s.count && s.count === table[0].count ? 'is-hi' : s.count ? '' : 'is-none'}>
              <Avatar name={s.name} index={s.seat} size={30} />
              <span>
                <span className="g-most-likely-to-board-name">{s.name}</span>
                {s.latest && <small>Most likely to {s.latest}</small>}
              </span>
              <b aria-label={`${s.count} ${s.count === 1 ? 'title' : 'titles'}`}>{s.count}</b>
            </li>
          ))}
        </ol>
      </Screen>
    );

  const label = phase === 'read' ? 'Count Down' : phase === 'count' ? 'Point Now' : 'Next Card';
  return (
    <Screen
      key="deal"
      className={`is-${phase}`}
      onEnter={primary}
      actions={
        <>
          <Big primary quiet onClick={primary}>
            {label}
          </Big>
          <Row>
            <Big onClick={previous} disabled={!deck.canBack}>
              Back
            </Big>
            <Big onClick={onSetup}>Change Decks</Big>
          </Row>
        </>
      }
    >
      {phase === 'read' && (
        <>
          <div key={deck.dealt} className="arcade-party-card g-most-likely-to-card" aria-live="polite">
            <span className="g-most-likely-to-lead">Who's most likely to</span>
            <strong>{card.text}?</strong>
            <span className="g-most-likely-to-deck">{DECKS[card.deck].label}</span>
          </div>
          {lead && (
            <button type="button" className="g-most-likely-to-lead-btn" onClick={() => setPhase('board')}>
              <span>Titles</span>
              <b>{lead}</b>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </>
      )}

      {phase === 'count' && (
        <>
          <p className="g-most-likely-to-mini">Who's most likely to {card.text}?</p>
          <div key={count.left} className="g-most-likely-to-num" aria-live="assertive">
            {count.left}
          </div>
        </>
      )}

      {phase === 'point' && (
        <>
          <p className="g-most-likely-to-mini">Who's most likely to {card.text}?</p>
          <div className={`g-most-likely-to-shout ${players.length ? 'has-picks' : ''}`} role="status">
            Point
          </div>
          <p className="g-most-likely-to-rule">{ruleLine[rule]}</p>
          {players.length > 0 && (
            <div className="g-most-likely-to-room">
              <p className="g-most-likely-to-ask" aria-live="polite">
                {winner ? (
                  <>
                    <b>{winner}</b> takes the title
                  </>
                ) : (
                  'Who got the most fingers?'
                )}
              </p>
              <div className="arcade-party-picks">
                {players.map((p, i) => (
                  <button key={p} type="button" aria-pressed={winner === p} onClick={() => pick(p)}>
                    <Avatar name={p} index={i} size={30} />
                    <span>{p}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
