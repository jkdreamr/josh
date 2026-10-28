import { FIELD } from './field.ts';
import { offsideLine } from './rules.ts';
import { distance, nearestCarrier, possessionTeam, teamDir, type Command, type Player, type Point, type Team, type World } from './logic.ts';

export type RunCall = {
  playerId: number;
  until: number; // Remaining sim seconds; decremented by step t, not match clock.
  target: Point;
  struck: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function runnerOrigin(world: World, team: Team): Player | undefined {
  const carrier = nearestCarrier(world);
  return carrier?.team === team ? carrier : world.players.find((player) => player.id === world.controlled[team] && player.team === team);
}

function candidatesFor(world: World, team: Team): Player[] {
  const carrier = nearestCarrier(world);
  return world.players.filter((player) => player.team === team && player.slot !== 'GK'
    && player.id !== carrier?.id && !player.sentOff && !player.human);
}

function advancedFirst(players: Player[], team: Team, world: World) {
  const direction = teamDir(team, world.endsSwapped);
  return [...players].sort((a, b) => b.x * direction - a.x * direction || a.id - b.id)[0];
}

export function pickRunner(world: World, team: Team, stick: Point): Player | undefined {
  const candidates = candidatesFor(world, team);
  if (!candidates.length) return undefined;
  const stickLength = Math.hypot(stick.x, stick.z);
  const origin = runnerOrigin(world, team);
  if (stickLength >= 0.3 && origin) {
    const cone = candidates.map((player) => {
      const dx = player.x - origin.x;
      const dz = player.z - origin.z;
      const length = Math.hypot(dx, dz);
      const angle = Math.acos(clamp((dx * stick.x + dz * stick.z) / (length * stickLength || 1), -1, 1));
      return { player, angle };
    }).filter(({ angle }) => angle <= Math.PI / 4)
      .sort((a, b) => a.angle - b.angle || b.player.x * teamDir(team, world.endsSwapped) - a.player.x * teamDir(team, world.endsSwapped)
        || a.player.id - b.player.id);
    if (cone.length) return cone[0]!.player;
  }
  const forwards = candidates.filter((player) => player.slot === 'ST' || player.slot === 'LW' || player.slot === 'RW');
  return advancedFirst(forwards.length ? forwards : candidates, team, world);
}

function runTarget(world: World, team: Team, runner: Player): Point {
  const direction = teamDir(team, world.endsSwapped);
  const opponent = world.players.filter((player) => player.team !== team && player.slot !== 'GK' && !player.sentOff)
    .sort((a, b) => distance(a, runner) - distance(b, runner) || a.id - b.id)[0];
  const away = opponent && runner.z < opponent.z ? -1 : 1;
  return {
    x: clamp(runner.x + 15 * direction, -FIELD.length / 2 + 1, FIELD.length / 2 - 1),
    z: clamp(runner.z + away * 3.5, -FIELD.width / 2 + 1, FIELD.width / 2 - 1),
  };
}

export function callRun(world: World, team: Team, stick: Point): boolean {
  if (world.phase !== 'live' || possessionTeam(world) !== team) return false;
  const runner = pickRunner(world, team, stick);
  if (!runner) return false;
  world.runCall = { playerId: runner.id, until: 3, target: runTarget(world, team, runner), struck: false };
  return true;
}

export function runCallCommands(world: World, commands: Map<number, Command>, t: number): Map<number, Command> {
  const result = new Map(commands);
  for (const [playerId, command] of commands) {
    const player = world.players.find((candidate) => candidate.id === playerId);
    if (player?.human && command.callRun) callRun(world, player.team, command.move ?? command.aim ?? { x: 0, z: 0 });
  }
  const run = world.runCall;
  if (!run) return result;
  const runner = world.players.find((player) => player.id === run.playerId);
  const carrier = nearestCarrier(world);
  const team = runner?.team;
  run.until -= t;
  if (run.until <= 0 || !runner || runner.sentOff || runner.human || carrier?.id === runner.id
    || team === undefined || possessionTeam(world) !== null && possessionTeam(world) !== team) {
    world.runCall = null;
    return result;
  }
  if (!run.struck && (world.passTarget != null || !carrier && world.lastTouch === team
    && Math.hypot(world.ball.vx, world.ball.vz) > 3)) {
    run.struck = true;
    run.until = Math.max(run.until, 1.5);
  }
  if (world.passTarget === runner.id) return result;
  const direction = teamDir(team, world.endsSwapped);
  const holdProgress = Math.min(run.target.x * direction, offsideLine(world, team) - 0.6);
  const holdPoint = run.struck ? run.target : { ...run.target, x: holdProgress * direction };
  const dx = holdPoint.x - runner.x;
  const dz = holdPoint.z - runner.z;
  const gap = Math.hypot(dx, dz);
  result.set(runner.id, { ...result.get(runner.id), move: gap <= 0.4 ? { x: 0, z: 0 } : { x: dx / gap, z: dz / gap }, sprint: true });
  return result;
}
