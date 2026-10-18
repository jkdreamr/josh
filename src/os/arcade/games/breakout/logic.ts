export type Brick = { x: number; y: number; w: number; h: number; hp: number; maxHp: number; row: number; col: number };
export type Ball = { x: number; y: number; vx: number; vy: number; r: number; attached: boolean };
export type PowerKind = 'wide' | 'multi' | 'slow';
export type Drop = { x: number; y: number; kind: PowerKind; vy: number };
export type Effect =
  | { type: 'brick'; x: number; y: number; broke: boolean; row: number; maxHp: number; chain: number; points: number; w: number; h: number }
  | { type: 'paddle' | 'wall' | 'life' | 'clear' | 'launch'; x: number; y: number }
  | { type: 'power'; x: number; y: number; value: PowerKind };
/** The playfield in logic units. `top` is where the first brick row starts, `bottom` the gap left under the paddle. */
export type Field = { width: number; height: number; top: number; bottom: number };
export type BreakoutState = {
  width: number;
  height: number;
  top: number;
  bottom: number;
  paddle: { x: number; y: number; width: number; baseWidth: number; height: number; vx: number };
  balls: Ball[];
  bricks: Brick[];
  drops: Drop[];
  score: number;
  lives: number;
  level: number;
  time: number;
  levelStart: number;
  wideUntil: number;
  slowUntil: number;
  slowActive: boolean;
  levelBanner: number;
  /** Paddle hits since the last launch; the ball speeds up with the rally. */
  rally: number;
  /** Bricks broken since the ball last touched the paddle. */
  chain: number;
  ended: boolean;
  effects: Effect[];
};

export const COLS = 11;
export const SLOW = 0.65;
const BALL_R = 7;
const PADDLE_H = 13;
const SIDE = 12;

// 1 takes one hit, 2 two, 3 three. Every layout is 11 columns wide so scores compare on any screen.
const layouts = [
  ['01111111110', '11222222211', '01111111110', '00111111100', '00011111000'],
  ['11000000011', '01100000110', '00112211000', '00111111000', '01111111110', '11001100110'],
  ['00011111000', '00121112100', '01211111210', '11111111111', '00121112100', '00011111000'],
  ['11100100111', '22111111122', '00111111100', '11011111011', '11100100111'],
  ['22222222222', '10101010101', '11111111111', '01010101010', '11111111111'],
  ['01100000110', '12210001221', '12221012221', '01222122210', '00122222100', '00012221000'],
  ['33300000333', '11111111111', '00022222000', '11111111111', '22200000222', '11111111111'],
  ['10000000001', '21000000012', '32111111123', '21222222212', '10111111101', '00011111000'],
];

export function layoutCount() {
  return layouts.length;
}

/** Picks a logic-unit field for a canvas: tall on phones, wide and short on a laptop window, never so zoomed in that things look blown up. */
export function fieldFor(cw: number, ch: number) {
  const w = Math.max(1, cw);
  const h = Math.max(1, ch);
  const a = w / h;
  let height = Math.max(360, Math.min(760, 520 / a));
  height = Math.max(height, Math.min(900, h / 1.35));
  const width = Math.max(480, Math.min(1000, height * a));
  const scale = Math.min(w / width, h / height);
  return { width, height, scale, x: (w - width * scale) / 2, y: (h - height * scale) / 2 };
}

function brickLayout(level: number) {
  const index = (level - 1) % layouts.length;
  const lap = Math.floor((level - 1) / layouts.length);
  // After the last layout they come round again, a little tougher each lap.
  return layouts[index].map((row, r) => [...row].map((ch) => {
    const hp = Number(ch);
    return hp && r < lap * 2 ? Math.min(3, hp + 1) : hp;
  }));
}

function rowPitch(state: Pick<BreakoutState, 'height'>) {
  return Math.max(17, Math.min(32, state.height * 0.05));
}

function placeBrick(state: Pick<BreakoutState, 'width' | 'height' | 'top'>, brick: Brick) {
  const pitchX = (state.width - SIDE * 2) / COLS;
  const pitchY = rowPitch(state);
  const gapX = Math.min(6, pitchX * 0.12);
  const gapY = Math.max(3, pitchY * 0.2);
  brick.x = SIDE + brick.col * pitchX + gapX / 2;
  brick.y = state.top + brick.row * pitchY;
  brick.w = pitchX - gapX;
  brick.h = pitchY - gapY;
}

function bricksForLevel(state: Pick<BreakoutState, 'width' | 'height' | 'top'>, level: number) {
  const bricks: Brick[] = [];
  brickLayout(level).forEach((row, r) => row.forEach((hp, col) => {
    if (!hp) return;
    const brick: Brick = { x: 0, y: 0, w: 0, h: 0, hp, maxHp: hp, row: r, col };
    placeBrick(state, brick);
    bricks.push(brick);
  }));
  return bricks;
}

