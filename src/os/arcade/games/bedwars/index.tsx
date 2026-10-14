import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { createGame, type Ev, type Game, type Level, type Pace } from './game.ts';
import { Session, type OnlineApi } from './session.ts';
import { Client, type Hud } from './client.ts';
import { createView, type View } from './scene.ts';
import { CENTER, MID_TOP, type Mode } from './map.ts';
import { TEAMS } from './blocks.ts';
import { Crosshair, Feed, Hotbar, HowToPlay, InventoryPanel, Locker, PlayerList, RecordStrip, Scoreboard, Sheet, ShopPanel, TitleView, UpgradesPanel } from './hud.tsx';
import { AXE_NAMES, ITEM_DEFS, PICK_NAMES } from './items.ts';
import { addGame, freshRecord, isUnlocked, loadRecord, newUnlocks, saveRecord, subscribeRecord } from './stats.ts';
import './bedwars.css';

const MODE = defineSetting('bedwars:mode', ['solo', 'doubles'] as const, 'solo');
const LEVEL = defineSetting('bedwars:bots', ['easy', 'normal', 'hard'] as const, 'normal');
const PACE = defineSetting('bedwars:pace', ['quick', 'classic'] as const, 'quick');
const SENS = defineSetting('bedwars:sens', ['0.5', '1', '1.5', '2'] as const, '1', { live: true });
const SPRINT = defineSetting('bedwars:sprint', ['auto', 'manual'] as const, 'auto', { live: true });
const FILL = defineSetting('bedwars:fill', ['bots', 'none'] as const, 'bots');
const SKIN = defineSetting('bedwars:skin', ['0', '1', '2', '3', '4', '5'] as const, '0', { live: true });
const KILLFX = defineSetting('bedwars:killfx', ['cardinal', 'firework', 'lightning', 'tree'] as const, 'cardinal', { live: true });
const BEDFX = defineSetting('bedwars:bedfx', ['confetti', 'blast', 'axe'] as const, 'confetti', { live: true });

const SERVER_RECORD = freshRecord();
let recordCache = SERVER_RECORD;
let recordFresh = false;
subscribeRecord(() => {
  recordFresh = false;
});
const getRecord = () => {
  if (!recordFresh) {
    recordCache = loadRecord();
    recordFresh = true;
  }
  return recordCache;
};
/** Your record on this device, shared by the cards and the game. */
const useRecord = () => useSyncExternalStore(subscribeRecord, getRecord, () => SERVER_RECORD);

/** The equipped cosmetic, or the free one if it is locked here (a setting can outlive the record). */
function useCosmetics() {
  const r = useRecord();
  const [skin] = useSetting(SKIN);
  const [kill] = useSetting(KILLFX);
  const [bed] = useSetting(BEDFX);
  return {
    skin: isUnlocked(r, 'skin', skin) ? Number(skin) : 0,
    kill: isUnlocked(r, 'kill', kill) ? kill : 'cardinal',
    bed: isUnlocked(r, 'bed', bed) ? bed : 'confetti',
  };
}

const modeOptions = [
  ['solo', 'Solo'],
  ['doubles', 'Doubles'],
] as const;
const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const;
const paceOptions = [
  ['quick', 'Quick'],
  ['classic', 'Classic'],
] as const;
const sensOptions = [
  ['0.5', 'Low'],
  ['1', 'Mid'],
  ['1.5', 'High'],
  ['2', 'Max'],
] as const;
const fillOptions = [
  ['bots', 'Fill with Bots'],
  ['none', 'Humans Only'],
] as const;
const sprintOptions = [
  ['auto', 'Auto'],
  ['manual', 'Double Tap W'],
] as const;

const BOT_NAMES = ['Tree', 'Hoover', 'Lagunita', 'Branner', 'Wilbur', 'Gates', 'Meyer', 'Coho', 'Treehouse', 'Roble', 'Toyon', 'Arrillaga', 'Florence', 'Stern', 'Mirrielees'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Stage />
    </GameShell>
  );
}

