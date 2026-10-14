import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelIndex, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type Cam, type HeadPose, type View } from './scene';
import { RANKED_BOTS, createMatch, rankedBoard } from './match';
import { localCtl, type Ctl, type Net } from './ctl';
import { SKINS, colorOf, freshLocker, loadBests, loadLocker, record, saveLocker, shade, skinOf, submitBest, subscribeLocker, type Locker, type Skin } from './skins';
import { HowToPlay, SkinIcon, SkinSheet, createMiniMap, paintMiniMap, type MiniMap } from './hud';
import { TICK, drive, ownerHash, percent, ranking, type Ev } from './world';
import { createOnline } from './session';
import { BPM, JINGLE_CRASH, JINGLE_WIN, Sequencer, hz, midi, type Note } from './music';
import { meta } from './meta';
import './paperio.css';

const MODE = defineSetting('paperio:mode', ['solo', '2p'] as const, 'solo');
const BOTS = defineSetting('paperio:bots', ['4', '8', '12'] as const, '8');
const LEVEL = defineSetting('paperio:level', LEVEL_NAMES, 'normal');
const LENGTH = defineSetting('paperio:length', ['2', '3', '5'] as const, '3');
/** The soundtrack; the shell's mute button silences it with everything else. */
const MUSIC = defineSetting('paperio:music', ['on', 'off'] as const, 'on', { live: true });
/** Online: fill the room with bots up to this many players. */
const FILL = defineSetting('paperio:fill', ['0', '8', '12'] as const, '8');

const modeOptions = [
  ['solo', 'Solo'],
  ['2p', '2 Players'],
] as const;
const botOptions = [
  ['4', '4'],
  ['8', '8'],
  ['12', '12'],
] as const;
/** Solo: the standard field is the ranked one, and says so. */
const soloBotOptions = botOptions.map(([v, label]) =>
  Number(v) === RANKED_BOTS
    ? ([
        v,
        <>
          {label} <em className="g-paperio-ranked">ranked</em>
        </>,
      ] as const)
    : ([v, label] as const),
);
const lengthOptions = [
  ['2', '2 min'],
  ['3', '3 min'],
  ['5', '5 min'],
] as const;
const fillOptions = [
  ['0', 'No Bots'],
  ['8', 'Fill to 8'],
  ['12', 'Fill to 12'],
] as const;

const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} formatScore={fmtPct} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Stage />
    </GameShell>
  );
}

const SERVER_LOCKER = freshLocker();
const useLocker = () => useSyncExternalStore(subscribeLocker, loadLocker, () => SERVER_LOCKER);

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [bots, setBots] = useSetting(BOTS);
  const [level, setLevel] = useSetting(LEVEL);
  const [length, setLength] = useSetting(LENGTH);
  const [bests, setBests] = useState<Record<string, number>>({});
  useEffect(() => setBests(loadBests()), []);
  const best = bests[level];
  const solo = mode === 'solo';
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Bots" value={bots} options={solo ? soloBotOptions : botOptions} onChange={setBots} />
      <Segmented label="Bots Play" value={level} options={levelOptions} onChange={setLevel} />
      {mode === '2p' && <Segmented label="Round" value={length} options={lengthOptions} onChange={setLength} />}
      <Extras />
      {solo && (
        <small className="g-paperio-best">
          {best !== undefined && <>best on {level}: {fmtPct(best)} · </>}
          {rankedBoard(mode, Number(bots), level) ? `ranked on the ${level} board` : `${RANKED_BOTS} bots is the ranked game`}
        </small>
      )}
    </>
  );
}

/** Online room settings: the host picks bots and round length for everyone. */
function OnlineSetup() {
  const online = useOnline();
  const [fill, setFill] = useSetting(FILL);
  const [length, setLength] = useSetting(LENGTH);
  const [level, setLevel] = useSetting(LEVEL);
  const host = online?.isHost ?? true;
  return (
    <>
      {host ? (
        <>
          <Segmented label="Bots" value={fill} options={fillOptions} onChange={setFill} />
          {fill !== '0' && <Segmented label="Bots Play" value={level} options={levelOptions} onChange={setLevel} />}
          <Segmented label="Round" value={length} options={lengthOptions} onChange={setLength} />
          <small className="g-paperio-best">you set the round for everyone</small>
        </>
      ) : (
        <small className="g-paperio-best">the host sets bots and round length</small>
      )}
      <Extras />
    </>
  );
}

