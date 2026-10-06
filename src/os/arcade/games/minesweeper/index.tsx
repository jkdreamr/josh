import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createGame, neighbors, reveal, tick, toggleFlag, type Level, type MinesGame, type Position } from './logic';
import { meta } from './meta';
import './minesweeper.css';

const levelNames: Level[] = ['beginner', 'intermediate', 'expert'];
const numberColors = ['', '#64d2ff', '#30d158', '#ff453a', '#bf5af2', '#ff9f0a', '#5ac8fa', '#f5f5f7', '#8e8e93'];
const levelText: Record<Level, string> = { beginner: 'beginner', intermediate: 'intermediate', expert: 'expert' };

type Pointer = { id: number; row: number; col: number; touch: boolean; elapsed: number; longDone: boolean; moved: boolean; startX: number; startY: number; button: number; chordDone: boolean };
type Effect = { row: number; col: number; delay: number; age: number };
type Layout = { rows: number; cols: number; cell: number; x: number; y: number; transposed: boolean };

function readLevel(): Level {
  try {
    const stored = window.localStorage.getItem('arcade:minesweeper:level');
    return stored && levelNames.includes(stored as Level) ? stored as Level : 'beginner';
  } catch {
    return 'beginner';
  }
}

function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function layoutFor(w: number, h: number, game: MinesGame): Layout {
  const transposed = game.cols > game.rows && h > w;
  const rows = transposed ? game.cols : game.rows;
  const cols = transposed ? game.rows : game.cols;
  const cell = Math.max(4, Math.min((w - 24) / cols, (h - 130) / rows));
  return { rows, cols, cell, x: (w - cols * cell) / 2, y: 112 + Math.max(0, (h - 112 - rows * cell) / 2), transposed };
}

function toBoardPosition(layout: Layout, viewRow: number, viewCol: number): Position {
  return layout.transposed ? [viewCol, viewRow] : [viewRow, viewCol];
}

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit}><Play /></GameShell>;
}

