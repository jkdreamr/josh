import type * as T from 'three';

type Three = typeof import('three');

function canvasTexture(THREE: Three, canvas: HTMLCanvasElement, color = true) {
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

function tileNoise(size: number, cellsX: number, cellsY: number, seed: number) {
  const lattice = new Float32Array(cellsX * cellsY);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < lattice.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; lattice[i] = s / 4294967296; }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = y / size * cellsY, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = x / size * cellsX, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const x1 = (x0 + 1) % cellsX, y1 = (y0 + 1) % cellsY;
      const a = lattice[y0 * cellsX + x0]!, b = lattice[y0 * cellsX + x1]!, c = lattice[y1 * cellsX + x0]!, d = lattice[y1 * cellsX + x1]!;
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

/** Tileable grass detail: R = fine blades, G = large patches (both around 0.5), plus a matching normal map. */
export function grassTextures(THREE: Three, lite: boolean) {
  const size = lite ? 256 : 512;
  const blades = tileNoise(size, 96, 20, 71), fine = tileNoise(size, 160, 160, 13);
  const patch = [tileNoise(size, 4, 4, 5), tileNoise(size, 9, 9, 29), tileNoise(size, 19, 19, 3)];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const h = blades[i]! * 0.65 + fine[i]! * 0.35;
    height[i] = h;
    const p = patch[0]![i]! * 0.5 + patch[1]![i]! * 0.33 + patch[2]![i]! * 0.17;
    image.data[i * 4] = Math.round(Math.min(255, Math.max(0, 128 + (h - 0.5) * 210)));
    image.data[i * 4 + 1] = Math.round(Math.min(255, Math.max(0, 128 + (p - 0.5) * 330)));
    image.data[i * 4 + 2] = 128;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const detail = canvasTexture(THREE, canvas, false);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  let normal: T.CanvasTexture | null = null;
  if (!lite) {
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = normalCanvas.height = size;
    const nctx = normalCanvas.getContext('2d')!;
    const nimg = nctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = height[y * size + (x + 1) % size]! - height[y * size + (x + size - 1) % size]!;
      const dy = height[((y + 1) % size) * size + x]! - height[((y + size - 1) % size) * size + x]!;
      const nx = -dx * 2.2, ny = -dy * 2.2, len = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = Math.round((nx / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 3] = 255;
    }
    nctx.putImageData(nimg, 0, 0);
    normal = canvasTexture(THREE, normalCanvas, false);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  }
  return { detail, normal };
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

/** One strip of LED board ads covering BOARD_METERS of board; scroll it with texture.offset.x. */
export const BOARD_METERS = 24;
export function adTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const brands: [string, string, string][] = [
    ['AURORA MOBILE', '#0a1f3c', '#7fe3ff'], ['PULSE ENERGY', '#d7ff49', '#0b1a10'], ['KICKFORGE', '#e8343f', '#fff6ea'],
    ['NORTHSTAR AIR', '#f4f4ef', '#14294a'], ['LUMEN SPORT', '#151515', '#ffb43c'], ['VOLTA BANK', '#1c6b4a', '#f2fff6'],
  ];
  const panel = canvas.width / brands.length;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  brands.forEach(([name, bg, fg], i) => {
    const x = i * panel;
    ctx.fillStyle = bg; ctx.fillRect(x, 0, panel, 96);
    ctx.fillStyle = fg; ctx.globalAlpha = 0.18; ctx.fillRect(x, 0, panel, 7); ctx.fillRect(x, 89, panel, 7); ctx.globalAlpha = 1;
    ctx.font = `italic 900 ${name.length > 11 ? 44 : 52}px system-ui, sans-serif`;
    ctx.fillText(name, x + panel / 2, 50, panel - 30);
  });
  const texture = canvasTexture(THREE, canvas);
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export type SkyLook = 'night' | 'golden' | 'overcast' | 'rain';
export function skyTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const texture = canvasTexture(THREE, canvas);
  const stops: Record<SkyLook, string[]> = {
    night: ['#030812', '#0a1730', '#1d3150', '#3a4c66'],
    golden: ['#5f86ab', '#c9b9a6', '#f5b27a', '#e07b4c'],
    overcast: ['#7b8794', '#9aa5b0', '#b4bcc4', '#a6adb3'],
    rain: ['#262e38', '#3a4450', '#4f5a66', '#5c6670'],
  };
  const draw = (look: SkyLook) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    stops[look].forEach((color, i, all) => g.addColorStop(i / (all.length - 1), color));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
    let seed = 4021;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    if (look === 'golden') {
      const sun = ctx.createRadialGradient(64, 92, 0, 64, 92, 34);
      sun.addColorStop(0, 'rgba(255,246,214,1)'); sun.addColorStop(0.18, 'rgba(255,214,150,.85)'); sun.addColorStop(1, 'rgba(255,170,100,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 40, 160, 88);
    } else {
      for (let i = 0; i < 70; i++) {
        const x = random() * 256, y = 20 + random() * 80, r = 10 + random() * 24;
        const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
        const shade = look === 'rain' ? 40 + random() * 30 : 150 + random() * 60;
        cloud.addColorStop(0, `rgba(${shade},${shade + 4},${shade + 10},.35)`); cloud.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cloud; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    texture.needsUpdate = true;
  };
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
