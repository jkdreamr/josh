import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { LEVELS, PEERS, UNITS, boxOf, colOf, completedUnits, conflicts, generate, rowOf, type Level, type Puzzle } from './logic';
import { meta } from './meta';
import './sudoku.css';

const LEVEL_KEY = 'arcade:sudoku:level';
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const BLUE = '#0a84ff';

function readLevel(): Level {
  try {
    const v = window.localStorage.getItem(LEVEL_KEY);
    return LEVELS.includes(v as Level) ? (v as Level) : 'easy';
  } catch {
    return 'easy';
  }
}
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
/** Keeps keyboard focus on the game when a DOM control is clicked. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  erase: 'M20 20H9M5.6 14.6l8-8a2 2 0 0 1 2.8 0l2.9 2.9a2 2 0 0 1 0 2.8L13 18.6a2 2 0 0 1-1.4.6H9.4a2 2 0 0 1-1.4-.6l-2.4-2.4a2 2 0 0 1 0-2.8zM10 10l5 5',
  notes: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l3 3',
};

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const [level, setLevel] = useState<Level>(readLevel);
  const pick = (l: Level) => {
    if (l === level) return;
    try {
      window.localStorage.setItem(LEVEL_KEY, l);
    } catch {
      /* private mode */
    }
    sfx.play('select');
    setLevel(l);
    shell.root.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="g-sudoku-levels" role="radiogroup" aria-label="Level">
        {LEVELS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={l === level} className={l === level ? 'is-on' : ''} onMouseDown={keepFocus} onClick={() => pick(l)}>
            {l}
          </button>
        ))}
      </div>
      <Round key={level} level={level} />
    </>
  );
}

type Wave = { cells: number[]; from: number; t0: number };
type Snapshot = { grid: number[]; notes: number[]; sel: number };

