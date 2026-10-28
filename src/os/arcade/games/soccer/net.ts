import { FIELD, PLAYER_COUNT, teamOf, type World } from './logic.ts';
import type { ControlCommand } from './input.ts';
import { CLUB_IDS } from './teams.ts';
import { COMPETITIONS, COMPETITION_IDS, type CompetitionId, type Mode } from './modes.ts';
import type { CupSummary } from './cup.ts';
import { validRules } from './rules.ts';

export type MovePacket = { t: 'soccer'; k: 'mv'; r: number; seq: number; seat: number; x: number; z: number; ax: number; az: number; power: number; buttons: number; held: number; e?: number; sx?: number; sz?: number };
export type SnapshotPacket = { t: 'soccer'; k: 's'; r: number; seq: number; state: World; ack?: number[] };
export type ConfigPacket = { t: 'soccer'; k: 'cfg'; r: number; seq: number; half: 2 | 3 | 4 | 6; level: 0 | 1 | 2; displayOnly: boolean; mode?: Mode; comp?: CompetitionId; clubs?: [string, string]; offside?: boolean };
export type LobbyMember = { seat: number; role: 'host' | 'phone' | 'mac'; side: 0 | 1 };
export type LobbyPacket = { t: 'soccer'; k: 'lobby'; r: number; seq: number; comp: CompetitionId; mode: Mode; clubs: [string, string]; focus: [number, number]; ready: [boolean, boolean]; countdown: number | null; members: LobbyMember[]; cup?: CupSummary };
export type HiPacket = { t: 'soccer'; k: 'hi'; r: number; seq: number; seat: number; role: 'phone' | 'mac'; side: 0 | 1 };
export type NavPacket = { t: 'soccer'; k: 'nav'; r: number; seq: number; seat: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1; a: boolean; b: boolean };
export type PracticePickPacket = { t: 'soccer'; k: 'pd'; r: number; seq: number; seat: number; pick: string };
export type PracticeStatusPacket = { t: 'soccer'; k: 'pp'; r: number; seq: number; drill: string; prompt: string; hint: string; score: string; best: string; done: boolean; tutorial: string };
export type SoccerPacket = MovePacket | SnapshotPacket | ConfigPacket | LobbyPacket | HiPacket | NavPacket | PracticePickPacket | PracticeStatusPacket;
export type RemoteSeat = { seq: number; edge: number; held: ControlCommand['heldAction'] | null; pressUsed: boolean };
const shortText = (value: unknown, max = 160) => typeof value === 'string' && value.length <= max;
const finite = (v: unknown, abs: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= abs;
const quantized = (v: unknown) => finite(v, 1) && Math.abs((v as number) * 100 - Math.round((v as number) * 100)) < 1e-6;
const inRange = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const validClubId = (value: unknown): value is string => typeof value === 'string' && CLUB_IDS.includes(value);
const validMode = (competition: unknown, mode: unknown) => mode === 'practice'
  ? competition === undefined || COMPETITION_IDS.includes(competition as CompetitionId)
  : COMPETITIONS.some((definition) =>
    (competition === undefined || definition.id === competition) && definition.arrangements.some((arrangement) => arrangement === mode));

function validCupSummary(value: unknown): value is CupSummary {
  if (!value || typeof value !== 'object') return false;
  const cup = value as Partial<CupSummary>;
  if (!validClubId(cup.user) || ![0, 1, 2, 3].includes(cup.round as number) || typeof cup.out !== 'boolean'
    || (cup.champion !== undefined && !validClubId(cup.champion)) || !Array.isArray(cup.rounds) || cup.rounds.length !== 3) return false;
  const roundNumber = cup.round as number;
  const lengths = cup.rounds.map((round) => Array.isArray(round) ? round.length : -1);
  if (lengths[0] !== 4 || lengths[1] !== (roundNumber >= 1 && (roundNumber < 3 || lengths[1] === 2) ? 2 : 0)
    || lengths[2] !== (roundNumber >= 2 && (roundNumber < 3 || lengths[2] === 1) ? 1 : 0)) return false;
  return cup.rounds.every((round) => Array.isArray(round)
    && round.every((match) => match && validClubId(match.home) && validClubId(match.away) && match.home !== match.away
      && (match.score === undefined || Array.isArray(match.score) && match.score.length === 2 && match.score.every((n) => Number.isInteger(n) && n >= 0 && n <= 99))
      && (match.pens === undefined || Array.isArray(match.pens) && match.pens.length === 2 && match.pens.every((n) => Number.isInteger(n) && n >= 0 && n <= 99))));
}

function validWorld(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const w = value as Partial<World>;
  const slots = ['GK', 'LB', 'CB', 'RB', 'CM', 'LW', 'ST', 'RW'];
  const phases = ['live', 'restart', 'goal', 'half-time', 'full-time'];
  const restarts = ['kickoff', 'kick-in', 'corner', 'goal-kick', 'free-kick', 'penalty', null];
  const ball = w.ball;
  if (w.clubs !== undefined && (!Array.isArray(w.clubs) || w.clubs.length !== 2 || !w.clubs.every(validClubId))) return false;
  if (!Array.isArray(w.players) || w.players.length !== PLAYER_COUNT || !w.players.every((p, i) => p && p.id === i
    && p.team === teamOf(i) && slots.includes(p.slot)
    && inRange(p.x, -FIELD.length / 2 - 2, FIELD.length / 2 + 2) && inRange(p.z, -FIELD.width / 2 - 2, FIELD.width / 2 + 2)
    && inRange(p.vx, -10, 10) && inRange(p.vz, -10, 10) && inRange(p.facing, -Math.PI * 2, Math.PI * 2)
    && inRange(p.stamina, 0, 1) && typeof p.human === 'boolean' && typeof p.controlled === 'boolean'
    && (p.sentOff === undefined || typeof p.sentOff === 'boolean')
    && (p.formation === undefined || Number.isInteger(p.formation) && p.formation >= 0 && p.formation <= 10)
    && inRange(p.cooldown, 0, 30) && (p.touchCd === undefined || inRange(p.touchCd, 0, 30))
    && (p.planting === undefined || typeof p.planting === 'boolean') && typeof p.action === 'string' && p.action.length <= 24)) return false;
  if (!ball || !inRange(ball.x, -80, 80) || !inRange(ball.y, 0, 40) || !inRange(ball.z, -60, 60)
    || !inRange(ball.vx, -100, 100) || !inRange(ball.vy, -100, 100) || !inRange(ball.vz, -100, 100)
    || !inRange(ball.spin, -1000, 1000) || typeof ball.grounded !== 'boolean' || typeof ball.inNet !== 'boolean') return false;
  if (!Array.isArray(w.score) || w.score.length !== 2 || !w.score.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)
    || !inRange(w.clock, 0, 360) || !inRange(w.halfLength, 1, 360) || (w.half !== 1 && w.half !== 2)
    || typeof w.endsSwapped !== 'boolean' || !phases.includes(w.phase ?? '') || !restarts.includes(w.restart ?? null)
    || (w.restartTeam !== 0 && w.restartTeam !== 1) || !w.restartAt || !inRange(w.restartAt.x, -FIELD.length / 2, FIELD.length / 2) || !inRange(w.restartAt.z, -FIELD.width / 2, FIELD.width / 2)
    || (w.lastTouch !== 0 && w.lastTouch !== 1) || !Number.isSafeInteger(w.seed) || !inRange(w.eventTime, 0, 30)
    || !inRange(w.restartClock, 0, 360) || typeof w.event !== 'string' || w.event.length > 80
    || !Array.isArray(w.controlled) || w.controlled.length !== 2 || !w.controlled.every((id) => Number.isInteger(id) && id >= 0 && id < PLAYER_COUNT)
    || (w.passTarget !== null && w.passTarget !== undefined && (!Number.isInteger(w.passTarget) || w.passTarget < 0 || w.passTarget >= PLAYER_COUNT))
    || (w.passFrom !== null && w.passFrom !== undefined && (!Number.isInteger(w.passFrom) || w.passFrom < 0 || w.passFrom >= PLAYER_COUNT))
    || typeof w.passControl !== 'boolean'
    || (w.stealProtect !== undefined && !inRange(w.stealProtect, 0, 0.9))
    || (w.stealWinnerId !== undefined && w.stealWinnerId !== null
      && (!Number.isInteger(w.stealWinnerId) || w.stealWinnerId < 0 || w.stealWinnerId >= PLAYER_COUNT))
    || !validRules(w.rules)) return false;
  const kickEvent = w.kickEvent;
  if (w.carrierId !== undefined && w.carrierId !== null && !w.players.some((p) => p.id === w.carrierId)) return false;
  if (w.lastToucherId !== undefined && w.lastToucherId !== null && !w.players.some((p) => p.id === w.lastToucherId)) return false;
  if (w.passPoint != null && (!finite(w.passPoint.x, 150) || !finite(w.passPoint.z, 100))) return false;
  for (const times of [w.switchAt, w.switchWait, w.dribbleAt]) {
    if (times !== undefined && (!Array.isArray(times) || times.length !== 2 || !times.every((n) => finite(n, 10000)))) return false;
  }
  if (w.switchCandidate !== undefined && (!Array.isArray(w.switchCandidate) || w.switchCandidate.length !== 2
    || !w.switchCandidate.every((id, team) => Number.isInteger(id) && (id === -1 || id >= 0 && id < PLAYER_COUNT && teamOf(id) === team)))) return false;
  if (w.players.some((p) => p.slide != null && (!finite(p.slide.x, 1) || !finite(p.slide.z, 1)
    || !inRange(p.slide.t, 0, 1) || typeof p.slide.won !== 'boolean'))) return false;
  if (w.players.some((p) => p.buffer != null && (!['pass', 'through', 'lob', 'shoot', 'finesse'].includes(p.buffer.action)
    || !inRange(p.buffer.power, 0, 1) || !finite(p.buffer.aim?.x, 150) || !finite(p.buffer.aim?.z, 150) || !inRange(p.buffer.t, 0, 1)))) return false;
  if (kickEvent !== null && (!kickEvent || !Number.isInteger(kickEvent.playerId) || kickEvent.playerId < 0 || kickEvent.playerId >= PLAYER_COUNT
    || !slots.includes(w.players[kickEvent.playerId]?.slot ?? '') || typeof kickEvent.action !== 'string'
    || kickEvent.action.length > 24 || !inRange(kickEvent.power, 0, 1) || !inRange(kickEvent.time, 0, 360))) return false;
  return true;
}

