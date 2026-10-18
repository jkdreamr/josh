import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useMuted, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { NO_ASSISTS, type Assists, type Input } from './car.ts';
import { createRaceAudio, type RaceAudio } from './audio.ts';
import { HowToPlay } from './howto.tsx';
import { Hud, fmtLap, fmtSec, type HudApi } from './hud.tsx';
import { P1, P2, SOLO, newDriver, readInput, type Driver as KeyDriver } from './input.ts';
import { meta } from './meta';
import { configOf, endOf, finishOrder, guestState, hostState, parsePacket, winnerOf } from './net.ts';
import { createRace, resetCar, stepRace, world, type Entry, type NetCar, type Race, type RaceEvent, type Runner } from './race.ts';
import { CAM_MODES, createWorld, type CamMode, type GhostPose, type ViewSpec, type World3D } from './scene.ts';
import { DRIVERS, TEAMS } from './teams.ts';
import './grand-prix.css';

type Mode = 'trial' | 'race' | 'split';
const MODE = defineSetting<Mode>('grand-prix:mode', ['trial', 'race', 'split'], 'race');
const LAPS = defineSetting<'3' | '5' | '10'>('grand-prix:laps', ['3', '5', '10'], '3');
type Level = 'easy' | 'medium' | 'hard' | 'legend';
const AI = defineSetting<Level>('grand-prix:ai', ['easy', 'medium', 'hard', 'legend'], 'medium');
const GRID = defineSetting<'pole' | 'mid' | 'back'>('grand-prix:grid', ['pole', 'mid', 'back'], 'mid');
type Aids = 'none' | 'tc' | 'full';
const AIDS = defineSetting<Aids>('grand-prix:aids', ['none', 'tc', 'full'], 'full');
const GEARS = defineSetting<'auto' | 'manual'>('grand-prix:gears', ['auto', 'manual'], 'auto');
const CAM = defineSetting<CamMode>('grand-prix:cam', CAM_MODES, 'chase', { live: true });
const CAM2 = defineSetting<CamMode>('grand-prix:cam2', CAM_MODES, 'chase', { live: true });

/** Share of the racing line's grip each level dares to use: clean laps of about 1:34, 1:29, 1:27 and 1:26. */
const PACE: Record<Level, number> = { easy: 0.7, medium: 0.86, hard: 0.95, legend: 1 };
const modeOptions = [
  ['trial', 'Time Trial'],
  ['race', 'Race'],
  ['split', '2P Split'],
] as const;
const lapOptions = [
  ['3', '3'],
  ['5', '5'],
  ['10', '10'],
] as const;
const aiOptions = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
  ['legend', 'Legend'],
] as const;
const gridOptions = [
  ['pole', 'Pole'],
  ['mid', 'Midfield'],
  ['back', 'Back'],
] as const;
const aidOptions = [
  ['none', 'None'],
  ['tc', 'TC'],
  ['full', 'TC + ABS'],
] as const;
const gearOptions = [
  ['auto', 'Auto'],
  ['manual', 'Manual'],
] as const;

const BOT_NAMES = DRIVERS;

const assistsOf = (aids: Aids, gears: 'auto' | 'manual'): Assists => ({ ...NO_ASSISTS, tc: aids !== 'none', abs: aids === 'full', autoGears: gears === 'auto' });
/** Which board a time trial lap counts for: driving aids off, or on. */
const boardOf = (aids: Aids) => (aids === 'none' ? 'pro' : 'assisted');

// ---------------------------------------------------------------------------------------------------------------
// Personal bests: the time, the delta trace and the ghost of your fastest lap, per board.

