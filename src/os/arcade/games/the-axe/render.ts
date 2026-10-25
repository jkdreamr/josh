// Canvas drawing for The Axe: field, players, axes, effects and the HUD. Pure canvas, no DOM.
import { FIELD, OBSTACLES, PLAYER_R, type GameEvent, type World } from './logic.ts';

export type View = { w: number; h: number; rotate: boolean; scale: number; ox: number; oy: number };

const L = FIELD.L;
const W = FIELD.W;
const RIM = 1.6;
export const TEAM_NAMES = ['stanford', 'cal'] as const;
export const TEAM = [
  { main: '#c8102e', dark: '#7d0a1c', light: '#ff8a8a', text: '#ffffff', zone: '#8c1515', zoneText: '#ffffff' },
  { main: '#2f5fd0', dark: '#0d2a66', light: '#9bb8ff', text: '#fdb515', zone: '#003262', zoneText: '#fdb515' },
] as const;
const GOLD = '#fdb515';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Fits the field (plus its rim) under the HUD; a tall screen turns it to run up the screen, stanford at the bottom. */
export function makeView(w: number, h: number, hudTop: number): View {
  const rotate = h > w * 1.15;
  const top = Math.max(0, hudTop) + (w < 560 ? 44 : 0);
  const bottom = rotate ? 10 : 8;
  const side = 8;
  const fw = (rotate ? W : L) + RIM * 2;
  const fh = (rotate ? L : W) + RIM * 2;
  const aw = Math.max(40, w - side * 2);
  const ah = Math.max(40, h - top - bottom);
  const scale = Math.max(1, Math.min(aw / fw, ah / fh));
  const ox = (w - fw * scale) / 2 + RIM * scale;
  const oy = top + (ah - fh * scale) / 2 + RIM * scale;
  return { w, h, rotate, scale, ox, oy };
}

/** A screen direction (stick or arrow keys) as a field direction. */
export function screenToField(view: View, dx: number, dy: number): { x: number; y: number } {
  return view.rotate ? { x: -dy, y: dx } : { x: dx, y: dy };
}

/** A field point on screen, in CSS pixels. */
export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return view.rotate ? { x: view.ox + y * view.scale, y: view.oy + (L - x) * view.scale } : { x: view.ox + x * view.scale, y: view.oy + y * view.scale };
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind: 'confetti' | 'dust' | 'spark' | 'leaf'; spin: number };
type Popup = { x: number; y: number; text: string; color: string; life: number };
type Note = { text: string; color: string; life: number };
type Ring = { x: number; y: number; color: string; life: number; max: number; r: number };
type Flash = { text: string; sub: string; color: string; life: number; max: number };

export type Fx = { t: number; particles: Particle[]; popups: Popup[]; feed: Note[]; rings: Ring[]; flash: Flash | null; shake: number; dustT: number; lastDraw: number; seed: number };

export const createFx = (): Fx => ({ t: 0, particles: [], popups: [], feed: [], rings: [], flash: null, shake: 0, dustT: 0, lastDraw: 0, seed: 1 });

const rand = (fx: Fx) => {
  fx.seed = (fx.seed * 16807) % 2147483647;
  return fx.seed / 2147483647;
};

const note = (fx: Fx, text: string, color = '#ffffff') => {
  fx.feed.unshift({ text, color, life: 4.5 });
  if (fx.feed.length > 4) fx.feed.length = 4;
};

const confetti = (fx: Fx, x: number, y: number, team: 0 | 1, count = 70) => {
  const colors = team === 0 ? ['#c8102e', '#ffffff', '#ff6b6b', GOLD] : ['#2f5fd0', GOLD, '#ffffff', '#9bb8ff'];
  for (let i = 0; i < count; i++) {
    const a = rand(fx) * Math.PI * 2;
    const v = 4 + rand(fx) * 14;
    fx.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 1.4 + rand(fx) * 1.2, color: colors[i % colors.length], size: 0.35 + rand(fx) * 0.35, kind: 'confetti', spin: rand(fx) * 10 });
  }
};

const sparks = (fx: Fx, x: number, y: number, color: string, count = 10) => {
  for (let i = 0; i < count; i++) {
    const a = rand(fx) * Math.PI * 2;
    const v = 3 + rand(fx) * 6;
    fx.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + rand(fx) * 0.25, color, size: 0.22, kind: 'spark', spin: 0 });
  }
};