export function movePacket(round: number, seq: number, seat: number, command: ControlCommand, edge?: number): MovePacket {
  const aimLength = Math.hypot(command.aim?.x ?? 1, command.aim?.z ?? 0) || 1;
  const buttons = (command.action === 'pass' ? 1 : 0)
    | (command.action === 'shoot' ? 2 : 0)
    | (command.action === 'through' ? 4 : 0)
    | (command.action === 'lob' ? 8 : 0)
    | (command.action === 'tackle' ? 16 : 0)
    | (command.action === 'slide' ? 32 : 0)
    | (command.press ? 128 : 0)
    | (command.action === 'finesse' ? 256 : 0)
    | (command.action === 'skill' ? 512 : 0)
    | (command.jockey ? 1024 : 0) | (command.autoJockey ? 2048 : 0) | (command.contain ? 4096 : 0)
    | (command.switchNearest ? 8192 : 0) | (command.finesseHeld ? 16384 : 0);
  return {
    t: 'soccer', k: 'mv', r: round, seq, seat,
    x: Math.round(command.move.x * 100) / 100, z: Math.round(command.move.z * 100) / 100,
    ax: Math.round((command.aim?.x ?? 1) / aimLength * 100) / 100,
    az: Math.round((command.aim?.z ?? 0) / aimLength * 100) / 100,
    power: Math.round(Math.max(0, Math.min(1, command.power ?? 0.72)) * 100) / 100,
    buttons: buttons | (command.sprint ? 64 : 0),
    ...(edge === undefined ? {} : { e: edge }),
    ...(command.switchDir ? { sx: Math.round(command.switchDir.x * 100) / 100, sz: Math.round(command.switchDir.z * 100) / 100 } : {}),
    held: (command.heldAction === 'pass' ? 1 : 0)
      | (command.heldAction === 'shoot' ? 2 : 0)
      | (command.heldAction === 'through' ? 4 : 0)
      | (command.heldAction === 'lob' ? 8 : 0)
      | (command.heldAction === 'skill' ? 512 : 0),
  };
}

