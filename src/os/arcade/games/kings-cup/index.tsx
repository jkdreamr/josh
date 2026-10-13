import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { GameShell, sfx } from '../../kit';
import { Avatar, Big, DrinkNote, PlayerList, Row, Screen, listNames, mulberry32, usePlayers, useStored } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  CLASSIC_RULES,
  DECK_SIZE,
  LAST_KING,
  MADE_RULE_MAX,
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
  parseRules,
  rankLabel,
  rankName,
  ruleFor,
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
 * The cup in a local box centered on (0, 0), about 64 wide and 80 tall. Gold fills it a quarter per king.
 * `full` adds the foam head that spills over for the finale.
 */
function Cup({ level, full }: { level: number; full?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const inside = 'M-29 -38L29 -38L22.2 33.4Q21.8 35.4 19.8 35.4L-19.8 35.4Q-21.8 35.4 -22.2 33.4Z';
  const drop = level <= 0 ? 80 : (1 - level) * 70 - (full ? 6 : 0);
  let wave = 'M-60 -38';
  for (let x = -60; x < 90; x += 30) wave += 'q7.5 -2.6 15 0t15 0';
  wave += 'V44H-60Z';
  return (
    <g className="g-kings-cup-cup">
      <defs>
        <clipPath id={`${uid}-in`}>
          <path d={inside} />
        </clipPath>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd96a" />
          <stop offset="0.55" stopColor="#e8a91c" />
          <stop offset="1" stopColor="#b8730c" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor="#ffcf4a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffcf4a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="g-kings-cup-glow" cx="0" cy="4" rx="58" ry="58" fill={`url(#${uid}-glow)`} style={{ opacity: Math.min(1, level * 1.1) }} />
      <ellipse cx="0" cy="40" rx="30" ry="4.5" fill="rgba(0,0,0,0.35)" />
      <path className="g-kings-cup-glass" d="M-32.5 -41L32.5 -41L24.8 35.2Q24.3 39.5 20 39.5L-20 39.5Q-24.3 39.5 -24.8 35.2Z" />
      <g clipPath={`url(#${uid}-in)`}>
        <g className="g-kings-cup-liquid" style={{ transform: `translateY(${drop}px)` }}>
          <path className="g-kings-cup-wave" d={wave} fill={`url(#${uid}-gold)`} />
          <path className="g-kings-cup-wave g-kings-cup-foam" d={wave.replace(/V44H-60Z$/, '')} />
        </g>
        {level > 0 && (
          <g style={{ ['--rise' as string]: `${Math.max(8, level * 70 - 10)}px` }}>
            {[-13, -3, 8, 16].map((x, i) => (
              <circle key={x} className="g-kings-cup-bubble" cx={x} cy="33" r={i % 2 ? 1.1 : 1.6} style={{ animationDelay: `${i * 0.6}s` }} />
            ))}
          </g>
        )}
      </g>
      <path className="g-kings-cup-shine" d="M-25.5 -33L-19.5 28" />
      <path className="g-kings-cup-shine is-thin" d="M24 -33L21.4 -8" />
      <ellipse className="g-kings-cup-rim" cx="0" cy="-41" rx="32.5" ry="3.4" />
      {full && (
        <g className="g-kings-cup-head">
          <path d="M-35 -41.5h4.4v17a2.2 2.2 0 0 1 -4.4 0z" transform="rotate(-5.8 -32.5 -41)" />
          <path d="M31 -41.5h3.6v11a1.8 1.8 0 0 1 -3.6 0z" transform="rotate(5.8 32.5 -41)" />
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
  const uid = useId().replace(/:/g, '');
  // A little hand-laid wobble per slot, fixed for each deal.
  const wobble = useMemo(() => {
    const r = mulberry32(deal * 7919 + 13);
    return Array.from({ length: DECK_SIZE }, () => ({ a: (r() - 0.5) * 2.6, d: (r() - 0.5) * 4, t: (r() - 0.5) * 8 }));
  }, [deal]);
  const left = cardsLeft(game);
  const next = nextSlot(game);
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
  return (
    <button type="button" className={`g-kings-cup-ring ${animate ? 'is-dealing' : ''}`} onClick={pick} aria-label={`Draw a card, ${left} left`}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>
          <radialGradient id={`${uid}-felt`} cx="50%" cy="45%" r="55%">
            <stop offset="0" stopColor="#1f6446" />
            <stop offset="0.75" stopColor="#134631" />
            <stop offset="1" stopColor="#0c2f21" />
          </radialGradient>
          <linearGradient id={`${uid}-back`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#b3253a" />
            <stop offset="1" stopColor="#6e0f1f" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r="119" fill={`url(#${uid}-felt)`} className="g-kings-cup-felt" />
        <circle cx={C} cy={C} r="80" className="g-kings-cup-felt-line" />
        <g className="g-kings-cup-slots">
          {game.ring.map((card, i) => {
            const w = wobble[i];
            const cls = ['g-kings-cup-slot', card ? '' : 'is-gone', i === next ? 'is-next' : ''].join(' ');
            return (
              <g key={i} transform={`rotate(${slotAngle(i) + w.a} ${C} ${C}) translate(0 ${w.d}) rotate(${w.t} ${C} ${C - RADIUS})`}>
                <g className="g-kings-cup-deal" style={{ animationDelay: `${i * 11}ms` }}>
                  <g className={cls}>
                    <rect x={C - CW / 2} y={C - RADIUS - CH / 2} width={CW} height={CH} rx="1.8" fill="#f4efe4" />
                    <rect x={C - CW / 2 + 1.3} y={C - RADIUS - CH / 2 + 1.3} width={CW - 2.6} height={CH - 2.6} rx="1" fill={`url(#${uid}-back)`} className="g-kings-cup-slot-in" />
                  </g>
                </g>
              </g>
            );
          })}
        </g>
        <g transform={`translate(${C} ${C - 8}) scale(1.08)`}>
          <Cup level={cupLevel(game.kings)} />
        </g>
        <text x={C} y={C + 64} textAnchor="middle" className="g-kings-cup-left">
          {left} left
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
  const [name, setName] = useState(rule.name);
  const [text, setText] = useState(rule.text);
  const input = useRef<HTMLInputElement | null>(null);
  const classic = CLASSIC_RULES[rank - 1];
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
    el.closest('li')?.scrollIntoView({ block: 'nearest' });
  }, []);
  const ok = !!tidy(name, RULE_NAME_MAX);
  const keys = fieldKeys(onCancel);
  return (
    <form
      className="g-kings-cup-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(name, text);
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
          rows={3}
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
        <div className="g-kings-cup-edit-btns">
          {(name !== classic.name || text !== classic.text) && (
            <button
              type="button"
              className="arcade-btn"
              onClick={() => {
                setName(classic.name);
                setText(classic.text);
              }}
            >
              Classic
            </button>
          )}
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

function HouseRules({ rules, onChange }: { rules: Rule[]; onChange: (rules: Rule[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const edited = rulesEdited(rules);
  return (
    <div className="arcade-party-field g-kings-cup-rules">
      <span>House Rules</span>
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
        <small>Tap a rule to change it.</small>
      )}
    </div>
  );
}

// The game ------------------------------------------------------------------------------------------------------------

type Step = 'setup' | 'play' | 'rules' | 'cup';
type Current = Drawn & { n: number; mateBase: Pair[]; madeRule: boolean };

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        left: (i * 37 + 11) % 100,
        delay: ((i * 7) % 13) * 0.11,
        dur: 2.6 + (i % 5) * 0.4,
        spin: (i % 2 ? 1 : -1) * (240 + (i % 4) * 90),
        drift: ((i % 7) - 3) * 9,
        kind: i % 6 === 0 ? 'crown' : i % 3 === 0 ? 'red' : i % 2 ? 'gold' : 'pale',
      })),
    [],
  );
  return (
    <div className="g-kings-cup-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className={`is-${b.kind}`}
          style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, ['--spin' as string]: `${b.spin}deg`, ['--drift' as string]: `${b.drift}px` } as CSSProperties}
        >
          {b.kind === 'crown' && <CrownIcon on />}
        </span>
      ))}
    </div>
  );
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
  // Animations play once: the deal when a ring is laid out, the flip when a card is drawn (not again on coming back from the rules).
  const dealt = useRef(0);
  const flipped = useRef(0);
  useEffect(() => {
    if (step !== 'play') return;
    dealt.current = deal;
    flipped.current = cur?.n ?? 0;
  });

  const name = (seat: number) => table[seat] ?? `Player ${seat + 1}`;

  const start = (names: string[], first = 0) => {
    setTable(names);
    setGame(newGame(names.length, Math.random, first));
    setCur(null);
    setDraft('');
    setDeal((d) => d + 1);
    setStep('play');
  };

  const pull = (slot?: number) => {
    if (!game) return;
    const r = draw(game, slot);
    if (!r) return;
    setGame(r.game);
    setCur({ ...r.drawn, n: r.game.drawn.length, mateBase: r.game.mates, madeRule: false });
    setDraft('');
    if (r.drawn.last) {
      sfx.play('win');
      setStep('cup');
      return;
    }
    sfx.noise(0.06, 0.1);
    if (r.drawn.card.rank === 13) sfx.play('coin', 0.9 + r.drawn.kings * 0.08);
    else sfx.tone({ freq: 440, to: 660, dur: 0.08, type: 'triangle', vol: 0.08, delay: 0.03 });
  };

  if (step === 'setup' || !game) {
    return (
      <Screen
        key="setup"
        center={false}
        title="Kings Cup"
        sub="Spread the deck in a ring around the cup. Draw a card and follow its rule. Whoever pulls the fourth king drinks the cup."
        onEnter={() => start(players)}
        actions={
          <Big primary onClick={() => start(players)}>
            Start
          </Big>
        }
      >
        <PlayerList min={0} />
        <HouseRules rules={rules} onChange={setRules} />
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
        sub="What every card means this game."
        onEnter={() => setStep('play')}
        actions={
          <Row>
            <Big onClick={() => setStep('setup')}>End Game</Big>
            <Big primary onClick={() => setStep('play')}>
              Back to the Ring
            </Big>
          </Row>
        }
      >
        <ul className="g-kings-cup-rulelist is-read">
          {rules.map((rule, i) => (
            <li key={i}>
              <div className="g-kings-cup-rule">
                <RuleText rank={i + 1} rule={rule} />
              </div>
            </li>
          ))}
        </ul>
      </Screen>
    );

  if (step === 'cup') {
    const again = () => start(table, game.turn);
    const seat = cur?.seat ?? null;
    return (
      <Screen
        key="cup"
        className="g-kings-cup-final"
        onEnter={again}
        actions={
          <>
            <Big primary onClick={again}>
              New Game
            </Big>
            <Big onClick={() => setStep('setup')}>Change Setup</Big>
          </>
        }
      >
        <Confetti />
        <div className="g-kings-cup-trophy">
          <svg viewBox="-56 -66 112 112" aria-hidden="true">
            <Cup level={1} full />
          </svg>
          {cur && (
            <div className="g-kings-cup-card is-final">
              <div className="g-kings-cup-face">
                <CardFace card={cur.card} />
              </div>
            </div>
          )}
        </div>
        <p className="arcade-party-kicker">The Fourth King</p>
        <h2 className="arcade-party-title is-huge">Drink the Cup!</h2>
        {seat !== null ? (
          <p className="g-kings-cup-winner">
            <Avatar name={name(seat)} index={seat} size={30} />
            <span>
              <b>{name(seat)}</b> pulled it. The whole cup is theirs.
            </span>
          </p>
        ) : (
          <p className="arcade-party-sub">Whoever pulled it drinks the whole cup. Bottoms up, or sips if you're sensible.</p>
        )}
        <p className="g-kings-cup-stat">
          {game.drawn.length} cards drawn
          {game.made.length ? `, ${game.made.length} ${game.made.length === 1 ? 'rule' : 'rules'} made` : ''}
          {game.mates.length ? `, ${mateGroups(game.mates).length === 1 ? 'one set' : `${mateGroups(game.mates).length} sets`} of mates` : ''}
        </p>
      </Screen>
    );
  }

  const nextName = game.seats ? name(game.turn) : null;
  const rule = cur ? ruleFor(rules, cur.card.rank) : null;
  const fresh = !!cur && cur.n !== flipped.current;
  const drawerMates = cur && cur.seat !== null ? matesOf(cur.mateBase, cur.seat) : [];
  const chosenMate = cur && cur.seat !== null && cur.card.rank === 8 ? game.mates.find((p) => !cur.mateBase.includes(p)) : undefined;
  const groups = mateGroups(game.mates);
  const master = game.master;

  return (
    <Screen
      key="play"
      className="g-kings-cup-play"
      onEnter={() => pull()}
      actions={
        <Row>
          <Big className="g-kings-cup-rules-btn" onClick={() => setStep('rules')}>
            Rules
          </Big>
          <Big primary onClick={() => pull()}>
            {nextName ? `Draw for ${nextName}` : 'Draw'}
          </Big>
        </Row>
      }
    >
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
                  <div className="g-kings-cup-back" />
                </div>
              ) : (
                <div className="g-kings-cup-back is-idle" />
              )}
            </div>
            <div className="g-kings-cup-say" key={cur?.n ?? 'idle'}>
              {cur && rule ? (
                <>
                  <p className="g-kings-cup-who">
                    {cur.seat !== null ? (
                      <>
                        <Avatar name={name(cur.seat)} index={cur.seat} size={20} />
                        <span>{name(cur.seat)}'s Turn</span>
                      </>
                    ) : (
                      <span>{cardName(cur.card)}</span>
                    )}
                  </p>
                  <h3>{rule.name}</h3>
                  {rule.text && <p>{rule.text}</p>}
                  {cur.card.rank === 13 && <p className="g-kings-cup-warn">{cur.kings === LAST_KING - 1 ? 'Three down. The next king drinks the cup.' : `King ${cur.kings} of ${LAST_KING}.`}</p>}
                </>
              ) : (
                <>
                  <p className="g-kings-cup-who">
                    {nextName ? (
                      <>
                        <Avatar name={nextName} index={game.turn} size={20} />
                        <span>{nextName} goes first</span>
                      </>
                    ) : (
                      <span>52 cards, 4 kings</span>
                    )}
                  </p>
                  <h3>Draw a Card</h3>
                  <p>Tap a card in the ring, or the button below. Every card has a rule.</p>
                </>
              )}
            </div>
          </div>

          {cur && cur.card.rank === 11 && !cur.madeRule && (
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
                placeholder="Write the rule (optional)"
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

          {cur && cur.card.rank === 8 && cur.seat !== null && game.seats > 1 && (
            <div className="arcade-party-field g-kings-cup-mates">
              <span>Pick a Mate for {name(cur.seat)}</span>
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
            {master && (
              <li>
                <span className="g-kings-cup-tag">Q</span>
                {master.seat !== null ? (
                  <span>
                    Question Master: <b>{name(master.seat)}</b>
                  </span>
                ) : (
                  <span>
                    Question Master: whoever drew the{' '}
                    <b className={`g-kings-cup-inline ${isRed(master.card) ? 'is-red' : ''}`}>
                      Q<SuitIcon suit={master.card.suit} />
                    </b>
                  </span>
                )}
              </li>
            )}
            {groups.map((g) => (
              <li key={g.join('-')}>
                <span className="g-kings-cup-tag">8</span>
                <span>
                  <b>{listNames(g.map(name))}</b> are mates
                </span>
              </li>
            ))}
            {game.made.map((r, i) => (
              <li key={`${i}-${r}`} className="is-rule">
                <span className="g-kings-cup-tag">J</span>
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
