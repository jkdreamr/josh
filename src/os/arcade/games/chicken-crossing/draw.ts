import { COLUMNS, HOP_TIME, type Car, type Lane, type State } from './logic';

const palettes = [
  { grass: '#a9c891', grassAlt: '#a0bf88', verge: '#90af76', leaf: '#53794a', flower: '#fff0b1', road: '#596069' },
  { grass: '#bfc69a', grassAlt: '#b2be8d', verge: '#98ab77', leaf: '#657d50', flower: '#efc09a', road: '#615f68' },
  { grass: '#9bbcac', grassAlt: '#90b1a1', verge: '#789b8b', leaf: '#476e60', flower: '#eaddad', road: '#545f6c' },
];
const paints = ['#db7759', '#e5bb62', '#71b4b5', '#eee5cc', '#8586b9'];

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function chicken(c: CanvasRenderingContext2D, state: State) {
  const hop = state.hop ? Math.sin((state.hop.elapsed / HOP_TIME) * Math.PI) : 0;
  ellipse(c, 0.025, 0.18, 0.32 - hop * 0.06, 0.12, '#22312c35');
  c.translate(0, -hop * 0.13);
  if (state.dead) c.rotate(-0.35);
  const face = state.facing;
  const side = face === 'left' ? -1 : 1;
  const sideways = face === 'left' || face === 'right';
  rect(c, -0.18, 0.19, 0.11, 0.18 - hop * 0.06, 0.045, '#dc9c37');
  rect(c, 0.07, 0.19, 0.11, 0.18 - hop * 0.06, 0.045, '#dc9c37');
  ellipse(c, -0.13, 0.34 - hop * 0.07, 0.11, 0.045, '#edb348');
  ellipse(c, 0.13, 0.34 - hop * 0.07, 0.11, 0.045, '#edb348');
  ellipse(c, 0, 0.02, 0.3, 0.32, '#d8dccc');
  ellipse(c, -0.025, -0.03, 0.28, 0.29, '#fffdf1');
  ellipse(c, -0.25, 0.04, 0.1, 0.2 - hop * 0.06, '#ecebd9');
  ellipse(c, 0.25, 0.04, 0.1, 0.2 - hop * 0.06, '#ecebd9');
  const headX = sideways ? side * 0.14 : 0;
  ellipse(c, headX, -0.22, 0.22, 0.21, '#fffdf1');
  for (let i = 0; i < 3; i++) ellipse(c, headX - 0.12 + i * 0.1, -0.39 - (i === 1 ? 0.035 : 0), 0.07, 0.095, '#d65445');
  const beakX = sideways ? side * 0.37 : 0;
  const beakY = sideways ? -0.18 : face === 'down' ? -0.04 : -0.31;
  c.fillStyle = '#edb348';
  c.beginPath();
  c.moveTo(beakX - (sideways ? side * 0.09 : 0.085), beakY - 0.065);
  c.lineTo(beakX + (sideways ? side * 0.075 : 0), beakY + (sideways ? 0 : -0.04));
  c.lineTo(beakX - (sideways ? side * 0.09 : -0.085), beakY + 0.065);
  c.fill();
  ellipse(c, sideways ? side * 0.18 : -0.095, -0.22, 0.035, 0.04, '#30352e');
  if (!sideways) ellipse(c, 0.095, -0.22, 0.035, 0.04, '#30352e');
  ellipse(c, headX + 0.06, -0.04, 0.045, 0.07, '#d65445');
  if (state.dead) {
    for (let i = 0; i < 6; i++) {
      c.save();
      c.rotate(i * 1.1);
      ellipse(c, 0.6 + (i % 2) * 0.15, 0, 0.12, 0.05, '#fffdf1');
      c.restore();
    }
  }
}

function vehicle(c: CanvasRenderingContext2D, car: Car, direction: number) {
  c.scale(direction, 1);
  const x = -car.width / 2;
  rect(c, x + 0.03, -0.22, car.width, 0.64, 0.12, '#28333945');
  for (const wheelX of [x + 0.15, -x - 0.32]) {
    rect(c, wheelX, -0.35, 0.22, 0.12, 0.03, '#2d343b');
    rect(c, wheelX, 0.23, 0.22, 0.12, 0.03, '#2d343b');
  }
  rect(c, x, -0.29, car.width, 0.58, 0.12, paints[car.color]);
  if (car.truck) {
    rect(c, x + 0.08, -0.24, car.width - 0.7, 0.48, 0.05, '#d8c7a3');
    for (let t = 0.3; t < car.width - 0.7; t += 0.25) rect(c, x + t, -0.22, 0.035, 0.44, 0, '#b4a27e');
    rect(c, -x - 0.55, -0.21, 0.22, 0.42, 0.04, '#3f5862');
  } else {
    rect(c, x + 0.28, -0.24, 0.58, 0.48, 0.08, '#435763');
    rect(c, x + 0.4, -0.245, 0.31, 0.49, 0.07, paints[car.color]);
    rect(c, x + 0.77, -0.17, 0.05, 0.34, 0.02, '#c8e4e3');
  }
  for (const y of [-0.19, 0.11]) {
    rect(c, -x - 0.09, y, 0.06, 0.09, 0.02, '#fff2c4');
    rect(c, x + 0.025, y, 0.045, 0.09, 0.02, '#b4463f');
  }
}

