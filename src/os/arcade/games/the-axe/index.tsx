import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { assignTeams, createWorld, movePlayer, soloRoster, step, takeoverDeparted, type GameEvent, type Input, type Level, type Mode, type Player, type PlayerConfig, type World } from './logic.ts';
import { makeMemory, think, type BotMemory } from './bots.ts';
import { endPacket, eventsFromNet, eventsToNet, inputPacket, parsePacket, startPacket, statePacket, unpackPlayer, type EndPacket, type NetEvent, type StatePacket, type StartPacket } from './net.ts';
import { createFx, drawGame, fxEvents, fxStep, makeView, screenToField, type Fx, type View } from './render.ts';
import { meta } from './meta';
import './the-axe.css';

type LevelName = (typeof LEVEL_NAMES)[number];
type PlayMode = 'cpu' | '2p';
type StageMode = 'idle' | 'solo' | 'online';
type Stick = { pointer: number; player: number; ox: number; oy: number; x: number; y: number };
type Snapshot = { at: number; players: Player[] };

const MODE = defineSetting<Mode>('the-axe:mode', ['classic', 'big', 'tree'], 'classic');
const PLAY = defineSetting<PlayMode>('the-axe:play', ['cpu', '2p'], 'cpu');
const SIZE = defineSetting('the-axe:size', ['1', '2', '3', '4', '5'] as const, '3');
const LEVEL = defineSetting<LevelName>('the-axe:level', LEVEL_NAMES, 'normal');
const BOT_NAMES = ['palm', 'quad', 'bixby', 'scout', 'pepper', 'rally', 'sprout', 'nugget', 'zip', 'mocha'] as const;
const modeOptions = [['classic', 'classic'], ['big', 'big game'], ['tree', 'tree tag']] as const;
const playOptions = [['cpu', 'vs bots'], ['2p', '2 players']] as const;
const sizeOptions = [['1', '1v1'], ['2', '2v2'], ['3', '3v3'], ['4', '4v4'], ['5', '5v5']] as const;
const levelOf = (level: LevelName): Level => level === 'easy' ? 0 : level === 'hard' ? 2 : 1;
const nameForMode = (mode: Mode) => mode === 'big' ? 'big game' : mode === 'tree' ? 'tree tag' : 'classic';
const emptyInput = (): Input => ({ x: 0, y: 0, sprint: false });

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
      defaultBots={7}
      quickNote="quick play uses classic 5v5 with bots."
    >
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [play, setPlay] = useSetting(PLAY);
  const [size, setSize] = useSetting(SIZE);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Play" value={play} options={playOptions} onChange={setPlay} />
      <Segmented label="Team size" value={size} options={sizeOptions} onChange={setSize} />
      <Segmented label="Bot level" value={level} options={levelOptions} onChange={setLevel} />
    </>
  );
}

function roomEntries(online: NonNullable<ReturnType<typeof useOnline>>, fillQuick = false) {
  const bySeat = new Map<number, { name: string; bot: boolean }>();
  for (const player of online.players) bySeat.set(player.seat, { name: player.name.toLowerCase(), bot: false });
  for (const bot of online.bots) bySeat.set(bot.seat, { name: bot.name.toLowerCase(), bot: true });
  if (fillQuick) {
    for (let seat = 0; seat < 10; seat++) {
      if (!bySeat.has(seat)) bySeat.set(seat, { name: BOT_NAMES[seat % BOT_NAMES.length], bot: true });
    }
  }
  return [...bySeat.entries()].sort(([a], [b]) => a - b).slice(0, 10);
}

function configsForRoom(online: NonNullable<ReturnType<typeof useOnline>>, level: Level): PlayerConfig[] {
  const entries = roomEntries(online, online.quick);
  const teams = assignTeams(entries.map(([seat, entry]) => ({ seat, bot: entry.bot })));
  return entries.map(([seat, entry]) => ({
    seat,
    team: teams.get(seat) ?? 0,
    name: entry.name,
    ai: entry.bot ? level : null,
  }));
}

