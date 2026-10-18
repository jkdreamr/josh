import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  awardPoint,
  chooseShot,
  contactAccuracy,
  chargePower,
  cpuReturn,
  CPU_PROFILES,
  HALF_SMASH_POWER,
  COURT_HALF_LENGTH,
  createFlight,
  directionOf,
  endOf,
  faultLabel,
  newMatch,
  newStats,
  opposite,
  planShot,
  pressuredAccuracy,
  pointSituation,
  recordRally,
  recordSmash,
  serviceCourt,
  shotLabel,
  sideAt,
  smashLabel,
  smashPressure,
  smashRecoveryMs,
  startNextGame,
  stepFlight,
  takeInterval,
  type Difficulty,
  type FlightState,
  type Intent,
  type MatchLength,
  type MatchState,
  type MatchStats,
  type Point2D,
  type ShotOptions,
  type RallyCause,
  type RallyOutcome,
  type ShotType,
  type Side,
} from '../games/badminton';
import { clampToHalf, PLAYER_GRAVITY, PLAYER_JUMP_VELOCITY, PLAYER_STEP, RACKET_REACH, stepCpuBody, type CpuMind } from '../games/badminton-cpu';
import { useOS, type AppProps } from '../types';
import { countPlay } from '../stats';
import { getAppGame } from '../arcade/apps';
import { boardFor } from '../arcade/kit/leaderboard';
import { BadmintonAudio } from './badminton-audio';
import { drawScene, sceneMetrics, type AthleteView, type Impact, type LandingMark } from './badminton-draw';
import { parseGuestMessage, parseScore, parseSnapshot, trailPoint, type NetAthlete, type NetSnapshot } from './badminton-net';
import { AppBoard, onlineAvailable, RoomPanel, useAppRoom, useInvite, usePlayingRoom } from './online-room';
import './game-controls.css';
import './Badminton.css';

type Mode = 'cpu' | 'two' | 'online';
type Role = 'host' | 'guest' | null;
const BADMINTON = getAppGame('badminton')!;
/** How often the host streams the court to the guest. */
const SNAPSHOT_MS = 33;
/** Extra swing window for the guest, whose presses reach the host one trip late. */
const REMOTE_SWING_MS = 90;
type Screen = 'menu' | 'howto' | 'play' | 'summary';
type Phase = 'serve' | 'rally' | 'point' | 'interval' | 'game-end' | 'match-end';
type Settings = { mode: Mode; difficulty: Difficulty; length: MatchLength; sound: boolean };
type Controls = { left: boolean; right: boolean; jump: boolean; soft: boolean };
type Athlete = {
  side: Side;
  x: number;
  vx: number;
  jump: number;
  jumpVelocity: number;
  jumpRequested: boolean;
  swingStart: number;
  swingUntil: number;
  intent: Intent;
  seekX: number | null;
  /** clock when the hit input went down and is still held, for a charged smash */
  chargeStart: number | null;
  /** smash power of the swing in progress */
  power: number;
  /** off balance after a smash until this clock */
  recoverUntil: number;
};
type Announcement = { key: number; title: string; detail: string };
type Hud = { rally: number; shot: string };
type Pointer = { side: Side; startX: number; startY: number; startAt: number; moved: boolean; sentX?: number };
type Sim = {
  clock: number;
  phase: Phase;
  phaseUntil: number;
  freezeUntil: number;
  athletes: Record<Side, Athlete>;
  flight: FlightState | null;
  trail: Point2D[];
  marks: LandingMark[];
  impact: Impact | null;
  shake: number;
  rallyShots: number;
  rallyStart: number;
  lastShot: { type: ShotType; speed: number; power?: number } | null;
  cpu: CpuMind;
  cpuServeAt: number;
  /** the computer whiffed this flight and gets no second go */
  cpuMissed: boolean;
};

const SIDES: Side[] = ['a', 'b'];
const STEP = PLAYER_STEP;
const REACH = RACKET_REACH;
const SWING_MS = 170;
const SWING_DRAW_MS = 230;
const RUN_SPEED = 5.3;
const JUMP_VELOCITY = PLAYER_JUMP_VELOCITY;
const GRAVITY = PLAYER_GRAVITY;
/** A hold shorter than this is a tap: the press swing already played it. */
const CHARGE_MIN_MS = 150;
const SETTINGS_KEY = 'jk-badminton';
const DEFAULT_SETTINGS: Settings = { mode: 'cpu', difficulty: 'normal', length: 'game', sound: true };

const KEYS: Record<'p1' | 'p2', Record<keyof Controls | 'hit', string[]>> = {
  p1: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW'], soft: ['KeyS'], hit: ['Space', 'KeyJ'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], soft: ['ArrowDown'], hit: ['Enter', 'Slash'] },
};

const LENGTH_LABEL: Record<MatchLength, string> = { quick: 'Quick to 11', game: 'Game to 21', match: 'Best of Three' };
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', pro: 'Pro' };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      mode: parsed.mode === 'two' ? 'two' : 'cpu',
      difficulty: parsed.difficulty && parsed.difficulty in CPU_PROFILES ? parsed.difficulty : 'normal',
      length: parsed.length && parsed.length in LENGTH_LABEL ? parsed.length : 'game',
      sound: parsed.sound !== false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function newAthlete(side: Side): Athlete {
  return { side, x: 0, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, swingStart: -1e9, swingUntil: 0, intent: 'normal', seekX: null, chargeStart: null, power: HALF_SMASH_POWER, recoverUntil: 0 };
}

function newSim(): Sim {
  return {
    clock: 0,
    phase: 'serve',
    phaseUntil: 0,
    freezeUntil: 0,
    athletes: { a: newAthlete('a'), b: newAthlete('b') },
    flight: null,
    trail: [],
    marks: [],
    impact: null,
    shake: 0,
    rallyShots: 0,
    rallyStart: 0,
    lastShot: null,
    cpu: { reactAt: 0, target: null, predictAt: 0, home: 3.2 },
    cpuServeAt: 0,
    cpuMissed: false,
  };
}

function newControls(): Controls {
  return { left: false, right: false, jump: false, soft: false };
}

function kmh(speed: number) {
  return Math.round(speed * 3.6);
}

