import { useRef, useState } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { canMove, createGame, move, spawn, undo, type Direction, type Grid, type TileMove } from './logic';
import { meta } from './meta';
import './2048.css';

type Animation = { elapsed: number; moves: TileMove[]; merges: [number, number][]; spawn: [number, number] | null };
type State = {
  grid: Grid;
  score: number;
  previous: { grid: Grid; score: number } | null;
  undoUsed: boolean;
  animation: Animation | null;
  won: boolean;
  toast: number;
  lossDelay: number;
  shaking: number;
  floater: { amount: number; time: number } | null;
};

const initial = (): State => ({ grid: createGame(), score: 0, previous: null, undoUsed: false, animation: null, won: false, toast: 0, lossDelay: 0, shaking: 0, floater: null });
const easeCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const tileColor = (value: number) => {
  if (value <= 4) return '#d9e0e8';
  if (value <= 16) return '#ffcf91';
  if (value <= 64) return '#ffad54';
  if (value <= 256) return '#ff9f0a';
  if (value <= 1024) return '#ffd166';
  return '#ffe08a';
};

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit}><Play /></GameShell>;
}

function Play() {
  const shell = useShell();
  const high = useHighScore('2048');
  const best = Math.max(high.best ?? 0, 0);
  const [, setHudRevision] = useState(0);
  const refreshHud = () => setHudRevision((revision) => revision + 1);
  const state = useRef<State>(initial());
  const { ref, size, ctx } = useCanvas();
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);

  const performUndo = () => {
    const s = state.current;
    if (s.undoUsed) return;
    if (s.animation) s.animation = null;
    const result = undo({ grid: s.grid, score: s.score, used: s.undoUsed }, s.previous);
    if (!result.restored) return;
    s.grid = result.state.grid;
    s.score = result.state.score;
    s.undoUsed = true;
    s.previous = null;
    s.lossDelay = 0;
    s.shaking = 0;
    s.floater = null;
    shell.setScore(s.score);
    refreshHud();
    sfx.play('select');
  };

  const playMove = (direction: Direction) => {
    const s = state.current;
    const fastForwarded = !!s.animation;
    if (fastForwarded) s.animation = null;
    const result = move(s.grid, direction);
    if (!result.moved) return;
    if (!s.undoUsed) s.previous = { grid: s.grid.map((row) => [...row]), score: s.score };
    const next = spawn(result.grid);
    s.grid = next.grid;
    s.score += result.gained;
    s.floater = result.gained ? { amount: result.gained, time: 0 } : null;
    s.animation = fastForwarded ? null : { elapsed: 0, moves: result.moves, merges: result.moves.filter((m) => m.merged).map((m) => m.to).filter((p, i, all) => all.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i), spawn: next.position };
    shell.setScore(s.score);
    high.submit(s.score);
    refreshHud();
    if (!s.won && s.grid.some((row) => row.some((value) => value >= 2048))) {
      s.won = true;
      s.toast = 2.1;
      sfx.play('win');
    } else sfx.play('blip', 0.82);
    if (!canMove(s.grid)) {
      s.lossDelay = 0.45;
      s.shaking = 0.34;
    }
  };

  useKeys((code, event) => {
    if (event?.repeat) return;
    if (code === 'ArrowLeft' || code === 'KeyA') playMove('left');
    else if (code === 'ArrowRight' || code === 'KeyD') playMove('right');
    else if (code === 'ArrowUp' || code === 'KeyW') playMove('up');
    else if (code === 'ArrowDown' || code === 'KeyS') playMove('down');
    else if (code === 'KeyU' || code === 'Backspace') {
      if (code === 'Backspace') event?.preventDefault();
      performUndo();
    }
  });

  useGameLoop((dt) => {
    const s = state.current;
    if (s.animation) {
      s.animation.elapsed += dt;
      if (s.animation.elapsed >= 0.27) s.animation = null;
    }
    s.toast = Math.max(0, s.toast - dt);
    s.shaking = Math.max(0, s.shaking - dt);
    if (s.floater) {
      s.floater.time += dt;
      if (s.floater.time > 0.72) s.floater = null;
    }
    if (s.lossDelay > 0) {
      s.lossDelay -= dt;
      if (s.lossDelay <= 0) {
        s.lossDelay = 0;
        shell.gameOver(s.score, { detail: `best tile ${Math.max(...s.grid.flat())}.` });
        sfx.play('lose');
      }
    }
  }, () => {
    const c = ctx();
    if (!c) return;
    const { w, h } = size;
    c.clearRect(0, 0, w, h);
    const boardSize = Math.max(0, Math.min(w - 28, h - 132, 520));
    const x0 = (w - boardSize) / 2;
    const y0 = 98 + Math.max(0, (h - 98 - boardSize) / 2);
    const gap = Math.max(5, boardSize * 0.025);
    const tileSize = (boardSize - gap * 5) / 4;
    if (state.current.shaking > 0) c.translate(Math.sin(state.current.shaking * 90) * state.current.shaking * 8, 0);
    c.fillStyle = 'rgba(255,255,255,.06)';
    c.beginPath();
    c.roundRect(x0 - 9, y0 - 9, boardSize + 18, boardSize + 18, 14);
    c.fill();
    for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) {
      const x = x0 + gap + col * (tileSize + gap);
      const y = y0 + gap + r * (tileSize + gap);
      c.fillStyle = 'rgba(255,255,255,.05)';
      c.beginPath();
      c.roundRect(x, y, tileSize, tileSize, Math.min(12, tileSize * 0.15));
      c.fill();
    }
    const s = state.current;
    if (s.animation && s.animation.elapsed < 0.11) {
      const progress = easeCubic(Math.min(1, s.animation.elapsed / 0.11));
      for (const item of s.animation.moves) {
        const x = x0 + gap + (item.from[1] + (item.to[1] - item.from[1]) * progress) * (tileSize + gap);
        const y = y0 + gap + (item.from[0] + (item.to[0] - item.from[0]) * progress) * (tileSize + gap);
        drawTile(c, x, y, tileSize, item.value);
      }
    } else {
      for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) {
        const value = s.grid[r][col];
        if (!value) continue;
        const mergeIndex = s.animation?.merges.findIndex((p) => p[0] === r && p[1] === col) ?? -1;
        let scale = 1;
        if (mergeIndex >= 0 && s.animation) {
          const t = Math.min(1, Math.max(0, (s.animation.elapsed - 0.11) / 0.14));
          scale = 1 + (t < 0.5 ? t * 0.36 : (1 - t) * 0.36);
        }
        if (s.animation?.spawn && s.animation.spawn[0] === r && s.animation.spawn[1] === col) {
          const t = Math.min(1, Math.max(0, (s.animation.elapsed - 0.11) / 0.16));
          scale = Math.max(scale, easeBack(t));
        }
        const size = tileSize * scale;
        drawTile(c, x0 + gap + col * (tileSize + gap) - (size - tileSize) / 2, y0 + gap + r * (tileSize + gap) - (size - tileSize) / 2, size, value);
      }
    }
    if (s.floater) {
      const progress = s.floater.time / 0.72;
      c.globalAlpha = Math.max(0, 1 - progress);
      c.fillStyle = '#f5f5f7';
      c.font = '600 15px Inter, -apple-system, system-ui, sans-serif';
      c.textAlign = 'right';
      c.fillText(`+${s.floater.amount}`, x0 + boardSize - 4, y0 - 15 - progress * 24);
      c.globalAlpha = 1;
    }
    if (s.toast > 0) {
      c.globalAlpha = Math.min(1, s.toast * 2);
      c.fillStyle = 'rgba(255,255,255,.94)';
      c.font = '600 13px Inter, -apple-system, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('you made 2048. keep going.', w / 2, Math.max(68, y0 - 14));
      c.globalAlpha = 1;
    }
    c.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  });

  return <>
    <canvas
      ref={ref}
      className="g-2048-canvas"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        touch.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = touch.current;
        if (!start || start.id !== e.pointerId) return;
        touch.current = null;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        playMove(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
      }}
      onPointerCancel={() => { touch.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    />
    <div className="g-2048-hud">
      <div className="g-2048-bests">
        <div className="g-2048-stat"><span>best</span><strong>{best.toLocaleString('en-US')}</strong></div>
        <div className="g-2048-stat"><span>score</span><strong>{state.current.score.toLocaleString('en-US')}</strong></div>
      </div>
      <button className="g-2048-undo" type="button" disabled={state.current.undoUsed || !state.current.previous} onClick={performUndo}>undo</button>
    </div>
  </>;
}

function drawTile(c: CanvasRenderingContext2D, x: number, y: number, size: number, value: number) {
  const pad = Math.max(1, size * 0.045);
  c.save();
  c.shadowColor = value >= 1024 ? 'rgba(255,185,68,.25)' : 'transparent';
  c.shadowBlur = value >= 1024 ? size * 0.26 : 0;
  c.fillStyle = tileColor(value);
  c.beginPath();
  c.roundRect(x + pad, y + pad, size - pad * 2, size - pad * 2, Math.min(12, size * 0.17));
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = value >= 32 ? '#fff' : '#24252a';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const digits = String(value).length;
  c.font = `650 ${Math.max(11, size * (digits <= 2 ? 0.34 : digits === 3 ? 0.27 : 0.21))}px Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  c.fillText(String(value), x + size / 2, y + size / 2 + size * 0.015);
  c.restore();
}
