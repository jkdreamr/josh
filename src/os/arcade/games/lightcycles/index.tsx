import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelIndex, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import { formatTally } from '../../kit/tally.ts';
import type { GameProps } from '../../types';
import { alive, cell, createArena, riderSeats, roundOver, roundTally, steer, step, swipeDir, think, DX, DY, type Arena, type Dir, type Level } from './cycles.ts';
import { meta } from './meta';
import './lightcycles.css';

type Mode = '2p' | 1 | 2 | 3;
const MODE = defineSetting('lightcycles:mode', PLAY_MODES, 'cpu');
const RIVALS = defineSetting('lightcycles:rivals', ['1', '2', '3'] as const, '1');
const LEVEL = defineSetting('lightcycles:level', LEVEL_NAMES, 'normal');
const rivalOptions = [
  ['1', '1 Rival'],
  ['2', '2 Rivals'],
  ['3', '3 Rivals'],
] as const;
const modeOf = (mode: 'cpu' | '2p', rivals: '1' | '2' | '3'): Mode => (mode === '2p' ? '2p' : (Number(rivals) as 1 | 2 | 3));
const TARGET = 3;
const COLORS = ['#32d4ff', '#ff9f0a', '#bf5af2', '#30d158'];
const NAMES = ['Player 1', 'Player 2', 'Rider 3', 'Rider 4'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} formatScore={(n) => `${n} cells`} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Cycles />
    </GameShell>
  );
}

/** Online, the host picks how well the bots ride (the host's game drives them). */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  if (!online?.isHost || !online.bots.length) return null;
  return <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />;
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [rivals, setRivals] = useSetting(RIVALS);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string };
type Phase = 'ready' | 'run' | 'crash' | 'done';
type Match = {
  arena: Arena;
  cols: number;
  rows: number;
  wins: number[];
  round: number;
  phase: Phase;
  timer: number;
  acc: number;
  speed: number;
  queue: Dir[][];
  particles: Particle[];
  flash: number;
  shake: number;
  banner: string;
  sub: string;
  longest: number;
  lastWinner: number | null;
  /** Online: the seat riding each rider id, and which of those seats are bots. */
  seats: number[];
  bots: number[];
  /** Online: the room round this match was set up for. */
  onlineRound: number;
};

const grid = (w: number, h: number) => {
  const cols = w >= h ? 44 : 28;
  const rows = Math.max(16, Math.min(72, Math.round((cols * h) / w)));
  return { cols, rows };
};

