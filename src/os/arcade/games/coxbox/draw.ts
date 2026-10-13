import { COURSE_METERS, type Crew } from './logic.ts';

export type Layout = {
  w: number;
  h: number;
  /** Height of the strip with the distance markers. */
  band: number;
  /** Top of the first lane; lanes are centered when there are only a few. */
  top: number;
  laneH: number;
  lanes: number;
  boatLen: number;
  beam: number;
  oar: number;
  startX: number;
  finishX: number;
  font: number;
};

export type BoatView = {
  lane: number;
  crew: Crew;
  label: string;
  /** Smoothed share of the course covered, 0 to 1. */
  progress: number;
  /** Stroke cycle position, 0 at the catch. */
  phase: number;
  /** 0 sitting with oars flat, 1 rowing. */
  rowing: number;
  /** Fades from 1 after a mistake. */
  crab: number;
  you: boolean;
  dim: boolean;
};

/** Where an oar left a puddle, in course units so it stays put as the boat moves on. */
export type Puddle = { u: number; lane: number; dy: number; born: number };

/** Share of the stroke cycle spent on the drive. */
export const DRIVE = 0.36;
const CATCH_ANGLE = 0.62;
const FINISH_ANGLE = 0.44;
const PUDDLE_LIFE = 2.6;
const HAIR = ['#2b1d14', '#5a3b22', '#1a1a1a', '#8a6a3a', '#3a2a1e', '#6b4a2b', '#1f1f1f', '#4a3322'];

export function layoutCourse(w: number, h: number, lanes: number): Layout {
  const band = Math.min(46, Math.max(30, h * 0.12));
  const bottom = 6;
  const room = h - band - bottom;
  const laneH = Math.max(14, Math.min(72, room / Math.max(1, lanes)));
  const top = band + Math.max(0, (room - laneH * lanes) / 2);
  const boatLen = Math.max(44, Math.min(132, w * 0.15, laneH * 3.4));
  const beam = Math.max(3.2, boatLen * 0.072);
  const oar = Math.max(6, Math.min(laneH * 0.4, boatLen * 0.34));
  const startX = 12 + boatLen;
  const finishX = w - 22;
  return { w, h, band, top, laneH, lanes, boatLen, beam, oar, startX, finishX, font: Math.max(10, Math.min(12, laneH * 0.3)) };
}

export const laneY = (L: Layout, lane: number) => L.top + L.laneH * (lane + 0.5);
export const bowAt = (L: Layout, progress: number) => L.startX + progress * (L.finishX - L.startX);
const courseU = (L: Layout, x: number) => (x - L.startX) / Math.max(1, L.finishX - L.startX);

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

/** Oar angle for a stroke phase: positive points the blade toward the bow. */
export function oarAngle(phase: number, rowing: number): number {
  const p = ((phase % 1) + 1) % 1;
  const a = p < DRIVE ? CATCH_ANGLE - (CATCH_ANGLE + FINISH_ANGLE) * ease(p / DRIVE) : -FINISH_ANGLE + (CATCH_ANGLE + FINISH_ANGLE) * ease((p - DRIVE) / (1 - DRIVE));
  return a * rowing;
}

function seatX(sternX: number, len: number, seat: number) {
  return sternX + len * (0.22 + seat * 0.086);
}

/** Blade tips for the eight oars, used both to draw and to drop puddles. */
export function bladeTips(L: Layout, b: BoatView): { x: number; y: number; side: number }[] {
  const bow = bowAt(L, b.progress);
  const stern = bow - L.boatLen;
  const y = laneY(L, b.lane);
  const angle = oarAngle(b.phase, b.rowing);
  return Array.from({ length: 8 }, (_, seat) => {
    const side = seat % 2 === 0 ? -1 : 1;
    const pinX = seatX(stern, L.boatLen, seat) + L.beam * 0.3;
    const pinY = y + side * L.beam * 1.05;
    return { x: pinX + Math.sin(angle) * L.oar, y: pinY + side * Math.cos(angle) * L.oar, side };
  });
}