/** Is there a mouse or trackpad (a touchscreen laptop has both)? */
const finePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(any-pointer: fine)').matches;

/** Which controls this device has: touch where the shell sees a touchscreen, mouse wherever there is a fine pointer. */
function useInputs() {
  const shell = useShell();
  const fine = useMemo(finePointer, []);
  return { touch: shell.touch, mouse: !shell.touch || fine };
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [pace, setPace] = useSetting(PACE);
  const [sens, setSens] = useSetting(SENS);
  const [sprint, setSprint] = useSetting(SPRINT);
  const inputs = useInputs();
  return (
    <div className="g-bedwars-setup">
      {inputs.touch && !inputs.mouse && <TouchNote />}
      <Extras />
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />
      <Segmented label="Pace" value={pace} options={paceOptions} onChange={setPace} />
      {inputs.mouse && <Segmented label="Mouse" value={sens} options={sensOptions} onChange={setSens} />}
      {inputs.mouse && <Segmented label="Sprint" value={sprint} options={sprintOptions} onChange={setSprint} />}
    </div>
  );
}

/** The card's controls line is about keys and the mouse; on a phone or tablet, this says what the thumbs do. */
function TouchNote() {
  return <p className="g-bedwars-touchNote">on touch: drag the left side to walk and the right side to look. How to Play has every button.</p>;
}

/** Your record, How to Play and the Locker, with the sheets they open over the cards. */
function Extras() {
  const shell = useShell();
  const inputs = useInputs();
  const r = useRecord();
  const [skin, setSkin] = useSetting(SKIN);
  const [kill, setKill] = useSetting(KILLFX);
  const [bed, setBed] = useSetting(BEDFX);
  const [open, setOpen] = useState<'help' | 'locker' | null>(null);
  const close = () => {
    setOpen(null);
    shell.root.current?.focus({ preventScroll: true });
  };
  return (
    <div className="g-bedwars-extras">
      {r.games > 0 && <RecordStrip r={r} />}
      <div className="g-bedwars-extraBtns">
        <button type="button" className="arcade-btn" onClick={() => setOpen('help')}>
          How to Play
        </button>
        <button type="button" className="arcade-btn" onClick={() => setOpen('locker')}>
          Locker
        </button>
      </div>
      {open === 'help' && (
        <Sheet root={shell.root.current} title="How to Play" onClose={close}>
          <HowToPlay touch={inputs.touch} mouse={inputs.mouse} />
        </Sheet>
      )}
      {open === 'locker' && (
        <Sheet root={shell.root.current} title="Locker" onClose={close}>
          <Locker r={r} skin={skin} kill={kill} bed={bed} onSkin={(v) => setSkin(v as typeof skin)} onKill={(v) => setKill(v as typeof kill)} onBed={(v) => setBed(v as typeof bed)} />
        </Sheet>
      )}
    </div>
  );
}

/** Room settings: the host picks the mode, bots and pace for everyone (guests learn them when the round starts). */
function OnlineSetup() {
  const online = useOnline();
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [pace, setPace] = useSetting(PACE);
  const [fill, setFill] = useSetting(FILL);
  const inputs = useInputs();
  if (online && !online.isHost)
    return (
      <div className="g-bedwars-setup">
        {inputs.touch && !inputs.mouse && <TouchNote />}
        <Extras />
        <small className="g-bedwars-hostnote">the host picks the mode, bots and pace.</small>
      </div>
    );
  return (
    <div className="g-bedwars-setup">
      {inputs.touch && !inputs.mouse && <TouchNote />}
      <Extras />
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Slots" value={fill} options={fillOptions} onChange={setFill} />
      {fill === 'bots' && <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />}
      <Segmented label="Pace" value={pace} options={paceOptions} onChange={setPace} />
    </div>
  );
}

type StageMode = 'idle' | 'solo' | 'online';

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  /** An online round the host carries on offline after everyone else left: it keeps its key (and its game). */
  const detached = useRef('');
  if (shell.status === 'ready') {
    current.current = { key: 'idle', mode: 'idle' };
    detached.current = '';
  } else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : detached.current && detached.current === current.current.key ? detached.current : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  const key = current.current.key;
  return <Play key={key} mode={current.current.mode} onDetach={() => (detached.current = key)} />;
}