/** How to Play and Skins buttons, and the sheets they open over the cards. */
function Extras() {
  const shell = useShell();
  const locker = useLocker();
  const [open, setOpen] = useState<'help' | 'skins' | null>(null);
  const close = () => {
    setOpen(null);
    shell.root.current?.focus({ preventScroll: true });
  };
  const skin = skinOf(locker.pick);
  const [music, setMusic] = useSetting(MUSIC);
  return (
    <div className="g-paperio-extras">
      <button type="button" className="arcade-btn" onClick={() => setOpen('help')}>
        How to Play
      </button>
      <button type="button" className="arcade-btn" onClick={() => setOpen('skins')} aria-label={`Skins, wearing ${skin.name}`}>
        <SkinIcon skin={skin.id} size={18} />
        Skins
        <span className="g-paperio-count">
          {locker.have.length}/{SKINS.length}
        </span>
      </button>
      <button type="button" className="arcade-btn g-paperio-music" aria-pressed={music === 'on'} aria-label={music === 'on' ? 'Music on' : 'Music off'} title={music === 'on' ? 'Music on' : 'Music off'} onClick={() => setMusic(music === 'on' ? 'off' : 'on')}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM19 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          {music !== 'on' && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      {open === 'help' && <HowToPlay root={shell.root.current} touch={shell.touch} onClose={close} />}
      {open === 'skins' && <SkinSheet root={shell.root.current} locker={locker} onPick={(id) => saveLocker({ ...locker, pick: id })} onClose={close} />}
    </div>
  );
}

type Mode = 'idle' | 'solo' | '2p' | 'online';

/** A fresh round for each start, restart and online round; bots playing behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const [mode] = useSetting(MODE);
  const current = useRef<{ key: string; mode: Mode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing' && current.current.mode === 'idle') {
    const m: Mode = online ? 'online' : mode;
    current.current = { key: online ? `online:${online.round}` : m, mode: m };
  } else if (shell.status === 'playing' && online && current.current.key !== `online:${online.round}`) current.current = { key: `online:${online.round}`, mode: 'online' };
  return <Play key={current.current.key} mode={current.current.mode} />;
}

function makeCtl(mode: Mode, opts: { bots: number; level: 0 | 1 | 2; length: number; skin: number; online: Net | null; fill: number }): Ctl {
  const seed = (Math.random() * 2 ** 31) | 0;
  if (mode === 'online' && opts.online) return createOnline(opts.online, { skin: opts.skin, fill: opts.fill, level: opts.level, length: opts.length });
  if (mode === 'idle') return localCtl(createMatch({ seed, humans: [], bots: 9, level: 1, respawn: false, duration: Infinity }), []);
  if (mode === '2p') {
    const p2skin = opts.skin === 1 ? 0 : 1;
    const m = createMatch({
      seed,
      humans: [
        { name: 'player 1', skin: opts.skin, kind: 'local', seat: -1 },
        { name: 'player 2', skin: p2skin, kind: 'local', seat: -1 },
      ],
      bots: opts.bots,
      level: opts.level,
      respawn: true,
      duration: opts.length * 60,
    });
    return localCtl(m, [0, 1]);
  }
  const m = createMatch({ seed, humans: [{ name: 'you', skin: opts.skin, kind: 'local', seat: -1 }], bots: opts.bots, level: opts.level, respawn: false, duration: Infinity });
  return localCtl(m, [0]);
}

// ---------------------------------------------------------------------------------------------------------------

type Row = { id: number; name: string; color: string; pct: number; me: boolean; place: number };
type Mine = { id: number; name: string; color: string; pct: number; place: number; kills: number; alive: boolean; back: number | null };
type Hud = { rows: Row[]; mine: Mine[]; field: number; clock: string | null; hurry: boolean };
type Pop = { id: number; x: number; y: number; text: string; big: boolean };
type Call = { id: number; text: string; sub: string; tone: 'good' | 'bad' | 'gold'; view: number };
type Feed = { id: number; a: string; ac: string; b: string; bc: string; verb: string; at: number };
/** A touch joystick; `at` is when its finger last moved (the newest drag steers). */
type Joy = { id: number; ox: number; oy: number; x: number; y: number; player: number; at: number };

const STREAK = ['', '', 'double cut!', 'triple cut!', 'quad cut!', 'rampage!', 'unstoppable!'];
const deathLine = (cause: string, killer: string | null) =>
  cause === 'self' ? 'you ran into your own trail' : cause === 'head' ? (killer ? `head on with ${killer}` : 'head on') : cause === 'wiped' ? `${killer ?? 'someone'} took all your land` : cause === 'left' ? 'you left' : `${killer ?? 'someone'} cut your trail`;

/** One note of the soundtrack on the arcade synth, `delay` seconds from now. */
function playNote(note: Note, delay: number, stepLen: number) {
  const dur = note.len * stepLen;
  switch (note.voice) {
    case 'lead':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.92, type: 'triangle', vol: 0.06, delay });
      sfx.tone({ freq: hz(note.midi + 12), dur: dur * 0.5, type: 'sine', vol: 0.015, delay });
      break;
    case 'pluck':
      sfx.tone({ freq: hz(note.midi), dur: 0.09, type: 'square', vol: 0.016, delay });
      break;
    case 'bass':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.9, type: 'triangle', vol: 0.15, delay });
      break;
    case 'kick':
      sfx.tone({ freq: 140, to: 44, dur: 0.16, type: 'sine', vol: 0.17, delay });
      break;
    case 'snap':
      sfx.noise(0.05, 0.05, delay);
      break;
    case 'hat':
      sfx.noise(0.02, note.tense ? 0.014 : 0.012, delay);
      break;
    case 'tick':
      sfx.tone({ freq: hz(note.midi), dur: 0.035, type: 'square', vol: 0.01, delay });
      break;
  }
}

function playJingle(names: string[]) {
  const step = 60 / BPM / 4;
  names.forEach((n, i) => sfx.tone({ freq: hz(midi(n)), dur: i === names.length - 1 ? 0.5 : 0.14, type: 'triangle', vol: 0.11, delay: 0.04 + i * step * 1.5 }));
}