function Round({ level }: { level: Level }) {
  const shell = useShell();
  const wrap = useCanvas<HTMLDivElement>();
  const { ref, size, ctx } = useCanvas();
  const { best, submit } = useHighScore(`sudoku-${level}`, { lowerIsBetter: true });
  const [ready, setReady] = useState(false);
  const [notesMode, setNotesMode] = useState(false);
  const [secs, setSecs] = useState(0);
  const [, setVersion] = useState(0);
  const s = useRef({
    grid: [] as number[],
    solution: [] as number[],
    given: [] as boolean[],
    notes: [] as number[],
    sel: 40,
    conflict: new Set<number>(),
    history: [] as Snapshot[],
    t: 0,
    time: 0,
    pops: new Map<number, number>(),
    waves: [] as Wave[],
    won: -1,
    ended: false,
    dirty: true,
    drawn: '',
  }).current;
  const bump = () => {
    s.dirty = true;
    setVersion((v) => v + 1);
    shell.invalidate();
  };

  // Puzzle generation runs in a worker; the sync path is only a fallback when workers are unavailable.
  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    const accept = (p: Puzzle) => {
      if (!alive) return;
      s.solution = p.solution;
      s.grid = p.puzzle.slice();
      s.given = p.puzzle.map((v) => v > 0);
      s.notes = new Array(81).fill(0);
      s.sel = s.grid.indexOf(0, 36) >= 0 ? s.grid.indexOf(0, 36) : s.grid.indexOf(0);
      s.dirty = true;
      setReady(true);
      shell.invalidate();
    };
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
  }, [level, s, shell.invalidate]);

  const playing = () => ready && s.won < 0 && shell.status === 'playing';

  const snapshot = () => {
    s.history.push({ grid: s.grid.slice(), notes: s.notes.slice(), sel: s.sel });
    if (s.history.length > 400) s.history.shift();
  };

  const win = () => {
    s.won = s.t;
    sfx.play('win');
  };

  const enter = (d: number, asNote = notesMode) => {
    if (!playing()) return;
    const i = s.sel;
    if (i < 0) return;
    if (s.given[i]) {
      sfx.play('blip', 0.55);
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
    s.grid[i] = d;
    s.notes[i] = 0;
    for (const p of PEERS[i]) s.notes[p] &= ~(1 << d);
    s.pops.set(i, s.t);
    s.conflict = conflicts(s.grid);
    if (s.conflict.has(i)) sfx.play('hit', 1.7);
    else {
      const units = completedUnits(s.grid, i);
      for (const u of units) s.waves.push({ cells: UNITS[u], from: i, t0: s.t });
      if (units.length) sfx.play('coin', 1 + units.length * 0.12);
      else sfx.play('blip', 0.9 + d * 0.04);
    }
    if (s.grid.every((v, k) => v === s.solution[k])) win();
    bump();
  };

  const erase = () => {
    if (!playing()) return;
    const i = s.sel;
    if (i < 0 || s.given[i] || (!s.grid[i] && !s.notes[i])) return;
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
    s.conflict = conflicts(s.grid);
    s.pops.set(s.sel, s.t);
    sfx.play('select', 0.7);
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
    }
  });

  const onBoard = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!playing() || e.button > 0) return;
    // offsetX/Y are in the canvas's own coordinates, so this stays exact on the 3D-projected laptop screen.
    const { offsetX: x, offsetY: y } = e.nativeEvent;
    const side = Math.floor(Math.min(size.w, size.h) - 2);
    const x0 = Math.round((size.w - side) / 2);
    const y0 = Math.round((size.h - side) / 2);
    const c = Math.floor(((x - x0) / side) * 9);
    const r = Math.floor(((y - y0) / side) * 9);
    if (c < 0 || c > 8 || r < 0 || r > 8) return;
    s.sel = r * 9 + c;
    sfx.play('tick', 1.2);
    bump();
  };

  useGameLoop(
    (dt) => {
      if (!ready) return;
      s.t += dt;
      if (s.won < 0) {
        s.time += dt;
        const whole = Math.floor(s.time);
        if (whole !== secs) setSecs(whole);
      } else if (!s.ended && s.t - s.won > 1.7) {
        s.ended = true;
        const time = Math.max(1, Math.round(s.time));
        const prev = best;
        const isBest = submit(time);
        const detail = isBest
          ? prev === null
            ? `${level} in ${fmtTime(time)}. your first ${level} solve.`
            : `new best on ${level}: ${fmtTime(time)}.`
          : `${level} in ${fmtTime(time)}. best ${fmtTime(prev ?? time)}.`;
        shell.gameOver(undefined, { title: 'solved', detail });
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      const key = `${w}x${h}x${size.dpr}`;
      const animating = s.pops.size > 0 || s.waves.length > 0 || s.won >= 0;
      if (shell.status === 'playing' && !s.dirty && !animating && key === s.drawn) return;
      s.dirty = false;
      s.drawn = key;
      c.clearRect(0, 0, w, h);
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

    for (let i = 0; i < 81; i++) {
      const r = rowOf(i);
      const col = colOf(i);
      const x = x0 + col * cs;
      const y = y0 + r * cs;
      let fill = '';
      if (sel >= 0 && (r === rowOf(sel) || col === colOf(sel) || boxOf(i) === boxOf(sel))) fill = 'rgba(10,132,255,0.09)';
      if (selV && s.grid[i] === selV) fill = 'rgba(10,132,255,0.26)';
      if (s.conflict.has(i)) fill = 'rgba(255,69,58,0.2)';
      if (i === sel) fill = 'rgba(10,132,255,0.4)';
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

      const cx = x + cs / 2;
      const cy = y + cs / 2;
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
        c.fillStyle = s.conflict.has(i) && !s.given[i] ? '#ff6961' : s.given[i] ? '#f5f5f7' : '#5eb0ff';
        c.fillText(String(v), 0, cs * 0.04);
        c.restore();
      } else if (s.notes[i]) {
        c.save();
        c.translate(cx, cy);
        c.scale(scale, scale);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const fs = Math.max(8, Math.round(cs * 0.25));
        for (let d = 1; d <= 9; d++) {
          if (!(s.notes[i] & (1 << d))) continue;
          const hot = d === selV;
          c.font = `${hot ? 700 : 500} ${fs}px ${FONT}`;
          c.fillStyle = hot ? '#5eb0ff' : 'rgba(245,245,247,0.6)';
          c.fillText(String(d), (((d - 1) % 3) - 1) * cs * 0.29, (Math.floor((d - 1) / 3) - 1) * cs * 0.29 + cs * 0.02);
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
      c.strokeStyle = BLUE;
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(x0 + colOf(sel) * cs + 1.5, y0 + rowOf(sel) * cs + 1.5, cs - 3, cs - 3, Math.min(6, cs * 0.14));
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1, radius);
    c.stroke();
  }

  const W = wrap.size.w;
  const H = wrap.size.h;
  const touch = shell.touch;
  const wide = W > H * 1.15;
  const padH = touch ? 56 : 48;
  const sideW = 3 * 58 + 2 * 8;
  const board = Math.max(
    0,
    Math.floor(wide ? Math.min(H - 70, W - 28 - sideW - 22, 680) : Math.min(W - 28, H - 56 - 14 - 44 - padH - 24, 580)),
  );
  const counts = new Array(10).fill(0);
  for (const v of s.grid) counts[v]++;
  const canUndo = s.history.length > 0;

  return (
    <div ref={wrap.ref} className={`g-sudoku-wrap ${wide ? 'is-wide' : 'is-tall'} ${touch ? 'is-touch' : ''}`}>
      <div className="g-sudoku-board" style={{ width: board, height: board }}>
        <canvas ref={ref} onPointerDown={onBoard} aria-label="Sudoku board" />
      </div>
      <div className="g-sudoku-side" style={wide ? undefined : { width: board }}>
        <div className="g-sudoku-bar">
          <span className="g-sudoku-time" aria-label="Time">
            {fmtTime(secs)}
          </span>
          <div className="g-sudoku-tools">
            <button type="button" onMouseDown={keepFocus} onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (U)">
              <Icon d={icons.undo} />
            </button>
            <button type="button" onMouseDown={keepFocus} onClick={erase} aria-label="Erase" title="Erase (Backspace)">
              <Icon d={icons.erase} />
            </button>
            <button type="button" onMouseDown={keepFocus} onClick={toggleNotes} className={notesMode ? 'is-on' : ''} aria-pressed={notesMode} aria-label="Notes" title="Notes (N)">
              <Icon d={icons.notes} />
              <span>{notesMode ? 'on' : 'off'}</span>
            </button>
          </div>
        </div>
        <div className={`g-sudoku-pad ${notesMode ? 'is-notes' : ''}`}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button key={d} type="button" onMouseDown={keepFocus} onClick={() => enter(d)} className={counts[d] >= 9 ? 'is-done' : ''} aria-label={`${notesMode ? 'Note' : 'Enter'} ${d}`}>
              {d}
            </button>
          ))}
        </div>
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
