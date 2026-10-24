import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { defineSetting, GameShell, getSetting, Segmented, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { burst, createFx, drawRange, stepFx, type Feedback } from './draw';
import { accuracy, createRange, localAim, multiplier, shootRange, stepRange, targetsFor, waveAt, type Point, type RangeState, type Target } from './logic';
import { meta } from './meta';
import './target-range.css';

const paceSetting = defineSetting('target-range:pace', ['relaxed', 'standard'] as const, 'standard');
const paceOptions = [['relaxed', 'Relaxed'], ['standard', 'Standard']] as const;
/** Below this game height the HUD moves up beside the shell's pills and the stats row goes. */
const SHORT = 340;

function Setup() {
  const [pace, setPace] = useSetting(paceSetting);
  return <Segmented value={pace} options={paceOptions} onChange={setPace} label="Pace For New Games" />;
}

export default function Game({ compact, onExit }: GameProps) {
  return <GameShell meta={meta} compact={compact} onExit={onExit} setup={<Setup />}><Play /></GameShell>;
}

function snapshot(g: RangeState) {
  return { wave: g.wave, phase: g.phase, time: Math.ceil(g.timeLeft), waveHits: g.waveHits, hits: g.hits, misses: g.misses, combo: g.combo, accuracy: accuracy(g) };
}

/**
 * The phone and iPad frames scale the whole OS down; `u` is the inverse, so text and touch targets can
 * grow back to their real size. It also reports the shell's control pill width for the short HUD.
 */
function useFrame(touch: boolean, status: string) {
  const shell = useShell();
  const [u, setU] = useState(1);
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        const next = touch && k > 0.4 && k < 0.99 ? Math.min(1.6, Math.ceil(100 / k) / 100) : 1;
        el.style.setProperty('--g-target-range-u', String(next));
        const ctrl = el.querySelector<HTMLElement>('.arcade-ctrl');
        el.style.setProperty('--g-target-range-ctrl', `${ctrl?.offsetWidth ?? 0}px`);
        setU(next);
      });
    };
    measure();
    // The frame animates in, which never resizes the element, so measure again once it settles.
    const late = window.setTimeout(measure, 700);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
    };
  }, [shell.root, touch, status]);
  useEffect(() => {
    const el = shell.root.current;
    return () => {
      el?.style.removeProperty('--g-target-range-u');
      el?.style.removeProperty('--g-target-range-ctrl');
    };
  }, [shell.root]);
  return u;
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const [g] = useState(() => createRange(getSetting(paceSetting)));
  const [hud, setHud] = useState(() => snapshot(g));
  const published = useRef(JSON.stringify(hud));
  const visual = useRef<Target[]>([]);
  const aim = useRef<Point | null>(null);
  const held = useRef(0);
  const feedback = useRef<Feedback[]>([]);
  const fx = useRef(createFx());
  const lastTick = useRef(0);
  const u = useFrame(shell.touch, shell.status);
  const layout = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);

  useEffect(() => {
    const el = layout.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setShort(el.offsetHeight < SHORT));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const publish = () => {
    const next = snapshot(g);
    const key = JSON.stringify(next);
    if (published.current !== key) {
      published.current = key;
      setHud(next);
    }
  };

  useEffect(() => shell.setScore(0), [shell.setScore]);
  useEffect(() => {
    if (shell.status !== 'playing' || !shell.active) aim.current = null;
  }, [shell.status, shell.active]);

  const fire = (point: Point) => {
    if (shell.status !== 'playing' || !shell.active || size.w <= 0) return;
    const combo = g.combo;
    const shot = shootRange(g, point, visual.current);
    if (!shot) return;
    const x = point.x / size.w;
    const y = point.y / size.h;
    feedback.current = [...feedback.current.slice(-7), { x, y, age: 0, shot }];
    burst(fx.current, x, y, shot, size.w / size.h, combo);
    if (shot.kind === 'miss') {
      sfx.tone({ freq: 150, to: 70, type: 'triangle', dur: 0.09, vol: 0.12 });
    } else {
      sfx.tone({ freq: 900, to: 180, type: 'square', dur: 0.05, vol: 0.06 });
      sfx.play(shot.kind === 'bullseye' ? 'coin' : 'select', 1 + Math.min(g.combo, 12) * 0.025);
      if (multiplier(g.combo) > multiplier(combo)) sfx.tone({ freq: 660, to: 1320, dur: 0.16, type: 'triangle', vol: 0.12, delay: 0.05 });
      if (shot.cleared) sfx.play('win');
    }
    shell.setScore(g.score);
    publish();
  };

  const draw = () => {
    const c = ctx();
    if (!c || size.w <= 0 || size.h <= 0) return;
    visual.current = targetsFor(g, size.w, size.h);
    drawRange(c, size.w, size.h, g, visual.current,
      feedback.current.map((f) => ({ ...f, x: f.x * size.w, y: f.y * size.h })), fx.current,
      { aim: aim.current, touch: shell.touch, u, short });
  };

  useGameLoop((dt) => {
    const before = g.cooldowns.slice();
    const phase = g.phase;
    const event = stepRange(g, dt);
    stepFx(fx.current, dt);
    // A target that comes back, or a wave that goes live, flips its targets up.
    g.cooldowns.forEach((n, i) => {
      if ((before[i] > 0 && n === 0) || (phase === 'intro' && g.phase === 'live')) fx.current.shown[i] = 0;
    });
    feedback.current = feedback.current.filter((f) => (f.age += dt) < 0.8);
    if (g.phase === 'live' && g.timeLeft <= 5) {
      const s = Math.ceil(g.timeLeft);
      if (s !== lastTick.current && s > 0) sfx.tone({ freq: s <= 2 ? 1046 : 784, dur: 0.05, vol: 0.07, type: 'sine' });
      lastTick.current = s;
    } else lastTick.current = 0;
    if (event === 'over') {
      sfx.play('lose');
      const wave = waveAt(g.wave);
      const cleared = g.wave === 1 ? '1 wave' : `${g.wave} waves`;
      shell.gameOver(g.score, {
        title: 'Time Up',
        detail: `You cleared ${cleared} and hit ${g.waveHits} of ${wave.goal} on ${wave.name}. ${accuracy(g)}% accuracy, ${g.bullseyes} ${g.bullseyes === 1 ? 'bullseye' : 'bullseyes'}, best streak ${g.bestCombo}.`,
        board: g.pace,
      });
    }
    const dx = keys.axis('left', 'right');
    const dy = keys.axis('up', 'down');
    if (dx || dy) {
      // Starts slow for fine aim, then speeds up the longer the key is held.
      held.current = Math.min(1, held.current + dt * 1.6);
      const speed = (0.35 + 0.95 * held.current) * dt;
      const p = aim.current ?? { x: 0.5, y: 0.5 };
      const ax = size.h > 0 ? size.h / Math.max(size.w, size.h) : 1;
      const ay = size.w > 0 ? size.w / Math.max(size.w, size.h) : 1;
      aim.current = { x: Math.max(0, Math.min(1, p.x + dx * speed * ax * 1.25)), y: Math.max(0, Math.min(1, p.y + dy * speed * ay * 1.25)) };
    } else held.current = 0;
    if (keys.pressed('action') && size.w > 0 && size.h > 0) {
      const p = aim.current ?? { x: 0.5, y: 0.5 };
      aim.current = p;
      fire({ x: p.x * size.w, y: p.y * size.h });
    }
    publish();
  }, draw);

  const pointFrom = (e: PointerEvent<HTMLCanvasElement>) => {
    // Native offsets are local to the canvas, including on the perspective-projected laptop.
    return localAim(e.nativeEvent.offsetX, e.nativeEvent.offsetY, size.w, size.h);
  };

  const wave = waveAt(hud.wave);
  const streak = hud.combo > 0 ? `${hud.combo} Streak, ${multiplier(hud.combo)}×` : 'No Streak';
  return (
    <div ref={layout} className={`g-target-range-layout${short ? ' is-short' : ''}${hud.phase === 'live' ? ' is-live' : ''}`}>
      <div className="g-target-range-hud">
        <div className="g-target-range-wave">
          <span>Wave {hud.wave + 1}</span>
          <strong>{wave.name}</strong>
        </div>
        <div className="g-target-range-progress">
          <strong>{hud.waveHits} / {wave.goal}<span> Targets</span></strong>
          <div role="progressbar" aria-label="Wave targets hit" aria-valuenow={hud.waveHits} aria-valuemin={0} aria-valuemax={wave.goal}>
            <i style={{ width: `${(hud.waveHits / wave.goal) * 100}%` }} />
          </div>
        </div>
        <strong className={`g-target-range-time${hud.time <= 5 && hud.phase === 'live' ? ' is-low' : ''}`} aria-label={`${hud.time} seconds remaining`}>{hud.time}s</strong>
      </div>
      <canvas
        ref={ref}
        className="g-target-range-canvas"
        aria-label="Target gallery. Click or tap a target to shoot. Arrow keys aim and Space shoots."
        onPointerMove={(e) => {
          if (shell.status !== 'playing' || !shell.active || e.pointerType === 'touch') return;
          const p = pointFrom(e);
          if (p) aim.current = { x: p.x / size.w, y: p.y / size.h };
        }}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          const p = pointFrom(e);
          if (!p) return;
          e.preventDefault();
          if (e.pointerType !== 'touch') aim.current = { x: p.x / size.w, y: p.y / size.h };
          sfx.unlock();
          fire(p);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') aim.current = null;
        }}
      />
      <div className="g-target-range-stats">
        <span>{hud.hits} {hud.hits === 1 ? 'Hit' : 'Hits'}, {hud.misses} {hud.misses === 1 ? 'Miss' : 'Misses'}</span>
        <span>{hud.accuracy}% Accuracy</span>
        <strong>{streak}</strong>
      </div>
      <p className="g-target-range-tip">{shell.touch ? 'Tap a target to shoot. Center hits earn more.' : 'Click a target to shoot. Center hits earn more.'}</p>
    </div>
  );
}
