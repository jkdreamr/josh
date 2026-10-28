import { Component, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { GameShell, useShell, useKeys, useGameLoop, useCanvas, useOnline, useSetting, useMuted, getSetting, Segmented, defineSetting, levelOptions, levelIndex, TouchControls, sfx } from '../../kit';
import { meta } from './meta.ts';
import { computeAI, type Level } from './ai.ts';
import { chargePower, screenToWorld, gamepadInput, keyboardInput, reconcileControllers, type ControlCommand, type GamepadHistory } from './input.ts';
import { desiredCameraBasis } from './camera.ts';
import { acceptMovePacket, cloneSnapshot, consumeCommand, movePacket, parsePacket, type RemoteSeat, type LobbyMember } from './net.ts';
import { createWorld, distance, teamOf, findReceiver, isCross, matchClock, nearestCarrier, setRestart, stepWorld, STEP, type Command, type Team, type World } from './logic.ts';
import { setPieceLabels, shootoutScore, shootoutWinner, startShootout } from './setpieces.ts';
import { appendReplayFrame, createReplayWorld, sampleReplay, type ReplayFrame } from './replay.ts';
import { SoccerSound, type CommentaryMode } from './audio.ts';
import type { CameraMode, SoccerView, TimeMode } from './scene.ts';
import { markShadersReady, parkSoccerView, takeSoccerView, useSoccerStadium } from './load.ts';
import { LoadProgress } from './loading.tsx';
import { Hud, type HudState, type RadarHandle } from './hud.tsx';
import { broadcastClock, createStatsObserver, possessionShare } from './broadcast.ts';
import { IntroCard, MatchContext, PausePanel, StatsScreen, type MatchData, type Presentation } from './presentation.tsx';
import { captureSnapshot, createSnapshot, interpolateInto, type Snapshot } from './render-lerp.ts';
import { publishSoccerPerf, recordSoccerPerf, recordSoccerRendererStats, soccerPerfEnabled } from './perf.ts';
import { clampOrigin, faceLabels, followOrigin, haptic as padHaptic, hitButton, STICK, stickVector, type PadPoint } from './pad.ts';
import { assignControllers, missingPhoneSeats, playerForSeat, type ControllerMember, type Mode } from './seats.ts';
import type { PitchPattern } from './stadium.ts';
import { createPracticeState, createTutorial, markTutorialSeen, selectDrill, setupDrill, stepPractice, stepTutorial, tutorialSeen, TUTORIAL_SECONDS, DRILLS, type DrillId, type PracticeState, type TutorialState } from './practice.ts';
import { DRILL, PRACTICE_MODE_OPTION, PhonePracticeStrip, PracticePanel, practiceView, TutorialOverlay, tutorialText, type ControlScheme, type PhonePracticeStatus, type PracticeView } from './practice-mode.tsx';
import { CAMERA, COMPETITION, HALF, HOME_CLUB, AWAY_CLUB, LEVEL, TIME } from './settings.ts';
import { COMPETITIONS, type CompetitionId } from './modes.ts';
import { CLUBS, clubById, DEFAULT_CLUBS } from './teams.ts';
import { PhoneLobby as SoccerPhoneLobby, PhoneTeamPicker, publishLobby, sideForRoom, useLobbyState } from './lobby.tsx';
import { createCup, loadCup, matchOutcome, recordUserResult, saveCup } from './cup.ts';
import { Referee } from './referee.tsx';
import { createFxDirector, haptic as fxHaptic, phoneFx, type FxDirector } from './fx.ts';
import { reportSoccerError, startSoccerTelemetry, type TelemetryHandle } from './telemetry.ts';
import './soccer.css';

type Minutes = '2' | '4' | '6';
type Volume = 'off' | 'low' | 'mid' | 'full';

const MODE = defineSetting<Mode>('soccer:mode', ['cpu', 'versus', 'coop', 'practice'], 'cpu');
const PITCH = defineSetting<PitchPattern>('soccer:pitch', ['stripes', 'checker'], 'stripes', { live: true });
const DISPLAY_ONLY = defineSetting<'on' | 'off'>('soccer:display-only', ['on', 'off'], 'on');
const VOLUME = defineSetting<Volume>('soccer:volume', ['off', 'low', 'mid', 'full'], 'mid', { live: true });
const COMMENTARY = defineSetting<CommentaryMode>('soccer:commentary', ['voice', 'captions', 'off'], 'voice', { live: true });
const OFFSIDE = defineSetting<'on' | 'off'>('soccer:offside', ['on', 'off'], 'on');

const modeOptions = [['cpu', 'vs CPU'], ['versus', '2P versus'], ['coop', '2P co-op'], PRACTICE_MODE_OPTION] as const;
const halfOptions = [['2', '2 min'], ['4', '4 min'], ['6', '6 min']] as const;
const cameraOptions = [['broadcast', 'Broadcast'], ['end', 'End to end']] as const;
const timeOptions = [['day', 'Day'], ['night', 'Night'], ['golden', 'Golden hour'], ['overcast', 'Overcast'], ['rain', 'Rain']] as const;
const pitchOptions = [['stripes', 'Stripes'], ['checker', 'Checkerboard']] as const;
const volumeOptions = [['off', 'Off'], ['low', 'Low'], ['mid', 'Mid'], ['full', 'Full']] as const;
const commentaryOptions = [['voice', 'Voice'], ['captions', 'Captions'], ['off', 'Off']] as const;
const volumeLevels: Record<Volume, number> = { off: 0, low: 0.35, mid: 0.7, full: 1 };
const offsideOptions = [['on', 'On'], ['off', 'Off']] as const;
const commandKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'KeyQ', 'KeyE', 'Space', 'Period', 'Slash', 'Semicolon', 'Quote', 'Comma', 'ShiftLeft', 'ShiftRight'];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const shallowHudEqual = (left: HudState, right: HudState) =>
  (Object.keys(left) as (keyof HudState)[]).every((key) => left[key] === right[key]);
function Settings({ online = false }: { online?: boolean }) {
  const shell = useShell();
  const match = useContext(MatchContext);
  const [mode, setMode] = useSetting(MODE);
  const [competition, setCompetition] = useSetting(COMPETITION);
  const [homeClub, setHomeClub] = useSetting(HOME_CLUB);
  const [awayClub, setAwayClub] = useSetting(AWAY_CLUB);
  const [half, setHalf] = useSetting(HALF);
  const [level, setLevel] = useSetting(LEVEL);
  const [camera, setCamera] = useSetting(CAMERA);
  const [time, setTime] = useSetting(TIME);
  const [pitch, setPitch] = useSetting(PITCH);
  const [volume, setVolume] = useSetting(VOLUME);
  const [commentary, setCommentary] = useSetting(COMMENTARY);
  const definition = COMPETITIONS.find((entry) => entry.id === competition) ?? COMPETITIONS[0]!;
  const changeCompetition = (value: CompetitionId) => {
    const next = COMPETITIONS.find((entry) => entry.id === value) ?? COMPETITIONS[0]!;
    setCompetition(next.id);
    if (!next.arrangements.some((arrangement) => arrangement === mode)) setMode(next.arrangements[0]!);
  };
  const availableModes = definition.arrangements.map((arrangement) => [
    arrangement, arrangement === 'cpu' ? 'vs CPU' : arrangement === 'versus' ? '2P versus' : '2P co-op',
  ] as const);
  const [offside, setOffside] = useSetting(OFFSIDE);
  return (
    <div className="g-soccer-settings">
      {!online && <Segmented label="Match" value={mode} options={modeOptions} onChange={setMode} />}
      {mode !== 'practice' && <Segmented label="Half length" value={half} options={halfOptions} onChange={setHalf} />}
      {!online && <Segmented label="Competition" value={competition} options={COMPETITIONS.map(({ id, label }) => [id, label] as const)} onChange={changeCompetition} />}
      {!online && <Segmented label="Match" value={mode} options={availableModes} onChange={setMode} />}
      <div className="g-soccer-setting-clubs">
        <label>Your club<select value={homeClub} onChange={(event) => setHomeClub(event.currentTarget.value)}>{CLUBS.map((club) => <option key={club.id} value={club.id} disabled={club.id === awayClub}>{club.name}</option>)}</select></label>
        <label>Opponent<select value={awayClub} onChange={(event) => setAwayClub(event.currentTarget.value)}>{CLUBS.map((club) => <option key={club.id} value={club.id} disabled={club.id === homeClub}>{club.name}</option>)}</select></label>
      </div>
      <Segmented label="Half length" value={half} options={halfOptions} onChange={setHalf} />
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
      <Segmented label="Camera" value={camera} options={cameraOptions} onChange={setCamera} />
      <Segmented label="Time of day" value={time} options={timeOptions} onChange={setTime} />
      <Segmented label="Pitch" value={pitch} options={pitchOptions} onChange={setPitch} />
      {shell.status === 'paused' && match?.current && <PausePanel match={match.current} />}
      <Segmented label="Sound" value={volume} options={volumeOptions} onChange={setVolume} />
      <Segmented label="Commentary" value={commentary} options={commentaryOptions} onChange={setCommentary} />
      <Segmented label="Offside" value={offside} options={offsideOptions} onChange={setOffside} />
    </div>
  );
}

