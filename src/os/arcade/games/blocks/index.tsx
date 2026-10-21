import { useEffect, useRef } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useOnline, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  cellsFor, createGame, ghostY, grounded, hardDrop, holdPiece, HEIGHT, LOCK_DELAY, move, rotate, seededRandom, stackTop, step,
  VISIBLE_ROWS, WIDTH, type BlocksGame, type LockEvent, type Piece,
} from './logic';
import { blocksLayout, spinTitle, type Layout, type Rect } from './layout';
import { meta } from './meta';
import './blocks.css';

const colors: Record<Piece, string> = {
  I: '#5ac8fa',
  O: '#ffd60a',
  T: '#bf5af2',
  S: '#30d158',
  Z: '#ff453a',
  J: '#0a84ff',
  L: '#ff9f0a',
};
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const TOP = HEIGHT - VISIBLE_ROWS;
const DAS = 0.167;
const ARR = 0.033;
const COLLAPSE = 0.16;
const TOP_OUT = 0.75;

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string };
type Toast = { title: string; sub: string; life: number; big: boolean };
type Beam = { x: number; top: number; bottom: number; color: string };

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit}><Play /></GameShell>;
}

function Play() {
  const shell = useShell();
  const online = useOnline();
  const state = useRef<BlocksGame>(createGame());
  const rand = useRef<() => number>(Math.random);
  const seedKey = useRef('');
  const timing = useRef({ dir: 0 as -1 | 0 | 1, last: 0 as -1 | 1, das: 0, arr: 0, seq: 0, overT: -1 });
  const vfx = useRef({
    particles: [] as Particle[],
    toasts: [] as Toast[],
    beams: [] as Beam[],
    beamLife: 0,
    clear: null as { event: LockEvent; t: number } | null,
    shake: 0,
    level: 0,
    time: 0,
  });
  const view = useRef({ k: 1, u: 1, avoid: [] as Rect[], at: -1e9, layout: null as Layout | null, key: '' });
  const gesture = useRef<{ id: number; x: number; y: number; lastX: number; down: number; moved: boolean; vertical: boolean; t: number } | null>(null);
  const { ref, size, ctx } = useCanvas();

  // Online races deal the same pieces to everyone: seed from the room's round and host.
  const host = online?.players.find((p) => p.seat === 0)?.name ?? '';
  const raceKey = online ? `blocks|${online.round}|${host}` : '';
  useEffect(() => {
    if (!raceKey || seedKey.current === raceKey || state.current.pieces > 0) return;
    seedKey.current = raceKey;
    rand.current = seededRandom(raceKey);
    state.current = createGame(rand.current);
    shell.invalidate();
  }, [raceKey, shell]);

  // The iPad frame scales the screen down; text and touch targets grow by 1/scale so they read at full size.
  useEffect(() => {
    const root = shell.root.current;
    return () => { root?.style.removeProperty('--g-blocks-u'); };
  }, [shell.root]);

  const nudge = (dx: number) => {
    if (move(state.current, dx)) sfx.play('tick', 0.84);
  };

  const turn = (dir: 1 | -1) => {
    const s = state.current;
    if (!rotate(s, dir)) return;
    sfx.play('blip', dir === 1 ? 1.2 : 0.92);
    if (s.spin !== 'none') sfx.tone({ freq: 880, to: 1320, dur: 0.08, type: 'triangle', vol: 0.05 });
  };

  const hold = () => {
    if (holdPiece(state.current, rand.current)) sfx.play('select');
  };

  const drop = () => {
    const s = state.current;
    const piece = s.active;
    if (!piece || s.over) return;
    const landing = ghostY(s);
    const fx = vfx.current;
    const cols = new Map<number, number>();
    for (const [dx, dy] of cellsFor(piece.type, piece.rotation)) cols.set(piece.x + dx, Math.min(cols.get(piece.x + dx) ?? 99, dy));
    fx.beams = [...cols].map(([x, dy]) => ({ x, top: piece.y + dy, bottom: landing + dy, color: colors[piece.type] }));
    fx.beamLife = 0.2;
    const distance = hardDrop(s, rand.current);
    fx.shake = Math.min(1, 0.45 + distance / 30);
    sfx.play('hit', 0.72);
  };

  const keys = useKeys((code, event) => {
    if (event?.repeat || state.current.over) return;
    const t = timing.current;
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD') {
      const dir = code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1;
      t.last = dir;
      t.dir = dir;
      t.das = 0;
      t.arr = 0;
      nudge(dir);
    } else if (code === 'Space') drop();
    else if (code === 'ArrowUp' || code === 'KeyX' || code === 'KeyW') turn(1);
    else if (code === 'KeyZ' || code === 'KeyQ') turn(-1);
    else if (code === 'KeyC' || code === 'ShiftLeft' || code === 'ShiftRight') hold();
  });

  const react = (s: BlocksGame) => {
    const fx = vfx.current;
    const e = s.event;
    if (!e) return;
    if (!e.lines) {
      sfx.play('tick', 0.55);
      if (e.spin !== 'none') fx.toasts = [{ title: spinTitle(e), sub: `+${e.points.toLocaleString('en-US')}`, life: 1.1, big: false }];
      return;
    }
    fx.clear = { event: e, t: 0 };
    const L = view.current.layout;
    if (L) {
      const per = e.lines === 4 || e.spin !== 'none' ? 3 : 2;
      e.rows.forEach((row, i) => {
        if (row < TOP) return;
        for (let col = 0; col < WIDTH; col++) for (let n = 0; n < per; n++) {
          const max = 0.45 + Math.random() * 0.35;
          fx.particles.push({
            x: L.boardX + (col + Math.random()) * L.cell,
            y: L.boardY + (row - TOP + Math.random()) * L.cell,
            vx: (col - 4.5) * L.cell * 0.9 + (Math.random() - 0.5) * L.cell * 6,
            vy: -L.cell * (2 + Math.random() * 7),
            life: max,
            max,
            size: L.cell * (0.1 + Math.random() * 0.12),
            color: colors[e.cells[i][col] ?? 'T'],
          });
        }
      });
    }
    if (fx.particles.length > 600) fx.particles.splice(0, fx.particles.length - 600);
    fx.shake = Math.max(fx.shake, e.lines >= 4 || e.spin === 'full' ? 1 : 0.35 + e.lines * 0.12);
    const title = spinTitle(e);
    const subs = [e.backToBack ? 'Back to Back' : '', e.combo > 0 ? `Combo ${e.combo}` : '', `+${e.points.toLocaleString('en-US')}`].filter(Boolean);
    fx.toasts = [{ title, sub: subs.join('  ·  '), life: e.lines >= 4 || e.perfect ? 1.5 : 1.15, big: e.lines >= 4 || e.spin === 'full' || e.perfect }];
    if (e.levelUp) {
      fx.level = 1.6;
      [523, 659, 784, 1047].forEach((freq, i) => sfx.tone({ freq, dur: 0.09, type: 'square', vol: 0.04, delay: 0.12 + i * 0.07 }));
    }
    if (e.lines >= 4 || e.spin === 'full' || e.perfect) sfx.play('win', 1 + Math.max(0, e.combo) * 0.05);
    else sfx.play('coin', 0.78 + e.lines * 0.12 + Math.max(0, e.combo) * 0.06);
  };

  useGameLoop((dt) => {
    const s = state.current;
    const t = timing.current;
    const fx = vfx.current;
    fx.time += dt;
    s.clearFlash = Math.max(0, s.clearFlash - dt);
    s.lockFlash = Math.max(0, s.lockFlash - dt);
    s.dropFlash = Math.max(0, s.dropFlash - dt);
    fx.shake = Math.max(0, fx.shake - dt * 4);
    fx.beamLife = Math.max(0, fx.beamLife - dt);
    fx.level = Math.max(0, fx.level - dt);
    if (fx.clear && (fx.clear.t += dt) > 0.45) fx.clear = null;
    for (const toast of fx.toasts) toast.life -= dt;
    fx.toasts = fx.toasts.filter((toast) => toast.life > 0);
    const gravity = (view.current.layout?.cell ?? 20) * 18;
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += gravity * dt;
      p.vx *= 1 - dt * 1.5;
      if (p.life <= 0) fx.particles.splice(i, 1);
    }
    if (s.seq !== t.seq) {
      t.seq = s.seq;
      react(s);
    }
    if (s.over) {
      if (t.overT < 0) {
        t.overT = 0;
        sfx.play('lose');
      }
      t.overT += dt;
      if (t.overT >= TOP_OUT) shell.gameOver(s.score, { detail: `${s.lines} ${s.lines === 1 ? 'line' : 'lines'}, level ${s.level}.` });
      return;
    }
    // Movement: the last direction pressed wins, so rolling from left to right never stalls.
    const left = keys.down('left');
    const right = keys.down('right');
    const direction: -1 | 0 | 1 = left && right ? t.last : left ? -1 : right ? 1 : 0;
    if (direction !== t.dir) {
      t.dir = direction;
      t.das = 0;
      t.arr = 0;
      if (direction) nudge(direction);
    } else if (direction) {
      t.das += dt;
      if (t.das >= DAS) {
        t.arr += dt;
        while (t.arr >= ARR) {
          t.arr -= ARR;
          if (!move(s, direction)) {
            t.arr = 0;
            break;
          }
        }
      }
    }
    step(s, dt, keys.down('down'), rand.current);
    if (s.seq !== t.seq) {
      t.seq = s.seq;
      react(s);
    }
  }, () => {
    const c = ctx();
    if (!c) return;
    const { w, h } = size;
    c.clearRect(0, 0, w, h);
    if (!w || !h) return;
    const L = measure(w, h);
    draw(c, L, w, h);
  });

  const measure = (w: number, h: number): Layout => {
    const v = view.current;
    const now = performance.now();
    const canvas = ref.current;
    const root = shell.root.current;
    if (canvas && root && now - v.at > 400) {
      v.at = now;
      const box = canvas.getBoundingClientRect();
      const k = canvas.offsetWidth ? box.width / canvas.offsetWidth : 1;
      const u = shell.touch && k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1;
      if (u !== v.u) {
        v.u = u;
        root.style.setProperty('--g-blocks-u', String(u));
      }
      v.k = k || 1;
      v.avoid = [...root.querySelectorAll<HTMLElement>('.arcade-ctrl, .arcade-online-status')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: (r.left - box.left) / v.k, y: (r.top - box.top) / v.k, w: r.width / v.k, h: r.height / v.k };
      }).filter((r) => r.w > 0 && r.h > 0);
    }
    const key = `${w}|${h}|${v.u}|${shell.touch}|${v.avoid.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';')}`;
    if (!v.layout || key !== v.key) {
      v.key = key;
      v.layout = blocksLayout(w, h, { u: v.u, avoid: v.avoid, bottom: shell.touch ? 76 * v.u : 0 });
    }
    return v.layout;
  };

  const draw = (c: CanvasRenderingContext2D, L: Layout, w: number, h: number) => {
    const s = state.current;
    const fx = vfx.current;
    const { cell, boardX, boardY } = L;
    const boardW = cell * WIDTH;
    const boardH = cell * VISIBLE_ROWS;
    const danger = !s.over && stackTop(s.board) < TOP + 4;
    const pulse = danger ? 0.5 + 0.5 * Math.sin(fx.time * 6) : 0;
    c.save();
    if (fx.shake > 0) c.translate(0, fx.shake * fx.shake * cell * 0.22);

    // Well
    const radius = Math.min(14, cell * 0.45);
    c.fillStyle = 'rgba(8,6,14,.55)';
    c.beginPath();
    c.roundRect(boardX - 4, boardY - 4, boardW + 8, boardH + 8, radius);
    c.fill();
    c.strokeStyle = danger ? `rgba(255,69,58,${0.35 + pulse * 0.4})` : 'rgba(255,255,255,.12)';
    c.lineWidth = 1;
    c.stroke();
    if (danger) {
      const g = c.createLinearGradient(0, boardY, 0, boardY + cell * 5);
      g.addColorStop(0, `rgba(255,69,58,${0.1 + pulse * 0.1})`);
      g.addColorStop(1, 'rgba(255,69,58,0)');
      c.fillStyle = g;
      c.fillRect(boardX, boardY, boardW, cell * 5);
    }
    if (cell >= 8) {
      c.strokeStyle = 'rgba(255,255,255,.035)';
      c.beginPath();
      for (let col = 1; col < WIDTH; col++) {
        c.moveTo(Math.round(boardX + col * cell) + 0.5, boardY);
        c.lineTo(Math.round(boardX + col * cell) + 0.5, boardY + boardH);
      }
      for (let r = 1; r < VISIBLE_ROWS; r++) {
        c.moveTo(boardX, Math.round(boardY + r * cell) + 0.5);
        c.lineTo(boardX + boardW, Math.round(boardY + r * cell) + 0.5);
      }
      c.stroke();
    }

    // Stack, falling into place after a clear
    const clear = fx.clear;
    const fall = clear ? Math.max(0, 1 - clear.t / COLLAPSE) : 0;
    const eased = fall * fall;
    c.save();
    c.beginPath();
    c.rect(boardX, boardY, boardW, boardH);
    c.clip();
    const greyRow = s.over ? HEIGHT - Math.floor((Math.min(1, timing.current.overT / (TOP_OUT * 0.8))) * (VISIBLE_ROWS + 1)) : HEIGHT;
    for (let r = TOP; r < HEIGHT; r++) {
      const offset = clear ? clear.event.shift[r] * eased * cell : 0;
      const y = boardY + (r - TOP) * cell - offset;
      for (let col = 0; col < WIDTH; col++) {
        const block = s.board[r][col];
        if (block) drawBlock(c, boardX + col * cell, y, cell, r >= greyRow ? '#5a5a66' : colors[block]);
      }
    }
    // Rows that just cleared: a bright bar that closes toward the middle
    if (clear) {
      const p = Math.min(1, clear.t / 0.32);
      const shrink = 1 - p * p;
      c.globalAlpha = 1 - p * 0.6;
      for (const row of clear.event.rows) {
        if (row < TOP) continue;
        const y = boardY + (row - TOP) * cell;
        const half = boardW / 2 * shrink;
        const g = c.createLinearGradient(boardX, 0, boardX + boardW, 0);
        g.addColorStop(0, 'rgba(255,255,255,.2)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,.2)');
        c.fillStyle = g;
        c.fillRect(boardX + boardW / 2 - half, y + cell * 0.08, half * 2, cell * 0.84);
      }
      c.globalAlpha = 1;
    }

    // Hard drop beams
    if (fx.beamLife > 0) {
      const a = fx.beamLife / 0.2;
      for (const b of fx.beams) {
        const top = boardY + Math.max(0, b.top - TOP) * cell;
        const bottom = boardY + Math.max(0, b.bottom - TOP) * cell;
        if (bottom <= top) continue;
        const g = c.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, hexA(b.color, 0));
        g.addColorStop(1, hexA(b.color, 0.42 * a));
        c.fillStyle = g;
        c.fillRect(boardX + b.x * cell + cell * 0.12, top, cell * 0.76, bottom - top);
      }
    }

    // Ghost and the falling piece
    if (s.active) {
      const piece = s.active;
      const gy = ghostY(s);
      const color = colors[piece.type];
      for (const [dx, dy] of cellsFor(piece.type, piece.rotation)) {
        const y = gy + dy;
        if (y >= TOP) drawGhost(c, boardX + (piece.x + dx) * cell, boardY + (y - TOP) * cell, cell, color);
      }
      const resting = grounded(s) ? Math.min(1, s.lockTimer / LOCK_DELAY) : 0;
      c.globalAlpha = 1 - resting * 0.3;
      for (const [dx, dy] of cellsFor(piece.type, piece.rotation)) {
        const y = piece.y + dy;
        if (y >= TOP) drawBlock(c, boardX + (piece.x + dx) * cell, boardY + (y - TOP) * cell, cell, color);
      }
      c.globalAlpha = 1;
    }
    if (s.lockFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${s.lockFlash * 3})`;
      for (const [x, y] of s.lastLocked) {
        if (y >= TOP && y < HEIGHT) {
          c.beginPath();
          c.roundRect(boardX + x * cell + 1, boardY + (y - TOP) * cell + 1, cell - 2, cell - 2, Math.max(2, cell * 0.18));
          c.fill();
        }
      }
    }
    c.restore();
    c.restore();

    // Side panels
    drawPanels(c, L, s);

    // Particles
    for (const p of fx.particles) {
      c.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;

    // Toasts
    const toast = fx.toasts[0];
    if (toast) drawToast(c, L, toast);
    if (fx.level > 0) {
      const a = Math.min(1, fx.level * 2.5);
      const size = Math.max(13, Math.min(22, cell * 0.9)) * L.u;
      c.globalAlpha = a;
      c.font = `700 ${size}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const y = boardY + boardH * 0.18 - (1.6 - fx.level) * cell * 0.4;
      pill(c, `Level ${s.level}`, boardX + boardW / 2, y, size, 'rgba(191,90,242,.9)');
      c.globalAlpha = 1;
    }
    void w;
    void h;
  };

  return <>
    <canvas
      ref={ref}
      className="g-blocks-canvas"
      onPointerDown={(e) => {
        if (shell.status !== 'playing') return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, down: 0, moved: false, vertical: false, t: performance.now() };
        const L = view.current.layout;
        const x = e.nativeEvent.offsetX;
        const y = e.nativeEvent.offsetY;
        if (L && x >= L.hold.x && x <= L.hold.x + L.hold.w && y >= L.hold.y && y <= L.hold.y + L.hold.h) {
          gesture.current = null;
          hold();
        }
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId || state.current.over) return;
        const L = view.current.layout;
        if (!L) return;
        const step = L.cell * view.current.k * (e.pointerType === 'mouse' ? 1 : 1.1);
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (Math.abs(dx) + Math.abs(dy) > 10) g.moved = true;
        if (!g.vertical && (dy < -10 || (dy > 12 && dy > Math.abs(dx) * 1.2))) g.vertical = true;
        if (g.vertical) {
          const rows = Math.floor(dy / step);
          while (rows > g.down) {
            g.down++;
            if (move(state.current, 0, 1)) state.current.score++;
          }
        } else {
          const cells = Math.trunc(dx / step);
          const prev = Math.trunc((g.lastX - g.x) / step);
          for (let i = prev; i !== cells; i += Math.sign(cells - prev)) nudge(Math.sign(cells - prev));
          g.lastX = e.clientX;
        }
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        gesture.current = null;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        const cell = (view.current.layout?.cell ?? 20) * view.current.k;
        const quick = performance.now() - g.t < 300;
        if (dy < -Math.max(28, cell * 1.2) && Math.abs(dy) > Math.abs(dx) * 1.2) drop();
        else if (!g.moved) turn(1);
        else if (quick && dy > Math.max(60, cell * 3) && dy > Math.abs(dx) * 2) drop();
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    />
    {shell.touch && <button className="g-blocks-touch g-blocks-touch-left" type="button" aria-label="Hold piece" onPointerDown={(e) => { e.preventDefault(); hold(); }}>Hold</button>}
    {shell.touch && <button className="g-blocks-touch g-blocks-touch-right" type="button" aria-label="Rotate counterclockwise" onPointerDown={(e) => { e.preventDefault(); turn(-1); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h8a7 7 0 1 1-5 7" />
      </svg>
    </button>}
  </>;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** Blocks are drawn once per color and size, then stamped. */
function sprite(color: string, size: number, dpr: number) {
  const px = Math.max(2, Math.round(size * dpr));
  const key = `${color}|${px}`;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size > 80) sprites.clear();
  s = document.createElement('canvas');
  s.width = s.height = px;
  const c = s.getContext('2d')!;
  const pad = Math.max(0.5, px * 0.04);
  const r = Math.max(1.5, px * 0.2);
  const inner = px - pad * 2;
  const body = c.createLinearGradient(0, pad, 0, px - pad);
  body.addColorStop(0, shade(color, 0.28));
  body.addColorStop(0.55, color);
  body.addColorStop(1, shade(color, -0.22));
  c.fillStyle = body;
  c.beginPath();
  c.roundRect(pad, pad, inner, inner, r);
  c.fill();
  if (px >= 10) {
    const gloss = c.createLinearGradient(0, pad, 0, pad + inner * 0.5);
    gloss.addColorStop(0, 'rgba(255,255,255,.42)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gloss;
    c.beginPath();
    c.roundRect(pad + inner * 0.12, pad + inner * 0.08, inner * 0.76, inner * 0.4, r * 0.7);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.22)';
    c.lineWidth = Math.max(1, px * 0.03);
    c.beginPath();
    c.roundRect(pad + c.lineWidth / 2, pad + c.lineWidth / 2, inner - c.lineWidth, inner - c.lineWidth, r);
    c.stroke();
  }
  sprites.set(key, s);
  return s;
}

function drawBlock(c: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string) {
  const dpr = c.getTransform().a || 1;
  c.drawImage(sprite(color, cell, dpr), x, y, cell, cell);
}

function drawGhost(c: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string) {
  const pad = Math.max(1, cell * 0.08);
  c.beginPath();
  c.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, Math.max(2, cell * 0.18));
  c.fillStyle = hexA(color, 0.12);
  c.fill();
  c.strokeStyle = hexA(color, 0.55);
  c.lineWidth = Math.max(1, cell * 0.07);
  c.stroke();
}

