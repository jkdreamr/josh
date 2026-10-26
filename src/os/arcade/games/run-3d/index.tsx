import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import {
  LEVEL_COUNT,
  ROW_L,
  ZONES,
  botInput,
  botMind,
  cellsGot,
  create,
  endlessTrack,
  finishOrder,
  fmtTime,
  levelName,
  levelTrack,
  ordinal,
  progress,
  raceDetail,
  raceTrack,
  score,
  step,
  type BotMind,
  type Events,
  type Finisher,
  type State,
} from './logic';
import { SEAT_COLORS, buildWorld, disposeWorld, fromU, renderWorld, resizeWorld, syncWorld, uOf, type GhostView, type World } from './scene';
import { meta } from './meta';
import './run-3d.css';

const LEVEL_IDS = Array.from({ length: LEVEL_COUNT }, (_, i) => String(i + 1));
const MODE = defineSetting('run-3d:mode', ['levels', 'endless'] as const, 'levels');
const LEVEL = defineSetting('run-3d:level', LEVEL_IDS, '1');
const BOT_NAMES = ['Nova', 'Quill', 'Vega'] as const;
const BOT_SKILL = [0.55, 0.72, 0.88];
const COUNTDOWN = 3.5;
const SEND_EVERY = 1 / 12;
const INTERP_MS = 120;
const STRAGGLE_MS = 25000;
const RACE_CAP_MS = 180000;

// ---------------------------------------------------------------------------------------------------------------
// Level progress on this device

type Progress = { cleared: number[]; best: Record<string, number>; cells: Record<string, number> };
const PROGRESS_KEY = 'arcade:run-3d:progress';
function loadProgress(): Progress {
  try {
    const p = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}');
    return { cleared: Array.isArray(p.cleared) ? p.cleared.filter((n: unknown) => typeof n === 'number') : [], best: p.best ?? {}, cells: p.cells ?? {} };
  } catch {
    return { cleared: [], best: {}, cells: {} };
  }
}
function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
const isOpen = (p: Progress, i: number) => i === 0 || p.cleared.includes(i - 1) || p.cleared.includes(i);

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} botNames={BOT_NAMES} defaultBots={3}>
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const online = useOnline();
  if (online) return null;
  return (
    <>
      <Segmented label="Mode" value={mode} options={[['levels', 'Levels'], ['endless', 'Endless']]} onChange={setMode} />
      {mode === 'levels' ? <LevelPicker value={level} onChange={setLevel} /> : null}
    </>
  );
}

function LevelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const prog = loadProgress();
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('.is-on');
    const row = rowRef.current;
    if (el && row) row.scrollLeft = el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2;
  }, []);
  const i = Number(value) - 1;
  const best = prog.best[value];
  const cells = prog.cells[value] ?? 0;
  return (
    <div className="arcade-field">
      <span>Level</span>
      <div className="g-run-3d-strip" role="group" aria-label="Level" ref={rowRef}>
        {LEVEL_IDS.map((id, k) => {
          const open = isOpen(prog, k);
          const got = prog.cells[id] ?? 0;
          return (
            <button
              key={id}
              type="button"
              className={`g-run-3d-pick${id === value ? ' is-on' : ''}${k % 5 === 0 ? ' is-zone' : ''}`}
              style={{ ['--zone' as string]: `var(--g-run-3d-z${Math.floor(k / 5)})` }}
              aria-pressed={id === value}
              aria-label={`Level ${k + 1}, ${levelName(k)}${open ? '' : ', locked'}`}
              disabled={!open}
              onClick={() => {
                if (id === value) return;
                sfx.play('select');
                onChange(id);
              }}
            >
              {k + 1}
              {got > 0 ? <i className="g-run-3d-dots" data-n={got} /> : null}
            </button>
          );
        })}
      </div>
      <p className="g-run-3d-about">
        {levelName(i)}
        {best ? `, best ${fmtTime(best)}, ${cells} of 3 cells` : prog.cleared.includes(i) ? '' : ', not cleared yet'}
      </p>
    </div>
  );
}

function Stage() {
  const online = useOnline();
  useFrameScale();
  return <Play key={online ? `on-${online.round}` : 'solo'} />;
}

/** 1 / the phone or iPad frame scale on the shell root, so touch styles keep buttons finger sized on screen. */
function useFrameScale() {
  const { root, touch } = useShell();
  useEffect(() => {
    const el = root.current;
    if (!el || !touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-run-3d-u', u.toFixed(3));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-run-3d-u');
    };
  }, [root, touch]);
}

// ---------------------------------------------------------------------------------------------------------------
// Network

