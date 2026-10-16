import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelIndex, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { chooseMove, geo, isGame, leaders, lineAt, lineEnds, newGame, play, stepCursor, type Game, type Level } from './dots.ts';
import type { AiReply, AiRequest } from './worker.ts';
import { meta } from './meta';
import './dots-boxes.css';

const GRIDS = ['3', '4', '5', '6'] as const;
const MODE = defineSetting('dots-boxes:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('dots-boxes:level', LEVEL_NAMES, 'normal');
const GRID = defineSetting('dots-boxes:grid', GRIDS, '4');
const RIVALS = defineSetting('dots-boxes:rivals', ['1', '2', '3'] as const, '1');
const PLAYERS = defineSetting('dots-boxes:players', ['2', '3', '4'] as const, '2');
const gridOptions = GRIDS.map((g) => [g, `${g} × ${g}`] as const);
const modeOpts = [
  ['cpu', 'vs Computer'],
  ['2p', 'Local Players'],
] as const;
const rivalOptions = [
  ['1', '1 Rival'],
  ['2', '2 Rivals'],
  ['3', '3 Rivals'],
] as const;
const playerOptions = [
  ['2', '2 Players'],
  ['3', '3 Players'],
  ['4', '4 Players'],
] as const;

const COLORS = ['#0a84ff', '#ff453a', '#30d158', '#ff9f0a'];
const LOCAL_NAMES = ['Blue', 'Red', 'Green', 'Orange'];
const CPU_NAMES = ['Pip', 'Moss', 'Juno'];
const GAME = 'dots-boxes';
const SIDE = { top: 12, bottom: 12, left: 172, right: 16 };
const STACK = { top: 50, bottom: 62, left: 22, right: 22 };
const fit = (m: typeof SIDE, w: number, h: number, rows: number, cols: number) =>
  Math.min(120, (w - m.left - m.right) / cols, (h - m.top - m.bottom) / rows);
// short wide windows put the scoreboard in a left column when that gives a clearly bigger board
const sideLayout = (w: number, h: number, rows: number, cols: number, seats: number) =>
  w >= 400 && h >= 36 + seats * 28 && fit(SIDE, w, h, rows, cols) > fit(STACK, w, h, rows, cols) * 1.1;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={CPU_NAMES}>
      <DotsBoxes />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [grid, setGrid] = useSetting(GRID);
  const [rivals, setRivals] = useSetting(RIVALS);
  const [players, setPlayers] = useSetting(PLAYERS);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOpts} onChange={setMode} />
      <Segmented label="Grid" value={grid} options={gridOptions} onChange={setGrid} />
      {mode === 'cpu' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
      {mode === '2p' && <Segmented label="Players" value={players} options={playerOptions} onChange={setPlayers} />}
    </>
  );
}

