import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { GameShell, Segmented, defineSetting, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { airSounds, chargeBeeps, engineSounds, playEvents, stopEngines } from './audio.ts';
import { CARS, carNear } from './cars.ts';
import { Score, type Mood } from './score.ts';
import { useAssets } from './assets.ts';
import { autoQuality, createView, flyover, type Quality, type View } from './gfx/view.ts';
import { kitOf, paletteOf } from './gfx/soldiers.ts';
import { Ammo, BannerView, HitInfo, ItemBar, KillConfirm, KitPanel, type KillPop, BreachPrompts, BuyMenu, DeathPanel, Feed, Markers, MedalView, Minimap, Reticle, RoyalePrompts, SHOP_ORDER, Scope, Scoreboard, TopBar, Vitals, blankHud, type Banner, type MedalPop, type FastHud, type FeedItem, type Hud, type MapState, type MarkersApi, type MinimapApi, type HitInfoApi } from './hud.tsx';
import { MAPS, MAP_IDS, type MapId } from './maps.ts';
import { DEFUSE_HALF, DEFUSE_TIME, DEG, PERSON_HEALTH, PLANT_TIME, RUN, type Medal, type Mode, canDefuse, canShop, canUse, createMatch, currentGun, echoOfMine, eyeX, eyeY, eyeZ, finalScore, idleInput, lootNear, nadesOf, owns, plantSite, spareOf, sightSwap, spreadOf, standings, step, viewDir, wants, type Actor, type Cause, type Input, type Match, type NadeKind, type ShopItem } from './match.ts';
import { AMMO_KINDS, ROYALE_PLAYERS, USE, ZONES, ammoCap, boostCap, gunLabel, healCap, itemName, magOf, nadeCap, planeAt, scopeOf, zoomOf, type AttKind, type Item, type UseKind } from './royale.ts';
import { newBrain } from './bots.ts';
import { Session, type OnlineApi } from './online.ts';
import { supplyLeft, underRoof } from './match.ts';
import { newHit, rayWorld } from './physics.ts';
import { aimPoint, shoulderCam, type Cam } from './camera.ts';
import { floorAt } from './terrain.ts';
import { PAVISE, WEAPONS, type WeaponId } from './weapons.ts';

import { buildWorld, cacheWorld, cachedWorld, type World } from './world.ts';
import './ridgeline.css';

// (a new key: the 5v5 is the main game now, so everyone starts on it once, whatever they picked before)
const MODE = defineSetting('ridgeline:game', ['breach', 'royale', 'dm'] as const, 'breach');
const MAP = defineSetting('ridgeline:map', ['random', 'vale', 'mesa', 'frost', 'isles'] as const, 'random');
const LEVEL = defineSetting('ridgeline:bots', ['easy', 'normal', 'hard'] as const, 'normal');
const QUALITY = defineSetting('ridgeline:quality', ['auto', 'low', 'medium', 'high', 'ultra'] as const, 'auto', { live: true });
const SENS = defineSetting('ridgeline:sens', ['0.5', '0.75', '1', '1.5', '2'] as const, '1', { live: true });
const DMGUN = defineSetting('ridgeline:dmgun', ['kestrel', 'talon', 'rampart', 'hornet', 'wasp', 'mauler', 'thresher', 'lancer', 'arbalest', 'longbow'] as const, 'kestrel', { live: true });
/** The camera a match starts in (O switches it while playing): Auto is over the shoulder in a royale, first person in
 * the others. Only ever this machine's: online, nobody else sees which. */
const VIEW = defineSetting('ridgeline:view', ['auto', 'first', 'third'] as const, 'auto', { live: true });
/** The camera's own motion: the head bobbing with your steps, the jolt of a landing, explosions shaking it. */
const SHAKE = defineSetting('ridgeline:shake', ['on', 'off'] as const, 'on', { live: true });

const modeOptions = [
  ['breach', 'Breach 5v5'],
  ['royale', 'Royale 100'],
  ['dm', 'Deathmatch'],
] as const;
const mapOptions = [
  ['random', 'Random'],
  ['vale', 'Vale'],
  ['mesa', 'Mesa'],
  ['frost', 'Frostpeak'],
  ['isles', 'Isles'],
] as const;
const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const;
const qualityOptions = [
  ['auto', 'Auto'],
  ['low', 'Low'],
  ['medium', 'Med'],
  ['high', 'High'],
  ['ultra', 'Ultra'],
] as const;
const sensOptions = [
  ['0.5', '0.5'],
  ['0.75', '0.75'],
  ['1', '1'],
  ['1.5', '1.5'],
  ['2', '2'],
] as const;
const viewOptions = [
  ['auto', 'Auto'],
  ['first', 'First person'],
  ['third', 'Third person'],
] as const;
const shakeOptions = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;
const gunOptions = [
  ['kestrel', 'Kestrel'],
  ['talon', 'Talon'],
  ['rampart', 'Rampart'],
  ['hornet', 'Hornet'],
  ['wasp', 'Wasp'],
  ['mauler', 'Mauler'],
  ['thresher', 'Thresher'],
  ['lancer', 'Lancer'],
  ['arbalest', 'Arbalest'],
  ['longbow', 'Longbow'],
] as const;

/** What took someone out, for the kill feed. */
const causeName = (w: Cause) => (w === 'frag' ? 'Frag' : w === 'fire' ? 'Fire' : w === 'impact' ? 'Impact' : w === 'zone' ? 'Zone' : w === 'blast' ? 'Blast' : w === 'shell' ? 'Shell' : w === 'car' ? 'Vehicle' : WEAPONS[w].name);
/** The order G falls back on when the grenade picked has run out, and the order T steps through. */
const NADE_ORDER: NadeKind[] = ['frag', 'impact', 'fire', 'smoke', 'flash', 'decoy'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} handlesLeavers remount={false}>
      <Stage />
    </GameShell>
  );
}

const finePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(any-pointer: fine)').matches;

function Setup() {
  const shell = useShell();
  const [mode, setMode] = useSetting(MODE);
  const [map, setMap] = useSetting(MAP);
  const [level, setLevel] = useSetting(LEVEL);
  const [quality, setQuality] = useSetting(QUALITY);
  const [sens, setSens] = useSetting(SENS);
  const [gun, setGun] = useSetting(DMGUN);
  const [view, setView] = useSetting(VIEW);
  const [shake, setShake] = useSetting(SHAKE);
  const mouse = !shell.touch || finePointer();
  return (
    <div className="g-ridgeline-setup">
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Map" value={map} options={mapOptions} onChange={setMap} />
      {map !== 'random' && <p className="g-ridgeline-note">{MAPS[map].tag}</p>}
      <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />
      {mode === 'dm' && <Segmented label="Gun" value={gun} options={gunOptions} onChange={setGun} />}
      <Segmented label="Graphics" value={quality} options={qualityOptions} onChange={setQuality} />
      {mouse && <Segmented label="Mouse" value={sens} options={sensOptions} onChange={setSens} />}
      <Segmented label="View" value={view} options={viewOptions} onChange={setView} />
      {view === 'auto' && <p className="g-ridgeline-note">over the shoulder in Royale, first person in the others. O switches while you play.</p>}
      <Segmented label="Camera shake" value={shake} options={shakeOptions} onChange={setShake} />
    </div>
  );
}

/** What each mode is online. */
const onlineNotes = {
  breach: 'Breach 5v5 online: people are split between the two sides, bots fill the empty seats, and a leaver\'s seat goes to a bot.',
  dm: 'Deathmatch online: everyone for themselves, up to ten people, bots make it eight or more. each picks their own gun. first to 25.',
  royale: 'Royale online: up to ten people drop in with the bots, a hundred in all. last one standing wins; once out, watch the others.',
} as const;