/** Your name in solo games: the one you use online, or the campus color. */
function myName() {
  try {
    const n = window.localStorage.getItem('arcade:name')?.trim();
    if (n) return n.slice(0, 16);
  } catch {
    /* storage blocked */
  }
  return 'Cardinal';
}

function soloGame(mode: Mode, level: Level, pace: Pace, skin: number): Game {
  const n = 8;
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const entrants = Array.from({ length: n }, (_, i) =>
    i === 0 ? { name: myName(), seat: 0, ctrl: 'local' as const, skin, team: 0 } : { name: names[i % names.length], seat: -1, ctrl: 'bot' as const, skin: (i * 3) % 6 },
  );
  return createGame({ mode, pace, level, entrants, seed: (Math.random() * 2 ** 31) >>> 0 });
}

function Play({ mode, onDetach }: { mode: StageMode; onDetach: () => void }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const THREE = useThree();
  const [modeSetting] = useSetting(MODE);
  const [level] = useSetting(LEVEL);
  const [pace] = useSetting(PACE);
  const [sens] = useSetting(SENS);
  const [sprint] = useSetting(SPRINT);
  const [fill] = useSetting(FILL);
  const looks = useCosmetics();
  const looksRef = useRef(looks);
  looksRef.current = looks;
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = mode === 'online' && !!online;
  const sessionRef = useRef<Session | null>(null);
  const meRef = useRef(0);
  const [ready, setReady] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Client | null>(null);
  const gameRef = useRef<Game | null>(null);
  const viewRef = useRef<View | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [tab, setTab] = useState(false);
  const [heldName, setHeldName] = useState<{ id: number; text: string } | null>(null);
  const lastHeld = useRef('');
  const [locked, setLocked] = useState(false);
  const [, force] = useState(0);
  const pinged = useRef(true);
  const hudClock = useRef(0);
  const unlockOnPurpose = useRef(false);
  const overAt = useRef<number | null>(null);
  const idle = mode === 'idle';
  const idleAngle = useRef(0);
  /** Everyone else left an online round and the host plays on against the bots, offline. */
  const [detached, setDetached] = useState(false);
  const soloLike = mode === 'solo' || detached;
  const soloRef = useRef(soloLike);
  soloRef.current = soloLike;
  /** Touch or mouse, by what the player last used (a touchscreen laptop's mouse still aims and fights). */
  const [input, setInput] = useState<'touch' | 'mouse'>(() => (shell.touch && !finePointer() ? 'touch' : 'mouse'));
  const touch = input === 'touch';
  const inputRef = useRef(input);
  inputRef.current = input;
  const lastFrame = useRef(0);
  const roundRef = useRef(0);
  const knobRef = useRef<HTMLElement>(null);

  if (!gameRef.current && !live) gameRef.current = soloGame(modeSetting, level as Level, pace as Pace, looks.skin);

  // online: the host builds the game, guests wait for its sync
  useEffect(() => {
    if (!live) return;
    roundRef.current = onlineRef.current?.round ?? 0;
    const api: OnlineApi = {
      get seat() {
        return onlineRef.current?.seat ?? 0;
      },
      get isHost() {
        return !!onlineRef.current?.isHost;
      },
      get round() {
        return onlineRef.current?.round ?? 0;
      },
      get players() {
        return onlineRef.current?.players ?? [];
      },
      get transport() {
        return onlineRef.current?.transport ?? 'relay';
      },
      send: (d, o) => {
        try {
          onlineRef.current?.send(d, o);
        } catch {
          /* a full or closed channel: the next packet tries again, and the frame goes on */
        }
      },
      onMessage: (fn) => onlineRef.current?.onMessage(fn) ?? (() => {}),
    };
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const session = new Session(api, {
      mode: modeSetting,
      level: level as Level,
      pace: pace as Pace,
      bots: fill === 'bots',
      skin: looks.skin,
      botNames: names,
      onReady: (game, me) => {
        gameRef.current = game;
        meRef.current = me;
        setReady((n) => n + 1);
      },
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [live]);
  useEffect(() => {
    if (online) sessionRef.current?.playersChanged(online.players);
  }, [online?.players]);
  // The shell closes the room when nobody else is left in it. The host's round has bots in it, so it plays on offline:
  // the players who left are bots already or become bots now, and the shell is told to keep playing.
  const wasHost = useRef(false);
  useEffect(() => {
    if (online) {
      wasHost.current = online.isHost;
      return;
    }
    const g = gameRef.current;
    if (mode !== 'online' || detached || !wasHost.current || !g || g.over || shellRef.current.status !== 'over') return;
    for (const p of g.players)
      if (p.ctrl === 'remote') {
        p.ctrl = 'bot';
        p.gone = true;
      }
    const c = clientRef.current;
    if (c) {
      c.hooks.send = c.hooks.broadcast = c.hooks.onTick = undefined;
      c.say('everyone else left, so this one is offline now. the bots play on.');
    }
    setDetached(true);
    onDetach();
    shellRef.current.start();
  }, [online]);

  // settings that apply live
  useEffect(() => {
    const c = clientRef.current;
    if (!c) return;
    c.settings.sens = Number(sens);
    c.settings.autoSprint = sprint === 'auto';
    c.settings.touch = touch;
    c.settings.killFx = looks.kill;
    c.settings.bedFx = looks.bed;
  }, [sens, sprint, touch, looks.kill, looks.bed]);

  // the view and the client
  useEffect(() => {
    const host = hostRef.current;
    const game = gameRef.current;
    if (!THREE || !host || !game) return;
    const view = createView(THREE, host, game);
    if (!view) return;
    viewRef.current = view;
    const session = sessionRef.current;
    const role = !live ? 'solo' : session?.isHost ? 'host' : 'guest';
    const client = new Client(game, live ? meRef.current : 0, role, { sens: Number(sens), autoSprint: sprint === 'auto', touch, killFx: looksRef.current.kill, bedFx: looksRef.current.bed }, {
      ping: () => {
        pinged.current = true;
      },
      moment: (e: Ev) => {
        // report the winner the moment it is known (this also runs with the tab hidden)
        if (e.t === 'win') reportRef.current();
      },
      onUi: (ui) => {
        if (ui !== 'none') unlockRef.current();
        else {
          // a panel that closed on its own (a death, walking away) took the focused button with it: keys come home
          const root = shellRef.current.root.current;
          const at = document.activeElement;
          if (root && (!at || at === document.body)) root.focus({ preventScroll: true });
        }
      },
      send: session ? (a, seq) => session.send(a, seq) : undefined,
      broadcast: session ? (evs) => session.broadcast(evs) : undefined,
      onTick: session ? () => session.tick() : undefined,
    });
    if (session) session.client = client;
    client.attach(view);
    clientRef.current = client;
    // dev only: lets the screenshot harness drive the camera (headless browsers have no pointer lock)
    if (import.meta.env.DEV) (window as unknown as { __bedwars?: Client }).__bedwars = client;
    // mesh the whole map up front (a frame or two)
    view.syncChunks(1000);
    const resize = () => {
      view.resize(host.clientWidth, host.clientHeight);
      // a resize clears the canvas: draw again even while paused or over
      shellRef.current.invalidate();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    shellRef.current.invalidate();
    force((n) => n + 1);
    return () => {
      ro.disconnect();
      if (import.meta.env.DEV) delete (window as unknown as { __bedwars?: Client }).__bedwars;
      if (sessionRef.current) sessionRef.current.client = null;
      client.dispose();
      clientRef.current = null;
      viewRef.current = null;
    };
  }, [THREE, ready]);

  // The online host's tab hidden or minimized: no frames, but the room still needs the world to go on. A worker's beat
  // (page timers slow to a crawl in hidden tabs) runs the rules, the bots and the traffic whenever frames stop.
  useEffect(() => {
    const c = clientRef.current;
    if (!live || !c || !sessionRef.current?.isHost) return;
    const beat = () => {
      const now = performance.now();
      if (now - lastFrame.current < 250 || shellRef.current.status !== 'playing') return;
      c.background(now / 1000);
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
  }, [THREE, ready, live]);

  // pointer lock: click to capture the mouse; losing it (Esc) pauses solo games
  useEffect(() => {
    const onChange = () => {
      const host = hostRef.current;
      const now = !!host && document.pointerLockElement === host;
      setLocked(now);
      const c = clientRef.current;
      if (c) c.locked = now;
      if (!now) {
        c?.releaseAll();
        if (unlockOnPurpose.current) unlockOnPurpose.current = false;
        else if (soloRef.current && shellRef.current.status === 'playing' && !c?.game.over) shellRef.current.pause();
      }
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => {
      document.removeEventListener('pointerlockchange', onChange);
      if (hostRef.current && document.pointerLockElement === hostRef.current) document.exitPointerLock();
    };
  }, [mode]);
  useEffect(() => {
    if (shell.status !== 'playing' && hostRef.current && document.pointerLockElement === hostRef.current) {
      unlockOnPurpose.current = true;
      document.exitPointerLock();
    }
  }, [shell.status]);

  const lock = useCallback(() => {
    const host = hostRef.current;
    // the mouse gets captured; fingers never need it
    if (!host || inputRef.current === 'touch' || document.pointerLockElement === host) return;
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
  const unlockRef = useRef(unlock);
  unlockRef.current = unlock;

  const openUi = useCallback(
    (ui: 'shop' | 'upgrades' | 'inv' | 'none') => {
      const c = clientRef.current;
      if (!c) return;
      c.setUi(ui);
      if (ui === 'none') {
        // the button that had focus is gone: keys go back to the game
        shellRef.current.root.current?.focus({ preventScroll: true });
        lock();
      } else unlock();
      pinged.current = true;
    },
    [lock, unlock],
  );

  // keys that act the moment they are pressed (they count as a gesture for the pointer lock)
  const keys = useKeys((code, e) => {
    const c = clientRef.current;
    if (!c || mode === 'idle') return;
    if (code === 'Tab') e?.preventDefault();
    // E: the keeper you're next to, or else your inventory. B: keepers only. I: the inventory anywhere.
    if (code === 'KeyE' || code === 'KeyB' || code === 'KeyI') {
      if (c.ui !== 'none') openUi('none');
      else if (code !== 'KeyI' && c.openNear()) unlock();
      else if (code !== 'KeyB' && c.openInventory()) unlock();
    }
  });

  // Escape closes a panel instead of pausing: caught on the way down to the shell's own key handling
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const c = clientRef.current;
      if (!c || e.code !== 'Escape' || c.ui === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      openUi('none');
    };
    root.addEventListener('keydown', onKey, true);
    return () => root.removeEventListener('keydown', onKey, true);
  }, [shell.root, openUi]);

  useGameLoop(
    (dt) => {
      const c = clientRef.current;
      const v = viewRef.current;
      if (!c || !v) return;
      if (idle) {
        // the start card: a slow orbit over the quad
        idleAngle.current += dt * 0.05;
        const a = idleAngle.current;
        const g = c.game;
        g.players[0].body.x = CENTER + Math.sin(a) * 62;
        g.players[0].body.z = CENTER + Math.cos(a) * 62;
        g.players[0].body.y = MID_TOP + 24;
        g.players[0].body.yaw = a;
        g.players[0].body.pitch = -0.36;
        v.syncChunks(6);
        c.preview(dt);
        return;
      }
      lastFrame.current = performance.now();
      c.update(dt, keys);
      setTab(keys.down('Tab'));
      v.syncChunks(4);
      // the HUD refreshes ten times a second, or right away when something happened
      hudClock.current -= dt;
      if (pinged.current || hudClock.current <= 0) {
        pinged.current = false;
        hudClock.current = 0.1;
        const h = c.hud();
        setHud(h);
        // Minecraft shows the item's name over the hotbar when you switch to it
        const s = h.slots[h.sel];
        const key = s ? `${h.sel}:${s.item}:${s.tier}` : `${h.sel}:`;
        if (key !== lastHeld.current) {
          lastHeld.current = key;
          if (s) setHeldName({ id: Date.now(), text: s.item === 'pick' ? PICK_NAMES[s.tier] : s.item === 'axe' ? AXE_NAMES[s.tier] : ITEM_DEFS[s.item].name });
        }
      }
      // the end of the game: the result goes in at once, the card after a few seconds of celebration (real time)
      const g = c.game;
      if (g.over) {
        reportRef.current();
        const now = performance.now() / 1000;
        if (overAt.current === null) overAt.current = now;
        if (now - overAt.current > 3.5) finish();
      }
    },
    () => clientRef.current?.render(),
    { always: idle },
  );

  // Online: everyone reports the seat the host named (the lowest human seat still in the room on the winning team; a
  // bot's win counts for nobody), for the round this game was started in.
  const reported = useRef(false);
  const reportRef = useRef(() => {});
  reportRef.current = () => {
    const g = gameRef.current;
    const o = onlineRef.current;
    if (reported.current || !g?.over || mode !== 'online' || detached || !o) return;
    reported.current = true;
    o.reportResult(roundRef.current, g.winSeat >= 0 ? g.winSeat : null);
  };
  // your record on this device, and anything it unlocked (once, even if the round is left before the card shows)
  const settled = useRef<{ title: string; detail: string } | null>(null);
  const settleRef = useRef(() => settled.current);
  settleRef.current = () => {
    const g = gameRef.current;
    if (settled.current || !g?.over) return settled.current;
    const me = g.players[mode === 'online' ? meRef.current : 0];
    if (!me) return null;
    const won = g.winner === me.team;
    const team = TEAMS[me.team];
    const detail = `${me.stats.kills} kills, ${me.stats.finals} final kills, ${me.stats.beds} beds broken.${g.winner >= 0 && !won ? ` ${TEAMS[g.winner].name} won it.` : ''}`;
    const before = loadRecord();
    const after = addGame(before, { won, kills: me.stats.kills, finals: me.stats.finals, beds: me.stats.beds, deaths: me.stats.deaths });
    saveRecord(after);
    const unlocked = newUnlocks(before, after);
    const unlockLine = unlocked.length ? ` unlocked: ${unlocked.map((u) => u.name).join(', ')}! equip ${unlocked.length > 1 ? 'them' : 'it'} in the locker.` : '';
    const streak = won && after.streak > 1 ? ` ${after.streak} wins in a row!` : '';
    settled.current = { title: won ? 'Victory!' : g.winner < 0 ? 'Draw' : 'Game Over', detail: (won ? `${team.name} team wins! ${detail}` : detail) + streak + unlockLine };
    return settled.current;
  };
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    reportRef.current();
    const r = settleRef.current();
    if (r) shellRef.current.gameOver(undefined, r);
  };
  // the next round started (or the game closed) before the card: the result and the record still count
  useEffect(
    () => () => {
      if (!gameRef.current?.over || finished.current) return;
      reportRef.current();
      settleRef.current();
    },
    [],
  );

  // ---------------------------------------------------------------------------------------------------------------
  // mouse and touch on the game view

  const buttons = useRef(0);
  const applyButtons = (b: number) => {
    const c = clientRef.current;
    if (!c) return;
    const was = buttons.current;
    if ((b & 1) !== (was & 1)) c.button('left', !!(b & 1));
    if ((b & 2) !== (was & 2)) c.button('right', !!(b & 2));
    buttons.current = b;
  };
  const touchState = useRef<{ stick: number | null; look: number | null; sx: number; sy: number; lx: number; ly: number }>({ stick: null, look: null, sx: 0, sy: 0, lx: 0, ly: 0 });

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (idle || shell.status !== 'playing') return;
    const c = clientRef.current;
    if (!c) return;
    if (e.pointerType === 'touch') {
      const r = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - r.left;
      const t = touchState.current;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (x < r.width * 0.42 && t.stick === null) {
        t.stick = e.pointerId;
        t.sx = e.clientX;
        t.sy = e.clientY;
      } else if (t.look === null) {
        t.look = e.pointerId;
        t.lx = e.clientX;
        t.ly = e.clientY;
      }
      return;
    }
    if (c.ui !== 'none') return;
    if (document.pointerLockElement !== hostRef.current) {
      lock();
      return;
    }
    applyButtons(e.buttons);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const c = clientRef.current;
    if (!c) return;
    if (e.pointerType === 'touch') {
      const t = touchState.current;
      if (e.pointerId === t.stick) {
        const dx = (e.clientX - t.sx) / 46;
        const dy = (e.clientY - t.sy) / 46;
        const m = Math.hypot(dx, dy);
        c.stick.x = m > 1 ? dx / m : dx;
        c.stick.y = m > 1 ? dy / m : dy;
        // the knob moves on its own: no need to redraw the whole HUD for it
        if (knobRef.current) knobRef.current.style.transform = `translate(${c.stick.x * 34}px, ${c.stick.y * 34}px)`;
      } else if (e.pointerId === t.look) {
        c.look((e.clientX - t.lx) * 2.2, (e.clientY - t.ly) * 2.2);
        t.lx = e.clientX;
        t.ly = e.clientY;
      }
      return;
    }
    if (document.pointerLockElement === hostRef.current) {
      c.look(e.movementX, e.movementY);
      applyButtons(e.buttons);
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const c = clientRef.current;
    if (!c) return;
    if (e.pointerType === 'touch') {
      const t = touchState.current;
      if (e.pointerId === t.stick) {
        t.stick = null;
        c.stick.x = c.stick.y = 0;
        if (knobRef.current) knobRef.current.style.transform = '';
      }
      if (e.pointerId === t.look) t.look = null;
      return;
    }
    applyButtons(e.buttons);
  };
  const onWheel = (e: React.WheelEvent) => {
    const c = clientRef.current;
    if (!c || idle || c.ui !== 'none') return;
    c.wheel(e.deltaY);
  };

  // out for good in solo: the mouse comes back so the card's Play Again can be clicked
  const isOut = !!clientRef.current?.player.out;
  useEffect(() => {
    if (isOut && soloLike && !gameRef.current?.over) unlock();
  }, [isOut, soloLike, unlock]);

  const c = clientRef.current;
  const g = gameRef.current;
  const now = c?.time ?? 0;
  const nameColors = g ? g.players.map((p) => [p.name, TEAMS[p.team].color] as [string, string]) : [];
  const playing = shell.status === 'playing' && !idle;
  const me = c?.player;

  // touch buttons
  const hold = (on: () => void, off: () => void) => ({
    onPointerDown: (e: RPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      on();
    },
    onPointerUp: off,
    onPointerCancel: off,
    onLostPointerCapture: off,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });

  return (
    <div
      className={`g-bedwars-stage${touch ? ' is-touch' : ''}`}
      onPointerDownCapture={(e) => {
        const m = e.pointerType === 'touch' ? 'touch' : e.pointerType === 'mouse' ? 'mouse' : null;
        if (!m || m === inputRef.current) return;
        inputRef.current = m;
        setInput(m);
      }}
    >
      <div
        ref={hostRef}
        className="g-bedwars-host"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {playing && !g && <div className="g-bedwars-joining">joining the host's game</div>}
      {playing && hud && c && me && g && (
        <div className="g-bedwars-hud">
          {me.alive && hud.ui === 'none' && <Crosshair />}
          <Scoreboard hud={hud} mode={g.mode} />
          <Feed lines={c.feed} now={now} open={tab} names={nameColors} />
          <TitleView title={c.title} now={now} />
          {me.alive && <Hotbar hud={hud} hurt={c.hurtFlash > 0} onSelect={(i) => c.select(i)} />}
          {hud.near && hud.ui === 'none' && me.alive && !touch && <div className="g-bedwars-prompt">{`press E for the ${hud.near === 'shop' ? 'item shop' : 'team upgrades'}`}</div>}
          {heldName && me.alive && hud.ui === 'none' && (
            <div key={heldName.id} className="g-bedwars-itemName">
              {heldName.text}
            </div>
          )}
          {me.out && !g.over && soloLike && (
            <div className="g-bedwars-outCard">
              <p>you're out. watch the rest from the sky, or start over.</p>
              <button type="button" className="arcade-btn arcade-btn-primary" onClick={() => shell.restart()}>
                Play Again
              </button>
            </div>
          )}
          {c.hurtFlash > 0 && <div className="g-bedwars-hurt" style={{ opacity: c.hurtFlash * 0.5 }} />}
          {hud.fx.blind > 0 && <div className="g-bedwars-blind" />}
          {tab && (
            <PlayerList
              rows={g.players.map((p) => ({ name: p.name, team: p.team, alive: p.alive, out: p.out, kills: p.stats.kills, finals: p.stats.finals, beds: p.stats.beds, bot: p.ctrl === 'bot' }))}
            />
          )}
          {hud.ui === 'shop' && <ShopPanel inv={me.inv} team={me.team} touch={touch} onBuy={(id) => c.act({ a: 'buy', id })} onClose={() => openUi('none')} />}
          {hud.ui === 'inv' && (
            <InventoryPanel
              inv={me.inv}
              team={me.team}
              sel={me.sel}
              picked={c.invPicked}
              touch={touch}
              onSlot={(i, quick) => c.invClick(i, quick)}
              onHover={(i) => (c.invHover = i)}
              onClose={() => openUi('none')}
            />
          )}
          {hud.ui === 'upgrades' && (
            <UpgradesPanel
              inv={me.inv}
              ups={g.teams[me.team].ups}
              traps={g.teams[me.team].traps}
              touch={touch}
              onBuy={(key) => c.act({ a: 'upg', key })}
              onTrap={(kind) => c.act({ a: 'trap', kind })}
              onClose={() => openUi('none')}
            />
          )}
          {!touch && !locked && hud.ui === 'none' && !g.over && !(me.out && soloLike) && (
            <button
              type="button"
              className="g-bedwars-clickToPlay"
              // never takes focus: keys stay with the game once the mouse is captured
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                shellRef.current.root.current?.focus({ preventScroll: true });
                lock();
              }}
            >
              click to play
            </button>
          )}
        </div>
      )}
      {playing && touch && c && me && g && hud && hud.ui === 'none' && (
        <div className="g-bedwars-touch">
          <div className="g-bedwars-stickZone" aria-hidden="true">
            <i ref={knobRef} />
          </div>
          {/* the menus sit apart from the action buttons, so those never move under your thumb */}
          <div className="g-bedwars-tmenu">
            {me.alive && (
              <button
                type="button"
                tabIndex={-1}
                className="g-bedwars-tm is-bag"
                aria-label="Inventory"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (c.openInventory()) pinged.current = true;
                }}
              >
                bag
              </button>
            )}
            {hud.near && (
              <button
                type="button"
                tabIndex={-1}
                className="g-bedwars-tm is-shop"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (c.openNear()) pinged.current = true;
                }}
              >
                {hud.near === 'shop' ? 'shop' : 'team'}
              </button>
            )}
          </div>
          <div className="g-bedwars-tbtns">
            <button type="button" tabIndex={-1} className="g-bedwars-tb is-attack" {...hold(() => { c.button('left', true); c.tapAttack(); }, () => c.button('left', false))}>
              hit
            </button>
            <button type="button" tabIndex={-1} className="g-bedwars-tb is-use" {...hold(() => c.button('right', true), () => c.button('right', false))}>
              use
            </button>
            <button type="button" tabIndex={-1} className="g-bedwars-tb is-jump" {...hold(() => (c.touchJump = true), () => (c.touchJump = false))}>
              jump
            </button>
            <button
              type="button"
              tabIndex={-1}
              className={`g-bedwars-tb is-sneak${c.touchSneak ? ' is-on' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                c.touchSneak = !c.touchSneak;
                force((n) => n + 1);
              }}
            >
              crouch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