function Stick({ movement, onChange }: { movement: { current: { x: number; z: number } }; onChange?: () => void }) {
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
    onChange?.();
    setOffset({ x, y });
  };
  const release = (event?: PointerEvent<HTMLDivElement>) => {
    if (event && pointer.current !== event.pointerId) return;
    pointer.current = null;
    movement.current = { x: 0, z: 0 };
    onChange?.();
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

function setupHumans(world: World, mode: Mode, online: ReturnType<typeof useOnline>, competition: CompetitionId, lobbyMembers: LobbyMember[] = []) {
  world.controlledSeats = [null, null, null, null];
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  if (online) {
    const members: ControllerMember[] = online.players.filter((member) => member.seat >= 0).map((member) => {
      const known = lobbyMembers.find((entry) => entry.seat === member.seat);
      return known ?? { seat: member.seat, role: member.seat === 0 ? 'host' : 'phone', side: member.seat === 0 ? 0 : 1 };
    });
    const assignments = assignControllers(members, mode, competition);
    for (const [seat, id] of assignments) {
      if (seat >= 0 && seat < world.controlledSeats.length) world.controlledSeats[seat] = id;
      const player = world.players[id]!;
      player.human = true;
      player.controlled = true;
      const team = player.team;
      if (!world.players.some((p) => p.team === team && p.id !== player.id && p.human)) world.controlled[team] = player.id;
    }
    return assignments;
  }
  const ids = mode === 'versus' ? [6, 17] : mode === 'coop' ? [6, 9] : [6];
  ids.forEach((id, seat) => {
    world.controlledSeats![seat] = id;
    world.players[id]!.human = true;
    world.players[id]!.controlled = true;
  });
  world.controlled[0] = 6;
  world.controlled[1] = 17;
  return new Map<number, number>(ids.map((id, index) => [index, id]));
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

function Play({ audioEnabled = true }: { audioEnabled?: boolean }) {
  const shell = useShell();
  const keys = useKeys();
  const stadium = useSoccerStadium();
  const online = useOnline();
  const matchContext = useContext(MatchContext);
  const [volumeChoice] = useSetting(VOLUME);
  const [commentaryChoice] = useSetting(COMMENTARY);
  const [muted] = useMuted();
  const soundRef = useRef<SoccerSound | null>(null);
  if (!soundRef.current) soundRef.current = new SoccerSound();
  const sound = soundRef.current;
  const soundLocked = useSyncExternalStore(sound.synth.subscribe, sound.synth.isLocked, () => true);
  const caption = useSyncExternalStore(sound.announcer.subscribe, sound.announcer.getCaption, () => null);
  const lobbyState = useLobbyState();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [modeChoice, setModeChoice] = useSetting(MODE);
  const [competitionChoice, setCompetitionChoice] = useSetting(COMPETITION);
  const [homeClubChoice, setHomeClubChoice] = useSetting(HOME_CLUB);
  const [awayClubChoice, setAwayClubChoice] = useSetting(AWAY_CLUB);
  const [halfChoice, setHalfChoice] = useSetting(HALF);
  const [levelChoice, setLevelChoice] = useSetting(LEVEL);
  const [offsideChoice, setOffsideChoice] = useSetting(OFFSIDE);
  const [cameraChoice] = useSetting(CAMERA);
  const [timeChoice] = useSetting(TIME);
  const [pitchChoice] = useSetting(PITCH);
  const [phoneGone, setPhoneGone] = useState(false);
  const [hud, setHud] = useState<HudState>({
    score0: 0, score1: 0, clock: '00:00', added: null, half: 1,
    phase: 'restart', event: 'kick off', eventTime: 1.35, eventKey: 0,
    selectedId: 6, stamina: 1, rivalId: null, rivalStamina: 1, partnerId: null, partnerStamina: 1, state: null, targetId: null, power: null,
    replaying: false, statsVersion: 0, presentation: 'live',
  });
  const radarRef = useRef<RadarHandle | null>(null);
  const [drillChoice, setDrillChoice] = useSetting(DRILL);
  const practiceRef = useRef<PracticeState | null>(null);
  const practiceDoneAt = useRef(0);
  const [practiceHud, setPracticeHud] = useState<PracticeView | null>(null);
  const tutorialRef = useRef<TutorialState | null>(null);
  const [tutorialHud, setTutorialHud] = useState<TutorialState | null>(null);
  const practiceStatusTimer = useRef(0);
  const movement = useRef({ x: 0, z: 0 });
  const worldRef = useRef<World | null>(null);
  const statsObserver = useRef(createStatsObserver());
  const presentation = useRef<Presentation>('live');
  const presentationAt = useRef(0);
  const introPending = useRef(true);
  const guestSnapshotAt = useRef<number | null>(null);
  const fullTimeResult = useRef<{ title: string; detail: string } | null>(null);
  const fullTimeShown = useRef(false);
  const previousHudEvent = useRef('');
  const previousHudEventTime = useRef(0);
  const hudEventKey = useRef(0);
  const power = useRef<number | null>(null);
  const viewRef = useRef<SoccerView | null>(null);
  const fxDirectorRef = useRef<FxDirector | null>(null);
  if (!fxDirectorRef.current) {
    fxDirectorRef.current = createFxDirector({
      reducedMotion: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }
  const shellRef = useRef(shell);
  const onlineRef = useRef(online);
  const telemetryRef = useRef<TelemetryHandle | null>(null);
  const telemetryFrameAt = useRef<number | null>(null);
  const telemetryMatchActive = useRef(false);
  const lastQualitySampleAt = useRef(0);
  const levelRef = useRef<Level>(online?.quick ? 'normal' : levelChoice);
  const cameraRef = useRef<CameraMode>(cameraChoice);
  const timeRef = useRef<TimeMode>(timeChoice);
  const pitchRef = useRef<PitchPattern>(pitchChoice);
  const accumulator = useRef(0);
  const matchSeats = useRef<number[] | null>(null);
  const simulationTime = useRef(0);
  const lastFrameTime = useRef<number | null>(null);
  const debugTimer = useRef(0);
  const debugConfig = useMemo(() => {
    if (typeof location === 'undefined') return { enabled: false, clockScale: 1, setpiece: null };
    const params = new URLSearchParams(location.search);
    const value = Number(params.get('soccerdebug'));
    return {
      enabled: params.has('soccerdebug'),
      setpiece: import.meta.env.DEV && params.has('soccerdebug') ? params.get('setpiece') : null,
      clockScale: params.has('soccerdebug') && Number.isFinite(value) ? Math.max(1, Math.min(20, value)) : 1,
    };
  }, []);
  const replayFrames = useRef<ReplayFrame[]>([]);
  const replayWorld = useRef<World | null>(null);
  const replayStartedAt = useRef<number | null>(null);
  const replaySkipped = useRef(false);
  const hudTimer = useRef(0);
  const snapshotTimer = useRef(0);
  const pendingSnapshotKick = useRef<NonNullable<World['kickEvent']> | null>(null);
  const snapshotSequence = useRef(0);
  const inputSequence = useRef(0);
  const inputTimer = useRef(0);
  const configSequence = useRef(0);
  const remoteCommands = useRef(new Map<number, Command>());
  const userCommands = useRef(new Map<number, Command>());
  const simulationCommands = useRef(new Map<number, Command>());
  const aiCommands = useRef<[Map<number, Command>, Map<number, Command>]>([new Map(), new Map()]);
  const remoteSeats = useRef(new Map<number, RemoteSeat>());
  const guestSnapshots = useRef<NetworkFrame[]>([]);
  const pendingNetworkAction = useRef<Command | null>(null);
  const charging = useRef(new Map<number, { holding: boolean; action: Command['action']; seconds: number }>());
  const lastScore = useRef<[number, number]>([0, 0]);
  const reported = useRef(false);
  const soundTime = useRef(0);
  const renderDirty = useRef(true);
  const guestRenderTimer = useRef(0);
  const gamepadPrevious = useRef<Record<number, GamepadHistory>>({});
  const controllerPlayers = useRef(new Map<number, number>());
  const displayOnlyRoom = useRef(getSetting(DISPLAY_ONLY) === 'on');
  shellRef.current = shell;
  onlineRef.current = online;
  if (online) displayOnlyRoom.current = true;
  levelRef.current = online?.quick ? 'normal' : levelChoice;
  cameraRef.current = cameraChoice;
  timeRef.current = timeChoice;
  pitchRef.current = pitchChoice;

  const halfMinutes = online?.quick ? 3 : Number(halfChoice);
  const currentCompetition = online && lobbyState ? lobbyState.comp : competitionChoice;
  const currentMode: Mode = online && lobbyState ? lobbyState.mode : modeChoice;
  const currentClubs: [string, string] = online && lobbyState ? [...lobbyState.clubs] : [homeClubChoice, awayClubChoice];
  useEffect(() => {
    sound.configure({ volume: volumeLevels[volumeChoice], crowd: 1, muted, commentary: commentaryChoice });
  }, [sound, volumeChoice, muted, commentaryChoice]);

  useEffect(() => {
    const telemetry = startSoccerTelemetry('display');
    telemetryRef.current = telemetry;
    telemetry?.setPhase('menu');
    return () => {
      telemetry?.stop();
      if (telemetryRef.current === telemetry) telemetryRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (online?.transport) telemetryRef.current?.transport(online.transport);
  }, [online?.transport]);

  useEffect(() => () => sound.dispose(), [sound]);

  useEffect(() => {
    if (!audioEnabled) return;
    const unlock = () => { sound.unlock(); sfx.unlock(); };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    window.addEventListener('touchend', unlock, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
    };
  }, [audioEnabled, sound]);

  const practicing = currentMode === 'practice';
  const freshWorld = () => {
    const seed = Math.floor(Date.now() % 0xffff_ffff);
    if (!practicing) {
      practiceRef.current = null;
      const fresh = createWorld(seed, halfMinutes * 60, currentMode === 'coop' ? 2 : 1, currentClubs);
      fresh.cup = currentCompetition === 'cup';
      if (fresh.rules) fresh.rules.offside = offsideChoice === 'on';
      controllerPlayers.current = setupHumans(fresh, currentMode, online, currentCompetition, lobbyState?.members);
      return fresh;
    }
    const practice = createPracticeState(drillChoice);
    practiceRef.current = practice;
    const fresh = createWorld(seed, 360, 1, currentClubs);
    fresh.cup = currentCompetition === 'cup';
    if (fresh.rules) fresh.rules.offside = offsideChoice === 'on';
    controllerPlayers.current = setupHumans(fresh, currentMode, online, currentCompetition, lobbyState?.members);
    setupDrill(practice, fresh);
    return fresh;
  };
  if (!worldRef.current) {
    worldRef.current = freshWorld();
    sound.reset(worldRef.current);
    lastScore.current = [...worldRef.current.score];
  }
  if (!replayWorld.current) replayWorld.current = createReplayWorld(worldRef.current);
  const world = worldRef.current!;
  const previousRenderSnapshot = useRef<Snapshot | null>(null);
  const interpolatedWorld = useRef<World | null>(null);
  if (!previousRenderSnapshot.current) {
    previousRenderSnapshot.current = captureSnapshot(world, createSnapshot(world));
    interpolatedWorld.current = structuredClone(world);
  }
  const localOnlineId = online ? controllerPlayers.current.get(online.seat) : undefined;
  const localPlayerIds = online ? online.seat < 0 || localOnlineId === undefined ? [] : [localOnlineId] : currentMode === 'versus' ? [world.controlled[0], world.controlled[1]] : currentMode === 'coop' ? [controllerPlayers.current.get(0) ?? 6, controllerPlayers.current.get(1) ?? 9] : [world.controlled[0]];
  const localTeam = localPlayerIds.length ? teamOf(localPlayerIds[0]!) : 0;
  const showPresentation = (next: Presentation) => {
    if (presentation.current === next) return false;
    presentation.current = next;
    presentationAt.current = performance.now();
    return true;
  };

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => {
      fxDirectorRef.current?.setReducedMotion(preference.matches);
      renderDirty.current = true;
      shell.invalidate();
    };
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, [shell.invalidate]);

  useEffect(() => {
    if (shell.status !== 'ready') return;
    controllerPlayers.current.clear();
    const fresh = freshWorld();
    matchSeats.current = null;
    setPhoneGone(false);
    if (!practicing) {
      const forced = debugConfig.setpiece;
      if (forced === 'shootout') startShootout(fresh);
      else if (forced && ['corner', 'free-kick', 'penalty', 'goal-kick', 'throw-in'].includes(forced)) {
        const kind = forced === 'throw-in' ? 'kick-in' : forced as 'corner' | 'free-kick' | 'penalty' | 'goal-kick';
        setRestart(fresh, 0, kind, { x: kind === 'corner' ? 52.35 : kind === 'penalty' ? 41.5 : kind === 'goal-kick' ? -47 : 28, z: kind === 'corner' || kind === 'kick-in' ? 33.85 : 0 });
      }
    }
    worldRef.current = fresh;
    practiceDoneAt.current = 0;
    tutorialRef.current = null;
    setTutorialHud(null);
    previousRenderSnapshot.current = captureSnapshot(fresh, createSnapshot(fresh));
    interpolatedWorld.current = structuredClone(fresh);
    statsObserver.current.reset();
    presentation.current = 'live';
    presentationAt.current = 0;
    introPending.current = true;
    guestSnapshotAt.current = null;
    fullTimeResult.current = null;
    fullTimeShown.current = false;
    reported.current = false;
    simulationTime.current = 0;
    pendingSnapshotKick.current = null;
    fxDirectorRef.current?.reset();
    fxDirectorRef.current?.observe(fresh, simulationTime.current);
    accumulator.current = 0;
    lastScore.current = [...fresh.score];
    sound.reset(fresh);
    previousHudEvent.current = fresh.event;
    previousHudEventTime.current = fresh.eventTime;
    hudEventKey.current = 0;
    matchContext && (matchContext.current = { world: fresh, stats: statsObserver.current.stats });
    setHud({
      score0: 0, score1: 0, clock: '00:00', added: null, half: 1,
      phase: 'restart', event: fresh.event, eventTime: fresh.eventTime, eventKey: 0,
      selectedId: 6, stamina: 1, rivalId: null, rivalStamina: 1, partnerId: null, partnerStamina: 1, state: null, targetId: null, power: null,
      replaying: false, statsVersion: 0, presentation: 'live',
    });
    setPracticeHud(practiceRef.current ? practiceView(practiceRef.current) : null);
  }, [shell.status, modeChoice, halfMinutes, drillChoice, offsideChoice, online?.round, online?.seat, online?.players, currentCompetition, currentClubs[0], currentClubs[1], lobbyState?.members]);

  useEffect(() => {
    if (shell.status !== 'playing' || online && !online.isHost || online?.watching || tutorialSeen()) return;
    if (currentMode !== 'cpu' && currentMode !== 'practice') return;
    tutorialRef.current = createTutorial();
    setTutorialHud(tutorialRef.current);
  }, [shell.status, currentMode]);

  const endTutorial = () => {
    if (!tutorialRef.current) return;
    tutorialRef.current = null;
    setTutorialHud(null);
    markTutorialSeen();
  };

  const pickPractice = (pick: string) => {
    if (pick === 'skip') { endTutorial(); return; }
    const practice = practiceRef.current;
    const current = worldRef.current;
    if (!practice || !current) return;
    if (pick === 'again') setupDrill(practice, current);
    else if (DRILLS.some((drill) => drill.id === pick)) {
      selectDrill(practice, current, pick as DrillId);
      setDrillChoice(pick as DrillId);
    } else return;
    sfx.play('select');
    renderDirty.current = true;
    setPracticeHud(practiceView(practice));
  };
  const pickPracticeRef = useRef(pickPractice);
  pickPracticeRef.current = pickPractice;

  useEffect(() => {
    const release = sfx.retain();
    const updateRunning = () => sound.setRunning(audioEnabled && shell.status === 'playing' && document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateRunning);
    updateRunning();
    return () => {
      document.removeEventListener('visibilitychange', updateRunning);
      sound.setRunning(false);
      release();
    };
  }, [audioEnabled, shell.status, sound]);

  useEffect(() => {
    const host = ref.current;
    if (!stadium || !host) return;
    const kept = takeSoccerView(shell.touch);
    const view = kept ?? stadium.createScene(stadium.THREE, host, shell.touch, timeRef.current, pitchRef.current);
    if (!view) return;
    if (kept) {
      kept.attach(host);
      kept.setTime(timeRef.current);
      kept.setPattern(pitchRef.current);
    }
    viewRef.current = view;
    view.setFx(fxDirectorRef.current);
    view.resize(size.w, size.h);
    view.update(world, 0, performance.now() / 1000, localTeam, cameraRef.current);
    renderDirty.current = true;
    shell.invalidate();
    void view.precompile().then(() => {
      markShadersReady();
      if (viewRef.current !== view) return;
      renderDirty.current = true;
      shell.invalidate();
    });
    return () => {
      viewRef.current = null;
      parkSoccerView(view, shell.touch);
    };
  }, [stadium, shell.touch]);

  useEffect(() => {
    if (!debugConfig.enabled) return;
    const target = window as Window & { __soccerFx?: { trigger: (kind: string, advance?: number) => void } };
    const debugFx = {
      trigger(kind: string, advance = 0) {
        const current = worldRef.current;
        if (!current) return;
        const director = fxDirectorRef.current;
        director?.trigger(kind, current, simulationTime.current);
        const view = viewRef.current;
        const steps = Math.max(0, Math.round(advance * 60));
        const time = performance.now() / 1000;
        if (steps === 0) {
          view?.update(current, 0, time, localTeam, cameraRef.current);
        } else {
          for (let i = 0; i < steps; i++) {
            director?.tick(1 / 60);
            view?.update(current, 1 / 60, time + (i + 1) / 60, localTeam, cameraRef.current);
          }
        }
        renderDirty.current = true;
        view?.render();
        shell.invalidate();
      },
    };
    target.__soccerFx = debugFx;
    return () => {
      if (target.__soccerFx === debugFx) delete target.__soccerFx;
    };
  }, [debugConfig.enabled, shell.invalidate]);

  useEffect(() => {
    viewRef.current?.resize(size.w, size.h);
    renderDirty.current = true;
    shell.invalidate();
  }, [size.w, size.h, shell]);

  useEffect(() => {
    const stage = ref.current?.parentElement;
    if (!stage) return;
    const frame = requestAnimationFrame(() => {
      const box = stage.getBoundingClientRect();
      let top = box.bottom;
      stage.querySelectorAll('.g-soccer-radar, .g-soccer-player-tag').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top > box.top + box.height / 2) top = Math.min(top, r.top);
      });
      viewRef.current?.setSafeBottom(box.height > 0 ? (box.bottom - top) / box.height : 0);
      renderDirty.current = true;
      shell.invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [size.w, size.h, shell, hud.presentation, ref]);

  useEffect(() => {
    viewRef.current?.setTime(timeChoice);
    renderDirty.current = true;
    shell.invalidate();
  }, [timeChoice, shell]);

  useEffect(() => {
    viewRef.current?.setPattern(pitchChoice);
    renderDirty.current = true;
    shell.invalidate();
  }, [pitchChoice, shell]);

  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, data) => {
      const room = onlineRef.current;
      if (!room || from === room.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== (room.round || 1)) return;
      if (room.isHost && packet.k === 'mv') {
        if (packet.seat !== from || packet.seat < 0 || packet.seat > 3) return;
        const current = worldRef.current;
        const playerId = current?.controlledSeats?.[from] ?? controllerPlayers.current.get(from) ?? playerForSeat(from, displayOnlyRoom.current, currentMode);
        const player = current?.players[playerId];
        if (!current || !player || !player.human) return;
        const seat = remoteSeats.current.get(from) ?? { seq: -1, edge: -1, held: null, pressUsed: false };
        const previous = remoteCommands.current.get(player.id);
        const carrier = nearestCarrier(current);
        const accepted = acceptMovePacket(seat, previous, packet, !!carrier && carrier.team !== player.team);
        remoteSeats.current.set(from, accepted.seat);
        if (!accepted.command) return;
        telemetryRef.current?.seq(packet.seq, packet.seat);
        const command = accepted.command;
        const freshSequence = packet.seq > seat.seq;
        const freshEdge = packet.e !== undefined && packet.e > seat.edge;
        if (displayOnlyRoom.current) {
          const basis = viewRef.current?.viewBasis() ?? desiredCameraBasis(current, player.team, 16 / 9, 'broadcast');
          if (freshSequence) command.move = screenToWorld(command.move, basis);
          if (freshSequence || freshEdge) {
            if (command.switchDir) command.switchDir = screenToWorld(command.switchDir, basis);
            const aim = screenToWorld(command.aim ?? { x: 0, z: 0 }, basis);
            command.aim = Math.hypot(aim.x, aim.z) > 0.05 ? aim : { x: 0, z: 0 };
          }
        }
        remoteCommands.current.set(player.id, command);
        return;
      }
      if (room.isHost && packet.k === 'pd') {
        if (packet.seat === from) pickPracticeRef.current(packet.pick);
        return;
      }
      if (!room.isHost && from === 0 && packet.k === 's') {
        if (packet.seq <= snapshotSequence.current) return;
        snapshotSequence.current = packet.seq;
        const previousPhase = worldRef.current?.phase;
        const now = performance.now() / 1000;
        const snapshotDt = guestSnapshotAt.current === null ? 0 : Math.max(0, now - guestSnapshotAt.current);
        guestSnapshotAt.current = now;
        statsObserver.current.observe(packet.state, snapshotDt);
        if (packet.state.phase === 'goal' && worldRef.current?.phase !== 'goal') {
          replayStartedAt.current = now;
          replaySkipped.current = false;
        }
        if (packet.state.phase === 'half-time' && previousPhase !== 'half-time') showPresentation('half-time');
        if (packet.state.phase === 'full-time' && previousPhase !== 'full-time') showPresentation('full-time');
        appendReplayFrame(replayFrames.current, packet.state, now);
        fxDirectorRef.current?.observe(packet.state, now);
        guestSnapshots.current.push({ time: now, world: packet.state });
        guestSnapshots.current = guestSnapshots.current.slice(-12);
        worldRef.current = packet.state;
        matchContext && (matchContext.current = { world: packet.state, stats: statsObserver.current.stats });
        if (audioEnabled) sound.observe(packet.state, now);
        renderDirty.current = true;
        return;
      }
      if (!room.isHost && from === 0 && packet.k === 'cfg') {
        levelRef.current = (['easy', 'normal', 'hard'] as const)[packet.level]!;
        displayOnlyRoom.current = true;
        setLevelChoice((['easy', 'normal', 'hard'] as const)[packet.level]!);
        setHalfChoice(String(packet.half) as Minutes);
        if (packet.mode) setModeChoice(packet.mode);
        if (packet.comp) setCompetitionChoice(packet.comp);
        if (packet.clubs) { setHomeClubChoice(packet.clubs[0]); setAwayClubChoice(packet.clubs[1]); }
        if (packet.offside !== undefined) setOffsideChoice(packet.offside ? 'on' : 'off');
      }
    });
    return off;
  }, [audioEnabled, online, online?.round, online?.isHost, setHalfChoice, setLevelChoice, setModeChoice, setCompetitionChoice, setHomeClubChoice, setAwayClubChoice, setOffsideChoice, sound]);

  useEffect(() => {
    if (!online?.isHost) return;
    const sendConfig = () => onlineRef.current?.send({
      t: 'soccer', k: 'cfg', r: onlineRef.current?.round || 1, seq: configSequence.current++,
      half: onlineRef.current?.quick ? 3 : Number(halfChoice) as 2 | 4 | 6,
      level: onlineRef.current?.quick ? 1 : levelIndex(levelChoice),
      displayOnly: true,
      mode: modeChoice,
      comp: currentCompetition,
      clubs: currentClubs,
      offside: offsideChoice === 'on',
    });
    sendConfig();
    const timer = window.setInterval(sendConfig, 1500);
    return () => window.clearInterval(timer);
  }, [online?.isHost, online?.round, online?.quick, halfChoice, levelChoice, modeChoice, currentCompetition, currentClubs[0], currentClubs[1], offsideChoice]);

  const soundForWorld = (current: World) => {
    if (current.phase === 'goal' && lastScore.current.some((score, i) => score !== current.score[i])) {
      replayStartedAt.current = simulationTime.current;
      replaySkipped.current = false;
    }
    if (current.phase === 'live' && current.event !== previousHudEvent.current && /card|second yellow/i.test(current.event) && audioEnabled) {
      sound.synth.play({ kind: 'whistle', pattern: 'short' });
    }
    lastScore.current = [...current.score];
  };

  const makeCommand = (id: number, p2: boolean, dt: number): ControlCommand => {
    const state = keyboardInput(keys, p2, !p2 && !online && (currentMode === 'cpu' || practicing));
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
    const basis = viewRef.current?.viewBasis() ?? desiredCameraBasis(current, player.team, 16 / 9, 'broadcast');
    state.move = screenToWorld(state.move, basis);
    if (state.switchDir) state.switchDir = screenToWorld(state.switchDir, basis);
    const aim = Math.hypot(state.move.x, state.move.z) > 0.05 ? { ...state.move } : { x: 0, z: 0 };
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
      power.current = chargePower(charge.seconds);
    } else if (charge.holding) {
      action = charge.action === 'shoot' && state.finesseHeld ? 'finesse' : charge.action;
      pressed = true;
      shotPower = chargePower(charge.seconds);
      charge.holding = false;
      charge.action = null;
      charge.seconds = 0;
      power.current = null;
    } else if (action) {
      shotPower = 0.1;
    }
    charging.current.set(id, charge);
    return { ...state, action, heldAction: charge.holding ? state.heldAction : null, contain: defending && state.heldAction === 'pass', finesse: state.finesseHeld, pressed, power: shotPower, aim };
  };

  const finishMatch = (current: World) => {
    if (reported.current || current.phase !== 'full-time') return;
    const outcome = currentCompetition === 'cup' ? matchOutcome(current) : { score: current.score };
    if (!outcome) return;
    reported.current = true;
    const room = onlineRef.current;
    const draw = outcome.score[0] === outcome.score[1];
    const pensWinner = shootoutWinner(current);
    const home = clubById(current.clubs?.[0] ?? DEFAULT_CLUBS[0]);
    const away = clubById(current.clubs?.[1] ?? DEFAULT_CLUBS[1]);
    let winner: Team | null = pensWinner ?? (draw ? null : outcome.score[0] > outcome.score[1] ? 0 : 1);
    const stats = statsObserver.current.stats;
    const [homePossession, awayPossession] = possessionShare(stats);
    let penalties: [number, number] | undefined;
    let detail = `${home.name} ${outcome.score[0]} - ${outcome.score[1]} ${away.name} · ${matchClock(current)}'`;
    let title = winner === null ? 'full time · draw' : online
      ? (localPlayerIds.some((id) => teamOf(id) === winner) ? 'you win' : 'match over')
      : winner === localTeam ? 'you win' : 'match lost';
    if (currentCompetition === 'cup') {
      const cup = loadCup() ?? createCup(home.id, current.seed);
      penalties = draw ? outcome.pens ?? (pensWinner !== null ? shootoutScore(current) : undefined) : undefined;
      if (penalties) {
        winner = penalties[0] > penalties[1] ? 0 : 1;
        detail += ` (${penalties[0]}-${penalties[1]} pens)`;
      }
      const nextCup = recordUserResult(cup, outcome.score, penalties);
      saveCup(nextCup);
      title = nextCup.champion ? 'cup winners!' : nextCup.out ? 'knocked out'
        : nextCup.round === 1 ? 'through to the semi-finals'
        : nextCup.round === 2 ? 'through to the final' : 'through to the next round';
    }
    if (room?.isHost) {
      const seats = winner === null ? [] : [...controllerPlayers.current].filter(([, id]) => teamOf(id) === winner).map(([seat]) => seat);
      room.reportResult(room.round, seats[0] ?? null, seats);
    }
    const penaltiesText = pensWinner !== null ? ` · pens ${shootoutScore(current).join(' - ')}` : penalties ? ` · pens ${penalties.join(' - ')}` : '';
    detail += ` · shots ${stats.teams[0].shots}-${stats.teams[1].shots} · possession ${homePossession}%-${awayPossession}%${penaltiesText}`;
    fullTimeResult.current = { title, detail };
    showPresentation('full-time');
  };

  const update = (loopDt: number) => {
    const now = performance.now();
    const previousFrame = lastFrameTime.current;
    const dt = loopDt <= 0 ? 0 : Math.min(0.1, Math.max(0, previousFrame === null ? loopDt : (now - previousFrame) / 1000));
    lastFrameTime.current = now;
    const current = worldRef.current;
    const room = onlineRef.current;
    if (!current || shellRef.current.status !== 'playing') {
      telemetryMatchActive.current = false;
      telemetryFrameAt.current = null;
      telemetryRef.current?.setPhase('menu');
      telemetryRef.current?.match(false);
      return;
    }
    telemetryRef.current?.setPhase(current.phase);
    const matchActive = shellRef.current.status === 'playing' && current.phase !== 'full-time';
    if (telemetryMatchActive.current !== matchActive) {
      telemetryMatchActive.current = matchActive;
      telemetryFrameAt.current = null;
    }
    telemetryRef.current?.match(matchActive);
    const presentPhoneSeats = room?.players.filter((player) => player.seat > 0).map((player) => player.seat) ?? [];
    let phoneDisconnected = false;
    if (room?.isHost) {
      if (matchSeats.current === null) matchSeats.current = [...presentPhoneSeats];
      const missing = missingPhoneSeats(matchSeats.current, presentPhoneSeats);
      if (missing.length === 0) {
        for (const seat of presentPhoneSeats) {
          if (!matchSeats.current.includes(seat)) matchSeats.current.push(seat);
        }
      }
      phoneDisconnected = missingPhoneSeats(matchSeats.current, presentPhoneSeats).length > 0;
    }
    setPhoneGone(phoneDisconnected);
    if (phoneDisconnected) accumulator.current = 0;
    if (introPending.current) {
      if (current.phase === 'restart' && current.restart === 'kickoff' && current.half === 1 && current.clock === current.halfLength) {
        introPending.current = false;
        showPresentation('intro');
      } else if (guestSnapshotAt.current !== null || current.phase !== 'restart' || current.clock < current.halfLength) {
        introPending.current = false;
      }
    }
    matchContext && (matchContext.current = { world: current, stats: statsObserver.current.stats });
    if (current.phase === 'full-time') finishMatch(current);
    const presentationKind = presentation.current;
    if (presentationKind === 'intro' || presentationKind === 'half-time' || presentationKind === 'full-time') {
      const elapsed = (now - presentationAt.current) / 1000;
      const minimum = presentationKind === 'intro' ? 0.6 : presentationKind === 'half-time' ? 1.5 : 2;
      const duration = presentationKind === 'intro' ? 5.5 : presentationKind === 'half-time' ? 10 : 12;
      let gamepadPressed = false;
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        Array.from(navigator.getGamepads()).forEach((pad, index) => {
          if (!pad) return;
          const buttons = Array.from(pad.buttons, (button) => button.pressed || button.value > 0.3);
          if (buttons.some((down, button) => down && !gamepadPrevious.current[index]?.buttons?.[button])) gamepadPressed = true;
          gamepadPrevious.current[index] = { ...gamepadPrevious.current[index], buttons };
        });
      }
      const keyPressed = elapsed >= minimum && keys.pressed(...commandKeys);
      const remotePressed = room?.isHost && [...remoteCommands.current.values()].some((command) => command.pressed);
      const skipped = elapsed >= minimum && (keyPressed || gamepadPressed || remotePressed);
      if (elapsed >= duration || skipped) {
        if (presentationKind === 'full-time') {
          if (!fullTimeShown.current && fullTimeResult.current) {
            fullTimeShown.current = true;
            shellRef.current.gameOver(undefined, fullTimeResult.current);
          }
        } else {
          showPresentation('live');
          if (audioEnabled) sound.synth.play({ kind: 'whistle', pattern: 'short' });
        }
      }
      if (room?.isHost) {
        for (const command of remoteCommands.current.values()) Object.assign(command, consumeCommand(command));
      }
    }
    const fxDirector = fxDirectorRef.current!;
    fxDirector.tick(dt);
    const isOnlineGuest = !!room && !room.isHost;
    controllerPlayers.current = reconcileControllers(current, controllerPlayers.current);
    if (room) {
      for (const [seat, id] of controllerPlayers.current) {
        if (room.players.some((entry) => entry.seat === seat)) continue;
        const player = current.players[id];
        if (player) { player.human = false; player.controlled = false; }
        if (current.controlledSeats && seat < current.controlledSeats.length) current.controlledSeats[seat] = null;
        controllerPlayers.current.delete(seat); remoteCommands.current.delete(id);
      }
      const roomMembers: ControllerMember[] = room.players.filter((entry) => entry.seat >= 0).map((entry) => {
        const known = lobbyState?.members.find((member) => member.seat === entry.seat);
        return known ?? { seat: entry.seat, role: entry.seat === 0 ? 'host' : 'phone', side: entry.seat === 0 ? 0 : 1 };
      });
      const assigned = assignControllers(roomMembers, currentMode, currentCompetition);
      for (const [seat, id] of assigned) {
        const active = current.controlledSeats?.[seat] ?? controllerPlayers.current.get(seat);
        if (active !== undefined && active !== null) controllerPlayers.current.set(seat, active);
        else if (!controllerPlayers.current.has(seat)) controllerPlayers.current.set(seat, id);
      }
      for (const entry of room.players) {
        if (entry.seat === 0 && displayOnlyRoom.current && currentCompetition !== 'online' || entry.seat < 0) continue;
        const id = current.controlledSeats?.[entry.seat] ?? controllerPlayers.current.get(entry.seat);
        if (id === undefined) continue;
        const player = current.players[id];
        if (player) { player.human = true; player.controlled = true; }
      }
    } else if (currentMode === 'coop' && controllerPlayers.current.size === 0) {
      controllerPlayers.current.set(0, 6); controllerPlayers.current.set(1, 9);
    }

    if (presentation.current === 'live' && current.phase === 'goal' && !replaySkipped.current && keys.pressed(...commandKeys)) replaySkipped.current = true;
    if (current.phase === 'goal' && Math.hypot(movement.current.x, movement.current.z) > 0.2) replaySkipped.current = true;
    if (current.phase === 'goal' && replaySkipped.current && fxDirector.goalPending) fxDirector.goalImpact();
    const commandsForUsers = userCommands.current;
    commandsForUsers.clear();
    const presentationGated = !isOnlineGuest && (presentation.current === 'intro' || presentation.current === 'half-time' || presentation.current === 'full-time');
    if (!presentationGated && current.phase !== 'goal' && room && !room.watching) {
      const id = controllerPlayers.current.get(room.seat) ?? localPlayerIds[0];
      if (id !== undefined) commandsForUsers.set(id, makeCommand(id, false, dt));
    } else if (!presentationGated && current.phase !== 'goal' && !room) {
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

    if (!isOnlineGuest && !phoneDisconnected) {
      const simulationStart = soccerPerfEnabled ? performance.now() : 0;
      accumulator.current = presentationGated ? 0 : Math.min(STEP * 6, accumulator.current + dt);
      const steps = Math.min(6, Math.floor(accumulator.current / STEP));
      let stepped = false;
      let stepIndex = 0;
      while (stepIndex < steps && presentation.current === 'live') {
        stepped = true;
        simulationTime.current += STEP;
        const commands = simulationCommands.current;
        commands.clear();
        for (const team of practiceRef.current ? [] : [0, 1] as const) {
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
        if (stepIndex === steps - 1 && previousRenderSnapshot.current) captureSnapshot(current, previousRenderSnapshot.current);
        const practice = practiceRef.current;
        if (practice) {
          const command = [...commands.values()].find((entry) => entry.pressed && (entry.action === 'pass' || entry.action === 'shoot'));
          if (practice.phase === 'done' && command && simulationTime.current - practiceDoneAt.current > 1) setupDrill(practice, current);
          stepPractice(practice, current, STEP, commands, levelRef.current, Math.floor(simulationTime.current / STEP), aiCommands.current[1]);
          if (practice.phase === 'done' && !practiceDoneAt.current) practiceDoneAt.current = simulationTime.current;
          if (practice.phase !== 'done') practiceDoneAt.current = 0;
          for (const event of practice.events) {
            if (event !== 'goal') sfx.play(event === 'good' ? 'coin' : event === 'done' ? (practice.newBest ? 'win' : 'select') : 'hit');
          }
          practice.events.length = 0;
        } else stepWorld(current, STEP, commands, debugConfig.clockScale);
        if (current.kickEvent) pendingSnapshotKick.current = { ...current.kickEvent };
        fxDirector.observe(current, simulationTime.current);
        statsObserver.current.observe(current, STEP);
        matchContext && (matchContext.current = { world: current, stats: statsObserver.current.stats });
        const tutorial = tutorialRef.current;
        if (tutorial) {
          const kick = current.kickEvent && current.players[current.kickEvent.playerId]?.team === 0 ? current.kickEvent.action : null;
          const moving = [...commands].some(([id, entry]) => current.players[id]?.human && Math.hypot(entry.move.x, entry.move.z) > 0.3);
          tutorialRef.current = stepTutorial(tutorial, { moving, passed: kick === 'pass' || kick === 'through' || kick === 'lob', shot: kick === 'shoot' || kick === 'finesse' }, STEP);
          if (tutorialRef.current.finished) endTutorial();
        }
        const assignments = reconcileControllers(current, controllerPlayers.current);
        for (const [seat, id] of assignments) {
          if (current.controlledSeats && current.controlledSeats[seat] !== null) assignments.set(seat, current.controlledSeats[seat]!);
          else if (current.controlledSeats && id !== undefined) current.controlledSeats[seat] = id;
        }
        for (const [seat, id] of assignments) {
          const old = controllerPlayers.current.get(seat);
          if (old === undefined || old === id) continue;
          const heldCommand = remoteCommands.current.get(old);
          remoteCommands.current.delete(old);
          if (heldCommand) remoteCommands.current.set(id, heldCommand);
        }
        controllerPlayers.current = assignments;
        accumulator.current -= STEP;
        if (audioEnabled) sound.observe(current, simulationTime.current);
        soundForWorld(current);
        if (current.phase === 'goal' && replayStartedAt.current === null) replayStartedAt.current = simulationTime.current;
        if (simulationTime.current - soundTime.current > 0.075) {
          appendReplayFrame(replayFrames.current, current, simulationTime.current);
          soundTime.current = simulationTime.current;
        }
        for (const command of commands.values()) {
          Object.assign(command, consumeCommand(command));
        }
        stepIndex++;
        if (current.phase === 'half-time' && previousPhase !== 'half-time') {
          showPresentation('half-time');
          accumulator.current = 0;
          break;
        }
        if (current.phase === 'full-time' && previousPhase !== 'full-time') {
          showPresentation('full-time');
          accumulator.current = 0;
          break;
        }
      }
      if (stepped) renderDirty.current = true;
      if (soccerPerfEnabled) recordSoccerPerf('simulationMs', performance.now() - simulationStart);
    } else if (isOnlineGuest) {
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
        const state = cloneSnapshot(current);
        if (!state.kickEvent && pendingSnapshotKick.current) state.kickEvent = { ...pendingSnapshotKick.current };
        pendingSnapshotKick.current = null;
        const ack = [0, 1, 2, 3].map((seat) => remoteSeats.current.get(seat)?.seq ?? -1);
        room.send({ t: 'soccer', k: 's', r: room.round || 1, seq: snapshotSequence.current++, state, ack });
      }
      practiceStatusTimer.current += dt;
      const practice = practiceRef.current;
      const tutorial = tutorialRef.current;
      if ((practice || tutorial) && practiceStatusTimer.current >= 0.4) {
        practiceStatusTimer.current = 0;
        const view = practice ? practiceView(practice) : null;
        room.send({ t: 'soccer', k: 'pp', r: room.round || 1, seq: snapshotSequence.current++, drill: view?.drill ?? '', prompt: view?.prompt ?? '', hint: view?.hint ?? '', score: view?.score ?? '', best: view?.best ?? '', done: !!view?.done, tutorial: tutorial ? tutorialText(tutorial) : '' });
      }
    }

    if (audioEnabled) sound.frame(current, isOnlineGuest ? now / 1000 : simulationTime.current);

    if (debugConfig.enabled) {
      (window as Window & { __soccerWorld?: World }).__soccerWorld = current;
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

    let renderWorld: World;
    if (isOnlineGuest) renderWorld = onlineRenderState(guestSnapshots.current, performance.now() / 1000, current);
    else if (previousRenderSnapshot.current && interpolatedWorld.current) {
      const interpolationStart = soccerPerfEnabled ? performance.now() : 0;
      renderWorld = interpolateInto(interpolatedWorld.current, previousRenderSnapshot.current, current, accumulator.current / STEP);
      if (soccerPerfEnabled) recordSoccerPerf('interpolationMs', performance.now() - interpolationStart);
    } else renderWorld = current;
    let camera: CameraMode = presentation.current === 'intro' ? 'intro' : cameraRef.current;
    if (renderWorld.phase === 'restart' && renderWorld.setPiece && ['corner', 'free-kick', 'penalty'].includes(renderWorld.setPiece.kind)) camera = 'setpiece';
    const replayClock = isOnlineGuest ? performance.now() / 1000 : simulationTime.current;
    const replaying = !replaySkipped.current && replayStartedAt.current !== null && current.phase === 'goal';
    if (!replaySkipped.current && replayStartedAt.current !== null && current.phase === 'goal') {
      if (!replaySkipped.current) {
        const from = replayStartedAt.current - 2.4;
        const progress = fxDirector.replayProgress(clamp((replayClock - replayStartedAt.current) / 3, 0, 1));
        renderWorld = sampleReplay(replayFrames.current, from + progress * 2.4, current, replayWorld.current) ?? current;
        camera = 'replay';
      }
    }
    if (!replaying && !isOnlineGuest) {
      if (current.phase !== 'goal' && fxDirector.goalPending) fxDirector.goalImpact();
      renderWorld = fxDirector.renderWorld(renderWorld);
    }
    const selectedPlayerId = controllerPlayers.current.get(room?.seat ?? 0) ?? localPlayerIds[0] ?? current.controlled[0];
    const selected = current.players[selectedPlayerId]!;
    const aiming = charging.current.get(selectedPlayerId);
    const selectedCommand = commandsForUsers.get(selectedPlayerId);
    const remote = remoteCommands.current.get(selectedPlayerId);
    const heldAction = aiming?.holding ? aiming.action : remote?.heldAction;
    let target = current.passTarget;
    if (target === null && nearestCarrier(current)?.id === selected.id
      && (heldAction === 'pass' || heldAction === 'through' || heldAction === 'lob')
      && current.ball.y < 0.75 && distance(selected, current.ball) < 0.8) {
      const requestedAim = selectedCommand?.aim ?? { x: Math.sin(selected.facing), z: Math.cos(selected.facing) };
      const aim = Math.hypot(requestedAim.x, requestedAim.z) > 0.2
        ? requestedAim
        : { x: Math.sin(selected.facing), z: Math.cos(selected.facing) };
      const cross = heldAction === 'lob' && isCross(current, selected);
      const receiverPower = aiming?.holding ? chargePower(aiming.seconds) : remote?.power ?? 0.45;
      target = findReceiver(current, selected, aim, heldAction === 'through', cross, false, receiverPower)?.id ?? null;
    }
    const indicatorPower = aiming?.holding ? chargePower(aiming.seconds) : power.current ?? (remote?.heldAction ? remote.power ?? null : null);
    const sceneStart = soccerPerfEnabled ? performance.now() : 0;
    viewRef.current?.update(renderWorld, dt * fxDirector.animScale, performance.now() / 1000, localTeam, camera, target, indicatorPower, dt, localPlayerIds);
    if (soccerPerfEnabled) recordSoccerPerf('sceneUpdateMs', performance.now() - sceneStart);
    viewRef.current?.setMarkers(practiceRef.current?.markers ?? []);
    hudTimer.current += dt;
    if (hudTimer.current > 0.09) {
      hudTimer.current = 0;
      if (current.event !== previousHudEvent.current || current.eventTime > previousHudEventTime.current + 0.02) {
        hudEventKey.current++;
      }
      previousHudEvent.current = current.event;
      previousHudEventTime.current = current.eventTime;
      const selectedState = selected.action === 'jockey' ? selectedCommand?.contain || remote?.contain ? 'CONTAIN' : 'JOCKEY'
        : selected.action === 'shield' ? 'SHIELD'
          : selected.slide ? 'SLIDE' : Math.hypot(selected.vx, selected.vz) > 7.1 ? 'SPRINT' : null;
      const clock = broadcastClock(current, statsObserver.current.stats);
      let rival: World['players'][number] | null = null;
      for (const player of current.players) {
        if (player.team === selected.team) continue;
        if (!rival || (player.controlled !== rival.controlled ? player.controlled : distance(player, current.ball) < distance(rival, current.ball))) rival = player;
      }
      const partner = localPlayerIds.map((id) => current.players[id]).find((player) => player && player.id !== selectedPlayerId && player.team === selected.team && player.human) ?? null;
      const nextHud: HudState = {
        score0: current.score[0], score1: current.score[1], clock: clock.label, added: clock.added,
        half: current.half, phase: current.phase, event: current.event, eventTime: current.eventTime, eventKey: hudEventKey.current,
        selectedId: selectedPlayerId, stamina: Math.round(selected.stamina * 50) / 50, rivalId: rival?.id ?? null, rivalStamina: Math.round((rival?.stamina ?? 1) * 50) / 50, partnerId: partner?.id ?? null, partnerStamina: Math.round((partner?.stamina ?? 1) * 50) / 50, state: selectedState, targetId: target,
        power: indicatorPower, replaying: current.phase === 'goal' && !replaySkipped.current,
        statsVersion: statsObserver.current.stats.version, presentation: presentation.current,
      };
      setHud((previous) => shallowHudEqual(previous, nextHud) ? previous : nextHud);
      radarRef.current?.draw(renderWorld, target);
      if (practiceRef.current) setPracticeHud(practiceView(practiceRef.current));
      setTutorialHud(tutorialRef.current);
    }
    if (!isOnlineGuest) renderDirty.current = true;
    if (current.phase === 'full-time') finishMatch(current);
  };

  const scheme: ControlScheme = online?.isHost ? 'phone' : shell.touch ? 'touch' : 'keys';

  useGameLoop(update, () => {
    if (!renderDirty.current) return;
    const renderStart = soccerPerfEnabled ? performance.now() : 0;
    viewRef.current?.render();
    const now = performance.now();
    if (telemetryMatchActive.current) {
      const lastTelemetryFrame = telemetryFrameAt.current;
      if (lastTelemetryFrame !== null) telemetryRef.current?.frame(now - lastTelemetryFrame);
      telemetryFrameAt.current = now;
    } else {
      telemetryFrameAt.current = null;
    }
    const qualityDue = now - lastQualitySampleAt.current >= 1000;
    const stats = soccerPerfEnabled || qualityDue ? viewRef.current?.perfStats() : undefined;
    if (stats && qualityDue) {
      telemetryRef.current?.quality(stats.qualityTier, stats.dpr);
      lastQualitySampleAt.current = now;
    }
    if (soccerPerfEnabled) {
      recordSoccerPerf('renderMs', performance.now() - renderStart);
      if (stats) recordSoccerRendererStats(stats);
      publishSoccerPerf();
    }
    renderDirty.current = false;
  });

  return (
    <div className={`g-soccer-stage${practicing ? ' is-practice' : ''}`}>
      <div className="g-soccer-canvas" ref={ref} />
      <LoadProgress className="is-stage" />
      <Hud state={hud} watching={!!online?.watching} radarRef={radarRef} world={world} />
      {hud.presentation === 'intro' && <IntroCard />}
      {(hud.presentation === 'half-time' || hud.presentation === 'full-time') && <StatsScreen presentation={hud.presentation} statsVersion={hud.statsVersion} />}
      {phoneGone && <div className="g-soccer-phone-gone" role="status">Phone disconnected - reopen the link</div>}
      {audioEnabled && caption && <div key={caption.id} className="g-soccer-caption" aria-live="polite">{caption.text}</div>}
      {audioEnabled && shell.status === 'playing' && !muted && volumeChoice !== 'off' && soundLocked && (
        <div className="g-soccer-sound-lock">Click or press any key for sound</div>
      )}
      {practicing && practiceHud && shell.status === 'playing' && <PracticePanel view={practiceHud} scheme={scheme} compact={shell.touch} onPick={pickPractice} />}
      {tutorialHud && shell.status === 'playing' && <TutorialOverlay tutorial={tutorialHud} scheme={scheme} seconds={TUTORIAL_SECONDS} onSkip={endTutorial} />}
      <Referee world={world} />
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
function PadStick({ movement, onChange }: { movement: { current: { x: number; z: number } }; onChange?: () => void }) {
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLElement>(null);
  const pointer = useRef<number | null>(null);
  const origin = useRef<PadPoint>({ x: 0, y: 0 });
  useEffect(() => {
    const reset = () => {
      if (pointer.current !== null) {
        try { zone.current?.releasePointerCapture(pointer.current); } catch {}
      }
      pointer.current = null;
      movement.current = { x: 0, z: 0 };
      onChange?.();
      if (base.current) {
        base.current.style.left = '';
        base.current.style.top = '';
        delete base.current.dataset.active;
      }
      if (knob.current) knob.current.style.transform = '';
    };
    window.addEventListener('soccer-pad-reset', reset);
    return () => window.removeEventListener('soccer-pad-reset', reset);
  }, [movement, onChange]);
  const metrics = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const size = base.current?.offsetWidth ?? 0;
    return { rect, margin: size / 2, travel: size * STICK.travel, thumb: { x: event.clientX - rect.left, y: event.clientY - rect.top } };
  };
  const draw = (thumb: PadPoint, travel: number) => {
    const { knob: offset, move } = stickVector(thumb.x - origin.current.x, thumb.y - origin.current.y, travel);
    movement.current = move;
    onChange?.();
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
    onChange?.();
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
        padHaptic(8);
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

export function PhoneController() {
  const online = useOnline();
  const lobbyState = useLobbyState();
  const telemetryRef = useRef<TelemetryHandle | null>(null);
  const movement = useRef({ x: 0, z: 0 });
  const held = useRef<Command['action']>(null);
  const sprint = useRef(false);
  const sequence = useRef(0);
  const edgeSequence = useRef(0);
  const edgeRepeat = useRef<{ id: number; until: number; action: Command['action']; heldAction: Command['action']; pressed: boolean; power: number; finesse: boolean; aim: { x: number; z: number }; switchNearest: boolean; switchDir?: { x: number; z: number } } | null>(null);
  const lastPacketSentAt = useRef(0);
  const stickSendTimer = useRef(0);
  const phoneWorld = useRef<World | null>(null);
  const shoulder = useRef(false);
  const press = useRef(false);
  const jockey = useRef(false);
  const lastAim = useRef({ x: 0, z: 0, t: 0 });
  const holdAim = useRef<{ x: number; z: number } | null>(null);
  const resizeResetFrame = useRef(0);
  const faceRefs = useRef<Partial<Record<FaceKey, HTMLButtonElement | null>>>({});
  const facePointers = useRef(new Map<number, FaceKey | null>());
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const previousScore = useRef<[number, number]>([0, 0]);
  const previousKickKey = useRef<string | null>(null);
  const reducedMotion = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const phoneFlashId = useRef(0);
  const [phoneFlash, setPhoneFlash] = useState<{ id: number; kind: 'goal' | 'shot' } | null>(null);
  const [displayOnly, setDisplayOnly] = useState(true);
  const [mode, setMode] = useState<Mode>('cpu');
  const [practiceStatus, setPracticeStatus] = useState<PhonePracticeStatus | null>(null);
  const [chargeProgress, setChargeProgress] = useState(0);
  const [chargingAction, setChargingAction] = useState<Command['action']>(null);
  const chargeStartedAt = useRef<number | null>(null);
  useEffect(() => {
    const telemetry = startSoccerTelemetry('controller');
    telemetryRef.current = telemetry;
    telemetry?.setPhase('menu');
    return () => {
      telemetry?.stop();
      if (telemetryRef.current === telemetry) telemetryRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (online?.transport) telemetryRef.current?.transport(online.transport);
  }, [online?.transport]);
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
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => { reducedMotion.current = preference.matches; };
    updatePreference();
    preference.addEventListener('change', updatePreference);
    const target = window as Window & { __soccerFx?: { trigger: (kind: string, advance?: number) => void } };
    if (!new URLSearchParams(location.search).has('soccerdebug')) {
      return () => preference.removeEventListener('change', updatePreference);
    }
    const debugFx = {
      trigger(kind: string, _advance = 0) {
        if (reducedMotion.current) return;
        setPhoneFlash({ id: ++phoneFlashId.current, kind: kind.includes('shot') || kind === 'power-shot' ? 'shot' : 'goal' });
      },
    };
    target.__soccerFx = debugFx;
    return () => {
      preference.removeEventListener('change', updatePreference);
      if (target.__soccerFx === debugFx) delete target.__soccerFx;
    };
  }, []);
  const phoneHasBall = () => {
    const snapshot = phoneWorld.current;
    const seat = online?.seat ?? 0;
    const member = lobbyState?.members.find((entry) => entry.seat === seat)
      ?? { seat, role: 'phone' as const, side: sideForRoom(online?.code) };
    const playerId = snapshot?.controlledSeats?.[seat] ?? assignControllers([member], mode, lobbyState?.comp ?? 'quick').get(seat)
      ?? playerForSeat(seat, displayOnly, mode);
    return !!snapshot && nearestCarrier(snapshot)?.team === teamOf(playerId);
  };
  const phonePlayerId = () => {
    const seat = online?.seat ?? 0;
    const snapshot = phoneWorld.current;
    const assigned = snapshot?.controlledSeats?.[seat] ?? playerForSeat(seat, displayOnly, mode);
    return snapshot && !snapshot.players[assigned]?.human ? snapshot.controlled[teamOf(assigned)] : assigned;
  };
  const aimForKick = () => {
    const now = performance.now();
    const current = movement.current;
    if (Math.hypot(current.x, current.z) >= 0.3) return { ...current };
    if (holdAim.current) return { ...holdAim.current };
    if (now - lastAim.current.t <= 150) return { x: lastAim.current.x, z: lastAim.current.z };
    return { x: 0, z: 0 };
  };
  const send = (action: Command['action'] = null, pressed = false, power = chargePower(chargeStartedAt.current === null ? 0 : (performance.now() - chargeStartedAt.current) / 1000), switchNearest = false, edge = false) => {
    if (!online) return;
    const now = performance.now();
    if (stickSendTimer.current) {
      window.clearTimeout(stickSendTimer.current);
      stickSendTimer.current = 0;
    }
    const sendAction = action === 'shoot' && shoulder.current && phoneHasBall() ? 'finesse' : action;
    if (Math.hypot(movement.current.x, movement.current.z) >= 0.3) {
      lastAim.current = { ...movement.current, t: now };
      if (held.current) holdAim.current = { ...movement.current };
    }
    const actionAim = pressed || edge ? aimForKick() : { ...movement.current };
    if (edge) {
      edgeRepeat.current = {
        id: edgeSequence.current++,
        until: now + 250,
        action: sendAction,
        heldAction: held.current,
        pressed,
        power,
        finesse: shoulder.current,
        aim: actionAim,
        switchNearest,
        ...(Math.hypot(movement.current.x, movement.current.z) >= 0.3 ? { switchDir: { ...movement.current } } : {}),
      };
    }
    const repeat = edgeRepeat.current && now <= edgeRepeat.current.until ? edgeRepeat.current : null;
      const command: ControlCommand = {
      move: movement.current,
      sprint: sprint.current,
      jockey: jockey.current,
      action: sendAction,
      heldAction: held.current,
      pressed,
      power,
      finesse: shoulder.current,
      autoJockey: true,
      contain: !phoneHasBall() && held.current === 'pass',
      finesseHeld: shoulder.current,
      switchNearest,
      aim: actionAim,
      press: shoulder.current || press.current,
      ...(switchNearest && Math.hypot(movement.current.x, movement.current.z) >= 0.3 ? { switchDir: { ...movement.current } } : {}),
    };
    if (repeat) Object.assign(command, {
      action: repeat.action,
      heldAction: repeat.heldAction,
      pressed: repeat.pressed,
      power: repeat.power,
      finesse: repeat.finesse,
      aim: repeat.aim,
      switchNearest: repeat.switchNearest,
      switchDir: repeat.switchDir,
    });
    const seq = sequence.current++;
    online.send(movePacket(online.round || 1, seq, online.seat, command, repeat?.id), { fast: true });
    telemetryRef.current?.sent(seq);
    lastPacketSentAt.current = now;
  };
  const sendStickChange = () => {
    const remaining = 16 - (performance.now() - lastPacketSentAt.current);
    if (remaining <= 0) {
      send();
      return;
    }
    if (stickSendTimer.current) return;
    stickSendTimer.current = window.setTimeout(() => {
      stickSendTimer.current = 0;
      sendStickChange();
    }, remaining);
  };
  const beginCharge = (action: Command['action']) => {
    holdAim.current = null;
    const taker = phoneWorld.current?.phase === 'restart' && phoneWorld.current.setPiece?.takerId === phonePlayerId();
    if (!taker && !phoneHasBall() && phoneWorld.current && nearestCarrier(phoneWorld.current) && action !== 'pass') {
      send(action, true, undefined, false, true);
      return;
    }
    held.current = action;
    chargeStartedAt.current = performance.now();
    setChargingAction(action);
    setChargeProgress(0);
    send(null, false, undefined, false, true);
  };
  const releaseCharge = (action: Command['action'], vibrate = true) => {
    if (chargeStartedAt.current !== null && held.current !== action) return;
    const started = chargeStartedAt.current;
    const power = chargePower(started === null ? 0 : (performance.now() - started) / 1000);
    held.current = null;
    chargeStartedAt.current = null;
    setChargingAction(null);
    setChargeProgress(0);
    send(started !== null && vibrate ? action : null, started !== null && vibrate, power, false, started !== null);
    if (vibrate && started !== null) padHaptic(18);
  };
  useEffect(() => {
    const reset = () => {
      window.dispatchEvent(new Event('soccer-pad-reset'));
      facePointers.current.clear();
      faceRefs.current && Object.values(faceRefs.current).forEach((element) => element && markPressed(element, false));
      document.querySelectorAll<HTMLElement>('.g-soccer-pad-shoulders button').forEach((element) => markPressed(element, false));
      held.current = null;
      chargeStartedAt.current = null;
      holdAim.current = null;
      setChargingAction(null);
      setChargeProgress(0);
      shoulder.current = false;
      press.current = false;
      jockey.current = false;
      sprint.current = false;
      if (resizeResetFrame.current) cancelAnimationFrame(resizeResetFrame.current);
      resizeResetFrame.current = requestAnimationFrame(() => {
        resizeResetFrame.current = 0;
        send(null, false, 0.1);
      });
    };
    window.addEventListener('orientationchange', reset);
    window.addEventListener('resize', reset);
    window.visualViewport?.addEventListener('resize', reset);
    return () => {
      window.removeEventListener('orientationchange', reset);
      window.removeEventListener('resize', reset);
      window.visualViewport?.removeEventListener('resize', reset);
      if (resizeResetFrame.current) cancelAnimationFrame(resizeResetFrame.current);
    };
  }, [online]);
  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, data) => {
      if (from !== 0) return;
      const packet = parsePacket(data);
      if (packet?.k === 'lobby') publishLobby(packet);
      if (packet?.k === 's') {
        telemetryRef.current?.seq(packet.seq);
        const ack = packet.ack?.[online.seat];
        if (ack !== undefined && ack >= 0) telemetryRef.current?.ack(ack);
        telemetryRef.current?.setPhase(packet.state.phase);
        telemetryRef.current?.match(packet.state.phase !== 'full-time');
        phoneWorld.current = packet.state;
        const phoneTeam = teamOf(playerForSeat(online.seat, displayOnly, mode));
        const feedback = phoneFx(previousScore.current, previousKickKey.current, packet.state, phoneTeam);
        if (feedback) {
          if (feedback === 'goal-for') fxHaptic([70, 40, 120]);
          else if (feedback === 'goal-against') fxHaptic([40]);
          else fxHaptic([22]);
          if (!reducedMotion.current) {
            setPhoneFlash({ id: ++phoneFlashId.current, kind: feedback === 'shot' ? 'shot' : 'goal' });
          }
        }
        const kick = packet.state.kickEvent;
        previousKickKey.current = kick ? `${kick.playerId}:${kick.time}:${kick.action}` : null;
        previousScore.current = [...packet.state.score];
        setScore(packet.state.score);
      } else if (packet?.k === 'cfg') {
        setDisplayOnly(true);
        if (packet.mode) setMode(packet.mode);
        if (packet.mode !== 'practice') setPracticeStatus((status) => status?.tutorial ? status : null);
      } else if (packet?.k === 'pp') {
        telemetryRef.current?.seq(packet.seq);
        setPracticeStatus(packet.drill || packet.tutorial ? { drill: packet.drill, prompt: packet.prompt, hint: packet.hint, score: packet.score, best: packet.best, done: packet.done, tutorial: packet.tutorial } : null);
      }
    });
    const timer = window.setInterval(() => {
      send();
      if (chargeStartedAt.current !== null) setChargeProgress(Math.min(1, (performance.now() - chargeStartedAt.current) / 1000));
    }, 1000 / 30);
    return () => { off(); window.clearInterval(timer); window.clearTimeout(stickSendTimer.current); };
  }, [online, mode, displayOnly]);
  if (!online) return null;
  if (online.round === 0) return <PhoneTeamPicker online={online} />;
  const phonePlayer = phonePlayerId();
  const attacking = phoneHasBall();
  const labels = phoneWorld.current ? setPieceLabels(phoneWorld.current, teamOf(phonePlayer), phonePlayer) : null;
  const taking = phoneWorld.current?.phase === 'restart' && phoneWorld.current.setPiece?.takerId === phonePlayer;
  const chargingKey = FACE_KEYS.find((key) => FACE[key] === chargingAction) ?? null;
  const faceLabel = faceLabels(attacking, labels ? { a: labels.a, b: labels.b, x: labels.x, y: labels.y } : null);
  const faceAt = (event: PointerEvent<HTMLElement>) => hitButton({ x: event.clientX, y: event.clientY }, FACE_KEYS.flatMap((id) => {
    const rect = faceRefs.current[id]?.getBoundingClientRect();
    return rect ? [{ id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 }] : [];
  }));
  const pressFace = (key: FaceKey) => {
    markPressed(faceRefs.current[key], true);
    padHaptic(10);
    if (key === 'y' && !attacking) {
      press.current = true;
      send(null, false, 0.1, false, true);
      return;
    }
    beginCharge(FACE[key]);
  };
  const releaseFace = (key: FaceKey, fire: boolean) => {
    const element = faceRefs.current[key];
    markPressed(element, false);
    if (fire) markFired(element);
    if (key === 'y' && !attacking) {
      press.current = false;
      send();
      return;
    }
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
      padHaptic(8);
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
  const lbLabel = labels?.lb ?? (attacking ? 'Skill' : 'Switch');
  const rbLabel = labels?.rb ?? (attacking ? 'Finesse' : 'Press');
  return (
    <div className={`g-soccer-phone-controller g-soccer-pad ${attacking ? 'is-attack' : 'is-defend'}`}>
      {phoneFlash && <div key={phoneFlash.id} className={`g-soccer-phone-flash is-${phoneFlash.kind}`} aria-hidden="true" onAnimationEnd={() => setPhoneFlash(null)} />}
      <PadStick movement={movement} onChange={sendStickChange} />
      <div className="g-soccer-pad-strip">
        <div className="g-soccer-pad-score" aria-label={`Score ${score[0]} to ${score[1]}`}>
          <strong>{score[0]} <i>–</i> {score[1]}</strong>
          <span>{phoneWorld.current ? matchClock(phoneWorld.current) : '00:00'}</span>
        </div>
        {practiceStatus && <PhonePracticeStrip status={practiceStatus} onPick={(pick) => online.send({ t: 'soccer', k: 'pd', r: online.round || 1, seq: sequence.current++, seat: online.seat, pick })} />}
      </div>
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
              aria-label={`${key.toUpperCase()}: ${faceLabel[key]}`}
            >
              <b>{key.toUpperCase()}</b>
              <small>{faceLabel[key]}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="g-soccer-pad-shoulders is-left">
        <button className="g-soccer-pad-trigger" {...pad(`LT: ${ltLabel} (hold)`, jockeyDown, jockeyUp)}><b>LT</b><small>{ltLabel}</small></button>
        <button className="g-soccer-pad-bumper" {...pad(`LB: ${lbLabel}`, () => send(taking || attacking ? 'skill' : null, taking || attacking, 0.1, !taking && !attacking, true))}><b>LB</b><small>{lbLabel}</small></button>
      </div>
      <div className="g-soccer-pad-shoulders is-right">
        <button className="g-soccer-pad-bumper" {...pad(`RB: ${rbLabel} (hold)`, bumperDown, bumperUp)}><b>RB</b><small>{rbLabel}</small></button>
        <button className="g-soccer-pad-trigger" {...pad('RT: Sprint (hold)', sprintDown, sprintUp)}><b>RT</b><small>Sprint</small></button>
      </div>
      <div className="g-soccer-pad-rotate" aria-live="polite">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 17h30v18H9zM15 12h18v5H15z" /><path d="M17 29c3-4 8-4 11 0m-3-4 3 4-4 1" /></svg>
        <strong>Rotate your phone</strong>
        <span>The controller works in landscape</span>
      </div>
    </div>
  );
}

