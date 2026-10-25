import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, defineSetting, getSetting, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { ANSWERS } from './answers';
import {
  TRIES,
  WORD,
  currentStreak,
  dailyIndex,
  dayNumber,
  emptyStats,
  formatWait,
  hardModeMiss,
  letterStates,
  msUntilNextDay,
  pacificDate,
  pickLayout,
  practiceIndex,
  recordDaily,
  score,
  shareText,
  unpack,
  tileFit,
  type Layout,
  type Mark,
  type Stats,
} from './logic';
import { meta } from './meta';
import './wordguess.css';

type Mode = 'daily' | 'practice';
type Daily = { date: string; guesses: string[]; counted?: boolean };

const MODE_KEY = 'arcade:wordguess:mode';
const DAILY_KEY = 'arcade:wordguess:daily';
const STATS_KEY = 'arcade:wordguess:stats';
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const FLIP = 0.5;
const STAGGER = 0.3;
const ROW_TIME = STAGGER * (WORD - 1) + FLIP;
const PRAISE = ['Unreal', 'Brilliant', 'Sharp', 'Nice One', 'Solid', 'Close One'];
const FILL: Record<Mark, string> = { correct: '#248a3d', present: '#c48a12', absent: '#3a3a40' };
const ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
const SAY: Record<Mark, string> = { correct: 'green', present: 'gold', absent: 'grey' };
const HARD = defineSetting('wordguess:hard', ['off', 'on'] as const, 'off');

const LIST = unpack(ANSWERS);
const ANSWER_SET = new Set(LIST);
let extra: Promise<Set<string>> | null = null;
/** The bigger guess list is its own chunk, fetched on first open. */
const loadExtra = () =>
  (extra ??= import('./guesses').then(
    (m) => new Set(unpack(m.GUESSES)),
    (err) => {
      extra = null;
      throw err;
    },
  ));

function read<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
const readMode = (): Mode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'practice' ? 'practice' : 'daily';
  } catch {
    return 'daily';
  }
};
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

function Setup() {
  const [hard, setHard] = useSetting(HARD);
  return (
    <Segmented
      label="Hard Mode"
      value={hard}
      options={[
        ['off', 'Off'],
        ['on', 'On'],
      ]}
      onChange={setHard}
    />
  );
}

function Play() {
  const shell = useShell();
  const [mode, setMode] = useState<Mode>(readMode);
  const [n, setN] = useState(0);
  const pick = (m: Mode) => {
    write(MODE_KEY, m);
    sfx.play('select');
    if (m === mode) setN((x) => x + 1);
    else setMode(m);
    shell.root.current?.focus({ preventScroll: true });
  };
  return <Round key={`${mode}-${n}`} mode={mode} pick={pick} />;
}

type Toast = { text: string; id: number; sticky?: boolean };
type Fit = Layout & { top: number; ctrlH: number };