export function paddleWidth(state: Pick<BreakoutState, 'width' | 'level'>) {
  return state.width * 0.19 * Math.max(0.74, 1 - 0.03 * (state.level - 1));
}

/** Full ball speed: grows with the level and the rally, measured in field heights per second. */
export function ballSpeed(state: Pick<BreakoutState, 'height' | 'level' | 'rally'>) {
  const level = Math.min(1.55, 1 + 0.045 * (state.level - 1));
  const rally = Math.min(1.28, 1 + 0.014 * state.rally);
  return state.height * 0.54 * level * rally;
}

function makeBall(paddle: BreakoutState['paddle']): Ball {
  return { x: paddle.x, y: paddle.y - PADDLE_H / 2 - BALL_R - 1, vx: 0, vy: 0, r: BALL_R, attached: true };
}

function paddleY(field: Pick<Field, 'height' | 'bottom'>) {
  return field.height - Math.max(field.bottom, PADDLE_H);
}

export function createBreakout(level = 1, field: Partial<Field> = {}): BreakoutState {
  const width = field.width ?? 500;
  const height = field.height ?? 700;
  const top = field.top ?? height * 0.11;
  const bottom = field.bottom ?? Math.max(30, height * 0.06);
  const base = width * 0.19 * Math.max(0.74, 1 - 0.03 * (level - 1));
  const paddle = { x: width / 2, y: paddleY({ height, bottom }), width: base, baseWidth: base, height: PADDLE_H, vx: 0 };
  const state: BreakoutState = {
    width,
    height,
    top,
    bottom,
    paddle,
    balls: [makeBall(paddle)],
    bricks: [],
    drops: [],
    score: 0,
    lives: 3,
    level,
    time: 0,
    levelStart: 0,
    wideUntil: 0,
    slowUntil: 0,
    slowActive: false,
    levelBanner: 0,
    rally: 0,
    chain: 0,
    ended: false,
    effects: [],
  };
  state.bricks = bricksForLevel(state, level);
  return state;
}

/** Fits a round in progress to a new field size, keeping everything where it was relative to the walls. */
export function resizeBreakout(state: BreakoutState, field: Field) {
  const sx = field.width / state.width;
  const sy = field.height / state.height;
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6 && field.top === state.top && field.bottom === state.bottom) return;
  const oldPaddleY = state.paddle.y;
  state.width = field.width;
  state.height = field.height;
  state.top = field.top;
  state.bottom = field.bottom;
  for (const brick of state.bricks) placeBrick(state, brick);
  state.paddle.x *= sx;
  state.paddle.width *= sx;
  state.paddle.baseWidth = paddleWidth(state);
  state.paddle.y = paddleY(state);
  state.paddle.vx *= sx;
  for (const ball of state.balls) {
    ball.x = Math.max(ball.r, Math.min(state.width - ball.r, ball.x * sx));
    ball.y = ball.attached ? state.paddle.y - PADDLE_H / 2 - ball.r - 1 : Math.min(ball.y * sy, state.paddle.y + (ball.y - oldPaddleY));
    ball.vx *= sy;
    ball.vy *= sy;
  }
  for (const drop of state.drops) {
    drop.x *= sx;
    drop.y *= sy;
    drop.vy *= sy;
  }
}

export function launchBall(ball: Ball, speed = 340, aim = 0.18) {
  if (!ball.attached) return;
  ball.attached = false;
  const angle = Math.max(-0.9, Math.min(0.9, aim));
  ball.vx = speed * Math.sin(angle);
  ball.vy = -speed * Math.cos(angle);
}

/** Launches the waiting ball, aimed a little toward where the paddle is heading. Returns false when no ball is waiting. */
export function serve(state: BreakoutState, rng: () => number = Math.random) {
  const ball = state.balls.find((b) => b.attached);
  if (!ball || state.levelBanner > 0 || state.ended) return false;
  const lean = Math.max(-1, Math.min(1, state.paddle.vx / (state.width * 0.8)));
  const aim = (lean !== 0 ? lean * 0.45 : 0) + (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.16);
  state.rally = 0;
  launchBall(ball, ballSpeed(state), aim);
  state.effects.push({ type: 'launch', x: ball.x, y: ball.y });
  return true;
}

export function paddleBounce(ball: Ball, paddle: BreakoutState['paddle']) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.width / 2)));
  const angle = offset * (Math.PI / 3);
  ball.vx = speed * Math.sin(angle);
  ball.vy = -speed * Math.cos(angle);
  ball.y = paddle.y - paddle.height / 2 - ball.r - 0.1;
  return angle;
}