function Cycles() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const [banner, setBanner] = useState<{ text: string; sub: string } | null>(null);
  const [playMode] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const cfg = useRef<{ mode: Mode; level: Level }>({ mode: modeOf(playMode, rivals), level: levelIndex(levelName) });
  const m = useRef<Match | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number; rider: number }>());
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const riderCount = (match: Match) => online ? Math.max(2, Math.min(4, match.seats.length)) : cfg.current.mode === '2p' ? 2 : cfg.current.mode + 1;
  const humans = (match: Match) => online ? riderCount(match) : cfg.current.mode === '2p' ? 2 : 1;
  /** The rider this player steers: online it follows their seat. */
  const mine = () => (online ? m.current?.seats.indexOf(online.seat) ?? -1 : 0);
  const nameOf = (match: Match, id: number) => {
    if (!online) return NAMES[id];
    const seat = match.seats[id];
    return online.players.find((p) => p.seat === seat)?.name ?? online.bots.find((b) => b.seat === seat)?.name ?? NAMES[id];
  };
  const tallyNames = (match: Match) => match.arena.riders.map((_, i) =>
    online ? nameOf(match, i) : cfg.current.mode === '2p' ? NAMES[i] : ['You', 'Orange', 'Purple', 'Green'][i],
  );
  /** Bots ride as computer riders on the host, which runs the arena for everyone. */
  const markBots = (match: Match) => {
    for (const r of match.arena.riders) r.cpu = match.bots.includes(match.seats[r.id]);
  };

  const startRound = (match: Match) => {
    const { w, h } = sizeRef.current;
    const g = grid(Math.max(1, w - 16), Math.max(1, h - 64));
    match.cols = g.cols;
    match.rows = g.rows;
    match.arena = createArena(g.cols, g.rows, riderCount(match), humans(match));
    if (online) markBots(match);
    match.queue = match.arena.riders.map(() => []);
    match.phase = 'ready';
    match.timer = 1.1;
    match.acc = 0;
    match.particles = [];
    match.flash = 0;
    match.banner = `Round ${match.round}`;
    match.sub = match.round === 1 ? (shell.touch ? 'Swipe to turn' : cfg.current.mode === '2p' ? 'WASD vs arrow keys' : 'WASD or arrow keys to turn') : '';
    setBanner({ text: match.banner, sub: match.sub });
    if (online?.seat === 0) online.send({ game: 'lightcycles', type: 'round', cols: g.cols, rows: g.rows, players: riderCount(match), seats: match.seats, bots: match.bots, wins: match.wins, round: match.round, speed: match.speed, longest: match.longest });
  };

  const reset = () => {
    const mode = online ? '2p' : modeOf(playMode, rivals);
    const level = levelIndex(levelName);
    cfg.current = { mode, level };
    const seats = online ? riderSeats(online.players.map((p) => p.seat), online.bots.map((b) => b.seat)) : [];
    const match: Match = {
      arena: createArena(2, 2, 0, 0),
      cols: 2,
      rows: 2,
      wins: new Array(online ? Math.max(2, seats.length) : mode === '2p' ? 2 : mode + 1).fill(0),
      round: 1,
      phase: 'ready',
      timer: 0,
      acc: 0,
      speed: (mode === '2p' ? 11 : [9, 11, 13][level]) as number,
      queue: [],
      particles: [],
      flash: 0,
      shake: 0,
      banner: '',
      sub: '',
      longest: 0,
      lastWinner: null,
      seats,
      bots: online ? online.bots.map((b) => b.seat).filter((seat) => seats.includes(seat)) : [],
      onlineRound: online?.round ?? 0,
    };
    m.current = match;
    startRound(match);
  };
  // A fresh match on mount, and again when setup or the room changes on the Start card. Online, the host sets the
  // match up again as the room starts, with the people and bots who are playing it, and guests follow its round packet.
  useEffect(() => {
    if (shell.status === 'ready' || !m.current || (online?.isHost && m.current.onlineRound !== online.round)) reset();
  }, [playMode, rivals, levelName, shell.status, online?.seat, online?.players.length, online?.bots.length, online?.round]);

  // Someone who leaves mid-match hands their rider to the computer, on the host that runs the arena, rather than
  // riding straight into the wall every round.
  useEffect(() => {
    const match = m.current;
    if (!online?.isHost || !match || match.onlineRound !== online.round) return;
    for (const seat of match.seats) {
      if (match.bots.includes(seat) || online.players.some((p) => p.seat === seat)) continue;
      match.bots.push(seat);
      const rider = match.arena.riders[match.seats.indexOf(seat)];
      if (rider) rider.cpu = true;
    }
  }, [online?.isHost, online?.players, online?.round]);

  const push = (rider: number, d: Dir) => {
    const match = m.current;
    if (!match || match.phase !== 'run') return;
    if (online) {
      if (rider < 0 || rider !== mine()) return;
      if (online.seat !== 0) {
        online.send({ game: 'lightcycles', type: 'turn', dir: d });
        return;
      }
    }
    const q = match.queue[rider];
    if (!q) return;
    if (q.length < 2 && q[q.length - 1] !== d) q.push(d);
  };

  useKeys((code) => {
    const twoP = cfg.current.mode === '2p';
    const wasd: Record<string, Dir> = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };
    const arrows: Record<string, Dir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    if (code in wasd) push(online ? mine() : 0, wasd[code]);
    else if (code in arrows) push(online ? mine() : twoP ? 1 : 0, arrows[code]);
  });

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const rider = online ? mine() : cfg.current.mode === '2p' && e.clientX - r.left > r.width / 2 ? 1 : 0;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, rider });
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const d = swipeDir(e.clientX - t.x, e.clientY - t.y, 22);
    if (d === null) return;
    push(t.rider, d);
    t.x = e.clientX;
    t.y = e.clientY;
  };
  const onPointerEnd = (e: RPointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
  };
  useEffect(() => () => touches.current.clear(), []);

  useEffect(() => online?.onMessage((from, data) => {
    if (!online || from === online.seat || !data || typeof data !== 'object') return;
    const message = data as {
      game?: unknown; type?: unknown; dir?: unknown; cols?: unknown; rows?: unknown; players?: unknown; seats?: unknown; bots?: unknown;
      wins?: unknown; round?: unknown; speed?: unknown; longest?: unknown; tick?: unknown; riders?: unknown;
      crashes?: unknown; phase?: unknown; timer?: unknown; acc?: unknown; banner?: unknown; sub?: unknown;
      lastWinner?: unknown;
    };
    if (message.game !== 'lightcycles') return;
    const match = m.current;
    if (!match) return;
    const id = match.seats.indexOf(from);
    if (online.seat === 0 && message.type === 'turn' && Number.isInteger(message.dir) && match.arena.riders[id] && !match.arena.riders[id].cpu) {
      const queue = match.queue[id];
      const direction = message.dir as Dir;
      if (queue && queue.length < 2 && queue[queue.length - 1] !== direction) queue.push(direction);
      return;
    }
    if (online.seat !== 0 && message.type === 'round' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && Number.isInteger(message.players)) {
      const seatList = (v: unknown) => (Array.isArray(v) ? v.filter((seat): seat is number => Number.isInteger(seat) && seat >= 0 && seat < 16) : null);
      match.cols = message.cols as number;
      match.rows = message.rows as number;
      // Hosts from before bots sent no seats: riders were seats 0, 1, 2 and so on.
      match.seats = seatList(message.seats) ?? Array.from({ length: message.players as number }, (_, i) => i);
      match.bots = seatList(message.bots) ?? [];
      match.arena = createArena(match.cols, match.rows, message.players as number, message.players as number);
      markBots(match);
      match.wins = Array.isArray(message.wins) ? message.wins as number[] : match.wins;
      match.round = Number(message.round) || match.round;
      match.speed = Number(message.speed) || match.speed;
      match.longest = Number(message.longest) || 0;
      match.queue = match.arena.riders.map(() => []);
      match.phase = 'ready';
      match.timer = 1.1;
      match.acc = 0;
      match.banner = `Round ${match.round}`;
      match.sub = match.round === 1 ? (shell.touch ? 'Swipe to turn' : 'WASD or arrow keys to turn') : '';
      setBanner({ text: match.banner, sub: match.sub });
      return;
    }
    if (online.seat !== 0 && message.type === 'tick' && Array.isArray(message.riders)) {
      const arena = match.arena;
      const riders = message.riders as { id: number; x: number; y: number; dir: Dir; next: Dir; alive: boolean }[];
      for (const snapshot of riders) {
        const rider = arena.riders[snapshot.id];
        if (!rider) continue;
        if (snapshot.x !== rider.x || snapshot.y !== rider.y) {
          const head = cell(arena, snapshot.x, snapshot.y);
          if (arena.cells[head] === 0) {
            arena.cells[head] = rider.id + 1;
            rider.trail.push(head);
          }
        }
        Object.assign(rider, snapshot);
      }
      arena.tick = Number(message.tick) || arena.tick;
      match.phase = message.phase === 'ready' || message.phase === 'run' || message.phase === 'crash' || message.phase === 'done' ? message.phase : match.phase;
      match.wins = Array.isArray(message.wins) ? message.wins as number[] : match.wins;
      match.round = Number(message.round) || match.round;
      match.timer = Number(message.timer) || 0;
      match.acc = Number(message.acc) || 0;
      match.longest = Number(message.longest) || match.longest;
      match.lastWinner = typeof message.lastWinner === 'number' ? message.lastWinner : null;
      if (typeof message.banner === 'string') {
        match.banner = message.banner;
        match.sub = typeof message.sub === 'string' ? message.sub : '';
        setBanner(match.banner ? { text: match.banner, sub: match.sub } : null);
      }
      const crashes = Array.isArray(message.crashes) ? message.crashes as { id: number; x: number; y: number }[] : [];
      for (const crash of crashes) {
        burst(match, crash.x + 0.5, crash.y + 0.5, COLORS[crash.id]);
        sfx.play('boom');
      }
    }
  }), [online?.onMessage, online?.seat, shell.touch]);

  const burst = (match: Match, cx: number, cy: number, color: string) => {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.6 + Math.random() * 2.2;
      match.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.5 + Math.random() * 0.5, color });
    }
    match.flash = 0.5;
    match.shake = 0.3;
  };

  const update = (dt: number) => {
    const match = m.current;
    if (!match) return;
    match.flash = Math.max(0, match.flash - dt * 2.4);
    match.shake = Math.max(0, match.shake - dt * 1.6);
    for (const p of match.particles) {
      p.life += dt;
      p.x += p.vx * dt * 14;
      p.y += p.vy * dt * 14;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    match.particles = match.particles.filter((p) => p.life < p.max);

    if (match.phase === 'ready') {
      match.timer -= dt;
      if (match.timer <= 0) {
        match.phase = 'run';
        match.banner = '';
        setBanner(null);
        sfx.play('select', 1.2);
      }
      return;
    }
    if (match.phase === 'crash') {
      match.timer -= dt;
      if (match.timer <= 0) {
        if (match.wins.some((w) => w >= TARGET)) {
          match.phase = 'done';
          const winner = match.wins.findIndex((w) => w >= TARGET);
          const cpuMode = cfg.current.mode !== '2p';
          const winnerSeat = match.seats[winner] ?? null;
          const title = online ? (winnerSeat === online.seat ? 'You Win' : `${nameOf(match, winner)} Wins`) : cpuMode ? (winner === 0 ? 'You Win' : 'Crashed Out') : `${NAMES[winner]} Wins`;
          const detail = `${formatTally(match.wins, { names: tallyNames(match), lead: winner })} in ${match.round} rounds. Longest ride: ${match.longest} cells.`;
          if (online) online.reportResult(online.round, winnerSeat);
          shell.gameOver(online ? undefined : cpuMode ? match.longest : undefined, { title, detail });
          return;
        }
        if (online && online.seat !== 0) {
          match.phase = 'ready';
          match.timer = 0;
          return;
        }
        match.round++;
        startRound(match);
      }
      return;
    }
    if (match.phase !== 'run') return;

    match.acc += dt;
    const period = 1 / (match.speed + (match.round - 1) * 0.6);
    if (online && online.seat !== 0) return;
    while (match.acc >= period && match.phase === 'run') {
      match.acc -= period;
      const a = match.arena;
      for (const r of a.riders) {
        if (!r.alive) continue;
        if (r.cpu) {
          if (Math.abs(r.x - a.w / 2) > a.w / 2 + 1) continue;
          steer(r, think(a, r, cfg.current.level));
        } else {
          const q = match.queue[r.id];
          while (q.length) {
            const d = q.shift()!;
            if (d !== r.dir && d !== ((r.dir + 2) % 4)) {
              steer(r, d);
              break;
            }
          }
        }
      }
      const crashes = step(a);
      for (const c of crashes) {
        burst(match, c.x + 0.5, c.y + 0.5, COLORS[c.id]);
        sfx.play('boom');
      }
      if (cfg.current.mode !== '2p') {
        const me = a.riders[0];
        shell.setScore(me.trail.length);
        match.longest = Math.max(match.longest, me.trail.length);
      } else {
        match.longest = Math.max(match.longest, ...a.riders.map((r) => r.trail.length));
      }
      if (roundOver(a)) {
        const left = alive(a);
        const winner = left.length === 1 ? left[0].id : null;
        match.lastWinner = winner;
        if (winner !== null) match.wins[winner]++;
        match.phase = 'crash';
        match.timer = 1.5;
        const twoP = cfg.current.mode === '2p';
        match.banner = winner === null ? 'Draw' : online ? `${nameOf(match, winner)} takes the round` : twoP || winner > 0 ? `${NAMES[winner]} takes the round` : 'You take the round';
        match.sub = roundTally(match.wins, tallyNames(match), winner ?? mine(), TARGET);
        setBanner({ text: match.banner, sub: match.sub });
        if (winner === 0 || (twoP && winner !== null)) sfx.play('coin');
      }
      if (online?.seat === 0) online.send({
        game: 'lightcycles', type: 'tick', tick: a.tick,
        riders: a.riders.map(({ id, x, y, dir, next, alive }) => ({ id, x, y, dir, next, alive })),
        crashes, phase: match.phase, round: match.round, wins: match.wins, timer: match.timer,
        acc: match.acc, speed: match.speed, longest: match.longest, banner: match.banner, sub: match.sub,
        lastWinner: match.lastWinner,
      });
    }
  };

  const render = () => {
    const c = ctx();
    const match = m.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const bg = c.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, Math.max(w, h));
    bg.addColorStop(0, '#0f1322');
    bg.addColorStop(1, '#05060b');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (!match) return;

    const a = match.arena;
    const cell = Math.min((w - 16) / a.w, (h - 64) / a.h);
    const ox = (w - cell * a.w) / 2 + (match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0);
    const oy = 44 + (h - 64 - cell * a.h) / 2 + (match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0);
    const px = (x: number) => ox + x * cell;
    const py = (y: number) => oy + y * cell;

    // Arena plate and grid
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.025)';
    c.fillRect(ox, oy, cell * a.w, cell * a.h);
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= a.w; x += 4) {
      c.moveTo(px(x) + 0.5, oy);
      c.lineTo(px(x) + 0.5, oy + cell * a.h);
    }
    for (let y = 0; y <= a.h; y += 4) {
      c.moveTo(ox, py(y) + 0.5);
      c.lineTo(ox + cell * a.w, py(y) + 0.5);
    }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1.5;
    c.strokeRect(ox, oy, cell * a.w, cell * a.h);
    c.restore();

    // Trails
    const period = 1 / (match.speed + (match.round - 1) * 0.6);
    const frac = match.phase === 'run' ? Math.min(1, match.acc / period) : 0;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const r of a.riders) {
      const color = COLORS[r.id];
      const pts = r.trail;
      c.globalAlpha = r.alive ? 1 : 0.38;
      const path = () => {
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = px((pts[i] % a.w) + 0.5);
          const y = py(Math.floor(pts[i] / a.w) + 0.5);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        if (r.alive && frac > 0) c.lineTo(px(r.x + 0.5 + DX[r.dir] * frac), py(r.y + 0.5 + DY[r.dir] * frac));
      };
      path();
      c.strokeStyle = color;
      c.globalAlpha *= 0.22;
      c.lineWidth = cell * 1.1;
      c.stroke();
      c.globalAlpha = r.alive ? 1 : 0.38;
      c.lineWidth = Math.max(1.5, cell * 0.42);
      c.strokeStyle = color;
      c.stroke();
      if (r.alive) {
        const hx = px(r.x + 0.5 + DX[r.dir] * frac);
        const hy = py(r.y + 0.5 + DY[r.dir] * frac);
        c.shadowColor = color;
        c.shadowBlur = cell * 1.2;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(hx, hy, Math.max(1.6, cell * 0.36), 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
      }
    }
    c.globalAlpha = 1;

    for (const p of match.particles) {
      const t = 1 - p.life / p.max;
      c.globalAlpha = t;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(px(p.x), py(p.y), Math.max(1, cell * 0.28 * t), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Round pips
    const n = a.riders.length;
    const pipR = 4;
    const groupW = TARGET * (pipR * 2 + 5) - 5;
    const gap = 18;
    const total = n * groupW + (n - 1) * gap;
    let x0 = w / 2 - total / 2;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < TARGET; k++) {
        const cx = x0 + k * (pipR * 2 + 5) + pipR;
        c.beginPath();
        c.arc(cx, 24, pipR, 0, Math.PI * 2);
        if (k < match.wins[i]) {
          c.fillStyle = COLORS[i];
          c.fill();
        } else {
          c.strokeStyle = COLORS[i];
          c.globalAlpha = 0.45;
          c.lineWidth = 1.5;
          c.stroke();
          c.globalAlpha = 1;
        }
      }
      x0 += groupW + gap;
    }

    if (match.flash > 0) {
      c.fillStyle = `rgba(255,255,255,${match.flash * 0.18})`;
      c.fillRect(0, 0, w, h);
    }
  };

  useGameLoop(update, render);

  return (
    <div className="g-lightcycles-stage">
      <canvas ref={ref} className="g-lightcycles-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} aria-label="Light cycle arena" />
      {cfg.current.mode === '2p' && shell.touch && <div className="g-lightcycles-split" aria-hidden="true" />}
      {banner && (
        <div className="g-lightcycles-banner" key={banner.text + m.current?.round} aria-live="polite">
          <strong>{banner.text}</strong>
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}
    </div>
  );
}
