import { CLEAR_SECONDS, INTRO_SECONDS, multiplier, patternPoint, pendulumPoint, PENDULUM, RICOCHET, toCanvas, waveAt, type Pattern, type Point, type RangeState, type Shot, type Target } from './logic';

export type Feedback = Point & { age: number; shot: Shot };
type Bit = Point & { vx: number; vy: number; spin: number; angle: number; age: number; life: number; size: number; color: string; kind: 'shard' | 'spark' | 'dust' };
type Hole = Point & { age: number };
type Pop = { text: string; age: number };

/** Short lived effects. Positions are normalized to the canvas so a resize keeps them in place. */
export type Fx = {
  bits: Bit[];
  holes: Hole[];
  pops: Pop[];
  shake: number;
  recoil: number;
  /** Seconds since each slot's target appeared, for the pop-in. */
  shown: number[];
  clock: number;
};

export const createFx = (): Fx => ({ bits: [], holes: [], pops: [], shake: 0, recoil: 0, shown: [9, 9, 9], clock: 0 });

const colors = ['#d0644f', '#3f9f94', '#cf9a3e'];
const font = (px: number, weight = 600) => `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;

export function stepFx(fx: Fx, dt: number) {
  fx.clock += dt;
  fx.shake = Math.max(0, fx.shake - dt * 5);
  fx.recoil = Math.max(0, fx.recoil - dt * 7);
  for (let i = 0; i < 3; i++) fx.shown[i] += dt;
  for (const b of fx.bits) {
    b.age += dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += (b.kind === 'shard' ? 1.9 : b.kind === 'dust' ? -0.05 : 0.5) * dt;
    b.vx *= 1 - dt * (b.kind === 'dust' ? 3 : 0.8);
    b.angle += b.spin * dt;
  }
  fx.bits = fx.bits.filter((b) => b.age < b.life);
  for (const h of fx.holes) h.age += dt;
  fx.holes = fx.holes.filter((h) => h.age < 2.4);
  for (const p of fx.pops) p.age += dt;
  fx.pops = fx.pops.filter((p) => p.age < 0.9);
}

/** Burst a hit target into shards, or kick up dust where a shot missed. `x` and `y` are normalized. */
export function burst(fx: Fx, x: number, y: number, shot: Shot, aspect: number, comboBefore: number) {
  fx.recoil = 1;
  if (shot.kind === 'miss') {
    fx.holes = [...fx.holes.slice(-7), { x, y, age: 0 }];
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.04 + Math.random() * 0.06;
      fx.bits.push({ x, y, vx: Math.cos(a) * v / aspect, vy: Math.sin(a) * v - 0.04, spin: 0, angle: 0, age: 0, life: 0.45 + Math.random() * 0.2, size: 2 + Math.random() * 2.5, color: '#b9c7bd', kind: 'dust' });
    }
    return;
  }
  const color = colors[shot.target?.id ?? 0];
  const n = shot.kind === 'bullseye' ? 14 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const v = 0.18 + Math.random() * 0.22;
    fx.bits.push({
      x, y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v - 0.25,
      spin: (Math.random() - 0.5) * 18, angle: a, age: 0, life: 0.7 + Math.random() * 0.25,
      size: 5 + Math.random() * 5, color: i % 3 === 0 ? '#f3e9d2' : color, kind: 'shard',
    });
  }
  if (shot.kind === 'bullseye') {
    fx.shake = 1;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.25 + Math.random() * 0.3;
      fx.bits.push({ x, y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v, spin: 0, angle: a, age: 0, life: 0.4 + Math.random() * 0.2, size: 2.5, color: '#ffe39a', kind: 'spark' });
    }
  }
  const before = multiplier(comboBefore);
  const after = multiplier(comboBefore + 1);
  if (after > before) fx.pops = [{ text: `${after}× Streak`, age: 0 }];
}

/** The dashed track one slot's target travels. Pop Up, Darts and Hornets have none: there is no track to learn. */
function guide(c: CanvasRenderingContext2D, map: (p: Point) => Point, pattern: Pattern, slot: number) {
  const trace = (point: (u: number) => Point, from: number, to: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const p = map(point(from + ((to - from) * i) / steps));
      if (i === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => trace((u) => ({ x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u }), 0, 1, 1);
  const ring = (rx: number, ry: number) => trace((u) => ({ x: 0.5 + rx * Math.cos(u), y: 0.5 + ry * Math.sin(u) }), 0, Math.PI * 2, 72);
  switch (pattern) {
    case 'rails': return line(0.21, 0.22 + slot * 0.28, 0.79, 0.22 + slot * 0.28);
    case 'bounce': return line(0.2 + slot * 0.3, 0.21, 0.2 + slot * 0.3, 0.79);
    case 'trampoline': return line(0.2, 0.78, 0.8, 0.78);
    case 'shell': return line(0.2, 0.5, 0.8, 0.5);
    case 'carousel':
    case 'whirlpool': return ring(0.3, 0.29);
    case 'spin': return slot === 1 ? ring(0.14, 0.13) : ring(0.3, 0.29);
    case 'moons': return ring(0.15, 0.14);
    case 'eight':
    case 'bloom': return trace((u) => patternPoint(pattern, 0, u), 0, Math.PI * 2, 120);
    case 'pretzel': return trace((u) => patternPoint('pretzel', 0, u), 0, Math.PI * 4, 200);
    case 'pendulum': return trace((a) => pendulumPoint(slot, a), -PENDULUM.swing, PENDULUM.swing, 40);
    case 'ricochet': {
      const { left, top, width, height } = RICOCHET;
      const a = map({ x: left, y: top });
      const b = map({ x: left + width, y: top + height });
      return c.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string | CanvasGradient) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  c.fill();
}

function backdrop(c: CanvasRenderingContext2D, w: number, h: number, g: RangeState, t: number) {
  const wall = c.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#244a49');
  wall.addColorStop(1, '#183535');
  c.fillStyle = wall;
  c.fillRect(0, 0, w, h);
  // Plank seams.
  c.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let x = 24; x < w; x += 48) c.fillRect(x, 0, 1, h);
  c.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let x = 25; x < w; x += 48) c.fillRect(x, 0, 1, h);
  // A warm spotlight from the awning.
  const spot = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, h) * 0.75);
  spot.addColorStop(0, 'rgba(255, 220, 160, 0.16)');
  spot.addColorStop(1, 'rgba(255, 220, 160, 0)');
  c.fillStyle = spot;
  c.fillRect(0, 0, w, h);

  // Wooden counter along the bottom.
  const counter = Math.max(8, Math.min(18, h * 0.08));
  const wood = c.createLinearGradient(0, h - counter, 0, h);
  wood.addColorStop(0, '#7a5638');
  wood.addColorStop(0.2, '#5d3f29');
  wood.addColorStop(1, '#3f2a1c');
  c.fillStyle = wood;
  c.fillRect(0, h - counter, w, counter);
  c.fillStyle = 'rgba(255, 230, 190, 0.18)';
  c.fillRect(0, h - counter, w, 1);

  // Striped awning with scalloped edge and a string of bulbs.
  const band = Math.max(6, Math.min(12, h * 0.05));
  const scallop = Math.max(12, Math.min(22, w / 24));
  for (let x = 0, i = 0; x < w; x += scallop, i++) {
    c.fillStyle = i % 2 ? '#e9dcbc' : '#c8584a';
    c.fillRect(x, 0, scallop, band);
    c.beginPath();
    c.arc(x + scallop / 2, band, scallop / 2, 0, Math.PI);
    c.fill();
  }
  c.fillStyle = 'rgba(0, 0, 0, 0.18)';
  c.fillRect(0, band - 1, w, 1);
  const live = g.phase === 'live';
  for (let x = scallop / 2, i = 0; x < w; x += scallop * 2, i++) {
    const on = live ? 0.75 + 0.25 * Math.sin(t * 3 + i * 1.3) : 0.55;
    circle(c, x, band + scallop / 2 + 3, 5, `rgba(255, 214, 140, ${0.18 * on})`);
    circle(c, x, band + scallop / 2 + 3, 2, `rgba(255, 236, 190, ${on})`);
  }

  // Vignette.
  const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(8, 20, 20, 0)');
  v.addColorStop(1, 'rgba(8, 20, 20, 0.45)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
}

function target(c: CanvasRenderingContext2D, x: number, y: number, r: number, id: number, scale: number, alpha: number, hot: boolean) {
  const s = r * scale;
  if (s <= 0.5) return;
  c.save();
  c.globalAlpha = alpha;
  circle(c, x + s * 0.06, y + s * 0.14 + 2, s * 1.02, 'rgba(6, 20, 20, 0.45)');
  circle(c, x, y, s, '#f6eedb');
  circle(c, x, y, s * 0.89, colors[id]);
  circle(c, x, y, s * 0.67, '#f6eedb');
  circle(c, x, y, s * 0.49, colors[id]);
  circle(c, x, y, s * 0.3, '#f4cf6f');
  circle(c, x, y, Math.min(2.5, s * 0.08), '#7b4c2c');
  const sheen = c.createRadialGradient(x - s * 0.4, y - s * 0.45, 0, x - s * 0.2, y - s * 0.2, s * 1.1);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
  circle(c, x, y, s, sheen);
  c.lineWidth = hot ? 2.5 : 1;
  c.strokeStyle = hot ? '#fff2c4' : 'rgba(255, 249, 230, 0.8)';
  c.beginPath();
  c.arc(x, y, s - 0.5, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

export type DrawOptions = { aim: Point | null; touch: boolean; u: number; short: boolean };

export function drawRange(
  c: CanvasRenderingContext2D, width: number, height: number, g: RangeState,
  targets: Target[], feedback: Feedback[], fx: Fx, o: DrawOptions,
) {
  const w = width;
  const h = height;
  const u = o.u;
  const t = fx.clock;
  c.save();
  c.clearRect(0, 0, w, h);
  if (fx.shake > 0) {
    const k = fx.shake * fx.shake * 3;
    c.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
  }
  backdrop(c, w, h, g, t);

  for (const hole of fx.holes) {
    const a = Math.max(0, Math.min(1, (2.4 - hole.age) / 0.6));
    circle(c, hole.x * w, hole.y * h, 4, `rgba(255, 240, 210, ${0.12 * a})`);
    circle(c, hole.x * w, hole.y * h, 2.6, `rgba(10, 18, 18, ${0.75 * a})`);
  }

  const wave = waveAt(g.wave);
  const r = targets[0]?.radius ?? 30;
  const map = (p: Point) => toCanvas(p, w, h, r);
  if (g.phase === 'intro' || g.phase === 'live') {
    c.save();
    c.strokeStyle = '#8fb1a6';
    c.globalAlpha = g.phase === 'intro' ? 0.5 : 0.3;
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.setLineDash([2, 9]);
    c.beginPath();
    wave.patterns.forEach((pattern, slot) => guide(c, map, pattern, slot));
    c.stroke();
    c.restore();
  }

  if (wave.patterns.includes('pendulum') && targets.length) {
    const pivot = map({ x: 0.5, y: PENDULUM.pivot });
    c.strokeStyle = '#a7bfb3';
    c.lineWidth = 1.5;
    c.beginPath();
    for (const { x, y, id } of targets) {
      if (wave.patterns[id] !== 'pendulum') continue;
      c.moveTo(pivot.x, pivot.y);
      c.lineTo(x, y);
    }
    c.stroke();
    circle(c, pivot.x, pivot.y, 4, '#d9c99d');
  }

  const aimPx = o.aim && !o.touch ? { x: o.aim.x * w, y: o.aim.y * h } : null;
  let onTarget = false;
  for (const tg of targets) {
    const age = fx.shown[tg.id];
    // A quick overshoot as each target flips up.
    const pop = g.phase === 'intro' ? 0.86 : age >= 0.26 ? 1 : 1 + 0.12 * Math.sin((age / 0.26) * Math.PI) - (1 - age / 0.26) ** 2;
    const hot = !!aimPx && g.phase === 'live' && Math.hypot(aimPx.x - tg.x, aimPx.y - tg.y) <= tg.radius;
    onTarget ||= hot;
    target(c, tg.x, tg.y, tg.radius, tg.id, Math.max(0, pop), g.phase === 'intro' ? 0.55 : 1, hot);
  }

  for (const b of fx.bits) {
    const a = Math.max(0, 1 - b.age / b.life);
    c.save();
    c.globalAlpha = a;
    c.translate(b.x * w, b.y * h);
    if (b.kind === 'shard') {
      c.rotate(b.angle);
      c.fillStyle = b.color;
      c.beginPath();
      c.moveTo(-b.size, -b.size * 0.35);
      c.lineTo(b.size * 0.8, -b.size * 0.5);
      c.lineTo(b.size * 0.3, b.size * 0.55);
      c.closePath();
      c.fill();
    } else {
      circle(c, 0, 0, b.size * (b.kind === 'dust' ? 1 + b.age * 3 : a), b.kind === 'dust' ? `rgba(185, 199, 189, ${0.5 * a})` : b.color);
    }
    c.restore();
  }

  for (const f of feedback) {
    const { x, y, age, shot } = f;
    c.save();
    const fade = Math.max(0, 1 - age / 0.8);
    c.globalAlpha = fade;
    if (shot.kind !== 'miss') {
      c.lineWidth = 2;
      c.strokeStyle = shot.kind === 'bullseye' ? '#ffe39a' : '#e3f3ea';
      c.beginPath();
      c.arc(x, y, (shot.target?.radius ?? 25) * (0.7 + age * 1.6), 0, Math.PI * 2);
      c.stroke();
    }
    const grow = age < 0.12 ? 0.7 + (age / 0.12) * 0.45 : 1.15 - Math.min(0.15, (age - 0.12) * 0.6);
    const px = (shot.kind === 'bullseye' ? 17 : 15) * u * grow;
    c.font = font(px, 700);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = shot.kind === 'miss' ? 'Miss' : shot.kind === 'bullseye' ? `Bullseye +${shot.points}` : `+${shot.points}`;
    const tw = c.measureText(label).width;
    const lx = Math.max(tw / 2 + 6, Math.min(w - tw / 2 - 6, x));
    const ly = Math.max(px, Math.min(h - px, y - (shot.target?.radius ?? 14) - 10 - age * 26));
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(10, 26, 26, 0.7)';
    c.strokeText(label, lx, ly);
    c.fillStyle = shot.kind === 'miss' ? '#f0b39d' : shot.kind === 'bullseye' ? '#ffe39a' : '#f6eedb';
    c.fillText(label, lx, ly);
    c.restore();
  }

  for (const p of fx.pops) {
    const k = p.age < 0.15 ? p.age / 0.15 : 1;
    c.save();
    c.globalAlpha = Math.max(0, 1 - Math.max(0, p.age - 0.45) / 0.45);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const px = Math.min(24, Math.max(16, h * 0.1)) * u * (0.8 + 0.25 * k);
    c.font = font(px, 800);
    const y = h * (o.short ? 0.5 : 0.3) - p.age * 16;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(10, 26, 26, 0.6)';
    c.strokeText(p.text, w / 2, y);
    c.fillStyle = '#ffd879';
    c.fillText(p.text, w / 2, y);
    c.restore();
  }

  if (g.phase === 'live' && g.timeLeft <= 5) {
    const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    const edge = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    edge.addColorStop(0, 'rgba(220, 70, 50, 0)');
    edge.addColorStop(1, `rgba(220, 70, 50, ${0.12 + 0.18 * beat})`);
    c.fillStyle = edge;
    c.fillRect(0, 0, w, h);
  }

  if (o.short && g.phase === 'live' && g.combo >= 3) {
    c.font = font(13 * u);
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#ffd879';
    c.fillText(`${multiplier(g.combo)}× Streak`, w - 8, h - Math.max(8, Math.min(18, h * 0.08)) - 6);
  }

  if (aimPx && g.phase === 'live') {
    const { x, y } = aimPx;
    const gap = 6 + fx.recoil * 5;
    c.strokeStyle = 'rgba(10, 26, 26, 0.55)';
    c.lineWidth = 4;
    reticle(c, x, y, gap);
    c.strokeStyle = onTarget ? '#ffe39a' : '#fff9e8';
    c.lineWidth = 1.75;
    reticle(c, x, y, gap);
    circle(c, x, y, 1.6, onTarget ? '#ffe39a' : '#fff9e8');
  }

  if (g.phase === 'intro' || g.phase === 'clear') panel(c, w, h, g, u, o.short);
  c.restore();
}

function reticle(c: CanvasRenderingContext2D, x: number, y: number, gap: number) {
  c.beginPath();
  c.arc(x, y, gap + 4, 0, Math.PI * 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    c.moveTo(x + dx * (gap + 7), y + dy * (gap + 7));
    c.lineTo(x + dx * (gap + 13), y + dy * (gap + 13));
  }
  c.stroke();
}

function panel(c: CanvasRenderingContext2D, w: number, h: number, g: RangeState, u: number, short: boolean) {
  const wave = waveAt(g.wave);
  const intro = g.phase === 'intro';
  const elapsed = (intro ? INTRO_SECONDS : CLEAR_SECONDS) - g.phaseLeft;
  const k = Math.min(1, elapsed / 0.18);
  const scale = 0.92 + 0.08 * (1 - (1 - k) ** 3);
  const big = (short ? 18 : 23) * u;
  const small = (short ? 13 : 14) * u;
  const lines = short ? 2 : 3;
  const panelW = Math.min(300 * u, w - 20);
  const panelH = Math.min((short ? 62 : 104) * u, h - 12);
  c.save();
  c.globalAlpha = k;
  c.translate(w / 2, h / 2);
  c.scale(scale, scale);
  c.fillStyle = 'rgba(14, 34, 34, 0.88)';
  c.beginPath();
  c.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
  c.fill();
  c.strokeStyle = 'rgba(255, 240, 210, 0.12)';
  c.lineWidth = 1;
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const max = panelW - 24;
  const top = lines === 3 ? -panelH / 2 + panelH * 0.24 : 0;
  if (lines === 3) {
    c.fillStyle = '#a9c2b7';
    c.font = font(small, 500);
    c.fillText(intro ? `Wave ${g.wave + 1}` : `Wave ${g.wave + 1} Done`, 0, top, max);
  }
  c.fillStyle = '#f6eedb';
  c.font = font(big, 700);
  const titleY = lines === 3 ? 0 : -panelH * 0.16;
  c.fillText(intro ? wave.name : 'Wave Cleared', 0, titleY + (lines === 3 ? 2 : 0), max);
  c.fillStyle = intro ? '#c8d7cb' : '#ffd879';
  c.font = font(small, 500);
  // Mayhem hints name all three patterns, so squeeze rather than spill past the panel.
  const sub = intro ? `${wave.hint}. Hit ${wave.goal}.` : `Time Bonus +${g.bonus}`;
  c.fillText(sub, 0, lines === 3 ? panelH / 2 - panelH * 0.22 : panelH * 0.22, max);
  c.restore();
}
