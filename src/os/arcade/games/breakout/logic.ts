export type Brick = { x: number; y: number; w: number; h: number; hp: number; row: number };
export type Ball = { x: number; y: number; vx: number; vy: number; r: number; attached: boolean };
export type PowerKind = 'wide' | 'multi' | 'slow';
export type Drop = { x: number; y: number; kind: PowerKind; vy: number };
export type BreakoutState = {
  width: number;
  height: number;
  paddle: { x: number; y: number; width: number; baseWidth: number; height: number; vx: number };
  balls: Ball[];
  bricks: Brick[];
  drops: Drop[];
  score: number;
  lives: number;
  level: number;
  time: number;
  wideUntil: number;
  slowUntil: number;
  slowActive: boolean;
  levelBanner: number;
  ended: boolean;
  effects: { type: 'brick' | 'paddle' | 'life' | 'power' | 'clear'; x: number; y: number; value?: PowerKind }[];
};

const layouts = [
  ['01111111110', '11222222211', '01111111110', '00111111100', '00011111000'],
  ['11000000011', '01100000110', '00112211000', '00111111000', '01111111110', '11001100110'],
  ['00011111000', '00121112100', '01211111210', '11111111111', '00121112100', '00011111000'],
  ['11100100111', '22111111122', '00111111100', '11011111011', '11100100111'],
];

function bricksForLevel(level: number) {
  const layout = layouts[(level - 1) % layouts.length];
  const bricks: Brick[] = [];
  for (let row = 0; row < layout.length; row++) {
    for (let col = 0; col < layout[row].length; col++) {
      const hp = Number(layout[row][col]);
      if (!hp) continue;
      bricks.push({ x: 25 + col * 41, y: 82 + row * 34, w: 35, h: 23, hp, row });
    }
  }
  return bricks;
}

function makeBall(paddle: BreakoutState['paddle']): Ball {
  return { x: paddle.x, y: paddle.y - 12, vx: 0, vy: 0, r: 7, attached: true };
}

export function createBreakout(level = 1): BreakoutState {
  const paddle = { x: 250, y: 654, width: 96, baseWidth: 96, height: 13, vx: 0 };
  return {
    width: 500,
    height: 700,
    paddle,
    balls: [makeBall(paddle)],
    bricks: bricksForLevel(level),
    drops: [],
    score: 0,
    lives: 3,
    level,
    time: 0,
    wideUntil: 0,
    slowUntil: 0,
    slowActive: false,
    levelBanner: 0,
    ended: false,
    effects: [],
  };
}

export function launchBall(ball: Ball, speed = 340) {
  if (!ball.attached) return;
  ball.attached = false;
  ball.vx = speed * 0.18;
  ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
}

export function paddleBounce(ball: Ball, paddle: BreakoutState['paddle']) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.width / 2)));
  const angle = offset * (Math.PI / 3);
  ball.vx = speed * Math.sin(angle);
  ball.vy = -speed * Math.cos(angle);
  ball.y = paddle.y - ball.r - 0.1;
  return angle;
}

export function reflectBallAtWalls(ball: Ball, width: number) {
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + ball.r > width) {
    ball.x = width - ball.r;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy);
  }
  return ball;
}

export function damageBrick(state: BreakoutState, brick: Brick, rng: () => number = Math.random) {
  brick.hp--;
  state.score += 5;
  state.effects.push({ type: 'brick', x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 });
  if (brick.hp > 0) return false;
  state.score += 10;
  const index = state.bricks.indexOf(brick);
  if (index >= 0) state.bricks.splice(index, 1);
  if (rng() < 0.12) state.drops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, vy: 92, kind: (['wide', 'multi', 'slow'] as const)[Math.floor(rng() * 3)] });
  return true;
}

export function applyPowerup(state: BreakoutState, kind: PowerKind) {
  if (kind === 'wide') state.wideUntil = Math.max(state.wideUntil, state.time) + 12;
  if (kind === 'slow' && !state.slowActive) {
    for (const ball of state.balls) {
      if (!ball.attached) {
        ball.vx *= 0.7;
        ball.vy *= 0.7;
      }
    }
    state.slowActive = true;
  }
  if (kind === 'slow') state.slowUntil = Math.max(state.slowUntil, state.time) + 10;
  if (kind === 'multi') {
    const source = state.balls.find((ball) => !ball.attached);
    if (source) {
      const speed = Math.hypot(source.vx, source.vy);
      const angle = Math.atan2(source.vy, source.vx);
      for (const delta of [-0.32, 0.32]) {
        const nextAngle = angle + delta;
        state.balls.push({ ...source, vx: Math.cos(nextAngle) * speed, vy: Math.sin(nextAngle) * speed, attached: false });
      }
    }
  }
  state.effects.push({ type: 'power', x: state.paddle.x, y: state.paddle.y, value: kind });
}