export function reflectBallAtWalls(ball: Ball, width: number) {
  let hit = false;
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    ball.vx = Math.abs(ball.vx);
    hit = true;
  } else if (ball.x + ball.r > width) {
    ball.x = width - ball.r;
    ball.vx = -Math.abs(ball.vx);
    hit = true;
  }
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy);
    hit = true;
  }
  return hit;
}

export function chainBonus(chain: number) {
  return Math.min(30, Math.max(0, chain - 1) * 5);
}

export function damageBrick(state: BreakoutState, brick: Brick, rng: () => number = Math.random) {
  brick.hp--;
  let points = 5;
  const broke = brick.hp <= 0;
  if (broke) {
    state.chain++;
    points += 10 + chainBonus(state.chain);
    const index = state.bricks.indexOf(brick);
    if (index >= 0) state.bricks.splice(index, 1);
    // Rarer once three balls are already in play.
    const chance = state.balls.length > 2 ? 0.07 : 0.12;
    if (rng() < chance) state.drops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, vy: state.height * 0.17, kind: (['wide', 'multi', 'slow'] as const)[Math.floor(rng() * 3)] });
  }
  state.score += points;
  state.effects.push({ type: 'brick', x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, broke, row: brick.row, maxHp: brick.maxHp, chain: state.chain, points, w: brick.w, h: brick.h });
  return broke;
}

export function applyPowerup(state: BreakoutState, kind: PowerKind) {
  if (kind === 'wide') state.wideUntil = Math.max(state.wideUntil, state.time) + 12;
  if (kind === 'slow') {
    state.slowActive = true;
    state.slowUntil = Math.max(state.slowUntil, state.time) + 10;
  }
  if (kind === 'multi') {
    const source = state.balls.find((ball) => !ball.attached);
    if (source && state.balls.length < 9) {
      const speed = Math.hypot(source.vx, source.vy);
      const angle = Math.atan2(source.vy, source.vx);
      for (const delta of [-0.4, 0.4]) {
        const next = angle + delta;
        // Keep the copies from leaving almost flat, which would leave them bouncing wall to wall.
        const vy = Math.sin(next) * speed;
        const vx = Math.cos(next) * speed;
        const minVy = speed * 0.35;
        const fixedVy = Math.abs(vy) < minVy ? Math.sign(vy || -1) * minVy : vy;
        const fixedVx = Math.sign(vx) * Math.sqrt(Math.max(0, speed * speed - fixedVy * fixedVy));
        state.balls.push({ ...source, vx: fixedVx, vy: fixedVy, attached: false });
      }
    }
  }
  state.effects.push({ type: 'power', x: state.paddle.x, y: state.paddle.y, value: kind });
}

function collideBrick(ball: Ball, brick: Brick) {
  const cx = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
  const cy = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  if (dx * dx + dy * dy > ball.r * ball.r) return false;
  // Push back out along the shallower overlap and bounce off that face.
  const overlapX = Math.min(ball.x + ball.r - brick.x, brick.x + brick.w - (ball.x - ball.r));
  const overlapY = Math.min(ball.y + ball.r - brick.y, brick.y + brick.h - (ball.y - ball.r));
  if (overlapX < overlapY) {
    if (ball.x < brick.x + brick.w / 2) {
      ball.x = brick.x - ball.r;
      ball.vx = -Math.abs(ball.vx);
    } else {
      ball.x = brick.x + brick.w + ball.r;
      ball.vx = Math.abs(ball.vx);
    }
  } else if (ball.y < brick.y + brick.h / 2) {
    ball.y = brick.y - ball.r;
    ball.vy = -Math.abs(ball.vy);
  } else {
    ball.y = brick.y + brick.h + ball.r;
    ball.vy = Math.abs(ball.vy);
  }
  return true;
}

function startLevel(state: BreakoutState, level: number) {
  state.level = level;
  state.bricks = bricksForLevel(state, level);
  state.paddle.baseWidth = paddleWidth(state);
  state.paddle.width = state.paddle.baseWidth;
  state.balls = [makeBall(state.paddle)];
  state.drops = [];
  state.wideUntil = 0;
  state.slowUntil = 0;
  state.slowActive = false;
  state.rally = 0;
  state.chain = 0;
  state.levelStart = state.time;
}

