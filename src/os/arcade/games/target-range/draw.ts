import { WAVES, type Point, type RangeState, type Shot, type Target } from './logic';

export type Feedback = Point & { age: number; shot: Shot };
const colors = ['#cb6856', '#469c93', '#c79a4a'];

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  c.fill();
}

export function drawRange(
  c: CanvasRenderingContext2D, width: number, height: number, g: RangeState,
  targets: Target[], feedback: Feedback[], aim: Point | null, touch: boolean,
) {
  const w = width;
  const h = height;
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#203e3d';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#294a47';
  c.lineWidth = 1;
  for (let x = 0; x < w; x += 48) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  c.fillStyle = '#1a3434';
  c.fillRect(0, h - 18, w, 18);
  c.fillStyle = '#bdae87';
  c.fillRect(0, 0, w, 8);
  for (let x = 0; x < w; x += 32) {
    c.fillStyle = '#718e80';
    c.fillRect(x, 0, 16, 8);
  }

  c.save();
  c.strokeStyle = '#638179';
  c.globalAlpha = 0.38;
  c.lineWidth = 2;
  c.setLineDash([3, 9]);
  c.beginPath();
  if (g.wave === 1) {
    for (let i = 0; i < 3; i++) {
      c.moveTo(w * 0.17, h * (0.22 + i * 0.28));
      c.lineTo(w * 0.83, h * (0.22 + i * 0.28));
    }
  } else if (g.wave === 2) {
    for (let i = 0; i < 3; i++) {
      c.moveTo(w * (0.2 + i * 0.3), h * 0.17);
      c.lineTo(w * (0.2 + i * 0.3), h * 0.83);
    }
  } else if (g.wave === 3) c.ellipse(w / 2, h / 2, w * 0.3, h * 0.29, 0, 0, Math.PI * 2);
  else if (g.wave === 4) {
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * Math.PI * 2;
      const x = w * (0.5 + 0.29 * Math.sin(t));
      const y = h * (0.5 + 0.29 * Math.sin(2 * t));
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
  }
  c.stroke();
  c.restore();

  for (const target of targets) {
    const { x, y, radius: r, id } = target;
    circle(c, x, y + 4, r + 2, '#132e2e');
    circle(c, x, y, r, '#f3e9d2');
    circle(c, x, y, r * 0.89, colors[id]);
    circle(c, x, y, r * 0.67, '#f3e9d2');
    circle(c, x, y, r * 0.49, colors[id]);
    circle(c, x, y, r * 0.3, '#f2cf79');
    circle(c, x, y, 2.5, '#784e32');
    c.strokeStyle = '#fff7df';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, r - 0.5, 0, Math.PI * 2);
    c.stroke();
  }

  for (const f of feedback) {
    const { x, y, age, shot } = f;
    c.save();
    c.globalAlpha = Math.max(0, 1 - age / 0.8);
    c.lineWidth = 2;
    if (shot.kind === 'miss') {
      c.strokeStyle = '#e9ad97';
      c.beginPath();
      c.moveTo(x - 5, y - 5); c.lineTo(x + 5, y + 5);
      c.moveTo(x + 5, y - 5); c.lineTo(x - 5, y + 5);
      c.stroke();
    } else {
      c.strokeStyle = shot.kind === 'bullseye' ? '#f2cf79' : '#d0eddf';
      c.beginPath();
      c.arc(x, y, (shot.target?.radius ?? 25) * (0.6 + age * 1.3), 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 12 + age * 55;
        c.beginPath();
        c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        c.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
        c.stroke();
      }
    }
    c.font = '600 15px -apple-system, system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = shot.kind === 'miss' ? '#e9ad97' : '#f3e9d2';
    const label = shot.kind === 'miss' ? 'Miss' : shot.kind === 'bullseye' ? `Bullseye +${shot.points}` : `+${shot.points}`;
    const textWidth = c.measureText(label).width;
    const textX = Math.max(textWidth / 2 + 8, Math.min(w - textWidth / 2 - 8, x));
    c.fillText(label, textX, Math.max(26, y - 30 - age * 20));
    c.restore();
  }

  if (aim && !touch && g.phase === 'live') {
    const x = aim.x * w;
    const y = aim.y * h;
    c.strokeStyle = '#fff9e5';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, 8, 0, Math.PI * 2);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      c.moveTo(x + dx * 11, y + dy * 11);
      c.lineTo(x + dx * 16, y + dy * 16);
    }
    c.stroke();
    circle(c, x, y, 1.5, '#fff9e5');
  }

  if (g.phase === 'intro' || g.phase === 'clear') {
    c.fillStyle = 'rgba(18, 42, 41, 0.85)';
    const panelW = Math.min(280, w - 24);
    const panelH = Math.min(100, h - 16);
    c.beginPath();
    c.roundRect((w - panelW) / 2, (h - panelH) / 2, panelW, panelH, 14);
    c.fill();
    c.textAlign = 'center';
    c.fillStyle = '#f3e9d2';
    c.font = '600 22px -apple-system, system-ui, sans-serif';
    c.fillText(g.phase === 'intro' ? WAVES[g.wave].name : 'Wave Cleared', w / 2, h / 2 - 6);
    c.fillStyle = '#c8d7cb';
    c.font = '13px -apple-system, system-ui, sans-serif';
    c.fillText(g.phase === 'intro' ? WAVES[g.wave].hint : `Time bonus +${g.bonus}`, w / 2, h / 2 + 20);
  }
}