function Play() {
  const shell = useShell();
  const [level, setLevel] = useState<Level>(readLevel);
  const [mode, setMode] = useState<'dig' | 'flag'>('dig');
  const [, setHudRevision] = useState(0);
  const refreshHud = () => setHudRevision((revision) => revision + 1);
  const beginnerBest = useHighScore('minesweeper-beginner', { lowerIsBetter: true });
  const intermediateBest = useHighScore('minesweeper-intermediate', { lowerIsBetter: true });
  const expertBest = useHighScore('minesweeper-expert', { lowerIsBetter: true });
  const bestForLevel = (which: Level) => which === 'beginner' ? beginnerBest : which === 'intermediate' ? intermediateBest : expertBest;
  const game = useRef<MinesGame | null>(null);
  if (!game.current) game.current = createGame(level);
  const { ref, size, ctx } = useCanvas();
  const pointer = useRef<Pointer | null>(null);
  const pressedAt = useRef<Position | null>(null);
  const hover = useRef<Position | null>(null);
  const keyboardCursor = useRef<Position | null>(null);
  const cursorVisible = useRef(false);
  const revealEffects = useRef<Effect[]>([]);
  const particles = useRef<{ x: number; y: number; vx: number; vy: number; age: number; life: number; color: string }[]>([]);
  const lossAge = useRef<number | null>(null);
  const lossMines = useRef<Position[]>([]);
  const winDelay = useRef<{ remaining: number; detail: string } | null>(null);
  const hudTime = useRef(0);
  const lastNow = useRef<number | null>(null);

  useEffect(() => {
    if (shell.status !== 'playing') lastNow.current = null;
  }, [shell.status]);

  const setBoardLevel = (next: Level) => {
    if (next === level) return;
    setLevel(next);
    game.current = createGame(next);
    pointer.current = null;
    revealEffects.current = [];
    particles.current = [];
    lossAge.current = null;
    winDelay.current = null;
    try { window.localStorage.setItem('arcade:minesweeper:level', next); } catch { /* private mode */ }
    refreshHud();
    sfx.play('select');
  };

  const noteReveal = (result: ReturnType<typeof reveal>, row: number, col: number) => {
    const s = game.current!;
    if (result.revealed.length) {
      revealEffects.current = result.revealed.map(([r, c]) => ({ row: r, col: c, delay: (Math.abs(r - row) + Math.abs(c - col)) * 0.015, age: 0 }));
      sfx.play('tick', 0.72);
    }
    if (result.lost) {
      lossAge.current = 0;
      lossMines.current = result.revealed.filter(([r, c]) => s.board[r][c].mine);
      sfx.play('hit', 0.7);
      sfx.play('boom', 0.65);
    }
    if (result.won) {
      const seconds = Math.max(1, Math.floor(s.seconds));
      const newBest = bestForLevel(s.level).submit(seconds);
      const detail = newBest
        ? `new best on ${s.level}: ${formatTime(seconds)}.`
        : `${s.level} in ${formatTime(seconds)}. best ${formatTime(bestForLevel(s.level).best)}.`;
      winDelay.current = { remaining: 0.7, detail };
      for (let i = 0; i < 34; i++) particles.current.push({
        x: size.w / 2,
        y: size.h / 2,
        vx: (Math.random() - 0.5) * 240,
        vy: (Math.random() - 0.7) * 210,
        age: 0,
        life: 0.45 + Math.random() * 0.55,
        color: ['#64d2ff', '#30d158', '#ffd60a', '#bf5af2', '#ff9f0a'][i % 5],
      });
      sfx.play('win');
    }
    if (result.changed) refreshHud();
  };

  const performReveal = (row: number, col: number) => {
    const result = reveal(game.current!, row, col);
    noteReveal(result, row, col);
  };

  const performFlag = (row: number, col: number) => {
    if (toggleFlag(game.current!, row, col)) {
      refreshHud();
      sfx.play('select', 0.8);
    }
  };

  const performAction = (row: number, col: number, flag: boolean) => {
    if (flag) performFlag(row, col);
    else performReveal(row, col);
  };

  const revealMouseChord = (event: RPointerEvent<HTMLCanvasElement>, pos: Position | null) => {
    if (event.pointerType !== 'mouse' || !pos || pointer.current?.chordDone) return;
    const middleClick = event.type === 'pointerdown' && event.button === 1;
    const middleHeld = (event.buttons & 4) !== 0;
    const leftAndRightHeld = (event.buttons & 3) === 3;
    if (!middleClick && !middleHeld && !leftAndRightHeld) return;
    performReveal(pos[0], pos[1]);
    if (pointer.current) pointer.current.chordDone = true;
  };

  const positionAt = (offsetX: number, offsetY: number): Position | null => {
    const layout = layoutFor(size.w, size.h, game.current!);
    const col = Math.floor((offsetX - layout.x) / layout.cell);
    const row = Math.floor((offsetY - layout.y) / layout.cell);
    if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return null;
    return toBoardPosition(layout, row, col);
  };

  useKeys((code, event) => {
    const s = game.current!;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(code)) {
      cursorVisible.current = true;
      keyboardCursor.current ??= [Math.floor(s.rows / 2), Math.floor(s.cols / 2)];
      const [row, col] = keyboardCursor.current;
      if (code === 'ArrowLeft' || code === 'KeyA') keyboardCursor.current = [row, Math.max(0, col - 1)];
      if (code === 'ArrowRight' || code === 'KeyD') keyboardCursor.current = [row, Math.min(s.cols - 1, col + 1)];
      if (code === 'ArrowUp' || code === 'KeyW') keyboardCursor.current = [Math.max(0, row - 1), col];
      if (code === 'ArrowDown' || code === 'KeyS') keyboardCursor.current = [Math.min(s.rows - 1, row + 1), col];
    } else if ((code === 'Space' || code === 'Enter') && !event?.repeat && keyboardCursor.current) {
      performReveal(keyboardCursor.current[0], keyboardCursor.current[1]);
    } else if (code === 'KeyF' && !event?.repeat && keyboardCursor.current) performFlag(keyboardCursor.current[0], keyboardCursor.current[1]);
  });

  useGameLoop((dt) => {
    const s = game.current!;
    const now = performance.now();
    const previousNow = lastNow.current;
    lastNow.current = now;
    tick(s, previousNow === null ? 0 : Math.min((now - previousNow) / 1000, 0.25));
    hudTime.current += dt;
    if (hudTime.current >= 0.25) {
      hudTime.current = 0;
      refreshHud();
    }
    if (pointer.current?.touch && !pointer.current.longDone && !pointer.current.moved) {
      pointer.current.elapsed += dt;
      if (pointer.current.elapsed >= 0.35) {
        const p = pointer.current;
        p.longDone = true;
        performAction(p.row, p.col, mode === 'dig');
        navigator.vibrate?.(12);
      }
    }
    for (let i = revealEffects.current.length - 1; i >= 0; i--) {
      revealEffects.current[i].age += dt;
      if (revealEffects.current[i].age - revealEffects.current[i].delay > 0.28) revealEffects.current.splice(i, 1);
    }
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 360 * dt;
      if (p.age >= p.life) particles.current.splice(i, 1);
    }
    if (lossAge.current !== null) {
      lossAge.current += dt;
      if (lossAge.current >= 0.9) {
        lossAge.current = null;
        shell.gameOver(undefined, { title: 'boom', detail: `you hit a mine on ${s.level}.` });
      }
    }
    if (winDelay.current) {
      winDelay.current.remaining -= dt;
      if (winDelay.current.remaining <= 0) {
        const { detail } = winDelay.current;
        winDelay.current = null;
        shell.gameOver(undefined, { title: 'cleared', detail });
      }
    }
  }, () => {
    const c = ctx();
    if (!c) return;
    const s = game.current!;
    const layout = layoutFor(size.w, size.h, s);
    c.clearRect(0, 0, size.w, size.h);
    c.fillStyle = 'rgba(255,255,255,.035)';
    c.beginPath();
    c.roundRect(layout.x - 4, layout.y - 4, layout.cols * layout.cell + 8, layout.rows * layout.cell + 8, 10);
    c.fill();
    const effectByPosition = new Map(revealEffects.current.map((effect) => [`${effect.row}:${effect.col}`, effect]));
    const preview = pressedAt.current && s.board[pressedAt.current[0]][pressedAt.current[1]].revealed
      ? new Set(neighbors(s, pressedAt.current[0], pressedAt.current[1]).map(([r, col]) => `${r}:${col}`))
      : new Set<string>();
    for (let vr = 0; vr < layout.rows; vr++) for (let vc = 0; vc < layout.cols; vc++) {
      const [row, col] = toBoardPosition(layout, vr, vc);
      const cell = s.board[row][col];
      const x = layout.x + vc * layout.cell;
      const y = layout.y + vr * layout.cell;
      const pad = Math.max(0.6, layout.cell * 0.035);
      const key = `${row}:${col}`;
      const revealFx = effectByPosition.get(key);
      const effectProgress = revealFx ? Math.max(0, Math.min(1, (revealFx.age - revealFx.delay) / 0.24)) : 1;
      const offset = preview.has(key) ? Math.max(1, layout.cell * 0.07) : 0;
      c.save();
      if (revealFx && effectProgress < 1) {
        c.globalAlpha = 0.25 + effectProgress * 0.75;
        const scale = 0.82 + effectProgress * 0.18;
        c.translate(x + layout.cell / 2, y + layout.cell / 2);
        c.scale(scale, scale);
        c.translate(-(x + layout.cell / 2), -(y + layout.cell / 2));
      }
      if (cell.revealed) {
        if (s.clickedMine?.[0] === row && s.clickedMine[1] === col && lossAge.current !== null && lossAge.current < 0.48) {
          c.fillStyle = Math.floor(lossAge.current * 18) % 2 === 0 ? 'rgba(255,69,58,.88)' : 'rgba(255,69,58,.34)';
        } else c.fillStyle = 'rgba(9,10,14,.7)';
        c.fillRect(x + pad, y + pad + offset, layout.cell - pad * 2, layout.cell - pad * 2);
        c.strokeStyle = 'rgba(255,255,255,.035)';
        c.lineWidth = 0.5;
        c.strokeRect(x + pad, y + pad + offset, layout.cell - pad * 2, layout.cell - pad * 2);
        if (cell.mine) {
          if (lossAge.current === null) drawMine(c, x + layout.cell / 2, y + layout.cell / 2 + offset, layout.cell * 0.23, cell.wrongFlag);
          else {
            const mineIndex = lossMines.current.findIndex(([r, mineCol]) => r === row && mineCol === col);
            const delay = lossMines.current.length > 1 ? Math.max(0, mineIndex) * 0.48 / (lossMines.current.length - 1) : 0;
            const progress = Math.min(1, Math.max(0, (lossAge.current - delay) * 8));
            c.globalAlpha *= progress;
            drawMine(c, x + layout.cell / 2, y + layout.cell / 2 + offset, layout.cell * 0.23, cell.wrongFlag);
          }
        }
        else if (cell.adjacent) {
          c.fillStyle = numberColors[cell.adjacent];
          c.font = `700 ${Math.max(9, layout.cell * 0.62)}px Inter, -apple-system, system-ui, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(String(cell.adjacent), x + layout.cell / 2, y + layout.cell / 2 + offset + layout.cell * 0.02);
        }
      } else {
        const gradient = c.createLinearGradient(x, y + offset, x, y + layout.cell + offset);
        gradient.addColorStop(0, 'rgba(255,255,255,.17)');
        gradient.addColorStop(0.45, 'rgba(255,255,255,.1)');
        gradient.addColorStop(1, 'rgba(255,255,255,.065)');
        c.fillStyle = gradient;
        c.beginPath();
        c.roundRect(x + pad, y + pad + offset, layout.cell - pad * 2, layout.cell - pad * 2, Math.max(1.5, layout.cell * 0.13));
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,.12)';
        c.lineWidth = 0.6;
        c.stroke();
        if (cell.flagged) drawFlag(c, x + layout.cell / 2, y + layout.cell / 2 + offset, layout.cell * 0.29);
        if (cell.wrongFlag) {
          c.strokeStyle = '#ff453a';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x + pad * 3, y + pad * 3);
          c.lineTo(x + layout.cell - pad * 3, y + layout.cell - pad * 3);
          c.moveTo(x + layout.cell - pad * 3, y + pad * 3);
          c.lineTo(x + pad * 3, y + layout.cell - pad * 3);
          c.stroke();
        }
      }
      c.restore();
      const hoverPos = hover.current;
      const cursor = cursorVisible.current ? keyboardCursor.current : null;
      if ((hoverPos?.[0] === row && hoverPos[1] === col) || (cursor?.[0] === row && cursor[1] === col)) {
        c.strokeStyle = cursor && cursor[0] === row && cursor[1] === col ? '#f5f5f7' : 'rgba(255,255,255,.56)';
        c.lineWidth = Math.max(1.2, layout.cell * 0.055);
        c.strokeRect(x + pad + 0.4, y + pad + 0.4, layout.cell - pad * 2 - 0.8, layout.cell - pad * 2 - 0.8);
      }
    }
    for (const p of particles.current) {
      c.globalAlpha = Math.max(0, 1 - p.age / p.life);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  });

  return <>
    <canvas
      ref={ref}
      className="g-minesweeper-canvas"
      onPointerDown={(event) => {
        event.preventDefault();
        const pos = positionAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
        if (!pos) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const isTouch = shell.touch || event.pointerType !== 'mouse';
        pointer.current = { id: event.pointerId, row: pos[0], col: pos[1], touch: isTouch, elapsed: 0, longDone: false, moved: false, startX: event.clientX, startY: event.clientY, button: event.button, chordDone: false };
        pressedAt.current = pos;
        if (!isTouch) revealMouseChord(event, pos);
      }}
      onPointerMove={(event) => {
        const pos = positionAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
        if (!pointer.current) {
          if (event.pointerType === 'mouse') hover.current = pos;
          return;
        }
        const p = pointer.current;
        if (p.id !== event.pointerId) return;
        revealMouseChord(event, pos);
        if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) > 10) {
          p.moved = true;
          p.elapsed = 0;
          pressedAt.current = null;
        }
      }}
      onPointerUp={(event) => {
        const releasePosition = positionAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
        const p = pointer.current;
        if (!p || p.id !== event.pointerId) return;
        pointer.current = null;
        pressedAt.current = null;
        if (p.moved || p.longDone || p.chordDone) return;
        const [row, col] = releasePosition ?? [p.row, p.col];
        if (p.touch) performAction(row, col, mode === 'flag');
        else if (event.button === 0) performReveal(row, col);
        else if (event.button === 2) performFlag(row, col);
        else if (event.button === 1) performReveal(row, col);
      }}
      onPointerCancel={() => { pointer.current = null; pressedAt.current = null; }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse' && !pointer.current) hover.current = null; }}
      onContextMenu={(event) => event.preventDefault()}
    />
    <div className="g-minesweeper-hud">
      <div className="g-minesweeper-levels" role="group" aria-label="Difficulty">
        {levelNames.map((choice) => <button key={choice} type="button" aria-pressed={level === choice} onClick={() => setBoardLevel(choice)}>
          <span className="g-minesweeper-long">{levelText[choice]}</span>
          <span className="g-minesweeper-short">{choice === 'beginner' ? 'easy' : choice === 'intermediate' ? 'medium' : 'hard'}</span>
        </button>)}
      </div>
      <div className="g-minesweeper-metrics">
        <div className="g-minesweeper-metric"><span>mines</span><strong>{game.current.mineTotal - game.current.flags}</strong></div>
        <div className="g-minesweeper-metric"><span>time</span><strong>{formatTime(game.current.seconds)}</strong></div>
        <div className="g-minesweeper-metric g-minesweeper-best"><span>best</span><strong>{formatTime(bestForLevel(level).best)}</strong></div>
        {shell.touch && <button className="g-minesweeper-mode" type="button" onClick={() => setMode((current) => current === 'dig' ? 'flag' : 'dig')}>{mode}</button>}
      </div>
    </div>
  </>;
}

function drawFlag(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = '#f5f5f7';
  c.lineWidth = Math.max(1.1, size * 0.16);
  c.beginPath();
  c.moveTo(x - size * 0.12, y + size * 0.62);
  c.lineTo(x - size * 0.12, y - size * 0.55);
  c.stroke();
  c.fillStyle = '#ff453a';
  c.beginPath();
  c.moveTo(x, y - size * 0.48);
  c.lineTo(x + size * 0.75, y - size * 0.18);
  c.lineTo(x, y + size * 0.08);
  c.closePath();
  c.fill();
  c.restore();
}

function drawMine(c: CanvasRenderingContext2D, x: number, y: number, radius: number, wrong: boolean) {
  c.save();
  c.strokeStyle = wrong ? '#ff453a' : '#f5f5f7';
  c.fillStyle = wrong ? '#ff453a' : '#e8e8ed';
  c.lineWidth = Math.max(1, radius * 0.18);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    c.beginPath();
    c.moveTo(x + Math.cos(angle) * radius * 0.64, y + Math.sin(angle) * radius * 0.64);
    c.lineTo(x + Math.cos(angle) * radius * 1.25, y + Math.sin(angle) * radius * 1.25);
    c.stroke();
  }
  c.beginPath();
  c.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,.75)';
  c.beginPath();
  c.arc(x - radius * 0.24, y - radius * 0.24, radius * 0.13, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