function Round({ mode, pick }: { mode: Mode; pick: (m: Mode) => void }) {
  const shell = useShell();
  const { ref, size, ctx } = useCanvas();
  const [, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const daily = mode === 'daily';
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const pendingGuess = useRef<{ word: string; ok: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const modesRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<Fit>({ side: false, modesRow: false, boardW: 0, tile: 0, top: 54, ctrlH: 34 });
  const [u, setU] = useState(1);

  const s = useRef<{
    today: string;
    day: number;
    answer: string;
    rows: string[];
    marks: Mark[][];
    cur: string;
    t: number;
    typed: number[];
    revealRow: number;
    revealT0: number;
    shown: number;
    shakeT0: number;
    bounceRow: number;
    bounceT0: number;
    busy: boolean;
    finished: boolean;
    alreadyDone: boolean;
    events: { at: number; fn: () => void }[];
    toastUntil: number;
    alive: boolean;
    hit: string;
    hitT: number;
    clockAt: number;
    wait: string;
    stale: boolean;
  } | null>(null);
  if (!s.current) {
    const today = pacificDate();
    const day = dayNumber(today);
    const answer = LIST[daily ? dailyIndex(day, LIST.length) : practiceIndex(day, LIST.length)];
    const saved = daily ? read<Daily | null>(DAILY_KEY, null) : null;
    const rows = saved && saved.date === today ? saved.guesses.filter((g) => /^[a-z]{5}$/.test(g)).slice(0, TRIES) : [];
    const won = rows.indexOf(answer);
    if (won >= 0) rows.length = won + 1;
    const done = won >= 0 || rows.length >= TRIES;
    s.current = {
      today,
      day,
      answer,
      rows,
      marks: rows.map((g) => score(g, answer)),
      cur: '',
      t: 0,
      typed: [],
      revealRow: -1,
      revealT0: 0,
      shown: rows.length,
      shakeT0: -9,
      bounceRow: -1,
      bounceT0: -9,
      busy: done,
      finished: done,
      alreadyDone: done,
      events: [],
      toastUntil: Infinity,
      alive: true,
      hit: '',
      hitT: -9,
      clockAt: 0,
      wait: formatWait(msUntilNextDay()),
      stale: false,
    };
  }
  const st = s.current;
  const bump = () => setVersion((v) => v + 1);
  const later = (delay: number, fn: () => void) => st.events.push({ at: st.t + delay, fn });
  const say = (text: string, dur = 1.4) => {
    setToast({ text, id: st.t + Math.random(), sticky: !Number.isFinite(dur) });
    st.toastUntil = st.t + dur;
  };

  useEffect(() => {
    st.alive = true;
    void loadExtra().catch(() => {});
    // A daily finished on the last flip, then closed before the stats were saved: count it now, once.
    if (daily && st.alreadyDone) {
      const saved = read<Daily | null>(DAILY_KEY, null);
      if (saved && saved.date === st.today && !saved.counted) {
        const won = st.rows.includes(st.answer);
        write(STATS_KEY, recordDaily(read<Stats>(STATS_KEY, emptyStats()), st.day, won ? st.rows.length : 0));
        write(DAILY_KEY, { date: st.today, guesses: st.rows, counted: true } satisfies Daily);
        bump();
      }
    }
    return () => {
      st.alive = false;
    };
  }, [st, daily]);

  // Board over keyboard, or side by side when the game area is short and wide (the framed laptop window).
  // Touch frames (iPad) are scaled down to fit, so touch sizes grow by --g-wordguess-u to stay finger sized.
  const status = shell.status;
  useEffect(() => {
    const wrap = wrapRef.current;
    const root = shell.root.current;
    if (!wrap || !root) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let unit = 1;
        if (shell.touch) {
          const k = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
          unit = k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1;
          root.style.setProperty('--g-wordguess-u', String(unit));
        }
        setU((v) => (v === unit ? v : unit));
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (!w || !h) return;
        const ctrl = root.querySelector<HTMLElement>('.arcade-ctrl');
        const btn = ctrl?.querySelector<HTMLElement>('button');
        // Pause and Restart join the controls once a round is under way.
        const extra = statusRef.current === 'playing' || statusRef.current === 'paused' ? 0 : 2 * ((btn?.offsetWidth ?? 28) + 2);
        const ctrlW = (ctrl?.offsetWidth ?? 172) + extra;
        const ctrlH = ctrl?.offsetHeight ?? 34;
        const top = 10 + ctrlH + 8;
        const keyH = shell.touch ? Math.min(58 * unit, Math.max(42 * unit, 0.084 * h)) : Math.min(56, Math.max(34, 0.084 * h));
        const keysH = st.alreadyDone ? 150 : 3 * keyH + 12;
        const next = { ...pickLayout(w, h, { modesW: modesRef.current?.offsetWidth ?? 130, ctrlW, top, keysH, cap: Math.round(64 * unit) }), top, ctrlH };
        setFit((f) => (f.side === next.side && f.modesRow === next.modesRow && f.boardW === next.boardW && f.top === next.top && f.ctrlH === next.ctrlH ? f : next));
      });
    };
    measure();
    // The phone and iPad frames animate in, and a transform never fires a resize, so look again once it settles.
    const settle = window.setTimeout(measure, 700);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shell.root, shell.touch, status, st]);
  useEffect(() => {
    const root = shell.root.current;
    return () => {
      root?.style.removeProperty('--g-wordguess-u');
    };
  }, [shell.root]);

  const canType = () => shell.status === 'playing' && !st.busy && !st.finished;

  const flash = (k: string) => {
    st.hit = k;
    const t0 = (st.hitT = st.t);
    later(0.12, () => {
      if (st.hitT !== t0) return;
      st.hit = '';
      bump();
    });
  };
  const type = (ch: string) => {
    if (!canType() || st.cur.length >= WORD) return;
    st.cur += ch;
    st.typed[st.cur.length - 1] = st.t;
    sfx.play('tick', 0.9 + st.cur.length * 0.06);
    bump();
  };
  const back = () => {
    if (!canType() || !st.cur) return;
    st.cur = st.cur.slice(0, -1);
    sfx.play('tick', 0.7);
    bump();
  };
  const reject = (text: string) => {
    st.shakeT0 = st.t;
    sfx.play('hit', 1.4);
    say(text);
  };

  const applySubmit = (word: string, ok: boolean) => {
    if (!st.alive) return;
    st.busy = false;
    if (st.cur !== word) return;
    if (!ok) return reject('Not in Word List');
    const miss = getSetting(HARD) === 'on' ? hardModeMiss(word, st.rows, st.marks) : null;
    if (miss) return reject(miss);
    st.busy = true;
    const marks = score(word, st.answer);
    st.rows.push(word);
    st.marks.push(marks);
    st.cur = '';
    st.revealRow = st.rows.length - 1;
    st.revealT0 = st.t;
    if (daily) write(DAILY_KEY, { date: st.today, guesses: st.rows } satisfies Daily);
    marks.forEach((m, i) =>
      later(i * STAGGER + FLIP / 2, () => sfx.tone({ freq: m === 'correct' ? 880 : m === 'present' ? 660 : 330, dur: 0.07, type: 'triangle', vol: 0.12 })),
    );
    later(ROW_TIME, () => {
      st.shown = st.rows.length;
      st.busy = false;
      const won = word === st.answer;
      if (won || st.rows.length >= TRIES) finish(won);
      bump();
    });
    bump();
  };

  const finish = (won: boolean) => {
    st.finished = true;
    const tries = st.rows.length;
    let detail: string;
    let streak: number | undefined;
    if (daily) {
      const stats = recordDaily(read<Stats>(STATS_KEY, emptyStats()), st.day, won ? tries : 0);
      write(STATS_KEY, stats);
      if (won) streak = stats.streak;
      write(DAILY_KEY, { date: st.today, guesses: st.rows, counted: true } satisfies Daily);
      write(MODE_KEY, 'practice');
      const wait = formatWait(msUntilNextDay());
      detail = won
        ? `Solved in ${tries}/${TRIES}. Streak ${stats.streak}. Next word in ${wait}.`
        : `The word was ${st.answer.toUpperCase()}. Next word in ${wait}.`;
    } else detail = won ? `Solved in ${tries}/${TRIES}.` : `The word was ${st.answer.toUpperCase()}.`;
    if (won) {
      st.bounceRow = tries - 1;
      st.bounceT0 = st.t;
      sfx.play('win');
      say(PRAISE[tries - 1], 1.6);
    } else {
      sfx.play('lose');
      say(st.answer.toUpperCase(), Infinity);
    }
    later(1.7, () => {
      // Today's stats wait under the Game Over card instead of a keyboard nobody can use.
      if (daily) st.alreadyDone = true;
      bump();
      shell.gameOver(undefined, { title: won ? PRAISE[tries - 1] : 'So Close', detail, rank: streak });
    });
  };

  const submit = async () => {
    if (!canType()) return;
    if (st.cur.length < WORD) return reject('Not Enough Letters');
    const word = st.cur;
    st.busy = true;
    let ok = ANSWER_SET.has(word);
    if (!ok) {
      try {
        ok = (await loadExtra()).has(word);
      } catch {
        ok = true; // offline: never block a guess because the list couldn't load
      }
    }
    if (!st.alive) return;
    if (statusRef.current !== 'playing') {
      pendingGuess.current = { word, ok };
      return;
    }
    applySubmit(word, ok);
  };

  useEffect(() => {
    const pending = pendingGuess.current;
    if (statusRef.current !== 'playing' || !pending || !st.alive) return;
    pendingGuess.current = null;
    applySubmit(pending.word, pending.ok);
  }, [shell.status, st]);

  const copy = async () => {
    const text = shareText(st.day, st.rows, st.answer, getSetting(HARD) === 'on');
    try {
      if (shell.touch && typeof navigator.share === 'function') {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      sfx.play('select');
      say('Copied');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') say("Couldn't Copy");
    }
  };

  // The shell reserves P for pause; in a word game it has to type a letter instead (Esc still pauses).
  const typeRef = useRef(type);
  typeRef.current = (ch: string) => {
    if (canType()) flash(ch);
    type(ch);
  };
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyP' || e.metaKey || e.ctrlKey || e.altKey || statusRef.current !== 'playing') return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      typeRef.current('p');
    };
    el.addEventListener('keydown', onKey, true);
    return () => el.removeEventListener('keydown', onKey, true);
  }, [shell.root]);

  useKeys((code, e) => {
    if (/^Key[A-Z]$/.test(code)) return typeRef.current(code[3].toLowerCase());
    if (code === 'Backspace' || code === 'Delete') {
      if (canType() && st.cur) flash('-');
      return back();
    }
    if ((code === 'Enter' || code === 'NumpadEnter') && !e?.repeat) {
      if (canType()) flash('+');
      void submit();
    }
  });

  useGameLoop(
    (dt) => {
      st.t += dt;
      if (st.events.length) {
        const due = st.events.filter((ev) => ev.at <= st.t);
        if (due.length) {
          st.events = st.events.filter((ev) => ev.at > st.t);
          due.forEach((ev) => ev.fn());
        }
      }
      if (st.t >= st.toastUntil) {
        st.toastUntil = Infinity;
        setToast(null);
      }
      // Keep the countdown honest, and offer the new word once midnight passes in California.
      if (daily && st.alreadyDone) {
        const now = performance.now();
        if (now - st.clockAt > 1000) {
          st.clockAt = now;
          const wait = formatWait(msUntilNextDay());
          const stale = pacificDate() !== st.today;
          if (wait !== st.wait || stale !== st.stale) {
            st.wait = wait;
            st.stale = stale;
            bump();
          }
        }
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      c.clearRect(0, 0, w, h);
      const ts = tileFit(w, h, Math.round(64 * u));
      if (ts <= 4) return;
      const gap = Math.max(2, Math.round(ts * 0.1));
      const bw = WORD * ts + (WORD - 1) * gap;
      const bh = TRIES * ts + (TRIES - 1) * gap;
      const x0 = Math.round((w - bw) / 2);
      const y0 = Math.round((h - bh) / 2);
      const t = st.t;
      const cursor = shell.status === 'playing' && !st.busy && !st.finished ? st.cur.length : -1;
      for (let r = 0; r < TRIES; r++) {
        const submitted = r < st.rows.length;
        const word = submitted ? st.rows[r] : r === st.rows.length ? st.cur : '';
        let shake = 0;
        if (r === st.rows.length) {
          const p = (t - st.shakeT0) / 0.4;
          if (p >= 0 && p < 1) shake = Math.sin(p * Math.PI * 7) * ts * 0.12 * (1 - p);
        }
        for (let i = 0; i < WORD; i++) {
          const letter = word[i] ?? '';
          let state: Mark | 'typed' | 'empty' | 'next' = letter ? 'typed' : r === st.rows.length && i === cursor ? 'next' : 'empty';
          let sy = 1;
          let scale = 1;
          let dy = 0;
          let glow = 0;
          if (submitted) {
            state = st.marks[r][i];
            if (r === st.revealRow) {
              const p = (t - st.revealT0 - i * STAGGER) / FLIP;
              if (p < 1) {
                sy = p <= 0 ? 1 : Math.abs(Math.cos(p * Math.PI));
                if (p < 0.5) state = 'typed';
              }
            }
            if (r === st.bounceRow) {
              const p = (t - st.bounceT0 - i * 0.1) / 0.4;
              if (p > 0 && p < 1) dy = -Math.sin(p * Math.PI) * ts * 0.3;
              glow = Math.min(1, Math.max(0, (t - st.bounceT0) / 0.5));
            }
          } else if (letter && r === st.rows.length) {
            const p = (t - (st.typed[i] ?? -9)) / 0.12;
            if (p >= 0 && p < 1) scale = 1 + 0.1 * Math.sin(p * Math.PI);
          }
          tile(c, x0 + i * (ts + gap) + ts / 2 + shake, y0 + r * (ts + gap) + ts / 2 + dy, ts, state, letter, scale, sy, glow);
        }
      }
    },
  );

  const keyState = letterStates(st.rows.slice(0, st.shown), st.answer);
  const doneCard = st.alreadyDone;
  const solvedIn = st.rows.includes(st.answer) ? st.rows.length : 0;
  const last = st.shown > 0 ? st.rows[st.shown - 1] : '';
  const spoken = last ? `${last}: ${score(last, st.answer).map((m, i) => `${last[i]} ${SAY[m]}`).join(', ')}` : '';

  const modes = (
    <div
      ref={modesRef}
      className={`arcade-seg g-wordguess-modes ${fit.modesRow ? 'is-row' : ''}`}
      style={fit.modesRow ? { top: fit.top } : fit.side ? { height: fit.ctrlH } : undefined}
      role="group"
      aria-label="Mode"
    >
      {(['daily', 'practice'] as Mode[]).map((m) => (
        <button key={m} type="button" aria-pressed={m === mode} onPointerDown={keepFocus} onClick={() => pick(m)}>
          {m === 'daily' ? 'Daily' : 'Practice'}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={`g-wordguess-wrap ${shell.touch ? 'is-touch' : ''} ${fit.side ? 'is-side' : ''}`}
      style={fit.side ? undefined : { paddingTop: fit.top + (fit.modesRow ? (modesRef.current?.offsetHeight ?? 34) + 8 : 0) }}
    >
      <div className="g-wordguess-board" style={fit.side ? { flexBasis: fit.boardW } : undefined}>
        <canvas ref={ref} aria-label="Guesses" />
        {toast && (
          <div key={toast.id} className={`g-wordguess-toast ${toast.sticky ? 'is-sticky' : ''}`} role="status">
            {toast.text}
          </div>
        )}
        <div className="g-wordguess-sr" aria-live="polite">
          {spoken}
        </div>
      </div>
      <div className="g-wordguess-panel">
        {modes}
        {doneCard ? (
          <Done
            stale={st.stale}
            solvedIn={solvedIn}
            answer={st.answer}
            wait={st.wait}
            day={st.day}
            onPractice={() => pick('practice')}
            onToday={() => pick('daily')}
            onCopy={() => void copy()}
          />
        ) : (
          <div className="g-wordguess-keys" aria-label="Keyboard">
            {ROWS.map((row) => (
              <div key={row} className="g-wordguess-row">
                {[...row].map((k) =>
                  k === '+' ? (
                    <button key={k} type="button" className={`is-wide ${st.hit === k ? 'is-hit' : ''}`} onPointerDown={keepFocus} onClick={() => void submit()}>
                      Enter
                    </button>
                  ) : k === '-' ? (
                    <button key={k} type="button" className={`is-wide ${st.hit === k ? 'is-hit' : ''}`} onPointerDown={keepFocus} onClick={back} aria-label="Delete">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12 9.5l5 5M17 9.5l-5 5" />
                      </svg>
                    </button>
                  ) : (
                    <button key={k} type="button" className={st.hit === k ? 'is-hit' : undefined} data-state={keyState[k]} onPointerDown={keepFocus} onClick={() => type(k)}>
                      {k}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Done(p: { stale: boolean; solvedIn: number; answer: string; wait: string; day: number; onPractice(): void; onToday(): void; onCopy(): void }) {
  const stats = read<Stats>(STATS_KEY, emptyStats());
  const dist = stats.dist.length === TRIES ? stats.dist : emptyStats().dist;
  const most = Math.max(1, ...dist);
  const items: [string, string | number][] = [
    ['Played', stats.played],
    ['Win Rate', stats.played ? `${Math.round((stats.wins / stats.played) * 100)}%` : '0%'],
    ['Streak', currentStreak(stats, p.day)],
    ['Best Streak', stats.max],
  ];
  return (
    <div className="g-wordguess-done">
      <b>{p.stale ? 'A New Word Is Ready' : "Today's Word Is Done"}</b>
      <span>
        {p.solvedIn ? `Solved in ${p.solvedIn}/${TRIES}.` : `It was ${p.answer.toUpperCase()}.`}
        {p.stale ? '' : ` Next word in ${p.wait}.`}
      </span>
      <div className="g-wordguess-stats">
        {items.map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="g-wordguess-dist" aria-label="Guess Distribution">
        {dist.map((count, i) => (
          <div key={i} className={`g-wordguess-bar ${p.solvedIn === i + 1 ? 'is-today' : ''}`}>
            <span>{i + 1}</span>
            <i style={{ width: `${Math.max(8, (count / most) * 100)}%` }}>{count}</i>
          </div>
        ))}
      </div>
      <div className="g-wordguess-actions">
        {p.stale ? (
          <button type="button" className="arcade-btn arcade-btn-primary" onPointerDown={keepFocus} onClick={p.onToday}>
            Play Today's Word
          </button>
        ) : (
          <>
            <button type="button" className="arcade-btn arcade-btn-primary" onPointerDown={keepFocus} onClick={p.onPractice}>
              Play Practice
            </button>
            <button type="button" className="arcade-btn" onPointerDown={keepFocus} onClick={p.onCopy}>
              Copy Result
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function tile(c: CanvasRenderingContext2D, cx: number, cy: number, ts: number, state: Mark | 'typed' | 'empty' | 'next', letter: string, scale: number, sy: number, glow = 0) {
  const half = ts / 2;
  const radius = Math.max(3, ts * 0.12);
  c.save();
  c.translate(cx, cy);
  c.scale(scale, scale * Math.max(0.001, sy));
  c.beginPath();
  c.roundRect(-half, -half, ts, ts, radius);
  if (state === 'empty' || state === 'next') {
    c.fillStyle = 'rgba(255,255,255,0.025)';
    c.fill();
    c.strokeStyle = state === 'next' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.13)';
    c.lineWidth = 1.5;
    c.stroke();
  } else if (state === 'typed') {
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.lineWidth = 1.5;
    c.stroke();
  } else {
    if (glow > 0) {
      c.shadowColor = `rgba(48, 209, 88, ${0.55 * glow})`;
      c.shadowBlur = ts * 0.35 * glow;
    }
    c.fillStyle = FILL[state];
    c.fill();
    c.shadowBlur = 0;
    const g = c.createLinearGradient(0, -half, 0, half);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fill();
  }
  if (letter) {
    c.fillStyle = '#f5f5f7';
    c.font = `700 ${Math.round(ts * 0.5)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(letter.toUpperCase(), 0, ts * 0.035);
  }
  c.restore();
}