export function fxEvents(fx: Fx, events: GameEvent[], world: World, nameOf: (id: number) => string): void {
  const team = (id: number) => world.players[id]?.team ?? 0;
  for (const e of events) {
    if (e.type === 'tag') {
      note(fx, `${nameOf(e.by)} tagged ${nameOf(e.who)}`, TEAM[team(e.by)].light);
      fx.rings.push({ x: e.x, y: e.y, color: '#ffffff', life: 0, max: 0.45, r: 3.2 });
      fx.popups.push({ x: e.x, y: e.y - 1.5, text: 'tagged!', color: '#ffffff', life: 1.1 });
      sparks(fx, e.x, e.y, TEAM[team(e.by)].light, 12);
      fx.shake = Math.max(fx.shake, 0.3);
    } else if (e.type === 'free') {
      note(fx, `jailbreak! ${nameOf(e.by)} freed ${e.count}`, GOLD);
      const p = world.players[e.by];
      if (p) {
        fx.popups.push({ x: p.x, y: p.y - 1.5, text: 'jailbreak!', color: GOLD, life: 1.4 });
        fx.rings.push({ x: p.x, y: p.y, color: GOLD, life: 0, max: 0.6, r: 5 });
        sparks(fx, p.x, p.y, GOLD, 16);
      }
      fx.shake = Math.max(fx.shake, 0.35);
    } else if (e.type === 'steal') {
      const neutral = world.axes[e.axe]?.owner === -1;
      note(fx, neutral ? `${nameOf(e.who)} has the axe!` : `axe stolen! ${nameOf(e.who)} has it`, TEAM[team(e.who)].light);
      const p = world.players[e.who];
      if (p) {
        fx.rings.push({ x: p.x, y: p.y, color: GOLD, life: 0, max: 0.6, r: 4 });
        sparks(fx, p.x, p.y, GOLD, 14);
      }
      fx.shake = Math.max(fx.shake, 0.4);
    } else if (e.type === 'drop') {
      note(fx, 'the axe went back', '#e8e8e8');
      fx.rings.push({ x: e.x, y: e.y, color: GOLD, life: 0, max: 0.5, r: 3 });
      const a = world.axes[e.axe];
      if (a) fx.rings.push({ x: a.homeX, y: a.homeY, color: GOLD, life: 0, max: 0.7, r: 4 });
    } else if (e.type === 'capture') {
      const p = world.players[e.who];
      note(fx, `${nameOf(e.who)} scored for ${TEAM_NAMES[e.team]}!`, TEAM[e.team].light);
      confetti(fx, p?.x ?? L / 2, p?.y ?? W / 2, e.team, 90);
      confetti(fx, e.team === 0 ? 3 : L - 3, 6, e.team, 30);
      confetti(fx, e.team === 0 ? 3 : L - 3, W - 6, e.team, 30);
      fx.flash = { text: `${TEAM_NAMES[e.team]} scores!`, sub: `${nameOf(e.who)} brought the axe home`, color: TEAM[e.team].main, life: 0, max: 2.6 };
      if (world.mode === 'big') fx.flash.sub = `${nameOf(e.who)} carried it in`;
      fx.shake = 1;
    } else if (e.type === 'pickup') {
      note(fx, `${nameOf(e.who)} grabbed ${e.kind === 'drum' ? 'the band drum' : 'a tree costume'}`, e.kind === 'drum' ? '#ffd36b' : '#8ee08e');
      fx.popups.push({ x: e.x, y: e.y - 1.4, text: e.kind === 'drum' ? 'boom!' : 'zoom!', color: e.kind === 'drum' ? '#ffd36b' : '#8ee08e', life: 1 });
      if (e.kind === 'drum') {
        fx.rings.push({ x: e.x, y: e.y, color: '#ffd36b', life: 0, max: 0.55, r: 7 });
        fx.shake = Math.max(fx.shake, 0.5);
      } else sparks(fx, e.x, e.y, '#8ee08e', 12);
    } else if (e.type === 'stun') {
      const p = world.players[e.who];
      if (p) fx.popups.push({ x: p.x, y: p.y - 1.4, text: 'dazed', color: '#ffd36b', life: 0.9 });
    } else if (e.type === 'tree') {
      note(fx, `${nameOf(e.who)} is the tree!`, '#8ee08e');
      const p = world.players[e.who];
      if (p) {
        fx.rings.push({ x: p.x, y: p.y, color: '#8ee08e', life: 0, max: 0.6, r: 4 });
        for (let i = 0; i < 12; i++) {
          const a = rand(fx) * Math.PI * 2;
          fx.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, life: 0, max: 0.9, color: i % 2 ? '#3f9a4b' : '#8ee08e', size: 0.4, kind: 'leaf', spin: rand(fx) * 6 });
        }
      }
      fx.shake = Math.max(fx.shake, 0.25);
    } else if (e.type === 'overtime') {
      note(fx, 'overtime! next capture wins', GOLD);
      fx.flash = { text: 'golden capture', sub: 'next capture wins', color: '#8a6a00', life: 0, max: 2.4 };
    }
  }
}

export function fxStep(fx: Fx, dt: number): void {
  fx.t += dt;
  fx.shake = Math.max(0, fx.shake - dt * 2.4);
  for (const p of fx.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const drag = p.kind === 'confetti' ? 2.2 : p.kind === 'dust' ? 3 : 4;
    p.vx -= p.vx * Math.min(1, drag * dt);
    p.vy -= p.vy * Math.min(1, drag * dt);
    p.spin += dt * 8;
  }
  fx.particles = fx.particles.filter((p) => p.life < p.max);
  if (fx.particles.length > 600) fx.particles.splice(0, fx.particles.length - 600);
  for (const p of fx.popups) {
    p.life -= dt;
    p.y -= dt * 1.4;
  }
  fx.popups = fx.popups.filter((p) => p.life > 0);
  for (const n of fx.feed) n.life -= dt;
  fx.feed = fx.feed.filter((n) => n.life > 0);
  for (const r of fx.rings) r.life += dt;
  fx.rings = fx.rings.filter((r) => r.life < r.max);
  if (fx.flash) {
    fx.flash.life += dt;
    if (fx.flash.life >= fx.flash.max) fx.flash = null;
  }
}

