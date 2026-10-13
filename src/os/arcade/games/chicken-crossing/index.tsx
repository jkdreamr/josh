import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { createState, step, type Direction } from './logic';
import { draw } from './draw';
import { meta } from './meta';
import './chicken-crossing.css';

const scenery = defineSetting('chicken-crossing-scenery', ['meadow', 'sunset'] as const, 'meadow', { live: true });
const directions: Direction[] = ['up', 'left', 'right', 'down'];
const directionFor: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

function Setup() {
  const [value, set] = useSetting(scenery);
  return <Segmented label="Scenery" value={value} onChange={set} options={[["meadow", "Meadow"], ["sunset", "Sunset"]]} />;
}

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} formatScore={(n) => `${n} pts`} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const [look] = useSetting(scenery);
  const { ref, size, ctx } = useCanvas();
  const pending = useRef<Direction | null>(null);
  const keys = useKeys((code, event) => {
    if (!event?.repeat && directionFor[code]) pending.current = directionFor[code];
  });
  const [s] = useState(() => ({ world: createState(Math.floor(Math.random() * 0xffffffff)), camera: 0 }));
  const [readout, setReadout] = useState({ distance: 0, corn: 0 });

  useEffect(() => {
    shell.setScore(0);
  }, [shell.setScore]);
  useEffect(() => {
    shell.invalidate();
  }, [look, shell.invalidate]);
  useEffect(() => {
    pending.current = null;
    s.world.queued = null;
    s.world.repeat = 0;
  }, [shell.status, s]);

  useGameLoop(
    (dt) => {
      const held = directions.find((d) => keys.down(d)) ?? null;
      const ev = step(s.world, dt, { held, press: pending.current });
      if (dt > 0) pending.current = null;
      const target = Math.min(s.world.maxRow, s.world.y + 0.5);
      s.camera += (target - s.camera) * Math.min(1, dt * 12);
      if (ev.hopped) sfx.play('blip', 1.3);
      if (ev.scored) {
        shell.setScore(s.world.score);
        setReadout({ distance: s.world.maxRow, corn: s.world.corn });
      }
      if (ev.collected) sfx.play('coin');
      else if (ev.milestone) sfx.play('select');
      if (ev.crashed) {
        sfx.play('hit');
        shell.gameOver(s.world.score, {
          title: 'Close Call',
          detail: `${s.world.maxRow} ${s.world.maxRow === 1 ? 'row' : 'rows'} crossed, ${s.world.corn} corn collected. Try the next gap.`,
        });
      }
    },
    () => {
      const c = ctx();
      if (c) draw(c, size.w, size.h, s.world, s.camera, look === 'sunset');
    },
  );

  return (
    <div className={`g-chicken-crossing-play${shell.touch ? ' g-chicken-crossing-touch' : ''}`}>
      <div className="g-chicken-crossing-field">
        <canvas ref={ref} aria-label={`Chicken Crossing: ${readout.distance} rows, ${readout.corn} corn`} />
      </div>
      <div className="g-chicken-crossing-info" aria-live="off">
        <span>{readout.distance} Rows · {readout.corn} Corn</span>
        <span>{shell.touch ? 'Direction Pad' : 'Arrows or WASD'} · Grass Is Safe</span>
      </div>
      <TouchControls dpad />
    </div>
  );
}