/** Room settings: the host picks the mode, the map and how the bots in the empty seats play. */
function OnlineSetup() {
  const shell = useShell();
  const online = useOnline();
  const [mode, setMode] = useSetting(MODE);
  const [map, setMap] = useSetting(MAP);
  const [level, setLevel] = useSetting(LEVEL);
  const [quality, setQuality] = useSetting(QUALITY);
  const [sens, setSens] = useSetting(SENS);
  const [gun, setGun] = useSetting(DMGUN);
  const [view, setView] = useSetting(VIEW);
  const [shake, setShake] = useSetting(SHAKE);
  const mouse = !shell.touch || finePointer();
  const host = !online || online.isHost;
  return (
    <div className="g-ridgeline-setup">
      {host ? (
        <>
          <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
          <p className="g-ridgeline-note">{onlineNotes[mode]}</p>
          <Segmented label="Map" value={map} options={mapOptions} onChange={setMap} />
          <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />
        </>
      ) : (
        <p className="g-ridgeline-note">the host picks the mode (Breach 5v5, Deathmatch or Royale), the map and the bots.</p>
      )}
      {(!host || mode === 'dm') && <Segmented label="Deathmatch gun" value={gun} options={gunOptions} onChange={setGun} />}
      <Segmented label="Graphics" value={quality} options={qualityOptions} onChange={setQuality} />
      {mouse && <Segmented label="Mouse" value={sens} options={sensOptions} onChange={setSens} />}
      <Segmented label="View" value={view} options={viewOptions} onChange={setView} />
      <Segmented label="Camera shake" value={shake} options={shakeOptions} onChange={setShake} />
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  if (online && shell.status !== 'ready') return <OnlineStage key={`online:${online.round}`} />;
  return <SoloStage />;
}

/** The room's wrapper for the shell's online api, read fresh each call (seats change when the host leaves). */
function useOnlineApi() {
  const online = useOnline();
  const ref = useRef(online);
  ref.current = online;
  return useMemo<OnlineApi>(
    () => ({
      get seat() {
        return ref.current?.seat ?? 0;
      },
      get isHost() {
        return !!ref.current?.isHost;
      },
      get round() {
        return ref.current?.round ?? 0;
      },
      get players() {
        return ref.current?.players ?? [];
      },
      send: (d, o) => {
        try {
          ref.current?.send(d, o);
        } catch {
          /* a full or closed channel: the next packet tries again */
        }
      },
      onMessage: (fn) => ref.current?.onMessage(fn) ?? (() => {}),
    }),
    [],
  );
}

/** One online match: its session, the mode and map the host picked (a guest waits to hear them), then the game. */
function OnlineStage() {
  const online = useOnline();
  const api = useOnlineApi();
  const [mapSetting] = useSetting(MAP);
  const [level] = useSetting(LEVEL);
  const [modeSetting] = useSetting(MODE);
  const [dmGun] = useSetting(DMGUN);
  const [session, setSession] = useState<Session | null>(null);
  const [picked, setPicked] = useState<{ map: MapId; mode: Mode } | null>(null);
  useEffect(() => {
    const map: MapId = mapSetting === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : mapSetting;
    const s = new Session(api, { map, level, mode: modeSetting, dmPick: dmGun as WeaponId });
    if (s.map && s.mode) setPicked({ map: s.map, mode: s.mode });
    s.onMap = (id, mode) => setPicked({ map: id, mode });
    setSession(s);
    // until the host's match is in, ask for it again now and then (the first ask can arrive before the host is ready)
    const ask = window.setInterval(() => s.wait(), 1000);
    // dev only: lets the online harness look into the session
    if (import.meta.env.DEV) (window as unknown as { __rlSession?: Session }).__rlSession = s;
    return () => {
      if (import.meta.env.DEV) delete (window as unknown as { __rlSession?: Session }).__rlSession;
      window.clearInterval(ask);
      s.onMap = null;
      s.dispose();
    };
  }, [api]);
  // people leaving and joining: a leaver's soldier is a bot from then on, a latecomer takes a bot's place
  useEffect(() => {
    if (online) session?.playersChanged(online.players);
  }, [session, online?.players]);
  // the host leaving: the room renumbers seats, and the new host's game takes the match over
  const seen = useRef(0);
  useEffect(() => {
    if (!online || !session) return;
    const ours = online.handedOff.filter((h) => h.round === online.round);
    for (const h of ours.slice(seen.current)) session.handOff(h.from);
    seen.current = ours.length;
  }, [session, online?.handoffs, online?.handedOff]);
  if (!session || !picked)
    return (
      <div className="g-ridgeline-wait" role="status">
        waiting for the host's match…
      </div>
    );
  return <Play key={`${picked.map}:${picked.mode}`} mapId={picked.map} royale={picked.mode === 'royale'} session={session} />;
}

function SoloStage() {
  const shell = useShell();
  const [mapSetting] = useSetting(MAP);
  // Random picks a fresh map for each match; a set map always plays that map
  const key = mapSetting === 'random' ? `random:${shell.round}` : mapSetting;
  const mapId = useMemo<MapId>(() => (mapSetting === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : mapSetting), [key]);
  // a royale plays on the whole land, a different world from the breach arena's
  const [mode] = useSetting(MODE);
  const royale = mode === 'royale';
  return <Play key={`${mapId}:${royale ? 'royale' : 'arena'}`} mapId={mapId} royale={royale} />;
}

function myName() {
  try {
    const n = window.localStorage.getItem('arcade:name')?.trim();
    if (n) return n.slice(0, 16);
  } catch {
    /* storage blocked */
  }
  return 'You';
}

const TEAM_COLORS = ['#7cc6ff', '#ff7a5c'];

/** A medal's words and how big it shows. */
function medalText(kind: Medal, n: number): Omit<MedalPop, 'key'> {
  switch (kind) {
    case 'first':
      return { title: 'First blood', sub: '', tier: 1 };
    case 'head':
      return { title: 'Headshot', sub: '', tier: 1 };
    case 'double':
      return { title: 'Double kill', sub: '', tier: 1 };
    case 'triple':
      return { title: 'Triple kill', sub: '', tier: 2 };
    case 'quad':
      return { title: 'Quad kill', sub: 'one more for the ace', tier: 2 };
    case 'ace':
      return { title: 'Ace', sub: 'the whole team, by yourself', tier: 3 };
    default:
      return { title: 'Clutch', sub: `won it 1 v ${n}`, tier: 3 };
  }
}

/** What the music should do: strings while buying, the march once live, a driving pulse when it is close. */
function moodOf(m: Match): Mood {
  if (m.phase === 'over') return 'off';
  if (m.mode !== 'breach') return m.phase === 'live' ? 'march' : 'calm';
  if (m.phase !== 'live') return 'calm';
  const left = [0, 1].map((t) => m.actors.reduce((n, a) => n + (a.alive && a.team === t ? 1 : 0), 0));
  return m.charge.state === 'planted' || Math.min(left[0], left[1]) <= 1 ? 'urgent' : 'march';
}
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const wrapAngle = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

type Touch = { stick: number | null; sx: number; sy: number; mx: number; mz: number; look: number | null; lx: number; ly: number; fire: number | null; fx: number; fy: number; ads: boolean; crouch: boolean; jump: boolean; reload: boolean; swap: boolean; frag: boolean; smoke: boolean; flash: boolean; use: boolean; heal: boolean; hold: boolean; util: boolean; next: boolean; shield: boolean; prone: boolean; view: boolean };

/** Royale weapon keys 1, 2, 3: the two long guns, then the sidearm. */
const ROYALE_SLOTS = [0, 2, 1] as const;

function Play({ mapId, royale, session = null }: { mapId: MapId; royale: boolean; session?: Session | null }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const netRef = useRef(session);
  netRef.current = session;
  const THREE = useThree();
  const assets = useAssets();
  const [mode] = useSetting(MODE);
  const [level] = useSetting(LEVEL);
  const [qSetting] = useSetting(QUALITY);
  const [sens] = useSetting(SENS);
  const [dmGun] = useSetting(DMGUN);
  const [viewSetting] = useSetting(VIEW);
  const [shakeSetting] = useSetting(SHAKE);
  const settings = useRef({ mode, level, sens: Number(sens), dmGun, view: viewSetting, shake: shakeSetting === 'on' });
  settings.current = { mode, level, sens: Number(sens), dmGun, view: viewSetting, shake: shakeSetting === 'on' };
  const quality: Quality = qSetting === 'auto' ? autoQuality(shell.touch && !finePointer()) : qSetting;
  const [world, setWorld] = useState<World | null>(() => cachedWorld(mapId, royale));
  const [glError, setGlError] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const matchRef = useRef<{ m: Match; round: number } | null>(null);
  const [hud, setHud] = useState<Hud>(() => blankHud(mode));
  const [banner, setBanner] = useState<Banner | null>(null);
  const [medal, setMedal] = useState<MedalPop | null>(null);
  const [killPop, setKillPop] = useState<KillPop | null>(null);
  const kills = useRef({ at: -9, n: 0 });
  const [kitOpen, setKitOpen] = useState(false);
  const kitRef = useRef(false);
  kitRef.current = kitOpen;
  useEffect(() => {
    if (!killPop) return;
    const t = window.setTimeout(() => setKillPop(null), 1900);
    return () => window.clearTimeout(t);
  }, [killPop]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [buyOpen, setBuyOpen] = useState(false);
  const buyRef = useRef(false);
  buyRef.current = buyOpen;
  const [board, setBoard] = useState(false);
  const [bigMap, setBigMap] = useState(false);
  const [locked, setLocked] = useState(false);
  const [touchUi, setTouchUi] = useState(() => shell.touch && !finePointer());
  const touchRef = useRef(touchUi);
  touchRef.current = touchUi;
  const fast = useRef<FastHud>(null);
  const mini = useRef<MinimapApi>(null);
  const big = useRef<MinimapApi>(null);
  const marks = useRef<MarkersApi>(null);
  const hitInfo = useRef<HitInfoApi>(null);

  // input state
  const look = useRef({ dx: 0, dy: 0 });
  const mouse = useRef({ fire: false, ads: false, wheel: 0, mid: false });
  const touch = useRef<Touch>({ stick: null, sx: 0, sy: 0, mx: 0, mz: 0, look: null, lx: 0, ly: 0, fire: null, fx: 0, fy: 0, ads: false, crouch: false, jump: false, reload: false, swap: false, frag: false, smoke: false, flash: false, use: false, heal: false, hold: false, util: false, next: false, shield: false, prone: false, view: false });
  /** The grenade G throws (T picks the next one you carry). */
  const nadePick = useRef<NadeKind>('frag');
  const unlockOnPurpose = useRef(false);

  // per match view state
  const camY = useRef<number | null>(null);
  const spec = useRef(0);
  const deathLook = useRef({ yaw: 0, pitch: 0 });
  const damageFx = useRef(0);
  const flashFx = useRef(0);
  const hudClock = useRef(0);
  const overAt = useRef<number | null>(null);
  const finished = useRef(false);
  const feedId = useRef(0);
  /** When to announce a supply drop (0 none pending). */
  const supplyNote = useRef(0);
  const time = useRef(0);
  const lastLook = useRef({ yaw: 0, pitch: 0 });
  /** At the wheel: where you look relative to the car's heading, and how long the mouse has been still. */
  const carLook = useRef({ off: 0, pitch: -0.2, idle: 0 });
  const camHit = useRef(newHit());
  /** The camera: over the shoulder or not (null: not picked yet this match, the setting decides), and how far it has
   * got from one to the other (0 first person, 1 third). */
  const third = useRef<boolean | null>(null);
  const thirdK = useRef(0);
  /** Lying down: N puts you down and up again (crouch or jump gets up too). */
  const proneOn = useRef(false);
  /** Freelook (held ` or the middle button): how far the view is turned from where the body faces and aims. */
  const free = useRef({ yaw: 0, pitch: 0, on: false });
  /** Third person: where the camera sits and where its crosshair rests (reused every frame). */
  const tpCam = useRef<Cam>({ x: 0, y: 0, z: 0, dist: 0 });
  const tpAim = useRef({ x: 0, y: 0, z: 0 });
  const aimHit = useRef(newHit());
  /** The camera's own motion: shake left from explosions (0 to 1), the dip of a landing and its speed, the roll of a
   * landing under the canopy, and what the body was doing last frame (to tell a landing's force and a canopy's end). */
  const feel = useRef({ shake: 0, dip: 0, dipV: 0, roll: 0, vy: 0, drop: 0, watched: -1 });
  const mapCars = useRef<NonNullable<MapState['cars']>>([]);
  const lastRender = useRef(0);
  /** When the loop last ran (the online host's hidden tab steps the match from a worker's beat instead). */
  const lastFrame = useRef(0);
  const firstBuy = useRef(true);
  const score = useRef(new Score());
  // the score plays only while a round does (the Music switch and mute are checked as it plays)
  useEffect(() => {
    if (shell.status !== 'playing') score.current.stop();
  }, [shell.status]);
  useEffect(() => () => score.current.stop(), []);
  // (the engines too: they hum on until told to stop)
  useEffect(() => {
    if (shell.status !== 'playing') stopEngines();
  }, [shell.status]);
  useEffect(() => () => stopEngines(), []);

  // the world: from the cache, or built in a worker (main thread if workers fail)
  useEffect(() => {
    if (world) return;
    let alive = true;
    let worker: Worker | null = null;
    const done = (w: World) => {
      if (!alive) return;
      cacheWorld(w);
      setWorld(w);
    };
    const fallback = () => window.setTimeout(() => alive && done(buildWorld(mapId, royale)), 30);
    try {
      worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<World>) => done(e.data);
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        fallback();
      };
      worker.postMessage({ id: mapId, royale });
    } catch {
      fallback();
    }
    return () => {
      alive = false;
      worker?.terminate();
    };
  }, [mapId, royale, world]);

  // the view
  useEffect(() => {
    const host = hostRef.current;
    if (!THREE || !world || !host || !assets) return;
    const view = createView(THREE, host, world, quality, assets);
    if (!view) {
      setGlError(true);
      return;
    }
    viewRef.current = view;
    const resize = () => {
      view.resize(host.clientWidth, host.clientHeight);
      shellRef.current.invalidate();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    setReady(true);
    shellRef.current.invalidate();
    return () => {
      ro.disconnect();
      view.dispose();
      viewRef.current = null;
      setReady(false);
    };
  }, [THREE, world, quality, assets]);

  // a new match for each round of the shell (Play, Restart, Play Again)
  const ensureMatch = useCallback(() => {
    const s = shellRef.current;
    if (!world || (s.status !== 'playing' && s.status !== 'paused')) return matchRef.current?.m ?? null;
    if (!matchRef.current || matchRef.current.round !== s.round) {
      const st = settings.current;
      const mode = royale ? 'royale' : st.mode === 'royale' ? 'breach' : st.mode;
      // online: the session's match (a guest's mirror waits for the host's word)
      const net = netRef.current;
      const m = net ? net.attach(world) : createMatch(world, mode, st.level, { name: myName(), dmPick: st.dmGun as WeaponId });
      if (!m) return null;
      matchRef.current = { m, round: s.round };
      camY.current = null;
      third.current = null;
      proneOn.current = false;
      free.current.yaw = free.current.pitch = 0;
      overAt.current = null;
      finished.current = false;
      spec.current = 0;
      firstBuy.current = true;
      supplyNote.current = 0;
      setFeed([]);
      setBuyOpen(false);
      setHud(blankHud(m.mode));
      s.setScore(null);
      // the first round's buy phase starts with the match, before any frame could report it
      if (m.mode === 'breach') {
        const atk = m.attack === m.actors[m.me].team;
        // (online, a guest can arrive any round)
        setBanner({ title: `Round ${m.round}. You ${atk ? 'attack' : 'defend'}`, sub: atk ? 'plant the charge on A or B, or knock them all out' : 'stop the plant, or defuse the charge. buy first', tone: 'info', key: Date.now() });
        if (!touchRef.current && canShop(m, m.actors[m.me])) {
          firstBuy.current = false;
          setBuyOpen(true);
        }
      } else if (m.mode === 'royale') setBanner({ title: 'Royale', sub: `${ROYALE_PLAYERS} players, one left standing. jump when you like`, tone: 'info', key: Date.now() });
      else setBanner({ title: 'Deathmatch', sub: 'everyone for themselves. first to 25', tone: 'info', key: Date.now() });
    }
    return matchRef.current.m;
  }, [world]);

  // The online host's tab hidden or minimized: no frames, but the room still needs the match to go on. A worker's beat
  // (page timers slow to a crawl in hidden tabs) runs the rules, the bots and the traffic whenever frames stop.
  useEffect(() => {
    if (!session || !world) return;
    let last = performance.now();
    const beat = () => {
      const now = performance.now();
      const gap = Math.min(0.25, (now - last) / 1000);
      last = now;
      const m = matchRef.current?.m;
      if (!session.isHost || !m || now - lastFrame.current < 250 || shellRef.current.status !== 'playing' || m.phase === 'over') return;
      // your soldier stands where it is while you are away
      const you = m.actors[m.me];
      for (let t = 0; t < gap - 1e-6; t += 1 / 30) {
        session.before(m);
        session.using = false;
        step(m, Math.min(1 / 30, gap - t), idleInput(you.yaw, you.pitch));
        session.after(m);
      }
    };
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = beat;
      worker.postMessage(50);
    } catch {
      worker = null;
    }
    const timer = worker ? 0 : window.setInterval(beat, 50);
    return () => {
      worker?.terminate();
      window.clearInterval(timer);
    };
  }, [session, world]);

  // pointer lock: click to capture the mouse; losing it (Esc) pauses
  useEffect(() => {
    const onChange = () => {
      const host = hostRef.current;
      const now = !!host && document.pointerLockElement === host;
      setLocked(now);
      if (!now) {
        mouse.current.fire = false;
        mouse.current.ads = false;
        mouse.current.mid = false;
        if (unlockOnPurpose.current) unlockOnPurpose.current = false;
        else if (shellRef.current.status === 'playing') shellRef.current.pause();
      }
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => {
      document.removeEventListener('pointerlockchange', onChange);
      if (hostRef.current && document.pointerLockElement === hostRef.current) document.exitPointerLock();
    };
  }, []);
  useEffect(() => {
    if (shell.status !== 'playing' && hostRef.current && document.pointerLockElement === hostRef.current) {
      unlockOnPurpose.current = true;
      document.exitPointerLock();
    }
  }, [shell.status]);
  const lock = useCallback(() => {
    const host = hostRef.current;
    if (!host || touchRef.current || shellRef.current.status !== 'playing' || document.pointerLockElement === host || buyRef.current) return;
    try {
      const r = (host.requestPointerLock as (o?: unknown) => Promise<void> | void).call(host, { unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function')
        (r as Promise<void>).catch(() => {
          try {
            const again = host.requestPointerLock() as unknown as Promise<void> | void;
            if (again && typeof again.catch === 'function') again.catch(() => {});
          } catch {
            /* not now */
          }
        });
    } catch {
      /* not allowed right now */
    }
  }, []);
  const unlock = useCallback(() => {
    if (hostRef.current && document.pointerLockElement === hostRef.current) {
      unlockOnPurpose.current = true;
      document.exitPointerLock();
    }
  }, []);

  const openBuy = useCallback(
    (open: boolean) => {
      setBuyOpen(open);
      if (open) unlock();
      else shellRef.current.root.current?.focus({ preventScroll: true });
    },
    [unlock],
  );

  const pending = useRef<{ buy: ShopItem | null; item: UseKind | null }>({ buy: null, item: null });

  // royale: the kit panel (I) frees the mouse to click its buttons, and gives the keys back when it closes
  const openKit = useCallback(
    (open: boolean) => {
      setKitOpen(open);
      if (open) unlock();
      else shellRef.current.root.current?.focus({ preventScroll: true });
    },
    [unlock],
  );
  const useItem = useCallback((k: UseKind) => {
    pending.current.item = k;
  }, []);

  const keys = useKeys((code, e) => {
    if (code === 'Tab') e?.preventDefault();
    if (code === 'KeyB') {
      const m = matchRef.current?.m;
      if (m && canShop(m, m.actors[m.me])) openBuy(!buyRef.current);
      else if (buyRef.current) openBuy(false);
    }
    if (code === 'Escape' && buyRef.current) openBuy(false);
    if (code === 'KeyI') {
      const m = matchRef.current?.m;
      if (m?.mode === 'royale') openKit(!kitRef.current);
    }
    if (code === 'Escape' && kitRef.current) openKit(false);
  });

  // Escape closes the buy menu instead of pausing
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || (!buyRef.current && !kitRef.current) || shellRef.current.status !== 'playing') return;
      e.preventDefault();
      e.stopPropagation();
      openBuy(false);
      openKit(false);
    };
    root.addEventListener('keydown', onKey, true);
    return () => root.removeEventListener('keydown', onKey, true);
  }, [shell.root, openBuy, openKit]);

  const pushBanner = (title: string, sub: string, tone: Banner['tone']) => setBanner({ title, sub, tone, key: Date.now() + Math.random() });

  const nameColor = (m: Match, a: Actor) => (m.mode === 'breach' ? TEAM_COLORS[a.team === m.actors[m.me].team ? 0 : 1] : hex(paletteOf(m, a).band));

  /** The actor the camera looks out of: you, or a teammate you watch while you are out (a royale online, anyone still
   * in: who knocked you out first, then whoever a click steps on to). */
  const watched = (m: Match) => {
    const you = m.actors[m.me];
    if (you.alive || m.mode === 'dm') return you;
    if (m.mode === 'royale') {
      if (m.phase === 'over' || m.alive < 1) return you;
      const killer = m.actors[you.killer];
      if (spec.current === 0 && killer?.alive) return killer;
      // (no list built: the n-th one still in, counting round)
      const n = m.alive;
      let k = ((spec.current % n) + n) % n;
      for (const a of m.actors) if (a.alive && a !== you && k-- === 0) return a;
      for (const a of m.actors) if (a.alive && a !== you) return a;
      return you;
    }
    const mates = m.actors.filter((a) => a.alive && a.team === you.team && a !== you);
    if (!mates.length) return you;
    return mates[((spec.current % mates.length) + mates.length) % mates.length];
  };

  const finish = (m: Match) => {
    if (finished.current) return;
    finished.current = true;
    const you = m.actors[m.me];
    const score = finalScore(m);
    const mapName = MAPS[mapId].name;
    const lvl = settings.current.level;
    // online: everyone reports who won (the people on the winning side, or the person who won), so the room agrees
    const net = netRef.current;
    if (net && onlineRef.current) {
      const r = net.result();
      try {
        onlineRef.current.reportResult(onlineRef.current.round, r.winner, m.mode === 'breach' && r.team.length ? r.team : undefined);
      } catch {
        /* the room is gone: nothing to tell */
      }
    }
    if (m.mode === 'royale') {
      const place = you.alive ? 1 : you.place;
      shellRef.current.gameOver(score, {
        title: place === 1 ? 'Last one standing' : `#${place} of ${m.actors.length}`,
        detail: `${you.kills} ${you.kills === 1 ? 'kill' : 'kills'}, ${Math.round(you.damage)} damage on ${mapName}.`,
        board: `royale-${lvl}`,
      });
    } else if (m.mode === 'breach') {
      const won = m.winner === you.team;
      shellRef.current.gameOver(score, {
        title: m.winner < 0 ? 'Draw' : won ? 'Victory' : 'Defeat',
        detail: `${m.score[you.team]} to ${m.score[1 - you.team]} on ${mapName}. you went ${you.kills}/${you.deaths}/${you.assists} with ${Math.round(you.damage)} damage.`,
        board: `breach-${m.level}`,
      });
    } else {
      const place = standings(m).indexOf(you) + 1;
      shellRef.current.gameOver(score, {
        title: place === 1 ? 'You won' : `#${place} of ${m.actors.length}`,
        detail: `${you.kills} knockouts, ${you.deaths} deaths on ${mapName}.`,
        board: `dm-${lvl}`,
      });
    }
  };

  useGameLoop(
    (dt) => {
      time.current += dt;
      const view = viewRef.current;
      if (!view || !world) return;
      if (shellRef.current.status !== 'playing') return;
      const m = ensureMatch();
      if (!m) return;
      const you = m.actors[m.me];
      const st = settings.current;
      const t = touch.current;
      const k = keys;
      // look: mouse (pointer locked) or touch drags, slower while zoomed in
      const g0 = currentGun(you);
      const zoom = g0 ? 1 + (zoomOf(g0) - 1) * you.ads : 1;
      const sensK = (touchRef.current ? 0.0052 : 0.0021) * st.sens * (1 / zoom) * (zoom > 1.01 ? 1.15 : 1);
      let yaw = you.yaw - look.current.dx * sensK;
      let pitch = you.pitch - look.current.dy * sensK;
      // at the wheel the mouse looks round the car, and the view swings back behind it when left alone
      const myCar = you.alive && you.car >= 0 && you.carSeat === 0 ? m.cars[you.car] : null;
      const cl = carLook.current;
      if (myCar) {
        const moved = look.current.dx !== 0 || look.current.dy !== 0;
        cl.off = wrapAngle(cl.off - look.current.dx * sensK);
        cl.pitch = Math.max(-1.1, Math.min(0.5, cl.pitch - look.current.dy * sensK));
        cl.idle = moved ? 0 : cl.idle + dt;
        if (cl.idle > 1.1 && Math.abs(myCar.speed) > 2) {
          const k = Math.min(1, dt * 2.2);
          cl.off -= cl.off * k;
          cl.pitch += (-0.2 - cl.pitch) * k;
        }
        yaw = myCar.yaw + cl.off;
        pitch = cl.pitch;
      } else {
        cl.off = 0;
        cl.pitch = -0.2;
        cl.idle = 0;
      }
      // freelook: the mouse turns the view alone, the body (and where it aims) stays as it was; let go, the view
      // swings back
      const fl = free.current;
      fl.on = (k.down('Backquote') || mouse.current.mid) && you.alive && !you.drop && !myCar && !mouse.current.ads && !k.down('KeyZ');
      if (fl.on) {
        fl.yaw = Math.max(-2.4, Math.min(2.4, fl.yaw + (yaw - you.yaw)));
        fl.pitch = Math.max(-1.1, Math.min(1, fl.pitch + (pitch - you.pitch)));
        yaw = you.yaw;
        pitch = you.pitch;
      } else {
        const back = Math.exp(-dt * 14);
        fl.yaw *= back;
        fl.pitch *= back;
      }
      look.current.dx = 0;
      look.current.dy = 0;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      // (only while it can be used: a shop left open past the buy phase is hidden, and must not swallow the controls)
      const shopOpen = buyRef.current && canShop(m, you);
      const inp: Input = idleInput(yaw, pitch);
      if (!shopOpen) {
        inp.mz = (k.down('KeyW', 'ArrowUp') ? 1 : 0) - (k.down('KeyS', 'ArrowDown') ? 1 : 0) + t.mz;
        inp.mx = (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0) + t.mx;
        const stick = Math.hypot(t.mx, t.mz);
        inp.walk = k.down('ShiftLeft', 'ShiftRight') || (t.stick !== null && stick > 0.05 && stick < 0.55);
        // lying down: N puts you down and gets you up; down, a crouch or a jump gets you up too
        const cTap = k.pressed('KeyC');
        if (k.pressed('KeyN') || t.prone) proneOn.current = !proneOn.current;
        if (proneOn.current && (cTap || (!myCar && k.pressed('Space')) || t.jump)) {
          proneOn.current = false;
          t.jump = false;
        }
        if (you.car >= 0 || you.drop) proneOn.current = false;
        inp.prone = proneOn.current;
        inp.crouch = k.down('KeyC') || t.crouch;
        // lean out: hold Y (left) or U (right)
        inp.lean = (k.down('KeyU') ? 1 : 0) - (k.down('KeyY') ? 1 : 0);
        // (at the wheel Space is the handbrake, held)
        inp.jump = myCar ? k.down('Space') || t.jump : k.pressed('Space') || t.jump;
        inp.reload = k.pressed('KeyR') || t.reload;
        inp.fire = (locked && mouse.current.fire) || t.fire !== null;
        // aim (or scope in): hold the right mouse button, or Z for a trackpad
        inp.ads = (locked && mouse.current.ads) || k.down('KeyZ') || t.ads;
        // every mode: 1 and 2 the long guns, 3 the sidearm; the wheel steps through what you carry
        ROYALE_SLOTS.forEach((k2, i) => k.pressed(`Digit${i + 1}`) && you.guns[k2] && (inp.slot = k2));
        if (mouse.current.wheel !== 0 || t.swap) {
          const have = ROYALE_SLOTS.filter((k2) => you.guns[k2]);
          if (have.length > 1) {
            const at = have.indexOf(you.slot as 0 | 1 | 2);
            inp.slot = have[(at + (mouse.current.wheel < 0 ? -1 : 1) + have.length) % have.length];
          }
        }
        // the grenade picked: T steps on to the next kind you carry, G throws it (or the first you have, once it is
        // gone); the number keys throw one kind each
        const royale = m.mode === 'royale';
        const usable = (n: NadeKind) => nadesOf(you, n) > 0 && !(royale && n === 'flash');
        if (k.pressed('KeyT') || t.next) {
          const at = NADE_ORDER.indexOf(nadePick.current);
          for (let i = 1; i <= NADE_ORDER.length; i++) {
            const n = NADE_ORDER[(at + i) % NADE_ORDER.length];
            if (usable(n)) {
              nadePick.current = n;
              break;
            }
          }
        }
        if (!usable(nadePick.current)) nadePick.current = NADE_ORDER.find(usable) ?? nadePick.current;
        if (k.pressed('KeyG') || t.util) inp.throw = nadePick.current;
        inp.shield = k.pressed('KeyV') || t.shield;
        if (royale) {
          if (k.pressed('Digit4') || t.frag) inp.throw = 'frag';
          if (k.pressed('Digit5', 'KeyQ') || t.smoke) inp.throw = 'smoke';
          inp.use = k.pressed('KeyF', 'KeyE') || t.use;
          // F also gets into the vehicle at hand, or out of the one you are in
          inp.ride = inp.use;
          inp.heal = k.pressed('KeyH') || t.heal;
          inp.boost = k.pressed('KeyX');
          // 6 to 9: a bandage, a med kit, a drink, the painkillers (also on the item bar and in the kit panel)
          if (k.pressed('Digit6')) inp.item = 'bandage';
          if (k.pressed('Digit7')) inp.item = 'kit';
          if (k.pressed('Digit8')) inp.item = 'drink';
          if (k.pressed('Digit9')) inp.item = 'pills';
        } else {
          if (k.pressed('Digit4') || t.frag) inp.throw = 'frag';
          if (k.pressed('Digit5', 'KeyQ') || t.smoke) inp.throw = 'smoke';
          if (k.pressed('Digit6', 'KeyX') || t.flash) inp.throw = 'flash';
          if (k.pressed('Digit7')) inp.throw = 'fire';
          if (k.pressed('Digit8')) inp.throw = 'impact';
          if (k.pressed('Digit9')) inp.throw = 'decoy';
          // plant and defuse: held
          inp.use = k.down('KeyF', 'KeyE') || t.hold;
        }
      }
      mouse.current.wheel = 0;
      // O (or the touch View button): first or third person, this match
      if (k.pressed('KeyO') || t.view) third.current = !third.current;
      t.jump = t.reload = t.swap = t.frag = t.smoke = t.flash = t.use = t.heal = t.util = t.next = t.shield = t.prone = t.view = false;
      const p = pending.current;
      if (p.buy) inp.buy = p.buy;
      p.buy = null;
      if (p.item) inp.item = p.item;
      p.item = null;
      // (the kit panel open: hands off the trigger, the feet still move)
      if (kitRef.current) {
        inp.fire = false;
        inp.ads = false;
      }
      setBoard(k.down('Tab'));
      if (!touchRef.current) setBigMap(k.down('KeyM'));
      // third person: the crosshair is on the camera's ray, so the shot is told the point it rests on (aiming down
      // sights is first person again, and while freelooking the shot goes where the body aims)
      if (third.current === null) third.current = st.view === 'third' || (st.view === 'auto' && m.mode === 'royale');
      // (from where the camera is: part of the way in while it eases to first person and back)
      const tk = thirdK.current;
      if (third.current && tk > 0.02 && you.alive && !you.drop && (you.car < 0 || you.carSeat > 0) && !fl.on && Math.abs(fl.yaw) < 0.05 && Math.abs(fl.pitch) < 0.05) {
        const cam = shoulderCam(m, you, inp.yaw, inp.pitch, tpCam.current, aimHit.current);
        cam.x = eyeX(you) + (cam.x - eyeX(you)) * tk;
        cam.y = eyeY(you) + (cam.y - eyeY(you)) * tk;
        cam.z = eyeZ(you) + (cam.z - eyeZ(you)) * tk;
        inp.aim = aimPoint(m, you, cam, inp.yaw, inp.pitch, tpAim.current, aimHit.current);
      }

      const net = netRef.current;
      net?.before(m);
      lastFrame.current = performance.now();
      if (net) net.using = inp.use;
      step(m, dt, inp);
      net?.after(m);
      // (where lying down isn't possible, the toggle lets go of it)
      if (proneOn.current && !you.proneTo) proneOn.current = false;

      // feedback from what happened
      for (const e of m.events) {
        if (e.t === 'hit') {
          if (e.a === m.me && e.v !== m.me && !echoOfMine(m, e)) {
            fast.current?.hit(e.kill, e.zone === 'head');
            hitInfo.current?.pop(e.x, e.y, e.z, e.dmg || e.est || 0, e.kill ? 'kill' : e.zone === 'head' ? 'head' : 'hit', e.v);
          }
          if (e.v === m.me) {
            const att = m.actors[e.a];
            if (att) fast.current?.hurt(wrapAngle(Math.atan2(-(att.body.x - you.body.x), -(att.body.z - you.body.z)) - you.yaw) * -1);
            damageFx.current = Math.min(1, damageFx.current + e.dmg / 60);
          }
        }
        if (e.t === 'kill') {
          const kk = e.k;
          const ka = m.actors[kk.killer];
          const va = m.actors[kk.victim];
          const blast = kk.w === 'blast';
          const item: FeedItem = { id: ++feedId.current, killer: blast ? 'The charge' : (ka?.name ?? (kk.w === 'zone' ? 'The zone' : kk.w === 'shell' ? 'The bombardment' : kk.w === 'car' ? 'A wreck' : '?')), victim: va.name, kc: ka && !blast ? nameColor(m, ka) : '#e8743a', vc: nameColor(m, va), w: causeName(kk.w), head: kk.head, mine: kk.killer === m.me || kk.victim === m.me };
          setFeed((f) => [...f.slice(-5), item]);
          if (kk.victim === m.me) {
            deathLook.current = { yaw: you.yaw, pitch: you.pitch };
            spec.current = 0;
          }
          // your knockout: the big confirmation, counting ones that come quickly together
          if (kk.killer === m.me && kk.victim !== m.me) {
            const kc = kills.current;
            kc.n = time.current - kc.at < 4 ? kc.n + 1 : 1;
            kc.at = time.current;
            setKillPop({ key: Date.now() + Math.random(), name: va.name, head: kk.head, n: kc.n });
          }
        }
        if (e.t === 'phase') {
          if (e.phase === 'buy') {
            const atk = m.attack === you.team;
            const point = m.score[0] === 6 || m.score[1] === 6;
            pushBanner(`Round ${m.round}. You ${atk ? 'attack' : 'defend'}`, `${point ? 'match point. ' : ''}${m.round === 7 ? 'sides swapped. ' : ''}buy phase. what you have carries over`, 'info');
            if (firstBuy.current && !touchRef.current) {
              firstBuy.current = false;
              openBuy(true);
            }
          }
          if (e.phase === 'live') {
            if (buyRef.current) openBuy(false);
            if (m.mode === 'breach') {
              const atk = m.attack === you.team;
              const carry = m.charge.holder === m.me;
              pushBanner(atk ? (carry ? 'You have the charge' : 'Go') : 'Hold the sites', atk ? (carry ? 'plant it on A or B: stand on the site and hold F' : 'push a site with your team and get the charge planted') : 'watch the ways in. if they plant, defuse it: hold F on the charge', 'info');
            }
          }
        }
        if (e.t === 'zone' && m.zone) {
          if (e.shrinking) pushBanner('The zone is closing', 'get inside the white circle', 'loss');
          else if (e.i < ZONES.length) pushBanner('Next zone marked', `it closes in ${Math.round(m.zone.t)} s. check the map`, 'info');
        }
        // (a supply drop comes with a zone closing: its banner follows on a moment later, so both get read)
        if (e.t === 'supply' && !e.landed) supplyNote.current = time.current + 3.2;
        if (e.t === 'redzone' && e.stage === 'warn' && you.alive) pushBanner('Bombardment marked', 'get under cover or out of the red', 'loss');
        if (e.t === 'round') {
          const won = e.winner === you.team;
          const why = e.why === 'blast' ? 'the charge went off' : e.why === 'defuse' ? 'the charge was defused' : e.why === 'elim' ? (won ? 'all knocked out' : 'your team is out') : 'time ran out before a plant';
          // and how your round went
          const mine = m.mode === 'breach' ? `. you: ${you.roundKills} ${you.roundKills === 1 ? 'kill' : 'kills'}, ${Math.round(you.roundDmg)} damage` : '';
          pushBanner(e.winner < 0 ? 'Round drawn' : won ? 'Round won' : 'Round lost', why + mine, e.winner < 0 ? 'info' : won ? 'win' : 'loss');
        }
        if (e.t === 'plant' && e.done) {
          const atk = m.attack === you.team;
          pushBanner(`Charge planted on ${m.world.sites[e.site].name}`, atk ? 'guard it until it goes off' : 'get to it and defuse it: hold F on the charge', atk ? 'win' : 'loss');
        }
        if (e.t === 'carry' && e.a === m.me) pushBanner('You have the charge', 'plant it on A or B: stand on the site and hold F', 'info');
        if (e.t === 'dropcharge' && m.attack === you.team && you.alive) pushBanner('The charge is down', 'pick it up: walk over it', 'info');
        if (e.t === 'sides') pushBanner('Switching sides', 'everyone keeps their guns and gear', 'info');
        if (e.t === 'medal' && e.a === m.me) setMedal({ ...medalText(e.kind, e.n), key: Date.now() + Math.random() });
      }
      // the camera's own motion: a landing jolts it (harder the faster the fall, a roll when coming down under the
      // canopy), explosions close by shake it
      const fe = feel.current;
      const seen = watched(m);
      if (fe.watched !== seen.id) {
        fe.watched = seen.id;
        fe.vy = 0;
        fe.drop = seen.drop;
      }
      if (st.shake) {
        for (const e of m.events) {
          if (e.t === 'land' && e.a === seen.id) {
            const chute = fe.drop === 3;
            fe.dipV -= chute ? 2.6 : Math.min(2.4, Math.max(0, -fe.vy - 2) * 0.22);
            if (chute) fe.roll = 1;
          } else if (e.t === 'boom' || e.t === 'shell' || e.t === 'blast') {
            const reach = e.t === 'boom' ? 32 : e.t === 'shell' ? 48 : 80;
            const d = Math.hypot(e.x - seen.body.x, e.y - seen.body.y, e.z - seen.body.z);
            if (d < reach) fe.shake = Math.min(1, fe.shake + (1 - d / reach) ** 2 * 0.9);
          }
        }
      } else fe.shake = fe.dip = fe.dipV = fe.roll = 0;
      fe.vy = seen.body.vy;
      fe.drop = seen.drop;
      if (supplyNote.current > 0 && time.current >= supplyNote.current) {
        supplyNote.current = 0;
        if (you.alive) pushBanner('Supply drop incoming', 'top gear inside. follow the blue smoke, or check the map', 'info');
      }
      damageFx.current = Math.max(0, damageFx.current - dt * 1.4);
      flashFx.current = Math.max(0, flashFx.current - dt * 3);
      if (m.phase === 'over') {
        if (overAt.current === null) {
          overAt.current = time.current;
          const won = m.mode === 'breach' ? m.winner === you.team : m.winner === m.me;
          if (m.mode === 'royale') pushBanner(won ? 'Last one standing' : `#${you.place} of ${m.actors.length}`, `${you.kills} ${you.kills === 1 ? 'kill' : 'kills'}`, won ? 'win' : 'loss');
          else pushBanner(m.mode === 'breach' ? (m.winner < 0 ? 'Draw' : won ? 'Victory' : 'Defeat') : won ? 'You won' : `${m.actors[m.winner]?.name ?? ''} wins`, m.mode === 'breach' ? `${m.score[you.team]} to ${m.score[1 - you.team]}` : '', won ? 'win' : 'loss');
        }
        if (time.current - overAt.current > 3.2) finish(m);
      }

      // sound from where the camera is
      const eyeA = watched(m);
      if (net) net.watch = eyeA.id;
      const ear = { x: eyeA.body.x, z: eyeA.body.z, yaw: eyeA.yaw };
      playEvents(m, m.events, ear, m.me);
      chargeBeeps(m, ear);
      engineSounds(m, ear, m.me);
      airSounds(m, eyeA === you ? m.me : eyeA.id);
      score.current.tick(moodOf(m));

      // the HUD, ten or so times a second
      hudClock.current -= dt;
      if (hudClock.current <= 0) {
        hudClock.current = 0.09;
        setHud(snapshot(m));
      }
    },
    () => {
      const view = viewRef.current;
      if (!view || !world) return;
      const s = shellRef.current;
      const dt = Math.min(0.05, Math.max(0, time.current - lastRender.current));
      lastRender.current = time.current;
      const m = s.status === 'ready' ? null : matchRef.current?.m ?? null;
      const host = hostRef.current;
      const aspect = host ? host.clientWidth / Math.max(1, host.clientHeight) : 16 / 9;
      const baseV = Math.min(80, Math.max(50, (2 * Math.atan(Math.tan((100 * DEG) / 2) / aspect)) / DEG));
      if (!m) {
        const f = flyover(time.current, world);
        view.render({ m: null, dt, time: time.current, eye: f, fov: baseV, hide: -1, vm: null, fired: false, damage: 0, low: 0, flash: 0 });
        return;
      }
      const you = m.actors[m.me];
      const a = watched(m);
      const st = settings.current;
      const fl = free.current;
      const fe = feel.current;
      // (freelook turns only the view)
      const lookYaw = a.yaw + (a === you ? fl.yaw : 0);
      const lookPitch = Math.max(-1.45, Math.min(1.45, a.pitch + (a === you ? fl.pitch : 0)));
      let eye = { x: eyeX(a), y: eyeY(a), z: eyeZ(a), yaw: lookYaw, pitch: lookPitch, roll: 0 };
      // smooth steps up (stairs, crates) without lagging falls
      let stepY = 0;
      if (a === you) {
        const target = eye.y;
        if (camY.current === null || Math.abs(camY.current - target) > 2.5 || target < camY.current) camY.current = target;
        else camY.current += (target - camY.current) * Math.min(1, dt * 16);
        stepY = camY.current - target;
        eye.y = camY.current;
      }
      let hide = a.id;
      // over the shoulder (on foot, or riding along): eased in and out, and aiming down sights is first person again
      const onFoot = a.alive && !a.drop && (a.car < 0 || a.carSeat > 0);
      const wantThird = third.current && onFoot ? 1 - Math.min(1, Math.max(0, (a.ads - 0.15) / 0.45)) : 0;
      thirdK.current += (wantThird - thirdK.current) * Math.min(1, dt * (wantThird < thirdK.current ? 16 : 7));
      if (thirdK.current < 0.002) thirdK.current = 0;
      const tk = onFoot ? thirdK.current : 0;
      if (tk > 0) {
        const cam = shoulderCam(m, a, lookYaw, lookPitch, tpCam.current, camHit.current);
        eye.x += (cam.x - eye.x) * tk;
        eye.y += (cam.y + stepY - eye.y) * tk;
        eye.z += (cam.z - eye.z) * tk;
        // (pulled right in against a wall, the body would fill the view: then it isn't drawn)
        if (tk > 0.35 && cam.dist > 0.75) hide = -1;
      }
      // the head's own motion (unless camera shake is off): a bob with each step, the dip of a landing (and a roll
      // coming down under the canopy), explosions close by; a lean always tips the view a little
      fe.dipV += (-fe.dip * 150 - fe.dipV * 19) * dt;
      fe.dip = Math.max(-0.45, Math.min(0.2, fe.dip + fe.dipV * dt));
      fe.shake = Math.max(0, fe.shake - dt * 1.5);
      if (st.shake && a.alive && !a.drop && a.car < 0) {
        const sp = a.body.onGround ? Math.min(1, Math.hypot(a.body.vx, a.body.vz) / RUN) : 0;
        const ph = a.phase * 2.2;
        const calm = 1 - a.ads * 0.75;
        eye.y += (0.5 - Math.abs(Math.sin(ph))) * (a.prone > 0.5 ? 0.014 : 0.04) * sp * calm;
        eye.roll += Math.sin(ph) * 0.006 * sp * calm;
        eye.y += fe.dip;
        eye.pitch += fe.dip * 0.22;
        if (fe.roll > 0) {
          fe.roll = Math.max(0, fe.roll - dt / 0.75);
          eye.roll += Math.sin((1 - fe.roll) * Math.PI) * 0.17;
          eye.pitch -= Math.sin((1 - fe.roll) * Math.PI) * 0.12;
        }
      }
      if (st.shake && fe.shake > 0) {
        const s2 = fe.shake * fe.shake;
        const tt = time.current;
        eye.x += (Math.sin(tt * 41.3) + Math.sin(tt * 23.7)) * 0.025 * s2;
        eye.y += (Math.sin(tt * 37.9 + 1) + Math.sin(tt * 19.1)) * 0.025 * s2;
        eye.yaw += Math.sin(tt * 33.1 + 2) * 0.012 * s2;
        eye.pitch += Math.sin(tt * 28.3 + 4) * 0.012 * s2;
        eye.roll += Math.sin(tt * 30.7 + 3) * 0.016 * s2;
      }
      eye.roll -= a.lean * (0.075 - 0.045 * tk);
      // dropping in: a camera behind (the transport, or you), turned with the mouse
      if (a === you && you.alive && you.drop) {
        // just out of the door the camera eases in from the transport's distance, clear of its tail
        // (under the canopy, back and up a little, so it shows over you)
        const dist = you.drop === 1 ? 38 : you.drop === 2 ? 6.5 + 31.5 * Math.max(0, 1 - you.dropT / 1.6) : 8.6;
        const d = viewDir(you.yaw, you.pitch);
        const ty = you.body.y + (you.drop === 1 ? 2 : you.drop === 3 ? 1.9 : 1.2);
        eye = { x: you.body.x - d.x * dist, y: ty - d.y * dist, z: you.body.z - d.z * dist, yaw: you.yaw, pitch: you.pitch, roll: 0 };
        // (a sway under the canopy as you steer, the wind buffeting a freefall)
        if (st.shake && you.drop >= 2) {
          const tt = time.current;
          eye.roll = you.drop === 3 ? Math.sin(tt * 0.9) * 0.025 + (Math.cos(you.yaw) * you.body.vx - Math.sin(you.yaw) * you.body.vz) * -0.012 : Math.sin(tt * 13.1) * 0.006;
          if (you.drop === 2) eye.pitch += Math.sin(tt * 11.3) * 0.005;
        }
        eye.y = Math.max(eye.y, floorAt(m.world.terrain, eye.x, eye.z) + 1.5);
        camY.current = null;
        hide = -1;
      }
      // at the wheel: a camera behind and above the car, turned with the mouse, pulled in where something is in between
      const drivenCar = a === you && you.alive && you.car >= 0 && you.carSeat === 0 ? m.cars[you.car] : null;
      if (drivenCar) {
        const tall = drivenCar.kind === 'jeep' ? 2.2 : 1.9;
        const far = drivenCar.kind === 'jeep' ? 7.5 : 5.5;
        const d = viewDir(you.yaw, you.pitch);
        const cx = drivenCar.x;
        const cy = drivenCar.y + tall;
        const cz = drivenCar.z;
        const h = rayWorld(m.world, cx, cy, cz, -d.x, -d.y, -d.z, far, camHit.current);
        const dist = h.kind === 'none' ? far : Math.max(1.2, h.t - 0.35);
        eye = { x: cx - d.x * dist, y: cy - d.y * dist, z: cz - d.z * dist, yaw: you.yaw, pitch: you.pitch, roll: 0 };
        eye.y = Math.max(eye.y, floorAt(m.world.terrain, eye.x, eye.z) + 0.5);
        camY.current = null;
        hide = -1;
      }
      if (!you.alive && a === you) {
        // out with nobody to watch: turn toward who did it
        const killer = m.actors[you.killer];
        const dl = deathLook.current;
        if (killer) {
          const dx = killer.body.x - you.body.x;
          const dz = killer.body.z - you.body.z;
          const ty = Math.atan2(-dx, -dz);
          const tp = Math.atan2(killer.body.y + 1.2 - eyeY(you), Math.hypot(dx, dz));
          dl.yaw += wrapAngle(ty - dl.yaw) * Math.min(1, dt * 3);
          dl.pitch += (tp - dl.pitch) * Math.min(1, dt * 3);
        }
        eye = { x: you.body.x, y: you.body.y + 0.5, z: you.body.z, yaw: dl.yaw, pitch: dl.pitch, roll: 0 };
        hide = -1;
      }
      const g = a.alive && !a.drop && !drivenCar ? currentGun(a) : null;
      const wdef = g ? WEAPONS[g.id] : null;
      const zoom = g ? 1 + (zoomOf(g) - 1) * a.ads : 1;
      const fov = (2 * Math.atan(Math.tan((baseV * DEG) / 2) / zoom)) / DEG;
      const scoped = !!g && scopeOf(g) && a.ads > 0.85;
      const dYaw = wrapAngle(eye.yaw - lastLook.current.yaw);
      const dPitch = eye.pitch - lastLook.current.pitch;
      lastLook.current = { yaw: eye.yaw, pitch: eye.pitch };
      const fired = m.events.some((e) => e.t === 'shot' && e.a === a.id);
      // (no gun in hand drawn over the view while over the shoulder, or while freelook has the head turned away)
      const vmState =
        a.alive && wdef && g && tk < 0.05 && Math.abs(fl.yaw) < 0.2 && Math.abs(fl.pitch) < 0.2
          ? {
              gun: g.id,
              ads: a.ads,
              scoped,
              reload: a.reloadT > 0 ? 1 - a.reloadT / wdef.reload : 0,
              switching: a.healT > 0 ? 0.55 : a.switchT > 0 ? Math.min(1, a.switchT / wdef.equip) : 0,
              speed: Math.min(1, Math.hypot(a.body.vx, a.body.vz) / 5.8),
              phase: a.phase,
              air: !a.body.onGround,
              crouch: a.crouch,
              dYaw,
              dPitch,
              sun: 1,
              ambient: 1,
              kit: kitOf(m, a),
              shield: a.paviseUp,
            }
          : null;
      // a flashbang: white while it lasts, fading out over its last second or so
      const blind = a.alive && a.blindT > 0 ? Math.min(1, a.blindT / Math.min(1.2, a.blind0)) : 0;
      view.render({ m, dt, time: time.current, eye, fov, hide, vm: vmState, fired, damage: damageFx.current, low: a.alive ? Math.max(0, (35 - a.hp) / 35) : 0, flash: Math.max(flashFx.current, blind) });
      // fast HUD bits: crosshair spread in pixels, markers, minimap
      const fh = fast.current;
      if (fh) {
        const spreadPx = wdef ? (Math.tan(spreadOf(a) * DEG) / Math.tan((fov * DEG) / 2)) * ((host?.clientHeight ?? 600) / 2) : 0;
        fh.set(spreadPx, a.alive && !scoped && a.ads < 0.6 && !buyRef.current && !drivenCar && !fl.on && Math.abs(fl.yaw) < 0.05);
        fh.tick(dt);
      }
      const hi = hitInfo.current;
      if (hi && host)
        hi.place(view.project, host.clientWidth, host.clientHeight, dt, (id) => {
          const o = m.actors[id];
          return o ? { x: o.body.x, y: o.body.y + o.body.height + 0.32, z: o.body.z, hp: o.hp, alive: o.alive } : null;
        });
      const mk = marks.current;
      if (mk && host) {
        const list: Parameters<MarkersApi['place']>[0] = [];
        const pt = { x: 0, y: 0, z: 0 };
        const W = host.clientWidth;
        const H = host.clientHeight;
        if (m.mode === 'breach' && (m.phase === 'live' || m.phase === 'buy')) {
          const c = m.charge;
          const atk = m.attack === you.team;
          // the sites while the charge is not down yet; then the charge itself (your side always knows where it is
          // once planted, and the attack knows where theirs lies)
          const pin = (key: string, kind: 'site' | 'charge', x: number, y: number, z: number, text: string, sub: string) => {
            view.project(x, y, z, pt);
            const off = pt.z > 1 || pt.x < 40 || pt.x > W - 40 || pt.y < 80 || pt.y > H - 110;
            const rel = wrapAngle(Math.atan2(-(x - eye.x), -(z - eye.z)) - eye.yaw);
            const at = off ? { x: rel > 0 ? 40 : W - 40, y: H * 0.45 + (kind === 'charge' ? 0 : key === 'site0' ? -26 : 26) } : { x: pt.x, y: pt.y };
            list.push({ key, kind, x: at.x, y: at.y, on: true, text, sub });
          };
          if (c.state !== 'planted')
            for (const s of m.world.sites) pin(`site${s.id}`, 'site', s.x, s.y + 3, s.z, s.name, `${Math.round(Math.hypot(s.x - eye.x, s.z - eye.z))} m`);
          if (c.state === 'planted') pin('charge', 'charge', c.x, c.y + 1.2, c.z, `${Math.ceil(c.fuse)}`, atk ? 'guard' : 'defuse');
          else if (c.state === 'dropped' && atk) pin('charge', 'charge', c.x, c.y + 1.2, c.z, 'charge', `${Math.round(Math.hypot(c.x - eye.x, c.z - eye.z))} m`);
        }
        if (m.mode === 'royale')
          for (const s of m.supplies) {
            // a supply crate with loot left: where it is (once it is down) and how far
            if (s.landed < 0 || !supplyLeft(m, s)) continue;
            view.project(s.x, s.y + 2.2, s.z, pt);
            const on = pt.z < 1 && pt.x > 0 && pt.x < W && pt.y > 0 && pt.y < H;
            list.push({ key: `s${s.id}`, kind: 'supply', x: pt.x, y: pt.y, on, text: 'supply', sub: `${Math.round(Math.hypot(s.x - eye.x, s.z - eye.z))} m` });
          }
        if (m.mode === 'breach')
          for (const o of m.actors) {
            if (o.team !== you.team || o === a || !o.alive) continue;
            view.project(o.body.x, o.body.y + o.body.height + 0.35, o.body.z, pt);
            const on = pt.z < 1 && pt.x > 0 && pt.x < W && pt.y > 0 && pt.y < H;
            list.push({ key: `m${o.id}`, kind: 'mate', x: pt.x, y: pt.y, on, text: o.name });
          }
        mk.place(list);
      }
      const cg = m.charge;
      const knows = m.mode === 'breach' && (cg.state === 'planted' || (m.attack === you.team && cg.state !== 'blown' && cg.state !== 'defused'));
      const holder = cg.state === 'carried' ? m.actors[cg.holder] : null;
      const ms: MapState = {
        x: a.body.x,
        z: a.body.z,
        yaw: eye.yaw,
        sites: m.mode === 'breach',
        plantedOn: cg.state === 'planted' ? cg.site : -1,
        charge: !knows ? null : holder ? { x: holder.body.x, z: holder.body.z, planted: false } : { x: cg.x, z: cg.z, planted: cg.state === 'planted' },
        mates: [],
        foes: [],
      };
      if (m.mode === 'royale' && m.zone) {
        const z = m.zone;
        ms.zone = { x: z.x, z: z.z, r: z.r, nx: z.nx, nz: z.nz, nr: z.nr };
        if (m.plane) {
          const at = planeAt(m.plane, m.time);
          ms.plane = { ax: m.plane.ax, az: m.plane.az, bx: m.plane.bx, bz: m.plane.bz, x: at.x, z: at.z };
        } else ms.plane = null;
        ms.red = m.red ? { x: m.red.x, z: m.red.z, r: m.red.r, live: m.red.warn <= 0 } : null;
        ms.drops = [];
        for (const s of m.supplies) if (supplyLeft(m, s)) ms.drops.push({ x: s.x, z: s.z, landed: s.landed >= 0 });
      }
      if (m.cars.length) {
        const list = mapCars.current;
        list.length = m.cars.length;
        for (let i = 0; i < m.cars.length; i++) {
          const c = m.cars[i];
          const e = (list[i] ??= { x: 0, z: 0, yaw: 0, wreck: false, bike: false });
          e.x = c.x;
          e.z = c.z;
          e.yaw = c.yaw;
          e.wreck = !c.alive;
          e.bike = c.kind === 'bike';
        }
        ms.cars = list;
      }
      for (const o of m.actors) {
        if (o === a || !o.alive) continue;
        if (m.mode === 'breach' && o.team === you.team) ms.mates.push({ x: o.body.x, z: o.body.z });
        else if (m.mode === 'breach' && m.time - m.spotted[o.id] < 1.5) ms.foes.push({ x: o.body.x, z: o.body.z });
      }
      mini.current?.draw(ms);
      big.current?.draw(ms);
    },
    { always: shell.status === 'ready' },
  );

  // the HUD snapshot
  const snapshot = (m: Match): Hud => {
    const you = m.actors[m.me];
    const a = watched(m);
    const g = currentGun(a);
    const w = g ? WEAPONS[g.id] : null;
    const st = standings(m);
    const top = st[0];
    const killer = m.actors[you.killer];
    const owned: Hud['owned'] = {};
    for (const i of SHOP_ORDER) owned[i] = owns(you, i);
    return {
      mode: m.mode,
      phase: m.phase,
      timer: m.phaseT,
      round: m.round,
      // yours first, whichever side you are
      score: [m.score[you.team] ?? 0, m.score[1 - you.team] ?? 0],
      pips: [m.actors.filter((o) => o.team === you.team).map((o) => o.alive), m.actors.filter((o) => o.team !== you.team).map((o) => o.alive)],
      breach: m.mode === 'breach' ? breachHud(m, you) : null,
      hp: a.hp,
      hpMax: a.bot ? 100 : Math.round(100 * PERSON_HEALTH),
      armor: a.armor,
      credits: you.credits,
      gun: g && w ? { name: gunLabel(g), mag: g.mag, reserve: m.mode === 'royale' ? spareOf(m, a, g) : g.reserve, max: magOf(g), cls: w.cls, scope: scopeOf(g) } : null,
      slot: a.slot,
      guns: [a.guns[0]?.id ?? null, a.guns[1]?.id ?? null, a.guns[2]?.id ?? null],
      frags: a.frags,
      smokes: a.smokes,
      flashes: a.flashes,
      fires: a.fires,
      impacts: a.impacts,
      decoys: a.decoys,
      pick: nadePick.current,
      pavise: a.pavise / PAVISE.hp,
      paviseUp: a.paviseUp,
      prone: a.alive && (a.prone > 0.5 || a.proneTo),
      lean: a.alive ? a.lean : 0,
      blind: a.alive && a.blindT > 0 ? Math.min(1, a.blindT / Math.min(1.2, a.blind0)) : 0,
      canBuy: canShop(m, you),
      alive: you.alive,
      dead: !you.alive ? { by: you.killedWith === 'zone' ? 'the zone' : you.killedWith === 'blast' ? 'the charge' : you.killedWith === 'shell' ? 'the bombardment' : killer && killer !== you ? killer.name : you.killedWith === 'car' ? 'a wreck' : 'yourself', w: you.killedWith === 'frag' ? 'Frag' : you.killedWith === 'fire' ? 'burned' : you.killedWith === 'impact' ? 'Impact grenade' : you.killedWith === 'zone' ? 'out in the open too long' : you.killedWith === 'blast' ? 'caught in the blast' : you.killedWith === 'shell' ? 'caught in the open under the shells' : you.killedWith === 'car' ? 'a vehicle' : you.killedWith ? WEAPONS[you.killedWith].name : '', head: you.killedHead, respawn: you.respawnT } : null,
      watching: !you.alive && a !== you ? a.name : null,
      feed: [],
      dm: m.mode === 'dm' ? { kills: you.kills, top: top === you ? (st[1]?.kills ?? 0) : top.kills, topName: top === you ? (st[1]?.name ?? '') : top.name, place: st.indexOf(you) + 1, total: m.actors.length } : null,
      scoped: !!g && scopeOf(g) && a.alive && a.ads > 0.85,
      reload: a.reloadT > 0 && w ? 1 - a.reloadT / w.reload : 0,
      rows: (m.mode === 'breach' ? [...m.actors].sort((x, y) => (x.team === you.team ? 0 : 1) - (y.team === you.team ? 0 : 1) || y.cs - x.cs) : m.mode === 'royale' ? royaleRows(m) : st).map((o) => ({ name: o.name, team: m.mode === 'breach' ? (o.team === you.team ? 0 : 1) : -1, k: o.kills, d: o.deaths, a: o.assists, cs: Math.round(o.cs), credits: m.mode === 'breach' && o.team === you.team ? o.credits : null, alive: o.alive, you: o === you })),
      owned,
      royale: m.mode === 'royale' && m.zone ? royaleHud(m, you) : null,
    };
  };

  /** The breach part of the HUD. */
  const breachHud = (m: Match, you: Actor): NonNullable<Hud['breach']> => {
    const c = m.charge;
    const mine = c.plantBy === m.me ? 'plant' : c.defuseBy === m.me ? 'defuse' : null;
    const mate = c.plantBy >= 0 && c.plantBy !== m.me && m.actors[c.plantBy].team === you.team ? `${m.actors[c.plantBy].name} is planting` : c.defuseBy >= 0 && c.defuseBy !== m.me && m.actors[c.defuseBy].team === you.team ? `${m.actors[c.defuseBy].name} is defusing` : null;
    return {
      side: m.attack === you.team ? 'attack' : 'defend',
      charge: c.state,
      carrying: c.state === 'carried' && c.holder === m.me,
      site: c.site >= 0 ? m.world.sites[c.site].name : null,
      fuse: c.fuse,
      work: mine,
      progress: mine === 'plant' ? c.plantT / PLANT_TIME : mine === 'defuse' ? c.defuseT / DEFUSE_TIME : 0,
      kept: c.defuseKept > 0 ? DEFUSE_HALF / DEFUSE_TIME : 0,
      prompt: plantSite(m, you) >= 0 ? 'plant' : canDefuse(m, you) ? 'defuse' : null,
      mateWorking: mate,
    };
  };

  /** The royale part of the HUD. */
  const royaleHud = (m: Match, you: Actor): NonNullable<Hud['royale']> => {
    const z = m.zone!;
    const out = Math.max(0, Math.hypot(you.body.x - z.x, you.body.z - z.z) - z.r);
    const near = lootNear(m, you);
    const red = m.red;
    const redEdge = red ? red.r - Math.hypot(you.body.x - red.x, you.body.z - red.z) : -1;
    const car = you.alive && you.car >= 0 ? m.cars[you.car] : null;
    const door = carNear(m, you);
    return {
      alive: m.alive,
      total: m.actors.length,
      kills: you.kills,
      zoneT: z.i >= ZONES.length ? -1 : z.t,
      closing: z.shrinking,
      outside: out,
      dps: z.dps,
      place: you.alive ? m.alive : you.place,
      drop: you.drop,
      vest: you.armor > 0 ? you.vest : 0,
      helmet: you.helmet,
      pack: you.pack,
      bandages: you.bandages,
      kits: you.kits,
      drinks: you.drinks,
      pills: you.pills,
      boost: you.boost,
      heal: you.healT > 0 && you.healKind ? 1 - you.healT / USE[you.healKind].time : 0,
      healName: you.healKind ? USE[you.healKind].name : null,
      // (everything else is taken by walking over it: F is for swapping the gun in hand, a backpack or a sight)
      pickup: near ? pickupText(you, near) : null,
      red: red && redEdge > -2 ? { edge: Math.max(0, redEdge) + 2, live: red.warn <= 0, t: red.warn, cover: underRoof(m.world, you.body.x, eyeY(you), you.body.z) } : null,
      car: car ? { name: CARS[car.kind].name, kmh: Math.abs(car.speed) * 3.6, hp: car.hp / CARS[car.kind].hp, driving: you.carSeat === 0 } : null,
      drive: door ? `${door.seats[0] < 0 ? 'drive' : 'ride in'} the ${CARS[door.kind].name.toLowerCase()}` : null,
      using: you.healT > 0 ? you.healKind : null,
      caps: { bandage: healCap(you.pack, 'bandage'), kit: healCap(you.pack, 'kit'), drink: boostCap(you.pack, 'drink'), pills: boostCap(you.pack, 'pills') },
      helps: { bandage: canUse(you, 'bandage'), kit: canUse(you, 'kit'), drink: canUse(you, 'drink'), pills: canUse(you, 'pills') },
      ammo: AMMO_KINDS.map((k) => ({ kind: k, n: you.ammo[k], cap: ammoCap(you.pack, k) })),
      nades: { frag: you.frags, fragCap: nadeCap(you.pack, 'frag'), smoke: you.smokes, smokeCap: nadeCap(you.pack, 'smoke') },
      guns: [you.guns[0], you.guns[2], you.guns[1]].filter((g) => !!g).map((g) => gunLabel(g!)),
      crate: crateNear(m, you),
    };
  };

  /** The nearest supply crate with gear left, within 25 m: how far (-1 none). */
  const crateNear = (m: Match, you: Actor) => {
    let best = -1;
    for (const s of m.supplies) {
      if (s.landed < 0 || !supplyLeft(m, s)) continue;
      const d = Math.hypot(s.x - you.body.x, s.z - you.body.z);
      if (d < 25 && (best < 0 || d < best)) best = d;
    }
    return best;
  };

  /** What F does with the item in front of you: take it, swap it for yours, or nothing (an attachment no gun takes). */
  const pickupText = (you: Actor, it: Item) => {
    const name = itemName(it, (id) => WEAPONS[id].name);
    if (it.kind === 'att' && !wants(you, it)) return sightSwap(you, it.what as AttKind) ? `swap for ${name}` : `${name}, fits no gun you carry`;
    const swap = (it.kind === 'gun' && (WEAPONS[it.what as WeaponId].slot === 'secondary' ? you.guns[1] : you.guns[0] && you.guns[2])) || (it.kind === 'pack' && you.pack > 0);
    return `${swap ? 'swap for ' : ''}${name}`;
  };

  /** Royale scoreboard: the most kills first (the living ahead), at most fifteen, and always you. */
  const royaleRows = (m: Match) => {
    const all = [...m.actors].sort((x, y) => y.kills - x.kills || Number(y.alive) - Number(x.alive) || y.damage - x.damage);
    const top = all.slice(0, 15);
    if (!top.includes(m.actors[m.me])) top.push(m.actors[m.me]);
    return top;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // mouse and touch on the view

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (shell.status !== 'playing') return;
    if (e.pointerType === 'touch') {
      if (!touchUi) setTouchUi(true);
      const r = e.currentTarget.getBoundingClientRect();
      const t = touch.current;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (e.clientX - r.left < r.width * 0.42 && t.stick === null) {
        t.stick = e.pointerId;
        t.sx = e.clientX;
        t.sy = e.clientY;
      } else if (t.look === null) {
        t.look = e.pointerId;
        t.lx = e.clientX;
        t.ly = e.clientY;
        // tapping while out switches who you watch
        const m = matchRef.current?.m;
        if (m && !m.actors[m.me].alive) spec.current++;
      }
      return;
    }
    if (touchUi) setTouchUi(false);
    const m = matchRef.current?.m;
    if (m && !m.actors[m.me].alive && locked) spec.current++;
    if (document.pointerLockElement !== hostRef.current) {
      lock();
      return;
    }
    mouse.current.fire = (e.buttons & 1) !== 0;
    mouse.current.ads = (e.buttons & 2) !== 0;
    // (the middle button held: freelook)
    mouse.current.mid = (e.buttons & 4) !== 0;
    if (e.button === 1) e.preventDefault();
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      const t = touch.current;
      if (e.pointerId === t.stick) {
        const dx = e.clientX - t.sx;
        const dy = e.clientY - t.sy;
        const l = Math.hypot(dx, dy);
        const R = 56;
        const k = l > R ? R / l : 1;
        t.mx = (dx * k) / R;
        t.mz = (-dy * k) / R;
      } else if (e.pointerId === t.look) {
        look.current.dx += e.clientX - t.lx;
        look.current.dy += e.clientY - t.ly;
        t.lx = e.clientX;
        t.ly = e.clientY;
      }
      return;
    }
    if (document.pointerLockElement === hostRef.current) {
      look.current.dx += e.movementX;
      look.current.dy += e.movementY;
      mouse.current.fire = (e.buttons & 1) !== 0;
      mouse.current.ads = (e.buttons & 2) !== 0;
      mouse.current.mid = (e.buttons & 4) !== 0;
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      const t = touch.current;
      if (e.pointerId === t.stick) {
        t.stick = null;
        t.mx = t.mz = 0;
      }
      if (e.pointerId === t.look) t.look = null;
      return;
    }
    mouse.current.fire = (e.buttons & 1) !== 0;
    mouse.current.ads = (e.buttons & 2) !== 0;
    mouse.current.mid = (e.buttons & 4) !== 0;
  };
  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (document.pointerLockElement === hostRef.current && Math.abs(e.deltaY) > 4) mouse.current.wheel = Math.sign(e.deltaY);
  };

  // touch buttons
  const fireDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = touch.current;
    t.fire = e.pointerId;
    t.fx = e.clientX;
    t.fy = e.clientY;
  };
  const fireMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const t = touch.current;
    if (e.pointerId !== t.fire) return;
    look.current.dx += e.clientX - t.fx;
    look.current.dy += e.clientY - t.fy;
    t.fx = e.clientX;
    t.fy = e.clientY;
  };
  const fireUp = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.pointerId === touch.current.fire) touch.current.fire = null;
  };
  const tap = (fn: (t: Touch) => void) => (e: RPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    fn(touch.current);
  };

  const buy = (item: ShopItem) => {
    pending.current.buy = item;
  };

  // dev only: lets the screenshot harness look around and read the match (headless browsers have no pointer lock)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const api = {
      match: () => matchRef.current?.m ?? null,
      look: (dx: number, dy: number) => ((look.current.dx += dx), (look.current.dy += dy)),
      mouse: mouse.current,
      touch: touch.current,
      view: () => viewRef.current,
      locked: () => setLocked(true),
      closeBuy: () => openBuy(false),
      /** Hands your seat to a bot, so a whole match can play itself out on screen. */
      autopilot(level: 'easy' | 'normal' | 'hard' = 'hard') {
        const m = matchRef.current?.m;
        if (!m) return;
        m.actors[m.me].bot = true;
        m.actors[m.me].brain = newBrain(level, 0);
      },
      skip(sec: number) {
        const m = matchRef.current?.m;
        if (!m) return;
        for (let t = 0; t < sec && m.phase !== 'over'; t += 1 / 30) step(m, 1 / 30, idleInput(m.actors[m.me].yaw, m.actors[m.me].pitch));
      },
      aim(yaw: number, pitch: number) {
        const m = matchRef.current?.m;
        if (m) {
          m.actors[m.me].yaw = yaw;
          m.actors[m.me].pitch = pitch;
        }
      },
    };
    (window as unknown as { __ridgeline?: typeof api }).__ridgeline = api;
    return () => {
      delete (window as unknown as { __ridgeline?: typeof api }).__ridgeline;
    };
  }, [openBuy]);

  const loading = !world || !ready;
  const playing = shell.status === 'playing' || shell.status === 'paused' || shell.status === 'over';
  const m = matchRef.current?.m ?? null;
  const showHud = playing && !!m && !loading;
  const gunCls = hud.gun?.cls;
  return (
    <div className="g-ridgeline-stage">
      <div ref={hostRef} className="g-ridgeline-host" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      {loading && !glError && (
        <div className="g-ridgeline-loading">
          <b>{MAPS[mapId].name}</b>
          <span>{!world ? (royale ? 'shaping the whole land' : 'shaping the land') : !assets ? 'unpacking the gear' : 'lighting the scene'}</span>
          <i />
        </div>
      )}
      {glError && <div className="g-ridgeline-loading">this browser could not start 3D graphics.</div>}
      {showHud && (
        <div className="g-ridgeline-hud" data-touch={touchUi ? '1' : '0'}>
          {/* (the scope's black mask under everything else, so the scores, health and ammo stay readable) */}
          <Scope on={hud.scoped} />
          <Markers ref={marks} />
          <HitInfo ref={hitInfo} />
          <TopBar h={hud} />
          {world && <Minimap ref={mini} world={world} />}
          <Feed items={feed} />
          <Vitals h={hud} />
          <Ammo h={hud} />
          <Reticle ref={fast} shotgun={gunCls === 'shotgun'} />
          <BannerView b={banner} />
          <MedalView m={medal} />
          <KillConfirm k={killPop} />
          <ItemBar h={hud} onUse={useItem} />
          <DeathPanel h={hud} touch={touchUi} />
          <RoyalePrompts h={hud} touch={touchUi} />
          <BreachPrompts h={hud} touch={touchUi} />
          {kitOpen && hud.royale && <KitPanel h={hud} onUse={useItem} onClose={() => openKit(false)} />}
          {hud.canBuy && !buyOpen && (
            <div className="g-ridgeline-hint">{touchUi ? 'tap Buy for guns and armor' : 'press B to buy'}</div>
          )}
          {!touchUi && !locked && shell.status === 'playing' && !buyOpen && <div className="g-ridgeline-hint is-center">click to aim</div>}
          {buyOpen && hud.canBuy && <BuyMenu h={hud} onBuy={buy} onClose={() => openBuy(false)} />}
          {board && <Scoreboard rows={hud.rows} mode={hud.mode} />}
          {bigMap && world && (
            <div className="g-ridgeline-bigmapWrap">
              <Minimap ref={big} world={world} big />
            </div>
          )}
          {touchUi && shell.status === 'playing' && (
            <div className="g-ridgeline-pad">
              <button type="button" className="g-ridgeline-fire" onPointerDown={fireDown} onPointerMove={fireMove} onPointerUp={fireUp} onPointerCancel={fireUp} aria-label="Fire">
                Fire
              </button>
              <button type="button" className="g-ridgeline-btn is-aim" data-on={touch.current.ads ? '1' : '0'} onPointerDown={tap((t) => (t.ads = !t.ads))}>
                Aim
              </button>
              <button type="button" className="g-ridgeline-btn is-jump" onPointerDown={tap((t) => (t.jump = true))}>
                Jump
              </button>
              <button type="button" className="g-ridgeline-btn is-crouch" data-on={touch.current.crouch ? '1' : '0'} onPointerDown={tap((t) => (proneOn.current ? (proneOn.current = false) : (t.crouch = !t.crouch)))}>
                Crouch
              </button>
              <button type="button" className="g-ridgeline-btn is-prone" data-on={hud.prone ? '1' : '0'} onPointerDown={tap((t) => (t.prone = true))}>
                Prone
              </button>
              <button type="button" className="g-ridgeline-btn is-view" onPointerDown={tap((t) => (t.view = true))} aria-label="Switch first or third person">
                View
              </button>
              <button type="button" className="g-ridgeline-btn is-reload" onPointerDown={tap((t) => (t.reload = true))}>
                Reload
              </button>
              <button type="button" className="g-ridgeline-btn is-swap" onPointerDown={tap((t) => (t.swap = true))}>
                Swap
              </button>
              <button type="button" className="g-ridgeline-btn is-frag" onPointerDown={tap((t) => (t.frag = true))}>
                Frag
              </button>
              <button type="button" className="g-ridgeline-btn is-smoke" onPointerDown={tap((t) => (t.smoke = true))}>
                Smoke
              </button>
              {hud.breach && (
                <button type="button" className="g-ridgeline-btn is-flash" onPointerDown={tap((t) => (t.flash = true))}>
                  Flash
                </button>
              )}
              {hud.fires + hud.impacts + hud.decoys > 0 && (
                <>
                  <button type="button" className="g-ridgeline-btn is-util" onPointerDown={tap((t) => (t.util = true))}>
                    {hud.pick === 'fire' ? 'Fire' : hud.pick === 'impact' ? 'Impact' : hud.pick === 'decoy' ? 'Decoy' : hud.pick === 'smoke' ? 'Smoke' : hud.pick === 'flash' ? 'Flash' : 'Frag'}
                  </button>
                  <button type="button" className="g-ridgeline-btn is-next" onPointerDown={tap((t) => (t.next = true))} aria-label="Next grenade">
                    ⟳
                  </button>
                </>
              )}
              {hud.pavise > 0 && (
                <button type="button" className="g-ridgeline-btn is-shield" data-on={hud.paviseUp ? '1' : '0'} onPointerDown={tap((t) => (t.shield = true))}>
                  Shield
                </button>
              )}
              {hud.royale && (
                <>
                  <button type="button" className="g-ridgeline-btn is-use" data-on={hud.royale.pickup || hud.royale.drive || hud.royale.car ? '1' : '0'} onPointerDown={tap((t) => (t.use = true))}>
                    {hud.royale.car ? 'Exit' : hud.royale.drive ? 'Drive' : 'Grab'}
                  </button>
                  <button type="button" className="g-ridgeline-btn is-heal" onPointerDown={tap((t) => (t.heal = true))}>
                    Heal
                  </button>
                  <button type="button" className="g-ridgeline-btn is-map" onPointerDown={tap(() => setBigMap((b) => !b))}>
                    Map
                  </button>
                </>
              )}
              {hud.breach && (
                <button
                  type="button"
                  className="g-ridgeline-btn is-use"
                  data-on={hud.breach.prompt || hud.breach.work ? '1' : '0'}
                  onPointerDown={tap((t) => (t.hold = true))}
                  onPointerUp={tap((t) => (t.hold = false))}
                  onPointerCancel={tap((t) => (t.hold = false))}
                  onPointerLeave={tap((t) => (t.hold = false))}
                >
                  {hud.breach.side === 'defend' ? 'Defuse' : 'Plant'}
                </button>
              )}
              {hud.canBuy && (
                <button type="button" className="g-ridgeline-btn is-buy" onPointerDown={tap(() => openBuy(!buyRef.current))}>
                  Buy
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
