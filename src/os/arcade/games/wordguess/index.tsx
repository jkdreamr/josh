import { useEffect, useRef, useState } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { ANSWERS } from './answers';
import {
  TRIES,
  WORD,
  dailyIndex,
  dayNumber,
  emptyStats,
  formatWait,
  letterStates,
  msUntilNextDay,
  pacificDate,
  practiceIndex,
  recordDaily,
  score,
  unpack,
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
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
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
  return (
    <>
      <div className="arcade-seg g-wordguess-modes" role="group" aria-label="Mode">
        {(['daily', 'practice'] as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={m === mode} onPointerDown={keepFocus} onClick={() => pick(m)}>
            {m === 'daily' ? 'Daily' : 'Practice'}
          </button>
        ))}
      </div>
      <Round key={`${mode}-${n}`} mode={mode} onPractice={() => pick('practice')} />
    </>
  );
}

type Toast = { text: string; id: number; sticky?: boolean };

function Round({ mode, onPractice }: { mode: Mode; onPractice: () => void }) {
  const shell = useShell();
  const { ref, size, ctx } = useCanvas();
  const [, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const daily = mode === 'daily';
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const pendingGuess = useRef<{ word: string; ok: boolean } | null>(null);

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
  } | null>(null);
  if (!s.current) {
    const today = pacificDate();
    const day = dayNumber(today);
    const answer = LIST[daily ? dailyIndex(day, LIST.length) : practiceIndex(day, LIST.length)];
    const saved = daily ? read<Daily | null>(DAILY_KEY, null) : null;
    const rows = saved && saved.date === today ? saved.guesses.filter((g) => /^[a-z]{5}$/.test(g)).slice(0, TRIES) : [];
    const done = rows.includes(answer) || rows.length >= TRIES;
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
    };
  }
  const st = s.current;
  const bump = () => setVersion((v) => v + 1);
  const later = (delay: number, fn: () => void) => st.events.push({ at: st.t + delay, fn });
  const say = (text: string, dur = 1.4) => {
    setToast({ text, id: st.t, sticky: !Number.isFinite(dur) });
    st.toastUntil = st.t + dur;
  };

  useEffect(() => {
    st.alive = true;
    void loadExtra().catch(() => {});
    return () => {
      st.alive = false;
    };
  }, [st]);

  const canType = () => shell.status === 'playing' && !st.busy && !st.finished;

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
    if (st.cur !== word) {
      st.busy = false;
      return;
    }
    st.busy = false;
    if (!ok) return reject('Not in word list');
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
    if (daily) {
      const wait = formatWait(msUntilNextDay());
      const stats = recordDaily(read<Stats>(STATS_KEY, emptyStats()), st.day, won ? tries : 0);
      write(STATS_KEY, stats);
      write(DAILY_KEY, { date: st.today, guesses: st.rows, counted: true } satisfies Daily);
      write(MODE_KEY, 'practice');
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
    later(1.7, () => shell.gameOver(undefined, { title: won ? PRAISE[tries - 1] : 'So Close', detail }));
  };

  const submit = async () => {
    if (!canType()) return;
    if (st.cur.length < WORD) return reject('Not enough letters');
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

  // The shell reserves P for pause; in a word game it has to type a letter instead (Esc still pauses).
  const typeRef = useRef(type);
  typeRef.current = type;
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
    if (/^Key[A-Z]$/.test(code)) return type(code[3].toLowerCase());
    if (code === 'Backspace' || code === 'Delete') return back();
    if ((code === 'Enter' || code === 'NumpadEnter') && !e?.repeat) void submit();
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
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      c.clearRect(0, 0, w, h);
      const ts = Math.floor(Math.min((w - 8) / (WORD + 0.48), (h - 8) / (TRIES + 0.6), 64));
      if (ts <= 4) return;
      const gap = Math.round(ts * 0.1);
      const bw = WORD * ts + (WORD - 1) * gap;
      const bh = TRIES * ts + (TRIES - 1) * gap;
      const x0 = Math.round((w - bw) / 2);
      const y0 = Math.round((h - bh) / 2);
      const t = st.t;
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
          let state: Mark | 'typed' | 'empty' = letter ? 'typed' : 'empty';
          let sy = 1;
          let scale = 1;
          let dy = 0;
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
            }
          } else if (letter && r === st.rows.length) {
            const p = (t - (st.typed[i] ?? -9)) / 0.12;
            if (p >= 0 && p < 1) scale = 1 + 0.1 * Math.sin(p * Math.PI);
          }
          tile(c, x0 + i * (ts + gap) + ts / 2 + shake, y0 + r * (ts + gap) + ts / 2 + dy, ts, state, letter, scale, sy);
        }
      }
    },
  );

  const keyState = letterStates(st.rows.slice(0, st.shown), st.answer);
  const doneCard = st.alreadyDone;
  const solvedIn = st.rows.includes(st.answer) ? st.rows.length : 0;

  return (
    <div className={`g-wordguess-wrap ${shell.touch ? 'is-touch' : ''}`}>
      <div className="g-wordguess-board">
        <canvas ref={ref} aria-label="Guesses" />
        {toast && (
          <div key={toast.id} className={`g-wordguess-toast ${toast.sticky ? 'is-sticky' : ''}`} role="status">
            {toast.text}
          </div>
        )}
      </div>
      {doneCard ? (
        <div className="g-wordguess-done">
          <b>Today's word is done</b>
          <span>
            {solvedIn ? `Solved in ${solvedIn}/${TRIES}` : `It was ${st.answer.toUpperCase()}`}. Next word in {formatWait(msUntilNextDay())}.
          </span>
          <button type="button" className="arcade-btn arcade-btn-primary g-wordguess-cta" onPointerDown={keepFocus} onClick={onPractice}>
            Play Practice
          </button>
        </div>
      ) : (
        <div className="g-wordguess-keys" aria-label="Keyboard">
          {ROWS.map((row) => (
            <div key={row} className="g-wordguess-row">
              {[...row].map((k) =>
                k === '+' ? (
                  <button key={k} type="button" className="is-wide" onPointerDown={keepFocus} onClick={() => void submit()} aria-label="Enter">
                    enter
                  </button>
                ) : k === '-' ? (
                  <button key={k} type="button" className="is-wide" onPointerDown={keepFocus} onClick={back} aria-label="Delete">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12 9.5l5 5M17 9.5l-5 5" />
                    </svg>
                  </button>
                ) : (
                  <button key={k} type="button" data-state={keyState[k]} onPointerDown={keepFocus} onClick={() => type(k)}>
                    {k}
                  </button>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function tile(c: CanvasRenderingContext2D, cx: number, cy: number, ts: number, state: Mark | 'typed' | 'empty', letter: string, scale: number, sy: number) {
  const half = ts / 2;
  const radius = Math.max(3, ts * 0.12);
  c.save();
  c.translate(cx, cy);
  c.scale(scale, scale * Math.max(0.001, sy));
  c.beginPath();
  c.roundRect(-half, -half, ts, ts, radius);
  if (state === 'empty') {
    c.fillStyle = 'rgba(255,255,255,0.025)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.lineWidth = 1.5;
    c.stroke();
  } else if (state === 'typed') {
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.lineWidth = 1.5;
    c.stroke();
  } else {
    c.fillStyle = FILL[state];
    c.fill();
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
