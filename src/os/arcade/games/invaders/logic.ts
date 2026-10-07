export type Alien = { x: number; y: number; col: number; row: number; type: number; points: number };
export type Shot = { x: number; y: number; vy: number };
export type Shield = { x: number; y: number; cell: number; cols: number; rows: number; cells: boolean[][] };
export type InvadersState = {
  width: number;
  height: number;
  aliens: Alien[];
  direction: 1 | -1;
  stepTimer: number;
  stepCount: number;
  animation: number;
  player: { x: number; y: number; speed: number; invulnerable: number };
  playerShots: Shot[];
  alienShots: Shot[];
  shields: Shield[];
  score: number;
  lives: number;
  wave: number;
  dropSteps: number;
  waveBanner: number;
  shotTimer: number;
  ufo: { x: number; direction: 1 | -1; points: number } | null;
  ufoTimer: number;
  pointsFlash: { x: number; y: number; value: number; time: number } | null;
  elapsed: number;
  ended: boolean;
  effects: { type: 'march' | 'alien' | 'player' | 'ufo' | 'shot' | 'wave'; x: number; y: number; points?: number }[];
};

const alienWidth = 28;
const alienHeight = 21;

function makeAliens(dropSteps = 0) {
  const aliens: Alien[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 11; col++) {
      aliens.push({
        x: 43 + col * 38,
        y: 104 + row * 34 + dropSteps * 16,
        col,
        row,
        type: row < 2 ? 2 : row === 2 ? 1 : 0,
        points: row === 0 ? 30 : row < 3 ? 20 : 10,
      });
    }
  }
  return aliens;
}

function makeShields() {
  return Array.from({ length: 4 }, (_, i) => ({
    x: 30 + i * 117,
    y: 566,
    cell: 6,
    cols: 11,
    rows: 7,
    cells: Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: 11 }, (_, col) => !(row < 2 && (col < 2 || col > 8)) && !(row > 4 && col >= 4 && col <= 6)),
    ),
  }));
}

export function stepIntervalForCount(count: number) {
  return Math.max(0.075, 0.56 * Math.max(0.14, count / 55));
}

export function createInvaders(wave = 1, lives = 3, score = 0, rng: () => number = Math.random): InvadersState {
  return {
    width: 500,
    height: 700,
    aliens: makeAliens(),
    direction: 1,
    stepTimer: 0,
    stepCount: 0,
    animation: 0,
    player: { x: 250, y: 646, speed: 300, invulnerable: 0 },
    playerShots: [],
    alienShots: [],
    shields: makeShields(),
    score,
    lives,
    wave,
    dropSteps: 0,
    waveBanner: 0,
    shotTimer: 1.5 + rng() * 1.5,
    ufo: null,
    ufoTimer: 9 + rng() * 8,
    pointsFlash: null,
    elapsed: 0,
    ended: false,
    effects: [],
  };
}

export function stepFormation(state: InvadersState) {
  const dx = state.direction * 14;
  const atEdge = state.aliens.some((alien) => alien.x + dx < 22 || alien.x + dx + alienWidth > state.width - 22);
  if (atEdge) {
    state.direction = state.direction === 1 ? -1 : 1;
    for (const alien of state.aliens) alien.y += 16;
    state.dropSteps++;
  } else {
    for (const alien of state.aliens) alien.x += dx;
  }
  state.stepCount++;
  state.animation = 1 - state.animation;
  state.effects.push({ type: 'march', x: 0, y: 0 });
  if (state.aliens.some((alien) => alien.y + alienHeight >= state.player.y - 12)) state.ended = true;
  eraseAliensThroughShields(state);
  return atEdge;
}

function eraseAliensThroughShields(state: InvadersState) {
  for (const alien of state.aliens) {
    for (const shield of state.shields) {
      const left = Math.floor((alien.x - shield.x) / shield.cell);
      const right = Math.ceil((alien.x + alienWidth - shield.x) / shield.cell);
      const top = Math.floor((alien.y - shield.y) / shield.cell);
      const bottom = Math.ceil((alien.y + alienHeight - shield.y) / shield.cell);
      for (let row = Math.max(0, top); row < Math.min(shield.rows, bottom); row++) {
        for (let col = Math.max(0, left); col < Math.min(shield.cols, right); col++) shield.cells[row][col] = false;
      }
    }
  }
}

