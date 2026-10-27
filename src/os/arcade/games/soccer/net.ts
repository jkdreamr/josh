import type { Command, World } from './logic.ts';

export type MovePacket = { t: 'soccer'; k: 'mv'; r: number; seq: number; seat: number; x: number; z: number; ax: number; az: number; power: number; buttons: number };
export type SnapshotPacket = { t: 'soccer'; k: 's'; r: number; seq: number; state: World };
export type ConfigPacket = { t: 'soccer'; k: 'cfg'; r: number; seq: number; half: 2 | 3 | 4 | 6; level: 0 | 1 | 2 };
export type SoccerPacket = MovePacket | SnapshotPacket | ConfigPacket;
const finite = (v: unknown, abs: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= abs;
const quantized = (v: unknown) => finite(v, 1) && Math.abs((v as number) * 100 - Math.round((v as number) * 100)) < 1e-6;
const inRange = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function validWorld(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const w = value as Partial<World>;
  const slots = ['GK', 'DEF', 'LM', 'RM', 'FWD'];
  const phases = ['live', 'restart', 'goal', 'half-time', 'full-time'];
  const restarts = ['kickoff', 'kick-in', 'corner', 'goal-kick', 'free-kick', 'penalty', null];
  const ball = w.ball;
  if (!Array.isArray(w.players) || w.players.length !== 10 || !w.players.every((p, i) => p && p.id === i
    && p.team === (i < 5 ? 0 : 1) && slots.includes(p.slot) && inRange(p.x, -25, 25) && inRange(p.z, -15, 15)
    && inRange(p.vx, -10, 10) && inRange(p.vz, -10, 10) && inRange(p.facing, -Math.PI * 2, Math.PI * 2)
    && inRange(p.stamina, 0, 1) && typeof p.human === 'boolean' && typeof p.controlled === 'boolean'
    && inRange(p.cooldown, 0, 30) && typeof p.action === 'string' && p.action.length <= 24)) return false;
  if (!ball || !inRange(ball.x, -80, 80) || !inRange(ball.y, 0, 40) || !inRange(ball.z, -60, 60)
    || !inRange(ball.vx, -100, 100) || !inRange(ball.vy, -100, 100) || !inRange(ball.vz, -100, 100)
    || !inRange(ball.spin, -1000, 1000) || typeof ball.grounded !== 'boolean' || typeof ball.inNet !== 'boolean') return false;
  if (!Array.isArray(w.score) || w.score.length !== 2 || !w.score.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)
    || !inRange(w.clock, 0, 360) || !inRange(w.halfLength, 1, 360) || (w.half !== 1 && w.half !== 2)
    || typeof w.endsSwapped !== 'boolean' || !phases.includes(w.phase ?? '') || !restarts.includes(w.restart ?? null)
    || (w.restartTeam !== 0 && w.restartTeam !== 1) || !w.restartAt || !inRange(w.restartAt.x, -21, 21) || !inRange(w.restartAt.z, -13, 13)
    || (w.lastTouch !== 0 && w.lastTouch !== 1) || !Number.isSafeInteger(w.seed) || !inRange(w.eventTime, 0, 30)
    || !inRange(w.restartClock, 0, 360) || typeof w.event !== 'string' || w.event.length > 80
    || !Array.isArray(w.controlled) || w.controlled.length !== 2 || !w.controlled.every((id) => Number.isInteger(id) && id >= 0 && id < 10)) return false;
  const kickEvent = w.kickEvent;
  if (kickEvent !== null && (!kickEvent || !Number.isInteger(kickEvent.playerId) || kickEvent.playerId < 0 || kickEvent.playerId >= 10
    || !slots.includes(w.players[kickEvent.playerId]?.slot ?? '') || typeof kickEvent.action !== 'string'
    || kickEvent.action.length > 24 || !inRange(kickEvent.power, 0, 1) || !inRange(kickEvent.time, 0, 360))) return false;
  return true;
}

export function movePacket(round: number, seq: number, seat: number, command: Command): MovePacket {
  const aimLength = Math.hypot(command.aim?.x ?? 1, command.aim?.z ?? 0) || 1;
  const buttons = (command.action === 'pass' ? 1 : 0)
    | (command.action === 'shoot' ? 2 : 0)
    | (command.action === 'through' ? 4 : 0)
    | (command.action === 'lob' ? 8 : 0)
    | (command.action === 'tackle' ? 16 : 0)
    | (command.action === 'slide' ? 32 : 0)
    | (command.press ? 128 : 0)
    | (command.action === 'finesse' ? 256 : 0)
    | (command.action === 'skill' ? 512 : 0);
  return {
    t: 'soccer', k: 'mv', r: round, seq, seat,
    x: Math.round(command.move.x * 100) / 100, z: Math.round(command.move.z * 100) / 100,
    ax: Math.round((command.aim?.x ?? 1) / aimLength * 100) / 100,
    az: Math.round((command.aim?.z ?? 0) / aimLength * 100) / 100,
    power: Math.round(Math.max(0, Math.min(1, command.power ?? 0.72)) * 100) / 100,
    buttons: buttons | (command.sprint ? 64 : 0),
  };
}

export function parsePacket(value: unknown): SoccerPacket | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'soccer' || !Number.isSafeInteger(p.r) || (p.r as number) < 0 || !Number.isSafeInteger(p.seq) || (p.seq as number) < 0) return null;
  if (p.k === 'cfg') {
    if (![2, 3, 4, 6].includes(p.half as number) || ![0, 1, 2].includes(p.level as number)) return null;
    return { t: 'soccer', k: 'cfg', r: p.r as number, seq: p.seq as number, half: p.half as ConfigPacket['half'], level: p.level as ConfigPacket['level'] };
  }
  if (p.k === 'mv') {
    if (!Number.isInteger(p.seat) || (p.seat as number) < 0 || (p.seat as number) > 3 || !quantized(p.x) || !quantized(p.z)
      || !quantized(p.ax) || !quantized(p.az) || !inRange(p.power, 0, 1)
      || !Number.isInteger(p.buttons) || (p.buttons as number) < 0 || ((p.buttons as number) & ~1023) !== 0) return null;
    return { t: 'soccer', k: 'mv', r: p.r as number, seq: p.seq as number, seat: p.seat as number, x: p.x as number, z: p.z as number, ax: p.ax as number, az: p.az as number, power: p.power as number, buttons: p.buttons as number };
  }
  if (p.k === 's' && validWorld(p.state)) {
    return { t: 'soccer', k: 's', r: p.r as number, seq: p.seq as number, state: structuredClone(p.state) };
  }
  return null;
}

export function commandFromPacket(packet: MovePacket): Command {
  const buttons = packet.buttons;
  const action = buttons & 256 ? 'finesse' : buttons & 512 ? 'skill' : buttons & 2 ? 'shoot' : buttons & 1 ? 'pass' : buttons & 4 ? 'through' : buttons & 8 ? 'lob' : buttons & 32 ? 'slide' : buttons & 16 ? 'tackle' : null;
  return { move: { x: packet.x, z: packet.z }, sprint: !!(buttons & 64), action, press: !!(buttons & 128), pressed: !!action, power: packet.power, aim: { x: packet.ax, z: packet.az } };
}

export function cloneSnapshot(world: World) {
  return JSON.parse(JSON.stringify(world)) as Omit<World, 'seed'> & { seed: number };
}
