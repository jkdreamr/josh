import { BALL_RADIUS, type Command, type Player, type Swing, type World } from './logic.ts';

export type CourtTarget = { x: number; z: number };

export function movementTarget(world: World, player: Player): CourtTarget {
  const { ball } = world;
  const receiving = world.phase === 'rally' && ball.inPlay && player.team === ball.canHitTeam;
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
    const level = player.ai ?? 1;
    const reaction = level === 0 ? 0.62 : level === 2 ? 1 : 0.82;
    const lead = Math.max(0.04, Math.min(0.46, Math.abs(ball.p.y - 0.7) / 12 * reaction));
    return {
      x: ball.p.x + ball.v.x * lead,
      z: ball.p.z + ball.v.z * lead,
    };
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
  const timing = level === 0 ? (world.random() - 0.5) * 0.48
    : level === 1 ? (world.random() - 0.5) * 0.4
      : (world.random() - 0.5) * 0.36;
  let kind: Swing['kind'] = 'drive';
  if (level === 0 && world.random() < 0.18) kind = 'slice';
  if (level === 2 && world.random() < 0.16 && world.ball.p.y < 0.8) kind = 'lob';
  const aim = (world.random() < 0.5 ? -1 : 1) as -1 | 1;
  return { kind, aim, delta: timing };
}

export function cpuSwing(world: World, player: Player): Command | null {
  const ball = world.ball;
  if (player.ai === null || !player.connected || player.swing > 0 || world.phase !== 'rally' || !ball.inPlay || player.team !== ball.canHitTeam) return null;
  const distance = Math.hypot(player.x - ball.p.x, player.z - ball.p.z);
  if (distance > 2.1 || ball.p.y < BALL_RADIUS + 0.06 || ball.p.y > 2.5) return null;
  return { seat: player.seat, swing: chooseShot(world, player) };
}