export function parsePacket(value: unknown): SoccerPacket | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'soccer' || !Number.isSafeInteger(p.r) || (p.r as number) < 0 || !Number.isSafeInteger(p.seq) || (p.seq as number) < 0) return null;
  if (p.k === 'cfg') {
    if (![2, 3, 4, 6].includes(p.half as number) || ![0, 1, 2].includes(p.level as number)
      || (p.displayOnly !== undefined && typeof p.displayOnly !== 'boolean')
      || (p.mode !== undefined && !validMode(p.comp, p.mode))
      || (p.comp !== undefined && !COMPETITION_IDS.includes(p.comp as CompetitionId))
      || (p.offside !== undefined && typeof p.offside !== 'boolean')
      || (p.clubs !== undefined && (!Array.isArray(p.clubs) || p.clubs.length !== 2 || !p.clubs.every(validClubId)))) return null;
    return {
      t: 'soccer', k: 'cfg', r: p.r as number, seq: p.seq as number,
      half: p.half as ConfigPacket['half'], level: p.level as ConfigPacket['level'], displayOnly: p.displayOnly === true,
      ...(p.mode === undefined ? {} : { mode: p.mode as ConfigPacket['mode'] }),
      ...(p.comp === undefined ? {} : { comp: p.comp as CompetitionId }),
      ...(p.clubs === undefined ? {} : { clubs: [...p.clubs] as [string, string] }),
      ...(p.offside === undefined ? {} : { offside: p.offside as boolean }),
    };
  }
  if (p.k === 'lobby') {
    if (!COMPETITION_IDS.includes(p.comp as CompetitionId) || !validMode(p.comp, p.mode)
      || !Array.isArray(p.clubs) || p.clubs.length !== 2 || !p.clubs.every(validClubId)
      || !Array.isArray(p.focus) || p.focus.length !== 2 || !p.focus.every((n) => Number.isInteger(n) && n >= 0 && n <= 1)
      || !Array.isArray(p.ready) || p.ready.length !== 2 || !p.ready.every((ready) => typeof ready === 'boolean')
      || (p.countdown !== null && !inRange(p.countdown, 0, 3))
      || !Array.isArray(p.members) || !p.members.every((member) => member && Number.isInteger(member.seat) && member.seat >= 0 && member.seat <= 3
        && ['host', 'phone', 'mac'].includes(member.role) && (member.side === 0 || member.side === 1))
      || new Set(p.members.map((member) => (member as Record<string, unknown>).seat)).size !== p.members.length
      || (p.cup !== undefined && !validCupSummary(p.cup))) return null;
    return {
      t: 'soccer', k: 'lobby', r: p.r as number, seq: p.seq as number, comp: p.comp as CompetitionId,
      mode: p.mode as LobbyPacket['mode'], clubs: [...p.clubs] as [string, string], focus: [...p.focus] as [number, number],
      ready: [...p.ready] as [boolean, boolean], countdown: p.countdown as number | null,
      members: structuredClone(p.members) as LobbyMember[], ...(p.cup === undefined ? {} : { cup: structuredClone(p.cup) as CupSummary }),
    };
  }
  if (p.k === 'hi') {
    if (!Number.isInteger(p.seat) || (p.seat as number) < 1 || (p.seat as number) > 3
      || !['phone', 'mac'].includes(p.role as string) || (p.side !== 0 && p.side !== 1)) return null;
    return { t: 'soccer', k: 'hi', r: p.r as number, seq: p.seq as number, seat: p.seat as number, role: p.role as HiPacket['role'], side: p.side as 0 | 1 };
  }
  if (p.k === 'nav') {
    if (!Number.isInteger(p.seat) || (p.seat as number) < 1 || (p.seat as number) > 3
      || ![-1, 0, 1].includes(p.dx as number) || ![-1, 0, 1].includes(p.dy as number)
      || typeof p.a !== 'boolean' || typeof p.b !== 'boolean') return null;
    return { t: 'soccer', k: 'nav', r: p.r as number, seq: p.seq as number, seat: p.seat as number, dx: p.dx as -1 | 0 | 1, dy: p.dy as -1 | 0 | 1, a: p.a, b: p.b };
  }
  if (p.k === 'mv') {
    if (!Number.isInteger(p.seat) || (p.seat as number) < 0 || (p.seat as number) > 3 || !quantized(p.x) || !quantized(p.z)
      || !quantized(p.ax) || !quantized(p.az) || !inRange(p.power, 0, 1)
      || (p.e !== undefined && (!Number.isSafeInteger(p.e) || (p.e as number) < 0))
      || !Number.isInteger(p.buttons) || (p.buttons as number) < 0 || (p.buttons as number) > 32767 || ((p.buttons as number) & ~32767) !== 0
      || ((p.sx !== undefined || p.sz !== undefined) && (!quantized(p.sx) || !quantized(p.sz)))
      || !Number.isInteger(p.held) || (p.held as number) < 0 || (p.held as number) > 527 || ((p.held as number) & ~527) !== 0) return null;
    return { t: 'soccer', k: 'mv', r: p.r as number, seq: p.seq as number, seat: p.seat as number, x: p.x as number, z: p.z as number, ax: p.ax as number, az: p.az as number, power: p.power as number, buttons: p.buttons as number, held: p.held as number, ...(p.e === undefined ? {} : { e: p.e as number }), ...(p.sx === undefined ? {} : { sx: p.sx as number, sz: p.sz as number }) };
  }
  if (p.k === 'pd') {
    if (!Number.isInteger(p.seat) || (p.seat as number) < 0 || (p.seat as number) > 3 || !shortText(p.pick, 24)) return null;
    return { t: 'soccer', k: 'pd', r: p.r as number, seq: p.seq as number, seat: p.seat as number, pick: p.pick as string };
  }
  if (p.k === 'pp') {
    if (![p.drill, p.prompt, p.hint, p.score, p.best, p.tutorial].every((text) => shortText(text)) || typeof p.done !== 'boolean') return null;
    return { t: 'soccer', k: 'pp', r: p.r as number, seq: p.seq as number, drill: p.drill as string, prompt: p.prompt as string, hint: p.hint as string, score: p.score as string, best: p.best as string, done: p.done as boolean, tutorial: p.tutorial as string };
  }
  if (p.k === 's' && validWorld(p.state)) {
    const ack = Array.isArray(p.ack) && p.ack.length <= 4 && p.ack.every((seq) => Number.isSafeInteger(seq) && (seq as number) >= -1)
      ? p.ack as number[]
      : undefined;
    return {
      t: 'soccer', k: 's', r: p.r as number, seq: p.seq as number, state: structuredClone(p.state),
      ...(ack === undefined ? {} : { ack: [...ack] }),
    };
  }
  return null;
}

