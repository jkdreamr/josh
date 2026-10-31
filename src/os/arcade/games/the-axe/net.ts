import { JAILBREAK_TIME, type GameEvent, type Mode, type Phase, type Player, type World } from './logic.ts';

export type NetEvent = [number, number, number, number, number];
export type PackedPlayer = {
  x: number; y: number; vx: number; vy: number; face: number; stamina: number;
  flags: number; jailed: boolean; safe: boolean; immune: boolean; stunned: boolean;
  boost: boolean; sprinting: boolean; ai: boolean;
};
/**
 * A guest's stick, plus (newer guests) where its own player is: a guest moves itself, and the host takes its word for
 * it unless the game has moved that player since (w, the player's warp, is behind).
 */
export type InputPacket = {
  t: 'the-axe'; r: number; k: 'i'; x: number; y: number; s: boolean; q: number;
  px?: number; py?: number; vx?: number; vy?: number; w?: number;
};
export type OwnMove = { x: number; y: number; vx: number; vy: number; warp: number };
export type StartPacket = {
  t: 'the-axe'; r: number; k: 'start'; mode: Mode; seed: number; lv: number;
  roster: [number, number, number][];
};
export type StatePacket = {
  t: 'the-axe'; r: number; k: 'S'; n: number; ph: Phase; pt: number; ck: number; ot: 0 | 1;
  sc: [number, number]; tr: number; ts: number[]; ax: [number, number, number][];
  pk: [number, number, number, number][]; p: number[][]; ev: NetEvent[];
  /** Newer hosts: each player's warp, and the jailbreak clock (centiseconds). */
  wp?: number[]; jb?: number;
};
export type EndPacket = {
  t: 'the-axe'; r: number; k: 'end'; mode: Mode; sc: [number, number];
  w: number; wid: number; win: number | null;
};
export type AxePacket = InputPacket | StartPacket | StatePacket | EndPacket;

const modes: Mode[] = ['classic', 'big', 'tree'];
const phases: Phase[] = ['count', 'play', 'scored', 'over'];
const kindIndex = { drum: 0, costume: 1 } as const;
const phaseIndex: Record<Phase, number> = { count: 0, play: 1, scored: 2, over: 3 };
const integer = (n: unknown, min: number, max: number): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const row = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(Number.isSafeInteger);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const roundOk = (value: Record<string, unknown>) => value.t === 'the-axe' && integer(value.r, 0, 1_000_000_000);

function encodeCoordinate(x: number, y: number) {
  return Math.round(x * 100) * 100_000 + Math.round(y * 100);
}

function decodeCoordinate(value: number) {
  return { x: Math.floor(value / 100_000) / 100, y: (value % 100_000) / 100 };
}

export function packPlayer(player: Player): number[] {
  const flags = (player.jailed ? 1 : 0) | (player.safe ? 2 : 0) | (player.immuneT > 0 ? 4 : 0)
    | (player.stunT > 0 ? 8 : 0) | (player.boostT > 0 ? 16 : 0)
    | (player.sprinting ? 32 : 0) | (player.ai !== null ? 64 : 0);
  return [
    Math.round(player.x * 100), Math.round(player.y * 100),
    Math.round(player.vx * 100), Math.round(player.vy * 100), Math.round(player.face * 100),
    Math.round(player.stamina * 100), flags,
  ];
}

export function unpackPlayer(value: unknown): PackedPlayer | null {
  if (!row(value, 7)) return null;
  const [x, y, vx, vy, face, stamina, flags] = value;
  if (!integer(x, 0, 6000) || !integer(y, 0, 3400) || !integer(vx, -10000, 10000)
    || !integer(vy, -10000, 10000) || !integer(face, -629, 629)
    || !integer(stamina, 0, 100) || !integer(flags, 0, 127)) return null;
  return {
    x: x / 100, y: y / 100, vx: vx / 100, vy: vy / 100, face: face / 100, stamina: stamina / 100, flags,
    jailed: !!(flags & 1), safe: !!(flags & 2), immune: !!(flags & 4), stunned: !!(flags & 8),
    boost: !!(flags & 16), sprinting: !!(flags & 32), ai: !!(flags & 64),
  };
}

type Sent = Exclude<GameEvent, { type: 'jailbreak' }>;

/**
 * Events as the host sends them, numbered on from firstId. The timed jailbreak stays off the wire (guests see it in the
 * state's jailbreak clock), so a guest a version behind never meets an event it doesn't know.
 */
