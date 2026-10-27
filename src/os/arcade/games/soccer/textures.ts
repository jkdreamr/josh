import { FIELD } from './field.ts';

type Three = typeof import('three');

function canvasTexture(THREE: Three, canvas: HTMLCanvasElement, color = true) {
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

export function pitchTextures(THREE: Three, lite: boolean) {
  const size = lite ? 1024 : 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grass = ctx.createLinearGradient(0, 0, size, 0);
  grass.addColorStop(0, '#218d3e'); grass.addColorStop(0.5, '#36a94e'); grass.addColorStop(1, '#21883b');
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? '#2fa54a' : '#23863b';
    ctx.fillRect(i * size / 12, 0, size / 12, size);
  }
  ctx.strokeStyle = 'rgba(9,57,39,.045)';
  ctx.lineWidth = Math.max(2, size / 180);
  for (let i = 0; i < 40; i++) {
    const x = (i / 40) * size;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size * 0.08, size); ctx.stroke();
  }
  let seed = 982341;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < size * size * 0.012; i++) {
    const shade = Math.floor(38 + random() * 60);
    ctx.fillStyle = `rgba(${shade},${shade + 45},${shade + 20},${random() * 0.22})`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2.2, 1 + random() * 3);
  }
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = lite ? 512 : 1024;
  const normalCtx = normalCanvas.getContext('2d')!;
  normalCtx.fillStyle = '#8080ff'; normalCtx.fillRect(0, 0, normalCanvas.width, normalCanvas.height);
  for (let i = 0; i < normalCanvas.width * normalCanvas.height * 0.08; i++) {
    const c = 120 + Math.floor(random() * 17);
    normalCtx.fillStyle = `rgb(${c},${c},255)`;
    normalCtx.fillRect(random() * normalCanvas.width, random() * normalCanvas.height, 1 + random() * 2, 1 + random() * 2);
  }
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = normalCanvas.width;
  const rough = roughCanvas.getContext('2d')!;
  rough.fillStyle = '#d2d2d2'; rough.fillRect(0, 0, roughCanvas.width, roughCanvas.height);
  for (let i = 0; i < roughCanvas.width * roughCanvas.height * 0.025; i++) {
    const n = 175 + Math.floor(random() * 65);
    rough.fillStyle = `rgb(${n},${n},${n})`;
    rough.fillRect(random() * roughCanvas.width, random() * roughCanvas.height, 1 + random() * 2, 1 + random() * 2);
  }
  return {
    color: canvasTexture(THREE, canvas),
    normal: canvasTexture(THREE, normalCanvas, false),
    roughness: canvasTexture(THREE, roughCanvas, false),
  };
}

export function markingsTexture(THREE: Three) {
  const pixelsPerMeter = 20;
  const canvas = document.createElement('canvas');
  canvas.width = FIELD.length * pixelsPerMeter; canvas.height = FIELD.width * pixelsPerMeter;
  const ctx = canvas.getContext('2d')!;
  const x = (value: number) => (value + FIELD.length / 2) * pixelsPerMeter;
  const z = (value: number) => (value + FIELD.width / 2) * pixelsPerMeter;
  ctx.strokeStyle = 'rgba(255,255,247,.98)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.beginPath(); ctx.moveTo(x(0), 4); ctx.lineTo(x(0), canvas.height - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(x(0), z(0), FIELD.centerRadius * pixelsPerMeter, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x(0), z(0), 5, 0, Math.PI * 2); ctx.fillStyle = '#f8f8e8'; ctx.fill();
  for (const sign of [-1, 1]) {
    const edge = sign * FIELD.length / 2;
    const boxStart = sign < 0 ? edge : edge - FIELD.penaltyDepth;
    const goalStart = sign < 0 ? edge : edge - FIELD.goalAreaDepth;
    ctx.strokeRect(x(boxStart), z(-FIELD.penaltyWidth / 2), FIELD.penaltyDepth * pixelsPerMeter, FIELD.penaltyWidth * pixelsPerMeter);
    ctx.strokeRect(x(goalStart), z(-FIELD.goalAreaWidth / 2), FIELD.goalAreaDepth * pixelsPerMeter, FIELD.goalAreaWidth * pixelsPerMeter);
    const spotX = sign * (FIELD.length / 2 - FIELD.penaltySpot);
    ctx.beginPath(); ctx.arc(x(spotX), z(0), 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    const arcAngle = Math.acos((FIELD.penaltyDepth - FIELD.penaltySpot) / FIELD.centerRadius);
    ctx.arc(x(spotX), z(0), FIELD.centerRadius * pixelsPerMeter, sign < 0 ? -arcAngle : Math.PI - arcAngle, sign < 0 ? arcAngle : Math.PI + arcAngle);
    ctx.stroke();
  }
  return canvasTexture(THREE, canvas);
}

export function ballTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8f7ed'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#182a2a';
  const panels = [[256, 48], [115, 158], [397, 158], [58, 338], [256, 464], [454, 338], [256, 256]];
  for (const [x, y] of panels) {
    ctx.beginPath(); ctx.arc(x!, y!, 53, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#253637'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(0, 256); ctx.bezierCurveTo(180, 180, 325, 335, 512, 256); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.36)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 252); ctx.bezierCurveTo(180, 176, 325, 331, 512, 252); ctx.stroke();
  return canvasTexture(THREE, canvas);
}

export function adTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const texture = canvasTexture(THREE, canvas);
  const ctx = canvas.getContext('2d')!;
  const brands = ['AURORA MOBILE', 'PULSE ENERGY', 'KICKFORGE', 'NORTHSTAR', 'LUMEN SPORT'];
  let offset = 0;
  const draw = (time: number) => {
    offset = (time * 90) % 1024;
    const g = ctx.createLinearGradient(0, 0, 1024, 0);
    g.addColorStop(0, '#07131f'); g.addColorStop(0.5, '#102a42'); g.addColorStop(1, '#07131f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#d7ff49'; ctx.fillRect(0, 0, 1024, 5); ctx.fillRect(0, 123, 1024, 5);
    ctx.font = '900 39px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (let i = -1; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#f3f7f3' : '#a8f0d6';
      ctx.fillText(`${brands[(i + 20) % brands.length]}   ·   PLAY THE MOMENT`, i * 300 - offset, 67);
    }
    texture.needsUpdate = true;
  };
  draw(0);
  return { texture, draw };
}

export function ballNumberTexture(THREE: Three, number: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff'; ctx.font = '900 150px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 128, 132);
  return canvasTexture(THREE, canvas);
}
