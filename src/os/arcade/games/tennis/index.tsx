import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelOptions, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createAudio } from './audio.ts';
import { Hud } from './hud.tsx';
import type { HudModel } from './hud.tsx';
import { createWorld, SWING_LEAD, stepWorld, teamSeats, type Command, type Format, type Level, type MatchLength, type Player, type Swing, type World } from './logic.ts';
import { configOf, commandOf, eventOf, parsePacket, serveOf, stateOf, swingOf } from './net.ts';
import { meta } from './meta.ts';
import { createScene, type View } from './scene.ts';
import './tennis.css';

type LevelName = (typeof LEVEL_NAMES)[number];
type StageMode = 'offline' | 'online';
type Gesture = { x: number; y: number; dx: number; dy: number; seconds: number };
type ContactSnapshot = { shot: number; at: number; state: Omit<World, 'random'> };

const FORMAT = defineSetting('tennis:format', ['singles', 'doubles'] as const, 'singles');
const LENGTH = defineSetting('tennis:length', ['game', 'three', 'set'] as const, 'three');
const LEVEL = defineSetting('tennis:level', LEVEL_NAMES, 'normal');
const formatOptions = [['singles', 'Singles'], ['doubles', 'Doubles']] as const;
const lengthOptions = [['game', '1 Game'], ['three', 'First to 2'], ['set', '1 Set']] as const;
const BOT_NAMES = ['Ace', 'Rally', 'Volley'] as const;
const difficulty = (name: LevelName): Level => name === 'easy' ? 0 : name === 'hard' ? 2 : 1;
const levelName = (level: Level): LevelName => level === 0 ? 'easy' : level === 2 ? 'hard' : 'normal';
const formatLabel = (format: Format) => format === 'singles' ? 'Singles' : 'Doubles';

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
      quickNote="Doubles with normal bots fills the other seats."
    >
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [format, setFormat] = useSetting(FORMAT);
  const [length, setLength] = useSetting(LENGTH);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={format} options={formatOptions} onChange={setFormat} />
      <Segmented label="Match" value={length} options={lengthOptions} onChange={setLength} />
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
    </>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [format, setFormat] = useSetting(FORMAT);
  const [length, setLength] = useSetting(LENGTH);
  const [level, setLevel] = useSetting(LEVEL);
  const [hostPick, setHostPick] = useState<{ format: Format; length: MatchLength; level: Level } | null>(null);
  const extraHumans = !!online?.players.some((player) => player.seat > 1);
  const actualFormat = online?.quick ? 'doubles' : extraHumans ? 'doubles' : format;

  useEffect(() => {
    if (!online?.isHost) return;
    const send = () => online.send(configOf(online.round || 1, actualFormat, online.quick ? 'three' : length, online.quick ? 1 : difficulty(level)));
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [online, actualFormat, length, level]);

  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, data) => {
      const packet = parsePacket(data);
      if (from === 0 && packet?.k === 'cfg') setHostPick({ format: packet.format, length: packet.length, level: packet.level });
    });
  }, [online]);

  if (!online) return null;
  if (online.quick) return <p className="arcade-online-hint">Doubles, first to 2 games, normal bots.</p>;
  if (online.isHost) {
    return (
      <>
        {extraHumans
          ? <div className="arcade-field"><span>Mode</span><strong>Doubles, required for 3 or 4 players</strong></div>
          : <Segmented label="Mode" value={actualFormat} options={formatOptions} onChange={setFormat} />}
        <Segmented label="Match" value={length} options={lengthOptions} onChange={setLength} />
        <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />
      </>
    );
  }
  return (
    <div className="arcade-field">
      <span>Host Setup</span>
      <div className="g-tennis-hostpick">
        <b>{hostPick ? `${formatLabel(hostPick.format)} · ${hostPick.length} · ${levelName(hostPick.level)}` : 'waiting for host'}</b>
        <small>picked by the host</small>
      </div>
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const stage = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'offline' });
  if (shell.status === 'ready') stage.current = { key: 'idle', mode: 'offline' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}:${online.handoffs}` : 'offline';
    if (key !== stage.current.key) stage.current = { key, mode: online ? 'online' : 'offline' };
  }
  return <Play key={stage.current.key} mode={stage.current.mode} />;
}

function settingsWorld(mode: StageMode, format: Format, length: MatchLength, level: Level, online: ReturnType<typeof useOnline>) {
  if (mode === 'online' && online) {
    const actualFormat: Format = online.quick || online.players.some((player) => player.seat > 1) ? 'doubles' : format;
    const count = actualFormat === 'singles' ? 2 : 4;
    const roster = new Map<number, { name: string; ai: Level | null; connected: boolean }>();
    for (const player of online.players) {
      if (player.seat >= 0 && player.seat < count) roster.set(player.seat, { name: player.name, ai: null, connected: true });
    }
    for (const bot of online.bots) {
      if (bot.seat >= 0 && bot.seat < count && !roster.has(bot.seat)) roster.set(bot.seat, { name: bot.name, ai: level, connected: true });
    }
    for (let seat = 0; seat < count; seat++) {
      if (!roster.has(seat)) roster.set(seat, { name: BOT_NAMES[seat] ?? `Bot ${seat}`, ai: level, connected: true });
    }
    return createWorld({
      format: actualFormat,
      length: online.quick ? 'three' : length,
      level: online.quick ? 1 : level,
      seed: online.round || 1,
      players: Array.from({ length: count }, (_, seat) => roster.get(seat)!),
    });
  }
  return createWorld({
    format,
    length,
    level,
    players: format === 'singles'
      ? [{ name: 'You', ai: null }, { name: 'Ace', ai: level }]
      : [{ name: 'You', ai: null }, { name: 'Ace', ai: level }, { name: 'Rally', ai: level }, { name: 'Volley', ai: level }],
  });
}

function hudCopy(world: World, seat: number | null, watching: boolean, timing: HudModel['timing']): HudModel {
  const copy = { ...world, players: world.players.map((player) => ({ ...player })), ball: { ...world.ball, p: { ...world.ball.p }, v: { ...world.ball.v } }, match: structuredClone(world.match) };
  return { world: copy, seat, watching, call: world.callClock > 0 ? world.lastCall : '', timing };
}

function contactTime(world: World, player: Player) {
  if (!world.ball.inPlay) return 0.18;
  const ball = world.ball;
  for (let t = 0.01; t <= 1.3; t += 0.01) {
    const x = ball.p.x + ball.v.x * t;
    const z = ball.p.z + ball.v.z * t;
    const y = ball.p.y + ball.v.y * t - 4.905 * t * t;
    const reach = 1.12 + Math.min(6.2, Math.hypot(player.vx, player.vz) + 6 * t) * t;
    if (y > 0.4 && y < 3.6 && Math.hypot(player.x - x, player.z - z) <= reach) return t;
    if (y <= 0.034 && t > 0.05) break;
  }
  const distance = Math.hypot(player.x - ball.p.x, player.z - ball.p.z);
  return Math.max(0.025, Math.min(0.5, distance / 12));
}

function makeSwing(world: World, player: Player, gesture: Gesture): Swing {
  const delta = SWING_LEAD - contactTime(world, player);
  let kind: Swing['kind'] = 'drive';
  if (gesture.dy > 34) kind = 'slice';
  else if (gesture.dy < -48 && gesture.seconds > 0.24) kind = 'lob';
  const aim = gesture.dx < -18 ? -1 : gesture.dx > 18 ? 1 : 0;
  const swipe = Math.min(2500, Math.hypot(gesture.dx, gesture.dy) / Math.max(0.08, gesture.seconds));
  return { kind, aim, delta, swipe };
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [formatSetting] = useSetting(FORMAT);
  const [lengthSetting] = useSetting(LENGTH);
  const [levelSetting] = useSetting(LEVEL);
  const level = online?.quick ? 1 : difficulty(levelSetting);
  const format = online?.quick ? 'doubles' : formatSetting;
  const length = online?.quick ? 'three' : lengthSetting;
  const onlineRef = useRef(online);
  const shellRef = useRef(shell);
  onlineRef.current = online;
  shellRef.current = shell;

  const world = useRef<World | null>(null);
  world.current ??= settingsWorld(mode, format, length, level, online);
  const view = useRef<View | null>(null);
  const audio = useRef<ReturnType<typeof createAudio> | null>(null);
  const localCommands = useRef<Command[]>([]);
  const remoteCommands = useRef<Command[]>([]);
  const contactSnapshots = useRef(new Map<number, ContactSnapshot[]>());
  const synced = useRef(mode !== 'online' || !!online?.isHost);
  const reported = useRef(false);
  const snapshotAge = useRef(0);
  const onlineTick = useRef(0);
  const hudClock = useRef(0);
  const timingClock = useRef(0);
  const [timing, setTiming] = useState<HudModel['timing']>('');
  const [hud, setHud] = useState<HudModel>(() => hudCopy(world.current!, online?.seat ?? null, !!online?.watching, ''));
  const pointer = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const currentSeat = () => mode === 'online' ? onlineRef.current?.seat ?? -1 : 0;
  const myTeam = () => world.current?.players.find((player) => player.seat === currentSeat())?.team ?? 0;
  const localHumanSeats = () => mode === 'online'
    ? new Set((onlineRef.current?.players ?? []).map((player) => player.seat).filter((seat) => seat >= 0))
    : new Set([0]);

  useEffect(() => {
    audio.current = createAudio();
    return () => {
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const next = createScene(THREE, host, shell.touch);
    if (!next) return;
    view.current = next;
    next.resize(size.w, size.h);
    next.update(world.current!, 0, localHumanSeats(), myTeam());
    shell.invalidate();
    return () => {
      next.dispose();
      view.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, shell]);

  const setTimingResult = (swing: Swing) => {
    const state = swing.delta < -0.025 ? 'early' : swing.delta > 0.025 ? 'late' : 'perfect';
    setTiming(state);
    timingClock.current = 0.9;
  };

  const sendCommand = (command: Command) => {
    const o = onlineRef.current;
    const current = world.current;
    if (!current) return;
    if (mode !== 'online' || o?.isHost) {
      localCommands.current.push(command);
      return;
    }
    if (!o || o.seat < 0) return;
    if (command.toss) o.send(serveOf(o.round || 1, 'toss'));
    else if (command.serve) o.send(serveOf(o.round || 1, 'serve', command.swing?.aim ?? 0));
    else if (command.swing) o.send(swingOf(o.round || 1, current.ball.rallyShot, command.swing));
  };

  const action = (gesture: Gesture) => {
    const current = world.current;
    if (!current || shellRef.current.status !== 'playing') return;
    const seat = currentSeat();
    const player = current.players.find((entry) => entry.seat === seat);
    if (!player || player.ai !== null || !player.connected) return;
    if ((current.phase === 'serve-ready' || current.phase === 'serve-toss') && current.serverSeat === seat) {
      if (current.phase === 'serve-ready') sendCommand({ seat, toss: true });
      else {
        const aim = gesture.dx < -18 ? -1 : gesture.dx > 18 ? 1 : 0;
        sendCommand({ seat, serve: true, swing: { kind: 'drive', aim, delta: 0 } });
      }
      return;
    }
    if (current.phase !== 'rally' || current.ball.canHitTeam !== player.team) return;
    const swing = makeSwing(current, player, gesture);
    setTimingResult(swing);
    sendCommand({ seat, swing });
  };

  const localPlayerAction = () => {
    const side = keys.axis('left', 'right');
    const kind = keys.down('up') ? 'lob' : keys.down('down') ? 'slice' : 'drive';
    action({ x: 0, y: 0, dx: side * 48, dy: kind === 'lob' ? -60 : kind === 'slice' ? 60 : 0, seconds: 0.18 });
  };

  const finishGame = (team: number) => {
    const current = world.current;
    const o = onlineRef.current;
    if (!current || reported.current) return;
    reported.current = true;
    const winnerSeats = teamSeats(current, team).sort((a, b) => a - b);
    const winnerSeat = winnerSeats[0] ?? null;
    const mine = current.players.find((player) => player.seat === currentSeat());
    const watcher = mode === 'online' && !!o?.watching;
    let title: string;
    if (watcher) title = `team ${team === 0 ? 'a' : 'b'} wins`;
    else if (mode === 'online' && mine?.team === team) title = 'you win';
    else if (mode === 'online') {
      const winner = current.players.find((player) => player.seat === winnerSeat);
      title = `${winner?.name ?? `team ${team === 0 ? 'a' : 'b'}`} wins`;
    }
    else title = team === 0 ? 'you win' : 'match lost';
    const detail = `${current.match.games[0]} - ${current.match.games[1]} games${current.match.length === 'set' ? ` · ${current.match.sets[0]} - ${current.match.sets[1]} sets` : ''}`;
    if (mode === 'online' && o) {
      if (o.isHost) {
        o.reportResult(o.round, winnerSeat);
        o.send(eventOf(o.round || 1, { type: 'end', winner: team }), { fast: false });
      }
      shellRef.current.gameOver(undefined, { title, detail });
      return;
    }
    shellRef.current.gameOver(undefined, { title, detail });
  };

  const handleEvent = (event: ReturnType<typeof stepWorld>[number], fromHost = false) => {
    const currentView = view.current;
    if (event.type === 'hit') {
      currentView?.hit(event.speed);
      audio.current?.hit(event.speed, event.kind);
    } else if (event.type === 'bounce') {
      currentView?.bounce(event.x, event.z, event.line);
      audio.current?.bounce(event.in, event.line);
    } else if (event.type === 'net') {
      currentView?.netHit();
      audio.current?.net();
    } else if (event.type === 'call') {
      audio.current?.call(event.call);
    } else if (event.type === 'point') {
      currentView?.point(event.winner);
    } else if (event.type === 'end') {
      if (mode === 'online' && !onlineRef.current?.isHost) finishGame(event.winner);
    }
    const o = onlineRef.current;
    if (!fromHost && mode === 'online' && o?.isHost) o.send(eventOf(o.round || 1, event), { fast: false });
  };

  const captureContact = (current: World) => {
    if (current.phase !== 'rally' || !current.ball.inPlay) return;
    const now = performance.now();
    for (const player of current.players) {
      if (player.ai !== null || !player.connected || player.team !== current.ball.canHitTeam) continue;
      const distance = Math.hypot(player.x - current.ball.p.x, player.z - current.ball.p.z);
      if (distance > 3.6 || current.ball.p.y < 0.4 || current.ball.p.y > 3.6) continue;
      const { random: _random, ...rest } = current;
      const snapshots = contactSnapshots.current.get(player.seat) ?? [];
      snapshots.push({ shot: current.ball.rallyShot, at: now, state: structuredClone(rest) });
      contactSnapshots.current.set(player.seat, snapshots.filter((snapshot) => now - snapshot.at < 260).slice(-28));
    }
  };

  const updateWorld = (dt: number) => {
    const current = world.current;
    if (!current || shellRef.current.status !== 'playing') return;
    const o = onlineRef.current;
    if (mode === 'online' && o && !o.isHost) {
      snapshotAge.current += dt;
      if (snapshotAge.current < 0.105 && current.ball.inPlay) {
        current.ball.p.x += current.ball.v.x * dt;
        current.ball.p.z += current.ball.v.z * dt;
        current.ball.p.y = Math.max(0.034, current.ball.p.y + current.ball.v.y * dt - 4.905 * dt * dt);
        current.ball.v.y -= 9.81 * dt;
      }
    } else {
      if (mode === 'online' && o?.isHost) {
        for (const player of current.players) {
          if (player.ai !== null) continue;
          if (!o.players.some((entry) => entry.seat === player.seat)) {
            player.ai = level;
            player.name = `${player.name} (bot)`;
          }
        }
        captureContact(current);
      }
      const commands = [...localCommands.current, ...remoteCommands.current];
      localCommands.current = [];
      remoteCommands.current = [];
      const events = stepWorld(current, commands, dt);
      events.forEach((event) => handleEvent(event));
      if (current.match.winner !== null) finishGame(current.match.winner);
    }

    if (keys.pressed('action')) localPlayerAction();
    timingClock.current = Math.max(0, timingClock.current - dt);
    if (timingClock.current <= 0 && timing) setTiming('');
    const side = myTeam();
    view.current?.update(current, dt, localHumanSeats(), side);
    hudClock.current += dt;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      setHud(hudCopy(current, currentSeat(), !!o?.watching, timingClock.current > 0 ? timing : ''));
    }
  };

  useGameLoop(updateWorld, () => view.current?.render());

  useEffect(() => {
    if (mode !== 'online' || !online) return;
    const off = online.onMessage((from, data) => {
      const o = onlineRef.current;
      if (!o || from === o.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== (o.round || 1)) return;
      const current = world.current;
      if (!current) return;
      if (o.isHost && (packet.k === 'sw' || packet.k === 'toss' || packet.k === 'serve')) {
        const player = current.players.find((entry) => entry.seat === from);
        if (!player || player.ai !== null || !player.connected) return;
        const command = commandOf(packet, from);
        if (!command) return;
        if (packet.k !== 'sw') {
          if (from !== current.serverSeat) return;
          remoteCommands.current.push(command);
          return;
        }
        if (packet.shot !== current.ball.rallyShot || current.phase !== 'rally' || current.ball.canHitTeam !== player.team) return;
        const distance = Math.hypot(player.x - current.ball.p.x, player.z - current.ball.p.z);
        const within = distance <= 3.6 && current.ball.p.y >= 0.4 && current.ball.p.y <= 3.6;
        const grace = Math.min(250, o.transport === 'relay' ? 205 : 145);
        if (!within) {
          const snapshots = contactSnapshots.current.get(from) ?? [];
          const snapshot = [...snapshots].reverse().find((entry) => entry.shot === packet.shot && performance.now() - entry.at <= grace);
          if (!snapshot) return;
          const random = current.random;
          Object.assign(current, snapshot.state);
          current.random = random;
        }
        remoteCommands.current.push(command);
        return;
      }
      if (!o.isHost && from === 0 && packet.k === 'S') {
        const incoming = packet.state;
        if (!synced.current || world.current?.format !== incoming.format || world.current?.players.length !== incoming.players.length) {
          world.current = incoming;
          synced.current = true;
        } else {
          const target = world.current!;
          const previousPlayers = target.players;
          const previousBall = target.ball;
          Object.assign(target, incoming);
          target.players = incoming.players.map((player, index) => {
            const previous = previousPlayers[index];
            return previous ? {
              ...player,
              x: previous.x + (player.x - previous.x) * 0.45,
              z: previous.z + (player.z - previous.z) * 0.45,
            } : player;
          });
          target.ball = {
            ...incoming.ball,
            p: {
              x: previousBall.p.x + (incoming.ball.p.x - previousBall.p.x) * 0.7,
              y: previousBall.p.y + (incoming.ball.p.y - previousBall.p.y) * 0.7,
              z: previousBall.p.z + (incoming.ball.p.z - previousBall.p.z) * 0.7,
            },
          };
        }
        snapshotAge.current = 0;
        if (incoming.match.winner !== null) finishGame(incoming.match.winner);
        return;
      }
      if (!o.isHost && from === 0 && packet.k === 'ev') handleEvent(packet.event, true);
    });

    const timer = window.setInterval(() => {
      const current = world.current;
      const o = onlineRef.current;
      if (!current || !o || shellRef.current.status !== 'playing') return;
      if (!o.isHost) return;
      onlineTick.current++;
      o.send(stateOf(o.round || 1, current), { fast: onlineTick.current % 5 !== 0 });
    }, 50);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    const clear = () => { pointer.current = null; };
    window.addEventListener('blur', clear);
    if (shell.status !== 'playing') clear();
    return () => {
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [shell.status]);

  const onPointerDown = (event: RPointerEvent<HTMLDivElement>) => {
    if (shell.status !== 'playing' || event.button !== 0) return;
    event.preventDefault();
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: RPointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    const seconds = Math.max(0.04, (performance.now() - start.at) / 1000);
    action({ x: start.x, y: start.y, dx: event.clientX - start.x, dy: event.clientY - start.y, seconds });
    pointer.current = null;
  };
  const onPointerCancel = () => { pointer.current = null; };

  return (
    <div
      className="g-tennis-stage"
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label="Tennis court"
    >
      {!THREE && <div className="g-tennis-error"><strong>Preparing Taube Stadium…</strong></div>}
      {THREE && !view.current && shell.status === 'playing' && <div className="g-tennis-error"><strong>3D court could not load. Try restarting.</strong></div>}
      <Hud {...hud} />
    </div>
  );
}
