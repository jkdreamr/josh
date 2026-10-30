import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { GameShell, Segmented, defineSetting, useGameLoop, useKeys, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { playEvents } from './audio.ts';
import { autoQuality, createView, flyover, type Quality, type View } from './gfx/view.ts';
import { paletteOf } from './gfx/soldiers.ts';
import { Ammo, BannerView, BuyMenu, DeathPanel, Feed, Markers, Minimap, Reticle, Scope, Scoreboard, TopBar, Vitals, blankHud, type Banner, type FastHud, type FeedItem, type Hud, type MarkersApi, type MinimapApi } from './hud.tsx';
import { MAPS, MAP_IDS, type MapId } from './maps.ts';
import { DEG, canShop, createMatch, currentGun, eyeY, finalScore, idleInput, owns, spreadOf, standings, step, type Actor, type Input, type Match, type ShopItem } from './match.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import { buildWorld, cacheWorld, cachedWorld, type World } from './world.ts';
import './ridgeline.css';

const MODE = defineSetting('ridgeline:mode', ['uplink', 'dm'] as const, 'uplink');
const MAP = defineSetting('ridgeline:map', ['random', 'vale', 'mesa', 'frost', 'isles'] as const, 'random');
const LEVEL = defineSetting('ridgeline:bots', ['easy', 'normal', 'hard'] as const, 'normal');
const QUALITY = defineSetting('ridgeline:quality', ['auto', 'low', 'medium', 'high', 'ultra'] as const, 'auto', { live: true });
const SENS = defineSetting('ridgeline:sens', ['0.5', '0.75', '1', '1.5', '2'] as const, '1', { live: true });
const DMGUN = defineSetting('ridgeline:dmgun', ['kestrel', 'hornet', 'mauler', 'lancer', 'longbow'] as const, 'kestrel', { live: true });

const modeOptions = [
  ['uplink', 'Uplink 5v5'],
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
const gunOptions = [
  ['kestrel', 'Kestrel'],
  ['hornet', 'Hornet'],
  ['mauler', 'Mauler'],
  ['lancer', 'Lancer'],
  ['longbow', 'Longbow'],
] as const;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />} remount={false}>
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
  const mouse = !shell.touch || finePointer();
  return (
    <div className="g-ridgeline-setup">
      {shell.touch && !mouse && <p className="g-ridgeline-note">on touch: drag the left side to move and the right side to look. hold Fire to shoot (and drag it to aim while you do).</p>}
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Map" value={map} options={mapOptions} onChange={setMap} />
      {map !== 'random' && <p className="g-ridgeline-note">{MAPS[map].tag}</p>}
      <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />
      {mode === 'dm' && <Segmented label="Gun" value={gun} options={gunOptions} onChange={setGun} />}
      <Segmented label="Graphics" value={quality} options={qualityOptions} onChange={setQuality} />
      {mouse && <Segmented label="Mouse" value={sens} options={sensOptions} onChange={setSens} />}
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const [mapSetting] = useSetting(MAP);
  // Random picks a fresh map for each match; a set map always plays that map
  const key = mapSetting === 'random' ? `random:${shell.round}` : mapSetting;
  const mapId = useMemo<MapId>(() => (mapSetting === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : mapSetting), [key]);
  return <Play key={mapId} mapId={mapId} />;
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
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const wrapAngle = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

type Touch = { stick: number | null; sx: number; sy: number; mx: number; mz: number; look: number | null; lx: number; ly: number; fire: number | null; fx: number; fy: number; ads: boolean; crouch: boolean; jump: boolean; reload: boolean; swap: boolean; frag: boolean; smoke: boolean };

function Play({ mapId }: { mapId: MapId }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const THREE = useThree();
  const [mode] = useSetting(MODE);
  const [level] = useSetting(LEVEL);
  const [qSetting] = useSetting(QUALITY);
  const [sens] = useSetting(SENS);
  const [dmGun] = useSetting(DMGUN);
  const settings = useRef({ mode, level, sens: Number(sens), dmGun });
  settings.current = { mode, level, sens: Number(sens), dmGun };
  const quality: Quality = qSetting === 'auto' ? autoQuality(shell.touch && !finePointer()) : qSetting;
  const [world, setWorld] = useState<World | null>(() => cachedWorld(mapId));
  const [glError, setGlError] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const matchRef = useRef<{ m: Match; round: number } | null>(null);
  const [hud, setHud] = useState<Hud>(() => blankHud(mode));
  const [banner, setBanner] = useState<Banner | null>(null);
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

  // input state
  const look = useRef({ dx: 0, dy: 0 });
  const mouse = useRef({ fire: false, ads: false, wheel: 0 });
  const touch = useRef<Touch>({ stick: null, sx: 0, sy: 0, mx: 0, mz: 0, look: null, lx: 0, ly: 0, fire: null, fx: 0, fy: 0, ads: false, crouch: false, jump: false, reload: false, swap: false, frag: false, smoke: false });
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
  const time = useRef(0);
  const lastLook = useRef({ yaw: 0, pitch: 0 });
  const lastRender = useRef(0);
  const firstBuy = useRef(true);

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
    const fallback = () => window.setTimeout(() => alive && done(buildWorld(mapId)), 30);
    try {
      worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<World>) => done(e.data);
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        fallback();
      };
      worker.postMessage(mapId);
    } catch {
      fallback();
    }
    return () => {
      alive = false;
      worker?.terminate();
    };
  }, [mapId, world]);

  // the view
  useEffect(() => {
    const host = hostRef.current;
    if (!THREE || !world || !host) return;
    const view = createView(THREE, host, world, quality);
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
  }, [THREE, world, quality]);

  // a new match for each round of the shell (Play, Restart, Play Again)
  const ensureMatch = useCallback(() => {
    const s = shellRef.current;
    if (!world || (s.status !== 'playing' && s.status !== 'paused')) return matchRef.current?.m ?? null;
    if (!matchRef.current || matchRef.current.round !== s.round) {
      const st = settings.current;
      const m = createMatch(world, st.mode, st.level, { name: myName(), dmPick: st.dmGun as WeaponId });
      matchRef.current = { m, round: s.round };
      camY.current = null;
      overAt.current = null;
      finished.current = false;
      spec.current = 0;
      firstBuy.current = true;
      setFeed([]);
      setBuyOpen(false);
      setHud(blankHud(st.mode));
      s.setScore(null);
      // the first round's buy phase starts with the match, before any frame could report it
      if (m.mode === 'uplink') {
        setBanner({ title: 'Round 1', sub: 'buy phase. pistols and armor are cheap, so spend it', tone: 'info', key: Date.now() });
        if (!touchRef.current) {
          firstBuy.current = false;
          setBuyOpen(true);
        }
      } else setBanner({ title: 'Deathmatch', sub: 'everyone for themselves. first to 25', tone: 'info', key: Date.now() });
    }
    return matchRef.current.m;
  }, [world]);

  // pointer lock: click to capture the mouse; losing it (Esc) pauses
  useEffect(() => {
    const onChange = () => {
      const host = hostRef.current;
      const now = !!host && document.pointerLockElement === host;
      setLocked(now);
      if (!now) {
        mouse.current.fire = false;
        mouse.current.ads = false;
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

  const pending = useRef<{ buy: ShopItem | null }>({ buy: null });

  const keys = useKeys((code, e) => {
    if (code === 'Tab') e?.preventDefault();
    if (code === 'KeyB') {
      const m = matchRef.current?.m;
      if (m && canShop(m, m.actors[0])) openBuy(!buyRef.current);
      else if (buyRef.current) openBuy(false);
    }
    if (code === 'Escape' && buyRef.current) openBuy(false);
  });

  // Escape closes the buy menu instead of pausing
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || !buyRef.current || shellRef.current.status !== 'playing') return;
      e.preventDefault();
      e.stopPropagation();
      openBuy(false);
    };
    root.addEventListener('keydown', onKey, true);
    return () => root.removeEventListener('keydown', onKey, true);
  }, [shell.root, openBuy]);

  const pushBanner = (title: string, sub: string, tone: Banner['tone']) => setBanner({ title, sub, tone, key: Date.now() + Math.random() });

  const nameColor = (m: Match, a: Actor) => (m.mode === 'uplink' ? TEAM_COLORS[a.team] : hex(paletteOf(m, a).band));

  /** The actor the camera looks out of: you, or a teammate you watch while you are out. */
  const watched = (m: Match) => {
    const you = m.actors[0];
    if (you.alive || m.mode === 'dm') return you;
    const mates = m.actors.filter((a) => a.alive && a.team === you.team && a !== you);
    if (!mates.length) return you;
    return mates[((spec.current % mates.length) + mates.length) % mates.length];
  };

  const finish = (m: Match) => {
    if (finished.current) return;
    finished.current = true;
    const you = m.actors[0];
    const score = finalScore(m);
    const mapName = MAPS[mapId].name;
    const lvl = settings.current.level;
    if (m.mode === 'uplink') {
      const won = m.winner === 0;
      shellRef.current.gameOver(score, {
        title: m.winner < 0 ? 'Draw' : won ? 'Victory' : 'Defeat',
        detail: `${m.score[0]} to ${m.score[1]} on ${mapName}. you went ${you.kills}/${you.deaths}/${you.assists} with ${Math.round(you.damage)} damage.`,
        board: `uplink-${m.level}`,
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
      const you = m.actors[0];
      const st = settings.current;
      const t = touch.current;
      const k = keys;
      // look: mouse (pointer locked) or touch drags, slower while zoomed in
      const g0 = currentGun(you);
      const w0 = g0 ? WEAPONS[g0.id] : null;
      const zoom = w0 ? 1 + (w0.zoom - 1) * you.ads : 1;
      const sensK = (touchRef.current ? 0.0052 : 0.0021) * st.sens * (1 / zoom) * (zoom > 1.01 ? 1.15 : 1);
      let yaw = you.yaw - look.current.dx * sensK;
      let pitch = you.pitch - look.current.dy * sensK;
      look.current.dx = 0;
      look.current.dy = 0;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      const shopOpen = buyRef.current;
      const inp: Input = idleInput(yaw, pitch);
      if (!shopOpen) {
        inp.mz = (k.down('KeyW', 'ArrowUp') ? 1 : 0) - (k.down('KeyS', 'ArrowDown') ? 1 : 0) + t.mz;
        inp.mx = (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0) + t.mx;
        const stick = Math.hypot(t.mx, t.mz);
        inp.walk = k.down('ShiftLeft', 'ShiftRight') || (t.stick !== null && stick > 0.05 && stick < 0.55);
        inp.crouch = k.down('KeyC') || t.crouch;
        inp.jump = k.pressed('Space') || t.jump;
        inp.reload = k.pressed('KeyR') || t.reload;
        inp.fire = (locked && mouse.current.fire) || t.fire !== null;
        inp.ads = (locked && mouse.current.ads) || t.ads;
        if (k.pressed('Digit1')) inp.slot = 0;
        if (k.pressed('Digit2')) inp.slot = 1;
        if (mouse.current.wheel !== 0 || t.swap) inp.slot = you.slot === 0 ? 1 : 0;
        if (k.pressed('Digit3', 'KeyG') || t.frag) inp.throw = 'frag';
        if (k.pressed('Digit4', 'KeyQ') || t.smoke) inp.throw = 'smoke';
      }
      mouse.current.wheel = 0;
      t.jump = t.reload = t.swap = t.frag = t.smoke = false;
      const p = pending.current;
      if (p.buy) inp.buy = p.buy;
      p.buy = null;
      setBoard(k.down('Tab'));
      setBigMap(k.down('KeyM'));

      step(m, dt, inp);

      // feedback from what happened
      for (const e of m.events) {
        if (e.t === 'hit') {
          if (e.a === 0 && e.v !== 0) fast.current?.hit(e.kill, e.zone === 'head');
          if (e.v === 0) {
            const att = m.actors[e.a];
            if (att) fast.current?.hurt(wrapAngle(Math.atan2(-(att.body.x - you.body.x), -(att.body.z - you.body.z)) - you.yaw) * -1);
            damageFx.current = Math.min(1, damageFx.current + e.dmg / 60);
          }
        }
        if (e.t === 'kill') {
          const kk = e.k;
          const ka = m.actors[kk.killer];
          const va = m.actors[kk.victim];
          const item: FeedItem = { id: ++feedId.current, killer: ka?.name ?? '?', victim: va.name, kc: ka ? nameColor(m, ka) : '#fff', vc: nameColor(m, va), w: kk.w === 'frag' ? 'Frag' : WEAPONS[kk.w].name, head: kk.head, mine: kk.killer === 0 || kk.victim === 0 };
          setFeed((f) => [...f.slice(-5), item]);
          if (kk.victim === 0) {
            deathLook.current = { yaw: you.yaw, pitch: you.pitch };
            spec.current = 0;
          }
        }
        if (e.t === 'phase') {
          if (e.phase === 'buy') {
            pushBanner(`Round ${m.round}`, m.score[0] === 6 || m.score[1] === 6 ? 'match point. buy phase' : 'buy phase', 'info');
            if (firstBuy.current && !touchRef.current) {
              firstBuy.current = false;
              openBuy(true);
            }
          }
          if (e.phase === 'live') {
            if (buyRef.current) openBuy(false);
            if (m.mode === 'uplink') pushBanner(`Uplink ${m.world.sites[m.site].name} is live`, `${m.world.sites[m.site].town}. hold it or knock them all out`, 'info');
          }
        }
        if (e.t === 'round') {
          const won = e.winner === you.team;
          const why = e.why === 'cap' ? (won ? 'uplink held' : 'they held the uplink') : e.why === 'elim' ? (won ? 'all knocked out' : 'your team is out') : 'time ran out';
          pushBanner(e.winner < 0 ? 'Round drawn' : won ? 'Round won' : 'Round lost', why, e.winner < 0 ? 'info' : won ? 'win' : 'loss');
        }
      }
      damageFx.current = Math.max(0, damageFx.current - dt * 1.4);
      flashFx.current = Math.max(0, flashFx.current - dt * 3);
      if (m.phase === 'over') {
        if (overAt.current === null) {
          overAt.current = time.current;
          const won = m.mode === 'uplink' ? m.winner === 0 : m.winner === 0;
          pushBanner(m.mode === 'uplink' ? (m.winner < 0 ? 'Draw' : won ? 'Victory' : 'Defeat') : won ? 'You won' : `${m.actors[m.winner]?.name ?? ''} wins`, m.mode === 'uplink' ? `${m.score[0]} to ${m.score[1]}` : '', won ? 'win' : 'loss');
        }
        if (time.current - overAt.current > 3.2) finish(m);
      }

      // sound from where the camera is
      const eyeA = watched(m);
      playEvents(m, m.events, eyeA.body.x, eyeA.body.z, 0);

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
      const you = m.actors[0];
      const a = watched(m);
      let eye = { x: a.body.x, y: eyeY(a), z: a.body.z, yaw: a.yaw, pitch: a.pitch };
      // smooth steps up (stairs, crates) without lagging falls
      if (a === you) {
        const target = eye.y;
        if (camY.current === null || Math.abs(camY.current - target) > 2.5 || target < camY.current) camY.current = target;
        else camY.current += (target - camY.current) * Math.min(1, dt * 16);
        eye.y = camY.current;
      }
      let hide = a.id;
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
        eye = { x: you.body.x, y: you.body.y + 0.5, z: you.body.z, yaw: dl.yaw, pitch: dl.pitch };
        hide = -1;
      }
      const g = a.alive ? currentGun(a) : null;
      const wdef = g ? WEAPONS[g.id] : null;
      const zoom = wdef ? 1 + (wdef.zoom - 1) * a.ads : 1;
      const fov = (2 * Math.atan(Math.tan((baseV * DEG) / 2) / zoom)) / DEG;
      const scoped = !!wdef?.scope && a.ads > 0.85;
      const dYaw = wrapAngle(eye.yaw - lastLook.current.yaw);
      const dPitch = eye.pitch - lastLook.current.pitch;
      lastLook.current = { yaw: eye.yaw, pitch: eye.pitch };
      const fired = m.events.some((e) => e.t === 'shot' && e.a === a.id);
      const vmState =
        a.alive && wdef && g
          ? {
              gun: g.id,
              ads: a.ads,
              scoped,
              reload: a.reloadT > 0 ? 1 - a.reloadT / wdef.reload : 0,
              switching: a.switchT > 0 ? Math.min(1, a.switchT / wdef.equip) : 0,
              speed: Math.min(1, Math.hypot(a.body.vx, a.body.vz) / 5.8),
              phase: a.phase,
              air: !a.body.onGround,
              crouch: a.crouch,
              dYaw,
              dPitch,
              sun: 1,
              ambient: 1,
              sleeve: m.mode === 'uplink' ? (a.team === 0 ? 0x3d4c5e : 0x7a6a4c) : paletteOf(m, a).shirt,
            }
          : null;
      view.render({ m, dt, time: time.current, eye, fov, hide, vm: vmState, fired, damage: damageFx.current, low: a.alive ? Math.max(0, (35 - a.hp) / 35) : 0, flash: flashFx.current });
      // fast HUD bits: crosshair spread in pixels, markers, minimap
      const fh = fast.current;
      if (fh) {
        const spreadPx = wdef ? (Math.tan(spreadOf(a) * DEG) / Math.tan((fov * DEG) / 2)) * ((host?.clientHeight ?? 600) / 2) : 0;
        fh.set(spreadPx, a.alive && !scoped && !buyRef.current);
        fh.tick(dt);
      }
      const mk = marks.current;
      if (mk && host) {
        const list: Parameters<MarkersApi['place']>[0] = [];
        const pt = { x: 0, y: 0, z: 0 };
        const W = host.clientWidth;
        const H = host.clientHeight;
        if (m.mode === 'uplink' && (m.phase === 'live' || m.phase === 'buy')) {
          const s = m.world.sites[m.site];
          view.project(s.x, s.y + 3, s.z, pt);
          // off screen or behind: pin it to the side you should turn toward
          const off = pt.z > 1 || pt.x < 40 || pt.x > W - 40 || pt.y < 80 || pt.y > H - 110;
          const rel = wrapAngle(Math.atan2(-(s.x - eye.x), -(s.z - eye.z)) - eye.yaw);
          const c = off ? { x: rel > 0 ? 40 : W - 40, y: H * 0.45 } : { x: pt.x, y: pt.y };
          list.push({ key: 'site', kind: 'site', x: c.x, y: c.y, on: true, text: s.name, sub: `${Math.round(Math.hypot(s.x - eye.x, s.z - eye.z))} m` });
        }
        if (m.mode === 'uplink')
          for (const o of m.actors) {
            if (o.team !== you.team || o === a || !o.alive) continue;
            view.project(o.body.x, o.body.y + o.body.height + 0.35, o.body.z, pt);
            const on = pt.z < 1 && pt.x > 0 && pt.x < W && pt.y > 0 && pt.y < H;
            list.push({ key: `m${o.id}`, kind: 'mate', x: pt.x, y: pt.y, on, text: o.name });
          }
        mk.place(list);
      }
      const ms = { x: a.body.x, z: a.body.z, yaw: eye.yaw, site: m.site, live: m.mode === 'uplink', mates: [] as { x: number; z: number }[], foes: [] as { x: number; z: number }[] };
      for (const o of m.actors) {
        if (o === a || !o.alive) continue;
        if (m.mode === 'uplink' && o.team === you.team) ms.mates.push({ x: o.body.x, z: o.body.z });
        else if (m.mode === 'uplink' && m.time - m.spotted[o.id] < 1.5) ms.foes.push({ x: o.body.x, z: o.body.z });
      }
      mini.current?.draw(ms);
      big.current?.draw(ms);
    },
    { always: shell.status === 'ready' },
  );

  // the HUD snapshot
  const snapshot = (m: Match): Hud => {
    const you = m.actors[0];
    const a = watched(m);
    const g = currentGun(a);
    const w = g ? WEAPONS[g.id] : null;
    const st = standings(m);
    const top = st[0];
    const killer = m.actors[you.killer];
    const owned: Hud['owned'] = {};
    for (const i of ['wren', 'bulwark', 'hornet', 'mauler', 'kestrel', 'lancer', 'longbow', 'light', 'heavy', 'frag', 'smoke'] as ShopItem[]) owned[i] = owns(you, i);
    return {
      mode: m.mode,
      phase: m.phase,
      timer: m.phaseT,
      round: m.round,
      score: [m.score[0], m.score[1]],
      pips: [m.actors.filter((o) => o.team === 0).map((o) => o.alive), m.actors.filter((o) => o.team === 1).map((o) => o.alive)],
      site: m.mode === 'uplink' ? m.world.sites[m.site].name : null,
      cap: [m.cap[0], m.cap[1]],
      onSite: [m.onSite[0], m.onSite[1]],
      hp: a.hp,
      armor: a.armor,
      credits: you.credits,
      gun: g && w ? { name: w.name, mag: g.mag, reserve: g.reserve, max: w.mag, cls: w.cls } : null,
      slot: a.slot,
      guns: [a.guns[0]?.id ?? null, a.guns[1]?.id ?? null],
      frags: a.frags,
      smokes: a.smokes,
      canBuy: canShop(m, you),
      alive: you.alive,
      dead: !you.alive ? { by: killer && killer !== you ? killer.name : 'yourself', w: you.killedWith === 'frag' ? 'Frag' : you.killedWith ? WEAPONS[you.killedWith].name : '', head: you.killedHead, respawn: you.respawnT } : null,
      watching: !you.alive && a !== you ? a.name : null,
      feed: [],
      dm: m.mode === 'dm' ? { kills: you.kills, top: top === you ? (st[1]?.kills ?? 0) : top.kills, topName: top === you ? (st[1]?.name ?? '') : top.name, place: st.indexOf(you) + 1, total: m.actors.length } : null,
      scoped: !!w?.scope && a.alive && a.ads > 0.85,
      reload: a.reloadT > 0 && w ? 1 - a.reloadT / w.reload : 0,
      rows: (m.mode === 'uplink' ? [...m.actors].sort((x, y) => x.team - y.team || y.cs - x.cs) : st).map((o) => ({ name: o.name, team: m.mode === 'uplink' ? o.team : -1, k: o.kills, d: o.deaths, a: o.assists, cs: Math.round(o.cs), credits: m.mode === 'uplink' && o.team === you.team ? o.credits : null, alive: o.alive, you: o === you })),
      owned,
    };
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
        if (m && !m.actors[0].alive) spec.current++;
      }
      return;
    }
    if (touchUi) setTouchUi(false);
    const m = matchRef.current?.m;
    if (m && !m.actors[0].alive && locked) spec.current++;
    if (document.pointerLockElement !== hostRef.current) {
      lock();
      return;
    }
    mouse.current.fire = (e.buttons & 1) !== 0;
    mouse.current.ads = (e.buttons & 2) !== 0;
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
      view: () => viewRef.current,
      locked: () => setLocked(true),
      closeBuy: () => openBuy(false),
      skip(sec: number) {
        const m = matchRef.current?.m;
        if (!m) return;
        for (let t = 0; t < sec && m.phase !== 'over'; t += 1 / 30) step(m, 1 / 30, idleInput(m.actors[0].yaw, m.actors[0].pitch));
      },
      aim(yaw: number, pitch: number) {
        const m = matchRef.current?.m;
        if (m) {
          m.actors[0].yaw = yaw;
          m.actors[0].pitch = pitch;
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
          <span>{!world ? 'shaping the land' : 'lighting the scene'}</span>
          <i />
        </div>
      )}
      {glError && <div className="g-ridgeline-loading">this browser could not start 3D graphics.</div>}
      {showHud && (
        <div className="g-ridgeline-hud">
          <Markers ref={marks} />
          <TopBar h={hud} />
          {world && <Minimap ref={mini} world={world} />}
          <Feed items={feed} />
          <Vitals h={hud} />
          <Ammo h={hud} />
          <Reticle ref={fast} shotgun={gunCls === 'shotgun'} />
          <Scope on={hud.scoped} />
          <BannerView b={banner} />
          <DeathPanel h={hud} touch={touchUi} />
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
              <button type="button" className="g-ridgeline-btn is-crouch" data-on={touch.current.crouch ? '1' : '0'} onPointerDown={tap((t) => (t.crouch = !t.crouch))}>
                Crouch
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