export function firePlayerShot(state: InvadersState) {
  if (state.ended || state.playerShots.length >= 2) return false;
  state.playerShots.push({ x: state.player.x, y: state.player.y - 14, vy: -470 });
  state.effects.push({ type: 'shot', x: state.player.x, y: state.player.y });
  return true;
}

export function fireAlienShot(state: InvadersState, rng: () => number = Math.random) {
  if (!state.aliens.length) return false;
  const lowest = new Map<number, Alien>();
  for (const alien of state.aliens) {
    const prev = lowest.get(alien.col);
    if (!prev || alien.y > prev.y) lowest.set(alien.col, alien);
  }
  const columns = [...lowest.values()];
  const source = columns[Math.min(columns.length - 1, Math.floor(rng() * columns.length))];
  state.alienShots.push({ x: source.x + alienWidth / 2, y: source.y + alienHeight + 2, vy: 225 + state.wave * 15 });
  return true;
}

export function erodeShield(shield: Shield, x: number, y: number, rng: () => number = Math.random) {
  const col = Math.floor((x - shield.x) / shield.cell);
  const row = Math.floor((y - shield.y) / shield.cell);
  if (col < 0 || col >= shield.cols || row < 0 || row >= shield.rows || !shield.cells[row][col]) return false;
  const patterns = [
    [[0, 0], [1, 0], [0, 1], [-1, 1]],
    [[0, 0], [-1, 0], [0, -1], [1, 1]],
    [[0, 0], [1, 0], [-1, 0], [0, 1]],
  ];
  const pattern = patterns[Math.min(patterns.length - 1, Math.floor(rng() * patterns.length))];
  let removed = false;
  for (const [dx, dy] of pattern) {
    const cx = col + dx;
    const cy = row + dy;
    if (cx >= 0 && cx < shield.cols && cy >= 0 && cy < shield.rows && shield.cells[cy][cx]) {
      shield.cells[cy][cx] = false;
      removed = true;
    }
  }
  return removed;
}

export function damageShieldAt(state: InvadersState, x: number, y: number, rng: () => number = Math.random) {
  for (const shield of state.shields) {
    if (x >= shield.x && x < shield.x + shield.cols * shield.cell && y >= shield.y && y < shield.y + shield.rows * shield.cell) {
      return erodeShield(shield, x, y, rng);
    }
  }
  return false;
}

export function advanceWave(state: InvadersState) {
  state.wave++;
  state.dropSteps = Math.min(8, state.dropSteps + 1);
  state.aliens = makeAliens(state.dropSteps);
  state.direction = 1;
  state.stepTimer = 0;
  state.playerShots = [];
  state.alienShots = [];
  state.shields = makeShields();
  state.waveBanner = 1.15;
  state.effects.push({ type: 'wave', x: state.width / 2, y: state.height / 2 });
}

