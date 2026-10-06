import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { COLS, ROWS, bestCol, colOf, createBoard, drop, idx, isFull, rowOf, winLine, type Board, type Level, type Player } from './connect4.ts';
import { meta } from './meta';
import './connect4.css';

type Mode = 'cpu' | '2p';
const LEVELS = ['easy', 'normal', 'hard'] as const;
const prefs: { mode: Mode; level: Level; first: Player } = { mode: 'cpu', level: 1, first: 1 };
const COLORS: Record<Player, string> = { 1: '#ff453a', 2: '#ffd60a' };
const NAMES: Record<Player, string> = { 1: 'red', 2: 'yellow' };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} lowerIsBetter formatScore={(n) => `${n} ${n === 1 ? 'disc' : 'discs'}`}>
      <ConnectFour />
    </GameShell>
  );
}

function Setup({ onStart }: { onStart: (mode: Mode, level: Level, first: Player) => void }) {
  const [mode, setMode] = useState<Mode>(prefs.mode);
  const [level, setLevel] = useState<Level>(prefs.level);
  const [first, setFirst] = useState<Player>(prefs.first);
  const seg = <T,>(label: string, value: T, items: [T, string][], set: (v: T) => void, hidden = false) => (
    <div className={`g-connect4-seg ${hidden ? 'hidden' : ''}`} role="radiogroup" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={text} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </div>
  );
  return (
    <div className="g-connect4-setup">
      {seg<Mode>('Mode', mode, [['cpu', 'vs computer'], ['2p', '2 players']], setMode)}
      {seg<Level>('Difficulty', level, LEVELS.map((l, i) => [i as Level, l]), setLevel, mode !== 'cpu')}
      {seg<Player>('Who starts', first, [[1, 'you start'], [2, 'computer starts']], setFirst, mode !== 'cpu')}
      <button type="button" className="g-connect4-go" onClick={() => onStart(mode, level, first)}>
        start
      </button>
    </div>
  );
}

type Falling = { col: number; row: number; player: Player; y: number; vy: number; done: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string };
type State = {
  board: Board;
  turn: Player;
  falling: Falling | null;
  hover: number | null;
  cursor: number;
  win: number[] | null;
  winner: Player | 0 | null;
  winT: number;
  pop: number[]; // per cell landing bounce timer
  particles: Particle[];
  thinking: boolean;
  thinkRemaining: number;
  moves: number;
  over: boolean;
};

const ME: Player = 1;

