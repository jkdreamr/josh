import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { GameShell, useShell, useKeys, useGameLoop, useCanvas, useThree, useOnline, useSetting, getSetting, Segmented, defineSetting, levelOptions, levelIndex, TouchControls, sfx } from '../../kit';
import type { LevelName } from '../../kit/controls';
import { meta } from './meta.ts';
import { computeAI, type Level } from './ai.ts';
import { chargePower, IDENTITY_BASIS, keyboardInput, screenToWorld } from './input.ts';
import { cloneSnapshot, commandFromPacket, movePacket, parsePacket } from './net.ts';
import { createWorld, distance, FIELD, findReceiver, matchClock, stepWorld, STEP, teamDir, teamOf, type Command, type Team, type World } from './logic.ts';
import { appendReplayFrame, createReplayWorld, sampleReplay, type ReplayFrame } from './replay.ts';
import { goalRoar, kickThump, netSwish, startCrowd, whistle } from './audio.ts';
import { createScene, type CameraMode, type SoccerView, type TimeMode } from './scene.ts';
import { Hud } from './hud.tsx';
import { playerForSeat, seatForPlayer, type Mode } from './seats.ts';
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
const phoneModeOptions = [['cpu', 'vs CPU'], ['versus', '2 players'], ['coop', 'Co-op']] as const;
const halfOptions = [['2', '2 min'], ['4', '4 min'], ['6', '6 min']] as const;
const cameraOptions = [['broadcast', 'Broadcast'], ['end', 'End to end']] as const;
const timeOptions = [['night', 'Night'], ['golden', 'Golden hour']] as const;
const commandKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'Period', 'Slash', 'Semicolon', 'Quote', 'Comma', 'ShiftLeft', 'ShiftRight'];
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
  const invite = typeof location === 'undefined' ? '' : `${location.protocol}//${location.host}/?game=soccer&room=${online.code}`;
  return (
    <div className="g-soccer-phone-lobby">
      <strong>Connect your phone</strong>
      {countdown !== null && <strong className="g-soccer-phone-countdown" role="status">Starting in {countdown}…</strong>}
      {qr && <img src={qr} alt={`Phone controller QR code for room ${online.code}`} />}
      <span>1 Open your phone camera · 2 Scan · 3 Your phone becomes the controller.</span>
      <b className="g-soccer-room-code">{online.code}</b>
      {invite && <a href={invite}>{invite}</a>}
      <Segmented label="Match mode" value={mode} options={phoneModeOptions} onChange={setMode} />
      <span className="g-soccer-phone-mode-note">vs CPU uses 1 phone · 2 players and Co-op use 2 phones.</span>
      <div className="g-soccer-phone-connections">
        {phones.map((player) => {
          const playerId = playerForSeat(player.seat, true, mode);
          const teamName = teamOf(playerId) === 0 ? 'Bay City' : 'Northshore';
          return <span key={player.seat}>Phone {player.seat} connected ✓ ({teamName})</span>;
        })}
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
  const gamepadPrevious = useRef<Record<number, boolean[]>>({});
  const gamepadFlick = useRef<Record<number, boolean>>({});
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
  const localPlayerIds = online ? online.seat < 0 || (online.isHost && displayOnlyRoom.current) ? [] : [playerForSeat(online.seat, displayOnlyRoom.current, currentMode)] : currentMode === 'versus' ? [6, 17] : currentMode === 'coop' ? [6, 9] : [world.controlled[0]];
  const localTeam = localPlayerIds.length ? teamOf(localPlayerIds[0]!) : 0;

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
        const player = current?.players[playerForSeat(from, displayOnlyRoom.current, currentMode)];
        if (!current || !player || !player.human) return;
        const command = commandFromPacket(packet);
        if (displayOnlyRoom.current) {
          const basis = viewRef.current?.viewBasis() ?? IDENTITY_BASIS;
          command.move = screenToWorld(command.move, basis);
          const aim = screenToWorld(command.aim ?? { x: 0, z: 0 }, basis);
          command.aim = Math.hypot(aim.x, aim.z) > 0.05
            ? aim
            : { x: teamDir(player.team, current.endsSwapped), z: 0 };
        }
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

  const makeCommand = (id: number, p2: boolean, dt: number): Command => {
    const state = keyboardInput(keys, p2, !p2 && !online && currentMode === 'cpu');
    const padIndex = p2 ? 1 : 0;
    const pad = typeof navigator !== 'undefined' ? navigator.getGamepads?.()[padIndex] : null;
    let padFinesse = false;
    if (pad) {
      const previous = gamepadPrevious.current[padIndex] ?? (gamepadPrevious.current[padIndex] = []);
      const down = (index: number) => !!pad.buttons[index]?.pressed;
      const edge = (index: number) => down(index) && !previous[index];
      const stickX = Math.abs(pad.axes[0] ?? 0) > 0.14 ? pad.axes[0]! : 0;
      const stickZ = Math.abs(pad.axes[1] ?? 0) > 0.14 ? pad.axes[1]! : 0;
      if (Math.hypot(stickX, stickZ) > 0.14) state.move = { x: clamp(stickX, -1, 1), z: clamp(stickZ, -1, 1) };
      const padAction = edge(0) ? 'pass' : edge(1) ? 'shoot' : edge(3) ? 'lob' : edge(2) ? 'through' : null;
      const heldPad = down(0) ? 'pass' : down(1) ? 'shoot' : down(3) ? 'lob' : down(2) ? 'through' : null;
      if (padAction) { state.action = padAction; state.pressed = true; }
      state.heldAction = heldPad;
      state.sprint = down(7);
      padFinesse = down(5);
      const flickX = pad.axes[2] ?? 0;
      const flickZ = pad.axes[3] ?? 0;
      if (edge(4)) { state.action = 'pass'; state.pressed = true; }
      const flicked = Math.hypot(flickX, flickZ) > 0.8;
      if (flicked && !gamepadFlick.current[padIndex]) { state.action = 'skill'; state.pressed = true; state.heldAction = null; }
      gamepadFlick.current[padIndex] = flicked;
      for (let i = 0; i < pad.buttons.length; i++) previous[i] = pad.buttons[i]!.pressed;
      previous.length = pad.buttons.length;
    }
    if (!p2 && Math.hypot(movement.current.x, movement.current.z) > 0.05 && shell.touch) {
      state.move = { ...movement.current };
    }
    const current = worldRef.current!;
    const player = current.players[id]!;
    state.move = screenToWorld(state.move, viewRef.current?.viewBasis() ?? IDENTITY_BASIS);
    const aim = Math.hypot(state.move.x, state.move.z) > 0.05
      ? { ...state.move }
      : { x: teamDir(player.team, current.endsSwapped), z: 0 };
    const charge = charging.current.get(id) ?? { holding: false, action: null, seconds: 0 };
    let action = state.action;
    let pressed = state.pressed;
    let shotPower = 0.1;
    if (state.heldAction && !charge.holding) {
      charge.holding = true;
      charge.action = state.heldAction;
      charge.seconds = 0;
    }
    if (charge.holding && state.heldAction === charge.action) {
      charge.seconds = Math.min(1, charge.seconds + dt);
      action = null;
      pressed = false;
      shotPower = charge.seconds;
      powerUiTimer.current += dt;
      if (powerUiTimer.current >= 1 / 30) {
        powerUiTimer.current %= 1 / 30;
        setPower(charge.seconds);
      }
    } else if (charge.holding) {
      action = charge.action === 'shoot' && (keys.down(p2 ? 'Comma' : 'KeyU') || padFinesse) ? 'finesse' : charge.action;
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
    return { move: state.move, sprint: state.sprint, action, heldAction: charge.holding ? state.heldAction : null, pressed, power: shotPower, aim };
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
    if (room) {
      for (const player of current.players) {
        const seat = seatForPlayer(player.id, room.isHost && displayOnlyRoom.current, currentMode);
        let active = false;
        for (const entry of room.players) if (entry.seat === seat) { active = true; break; }
        const hostDisplay = room.isHost && displayOnlyRoom.current && seat === 0;
        player.human = active && !hostDisplay;
        player.controlled = active && !hostDisplay;
        if (!active) remoteCommands.current.delete(player.id);
      }
    }

    if (current.phase === 'goal' && !replaySkipped.current && keys.pressed(...commandKeys)) replaySkipped.current = true;
    if (current.phase === 'goal' && Math.hypot(movement.current.x, movement.current.z) > 0.2) replaySkipped.current = true;
    const commandsForUsers = userCommands.current;
    commandsForUsers.clear();
    if (current.phase !== 'goal' && room && !room.watching) {
      const id = localPlayerIds[0];
      if (id !== undefined) commandsForUsers.set(id, makeCommand(id, false, dt));
    } else if (current.phase !== 'goal' && !room) {
      for (let i = 0; i < localPlayerIds.length; i++) {
        const id = localPlayerIds[i]!;
        commandsForUsers.set(id, makeCommand(id, i === 1, dt));
      }
    }

    if (isOnlineGuest && room && localPlayerIds.length) {
      const command = commandsForUsers.get(localPlayerIds[0]!)!;
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
            command.action = null;
            command.pressed = false;
            command.switchNearest = false;
            command.switchDir = null;
          }
        }
        const previousPhase = current.phase;
        const previousScore0 = current.score[0];
        const previousScore1 = current.score[1];
        const previousEvent = current.event;
        stepWorld(current, STEP, commands, debugConfig.clockScale);
        accumulator.current -= STEP;
        if (current.kickEvent || current.phase !== previousPhase || current.score[0] !== previousScore0 || current.score[1] !== previousScore1 || current.event !== previousEvent) soundForWorld(current);
        if (current.phase === 'goal' && replayStartedAt.current === null) replayStartedAt.current = simulationTime.current;
        if (simulationTime.current - soundTime.current > 0.075) {
          appendReplayFrame(replayFrames.current, current, simulationTime.current);
          soundTime.current = simulationTime.current;
        }
        for (const command of commands.values()) {
          command.action = null;
          command.pressed = false;
          command.switchNearest = false;
          command.switchDir = null;
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
    const selectedPlayerId = localPlayerIds[0] ?? current.controlled[0];
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
    viewRef.current?.update(renderWorld, dt, performance.now() / 1000, localTeam, camera, target, power);
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

  useGameLoop(update, () => {
    if (!renderDirty.current) return;
    viewRef.current?.render();
    renderDirty.current = false;
  });

  return (
    <div className="g-soccer-stage">
      <div className="g-soccer-canvas" ref={ref} />
      <Hud world={hudWorld} targetId={targetId} selectedId={selectedId} watching={!!online?.watching} replaying={replayActive} />
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

function PhoneController() {
  const online = useOnline();
  const movement = useRef({ x: 0, z: 0 });
  const held = useRef<Command['action']>(null);
  const sprint = useRef(false);
  const sequence = useRef(0);
  const phoneWorld = useRef<World | null>(null);
  const specialAction = useRef<Command['action']>('pass');
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const previousScore = useRef<[number, number]>([0, 0]);
  const [displayOnly, setDisplayOnly] = useState(true);
  const [mode, setMode] = useState<Mode>('cpu');
  const [showGame, setShowGame] = useState(false);
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
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('visibilitychange', onVisibility);
    void requestWakeLock();
    return () => {
      live = false;
      document.removeEventListener('gesturestart', preventGesture);
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
  const send = (action: Command['action'] = null, pressed = false) => {
    if (!online) return;
    online.send(movePacket(online.round || 1, sequence.current++, online.seat, {
      move: movement.current,
      sprint: sprint.current,
      action,
      heldAction: held.current,
      pressed,
      power: pressed ? 0.1 : 0.5,
      aim: movement.current,
    }), { fast: true });
  };
  const beginCharge = (action: Command['action']) => {
    held.current = action;
    chargeStartedAt.current = performance.now();
    setChargingAction(action);
    setChargeProgress(0);
    send(null, false);
  };
  const releaseCharge = (action: Command['action'], vibrate = true) => {
    held.current = null;
    chargeStartedAt.current = null;
    setChargingAction(null);
    setChargeProgress(0);
    send(action, true);
    if (vibrate) navigator.vibrate?.(18);
  };
  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, data) => {
      if (from !== 0) return;
      const packet = parsePacket(data);
      if (packet?.k === 's') {
        phoneWorld.current = packet.state;
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
  }, [online]);
  if (!online) return null;
  const phonePlayer = playerForSeat(online.seat, displayOnly, mode);
  if (showGame) return <><Play key={`phone-game-${online.round ?? 0}`} /><button className="g-soccer-phone-show" type="button" onClick={() => setShowGame(false)}>Controller</button></>;
  const button = (action: Command['action'], key: string, label: string, className: string) => (
    <button
      type="button"
      className={`g-soccer-phone-button ${className}`}
      aria-label={`${label} (${key})`}
      onPointerDown={(event) => { event.preventDefault(); beginCharge(action); }}
      onPointerUp={(event) => { event.preventDefault(); releaseCharge(action); }}
      onPointerCancel={() => releaseCharge(action, false)}
      onContextMenu={(event) => event.preventDefault()}
    ><span>{key}</span><small>{label}</small></button>
  );
  const chargeName = chargingAction === 'pass' ? 'Pass' : chargingAction === 'shoot' ? 'Shoot' : chargingAction === 'through' ? 'Through' : chargingAction === 'lob' ? 'Lob' : chargingAction === 'skill' ? 'Skill' : 'Hold to charge';
  return (
    <div className="g-soccer-phone-controller">
      <header>
        <b>{teamOf(phonePlayer) === 1 ? 'NORTHSHORE' : 'BAY CITY'}</b>
        <strong>{score[0]} · {score[1]}</strong>
        <button type="button" onClick={() => setShowGame(true)}>Show game</button>
      </header>
      <div className="g-soccer-phone-charge" role="progressbar" aria-label={`${chargeName} power`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(chargeProgress * 100)}>
        <span>{chargingAction ? `${chargeName} · ${Math.round(chargeProgress * 100)}%` : 'HOLD AN ACTION TO CHARGE'}</span>
        <div><i style={{ width: `${chargeProgress * 100}%` }} /></div>
      </div>
      <Stick movement={movement} />
      <div className="g-soccer-phone-buttons">
        <div className="g-soccer-phone-utilities">
          <button type="button" className="g-soccer-phone-action" onPointerDown={(event) => {
            event.preventDefault();
            const player = phoneWorld.current?.players[phonePlayer];
            specialAction.current = player && distance(player, phoneWorld.current!.ball) < 0.8 ? 'skill' : 'pass';
            beginCharge(specialAction.current);
          }} onPointerUp={(event) => { event.preventDefault(); releaseCharge(specialAction.current); }} onPointerCancel={() => releaseCharge(specialAction.current, false)}>Switch / Skill</button>
          <button type="button" className="g-soccer-phone-action is-sprint" onPointerDown={(event) => { event.preventDefault(); sprint.current = true; send(); }} onPointerUp={(event) => { event.preventDefault(); sprint.current = false; send(); }}>Sprint (hold)</button>
        </div>
        <div className="g-soccer-phone-diamond">
          {button('lob', 'X', 'Lob', 'is-x')}
          {button('through', 'Y', 'Through', 'is-y')}
          {button('pass', 'A', 'Pass', 'is-a')}
          {button('shoot', 'B', 'Shoot', 'is-b')}
        </div>
      </div>
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
      hostSetup={<><PhoneLobby /><Settings online /></>}
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