function OnlineSetup() {
  const online = useOnline();
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [hostPick, setHostPick] = useState<{ mode: Mode; level: LevelName } | null>(null);
  useEffect(() => {
    if (!online?.isHost) return;
    const send = () => {
      const chosenMode = online.quick ? 'classic' : mode;
      const roster = configsForRoom(online, levelOf(level));
      online.send(startPacket(online.round, chosenMode, (online.round * 2_654_435_761) >>> 0, levelOf(level), roster.map((p) => ({
        seat: p.seat, team: p.team, ai: p.ai !== null,
      }))));
    };
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [online, mode, level]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, data) => {
      const packet = parsePacket(data);
      if (from !== 0 || packet?.k !== 'start' || packet.r !== online.round) return;
      const pickedLevel = packet.lv === 0 ? 'easy' : packet.lv === 2 ? 'hard' : 'normal';
      setHostPick({ mode: packet.mode, level: pickedLevel });
    });
  }, [online]);
  if (!online) return null;
  if (online.isHost) {
    return (
      <>
        {online.quick
          ? <div className="arcade-field"><span>mode</span><div className="g-the-axe-hostpick"><b>classic</b><small>quick play</small></div></div>
          : <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />}
        <Segmented label="Bot level" value={level} options={levelOptions} onChange={setLevel} />
      </>
    );
  }
  return (
    <div className="arcade-field">
      <span>host picks</span>
      <div className="g-the-axe-hostpick">
        <b>{hostPick ? `${nameForMode(hostPick.mode)} · ${hostPick.level}` : 'waiting for host'}</b>
        <small>mode and bot level</small>
      </div>
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const [mode] = useSetting(MODE);
  const [play] = useSetting(PLAY);
  const [size] = useSetting(SIZE);
  const [level] = useSetting(LEVEL);
  const stage = useRef<{ key: string; mode: StageMode }>({ key: '', mode: 'idle' });
  if (shell.status === 'ready') {
    stage.current = { key: `idle:${mode}:${play}:${size}:${level}`, mode: 'idle' };
  } else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== stage.current.key) stage.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={stage.current.key} mode={stage.current.mode} />;
}

function worldForRoom(online: NonNullable<ReturnType<typeof useOnline>>, mode: Mode, level: Level, previous?: World | null) {
  const configs = configsForRoom(online, level);
  if (previous) {
    const oldNames = new Map(previous.players.map((p) => [p.seat, p.name]));
    for (const config of configs) if (oldNames.has(config.seat)) config.name = oldNames.get(config.seat)!;
  }
  const seed = (online.round * 2_654_435_761) >>> 0;
  return createWorld(configs, online.quick ? 'classic' : mode, seed);
}