type Sample = { at: number; d: number; u: number; h: number; f: number; t: number };
type Remote = { samples: Sample[]; ms: number; dist: number; gone: boolean };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** One racer as [seat, dist, u, h, flags, finish ms or -1]; flags: 1 falling, 2 finished. */
type Wire = [number, number, number, number, number, number];
const isWire = (w: unknown): w is Wire => Array.isArray(w) && w.length === 6 && w.every(num);
const wire = (seat: number, s: State): Wire => [seat, Math.round(s.dist * 100) / 100, Math.round(uOf(ZONES[s.zi], s.side, s.x) * 100) / 100, Math.round(s.h * 100) / 100, (s.falling ? 1 : 0) | (s.finished ? 2 : 0), s.finished ? Math.round(s.finishT * 1000) : -1];

function push(r: Remote, w: Wire, at: number) {
  const [, d, u, h, f, t] = w;
  r.samples.push({ at, d, u, h, f, t });
  if (r.samples.length > 12) r.samples.shift();
  if (t >= 0) r.ms = t;
  r.dist = Math.max(r.dist, d);
}

/** Where a remote racer was INTERP_MS ago, between the two samples around that moment. */
function sampleAt(r: Remote, now: number): Sample | null {
  const list = r.samples;
  if (!list.length) return null;
  const at = now - INTERP_MS;
  for (let i = list.length - 1; i > 0; i--) {
    const a = list[i - 1];
    const b = list[i];
    if (a.at <= at && at <= b.at) {
      const k = (at - a.at) / Math.max(1, b.at - a.at);
      const jump = Math.abs(b.d - a.d) > 30 || Math.abs(b.u - a.u) > 6;
      if (jump) return b;
      return { at, d: a.d + (b.d - a.d) * k, u: a.u + (b.u - a.u) * k, h: a.h + (b.h - a.h) * k, f: b.f, t: b.t };
    }
  }
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  if (!prev || at < list[0].at) return last;
  // a little past the last sample: keep running at the last speed for up to a quarter second
  const ahead = Math.min(250, at - last.at) / 1000;
  const v = (last.d - prev.d) / Math.max(0.001, (last.at - prev.at) / 1000);
  return { ...last, d: last.d + (last.f & 2 ? 0 : Math.max(0, v) * ahead) };
}

type Bot = { seat: number; name: string; s: State; mind: BotMind };
type Toast = { key: number; text: string };