function corn(c: CanvasRenderingContext2D, t: number) {
  ellipse(c, 0.02, 0.19, 0.23, 0.075, '#29442b25');
  c.translate(0, Math.sin(t * 3) * 0.035);
  ellipse(c, -0.13, 0.05, 0.08, 0.21, '#628a49');
  ellipse(c, 0.13, 0.05, 0.08, 0.21, '#7e9e51');
  ellipse(c, 0, -0.04, 0.135, 0.24, '#f5cf63');
  for (let y = -0.17; y <= 0.13; y += 0.09) {
    ellipse(c, -0.045, y, 0.025, 0.023, '#ffe89a');
    ellipse(c, 0.045, y, 0.025, 0.023, '#d8ac40');
  }
}

function foliage(c: CanvasRenderingContext2D, lane: Lane, colors: typeof palettes[number]) {
  const seed = lane.seed >>> 0;
  for (const side of [-1, COLUMNS]) {
    const x = side + 0.07 + ((seed % 5) - 2) * 0.05;
    ellipse(c, x + 0.08, 0.19, 0.4, 0.21, '#35482f20');
    rect(c, x - 0.05, -0.03, 0.1, 0.34, 0.02, '#7c7354');
    ellipse(c, x - 0.1, -0.14, 0.3, 0.27, colors.leaf);
    ellipse(c, x + 0.13, -0.23, 0.29, 0.28, colors.leaf);
    ellipse(c, x - 0.03, -0.34, 0.28, 0.24, colors.verge);
  }
  for (let col = 0; col < COLUMNS; col++) {
    if ((seed + col * 31) % 7 > 1 || col === lane.corn) continue;
    const x = col + 0.22;
    const y = 0.24 - ((seed + col) % 4) * 0.14;
    rect(c, x, y, 0.025, 0.1, 0, colors.leaf);
    ellipse(c, x + 0.01, y, 0.045, 0.045, colors.flower);
  }
}

export function draw(c: CanvasRenderingContext2D, w: number, h: number, state: State, camera: number, sunset: boolean) {
  if (!w || !h) return;
  const short = h < 120;
  const cell = Math.min(w / 11, h / (short ? 4 : 6.5));
  const left = (w - COLUMNS * cell) / 2;
  const baseline = h - cell * (short ? 1.1 : 1.9);
  const colors = palettes[Math.floor(state.maxRow / 24) % palettes.length];
  c.save();
  c.fillStyle = colors.verge;
  c.fillRect(0, 0, w, h);
  c.translate(left + cell / 2, baseline);
  c.scale(cell, cell);
  for (const lane of state.lanes) {
    const y = camera - lane.row;
    if (baseline + (y + 0.6) * cell < 0 || baseline + (y - 0.6) * cell > h) continue;
    c.save();
    c.translate(0, y);
    if (lane.kind === 'road') {
      rect(c, -2, -0.5, COLUMNS + 3, 1.01, 0, colors.road);
      rect(c, -0.5, -0.49, COLUMNS, 0.03, 0, '#e1ddc580');
      rect(c, -0.5, 0.47, COLUMNS, 0.03, 0, '#353e4770');
      for (let x = -1; x < COLUMNS + 1; x += 1.35) rect(c, x, 0.35, 0.6, 0.025, 0, '#e3e4d266');
      for (const car of lane.cars) {
        c.save();
        c.translate(car.x, 0);
        vehicle(c, car, lane.direction);
        c.restore();
      }
    } else {
      rect(c, -0.5, -0.5, COLUMNS, 1.01, 0, lane.row % 2 ? colors.grassAlt : colors.grass);
      foliage(c, lane, colors);
      if (lane.row === 0) {
        for (let col = -0.4; col < COLUMNS; col += 0.45) rect(c, col, 0.43, 0.07, 0.17, 0.02, '#e9e5c5');
        rect(c, -0.4, 0.48, COLUMNS - 0.15, 0.04, 0, '#e9e5c5');
      }
      if (lane.corn !== null && !lane.collected) {
        c.save();
        c.translate(lane.corn, 0);
        corn(c, state.time + lane.row);
        c.restore();
      }
    }
    c.restore();
  }
  c.save();
  c.translate(state.x, camera - state.y);
  chicken(c, state);
  c.restore();
  c.restore();
  if (sunset) {
    c.fillStyle = '#b06b3b1c';
    c.fillRect(0, 0, w, h);
  }
}
