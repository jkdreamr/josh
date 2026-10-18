import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type View } from './scene';
import {
  COUNTDOWN,
  FIGHTER_COLORS,
  LEVELS,
  MAX_FIGHTERS,
  SLOT_MELEE,
  SLOT_THROW,
  aliveCount,
  angleDiff,
  concealed,
  createMatch,
  fmtClock,
  held,
  heldGun,
  ordinal,
  owned,
  prompt,
  scoreOf,
  soloMatch,
  step,
  type Cause,
  type Ev,
  type Fighter,
  type Input,
  type Level,
  type Match,
} from './logic';
import { configOf, parsePacket, type Bots } from './net';
import { FLUSH, TICK_MS, catchUp, ending, flush, guestMatch, hostMatch, newSession, offscreen, receive, resultCard, share, tick, type Session } from './session';
import { ARMOR_NAMES, MELEE, RARITY_COLORS, SCOPES, THROW, THROWS, THROW_IDS, USES, USE_IDS, WEAPONS, WOOD_MAX, ammoCap, isMelee, isThrow, isWeapon, lootName, reloadOf, type Ammo, type MeleeId, type ThrowId, type UseId, type WeaponId } from './items';
import { HALF, SUPPLY_FALL, placeAt } from './map';
import { AmmoIcon, ArmorIcon, EggIcon, HowToPlay, IslandArt, PackIcon, PlaceNames, ScopeIcon, USE_KEYS, UseIcon, WeaponIcon, WoodIcon, keyCode } from './hud';
import { meta } from './meta';
import './scramble.css';

const LEVEL = defineSetting('scramble:level', LEVELS, 'normal');
const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const;
/** With computer eggs in the room, whether more of them fill the island up to twenty. */
const FILL = defineSetting('scramble:fill', ['fill', 'none'] as const, 'fill');
/** A Scramble room starts full: seven bots with the host, and Fill to 20 adds the rest. */
const ROOM_BOTS = (meta.online?.seats ?? 8) - 1;
const fillOptions = [
  ['fill', 'Fill to 20'],
  ['none', 'Room Bots Only'],
] as const;
/** The host gives everyone a moment to get its first packet before the countdown. */
const HOST_LEAD = 1.2;
const STICK_R = 52;
const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);
/** How far a touch throw goes for how far the right thumb is pushed (pixels from where it came down). */
const tossReach = (len: number) => THROW.min + Math.max(0, Math.min(1, (len - 12) / (STICK_R - 12))) * (THROW.max - THROW.min);
/** Seconds a touch throw let go of too soon after the last one waits to go. */
const TOSS_WAIT = 0.8;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} defaultBots={ROOM_BOTS}>
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

