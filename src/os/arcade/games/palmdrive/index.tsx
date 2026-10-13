import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type View } from './scene';
import {
  COUNTDOWN,
  ITEMS,
  boom,
  createRace,
  fmtTime,
  lapOf,
  ordinal,
  pressGas,
  removeThing,
  soloRace,
  spawn,
  standings,
  step,
  strike,
  turboLevel,
  type Cc,
  type Ev,
  type Item,
  type Race,
  type Racer,
} from './logic';
import { applyFlags, carOf, endOf, events, finishOrder, guestState, hostState, parsePacket, winnerOf, type Car, type NetEv } from './net';
import { BPM, JINGLE_DONE, JINGLE_WIN, Sequencer, hz, type Note } from './music';
import { meta } from './meta';
import './palmdrive.css';

const CLASS = defineSetting('palmdrive:cc', ['50cc', '100cc', '150cc'] as const, '100cc');
const classOptions = [
  ['50cc', '50cc'],
  ['100cc', '100cc'],
  ['150cc', '150cc'],
] as const;
/** The race soundtrack; the shell's mute button silences it along with everything else. */
const MUSIC = defineSetting('palmdrive:music', ['on', 'off'] as const, 'on', { live: true });
const musicOptions = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;
/** Online karts take their color from their seat. */
const SEAT_COLORS = ['#e53935', '#1e88e5', '#3fae4a', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];
/** The host gives everyone a moment to get its first packet before the lights start. */
const HOST_LEAD = 1.2;
/** Once someone finishes, everyone else has this long. */
const TIME_LIMIT = 30;

// Palm Drive used to keep a best distance under its own id; races are timed per class now, and that old number
// would read as an impossible time on the Start card.
try {
  if (typeof window !== 'undefined' && window.localStorage.getItem('arcade:palmdrive-scoring') !== 'race') {
    window.localStorage.removeItem('arcade:best:palmdrive');
    window.localStorage.setItem('arcade:palmdrive-scoring', 'race');
  }
} catch {
  /* storage blocked */
}

const fmtMs = (ms: number) => fmtTime(ms / 1000);

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={fmtMs} setup={<Setup />}>
      <Stage />
    </GameShell>
  );
}

function useBests() {
  const b50 = useHighScore('palmdrive-50cc', { lowerIsBetter: true });
  const b100 = useHighScore('palmdrive-100cc', { lowerIsBetter: true });
  const b150 = useHighScore('palmdrive-150cc', { lowerIsBetter: true });
  return { '50cc': b50, '100cc': b100, '150cc': b150 };
}

function Setup() {
  const [cc, setCc] = useSetting(CLASS);
  const [music, setMusic] = useSetting(MUSIC);
  const best = useBests()[cc].best;
  return (
    <>
      <Segmented label="Class" value={cc} options={classOptions} onChange={setCc} />
      <Segmented label="Music" value={music} options={musicOptions} onChange={setMusic} />
      {best !== null && <small className="g-palmdrive-best">Best at {cc}: {fmtMs(best)}</small>}
    </>
  );
}

type Mode = 'idle' | 'solo' | 'online';

