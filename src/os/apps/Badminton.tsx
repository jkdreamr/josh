import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  awardPoint,
  chooseShot,
  contactAccuracy,
  cpuChooseShot,
  CPU_PROFILES,
  COURT_HALF_LENGTH,
  createFlight,
  directionOf,
  endOf,
  faultLabel,
  newMatch,
  newStats,
  opposite,
  planShot,
  pointSituation,
  recordRally,
  recordSmash,
  serviceCourt,
  shotLabel,
  sideAt,
  simulateLanding,
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
  type RallyCause,
  type RallyOutcome,
  type ShotType,
  type Side,
} from '../games/badminton';
import { useOS, type AppProps } from '../types';
import { BadmintonAudio } from './badminton-audio';
import { drawScene, sceneMetrics, type AthleteView, type Impact, type LandingMark } from './badminton-draw';
import './game-controls.css';
import './Badminton.css';

type Mode = 'cpu' | 'two';
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
};
type Announcement = { key: number; title: string; detail: string };
type Hud = { rally: number; shot: string };
type Pointer = { side: Side; startX: number; startY: number; startAt: number; moved: boolean };
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
  lastShot: { type: ShotType; speed: number } | null;
  cpuReactAt: number;
  cpuServeAt: number;
  cpuHome: number;
  cpuTarget: number | null;
  cpuPredictAt: number;
};

const SIDES: Side[] = ['a', 'b'];
const STEP = 1 / 240;
const REACH = 0.95;
const SWING_MS = 170;
const SWING_DRAW_MS = 230;
const RUN_SPEED = 5.3;
const JUMP_VELOCITY = 5.2;
const GRAVITY = 12.4;
const SETTINGS_KEY = 'jk-badminton';
const DEFAULT_SETTINGS: Settings = { mode: 'cpu', difficulty: 'normal', length: 'game', sound: true };

const KEYS: Record<'p1' | 'p2', Record<keyof Controls | 'hit', string[]>> = {
  p1: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW'], soft: ['KeyS'], hit: ['Space', 'KeyJ'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], soft: ['ArrowDown'], hit: ['Enter', 'Slash'] },
};

const LENGTH_LABEL: Record<MatchLength, string> = { quick: 'Quick to 11', game: 'Game to 21', match: 'Best of Three' };
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

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
  return { side, x: 0, vx: 0, jump: 0, jumpVelocity: 0, jumpRequested: false, swingStart: -1e9, swingUntil: 0, intent: 'normal', seekX: null };
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
    cpuReactAt: 0,
    cpuServeAt: 0,
    cpuHome: 3.2,
    cpuTarget: null,
    cpuPredictAt: 0,
  };
}

function newControls(): Controls {
  return { left: false, right: false, jump: false, soft: false };
}

function clampToHalf(x: number, direction: 1 | -1) {
  return direction > 0 ? Math.max(-COURT_HALF_LENGTH - 0.3, Math.min(-0.55, x)) : Math.max(0.55, Math.min(COURT_HALF_LENGTH + 0.3, x));
}

function kmh(speed: number) {
  return Math.round(speed * 3.6);
}

