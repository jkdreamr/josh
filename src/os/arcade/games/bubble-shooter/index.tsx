import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { NEXT, NEXT_R, PALETTE, draw, fitField, toField, type View } from './draw';
import { R, SHOOTER, aimAt, clampAim, createGame, fire, step, swap, traceAim } from './logic';
import { meta } from './meta';
import './bubble-shooter.css';

const AIM_SPEED = 1.7;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

type Round = View & { armed: number | null; overIn: number; reported: boolean };

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const round = useRef<Round>({
    game: createGame(),
    aim: Math.PI / 2,
    guide: null,
    particles: [],
    popping: [],
    falling: [],
    texts: [],
    shake: 0,
    kick: 0,
    swapAnim: 0,
    banner: null,
    hint: null,
    calm: false,
    armed: null,
    overIn: -1,
    reported: false,
  }).current;
  const playing = shell.status === 'playing';

  useEffect(() => {
    round.calm = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    round.hint = shell.touch ? 'Drag to aim, let go to shoot' : 'Click to shoot';
    round.guide = traceAim(round.game, round.aim);
    shell.invalidate();
  }, [round, shell.touch, shell.invalidate]);

  const shoot = () => {
    if (!playing) return;
    fire(round.game, round.aim);
  };
  const trySwap = () => {
    if (!playing) return;
    swap(round.game);
  };

  useGameLoop(
    (dt) => {
      const g = round.game;
      const turn = keys.axis('left', 'right');
      if (turn) round.aim = clampAim(round.aim - turn * AIM_SPEED * dt);
      if (keys.pressed('up', 'action')) fire(g, round.aim);
      if (keys.pressed('down', 'KeyX')) swap(g);

      step(g, dt);
      let drops = 0;
      for (const e of g.effects.splice(0)) {
        if (e.type === 'fire') {
          round.kick = 0.16;
          sfx.tone({ freq: 380, to: 760, dur: 0.09, type: 'sine', vol: 0.16 });
        } else if (e.type === 'bounce') {
          sfx.tone({ freq: 980, dur: 0.035, type: 'sine', vol: 0.07 });
          spark(round, e.x, e.y, 'rgba(255,255,255,0.9)', 5, 60);
        } else if (e.type === 'stick') {
          sfx.play('blip', 0.85 + Math.random() * 0.1);
        } else if (e.type === 'pop') {
          const delay = e.i * 0.035;
          round.popping.push({ x: e.x, y: e.y, color: e.color, delay, t: 0 });
          spark(round, e.x, e.y, PALETTE[e.color].light, 8, 120, delay);
          sfx.tone({ freq: 520 + Math.min(e.i, 14) * 42, to: 900 + Math.min(e.i, 14) * 60, dur: 0.07, type: 'triangle', vol: 0.12, delay });
        } else if (e.type === 'drop') {
          drops++;
          round.falling.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 90, vy: -80 - Math.random() * 90, color: e.color, t: 0 });
        } else if (e.type === 'combo') {
          round.texts.push({ x: e.x, y: e.y, text: `+${e.points.toLocaleString('en-US')}`, size: 15, color: '#fff', t: 0, life: 1 });
          if (e.n >= 2) {
            round.texts.push({ x: e.x, y: e.y - R * 1.6, text: `Combo ${e.n}`, size: 13 + Math.min(e.n, 6), color: '#ffd60a', t: 0, life: 1.1 });
            [0, 1, 2].forEach((k) => sfx.tone({ freq: 660 * Math.pow(1.26, k + Math.min(e.n, 6) * 0.2), dur: 0.08, type: 'sine', vol: 0.1, delay: 0.12 + k * 0.06 }));
          }
        } else if (e.type === 'ceiling') {
          round.shake = 0.35;
          sfx.play('hit', 0.6);
          sfx.noise(0.18, 0.12);
        } else if (e.type === 'level') {
          round.banner = { title: `Level ${e.level} Cleared`, detail: `+${e.bonus.toLocaleString('en-US')} Bonus` };
          sfx.play('win');
        } else if (e.type === 'swap') {
          round.swapAnim = 0.18;
          sfx.play('select');
        } else if (e.type === 'over') {
          round.overIn = 0.8;
          round.shake = 0.4;
          sfx.play('lose');
        }
      }
      if (drops) {
        sfx.play('coin', drops > 6 ? 1.25 : 1);
        round.shake = Math.max(round.shake, Math.min(0.3, 0.08 + drops * 0.02));
      }

      for (const p of round.popping) p.t += dt;
      round.popping = round.popping.filter((p) => p.t - p.delay < 0.16);
      for (const f of round.falling) {
        f.t += dt;
        f.vy += 1500 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      }
      round.falling = round.falling.filter((f) => f.t < 1.4 && f.y < 700);
      round.particles = round.particles.filter((p) => {
        if (p.delay > 0) {
          p.delay -= dt;
          return true;
        }
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        return p.life > 0;
      });
      for (const t of round.texts) t.t += dt;
      round.texts = round.texts.filter((t) => t.t < t.life);
      round.shake = Math.max(0, round.shake - dt);
      round.kick = Math.max(0, round.kick - dt);
      round.swapAnim = Math.max(0, round.swapAnim - dt);
      if (g.levelBanner <= 0) round.banner = null;
      round.guide = traceAim(g, round.aim);
      shell.setScore(g.score);

      if (round.overIn >= 0) {
        round.overIn -= dt;
        if (round.overIn < 0 && !round.reported) {
          round.reported = true;
          const combo = g.bestCombo >= 2 ? ` with a best combo of ${g.bestCombo}` : '';
          shell.gameOver(g.score, { detail: `You reached level ${g.level}${combo}.` });
        }
      }
    },
    () => draw(ctx(), size.w, size.h, size.dpr, round),
  );

  const local = (e: RPointerEvent<HTMLCanvasElement>) => {
    // offsetX/Y are in the canvas's own coordinates, so this stays exact on the 3D-projected laptop screen.
    const fit = fitField(size.w, size.h);
    return { fit, p: toField(fit, e.nativeEvent.offsetX, e.nativeEvent.offsetY) };
  };
  const onLauncher = (fit: ReturnType<typeof fitField>, x: number, y: number) => {
    const reach = (r: number) => Math.max(r * fit.scale, 24) / fit.scale;
    return Math.hypot(x - NEXT.x, y - NEXT.y) <= reach(NEXT_R + 6) || Math.hypot(x - SHOOTER.x, y - SHOOTER.y) <= reach(R + 7);
  };
  const aimTo = (x: number, y: number) => {
    round.aim = aimAt(SHOOTER, { x, y });
    round.guide = traceAim(round.game, round.aim);
  };

  return (
    <canvas
      ref={ref}
      className="g-bubble-shooter-canvas"
      onPointerMove={(e) => {
        if (!playing) return;
        if (e.pointerType !== 'mouse' && round.armed !== e.pointerId) return;
        const { p } = local(e);
        if (p.y < SHOOTER.y - R * 0.5) aimTo(p.x, p.y);
      }}
      onPointerDown={(e) => {
        if (!playing || e.button > 0) return;
        e.preventDefault();
        const { fit, p } = local(e);
        if (onLauncher(fit, p.x, p.y)) {
          trySwap();
          return;
        }
        e.currentTarget.setPointerCapture?.(e.pointerId);
        round.armed = e.pointerId;
        if (p.y < SHOOTER.y - R * 0.5) aimTo(p.x, p.y);
      }}
      onPointerUp={(e) => {
        if (round.armed !== e.pointerId) return;
        round.armed = null;
        const { p } = local(e);
        if (p.y < SHOOTER.y - R * 0.5) {
          aimTo(p.x, p.y);
          shoot();
        }
      }}
      onPointerCancel={() => {
        round.armed = null;
      }}
      onLostPointerCapture={() => {
        round.armed = null;
      }}
    />
  );
}

function spark(round: Round, x: number, y: number, color: string, count: number, speed: number, delay = 0) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const s = speed * (0.5 + Math.random() * 0.6);
    const life = 0.28 + Math.random() * 0.2;
    round.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: 1.6 + Math.random() * 1.8, color, delay });
  }
}
