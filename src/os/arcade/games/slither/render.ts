import { SKINS, bodyCount, radiusOf, type Snake, type World } from './world.ts';

export type Camera = { x: number; y: number; zoom: number; shake: number };
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const hexRgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const colorAlpha = (hex: string, alpha: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Where the minimap and Top 10 sit; `textScale` is how much the HUD text is enlarged to stay readable in a scaled frame. */
export function overlayLayout(size: { w: number; h: number }, textScale = 1) {
  const miniDiameter = clamp(Math.min(size.w, size.h) * 0.34, 58, 88);
  const miniPad = size.h < 200 ? 4 : 12;
  const miniTop = size.h - miniDiameter - miniPad;
  const compact = size.h <= 190;
  const boardTop = 50;
  const boardChrome = (compact ? 6 : 28) * textScale;
  const boardRowHeight = (compact ? 11 : 13) * textScale;
  const maxBoardRows = Math.max(1, Math.floor((miniTop - boardTop - boardChrome) / boardRowHeight));
  return { miniDiameter, miniPad, miniTop, boardTop, boardChrome, boardRowHeight, maxBoardRows };
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, world: World, me: number) {
  if (!snake.alive || snake.body.length < 2) return;
  const radius = radiusOf(snake.mass);
  const skin = SKINS[snake.skin % SKINS.length];
  const count = Math.min(bodyCount(snake.mass), snake.body.length);
  ctx.beginPath();
  ctx.moveTo(snake.body[0].x, snake.body[0].y);
  for (let i = 1; i < count; i++) ctx.lineTo(snake.body[i].x, snake.body[i].y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = radius * 2 + 2;
  ctx.strokeStyle = 'rgba(4, 12, 18, 0.85)';
  ctx.stroke();
  ctx.lineWidth = radius * 2;
  ctx.strokeStyle = skin.color;
  ctx.shadowColor = skin.color;
  ctx.shadowBlur = snake.boosting ? radius * 1.3 : radius * 0.45;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([radius * 0.62, radius * 0.78]);
  ctx.lineDashOffset = -world.clock * (snake.boosting ? 50 : 20);
  ctx.lineWidth = Math.max(2, radius * 0.48);
  ctx.strokeStyle = colorAlpha(skin.light, snake.id === me ? 0.8 : 0.46);
  ctx.stroke();
  ctx.setLineDash([]);
  const head = snake.body[0];
  ctx.fillStyle = skin.light;
  ctx.beginPath();
  ctx.arc(head.x, head.y, radius * 0.93, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(snake.x, snake.y);
  ctx.rotate(snake.angle);
  ctx.fillStyle = '#142028';
  ctx.beginPath();
  ctx.ellipse(radius * 0.37, -radius * 0.34, radius * 0.22, radius * 0.28, 0, 0, Math.PI * 2);
  ctx.ellipse(radius * 0.37, radius * 0.34, radius * 0.22, radius * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(radius * 0.42, -radius * 0.38, radius * 0.075, 0, Math.PI * 2);
  ctx.arc(radius * 0.42, radius * 0.3, radius * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPellet(ctx: CanvasRenderingContext2D, pellet: World['pellets'][number], clock: number) {
  const color = pellet.natural ? ['#ffe181', '#9bf5c4', '#8bd7ff', '#f7a3ff'][pellet.color % 4] : SKINS[pellet.color % SKINS.length].light;
  const radius = clamp(2 + Math.sqrt(pellet.value) * 0.65, 2, 8);
  const pulse = 1 + Math.sin(clock * 3 + pellet.id * 1.7) * 0.1;
  ctx.fillStyle = colorAlpha(color, 0.18);
  ctx.beginPath();
  ctx.arc(pellet.x, pellet.y, radius * 2.1 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pellet.x, pellet.y, radius * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath();
  ctx.arc(pellet.x - radius * 0.28, pellet.y - radius * 0.28, radius * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

function drawMiniMap(ctx: CanvasRenderingContext2D, world: World, size: { w: number; h: number }, me: number) {
  const { miniDiameter: diameter, miniPad: pad, miniTop: y } = overlayLayout(size);
  const x = size.w - diameter - pad;
  const r = diameter / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6, 14, 21, 0.78)';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(182, 223, 231, 0.12)';
  ctx.lineWidth = 1;
  for (const f of [0.35, 0.68, 1]) {
    ctx.beginPath();
    ctx.arc(x + r, y + r, r * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    const sx = x + r + (snake.x / world.radius) * r;
    const sy = y + r + (snake.y / world.radius) * r;
    ctx.fillStyle = snake.id === me ? '#fff7d1' : SKINS[snake.skin % SKINS.length].color;
    ctx.beginPath();
    ctx.arc(sx, sy, snake.id === me ? 2.5 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(193, 240, 236, 0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  world: World,
  camera: Camera,
  me: number,
  particles: Particle[],
) {
  const { w, h } = size;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#08141a';
  ctx.fillRect(0, 0, w, h);
  const px = camera.x + (Math.random() - 0.5) * camera.shake;
  const py = camera.y + (Math.random() - 0.5) * camera.shake;
  ctx.save();
  ctx.translate(w / 2 - px * camera.zoom, h / 2 - py * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  const viewW = w / camera.zoom;
  const viewH = h / camera.zoom;
  const left = px - viewW / 2;
  const top = py - viewH / 2;
  ctx.beginPath();
  ctx.arc(0, 0, world.radius, 0, Math.PI * 2);
  const backdrop = ctx.createRadialGradient(0, 0, world.radius * 0.3, 0, 0, world.radius);
  backdrop.addColorStop(0, '#15313a');
  backdrop.addColorStop(0.78, '#102831');
  backdrop.addColorStop(1, '#193b43');
  ctx.fillStyle = backdrop;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(166, 220, 211, 0.055)';
  ctx.lineWidth = 1 / camera.zoom;
  const grid = 100;
  const sx = Math.floor((left - 50) / grid) * grid;
  const ex = left + viewW + 100;
  const sy = Math.floor((top - 50) / grid) * grid;
  const ey = top + viewH + 100;
  ctx.beginPath();
  for (let x = sx; x <= ex; x += grid) {
    ctx.moveTo(x, sy);
    ctx.lineTo(x, ey);
  }
  for (let y = sy; y <= ey; y += grid) {
    ctx.moveTo(sx, y);
    ctx.lineTo(ex, y);
  }
  ctx.stroke();
  for (const p of world.pellets) {
    if (Math.abs(p.x - px) > viewW * 0.55 || Math.abs(p.y - py) > viewH * 0.55) continue;
    drawPellet(ctx, p, world.clock);
  }
  for (const snake of world.snakes) drawSnake(ctx, snake, world, me);
  for (const particle of particles) {
    const alpha = clamp(particle.life / particle.max, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, world.radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(171, 245, 223, 0.34)';
  ctx.lineWidth = 4 / camera.zoom;
  ctx.shadowColor = '#67dfc0';
  ctx.shadowBlur = 14 / camera.zoom;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  for (const snake of world.snakes) {
    if (!snake.alive || snake.id === me) continue;
    const x = w / 2 + (snake.x - camera.x) * camera.zoom;
    const y = h / 2 + (snake.y - camera.y) * camera.zoom;
    if (x < -50 || y < -30 || x > w + 50 || y > h + 30) continue;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(238, 250, 247, 0.8)';
    ctx.shadowColor = '#071317';
    ctx.shadowBlur = 4;
    ctx.fillText(snake.name, x, y - radiusOf(snake.mass) * camera.zoom - 4);
  }
  ctx.shadowBlur = 0;
  drawMiniMap(ctx, world, size, me);
}
