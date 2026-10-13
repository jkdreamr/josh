import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { defineSetting, GameShell, getSetting, Segmented, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { drawRange, type Feedback } from './draw';
import { accuracy, createRange, localAim, multiplier, shootRange, stepRange, targetsFor, waveAt, type Point, type RangeState, type Target } from './logic';
import { meta } from './meta';
import './target-range.css';

const paceSetting = defineSetting('target-range:pace', ['relaxed', 'standard'] as const, 'standard');
const paceOptions = [['relaxed', 'Relaxed'], ['standard', 'Standard']] as const;

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

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const [g] = useState(() => createRange(getSetting(paceSetting)));
  const [hud, setHud] = useState(() => snapshot(g));
  const published = useRef(JSON.stringify(hud));
  const visual = useRef<Target[]>([]);
  const aim = useRef<Point | null>(null);
  const feedback = useRef<Feedback[]>([]);

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
    if (shell.status !== 'playing' || !shell.active) return;
    const shot = shootRange(g, point, visual.current);
    if (!shot) return;
    feedback.current = [...feedback.current.slice(-11), { x: point.x / size.w, y: point.y / size.h, age: 0, shot }];
    if (shot.kind === 'miss') sfx.tone({ freq: 140, to: 100, type: 'triangle', dur: 0.08, vol: 0.12 });
    else {
      sfx.play(shot.kind === 'bullseye' ? 'coin' : 'select', 1 + Math.min(g.combo, 12) * 0.025);
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
      feedback.current.map((f) => ({ ...f, x: f.x * size.w, y: f.y * size.h })), aim.current, shell.touch);
  };

  useGameLoop((dt) => {
    const event = stepRange(g, dt);
    feedback.current = feedback.current.filter((f) => (f.age += dt) < 0.8);
    if (event === 'over') {
      sfx.play('lose');
      const wave = waveAt(g.wave);
      shell.gameOver(g.score, {
        title: 'Time Up',
        detail: `Cleared ${g.wave} ${g.wave === 1 ? 'wave' : 'waves'}. Wave ${g.wave + 1}, ${wave.name}: ${g.waveHits}/${wave.goal} targets. ${g.hits} hits, ${g.misses} misses, ${accuracy(g)}% accuracy. Best streak: ${g.bestCombo}.`,
        board: g.pace,
      });
    }
    const dx = keys.axis('left', 'right');
    const dy = keys.axis('up', 'down');
    if (dx || dy) {
      const p = aim.current ?? { x: 0.5, y: 0.5 };
      aim.current = { x: Math.max(0, Math.min(1, p.x + dx * dt * 0.6)), y: Math.max(0, Math.min(1, p.y + dy * dt * 0.6)) };
    }
    if (keys.pressed('action') && size.w > 0 && size.h > 0) {
      const p = aim.current ?? { x: 0.5, y: 0.5 };
      fire({ x: p.x * size.w, y: p.y * size.h });
    }
    publish();
  }, draw);

  const pointFrom = (e: PointerEvent<HTMLCanvasElement>) => {
    // Native offsets are local to the canvas, including on the perspective-projected laptop.
    return localAim(e.nativeEvent.offsetX, e.nativeEvent.offsetY, size.w, size.h);
  };

  const wave = waveAt(hud.wave);
  return (
    <div className="g-target-range-layout">
      <div className="g-target-range-hud">
        <div className="g-target-range-wave">
          <span>Wave {hud.wave + 1}</span>
          <strong>{wave.name}</strong>
        </div>
        <div className="g-target-range-progress">
          <strong>{hud.waveHits} / {wave.goal} Targets</strong>
          <div role="progressbar" aria-label="Wave targets hit" aria-valuenow={hud.waveHits} aria-valuemin={0} aria-valuemax={wave.goal}>
            <i style={{ width: `${(hud.waveHits / wave.goal) * 100}%` }} />
          </div>
        </div>
        <strong className={`g-target-range-time${hud.time <= 5 ? ' is-low' : ''}`} aria-label={`${hud.time} seconds remaining`}>{hud.time}s</strong>
      </div>
      <canvas
        ref={ref}
        className="g-target-range-canvas"
        aria-label="Target gallery. Click or tap a target to shoot. Arrow keys aim and Space shoots."
        onPointerMove={(e) => {
          if (shell.status !== 'playing' || !shell.active) return;
          const p = pointFrom(e);
          if (p) aim.current = { x: p.x / size.w, y: p.y / size.h };
        }}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          const p = pointFrom(e);
          if (!p) return;
          e.preventDefault();
          aim.current = { x: p.x / size.w, y: p.y / size.h };
          sfx.unlock();
          fire(p);
        }}
        onPointerLeave={() => (aim.current = null)}
        onPointerCancel={() => (aim.current = null)}
      />
      <div className="g-target-range-stats">
        <span>{hud.hits} Hits <span aria-hidden="true">·</span> {hud.misses} Misses</span>
        <span>{hud.accuracy}% Accuracy</span>
        <strong>{hud.combo > 0 ? `${hud.combo} Streak · ${multiplier(hud.combo)}×` : 'Combo 1×'}</strong>
      </div>
      <p className="g-target-range-tip">{shell.touch ? 'Tap a target to shoot' : 'Click a target to shoot'} <span aria-hidden="true">·</span> Center hits earn more</p>
    </div>
  );
}
