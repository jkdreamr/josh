import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { GameShell, sfx, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, PlayerList, Row, Screen, listNames, mulberry32, useCountdown, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  ALTERNATE_RULES,
  CLASSIC_RULES,
  DECK_SIZE,
  LAST_KING,
  MADE_RULE_MAX,
  ROLE_TITLES,
  RULE_NAME_MAX,
  RULE_TEXT_MAX,
  SUITS,
  addMate,
  cardName,
  cardsLeft,
  cupLevel,
  draw,
  dropRule,
  isClassic,
  isRed,
  makeRule,
  mateGroups,
  matesOf,
  nearestSlot,
  newGame,
  nextSlot,
  nth,
  parseRules,
  rankLabel,
  rankName,
  rankOfKind,
  ruleFor,
  ruleKind,
  rulesEdited,
  setRule,
  slotAngle,
  tidy,
  type Card,
  type Drawn,
  type Game,
  type Pair,
  type Rule,
  type Suit,
} from './logic';
import { meta } from './meta';
import './kings-cup.css';

const CLASSIC = parseRules(null);
/** How long the fourth king sits on the table before the finale. */
const BEAT = 2.2;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

// Card art --------------------------------------------------------------------------------------------------------

const suitPath: Record<Suit, string> = {
  hearts: 'M12 21.2C6.4 17.1 2 13.4 2 8.7 2 5.6 4.4 3.2 7.3 3.2c2 0 3.6 1 4.7 2.7 1.1-1.7 2.7-2.7 4.7-2.7 2.9 0 5.3 2.4 5.3 5.5 0 4.7-4.4 8.4-10 12.5z',
  diamonds: 'M12 2.2l7.6 9.8L12 21.8 4.4 12z',
  spades: 'M12 2.4C7.6 6.6 3.4 9.6 3.4 13.6c0 2.7 2.1 4.6 4.5 4.6 1.3 0 2.4-.5 3.2-1.4-.3 1.9-1 3.2-2.2 4.4h6.2c-1.2-1.2-1.9-2.5-2.2-4.4.8.9 1.9 1.4 3.2 1.4 2.4 0 4.5-1.9 4.5-4.6 0-4-4.2-7-8.6-11.2z',
  clubs: 'M12 2.6a4.4 4.4 0 0 0-3.6 6.9 4.4 4.4 0 1 0 2.6 7.3c-.3 1.9-1 3.2-2.2 4.4h6.4c-1.2-1.2-1.9-2.5-2.2-4.4a4.4 4.4 0 1 0 2.6-7.3A4.4 4.4 0 0 0 12 2.6z',
};
const CROWN = 'M3 17.5L2 7.5l5.5 4.5L12 4.5l4.5 7.5L22 7.5l-1 10zM3 19.5h18v2H3z';

/** Pip spots for 2 to 10: x is 0 (left), 0.5 or 1 (right), y runs 0 (top) to 1 (bottom). */
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

/** A suit symbol centered on (x, y) inside an SVG, `size` units across, upside down when `flip`. */
function Pip({ suit, x, y, size, flip }: { suit: Suit; x: number; y: number; size: number; flip?: boolean }) {
  const s = size / 24;
  return <path d={suitPath[suit]} transform={`${flip ? `rotate(180 ${x} ${y}) ` : ''}translate(${x - size / 2} ${y - size / 2}) scale(${s})`} />;
}

function SuitIcon({ suit }: { suit: Suit }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={suitPath[suit]} fill="currentColor" />
    </svg>
  );
}

function CrownIcon({ on }: { on?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={on ? 'is-on' : undefined}>
      <path d={CROWN} />
    </svg>
  );
}

