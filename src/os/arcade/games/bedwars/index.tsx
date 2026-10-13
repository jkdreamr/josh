import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { createGame, type Ev, type Game, type Level, type Pace } from './game.ts';
import { Client, type Hud } from './client.ts';
import { createView, type View } from './scene.ts';
import { CENTER, MID_TOP, type Mode } from './map.ts';
import { TEAMS } from './blocks.ts';
import { Crosshair, Feed, Hotbar, PlayerList, Scoreboard, ShopPanel, TitleView, UpgradesPanel } from './hud.tsx';
import './bedwars.css';

const MODE = defineSetting('bedwars:mode', ['solo', 'doubles'] as const, 'solo');
const LEVEL = defineSetting('bedwars:bots', ['easy', 'normal', 'hard'] as const, 'normal');
const PACE = defineSetting('bedwars:pace', ['quick', 'classic'] as const, 'quick');
const SENS = defineSetting('bedwars:sens', ['0.5', '1', '1.5', '2'] as const, '1', { live: true });
const SPRINT = defineSetting('bedwars:sprint', ['auto', 'manual'] as const, 'auto', { live: true });

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
const sprintOptions = [
  ['auto', 'Auto'],
  ['manual', 'Ctrl or WW'],
] as const;

const BOT_NAMES = ['Tree', 'Hoover', 'Lagunita', 'Branner', 'Wilbur', 'Gates', 'Meyer', 'Coho', 'Treehouse', 'Roble', 'Toyon', 'Arrillaga', 'Florence', 'Stern', 'Mirrielees'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />}>
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [pace, setPace] = useSetting(PACE);
  const [sens, setSens] = useSetting(SENS);
  const [sprint, setSprint] = useSetting(SPRINT);
  const shell = useShell();
  return (
    <div className="g-bedwars-setup">
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Bots" value={level} options={levelOptions} onChange={setLevel} />
      <Segmented label="Pace" value={pace} options={paceOptions} onChange={setPace} />
      {!shell.touch && <Segmented label="Mouse" value={sens} options={sensOptions} onChange={setSens} />}
      {!shell.touch && <Segmented label="Sprint" value={sprint} options={sprintOptions} onChange={setSprint} />}
    </div>
  );
}

type StageMode = 'idle' | 'solo' | 'online';

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={current.current.key} mode={current.current.mode} />;
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