export function stepBreakout(state: BreakoutState, dt: number, axis = 0, pointerX: number | null = null, rng: () => number = Math.random) {
  if (state.ended) return;
  state.time += dt;
  state.effects = [];
  if (state.slowActive && state.time >= state.slowUntil) state.slowActive = false;
  if (state.levelBanner > 0) {
    state.levelBanner -= dt;
    if (state.levelBanner <= 0) startLevel(state, state.level + 1);
    return;
  }
  const paddle = state.paddle;
  const targetWidth = state.time < state.wideUntil ? paddle.baseWidth * 1.55 : paddle.baseWidth;
  paddle.width += (targetWidth - paddle.width) * Math.min(1, dt * 6);
  const maxSpeed = state.width * 1.5;
  const prevX = paddle.x;
  if (pointerX !== null) {
    paddle.x += (pointerX - paddle.x) * Math.min(1, dt * 22);
  } else if (axis) {
    // Turning around is instant; holding builds to full speed quickly.
    if (Math.sign(paddle.vx) !== axis) paddle.vx = axis * maxSpeed * 0.35;
    paddle.vx = Math.max(-maxSpeed, Math.min(maxSpeed, paddle.vx + axis * maxSpeed * 6 * dt));
    paddle.x += paddle.vx * dt;
  } else {
    paddle.vx *= Math.exp(-18 * dt);
    paddle.x += paddle.vx * dt;
  }
  const minX = paddle.width / 2 + 4;
  const maxX = state.width - paddle.width / 2 - 4;
  paddle.x = Math.max(minX, Math.min(maxX, paddle.x));
  if (pointerX !== null) paddle.vx = dt > 0 ? (paddle.x - prevX) / dt : 0;
  else if (paddle.x === minX || paddle.x === maxX) paddle.vx = 0;
  for (const ball of state.balls) {
    if (ball.attached) {
      ball.x = paddle.x;
      ball.y = paddle.y - paddle.height / 2 - ball.r - 1;
    }
  }
  for (const drop of state.drops) {
    drop.y += drop.vy * dt;
    if (Math.abs(drop.y - paddle.y) <= paddle.height / 2 + 9 && Math.abs(drop.x - paddle.x) <= paddle.width / 2 + 12) {
      applyPowerup(state, drop.kind);
      drop.y = state.height + 100;
    }
  }
  state.drops = state.drops.filter((drop) => drop.y < state.height + 20);

  const factor = state.slowActive ? SLOW : 1;
  for (const ball of state.balls) {
    if (ball.attached) continue;
    const dx = ball.vx * dt * factor;
    const dy = ball.vy * dt * factor;
    const travel = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(travel / Math.max(2, ball.r * 0.45)));
    for (let i = 0; i < steps; i++) {
      const py = ball.y;
      ball.x += dx / steps;
      ball.y += dy / steps;
      if (reflectBallAtWalls(ball, state.width)) state.effects.push({ type: 'wall', x: ball.x, y: ball.y });
      if (ball.y - ball.r > state.height) break;
      const top = paddle.y - paddle.height / 2;
      if (ball.vy > 0 && py + ball.r <= top + 1 && ball.y + ball.r >= top && Math.abs(ball.x - paddle.x) <= paddle.width / 2 + ball.r) {
        state.rally++;
        state.chain = 0;
        const speed = ballSpeed(state);
        paddleBounce(ball, paddle);
        // A moving paddle puts a little english on the ball.
        const english = Math.max(-0.18, Math.min(0.18, (paddle.vx / maxSpeed) * 0.22));
        const angle = Math.max(-1.1, Math.min(1.1, Math.atan2(ball.vx, -ball.vy) + english));
        ball.vx = speed * Math.sin(angle);
        ball.vy = -speed * Math.cos(angle);
        state.effects.push({ type: 'paddle', x: ball.x, y: ball.y });
        continue;
      }
      const brick = state.bricks.find((b) => collideBrick(ball, b));
      if (brick) {
        damageBrick(state, brick, rng);
        break;
      }
    }
  }
  state.balls = state.balls.filter((ball) => ball.y - ball.r <= state.height);
  if (!state.balls.length) {
    state.lives--;
    state.chain = 0;
    state.effects.push({ type: 'life', x: paddle.x, y: state.height - 10 });
    if (state.lives <= 0) {
      state.ended = true;
      return;
    }
    state.wideUntil = Math.min(state.wideUntil, state.time);
    state.slowActive = false;
    state.slowUntil = 0;
    state.drops = [];
    state.balls = [makeBall(paddle)];
  }
  if (!state.bricks.length && state.levelBanner <= 0) {
    state.levelBanner = 1.6;
    state.score += 100;
    state.effects.push({ type: 'clear', x: state.width / 2, y: state.height / 2 });
  }
}

export function isLevelClear(state: Pick<BreakoutState, 'bricks'>) {
  return state.bricks.length === 0;
}
