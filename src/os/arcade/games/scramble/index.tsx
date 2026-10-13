import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, MAX_DT, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type View } from './scene';
import {
  COUNTDOWN,
  FIGHTER_COLORS,
  LEVELS,
  aliveCount,
  angleDiff,
  canSee,
  concealed,
  createMatch,
  fmtClock,
  held,
  ordinal,
  owned,
  prompt,
  scoreOf,
  soloMatch,
  step,
  type Ev,
  type Fighter,
  type Level,
  type Match,
} from './logic';
import { configOf, parsePacket, type Bots } from './net';
import { FLUSH, TICK_MS, ending, flush, guestMatch, hostMatch, newSession, receive, share, tick, type Session } from './session';
import { AMMO_MAX, RARITY_COLORS, WEAPONS, WOOD_MAX, lootName, reloadOf, type WeaponId } from './items';
import { HALF } from './map';
import { AmmoIcon, BandageIcon, EggIcon, HowToPlay, IslandArt, ShieldIcon, WeaponIcon, WoodIcon } from './hud';
import { meta } from './meta';
import './scramble.css';

const LEVEL = defineSetting('scramble:level', LEVELS, 'normal');
const BOTS = defineSetting('scramble:bots', ['fill', 'none'] as const, 'fill');
const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const;
const botOptions = [
  ['fill', 'Fill to 8'],
  ['none', 'None'],
] as const;
/** The host gives everyone a moment to get its first packet before the countdown. */
const HOST_LEAD = 1.2;
const STICK_R = 52;
const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Stage />
    </GameShell>
  );
}

function useBests() {
  const easy = useHighScore('scramble-easy');
  const normal = useHighScore('scramble-normal');
  const hard = useHighScore('scramble-hard');
  return { easy, normal, hard };
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  const best = useBests()[level].best;
  return (
    <>
      <Segmented label="Computer Eggs" value={level} options={levelOptions} onChange={setLevel} />
      <Extras />
      {best !== null && <small className="g-scramble-best">Best on {level}: {best.toLocaleString('en-US')} pts</small>}
    </>
  );
}

function Extras() {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  return (
    <div className="g-scramble-extras">
      <button type="button" className="arcade-btn" onClick={() => setOpen(true)}>
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
    </div>
  );
}

/** Settings for online matches: the host picks for everyone and tells the room as they change; guests see the picks. */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [bots, setBots] = useSetting(BOTS);
  const [picked, setPicked] = useState<{ bots: Bots; level: Level } | null>(null);
  const host = online?.isHost ?? true;
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send(configOf(online.round, bots, level));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, bots, level]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from !== 0 || !p) return;
      if (p.k === 'cfg') setPicked({ bots: p.bots, level: p.level });
      // joining while a match is on: the host's state says how it was set up
      else if (p.k === 'S') {
        const bots: Bots = p.roster.includes(-1) ? 'fill' : 'none';
        setPicked((x) => (x && x.bots === bots && x.level === p.level ? x : { bots, level: p.level }));
      }
    });
  }, [online]);
  return (
    <>
      {host ? (
        <>
          <Segmented label="Computer Eggs" value={bots} options={botOptions} onChange={setBots} />
          {bots === 'fill' && <Segmented label="How Sharp" value={level} options={levelOptions} onChange={setLevel} />}
        </>
      ) : (
        <div className="arcade-field">
          <span>Computer Eggs</span>
          <div className="g-scramble-hostpick">
            <b>{picked ? (picked.bots === 'fill' ? `fill to 8, ${picked.level}` : 'none') : '…'}</b>
            <small>picked by the host</small>
          </div>
        </div>
      )}
      <Extras />
    </>
  );
}

type Mode = 'idle' | 'solo' | 'online';

/** A fresh match for each solo round and each online round, and the island from above behind the Start card. */
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

/** A stand-in while a guest waits for the host: the island with nobody on it. */
const waitingMatch = (level: Level) => createMatch({ seed: 1, role: 'guest', level, entrants: [], me: -1 });

type Slot = { w: WeaponId | null; r: number; mag: number } | null;
type Hud = {
  phase: Fighter['phase'] | 'none';
  alive: number;
  total: number;
  kills: number;
  hp: number;
  shield: number;
  slot: number;
  slots: [Slot, Slot];
  mag: number;
  reserve: number;
  wood: number;
  bandages: number;
  shields: number;
  /** 0..1 while reloading or using something, else -1. */
  busy: number;
  busyText: string;
  storm: string;
  shrinking: boolean;
  outside: boolean;
  low: boolean;
  banner: string | null;
  prompt: string | null;
  jump: boolean;
  watching: string | null;
  out: string | null;
  mine: boolean;
};
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every((k) => (k === 'slots' ? JSON.stringify(a.slots) === JSON.stringify(b.slots) : a[k] === b[k]));
const blankHud = (): Hud => ({ phase: 'none', alive: 0, total: 0, kills: 0, hp: 100, shield: 0, slot: 2, slots: [null, null], mag: 0, reserve: 0, wood: 0, bandages: 0, shields: 0, busy: -1, busyText: '', storm: '', shrinking: false, outside: false, low: false, banner: null, prompt: null, jump: false, watching: null, out: null, mine: false });

type Stick = { id: number; ox: number; oy: number; x: number; y: number };
/** A kill feed line; it fades out at `until` on the game clock (so a paused game keeps it up). */
type Feed = { id: number; text: string; mine: boolean; until: number };
type Pop = { el: HTMLDivElement | null; x: number; y: number; z: number; age: number; live: boolean };