type Best = { ms: number; trace: number[]; pose: number[] };
const bestKey = (board: string) => `arcade:grand-prix:best:${board}`;
function loadBest(board: string): Best | null {
  try {
    const raw = window.localStorage.getItem(bestKey(board));
    if (!raw) return null;
    const b = JSON.parse(raw) as Best;
    if (!Number.isFinite(b.ms) || !Array.isArray(b.trace) || !Array.isArray(b.pose)) return null;
    return b;
  } catch {
    return null;
  }
}
function saveBest(board: string, b: Best) {
  try {
    window.localStorage.setItem(bestKey(board), JSON.stringify(b));
  } catch {
    /* storage full or blocked: the lap still counts */
  }
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={fmtLap} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={BOT_NAMES} defaultBots={7}>
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const shell = useShell();
  const [picked, setMode] = useSetting(MODE);
  // split screen needs two sets of keys (or two gamepads), so a touch screen races alone
  const mode = shell.touch && picked === 'split' ? 'race' : picked;
  const [laps, setLaps] = useSetting(LAPS);
  const [ai, setAi] = useSetting(AI);
  const [grid, setGrid] = useSetting(GRID);
  const [aids, setAids] = useSetting(AIDS);
  const [gears, setGears] = useSetting(GEARS);
  const [best, setBest] = useState<number | null>(null);
  useEffect(() => setBest(loadBest(boardOf(aids))?.ms ?? null), [aids]);
  return (
    <div className="g-grand-prix-setup">
      <Segmented label="Mode" value={mode} options={shell.touch ? modeOptions.filter(([v]) => v !== 'split') : modeOptions} onChange={setMode} />
      <Segmented label={mode === 'trial' ? 'Timed Laps' : 'Laps'} value={laps} options={lapOptions} onChange={setLaps} />
      {mode !== 'trial' && <Segmented label="Rivals" value={ai} options={aiOptions} onChange={setAi} />}
      {mode === 'race' && <Segmented label="Start" value={grid} options={gridOptions} onChange={setGrid} />}
      <Segmented label="Assists" value={aids} options={aidOptions} onChange={setAids} />
      {!shell.touch && <Segmented label="Gears" value={gears} options={gearOptions} onChange={setGears} />}
      {mode === 'split' && <small className="g-grand-prix-note">Player 1: WASD, Q/E gears, Space DRS. Player 2: arrows, comma/period gears, right Shift DRS. Gamepads work for both.</small>}
      {mode === 'trial' && best !== null && <small className="g-grand-prix-note">Your best: {fmtLap(best)} ({aids === 'none' ? 'no assists' : 'with assists'})</small>}
      <HelpButton />
    </div>
  );
}

/** Online: the host picks the laps and how quick the bots are for everyone; aids and gears are each driver's own. */
function OnlineSetup() {
  const shell = useShell();
  const online = useOnline();
  const [laps, setLaps] = useSetting(LAPS);
  const [ai, setAi] = useSetting(AI);
  const [aids, setAids] = useSetting(AIDS);
  const [gears, setGears] = useSetting(GEARS);
  const [hostLaps, setHostLaps] = useState<number | null>(null);
  const host = online?.isHost ?? true;
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send(configOf(online.round, Number(laps)));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, laps]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from === 0 && p?.k === 'cfg') setHostLaps(p.laps);
    });
  }, [online]);
  return (
    <div className="g-grand-prix-setup">
      {host ? (
        <>
          <Segmented label="Laps" value={laps} options={lapOptions} onChange={setLaps} />
          <Segmented label="Bots" value={ai} options={aiOptions} onChange={setAi} />
        </>
      ) : (
        <div className="arcade-field">
          <span>Laps</span>
          <div className="g-grand-prix-hostpick">
            <b>{hostLaps ?? '…'}</b>
            <small>picked by the host</small>
          </div>
        </div>
      )}
      <Segmented label="Assists" value={aids} options={aidOptions} onChange={setAids} />
      {!shell.touch && <Segmented label="Gears" value={gears} options={gearOptions} onChange={setGears} />}
      <HelpButton />
    </div>
  );
}

