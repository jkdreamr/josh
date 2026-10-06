// Reference game: shows every kit piece. Folders starting with '_' are not listed in the arcade.
// 3D games: const THREE = useThree() (or await loadThree()) inside the child, never `import 'three'` statically.
import { useRef } from 'react';
import { GameShell, TouchControls, sfx, useCanvas, useGameLoop, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { meta } from './meta';
import './example.css';

type Dot = { x: number; y: number; v: number };

export default function Game({ compact, onExit }: GameProps) {
  // The shell owns overlays, pause, restart (remounts <Play/>), mute, best score and key capture.
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
      <TouchControls dpad="x" />
    </GameShell>
  );
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const { ref, size, ctx } = useCanvas();
  const s = useRef({ x: 0.5, dots: [] as Dot[], spawn: 0, score: 0, lives: 3 }).current;

  useGameLoop(
    (dt) => {
      s.x = Math.min(1, Math.max(0, s.x + keys.axis('left', 'right') * dt * 0.9));
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.35, 1 - s.score * 0.03);
        s.dots.push({ x: 0.05 + Math.random() * 0.9, y: 0, v: 0.25 + Math.random() * 0.15 + s.score * 0.01 });
      }
      for (const d of s.dots) d.y += d.v * dt;
      for (const d of s.dots.filter((d) => d.y >= 0.9)) {
        s.dots.splice(s.dots.indexOf(d), 1);
        if (Math.abs(d.x - s.x) < 0.09) {
          s.score++;
          shell.setScore(s.score);
          sfx.play('coin');
        } else if (--s.lives === 0) {
          sfx.play('lose');
          shell.gameOver(s.score, { detail: `you caught ${s.score} ${s.score === 1 ? 'dot' : 'dots'}.` });
        } else sfx.play('hit');
      }
    },
    () => {
      const c = ctx();
      if (!c) return;
      const { w, h } = size;
      c.clearRect(0, 0, w, h);
      c.fillStyle = meta.accent;
      for (const d of s.dots) {
        c.beginPath();
        c.arc(d.x * w, d.y * h, 7, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#f5f5f7';
      c.beginPath();
      c.roundRect(s.x * w - 0.09 * w, h * 0.9, 0.18 * w, 8, 4);
      c.fill();
      c.font = '13px -apple-system, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('●'.repeat(s.lives), w / 2, 26);
    },
  );

  return <canvas ref={ref} className="g-example-canvas" />;
}
