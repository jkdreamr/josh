import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  bestTile, canMove, createGame, departed, emptyGrid, frameUnit, isSeedRequest, layout, leftNotice, mergePitch, move, ONLINE_SECONDS, parseSave, parseSeed,
  randomSeed, seeded, spawn, undo, type Direction, type Grid, type Layout, type Position, type Rect, type TileMove,
} from './logic';
import { meta } from './meta';
import './2048.css';

const SAVE_KEY = 'arcade:2048:save';
const SLIDE = 0.1;
const POP = 0.16;

type Animation = { t: number; moves: TileMove[]; merges: Position[]; spawn: Position | null };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number };
type State = {
  grid: Grid;
  score: number;
  previous: { grid: Grid; score: number } | null;
  undoUsed: boolean;
  animation: Animation | null;
  won: boolean;
  lossDelay: number;
  shaking: number;
  bump: { dx: number; dy: number; t: number } | null;
  sparks: Spark[];
  glow: number;
  rand: () => number;
  seed: number | null;
  timeLeft: number;
};

const fresh = (seed: number | null): State => {
  const rand = seed === null ? Math.random : seeded(seed);
  return {
    grid: createGame(rand), score: 0, previous: null, undoUsed: false, animation: null, won: false,
    lossDelay: 0, shaking: 0, bump: null, sparks: [], glow: 0, rand, seed, timeLeft: ONLINE_SECONDS,
  };
};
const waiting = (): State => ({ ...fresh(null), grid: emptyGrid(), seed: -1 });

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// warm to hot, then cool greens and blues, with 2048 as the gold tile
const tiles: Record<number, [string, string, string]> = {
  2: ['#f6efe6', '#ece2d4', '#4a3b2f'],
  4: ['#f3e3c7', '#e9d3ad', '#4a3b2f'],
  8: ['#ffbe76', '#f9a24f', '#fff'],
  16: ['#ffa25c', '#f7853c', '#fff'],
  32: ['#ff8a65', '#f4683f', '#fff'],
  64: ['#ff6b5b', '#e8473a', '#fff'],
  128: ['#ffe08a', '#f5c94f', '#4a3410'],
  256: ['#ffd86b', '#f2bc32', '#4a3410'],
  512: ['#9ee493', '#6cc76a', '#173d1a'],
  1024: ['#6fd6c4', '#3db5a2', '#fff'],
  2048: ['#ffe873', '#f7b500', '#4a3000'],
  4096: ['#b9a2ff', '#8c6cf2', '#fff'],
  8192: ['#8ea2ff', '#5f72f0', '#fff'],
};
const tileStyle = (v: number) => tiles[v] ?? ['#5b6cff', '#3c45d6', '#fff'];

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit} handlesLeavers><Play /></GameShell>;
}