export function eventsToNet(events: GameEvent[], firstId = 0): NetEvent[] {
  return events.filter((event): event is Sent => event.type !== 'jailbreak').map((event, index) => {
    const id = firstId + index;
    switch (event.type) {
      case 'tag': return [id, 0, event.by, event.who, encodeCoordinate(event.x, event.y)];
      case 'free': return [id, 1, event.by, event.count, event.team];
      case 'steal': return [id, 2, event.who, event.axe, 0];
      case 'drop': return [id, 3, event.axe, encodeCoordinate(event.x, event.y), 0];
      case 'capture': return [id, 4, event.who, event.team, 0];
      case 'pickup': return [id, 5, event.who, kindIndex[event.kind], encodeCoordinate(event.x, event.y)];
      case 'stun': return [id, 6, event.who, event.by, 0];
      case 'tree': return [id, 7, event.who, event.by, 0];
      case 'phase': return [id, 8, phaseIndex[event.phase], 0, 0];
      case 'overtime': return [id, 9, 0, 0, 0];
    }
  });
}

export function eventsFromNet(events: NetEvent[]): GameEvent[] {
  const result: GameEvent[] = [];
  for (const [id, type, a, b, c] of events) {
    if (!integer(id, 0, 1_000_000_000) || !integer(type, 0, 9)) continue;
    switch (type) {
      case 0: result.push({ type: 'tag', by: a, who: b, ...decodeCoordinate(c) }); break;
      case 1: result.push({ type: 'free', by: a, count: b, team: c as 0 | 1 }); break;
      case 2: result.push({ type: 'steal', who: a, axe: b }); break;
      case 3: result.push({ type: 'drop', axe: a, ...decodeCoordinate(b) }); break;
      case 4: result.push({ type: 'capture', who: a, team: b as 0 | 1 }); break;
      case 5: result.push({ type: 'pickup', who: a, kind: b === 0 ? 'drum' : 'costume', ...decodeCoordinate(c) }); break;
      case 6: result.push({ type: 'stun', who: a, by: b }); break;
      case 7: result.push({ type: 'tree', who: a, by: b }); break;
      case 8: result.push({ type: 'phase', phase: phases[a] }); break;
      case 9: result.push({ type: 'overtime' }); break;
    }
  }
  return result;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));

export function inputPacket(round: number, input: { x: number; y: number; sprint: boolean }, seq: number, own?: OwnMove): InputPacket {
  const length = Math.hypot(input.x, input.y);
  const scale = length > 1 ? 1 / length : 1;
  const packet: InputPacket = {
    t: 'the-axe', r: round, k: 'i',
    x: Math.round(input.x * scale * 100), y: Math.round(input.y * scale * 100),
    s: input.sprint, q: seq,
  };
  if (own) {
    packet.px = clamp(own.x * 100, 0, 6000);
    packet.py = clamp(own.y * 100, 0, 3400);
    packet.vx = clamp(own.vx * 100, -3000, 3000);
    packet.vy = clamp(own.vy * 100, -3000, 3000);
    packet.w = clamp(own.warp, 0, 1_000_000_000);
  }
  return packet;
}

/** Where a guest says its own player is, if its packet says. */
export function ownMoveOf(packet: InputPacket): OwnMove | null {
  if (packet.px === undefined || packet.py === undefined || packet.vx === undefined || packet.vy === undefined || packet.w === undefined) return null;
  return { x: packet.px / 100, y: packet.py / 100, vx: packet.vx / 100, vy: packet.vy / 100, warp: packet.w };
}

export function startPacket(round: number, mode: Mode, seed: number, level: number, roster: { seat: number; team: 0 | 1; ai: boolean }[]): StartPacket {
  return {
    t: 'the-axe', r: round, k: 'start', mode, seed: seed >>> 0, lv: level,
    roster: roster.slice(0, 10).map((p) => [p.seat, p.team, p.ai ? 1 : 0]),
  };
}

export function statePacket(round: number, tick: number, world: World, events: NetEvent[]): StatePacket {
  return {
    t: 'the-axe', r: round, k: 'S', n: tick,
    ph: world.phase, pt: Math.round(world.phaseT * 100), ck: Math.round(world.clock * 100),
    ot: world.overtime ? 1 : 0, sc: [...world.score], tr: world.tree,
    ts: world.treeScore.map((n) => Math.round(n * 10)),
    ax: world.axes.map((a) => [Math.round(a.x * 100), Math.round(a.y * 100), a.carrier]),
    pk: world.pickups.map((p) => [p.id, kindIndex[p.kind], Math.round(p.x * 100), Math.round(p.y * 100)]),
    p: world.players.slice(0, 10).map(packPlayer), ev: events.slice(-60),
    wp: world.players.slice(0, 10).map((p) => p.warp),
    jb: Math.round(Math.max(0, Math.min(JAILBREAK_TIME, world.jailT)) * 100),
  };
}

export function endPacket(round: number, world: World, winnerSeat: number | null): EndPacket {
  return { t: 'the-axe', r: round, k: 'end', mode: world.mode, sc: [...world.score], w: world.winner ?? -1, wid: world.winnerId, win: winnerSeat };
}

