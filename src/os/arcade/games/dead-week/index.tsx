// Dead Week: WarioWare as a battle royale. Everyone gets the same tiny game at the same moment; fail and you spill a
// coffee; last student awake wins. The host schedules each game (director.ts) and every client plays it locally
// from the shared seed (frame.ts), so lag never decides a pass or a fail.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { BOT_NAMES, botPasses, botRevealAt, skillOf } from './bots';
import { createDirector, report, standings, tick, vote, voteCounts, type Director, type GamePacket, type Out, type ResultPacket, type Standing } from './director';
import { CARDINAL, DISPLAY, GREEN, INK, PAPER, PINK, YELLOW, BROWN, WHITE, fuse, highlight, paper, rect, text } from './draw';
import { active, elapsed, mirrorHeld, mirrorKey, partAt, shown, startLocal, stepLocal, type Local } from './frame';
import type { Held, Key } from './micro/types';
import { Beat, type BeatVoice } from './music';
import { gameOf, parsePacket, reportOf, resultOf, tallyOf, voteOf } from './net';
import { resultsTime } from './plan';
import { mix } from './rng';
import { CURSES, CURSE_NAMES, CURSE_NOTES, LIVES, type Curse, type Entry } from './rules';
import './dead-week.css';

const MODE = defineSetting('dead-week:mode', ['endless', 'rivals'] as const, 'endless');
const RIVALS = defineSetting('dead-week:rivals', ['3', '5', '7'] as const, '5');
const modeOptions = [['endless', 'Endless'], ['rivals', 'Vs Bots']] as const;
const rivalOptions = [['3', '3'], ['5', '5'], ['7', '7']] as const;
const TOP = 52;
const HUD = 44;
const HINT = 20;
const KEYS: Key[] = ['left', 'right', 'up', 'down', 'action'];

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} botNames={BOT_NAMES} defaultBots={5}>
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [rivals, setRivals] = useSetting(RIVALS);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'rivals' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
    </>
  );
}

type StageMode = 'idle' | 'solo' | 'online';

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const stage = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch) return;
    // phone and iPad frames scale the whole screen down; --g-dead-week-u scales text back up to its real size
    const measure = () => {
      const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
      el.style.setProperty('--g-dead-week-u', String(k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.style.removeProperty('--g-dead-week-u');
    };
  }, [shell.root, shell.touch]);
  if (shell.status === 'ready') stage.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== stage.current.key) stage.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={stage.current.key} mode={stage.current.mode} />;
}

