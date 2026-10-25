import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { planner, rng, type Level, type Plan } from './bot';
import { TOTAL_PAR } from './holes';
import { BOT_NAMES, COLORS, MAX_STROKES, applyPutt, fmtPar, forfeitHole, hole, holeDone, label, lastHole, newMatch, nextUp, overDetail, startHole, toPar, total, winner, type Golfer, type Match, type Outcome } from './match';
import { GAME, parse, type Result, type Sync } from './net';
import { MAX_TICKS, R, STEP, height, restBall, step, strike, simulate, type Ball } from './physics';
import { build, type BallView, type World } from './scene';
import { meta } from './meta';
import './mini-golf.css';

const HUMANS = defineSetting('mini-golf:players', ['1', '2', '3', '4'] as const, '1');
const CPUS = defineSetting('mini-golf:cpus', ['0', '1', '2', '3'] as const, '1');
const LEVEL = defineSetting('mini-golf:level', LEVEL_NAMES, 'normal');
const HOLE_LIMIT = 150 * 120;
const AIM_TICKS = 84;
const humanOptions = [
  ['1', 'Solo'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
] as const;
const cpuOptions = [
  ['0', 'None'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
] as const;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={(n) => `${n} strokes`} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={BOT_NAMES} className="g-mini-golf">
      <Golf />
    </GameShell>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  if (!online?.isHost || !online.bots.length) return null;
  return <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />;
}

function Setup() {
  const [humans, setHumans] = useSetting(HUMANS);
  const [cpus, setCpus] = useSetting(CPUS);
  const [level, setLevel] = useSetting(LEVEL);
  const room = 4 - Number(humans);
  const cpu = String(Math.min(Number(cpus), room)) as (typeof cpuOptions)[number][0];
  return (
    <>
      <Segmented label="Players" value={humans} options={humanOptions} onChange={setHumans} />
      {room > 0 && <Segmented label="Computer" value={cpu} options={cpuOptions.filter(([v]) => Number(v) <= room)} onChange={setCpus} />}
      {room > 0 && cpu !== '0' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Live = { ball: Ball; from: { x: number; z: number }; start: number; res?: Result; own?: boolean; finished?: boolean };
type BotJob = { gen: Generator<void, Plan, void> | null; plan: Plan | null; at: number };
type Phase = 'intro' | 'play' | 'card' | 'over';
type State = {
  m: Match;
  seats: number[];
  me: number;
  round: number;
  clock: number;
  acc: number;
  phase: Phase;
  timer: number;
  turn: number;
  live: Map<number, Live>;
  bots: Map<number, BotJob>;
  level: Level;
  humans: number;
  cpus: number;
  pending: number;
  rand: () => number;
  sec: number;
};

function Golf() {
  const shell = useShell();
  const online = useOnline();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const [humansS] = useSetting(HUMANS);
  const [cpusS] = useSetting(CPUS);
  const [levelS] = useSetting(LEVEL);
  const st = useRef<State | null>(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const [banner, setBanner] = useState<{ id: number; text: string; sub: string } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number } | null>(null);
  const aim = useRef({ angle: 0, power: 0, keys: false, holding: false, since: 0 });
  const keys = useKeys((code) => {
    const s = st.current;
    if (!s || shell.status !== 'playing') return;
    if (code === 'Tab' || code === 'KeyC') setCardOpen((v) => !v);
  });

  const say = (text: string, sub = '') => setBanner({ id: Date.now() + Math.random(), text, sub });

  function makeState(): State {
    const level = levelS as Level;
    const golfers: Golfer[] = [];
    let seats: number[] = [];
    let me = -1;
    let humans = 1;
    let cpus = 0;
    if (online) {
      seats = [...new Set([...online.players.map((p) => p.seat), ...online.bots.map((b) => b.seat)])].sort((a, b) => a - b);
      for (const seat of seats) {
        const bot = online.bots.find((b) => b.seat === seat);
        const name = online.players.find((p) => p.seat === seat)?.name ?? bot?.name ?? BOT_NAMES[seat % 4];
        golfers.push({ name, color: COLORS[seat % 4], kind: seat === online.seat ? 'human' : bot ? 'bot' : 'remote', level, left: false });
      }
      me = seats.indexOf(online.seat);
    } else {
      humans = Number(humansS);
      cpus = Math.min(Number(cpusS), 4 - humans);
      for (let i = 0; i < humans; i++) golfers.push({ name: humans === 1 ? 'You' : `Player ${i + 1}`, color: COLORS[i], kind: 'human', level, left: false });
      for (let i = 0; i < cpus; i++) golfers.push({ name: BOT_NAMES[i], color: COLORS[humans + i], kind: 'bot', level, left: false });
    }
    return { m: newMatch(golfers), seats, me, round: online?.round ?? 0, clock: 0, acc: 0, phase: 'intro', timer: 1.1, turn: -1, live: new Map(), bots: new Map(), level, humans, cpus, pending: -1, rand: rng(((online?.round ?? 0) + 1) * 7919 + Date.now() % 9973), sec: -1 };
  }

  function syncPacket(s: State, phase: Sync['phase']): Sync {
    return {
      game: GAME,
      k: 'sync',
      round: online?.round ?? 0,
      hole: s.m.hole,
      phase,
      t: s.clock,
      seats: s.seats,
      golfers: s.m.golfers.map((x) => ({ name: x.name, color: x.color, kind: x.kind === 'bot' ? 'bot' : 'human', left: x.left })),
      lies: s.m.lies.map((l) => ({ x: l.ball.x, z: l.ball.z, strokes: l.strokes, done: l.done })),
      card: s.m.card,
      order: s.m.order,
    };
  }
  const sendSync = (to?: number, phase?: Sync['phase']) => {
    const s = st.current;
    if (!online?.isHost || !s) return;
    online.send(syncPacket(s, phase ?? (s.phase === 'intro' ? 'play' : s.phase)), to === undefined ? undefined : { to });
  };

  function reset() {
    const s = makeState();
    st.current = s;
    drag.current = null;
    aim.current = { angle: 0, power: 0, keys: false, holding: false, since: 0 };
    world.current?.setHole(hole(s.m), true);
    world.current?.aim(null);
    setBanner(null);
    setCardOpen(false);
    setHint(true);
    bump();
    if (online && !online.isHost) online.send({ game: GAME, k: 'hello', round: online.round }, { to: 0 });
    if (online?.isHost) sendSync();
  }

  useEffect(() => {
    if (shell.status === 'ready' || !st.current || (online && st.current.round !== online.round)) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.status, online?.round, online?.seat, online?.players.length, online?.bots.length, humansS, cpusS, levelS]);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    w.resize(size.w, size.h);
    if (st.current) w.setHole(hole(st.current.m), true);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE]);

  // Phone and iPad frames scale the game down; grow the game's own buttons and text back so they stay finger sized and readable.
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        el.style.setProperty('--g-mini-golf-u', String(k > 0.4 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1));
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
      el.style.removeProperty('--g-mini-golf-u');
    };
  }, [shell.touch, shell.root, shell.status]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
    shell.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, THREE]);

  // Host: a golfer who leaves mid-round is handed to a computer golfer so the round still finishes.
  useEffect(() => {
    const s = st.current;
    if (!online?.isHost || !s || s.phase === 'over') return;
    let changed = false;
    s.seats.forEach((seat, gi) => {
      const gf = s.m.golfers[gi];
      if (gf.kind === 'remote' && !online.players.some((p) => p.seat === seat)) {
        gf.kind = 'bot';
        gf.left = true;
        changed = true;
      }
    });
    if (changed) {
      sendSync();
      bump();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.players]);

  const ctl = (s: State) => (online ? s.me : s.turn >= 0 && s.m.golfers[s.turn]?.kind === 'human' ? s.turn : -1);
  const canPutt = (s: State, gi: number) => gi >= 0 && s.phase === 'play' && !s.m.lies[gi].done && !s.live.has(gi) && (online ? gi === s.me && s.pending < 0 : s.turn === gi);

  function aimAtCup(s: State, gi: number) {
    const b = s.m.lies[gi].ball;
    const h = hole(s.m);
    aim.current.angle = Math.atan2(h.cup.z - b.z, h.cup.x - b.x);
  }

  function hostShot(s: State, gi: number, a: number, p: number, t: number) {
    const lie = s.m.lies[gi];
    const h = hole(s.m);
    const from = { x: lie.ball.x, z: lie.ball.z };
    const start = strike(lie.ball, a, p, t);
    const end = simulate(h, start);
    applyPutt(s.m, gi, from, end);
    const l = s.m.lies[gi];
    const res: Result = { game: GAME, k: 'res', round: online?.round ?? 0, hole: s.m.hole, g: gi, a, p, t, fx: from.x, fz: from.z, ex: l.ball.x, ez: l.ball.z, st: end.state === 'holed' ? 'holed' : end.state === 'water' ? 'water' : 'rest', strokes: l.strokes, done: l.done };
    online?.send(res);
    s.live.set(gi, { ball: start, from, start: t, res });
  }

  function shoot(gi: number, angle: number, power: number) {
    const s = st.current;
    if (!s) return;
    const lie = s.m.lies[gi];
    sfx.play('blip', 0.55 + power * 0.6);
    setHint(false);
    if (!online) {
      s.live.set(gi, { ball: strike(lie.ball, angle, power, s.clock), from: { x: lie.ball.x, z: lie.ball.z }, start: s.clock });
      s.turn = -1;
    } else if (online.isHost) hostShot(s, gi, angle, power, s.clock);
    else {
      s.pending = lie.strokes;
      s.live.set(gi, { ball: strike(lie.ball, angle, power, s.clock), from: { x: lie.ball.x, z: lie.ball.z }, start: s.clock, own: true });
      online.send({ game: GAME, k: 'shot', round: online.round, hole: s.m.hole, n: lie.strokes, a: angle, p: power, t: s.clock, x: lie.ball.x, z: lie.ball.z }, { to: 0 });
    }
    s.bots.delete(gi);
    bump();
  }

  function applyRes(s: State, r: Result) {
    const lie = s.m.lies[r.g];
    if (!lie) return;
    lie.strokes = r.strokes;
    lie.done = r.done;
    lie.ball = restBall(r.ex, r.ez);
    if (r.st === 'holed') lie.ball.state = 'holed';
    if (r.done) s.m.card[r.g][s.m.hole] = r.strokes;
    if (r.g === s.me) s.pending = -1;
    const lv = s.live.get(r.g);
    if (lv?.own) lv.res = r;
    else s.live.set(r.g, { ball: strike(restBall(r.fx, r.fz), r.a, r.p, r.t), from: { x: r.fx, z: r.fz }, start: r.t, res: r });
    bump();
  }

  function applySync(s: State, p: Sync) {
    if (!online) return;
    const h0 = s.m.hole;
    if (p.seats.join() !== s.seats.join() || p.golfers.length !== s.m.golfers.length) {
      s.seats = p.seats.slice();
      s.me = s.seats.indexOf(online.seat);
      s.m = newMatch(p.golfers.map((x) => ({ name: x.name, color: x.color, kind: 'remote', level: s.level, left: x.left })));
      s.m.hole = -1;
    }
    s.m.golfers.forEach((gf, i) => {
      const x = p.golfers[i];
      gf.name = x.name;
      gf.color = x.color;
      gf.left = x.left;
      gf.kind = i === s.me ? 'human' : x.kind === 'bot' ? 'bot' : 'remote';
    });
    if (p.hole !== s.m.hole) {
      startHole(s.m, p.hole);
      s.live.clear();
      s.clock = p.t;
      s.pending = -1;
      world.current?.setHole(hole(s.m), h0 !== p.hole);
      if (p.phase === 'play') {
        s.phase = 'intro';
        s.timer = 1.1;
      }
      setCardOpen(false);
    }
    const h = hole(s.m);
    p.lies.forEach((l, i) => {
      const lie = s.m.lies[i];
      if (!lie) return;
      lie.strokes = l.strokes;
      lie.done = l.done;
      lie.ball = restBall(l.x, l.z);
      if (l.done && Math.hypot(l.x - h.cup.x, l.z - h.cup.z) < 0.01) lie.ball.state = 'holed';
    });
    s.m.card = p.card.map((r) => r.slice());
    s.m.order = p.order.slice();
    if (s.me >= 0 && s.pending >= 0 && s.m.lies[s.me].strokes > s.pending) s.pending = -1;
    if (p.phase === 'card' && s.phase !== 'card') {
      s.phase = 'card';
      setCardOpen(true);
    } else if (p.phase === 'play' && s.phase === 'card') {
      s.phase = 'play';
      setCardOpen(false);
    } else if (p.phase === 'over' && s.phase !== 'over') finish(s);
    bump();
  }

  useEffect(() => {
    if (!online) return;
    return online.onMessage((from, d) => {
      const p = parse(d);
      const s = st.current;
      if (!p || !s || p.round !== online.round) return;
      if (online.isHost) {
        if (p.k === 'hello') sendSync(from);
        else if (p.k === 'shot') {
          const gi = s.seats.indexOf(from);
          if (gi < 0 || p.hole !== s.m.hole || s.phase !== 'play') return;
          const lie = s.m.lies[gi];
          if (lie.done || p.n !== lie.strokes || s.m.golfers[gi].kind !== 'remote') return sendSync(from);
          const t = Math.max(s.clock - 600, Math.min(s.clock + 600, Math.round(p.t)));
          hostShot(s, gi, p.a, Math.max(0, Math.min(1, p.p)), t);
          bump();
        }
      } else if (from === 0) {
        if (p.k === 'sync') applySync(s, p);
        else if (p.k === 'res' && p.hole === s.m.hole) applyRes(s, p);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.onMessage, online?.isHost, online?.round]);

  function finish(s: State) {
    if (s.phase === 'over' && shell.status === 'over') return;
    s.phase = 'over';
    setCardOpen(true);
    const w = winner(s.m);
    const nameOf = (g: number) => s.m.golfers[g].name;
    if (online) {
      const seat = w === null ? null : s.seats[w];
      online.reportResult(online.round, seat);
      sfx.play(w === s.me ? 'win' : 'lose');
      shell.gameOver(undefined, { title: w === null ? 'All Square' : w === s.me ? 'You Win' : `${nameOf(w)} Wins`, detail: overDetail(s.m, s.me, w, online.players.map((p) => (p.seat === online.seat ? 'You' : p.name))) });
      return;
    }
    if (s.humans === 1) {
      const score = total(s.m, 0);
      const title = s.cpus === 0 ? `${score} Strokes` : w === 0 ? 'You Win' : w === null ? 'All Square' : `${nameOf(w)} Wins`;
      sfx.play(s.cpus === 0 || w === 0 ? 'win' : 'lose');
      shell.gameOver(score, { title, detail: `${fmtPar(toPar(s.m, 0))} on a par ${TOTAL_PAR} course.` });
      return;
    }
    sfx.play('win');
    const list = s.m.golfers.map((gf, i) => `${gf.name} ${total(s.m, i)}`).join(', ');
    shell.gameOver(undefined, { title: w === null ? 'All Square' : `${nameOf(w)} Wins`, detail: `${list}.` });
  }

  function nextHole(s: State) {
    startHole(s.m, s.m.hole + 1);
    s.clock = 0;
    s.acc = 0;
    s.live.clear();
    s.bots.clear();
    s.turn = -1;
    s.pending = -1;
    s.phase = 'intro';
    s.timer = 1.1;
    world.current?.setHole(hole(s.m), true);
    setCardOpen(false);
    sendSync();
    bump();
  }

  function announce(s: State, gi: number, out: Outcome) {
    const gf = s.m.golfers[gi];
    const h = hole(s.m);
    const mine = online ? gi === s.me : gf.kind === 'human';
    if (out === 'holed') {
      const n = s.m.lies[gi].strokes;
      say(label(n, h.par), s.m.golfers.length > 1 ? (online && gi === s.me ? 'You' : gf.name) : '');
      if (mine) sfx.play(n < h.par ? 'win' : 'coin');
    } else if (out === 'water' && (mine || !online)) say('Splash', 'One stroke penalty');
    else if (out === 'pickup' && (mine || !online)) say('Picked Up', `${MAX_STROKES} strokes max`);
  }

  function finalize(s: State, gi: number, lv: Live) {
    s.live.delete(gi);
    let out: Outcome;
    if (!online) out = applyPutt(s.m, gi, lv.from, lv.ball);
    else {
      const r = lv.res!;
      out = r.st === 'holed' ? 'holed' : r.st === 'water' ? 'water' : r.done ? 'pickup' : 'rest';
    }
    announce(s, gi, out);
    if (!online) {
      s.turn = -1;
      s.timer = 0.45;
    }
    if ((online ? gi === s.me : true) && !s.m.lies[gi].done) aimAtCup(s, gi);
    bump();
  }

  function runBots(s: State, budget: number) {
    if (online && !online.isHost) return;
    const h = hole(s.m);
    const t0 = performance.now();
    s.m.golfers.forEach((gf, gi) => {
      if (gf.kind !== 'bot') return;
      const lie = s.m.lies[gi];
      if (lie.done || s.live.has(gi) || s.phase !== 'play' || (!online && s.turn !== gi)) {
        if (lie.done || s.phase !== 'play') s.bots.delete(gi);
        return;
      }
      let job = s.bots.get(gi);
      if (!job) {
        const think = online ? 0.8 + s.rand() * 1.6 : 0.55 + s.rand() * 0.6;
        const at = s.clock + Math.round(think * 120) + AIM_TICKS;
        job = { gen: planner(h, lie.ball, at, gf.level, Math.floor(s.rand() * 1e9)), plan: null, at };
        s.bots.set(gi, job);
      }
      while (job.gen && performance.now() - t0 < budget) {
        const r = job.gen.next();
        if (r.done) {
          job.plan = r.value;
          job.gen = null;
        }
      }
      if (job.plan && s.clock >= job.at) shoot(gi, job.plan.angle, job.plan.power);
    });
  }

  function botAim(s: State) {
    if (online) return null;
    const job = s.turn >= 0 ? s.bots.get(s.turn) : undefined;
    if (!job?.plan || s.clock < job.at - AIM_TICKS) return null;
    const f = Math.min(1, (s.clock - (job.at - AIM_TICKS)) / AIM_TICKS);
    const e = 1 - (1 - f) * (1 - f);
    const b = s.m.lies[s.turn].ball;
    return { x: b.x, z: b.z, angle: job.plan.angle + Math.sin(f * 9) * 0.07 * (1 - f), power: job.plan.power * e };
  }

  useGameLoop(
    (dt) => {
      const s = st.current;
      if (!s || shell.status !== 'playing') return;
      const h = hole(s.m);
      const host = !online || online.isHost;
      if (s.phase === 'intro') {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.phase = 'play';
          s.turn = -1;
          s.timer = 0.1;
          if (s.me >= 0) aimAtCup(s, s.me);
          bump();
        }
      }
      if (s.phase === 'intro' || s.phase === 'play') {
        s.acc += dt;
        let n = 0;
        while (s.acc >= STEP && n++ < 40) {
          s.acc -= STEP;
          s.clock++;
          for (const [gi, lv] of s.live) {
            if (lv.finished) continue;
            const ev = step(h, lv.ball);
            if (ev.hit > 0.35) sfx.play('tick', 0.6 + Math.min(4, ev.hit) * 0.12);
            if (ev.lip) sfx.play('blip', 0.7);
            if (ev.cup) {
              sfx.play('coin');
              world.current?.sink(h.cup.x, h.cup.z);
            }
            if (ev.water) {
              sfx.play('boom');
              world.current?.splash(lv.ball.x, lv.ball.z);
            }
            if (lv.ball.state === 'roll' && lv.ball.t - lv.start > MAX_TICKS) {
              lv.ball.state = 'rest';
              lv.ball.loop = null;
              lv.ball.x = lv.ball.safe.x;
              lv.ball.z = lv.ball.safe.z;
            }
            if (lv.ball.state !== 'roll') {
              lv.finished = true;
              if (lv.res && lv.res.st !== 'holed') {
                lv.ball.x = lv.res.st === 'water' ? lv.ball.x : lv.res.ex;
                lv.ball.z = lv.res.st === 'water' ? lv.ball.z : lv.res.ez;
              }
            }
            void gi;
          }
        }
        if (s.acc > STEP * 4) s.acc = 0;
        for (const [gi, lv] of [...s.live]) if (lv.finished && (!online || lv.res)) finalize(s, gi, lv);
        const sec = Math.floor(s.clock / 120);
        if (online && sec !== s.sec) {
          s.sec = sec;
          if (HOLE_LIMIT / 120 - sec <= 30) bump();
        }
      }
      if (s.phase === 'play') {
        if (!online && s.live.size === 0 && s.turn < 0 && !holeDone(s.m)) {
          s.timer -= dt;
          if (s.timer <= 0) {
            s.turn = nextUp(s.m);
            if (s.m.golfers[s.turn]?.kind === 'human') aimAtCup(s, s.turn);
            bump();
          }
        }
        runBots(s, 6);
        if (host && online && s.clock > HOLE_LIMIT) {
          s.m.lies.forEach((l, gi) => {
            if (!l.done && !s.live.has(gi)) forfeitHole(s.m, gi);
          });
          sendSync();
          bump();
        }
        if (host && holeDone(s.m) && s.live.size === 0) {
          s.phase = 'card';
          s.timer = lastHole(s.m) ? 2.2 : 4.2;
          setCardOpen(true);
          sendSync(undefined, 'card');
          bump();
        }
      } else if (s.phase === 'card' && host) {
        s.timer -= dt;
        if (s.timer <= 0) {
          if (lastHole(s.m)) {
            sendSync(undefined, 'over');
            finish(s);
          } else nextHole(s);
        }
      }
      // Keyboard aiming for whoever is up on this screen.
      const me = ctl(s);
      if (me >= 0 && canPutt(s, me)) {
        const a = aim.current;
        const turn = keys.axis('ArrowLeft', 'ArrowRight');
        if (turn) {
          a.keys = true;
          a.angle += turn * dt * (keys.down('ShiftLeft', 'ShiftRight') ? 0.35 : 1.4);
        }
        const hold = keys.down('Space', 'ArrowUp', 'Enter');
        if (hold) {
          // Charged from wall time, so a slow frame rate doesn't weaken the putt.
          const now = performance.now();
          if (!a.holding) a.since = now;
          a.keys = true;
          a.holding = true;
          a.power = Math.min(1, ((now - a.since) / 1000) * 0.75);
        } else if (a.holding) {
          a.holding = false;
          if (a.power > 0.04) shoot(me, a.angle, a.power);
          a.power = 0;
        }
      }
    },
    () => {
      const s = st.current;
      const w = world.current;
      if (!s || !w) return;
      const views: BallView[] = s.m.golfers.map((gf, gi) => {
        const lv = s.live.get(gi);
        const lie = s.m.lies[gi];
        const ball = lv ? lv.ball : lie.done ? null : lie.ball;
        const focus = online ? s.me : s.turn;
        return { ball, color: gf.color, ghost: focus >= 0 ? gi !== focus : false };
      });
      w.update(s.clock, 1 / 60, views);
      const me = ctl(s);
      const a = aim.current;
      if (me >= 0 && canPutt(s, me) && (drag.current ? a.power > 0.02 : a.keys)) {
        const b = s.m.lies[me].ball;
        w.aim({ x: b.x, z: b.z, angle: a.angle, power: Math.max(drag.current ? 0 : 0.08, a.power) });
      } else w.aim(botAim(s));
      w.render();
    },
  );

  // offsetX/Y stay in the game's own pixels inside the CSS 3D laptop, where client rects are projected.
  const local = (e: RPointerEvent<HTMLDivElement>) => ({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!s || shell.status !== 'playing' || drag.current) return;
    const me = ctl(s);
    if (!canPutt(s, me)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
    aim.current.power = 0;
    aim.current.holding = false;
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const s = st.current;
    const w = world.current;
    if (!d || d.id !== e.pointerId || !s || !w) return;
    const p = local(e);
    d.x = p.x;
    d.y = p.y;
    const me = ctl(s);
    if (me < 0) return;
    const b = s.m.lies[me].ball;
    const y = height(hole(s.m), b.x, b.z) + R;
    const a0 = w.pick(d.sx, d.sy, y);
    const a1 = w.pick(p.x, p.y, y);
    const px = Math.hypot(p.x - d.sx, p.y - d.sy);
    const full = Math.max(70, Math.min(210, 0.3 * Math.min(size.w, size.h)));
    aim.current.power = Math.min(1, px / full);
    if (a0 && a1 && Math.hypot(a0.x - a1.x, a0.z - a1.z) > 1e-4) aim.current.angle = Math.atan2(a0.z - a1.z, a0.x - a1.x);
    aim.current.keys = false;
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const s = st.current;
    const power = aim.current.power;
    aim.current.power = 0;
    if (!s || e.type === 'pointercancel' || shell.status !== 'playing') return;
    const me = ctl(s);
    if (power > 0.06 && canPutt(s, me)) shoot(me, aim.current.angle, power);
  };

  useEffect(() => {
    if (shell.status !== 'playing') {
      drag.current = null;
      aim.current.power = 0;
      aim.current.holding = false;
    }
  }, [shell.status]);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 1500);
    return () => clearTimeout(id);
  }, [banner]);

  const s = st.current;
  const m = s?.m;
  const h = m ? hole(m) : null;
  const me = s ? ctl(s) : -1;
  const up = s && me >= 0 && canPutt(s, me);
  const left = s && online ? Math.max(0, Math.ceil((HOLE_LIMIT - s.clock) / 120)) : null;
  const playing = shell.status === 'playing';
  return (
    <>
      <div ref={ref} className={`g-mini-golf-host${up ? ' is-up' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {m && h && (
        <div className="g-mini-golf-top" aria-live="off">
          <span>Hole {m.hole + 1}</span>
          <span className="g-mini-golf-hole">{h.name}</span>
          <span>Par {h.par}</span>
          {left !== null && left <= 30 && s?.phase === 'play' && <span className="is-low">{left}s</span>}
        </div>
      )}
      {m && s && (
        <div className="g-mini-golf-players">
          {m.golfers.map((gf, gi) => {
            const lie = m.lies[gi];
            const turn = online ? !lie.done && gi === s.me : s.turn === gi;
            return (
              <div key={gi} className={`g-mini-golf-chip${turn ? ' is-up' : ''}${lie.done ? ' is-done' : ''}${gf.left ? ' is-left' : ''}`}>
                <i style={{ background: gf.color }} />
                <b>{online && gi === s.me ? 'You' : gf.name}</b>
                <span>{lie.done ? (lie.ball.state === 'holed' ? `In ${lie.strokes}` : `${lie.strokes}`) : lie.strokes}</span>
                <em>{fmtPar(toPar(m, gi))}</em>
              </div>
            );
          })}
        </div>
      )}
      {playing && (
        <button
          type="button"
          className="g-mini-golf-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCardOpen((v) => !v)}
        >
          Scorecard
        </button>
      )}
      {playing && s && up && hint && m?.hole === 0 && m.lies[me].strokes === 0 && <div className="g-mini-golf-hint">drag back from anywhere, let go to putt</div>}
      {playing && s && !online && s.humans > 1 && up && !drag.current && <div className="g-mini-golf-turn" key={`${m?.hole}-${s.turn}-${m?.lies[me].strokes}`}>{m?.golfers[me].name}, your putt</div>}
      {banner && (
        <div key={banner.id} className="g-mini-golf-banner">
          <strong>{banner.text}</strong>
          {banner.sub && <small>{banner.sub}</small>}
        </div>
      )}
      {cardOpen && m && <Card m={m} me={online ? s!.me : -1} onClose={() => setCardOpen(false)} />}
    </>
  );
}

function Card({ m, me, onClose }: { m: Match; me: number; onClose: () => void }) {
  return (
    <div className="g-mini-golf-card" onPointerDown={(e) => e.stopPropagation()}>
      <div className="g-mini-golf-card-head">
        <strong>Scorecard</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="g-mini-golf-table" role="table">
        <div className="g-mini-golf-row is-par" role="row">
          <span role="cell">Hole</span>
          {m.holes.map((_, i) => (
            <span role="cell" key={i} className={i === m.hole ? 'is-now' : undefined}>
              {i + 1}
            </span>
          ))}
          <span role="cell">Total</span>
        </div>
        <div className="g-mini-golf-row is-par" role="row">
          <span role="cell">Par</span>
          {m.holes.map((h, i) => (
            <span role="cell" key={i}>
              {h.par}
            </span>
          ))}
          <span role="cell">{TOTAL_PAR}</span>
        </div>
        {m.golfers.map((gf, g) => (
          <div className="g-mini-golf-row" role="row" key={g}>
            <span role="cell" className="g-mini-golf-name">
              <i style={{ background: gf.color }} />
              {g === me ? 'You' : gf.name}
            </span>
            {m.card[g].map((v, i) => (
              <span role="cell" key={i} className={v < 0 ? 'is-empty' : v < m.holes[i].par ? 'is-under' : v > m.holes[i].par ? 'is-over' : undefined}>
                {v < 0 ? '' : v}
              </span>
            ))}
            <span role="cell" className="is-total">
              {total(m, g)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