function Play({ mode }: { mode: Mode }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const [bots] = useSetting(BOTS);
  const [levelName] = useSetting(LEVEL);
  const [length] = useSetting(LENGTH);
  const [fill] = useSetting(FILL);
  const locker = useLocker();
  const [music] = useSetting(MUSIC);
  const musicRef = useRef(music);
  musicRef.current = music;
  const song = useRef<Sequencer | null>(null);
  song.current ??= new Sequencer(playNote);
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const ctl = useRef<Ctl | null>(null);
  if (!ctl.current) {
    const o = online;
    const net: Net | null = o
      ? {
          seat: o.seat,
          round: o.round,
          isHost: o.isHost,
          players: () => onlineRef.current?.players ?? [],
          send: (d, opts) => onlineRef.current?.send(d, opts),
          onMessage: (fn) => o.onMessage(fn),
          report: (winner) => onlineRef.current?.reportResult(o.round, winner),
        }
      : null;
    ctl.current = makeCtl(mode, { bots: Number(bots), level: levelIndex(levelName), length: Number(length), skin: loadLocker().pick, online: net, fill: Number(fill) });
  }
  const view = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const mini = useRef<MiniMap | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const tags = useRef(new Map<number, HTMLDivElement>());
  const tagAt = useRef({ x: 0, y: 0 });
  const miniHeads = useRef(Array.from({ length: 16 }, () => ({ x: 0, y: 0, color: '', me: false })));
  const joyEls = useRef(new Map<number, HTMLDivElement>());
  const [joys, setJoys] = useState<Joy[]>([]);
  const joyState = useRef(new Map<number, Joy>());
  const mouse = useRef({ x: 0, y: 0, on: false, keyMode: false, mx: 0, my: 0 });
  const [hud, setHud] = useState<Hud>({ rows: [], mine: [], field: 0, clock: null, hurry: false });
  const [pops, setPops] = useState<Pop[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [toast, setToast] = useState<{ id: number; skin: Skin } | null>(null);
  const [no3d, setNo3d] = useState(false);
  const [flash, setFlash] = useState<{ id: number; kind: 'dead' | 'kill' | 'win' } | null>(null);
  const [, setVersion] = useState(0);
  const [banner, setBanner] = useState<{ text: string; count: boolean } | null>(null);
  const st = useRef({
    acc: 0,
    clock: 0,
    frameDt: 0,
    hudIn: 0,
    slowUntil: -1,
    endAt: -1,
    ended: false,
    deathX: 0,
    deathY: 0,
    cams: [] as (Cam & { id: number; zoom: number; lead: number })[],
    shake: [0, 0],
    poses: [] as HeadPose[],
    rankBuf: [] as number[],
    events: [] as Ev[],
    dpr: 1,
    maxDpr: 2,
    ema: 1 / 60,
    slowFor: 0,
    fastFor: 0,
    /** After a drop in resolution: seconds left to see whether it helped, from what and how slow frames were. */
    probe: 0,
    probeFrom: 2,
    probeEma: 0,
    /** The lowest resolution that proved too slow, and how long frames must stay fast before trying it again. */
    badDpr: Infinity,
    retryAfter: 20,
    /** Dropping resolution did not speed frames up: the frame rate is capped (a battery saver), so stop adapting. */
    capped: false,
    bestStreak: 0,
    bestRank: 99,
    deathCause: '',
    deathBy: null as string | null,
    won: false,
    popId: 0,
    version: 0,
    bannerText: '',
    updateMs: 0,
    renderMs: 0,
  });
  const live = mode !== 'idle';
  const twoUp = mode === '2p';
  // what this round was set up with (the settings can change on the Pause card)
  const setup = useRef({ bots: Number(bots), level: levelName });

  // the world view
  useEffect(() => {
    const host = ref.current;
    const c = ctl.current;
    if (!THREE || !host || !c) return;
    const v = buildView(THREE, host, c.w);
    if (!v) {
      setNo3d(true);
      return;
    }
    view.current = v;
    const s = st.current;
    s.maxDpr = Math.min(2, window.devicePixelRatio || 1);
    s.dpr = s.maxDpr;
    v.resize(sizeRef.current.w, sizeRef.current.h, s.dpr);
    setReady(true);
    shellRef.current.invalidate();
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    view.current?.resize(size.w, size.h, st.current.dpr);
  }, [size.w, size.h, ready]);

  useEffect(() => {
    if (!miniRef.current) return;
    mini.current = createMiniMap(miniRef.current);
  }, [live]);

  useEffect(() => () => ctl.current?.dispose(), []);
  // Online rounds never pause, but a hidden page's loop stops all the same: a hidden host tells everyone to hold still.
  useEffect(() => {
    if (mode !== 'online') return;
    const onVisible = () => ctl.current?.online?.setAway(document.hidden);
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [mode]);
  // dev builds only: a handle for automated checks (board hash, heads), never shipped
  useEffect(() => {
    if (!(import.meta as { env?: { DEV?: boolean } }).env?.DEV || mode === 'idle') return;
    const handle = {
      ctl: () => ctl.current,
      hash: () => (ctl.current ? ownerHash(ctl.current.w) : 0),
      /** Board cell to CSS pixels in the first view (dev automation steers the mouse with it). */
      screen: (x: number, y: number) => {
        const cam = st.current.cams[0];
        return cam && view.current ? view.current.project(cam, x, y, 0) : null;
      },
      /** Smoothed milliseconds of game work and of render submission per frame, and the resolution scale. */
      perf: () => ({ update: st.current.updateMs, render: st.current.renderMs, dpr: st.current.dpr, ema: st.current.ema * 1000 }),
      /** Runs our own head straight across another player's trail (through the normal rules). */
      cut(target: number) {
        const c = ctl.current;
        if (!c) return false;
        const w = c.w;
        const me = w.players[c.locals[0]];
        const t = w.players[target];
        if (!me || !t || !t.trailLen) return false;
        const k = t.trail[t.trailLen >> 1];
        const y = Math.floor(k / w.n);
        const x = k - y * w.n;
        me.x = me.px = me.rx = x + 0.5;
        me.y = me.py = me.ry = y - 9.5;
        me.y = y + 9.5;
        drive(w, me, me.x, me.y);
        return !t.alive;
      },
    };
    (window as unknown as { __paperio?: unknown }).__paperio = handle;
    return () => {
      const win = window as unknown as { __paperio?: unknown };
      if (win.__paperio === handle) delete win.__paperio;
    };
  }, [mode]);

  // ---------------------------------------------------------------------------------------------------------------
  // Input

  const playerForPoint = (x: number, y: number) => {
    if (!twoUp) return 0;
    const { w, h } = sizeRef.current;
    return w >= h ? (x > w / 2 ? 1 : 0) : y > h / 2 ? 1 : 0;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!live) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (e.pointerType === 'mouse') {
      mouse.current.on = !twoUp;
      mouse.current.keyMode = false;
      mouse.current.x = x;
      mouse.current.y = y;
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const joy: Joy = { id: e.pointerId, ox: x, oy: y, x, y, player: playerForPoint(x, y), at: performance.now() };
    joyState.current.set(e.pointerId, joy);
    setJoys([...joyState.current.values()]);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!live) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (e.pointerType === 'mouse') {
      const m = mouse.current;
      if (Math.hypot(x - m.mx, y - m.my) > 4) {
        m.keyMode = false;
        m.mx = x;
        m.my = y;
      }
      m.on = !twoUp;
      m.x = x;
      m.y = y;
      return;
    }
    const joy = joyState.current.get(e.pointerId);
    if (!joy) return;
    // the stick's origin trails the finger, so changing direction never needs a long drag back
    const dx = x - joy.ox;
    const dy = y - joy.oy;
    const d = Math.hypot(dx, dy);
    const max = 56;
    if (d > max) {
      joy.ox = x - (dx / d) * max;
      joy.oy = y - (dy / d) * max;
    }
    joy.x = x;
    joy.y = y;
    joy.at = performance.now();
    const el = joyEls.current.get(joy.id);
    if (el) {
      el.style.transform = `translate(${joy.ox}px, ${joy.oy}px)`;
      const knob = el.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translate(${joy.x - joy.ox}px, ${joy.y - joy.oy}px)`;
    }
  };
  const onPointerEnd = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    if (joyState.current.delete(e.pointerId)) setJoys([...joyState.current.values()]);
  };
  useEffect(() => () => joyState.current.clear(), []);

  const PITCH_SIN = Math.sin((62 * Math.PI) / 180);
  function steer(c: Ctl) {
    const w = c.w;
    c.locals.forEach((id, i) => {
      const p = w.players[id];
      if (!p || !p.alive) return;
      let turn = 0;
      if (twoUp) turn = i === 0 ? (keys.down('KeyD') ? 1 : 0) - (keys.down('KeyA') ? 1 : 0) : (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0);
      else turn = (keys.down('right') ? 1 : 0) - (keys.down('left') ? 1 : 0);
      if (turn !== 0) {
        p.turn = turn;
        p.want = NaN;
        mouse.current.keyMode = true;
        return;
      }
      p.turn = 0;
      // the finger that moved last steers (a thumb resting on the glass never locks out the one dragging)
      let joy: Joy | null = null;
      let held = false;
      for (const j of joyState.current.values()) {
        if (j.player !== i) continue;
        held = true;
        if (Math.hypot(j.x - j.ox, j.y - j.oy) > 10 && (!joy || j.at > joy.at)) joy = j;
      }
      if (joy) p.want = Math.atan2((joy.y - joy.oy) / PITCH_SIN, joy.x - joy.ox);
      if (held) return;
      const m = mouse.current;
      const v = view.current;
      const cam = st.current.cams[i];
      if (m.on && !m.keyMode && v && cam) {
        const at = v.unproject(cam, m.x, m.y);
        if (at) {
          const dx = at.x - p.x;
          const dy = at.y - p.y;
          if (dx * dx + dy * dy > 8) p.want = Math.atan2(dy, dx);
        }
        return;
      }
      p.want = NaN;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Events: sounds, callouts, the feed

  const buzz = (ms: number | number[]) => {
    if (!shellRef.current.touch) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not allowed */
    }
  };

  function call(text: string, sub: string, tone: Call['tone'], viewIdx: number) {
    const id = ++st.current.popId;
    setCalls((list) => [...list.filter((c) => c.view !== viewIdx), { id, text, sub, tone, view: viewIdx }]);
  }

  function popAt(localIdx: number, x: number, y: number, text: string, big: boolean) {
    const v = view.current;
    const cam = st.current.cams[localIdx];
    if (!v || !cam) return;
    const at = v.project(cam, x, y - 6, 14);
    if (!at) return;
    const id = ++st.current.popId;
    setPops((list) => [...list.slice(-5), { id, x: at.x, y: at.y, text, big }]);
  }

  function react(c: Ctl, e: Ev) {
    const w = c.w;
    const v = view.current;
    v?.react(w, e);
    if (!live) return;
    const s = st.current;
    const localIdx = 'id' in e ? c.locals.indexOf(e.id) : -1;
    if (e.t === 'capture') {
      if (localIdx < 0 || e.gained <= 0) return;
      const pct = (e.gained / w.arenaCells) * 100;
      if (pct < 0.01) return;
      const big = pct >= 1;
      popAt(localIdx, e.x, e.y, `+${pct >= 10 ? pct.toFixed(0) : pct.toFixed(pct >= 1 ? 1 : 2)}%`, big);
      const steps = Math.min(5, 2 + Math.floor(Math.log2(1 + pct * 4)));
      const notes = [523, 659, 784, 988, 1175, 1319];
      for (let i = 0; i < steps; i++) sfx.tone({ freq: notes[i] * (localIdx ? 0.84 : 1), dur: 0.09 + (i === steps - 1 ? 0.12 : 0), type: 'triangle', vol: 0.12 + Math.min(0.06, pct * 0.01), delay: i * 0.055 });
      if (big) buzz(18);
      return;
    }
    if (e.t === 'spawn') {
      if (localIdx >= 0 && s.clock > 0.5) {
        sfx.play('select', 1.1);
        call('back in!', '', 'good', localIdx);
      }
      return;
    }
    if (e.t === 'win') {
      if (localIdx >= 0) {
        s.won = true;
        if (musicRef.current === 'on') playJingle(JINGLE_WIN);
        else sfx.play('win');
        setFlash({ id: Date.now(), kind: 'win' });
        call('you own the farm!', '100% of the map', 'gold', localIdx);
      }
      return;
    }
    if (e.t !== 'die') return;
    const victim = w.players[e.id];
    const killer = e.by >= 0 ? w.players[e.by] : null;
    const kIdx = killer ? c.locals.indexOf(killer.id) : -1;
    if (victim && e.cause !== 'left') {
      const verb = e.cause === 'self' ? 'crashed' : e.cause === 'head' ? 'bumped' : e.cause === 'wiped' ? 'wiped out' : 'cut';
      const id = ++s.popId;
      const entry: Feed = killer && killer !== victim ? { id, a: killer.name, ac: colorOf(killer.color), b: victim.name, bc: colorOf(victim.color), verb, at: s.clock } : { id, a: victim.name, ac: colorOf(victim.color), b: '', bc: '', verb, at: s.clock };
      setFeed((list) => [...list.slice(-3), entry]);
    }
    if (kIdx >= 0 && killer && victim && killer !== victim) {
      const streak = killer.streak;
      s.bestStreak = Math.max(s.bestStreak, streak);
      const top = streak >= 2 ? STREAK[Math.min(streak, STREAK.length - 1)] : '';
      call(top || `you cut ${victim.name}!`, top ? `you cut ${victim.name}` : e.cause === 'wiped' ? 'took all their land' : '', streak >= 2 ? 'gold' : 'good', kIdx);
      sfx.play('coin', 1 + Math.min(4, streak) * 0.12);
      sfx.play('boom', 1);
      s.shake[kIdx] = 0.55;
      setFlash({ id: Date.now(), kind: 'kill' });
      buzz([20, 30, 20]);
    }
    if (localIdx >= 0) {
      s.shake[localIdx] = 0.8;
      sfx.play('lose', localIdx ? 0.9 : 1);
      buzz(120);
      setFlash({ id: Date.now(), kind: 'dead' });
      const line = deathLine(e.cause, killer && killer !== victim ? killer.name : null);
      if (musicRef.current === 'on' && mode === 'solo') playJingle(JINGLE_CRASH);
      if (mode === 'solo') {
        s.slowUntil = s.clock + 1.25;
        s.endAt = s.clock + 1.45;
        s.deathX = e.x;
        s.deathY = e.y;
        s.deathCause = e.cause;
        s.deathBy = killer && killer !== victim ? killer.name : null;
        call('crashed!', line, 'bad', localIdx);
      } else call('crashed!', line, 'bad', localIdx);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Unlocks

  function checkUnlocks(c: Ctl, final: boolean) {
    const ids = c.locals;
    if (!ids.length) return [] as Skin[];
    const w = c.w;
    const s = st.current;
    const pct = Math.max(...ids.map((id) => w.players[id]?.peak ?? 0));
    const kills = final ? ids.reduce((n, id) => n + (w.players[id]?.kills ?? 0), 0) : 0;
    const { locker: next, fresh } = record(loadLocker(), { pct, streak: s.bestStreak, first: s.bestRank === 1, kills, game: final });
    if (fresh.length || final) saveLocker(next);
    if (fresh.length && !final) {
      setToast({ id: Date.now(), skin: fresh[0] });
      sfx.tone({ freq: 784, dur: 0.1, type: 'triangle', vol: 0.12 });
      sfx.tone({ freq: 1047, dur: 0.1, type: 'triangle', vol: 0.12, delay: 0.1 });
      sfx.tone({ freq: 1568, dur: 0.22, type: 'triangle', vol: 0.12, delay: 0.2 });
    }
    return fresh;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Ends

  function endSolo(c: Ctl) {
    const s = st.current;
    if (s.ended) return;
    s.ended = true;
    const p = c.w.players[c.locals[0]];
    const fresh = checkUnlocks(c, true);
    const peak = round2(p.peak);
    const { level, bots: field } = setup.current;
    // one best per bot level on this device, and a global board for the standard field (never one best for all)
    const isNew = submitBest(level, peak);
    const variant = rankedBoard(mode, field, level);
    const alive = Math.max(0, (p.diedAt >= 0 ? p.diedAt : c.w.time) - p.bornAt);
    const title = s.won ? 'You Own The Farm' : s.deathCause === 'self' ? 'Caught Your Own Trail' : s.deathCause === 'head' ? 'Head On' : s.deathCause === 'wiped' ? 'Wiped Out' : s.deathBy ? `${s.deathBy} Got You` : 'Crashed';
    const bits = [`${p.kills} ${p.kills === 1 ? 'cut' : 'cuts'}`, `${clockText(alive)} alive`, s.bestRank < 99 ? `best rank #${s.bestRank}` : ''].filter(Boolean).join(' · ');
    const unl = fresh.length ? ` New skin: ${fresh.map((f) => f.name).join(', ')}.` : '';
    const ranked = variant ? `Ranked on the ${level} board.` : `Not ranked: ${RANKED_BOTS} bots is the ranked game.`;
    const detail = `${fmtPct(peak)} of the farm at your peak${isNew ? `, a new best on ${level}` : ''}. ${bits}. ${ranked}${unl}`;
    shellRef.current.gameOver(undefined, variant ? { title, detail, board: variant, rank: peak } : { title, detail });
  }

  function endMatch(c: Ctl) {
    const s = st.current;
    if (s.ended) return;
    s.ended = true;
    const w = c.w;
    const fresh = checkUnlocks(c, true);
    const unl = fresh.length ? ` New skin: ${fresh.map((f) => f.name).join(', ')}.` : '';
    if (c.online) {
      c.online.finish();
      const res = c.online.result();
      const meId = c.locals[0];
      const title = res.winner === null ? 'Draw' : res.winner === meId ? 'You Win' : `${w.players[res.winner]?.name ?? 'Someone'} Wins`;
      const myPct = percent(w, meId);
      const place = res.order.indexOf(meId) + 1;
      const cuts = w.players[meId]?.kills ?? 0;
      shellRef.current.gameOver(undefined, { title, detail: `${fmtPct(myPct)} at the buzzer, #${place} on the board with bots, ${cuts} ${cuts === 1 ? 'cut' : 'cuts'}.${unl}` });
      return;
    }
    const [a, b] = c.locals.map((id) => w.players[id]);
    const pa = percent(w, a.id);
    const pb = percent(w, b.id);
    const title = Math.abs(pa - pb) < 0.005 ? 'Draw' : pa > pb ? 'Player 1 Wins' : 'Player 2 Wins';
    if (musicRef.current === 'on') playJingle(JINGLE_WIN);
    else sfx.play('win');
    shellRef.current.gameOver(undefined, { title, detail: `${fmtPct(pa)} to ${fmtPct(pb)} at the buzzer. Cuts: ${a.kills} to ${b.kills}.${unl}` });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The frame

  const pose: HeadPose = { x: 0, y: 0, h: 0, alive: false, out: false };

  function updateCams(c: Ctl, dt: number) {
    const s = st.current;
    const { w: W, h: H } = sizeRef.current;
    const w = c.w;
    const views = Math.max(1, c.locals.length);
    while (s.cams.length < views) s.cams.push({ x: w.c, y: w.c, width: 100, vx: 0, vy: 0, vw: W, vh: H, shakeX: 0, shakeY: 0, id: -1, zoom: 1, lead: 1 });
    s.cams.length = views;
    const side = W >= H;
    // Steering by mouse, the camera keeps the head in the middle: the cursor aims from the head, and a camera that
    // looks ahead turns with the head, so the aim would turn too (a cursor just ahead of the cube spun it round).
    const mouseAim = !twoUp && mouse.current.on && !mouse.current.keyMode;
    for (let i = 0; i < views; i++) {
      const cam = s.cams[i];
      if (views === 1) {
        cam.vx = 0;
        cam.vy = 0;
        cam.vw = W;
        cam.vh = H;
      } else if (side) {
        cam.vx = i * Math.floor(W / 2);
        cam.vy = 0;
        cam.vw = Math.floor(W / 2);
        cam.vh = H;
      } else {
        cam.vx = 0;
        cam.vy = i * Math.floor(H / 2);
        cam.vw = W;
        cam.vh = Math.floor(H / 2);
      }
      const short = Math.max(1, Math.min(cam.vw, cam.vh));
      let shortCells = Math.max(100, Math.min(168, short / 4.75));
      let tx = cam.x;
      let ty = cam.y;
      let zoom = 1;
      const id = c.locals[i];
      if (id === undefined) {
        // attract mode: drift after whoever leads
        const lead = ranking(w, s.rankBuf)[0];
        const p = lead !== undefined ? w.players[lead] : null;
        if (p) {
          c.pose(p, 0, pose);
          tx = pose.x;
          ty = pose.y;
        }
        zoom = 1.45;
      } else {
        const p = w.players[id];
        if (p && p.alive) {
          c.pose(p, s.acc / TICK, pose);
          cam.lead += ((mouseAim ? 0 : 1) - cam.lead) * (1 - Math.exp(-dt / 0.3));
          const ahead = shortCells * 0.1 * cam.lead;
          tx = pose.x + Math.cos(pose.h) * ahead;
          ty = pose.y + Math.sin(pose.h) * ahead;
          zoom = 1 + 1.25 * Math.sqrt(percent(w, id) / 100);
        } else if (mode === 'solo') {
          tx = s.deathX;
          ty = s.deathY;
          zoom = 0.82;
        }
      }
      const k = 1 - Math.exp(-dt * (id === undefined ? 0.8 : mouseAim ? 12 : 7));
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      cam.zoom += (zoom - cam.zoom) * (1 - Math.exp(-dt * 2.2));
      shortCells *= cam.zoom;
      cam.width = shortCells * (cam.vw / short);
      const sh = s.shake[i] ?? 0;
      if (sh > 0) {
        s.shake[i] = Math.max(0, sh - dt * 1.8);
        cam.shakeX = (Math.random() - 0.5) * sh * 2.4;
        cam.shakeY = (Math.random() - 0.5) * sh * 2.4;
      } else cam.shakeX = cam.shakeY = 0;
    }
  }

  function placeTags(c: Ctl) {
    const v = view.current;
    if (!v) return;
    const s = st.current;
    const w = c.w;
    for (let ci = 0; ci < s.cams.length; ci++) {
      const cam = s.cams[ci];
      for (const p of w.players) {
        if (!p) continue;
        const el = tags.current.get(ci * 16 + p.id);
        if (!el) continue;
        if (!p.alive) {
          el.style.opacity = '0';
          continue;
        }
        c.pose(p, s.acc / TICK, pose);
        const at = v.project(cam, pose.x, pose.y - 4.4, 6.4, tagAt.current);
        if (!at || at.x < cam.vx - 40 || at.x > cam.vx + cam.vw + 40 || at.y < cam.vy - 20 || at.y > cam.vy + cam.vh + 20) {
          el.style.opacity = '0';
          continue;
        }
        el.style.opacity = '1';
        el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }

  function updateHud(c: Ctl) {
    const s = st.current;
    const w = c.w;
    const order = ranking(w, s.rankBuf);
    const placeOf = (id: number) => order.indexOf(id) + 1;
    const rows: Row[] = [];
    for (let i = 0; i < Math.min(5, order.length); i++) {
      const p = w.players[order[i]];
      rows.push({ id: p.id, name: p.name, color: colorOf(p.color), pct: percent(w, p.id), me: c.locals.includes(p.id), place: i + 1 });
    }
    for (const id of c.locals) {
      const place = placeOf(id);
      if (place > 5) {
        const p = w.players[id];
        rows.push({ id, name: p.name, color: colorOf(p.color), pct: percent(w, id), me: true, place });
      }
    }
    const mine: Mine[] = c.locals.map((id) => {
      const p = w.players[id];
      const place = placeOf(id);
      // a place only counts once you have grown past your starting patch and nobody is level with you
      if (p.alive && place > 0 && p.peak >= 1.5) {
        const next = order[place];
        const prev = order[place - 2];
        const clear = (next === undefined || w.counts[id + 1] > w.counts[next + 1]) && (prev === undefined || w.counts[prev + 1] > w.counts[id + 1]);
        if (clear) s.bestRank = Math.min(s.bestRank, place);
      }
      const back = p.alive ? null : c.respawnIn(p);
      return { id, name: p.name, color: colorOf(p.color), pct: percent(w, id), place, kills: p.kills, alive: p.alive, back: back === null ? null : Math.ceil(back) };
    });
    let clock: string | null = null;
    let hurry = false;
    if (Number.isFinite(c.duration)) {
      const left = Math.max(0, c.duration - c.elapsed());
      clock = clockText(Math.ceil(left));
      hurry = left <= 10;
    }
    const next: Hud = { rows, mine, field: order.length, clock, hurry };
    setHud((h) => (JSON.stringify(h) === JSON.stringify(next) ? h : next));
    if (live) checkUnlocks(c, false);
  }

  const resize = () => view.current?.resize(sizeRef.current.w, sizeRef.current.h, st.current.dpr);

  /**
   * Adaptive resolution: drop pixels when frames run long, win them back when there is room. A drop that does not
   * make frames faster means the frame rate is capped (a battery saver at 30 fps), not held back by our pixels: it is
   * undone and the round stops adapting. A level that proved too slow is only tried again after a long fast spell,
   * twice as long each time, so a borderline device does not flip back and forth.
   */
  function adapt(dt: number) {
    const s = st.current;
    s.ema += (dt - s.ema) * 0.08;
    if (s.capped) return;
    if (s.probe > 0) {
      s.probe -= dt;
      if (s.probe > 0) return;
      if (s.ema > s.probeEma * 0.9) {
        s.dpr = s.probeFrom;
        s.capped = true;
        resize();
      } else s.badDpr = Math.min(s.badDpr, s.probeFrom);
      s.slowFor = s.fastFor = 0;
      return;
    }
    if (s.ema > 1 / 44) {
      s.slowFor += dt;
      s.fastFor = 0;
    } else if (s.ema < 1 / 57) {
      s.fastFor += dt;
      s.slowFor = 0;
    } else s.slowFor = s.fastFor = 0;
    if (s.slowFor > 1.2 && s.dpr > 1) {
      s.probeFrom = s.dpr;
      s.probeEma = s.ema;
      s.probe = 1.5;
      s.dpr = Math.max(1, s.dpr - 0.25);
      s.slowFor = 0;
      resize();
    } else if (s.dpr < s.maxDpr) {
      const next = Math.min(s.maxDpr, s.dpr + 0.25);
      const retry = next >= s.badDpr - 1e-6;
      if (s.fastFor > (retry ? s.retryAfter : 5)) {
        if (retry) s.retryAfter *= 2;
        s.dpr = next;
        s.fastFor = 0;
        resize();
      }
    }
  }

  useGameLoop(
    (dt) => {
      const c = ctl.current;
      if (!c) return;
      const s = st.current;
      // Nothing moves before the board can be seen: on a phone three.js may still be downloading, and a solo life
      // could be lost blind. (Online rounds keep their own countdown so the room never waits on one page.)
      if (live && mode !== 'online' && !view.current) {
        s.acc = 0;
        return;
      }
      const t0 = performance.now();
      s.clock += dt;
      s.frameDt = dt;
      adapt(dt);
      c.frame?.(dt);
      const scale = s.clock < s.slowUntil ? 0.22 : 1;
      s.acc += dt * scale;
      let steps = 0;
      while (s.acc >= TICK && steps < 5) {
        if (live && !s.ended) steer(c);
        c.tick();
        s.acc -= TICK;
        steps++;
      }
      if (steps === 5) s.acc = Math.min(s.acc, TICK);
      const w = c.w;
      const evs = s.events;
      evs.length = 0;
      for (let i = 0; i < w.events.length; i++) evs.push(w.events[i]);
      w.events.length = 0;
      for (const e of evs) react(c, e);
      const v = view.current;
      if (v) {
        v.sync(w, evs);
        const alpha = s.acc / TICK;
        for (const p of w.players) {
          if (!p || !p.joined) continue;
          c.pose(p, alpha, pose);
          v.head(p, pose, dt);
        }
      }
      updateCams(c, dt);
      placeTags(c);
      if (mini.current && live) {
        const heads = miniHeads.current;
        let count = 0;
        for (const p of w.players) {
          if (!p || !p.alive || count >= heads.length) continue;
          const hd = heads[count++];
          hd.x = p.x;
          hd.y = p.y;
          hd.color = colorOf(p.color);
          hd.me = c.locals.includes(p.id);
        }
        paintMiniMap(mini.current, w, c.locals, s.clock, heads, count);
      }
      s.hudIn -= dt;
      if (s.hudIn <= 0) {
        s.hudIn = 1 / 8;
        updateHud(c);
        const v = c.version?.() ?? 0;
        if (v !== s.version) {
          s.version = v;
          setVersion(v);
        }
        // online: waiting for the host, the countdown, go!
        const left = c.countdown?.() ?? 0;
        const status = c.online?.status() ?? null;
        const text = status ?? (left > 0 ? String(Math.ceil(left)) : c.online && c.elapsed() < 0.8 ? 'go!' : '');
        if (text !== s.bannerText) {
          s.bannerText = text;
          setBanner(text ? { text, count: /^\d$/.test(text) } : null);
          if (/^\d$/.test(text)) sfx.tone({ freq: 440, dur: 0.14, type: 'square', vol: 0.12 });
          else if (text === 'go!') sfx.tone({ freq: 880, dur: 0.4, type: 'square', vol: 0.14 });
        }
      }
      // the soundtrack, with its tension layer while one of our heads is out with a trail
      const audioNow = sfx.clock();
      if (live && !s.ended && musicRef.current === 'on' && audioNow !== null && !(c.countdown?.() ?? 0)) {
        let tense = false;
        for (const id of c.locals) if (w.players[id]?.out) tense = true;
        song.current!.tick(audioNow, tense);
      }
      s.updateMs += (performance.now() - t0 - s.updateMs) * 0.05;
      if (!live || s.ended) return;
      if (mode === 'solo') {
        const p = w.players[c.locals[0]];
        if (s.won && s.endAt < 0) s.endAt = s.clock + 1.6;
        if ((!p.alive || s.won) && s.endAt > 0 && s.clock >= s.endAt) endSolo(c);
      } else if (c.isOver()) endMatch(c);
    },
    () => {
      const v = view.current;
      const t0 = performance.now();
      if (v) v.render(st.current.cams, st.current.frameDt);
      st.current.renderMs += (performance.now() - t0 - st.current.renderMs) * 0.05;
      st.current.frameDt = 0;
    },
    { always: mode === 'idle' },
  );

  // ---------------------------------------------------------------------------------------------------------------

  const c = ctl.current;
  const w = c.w;
  const playing = shell.status === 'playing';
  const views = Math.max(1, c.locals.length);
  return (
    <div className={`g-paperio-stage${twoUp ? ' is-split' : ''}${size.w >= size.h ? ' is-wide' : ' is-tall'}${size.h < 430 ? ' is-short' : ''}`}>
      <div
        ref={ref}
        className="g-paperio-host"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
      />
      {live &&
        Array.from({ length: views }, (_, ci) =>
          w.players
            .filter((p) => p)
            .map((p) => (
              <div
                key={`${ci}:${p.id}`}
                ref={(el) => {
                  if (el) tags.current.set(ci * 16 + p.id, el);
                  else tags.current.delete(ci * 16 + p.id);
                }}
                className={`g-paperio-tag${c.locals.includes(p.id) ? ' is-me' : ''}`}
                style={{ opacity: 0, ['--c' as string]: shade(colorOf(p.color), -0.35) }}
              >
                {p.name}
              </div>
            )),
        )}
      {twoUp && <div className="g-paperio-divider" aria-hidden="true" />}
      {live && shell.status !== 'ready' && !shell.compact && (
        <div className="g-paperio-hud">
          {hud.mine.map((m, i) => (
            <div key={m.id} className={`g-paperio-me is-v${i}${views > 1 ? ' is-split' : ''}`} style={{ ['--c' as string]: m.color }}>
              <b className="g-paperio-pct">{m.pct.toFixed(2)}%</b>
              <span className="g-paperio-meta">
                {m.alive ? (
                  <>
                    <em>#{m.place}</em> of {hud.field}
                  </>
                ) : m.back !== null ? (
                  <>back in {m.back}</>
                ) : (
                  <>out</>
                )}
                <i aria-label={`${m.kills} cuts`}>
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                    <path d="M5 19L19 5M14 5h5v5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {m.kills}
                </i>
              </span>
              {views > 1 && <small>{i === 0 ? (shell.touch ? 'player 1' : 'player 1 · A D') : shell.touch ? 'player 2' : 'player 2 · ← →'}</small>}
            </div>
          ))}
          {hud.clock && <div className={`g-paperio-clock${hud.hurry ? ' is-hurry' : ''}${mode === 'online' ? ' is-online' : ''}`}>{hud.clock}</div>}
          <ol className={`g-paperio-board${views > 1 ? ' is-split' : ''}`} aria-label="Leaderboard">
            {hud.rows.map((r) => (
              <li key={r.id} className={r.me ? 'is-me' : undefined} style={{ ['--c' as string]: r.color, ['--w' as string]: `${Math.max(4, Math.min(100, r.pct * 3))}%` }}>
                <span className="g-paperio-place">{r.place}</span>
                <span className="g-paperio-name">{r.name}</span>
                <span className="g-paperio-val">{r.pct.toFixed(r.pct >= 10 ? 1 : 2)}%</span>
              </li>
            ))}
          </ol>
          <canvas ref={miniRef} className={`g-paperio-mini${views > 1 ? ' is-split' : ''}`} aria-hidden="true" />
          {feed.length > 0 && (
            <ul className="g-paperio-feed" aria-live="polite">
              {feed.map((f) => (
                <li key={f.id}>
                  <b style={{ color: f.ac }}>{f.a}</b> {f.verb}
                  {f.b && (
                    <>
                      {' '}
                      <b style={{ color: f.bc }}>{f.b}</b>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {calls.map((cl) => (
            <div key={cl.id} className={`g-paperio-call is-${cl.tone} is-v${cl.view}${views > 1 ? ' is-split' : ''}`} onAnimationEnd={() => setCalls((list) => list.filter((x) => x.id !== cl.id))}>
              <strong>{cl.text}</strong>
              {cl.sub && <span>{cl.sub}</span>}
            </div>
          ))}
          {pops.map((p) => (
            <div key={p.id} className={`g-paperio-pop${p.big ? ' is-big' : ''}`} style={{ left: p.x, top: p.y }} onAnimationEnd={() => setPops((list) => list.filter((x) => x.id !== p.id))}>
              {p.text}
            </div>
          ))}
          {toast && (
            <div key={toast.id} className="g-paperio-toast" onAnimationEnd={() => setToast(null)}>
              <SkinIcon skin={toast.skin.id} size={34} />
              <span>
                <small>new skin unlocked</small>
                <b>{toast.skin.name}</b>
              </span>
            </div>
          )}
        </div>
      )}
      {banner && (
        <div key={banner.text} className={`g-paperio-banner${banner.count ? ' is-count' : ''}`} aria-live="polite">
          {banner.text}
        </div>
      )}
      {flash && <div key={flash.id} className={`g-paperio-flash is-${flash.kind}`} onAnimationEnd={() => setFlash(null)} />}
      {playing &&
        joys.map((j) => (
          <div
            key={j.id}
            ref={(el) => {
              if (el) joyEls.current.set(j.id, el);
              else joyEls.current.delete(j.id);
            }}
            className="g-paperio-joy"
            style={{ transform: `translate(${j.ox}px, ${j.oy}px)` }}
          >
            <i />
          </div>
        ))}
      {live && playing && shell.touch && hud.mine.length > 0 && st.current.clock < 4 && (
        <div className="g-paperio-hint">{twoUp ? 'each player drags on their half' : 'drag anywhere to steer'}</div>
      )}
      {!ready && <div className="g-paperio-loading">{no3d ? 'this browser can’t draw the farm (it needs WebGL 2)' : 'unfolding the map…'}</div>}
      {mode === 'idle' && <AttractShade locker={locker} />}
    </div>
  );
}

/** A soft paper wash over the attract-mode board so the Start card reads well. */
function AttractShade({ locker }: { locker: Locker }) {
  return <div className="g-paperio-attract" data-skin={locker.pick} aria-hidden="true" />;
}
