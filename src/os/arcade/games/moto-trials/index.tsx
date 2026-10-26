import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { LEVEL_IDS, WORLDS, getLevel, worldIndexOf } from './levels.ts';
import { currentMs, newRun, nextStarMs, starsFor, startRun, stepRun, type Run } from './logic.ts';
import { newCam, render, type Cam, type Ghost } from './draw.ts';
import { loadProgress, saveProgress, tourLeft, tourTotal, unlocked } from './progress.ts';
import './moto-trials.css';

const LEVEL = defineSetting('moto-trials:level', LEVEL_IDS, 'level-1');
const SEAT_COLORS = ['#e53935', '#1e88e5', '#3fae4a', '#fdd835'];

const fmtMs = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return m ? `${m}:${ss}` : `0:${ss}`;
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

/**
 * A phone or iPad frame is scaled down to fit the screen. Publish 1 / that scale as --g-moto-trials-u on the shell
 * root so touch styles can keep the buttons (the shell's too) finger sized and the text readable on screen.
 */
function useFrameScale() {
  const shell = useShell();
  const { root, touch } = shell;
  useEffect(() => {
    const el = root.current;
    if (!el || !touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-moto-trials-u', u.toFixed(3));
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
    };
  }, [root, touch]);
}

/** The level strip: one row of square number buttons, then a line about the pick. */
function LevelPicker({ value, onChange, all }: { value: string; onChange?: (id: string) => void; all?: boolean }) {
  const prog = loadProgress();
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rowRef.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);
  const [world, setWorld] = useState(() => worldIndexOf(value));
  useEffect(() => setWorld(worldIndexOf(value)), [value]);
  const picked = getLevel(value);
  const stars = prog.stars[value] ?? 0;
  const best = prog.best[value];
  return (
    <div className="arcade-field">
      <Segmented
        label={WORLDS[world].name}
        className="g-moto-trials-worlds"
        value={String(world)}
        options={WORLDS.map((w, i) => [String(i), String(i + 1)] as [string, string])}
        onChange={(v) => setWorld(Number(v))}
      />
      <span>{onChange ? 'Level' : 'Level, picked by the host'}</span>
      <div className="g-moto-trials-strip" role="group" aria-label="Level" ref={rowRef}>
        {WORLDS[world].levels.map((id) => {
          const l = getLevel(id);
          const i = LEVEL_IDS.indexOf(id);
          const locked = !all && !unlocked(prog, l.id);
          const n = prog.stars[l.id] ?? 0;
          return (
            <button
              key={l.id}
              type="button"
              className={`g-moto-trials-pick${l.id === value ? ' is-on' : ''}`}
              aria-pressed={l.id === value}
              disabled={!onChange || locked}
              title={`Level ${i + 1}, ${l.name}`}
              onClick={() => {
                if (!onChange || l.id === value) return;
                sfx.play('select');
                onChange(l.id);
              }}
            >
              <b>{i + 1}</b>
              {locked ? <Lock /> : n > 0 && <em>{'\u2022'.repeat(n)}</em>}
            </button>
          );
        })}
      </div>
      <small className="g-moto-trials-info">
        {picked.name}
        <em className="g-moto-trials-dots">{[0, 1, 2].map((i) => <Star key={i} on={i < stars} />)}</em>
        {best !== undefined && <span>best {fmtMs(best)}</span>}
      </small>
    </div>
  );
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  return <LevelPicker value={level} onChange={setLevel} />;
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
  useFrameScale();
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
  // the idle preview behind the Start card only redraws on request: ask again once a new size has rendered
  const { invalidate } = shell;
  useEffect(() => invalidate(), [size.w, size.h, size.dpr, invalidate]);
  const dtRef = useRef(1 / 60);

  // guests adopt the host's level and start signal
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      if (from !== 0 || !d || typeof d !== 'object') return;
      const p = d as { game?: string; k?: string; level?: string };
      if (p.game !== 'moto-trials' || p.k !== 'start' || !LEVEL_IDS.includes(p.level ?? '')) return;
      const r = run.current!;
      // only guests still holding for the host adopt a start packet
      if (r.phase !== 'wait') return;
      if (p.level !== r.level.id) {
        run.current = newRun(getLevel(p.level!), true);
        cam.current = newCam();
      }
      startRun(run.current!);
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
    const nsm = nextStarMs(r.level, stars);
    const next = nsm !== null ? ` next star at ${fmtMs(nsm)}.` : '';
    let detail = `${fmtMs(ms)}${flipText}. ${starText}.${next}`;
    let rank: number | undefined;
    // An online race ranks this one run, so it names a board the game does not have: the shell then
    // keeps it off the Full Tour board while the race standings still compare the times.
    let board: string | undefined;
    if (live) {
      rank = ms;
      board = 'race';
    } else {
      const total = tourTotal(p);
      if (total !== null) {
        rank = total;
        detail += ` full tour: ${fmtMs(total)}.`;
      } else {
        const left = tourLeft(p);
        detail += ` clear ${left} more level${left === 1 ? '' : 's'} to post a tour time.`;
      }
    }
    shellRef.current.gameOver(undefined, {
      title: isBest ? 'New Best' : `${r.level.name} Cleared`,
      detail,
      rank,
      board,
    });
  };

  useGameLoop(
    (dt) => {
      dtRef.current = dt;
      const r = run.current!;
      // the host keeps naming the level: fast during the countdown, slower mid-run,
      // so guests that mount late still get adopted while they wait
      if (live && isHost && r.phase !== 'done') {
        net.current.startT += dt;
        const every = r.phase === 'run' || r.phase === 'crash' ? 1 : 0.5;
        if (net.current.startT > every) {
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
