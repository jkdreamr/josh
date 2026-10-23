type Three = typeof import('three');

function canvasTexture(THREE: Three, canvas: HTMLCanvasElement, color = true) {
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export function courtTextures(THREE: Three, lite: boolean) {
  const size = lite ? 512 : 1024;
  const color = document.createElement('canvas');
  color.width = color.height = size;
  const ctx = color.getContext('2d')!;
  ctx.fillStyle = '#245c80';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.12; i++) {
    const shade = Math.floor(30 + Math.random() * 55);
    ctx.fillStyle = `rgba(${shade},${shade + 10},${shade + 14},${Math.random() * 0.12})`;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1 + Math.random() * 3, 1);
  }
  ctx.globalAlpha = 0.13;
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 14 + Math.random() * 95, 1 + Math.random() * 4, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.strokeStyle = '#d8e0dc';
    ctx.lineWidth = 2 + Math.random() * 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.ellipse(size * (0.22 + Math.random() * 0.56), Math.random() * size, 8 + Math.random() * 18, 3 + Math.random() * 6, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(21,31,38,.13)';
    ctx.fill();
  }

  const normal = document.createElement('canvas');
  normal.width = normal.height = size;
  const normalCtx = normal.getContext('2d')!;
  normalCtx.fillStyle = '#8080ff';
  normalCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.035; i++) {
    const shade = 110 + Math.floor(Math.random() * 45);
    normalCtx.fillStyle = `rgb(${shade},${shade},255)`;
    normalCtx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const roughness = document.createElement('canvas');
  roughness.width = roughness.height = size;
  const roughCtx = roughness.getContext('2d')!;
  roughCtx.fillStyle = '#b7b7b7';
  roughCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.02; i++) {
    const shade = 110 + Math.floor(Math.random() * 120);
    roughCtx.fillStyle = `rgb(${shade},${shade},${shade})`;
    roughCtx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }

  const repeats = lite ? 5 : 8;
  const maps = [canvasTexture(THREE, color), canvasTexture(THREE, normal, false), canvasTexture(THREE, roughness, false)];
  for (const map of maps) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeats, repeats);
  }
  return { color: maps[0], normal: maps[1], roughness: maps[2] };
}

export function netTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(221,232,225,.72)';
  ctx.lineWidth = 1.4;
  for (let x = -128; x < 256; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 128, 128);
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 128, 128);
    ctx.stroke();
  }
  return canvasTexture(THREE, canvas);
}

export function ballTexture(THREE: Three, lite: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = lite ? 256 : 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d7e647';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < canvas.width * canvas.height * 0.11; i++) {
    const alpha = 0.05 + Math.random() * 0.15;
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 74},${Math.random() > 0.5 ? 255 : 80},${Math.random() > 0.5 ? 220 : 14},${alpha})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }
  ctx.strokeStyle = '#f4f2cf';
  ctx.lineWidth = canvas.width * 0.022;
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.03, canvas.height * 0.44);
  ctx.bezierCurveTo(canvas.width * 0.29, canvas.height * 0.53, canvas.width * 0.68, canvas.height * 0.43, canvas.width * 0.97, canvas.height * 0.55);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(68,77,38,.4)';
  ctx.lineWidth = canvas.width * 0.004;
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.03, canvas.height * 0.44);
  ctx.bezierCurveTo(canvas.width * 0.29, canvas.height * 0.53, canvas.width * 0.68, canvas.height * 0.43, canvas.width * 0.97, canvas.height * 0.55);
  ctx.stroke();
  return canvasTexture(THREE, canvas);
}

export function windscreenTexture(THREE: Three) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#173e31';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += 4) {
    ctx.fillStyle = `rgba(203,221,199,${Math.random() * 0.04})`;
    ctx.fillRect(x, 0, 1, canvas.height);
  }
  ctx.fillStyle = '#f1eee2';
  ctx.font = '700 96px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STANFORD  •  TAUBE STADIUM', canvas.width / 2, canvas.height / 2);
  return canvasTexture(THREE, canvas);
}

export function scoreboardTexture(THREE: Three, score: string[]) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#17332c');
  gradient.addColorStop(1, '#0b1717');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#c6d3bc';
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = '#e4e8d2';
  ctx.font = 'bold 33px Georgia,serif';
  ctx.fillText('TAUBE STADIUM', 32, 54);
  ctx.font = '24px Arial,sans-serif';
  ctx.fillStyle = '#b7c2ae';
  ctx.fillText('STANFORD  •  SINGLES / DOUBLES', 32, 90);
  ctx.font = 'bold 38px Arial,sans-serif';
  ctx.fillStyle = '#f4f2d9';
  score.forEach((line, index) => ctx.fillText(line, 32, 150 + index * 54));
  return canvasTexture(THREE, canvas);
}