function soloGame(mode: Mode, level: Level, pace: Pace): Game {
  const n = 8;
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const entrants = Array.from({ length: n }, (_, i) =>
    i === 0 ? { name: myName(), seat: 0, ctrl: 'local' as const, skin: 0, team: 0 } : { name: names[i % names.length], seat: -1, ctrl: 'bot' as const, skin: (i * 3) % 6 },
  );
  return createGame({ mode, pace, level, entrants, seed: (Math.random() * 2 ** 31) >>> 0 });
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const THREE = useThree();
  const [modeSetting] = useSetting(MODE);
  const [level] = useSetting(LEVEL);
  const [pace] = useSetting(PACE);
  const [sens] = useSetting(SENS);
  const [sprint] = useSetting(SPRINT);
  const hostRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Client | null>(null);
  const gameRef = useRef<Game | null>(null);
  const viewRef = useRef<View | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [tab, setTab] = useState(false);
  const [locked, setLocked] = useState(false);
  const [, force] = useState(0);
  const pinged = useRef(true);
  const hudClock = useRef(0);
  const unlockOnPurpose = useRef(false);
  const overAt = useRef<number | null>(null);
  const idle = mode === 'idle';
  const idleAngle = useRef(0);

  if (!gameRef.current) {
    gameRef.current = soloGame(modeSetting, level as Level, pace as Pace);
  }

  // settings that apply live
  useEffect(() => {
    const c = clientRef.current;
    if (!c) return;
    c.settings.sens = Number(sens);
    c.settings.autoSprint = sprint === 'auto';
    c.settings.touch = shell.touch;
  }, [sens, sprint, shell.touch]);

  // the view and the client
  useEffect(() => {
    const host = hostRef.current;
    const game = gameRef.current;
    if (!THREE || !host || !game) return;
    const view = createView(THREE, host, game);
    if (!view) return;
    viewRef.current = view;
    const client = new Client(game, 0, 'solo', { sens: Number(sens), autoSprint: sprint === 'auto', touch: shell.touch }, {
      ping: () => {
        pinged.current = true;
      },
      moment: (e: Ev) => {
        void e;
      },
    });
    client.attach(view);
    clientRef.current = client;
    // dev only: lets the screenshot harness drive the camera (headless browsers have no pointer lock)
    if (import.meta.env.DEV) (window as unknown as { __bedwars?: Client }).__bedwars = client;
    // mesh the whole map up front (a frame or two)
    view.syncChunks(1000);
    const resize = () => view.resize(host.clientWidth, host.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    shellRef.current.invalidate();
    force((n) => n + 1);
    return () => {
      ro.disconnect();
      if (import.meta.env.DEV) delete (window as unknown as { __bedwars?: Client }).__bedwars;
      client.dispose();
      clientRef.current = null;
      viewRef.current = null;
    };
  }, [THREE]);

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
        else if (mode === 'solo' && shellRef.current.status === 'playing' && !c?.game.over) shellRef.current.pause();
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
    if (!host || shellRef.current.touch || document.pointerLockElement === host) return;
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

  const openUi = useCallback(
    (ui: 'shop' | 'upgrades' | 'none') => {
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
    if (code === 'KeyE' || code === 'KeyB') {
      if (c.ui !== 'none') openUi('none');
      else if (c.openNear()) unlock();
    }
  });

  // Escape closes the shop instead of pausing; Ctrl is sprint (the shell lets Ctrl combos through)
  useEffect(() => {
    const root = shell.root.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (!root.contains(e.target as Node)) return;
      const c = clientRef.current;
      if (!c) return;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') c.ctrl = e.type === 'keydown';
      if (e.type === 'keydown' && e.code === 'Escape' && c.ui !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        openUi('none');
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
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
      c.update(dt, keys);
      setTab(keys.down('Tab'));
      v.syncChunks(4);
      // the HUD refreshes ten times a second, or right away when something happened
      hudClock.current -= dt;
      if (pinged.current || hudClock.current <= 0) {
        pinged.current = false;
        hudClock.current = 0.1;
        setHud(c.hud());
      }
      // the end of a solo game
      const g = c.game;
      if (g.over && mode === 'solo') {
        if (overAt.current === null) overAt.current = c.time;
        if (c.time - overAt.current > 3.5) finish(c);
      }
    },
    () => clientRef.current?.render(),
    { always: idle },
  );

  const finished = useRef(false);
  const finish = (c: Client) => {
    if (finished.current) return;
    finished.current = true;
    const g = c.game;
    const me = c.player;
    const won = g.winner === me.team;
    const team = TEAMS[me.team];
    const detail = `${me.stats.kills} kills, ${me.stats.finals} final kills, ${me.stats.beds} beds broken.${g.winner >= 0 && !won ? ` ${TEAMS[g.winner].name} won it.` : ''}`;
    shellRef.current.gameOver(undefined, { title: won ? 'Victory!' : g.winner < 0 ? 'Draw' : 'Game Over', detail: won ? `${team.name} team wins! ${detail}` : detail });
  };

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
        pinged.current = true;
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

  const c = clientRef.current;
  const g = gameRef.current!;
  const now = c?.time ?? 0;
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
    <div className={`g-bedwars-stage${shell.touch ? ' is-touch' : ''}`}>
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
      {playing && hud && c && me && (
        <div className="g-bedwars-hud">
          {me.alive && hud.ui === 'none' && <Crosshair />}
          <Scoreboard hud={hud} mode={g.mode} />
          <Feed lines={c.feed} now={now} open={tab} />
          <TitleView title={c.title} now={now} />
          {me.alive && <Hotbar hud={hud} hurt={c.hurtFlash > 0} onSelect={(i) => c.select(i)} />}
          {hud.near && hud.ui === 'none' && me.alive && <div className="g-bedwars-prompt">{shell.touch ? 'tap shop' : `press E for the ${hud.near === 'shop' ? 'item shop' : 'team upgrades'}`}</div>}
          {c.hurtFlash > 0 && <div className="g-bedwars-hurt" style={{ opacity: c.hurtFlash * 0.5 }} />}
          {hud.fx.blind > 0 && <div className="g-bedwars-blind" />}
          {tab && (
            <PlayerList
              rows={g.players.map((p) => ({ name: p.name, team: p.team, alive: p.alive, out: p.out, kills: p.stats.kills, finals: p.stats.finals, beds: p.stats.beds, bot: p.ctrl === 'bot' }))}
            />
          )}
          {hud.ui === 'shop' && <ShopPanel inv={me.inv} team={me.team} touch={shell.touch} onBuy={(id) => c.act({ a: 'buy', id })} onClose={() => openUi('none')} />}
          {hud.ui === 'upgrades' && (
            <UpgradesPanel
              inv={me.inv}
              ups={g.teams[me.team].ups}
              traps={g.teams[me.team].traps}
              touch={shell.touch}
              onBuy={(key) => c.act({ a: 'upg', key })}
              onTrap={(kind) => c.act({ a: 'trap', kind })}
              onClose={() => openUi('none')}
            />
          )}
          {!shell.touch && !locked && hud.ui === 'none' && !g.over && (
            <button type="button" className="g-bedwars-clickToPlay" onClick={lock}>
              click to play
            </button>
          )}
        </div>
      )}
      {playing && shell.touch && c && me && hud && hud.ui === 'none' && (
        <div className="g-bedwars-touch">
          <div className="g-bedwars-stickZone" aria-hidden="true">
            <i style={{ transform: `translate(${c.stick.x * 34}px, ${c.stick.y * 34}px)` }} />
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
            {hud.near && (
              <button
                type="button"
                tabIndex={-1}
                className="g-bedwars-tb is-shop"
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
        </div>
      )}
    </div>
  );
}