function Play() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const THREE = useThree();
  const { ref: hostRef, size } = useCanvas<HTMLDivElement>();
  const [mode] = useSetting(MODE);
  const [levelId, setLevelId] = useSetting(LEVEL);
  const world = useRef<World | null>(null);
  const seat = online?.seat ?? 0;
  const accent = online ? SEAT_COLORS[seat % SEAT_COLORS.length] : 0xff8a3d;

  const levelIx = Number(levelId) - 1;
  const solo = !online;
  const isLevel = solo && mode === 'levels';
  const first = useRef<State | null>(null);
  if (!first.current) {
    if (online) first.current = create(raceTrack(online.isHost ? (Math.random() * 2 ** 31) | 0 : 1), { respawn: true, hold: online.isHost ? COUNTDOWN : 99 });
    else first.current = create(isLevel ? levelTrack(levelIx) : endlessTrack((Math.random() * 2 ** 31) | 0));
  }
  const state = useRef<State>(first.current);
  const bots = useRef<Bot[]>([]);
  const remotes = useRef(new Map<number, Remote>());
  const sendT = useRef(0);
  const cfgT = useRef(0);
  const over = useRef(false);
  const overT = useRef(0);
  const firstFinish = useRef(0);
  const raceStart = useRef(0);
  const tap = useRef({ jump: false, held: 0 });
  const lastZone = useRef(-1);
  const countRef = useRef(-1);
  const [count, setCount] = useState<string | null>(online ? '3' : null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ seat: number; name: string }[]>([]);
  const labelRefs = useRef(new Map<number, HTMLDivElement>());
  const barRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef(new Map<number, HTMLElement>());
  const [cells, setCells] = useState(0);
  const [place, setPlace] = useState(1);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const shellRef = useRef(shell);
  shellRef.current = shell;

  const nameOf = (seatNo: number) => {
    const o = onlineRef.current;
    return o?.players.find((p) => p.seat === seatNo)?.name ?? bots.current.find((b) => b.seat === seatNo)?.name ?? o?.bots.find((b) => b.seat === seatNo)?.name ?? 'Racer';
  };

  // the room's other racers, for labels and the progress bar
  const rosterKey = online ? [...online.players.map((p) => `${p.seat}:${p.name}`), ...online.bots.map((b) => `${b.seat}:${b.name}`)].join('|') : '';
  useEffect(() => {
    if (!online) return;
    const list = [...online.players, ...online.bots.filter((b) => !online.players.some((p) => p.seat === b.seat))].filter((p) => p.seat !== online.seat);
    setRoster(list.sort((a, b) => a.seat - b.seat));
    for (const [k, r] of remotes.current) r.gone = !list.some((p) => p.seat === k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  // host: one computer racer per bot seat
  useEffect(() => {
    if (!online?.isHost) return;
    const s = state.current;
    bots.current = online.bots.map((b, i) => ({ seat: b.seat, name: b.name, s: create(s.track, { respawn: true, hold: s.hold }), mind: botMind(BOT_SKILL[i % BOT_SKILL.length], s.track.seed + b.seat * 977) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishRace = (order: Finisher[]) => {
    if (over.current) return;
    over.current = true;
    const o = onlineRef.current;
    const me = o?.seat ?? 0;
    const humans = new Set(o?.players.map((p) => p.seat) ?? [me]);
    const winner = order.find((f) => f.ms >= 0) ?? order[0];
    o?.reportResult(o.round, winner && humans.has(winner.seat) ? winner.seat : null);
    const k = order.findIndex((f) => f.seat === me);
    const people = ['You', ...(o?.players.filter((p) => p.seat !== me).map((p) => p.name) ?? [])];
    const finished = order[k]?.ms >= 0;
    const title = k === 0 ? 'You Won' : finished ? `${ordinal(k + 1)} Place` : 'Did Not Finish';
    sfx.play(k === 0 ? 'win' : 'lose');
    shellRef.current.gameOver(undefined, { title, detail: raceDetail(order, me, nameOf, people) });
  };

  // messages
  useEffect(() => {
    if (!online) return;
    return online.onMessage((from, d) => {
      if (!d || typeof d !== 'object') return;
      const p = d as { game?: string; k?: string; seed?: unknown; go?: unknown; me?: unknown; b?: unknown; order?: unknown };
      if (p.game !== 'run-3d') return;
      const now = performance.now();
      if (p.k === 'cfg' && from === 0 && !online.isHost && num(p.seed) && num(p.go)) {
        const s = state.current;
        if (s.track.seed !== p.seed) state.current = create(raceTrack(p.seed), { respawn: true, hold: Math.max(0, p.go / 1000) });
        else if (s.hold > 0 && Math.abs(s.hold - p.go / 1000) > 0.25) s.hold = Math.max(0.01, p.go / 1000);
      } else if (p.k === 'p') {
        const list = [p.me, ...(from === 0 && Array.isArray(p.b) ? p.b : [])];
        for (const w of list) {
          if (!isWire(w)) continue;
          const who = w[0];
          if (who === online.seat || (w !== p.me && from !== 0) || (w === p.me && who !== from)) continue;
          let r = remotes.current.get(who);
          if (!r) remotes.current.set(who, (r = { samples: [], ms: -1, dist: 0, gone: false }));
          push(r, w, now);
        }
      } else if (p.k === 'end' && from === 0 && Array.isArray(p.order)) {
        const order = (p.order as unknown[]).filter((x): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(num)).map(([seatNo, ms, dist]) => ({ seat: seatNo, ms, dist }));
        if (order.length) finishRace(order);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    if (!THREE || !hostRef.current) return;
    const w = buildWorld(THREE, hostRef.current, accent);
    world.current = w;
    if (!w) return;
    resizeWorld(w, hostRef.current.clientWidth, hostRef.current.clientHeight);
    syncWorld(w, state.current, 0, noEv(), []);
    shell.invalidate();
    return () => {
      world.current = null;
      disposeWorld(w);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE]);

  useEffect(() => {
    const w = world.current;
    if (!w) return;
    resizeWorld(w, size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, shell]);

  useEffect(() => {
    if (!solo) return;
    shell.setScore(isLevel ? null : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endSolo = (s: State) => {
    if (over.current) return;
    over.current = true;
    if (!isLevel) {
      sfx.play('lose');
      shell.gameOver(score(s), { title: 'Lost in Space', detail: `You made it ${score(s)} m, into ${ZONES[s.zi].name}.` });
      return;
    }
    const name = levelName(levelIx);
    if (!s.finished) {
      sfx.play('lose');
      shell.gameOver(undefined, { title: 'Fell Off', detail: `${Math.floor(progress(s) * 100)}% of the way through ${name}.` });
      return;
    }
    const prog = loadProgress();
    const ms = Math.round(s.finishT * 1000);
    const key = String(levelIx + 1);
    const was = prog.best[key];
    const firstClear = !prog.cleared.includes(levelIx);
    if (firstClear) prog.cleared.push(levelIx);
    if (!was || ms < was) prog.best[key] = ms;
    prog.cells[key] = Math.max(prog.cells[key] ?? 0, cellsGot(s));
    saveProgress(prog);
    const next = levelIx + 1 < LEVEL_COUNT ? levelIx + 1 : -1;
    if (firstClear && next >= 0) setLevelId(String(next + 1));
    const tail = next < 0 ? ' That was the last one.' : firstClear ? ` Next up, ${levelName(next)}.` : '';
    shell.gameOver(undefined, { title: was && ms < was ? 'New Best' : 'Level Cleared', detail: `${name} in ${fmtTime(ms)} with ${cellsGot(s)} of 3 cells.${tail}` });
  };

  const sound = (ev: Events) => {
    if (ev.jumped) sfx.play('jump');
    if (ev.cell) sfx.play('coin');
    if (ev.boosted) sfx.play('blip');
    if (ev.fell) sfx.play('hit');
    if (ev.finished) sfx.play('win');
    if (ev.go) sfx.play('select');
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      let s = state.current;
      const o = onlineRef.current;
      const now = performance.now();
      const held = keys.down('up', 'action') || tap.current.held > 0;
      const jump = keys.pressed('up', 'action') || tap.current.jump;
      tap.current.jump = false;
      const dir = over.current ? 0 : keys.axis('left', 'right');
      const ev = step(s, dt, { dir: dir as -1 | 0 | 1, jump: jump && !over.current, hold: held });
      s = state.current;
      sound(ev);
      if (ev.cell) setCells(cellsGot(s));

      // countdown
      const c = s.hold > 0 ? Math.ceil(s.hold - 0.5) : ev.go ? 0 : -1;
      if (s.hold > 0 && s.hold < 60 && c !== countRef.current) {
        countRef.current = c;
        setCount(c > 0 ? String(c) : 'Go');
        if (c > 0) sfx.play('tick');
      } else if (s.hold > 50 && countRef.current !== -2) {
        countRef.current = -2;
        setCount('Wait');
      }
      if (ev.go) {
        raceStart.current = now;
        window.setTimeout(() => setCount(null), 600);
      }
      if (s.hold <= 0 && s.zi !== lastZone.current) {
        lastZone.current = s.zi;
        setToast({ key: now, text: isLevel ? levelName(levelIx) : ZONES[s.zi].name });
      }

      if (solo) {
        if (!isLevel) shell.setScore(score(s));
        if (s.dead || (s.finished && (overT.current += dt) > 1.1)) endSolo(s);
      }

      // bots (host only) and the network
      const views: GhostView[] = [];
      if (o) {
        for (const b of bots.current) {
          const bev = step(b.s, dt, botInput(b.s, b.mind));
          void bev;
        }
        sendT.current += dt;
        if (sendT.current >= SEND_EVERY) {
          sendT.current = 0;
          o.send({ game: 'run-3d', k: 'p', me: wire(o.seat, s), b: o.isHost ? bots.current.map((b) => wire(b.seat, b.s)) : undefined }, { fast: true });
        }
        if (o.isHost) {
          cfgT.current -= dt;
          if (cfgT.current <= 0) {
            cfgT.current = s.hold > 0 ? 0.5 : 2;
            o.send({ game: 'run-3d', k: 'cfg', seed: s.track.seed, go: Math.round(s.hold * 1000) });
          }
        }
        for (const b of bots.current) {
          const z = ZONES[b.s.zi];
          views.push({ seat: b.seat, dist: b.s.dist, u: uOf(z, b.s.side, b.s.x), h: b.s.h, falling: b.s.falling, finished: b.s.finished, vu: b.s.vx, color: SEAT_COLORS[b.seat % 4] });
        }
        for (const [who, r] of remotes.current) {
          if (r.gone || bots.current.some((b) => b.seat === who)) continue;
          const smp = sampleAt(r, now);
          if (!smp) continue;
          const prev = r.samples[r.samples.length - 2];
          const last = r.samples[r.samples.length - 1];
          const vu = prev && last ? (last.u - prev.u) / Math.max(0.03, (last.at - prev.at) / 1000) : 0;
          views.push({ seat: who, dist: smp.d, u: smp.u, h: smp.h, falling: !!(smp.f & 1), finished: !!(smp.f & 2), vu, color: SEAT_COLORS[who % 4] });
        }

        // standings
        const all: Finisher[] = [{ seat: o.seat, ms: s.finished ? Math.round(s.finishT * 1000) : -1, dist: s.dist }];
        for (const b of bots.current) all.push({ seat: b.seat, ms: b.s.finished ? Math.round(b.s.finishT * 1000) : -1, dist: b.s.dist });
        for (const [who, r] of remotes.current) if (!r.gone && !bots.current.some((b) => b.seat === who)) all.push({ seat: who, ms: r.ms, dist: r.dist });
        const order = finishOrder(all);
        const mine = order.findIndex((f) => f.seat === o.seat) + 1;
        if (mine !== place) setPlace(mine);
        if (ev.finished) setDone(`Finished ${ordinal(mine)}`);

        if (o.isHost && !over.current && s.hold <= 0) {
          const humans = all.filter((f) => o.players.some((p) => p.seat === f.seat));
          if (humans.some((f) => f.ms >= 0) && !firstFinish.current) firstFinish.current = now;
          const everyone = humans.every((f) => f.ms >= 0);
          const late = firstFinish.current && now - firstFinish.current > STRAGGLE_MS;
          const capped = raceStart.current && now - raceStart.current > RACE_CAP_MS;
          if (everyone || late || capped) {
            const out = order.map((f) => [f.seat, f.ms, Math.round(f.dist)]);
            const say = () => onlineRef.current?.send({ game: 'run-3d', k: 'end', order: out });
            say();
            window.setTimeout(say, 300);
            window.setTimeout(say, 900);
            finishRace(order);
          }
        }
      }

      if (!w) return;
      syncWorld(w, s, dt, ev, views);
      // labels and the progress bar
      for (const [who, el] of labelRefs.current) {
        const l = w.labels.get(who);
        el.style.opacity = l?.on ? '1' : '0';
        if (l?.on) el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
      if (barRef.current && Number.isFinite(s.track.finish)) {
        const L = s.track.finish * ROW_L;
        const put = (who: number, d: number) => {
          const el = dotRefs.current.get(who);
          if (el) el.style.left = `${Math.min(100, (d / L) * 100).toFixed(2)}%`;
        };
        put(-1, s.dist);
        for (const v of views) put(v.seat, v.dist);
      }
    },
    () => {
      const w = world.current;
      if (w) renderWorld(w);
    },
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (shell.status !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tap.current.jump = true;
    tap.current.held++;
  };
  const onPointerUp = () => {
    tap.current.held = Math.max(0, tap.current.held - 1);
  };

  const track = state.current.track;
  const showBar = Number.isFinite(track.finish);
  void fromU;
  return (
    <div
      className={`g-run-3d-host${shell.touch ? ' is-touch' : ''}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {!THREE && <div className="g-run-3d-loading">Loading</div>}
      {showBar && (
        <div className="g-run-3d-bar" ref={barRef} aria-hidden="true">
          <div className="g-run-3d-track" />
          {online && <span className="g-run-3d-place">{ordinal(place)}</span>}
          {isLevel && (
            <span className="g-run-3d-cells" aria-label={`${cells} of 3 cells`}>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < cells ? 'is-got' : ''} />
              ))}
            </span>
          )}
          {roster.map((r) => (
            <i key={r.seat} className="g-run-3d-dot" style={{ background: hex(SEAT_COLORS[r.seat % 4]) }} ref={(el) => void (el ? dotRefs.current.set(r.seat, el) : dotRefs.current.delete(r.seat))} />
          ))}
          <i className="g-run-3d-dot is-you" style={{ background: hex(accent) }} ref={(el) => void (el ? dotRefs.current.set(-1, el) : dotRefs.current.delete(-1))} />
        </div>
      )}
      {roster.map((r) => (
        <div key={r.seat} className="g-run-3d-label" ref={(el) => void (el ? labelRefs.current.set(r.seat, el) : labelRefs.current.delete(r.seat))}>
          <i style={{ background: hex(SEAT_COLORS[r.seat % 4]) }} />
          {r.name}
        </div>
      ))}
      {toast && !count && (
        <div key={toast.key} className="g-run-3d-zone">
          {toast.text}
        </div>
      )}
      {count && (
        <div key={count} className={`g-run-3d-count${count === 'Wait' ? ' is-wait' : ''}`}>
          {count === 'Wait' ? 'Getting the course' : count}
        </div>
      )}
      {done && <div className="g-run-3d-done">{done}, waiting for the others</div>}
      <TouchControls dpad="x" buttons={[{ key: 'Space', label: 'Jump' }]} />
    </div>
  );
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const noEv = (): Events => ({ jumped: false, landed: false, fell: false, turned: false, zone: false, boosted: false, cell: false, respawned: false, finished: false, go: false, dropped: [] });
