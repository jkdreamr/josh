import { COURT_HALF_LENGTH, NET_HEIGHT, SHORT_SERVICE_LINE, type Direction, type End, type FlightState, type Intent, type Point2D, type Side } from '../games/badminton';

export type AthleteView = {
  side: Side;
  x: number;
  vx: number;
  jump: number;
  facing: Direction;
  /** 0..1 progress through the current swing, or null when idle */
  swing: number | null;
  intent: Intent;
  label: string;
  isHuman: boolean;
};

export type LandingMark = { x: number; at: number; kind: 'in' | 'out' | 'net' };
export type Impact = { x: number; y: number; at: number; strong: boolean };

export type SceneView = {
  athletes: AthleteView[];
  flight: FlightState | null;
  trail: Point2D[];
  marks: LandingMark[];
  impact: Impact | null;
  shake: number;
  now: number;
  receivingEnd: End | null;
  serviceCourt: 'left' | 'right' | null;
};

const palette = {
  a: { skin: '#d9ad90', jersey: '#8c1515', shorts: '#4d1414', trim: 'rgba(255,240,228,.3)' },
  b: { skin: '#c9a287', jersey: '#2a4b7c', shorts: '#1f2f49', trim: 'rgba(230,240,255,.26)' },
};

/** World-to-canvas mapping shared by the renderer and the pointer controls. */
export function sceneMetrics(width: number, height: number) {
  const tall = height > width * 0.75;
  const floorBand = tall ? height * 0.3 : Math.max(30, Math.min(56, height * 0.17));
  const ground = height - floorBand;
  const scale = Math.min((width * 0.95) / (COURT_HALF_LENGTH * 2 + 1.9), ground / 6.3);
  return { floorBand, ground, scale, originX: width / 2, tall };
}