/** Opens How to Play over the card, and hands focus back to the game when it closes. */
function HelpButton() {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="arcade-btn g-grand-prix-help" onClick={() => setOpen(true)}>
        How to Play
      </button>
      {open && (
        <HowToPlay
          root={shell.root.current}
          touch={shell.touch}
          onClose={() => {
            setOpen(false);
            shell.root.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

type StageMode = 'idle' | 'solo' | 'online';

/** A fresh session for each solo round and each online round, and a car lapping behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : `solo:${shell.round}`;
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={current.current.key} mode={current.current.mode} />;
}

type OnlineApi = NonNullable<ReturnType<typeof useOnline>>;
const racersOf = (o: OnlineApi) => [...new Set([...o.players.map((p) => p.seat), ...o.bots.map((b) => b.seat)])].sort((a, b) => a - b);

/** Builds the session a round plays: solo modes from the settings, online from the room (and the host's packet). */
function makeRace(mode: StageMode, s: { mode: Mode; laps: number; ai: Level; grid: string; assists: Assists }, o: OnlineApi | null, sync?: { roster: number[]; teams: number[]; laps: number; go: number }): Race {
  if (mode === 'idle') {
    const r = createRace({ mode: 'trial', laps: 99, entries: [{ name: DRIVERS[0], team: 0, kind: 'ai', seat: -1, pad: -1, pace: 0.96 }], assists: [assistsOf('full', 'auto')] });
    return r;
  }
  if (mode === 'online' && o) {
    const roster = sync?.roster ?? racersOf(o);
    const teams = sync?.teams ?? roster.map((_, k) => k % TEAMS.length);
    const entries: Entry[] = roster.map((seat, k) => {
      const bot = o.bots.find((b) => b.seat === seat);
      const player = o.players.find((p) => p.seat === seat);
      const kind = seat === o.seat ? 'player' : bot && o.isHost ? 'ai' : 'remote';
      return { name: bot?.name ?? player?.name ?? `Driver ${seat + 1}`, team: teams[k] ?? 0, kind, seat, pad: seat === o.seat ? 0 : -1, pace: PACE[s.ai] * (0.985 + ((k * 37) % 10) * 0.0015) };
    });
    const r = createRace({ mode: 'race', laps: sync?.laps ?? s.laps, entries, assists: entries.map((e) => (e.kind === 'player' ? s.assists : assistsOf('full', 'auto'))), lead: 4, hold: 1.2 });
    if (sync) r.time = -sync.go;
    return r;
  }
  if (s.mode === 'trial') {
    return createRace({ mode: 'trial', laps: s.laps, entries: [{ name: 'You', team: 0, kind: 'player', seat: -1, pad: 0 }], assists: [s.assists] });
  }
  // race or split screen: the field is ten teams of two, with the player (or both) placed on the grid
  const split = s.mode === 'split';
  const field = split ? 10 : 20;
  const meSlot = split ? field - 2 : s.grid === 'pole' ? 0 : s.grid === 'back' ? field - 1 : Math.floor(field / 2);
  const humans = split ? [meSlot, meSlot + 1] : [meSlot];
  const humanTeams = split ? [0, 3] : [0];
  // the AI drivers keep their own team's colors: team t races drivers 2t and 2t + 1, minus the seats players took
  const pool: [number, number][] = [];
  for (let t = 0; t < TEAMS.length; t++) for (const d of [2 * t, 2 * t + 1]) if (!humanTeams.includes(t) || d !== 2 * t) pool.push([t, d]);
  let ai = 0;
  const base = PACE[s.ai];
  const entries: Entry[] = Array.from({ length: field }, (_, slot) => {
    const h = humans.indexOf(slot);
    if (h >= 0) return { name: split ? `Player ${h + 1}` : 'You', team: humanTeams[h], kind: 'player', seat: -1, pad: h };
    const k = ai++;
    const [team, d] = pool[k % pool.length];
    // the faster drivers start further up, with a little spread through the field
    return { name: DRIVERS[d], team, kind: 'ai', seat: -1, pad: -1, pace: base * (1 - (k / field) * 0.035) };
  });
  return createRace({ mode: 'race', laps: s.laps, entries, assists: entries.map((e) => (e.kind === 'player' ? s.assists : assistsOf('full', 'auto'))) });
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = mode === 'online' && !!online;
  const [modeSetting] = useSetting(MODE);
  const [laps] = useSetting(LAPS);
  const [ai] = useSetting(AI);
  const [grid] = useSetting(GRID);
  const [aids] = useSetting(AIDS);
  const [gears] = useSetting(GEARS);
  const [cam, setCam] = useSetting(CAM);
  const [cam2, setCam2] = useSetting(CAM2);
  const camRef = useRef([cam, cam2]);
  camRef.current = [cam, cam2];
  const settings = { mode: shell.touch && modeSetting === 'split' ? ('race' as const) : modeSetting, laps: Number(laps), ai, grid, assists: assistsOf(aids, shell.touch ? 'auto' : gears) };
  const split = mode === 'solo' && settings.mode === 'split';
  const { ref, size } = useCanvas<HTMLDivElement>();
  const view = useRef<World3D | null>(null);
  const race = useRef<Race | null>(null);
  const [raceKey, setRaceKey] = useState(0);
  if (!race.current) race.current = live && !online!.isHost ? makeRace('idle', settings, null) : makeRace(mode, settings, online);
  const board = boardOf(aids);
  // your best lap on this board (time, delta trace and ghost), read once per session
  const best = useRef<Best | null | undefined>(undefined);
  const refTrace = useRef<Float32Array | null>(null);
  if (best.current === undefined) {
    best.current = mode === 'solo' && settings.mode === 'trial' ? loadBest(board) : null;
    refTrace.current = best.current ? Float32Array.from(best.current.trace) : null;
  }
  const ghostRec = useRef<number[]>([]);
  const lapsSeen = useRef(0);
  const lastTrace = useRef<Float32Array | null>(null);
  const ghostT = useRef(0);
  const drivers = useRef<KeyDriver[]>([newDriver(), newDriver()]);
  const hudA = useRef<HudApi | null>(null);
  const hudB = useRef<HudApi | null>(null);
  const doneAt = useRef<number | null>(null);
  const over = useRef(false);
  const touchCam = useRef(false);
  const touchReset = useRef(false);
  const audio = useRef<RaceAudio | null>(null);
  const [muted] = useMuted();
  const net = useRef({
    synced: !live || online!.isHost,
    ticks: 0,
    roster: [] as number[],
    teams: [] as number[],
    end: null as { w: number | null; order: [number, number][] } | null,
    endSends: 0,
    reported: false,
  });

  // the 3D world, rebuilt only when three.js arrives or the device class changes
  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = createWorld(THREE, host, race.current!, { lite: shell.touch });
    if (!w) return;
    view.current = w;
    w.resize(host.clientWidth, host.clientHeight);
    shell.invalidate();
    return () => {
      w.dispose();
      view.current = null;
    };
  }, [THREE, shell.touch]);
  useEffect(() => {
    if (view.current && race.current) view.current.setRace(race.current);
  }, [raceKey]);
  // engine and race sound for a session (the car lapping behind the Start card stays quiet)
  useEffect(() => {
    if (mode === 'idle') return;
    const a = createRaceAudio();
    audio.current = a;
    return () => {
      a?.dispose();
      audio.current = null;
    };
  }, [mode]);
  useEffect(() => audio.current?.setMuted(muted), [muted]);
  useEffect(() => {
    if (shell.status !== 'playing') audio.current?.silence();
  }, [shell.status]);
  useEffect(() => {
    view.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, THREE]);

  const players = (r: Race) => r.runners.filter((x) => x.entry.kind === 'player').sort((a, b) => a.entry.pad - b.entry.pad);
  const viewsFor = (r: Race): ViewSpec[] => {
    const ps = mode === 'idle' ? [r.runners[0]] : players(r);
    const W = Math.max(1, size.w);
    const H = Math.max(1, size.h);
    if (ps.length < 2) return [{ runner: ps[0]?.idx ?? 0, cam: mode === 'idle' ? 'chase' : camRef.current[0], back: false, x: 0, y: 0, w: W, h: H }];
    const side = W > H * 1.1;
    return ps.slice(0, 2).map((p, k) => ({
      runner: p.idx,
      cam: camRef.current[k],
      back: false,
      x: side ? Math.round((W / 2) * k) : 0,
      y: side ? 0 : Math.round((H / 2) * k),
      w: side ? Math.round(W / 2) : W,
      h: side ? H : Math.round(H / 2),
    }));
  };
  const backHeld = useRef([false, false]);

  // ---------------------------------------------------------------------------------------------------------------
  // Online: state at 15 Hz, the host relays and calls the result.

  const finishOnline = (order: [number, number][], w: number | null) => {
    const n = net.current;
    const o = onlineRef.current;
    const r = race.current!;
    if (o && !n.reported) {
      n.reported = true;
      o.reportResult(o.round, w);
    }
    if (over.current) return;
    over.current = true;
    const me = r.runners.find((x) => x.entry.kind === 'player');
    const nameOf = (seat: number) => r.runners.find((x) => x.entry.seat === seat)?.entry.name ?? 'Someone';
    const place = me ? order.findIndex(([seat]) => seat === me.entry.seat) + 1 : 0;
    const won = !!me && w === me.entry.seat;
    const podium = order
      .slice(0, 3)
      .map(([seat, ms], k) => `${k + 1}. ${nameOf(seat)}${ms >= 0 ? ` ${fmtLap(ms)}` : ''}`)
      .join('  ');
    sfx.play(won ? 'win' : 'coin');
    shellRef.current.gameOver(undefined, { title: won ? 'You Won' : place ? `P${place}` : 'Race Over', detail: podium + (me?.best ? `. Your best lap ${fmtSec(me.best.time)}.` : '.') });
  };
  const finishRef = useRef(finishOnline);
  finishRef.current = finishOnline;

  const toNet = (rn: Runner): NetCar => ({
    x: rn.car.x,
    y: rn.car.y,
    yaw: rn.car.yaw,
    vx: rn.car.vx,
    vy: rn.car.vy,
    r: rn.car.r,
    steer: rn.car.steer,
    rpm: rn.car.rpm,
    gear: rn.car.gear,
    brake: rn.car.brake,
    drs: rn.car.drs,
    lap: rn.lap,
    dist: rn.dist,
    fin: rn.fin === null ? -1 : rn.fin * 1000,
    best: rn.best ? rn.best.time * 1000 : -1,
  });

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const o0 = onlineRef.current!;
    if (o0.isHost) {
      const r = race.current!;
      n.roster = r.runners.map((x) => x.entry.seat);
      n.teams = r.runners.map((x) => x.entry.team);
    }
    const bySeat = (seat: number) => race.current?.runners.find((x) => x.entry.seat === seat) ?? null;
    const off = o0.onMessage((from, d) => {
      const o = onlineRef.current;
      const p = parsePacket(d);
      if (!o || !p || p.round !== o.round) return;
      const r = race.current!;
      if (p.k === 's') {
        if (!o.isHost) return;
        const rn = bySeat(from);
        if (rn && rn.entry.kind === 'remote') {
          rn.net = p.car;
          rn.netAt = r.time;
        }
      } else if (p.k === 'S') {
        if (o.isHost || from !== 0) return;
        if (!n.synced) {
          if (!p.roster.includes(o.seat)) {
            if (shellRef.current.status === 'playing') shellRef.current.gameOver(undefined, { title: 'Sitting This One Out', detail: 'You Will Race the Next One.' });
            return;
          }
          race.current = makeRace('online', settings, o, { roster: p.roster, teams: p.teams, laps: p.laps, go: p.go });
          n.roster = p.roster;
          n.teams = p.teams;
          n.synced = true;
          setRaceKey((x) => x + 1);
        }
        const rr = race.current!;
        if (rr.time < 0) rr.time = -p.go;
        for (const [seat, car] of p.cars) {
          if (seat === o.seat) continue;
          const rn = rr.runners.find((x) => x.entry.seat === seat);
          if (!rn) continue;
          rn.net = car;
          rn.netAt = rr.time;
        }
      } else if (p.k === 'end') {
        if (from !== 0 || o.isHost || n.end) return;
        n.end = { w: p.w, order: p.order };
        finishRef.current(p.order, p.w);
      }
    });
    const timer = window.setInterval(() => {
      const o = onlineRef.current;
      const r = race.current;
      if (!o || !r || !n.synced) return;
      n.ticks++;
      const me = r.runners.find((x) => x.entry.kind === 'player');
      if (!o.isHost) {
        if (me) o.send(guestState(o.round, toNet(me)), { fast: n.ticks % 5 !== 0 && me.fin === null });
        return;
      }
      // people who left the room drop out of the race
      for (const rn of r.runners) if (rn.entry.kind === 'remote' && !o.players.some((p) => p.seat === rn.entry.seat)) rn.out = true;
      const cars: [number, NetCar][] = r.runners.filter((x) => !x.out && (x.entry.kind !== 'remote' || x.net)).map((x) => [x.entry.seat, x.entry.kind === 'remote' ? x.net! : toNet(x)]);
      o.send(hostState(o.round, -r.time, r.laps, n.roster, n.teams, cars), { fast: n.ticks % 5 !== 0 });
      // the race is called once every person still here has finished, or a minute after the winner
      const people = r.runners.filter((x) => !x.out && x.entry.kind !== 'ai');
      const allIn = people.every((x) => x.fin !== null);
      const timeUp = r.leaderFin !== null && r.time - r.leaderFin > 60;
      if (!n.end && r.time > 0 && (allIn || timeUp)) {
        const order = finishOrder(r.runners.filter((x) => !x.out).map((x) => ({ seat: x.entry.seat, fin: x.fin === null ? -1 : Math.round(x.fin * 1000), dist: x.dist })));
        n.end = { w: winnerOf(order), order };
        finishRef.current(order, n.end.w);
      }
      if (n.end && n.endSends < 4) {
        n.endSends++;
        o.send(endOf(o.round, n.end.w, n.end.order));
      }
    }, 66);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  // ---------------------------------------------------------------------------------------------------------------
  // Events: messages and sounds.

  const react = (r: Race, e: RaceEvent) => {
    const ps = players(r);
    const hudFor = (idx: number) => {
      const k = ps.findIndex((p) => p.idx === idx);
      return k === 0 ? hudA.current : k === 1 ? hudB.current : null;
    };
    switch (e.t) {
      case 'light':
        sfx.tone({ freq: 660, dur: 0.18, type: 'sine', vol: 0.12 });
        break;
      case 'go':
        sfx.tone({ freq: 990, dur: 0.35, type: 'sine', vol: 0.14 });
        for (const p of ps) hudFor(p.idx)?.flash('Lights Out', 'good');
        break;
      case 'limits': {
        const hud = hudFor(e.idx);
        if (!hud) break;
        sfx.tone({ freq: 300, dur: 0.12, type: 'square', vol: 0.06 });
        if (e.penalty) hud.flash('Track Limits: +5s Penalty', 'warn');
        else if (r.mode === 'race' && e.warnings > 0) hud.flash(e.warnings >= 3 ? 'Track Limits: Final Warning' : `Track Limits: Warning ${e.warnings}`, 'warn');
        else hud.flash('Lap Invalidated', 'warn');
        break;
      }
      case 'lap': {
        const hud = hudFor(e.idx);
        if (!hud) break;
        sfx.play('coin', e.overall ? 1.3 : 1);
        hud.flash(`${e.lap.valid ? '' : 'Invalid '}Lap ${fmtSec(e.lap.time)}${e.overall ? ' Fastest' : e.best ? ' Personal Best' : ''}`, e.overall ? 'purple' : e.best ? 'good' : e.lap.valid ? 'info' : 'warn');
        break;
      }
      case 'sector': {
        const hud = hudFor(e.idx);
        if (hud && e.sector < 2) hud.flash(`S${e.sector + 1} ${e.time.toFixed(3)}`, e.overall ? 'purple' : e.best ? 'good' : 'info');
        break;
      }
      case 'wall':
        if (hudFor(e.idx)) audio.current?.impact(e.speed);
        break;
      case 'contact':
        if (hudFor(e.idx) || hudFor(e.other)) audio.current?.impact(e.speed * 0.7);
        break;
      case 'finish': {
        const hud = hudFor(e.idx);
        if (hud) {
          sfx.play(e.place === 1 ? 'win' : 'coin');
          hud.flash(e.place === 1 ? 'Chequered Flag: You Win' : `Chequered Flag: P${e.place}`, e.place === 1 ? 'purple' : 'good');
        }
        break;
      }
      case 'drs':
        if (hudFor(e.idx) && e.open) sfx.tone({ freq: 1300, dur: 0.05, type: 'triangle', vol: 0.06 });
        break;
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The end of a solo session.

  const endSolo = (r: Race) => {
    if (over.current) return;
    over.current = true;
    const ps = players(r);
    if (r.mode === 'trial') {
      const me = ps[0];
      const lap = me.best;
      if (!lap) {
        sfx.play('lose');
        shellRef.current.gameOver(undefined, { title: 'No Valid Lap', detail: 'Keep all four wheels inside the white lines for a whole lap to set a time.' });
        return;
      }
      const ms = Math.round(lap.time * 1000);
      const s = lap.sectors.map((x) => x.toFixed(3)).join(' / ');
      sfx.play('win');
      shellRef.current.gameOver(undefined, { title: fmtLap(ms), detail: `Fastest of ${me.laps.length} laps. Sectors ${s}.`, board, rank: ms });
      return;
    }
    if (ps.length > 1) {
      const order = r.order.filter((i) => ps.some((p) => p.idx === i));
      const first = r.runners[order[0]];
      const pos = (p: Runner) => r.order.indexOf(p.idx) + 1;
      sfx.play('win');
      shellRef.current.gameOver(undefined, {
        title: `${first.entry.name} Wins`,
        detail: ps.map((p) => `${p.entry.name} P${pos(p)}${p.best ? `, best ${fmtSec(p.best.time)}` : ''}`).join('. ') + '.',
      });
      return;
    }
    const me = ps[0];
    const place = r.order.indexOf(me.idx) + 1;
    const winner = r.runners[r.order[0]];
    sfx.play(place === 1 ? 'win' : place <= 3 ? 'coin' : 'lose');
    const time = me.fin !== null ? fmtSec(me.fin) : '';
    const pen = me.penalty ? ` including ${me.penalty}s of penalties` : '';
    const fast = r.fastest ? ` Fastest lap ${r.runners[r.fastest.idx].entry.name} ${fmtSec(r.fastest.time)}.` : '';
    shellRef.current.gameOver(undefined, {
      title: place === 1 ? 'You Won' : `P${place}`,
      detail: `${time ? `Race time ${time}${pen}. ` : ''}${place === 1 ? '' : `${winner.entry.name} won. `}Your best lap ${me.best ? fmtSec(me.best.time) : 'none'}.${fast}`,
    });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The frame loop.

  useGameLoop(
    (dt) => {
      const r = race.current!;
      const v = view.current;
      const n = net.current;
      const ps = players(r);
      const inputs = new Map<number, Input>();
      if (mode !== 'idle' && n.synced) {
        ps.forEach((p, k) => {
          const bind = ps.length > 1 ? (k === 0 ? P1 : P2) : SOLO;
          const { input, extra } = readInput(drivers.current[k], keys, bind, k, Math.abs(p.car.vx), dt);
          if (k === 0 && touchCam.current) {
            extra.cam = true;
            touchCam.current = false;
          }
          if (k === 0 && touchReset.current) {
            extra.reset = true;
            touchReset.current = false;
          }
          inputs.set(p.idx, input);
          if (extra.cam) {
            const cur = camRef.current[k];
            const next = CAM_MODES[(CAM_MODES.indexOf(cur) + 1) % CAM_MODES.length];
            (k === 0 ? setCam : setCam2)(next);
            camRef.current[k] = next;
          }
          backHeld.current[k] = extra.back;
          if (extra.reset && p.fin === null) resetCar(r, p);
        });
      }
      if (n.synced) stepRace(r, dt, inputs);

      for (const e of r.events.splice(0)) if (mode !== 'idle') react(r, e);

      // laps just completed in a time trial: keep a new personal best (its trace and ghost)
      if (mode === 'solo' && r.mode === 'trial') {
        const me = ps[0];
        const done = me.laps.length;
        if (done > lapsSeen.current) {
          lapsSeen.current = done;
          const lap = me.laps[done - 1];
          const ms = Math.round(lap.time * 1000);
          if (lap.valid && (!best.current || ms < best.current.ms)) {
            const trace = Array.from(lastTrace.current ?? [], (t) => Math.round(t * 1000) / 1000);
            best.current = { ms, trace, pose: ghostRec.current.slice() };
            saveBest(board, best.current);
            refTrace.current = Float32Array.from(trace);
          }
          ghostRec.current = [];
        }
        lastTrace.current = me.trace.slice();
      }

      // ghost: record your laps, replay your best
      let ghost: GhostPose = null;
      if (mode === 'solo' && r.mode === 'trial') {
        const me = ps[0];
        const lapT = r.time - me.lapStart;
        ghostT.current += dt;
        if (me.flying && ghostT.current >= 0.1) {
          ghostT.current = 0;
          ghostRec.current.push(Math.round(lapT * 1000), Math.round(me.car.x * 100) / 100, Math.round(me.car.y * 100) / 100, Math.round(me.car.yaw * 1000) / 1000);
        }
        const b = best.current;
        if (b && me.flying && b.pose.length >= 8) {
          const ms = lapT * 1000;
          let k = 0;
          while (k + 4 < b.pose.length && b.pose[k + 4] < ms) k += 4;
          if (k + 4 < b.pose.length) {
            const t0 = b.pose[k];
            const t1 = b.pose[k + 4];
            const f = Math.max(0, Math.min(1, (ms - t0) / Math.max(1, t1 - t0)));
            let dyaw = b.pose[k + 7] - b.pose[k + 3];
            dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
            ghost = { x: b.pose[k + 1] + (b.pose[k + 5] - b.pose[k + 1]) * f, y: b.pose[k + 2] + (b.pose[k + 6] - b.pose[k + 2]) * f, yaw: b.pose[k + 3] + dyaw * f };
          }
        }
      }

      // sessions end: all timed laps done, or the chequered flag (a few seconds of cool-down first)
      if (mode === 'solo' && !over.current) {
        const finished = r.mode === 'trial' ? ps[0].laps.length >= r.laps : ps.every((p) => p.fin !== null) || (ps.some((p) => p.fin !== null) && r.leaderFin !== null && r.time - r.leaderFin > 45);
        if (finished && doneAt.current === null) doneAt.current = r.time;
        if (doneAt.current !== null && r.time - doneAt.current > (r.mode === 'trial' ? 1.2 : 3)) endSolo(r);
      }

      const views = viewsFor(r).map((vw, k) => ({ ...vw, back: backHeld.current[k] }));
      if (v) v.frame(r, dt, views, ghost);
      if (mode !== 'idle' && n.synced && views[0]) {
        audio.current?.update(r, views[0].runner, views[0].cam, dt);
      }
      if (mode !== 'idle') ps.forEach((p, k) => (k === 0 ? hudA.current : hudB.current)?.update(r, p.idx, r.mode === 'trial' ? refTrace.current : null));
    },
    () => {
      const v = view.current;
      const r = race.current;
      if (!v || !r || v.lost()) return;
      v.render(viewsFor(r).map((vw, k) => ({ ...vw, back: backHeld.current[k] })));
    },
    { always: mode === 'idle' },
  );
  const r = race.current!;
  const ps = mode === 'idle' ? [] : players(r);
  const wide = size.w > size.h * 1.1;
  const { c } = world();
  return (
    <>
      <div ref={ref} className="g-grand-prix-host" />
      {mode !== 'idle' && (shell.status === 'playing' || shell.status === 'paused') && (
        <div className={`g-grand-prix-huds${ps.length > 1 ? (wide ? ' is-side' : ' is-stack') : ''}`}>
          {ps.slice(0, 2).map((p, k) => (
            <div key={p.idx} className="g-grand-prix-hudslot">
              <Hud circuit={c} split={ps.length > 1} tower={r.mode === 'race'} touch={shell.touch} apiRef={k === 0 ? hudA : hudB} />
            </div>
          ))}
        </div>
      )}
      {mode !== 'idle' && shell.touch && shell.status === 'playing' && (
        <div className="g-grand-prix-touchbtns">
          <button type="button" onPointerDown={() => (touchCam.current = true)} aria-label="Change camera">
            Cam
          </button>
          <button type="button" onPointerDown={() => (touchReset.current = true)} aria-label="Reset to the track">
            Reset
          </button>
        </div>
      )}
      {mode !== 'idle' && !split && (
        <TouchControls
          dpad="x"
          buttons={[
            { key: 'ArrowDown', label: 'Brake' },
            { key: 'ArrowUp', label: 'Gas' },
            { key: 'Space', label: 'DRS' },
          ]}
        />
      )}
    </>
  );
}