export type DrawOpts = { me: number[]; nameOf: (id: number) => string; sticks: { ox: number; oy: number; x: number; y: number }[]; watching: boolean; banner: string | null; touch: boolean };

// ---------------------------------------------------------------------------------------------------------------
// World-space drawing (inside the field transform)

const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
};

const inField = (c: CanvasRenderingContext2D, view: View, shake: { x: number; y: number }) => {
  c.save();
  if (view.rotate) {
    c.translate(view.ox + shake.x, view.oy + L * view.scale + shake.y);
    c.scale(view.scale, view.scale);
    c.rotate(-Math.PI / 2);
  } else {
    c.translate(view.ox + shake.x, view.oy + shake.y);
    c.scale(view.scale, view.scale);
  }
};

/** Draws text upright at a field point, whichever way the field runs. */
const uprightText = (c: CanvasRenderingContext2D, view: View, text: string, x: number, y: number, px: number) => {
  c.save();
  c.translate(x, y);
  if (view.rotate) c.rotate(Math.PI / 2);
  c.font = `800 ${px}px ${FONT}`;
  c.fillText(text, 0, 0);
  c.restore();
};

function drawField(c: CanvasRenderingContext2D, view: View, world: World, t: number) {
  // rim (track + sideline area)
  rr(c, -RIM, -RIM, L + RIM * 2, W + RIM * 2, 1.2);
  c.fillStyle = '#2b6b37';
  c.fill();
  // grass stripes
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 ? '#47a352' : '#3f9a4b';
    c.fillRect(i * 5, 0, 5, W);
  }
  // halves tint
  c.fillStyle = 'rgba(200, 16, 46, 0.07)';
  c.fillRect(0, 0, L / 2, W);
  c.fillStyle = 'rgba(47, 95, 208, 0.08)';
  c.fillRect(L / 2, 0, L / 2, W);
  // end zones
  const end = FIELD.END;
  for (const team of [0, 1] as const) {
    const x0 = team === 0 ? 0 : L - end;
    c.fillStyle = TEAM[team].zone;
    c.fillRect(x0, 0, end, W);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < W; y += 2) c.fillRect(x0, y, end, 1);
    // big lettering
    c.save();
    c.translate(x0 + end / 2, W / 2);
    c.rotate(view.rotate ? Math.PI / 2 : team === 0 ? -Math.PI / 2 : Math.PI / 2);
    c.fillStyle = TEAM[team].zoneText;
    c.globalAlpha = 0.22;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${view.rotate ? 2.2 : 3.2}px ${FONT}`;
    const word = TEAM_NAMES[team];
    if (view.rotate) {
      c.fillText(word, 0, -9);
      c.fillText(word, 0, 9);
    } else {
      c.fillText(word, -9, 0);
      c.fillText(word, 9, 0);
    }
    c.restore();
  }
  // yard lines
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 0.18;
  c.beginPath();
  for (let x = end; x <= L - end + 0.01; x += 4) {
    c.moveTo(x, 0);
    c.lineTo(x, W);
  }
  c.stroke();
  // hash marks
  c.lineWidth = 0.12;
  c.beginPath();
  for (let x = end + 1; x < L - end; x += 1) {
    if ((x - end) % 4 === 0) continue;
    for (const y of [0.2, W / 3, (W * 2) / 3 - 0.6, W - 0.8]) {
      c.moveTo(x, y);
      c.lineTo(x, y + 0.6);
    }
  }
  c.stroke();
  // midline
  c.strokeStyle = '#ffffff';
  c.lineWidth = 0.4;
  c.beginPath();
  c.moveTo(L / 2, 0);
  c.lineTo(L / 2, W);
  c.stroke();
  // boundary
  c.lineWidth = 0.35;
  c.strokeRect(0, 0, L, W);
  // midfield emblem ring (under the fountain or the big game pedestal)
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 0.2;
  c.beginPath();
  c.arc(L / 2, W / 2, 4.2, 0, Math.PI * 2);
  c.stroke();
  void t;
  void world;
}

function drawJail(c: CanvasRenderingContext2D, team: 0 | 1, t: number, count: number) {
  const j = FIELD.JAILS[team];
  const color = TEAM[team].main;
  c.save();
  rr(c, j.x, j.y, j.w, j.h, 0.6);
  c.fillStyle = 'rgba(20, 20, 28, 0.38)';
  c.fill();
  c.lineWidth = 0.3;
  c.strokeStyle = color;
  c.setLineDash([0.8, 0.5]);
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 0.14;
  c.beginPath();
  for (let x = j.x + 1; x < j.x + j.w; x += 1) {
    c.moveTo(x, j.y + 0.3);
    c.lineTo(x, j.y + j.h - 0.3);
  }
  c.stroke();
  if (count > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    rr(c, j.x - 0.3, j.y - 0.3, j.w + 0.6, j.h + 0.6, 0.9);
    c.strokeStyle = `rgba(253, 181, 21, ${0.35 + pulse * 0.45})`;
    c.lineWidth = 0.25;
    c.stroke();
  }
  c.restore();
}

function drawObstacles(c: CanvasRenderingContext2D, world: World, t: number) {
  for (const o of OBSTACLES) {
    if (o.kind === 'fountain' && world.mode === 'big') continue;
    if (o.shape === 'circle') {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath();
      c.arc(o.x + 0.25, o.y + 0.35, o.r + 0.1, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#d9d2c3';
      c.beginPath();
      c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#5fb7e6';
      c.beginPath();
      c.arc(o.x, o.y, o.r - 0.45, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 0.12;
      for (let i = 0; i < 2; i++) {
        const k = ((t * 0.5 + i * 0.5) % 1);
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.arc(o.x, o.y, 0.4 + k * (o.r - 0.9), 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.fillStyle = '#ece6d8';
      c.beginPath();
      c.arc(o.x, o.y, 0.45, 0, Math.PI * 2);
      c.fill();
    } else if (o.kind === 'hedge') {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      rr(c, o.x + 0.25, o.y + 0.35, o.w, o.h, 0.6);
      c.fill();
      c.fillStyle = '#1f6b2a';
      rr(c, o.x, o.y, o.w, o.h, 0.6);
      c.fill();
      c.fillStyle = '#2d8a3a';
      const along = o.h >= o.w;
      const n = Math.max(2, Math.round((along ? o.h : o.w) / 1.1));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        c.beginPath();
        c.arc(along ? o.x + o.w / 2 : o.x + o.w * f, along ? o.y + o.h * f : o.y + o.h / 2, Math.min(o.w, o.h) * 0.42, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      c.fillStyle = 'rgba(0,0,0,0.2)';
      rr(c, o.x + 0.2, o.y + 0.3, o.w, o.h, 0.3);
      c.fill();
      c.fillStyle = '#6d7480';
      rr(c, o.x, o.y, o.w, o.h, 0.3);
      c.fill();
      c.strokeStyle = '#c9ced6';
      c.lineWidth = 0.14;
      const along = o.w >= o.h;
      const n = Math.max(2, Math.round((along ? o.w : o.h) / 0.7));
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        const cx = along ? o.x + o.w * f : o.x + o.w / 2;
        const cy = along ? o.y + o.h / 2 : o.y + o.h * f;
        c.moveTo(cx + 0.25, cy);
        c.arc(cx, cy, 0.25, 0, Math.PI * 2);
      }
      c.stroke();
    }
  }
}

/** The axe trophy: a glowing axe head on a short plaque handle, drawn around (0,0) in field units. */
function axeShape(c: CanvasRenderingContext2D, owner: -1 | 0 | 1, size: number) {
  c.save();
  c.scale(size, size);
  c.rotate(-0.6);
  // handle
  c.fillStyle = '#8a5a2b';
  rr(c, -0.14, -0.9, 0.28, 1.9, 0.12);
  c.fill();
  c.fillStyle = '#6b4220';
  c.fillRect(-0.14, 0.55, 0.28, 0.12);
  // blade
  c.beginPath();
  c.moveTo(0.1, -0.85);
  c.lineTo(0.95, -1.15);
  c.quadraticCurveTo(1.15, -0.55, 0.95, 0.05);
  c.lineTo(0.1, -0.3);
  c.closePath();
  c.fillStyle = '#e9edf2';
  c.fill();
  c.strokeStyle = owner === 1 ? '#2f5fd0' : owner === 0 ? '#c8102e' : GOLD;
  c.lineWidth = 0.16;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.moveTo(0.92, -1.05);
  c.quadraticCurveTo(1.07, -0.55, 0.92, -0.05);
  c.lineWidth = 0.08;
  c.strokeStyle = '#ffffff';
  c.stroke();
  c.restore();
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(253,181,21,0)');
  c.globalAlpha = alpha;
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
}

function drawPedestals(c: CanvasRenderingContext2D, world: World, t: number) {
  for (const a of world.axes) {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(a.homeX + 0.2, a.homeY + 0.3, 1.5, 1.4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f2e6c4';
    c.beginPath();
    c.arc(a.homeX, a.homeY, 1.35, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = a.owner === 1 ? GOLD : a.owner === 0 ? '#ffffff' : GOLD;
    c.lineWidth = 0.22;
    c.stroke();
    c.fillStyle = a.owner === 1 ? TEAM[1].dark : a.owner === 0 ? TEAM[0].dark : '#5b4300';
    c.beginPath();
    c.arc(a.homeX, a.homeY, 0.95, 0, Math.PI * 2);
    c.fill();
    if (a.carrier < 0 && (a.x !== a.homeX || a.y !== a.homeY)) continue;
    if (a.carrier >= 0) {
      // empty pedestal blinks
      const blink = 0.4 + 0.4 * Math.sin(t * 8);
      c.strokeStyle = `rgba(255,255,255,${blink})`;
      c.setLineDash([0.4, 0.3]);
      c.lineWidth = 0.14;
      c.beginPath();
      c.arc(a.homeX, a.homeY, 1.7, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
  }
}

function drawAxes(c: CanvasRenderingContext2D, view: View, world: World, t: number) {
  for (const a of world.axes) {
    const carried = a.carrier >= 0;
    const bob = carried ? 0 : Math.sin(t * 2.6) * 0.15;
    const x = carried ? a.x : a.x;
    const y = carried ? a.y - 1.5 : a.y - 0.2 + bob;
    glow(c, x, y, carried ? 3.2 : 2.6, 'rgba(253,181,21,0.85)', carried ? 0.55 + 0.25 * Math.sin(t * 10) : 0.45);
    c.save();
    c.translate(x, y);
    if (view.rotate) c.rotate(Math.PI / 2);
    axeShape(c, a.owner as -1 | 0 | 1, carried ? 0.95 : 1.05);
    c.restore();
  }
}

function drawPickups(c: CanvasRenderingContext2D, view: View, world: World, t: number) {
  for (const p of world.pickups) {
    const bob = Math.sin(t * 3 + p.id) * 0.15;
    glow(c, p.x, p.y, 1.8, p.kind === 'drum' ? 'rgba(255,211,107,0.8)' : 'rgba(142,224,142,0.8)', 0.5);
    c.save();
    c.translate(p.x, p.y + bob);
    if (view.rotate) c.rotate(Math.PI / 2);
    if (p.kind === 'drum') {
      c.fillStyle = '#c8102e';
      rr(c, -0.75, -0.45, 1.5, 0.95, 0.2);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(0, -0.45, 0.75, 0.32, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = GOLD;
      c.lineWidth = 0.1;
      c.beginPath();
      c.moveTo(-0.7, -0.2);
      c.lineTo(-0.2, 0.45);
      c.lineTo(0.2, -0.2);
      c.lineTo(0.7, 0.45);
      c.stroke();
      c.strokeStyle = '#6b4220';
      c.lineWidth = 0.12;
      c.beginPath();
      c.moveTo(0.2, -0.6);
      c.lineTo(0.9, -1.2);
      c.stroke();
    } else {
      c.fillStyle = '#6b4220';
      c.fillRect(-0.15, 0.3, 0.3, 0.45);
      c.fillStyle = '#2d8a3a';
      c.beginPath();
      c.moveTo(0, -1.05);
      c.lineTo(0.75, 0.35);
      c.lineTo(-0.75, 0.35);
      c.closePath();
      c.fill();
      c.fillStyle = '#47b356';
      c.beginPath();
      c.moveTo(0, -1.05);
      c.lineTo(0.5, -0.15);
      c.lineTo(-0.5, -0.15);
      c.closePath();
      c.fill();
    }
    c.restore();
  }
}

function drawTreeCrown(c: CanvasRenderingContext2D, x: number, y: number, view: View, t: number) {
  c.save();
  c.translate(x, y);
  if (view.rotate) c.rotate(Math.PI / 2);
  const sway = Math.sin(t * 4) * 0.08;
  c.rotate(sway);
  c.fillStyle = '#1f6b2a';
  c.beginPath();
  c.moveTo(0, -2.6);
  c.lineTo(1.1, -0.6);
  c.lineTo(-1.1, -0.6);
  c.closePath();
  c.fill();
  c.fillStyle = '#3f9a4b';
  c.beginPath();
  c.moveTo(0, -3.2);
  c.lineTo(0.8, -1.7);
  c.lineTo(-0.8, -1.7);
  c.closePath();
  c.fill();
  c.restore();
}

function drawPlayers(c: CanvasRenderingContext2D, view: View, world: World, fx: Fx, me: Set<number>) {
  const t = fx.t;
  const order = [...world.players].sort((a, b) => (view.rotate ? b.x - a.x : a.y - b.y));
  for (const p of order) {
    const team = TEAM[p.team];
    const r = PLAYER_R;
    const blink = p.immuneT > 0 && !p.jailed && Math.floor(t * 12) % 2 === 0;
    const alpha = p.safe ? 0.55 : blink ? 0.45 : 1;
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(p.x + 0.15, p.y + 0.3, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
    c.fill();
    if (p.carrying >= 0) glow(c, p.x, p.y, 3, 'rgba(253,181,21,0.9)', 0.4 + 0.2 * Math.sin(t * 9));
    if (p.boostT > 0) glow(c, p.x, p.y, 2.2, 'rgba(142,224,142,0.9)', 0.35);
    if (me.has(p.id)) {
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 0.16;
      c.beginPath();
      c.ellipse(p.x, p.y + 0.15, r + 0.55, r + 0.45, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = alpha;
    // body
    c.fillStyle = p.jailed ? team.dark : team.main;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = me.has(p.id) ? 0.24 : 0.16;
    c.strokeStyle = p.team === 1 ? GOLD : '#ffffff';
    c.stroke();
    // highlight
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    c.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.38, 0, Math.PI * 2);
    c.fill();
    // eyes
    const fxx = Math.cos(p.face);
    const fyy = Math.sin(p.face);
    const px = -fyy;
    const py = fxx;
    c.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.arc(p.x + fxx * r * 0.45 + px * s * r * 0.32, p.y + fyy * r * 0.45 + py * s * r * 0.32, r * 0.2, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#1a1a22';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.arc(p.x + fxx * r * 0.55 + px * s * r * 0.32, p.y + fyy * r * 0.55 + py * s * r * 0.32, r * 0.1, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    if (p.safe) {
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 0.12;
      c.setLineDash([0.35, 0.25]);
      c.beginPath();
      c.arc(p.x, p.y, r + 0.35, t * 2, t * 2 + Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    if (p.stunT > 0) {
      c.fillStyle = '#ffd36b';
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * Math.PI * 2) / 3;
        c.beginPath();
        c.arc(p.x + Math.cos(a) * 1.1, p.y + Math.sin(a) * 0.5 - 1.1, 0.2, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (world.mode === 'tree' && world.tree === p.id) drawTreeCrown(c, p.x, p.y, view, t);
    // stamina arc for local players
    if (me.has(p.id) && p.stamina < 0.999 && !p.jailed) {
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = 0.28;
      c.beginPath();
      c.arc(p.x, p.y, r + 0.95, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = p.stamina < 0.25 ? '#ff6b5a' : '#ffffff';
      c.beginPath();
      const start = view.rotate ? 0 : -Math.PI / 2;
      c.arc(p.x, p.y, r + 0.95, start, start + Math.PI * 2 * p.stamina);
      c.stroke();
    }
  }
}

function drawParticles(c: CanvasRenderingContext2D, fx: Fx) {
  for (const p of fx.particles) {
    const k = p.life / p.max;
    c.globalAlpha = Math.max(0, 1 - k * k);
    c.fillStyle = p.color;
    if (p.kind === 'confetti' || p.kind === 'leaf') {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.spin);
      c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      c.restore();
    } else {
      c.beginPath();
      c.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1 + k : 1 - k * 0.5), 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  for (const r of fx.rings) {
    const k = r.life / r.max;
    c.globalAlpha = 1 - k;
    c.strokeStyle = r.color;
    c.lineWidth = 0.3 * (1 - k) + 0.05;
    c.beginPath();
    c.arc(r.x, r.y, 0.6 + r.r * k, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function spawnDust(fx: Fx, world: World) {
  if (fx.t - fx.dustT < 0.06) return;
  fx.dustT = fx.t;
  for (const p of world.players) {
    if (!p.sprinting && p.boostT <= 0) continue;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp < 3) continue;
    fx.particles.push({
      x: p.x - (p.vx / sp) * 0.8 + (rand(fx) - 0.5) * 0.4,
      y: p.y - (p.vy / sp) * 0.8 + 0.3,
      vx: -p.vx * 0.08,
      vy: -p.vy * 0.08,
      life: 0,
      max: 0.4,
      color: p.boostT > 0 ? 'rgba(142,224,142,0.7)' : 'rgba(240,235,220,0.55)',
      size: 0.3,
      kind: 'dust',
      spin: 0,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Screen-space HUD

const outlined = (c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke = 'rgba(10,14,20,0.85)', width = 3) => {
  c.lineJoin = 'round';
  c.lineWidth = width;
  c.strokeStyle = stroke;
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
};

const clockText = (s: number) => {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function drawNames(c: CanvasRenderingContext2D, view: View, world: World, opts: DrawOpts, shake: { x: number; y: number }) {
  const me = new Set(opts.me);
  const px = Math.round(Math.max(10, Math.min(14, view.scale * 0.62)));
  c.font = `700 ${px}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  const many = world.players.length > 6 && view.scale < 13;
  for (const p of world.players) {
    if (p.jailed && !me.has(p.id)) continue;
    if (many && !me.has(p.id) && p.ai !== null && p.carrying < 0 && !(world.mode === 'tree' && world.tree === p.id)) continue;
    const s = toScreen(view, p.x, p.y);
    const lift = world.mode === 'tree' && world.tree === p.id ? 3.4 : p.carrying >= 0 ? 2.9 : 1.25;
    const y = s.y + shake.y - lift * view.scale;
    const name = opts.nameOf(p.id);
    outlined(c, name, s.x + shake.x, y, me.has(p.id) ? '#ffffff' : p.team === 1 ? '#ffe39a' : '#ffd6d6', 'rgba(10,14,20,0.8)', 3);
  }
}

