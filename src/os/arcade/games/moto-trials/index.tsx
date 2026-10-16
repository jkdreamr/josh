import { useEffect, useRef, useState } from 'react';
import { GameShell, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { LEVELS, LEVEL_IDS, getLevel } from './levels.ts';
import { currentMs, newRun, starsFor, startRun, stepRun, type Run } from './logic.ts';
import { newCam, render, type Cam, type Ghost } from './draw.ts';
import './moto-trials.css';

const LEVEL = defineSetting('moto-trials:level', LEVEL_IDS, 'level-1');
const SEAT_COLORS = ['#e53935', '#1e88e5', '#3fae4a', '#fdd835'];

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return m ? `${m}:${ss}` : `0:${ss}`;
};

// Progress: best times and stars per level, unlocked sequentially in solo play.
type Progress = { best: Record<string, number>; stars: Record<string, number> };
const PROG_KEY = 'arcade:moto-trials:progress';
function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(PROG_KEY);
    if (!raw) return { best: {}, stars: {} };
    const p = JSON.parse(raw) as Progress;
    const clean = (m: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => LEVEL_IDS.includes(k) && typeof v === 'number' && Number.isFinite(v)));
    return { best: clean(p.best) as Record<string, number>, stars: clean(p.stars) as Record<string, number> };
  } catch {
    return { best: {}, stars: {} };
  }
}
function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
/** Level i+1 unlocks once level i is cleared. Online rooms open everything. */
const unlocked = (prog: Progress, id: string) => {
  const i = LEVEL_IDS.indexOf(id);
  return i === 0 || (prog.best[LEVEL_IDS[i - 1]] ?? null) !== undefined;
};

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={fmtMs} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Stage />
      <TouchControls dpad="x" buttons={[{ key: 'ArrowDown', label: 'Brake' }, { key: 'ArrowUp', label: 'Gas' }]} />
    </GameShell>
  );
}

/** Small inline star, filled when earned. */
function Star({ on }: { on: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className={`g-moto-trials-star${on ? ' is-on' : ''}`}>
      <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z" />
    </svg>
  );
}
function Lock() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className="g-moto-trials-lock">
      <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v10H6z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The level grid: number, name and earned stars; locked levels show a lock. */
function LevelPicker({ value, onChange, all }: { value: string; onChange?: (id: string) => void; all?: boolean }) {
  const prog = loadProgress();
  return (
    <div className="arcade-field">
      <span>Level{onChange ? '' : ' · picked by the host'}</span>
      <div className="g-moto-trials-levels" role="group" aria-label="Level">
        {LEVELS.map((l, i) => {
          const locked = !all && !unlocked(prog, l.id);
          const stars = prog.stars[l.id] ?? 0;
          return (
            <button
              key={l.id}
              type="button"
              className={`g-moto-trials-level${l.id === value ? ' is-on' : ''}`}
              aria-pressed={l.id === value}
              disabled={!onChange || locked}
              title={`Level ${i + 1} ${l.name}`}
              onClick={() => {
                if (!onChange || l.id === value) return;
                sfx.play('select');
                onChange(l.id);
              }}
            >
              <b>{i + 1}</b>
              <span>{l.name}</span>
              <em>{locked ? <Lock /> : [0, 1, 2].map((s) => <Star key={s} on={s < stars} />)}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  const best = loadProgress().best[level];
  return (
    <>
      <LevelPicker value={level} onChange={setLevel} />
      {best !== undefined && (
        <small className="g-moto-trials-best">
          best on {getLevel(level).name}: {fmtMs(best)}
        </small>
      )}
    </>
  );
}

/** Online: the host picks the level for everyone and announces it; guests just see it. */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [hostLevel, setHostLevel] = useState<string | null>(null);
  const host = online?.isHost ?? true;
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send({ game: 'moto-trials', k: 'cfg', level });
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, level]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      if (from !== 0 || !d || typeof d !== 'object') return;
      const p = d as { game?: string; k?: string; level?: string };
      if (p.game === 'moto-trials' && p.k === 'cfg' && LEVEL_IDS.includes(p.level ?? '')) setHostLevel(p.level!);
    });
  }, [online]);
  return (
    <>
      <LevelPicker value={host ? level : (hostLevel ?? level)} onChange={host ? setLevel : undefined} all />
      {host && <small className="g-moto-trials-best">you pick the level for everyone</small>}
    </>
  );
}

