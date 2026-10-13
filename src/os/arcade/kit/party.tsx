// Building blocks for the pass-the-phone group and drinking games: a shared player list, full-screen steps,
// a "pass to" handoff, option rows, chips and a countdown. Styles live in party.css under .arcade-party-*.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Segmented } from './controls';
import { useKeys } from './keys';
import { useGameLoop } from './loop';
import { useShell } from './shell';
import { sfx } from './sfx';
import { PLAYERS_MAX, PLAYER_NAME_MAX, Pile, addPlayer, clock, tidyRoster } from './party-core';
import './party.css';

export * from './party-core';

const subs = new Set<() => void>();
const memory = new Map<string, string | null>();
const storageKey = (key: string) => `arcade:${key}`;

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  let v: string | null = null;
  try {
    v = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey(key));
  } catch {
    v = null;
  }
  memory.set(key, v);
  return v;
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(storageKey(key), value);
  } catch {
    /* private mode: kept in memory only */
  }
  subs.forEach((f) => f());
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * A JSON value remembered on this device under `arcade:<key>`, for choices a Setting can't hold (a list of names,
 * a set of decks, house rules). `parse` turns whatever was stored into a valid value, or the fallback.
 */
export function useStored<T>(key: string, fallback: T, parse: (raw: unknown) => T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return parse(JSON.parse(raw));
    } catch {
      return fallback;
    }
    // fallback and parse are module constants, so the stored text alone decides the value.
  }, [raw]);
  const set = useCallback((v: T) => writeRaw(key, JSON.stringify(v)), [key]);
  return [value, set];
}

/** The roster every group and drinking game shares, in seating order. */
export function usePlayers(): [string[], (players: string[]) => void] {
  return useStored<string[]>('party:players', [], tidyRoster);
}

const AVATAR_COLORS = ['#ff453a', '#ff9f0a', '#e4b400', '#30d158', '#40c8e0', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#a2845e', '#00b39b', '#ff6b3d'];
export const playerColor = (i: number) => AVATAR_COLORS[((i % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];

export function Avatar({ name, index, size = 28 }: { name: string; index: number; size?: number }) {
  return (
    <span className="arcade-party-avatar" style={{ background: playerColor(index), width: size, height: size, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      {Array.from(name)[0]?.toLocaleUpperCase() ?? '?'}
    </span>
  );
}

/**
 * One full-screen step of a party game: a title, a scrollable body and big buttons pinned to the bottom.
 * Enter or Space runs `onEnter` (usually the primary button). Key each step (`key={step}`) so focus returns
 * to the game after the button that led here disappears.
 */
export function Screen({
  kicker,
  title,
  sub,
  children,
  actions,
  onEnter,
  className,
  center = true,
  arm = 450,
}: {
  /** A short line above the title, like "Pass the phone to". */
  kicker?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onEnter?: () => void;
  className?: string;
  /** Center the body vertically (default). Lists that grow read better from the top. */
  center?: boolean;
  /** Milliseconds after the step appears before taps, Enter or Space count, so a double press can't skip it. */
  arm?: number;
}) {
  const shell = useShell();
  const enter = useRef(onEnter);
  enter.current = onEnter;
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = performance.now();
  }, []);
  useKeys((code, e) => {
    if (e?.repeat || (code !== 'Enter' && code !== 'Space')) return;
    if (performance.now() - shownAt.current < arm) return;
    enter.current?.();
  });
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) shell.root.current?.focus({ preventScroll: true });
  }, [shell.root]);
  return (
    <div
      className={['arcade-party', className ?? ''].join(' ')}
      onClickCapture={(e) => {
        // A tap meant for the last step can land on this one; swallow taps until it has been up for `arm` ms.
        // Done in JS because reduced motion (rightly) cuts every CSS animation, the old guard included.
        if (performance.now() - shownAt.current < arm) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        // A tapped button shouldn't keep focus, or Space and Enter would press it again instead of reaching onEnter.
        if ((e.target as Element).closest?.('.arcade-party-picks button, .arcade-party-chips button, .arcade-party-actions button')) shell.root.current?.focus({ preventScroll: true });
      }}
    >
      <div className={`arcade-party-body ${center ? 'is-center' : ''}`}>
        {kicker && <p className="arcade-party-kicker">{kicker}</p>}
        {title && <h2 className="arcade-party-title">{title}</h2>}
        {sub && <p className="arcade-party-sub">{sub}</p>}
        {children}
      </div>
      {actions && <div className="arcade-party-actions">{actions}</div>}
    </div>
  );
}

