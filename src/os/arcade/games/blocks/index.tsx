import { useRef } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { cellsFor, createGame, ghostY, gravitySeconds, hardDrop, holdPiece, lock, move, rotate, type BlocksGame, type Piece } from './logic';
import { meta } from './meta';
import './blocks.css';

const colors: Record<Piece, string> = {
  I: '#64d2ff',
  O: '#ffd60a',
  T: '#bf5af2',
  S: '#30d158',
  Z: '#ff453a',
  J: '#0a84ff',
  L: '#ff9f0a',
};

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit}><Play /></GameShell>;
}

function Play() {
  const shell = useShell();
  const keys = useKeys((code, event) => {
    if (event?.repeat) return;
    const s = state.current;
    if (code === 'Space') {
      if (s.active) vfx.current.streak = { x: s.active.x + 1.5, top: s.active.y, bottom: ghostY(s), life: 0.16 };
      hardDrop(s);
      sfx.play('hit', 0.72);
      shell.setScore(s.score);
    } else if (['ArrowUp', 'KeyX', 'KeyW'].includes(code)) {
      if (rotate(s, 1)) sfx.play('blip', 1.2);
    } else if (['KeyZ', 'KeyQ'].includes(code)) {
      if (rotate(s, -1)) sfx.play('blip', 0.92);
    } else if (['KeyC', 'ShiftLeft', 'ShiftRight'].includes(code)) {
      if (holdPiece(s)) sfx.play('select');
    }
  });
  const { ref, size, ctx } = useCanvas();
  const state = useRef<BlocksGame>(createGame());
  const timing = useRef({ gravity: 0, lock: 0, dir: 0, das: 0, arr: 0, soft: 0, lines: 0 });
  const vfx = useRef({ particles: [] as { x: number; y: number; vx: number; vy: number; life: number; color: string }[], toast: 0, streak: null as { x: number; top: number; bottom: number; life: number } | null });
  const gesture = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; verticalCells: number; time: number; moved: boolean; vertical: boolean; fastUp: boolean } | null>(null);

  const performDrop = () => {
    const s = state.current;
    const piece = s.active;
    if (!piece) return;
    const landing = ghostY(s);
    vfx.current.streak = { x: piece.x + 1.5, top: piece.y, bottom: landing, life: 0.16 };
    hardDrop(s);
    sfx.play('hit', 0.72);
    shell.setScore(s.score);
  };

  const touchAction = (action: 'hold' | 'ccw') => {
    if (action === 'hold') {
      if (holdPiece(state.current)) sfx.play('select');
    } else if (rotate(state.current, -1)) sfx.play('blip', 0.92);
  };

  useGameLoop((dt) => {
    const s = state.current;
    const t = timing.current;
    const fx = vfx.current;
    s.clearFlash = Math.max(0, s.clearFlash - dt);
    s.lockFlash = Math.max(0, s.lockFlash - dt);
    s.dropFlash = Math.max(0, s.dropFlash - dt);
    fx.toast = Math.max(0, fx.toast - dt);
    if (fx.streak) {
      fx.streak.life -= dt;
      if (fx.streak.life <= 0) fx.streak = null;
    }
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      if (p.life <= 0) fx.particles.splice(i, 1);
    }
    if (s.over) {
      sfx.play('lose');
      shell.gameOver(s.score, { detail: `${s.lines} lines, level ${s.level}.` });
      return;
    }
    const direction = keys.axis('left', 'right');
    if (keys.pressed('left')) {
      move(s, -1);
      sfx.play('tick', 0.84);
    } else if (keys.pressed('right')) {
      move(s, 1);
      sfx.play('tick', 0.84);
    }
    if (direction !== t.dir) {
      t.dir = direction;
      t.das = 0;
      t.arr = 0;
    } else if (direction !== 0) {
      t.das += dt;
      if (t.das >= 0.167) {
        t.arr += dt;
        while (t.arr >= 0.033) {
          if (!move(s, direction)) break;
          t.arr -= 0.033;
        }
      }
    }
    if (!s.active) return;
    const soft = keys.down('down');
    t.gravity += dt;
    const interval = soft ? Math.max(1 / 30, gravitySeconds(s.level) / 20) : gravitySeconds(s.level);
    while (t.gravity >= interval && s.active) {
      t.gravity -= interval;
      if (move(s, 0, 1)) {
        if (soft) s.score++;
      } else break;
    }
    const grounded = s.active && (s.active.y >= 0 && cellsFor(s.active.type, s.active.rotation).some(([dx, dy]) =>
      s.board[s.active!.y + dy + 1]?.[s.active!.x + dx] !== null || s.active!.y + dy + 1 >= 40));
    if (grounded) {
      s.lockTimer += dt;
      if (s.lockTimer >= 0.5) {
        lock(s);
        sfx.play('tick', 0.55);
        t.gravity = 0;
      }
    } else s.lockTimer = 0;
    if (s.lines !== t.lines) {
      const cell = Math.max(4, Math.min(size.w / 20, (size.h - 78) / 20));
      const left = (size.w - 20 * cell) / 2;
      const boardX = left + 5 * cell;
      const boardY = 52 + Math.max(0, (size.h - 52 - 20 * cell) / 2);
      for (const row of s.clearedRows) {
        if (row < 20) continue;
        for (let col = 0; col < 10; col++) for (let i = 0; i < 2; i++) {
          fx.particles.push({
            x: boardX + (col + 0.5) * cell,
            y: boardY + (row - 20 + 0.5) * cell,
            vx: (Math.random() - 0.5) * 105,
            vy: -20 - Math.random() * 100,
            life: 0.35 + Math.random() * 0.2,
            color: colors[(s.board[row]?.[col] ?? s.active?.type ?? 'T') as Piece],
          });
        }
      }
      if (s.level > (s.lines - s.lastClear) / 10 + 1) fx.toast = 1.3;
      t.lines = s.lines;
      sfx.play(s.lastClear === 4 ? 'win' : 'coin', 0.72 + s.lastClear * 0.12);
    }
    shell.setScore(s.score);
  }, () => {
    const c = ctx();
    if (!c) return;
    const { w, h } = size;
    const fx = vfx.current;
    const s = state.current;
    c.clearRect(0, 0, w, h);
    if (!w || !h) return;
    const cell = Math.max(4, Math.min(w / 20, Math.max(4, (h - 78) / 20)));
    const totalW = 20 * cell;
    const left = (w - totalW) / 2;
    const boardX = left + 5 * cell;
    const boardH = 20 * cell;
    const boardY = 52 + Math.max(0, (h - 52 - boardH) / 2);
    c.save();
    if (s.dropFlash > 0) c.translate(0, Math.sin(s.dropFlash * 95) * s.dropFlash * 8);
    c.fillStyle = 'rgba(255,255,255,.035)';
    c.beginPath();
    c.roundRect(boardX - 3, boardY - 3, 10 * cell + 6, boardH + 6, Math.min(12, cell * 0.4));
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.1)';
    c.lineWidth = 1;
    c.stroke();
    for (let r = 0; r < 20; r++) for (let col = 0; col < 10; col++) {
      const x = boardX + col * cell;
      const y = boardY + r * cell;
      c.fillStyle = 'rgba(255,255,255,.018)';
      c.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      const block = state.current.board[r + 20][col];
      if (block) drawBlock(c, x, y, cell, colors[block], 1);
    }
    if (s.active) {
      const gy = ghostY(s);
      for (const [dx, dy] of cellsFor(s.active.type, s.active.rotation)) {
        const y = gy + dy;
        if (y >= 20) drawBlock(c, boardX + (s.active.x + dx) * cell, boardY + (y - 20) * cell, cell, colors[s.active.type], 0.3, true);
      }
      for (const [dx, dy] of cellsFor(s.active.type, s.active.rotation)) {
        const x = s.active.x + dx;
        const y = s.active.y + dy;
        if (y >= 20) drawBlock(c, boardX + x * cell, boardY + (y - 20) * cell, cell, colors[s.active.type], 1);
      }
      if (s.dropFlash > 0) {
        c.fillStyle = `rgba(255,255,255,${s.dropFlash * 0.28})`;
        c.fillRect(boardX, boardY, cell * 10, boardH);
      }
    }
    drawMiniLabel(c, 'hold', left + cell * 0.2, boardY + 16, cell);
    if (s.hold) drawMiniPiece(c, s.hold, left + cell * 0.2, boardY + cell * 1.2, cell * 0.7);
    const statsY = boardY + cell * 5.2;
    const labelSize = Math.min(13, Math.max(10, cell * 0.5));
    const valueSize = Math.min(22, Math.max(13, cell * 0.85));
    const statStep = Math.max(cell * 2.4, labelSize + valueSize * 1.8);
    drawStat(c, 'score', String(s.score), left + cell * 0.2, statsY, cell * 4.5, cell);
    drawStat(c, 'level', String(s.level), left + cell * 0.2, statsY + statStep, cell * 4.5, cell);
    drawStat(c, 'lines', String(s.lines), left + cell * 0.2, statsY + statStep * 2, cell * 4.5, cell);
    const nextX = boardX + cell * 11;
    drawMiniLabel(c, 'next', nextX, boardY + 16, cell);
    s.next.slice(0, 5).forEach((p, i) => drawMiniPiece(c, p, nextX, boardY + cell * (1.2 + i * 3.6), cell * (i === 0 ? 0.78 : 0.58)));
    if (s.clearFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${s.clearFlash * 0.7})`;
      for (const row of s.clearedRows) if (row >= 20) c.fillRect(boardX, boardY + (row - 20) * cell, cell * 10, cell);
    }
    if (s.lockFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${s.lockFlash * 0.75})`;
      for (const [x, y] of s.lastLocked) {
        if (y >= 20 && y < 40) c.fillRect(boardX + x * cell, boardY + (y - 20) * cell, cell, cell);
      }
    }
    c.restore();
    for (const p of fx.particles) {
      c.globalAlpha = Math.min(1, p.life * 2.5);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(1, cell * 0.12), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    if (fx.streak) {
      c.strokeStyle = `rgba(255,255,255,${fx.streak.life * 4})`;
      c.lineWidth = Math.max(1, cell * 0.12);
      c.beginPath();
      c.moveTo(boardX + fx.streak.x * cell, boardY + Math.max(0, fx.streak.top - 20) * cell);
      c.lineTo(boardX + fx.streak.x * cell, boardY + Math.max(0, fx.streak.bottom - 20) * cell);
      c.stroke();
    }
    if (fx.toast > 0) {
      c.globalAlpha = Math.min(1, fx.toast * 2);
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.font = '600 14px Inter, -apple-system, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(`level ${s.level}`, w / 2, Math.max(68, boardY - 18));
      c.globalAlpha = 1;
    }
  });

  return <>
    <canvas
      ref={ref}
      className="g-blocks-canvas"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, verticalCells: 0, time: performance.now(), moved: false, vertical: false, fastUp: false };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        const cell = Math.max(8, Math.min(size.w / 20, (size.h - 78) / 20));
        if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 10) g.moved = true;
        if (!g.vertical && (e.clientY - g.y < -10 || Math.abs(e.clientY - g.y) > Math.abs(e.clientX - g.x) * 1.15)) g.vertical = true;
        if (g.vertical) {
          const traveledCells = Math.floor((e.clientY - g.y) / cell);
          if (traveledCells > g.verticalCells) {
            const dropped = traveledCells - g.verticalCells;
            for (let i = 0; i < dropped; i++) if (move(state.current, 0, 1)) state.current.score++;
            g.verticalCells = traveledCells;
            g.lastY = e.clientY;
            shell.setScore(state.current.score);
          }
          if (e.clientY - g.y < -cell * 1.4 && performance.now() - g.time < 220) g.fastUp = true;
        } else {
          const cells = Math.trunc((e.clientX - g.x) / cell);
          const prev = Math.trunc((g.lastX - g.x) / cell);
          for (let i = prev; i !== cells; i += Math.sign(cells - prev)) {
            if (move(state.current, Math.sign(cells - prev))) sfx.play('tick', 0.84);
          }
          g.lastX = e.clientX;
        }
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        const elapsed = performance.now() - g.time;
        const moved = g.moved;
        const isFlick = g.fastUp && elapsed < 260;
        gesture.current = null;
        if (isFlick) performDrop();
        else if (!moved && rotate(state.current, 1)) sfx.play('blip', 1.2);
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    />
    {shell.touch && <button className="g-blocks-touch g-blocks-touch-left" type="button" aria-label="Hold piece" onClick={() => touchAction('hold')}>hold</button>}
    {shell.touch && <button className="g-blocks-touch g-blocks-touch-right" type="button" aria-label="Rotate counterclockwise" onClick={() => touchAction('ccw')}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h8a7 7 0 1 1-5 7" />
      </svg>
    </button>}
  </>;
}

