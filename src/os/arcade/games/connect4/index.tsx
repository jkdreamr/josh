import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelIndex, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { COLS, ROWS, bestCol, colOf, createBoard, drop, idx, isFull, rowOf, winLine, type Board, type Level, type Player } from './connect4.ts';
import { meta } from './meta';
import type { AiReply, AiRequest } from './worker.ts';
import './connect4.css';

type Mode = 'cpu' | '2p';
const MODE = defineSetting('connect4:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('connect4:level', LEVEL_NAMES, 'normal');
const FIRST = defineSetting('connect4:first', ['you', 'computer'] as const, 'you');
const firstOptions = [
  ['you', 'You Start'],
  ['computer', 'Computer Starts'],
] as const;
const COLORS: Record<Player, string> = { 1: '#ff453a', 2: '#ffd60a' };
const SHADES: Record<Player, string> = { 1: '#b8170f', 2: '#c99400' };
const NAMES: Record<Player, string> = { 1: 'Red', 2: 'Yellow' };
const ME: Player = 1;
/** Disc fall, in board cells per second squared. */
const GRAVITY = 64;
const MIN_THINK = 0.45;
const MAX_CELL = 92;

/** Wins this page session, per matchup, so a few rounds against the same opponent keep a running score. */
const tally = new Map<string, [number, number]>();

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={(n) => `${n} ${n === 1 ? 'disc' : 'discs'}`} setup={<Setup />}>
      <ConnectFour />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [first, setFirst] = useSetting(FIRST);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} className="g-connect4-seg" />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} className="g-connect4-seg" />}
      {mode === 'cpu' && <Segmented label="First Move" value={first} options={firstOptions} onChange={setFirst} className="g-connect4-seg" />}
    </>
  );
}

