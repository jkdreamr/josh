import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { chooseShot, type Level } from './ai.ts';
import { guestSync, shootPressed } from './sync.ts';
import { HEAD_X, L, R, W, POCKETS, canPlace, clampPlace, groupOf, legalTargets, newGame, pocketFor, remaining, resolve, startShot, stepSim, traceAim, validGame, type Game, type Group, type Seat, type Shot, type Sim } from './logic.ts';
import { meta } from './meta';
import { ballColor, drawBalls, drawCue, drawGuide, drawHandRing, drawPower, drawTable, freshSpins, layout, roll, tableBox, tableTransform, toTable, type Sink, type Spin3 } from './render.ts';
import type { AiReply, AiRequest } from './worker.ts';
import './pool.css';

const MODE = defineSetting('pool:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('pool:level', LEVEL_NAMES, 'normal');
const MIN_THINK = 0.15;
const SPINS = [0, 0.7, -0.7] as const;
const SPIN_NAMES = ['Center', 'Follow', 'Draw'] as const;

type Pt = { x: number; y: number };
type Drag = { id: number; kind: 'aim' | 'place'; down: Pt; downDist: number; base: number; moved: boolean };
type AiAnim = { shot: Shot; t: number; from: Pt; a0: number };
type Msg = { game?: unknown; t?: unknown; n?: unknown; g?: unknown; shot?: unknown; dx?: unknown; dy?: unknown; p?: unknown; x?: unknown; y?: unknown };

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />}>
      <Pool />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const angOf = (dx: number, dy: number) => Math.atan2(dy, dx);

function cleanShot(g: Game, raw: unknown): Shot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!fin(s.dx) || !fin(s.dy) || !fin(s.power)) return null;
  const d = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
  if (d < 1e-6) return null;
  const shot: Shot = { dx: s.dx / d, dy: s.dy / d, power: Math.min(1, Math.max(0.02, s.power)), spin: fin(s.spin) ? Math.min(1, Math.max(-1, s.spin)) : 0 };
  if (g.ballInHand) {
    const p = s.place as { x?: unknown; y?: unknown } | undefined;
    if (!p || !fin(p.x) || !fin(p.y) || !canPlace(g, p.x, p.y)) return null;
    shot.place = { x: p.x, y: p.y };
  }
  if (fin(s.call) && s.call >= 0 && s.call < POCKETS.length) shot.call = Math.floor(s.call);
  return shot;
}

function onEight(g: Game, seat: Seat) {
  const grp = g.groups[seat];
  return !!grp && remaining(g, grp).length === 0;
}