function configsFromStart(packet: StartPacket, online: NonNullable<ReturnType<typeof useOnline>>, previous: World | null): PlayerConfig[] {
  const names = new Map<number, string>();
  for (const player of online.players) names.set(player.seat, player.name.toLowerCase());
  for (const bot of online.bots) names.set(bot.seat, bot.name.toLowerCase());
  const oldNames = new Map(previous?.players.map((p) => [p.seat, p.name]) ?? []);
  return packet.roster.map(([seat, team, ai]) => ({
    seat, team: team as 0 | 1,
    name: oldNames.get(seat) ?? names.get(seat) ?? BOT_NAMES[seat % BOT_NAMES.length],
    ai: ai ? packet.lv as Level : null,
  }));
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const keys = useKeys();
  const online = useOnline();
  const { ref, size, ctx } = useCanvas<HTMLCanvasElement>();
  const [playMode] = useSetting(PLAY);
  const [teamSize] = useSetting(SIZE);
  const [levelName] = useSetting(LEVEL);
  const level = levelOf(levelName);
  const onlineGame = mode === 'online' && !!online;
  const modeSetting = useSetting(MODE)[0];
  const selectedMode = onlineGame && online?.quick ? 'classic' : modeSetting;
  const worldRef = useRef<World | null>(null);
  if (!worldRef.current) {
    worldRef.current = onlineGame && online
      ? worldForRoom(online, selectedMode, level)
      : createWorld(soloRoster(Number(teamSize), level, playMode === '2p', BOT_NAMES), selectedMode, (Date.now() >>> 0));
  }
  const world = worldRef.current;
  const shellRef = useRef(shell);
  const onlineRef = useRef(online);
  shellRef.current = shell;
  onlineRef.current = online;
  const levelRef = useRef<Level>(level);
  levelRef.current = level;
  const fx = useRef<Fx | null>(null);
  fx.current ??= createFx();
  const viewRef = useRef<View | null>(null);
  const memories = useRef<BotMemory[]>(world.players.map(() => makeMemory()));
  const synced = useRef(!onlineGame || online?.isHost === true);
  const hadAuthority = useRef(onlineGame && online?.isHost === true);
  const lastHandoff = useRef(online?.handoffs ?? 0);
  const reported = useRef(false);
  const endMessage = useRef<EndPacket | null>(null);
  const endSends = useRef(0);
  const remoteInput = useRef(new Map<number, Input>());
  const remoteSeq = useRef(new Map<number, number>());
  const snapshots = useRef<Snapshot[]>([]);
  const eventLog = useRef<{ at: number; row: NetEvent }[]>([]);
  const eventId = useRef(0);
  const seenEventIds = useRef(new Set<number>());
  const inputSeq = useRef(0);
  const lastSprint = useRef<boolean | null>(null);
  const latestInput = useRef<Input>(emptyInput());
  const lastSimWall = useRef(performance.now() / 1000);
  const tick = useRef(0);
  const stateSendCount = useRef(0);
  const lastStateTick = useRef(-1);
  const phaseCount = useRef(4);
  const touchPointers = useRef(new Map<number, Stick>());
  const sprintPointers = useRef(new Map<number, number>());
  const [, setSticks] = useState<Stick[]>([]);
  const [toast, setToast] = useState('');
  const toastT = useRef(0);
  const updateDt = useRef(0);

  const myId = () => onlineGame
    ? worldRef.current?.players.find((p) => p.seat === onlineRef.current?.seat)?.id ?? -1
    : 0;
  const nameOf = (id: number) => worldRef.current?.players[id]?.name ?? `player ${id + 1}`;
  const localTwoPlayer = !onlineGame && mode !== 'idle' && playMode === '2p';

  useEffect(() => {
    shell.setScore(null);
  }, [shell]);

  useEffect(() => {
    const root = shell.root.current;
    if (!root || !shell.touch) return;
    const measure = () => {
      const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
      root.style.setProperty('--g-the-axe-u', String(scale > 0.2 && scale < 0.99 ? Math.min(2, Math.ceil(100 / scale) / 100) : 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--g-the-axe-u');
    };
  }, [shell.root, shell.touch]);

  useEffect(() => {
    const blur = () => {
      touchPointers.current.clear();
      sprintPointers.current.clear();
      setSticks([]);
      lastSprint.current = null;
    };
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      touchPointers.current.clear();
      sprintPointers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!onlineGame || !online) return;
    if (online.handoffs !== lastHandoff.current) {
      lastHandoff.current = online.handoffs;
      if (online.isHost && !hadAuthority.current && !reported.current) {
        reported.current = true;
        const current = worldRef.current!;
        current.phase = 'over';
        shellRef.current.gameOver(undefined, { title: 'the host left, round over', detail: 'this round cannot continue.' });
        online.reportResult(online.round, null);
      }
    }
    if (online.isHost) hadAuthority.current = true;
  }, [onlineGame, online?.handoffs, online?.isHost, online?.round]);

  useEffect(() => {
    if (!onlineGame || !online) return;
    return online.onMessage((from, data) => {
      const packet = parsePacket(data);
      if (!packet || packet.r !== online.round) return;
      if (online.isHost) {
        if (packet.k !== 'i') return;
        const player = worldRef.current?.players.find((p) => p.seat === from);
        if (!player || player.ai !== null || packet.q <= (remoteSeq.current.get(from) ?? -1)) return;
        remoteSeq.current.set(from, packet.q);
        remoteInput.current.set(from, { x: packet.x / 100, y: packet.y / 100, sprint: packet.s });
        return;
      }
      if (from !== 0) return;
      if (packet.k === 'start') {
        if (!online.watching && !packet.roster.some(([seat]) => seat === online.seat)) {
          synced.current = false;
          setToast('round in progress. next round.');
          toastT.current = 3;
          return;
        }
        levelRef.current = packet.lv as Level;
        const current = worldRef.current;
        const rosterChanged = !current || packet.roster.length !== current.players.length
          || packet.roster.some(([seat, team, ai], index) => {
            const player = current.players[index];
            return !player || player.seat !== seat || player.team !== team || (player.ai !== null) !== (ai === 1);
          });
        if (!synced.current || !current || current.seed !== packet.seed || current.mode !== packet.mode || rosterChanged) {
          const configs = configsFromStart(packet, online, current);
          const next = createWorld(configs, packet.mode, packet.seed);
          worldRef.current = next;
          memories.current = next.players.map(() => makeMemory());
          lastStateTick.current = -1;
          snapshots.current = [];
        } else {
          const bySeat = new Map(packet.roster.map(([seat, team, ai]) => [seat, { team: team as 0 | 1, ai }]));
          const names = new Map(online.players.map((player) => [player.seat, player.name.toLowerCase()]));
          for (const player of current.players) {
            const entry = bySeat.get(player.seat);
            if (entry) {
              player.team = entry.team;
              player.ai = entry.ai ? packet.lv as Level : null;
              player.name = names.get(player.seat) ?? player.name;
            }
          }
        }
        synced.current = true;
        shellRef.current.invalidate();
      } else if (packet.k === 'S' && synced.current) {
        applyState(packet);
      } else if (packet.k === 'end') {
        const current = worldRef.current!;
        current.phase = 'over';
        current.score = [...packet.sc];
        current.winner = packet.w < 0 ? null : packet.w as 0 | 1;
        current.winnerId = packet.wid;
        finishGame(packet.w < 0 ? null : packet.w as 0 | 1, packet.wid, packet.win, false);
      }
    });
  }, [onlineGame, online?.round, online?.isHost, online?.seat, online?.watching]);

  function applyState(packet: StatePacket) {
    const current = worldRef.current;
    if (!current || packet.n < lastStateTick.current || packet.p.length !== current.players.length) return;
    lastStateTick.current = packet.n;
    const ownId = onlineRef.current?.watching ? -1 : myId();
    const parsed = packet.p.map((row) => unpackPlayer(row)!);
    for (let i = 0; i < current.players.length; i++) {
      const p = current.players[i];
      const next = parsed[i];
      const oldX = p.x;
      const oldY = p.y;
      p.x = i === ownId ? (Math.hypot(next.x - oldX, next.y - oldY) > 2.5 ? next.x : oldX + (next.x - oldX) * 0.25) : next.x;
      p.y = i === ownId ? (Math.hypot(next.x - oldX, next.y - oldY) > 2.5 ? next.y : oldY + (next.y - oldY) * 0.25) : next.y;
      p.vx = next.vx; p.vy = next.vy; p.face = next.face; p.stamina = next.stamina;
      p.jailed = next.jailed; p.safe = next.safe; p.immuneT = next.immune ? 0.5 : 0;
      p.stunT = next.stunned ? 0.5 : 0; p.boostT = next.boost ? 0.5 : 0;
      p.sprinting = next.sprinting; p.ai = next.ai ? levelRef.current : null;
    }
    snapshots.current.push({ at: performance.now(), players: current.players.map((p) => ({ ...p })) });
    if (snapshots.current.length > 3) snapshots.current.splice(0, snapshots.current.length - 3);
    current.phase = packet.ph; current.phaseT = packet.pt / 100; current.clock = packet.ck / 100;
    current.overtime = packet.ot === 1; current.score = [...packet.sc]; current.tree = packet.tr;
    current.treeScore = packet.ts.map((score) => score / 10);
    const homes = current.mode === 'classic' ? [[3, 17], [57, 17]] : [[30, 17]];
    current.axes = packet.ax.map(([x, y, carrier], index) => ({
      owner: current.mode === 'classic' ? index as 0 | 1 : -1,
      homeX: homes[index]?.[0] ?? 30, homeY: homes[index]?.[1] ?? 17,
      x: x / 100, y: y / 100, carrier,
    }));
    for (const player of current.players) player.carrying = -1;
    current.axes.forEach((axe, index) => {
      if (axe.carrier >= 0 && current.players[axe.carrier]) current.players[axe.carrier].carrying = index;
    });
    current.pickups = packet.pk.map(([id, kind, x, y]) => ({
      id, kind: kind === 0 ? 'drum' : 'costume', x: x / 100, y: y / 100,
    }));
    current.time = packet.n / 60;
    const fresh = packet.ev.filter(([id]) => !seenEventIds.current.has(id));
    for (const [id] of fresh) seenEventIds.current.add(id);
    if (seenEventIds.current.size > 300) {
      const keep = [...seenEventIds.current].sort((a, b) => b - a).slice(0, 150);
      seenEventIds.current = new Set(keep);
    }
    if (fresh.length) handleEvents(eventsFromNet(fresh), current);
  }

  function readInput(playerId: number): Input {
    if (playerId < 0) return emptyInput();
    const current = worldRef.current!;
    const player = current.players[playerId];
    if (!player) return emptyInput();
    const touch = [...touchPointers.current.values()].find((stick) => stick.player === playerId);
    let x = 0;
    let y = 0;
    if (touch) {
      const dx = touch.x - touch.ox;
      const dy = touch.y - touch.oy;
      const distance = Math.hypot(dx, dy);
      const view = viewRef.current ?? makeView(size.w, size.h, 50);
      const field = screenToField(view, dx, dy);
      const length = Math.hypot(field.x, field.y);
      const amount = distance < 8 ? 0 : Math.min(1, distance / 48);
      x = length ? field.x / length * amount : 0;
      y = length ? field.y / length * amount : 0;
    } else {
      const p2 = localTwoPlayer && playerId === 1;
      const screenX = p2
        ? (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0)
        : (keys.down('KeyD', 'ArrowRight') ? 1 : 0) - (keys.down('KeyA', 'ArrowLeft') ? 1 : 0);
      const screenY = p2
        ? (keys.down('ArrowDown') ? 1 : 0) - (keys.down('ArrowUp') ? 1 : 0)
        : (keys.down('KeyS', 'ArrowDown') ? 1 : 0) - (keys.down('KeyW', 'ArrowUp') ? 1 : 0);
      const field = screenToField(viewRef.current ?? makeView(size.w, size.h, 50), screenX, screenY);
      x = field.x;
      y = field.y;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
    }
    const sprintTouch = [...sprintPointers.current.values()].includes(playerId);
      const sprintKey = localTwoPlayer
      ? playerId === 0 ? keys.down('ShiftLeft') : keys.down('ShiftRight') || keys.down('Enter')
      : keys.down('ShiftLeft', 'ShiftRight', 'Space');
    return { x, y, sprint: sprintTouch || sprintKey };
  }

  function inputsFor(current: World, dt: number): Input[] {
    const o = onlineRef.current;
    return current.players.map((player) => {
      if (player.ai !== null) return think(current, player.id, memories.current[player.id] ?? makeMemory(), current.rng, dt);
      if (onlineGame && o?.isHost && player.seat !== o.seat) return remoteInput.current.get(player.seat) ?? emptyInput();
      return readInput(player.id);
    });
  }

  function handleEvents(events: GameEvent[], current: World) {
    if (!events.length) return;
    fxEvents(fx.current!, events, current, nameOf);
    for (const event of events) {
      if (event.type === 'tag') sfx.play('hit');
      else if (event.type === 'steal') {
        sfx.play('coin');
        sfx.tone({ freq: 520, to: 740, dur: 0.14, type: 'triangle', vol: 0.12 });
      } else if (event.type === 'capture') sfx.play('win');
      else if (event.type === 'free') { sfx.play('select'); sfx.play('select'); }
      else if (event.type === 'pickup') sfx.play('blip');
      else if (event.type === 'overtime') {
        sfx.play('tick');
        sfx.tone({ freq: 180, to: 110, dur: 0.28, type: 'triangle', vol: 0.14 });
      } else if (event.type === 'phase' && event.phase === 'play') sfx.play('tick');
    }
    if (onlineGame && onlineRef.current?.isHost) {
      const rows = eventsToNet(events, eventId.current);
      eventId.current += rows.length;
      for (const row of rows) eventLog.current.push({ at: tick.current, row });
    }
  }

  function finishGame(team: 0 | 1 | null, winnerId: number, reportedSeat?: number | null, host = true) {
    if (reported.current) return;
    reported.current = true;
    const current = worldRef.current!;
    const o = onlineRef.current;
    const winner = winnerId >= 0 ? current.players[winnerId] : null;
    let winnerSeat = reportedSeat ?? null;
    if (reportedSeat === undefined) {
      if (current.mode === 'tree') winnerSeat = winner && winner.ai === null && winner.seat >= 0 ? winner.seat : null;
      else {
        const candidates = current.players.filter((p) => p.team === team && p.seat >= 0 && p.ai === null);
        winnerSeat = candidates.sort((a, b) => a.seat - b.seat)[0]?.seat ?? null;
      }
    }
    if (onlineGame && o) {
      o.reportResult(o.round, winnerSeat);
      if (o.isHost && host) endMessage.current = endPacket(o.round, current, winnerSeat);
    }
    const ownId = myId();
    let title: string;
    if (current.mode === 'tree') title = winnerId === ownId ? 'you win' : `${nameOf(winnerId)} wins`;
    else if (!onlineGame && playMode === 'cpu' && team === 0) title = 'you win';
    else title = team === 0 ? 'stanford takes the axe' : team === 1 ? 'cal takes the axe' : 'no winner';
    const statPlayer = current.players[ownId >= 0 ? ownId : 0];
    const detail = current.mode === 'tree'
      ? `${winner ? winner.name : 'the tree'} held the tree for ${(current.treeScore[winnerId] ?? 0).toFixed(1)} seconds.`
      : `${current.score[0]} to ${current.score[1]}. you tagged ${statPlayer?.tags ?? 0}, freed ${statPlayer?.frees ?? 0}, scored ${statPlayer?.caps ?? 0}.${current.overtime ? ' golden capture!' : ''}`;
    shellRef.current.gameOver(undefined, { title, detail });
  }

  function updateWorld(dt: number) {
    const current = worldRef.current;
    if (!current || shellRef.current.status !== 'playing') return;
    const o = onlineRef.current;
    const authoritative = !onlineGame || o?.isHost === true;
    updateDt.current = dt;
    tick.current += Math.max(1, Math.round(dt * 60));
    if (toastT.current > 0) {
      toastT.current = Math.max(0, toastT.current - dt);
      if (!toastT.current) setToast('');
    }
    if (!authoritative) {
      if (o && !o.watching && synced.current) {
        const id = myId();
        const input = readInput(id);
        latestInput.current = input;
        const player = current.players[id];
        if (player && !player.jailed) movePlayer(player, input, dt, current);
        if (lastSprint.current === null || lastSprint.current !== input.sprint) {
          const seq = inputSeq.current++;
          o.send(inputPacket(o.round, input, seq), { fast: false });
        }
        lastSprint.current = input.sprint;
      }
      lastSimWall.current = performance.now() / 1000;
      return;
    }
    if (onlineGame && o?.isHost) {
      const departed = takeoverDeparted(current, o.players.map((p) => p.seat), levelRef.current);
      if (departed.length) {
        const player = current.players.find((p) => p.seat === departed[0]);
        setToast(`${player?.name ?? 'player'} left, a bot took over`);
        toastT.current = 3;
      }
    }
    const currentCount = current.phase === 'count' ? Math.ceil(current.phaseT) : 0;
    if (currentCount > 0 && currentCount < phaseCount.current) sfx.play('tick');
    phaseCount.current = currentCount || 4;
    const events = step(current, inputsFor(current, dt), dt);
    handleEvents(events, current);
    if (onlineGame && o?.isHost) {
      eventLog.current = eventLog.current.filter((entry) => tick.current - entry.at <= 90).slice(-60);
    }
    if (current.phase === 'over') finishGame(current.winner, current.winnerId);
    lastSimWall.current = performance.now() / 1000;
  }

  function render() {
    const context = ctx();
    const current = worldRef.current;
    if (!context || !current || size.w <= 0 || size.h <= 0) return;
    const view = makeView(size.w, size.h, 52);
    viewRef.current = view;
    fxStep(fx.current!, updateDt.current);
    const display: World = { ...current, players: current.players.map((p) => ({ ...p })) };
    if (onlineGame && !onlineRef.current?.isHost && snapshots.current.length >= 2) {
      const now = performance.now() - 100;
      const older = snapshots.current[snapshots.current.length - 2];
      const newer = snapshots.current[snapshots.current.length - 1];
      const alpha = Math.max(0, Math.min(1, (now - older.at) / Math.max(1, newer.at - older.at)));
      for (let id = 0; id < display.players.length; id++) {
        if (id === myId()) continue;
        const from = older.players[id];
        const to = newer.players[id];
        if (!from || !to) continue;
        display.players[id].x = from.x + (to.x - from.x) * alpha;
        display.players[id].y = from.y + (to.y - from.y) * alpha;
      }
    }
    const banner = !synced.current && onlineGame ? 'waiting for the round'
      : current.phase === 'count' ? String(Math.max(1, Math.ceil(current.phaseT)))
        : current.phase === 'scored' ? 'capture'
          : current.overtime && current.phase === 'play' ? 'golden capture'
            : current.phase === 'over' ? 'round over' : null;
    const sticksForDraw = [...touchPointers.current.values()].map((stick) => ({
      ox: stick.ox, oy: stick.oy, x: stick.x, y: stick.y,
    }));
    const me = onlineGame
      ? onlineRef.current?.watching || !synced.current ? [] : [myId()].filter((id) => id >= 0)
      : localTwoPlayer ? [0, 1] : [0];
    drawGame(context, view, display, fx.current!, {
      me, nameOf, sticks: sticksForDraw, watching: !!onlineRef.current?.watching || (onlineGame && !synced.current),
      banner, touch: shell.touch,
    });
  }

  useGameLoop(updateWorld, render);

  useEffect(() => {
    if (!onlineGame || !online) return;
    let startAt = 0;
    const timer = window.setInterval(() => {
      const current = worldRef.current;
      const now = performance.now() / 1000;
      if (online.isHost) {
        if (shellRef.current.status === 'playing' && current) {
          const gap = now - lastSimWall.current;
          if (gap > 0.075) updateWorld(Math.min(gap, 2));
          if (current.phase !== 'over' && now - startAt >= 2) {
            const roster = current.players.filter((p) => p.seat >= 0).map((p) => ({ seat: p.seat, team: p.team, ai: p.ai !== null }));
            online.send(startPacket(online.round, current.mode, current.seed, levelRef.current, roster));
            startAt = now;
          }
          if (current.phase !== 'over') {
            const rows = eventLog.current.map((entry) => entry.row);
            const packet = statePacket(online.round, tick.current, current, rows);
            online.send(packet, { fast: stateSendCount.current % 5 !== 4 });
            stateSendCount.current++;
          }
        }
        if (current?.phase === 'over' && endMessage.current && endSends.current < 4) {
          online.send(endMessage.current);
          endSends.current++;
        }
      } else if (!online.watching && synced.current && shellRef.current.status === 'playing') {
        const input = latestInput.current;
        online.send(inputPacket(online.round, input, inputSeq.current++), { fast: true });
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [onlineGame, online?.round, online?.isHost, online?.watching]);

  function pointerPosition(event: RPointerEvent<HTMLCanvasElement>) {
    const canvas = ref.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) return { x: event.clientX, y: event.clientY };
    return {
      x: (event.clientX - rect.left) * canvas.clientWidth / rect.width,
      y: (event.clientY - rect.top) * canvas.clientHeight / rect.height,
    };
  }

  function pointerDown(event: RPointerEvent<HTMLCanvasElement>) {
    if (!shell.touch || !onlineGame && mode === 'idle') return;
    if (onlineGame && (!synced.current || onlineRef.current?.watching)) return;
    event.preventDefault();
    const point = pointerPosition(event);
    if (!localTwoPlayer && point.x > size.w * 0.6) return;
    const player = localTwoPlayer
      ? point.x < size.w / 2 ? 0 : 1
      : onlineGame ? myId() : 0;
    if (player < 0) return;
    const stick = { pointer: event.pointerId, player, ox: point.x, oy: point.y, x: point.x, y: point.y };
    touchPointers.current.set(event.pointerId, stick);
    setSticks([...touchPointers.current.values()]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: RPointerEvent<HTMLCanvasElement>) {
    const stick = touchPointers.current.get(event.pointerId);
    if (!stick) return;
    const point = pointerPosition(event);
    const dx = point.x - stick.ox;
    const dy = point.y - stick.oy;
    const length = Math.hypot(dx, dy);
    const scale = length > 48 ? 48 / length : 1;
    stick.x = stick.ox + dx * scale;
    stick.y = stick.oy + dy * scale;
    setSticks([...touchPointers.current.values()]);
  }

  function pointerEnd(event: RPointerEvent<HTMLCanvasElement>) {
    if (touchPointers.current.delete(event.pointerId)) setSticks([...touchPointers.current.values()]);
  }

  function sprintDown(event: RPointerEvent<HTMLButtonElement>, player: number) {
    event.stopPropagation();
    event.preventDefault();
    sprintPointers.current.set(event.pointerId, player);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function sprintUp(event: RPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    sprintPointers.current.delete(event.pointerId);
  }

  const current = worldRef.current!;
  const showTouch = shell.touch && mode !== 'idle' && (!onlineGame || synced.current) && !onlineRef.current?.watching;
  const sprintButtons = showTouch
    ? localTwoPlayer
      ? [0, 1]
      : [onlineGame ? myId() : 0].filter((id) => id >= 0)
    : [];

  return (
    <div className="g-the-axe-stage">
      <canvas
        ref={ref}
        className="g-the-axe-canvas"
        aria-label="the axe game"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
      />
      {sprintButtons.map((id) => (
        <button
          key={id}
          type="button"
          className={`g-the-axe-sprint ${localTwoPlayer ? id === 0 ? 'g-the-axe-sprint-left' : 'g-the-axe-sprint-right' : ''}`}
          style={{ '--g-the-axe-stamina': `${Math.round((current.players[id]?.stamina ?? 1) * 100)}%` } as CSSProperties}
          aria-label={`sprint player ${id + 1}`}
          onPointerDown={(event) => sprintDown(event, id)}
          onPointerUp={sprintUp}
          onPointerCancel={sprintUp}
          onLostPointerCapture={sprintUp}
        >
          <span>sprint</span>
        </button>
      ))}
      {toast && <div className="g-the-axe-toast">{toast}</div>}
    </div>
  );
}