function updateShots(state: InvadersState, dt: number, rng: () => number) {
  const playerRemaining: Shot[] = [];
  for (const shot of state.playerShots) {
    let hit = false;
    const distance = Math.max(1, Math.ceil(Math.abs(shot.vy * dt) / 5));
    for (let i = 0; i < distance; i++) {
      shot.y += shot.vy * dt / distance;
      const alien = state.aliens.find((entry) => shot.x >= entry.x && shot.x <= entry.x + alienWidth && shot.y >= entry.y && shot.y <= entry.y + alienHeight);
      if (alien) {
        state.aliens.splice(state.aliens.indexOf(alien), 1);
        state.score += alien.points;
        state.effects.push({ type: 'alien', x: alien.x + alienWidth / 2, y: alien.y + alienHeight / 2, points: alien.points });
        hit = true;
        break;
      }
      if (damageShieldAt(state, shot.x, shot.y, rng)) {
        hit = true;
        break;
      }
      if (state.ufo && shot.y >= 58 && shot.y <= 80 && shot.x >= state.ufo.x && shot.x <= state.ufo.x + 38) {
        const points = state.ufo.points;
        state.score += points;
        state.pointsFlash = { x: state.ufo.x + 19, y: 65, value: points, time: 1.2 };
        state.effects.push({ type: 'ufo', x: state.ufo.x, y: 68, points });
        state.ufo = null;
        hit = true;
        break;
      }
      if (shot.y < 50) {
        hit = true;
        break;
      }
    }
    if (!hit && shot.y > 50) playerRemaining.push(shot);
  }
  state.playerShots = playerRemaining;

  const alienRemaining: Shot[] = [];
  for (const shot of state.alienShots) {
    let hit = false;
    const distance = Math.max(1, Math.ceil(Math.abs(shot.vy * dt) / 5));
    for (let i = 0; i < distance; i++) {
      shot.y += shot.vy * dt / distance;
      if (damageShieldAt(state, shot.x, shot.y, rng)) {
        hit = true;
        break;
      }
      if (shot.y >= state.player.y - 12 && shot.y <= state.player.y + 8 && Math.abs(shot.x - state.player.x) < 17) {
        hit = true;
        if (state.player.invulnerable <= 0) {
          state.lives--;
          state.player.invulnerable = 1.8;
          state.effects.push({ type: 'player', x: state.player.x, y: state.player.y });
          if (state.lives <= 0) state.ended = true;
        }
        break;
      }
      if (shot.y > state.height - 40) {
        hit = true;
        break;
      }
    }
    if (!hit) alienRemaining.push(shot);
  }
  state.alienShots = alienRemaining;
}

export function stepInvaders(state: InvadersState, dt: number, axis = 0, rng: () => number = Math.random) {
  if (state.ended) return;
  state.effects = [];
  state.elapsed += dt;
  state.player.invulnerable = Math.max(0, state.player.invulnerable - dt);
  if (state.pointsFlash) {
    state.pointsFlash.time -= dt;
    if (state.pointsFlash.time <= 0) state.pointsFlash = null;
  }
  if (state.waveBanner > 0) {
    state.waveBanner -= dt;
    if (state.waveBanner <= 0) {
      if (!state.aliens.length) advanceWave(state);
      else state.shotTimer = 1.3 / Math.sqrt(state.wave) + rng() * 0.7;
    }
    return;
  }
  state.player.x = Math.max(22, Math.min(state.width - 22, state.player.x + axis * state.player.speed * dt));
  state.stepTimer += dt;
  const interval = stepIntervalForCount(state.aliens.length) / Math.sqrt(state.wave);
  while (state.stepTimer >= interval && state.aliens.length) {
    state.stepTimer -= interval;
    stepFormation(state);
    if (state.ended) return;
  }
  state.shotTimer -= dt;
  if (state.shotTimer <= 0) {
    fireAlienShot(state, rng);
    state.shotTimer = Math.max(0.32, 1.45 / Math.sqrt(state.wave) + rng() * 1.2);
  }
  state.ufoTimer -= dt;
  if (state.ufoTimer <= 0 && !state.ufo) {
    const direction = rng() < 0.5 ? 1 : -1;
    state.ufo = { x: direction === 1 ? -42 : state.width + 4, direction, points: [50, 100, 150, 200, 300][Math.floor(rng() * 5)] };
    state.ufoTimer = 12 + rng() * 12;
  }
  if (state.ufo) {
    state.ufo.x += state.ufo.direction * 70 * dt;
    if (state.ufo.x > state.width + 50 || state.ufo.x < -55) state.ufo = null;
  }
  updateShots(state, dt, rng);
  if (!state.aliens.length && state.waveBanner <= 0) {
    state.score += 100;
    state.waveBanner = 1.15;
    state.effects.push({ type: 'wave', x: state.width / 2, y: state.height / 2 });
  }
  if (state.aliens.some((alien) => alien.y + alienHeight >= state.player.y - 12)) state.ended = true;
}
