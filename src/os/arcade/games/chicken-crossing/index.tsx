import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { IDLE_GRACE, createState, laneAt, step, type Biome, type Death, type Direction } from './logic';
import { burst, createView, draw, follow } from './draw';
import { meta } from './meta';
import './chicken-crossing.css';

const scenery = defineSetting('chicken-crossing-scenery', ['meadow', 'sunset'] as const, 'meadow', { live: true });
const directions: Direction[] = ['up', 'left', 'right', 'down'];
const directionFor: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const biomeNames: Record<Biome, string> = { meadow: 'the meadow', orchard: 'the orchard', dunes: 'the dunes', tundra: 'the tundra' };
const endings: Record<Death, [string, string]> = {
  car: ['Flattened', 'wait for the gap, then go.'],
  train: ['Caught by the Train', 'when the light flashes, stay off the tracks.'],
  water: ['Splash', 'chickens ride logs and lily pads, they do not swim.'],
  drift: ['Swept Away', 'hop off before the log leaves the field.'],
  hawk: ['Snatched', 'the hawk comes for chickens who stand still.'],
};
const DEATH_ANIM = 1.05;
const SWIPE = 24;

function Setup() {
  const [value, set] = useSetting(scenery);
  return <Segmented label="Scenery" value={value} onChange={set} options={[["meadow", "Daytime"], ["sunset", "Sunset"]]} />;
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} formatScore={(n) => `${n} pts`} setup={<Setup />}>
      <Play />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const [look] = useSetting(scenery);
  const { ref, size, ctx } = useCanvas();
  const pending = useRef<Direction | null>(null);
  const swipe = useRef<{ id: number; x: number; y: number; fired: boolean } | null>(null);
  const keys = useKeys((code, event) => {
    if (!event?.repeat && directionFor[code]) pending.current = directionFor[code];
  });
  const [s] = useState(() => ({ world: createState(Math.floor(Math.random() * 0xffffffff)), view: createView(), over: false, bell: 0, ring: 0, trains: new Set<number>() }));
  const [readout, setReadout] = useState({ distance: 0, coins: 0 });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [hurry, setHurry] = useState(false);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    shell.setScore(0);
  }, [shell.setScore]);
  useEffect(() => {
    s.view.sunset = look === 'sunset';
    shell.invalidate();
  }, [look, shell.invalidate, s]);
  useEffect(() => {
    pending.current = null;
    swipe.current = null;
    s.world.queued = null;
    s.world.repeat = 0;
  }, [shell.status, s]);
  // The hawk would take an unattended chicken, so leaving the window for another app pauses the round.
  useEffect(() => {
    const win = shell.root.current?.closest('.win');
    if (!win || shell.status !== 'playing') return;
    const check = () => {
      if (win.classList.contains('is-inactive')) shell.pause();
    };
    const watch = new MutationObserver(check);
    watch.observe(win, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, [shell.root, shell.status, shell.pause]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const end = () => {
    const w = s.world;
    const [title, tip] = endings[w.death ?? 'car'];
    shell.gameOver(w.score, {
      title,
      detail: `${w.maxRow} ${w.maxRow === 1 ? 'row' : 'rows'}, ${w.coins} ${w.coins === 1 ? 'coin' : 'coins'}. ${tip}`,
    });
  };

  useGameLoop(
    (dt) => {
      const w = s.world;
      const v = s.view;
      v.time += dt;
      follow(v, w, size.w, size.h, dt);
      if (v.death >= 0) {
        v.death += dt;
        if (v.death >= DEATH_ANIM && !s.over) {
          s.over = true;
          end();
        }
        return;
      }
      const held = directions.find((d) => keys.down(d)) ?? null;
      const ev = step(w, dt, { held, press: pending.current });
      if (dt > 0) pending.current = null;
      if (ev.hopped) {
        sfx.play('blip', 1.2 + Math.random() * 0.2);
        if (!moved) setMoved(true);
      }
      if (ev.blocked) sfx.tone({ freq: 150, to: 110, dur: 0.06, type: 'triangle', vol: 0.12 });
      if (ev.landed && !ev.crashed) {
        const lane = laneAt(w, Math.round(w.y));
        if (lane?.kind === 'river') burst(v, 'ring', w.x, w.y, 1);
        else burst(v, 'dust', w.x, w.y, 4, 0.5);
      }
      if (ev.scored) {
        shell.setScore(w.score);
        setReadout({ distance: w.maxRow, coins: w.coins });
      }
      if (ev.collected) {
        sfx.play('coin');
        burst(v, 'coin', w.x, w.y, 1, 0);
      } else if (ev.milestone) sfx.play('select');
      if (ev.biome) setToast({ text: biomeNames[laneAt(w, w.maxRow)?.biome ?? 'meadow'], key: w.maxRow });
      if (ev.bell) s.bell = 1.3;
      if (s.bell > 0) {
        s.bell -= dt;
        s.ring -= dt;
        if (s.ring <= 0) {
          s.ring = 0.32;
          sfx.tone({ freq: 1480, dur: 0.07, type: 'triangle', vol: 0.06 });
          sfx.tone({ freq: 1110, dur: 0.08, type: 'triangle', vol: 0.05, delay: 0.05 });
        }
      }
      for (const lane of w.lanes) {
        const running = lane.kind === 'rail' && !!lane.train?.running;
        if (running && !s.trains.has(lane.row) && Math.abs(lane.row - w.y) < 5) sfx.noise(0.55, 0.1);
        if (running) s.trains.add(lane.row);
        else s.trains.delete(lane.row);
      }
      const late = w.started && w.idle > IDLE_GRACE - 1.5;
      if (late !== hurry) setHurry(late);
      if (ev.crashed) {
        v.death = 0;
        const d = w.death;
        if (d === 'car' || d === 'train') {
          sfx.play('hit');
          burst(v, 'feather', w.x, w.y, d === 'train' ? 12 : 7, d === 'train' ? 2.2 : 1);
        } else if (d === 'hawk') {
          sfx.tone({ freq: 1500, to: 680, dur: 0.4, type: 'sawtooth', vol: 0.05 });
          burst(v, 'feather', w.x, w.y, 5, 0.7);
        } else {
          sfx.noise(0.3, 0.18);
          sfx.tone({ freq: 520, to: 160, dur: 0.25, type: 'sine', vol: 0.1 });
          burst(v, 'splash', w.x, w.y, 9, 1.1);
          burst(v, 'ring', w.x, w.y, 1);
        }
      }
    },
    () => {
      const c = ctx();
      if (c) draw(c, size.w, size.h, s.world, s.view);
    },
  );

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (shell.status !== 'playing' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = swipe.current;
    if (!g || g.id !== e.pointerId || g.fired) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < SWIPE) return;
    g.fired = true;
    pending.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  };
  const up = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = swipe.current;
    if (!g || g.id !== e.pointerId) return;
    swipe.current = null;
    if (!g.fired && shell.status === 'playing') pending.current = 'up';
  };

  const hint = shell.touch ? 'Tap To Hop · Swipe To Turn' : 'Arrows or WASD · Click To Hop';
  return (
    <div className={`g-chicken-crossing-play${shell.touch ? ' g-chicken-crossing-touch' : ''}`}>
      <div className="g-chicken-crossing-field">
        <canvas
          ref={ref}
          aria-label={`Chicken Crossing: ${readout.distance} rows, ${readout.coins} coins`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => { swipe.current = null; }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      {toast && <div key={toast.key} className="g-chicken-crossing-toast">{toast.text}</div>}
      <div className={`g-chicken-crossing-info${hurry ? ' is-hurry' : ''}`} aria-live="off">
        {hurry ? 'Keep Moving' : moved ? `${readout.distance} ${readout.distance === 1 ? 'Row' : 'Rows'} · ${readout.coins} ${readout.coins === 1 ? 'Coin' : 'Coins'}` : hint}
      </div>
    </div>
  );
}