export function drawScene(canvas: HTMLCanvasElement, view: SceneView) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(rect.width * dpr);
  const pixelHeight = Math.round(rect.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const { floorBand, ground, scale, originX, tall } = sceneMetrics(width, height);
  const { now } = view;
  const shakeX = view.shake ? Math.sin(now * 0.09) * view.shake : 0;
  const shakeY = view.shake ? Math.cos(now * 0.11) * view.shake * 0.6 : 0;

  // hall
  const backdrop = ctx.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#0d141a');
  backdrop.addColorStop(0.55, '#15212a');
  backdrop.addColorStop(1, '#1b2a32');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);
  for (const lamp of [0.22, 0.5, 0.78]) {
    const glow = ctx.createRadialGradient(width * lamp, -height * 0.1, 4, width * lamp, -height * 0.1, height * 0.75);
    glow.addColorStop(0, 'rgba(236,232,210,.17)');
    glow.addColorStop(0.45, 'rgba(200,210,200,.05)');
    glow.addColorStop(1, 'rgba(200,210,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  // roof truss and lamps
  const trussY = Math.max(14, Math.min(height * 0.1, 40));
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(0, trussY, width, 1);
  for (const lamp of [0.22, 0.5, 0.78]) {
    ctx.fillStyle = 'rgba(255,250,228,.75)';
    ctx.fillRect(width * lamp - 14, trussY + 2, 28, 3);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(width * lamp - 1, 0, 2, trussY + 2);
  }
  // far wall band and seating line
  const wall = ctx.createLinearGradient(0, ground - scale * 2.6, 0, ground);
  wall.addColorStop(0, 'rgba(255,255,255,0)');
  wall.addColorStop(0.35, 'rgba(255,255,255,.03)');
  wall.addColorStop(0.36, 'rgba(0,0,0,.16)');
  wall.addColorStop(1, 'rgba(0,0,0,.22)');
  ctx.fillStyle = wall;
  ctx.fillRect(0, ground - scale * 2.6, width, scale * 2.6);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(0, ground - scale * 1.7, width, 1);

  ctx.save();
  ctx.translate(originX + shakeX, ground + shakeY);
  ctx.scale(scale, -scale);
  const px = 1 / scale;

  // wooden floor and the green court mat
  const floorDepth = floorBand / scale;
  const wood = ctx.createLinearGradient(0, -floorDepth, 0, 0);
  wood.addColorStop(0, tall ? '#1c1714' : '#3a2d25');
  wood.addColorStop(tall ? 0.6 : 1, tall ? '#3a2c23' : '#5b4535');
  if (tall) wood.addColorStop(1, '#55402f');
  ctx.fillStyle = wood;
  ctx.fillRect(-width / scale, -floorDepth, width / scale * 2, floorDepth);
  ctx.strokeStyle = tall ? 'rgba(230,200,160,.05)' : 'rgba(230,200,160,.09)';
  ctx.lineWidth = px;
  for (let y = -0.26; y > -floorDepth; y -= 0.26) {
    ctx.beginPath();
    ctx.moveTo(-width / scale, y);
    ctx.lineTo(width / scale, y);
    ctx.stroke();
  }
  const mat = ctx.createLinearGradient(0, -0.34, 0, 0);
  mat.addColorStop(0, '#1f5d47');
  mat.addColorStop(1, '#2b7a5c');
  ctx.fillStyle = mat;
  ctx.fillRect(-COURT_HALF_LENGTH - 0.9, -0.34, COURT_HALF_LENGTH * 2 + 1.8, 0.34);
  if (view.receivingEnd) {
    const sign = view.receivingEnd === 'left' ? -1 : 1;
    const nearX = sign * SHORT_SERVICE_LINE;
    const farX = sign * COURT_HALF_LENGTH;
    const pulse = 0.08 + Math.sin(now * 0.004) * 0.03;
    ctx.fillStyle = `rgba(255,250,220,${pulse})`;
    ctx.fillRect(Math.min(nearX, farX), -0.34, Math.abs(farX - nearX), 0.34);
  }
  ctx.fillStyle = '#f2f3ea';
  for (const x of [-COURT_HALF_LENGTH, COURT_HALF_LENGTH]) ctx.fillRect(x - 0.02, -0.34, 0.04, 0.34);
  for (const x of [-SHORT_SERVICE_LINE, SHORT_SERVICE_LINE]) ctx.fillRect(x - 0.02, -0.34, 0.04, 0.34);
  ctx.fillStyle = 'rgba(242,243,234,.9)';
  ctx.fillRect(-COURT_HALF_LENGTH, -0.02, COURT_HALF_LENGTH * 2, 0.04);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(-COURT_HALF_LENGTH - 0.9, -0.005, COURT_HALF_LENGTH * 2 + 1.8, 0.01);

  // net
  ctx.fillStyle = 'rgba(14,25,23,.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.36, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(234,238,221,.1)';
  ctx.fillRect(-0.17, 0.02, 0.34, NET_HEIGHT - 0.02);
  ctx.strokeStyle = 'rgba(236,240,224,.28)';
  ctx.lineWidth = px;
  for (let y = 0.1; y < NET_HEIGHT - 0.05; y += 0.12) {
    ctx.beginPath();
    ctx.moveTo(-0.17, y);
    ctx.lineTo(0.17, y);
    ctx.stroke();
  }
  for (let x = -0.14; x <= 0.14; x += 0.07) {
    ctx.beginPath();
    ctx.moveTo(x, 0.03);
    ctx.lineTo(x, NET_HEIGHT - 0.05);
    ctx.stroke();
  }
  ctx.fillStyle = '#c3c6bd';
  ctx.fillRect(-0.215, 0, 0.045, NET_HEIGHT + 0.07);
  ctx.fillRect(0.17, 0, 0.045, NET_HEIGHT + 0.07);
  ctx.fillStyle = '#f4f2e6';
  ctx.fillRect(-0.215, NET_HEIGHT - 0.03, 0.43, 0.06);

  for (const mark of view.marks) {
    const age = (now - mark.at) / 900;
    if (age > 1) continue;
    const fade = 1 - age;
    ctx.save();
    ctx.globalAlpha = fade * 0.9;
    ctx.strokeStyle = mark.kind === 'in' ? '#dff5c7' : mark.kind === 'out' ? '#ffb8a8' : '#f4f2e6';
    ctx.lineWidth = 2.2 * px;
    ctx.beginPath();
    ctx.ellipse(mark.x, 0.02, 0.22 + age * 0.3, 0.07 + age * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (tall) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-width / scale, -floorDepth, (width / scale) * 2, floorDepth - 0.34);
    ctx.clip();
    ctx.globalAlpha = 0.1;
    ctx.translate(0, -0.34);
    ctx.scale(1, -0.7);
    for (const athlete of view.athletes) drawAthlete(ctx, athlete, now, px, true);
    ctx.restore();
  }

  for (const athlete of view.athletes) drawAthlete(ctx, athlete, now, px);

  if (view.flight) drawShuttle(ctx, view, px);
  ctx.restore();

  if (view.flight && view.flight.status === 'flying') {
    const topY = ground - view.flight.shuttle.y * scale;
    if (topY < -4) {
      const markerX = Math.max(14, Math.min(width - 14, originX + view.flight.shuttle.x * scale));
      ctx.fillStyle = 'rgba(246,243,227,.85)';
      ctx.beginPath();
      ctx.moveTo(markerX, 8);
      ctx.lineTo(markerX - 5, 16);
      ctx.lineTo(markerX + 5, 16);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawAthlete(ctx: CanvasRenderingContext2D, athlete: AthleteView, now: number, px: number, reflection = false) {
  const colors = palette[athlete.side];
  const facing = athlete.facing;
  const x = athlete.x;
  const lift = athlete.jump;
  const moving = Math.abs(athlete.vx) > 0.4;
  const stride = moving ? Math.sin(now * 0.02 + (athlete.side === 'b' ? Math.PI : 0)) * 0.11 : 0;
  const swing = athlete.swing;
  const swingArc = swing === null ? 0 : Math.sin(swing * Math.PI);
  const overhead = athlete.intent !== 'soft';

  if (!reflection) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#060c0b';
    ctx.beginPath();
    ctx.ellipse(x, 0.03, 0.32 - lift * 0.08, 0.075 - lift * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, lift);
  ctx.rotate(moving ? -facing * Math.sign(athlete.vx * facing) * 0.05 : 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // legs
  ctx.fillStyle = colors.skin;
  ctx.beginPath();
  ctx.moveTo(-0.15, 0.52);
  ctx.lineTo(-0.05, 0.5);
  ctx.lineTo(-0.11 + stride, 0.26);
  ctx.lineTo(-0.19 + stride, 0.06);
  ctx.lineTo(-0.3 + stride, 0.06);
  ctx.lineTo(-0.23 + stride, 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.05, 0.5);
  ctx.lineTo(0.15, 0.52);
  ctx.lineTo(0.21 - stride, 0.3);
  ctx.lineTo(0.29 - stride, 0.06);
  ctx.lineTo(0.18 - stride, 0.06);
  ctx.lineTo(0.1 - stride, 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ecebe3';
  ctx.beginPath();
  ctx.ellipse(-0.24 + stride, 0.045, 0.11, 0.04, 0, 0, Math.PI * 2);
  ctx.ellipse(0.24 - stride, 0.045, 0.11, 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  // shorts and jersey
  ctx.fillStyle = colors.shorts;
  ctx.beginPath();
  ctx.moveTo(-0.18, 0.74);
  ctx.lineTo(0.18, 0.74);
  ctx.lineTo(0.16, 0.49);
  ctx.lineTo(0.02, 0.45);
  ctx.lineTo(0, 0.62);
  ctx.lineTo(-0.04, 0.45);
  ctx.lineTo(-0.17, 0.49);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.jersey;
  ctx.beginPath();
  ctx.moveTo(-0.18, 0.7);
  ctx.lineTo(-0.25, 1.08);
  ctx.lineTo(-0.13, 1.2);
  ctx.lineTo(0.13, 1.2);
  ctx.lineTo(0.25, 1.08);
  ctx.lineTo(0.18, 0.7);
  ctx.quadraticCurveTo(0, 0.63, -0.18, 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.trim;
  ctx.fillRect(-0.03, 0.78, 0.06, 0.3);

  // head
  ctx.fillStyle = colors.skin;
  ctx.beginPath();
  ctx.arc(0, 1.38, 0.135, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = athlete.side === 'a' ? '#2a1c16' : '#1a1512';
  ctx.beginPath();
  ctx.arc(-facing * 0.02, 1.43, 0.13, Math.PI * (facing > 0 ? 1.05 : -0.05), Math.PI * (facing > 0 ? 1.95 : 0.85), facing < 0);
  ctx.fill();

  // arms and racket
  let racketX: number;
  let racketY: number;
  if (swing === null) {
    racketX = facing * 0.5;
    racketY = 1.12;
  } else if (overhead) {
    const start = { x: -facing * 0.1, y: 1.95 };
    const end = { x: facing * 0.7, y: 1.1 };
    racketX = start.x + (end.x - start.x) * swing;
    racketY = start.y + (end.y - start.y) * swing;
  } else {
    const start = { x: -facing * 0.2, y: 0.6 };
    const end = { x: facing * 0.75, y: 1.15 };
    racketX = start.x + (end.x - start.x) * swing;
    racketY = start.y + (end.y - start.y) * swing;
  }
  ctx.strokeStyle = colors.skin;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(facing * 0.17, 1.1);
  ctx.lineTo(racketX - facing * 0.1, racketY - 0.06);
  ctx.moveTo(-facing * 0.17, 1.06);
  ctx.lineTo(-facing * 0.34, swing !== null && overhead ? 1.25 : 0.8);
  ctx.stroke();
  const handleAngle = swing === null ? facing * 0.5 : overhead ? facing * (1.3 - swing * 1.9) : facing * (-0.9 + swing * 1.6);
  ctx.save();
  ctx.translate(racketX, racketY);
  ctx.rotate(handleAngle);
  ctx.strokeStyle = '#d9d5c8';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 0.3);
  ctx.stroke();
  ctx.translate(0, 0.46);
  ctx.strokeStyle = '#efece0';
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.13, 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(235,235,222,.5)';
  ctx.lineWidth = px;
  for (let line = -2; line <= 2; line += 1) {
    const offset = line * 0.045;
    ctx.beginPath();
    ctx.moveTo(offset, -0.14);
    ctx.lineTo(offset, 0.14);
    ctx.moveTo(-0.1, offset * 0.8);
    ctx.lineTo(0.1, offset * 0.8);
    ctx.stroke();
  }
  ctx.restore();

  if (swingArc > 0.05) {
    ctx.strokeStyle = `rgba(245,236,205,${0.4 * swingArc})`;
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    if (overhead) ctx.arc(0, 1.15, 0.78, facing > 0 ? -0.25 : Math.PI - 1.3, facing > 0 ? 1.3 : Math.PI + 0.25);
    else ctx.arc(facing * 0.1, 1, 0.68, facing > 0 ? -1.2 : Math.PI + 0.3, facing > 0 ? -0.3 : Math.PI + 1.2);
    ctx.stroke();
  }
  ctx.restore();

  if (reflection) return;

  // name tag on the floor
  ctx.save();
  ctx.scale(px, -px);
  ctx.fillStyle = 'rgba(243,246,235,.55)';
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(athlete.label, x / px, 10);
  ctx.restore();
}

function drawShuttle(ctx: CanvasRenderingContext2D, view: SceneView, px: number) {
  const flight = view.flight!;
  const shuttle = flight.shuttle;
  const { now } = view;

  if (view.impact && now - view.impact.at < 220) {
    const progress = Math.max(0, now - view.impact.at) / 220;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = view.impact.strong ? '#fff1c2' : 'rgba(255,255,255,.7)';
    ctx.lineWidth = (view.impact.strong ? 2.4 : 1.4) * px;
    ctx.beginPath();
    ctx.arc(view.impact.x, view.impact.y, 0.14 + progress * (view.impact.strong ? 0.6 : 0.3), 0, Math.PI * 2);
    ctx.stroke();
    if (view.impact.strong) {
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = ray * Math.PI / 4 + 0.3;
        ctx.beginPath();
        ctx.moveTo(view.impact.x + Math.cos(angle) * (0.22 + progress * 0.3), view.impact.y + Math.sin(angle) * (0.22 + progress * 0.3));
        ctx.lineTo(view.impact.x + Math.cos(angle) * (0.4 + progress * 0.5), view.impact.y + Math.sin(angle) * (0.4 + progress * 0.5));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (flight.status === 'flying') {
    const shadowAlpha = Math.max(0.05, 0.3 - shuttle.y * 0.035);
    const shadowSize = 0.12 + shuttle.y * 0.03;
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = '#040807';
    ctx.beginPath();
    ctx.ellipse(shuttle.x, 0.02, shadowSize, shadowSize * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (view.trail.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    const speed = Math.hypot(shuttle.vx, shuttle.vy);
    const strength = Math.min(1, speed / 35);
    for (let index = 1; index < view.trail.length; index += 1) {
      const alpha = (index / view.trail.length) * (0.14 + strength * 0.3);
      ctx.strokeStyle = `rgba(248,246,231,${alpha})`;
      ctx.lineWidth = (0.03 + strength * 0.05) * (index / view.trail.length);
      ctx.beginPath();
      ctx.moveTo(view.trail[index - 1].x, view.trail[index - 1].y);
      ctx.lineTo(view.trail[index].x, view.trail[index].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(shuttle.x, Math.max(0.06, shuttle.y));
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#f6f4e9';
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.14);
  ctx.lineTo(-0.06, -0.04);
  ctx.lineTo(0.06, -0.035);
  ctx.lineTo(0.06, 0.035);
  ctx.lineTo(-0.06, 0.04);
  ctx.lineTo(-0.3, 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,170,158,.75)';
  ctx.lineWidth = px;
  for (const feather of [-0.1, -0.035, 0.035, 0.1]) {
    ctx.beginPath();
    ctx.moveTo(-0.27, feather);
    ctx.lineTo(-0.05, feather * 0.3);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,120,110,.5)';
  ctx.beginPath();
  ctx.moveTo(-0.22, -0.1);
  ctx.lineTo(-0.22, 0.1);
  ctx.stroke();
  ctx.fillStyle = '#e8e2d4';
  ctx.beginPath();
  ctx.ellipse(0.09, 0, 0.09, 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(60,40,30,.25)';
  ctx.beginPath();
  ctx.ellipse(0.13, 0, 0.035, 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
