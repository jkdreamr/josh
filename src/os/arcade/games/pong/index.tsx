import { useEffect, useRef } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { BALL_R, BASE_SPEED, COURT, KEY_SPEED, MAX_SPEED, PADDLE, SERVE_DELAY, WIN_SCORE, aiStep, clamp, createAi, createMatch, extrapolateBall, mergeGuestSnapshot, movePaddle, other, paddleX, steerPaddle, step, type AiLevel, type PongEvent, type Side } from './pong';
import './pong.css';

const MODE = defineSetting('pong:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('pong:level', LEVEL_NAMES, 'normal');
const P_COLORS = ['#0a84ff', '#ff375f'] as const;
const FONT = 'Inter, -apple-system, system-ui, sans-serif';
const POINTER_SPEED = 420;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} formatScore={(n) => `${n} hit rally`} setup={<Setup />}>
      <Pong />
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

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number };
/** Court-to-screen mapping. In portrait windows the court turns so the paddles sit at the bottom (you) and top. */
type View = { ox: number; oy: number; s: number; portrait: boolean };
type Box = { x: number; y: number; w: number; h: number };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function toScreen(v: View, x: number, y: number) {
  return v.portrait ? { x: v.ox + y * v.s, y: v.oy + (COURT.w - x) * v.s } : { x: v.ox + x * v.s, y: v.oy + y * v.s };
}
function toCourt(v: View, sx: number, sy: number) {
  return v.portrait ? { x: COURT.w - (sy - v.oy) / v.s, y: (sx - v.ox) / v.s } : { x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s };
}
/** Position of an element in the shell's own (untransformed) layout pixels. */
function layoutBox(el: HTMLElement, root: HTMLElement): Box | null {
  if (!el.offsetWidth) return null;
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return n === root ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};

