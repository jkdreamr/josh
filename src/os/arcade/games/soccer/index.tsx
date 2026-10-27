import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { GameShell, useShell, useKeys, useGameLoop, useCanvas, useThree, useOnline, useSetting, Segmented, defineSetting, levelOptions, levelIndex, TouchControls, sfx } from '../../kit';
import type { LevelName } from '../../kit/controls';
import { meta } from './meta.ts';
import { computeAI, type Level } from './ai.ts';
import { keyboardInput } from './input.ts';
import { cloneSnapshot, commandFromPacket, movePacket, parsePacket } from './net.ts';
import { createWorld, distance, matchClock, stepWorld, STEP, switchPlayer, teamDir, type Command, type Team, type World } from './logic.ts';
import { appendReplayFrame, sampleReplay, type ReplayFrame } from './replay.ts';
import { goalRoar, kickThump, netSwish, startCrowd, whistle } from './audio.ts';
import { createScene, type CameraMode, type SoccerView, type TimeMode } from './scene.ts';
import { Hud } from './hud.tsx';
import './soccer.css';

type Mode = 'cpu' | 'versus' | 'coop';
type Minutes = '2' | '4' | '6';
type Camera = 'broadcast' | 'end';
type Time = 'night' | 'golden';

const MODE = defineSetting<Mode>('soccer:mode', ['cpu', 'versus', 'coop'], 'cpu');
const HALF = defineSetting<Minutes>('soccer:half', ['2', '4', '6'], '4');
const LEVEL = defineSetting<LevelName>('soccer:level', ['easy', 'normal', 'hard'], 'normal');
const CAMERA = defineSetting<Camera>('soccer:camera', ['broadcast', 'end'], 'broadcast', { live: true });
const TIME = defineSetting<Time>('soccer:time', ['night', 'golden'], 'night', { live: true });

