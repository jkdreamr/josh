import { useCallback, useEffect, useLayoutEffect, useRef, useState, type InputEvent as ReactInputEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, type GameStatus } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import {
  ATTENTION_MS,
  BOT_CREWS,
  CALLS,
  COUNTDOWN_MS,
  COURSE_METERS,
  MAX_RACERS,
  PASSAGES,
  RIVAL_LABELS,
  RIVAL_LEVELS,
  RIVAL_WPM,
  SEAT_CREWS,
  YOU_CREW,
  accuracy,
  applyProgress,
  botSpeeds,
  catchUp,
  chaseCall,
  createBot,
  createTyping,
  encodeProgress,
  encodeRace,
  finishCall,
  formatClock,
  marginText,
  ordinal,
  parseProgress,
  parseRace,
  pickPassage,
  raceOver,
  rank,
  rivalField,
  rng,
  stepBot,
  strokeRate,
  typeKey,
  walkCall,
  wordAt,
  wpm,
  type Bot,
  type Crew,
  type NetRacer,
  type RivalLevel,
  type Typing,
} from './logic';
import { DRIVE, drawRace, dropPuddles, layoutCourse, type BoatView, type Puddle } from './draw';
import './coxbox.css';

const rivalSetting = defineSetting<RivalLevel>('coxbox:rivals', RIVAL_LEVELS, 'club');
const levelOptions = RIVAL_LEVELS.map((level) => [level, RIVAL_LABELS[level]] as const);
const formatWpm = (n: number) => `${n} wpm`;
const GO_FLASH_MS = 900;
const recentPassages: number[] = [];
/** Rival crew names are lowercase on the water; capitalize them where they start a sentence. */
const capitalize = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
/** Online bots are the rival crews, named in the room like people. */
const BOT_NAMES = BOT_CREWS.map((crew) => capitalize(crew.name));

type Mode = 'idle' | 'solo' | 'online';
type Stage = 'idle' | 'waiting' | 'sit' | 'attention' | 'go' | 'race' | 'finished';

type Lane = {
  key: string;
  seat: number | null;
  name: string;
  crew: Crew;
  you: boolean;
  chars: number;
  errors: number;
  doneMs: number | null;
  out: boolean;
  /** Race time of the last forward move; the host uses it to spot idle racers. */
  lastMoveMs: number;
  bot: Bot | null;
  shown: number;
  phase: number;
  rowing: number;
  crab: number;
  speed: number;
  samples: { t: number; c: number }[];
};

type Race = {
  mode: Mode;
  passage: number | null;
  text: string;
  typing: Typing;
  /** Race clock time of the start signal. */
  goAt: number | null;
  lanes: Lane[];
  you: Lane;
  over: boolean;
  /** The online result was reported and the shell told, once. */
  reported: boolean;
  /** Race clock when the host ended the race; the final standings are re-sent for a few seconds after. */
  endedAt: number | null;
  forceEnd: boolean;
  puddles: Puddle[];
  stage: Stage;
  lastClock: number;
  // online
  seq: number;
  lastSeq: number;
  ticks: number;
  sent: { chars: number; errors: number; done: boolean; at: number };
  // cox
  callUntil: number;
  callPriority: number;
  calledAt: number;
  milestone: number;
  lastHitAt: number;
  lastPlace: number;
  placeCheckAt: number;
};

type Hud = { wpm: string; acc: string; time: string; place: string; field: number };
type Standing = { key: string; name: string; you: boolean; place: number; finished: boolean; status: string };

function lane(key: string, name: string, crew: Crew, you: boolean, seat: number | null, bot: Bot | null = null): Lane {
  return { key, seat, name, crew, you, chars: 0, errors: 0, doneMs: null, out: false, lastMoveMs: 0, bot, shown: 0, phase: Math.random(), rowing: 0, crab: 0, speed: 0, samples: [] };
}

function choosePassage() {
  const index = pickPassage(Math.random, recentPassages);
  recentPassages.push(index);
  if (recentPassages.length > 8) recentPassages.shift();
  return index;
}

type OnlineApi = NonNullable<ReturnType<typeof useOnline>>;