function Stage({ joining }: { joining: boolean }) {
  const shell = useShell();
  const online = useOnline();
  // Whoever opens an invite waits for the room before mounting the 3D match, so a phone that becomes the controller
  // never loads three.js or the player models (shell.touch is only known after the first render).
  if (joining && !online && shell.status === 'ready') return null;
  if (shell.touch && online && !online.isHost && !online.watching) return <PhoneController />;
  return <Play key={`${shell.round}-${online?.round ?? 0}-${online?.handoffs ?? 0}`} audioEnabled={!shell.touch || !online || online.isHost} />;
}

export default function Soccer({ onExit, roomCode }: { onExit?: () => void; roomCode?: string }) {
  const [, setDisplayOnly] = useSetting(DISPLAY_ONLY);
  const match = useRef<MatchData | null>(null);
  useEffect(() => setDisplayOnly('on'), [setDisplayOnly]);
  return (
    <MatchContext.Provider value={match}>
      <GameShell
        meta={meta}
        className="g-soccer"
        onExit={onExit}
        roomCode={roomCode}
        phoneFirst
        setup={<Settings />}
        hostSetup={<SoccerPhoneLobby />}
        defaultBots={0}
        botNames={['bay city bot', 'northshore bot', 'wing bot', 'keeper bot']}
        quickNote="2v2, normal bots, and three-minute halves."
        quickPool="2v2"
        soloLabel="Play with keyboard"
      >
        <TelemetryBoundary><Stage joining={!!roomCode} /></TelemetryBoundary>
      </GameShell>
    </MatchContext.Provider>
  );
}

class TelemetryBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportSoccerError(error, 'react');
  }

  render() {
    if (this.state.error) throw this.state.error;
    return this.props.children;
  }
}
