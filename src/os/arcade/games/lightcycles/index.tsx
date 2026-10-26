import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelIndex, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { alive, cell, createArena, departedSeats, fitGrid, frameUnit, riderSeats, roundOver, steer, step, swipeDir, tapDir, think, DX, DY, type Arena, type Dir, type Level } from './cycles.ts';
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
/** Computer riders go by their color, so the banner says who took the round at a glance. */
const CPU_NAMES = ['You', 'Orange', 'Violet', 'Green'];
const READY = 1.8;
const BEAT = READY / 3;

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

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Ring = { x: number; y: number; t: number; color: string };
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
  rings: Ring[];
  /** Per rider: 1 at the moment it crashes, easing down as its wall dims. */
  fade: number[];
  /** No people left riding: the computer riders finish the round at triple speed. */
  ff: boolean;
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

/** Room above the arena for the shell's control pill, and below it for the round pips. */
const BOTTOM = 26;

function Cycles() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const [banner, setBanner] = useState<{ text: string; sub: string; count?: number; toast?: boolean } | null>(null);
  /** Online: who just left mid-match, shown apart from the round banners. */
  const [notice, setNotice] = useState<{ text: string; sub: string; id: number } | null>(null);
  /** Online: everyone seen in the room by seat, so a rider whose player left still goes by their name. */
  const known = useRef(new Map<number, string>());
  /** Online: seats already announced as left in this match. */
  const gone = useRef(new Set<number>());
  const [playMode] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const cfg = useRef<{ mode: Mode; level: Level }>({ mode: modeOf(playMode, rivals), level: levelIndex(levelName) });
  const m = useRef<Match | null>(null);
  const roomRound = useRef(0);
  roomRound.current = online?.round ?? 0;
  const touches = useRef(new Map<number, { x: number; y: number; sx: number; sy: number; rider: number; swiped: boolean }>());
  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** Where the arena was last drawn, for taps. */
  const view = useRef({ ox: 0, oy: 0, cell: 1 });
  /** 1 / the phone or iPad frame scale, so text and touch targets keep their size on screen. */
  const unit = useRef(1);
  /** Top of the arena: clear of the shell's control pill. */
  const [top, setTop] = useState(44);
  const topRef = useRef(top);
  topRef.current = top;

  useLayoutEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const u = shell.touch ? frameUnit(root.getBoundingClientRect().width, root.offsetWidth) : 1;
        unit.current = u;
        root.style.setProperty('--g-lightcycles-u', String(u));
        const pill = root.querySelector<HTMLElement>('.arcade-ctrl');
        const next = pill ? Math.max(36, Math.ceil(pill.offsetTop + pill.offsetHeight + 6)) : 10;
        setTop((t) => (t === next ? t : next));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const pill = root.querySelector('.arcade-ctrl');
    if (pill) ro.observe(pill);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [shell.touch, shell.status, shell.compact]);

  const riderCount = (match: Match) => online ? Math.max(2, Math.min(4, match.seats.length)) : cfg.current.mode === '2p' ? 2 : cfg.current.mode + 1;
  const humans = (match: Match) => online ? riderCount(match) : cfg.current.mode === '2p' ? 2 : 1;
  /** The rider this player steers: online it follows their seat. */
  const mine = () => (online ? m.current?.seats.indexOf(online.seat) ?? -1 : 0);
  const nameOf = (match: Match, id: number) => {
    if (!online) return cfg.current.mode === '2p' ? NAMES[id] : CPU_NAMES[id];
    const seat = match.seats[id];
    if (seat === online.seat) return 'You';
    return online.players.find((p) => p.seat === seat)?.name ?? online.bots.find((b) => b.seat === seat)?.name ?? known.current.get(seat) ?? NAMES[id];
  };
  const scoreLine = (match: Match) => match.wins.length === 2 ? match.wins.join(' to ') : match.wins.map((w, i) => `${nameOf(match, i)} ${w}`).join(', ');
  /** Who is in the room, people only: bots are named in the score line. */
  const roster = () => {
    if (!online) return '';
    const others = online.players.filter((p) => p.seat !== online.seat).map((p) => p.name);
    if (!others.length) return ' Just you here.';
    const list = others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`;
    return ` ${others.length + 1} people here: You and ${list}.`;
  };
  /** Bots ride as computer riders on the host, which runs the arena for everyone. */
  const markBots = (match: Match) => {
    for (const r of match.arena.riders) r.cpu = match.bots.includes(match.seats[r.id]);
  };
  const hint = () => (shell.touch ? 'Swipe or tap to turn' : !online && cfg.current.mode === '2p' ? 'WASD vs arrow keys' : 'Arrow keys, WASD or click to turn');

  const arenaBox = () => {
    const { w, h } = sizeRef.current;
    return { w: Math.max(1, w - 16), h: Math.max(1, h - topRef.current - BOTTOM) };
  };

  const startRound = (match: Match) => {
    const box = arenaBox();
    const g = fitGrid(box.w, box.h);
    match.cols = g.cols;
    match.rows = g.rows;
    match.arena = createArena(g.cols, g.rows, riderCount(match), humans(match));
    if (online) markBots(match);
    match.queue = match.arena.riders.map(() => []);
    match.phase = 'ready';
    match.timer = READY;
    match.acc = 0;
    match.particles = [];
    match.rings = [];
    match.fade = match.arena.riders.map(() => 0);
    match.ff = false;
    match.flash = 0;
    match.banner = `Round ${match.round}`;
    match.sub = match.round === 1 ? hint() : scoreLine(match);
    setBanner({ text: match.banner, sub: match.sub, count: 3 });
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
      rings: [],
      fade: [],
      ff: false,
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
    gone.current.clear();
    setNotice(null);
    startRound(match);
  };
  // A fresh match on mount, and again when setup or the room changes on the Start card. Online, the host sets the
  // match up again as the room starts, with the people and bots who are playing it, and guests follow its round packet.
  useEffect(() => {
    if (shell.status === 'ready' || !m.current || (online?.isHost && m.current.onlineRound !== online.round)) reset();
  }, [playMode, rivals, levelName, shell.status, online?.seat, online?.players.length, online?.bots.length, online?.round]);

  // The canvas has no size on the first render, and windows get resized: before anyone has moved,
  // lay the round out again so the arena fits the space it really has.
  useEffect(() => {
    const match = m.current;
    if (!match || match.phase !== 'ready' || match.arena.tick > 0 || (online && online.seat !== 0)) return;
    const box = arenaBox();
    const g = fitGrid(box.w, box.h);
    if (g.cols === match.cols && g.rows === match.rows) return;
    const timer = match.timer;
    startRound(match);
    if (shell.status === 'playing') match.timer = Math.max(timer, BEAT);
  }, [size.w, size.h, top]);

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

  // Online: say when someone leaves mid-match. Every client spots it from the room, while the round rides on with a
  // bot in their seat. The host leaving ends the round in the shell, which says so itself.
  useEffect(() => {
    if (!online) return;
    for (const p of online.players) known.current.set(p.seat, p.name);
    const match = m.current;
    if (!match || match.onlineRound !== online.round || (shell.status !== 'playing' && shell.status !== 'paused')) return;
    const left = departedSeats(match.seats, online.seat, known.current, gone.current, online.players.map((p) => p.seat), online.bots.map((b) => b.seat));
    if (!left.length) return;
    for (const seat of left) gone.current.add(seat);
    const names = left.map((seat) => known.current.get(seat) as string);
    setNotice({ text: `${names.join(' and ')} Left`, sub: left.length > 1 ? 'Bots take over their riders.' : 'A bot takes over their rider.', id: performance.now() });
  }, [online?.players, online?.round, shell.status]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const push = (rider: number, d: Dir) => {
    const match = m.current;
    if (!match || match.phase !== 'run') return;
    const r = match.arena.riders[rider];
    if (online) {
      if (rider < 0 || rider !== mine()) return;
      if (online.seat !== 0) {
        if (r?.alive) sfx.play('tick', 0.8);
        online.send({ game: 'lightcycles', type: 'turn', dir: d });
        return;
      }
    }
    const q = match.queue[rider];
    if (!q || !r?.alive) return;
    const last = q.length ? q[q.length - 1] : r.next;
    if (q.length < 2 && last !== d && d !== ((last + 2) % 4)) {
      q.push(d);
      sfx.play('tick', 0.8);
    }
  };

  useKeys((code) => {
    const twoP = cfg.current.mode === '2p';
    const wasd: Record<string, Dir> = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };
    const arrows: Record<string, Dir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    if (code in wasd) push(online ? mine() : 0, wasd[code]);
    else if (code in arrows) push(online ? mine() : twoP ? 1 : 0, arrows[code]);
  });

  const riderAt = (e: RPointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    // offsetX stays in canvas px on the laptop's projected screen, where client coordinates do not.
    return online ? mine() : cfg.current.mode === '2p' && e.nativeEvent.offsetX > el.clientWidth / 2 ? 1 : 0;
  };
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rider: riderAt(e), swiped: false });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const d = swipeDir(e.clientX - t.x, e.clientY - t.y, 22);
    if (d === null) return;
    push(t.rider, d);
    t.swiped = true;
    t.x = e.clientX;
    t.y = e.clientY;
  };
  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    touches.current.delete(e.pointerId);
    const match = m.current;
    if (!t || t.swiped || !match || Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 22) return;
    // A tap: turn toward it, relative to where the rider is heading after any turns already queued.
    const r = match.arena.riders[t.rider];
    if (!r?.alive) return;
    const q = match.queue[t.rider];
    const heading = (q?.length ? q[q.length - 1] : r.next) as Dir;
    const { ox, oy, cell: size } = view.current;
    const d = tapDir(heading, e.nativeEvent.offsetX - (ox + (r.x + 0.5) * size), e.nativeEvent.offsetY - (oy + (r.y + 0.5) * size), size * 0.5);
    if (d !== null) push(t.rider, d);
  };
  const onPointerCancel = (e: RPointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
  };
  useEffect(() => () => touches.current.clear(), []);

  useEffect(() => online?.onMessage((from, data) => {
    if (!online || from === online.seat || !data || typeof data !== 'object') return;
    const message = data as {
      game?: unknown; type?: unknown; dir?: unknown; cols?: unknown; rows?: unknown; players?: unknown; seats?: unknown; bots?: unknown;
      wins?: unknown; round?: unknown; speed?: unknown; longest?: unknown; tick?: unknown; riders?: unknown;
      crashes?: unknown; phase?: unknown; timer?: unknown; acc?: unknown; banner?: unknown; sub?: unknown;
      lastWinner?: unknown; ff?: unknown;
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
      // Guests never set the match up again as the room starts: the host's first round packet makes it this round's.
      match.onlineRound = roomRound.current;
      match.arena = createArena(match.cols, match.rows, message.players as number, message.players as number);
      markBots(match);
      match.wins = Array.isArray(message.wins) ? message.wins as number[] : match.wins;
      match.round = Number(message.round) || match.round;
      match.speed = Number(message.speed) || match.speed;
      match.longest = Number(message.longest) || 0;
      match.queue = match.arena.riders.map(() => []);
      match.phase = 'ready';
      match.timer = READY;
      match.acc = 0;
      match.particles = [];
      match.rings = [];
      match.fade = match.arena.riders.map(() => 0);
      match.ff = false;
      match.banner = `Round ${match.round}`;
      match.sub = match.round === 1 ? hint() : scoreLine(match);
      setBanner({ text: match.banner, sub: match.sub, count: 3 });
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
      match.ff = message.ff === true;
      if (typeof message.banner === 'string') {
        match.banner = message.banner;
        match.sub = typeof message.sub === 'string' ? message.sub : '';
        setBanner(match.banner ? { text: match.banner, sub: match.sub } : null);
      }
      const crashes = Array.isArray(message.crashes) ? message.crashes as { id: number; x: number; y: number }[] : [];
      for (const crash of crashes) crashed(match, crash.id, crash.x, crash.y);
      sparks(match);
    }
  }), [online?.onMessage, online?.seat, shell.touch]);

  const crashed = (match: Match, id: number, x: number, y: number) => {
    const color = COLORS[id] ?? '#fff';
    const cx = x + 0.5;
    const cy = y + 0.5;
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.6 + Math.random() * 2.6;
      match.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.45 + Math.random() * 0.6, color: i % 4 ? color : '#ffffff', size: 0.22 + Math.random() * 0.16 });
    }
    match.rings.push({ x: cx, y: cy, t: 0, color });
    match.fade[id] = 1;
    match.flash = 0.35;
    match.shake = Math.max(match.shake, 0.28);
    sfx.play('boom');
  };

  /** Riding right alongside a wall throws sparks off it. */
  const sparks = (match: Match) => {
    const a = match.arena;
    for (const r of a.riders) {
      if (!r.alive) continue;
      for (const side of [1, 3]) {
        const d = (r.dir + side) % 4;
        const x = r.x + DX[d];
        const y = r.y + DY[d];
        if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
        const owner = a.cells[y * a.w + x];
        if (!owner || owner === r.id + 1) continue;
        for (let i = 0; i < 3; i++) {
          match.particles.push({
            x: r.x + 0.5 + DX[d] * 0.5, y: r.y + 0.5 + DY[d] * 0.5,
            vx: -DX[r.dir] * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8, vy: -DY[r.dir] * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8,
            life: 0, max: 0.18 + Math.random() * 0.22, color: Math.random() < 0.5 ? '#ffffff' : COLORS[owner - 1], size: 0.1 + Math.random() * 0.08,
          });
        }
      }
    }
  };

  const periodOf = (match: Match) => 1 / ((match.speed + (match.round - 1) * 0.6) * (match.ff ? 3 : 1));

  const update = (dt: number) => {
    const match = m.current;
    if (!match) return;
    match.flash = Math.max(0, match.flash - dt * 2.4);
    match.shake = Math.max(0, match.shake - dt * 1.6);
    for (let i = 0; i < match.fade.length; i++) match.fade[i] = Math.max(0, match.fade[i] - dt * 1.4);
    for (const p of match.particles) {
      p.life += dt;
      p.x += p.vx * dt * 14;
      p.y += p.vy * dt * 14;
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
    match.particles = match.particles.filter((p) => p.life < p.max);
    for (const ring of match.rings) ring.t += dt;
    match.rings = match.rings.filter((ring) => ring.t < 0.7);

    if (match.phase === 'ready') {
      const before = Math.ceil(match.timer / BEAT);
      match.timer -= dt;
      const count = Math.ceil(match.timer / BEAT);
      if (match.timer <= 0) {
        match.phase = 'run';
        match.banner = '';
        setBanner(null);
        sfx.play('select', 1.2);
      } else if (count !== before) {
        setBanner({ text: match.banner, sub: match.sub, count });
        sfx.play('blip', 1);
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
          const title = online ? (winnerSeat === online.seat ? 'You Win' : `${nameOf(match, winner)} Wins`) : cpuMode ? (winner === 0 ? 'You Win' : `${CPU_NAMES[winner]} Wins`) : `${NAMES[winner]} Wins`;
          const detail = `${scoreLine(match)} after ${match.round} rounds. Longest ride: ${match.longest} cells.${roster()}`;
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
    if (online && online.seat !== 0) return;
    while (match.acc >= periodOf(match) && match.phase === 'run') {
      match.acc -= periodOf(match);
      const a = match.arena;
      for (const r of a.riders) {
        if (!r.alive) continue;
        if (r.cpu) steer(r, think(a, r, cfg.current.level));
        else {
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
      for (const c of crashes) crashed(match, c.id, c.x, c.y);
      sparks(match);
      if (cfg.current.mode !== '2p') {
        const me = a.riders[0];
        shell.setScore(me.trail.length);
        match.longest = Math.max(match.longest, me.trail.length);
      } else {
        match.longest = Math.max(match.longest, ...a.riders.map((r) => r.trail.length));
      }
      let note = false;
      if (roundOver(a)) {
        const left = alive(a);
        const winner = left.length === 1 ? left[0].id : null;
        match.lastWinner = winner;
        if (winner !== null) match.wins[winner]++;
        match.phase = 'crash';
        match.timer = 1.6;
        match.ff = false;
        const name = winner === null ? '' : nameOf(match, winner);
        match.banner = winner === null ? 'Draw' : name === 'You' ? 'You take the round' : `${name} takes the round`;
        match.sub = match.wins.some((w) => w >= TARGET) ? '' : scoreLine(match);
        setBanner({ text: match.banner, sub: match.sub });
        note = true;
        const mineWon = winner !== null && (online ? match.seats[winner] === online.seat : winner === 0 || cfg.current.mode === '2p');
        sfx.play(mineWon ? 'coin' : winner === null ? 'hit' : 'lose');
      } else if (!match.ff && !a.riders.some((r) => r.alive && !r.cpu)) {
        // Everyone left riding is a computer: let them finish it quickly.
        match.ff = true;
        match.banner = 'Fast Forward';
        match.sub = '';
        setBanner({ text: match.banner, sub: '', toast: true });
        note = true;
      }
      if (online?.seat === 0) online.send({
        game: 'lightcycles', type: 'tick', tick: a.tick,
        riders: a.riders.map(({ id, x, y, dir, next, alive }) => ({ id, x, y, dir, next, alive })),
        crashes, phase: match.phase, round: match.round, wins: match.wins, timer: match.timer,
        acc: match.acc, speed: match.speed, longest: match.longest, lastWinner: match.lastWinner, ff: match.ff,
        ...(note ? { banner: match.banner, sub: match.sub } : {}),
      });
    }
  };

  const render = () => {
    const c = ctx();
    const match = m.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    const bg = c.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h));
    bg.addColorStop(0, '#101629');
    bg.addColorStop(1, '#04050a');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    if (!match) return;

    const a = match.arena;
    const box = arenaBox();
    const top = topRef.current;
    const cell = Math.min(box.w / a.w, box.h / a.h);
    const shakeX = match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0;
    const shakeY = match.shake ? (Math.random() - 0.5) * match.shake * 10 : 0;
    const ox = Math.round((w - cell * a.w) / 2) + shakeX;
    const oy = Math.round(top + (box.h - cell * a.h) / 2) + shakeY;
    view.current = { ox: ox - shakeX, oy: oy - shakeY, cell };
    const px = (x: number) => ox + x * cell;
    const py = (y: number) => oy + y * cell;
    const aw = cell * a.w;
    const ah = cell * a.h;

    // Arena floor: a faint glow from the middle, a fine grid every cell when there is room, bolder every 4.
    c.save();
    const floor = c.createRadialGradient(ox + aw / 2, oy + ah / 2, 0, ox + aw / 2, oy + ah / 2, Math.max(aw, ah) * 0.7);
    floor.addColorStop(0, 'rgba(50,212,255,0.07)');
    floor.addColorStop(1, 'rgba(50,212,255,0.015)');
    c.fillStyle = floor;
    c.fillRect(ox, oy, aw, ah);
    c.lineWidth = 1;
    if (cell >= 9) {
      c.strokeStyle = 'rgba(140,200,255,0.035)';
      c.beginPath();
      for (let x = 1; x < a.w; x++) if (x % 4) (c.moveTo(Math.round(px(x)) + 0.5, oy), c.lineTo(Math.round(px(x)) + 0.5, oy + ah));
      for (let y = 1; y < a.h; y++) if (y % 4) (c.moveTo(ox, Math.round(py(y)) + 0.5), c.lineTo(ox + aw, Math.round(py(y)) + 0.5));
      c.stroke();
    }
    c.strokeStyle = 'rgba(140,200,255,0.09)';
    c.beginPath();
    for (let x = 4; x < a.w; x += 4) (c.moveTo(Math.round(px(x)) + 0.5, oy), c.lineTo(Math.round(px(x)) + 0.5, oy + ah));
    for (let y = 4; y < a.h; y += 4) (c.moveTo(ox, Math.round(py(y)) + 0.5), c.lineTo(ox + aw, Math.round(py(y)) + 0.5));
    c.stroke();
    c.shadowColor = 'rgba(50,212,255,0.6)';
    c.shadowBlur = 10;
    c.strokeStyle = 'rgba(120,220,255,0.55)';
    c.lineWidth = 1.5;
    c.strokeRect(ox - 0.75, oy - 0.75, aw + 1.5, ah + 1.5);
    c.restore();

    // Trails: a soft glow, a solid wall and a bright core, like a lit tube.
    const frac = match.phase === 'run' ? Math.min(1, match.acc / periodOf(match)) : 0;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const r of a.riders) {
      const color = COLORS[r.id];
      const pts = r.trail;
      const fade = match.fade[r.id] ?? 0;
      const base = r.alive ? 1 : 0.3 + 0.7 * fade;
      const hx = px(r.x + 0.5 + DX[r.dir] * frac);
      const hy = py(r.y + 0.5 + DY[r.dir] * frac);
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = px((pts[i] % a.w) + 0.5);
        const y = py(Math.floor(pts[i] / a.w) + 0.5);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      if (r.alive && frac > 0) c.lineTo(hx, hy);
      c.strokeStyle = color;
      c.globalAlpha = base * 0.2;
      c.lineWidth = cell * 1.25;
      c.stroke();
      c.globalAlpha = base;
      c.lineWidth = Math.max(1.5, cell * 0.46);
      c.stroke();
      if (r.alive || fade > 0) {
        c.strokeStyle = '#ffffff';
        c.globalAlpha = (r.alive ? 0.55 : fade * 0.55);
        c.lineWidth = Math.max(0.75, cell * 0.14);
        c.stroke();
      }
      c.globalAlpha = 1;
      if (r.alive) drawCycle(c, hx, hy, r.dir, cell, color);
    }

    // Who is who, while the countdown runs.
    if (match.phase === 'ready' && match.arena.tick === 0) {
      const u = unit.current;
      const me = mine();
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      c.font = `600 ${Math.round(14 * u)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const r of a.riders) {
        const x = px(r.x + 0.5);
        const y = py(r.y + 0.5);
        const label = !online && cfg.current.mode === '2p' ? NAMES[r.id] : nameOf(match, r.id);
        if (r.id === me) {
          c.strokeStyle = COLORS[r.id];
          c.globalAlpha = 0.35 + 0.5 * pulse;
          c.lineWidth = 2;
          c.beginPath();
          c.arc(x, y, Math.max(10, cell * 1.6) + pulse * 4, 0, Math.PI * 2);
          c.stroke();
          c.globalAlpha = 1;
        }
        const ly = y - Math.max(16, cell * 1.6) - 10 * u;
        const tw = c.measureText(label).width + 14 * u;
        const th = 22 * u;
        const lx = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, x));
        const ty = Math.max(top + th / 2, ly);
        c.fillStyle = 'rgba(8,10,18,0.78)';
        c.beginPath();
        c.roundRect(lx - tw / 2, ty - th / 2, tw, th, th / 2);
        c.fill();
        c.fillStyle = COLORS[r.id];
        c.fillText(label, lx, ty + 0.5);
      }
    }

    for (const ring of match.rings) {
      const t = ring.t / 0.7;
      c.globalAlpha = (1 - t) * 0.9;
      c.strokeStyle = ring.color;
      c.lineWidth = Math.max(1, cell * 0.35 * (1 - t));
      c.beginPath();
      c.arc(px(ring.x), py(ring.y), cell * (0.6 + t * 7), 0, Math.PI * 2);
      c.stroke();
    }
    for (const p of match.particles) {
      const t = 1 - p.life / p.max;
      c.globalAlpha = t;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(px(p.x), py(p.y), Math.max(0.8, cell * p.size * (0.4 + 0.6 * t)), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Round pips, under the arena: one group per rider, filled for each round won.
    const n = a.riders.length;
    const pipR = 4;
    const groupW = TARGET * (pipR * 2 + 5) - 5;
    const gap = 18;
    const total = n * groupW + (n - 1) * gap;
    let x0 = w / 2 - total / 2;
    const pipY = Math.min(h - BOTTOM / 2, oy - shakeY + ah + BOTTOM / 2);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < TARGET; k++) {
        const cx = x0 + k * (pipR * 2 + 5) + pipR;
        c.beginPath();
        c.arc(cx, pipY, pipR, 0, Math.PI * 2);
        if (k < match.wins[i]) {
          c.fillStyle = COLORS[i];
          c.shadowColor = COLORS[i];
          c.shadowBlur = 6;
          c.fill();
          c.shadowBlur = 0;
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
      c.fillStyle = `rgba(255,255,255,${match.flash * 0.14})`;
      c.fillRect(0, 0, w, h);
    }
  };

  useGameLoop(update, render);

  return (
    <div className={`g-lightcycles-stage${size.h && size.h < 300 ? ' is-short' : ''}`}>
      <canvas ref={ref} className="g-lightcycles-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} aria-label="Light cycle arena" />
      {cfg.current.mode === '2p' && !online && shell.touch && <div className="g-lightcycles-split" style={{ top }} aria-hidden="true" />}
      {banner && (
        <div className={`g-lightcycles-banner${banner.toast ? ' is-toast' : ''}`} key={banner.text + m.current?.round} aria-live="polite">
          <strong>{banner.text}</strong>
          {banner.count != null && <b key={banner.count}>{banner.count}</b>}
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}
      {notice && (
        <div className="g-lightcycles-banner is-toast is-notice" key={notice.id} style={{ top: top + 8 }} role="status">
          <strong>{notice.text}</strong>
          <span>{notice.sub}</span>
        </div>
      )}
    </div>
  );
}

/** A light cycle seen from above: a long rounded body in the rider's color with a white canopy, pointing its way. */
function drawCycle(c: CanvasRenderingContext2D, x: number, y: number, dir: Dir, cell: number, color: string) {
  const len = Math.max(7, cell * 1.7);
  const wid = Math.max(3.5, cell * 0.78);
  c.save();
  c.translate(x, y);
  c.rotate((dir - 1) * (Math.PI / 2));
  c.shadowColor = color;
  c.shadowBlur = Math.max(6, cell * 1.4);
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(-len * 0.62, -wid / 2, len, wid, wid / 2);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.beginPath();
  c.roundRect(-len * 0.2, -wid * 0.24, len * 0.5, wid * 0.48, wid * 0.24);
  c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(len * 0.3, 0, wid * 0.22, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