export function commandFromPacket(packet: MovePacket): ControlCommand {
  const buttons = packet.buttons;
  const action = buttons & 256 ? 'finesse' : buttons & 512 ? 'skill' : buttons & 2 ? 'shoot' : buttons & 1 ? 'pass' : buttons & 4 ? 'through' : buttons & 8 ? 'lob' : buttons & 32 ? 'slide' : buttons & 16 ? 'tackle' : null;
  const held = packet.held;
  const heldAction = held & 2 ? 'shoot' : held & 1 ? 'pass' : held & 4 ? 'through' : held & 8 ? 'lob' : held & 512 ? 'skill' : null;
  return { move: { x: packet.x, z: packet.z }, sprint: !!(buttons & 64), action, heldAction, press: !!(buttons & 128), pressed: !!action, power: packet.power, aim: { x: packet.ax, z: packet.az },
    jockey: !!(buttons & 1024), autoJockey: !!(buttons & 2048), contain: !!(buttons & 4096), switchNearest: !!(buttons & 8192), finesseHeld: !!(buttons & 16384),
    switchDir: packet.sx === undefined ? null : { x: packet.sx, z: packet.sz! } };
}

export function mergeRemoteCommand(previous: ControlCommand | undefined, current: ControlCommand): ControlCommand {
  return { ...current,
    ...(previous?.pressed && !current.pressed ? { action: previous.action, pressed: true, power: previous.power, aim: previous.aim } : {}),
    switchNearest: current.switchNearest || previous?.switchNearest,
    switchDir: current.switchDir ?? previous?.switchDir,
  };
}