/** A face-up card drawn in a 100 by 140 box, so it scales to any size. */
function CardFace({ card }: { card: Card }) {
  const label = rankLabel(card.rank);
  const corner = (
    <g className="g-kings-cup-corner">
      <text x="11" y="19" textAnchor="middle" fontSize={label.length > 1 ? 14 : 16} letterSpacing={label.length > 1 ? -1 : 0}>
        {label}
      </text>
      <Pip suit={card.suit} x={11} y={28} size={10} />
    </g>
  );
  let middle;
  if (card.rank === 1) middle = <Pip suit={card.suit} x={50} y={70} size={card.suit === 'spades' ? 46 : 40} />;
  else if (card.rank <= 10) middle = PIPS[card.rank].map(([px, py], i) => <Pip key={i} suit={card.suit} x={31 + px * 38} y={25 + py * 90} size={18} flip={py > 0.5} />);
  else
    middle = (
      <g className={`g-kings-cup-court is-r${card.rank}`}>
        <rect x="21" y="15" width="58" height="110" rx="5" />
        {card.rank === 11 ? (
          <Pip suit={card.suit} x={50} y={40} size={18} />
        ) : (
          <path className="g-kings-cup-court-crown" d={CROWN} transform={`translate(${card.rank === 13 ? 36 : 39} ${card.rank === 13 ? 25 : 28}) scale(${card.rank === 13 ? 28 / 24 : 22 / 24})`} />
        )}
        <text x="50" y="90" textAnchor="middle">
          {label}
        </text>
        <Pip suit={card.suit} x={50} y={108} size={13} />
      </g>
    );
  return (
    <svg viewBox="0 0 100 140" className={`g-kings-cup-svgface ${isRed(card) ? 'is-red' : ''}`} role="img" aria-label={cardName(card)}>
      {corner}
      <g transform="rotate(180 50 70)">{corner}</g>
      {middle}
    </svg>
  );
}

/** The back of a card: red stock, a cream border and a crown in the middle. */
function CardBack() {
  return (
    <svg viewBox="0 0 100 140" aria-hidden="true">
      <rect x="0" y="0" width="100" height="140" rx="9" className="g-kings-cup-back-stock" />
      <rect x="7" y="7" width="86" height="126" rx="4" className="g-kings-cup-back-field" />
      <rect x="12" y="12" width="76" height="116" rx="2" className="g-kings-cup-back-line" />
      <path d="M50 30L70 70L50 110L30 70Z" className="g-kings-cup-back-line" />
      <path d={CROWN} transform="translate(38 58) scale(1)" className="g-kings-cup-back-crown" />
    </svg>
  );
}

/** A small face for rule rows: the rank in its suit color. */
function MiniCard({ rank }: { rank: number }) {
  const suit = SUITS[(rank - 1) % 4];
  return (
    <span className={`g-kings-cup-mini ${suit === 'hearts' || suit === 'diamonds' ? 'is-red' : ''}`} aria-hidden="true">
      <b>{rankLabel(rank)}</b>
      <SuitIcon suit={suit} />
    </span>
  );
}

/**
 * The cup in a local box centered on (0, 0), about 64 wide and 80 tall. Each king fills it a quarter, with a slosh.
 * `full` adds the foam head that spills over the rim for the finale.
 */
