import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { GameShell, Segmented, defineSetting, every, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type View } from './scene';
import { cycleAt, gripAt, openRuns, pointAt, timed, traffic, type Past, type Track } from './track';
import { bearingDown } from './traffic';
import {
  BANK,
  CASH_COST,
  CCS,
  COUNTDOWN,
  FALL_CARRY,
  FALL_SINK,
  HAMMER,
  ITEMS,
  gustWarn,
  hazState,
  boulderAt,
  beatAt,
  swellWarn,
  CATCH_WIN,
  POWER_TEN,
  STROKE_T,
  TIDE_LAP,
  hazardV,
  fmtTime,
  isCc,
  lapOf,
  ordinal,
  pressGas,
  RIVALS,
  soloRace,
  standings,
  step,
  trailable,
  turboLevel,
  type Cc,
  type Ev,
  type Item,
  type Kart,
  type Race,
} from './logic';
import { configOf, finishOrder, parsePacket } from './net';
import { advance, flushEvents, newNet, onHostClock, onlineRace, outgoing, Pacer, racersOf, receive, SEND_MS, tick, TIME_LIMIT, type Net } from './netsync';
import { deposit, freshGarage, loadGarage, lookFor, lookOf, payout, saveGarage, subscribeGarage } from './garage';
import { CoinIcon, GarageSheet, HowToPlay, ItemIcon, paintFill } from './hud';
import { BPM, JINGLE_DONE, JINGLE_WIN, Sequencer, hz, type Note } from './music';
import { COURSES, COURSE_IDS, DIFFICULTY, isCourse, trackOf, type CourseId } from './courses';
import { meta } from './meta';
import './palmdrive.css';

const CLASS = defineSetting('palmdrive:cc', CCS, '100cc');
const classOptions = CCS.map((cc) => [cc, cc] as const);
const COURSE = defineSetting('palmdrive:course', COURSE_IDS, 'palm');
/** The leaderboard (and local best) for a course and class (a course rebuilt since has a board of its own). */
const boardOf = (course: CourseId, cc: Cc) => `${COURSES[course].board ?? course}-${cc}`;
/** The race soundtrack; the shell's mute button silences it along with everything else. */
const MUSIC = defineSetting('palmdrive:music', ['on', 'off'] as const, 'on', { live: true });
const musicOptions = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;
/** Online bots are the CPU drivers from solo races, quickest first. */
const BOT_NAMES = RIVALS.map((rival) => rival.name);
/** The host gives everyone a moment to get its first packet before the lights start. */
const HOST_LEAD = 1.2;

// Palm Drive used to keep a best distance under its own id, then three-lap race times per class. Races are five
// laps now and timed on new boards; the old numbers would read as impossible bests on the Start card.
try {
  if (typeof window !== 'undefined' && window.localStorage.getItem('arcade:palmdrive-scoring') !== 'race5') {
    for (const id of ['palmdrive', 'palmdrive-50cc', 'palmdrive-100cc', 'palmdrive-150cc']) window.localStorage.removeItem(`arcade:best:${id}`);
    window.localStorage.setItem('arcade:palmdrive-scoring', 'race5');
  }
} catch {
  /* storage blocked */
}

const fmtMs = (ms: number) => fmtTime(ms / 1000);

/** Tips pop up during your first few races. */
const HINT_RACES = 3;
const RACES_KEY = 'arcade:palmdrive-races';
function racesRun() {
  try {
    return Number(window.localStorage.getItem(RACES_KEY)) || 0;
  } catch {
    return 0;
  }
}
function countRace() {
  try {
    window.localStorage.setItem(RACES_KEY, String(racesRun() + 1));
  } catch {
    /* storage blocked: the tips just keep showing */
  }
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={fmtMs} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={BOT_NAMES}>
      <Stage />
    </GameShell>
  );
}

type Best = ReturnType<typeof useHighScore>;
/** Your best time on every course at every class (the same hooks in the same order every render). */
function useBests() {
  const bests = {} as Record<CourseId, Record<Cc, Best>>;
  for (const course of COURSE_IDS) {
    bests[course] = {} as Record<Cc, Best>;
    for (const cc of CCS) bests[course][cc] = useHighScore(`palmdrive-${boardOf(course, cc)}`, { lowerIsBetter: true });
  }
  return bests;
}

/** Course cards with a little map of each track; without onChange it just shows the pick (a guest online). */
function CoursePicker({ value, onChange }: { value: CourseId | null; onChange?: (c: CourseId) => void }) {
  return (
    <div className="arcade-field">
      <span>Course{onChange ? '' : ' · picked by the host'}</span>
      <div className="g-palmdrive-courses" role="group" aria-label="Course">
        {COURSE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`g-palmdrive-course${id === value ? ' is-on' : ''}`}
            aria-pressed={id === value}
            disabled={!onChange}
            title={COURSES[id].blurb}
            onClick={() => {
              if (!onChange || id === value) return;
              sfx.play('select');
              onChange(id);
            }}
          >
            <CourseMap id={id} />
            <span>
              {COURSES[id].name}
              <small className={`is-${DIFFICULTY[COURSES[id].difficulty - 1].toLowerCase()}`}>
                {/* (two pieces, so on a narrow card the length wraps under the class rather than being cut off) */}
                <span>{DIFFICULTY[COURSES[id].difficulty - 1]}</span> <span>· {(trackOf(id).length / 1000).toFixed(1)} km</span>
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CourseMap({ id }: { id: CourseId }) {
  const m = useMemo(() => mapPath(trackOf(id)), [id]);
  return (
    <svg viewBox={m.box} aria-hidden="true">
      <path d={m.d} />
    </svg>
  );
}

function Setup() {
  const [cc, setCc] = useSetting(CLASS);
  const [course, setCourse] = useSetting(COURSE);
  const [music, setMusic] = useSetting(MUSIC);
  const best = useBests()[course][cc].best;
  return (
    <>
      <CoursePicker value={course} onChange={setCourse} />
      <Segmented label="Class" value={cc} options={classOptions} onChange={setCc} />
      <Segmented label="Music" value={music} options={musicOptions} onChange={setMusic} />
      <Extras />
      {best !== null && (
        <small className="g-palmdrive-best">
          Best on {COURSES[course].name} at {cc}: {fmtMs(best)}
        </small>
      )}
    </>
  );
}

const SERVER_GARAGE = freshGarage();
/** The saved garage (bank, paint, hats, wheels, boost trails), shared by the cards and the race. */
const useGarage = () => useSyncExternalStore(subscribeGarage, loadGarage, () => SERVER_GARAGE);

/** How to Play and the Garage, and the sheets they open over the cards. */
function Extras() {
  const shell = useShell();
  const garage = useGarage();
  const [open, setOpen] = useState<'help' | 'garage' | null>(null);
  const close = () => {
    setOpen(null);
    shell.root.current?.focus({ preventScroll: true });
  };
  return (
    <div className="g-palmdrive-extras">
      <button type="button" className="arcade-btn" onClick={() => setOpen('help')}>
        How to Play
      </button>
      <button type="button" className="arcade-btn" onClick={() => setOpen('garage')} aria-label={`Garage, ${garage.bank} coins to spend`}>
        <i className="g-palmdrive-paintdot" style={{ background: paintFill(garage.paint) }} />
        Garage
        <span className="g-palmdrive-bankpill">
          <CoinIcon size={13} />
          {garage.bank}
        </span>
      </button>
      {open === 'help' && <HowToPlay root={shell.root.current} touch={shell.touch} onClose={close} />}
      {open === 'garage' && <GarageSheet root={shell.root.current} garage={garage} onChange={saveGarage} onClose={close} />}
    </div>
  );
}

/**
 * Settings for online races: the host picks the class for everyone (and tells the room as it changes), guests see
 * that pick. Music is everyone's own call.
 */
function OnlineSetup() {
  const online = useOnline();
  const [cc, setCc] = useSetting(CLASS);
  const [course, setCourse] = useSetting(COURSE);
  const [music, setMusic] = useSetting(MUSIC);
  const [hostCc, setHostCc] = useState<Cc | null>(null);
  const [hostCourse, setHostCourse] = useState<CourseId | null>(null);
  const host = online?.isHost ?? true;
  // the host says its picks now, again when someone joins (the player list changes) and every couple of seconds
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send(configOf(online.round, cc, course));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, cc, course]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from !== 0 || p?.k !== 'cfg') return;
      if (isCc(p.cc)) setHostCc(p.cc);
      if (isCourse(p.course)) setHostCourse(p.course);
    });
  }, [online]);
  return (
    <>
      {host ? <CoursePicker value={course} onChange={setCourse} /> : <CoursePicker value={hostCourse} />}
      {host ? (
        <Segmented label="Class" value={cc} options={classOptions} onChange={setCc} />
      ) : (
        <div className="arcade-field">
          <span>Class</span>
          <div className="g-palmdrive-hostpick">
            <b>{hostCc ?? '…'}</b>
            <small>picked by the host</small>
          </div>
        </div>
      )}
      {host && <small className="g-palmdrive-best">You pick the course and class for everyone.</small>}
      <Segmented label="Music" value={music} options={musicOptions} onChange={setMusic} />
      <Extras />
    </>
  );
}

type Mode = 'idle' | 'solo' | 'online';

/**
 * The part of the phone's safe area (the notch, the home bar, rounded corners) that falls inside the game, as CSS
 * variables on the shell (--pd-sat, --pd-sar, --pd-sab, --pd-sal): the screen's insets less however far the game
 * already sits from that edge, so a window that starts under the status bar adds nothing up top, and a phone on its side
 * keeps the buttons clear of the notch.
 */
function useSafeArea(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    let raf = 0;
    const apply = () => {
      raf = 0;
      const cs = getComputedStyle(probe);
      const r = el.getBoundingClientRect();
      const set = (name: string, inset: string, gap: number) => el.style.setProperty(name, `${Math.max(0, Math.round((parseFloat(inset) || 0) - Math.max(0, gap)))}px`);
      set('--pd-sat', cs.paddingTop, r.top);
      set('--pd-sar', cs.paddingRight, window.innerWidth - r.right);
      set('--pd-sab', cs.paddingBottom, window.innerHeight - r.bottom);
      set('--pd-sal', cs.paddingLeft, r.left);
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    const ro = new ResizeObserver(later);
    ro.observe(el);
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    // (a window that opens with an animation only settles where it is after it)
    const timers = [450, 1200].map((ms) => window.setTimeout(later, ms));
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', later);
      window.removeEventListener('orientationchange', later);
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf);
      probe.remove();
    };
  }, [root]);
}

/**
 * On a touch screen while a race is on: no pinch zoom or page drag from a stray thumb, and every lift of a finger
 * wakes the sound (browsers only count a touch as a gesture that may start audio when it ends).
 */
function useTouchGuard(root: RefObject<HTMLElement | null>, playing: boolean) {
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const stop = (e: Event) => {
      if (playingRef.current && e.cancelable) e.preventDefault();
    };
    const wake = () => sfx.unlock();
    el.addEventListener('gesturestart', stop);
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('touchend', wake, { passive: true });
    return () => {
      el.removeEventListener('gesturestart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('touchend', wake);
    };
  }, [root]);
}