type OnlineApi = NonNullable<ReturnType<typeof useOnline>>;
type NetPos = { x: number; y: number; a: number; fwr: number; rwr: number; crashed: boolean; done: boolean };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const shortestAngle = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const [levelId] = useSetting(LEVEL);
  const current = useRef({ key: 'idle', level: levelId });
  // behind the start card, show the picked level; each round remounts fresh
  if (shell.status === 'ready') current.current = { key: 'idle', level: levelId };
  else if (shell.status === 'playing') {
    const key = online ? `on:${online.round}` : `solo:${levelId}`;
    if (key !== current.current.key) current.current = { key, level: levelId };
  }
  return <Play key={`${current.current.key}:${current.current.level}`} online={online} />;
}

function Play({ online }: { online: OnlineApi | null }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [levelSetting, setLevelSetting] = useSetting(LEVEL);
  const live = !!online;
  const isHost = !live || online!.isHost;
  const { ref, size, ctx } = useCanvas();
  const cam = useRef<Cam>(newCam());
  const ghosts = useRef(new Map<number, { cur: Ghost; prev: Ghost; next: NetPos; got: number }>());
  const run = useRef<Run | null>(null);
  if (!run.current) run.current = newRun(getLevel(levelSetting), live && !isHost);
  const net = useRef({ posT: 0, startT: 0, ended: false, toastSeen: 0 });
  const dtRef = useRef(1 / 60);

  // guests adopt the host's level and start signal
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      if (from !== 0 || !d || typeof d !== 'object') return;
      const p = d as { game?: string; k?: string; level?: string };
      if (p.game !== 'moto-trials' || p.k !== 'start' || !LEVEL_IDS.includes(p.level ?? '')) return;
      const r = run.current!;
      if (p.level !== r.level.id) {
        run.current = newRun(getLevel(p.level!), false);
        cam.current = newCam();
      }
      startRun(r);
    });
  }, [online]);

  // ghost position packets
  useEffect(() => {
    if (!online) return;
    return online.onMessage((from, d) => {
      if (!d || typeof d !== 'object' || from === online.seat) return;
      const p = d as Record<string, unknown>;
      if (p.game !== 'moto-trials' || p.k !== 'pos') return;
      if (!['x', 'y', 'a', 'fwr', 'rwr'].every((k) => num(p[k]))) return;
      const np: NetPos = { x: p.x as number, y: p.y as number, a: p.a as number, fwr: p.fwr as number, rwr: p.rwr as number, crashed: !!p.crashed, done: !!p.done };
      const name = online.players.find((pl) => pl.seat === from)?.name ?? `Player ${from + 1}`;
      const color = SEAT_COLORS[from % SEAT_COLORS.length];
      const at = performance.now();
      const g = ghosts.current.get(from);
      if (g) {
        g.prev = { x: g.cur.x, y: g.cur.y, a: g.cur.a, fwr: g.cur.fwr, rwr: g.cur.rwr, crashed: g.cur.crashed, done: g.cur.done, name, color };
        g.next = np;
        g.got = at;
      } else {
        const cur: Ghost = { ...np, name, color };
        ghosts.current.set(from, { cur, prev: { ...cur }, next: np, got: at });
      }
    });
  }, [online]);

  const finish = (r: Run) => {
    const ms = r.finalMs;
    const stars = starsFor(r.level, ms);
    const p = loadProgress();
    const hadBest = p.best[r.level.id] !== undefined;
    const isBest = !hadBest || ms < p.best[r.level.id];
    p.best[r.level.id] = Math.min(ms, p.best[r.level.id] ?? ms);
    p.stars[r.level.id] = Math.max(stars, p.stars[r.level.id] ?? 0);
    saveProgress(p);
    // a first clear of this level selects the next one, so Play Again moves on
    const idx = LEVEL_IDS.indexOf(r.level.id);
    if (!live && !hadBest && idx + 1 < LEVEL_IDS.length && levelSetting === r.level.id) setLevelSetting(LEVEL_IDS[idx + 1]);
    const flipText = r.flips ? `, ${r.flips} flip${r.flips === 1 ? '' : 's'}` : '';
    const starText = stars === 3 ? '3 stars' : stars === 2 ? '2 stars' : stars === 1 ? '1 star' : 'no stars';
    const next = stars < 3 ? ` next star at ${fmtMs(r.level.stars[stars])}.` : '';
    shellRef.current.gameOver(undefined, {
      title: isBest ? 'New Best' : `${r.level.name} Cleared`,
      detail: `${fmtMs(ms)}${flipText}. ${starText}.${next}`,
      rank: ms,
    });
  };

  useGameLoop(
    (dt) => {
      dtRef.current = dt;
      const r = run.current!;
      // the host keeps naming the level until everyone is counting down
      if (live && isHost && (r.phase === 'count' || r.phase === 'wait')) {
        net.current.startT += dt;
        if (net.current.startT > 0.5) {
          net.current.startT = 0;
          online!.send({ game: 'moto-trials', k: 'start', level: r.level.id });
        }
      }
      const input = {
        gas: keys.down('up') ? 1 : 0,
        brake: keys.down('down') ? 1 : 0,
        lean: keys.axis('left', 'right'),
      };
      const phase0 = r.phase;
      stepRun(r, input, dt);
      if (r.phase !== phase0) {
        if (r.phase === 'run' && phase0 === 'count') sfx.play('select', 1.6);
        else if (r.phase === 'crash') sfx.play('boom');
        else if (r.phase === 'done') sfx.play('win');
      }
      const lastToast = r.toasts[r.toasts.length - 1];
      if (lastToast && lastToast.id !== net.current.toastSeen) {
        net.current.toastSeen = lastToast.id;
        if (lastToast.text === 'Checkpoint') sfx.play('coin');
        else if (lastToast.text.endsWith('s')) sfx.play('jump');
      }
      if (r.overPending && !net.current.ended) {
        net.current.ended = true;
        finish(r);
      }
      shell.setScore(r.phase === 'run' || r.phase === 'crash' ? currentMs(r) : r.phase === 'done' ? r.finalMs : null);

      // broadcast our bike at ~12 Hz
      if (live) {
        net.current.posT += dt;
        if (net.current.posT > 0.08) {
          net.current.posT = 0;
          const b = r.bike;
          online!.send(
            { game: 'moto-trials', k: 'pos', x: b.p.x, y: b.p.y, a: b.a, fwr: b.fw.rot, rwr: b.rw.rot, crashed: r.phase === 'crash', done: r.phase === 'done' },
            { fast: true },
          );
        }
        // ghosts that stop reporting fade out
        const now = performance.now();
        for (const g of ghosts.current.values()) if (now - g.got > 900) g.next.crashed = true;
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const r = run.current!;
      const list: Ghost[] = [];
      for (const g of ghosts.current.values()) {
        const t = Math.min(1.3, (performance.now() - g.got) / 80);
        list.push({
          x: g.prev.x + (g.next.x - g.prev.x) * Math.min(1, t),
          y: g.prev.y + (g.next.y - g.prev.y) * Math.min(1, t),
          a: g.prev.a + shortestAngle(g.next.a - g.prev.a) * Math.min(1, t),
          fwr: g.next.fwr,
          rwr: g.next.rwr,
          crashed: g.next.crashed,
          done: g.next.done,
          name: g.cur.name,
          color: g.cur.color,
        });
      }
      render(c, size.w, size.h, r, cam.current, list, dtRef.current, keys.axis('left', 'right'), shellRef.current.touch);
    },
  );

  return <canvas ref={ref} className="g-moto-trials-canvas" />;
}