function onlineLanes(online: OnlineApi, level: RivalLevel): Lane[] {
  const people = online.players.map((p) => lane(`seat:${p.seat}`, p.name, p.seat === online.seat ? YOU_CREW : SEAT_CREWS[p.seat % SEAT_CREWS.length], p.seat === online.seat, p.seat));
  // Bots row in the host's race, in their own crews' colors; everyone else sees them through the host's packets.
  const rand = rng(Math.floor(Math.random() * 2 ** 32));
  const speeds = botSpeeds(level, online.bots.length, rand);
  const bots = online.bots.map((b, i) => lane(`seat:${b.seat}`, b.name, BOT_CREWS[i % BOT_CREWS.length], false, b.seat, online.isHost ? createBot(speeds[i], rand) : null));
  return [...people, ...bots].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)).slice(0, MAX_RACERS);
}

function createRace(mode: Mode, online: OnlineApi | null, level: RivalLevel): Race {
  let lanes: Lane[];
  let passage: number | null = choosePassage();
  if (mode === 'online' && online) {
    lanes = onlineLanes(online, level);
    if (!online.isHost) passage = null;
  } else {
    const rand = rng(Math.floor(Math.random() * 2 ** 32));
    lanes = rivalField(level, rand).map(({ crew, wpm: speed }, i) => lane(`bot:${i}`, crew.name, crew, false, null, createBot(speed, rand)));
    lanes.splice(Math.floor(lanes.length / 2), 0, lane('you', 'you', YOU_CREW, true, null));
  }
  const you = lanes.find((l) => l.you) ?? lane('you', 'you', YOU_CREW, true, null);
  const text = passage === null ? '' : PASSAGES[passage];
  return {
    mode,
    passage,
    text,
    typing: createTyping(text),
    goAt: null,
    lanes,
    you,
    over: false,
    reported: false,
    endedAt: null,
    forceEnd: false,
    puddles: [],
    stage: mode === 'idle' ? 'idle' : passage === null ? 'waiting' : 'sit',
    lastClock: 0,
    seq: 0,
    lastSeq: -1,
    ticks: 0,
    sent: { chars: -1, errors: -1, done: false, at: 0 },
    callUntil: 0,
    callPriority: 0,
    calledAt: 0,
    milestone: 0,
    lastHitAt: 0,
    lastPlace: 0,
    placeCheckAt: 0,
  };
}

function sample(l: Lane, now: number) {
  l.samples.push({ t: now, c: l.chars });
  while (l.samples.length > 2 && now - l.samples[0].t > 3500) l.samples.shift();
}

/** Typing speed over the last few seconds, which sets how fast a crew strokes. */
function recentWpm(l: Lane, now: number): number {
  const last = l.samples.at(-1);
  if (!last || now - last.t > 1400 || l.samples.length < 2) return 0;
  const first = l.samples[0];
  return wpm(last.c - first.c, Math.max(1000, now - first.t));
}

/** Race clock in ms that stops while the shell is paused. */
function useRaceClock(status: GameStatus) {
  const pausedAt = useRef<number | null>(null);
  const pausedTotal = useRef(0);
  useEffect(() => {
    const now = performance.now();
    if (status === 'paused' && pausedAt.current === null) pausedAt.current = now;
    if (status !== 'paused' && pausedAt.current !== null) {
      pausedTotal.current += now - pausedAt.current;
      pausedAt.current = null;
    }
  }, [status]);
  return useCallback(() => {
    const now = performance.now();
    return now - pausedTotal.current - (pausedAt.current === null ? 0 : now - pausedAt.current);
  }, []);
}

function Setup() {
  const [level, setLevel] = useSetting(rivalSetting);
  const [lo, hi] = RIVAL_WPM[level];
  return <Segmented label={`Rivals · ${lo} to ${hi} wpm`} value={level} options={levelOptions} onChange={setLevel} />;
}

/** Online, the host picks how fast the bots row (the host's race runs them). */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(rivalSetting);
  if (!online?.isHost || !online.bots.length) return null;
  const [lo, hi] = RIVAL_WPM[level];
  return <Segmented label={`Bots · ${lo} to ${hi} wpm`} value={level} options={levelOptions} onChange={setLevel} />;
}

export default function CoxBox({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={BOT_NAMES} formatScore={formatWpm}>
      <Stage />
    </GameShell>
  );
}