type Falling = { col: number; row: number; player: Player; y: number; vy: number };
type Bounce = { y: number; vy: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Cpu = { id: number; col: number | null; waited: number; need: number };
type State = {
  board: Board;
  turn: Player;
  falling: Falling | null;
  bounce: (Bounce | null)[];
  /** Column the mouse is over, or a finger is pressing. */
  hover: number | null;
  cursor: number;
  /** Where the floating disc above the board is drawn, in columns; it glides toward its target. */
  ghost: number;
  ghostOn: number;
  remoteHover: number | null;
  last: number;
  win: number[] | null;
  winner: Player | 0 | null;
  winT: number;
  particles: Particle[];
  cpu: Cpu | null;
  t: number;
  moves: number;
  over: boolean;
  key: string;
};
type Box = { x: number; y: number; w: number; h: number };
type Geo = { cell: number; bw: number; bh: number; x0: number; y0: number; r: number };

/** The phone and iPad frames scale the whole screen down; this is 1 / that scale, so text and targets keep their size. */
function frameUnit(root: HTMLElement | null): number {
  if (!root || !root.offsetWidth) return 1;
  const k = root.getBoundingClientRect().width / root.offsetWidth;
  return k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1;
}

function ConnectFour() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const [first] = useSetting(FIRST);
  const cfg = useRef<{ mode: Mode; level: Level }>({ mode, level: levelIndex(levelName) });
  const st = useRef<State | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const gameOverDelay = useRef<{ remaining: number; finish: () => void } | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const boxes = useRef<{ hud: Box | null; ctrl: Box | null }>({ hud: null, ctrl: null });
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const sprites = useRef<{ key: string; board: HTMLCanvasElement | null; discs: Partial<Record<Player, HTMLCanvasElement>> }>({ key: '', board: null, discs: {} });
  const [unit, setUnit] = useState(1);
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const [, setRev] = useState(0);
  const refresh = () => setRev((n) => n + 1);

  const side = size.h > 0 && size.w / size.h > 1.9;
  const seatOf = (p: Player) => (p === 1 ? 0 : 1);
  const mySeatColor = (): Player => (online && online.seat === 1 ? 2 : 1);
  const isCpu = (p: Player) => !online && cfg.current.mode === 'cpu' && p !== ME;
  const humanTurn = () => {
    const s = st.current;
    if (!s || s.over || s.falling || shell.status !== 'playing') return false;
    if (online) return s.turn === mySeatColor();
    return !isCpu(s.turn);
  };
  // Local two player: a drop pressed while the last disc is still falling is kept for when it lands.
  const queued = useRef<number | null>(null);
  const canQueue = () => {
    const s = st.current;
    return !!s && !!s.falling && !s.over && !online && cfg.current.mode === '2p' && shell.status === 'playing';
  };
  const tallyKey = () => (online ? `online:${online.seat}` : cfg.current.mode === 'cpu' ? `cpu:${cfg.current.level}` : '2p');

  // Measure the HUD and the shell's control pill in layout px (offsets ignore the frame's scale) so the board avoids both.
  useLayoutEffect(() => {
    const root = shell.root.current;
    const measure = () => {
      const box = (el: HTMLElement | null | undefined): Box | null => (el && el.offsetWidth ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
      boxes.current = { hud: box(hudRef.current), ctrl: box(root?.querySelector<HTMLElement>('.arcade-ctrl')) };
      const u = shell.touch ? frameUnit(root) : 1;
      root?.style.setProperty('--g-connect4-u', String(u));
      const c = boxes.current.ctrl;
      if (c) root?.style.setProperty('--g-connect4-top', `${c.y + c.h + 6}px`);
      if (Math.abs(u - unitRef.current) > 0.004) setUnit(u);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (hudRef.current) ro.observe(hudRef.current);
    const ctrl = root?.querySelector<HTMLElement>('.arcade-ctrl');
    if (ctrl) ro.observe(ctrl);
    if (root) ro.observe(root);
    return () => ro.disconnect();
  });
  useEffect(() => () => {
    shell.root.current?.style.removeProperty('--g-connect4-u');
    shell.root.current?.style.removeProperty('--g-connect4-top');
  }, []);

  const geometry = (): Geo => {
    const { w, h } = sizeRef.current;
    const pad = 10;
    const { hud, ctrl } = boxes.current;
    const fit = (x: number, y: number, rw: number, rh: number): Geo => {
      const cell = Math.max(8, Math.min(MAX_CELL, Math.floor(Math.min(rw / (COLS + 0.3), rh / (ROWS + 1.3)))));
      const bw = cell * COLS;
      const bh = cell * ROWS;
      const x0 = Math.round(x + (rw - bw) / 2);
      const y0 = Math.round(y + cell + (rh - cell * (ROWS + 1.3)) / 2 + cell * 0.12);
      return { cell, bw, bh, x0, y0, r: cell * 0.4 };
    };
    if (side) {
      const left = hud ? hud.x + hud.w + pad : pad;
      const full = fit(left, pad, w - pad - left, h - pad * 2);
      if (!ctrl) return full;
      const narrow = fit(left, pad, Math.max(40, ctrl.x - pad - left), h - pad * 2);
      const lower = fit(left, ctrl.y + ctrl.h, w - pad - left, Math.max(40, h - pad - ctrl.y - ctrl.h));
      const overlaps = (g: Geo) => g.x0 + g.bw + g.cell * 0.15 > ctrl.x && g.y0 - g.cell * 1.1 < ctrl.y + ctrl.h;
      return [full, narrow, lower].filter((g) => !overlaps(g)).sort((a, b) => b.cell - a.cell)[0] ?? narrow;
    }
    const top = Math.max(hud ? hud.y + hud.h : 0, ctrl ? ctrl.y + ctrl.h : 0) + 4;
    return fit(pad, top, w - pad * 2, h - top - pad);
  };

  const statusText = (s: State | null): string => {
    if (!s) return '';
    if (s.over) {
      if (s.winner === 0) return 'Draw';
      if (!s.winner) return '';
      return `${playerName(s.winner)} ${playerName(s.winner) === 'You' ? 'win' : 'wins'}`;
    }
    const name = playerName(s.turn);
    if (isCpu(s.turn)) return 'Computer is thinking';
    return name === 'You' ? 'Your move' : `${name} to move`;
  };
  const playerName = (p: Player): string => {
    if (online) {
      if (p === mySeatColor()) return 'You';
      return online.players.find((pl) => pl.seat === seatOf(p))?.name ?? NAMES[p];
    }
    if (cfg.current.mode === 'cpu') return p === ME ? 'You' : 'Computer';
    return NAMES[p];
  };

  const askCpu = (s: State) => {
    const id = ++reqId.current;
    const cpu: Cpu = { id, col: null, waited: 0, need: MIN_THINK + Math.random() * 0.25 };
    s.cpu = cpu;
    const req: AiRequest = { id, board: Array.from(s.board), side: s.turn, level: cfg.current.level };
    const w = worker.current;
    if (w) w.postMessage(req);
    else
      queueMicrotask(() => {
        if (st.current?.cpu === cpu) cpu.col = bestCol(s.board, req.side, req.level, Math.random, { ms: 250 });
      });
  };

  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    if (w) {
      w.onmessage = (e: MessageEvent<AiReply>) => {
        const cpu = st.current?.cpu;
        if (cpu && cpu.id === e.data.id) cpu.col = e.data.col;
      };
      w.onerror = () => {
        worker.current = null;
        const s = st.current;
        if (s?.cpu && s.cpu.col === null) s.cpu.col = bestCol(s.board, s.turn, cfg.current.level, Math.random, { ms: 250 });
      };
    }
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
    };
  }, []);

  const place = (col: number, remote = false) => {
    const s = st.current;
    if (!s || s.over || s.falling) return;
    const d = drop(s.board, col, s.turn);
    if (!d) {
      sfx.play('blip', 0.5);
      return;
    }
    const net = onlineRef.current;
    if (net && !remote) net.send({ game: 'connect4', col });
    s.falling = { col, row: d.row, player: s.turn, y: -1, vy: 1.5 };
    s.ghost = col;
    s.hover = null;
    s.remoteHover = null;
    s.cpu = null;
    sfx.play('tick');
  };

  // The opponent's move. One that arrives while our own disc is still falling waits for it to land instead of being lost.
  const pendingCol = useRef<{ from: number; col: number } | null>(null);
  const takeRemote = (from: number, col: number) => {
    const s = st.current;
    if (!s || s.falling || s.over || from !== seatOf(s.turn)) return false;
    place(col, true);
    return true;
  };
  const takeRemoteRef = useRef(takeRemote);
  takeRemoteRef.current = takeRemote;
  useEffect(() => online?.onMessage((from, data) => {
    if (!online || from === online.seat || !data || typeof data !== 'object') return;
    const message = data as { game?: unknown; col?: unknown; hover?: unknown };
    if (message.game !== 'connect4') return;
    if (Number.isInteger(message.hover)) {
      const s = st.current;
      const c = message.hover as number;
      if (s && !s.falling && from === seatOf(s.turn) && c >= 0 && c < COLS) s.remoteHover = c;
      return;
    }
    if (!Number.isInteger(message.col)) return;
    if (!takeRemoteRef.current(from, message.col as number)) pendingCol.current = { from, col: message.col as number };
  }), [online?.onMessage, online?.seat]);

  const sentHover = useRef(-1);
  const shareHover = (col: number) => {
    const net = onlineRef.current;
    if (!net || col === sentHover.current) return;
    sentHover.current = col;
    net.send({ game: 'connect4', hover: col }, { fast: true });
  };

  const land = (s: State, f: Falling) => {
    const d = drop(s.board, f.col, f.player)!;
    const cell = idx(f.col, f.row);
    s.board = d.board;
    s.moves++;
    s.last = cell;
    s.falling = null;
    s.bounce[cell] = { y: 0, vy: -Math.min(4.5, f.vy * 0.2) };
    sfx.play('hit', 1.15 + f.row * 0.07);
    const line = winLine(s.board, cell);
    const net = onlineRef.current;
    const cpuMode = !net && cfg.current.mode === 'cpu';
    if (line) {
      s.win = line;
      s.winner = f.player;
      s.over = true;
      s.winT = 0;
      const g = geometry();
      for (const i of line) {
        const cx = g.x0 + colOf(i) * g.cell + g.cell / 2;
        const cy = g.y0 + (ROWS - 1 - rowOf(i)) * g.cell + g.cell / 2;
        for (let k = 0; k < 12; k++) {
          const a = Math.random() * Math.PI * 2;
          const v = (1.2 + Math.random() * 3.5) * g.cell;
          s.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - g.cell * 2, life: 0, max: 0.7 + Math.random() * 0.6, color: k % 3 ? COLORS[f.player] : '#ffffff', size: Math.max(1.5, g.cell * (0.04 + Math.random() * 0.05)) });
        }
      }
      const iWon = net ? f.player === mySeatColor() : cpuMode ? f.player === ME : true;
      sfx.play(iWon ? 'win' : 'lose');
      const key = tallyKey();
      const t = tally.get(key) ?? [0, 0];
      t[f.player - 1]++;
      tally.set(key, t);
      const discs = Math.ceil(s.moves / 2);
      const discsText = `${discs} ${discs === 1 ? 'disc' : 'discs'}`;
      const level = cfg.current.level;
      gameOverDelay.current = {
        remaining: 1.5,
        finish: () => {
          const room = onlineRef.current;
          if (room) {
            const winnerSeat = seatOf(f.player);
            const mine = winnerSeat === room.seat;
            const name = room.players.find((p) => p.seat === winnerSeat)?.name ?? NAMES[f.player];
            room.reportResult(room.round, winnerSeat);
            shell.gameOver(undefined, { title: mine ? 'You Win' : `${name} Wins`, detail: `${mine ? 'You' : name} lined up four with ${discsText}. ${rosterText(room.seat, room.players)}` });
            return;
          }
          if (cpuMode) {
            const youWon = f.player === ME;
            shell.gameOver(youWon && level === 2 ? discs : undefined, {
              title: youWon ? 'You Win' : 'Computer Wins',
              detail: youWon ? `Four in a row with ${discsText}.${level === 2 ? '' : ' Beat Hard to set a best.'}` : `The computer lined up four with ${discsText}.`,
            });
            return;
          }
          shell.gameOver(undefined, { title: `${NAMES[f.player]} Wins`, detail: `Four in a row with ${discsText}.` });
        },
      };
      refresh();
      return;
    }
    if (isFull(s.board)) {
      s.over = true;
      s.winner = 0;
      sfx.play('select', 0.7);
      gameOverDelay.current = {
        remaining: 1,
        finish: () => {
          const room = onlineRef.current;
          if (room) room.reportResult(room.round, null);
          shell.gameOver(undefined, { title: 'Draw', detail: `The board filled up with no four in a row.${room ? ` ${rosterText(room.seat, room.players)}` : ''}` });
        },
      };
      refresh();
      return;
    }
    s.turn = s.turn === 1 ? 2 : 1;
    s.cursor = f.col;
    sentHover.current = -1;
    const next = queued.current;
    queued.current = null;
    if (next !== null && !online && cfg.current.mode === '2p') {
      place(next);
      refresh();
      return;
    }
    const pending = pendingCol.current;
    if (pending && takeRemote(pending.from, pending.col)) {
      pendingCol.current = null;
      return;
    }
    if (isCpu(s.turn)) askCpu(s);
    refresh();
  };

  const reset = () => {
    cfg.current = { mode: online ? '2p' : mode, level: levelIndex(levelName) };
    // Online, whoever went second last round goes first in the next one.
    const turn: Player = online ? (online.round % 2 === 0 ? 2 : 1) : mode === 'cpu' ? (first === 'you' ? ME : 2) : 1;
    const s: State = {
      board: createBoard(),
      turn,
      falling: null,
      bounce: new Array(COLS * ROWS).fill(null),
      hover: null,
      cursor: 3,
      ghost: 3,
      ghostOn: 0,
      remoteHover: null,
      last: -1,
      win: null,
      winner: null,
      winT: 0,
      particles: [],
      cpu: null,
      t: 0,
      moves: 0,
      over: false,
      key: online ? `${online.seat}:${online.round}` : '',
    };
    st.current = s;
    pendingCol.current = null;
    queued.current = null;
    gameOverDelay.current = null;
    if (isCpu(turn)) askCpu(s);
    refresh();
  };
  // A fresh board on mount, when setup changes on the Start card, and when an online round hands out new seats.
  useEffect(() => {
    const s = st.current;
    const key = online ? `${online.seat}:${online.round}` : '';
    if (shell.status === 'ready' || !s || (s.key !== key && s.moves === 0 && !s.falling)) reset();
  }, [mode, levelName, first, shell.status, online?.seat, online?.round]);

  useKeys((code, e) => {
    const s = st.current;
    if (s && canQueue() && !e?.repeat) {
      if (code === 'Enter' || code === 'Space' || code === 'ArrowDown' || code === 'KeyS') queued.current = s.cursor;
      else if (/^Digit[1-7]$/.test(code)) queued.current = s.cursor = Number(code.slice(5)) - 1;
      else if (code === 'ArrowLeft' || code === 'KeyA') s.cursor = (s.cursor + COLS - 1) % COLS;
      else if (code === 'ArrowRight' || code === 'KeyD') s.cursor = (s.cursor + 1) % COLS;
      return;
    }
    if (!s || !humanTurn()) return;
    if (code === 'ArrowLeft' || code === 'KeyA') s.cursor = (s.cursor + COLS - 1) % COLS;
    else if (code === 'ArrowRight' || code === 'KeyD') s.cursor = (s.cursor + 1) % COLS;
    else if ((code === 'Enter' || code === 'Space' || code === 'ArrowDown' || code === 'KeyS') && !e?.repeat) place(s.cursor);
    else if (/^Digit[1-7]$/.test(code) && !e?.repeat) {
      s.cursor = Number(code.slice(5)) - 1;
      place(s.cursor);
    } else return;
    s.hover = null;
    if (!s.falling) shareHover(s.cursor);
  });

  // offsetX is in the canvas's own layout px, which stays right inside the scaled phone and iPad frames and on the
  // projected laptop screen, where clientX minus the bounding box does not.
  const colAt = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = geometry();
    const x = e.nativeEvent.offsetX;
    if (x < g.x0 - g.cell * 0.15 || x > g.x0 + g.bw + g.cell * 0.15) return null;
    return Math.max(0, Math.min(COLS - 1, Math.floor((x - g.x0) / g.cell)));
  };
  const press = useRef<number | null>(null);
  const aim = (col: number | null) => {
    const s = st.current;
    if (!s) return;
    s.hover = col;
    if (col !== null) {
      s.cursor = col;
      shareHover(col);
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!humanTurn()) return;
    if (e.pointerType !== 'mouse' && press.current !== e.pointerId) return;
    aim(colAt(e));
  };
  const onPointerLeave = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && st.current) st.current.hover = null;
  };
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (canQueue() && (e.pointerType !== 'mouse' || e.button === 0)) {
      queued.current = colAt(e);
      return;
    }
    if (!humanTurn() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const c = colAt(e);
    if (e.pointerType === 'mouse') {
      if (c !== null) place(c);
      return;
    }
    // Touch and pen: the disc follows the finger and drops on release, so a finger can slide to the right column first.
    press.current = e.pointerId;
    aim(c);
  };
  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (press.current !== e.pointerId) return;
    press.current = null;
    const s = st.current;
    const c = colAt(e) ?? s?.hover ?? null;
    if (s) s.hover = null;
    if (c !== null && humanTurn()) place(c);
  };
  const onPointerCancel = () => {
    press.current = null;
    if (st.current) st.current.hover = null;
  };

  let unitCheck = 0;
  const update = (dt: number) => {
    const s = st.current;
    if (!s) return;
    s.t += dt;
    unitCheck += dt;
    if (shell.touch && unitCheck > 0.5) {
      unitCheck = 0;
      const u = frameUnit(shell.root.current);
      shell.root.current?.style.setProperty('--g-connect4-u', String(u));
      if (Math.abs(u - unitRef.current) > 0.004) setUnit(u);
    }
    if (s.falling) {
      const f = s.falling;
      f.vy += GRAVITY * dt;
      f.y += f.vy * dt;
      const target = ROWS - 1 - f.row;
      if (f.y >= target) {
        f.y = target;
        land(s, f);
      }
    } else if (!s.over && s.cpu) {
      const cpu = s.cpu;
      cpu.waited += dt;
      if (cpu.col !== null && cpu.waited >= cpu.need) {
        // Glide the disc over to its column, then let go.
        if (Math.abs(s.ghost - cpu.col) < 0.06) place(cpu.col);
      }
    }
    // Floating disc: follows the mouse, keys, a finger, the opponent's pointer online, or the computer's choice.
    const human = humanTurn();
    let target: number | null = null;
    if (human) target = s.hover ?? (shell.touch ? null : s.cursor);
    else if (s.cpu) target = s.cpu.col ?? 3 + Math.sin(s.t * 2.2) * 1.4 * Math.min(1, s.cpu.waited * 2);
    else if (online && !s.over && !s.falling) target = s.remoteHover;
    if (target !== null) {
      s.ghost += (target - s.ghost) * Math.min(1, dt * (s.cpu?.col != null ? 9 : 16));
      if (s.cpu?.col != null && Math.abs(target - s.ghost) < 0.06) s.ghost = target;
    }
    s.ghostOn = Math.max(0, Math.min(1, s.ghostOn + (target !== null && !s.falling ? dt : -dt) * 7));
    const overDelay = gameOverDelay.current;
    if (overDelay) {
      overDelay.remaining -= dt;
      if (overDelay.remaining <= 0) {
        gameOverDelay.current = null;
        overDelay.finish();
      }
    }
    for (let i = 0; i < s.bounce.length; i++) {
      const b = s.bounce[i];
      if (!b) continue;
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y >= 0) {
        if (b.vy > 1.2) {
          b.y = 0;
          b.vy = -b.vy * 0.3;
        } else s.bounce[i] = null;
      }
    }
    if (s.win) s.winT += dt;
    const g = sizeRef.current.h;
    for (const p of s.particles) {
      p.life += dt;
      p.vy += g * 1.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    s.particles = s.particles.filter((p) => p.life < p.max);
  };

  // Board and discs are drawn once per size into offscreen canvases.
  const getSprites = (g: Geo, dpr: number) => {
    const key = `${g.cell}:${dpr}`;
    const cache = sprites.current;
    if (cache.key === key && cache.board) return cache;
    cache.key = key;
    cache.board = drawBoard(g, dpr);
    cache.discs = { 1: drawDisc(g.r, dpr, 1), 2: drawDisc(g.r, dpr, 2) };
    return cache;
  };

  const render = () => {
    const c = ctx();
    const s = st.current;
    const { w, h, dpr } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const g = geometry();
    const bg = c.createRadialGradient(w / 2, g.y0 + g.bh * 0.45, g.cell, w / 2, g.y0 + g.bh * 0.45, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#1c2140');
    bg.addColorStop(0.55, '#11131f');
    bg.addColorStop(1, '#0a0b11');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (!s) return;
    const spr = getSprites(g, dpr);
    const r = g.r;
    const cx = (col: number) => g.x0 + col * g.cell + g.cell / 2;
    const cy = (row: number) => g.y0 + (ROWS - 1 - row) * g.cell + g.cell / 2;
    const disc = (x: number, y: number, p: Player, scaleX = 1, scaleY = 1, alpha = 1) => {
      const img = spr.discs[p];
      if (!img) return;
      const dw = r * 2 * scaleX;
      const dh = r * 2 * scaleY;
      c.globalAlpha = alpha;
      c.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
      c.globalAlpha = 1;
    };

    // Soft shadow under the board
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.filter = `blur(${Math.max(2, g.cell * 0.18)}px)`;
    c.beginPath();
    c.ellipse(g.x0 + g.bw / 2, g.y0 + g.bh + g.cell * 0.28, g.bw * 0.52, g.cell * 0.16, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // Column glow behind the board, seen through the holes
    const human = humanTurn();
    const lit = s.ghostOn > 0.01 && !s.over ? s.ghost : null;
    if (lit !== null) {
      const col = Math.round(lit);
      if (s.board[idx(col, ROWS - 1)] === 0) {
        const glow = c.createLinearGradient(0, g.y0, 0, g.y0 + g.bh);
        glow.addColorStop(0, `rgba(255,255,255,${0.02 * s.ghostOn})`);
        glow.addColorStop(1, `rgba(255,255,255,${0.1 * s.ghostOn})`);
        c.fillStyle = glow;
        c.fillRect(g.x0 + col * g.cell, g.y0, g.cell, g.bh);
      }
    }

    // Falling disc, behind the frame so it slides down inside the slots
    if (s.falling) {
      const f = s.falling;
      disc(cx(f.col), g.y0 + f.y * g.cell + g.cell / 2, f.player);
    }
    for (let i = 0; i < s.board.length; i++) {
      const v = s.board[i];
      if (!v) continue;
      const b = s.bounce[i];
      const y = cy(rowOf(i)) + (b ? b.y * g.cell : 0);
      const dim = !!s.win && !s.win.includes(i) && s.winT > 0.15 ? Math.max(0.32, 1 - (s.winT - 0.15) * 2.5) : 1;
      disc(cx(colOf(i)), y, v as Player, 1, 1, dim);
    }

    c.drawImage(spr.board!, g.x0 - g.cell * 0.14, g.y0 - g.cell * 0.14, g.bw + g.cell * 0.28, g.bh + g.cell * 0.28);

    // Last move marker
    if (s.last >= 0 && !s.win && !s.falling && !s.bounce[s.last]) {
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath();
      c.arc(cx(colOf(s.last)), cy(rowOf(s.last)), Math.max(1.5, r * 0.13), 0, Math.PI * 2);
      c.fill();
    }

    // Floating disc above the board
    if (s.ghostOn > 0.01 && !s.over && !s.falling) {
      const bob = Math.sin(s.t * 4) * g.cell * 0.035;
      const pressing = shell.touch && human && s.hover !== null;
      disc(cx(s.ghost), g.y0 - g.cell * 0.62 + bob, s.turn, 1, 1, s.ghostOn * (pressing || !human || !shell.touch ? 1 : 0.9));
    }

    if (s.win && s.winner) {
      const t = Math.min(1, s.winT / 0.5);
      const ease = 1 - Math.pow(1 - t, 3);
      const pulse = 0.5 + 0.5 * Math.sin(s.winT * 6);
      c.save();
      c.strokeStyle = '#ffffff';
      c.shadowColor = COLORS[s.winner];
      for (const i of s.win) {
        c.globalAlpha = ease * (0.55 + 0.45 * pulse);
        c.shadowBlur = g.cell * 0.35;
        c.lineWidth = Math.max(1.5, r * 0.12);
        c.beginPath();
        c.arc(cx(colOf(i)), cy(rowOf(i)), r * 1.02, 0, Math.PI * 2);
        c.stroke();
      }
      const a = s.win[0];
      const b = s.win[3];
      const x1 = cx(colOf(a));
      const y1 = cy(rowOf(a));
      c.globalAlpha = 0.9;
      c.lineCap = 'round';
      c.shadowBlur = g.cell * 0.3;
      c.lineWidth = Math.max(3, g.cell * 0.11);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x1 + (cx(colOf(b)) - x1) * ease, y1 + (cy(rowOf(b)) - y1) * ease);
      c.stroke();
      c.restore();
    }
    for (const p of s.particles) {
      c.globalAlpha = Math.max(0, 1 - p.life / p.max);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  };

  useGameLoop(update, render);

  const s = st.current;
  const players: Player[] = [1, 2];
  const counts = tally.get(tallyKey());
  const status = statusText(s);
  return (
    <div className={`g-connect4-stage${side ? ' is-side' : size.w > 0 && size.w < 470 * unit ? ' is-under' : ''}`} style={{ '--g-connect4-u': unit } as CSSProperties}>
      <canvas
        ref={ref}
        className="g-connect4-canvas"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label="Connect Four board"
      />
      <div ref={hudRef} className="g-connect4-hud">
        {s &&
          players.map((p) => {
            const active = !s.over && s.turn === p;
            const won = s.over && s.winner === p;
            return (
              <div key={p} className={`g-connect4-player${active ? ' is-turn' : ''}${won ? ' is-won' : ''}${active && isCpu(p) ? ' is-thinking' : ''}`} style={{ '--c': COLORS[p] } as CSSProperties}>
                <span className="g-connect4-chip" aria-hidden="true" />
                <span className="g-connect4-name">{playerName(p)}</span>
                {counts && counts[0] + counts[1] > 0 && <span className="g-connect4-wins">{counts[p - 1]}</span>}
              </div>
            );
          })}
      </div>
      <div className="g-connect4-sr" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

/** Who is in the room, for the online Game Over card. */
export function rosterText(mySeat: number, players: readonly { seat: number; name: string }[]): string {
  const names = players
    .slice()
    .sort((a, b) => (a.seat === mySeat ? -1 : b.seat === mySeat ? 1 : a.seat - b.seat))
    .map((p) => (p.seat === mySeat ? 'You' : p.name));
  if (names.length <= 1) return 'Just you here now.';
  return `${names.length} people here: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = Math.max(1, Math.ceil(w));
  el.height = Math.max(1, Math.ceil(h));
  return [el, el.getContext('2d')!];
}

function drawBoard(g: Geo, dpr: number): HTMLCanvasElement {
  const m = g.cell * 0.14;
  const W = g.bw + m * 2;
  const H = g.bh + m * 2;
  const [el, c] = canvasOf(W * dpr, H * dpr);
  c.scale(dpr, dpr);
  const rad = g.cell * 0.26;
  const hole = g.r * 1.1;
  const hx = (col: number) => m + col * g.cell + g.cell / 2;
  const hy = (row: number) => m + row * g.cell + g.cell / 2;
  c.beginPath();
  c.roundRect(0, 0, W, H, rad);
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++) {
      c.moveTo(hx(col) + hole, hy(row));
      c.arc(hx(col), hy(row), hole, 0, Math.PI * 2, true);
    }
  const fill = c.createLinearGradient(0, 0, W * 0.3, H);
  fill.addColorStop(0, '#3a62f0');
  fill.addColorStop(0.5, '#2a4bd8');
  fill.addColorStop(1, '#1d35a8');
  c.fillStyle = fill;
  c.fill('evenodd');
  // Rim light on the top edge, darker bottom edge
  c.save();
  c.beginPath();
  c.roundRect(0.75, 0.75, W - 1.5, H - 1.5, rad);
  const rim = c.createLinearGradient(0, 0, 0, H);
  rim.addColorStop(0, 'rgba(255,255,255,0.35)');
  rim.addColorStop(0.12, 'rgba(255,255,255,0.08)');
  rim.addColorStop(1, 'rgba(0,0,30,0.4)');
  c.strokeStyle = rim;
  c.lineWidth = 1.5;
  c.stroke();
  c.restore();
  // Each hole: a lit lower lip and a shadowed upper wall, so the board reads as thick plastic.
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++) {
      const x = hx(col);
      const y = hy(row);
      c.save();
      c.beginPath();
      c.arc(x, y, hole, 0, Math.PI * 2);
      c.clip();
      c.shadowColor = 'rgba(0,0,20,0.7)';
      c.shadowBlur = hole * 0.35;
      c.shadowOffsetY = hole * 0.16;
      c.lineWidth = hole * 0.5;
      c.strokeStyle = '#1a2c8c';
      c.beginPath();
      c.arc(x, y, hole + hole * 0.25, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = Math.max(1, hole * 0.06);
      c.beginPath();
      c.arc(x, y, hole, Math.PI * 0.15, Math.PI * 0.85);
      c.stroke();
    }
  return el;
}

function drawDisc(r: number, dpr: number, p: Player): HTMLCanvasElement {
  const size = r * 2;
  const [el, c] = canvasOf(size * dpr, size * dpr);
  c.scale(dpr, dpr);
  const x = r;
  const y = r;
  const body = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, mix(COLORS[p], '#ffffff', 0.35));
  body.addColorStop(0.45, COLORS[p]);
  body.addColorStop(1, SHADES[p]);
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  // Raised inner ring, like a real checker
  c.lineWidth = Math.max(1, r * 0.1);
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.beginPath();
  c.arc(x, y + r * 0.03, r * 0.68, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.28)';
  c.beginPath();
  c.arc(x, y - r * 0.03, r * 0.68, Math.PI * 1.05, Math.PI * 1.95);
  c.stroke();
  // Specular highlight
  const hi = c.createRadialGradient(x - r * 0.38, y - r * 0.45, 0, x - r * 0.38, y - r * 0.45, r * 0.5);
  hi.addColorStop(0, 'rgba(255,255,255,0.55)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  return el;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