export function acceptMovePacket(seat: RemoteSeat, previous: ControlCommand | undefined, packet: MovePacket, defending: boolean): { seat: RemoteSeat; command: ControlCommand | null } {
  const incoming = commandFromPacket(packet);
  const hasEdge = packet.e !== undefined;
  const freshSequence = packet.seq > seat.seq;
  const freshEdge = hasEdge && packet.e! > seat.edge;
  if (!freshSequence && !freshEdge) return { seat, command: null };
  if (!hasEdge) {
    const nextSeat = { ...seat, seq: packet.seq, held: incoming.heldAction ?? null, pressUsed: incoming.heldAction == null ? false : seat.pressUsed };
    return { seat: nextSeat, command: mergeRemoteCommand(previous, incoming) };
  }

  const held = incoming.heldAction ?? null;
  const defensiveRise = freshEdge && seat.held == null && held !== null && defending
    && (held === 'shoot' || held === 'lob' || held === 'through');
  const droppedRelease = seat.pressUsed && held === null && incoming.pressed
    && (incoming.action === 'shoot' || incoming.action === 'finesse' || incoming.action === 'lob' || incoming.action === 'through');
  const base = previous ?? { move: { x: 0, z: 0 } };
  const current: ControlCommand = freshSequence ? incoming : {
    ...base,
    action: incoming.action,
    pressed: incoming.pressed,
    power: incoming.power,
    aim: incoming.aim,
    switchNearest: incoming.switchNearest,
    switchDir: incoming.switchDir,
    ...(freshEdge ? { heldAction: incoming.heldAction } : {}),
  };
  if (!freshEdge || droppedRelease) {
    current.action = null;
    current.pressed = false;
    current.switchNearest = false;
    current.switchDir = null;
  }
  if (defensiveRise && !droppedRelease) {
    current.action = held;
    current.pressed = true;
    current.power = incoming.power;
    current.aim = incoming.aim;
  }
  const nextSeat: RemoteSeat = {
    seq: freshSequence ? packet.seq : seat.seq,
    edge: freshEdge ? packet.e! : seat.edge,
    held: freshSequence || freshEdge ? held : seat.held,
    pressUsed: held === null ? false : defensiveRise || seat.pressUsed,
  };
  const hasAction = current.action != null || current.pressed || current.switchNearest || current.switchDir != null
    || freshSequence || freshEdge && (defensiveRise || incoming.heldAction !== undefined);
  return { seat: nextSeat, command: hasAction ? mergeRemoteCommand(previous, current) : null };
}

export function consumeCommand(command: ControlCommand): ControlCommand {
  return { ...command, action: null, pressed: false, switchNearest: false, switchDir: null };
}

export function cloneSnapshot(world: World) {
  return JSON.parse(JSON.stringify(world)) as Omit<World, 'seed'> & { seed: number };
}