function drawBlock(c: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string, alpha: number, outline = false) {
  const pad = Math.max(1, cell * 0.055);
  c.save();
  c.globalAlpha = alpha;
  c.beginPath();
  c.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, Math.max(2, cell * 0.2));
  if (outline) {
    c.strokeStyle = color;
    c.lineWidth = Math.max(1, cell * 0.08);
    c.stroke();
  } else {
    const gradient = c.createLinearGradient(x, y, x, y + cell);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.18, color);
    gradient.addColorStop(1, color);
    c.fillStyle = gradient;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.18)';
    c.lineWidth = 0.7;
    c.stroke();
  }
  c.restore();
}

function drawMiniLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, cell: number) {
  c.fillStyle = 'rgba(245,245,247,.55)';
  c.font = `600 ${Math.min(13, Math.max(10, cell * 0.5))}px Inter, -apple-system, system-ui, sans-serif`;
  c.textAlign = 'left';
  c.fillText(text, x, y);
}

function drawStat(c: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, width: number, cell: number) {
  const labelSize = Math.min(13, Math.max(10, cell * 0.5));
  const valueSize = Math.min(22, Math.max(13, cell * 0.85));
  drawMiniLabel(c, label, x, y, cell);
  c.fillStyle = '#f5f5f7';
  c.font = `600 ${valueSize}px Inter, -apple-system, system-ui, sans-serif`;
  c.fillText(value.length > 8 ? `${value.slice(0, 7)}…` : value, x, y + labelSize + valueSize * 1.2, width);
}

function drawMiniPiece(c: CanvasRenderingContext2D, piece: Piece, x: number, y: number, cell: number) {
  const cells = cellsFor(piece);
  for (const [cx, cy] of cells) drawBlock(c, x + cx * cell, y + cy * cell, cell, colors[piece], 0.95);
}
