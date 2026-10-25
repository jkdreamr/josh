import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { LEVELS, PEERS, UNITS, boxOf, colOf, completedUnits, conflicts, generate, hintCell, rowOf, type Level, type Puzzle } from './logic';
import { layout, type Box, type Pill } from './layout';
import { meta } from './meta';
import './sudoku.css';

const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const LEVEL = defineSetting('sudoku:level', LEVELS, 'easy');
const LEVEL_OPTIONS = LEVELS.map((l) => [l, LEVEL_LABEL[l]] as const);
const SAVE_KEY = (level: Level) => `arcade:sudoku:save:${level}`;
const HINT_COST = 30;
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const BLUE = '#0a84ff';
const GOLD = '#ffd60a';

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
/** Keeps keyboard focus on the game when a DOM control is clicked. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  erase: 'M20 20H9M5.6 14.6l8-8a2 2 0 0 1 2.8 0l2.9 2.9a2 2 0 0 1 0 2.8L13 18.6a2 2 0 0 1-1.4.6H9.4a2 2 0 0 1-1.4-.6l-2.4-2.4a2 2 0 0 1 0-2.8zM10 10l5 5',
  notes: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l3 3',
  hint: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
};

type Saved = { puzzle: number[]; solution: number[]; grid: number[]; notes: number[]; hinted: number[]; time: number; hints: number };

function readSave(level: Level): Saved | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(SAVE_KEY(level)) || 'null') as Saved | null;
    const ok81 = (a: unknown) => Array.isArray(a) && a.length === 81 && a.every((n) => Number.isInteger(n));
    if (!v || !ok81(v.puzzle) || !ok81(v.solution) || !ok81(v.grid) || !ok81(v.notes) || !Array.isArray(v.hinted)) return null;
    if (!Number.isFinite(v.time) || v.time < 0 || v.grid.every((n, i) => n === v.solution[i])) return null;
    if (v.puzzle.some((n, i) => n && n !== v.solution[i])) return null;
    return { ...v, hints: Number.isFinite(v.hints) ? v.hints : 0 };
  } catch {
    return null;
  }
}
function writeSave(level: Level, v: Saved | null) {
  try {
    if (v) window.localStorage.setItem(SAVE_KEY(level), JSON.stringify(v));
    else window.localStorage.removeItem(SAVE_KEY(level));
  } catch {
    /* private mode or full */
  }
}

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  return <Segmented label="Level" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />;
}

function Play() {
  const shell = useShell();
  const [chosen] = useSetting(LEVEL);
  const [level, setLevel] = useState(chosen);
  // The level only changes between rounds: on the Start card, or on Restart and Play Again (which remount this).
  useEffect(() => {
    if (shell.status === 'ready') setLevel(chosen);
  }, [chosen, shell.status]);
  return <Round key={level} level={level} />;
}

type Wave = { cells: number[]; from: number; t0: number };
type Snapshot = { grid: number[]; notes: number[]; sel: number; hinted: number[] };

/** How much the device frame scales the game down (iPad), so touch targets and text can grow back. */
function useFrameScale(el: HTMLElement | null, on: boolean) {
  const [u, setU] = useState(1);
  useEffect(() => {
    if (!el || !on) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const next = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-sudoku-u', next.toFixed(3));
        setU((p) => (Math.abs(p - next) > 0.01 ? next : p));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-sudoku-u');
    };
  }, [el, on]);
  return on ? u : 1;
}

/** Where the shell's pause/restart pill sits, so the layout can keep clear of it. */
function usePill(root: HTMLElement | null, status: string) {
  const [pill, setPill] = useState<Pill>(null);
  useLayoutEffect(() => {
    if (!root) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ctrl = root.querySelector<HTMLElement>(':scope > .arcade-ctrl, .arcade-ctrl');
        if (!ctrl || !root.offsetWidth) return setPill(null);
        const k = root.getBoundingClientRect().width / root.offsetWidth || 1;
        const a = root.getBoundingClientRect();
        const b = ctrl.getBoundingClientRect();
        const next = { left: Math.round((b.left - a.left) / k), bottom: Math.round((b.bottom - a.top) / k) };
        setPill((p) => (p && p.left === next.left && p.bottom === next.bottom ? p : next));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const ctrl = root.querySelector('.arcade-ctrl');
    if (ctrl) ro.observe(ctrl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [root, status]);
  return pill;
}

const at = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });

function Round({ level }: { level: Level }) {
  const shell = useShell();
  const wrap = useCanvas<HTMLDivElement>();
  const { ref, size, ctx } = useCanvas();
  const { best, submit } = useHighScore(`sudoku-${level}`, { lowerIsBetter: true });
  const [ready, setReady] = useState(false);
  const [notesMode, setNotesMode] = useState(false);
  const [secs, setSecs] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [, setVersion] = useState(0);
  const firstRound = useRef(shell.round === 0).current;
  const s = useRef({
    puzzle: [] as number[],
    grid: [] as number[],
    solution: [] as number[],
    given: [] as boolean[],
    hinted: new Set<number>(),
    hints: 0,
    notes: [] as number[],
    sel: 40,
    hover: -1,
    gx: 4,
    gy: 4,
    conflict: new Set<number>(),
    history: [] as Snapshot[],
    t: 0,
    time: 0,
    lastNow: 0,
    savedAt: 0,
    pops: new Map<number, number>(),
    shakes: new Map<number, number>(),
    glows: new Map<number, number>(),
    waves: [] as Wave[],
    won: -1,
    ended: false,
    dirty: true,
    drawn: '',
  }).current;
  const locked = (i: number) => s.given[i] || s.hinted.has(i);

  const save = () => {
    if (!s.grid.length || s.won >= 0) return;
    s.savedAt = s.time;
    writeSave(level, { puzzle: s.puzzle, solution: s.solution, grid: s.grid, notes: s.notes, hinted: [...s.hinted], time: s.time, hints: s.hints });
  };
  const bump = () => {
    s.dirty = true;
    save();
    setVersion((v) => v + 1);
    shell.invalidate();
  };

  // Puzzle generation runs in a worker; the sync path is only a fallback when workers are unavailable.
  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    const accept = (p: Puzzle, saved?: Saved | null) => {
      if (!alive) return;
      s.puzzle = p.puzzle.slice();
      s.solution = p.solution;
      s.given = p.puzzle.map((v) => v > 0);
      s.grid = saved ? saved.grid.slice() : p.puzzle.slice();
      s.notes = saved ? saved.notes.slice() : new Array(81).fill(0);
      s.hinted = new Set(saved ? saved.hinted.filter((i) => i >= 0 && i < 81) : []);
      s.hints = saved?.hints ?? 0;
      s.time = saved?.time ?? 0;
      s.conflict = conflicts(s.grid);
      const open = s.grid.indexOf(0, 36);
      s.sel = open >= 0 ? open : s.grid.indexOf(0);
      s.gx = colOf(Math.max(0, s.sel));
      s.gy = rowOf(Math.max(0, s.sel));
      s.dirty = true;
      setSecs(Math.floor(s.time));
      setReady(true);
      save();
      shell.invalidate();
    };
    const saved = firstRound ? readSave(level) : null;
    if (saved) {
      accept({ puzzle: saved.puzzle, solution: saved.solution, level, grade: 0, clues: 0 }, saved);
      return () => {
        alive = false;
      };
    }
    const local = () => accept(generate(level));
    try {
      worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Puzzle>) => accept(e.data);
      worker.onerror = (e) => {
        e.preventDefault();
        local();
      };
      worker.postMessage(level);
    } catch {
      local();
    }
    return () => {
      alive = false;
      worker?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, s, shell.invalidate]);

  const playing = () => ready && s.won < 0 && shell.status === 'playing';

  const snapshot = () => {
    s.history.push({ grid: s.grid.slice(), notes: s.notes.slice(), sel: s.sel, hinted: [...s.hinted] });
    if (s.history.length > 400) s.history.shift();
  };

  const win = () => {
    s.won = s.t;
    writeSave(level, null);
    sfx.play('win');
  };

  const place = (i: number, d: number) => {
    s.grid[i] = d;
    s.notes[i] = 0;
    for (const p of PEERS[i]) s.notes[p] &= ~(1 << d);
    s.pops.set(i, s.t);
    s.conflict = conflicts(s.grid);
    if (s.conflict.has(i)) {
      s.shakes.set(i, s.t);
      sfx.play('hit', 1.7);
    } else {
      const units = completedUnits(s.grid, i);
      for (const u of units) s.waves.push({ cells: UNITS[u], from: i, t0: s.t });
      if (units.length) sfx.play('coin', 1 + units.length * 0.12);
      else sfx.play('blip', 0.9 + d * 0.04);
    }
    if (s.grid.every((v, k) => v === s.solution[k])) win();
  };

  const enter = (d: number, asNote = notesMode) => {
    if (!playing()) return;
    const i = s.sel;
    if (i < 0) return;
    if (locked(i)) {
      s.shakes.set(i, s.t);
      sfx.play('blip', 0.55);
      bump();
      return;
    }
    if (asNote) {
      if (s.grid[i]) return;
      snapshot();
      s.notes[i] ^= 1 << d;
      s.pops.set(i, s.t);
      sfx.play('tick', 1.4);
      bump();
      return;
    }
    snapshot();
    if (s.grid[i] === d) {
      s.grid[i] = 0;
      s.conflict = conflicts(s.grid);
      sfx.play('tick', 0.8);
      bump();
      return;
    }
    place(i, d);
    bump();
  };

  const erase = () => {
    if (!playing()) return;
    const i = s.sel;
    if (i < 0 || locked(i) || (!s.grid[i] && !s.notes[i])) return;
    snapshot();
    s.grid[i] = 0;
    s.notes[i] = 0;
    s.conflict = conflicts(s.grid);
    sfx.play('tick', 0.7);
    bump();
  };

  const undo = () => {
    if (!playing()) return;
    const prev = s.history.pop();
    if (!prev) return;
    s.grid = prev.grid;
    s.notes = prev.notes;
    s.sel = prev.sel;
    s.hinted = new Set(prev.hinted);
    s.conflict = conflicts(s.grid);
    s.pops.set(s.sel, s.t);
    sfx.play('select', 0.7);
    bump();
  };

  const hint = () => {
    if (!playing()) return;
    const i = hintCell(s.grid, s.solution, s.given.map((g, k) => g || s.hinted.has(k)), s.sel);
    if (i < 0) return;
    snapshot();
    s.sel = i;
    s.hinted.add(i);
    s.hints++;
    s.time += HINT_COST;
    s.glows.set(i, s.t);
    setPenalty((n) => n + 1);
    setSecs(Math.floor(s.time));
    place(i, s.solution[i]);
    sfx.play('select', 1.4);
    bump();
  };

  const toggleNotes = () => {
    if (!playing()) return;
    sfx.play('tick', notesMode ? 0.9 : 1.2);
    setNotesMode((n) => !n);
  };

  const move = (dr: number, dc: number) => {
    if (!playing()) return;
    const i = s.sel < 0 ? 40 : s.sel;
    s.sel = ((rowOf(i) + dr + 9) % 9) * 9 + ((colOf(i) + dc + 9) % 9);
    sfx.play('tick', 1.1);
    bump();
  };

  useKeys((code, e) => {
    const digit = /^(Digit|Numpad)([0-9])$/.exec(code);
    if (digit) {
      const d = Number(digit[2]);
      if (d === 0) erase();
      else enter(d, e?.shiftKey ? !notesMode : notesMode);
      return;
    }
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        return move(-1, 0);
      case 'ArrowDown':
      case 'KeyS':
        return move(1, 0);
      case 'ArrowLeft':
      case 'KeyA':
        return move(0, -1);
      case 'ArrowRight':
      case 'KeyD':
        return move(0, 1);
      case 'Backspace':
      case 'Delete':
        return erase();
      case 'KeyN':
        if (!e?.repeat) toggleNotes();
        return;
      case 'KeyU':
      case 'KeyZ':
        return undo();
      case 'KeyH':
        if (!e?.repeat) hint();
        return;
    }
  });

  /** The cell under a pointer, in the canvas's own coordinates so it stays exact on the 3D-projected laptop screen. */
  const cellAt = (e: RPointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = e.nativeEvent;
    const side = Math.floor(Math.min(size.w, size.h) - 2);
    const x0 = Math.round((size.w - side) / 2);
    const y0 = Math.round((size.h - side) / 2);
    const c = Math.floor(((x - x0) / side) * 9);
    const r = Math.floor(((y - y0) / side) * 9);
    return c < 0 || c > 8 || r < 0 || r > 8 ? -1 : r * 9 + c;
  };
  const onBoard = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!playing() || e.button > 0) return;
    const i = cellAt(e);
    if (i < 0) return;
    s.sel = i;
    sfx.play('tick', 1.2);
    bump();
  };
  const onHover = (e: RPointerEvent<HTMLCanvasElement>) => {
    const i = e.pointerType === 'mouse' && playing() ? cellAt(e) : -1;
    if (i === s.hover) return;
    s.hover = i;
    s.dirty = true;
    shell.invalidate();
  };

  useEffect(() => {
    if (shell.status !== 'playing') s.lastNow = 0;
    if (shell.status === 'paused') save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.status, s]);

  useGameLoop(
    (dt) => {
      if (!ready) return;
      s.t += dt;
      const k = 1 - Math.exp(-dt * 28);
      const tx = colOf(Math.max(0, s.sel));
      const ty = rowOf(Math.max(0, s.sel));
      s.gx += (tx - s.gx) * k;
      s.gy += (ty - s.gy) * k;
      if (Math.abs(tx - s.gx) < 0.003) s.gx = tx;
      if (Math.abs(ty - s.gy) < 0.003) s.gy = ty;
      // The clock follows wall time (dt is clamped for animation), capped so a resume after a pause adds nothing.
      const now = performance.now();
      const real = s.lastNow ? Math.min((now - s.lastNow) / 1000, 0.25) : dt;
      s.lastNow = now;
      if (s.won < 0) {
        s.time += real;
        const whole = Math.floor(s.time);
        if (whole !== secs) setSecs(whole);
        if (s.time - s.savedAt > 5) save();
      } else if (!s.ended && s.t - s.won > 1.7) {
        s.ended = true;
        const time = Math.max(1, Math.round(s.time));
        const prev = best;
        const isBest = submit(time);
        const name = LEVEL_LABEL[level];
        const helped = s.hints ? ` ${s.hints === 1 ? 'One hint' : `${s.hints} hints`} added ${fmtTime(s.hints * HINT_COST)}.` : '';
        const detail = isBest
          ? prev === null
            ? `Your first ${name} solve.${helped}`
            : `New best on ${name}, ${fmtTime(prev - time)} faster than before.${helped}`
          : `Your best on ${name} is ${fmtTime(prev ?? time)}.${helped}`;
        shell.gameOver(undefined, { title: `Solved in ${fmtTime(time)}`, detail, board: level, rank: Math.max(1000, Math.round(s.time * 1000)) });
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      const key = `${w}x${h}x${size.dpr}`;
      const gliding = s.gx !== colOf(Math.max(0, s.sel)) || s.gy !== rowOf(Math.max(0, s.sel));
      const animating = s.pops.size > 0 || s.shakes.size > 0 || s.glows.size > 0 || s.waves.length > 0 || s.won >= 0 || gliding;
      if (shell.status === 'playing' && !s.dirty && !animating && key === s.drawn) return;
      s.dirty = false;
      s.drawn = key;
      c.clearRect(0, 0, w, h);
      if (Math.min(w, h) < 40) return;
      if (!s.grid.length) {
        drawSkeleton(c, w, h, s.t);
        return;
      }
      draw(c, w, h);
    },
  );

  function draw(c: CanvasRenderingContext2D, w: number, h: number) {
    const side = Math.floor(Math.min(w, h) - 2);
    const x0 = Math.round((w - side) / 2);
    const y0 = Math.round((h - side) / 2);
    const cs = side / 9;
    const radius = Math.min(14, side * 0.03);
    const sel = s.sel;
    const selV = sel >= 0 ? s.grid[sel] : 0;
    const t = s.t;

    c.save();
    c.beginPath();
    c.roundRect(x0, y0, side, side, radius);
    c.fillStyle = 'rgba(255,255,255,0.045)';
    c.fill();
    c.clip();

    // the selection's row, column and box, as three soft bands that follow the glide
    if (sel >= 0 && s.won < 0) {
      c.fillStyle = 'rgba(10,132,255,0.085)';
      c.fillRect(x0, y0 + s.gy * cs, side, cs);
      c.fillRect(x0 + s.gx * cs, y0, cs, side);
      c.fillRect(x0 + Math.floor(colOf(sel) / 3) * 3 * cs, y0 + Math.floor(rowOf(sel) / 3) * 3 * cs, cs * 3, cs * 3);
    }

    for (let i = 0; i < 81; i++) {
      const r = rowOf(i);
      const col = colOf(i);
      const x = x0 + col * cs;
      const y = y0 + r * cs;
      let fill = '';
      if (i === s.hover && i !== sel) fill = 'rgba(255,255,255,0.06)';
      if (selV && s.grid[i] === selV && i !== sel) fill = 'rgba(10,132,255,0.24)';
      if (s.conflict.has(i)) fill = 'rgba(255,69,58,0.2)';
      if (fill) {
        c.fillStyle = fill;
        c.fillRect(x, y, cs + 0.5, cs + 0.5);
      }
      for (const wv of s.waves) {
        if (!wv.cells.includes(i)) continue;
        const dist = Math.abs(rowOf(wv.from) - r) + Math.abs(colOf(wv.from) - col);
        const p = (t - wv.t0 - dist * 0.035) / 0.42;
        if (p > 0 && p < 1) {
          c.fillStyle = `rgba(120,190,255,${0.32 * Math.sin(Math.PI * p)})`;
          c.fillRect(x, y, cs + 0.5, cs + 0.5);
        }
      }
      if (s.won >= 0) {
        const p = (t - s.won - (r + col) * 0.045) / 0.5;
        if (p > 0 && p < 1) {
          c.fillStyle = `rgba(10,132,255,${0.55 * Math.sin(Math.PI * p)})`;
          c.fillRect(x, y, cs + 0.5, cs + 0.5);
        }
      }
      const glow = s.glows.get(i);
      if (glow !== undefined) {
        const p = (t - glow) / 0.9;
        if (p >= 1) s.glows.delete(i);
        else {
          c.fillStyle = `rgba(255,214,10,${0.3 * (1 - p)})`;
          c.fillRect(x, y, cs + 0.5, cs + 0.5);
        }
      }

      let cx = x + cs / 2;
      const cy = y + cs / 2;
      const shake = s.shakes.get(i);
      if (shake !== undefined) {
        const p = (t - shake) / 0.32;
        if (p >= 1) s.shakes.delete(i);
        else cx += Math.sin(p * Math.PI * 6) * cs * 0.07 * (1 - p);
      }
      const pop = s.pops.get(i);
      let scale = 1;
      if (pop !== undefined) {
        const p = (t - pop) / 0.2;
        if (p >= 1) s.pops.delete(i);
        else scale = 1 + 0.22 * Math.sin(Math.PI * p);
      }
      const v = s.grid[i];
      if (v) {
        c.save();
        c.translate(cx, cy);
        c.scale(scale, scale);
        c.font = `${s.given[i] ? 600 : 500} ${Math.round(cs * 0.55)}px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = s.conflict.has(i) && !s.given[i] ? '#ff6961' : s.given[i] ? '#f5f5f7' : s.hinted.has(i) ? GOLD : '#5eb0ff';
        c.fillText(String(v), 0, cs * 0.04);
        c.restore();
      } else if (s.notes[i]) {
        c.save();
        c.translate(cx, cy);
        c.scale(scale, scale);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const fs = Math.round(cs * 0.27);
        for (let d = 1; d <= 9; d++) {
          if (!(s.notes[i] & (1 << d))) continue;
          const hot = d === selV;
          const nx = (((d - 1) % 3) - 1) * cs * 0.29;
          const ny = (Math.floor((d - 1) / 3) - 1) * cs * 0.29;
          c.fillStyle = hot ? '#5eb0ff' : 'rgba(245,245,247,0.62)';
          if (fs < 8) {
            // too small to read as digits: a dot in the digit's spot keeps the pattern legible
            c.beginPath();
            c.arc(nx, ny, Math.max(1, cs * 0.05), 0, Math.PI * 2);
            c.fill();
          } else {
            c.font = `${hot ? 700 : 500} ${fs}px ${FONT}`;
            c.fillText(String(d), nx, ny + cs * 0.02);
          }
        }
        c.restore();
      }
    }
    s.waves = s.waves.filter((wv) => t - wv.t0 < 1.2);

    for (let k = 1; k < 9; k++) {
      const major = k % 3 === 0;
      c.strokeStyle = major ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.075)';
      c.lineWidth = major ? 1.5 : 1;
      const p = Math.round(k * cs) + (major ? 0 : 0.5);
      c.beginPath();
      c.moveTo(x0 + p, y0);
      c.lineTo(x0 + p, y0 + side);
      c.moveTo(x0, y0 + p);
      c.lineTo(x0 + side, y0 + p);
      c.stroke();
    }
    c.restore();

    if (sel >= 0 && s.won < 0) {
      const gx = x0 + s.gx * cs;
      const gy = y0 + s.gy * cs;
      c.fillStyle = 'rgba(10,132,255,0.3)';
      c.beginPath();
      c.roundRect(gx + 1.5, gy + 1.5, cs - 3, cs - 3, Math.min(6, cs * 0.14));
      c.fill();
      c.strokeStyle = BLUE;
      c.lineWidth = 2;
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1, radius);
    c.stroke();
  }

  const touch = shell.touch;
  const u = useFrameScale(shell.root.current, touch);
  const pill = usePill(shell.root.current, shell.status);
  const L = layout(wrap.size.w, wrap.size.h, pill, touch, u);
  const counts = new Array(10).fill(0);
  for (const v of s.grid) counts[v]++;
  const selNotes = s.sel >= 0 && !s.grid[s.sel] ? s.notes[s.sel] : 0;
  const selV = s.sel >= 0 ? s.grid[s.sel] : 0;
  const canUndo = s.history.length > 0;
  const live = ready && s.won < 0;
  const padCell = Math.min(L.pad.w / L.padCols, L.pad.h / Math.ceil(9 / L.padCols));
  const toolCell = Math.min(L.tools.w / L.toolCols, L.tools.h / Math.ceil(4 / L.toolCols));
  const vars = {
    '--g-sudoku-key': `${Math.round(Math.max(15, Math.min(30, padCell * 0.46)))}px`,
    '--g-sudoku-icon': `${Math.round(Math.max(15, Math.min(22, toolCell * 0.42)))}px`,
    '--g-sudoku-clock': `${Math.round(Math.max(15, Math.min(26, L.info.h * 0.62)))}px`,
  } as CSSProperties;

  const tool = (name: keyof typeof icons, label: string, onClick: () => void, extra: { on?: boolean; disabled?: boolean; title: string }) => (
    <button
      type="button"
      onPointerDown={keepFocus}
      onClick={onClick}
      disabled={extra.disabled}
      className={extra.on ? 'is-on' : ''}
      aria-pressed={extra.on === undefined ? undefined : extra.on}
      aria-label={label}
      title={extra.title}
    >
      <span className="g-sudoku-face">
        <Icon d={icons[name]} />
        {L.labels && <span className="g-sudoku-label">{label}</span>}
      </span>
    </button>
  );

  return (
    <div ref={wrap.ref} className={`g-sudoku-wrap is-${L.kind} ${touch ? 'is-touch' : ''}`} style={vars}>
      <div className="g-sudoku-board" style={at(L.board)}>
        <canvas ref={ref} onPointerDown={onBoard} onPointerMove={onHover} onPointerLeave={onHover} aria-label="Sudoku board" />
      </div>
      <div className="g-sudoku-info" style={at(L.info)}>
        <span className="g-sudoku-time" aria-label="Time">
          {fmtTime(secs)}
        </span>
        {L.kind !== 'split' && <span className="g-sudoku-level">{LEVEL_LABEL[level]}</span>}
        {penalty > 0 && (
          <span key={penalty} className="g-sudoku-penalty" aria-hidden="true">
            +{HINT_COST}s
          </span>
        )}
      </div>
      <div className="g-sudoku-tools" style={{ ...at(L.tools), gridTemplateColumns: `repeat(${L.toolCols}, 1fr)` }}>
        {tool('undo', 'Undo', undo, { disabled: !canUndo || !live, title: 'Undo (U)' })}
        {tool('erase', 'Erase', erase, { disabled: !live, title: 'Erase (Backspace)' })}
        {tool('notes', 'Notes', toggleNotes, { on: notesMode, disabled: !live, title: 'Notes (N)' })}
        {tool('hint', 'Hint', hint, { disabled: !live, title: `Hint (H), adds ${HINT_COST} seconds` })}
      </div>
      <div className={`g-sudoku-pad ${notesMode ? 'is-notes' : ''}`} style={{ ...at(L.pad), gridTemplateColumns: `repeat(${L.padCols}, 1fr)` }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
          const cls = [counts[d] >= 9 ? 'is-done' : '', notesMode ? (selNotes & (1 << d) ? 'is-set' : '') : selV === d ? 'is-set' : ''].join(' ');
          return (
            <button key={d} type="button" onPointerDown={keepFocus} onClick={() => enter(d)} className={cls} disabled={!live} aria-label={`${notesMode ? 'Note' : 'Enter'} ${d}`}>
              <span className="g-sudoku-face">{d}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function drawSkeleton(c: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const side = Math.floor(Math.min(w, h) - 2);
  const x0 = Math.round((w - side) / 2);
  const y0 = Math.round((h - side) / 2);
  c.fillStyle = `rgba(255,255,255,${0.04 + 0.015 * Math.sin(t * 4)})`;
  c.beginPath();
  c.roundRect(x0, y0, side, side, Math.min(14, side * 0.03));
  c.fill();
}
