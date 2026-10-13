// Skin art: the top of each player's cube, drawn with Canvas 2D. Used for the 3D heads and the skin picker.
import { colorOf, shade, type Pattern } from './skins.ts';

type G = CanvasRenderingContext2D;

const INK = '#2a1d1a';

function rounded(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draws a skin into a square of side s at the origin: the player's color, a soft bevel and the pattern. */
export function drawSkin(g: G, s: number, pattern: Pattern, color: number) {
  const base = colorOf(color);
  g.save();
  g.clearRect(0, 0, s, s);
  const grad = g.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, shade(base, 0.16));
  grad.addColorStop(1, shade(base, -0.08));
  g.fillStyle = grad;
  rounded(g, 0, 0, s, s, s * 0.12);
  g.fill();
  // paper bevel
  g.lineWidth = s * 0.05;
  g.strokeStyle = shade(base, 0.32);
  rounded(g, s * 0.035, s * 0.035, s * 0.93, s * 0.93, s * 0.1);
  g.stroke();
  g.translate(s / 2, s / 2);
  g.scale(s / 100, s / 100);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  PATTERNS[pattern](g, base);
  g.restore();
}

const circle = (g: G, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};

const PATTERNS: Record<Pattern, (g: G, base: string) => void> = {
  face(g) {
    // two big eyes looking the way you go (the cube's +x side is forward)
    for (const y of [-15, 15]) {
      g.fillStyle = '#fff';
      circle(g, 8, y, 13);
      g.fillStyle = INK;
      circle(g, 13, y, 6.5);
      g.fillStyle = '#fff';
      circle(g, 15, y - 2.5, 2.2);
    }
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(-14, 0, 14, Math.PI * 0.62, Math.PI * 1.38);
    g.stroke();
  },
  palm(g) {
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(-8, 34);
    g.quadraticCurveTo(-2, 8, 6, -12);
    g.stroke();
    g.lineWidth = 6;
    for (const [dx, dy] of [
      [-30, -6],
      [-24, -26],
      [6, -36],
      [30, -24],
      [32, 0],
    ]) {
      g.beginPath();
      g.moveTo(6, -14);
      g.quadraticCurveTo(6 + dx * 0.5, -14 + dy * 0.9 - 10, 6 + dx, -14 + dy);
      g.stroke();
    }
    circle(g, 2, -8, 4);
    circle(g, 10, -8, 4);
  },
  wave(g) {
    g.lineWidth = 7;
    for (const y of [-20, 0, 20]) {
      g.beginPath();
      g.moveTo(-34, y);
      for (let x = -34; x <= 34; x += 2) g.lineTo(x, y + Math.sin((x / 34) * Math.PI * 2) * 6);
      g.stroke();
    }
  },
  tree(g, base) {
    g.fillStyle = '#fff';
    for (const [y, w] of [
      [-34, 14],
      [-18, 24],
      [0, 34],
    ]) {
      g.beginPath();
      g.moveTo(0, y - 8);
      g.lineTo(w, y + 18);
      g.lineTo(-w, y + 18);
      g.closePath();
      g.fill();
    }
    g.fillRect(-5, 18, 10, 18);
    g.fillStyle = shade(base, -0.2);
    g.fillRect(-2, 20, 4, 14);
  },
  oar(g) {
    for (const s of [1, -1]) {
      g.save();
      g.rotate(s * 0.75);
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, 38);
      g.lineTo(0, -14);
      g.stroke();
      g.beginPath();
      g.moveTo(-9, -14);
      g.quadraticCurveTo(-12, -34, 0, -42);
      g.quadraticCurveTo(12, -34, 9, -14);
      g.closePath();
      g.fill();
      g.restore();
    }
  },
  cox(g) {
    // a coxswain's megaphone with a sound wave
    g.beginPath();
    g.moveTo(-30, -9);
    g.lineTo(8, -26);
    g.lineTo(8, 26);
    g.lineTo(-30, 9);
    g.closePath();
    g.fill();
    g.fillRect(-36, -9, 8, 18);
    g.lineWidth = 6;
    for (const r of [16, 28]) {
      g.beginPath();
      g.arc(8, 0, r, -0.7, 0.7);
      g.stroke();
    }
  },
  tower(g) {
    g.fillRect(-9, -18, 18, 54);
    g.fillRect(-13, -26, 26, 10);
    g.beginPath();
    g.moveTo(-11, -26);
    g.quadraticCurveTo(0, -46, 11, -26);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(-5, -14, 4, 8);
    g.fillRect(2, -14, 4, 8);
    g.fillRect(-26, 30, 52, 6);
  },
  dish(g) {
    // the Dish: a big bowl tipped up at the sky on a stand
    g.save();
    g.translate(2, -4);
    g.rotate(-0.55);
    g.beginPath();
    g.ellipse(0, 0, 32, 16, 0, 0, Math.PI);
    g.closePath();
    g.fill();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -24);
    g.stroke();
    circle(g, 0, -27, 5);
    g.restore();
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(4, 10);
    g.lineTo(-8, 34);
    g.moveTo(4, 10);
    g.lineTo(18, 34);
    g.moveTo(-14, 34);
    g.lineTo(24, 34);
    g.stroke();
  },
  axe(g) {
    g.save();
    g.rotate(-0.6);
    g.fillStyle = '#f2c94c';
    g.fillRect(-4, -34, 8, 72);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(4, -32);
    g.quadraticCurveTo(34, -36, 32, -6);
    g.quadraticCurveTo(20, -12, 4, -8);
    g.closePath();
    g.fill();
    g.restore();
  },
  pi(g) {
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-30, -20);
    g.quadraticCurveTo(-26, -28, -16, -26);
    g.lineTo(32, -26);
    g.moveTo(-10, -26);
    g.quadraticCurveTo(-10, 12, -22, 30);
    g.moveTo(14, -26);
    g.quadraticCurveTo(10, 20, 26, 30);
    g.stroke();
  },
  sun(g) {
    circle(g, 0, 0, 17);
    g.lineWidth = 6;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * 25, Math.sin(a) * 25);
      g.lineTo(Math.cos(a) * 37, Math.sin(a) * 37);
      g.stroke();
    }
  },
  poppy(g) {
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i / 4) * Math.PI * 2 + 0.4);
      g.beginPath();
      g.ellipse(0, -18, 15, 19, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = '#f2c94c';
    circle(g, 0, 0, 9);
  },
  crown(g) {
    g.beginPath();
    g.moveTo(-32, 22);
    g.lineTo(-34, -18);
    g.lineTo(-16, 0);
    g.lineTo(0, -30);
    g.lineTo(16, 0);
    g.lineTo(34, -18);
    g.lineTo(32, 22);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2c94c';
    circle(g, 0, 8, 6);
    circle(g, -20, 10, 4);
    circle(g, 20, 10, 4);
  },
};
