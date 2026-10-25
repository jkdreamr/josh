import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cleared, createGame, neighbors, reveal, tick, toggleFlag, type Level, type MinesGame, type Position } from './logic';
import { clampPan, computeLayout, stepCursor, type HudSize, type Layout } from './layout';
import { meta } from './meta';
import './minesweeper.css';

const LEVEL_ORDER = ['beginner', 'intermediate', 'expert'] as const satisfies readonly Level[];
const LEVEL = defineSetting<Level>('minesweeper:level', LEVEL_ORDER, 'beginner');
const levelText: Record<Level, string> = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' };
const levelOptions = LEVEL_ORDER.map((l) => [l, levelText[l]] as const);
const modeOptions = [['dig', 'Dig'], ['flag', 'Flag']] as const;

const NUMBER = ['', '#5ac8fa', '#34c759', '#ff6961', '#c39bff', '#ff9f0a', '#40c8e0', '#f5f5f7', '#a1a1a6'];
const CONFETTI = ['#5ac8fa', '#34c759', '#ffd60a', '#c39bff', '#ff9f0a', '#ff6961'];
const FONT = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const HOLD = 0.35;
const LOSS_CARD = 1.15;
const WIN_CARD = 1.35;

type Press = {
  id: number; pos: Position | null; touch: boolean; button: number;
  sx: number; sy: number; lx: number; ly: number;
  elapsed: number; moved: boolean; panning: boolean; longDone: boolean; chordDone: boolean; flagDone: boolean;
};
type Particle = { x: number; y: number; vx: number; vy: number; spin: number; angle: number; age: number; life: number; color: string };
type Geo = { L: Layout; cell: number; x: number; y: number; bw: number; bh: number; overflow: boolean };

function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-:--';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />}><Play /></GameShell>;
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  return <Segmented label="Board" value={level} options={levelOptions} onChange={setLevel} className="g-minesweeper-levels" />;
}