/** A fresh race for each solo round and each online round, and an idle grid behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: Mode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={current.current.key} mode={current.current.mode} />;
}

type OnlineApi = NonNullable<ReturnType<typeof useOnline>>;

function onlineRace(o: OnlineApi, cc: Cc, roster: number[], countdown: number): Race {
  const racers: Racer[] = roster.map((seat) => ({
    name: o.players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`,
    color: SEAT_COLORS[seat % SEAT_COLORS.length],
    kind: seat === o.seat ? 'player' : 'remote',
    seat,
  }));
  return createRace({ cc, racers, countdown, idBase: o.seat * 1_000_000 + 1 });
}

const isCc = (v: string): v is Cc => v === '50cc' || v === '100cc' || v === '150cc';

/** Plays one note of the soundtrack on the arcade synth, `delay` seconds from now. */
function playNote(note: Note, delay: number, stepLen: number) {
  const dur = note.len * stepLen;
  switch (note.voice) {
    case 'lead':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.92, type: 'square', vol: 0.045, delay });
      break;
    case 'bass':
      sfx.tone({ freq: hz(note.midi), dur: dur * 0.9, type: 'triangle', vol: 0.1, delay });
      break;
    case 'kick':
      sfx.tone({ freq: 150, to: 45, dur: 0.12, type: 'sine', vol: 0.13, delay });
      break;
    case 'hat':
      sfx.tone({ freq: 7400, dur: 0.025, type: 'square', vol: 0.008, delay });
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
  item: Item | null;
  uses: number;
  rolling: boolean;
  time: string;
  lights: number;
  banner: string | null;
  wrong: boolean;
  results: boolean;
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
  const [music] = useSetting(MUSIC);
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
    if (!live) race.current = soloRace(cc);
    else {
      const roster = [...online!.players].map((p) => p.seat).sort((a, b) => a - b);
      race.current = onlineRace(online!, cc, roster, online!.isHost ? COUNTDOWN + HOST_LEAD : 60);
    }
  }
  const net = useRef({
    synced: !live || online!.isHost,
    ticks: 0,
    roster: live ? [...online!.players].map((p) => p.seat).sort((a, b) => a - b) : [],
    cars: new Map<number, Car>(),
    outbox: [] as NetEv[],
    dnf: false,
    end: null as { w: number | null; order: [number, number][] } | null,
    endSends: 0,
    reported: false,
    over: false,
  });
  const tap = useRef({ item: false, back: false, gas: false });
  const [hud, setHud] = useState<Hud>({ place: 8, field: 8, lap: 1, laps: 3, coins: 0, item: null, uses: 0, rolling: false, time: '0:00.00', lights: 0, banner: null, wrong: false, results: false });
  const [flash, setFlash] = useState<{ id: number; kind: string } | null>(null);
  const [lapNote, setLapNote] = useState<{ id: number; text: string } | null>(null);
  const hudTick = useRef(0);
  const clock = useRef(0);
  const rollTick = useRef(0);
  const finalLapAt = useRef(-99);
  const doneAt = useRef<number | null>(null);
  const dots = useRef(new Map<number, SVGCircleElement>());
  const tags = useRef(new Map<number, HTMLDivElement>());
  const lastLevel = useRef(0);

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
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [THREE, raceKey]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE, raceKey]);

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
    const head = me.done === null ? 'You ran out of time.' : `${fmtTime(me.done)} at ${r.cc}.`;
    const tail = winner && !youWon ? ` ${nameOf(winner[0])} won in ${fmtTime(winner[1])}.` : '';
    sfx.play(youWon ? 'win' : me.done !== null ? 'coin' : 'lose');
    if (me.done !== null) bests[r.cc].submit(Math.round(me.done * 1000));
    shellRef.current.gameOver(undefined, me.done === null ? { title, detail: head + tail } : { title, detail: head + tail, board: r.cc, rank: Math.round(me.done * 1000) });
  };
  const finishRef = useRef(finishOnline);
  finishRef.current = finishOnline;

  const applyCar = (r: Race, seat: number, car: Omit<Car, 'seat'>) => {
    const k = r.karts.find((x) => x.seat === seat && x.kind === 'remote');
    if (!k) return;
    k.net = { x: car.x, z: car.z, h: car.h, v: car.v, prog: car.p, done: car.fin >= 0 ? car.fin : null, flags: car.f, at: r.time };
    k.y = car.y;
    applyFlags(k, car.f);
  };

  const applyEvent = (r: Race, from: number, ev: NetEv) => {
    const idx = (seat: number) => r.karts.findIndex((k) => k.seat === seat);
    if (ev.y === 'spawn') {
      if (!r.things.some((t) => t.id === ev.id)) spawn(r, { id: ev.id, kind: ev.kind, owner: idx(from), x: ev.x, z: ev.z, y: ev.yy, vx: ev.vx, vz: ev.vz, vy: ev.vy, grace: ev.gr, target: ev.tg >= 0 ? idx(ev.tg) : -1, prog: ev.pg }, false);
    } else if (ev.y === 'gone') removeThing(r, ev.id, false);
    else if (ev.y === 'bolt') strike(r, idx(from));
    else if (ev.y === 'boom') boom(r, ev.x, ev.z, idx(from));
  };

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      const o = onlineRef.current;
      const p = parsePacket(d);
      if (!o || !p || p.round !== o.round) return;
      let r = race.current!;
      if (p.k === 's') {
        if (!o.isHost || from === 0) return;
        n.cars.set(from, { seat: from, ...p.car });
        applyCar(r, from, p.car);
      } else if (p.k === 'S') {
        if (o.isHost || from !== 0) return;
        if (!n.synced) {
          if (!p.roster.includes(o.seat)) return;
          r = race.current = onlineRace(o, isCc(p.cc) ? p.cc : r.cc, p.roster, p.go);
          n.roster = p.roster;
          n.synced = true;
          setRaceKey((x) => x + 1);
        }
        for (const car of p.cars) if (car.seat !== o.seat) applyCar(r, car.seat, car);
      } else if (p.k === 'e') {
        if (p.o === o.seat) return;
        for (const ev of p.ev) applyEvent(r, p.o, ev);
        if (o.isHost) o.send(d);
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
      const me = r.karts[r.me];
      const mine = { ...carOf(me), fin: n.dnf ? -2 : carOf(me).fin };
      if (!o.isHost) {
        o.send(guestState(o.round, mine), { fast: n.ticks % 5 !== 0 && mine.fin === -1 });
        return;
      }
      const present = n.roster.filter((seat) => o.players.some((p) => p.seat === seat));
      const cars: Car[] = [{ seat: o.seat, ...mine }, ...present.filter((s) => s !== o.seat && n.cars.has(s)).map((s) => n.cars.get(s)!)];
      o.send(hostState(o.round, -r.time, r.cc, n.roster, cars), { fast: n.ticks % 5 !== 0 });
      // the host calls the race once nobody still in the room is racing
      if (!n.end && r.time > 0 && present.every((s) => (s === o.seat ? mine.fin : n.cars.get(s)?.fin ?? -1) !== -1)) {
        const order = finishOrder(present.map((s) => [s, s === o.seat ? mine.fin : n.cars.get(s)!.fin]));
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
        inp.steer = (keys.down('right') ? 1 : 0) - (keys.down('left') ? 1 : 0);
        inp.brake = keys.down('down');
        inp.drift = keys.down('Space', 'ShiftLeft', 'ShiftRight');
        if (keys.pressed('Space', 'ShiftLeft', 'ShiftRight')) inp.hop = true;
        inp.fwd = keys.down('up');
        const back = keys.pressed('KeyZ', 'KeyQ') || tap.current.back;
        const use = keys.pressed('KeyX', 'KeyE', 'Enter') || tap.current.item;
        if (back || use) {
          inp.use = true;
          inp.back = back || keys.down('down');
        }
        if (r.time < 0 && (keys.pressed('up') || tap.current.gas)) pressGas(r, me);
      }
      tap.current = { item: false, back: false, gas: false };

      step(r, dt);
      const evs = r.events.splice(0);
      for (const e of evs) {
        react(r, e);
        v?.react(e, r, r.me);
        if (live) outgoing(r, e);
      }
      if (live && o && n.outbox.length) {
        o.send(events(o.round, o.seat, n.outbox.splice(0)));
      }

      // roulette ticks and the spark color clicking up while you drift
      if (me && me.roll > 0) {
        rollTick.current -= dt;
        if (rollTick.current <= 0) {
          rollTick.current = 0.085;
          sfx.play('tick', 1.6);
        }
      }
      const level = me && me.drift ? turboLevel(me.charge) : 0;
      if (level > lastLevel.current) sfx.tone({ freq: 500 + level * 180, dur: 0.06, type: 'square', vol: 0.08 });
      lastLevel.current = level;

      // the soundtrack runs from the green light to your finish, a notch faster on the final lap
      const now = sfx.clock();
      if (musicRef.current === 'on' && now !== null && me && r.time >= 0 && me.done === null && !n.over) song.current!.tick(now, lapOf(r, me) === r.laps);

      if (v) {
        v.frame(r, Math.max(0, r.me), dt, clock.current);
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
          shellRef.current.gameOver(undefined, { title: 'Time Up', detail: `The race ended ${TIME_LIMIT} seconds after the first kart finished.` });
        } else if (doneAt.current !== null && clock.current - doneAt.current > 45) {
          // the host never called it: show what we know without reporting a winner
          finishOnline(finishOrder(r.karts.filter((k) => k.seat >= 0).map((k) => [k.seat, k.done ?? -1])), null, false);
        }
      }
      updateHud(r, dt);
    },
    () => view.current?.render(),
  );

  function finishSolo(r: Race) {
    const n = net.current;
    if (n.over) return;
    n.over = true;
    const me = r.karts[r.me];
    const ranked = standings(r);
    const place = ranked.findIndex((x) => x.k === me) + 1;
    const ms = Math.round((me.done ?? r.time) * 1000);
    const newBest = bests[r.cc].submit(ms);
    const winner = ranked[0];
    const lead = place === 1 ? (me.laps.length ? `Best lap ${fmtTime(Math.min(...me.laps))}.` : '') : `${winner.k.name} won in ${fmtTime(winner.time)}.`;
    shellRef.current.gameOver(undefined, {
      title: place === 1 ? 'You Won' : `${ordinal(place)} Place`,
      detail: `${fmtTime(ms / 1000)} at ${r.cc}${newBest ? ', a new best' : ''}. ${lead}`.trim(),
      board: r.cc,
      rank: ms,
    });
  }

  function outgoing(r: Race, e: Ev) {
    const out = net.current.outbox;
    if (e.t === 'spawn' && e.thing.local) {
      const th = e.thing;
      out.push({ y: 'spawn', id: th.id, kind: th.kind, x: round(th.x), z: round(th.z), vx: round(th.vx), vz: round(th.vz), vy: round(th.vy), yy: round(th.y), tg: r.karts[th.target]?.seat ?? -1, pg: round(th.prog), gr: round(th.grace) });
    } else if (e.t === 'gone' && e.local) out.push({ y: 'gone', id: e.id });
    else if (e.t === 'bolt') out.push({ y: 'bolt' });
    else if (e.t === 'boom') out.push({ y: 'boom', x: round(e.x), z: round(e.z) });
  }

  function react(r: Race, e: Ev) {
    const mine = 'k' in e && e.k === r.me;
    switch (e.t) {
      case 'beep':
        sfx.tone({ freq: 440, dur: 0.18, type: 'square', vol: 0.15 });
        break;
      case 'go':
        sfx.tone({ freq: 880, dur: 0.5, type: 'square', vol: 0.17 });
        break;
      case 'rocket':
        if (mine) sfx.tone({ freq: 300, to: 1000, dur: 0.3, type: 'sawtooth', vol: 0.12 });
        break;
      case 'box':
        if (mine) sfx.play('select', 1.2);
        break;
      case 'got':
        if (mine) sfx.play('blip', 1.5);
        break;
      case 'use':
        if (!mine) break;
        if (e.item === 'mushroom' || e.item === 'triple') sfx.tone({ freq: 260, to: 900, dur: 0.3, type: 'sawtooth', vol: 0.12 });
        else if (e.item === 'star') sfx.play('win');
        else if (e.item === 'banana') sfx.play('jump', 0.7);
        else if (e.item === 'blue') sfx.tone({ freq: 900, to: 500, dur: 0.6, type: 'triangle', vol: 0.12 });
        else if (e.item !== 'bolt') sfx.tone({ freq: 700, to: 300, dur: 0.18, type: 'triangle', vol: 0.15 });
        break;
      case 'hit':
        if (mine) {
          sfx.play(e.how === 'spin' || e.how === 'squash' ? 'hit' : 'boom');
          setFlash({ id: Date.now(), kind: 'hit' });
        }
        break;
      case 'bump':
      case 'wall':
        if (mine) sfx.play('tick', 0.5);
        break;
      case 'coin':
        if (mine) sfx.play('coin', 1.1);
        break;
      case 'turbo':
        if (mine) sfx.tone({ freq: 300 + e.level * 120, to: 900 + e.level * 200, dur: 0.25, type: 'sawtooth', vol: 0.12 });
        break;
      case 'dash':
        if (mine) sfx.tone({ freq: 380, to: 1200, dur: 0.22, type: 'triangle', vol: 0.14 });
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
        if (e.lap === r.laps) {
          finalLapAt.current = clock.current;
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
    let lights = 0;
    if (!n.synced) banner = 'waiting for the host';
    else if (r.time < -COUNTDOWN) banner = 'get ready';
    else if (r.time < 0) {
      banner = String(Math.ceil(-r.time));
      lights = COUNTDOWN + 1 - Math.ceil(-r.time);
    } else if (r.time < 0.9) {
      banner = 'go!';
      lights = 4;
    } else if (me.done !== null) banner = clock.current - (doneAt.current ?? 0) < 3 ? 'finish!' : null;
    else if (clock.current - finalLapAt.current < 2) banner = 'final lap!';
    const next: Hud = {
      place: me.place,
      field: r.karts.length,
      lap: lapOf(r, me),
      laps: r.laps,
      coins: me.coins,
      item: me.roll > 0 ? ITEMS[Math.floor(clock.current * 12) % ITEMS.length] : me.item,
      uses: me.uses,
      rolling: me.roll > 0,
      time: fmtTime(Math.max(0, me.done ?? r.time)),
      lights,
      banner,
      wrong: me.wrong > 1.2 && me.done === null,
      results: me.done !== null && clock.current - (doneAt.current ?? 0) >= 3,
    };
    setHud((h) => (sameHud(h, next) ? h : next));
  }

  const r = race.current!;
  const playing = shell.status === 'playing';
  const minimap = useMemo(() => mapPath(r), [raceKey]);
  const board = hud.results ? standings(r) : [];
  const press = (code: string) => (e: RPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    keys.press(code);
    if (race.current && race.current.time < 0) tap.current.gas = true;
  };
  const release = (code: string) => () => keys.release(code);
  const hold = (code: string) => ({ onPointerDown: press(code), onPointerUp: release(code), onPointerCancel: release(code), onLostPointerCapture: release(code), onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() });

  return (
    <>
      <div
        ref={ref}
        className="g-palmdrive-host"
        onPointerDown={() => {
          if (playing && race.current && race.current.time < 0) tap.current.gas = true;
        }}
      />
      {live &&
        r.karts
          .filter((k) => k.kind === 'remote')
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
        <div className={`g-palmdrive-hud${shell.touch ? ' is-touch' : ''}`}>
          <div className={`g-palmdrive-item${hud.rolling ? ' is-rolling' : ''}${hud.item && !hud.rolling ? ' is-ready' : ''}`} aria-label={hud.item && !hud.rolling ? `Holding ${itemName(hud.item)}` : 'No item'}>
            {hud.item ? <ItemIcon item={hud.item} /> : null}
            {hud.item === 'triple' && !hud.rolling && hud.uses > 0 && <b>{hud.uses}</b>}
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
            <path d={minimap.d} className="g-palmdrive-map-line" />
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
            <span className="g-palmdrive-coins">
              <CoinIcon />
              {hud.coins}
            </span>
          </div>
          <div className="g-palmdrive-place">
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
            <div key={hud.banner} className={`g-palmdrive-banner${/^\d$/.test(hud.banner) ? ' is-count' : ''}${hud.banner.length > 12 ? ' is-note' : ''}`}>
              {hud.banner}
            </div>
          )}
          {hud.wrong && <div className="g-palmdrive-wrong">wrong way</div>}
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
      {shell.touch && playing && (
        <div className="g-palmdrive-touch">
          <div className="g-palmdrive-steer">
            <button type="button" tabIndex={-1} aria-label="Steer left" {...hold('ArrowLeft')}>
              <Chevron d="M15 6l-6 6 6 6" />
            </button>
            <button type="button" tabIndex={-1} aria-label="Steer right" {...hold('ArrowRight')}>
              <Chevron d="M9 6l6 6-6 6" />
            </button>
          </div>
          <div className="g-palmdrive-actions">
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
            <button
              type="button"
              tabIndex={-1}
              className="g-palmdrive-use"
              aria-label="Use item"
              onPointerDown={(e) => {
                e.preventDefault();
                tap.current.item = true;
                if (race.current && race.current.time < 0) tap.current.gas = true;
              }}
            >
              {hud.item && !hud.rolling ? <ItemIcon item={hud.item} size={34} /> : 'item'}
            </button>
            <button type="button" tabIndex={-1} className="g-palmdrive-drift" aria-label="Drift" {...hold('Space')}>
              drift
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The track outline for the minimap, north up (map x is -world x). */
function mapPath(r: Race) {
  const t = r.track;
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
  return { d: `${d}Z`, box: `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2).toFixed(0)}` };
}

const itemName = (item: Item) => ({ banana: 'a banana', green: 'a green shell', red: 'a red shell', mushroom: 'a mushroom', triple: 'three mushrooms', star: 'a star', bolt: 'lightning', blue: 'a blue shell' })[item];

const Chevron = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const Svg = ({ children, size = 40 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

function Shell({ fill, edge }: { fill: string; edge: string }) {
  return (
    <>
      <ellipse cx="12" cy="16.5" rx="9.5" ry="3.6" fill="#fff" stroke="#9aa" strokeWidth="1" />
      <path d="M3.5 15.5a8.5 9 0 0 1 17 0z" fill={fill} stroke={edge} strokeWidth="1" />
      <path d="M8 15l1.2-5.2h5.6L16 15M12 6.6v3.2" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.3" strokeLinejoin="round" />
    </>
  );
}

function Mushroom() {
  return (
    <>
      <path d="M2.5 12.5a9.5 8.5 0 0 1 19 0z" fill="#e53935" stroke="#7a1512" strokeWidth="1" />
      <circle cx="8" cy="8.2" r="2" fill="#fff" />
      <circle cx="15.5" cy="7.6" r="2.4" fill="#fff" />
      <circle cx="12" cy="11" r="1.3" fill="#fff" />
      <rect x="7.5" y="12.5" width="9" height="8" rx="2.5" fill="#f6e7cf" stroke="#9a7f5c" strokeWidth="1" />
      <rect x="10" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
      <rect x="12.8" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
    </>
  );
}

function ItemIcon({ item, size }: { item: Item; size?: number }) {
  switch (item) {
    case 'mushroom':
      return (
        <Svg size={size}>
          <Mushroom />
        </Svg>
      );
    case 'triple':
      return (
        <Svg size={size}>
          <g transform="translate(-4 3) scale(0.6)">
            <Mushroom />
          </g>
          <g transform="translate(13.6 3) scale(0.6)">
            <Mushroom />
          </g>
          <g transform="translate(4.8 -2) scale(0.6)">
            <Mushroom />
          </g>
        </Svg>
      );
    case 'star':
      return (
        <Svg size={size}>
          <path d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.3l7.1-.7z" fill="#ffd23f" stroke="#c98a00" strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="9.6" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
          <rect x="13.1" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
        </Svg>
      );
    case 'banana':
      return (
        <Svg size={size}>
          <path d="M5 6c-1 6 2 12 9 13 3 .4 5-.6 6-2-4 1-9-1-11-5-1-2-1.4-4-1-6z" fill="#ffd640" stroke="#b98a00" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M5 6l-1-2.2M20 17l1.3.8" stroke="#5b3b1c" strokeWidth="1.6" strokeLinecap="round" />
        </Svg>
      );
    case 'green':
      return (
        <Svg size={size}>
          <Shell fill="#2fae4e" edge="#16632a" />
        </Svg>
      );
    case 'red':
      return (
        <Svg size={size}>
          <Shell fill="#d8312a" edge="#7a1512" />
        </Svg>
      );
    case 'blue':
      return (
        <Svg size={size}>
          <path d="M1.5 12.5l4-2.5M22.5 12.5l-4-2.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <Shell fill="#2f6fe4" edge="#183f8c" />
          <path d="M8 7.5l1-2.4 1 2.4M11 6.5l1-2.6 1 2.6M14 7.5l1-2.4 1 2.4" fill="#fff" stroke="#fff" strokeWidth="0.8" strokeLinejoin="round" />
        </Svg>
      );
    case 'bolt':
      return (
        <Svg size={size}>
          <path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#ffe14d" stroke="#c98a00" strokeWidth="1.2" strokeLinejoin="round" />
        </Svg>
      );
  }
}

const CoinIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="#f7c948" stroke="#b9860f" strokeWidth="1.6" />
    <rect x="10.4" y="6.5" width="3.2" height="11" rx="1.6" fill="#fff3c4" stroke="#b9860f" strokeWidth="1" />
  </svg>
);