/** A fresh race for each solo round and each online round, and an idle grid behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const [course] = useSetting(COURSE);
  useSafeArea(shell.root);
  useTouchGuard(shell.root, shell.status === 'playing');
  const current = useRef<{ key: string; mode: Mode }>({ key: 'idle', mode: 'idle' });
  // the grid behind the Start card is the course you picked
  if (shell.status === 'ready') current.current = { key: `idle:${course}`, mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={current.current.key} mode={current.current.mode} />;
}

/** Plays one note of the soundtrack on the arcade synth, `delay` seconds from now. */
function playNote(note: Note, delay: number, stepLen: number) {
  const dur = note.len * stepLen;
  switch (note.voice) {
    case 'lead':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.9, type: 'sawtooth', vol: 0.035, delay });
      break;
    case 'stab':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.85, type: 'square', vol: 0.018, delay });
      break;
    case 'bass':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.85, type: 'triangle', vol: 0.17, delay });
      sfx.tone({ freq: hz(note.midi + 12), dur: dur * 0.6, type: 'square', vol: 0.02, delay });
      break;
    case 'kick':
      sfx.tone({ freq: 150, to: 42, dur: 0.2, type: 'sine', vol: 0.22, delay });
      break;
    case 'clap':
      sfx.noise(0.09, 0.09, delay);
      break;
    case 'hat':
      sfx.noise(0.025, 0.018, delay);
      break;
    case 'open':
      sfx.noise(0.09, 0.035, delay);
      break;
  }
}

/** A short tune on the synth right away (the finish fanfare). */
function playJingle(notes: Note[]) {
  const stepLen = 60 / BPM / 4;
  for (const note of notes) playNote(note, 0.05 + note.step * stepLen, stepLen);
}

type Hud = {
  place: number;
  field: number;
  lap: number;
  laps: number;
  coins: number;
  /** Enough coins to cash in for a boost. */
  cashReady: boolean;
  item: Item | null;
  /** Ink over your view (0 to 1), a golden mushroom or a fire flower still running, and frozen in ice. */
  ink: number;
  golden: boolean;
  fire: boolean;
  frozen: boolean;
  uses: number;
  rolling: boolean;
  /** The banana or shell is held out behind as a shield. */
  trailing: boolean;
  /** Looking behind. */
  rear: boolean;
  /** Boosting or under a star: speed lines. */
  boosting: boolean;
  /** Finished in the top three: confetti. */
  podium: boolean;
  time: string;
  lights: number;
  banner: string | null;
  /** A line under the lap banner when something joins in on that lap. */
  note: string | null;
  wrong: boolean;
  results: boolean;
  /** Wind across the road just ahead: 0 still, else its way (+ to the right) times 1 about to blow, 2 blowing. */
  gust: number;
  /** On the water, swell rolling in just ahead: the same, its way and whether it is about to (1) or rolling through (2). */
  swell: number;
};
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every((k) => a[k] === b[k]);

