import { COURT_LENGTH, DOUBLES_WIDTH, SINGLES_WIDTH, STEP, STRIKE_RADIUS, clamp, shouldSmash, timingQuality, updateBall, type Command, type Event, type Player, type Swing, type World } from './logic.ts';

export type CourtTarget = { x: number; z: number };

const predictionCache = new WeakMap<World, { bucket: number; target: CourtTarget }>();

function predictedIntercept(world: World, player: Player): CourtTarget {
  const bucket = Math.floor(world.clock * 20);
  const cached = predictionCache.get(world);
  if (cached?.bucket === bucket) return cached.target;
  const sim = {
    ...world,
    players: world.players.map((entry) => ({ ...entry, input: { ...entry.input }, pending: entry.pending && { ...entry.pending } })),
    match: structuredClone(world.match),
    ball: {
      ...world.ball,
      p: { ...world.ball.p },
      prev: { ...world.ball.prev },
      v: { ...world.ball.v },
      spin: { ...world.ball.spin },
    },
    random: world.random,
  } as World;
  const delay = player.ai === 0 ? 0.32 : player.ai === 2 ? 0.05 : 0.15;
  const speed = player.ai === 0 ? 4.6 : player.ai === 1 ? 6.2 : 6.6;
  let target = { x: player.x, z: player.z };
  const events: Event[] = [];
  for (let elapsed = 0; elapsed <= 1.6; elapsed += STEP) {
    updateBall(sim, events);
    if (sim.phase !== 'rally' && sim.phase !== 'serve-flight') break;
    const ball = sim.ball;
    if (ball.bounces > 0 && ball.p.y >= 0.5 && ball.p.y <= 2.7 && (player.team === 0 ? ball.p.z > 0 : ball.p.z < 0)) {
      const distance = Math.hypot(ball.p.x - player.x, ball.p.z - player.z);
      if (distance <= speed * Math.max(0, elapsed - delay) + STRIKE_RADIUS) {
        target = { x: ball.p.x, z: ball.p.z };
        break;
      }
    }
    target = { x: ball.p.x, z: ball.p.z };
  }
  predictionCache.set(world, { bucket, target });
  return target;
}

export function movementTarget(world: World, player: Player): CourtTarget {
  const { ball } = world;
  const receiving = (world.phase === 'rally' || world.phase === 'serve-flight') && ball.inPlay && player.team === ball.canHitTeam;
  if (receiving) {
    const partner = world.players
      .filter((other) => other.team === player.team && other.seat !== player.seat)
      .sort((a, b) => Math.hypot(a.x - ball.p.x, a.z - ball.p.z) - Math.hypot(b.x - ball.p.x, b.z - ball.p.z))[0];
    const me = Math.hypot(player.x - ball.p.x, player.z - ball.p.z);
    const them = partner ? Math.hypot(partner.x - ball.p.x, partner.z - ball.p.z) : Infinity;
    if (me > them + 0.7) {
      return {
        x: player.team === 0 ? (player.seat === 0 ? -2.2 : 2.2) : (player.seat === 1 ? -2.2 : 2.2),
        z: player.team === 0 ? 6.9 : -6.9,
      };
    }
    return predictedIntercept(world, player);
  }
  if (world.format === 'doubles') {
    const netPlayer = player.seat % 2 === 0;
    const x = player.team === 0 ? (netPlayer ? -2.55 : 2.55) : (netPlayer ? 2.55 : -2.55);
    return { x, z: player.team === 0 ? (netPlayer ? 1.1 : 7.7) : (netPlayer ? -1.1 : -7.7) };
  }
  return { x: 0, z: player.team === 0 ? 9.7 : -9.7 };
}

export function chooseShot(world: World, player: Player): Swing {
  const level = player.ai ?? 1;
  const timing = level === 0 ? (world.random() - 0.5) * 0.34
    : level === 1 ? (world.random() - 0.5) * 0.38
      : (world.random() - 0.5) * 0.36;
  let kind: Swing['kind'] = 'topspin';
  let depth: Swing['depth'];
  const humans = world.players.filter((other) => other.team !== player.team && other.ai === null);
  const humanAtNet = humans.some((human) => Math.abs(human.z) < 6);
  if (level === 0 && world.random() < 0.18) kind = 'slice';
  if (level > 0) {
    if (shouldSmash(world.ball.p.y)) kind = 'smash';
    else {
      const variety = world.random();
      const lobChance = level === 1 ? 0.28 : 0.4;
      const selection = humanAtNet && variety >= lobChance ? (variety - lobChance) / (1 - lobChance) : variety;
      if (humanAtNet && variety < lobChance) kind = 'lob';
      else if (selection < (level === 1 ? 0.13 : 0.18)) {
        kind = 'drop';
        depth = 1;
      } else if (selection < (level === 1 ? 0.31 : 0.42)) {
        kind = 'slice';
        depth = -1;
      } else if (selection < (level === 1 ? 0.47 : 0.6)) kind = 'flat';
    }
  }
  const aim: Swing['aim'] = level === 0 ? 0 : (() => {
    const width = (world.format === 'singles' ? SINGLES_WIDTH : DOUBLES_WIDTH) / 2;
    const opponents = world.players.filter((other) => other.team !== player.team);
    const timingOffset = timingQuality(timing).direction * 2.1;
    const openness = (direction: -1 | 1) => {
      const targetX = clamp(timingOffset + direction * 1.6, -width + 0.48, width - 0.48);
      const clearance = opponents.length
        ? Math.min(...opponents.map((opponent) => Math.abs(targetX - opponent.x)))
        : Math.abs(targetX - world.ball.p.x);
      return clearance + Math.abs(targetX) * (level === 2 ? 0.16 : 0.06);
    };
    const left = openness(-1);
    const right = openness(1);
    if (level === 1 && world.random() < 0.28) return 0;
    if (Math.abs(left - right) < 0.22) return world.random() < 0.5 ? -1 : 1;
    return left > right ? -1 : 1;
  })();
  if (level === 2 && world.format === 'doubles' && Math.abs(player.z) < COURT_LENGTH / 2 - 4) kind = 'topspin';
  return { kind, aim, delta: timing, depth };
}

export function cpuSwing(world: World, player: Player): Command | null {
  const ball = world.ball;
  if (player.ai === null || !player.connected || player.swing > 0 || (world.phase !== 'rally' && world.phase !== 'serve-flight') || !ball.inPlay || player.team !== ball.canHitTeam) return null;
  const reach = STRIKE_RADIUS + (player.ai === 1 ? 0.25 : 0);
  if (Math.hypot(ball.p.x - player.x, ball.p.z - player.z) > reach || ball.p.y < 0.15 || ball.p.y > 2.9) return null;
  return { seat: player.seat, swing: chooseShot(world, player) };
}