function validEvents(value: unknown): value is NetEvent[] {
  if (!Array.isArray(value) || value.length > 60) return false;
  let last = -1;
  for (const event of value) {
    if (!row(event, 5)) return false;
    const [id, type, a, b, c] = event;
    if (!integer(id, 0, 1_000_000_000) || id <= last || !integer(type, 0, 9)
      || !integer(a, -1_000_000, 1_000_000) || !integer(b, -1_000_000, 603_400_000)
      || !integer(c, -1_000_000, 1_000_000_000)) return false;
    if (type === 0 && (!integer(a, 0, 9) || !integer(b, 0, 9) || c < 0 || c > 603_400_000)) return false;
    if (type === 1 && (!integer(a, 0, 9) || !integer(b, 0, 10) || !integer(c, 0, 1))) return false;
    if (type === 2 && (!integer(a, 0, 9) || !integer(b, 0, 1) || c !== 0)) return false;
    if (type === 3 && (!integer(a, 0, 1) || b < 0 || b > 603_400_000 || c !== 0)) return false;
    if (type === 4 && (!integer(a, 0, 9) || !integer(b, 0, 1) || c !== 0)) return false;
    if (type === 5 && (!integer(a, 0, 9) || !integer(b, 0, 1) || c < 0 || c > 603_400_000)) return false;
    if ((type === 6 || type === 7) && (!integer(a, 0, 9) || !integer(b, 0, 9) || c !== 0)) return false;
    if (type === 8 && (!integer(a, 0, 3) || b !== 0 || c !== 0)) return false;
    if (type === 9 && (a !== 0 || b !== 0 || c !== 0)) return false;
    last = id;
  }
  return true;
}

export function parsePacket(value: unknown): AxePacket | null {
  if (!object(value) || !roundOk(value)) return null;
  if (value.k === 'i') {
    if (!integer(value.q, 0, 1_000_000_000) || !integer(value.x, -100, 100) || !integer(value.y, -100, 100)
      || typeof value.s !== 'boolean' || Math.hypot(value.x as number, value.y as number) > 101) return null;
    const own = [value.px, value.py, value.vx, value.vy, value.w];
    if (own.some((n) => n !== undefined)) {
      if (!integer(value.px, 0, 6000) || !integer(value.py, 0, 3400) || !integer(value.vx, -3000, 3000)
        || !integer(value.vy, -3000, 3000) || !integer(value.w, 0, 1_000_000_000)) return null;
    }
    return value as unknown as InputPacket;
  }
  if (value.k === 'start') {
    if (!modes.includes(value.mode as Mode) || !integer(value.seed, 0, 0xffff_ffff)
      || !integer(value.lv, 0, 2) || !Array.isArray(value.roster) || value.roster.length > 10) return null;
    const seats = new Set<number>();
    for (const seatRow of value.roster) {
      if (!row(seatRow, 3) || !integer(seatRow[0], 0, 9) || !integer(seatRow[1], 0, 1) || !integer(seatRow[2], 0, 1)
        || seats.has(seatRow[0])) return null;
      seats.add(seatRow[0]);
    }
    return value as unknown as StartPacket;
  }
  if (value.k === 'S') {
    if (!integer(value.n, 0, 1_000_000_000) || !phases.includes(value.ph as Phase)
      || !integer(value.pt, 0, 1000) || !integer(value.ck, 0, 24000) || !integer(value.ot, 0, 1)
      || !row(value.sc, 2) || !integer(value.sc[0], 0, 100) || !integer(value.sc[1], 0, 100)
      || !integer(value.tr, -1, 9) || !Array.isArray(value.ts) || value.ts.length > 10
      || !value.ts.every((n) => integer(n, 0, 1200))
      || !Array.isArray(value.ax) || value.ax.length > 2 || !Array.isArray(value.pk) || value.pk.length > 2
      || !Array.isArray(value.p) || value.p.length > 10 || !validEvents(value.ev)) return null;
    for (const axe of value.ax) {
      if (!row(axe, 3) || !integer(axe[0], 0, 6000) || !integer(axe[1], 0, 3400) || !integer(axe[2], -1, 9)) return null;
    }
    for (const pickup of value.pk) {
      if (!row(pickup, 4) || !integer(pickup[0], 0, 1_000_000_000) || !integer(pickup[1], 0, 1)
        || !integer(pickup[2], 0, 6000) || !integer(pickup[3], 0, 3400)) return null;
    }
    for (const packed of value.p) if (!unpackPlayer(packed)) return null;
    if (value.wp !== undefined && (!Array.isArray(value.wp) || value.wp.length !== value.p.length
      || !value.wp.every((n) => integer(n, 0, 1_000_000_000)))) return null;
    if (value.jb !== undefined && !integer(value.jb, 0, JAILBREAK_TIME * 100)) return null;
    return value as unknown as StatePacket;
  }
  if (value.k === 'end') {
    if (!modes.includes(value.mode as Mode) || !row(value.sc, 2)
      || !integer(value.sc[0], 0, 100) || !integer(value.sc[1], 0, 100)
      || !integer(value.w, -1, 1) || !integer(value.wid, -1, 9)
      || !(value.win === null || integer(value.win, 0, 9))) return null;
    return value as unknown as EndPacket;
  }
  return null;
}