/** The host picks the grid and how well the bots play; the host's game sends both with the board. */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [grid, setGrid] = useSetting(GRID);
  if (!online?.isHost) return null;
  return (
    <>
      <Segmented label="Grid" value={grid} options={gridOptions} onChange={setGrid} />
      {online.bots.length > 0 && <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Seat = { name: string; color: string; cpu: boolean; seat: number; left: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string };
/** `at` is a performance.now() deadline, so slow frames (the loop caps dt) never stretch a bot's turn. */
type Think = { id: number; moves: number; at: number; line: number | null };
type Match = {
  game: Game;
  seats: Seat[];
  level: Level;
  /** Online rounds only: the room round this board belongs to. */
  online: boolean;
  lineT: Float32Array;
  boxT: Float32Array;
  sparks: Spark[];
  hover: number;
  cursor: number;
  keyboard: boolean;
  think: Think | null;
  pending: { line: number; age: number } | null;
  overT: number;
  finished: boolean;
  streak: number;
  shake: number;
};
type StatePacket = { game: typeof GAME; type: 'state'; board: Game; seats: Seat[]; completed: number[] };

const seatList = (v: unknown): Seat[] | null => {
  if (!Array.isArray(v) || v.length < 2 || v.length > 4) return null;
  const out: Seat[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (typeof o.name !== 'string' || !Number.isInteger(o.seat)) return null;
    out.push({ name: o.name.slice(0, 24), color: COLORS[out.length], cpu: !!o.cpu, seat: o.seat as number, left: !!o.left });
  }
  return out;
};

function DotsBoxes() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const [, bump] = useState(0);
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const [grid] = useSetting(GRID);
  const [rivals] = useSetting(RIVALS);
  const [playerCount] = useSetting(PLAYERS);
  const m = useRef<Match | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const keyRef = useRef('');
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const prevScores = useRef<number[]>([]);
  const redraw = () => bump((n) => n + 1);

  const onlineLive = !!online && shell.status !== 'ready';
  const isHost = !onlineLive || online!.isHost;
  const mySeat = online?.seat ?? 0;

  // One AI worker per game, so even Hard's search never blocks a frame.
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    w.onmessage = (e: MessageEvent<AiReply>) => receiveAi(e.data);
    w.onerror = () => {
      w?.terminate();
      if (worker.current === w) worker.current = null;
      const t = m.current?.think;
      if (t && t.line === null) askAi(true);
    };
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
    };
  }, []);

  const freshFx = (g: Game) => {
    const G = geo(g.rows, g.cols);
    return { lineT: new Float32Array(G.lines).fill(1), boxT: new Float32Array(G.boxes).fill(1) };
  };

  const build = (game: Game, seats: Seat[], level: Level, isOnline: boolean): Match => ({
    game,
    seats,
    level,
    online: isOnline,
    ...freshFx(game),
    sparks: [],
    hover: -1,
    cursor: 0,
    keyboard: false,
    think: null,
    pending: null,
    overT: -1,
    finished: false,
    streak: 0,
    shake: 0,
  });

  const reset = () => {
    const n = Number(grid);
    const o = onlineRef.current;
    if (o && shell.status !== 'ready') {
      if (!o.isHost) {
        m.current = null;
        redraw();
        return;
      }
      const humans = o.players.map((p) => ({ seat: p.seat, name: p.name, cpu: false }));
      const bots = o.bots.filter((b) => !humans.some((h) => h.seat === b.seat)).map((b) => ({ seat: b.seat, name: b.name, cpu: true }));
      const all = [...humans, ...bots].sort((a, b) => a.seat - b.seat).slice(0, 4);
      const seats = all.map((s, i) => ({ ...s, color: COLORS[i], left: false, name: s.name || `Player ${i + 1}` }));
      const count = Math.max(2, seats.length);
      while (seats.length < 2) seats.push({ name: CPU_NAMES[0], color: COLORS[seats.length], cpu: true, seat: 99, left: false });
      m.current = build(newGame(n, n, count, Math.max(0, o.round - 1) % count), seats, levelIndex(levelName), true);
      broadcast([]);
    } else if (mode === 'cpu') {
      const k = Number(rivals);
      const seats: Seat[] = [{ name: 'You', color: COLORS[0], cpu: false, seat: 0, left: false }];
      for (let i = 0; i < k; i++) seats.push({ name: CPU_NAMES[i], color: COLORS[i + 1], cpu: true, seat: i + 1, left: false });
      m.current = build(newGame(n, n, seats.length, 0), seats, levelIndex(levelName), false);
    } else {
      const k = Number(playerCount);
      const seats = Array.from({ length: k }, (_, i) => ({ name: LOCAL_NAMES[i], color: COLORS[i], cpu: false, seat: i, left: false }));
      m.current = build(newGame(n, n, k, Math.max(0, shell.round - 1) % k), seats, levelIndex(levelName), false);
    }
    prevScores.current = m.current.game.scores.slice();
    redraw();
  };

  const key = onlineLive ? `on:${online!.round}:${online!.seat}` : 'off';
  useEffect(() => {
    if (onlineLive) {
      if (keyRef.current !== key || (online!.isHost && !m.current)) {
        keyRef.current = key;
        reset();
      }
    } else if (shell.status === 'ready' || !m.current || keyRef.current !== key) {
      keyRef.current = key;
      reset();
    }
  }, [key, shell.status, mode, grid, rivals, playerCount, levelName]);

  // the room's host plays for anyone who leaves mid-round, so the board can still finish
  useEffect(() => {
    const s = m.current;
    if (!online?.isHost || !onlineLive || !s?.online || s.game.over) return;
    const here = new Set(online.players.map((p) => p.seat));
    let changed = false;
    for (const seat of s.seats)
      if (!seat.cpu && !here.has(seat.seat)) {
        seat.cpu = true;
        seat.left = true;
        changed = true;
      }
    if (changed) {
      broadcast([]);
      redraw();
    }
  }, [online?.players]);

  function broadcast(completed: number[], to?: number) {
    const o = onlineRef.current;
    const s = m.current;
    if (!o?.isHost || !s?.online) return;
    const packet: StatePacket = { game: GAME, type: 'state', board: s.game, seats: s.seats.map(({ name, cpu, seat, left }) => ({ name, cpu, seat, left, color: '' })), completed };
    o.send(packet, to === undefined ? undefined : { to });
  }

  // guests ask for the board until it comes, then follow the host's packets
  useEffect(() => {
    if (!online || !onlineLive) return;
    const off = online.onMessage((from, data) => {
      if (!data || typeof data !== 'object') return;
      const msg = data as Record<string, unknown>;
      if (msg.game !== GAME) return;
      const s = m.current;
      if (online.isHost) {
        if (msg.type === 'hello') broadcast([], from);
        else if (msg.type === 'move' && s?.online && Number.isInteger(msg.line) && msg.moves === s.game.moves) {
          const seat = s.seats[s.game.turn];
          if (seat && !seat.cpu && seat.seat === from && from !== online.seat) commit(msg.line as number);
          else broadcast([], from);
        }
        return;
      }
      if (from !== 0 || msg.type !== 'state' || !isGame(msg.board)) return;
      const seats = seatList(msg.seats);
      if (!seats || seats.length !== msg.board.players) return;
      applyState(msg.board, seats);
    });
    let timer = 0;
    if (!online.isHost) {
      const hello = () => {
        if (!m.current) online.send({ game: GAME, type: 'hello' });
      };
      hello();
      timer = window.setInterval(hello, 1200);
    }
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [online, onlineLive]);

  const geometry = () => {
    const { w, h } = sizeRef.current;
    const s = m.current;
    const rows = s?.game.rows ?? Number(grid);
    const cols = s?.game.cols ?? Number(grid);
    const m2 = sideLayout(w, h, rows, cols, s?.seats.length ?? 2) ? SIDE : STACK;
    const { top, bottom, left, right } = m2;
    const cell = Math.max(10, fit(m2, w, h, rows, cols));
    const bw = cell * cols;
    const bh = cell * rows;
    const x0 = left + (w - left - right - bw) / 2;
    const y0 = top + (h - top - bottom - bh) / 2;
    return { cell, x0, y0, bw, bh };
  };

  const seatOf = (s: Match, i: number) => s.seats[i];
  const myTurn = (s: Match) => {
    if (s.game.over) return false;
    const seat = seatOf(s, s.game.turn);
    if (!seat) return false;
    if (s.online) return !seat.cpu && seat.seat === mySeat;
    return !seat.cpu;
  };
  const canInput = () => {
    const s = m.current;
    return !!s && shell.status === 'playing' && myTurn(s) && !s.pending && s.overT < 0;
  };

  const effects = (s: Match, line: number, completed: number[], owner: number) => {
    const g = geometry();
    s.lineT[line] = 0;
    if (completed.length) {
      s.streak++;
      s.shake = Math.min(1, 0.35 + completed.length * 0.25);
      for (const b of completed) {
        s.boxT[b] = 0;
        const cx = g.x0 + ((b % s.game.cols) + 0.5) * g.cell;
        const cy = g.y0 + (Math.floor(b / s.game.cols) + 0.5) * g.cell;
        for (let k = 0; k < 14; k++) {
          const a = Math.random() * Math.PI * 2;
          const v = 60 + Math.random() * 160;
          s.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0, max: 0.45 + Math.random() * 0.4, color: s.seats[owner]?.color ?? '#fff' });
        }
      }
      sfx.play('coin', Math.min(1.8, 1 + (s.streak - 1) * 0.07 + (completed.length - 1) * 0.15));
    } else {
      s.streak = 0;
      sfx.play('tick', 0.9 + Math.random() * 0.2);
    }
  };

  /** Draws a line for whoever is to move (host or local games only). */
  function commit(line: number): boolean {
    const s = m.current;
    if (!s || s.overT >= 0) return false;
    const owner = s.game.turn;
    const r = play(s.game, line);
    if (!r) return false;
    s.game = r.game;
    s.think = null;
    s.hover = -1;
    effects(s, line, r.completed, owner);
    if (s.online) broadcast(r.completed);
    if (r.game.over) s.overT = 1.3;
    redraw();
    return true;
  }

  function applyState(board: Game, seats: Seat[]) {
    const prev = m.current;
    if (!prev || prev.game.rows !== board.rows || prev.game.cols !== board.cols || board.moves < prev.game.moves) {
      m.current = build(board, seats, 1, true);
      m.current.overT = board.over ? 1.3 : -1;
      prevScores.current = board.scores.slice();
      redraw();
      return;
    }
    const s = prev;
    s.seats = seats;
    if (board.moves > s.game.moves) {
      const G = geo(board.rows, board.cols);
      const fresh: number[] = [];
      for (let l = 0; l < G.lines; l++) if (board.lines[l] && !s.game.lines[l]) fresh.push(l);
      const gained = board.boxes.flatMap((o, b) => (o >= 0 && s.game.boxes[b] < 0 ? [b] : []));
      for (const l of fresh) effects(s, l, l === board.last ? gained : [], board.lines[l] - 1);
      s.game = board;
      s.hover = -1;
      if (board.over && s.overT < 0) s.overT = 1.3;
    }
    s.pending = null;
    redraw();
  }

  const press = (line: number) => {
    const s = m.current;
    if (!s || line < 0 || !canInput()) return;
    if (s.online && !online?.isHost) {
      if (s.game.lines[line]) return;
      s.pending = { line, age: 0 };
      s.lineT[line] = 0;
      sfx.play('tick', 1);
      online?.send({ game: GAME, type: 'move', line, moves: s.game.moves });
      redraw();
      return;
    }
    if (!commit(line)) sfx.play('blip', 0.5);
  };

  function askAi(sync = false) {
    const s = m.current;
    if (!s?.think) return;
    const id = s.think.id;
    const req: AiRequest = { id, rows: s.game.rows, cols: s.game.cols, lines: s.game.lines, level: s.level, seed: (Math.random() * 2 ** 31) | 0, ms: 300 };
    const w = worker.current;
    if (w && !sync) {
      w.postMessage(req);
      return;
    }
    window.setTimeout(() => receiveAi({ id, line: chooseMove(req, req.level, Math.random, 250) }), 0);
  }

  function receiveAi(reply: AiReply) {
    const s = m.current;
    const t = s?.think;
    if (!s || !t || t.id !== reply.id || t.moves !== s.game.moves) return;
    t.line = Number.isInteger(reply.line) && reply.line >= 0 && !s.game.lines[reply.line] ? reply.line : chooseMove(s.game, 1);
  }

  const drivesTurn = (s: Match) => {
    if (s.game.over || s.overT >= 0) return false;
    const seat = seatOf(s, s.game.turn);
    if (!seat?.cpu) return false;
    return !s.online || !!onlineRef.current?.isHost;
  };

  const finish = (s: Match) => {
    if (s.finished) return;
    s.finished = true;
    const o = onlineRef.current;
    const top = leaders(s.game);
    const tie = top.length > 1;
    const w = s.seats[top[0]];
    const detail = s.seats.map((seat, i) => `${seat.name} ${s.game.scores[i]}`).join(', ') + '.';
    let title: string;
    if (tie) title = 'Tie Game';
    else if (s.online) title = w.seat === mySeat ? 'You Win' : `${w.name} Wins`;
    else if (mode === 'cpu') title = w.cpu ? `${w.name} Wins` : 'You Win';
    else title = `${w.name} Wins`;
    const lost = (s.online && !tie && w.seat !== mySeat) || (!s.online && mode === 'cpu' && (tie || w.cpu));
    sfx.play(lost ? 'lose' : 'win');
    if (s.online && o) o.reportResult(o.round, tie || w.seat > 3 ? null : w.seat);
    shell.gameOver(undefined, { title, detail });
  };

  useKeys((code, e) => {
    const s = m.current;
    if (!s || !canInput()) return;
    const G = geo(s.game.rows, s.game.cols);
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
    if (dirs[code]) {
      s.cursor = s.keyboard ? stepCursor(G, s.cursor, ...dirs[code]) : Math.max(0, s.cursor);
      s.keyboard = true;
      s.hover = -1;
    } else if ((code === 'Enter' || code === 'Space') && !e?.repeat) {
      if (!s.keyboard) {
        s.keyboard = true;
        return;
      }
      if (s.game.lines[s.cursor]) sfx.play('blip', 0.5);
      else press(s.cursor);
    }
  });

  const pointLine = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }, reach: number) => {
    const s = m.current;
    if (!s) return -1;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    // the laptop and iPad frames scale the page, so map screen pixels back to the canvas's own CSS pixels
    const sx = el.clientWidth ? r.width / el.clientWidth : 1;
    const sy = el.clientHeight ? r.height / el.clientHeight : 1;
    const g = geometry();
    const x = ((e.clientX - r.left) / sx - g.x0) / g.cell;
    const y = ((e.clientY - r.top) / sy - g.y0) / g.cell;
    return lineAt(geo(s.game.rows, s.game.cols), s.game.lines, x, y, reach);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = m.current;
    if (!s || e.pointerType === 'touch') return;
    s.hover = canInput() ? pointLine(e, 0.45) : -1;
    if (s.hover >= 0) {
      s.keyboard = false;
      s.cursor = s.hover;
    }
  };
  const onPointerLeave = () => {
    if (m.current) m.current.hover = -1;
  };
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = m.current;
    if (!s || !canInput()) return;
    const l = pointLine(e, e.pointerType === 'touch' ? 0.6 : 0.45);
    if (l < 0) return;
    s.keyboard = false;
    s.cursor = l;
    press(l);
  };

  const update = (dt: number) => {
    const s = m.current;
    if (!s) return;
    for (let i = 0; i < s.lineT.length; i++) if (s.lineT[i] < 1) s.lineT[i] = Math.min(1, s.lineT[i] + dt * 6);
    for (let i = 0; i < s.boxT.length; i++) if (s.boxT[i] < 1) s.boxT[i] = Math.min(1, s.boxT[i] + dt * 3.2);
    s.shake = Math.max(0, s.shake - dt * 3);
    for (const p of s.sparks) {
      p.life += dt;
      p.vy += 300 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (s.sparks.length) s.sparks = s.sparks.filter((p) => p.life < p.max);
    if (s.pending && (s.pending.age += dt) > 3) s.pending = null;
    if (drivesTurn(s)) {
      if (!s.think || s.think.moves !== s.game.moves) {
        const quick = s.streak > 0;
        s.think = { id: ++reqId.current, moves: s.game.moves, at: performance.now() + (quick ? 200 + Math.random() * 100 : 350 + Math.random() * 250), line: null };
        askAi();
        redraw();
      } else {
        if (performance.now() >= s.think.at && s.think.line !== null) {
          const l = s.think.line;
          if (!commit(l)) {
            const fallback = chooseMove(s.game, 0);
            if (fallback >= 0) commit(fallback);
          }
        }
      }
    }
    if (s.overT >= 0) {
      s.overT -= dt;
      if (s.overT < 0 && !s.finished) {
        s.overT = 0;
        finish(s);
      }
    }
  };

  const render = () => {
    const c = ctx();
    const s = m.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#171a26');
    bg.addColorStop(1, '#0b0c12');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const g = geometry();
    const rows = s?.game.rows ?? Number(grid);
    const cols = s?.game.cols ?? Number(grid);
    const G = geo(rows, cols);
    const shake = s ? s.shake * s.shake * 4 : 0;
    c.save();
    if (shake) c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const px = (x: number) => g.x0 + x * g.cell;
    const py = (y: number) => g.y0 + y * g.cell;
    const lw = Math.max(4, g.cell * 0.085);

    // boxes
    if (s) {
      for (let b = 0; b < G.boxes; b++) {
        const o = s.game.boxes[b];
        if (o < 0) continue;
        const t = s.boxT[b];
        const ease = 1 - Math.pow(1 - t, 3);
        const scale = 0.4 + ease * 0.6 + Math.sin(t * Math.PI) * 0.08;
        const cx = px((b % cols) + 0.5);
        const cy = py(Math.floor(b / cols) + 0.5);
        const half = (g.cell - lw) * 0.5 * scale;
        const color = s.seats[o]?.color ?? '#888';
        c.globalAlpha = 0.26 + (1 - ease) * 0.4;
        c.fillStyle = color;
        c.beginPath();
        c.roundRect(cx - half, cy - half, half * 2, half * 2, Math.max(3, g.cell * 0.08));
        c.fill();
        c.globalAlpha = ease;
        c.fillStyle = color;
        c.font = `700 ${Math.round(g.cell * 0.34)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText((s.seats[o]?.name ?? '?').slice(0, 1).toUpperCase(), cx, cy + g.cell * 0.02);
        c.globalAlpha = 1;
      }
    }

    // empty slots, faint so you can see where lines go
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = lw * 0.7;
    c.beginPath();
    for (let l = 0; l < G.lines; l++) {
      if (s?.game.lines[l]) continue;
      const [x1, y1, x2, y2] = lineEnds(G, l);
      c.moveTo(px(x1), py(y1));
      c.lineTo(px(x2), py(y2));
    }
    c.stroke();

    if (s) {
      const human = canInput();
      const turnColor = s.seats[s.game.turn]?.color ?? '#fff';
      const preview = human ? (s.hover >= 0 ? s.hover : s.keyboard && !shell.touch ? s.cursor : -1) : -1;
      if (preview >= 0) {
        const [x1, y1, x2, y2] = lineEnds(G, preview);
        c.globalAlpha = s.game.lines[preview] ? 0.25 : 0.5;
        c.strokeStyle = s.game.lines[preview] ? '#fff' : turnColor;
        c.lineWidth = lw;
        c.beginPath();
        c.moveTo(px(x1), py(y1));
        c.lineTo(px(x2), py(y2));
        c.stroke();
        c.globalAlpha = 1;
      }
      if (s.pending) {
        const [x1, y1, x2, y2] = lineEnds(G, s.pending.line);
        c.globalAlpha = 0.6;
        c.strokeStyle = turnColor;
        c.lineWidth = lw;
        c.beginPath();
        c.moveTo(px(x1), py(y1));
        c.lineTo(px(x2), py(y2));
        c.stroke();
        c.globalAlpha = 1;
      }
      // drawn lines grow out from the middle
      for (let l = 0; l < G.lines; l++) {
        const who = s.game.lines[l];
        if (!who) continue;
        const [x1, y1, x2, y2] = lineEnds(G, l);
        const t = s.lineT[l];
        const ease = 1 - Math.pow(1 - t, 3);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const color = s.seats[who - 1]?.color ?? '#fff';
        c.strokeStyle = color;
        c.lineWidth = lw * (1 + Math.sin(t * Math.PI) * 0.35);
        c.beginPath();
        c.moveTo(px(mx + (x1 - mx) * ease), py(my + (y1 - my) * ease));
        c.lineTo(px(mx + (x2 - mx) * ease), py(my + (y2 - my) * ease));
        c.stroke();
        if (l === s.game.last && !s.game.over) {
          c.strokeStyle = 'rgba(255,255,255,0.55)';
          c.lineWidth = Math.max(1.5, lw * 0.28);
          c.beginPath();
          c.moveTo(px(mx + (x1 - mx) * ease * 0.7), py(my + (y1 - my) * ease * 0.7));
          c.lineTo(px(mx + (x2 - mx) * ease * 0.7), py(my + (y2 - my) * ease * 0.7));
          c.stroke();
        }
      }
    }

    // dots on top
    const r = Math.max(4, g.cell * 0.075);
    c.fillStyle = '#f5f5f7';
    c.beginPath();
    for (let y = 0; y <= rows; y++)
      for (let x = 0; x <= cols; x++) {
        c.moveTo(px(x) + r, py(y));
        c.arc(px(x), py(y), r, 0, Math.PI * 2);
      }
    c.fill();

    if (s) {
      for (const p of s.sparks) {
        c.globalAlpha = Math.max(0, 1 - p.life / p.max);
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, 2 + 2 * (1 - p.life / p.max), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    c.restore();
  };

  useGameLoop(update, render);

  // score pills pop when a score goes up
  const s = m.current;
  const scores = s?.game.scores ?? [];
  const ups = scores.map((v, i) => v > (prevScores.current[i] ?? 0));
  useEffect(() => {
    prevScores.current = scores.slice();
  });

  let status = '';
  let dot = '';
  let thinking = false;
  if (!s) status = onlineLive ? 'Waiting for the host' : '';
  else if (!s.game.over) {
    const seat = s.seats[s.game.turn];
    dot = seat?.color ?? '';
    const again = s.streak > 0 && s.game.last >= 0;
    if (seat?.cpu) {
      status = `${seat.name} is thinking`;
      thinking = true;
    } else if (s.online ? seat?.seat === mySeat : mode === 'cpu') status = again ? 'Box! Go again' : 'Your turn';
    else status = again ? `${seat?.name} scores, go again` : `${seat?.name}'s turn`;
  }
  const tight = (s?.seats.length ?? 0) > 2 && size.w < 520;
  const side = !!s && sideLayout(size.w, size.h, s.game.rows, s.game.cols, s.seats.length);

  return (
    <div className="g-dots-boxes-stage">
      <canvas
        ref={ref}
        className="g-dots-boxes-canvas"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        aria-label="Dots and Boxes board"
      />
      {status && (
        <div className="g-dots-boxes-status" aria-live="polite">
          {dot && <span className={`g-dots-boxes-status-dot${thinking ? ' is-thinking' : ''}`} style={{ ['--c' as string]: dot }} aria-hidden="true" />}
          {status}
        </div>
      )}
      {s && (
        <div className={`g-dots-boxes-hud${tight ? ' is-tight' : ''}${side ? ' is-side' : ''}`}>
          {s.seats.map((seat, i) => (
            <div
              key={i}
              className={`g-dots-boxes-pill${!s.game.over && s.game.turn === i ? ' is-turn' : ''}${seat.left ? ' is-left' : ''}`}
              style={{ ['--c' as string]: seat.color }}
            >
              <span className="g-dots-boxes-swatch" aria-hidden="true" />
              <span className="g-dots-boxes-name">{s.online && seat.seat === mySeat ? 'You' : seat.left ? `${seat.name} (bot)` : seat.name}</span>
              <span key={s.game.scores[i]} className={`g-dots-boxes-score${ups[i] ? ' is-up' : ''}`}>
                {s.game.scores[i]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
