import { Fragment, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { GameShell, defineSetting, sfx, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, Option, PlayerList, Screen, listNames, playerColor, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import { ADULT, DEFAULT_INTENSITY, LENGTHS, activeRules, buildDeck, plain, stats, step, type Card, type Kind, type Part } from './logic';
import { meta } from './meta';
import './party-mix.css';

const INTENSITY = defineSetting('party-mix:intensity', ['chill', 'party', 'wild', 'dark'] as const, DEFAULT_INTENSITY);
const LENGTH = defineSetting('party-mix:length', ['short', 'normal', 'long'] as const, 'normal');
const MIN = 2;
/** Two taps closer than this are one double tap: the second one doesn't skip a card. */
const DOUBLE_TAP = 400;
const RULE_MAX = 80;

const INTENSITY_NOTE = {
  chill: 'Easy cards, nothing personal. Good for a slow start.',
  party: 'The full mix, with a few cards that get personal.',
  wild: '18+. Hookups, exes and dares that need a yes.',
  dark: '18+ and frank about sex. For groups who know each other well.',
} as const;

const adult = (label: string) => (
  <span className="g-party-mix-seg">
    {label}
    <small>18+</small>
  </span>
);
const INTENSITY_OPTIONS = [
  ['chill', 'Chill'],
  ['party', 'Party'],
  ['wild', adult('Wild')],
  ['dark', adult('After Dark')],
] as const;

/** Typed text for a write-in rule: control characters out, whitespace folded, length capped. */
const tidyRule = (raw: string) =>
  Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, RULE_MAX)
    .join('')
    .trim();

/** Each kind of card: its label, a 24 by 24 stroke icon, and the pitch of its deal sound. */
const KINDS: Record<Kind, { label: string; icon: string; pitch: number }> = {
  challenge: { label: 'Challenge', icon: 'M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z', pitch: 1 },
  give: {
    label: 'Give',
    icon: 'M4 9.5h16v3.5H4zM5.5 13v7.5h13V13M12 9.5v11M12 9.5C10.5 6 7.5 5 6.8 6.6S8.5 9.5 12 9.5zM12 9.5c1.5-3.5 4.5-4.5 5.2-2.9S15.5 9.5 12 9.5z',
    pitch: 1.1,
  },
  everyone: {
    label: 'Everyone',
    icon: 'M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM2.8 20c.4-3.5 3-5.6 6.2-5.6s5.8 2.1 6.2 5.6M15.5 4.8a3.2 3.2 0 0 1 0 6.2M17.2 14.6c2.2.6 3.7 2.6 4 5.4',
    pitch: 1.2,
  },
  vote: { label: 'Vote', icon: 'M3.5 13.5h17v7h-17zM7.5 13.5V3.5h9v10M10 8.5l1.6 1.6L14.5 7', pitch: 1.3 },
  duel: {
    label: 'Duel',
    icon: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2',
    pitch: 0.9,
  },
  game: {
    label: 'Game',
    icon: 'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
    pitch: 1.25,
  },
  rule: { label: 'New Rule', icon: 'M9.26 7.38L12.38 4.26L18.74 10.62L15.62 13.74ZM12.4 10.6L4 19M13.5 20.5h7', pitch: 1 },
  end: { label: 'Rule Over', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.7L16 9.8', pitch: 1 },
  wyr: { label: 'Would You Rather', icon: 'M12 21v-8M12 13L5.5 6.5M12 13l6.5-6.5M5 11V6h5M19 11V6h-5', pitch: 1.15 },
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Card text with every name marked in its player's color. */
function Text({ parts, names }: { parts: readonly Part[]; names: readonly string[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <mark key={i} className="g-party-mix-name" style={{ ['--c' as string]: playerColor(p.seat) }}>
            {names[p.seat] ?? `Player ${p.seat + 1}`}
          </mark>
        ),
      )}
    </>
  );
}

/**
 * Sets --fs on `inner` to the largest type size that still fits inside `box`, and again whenever the box
 * resizes or the fonts finish loading.
 */
function useFitText(box: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>, content?: string) {
  useLayoutEffect(() => {
    const b = box.current;
    const el = inner.current;
    if (!b || !el) return;
    let alive = true;
    const fits = (px: number) => {
      el.style.setProperty('--fs', `${px}px`);
      return el.offsetHeight <= b.clientHeight && el.scrollWidth <= el.clientWidth + 1;
    };
    const fit = () => {
      if (!alive || !b.clientWidth) return;
      const max = Math.min(64, Math.max(26, b.clientWidth * 0.118));
      if (fits(max)) return;
      let lo = 13;
      let hi = max;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      el.style.setProperty('--fs', `${Math.floor(lo * 2) / 2}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    document.fonts?.ready.then(fit, () => {});
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [box, inner, content]);
}

function CardFace({ card, names, back, made }: { card: Card; names: readonly string[]; back: boolean; /** A write-in rule's text, once written. */ made?: string }) {
  const kind = KINDS[card.kind];
  const box = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  useFitText(box, inner, made);
  return (
    <article className={`g-party-mix-card is-${card.kind} ${back ? 'is-back' : ''}`}>
      <header>
        <Icon d={kind.icon} />
        <span>{kind.label}</span>
        {card.level >= 3 && <em>18+</em>}
      </header>
      <div className="g-party-mix-panel" ref={box}>
        <div className="g-party-mix-fit" ref={inner}>
          {card.kind === 'wyr' ? (
            <>
              <div className="g-party-mix-wyr">
                <p className="g-party-mix-opt">
                  <b aria-hidden="true">1</b>
                  <span>
                    <Text parts={card.text} names={names} />
                  </span>
                </p>
                <span className="g-party-mix-or">or</span>
                <p className="g-party-mix-opt">
                  <b aria-hidden="true">2</b>
                  <span>
                    <Text parts={card.or ?? []} names={names} />
                  </span>
                </p>
              </div>
              <p className="g-party-mix-foot">On three, hold up one finger or two. The smaller side drinks 1.</p>
            </>
          ) : (
            <>
              <p className="g-party-mix-text">
                <Text parts={card.text} names={names} />
              </p>
              {card.kind === 'rule' && card.rule && (
                <p className="g-party-mix-foot">
                  {made && <b className="g-party-mix-made">{made}</b>}
                  Stays on for the next {card.rule.lasts} cards.
                </p>
              )}
              {card.kind === 'vote' && <p className="g-party-mix-foot">A tie means everyone tied does it.</p>}
              {card.kind === 'end' && card.rule && (
                <p className="g-party-mix-foot">
                  <s>{made ?? <Text parts={card.rule.label} names={names} />}</s>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** A small fan of the deck on the setup step, one card of each main kind. */
const FAN: Kind[] = ['give', 'vote', 'challenge', 'wyr', 'duel'];
function DeckFan() {
  return (
    <div className="g-party-mix-fan" aria-hidden="true">
      {FAN.map((k, i) => (
        <span key={k} className={`g-party-mix-mini is-${k}`} style={{ ['--i' as string]: i - 2 }}>
          <Icon d={KINDS[k].icon} />
        </span>
      ))}
    </div>
  );
}

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

type Deal = { names: string[]; deck: Card[] };

function Play() {
  const shell = useShell();
  const [players] = usePlayers();
  const [intensity, setIntensity] = useSetting(INTENSITY);
  const [length, setLength] = useSetting(LENGTH);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [at, setAt] = useState(0);
  const [back, setBack] = useState(false);
  /** Write-in rules, by where their New Rule card sits in the deck. */
  const [made, setMade] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState('');
  const used = useRef<Set<string> | undefined>(undefined);
  const lastNext = useRef(-Infinity);
  /** When the tap being handled happened: a busy phone can run the handler late, so time it from the event. */
  const tapAt = useRef<number | null>(null);

  const start = () => {
    if (players.length < MIN) return;
    const deck = buildDeck({ players: players.length, intensity, length, avoid: used.current });
    used.current = new Set(deck.map((c) => c.key));
    sfx.noise(0.16, 0.07);
    sfx.play('blip', KINDS[deck[0].kind].pitch);
    setDeal({ names: players.slice(), deck });
    setAt(0);
    setBack(false);
    setMade({});
    setDraft('');
  };

  const move = (dir: 1 | -1) => {
    if (!deal) return;
    const total = deal.deck.length;
    const to = step(at, dir, total);
    if (to === at) return;
    // One finger, one card: a double tap (on the card, the button or both) moves on once.
    if (dir > 0) {
      const t = tapAt.current;
      tapAt.current = null;
      const now = t !== null && performance.now() - t < 3000 ? t : performance.now();
      if (now - lastNext.current < DOUBLE_TAP) return;
      lastNext.current = now;
    }
    setDraft('');
    setBack(dir < 0);
    setAt(to);
    // Back turns itself off on the first card; keep the keys working when it had focus.
    if (to === 0) shell.root.current?.focus({ preventScroll: true });
    const card = deal.deck[to];
    if (to === total) sfx.play('win');
    else if (dir < 0) sfx.play('blip', 0.75);
    else if (card.kind === 'rule') sfx.play('coin');
    else if (card.kind === 'end') sfx.play('select', 0.8);
    else sfx.play('blip', KINDS[card.kind].pitch);
  };

  useKeys((code, e) => {
    if (e?.repeat || !deal) return;
    if (code === 'ArrowRight' && at < deal.deck.length) move(1);
    else if (code === 'ArrowLeft') move(-1);
  });

  if (!deal) {
    const n = players.length;
    const ready = n >= MIN;
    return (
      <Screen
        key="setup"
        center={false}
        className="g-party-mix-setup"
        onEnter={ready ? start : undefined}
        actions={
          <Big primary disabled={!ready} onClick={start} quiet>
            {ready ? `Deal ${LENGTHS[length]} Cards` : `Add ${MIN - n} More ${MIN - n === 1 ? 'Player' : 'Players'}`}
          </Big>
        }
      >
        <DeckFan />
        <h2 className="arcade-party-title">Party Mix</h2>
        <p className="arcade-party-sub">Read each card out loud and do what it says. The cards already know your names.</p>
        <HowToPlay
          steps={[
            'Add everyone in seating order. Cards call people out by name.',
            'Whoever holds the phone reads the card out loud. Tap anywhere for the next one.',
            <>
              The color tells you the kind: a <b>Duel</b> is head to head, a <b>Vote</b> means everyone points on three (a tie means everyone tied), a <b>Game</b> goes around the circle.
            </>,
            <>
              A <b>New Rule</b> stays on until its Rule Over card. Rules in play sit above the card.
            </>,
            <>
              <b>Would You Rather</b>: on three, everyone holds up one finger or two. The smaller side drinks, and a tie means everyone does.
            </>,
            'Sips, not shots. Water counts. Anyone can pass on any card, and a card that brings someone else in needs their yes.',
          ]}
        />
        <PlayerList min={MIN} />
        <div className="g-party-mix-field">
          <Option label="Intensity" value={intensity} options={INTENSITY_OPTIONS} onChange={setIntensity} />
          <p className={`g-party-mix-note ${ADULT.includes(intensity) ? 'is-wild' : ''}`}>{INTENSITY_NOTE[intensity]}</p>
        </div>
        <Option
          label="Length"
          value={length}
          options={[
            ['short', 'Short'],
            ['normal', 'Normal'],
            ['long', 'Long'],
          ]}
          onChange={setLength}
        />
        <DrinkNote />
      </Screen>
    );
  }

  const { deck, names } = deal;
  const total = deck.length;

  if (at >= total) {
    const s = stats(deck, names.length);
    // One card apart is a coin flip, not a story: it reads as even.
    const even = s.most.times - s.least.times <= 1;
    // A headline only when one or two players stand out; otherwise the list says it.
    const headline = !even && s.most.seats.length <= 2;
    const order = names.map((_, i) => i).sort((a, b) => s.named[b] - s.named[a] || a - b);
    const again = () => start();
    return (
      <Screen
        key="end"
        className="g-party-mix-end"
        title="That's the Deck"
        sub={`${s.cards} cards down. Drink some water before the next one.`}
        onEnter={again}
        actions={
          <>
            <Big primary quiet onClick={again}>
              Play Again
            </Big>
            <Big onClick={() => setDeal(null)}>Change Setup</Big>
          </>
        }
      >
        <div className="arcade-party-card is-paper g-party-mix-recap" role="status">
          <dl className="g-party-mix-tally">
            <div>
              <dt>Cards</dt>
              <dd>{s.cards}</dd>
            </div>
            <div>
              <dt>Duels</dt>
              <dd>{s.duels}</dd>
            </div>
            <div>
              <dt>Rules</dt>
              <dd>{s.rules}</dd>
            </div>
          </dl>
          <div className="g-party-mix-called">
            {even ? (
              <p>
                Everyone got called out on {s.least.times === s.most.times ? s.most.times : `${s.least.times} or ${s.most.times}`} {s.most.times === 1 ? 'card' : 'cards'}. Nobody got off easy.
              </p>
            ) : (
              <>
                <p>
                  {headline ? (
                    <>
                      Most wanted: <b>{listNames(s.most.seats.map((i) => names[i]))}</b>, on {s.most.times} cards
                    </>
                  ) : (
                    'Times called out'
                  )}
                </p>
                <ul aria-label="Times each player was called out">
                  {order.map((i) => (
                    <li key={i} className={headline && s.named[i] === s.most.times ? 'is-top' : undefined}>
                      <Avatar name={names[i]} index={i} size={22} />
                      <span>{names[i]}</span>
                      <b>{s.named[i]}</b>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </Screen>
    );
  }

  const card = deck[at];
  const rules = activeRules(deck, at);
  const last = at === total - 1;
  const madeHere = card.write && card.rule ? made[card.rule.from] : undefined;
  const writing = card.kind === 'rule' && card.write && !madeHere;
  const ruleLabel = (r: Card) => {
    const label = plain(r.rule?.label ?? [], names);
    const text = r.write && r.rule ? made[r.rule.from] : undefined;
    return text ? `${label}: ${text}` : label;
  };
  return (
    <div
      className="g-party-mix-tap"
      onClickCapture={(e) => {
        tapAt.current = e.timeStamp;
      }}
      onClick={(e) => {
        if (!(e.target as Element).closest?.('button, a, input, form')) move(1);
        tapAt.current = null;
      }}
    >
      <Screen
        key="table"
        center={false}
        className="g-party-mix-table"
        onEnter={() => move(1)}
        actions={
          <div className="g-party-mix-nav">
            <Big quiet className="g-party-mix-back" disabled={at === 0} onClick={() => move(-1)}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </Big>
            <Big primary quiet onClick={() => move(1)}>
              {last ? 'Finish' : 'Next Card'}
            </Big>
          </div>
        }
      >
        <div className="g-party-mix-top">
          <div className="g-party-mix-progress" role="progressbar" aria-label="Deck" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at + 1}>
            <i style={{ width: `${((at + 1) / total) * 100}%` }} />
          </div>
          <span className="g-party-mix-count">
            {at + 1}
            <small> / {total}</small>
          </span>
        </div>
        {rules.length > 0 && (
          <ul className="g-party-mix-rules" aria-label="Rules in play">
            {rules.map((r) => (
              <li key={r.key} title={ruleLabel(r)}>
                <Icon d={KINDS.rule.icon} />
                <span>{ruleLabel(r)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="g-party-mix-stage" aria-live="polite">
          <CardFace key={at} card={card} names={names} back={back} made={madeHere} />
        </div>
        {writing && (
          <form
            className="g-party-mix-write"
            onSubmit={(e) => {
              e.preventDefault();
              const text = tidyRule(draft);
              if (!text || !card.rule) return;
              sfx.play('blip');
              setMade({ ...made, [card.rule.from]: text });
              setDraft('');
              shell.root.current?.focus({ preventScroll: true });
            }}
          >
            <input
              className="arcade-input"
              type="text"
              aria-label={`${plain(card.rule?.label ?? [], names)}, written down`}
              placeholder="Write the rule down"
              maxLength={RULE_MAX}
              autoComplete="off"
              enterKeyHint="done"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' && !e.metaKey && !e.ctrlKey) e.stopPropagation();
              }}
            />
            <button type="submit" className="arcade-btn" disabled={!tidyRule(draft)}>
              Add
            </button>
          </form>
        )}
      </Screen>
    </div>
  );
}
