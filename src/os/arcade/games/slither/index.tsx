import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  GameShell, LEVEL_NAMES, Segmented, defineSetting, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell,
} from '../../kit';
import type { GameProps } from '../../types';
import { think } from './bots.ts';
import { meta } from './meta';
import {
  PACKET_LIMIT, endPacket, helloPacket, initPacket, movePacket, operationPackets, packetBytes, parsePacket,
  snapshotPackets, statePacket, type NetOp, type Packet, type RosterEntry, type SnakeState,
} from './net.ts';
import { overlayLayout, renderWorld, type Camera, type Particle } from './render.ts';
import {
  TICK, SKINS, addSnake, angleDiff, bodyGridFor, createSoloWorld, createWorld, maxTurnRate, spawnSnake, step,
  type Input, type Level, type World,
} from './world.ts';
import {
  applyHeadState, applyOps, loadSnapshot, makeRoster, ordinal, peopleLine, peopleResults, resultRows, rosterChanges, rosterNotice,
  startsSoloRound, syncRoster, frameUnit, touchTarget, winnerOf, winnerSeat, type PersonResult,
} from './session.ts';
import './slither.css';

const LEVEL = defineSetting('slither:level', LEVEL_NAMES, 'normal');
const SKIN = defineSetting('slither:skin', ['0', '1', '2', '3', '4', '5', '6', '7'] as const, '1');
const DURATION = defineSetting('slither:duration', ['2', '3', '5'] as const, '3');
const durationOptions = [['2', '2 Minutes'], ['3', '3 Minutes'], ['5', '5 Minutes']] as const;
const BOT_NAMES = ['Orzo', 'Penne', 'Fusilli', 'Udon', 'Ramen', 'Ziti', 'Soba', 'Rotini'];
const ARENA_RADIUS = 1700;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const angleTo = (x: number, y: number) => Math.atan2(y, x);
const displayTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell
      meta={meta}
      compact={compact}
      onExit={onExit}
      roomCode={roomCode}
      setup={<Setup />}
      hostSetup={<OnlineSetup />}
      botNames={BOT_NAMES}
      defaultBots={3}
      formatScore={(score) => `Length ${Math.floor(score)}`}
    >
      <Play />
    </GameShell>
  );
}

function useTargetSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(44);
  // The phone and iPad app-open animation scales the window up from its icon, so a size measured
  // mid-animation is far too big. Measure again whenever an animation, transition or resize settles.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let raf = 0;
    const read = () => {
      const field = root.querySelector<HTMLElement>('.arcade-seg');
      if (field) setSize(touchTarget(field.getBoundingClientRect().width, field.offsetWidth));
    };
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    const resize = new ResizeObserver(measure);
    resize.observe(root.closest('.arcade-shell') ?? root);
    window.addEventListener('resize', measure);
    window.addEventListener('animationend', measure, true);
    window.addEventListener('transitionend', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('animationend', measure, true);
      window.removeEventListener('transitionend', measure, true);
    };
  }, []);
  return { ref, style: { '--g-slither-target': `${size}px` } as CSSProperties };
}