function Pool() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const cfg = useRef({ mode: online ? ('2p' as const) : getSetting(MODE), level: levelIndex(getSetting(LEVEL)) as Level });
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const opener: Seat = online ? ((online.round % 2) as Seat) : ((shell.round % 2) as Seat);
  const gameRef = useRef<Game>(newGame((Math.random() * 2 ** 31) >>> 0, opener));
  // The first online round starts in the game that was already up before the room, so the guest's table is synced per round.
  const [syncedRound, setSyncedRound] = useState<number | null>(null);
  const ready = !online || online.isHost || syncedRound === online.round;
  const sim = useRef<{ sim: Sim; shot: Shot; from: Game; seen: number } | null>(null);
  const queued = useRef<Game | null>(null);
  const spins = useRef<Spin3[]>(freshSpins());
  const sinks = useRef<Sink[]>([]);
  const aim = useRef({ a: Math.PI * 0, power: 0, kb: 0.55, kbOn: false });
  const place = useRef<Pt | null>(null);
  const drag = useRef<Drag | null>(null);
  const remote = useRef<{ dx: number; dy: number; p: number; x?: number; y?: number } | null>(null);
  const aiAnim = useRef<AiAnim | null>(null);
  const aiTask = useRef<{ id: number; game: Game; t: number; shot: Shot | null } | null>(null);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const timers = useRef<{ left: number; fn: () => void }[]>([]);
  const ended = useRef(false);
  const sentAim = useRef(0);
  const clock = useRef(0);
  const [spinIx, setSpinIx] = useState(0);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [, bump] = useState(0);
  const refresh = useCallback(() => bump((n) => n + 1), []);
  const sizeRef = useRef(0);
  sizeRef.current = size.h;
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  // A phone or iPad frame is scaled down to fit; touch controls grow by the same factor so they stay finger sized.
  const [tapU, setTapU] = useState(1);
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch) {
      setTapU(1);
      return;
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-pool-u', u.toFixed(3));
        setTapU(u);
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
      el.style.removeProperty('--g-pool-u');
    };
  }, [shell.touch]);

  const later = (fn: () => void, s: number) => timers.current.push({ left: s, fn });
  const say = (text: string) => setToast({ text, id: performance.now() });
  const mySeat = (): Seat | null => (online ? (online.seat as Seat) : null);
  const isCpu = () => !online && cfg.current.mode === 'cpu';
  const humanTurn = () => {
    const g = gameRef.current;
    if (g.phase === 'over' || sim.current || aiAnim.current || !ready) return false;
    if (online) return g.turn === mySeat();
    return !isCpu() || g.turn === 0;
  };
  const name = (seat: Seat) => {
    if (online) {
      const p = online.players.find((x) => x.seat === seat);
      return seat === online.seat ? 'You' : p?.name ?? `Player ${seat + 1}`;
    }
    if (isCpu()) return seat === 0 ? 'You' : 'Computer';
    return `Player ${seat + 1}`;
  };

  /** Default aim for a fresh turn: at the nearest ball the shooter may hit first. */
  const resetTurn = useCallback(() => {
    const g = gameRef.current;
    place.current = null;
    if (g.ballInHand) {
      const c = g.balls[0];
      place.current = canPlace(g, c.x, c.y) ? { x: c.x, y: c.y } : clampPlace(g, g.kitchen ? HEAD_X * 0.6 : L * 0.3, W / 2);
    }
    const from = place.current ?? g.balls[0];
    let best: Pt | null = null;
    let bd = Infinity;
    for (const id of legalTargets(g)) {
      const b = g.balls[id];
      const d = (b.x - from.x) ** 2 + (b.y - from.y) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) aim.current.a = angOf(best.x - from.x, best.y - from.y);
    aim.current.power = 0;
  }, []);

  useEffect(() => {
    if (shell.status !== 'ready' || online) return;
    cfg.current = { mode, level: levelIndex(levelName) as Level };
    gameRef.current = newGame((Math.random() * 2 ** 31) >>> 0, opener);
    spins.current = freshSpins();
    resetTurn();
    refresh();
    shell.invalidate();
  }, [mode, levelName, shell.status]);

  useEffect(() => {
    resetTurn();
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    worker.current = w;
    w?.addEventListener('message', (e: MessageEvent<AiReply>) => {
      const task = aiTask.current;
      if (task && e.data.id === task.id) task.shot = e.data.shot;
    });
    return () => {
      w?.terminate();
      worker.current = null;
      timers.current = [];
    };
  }, []);

  const sendState = (g: Game, to?: number) => online?.send({ game: 'pool', t: 'state', n: g.shots, g }, to === undefined ? undefined : { to });

  // Host deals; a guest asks until the table arrives.
  useEffect(() => {
    if (!online) return;
    if (online.isHost) {
      if (gameRef.current.shots === 0 && !sim.current) {
        gameRef.current = newGame((Math.random() * 2 ** 31) >>> 0, opener);
        spins.current = freshSpins();
        resetTurn();
        refresh();
      }
      sendState(gameRef.current);
    } else {
      const ask = () => {
        if (!readyRef.current) {
          online.send({ game: 'pool', t: 'hello' });
          later(ask, 1.5);
        }
      };
      ask();
    }
  }, [online?.seat, online?.round]);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const begin = (shot: Shot) => {
    const g = gameRef.current;
    const s = startShot(g, shot);
    sim.current = { sim: s, shot, from: g, seen: 0 };
    place.current = null;
    remote.current = null;
    aim.current.power = 0;
    aim.current.kbOn = false;
    sfx.tone({ freq: 240, to: 110, dur: 0.06, type: 'triangle', vol: 0.12 + shot.power * 0.22 });
    sfx.noise(0.025, 0.06 + shot.power * 0.14);
    refresh();
  };

  const apply = (next: Game, prev: Game) => {
    gameRef.current = next;
    sim.current = null;
    queued.current = null;
    if (next.phase === 'over') {
      finish(next);
    } else {
      const assigned = !prev.groups[prev.turn] && next.groups[prev.turn];
      if (next.foul) say(`${next.reason}, ball in hand`);
      else if (assigned) say(`${name(prev.turn)} ${prev.turn === mySeat() || (isCpu() && prev.turn === 0) ? 'are' : 'is'} ${next.groups[prev.turn]}`);
      else if (next.reason && prev.phase === 'break' && next.reason.includes('8')) say(next.reason);
      if (next.turn !== prev.turn && !next.foul && !(isCpu() && next.turn === 1)) sfx.play('tick', 0.8);
      resetTurn();
    }
    refresh();
  };

  const finish = (g: Game) => {
    if (ended.current || g.winner === null) return;
    ended.current = true;
    const win = g.winner;
    const you = online ? win === online.seat : isCpu() ? win === 0 : true;
    sfx.play(you ? 'win' : 'lose');
    later(() => {
      if (statusRef.current !== 'playing') {
        ended.current = false;
        return;
      }
      const loser = (1 - win) as Seat;
      const cleared = g.reason === 'cleared the table';
      const title = online ? (win === online.seat ? 'You Win' : `${name(win)} Wins`) : isCpu() ? (win === 0 ? 'You Win' : 'Computer Wins') : `${name(win)} Wins`;
      const detail = cleared ? `${name(win)} sank the 8 to clear the table.` : `${name(loser)} ${g.reason}.`;
      if (online) online.reportResult(online.round, win);
      shell.gameOver(undefined, { title: shell.compact || sizeRef.current < 240 ? `${title} · ${detail.slice(0, -1)}` : title, detail: isCpu() ? `${detail} ${levelLabel(LEVEL_NAMES[cfg.current.level])} computer.` : detail });
    }, 1.1);
  };

  const shoot = (shot: Shot) => {
    const g = gameRef.current;
    if (online && !online.isHost) {
      online.send({ game: 'pool', t: 'shot', n: g.shots, shot });
      aim.current.power = 0;
      sim.current = null;
      return;
    }
    if (online) online.send({ game: 'pool', t: 'play', n: g.shots, shot });
    begin(shot);
  };

  useEffect(
    () =>
      online?.onMessage((from, data) => {
        if (!data || typeof data !== 'object') return;
        const m = data as Msg;
        if (m.game !== 'pool') return;
        const g = gameRef.current;
        if (online.isHost) {
          if (m.t === 'hello') sendState(sim.current ? sim.current.from : g, from);
          else if (m.t === 'shot' && from === g.turn && m.n === g.shots && !sim.current && g.phase !== 'over') {
            const shot = cleanShot(g, m.shot);
            if (!shot) return;
            online.send({ game: 'pool', t: 'play', n: g.shots, shot });
            begin(shot);
          }
        } else if (from === 0 && m.t === 'state' && validGame(m.g)) {
          const next = m.g;
          const act = guestSync(g, next, readyRef.current, !!sim.current);
          if (act === 'adopt') {
            gameRef.current = next;
            readyRef.current = true;
            setSyncedRound(online.round);
            queued.current = null;
            remote.current = null;
            spins.current = freshSpins();
            resetTurn();
            refresh();
            if (next.phase === 'over') finish(next);
          } else if (act === 'queue') queued.current = next;
          else if (act === 'apply') apply(next, g);
          return;
        } else if (from === 0 && m.t === 'play' && m.n === g.shots && !sim.current) {
          const shot = cleanShot(g, m.shot);
          if (shot) begin(shot);
        }
        if (m.t === 'aim' && from !== online.seat && from === g.turn && !sim.current && fin(m.dx) && fin(m.dy) && fin(m.p)) {
          remote.current = { dx: m.dx, dy: m.dy, p: m.p, x: fin(m.x) ? m.x : undefined, y: fin(m.y) ? m.y : undefined };
        }
      }),
    [online?.onMessage, online?.seat, online?.isHost],
  );

  const cuePos = (): Pt => {
    const s = sim.current;
    if (s) return s.sim.balls[0];
    return place.current ?? gameRef.current.balls[0];
  };
  const shotNow = (power: number): Shot => {
    const g = gameRef.current;
    const dx = Math.cos(aim.current.a);
    const dy = Math.sin(aim.current.a);
    const shot: Shot = { dx, dy, power, spin: SPINS[spinIx] };
    if (g.ballInHand && place.current) shot.place = { ...place.current };
    const call = calledPocket(dx, dy);
    if (call !== null) shot.call = call;
    return shot;
  };
  const calledPocket = (dx: number, dy: number) => {
    const g = gameRef.current;
    if (!onEight(g, g.turn)) return null;
    const tr = traceAim(g, cuePos(), dx, dy);
    if (tr.hit !== 8 || !tr.objDir) return null;
    return pocketFor(g, 8, tr.objDir);
  };

  // Computer turn: ask the worker, wait a beat, then line up the cue so the shot reads.
  const runAi = (dt: number) => {
    const g = gameRef.current;
    if (!isCpu() || g.turn !== 1 || g.phase === 'over' || sim.current) return;
    const anim = aiAnim.current;
    if (anim) {
      anim.t += dt;
      const sh = anim.shot;
      const target = angOf(sh.dx, sh.dy);
      let da = target - anim.a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const k = Math.min(1, anim.t / 0.24);
      const e = 1 - (1 - k) ** 3;
      aim.current.a = anim.a0 + da * e;
      if (sh.place) place.current = { x: anim.from.x + (sh.place.x - anim.from.x) * e, y: anim.from.y + (sh.place.y - anim.from.y) * e };
      aim.current.power = anim.t < 0.26 ? 0 : anim.t < 0.46 ? sh.power * Math.min(1, (anim.t - 0.26) / 0.18) : sh.power * Math.max(0, 1 - (anim.t - 0.46) / 0.05);
      if (anim.t >= 0.51) {
        aiAnim.current = null;
        if (sh.place) place.current = { ...sh.place };
        begin(sh);
      }
      return;
    }
    let task = aiTask.current;
    if (task && task.game !== g) task = aiTask.current = null;
    if (!task) {
      task = aiTask.current = { id: ++reqId.current, game: g, t: 0, shot: null };
      refresh();
      const w = worker.current;
      if (w) w.postMessage({ id: task.id, game: g, level: cfg.current.level } satisfies AiRequest);
      else {
        const t = task;
        later(() => {
          if (aiTask.current === t) t.shot = chooseShot(g, cfg.current.level, { budgetMs: 60 });
        }, 0.05);
      }
    }
    task.t += dt;
    if (task.shot && task.t >= MIN_THINK) {
      const from = place.current ?? g.balls[0];
      aiAnim.current = { shot: task.shot, t: 0, from: { x: from.x, y: from.y }, a0: aim.current.a };
      aiTask.current = null;
      refresh();
    }
  };

  useGameLoop(
    (dt) => {
      clock.current += dt;
      const fire = shootPressed(keys, humanTurn() && statusRef.current === 'playing');
      timers.current = timers.current.filter((t) => {
        t.left -= dt;
        if (t.left > 0) return true;
        t.fn();
        return false;
      });
      for (const k of sinks.current) k.t += dt;
      sinks.current = sinks.current.filter((k) => k.t < 0.3);
      const s = sim.current;
      if (s) {
        const before = s.sim.balls.map((b) => ({ x: b.x, y: b.y }));
        stepSim(s.sim, dt);
        s.sim.balls.forEach((b, i) => roll(spins.current[i], b.x - before[i].x, b.y - before[i].y));
        let clicks = 0;
        for (; s.seen < s.sim.events.length; s.seen++) {
          const ev = s.sim.events[s.seen];
          if (ev.kind === 'ball' && ev.speed > 0.04 && clicks++ < 3) {
            sfx.tone({ freq: 2300 + Math.random() * 500, to: 1700, dur: 0.03, type: 'sine', vol: Math.min(0.3, 0.04 + ev.speed * 0.09) });
          } else if (ev.kind === 'rail' && ev.speed > 0.15) {
            sfx.tone({ freq: 150, to: 85, dur: 0.07, type: 'sine', vol: Math.min(0.22, ev.speed * 0.06) });
          } else if (ev.kind === 'pocket') {
            const p = POCKETS[ev.b ?? 0];
            const b = before[ev.a];
            sinks.current.push({ id: ev.a, x: b.x, y: b.y, px: p.x, py: p.y, t: 0 });
            sfx.tone({ freq: 320, to: 110, dur: 0.18, type: 'triangle', vol: 0.22 });
            sfx.noise(0.07, 0.08);
            if (ev.a !== 0 && groupOf(ev.a) && groupOf(ev.a) === s.from.groups[s.from.turn]) sfx.play('coin', 1.2);
          }
        }
        if (s.sim.done) {
          if (!online || online.isHost) {
            const next = resolve(s.from, s.shot, s.sim);
            if (online) sendState(next);
            apply(next, s.from);
          } else if (queued.current) apply(queued.current, s.from);
          else {
            gameRef.current = { ...s.from, balls: s.sim.balls.map((b) => ({ ...b })) };
            sim.current = null;
            refresh();
          }
        }
        return;
      }
      if (queued.current) apply(queued.current, gameRef.current);
      runAi(dt);
      if (!humanTurn()) return;
      const turnRate = keys.down('ShiftLeft', 'ShiftRight') ? 0.12 : 0.9;
      const ax = keys.axis('left', 'right');
      if (ax) aim.current.a += ax * turnRate * dt;
      const pw = keys.axis('down', 'up');
      if (pw) {
        aim.current.kb = Math.min(1, Math.max(0.05, aim.current.kb + pw * 0.7 * dt));
        aim.current.kbOn = true;
      }
      if (fire) shoot(shotNow(aim.current.kb));
      if (online && clock.current - sentAim.current > 0.09) {
        sentAim.current = clock.current;
        const p = place.current;
        online.send({ game: 'pool', t: 'aim', dx: Math.cos(aim.current.a), dy: Math.sin(aim.current.a), p: drag.current ? aim.current.power : aim.current.kbOn ? aim.current.kb : 0, x: p?.x, y: p?.y }, { fast: true });
      }
    },
    () => {
      const c = ctx();
      if (!c || !size.w) return;
      const v = layout(size.w, size.h);
      c.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      c.clearRect(0, 0, size.w, size.h);
      tableTransform(c, v, size.dpr);
      const g = gameRef.current;
      const s = sim.current;
      const balls = s ? s.sim.balls : g.balls;
      const mine = humanTurn();
      const rem = remote.current;
      const handPos = mine || aiAnim.current ? place.current : rem && rem.x !== undefined && rem.y !== undefined && g.ballInHand ? { x: rem.x, y: rem.y } : place.current;
      const showCue = !s && g.phase !== 'over' && ready;
      const dx = rem && !mine && !aiAnim.current ? rem.dx : Math.cos(aim.current.a);
      const dy = rem && !mine && !aiAnim.current ? rem.dy : Math.sin(aim.current.a);
      const from = handPos ?? g.balls[0];
      const call = showCue && (mine || aiAnim.current) ? calledPocket(dx, dy) : null;
      drawTable(c, { kitchen: !s && g.ballInHand && g.kitchen, called: call, pulse: clock.current });
      drawBalls(c, balls, spins.current, v, s ? null : handPos, sinks.current);
      if (!showCue) return;
      const px = 1 / v.s;
      if (g.ballInHand && handPos && (mine || aiAnim.current)) drawHandRing(c, handPos.x, handPos.y, canPlace(g, handPos.x, handPos.y), clock.current);
      if (mine) {
        const tr = traceAim(g, from, dx, dy);
        const legal = tr.hit === null || legalTargets(g).includes(tr.hit);
        if (drag.current?.kind !== 'place') drawGuide(c, from, tr, legal, g.balls, px);
      }
      const thinking = isCpu() && g.turn === 1 && !aiAnim.current;
      const pull = mine ? (drag.current?.kind === 'aim' ? aim.current.power : aim.current.kbOn ? aim.current.kb : 0) : aiAnim.current ? aim.current.power : rem?.p ?? 0;
      if (drag.current?.kind !== 'place') drawCue(c, from.x, from.y, dx, dy, pull, thinking ? 0.35 : !mine && !aiAnim.current && !rem ? 0.5 : 1);
      if (pull > 0.001 && (mine || aiAnim.current || rem)) drawPower(c, pull);
    },
  );

  // Pointer: the cue follows the finger (it points from the finger through the cue ball); pull away to add power.
  const tablePt = (e: RPointerEvent<HTMLCanvasElement>) => toTable(layout(size.w, size.h), e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (shell.status !== 'playing' || !humanTurn() || drag.current) return;
    sfx.unlock();
    const p = tablePt(e);
    const g = gameRef.current;
    const cue = cuePos();
    const v = layout(size.w, size.h);
    const d = Math.sqrt((p.x - cue.x) ** 2 + (p.y - cue.y) ** 2);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (g.ballInHand && d * v.s < Math.max(R * 2.4 * v.s, e.pointerType === 'mouse' ? 14 : 26)) {
      drag.current = { id: e.pointerId, kind: 'place', down: p, downDist: 0, base: 0, moved: false };
      return;
    }
    if (d > R * 0.8) aim.current.a = angOf(cue.x - p.x, cue.y - p.y);
    aim.current.power = 0;
    aim.current.kbOn = false;
    drag.current = { id: e.pointerId, kind: 'aim', down: p, downDist: d, base: aim.current.a, moved: false };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const dr = drag.current;
    const p = tablePt(e);
    if (!dr) {
      if (e.pointerType === 'mouse' && humanTurn() && shell.status === 'playing') {
        const cue = cuePos();
        if ((p.x - cue.x) ** 2 + (p.y - cue.y) ** 2 > (R * 1.5) ** 2) aim.current.a = angOf(cue.x - p.x, cue.y - p.y);
      }
      return;
    }
    if (dr.id !== e.pointerId) return;
    dr.moved = true;
    if (dr.kind === 'place') {
      const g = gameRef.current;
      const q = canPlace(g, p.x, p.y) ? p : clampPlace(g, p.x, p.y);
      if (q) place.current = { x: q.x, y: q.y };
      return;
    }
    const cue = cuePos();
    const dir = { x: Math.cos(dr.base), y: Math.sin(dr.base) };
    const mx = p.x - dr.down.x;
    const my = p.y - dr.down.y;
    const back = -(mx * dir.x + my * dir.y);
    const lateral = mx * -dir.y + my * dir.x;
    const v = layout(size.w, size.h);
    const pullMax = Math.max(0.42, 120 / v.s);
    aim.current.power = Math.min(1, Math.max(0, back / pullMax));
    const reach = Math.max(dr.downDist, R * 3);
    aim.current.a = dr.base + (lateral / reach) * (aim.current.power > 0.02 ? 0.3 : 1);
    void cue;
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>, cancel = false) => {
    const dr = drag.current;
    if (!dr || dr.id !== e.pointerId) return;
    drag.current = null;
    if (dr.kind === 'place' || cancel) {
      aim.current.power = 0;
      return;
    }
    const power = aim.current.power;
    if (power >= 0.04 && humanTurn()) shoot(shotNow(power));
    aim.current.power = 0;
  };

  const v = layout(size.w, size.h);
  const box = tableBox(v);
  const g = gameRef.current;
  const mine = humanTurn();
  const panel = (seat: Seat) => {
    const grp: Group | null = g.groups[seat];
    const ids = grp === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : grp === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
    const up = new Set(grp ? remaining(g, grp) : []);
    const active = g.turn === seat && g.phase !== 'over';
    const eight = onEight(g, seat);
    const state = !active || !ready
      ? ''
      : sim.current
        ? 'Rolling'
        : isCpu() && seat === 1
          ? aiAnim.current ? 'Shooting' : 'Thinking'
          : online && seat !== online.seat
            ? 'Aiming'
            : g.phase === 'break'
              ? 'Break'
              : g.ballInHand
                ? 'Ball in Hand'
                : isCpu() || online ? 'Your Shot' : 'Shoot';
    return (
      <div className={`g-pool-player ${active ? 'is-on' : ''}`} key={seat}>
        <div className="g-pool-name">
          <span>{name(seat)}</span>
          {isCpu() && seat === 1 && <em>{levelLabel(LEVEL_NAMES[cfg.current.level])}</em>}
        </div>
        <div className="g-pool-group">{eight ? 'On the 8' : grp ? (grp === 'solids' ? 'Solids' : 'Stripes') : 'Open Table'}</div>
        <div className="g-pool-racks" aria-hidden="true">
          {eight ? <i className="g-pool-mini" style={{ background: ballColor(8) }} /> : ids.map((id) => <i key={id} className={`g-pool-mini ${id > 8 ? 'is-stripe' : ''} ${up.has(id) ? '' : 'is-out'}`} style={{ ['--c' as string]: ballColor(id) }} />)}
        </div>
        <div className={`g-pool-state ${state === 'Thinking' ? 'is-busy' : ''}`}>{state}</div>
      </div>
    );
  };

  const cardTop = Math.max(48, box.y + 8);
  const hud = v.side
    ? { left: { left: box.x - v.panelW - 12, top: cardTop, width: v.panelW }, right: { left: box.x + box.w + 12, top: cardTop, width: v.panelW } }
    : { left: { left: Math.max(10, box.x), top: box.y + box.h + 8, width: Math.min(box.w / 2 - 30, 220) }, right: { left: Math.min(size.w - 10, box.x + box.w) - Math.min(box.w / 2 - 30, 220), top: box.y + box.h + 8, width: Math.min(box.w / 2 - 30, 220) } };
  const spinAt = v.side
    ? cardTop + 140 <= size.h
      ? { left: box.x + box.w + 12 + v.panelW / 2 - 22, top: Math.min(size.h - 56, box.y + box.h - 52) }
      : { left: box.x - v.panelW / 2 - 34, top: Math.max(2, cardTop - 48) } : { left: box.x + box.w / 2 - 22, top: box.y + box.h + 12 + (tapU - 1) * 22 };

  return (
    <div className={`g-pool-stage ${v.side ? 'is-side' : 'is-row'} ${size.h < 220 ? 'is-tight' : ''}`}>
      <canvas
        ref={ref}
        className={`g-pool-canvas ${mine ? 'is-live' : ''}`}
        aria-label="Pool table"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        onPointerCancel={(e) => onUp(e, true)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="g-pool-hud" style={hud.left}>{panel(0)}</div>
      <div className="g-pool-hud" style={hud.right}>{panel(1)}</div>
      {mine && (
        <button
          type="button"
          className="g-pool-spin"
          style={spinAt}
          aria-label={`Spin: ${SPIN_NAMES[spinIx]}`}
          title={`Spin: ${SPIN_NAMES[spinIx]}`}
          onClick={() => {
            sfx.play('select');
            setSpinIx((i) => (i + 1) % SPINS.length);
          }}
        >
          <i style={{ transform: `translateY(${-SPINS[spinIx] * 9}px)` }} />
          <span>{SPIN_NAMES[spinIx]}</span>
        </button>
      )}
      {!ready && <div className="g-pool-wait" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>Waiting for the host</div>}
      {toast && (
        <div key={toast.id} className="g-pool-toast" style={{ left: box.x + box.w / 2, top: box.y + Math.min(box.h * 0.2, 60) }} onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