function Cup({ level, full }: { level: number; full?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const inside = 'M-29 -38L29 -38L22.2 33.4Q21.8 35.4 19.8 35.4L-19.8 35.4Q-21.8 35.4 -22.2 33.4Z';
  const drop = level <= 0 ? 80 : (1 - level) * 70 - (full ? 6 : 0);
  let wave = 'M-60 -38';
  for (let x = -60; x < 90; x += 30) wave += 'q7.5 -2.6 15 0t15 0';
  return (
    <g className="g-kings-cup-cup">
      <defs>
        <clipPath id={`${uid}-in`}>
          <path d={inside} />
        </clipPath>
      </defs>
      <ellipse cx="0" cy="40" rx="30" ry="4.5" className="g-kings-cup-cup-shadow" />
      <path className="g-kings-cup-glass" d="M-32.5 -41L32.5 -41L24.8 35.2Q24.3 39.5 20 39.5L-20 39.5Q-24.3 39.5 -24.8 35.2Z" />
      <g clipPath={`url(#${uid}-in)`}>
        <g className="g-kings-cup-liquid" style={{ transform: `translateY(${drop}px)` }}>
          {/* Keyed by level so the surface sloshes once each time a king tops it up, then settles. */}
          <g className="g-kings-cup-wave" key={level}>
            <path className="g-kings-cup-beer" d={`${wave}V44H-60Z`} />
            <path className="g-kings-cup-deep" d="M-60 30H90V44H-60Z" />
            <path className="g-kings-cup-foam" d={wave} />
          </g>
        </g>
        {level > 0 && (
          <g key={level} style={{ ['--rise' as string]: `${Math.max(8, level * 70 - 10)}px` }}>
            {[-13, -3, 8, 16].map((x, i) => (
              <circle key={x} className="g-kings-cup-bubble" cx={x} cy="33" r={i % 2 ? 1.1 : 1.6} style={{ animationDelay: `${i * 0.35}s` }} />
            ))}
          </g>
        )}
      </g>
      <path className="g-kings-cup-shine" d="M-25.5 -33L-19.5 28" />
      <path className="g-kings-cup-shine is-thin" d="M24 -33L21.4 -8" />
      <ellipse className="g-kings-cup-rim" cx="0" cy="-41" rx="32.5" ry="3.4" />
      {full && (
        <g className="g-kings-cup-head">
          <path className="g-kings-cup-drip" d="M-35 -41.5h4.4v17a2.2 2.2 0 0 1 -4.4 0z" transform="rotate(-5.8 -32.5 -41)" />
          <path className="g-kings-cup-drip is-late" d="M31 -41.5h3.6v11a1.8 1.8 0 0 1 -3.6 0z" transform="rotate(5.8 32.5 -41)" />
          <path d="M-34 -38c-2 -7 6 -11 11 -8c2 -6 11 -7 14 -2c4 -5 13 -5 16 1c4 -4 12 -2 12 4c6 -2 12 2 10 7c4 2 2 6 -2 6H-31c-4 0 -6 -5 -3 -8z" />
        </g>
      )}
    </g>
  );
}

// The ring --------------------------------------------------------------------------------------------------------

const C = 120;
const RADIUS = 99;
const CW = 13;
const CH = 20;

function Ring({ game, deal, animate, onPick }: { game: Game; deal: number; animate: boolean; onPick: (slot?: number) => void }) {
  // A little hand-laid wobble per slot, fixed for each deal.
  const wobble = useMemo(() => {
    const r = mulberry32(deal * 7919 + 13);
    return Array.from({ length: DECK_SIZE }, () => ({ a: (r() - 0.5) * 2.6, d: (r() - 0.5) * 4, t: (r() - 0.5) * 8 }));
  }, [deal]);
  const left = cardsLeft(game);
  const next = game.over ? -1 : nextSlot(game);
  const pick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // Keyboard clicks have no pointer position: take the next card around.
    if (e.detail === 0) return onPick();
    const box = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < box.width * 0.3) return onPick();
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const slot = nearestSlot(game, angle);
    onPick(slot >= 0 ? slot : undefined);
  };
  const full = game.over && game.kings >= LAST_KING;
  return (
    <button
      type="button"
      className={`g-kings-cup-ring ${animate ? 'is-dealing' : ''} ${full ? 'is-full' : ''}`}
      onClick={pick}
      aria-label={full ? 'The cup is full' : `Draw a card, ${left} left`}
    >
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle cx={C} cy={C} r="119" className="g-kings-cup-felt" />
        <circle cx={C} cy={C} r="80" className="g-kings-cup-felt-line" />
        <g className="g-kings-cup-slots">
          {game.ring.map((card, i) => {
            const w = wobble[i];
            const cls = ['g-kings-cup-slot', card ? '' : 'is-gone', i === next ? 'is-next' : ''].join(' ');
            return (
              <g key={i} transform={`rotate(${slotAngle(i) + w.a} ${C} ${C}) translate(0 ${w.d}) rotate(${w.t} ${C} ${C - RADIUS})`}>
                <g className="g-kings-cup-deal" style={{ animationDelay: `${i * 11}ms` }}>
                  <g className={cls}>
                    <rect x={C - CW / 2} y={C - RADIUS - CH / 2} width={CW} height={CH} rx="1.8" className="g-kings-cup-slot-stock" />
                    <rect x={C - CW / 2 + 1.3} y={C - RADIUS - CH / 2 + 1.3} width={CW - 2.6} height={CH - 2.6} rx="1" className="g-kings-cup-slot-in" />
                  </g>
                </g>
              </g>
            );
          })}
        </g>
        <g transform={`translate(${C} ${C - 8}) scale(1.08)`}>
          <Cup level={cupLevel(game.kings)} full={full} />
        </g>
        <text x={C} y={C + 64} textAnchor="middle" className="g-kings-cup-left">
          {full ? 'Bottoms up' : `${left} left`}
        </text>
      </svg>
    </button>
  );
}