/**
 * Settings for online matches. The room's bots are its computer eggs (the host adds them in the room, and they fill
 * every empty seat unless the host takes some away). With any in the room, the host picks whether more fill the island
 * to twenty, and how sharp they all are, and tells the room.
 */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [fill, setFill] = useSetting(FILL);
  const [picked, setPicked] = useState<{ bots: Bots; level: Level } | null>(null);
  const host = online?.isHost ?? true;
  const bots = online?.bots.length ?? 0;
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send(configOf(online.round, fill, level));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, fill, level]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from !== 0 || !p) return;
      if (p.k === 'cfg') setPicked({ bots: p.bots, level: p.level });
      // joining while a match is on, the host's state says how it was set up
      else if (p.k === 'S') {
        const bots: Bots = p.roster.length >= MAX_FIGHTERS ? 'fill' : 'none';
        setPicked((x) => (x && x.bots === bots && x.level === p.level ? x : { bots, level: p.level }));
      }
    });
  }, [online]);
  return (
    <>
      {bots > 0 &&
        (host ? (
          <>
            <Segmented label="Computer Eggs" value={fill} options={fillOptions} onChange={setFill} />
            <Segmented label="How Sharp" value={level} options={levelOptions} onChange={setLevel} />
          </>
        ) : (
          <div className="arcade-field">
            <span>Computer Eggs</span>
            <div className="g-scramble-hostpick">
              <b>{picked ? `${picked.bots === 'fill' ? 'fill to 20' : 'room bots only'}, ${picked.level}` : '…'}</b>
              <small>picked by the host</small>
            </div>
          </div>
        ))}
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

type Slot = { w: WeaponId; r: number; mag: number } | null;
type Hud = {
  phase: Fighter['phase'] | 'none';
  alive: number;
  total: number;
  kills: number;
  hp: number;
  shield: number;
  boost: number;
  slot: number;
  slots: [Slot, Slot];
  melee: MeleeId;
  /** The throwable in the throw slot, how many (-1 when it's someone else's egg), and how many kinds we carry. */
  toss: { w: ThrowId; n: number; kinds: number } | null;
  mag: number;
  reserve: number;
  ammo: Ammo | null;
  wood: number;
  /** Consumables by kind, or null when it's someone else's egg. */
  items: Record<UseId, number> | null;
  scope: number;
  pack: number;
  /** Helmet and vest levels (shown for someone else's egg too, as its owner reports them). */
  helmet: number;
  vest: number;
  /** 0..1 while reloading or using something, else -1. */
  busy: number;
  busyText: string;
  storm: string;
  shrinking: boolean;
  outside: boolean;
  low: boolean;
  /** Warming up at a campfire. */
  warm: boolean;
  /** The place just walked (or landed) into, while its name is up, and the place the egg we see is in. */
  arrive: string | null;
  where: string | null;
  banner: string | null;
  prompt: string | null;
  jump: boolean;
  watching: string | null;
  out: string | null;
  mine: boolean;
};
const deep = new Set<keyof Hud>(['slots', 'toss', 'items']);
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every((k) => (deep.has(k) ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : a[k] === b[k]));
const blankHud = (): Hud => ({ phase: 'none', alive: 0, total: 0, kills: 0, hp: 100, shield: 0, boost: 0, slot: SLOT_MELEE, slots: [null, null], melee: 'spatula', toss: null, mag: 0, reserve: 0, ammo: null, wood: 0, items: null, scope: 0, pack: 0, helmet: 0, vest: 0, busy: -1, busyText: '', storm: '', shrinking: false, outside: false, low: false, warm: false, arrive: null, where: null, banner: null, prompt: null, jump: false, watching: null, out: null, mine: false });

type Stick = { id: number; ox: number; oy: number; x: number; y: number };
/** A kill feed line; it fades out at `until` on the game clock (so a paused game keeps it up). */
type Feed = { id: number; text: string; mine: boolean; until: number };
type Pop = { el: HTMLDivElement | null; x: number; y: number; z: number; age: number; live: boolean };
/** `toss` is how far a touch throw goes, `tossAim` which way, and `tossBy` the match clock it gives up at if it can't go yet. */
type Taps = { build: boolean; reload: boolean; use: Input['use']; interact: boolean; jump: boolean; cycle: number; slot: number; watch: number; toss: number; tossAim: number; tossBy: number };
const noTaps = (): Taps => ({ build: false, reload: false, use: null, interact: false, jump: false, cycle: 0, slot: -1, watch: 0, toss: 0, tossAim: 0, tossBy: 0 });

const BUSY_TEXT: Record<UseId, string> = { bandage: 'bandaging', medkit: 'using a medkit', mini: 'drinking a mini shield', shield: 'drinking a shield potion', coffee: 'drinking coffee', smoothie: 'drinking a smoothie', tart: 'eating a golden egg tart' };
/** A name with its article, for the kill feed: "with a pistol", "with an smg", "with hot sauce". */
const withA = (name: string) => `${/^[aeiou]|^SMG/.test(name) ? 'an' : 'a'} ${name}`;
function causeName(w: Cause) {
  if (w === 'storm') return 'the storm';
  if (w === 'left') return '';
  if (w === 'sauce') return 'hot sauce';
  if (w === 'grenade' || w === 'barrel') return withA(w);
  if (w === 'impulse') return withA('impulse egg');
  if (isMelee(w)) return withA(MELEE[w].name);
  return withA(WEAPONS[w].name);
}

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
  const [fill] = useSetting(FILL);
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
      // the room's bots, and with any of them, more to fill the island when the host wants it
      const bots = online!.bots.length;
      const h = hostMatch(online!.players, online!.seat, randomSeed(), level, bots > 0 && fill === 'fill' ? MAX_FIGHTERS : bots, COUNTDOWN + HOST_LEAD);
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
  /** The named place our egg is in, the last one whose name went up, when it last came or went, and until when the name shows. */
  const placeRef = useRef({ in: -1, said: -1, at: -99, until: -1 });
  const spectate = useRef(-1);
  const soloEnd = useRef(-1);

  // input that arrives between frames
  const mouse = useRef({ x: 0, y: 0, inside: false, down: false, clicked: false });
  const taps = useRef<Taps>(noTaps());
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
  const pops = useRef<Pop[]>(Array.from({ length: 24 }, () => ({ el: null, x: 0, y: 0, z: 0, age: 9, live: false })));
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

  /** Whether this game runs the match (the host when it started), and the room's host hand-offs by then. */
  const hosting = useRef(!!online?.isHost);
  const handoffs = useRef(online?.handoffs ?? 0);
  /**
   * The result card for an online match. `report` once the host has called it; `early` when we are out and have seen
   * enough before the end: the match goes on for everyone else (the host's timer keeps running it), and the card
   * keeps up with it until the result comes, which is still reported.
   */
  const finishOnline = (report: boolean, early = false) => {
    const n = net.current;
    const o = onlineRef.current;
    const m = match.current!;
    const winner = m.fighters[m.winner];
    if (report && !n.reported && o) {
      n.reported = true;
      o.reportResult(o.round, winner && winner.seat >= 0 ? winner.seat : null);
    }
    if (n.over && !n.early) return;
    const { won, ...card } = resultCard(m, early, hosting.current);
    n.early = early;
    if (n.over) {
      shellRef.current.updateOver(card);
      return;
    }
    n.over = true;
    sfx.play(won ? 'win' : 'lose');
    shellRef.current.gameOver(undefined, card);
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
      // Left out of the host's match (joined just as it was set up): sit it out rather than wait for good.
      const packet = d as { k?: unknown; round?: unknown; roster?: unknown } | null;
      if (!n.synced && from === 0 && packet?.k === 'S' && packet.round === o.round && Array.isArray(packet.roster) && !packet.roster.includes(o.seat)) {
        if (shellRef.current.status === 'playing') shellRef.current.gameOver(undefined, { title: 'Sitting This One Out', detail: 'You Will Be in the Next Round.' });
        return;
      }
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
      // the host left and someone took over: the match its game ran is over (the shell has said so), and a card that
      // went up early stops waiting for it
      if (o.handoffs !== handoffs.current) {
        if (n.early) {
          n.early = false;
          const card = resultCard(m, false, false);
          shellRef.current.updateOver({ title: card.title, detail: `${card.detail} The host left before the end.` });
        }
        return;
      }
      // a hidden tab gets no frames, so the match carries on from here: our egg stands still but the storm still
      // bites and the glide still lands. A host keeps the computer eggs and everyone's pickups going, hidden or done
      // watching.
      if (offscreen(n, me, document.hidden, shellRef.current.status === 'playing')) {
        const mine = m.fighters[m.me];
        if (mine) {
          mine.input.fire = false;
          mine.input.mx = 0;
          mine.input.mz = 0;
        }
        mouse.current.down = false;
        catchUp(n, m, o.seat, now - lastStep.current);
        lastStep.current = now;
        for (const packet of flush(n, o.round, FLUSH)) o.send(packet);
      }
      // done watching: nothing draws the match any more, but the card keeps count and the room still hears who won from us
      if (n.over) m.events.length = 0;
      const call = n.synced ? ending(n, m, me, now) : null;
      if (call) finishRef.current(call === 'report');
      else if (n.early) finishRef.current(false, true);
      for (const out of tick(n, m, me, o.players.map((p) => p.seat), now)) o.send(out.d, { fast: out.fast });
    }, TICK_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  // -------------------------------------------------------------------------------------------------------------
  // Input.

  const throwing = (f: Fighter | undefined) => !!f && owned(f) && f.phase === 'ground' && f.slot === SLOT_THROW && THROW_IDS.some((k) => f.throws[k] > 0);

  function readInput(m: Match, me: Fighter, v: View | null, dt: number) {
    const inp = me.input;
    const t = taps.current;
    // Enter and left/right taps only count once you're out (leave, watch another egg): drop any made before then
    keys.pressed('Enter', 'left', 'right');
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
    // aiming: the right thumb, the mouse, or the way you walk. With a throwable out, the right thumb sets how far
    // it goes and letting go throws it; the mouse throws to wherever it points.
    const tossing = throwing(me);
    let fire = false;
    const as = aimStick.current;
    const drag = !!as && Math.hypot(as.x - as.ox, as.y - as.oy) > 10;
    if (drag) {
      const dx = as.x - as.ox;
      const dy = as.y - as.oy;
      const len = Math.hypot(dx, dy);
      lastAim.current = assist(m, me, Math.atan2(dx, dy));
      if (tossing) inp.reach = tossReach(len);
      else fire = len > STICK_R * 0.5;
    } else if (mouse.current.inside && v && !touchRef.current) {
      const g = v.ground(mouse.current.x, mouse.current.y, 1);
      if (g && Math.hypot(g.x - me.x, g.z - me.z) > 0.3) lastAim.current = Math.atan2(g.x - me.x, g.z - me.z);
      inp.reach = g ? Math.hypot(g.x - me.x, g.z - me.z) : 0;
    } else {
      if (mx || mz) lastAim.current = Math.atan2(mx, mz);
      if (!as) inp.reach = 0;
    }
    // a click too quick for a frame still fires (or throws) once
    if ((mouse.current.down || mouse.current.clicked) && !touchRef.current) fire = true;
    // a touch throw goes where the right thumb aimed it. One let go of during the throw cooldown waits it out (for a
    // moment), and a new drag of the right thumb keeps the aim line until it goes.
    const toss = tossing && t.toss > 0 && m.clock < t.tossBy ? t.toss : 0;
    const go = toss > 0 && (!drag || me.fireT <= dt);
    if (go) {
      fire = true;
      inp.reach = toss;
    }
    inp.aim = go ? t.tossAim : lastAim.current;
    inp.fire = fire && me.phase === 'ground';
    if (keys.pressed('Digit1')) inp.slot = 0;
    if (keys.pressed('Digit2')) inp.slot = 1;
    if (keys.pressed('Digit3')) inp.slot = SLOT_MELEE;
    if (keys.pressed('Digit4')) inp.slot = SLOT_THROW;
    if (t.slot >= 0) inp.slot = t.slot;
    if (keys.pressed('KeyQ')) inp.cycle = 1;
    if (t.cycle) inp.cycle = t.cycle;
    if (keys.pressed('KeyR') || t.reload) inp.reload = true;
    if (keys.pressed('KeyE', 'KeyF') || t.interact) inp.interact = true;
    USE_IDS.forEach((w) => {
      if (keys.pressed(keyCode(USE_KEYS[w]))) inp.use = w;
    });
    if (keys.pressed('KeyH')) inp.use = 'bestHeal';
    if (keys.pressed('KeyG')) inp.use = 'bestShield';
    if (keys.pressed('KeyC')) inp.use = 'coffee';
    if (t.use) inp.use = t.use;
    const space = keys.pressed('Space');
    if (me.phase === 'bus') {
      if (space || t.jump || mouse.current.clicked || inp.interact || t.build) inp.jump = true;
    } else if (space || t.build) inp.build = true;
    mouse.current.clicked = false;
    taps.current = noTaps();
    if (toss && me.fireT > dt) {
      taps.current.toss = toss;
      taps.current.tossAim = t.tossAim;
      taps.current.tossBy = t.tossBy;
    }
  }

  /** On a touchscreen, a near miss with the right thumb snaps onto the egg it was meant for. */
  function assist(m: Match, me: Fighter, a: number) {
    const g = heldGun(me);
    const range = g ? WEAPONS[g].range : throwing(me) ? THROW.max : 3;
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
      if (me && me.phase !== 'out' && !n.over) readInput(m, me, v, dt);
      else watchInput(m);
      if (keys.pressed('KeyM')) setBigMap((b) => !b);

      step(m, dt);
      const focus = focusOf(m);
      for (const e of m.events.splice(0)) {
        react(m, e, focus);
        v?.react(e, m, focus);
        if (live && o) share(n, e, o.seat);
      }
      // the name goes up on walking or landing into a named place (not again for one we only just stepped out of)
      const here = me && me.phase === 'ground' ? placeAt(m.map, me.x, me.z) : -1;
      const pl = placeRef.current;
      if (here !== pl.in) {
        pl.in = here;
        if (here >= 0 && !n.over && (here !== pl.said || clock.current - pl.at > 20)) {
          pl.said = here;
          pl.until = clock.current + 3;
        }
        pl.at = clock.current;
      }
      if (live && o) for (const packet of flush(n, o.round, dt)) o.send(packet);

      if (v) {
        v.frame(m, focus, dt, clock.current, { aimLine: focus === m.me, overview: false });
        placeOverlays(m, v, dt, focus);
      }

      // the end: once one egg is left (out or not, you watch the rest until then, or leave when you like)
      if (!live) {
        if (me && !n.over && m.ended) {
          if (soloEnd.current < 0) soloEnd.current = clock.current;
          if (clock.current - soloEnd.current > 2.2) finishSolo(m, me);
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

  /** Out of the match: arrows (or the on-screen buttons) switch whose view you watch, and Enter leaves. */
  function watchInput(m: Match) {
    if (keys.pressed('Enter') && canLeave()) leave();
    const step = (keys.pressed('right', 'KeyE') ? 1 : 0) - (keys.pressed('left') ? 1 : 0) + taps.current.watch;
    taps.current.watch = 0;
    if (!step) return;
    const alive = m.fighters.filter((f) => f.phase !== 'out');
    if (!alive.length) return;
    const at = alive.findIndex((f) => f.id === spectate.current);
    spectate.current = alive[(at + step + alive.length) % alive.length].id;
  }

  /** Out, and seen enough: on to the results. Online the match goes on without us (the host's game still runs it). */
  const canLeave = () => {
    const m = match.current;
    const me = m?.fighters[m.me];
    return !!me && me.phase === 'out' && !net.current.over;
  };
  function leave() {
    const m = match.current!;
    const me = m.fighters[m.me];
    if (!canLeave() || !me) return;
    if (!live) finishSolo(m, me);
    else finishRef.current(false, true);
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
    const how = won ? '' : me.by >= 0 && me.by !== me.id ? ` Cracked by ${m.fighters[me.by]?.name ?? 'someone'}.` : me.outCause === 'storm' ? ' The storm got you.' : '';
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
      case 'revolver':
        sfx.noise(0.2, 0.26 * k);
        sfx.tone({ freq: 420, to: 70, dur: 0.22, type: 'sawtooth', vol: 0.09 * k });
        break;
      case 'smg':
        sfx.noise(0.04, 0.1 * k);
        sfx.tone({ freq: 900, to: 300, dur: 0.04, type: 'square', vol: 0.04 * k });
        break;
      case 'micro':
        sfx.noise(0.03, 0.08 * k);
        sfx.tone({ freq: 1100, to: 420, dur: 0.03, type: 'square', vol: 0.035 * k });
        break;
      case 'rifle':
      case 'burst':
        sfx.noise(0.07, 0.15 * k);
        sfx.tone({ freq: 520, to: 120, dur: 0.08, type: 'sawtooth', vol: 0.06 * k });
        break;
      case 'lmg':
        sfx.noise(0.08, 0.17 * k);
        sfx.tone({ freq: 380, to: 90, dur: 0.08, type: 'sawtooth', vol: 0.06 * k });
        break;
      case 'scout':
        sfx.noise(0.16, 0.22 * k);
        sfx.tone({ freq: 1100, to: 140, dur: 0.2, type: 'sawtooth', vol: 0.07 * k });
        break;
      case 'shotgun':
      case 'double':
        sfx.noise(0.22, 0.3 * k);
        sfx.tone({ freq: 190, to: 50, dur: 0.18, type: 'sawtooth', vol: 0.1 * k });
        break;
      case 'auto':
        sfx.noise(0.15, 0.24 * k);
        sfx.tone({ freq: 230, to: 70, dur: 0.12, type: 'sawtooth', vol: 0.08 * k });
        break;
      case 'sniper':
        sfx.noise(0.3, 0.28 * k);
        sfx.tone({ freq: 1400, to: 90, dur: 0.35, type: 'sawtooth', vol: 0.08 * k });
        break;
      case 'crossbow':
        sfx.tone({ freq: 260, to: 120, dur: 0.12, type: 'triangle', vol: 0.09 * k });
        break;
      case 'launcher':
        sfx.tone({ freq: 220, to: 560, dur: 0.25, type: 'sawtooth', vol: 0.07 * k });
        sfx.noise(0.15, 0.1 * k);
        break;
      case 'hsmg':
        sfx.noise(0.05, 0.13 * k);
        sfx.tone({ freq: 640, to: 160, dur: 0.05, type: 'square', vol: 0.05 * k });
        break;
      case 'marksman':
        sfx.noise(0.12, 0.2 * k);
        sfx.tone({ freq: 800, to: 120, dur: 0.15, type: 'sawtooth', vol: 0.07 * k });
        break;
      case 'minigun':
        sfx.noise(0.03, 0.09 * k);
        sfx.tone({ freq: 300, to: 120, dur: 0.035, type: 'sawtooth', vol: 0.04 * k });
        break;
      case 'flare':
        // a pop and a whistle going up
        sfx.noise(0.1, 0.18 * k);
        sfx.tone({ freq: 500, to: 1800, dur: 0.9, type: 'triangle', vol: 0.06 * k });
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
      case 'supply':
        if (m.fighters[m.me]?.phase === 'out') break;
        say('a supply drop is coming down', 3);
        sfx.tone({ freq: 660, to: 990, dur: 0.25, type: 'triangle', vol: 0.12 });
        sfx.tone({ freq: 990, to: 1320, dur: 0.25, type: 'triangle', vol: 0.12, delay: 0.25 });
        break;
      case 'jump':
        if (mine) sfx.play('jump');
        break;
      case 'bounce':
        if (f && (mine || near(f.x, f.z) > 0.2)) {
          const k = mine ? 1 : near(f.x, f.z);
          sfx.tone({ freq: 240, to: 720, dur: 0.28, type: 'triangle', vol: 0.12 * k });
          sfx.tone({ freq: 480, to: 1100, dur: 0.2, type: 'sine', vol: 0.06 * k, delay: 0.08 });
          if (mine) buzz(30);
        }
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
        if (f && (mine || near(f.x, f.z) > 0.6)) {
          if (held(f).w === 'pan') sfx.tone({ freq: 520, to: 260, dur: 0.12, type: 'square', vol: 0.06 });
          else sfx.tone({ freq: 340, to: 140, dur: 0.1, type: 'triangle', vol: 0.08 });
        }
        break;
      case 'throw':
        if (f && (mine || near(f.x, f.z) > 0.3)) sfx.tone({ freq: 500, to: 900, dur: 0.15, type: 'triangle', vol: 0.06 * (mine ? 1 : near(f.x, f.z)) });
        break;
      case 'zone': {
        const k = near(e.x, e.z);
        if (k <= 0) break;
        if (e.k === 'flour') sfx.noise(0.35, 0.2 * k);
        else if (e.k === 'bush') sfx.tone({ freq: 220, to: 520, dur: 0.3, type: 'triangle', vol: 0.08 * k });
        else if (e.k === 'jam') {
          sfx.noise(0.2, 0.1 * k);
          sfx.tone({ freq: 140, to: 80, dur: 0.25, type: 'triangle', vol: 0.07 * k });
        } else {
          sfx.noise(0.5, 0.12 * k);
          sfx.tone({ freq: 160, to: 90, dur: 0.4, type: 'sawtooth', vol: 0.05 * k });
        }
        break;
      }
      case 'thud':
        // a frying pan turning a bullet away, near us
        if (e.what === 'pan' && near(e.x, e.z) > 0.5) sfx.tone({ freq: 1500, to: 900, dur: 0.12, type: 'square', vol: 0.06 });
        // and the clang of a bullet off a car or a lamp post
        else if ((e.what === 'car' || e.what === 'post') && near(e.x, e.z) > 0.6) sfx.tone({ freq: 2100, to: 1300, dur: 0.06, type: 'square', vol: 0.035 });
        break;
      case 'hit':
        if (e.f === m.me) {
          popNumber(e.x, e.z, String(Math.round(e.took)), e.shield);
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
      case 'pulse': {
        // a soft thump and a whoosh
        const k = near(e.x, e.z);
        if (k <= 0) break;
        sfx.tone({ freq: 90, to: 260, dur: 0.3, type: 'sine', vol: 0.14 * k });
        sfx.noise(0.25, 0.12 * k);
        break;
      }
      case 'called':
        if (e.f === m.me) say('flare away: a supply drop is on its way', 3);
        break;
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
        if (mine) sfx.play('coin', e.what === 'shield' || e.what === 'mini' ? 0.9 : e.what === 'coffee' ? 1.5 : 1.2);
        break;
      case 'took':
        if (e.f === m.me) sfx.play(e.def.kind === 'gun' || e.def.kind === 'melee' ? 'select' : 'blip', 1.3);
        break;
      case 'opened':
        if (e.f === m.me) {
          const c = m.map.containers[e.c];
          if (c?.kind === 'chest' || c?.kind === 'supply') sfx.play('coin', c.kind === 'supply' || c.gold ? 0.8 : 1);
          else if (c?.kind === 'fridge') sfx.play('coin', 1.2);
          else if (c?.kind === 'toilet') sfx.tone({ freq: 900, to: 300, dur: 0.12, type: 'square', vol: 0.07 });
          else if (c?.kind === 'crate' || c?.kind === 'hay') sfx.noise(0.15, 0.15);
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
      const show = f.id !== focus && (f.phase === 'ground' || f.phase === 'drop') && !concealed(m, f, eye) && !!eye && Math.hypot(f.x - eye.x, f.z - eye.z) < 40 && (f.inside < 0 || f.inside === eye.inside);
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
    const slots: [Slot, Slot] = own ? [focus.guns[0] ? { ...focus.guns[0] } : null, focus.guns[1] ? { ...focus.guns[1] } : null] : [isWeapon(h.w) ? { w: h.w, r: h.r, mag: -1 } : null, null];
    const kinds = THROW_IDS.filter((k) => focus.throws[k] > 0).length;
    // someone else's egg: only what's in hand shows, not how many
    const toss = own && kinds > 0 ? { w: focus.throws[focus.pick] > 0 ? focus.pick : THROW_IDS.find((k) => focus.throws[k] > 0)!, n: 0, kinds } : !own && isThrow(h.w) ? { w: h.w, n: -1, kinds: 1 } : null;
    if (toss && own) toss.n = focus.throws[toss.w];
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
      busy = 1 - focus.useT / USES[focus.using].time;
      busyText = BUSY_TEXT[focus.using];
    } else if (own && g && WEAPONS[g.w].spin && focus.spin > 0 && focus.spin < 1) {
      busy = focus.spin;
      busyText = 'spinning up';
    }
    let promptText: string | null = null;
    if (me && me === focus && me.phase === 'ground') {
      const p = prompt(m, me);
      if (p && 'chest' in p) {
        const c = m.map.containers[p.chest];
        promptText = c.kind === 'supply' ? 'open supply drop' : c.kind === 'fridge' ? 'open the fridge' : c.gold ? 'open the golden chest' : 'open chest';
      } else if (p) {
        const k = p.item.def.kind;
        const have = k === 'melee' ? MELEE[me.melee].name : k === 'helmet' || k === 'vest' ? ARMOR_NAMES[k][me[k]] : 'gun';
        promptText = `${p.swap ? `swap ${have} for` : 'pick up'} ${lootName(p.item.def)}`;
      }
    }
    const out = me && me.phase === 'out' ? (me.by >= 0 && me.by !== me.id && m.fighters[me.by] ? `cracked by ${m.fighters[me.by].name}` : me.outCause === 'storm' ? 'lost to the storm' : 'out') + ` · ${ordinal(me.place)} of ${m.fighters.length}` : null;
    const gw = g ? WEAPONS[g.w] : null;
    const next: Hud = {
      phase: focus.phase,
      alive: aliveCount(m),
      total: m.fighters.length,
      kills: focus.kills,
      hp: Math.ceil(focus.hp),
      shield: Math.ceil(focus.shield),
      boost: own ? Math.ceil(focus.boost) : 0,
      slot: own ? focus.slot : isWeapon(h.w) ? 0 : isThrow(h.w) ? SLOT_THROW : SLOT_MELEE,
      slots,
      melee: own ? focus.melee : isMelee(h.w) ? h.w : 'spatula',
      toss,
      mag: g ? g.mag : -1,
      reserve: g && gw && !gw.call ? focus.ammo[gw.ammo] : 0,
      // a flare gun takes no ammo
      ammo: gw && !gw.call ? gw.ammo : null,
      wood: own ? focus.wood : -1,
      items: own ? { ...focus.items } : null,
      scope: own ? focus.scope : 0,
      pack: own ? focus.pack : 0,
      helmet: focus.helmet,
      vest: focus.vest,
      busy: Math.round(busy * 30) / 30,
      busyText,
      storm,
      shrinking: s.shrinking,
      outside,
      low: own && focus.hp <= 30 && focus.phase === 'ground',
      warm: focus.warm && focus.phase === 'ground',
      arrive: clock.current < placeRef.current.until && placeRef.current.said >= 0 ? m.map.places[placeRef.current.said]?.name ?? null : null,
      where: focus.phase === 'ground' ? (m.map.places[placeAt(m.map, focus.x, focus.z)]?.name ?? null) : null,
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

  /** Keeps a pointer's moves coming here even off the element (a pointer that is already gone can't be kept). */
  const capture = (e: RPointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* no such pointer any more */
    }
  };
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
      capture(e);
    } else if (e.button === 2) taps.current.build = true;
  };
  const onMouseUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) mouse.current.down = false;
  };

  const stick = (which: 'move' | 'aim') => {
    const r = which === 'move' ? moveStick : aimStick;
    const release = (throwNow: boolean) => {
      const s = r.current;
      // with a throwable out, letting go of the right thumb throws it, as far as the thumb was pushed
      if (throwNow && which === 'aim' && s) {
        const len = Math.hypot(s.x - s.ox, s.y - s.oy);
        const m = match.current;
        if (len > 14 && m && throwing(m.fighters[m.me])) {
          taps.current.toss = tossReach(len);
          taps.current.tossAim = lastAim.current;
          taps.current.tossBy = m.clock + TOSS_WAIT;
        }
      }
      r.current = null;
      setSticks((v) => ({ ...v, [which]: false }));
    };
    return {
      onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
        // a mouse over the thumbstick areas means someone is playing with a mouse after all
        if (usePointer(e)) return;
        e.preventDefault();
        if (r.current) return;
        capture(e);
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
        release(true);
      },
      onPointerCancel: () => release(false),
      onLostPointerCapture: () => {
        if (r.current) release(false);
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
    const tossing = which === 'aim' && throwing(match.current?.fighters[match.current.me]);
    el.classList.toggle('is-firing', which === 'aim' && !tossing && len > STICK_R * 0.5);
    el.classList.toggle('is-tossing', tossing && len > 14);
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  const tap = (set: (t: Taps) => void) => ({
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      set(taps.current);
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
  // supply drops show on the map from the moment they're on their way until someone opens them
  const drops = [...map.drops, ...map.flares].map((id) => map.containers[id]).filter((c) => c && m.time >= c.at - SUPPLY_FALL && !m.opened[c.id]);
  const mapMarks = (big: boolean) => (
    <>
      <path d={stormPath} fill="rgba(122, 60, 240, 0.45)" fillRule="evenodd" />
      {(s.shrinking || s.next.r < s.r - 0.5) && s.next.r > 0.3 && <circle cx={s.next.x} cy={s.next.z} r={s.next.r} fill="none" stroke="#fff" strokeWidth={big ? 1.6 : 3} />}
      {big && focusFighter?.phase === 'bus' && <line x1={map.bus.x0} y1={map.bus.z0} x2={map.bus.x1} y2={map.bus.z1} stroke="#fff" strokeWidth="2" strokeDasharray="5 4" />}
      {drops.map((c) => (
        <rect key={c.id} x={c.x - (big ? 5 : 8)} y={c.z - (big ? 5 : 8)} width={big ? 10 : 16} height={big ? 10 : 16} rx="2" fill="#2f7de1" stroke="#fff" strokeWidth={big ? 1.6 : 2.6} />
      ))}
      {focusFighter && focusFighter.phase !== 'out' && (
        <g transform={`translate(${focusFighter.x.toFixed(1)} ${focusFighter.z.toFixed(1)}) rotate(${((-focusFighter.aim * 180) / Math.PI + 180).toFixed(0)})`}>
          <path d={big ? 'M0 -7L5 5L0 2.5L-5 5Z' : 'M0 -13L9.5 9.5L0 4.6L-9.5 9.5Z'} fill={focusFighter.color} stroke="#fff" strokeWidth={big ? 1.2 : 2.2} strokeLinejoin="round" />
        </g>
      )}
    </>
  );
  const box = `${-HALF - 8} ${-HALF - 8} ${2 * HALF + 16} ${2 * HALF + 16}`;
  const slotLabel = (i: number) => (touchMode ? '' : String(i + 1));
  const heals = hud.items ? hud.items.bandage + hud.items.medkit + hud.items.tart : 0;
  const shields = hud.items ? hud.items.mini + hud.items.shield + hud.items.smoothie : 0;

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
            {hud.scope > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`${SCOPES[hud.scope]} scope`}>
                <ScopeIcon size={15} />
                <b>{SCOPES[hud.scope]}</b>
              </span>
            )}
            {hud.pack > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`level ${hud.pack} backpack`}>
                <PackIcon size={15} lv={hud.pack} />
                <b>{hud.pack}</b>
              </span>
            )}
            {hud.helmet > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`${ARMOR_NAMES.helmet[hud.helmet]}, a level ${hud.helmet} helmet`}>
                <ArmorIcon kind="helmet" size={15} lv={hud.helmet} />
                <b>{hud.helmet}</b>
              </span>
            )}
            {hud.vest > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`${ARMOR_NAMES.vest[hud.vest]}, a level ${hud.vest} vest`}>
                <ArmorIcon kind="vest" size={15} lv={hud.vest} />
                <b>{hud.vest}</b>
              </span>
            )}
            {hud.warm && (
              <span className="g-scramble-pill is-warm" role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1.5-4 .5 1.5 1.5 2 2.5 2 0-3-1-4 0-7z" fill="currentColor" />
                </svg>
                warming up
              </span>
            )}
          </div>
          {hud.storm && <div className={`g-scramble-storm${hud.shrinking ? ' is-moving' : ''}`}>{hud.storm}</div>}
          {hud.arrive && (
            <div key={hud.arrive} className="g-scramble-arrive" role="status">
              <small>entering</small>
              <b>{hud.arrive}</b>
            </div>
          )}
          <div
            className="g-scramble-map"
            role="button"
            aria-label={hud.where ? `Island map: you're in ${hud.where}` : 'Island map'}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBigMap((b) => !b);
            }}
          >
            <svg viewBox={box} aria-hidden="true">
              {islandArt}
              {mapMarks(false)}
            </svg>
            {hud.where && <span>{hud.where}</span>}
          </div>
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
              {canLeave() && (
                <button
                  type="button"
                  className="g-scramble-leave"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  // on the click, not the press: the result card comes up where the finger is, and the click a lifted
                  // finger makes would land on its Play Again
                  onClick={(e) => {
                    e.stopPropagation();
                    leave();
                  }}
                >
                  done watching{!touchMode && <kbd>Enter</kbd>}
                </button>
              )}
            </div>
          )}
          {hud.jump && (
            <button type="button" className="g-scramble-jump" {...tap((t) => (t.jump = true))}>
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
            <button type="button" className="g-scramble-prompt" {...tap((t) => (t.interact = true))}>
              {!touchMode && <kbd>E</kbd>}
              {hud.prompt}
            </button>
          )}
          {hud.phase !== 'none' && hud.phase !== 'bus' && (
            <div className="g-scramble-bottom">
              <div className="g-scramble-bars" aria-label={`${hud.hp} health, ${hud.shield} shield${hud.boost ? `, ${hud.boost} boost` : ''}`}>
                {hud.boost > 0 && (
                  <div className="g-scramble-bar is-boost">
                    <i style={{ width: `${hud.boost}%` }} />
                  </div>
                )}
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
                {[0, 1, SLOT_MELEE, SLOT_THROW].map((i) => {
                  const g = i < 2 ? hud.slots[i as 0 | 1] : null;
                  const on = hud.slot === i;
                  const empty = (i < 2 && !g) || (i === SLOT_THROW && !hud.toss);
                  const label = i < 2 ? (g ? WEAPONS[g.w].name : 'Empty slot') : i === SLOT_MELEE ? MELEE[hud.melee].name : hud.toss ? (hud.toss.n < 0 ? THROWS[hud.toss.w].name : `${hud.toss.n} ${hud.toss.n === 1 ? THROWS[hud.toss.w].name : THROWS[hud.toss.w].plural}`) : 'Nothing to throw';
                  return (
                    <button
                      key={i}
                      type="button"
                      tabIndex={-1}
                      className={`g-scramble-slot${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
                      style={g ? { ['--rarity' as string]: RARITY_COLORS[g.r] } : undefined}
                      aria-label={label}
                      aria-pressed={on}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        taps.current.slot = i;
                      }}
                    >
                      {slotLabel(i) && <small>{slotLabel(i)}</small>}
                      {i < 2 && g && <WeaponIcon w={g.w} size={34} />}
                      {i === SLOT_MELEE && <WeaponIcon w={hud.melee} size={30} />}
                      {i === SLOT_THROW && hud.toss && (
                        <>
                          <WeaponIcon w={hud.toss.w} size={28} />
                          {hud.toss.n >= 0 && <b className="g-scramble-count">{hud.toss.n}</b>}
                          {hud.toss.kinds > 1 && <i className="g-scramble-more" aria-hidden="true" />}
                        </>
                      )}
                      {on && i < 2 && g && hud.mag >= 0 && (
                        <em>
                          {hud.mag}
                          {hud.ammo && <span>/{hud.reserve}</span>}
                        </em>
                      )}
                    </button>
                  );
                })}
              </div>
              {hud.items && (
                <div className="g-scramble-mats">
                  {USE_IDS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      tabIndex={-1}
                      className={hud.items![w] ? undefined : 'is-none'}
                      title={USES[w].name}
                      aria-label={`${hud.items![w]} ${hud.items![w] === 1 ? USES[w].name : USES[w].plural}`}
                      {...tap((t) => (t.use = w))}
                    >
                      <UseIcon w={w} size={20} />
                      {hud.items![w]}
                      {!touchMode && <kbd>{USE_KEYS[w]}</kbd>}
                    </button>
                  ))}
                  <span className={hud.wood >= WOOD_MAX ? 'is-full' : undefined} title="Wood">
                    <WoodIcon size={20} />
                    {hud.wood}
                    {!touchMode && <kbd>Space</kbd>}
                  </span>
                  {hud.ammo && (
                    <span className="g-scramble-ammo" title="Ammo">
                      <AmmoIcon a={hud.ammo} size={20} />
                      {hud.reserve}
                      <small>/{ammoCap(hud.ammo, hud.pack)}</small>
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
            <PlaceNames map={map} />
            {mapMarks(true)}
          </svg>
          <small>{touchMode ? 'tap to close' : 'M or click to close'}</small>
        </div>
      )}
      {touchMode && playing && !net.current.over && (
        <div className="g-scramble-touch">
          <div className="g-scramble-zone is-move" {...stick('move')}>
            {sticks.move && moveStick.current && (
              <StickArt
                s={moveStick.current}
                at={(el) => {
                  stickEls.current.move = el;
                }}
              />
            )}
          </div>
          <div className="g-scramble-zone is-aim" {...stick('aim')}>
            {sticks.aim && aimStick.current && (
              <StickArt
                s={aimStick.current}
                at={(el) => {
                  stickEls.current.aim = el;
                }}
              />
            )}
          </div>
          {hud.phase === 'ground' && hud.mine && (
            <div className="g-scramble-buttons">
              <button type="button" tabIndex={-1} aria-label="Build a wall" {...tap((t) => (t.build = true))}>
                <WoodIcon size={22} />
                <span>wall</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Reload" {...tap((t) => (t.reload = true))}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>reload</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Heal" className={heals ? undefined : 'is-none'} {...tap((t) => (t.use = 'bestHeal'))}>
                <UseIcon w={hud.items && !hud.items.bandage ? (hud.items.medkit ? 'medkit' : hud.items.tart ? 'tart' : 'bandage') : 'bandage'} size={22} />
                <span>{heals}</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Top up shield" className={shields ? undefined : 'is-none'} {...tap((t) => (t.use = 'bestShield'))}>
                <UseIcon w={hud.items && !hud.items.mini ? (hud.items.smoothie ? 'smoothie' : hud.items.shield ? 'shield' : 'mini') : 'mini'} size={22} />
                <span>{shields}</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Drink a coffee" className={hud.items?.coffee ? undefined : 'is-none'} {...tap((t) => (t.use = 'coffee'))}>
                <UseIcon w="coffee" size={22} />
                <span>{hud.items?.coffee ?? 0}</span>
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