export default function Badminton(_props: AppProps) {
  const os = useOS();
  const touch = os.mobile;
  const phone = os.mobile && !os.tablet;

  const [settings, setSettings] = useState<Settings>(loadSettings);
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
  const nameOf = useCallback((side: Side, long = true) => {
    if (settingsRef.current.mode === 'cpu') return side === 'a' ? 'You' : long ? 'Computer' : 'CPU';
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
    }
    sim.cpuHome = 3.1;
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
      const who = nameOf(outcome.winner);
      if (outcome.cause === 'in') {
        announce(`Point to ${who}`, outcome.shots >= 6 ? `Rally of ${outcome.shots} shots` : `${next.points.a} to ${next.points.b}`);
      } else {
        announce(faultLabel(outcome.cause), `Point to ${who}`);
      }
      const humanWon = settingsRef.current.mode === 'two' || outcome.winner === 'a';
      audio().point(humanWon);
    },
    [nameOf],
  );

  const strike = useCallback(
    (side: Side, intent: Intent, contact: Point2D, accuracy: number) => {
      const sim = simRef.current;
      const state = matchRef.current;
      const direction = directionOf(side, state);
      const opponent = sim.athletes[opposite(side)];
      const type = isCpu(side)
        ? cpuChooseShot(contact, Math.abs(opponent.x), CPU_PROFILES[settingsRef.current.difficulty])
        : chooseShot(intent, contact);
      const plan = planShot(type, direction, contact, Math.random, accuracy);
      const heading = sim.flight ? sim.flight.heading : 0;
      sim.flight = createFlight(contact, plan.velocity, side, direction, false, heading);
      sim.trail = [];
      sim.rallyShots += 1;
      const speed = Math.hypot(plan.velocity.vx, plan.velocity.vy);
      sim.lastShot = { type: plan.type, speed };
      const strong = plan.type === 'smash';
      sim.impact = { x: contact.x, y: contact.y, at: sim.clock, strong };
      if (strong) {
        sim.shake = Math.min(6, 2 + speed / 14);
        sim.freezeUntil = sim.clock + 45;
        statsRef.current = recordSmash(statsRef.current, side, speed);
      } else if (plan.type === 'drive') {
        sim.shake = 1.2;
      }
      if (isCpu(opposite(side))) sim.cpuReactAt = sim.clock + CPU_PROFILES[settingsRef.current.difficulty].reactionMs;
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
      sim.impact = { x: start.x, y: start.y, at: sim.clock, strong: false };
      if (isCpu(opposite(side))) sim.cpuReactAt = sim.clock + CPU_PROFILES[settingsRef.current.difficulty].reactionMs;
      setPhase('rally');
      audio().hit(plan.type, sim.lastShot.speed);
    },
    [finishRally, isCpu],
  );

  const continueFlow = useCallback(() => {
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
    (side: Side, explicit?: Intent) => {
      if (screenRef.current !== 'play' || pausedRef.current) return;
      const sim = simRef.current;
      const athlete = sim.athletes[side];
      const controls = controlsRef.current[side];
      const intent: Intent = explicit ?? (controls.soft ? 'soft' : controls.jump || athlete.jump > 0.05 ? 'power' : 'normal');
      if (sim.phase === 'serve') {
        if (matchRef.current.server === side) launchServe(side, intent);
        return;
      }
      if (sim.phase === 'rally') {
        if (sim.clock < athlete.swingStart + 110) return;
        athlete.swingStart = sim.clock;
        athlete.swingUntil = sim.clock + SWING_MS;
        athlete.intent = intent;
        return;
      }
      if (sim.phase === 'interval' || sim.phase === 'game-end') continueFlow();
    },
    [continueFlow, launchServe],
  );

  const startMatch = useCallback(() => {
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

  const togglePause = useCallback(() => {
    if (screenRef.current !== 'play') return;
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
      const targetVx = move * RUN_SPEED;
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
      const cpu = sim.athletes.b;
      const direction = directionOf('b', state);
      const profile = CPU_PROFILES[settingsRef.current.difficulty];
      const flight = sim.flight;
      let target: number | null = null;
      if (sim.phase === 'rally' && flight && flight.status === 'flying') {
        if (flight.hitter !== 'b') {
          if (sim.clock >= sim.cpuReactAt) {
            if (sim.cpuTarget === null || sim.clock >= sim.cpuPredictAt) {
              const prediction = simulateLanding({ x: flight.shuttle.x, y: flight.shuttle.y }, { vx: flight.shuttle.vx, vy: flight.shuttle.vy });
              sim.cpuTarget = clampToHalf(prediction.x - direction * 0.4, direction);
              sim.cpuPredictAt = sim.clock + 120;
            }
            target = sim.cpuTarget;
            const racketX = cpu.x + direction * 0.5;
            if (
              flight.shuttle.y > 2.25 &&
              flight.shuttle.vy < 1.5 &&
              Math.abs(flight.shuttle.x - racketX) < 1.4 &&
              cpu.jump <= 0.001 &&
              cpu.jumpVelocity <= 0
            ) {
              cpu.jumpRequested = true;
            }
          }
        } else {
          sim.cpuTarget = null;
          target = -direction * sim.cpuHome;
        }
      }
      if (target === null) {
        cpu.vx *= 0.8;
        if (Math.abs(cpu.vx) < 0.05) cpu.vx = 0;
      } else {
        const gap = target - cpu.x;
        const desired = Math.abs(gap) > 0.08 ? Math.sign(gap) * Math.min(profile.speed, Math.abs(gap) * 7) : 0;
        cpu.vx += Math.max(-28 * STEP, Math.min(28 * STEP, desired - cpu.vx));
      }
      cpu.x = clampToHalf(cpu.x + cpu.vx * STEP, direction);
      if (cpu.jumpRequested) {
        cpu.jumpRequested = false;
        cpu.jumpVelocity = JUMP_VELOCITY * 0.92;
      }
      if (cpu.jumpVelocity !== 0 || cpu.jump > 0) {
        cpu.jumpVelocity -= GRAVITY * STEP;
        cpu.jump = Math.max(0, cpu.jump + cpu.jumpVelocity * STEP);
        if (cpu.jump === 0 && cpu.jumpVelocity < 0) cpu.jumpVelocity = 0;
      }
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
      if (isCpu(side)) {
        if (sim.clock < sim.cpuReactAt) return;
        athlete.swingStart = sim.clock - 70;
        athlete.intent = shuttle.y >= 1.6 ? 'normal' : 'soft';
        strike(side, 'normal', { x: shuttle.x, y: shuttle.y }, CPU_PROFILES[settingsRef.current.difficulty].accuracy);
        return;
      }
      if (sim.clock > athlete.swingUntil) return;
      athlete.swingUntil = 0;
      strike(side, athlete.intent, { x: shuttle.x, y: shuttle.y }, contactAccuracy(distance, REACH));
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
      const humanWon = settingsRef.current.mode === 'two' || (state.gameWinner ?? state.matchWinner) === 'a';
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
            ? `${shotLabel(sim.lastShot.type)} ${kmh(sim.lastShot.speed)} km/h`
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

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const sim = simRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (screenRef.current !== 'play') return;
      const state = matchRef.current;
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
          if (codes.includes(code)) return { side: two && player === 'p2' ? 'b' : 'a', action };
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
        return;
      }
      controls[hit.action] = true;
      if (hit.action === 'jump') simRef.current.athletes[hit.side].jumpRequested = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const hit = resolve(event.code);
      if (!hit || hit.action === 'hit') return;
      controlsRef.current[hit.side][hit.action] = false;
    };
    const onBlur = () => {
      controlsRef.current = { a: newControls(), b: newControls() };
    };
    const onVisibility = () => {
      if (document.hidden && screenRef.current === 'play') setPaused(true);
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

  // court pointer controls: drag to move, tap to hit, flick up or down for power or soft
  const pointerSide = (clientX: number): Side | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    if (settingsRef.current.mode === 'cpu') return 'a';
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
    audio().unlock();
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    if (!pointer.moved && Math.abs(event.clientX - pointer.startX) > 12) pointer.moved = true;
    if (pointer.moved) {
      const direction = directionOf(pointer.side, matchRef.current);
      simRef.current.athletes[pointer.side].seekX = clampToHalf(worldX(event.clientX) - direction * 0.3, direction);
    }
  };
  const onStagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointersRef.current.delete(event.pointerId);
    simRef.current.athletes[pointer.side].seekX = null;
    if (event.type === 'pointercancel') return;
    if (!pointer.moved && performance.now() - pointer.startAt < 400) {
      const dy = event.clientY - pointer.startY;
      swing(pointer.side, dy < -24 ? 'power' : dy > 24 ? 'soft' : undefined);
    }
  };

  // touch pads for the single player layout
  const padHold = (side: Side, key: keyof Controls, down: boolean) => {
    controlsRef.current[side][key] = down;
    if (key === 'jump' && down) simRef.current.athletes[side].jumpRequested = true;
  };
  const padProps = (key: keyof Controls) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      padHold('a', key, true);
      audio().unlock();
    },
    onPointerUp: () => padHold('a', key, false),
    onPointerCancel: () => padHold('a', key, false),
    onLostPointerCapture: () => padHold('a', key, false),
  });
  const hitPadStart = useRef<{ y: number; at: number } | null>(null);
  const hitPadProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      hitPadStart.current = { y: event.clientY, at: performance.now() };
      audio().unlock();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = hitPadStart.current;
      hitPadStart.current = null;
      if (!start) return;
      const dy = event.clientY - start.y;
      swing('a', dy < -18 ? 'power' : dy > 18 ? 'soft' : undefined);
    },
    onPointerCancel: () => {
      hitPadStart.current = null;
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
      if (settings.mode === 'two') return 'Each player drags on their half to move. Tap to hit, flick up to smash, flick down for a drop.';
      return 'Flick up on Hit to smash, flick down for a drop. You can also drag on the court to move.';
    }
    if (settings.mode === 'two') return 'Player 1: A and D move, W jumps, S softens, Space hits. Player 2: Arrow Keys move and jump, Down softens, Enter hits.';
    return 'A and D move, W jumps, Space hits. Hold S for a drop. Jump and hit for a smash. Click or drag on the court works too.';
  })();

  const winner = match.matchWinner;
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
            <div className="gseg" role="radiogroup" aria-label="Opponent">
              <button type="button" role="radio" aria-checked={settings.mode === 'cpu'} className={settings.mode === 'cpu' ? 'is-on' : ''} onClick={() => updateSettings({ mode: 'cpu' })}>
                Computer
              </button>
              <button type="button" role="radio" aria-checked={settings.mode === 'two'} className={settings.mode === 'two' ? 'is-on' : ''} onClick={() => updateSettings({ mode: 'two' })}>
                Two Players
              </button>
            </div>
          </div>
          <div className={`bd-field ${settings.mode === 'two' ? 'is-dim' : ''}`}>
            <span className="bd-field-label">Difficulty</span>
            <div className="gseg" role="radiogroup" aria-label="Difficulty">
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={settings.difficulty === level}
                  className={settings.difficulty === level ? 'is-on' : ''}
                  disabled={settings.mode === 'two'}
                  onClick={() => updateSettings({ difficulty: level })}
                >
                  {DIFFICULTY_LABEL[level]}
                </button>
              ))}
            </div>
          </div>
          <div className="bd-field">
            <span className="bd-field-label">Length</span>
            <div className="gseg" role="radiogroup" aria-label="Match length">
              {(Object.keys(LENGTH_LABEL) as MatchLength[]).map((length) => (
                <button key={length} type="button" role="radio" aria-checked={settings.length === length} className={settings.length === length ? 'is-on' : ''} onClick={() => updateSettings({ length })}>
                  {LENGTH_LABEL[length]}
                </button>
              ))}
            </div>
          </div>
          <div className="bd-menu-actions">
            <button type="button" className="gbtn gbtn-primary gbtn-lg" onClick={startMatch}>
              Start Match
            </button>
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
              <p>Where you meet the shuttle decides the shot. High overhead is a clear. Hold Soft for a drop. Jump and hit for a smash. Around shoulder height is a drive. Low near the net is a net shot, low and deep is a lift.</p>
            </section>
            <section>
              <h3>Controls</h3>
              {touch ? (
                <p>Drag on the court or use the pads to move. Tap Hit to play the shuttle, flick up on Hit to smash, flick down for a drop. With two players, each one drags and taps on their own half.</p>
              ) : (
                <p>A and D move, W jumps, Space hits, S makes the shot soft. The mouse works too: drag on the court to move, click to hit, flick up for power or down for a drop. Player 2 uses the Arrow Keys and Enter. Press P to pause.</p>
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
            <button type="button" className="gbtn gbtn-primary" onClick={startMatch}>
              Start Match
            </button>
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

          {touch && settings.mode === 'cpu' ? (
            <div className="bd-pads">
              <div className="bd-pad-group">
                <button type="button" className="gpad bd-pad" {...padProps('left')}>
                  Left
                </button>
                <button type="button" className="gpad bd-pad" {...padProps('right')}>
                  Right
                </button>
              </div>
              <button type="button" className="gbtn gbtn-sm bd-pause" onClick={togglePause} aria-label="Pause">
                Pause
              </button>
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
              <button type="button" className="gbtn gbtn-sm" onClick={togglePause}>
                {paused ? 'Resume' : 'Pause'}
              </button>
            </footer>
          )}
        </>
      )}

      {screen === 'summary' && winner && (
        <div className="bd-summary">
          <div className="bd-sheet">
          <div className="bd-summary-head">
            <h2>{settings.mode === 'cpu' ? (winner === 'a' ? 'You Win' : 'Computer Wins') : `${nameOf(winner)} Wins`}</h2>
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
          <div className="bd-summary-actions">
            <button type="button" className="gbtn gbtn-primary" onClick={startMatch}>
              Play Again
            </button>
            <button type="button" className="gbtn" onClick={quitToMenu}>
              Menu
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