const modeOptions = [['cpu', 'vs CPU'], ['versus', '2P versus'], ['coop', '2P co-op']] as const;
const halfOptions = [['2', '2 min'], ['4', '4 min'], ['6', '6 min']] as const;
const cameraOptions = [['broadcast', 'Broadcast'], ['end', 'End to end']] as const;
const timeOptions = [['night', 'Night'], ['golden', 'Golden hour']] as const;
const commandKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'Period', 'Slash', 'Semicolon', 'Quote', 'Comma', 'ShiftLeft', 'ShiftRight'];
const playerForSeat = (seat: number) => seat % 2 === 0 ? 1 + Math.floor(seat / 2) : 6 + Math.floor(seat / 2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function Settings({ online = false }: { online?: boolean }) {
  const [mode, setMode] = useSetting(MODE);
  const [half, setHalf] = useSetting(HALF);
  const [level, setLevel] = useSetting(LEVEL);
  const [camera, setCamera] = useSetting(CAMERA);
  const [time, setTime] = useSetting(TIME);
  return (
    <div className="g-soccer-settings">
      {!online && <Segmented label="Match" value={mode} options={modeOptions} onChange={setMode} />}
      <Segmented label="Half length" value={half} options={halfOptions} onChange={setHalf} />
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
      <Segmented label="Camera" value={camera} options={cameraOptions} onChange={setCamera} />
      <Segmented label="Time of day" value={time} options={timeOptions} onChange={setTime} />
    </div>
  );
}

function Stick({ movement }: { movement: { current: { x: number; z: number } } }) {
  const pointer = useRef<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const update = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width * 0.36;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    const x = dx * scale;
    const y = dy * scale;
    movement.current = { x: x / radius, z: y / radius };
    setOffset({ x, y });
  };
  const release = (event?: PointerEvent<HTMLDivElement>) => {
    if (event && pointer.current !== event.pointerId) return;
    pointer.current = null;
    movement.current = { x: 0, z: 0 };
    setOffset({ x: 0, y: 0 });
  };
  return (
    <div
      className="g-soccer-stick"
      aria-label="movement stick"
      onPointerDown={(event) => {
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => pointer.current === event.pointerId && update(event)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <i style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} />
    </div>
  );
}

function teamForPlayer(id: number): Team {
  return id < 5 ? 0 : 1;
}

function setupHumans(world: World, mode: Mode, online: ReturnType<typeof useOnline>) {
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  if (online) {
    for (const member of online.players) {
      const player = world.players[playerForSeat(member.seat)]!;
      player.human = true;
      player.controlled = true;
      const team = player.team;
      if (!world.players.some((p) => p.team === team && p.id !== player.id && p.human)) world.controlled[team] = player.id;
    }
    return;
  }
  const ids = mode === 'versus' ? [1, 6] : mode === 'coop' ? [1, 2] : [1];
  ids.forEach((id) => {
    world.players[id]!.human = true;
    world.players[id]!.controlled = true;
  });
  world.controlled[0] = 1;
  world.controlled[1] = mode === 'versus' ? 6 : 6;
}

function interpolate(a: World, b: World, t: number): World {
  const world = structuredClone(a);
  const mix = (from: number, to: number) => from + (to - from) * t;
  world.players = b.players.map((player, i) => {
    const previous = a.players[i]!;
    return { ...player, x: mix(previous.x, player.x), z: mix(previous.z, player.z), vx: mix(previous.vx, player.vx), vz: mix(previous.vz, player.vz), facing: mix(previous.facing, player.facing), stamina: mix(previous.stamina, player.stamina) };
  });
  world.ball = { ...b.ball, x: mix(a.ball.x, b.ball.x), y: mix(a.ball.y, b.ball.y), z: mix(a.ball.z, b.ball.z), vx: mix(a.ball.vx, b.ball.vx), vy: mix(a.ball.vy, b.ball.vy), vz: mix(a.ball.vz, b.ball.vz) };
  world.score = [...b.score];
  world.clock = b.clock;
  world.phase = b.phase;
  world.event = b.event;
  world.eventTime = b.eventTime;
  return world;
}

type NetworkFrame = { time: number; world: World };

function onlineRenderState(frames: NetworkFrame[], now: number, fallback: World) {
  if (!frames.length) return fallback;
  const target = now - 0.1;
  let before = frames[0]!;
  for (const frame of frames) {
    if (frame.time <= target) before = frame;
    else {
      const span = frame.time - before.time;
      return span > 0 ? interpolate(before.world, frame.world, clamp((target - before.time) / span, 0, 1)) : frame.world;
    }
  }
  return before.world;
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [modeChoice] = useSetting(MODE);
  const [halfChoice] = useSetting(HALF);
  const [levelChoice] = useSetting(LEVEL);
  const [cameraChoice] = useSetting(CAMERA);
  const [timeChoice] = useSetting(TIME);
  const [power, setPower] = useState<number | null>(null);
  const [replayActive, setReplayActive] = useState(false);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState(1);
  const [hudWorld, setHudWorld] = useState<World>(() => createWorld());
  const movement = useRef({ x: 0, z: 0 });
  const worldRef = useRef<World | null>(null);
  const viewRef = useRef<SoccerView | null>(null);
  const shellRef = useRef(shell);
  const onlineRef = useRef(online);
  const levelRef = useRef<Level>(online?.quick ? 'normal' : levelChoice);
  const cameraRef = useRef<CameraMode>(cameraChoice);
  const timeRef = useRef<TimeMode>(timeChoice);
  const accumulator = useRef(0);
  const simulationTime = useRef(0);
  const replayFrames = useRef<ReplayFrame[]>([]);
  const replayStartedAt = useRef<number | null>(null);
  const replaySkipped = useRef(false);
  const hudTimer = useRef(0);
  const snapshotTimer = useRef(0);
  const snapshotSequence = useRef(0);
  const inputSequence = useRef(0);
  const inputTimer = useRef(0);
  const configSequence = useRef(0);
  const remoteCommands = useRef(new Map<number, Command>());
  const lastRemoteSeq = useRef(new Map<number, number>());
  const guestSnapshots = useRef<NetworkFrame[]>([]);
  const pendingNetworkAction = useRef<Command | null>(null);
  const charging = useRef(new Map<number, { holding: boolean; seconds: number }>());
  const lastScore = useRef<[number, number]>([0, 0]);
  const reported = useRef(false);
  const lastEvent = useRef('');
  const soundTime = useRef(0);
  const crowdIntensity = useRef(0.12);
  shellRef.current = shell;
  onlineRef.current = online;
  levelRef.current = online?.quick ? 'normal' : levelChoice;
  cameraRef.current = cameraChoice;
  timeRef.current = timeChoice;

  const halfMinutes = online?.quick ? 3 : Number(halfChoice);
  const currentMode: Mode = online ? 'cpu' : modeChoice;
  if (!worldRef.current) {
    worldRef.current = createWorld(Math.floor(Date.now() % 0xffff_ffff), halfMinutes * 60, currentMode === 'coop' ? 2 : 1);
    setupHumans(worldRef.current, currentMode, online);
  }
  const world = worldRef.current!;
  const localPlayerIds = online ? online.seat < 0 ? [] : [playerForSeat(online.seat)] : currentMode === 'versus' ? [1, 6] : currentMode === 'coop' ? [1, 2] : [world.controlled[0]];
  const localTeam = localPlayerIds.length ? teamForPlayer(localPlayerIds[0]!) : 0;

  useEffect(() => {
    if (shell.status !== 'ready') return;
    const fresh = createWorld(Math.floor(Date.now() % 0xffff_ffff), halfMinutes * 60, currentMode === 'coop' ? 2 : 1);
    setupHumans(fresh, currentMode, online);
    worldRef.current = fresh;
    setHudWorld(fresh);
  }, [shell.status, modeChoice, halfMinutes, online?.round, online?.seat, online?.players]);

  useEffect(() => {
    const release = sfx.retain();
    if (shell.status !== 'playing') return release;
    const stopCrowd = startCrowd(() => crowdIntensity.current);
    return () => { stopCrowd(); release(); };
  }, [shell.status]);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const view = createScene(THREE, host, shell.touch, timeRef.current);
    if (!view) return;
    viewRef.current = view;
    view.resize(size.w, size.h);
    view.update(world, 0, performance.now() / 1000, localTeam, cameraRef.current);
    shell.invalidate();
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    viewRef.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, shell]);

  useEffect(() => viewRef.current?.setTime(timeChoice === 'golden' ? 'golden' : 'night'), [timeChoice]);

  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, data) => {
      const room = onlineRef.current;
      if (!room || from === room.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== (room.round || 1)) return;
      if (room.isHost && packet.k === 'mv') {
        if (packet.seat !== from || packet.seat < 0 || packet.seat > 3) return;
        if (packet.seq <= (lastRemoteSeq.current.get(from) ?? -1)) return;
        lastRemoteSeq.current.set(from, packet.seq);
        const command = commandFromPacket(packet);
        const player = worldRef.current?.players[playerForSeat(from)];
        if (!player || !player.human) return;
        remoteCommands.current.set(player.id, command);
        return;
      }
      if (!room.isHost && from === 0 && packet.k === 's') {
        if (packet.seq <= snapshotSequence.current) return;
        snapshotSequence.current = packet.seq;
        const now = performance.now() / 1000;
        if (packet.state.phase === 'goal' && worldRef.current?.phase !== 'goal') {
          replayStartedAt.current = now;
          replaySkipped.current = false;
        }
        appendReplayFrame(replayFrames.current, packet.state, now);
        guestSnapshots.current.push({ time: now, world: packet.state });
        guestSnapshots.current = guestSnapshots.current.slice(-12);
        worldRef.current = packet.state;
        return;
      }
      if (!room.isHost && from === 0 && packet.k === 'cfg') {
        levelRef.current = (['easy', 'normal', 'hard'] as const)[packet.level]!;
      }
    });
    return off;
  }, [online, online?.round, online?.isHost]);

  useEffect(() => {
    if (!online?.isHost) return;
    const sendConfig = () => onlineRef.current?.send({
      t: 'soccer', k: 'cfg', r: onlineRef.current?.round || 1, seq: configSequence.current++,
      half: onlineRef.current?.quick ? 3 : Number(halfChoice) as 2 | 4 | 6,
      level: onlineRef.current?.quick ? 1 : levelIndex(levelChoice),
    });
    sendConfig();
    const timer = window.setInterval(sendConfig, 1500);
    return () => window.clearInterval(timer);
  }, [online?.isHost, online?.round, online?.quick, halfChoice, levelChoice]);

  const soundForWorld = (current: World) => {
    if (current.kickEvent) {
      kickThump(current.kickEvent.power);
    }
    if (current.phase === 'goal' && lastScore.current.some((score, i) => score !== current.score[i])) {
      goalRoar();
      netSwish();
      replayStartedAt.current = simulationTime.current;
      replaySkipped.current = false;
    }
    if (current.event !== lastEvent.current && /kick off|kickoff|foul|half time|full time|kick-in|corner|goal kick|free kick|penalty|second half/i.test(current.event)) {
      whistle();
    }
    lastEvent.current = current.event;
    lastScore.current = [...current.score];
  };

  const makeCommand = (id: number, p2: boolean, dt: number): Command => {
    const state = keyboardInput(keys, p2, !p2 && !online && currentMode === 'cpu');
    if (!p2 && Math.hypot(movement.current.x, movement.current.z) > 0.05 && shell.touch) {
      state.move = { ...movement.current };
    }
    const current = worldRef.current!;
    const player = current.players[id]!;
    const aim = Math.hypot(state.move.x, state.move.z) > 0.05
      ? { ...state.move }
      : { x: teamDir(player.team, current.endsSwapped), z: 0 };
    const charge = charging.current.get(id) ?? { holding: false, seconds: 0 };
    const holdingShot = keys.down(p2 ? 'Slash' : 'KeyK');
    let action = state.action;
    let pressed = state.pressed;
    let shotPower = state.power;
    if (holdingShot) {
      charge.holding = true;
      charge.seconds = Math.min(0.9, charge.seconds + dt);
      action = null;
      pressed = false;
      setPower(charge.seconds / 0.9);
    } else if (charge.holding) {
      action = !p2 && keys.down('KeyU') ? 'finesse' : 'shoot';
      pressed = true;
      shotPower = clamp(charge.seconds / 0.9, 0.18, 1);
      charge.holding = false;
      charge.seconds = 0;
      setPower(null);
    } else if (action === 'shoot') {
      shotPower = clamp(shotPower, 0.18, 0.85);
    }
    charging.current.set(id, charge);
    const hasBall = current.ball.y < 0.75 && distance(player, current.ball) < 0.64;
    let press = false;
    if (current.phase === 'live' && !hasBall) {
      if (action === 'pass' && !online && currentMode !== 'coop') {
        switchPlayer(current, player.team, state.move);
        action = null;
        pressed = false;
      } else if (action === 'pass') {
        action = null;
        pressed = false;
      }
      if (action === 'shoot') action = 'tackle';
      else if (action === 'through') action = 'slide';
      else if (action === 'lob') { action = null; press = true; }
    }
    return { move: state.move, sprint: state.sprint, action, pressed, press, power: shotPower, aim };
  };

  const finishMatch = (current: World) => {
    if (reported.current || current.phase !== 'full-time') return;
    reported.current = true;
    const room = onlineRef.current;
    const draw = current.score[0] === current.score[1];
    const winner: Team | null = draw ? null : current.score[0] > current.score[1] ? 0 : 1;
    if (room?.isHost) {
      const seats = winner === null ? undefined : winner === 0 ? [0, 2] : [1, 3];
      room.reportResult(room.round, seats?.[0] ?? null, seats);
    }
    const title = winner === null ? 'full time · draw' : online
      ? (teamForPlayer(room?.seat === undefined ? 0 : playerForSeat(room.seat)) === winner ? 'you win' : 'match over')
      : winner === localTeam ? 'you win' : 'match lost';
    const detail = `bay city ${current.score[0]} - ${current.score[1]} northshore · ${matchClock(current)}'`;
    shellRef.current.gameOver(undefined, { title, detail });
  };

  const update = (dt: number) => {
    const current = worldRef.current;
    const room = onlineRef.current;
    if (!current || shellRef.current.status !== 'playing') return;
    crowdIntensity.current = current.phase === 'goal'
      ? 1
      : 0.08 + Math.min(0.82, Math.max(0, (Math.abs(current.ball.x) - 7) / 13) * 0.75);
    const isOnlineGuest = !!room && !room.isHost;
    if (room) {
      for (const player of current.players) {
        const seat = player.id < 5 ? 2 * (player.id - 1) : 2 * (player.id - 6) + 1;
        const active = room.players.some((entry) => entry.seat === seat);
        player.human = active;
        player.controlled = active;
        if (!active) remoteCommands.current.delete(player.id);
      }
    }

    if (current.phase === 'goal' && !replaySkipped.current && keys.pressed(...commandKeys)) replaySkipped.current = true;
    if (current.phase === 'goal' && Math.hypot(movement.current.x, movement.current.z) > 0.2) replaySkipped.current = true;
    const userCommands = new Map<number, Command>();
    if (current.phase !== 'goal' && room && !room.watching) {
      const id = localPlayerIds[0];
      if (id !== undefined) userCommands.set(id, makeCommand(id, false, dt));
    } else if (current.phase !== 'goal' && !room) {
      localPlayerIds.forEach((id, index) => userCommands.set(id, makeCommand(id, index === 1, dt)));
    }

    if (isOnlineGuest && room && localPlayerIds.length) {
      const command = userCommands.get(localPlayerIds[0]!)!;
      if (command.action && command.pressed || command.press) pendingNetworkAction.current = command;
      inputTimer.current += dt;
      if (inputTimer.current >= 1 / 30) {
        inputTimer.current %= 1 / 30;
        const moveOnly = { ...command, ...(pendingNetworkAction.current ?? {}), move: command.move, sprint: command.sprint };
        room.send(movePacket(room.round || 1, inputSequence.current++, room.seat, moveOnly));
        pendingNetworkAction.current = null;
      }
    }

    if (!isOnlineGuest) {
      accumulator.current += dt;
      while (accumulator.current >= STEP) {
        simulationTime.current += STEP;
        const commands = new Map<number, Command>();
        for (const team of [0, 1] as const) {
          const generated = computeAI(current, levelRef.current, STEP, Math.floor(simulationTime.current / STEP), team);
          generated.forEach((command, id) => commands.set(id, command));
        }
        userCommands.forEach((command, id) => commands.set(id, { ...command }));
        if (room?.isHost) {
          remoteCommands.current.forEach((command, id) => {
            commands.set(id, { ...command });
            command.action = null;
            command.pressed = false;
            command.press = false;
          });
        }
        const previousPhase = current.phase;
        const previousScore = [...current.score];
        const previousEvent = current.event;
        stepWorld(current, STEP, commands);
        accumulator.current -= STEP;
        if (current.kickEvent || current.phase !== previousPhase || current.score.some((score, i) => score !== previousScore[i]) || current.event !== previousEvent) soundForWorld(current);
        if (current.phase === 'goal' && replayStartedAt.current === null) replayStartedAt.current = simulationTime.current;
        if (simulationTime.current - soundTime.current > 0.075) {
          appendReplayFrame(replayFrames.current, current, simulationTime.current);
          soundTime.current = simulationTime.current;
        }
        commands.forEach((command) => {
          command.action = null;
          command.pressed = false;
          command.press = false;
        });
      }
    }

    if (room?.isHost) {
      snapshotTimer.current += dt;
      if (snapshotTimer.current >= 0.05) {
        snapshotTimer.current %= 0.05;
        room.send({ t: 'soccer', k: 's', r: room.round || 1, seq: snapshotSequence.current++, state: cloneSnapshot(current) });
      }
    }

    let renderWorld = isOnlineGuest ? onlineRenderState(guestSnapshots.current, performance.now() / 1000, current) : current;
    let camera: CameraMode = cameraRef.current;
    const replayClock = isOnlineGuest ? performance.now() / 1000 : simulationTime.current;
    if (!replaySkipped.current && replayStartedAt.current !== null && current.phase === 'goal') {
      if (!replaySkipped.current) {
        const from = replayStartedAt.current - 2.4;
        const progress = clamp((replayClock - replayStartedAt.current) / 3, 0, 1);
        renderWorld = sampleReplay(replayFrames.current, from + progress * 2.4, current) ?? current;
        camera = 'replay';
      }
    }
    const selectedPlayerId = localPlayerIds[0] ?? current.controlled[0];
    const selected = current.players[selectedPlayerId]!;
    const target = current.players
      .filter((player) => player.team === selected.team && player.id !== selected.id)
      .sort((a, b) => distance(a, current.ball) - distance(b, current.ball))[0]?.id ?? null;
    viewRef.current?.update(renderWorld, dt, performance.now() / 1000, localTeam, camera, target);
    hudTimer.current += dt;
    if (hudTimer.current > 0.09) {
      hudTimer.current = 0;
      setHudWorld(structuredClone(current));
      setSelectedId(selectedPlayerId);
      setTargetId(target);
      setReplayActive(current.phase === 'goal' && !replaySkipped.current);
    }
    if (current.phase === 'full-time') finishMatch(current);
  };

  useGameLoop(update, () => viewRef.current?.render());

  return (
    <div className="g-soccer-stage">
      <div className="g-soccer-canvas" ref={ref} />
      <Hud world={hudWorld} power={power} targetId={targetId} selectedId={selectedId} watching={!!online?.watching} replaying={replayActive} />
      {shell.touch && shell.status === 'playing' && !online?.watching && <Stick movement={movement} />}
      {shell.touch && shell.status === 'playing' && !online?.watching && <TouchControls buttons={[
        { key: 'KeyJ', label: 'pass / switch' },
        { key: 'KeyK', label: 'shoot / tackle' },
        { key: 'KeyL', label: 'through / slide' },
        { key: 'KeyI', label: 'lob / press' },
        { key: 'KeyU', label: 'skill' },
        { key: 'ShiftLeft', label: 'sprint' },
      ]} />}
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  return <Play key={`${shell.round}-${online?.round ?? 0}-${online?.handoffs ?? 0}`} />;
}

export default function Soccer({ onExit, roomCode }: { onExit?: () => void; roomCode?: string }) {
  return (
    <GameShell
      meta={meta}
      className="g-soccer"
      onExit={onExit}
      roomCode={roomCode}
      setup={<Settings />}
      hostSetup={<Settings online />}
      defaultBots={2}
      botNames={['bay city bot', 'northshore bot', 'wing bot', 'keeper bot']}
      quickNote="2v2, normal bots, and three-minute halves."
      quickPool="2v2"
      soloLabel="play offline"
    >
      <Stage />
    </GameShell>
  );
}