function chip(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: string) {
  rr(c, x, y, w, h, h / 2);
  c.fillStyle = bg;
  c.fill();
}

function pillText(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const height = 17;
  const width = c.measureText(text).width + 12;
  rr(c, x - 6, y - height / 2, width, height, height / 2);
  c.fillStyle = 'rgba(10,14,20,0.55)';
  c.fill();
  outlined(c, text, x, y, color);
}

function drawArrowTo(c: CanvasRenderingContext2D, view: View, from: { x: number; y: number }, to: { x: number; y: number }, color: string, t: number) {
  const a = toScreen(view, from.x, from.y);
  const b = toScreen(view, to.x, to.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < view.scale * 7) return;
  const ux = dx / d;
  const uy = dy / d;
  const r = view.scale * 2.6 + 2 * Math.sin(t * 5);
  const cx = a.x + ux * r;
  const cy = a.y + uy * r;
  const s = Math.max(6, view.scale * 0.55);
  c.save();
  c.translate(cx, cy);
  c.rotate(Math.atan2(uy, ux));
  c.beginPath();
  c.moveTo(s, 0);
  c.lineTo(-s * 0.7, s * 0.75);
  c.lineTo(-s * 0.3, 0);
  c.lineTo(-s * 0.7, -s * 0.75);
  c.closePath();
  c.fillStyle = color;
  c.strokeStyle = 'rgba(10,14,20,0.7)';
  c.lineWidth = 2;
  c.stroke();
  c.fill();
  c.restore();
}