type Sim = {
  clk: number;
  dir: Director | null;
  endless: boolean;
  me: number;
  st: Standing[];
  gp: GamePacket | null;
  L: Local | null;
  res: ResultPacket | null;
  resAt: number;
  done: Map<number, boolean>;
  votes: [number, number, number];
  myVote: Curse | null;
  spillAt: number;
  overAt: number;
  finished: boolean;
  introUntil: number;
  cursor: { x: number; y: number; at: number };
  held: Held;
  pointer: number | null;
  part: number;
  arena: { x: number; y: number; s: number };
  beat: Beat;
};

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const noKeys = (): Held => ({ left: false, right: false, up: false, down: false, action: false });

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const { ref, ctx, size } = useCanvas();
  const [modeSetting] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [, setUi] = useState(0);
  const bump = () => setUi((v) => v + 1);
  const shellRef = useRef(shell);
  const onlineRef = useRef(online);
  shellRef.current = shell;
  onlineRef.current = online;
  const live = mode !== 'idle';
  const isOnline = mode === 'online' && !!online;

  const sim = useRef<Sim | null>(null);
  const layoutScale = useRef({ w: -1, h: -1, u: 1 });
  if (!sim.current) {
    const endless = mode === 'solo' && modeSetting === 'endless';
    const me = isOnline ? online!.seat : 0;
    let dir: Director | null = null;
    let st: Standing[] = [];
    const seed = (Math.random() * 0xffffffff) >>> 0;
    if (mode === 'solo') {
      const entries: Entry[] = [{ seat: 0, name: 'you', bot: false }];
      if (!endless) {
        const names = [...BOT_NAMES].sort((a, b) => mix(seed, a.length, b.length) % 3 - 1);
        for (let i = 0; i < Number(rivals); i++) entries.push({ seat: i + 1, name: names[i % names.length], bot: true });
      }
      dir = createDirector(seed, entries, 0);
    } else if (isOnline && online!.isHost) {
      const entries: Entry[] = [
        ...online!.players.map((p) => ({ seat: p.seat, name: p.name, bot: false })),
        ...online!.bots.map((b) => ({ seat: b.seat, name: b.name, bot: true })),
      ].sort((a, b) => a.seat - b.seat);
      dir = createDirector(seed, entries, performance.now() / 1000);
    }
    if (dir) st = standings(dir.royale);
    sim.current = {
      clk: 0, dir, endless, me, st, gp: null, L: null, res: null, resAt: -9, done: new Map(), votes: [0, 0, 0], myVote: null,
      spillAt: -9, overAt: -1, finished: false, introUntil: 2.2, cursor: { x: 50, y: 60, at: -9 }, held: noKeys(), pointer: null, part: -1,
      arena: { x: 0, y: 0, s: 1 }, beat: new Beat(),
    };
  }
  const s = sim.current;

  const dirNow = () => (isOnline ? performance.now() / 1000 : s.clk);
  const mine = () => s.st.find((e) => e.s === s.me);
  const amAlive = () => {
    const e = mine();
    return !!e && e.p < 0 && !e.x;
  };
  const amGhost = () => {
    const e = mine();
    return !!e && !amAlive();
  };

  const broadcast = (d: unknown) => onlineRef.current?.send(d);
  const sendTally = () => {
    const d = s.dir;
    if (!d || !isOnline) return;
    broadcast(tallyOf(d.royale.n, [...d.reports].map(([seat, p]) => [seat, p ? 1 : 0]), voteCounts(d)));
  };

  const applyGame = (g: GamePacket) => {
    s.gp = g;
    s.st = g.st;
    s.res = null;
    s.done = new Map();
    s.votes = [0, 0, 0];
    s.myVote = null;
    s.part = -1;
    s.L = startLocal(g.seed, g.n, s.clk, g.curse, g.cursed.includes(s.me), amAlive() && !onlineRef.current?.watching);
    s.introUntil = 0;
    const id = s.L.plan.ids[0];
    const pitch = 0.8 + (mix(id.length, id.charCodeAt(0)) % 7) * 0.08;
    sfx.tone({ freq: 392 * pitch, to: 784 * pitch, dur: 0.12, type: 'square', vol: 0.05 });
    sfx.tone({ freq: 523 * pitch, dur: 0.1, type: 'square', vol: 0.045, delay: 0.12 });
    bump();
  };

  const finish = () => {
    if (s.finished) return;
    s.finished = true;
    const r = s.res;
    const o = onlineRef.current;
    const meE = mine();
    const sh = shellRef.current;
    if (s.endless) {
      const games = s.res ? s.res.n + 1 - (s.st[0]?.l === 0 ? 1 : 0) : 0;
      sh.gameOver(passedOf(s), { title: 'Lights Out', detail: `You Survived ${games} Games` });
      return;
    }
    const winnerName = r?.winner != null ? s.st.find((e) => e.s === r.winner)?.nm ?? 'someone' : null;
    const title = r?.winner != null && r.winner === s.me ? 'Last One Awake' : winnerName ? `${winnerName} Stayed Awake` : 'Everyone Fell Asleep';
    const detail = meE && meE.p > 0 ? `You Placed ${ordinal(meE.p)} of ${s.st.length}` : `${(r?.n ?? 0) + 1} Games`;
    if (isOnline && o) {
      o.reportResult(o.round, r?.winner ?? null);
      sh.gameOver(undefined, { title, detail });
    } else sh.gameOver(undefined, { title: meE && meE.p > 1 ? 'You Fell Asleep' : title, detail });
  };

  const applyResult = (r: ResultPacket) => {
    s.res = r;
    s.resAt = s.clk;
    s.st = r.st;
    if (s.L && s.L.outcome === 'pending') s.L.outcome = 'fail';
    if (r.lost.includes(s.me)) {
      s.spillAt = s.clk;
      sfx.noise(0.35, 0.12);
      sfx.tone({ freq: 300, to: 90, dur: 0.4, type: 'triangle', vol: 0.12 });
    }
    if (r.elim.includes(s.me)) sfx.play('lose');
    if (r.shared) sfx.tone({ freq: 220, to: 660, dur: 0.5, type: 'sawtooth', vol: 0.05 });
    if (r.over && r.winner === s.me && !s.endless) sfx.play('win');
    const soloOut = mode === 'solo' && r.elim.includes(s.me);
    if (r.over || soloOut) s.overAt = s.clk + 1.9;
    bump();
  };

  const deliver = (outs: Out[]) => {
    for (const o of outs) {
      if (o.k === 'G') {
        if (isOnline) broadcast(gameOf(o.g));
        applyGame(o.g);
      } else {
        if (isOnline) broadcast(resultOf(o.r));
        applyResult(o.r);
      }
    }
  };

  const hostTick = () => {
    const d = s.dir;
    if (!d || s.finished || shellRef.current.status !== 'playing') return;
    const o = onlineRef.current;
    const present = isOnline && o ? new Set(o.players.map((p) => p.seat)) : null;
    deliver(tick(d, dirNow(), present));
  };

  const sendReport = (pass: boolean) => {
    const L = s.L!;
    s.done.set(s.me, pass);
    if (s.dir) {
      report(s.dir, s.me, L.n, pass);
      sendTally();
    } else onlineRef.current?.send(reportOf(L.n, pass), { to: 0 });
    if (pass) sfx.play('coin');
    else sfx.play('hit');
    bump();
  };

  const castVote = (c: Curse) => {
    if (!amGhost() || s.finished) return;
    s.myVote = c;
    sfx.play('select');
    if (s.dir) {
      vote(s.dir, s.me, c);
      s.votes = voteCounts(s.dir);
      sendTally();
    } else onlineRef.current?.send(voteOf(s.res?.n ?? 0, c), { to: 0 });
    bump();
  };

  // online messages
  useEffect(() => {
    if (!isOnline || !online) return;
    return online.onMessage((from, data) => {
      const o = onlineRef.current;
      if (!o || from === o.seat) return;
      const p = parsePacket(data);
      if (!p) return;
      if (o.isHost && s.dir) {
        if (p.k === 'P' && report(s.dir, from, p.n, p.pass)) {
          s.done.set(from, p.pass);
          sendTally();
          bump();
        } else if (p.k === 'V' && vote(s.dir, from, p.c)) {
          s.votes = voteCounts(s.dir);
          sendTally();
          bump();
        }
        return;
      }
      if (from !== 0) return;
      if (p.k === 'G') applyGame(p);
      else if (p.k === 'R') applyResult(p);
      else if (p.k === 'T') {
        for (const [seat, v] of p.done) s.done.set(seat, v === 1);
        s.votes = p.votes;
        bump();
      }
    });
  }, [isOnline, online]); // eslint-disable-line react-hooks/exhaustive-deps

  // the host keeps the schedule on wall time, so a backgrounded host tab still runs the room
  useEffect(() => {
    if (!isOnline || !online?.isHost) return;
    const id = window.setInterval(hostTick, 100);
    return () => window.clearInterval(id);
  }, [isOnline, online?.isHost]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s.endless) shell.setScore(0);
    return () => shell.setScore(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toArena = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = r.width / (e.currentTarget.offsetWidth || r.width);
    const px = (e.clientX - r.left) / k;
    const py = (e.clientY - r.top) / k;
    let x = ((px - s.arena.x) / s.arena.s) * 100;
    const y = ((py - s.arena.y) / s.arena.s) * 100;
    if (s.L?.cursedMe && s.L.curse === 'flip') x = 100 - x;
    return { x, y };
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!live || shell.status !== 'playing' || s.pointer !== null) return;
    const inst = s.L && active(s.L, s.clk);
    if (!inst) return;
    s.pointer = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toArena(e);
    inst.down?.(p.x, p.y);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const inst = s.L && active(s.L, s.clk);
    if (!inst) return;
    if (s.pointer !== null && e.pointerId !== s.pointer) return;
    if (s.pointer === null && e.pointerType !== 'mouse') return;
    const p = toArena(e);
    inst.move?.(p.x, p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== s.pointer) return;
    s.pointer = null;
    const inst = s.L && active(s.L, s.clk);
    const p = toArena(e);
    inst?.up?.(p.x, p.y);
  };

  const update = (dt: number) => {
    if (!live || s.finished) return;
    s.clk += dt;
    if (!isOnline) hostTick();
    else if (online?.isHost) hostTick();
    if (s.overAt >= 0 && s.clk >= s.overAt) {
      finish();
      return;
    }
    const L = s.L;
    if (!L) return;
    const flip = L.cursedMe && L.curse === 'flip';
    // keys: cursor games steer a pointer, direct games take the keys themselves
    const at = partAt(L, s.clk);
    const inst = active(L, s.clk);
    const now: Held = noKeys();
    for (const k of KEYS) now[k] = keys.down(k);
    if (at && at.index !== s.part) {
      s.part = at.index;
      s.cursor.x = 50;
      s.cursor.y = 60;
      s.held = noKeys();
      if (at.index > 0) sfx.tone({ freq: 660, to: 990, dur: 0.1, type: 'square', vol: 0.04 });
    }
    if (inst && at) {
      if (at.part.game.keys === 'cursor') {
        const dx = (now.right ? 1 : 0) - (now.left ? 1 : 0);
        const dy = (now.down ? 1 : 0) - (now.up ? 1 : 0);
        if (dx || dy) {
          const sp = 75 * dt;
          s.cursor.x = Math.max(0, Math.min(100, s.cursor.x + dx * sp * (flip ? -1 : 1)));
          s.cursor.y = Math.max(0, Math.min(100, s.cursor.y + dy * sp));
          s.cursor.at = s.clk;
          inst.move?.(s.cursor.x, s.cursor.y);
        }
        if (now.action && !s.held.action) {
          s.cursor.at = s.clk;
          inst.down?.(s.cursor.x, s.cursor.y);
        }
        if (!now.action && s.held.action) inst.up?.(s.cursor.x, s.cursor.y);
      } else {
        for (const k of KEYS) {
          if (now[k] && !s.held[k]) inst.press?.(mirrorKey(k, flip));
          if (!now[k] && s.held[k]) inst.release?.(mirrorKey(k, flip));
        }
      }
    }
    s.held = now;
    const decided = stepLocal(L, s.clk, dt, mirrorHeld(now, flip));
    if (decided) sendReport(decided === 'pass');
    if (s.endless) shellRef.current.setScore(passedOf(s) + (L.outcome === 'pass' && !s.res ? 1 : 0));
  };

  const playBeat = (v: BeatVoice, delay: number, len: number) => {
    if (v.kind === 'kick') sfx.tone({ freq: 150, to: 42, dur: 0.16, type: 'sine', vol: 0.2, delay });
    else if (v.kind === 'snare') sfx.noise(0.08, 0.06, delay);
    else if (v.kind === 'hat') sfx.noise(0.02, 0.014, delay);
    else if (v.kind === 'bass') sfx.tone({ freq: v.freq, dur: len * 1.6, type: 'triangle', vol: 0.12, delay });
    else sfx.tone({ freq: v.freq, dur: len * 0.8, type: 'square', vol: 0.02, delay });
  };

  const render = () => {
    const c = ctx();
    const { w, h } = size;
    if (!c || !w || !h) return;
    if (layoutScale.current.w !== w || layoutScale.current.h !== h) {
      const parent = ref.current?.parentElement;
      const raw = parent ? getComputedStyle(parent).getPropertyValue('--g-dead-week-u').trim() : '';
      const parsed = Number.parseFloat(raw);
      layoutScale.current = { w, h, u: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 };
    }
    const u = layoutScale.current.u;
    const L = s.L;
    const tier = L?.plan.tier ?? 0;
    s.beat.tick(live && !s.finished && shell.status === 'playing' ? sfx.clock() : null, tier, playBeat);
    const shakeOn = L && L.cursedMe && L.curse === 'quiz' && L.outcome === 'pending' && elapsed(L, s.clk) > L.cmd * 0.5;
    c.save();
    paper(c, w, h, s.clk * 6);
    if (shakeOn) c.translate(Math.sin(s.clk * 47) * 5, Math.cos(s.clk * 39) * 4);
    const ghost = amGhost() || (isOnline && !!online?.watching) || (!!L && !L.playing);
    const top = TOP * u;
    const hud = HUD * u;
    const hintHeight = HINT * u;
    const ghostBoard = ghost ? Math.min(150 * u, h * 0.3) : 0;
    const topGap = 14 * u;
    const hintGap = 8 * u;
    const bottomGap = 8 * u;
    const arenaTop = top + topGap;
    const arenaBottom = h - hud - bottomGap - ghostBoard - hintGap - hintHeight;
    const available = Math.max(60 * u, arenaBottom - arenaTop);
    const side = Math.max(60 * u, Math.min(w - 20 * u, available));
    const ax = (w - side) / 2;
    const ay = arenaTop + Math.max(0, (available - side) / 2);
    s.arena = { x: ax, y: ay, s: side };
    drawHud(c, w, h, u, s);
    if (!live) {
      drawWord(c, w / 2, h / 2, 'dead week', Math.min(w * 0.12, 72), 0);
    } else if (L) {
      const e = elapsed(L, s.clk);
      const view = shown(L, s.clk);
      const flip = L.cursedMe && L.curse === 'flip';
      if (L.playing) {
        if (!view.part.inst) view.part.inst = view.part.game.create(mix(L.plan.seed, L.n, view.index, 3), L.plan.difficulty);
        c.save();
        c.beginPath();
        c.roundRect(ax, ay, side, side, side * 0.03);
        c.clip();
        c.fillStyle = PAPER;
        c.fillRect(ax, ay, side, side);
        c.translate(ax, ay);
        c.scale(side / 100, side / 100);
        if (flip) {
          c.translate(100, 0);
          c.scale(-1, 1);
        }
        view.part.inst.render(c, view.t);
        c.restore();
        // the keyboard cursor, when keys are steering it
        if (view.part.game.keys === 'cursor' && s.clk - s.cursor.at < 1.5 && active(L, s.clk)) {
          const cx = ax + ((flip ? 100 - s.cursor.x : s.cursor.x) / 100) * side;
          const cy = ay + (s.cursor.y / 100) * side;
          c.lineWidth = 3;
          c.strokeStyle = CARDINAL;
          c.beginPath();
          c.arc(cx, cy, 10, 0, Math.PI * 2);
          c.moveTo(cx - 16, cy);
          c.lineTo(cx + 16, cy);
          c.moveTo(cx, cy - 16);
          c.lineTo(cx, cy + 16);
          c.stroke();
        }
        c.lineWidth = Math.max(3, side * 0.012);
        c.strokeStyle = INK;
        c.beginPath();
        c.roundRect(ax, ay, side, side, side * 0.03);
        c.stroke();
        // time left in this part
        if (e >= L.cmd && L.outcome === 'pending') {
          const left = 1 - (e - view.part.from) / (view.part.to - view.part.from);
          c.save();
          c.translate(ax, ay - 2);
          c.scale(side / 100, side / 100);
          fuse(c, 30, 1.5, 40, 3, Math.max(0, left));
          c.restore();
        }
        if (L.plan.boss) {
          const label = `final exam ${Math.min(view.index + 1, 3)}/3`;
          text(c, label, ax + side - 8 * u, ay - 9 * u, 13 * u, { align: 'right', weight: 800, color: CARDINAL });
        }
        const hint = s.L && view.part.game.hint;
        if (hint && !ghost) text(c, shell.touch ? hint.touch : hint.keys, w / 2, ay + side + hintGap + hintHeight / 2, 13 * u, { weight: 700, color: '#5a5560' });
      }
      // command flash (and a decoy before it)
      const size2 = Math.min(w * 0.15, h * 0.16, 110);
      const cy = ay + side * 0.45;
      if (e < L.cmd) {
        const k = Math.min(1, e / 0.12);
        if (L.decoy && e < 0.6) {
          drawWord(c, w / 2, cy, L.decoy, size2 * (0.7 + 0.3 * k), e);
          if (!L.cursedMe) text(c, 'decoy for the leader', w / 2, cy + size2 * 0.75, 15, { weight: 800, color: CARDINAL });
        } else {
          const ce = L.decoy ? e - 0.6 : e;
          const kk = Math.min(1, ce / 0.12);
          if (L.plan.boss) {
            drawWord(c, w / 2, cy - size2 * 0.3, 'final exam!', size2 * 0.85 * (0.7 + 0.3 * kk), ce);
            text(c, L.parts.map((p) => p.game.command).join('  then  '), w / 2, cy + size2 * 0.55, Math.min(20, w / 28), { weight: 800 });
          } else drawWord(c, w / 2, cy, L.parts[0].game.command, size2 * (0.7 + 0.3 * kk), ce);
          if (L.cursedMe && L.curse) text(c, `cursed: ${CURSE_NAMES[L.curse]}!`, w / 2, cy + size2 * 0.95, 16, { weight: 800, color: CARDINAL });
        }
      } else if (L.plan.boss && L.playing && view.t < 0.55 && view.index > 0 && L.outcome === 'pending') {
        drawWord(c, w / 2, ay + side * 0.2, view.part.game.command, size2 * 0.6, view.t);
      }
      if (L.playing && L.outcome !== 'pending' && L.decidedAt >= 0) drawStamp(c, w / 2, ay + side * 0.5, side, L.outcome === 'pass', s.clk - L.decidedAt);
      if (!L.playing && e >= L.cmd && !s.res) {
        const v = shown(L, s.clk);
        text(c, `everyone is playing: ${v.part.game.title}`, w / 2, ay + 22 * u, 15 * u, { weight: 800 });
        c.save();
        c.translate(w / 2 - 80 * u, ay + 38 * u);
        fuse(c, 0, 0, 160 * u, 10 * u, Math.max(0, 1 - (e - L.cmd) / (L.end - L.cmd)));
        c.restore();
      }
    } else if (s.clk < s.introUntil) {
      const k = Math.min(1, s.clk / 0.3);
      drawWord(c, w / 2, h * 0.42, 'dead week', Math.min(w * 0.13, 96) * (0.6 + 0.4 * k), s.clk);
      text(c, s.endless ? 'four coffees. how long can you last?' : 'four coffees. last student awake wins.', w / 2, h * 0.42 + Math.min(w * 0.1, 80), 17, { weight: 800 });
    }
    c.restore();
  };
  useGameLoop(update, render);

  const L = s.L;
  const ghost = live && (amGhost() || (isOnline && !!online?.watching) || (!!L && !L.playing));
  const showResults = live && !!s.res && !s.finished && s.clk - s.resAt < resultsTime(L?.plan.tier ?? 0) + 0.4;
  const showTiles = live && !s.endless && (showResults || ghost);
  const leaderSet = new Set(s.gp?.cursed ?? []);
  const tileStatus = (e: Standing): 'pass' | 'fail' | 'wait' | null => {
    if (e.p >= 0 && !(s.res && s.res.elim.includes(e.s))) return null;
    if (s.res) {
      const r = s.res.res.find(([seat]) => seat === e.s);
      return r ? (r[1] ? 'pass' : 'fail') : null;
    }
    if (!L) return null;
    if (e.b && L) {
      const at = L.cmd + botRevealAt(L.plan.seed, L.n, e.s) * (L.end - L.cmd);
      if (elapsed(L, s.clk) < at) return 'wait';
      return botPasses(L.plan.seed, L.n, e.s, skillOf(e.nm, e.s), L.plan.tier, L.plan.boss) ? 'pass' : 'fail';
    }
    const d = s.done.get(e.s);
    return d === undefined ? 'wait' : d ? 'pass' : 'fail';
  };

  return (
    <div className="g-dead-week-root">
      <canvas ref={ref} className="g-dead-week-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()} />
      {showTiles && (
        <div className={`g-dead-week-board${showResults ? ' is-results' : ' is-ghost'}`}>
          {showResults && s.res && (
            <div className="g-dead-week-banner">
              {s.res.shared ? 'everyone failed. sudden death!' : s.res.elim.length ? `${s.res.elim.map((x) => s.st.find((e) => e.s === x)?.nm ?? '?').join(', ')} fell asleep` : s.res.lost.length ? `${s.res.lost.length} spilled a coffee` : 'everyone passed'}
              {s.res.sudden && !s.res.shared && <b> sudden death</b>}
            </div>
          )}
          <div className="g-dead-week-tiles">
            {s.st.map((e) => {
              const status = tileStatus(e);
              const out = e.p >= 0;
              return (
                <div key={e.s} className={`g-dead-week-tile${out ? ' is-out' : ''}${e.s === s.me ? ' is-you' : ''}${status ? ` is-${status}` : ''}`}>
                  <span className="g-dead-week-name">{e.nm}{e.s === s.me ? ' (you)' : ''}</span>
                  <span className="g-dead-week-cups" aria-label={`${e.l} coffees`}>
                    {out ? <em>{e.x ? 'left' : `${ordinal(e.p)}`}</em> : Array.from({ length: LIVES }, (_, i) => <i key={i} className={i < e.l ? 'is-full' : ''} />)}
                  </span>
                  {status && status !== 'wait' && <span className="g-dead-week-mark">{status === 'pass' ? 'passed' : 'failed'}</span>}
                  {status === 'wait' && <span className="g-dead-week-mark is-wait">...</span>}
                  {!out && leaderSet.has(e.s) && s.gp?.curse && !s.res && <span className="g-dead-week-curse">{CURSE_NAMES[s.gp.curse]}</span>}
                </div>
              );
            })}
          </div>
          {amGhost() && !s.finished && !(s.res?.over) && (
            <div className="g-dead-week-vote">
              <span>you're a ghost. curse the leader:</span>
              <div>
                {CURSES.map((cu, i) => (
                  <button key={cu} type="button" className={s.myVote === cu ? 'is-picked' : ''} onClick={() => castVote(cu)} onPointerDown={(e) => e.stopPropagation()}>
                    <b>{CURSE_NAMES[cu]}</b>
                    <small>{CURSE_NOTES[cu]}</small>
                    {s.votes[i] > 0 && <em>{s.votes[i]}</em>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const passedOf = (s: Sim) => {
  const meE = s.dir?.royale.entrants.find((e) => e.seat === s.me);
  return meE?.passed ?? 0;
};

function drawHud(c: CanvasRenderingContext2D, w: number, h: number, u: number, s: Sim) {
  const me = s.st.find((e) => e.s === s.me);
  const L = s.L;
  c.save();
  const y = h - 22 * u;
  // coffee cups
  if (me) {
    for (let i = 0; i < LIVES; i++) {
      const x = (14 + i * 30) * u;
      const spilling = i === me.l && s.clk - s.spillAt < 1.4;
      const full = i < me.l;
      c.save();
      c.translate(x + 10 * u, y);
      if (spilling) c.rotate(Math.min(1.5, (s.clk - s.spillAt) * 5));
      c.scale(u, u);
      drawCup(c, full || spilling, me.p >= 0);
      c.restore();
      if (spilling) {
        const k = Math.min(1, (s.clk - s.spillAt) * 3);
        c.fillStyle = BROWN;
        c.globalAlpha = 1 - Math.max(0, (s.clk - s.spillAt - 0.8) / 0.6);
        c.beginPath();
        c.ellipse(x + 22 * u, y + 6 * u, (4 + k * 14) * u, (2 + k * 3) * u, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
    }
  }
  const n = L ? L.n + 1 : 0;
  const tier = L?.plan.tier ?? 0;
  const label = n ? `game ${n}  ·  speed ${tier + 1}` : '';
  if (label) text(c, label, w / 2, y, 13 * u, { weight: 800 });
  const sudden = s.res ? s.res.sudden : s.gp?.sudden;
  if (sudden) {
    highlight(c, w - 128 * u, h - 34 * u, 118 * u, 22 * u, PINK, 0.8);
    text(c, 'sudden death', w - 69 * u, y, 14 * u, { weight: 900, color: CARDINAL });
  } else if (me && me.p >= 0 && !s.endless) {
    highlight(c, w - 92 * u, h - 34 * u, 82 * u, 22 * u, GREEN, 0.6);
    text(c, 'ghost', w - 51 * u, y, 14 * u, { weight: 900 });
  }
  c.restore();
}


function drawCup(c: CanvasRenderingContext2D, full: boolean, out: boolean) {
  c.lineWidth = 2.4;
  c.strokeStyle = INK;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(-9, -12);
  c.lineTo(9, -12);
  c.lineTo(7, 10);
  c.lineTo(-7, 10);
  c.closePath();
  c.fillStyle = out ? '#ddd' : full ? WHITE : '#eee';
  c.fill();
  if (full) {
    c.save();
    c.clip();
    c.fillStyle = BROWN;
    c.fillRect(-10, -8, 20, 20);
    c.restore();
  }
  c.stroke();
  c.fillStyle = CARDINAL;
  c.fillRect(-8, -16, 16, 4);
  c.strokeRect(-8, -16, 16, 4);
  c.beginPath();
  c.arc(9, 0, 4, -1.2, 1.2);
  c.stroke();
}

/** The huge hand-lettered command word: wobbly marker letters over a highlighter swash. */
function drawWord(c: CanvasRenderingContext2D, x: number, y: number, word: string, size: number, t: number) {
  c.save();
  c.font = `900 ${size}px ${DISPLAY}`;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const widths = [...word].map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  highlight(c, x - total / 2 - size * 0.15, y - size * 0.32, total + size * 0.3, size * 0.62, YELLOW, 0.85);
  let cx = x - total / 2;
  [...word].forEach((ch, i) => {
    c.save();
    c.translate(cx + widths[i] / 2, y + Math.sin(i * 1.9 + t * 14) * size * 0.04);
    c.rotate(Math.sin(i * 2.7 + t * 9) * 0.07);
    c.lineJoin = 'round';
    c.lineWidth = size * 0.12;
    c.strokeStyle = INK;
    c.textAlign = 'center';
    c.strokeText(ch, 0, 0);
    c.fillStyle = i % 2 ? CARDINAL : '#b01c1c';
    c.fillText(ch, 0, 0);
    c.restore();
    cx += widths[i];
  });
  c.restore();
}

function drawStamp(c: CanvasRenderingContext2D, x: number, y: number, side: number, pass: boolean, t: number) {
  const k = Math.min(1, t / 0.14);
  const scale = 1.9 - 0.9 * k;
  c.save();
  c.translate(x, y);
  c.rotate(pass ? -0.16 : 0.14);
  c.scale(scale, scale);
  c.globalAlpha = Math.min(1, k * 1.5) * 0.92;
  const w = side * 0.5;
  const h = side * 0.17;
  const color = pass ? '#1d8a3a' : CARDINAL;
  rect(c, -w / 2, -h / 2, w, h, pass ? 'rgba(124,240,138,0.35)' : 'rgba(255,127,207,0.3)', h * 0.18, h * 0.08);
  c.lineWidth = h * 0.07;
  c.strokeStyle = color;
  c.strokeRect(-w / 2 + h * 0.1, -h / 2 + h * 0.1, w - h * 0.2, h - h * 0.2);
  text(c, pass ? 'passed' : 'failed', 0, 0, h * 0.62, { color, weight: 900 });
  c.restore();
}