/** Sets --g-slither-fu on the shell root: 1 / the phone or iPad frame scale, measured again once the app-open animation settles. */
function useFrameUnit() {
  const { root, touch } = useShell();
  useEffect(() => {
    const el = root.current;
    if (!el || !touch) return;
    let raf = 0;
    const read = () => el.style.setProperty('--g-slither-fu', frameUnit(el.getBoundingClientRect().width, el.offsetWidth).toFixed(3));
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('animationend', measure, true);
    window.addEventListener('transitionend', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('animationend', measure, true);
      window.removeEventListener('transitionend', measure, true);
      el.style.removeProperty('--g-slither-fu');
    };
  }, [root, touch]);
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  const [skin, setSkin] = useSetting(SKIN);
  const target = useTargetSize();
  return (
    <div className="g-slither-setup" ref={target.ref} style={target.style}>
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} className="g-slither-seg" />
      <div className="g-slither-setup-skins">
        <span>Skin</span>
        {SKINS.map((item, i) => (
          <button
            key={item.name}
            type="button"
            className="g-slither-swatch"
            style={{ '--skin': item.color, '--skin-light': item.light } as CSSProperties}
            aria-label={`${item.name} Skin`}
            aria-pressed={skin === String(i)}
            onClick={() => setSkin(String(i) as typeof skin)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [duration, setDuration] = useSetting(DURATION);
  const target = useTargetSize();
  if (!online?.isHost) return null;
  return (
    <div className="g-slither-setup" ref={target.ref} style={target.style}>
      <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} className="g-slither-seg" />
      <Segmented label="Round" value={duration} options={durationOptions} onChange={setDuration} className="g-slither-seg" />
    </div>
  );
}

type Hud = {
  length: number;
  peak: number;
  kills: number;
  rank: number;
  time: number;
  status: string;
  rows: { id: number; name: string; length: number; skin: number; rank: number }[];
  respawn: number | null;
};
type TouchPoint = { x: number; y: number; startX: number; startY: number };
type SnapshotBuffer = { total: number; parts: Map<number, unknown[][]> };
type RemoteSample = { receivedAt: number; tick: number; clock: number; snakes: SnakeState[] };

function interpolateStates(before: RemoteSample, after: RemoteSample, alpha: number): SnakeState[] {
  const previous = new Map(before.snakes.map((row) => [row[0], row]));
  return after.snakes.map((row): SnakeState => {
    const old = previous.get(row[0]);
    if (!old) return row;
    return [
      row[0],
      old[1] + (row[1] - old[1]) * alpha,
      old[2] + (row[2] - old[2]) * alpha,
      old[3] + angleDiff(row[3], old[3]) * alpha,
      old[4] + (row[4] - old[4]) * alpha,
      alpha < 0.5 ? old[5] : row[5],
      row[6],
      alpha < 0.5 ? old[7] : row[7],
      old[8] + (row[8] - old[8]) * alpha,
      old[9] + (row[9] - old[9]) * alpha,
      Math.max(old[10], row[10]),
    ] as SnakeState;
  });
}

function Play() {
  const shell = useShell();
  useFrameUnit();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [levelName] = useSetting(LEVEL);
  const [skinName] = useSetting(SKIN);
  const [durationName] = useSetting(DURATION);
  const { ref, size, ctx } = useCanvas<HTMLCanvasElement>();
  const worldRef = useRef<World | null>(null);
  const rosterRef = useRef<RosterEntry[]>([]);
  const seedRef = useRef(0);
  const roundRef = useRef(-1);
  const levelRef = useRef<Level>('normal');
  const boardLevelRef = useRef<Level>('normal');
  const durationRef = useRef(180);
  const accumulator = useRef(0);
  const remoteInputs = useRef(new Map<number, Input>());
  const botInputs = useRef(new Map<number, Input>());
  const receivedMoveSeq = useRef(new Map<number, number>());
  const opSeq = useRef(0);
  const sentMoveSeq = useRef(0);
  const receivedOpSeq = useRef(0);
  const snapshots = useRef(new Map<number, SnapshotBuffer>());
  const remoteSamples = useRef<RemoteSample[]>([]);
  const receivedStateTick = useRef(-1);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const input = useRef({ target: 0, boost: false, mode: 'pointer' as 'pointer' | 'keys' | 'joystick', lastTarget: 99, lastBoost: false });
  const boostHeld = useRef(false);
  const touches = useRef(new Map<number, TouchPoint>());
  const particles = useRef<Particle[]>([]);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 0.3, shake: 0 });
  const currentId = useRef(0);
  const ended = useRef(false);
  const away = useRef(false);
  const elapsedSend = useRef(0);
  const hudAt = useRef(0);
  const lastEatSfxAt = useRef(-1);
  const [hud, setHud] = useState<Hud>({ length: 10, peak: 10, kills: 0, rank: 1, time: 0, status: '', rows: [], respawn: null });
  const [boostPressed, setBoostPressed] = useState(false);
  const [stick, setStick] = useState<TouchPoint | null>(null);
  /** Joined while a round was under way: the host's round this player is in, and the room round the shell still shows. */
  const lateRef = useRef<{ round: number; lobbyRound: number } | null>(null);
  const lateEnded = useRef(new Set<number>());
  const [late, setLate] = useState(false);
  const [lateOver, setLateOver] = useState<{ title: string; people: PersonResult[] } | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [textScale, setTextScale] = useState(1);
  const roomPlayers = online?.players.map((p) => ({ seat: p.seat, name: p.name })) ?? [];
  const roomBots = online?.bots.map((b) => ({ seat: b.seat, name: b.name, bot: true })) ?? [];
  const rosterKey = JSON.stringify([roomPlayers, roomBots]);

  const currentRound = () => lateRef.current?.round ?? onlineRef.current?.round ?? 0;
  const showNotice = (text: string) => {
    if (text) setNotice({ text, at: performance.now() });
  };
  const leaveLate = () => {
    lateRef.current = null;
    setLate(false);
    setLateOver(null);
  };
  const sendToRoom = (value: Packet, to?: number, fast = false) => {
    if (packetBytes(value) > PACKET_LIMIT) return;
    onlineRef.current?.send(value, to === undefined ? (fast ? { fast: true } : undefined) : { to, fast });
  };
  const startOnlineHost = () => {
    const room = onlineRef.current;
    if (!room) return;
    const seed = (Date.now() ^ (room.round * 0x9e3779b9)) >>> 0;
    const roster = makeRoster(roomPlayers, roomBots, 16);
    const world = createWorld({ seed, radius: ARENA_RADIUS });
    for (const item of roster) addSnake(world, {
      id: item.id, name: item.name, seat: item.seat, bot: item.bot, eligible: item.eligible, skin: item.skin, color: item.color, respawnDelay: 3,
    });
    worldRef.current = world;
    rosterRef.current = roster;
    seedRef.current = seed;
    roundRef.current = room.round;
    levelRef.current = levelName;
    boardLevelRef.current = levelName;
    durationRef.current = Number(durationName) * 60;
    currentId.current = world.snakes.find((snake) => snake.seat === room.seat && !snake.bot)?.id ?? 0;
    input.current.target = world.snakes[currentId.current]?.angle ?? 0;
    input.current.boost = false;
    boostHeld.current = false;
    touches.current.clear();
    particles.current = [];
    remoteInputs.current.clear();
    botInputs.current.clear();
    receivedMoveSeq.current.clear();
    remoteSamples.current = [];
    receivedStateTick.current = -1;
    opSeq.current = receivedOpSeq.current = 0;
    accumulator.current = 0;
    ended.current = false;
    const info = initPacket(room.round, seed, ARENA_RADIUS, durationRef.current, levelRef.current, opSeq.current, roster);
    sendToRoom(info);
    for (const part of snapshotPackets(world, room.round, 1)) sendToRoom(part);
  };

  const previousStatus = useRef<typeof shell.status | null>(null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = shell.status;
    if (shell.status !== 'playing') return;
    const room = onlineRef.current;
    // Joined mid-round: the world already came from the host, and the room's next start begins a normal round.
    if (room && lateRef.current && room.round === lateRef.current.lobbyRound) return;
    if (lateRef.current) leaveLate();
    if (room) {
      if (room.isHost) startOnlineHost();
      else {
        worldRef.current = null;
        rosterRef.current = [];
        roundRef.current = room.round;
        currentId.current = -1;
        ended.current = false;
        remoteSamples.current = [];
        receivedStateTick.current = -1;
        sendToRoom(helloPacket(room.round));
      }
      return;
    }
    if (!startsSoloRound(previous, shell.status, !!worldRef.current && roundRef.current === -1)) return;
    const world = createSoloWorld((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0, Number(skinName));
    worldRef.current = world;
    roundRef.current = -1;
    levelRef.current = levelName;
    boardLevelRef.current = levelName;
    currentId.current = 0;
    accumulator.current = 0;
    ended.current = false;
    camera.current = { x: world.snakes[0].x, y: world.snakes[0].y, zoom: Math.min(size.w, size.h) / 900, shake: 0 };
    input.current.target = world.snakes[0].angle;
    input.current.boost = false;
    boostHeld.current = false;
    touches.current.clear();
    pointerPosition.current = null;
    setStick(null);
    particles.current = [];
    botInputs.current.clear();
  }, [shell.status, online?.round, online?.isHost, levelName, skinName, durationName]);

  useEffect(() => {
    const room = onlineRef.current;
    if (!room?.isHost || shell.status !== 'playing' || roundRef.current !== room.round || !worldRef.current) return;
    const next = syncRoster(rosterRef.current, roomPlayers, roomBots);
    const changed = next.some((entry, i) => {
      const old = rosterRef.current[i];
      return !old || entry.seat !== old.seat || entry.name !== old.name || entry.bot !== old.bot || entry.eligible !== old.eligible;
    });
    if (!changed) return;
    showNotice(rosterNotice(rosterChanges(rosterRef.current, next, room.seat)));
    rosterRef.current = next;
    const world = worldRef.current;
    for (const entry of next) {
      const snake = world.snakes.find((s) => s.id === entry.id);
      if (!snake) continue;
      const joined = snake.seat < 0 && entry.seat >= 0;
      snake.seat = entry.seat;
      snake.name = entry.name;
      snake.skin = entry.skin;
      snake.color = entry.color;
      snake.bot = entry.bot;
      snake.eligible = entry.eligible;
      if (joined) spawnSnake(world, snake);
    }
    sendToRoom(initPacket(room.round, seedRef.current, ARENA_RADIUS, durationRef.current, levelRef.current, opSeq.current, next));
    for (const part of snapshotPackets(world, room.round, world.tick + 1)) sendToRoom(part);
  }, [rosterKey, shell.status, online?.round, online?.isHost]);

  const finishOnline = (winner: number | null, _clock: number, ranking: [number, number, number, number][], seatOverride?: number | null) => {
    if (ended.current) return;
    ended.current = true;
    const room = onlineRef.current;
    const world = worldRef.current;
    if (!room || !world) return;
    const seat = seatOverride === undefined ? winnerSeat(world, winner) : seatOverride;
    const people = peopleResults(ranking, world.snakes, room.seat);
    const winningSnake = world.snakes.find((snake) => snake.id === winner);
    const title = seat === room.seat ? 'You Win' : winningSnake ? `${winningSnake.name} Wins` : 'Round Over';
    if (lateRef.current) {
      // Joined mid-round: wins count only for the people who started it, so this player shows the results and waits.
      lateEnded.current.add(lateRef.current.round);
      setLateOver({ title, people });
      return;
    }
    room.reportResult(room.round, seat);
    const ownResult = ranking.find((row) => row[0] === currentId.current);
    const place = ranking.findIndex((row) => row[0] === currentId.current) + 1;
    const length = Math.floor(ownResult?.[2] ?? world.snakes[currentId.current]?.peak ?? 0);
    const kills = ownResult?.[3] ?? world.snakes[currentId.current]?.kills ?? 0;
    shellRef.current.gameOver(undefined, {
      title,
      detail: `you finished ${ordinal(place || ranking.length)} of ${ranking.length} with length ${length}, ${kills} kills. ${peopleLine(people)}`.trim(),
    });
  };

  useEffect(() => {
    const room = onlineRef.current;
    if (!room) return;
    const off = room.onMessage((from, data) => {
      const msg = parsePacket(data);
      if (!msg) return;
      if (!room.isHost && from !== 0) return;
      // Still in the lobby while the host runs a round: this room takes people mid-round, so ask the host to sync us in.
      if (!room.isHost && !lateRef.current && shellRef.current.status === 'ready' && (msg.k === 'S' || msg.k === 'I')
        && msg.r > 0 && !lateEnded.current.has(msg.r)) {
        lateRef.current = { round: msg.r, lobbyRound: room.round };
        worldRef.current = null;
        rosterRef.current = [];
        roundRef.current = msg.r;
        currentId.current = -1;
        ended.current = false;
        remoteSamples.current = [];
        receivedStateTick.current = -1;
        sendToRoom(helloPacket(msg.r));
        if (msg.k === 'S') return;
      }
      if (msg.r !== currentRound()) return;
      if (room.isHost) {
        const world = worldRef.current;
        if (!world) return;
        if (msg.k === 'M') {
          const snake = world.snakes.find((s) => s.seat === from && !s.bot);
          if (!snake) return;
          const last = receivedMoveSeq.current.get(from) ?? -1;
          if (msg.seq <= last) return;
          receivedMoveSeq.current.set(from, msg.seq);
          remoteInputs.current.set(snake.id, { target: msg.target, boost: msg.boost });
        } else if ((msg.k === 'H' || msg.k === 'Q') && !ended.current) {
          sendToRoom(initPacket(room.round, seedRef.current, ARENA_RADIUS, durationRef.current, levelRef.current, opSeq.current, rosterRef.current), from);
          for (const part of snapshotPackets(world, room.round, world.tick + 1)) sendToRoom(part, from);
        }
        return;
      }
      if (msg.k === 'I') {
        if (rosterRef.current.length && roundRef.current === msg.r) showNotice(rosterNotice(rosterChanges(rosterRef.current, msg.roster, room.seat)));
        roundRef.current = msg.r;
        const world = createWorld({ seed: msg.seed, radius: msg.radius });
        for (const entry of msg.roster) addSnake(world, {
          id: entry.id, name: entry.name, seat: entry.seat, bot: entry.bot, eligible: entry.eligible,
          skin: entry.skin, color: entry.color, respawnDelay: 3,
        });
        worldRef.current = world;
        rosterRef.current = msg.roster;
        seedRef.current = msg.seed;
        durationRef.current = msg.duration;
        levelRef.current = msg.level;
        boardLevelRef.current = msg.level;
        currentId.current = world.snakes.find((snake) => snake.seat === room.seat && !snake.bot)?.id ?? -1;
        input.current.target = world.snakes[currentId.current]?.angle ?? 0;
        input.current.boost = false;
        receivedOpSeq.current = msg.seq;
        snapshots.current.clear();
        remoteSamples.current = [];
        receivedStateTick.current = -1;
        away.current = false;
        if (lateRef.current && currentId.current >= 0 && shellRef.current.status === 'ready') {
          setLate(true);
          setLateOver(null);
          camera.current = { x: world.snakes[currentId.current].x, y: world.snakes[currentId.current].y, zoom: camera.current.zoom, shake: 0 };
          shellRef.current.start();
        }
      } else if (msg.k === 'S') {
        const world = worldRef.current;
        if (!world) return;
        if (msg.tick <= receivedStateTick.current) return;
        receivedStateTick.current = msg.tick;
        remoteSamples.current.push({ receivedAt: performance.now(), tick: msg.tick, clock: msg.clock, snakes: msg.snakes });
        if (remoteSamples.current.length > 4) remoteSamples.current.shift();
      } else if (msg.k === 'O') {
        if (msg.seq <= receivedOpSeq.current) return;
        if (msg.seq !== receivedOpSeq.current + 1) {
          sendToRoom({ t: 'sl', r: currentRound(), k: 'Q' });
          return;
        }
        const world = worldRef.current;
        if (world) {
          for (const op of msg.ops) {
            if (op.k !== 'death') continue;
            const dead = world.snakes.find((snake) => snake.id === op.id);
            if (dead) {
              for (let i = 0; i < 18; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + Math.random() * 150;
                particles.current.push({
                  x: op.x, y: op.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                  life: 0.55 + Math.random() * 0.8, max: 1.35, color: SKINS[dead.skin].light, size: 3 + Math.random() * 5,
                });
              }
            }
            if (op.id === currentId.current) {
              sfx.play('lose');
              camera.current.shake = 5;
            } else if (op.killer === currentId.current) sfx.play('coin');
          }
          applyOps(world, msg.ops);
        }
        receivedOpSeq.current = msg.seq;
      } else if (msg.k === 'Z') {
        const buffer = snapshots.current.get(msg.snap) ?? { total: msg.total, parts: new Map<number, unknown[][]>() };
        if (buffer.total !== msg.total) return;
        buffer.parts.set(msg.part, msg.data);
        snapshots.current.set(msg.snap, buffer);
        if (buffer.parts.size === buffer.total && worldRef.current) {
          const all = Array.from({ length: buffer.total }, (_, i) => buffer.parts.get(i) ?? []).flat();
          loadSnapshot(worldRef.current, all);
          snapshots.current.clear();
        }
      } else if (msg.k === 'P') {
        away.current = msg.away;
      } else if (msg.k === 'E') {
        finishOnline(msg.winner, msg.clock, msg.ranking, msg.seat);
      }
    });
    return off;
  }, [online?.round, online?.isHost, online?.seat]);

  // The host left mid-round: the round they ran is over for someone who joined it late as well.
  const handoffsSeen = useRef(online?.handoffs ?? 0);
  useEffect(() => {
    const handoffs = online?.handoffs ?? 0;
    if (handoffs === handoffsSeen.current) return;
    handoffsSeen.current = handoffs;
    const lateRound = lateRef.current;
    if (!lateRound || ended.current) return;
    ended.current = true;
    lateEnded.current.add(lateRound.round);
    setLateOver({ title: 'Host Left', people: [] });
  }, [online?.handoffs]);
  useEffect(() => {
    if (!online && lateRef.current) leaveLate();
  }, [online]);

  // A late joiner plays in the shell's lobby state, so its Pause, Restart and Esc stay off like in any online round.
  useEffect(() => {
    const root = shell.root.current;
    if (!root || !late) return;
    root.classList.add('g-slither-late');
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' && event.code !== 'KeyP') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    root.addEventListener('keydown', onKey, true);
    return () => {
      root.classList.remove('g-slither-late');
      root.removeEventListener('keydown', onKey, true);
    };
  }, [late, shell.root]);
  useEffect(() => {
    if (late && shell.status === 'paused' && shell.active) shell.resume();
  }, [late, shell.status, shell.active]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice((n) => (n === notice ? null : n)), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Framed phones and iPads scale the whole screen down; keep HUD text at least 11px on screen.
  useLayoutEffect(() => {
    const root = shell.root.current;
    if (!root || !shell.touch) {
      setTextScale(1);
      return;
    }
    const rendered = root.getBoundingClientRect().width;
    const scale = root.offsetWidth > 0 && rendered > 0 ? rendered / root.offsetWidth : 1;
    setTextScale(scale < 0.99 ? Math.min(1.6, 1 / scale) : 1);
  }, [size.w, size.h, shell.touch, shell.root]);
  const textScaleRef = useRef(textScale);
  textScaleRef.current = textScale;

  useEffect(() => {
    if (!online?.isHost || shell.status !== 'playing') return;
    const visibility = () => {
      const next = document.hidden;
      if (away.current === next) return;
      away.current = next;
      sendToRoom({ t: 'sl', r: online.round, k: 'P', away: next });
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [online?.isHost, online?.round, shell.status]);

  const updateTargetFromPoint = (x: number, y: number) => {
    pointerPosition.current = { x, y };
    input.current.mode = 'pointer';
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = event.nativeEvent;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      const touch = { x, y, startX: x, startY: y };
      touches.current.set(event.pointerId, touch);
      setStick(touch);
      input.current.mode = 'joystick';
      input.current.boost = false;
    } else if (event.button === 0) {
      updateTargetFromPoint(x, y);
      input.current.boost = true;
      boostHeld.current = true;
      setBoostPressed(true);
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = event.nativeEvent;
    const touch = touches.current.get(event.pointerId);
    if (touch) {
      touch.x = x;
      touch.y = y;
      setStick({ ...touch });
      const dx = x - touch.startX;
      const dy = y - touch.startY;
      if (Math.hypot(dx, dy) > 6) {
        input.current.target = angleTo(dx, dy);
        input.current.mode = 'joystick';
      }
    } else if (event.pointerType !== 'touch') updateTargetFromPoint(x, y);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (touches.current.has(event.pointerId)) {
      touches.current.delete(event.pointerId);
      const activeTouches = [...touches.current.values()];
      setStick(activeTouches[activeTouches.length - 1] ?? null);
      input.current.mode = pointerPosition.current ? 'pointer' : 'keys';
    } else {
      input.current.boost = false;
      boostHeld.current = false;
      setBoostPressed(false);
    }
  };
  const buttonDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    input.current.boost = true;
    boostHeld.current = true;
    setBoostPressed(true);
  };
  const buttonUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    input.current.boost = false;
    boostHeld.current = false;
    setBoostPressed(false);
  };

  useGameLoop((dt) => {
    const world = worldRef.current;
    const room = onlineRef.current;
    if (!world || ended.current) return;
    const host = !room || room.isHost;
    const me = world.snakes.find((snake) => snake.id === currentId.current);
    const turn = keys.axis('left', 'right');
    if (turn !== 0) {
      input.current.target += turn * maxTurnRate(me ?? world.snakes[0]) * dt * 1.8;
      input.current.target = Math.atan2(Math.sin(input.current.target), Math.cos(input.current.target));
      input.current.mode = 'keys';
    } else if (input.current.mode === 'keys' && pointerPosition.current) input.current.mode = 'pointer';
    if (input.current.mode === 'pointer' && pointerPosition.current && me?.alive) {
      const headX = size.w / 2 + (me.x - camera.current.x) * camera.current.zoom;
      const headY = size.h / 2 + (me.y - camera.current.y) * camera.current.zoom;
      input.current.target = angleTo(pointerPosition.current.x - headX, pointerPosition.current.y - headY);
    }
    input.current.boost = keys.down('action', 'up', 'ShiftLeft', 'ShiftRight') || boostHeld.current;

    if (host) {
      accumulator.current = Math.min(TICK * 6, accumulator.current + dt);
      while (accumulator.current >= TICK) {
        const bodyGrid = bodyGridFor(world);
        const inputs = new Map<number, Input>();
        for (const snake of world.snakes) {
          if (!snake.alive) continue;
          if (snake.id === currentId.current) {
            inputs.set(snake.id, { target: input.current.target, boost: input.current.boost });
          } else if (snake.bot) {
            snake.reaction -= TICK;
            if (snake.reaction <= 0) {
              const thought = think(world, snake, levelRef.current, bodyGrid, world.random);
              inputs.set(snake.id, thought);
              botInputs.current.set(snake.id, thought);
              snake.reaction = levelRef.current === 'hard' ? 0.1 : levelRef.current === 'normal' ? 0.19 : 0.35;
            } else inputs.set(snake.id, botInputs.current.get(snake.id) ?? { target: snake.angle, boost: false });
          } else {
            inputs.set(snake.id, remoteInputs.current.get(snake.id) ?? { target: snake.angle, boost: false });
          }
        }
        const events = step(world, inputs, bodyGrid);
        for (const event of events) {
          if (event.type === 'eat' && event.id === currentId.current && world.clock - lastEatSfxAt.current >= 0.1) {
            sfx.tone({ freq: 500, to: 850, dur: 0.055, type: 'sine', vol: 0.09 });
            lastEatSfxAt.current = world.clock;
          }
          if (event.type === 'death') {
            const dead = world.snakes.find((snake) => snake.id === event.id);
            if (dead) {
              for (let i = 0; i < 18; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + Math.random() * 150;
                particles.current.push({
                  x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                  life: 0.55 + Math.random() * 0.8, max: 1.35, color: SKINS[dead.skin].light, size: 3 + Math.random() * 5,
                });
              }
              if (event.id === currentId.current) {
                sfx.play('lose');
                camera.current.shake = 5;
              } else if (event.killer === currentId.current) sfx.play('coin');
            }
          }
        }
        if (room?.isHost) {
          const ops: NetOp[] = [];
          for (const event of events) {
            if (event.type === 'pellet') ops.push({ k: 'add', pellet: event.pellet });
            if (event.type === 'remove') ops.push({ k: 'remove', id: event.pellet });
            if (event.type === 'death') ops.push({ k: 'death', id: event.id, killer: event.killer, mass: event.mass, x: event.x, y: event.y });
            if (event.type === 'spawn') ops.push({ k: 'spawn', id: event.id, x: event.x, y: event.y, angle: event.angle });
          }
          const packets = operationPackets(room.round, opSeq.current + 1, ops);
          for (const p of packets) sendToRoom(p);
          opSeq.current += packets.length;
        }
        accumulator.current -= TICK;
      }
      if (room?.isHost) {
        elapsedSend.current += dt;
        if (elapsedSend.current >= 1 / 12) {
          elapsedSend.current = 0;
          sendToRoom(statePacket(room.round, world), undefined, true);
        }
        if (world.clock >= durationRef.current) {
          const winner = winnerOf(world);
          const ranking = resultRows(world);
          const seat = winnerSeat(world, winner);
          const end = endPacket(room.round, winner, seat, world.clock, ranking);
          sendToRoom(end);
          finishOnline(winner, world.clock, ranking);
        }
      }
    } else {
      elapsedSend.current += dt;
      if (elapsedSend.current >= 0.08 && currentId.current >= 0) {
        elapsedSend.current = 0;
        const target = input.current.target;
        const changed = Math.abs(angleDiff(target, input.current.lastTarget)) > 0.04 || input.current.boost !== input.current.lastBoost;
        if (changed || world.tick % 3 === 0) {
          input.current.lastTarget = target;
          input.current.lastBoost = input.current.boost;
          sendToRoom(movePacket(currentRound(), ++sentMoveSeq.current, target, input.current.boost), undefined, true);
        }
      }
    }

    if (!host && room && remoteSamples.current.length) {
      const samples = remoteSamples.current;
      const renderAt = performance.now() - 1000 / 12;
      let before = samples[0];
      let after = samples[samples.length - 1];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].receivedAt >= renderAt) {
          before = samples[i - 1];
          after = samples[i];
          break;
        }
      }
      const span = after.receivedAt - before.receivedAt;
      const alpha = before === after ? 1 : clamp((renderAt - before.receivedAt) / Math.max(1, span), 0, 1);
      world.clock = before.clock + (after.clock - before.clock) * alpha;
      world.tick = Math.floor(before.tick + (after.tick - before.tick) * alpha);
      applyHeadState(world, interpolateStates(before, after, alpha));
    }

    for (const particle of particles.current) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 1.8);
      particle.vy *= Math.max(0, 1 - dt * 1.8);
    }
    particles.current = particles.current.filter((particle) => particle.life > 0);
    const current = world.snakes.find((snake) => snake.id === currentId.current);
    const follower = current?.alive ? current : world.snakes.filter((snake) => snake.alive).sort((a, b) => b.mass - a.mass)[0];
    if (follower) {
      const desiredZoom = Math.min(size.w, size.h) / 900 * clamp(1 - Math.sqrt(Math.max(0, follower.mass - 10)) * 0.012, 0.62, 1);
      camera.current.x += (follower.x - camera.current.x) * Math.min(1, dt * 5);
      camera.current.y += (follower.y - camera.current.y) * Math.min(1, dt * 5);
      camera.current.zoom += (desiredZoom - camera.current.zoom) * Math.min(1, dt * 2.5);
    }
    camera.current.shake = Math.max(0, camera.current.shake - dt * 30);

    if (!room && current && !current.alive && !ended.current) {
      ended.current = true;
      const peakOrder = world.snakes.slice().sort((a, b) => b.peak - a.peak || b.kills - a.kills || a.id - b.id);
      const rank = Math.max(1, peakOrder.findIndex((snake) => snake.id === current.id) + 1);
      const deathOrder = world.snakes.slice().sort((a, b) => b.mass - a.mass || b.kills - a.kills || a.id - b.id);
      const deathRank = deathOrder.findIndex((snake) => snake.id === current.id) + 1;
      const score = Math.floor(current.peak);
      shellRef.current.setScore(score);
      shellRef.current.gameOver(score, {
        title: deathRank === 1 ? 'Top Noodle' : 'You Burst',
        detail: `length ${score}, ${ordinal(rank)} of ${world.snakes.length} at your best, ${current.kills} kills.`,
        board: boardLevelRef.current,
      });
    }
    hudAt.current -= dt;
    if (hudAt.current <= 0) {
      hudAt.current = 0.12;
      const currentSnake = world.snakes.find((snake) => snake.id === currentId.current);
      const order = world.snakes.filter((snake) => snake.alive).sort((a, b) => b.mass - a.mass || b.kills - a.kills || a.id - b.id);
      const rank = Math.max(1, order.findIndex((snake) => snake.id === currentId.current) + 1);
      const layout = overlayLayout(size, textScaleRef.current);
      const topCount = size.h >= 400 ? 10 : Math.min(5, layout.maxBoardRows);
      const rows = order.slice(0, topCount).map((snake, i) => ({
        id: snake.id, name: snake.name, length: snake.mass, skin: snake.skin, rank: i + 1,
      }));
      if (size.h < 400 && currentSnake?.alive && rank > topCount) {
        if (rows.length >= layout.maxBoardRows) rows.pop();
        rows.push({ id: currentSnake.id, name: currentSnake.name, length: currentSnake.mass, skin: currentSnake.skin, rank });
      }
      const timeLeft = room ? Math.max(0, durationRef.current - world.clock) : world.clock;
      const status = away.current ? 'Host Away' : !currentSnake?.alive && room ? 'Spectating' : currentSnake?.respawnAt
        ? `Back in ${Math.ceil(currentSnake.respawnAt - world.clock)}` : '';
      setHud({
        length: currentSnake?.mass ?? 0,
        peak: currentSnake?.peak ?? 0,
        kills: currentSnake?.kills ?? 0,
        rank,
        time: timeLeft,
        status,
        rows,
        respawn: currentSnake?.respawnAt && room ? Math.max(0, currentSnake.respawnAt - world.clock) : null,
      });
      if (!room && currentSnake) shellRef.current.setScore(Math.floor(currentSnake.peak));
    }
  }, () => {
    const context = ctx();
    const world = worldRef.current;
    if (!context || !world) return;
    renderWorld(context, size, world, camera.current, currentId.current, particles.current);
  });

  const isOnline = !!online;
  const current = worldRef.current?.snakes.find((snake) => snake.id === currentId.current);
  const dead = !!current && !current.alive;
  const stickOffset = stick ? (() => {
    const dx = stick.x - stick.startX;
    const dy = stick.y - stick.startY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > 27 ? 27 / distance : 1;
    return { x: dx * scale, y: dy * scale };
  })() : null;
  return (
    <div className={`g-slither-stage${size.h <= 190 ? ' is-compact' : ''}`} style={{ '--g-slither-u': textScale } as CSSProperties}>
      <canvas
        ref={ref}
        className="g-slither-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="g-slither-hud">
        <div className="g-slither-score"><span>Length</span><strong>{Math.floor(hud.length)}</strong></div>
        <div className="g-slither-clock">{displayTime(isOnline ? hud.time : hud.time)}</div>
        {hud.status && <div className="g-slither-status">{hud.status}</div>}
      </div>
      <div className="g-slither-board">
        <div className="g-slither-board-title">Top 10</div>
        {hud.rows.map((row) => (
          <div key={row.id} className={`g-slither-board-row${row.id === currentId.current ? ' is-me' : ''}`}>
            <span className="g-slither-board-dot" style={{ background: SKINS[row.skin].color }} />
            <span className="g-slither-board-name">{row.rank}. {row.name}</span>
            <span className="g-slither-board-length">{Math.floor(row.length)}</span>
          </div>
        ))}
      </div>
      {shell.touch && stick && stickOffset && (
        <div className="g-slither-stick" style={{ left: stick.startX, top: stick.startY } as CSSProperties}>
          <div className="g-slither-stick-knob" style={{ '--stick-x': `${stickOffset.x}px`, '--stick-y': `${stickOffset.y}px` } as CSSProperties} />
        </div>
      )}
      {notice && <div className="g-slither-notice" role="status">{notice.text}</div>}
      {lateOver && (
        <div className="g-slither-results" role="dialog" aria-label={lateOver.title}>
          <h3>{lateOver.title}</h3>
          {lateOver.people.length > 0 && (
            <ol>
              {lateOver.people.map((person) => (
                <li key={person.seat} className={person.me ? 'is-me' : undefined}>
                  <span>{ordinal(person.place)}</span>
                  <span>{person.me ? 'You' : person.name}</span>
                  <span>{person.length}</span>
                </li>
              ))}
            </ol>
          )}
          <p>{lateOver.title === 'Host Left' ? 'The New Host Can Start the Next Round.' : 'Waiting For the Host to Start the Next Round.'}</p>
        </div>
      )}
      {dead && isOnline && !lateOver && <div className="g-slither-respawn">{hud.respawn !== null ? `Back in ${Math.ceil(hud.respawn)}` : 'Watching the field'}</div>}
      {shell.touch && shell.status === 'playing' && (
        <button
          type="button"
          className={`g-slither-boost${boostPressed ? ' is-pressed' : ''}`}
          aria-label="Boost"
          onPointerDown={buttonDown}
          onPointerUp={buttonUp}
          onPointerCancel={buttonUp}
          onLostPointerCapture={buttonUp}
        >
          Boost
        </button>
      )}
    </div>
  );
}
