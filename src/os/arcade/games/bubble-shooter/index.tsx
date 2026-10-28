import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, getSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { NEXT, NEXT_R, draw, fitField, lightOf, toField, type View } from './draw';
import { LEVELS, LEVEL_IDS } from './levels';
import { R, ROW_H, SHOOTER, aimAt, clampAim, createGame, fire, mulberry32, step, swap, traceAim, type Mode } from './logic';
import { meta } from './meta';
import { loadProgress, recordClear, saveProgress, totalStars, unlocked } from './progress';
import './bubble-shooter.css';

const AIM_SPEED = 1.7;
const MODE = defineSetting<Mode>('bubble-shooter:mode', ['levels', 'endless'], 'levels');
const LEVEL = defineSetting('bubble-shooter:level', LEVEL_IDS, '1');
const MODES = [
  ['levels', 'Levels'],
  ['endless', 'Endless'],
] as const;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

/**
 * A phone or iPad frame is scaled down to fit the screen. Publish 1 / that scale as --g-bubble-shooter-u on the
 * shell root so the level buttons stay finger sized, and hand it to the canvas so its text stays readable.
 */
function useFrameScale(onScale?: (u: number) => void) {
  const { root, touch } = useShell();
  useEffect(() => {
    const el = root.current;
    if (!el || !touch) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const u = k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
        el.style.setProperty('--g-bubble-shooter-u', u.toFixed(3));
        onScale?.(u);
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
  }, [root, touch, onScale]);
}