function Pong() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const st = useRef({
    mode: getSetting(MODE),
    level: levelIndex(getSetting(LEVEL)) as AiLevel,
    match: createMatch(Math.random() < 0.5 ? 0 : 1),
    ai: createAi(),
    particles: [] as Particle[],
    trail: [] as { x: number; y: number }[],
    hit: [0, 0],
    pop: [0, 0],
    goal: { side: 0 as Side, t: 0 },
    flash: 0,
    flashColor: '#fff',
    shake: 0,
    longest: 0,
    ending: -1,
    pointers: new Map<number, { side: Side; y: number }>(),
    hover: null as { side: Side; y: number } | null,
    mouseAt: 0,
    keyAt: 0,
    remoteTarget: null as number | null,
    ballErr: { x: 0, y: 0 },
    sendAt: 0,
    snapshotAt: 0,
    view: { ox: 0, oy: 0, s: 1, portrait: false } as View,
    /** Shell chrome over the canvas (control pill, online badge) in layout pixels. */
    covers: [] as Box[],
    /** 1 / on-screen scale of the frame, so text stays readable inside the laptop and iPad frames. */
    u: 1,
    measureIn: 0,
    reduced: reducedMotion(),
    ended: false,
  }).current;

  // Setup changes made on the Start card apply to the match that is about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    st.mode = online ? '2p' : mode;
    st.level = levelIndex(levelName) as AiLevel;
    st.match = createMatch(Math.random() < 0.5 ? 0 : 1);
    st.ai = createAi();
    st.remoteTarget = null;
    st.sendAt = 0;
    st.snapshotAt = 0;
    st.ended = false;
    shell.invalidate();
  }, [mode, levelName, shell.status, shell.invalidate, st, online?.seat]);

  const measure = () => {
    const root = shell.root.current;
    const el = ref.current;
    if (!root || !el) return;
    const k = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    st.u = clamp(Math.ceil(100 / (k || 1)) / 100, 1, 2);
    st.covers = [...root.querySelectorAll<HTMLElement>('.arcade-ctrl, .arcade-online-status')]
      .map((c) => layoutBox(c, root))
      .filter((b): b is Box => !!b);
  };

  useEffect(() => {
    measure();
    shell.invalidate();
    const t = window.setTimeout(() => {
      measure();
      shell.invalidate();
    }, 600);
    return () => window.clearTimeout(t);
  }, [size.w, size.h, shell.status, online?.transport]);

  useEffect(() => online?.onMessage((from, data) => {
    if (!online || !data || typeof data !== 'object') return;
    const message = data as { game?: unknown; type?: unknown; y?: unknown; match?: unknown; events?: unknown };
    if (message.game !== 'pong') return;
    if (online.seat === 0 && from !== 0 && message.type === 'paddle' && typeof message.y === 'number' && Number.isFinite(message.y)) {
      st.remoteTarget = message.y;
    } else if (online.seat !== 0 && from === 0 && message.type === 'snapshot' && message.match && typeof message.match === 'object') {
      const before = st.match.ball;
      // a spectator steers nothing, so both paddles are the host's
      const next = online.watching ? (message.match as typeof st.match) : mergeGuestSnapshot(st.match, message.match as typeof st.match);
      // Ease out the jump between our prediction and the host's ball, unless it just changed direction.
      const dx = before.x + st.ballErr.x - next.ball.x;
      const dy = before.y + st.ballErr.y - next.ball.y;
      const smooth = Math.sign(before.vx) === Math.sign(next.ball.vx) && next.serveIn <= 0 && Math.hypot(dx, dy) < 12;
      st.ballErr = smooth ? { x: dx, y: dy } : { x: 0, y: 0 };
      st.match = next;
    } else if (online.seat !== 0 && from === 0 && message.type === 'events' && Array.isArray(message.events)) {
      onEvents(message.events as PongEvent[]);
    }
  }), [online?.onMessage, online?.seat]);

  // Pointer input: finger or mouse steers a paddle. In 2P each half of the court owns a side.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetX/Y are in the canvas's own pixels, which stay right inside the scaled laptop and iPad frames.
    const at = (e: PointerEvent) => toCourt(st.view, e.offsetX, e.offsetY);
    const sideFor = (x: number): Side => online ? (online.seat === 0 ? 0 : 1) : st.mode === '2p' && x > COURT.w / 2 ? 1 : 0;
    const down = (e: PointerEvent) => {
      const c = at(e);
      st.pointers.set(e.pointerId, { side: sideFor(c.x), y: c.y });
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const c = at(e);
      const p = st.pointers.get(e.pointerId);
      if (p) p.y = c.y;
      else if (e.pointerType === 'mouse') {
        st.hover = { side: sideFor(c.x), y: c.y };
        st.mouseAt = performance.now();
      }
    };
    const up = (e: PointerEvent) => st.pointers.delete(e.pointerId);
    const leave = () => (st.hover = null);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      st.pointers.clear();
    };
  }, [ref, st, online?.seat]);

  const burst = (x: number, y: number, color: string, n: number, speed: number) => {
    if (st.reduced) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random());
      st.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.35, color, r: 0.5 + Math.random() * 0.9 });
    }
  };

  const onEvents = (evs: PongEvent[]) => {
    for (const e of evs) {
      if (e.kind === 'wall') {
        sfx.play('tick', 0.8);
        burst(e.x, e.y, 'rgba(255,255,255,0.8)', 5, 18);
      } else if (e.kind === 'paddle') {
        sfx.play('blip', 0.9 + Math.min(0.6, e.speed / 250));
        burst(e.x, e.y, P_COLORS[e.side], 10, 26);
        st.hit[e.side] = 1;
        st.longest = Math.max(st.longest, st.match.rally);
      } else if (e.kind === 'score') {
        sfx.play('hit', 0.9);
        st.flash = 0.4;
        st.flashColor = P_COLORS[e.side];
        st.goal = { side: other(e.side), t: 1 };
        st.pop[e.side] = 1;
        st.shake = st.reduced ? 0 : 0.25;
        burst(e.x, e.y, P_COLORS[e.side], 24, 40);
      } else if (e.kind === 'serve') sfx.play('select', 1.2);
      else if (e.kind === 'win') {
        st.ending = 0.9;
        const mine = online ? e.side === online.seat : st.mode !== 'cpu' || e.side === 0;
        sfx.play(mine ? 'win' : 'lose');
      }
    }
  };

  /** Short name: what the Game Over title uses, and the court label when the long one doesn't fit. */
  const nameFor = (side: Side) => {
    if (online) return side === online.seat ? 'You' : online.players.find((p) => p.seat === side)?.name ?? `Player ${side + 1}`;
    if (st.mode === 'cpu') return side === 0 ? 'You' : 'Computer';
    return `Player ${side + 1}`;
  };
  /** Court label. Online, each side is the person playing it (a spectator, in mid-round, never saw the lobby set the mode). */
  const labelFor = (side: Side) => {
    if (online) {
      const name = online.players.find((player) => player.seat === side)?.name ?? `Player ${side + 1}`;
      return side === online.seat ? `${name} (You)` : name;
    }
    if (side === 1 && st.mode === 'cpu') return `Computer · ${levelLabel(LEVEL_NAMES[st.level])}`;
    return nameFor(side);
  };

  useGameLoop(
    (dt) => {
      if (dt <= 0) return;
      const m = st.match;
      const now = performance.now();
      const guest = !!online && online.seat !== 0;
      const sides: Side[] = online?.watching ? [] : guest ? [1] : online ? [0] : st.mode === '2p' ? [0, 1] : [0];
      st.sendAt += dt;
      st.snapshotAt += dt;
      st.measureIn -= dt;
      if (st.measureIn <= 0) {
        st.measureIn = 0.5;
        measure();
      }
      const portrait = st.view.portrait;
      // Keyboard: one player uses either cluster, two local players split W/S and the arrows.
      // In a portrait court the paddle runs left to right, so the side keys move it too.
      for (const side of sides) {
        const local2p = st.mode === '2p' && !online;
        const along = local2p
          ? (keys.down(side === 0 ? 'KeyS' : 'ArrowDown') || (portrait && keys.down(side === 0 ? 'KeyD' : 'ArrowRight')) ? 1 : 0) -
            (keys.down(side === 0 ? 'KeyW' : 'ArrowUp') || (portrait && keys.down(side === 0 ? 'KeyA' : 'ArrowLeft')) ? 1 : 0)
          : clamp(keys.axis('up', 'down') + (portrait ? keys.axis('left', 'right') : 0), -1, 1);
        if (along !== 0) st.keyAt = now;
        const held = [...st.pointers.values()].find((p) => p.side === side);
        const hover = st.hover?.side === side && st.mouseAt > st.keyAt ? st.hover : null;
        const target = held ?? hover;
        if (target) steerPaddle(m.paddles[side], target.y, dt, POINTER_SPEED);
        else if (along !== 0) movePaddle(m.paddles[side], along * KEY_SPEED * dt, dt);
        else m.paddles[side].vy *= Math.max(0, 1 - dt * 14);
      }
      if (guest && !online!.watching && st.sendAt >= 0.05) {
        online!.send({ game: 'pong', type: 'paddle', y: m.paddles[1].y }, { fast: true });
        st.sendAt %= 0.05;
      }
      if (online && online.seat === 0) {
        if (st.remoteTarget !== null) steerPaddle(m.paddles[1], st.remoteTarget, dt, POINTER_SPEED);
        else m.paddles[1].vy *= Math.max(0, 1 - dt * 14);
      } else if (!online && st.mode === 'cpu') aiStep(m, 1, st.level, st.ai, dt);
      if (!guest) {
        const events = step(m, dt);
        onEvents(events);
        if (online?.seat === 0 && events.length) online.send({ game: 'pong', type: 'events', events });
        if (online?.seat === 0 && st.snapshotAt >= 0.05) {
          online.send({ game: 'pong', type: 'snapshot', match: m }, { fast: true });
          st.snapshotAt %= 0.05;
        }
      } else extrapolateBall(m, dt);
      const decay = Math.exp(-dt * 12);
      st.ballErr.x *= decay;
      st.ballErr.y *= decay;

      if (m.serveIn <= 0 && m.winner === null) {
        st.trail.push({ x: m.ball.x + st.ballErr.x, y: m.ball.y + st.ballErr.y });
        if (st.trail.length > 16) st.trail.shift();
      } else st.trail.length = 0;

      for (const p of st.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
      }
      st.particles = st.particles.filter((p) => p.life < p.max);
      for (const side of [0, 1] as Side[]) {
        st.hit[side] = Math.max(0, st.hit[side] - dt * 6);
        st.pop[side] = Math.max(0, st.pop[side] - dt * 2.5);
      }
      st.goal.t = Math.max(0, st.goal.t - dt * 1.6);
      st.flash = Math.max(0, st.flash - dt);
      st.shake = Math.max(0, st.shake - dt);

      if (m.winner !== null && st.ending >= 0) {
        st.ending -= dt;
        if (st.ending < 0 && !st.ended) {
          st.ended = true;
          const w = m.winner;
          const title = online ? (online.seat === w ? 'You Win' : `${nameFor(w)} Wins`) : st.mode === 'cpu' ? (w === 0 ? 'You Win' : 'Computer Wins') : `Player ${w + 1} Wins`;
          const loser = other(w);
          if (online) online.reportResult(online.round, w);
          shell.gameOver(online ? undefined : st.longest, { title, detail: `${m.score[w]} to ${m.score[loser]}. Longest rally: ${st.longest} ${st.longest === 1 ? 'hit' : 'hits'}.` });
        }
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      if (!w || !h) return;
      c.clearRect(0, 0, w, h);
      const m = st.match;
      const u = st.u;

      // Fit the court, turning it in tall windows, and keep it clear of the shell's control pill and online badge.
      const portrait = h > w * 1.15;
      const cw = portrait ? COURT.h : COURT.w;
      const ch = portrait ? COURT.w : COURT.h;
      const pad = Math.max(6, Math.min(w, h) * 0.04);
      const fit = (top: number, right = w) => {
        const s = Math.max(0.1, Math.min((right - pad * 2) / cw, (h - top - pad * 2) / ch));
        return { s, ox: (right - cw * s) / 2, oy: top + pad + (h - top - pad * 2 - ch * s) / 2 };
      };
      let f = fit(0);
      const hits = (b: Box) => b.x < f.ox + cw * f.s && b.x + b.w > f.ox && b.y < f.oy + ch * f.s && b.y + b.h > f.oy;
      const blockers = st.covers.filter(hits);
      if (blockers.length) {
        // Either drop the court below the chrome or slide it left of it, whichever keeps it bigger.
        const below = fit(Math.max(...blockers.map((b) => b.y + b.h)) + 2 - pad * 0.5);
        const pill = blockers.filter((b) => b.x > w * 0.4);
        const beside = pill.length === blockers.length ? fit(0, Math.min(...pill.map((b) => b.x)) - 2 + pad * 0.5) : below;
        f = beside.s > below.s * 1.08 ? beside : below;
      }
      let { ox, oy } = f;
      const s = f.s;
      if (st.shake > 0) {
        ox += (Math.random() - 0.5) * st.shake * 10;
        oy += (Math.random() - 0.5) * st.shake * 10;
      }
      const view: View = { ox, oy, s, portrait };
      st.view = view;

      c.save();
      if (portrait) {
        c.translate(ox, oy + COURT.w * s);
        c.scale(s, s);
        c.rotate(-Math.PI / 2);
      } else {
        c.translate(ox, oy);
        c.scale(s, s);
      }

      // Court: a dark table with each half faintly lit in its player's color.
      c.beginPath();
      c.roundRect(0, 0, COURT.w, COURT.h, 3);
      const wash = c.createLinearGradient(0, 0, COURT.w, 0);
      wash.addColorStop(0, 'rgba(10,132,255,0.10)');
      wash.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      wash.addColorStop(1, 'rgba(255,55,95,0.10)');
      c.fillStyle = wash;
      c.fill();
      c.lineWidth = 0.5;
      c.strokeStyle = 'rgba(255,255,255,0.10)';
      c.stroke();
      c.setLineDash([2.2, 2.6]);
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.beginPath();
      c.moveTo(COURT.w / 2, 3);
      c.lineTo(COURT.w / 2, COURT.h - 3);
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(255,255,255,0.06)';
      c.beginPath();
      c.arc(COURT.w / 2, COURT.h / 2, 12, 0, Math.PI * 2);
      c.stroke();

      // The edge that just let a point through glows in the scorer's color.
      if (st.goal.t > 0) {
        const left = st.goal.side === 0;
        const g = c.createLinearGradient(left ? 0 : COURT.w, 0, left ? 24 : COURT.w - 24, 0);
        const col = P_COLORS[other(st.goal.side)];
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalAlpha = st.goal.t * 0.55;
        c.fillStyle = g;
        c.fillRect(left ? 0 : COURT.w - 24, 0, 24, COURT.h);
        c.globalAlpha = 1;
      }

      // Serve: the ball waits at center inside a closing ring.
      const live = m.winner === null && m.serveIn <= 0;
      if (m.serveIn > 0 && m.winner === null) {
        const t = clamp(m.serveIn / SERVE_DELAY, 0, 1);
        c.strokeStyle = `rgba(255,255,255,${0.35 * (1 - t) + 0.08})`;
        c.lineWidth = 0.6;
        c.beginPath();
        c.arc(COURT.w / 2, COURT.h / 2, BALL_R + 1 + t * 10, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 0.35 + 0.65 * (1 - t);
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(COURT.w / 2, COURT.h / 2, BALL_R, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }

      // The ball heats from white to amber as rallies speed it up.
      const speed = Math.hypot(m.ball.vx, m.ball.vy);
      const heat = clamp((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
      const ballColor = mix('#ffffff', '#ffc94a', heat);
      if (live && st.trail.length > 1) {
        c.lineCap = 'round';
        for (let i = 1; i < st.trail.length; i++) {
          const a = st.trail[i - 1];
          const b = st.trail[i];
          const k = i / st.trail.length;
          c.globalAlpha = k * 0.45;
          c.strokeStyle = ballColor;
          c.lineWidth = BALL_R * 2 * (0.25 + 0.75 * k);
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
        }
        c.globalAlpha = 1;
      }

      // Paddles flash and swell for a moment on contact.
      for (const side of [0, 1] as Side[]) {
        const p = m.paddles[side];
        const hit = st.hit[side];
        const pw = PADDLE.w * (1 + hit * 0.5);
        const x = paddleX(side) - pw / 2;
        c.shadowColor = P_COLORS[side];
        c.shadowBlur = (14 + hit * 16) * s;
        c.fillStyle = hit > 0 ? mix(P_COLORS[side], '#ffffff', hit * 0.6) : P_COLORS[side];
        c.beginPath();
        c.roundRect(x, p.y - PADDLE.h / 2, pw, PADDLE.h, pw / 2);
        c.fill();
        c.shadowBlur = 0;
      }

      if (live) {
        const bx = m.ball.x + st.ballErr.x;
        const by = m.ball.y + st.ballErr.y;
        c.shadowColor = ballColor;
        c.shadowBlur = (12 + heat * 10) * s;
        c.fillStyle = ballColor;
        c.beginPath();
        c.arc(bx, by, BALL_R, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
      }

      for (const p of st.particles) {
        c.globalAlpha = 1 - p.life / p.max;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.restore();

      // Text in screen pixels, upright in both orientations, never under 12px on screen.
      c.textBaseline = 'middle';
      const scorePx = clamp(Math.min(cw, ch) * s * 0.2, 22 * u, 84);
      const namePx = Math.max(12, Math.min(14, s * 4)) * u;
      for (const side of [0, 1] as Side[]) {
        const dir = side === 0 ? -1 : 1;
        const pop = st.pop[side];
        const at = toScreen(view, COURT.w / 2 + dir * (portrait ? 14 : 6), portrait ? COURT.h * 0.16 : 4 + (scorePx / s) * 0.55);
        c.font = `700 ${Math.round(scorePx * (1 + pop * 0.3))}px ${FONT}`;
        c.fillStyle = pop > 0 ? mix('#3a3f4c', P_COLORS[side], pop) : 'rgba(255,255,255,0.22)';
        c.textAlign = portrait ? 'center' : side === 0 ? 'right' : 'left';
        c.fillText(String(m.score[side]), at.x, at.y);
        let name = labelFor(side);
        c.font = `500 ${namePx}px ${FONT}`;
        c.fillStyle = 'rgba(255,255,255,0.42)';
        if (portrait) {
          const nx = at.x + c.measureText('00').width * (scorePx / namePx) * 0.5 + 10 * u;
          c.textAlign = 'left';
          if (nx + c.measureText(name).width < w - 4) c.fillText(name, nx, at.y);
          else if (nx + c.measureText(nameFor(side)).width < w - 4) c.fillText(nameFor(side), nx, at.y);
        } else {
          const ny = at.y + scorePx * 0.55 + namePx * 0.9;
          const room = (COURT.w / 2) * s - 10;
          if (c.measureText(name).width > room) name = nameFor(side);
          if (c.measureText(name).width <= room && ny < oy + COURT.h * s * 0.5) c.fillText(name, at.x, ny);
        }
      }

      // Rally count once it gets going, match point while the ball waits.
      const note = m.winner === null && m.serveIn > 0 && Math.max(...m.score) === WIN_SCORE - 1 ? 'Match Point' : live && m.rally >= 4 ? `Rally ${m.rally}` : '';
      if (note) {
        const px = Math.max(12, Math.min(15, s * 4.2)) * u;
        const at = portrait ? toScreen(view, COURT.w / 2, COURT.h * 0.82) : toScreen(view, COURT.w / 2, COURT.h);
        c.font = `600 ${px}px ${FONT}`;
        c.textAlign = 'center';
        c.fillStyle = note === 'Match Point' ? 'rgba(255,201,74,0.85)' : 'rgba(255,255,255,0.35)';
        c.fillText(note, at.x, portrait ? at.y - px : at.y - px);
      }

      if (st.flash > 0 && !st.reduced) {
        c.globalAlpha = st.flash * 0.18;
        c.fillStyle = st.flashColor;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
      }
    },
  );

  return <canvas ref={ref} className={`g-pong-canvas${shell.status === 'playing' ? ' is-playing' : ''}`} />;
}
