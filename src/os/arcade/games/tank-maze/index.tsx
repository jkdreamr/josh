import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelIndex, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createWorld, fitBoard, keyHeading, mulberry32, noInput, spawnRound, stickInput, step, toCanvas, touchLayout, traceShot, type Special, type Tank, type TankInput, type World } from './logic.ts';
import { makeMemory, think, type BotMemory } from './bots.ts';
import { endPacket, inputPacket, parsePacket, roundPacket, seatNames, statePacket, type NetEvent, type RoundPacket } from './net.ts';
import { finalLine, freeSpans, packChips, rosterLine, type Span } from './hud.ts';
import { meta } from './meta';
import './tank-maze.css';

type Mode = 'cpu' | '2p' | '3p';
const MODE = defineSetting<Mode>('tank-maze:mode', ['cpu', '2p', '3p'], 'cpu');
const RIVALS = defineSetting('tank-maze:rivals', ['1', '2', '3'] as const, '2');
const LEVEL = defineSetting('tank-maze:level', LEVEL_NAMES, 'normal');
const TARGET = defineSetting('tank-maze:target', ['3', '5', '10'] as const, '5');
const targetOptions = [
  ['3', '3'],
  ['5', '5'],
  ['10', '10'],
] as const;
const rivalOptions = [
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
] as const;

const COLORS = ['#e0533d', '#3d9b57', '#3d7be0', '#d4a017'];
const NAMES = ['Red', 'Green', 'Blue', 'Gold'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} defaultBots={1}>
      <TankMaze />
    </GameShell>
  );
}

