import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { GameShell, useShell, useKeys, useGameLoop, useCanvas, useThree, useOnline, useSetting, getSetting, Segmented, defineSetting, levelOptions, levelIndex, TouchControls, sfx } from '../../kit';
import type { LevelName } from '../../kit/controls';
import { meta } from './meta.ts';
import { computeAI, type Level } from './ai.ts';
import { chargePower, IDENTITY_BASIS, screenToWorld, gamepadInput, keyboardInput, reconcileControllers, type ControlCommand, type GamepadHistory } from './input.ts';
import { cloneSnapshot, commandFromPacket, consumeCommand, mergeRemoteCommand, movePacket, parsePacket } from './net.ts';
import { createWorld, distance, FIELD, teamOf, findReceiver, matchClock, nearestCarrier, stepWorld, STEP, teamDir, type Command, type Team, type World } from './logic.ts';
import { appendReplayFrame, createReplayWorld, sampleReplay, type ReplayFrame } from './replay.ts';
import { goalRoar, kickThump, netSwish, startCrowd, whistle } from './audio.ts';
import { createScene, type CameraMode, type SoccerView, type TimeMode } from './scene.ts';
import { Hud } from './hud.tsx';
import { clampOrigin, followOrigin, haptic, hitButton, STICK, stickVector, type PadPoint } from './pad.ts';
import { playerForSeat, type Mode } from './seats.ts';
import './soccer.css';
import QRCode from 'qrcode';

type Minutes = '2' | '4' | '6';
type Camera = 'broadcast' | 'end';
type Time = 'night' | 'golden';

const MODE = defineSetting<Mode>('soccer:mode', ['cpu', 'versus', 'coop'], 'cpu');
const HALF = defineSetting<Minutes>('soccer:half', ['2', '4', '6'], '4');
const LEVEL = defineSetting<LevelName>('soccer:level', ['easy', 'normal', 'hard'], 'normal');
const CAMERA = defineSetting<Camera>('soccer:camera', ['broadcast', 'end'], 'broadcast', { live: true });
const TIME = defineSetting<Time>('soccer:time', ['night', 'golden'], 'night', { live: true });
const DISPLAY_ONLY = defineSetting<'on' | 'off'>('soccer:display-only', ['on', 'off'], 'on');

const modeOptions = [['cpu', 'vs CPU'], ['versus', '2P versus'], ['coop', '2P co-op']] as const;
const halfOptions = [['2', '2 min'], ['4', '4 min'], ['6', '6 min']] as const;
const cameraOptions = [['broadcast', 'Broadcast'], ['end', 'End to end']] as const;
const timeOptions = [['night', 'Night'], ['golden', 'Golden hour']] as const;
const commandKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'KeyQ', 'KeyE', 'Space', 'Period', 'Slash', 'Semicolon', 'Quote', 'Comma', 'ShiftLeft', 'ShiftRight'];
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

function setupHumans(world: World, mode: Mode, online: ReturnType<typeof useOnline>) {
  const displayOnly = !!online;
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  if (online) {
    for (const member of online.players) {
      if (member.seat === 0 && displayOnly) continue;
      const player = world.players[playerForSeat(member.seat, displayOnly, mode)]!;
      player.human = true;
      player.controlled = true;
      const team = player.team;
      if (!world.players.some((p) => p.team === team && p.id !== player.id && p.human)) world.controlled[team] = player.id;
    }
    return;
  }
  const ids = mode === 'versus' ? [6, 17] : mode === 'coop' ? [6, 9] : [6];
  ids.forEach((id) => {
    world.players[id]!.human = true;
    world.players[id]!.controlled = true;
  });
  world.controlled[0] = 6;
  world.controlled[1] = 17;
}