function ConnectFour() {
  const shell = useShell();
  const { ref, size, ctx } = useCanvas();
  const [phase, setPhase] = useState<'setup' | 'play'>('setup');
  const [status, setStatus] = useState('');
  const cfg = useRef<{ mode: Mode; level: Level; first: Player }>({ ...prefs });
  const st = useRef<State | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const gameOverDelay = useRef<{ remaining: number; finish: () => void } | null>(null);

  const isCpu = (p: Player) => cfg.current.mode === 'cpu' && p !== ME;
  const humanTurn = () => {
    const s = st.current;
    return !!s && !s.over && !s.falling && !isCpu(s.turn);
  };

  const geometry = () => {
    const { w, h } = sizeRef.current;
    const top = 52;
    const pad = 12;
    const cell = Math.floor(Math.min((w - pad * 2) / COLS, (h - top - pad) / (ROWS + 1)));
    const bw = cell * COLS;
    const bh = cell * ROWS;
    const x0 = (w - bw) / 2;
    const y0 = top + cell + (h - top - cell - bh - pad) / 2;
    return { cell, bw, bh, x0, y0, top };
  };

  const label = (s: State) => {
    if (s.over) return '';
    if (cfg.current.mode === 'cpu') return s.thinking || isCpu(s.turn) ? 'computer is thinking' : 'your move';
    return `${NAMES[s.turn]} to move`;
  };

  const place = (col: number) => {
    const s = st.current;
    if (!s || s.over || s.falling) return;
    const d = drop(s.board, col, s.turn);
    if (!d) {
      sfx.play('blip', 0.5);
      return;
    }
    s.falling = { col, row: d.row, player: s.turn, y: -1, vy: 0, done: false };
    s.hover = null;
    s.thinking = false;
    sfx.play('tick');
    setStatus('');
  };

  const land = (s: State, f: Falling) => {
    const d = drop(s.board, f.col, f.player)!;
    s.board = d.board;
    s.moves++;
    s.pop[idx(f.col, f.row)] = 1;
    s.falling = null;
    sfx.play('hit', 1.2 + f.row * 0.08);
    const line = winLine(s.board, idx(f.col, f.row));
    if (line) {
      s.win = line;
      s.winner = f.player;
      s.over = true;
      s.winT = 0;
      const g = geometry();
      for (const i of line) {
        const cx = g.x0 + colOf(i) * g.cell + g.cell / 2;
        const cy = g.y0 + (ROWS - 1 - rowOf(i)) * g.cell + g.cell / 2;
        for (let k = 0; k < 10; k++) {
          const a = Math.random() * Math.PI * 2;
          const v = 40 + Math.random() * 140;
          s.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.6 + Math.random() * 0.5, color: COLORS[f.player] });
        }
      }
      const cpuMode = cfg.current.mode === 'cpu';
      const youWon = cpuMode && f.player === ME;
      sfx.play(cpuMode && !youWon ? 'lose' : 'win');
      const discs = Math.ceil(s.moves / 2);
      gameOverDelay.current = {
        remaining: 1.4,
        finish: () => {
          const title = cpuMode ? (youWon ? 'you win' : 'computer wins') : `${NAMES[f.player]} wins`;
          shell.gameOver(youWon ? discs : undefined, { title, detail: `four in a row after ${discs} ${discs === 1 ? 'disc' : 'discs'}.` });
        },
      };
      return;
    }
    if (isFull(s.board)) {
      s.over = true;
      s.winner = 0;
      sfx.play('select', 0.7);
      gameOverDelay.current = {
        remaining: 0.9,
        finish: () => shell.gameOver(undefined, { title: 'draw', detail: 'the board is full.' }),
      };
      return;
    }
    s.turn = s.turn === 1 ? 2 : 1;
    s.cursor = f.col;
    if (isCpu(s.turn)) {
      s.thinking = true;
      s.thinkRemaining = 0.38 + Math.random() * 0.3;
    }
    setStatus(label(s));
  };

  const begin = (mode: Mode, level: Level, first: Player) => {
    Object.assign(prefs, { mode, level, first });
    cfg.current = { mode, level, first };
    const turn: Player = mode === 'cpu' ? first : 1;
    const s: State = {
      board: createBoard(),
      turn,
      falling: null,
      hover: null,
      cursor: 3,
      win: null,
      winner: null,
      winT: 0,
      pop: new Array(COLS * ROWS).fill(0),
      particles: [],
      thinking: isCpu(turn),
      thinkRemaining: 0.6,
      moves: 0,
      over: false,
    };
    st.current = s;
    gameOverDelay.current = null;
    setStatus(label(s));
    sfx.play('select');
    setPhase('play');
    shell.root.current?.focus({ preventScroll: true });
  };

  useKeys((code, e) => {
    const s = st.current;
    if (phase !== 'play' || !s || !humanTurn()) return;
    if (code === 'ArrowLeft' || code === 'KeyA') s.cursor = (s.cursor + COLS - 1) % COLS;
    else if (code === 'ArrowRight' || code === 'KeyD') s.cursor = (s.cursor + 1) % COLS;
    else if ((code === 'Enter' || code === 'Space' || code === 'ArrowDown' || code === 'KeyS') && !e?.repeat) place(s.cursor);
    else if (/^Digit[1-7]$/.test(code)) place(Number(code.slice(5)) - 1);
    s.hover = null;
  });

  const colAt = (e: { clientX: number; currentTarget: HTMLCanvasElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const g = geometry();
    const c = Math.floor((e.clientX - r.left - g.x0) / g.cell);
    return c >= 0 && c < COLS ? c : null;
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = st.current;
    if (!s || !humanTurn()) return;
    if (e.pointerType === 'touch') return;
    s.hover = colAt(e);
    if (s.hover !== null) s.cursor = s.hover;
  };
  const onPointerLeave = () => {
    if (st.current) st.current.hover = null;
  };
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = st.current;
    if (phase !== 'play' || !s || !humanTurn()) return;
    const c = colAt(e);
    if (c !== null) place(c);
  };

  const update = (dt: number) => {
    const s = st.current;
    if (!s || phase !== 'play') return;
    const g = geometry();
    if (s.falling) {
      const f = s.falling;
      f.vy += dt * 9 * g.cell * 2.6;
      f.y += f.vy * dt;
      const target = ROWS - 1 - f.row;
      if (f.y >= target) {
        f.y = target;
        land(s, f);
      }
    } else if (!s.over && isCpu(s.turn)) {
      s.thinkRemaining -= dt;
      if (s.thinkRemaining <= 0) {
        const c = bestCol(s.board, s.turn, cfg.current.level);
        if (c >= 0) place(c);
      }
    }
    const overDelay = gameOverDelay.current;
    if (overDelay) {
      overDelay.remaining -= dt;
      if (overDelay.remaining <= 0) {
        gameOverDelay.current = null;
        overDelay.finish();
      }
    }
    for (let i = 0; i < s.pop.length; i++) if (s.pop[i] > 0) s.pop[i] = Math.max(0, s.pop[i] - dt * 3.2);
    if (s.win) s.winT += dt;
    for (const p of s.particles) {
      p.life += dt;
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    s.particles = s.particles.filter((p) => p.life < p.max);
  };

  const disc = (c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, dim = false) => {
    c.save();
    c.globalAlpha = dim ? 0.3 : 1;
    const grad = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, color);
    c.fillStyle = grad;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = Math.max(1, r * 0.12);
    c.beginPath();
    c.arc(x, y, r * 0.72, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  };

  const render = () => {
    const c = ctx();
    const s = st.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#171a26');
    bg.addColorStop(1, '#0b0c12');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (!s || phase !== 'play') return;
    const g = geometry();
    const r = g.cell * 0.4;
    const cx = (col: number) => g.x0 + col * g.cell + g.cell / 2;
    const cy = (row: number) => g.y0 + (ROWS - 1 - row) * g.cell + g.cell / 2;

    // Hover or keyboard preview disc above the board
    const human = humanTurn();
    const previewCol = human ? (s.hover ?? (shell.touch ? null : s.cursor)) : null;
    if (previewCol !== null) {
      const y = g.y0 - g.cell / 2;
      disc(c, cx(previewCol), y, r, COLORS[s.turn], true);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(g.x0 + previewCol * g.cell, g.y0, g.cell, g.bh);
    }

    // Falling disc (drawn behind the frame so it looks like it slides into the slots)
    if (s.falling) {
      const f = s.falling;
      disc(c, cx(f.col), g.y0 + f.y * g.cell + g.cell / 2, r, COLORS[f.player]);
    }
    // Placed discs
    for (let i = 0; i < s.board.length; i++) {
      const v = s.board[i];
      if (!v) continue;
      const col = colOf(i);
      const row = rowOf(i);
      const pop = s.pop[i];
      const squash = pop > 0 ? 1 + Math.sin(pop * Math.PI) * 0.1 : 1;
      const dim = !!s.win && !s.win.includes(i) && s.winT > 0.1;
      disc(c, cx(col), cy(row), r * squash, COLORS[v], dim);
    }

    // Frame: rounded board with punched holes
    c.save();
    c.beginPath();
    const rad = g.cell * 0.28;
    c.roundRect(g.x0 - g.cell * 0.12, g.y0 - g.cell * 0.12, g.bw + g.cell * 0.24, g.bh + g.cell * 0.24, rad);
    for (let col = 0; col < COLS; col++)
      for (let row = 0; row < ROWS; row++) {
        c.moveTo(cx(col) + r * 1.08, cy(row));
        c.arc(cx(col), cy(row), r * 1.08, 0, Math.PI * 2, true);
      }
    const frame = c.createLinearGradient(0, g.y0, 0, g.y0 + g.bh);
    frame.addColorStop(0, '#2f4bd6');
    frame.addColorStop(1, '#1f33a3');
    c.fillStyle = frame;
    c.fill('evenodd');
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(g.x0 - g.cell * 0.12 + 0.5, g.y0 - g.cell * 0.12 + 0.5, g.bw + g.cell * 0.24 - 1, g.bh + g.cell * 0.24 - 1, rad);
    c.stroke();

    // Win line
    if (s.win) {
      const a = s.win[0];
      const b = s.win[3];
      const t = Math.min(1, s.winT / 0.45);
      const ease = 1 - Math.pow(1 - t, 3);
      const x1 = cx(colOf(a));
      const y1 = cy(rowOf(a));
      const x2 = x1 + (cx(colOf(b)) - x1) * ease;
      const y2 = y1 + (cy(rowOf(b)) - y1) * ease;
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.shadowColor = COLORS[s.winner as Player];
      c.shadowBlur = 16;
      c.lineWidth = Math.max(4, g.cell * 0.14);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
      c.restore();
    }
    for (const p of s.particles) {
      c.globalAlpha = 1 - p.life / p.max;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Turn indicator dots next to the status
    const dotY = 25;
    const names: Player[] = [1, 2];
    names.forEach((p, i) => {
      const x = w - 160 + i * 18;
      c.globalAlpha = s.turn === p && !s.over ? 1 : 0.3;
      c.fillStyle = COLORS[p];
      c.beginPath();
      c.arc(x, dotY, 5, 0, Math.PI * 2);
      c.fill();
    });
    c.globalAlpha = 1;
  };

  useGameLoop(update, render);

  return (
    <div className="g-connect4-stage">
      <canvas
        ref={ref}
        className="g-connect4-canvas"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        aria-label="Connect Four board"
      />
      {phase === 'play' && status && (
        <div className="g-connect4-status" aria-live="polite">
          {status.includes('thinking') && <span className="g-connect4-dot" aria-hidden="true" />}
          {status}
        </div>
      )}
      {phase === 'setup' && <Setup onStart={begin} />}
    </div>
  );
}