function drawMiniPiece(c: CanvasRenderingContext2D, piece: Piece, cx: number, cy: number, cell: number, color = colors[piece]) {
  const cells = cellsFor(piece);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const ox = cx - ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cell;
  const oy = cy - ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * cell;
  for (const [x, y] of cells) drawBlock(c, ox + x * cell, oy + y * cell, cell, color);
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  c.fillStyle = 'rgba(245,245,247,.6)';
  c.font = `600 ${size}px ${FONT}`;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(text, x, y);
}

function card(c: CanvasRenderingContext2D, r: Rect, radius: number) {
  c.fillStyle = 'rgba(255,255,255,.055)';
  c.beginPath();
  c.roundRect(r.x, r.y, r.w, r.h, radius);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,.08)';
  c.lineWidth = 1;
  c.stroke();
}

function drawPanels(c: CanvasRenderingContext2D, L: Layout, s: BlocksGame) {
  const { hold, next, stats, font, value, pad, radius } = L;
  card(c, hold, radius);
  label(c, 'Hold', hold.x + pad, hold.y + pad, font);
  if (s.hold) {
    const mini = Math.min((hold.w - pad * 2) / 4.4, (hold.h - font - pad * 3) / 2.4, L.cell * 0.8);
    drawMiniPiece(c, s.hold, hold.x + hold.w / 2, hold.y + font + pad * 1.6 + (hold.h - font - pad * 2.6) / 2, mini, s.canHold ? colors[s.hold] : '#5a5a66');
  }
  card(c, next, radius);
  label(c, 'Next', next.x + pad, next.y + pad, font);
  const top = next.y + font + pad * 1.8;
  const slot = (next.y + next.h - pad - top) / L.queue;
  for (let i = 0; i < L.queue; i++) {
    const big = i === 0;
    const mini = Math.min((next.w - pad * 2) / 4.4, slot / (big ? 2.3 : 2.7), L.cell * (big ? 0.85 : 0.68));
    drawMiniPiece(c, s.next[i], next.x + next.w / 2, top + slot * (i + 0.5), mini);
  }
  const rows: [string, string][] = [['Score', s.score.toLocaleString('en-US')], ['Level', String(s.level)], ['Lines', String(s.lines)]];
  if (!L.statRows) return;
  card(c, stats, radius);
  const rowH = (stats.h - pad * 2) / L.statRows;
  rows.slice(0, L.statRows).forEach(([name, val], i) => {
    const y = stats.y + pad + rowH * i + (rowH - font * 1.15 - value * 1.05) / 2;
    label(c, name, stats.x + pad, y, font);
    c.fillStyle = '#f5f5f7';
    c.font = `700 ${value}px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(val, stats.x + pad, y + font * 1.15, stats.w - pad * 2);
  });
}

function pill(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string) {
  const w = c.measureText(text).width + size * 1.4;
  const h = size * 1.8;
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  c.fill();
  c.fillStyle = '#fff';
  c.fillText(text, x, y + size * 0.04);
}

function drawToast(c: CanvasRenderingContext2D, L: Layout, toast: Toast) {
  const { cell, boardX, boardY, u } = L;
  const boardW = cell * WIDTH;
  const age = (toast.big ? 1.5 : 1.15) - toast.life;
  const pop = age < 0.14 ? 1 + (1 - age / 0.14) * 0.25 : 1;
  const a = Math.min(1, toast.life * 3);
  const titleSize = Math.max(14, Math.min(toast.big ? 30 : 22, cell * (toast.big ? 1.25 : 0.95))) * u;
  const subSize = Math.max(11, Math.min(15, cell * 0.6)) * u;
  const cx = boardX + boardW / 2;
  const cy = boardY + cell * VISIBLE_ROWS * 0.36 - age * cell * 0.6;
  c.save();
  c.globalAlpha = a;
  c.translate(cx, cy);
  c.scale(pop, pop);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,.55)';
  c.shadowBlur = 10;
  if (toast.title) {
    c.font = `800 ${titleSize}px ${FONT}`;
    c.fillStyle = toast.big ? '#fff' : 'rgba(255,255,255,.95)';
    c.fillText(toast.title, 0, 0, boardW + cell * 2);
  }
  if (toast.sub) {
    c.font = `600 ${subSize}px ${FONT}`;
    c.fillStyle = 'rgba(255,214,10,.95)';
    c.fillText(toast.sub, 0, toast.title ? titleSize * 0.95 : 0, boardW + cell * 4);
  }
  c.restore();
}