export function dropPuddles(L: Layout, b: BoatView, puddles: Puddle[], now: number) {
  const y = laneY(L, b.lane);
  for (const tip of bladeTips(L, b)) puddles.push({ u: courseU(L, tip.x), lane: b.lane, dy: (tip.y - y) / L.laneH, born: now });
  const cutoff = now - PUDDLE_LIFE;
  let keep = 0;
  for (const p of puddles) if (p.born > cutoff) puddles[keep++] = p;
  puddles.length = keep;
}

function drawWater(ctx: CanvasRenderingContext2D, L: Layout, t: number, youLane: number) {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, '#0b3443');
  g.addColorStop(1, '#072431');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);

  for (let i = 0; i < L.lanes; i++) {
    const y = L.top + i * L.laneH;
    if (i === youLane) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
      ctx.fillRect(0, y, L.w, L.laneH);
    } else if (i % 2 === 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
      ctx.fillRect(0, y, L.w, L.laneH);
    }
  }

  // Ripples drift slowly downstream so the water never looks frozen.
  ctx.strokeStyle = 'rgba(190, 230, 245, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const count = Math.round((L.w * (L.h - L.band)) / 2600);
  for (let i = 0; i < count; i++) {
    const sx = ((i * 7919) % 997) / 997;
    const sy = ((i * 104729) % 991) / 991;
    const x = (((sx * (L.w + 60) - t * (6 + (i % 5) * 2)) % (L.w + 60)) + L.w + 60) % (L.w + 60) - 30;
    const y = L.band + sy * (L.h - L.band);
    const r = 4 + (i % 4) * 2;
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x, y - 2, x + r, y);
  }
  ctx.stroke();

  // Distance markers every 500 m.
  ctx.font = `600 ${L.font}px Inter, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (let m = 500; m < COURSE_METERS; m += 500) {
    const x = bowAt(L, m / COURSE_METERS);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(x, L.band);
    ctx.lineTo(x, L.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText(`${m}`, x, L.band / 2);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.textAlign = 'left';
  ctx.fillText('start', Math.max(8, L.startX - L.boatLen), L.band / 2);

  // Buoy lines between lanes: white down the course, red near the start and the finish.
  const step = Math.max(12, L.laneH * 0.32);
  for (let i = 0; i <= L.lanes; i++) {
    const y = L.top + i * L.laneH;
    for (let x = 8; x < L.w; x += step) {
      const u = courseU(L, x);
      ctx.fillStyle = u < 0.06 || u > 0.88 ? 'rgba(255, 105, 97, 0.85)' : 'rgba(255, 255, 255, 0.42)';
      ctx.beginPath();
      ctx.arc(x, y, i === 0 || i === L.lanes ? 1.6 : 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Stake boats and the start line.
  const stakeX = L.startX - L.boatLen - 6;
  for (let i = 0; i < L.lanes; i++) {
    const y = laneY(L, i);
    ctx.fillStyle = 'rgba(205, 214, 220, 0.35)';
    ctx.fillRect(stakeX - 6, y - L.laneH * 0.22, 6, L.laneH * 0.44);
    ctx.fillStyle = i === youLane ? '#fff' : 'rgba(255, 255, 255, 0.5)';
    ctx.font = `700 ${Math.max(9, L.font - 1)}px Inter, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), Math.max(6, stakeX - 3), y - L.laneH * 0.32 - 2 < L.top ? y : y - L.laneH * 0.32);
  }

  // Finish line, checkered at the edges.
  ctx.fillStyle = 'rgba(255, 69, 58, 0.85)';
  ctx.fillRect(L.finishX - 1, L.band, 2, L.h - L.band);
  for (let y = L.band; y < L.h; y += 8) {
    ctx.fillStyle = Math.floor((y - L.band) / 8) % 2 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(20, 20, 24, 0.85)';
    ctx.fillRect(L.finishX + 3, y, 4, 8);
  }
}