const causeName = (w: string) => (w === 'storm' ? 'the storm' : w === 'left' ? '' : w === 'spatula' ? 'a spatula' : WEAPONS[w as WeaponId]?.name ?? w);

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
  const [level] = useSetting(LEVEL);
  const [bots] = useSetting(BOTS);
  const bests = useBests();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const view = useRef<View | null>(null);
  const match = useRef<Match | null>(null);
  const net = useRef<Session>(null as unknown as Session);
  net.current ??= newSession(!live || online!.isHost);
  if (!match.current) {
    if (mode === 'idle') match.current = soloMatch(randomSeed(), level);
    else if (!live) match.current = soloMatch(randomSeed(), level, 'you', FIGHTER_COLORS[0]);
    else if (online!.isHost) {
      const h = hostMatch(online!.players, online!.seat, randomSeed(), level, bots, COUNTDOWN + HOST_LEAD);
      match.current = h.match;
      net.current.roster = h.roster;
    } else match.current = waitingMatch(level);
  }
  const [viewKey, setViewKey] = useState(0);
  const clock = useRef(0);
  const [hud, setHud] = useState<Hud>(blankHud);
  const hudTick = useRef(0);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [bigMap, setBigMap] = useState(false);
  const bannerRef = useRef({ text: '', until: -1 });
  const spectate = useRef(-1);
  const soloEnd = useRef(-1);

  // input that arrives between frames
  const mouse = useRef({ x: 0, y: 0, inside: false, down: false, clicked: false });
  const taps = useRef({ build: false, reload: false, heal: false, shield: false, interact: false, jump: false, cycle: 0, slot: -1, watch: 0 });
  const moveStick = useRef<Stick | null>(null);
  const aimStick = useRef<Stick | null>(null);
  /** Which thumbsticks are down; their knobs move on the DOM as the thumb does. */
  const [sticks, setSticks] = useState({ move: false, aim: false });
  const stickEls = useRef<{ move: HTMLDivElement | null; aim: HTMLDivElement | null }>({ move: null, aim: null });
  const lastAim = useRef(0);
  /** When the match last moved on (wall seconds), so a hidden tab can catch up. */
  const lastStep = useRef(0);
  /**
   * Thumbsticks or mouse: a phone or iPad starts on thumbsticks, anything else on the mouse, and either switches to
   * whatever is actually used (a laptop with a touchscreen does both).
   */
  const [touchMode, setTouchMode] = useState(shell.touch);
  const touchRef = useRef(touchMode);
  touchRef.current = touchMode;
  useEffect(() => setTouchMode(shell.touch), [shell.touch]);
  const soundGap = useRef(0);

  // floating damage numbers and name tags, moved on the DOM every frame
  const pops = useRef<Pop[]>(Array.from({ length: 18 }, () => ({ el: null, x: 0, y: 0, z: 0, age: 9, live: false })));
  const popAt = useRef(0);
  const tags = useRef(new Map<number, HTMLDivElement>());

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
    const m = match.current;
    if (!THREE || !host || !m) return;
    const v = buildView(THREE, host, m);
    if (!v) return;
    view.current = v;
    v.resize(sizeRef.current.w, sizeRef.current.h);
    v.frame(m, focusOf(m), 0, 0, { aimLine: false, overview: mode === 'idle' || m.me < 0 });
    v.render();
    shell.invalidate();
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [THREE, viewKey]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE, viewKey]);

  // the mouse wheel cycles weapons (a native listener, so it can keep the page from scrolling)
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) >= 40) {
        taps.current.cycle = acc > 0 ? 1 : -1;
        acc = 0;
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (shell.status !== 'playing') {
      mouse.current.down = false;
      moveStick.current = null;
      aimStick.current = null;
      setSticks({ move: false, aim: false });
    }
  }, [shell.status]);

  /** The egg the camera follows: yours, or once you're out, whoever you're watching. */
  function focusOf(m: Match) {
    const me = m.fighters[m.me];
    if (me && me.phase !== 'out') return m.me;
    const alive = m.fighters.filter((f) => f.phase !== 'out');
    if (!alive.length) return Math.max(0, m.me);
    if (!alive.some((f) => f.id === spectate.current)) {
      const killer = me && me.by >= 0 ? m.fighters[me.by] : undefined;
      spectate.current = killer && killer.phase !== 'out' ? killer.id : alive[0].id;
    }
    return spectate.current;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Online: state about 15 times a second, events as they happen, the result from the host.

  const finishOnline = (report: boolean) => {
    const n = net.current;
    const o = onlineRef.current;
    const m = match.current!;
    const me = m.fighters[m.me];
    const winner = m.fighters[m.winner];
    if (report && !n.reported && o) {
      n.reported = true;
      o.reportResult(o.round, winner && winner.seat >= 0 ? winner.seat : null);
    }
    if (n.over) return;
    n.over = true;
    const won = !!me && m.winner === me.id;
    const title = won ? 'Last Egg Standing' : me ? `${ordinal(me.place || m.fighters.length)} of ${m.fighters.length}` : 'Match Over';
    const stats = me ? `${me.kills} ${me.kills === 1 ? 'elimination' : 'eliminations'}, ${Math.round(me.dealt)} damage.` : '';
    const who = winner && !won ? ` ${winner.name} won.` : !winner ? ' Nobody survived the storm.' : '';
    sfx.play(won ? 'win' : 'lose');
    shellRef.current.gameOver(undefined, { title, detail: `${stats}${who}`.trim() });
  };
  const finishRef = useRef(finishOnline);
  finishRef.current = finishOnline;

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      const o = onlineRef.current;
      const m = match.current;
      if (!o || !m) return;
      const next = receive(n, m, { seat: o.seat, isHost: o.isHost, round: o.round }, from, d, (seed, lvl, time, roster) => guestMatch(o.players, o.seat, seed, lvl, time, roster), performance.now() / 1000);
      if (next !== m) {
        match.current = next;
        setViewKey((x) => x + 1);
      }
    });
    const timer = window.setInterval(() => {
      const o = onlineRef.current;
      const m = match.current;
      if (!o || !m) return;
      const me = { seat: o.seat, isHost: o.isHost, round: o.round };
      const now = performance.now() / 1000;
      // a hidden tab gets no frames, so the match carries on from here: our egg stands still but the storm still
      // bites and the glide still lands, and a hidden host keeps the computer eggs and everyone's pickups going
      if (document.hidden && n.synced && shellRef.current.status === 'playing') {
        const mine = m.fighters[m.me];
        if (mine) {
          mine.input.fire = false;
          mine.input.mx = 0;
          mine.input.mz = 0;
        }
        mouse.current.down = false;
        let left = Math.min(2, Math.max(0, now - lastStep.current));
        while (left > 1e-4) {
          const d = Math.min(MAX_DT, left);
          step(m, d);
          left -= d;
          for (const e of m.events.splice(0)) share(n, e, o.seat);
        }
        lastStep.current = now;
        for (const packet of flush(n, o.round, FLUSH)) o.send(packet);
        const call = ending(n, m, me, now);
        if (call) finishRef.current(call === 'report');
      }
      for (const out of tick(n, m, me, o.players.map((p) => p.seat), now)) o.send(out.d, { fast: out.fast });
    }, TICK_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  // -------------------------------------------------------------------------------------------------------------
  // Input.

  function readInput(m: Match, me: Fighter, v: View | null) {
    const inp = me.input;
    const t = taps.current;
    // walking: keys, or the left thumb
    let mx = keys.axis('left', 'right');
    let mz = keys.axis('up', 'down');
    const ms = moveStick.current;
    if (ms) {
      const dx = ms.x - ms.ox;
      const dy = ms.y - ms.oy;
      const len = Math.hypot(dx, dy);
      const k = len < 8 ? 0 : Math.min(1, len / STICK_R) / len;
      mx = dx * k;
      mz = dy * k;
    }
    inp.mx = mx;
    inp.mz = mz;
    // aiming: the right thumb, the mouse, or the way you walk
    let fire = false;
    const as = aimStick.current;
    if (as && Math.hypot(as.x - as.ox, as.y - as.oy) > 10) {
      const dx = as.x - as.ox;
      const dy = as.y - as.oy;
      lastAim.current = assist(m, me, Math.atan2(dx, dy));
      fire = Math.hypot(dx, dy) > STICK_R * 0.5;
    } else if (mouse.current.inside && v && !touchRef.current) {
      const g = v.ground(mouse.current.x, mouse.current.y, 1);
      if (g && Math.hypot(g.x - me.x, g.z - me.z) > 0.3) lastAim.current = Math.atan2(g.x - me.x, g.z - me.z);
    } else if (mx || mz) lastAim.current = Math.atan2(mx, mz);
    if (mouse.current.down && !touchRef.current) fire = true;
    if (keys.down('KeyF')) {
      // F: shoot at the nearest egg in sight
      const target = nearestFoe(m, me);
      if (target) lastAim.current = Math.atan2(target.x - me.x, target.z - me.z);
      fire = true;
    }
    inp.aim = lastAim.current;
    inp.fire = fire && me.phase === 'ground';
    if (keys.pressed('Digit1')) inp.slot = 0;
    if (keys.pressed('Digit2')) inp.slot = 1;
    if (keys.pressed('Digit3')) inp.slot = 2;
    if (t.slot >= 0) inp.slot = t.slot;
    if (keys.pressed('KeyQ')) inp.cycle = 1;
    if (t.cycle) inp.cycle = t.cycle;
    if (keys.pressed('KeyR') || t.reload) inp.reload = true;
    if (keys.pressed('KeyE') || t.interact) inp.interact = true;
    if (keys.pressed('KeyH', 'Digit4') || t.heal) inp.heal = true;
    if (keys.pressed('KeyG', 'Digit5') || t.shield) inp.shield = true;
    const space = keys.pressed('Space');
    if (me.phase === 'bus') {
      if (space || t.jump || mouse.current.clicked || inp.interact || t.build) inp.jump = true;
    } else if (space || t.build) inp.build = true;
    mouse.current.clicked = false;
    taps.current = { build: false, reload: false, heal: false, shield: false, interact: false, jump: false, cycle: 0, slot: -1, watch: 0 };
  }

  /** On a touchscreen, a near miss with the right thumb snaps onto the egg it was meant for. */
  function assist(m: Match, me: Fighter, a: number) {
    const h = held(me);
    const range = h.w ? WEAPONS[h.w].range : 3;
    let best = a;
    let bestD = 0.2;
    for (const o of m.fighters) {
      if (o === me || o.phase !== 'ground' || concealed(m, o, me)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d > range) continue;
      const off = Math.abs(angleDiff(Math.atan2(o.x - me.x, o.z - me.z), a));
      if (off < bestD) {
        bestD = off;
        best = Math.atan2(o.x - me.x, o.z - me.z);
      }
    }
    return best;
  }

  function nearestFoe(m: Match, me: Fighter) {
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const o of m.fighters) {
      if (o === me || !canSee(m, me, o, 70)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The frame loop.

  useGameLoop(
    (dt) => {
      const m = match.current!;
      const v = view.current;
      const n = net.current;
      const o = onlineRef.current;
      clock.current += dt;
      lastStep.current = performance.now() / 1000;
      if (live && !n.synced) {
        v?.frame(m, -1, dt, clock.current, { aimLine: false, overview: true });
        updateHud(m, dt);
        return;
      }
      const me = m.fighters[m.me];
      if (me && me.phase !== 'out' && !n.over) readInput(m, me, v);
      else watchInput(m);
      if (keys.pressed('KeyM')) setBigMap((b) => !b);

      step(m, dt);
      const focus = focusOf(m);
      for (const e of m.events.splice(0)) {
        react(m, e, focus);
        v?.react(e, m, focus);
        if (live && o) share(n, e, o.seat);
      }
      if (live && o) for (const packet of flush(n, o.round, dt)) o.send(packet);

      if (v) {
        v.frame(m, focus, dt, clock.current, { aimLine: focus === m.me, overview: false });
        placeOverlays(m, v, dt, focus);
      }

      // the end
      if (!live) {
        if (me && !n.over) {
          if (me.phase === 'out' || m.ended) {
            if (soloEnd.current < 0) soloEnd.current = clock.current;
            if (clock.current - soloEnd.current > (me.phase === 'out' ? 2.6 : 2.2)) finishSolo(m, me);
          }
        }
      } else if (o) {
        // the host calls it; if it never does, show what we know without reporting a winner
        const call = ending(n, m, { seat: o.seat, isHost: o.isHost, round: o.round }, performance.now() / 1000);
        if (call) finishRef.current(call === 'report');
      }
      updateHud(m, dt);
    },
    () => view.current?.render(),
  );

  /** Out of the match: arrows (or the on-screen buttons) switch whose view you watch. */
  function watchInput(m: Match) {
    const step = (keys.pressed('right', 'KeyE') ? 1 : 0) - (keys.pressed('left') ? 1 : 0) + taps.current.watch;
    taps.current.watch = 0;
    if (!step) return;
    const alive = m.fighters.filter((f) => f.phase !== 'out');
    if (!alive.length) return;
    const at = alive.findIndex((f) => f.id === spectate.current);
    spectate.current = alive[(at + step + alive.length) % alive.length].id;
  }

  function finishSolo(m: Match, me: Fighter) {
    const n = net.current;
    if (n.over) return;
    n.over = true;
    const won = m.ended && m.winner === me.id;
    const score = scoreOf(me, won);
    const best = bests[m.level];
    const newBest = score > 0 && best.submit(score);
    const winner = m.fighters[m.winner];
    const title = won ? 'Last Egg Standing' : `${ordinal(me.place)} of ${m.fighters.length}`;
    const how = won ? '' : me.by >= 0 ? ` Cracked by ${m.fighters[me.by]?.name ?? 'someone'}.` : me.outCause === 'storm' ? ' The storm got you.' : '';
    const detail = `${score.toLocaleString('en-US')} pts${newBest ? ', a new best' : ''}: ${me.kills} ${me.kills === 1 ? 'elimination' : 'eliminations'}, ${Math.round(me.dealt)} damage${won ? ' and the win' : ''}.${how}${!won && winner && m.ended ? ` ${winner.name} won.` : ''}`;
    shellRef.current.gameOver(undefined, score > 0 ? { title, detail, board: m.level, rank: score } : { title, detail });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Sounds and moments.

  function say(text: string, seconds = 2.2) {
    bannerRef.current = { text, until: clock.current + seconds };
  }

  function addFeed(text: string, mine: boolean) {
    const id = Date.now() + Math.random();
    setFeed((f) => [...f.slice(-4), { id, text, mine, until: clock.current + 6 }]);
  }

  function popNumber(x: number, z: number, text: string, shield: boolean) {
    const p = pops.current[popAt.current];
    popAt.current = (popAt.current + 1) % pops.current.length;
    if (!p.el) return;
    p.x = x + (Math.random() - 0.5) * 0.6;
    p.y = 1.8;
    p.z = z;
    p.age = 0;
    p.live = true;
    p.el.textContent = text;
    p.el.classList.toggle('is-shield', shield);
  }

  function gunSound(w: WeaponId, k: number) {
    switch (w) {
      case 'pistol':
        sfx.noise(0.06, 0.14 * k);
        sfx.tone({ freq: 720, to: 180, dur: 0.06, type: 'square', vol: 0.05 * k });
        break;
      case 'smg':
        sfx.noise(0.04, 0.1 * k);
        sfx.tone({ freq: 900, to: 300, dur: 0.04, type: 'square', vol: 0.04 * k });
        break;
      case 'rifle':
        sfx.noise(0.07, 0.15 * k);
        sfx.tone({ freq: 520, to: 120, dur: 0.08, type: 'sawtooth', vol: 0.06 * k });
        break;
      case 'shotgun':
        sfx.noise(0.22, 0.3 * k);
        sfx.tone({ freq: 190, to: 50, dur: 0.18, type: 'sawtooth', vol: 0.1 * k });
        break;
      case 'sniper':
        sfx.noise(0.3, 0.28 * k);
        sfx.tone({ freq: 1400, to: 90, dur: 0.35, type: 'sawtooth', vol: 0.08 * k });
        break;
      case 'launcher':
        sfx.tone({ freq: 220, to: 560, dur: 0.25, type: 'sawtooth', vol: 0.07 * k });
        sfx.noise(0.15, 0.1 * k);
        break;
    }
  }

  function react(m: Match, e: Ev, focus: number) {
    const f = 'f' in e ? m.fighters[e.f] : undefined;
    const eye = m.fighters[focus];
    const mine = !!f && f.id === m.me;
    // how loud something is from where we stand
    const near = (x: number, z: number) => (eye ? Math.max(0, 1 - Math.hypot(x - eye.x, z - eye.z) / 55) : 0);
    switch (e.t) {
      case 'beep':
        sfx.tone({ freq: 440, dur: 0.18, type: 'square', vol: 0.15 });
        break;
      case 'go':
        sfx.tone({ freq: 880, dur: 0.45, type: 'square', vol: 0.16 });
        break;
      case 'storm':
        if (e.shrinking) {
          say(e.phase === 1 ? 'the storm is moving' : 'the storm is closing in');
          sfx.tone({ freq: 300, to: 200, dur: 0.6, type: 'sawtooth', vol: 0.08 });
          sfx.tone({ freq: 300, to: 200, dur: 0.6, type: 'sawtooth', vol: 0.08, delay: 0.7 });
        }
        break;
      case 'jump':
        if (mine) sfx.play('jump');
        break;
      case 'land':
        if (mine) sfx.noise(0.12, 0.12);
        break;
      case 'shot': {
        if (!f) break;
        const k = mine ? 1 : near(f.x, f.z) * 0.8;
        if (!mine) {
          // a gunfight next door shouldn't drown everything else
          if (k <= 0.05 || clock.current - soundGap.current < 0.035) break;
          soundGap.current = clock.current;
        }
        gunSound(e.w, k);
        break;
      }
      case 'swing':
        if (f && (mine || near(f.x, f.z) > 0.6)) sfx.tone({ freq: 340, to: 140, dur: 0.1, type: 'triangle', vol: 0.08 });
        break;
      case 'hit':
        if (e.f === m.me) {
          popNumber(e.x, e.z, String(e.d), e.shield);
          sfx.tone({ freq: e.shield ? 1500 : 1100, dur: 0.035, type: 'triangle', vol: 0.1 });
        }
        break;
      case 'hurt':
        if (e.f !== m.me) break;
        if (e.storm) sfx.tone({ freq: 160, dur: 0.08, type: 'triangle', vol: 0.06 });
        else {
          sfx.play('hit', e.shield ? 1.3 : 0.9);
          buzz(40);
        }
        break;
      case 'smash':
        if (mine) sfx.tone({ freq: 240, to: 180, dur: 0.05, type: 'square', vol: 0.06 });
        break;
      case 'harvest':
        if (mine) sfx.tone({ freq: 330, to: 220, dur: 0.06, type: 'triangle', vol: 0.1 });
        break;
      case 'boom': {
        const k = Math.max(0.15, near(e.x, e.z));
        sfx.noise(0.45, 0.3 * k);
        sfx.tone({ freq: 120, to: 40, dur: 0.4, type: 'sawtooth', vol: 0.12 * k });
        break;
      }
      case 'reload':
        if (mine) sfx.play('tick', 0.7);
        break;
      case 'reloaded':
        if (mine) sfx.play('tick', 1.1);
        break;
      case 'empty':
        if (mine) sfx.tone({ freq: 220, dur: 0.04, type: 'square', vol: 0.06 });
        break;
      case 'use':
        if (mine) sfx.play('select', 0.8);
        break;
      case 'used':
        if (mine) sfx.play('coin', e.what === 'shield' ? 0.9 : 1.2);
        break;
      case 'took':
        if (e.f === m.me) sfx.play(e.def.kind === 'gun' ? 'select' : 'blip', 1.3);
        break;
      case 'opened':
        if (e.f === m.me) {
          const c = m.map.containers[e.c];
          if (c?.kind === 'chest') sfx.play('coin', 1);
          else sfx.noise(0.15, 0.15);
        }
        break;
      case 'wall':
        if (e.wall.f === m.me) {
          sfx.noise(0.06, 0.1);
          sfx.tone({ freq: 260, to: 360, dur: 0.07, type: 'square', vol: 0.06 });
        }
        break;
      case 'out': {
        const who = m.fighters[e.f];
        const by = e.by >= 0 ? m.fighters[e.by] : undefined;
        if (!who) break;
        const yours = e.by === m.me && e.f !== m.me;
        const name = (x: Fighter) => (x.id === m.me ? 'you' : x.name);
        const text =
          e.w === 'left'
            ? `${who.name} left`
            : e.w === 'storm' || !by
              ? `${name(who)} ${who.id === m.me ? 'were' : 'was'} lost to the storm`
              : by === who
                ? `${name(who)} cracked`
                : `${name(by)} cracked ${name(who)} with ${causeName(e.w)}`;
        addFeed(text, yours || e.f === m.me);
        if (yours) {
          say(`you cracked ${who.name}`);
          sfx.play('coin', 1.4);
          buzz(30);
        } else if (e.f === m.me) {
          sfx.play('lose');
          buzz(120);
        } else if (eye && near(who.x, who.z) > 0) sfx.noise(0.12, 0.1 * near(who.x, who.z));
        break;
      }
      case 'end':
        if (e.winner === m.me) {
          say('last egg standing!', 6);
          sfx.play('win');
        }
        break;
    }
  }

  /** Name tags and damage numbers, moved straight on the DOM. */
  function placeOverlays(m: Match, v: View, dt: number, focus: number) {
    const eye = m.fighters[focus];
    for (const f of m.fighters) {
      const tag = tags.current.get(f.id);
      if (!tag) continue;
      const show = f.id !== focus && (f.phase === 'ground' || f.phase === 'drop') && !concealed(m, f, eye) && !!eye && Math.hypot(f.x - eye.x, f.z - eye.z) < 34 && (f.inside < 0 || f.inside === eye.inside);
      const at = show ? v.project(f.x, f.y + 2.3, f.z) : null;
      if (!at) tag.style.opacity = '0';
      else {
        tag.style.opacity = '1';
        tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    for (const p of pops.current) {
      if (!p.live || !p.el) continue;
      p.age += dt;
      if (p.age > 0.9) {
        p.live = false;
        p.el.style.opacity = '0';
        continue;
      }
      const at = v.project(p.x, p.y + p.age * 1.6, p.z);
      if (!at) {
        p.el.style.opacity = '0';
        continue;
      }
      p.el.style.opacity = String(Math.min(1, (0.9 - p.age) * 4));
      p.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%) scale(${(1.25 - Math.min(0.25, p.age)).toFixed(2)})`;
    }
  }

  function updateHud(m: Match, dt: number) {
    hudTick.current -= dt;
    if (hudTick.current > 0) return;
    hudTick.current = 1 / 15;
    setFeed((f) => (f.some((x) => x.until <= clock.current) ? f.filter((x) => x.until > clock.current) : f));
    const n = net.current;
    const focus = m.fighters[focusOf(m)];
    const me = m.fighters[m.me];
    if (!focus) {
      const next = { ...blankHud(), banner: live && !n.synced ? 'waiting for the host' : null };
      setHud((h) => (sameHud(h, next) ? h : next));
      return;
    }
    const watching = me && me.phase === 'out' && focus !== me ? focus : null;
    const own = owned(focus);
    const h = held(focus);
    const g = own && focus.slot < 2 ? focus.guns[focus.slot] : null;
    const slots: [Slot, Slot] = own ? [focus.guns[0] ? { ...focus.guns[0] } : null, focus.guns[1] ? { ...focus.guns[1] } : null] : [h.w ? { w: h.w, r: h.r, mag: -1 } : null, null];
    const s = m.storm;
    const outside = Math.hypot(focus.x - s.x, focus.z - s.z) > s.r && focus.phase === 'ground';
    let storm = '';
    if (m.time >= 0) {
      if (s.shrinking) storm = `storm closing ${fmtClock(s.timer)}`;
      else if (s.timer > 0) storm = `storm moves in ${fmtClock(s.timer)}`;
      else storm = 'storm closed';
    }
    let banner: string | null = null;
    if (me && me.phase === 'out') banner = null;
    else if (m.time < -COUNTDOWN) banner = 'get ready';
    else if (m.time < 0) banner = String(Math.ceil(-m.time));
    else if (clock.current < bannerRef.current.until) banner = bannerRef.current.text;
    else if (focus.phase === 'drop' && focus === me) banner = 'steer to where you want to land';
    let busy = -1;
    let busyText = '';
    if (own && focus.reloadT > 0 && g) {
      busy = 1 - focus.reloadT / reloadOf(g.w, g.r);
      busyText = 'reloading';
    } else if (own && focus.using) {
      busy = 1 - focus.useT / (focus.using === 'bandage' ? 2.2 : 3);
      busyText = focus.using === 'bandage' ? 'bandaging' : 'drinking shield';
    }
    let promptText: string | null = null;
    if (me && me === focus && me.phase === 'ground') {
      const p = prompt(m, me);
      if (p) promptText = 'chest' in p ? 'open chest' : `${p.swap ? 'swap for' : 'pick up'} ${lootName(p.item.def)}`;
    }
    const out = me && me.phase === 'out' ? (me.by >= 0 && m.fighters[me.by] ? `cracked by ${m.fighters[me.by].name}` : me.outCause === 'storm' ? 'lost to the storm' : 'out') + ` · ${ordinal(me.place)} of ${m.fighters.length}` : null;
    const next: Hud = {
      phase: focus.phase,
      alive: aliveCount(m),
      total: m.fighters.length,
      kills: focus.kills,
      hp: Math.ceil(focus.hp),
      shield: Math.ceil(focus.shield),
      slot: own ? focus.slot : h.w ? 0 : 2,
      slots,
      mag: g ? g.mag : -1,
      reserve: g ? focus.ammo[WEAPONS[g.w].ammo] : 0,
      wood: own ? focus.wood : -1,
      bandages: own ? focus.bandages : -1,
      shields: own ? focus.shields : -1,
      busy: Math.round(busy * 30) / 30,
      busyText,
      storm,
      shrinking: s.shrinking,
      outside,
      low: own && focus.hp <= 30 && focus.phase === 'ground',
      banner,
      prompt: promptText,
      jump: !!me && me === focus && me.phase === 'bus' && m.time >= m.map.bus.on,
      watching: watching ? watching.name : null,
      out,
      mine: focus === me,
    };
    setHud((prev) => (sameHud(prev, next) ? prev : next));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Pointer input.

  /** Whichever kind of pointer was just used becomes the way to play. */
  const usePointer = (e: RPointerEvent<HTMLElement>) => {
    const mouseNow = e.pointerType === 'mouse';
    if (mouseNow === touchRef.current) {
      touchRef.current = !mouseNow;
      setTouchMode(!mouseNow);
    }
    return mouseNow;
  };
  const onMouseMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    usePointer(e);
    mouse.current.x = e.nativeEvent.offsetX;
    mouse.current.y = e.nativeEvent.offsetY;
    mouse.current.inside = true;
  };
  const onMouseDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!usePointer(e) || shell.status !== 'playing') return;
    mouse.current.x = e.nativeEvent.offsetX;
    mouse.current.y = e.nativeEvent.offsetY;
    mouse.current.inside = true;
    if (e.button === 0) {
      mouse.current.down = true;
      mouse.current.clicked = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else if (e.button === 2) taps.current.build = true;
  };
  const onMouseUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) mouse.current.down = false;
  };

  const stick = (which: 'move' | 'aim') => {
    const r = which === 'move' ? moveStick : aimStick;
    return {
      onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
        // a mouse over the thumbstick areas means someone is playing with a mouse after all
        if (usePointer(e)) return;
        e.preventDefault();
        if (r.current) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const x = e.nativeEvent.offsetX;
        const y = e.nativeEvent.offsetY;
        r.current = { id: e.pointerId, ox: x, oy: y, x, y };
        const me = match.current?.fighters[match.current.me];
        if (which === 'aim' && me?.phase === 'bus') taps.current.jump = true;
        setSticks((s) => ({ ...s, [which]: true }));
        drawStick(which);
      },
      onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse') return void usePointer(e);
        const s = r.current;
        if (!s || s.id !== e.pointerId) return;
        s.x = e.nativeEvent.offsetX;
        s.y = e.nativeEvent.offsetY;
        // the base follows a thumb that wanders too far
        const dx = s.x - s.ox;
        const dy = s.y - s.oy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R * 1.4) {
          s.ox = s.x - (dx / len) * STICK_R * 1.4;
          s.oy = s.y - (dy / len) * STICK_R * 1.4;
        }
        drawStick(which);
      },
      onPointerUp: (e: RPointerEvent<HTMLDivElement>) => {
        if (r.current?.id !== e.pointerId) return;
        r.current = null;
        setSticks((v) => ({ ...v, [which]: false }));
      },
      onPointerCancel: () => {
        r.current = null;
        setSticks((v) => ({ ...v, [which]: false }));
      },
      onLostPointerCapture: () => {
        r.current = null;
        setSticks((v) => ({ ...v, [which]: false }));
      },
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    };
  };
  /** Puts a thumbstick's base where the thumb came down and its knob where the thumb is now. */
  function drawStick(which: 'move' | 'aim') {
    const s = (which === 'move' ? moveStick : aimStick).current;
    const el = stickEls.current[which];
    if (!s || !el) return;
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    el.style.left = `${s.ox}px`;
    el.style.top = `${s.oy}px`;
    el.classList.toggle('is-firing', which === 'aim' && len > STICK_R * 0.5);
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  const tap = (key: 'build' | 'reload' | 'heal' | 'shield' | 'interact' | 'jump') => ({
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      taps.current[key] = true;
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });

  const m = match.current!;
  const playing = shell.status === 'playing';
  const map = m.map;
  const islandArt = useMemo(() => <IslandArt map={map} />, [map]);
  const focusFighter = m.fighters[focusOf(m)];
  const s = m.storm;
  const stormPath = `M${-HALF - 40} ${-HALF - 40}H${HALF + 40}V${HALF + 40}H${-HALF - 40}Z M${(s.x - s.r).toFixed(1)} ${s.z.toFixed(1)}a${s.r.toFixed(1)} ${s.r.toFixed(1)} 0 1 0 ${(2 * s.r).toFixed(1)} 0a${s.r.toFixed(1)} ${s.r.toFixed(1)} 0 1 0 ${(-2 * s.r).toFixed(1)} 0Z`;
  const mapMarks = (big: boolean) => (
    <>
      <path d={stormPath} fill="rgba(122, 60, 240, 0.45)" fillRule="evenodd" />
      {(s.shrinking || s.next.r < s.r - 0.5) && s.next.r > 0.3 && <circle cx={s.next.x} cy={s.next.z} r={s.next.r} fill="none" stroke="#fff" strokeWidth={big ? 1.2 : 2.2} />}
      {big && focusFighter?.phase === 'bus' && <line x1={map.bus.x0} y1={map.bus.z0} x2={map.bus.x1} y2={map.bus.z1} stroke="#fff" strokeWidth="1.5" strokeDasharray="4 3" />}
      {focusFighter && focusFighter.phase !== 'out' && (
        <g transform={`translate(${focusFighter.x.toFixed(1)} ${focusFighter.z.toFixed(1)}) rotate(${((-focusFighter.aim * 180) / Math.PI + 180).toFixed(0)})`}>
          <path d={big ? 'M0 -5L3.6 3.6L0 1.8L-3.6 3.6Z' : 'M0 -9L6.5 6.5L0 3.2L-6.5 6.5Z'} fill={focusFighter.color} stroke="#fff" strokeWidth={big ? 0.9 : 1.6} strokeLinejoin="round" />
        </g>
      )}
    </>
  );
  const box = `${-HALF - 6} ${-HALF - 6} ${2 * HALF + 12} ${2 * HALF + 12}`;
  const slotLabel = (i: number) => (touchMode ? '' : String(i + 1));

  return (
    <>
      <div
        ref={ref}
        className={`g-scramble-host${touchMode ? '' : ' is-mouse'}`}
        onPointerMove={onMouseMove}
        onPointerDown={onMouseDown}
        onPointerUp={onMouseUp}
        onLostPointerCapture={() => (mouse.current.down = false)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {m.fighters.map((f) =>
        f.id === m.me ? null : (
          <div
            key={f.id}
            ref={(el) => {
              if (el) tags.current.set(f.id, el);
              else tags.current.delete(f.id);
            }}
            className="g-scramble-tag"
            style={{ ['--tag' as string]: f.color, opacity: 0 }}
          >
            {f.name}
          </div>
        ),
      )}
      <div className="g-scramble-pops" aria-hidden="true">
        {pops.current.map((p, i) => (
          <div
            key={i}
            ref={(el) => {
              p.el = el;
            }}
            className="g-scramble-pop"
            style={{ opacity: 0 }}
          />
        ))}
      </div>
      {shell.status !== 'ready' && !shell.compact && (
        <div className={`g-scramble-hud${touchMode ? ' is-touch' : ''}${live ? ' is-online' : ''}`}>
          {hud.outside && <div className="g-scramble-stormfx" aria-hidden="true" />}
          {hud.low && !hud.outside && <div className="g-scramble-lowfx" aria-hidden="true" />}
          <div className="g-scramble-top">
            <span className="g-scramble-pill" aria-label={`${hud.alive} eggs left`}>
              <EggIcon />
              <b>{hud.alive}</b> left
            </span>
            <span className="g-scramble-pill is-kills" aria-label={`${hud.kills} eliminations`}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <b>{hud.kills}</b>
            </span>
          </div>
          {hud.storm && <div className={`g-scramble-storm${hud.shrinking ? ' is-moving' : ''}`}>{hud.storm}</div>}
          <svg
            className="g-scramble-map"
            viewBox={box}
            role="button"
            aria-label="Island map"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBigMap((b) => !b);
            }}
          >
            {islandArt}
            {mapMarks(false)}
          </svg>
          <ol className="g-scramble-feed" aria-live="polite">
            {feed.map((f) => (
              <li key={f.id} className={f.mine ? 'is-mine' : undefined}>
                {f.text}
              </li>
            ))}
          </ol>
          {hud.banner && (
            <div key={hud.banner} className={`g-scramble-banner${/^\d$/.test(hud.banner) ? ' is-count' : ''}${hud.banner.length > 16 ? ' is-note' : ''}`}>
              {hud.banner}
            </div>
          )}
          {hud.out && (
            <div className="g-scramble-out">
              <b>{hud.out}</b>
              {hud.watching && (
                <span>
                  {touchMode ? (
                    <button type="button" className="g-scramble-watch" aria-label="Watch the previous egg" onPointerDown={(e) => { e.preventDefault(); taps.current.watch = -1; }}>
                      ‹
                    </button>
                  ) : (
                    <kbd>←</kbd>
                  )}
                  watching {hud.watching}
                  {touchMode ? (
                    <button type="button" className="g-scramble-watch" aria-label="Watch the next egg" onPointerDown={(e) => { e.preventDefault(); taps.current.watch = 1; }}>
                      ›
                    </button>
                  ) : (
                    <kbd>→</kbd>
                  )}
                </span>
              )}
            </div>
          )}
          {hud.jump && (
            <button type="button" className="g-scramble-jump" {...tap('jump')}>
              jump{!touchMode && <kbd>Space</kbd>}
            </button>
          )}
          {hud.busy >= 0 && (
            <div className="g-scramble-busy" role="status">
              <span>{hud.busyText}</span>
              <i style={{ width: `${Math.max(0, Math.min(1, hud.busy)) * 100}%` }} />
            </div>
          )}
          {hud.prompt && hud.phase === 'ground' && (
            <button type="button" className="g-scramble-prompt" {...tap('interact')}>
              {!touchMode && <kbd>E</kbd>}
              {hud.prompt}
            </button>
          )}
          {hud.phase !== 'none' && hud.phase !== 'bus' && (
            <div className="g-scramble-bottom">
              <div className="g-scramble-bars" aria-label={`${hud.hp} health, ${hud.shield} shield`}>
                <div className="g-scramble-bar is-shield">
                  <i style={{ width: `${hud.shield}%` }} />
                  <span>{hud.shield}</span>
                </div>
                <div className={`g-scramble-bar is-hp${hud.hp <= 30 ? ' is-low' : ''}`}>
                  <i style={{ width: `${hud.hp}%` }} />
                  <span>{hud.hp}</span>
                </div>
              </div>
              <div className="g-scramble-slots" role="group" aria-label="Weapons">
                {[0, 1, 2].map((i) => {
                  const g = i < 2 ? hud.slots[i] : null;
                  const on = hud.slot === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      tabIndex={-1}
                      className={`g-scramble-slot${on ? ' is-on' : ''}${i < 2 && !g ? ' is-empty' : ''}`}
                      style={g ? { ['--rarity' as string]: RARITY_COLORS[g.r] } : undefined}
                      aria-label={i === 2 ? 'Spatula' : g && g.w ? `${WEAPONS[g.w].name}` : 'Empty slot'}
                      aria-pressed={on}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        taps.current.slot = i;
                      }}
                    >
                      {slotLabel(i) && <small>{slotLabel(i)}</small>}
                      {i === 2 ? <WeaponIcon w={null} size={30} /> : g ? <WeaponIcon w={g.w} size={34} /> : null}
                      {on && i < 2 && g && hud.mag >= 0 && (
                        <em>
                          {hud.mag}
                          <span>/{hud.reserve}</span>
                        </em>
                      )}
                    </button>
                  );
                })}
              </div>
              {hud.wood >= 0 && (
                <div className="g-scramble-mats">
                  <span className={hud.wood >= WOOD_MAX ? 'is-full' : undefined} title="Wood">
                    <WoodIcon size={20} />
                    {hud.wood}
                    {!touchMode && <kbd>Space</kbd>}
                  </span>
                  <span className={hud.bandages ? undefined : 'is-none'} title="Bandages">
                    <BandageIcon size={20} />
                    {hud.bandages}
                    {!touchMode && <kbd>H</kbd>}
                  </span>
                  <span className={hud.shields ? undefined : 'is-none'} title="Shield potions">
                    <ShieldIcon size={20} />
                    {hud.shields}
                    {!touchMode && <kbd>G</kbd>}
                  </span>
                  {hud.mag >= 0 && hud.slots[hud.slot as 0 | 1]?.w && (
                    <span className="g-scramble-ammo" title="Ammo">
                      <AmmoIcon a={WEAPONS[hud.slots[hud.slot as 0 | 1]!.w!].ammo} size={20} />
                      {hud.reserve}
                      <small>/{AMMO_MAX[WEAPONS[hud.slots[hud.slot as 0 | 1]!.w!].ammo]}</small>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {bigMap && shell.status !== 'ready' && (
        <div
          className="g-scramble-bigmap"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setBigMap(false);
          }}
        >
          <svg viewBox={box} role="img" aria-label="Island map">
            {islandArt}
            {mapMarks(true)}
          </svg>
          <small>{touchMode ? 'tap to close' : 'M or click to close'}</small>
        </div>
      )}
      {touchMode && playing && !net.current.over && (
        <div className="g-scramble-touch">
          <div className="g-scramble-zone is-move" {...stick('move')}>
            {sticks.move && moveStick.current && <StickArt s={moveStick.current} at={(el) => {
                  stickEls.current.move = el;
                }} />}
          </div>
          <div className="g-scramble-zone is-aim" {...stick('aim')}>
            {sticks.aim && aimStick.current && <StickArt s={aimStick.current} at={(el) => {
                  stickEls.current.aim = el;
                }} />}
          </div>
          {hud.phase === 'ground' && (
            <div className="g-scramble-buttons">
              <button type="button" tabIndex={-1} aria-label="Build a wall" {...tap('build')}>
                <WoodIcon size={22} />
                <span>wall</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Reload" {...tap('reload')}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>reload</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Use a bandage" className={hud.bandages ? undefined : 'is-none'} {...tap('heal')}>
                <BandageIcon size={22} />
                <span>{hud.bandages}</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Drink a shield potion" className={hud.shields ? undefined : 'is-none'} {...tap('shield')}>
                <ShieldIcon size={22} />
                <span>{hud.shields}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** A thumbstick: the base where the thumb came down, the knob moved on the DOM (see drawStick). */
function StickArt({ s, at }: { s: Stick; at: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={at} className="g-scramble-stick" style={{ left: s.ox, top: s.oy }} aria-hidden="true">
      <i />
    </div>
  );
}