function drawHud(c: CanvasRenderingContext2D, view: View, world: World, fx: Fx, opts: DrawOpts) {
  const { w, h } = view;
  const t = fx.t;
  const small = w < 520;
  // guidance arrows from my player to the axes
  const mine = opts.me.map((id) => world.players[id]).filter((p) => p && !p.jailed);
  if (world.phase === 'play' && world.mode !== 'tree') {
    for (const p of mine) {
      if (!p) continue;
      for (const a of world.axes) {
        if (a.carrier === p.id) {
          const goal = world.mode === 'big' ? (p.team === 0 ? L - FIELD.END / 2 : FIELD.END / 2) : p.team === 0 ? FIELD.END / 2 : L - FIELD.END / 2;
          drawArrowTo(c, view, p, { x: goal, y: W / 2 }, '#ffffff', t);
        } else if (a.carrier < 0 && (a.owner === -1 || a.owner !== p.team)) drawArrowTo(c, view, p, a, GOLD, t);
        else if (a.carrier >= 0 && world.players[a.carrier]?.team !== p.team) drawArrowTo(c, view, p, world.players[a.carrier]!, '#ff6b5a', t);
      }
    }
  }
  if (world.mode === 'tree' && world.phase === 'play') {
    for (const p of mine) if (p && world.tree >= 0 && world.tree !== p.id) drawArrowTo(c, view, p, world.players[world.tree]!, '#8ee08e', t);
  }

  // top bar
  const barH = small ? 30 : 34;
  const top = w < 560 ? 52 : 8;
  const fs = small ? 14 : 16;
  let jailNoteCount = 0;
  c.textBaseline = 'middle';
  if (world.mode === 'tree') {
    const clock = clockText(world.clock);
    c.font = `800 ${fs}px ${FONT}`;
    const items: [string, string][] = [['tree tag', '#1f6b2a'], [clock, 'rgba(12,16,24,0.82)']];
    const myId = opts.me[0];
    if (myId !== undefined && world.players[myId]) items.push([`you ${Math.floor(world.treeScore[myId] ?? 0)}s`, 'rgba(12,16,24,0.82)']);
    let x = 10;
    for (const [text, bg] of items) {
      const tw = c.measureText(text).width + 22;
      chip(c, x, top, tw, barH, bg);
      c.textAlign = 'center';
      c.fillStyle = '#ffffff';
      c.fillText(text, x + tw / 2, top + barH / 2 + 1);
      x += tw + 6;
    }
    // top 3
    const ranked = world.players.map((p) => ({ id: p.id, s: world.treeScore[p.id] ?? 0 })).sort((a, b) => b.s - a.s || a.id - b.id).slice(0, 3);
    c.font = `700 ${small ? 12 : 13}px ${FONT}`;
    c.textAlign = 'left';
    ranked.forEach((r, i) => {
      const y = top + barH + 14 + i * 17;
      outlined(c, `${i + 1}. ${opts.nameOf(r.id)} ${Math.floor(r.s)}s${world.tree === r.id ? ' (tree)' : ''}`, 12, y, world.tree === r.id ? '#b9f5b9' : '#ffffff');
    });
  } else {
    c.font = `800 ${fs}px ${FONT}`;
    const clock = world.overtime ? 'golden capture' : clockText(world.clock);
    const nameW = Math.max(c.measureText('stanford 0').width, 70) + 20;
    const clockW = c.measureText(clock).width + 22;
    let x = 10;
    for (const team of [0, 1] as const) {
      const label = `${TEAM_NAMES[team]} ${world.score[team]}`;
      const tw = team === 0 ? nameW : c.measureText(label).width + 22;
      chip(c, x, top, tw, barH, TEAM[team].zone);
      c.textAlign = 'center';
      c.fillStyle = TEAM[team].zoneText;
      c.fillText(label, x + tw / 2, top + barH / 2 + 1);
      x += tw + 6;
      if (team === 0) {
        const urgent = !world.overtime && world.clock <= 30 && world.phase === 'play';
        chip(c, x, top, clockW, barH, world.overtime ? '#8a6a00' : urgent && Math.floor(t * 2) % 2 ? '#7a2a1e' : 'rgba(12,16,24,0.82)');
        c.fillStyle = '#ffffff';
        c.fillText(clock, x + clockW / 2, top + barH / 2 + 1);
        x += clockW + 6;
      }
    }
    // jail counts
    const jailed = [0, 0];
    for (const p of world.players) if (p.jailed) jailed[p.team]++;
    c.font = `700 ${small ? 12 : 13}px ${FONT}`;
    c.textAlign = 'left';
    const notes: string[] = [];
    if (jailed[0]) notes.push(`${jailed[0]} stanford in jail`);
    if (jailed[1]) notes.push(`${jailed[1]} cal in jail`);
    jailNoteCount = notes.length;
    notes.forEach((n, i) => pillText(c, n, 12, top + barH + 13 + i * 16, i === 0 && jailed[0] ? '#ffb3b3' : '#ffe39a'));
  }

  // feed (under the top bar on the left, or under the jail notes)
  c.font = `700 ${small ? 12 : 13}px ${FONT}`;
  c.textAlign = 'left';
  const feedTop = top + barH + (world.mode === 'tree' ? 70 : 13 + jailNoteCount * 16);
  fx.feed.forEach((n, i) => {
    c.globalAlpha = Math.min(1, n.life / 0.6);
    pillText(c, n.text, 12, feedTop + i * 17, n.color);
  });
  c.globalAlpha = 1;

  // stamina bar (desktop)
  const p0 = world.players[opts.me[0] ?? -1];
  if (p0 && !opts.touch && world.phase !== 'over') {
    const bw = Math.min(180, w * 0.3);
    const bx = (w - bw) / 2;
    const by = h - 18;
    rr(c, bx, by, bw, 8, 4);
    c.fillStyle = 'rgba(12,16,24,0.6)';
    c.fill();
    rr(c, bx, by, Math.max(8, bw * p0.stamina), 8, 4);
    c.fillStyle = p0.carrying >= 0 ? '#8a8f99' : p0.stamina < 0.25 ? '#ff6b5a' : '#ffffff';
    c.fill();
    c.font = `700 11px ${FONT}`;
    c.textAlign = 'center';
    outlined(c, p0.carrying >= 0 ? 'carrying the axe, no sprint' : 'sprint', w / 2, by - 8, 'rgba(255,255,255,0.85)');
  }

  // popups
  for (const p of fx.popups) {
    const s = toScreen(view, p.x, p.y);
    c.globalAlpha = Math.min(1, p.life / 0.4);
    c.font = `900 ${Math.round(Math.max(13, view.scale * 0.95))}px ${FONT}`;
    c.textAlign = 'center';
    outlined(c, p.text, s.x, s.y - view.scale, p.color, 'rgba(10,14,20,0.85)', 4);
  }
  c.globalAlpha = 1;

  // center banner: countdown, flash, external banner
  let big = '';
  let sub = '';
  let color = '#ffffff';
  if (world.phase === 'count') {
    big = String(Math.max(1, Math.ceil(world.phaseT)));
    sub = world.mode === 'tree' ? 'tag the tree, then run' : world.mode === 'big' ? 'grab the axe in the middle' : 'steal their axe, bring it home';
  }
  if (fx.flash) {
    const f = fx.flash;
    const k = f.life / f.max;
    c.globalAlpha = k < 0.1 ? k / 0.1 : k > 0.8 ? (1 - k) / 0.2 : 1;
    big = f.text;
    sub = f.sub;
    color = f.color;
  }
  if (opts.banner) {
    big = opts.banner;
    sub = '';
  }
  if (big) {
    const bs = Math.round(Math.min(56, Math.max(26, w * 0.07)));
    c.font = `900 ${bs}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tw = c.measureText(big).width;
    const isCount = world.phase === 'count' && !fx.flash && !opts.banner;
    if (!isCount) {
      rr(c, w / 2 - tw / 2 - 22, h / 2 - bs * 0.85, tw + 44, bs * 1.7 + (sub ? 22 : 0), 18);
      c.fillStyle = color === '#ffffff' ? 'rgba(12,16,24,0.78)' : color;
      c.fill();
      c.fillStyle = '#ffffff';
      c.fillText(big, w / 2, h / 2);
    } else outlined(c, big, w / 2, h / 2, '#ffffff', 'rgba(10,14,20,0.85)', 6);
    if (sub) {
      c.font = `700 ${Math.round(bs * 0.34)}px ${FONT}`;
      if (isCount) outlined(c, sub, w / 2, h / 2 + bs * 0.85, '#ffffff', 'rgba(10,14,20,0.85)', 4);
      else {
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.fillText(sub, w / 2, h / 2 + bs * 0.75);
      }
    }
    c.globalAlpha = 1;
  }

  // you are watching
  if (opts.watching) {
    c.font = `700 12px ${FONT}`;
    const text = 'watching';
    const tw = c.measureText(text).width + 20;
    chip(c, (w - tw) / 2, h - 32, tw, 24, 'rgba(12,16,24,0.75)');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText(text, w / 2, h - 20);
  }

  // touch sticks
  for (const s of opts.sticks) {
    c.globalAlpha = 0.9;
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 3;
    c.fillStyle = 'rgba(12,16,24,0.25)';
    c.beginPath();
    c.arc(s.ox, s.oy, 48, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.arc(s.x, s.y, 22, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }
}

export function drawGame(c: CanvasRenderingContext2D, view: View, world: World, fx: Fx, opts: DrawOpts): void {
  const { w, h } = view;
  const t = fx.t;
  spawnDust(fx, world);
  c.fillStyle = '#163b22';
  c.fillRect(0, 0, w, h);
  // soft vignette
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(40,90,50,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  const amp = fx.shake * fx.shake * view.scale * 0.7;
  const shake = { x: amp ? (Math.sin(t * 91) + Math.sin(t * 53)) * amp * 0.5 : 0, y: amp ? (Math.cos(t * 77) + Math.sin(t * 41)) * amp * 0.5 : 0 };
  inField(c, view, shake);
  drawField(c, view, world, t);
  if (world.mode !== 'tree') {
    const count = [0, 0];
    for (const p of world.players) if (p.jailed) count[p.team]++;
    // a team's jail holds the other team's players
    drawJail(c, 0, t, count[1]);
    drawJail(c, 1, t, count[0]);
    drawPedestals(c, world, t);
  }
  drawObstacles(c, world, t);
  drawPickups(c, view, world, t);
  drawPlayers(c, view, world, fx, new Set(opts.me));
  if (world.mode !== 'tree') drawAxes(c, view, world, t);
  drawParticles(c, fx);
  // jail labels
  if (world.mode !== 'tree') {
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const team of [0, 1] as const) {
      const j = FIELD.JAILS[team];
      uprightText(c, view, 'jail', j.x + j.w / 2, team === 0 ? j.y + j.h + 0.9 : j.y - 0.9, 1.1);
    }
  }
  c.restore();
  drawNames(c, view, world, opts, shake);
  drawHud(c, view, world, fx, opts);
}