function Setup() {
  const shell = useShell();
  const [mode, setMode] = useSetting(MODE);
  const [rivals, setRivals] = useSetting(RIVALS);
  const [level, setLevel] = useSetting(LEVEL);
  const [target, setTarget] = useSetting(TARGET);
  const modes = (shell.touch ? ([['cpu', 'vs Computer'], ['2p', '2 Players']] as const) : ([['cpu', 'vs Computer'], ['2p', '2 Players'], ['3p', '3 Players']] as const)) as readonly (readonly [Mode, string])[];
  const shown = shell.touch && mode === '3p' ? '2p' : mode;
  return (
    <>
      <Segmented label="Mode" value={shown} options={modes} onChange={setMode} />
      {shown === 'cpu' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
      {shown === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
      <Segmented label="First To" value={target} options={targetOptions} onChange={setTarget} />
    </>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [target, setTarget] = useSetting(TARGET);
  const [level, setLevel] = useSetting(LEVEL);
  if (!online?.isHost) return null;
  return (
    <>
      <Segmented label="First To" value={target} options={targetOptions} onChange={setTarget} />
      {online.bots.length > 0 && <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; smoke?: boolean };
type Scorch = { x: number; y: number; life: number };
type Mark = { x: number; y: number; a: number; life: number };
type Stick = { id: number; ox: number; oy: number; x: number; y: number; player: number };

type Snapshot = { at: number; tanks: { x: number; y: number; a: number; alive: boolean; moving: boolean; special: Special | null }[]; shells: { x: number; y: number; owner: number }[] };

type Match = {
  world: World;
  seats: number[];
  bots: number[];
  departed: Set<number>;
  minds: (BotMemory | null)[];
  rngs: (() => number)[];
  names: string[];
  acc: number;
  onlineRound: number;
  level: 0 | 1 | 2;
  particles: Particle[];
  scorches: Scorch[];
  marks: Mark[];
  shake: number;
  flash: number;
  evId: number;
  pending: NetEvent[];
  reported: boolean;
  ended: boolean;
  /** Guest side: interpolation between the last two snapshots. */
  snaps: Snapshot[];
  lastStateAt: number;
  guestScores: number[];
  guestPhase: 'ready' | 'play' | 'settle';
  guestPhaseT: number;
  guestBeams: { owner: number; pts: number[]; t: number }[];
  guestMines: { x: number; y: number; armed: boolean }[];
  guestPickups: { kind: Special; x: number; y: number }[];
  lastEvSeen: number;
  prevPhase: string;
  lastNetAt: number;
  /** Local match built before the canvas had a real size; rebuild round 1 once it does. */
  fixDims: boolean;
};

const STEP = 1 / 60;

function TankMaze() {
  const shell = useShell();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas();
  const [banner, setBanner] = useState<{ text: string; sub: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; sub: string; id: number } | null>(null);
  /** Online: the name of everyone seen in the room by seat, so a seat whose player left still reads as them. */
  const known = useRef(new Map<number, string>());
  const prevPlayers = useRef<number[]>([]);
  /** The Game Over card this game put up (null when the shell's own card is up), redrawn when someone leaves. */
  const lastEnd = useRef<{ title: string; scores: number[]; rounds: number } | null>(null);
  /** On-screen scale of the canvas (framed iPads draw it at ~0.82) and the shell pills that sit over the HUD row. */
  const view = useRef<{ at: number; u: number; badge: Span | null; ctrlX: number | null }>({ at: -1e9, u: 1, badge: null, ctrlX: null });
  const [mode] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const [targetName] = useSetting(TARGET);
  const m = useRef<Match | null>(null);
  const sticks = useRef(new Map<number, Stick>());
  const fireQueued = useRef<boolean[]>([false, false, false, false]);
  const fireHeld = useRef<boolean[]>([false, false, false, false]);
  const guestFireCount = useRef(0);
  const guestLastSent = useRef<{ turn: number; move: number; dir: number | undefined; t: number }>({ turn: 0, move: 0, dir: undefined, t: 0 });
  const hostIn = useRef(new Map<number, { turn: -1 | 0 | 1; move: -1 | 0 | 1; dir: number | undefined; fc: number; lastFc: number }>());
  const bounceTick = useRef(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const cfg = useRef({ mode: 'cpu' as Mode, rivals: 2, level: 1 as 0 | 1 | 2, target: 5 });

  const touch = shell.touch;
  const effMode: Mode = !online && touch && mode === '3p' ? '2p' : mode;

  const isGuest = !!online && !online.isHost;
  const mine = () => (online && m.current ? m.current.seats.indexOf(online.seat) : 0);
  const humanIds = (match: Match): number[] => {
    if (online) {
      const i = match.seats.indexOf(online.seat);
      return i >= 0 ? [i] : [];
    }
    if (cfg.current.mode === '3p') return [0, 1, 2];
    if (cfg.current.mode === '2p') return [0, 1];
    return [0];
  };

  /** Maze/board layout: the board rect plus the touch zone each human gets. */
  const layout = (w: number, h: number) => touchLayout(w, h, online ? 1 : effMode === '3p' ? 3 : effMode === '2p' ? 2 : 1, touch);

  const mazeSize = (board: { w: number; h: number }) => {
    if (board.w >= board.h) {
      const rows = 6;
      return { rows, cols: Math.max(7, Math.min(12, Math.round((6 * board.w) / board.h))) };
    }
    const cols = 6;
    return { cols, rows: Math.max(7, Math.min(11, Math.round((6 * board.h) / board.w))) };
  };

  const nameOf = (match: Match, id: number) => {
    if (!online) return NAMES[id];
    const seat = match.seats[id];
    const gone = !online.players.some((pl) => pl.seat === seat) && !online.bots.some((b) => b.seat === seat);
    if (gone && known.current.has(seat)) return `${known.current.get(seat)} (Left)`;
    const name = seatNames(match.seats, online.players, online.bots)[id] ?? `Seat ${seat}`;
    return match.departed.has(seat) && online.players.some((pl) => pl.seat === seat) ? `${name} (Bot)` : name;
  };

  const applyEvents = (match: Match, events: NetEvent[]) => {
    for (const e of events) {
      if (e.k === 'fire') {
        const t = match.world.tanks[e.a];
        if (t) muzzle(match, t);
        sfx.tone({ freq: 240, to: 90, dur: 0.07, type: 'square', vol: 0.25 });
      } else if (e.k === 'bounce') {
        spark(match, e.x, e.y);
        if (match.world.time - bounceTick.current > 0.06) {
          bounceTick.current = match.world.time;
          sfx.play('tick', 1.6);
        }
      } else if (e.k === 'kill') {
        explode(match, e.x, e.y, COLORS[e.a] ?? '#333');
        sfx.play('boom');
      } else if (e.k === 'boom') {
        explode(match, e.x, e.y, '#555');
        sfx.play('boom');
      } else if (e.k === 'pickup') {
        sfx.play('coin');
      } else if (e.k === 'mine') {
        sfx.play('tick');
      } else if (e.k === 'laser') {
        sfx.tone({ freq: 880, to: 220, dur: 0.18, type: 'sawtooth', vol: 0.2 });
      }
    }
  };

  const newMatch = (cols: number, rows: number, count: number, seed: number, target: number): Match => {
    const world = createWorld({ cols, rows, seed, count, target });
    const match: Match = {
      world,
      seats: [],
      bots: [],
      departed: new Set(),
      minds: world.tanks.map(() => null),
      rngs: world.tanks.map((_, i) => mulberry32(seed ^ (i + 1) * 7919)),
      names: [],
      acc: 0,
      onlineRound: online?.round ?? 0,
      level: cfg.current.level,
      particles: [],
      scorches: [],
      marks: [],
      shake: 0,
      flash: 0,
      evId: 1,
      pending: [],
      reported: false,
      ended: false,
      snaps: [],
      lastStateAt: performance.now(),
      guestScores: new Array(count).fill(0),
      guestPhase: 'ready',
      guestPhaseT: 1.2,
      guestBeams: [],
      guestMines: [],
      guestPickups: [],
      lastEvSeen: 0,
      prevPhase: 'ready',
      lastNetAt: 0,
      fixDims: false,
    };
    return match;
  };

  const startBanner = (match: Match) => {
    setBanner({
      text: `Round ${match.world.round}`,
      sub: match.world.round === 1 ? `first to ${match.world.target}` : '',
    });
  };

  const hostSendRound = (match: Match) => {
    if (!online || online.seat !== 0) return;
    online.send(
      roundPacket({
        roomRound: online.round,
        round: match.world.round,
        seed: match.world.seed,
        cols: match.world.maze.cols,
        rows: match.world.maze.rows,
        seats: match.seats,
        bots: match.bots,
        scores: match.world.scores,
        target: match.world.target,
        level: match.level,
        spawns: match.world.tanks.map((t) => ({ x: t.x, y: t.y, a: t.a })),
      }),
    );
  };

  const reset = () => {
    cfg.current = { mode: effMode, rivals: Number(rivals) as 1 | 2 | 3, level: levelIndex(levelName), target: Number(targetName) };
    const { w, h } = sizeRef.current;
    const lay = layout(w || 800, h || 500);
    let match: Match;
    const prev = m.current;
    lastEnd.current = null;
    if (online) {
      // Someone who left between matches keeps their seat, driven by a bot and labeled as having left.
      const carried =
        !isGuest && prev?.ended
          ? prev.seats.filter((s) => known.current.has(s) && !online.players.some((p) => p.seat === s) && !online.bots.some((b) => b.seat === s))
          : [];
      const seats = [...new Set([...online.players.map((p) => p.seat), ...online.bots.map((b) => b.seat), ...carried])].sort((a, b) => a - b).slice(0, 4);
      const bots = online.bots.map((b) => b.seat).filter((s) => seats.includes(s));
      if (isGuest) {
        // Guests wait for the host's round packet; build a placeholder world meanwhile.
        match = newMatch(10, 6, Math.max(2, seats.length), 1, cfg.current.target);
      } else {
        match = newMatch(10, 6, Math.max(2, seats.length), (Math.random() * 2 ** 31) >>> 0, cfg.current.target);
      }
      match.seats = seats;
      match.bots = bots;
      for (const s of carried) if (seats.includes(s)) match.departed.add(s);
      match.level = cfg.current.level;
      for (let i = 0; i < match.world.tanks.length; i++) match.minds[i] = makeMemory();
      if (!isGuest) hostSendRound(match);
      else match.world.phase = 'ready';
      match.onlineRound = online.round;
    } else {
      const g = mazeSize(lay.board);
      const count = cfg.current.mode === '3p' ? 3 : cfg.current.mode === '2p' ? 2 : 1 + cfg.current.rivals;
      match = newMatch(g.cols, g.rows, count, (Math.random() * 2 ** 31) >>> 0, cfg.current.target);
      for (let i = 0; i < count; i++) match.minds[i] = i < humanIds(match).length ? null : makeMemory();
      // The canvas wasn't sized yet: these dims are from a fallback board. Respawn once it is.
      match.fixDims = !w || !h;
    }
    m.current = match;
    match.world.round = 1;
    hostIn.current.clear();
    guestFireCount.current = 0;
    startBanner(match);
    shell.setScore(null);
  };

  useEffect(() => {
    if (shell.status === 'ready' || !m.current || (online?.isHost && m.current.onlineRound !== online.round)) reset();
  }, [mode, rivals, levelName, targetName, shell.status, online?.seat, online?.players.length, online?.bots.length, online?.round]);

  // Fire keys produce presses (edges); driving keys are read live each step.
  useKeys((code) => {
    if (!m.current) return;
    const humans = humanIds(m.current);
    const solo = !online && cfg.current.mode === 'cpu';
    if (code === 'KeyQ' || (solo && (code === 'Space' || code === 'Enter')) || (online && (code === 'Space' || code === 'Enter' || code === 'Slash'))) {
      const p = online ? mine() : (humans[0] ?? 0);
      if (p >= 0) fireQueued.current[p] = true;
    }
    if (code === 'Slash' && !online && humans[1] !== undefined) fireQueued.current[humans[1]] = true;
    if (code === 'KeyU' && humans[2] !== undefined) fireQueued.current[humans[2]] = true;
  });

  /** Live driving input for a local human tank: its keys point the tank up/left/down/right on screen. */
  const keyInput = (id: number): TankInput => {
    const match = m.current;
    if (!match) return { turn: 0, move: 0, fire: false };
    const keys = shell.keys;
    const solo = !online && cfg.current.mode === 'cpu';
    const humans = humanIds(match);
    const held = (up: string, left: string, down: string, right: string) => keyHeading(keys.down(up), keys.down(down), keys.down(left), keys.down(right));
    let dir: number | undefined;
    if (id === (humans[0] ?? -1)) {
      dir = held('KeyW', 'KeyA', 'KeyS', 'KeyD');
      if (dir === undefined && (solo || online)) dir = held('ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight');
    }
    if (!online && id === (humans[1] ?? -1)) dir = held('ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight');
    if (!online && id === (humans[2] ?? -1)) dir = held('KeyI', 'KeyJ', 'KeyK', 'KeyL');
    return dir === undefined ? { turn: 0, move: 0, fire: false } : { turn: 0, move: 0, fire: false, dir };
  };

  // Touch sticks
  const zoneFor = (x: number, y: number): number => {
    const { w, h } = sizeRef.current;
    const lay = layout(w, h);
    for (let i = 0; i < lay.zones.length; i++) {
      const z = lay.zones[i];
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return i;
    }
    return -1;
  };

  /** Pointer position in the canvas's logical pixels: a framed device scales the canvas down on screen. */
  const canvasPoint = (e: RPointerEvent<HTMLCanvasElement>) => {
    return toCanvas(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), sizeRef.current);
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!touch) return;
    const { x, y } = canvasPoint(e);
    const zi = zoneFor(x, y);
    if (zi < 0) return;
    const player = humanIds(m.current!)[zi];
    if (player === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // the drawn ring (r=44) must never reach over the maze: keep the origin inside the zone
    const z = layout(sizeRef.current.w, sizeRef.current.h).zones[zi];
    const lo = z.x + Math.min(44, z.w / 2);
    const hi = z.x + Math.max(z.w - 44, z.w / 2);
    const ox = Math.min(Math.max(x, lo), hi);
    sticks.current.set(e.pointerId, { id: e.pointerId, ox, oy: y, x, y, player });
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = sticks.current.get(e.pointerId);
    if (!s) return;
    const p = canvasPoint(e);
    s.x = p.x;
    s.y = p.y;
  };
  const onPointerEnd = (e: RPointerEvent<HTMLCanvasElement>) => {
    sticks.current.delete(e.pointerId);
  };
  useEffect(() => () => sticks.current.clear(), []);

  const stickFor = (player: number): Stick | null => {
    for (const s of sticks.current.values()) if (s.player === player) return s;
    return null;
  };

  /** Merge keyboard + stick into this tank's input for the step. */
  const humanInput = (id: number): TankInput => {
    const input = keyInput(id);
    const match = m.current;
    const stick = match ? stickFor(id) : null;
    if (match && stick) {
      const dx = stick.x - stick.ox;
      const dy = stick.y - stick.oy;
      const mag = Math.min(1, Math.hypot(dx, dy) / 44);
      const zi = zoneFor(stick.ox, stick.oy);
      const lay = layout(sizeRef.current.w, sizeRef.current.h);
      const flip = zi >= 0 && lay.zones[zi]?.flip;
      const angle = Math.atan2(dy, dx) + (flip ? Math.PI : 0);
      const si = stickInput(angle, mag);
      if (si.dir !== undefined) input.dir = si.dir;
    }
    if (fireQueued.current[id] || fireHeld.current[id]) {
      input.fire = true;
      fireQueued.current[id] = false;
    }
    return input;
  };

  // -----------------------------------------------------------------------------------------------------------------
  // Effects

  const muzzle = (match: Match, t: Tank) => {
    for (let i = 0; i < 5; i++) {
      const a = t.a + (Math.random() - 0.5) * 0.7;
      const v = 2 + Math.random() * 3;
      match.particles.push({ x: t.x + Math.cos(t.a) * 0.4, y: t.y + Math.sin(t.a) * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.16 + Math.random() * 0.1, color: '#ffb340', size: 0.07 });
    }
  };
  const spark = (match: Match, x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 2;
      match.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.2, color: '#f0c060', size: 0.045 });
    }
  };
  const explode = (match: Match, x: number, y: number, color: string) => {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1.5 + Math.random() * 4;
      match.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.4, color: i % 3 === 0 ? color : i % 3 === 1 ? '#3a3a40' : '#ff9f40', size: 0.06 + Math.random() * 0.06 });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      match.particles.push({ x, y, vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.5 - 0.4, life: 0, max: 0.9 + Math.random() * 0.5, color: '#8a857c', size: 0.16, smoke: true });
    }
    match.scorches.push({ x, y, life: 0 });
    match.shake = Math.min(1, match.shake + 0.5);
    match.flash = 0.35;
  };

  // -----------------------------------------------------------------------------------------------------------------
  // Net

  useEffect(
    () =>
      online?.onMessage((from, data) => {
        const pkt = parsePacket(data);
        if (!pkt || pkt.roomRound !== online.round) return;
        const match = m.current;
        if (!match) return;
        if (pkt.k === 'in' && online.seat === 0) {
          const cur = hostIn.current.get(from) ?? { turn: 0 as const, move: 0 as const, dir: undefined, fc: 0, lastFc: -1 };
          hostIn.current.set(from, { turn: pkt.turn, move: pkt.move, dir: pkt.dir, fc: pkt.fireCount, lastFc: cur.lastFc });
          return;
        }
        if (online.seat === 0) return;
        if (pkt.k === 'round') {
          applyRoundPacket(match, pkt);
          return;
        }
        if (pkt.k === 's') {
          match.lastStateAt = performance.now();
          const snap: Snapshot = {
            at: match.lastStateAt,
            tanks: pkt.tanks.map((t) => ({ x: t.x, y: t.y, a: t.a, alive: t.alive, moving: t.moving, special: t.special })),
            shells: pkt.shells.map((s) => ({ x: s.x, y: s.y, owner: s.owner })),
          };
          match.snaps.push(snap);
          if (match.snaps.length > 3) match.snaps.shift();
          match.guestScores = pkt.scores;
          match.guestMines = pkt.mines;
          match.guestPickups = pkt.pickups;
          for (const b of pkt.beams) if (!match.guestBeams.some((g) => g.owner === b.owner && g.pts.length === b.pts.length)) match.guestBeams.push({ ...b, t: 0.35 });
          const fresh = pkt.events.filter((e) => e.id > match.lastEvSeen);
          for (const e of fresh) match.lastEvSeen = Math.max(match.lastEvSeen, e.id);
          applyEvents(match, fresh);
          if (pkt.phase !== match.guestPhase) {
            match.guestPhase = pkt.phase;
            if (pkt.phase === 'play') setBanner(null);
          }
          match.guestPhaseT = pkt.phaseT;
          if (pkt.phase === 'settle') {
            const left = snap.tanks.filter((t) => t.alive).length;
            if (left <= 1 && !match.ended) {
              setBanner({ text: left === 1 ? `${nameOf(match, snap.tanks.findIndex((t) => t.alive))} Scores` : 'Draw', sub: pkt.scores.join(' to ') });
            }
          }
          return;
        }
        if (pkt.k === 'end' && !match.reported) {
          match.reported = true;
          match.ended = true;
          online.reportResult(online.round, pkt.winner);
          // champ is the seat whose tank actually won the match (bots and departed seats count);
          // winner stays null for them because nobody scores the room win.
          const champ = pkt.champ;
          const title = champ === null ? 'Draw' : champ === online.seat ? 'You Win' : `${seatName(match, champ)} Wins`;
          showOver(match, title, pkt.scores, pkt.rounds);
        }
      }),
    [online?.onMessage, online?.seat, online?.round],
  );

  const seatName = (match: Match, seat: number) => {
    const id = match.seats.indexOf(seat);
    if (id >= 0) return nameOf(match, id);
    return online?.players.find((pl) => pl.seat === seat)?.name ?? online?.bots.find((b) => b.seat === seat)?.name ?? `Seat ${seat}`;
  };

  const applyRoundPacket = (match: Match, pkt: RoundPacket) => {
    const world = createWorld({ cols: pkt.cols, rows: pkt.rows, seed: pkt.seed, count: pkt.seats.length, target: pkt.target });
    world.round = pkt.round;
    world.scores = pkt.scores.slice();
    for (let i = 0; i < world.tanks.length && i < pkt.spawns.length; i++) {
      world.tanks[i].x = pkt.spawns[i].x;
      world.tanks[i].y = pkt.spawns[i].y;
      world.tanks[i].a = pkt.spawns[i].a;
    }
    match.world = world;
    match.seats = pkt.seats;
    match.bots = pkt.bots;
    match.guestScores = pkt.scores.slice();
    match.snaps = [];
    match.particles = [];
    match.guestPhase = 'ready';
    match.guestPhaseT = 1.2;
    match.guestBeams = [];
    match.guestMines = [];
    match.guestPickups = [];
    match.onlineRound = pkt.roomRound;
    startBanner(match);
  };

  /** Labeled final score, plus (online) who is in the room. */
  const overDetail = (match: Match, scores: number[], rounds: number) => {
    const ids = match.world.tanks.map((t) => t.id);
    if (!online) {
      const cpu = cfg.current.mode === 'cpu';
      return finalLine(ids.map((i) => (cpu && i === 0 ? 'You' : NAMES[i])), scores, rounds);
    }
    const names = ids.map((i) => (match.seats[i] === online.seat ? 'You' : nameOf(match, i)));
    const people = [...online.players].sort((a, b) => (a.seat === online.seat ? -1 : b.seat === online.seat ? 1 : a.seat - b.seat)).map((p) => (p.seat === online.seat ? 'You' : p.name));
    return `${finalLine(names, scores, rounds)} ${rosterLine(people)}`.trim();
  };

  const showOver = (match: Match, title: string, scores: number[], rounds: number) => {
    lastEnd.current = { title, scores: scores.slice(), rounds };
    // keepDetail: the score stays on the card even in the short framed windows, where the shell hides details
    shell.gameOver(undefined, { title, detail: overDetail(match, scores, rounds), keepDetail: true });
  };

  // Online: say when someone leaves. Mid-round a bot takes their tank and the round goes on; on the Game Over card the
  // roster updates and their seat reads as left.
  useEffect(() => {
    if (!online) {
      known.current.clear();
      prevPlayers.current = [];
      return;
    }
    const now = online.players;
    const gone = prevPlayers.current.filter((s) => s !== online.seat && !now.some((p) => p.seat === s));
    for (const p of now) known.current.set(p.seat, p.name);
    prevPlayers.current = now.map((p) => p.seat);
    const match = m.current;
    if (!gone.length || !match) return;
    const names = gone.map((s) => known.current.get(s) ?? `Seat ${s}`);
    if (shell.status === 'playing' && !match.ended && gone.some((s) => match.seats.includes(s))) {
      setNotice({ text: `${names.join(' and ')} Left`, sub: 'A bot takes over their tank.', id: performance.now() });
    } else if (shell.status === 'over' && lastEnd.current) {
      const e = lastEnd.current;
      shell.updateOver({ title: e.title, detail: overDetail(match, e.scores, e.rounds), keepDetail: true });
    }
  }, [online?.players]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // -----------------------------------------------------------------------------------------------------------------
  // Sim

  const endMatch = (match: Match) => {
    match.ended = true;
    const w = match.world;
    const winner = w.winner >= 0 ? w.winner : -1;
    let winnerSeat: number | null = null;
    let title: string;
    if (online) {
      const seat = winner >= 0 ? match.seats[winner] : null;
      // A departed player's tank (driven by a bot) wins nobody the match.
      winnerSeat = seat === null || seat === undefined || match.departed.has(seat) || match.bots.includes(seat) ? null : seat;
      if (!match.reported) {
        match.reported = true;
        online.reportResult(online.round, winnerSeat);
        online.send(endPacket({ k: 'end', roomRound: online.round, winner: winnerSeat, champ: winner >= 0 ? (match.seats[winner] ?? null) : null, scores: w.scores, rounds: w.round }));
      }
      title = winnerSeat === null ? (winner >= 0 ? `${nameOf(match, winner)} Wins` : 'Draw') : winnerSeat === online.seat ? 'You Win' : `${seatName(match, winnerSeat)} Wins`;
      if (winner >= 0 && winnerSeat === null) title = `${nameOf(match, winner)} Wins`;
    } else {
      const cpuMode = cfg.current.mode === 'cpu';
      title = winner < 0 ? 'Draw' : cpuMode ? (winner === 0 ? 'You Win' : `${NAMES[winner]} Wins`) : `${NAMES[winner]} Wins`;
    }
    showOver(match, title, w.scores, w.round);
    if (winner === 0) sfx.play('win');
    else sfx.play('lose');
  };

  const update = (dt: number) => {
    const match = m.current;
    if (!match) return;
    // Round 1 built on fallback dims: respawn it as soon as the real size shows up.
    if (match.fixDims) {
      const { w: sw, h: sh } = sizeRef.current;
      if (sw && sh && match.world.round === 1 && match.world.phase === 'ready') {
        match.fixDims = false;
        const g = mazeSize(layout(sw, sh).board);
        spawnRound(match.world, match.world.seed, g);
      } else if (sw && sh) match.fixDims = false;
    }
    // decay visuals
    match.flash = Math.max(0, match.flash - dt * 2.5);
    match.shake = Math.max(0, match.shake - dt * 2.2);
    for (const p of match.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (p.smoke) p.size += dt * 0.3;
    }
    match.particles = match.particles.filter((p) => p.life < p.max);
    for (const s of match.scorches) s.life += dt;
    for (const mk of match.marks) mk.life += dt;
    match.marks = match.marks.filter((mk) => mk.life < 4);
    for (const b of match.guestBeams) b.t -= dt;
    match.guestBeams = match.guestBeams.filter((b) => b.t > 0);

    if (isGuest) {
      // Waiting for host indicator
      const silence = performance.now() - match.lastStateAt;
      const shouldWait = silence > 1500 && shell.status === 'playing' && !match.ended;
      if (shouldWait !== waiting) setWaiting(shouldWait);
      if (mine() < 0) return;
      // Send our input at ~30 Hz or on change.
      const input = mine() >= 0 ? humanInput(mine()) : { turn: 0 as const, move: 0 as const, fire: false };
      const last = guestLastSent.current;
      const now = performance.now();
      const changed =
        input.turn !== last.turn || input.move !== last.move || (input.dir === undefined) !== (last.dir === undefined) || (input.dir !== undefined && Math.abs(input.dir - last.dir!) > 0.02);
      const fireNow = input.fire;
      if (fireNow) guestFireCount.current++;
      if (online && (changed || fireNow || now - last.t > 33)) {
        guestLastSent.current = { turn: input.turn, move: input.move, dir: input.dir, t: now };
        online.send(inputPacket({ k: 'in', roomRound: online.round, turn: input.turn, move: input.move, dir: input.dir, fireCount: guestFireCount.current }), { fast: true });
      }
      return;
    }

    // Host: a seat whose player left is taken over by a bot for the rest of the match.
    if (online && !match.ended) {
      for (let i = 0; i < match.seats.length; i++) {
        const seat = match.seats[i];
        if (match.bots.includes(seat) || match.departed.has(seat)) continue;
        if (!online.players.some((p) => p.seat === seat)) {
          match.departed.add(seat);
          match.minds[i] = makeMemory();
        }
      }
    }

    match.acc += dt;
    let sentRound = match.world.round;
    while (match.acc >= STEP) {
      match.acc -= STEP;
      const w = match.world;
      const inputs: TankInput[] = w.tanks.map(() => noInput);
      for (const t of w.tanks) {
        const seat = online ? match.seats[t.id] : t.id;
        const isBot = online ? match.bots.includes(seat) || match.departed.has(seat) : match.minds[t.id] !== null;
        if (isBot) {
          if (!match.minds[t.id]) match.minds[t.id] = makeMemory();
          inputs[t.id] = think(w, t.id, match.level, match.minds[t.id]!, match.rngs[t.id]);
        } else if (online && seat !== 0) {
          const g = hostIn.current.get(seat);
          if (g) {
            const fire = g.fc > g.lastFc;
            if (fire) g.lastFc = g.fc;
            inputs[t.id] = g.dir === undefined ? { turn: g.turn, move: g.move, fire } : { turn: 0, move: 0, fire, dir: g.dir };
          }
        } else {
          inputs[t.id] = humanInput(t.id);
        }
      }
      const prevTreads = w.tanks.map((t) => t.tread);
      step(w, inputs, STEP);
      for (const t of w.tanks) {
        if (t.alive && t.tread !== prevTreads[t.id] && Math.random() < 0.4) match.marks.push({ x: t.x, y: t.y, a: t.a, life: 0 });
      }
      // collect events with ids for guests
      for (const e of w.events) {
        const ne: NetEvent | null =
          e.k === 'fire' ? { id: match.evId, k: 'fire', a: e.id, b: 0, x: 0, y: 0 } :
          e.k === 'bounce' ? { id: match.evId, k: 'bounce', a: 0, b: 0, x: e.x, y: e.y } :
          e.k === 'kill' ? { id: match.evId, k: 'kill', a: e.id, b: e.by, x: e.x, y: e.y } :
          e.k === 'pickup' ? { id: match.evId, k: 'pickup', a: e.id, b: 0, x: 0, y: 0 } :
          e.k === 'laser' ? { id: match.evId, k: 'laser', a: e.id, b: 0, x: 0, y: 0, pts: e.pts } :
          e.k === 'mine' ? { id: match.evId, k: 'mine', a: e.id, b: 0, x: 0, y: 0 } :
          { id: match.evId, k: 'boom', a: 0, b: 0, x: e.x, y: e.y };
        match.evId++;
        if (ne) {
          match.pending.push(ne);
          applyEvents(match, [ne]);
        }
      }
      // banners on phase change
      if (w.phase === 'play' && match.prevPhase !== 'play') setBanner(null);
      if (w.phase === 'settle' && match.prevPhase !== 'settle') {
        setBanner({
          text: w.winner >= 0 ? (online ? `${nameOf(match, w.winner)} Scores` : cfg.current.mode === 'cpu' && w.winner === 0 ? 'You Score' : `${NAMES[w.winner] ?? '???'} Scores`) : 'Draw',
          sub: w.scores.join(' to '),
        });
        if (w.winner === 0) sfx.play('coin');
      }
      match.prevPhase = w.phase;
      if (w.round !== sentRound) {
        sentRound = w.round;
        // Local rounds use the maze dims that fit the stage as it is right now.
        if (!online) {
          const { w: sw, h: sh } = sizeRef.current;
          if (sw && sh) spawnRound(w, w.seed, mazeSize(layout(sw, sh).board));
        }
        hostSendRound(match);
        startBanner(match);
      }
      if (w.phase === 'done' && !match.ended) endMatch(match);
    }

    // Host state broadcast ~25 Hz.
    if (online && online.seat === 0) {
      const now = performance.now();
      if (now - (match.lastNetAt ?? 0) > 40 && match.world.phase !== 'ready') {
        match.lastNetAt = now;
        const w = match.world;
        online.send(
          statePacket({
            roomRound: online.round,
            tick: Math.round(w.time * 60),
            phase: w.phase === 'done' ? 'settle' : w.phase,
            phaseT: w.phaseT,
            tanks: w.tanks.map((t) => ({ x: t.x, y: t.y, a: t.a, alive: t.alive, special: t.special, moving: false })),
            shells: w.shells.map((s) => ({ x: s.x, y: s.y, owner: s.owner })),
            pickups: w.pickups.map((p) => ({ kind: p.kind, x: p.x, y: p.y })),
            mines: w.mines.map((mn) => ({ x: mn.x, y: mn.y, armed: mn.age >= 1 })),
            beams: w.beams.map((b) => ({ owner: b.owner, pts: b.pts })),
            scores: w.scores,
            events: match.pending,
          }),
          { fast: true },
        );
        match.pending = [];
      }
    }
  };

  // -----------------------------------------------------------------------------------------------------------------
  // Render

  /** Re-measured a few times a second: the canvas's on-screen scale and the shell pills over the HUD row, in canvas px. */
  const measureView = (hudH: number) => {
    const v = view.current;
    const now = performance.now();
    if (now - v.at < 400) return v;
    v.at = now;
    const cv = ref.current;
    const root = shell.root.current;
    if (!cv || !cv.offsetWidth) return v;
    const r = cv.getBoundingClientRect();
    const k = r.width / cv.offsetWidth;
    if (!(k > 0.2)) return v;
    const u = Math.max(1, 1 / k);
    if (u !== v.u) root?.style.setProperty('--g-tank-maze-u', String(u));
    v.u = u;
    const rel = (el: Element | null | undefined) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (!b.width || (b.top - r.top) / k > hudH) return null;
      return { x0: (b.left - r.left) / k, x1: (b.right - r.left) / k };
    };
    v.badge = rel(root?.querySelector('.arcade-online-status'));
    v.ctrlX = rel(root?.querySelector('.arcade-ctrl'))?.x0 ?? null;
    return v;
  };

  const render = () => {
    const c = ctx();
    const match = m.current;
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#dcd8d0';
    c.fillRect(0, 0, w, h);
    if (!match) return;
    const world = match.world;
    const lay = layout(w, h);
    const fit = fitBoard(lay.board, world.maze.cols, world.maze.rows, w);
    const cell = fit.cell;
    const bw = cell * world.maze.cols;
    const bh = cell * world.maze.rows;
    const shx = match.shake ? (Math.random() - 0.5) * match.shake * 9 : 0;
    const shy = match.shake ? (Math.random() - 0.5) * match.shake * 9 : 0;
    const ox = fit.ox + shx;
    const oy = fit.oy + shy;
    const X = (x: number) => ox + x * cell;
    const Y = (y: number) => oy + y * cell;

    // floor + grid
    c.fillStyle = '#eceae4';
    c.fillRect(ox, oy, bw, bh);
    c.strokeStyle = 'rgba(60,56,48,0.06)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < world.maze.cols; i++) {
      c.moveTo(X(i), oy);
      c.lineTo(X(i), oy + bh);
    }
    for (let j = 1; j < world.maze.rows; j++) {
      c.moveTo(ox, Y(j));
      c.lineTo(ox + bw, Y(j));
    }
    c.stroke();

    // scorch decals
    for (const s of match.scorches) {
      const a = Math.max(0, 0.35 - s.life * 0.02);
      c.fillStyle = `rgba(40,36,32,${a})`;
      c.beginPath();
      c.arc(X(s.x), Y(s.y), cell * 0.5, 0, Math.PI * 2);
      c.fill();
    }

    // tread marks
    for (const mk of match.marks) {
      c.save();
      c.translate(X(mk.x), Y(mk.y));
      c.rotate(mk.a);
      c.globalAlpha = Math.max(0, 0.22 * (1 - mk.life / 4));
      c.fillStyle = '#4a463f';
      c.fillRect(-cell * 0.2, -cell * 0.21, cell * 0.4, cell * 0.05);
      c.fillRect(-cell * 0.2, cell * 0.16, cell * 0.4, cell * 0.05);
      c.restore();
    }
    c.globalAlpha = 1;

    // walls: merged rects as dark rounded bars with a soft shadow
    c.save();
    c.shadowColor = 'rgba(40,36,30,0.35)';
    c.shadowBlur = cell * 0.12;
    c.shadowOffsetY = cell * 0.05;
    c.fillStyle = '#3b3a3e';
    for (const rc of world.maze.rects) {
      const r = Math.min(cell * 0.05, (Math.min(rc[2], rc[3]) * cell) / 2);
      c.beginPath();
      c.roundRect(X(rc[0]), Y(rc[1]), rc[2] * cell, rc[3] * cell, r);
      c.fill();
    }
    c.restore();
    c.fillStyle = '#55545a';
    for (const rc of world.maze.rects) {
      const inset = cell * 0.018;
      const r = Math.min(cell * 0.04, (Math.min(rc[2], rc[3]) * cell) / 2 - inset);
      if (r <= 0) continue;
      c.beginPath();
      c.roundRect(X(rc[0]) + inset, Y(rc[1]) + inset, rc[2] * cell - inset * 2, rc[3] * cell - inset * 2, r);
      c.fill();
    }

    // pickups
    const pickups = isGuest ? match.guestPickups.map((p) => ({ kind: p.kind, x: p.x, y: p.y, born: 0 })) : world.pickups;
    const tNow = world.time;
    for (const p of pickups) {
      const bob = Math.sin((tNow + p.x * 3) * 3) * 0.03;
      const px = X(p.x);
      const py = Y(p.y + bob);
      const s = cell * 0.34;
      c.save();
      c.translate(px, py);
      c.fillStyle = '#fffdf8';
      c.strokeStyle = '#c8c2b4';
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(-s / 2, -s / 2, s, s, s * 0.28);
      c.fill();
      c.stroke();
      c.strokeStyle = '#3b3a3e';
      c.fillStyle = '#3b3a3e';
      c.lineWidth = Math.max(1.2, cell * 0.03);
      c.lineCap = 'round';
      if (p.kind === 'laser') {
        c.beginPath();
        c.moveTo(-s * 0.28, s * 0.2);
        c.lineTo(-s * 0.02, -s * 0.22);
        c.lineTo(s * 0.08, s * 0.02);
        c.lineTo(s * 0.3, -s * 0.2);
        c.stroke();
      } else if (p.kind === 'triple') {
        for (const dx of [-0.2, 0, 0.2]) {
          c.beginPath();
          c.arc(dx * s, -Math.abs(dx) * s * 0.6, s * 0.07, 0, Math.PI * 2);
          c.fill();
        }
      } else {
        c.beginPath();
        c.arc(0, 0, s * 0.18, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.arc(0, 0, s * 0.06, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // mines
    const mines = isGuest ? match.guestMines : world.mines.map((mn) => ({ x: mn.x, y: mn.y, armed: mn.age >= 1 }));
    for (const mn of mines) {
      const px = X(mn.x);
      const py = Y(mn.y);
      c.globalAlpha = mn.armed ? 0.85 : 0.4;
      c.strokeStyle = '#3b3a3e';
      c.lineWidth = Math.max(1, cell * 0.03);
      c.beginPath();
      c.arc(px, py, cell * 0.14, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = mn.armed ? '#c23b2e' : '#6a675f';
      c.beginPath();
      c.arc(px, py, cell * 0.06, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }

    // tanks (interpolated for guests)
    const now = performance.now();
    const snapFor = (): { x: number; y: number; a: number; alive: boolean; moving: boolean; special: Special | null }[] | null => {
      if (!isGuest) return null;
      const sn = match.snaps;
      if (!sn.length) return null;
      if (sn.length === 1) return sn[0].tanks;
      const renderAt = now - 90;
      const a = sn[sn.length - 2];
      const b = sn[sn.length - 1];
      const f = Math.max(0, Math.min(1.5, (renderAt - a.at) / Math.max(1, b.at - a.at)));
      return b.tanks.map((tb, i) => {
        const ta = a.tanks[i] ?? tb;
        const da = Math.atan2(Math.sin(tb.a - ta.a), Math.cos(tb.a - ta.a));
        return { x: ta.x + (tb.x - ta.x) * f, y: ta.y + (tb.y - ta.y) * f, a: ta.a + da * f, alive: tb.alive, moving: tb.moving, special: tb.special };
      });
    };
    const viewTanks = snapFor() ?? world.tanks.map((t) => ({ x: t.x, y: t.y, a: t.a, alive: t.alive, moving: false, special: t.special }));

    // aim guide for laser holders
    for (const t of world.tanks) {
      const vt = viewTanks[t.id];
      if (!vt || !vt.alive || vt.special !== 'laser') continue;
      const tr = traceShot(world, vt.x, vt.y, vt.a, 0, 4);
      c.strokeStyle = COLORS[t.id];
      c.globalAlpha = 0.3;
      c.lineWidth = Math.max(1, cell * 0.03);
      c.setLineDash([cell * 0.12, cell * 0.1]);
      c.beginPath();
      c.moveTo(X(vt.x), Y(vt.y));
      c.lineTo(X(tr.pts[tr.pts.length - 2]), Y(tr.pts[tr.pts.length - 1]));
      c.stroke();
      c.setLineDash([]);
      c.globalAlpha = 1;
    }

    for (let i = 0; i < viewTanks.length; i++) {
      const vt = viewTanks[i];
      const t = world.tanks[i];
      if (!vt || (t && !t.alive && !isGuest)) continue;
      if (!vt.alive && isGuest) continue;
      const color = COLORS[i % COLORS.length];
      c.save();
      c.translate(X(vt.x), Y(vt.y));
      c.rotate(vt.a);
      const rec = (t?.recoil ?? 0) * cell * 0.05;
      // treads
      c.fillStyle = '#33322f';
      const tw = cell * 0.5;
      const th = cell * 0.1;
      const treadOff = ((t?.tread ?? 0) * cell) % (cell * 0.1);
      for (const ty of [-cell * 0.2, cell * 0.2 - th]) {
        c.beginPath();
        c.roundRect(-tw / 2, ty, tw, th, th / 2);
        c.fill();
        c.fillStyle = '#232220';
        for (let k = -tw / 2 + treadOff; k < tw / 2; k += cell * 0.1) c.fillRect(k, ty + th * 0.2, cell * 0.04, th * 0.6);
        c.fillStyle = '#33322f';
      }
      // body
      c.fillStyle = color;
      c.beginPath();
      c.roundRect(-cell * 0.22 - rec, -cell * 0.15, cell * 0.44, cell * 0.3, cell * 0.08);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 1;
      c.stroke();
      // turret + barrel
      c.fillStyle = shade(color, -18);
      c.beginPath();
      c.arc(-rec * 0.5, 0, cell * 0.11, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2e2d2a';
      c.fillRect(cell * 0.04 - rec, -cell * 0.035, cell * 0.28, cell * 0.07);
      // special ring/icon
      if (vt.special) {
        c.strokeStyle = '#fff';
        c.globalAlpha = 0.9;
        c.lineWidth = Math.max(1.2, cell * 0.03);
        c.beginPath();
        c.arc(0, 0, cell * 0.19, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
      c.restore();
    }

    // shells
    const viewShells = (() => {
      if (!isGuest) return world.shells.map((s) => ({ x: s.x, y: s.y }));
      const sn = match.snaps;
      if (!sn.length) return [];
      if (sn.length === 1) return sn[0].shells;
      const renderAt = now - 90;
      const a = sn[sn.length - 2];
      const b = sn[sn.length - 1];
      const f = Math.max(0, Math.min(1.5, (renderAt - a.at) / Math.max(1, b.at - a.at)));
      const n = Math.min(a.shells.length, b.shells.length);
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) out.push({ x: a.shells[i].x + (b.shells[i].x - a.shells[i].x) * f, y: a.shells[i].y + (b.shells[i].y - a.shells[i].y) * f });
      return out;
    })();
    for (const s of viewShells) {
      const px = X(s.x);
      const py = Y(s.y);
      c.globalAlpha = 0.22;
      c.fillStyle = '#2a2925';
      c.beginPath();
      c.arc(px - cell * 0.05, py - cell * 0.05, cell * 0.045, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = '#1d1c19';
      c.beginPath();
      c.arc(px, py, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
      c.fill();
    }

    // beams
    const beams = isGuest ? match.guestBeams : world.beams;
    for (const b of beams) {
      const alpha = Math.max(0, Math.min(1, b.t / 0.35));
      const color = COLORS[b.owner % COLORS.length];
      c.save();
      c.globalAlpha = alpha * 0.9;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = color;
      c.lineWidth = cell * 0.1;
      c.beginPath();
      for (let i = 0; i < b.pts.length; i += 2) {
        if (i === 0) c.moveTo(X(b.pts[i]), Y(b.pts[i + 1]));
        else c.lineTo(X(b.pts[i]), Y(b.pts[i + 1]));
      }
      c.stroke();
      c.strokeStyle = '#fff';
      c.lineWidth = cell * 0.03;
      c.stroke();
      c.restore();
    }

    // particles
    for (const p of match.particles) {
      const f = 1 - p.life / p.max;
      c.globalAlpha = f * (p.smoke ? 0.35 : 0.9);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(X(p.x), Y(p.y), Math.max(0.8, p.size * cell * (p.smoke ? 1 + p.life : f)), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // flash
    if (match.flash > 0) {
      c.fillStyle = `rgba(255,240,200,${match.flash * 0.25})`;
      c.fillRect(ox, oy, bw, bh);
    }

    // HUD chips
    const hudH = lay.hud;
    const compactHud = hudH < 30;
    const scores = isGuest ? match.guestScores : world.scores;
    const chips = viewTanks.map((_, i) => i);
    // Chips stay out of the shell's top-right controls and, online, the centered Direct/Relayed badge (both measured).
    const v = measureView(hudH);
    const u = v.u;
    const ctrlX = v.ctrlX !== null && v.ctrlX > w / 2 ? v.ctrlX : w - 176;
    const spans = freeSpans(12, ctrlX - 8, online && v.badge ? [v.badge] : []);
    const fontOf = (f: number, weight: number) => `${weight} ${f}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    // A seat's "(Left)" or "(Bot)" tag survives the clip; only the name is shortened.
    const clip = (label: string, max: number) => {
      const tag = /\s\((Left|Bot)\)$/.exec(label)?.[0] ?? '';
      const name = label.slice(0, label.length - tag.length);
      return name.length > Math.max(max, 5) ? `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…${tag}` : label;
    };
    const maxFont = 13 * u;
    const minFont = 11.25 * u;
    let chipFont = Math.max(minFont, Math.min(maxFont, hudH * 0.4 * u));
    let gap = (compactHud ? 8 : 14) * u;
    let maxName = 24;
    const labels = () => chips.map((i) => clip(nameOf(match, i), maxName));
    const widthsFor = () => {
      c.font = fontOf(chipFont, 600);
      const names = labels();
      return chips.map((i, ci) => {
        const nw = c.measureText(names[ci]).width;
        c.font = fontOf(chipFont, 700);
        const sw = c.measureText(`${scores[i] ?? 0}`).width;
        c.font = fontOf(chipFont, 600);
        return 17 * u + nw + 8 * u + sw + 7 * u;
      });
    };
    let widths = widthsFor();
    let xs = packChips(widths, spans, gap);
    if (!xs && gap > 4 * u) {
      gap = 4 * u;
      widths = widthsFor();
      xs = packChips(widths, spans, gap);
    }
    while (!xs && chipFont > minFont) {
      chipFont = Math.max(minFont, chipFont - 1);
      widths = widthsFor();
      xs = packChips(widths, spans, gap);
    }
    while (!xs && maxName > 4) {
      maxName--;
      widths = widthsFor();
      xs = packChips(widths, spans, gap);
    }
    if (!xs) {
      let x = 12;
      xs = widths.map((cw) => ((x += cw + gap), x - cw - gap));
    }
    const names = labels();
    const pillH = Math.max(hudH * 0.64, chipFont + 6 * u);
    for (let ci = 0; ci < chips.length; ci++) {
      const i = chips[ci];
      const cw = widths[ci];
      const cx = xs[ci];
      c.fillStyle = 'rgba(255,255,255,0.65)';
      c.beginPath();
      c.roundRect(cx, hudH / 2 - pillH / 2, cw, pillH, pillH / 2);
      c.fill();
      c.fillStyle = COLORS[i % COLORS.length];
      c.beginPath();
      c.arc(cx + 9 * u, hudH / 2, 4 * u, 0, Math.PI * 2);
      c.fill();
      c.font = fontOf(chipFont, 600);
      c.fillStyle = '#2e2d2a';
      c.fillText(names[ci], cx + 17 * u, hudH / 2 + chipFont * 0.36);
      const nw = c.measureText(names[ci]).width;
      c.font = fontOf(chipFont, 700);
      c.fillStyle = '#1d1c19';
      c.fillText(`${scores[i] ?? 0}`, cx + 17 * u + nw + 8 * u, hudH / 2 + chipFont * 0.36);
    }

    // touch sticks
    for (const s of sticks.current.values()) {
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.min(44, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      c.globalAlpha = 0.35;
      c.strokeStyle = '#3b3a3e';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(s.ox, s.oy, 44, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 0.7;
      c.fillStyle = '#3b3a3e';
      c.beginPath();
      c.arc(s.ox + Math.cos(a) * d, s.oy + Math.sin(a) * d, 20, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  };

  useGameLoop(update, render);

  const touchPlayers = touch && m.current ? humanIds(m.current).slice(0, 2) : [];
  const lay = size.w ? layout(size.w, size.h) : null;
  return (
    <div className="g-tank-maze-stage">
      <canvas
        ref={ref}
        className="g-tank-maze-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        aria-label="Tank maze arena"
      />
      {touch && lay && touchPlayers.map((pid, i) => {
        const z = lay.zones[i];
        if (!z) return null;
        // fire button at the far corner of each zone; P2's portrait zone is flipped, so its corner reads top-left on screen
        const landscape2 = lay.zones.length === 2 && !lay.portrait;
        const style: React.CSSProperties =
          lay.zones.length === 1
            ? { right: 14, bottom: 14 }
            : z.flip
              ? { left: z.x + 14, top: z.y + 14 }
              : landscape2 && i === 0
                ? { left: z.x + 14, top: z.y + z.h - 70 }
                : { left: z.x + z.w - 70, top: z.y + z.h - 70 };
        return (
          <button
            key={pid}
            type="button"
            className="g-tank-maze-fire"
            style={style}
            aria-label={`Fire player ${pid + 1}`}
            onPointerDown={(e) => {
              e.preventDefault();
              fireQueued.current[pid] = true;
              fireHeld.current[pid] = true;
            }}
            onPointerUp={() => (fireHeld.current[pid] = false)}
            onPointerCancel={() => (fireHeld.current[pid] = false)}
            onPointerLeave={() => (fireHeld.current[pid] = false)}
          >
            Fire
          </button>
        );
      })}
      {banner && (
        <div className="g-tank-maze-banner" key={banner.text} aria-live="polite">
          <strong>{banner.text}</strong>
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}
      {(waiting || notice) && (
        <div className="g-tank-maze-toasts" aria-live="polite">
          {notice && (
            <div className="g-tank-maze-banner g-tank-maze-toast" key={notice.id}>
              <strong>{notice.text}</strong>
              <span>{notice.sub}</span>
            </div>
          )}
          {waiting && (
            <div className="g-tank-maze-banner g-tank-maze-toast">
              <strong>Waiting for host</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Darken/lighten a hex color by percent. */
function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `#${(((f(n >> 16) & 0xff) << 16) | ((f((n >> 8) & 0xff)) << 8) | (f(n & 0xff))).toString(16).padStart(6, '0')}`;
}