function drawPuddles(ctx: CanvasRenderingContext2D, L: Layout, puddles: readonly Puddle[], now: number) {
  ctx.lineWidth = 1;
  for (const p of puddles) {
    const age = (now - p.born) / PUDDLE_LIFE;
    if (age < 0 || age >= 1) continue;
    const x = L.startX + p.u * (L.finishX - L.startX);
    const y = laneY(L, p.lane) + p.dy * L.laneH;
    const r = L.oar * (0.12 + age * 0.22);
    ctx.strokeStyle = `rgba(210, 240, 250, ${0.4 * (1 - age)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (age < 0.5) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.45, r * 0.27, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function hullPath(ctx: CanvasRenderingContext2D, stern: number, bow: number, y: number, beam: number) {
  const len = bow - stern;
  ctx.beginPath();
  ctx.moveTo(bow, y);
  ctx.bezierCurveTo(bow - len * 0.12, y - beam * 0.35, bow - len * 0.3, y - beam, bow - len * 0.42, y - beam);
  ctx.lineTo(stern + len * 0.22, y - beam);
  ctx.bezierCurveTo(stern + len * 0.08, y - beam, stern + len * 0.02, y - beam * 0.4, stern, y);
  ctx.bezierCurveTo(stern + len * 0.02, y + beam * 0.4, stern + len * 0.08, y + beam, stern + len * 0.22, y + beam);
  ctx.lineTo(bow - len * 0.42, y + beam);
  ctx.bezierCurveTo(bow - len * 0.3, y + beam, bow - len * 0.12, y + beam * 0.35, bow, y);
  ctx.closePath();
}

function drawBoat(ctx: CanvasRenderingContext2D, L: Layout, b: BoatView, t: number, speed: number) {
  const bow = bowAt(L, b.progress);
  const stern = bow - L.boatLen;
  const y = laneY(L, b.lane) + (b.rowing < 0.5 ? Math.sin(t * 1.7 + b.lane) * 0.6 : 0);
  const half = L.beam / 2;
  const phase = ((b.phase % 1) + 1) % 1;
  const angle = oarAngle(phase, b.rowing);
  const driving = b.rowing > 0.5 && phase < DRIVE;
  ctx.save();
  if (b.dim) ctx.globalAlpha = 0.45;

  // Wake from the stern, longer the faster the boat runs.
  if (speed > 0.02) {
    const wake = Math.min(L.boatLen * 0.45, 8 + speed * 400);
    const wash = ctx.createLinearGradient(stern, 0, stern - wake, 0);
    wash.addColorStop(0, 'rgba(220, 245, 255, 0.22)');
    wash.addColorStop(1, 'rgba(220, 245, 255, 0)');
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.moveTo(stern + 4, y - half * 0.7);
    ctx.lineTo(stern - wake, y - half * 0.7 - wake * 0.12);
    ctx.lineTo(stern - wake, y + half * 0.7 + wake * 0.12);
    ctx.lineTo(stern + 4, y + half * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(235, 250, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(bow + 1, y);
    ctx.lineTo(bow - 6, y - half - 2);
    ctx.moveTo(bow + 1, y);
    ctx.lineTo(bow - 6, y + half + 2);
    ctx.stroke();
  }

  // Oars sit under the hull and the rowers.
  const crabSeat = 7;
  for (let seat = 0; seat < 8; seat++) {
    const side = seat % 2 === 0 ? -1 : 1;
    const a = seat === crabSeat && b.crab > 0 ? angle + b.crab * 0.7 : angle;
    const pinX = seatX(stern, L.boatLen, seat) + L.beam * 0.3;
    const pinY = y + side * L.beam * 1.05;
    const dx = Math.sin(a);
    const dy = side * Math.cos(a);
    const tipX = pinX + dx * L.oar;
    const tipY = pinY + dy * L.oar;
    const inboard = L.oar * 0.32;
    // Rigger.
    ctx.strokeStyle = 'rgba(210, 214, 220, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pinX - L.beam * 0.5, y + side * half);
    ctx.lineTo(pinX, pinY);
    ctx.lineTo(pinX + L.beam * 0.5, y + side * half);
    ctx.stroke();
    // Shaft.
    ctx.strokeStyle = 'rgba(236, 238, 240, 0.92)';
    ctx.lineWidth = Math.max(1, L.beam * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pinX - dx * inboard, pinY - dy * inboard);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    // Blade: squared and buried on the drive, feathered flat on the recovery.
    const blade = L.oar * 0.24;
    const squared = b.rowing < 0.5 || phase < DRIVE;
    ctx.lineWidth = squared ? Math.max(2.2, L.oar * 0.11) : Math.max(1.2, L.oar * 0.05);
    ctx.strokeStyle = b.crew.blade;
    ctx.beginPath();
    ctx.moveTo(tipX - dx * blade, tipY - dy * blade);
    ctx.lineTo(tipX - dx * blade * 0.25, tipY - dy * blade * 0.25);
    ctx.stroke();
    ctx.strokeStyle = b.crew.tip;
    ctx.beginPath();
    ctx.moveTo(tipX - dx * blade * 0.25, tipY - dy * blade * 0.25);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    // White water off the blade on the drive, and a burst when a crab is caught.
    if (driving || (seat === crabSeat && b.crab > 0.2)) {
      const splash = seat === crabSeat && b.crab > 0.2 ? b.crab : 0.35 * Math.sin((phase / DRIVE) * Math.PI);
      ctx.fillStyle = `rgba(235, 250, 255, ${Math.min(0.85, splash)})`;
      ctx.beginPath();
      ctx.ellipse(tipX - dx * blade * 0.5 - 2, tipY, blade * (0.35 + splash * 0.4), blade * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineCap = 'butt';

  // Hull.
  hullPath(ctx, stern, bow, y, half);
  ctx.fillStyle = b.crew.hull;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.moveTo(stern + L.boatLen * 0.2, y - half * 0.62);
  ctx.lineTo(bow - L.boatLen * 0.4, y - half * 0.62);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(bow - 1, y, Math.max(1.2, half * 0.42), 0, Math.PI * 2);
  ctx.fill();

  // Rowers slide toward the stern on the recovery and push back on the drive.
  const slideT = phase < DRIVE ? ease(phase / DRIVE) : 1 - ease((phase - DRIVE) / (1 - DRIVE));
  const slide = (slideT - 0.5) * L.boatLen * 0.03 * b.rowing;
  const head = Math.max(1.3, half * 0.62);
  for (let seat = 0; seat < 8; seat++) {
    const x = seatX(stern, L.boatLen, seat) + slide;
    ctx.fillStyle = b.crew.blade === '#ffffff' ? b.crew.hull : b.crew.blade;
    ctx.beginPath();
    ctx.ellipse(x - head * 0.2, y, head * 0.75, half * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HAIR[seat];
    ctx.beginPath();
    ctx.arc(x - head * 0.35, y, head * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  // Coxswain in the stern, with the cox box.
  const coxX = stern + L.boatLen * 0.1;
  ctx.fillStyle = '#e8eaed';
  ctx.beginPath();
  ctx.ellipse(coxX, y, head * 0.7, half * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b1d14';
  ctx.beginPath();
  ctx.arc(coxX + head * 0.3, y, head * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(coxX + head * 1.05, y - head * 0.35, head * 0.6, head * 0.7);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, L: Layout, b: BoatView) {
  if (!b.label) return;
  const bow = bowAt(L, b.progress);
  const stern = bow - L.boatLen;
  const y = laneY(L, b.lane);
  ctx.font = `${b.you ? 700 : 600} ${L.font}px Inter, -apple-system, sans-serif`;
  const w = ctx.measureText(b.label).width;
  const behind = stern - 10 - w > 4;
  const x = behind ? stern - 10 - w : Math.min(bow + 12, L.finishX - w - 12);
  const ty = behind ? y : y - L.laneH * 0.3;
  ctx.globalAlpha = b.dim ? 0.5 : 1;
  ctx.fillStyle = 'rgba(4, 18, 26, 0.6)';
  const padX = 5;
  const h = L.font + 6;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - padX, ty - h / 2, w + padX * 2, h, h / 2);
  else ctx.rect(x - padX, ty - h / 2, w + padX * 2, h);
  ctx.fill();
  ctx.fillStyle = b.you ? '#ffffff' : 'rgba(255, 255, 255, 0.82)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.label, x, ty + 0.5);
  ctx.globalAlpha = 1;
}

export function drawRace(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  boats: readonly BoatView[],
  speeds: readonly number[],
  puddles: readonly Puddle[],
  t: number,
) {
  const you = boats.find((b) => b.you)?.lane ?? -1;
  drawWater(ctx, L, t, you);
  drawPuddles(ctx, L, puddles, t);
  boats.forEach((b, i) => drawBoat(ctx, L, b, t, speeds[i] ?? 0));
  for (const b of boats) drawLabel(ctx, L, b);
}