export function stepBreakout(state: BreakoutState, dt: number, axis = 0, pointerX: number | null = null, rng: () => number = Math.random) {
  if (state.ended) return;
  state.time += dt;
  state.effects = [];
  if (state.slowActive && state.time >= state.slowUntil) {
    for (const ball of state.balls) {
      if (!ball.attached) {
        ball.vx /= 0.7;
        ball.vy /= 0.7;
      }
    }
    state.slowActive = false;
  }
  if (state.levelBanner > 0) {
    state.levelBanner -= dt;
    if (state.levelBanner <= 0) {
      const next = createBreakout(state.level + 1);
      state.level = next.level;
      state.bricks = next.bricks;
      state.paddle.width = state.paddle.baseWidth;
      state.balls = [makeBall(state.paddle)];
      state.drops = [];
    }
    return;
  }
  const targetWidth = state.time < state.wideUntil ? state.paddle.baseWidth * 1.55 : state.paddle.baseWidth;
  state.paddle.width += (targetWidth - state.paddle.width) * Math.min(1, dt * 5);
  if (axis) {
    state.paddle.vx += axis * 1900 * dt;
    state.paddle.vx = Math.max(-620, Math.min(620, state.paddle.vx));
  } else state.paddle.vx *= Math.exp(-8 * dt);
  if (pointerX !== null) {
    state.paddle.x += (pointerX - state.paddle.x) * Math.min(1, dt * 16);
    state.paddle.vx = 0;
  } else state.paddle.x += state.paddle.vx * dt;
  state.paddle.x = Math.max(state.paddle.width / 2 + 8, Math.min(state.width - state.paddle.width / 2 - 8, state.paddle.x));
  for (const ball of state.balls) {
    if (ball.attached) {
      ball.x = state.paddle.x;
      ball.y = state.paddle.y - ball.r - 1;
    }
  }
  for (const drop of state.drops) {
    drop.y += drop.vy * dt;
    if (drop.y >= state.paddle.y - state.paddle.height && drop.y <= state.paddle.y + state.paddle.height && Math.abs(drop.x - state.paddle.x) <= state.paddle.width / 2 + 10) {
      applyPowerup(state, drop.kind);
      drop.y = state.height + 100;
    }
  }
  state.drops = state.drops.filter((drop) => drop.y < state.height + 20);

  for (const ball of state.balls) {
    if (ball.attached) continue;
    const dx = ball.vx * dt;
    const dy = ball.vy * dt;
    const travel = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(travel / Math.max(2, ball.r * 0.45)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      const py = ball.y;
      ball.x += sx;
      ball.y += sy;
      reflectBallAtWalls(ball, state.width);
      if (ball.y - ball.r > state.height) break;
      if (ball.vy > 0 && py + ball.r <= state.paddle.y && ball.y + ball.r >= state.paddle.y && Math.abs(ball.x - state.paddle.x) <= state.paddle.width / 2 + ball.r) {
        paddleBounce(ball, state.paddle);
        const speed = Math.min(500, Math.hypot(ball.vx, ball.vy) * 1.008);
        const angle = Math.atan2(ball.vx, -ball.vy);
        ball.vx = speed * Math.sin(angle);
        ball.vy = -speed * Math.cos(angle);
        state.effects.push({ type: 'paddle', x: ball.x, y: ball.y });
      }
      const brick = state.bricks.find((b) => ball.x + ball.r >= b.x && ball.x - ball.r <= b.x + b.w && ball.y + ball.r >= b.y && ball.y - ball.r <= b.y + b.h);
      if (brick) {
        if (py + ball.r <= brick.y || py - ball.r >= brick.y + brick.h) ball.vy *= -1;
        else ball.vx *= -1;
        damageBrick(state, brick, rng);
        break;
      }
    }
  }
  state.balls = state.balls.filter((ball) => ball.y - ball.r <= state.height);
  if (!state.balls.length) {
    state.lives--;
    state.effects.push({ type: 'life', x: state.paddle.x, y: state.height - 40 });
    if (state.lives <= 0) {
      state.ended = true;
      return;
    }
    state.balls = [makeBall(state.paddle)];
  }
  if (!state.bricks.length && state.levelBanner <= 0) {
    state.levelBanner = 1.15;
    state.score += 100;
    state.effects.push({ type: 'clear', x: state.width / 2, y: state.height / 2 });
  }
}

export function isLevelClear(state: Pick<BreakoutState, 'bricks'>) {
  return state.bricks.length === 0;
}