/** Keeps one race mounted from the start signal through the results, and a fresh one for every new round. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: Mode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <RaceView key={current.current.key} mode={current.current.mode} />;
}

function RaceView({ mode }: { mode: Mode }) {
  const shell = useShell();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [level] = useSetting(rivalSetting);
  const clock = useRaceClock(shell.status);
  const race = useRef<Race | null>(null);
  if (!race.current) race.current = createRace(mode, online, level);
  const { ref: canvasRef, size, ctx } = useCanvas();
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const finishTimer = useRef<number | null>(null);
  const [text, setText] = useState(race.current.text);
  const [pos, setPos] = useState(0);
  const [miss, setMiss] = useState(0);
  const [stage, setStage] = useState<Stage>(race.current.stage);
  const [call, setCall] = useState<{ id: number; text: string }>({ id: 0, text: mode === 'idle' ? 'sit ready' : '' });
  const [hud, setHud] = useState<Hud>({ wpm: '--', acc: '--', time: '0:00.0', place: '--', field: race.current.lanes.length });
  const [standings, setStandings] = useState<Standing[]>([]);
  const [focused, setFocused] = useState(false);
  /** On touch screens the keyboard only opens from a tap, so keep the prompt up until the player taps or types. */
  const [engaged, setEngaged] = useState(false);
  const hudAt = useRef(0);
  const live = mode !== 'idle';

  const say = useCallback((line: string, priority = 1, hold = 2600) => {
    const r = race.current!;
    const now = clock();
    if (priority < r.callPriority && now < r.callUntil) return;
    r.callUntil = now + hold;
    r.callPriority = priority;
    r.calledAt = now;
    setCall((c) => ({ id: c.id + 1, text: line }));
  }, [clock]);

  const focusInput = useCallback(() => {
    const r = race.current!;
    if (!live || r.over || r.you.doneMs !== null) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [live]);

  // Countdown begins as soon as the race exists; online guests wait for the host's first packet.
  useEffect(() => {
    const r = race.current!;
    if (mode === 'idle') return;
    if (r.passage !== null && r.goAt === null) r.goAt = clock() + COUNTDOWN_MS;
    focusInput();
    return () => {
      if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
    };
  }, [mode, clock, focusInput]);

  // The shell focuses its root on taps; send typing back to the passage while racing. While paused the
  // root keeps focus, so the shell's keys (Space for Resume or New Game, Esc) work as in every game.
  useEffect(() => {
    const root = shell.root.current;
    if (!root || !live) return;
    const onFocus = (e: FocusEvent) => {
      if (e.target === root && shellRef.current.status === 'playing') focusInput();
    };
    root.addEventListener('focus', onFocus);
    return () => root.removeEventListener('focus', onFocus);
  }, [shell.root, live, focusInput]);

  // Back to the passage on resume. A phone's keyboard closes on pause and only a tap reopens it, so ask again.
  useEffect(() => {
    if (shell.status === 'playing') focusInput();
    if (shell.status === 'paused') setEngaged(false);
  }, [shell.status, focusInput]);

  const finishSolo = useCallback((raceMs: number) => {
    const r = race.current!;
    const ranked = rank(r.lanes);
    const place = ranked.indexOf(r.you) + 1;
    const speed = Math.round(wpm(r.text.length, raceMs));
    const acc = Math.floor(accuracy(r.text.length, r.typing.errors) * 100);
    const runnerUp = ranked[1];
    const winner = ranked[0];
    const gap = runnerUp ? ((r.text.length - runnerUp.chars) / r.text.length) * COURSE_METERS : 0;
    const detail = place === 1
      ? `${acc}% accuracy in ${formatClock(raceMs)}. ${runnerUp ? `${capitalize(runnerUp.name)} was ${marginText(gap)} back.` : ''}`
      : `${acc}% accuracy in ${formatClock(raceMs)}. ${capitalize(winner.name)} won in ${formatClock(winner.doneMs ?? raceMs)}.`;
    finishTimer.current = window.setTimeout(() => {
      shellRef.current.gameOver(speed, { title: place === 1 ? 'You Won' : `${ordinal(place)} Place`, detail: detail.trim() });
    }, 1500);
  }, []);

  /** Ends an online race from the host's final standings, so every player reports the same winner. */
  const endOnline = useCallback((final: NetRacer[]) => {
    const r = race.current!;
    const o = onlineRef.current;
    if (r.reported) return;
    r.reported = true;
    r.over = true;
    const ranked = rank(final);
    const winner = ranked.find((x) => x.doneMs !== null) ?? null;
    o?.reportResult(o.round, winner ? winner.seat : null);
    const mine = o ? ranked.findIndex((x) => x.seat === o.seat) : -1;
    const you = r.you;
    const finished = you.doneMs !== null;
    const speed = finished ? Math.round(wpm(r.text.length, you.doneMs!)) : undefined;
    const acc = Math.floor(accuracy(you.chars, you.errors) * 100);
    const nameOf = (seat: number) => r.lanes.find((l) => l.seat === seat)?.name ?? 'someone';
    const youWon = !!winner && !!o && winner.seat === o.seat;
    const title = youWon ? 'You Won' : finished && mine >= 0 ? `${ordinal(mine + 1)} Place` : 'Did Not Finish';
    const head = finished ? `${acc}% accuracy in ${formatClock(you.doneMs!)}.` : `${Math.round((you.chars / Math.max(1, r.text.length)) * 100)}% of the course rowed.`;
    const tail = winner && !youWon ? ` ${nameOf(winner.seat)} won at ${Math.round(wpm(r.text.length, winner.doneMs!))} wpm.` : '';
    sfx.play(youWon ? 'win' : finished ? 'coin' : 'lose');
    shellRef.current.gameOver(speed, { title, detail: head + tail });
  }, []);

  const type = useCallback((raw: string) => {
    const r = race.current!;
    if (shellRef.current.status !== 'playing' || r.over || r.goAt === null || r.you.doneMs !== null) return;
    const now = clock();
    if (now < r.goAt) return;
    const result = typeKey(r.typing, raw);
    if (result === 'skip') return;
    setEngaged(true);
    const you = r.you;
    const raceMs = now - r.goAt;
    if (result === 'miss') {
      you.errors = r.typing.errors;
      you.crab = 1;
      sfx.tone({ freq: 150, to: 80, dur: 0.09, type: 'sawtooth', vol: 0.08 });
      setMiss((m) => m + 1);
      if (now - r.calledAt > 3500) say(CALLS.crab[r.typing.errors % CALLS.crab.length], 1);
      return;
    }
    you.chars = r.typing.pos;
    you.lastMoveMs = raceMs;
    r.lastHitAt = now;
    sample(you, now);
    setMiss(0);
    setPos(r.typing.pos);
    if (result === 'hit' && r.text[r.typing.pos - 1] === ' ' && r.typing.streak > 0 && r.typing.streak % 10 === 0) {
      say(CALLS.power[(r.typing.streak / 10 - 1) % CALLS.power.length], 2);
      sfx.play('select', 1.2);
    }
    if (result !== 'done') return;
    you.doneMs = raceMs;
    r.stage = 'finished';
    setStage('finished');
    inputRef.current?.blur();
    const place = rank(r.lanes).indexOf(you) + 1;
    say(finishCall(place), 3, 60_000);
    if (r.mode === 'solo') {
      r.over = true;
      sfx.play(place === 1 ? 'win' : 'coin');
      finishSolo(raceMs);
    } else {
      sfx.play('coin');
    }
  }, [clock, say, finishSolo]);

  // Typing arrives through the hidden input (and a phone's keyboard). This is the fallback when the shell root has focus.
  useKeys((_, e) => {
    if (e && !e.repeat && e.key.length === 1) type(e.key);
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    const status = shellRef.current.status;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (status === 'playing') shellRef.current.pause();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      if (!e.repeat) type(e.key);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Backspace') e.preventDefault();
  };

  // Phone keyboards that do not report keys deliver text here; wait until a composed word is committed.
  const drain = (el: HTMLInputElement) => {
    const value = el.value;
    el.value = '';
    for (const ch of value) type(ch);
  };
  const onInput = (e: ReactInputEvent<HTMLInputElement>) => {
    if (!e.nativeEvent.isComposing) drain(e.currentTarget);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Online: the host runs the race and broadcasts it; guests send their own progress to the host.

  const syncLanes = useCallback((rows: NetRacer[]) => {
    const r = race.current!;
    const o = onlineRef.current;
    const now = clock();
    const next: Lane[] = [];
    for (const row of rows) {
      let l = r.lanes.find((x) => x.seat === row.seat);
      if (!l) {
        const you = !!o && row.seat === o.seat;
        const name = o?.players.find((p) => p.seat === row.seat)?.name ?? o?.bots.find((b) => b.seat === row.seat)?.name ?? 'rower';
        l = you ? r.you : lane(`seat:${row.seat}`, name, SEAT_CREWS[row.seat % SEAT_CREWS.length], false, row.seat);
        l.seat = row.seat;
      }
      if (!l.you) {
        if (row.chars > l.chars) {
          l.chars = row.chars;
          sample(l, now);
        }
        if (row.errors > l.errors) l.crab = 1;
        l.errors = row.errors;
        l.doneMs = row.doneMs;
        l.out = row.out;
      }
      next.push(l);
    }
    r.lanes = next;
  }, [clock]);

  const onNet = useCallback((from: number, d: unknown) => {
    const r = race.current!;
    const o = onlineRef.current;
    if (!o) return;
    if (o.isHost) {
      if (from === o.seat || r.goAt === null) return;
      const m = parseProgress(d);
      const l = r.lanes.find((x) => x.seat === from);
      if (!m || m.r !== o.round || !l || l.bot || r.over) return;
      const before = l.chars;
      const errors = l.errors;
      const row = { seat: from, chars: l.chars, errors: l.errors, doneMs: l.doneMs, out: l.out, lastMoveMs: l.lastMoveMs };
      if (!applyProgress(row, m, r.text.length, clock() - r.goAt)) return;
      Object.assign(l, { chars: row.chars, errors: row.errors, doneMs: row.doneMs, lastMoveMs: row.lastMoveMs });
      if (l.chars !== before) sample(l, clock());
      if (l.errors > errors) l.crab = 1;
      return;
    }
    if (from !== 0) return;
    const m = parseRace(d);
    if (!m || m.r !== o.round || m.s <= r.lastSeq) return;
    r.lastSeq = m.s;
    if (r.passage === null) {
      r.passage = m.p;
      r.text = PASSAGES[m.p];
      r.typing = createTyping(r.text);
      r.goAt = clock() + (m.go > 0 ? m.go : -Math.max(0, m.el));
      setText(r.text);
      setPos(0);
    }
    syncLanes(m.rs);
    if (m.end) endOnline(m.rs);
  }, [clock, endOnline, syncLanes]);

  const netTick = useCallback(() => {
    const r = race.current!;
    const o = onlineRef.current;
    if (!o) return;
    r.ticks++;
    const now = clock();
    if (o.isHost) {
      if (r.passage === null || r.goAt === null) return;
      const raceMs = now - r.goAt;
      for (const l of r.lanes) {
        if (!l.you && !l.bot && !l.out && !o.players.some((p) => p.seat === l.seat && p.name === l.name)) l.out = true;
      }
      const rows: NetRacer[] = r.lanes.map((l) => ({ seat: l.seat ?? 0, chars: l.chars, errors: l.errors, doneMs: l.doneMs, out: l.out }));
      const ending = !r.over && raceMs > 0 && (r.forceEnd || raceOver(r.lanes, raceMs));
      if (ending) r.endedAt = now;
      if (r.over && (r.ticks % 10 !== 0 || now - (r.endedAt ?? now) > 10_000)) return;
      o.send(encodeRace({ r: o.round, s: ++r.seq, p: r.passage, go: Math.max(0, r.goAt - now), el: raceMs, end: r.over || ending, rs: rows }), {
        fast: !ending && !r.over && r.ticks % 5 !== 0,
      });
      if (ending) endOnline(rows);
      return;
    }
    if (r.passage === null || r.goAt === null || r.over) return;
    const you = r.you;
    const done = you.doneMs !== null;
    const changed = you.chars !== r.sent.chars || you.errors !== r.sent.errors || done !== r.sent.done;
    if (!changed && now - r.sent.at < 1000) return;
    o.send(encodeProgress({ r: o.round, c: you.chars, e: you.errors, d: you.doneMs }), { fast: changed && !done });
    r.sent = { chars: you.chars, errors: you.errors, done, at: now };
  }, [clock, endOnline]);

  const onlineOn = !!online;
  useEffect(() => {
    if (mode !== 'online' || !onlineOn) return;
    const o = onlineRef.current!;
    const off = o.onMessage(onNet);
    const timer = window.setInterval(netTick, 100);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [mode, onlineOn, onNet, netTick]);

  // ---------------------------------------------------------------------------------------------------------------
  // Frame loop: bots, the start sequence, boat animation, cox calls and the readout.

  const boats = useRef<BoatView[]>([]);
  const speeds = useRef<number[]>([]);

  useGameLoop(
    (frameDt) => {
      const r = race.current!;
      const now = clock();
      // The loop keeps drawing behind the pause card; hold the boats still while the clock is stopped.
      const dt = shellRef.current.status === 'paused' ? 0 : frameDt;
      const len = Math.max(1, r.text.length);
      const raceMs = r.goAt === null ? -1 : now - r.goAt;
      const L = layoutCourse(size.w, size.h, r.lanes.length);

      if (r.goAt !== null && !r.over && r.you.doneMs === null) {
        const next: Stage = raceMs < -ATTENTION_MS ? 'sit' : raceMs < 0 ? 'attention' : raceMs < GO_FLASH_MS ? 'go' : 'race';
        if (next !== r.stage) {
          if (next === 'sit') say(CALLS.sit, 3);
          if (next === 'attention') {
            say(CALLS.attention, 3);
            sfx.play('tick', 1.2);
          }
          if (next === 'go') {
            say(CALLS.go, 3);
            sfx.tone({ freq: 523, dur: 0.45, type: 'square', vol: 0.1 });
            sfx.tone({ freq: 784, dur: 0.45, type: 'square', vol: 0.06 });
            focusInput();
          }
          r.stage = next;
          setStage(next);
        }
      }

      // Bots row on this screen in a solo race, and on the host's online, which tells everyone else where they are.
      if ((r.mode === 'solo' || (r.mode === 'online' && onlineRef.current?.isHost)) && raceMs > 0) {
        const step = Math.min(1, Math.max(0, Math.min(now - r.lastClock, raceMs) / 1000));
        // Bots behind the leading rower push a little harder; once everyone has finished they row their own race.
        const lead = Math.max(-1, ...r.lanes.filter((l) => !l.bot && l.doneMs === null && !l.out).map((l) => l.chars));
        for (const l of r.lanes) {
          if (!l.bot) continue;
          const before = l.bot.chars;
          const behind = lead < 0 ? 0 : (lead - l.bot.chars) / len;
          stepBot(l.bot, r.text, step, raceMs, catchUp(behind));
          l.chars = l.bot.chars;
          l.doneMs = l.bot.doneMs;
          if (l.chars !== before) {
            l.lastMoveMs = raceMs;
            sample(l, now);
          }
        }
      }
      r.lastClock = now;

      // Boats glide toward their typed progress and stroke at a rate set by recent typing speed.
      const views: BoatView[] = [];
      const ranked = rank(r.lanes);
      const t = now / 1000;
      r.lanes.forEach((l, i) => {
        const before = l.shown;
        l.shown += (Math.min(1, l.chars / len) - l.shown) * (1 - Math.exp(-dt * 8));
        const v = dt > 0 ? (l.shown - before) / dt : 0;
        l.speed += (v - l.speed) * (1 - Math.exp(-dt * 3));
        const recent = recentWpm(l, now);
        const moving = l.doneMs === null && !l.out && recent > 4;
        l.rowing += ((moving ? 1 : 0) - l.rowing) * (1 - Math.exp(-dt * (moving ? 6 : 2)));
        const phaseBefore = l.phase;
        if (l.rowing > 0.02) l.phase += (dt * strokeRate(recent || 24)) / 60;
        l.crab = Math.max(0, l.crab - dt * 2.2);
        const place = ranked.indexOf(l) + 1;
        const label = mode === 'idle'
          ? l.name
          : l.doneMs !== null
            ? `${ordinal(place)} · ${formatClock(l.doneMs)}`
            : l.out
              ? `${l.name} · left`
              : `${l.you ? 'you' : l.name} · ${raceMs > 1500 ? Math.round(wpm(l.chars, raceMs)) : 0}`;
        const view: BoatView = { lane: i, crew: l.crew, label, progress: l.shown, phase: l.phase, rowing: l.rowing, crab: l.crab, you: l.you, dim: l.out };
        views.push(view);
        if (l.rowing > 0.5 && Math.floor(phaseBefore - DRIVE) !== Math.floor(l.phase - DRIVE)) dropPuddles(L, view, r.puddles, t);
        if (l.you && l.rowing > 0.5 && Math.floor(phaseBefore) !== Math.floor(l.phase)) sfx.noise(0.07, 0.03);
      });
      boats.current = views;
      speeds.current = r.lanes.map((l) => l.speed);

      // Cox calls for your own boat.
      if (mode !== 'idle' && !r.over && r.you.doneMs === null && raceMs > GO_FLASH_MS) {
        const progress = r.you.chars / len;
        const marks = [0.12, 0.5, 0.75, 0.9];
        const lines = [CALLS.settle, CALLS.half, CALLS.build, CALLS.sprint];
        while (r.milestone < marks.length && progress >= marks[r.milestone]) {
          say(lines[r.milestone], 2);
          r.milestone++;
        }
        if (now - r.lastHitAt > 3200 && now - Math.max(r.goAt! + GO_FLASH_MS, r.calledAt) > 3200) say(CALLS.idle, 1);
        if (now - r.placeCheckAt > 700 && raceMs > 4000 && now - r.calledAt > 2500) {
          r.placeCheckAt = now;
          const place = ranked.indexOf(r.you) + 1;
          if (r.lastPlace && place !== r.lastPlace) {
            const others = ranked.filter((l) => !l.you);
            if (place === 1) say(CALLS.lead, 1);
            else if (place < r.lastPlace) {
              const passed = ranked[place];
              if (passed) say(walkCall(passed.name, ((r.you.shown - passed.shown) * COURSE_METERS)), 1);
            } else {
              const ahead = ranked[place - 2] ?? others[0];
              if (ahead) say(chaseCall(ahead.name, (ahead.shown - r.you.shown) * COURSE_METERS), 1);
            }
          }
          r.lastPlace = place;
        }
      }

      if (now - hudAt.current > 150) {
        hudAt.current = now;
        const you = r.you;
        const elapsed = you.doneMs ?? Math.max(0, raceMs);
        const place = ranked.indexOf(you) + 1;
        setHud({
          wpm: mode === 'idle' || raceMs < 0 ? '--' : String(Math.round(wpm(you.chars, Math.max(elapsed, 1500)))),
          acc: mode === 'idle' || you.chars + you.errors === 0 ? '--' : `${you.errors ? Math.floor(accuracy(you.chars, you.errors) * 100) : 100}%`,
          time: formatClock(mode === 'idle' ? 0 : elapsed),
          place: mode === 'idle' || raceMs < 1500 || (you.chars === 0 && you.doneMs === null) ? '--' : ordinal(place),
          field: r.lanes.length,
        });
        if (r.mode === 'online' && you.doneMs !== null) {
          setStandings(ranked.map((l, i) => ({
            key: l.key,
            name: l.you ? 'you' : l.name,
            you: l.you,
            place: i + 1,
            finished: l.doneMs !== null,
            status: l.doneMs !== null ? `${Math.round(wpm(len, l.doneMs))} wpm` : l.out ? 'left' : `${Math.round((l.chars / len) * 100)}%`,
          })));
        }
      }
    },
    () => {
      const c = ctx();
      if (!c || !size.w || !size.h) return;
      const r = race.current!;
      const L = layoutCourse(size.w, size.h, r.lanes.length);
      drawRace(c, L, boats.current, speeds.current, r.puddles, clock() / 1000);
    },
    { always: true },
  );

  // A phone keyboard covers the bottom of the screen; lift the passage above it while typing.
  const raceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = raceRef.current;
    if (!vv || !el || !shell.touch || !focused) return;
    const fit = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty('--cb-keyboard', covered > 80 ? `${Math.min(covered, el.clientHeight * 0.6)}px` : '0px');
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.removeProperty('--cb-keyboard');
    };
  }, [shell.touch, focused]);

  // Keep the cursor's line in view as the passage scrolls by.
  useLayoutEffect(() => {
    const box = textRef.current;
    const cur = cursorRef.current;
    if (!box || !cur) return;
    const line = cur.offsetHeight || 24;
    const top = cur.offsetTop - box.scrollTop;
    if (top < line * 0.5 || top > box.clientHeight - line * 1.8) box.scrollTop = Math.max(0, cur.offsetTop - line * 1.2);
  }, [pos, text]);

  const [ws, we] = wordAt(text, pos);
  const r = race.current;
  const racing = live && (stage === 'go' || stage === 'race');
  const host = !!online?.isHost;
  const stillRacing = standings.some((s) => !s.finished && s.status !== 'left');
  const mine = standings.find((s) => s.you);

  return (
    <div className="g-coxbox-race" data-stage={stage} ref={raceRef}>
      <div className="g-coxbox-course">
        <canvas ref={canvasRef} aria-label="Race course" />
        {(stage === 'sit' || stage === 'attention' || stage === 'go') && (
          <div className="g-coxbox-start" aria-live="polite">
            <i className={stage === 'go' ? 'is-go' : stage === 'attention' ? 'is-red' : ''} />
            <b>{stage === 'go' ? 'go!' : stage === 'attention' ? 'attention' : 'sit ready'}</b>
          </div>
        )}
        {stage === 'waiting' && (
          <div className="g-coxbox-start">
            <b>{CALLS.wait}</b>
          </div>
        )}
      </div>

      <div className="g-coxbox-bar">
        <div className="g-coxbox-lcd" aria-label="Cox box">
          <span className="is-big">
            <b>{hud.wpm}</b>
            <small>wpm</small>
          </span>
          <span>
            <b>{hud.acc}</b>
            <small>acc</small>
          </span>
          <span>
            <b>{hud.time}</b>
            <small>time</small>
          </span>
          <span>
            <b>{hud.place}</b>
            <small>of {hud.field}</small>
          </span>
        </div>
        <div className="g-coxbox-call" aria-live="polite">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M3 10v4h3l6 4V6L6 10H3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {call.text && <span key={call.id}>{call.text}</span>}
        </div>
      </div>

      <div
        className={`g-coxbox-text${racing ? ' is-live' : ''}`}
        ref={textRef}
        onClick={() => {
          setEngaged(true);
          focusInput();
        }}
      >
        {text ? (
          <p className="g-coxbox-passage">
            <span className="is-done">{text.slice(0, ws)}</span>
            <span className="is-word">
              <span className="is-done">{text.slice(ws, pos)}</span>
              {pos < text.length && (
                <span ref={cursorRef} key={miss ? `miss-${miss}` : 'cur'} className={`is-cur${miss ? ' is-miss' : ''}`}>
                  {text[pos]}
                </span>
              )}
              {text.slice(pos + 1, we)}
            </span>
            {text.slice(we)}
          </p>
        ) : (
          <p className="g-coxbox-passage is-wait">the passage appears when the host starts the race.</p>
        )}
        {live && shell.touch && !engaged && stage !== 'waiting' && stage !== 'finished' && (
          <button type="button" className="g-coxbox-tap">
            tap here to type
          </button>
        )}
        <input
          ref={inputRef}
          className="g-coxbox-input"
          type="text"
          aria-label="Type the passage"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          tabIndex={live ? 0 : -1}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onCompositionEnd={(e) => drain(e.currentTarget)}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>

      {mode === 'online' && stage === 'finished' && !r.over && (
        <div className="g-coxbox-results">
          <h3>{mine ? `you finished ${ordinal(mine.place)}` : 'finished'}</h3>
          <ol>
            {standings.map((s) => (
              <li key={s.key} className={s.you ? 'is-you' : ''}>
                <b>{s.finished ? ordinal(s.place) : ''}</b>
                <span>{s.name}</span>
                <em>{s.status}</em>
              </li>
            ))}
          </ol>
          {host && stillRacing ? (
            <button type="button" className="arcade-btn" onClick={() => { race.current!.forceEnd = true; }}>
              end race
            </button>
          ) : (
            <p>{stillRacing ? 'waiting for the others to finish' : 'final results coming up'}</p>
          )}
        </div>
      )}
    </div>
  );
}