export default function Badminton({ args }: AppProps) {
  const os = useOS();
  const touch = os.mobile;
  const phone = os.mobile && !os.tablet;
  useEffect(() => countPlay('badminton'), [args.nonce]);

  const [settings, setSettings] = useState<Settings>(() => (args.room ? { ...loadSettings(), mode: 'online' } : loadSettings()));
  const [matchNo, setMatchNo] = useState(0);
  const roleRef = useRef<Role>(null);
  const [role, setRole] = useState<Role>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [match, setMatch] = useState<MatchState>(() => newMatch('game'));
  const [stats, setStats] = useState<MatchStats>(newStats);
  const [phase, setPhase] = useState<Phase>('serve');
  const [paused, setPaused] = useState(false);
  const [call, setCall] = useState<Announcement | null>(null);
  const [hud, setHud] = useState<Hud>({ rally: 0, shot: '' });

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim>(newSim());
  const matchRef = useRef(match);
  const statsRef = useRef(stats);
  const settingsRef = useRef(settings);
  const screenRef = useRef(screen);
  const pausedRef = useRef(paused);
  const controlsRef = useRef<Record<Side, Controls>>({ a: newControls(), b: newControls() });
  const pointersRef = useRef(new Map<number, Pointer>());
  const audioRef = useRef<BadmintonAudio | null>(null);
  const hudRef = useRef<Hud>({ rally: 0, shot: '' });
  const callKey = useRef(0);
  const sendRef = useRef<(d: unknown, options?: { fast?: boolean }) => void>(() => {});
  const pendingSnap = useRef<NetSnapshot | null>(null);
  const lastSnapClock = useRef(-Infinity);
  const lastSentAt = useRef(-Infinity);
  const lastScoreAt = useRef(-Infinity);
  /** Guest only: sends this screen's controls to the host. */
  const pushControls = (jumped = false) => {
    if (roleRef.current !== 'guest') return;
    sendRef.current({ t: 'in', c: { ...controlsRef.current.b } });
    if (jumped) sendRef.current({ t: 'jump' });
  };

  /** performance.now() when each side's hit input went down, while it is held */
  const chargeRef = useRef<Record<Side, number | null>>({ a: null, b: null });
  const startCharge = (side: Side) => {
    chargeRef.current[side] = performance.now();
    if (roleRef.current !== 'guest') simRef.current.athletes[side].chargeStart = simRef.current.clock;
  };
  /** Ends a hold and returns how long it lasted in ms. */
  const endCharge = (side: Side) => {
    const start = chargeRef.current[side];
    chargeRef.current[side] = null;
    simRef.current.athletes[side].chargeStart = null;
    return start === null ? 0 : performance.now() - start;
  };

  matchRef.current = match;
  statsRef.current = stats;
  settingsRef.current = settings;
  screenRef.current = screen;
  pausedRef.current = paused;

  const audio = () => {
    if (!audioRef.current) audioRef.current = new BadmintonAudio();
    audioRef.current.muted = !settingsRef.current.sound;
    return audioRef.current;
  };

  const isCpu = useCallback((side: Side) => settingsRef.current.mode === 'cpu' && side === 'b', []);
  const netNames = useRef<Record<Side, string>>({ a: 'Host', b: 'Guest' });
  /** The side this screen plays online: the host is a, the guest is b. */
  const mySide = (): Side => (roleRef.current === 'guest' ? 'b' : 'a');
  const nameOf = useCallback((side: Side, long = true) => {
    if (settingsRef.current.mode === 'cpu') return side === 'a' ? 'You' : long ? 'Computer' : 'CPU';
    if (settingsRef.current.mode === 'online' && roleRef.current) {
      if (side === (roleRef.current === 'guest' ? 'b' : 'a')) return 'You';
      const name = netNames.current[side];
      return long || name.length <= 8 ? name : `${name.slice(0, 7)}…`;
    }
    return side === 'a' ? (long ? 'Player 1' : 'P1') : long ? 'Player 2' : 'P2';
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  const announce = (title: string, detail: string) => {
    callKey.current += 1;
    setCall({ key: callKey.current, title, detail });
  };

  const placeAthletes = useCallback((sim: Sim, state: MatchState) => {
    for (const side of SIDES) {
      const direction = directionOf(side, state);
      const athlete = sim.athletes[side];
      athlete.x = -direction * (state.server === side ? 2.9 : 3.6);
      athlete.vx = 0;
      athlete.jump = 0;
      athlete.jumpVelocity = 0;
      athlete.jumpRequested = false;
      athlete.swingUntil = 0;
      athlete.seekX = null;
      athlete.chargeStart = null;
      athlete.recoverUntil = 0;
    }
    sim.cpu.home = 3.1;
  }, []);

  const beginServe = useCallback(
    (state: MatchState) => {
      const sim = simRef.current;
      sim.phase = 'serve';
      sim.flight = null;
      sim.trail = [];
      sim.impact = null;
      sim.lastShot = null;
      sim.rallyShots = 0;
      placeAthletes(sim, state);
      sim.cpuServeAt = sim.clock + 1000 + Math.random() * 500;
      setPhase('serve');
    },
    [placeAthletes],
  );

  const finishRally = useCallback(
    (outcome: RallyOutcome) => {
      const sim = simRef.current;
      const nextStats = recordRally(statsRef.current, outcome);
      statsRef.current = nextStats;
      setStats(nextStats);
      const next = awardPoint(matchRef.current, outcome.winner);
      matchRef.current = next;
      setMatch(next);
      sim.phase = 'point';
      sim.phaseUntil = sim.clock + 1500;
      setPhase('point');
      // Online calls go to both screens, so they name players instead of saying You.
      const who = settingsRef.current.mode === 'online' ? netNames.current[outcome.winner] : nameOf(outcome.winner);
      if (outcome.cause === 'in') {
        announce(`Point to ${who}`, outcome.shots >= 6 ? `Rally of ${outcome.shots} shots` : `${next.points.a} to ${next.points.b}`);
      } else {
        announce(faultLabel(outcome.cause), `Point to ${who}`);
      }
      const humanWon = settingsRef.current.mode === 'two' || outcome.winner === mySide();
      audio().point(humanWon);
    },
    [nameOf],
  );

  const strike = useCallback(
    (side: Side, type: ShotType, contact: Point2D, accuracy: number, options: ShotOptions) => {
      const sim = simRef.current;
      const state = matchRef.current;
      const direction = directionOf(side, state);
      const plan = planShot(type, direction, contact, Math.random, accuracy, options);
      const power = options.power ?? HALF_SMASH_POWER;
      const heading = sim.flight ? sim.flight.heading : 0;
      sim.flight = createFlight(contact, plan.velocity, side, direction, false, heading);
      sim.trail = [];
      sim.rallyShots += 1;
      const speed = Math.hypot(plan.velocity.vx, plan.velocity.vy);
      sim.lastShot = plan.type === 'smash' ? { type: plan.type, speed, power } : { type: plan.type, speed };
      sim.cpuMissed = false;
      const strong = plan.type === 'smash';
      sim.impact = { x: contact.x, y: contact.y, at: sim.clock, strong };
      if (strong) {
        sim.shake = Math.min(6, 2 + speed / 14);
        sim.freezeUntil = sim.clock + 45;
        statsRef.current = recordSmash(statsRef.current, side, speed);
        sim.athletes[side].recoverUntil = sim.clock + smashRecoveryMs(power);
      } else if (plan.type === 'drive') {
        sim.shake = 1.2;
      }
      if (isCpu(opposite(side))) sim.cpu.reactAt = sim.clock + CPU_PROFILES[settingsRef.current.difficulty].reactionMs;
      audio().hit(plan.type, speed);
    },
    [isCpu],
  );

  const launchServe = useCallback(
    (side: Side, intent: Intent) => {
      const sim = simRef.current;
      const state = matchRef.current;
      const direction = directionOf(side, state);
      const athlete = sim.athletes[side];
      const start = { x: athlete.x + direction * 0.45, y: 1.05 };
      const type: ShotType = intent === 'power' ? 'high-serve' : 'serve';
      const accuracy = isCpu(side) ? CPU_PROFILES[settingsRef.current.difficulty].accuracy : 1;
      const plan = planShot(type, direction, start, Math.random, accuracy);
      athlete.swingStart = sim.clock;
      athlete.swingUntil = 0;
      athlete.intent = 'soft';
      if (plan.fault) {
        finishRally({ winner: opposite(side), cause: 'serve-fault', shots: 0, seconds: 0 });
        return;
      }
      sim.flight = createFlight(start, plan.velocity, side, direction, true);
      sim.trail = [];
      sim.phase = 'rally';
      sim.rallyStart = sim.clock;
      sim.rallyShots = 1;
      sim.lastShot = { type: plan.type, speed: Math.hypot(plan.velocity.vx, plan.velocity.vy) };
      sim.cpuMissed = false;
      sim.impact = { x: start.x, y: start.y, at: sim.clock, strong: false };
      if (isCpu(opposite(side))) sim.cpu.reactAt = sim.clock + CPU_PROFILES[settingsRef.current.difficulty].reactionMs;
      setPhase('rally');
      audio().hit(plan.type, sim.lastShot.speed);
    },
    [finishRally, isCpu],
  );

  const continueFlow = useCallback(() => {
    if (roleRef.current === 'guest') {
      sendRef.current({ t: 'go' });
      return;
    }
    const sim = simRef.current;
    const state = matchRef.current;
    if (sim.phase === 'interval') {
      const next = takeInterval(state);
      matchRef.current = next;
      setMatch(next);
      beginServe(next);
    } else if (sim.phase === 'game-end') {
      const next = startNextGame(state);
      matchRef.current = next;
      setMatch(next);
      beginServe(next);
    }
  }, [beginServe]);

  const swing = useCallback(
    (side: Side, explicit?: Intent, power = HALF_SMASH_POWER) => {
      if (screenRef.current !== 'play' || pausedRef.current) return;
      const sim = simRef.current;
      const athlete = sim.athletes[side];
      const controls = controlsRef.current[side];
      const intent: Intent = explicit ?? (controls.soft ? 'soft' : controls.jump || athlete.jump > 0.05 ? 'power' : 'normal');
      if (roleRef.current === 'guest') {
        sendRef.current({ t: 'hit', intent, power });
        return;
      }
      if (sim.phase === 'serve') {
        if (matchRef.current.server === side) launchServe(side, intent);
        return;
      }
      if (sim.phase === 'rally') {
        if (sim.clock < athlete.swingStart + 110) return;
        athlete.swingStart = sim.clock;
        athlete.swingUntil = sim.clock + SWING_MS + (settingsRef.current.mode === 'online' && side === 'b' ? REMOTE_SWING_MS : 0);
        athlete.intent = intent;
        athlete.power = Math.max(0, Math.min(1, power));
        return;
      }
      if (sim.phase === 'interval' || sim.phase === 'game-end') continueFlow();
    },
    [continueFlow, launchServe],
  );

  const startMatch = useCallback(() => {
    countPlay('badminton');
    setMatchNo((n) => n + 1);
    const state = newMatch(settingsRef.current.length);
    const fresh = newStats();
    matchRef.current = state;
    statsRef.current = fresh;
    setMatch(state);
    setStats(fresh);
    simRef.current = newSim();
    controlsRef.current = { a: newControls(), b: newControls() };
    pointersRef.current.clear();
    setCall(null);
    setHud({ rally: 0, shot: '' });
    hudRef.current = { rally: 0, shot: '' };
    setPaused(false);
    setScreen('play');
    beginServe(state);
    audio().unlock();
  }, [beginServe]);

  const quitToMenu = () => {
    setPaused(false);
    setScreen('menu');
    setCall(null);
  };

  const room = useAppRoom('badminton', {
    onStart: (_round, seat, players) => {
      const next: Role = seat === 0 ? 'host' : 'guest';
      roleRef.current = next;
      setRole(next);
      netNames.current = { a: players.find((p) => p.seat === 0)?.name ?? 'Host', b: players.find((p) => p.seat === 1)?.name ?? 'Guest' };
      pendingSnap.current = null;
      lastSnapClock.current = -Infinity;
      lastSentAt.current = -Infinity;
      lastScoreAt.current = -Infinity;
      startMatch();
    },
    onEnd: () => {
      roleRef.current = null;
      setRole(null);
      quitToMenu();
    },
  });
  sendRef.current = room.send;
  usePlayingRoom('badminton', room);
  useInvite(room, args.room, args.nonce, () => {
    setSettings((current) => ({ ...current, mode: 'online' }));
    setScreen('menu');
  });

  const leaveOnline = () => {
    room.leave();
    roleRef.current = null;
    setRole(null);
    quitToMenu();
  };

  const togglePause = useCallback(() => {
    if (screenRef.current !== 'play' || settingsRef.current.mode === 'online') return;
    setPaused((current) => !current);
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = !settings.sound;
  }, [settings.sound]);

  // simulation and rendering loop
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;

    const stepAthlete = (athlete: Athlete, state: MatchState, sim: Sim) => {
      const direction = directionOf(athlete.side, state);
      const controls = controlsRef.current[athlete.side];
      let move = 0;
      if (athlete.seekX !== null) {
        const gap = athlete.seekX - athlete.x;
        move = Math.abs(gap) > 0.08 ? Math.sign(gap) : 0;
      } else {
        move = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
      }
      // Off balance after a smash, and set on the spot while winding one up.
      const charging = athlete.chargeStart !== null && sim.clock - athlete.chargeStart > CHARGE_MIN_MS;
      const targetVx = move * RUN_SPEED * (sim.clock < athlete.recoverUntil ? 0.5 : charging ? 0.75 : 1);
      const rate = Math.abs(targetVx) > Math.abs(athlete.vx) ? 28 : 34;
      athlete.vx += Math.max(-rate * STEP, Math.min(rate * STEP, targetVx - athlete.vx));
      if (Math.abs(athlete.vx) < 0.02 && move === 0) athlete.vx = 0;
      athlete.x = clampToHalf(athlete.x + athlete.vx * STEP, direction);
      if (athlete.jumpRequested) {
        athlete.jumpRequested = false;
        if (athlete.jump <= 0.001 && athlete.jumpVelocity <= 0) athlete.jumpVelocity = JUMP_VELOCITY;
      }
      if (athlete.jumpVelocity !== 0 || athlete.jump > 0) {
        athlete.jumpVelocity -= GRAVITY * STEP;
        athlete.jump = Math.max(0, athlete.jump + athlete.jumpVelocity * STEP);
        if (athlete.jump === 0 && athlete.jumpVelocity < 0) athlete.jumpVelocity = 0;
      }
    };

    const stepCpu = (sim: Sim, state: MatchState) => {
      stepCpuBody(sim.athletes.b, sim.cpu, {
        clock: sim.clock,
        rallying: sim.phase === 'rally',
        flight: sim.flight,
        side: 'b',
        direction: directionOf('b', state),
        profile: CPU_PROFILES[settingsRef.current.difficulty],
      });
    };

    const tryContacts = (sim: Sim, state: MatchState) => {
      const flight = sim.flight;
      if (!flight || flight.status !== 'flying') return;
      const side = opposite(flight.hitter);
      const athlete = sim.athletes[side];
      const direction = directionOf(side, state);
      const shuttle = flight.shuttle;
      if (shuttle.x * direction > 0.12) return;
      const racket = { x: athlete.x + direction * 0.5, y: 1.2 + athlete.jump };
      const distance = Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y);
      if (distance > REACH) return;
      const contact = { x: shuttle.x, y: shuttle.y };
      const incoming = sim.lastShot?.type ?? null;
      if (isCpu(side)) {
        if (sim.clock < sim.cpu.reactAt || sim.cpuMissed) return;
        athlete.swingStart = sim.clock - 70;
        athlete.intent = shuttle.y >= 1.6 ? 'normal' : 'soft';
        const reply = cpuReturn(contact, incoming, flight.elapsed, Math.abs(sim.athletes[opposite(side)].x), settingsRef.current.difficulty);
        if (reply.kind === 'miss') {
          sim.cpuMissed = true;
          return;
        }
        strike(side, reply.type, contact, reply.accuracy, reply.options);
        return;
      }
      if (sim.clock > athlete.swingUntil) return;
      athlete.swingUntil = 0;
      // A held key hits at whatever it has charged to by contact.
      const power = athlete.chargeStart !== null ? chargePower(sim.clock - athlete.chargeStart) : athlete.power;
      const accuracy = pressuredAccuracy(contactAccuracy(distance, REACH), smashPressure(incoming, flight.elapsed));
      strike(side, chooseShot(athlete.intent, contact), contact, accuracy, { power });
    };

    const settleFlight = (sim: Sim) => {
      const flight = sim.flight;
      if (!flight || flight.status === 'flying') return;
      const shuttle = flight.shuttle;
      let cause: RallyCause = 'in';
      let winner: Side = flight.hitter;
      if (flight.status === 'fault' && flight.fault) {
        cause = flight.fault === 'net' ? 'net' : flight.fault === 'out' ? 'out' : 'own-side';
        winner = opposite(flight.hitter);
      }
      sim.marks.push({ x: shuttle.x, at: sim.clock, kind: cause === 'in' ? 'in' : cause === 'net' ? 'net' : 'out' });
      if (cause === 'net') audio().netCord();
      else audio().land();
      finishRally({ winner, cause, shots: sim.rallyShots, seconds: (sim.clock - sim.rallyStart) / 1000 });
    };

    const simulate = (sim: Sim, state: MatchState) => {
      if (sim.clock < sim.freezeUntil) return;
      for (const side of SIDES) {
        if (isCpu(side)) stepCpu(sim, state);
        else stepAthlete(sim.athletes[side], state, sim);
      }
      if (sim.phase === 'rally' && sim.flight && sim.flight.status === 'flying') {
        tryContacts(sim, state);
        const flight = sim.flight;
        if (flight && flight.status === 'flying') {
          sim.flight = stepFlight(flight, STEP);
          const trailGap = sim.trail.length ? Math.hypot(sim.trail[sim.trail.length - 1].x - sim.flight.shuttle.x, sim.trail[sim.trail.length - 1].y - sim.flight.shuttle.y) : 1;
          if (trailGap > 0.12) {
            sim.trail.push({ x: sim.flight.shuttle.x, y: sim.flight.shuttle.y });
            if (sim.trail.length > 14) sim.trail.shift();
          }
          settleFlight(sim);
        }
      } else if (sim.phase === 'serve' && isCpu(state.server) && sim.clock >= sim.cpuServeAt) {
        launchServe('b', Math.random() < 0.3 ? 'power' : 'normal');
      }
    };

    const advancePhase = (sim: Sim) => {
      if (sim.phase !== 'point' || sim.clock < sim.phaseUntil) return;
      const state = matchRef.current;
      const humanWon = settingsRef.current.mode === 'two' || (state.gameWinner ?? state.matchWinner) === mySide();
      if (state.matchWinner) {
        sim.phase = 'match-end';
        setPhase('match-end');
        audio().gameOver(humanWon);
        setScreen('summary');
      } else if (state.gameWinner) {
        sim.phase = 'game-end';
        setPhase('game-end');
        audio().gameOver(humanWon);
      } else if (state.intervalDue) {
        sim.phase = 'interval';
        setPhase('interval');
      } else {
        beginServe(state);
      }
    };

    const syncHud = (sim: Sim) => {
      const next: Hud = {
        rally: sim.phase === 'rally' || sim.phase === 'point' ? sim.rallyShots : 0,
        shot: sim.lastShot
          ? sim.lastShot.type === 'smash' || sim.lastShot.type === 'drive'
            ? `${sim.lastShot.type === 'smash' ? smashLabel(sim.lastShot.power ?? HALF_SMASH_POWER) : shotLabel(sim.lastShot.type)} ${kmh(sim.lastShot.speed)} km/h`
            : shotLabel(sim.lastShot.type)
          : '',
      };
      if (next.rally !== hudRef.current.rally || next.shot !== hudRef.current.shot) {
        hudRef.current = next;
        setHud(next);
      }
    };

    const render = (sim: Sim, state: MatchState) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const athletes: AthleteView[] = SIDES.map((side) => {
        const athlete = sim.athletes[side];
        const progress = (sim.clock - athlete.swingStart) / SWING_DRAW_MS;
        return {
          side,
          x: athlete.x,
          vx: athlete.vx,
          jump: athlete.jump,
          facing: directionOf(side, state),
          swing: progress >= 0 && progress < 1 ? progress : null,
          charge: athlete.chargeStart !== null && sim.clock - athlete.chargeStart > CHARGE_MIN_MS ? Math.min(1, (sim.clock - athlete.chargeStart) / 600) : 0,
          intent: athlete.intent,
          label: nameOf(side, false),
          isHuman: !isCpu(side),
        };
      });
      sim.marks = sim.marks.filter((mark) => sim.clock - mark.at < 1000);
      drawScene(canvas, {
        athletes,
        flight: sim.flight,
        trail: sim.flight && sim.flight.status === 'flying' ? sim.trail : [],
        marks: sim.marks,
        impact: sim.impact,
        shake: sim.shake,
        now: sim.clock,
        receivingEnd: sim.phase === 'serve' ? endOf(opposite(state.server), state) : null,
        serviceCourt: sim.phase === 'serve' ? serviceCourt(state) : null,
      });
    };

    const applyAthlete = (athlete: Athlete, snap: NetAthlete) => {
      athlete.x = snap.x;
      athlete.vx = snap.vx;
      athlete.jump = snap.jump;
      athlete.jumpVelocity = snap.jumpVelocity;
      athlete.swingStart = snap.swingStart;
      athlete.intent = snap.intent;
    };
    const athleteSnap = (athlete: Athlete): NetAthlete => ({
      x: athlete.x,
      vx: athlete.vx,
      jump: athlete.jump,
      jumpVelocity: athlete.jumpVelocity,
      swingStart: athlete.swingStart,
      intent: athlete.intent,
    });

    // Guest: take the host's latest court, then carry the shuttle and players forward until the next one.
    const guestStep = (sim: Sim, state: MatchState, dt: number) => {
      const snap = pendingSnap.current;
      if (snap) {
        pendingSnap.current = null;
        if (snap.impact && snap.impact.at !== sim.impact?.at && snap.lastShot) audio().hit(snap.lastShot.type, snap.lastShot.speed);
        const mark = snap.marks[snap.marks.length - 1];
        if (mark && mark.at !== sim.marks[sim.marks.length - 1]?.at) {
          if (mark.kind === 'net') audio().netCord();
          else audio().land();
        }
        sim.clock = snap.clock;
        sim.phase = snap.phase;
        applyAthlete(sim.athletes.a, snap.a);
        applyAthlete(sim.athletes.b, snap.b);
        sim.flight = snap.flight;
        sim.marks = snap.marks;
        sim.impact = snap.impact;
        sim.shake = snap.shake;
        sim.rallyShots = snap.rallyShots;
        sim.lastShot = snap.lastShot;
        if (!sim.flight || sim.flight.status !== 'flying') sim.trail = [];
        else sim.trail = trailPoint(sim.trail, sim.flight.shuttle);
        return;
      }
      accumulator += dt;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        sim.clock += STEP * 1000;
        for (const side of SIDES) {
          const athlete = sim.athletes[side];
          athlete.x = clampToHalf(athlete.x + athlete.vx * STEP, directionOf(side, state));
          if (athlete.jumpVelocity !== 0 || athlete.jump > 0) {
            athlete.jumpVelocity -= GRAVITY * STEP;
            athlete.jump = Math.max(0, athlete.jump + athlete.jumpVelocity * STEP);
            if (athlete.jump === 0 && athlete.jumpVelocity < 0) athlete.jumpVelocity = 0;
          }
        }
        if (sim.flight && sim.flight.status === 'flying') {
          sim.flight = stepFlight(sim.flight, STEP);
          sim.trail = trailPoint(sim.trail, sim.flight.shuttle);
        }
      }
      sim.shake = Math.max(0, sim.shake - dt * 16);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const sim = simRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (screenRef.current !== 'play') return;
      const state = matchRef.current;
      if (roleRef.current === 'guest') {
        guestStep(sim, state, dt);
        syncHud(sim);
        render(sim, matchRef.current);
        return;
      }
      if (!pausedRef.current) {
        accumulator += dt;
        while (accumulator >= STEP) {
          accumulator -= STEP;
          sim.clock += STEP * 1000;
          simulate(sim, state);
        }
        sim.shake = Math.max(0, sim.shake - dt * 16);
        advancePhase(sim);
        syncHud(sim);
      }
      if (roleRef.current === 'host' && sim.clock - lastSentAt.current >= SNAPSHOT_MS) {
        lastSentAt.current = sim.clock;
        const snap: NetSnapshot = {
          t: 's',
          clock: sim.clock,
          phase: sim.phase,
          a: athleteSnap(sim.athletes.a),
          b: athleteSnap(sim.athletes.b),
          flight: sim.flight,
          marks: sim.marks.slice(-8),
          impact: sim.impact,
          shake: sim.shake,
          rallyShots: sim.rallyShots,
          lastShot: sim.lastShot,
        };
        sendRef.current(snap, { fast: true });
        if (sim.clock - lastScoreAt.current >= 1000) {
          lastScoreAt.current = sim.clock;
          sendRef.current({ t: 'm', match: matchRef.current, stats: statsRef.current, phase: sim.phase, call: null });
        }
      }
      render(sim, matchRef.current);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [beginServe, finishRally, isCpu, launchServe, nameOf, strike]);

  // keyboard
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element || !element.tagName) return false;
      return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
    };
    const resolve = (code: string): { side: Side; action: keyof Controls | 'hit' } | null => {
      const two = settingsRef.current.mode === 'two';
      for (const [player, map] of Object.entries(KEYS) as Array<[keyof typeof KEYS, (typeof KEYS)['p1']]>) {
        for (const [action, codes] of Object.entries(map) as Array<[keyof Controls | 'hit', string[]]>) {
          if (codes.includes(code)) return { side: two && player === 'p2' ? 'b' : settingsRef.current.mode === 'online' ? mySide() : 'a', action };
        }
      }
      return null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (screenRef.current !== 'play' || isTyping(event.target)) return;
      const win = rootRef.current?.closest('.win');
      if (win && win.classList.contains('is-inactive')) return;
      if (event.code === 'KeyP') {
        event.preventDefault();
        togglePause();
        return;
      }
      const hit = resolve(event.code);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const controls = controlsRef.current[hit.side];
      if (hit.action === 'hit') {
        swing(hit.side);
        startCharge(hit.side);
        return;
      }
      controls[hit.action] = true;
      if (hit.action === 'jump') simRef.current.athletes[hit.side].jumpRequested = true;
      pushControls(hit.action === 'jump');
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const hit = resolve(event.code);
      if (!hit) return;
      if (hit.action === 'hit') {
        const held = endCharge(hit.side);
        // Letting go of a held key swings again, at the power it built up.
        if (held >= CHARGE_MIN_MS) swing(hit.side, undefined, chargePower(held));
        return;
      }
      controlsRef.current[hit.side][hit.action] = false;
      pushControls();
    };
    const onBlur = () => {
      endCharge('a');
      endCharge('b');
      controlsRef.current = { a: newControls(), b: newControls() };
      pushControls();
    };
    const onVisibility = () => {
      if (document.hidden && screenRef.current === 'play' && settingsRef.current.mode !== 'online') setPaused(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [swing, togglePause]);

  useEffect(() => () => audioRef.current?.dispose(), []);

  // Online messages. The host takes the guest's controls; the guest takes the host's court and score.
  useEffect(() => room.onMessage((from, data) => {
    if (roleRef.current === 'host') {
      if (from !== 1) return;
      const message = parseGuestMessage(data);
      if (!message) return;
      const athlete = simRef.current.athletes.b;
      if (message.t === 'in') controlsRef.current.b = { ...message.c };
      else if (message.t === 'jump') athlete.jumpRequested = true;
      else if (message.t === 'seek') athlete.seekX = message.x === null ? null : clampToHalf(message.x, directionOf('b', matchRef.current));
      else if (message.t === 'hit') swing('b', message.intent, message.power);
      else if (message.t === 'go') continueFlow();
      return;
    }
    if (roleRef.current !== 'guest' || from !== 0) return;
    const snap = parseSnapshot(data);
    if (snap) {
      if (snap.clock < lastSnapClock.current) return;
      lastSnapClock.current = snap.clock;
      pendingSnap.current = snap;
      return;
    }
    const score = parseScore(data);
    if (!score) return;
    const before = matchRef.current;
    matchRef.current = score.match;
    statsRef.current = score.stats;
    setMatch(score.match);
    setStats(score.stats);
    setPhase(score.phase);
    if (score.call && score.call.key !== callKey.current) {
      callKey.current = score.call.key;
      setCall(score.call);
    }
    const scored = SIDES.find((side) => score.match.points[side] > before.points[side]);
    if (scored && screenRef.current === 'play') audio().point(scored === 'b');
    if (score.phase === 'match-end' && screenRef.current === 'play') {
      audio().gameOver(score.match.matchWinner === 'b');
      setScreen('summary');
    }
  }), [room.code, room.onMessage, swing, continueFlow]);

  // Host: the score goes out whenever it changes.
  useEffect(() => {
    if (role !== 'host' || (screen !== 'play' && screen !== 'summary')) return;
    room.send({ t: 'm', match, stats, phase, call });
  }, [role, screen, match, stats, phase, call, room.send]);

  // Both screens report the match winner; the Worker records it when they agree.
  const reported = useRef('');
  useEffect(() => {
    if (!role || !match.matchWinner) return;
    const key = `${room.code}:${room.round}`;
    if (reported.current === key) return;
    reported.current = key;
    room.reportResult(match.matchWinner === 'a' ? 0 : 1);
  }, [role, match.matchWinner, room.code, room.round, room.reportResult]);

  // court pointer controls: drag to move, tap to hit, flick up or down for power or soft
  const pointerSide = (clientX: number): Side | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    if (settingsRef.current.mode === 'cpu') return 'a';
    if (settingsRef.current.mode === 'online') return mySide();
    const rect = stage.getBoundingClientRect();
    return sideAt(clientX < rect.left + rect.width / 2 ? 'left' : 'right', matchRef.current);
  };
  const worldX = (clientX: number) => {
    const stage = stageRef.current;
    if (!stage) return 0;
    const rect = stage.getBoundingClientRect();
    const metrics = sceneMetrics(rect.width, rect.height);
    return (clientX - rect.left - metrics.originX) / metrics.scale;
  };
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (screenRef.current !== 'play' || pausedRef.current) return;
    const side = pointerSide(event.clientX);
    if (!side || isCpu(side)) return;
    for (const pointer of pointersRef.current.values()) if (pointer.side === side) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { side, startX: event.clientX, startY: event.clientY, startAt: performance.now(), moved: false });
    startCharge(side);
    audio().unlock();
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    if (!pointer.moved && Math.abs(event.clientX - pointer.startX) > 12) pointer.moved = true;
    if (pointer.moved) {
      const direction = directionOf(pointer.side, matchRef.current);
      const seek = clampToHalf(worldX(event.clientX) - direction * 0.3, direction);
      simRef.current.athletes[pointer.side].seekX = seek;
      if (roleRef.current === 'guest' && (pointer.sentX === undefined || Math.abs(pointer.sentX - seek) > 0.04)) {
        pointer.sentX = seek;
        sendRef.current({ t: 'seek', x: seek });
      }
    }
  };
  const onStagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointersRef.current.delete(event.pointerId);
    simRef.current.athletes[pointer.side].seekX = null;
    const held = endCharge(pointer.side);
    if (roleRef.current === 'guest' && pointer.sentX !== undefined) sendRef.current({ t: 'seek', x: null });
    if (event.type === 'pointercancel') return;
    if (!pointer.moved && held < 1200) {
      const dy = event.clientY - pointer.startY;
      swing(pointer.side, dy < -24 ? 'power' : dy > 24 ? 'soft' : undefined, chargePower(held));
    }
  };

  // touch pads for the single player layout
  const padHold = (key: keyof Controls, down: boolean) => {
    const side = settingsRef.current.mode === 'online' ? mySide() : 'a';
    controlsRef.current[side][key] = down;
    if (key === 'jump' && down) simRef.current.athletes[side].jumpRequested = true;
    pushControls(key === 'jump' && down);
  };
  const padProps = (key: keyof Controls) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      padHold(key, true);
      audio().unlock();
    },
    onPointerUp: () => padHold(key, false),
    onPointerCancel: () => padHold(key, false),
    onLostPointerCapture: () => padHold(key, false),
  });
  const hitPadStart = useRef<{ y: number; at: number } | null>(null);
  const hitPadProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      hitPadStart.current = { y: event.clientY, at: performance.now() };
      startCharge(settingsRef.current.mode === 'online' ? mySide() : 'a');
      audio().unlock();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = hitPadStart.current;
      hitPadStart.current = null;
      if (!start) return;
      const side = settingsRef.current.mode === 'online' ? mySide() : 'a';
      const held = endCharge(side);
      const dy = event.clientY - start.y;
      swing(side, dy < -18 ? 'power' : dy > 18 ? 'soft' : undefined, chargePower(held));
    },
    onPointerCancel: () => {
      hitPadStart.current = null;
      endCharge(settingsRef.current.mode === 'online' ? mySide() : 'a');
    },
  };

  const left = sideAt('left', match);
  const right = sideAt('right', match);
  const situation = pointSituation(match);
  const situationLabel = situation.length
    ? situation.some((entry) => entry.kind === 'match') && settings.length !== 'quick'
      ? 'Match Point'
      : settings.length === 'quick'
        ? 'Game Point'
        : situation[0].kind === 'match'
          ? 'Match Point'
          : 'Game Point'
    : null;
  const bestOfThree = match.bestOf === 3;

  const statusTitle = (() => {
    if (phase === 'serve') {
      if (settings.mode === 'cpu') return match.server === 'a' ? 'Your Serve' : 'Computer Serves';
      if (settings.mode === 'online' && nameOf(match.server) === 'You') return 'Your Serve';
      return `${nameOf(match.server)} Serves`;
    }
    if (phase === 'rally' || phase === 'point') return hud.rally > 0 ? `Rally ${hud.rally}` : 'Rally';
    if (phase === 'interval') return 'Interval';
    if (phase === 'game-end') return `Game ${match.game}`;
    return '';
  })();
  const statusDetail = (() => {
    if (phase === 'serve') return `${serviceCourt(match) === 'right' ? 'Right' : 'Left'} service court`;
    if (phase === 'rally' || phase === 'point') return hud.shot;
    return '';
  })();

  const helpLine = (() => {
    if (touch) {
      if (settings.mode === 'two') return 'Each player drags on their half to move. Tap to hit, flick up to smash, flick down for a drop. Hold first for a full smash.';
      return 'Flick up on Hit to smash, flick down for a drop. Hold Hit first for a full smash. You can also drag on the court to move.';
    }
    if (settings.mode === 'two') return 'Player 1: A and D move, W jumps, S softens, Space hits. Player 2: Arrow Keys move and jump, Down softens, Enter hits. Hold the hit key and let go for a full smash.';
    return 'A and D move, W jumps, Space hits. Hold S for a drop. Jump and hit for a smash, or hold Space and let go for a full smash.';
  })();

  const winner = match.matchWinner;
  const online = settings.mode === 'online';
  const winnerTitle = winner ? (settings.mode === 'cpu' ? (winner === 'a' ? 'You Win' : 'Computer Wins') : nameOf(winner) === 'You' ? 'You Win' : `${nameOf(winner)} Wins`) : '';
  const margin = stats.a.points - stats.b.points;
  const rankBoard = settings.mode === 'cpu' && winner === 'a' && margin >= 1 ? boardFor(BADMINTON, settings.difficulty) : null;
  const gameScores = match.history.map((game) => `${game[left]} to ${game[right]}`).join(', ');

  return (
    <div ref={rootRef} className={`bd gc-dark ${touch ? 'is-touch' : ''} ${phone ? 'is-phone' : ''} ${os.fullscreen ? 'is-full' : ''}`}>
      {screen === 'menu' && (
        <div className="bd-menu">
          <div className="bd-sheet">
          <div className="bd-menu-head">
            <h1>Badminton</h1>
            <p>Singles. Rally point scoring.</p>
          </div>
          <div className="bd-field">
            <span className="bd-field-label">Opponent</span>
            <div className="gseg" aria-label="Opponent">
              <button type="button" aria-pressed={settings.mode === 'cpu'} onClick={() => { if (room.linked) leaveOnline(); updateSettings({ mode: 'cpu' }); }}>
                Computer
              </button>
              <button type="button" aria-pressed={settings.mode === 'two'} onClick={() => { if (room.linked) leaveOnline(); updateSettings({ mode: 'two' }); }}>
                Two Players
              </button>
              {onlineAvailable && (
                <button type="button" aria-pressed={settings.mode === 'online'} onClick={() => updateSettings({ mode: 'online' })}>
                  Online
                </button>
              )}
            </div>
          </div>
          <div className={`bd-field ${settings.mode !== 'cpu' ? 'is-dim' : ''}`}>
            <span className="bd-field-label">Difficulty</span>
            <div className="gseg" aria-label="Difficulty">
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={settings.difficulty === level}
                  disabled={settings.mode !== 'cpu'}
                  onClick={() => updateSettings({ difficulty: level })}
                >
                  {DIFFICULTY_LABEL[level]}
                </button>
              ))}
            </div>
          </div>
          <div className="bd-field">
            <span className="bd-field-label">Length</span>
            <div className="gseg" aria-label="Match length">
              {(Object.keys(LENGTH_LABEL) as MatchLength[]).map((length) => (
                <button key={length} type="button" aria-pressed={settings.length === length} onClick={() => updateSettings({ length })}>
                  {LENGTH_LABEL[length]}
                </button>
              ))}
            </div>
          </div>
          {online && (
            <div className="bd-field">
              <RoomPanel room={room} title="Online Match" note="Play a friend anywhere. The host's match length is used." startLabel="Start Match" />
            </div>
          )}
          <div className="bd-menu-actions">
            {!online && (
              <button type="button" className="gbtn gbtn-primary gbtn-lg" onClick={startMatch}>
                Start Match
              </button>
            )}
            <div className="bd-menu-row">
              <button type="button" className="gbtn" onClick={() => setScreen('howto')}>
                How to Play
              </button>
              <button type="button" className="gbtn" onClick={() => updateSettings({ sound: !settings.sound })}>
                {settings.sound ? 'Sound On' : 'Sound Off'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {screen === 'howto' && (
        <div className="bd-howto">
          <div className="bd-sheet">
          <h2>How to Play</h2>
          <div className="bd-howto-grid">
            <section>
              <h3>Shots</h3>
              <p>Where you meet the shuttle decides the shot. High overhead is a clear. Hold Soft for a drop. Jump and hit for a smash. Hold the hit for a full smash: faster and steeper, but harder to aim and slower to recover from. Smashes from the back lose pace on the way. Around shoulder height is a drive. Low near the net is a net shot, low and deep is a lift.</p>
            </section>
            <section>
              <h3>Controls</h3>
              {touch ? (
                <p>Drag on the court or use the pads to move. Tap Hit to play the shuttle, flick up on Hit to smash, flick down for a drop. Hold Hit before you flick for a full smash. With two players, each one drags and taps on their own half.</p>
              ) : (
                <p>A and D move, W jumps, Space hits, S makes the shot soft. Hold Space and let go for a full smash. The mouse works too: drag on the court to move, click to hit, flick up for power or down for a drop. Player 2 uses the Arrow Keys and Enter. Press P to pause.</p>
              )}
            </section>
            <section>
              <h3>Scoring</h3>
              <p>Every rally scores a point. A game goes to 21 and must be won by two, with 30 as the cap. Serve from the right court on an even score and from the left on odd. Players change ends after each game and at 11 in a deciding game.</p>
            </section>
          </div>
          <div className="bd-howto-actions">
            <button type="button" className="gbtn" onClick={() => setScreen('menu')}>
              Back
            </button>
            {!online && (
              <button type="button" className="gbtn gbtn-primary" onClick={startMatch}>
                Start Match
              </button>
            )}
          </div>
          </div>
        </div>
      )}

      {screen === 'play' && (
        <>
          <header className="bd-score">
            <div className={`bd-team ${match.server === left && phase === 'serve' ? 'is-serving' : ''}`}>
              <span className="bd-team-name">
                <i className="bd-serve-dot" aria-hidden="true" />
                {nameOf(left)}
              </span>
              <span className="bd-team-points">{match.points[left]}</span>
              {bestOfThree && <span className="bd-team-games">{match.games[left]} {match.games[left] === 1 ? 'game' : 'games'}</span>}
            </div>
            <div className="bd-status">
              {situationLabel && (phase === 'serve' || phase === 'point') && <span className="bd-pill">{situationLabel}</span>}
              <span className="bd-status-title">{statusTitle}</span>
              {statusDetail && <span className="bd-status-detail">{statusDetail}</span>}
            </div>
            <div className={`bd-team is-right ${match.server === right && phase === 'serve' ? 'is-serving' : ''}`}>
              <span className="bd-team-name">
                {nameOf(right)}
                <i className="bd-serve-dot" aria-hidden="true" />
              </span>
              <span className="bd-team-points">{match.points[right]}</span>
              {bestOfThree && <span className="bd-team-games">{match.games[right]} {match.games[right] === 1 ? 'game' : 'games'}</span>}
            </div>
          </header>

          <div
            ref={stageRef}
            className="bd-stage"
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerEnd}
            onPointerCancel={onStagePointerEnd}
          >
            <canvas ref={canvasRef} className="bd-canvas" aria-label="Badminton court" />
            {call && phase === 'point' && (
              <div key={call.key} className="bd-call" aria-live="polite">
                <strong>{call.title}</strong>
                <span>{call.detail}</span>
              </div>
            )}
            {phase === 'serve' && settings.mode === 'two' && touch && (
              <div className="bd-zones" aria-hidden="true">
                <span>{nameOf(left)}</span>
                <span>{nameOf(right)}</span>
              </div>
            )}
            {(phase === 'interval' || phase === 'game-end') && !paused && (
              <div className="bd-overlay">
                <div className="bd-card">
                  <h2>{phase === 'interval' ? 'Interval' : `Game ${match.game} to ${nameOf(match.gameWinner ?? 'a')}`}</h2>
                  <p>
                    {phase === 'interval'
                      ? `${match.points[left]} to ${match.points[right]}.${match.game === 3 ? ' Change ends.' : ''}`
                      : `${match.points[left]} to ${match.points[right]}. Games ${match.games[left]} to ${match.games[right]}. Change ends.`}
                  </p>
                  <button type="button" className="gbtn gbtn-primary" onClick={continueFlow}>
                    Continue
                  </button>
                </div>
              </div>
            )}
            {paused && (
              <div className="bd-overlay">
                <div className="bd-card">
                  <h2>Paused</h2>
                  <p>{nameOf(left)} {match.points[left]}, {nameOf(right)} {match.points[right]}</p>
                  <div className="bd-card-actions">
                    <button type="button" className="gbtn gbtn-primary" onClick={() => setPaused(false)}>
                      Resume
                    </button>
                    <button type="button" className="gbtn" onClick={startMatch}>
                      Restart
                    </button>
                    <button type="button" className="gbtn" onClick={() => updateSettings({ sound: !settings.sound })}>
                      {settings.sound ? 'Sound On' : 'Sound Off'}
                    </button>
                    <button type="button" className="gbtn" onClick={quitToMenu}>
                      Quit
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {touch && settings.mode !== 'two' ? (
            <div className="bd-pads">
              <div className="bd-pad-group">
                <button type="button" className="gpad bd-pad" {...padProps('left')}>
                  Left
                </button>
                <button type="button" className="gpad bd-pad" {...padProps('right')}>
                  Right
                </button>
              </div>
              {online ? (
                <button type="button" className="gbtn gbtn-sm bd-pause" onClick={leaveOnline}>
                  Leave
                </button>
              ) : (
                <button type="button" className="gbtn gbtn-sm bd-pause" onClick={togglePause} aria-label="Pause">
                  Pause
                </button>
              )}
              <div className="bd-pad-group">
                <button type="button" className="gpad bd-pad" {...padProps('jump')}>
                  Jump
                </button>
                <button type="button" className="gpad bd-pad bd-pad-hit" {...hitPadProps}>
                  Hit
                </button>
              </div>
            </div>
          ) : (
            <footer className="bd-bar">
              <p className="bd-help">{helpLine}</p>
              {online ? (
                <button type="button" className="gbtn gbtn-sm" onClick={leaveOnline}>
                  Leave
                </button>
              ) : (
                <button type="button" className="gbtn gbtn-sm" onClick={togglePause}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
              )}
            </footer>
          )}
        </>
      )}

      {screen === 'summary' && winner && (
        <div className="bd-summary">
          <div className="bd-sheet">
          <div className="bd-summary-head">
            <h2>{winnerTitle}</h2>
            <p>
              {bestOfThree ? `${match.games[left]} to ${match.games[right]} in games. ` : ''}
              {gameScores}
            </p>
          </div>
          <table className="bd-stats">
            <thead>
              <tr>
                <th />
                <th>{nameOf(left)}</th>
                <th>{nameOf(right)}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Points</th>
                <td>{stats[left].points}</td>
                <td>{stats[right].points}</td>
              </tr>
              <tr>
                <th>Winners</th>
                <td>{stats[left].winners}</td>
                <td>{stats[right].winners}</td>
              </tr>
              <tr>
                <th>Errors</th>
                <td>{stats[left].errors}</td>
                <td>{stats[right].errors}</td>
              </tr>
              <tr>
                <th>Smashes</th>
                <td>{stats[left].smashes}</td>
                <td>{stats[right].smashes}</td>
              </tr>
              <tr>
                <th>Fastest Smash</th>
                <td>{stats[left].fastestSmash ? `${kmh(stats[left].fastestSmash)} km/h` : 'None'}</td>
                <td>{stats[right].fastestSmash ? `${kmh(stats[right].fastestSmash)} km/h` : 'None'}</td>
              </tr>
            </tbody>
          </table>
          <p className="bd-summary-note">
            Longest rally {stats.longestRally} shots over {stats.rallies} {stats.rallies === 1 ? 'rally' : 'rallies'}.
          </p>
          {rankBoard && <AppBoard key={`${rankBoard.id}:${matchNo}`} board={rankBoard} score={margin} round={matchNo} />}
          {online ? (
            <div className="bd-summary-actions">
              {room.isHost && room.linked ? (
                <button type="button" className="gbtn gbtn-primary" onClick={room.start}>
                  Play Again
                </button>
              ) : (
                <span className="bd-help">{room.linked ? 'Waiting for the host' : 'The room has closed'}</span>
              )}
              <button type="button" className="gbtn" onClick={leaveOnline}>
                Leave
              </button>
            </div>
          ) : (
            <div className="bd-summary-actions">
              <button type="button" className="gbtn gbtn-primary" onClick={startMatch}>
                Play Again
              </button>
              <button type="button" className="gbtn" onClick={quitToMenu}>
                Menu
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