// House rules -------------------------------------------------------------------------------------------------------

/** Keys typed into a field stay there: no drawing, no OS shortcuts. Escape backs out. */
const fieldKeys = (cancel: () => void) => (e: ReactKeyboardEvent<HTMLElement>) => {
  if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
  }
};

function RuleEditor({ rank, rule, onSave, onCancel }: { rank: number; rule: Rule; onSave: (name: string, text: string) => void; onCancel: () => void }) {
  const shell = useShell();
  const [name, setName] = useState(rule.name);
  const [text, setText] = useState(rule.text);
  const box = useRef<HTMLFormElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const classic = CLASSIC_RULES[rank - 1];
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
    // On a phone the keyboard would cover the swaps, so only desktops jump straight into typing.
    if (shell.touch) return;
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  const ok = !!tidy(name, RULE_NAME_MAX);
  const keys = fieldKeys(onCancel);
  const swap = (r: Rule) => {
    sfx.play('select');
    setName(r.name);
    setText(r.text);
  };
  return (
    <form
      ref={box}
      className="g-kings-cup-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(name, text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <MiniCard rank={rank} />
      <div className="g-kings-cup-edit-fields">
        <input
          ref={input}
          className="arcade-input"
          type="text"
          aria-label={`Rule name for ${rankName(rank)}`}
          placeholder={classic.name}
          maxLength={RULE_NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={keys}
        />
        <textarea
          className="arcade-input"
          aria-label={`What happens on ${rankName(rank)}`}
          placeholder="What happens"
          maxLength={RULE_TEXT_MAX}
          rows={2}
          enterKeyHint="done"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            keys(e);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="g-kings-cup-swaps" role="group" aria-label="Swap in a rule">
          <span>Swap in</span>
          {[classic, ...ALTERNATE_RULES].map((r, i) => (
            <button
              type="button"
              key={r.name}
              aria-pressed={tidy(name, RULE_NAME_MAX) === r.name && tidy(text, RULE_TEXT_MAX) === r.text}
              className={i === 0 ? 'is-classic' : undefined}
              onClick={() => swap(r)}
            >
              {r.name}
            </button>
          ))}
        </div>
        <div className="g-kings-cup-edit-btns">
          <button type="button" className="arcade-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="arcade-btn arcade-btn-primary" disabled={!ok}>
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

function RuleText({ rank, rule }: { rank: number; rule: Rule }) {
  return (
    <>
      <MiniCard rank={rank} />
      <span className="g-kings-cup-rule-text">
        <b>{rule.name}</b>
        {rule.text && <small>{rule.text}</small>}
      </span>
      {!isClassic(rule, rank) && <em>House</em>}
    </>
  );
}

function HouseRules({ rules, onChange, label }: { rules: Rule[]; onChange: (rules: Rule[]) => void; label?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const edited = rulesEdited(rules);
  return (
    <div className="arcade-party-field g-kings-cup-rules">
      {label && <span>{label}</span>}
      <ul className="g-kings-cup-rulelist">
        {rules.map((rule, i) => {
          const rank = i + 1;
          return (
            <li key={rank} className={open === rank ? 'is-open' : undefined}>
              {open === rank ? (
                <RuleEditor
                  rank={rank}
                  rule={rule}
                  onCancel={() => setOpen(null)}
                  onSave={(name, text) => {
                    sfx.play('blip');
                    onChange(setRule(rules, rank, name, text));
                    setOpen(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="g-kings-cup-rule"
                  aria-label={`${rankName(rank)}: ${rule.name}. Change it`}
                  onClick={() => {
                    sfx.play('select');
                    setOpen(rank);
                  }}
                >
                  <RuleText rank={rank} rule={rule} />
                  <svg className="g-kings-cup-pen" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {edited ? (
        <button
          type="button"
          className="g-kings-cup-reset"
          onClick={() => {
            sfx.play('hit', 1.4);
            setOpen(null);
            onChange(CLASSIC);
          }}
        >
          Reset to Classic
        </button>
      ) : (
        <small>Tap a rule to change it or swap in a favorite.</small>
      )}
    </div>
  );
}

// The game ------------------------------------------------------------------------------------------------------------

type Step = 'setup' | 'play' | 'rules' | 'cup';
/** The card on show, with the rule it had when it was drawn (editing the house rules counts from the next card). */
type Current = Drawn & { n: number; rule: Rule; mateBase: Pair[]; madeRule: boolean };

const HOW: ReactNode[] = [
  <>Set an empty cup in the middle of the table. The ring of cards lives on this phone.</>,
  <>Take turns pulling any card from the ring. Read its rule out loud and do it.</>,
  <>
    Some rules stick: <b>mates</b> drink together all game, and the <b>Question Master</b> rules until the next queen.
  </>,
  <>
    Every <b>king</b>, pour a splash of your drink into the cup.
  </>,
  <>
    Whoever pulls the <b>fourth king</b> drinks the cup. Sips are fine.
  </>,
];

/** Waits a beat on the table after the fourth king, then moves on. Pausing the game holds it. */
function Beat({ onEnd }: { onEnd: () => void }) {
  useCountdown(BEAT, { onEnd, tick: false });
  return null;
}

function Play() {
  const [players] = usePlayers();
  const [rules, setRules] = useStored<Rule[]>('kings-cup:rules', CLASSIC, parseRules);
  const [step, setStep] = useState<Step>('setup');
  const [table, setTable] = useState<string[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [cur, setCur] = useState<Current | null>(null);
  const [deal, setDeal] = useState(0);
  const [draft, setDraft] = useState('');
  /** Cups drunk this session, by name. */
  const [cups, setCups] = useState<Record<string, number>>({});
  // Animations play once: the deal when a ring is laid out, the flip when a card is drawn (not again on coming back from the rules).
  const dealt = useRef(0);
  const flipped = useRef(0);
  const finaleAt = useRef(0);
  const kingAt = useRef(0);
  const mates = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (step !== 'play') return;
    dealt.current = deal;
    flipped.current = cur?.n ?? 0;
  });
  // The mate picker can land below the fold on a phone: bring it up so nobody has to hunt for it.
  useEffect(() => {
    if (step === 'play') mates.current?.scrollIntoView({ block: 'nearest' });
  }, [cur?.n, step]);

  const name = (seat: number) => table[seat] ?? `Player ${seat + 1}`;

  const start = (names: string[], first = 0) => {
    setTable(names);
    setGame(newGame(names.length, Math.random, first));
    setCur(null);
    setDraft('');
    setDeal((d) => d + 1);
    setStep('play');
  };

  /** Ends the beat. A tap that lands right after the fourth king flips (a double tap on Draw) doesn't skip it. */
  const toCup = (force = false) => {
    if (step !== 'play' || !cur?.last) return;
    if (!force && performance.now() - kingAt.current < 700) return;
    sfx.play('win');
    finaleAt.current = performance.now();
    setStep('cup');
  };

  const pull = (slot?: number) => {
    if (!game) return;
    if (cur?.last) return toCup();
    const r = draw(game, slot, rules);
    if (!r) return;
    setGame(r.game);
    setCur({ ...r.drawn, n: r.game.drawn.length, rule: ruleFor(rules, r.drawn.card.rank), mateBase: r.game.mates, madeRule: false });
    setDraft('');
    sfx.noise(0.06, 0.1);
    if (r.drawn.last) {
      // The fourth king: a low thud under the coin, then a beat on the table before the cup.
      kingAt.current = performance.now();
      sfx.play('coin', 0.7);
      sfx.tone({ freq: 110, to: 52, dur: 0.7, type: 'triangle', vol: 0.22, delay: 0.05 });
      if (r.drawn.seat !== null) {
        const who = name(r.drawn.seat);
        setCups((c) => ({ ...c, [who]: (c[who] ?? 0) + 1 }));
      }
      return;
    }
    if (r.drawn.card.rank === 13) sfx.play('coin', 0.9 + r.drawn.kings * 0.08);
    else sfx.tone({ freq: 440, to: 660, dur: 0.08, type: 'triangle', vol: 0.08, delay: 0.03 });
  };

  if (step === 'setup' || !game) {
    return (
      <Screen
        key="setup"
        center={false}
        title="Kings Cup"
        sub="Pull a card, follow its rule. Whoever pulls the fourth king drinks the cup."
        onEnter={() => start(players)}
        actions={
          <Big primary onClick={() => start(players)}>
            Deal
          </Big>
        }
      >
        <HowToPlay steps={HOW} />
        <PlayerList min={0} />
        <HouseRules rules={rules} onChange={setRules} label="House Rules" />
        <DrinkNote />
      </Screen>
    );
  }

  if (step === 'rules')
    return (
      <Screen
        key="rules"
        center={false}
        title="House Rules"
        sub="Changes count from the next card."
        onEnter={() => setStep('play')}
        actions={
          <Big primary onClick={() => setStep('play')}>
            Back to the Ring
          </Big>
        }
      >
        <HouseRules rules={rules} onChange={setRules} />
      </Screen>
    );

  if (step === 'cup') {
    const again = () => start(table, game.turn);
    const seat = cur?.seat ?? null;
    const drinker = seat !== null ? name(seat) : null;
    const kings = game.drawn.filter((c) => c.rank === 13);
    const poured = [...new Set(game.kingSeats.slice(0, -1).filter((s): s is number => s !== null))].map(name);
    const count = drinker ? (cups[drinker] ?? 0) : 0;
    return (
      <Screen
        key="cup"
        className="g-kings-cup-final"
        onEnter={() => {
          // A second press of the key that ended the beat shouldn't skip the payoff.
          if (performance.now() - finaleAt.current > 700) again();
        }}
        actions={
          <>
            <Big primary onClick={again}>
              New Game
            </Big>
            <Big onClick={() => setStep('setup')}>Change Setup</Big>
          </>
        }
      >
        <div className="g-kings-cup-trophy" aria-hidden="true">
          <div className="g-kings-cup-fan">
            {kings.map((k, i) => (
              <div key={k.id} className={`g-kings-cup-card ${i === kings.length - 1 ? 'is-last' : ''}`} style={{ ['--i' as string]: i - (kings.length - 1) / 2, ['--k' as string]: i } as CSSProperties}>
                <div className="g-kings-cup-face">
                  <CardFace card={k} />
                </div>
              </div>
            ))}
          </div>
          <svg viewBox="-44 -56 88 100">
            <Cup level={1} full />
          </svg>
        </div>
        <div className="g-kings-cup-verdict" role="status">
          <p className="arcade-party-kicker">The fourth king</p>
          <h2 className="arcade-party-title is-huge">{drinker ?? 'Drink the Cup'}</h2>
          <p className="arcade-party-sub">
            {drinker ? 'drinks the cup.' : 'If you pulled it, the cup is yours.'} {poured.length > 0 && `${listNames(poured)} poured it.`}
          </p>
        </div>
        {count >= 2 && <p className="g-kings-cup-tally">{`${drinker}'s ${nth(count)} cup tonight.`}</p>}
        <p className="g-kings-cup-stat">
          {game.drawn.length} of {DECK_SIZE} cards drawn. Sips are fine.
        </p>
      </Screen>
    );
  }

  const nextName = game.seats ? name(game.turn) : null;
  const rule = cur?.rule ?? null;
  const kind = ruleKind(rule ?? undefined);
  const fresh = !!cur && cur.n !== flipped.current;
  const drawerMates = cur && cur.seat !== null ? matesOf(cur.mateBase, cur.seat) : [];
  const chosenMate = cur && cur.seat !== null && kind === 'mate' ? game.mates.find((p) => !cur.mateBase.includes(p)) : undefined;
  const groups = mateGroups(game.mates);
  // A role goes away with its rule: swap Snake Eyes out of the house rules and nobody holds it anymore.
  const roles = game.roles.filter((r) => rankOfKind(rules, r.kind) !== null);
  const tag = (k: 'mate' | 'make', fallback: number) => rankLabel(rankOfKind(rules, k) ?? fallback);
  const last = !!cur?.last;

  return (
    <Screen
      key="play"
      className={`g-kings-cup-play ${last ? 'is-last' : ''}`}
      onEnter={() => pull()}
      actions={
        last ? (
          <Big primary quiet onClick={() => toCup()}>
            Drink the Cup
          </Big>
        ) : (
          <Row>
            <Big className="g-kings-cup-rules-btn" onClick={() => setStep('rules')}>
              Rules
            </Big>
            <Big primary quiet onClick={() => pull()}>
              {nextName ? `Draw for ${nextName}` : 'Draw'}
            </Big>
          </Row>
        )
      }
    >
      {last && <Beat onEnd={() => toCup(true)} />}
      <div className="g-kings-cup-table">
        <Ring game={game} deal={deal} animate={deal !== dealt.current} onPick={pull} />
        <div className="g-kings-cup-side">
          <div className="g-kings-cup-hand" aria-live="polite">
            <div className="g-kings-cup-card">
              {cur ? (
                <div className={`g-kings-cup-flip ${fresh ? 'is-new' : ''}`} key={cur.n}>
                  <div className="g-kings-cup-face">
                    <CardFace card={cur.card} />
                  </div>
                  <div className="g-kings-cup-back">
                    <CardBack />
                  </div>
                </div>
              ) : (
                <div className="g-kings-cup-back is-idle">
                  <CardBack />
                </div>
              )}
            </div>
            <div className={`g-kings-cup-say ${fresh ? 'is-new' : ''}`} key={cur?.n ?? 'idle'}>
              {cur && rule ? (
                <>
                  <p className="g-kings-cup-who">
                    {cur.seat !== null ? (
                      <>
                        <Avatar name={name(cur.seat)} index={cur.seat} size={22} />
                        <span>{name(cur.seat)} drew</span>
                      </>
                    ) : (
                      <span>{cardName(cur.card)}</span>
                    )}
                  </p>
                  <h3>{rule.name}</h3>
                  {rule.text && <p>{rule.text}</p>}
                  {cur.card.rank === 13 && <p className="g-kings-cup-warn">{cur.last ? "That's the fourth king." : cur.kings === LAST_KING - 1 ? 'Three down. The next king drinks the cup.' : `King ${cur.kings} of ${LAST_KING}.`}</p>}
                </>
              ) : (
                <>
                  <p className="g-kings-cup-who">
                    {nextName ? (
                      <>
                        <Avatar name={nextName} index={game.turn} size={22} />
                        <span>{nextName} starts</span>
                      </>
                    ) : (
                      <span>52 cards, 4 kings</span>
                    )}
                  </p>
                  <h3>First Card</h3>
                  <p>Pull any card from the ring.</p>
                </>
              )}
            </div>
          </div>

          {cur && kind === 'make' && !cur.madeRule && !last && (
            <form
              className="g-kings-cup-make"
              onSubmit={(e) => {
                e.preventDefault();
                if (!tidy(draft, MADE_RULE_MAX)) return;
                sfx.play('blip');
                setGame(makeRule(game, draft));
                setCur({ ...cur, madeRule: true });
                setDraft('');
              }}
            >
              <input
                className="arcade-input"
                type="text"
                aria-label="The new rule"
                placeholder="Write the rule down"
                maxLength={MADE_RULE_MAX}
                autoComplete="off"
                enterKeyHint="done"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={fieldKeys(() => setDraft(''))}
              />
              <button type="submit" className="arcade-btn" disabled={!tidy(draft, MADE_RULE_MAX)}>
                Add
              </button>
            </form>
          )}

          {cur && kind === 'mate' && cur.seat !== null && game.seats > 1 && !last && (
            <div className="arcade-party-field g-kings-cup-mates" ref={mates}>
              <span>Pick {name(cur.seat)}'s mate</span>
              <div className="arcade-party-picks">
                {table.map((p, i) => {
                  if (i === cur.seat) return null;
                  const already = drawerMates.includes(i);
                  const on = !!chosenMate && chosenMate.includes(i);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={already || on}
                      disabled={already}
                      onClick={() => {
                        sfx.play('select');
                        setGame({ ...game, mates: on ? cur.mateBase : addMate(cur.mateBase, cur.seat!, i) });
                      }}
                    >
                      <Avatar name={p} index={i} size={26} />
                      <span>{p}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <ul className="g-kings-cup-effects" aria-label="In play">
            <li className="g-kings-cup-crowns" aria-label={`${game.kings} of ${LAST_KING} kings drawn`}>
              {Array.from({ length: LAST_KING }, (_, i) => (
                <CrownIcon key={i} on={i < game.kings} />
              ))}
            </li>
            {roles.map((role) => (
              <li key={role.kind}>
                <span className={`g-kings-cup-tag ${isRed(role.card) ? 'is-red' : ''}`}>
                  {rankLabel(role.card.rank)}
                  <SuitIcon suit={role.card.suit} />
                </span>
                {role.seat !== null ? (
                  <span>
                    {ROLE_TITLES[role.kind]}: <b>{name(role.seat)}</b>
                  </span>
                ) : (
                  <span>
                    {ROLE_TITLES[role.kind]}: whoever drew the {rankName(role.card.rank).toLowerCase()}
                  </span>
                )}
              </li>
            ))}
            {groups.map((g) => (
              <li key={g.join('-')}>
                <span className="g-kings-cup-tag">{tag('mate', 8)}</span>
                <span>
                  <b>{listNames(g.map(name))}</b> are mates
                </span>
              </li>
            ))}
            {game.made.map((r, i) => (
              <li key={`${i}-${r}`} className="is-rule">
                <span className="g-kings-cup-tag">{tag('make', 11)}</span>
                <span>{r}</span>
                <button
                  type="button"
                  aria-label={`Drop the rule: ${r}`}
                  onClick={() => {
                    sfx.play('hit', 1.4);
                    setGame(dropRule(game, i));
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Screen>
  );
}