function Play({ mode }: { mode: Mode }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = mode === 'online' && !!online;
  const [cc] = useSetting(CLASS);
  const [course] = useSetting(COURSE);
  const [music] = useSetting(MUSIC);
  // your look: on your kart now (changes on the Pause card show at once) and in what you send online
  const garage = useGarage();
  const lookRef = useRef(lookOf(garage));
  const musicRef = useRef(music);
  musicRef.current = music;
  const song = useRef<Sequencer | null>(null);
  song.current ??= new Sequencer(playNote);
  const bests = useBests();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const view = useRef<View | null>(null);
  const race = useRef<Race | null>(null);
  const [raceKey, setRaceKey] = useState(0);
  if (!race.current) {
    if (!live) race.current = soloRace(cc, undefined, lookFor(loadGarage()), course);
    else race.current = onlineRace(online!, cc, course, racersOf(online!), online!.isHost ? COUNTDOWN + HOST_LEAD : 60, lookFor(loadGarage()));
  }
  /** The online race (see netsync), and this player's side of its ending: the result reported, the race over here, the coins banked. */
  const net = useRef<Net & { reported: boolean; over: boolean; banked: boolean }>(null!);
  net.current ??= { ...newNet(live ? online! : null), reported: false, over: false, banked: false };
  /** Online, the race keeps to the wall clock (see Pacer); and when the last frame ran, to tell a page in the background. */
  const pacer = useRef(new Pacer());
  const frameAt = useRef(0);
  const tap = useRef({ back: false, gas: false, cash: false, slam: false });
  /** The item button was holding a banana or shell out behind last frame. */
  const holding = useRef(false);
  const [hud, setHud] = useState<Hud>({ place: 8, field: 8, lap: 1, laps: race.current.laps, coins: 0, cashReady: false, item: null, ink: 0, golden: false, fire: false, frozen: false, uses: 0, rolling: false, trailing: false, rear: false, boosting: false, podium: false, time: '0:00.00', lights: 0, banner: null, note: null, wrong: false, results: false, gust: 0, swell: 0 });
  const [flash, setFlash] = useState<{ id: number; kind: string } | null>(null);
  const [lapNote, setLapNote] = useState<{ id: number; text: string } | null>(null);
  const hudTick = useRef(0);
  const clock = useRef(0);
  const rollTick = useRef(0);
  /** The lap banner ('lap 2/5', 'final lap!'), the course's line about what is new that lap, and when it went up. */
  const lapBanner = useRef<{ text: string; note: string | null; at: number }>({ text: '', note: null, at: -99 });
  const [coinPop, setCoinPop] = useState<{ id: number; text: string; loss: boolean } | null>(null);
  const lastCoins = useRef(0);
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);
  const hints = useRef<{ on: boolean; seen: Set<string>; at: number; counted: boolean } | null>(null);
  hints.current ??= { on: mode !== 'idle' && racesRun() < HINT_RACES, seen: new Set(), at: -99, counted: false };
  /** Shows a tip once per race, during your first few races, one at a time. */
  const showHint = (key: string, desk: string, touch: string) => {
    const h = hints.current!;
    if (!h.on || h.seen.has(key) || clock.current - h.at < 4.5) return;
    h.seen.add(key);
    h.at = clock.current;
    setHint({ id: Date.now(), text: shellRef.current.touch ? touch : desk });
  };
  const doneAt = useRef<number | null>(null);
  const dots = useRef(new Map<number, SVGCircleElement>());
  /** Minimap markers for the buses and golf carts, by hazard index. */
  const busDots = useRef(new Map<number, SVGRectElement>());
  const tags = useRef(new Map<number, HTMLDivElement>());
  const lastLevel = useRef(0);
  /** The crane is hauling your kart back (for the winch's whirr). */
  const winching = useRef(false);
  /** The set pieces' clocks last frame (by hazard index), for the sounds they make as they go off; and the tyres' hiss. */
  const pieceCyc = useRef(new Map<number, number>());
  const pieceTick = useRef(0);
  /** When each car or van last honked at you, by hazard index. */
  const honked = useRef(new Map<number, number>());
  const hissT = useRef(0);
  /** The wind warning last time round (for the whoosh as a gust starts to blow), and the swell's. */
  const gustWas = useRef(0);
  const swellWas = useRef(0);
  /** On the water: the stroke light by the lap counter (it lights up through the catch window) and its pips, the catches in a row. */
  const strokeLight = useRef<HTMLSpanElement | null>(null);
  const strokePips = useRef<(HTMLElement | null)[]>([]);
  /** On a touch screen: the drift button (on the water it glows through the catch window), and the steering pad. */
  const driftBtn = useRef<HTMLButtonElement | null>(null);
  const steerPad = useRef<HTMLDivElement | null>(null);
  const steerHalves = useRef<(HTMLButtonElement | null)[]>([]);
  /** The fingers on the steering pad and the side each is on (the last one down steers), and the side held now. */
  const steerFingers = useRef(new Map<number, -1 | 1>());
  const steerSide = useRef<-1 | 0 | 1>(0);
  const lastBeat = useRef(0);
  /** On the water: when the weir last roared and which eight seconds the foghorn last sounded in. */
  const roarT = useRef(0);
  const fogHorn = useRef(-1);
  const tugAt = useRef(-1);
  /** A short buzz on phones that can. */
  const buzz = (ms: number) => {
    if (!shellRef.current.touch) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not allowed here */
    }
  };

  useEffect(() => {
    const host = ref.current;
    const r = race.current;
    if (!THREE || !host || !r) return;
    const v = buildView(THREE, host, r);
    if (!v) return;
    view.current = v;
    v.resize(sizeRef.current.w, sizeRef.current.h);
    v.frame(r, Math.max(0, r.me), 0, 0);
    v.render();
    shell.invalidate();
    // (the drawing follows the screen as soon as it turns, rather than a frame or two later once React catches up)
    const ro = new ResizeObserver(() => v.resize(host.clientWidth, host.clientHeight));
    ro.observe(host);
    return () => {
      ro.disconnect();
      v.dispose();
      view.current = null;
    };
  }, [THREE, raceKey]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE, raceKey]);

  useEffect(() => {
    lookRef.current = lookOf(garage);
    const r = race.current;
    const me = r?.karts[r.me];
    if (!me) return;
    Object.assign(me, lookFor(garage));
  }, [garage, raceKey]);

  // ---------------------------------------------------------------------------------------------------------------
  // Online: state at 15 Hz, item events as they happen, the result from the host.

  /** Ends this player's online race: reports the host's result (when there is one) and shows the standings. */
  const finishOnline = (order: [number, number][], w: number | null, report = true) => {
    const n = net.current;
    const o = onlineRef.current;
    const r = race.current!;
    if (report && !n.reported && o) {
      n.reported = true;
      o.reportResult(o.round, w);
    }
    if (n.over) return;
    n.over = true;
    const me = r.karts[r.me];
    const nameOf = (seat: number) => r.karts.find((k) => k.seat === seat)?.name ?? 'someone';
    const place = order.findIndex(([seat]) => seat === me.seat) + 1;
    const winner = w === null ? null : order.find(([seat]) => seat === w);
    const youWon = w !== null && w === me.seat;
    const title = me.done === null ? 'Did Not Finish' : youWon ? 'You Won' : `${ordinal(place)} Place`;
    const head = me.done === null ? 'You ran out of time.' : `${fmtTime(me.done)} on ${COURSES[r.course].name} at ${r.cc}.`;
    const tail = (winner && !youWon ? ` ${nameOf(winner[0])} won in ${fmtTime(winner[1])}.` : '') + bankCoins(me.done === null ? 0 : place);
    sfx.play(youWon ? 'win' : me.done !== null ? 'coin' : 'lose');
    if (me.done !== null) bests[r.course][r.cc].submit(Math.round(me.done * 1000));
    shellRef.current.gameOver(undefined, me.done === null ? { title, detail: head + tail } : { title, detail: head + tail, board: boardOf(r.course, r.cc), rank: Math.round(me.done * 1000) });
  };
  const finishRef = useRef(finishOnline);
  finishRef.current = finishOnline;

  /** Runs the online race on to the wall clock (at most `cap` seconds of it now), sending what its events say. */
  const runOnline = (r: Race, cap: number, background: boolean) => {
    const n = net.current;
    const v = view.current;
    // (a guest's race also keeps to the host's clock, see onHostClock)
    advance(r, onHostClock(n, !!onlineRef.current?.isHost, pacer.current.take(performance.now(), cap)), (evs) => {
      for (const e of evs) {
        // (no sound or sparks for a page nobody is looking at: they would all go off at once when it comes back)
        if (!background) {
          react(r, e);
          v?.react(e, r, r.me);
        }
        outgoing(n, r, e);
      }
    });
    const o = onlineRef.current;
    if (o && n.outbox.length) for (const d of flushEvents(n, o.round)) o.send(d);
  };
  const runRef = useRef(runOnline);
  runRef.current = runOnline;

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      const o = onlineRef.current;
      const r = race.current;
      if (!o || !r) return;
      const heard = receive(n, r, o, from, d, () => lookFor(loadGarage()));
      if (!heard) return;
      if (heard.sitOut) {
        if (shellRef.current.status === 'playing') shellRef.current.gameOver(undefined, { title: 'Sitting This One Out', detail: 'You Will Race the Next One.' });
      } else if (heard.race) {
        race.current = heard.race;
        pacer.current.reset(performance.now());
        setRaceKey((x) => x + 1);
      } else if (heard.end) finishRef.current(heard.end.order, heard.end.w);
      else if (heard.relay !== undefined) o.send(heard.relay);
    });
    // The network's tick comes from a timer that keeps going in a background tab (see every), not the frame loop. While
    // no frames come (the page is hidden), it runs the race on too, with hands off the controls, so this player's
    // kart, and on the host its bots and the call at the end, carry on for everyone else.
    const stop = every(SEND_MS, () => {
      const o = onlineRef.current;
      const r = race.current;
      if (!o || !r || !n.synced) return;
      if (performance.now() - frameAt.current > 250) {
        const me = r.karts[r.me];
        if (me && document.hidden) Object.assign(me.input, { steer: 0, fwd: false, brake: false, drift: false, hold: false, use: false, hop: false });
        runRef.current(r, 2, true);
      }
      const { out, end } = tick(n, r, o, lookRef.current);
      for (const { d, fast } of out) o.send(d, fast ? { fast: true } : undefined);
      if (end) finishRef.current(end.order, end.w);
    });
    return () => {
      off();
      stop();
    };
  }, [live]);

  // ---------------------------------------------------------------------------------------------------------------
  // The frame loop: input, simulation, sounds, camera, HUD.

  useGameLoop(
    (dt) => {
      const r = race.current!;
      const v = view.current;
      const n = net.current;
      const o = onlineRef.current;
      clock.current += dt;
      if (!n.synced) {
        if (v) v.frame(r, Math.max(0, r.me), dt, clock.current);
        updateHud(r, dt);
        return;
      }
      const me = r.karts[r.me];
      if (me && !me.auto && !n.over) {
        const inp = me.input;
        // (the touch steering pad, else the keys)
        inp.steer = steerSide.current || (keys.down('right') ? 1 : 0) - (keys.down('left') ? 1 : 0);
        inp.brake = keys.down('down');
        inp.drift = keys.down('Space', 'ShiftLeft', 'ShiftRight');
        if (keys.pressed('Space', 'ShiftLeft', 'ShiftRight')) inp.hop = true;
        inp.fwd = keys.down('up');
        // Bananas and shells trail behind as a shield while the item button is held and fly when it is let go; other
        // items go off on the press. Z or J (or the back button) throws backwards right away.
        const trails = me.roll === 0 && trailable(me.item);
        const itemDown = keys.down('KeyX', 'KeyE', 'Enter');
        const itemPress = keys.pressed('KeyX', 'KeyE', 'Enter');
        const backPress = keys.pressed('KeyZ', 'KeyJ', 'KeyQ') || tap.current.back;
        let use = itemPress;
        if (backPress) use = true;
        else if (trails) use = (holding.current && !itemDown) || (itemPress && !itemDown);
        if (use) {
          inp.use = true;
          inp.back = backPress || keys.down('down');
        }
        inp.hold = trails && itemDown && !backPress;
        holding.current = inp.hold;
        if (keys.pressed('KeyC') || tap.current.slam) inp.slam = true;
        if (keys.pressed('KeyB', 'KeyH') || tap.current.cash) inp.cash = true;
        if (r.time < 0 && (keys.pressed('up') || tap.current.gas)) pressGas(r, me);
      }
      tap.current = { back: false, gas: false, cash: false, slam: false };

      if (live) {
        // online the race keeps to the wall clock: a slow frame is caught up rather than played in slow motion
        frameAt.current = performance.now();
        runOnline(r, 0.25, false);
      } else {
        step(r, dt);
        for (const e of r.events.splice(0)) {
          react(r, e);
          v?.react(e, r, r.me);
        }
      }

      // roulette ticks and the spark color clicking up while you drift
      if (me && me.roll > 0) {
        rollTick.current -= dt;
        if (rollTick.current <= 0) {
          rollTick.current = 0.085;
          sfx.play('tick', 1.6);
        }
      }
      // the crane's winch whirring as it hauls you back
      const carrying = !!me && me.sunk > 0 && 1 - me.sunk / r.tier.fallT >= FALL_SINK;
      // (the drone's buzz on the Skyway)
      if (carrying && !winching.current) {
        // (the coach's launch's outboard, on the water)
        if (r.boat) sfx.tone({ freq: 92, to: 110, dur: FALL_CARRY * r.tier.fallT, type: 'sawtooth', vol: 0.05 });
        else if (r.holePast === 'void') sfx.tone({ freq: 140, to: 160, dur: FALL_CARRY * r.tier.fallT, type: 'sawtooth', vol: 0.04 });
        else sfx.tone({ freq: 180, to: 460, dur: FALL_CARRY * r.tier.fallT, type: 'sawtooth', vol: 0.045 });
      }
      winching.current = carrying;
      if (me) pieceSounds(r, me, dt);
      // on the water: the weir roaring as you come down to it, gulls over the Port, and on the last lap the foghorn
      if (me && r.boat && r.time > 0) boatSounds(r, me, dt);
      // on the water, the cox-box clicking the beat (on it or just after, so a slow frame does not skip a click)
      if (me && r.boat && r.time > 0 && me.done === null && me.sunk === 0) {
        const { beat, off } = beatAt(r.time);
        if (beat !== lastBeat.current && off > -0.02 && off < 0.1) {
          lastBeat.current = beat;
          sfx.tone({ freq: 1900, dur: 0.02, type: 'square', vol: 0.035 });
        }
      }
      const level = me && me.drift ? turboLevel(me.charge) : 0;
      if (level > lastLevel.current) sfx.tone({ freq: 500 + level * 180, dur: 0.06, type: 'square', vol: 0.08 });
      lastLevel.current = level;

      // the soundtrack runs from the green light to your finish, a notch faster on the final lap
      const now = sfx.clock();
      if (musicRef.current === 'on' && now !== null && me && r.time >= 0 && me.done === null && !n.over) song.current!.tick(now, lapOf(r, me) === r.laps);

      if (v) {
        v.frame(r, Math.max(0, r.me), dt, clock.current, keys.down('KeyV'));
        placeOverlays(r, v);
      }

      // the end of the race
      if (me && me.done !== null && doneAt.current === null) doneAt.current = clock.current;
      if (!live) {
        const since = doneAt.current === null ? -1 : clock.current - doneAt.current;
        const skip = since > 3.2 && keys.pressed('action', 'KeyX');
        if (since > 7.5 || skip) finishSolo(r);
      } else if (o && !n.over) {
        if (me && me.done === null && r.first !== null && r.time - r.first > TIME_LIMIT) {
          // out of time: the race goes on without us and the host still calls the result
          n.dnf = true;
          n.over = true;
          me.auto = true;
          sfx.play('lose');
          shellRef.current.gameOver(undefined, { title: 'Time Up', detail: `The race ended ${TIME_LIMIT} seconds after the first kart finished.${bankCoins(0)}` });
        } else if (doneAt.current !== null && clock.current - doneAt.current > 45) {
          // the host never called it: show what we know without reporting a winner
          finishOnline(finishOrder(r.karts.filter((k) => k.seat >= 0).map((k) => [k.seat, k.done ?? -1])), null, false);
        }
      }
      updateHud(r, dt);
    },
    () => view.current?.render(),
  );

  /** This race's coins (and a podium bonus) into the garage bank, once; returns a line for the Game Over card. */
  function bankCoins(place: number) {
    const n = net.current;
    const me = race.current?.karts[race.current.me];
    if (n.banked || !me) return '';
    n.banked = true;
    const coins = payout(me.earned, place);
    if (coins <= 0) return '';
    saveGarage(deposit(loadGarage(), coins));
    return ` +${coins} coins for your garage.`;
  }

  function finishSolo(r: Race) {
    const n = net.current;
    if (n.over) return;
    n.over = true;
    const me = r.karts[r.me];
    const ranked = standings(r);
    const place = ranked.findIndex((x) => x.k === me) + 1;
    const ms = Math.round((me.done ?? r.time) * 1000);
    const newBest = bests[r.course][r.cc].submit(ms);
    const winner = ranked[0];
    const lead = place === 1 ? (me.laps.length ? `Best lap ${fmtTime(Math.min(...me.laps))}.` : '') : `${winner.k.name} won in ${fmtTime(winner.time)}.`;
    shellRef.current.gameOver(undefined, {
      title: place === 1 ? 'You Won' : `${ordinal(place)} Place`,
      detail: `${fmtTime(ms / 1000)} on ${COURSES[r.course].name} at ${r.cc}${newBest ? ', a new best' : ''}. ${lead}`.trim() + bankCoins(place),
      board: boardOf(r.course, r.cc),
      rank: ms,
    });
  }

  /**
   * What the set pieces sound like as they go off near you, worked out here from their state on the clock (so nothing
   * about them goes over the network): the hiss and thoom of a pile driver, a bollard bank's warning beep and clank,
   * the ratchet of a sprinkler and its hiss as it comes on, the whoosh of the ball swinging by, and your own tyres on
   * the wet road. Quieter the further off they are, and silent beyond 70 m.
   */
  /** The slough's own sounds, round your shell: the weir's roar, gulls over the Port and the foghorn in the fog. */
  function boatSounds(r: Race, me: Kart, dt: number) {
    roarT.current -= dt;
    if (roarT.current <= 0) {
      roarT.current = 0.28;
      for (const h of r.holes) {
        const dist = Math.hypot(h.x - me.x, h.z - me.z);
        if (dist < 80) sfx.noise(0.34, 0.05 * (1 - dist / 80) ** 1.5);
      }
    }
    // (the tug's horn as it comes up Westpoint Slough, once a transit, near enough to hear)
    for (const v of r.vessels) {
      if (v.kind !== 'barge' || v.gone) continue;
      const dist = Math.hypot(v.x - me.x, v.z - me.z);
      const transit = Math.floor((r.time - (v.phase ?? 0)) / (v.every ?? 60));
      if (dist < 90 && tugAt.current !== transit) {
        tugAt.current = transit;
        const vol = 1 - dist / 90;
        sfx.tone({ freq: 82, dur: 1.2, type: 'sawtooth', vol: 0.09 * vol });
        sfx.tone({ freq: 123, dur: 1.2, type: 'triangle', vol: 0.05 * vol });
      }
    }
    // (gulls wheeling over the Port's wharves, now and then)
    if (me.s > 370 && me.s < 450 && Math.random() < dt * 0.5) {
      const f = 1500 + Math.random() * 400;
      sfx.tone({ freq: f, to: f * 0.62, dur: 0.16, type: 'triangle', vol: 0.025 });
      sfx.tone({ freq: f * 1.05, to: f * 0.6, dur: 0.2, type: 'triangle', vol: 0.02, delay: 0.2 });
    }
    // (the foghorn out on the Bay, every 8 s, once the fog is in)
    // (the fog comes in with the tide's turn: see Look.fogLap)
    const horn = Math.floor(r.time / 8);
    if (me.lap >= TIDE_LAP && me.done === null && horn !== fogHorn.current) {
      fogHorn.current = horn;
      sfx.tone({ freq: 110, dur: 1.5, type: 'sawtooth', vol: 0.045 });
      sfx.tone({ freq: 111.5, dur: 1.5, type: 'triangle', vol: 0.06 });
    }
  }

  function pieceSounds(r: Race, me: Kart, dt: number) {
    pieceTick.current -= dt;
    const tick = pieceTick.current <= 0;
    if (tick) pieceTick.current = 0.17;
    hissT.current -= dt;
    if (me.wet && me.v > 6 && hissT.current <= 0) {
      hissT.current = 0.1;
      sfx.noise(0.12, 0.025);
    }
    // the tyres squealing as you slide on frost
    if (r.slick && me.y <= 0.05 && me.sunk === 0 && Math.hypot(me.kx, me.kz) > 3 && gripAt(r.track, me.s, me.lap) < 0.6 && hissT.current <= 0) {
      hissT.current = 0.12;
      sfx.tone({ freq: 1700 + Math.random() * 300, dur: 0.1, type: 'sawtooth', vol: 0.025 });
    }
    r.hazards.forEach((h, i) => {
      // an oncoming car or van bearing down on you leans on its horn (no more than every couple of seconds)
      if (traffic(h.kind)) {
        if (me.done === null && bearingDown(h, me) && r.time - (honked.current.get(i) ?? -99) > 2) {
          honked.current.set(i, r.time);
          const [a, b] = h.kind === 'van' ? [330, 415] : [440, 554];
          sfx.tone({ freq: a, dur: 0.45, type: 'square', vol: 0.05 });
          sfx.tone({ freq: b, dur: 0.45, type: 'square', vol: 0.045 });
        }
        return;
      }
      if (!timed(h.kind)) return;
      const dist = Math.hypot(h.x - me.x, h.z - me.z);
      if (h.kind === 'shuttle') {
        // the crossing's bells while a bus is due or across, and the bus's diesel as it goes over
        if (dist > 110) return;
        const st = hazState(r, h, r.time, me.lap);
        // (one set of bells for the crossing, whichever bus is due)
        const key = -1 - Math.round(h.s);
        const beat = Math.floor(r.time / 0.45);
        const near = 1 - dist / 110;
        if (st.warn > 0 && beat !== (pieceCyc.current.get(key) ?? beat - 1)) {
          pieceCyc.current.set(key, beat);
          sfx.tone({ freq: beat % 2 ? 1180 : 940, dur: 0.22, type: 'triangle', vol: 0.06 * near });
        }
        if (st.live && tick && dist < 45) sfx.tone({ freq: 55, dur: 0.18, type: 'sawtooth', vol: 0.05 * (1 - dist / 45) });
        return;
      }
      if (dist > 70) return;
      const vol = 1 - dist / 70;
      const st = hazState(r, h, r.time, me.lap);
      if (h.kind === 'tether' && h.look !== 'goose') {
        // the Tree: a creak of the bungee as it crouches, a kazoo whoop as it springs
        const now = st.live ? 2 : st.warn > 0 ? 1 : 0;
        const was = pieceCyc.current.get(i) ?? 0;
        pieceCyc.current.set(i, now);
        if (now === 1 && was === 0) sfx.tone({ freq: 160, to: 110, dur: 0.5, type: 'triangle', vol: 0.06 * vol });
        if (now === 2 && was !== 2) {
          sfx.tone({ freq: 330, to: 780, dur: 0.22, type: 'square', vol: 0.05 * vol });
          sfx.tone({ freq: 780, to: 520, dur: 0.3, type: 'square', vol: 0.05 * vol, delay: 0.2 });
        }
        return;
      }
      if (h.kind === 'wrecker') {
        // the ball passing through the middle of its swing, close by
        const v = hazardV(h, r.time);
        const was = pieceCyc.current.get(i) ?? v;
        pieceCyc.current.set(i, v);
        if (st.live && dist < 20 && Math.sign(v) !== Math.sign(was)) sfx.noise(0.3, 0.09 * (1 - dist / 20) + 0.02);
        return;
      }
      if (h.kind === 'mower') {
        // the gang mower: a reversing beeper before it sets off across, and the rattle of its reels while it is across
        const beat = Math.floor(r.time / 0.45);
        const was = pieceCyc.current.get(i) ?? beat;
        pieceCyc.current.set(i, beat);
        if (beat !== was && st.warn > 0 && !st.live && beat % 2 === 0) sfx.tone({ freq: 1180, dur: 0.16, type: 'square', vol: 0.05 * vol });
        if (st.live && tick && dist < 45) sfx.noise(0.16, 0.035 * (1 - dist / 45));
        return;
      }
      if (h.kind === 'tether') {
        // a goose: a hiss as it crouches, and a honk as it goes for you
        const was = pieceCyc.current.get(i) ?? 0;
        const now = st.live ? 2 : st.warn > 0 ? 1 : 0;
        pieceCyc.current.set(i, now);
        if (dist > 45 || st.phase === 'off') return;
        const near = 1 - dist / 45;
        if (now === 1 && was === 0) sfx.noise(0.45, 0.04 * near, 0.01);
        if (now === 2 && was !== 2) {
          sfx.tone({ freq: 330, to: 250, dur: 0.16, type: 'sawtooth', vol: 0.07 * near });
          sfx.tone({ freq: 340, to: 240, dur: 0.22, type: 'sawtooth', vol: 0.07 * near, delay: 0.2 });
        }
        return;
      }
      if (h.kind === 'whirl') {
        // a whirlpool: a rising gurgle as its foam starts to turn, a roar as it spins up, churning while it spins
        const was = pieceCyc.current.get(i) ?? 0;
        const now = st.live ? 2 : st.warn > 0 ? 1 : 0;
        pieceCyc.current.set(i, now);
        if (dist > 60 || st.phase === 'off') return;
        const near = 1 - dist / 60;
        if (now === 1 && was === 0) sfx.tone({ freq: 120, to: 260, dur: 1.2, type: 'sine', vol: 0.05 * near });
        if (now === 2 && was !== 2) {
          sfx.noise(0.8, 0.07 * near);
          sfx.tone({ freq: 180, to: 70, dur: 1, type: 'sawtooth', vol: 0.04 * near });
        }
        if (now === 2 && tick && Math.random() < 0.4) sfx.noise(0.25, 0.03 * near);
        return;
      }
      if (h.kind === 'rotor') {
        const was = pieceCyc.current.get(i) ?? 0;
        pieceCyc.current.set(i, st.live ? 1 : 0);
        if (h.look === 'swing') {
          // the Caltrain swing span: railway crossing bells while it sweeps, near enough to hear
          if (st.live && tick && dist < 60) {
            const bell = Math.floor(r.time / 0.34) % 2 ? 1250 : 1050;
            sfx.tone({ freq: bell, dur: 0.12, type: 'triangle', vol: 0.03 * (1 - dist / 60) });
          }
          return;
        }
        if (h.look === 'beam') {
          // the relay beam: a rising tone as it comes on, then a low hum as it sweeps
          if (st.live && !was) sfx.tone({ freq: 220, to: 660, dur: 0.4, type: 'sine', vol: 0.06 * vol });
          if (st.live && tick && dist < 40) sfx.tone({ freq: 110, dur: 0.19, type: 'triangle', vol: 0.035 * (1 - dist / 40) });
          return;
        }
        if (st.live && !was && dist < 70) sfx.noise(0.5, 0.08 * vol);
        if (st.live && tick && dist < 40) sfx.tone({ freq: 2400, dur: 0.012, type: 'square', vol: 0.03 * (1 - dist / 40) });
        return;
      }
      if (h.kind === 'boulder') {
        // a boulder: a low rumble as it works loose and comes down its chute, and a thud each time it lands off a wall
        const b = boulderAt(r, h, r.time);
        const was = pieceCyc.current.get(i) ?? 0;
        const now = b.rolling ? 2 : b.warn > 0 ? 1 : 0;
        pieceCyc.current.set(i, now);
        if (now === 1 && was === 0) {
          sfx.tone({ freq: 48, to: 38, dur: 1.3, type: 'sawtooth', vol: 0.05 * vol });
          sfx.noise(1.1, 0.05 * vol);
        }
        if (now === 2 && was !== 2) {
          sfx.tone({ freq: 62, to: 34, dur: 0.4, type: 'sine', vol: 0.16 * vol });
          sfx.noise(0.25, 0.08 * vol);
        }
        if (now === 2 && tick && Math.abs(b.d) < r.track.edge && Math.random() < 0.5) sfx.tone({ freq: 55 + Math.random() * 20, dur: 0.12, type: 'triangle', vol: 0.06 * vol });
        return;
      }
      if (h.kind === 'panel' || h.kind === 'geyser') {
        // a pane: a rising chime through its warning, a tinkle of glass as it goes and a shing as it comes back; a flare:
        // a crackle as its grate glows and a whoomph as it blows
        const was = pieceCyc.current.get(i) ?? 0;
        const now = st.live ? 2 : st.warn > 0 ? 1 : 0;
        pieceCyc.current.set(i, now);
        if (now === was || st.phase === 'off') return;
        if (h.kind === 'panel') {
          if (now === 1) sfx.tone({ freq: 1320, to: 2640, dur: 0.6, type: 'triangle', vol: 0.03 * vol });
          else if (now === 2) {
            sfx.noise(0.12, 0.05 * vol);
            sfx.tone({ freq: 3400, to: 1700, dur: 0.18, type: 'triangle', vol: 0.05 * vol });
          } else if (was === 2) sfx.tone({ freq: 1800, to: 3600, dur: 0.12, type: 'sine', vol: 0.04 * vol });
        } else if (h.look === 'fountain') {
          // a fountain jet: a gurgle as the water ripples, a rushing whoosh as it blows
          if (now === 1) sfx.tone({ freq: 140, to: 260, dur: 0.5, type: 'sine', vol: 0.04 * vol });
          else if (now === 2) {
            sfx.noise(0.6, 0.1 * vol);
            sfx.tone({ freq: 520, to: 260, dur: 0.4, type: 'sine', vol: 0.04 * vol });
          }
        } else if (now === 1) sfx.noise(0.3, 0.025 * vol);
        else if (now === 2) {
          sfx.noise(0.5, 0.12 * vol);
          sfx.tone({ freq: 95, to: 55, dur: 0.45, type: 'sawtooth', vol: 0.08 * vol });
        }
        return;
      }
      if (st.phase === 'off') return;
      const every = h.every ?? (h.kind === 'hammer' ? HAMMER.every : BANK.every);
      const c = cycleAt(h, r.time, every);
      const was = pieceCyc.current.get(i);
      pieceCyc.current.set(i, c);
      if (was === undefined) return;
      // the beat, and the warning before it: crossed this frame?
      const crossed = (at: number) => (was < at && c >= at) || (was > c && (c >= at || was < at));
      const warn = every - (h.warn ?? (h.kind === 'hammer' ? HAMMER.warn : BANK.warn));
      if (h.kind === 'hammer') {
        if (crossed(warn) && st.phase === 'idle' && st.warn > 0) sfx.noise(0.5, 0.05 * vol);
        if (crossed(HAMMER.slam) && (st.phase === 'down' || st.phase === 'slam')) {
          if (h.look === 'bell') {
            // BONG: Hoover's carillon, a struck bell and its inharmonic partials
            sfx.tone({ freq: 196, dur: 1.6, type: 'sine', vol: 0.2 * vol });
            sfx.tone({ freq: 196 * 2.76, dur: 0.9, type: 'sine', vol: 0.07 * vol });
            sfx.tone({ freq: 196 * 5.4, dur: 0.5, type: 'sine', vol: 0.04 * vol });
          } else {
            // thoom
            sfx.noise(0.22, 0.2 * vol);
            sfx.tone({ freq: 45, to: 32, dur: 0.4, type: 'sine', vol: 0.22 * vol });
          }
          if (dist < 25) buzz(30);
        }
      } else if (h.look === 'gate') {
        // the Tide Gates: the lock's klaxon as a leaf is about to swing, and the steel clang as it shuts
        if (crossed(warn) && st.phase === 'idle' && st.warn > 0) {
          sfx.tone({ freq: 440, to: 330, dur: 0.28, type: 'square', vol: 0.035 * vol });
          sfx.tone({ freq: 440, to: 330, dur: 0.28, type: 'square', vol: 0.035 * vol, delay: 0.34 });
        }
        if (crossed(0) && st.solid) {
          sfx.tone({ freq: 150, dur: 0.5, type: 'triangle', vol: 0.09 * vol });
          sfx.tone({ freq: 415, dur: 0.3, type: 'sine', vol: 0.04 * vol });
          sfx.noise(0.08, 0.06 * vol);
        }
      } else {
        if (crossed(warn) && st.phase === 'idle' && st.warn > 0) sfx.tone({ freq: 620, to: 980, dur: 0.5, type: 'square', vol: 0.035 * vol });
        if (crossed(0) && st.solid) {
          // a hydraulic clank
          sfx.noise(0.06, 0.07 * vol);
          sfx.tone({ freq: 190, to: 95, dur: 0.14, type: 'sawtooth', vol: 0.08 * vol });
        }
      }
    });
  }

  function react(r: Race, e: Ev) {
    const mine = 'k' in e && e.k === r.me;
    switch (e.t) {
      case 'beep':
        sfx.tone({ freq: 440, dur: 0.18, type: 'square', vol: 0.15 });
        break;
      case 'go':
        sfx.tone({ freq: 880, dur: 0.5, type: 'square', vol: 0.17 });
        if (!hints.current!.counted) {
          hints.current!.counted = true;
          countRace();
        }
        if (r.boat) showHint('row', 'Tap Space on the click, as your blades go in, for a clean catch. Hold it through the bends to carve.', 'Tap row as it lights up, on the click, for a clean catch. Hold it through the bends to carve.');
        else showHint('drift', 'Hold Space while you turn to drift. Let go for a boost!', 'Hold drift while you turn to slide. Let go for a boost!');
        break;
      case 'rocket':
        if (mine) sfx.tone({ freq: 300, to: 1000, dur: 0.3, type: 'sawtooth', vol: 0.12 });
        break;
      case 'box':
        if (mine) sfx.play('select', 1.2);
        break;
      case 'got':
        if (!mine) break;
        sfx.play('blip', 1.5);
        showHint('item', 'X uses your item. Hold X to keep a banana or shell behind you.', 'Tap item to use it. Hold it to keep a banana or shell behind you.');
        break;
      case 'use':
        if (!mine) break;
        if (e.item === 'mushroom' || e.item === 'triple' || e.item === 'golden') sfx.tone({ freq: 260, to: 900, dur: 0.3, type: 'sawtooth', vol: 0.12 });
        else if (e.item === 'star') sfx.play('win');
        else if (e.item === 'banana' || e.item === 'bananas' || e.item === 'bomb') sfx.play('jump', 0.7);
        else if (e.item === 'blue') sfx.tone({ freq: 900, to: 500, dur: 0.6, type: 'triangle', vol: 0.12 });
        else if (e.item === 'mega') sfx.tone({ freq: 110, to: 330, dur: 0.7, type: 'square', vol: 0.12 });
        else if (e.item === 'bullet') {
          sfx.noise(0.4, 0.2);
          sfx.tone({ freq: 160, to: 90, dur: 0.6, type: 'sawtooth', vol: 0.12 });
        } else if (e.item === 'ink') sfx.tone({ freq: 500, to: 180, dur: 0.25, type: 'sine', vol: 0.15 });
        else if (e.item === 'horn') [349, 440, 523].forEach((f) => sfx.tone({ freq: f, dur: 0.45, type: 'sawtooth', vol: 0.07 }));
        else if (e.item === 'fire') {
          // a whoosh
          sfx.noise(0.12, 0.08);
          sfx.tone({ freq: 620, to: 240, dur: 0.16, type: 'sawtooth', vol: 0.08 });
        } else if (e.item === 'ice') sfx.tone({ freq: 1500, to: 900, dur: 0.18, type: 'triangle', vol: 0.12 });
        else if (e.item === 'boomerang') sfx.tone({ freq: 380, to: 760, dur: 0.3, type: 'triangle', vol: 0.12 });
        else if (e.item === 'boo') {
          // the Boo's giggle, down and away
          sfx.tone({ freq: 620, to: 300, dur: 0.5, type: 'sine', vol: 0.13 });
          sfx.tone({ freq: 880, to: 520, dur: 0.18, type: 'sine', vol: 0.06, delay: 0.12 });
        } else if (e.item === 'feather') sfx.tone({ freq: 400, to: 1400, dur: 0.35, type: 'sine', vol: 0.12 });
        else if (e.item === 'piranha') [196, 247, 294].forEach((f, i) => sfx.tone({ freq: f, dur: 0.12, type: 'square', vol: 0.07, delay: i * 0.08 }));
        else if (e.item === 'cloud') {
          // thunder rumbling overhead
          sfx.noise(0.6, 0.06);
          sfx.tone({ freq: 70, to: 50, dur: 0.7, type: 'sawtooth', vol: 0.08 });
          setFlash({ id: Date.now(), kind: 'cloud' });
        } else if (e.item !== 'bolt' && e.item !== 'coin' && e.item !== 'pow') sfx.tone({ freq: 700, to: 300, dur: 0.18, type: 'triangle', vol: 0.15 });
        break;
      case 'chomp': {
        // your own plant snapping, or someone else's snapping right at you
        const you = r.karts[r.me];
        if (mine || (you && Math.hypot(e.x - you.x, e.z - you.z) < 4)) sfx.tone({ freq: 240, to: 110, dur: 0.1, type: 'square', vol: 0.11 });
        break;
      }
      case 'boo':
        // your item taken by someone's Boo, or someone's taken by yours
        if (mine) sfx.tone({ freq: 520, to: 200, dur: 0.6, type: 'sine', vol: 0.14 });
        else if (e.by === r.me) sfx.tone({ freq: 500, to: 1000, dur: 0.25, type: 'triangle', vol: 0.1, delay: 0.2 });
        break;
      case 'cloud':
        // a thunder cloud lands over you, or you got rid of yours
        if (mine) {
          sfx.noise(0.5, 0.06);
          sfx.tone({ freq: 70, to: 50, dur: 0.6, type: 'sawtooth', vol: 0.08 });
          setFlash({ id: Date.now(), kind: 'cloud' });
        } else if (e.by === r.me) sfx.tone({ freq: 300, to: 900, dur: 0.25, type: 'triangle', vol: 0.1 });
        break;
      case 'zap':
        if (!mine) break;
        sfx.play('boom', 1.6);
        setFlash({ id: Date.now(), kind: 'bolt' });
        buzz(120);
        break;
      case 'thump': {
        // the POW block's warning, louder each time for whoever it is coming for
        const you = r.karts[r.me];
        const user = r.karts[e.by];
        const coming = !!you && !!user && you !== user && you.place < user.place && you.done === null;
        sfx.tone({ freq: 70, to: 45, dur: 0.18, type: 'sine', vol: (coming ? 0.12 : 0.05) + e.n * 0.04 });
        sfx.noise(0.06, (coming ? 0.05 : 0.02) + e.n * 0.02);
        if (coming && e.n === 1) showHint('pow', 'A POW block! Hop with Space on the fourth beat to ride it out.', 'A POW block! Tap drift on the fourth beat to ride it out.');
        break;
      }
      case 'quake':
        sfx.play('boom', 0.5);
        break;
      case 'inked':
        if (!mine) break;
        sfx.tone({ freq: 220, to: 120, dur: 0.3, type: 'sine', vol: 0.16 });
        buzz(50);
        break;
      case 'blast':
        if (!mine) sfx.play('boom', 1.2);
        break;
      case 'mud':
        // a squelch
        if (mine) {
          sfx.noise(0.16, 0.14);
          sfx.tone({ freq: 160, to: 70, dur: 0.18, type: 'sine', vol: 0.14 });
        }
        break;
      case 'moo':
        if (mine) {
          sfx.tone({ freq: 150, to: 128, dur: 0.22, type: 'sawtooth', vol: 0.09 });
          sfx.tone({ freq: 128, to: 92, dur: 0.6, type: 'sawtooth', vol: 0.1, delay: 0.2 });
        }
        break;
      case 'ding':
        // the cyclist's bell: ding-ding
        if (mine) {
          sfx.tone({ freq: 2093, dur: 0.16, type: 'sine', vol: 0.12 });
          sfx.tone({ freq: 2093, dur: 0.3, type: 'sine', vol: 0.12, delay: 0.13 });
        }
        break;
      case 'honk':
        // the bus's two-tone horn
        if (mine) {
          sfx.tone({ freq: 415, dur: 0.24, type: 'sawtooth', vol: 0.08 });
          sfx.tone({ freq: 330, dur: 0.42, type: 'sawtooth', vol: 0.09, delay: 0.22 });
        }
        break;
      case 'toot':
        // a golf cart's little horn: beep-beep
        if (mine) {
          sfx.tone({ freq: 988, dur: 0.1, type: 'square', vol: 0.07 });
          sfx.tone({ freq: 988, dur: 0.14, type: 'square', vol: 0.07, delay: 0.15 });
        }
        break;
      case 'fore':
        // a golfer's shout, up and down
        if (mine) {
          sfx.tone({ freq: 420, to: 760, dur: 0.16, type: 'sawtooth', vol: 0.09 });
          sfx.tone({ freq: 760, to: 520, dur: 0.38, type: 'sawtooth', vol: 0.09, delay: 0.15 });
        }
        break;
      case 'haz':
        // caught by a set piece: flattened with a thud, clanged off a bollard, sprayed, or rung by the ball
        if (!mine) break;
        buzz(e.kind === 'rotor' ? 50 : 110);
        if (e.kind === 'hammer') {
          sfx.tone({ freq: 90, to: 36, dur: 0.35, type: 'sine', vol: 0.24 });
          sfx.noise(0.25, 0.16);
        } else if (e.kind === 'bollard') {
          sfx.noise(0.08, 0.12);
          sfx.tone({ freq: 240, to: 110, dur: 0.2, type: 'sawtooth', vol: 0.14 });
        } else if (e.kind === 'rotor') sfx.noise(0.35, 0.14);
        else if (e.kind === 'boulder') {
          // a boulder: a deep crunch
          sfx.tone({ freq: 70, to: 30, dur: 0.45, type: 'sine', vol: 0.26 });
          sfx.noise(0.35, 0.18);
        } else if (e.kind === 'launch') {
          // the launch's horn
          sfx.tone({ freq: 392, dur: 0.22, type: 'square', vol: 0.08 });
          sfx.tone({ freq: 330, dur: 0.35, type: 'square', vol: 0.08, delay: 0.2 });
        } else if (e.kind === 'barge') sfx.tone({ freq: 82, dur: 1.1, type: 'sawtooth', vol: 0.14 });
        else if (e.kind === 'ferry') {
          sfx.tone({ freq: 660, dur: 0.12, type: 'triangle', vol: 0.1 });
          sfx.tone({ freq: 660, dur: 0.2, type: 'triangle', vol: 0.1, delay: 0.16 });
        } else if (e.kind === 'log') {
          sfx.tone({ freq: 130, to: 70, dur: 0.25, type: 'sine', vol: 0.2 });
          sfx.noise(0.12, 0.1);
        } else if (e.kind === 'car' || e.kind === 'van' || e.kind === 'shuttle') {
          // a crunch, and the horn held down
          sfx.noise(0.35, 0.2);
          sfx.tone({ freq: 140, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.14 });
          const [a, b] = e.kind === 'shuttle' ? [415, 330] : e.kind === 'van' ? [330, 415] : [440, 554];
          sfx.tone({ freq: a, dur: 0.7, type: 'square', vol: 0.06, delay: 0.1 });
          sfx.tone({ freq: b, dur: 0.7, type: 'square', vol: 0.05, delay: 0.1 });
        } else if (e.kind === 'tether' && !r.hazards.some((h) => h.kind === 'tether' && h.look === 'goose')) {
          // bowled over by the Tree (a tether on the golf course is a goose, below): boing
          sfx.tone({ freq: 220, to: 660, dur: 0.18, type: 'sine', vol: 0.16 });
          sfx.tone({ freq: 660, to: 180, dur: 0.35, type: 'triangle', vol: 0.12, delay: 0.16 });
        } else if (e.kind === 'tether') {
          // a goose: HONK, and a flap of wings
          sfx.tone({ freq: 360, to: 260, dur: 0.2, type: 'sawtooth', vol: 0.14 });
          sfx.tone({ freq: 380, to: 250, dur: 0.26, type: 'sawtooth', vol: 0.12, delay: 0.22 });
          sfx.noise(0.25, 0.08);
        } else if (e.kind === 'mower') {
          // into the mower: a crunch and the groundskeeper's horn
          sfx.noise(0.3, 0.18);
          sfx.tone({ freq: 140, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.14 });
          sfx.tone({ freq: 440, dur: 0.35, type: 'square', vol: 0.06, delay: 0.1 });
        } else {
          sfx.tone({ freq: 520, to: 180, dur: 0.3, type: 'sawtooth', vol: 0.14 });
          sfx.noise(0.2, 0.1);
        }
        break;
      case 'catch':
        // a clean catch: the blade going in, thunk
        if (mine) {
          sfx.tone({ freq: 240, to: 130, dur: 0.12, type: 'sine', vol: 0.12 });
          sfx.noise(0.07, 0.04);
        }
        break;
      case 'power':
        // POWER TEN: a rising triad and the cox's three beeps
        if (mine) {
          [523, 659, 784].forEach((f, n) => sfx.tone({ freq: f, dur: 0.16, type: 'square', vol: 0.08, delay: n * 0.09 }));
          for (let n = 0; n < 3; n++) sfx.tone({ freq: 1320, dur: 0.06, type: 'square', vol: 0.06, delay: 0.35 + n * 0.12 });
          lapBanner.current = { text: 'power ten!', note: null, at: clock.current };
        }
        break;
      case 'bonk':
        if (mine) sfx.tone({ freq: 330, to: 240, dur: 0.12, type: 'triangle', vol: 0.1 });
        break;
      case 'wake':
        // a wake slapping the hull
        if (mine) sfx.noise(0.14, 0.05 + 0.06 * e.amp);
        break;
      case 'swell':
        if (mine) {
          sfx.noise(0.25, 0.06);
          sfx.tone({ freq: 90, to: 60, dur: 0.3, type: 'sine', vol: 0.1 });
        }
        break;
      case 'plink':
        // a golf ball off your helmet
        if (mine) {
          sfx.tone({ freq: 2600, to: 1700, dur: 0.12, type: 'sine', vol: 0.16 });
          sfx.tone({ freq: 3400, dur: 0.08, type: 'triangle', vol: 0.07, delay: 0.03 });
        }
        break;
      case 'splash':
        // into the water (on the slough, sucked under by a whirlpool or caught in the weir's stopper: a gurgle down)
        if (mine) {
          sfx.noise(0.5, 0.22);
          sfx.tone({ freq: r.boat ? 400 : 300, to: 80, dur: r.boat ? 0.8 : 0.45, type: 'sine', vol: 0.16 });
          buzz(80);
        }
        break;
      case 'fall':
        // off the Skyway: a long falling whistle
        if (mine && e.kind === 'void') {
          sfx.tone({ freq: 1200, to: 300, dur: 0.6, type: 'sine', vol: 0.16 });
          buzz(90);
          break;
        }
        // out of bounds on the golf course: a referee's whistle (two blasts) and a thud into the gully
        if (mine && e.kind === 'ob') {
          sfx.tone({ freq: 2300, to: 2200, dur: 0.18, type: 'sine', vol: 0.1 });
          sfx.tone({ freq: 2300, to: 2150, dur: 0.38, type: 'sine', vol: 0.1, delay: 0.24 });
          sfx.tone({ freq: 110, to: 45, dur: 0.35, type: 'sine', vol: 0.18 });
          buzz(80);
          break;
        }
        // run aground in the marsh: a squelch
        if (mine && e.kind === 'marsh') {
          sfx.noise(0.3, 0.12, 0.02);
          sfx.tone({ freq: 90, to: 60, dur: 0.3, type: 'sine', vol: 0.2 });
          buzz(70);
          break;
        }
        // down into a pit: a thud and a clatter
        if (mine) {
          sfx.tone({ freq: 110, to: 38, dur: 0.4, type: 'sine', vol: 0.24 });
          sfx.noise(0.3, 0.16, 0.05);
          buzz(90);
        }
        break;
      case 'set':
        // set back down on the road: pop
        if (mine) sfx.tone({ freq: 520, to: 980, dur: 0.09, type: 'square', vol: 0.09 });
        break;
      case 'sank': {
        // something thrown over the edge, close by: plop
        const k = r.karts[r.me];
        if (k && Math.hypot(k.x - e.x, k.z - e.z) < 40) sfx.tone({ freq: e.kind === 'water' ? 620 : 240, to: e.kind === 'water' ? 180 : 90, dur: 0.16, type: 'sine', vol: 0.07 });
        break;
      }
      case 'sand':
        if (mine) sfx.noise(0.14, 0.09);
        break;
      case 'slam':
        if (mine) sfx.tone({ freq: 240, to: 120, dur: 0.14, type: 'sawtooth', vol: 0.12 });
        break;
      case 'slammed':
        if (e.k === r.me) {
          sfx.play('hit', 0.8);
          setFlash({ id: Date.now(), kind: 'hit' });
          buzz(40);
        } else if (e.by === r.me) sfx.play(e.coin ? 'coin' : 'hit', e.coin ? 1.3 : 1.5);
        break;
      case 'draft':
        if (mine) sfx.tone({ freq: 200, to: 700, dur: 0.35, type: 'triangle', vol: 0.1 });
        break;
      case 'block':
        if (mine) {
          sfx.play('tick', 0.8);
          sfx.play('hit', 1.4);
        }
        break;
      case 'ramp':
        if (!mine) break;
        sfx.play('jump', 0.9);
        showHint('trick', 'Press Space in the air for a trick!', 'Tap drift in the air for a trick!');
        break;
      case 'trick':
        if (mine) sfx.play('select', 1.6);
        break;
      case 'hit':
        if (mine) {
          buzz(e.how === 'spin' || e.how === 'squash' || e.how === 'freeze' ? 60 : 120);
          // (iced over: a crackle of frost)
          if (e.how === 'freeze') {
            sfx.tone({ freq: 1800, to: 500, dur: 0.4, type: 'triangle', vol: 0.12 });
            sfx.noise(0.15, 0.06);
          } else sfx.play(e.how === 'spin' || e.how === 'squash' ? 'hit' : 'boom');
          // (on the water a spin is a crab: the oar's clack in its gate and a splash)
          if (r.boat && e.how === 'spin') {
            sfx.tone({ freq: 1100, to: 700, dur: 0.05, type: 'square', vol: 0.08 });
            sfx.noise(0.3, 0.09, 0.05);
          }
          setFlash({ id: Date.now(), kind: e.how === 'freeze' ? 'ice' : 'hit' });
        }
        break;
      case 'bump':
      case 'wall':
        if (mine) sfx.play('tick', 0.5);
        break;
      case 'coin':
        if (mine) sfx.play('coin', 1.1);
        break;
      case 'cash':
        if (!mine) break;
        sfx.play('coin', 0.8);
        sfx.tone({ freq: 300, to: 1000, dur: 0.25, type: 'sawtooth', vol: 0.1, delay: 0.05 });
        break;
      case 'turbo':
        if (mine) sfx.tone({ freq: 300 + e.level * 120, to: 900 + e.level * 200, dur: 0.25, type: 'sawtooth', vol: 0.12 });
        break;
      case 'dash':
        if (mine) sfx.tone({ freq: 380, to: 1200, dur: 0.22, type: 'triangle', vol: 0.14 });
        // a kicker's sideways zip
        if (mine && e.kick) sfx.tone({ freq: 1400, to: 300, dur: 0.2, type: 'sawtooth', vol: 0.07, delay: 0.05 });
        break;
      case 'bolt':
        sfx.play('boom', 1.6);
        setFlash({ id: Date.now(), kind: 'bolt' });
        break;
      case 'boom':
        sfx.play('boom', 0.7);
        break;
      case 'lap':
        if (!mine) break;
        setLapNote({ id: Date.now(), text: fmtTime(r.karts[r.me].laps[r.karts[r.me].laps.length - 1] ?? 0) });
        lapBanner.current = { text: e.lap === r.laps ? 'final lap!' : `lap ${e.lap}/${r.laps}`, note: COURSES[r.course].laps?.[e.lap] ?? null, at: clock.current };
        if (e.lap === r.laps) {
          sfx.tone({ freq: 660, dur: 0.12, type: 'square', vol: 0.14 });
          sfx.tone({ freq: 880, dur: 0.12, type: 'square', vol: 0.14, delay: 0.14 });
          sfx.tone({ freq: 1320, dur: 0.3, type: 'square', vol: 0.14, delay: 0.28 });
        } else sfx.play('select', 1.4);
        break;
      case 'finish':
        if (!mine) break;
        if (musicRef.current === 'on') playJingle(r.karts[r.me].place <= 3 ? JINGLE_WIN : JINGLE_DONE);
        else sfx.play(r.karts[r.me].place <= 3 ? 'win' : 'coin');
        break;
    }
  }

  /** Minimap dots and online name tags, moved straight on the DOM every frame. */
  function placeOverlays(r: Race, v: View) {
    for (const [i, el] of busDots.current) {
      const h = r.hazards[i];
      if (h) {
        el.setAttribute('transform', `translate(${-h.x} ${-h.z})`);
        el.style.display = h.gone ? 'none' : '';
      }
    }
    // the stroke light: warming up as the catch comes, bright through the catch window, its pips the run of catches
    const me = r.karts[r.me];
    if (r.boat && me) {
      const { off } = beatAt(r.time);
      const live = r.time > 0 && me.done === null;
      const open = live && Math.abs(off) <= CATCH_WIN;
      const el = strokeLight.current;
      if (el) {
        el.classList.toggle('is-open', open);
        el.classList.toggle('is-near', live && !open && off < 0 && off > -STROKE_T * 0.3);
        strokePips.current.forEach((pip, n) => pip?.classList.toggle('is-on', n < me.streak));
      }
      driftBtn.current?.classList.toggle('is-catch', open);
    }
    for (const k of r.karts) {
      const dot = dots.current.get(k.idx);
      if (dot) {
        dot.setAttribute('cx', String(-k.x));
        dot.setAttribute('cy', String(-k.z));
      }
      const tag = tags.current.get(k.idx);
      if (!tag) continue;
      const me = r.karts[r.me];
      const ahead = me ? Math.hypot(k.x - me.x, k.z - me.z) : 0;
      const at = ahead > 3 && ahead < 120 ? v.project(k.x, 2.6 + k.y, k.z, sizeRef.current.w, sizeRef.current.h) : null;
      if (!at) tag.style.opacity = '0';
      else {
        tag.style.opacity = '1';
        tag.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
      }
    }
  }

  function updateHud(r: Race, dt: number) {
    hudTick.current -= dt;
    if (hudTick.current > 0) return;
    hudTick.current = 1 / 15;
    const n = net.current;
    const me = r.karts[r.me];
    if (!me) return;
    let banner: string | null = null;
    let note: string | null = null;
    let lights = 0;
    if (!n.synced) banner = 'waiting for the host';
    else if (r.time < -COUNTDOWN) banner = COURSES[r.course].name;
    else if (r.time < 0) {
      banner = String(Math.ceil(-r.time));
      lights = COUNTDOWN + 1 - Math.ceil(-r.time);
    } else if (r.time < 0.9) {
      banner = 'go!';
      lights = 4;
    } else if (me.done !== null) banner = clock.current - (doneAt.current ?? 0) < 3 ? 'finish!' : null;
    else if (clock.current - lapBanner.current.at < (lapBanner.current.note ? 3 : 1.8)) {
      banner = lapBanner.current.text;
      note = lapBanner.current.note;
    }
    // the connection to the room dropped: the race carries on here while the seat is got back
    if (banner === null && onlineRef.current?.reconnecting) banner = 'reconnecting…';
    const next: Hud = {
      place: me.place,
      field: r.karts.length,
      lap: lapOf(r, me),
      laps: r.laps,
      coins: me.coins,
      cashReady: me.coins >= CASH_COST && me.done === null,
      item: me.roll > 0 ? ITEMS[Math.floor(clock.current * 12) % ITEMS.length] : me.item,
      ink: me.done === null ? Math.round(Math.min(1, me.ink / 1.5) * 10) / 10 : 0,
      golden: me.goldT > 0,
      fire: me.fireT > 0,
      frozen: me.frozen > 0 && me.done === null,
      uses: me.uses,
      rolling: me.roll > 0,
      trailing: me.trail,
      rear: keys.down('KeyV') && me.done === null,
      boosting: (me.boost > 0 || me.star > 0) && me.done === null && r.time > 0,
      podium: me.done !== null && me.place <= 3,
      time: fmtTime(Math.max(0, me.done ?? r.time)),
      lights,
      banner,
      note,
      wrong: me.wrong > 1.2 && me.done === null,
      results: me.done !== null && clock.current - (doneAt.current ?? 0) >= 3,
      gust: 0,
      swell: 0,
    };
    // the swell just ahead, on the water (see swellWarn)
    if (r.swells.length && me.done === null && me.sunk === 0) {
      let best: ReturnType<typeof swellWarn> = null;
      for (let a = 0; a <= 60; a += 10) {
        const w = swellWarn(r, me.s + a, r.time, me.lap);
        if (w && (!best || w.k > best.k)) best = w;
      }
      if (best) next.swell = best.dir * (best.k >= 1 ? 2 : 1);
      // a low rumble as it starts to roll through
      if (Math.abs(next.swell) === 2 && swellWas.current !== 2) sfx.tone({ freq: 70, to: 55, dur: 0.9, type: 'sawtooth', vol: 0.05 });
    }
    swellWas.current = Math.abs(next.swell);
    // the wind just ahead: the strongest gust warning or blowing within 80 m (see gustWarn)
    if (r.gusts.length && me.done === null && me.sunk === 0) {
      let best: ReturnType<typeof gustWarn> = null;
      for (let a = 0; a <= 80; a += 10) {
        const g = gustWarn(r, me.s + a, r.time, me.lap);
        if (g && (!best || g.a * g.k > best.a * best.k)) best = g;
      }
      if (best) next.gust = best.dir * (best.k >= 1 ? 2 : 1);
      // a whoosh as it starts to blow
      if (Math.abs(next.gust) === 2 && gustWas.current !== 2) sfx.noise(0.7, 0.07);
    }
    gustWas.current = Math.abs(next.gust);
    setHud((h) => (sameHud(h, next) ? h : next));
    const delta = me.coins - lastCoins.current;
    lastCoins.current = me.coins;
    if (delta !== 0 && r.time > 0) setCoinPop({ id: Date.now(), text: delta > 0 ? `+${delta}` : `−${-delta}`, loss: delta < 0 });
    // tips for the moves that need a moment: a kart right beside you, a pocketful of coins
    if (hints.current!.on && me.done === null && r.time > 3) {
      if (me.coins >= CASH_COST) showHint('cash', `Press B or H to cash ${CASH_COST} coins for a boost.`, `Tap your coins to cash ${CASH_COST} for a boost.`);
      const fx = Math.sin(me.h);
      const fz = Math.cos(me.h);
      const beside = r.karts.some((o) => o !== me && o.done === null && Math.abs((o.x - me.x) * fx + (o.z - me.z) * fz) < 2.4 && Math.abs((o.x - me.x) * -fz + (o.z - me.z) * fx) < 3.4);
      if (beside) showHint('slam', 'Press C to slam the kart beside you!', 'Tap bump to slam the kart beside you!');
    }
  }

  const r = race.current!;
  const playing = shell.status === 'playing';
  // the steering pad forgets its fingers when it goes away (a pause), so the next touch steers afresh
  useEffect(() => {
    if (playing) return;
    steerFingers.current.clear();
    steerSide.current = 0;
    steerHalves.current.forEach((el) => el?.classList.remove('is-on'));
  }, [playing]);
  const minimap = useMemo(() => mapPath(r.track), [raceKey]);
  const board = hud.results ? standings(r) : [];
  const press = (code: string) => (e: RPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    keys.press(code);
    if (race.current && race.current.time < 0) tap.current.gas = true;
  };
  const release = (code: string) => () => keys.release(code);
  /** The steering pad: a thumb down on either half steers that way, and sliding it across switches without lifting it. */
  const steerTo = (side: -1 | 0 | 1) => {
    if (side === steerSide.current) return;
    steerSide.current = side;
    steerHalves.current.forEach((el, n) => el?.classList.toggle('is-on', side === (n ? 1 : -1)));
  };
  const steerSync = () => {
    const sides = [...steerFingers.current.values()];
    steerTo(sides.length ? sides[sides.length - 1] : 0);
  };
  const steerAt = (e: RPointerEvent) => {
    const box = steerPad.current?.getBoundingClientRect();
    return box && e.clientX >= box.left + box.width / 2 ? 1 : -1;
  };
  const steerPadProps = {
    onPointerDown: (e: RPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      steerFingers.current.delete(e.pointerId);
      steerFingers.current.set(e.pointerId, steerAt(e));
      steerSync();
      if (race.current && race.current.time < 0) tap.current.gas = true;
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!steerFingers.current.has(e.pointerId)) return;
      const side = steerAt(e);
      if (steerFingers.current.get(e.pointerId) === side) return;
      steerFingers.current.set(e.pointerId, side);
      steerSync();
    },
    onPointerUp: (e: RPointerEvent) => {
      steerFingers.current.delete(e.pointerId);
      steerSync();
    },
    onPointerCancel: (e: RPointerEvent) => {
      steerFingers.current.delete(e.pointerId);
      steerSync();
    },
    onLostPointerCapture: (e: RPointerEvent) => {
      steerFingers.current.delete(e.pointerId);
      steerSync();
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
  const hold = (code: string) => ({ onPointerDown: press(code), onPointerUp: release(code), onPointerCancel: release(code), onLostPointerCapture: release(code), onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() });

  return (
    <>
      <div
        ref={ref}
        className="g-palmdrive-host"
        style={{ background: COURSES[r.course].sky }}
        onPointerDown={() => {
          if (playing && race.current && race.current.time < 0) tap.current.gas = true;
        }}
      />
      {live &&
        r.karts
          .filter((k) => k.idx !== r.me && k.seat >= 0)
          .map((k) => (
            <div
              key={k.idx}
              ref={(el) => {
                if (el) tags.current.set(k.idx, el);
                else tags.current.delete(k.idx);
              }}
              className="g-palmdrive-tag"
              style={{ background: k.color, opacity: 0 }}
            >
              {k.name}
            </div>
          ))}
      {shell.status !== 'ready' && !shell.compact && (
        <div className={`g-palmdrive-hud${shell.touch ? ' is-touch' : ''}${live ? ' is-online' : ''}`}>
          {hud.boosting && <div className="g-palmdrive-speed" aria-hidden="true" />}
          <div className={`g-palmdrive-item${hud.rolling ? ' is-rolling' : ''}${hud.item && !hud.rolling ? ' is-ready' : ''}${hud.trailing ? ' is-trailing' : ''}${hud.golden ? ' is-golden' : ''}${hud.fire ? ' is-fire' : ''}`} aria-label={hud.item && !hud.rolling ? `Holding ${itemName(hud.item)}${hud.trailing ? ' behind you' : ''}` : 'No item'}>
            {hud.item ? <ItemIcon item={hud.item} /> : null}
            {!hud.rolling && hud.uses > 1 && <b>{hud.uses}</b>}
          </div>
          <div className={`g-palmdrive-time${live ? ' is-online' : ''}`}>
            {hud.time}
            {lapNote && (
              <span key={lapNote.id} className="g-palmdrive-lapnote" onAnimationEnd={() => setLapNote(null)}>
                {lapNote.text}
              </span>
            )}
          </div>
          <svg className="g-palmdrive-map" viewBox={minimap.box} aria-hidden="true">
            <path d={minimap.d} className="g-palmdrive-map-road" />
            {minimap.edges.map((e, i) => (
              <path key={`edge${i}`} d={e.d} className={`g-palmdrive-map-edge is-${e.past}`} />
            ))}
            <path d={minimap.d} className="g-palmdrive-map-line" />
            {r.hazards.map(
              (h, i) =>
                (h.kind === 'bus' || h.kind === 'cart' || h.kind === 'launch' || h.kind === 'barge' || h.kind === 'car' || h.kind === 'van') && (
                  <rect
                    key={`bus${i}`}
                    ref={(el) => {
                      if (el) busDots.current.set(i, el);
                      else busDots.current.delete(i);
                    }}
                    x={h.kind === 'bus' || h.kind === 'barge' ? -8 : -6}
                    y={h.kind === 'bus' || h.kind === 'barge' ? -8 : -6}
                    width={h.kind === 'bus' || h.kind === 'barge' ? 16 : 12}
                    height={h.kind === 'bus' || h.kind === 'barge' ? 16 : 12}
                    rx={3}
                    transform={`translate(${-h.x} ${-h.z})`}
                    className={h.kind === 'bus' ? 'g-palmdrive-map-bus' : h.kind === 'cart' ? 'g-palmdrive-map-cart' : h.kind === 'car' || h.kind === 'van' ? 'g-palmdrive-map-car' : `g-palmdrive-map-vessel is-${h.kind}`}
                  />
                ),
            )}
            {r.karts
              .slice()
              .sort((a, b) => (a.idx === r.me ? 1 : 0) - (b.idx === r.me ? 1 : 0))
              .map((k) => (
                <circle
                  key={k.idx}
                  ref={(el) => {
                    if (el) dots.current.set(k.idx, el);
                    else dots.current.delete(k.idx);
                  }}
                  r={k.idx === r.me ? 9 : 6.5}
                  fill={k.color}
                  className={k.idx === r.me ? 'is-me' : undefined}
                />
              ))}
          </svg>
          <div className="g-palmdrive-lap">
            <span>
              Lap <b>{hud.lap}</b>/{hud.laps}
            </span>
            <span className="g-palmdrive-cc">{r.cc}</span>
            {shell.touch ? (
              <button
                type="button"
                tabIndex={-1}
                className={`g-palmdrive-coins is-button${hud.cashReady ? ' is-ready' : ''}`}
                aria-label={`${hud.coins} coins. Tap to cash ${CASH_COST} for a boost`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  tap.current.cash = true;
                }}
              >
                <CoinIcon />
                {hud.coins}
                {coinPop && (
                  <em key={coinPop.id} className={`g-palmdrive-coinpop${coinPop.loss ? ' is-loss' : ''}`} onAnimationEnd={() => setCoinPop(null)}>
                    {coinPop.text}
                  </em>
                )}
              </button>
            ) : (
              <span className={`g-palmdrive-coins${hud.cashReady ? ' is-ready' : ''}`}>
                <CoinIcon />
                {hud.coins}
                {hud.cashReady && <kbd title={`Press B or H to cash ${CASH_COST} coins for a boost`}>B</kbd>}
                {coinPop && (
                  <em key={coinPop.id} className={`g-palmdrive-coinpop${coinPop.loss ? ' is-loss' : ''}`} onAnimationEnd={() => setCoinPop(null)}>
                    {coinPop.text}
                  </em>
                )}
              </span>
            )}
            {r.boat && (
              <span ref={strokeLight} className="g-palmdrive-strokes" title={`Catches in a row: ${POWER_TEN} is a Power Ten`} aria-hidden="true">
                {Array.from({ length: POWER_TEN }, (_, n) => (
                  <i
                    key={n}
                    ref={(el) => {
                      strokePips.current[n] = el;
                    }}
                  />
                ))}
              </span>
            )}
          </div>
          {/* keys share one namespace with the banner and hint beside it, so each gets a prefix */}
          <div key={`place-${hud.place}`} className="g-palmdrive-place">
            <b>{ordinal(hud.place)}</b>
            <span>/ {hud.field}</span>
          </div>
          {hud.lights > 0 && (
            <div className="g-palmdrive-lights" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <i key={i} className={hud.lights === 4 ? 'is-go' : hud.lights >= i ? 'is-on' : undefined} />
              ))}
            </div>
          )}
          {hud.banner && (
            <div key={`banner-${hud.banner}`} className={`g-palmdrive-banner${/^\d$/.test(hud.banner) ? ' is-count' : ''}${hud.banner.length > 12 ? ' is-note' : ''}`}>
              {hud.banner}
            </div>
          )}
          {hud.banner && hud.note && (
            <div key={`note-${hud.note}`} className="g-palmdrive-lapnote">
              {hud.note}
            </div>
          )}
          {hud.wrong && <div className="g-palmdrive-wrong">wrong way</div>}
          <div className="g-palmdrive-badges">
            {hud.gust !== 0 && (
              <div className={`g-palmdrive-gust${Math.abs(hud.gust) === 2 ? ' is-on' : ''}`} aria-label={`Wind from the ${hud.gust > 0 ? 'left' : 'right'}`}>
                {hud.gust < 0 ? '\u2190 ' : ''}wind{hud.gust > 0 ? ' \u2192' : ''}
              </div>
            )}
            {hud.swell !== 0 && (
              <div className={`g-palmdrive-gust is-swell${Math.abs(hud.swell) === 2 ? ' is-on' : ''}`} aria-label={`Swell from the ${hud.swell > 0 ? 'left' : 'right'}`}>
                {hud.swell < 0 ? '\u2190 ' : ''}swell{hud.swell > 0 ? ' \u2192' : ''}
              </div>
            )}
          </div>
          {hud.rear && <div className="g-palmdrive-rear">behind you</div>}
          {hint && (
            <div key={`hint-${hint.id}`} className="g-palmdrive-hint" role="status" onAnimationEnd={() => setHint(null)}>
              {hint.text}
            </div>
          )}
          {hud.podium && <Confetti />}
          {hud.results && (
            <ol className="g-palmdrive-results" aria-label="Race Results">
              {board.map((x, i) => (
                <li key={x.k.idx} className={x.k.idx === r.me ? 'is-me' : undefined}>
                  <span>{i + 1}</span>
                  <i style={{ background: x.k.color }} />
                  <em>{x.k.idx === r.me ? 'you' : x.k.name}</em>
                  <small>{x.estimated ? 'racing' : fmtTime(x.time)}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {flash && <div key={flash.id} className={`g-palmdrive-flash is-${flash.kind}`} onAnimationEnd={() => setFlash(null)} />}
      {hud.frozen && <div className="g-palmdrive-frost" aria-hidden="true" />}
      {hud.ink > 0 && (
        <div className="g-palmdrive-ink" style={{ opacity: hud.ink }} aria-hidden="true">
          {INK_BLOTS.map(([x, y, size], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: `${size}vmin`, height: `${size}vmin` }} />
          ))}
        </div>
      )}
      {/* (gone once the results are up, which they would cover on a phone on its side) */}
      {shell.touch && playing && !hud.results && (
        <div className="g-palmdrive-touch">
          <div className="g-palmdrive-steer" ref={steerPad} {...steerPadProps}>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Steer left"
              ref={(el) => {
                steerHalves.current[0] = el;
              }}
            >
              <Chevron d="M15 6l-6 6 6 6" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Steer right"
              ref={(el) => {
                steerHalves.current[1] = el;
              }}
            >
              <Chevron d="M9 6l6 6-6 6" />
            </button>
          </div>
          <div className="g-palmdrive-actions">
            <div className="g-palmdrive-minis">
              <button
                type="button"
                tabIndex={-1}
                className="g-palmdrive-bump"
                aria-label="Slam the kart beside you"
                onPointerDown={(e) => {
                  e.preventDefault();
                  tap.current.slam = true;
                }}
              >
                bump
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="g-palmdrive-back"
                aria-label="Throw back"
                onPointerDown={(e) => {
                  e.preventDefault();
                  tap.current.back = true;
                }}
              >
                <Chevron d="M6 9l6 6 6-6" />
              </button>
            </div>
            <button type="button" tabIndex={-1} className={`g-palmdrive-use${hud.trailing ? ' is-trailing' : ''}`} aria-label="Use item (hold to keep it behind you)" {...hold('KeyX')}>
              {hud.item && !hud.rolling ? <ItemIcon item={hud.item} size={34} /> : 'item'}
            </button>
            <button type="button" tabIndex={-1} ref={driftBtn} className={`g-palmdrive-drift${r.boat ? ' is-row' : ''}`} aria-label={r.boat ? 'Row: tap as it lights up, on the catch; hold through the bends to carve' : 'Drift'} {...hold('Space')}>
              {r.boat ? 'row' : 'drift'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The track outline for the minimap, north up (map x is -world x). */
function mapPath(t: Track) {
  let d = '';
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= t.n; i += 2) {
    const x = -t.x[i % t.n];
    const y = -t.z[i % t.n];
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 22;
  // where the road drops away, a stroke along that side of it: blue for water, orange for a pit, white dashes out of bounds
  const edges = openRuns(t).map(([side, from, to, past]) => {
    let e = '';
    const n = Math.max(1, Math.ceil((to - from) / 4));
    for (let k = 0; k <= n; k++) {
      const p = pointAt(t, from + ((to - from) * k) / n, side * 17);
      e += `${k ? 'L' : 'M'}${(-p.x).toFixed(1)} ${(-p.z).toFixed(1)}`;
    }
    return { d: e, past: past as Past };
  });
  return { d: `${d}Z`, edges, box: `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2).toFixed(0)}` };
}

/** Where the ink lands on your view: [left %, top %, size in vmin]. */
const INK_BLOTS: [number, number, number][] = [
  [8, 18, 30],
  [62, 10, 26],
  [30, 42, 38],
  [72, 48, 30],
  [4, 62, 24],
  [48, 70, 22],
];

const ITEM_NAMES: Record<Item, string> = {
  banana: 'a banana',
  bananas: 'three bananas',
  green: 'a green shell',
  greens: 'three green shells',
  red: 'a red shell',
  bomb: 'a bomb',
  mushroom: 'a mushroom',
  triple: 'three mushrooms',
  golden: 'a golden mushroom',
  coin: 'a coin',
  star: 'a star',
  mega: 'a mega mushroom',
  bullet: 'a bullet',
  ink: 'ink',
  horn: 'a horn',
  bolt: 'lightning',
  blue: 'a blue shell',
  boomerang: 'a boomerang',
  fire: 'a fire flower',
  ice: 'an ice flower',
  piranha: 'a piranha plant',
  boo: 'a Boo',
  feather: 'a feather',
  cloud: 'a thunder cloud',
  pow: 'a POW block',
};
const itemName = (item: Item) => ITEM_NAMES[item];

const Chevron = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const CONFETTI = ['#ffd23f', '#e53935', '#1e88e5', '#3fae4a', '#ec407a', '#fb8c00', '#ffffff'];
/** A burst of confetti for a podium finish. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        background: CONFETTI[i % CONFETTI.length],
        animationDelay: `${((i * 53) % 90) / 100}s`,
        animationDuration: `${2.2 + ((i * 29) % 15) / 10}s`,
        ['--spin' as string]: `${(i % 2 ? 1 : -1) * (360 + ((i * 71) % 540))}deg`,
        ['--drift' as string]: `${((i * 41) % 80) - 40}px`,
      })),
    [],
  );
  return (
    <div className="g-palmdrive-confetti" aria-hidden="true">
      {pieces.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </div>
  );
}