function PhoneLobby() {
  const online = useOnline();
  const [mode, setMode] = useSetting(MODE);
  const [, setDisplayOnly] = useSetting(DISPLAY_ONLY);
  const [qr, setQr] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const startedCode = useRef('');
  const phones = online?.players.filter((player) => player.seat > 0) ?? [];
  const requiredPhones = mode === 'cpu' ? 1 : 2;
  useEffect(() => {
    if (!online?.code || typeof location === 'undefined') return;
    const url = `${location.protocol}//${location.host}/?game=soccer&room=${online.code}`;
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 2, width: 280 }).then(setQr).catch(() => setQr(''));
  }, [online?.code]);
  useEffect(() => {
    if (online?.isHost && getSetting(DISPLAY_ONLY) !== 'on') setDisplayOnly('on');
  }, [online?.isHost, setDisplayOnly]);
  useEffect(() => {
    if (!online?.isHost) {
      setCountdown(null);
      return;
    }
    if (online.round > 0) {
      startedCode.current = online.code;
      setCountdown(null);
      return;
    }
    if (startedCode.current === online.code || phones.length < requiredPhones) {
      setCountdown(null);
      return;
    }
    let seconds = 3;
    setCountdown(seconds);
    const timer = window.setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        window.clearInterval(timer);
        startedCode.current = online.code;
        setCountdown(null);
        online.start();
      } else {
        setCountdown(seconds);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [online?.code, online?.isHost, online?.players, online?.round, online?.start, phones.length, requiredPhones]);
  if (!online?.isHost) return null;
  const fallback = typeof location === 'undefined' ? '' : `${location.host}/?room=${online.code}`;
  const fallbackHref = typeof location === 'undefined' ? '' : `${location.protocol}//${fallback}`;
  return (
    <div className="g-soccer-phone-lobby">
      <div className="g-soccer-phone-qr">
        {qr && <img src={qr} alt="Phone controller QR code" />}
        <strong>Scan with your iPhone camera</strong>
      </div>
      <div className="g-soccer-phone-lobby-content">
        <div className="g-soccer-phone-connections" role="status">
          {Array.from({ length: requiredPhones }, (_, index) => phones[index]
            ? <span key={index}>Phone {index + 1} connected ✓</span>
            : <span className="is-waiting" key={index}>{index === 0 ? 'Waiting for phone…' : `Waiting for phone ${index + 1}…`}</span>)}
        </div>
        {countdown !== null && <strong className="g-soccer-phone-countdown" role="status">Starting in {countdown}…</strong>}
        <div className="g-soccer-phone-toggle" role="group" aria-label="How many phones">
          <button type="button" aria-pressed={mode === 'cpu'} onClick={() => setMode('cpu')}>1 phone · vs CPU</button>
          <button type="button" aria-pressed={mode !== 'cpu'} onClick={() => setMode(mode === 'coop' ? 'coop' : 'versus')}>2 phones</button>
        </div>
        {mode !== 'cpu' && (
          <div className="g-soccer-phone-toggle is-secondary" role="group" aria-label="Team setup">
            <button type="button" aria-pressed={mode === 'coop'} onClick={() => setMode('coop')}>Same team</button>
            <button type="button" aria-pressed={mode === 'versus'} onClick={() => setMode('versus')}>Against each other</button>
          </div>
        )}
        {fallback && <p className="g-soccer-phone-fallback">No camera? Go to <a href={fallbackHref}>{fallback}</a></p>}
        <details className="g-soccer-phone-settings">
          <summary>Settings</summary>
          <Settings online />
        </details>
      </div>
    </div>
  );
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
  const [modeChoice, setModeChoice] = useSetting(MODE);
  const [halfChoice, setHalfChoice] = useSetting(HALF);
  const [levelChoice, setLevelChoice] = useSetting(LEVEL);
  const [cameraChoice] = useSetting(CAMERA);
  const [timeChoice] = useSetting(TIME);
  const [power, setPower] = useState<number | null>(null);
  const [hudPower, setHudPower] = useState<number | null>(null);
  const [containing, setContaining] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState(6);
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
  const lastFrameTime = useRef<number | null>(null);
  const debugTimer = useRef(0);
  const debugConfig = useMemo(() => {
    if (typeof location === 'undefined') return { enabled: false, clockScale: 1 };
    const params = new URLSearchParams(location.search);
    const value = Number(params.get('soccerdebug'));
    return {
      enabled: params.has('soccerdebug'),
      clockScale: params.has('soccerdebug') && Number.isFinite(value) ? Math.max(1, Math.min(20, value)) : 1,
    };
  }, []);
  const replayFrames = useRef<ReplayFrame[]>([]);
  const replayWorld = useRef<World | null>(null);
  const replayStartedAt = useRef<number | null>(null);
  const replaySkipped = useRef(false);
  const hudTimer = useRef(0);
  const snapshotTimer = useRef(0);
  const snapshotSequence = useRef(0);
  const inputSequence = useRef(0);
  const inputTimer = useRef(0);
  const configSequence = useRef(0);
  const remoteCommands = useRef(new Map<number, Command>());
  const userCommands = useRef(new Map<number, Command>());
  const simulationCommands = useRef(new Map<number, Command>());
  const aiCommands = useRef<[Map<number, Command>, Map<number, Command>]>([new Map(), new Map()]);
  const lastRemoteSeq = useRef(new Map<number, number>());
  const guestSnapshots = useRef<NetworkFrame[]>([]);
  const pendingNetworkAction = useRef<Command | null>(null);
  const charging = useRef(new Map<number, { holding: boolean; action: Command['action']; seconds: number }>());
  const lastScore = useRef<[number, number]>([0, 0]);
  const reported = useRef(false);
  const lastEvent = useRef('');
  const soundTime = useRef(0);
  const crowdIntensity = useRef(0.12);
  const renderDirty = useRef(true);
  const guestRenderTimer = useRef(0);
  const gamepadPrevious = useRef<Record<number, GamepadHistory>>({});
  const controllerPlayers = useRef(new Map<number, number>());
  const powerUiTimer = useRef(0);
  const displayOnlyRoom = useRef(getSetting(DISPLAY_ONLY) === 'on');
  shellRef.current = shell;
  onlineRef.current = online;
  if (online) displayOnlyRoom.current = true;
  levelRef.current = online?.quick ? 'normal' : levelChoice;
  cameraRef.current = cameraChoice;
  timeRef.current = timeChoice;

  const halfMinutes = online?.quick ? 3 : Number(halfChoice);
  const currentMode: Mode = modeChoice;
  if (!worldRef.current) {
    worldRef.current = createWorld(Math.floor(Date.now() % 0xffff_ffff), halfMinutes * 60, currentMode === 'coop' ? 2 : 1);
    setupHumans(worldRef.current, currentMode, online);
  }
  if (!replayWorld.current) replayWorld.current = createReplayWorld(worldRef.current);
  const world = worldRef.current!;
  const localPlayerIds = online ? online.seat < 0 || (online.isHost && displayOnlyRoom.current) ? [] : [controllerPlayers.current.get(online.seat) ?? playerForSeat(online.seat, displayOnlyRoom.current, currentMode)] : currentMode === 'versus' ? [world.controlled[0], world.controlled[1]] : currentMode === 'coop' ? [controllerPlayers.current.get(0) ?? 6, controllerPlayers.current.get(1) ?? 9] : [world.controlled[0]];
  const localTeam = localPlayerIds.length ? teamOf(localPlayerIds[0]!) : 0;

  useEffect(() => {
    if (shell.status !== 'ready') return;
    const fresh = createWorld(Math.floor(Date.now() % 0xffff_ffff), halfMinutes * 60, currentMode === 'coop' ? 2 : 1);
    controllerPlayers.current.clear();
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
    renderDirty.current = true;
    shell.invalidate();
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    viewRef.current?.resize(size.w, size.h);
    renderDirty.current = true;
    shell.invalidate();
  }, [size.w, size.h, shell]);

  useEffect(() => {
    viewRef.current?.setTime(timeChoice === 'golden' ? 'golden' : 'night');
    renderDirty.current = true;
    shell.invalidate();
  }, [timeChoice, shell]);

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
        const current = worldRef.current;
        const player = current?.players[controllerPlayers.current.get(from) ?? playerForSeat(from, displayOnlyRoom.current, currentMode)];
        if (!current || !player || !player.human) return;
        const command = commandFromPacket(packet);
        if (displayOnlyRoom.current) {
          const basis = viewRef.current?.viewBasis() ?? IDENTITY_BASIS;
          command.move = screenToWorld(command.move, basis);
          if (command.switchDir) command.switchDir = screenToWorld(command.switchDir, basis);
          const aim = screenToWorld(command.aim ?? { x: 0, z: 0 }, basis);
          command.aim = Math.hypot(aim.x, aim.z) > 0.05
            ? aim
            : { x: teamDir(player.team, current.endsSwapped), z: 0 };
        }
        remoteCommands.current.set(player.id, mergeRemoteCommand(remoteCommands.current.get(player.id), command));
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
        renderDirty.current = true;
        return;
      }
      if (!room.isHost && from === 0 && packet.k === 'cfg') {
        levelRef.current = (['easy', 'normal', 'hard'] as const)[packet.level]!;
        displayOnlyRoom.current = true;
        setLevelChoice((['easy', 'normal', 'hard'] as const)[packet.level]!);
        setHalfChoice(String(packet.half) as Minutes);
        if (packet.mode) setModeChoice(packet.mode);
      }
    });
    return off;
  }, [online, online?.round, online?.isHost, setHalfChoice, setLevelChoice, setModeChoice]);

  useEffect(() => {
    if (!online?.isHost) return;
    const sendConfig = () => onlineRef.current?.send({
      t: 'soccer', k: 'cfg', r: onlineRef.current?.round || 1, seq: configSequence.current++,
      half: onlineRef.current?.quick ? 3 : Number(halfChoice) as 2 | 4 | 6,
      level: onlineRef.current?.quick ? 1 : levelIndex(levelChoice),
      displayOnly: true,
      mode: modeChoice,
    });
    sendConfig();
    const timer = window.setInterval(sendConfig, 1500);
    return () => window.clearInterval(timer);
  }, [online?.isHost, online?.round, online?.quick, halfChoice, levelChoice, modeChoice]);

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

  const makeCommand = (id: number, p2: boolean, dt: number): ControlCommand => {
    const state = keyboardInput(keys, p2, !p2 && !online && currentMode === 'cpu');
    const current = worldRef.current!;
    const player = current.players[id]!;
    const defending = nearestCarrier(current)?.team !== player.team;
    state.autoJockey ||= shell.touch;
    const padIndex = p2 ? 1 : 0;
    const pad = typeof navigator !== 'undefined' ? navigator.getGamepads?.()[padIndex] : null;
    if (pad) {
      const mapped = gamepadInput(pad, gamepadPrevious.current[padIndex], defending);
      gamepadPrevious.current[padIndex] = mapped.previous;
      const input = mapped.state;
      if (Math.hypot(input.move.x, input.move.z) > 0.14) state.move = input.move;
      if (input.action) { state.action = input.action; state.pressed = input.pressed; }
      state.heldAction ||= input.heldAction;
      state.sprint ||= input.sprint; state.jockey ||= input.jockey;
      state.finesseHeld ||= input.finesseHeld; state.press ||= input.press;
      state.contain ||= input.contain; state.switchNearest ||= input.switchNearest; state.switchDir = input.switchDir;
    }
    if (!p2 && Math.hypot(movement.current.x, movement.current.z) > 0.05 && shell.touch) {
      state.move = { ...movement.current };
    }
    const basis = viewRef.current?.viewBasis() ?? IDENTITY_BASIS;
    state.move = screenToWorld(state.move, basis);
    if (state.switchDir) state.switchDir = screenToWorld(state.switchDir, basis);
    const aim = Math.hypot(state.move.x, state.move.z) > 0.05
      ? { ...state.move }
      : { x: teamDir(player.team, current.endsSwapped), z: 0 };
    const charge = charging.current.get(id) ?? { holding: false, action: null, seconds: 0 };
    let action = state.action;
    let pressed = state.pressed;
    let shotPower = 0.1;
    const defensiveAction = defending && nearestCarrier(current) && ['shoot', 'lob', 'through'].includes(state.heldAction ?? '');
    if (state.heldAction && !defensiveAction && !charge.holding) {
      charge.holding = true;
      charge.action = state.heldAction;
      charge.seconds = 0;
    }
    if (charge.holding && state.heldAction === charge.action) {
      charge.seconds = Math.min(1, charge.seconds + dt);
      action = null;
      pressed = false;
      shotPower = chargePower(charge.seconds);
      powerUiTimer.current += dt;
      if (powerUiTimer.current >= 1 / 30) {
        powerUiTimer.current %= 1 / 30;
        setPower(chargePower(charge.seconds));
      }
    } else if (charge.holding) {
      action = charge.action === 'shoot' && state.finesseHeld ? 'finesse' : charge.action;
      pressed = true;
      shotPower = chargePower(charge.seconds);
      charge.holding = false;
      charge.action = null;
      charge.seconds = 0;
      powerUiTimer.current = 0;
      setPower(null);
    } else if (action) {
      shotPower = 0.1;
    }
    charging.current.set(id, charge);
    return { ...state, action, heldAction: charge.holding ? state.heldAction : null, contain: defending && state.heldAction === 'pass', pressed, power: shotPower, aim };
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
      ? (teamOf(room?.seat === undefined ? 0 : playerForSeat(room.seat, displayOnlyRoom.current, currentMode)) === winner ? 'you win' : 'match over')
      : winner === localTeam ? 'you win' : 'match lost';
    const detail = `bay city ${current.score[0]} - ${current.score[1]} northshore · ${matchClock(current)}'`;
    shellRef.current.gameOver(undefined, { title, detail });
  };

  const update = (loopDt: number) => {
    const now = performance.now();
    const previousFrame = lastFrameTime.current;
    const dt = loopDt <= 0 ? 0 : Math.min(0.75, Math.max(0, previousFrame === null ? loopDt : (now - previousFrame) / 1000));
    lastFrameTime.current = now;
    const current = worldRef.current;
    const room = onlineRef.current;
    if (!current || shellRef.current.status !== 'playing') return;
    crowdIntensity.current = current.phase === 'goal'
      ? 1
      : 0.08 + Math.min(0.82, Math.max(0, (Math.abs(current.ball.x) - FIELD.penaltyDepth * 0.42) / (FIELD.length / 2 - FIELD.penaltyDepth * 0.42)) * 0.75);
    const isOnlineGuest = !!room && !room.isHost;
    controllerPlayers.current = reconcileControllers(current, controllerPlayers.current);
    if (room) {
      for (const [seat, id] of controllerPlayers.current) {
        if (room.players.some((entry) => entry.seat === seat)) continue;
        const player = current.players[id];
        if (player) { player.human = false; player.controlled = false; }
        controllerPlayers.current.delete(seat); remoteCommands.current.delete(id);
      }
      for (const entry of room.players) {
        if (entry.seat === 0 && displayOnlyRoom.current || entry.seat < 0) continue;
        if (!controllerPlayers.current.has(entry.seat)) {
          const preferred = playerForSeat(entry.seat, displayOnlyRoom.current, currentMode);
          const occupied = [...controllerPlayers.current.values()];
          const id = occupied.includes(preferred) ? current.players.find((p) => p.team === teamOf(preferred) && !occupied.includes(p.id))?.id : preferred;
          if (id !== undefined) controllerPlayers.current.set(entry.seat, id);
        }
        const player = current.players[controllerPlayers.current.get(entry.seat)!];
        if (player) { player.human = true; player.controlled = true; }
      }
    } else if (currentMode === 'coop' && controllerPlayers.current.size === 0) {
      controllerPlayers.current.set(0, 6); controllerPlayers.current.set(1, 9);
    }

    if (current.phase === 'goal' && !replaySkipped.current && keys.pressed(...commandKeys)) replaySkipped.current = true;
    if (current.phase === 'goal' && Math.hypot(movement.current.x, movement.current.z) > 0.2) replaySkipped.current = true;
    const commandsForUsers = userCommands.current;
    commandsForUsers.clear();
    if (current.phase !== 'goal' && room && !room.watching) {
      const id = controllerPlayers.current.get(room.seat) ?? localPlayerIds[0];
      if (id !== undefined) commandsForUsers.set(id, makeCommand(id, false, dt));
    } else if (current.phase !== 'goal' && !room) {
      for (let i = 0; i < localPlayerIds.length; i++) {
        const id = controllerPlayers.current.get(i) ?? localPlayerIds[i]!;
        commandsForUsers.set(id, makeCommand(id, i === 1, dt));
      }
    }

    if (isOnlineGuest && room && localPlayerIds.length) {
      const command = commandsForUsers.get(localPlayerIds[0]!)!;
      if (command.action && command.pressed || command.switchNearest || command.switchDir) pendingNetworkAction.current = command;
      inputTimer.current += dt;
      if (inputTimer.current >= 1 / 30) {
        inputTimer.current %= 1 / 30;
        const pending = pendingNetworkAction.current;
        const moveOnly = { ...command, ...(pending ? { action: pending.action, pressed: pending.pressed, power: pending.power, aim: pending.aim, switchNearest: pending.switchNearest, switchDir: pending.switchDir } : {}) };
        room.send(movePacket(room.round || 1, inputSequence.current++, room.seat, moveOnly));
        pendingNetworkAction.current = null;
      }
    }

    if (!isOnlineGuest) {
      accumulator.current += dt;
      let stepped = false;
      while (accumulator.current >= STEP) {
        stepped = true;
        simulationTime.current += STEP;
        const commands = simulationCommands.current;
        commands.clear();
        for (const team of [0, 1] as const) {
          const generated = computeAI(current, levelRef.current, STEP, Math.floor(simulationTime.current / STEP), team, aiCommands.current[team]);
          for (const [id, command] of generated) commands.set(id, command);
        }
        for (const [id, command] of commandsForUsers) commands.set(id, command);
        if (room?.isHost) {
          for (const [id, command] of remoteCommands.current) {
            commands.set(id, { ...command });
            Object.assign(command, consumeCommand(command));
          }
        }
        const previousPhase = current.phase;
        const previousScore0 = current.score[0];
        const previousScore1 = current.score[1];
        const previousEvent = current.event;
        stepWorld(current, STEP, commands, debugConfig.clockScale);
        const assignments = reconcileControllers(current, controllerPlayers.current);
        for (const [seat, id] of assignments) {
          const old = controllerPlayers.current.get(seat);
          if (old === undefined || old === id) continue;
          const heldCommand = remoteCommands.current.get(old);
          remoteCommands.current.delete(old);
          if (heldCommand) remoteCommands.current.set(id, heldCommand);
        }
        controllerPlayers.current = assignments;
        accumulator.current -= STEP;
        if (current.kickEvent || current.phase !== previousPhase || current.score[0] !== previousScore0 || current.score[1] !== previousScore1 || current.event !== previousEvent) soundForWorld(current);
        if (current.phase === 'goal' && replayStartedAt.current === null) replayStartedAt.current = simulationTime.current;
        if (simulationTime.current - soundTime.current > 0.075) {
          appendReplayFrame(replayFrames.current, current, simulationTime.current);
          soundTime.current = simulationTime.current;
        }
        for (const command of commands.values()) {
          Object.assign(command, consumeCommand(command));
        }
      }
      if (stepped) renderDirty.current = true;
    } else {
      guestRenderTimer.current += dt;
      if (guestRenderTimer.current >= 1 / 30) {
        guestRenderTimer.current %= 1 / 30;
        renderDirty.current = true;
      }
    }

    if (room?.isHost) {
      snapshotTimer.current += dt;
      if (snapshotTimer.current >= 0.05) {
        snapshotTimer.current %= 0.05;
        room.send({ t: 'soccer', k: 's', r: room.round || 1, seq: snapshotSequence.current++, state: cloneSnapshot(current) });
      }
    }

    if (debugConfig.enabled) {
      debugTimer.current += dt;
      if (debugTimer.current >= 1) {
        debugTimer.current %= 1;
        const state = {
          phase: current.phase,
          clock: current.clock,
          matchMinute: matchClock(current),
          clockScale: debugConfig.clockScale,
          half: current.half,
          controlled: [...current.controlled],
          ball: { x: current.ball.x, y: current.ball.y, z: current.ball.z, vx: current.ball.vx, vz: current.ball.vz },
          passTarget: current.passTarget,
          players: current.players.map(({ id, x, z, controlled, human }) => ({ id, x, z, controlled, human })),
        };
        (window as Window & { __soccerDebugState?: typeof state }).__soccerDebugState = state;
        console.info('[soccerdebug-state]', { phase: state.phase, clock: Number(state.clock.toFixed(2)), half: state.half, controlled: state.controlled, players: state.players });
      }
    }

    let renderWorld = isOnlineGuest ? onlineRenderState(guestSnapshots.current, performance.now() / 1000, current) : current;
    let camera: CameraMode = cameraRef.current;
    const replayClock = isOnlineGuest ? performance.now() / 1000 : simulationTime.current;
    if (!replaySkipped.current && replayStartedAt.current !== null && current.phase === 'goal') {
      if (!replaySkipped.current) {
        const from = replayStartedAt.current - 2.4;
        const progress = clamp((replayClock - replayStartedAt.current) / 3, 0, 1);
        renderWorld = sampleReplay(replayFrames.current, from + progress * 2.4, current, replayWorld.current) ?? current;
        camera = 'replay';
      }
    }
    const selectedPlayerId = controllerPlayers.current.get(room?.seat ?? 0) ?? localPlayerIds[0] ?? current.controlled[0];
    const selected = current.players[selectedPlayerId]!;
    const aiming = charging.current.get(selectedPlayerId);
    const selectedCommand = commandsForUsers.get(selectedPlayerId);
    let target = current.passTarget;
    if (target === null && aiming?.holding && (aiming.action === 'pass' || aiming.action === 'through' || aiming.action === 'lob')
      && current.ball.y < 0.75 && distance(selected, current.ball) < 0.8) {
      const aim = selectedCommand?.aim ?? { x: Math.sin(selected.facing), z: Math.cos(selected.facing) };
      target = findReceiver(current, selected, aim, aiming.action === 'through')?.id ?? null;
    }
    if (target === null) {
      let nearest: World['players'][number] | null = null;
      let nearestDistance = Infinity;
      for (const player of current.players) {
        if (player.team !== selected.team || player.id === selected.id) continue;
        const d = distance(player, current.ball);
        if (d < nearestDistance) { nearest = player; nearestDistance = d; }
      }
      target = nearest?.id ?? null;
    }
    const remote = remoteCommands.current.get(selectedPlayerId);
    const indicatorPower = power ?? (remote?.heldAction ? remote.power ?? null : null);
    viewRef.current?.update(renderWorld, dt, performance.now() / 1000, localTeam, camera, target, indicatorPower);
    hudTimer.current += dt;
    if (hudTimer.current > 0.09) {
      hudTimer.current = 0;
      setHudWorld(structuredClone(current));
      setHudPower(indicatorPower);
      setContaining(!!(selectedCommand?.contain || remote?.contain));
      setSelectedId(selectedPlayerId);
      setTargetId(target);
      setReplayActive(current.phase === 'goal' && !replaySkipped.current);
    }
    if (current.phase === 'full-time') finishMatch(current);
  };

  useGameLoop(update, () => {
    if (!renderDirty.current) return;
    viewRef.current?.render();
    renderDirty.current = false;
  });

  return (
    <div className="g-soccer-stage">
      <div className="g-soccer-canvas" ref={ref} />
      <Hud world={hudWorld} targetId={targetId} selectedId={selectedId} power={power ?? hudPower} contain={containing} watching={!!online?.watching} replaying={replayActive} />
      {shell.touch && shell.status === 'playing' && !online?.watching && <Stick movement={movement} />}
      {shell.touch && shell.status === 'playing' && !online?.watching && <TouchControls buttons={[
        { key: 'KeyJ', label: 'pass / contain' },
        { key: 'KeyK', label: 'shoot / tackle' },
        { key: 'KeyL', label: 'through' },
        { key: 'KeyI', label: 'lob / slide' },
        { key: 'KeyU', label: 'skill / finesse' },
        { key: 'KeyQ', label: 'switch' },
        { key: 'KeyE', label: 'press' },
        { key: 'Space', label: 'jockey' },
        { key: 'ShiftLeft', label: 'sprint' },
      ]} />}
    </div>
  );
}