function Play() {
  const shell = useShell();
  const [level] = useSetting(LEVEL);
  const [mode, setMode] = useState<'dig' | 'flag'>('dig');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [, setHudRevision] = useState(0);
  const refreshHud = () => setHudRevision((revision) => revision + 1);
  const bests: Record<Level, ReturnType<typeof useHighScore>> = {
    beginner: useHighScore('minesweeper-beginner', { lowerIsBetter: true }),
    intermediate: useHighScore('minesweeper-intermediate', { lowerIsBetter: true }),
    expert: useHighScore('minesweeper-expert', { lowerIsBetter: true }),
  };
  const game = useRef<MinesGame | null>(null);
  if (!game.current || (game.current.level !== level && !game.current.started)) game.current = createGame(level);
  const s = game.current;
  const { ref, size, ctx } = useCanvas();
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;

  // Frame scale: the iPad frame draws the game smaller, so touch sizes grow by 1/scale to stay finger sized.
  const [u, setU] = useState(1);
  useEffect(() => {
    const root = shell.root.current;
    if (!root || !shell.touch) {
      setU(1);
      return;
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
        const next = scale > 0.2 && scale < 0.99 ? Math.min(2, Math.ceil(100 / scale) / 100) : 1;
        root.style.setProperty('--g-minesweeper-u', String(next));
        setU((current) => (current === next ? current : next));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--g-minesweeper-u');
    };
  }, [shell.touch, shell.root]);

  // The shell's control pill and our stats chips, measured so the board never sits under either.
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ ctrlLeft: number; ctrlBottom: number; hud: HudSize }>({ ctrlLeft: 1e4, ctrlBottom: 0, hud: { rowW: 230, rowH: 28, colW: 92, colH: 96 } });
  useLayoutEffect(() => {
    const canvas = ref.current;
    const root = shell.root.current;
    if (!canvas || !root) return;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const scale = canvas.offsetWidth ? box.width / canvas.offsetWidth : 1;
      if (!(scale > 0)) return;
      const ctrl = root.querySelector('.arcade-ctrl');
      let ctrlLeft = canvas.offsetWidth;
      let ctrlBottom = 0;
      if (ctrl) {
        const r = ctrl.getBoundingClientRect();
        if (r.width > 0) {
          ctrlLeft = (r.left - box.left) / scale;
          ctrlBottom = (r.bottom - box.top) / scale;
        }
      }
      const chips = Array.from(hudRef.current?.children ?? []) as HTMLElement[];
      const gap = 6 * u;
      const hud = chips.length
        ? {
            rowW: chips.reduce((sum, chip) => sum + chip.offsetWidth, 0) + gap * (chips.length - 1),
            rowH: Math.max(...chips.map((chip) => chip.offsetHeight)),
            colW: Math.max(...chips.map((chip) => chip.offsetWidth)),
            colH: chips.reduce((sum, chip) => sum + chip.offsetHeight, 0) + gap * (chips.length - 1),
          }
        : frame.hud;
      setFrame((current) =>
        Math.abs(current.ctrlLeft - ctrlLeft) < 0.5 && Math.abs(current.ctrlBottom - ctrlBottom) < 0.5 &&
        Math.abs(current.hud.rowW - hud.rowW) < 0.5 && Math.abs(current.hud.rowH - hud.rowH) < 0.5 &&
        Math.abs(current.hud.colW - hud.colW) < 0.5 && Math.abs(current.hud.colH - hud.colH) < 0.5
          ? current
          : { ctrlLeft, ctrlBottom, hud });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const ctrl = root.querySelector('.arcade-ctrl');
    if (ctrl) observer.observe(ctrl);
    if (hudRef.current) observer.observe(hudRef.current);
    return () => observer.disconnect();
  }, [size.w, size.h, u, shell.status, shell.root]);

  const touchUi = shell.touch;
  const layout = computeLayout({
    w: size.w,
    h: size.h,
    rows: s.rows,
    cols: s.cols,
    ctrlLeft: frame.ctrlLeft,
    ctrlBottom: frame.ctrlBottom,
    hud: frame.hud,
    bar: touchUi ? 44 * u : 0,
    minCell: touchUi ? 40 * u : 15,
    maxCell: 64 * u,
  });
  const uRef = useRef(u);
  uRef.current = u;

  const zoom = useRef(1);
  const pan = useRef({ x: NaN, y: NaN });
  const press = useRef<Press | null>(null);
  const pressedAt = useRef<Position | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const hover = useRef<Position | null>(null);
  const cursor = useRef<Position | null>(null);
  const cursorVisible = useRef(false);
  const revealFx = useRef(new Map<number, { delay: number; age: number }>());
  const flagFx = useRef(new Map<number, { age: number; on: boolean }>());
  const particles = useRef<Particle[]>([]);
  const loss = useRef<{ age: number; at: Position; mines: { pos: Position; delay: number }[]; done: boolean } | null>(null);
  const win = useRef<{ age: number; at: Position; detail: string; level: Level; ms: number; done: boolean } | null>(null);
  const lastNow = useRef<number | null>(null);
  const hudTime = useRef(0);
  const sprites = useRef(new Map<string, HTMLCanvasElement>());

  function resetView() {
    zoom.current = 1;
    pan.current = { x: NaN, y: NaN };
  }

  const layoutRef = useRef(layout);
  if (layoutRef.current.transposed !== layout.transposed || layoutRef.current.rows !== layout.rows) {
    layoutRef.current = layout;
    resetView();
  }
  layoutRef.current = layout;

  useEffect(() => {
    revealFx.current.clear();
    flagFx.current.clear();
    particles.current = [];
    loss.current = null;
    win.current = null;
    cursor.current = null;
    cursorVisible.current = false;
    resetView();
    shell.invalidate();
  }, [level]);

  useEffect(() => {
    if (shell.status !== 'playing') {
      lastNow.current = null;
      press.current = null;
      pressedAt.current = null;
      touches.current.clear();
      pinch.current = null;
    }
  }, [shell.status]);

  const cellOf = (L: Layout) => Math.min(L.base * 4, Math.max(Math.min(L.fit, L.base), L.base * zoom.current));
  const geo = (): Geo => {
    const L = layoutRef.current;
    const cell = cellOf(L);
    const bw = L.cols * cell;
    const bh = L.rows * cell;
    const p = pan.current;
    if (!Number.isFinite(p.x)) p.x = (L.view.w - bw) / 2;
    if (!Number.isFinite(p.y)) p.y = (L.view.h - bh) / 2;
    p.x = clampPan(p.x, bw, L.view.w);
    p.y = clampPan(p.y, bh, L.view.h);
    return { L, cell, x: L.view.x + p.x, y: L.view.y + p.y, bw, bh, overflow: bw > L.view.w + 0.5 || bh > L.view.h + 0.5 };
  };
  const toBoard = (L: Layout, vr: number, vc: number): Position => (L.transposed ? [vc, vr] : [vr, vc]);
  const toView = (L: Layout, [r, c]: Position): Position => (L.transposed ? [c, r] : [r, c]);
  const positionAt = (px: number, py: number): Position | null => {
    const g = geo();
    const v = g.L.view;
    if (px < v.x || py < v.y || px > v.x + v.w || py > v.y + v.h) return null;
    const vc = Math.floor((px - g.x) / g.cell);
    const vr = Math.floor((py - g.y) / g.cell);
    if (vr < 0 || vr >= g.L.rows || vc < 0 || vc >= g.L.cols) return null;
    return toBoard(g.L, vr, vc);
  };
  const zoomAt = (px: number, py: number, factor: number) => {
    const g = geo();
    const L = g.L;
    const min = Math.min(1, L.fit / L.base);
    const next = Math.min(4, Math.max(min, zoom.current * factor));
    if (next === zoom.current) return;
    const bx = (px - g.x) / g.cell;
    const by = (py - g.y) / g.cell;
    zoom.current = next;
    const cell = cellOf(L);
    pan.current.x = px - L.view.x - bx * cell;
    pan.current.y = py - L.view.y - by * cell;
    geo();
  };
  const keepInView = (pos: Position) => {
    const g = geo();
    const [vr, vc] = toView(g.L, pos);
    const v = g.L.view;
    const left = g.x + vc * g.cell;
    const top = g.y + vr * g.cell;
    if (left < v.x) pan.current.x += v.x - left;
    if (left + g.cell > v.x + v.w) pan.current.x -= left + g.cell - v.x - v.w;
    if (top < v.y) pan.current.y += v.y - top;
    if (top + g.cell > v.y + v.h) pan.current.y -= top + g.cell - v.y - v.h;
  };

  const noteReveal = (result: ReturnType<typeof reveal>, row: number, col: number) => {
    const g = game.current!;
    if (result.revealed.length && !result.lost) {
      for (const [r, c] of result.revealed) {
        const d = Math.hypot(r - row, c - col);
        revealFx.current.set(r * g.cols + c, { delay: Math.min(0.38, d * 0.022), age: 0 });
      }
      const n = result.revealed.length;
      sfx.play('tick', n > 12 ? 1.3 : 0.85 + Math.random() * 0.2);
      if (n > 12) sfx.tone({ freq: 520, to: 980, dur: 0.18, type: 'sine', vol: 0.05 });
    }
    if (result.lost) {
      const at = result.clickedMine ?? [row, col];
      const mines = result.revealed
        .filter(([r, c]) => g.board[r][c].mine && !(r === at[0] && c === at[1]))
        .map((pos) => ({ pos, d: Math.hypot(pos[0] - at[0], pos[1] - at[1]) }))
        .sort((a, b) => a.d - b.d);
      const span = Math.max(1, mines.length ? mines[mines.length - 1].d : 1);
      loss.current = { age: 0, at, mines: mines.map((m) => ({ pos: m.pos, delay: 0.18 + (m.d / span) * 0.55 })), done: false };
      cursorVisible.current = false;
      sfx.play('hit', 0.6);
      sfx.play('boom', 0.6);
      sfx.noise(0.35, 0.12);
      navigator.vibrate?.(40);
    }
    if (result.won) {
      const seconds = Math.max(1, Math.floor(g.seconds));
      const best = bests[g.level];
      const previous = best.best;
      const newBest = best.submit(seconds);
      const name = levelText[g.level];
      const detail = newBest
        ? `New best on ${name}: ${formatTime(seconds)}.`
        : `${name} in ${formatTime(seconds)}. Your best is ${formatTime(previous)}.`;
      win.current = { age: 0, at: [row, col], detail, level: g.level, ms: Math.max(1, Math.round(g.seconds * 1000)), done: false };
      cursorVisible.current = false;
      const geom = geo();
      for (let i = 0; i < 90; i++) {
        particles.current.push({
          x: geom.L.view.x + Math.random() * geom.L.view.w,
          y: geom.L.view.y - 10 - Math.random() * 40,
          vx: (Math.random() - 0.5) * 90,
          vy: 40 + Math.random() * 120,
          spin: (Math.random() - 0.5) * 14,
          angle: Math.random() * Math.PI,
          age: -Math.random() * 0.5 - 0.2,
          life: 1.6 + Math.random() * 0.9,
          color: CONFETTI[i % CONFETTI.length],
        });
      }
      sfx.play('win');
    }
    if (result.changed) refreshHud();
  };

  const performReveal = (row: number, col: number) => {
    if (statusRef.current !== 'playing') return;
    const result = reveal(game.current!, row, col);
    if (!result.changed && game.current!.board[row][col].revealed && game.current!.board[row][col].adjacent) sfx.play('blip', 0.6);
    noteReveal(result, row, col);
  };
  const performFlag = (row: number, col: number) => {
    if (statusRef.current !== 'playing') return;
    const g = game.current!;
    if (!toggleFlag(g, row, col)) return;
    const on = g.board[row][col].flagged;
    flagFx.current.set(row * g.cols + col, { age: 0, on });
    sfx.play('select', on ? 1.15 : 0.8);
    refreshHud();
  };
  /** A tap on an open number always clears around it; on a covered square it digs or flags. */
  const performAction = (row: number, col: number, flag: boolean) => {
    if (game.current!.board[row][col].revealed) performReveal(row, col);
    else if (flag) performFlag(row, col);
    else performReveal(row, col);
  };

  useKeys((code, event) => {
    if (statusRef.current !== 'playing') return;
    const g = game.current!;
    if (g.over) return;
    const L = layoutRef.current;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [0, -1], KeyA: [0, -1], ArrowRight: [0, 1], KeyD: [0, 1],
      ArrowUp: [-1, 0], KeyW: [-1, 0], ArrowDown: [1, 0], KeyS: [1, 0],
    };
    const dir = step[code];
    if (dir) {
      event?.preventDefault();
      if (!cursor.current) cursor.current = hover.current ?? [Math.floor(g.rows / 2), Math.floor(g.cols / 2)];
      else if (cursorVisible.current) cursor.current = stepCursor(cursor.current, dir[0], dir[1], L.transposed, g.rows, g.cols);
      cursorVisible.current = true;
      keepInView(cursor.current);
      sfx.play('blip', 1.6);
      return;
    }
    if (event?.repeat) return;
    if (code === 'Space' || code === 'Enter' || code === 'KeyF') {
      event?.preventDefault();
      if (!cursor.current || !cursorVisible.current) {
        cursor.current ??= hover.current ?? [Math.floor(g.rows / 2), Math.floor(g.cols / 2)];
        cursorVisible.current = true;
        keepInView(cursor.current);
        return;
      }
      const [r, c] = cursor.current;
      if (code === 'KeyF') performFlag(r, c);
      else performReveal(r, c);
    }
    if (code === 'Equal' || code === 'NumpadAdd' || code === 'Minus' || code === 'NumpadSubtract') {
      const v = L.view;
      zoomAt(v.x + v.w / 2, v.y + v.h / 2, code === 'Equal' || code === 'NumpadAdd' ? 1.25 : 0.8);
    }
  });

  // Scroll to move a board bigger than the window, pinch or Ctrl scroll to zoom.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (statusRef.current !== 'playing') return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1;
      if (e.ctrlKey || e.metaKey) zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * unit * 0.01));
      else {
        const sideways = e.shiftKey && !e.deltaX;
        pan.current.x -= (sideways ? e.deltaY : e.deltaX) * unit;
        pan.current.y -= (sideways ? 0 : e.deltaY) * unit;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useGameLoop((dt) => {
    const g = game.current!;
    const now = performance.now();
    const previous = lastNow.current;
    lastNow.current = now;
    tick(g, previous === null ? 0 : Math.min((now - previous) / 1000, 0.25));
    hudTime.current += dt;
    if (hudTime.current >= 0.25) {
      hudTime.current = 0;
      if (g.started && !g.over) refreshHud();
    }
    const p = press.current;
    if (p?.touch && p.pos && !p.longDone && !p.moved && !pinch.current) {
      p.elapsed += dt;
      if (p.elapsed >= HOLD) {
        p.longDone = true;
        pressedAt.current = null;
        const [r, c] = p.pos;
        if (g.board[r][c].revealed) performReveal(r, c);
        else performAction(r, c, modeRef.current === 'dig');
        navigator.vibrate?.(12);
      }
    }
    for (const [key, fx] of revealFx.current) {
      fx.age += dt;
      if (fx.age - fx.delay > 0.3) revealFx.current.delete(key);
    }
    for (const [key, fx] of flagFx.current) {
      fx.age += dt;
      if (fx.age > 0.3) flagFx.current.delete(key);
    }
    const parts = particles.current;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt;
      if (q.age < 0) continue;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 160 * dt;
      q.vx *= 1 - dt * 0.8;
      q.angle += q.spin * dt;
      if (q.age >= q.life) parts.splice(i, 1);
    }
    const l = loss.current;
    if (l && !l.done) {
      l.age += dt;
      if (l.age >= LOSS_CARD) {
        l.done = true;
        const pct = Math.floor(cleared(g) * 100);
        shell.gameOver(undefined, { title: 'Boom', detail: `You cleared ${pct}% of ${levelText[g.level]}.` });
      }
    }
    const w = win.current;
    if (w && !w.done) {
      w.age += dt;
      if (w.age >= WIN_CARD) {
        w.done = true;
        shell.gameOver(undefined, { title: 'Cleared', detail: w.detail, board: w.level, rank: w.ms });
      }
    }
  }, () => {
    const c = ctx();
    if (!c || !size.w || !size.h) return;
    const g = game.current!;
    const geom = geo();
    const { L, cell } = geom;
    const dpr = size.dpr;
    const v = L.view;
    c.clearRect(0, 0, size.w, size.h);
    c.save();
    const l = loss.current;
    if (l && l.age < 0.5) {
      const amp = 6 * (1 - l.age / 0.5) ** 2;
      c.translate(Math.sin(l.age * 95) * amp, Math.cos(l.age * 71) * amp * 0.6);
    }
    // Tray under the board.
    const tx = Math.max(v.x, geom.x) - 5;
    const ty = Math.max(v.y, geom.y) - 5;
    const tw = Math.min(v.x + v.w, geom.x + geom.bw) - tx + 5;
    const th = Math.min(v.y + v.h, geom.y + geom.bh) - ty + 5;
    c.fillStyle = '#0c0d11';
    c.shadowColor = 'rgba(0,0,0,.45)';
    c.shadowBlur = 18;
    c.shadowOffsetY = 6;
    c.beginPath();
    c.roundRect(tx, ty, tw, th, Math.min(12, cell * 0.4 + 4));
    c.fill();
    c.shadowColor = 'transparent';
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.lineWidth = 1;
    c.stroke();
    c.save();
    c.beginPath();
    c.rect(v.x - 1, v.y - 1, v.w + 2, v.h + 2);
    c.clip();
    const vc0 = Math.max(0, Math.floor((v.x - geom.x) / cell));
    const vc1 = Math.min(L.cols - 1, Math.floor((v.x + v.w - geom.x) / cell));
    const vr0 = Math.max(0, Math.floor((v.y - geom.y) / cell));
    const vr1 = Math.min(L.rows - 1, Math.floor((v.y + v.h - geom.y) / cell));
    const preview = new Set<number>();
    const pa = pressedAt.current;
    if (pa && !g.over) {
      if (g.board[pa[0]][pa[1]].revealed) for (const [r, cc] of neighbors(g, pa[0], pa[1])) preview.add(r * g.cols + cc);
      else if (!g.board[pa[0]][pa[1]].flagged) preview.add(pa[0] * g.cols + pa[1]);
    }
    const up = sprite(sprites.current, 'up', cell, dpr);
    const lit = sprite(sprites.current, 'lit', cell, dpr);
    const down = sprite(sprites.current, 'down', cell, dpr);
    const downAlt = sprite(sprites.current, 'downAlt', cell, dpr);
    const fontSize = Math.max(11, cell * 0.62);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const hv = hover.current;
    const w = win.current;
    for (let vr = vr0; vr <= vr1; vr++) for (let vc = vc0; vc <= vc1; vc++) {
      const [row, col] = toBoard(L, vr, vc);
      const cellState = g.board[row][col];
      const key = row * g.cols + col;
      const x = geom.x + vc * cell;
      const y = geom.y + vr * cell;
      const cx = x + cell / 2;
      const cy = y + cell / 2;
      const fx = revealFx.current.get(key);
      const t = fx ? Math.max(0, Math.min(1, (fx.age - fx.delay) / 0.22)) : 1;
      const showOpen = cellState.revealed && !(fx && t <= 0);
      if (!showOpen) {
        const hot = !g.over && ((hv && hv[0] === row && hv[1] === col) || (cursorVisible.current && cursor.current?.[0] === row && cursor.current[1] === col));
        if (preview.has(key) && !cellState.flagged) c.drawImage((vr + vc) % 2 ? downAlt : down, x, y, cell, cell);
        else c.drawImage(hot ? lit : up, x, y, cell, cell);
        const ff = flagFx.current.get(key);
        if (cellState.flagged || (ff && !ff.on)) {
          let k = 1;
          if (ff) {
            const a = Math.min(1, ff.age / 0.22);
            k = ff.on ? 1 + Math.sin(a * Math.PI) * 0.28 - (1 - a) * 0.6 : 1 - a;
          }
          if (w) k *= 1 + Math.max(0, Math.sin(Math.min(Math.PI, (w.age * 16 - Math.hypot(row - w.at[0], col - w.at[1])) * 0.9))) * 0.25;
          if (k > 0.02) drawFlag(c, cx, cy, cell * 0.3 * k, cellState.wrongFlag);
        }
        continue;
      }
      c.save();
      if (t < 1) {
        const e = 1 - (1 - t) ** 3;
        c.globalAlpha = 0.35 + e * 0.65;
        c.drawImage(up, x, y, cell, cell);
        c.globalAlpha = e;
      }
      c.drawImage((vr + vc) % 2 ? downAlt : down, x, y, cell, cell);
      if (w) {
        const d = Math.hypot(row - w.at[0], col - w.at[1]);
        const wave = w.age * 16 - d;
        if (wave > 0 && wave < 3) {
          c.fillStyle = `rgba(52,199,89,${0.28 * Math.sin((wave / 3) * Math.PI)})`;
          c.fillRect(x, y, cell, cell);
        }
      }
      if (cellState.mine) {
        const exploded = g.clickedMine?.[0] === row && g.clickedMine[1] === col;
        let k = 1;
        if (l && !exploded) {
          const m = l.mines.find((mm) => mm.pos[0] === row && mm.pos[1] === col);
          const a = m ? (l.age - m.delay) / 0.16 : 1;
          k = a <= 0 ? 0 : a >= 1 ? 1 : 1 + Math.sin(a * Math.PI) * 0.3 - (1 - a) * 0.5;
        }
        if (exploded) {
          const flash = l && l.age < 0.5 ? 0.55 + 0.45 * Math.abs(Math.cos(l.age * 18)) : 1;
          c.fillStyle = `rgba(255,69,58,${flash})`;
          c.beginPath();
          c.roundRect(x + 0.5, y + 0.5, cell - 1, cell - 1, cell * 0.12);
          c.fill();
        } else if (k > 0) {
          c.fillStyle = 'rgba(255,69,58,.12)';
          c.fillRect(x, y, cell, cell);
        }
        if (k > 0) drawMine(c, cx, cy, cell * 0.24 * k, exploded);
      } else if (cellState.adjacent) {
        const pop = t < 1 ? 0.7 + 0.3 * t : 1;
        c.fillStyle = NUMBER[cellState.adjacent];
        c.font = `800 ${fontSize * pop}px ${FONT}`;
        c.fillText(String(cellState.adjacent), cx, cy + cell * 0.03);
      }
      c.restore();
      if (!g.over && cursorVisible.current && cursor.current?.[0] === row && cursor.current[1] === col) {
        c.strokeStyle = 'rgba(255,255,255,.85)';
        c.lineWidth = Math.max(1.5, cell * 0.07);
        c.beginPath();
        c.roundRect(x + 1.5, y + 1.5, cell - 3, cell - 3, cell * 0.16);
        c.stroke();
      }
    }
    // Keyboard cursor over covered squares.
    if (!g.over && cursorVisible.current && cursor.current) {
      const [vr, vc] = toView(L, cursor.current);
      const x = geom.x + vc * cell;
      const y = geom.y + vr * cell;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1.5, cell * 0.07);
      c.beginPath();
      c.roundRect(x + 1, y + 1, cell - 2, cell - 2, cell * 0.2);
      c.stroke();
    }
    // Hold to flag: a ring fills around the finger.
    const p = press.current;
    if (p?.touch && p.pos && !p.moved && !p.longDone && p.elapsed > 0.08 && !g.board[p.pos[0]][p.pos[1]].revealed) {
      const [vr, vc] = toView(L, p.pos);
      const x = geom.x + vc * cell + cell / 2;
      const y = geom.y + vr * cell + cell / 2;
      const a = Math.min(1, (p.elapsed - 0.08) / (HOLD - 0.08));
      c.strokeStyle = modeRef.current === 'dig' ? '#ff6961' : '#f5f5f7';
      c.lineWidth = Math.max(2.5, cell * 0.08);
      c.lineCap = 'round';
      c.beginPath();
      c.arc(x, y, cell * 0.62, -Math.PI / 2, -Math.PI / 2 + a * Math.PI * 2);
      c.stroke();
    }
    // Soft edges where the board continues past the view.
    const edge = Math.min(18, cell * 0.8);
    const shade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const grad = c.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(12,13,17,.85)');
      grad.addColorStop(1, 'rgba(12,13,17,0)');
      c.fillStyle = grad;
      c.fillRect(rx, ry, rw, rh);
    };
    if (geom.x < v.x - 0.5) shade(v.x, 0, v.x + edge, 0, v.x, v.y, edge, v.h);
    if (geom.x + geom.bw > v.x + v.w + 0.5) shade(v.x + v.w, 0, v.x + v.w - edge, 0, v.x + v.w - edge, v.y, edge, v.h);
    if (geom.y < v.y - 0.5) shade(0, v.y, 0, v.y + edge, v.x, v.y, v.w, edge);
    if (geom.y + geom.bh > v.y + v.h + 0.5) shade(0, v.y + v.h, 0, v.y + v.h - edge, v.x, v.y + v.h - edge, v.w, edge);
    c.restore();
    // Blast ring.
    if (l && l.age < 0.6) {
      const [vr, vc] = toView(L, l.at);
      const x = geom.x + vc * cell + cell / 2;
      const y = geom.y + vr * cell + cell / 2;
      const a = l.age / 0.6;
      c.strokeStyle = `rgba(255,140,120,${0.7 * (1 - a)})`;
      c.lineWidth = Math.max(2, cell * 0.18 * (1 - a));
      c.beginPath();
      c.arc(x, y, cell * (0.6 + a * 5), 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
    if (l && l.age < 0.7) {
      const a = 1 - l.age / 0.7;
      const glow = c.createRadialGradient(size.w / 2, size.h / 2, Math.min(size.w, size.h) * 0.3, size.w / 2, size.h / 2, Math.max(size.w, size.h) * 0.75);
      glow.addColorStop(0, 'rgba(255,69,58,0)');
      glow.addColorStop(1, `rgba(255,69,58,${0.35 * a})`);
      c.fillStyle = glow;
      c.fillRect(0, 0, size.w, size.h);
    }
    for (const q of particles.current) {
      if (q.age < 0) continue;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, (q.life - q.age) / 0.4));
      c.translate(q.x, q.y);
      c.rotate(q.angle);
      c.fillStyle = q.color;
      c.fillRect(-3.5, -2, 7, 4 * Math.abs(Math.cos(q.angle * 1.7)) + 0.6);
      c.restore();
    }
  });

  const point = (event: RPointerEvent<HTMLCanvasElement>) => ({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
  const chordIfHeld = (event: RPointerEvent<HTMLCanvasElement>, pos: Position | null) => {
    const p = press.current;
    if (event.pointerType !== 'mouse' || !pos || !p || p.chordDone) return;
    if ((event.buttons & 3) !== 3 && (event.buttons & 4) === 0) return;
    p.chordDone = true;
    pressedAt.current = null;
    performReveal(pos[0], pos[1]);
  };

  const g = game.current;
  const best = bests[g.level].best;
  return <>
    <canvas
      ref={ref}
      className="g-minesweeper-canvas"
      onPointerDown={(event) => {
        event.preventDefault();
        if (statusRef.current !== 'playing') return;
        const pt = point(event);
        const touch = event.pointerType !== 'mouse';
        event.currentTarget.setPointerCapture(event.pointerId);
        if (touch) {
          touches.current.set(event.pointerId, pt);
          if (touches.current.size >= 2) {
            const [a, b] = Array.from(touches.current.values());
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
            press.current = null;
            pressedAt.current = null;
            return;
          }
        }
        const pos = positionAt(pt.x, pt.y);
        press.current = { id: event.pointerId, pos, touch, button: event.button, sx: pt.x, sy: pt.y, lx: pt.x, ly: pt.y, elapsed: 0, moved: false, panning: false, longDone: false, chordDone: false, flagDone: false };
        if (touch) {
          pressedAt.current = pos;
          return;
        }
        cursorVisible.current = false;
        if (event.button === 2) {
          press.current.flagDone = true;
          if (pos) performFlag(pos[0], pos[1]);
        } else if (event.button === 1) {
          press.current.chordDone = true;
          if (pos) performReveal(pos[0], pos[1]);
        } else {
          pressedAt.current = pos;
          chordIfHeld(event, pos);
        }
      }}
      onPointerMove={(event) => {
        const pt = point(event);
        const touch = event.pointerType !== 'mouse';
        if (touch && touches.current.has(event.pointerId)) {
          touches.current.set(event.pointerId, pt);
          const pn = pinch.current;
          if (pn && touches.current.size >= 2) {
            const [a, b] = Array.from(touches.current.values());
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            pan.current.x += mx - pn.mx;
            pan.current.y += my - pn.my;
            zoomAt(mx, my, dist / pn.dist);
            pinch.current = { dist, mx, my };
            return;
          }
        }
        const p = press.current;
        if (!p) {
          if (!touch) {
            const pos = positionAt(pt.x, pt.y);
            if (pos && (pos[0] !== hover.current?.[0] || pos[1] !== hover.current?.[1])) {
              cursorVisible.current = false;
              cursor.current = pos;
            }
            hover.current = pos;
          }
          return;
        }
        if (p.id !== event.pointerId) return;
        const pos = positionAt(pt.x, pt.y);
        if (!touch) {
          hover.current = pos;
          chordIfHeld(event, pos);
        }
        if (!p.moved && Math.hypot(pt.x - p.sx, pt.y - p.sy) > 8 * uRef.current) {
          p.moved = true;
          p.panning = geo().overflow && !(touch === false && (event.buttons & 2) !== 0);
        }
        if (p.moved) {
          if (p.panning) {
            pan.current.x += pt.x - p.lx;
            pan.current.y += pt.y - p.ly;
            pressedAt.current = null;
          } else if (!touch && p.button === 0 && !p.chordDone) {
            p.pos = pos;
            pressedAt.current = pos;
          } else pressedAt.current = null;
        }
        p.lx = pt.x;
        p.ly = pt.y;
      }}
      onPointerUp={(event) => {
        const touch = event.pointerType !== 'mouse';
        if (touch) {
          touches.current.delete(event.pointerId);
          if (pinch.current) {
            if (touches.current.size < 2) pinch.current = null;
            return;
          }
        }
        const p = press.current;
        if (!p || p.id !== event.pointerId) return;
        press.current = null;
        pressedAt.current = null;
        if (p.panning || p.longDone || p.chordDone || p.flagDone || (touch && p.moved)) return;
        const pos = touch ? p.pos : positionAt(point(event).x, point(event).y);
        if (!pos) return;
        if (touch) performAction(pos[0], pos[1], modeRef.current === 'flag');
        else if (p.button === 0) performReveal(pos[0], pos[1]);
      }}
      onPointerCancel={(event) => {
        touches.current.delete(event.pointerId);
        if (touches.current.size < 2) pinch.current = null;
        press.current = null;
        pressedAt.current = null;
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && !press.current) hover.current = null;
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
    <div ref={hudRef} className={`g-minesweeper-hud${layout.hud.column ? ' is-column' : ''}`} style={{ left: layout.hud.x, top: layout.hud.y }}>
      <div className="g-minesweeper-chip"><span>Mines</span><strong>{g.mineTotal - g.flags}</strong></div>
      <div className="g-minesweeper-chip"><span>Time</span><strong>{formatTime(g.seconds)}</strong></div>
      <div className="g-minesweeper-chip"><span>Best</span><strong>{formatTime(best)}</strong></div>
    </div>
    {touchUi && <Segmented value={mode} options={modeOptions} onChange={setMode} className="g-minesweeper-modes" />}
  </>;
}

type SpriteKind = 'up' | 'lit' | 'down' | 'downAlt';

/** Square tiles drawn once per size instead of rebuilding gradients for every cell every frame. */
function sprite(cache: Map<string, HTMLCanvasElement>, kind: SpriteKind, cell: number, dpr: number): HTMLCanvasElement {
  const px = Math.max(2, Math.round(cell * dpr));
  const key = `${kind}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 24) cache.clear();
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const c = canvas.getContext('2d')!;
  const s = px;
  if (kind === 'down' || kind === 'downAlt') {
    c.fillStyle = kind === 'down' ? '#1a1d24' : '#1d2029';
    c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.fillRect(0, 0, s, Math.max(1, s * 0.04));
    c.fillRect(0, 0, Math.max(1, s * 0.04), s);
  } else {
    const pad = Math.max(dpr * 0.6, s * 0.045);
    const lip = Math.max(dpr, s * 0.075);
    const radius = s * 0.2;
    const w = s - pad * 2;
    c.fillStyle = kind === 'lit' ? '#48526a' : '#363e52';
    c.beginPath();
    c.roundRect(pad, pad, w, w, radius);
    c.fill();
    const face = c.createLinearGradient(0, pad, 0, s - pad - lip);
    if (kind === 'lit') {
      face.addColorStop(0, '#8994b0');
      face.addColorStop(1, '#6c7894');
    } else {
      face.addColorStop(0, '#6e7a96');
      face.addColorStop(1, '#58637d');
    }
    c.fillStyle = face;
    c.beginPath();
    c.roundRect(pad, pad, w, w - lip, radius);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.22)';
    c.lineWidth = Math.max(dpr * 0.5, s * 0.025);
    c.beginPath();
    c.roundRect(pad + c.lineWidth / 2, pad + c.lineWidth / 2, w - c.lineWidth, w - lip - c.lineWidth, radius);
    c.stroke();
  }
  cache.set(key, canvas);
  return canvas;
}

function drawFlag(c: CanvasRenderingContext2D, x: number, y: number, size: number, wrong: boolean) {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.beginPath();
  c.ellipse(x, y + size * 0.72, size * 0.5, size * 0.13, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#f5f5f7';
  c.lineWidth = Math.max(1.2, size * 0.16);
  c.beginPath();
  c.moveTo(x - size * 0.2, y + size * 0.7);
  c.lineTo(x - size * 0.2, y - size * 0.62);
  c.stroke();
  c.fillStyle = wrong ? '#8e8e93' : '#ff453a';
  c.beginPath();
  c.moveTo(x - size * 0.12, y - size * 0.66);
  c.quadraticCurveTo(x + size * 0.35, y - size * 0.5, x + size * 0.72, y - size * 0.28);
  c.quadraticCurveTo(x + size * 0.3, y - size * 0.14, x - size * 0.12, y + size * 0.06);
  c.closePath();
  c.fill();
  if (wrong) {
    c.strokeStyle = '#ff453a';
    c.lineWidth = Math.max(1.6, size * 0.2);
    c.beginPath();
    c.moveTo(x - size * 0.8, y - size * 0.8);
    c.lineTo(x + size * 0.8, y + size * 0.8);
    c.moveTo(x + size * 0.8, y - size * 0.8);
    c.lineTo(x - size * 0.8, y + size * 0.8);
    c.stroke();
  }
  c.restore();
}

function drawMine(c: CanvasRenderingContext2D, x: number, y: number, radius: number, exploded: boolean) {
  c.save();
  const body = exploded ? '#1c1c1e' : '#e8e8ed';
  c.strokeStyle = body;
  c.lineCap = 'round';
  c.lineWidth = Math.max(1, radius * 0.22);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const reach = i % 2 ? 1.05 : 1.3;
    c.beginPath();
    c.moveTo(x + Math.cos(angle) * radius * 0.5, y + Math.sin(angle) * radius * 0.5);
    c.lineTo(x + Math.cos(angle) * radius * reach, y + Math.sin(angle) * radius * reach);
    c.stroke();
  }
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, radius * 0.78, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = exploded ? 'rgba(255,255,255,.35)' : '#ffffff';
  c.beginPath();
  c.arc(x - radius * 0.26, y - radius * 0.26, radius * 0.17, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
