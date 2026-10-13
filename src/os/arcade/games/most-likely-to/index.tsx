import { useCallback, useEffect, useRef, useState } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, Chips, DrinkNote, HowToPlay, Option, PlayerList, Row, Screen, listNames, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import { meta } from './meta';
import {
  DECKS,
  DECK_IDS,
  DEFAULT_DECKS,
  SIP_CAP,
  crown,
  drawFresh,
  leaders,
  leadLine,
  markSeen,
  parseDecks,
  promptsFor,
  standings,
  titleLine,
  togglePick,
  type DeckId,
  type Prompt,
  type Title,
} from './prompts';
import './most-likely-to.css';

type Rule = 'most' | 'each';
const RULE = defineSetting('most-likely-to:rule', ['most', 'each'] as const, 'most');
const deckOptions = DECK_IDS.map((id) => [id, DECKS[id].label] as const);
const ruleLine: Record<Rule, string> = {
  most: 'Most fingers drinks. Tied? Everyone tied drinks.',
  each: `A sip for every finger on you, up to ${SIP_CAP}.`,
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
  // Titles won and cards read this session. Both survive a trip back to setup; Restart clears them.
  const [titles, setTitles] = useState<Title[]>([]);
  const [seen] = useState(() => new Set<string>());
  const start = () => setItems(promptsFor(decks));

  if (items)
    return (
      <Deal
        items={items}
        seen={seen}
        rule={rule}
        players={players.length >= 2 ? players : []}
        titles={titles}
        onCrown={(text, names) => setTitles((t) => crown(t, text, names))}
        onSetup={() => setItems(null)}
      />
    );
  return (
    <Screen
      key="setup"
      center={false}
      className="g-most-likely-to-setup"
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
          <>Read the card out loud: <b>who’s most likely to</b> do the thing?</>,
          <>Hit <b>Count Down</b>. On <b>Point</b>, everyone points at someone at the same time. No changing your mind.</>,
          <><b>Most Fingers:</b> the person with the most fingers on them drinks, and ties all drink. <b>A Sip Per Finger:</b> a sip for every finger on you, up to {SIP_CAP}.</>,
          <>Added names? Tap whoever got the most fingers to give them the title, or tap everyone tied. The table keeps score all night.</>,
        ]}
      />
      {/* One name can't hand out titles, so ask for a second instead of quietly ignoring it. */}
      <PlayerList min={players.length === 1 ? 2 : 0} label="Players" emptyHint="Optional. Add names and the room hands out titles all night." />
      <Chips label="Decks" value={decks} options={deckOptions} onChange={setDecks} />
      {decks.includes('after') && <p className="g-most-likely-to-note">After Dark is the boldest deck. It’s for groups who know each other well.</p>}
      <Option label="Who Drinks" value={rule} options={[['most', 'Most Fingers'], ['each', 'A Sip Per Finger']]} onChange={setRule} />
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

type Phase = 'read' | 'count' | 'point' | 'board';

function Deal({
  items,
  seen,
  rule,
  players,
  titles,
  onCrown,
  onSetup,
}: {
  items: Prompt[];
  seen: Set<string>;
  rule: Rule;
  players: string[];
  titles: Title[];
  onCrown: (text: string, names: string[]) => void;
  onSetup: () => void;
}) {
  const shell = useShell();
  const deck = useFreshDeck(items, seen);
  const { card, next, back } = deck;
  const [phase, setPhase] = useState<Phase>('read');
  const point = () => {
    if (phase !== 'count') return;
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
  const lead = leaders(table);
  const winners = card ? (titles.find((t) => t.text === card.text)?.names ?? []) : [];

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
    const names = togglePick(players, winners, name);
    sfx.play(names.includes(name) ? 'coin' : 'blip');
    onCrown(card.text, names);
  };

  useKeys((code, e) => {
    // The count is the moment: keys can't cut it short or skip past it.
    if (e?.repeat || phase === 'board' || phase === 'count') return;
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
        sub={lead ? `${leadLine(table)}.` : 'Nobody has a title yet.'}
        onEnter={() => setPhase('read')}
        actions={
          <Big primary onClick={() => setPhase('read')}>
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

  // Each phase is its own keyed step, so the kit's tap guard runs every time the buttons change meaning.
  if (phase === 'count')
    return (
      <Screen
        key="count"
        className="is-count"
        actions={
          <Big quiet className="g-most-likely-to-skip" onClick={point}>
            Skip the Count
          </Big>
        }
      >
        <p className="g-most-likely-to-mini">Who’s most likely to {card.text}?</p>
        <div key={count.left} className="g-most-likely-to-num" aria-live="assertive">
          {count.left}
        </div>
      </Screen>
    );

  const nav = (
    <Row>
      <Big onClick={previous} disabled={!deck.canBack}>
        Back
      </Big>
      <Big onClick={onSetup}>Change Setup</Big>
    </Row>
  );

  if (phase === 'point')
    return (
      <Screen
        key="point"
        className="is-point"
        onEnter={forward}
        actions={
          <>
            <Big primary quiet onClick={forward}>
              Next Card
            </Big>
            {nav}
          </>
        }
      >
        <p className="g-most-likely-to-mini">Who’s most likely to {card.text}?</p>
        <div className={`g-most-likely-to-shout ${players.length ? 'has-picks' : ''}`} role="status">
          Point
        </div>
        <p className="g-most-likely-to-rule">{ruleLine[rule]}</p>
        {players.length > 0 && (
          <div className={`g-most-likely-to-room ${players.length > 8 ? 'is-crowd' : ''}`}>
            <p className="g-most-likely-to-ask" aria-live="polite">
              {winners.length ? <b>{titleLine(winners)}</b> : 'Who got the most fingers?'}
              {!winners.length && <small>Tied? Tap everyone tied.</small>}
            </p>
            <div className="arcade-party-picks">
              {players.map((p, i) => (
                <button key={p} type="button" aria-pressed={winners.includes(p)} onClick={() => pick(p)}>
                  <Avatar name={p} index={i} size={players.length > 8 ? 26 : 30} />
                  <span>{p}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Screen>
    );

  return (
    <Screen
      key="read"
      className="is-read"
      onEnter={countDown}
      actions={
        <>
          <Big primary quiet onClick={countDown}>
            Count Down
          </Big>
          {nav}
        </>
      }
    >
      <div key={deck.dealt} className="arcade-party-card g-most-likely-to-card" aria-live="polite">
        <span className="g-most-likely-to-lead">Who’s most likely to</span>
        <strong>{card.text}?</strong>
        <span className="g-most-likely-to-deck">{DECKS[card.deck].label}</span>
      </div>
      {lead && (
        <button type="button" className="g-most-likely-to-lead-btn" onClick={() => setPhase('board')} aria-label={`Titles: ${leadLine(table)}`}>
          <span>Titles</span>
          {lead.names.length === 1 ? (
            <b>
              <span className="g-most-likely-to-who">{lead.names[0]}</span>
              <span className="g-most-likely-to-n">leads with {lead.count}</span>
            </b>
          ) : lead.names.length > 3 ? (
            <b>
              <span className="g-most-likely-to-n">
                {lead.names.length} people tied on {lead.count}
              </span>
            </b>
          ) : (
            <b>
              <span className="g-most-likely-to-n">Tied on {lead.count}:</span>
              <span className="g-most-likely-to-who">{listNames(lead.names)}</span>
            </b>
          )}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </Screen>
  );
}
