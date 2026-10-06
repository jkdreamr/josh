import { useEffect, useRef } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import { BALL_R, COURT, PADDLE, SERVE_DELAY, aiStep, createAi, createMatch, movePaddle, other, paddleX, steerPaddle, step, type AiLevel, type PongEvent, type Side } from './pong';
import './pong.css';

const MODE = defineSetting('pong:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('pong:level', LEVEL_NAMES, 'normal');
const P_COLORS = ['#0a84ff', '#ff375f'] as const;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} formatScore={(n) => `${n} hit rally`} setup={<Setup />}>
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
type View = { ox: number; oy: number; s: number };

function Pong() {
  const shell = useShell();
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
    flash: 0,
    flashColor: '#fff',
    shake: 0,
    longest: 0,
    ending: -1,
    pointers: new Map<number, { side: Side; y: number }>(),
    hover: null as { side: Side; y: number } | null,
    view: { ox: 0, oy: 0, s: 1 } as View,
    ended: false,
  }).current;

  // Setup changes made on the Start card apply to the match that is about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    st.mode = mode;
    st.level = levelIndex(levelName) as AiLevel;
    st.match = createMatch(Math.random() < 0.5 ? 0 : 1);
    st.ai = createAi();
    shell.invalidate();
  }, [mode, levelName, shell.status, shell.invalidate, st]);

  // Pointer input: finger or mouse y steers a paddle. In 2P each half of the court owns a side.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const toCourt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const { ox, oy, s } = st.view;
      return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
    };
    const sideFor = (x: number): Side => (st.mode === '2p' && x > COURT.w / 2 ? 1 : 0);
    const down = (e: PointerEvent) => {
      const c = toCourt(e);
      st.pointers.set(e.pointerId, { side: sideFor(c.x), y: c.y });
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const c = toCourt(e);
      const p = st.pointers.get(e.pointerId);
      if (p) p.y = c.y;
      else if (e.pointerType === 'mouse') st.hover = { side: sideFor(c.x), y: c.y };
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
  }, [ref, st]);

  const burst = (x: number, y: number, color: string, n: number, speed: number) => {
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
        st.longest = Math.max(st.longest, st.match.rally);
      } else if (e.kind === 'score') {
        sfx.play('hit', 0.9);
        st.flash = 0.55;
        st.flashColor = P_COLORS[e.side];
        st.shake = 0.3;
        burst(e.x, e.y, P_COLORS[e.side], 24, 40);
      } else if (e.kind === 'serve') sfx.play('select', 1.2);
      else if (e.kind === 'win') {
        st.ending = 0.9;
        sfx.play(st.mode === 'cpu' && e.side === 1 ? 'lose' : 'win');
      }
    }
  };

  useGameLoop(
    (dt) => {
      if (dt <= 0) return;
      const m = st.match;
      const sides: Side[] = st.mode === '2p' ? [0, 1] : [0];
      // Keyboard: 1P uses either cluster, 2P splits W/S and arrows.
      for (const side of sides) {
        const axis =
          st.mode === '2p'
            ? (keys.down(side === 0 ? 'KeyS' : 'ArrowDown') ? 1 : 0) - (keys.down(side === 0 ? 'KeyW' : 'ArrowUp') ? 1 : 0)
            : keys.axis('up', 'down');
        const target = [...st.pointers.values()].find((p) => p.side === side) ?? (st.hover?.side === side ? st.hover : null);
        if (target) steerPaddle(m.paddles[side], target.y, dt, 420);
        else if (axis !== 0) movePaddle(m.paddles[side], axis * 95 * dt, dt);
        else m.paddles[side].vy *= Math.max(0, 1 - dt * 14);
      }
      if (st.mode === 'cpu') aiStep(m, 1, st.level, st.ai, dt);
      onEvents(step(m, dt));

      if (m.serveIn <= 0 && m.winner === null) {
        st.trail.push({ x: m.ball.x, y: m.ball.y });
        if (st.trail.length > 14) st.trail.shift();
      } else st.trail.length = 0;

      for (const p of st.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
      }
      st.particles = st.particles.filter((p) => p.life < p.max);
      st.flash = Math.max(0, st.flash - dt);
      st.shake = Math.max(0, st.shake - dt);

      if (m.winner !== null && st.ending >= 0) {
        st.ending -= dt;
        if (st.ending < 0 && !st.ended) {
          st.ended = true;
          const w = m.winner;
          const title = st.mode === 'cpu' ? (w === 0 ? 'You Win' : 'Computer Wins') : `Player ${w + 1} Wins`;
          const loser = other(w);
          shell.gameOver(st.longest, { title, detail: `${m.score[w]} to ${m.score[loser]}. Longest rally: ${st.longest} ${st.longest === 1 ? 'hit' : 'hits'}.` });
        }
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      c.clearRect(0, 0, w, h);
      const pad = Math.min(w, h) * 0.06;
      const s = Math.min((w - pad * 2) / COURT.w, (h - pad * 2) / COURT.h);
      let ox = (w - COURT.w * s) / 2;
      let oy = (h - COURT.h * s) / 2;
      if (st.shake > 0) {
        ox += (Math.random() - 0.5) * st.shake * 10;
        oy += (Math.random() - 0.5) * st.shake * 10;
      }
      st.view = { ox, oy, s };
      const m = st.match;
      c.save();
      c.translate(ox, oy);
      c.scale(s, s);
      c.lineWidth = 0.5;

      // Court
      c.fillStyle = 'rgba(255,255,255,0.025)';
      c.beginPath();
      c.roundRect(0, 0, COURT.w, COURT.h, 3);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.stroke();
      c.setLineDash([2.2, 2.6]);
      c.strokeStyle = 'rgba(255,255,255,0.18)';
      c.beginPath();
      c.moveTo(COURT.w / 2, 3);
      c.lineTo(COURT.w / 2, COURT.h - 3);
      c.stroke();
      c.setLineDash([]);

      // Scores
      c.font = `600 ${22}px Inter, -apple-system, system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillText(String(m.score[0]), COURT.w / 2 - 22, 6);
      c.fillText(String(m.score[1]), COURT.w / 2 + 22, 6);

      // Serve ring
      if (m.serveIn > 0 && m.winner === null) {
        const t = m.serveIn / SERVE_DELAY;
        c.strokeStyle = `rgba(255,255,255,${0.25 * (1 - t) + 0.05})`;
        c.lineWidth = 0.6;
        c.beginPath();
        c.arc(COURT.w / 2, COURT.h / 2, 2 + t * 10, 0, Math.PI * 2);
        c.stroke();
      }

      // Trail
      for (let i = 0; i < st.trail.length; i++) {
        const t = st.trail[i];
        const a = (i / st.trail.length) * 0.35;
        c.fillStyle = `rgba(255,255,255,${a})`;
        c.beginPath();
        c.arc(t.x, t.y, BALL_R * (0.3 + 0.7 * (i / st.trail.length)), 0, Math.PI * 2);
        c.fill();
      }

      // Paddles
      for (const side of [0, 1] as Side[]) {
        const p = m.paddles[side];
        const x = paddleX(side) - PADDLE.w / 2;
        c.shadowColor = P_COLORS[side];
        c.shadowBlur = 14;
        c.fillStyle = P_COLORS[side];
        c.beginPath();
        c.roundRect(x, p.y - PADDLE.h / 2, PADDLE.w, PADDLE.h, 1.3);
        c.fill();
        c.shadowBlur = 0;
      }

      // Ball
      if (m.winner === null && m.serveIn <= 0) {
        c.shadowColor = 'rgba(255,255,255,0.9)';
        c.shadowBlur = 16;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(m.ball.x, m.ball.y, BALL_R, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
      }

      // Particles
      for (const p of st.particles) {
        c.globalAlpha = 1 - p.life / p.max;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.restore();

      // Names under the scores, in screen pixels so they stay readable at any size
      c.font = '500 12px Inter, -apple-system, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillText(st.mode === 'cpu' ? 'You' : 'Player 1', ox + (COURT.w / 2 - 22) * s, oy + 30 * s);
      c.fillText(st.mode === 'cpu' ? `Computer · ${levelLabel(LEVEL_NAMES[st.level])}` : 'Player 2', ox + (COURT.w / 2 + 22) * s, oy + 30 * s);

      if (st.flash > 0) {
        c.globalAlpha = st.flash * 0.35;
        c.fillStyle = st.flashColor;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
      }
    },
  );

  return <canvas ref={ref} className="g-pong-canvas" />;
}