function Play() {
  const shell = useShell();
  const online = useOnline();
  const high = useHighScore('2048');
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((r) => r + 1);
  const state = useRef<State | null>(null);
  if (!state.current) {
    const saved = !online && shell.round === 0 && typeof localStorage !== 'undefined' ? parseSave(localStorage.getItem(SAVE_KEY)) : null;
    if (online && !online.isHost) state.current = waiting();
    else if (online) state.current = fresh(randomSeed());
    else if (saved) state.current = { ...fresh(null), ...saved };
    else state.current = fresh(null);
  }
  const { ref, size, ctx } = useCanvas();
  const swipe = useRef<{ id: number; x: number; y: number; done: boolean } | null>(null);
  const [unit, setUnit] = useState(1);
  const [ctrl, setCtrl] = useState<Rect | null>(null);
  const [status, setStatus] = useState<Rect | null>(null);
  const [gain, setGain] = useState<{ id: number; n: number } | null>(null);
  const [toast, setToast] = useState(0);
  const [left, setLeft] = useState<{ id: number; text: string } | null>(null);
  const lastNow = useRef<number | null>(null);
  const s0 = state.current;
  const view = layout(size.w, size.h, ctrl, online ? status ?? { x: size.w / 2 - 40, y: 10, w: 80, h: 28 * unit } : null, unit);
  const viewRef = useRef<Layout>(view);
  viewRef.current = view;

  // A fresh round from Restart drops the saved game; a finished one is cleared at Game Over.
  useEffect(() => {
    if (!online && shell.round > 0) localStorage.removeItem(SAVE_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = () => {
    const s = state.current;
    if (online || !s) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ grid: s.grid, score: s.score, won: s.won, undoUsed: s.undoUsed, previous: s.previous }));
    } catch { /* storage full or blocked */ }
  };

  // Measure the shell's control pill and online badge in layout px, and the frame scale on touch devices.
  const { root } = shell;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const timers: number[] = [];
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const u = shell.touch ? frameUnit(el.getBoundingClientRect().width, el.offsetWidth) : 1;
        setUnit((c) => (Math.abs(c - u) < 0.005 ? c : u));
        // the shell's toolbar and cards sit outside the game's root, so they read the scale from the shell (set first, so
        // the toolbar is measured at its scaled size)
        el.style.setProperty('--g-2048-u', u.toFixed(3));
        const box = el.querySelector<HTMLElement>('.arcade-ctrl');
        const next = box ? { x: box.offsetLeft, y: box.offsetTop, w: box.offsetWidth, h: box.offsetHeight } : null;
        setCtrl((c) => (c && next && c.x === next.x && c.y === next.y && c.w === next.w && c.h === next.h ? c : next));
        const badge = el.querySelector<HTMLElement>('.arcade-online-status');
        const nb = badge ? { x: badge.offsetLeft - badge.offsetWidth / 2, y: badge.offsetTop, w: badge.offsetWidth, h: badge.offsetHeight } : null;
        setStatus((c) => (c && nb && c.y === nb.y && c.h === nb.h ? c : nb));
      });
    };
    measure();
    // the frames scale in when an app opens, so look again once that settles
    for (const ms of [250, 700, 1400]) timers.push(window.setTimeout(measure, ms));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      ro.disconnect();
      el.style.removeProperty('--g-2048-u');
    };
  }, [root, shell.status, shell.touch, online]);

  // Online: the host picks the seed, so everyone gets the same tiles for the same moves.
  const onlineRef = useRef(online);
  const dealtRound = useRef<number | null>(online ? online.round : null);
  onlineRef.current = online;
  const isOnline = !!online;
  const isHost = !!online?.isHost;
  useEffect(() => {
    const room = onlineRef.current;
    if (!room) return;
    const off = room.onMessage((from, d) => {
      const s = state.current;
      if (room.isHost) {
        if (isSeedRequest(d) && s?.seed != null) room.send({ t: '2048-seed', seed: s.seed }, { to: from });
        return;
      }
      const seed = parseSeed(d);
      if (seed === null || from !== 0 || s?.seed === seed) return;
      state.current = fresh(seed);
      lastNow.current = null;
      refresh();
      shell.invalidate();
    });
    let ask = 0;
    // A new online round (or a board dealt before the room was ready) gets a fresh deal.
    const stale = dealtRound.current !== room.round;
    dealtRound.current = room.round;
    if (room.isHost) {
      if (stale || state.current?.seed == null || state.current.seed < 0) {
        state.current = fresh(randomSeed());
        refresh();
        shell.invalidate();
      }
      room.send({ t: '2048-seed', seed: state.current!.seed });
    } else {
      if (stale || state.current?.seed == null) {
        state.current = waiting();
        refresh();
        shell.invalidate();
      }
      if (state.current?.seed === -1) room.send({ t: '2048-seed?' }, { to: 0 });
      ask = window.setInterval(() => {
        if (state.current?.seed === -1) onlineRef.current?.send({ t: '2048-seed?' }, { to: 0 });
        else window.clearInterval(ask);
      }, 1500);
    }
    return () => {
      off();
      window.clearInterval(ask);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, isHost, online?.round]);


  // Online: someone leaving mid-race only gets a notice; everyone left keeps racing to the end and is scored.
  const roster = useRef<{ seat: number; name: string }[]>([]);
  const players = online?.players;
  useEffect(() => {
    if (!players || !online) return;
    const before = roster.current;
    roster.current = players.filter((p) => p.seat !== online.seat).map((p) => ({ seat: p.seat, name: p.name }));
    if (shell.status !== 'playing') return;
    const names = departed(before, players);
    if (names.length) setLeft({ id: performance.now(), text: leftNotice(names) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);
  useEffect(() => {
    if (!left) return;
    const t = window.setTimeout(() => setLeft(null), 4000);
    return () => window.clearTimeout(t);
  }, [left]);

  useEffect(() => {
    lastNow.current = null;
  }, [shell.status, shell.active]);

  const finish = (title: string) => {
    const s = state.current!;
    if (!online) localStorage.removeItem(SAVE_KEY);
    shell.gameOver(s.score, { title, detail: `Best tile ${bestTile(s.grid).toLocaleString('en-US')}.` });
    sfx.play('lose');
  };

  const performUndo = () => {
    const s = state.current;
    if (!s || s.undoUsed || shell.status !== 'playing') return;
    const result = undo({ grid: s.grid, score: s.score, used: s.undoUsed }, s.previous);
    if (!result.restored) return;
    Object.assign(s, { grid: result.state.grid, score: result.state.score, undoUsed: true, previous: null, lossDelay: 0, shaking: 0, animation: null, sparks: [] });
    setGain(null);
    save();
    refresh();
    sfx.tone({ freq: 660, to: 440, dur: 0.12, type: 'triangle', vol: 0.14 });
    shell.invalidate();
  };

  const playMove = (direction: Direction) => {
    const s = state.current;
    if (!s || s.seed === -1 || shell.status !== 'playing' || s.lossDelay > 0) return;
    const result = move(s.grid, direction);
    if (!result.moved) {
      const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
      s.bump = { dx: d[0], dy: d[1], t: 0 };
      sfx.tone({ freq: 150, to: 120, dur: 0.05, type: 'triangle', vol: 0.12 });
      return;
    }
    if (!s.undoUsed) s.previous = { grid: s.grid.map((row) => [...row]), score: s.score };
    const next = spawn(result.grid, s.rand);
    s.grid = next.grid;
    s.score += result.gained;
    const merges = result.moves.filter((m) => m.merged).map((m) => m.to).filter((p, i, all) => all.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i);
    s.animation = { t: 0, moves: result.moves, merges, spawn: next.position };
    s.bump = null;
    if (result.gained) setGain({ id: performance.now(), n: result.gained });
    const top = merges.reduce((m, [r, c]) => Math.max(m, s.grid[r][c]), 0);
    if (!s.won && bestTile(s.grid) >= 2048) {
      s.won = true;
      s.glow = 1.6;
      setToast(performance.now());
      sfx.play('win');
    } else if (top) {
      sfx.tone({ freq: mergePitch(top), dur: 0.11, type: 'triangle', vol: 0.16, delay: SLIDE * 0.6 });
      if (merges.length > 1) sfx.tone({ freq: mergePitch(top) * 1.5, dur: 0.08, type: 'sine', vol: 0.07, delay: SLIDE * 0.6 + 0.04 });
    } else sfx.tone({ freq: 420, to: 360, dur: 0.035, type: 'sine', vol: 0.08 });
    for (const [r, c] of merges) {
      const v = s.grid[r][c];
      if (v < 64) continue;
      const count = v >= 2048 ? 28 : v >= 512 ? 16 : 10;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const sp = 1.6 + Math.random() * (v >= 2048 ? 3.2 : 1.6);
        s.sparks.push({ x: c + 0.5, y: r + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.55 + Math.random() * 0.25, color: tileStyle(v)[1], r: 0.035 + Math.random() * 0.03 });
      }
    }
    if (!canMove(s.grid)) {
      s.lossDelay = 0.7;
      s.shaking = 0.36;
    }
    save();
    refresh();
  };

  useKeys((code, event) => {
    if (event?.repeat) return;
    if (code === 'ArrowLeft' || code === 'KeyA') playMove('left');
    else if (code === 'ArrowRight' || code === 'KeyD') playMove('right');
    else if (code === 'ArrowUp' || code === 'KeyW') playMove('up');
    else if (code === 'ArrowDown' || code === 'KeyS') playMove('down');
    else if (code === 'KeyU' || code === 'Backspace' || ((event?.metaKey || event?.ctrlKey) && code === 'KeyZ')) {
      event?.preventDefault();
      performUndo();
    }
  });

  useGameLoop((dt) => {
    const s = state.current;
    if (!s) return;
    if (s.animation) {
      s.animation.t += dt;
      if (s.animation.t >= SLIDE + POP) s.animation = null;
    }
    if (s.bump) {
      s.bump.t += dt;
      if (s.bump.t > 0.18) s.bump = null;
    }
    s.shaking = Math.max(0, s.shaking - dt);
    s.glow = Math.max(0, s.glow - dt);
    for (const p of s.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy = p.vy * 0.9 + 2.4 * dt;
      p.life -= dt;
    }
    if (s.sparks.length) s.sparks = s.sparks.filter((p) => p.life > 0);
    if (online && s.seed !== -1) {
      // a real clock: frames run slow on weak machines, and the loop stops while the game is hidden
      const now = performance.now();
      const step = lastNow.current === null ? 0 : Math.min(0.25, (now - lastNow.current) / 1000);
      lastNow.current = now;
      const before = Math.ceil(s.timeLeft);
      s.timeLeft = Math.max(0, s.timeLeft - step);
      if (Math.ceil(s.timeLeft) !== before) {
        refresh();
        if (s.timeLeft > 0 && s.timeLeft <= 10) sfx.play('tick', 0.8);
      }
      if (s.timeLeft <= 0 && s.lossDelay <= 0) {
        finish('Time Is Up');
        return;
      }
    }
    if (s.lossDelay > 0) {
      s.lossDelay -= dt;
      if (s.lossDelay <= 0) {
        s.lossDelay = 0;
        finish('No Moves Left');
      }
    }
  }, () => {
    const c = ctx();
    const s = state.current;
    if (!c || !s) return;
    const { w, h } = size;
    c.clearRect(0, 0, w, h);
    const { board } = viewRef.current;
    const B = board.w;
    if (B < 40) return;
    const gap = Math.max(4, B * 0.028);
    const cell = (B - gap * 5) / 4;
    const radius = Math.max(3, Math.min(14, cell * 0.14));
    c.save();
    let ox = 0;
    let oy = 0;
    if (s.shaking > 0) ox += Math.sin(s.shaking * 80) * s.shaking * 18;
    if (s.bump) {
      const k = Math.sin(clamp01(s.bump.t / 0.18) * Math.PI) * Math.min(6, B * 0.014);
      ox += s.bump.dx * k;
      oy += s.bump.dy * k;
    }
    c.translate(board.x + ox, board.y + oy);

    // board
    if (s.glow > 0) {
      c.shadowColor = `rgba(255, 205, 60, ${Math.min(0.75, s.glow * 0.5)})`;
      c.shadowBlur = B * 0.12;
    }
    c.fillStyle = '#2b2118';
    c.beginPath();
    c.roundRect(0, 0, B, B, radius + gap * 0.6);
    c.fill();
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';
    c.strokeStyle = 'rgba(255, 236, 210, .07)';
    c.lineWidth = 1;
    c.stroke();
    const cx = (col: number) => gap + col * (cell + gap);
    for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) {
      c.fillStyle = 'rgba(0, 0, 0, .24)';
      c.beginPath();
      c.roundRect(cx(col), cx(r), cell, cell, radius);
      c.fill();
    }

    const a = s.animation;
    if (a && a.t < SLIDE) {
      const p = easeOut(a.t / SLIDE);
      for (const m of a.moves) {
        drawTile(c, cx(m.from[1] + (m.to[1] - m.from[1]) * p), cx(m.from[0] + (m.to[0] - m.from[0]) * p), cell, m.value, radius);
      }
    } else {
      for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) {
        const value = s.grid[r][col];
        if (!value) continue;
        let scale = 1;
        if (a) {
          const t = clamp01((a.t - SLIDE) / POP);
          if (a.merges.some((q) => q[0] === r && q[1] === col)) scale = 1 + Math.sin(t * Math.PI) * 0.16;
          if (a.spawn && a.spawn[0] === r && a.spawn[1] === col) scale = Math.max(0.05, easeBack(t));
        }
        const z = cell * scale;
        drawTile(c, cx(col) - (z - cell) / 2, cx(r) - (z - cell) / 2, z, value, radius * scale);
      }
    }
    // sparks, in cell units
    const unitPx = cell + gap;
    for (const p of s.sparks) {
      c.globalAlpha = clamp01(p.life * 2.2);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(gap / 2 + p.x * unitPx, gap / 2 + p.y * unitPx, Math.max(1.5, p.r * unitPx), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    if (s.lossDelay > 0 || shell.status === 'over') {
      c.fillStyle = `rgba(20, 14, 10, ${shell.status === 'over' ? 0.5 : 0.5 * (1 - s.lossDelay / 0.7)})`;
      c.beginPath();
      c.roundRect(0, 0, B, B, radius + gap * 0.6);
      c.fill();
    }
    c.restore();
  });

  const s = s0;
  const best = Math.max(high.best ?? 0, s.score);
  const { hud, board, mode } = view;
  const clock = `${Math.floor(Math.ceil(s.timeLeft) / 60)}:${String(Math.ceil(s.timeLeft) % 60).padStart(2, '0')}`;
  const vars = { '--g-2048-u': unit } as CSSProperties;
  const ready = board.w >= 40;

  return <div className="g-2048-root" style={vars}>
    <canvas
      ref={ref}
      className="g-2048-canvas"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
      }}
      onPointerMove={(e) => {
        const start = swipe.current;
        if (!start || start.id !== e.pointerId || start.done) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) < 22) return;
        start.done = true;
        playMove(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
      }}
      onPointerUp={(e) => {
        const start = swipe.current;
        if (start?.id === e.pointerId) swipe.current = null;
      }}
      onPointerCancel={() => { swipe.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    />
    {ready && <div className={`g-2048-hud is-${mode}`} style={{ left: hud.x, top: hud.y, width: hud.w, height: mode === 'column' ? hud.h : undefined }}>
      <div className="g-2048-stats">
        <div className="g-2048-stat">
          <span>Score</span>
          <strong>{s.score.toLocaleString('en-US')}</strong>
          {gain && <em key={gain.id} className="g-2048-gain" aria-hidden="true">+{gain.n.toLocaleString('en-US')}</em>}
        </div>
        {online
          ? <div className={`g-2048-stat${s.timeLeft <= 10 ? ' is-late' : ''}`}><span>Time</span><strong>{clock}</strong></div>
          : <div className="g-2048-stat"><span>Best</span><strong>{best.toLocaleString('en-US')}</strong></div>}
      </div>
      <button
        className="arcade-btn g-2048-undo"
        type="button"
        disabled={s.undoUsed || !s.previous || shell.status !== 'playing'}
        title={s.undoUsed ? 'Undo Used' : 'Undo Last Move'}
        onClick={(e) => {
          performUndo();
          if (e.detail > 0) shell.root.current?.focus({ preventScroll: true });
        }}
      >{s.undoUsed ? 'Undo Used' : 'Undo'}</button>
    </div>}
    {ready && toast > 0 && <div key={toast} className="g-2048-toast" style={{ left: board.x + board.w / 2, top: board.y + board.w / 2 }} onAnimationEnd={() => setToast(0)}>
      You made 2048. Keep going.
    </div>}
    {ready && left && shell.status === 'playing' && <div key={left.id} className="g-2048-left" role="status" style={{ left: board.x + board.w / 2, top: board.y + Math.min(28, board.w * 0.08) }}>{left.text}</div>}
    {ready && online && s.seed === -1 && shell.status === 'playing' && <div className="g-2048-wait" style={{ left: board.x + board.w / 2, top: board.y + board.w / 2 }}>Getting the board</div>}
  </div>;
}

function drawTile(c: CanvasRenderingContext2D, x: number, y: number, size: number, value: number, radius: number) {
  if (size < 2) return;
  const [top, bottom, ink] = tileStyle(value);
  const r = Math.max(1, Math.min(radius, size / 2));
  c.save();
  if (value >= 128) {
    c.shadowColor = value === 2048 ? 'rgba(255, 200, 40, .65)' : `${bottom}88`;
    c.shadowBlur = size * (value >= 2048 ? 0.4 : 0.14 + Math.min(0.2, Math.log2(value / 128) * 0.05));
  }
  const g = c.createLinearGradient(0, y, 0, y + size);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(x, y, size, size, r);
  c.fill();
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  // a soft top highlight and a darker bottom lip give the tile some depth
  c.save();
  c.clip();
  c.fillStyle = 'rgba(255, 255, 255, .18)';
  c.fillRect(x, y, size, Math.max(1, size * 0.04));
  c.fillStyle = 'rgba(0, 0, 0, .12)';
  c.fillRect(x, y + size - Math.max(1.5, size * 0.06), size, size);
  c.restore();
  c.fillStyle = ink;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const text = String(value);
  let font = Math.max(11, size * (text.length <= 2 ? 0.44 : text.length === 3 ? 0.36 : text.length === 4 ? 0.29 : 0.24));
  c.font = `700 ${font}px Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  const fit = size * 0.84;
  const measured = c.measureText(text).width;
  if (measured > fit && font > 11) {
    font = Math.max(11, font * (fit / measured));
    c.font = `700 ${font}px Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  }
  c.fillText(text, x + size / 2, y + size / 2 + size * 0.02);
  c.restore();
}