type FaceKey = 'a' | 'b' | 'x' | 'y';
const FACE_KEYS: readonly FaceKey[] = ['y', 'x', 'b', 'a'];
const FACE: Record<FaceKey, Command['action']> = { a: 'pass', b: 'shoot', x: 'lob', y: 'through' };

function markPressed(element: HTMLElement | null | undefined, pressed: boolean) {
  if (!element) return;
  if (pressed) element.dataset.pressed = '';
  else delete element.dataset.pressed;
}

function markFired(element: HTMLElement | null | undefined) {
  if (!element) return;
  delete element.dataset.fired;
  void element.offsetWidth;
  element.dataset.fired = '';
}

/** Floating stick: the base jumps to wherever the thumb lands in the zone, then follows it past max travel. */
function PadStick({ movement }: { movement: { current: { x: number; z: number } } }) {
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLElement>(null);
  const pointer = useRef<number | null>(null);
  const origin = useRef<PadPoint>({ x: 0, y: 0 });
  const metrics = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const size = base.current?.offsetWidth ?? 0;
    return { rect, margin: size / 2, travel: size * STICK.travel, thumb: { x: event.clientX - rect.left, y: event.clientY - rect.top } };
  };
  const draw = (thumb: PadPoint, travel: number) => {
    const { knob: offset, move } = stickVector(thumb.x - origin.current.x, thumb.y - origin.current.y, travel);
    movement.current = move;
    if (base.current) {
      base.current.style.left = `${origin.current.x}px`;
      base.current.style.top = `${origin.current.y}px`;
    }
    if (knob.current) knob.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    movement.current = { x: 0, z: 0 };
    if (base.current) {
      base.current.style.left = '';
      base.current.style.top = '';
      delete base.current.dataset.active;
    }
    if (knob.current) knob.current.style.transform = '';
  };
  return (
    <div
      ref={zone}
      className="g-soccer-pad-stickzone"
      role="application"
      aria-label="Movement stick: touch anywhere on the left half and drag"
      onPointerDown={(event) => {
        if (pointer.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        const { rect, margin, travel, thumb } = metrics(event);
        origin.current = clampOrigin(thumb, rect.width, rect.height, margin);
        if (base.current) base.current.dataset.active = '';
        haptic(8);
        draw(thumb, travel);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== event.pointerId) return;
        const { rect, margin, travel, thumb } = metrics(event);
        origin.current = clampOrigin(followOrigin(origin.current, thumb, travel), rect.width, rect.height, margin);
        draw(thumb, travel);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={base} className="g-soccer-pad-stick"><i ref={knob} /></div>
    </div>
  );
}

function PhoneController() {
  const online = useOnline();
  const movement = useRef({ x: 0, z: 0 });
  const held = useRef<Command['action']>(null);
  const sprint = useRef(false);
  const sequence = useRef(0);
  const phoneWorld = useRef<World | null>(null);
  const shoulder = useRef(false);
  const jockey = useRef(false);
  const faceRefs = useRef<Partial<Record<FaceKey, HTMLButtonElement | null>>>({});
  const facePointers = useRef(new Map<number, FaceKey | null>());
  const [attacking, setAttacking] = useState(false);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const previousScore = useRef<[number, number]>([0, 0]);
  const [displayOnly, setDisplayOnly] = useState(true);
  const [mode, setMode] = useState<Mode>('cpu');
  const [showGame, setShowGame] = useState(false);
  const [showConnectedToast, setShowConnectedToast] = useState(true);
  const [chargeProgress, setChargeProgress] = useState(0);
  const [chargingAction, setChargingAction] = useState<Command['action']>(null);
  const chargeStartedAt = useRef<number | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtml = { overflow: html.style.overflow, touchAction: html.style.touchAction, userSelect: html.style.userSelect, webkitUserSelect: html.style.getPropertyValue('-webkit-user-select') };
    const previousBody = { overflow: body.style.overflow, touchAction: body.style.touchAction, userSelect: body.style.userSelect, webkitUserSelect: body.style.getPropertyValue('-webkit-user-select') };
    const previousHtmlCallout = html.style.getPropertyValue('-webkit-touch-callout');
    const previousBodyCallout = body.style.getPropertyValue('-webkit-touch-callout');
    const chrome = [...document.querySelectorAll<HTMLElement>('.statusbar, .dock-wrap, .menubar, .win-arcade > .mbar, .win-arcade > .traffic, .win-arcade > .titlebar')]
      .map((element) => ({ element, display: element.style.display }));
    const arcadeWindow = document.querySelector<HTMLElement>('.win-arcade');
    const arcadeStyle = arcadeWindow?.getAttribute('style') ?? null;
    const arcadeBody = arcadeWindow?.querySelector<HTMLElement>(':scope > .win-body');
    const arcadeBodyStyle = arcadeBody?.getAttribute('style') ?? null;
    for (const item of chrome) item.element.style.display = 'none';
    if (arcadeWindow) {
      Object.assign(arcadeWindow.style, { position: 'fixed', inset: '0', width: '100vw', height: '100dvh', zIndex: '2147483000', borderRadius: '0', transform: 'none' });
    }
    if (arcadeBody) Object.assign(arcadeBody.style, { top: '0', inset: '0', padding: '0' });
    html.style.overflow = 'hidden';
    html.style.touchAction = 'none';
    html.style.userSelect = 'none';
    html.style.setProperty('-webkit-user-select', 'none');
    html.style.setProperty('-webkit-touch-callout', 'none');
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    body.style.userSelect = 'none';
    body.style.setProperty('-webkit-user-select', 'none');
    body.style.setProperty('-webkit-touch-callout', 'none');
    let live = true;
    let lock: { release: () => Promise<void> } | null = null;
    const requestWakeLock = async () => {
      if (!live || document.visibilityState !== 'visible' || lock) return;
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        lock = await wakeLock?.request('screen') ?? null;
      } catch {}
    };
    const preventGesture = (event: Event) => event.preventDefault();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lock = null;
        void requestWakeLock();
      } else {
        lock = null;
      }
    };
    const preventScroll = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('touchmove', preventScroll, { passive: false });
    document.addEventListener('dblclick', preventGesture, { passive: false });
    document.addEventListener('selectstart', preventGesture);
    document.addEventListener('contextmenu', preventGesture);
    document.addEventListener('visibilitychange', onVisibility);
    void requestWakeLock();
    return () => {
      live = false;
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('touchmove', preventScroll);
      document.removeEventListener('dblclick', preventGesture);
      document.removeEventListener('selectstart', preventGesture);
      document.removeEventListener('contextmenu', preventGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => {});
      Object.assign(html.style, previousHtml);
      Object.assign(body.style, previousBody);
      html.style.setProperty('-webkit-user-select', previousHtml.webkitUserSelect);
      body.style.setProperty('-webkit-user-select', previousBody.webkitUserSelect);
      html.style.setProperty('-webkit-touch-callout', previousHtmlCallout);
      body.style.setProperty('-webkit-touch-callout', previousBodyCallout);
      for (const item of chrome) item.element.style.display = item.display;
      if (arcadeWindow) {
        if (arcadeStyle === null) arcadeWindow.removeAttribute('style');
        else arcadeWindow.setAttribute('style', arcadeStyle);
      }
      if (arcadeBody) {
        if (arcadeBodyStyle === null) arcadeBody.removeAttribute('style');
        else arcadeBody.setAttribute('style', arcadeBodyStyle);
      }
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowConnectedToast(false), 2200);
    return () => window.clearTimeout(timer);
  }, []);
  const phoneHasBall = () => {
    const snapshot = phoneWorld.current;
    return !!snapshot && nearestCarrier(snapshot)?.team === teamOf(playerForSeat(online?.seat ?? 0, displayOnly, mode));
  };
  const send = (action: Command['action'] = null, pressed = false, power = chargePower(chargeStartedAt.current === null ? 0 : (performance.now() - chargeStartedAt.current) / 1000), switchNearest = false) => {
      if (!online) return;
    online.send(movePacket(online.round || 1, sequence.current++, online.seat, {
      move: movement.current,
      sprint: sprint.current,
      jockey: jockey.current,
      action: action === 'shoot' && shoulder.current && phoneHasBall() ? 'finesse' : action,
      heldAction: held.current,
      pressed,
      power,
      autoJockey: true,
      contain: !phoneHasBall() && held.current === 'pass',
      finesseHeld: shoulder.current,
      press: shoulder.current,
      switchNearest,
      aim: movement.current,
    }), { fast: true });
  };
  const beginCharge = (action: Command['action']) => {
    if (!phoneHasBall() && phoneWorld.current && nearestCarrier(phoneWorld.current) && action !== 'pass') {
      send(action, true);
      return;
    }
    held.current = action;
    chargeStartedAt.current = performance.now();
    setChargingAction(action);
    setChargeProgress(0);
    send(null, false);
  };
  const releaseCharge = (action: Command['action'], vibrate = true) => {
    if (chargeStartedAt.current !== null && held.current !== action) return;
    const started = chargeStartedAt.current;
    const power = chargePower(started === null ? 0 : (performance.now() - started) / 1000);
    held.current = null;
    chargeStartedAt.current = null;
    setChargingAction(null);
    setChargeProgress(0);
    send(started !== null && vibrate ? action : null, started !== null && vibrate, power);
    if (vibrate && started !== null) haptic(18);
  };
  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, data) => {
      if (from !== 0) return;
      const packet = parsePacket(data);
      if (packet?.k === 's') {
        phoneWorld.current = packet.state;
        setAttacking(nearestCarrier(packet.state)?.team === teamOf(playerForSeat(online.seat, displayOnly, mode)));
        if (packet.state.score.some((value, index) => value !== previousScore.current[index])) navigator.vibrate?.([70, 40, 120]);
        previousScore.current = [...packet.state.score];
        setScore(packet.state.score);
      } else if (packet?.k === 'cfg') {
        setDisplayOnly(true);
        if (packet.mode) setMode(packet.mode);
      }
    });
    const timer = window.setInterval(() => {
      send();
      if (chargeStartedAt.current !== null) setChargeProgress(Math.min(1, (performance.now() - chargeStartedAt.current) / 1000));
    }, 1000 / 30);
    return () => { off(); window.clearInterval(timer); };
  }, [online, mode, displayOnly]);
  if (!online) return null;
  const phonePlayer = playerForSeat(online.seat, displayOnly, mode);
  const myTeam = teamOf(phonePlayer);
  if (showGame) return <><Play key={`phone-game-${online.round ?? 0}`} /><button className="g-soccer-phone-show" type="button" onClick={() => setShowGame(false)}>Controller</button></>;
  const chargeName = chargingAction === 'pass' ? 'Pass' : chargingAction === 'shoot' ? 'Shoot' : chargingAction === 'through' ? 'Through' : chargingAction === 'lob' ? 'Lob' : chargingAction === 'skill' ? 'Skill' : 'Hold to charge';
  const chargingKey = FACE_KEYS.find((key) => FACE[key] === chargingAction) ?? null;
  const faceLabel: Record<FaceKey, string> = attacking
    ? { a: 'Pass', b: 'Shoot', x: 'Lob · Cross', y: 'Through' }
    : { a: 'Switch', b: 'Tackle', x: 'Slide', y: 'Through' };
  const faceHint: Partial<Record<FaceKey, string>> = attacking ? {} : { a: 'hold Contain' };
  const faceAt = (event: PointerEvent<HTMLElement>) => hitButton({ x: event.clientX, y: event.clientY }, FACE_KEYS.flatMap((id) => {
    const rect = faceRefs.current[id]?.getBoundingClientRect();
    return rect ? [{ id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 }] : [];
  }));
  const pressFace = (key: FaceKey) => {
    markPressed(faceRefs.current[key], true);
    haptic(10);
    beginCharge(FACE[key]);
  };
  const releaseFace = (key: FaceKey, fire: boolean) => {
    const element = faceRefs.current[key];
    markPressed(element, false);
    if (fire) markFired(element);
    releaseCharge(FACE[key], fire);
  };
  const endFace = (event: PointerEvent<HTMLElement>, fire: boolean) => {
    if (!facePointers.current.has(event.pointerId)) return;
    const key = facePointers.current.get(event.pointerId);
    facePointers.current.delete(event.pointerId);
    if (key) releaseFace(key, fire);
  };
  const pad = (name: string, down: () => void, up?: () => void) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      markPressed(event.currentTarget, true);
      haptic(8);
      down();
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => { markPressed(event.currentTarget, false); up?.(); },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => { markPressed(event.currentTarget, false); up?.(); },
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    'aria-label': name,
    tabIndex: -1,
    type: 'button' as const,
  });
  const hold = (flag: { current: boolean }) => [() => { flag.current = true; send(); }, () => { flag.current = false; send(); }] as const;
  const [jockeyDown, jockeyUp] = hold(jockey);
  const [bumperDown, bumperUp] = hold(shoulder);
  const [sprintDown, sprintUp] = hold(sprint);
  const ltLabel = attacking ? 'Shield' : 'Jockey';
  const lbLabel = attacking ? 'Skill' : 'Switch';
  const rbLabel = attacking ? 'Finesse' : 'Press';
  return (
    <div className={`g-soccer-phone-controller g-soccer-pad ${attacking ? 'is-attack' : 'is-defend'}`}>
      <div className="g-soccer-pad-body" aria-hidden="true"><i className="is-left" /><i className="is-right" /></div>
      {showConnectedToast && <div className="g-soccer-phone-connected" role="status">Connected — look at your Mac</div>}
      <PadStick movement={movement} />
      <div
        className="g-soccer-pad-face"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const key = faceAt(event);
          facePointers.current.set(event.pointerId, key);
          if (key) pressFace(key);
        }}
        onPointerMove={(event) => {
          if (!facePointers.current.has(event.pointerId)) return;
          const key = faceAt(event);
          const previous = facePointers.current.get(event.pointerId) ?? null;
          if (!key || key === previous) return;
          if (previous) releaseFace(previous, true);
          facePointers.current.set(event.pointerId, key);
          pressFace(key);
        }}
        onPointerUp={(event) => endFace(event, true)}
        onPointerCancel={(event) => endFace(event, false)}
        onLostPointerCapture={(event) => endFace(event, false)}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="g-soccer-pad-diamond">
          {FACE_KEYS.map((key) => (
            <button
              key={key}
              ref={(element) => { faceRefs.current[key] = element; }}
              type="button"
              tabIndex={-1}
              className={`g-soccer-pad-btn is-${key}${chargingKey === key ? ' is-charging' : ''}${chargingKey === key && chargeProgress > 0.85 ? ' is-over' : ''}`}
              style={chargingKey === key ? { '--charge': chargeProgress.toFixed(3) } as CSSProperties : undefined}
              aria-label={`${key.toUpperCase()}: ${faceLabel[key]}${faceHint[key] ? `, ${faceHint[key]}` : ''}`}
            >
              <b>{key.toUpperCase()}</b>
              <small>{faceLabel[key]}</small>
              {faceHint[key] && <em>{faceHint[key]}</em>}
            </button>
          ))}
        </div>
      </div>
      <div className="g-soccer-pad-shoulders is-left">
        <button className="g-soccer-pad-trigger" {...pad(`LT: ${ltLabel} (hold)`, jockeyDown, jockeyUp)}><b>LT</b><small>{ltLabel}</small></button>
        <button className="g-soccer-pad-bumper" {...pad(`LB: ${lbLabel}`, () => send(attacking ? 'skill' : null, attacking, 0.1, !attacking))}><b>LB</b><small>{lbLabel}</small></button>
      </div>
      <div className="g-soccer-pad-shoulders is-right">
        <button className="g-soccer-pad-bumper" {...pad(`RB: ${rbLabel} (hold)`, bumperDown, bumperUp)}><b>RB</b><small>{rbLabel}</small></button>
        <button className="g-soccer-pad-trigger" {...pad('RT: Sprint (hold)', sprintDown, sprintUp)}><b>RT</b><small>Sprint</small></button>
      </div>
      <div className="g-soccer-pad-strip">
        <div className="g-soccer-pad-score" aria-label={`Bay City ${score[0]}, Northshore ${score[1]}`}>
          <span className={myTeam === 0 ? 'is-mine' : undefined}>BAY CITY</span>
          <strong>{score[0]}<i>–</i>{score[1]}</strong>
          <span className={myTeam === 1 ? 'is-mine' : undefined}>NORTHSHORE</span>
        </div>
        <div className={`g-soccer-pad-meter${chargeProgress > 0.85 ? ' is-over' : ''}`} role="progressbar" aria-label={`${chargeName} power`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(chargeProgress * 100)}>
          <i style={{ width: `${chargeProgress * 100}%` }} />
          <span>{chargingAction ? `${chargeName} · ${Math.round(chargeProgress * 100)}%` : 'Hold a button to charge'}</span>
        </div>
        <div className="g-soccer-pad-center">
          <em className="g-soccer-pad-mode">{attacking ? 'Attack' : 'Defend'}</em>
          <button type="button" className="g-soccer-pad-menu" onClick={() => setShowGame(true)}><span aria-hidden="true">☰</span> Show game</button>
        </div>
      </div>
      <p className="g-soccer-pad-rotate">Turn your phone sideways for the full controller</p>
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  if (shell.touch && online && !online.isHost && !online.watching) return <PhoneController />;
  return <Play key={`${shell.round}-${online?.round ?? 0}-${online?.handoffs ?? 0}`} />;
}

export default function Soccer({ onExit, roomCode }: { onExit?: () => void; roomCode?: string }) {
  const [, setDisplayOnly] = useSetting(DISPLAY_ONLY);
  useEffect(() => setDisplayOnly('on'), [setDisplayOnly]);
  return (
    <GameShell
      meta={meta}
      className="g-soccer"
      onExit={onExit}
      roomCode={roomCode}
      phoneFirst
      setup={<Settings />}
      hostSetup={<PhoneLobby />}
      defaultBots={0}
      botNames={['bay city bot', 'northshore bot', 'wing bot', 'keeper bot']}
      quickNote="2v2, normal bots, and three-minute halves."
      quickPool="2v2"
      soloLabel="Play with keyboard"
    >
      <Stage />
    </GameShell>
  );
}