function Star({ on }: { on: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className={`g-bubble-shooter-star${on ? ' is-on' : ''}`}>
      <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className="g-bubble-shooter-lock">
      <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v10H6z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  return (
    <>
      <Segmented label="Mode" value={mode} options={MODES} onChange={setMode} />
      {mode === 'levels' ? <LevelPicker /> : <small className="g-bubble-shooter-info">No shot limit. New rows push in faster and faster.</small>}
    </>
  );
}

/** One scrollable row of square level buttons, then a line about the pick. */
function LevelPicker() {
  const [level, setLevel] = useSetting(LEVEL);
  const prog = loadProgress();
  const rowRef = useRef<HTMLDivElement>(null);
  useFrameScale();
  useEffect(() => {
    rowRef.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);
  const def = LEVELS[LEVEL_IDS.indexOf(level)] ?? LEVELS[0];
  const stars = prog.stars[level] ?? 0;
  const total = totalStars(prog);
  return (
    <div className="arcade-field">
      <span>Level</span>
      <div className="g-bubble-shooter-strip" role="group" aria-label="Level" ref={rowRef}>
        {LEVEL_IDS.map((id, i) => {
          const locked = !unlocked(prog, id);
          const n = prog.stars[id] ?? 0;
          return (
            <button
              key={id}
              type="button"
              className={`g-bubble-shooter-pick${id === level ? ' is-on' : ''}`}
              aria-pressed={id === level}
              disabled={locked}
              title={`Level ${i + 1}, ${LEVELS[i].name}`}
              onClick={() => {
                if (id === level) return;
                sfx.play('select');
                setLevel(id);
              }}
            >
              <b>{i + 1}</b>
              {locked ? <Lock /> : n > 0 && <em>{'\u2022'.repeat(n)}</em>}
            </button>
          );
        })}
      </div>
      <small className="g-bubble-shooter-info">
        {def.name}, {def.shots} shots
        <em className="g-bubble-shooter-dots">{[0, 1, 2].map((i) => <Star key={i} on={i < stars} />)}</em>
        {total > 0 && <span>{total} of {LEVELS.length * 3} stars</span>}
      </small>
    </div>
  );
}

type Round = View & { armed: number | null; overIn: number; reported: boolean };

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const online = useOnline();
  const [levelSetting, setLevelSetting] = useSetting(LEVEL);
  const { ref, size, ctx } = useCanvas();
  const round = useRef<Round | null>(null);
  const roundKey = useRef('');
  // Play can mount before the room is known, so a guest's first round is rebuilt once useOnline() arrives
  const key = online ? `online#${online.round}` : 'local';
  if (round.current === null || roundKey.current !== key) {
    roundKey.current = key;
    // online races are always endless, on the same board for everyone in the room
    const mode: Mode = online ? 'endless' : getSetting(MODE);
    const level = mode === 'levels' ? Math.max(1, LEVEL_IDS.indexOf(getSetting(LEVEL)) + 1) : 1;
    const seed = online ? seedFrom(`${online.players.map((p) => p.name).join('|')}#${online.round}`) : undefined;
    round.current = {
      game: createGame({ mode, level, rng: seed !== undefined ? mulberry32(seed) : undefined }),
      aim: Math.PI / 2,
      guide: null,
      particles: [],
      popping: [],
      falling: [],
      texts: [],
      rings: [],
      slide: 0,
      shake: 0,
      kick: 0,
      swapAnim: 0,
      banner: null,
      hint: null,
      calm: false,
      u: round.current?.u ?? 1,
      touch: shell.touch,
      armed: null,
      overIn: -1,
      reported: false,
    };
  }
  const r0 = round.current;
  const playing = shell.status === 'playing';
  useFrameScale((u) => {
    r0.u = u;
    shell.invalidate();
  });

  useEffect(() => {
    r0.calm = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    r0.hint = shell.touch ? 'Drag to aim, let go to shoot' : 'Click to shoot';
    r0.touch = shell.touch;
    r0.guide = traceAim(r0.game, r0.aim);
    shell.invalidate();
  }, [r0, shell.touch, shell.invalidate]);

  const finish = () => {
    const g = r0.game;
    const combo = g.bestCombo >= 2 ? ` Best combo ${g.bestCombo}.` : '';
    if (g.mode === 'endless') {
      shell.gameOver(g.score, { detail: `You reached speed ${g.level} in ${g.shots} shots.${combo}` });
      return;
    }
    const def = g.def!;
    const label = `Level ${g.level}, ${def.name}`;
    if (g.outcome !== 'clear') {
      shell.gameOver(undefined, {
        title: g.outcome === 'shots' ? 'Out of Shots' : 'The Bubbles Reached the Line',
        detail: `${label}. ${g.score.toLocaleString('en-US')} points. Give it another go.`,
      });
      return;
    }
    const id = String(g.level);
    const prog = loadProgress();
    const first = !prog.stars[id];
    const better = recordClear(prog, id, g.stars, g.score);
    saveProgress(prog);
    // a first clear selects the next level, so Play Again moves on
    const nextDef = LEVELS[g.level];
    if (first && nextDef && levelSetting === id) setLevelSetting(String(g.level + 1));
    const starText = g.stars === 1 ? '1 star' : `${g.stars} stars`;
    const left = g.shotsLeft === 1 ? '1 shot' : `${g.shotsLeft} shots`;
    const hint = g.stars < 3 ? ` ${def.stars[g.stars - 1]} shots left earns ${g.stars + 1} stars.` : '';
    const next = first && nextDef ? ` Up next: ${nextDef.name}.` : !nextDef ? ' That was the last level. Try Endless.' : '';
    shell.gameOver(undefined, {
      title: better && !first ? 'New Best' : `${def.name} Cleared`,
      detail: `${starText} with ${left} left, ${g.score.toLocaleString('en-US')} points.${hint}${next}`,
    });
  };

  useGameLoop(
    (dt) => {
      const round = r0;
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
          const delay = Math.min(e.i, 24) * 0.035;
          round.popping.push({ x: e.x, y: e.y, color: e.color, delay, t: 0 });
          spark(round, e.x, e.y, lightOf(e.color), 8, 120, delay);
          sfx.tone({ freq: 520 + Math.min(e.i, 14) * 42, to: 900 + Math.min(e.i, 14) * 60, dur: 0.07, type: 'triangle', vol: 0.12, delay });
        } else if (e.type === 'drop') {
          drops++;
          round.falling.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 90, vy: -80 - Math.random() * 90, color: e.color, t: 0 });
        } else if (e.type === 'blast') {
          round.rings.push({ x: e.x, y: e.y, t: 0 });
          round.shake = Math.max(round.shake, 0.35);
          sfx.play('boom');
        } else if (e.type === 'thaw') {
          spark(round, e.x, e.y, '#e6f6ff', 7, 90);
          sfx.tone({ freq: 1500, to: 2200, dur: 0.06, type: 'sine', vol: 0.06 });
        } else if (e.type === 'rainbow') {
          round.texts.push({ x: NEXT.x, y: NEXT.y - NEXT_R * 2.4, text: 'Rainbow Bubble', size: 14, color: '#fff', t: 0, life: 1.4 });
          [0, 1, 2, 3].forEach((k) => sfx.tone({ freq: 523 * Math.pow(1.26, k), dur: 0.09, type: 'triangle', vol: 0.09, delay: 0.1 + k * 0.06 }));
        } else if (e.type === 'combo') {
          round.texts.push({ x: e.x, y: e.y, text: `+${e.points.toLocaleString('en-US')}`, size: 15, color: '#fff', t: 0, life: 1 });
          if (e.n >= 2) {
            round.texts.push({ x: e.x, y: e.y - R * 1.6, text: `Combo ${e.n}`, size: 13 + Math.min(e.n, 6), color: '#ffd60a', t: 0, life: 1.1 });
            [0, 1, 2].forEach((k) => sfx.tone({ freq: 660 * Math.pow(1.26, k + Math.min(e.n, 6) * 0.2), dur: 0.08, type: 'sine', vol: 0.1, delay: 0.12 + k * 0.06 }));
          }
        } else if (e.type === 'ceiling') {
          round.shake = Math.max(round.shake, 0.35);
          if (g.mode === 'endless') round.slide = ROW_H;
          sfx.play('hit', 0.6);
          sfx.noise(0.18, 0.12);
        } else if (e.type === 'wave') {
          round.texts.push({ x: SHOOTER.x, y: 260, text: `Board Cleared +${e.bonus.toLocaleString('en-US')}`, size: 18, color: '#ffd60a', t: 0, life: 1.6 });
          sfx.play('win');
        } else if (e.type === 'clear') {
          round.banner = { title: `Level ${g.level} Cleared`, detail: `+${e.bonus.toLocaleString('en-US')} Bonus`, stars: e.stars };
          round.overIn = 1.6;
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
      for (const ring of round.rings) ring.t += dt;
      round.rings = round.rings.filter((ring) => ring.t < 0.4);
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
      round.slide = Math.max(0, round.slide - ROW_H * dt * 5);
      round.guide = traceAim(g, round.aim);
      shell.setScore(g.score);

      if (round.overIn >= 0) {
        round.overIn -= dt;
        if (round.overIn < 0 && !round.reported) {
          round.reported = true;
          finish();
        }
      }
    },
    () => draw(ctx(), size.w, size.h, size.dpr, r0),
  );

  const local = (e: RPointerEvent<HTMLCanvasElement>) => {
    // offsetX/Y are in the canvas's own coordinates, so this stays exact on the 3D-projected laptop screen.
    const fit = fitField(size.w, size.h, shell.touch ? r0.u : undefined);
    return { fit, p: toField(fit, e.nativeEvent.offsetX, e.nativeEvent.offsetY) };
  };
  const onLauncher = (fit: ReturnType<typeof fitField>, x: number, y: number) => {
    const reach = (r: number) => Math.max(r * fit.scale, 24) / fit.scale;
    return Math.hypot(x - NEXT.x, y - NEXT.y) <= reach(NEXT_R + 6) || Math.hypot(x - SHOOTER.x, y - SHOOTER.y) <= reach(R + 7);
  };
  const aimTo = (x: number, y: number) => {
    r0.aim = aimAt(SHOOTER, { x, y });
    r0.guide = traceAim(r0.game, r0.aim);
  };

  return (
    <canvas
      ref={ref}
      className="g-bubble-shooter-canvas"
      onPointerMove={(e) => {
        if (!playing) return;
        if (e.pointerType !== 'mouse' && r0.armed !== e.pointerId) return;
        const { p } = local(e);
        if (p.y < SHOOTER.y - R * 0.5) aimTo(p.x, p.y);
      }}
      onPointerDown={(e) => {
        if (!playing || e.button > 0) return;
        e.preventDefault();
        const { fit, p } = local(e);
        if (onLauncher(fit, p.x, p.y)) {
          swap(r0.game);
          return;
        }
        e.currentTarget.setPointerCapture?.(e.pointerId);
        r0.armed = e.pointerId;
        if (p.y < SHOOTER.y - R * 0.5) aimTo(p.x, p.y);
      }}
      onPointerUp={(e) => {
        if (r0.armed !== e.pointerId) return;
        r0.armed = null;
        const { p } = local(e);
        if (p.y < SHOOTER.y - R * 0.5) {
          aimTo(p.x, p.y);
          if (playing) fire(r0.game, r0.aim);
        }
      }}
      onPointerCancel={() => {
        r0.armed = null;
      }}
      onLostPointerCapture={() => {
        r0.armed = null;
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