/** When any Big was last pressed. Two presses closer than this are one double tap, not two decisions. */
let lastBig = 0;
const DOUBLE_TAP = 320;

/** A big full-width button. `primary` fills it with the game's accent; `quiet` skips the click when the game plays its own sound. */
export function Big({ children, onClick, primary, disabled, quiet, className }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; quiet?: boolean; className?: string }) {
  return (
    <button
      type="button"
      className={['arcade-party-btn', primary ? 'is-primary' : '', className ?? ''].join(' ')}
      disabled={disabled}
      onClick={() => {
        const now = performance.now();
        if (now - lastBig < DOUBLE_TAP) return;
        lastBig = now;
        if (!quiet) sfx.play('select');
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Two or more buttons side by side. */
export const Row = ({ children }: { children: ReactNode }) => <div className="arcade-party-row">{children}</div>;

/** A "How to play" toggle for a setup step: numbered rules that stay folded until someone asks. */
export function HowToPlay({ steps, label = 'How to Play' }: { steps: readonly ReactNode[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="arcade-party-how">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ol>
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The handoff between secret turns: only the named player should look past this screen. */
export function PassTo({ name, index, note, onReady, label, className }: { name: string; index: number; note?: ReactNode; onReady: () => void; label?: string; className?: string }) {
  return (
    <Screen
      arm={800}
      className={['arcade-party-pass', className ?? ''].join(' ')}
      onEnter={onReady}
      actions={
        <Big primary onClick={onReady}>
          {label ?? `I'm ${name}`}
        </Big>
      }
    >
      <Avatar name={name} index={index} size={72} />
      <p className="arcade-party-kicker">Pass the phone to</p>
      <h2 className="arcade-party-title is-huge">{name}</h2>
      <p className="arcade-party-sub">{note ?? 'No peeking, everyone else.'}</p>
    </Screen>
  );
}

/** Label plus a segmented control, for small choices in a setup step. */
export function Option<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, ReactNode])[]; onChange: (v: T) => void }) {
  return (
    <div className="arcade-party-option">
      <Segmented label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}

/** Toggle chips for picking several things (decks, categories). Keeps at least one on. */
export function Chips<T extends string>({ label, value, options, onChange }: { label?: string; value: readonly T[]; options: readonly (readonly [T, ReactNode])[]; onChange: (v: T[]) => void }) {
  return (
    <div className="arcade-party-field">
      {label && <span>{label}</span>}
      <div className="arcade-party-chips" role="group" aria-label={label}>
        {options.map(([id, text]) => {
          const on = value.includes(id);
          return (
            <button
              type="button"
              key={id}
              aria-pressed={on}
              onClick={() => {
                if (on && value.length === 1) return;
                sfx.play('select');
                onChange(on ? value.filter((v) => v !== id) : options.map(([o]) => o).filter((o) => o === id || value.includes(o)));
              }}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Edits the shared roster: add names in seating order, tap x to remove. */
export function PlayerList({ min, max = PLAYERS_MAX, label = 'Players', emptyHint = 'Optional. Add names to take turns in order.' }: { min: number; max?: number; label?: string; /** Shown when the list is empty and names are optional. */ emptyHint?: string }) {
  const [players, setPlayers] = usePlayers();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const cap = Math.min(max, PLAYERS_MAX);
  const add = () => {
    if (players.length >= cap) return setNote(`Up to ${cap} players.`);
    const r = addPlayer(players, draft);
    if (!r.ok) return setNote(r.reason);
    sfx.play('blip');
    setPlayers(r.players);
    setDraft('');
    setNote('');
    input.current?.focus({ preventScroll: true });
  };
  const hint =
    note ||
    (players.length < min
      ? `Add at least ${min}, in seating order.`
      : !players.length
        ? emptyHint
        : players.length > cap
          ? `This game seats ${cap}. The first ${cap} play.`
          : 'In seating order. Tap a name to remove it.');
  return (
    <div className="arcade-party-field arcade-party-roster">
      <span>
        {label}
        {players.length > 0 && <em>{players.length}</em>}
      </span>
      {players.length > 0 && (
        <ul>
          {players.map((p, i) => (
            <li key={p}>
              <button
                type="button"
                aria-label={`Remove ${p}`}
                title={`Remove ${p}`}
                onClick={() => {
                  sfx.play('hit', 1.4);
                  setPlayers(players.filter((x) => x !== p));
                  setNote('');
                }}
              >
                <Avatar name={p} index={i} size={22} />
                <b>{p}</b>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="arcade-party-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={input}
          className="arcade-input"
          type="text"
          aria-label="Player name"
          placeholder={players.length ? 'Add a player' : 'First player'}
          maxLength={PLAYER_NAME_MAX * 2}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (note) setNote('');
          }}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
          }}
        />
        <button type="submit" className="arcade-btn" disabled={!draft.trim()}>
          Add
        </button>
      </form>
      <small className={note ? 'is-note' : undefined}>{hint}</small>
    </div>
  );
}

/**
 * A countdown that runs only while the game is playing (pausing or hiding the game stops it).
 * `left` is whole seconds for display; `reset(n)` starts over. Ticks for the last five seconds.
 */
export function useCountdown(seconds: number, { running = true, onEnd, tick = true }: { running?: boolean; onEnd?: () => void; tick?: boolean } = {}) {
  const left = useRef(seconds);
  const [shown, setShown] = useState(Math.ceil(seconds));
  const shownRef = useRef(shown);
  const end = useRef(onEnd);
  end.current = onEnd;
  const run = useRef(running);
  run.current = running;
  const reset = useCallback((n: number = seconds) => {
    left.current = n;
    shownRef.current = Math.ceil(n);
    setShown(shownRef.current);
  }, [seconds]);
  useGameLoop((dt) => {
    if (!run.current || left.current <= 0 || dt <= 0) return;
    left.current = Math.max(0, left.current - dt);
    const s = Math.ceil(left.current);
    if (s !== shownRef.current) {
      shownRef.current = s;
      setShown(s);
      if (tick && s > 0 && s <= 5) sfx.play('tick', s === 1 ? 1.3 : 1);
    }
    if (left.current <= 0) end.current?.();
  });
  return { left: shown, reset };
}

/** A ring that empties as a countdown runs, with the time in the middle. */
export function Countdown({ left, total, size = 120, label }: { left: number; total: number; size?: number; label?: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <div className={`arcade-party-timer ${left <= 10 && total > 10 ? 'is-low' : ''}`} style={{ ['--size-base' as string]: `${size}px` }} role="timer" aria-label={label ?? `${clock(left)} left`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="arcade-party-timer-track" />
        <circle cx="50" cy="50" r={r} className="arcade-party-timer-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} opacity={frac > 0 ? 1 : 0} />
      </svg>
      <b>{total >= 60 ? clock(left) : left}</b>
    </div>
  );
}

/** The one line every drinking game shows somewhere on its setup step. */
export function DrinkNote() {
  return <p className="arcade-party-drink">Drinking age only. Sips are plenty, and water counts.</p>;
}

/**
 * A draw pile with history for prompt decks: the first card is dealt at once, next() deals one that hasn't come up
 * since the last reshuffle, back() steps through what was already dealt. Pass a new `items` array for a fresh deck.
 */
export function useDeck<T>(items: readonly T[]) {
  const state = useRef<{ items: readonly T[]; pile: Pile<T>; seen: T[]; pos: number } | null>(null);
  if (!state.current || state.current.items !== items) {
    // Deal the first card right away, so the first frame already shows it.
    const pile = new Pile(items);
    const first = pile.draw();
    state.current = first === undefined ? { items, pile, seen: [], pos: -1 } : { items, pile, seen: [first], pos: 0 };
  }
  const [, redraw] = useState(0);
  const next = useCallback(() => {
    const d = state.current;
    if (!d) return;
    if (d.pos + 1 < d.seen.length) d.pos++;
    else {
      const card = d.pile.draw(d.seen[d.seen.length - 1]);
      if (card === undefined) return;
      d.seen.push(card);
      d.pos = d.seen.length - 1;
    }
    redraw((n) => n + 1);
  }, []);
  const back = useCallback(() => {
    const d = state.current;
    if (!d || d.pos <= 0) return;
    d.pos--;
    redraw((n) => n + 1);
  }, []);
  const d = state.current;
  return { card: d.pos >= 0 ? d.seen[d.pos] : undefined, next, back, canBack: d.pos > 0, dealt: d.pos + 1, total: items.length };
}
