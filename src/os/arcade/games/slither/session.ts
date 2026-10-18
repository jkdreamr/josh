import type { World, Pellet } from './world.ts';
import { FIELD_NAMES, addSnake, bodyCount, setPellet, wrapAngle } from './world.ts';
import type { NetOp, RosterEntry, SnakeState } from './net.ts';

export type RoomSeat = { seat: number; name: string; bot?: boolean; color?: number; skin?: number };

export function makeRoster(players: readonly RoomSeat[], bots: readonly RoomSeat[], fillTo = 16): RosterEntry[] {
  const roster: RosterEntry[] = [];
  const occupied = new Set<number>();
  const people = peopleSeats(players);
  for (const player of [...players, ...bots].sort((a, b) => a.seat - b.seat)) {
    if (player.seat < 0 || player.seat > 7 || occupied.has(player.seat)) continue;
    occupied.add(player.seat);
    const bot = !people.has(player.seat);
    roster.push({
      id: roster.length,
      seat: player.seat,
      name: player.name.slice(0, 40),
      color: player.color ?? player.seat % 8,
      skin: player.skin ?? player.seat % 8,
      bot,
      eligible: true,
    });
  }
  const total = Math.min(16, Math.max(roster.length, fillTo));
  const names = fillerNames(roster.map((entry) => entry.name), total - roster.length);
  for (let i = 0; roster.length < total; i++) {
    roster.push({
      id: roster.length,
      seat: -1,
      name: names[i],
      color: (roster.length + 2) % 8,
      skin: (roster.length + 2) % 8,
      bot: true,
      eligible: false,
    });
  }
  return roster;
}

const EXTRA_NAMES = ['Bucatini', 'Orecchiette', 'Ravioli', 'Cavatappi', 'Lasagna', 'Vermicelli', 'Somen', 'Conchiglie', 'Tortellini'];

/** Arena filler names that no seat in the room already uses, so Top 10 and the winner title name one noodle each. */
export function fillerNames(taken: readonly string[], count: number): string[] {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const names: string[] = [];
  for (const name of [...FIELD_NAMES, ...EXTRA_NAMES]) {
    if (names.length >= count) break;
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      names.push(name);
    }
  }
  for (let n = 2; names.length < count; n++) {
    const name = `Noodle ${n}`;
    if (!used.has(name.toLowerCase())) names.push(name);
  }
  return names;
}

const peopleSeats = (players: readonly RoomSeat[]) => new Set(players.filter((p) => !p.bot && p.seat >= 0).map((p) => p.seat));

/** Turn disconnected humans into host-run bots without leaving an empty seat in the round. */
export function takeOverSeats(roster: readonly RosterEntry[], activeSeats: readonly number[]): RosterEntry[] {
  const active = new Set(activeSeats);
  return roster.map((entry) => entry.seat >= 0 && !entry.bot && !active.has(entry.seat)
    ? { ...entry, bot: true, eligible: false }
    : entry);
}

export function syncRoster(roster: readonly RosterEntry[], players: readonly RoomSeat[], bots: readonly RoomSeat[]): RosterEntry[] {
  const bySeat = new Map<number, RoomSeat>();
  const people = peopleSeats(players);
  // A person who joins mid-round takes a bot's seat; the round's bot list still names it until the next round.
  for (const bot of bots) if (!people.has(bot.seat)) bySeat.set(bot.seat, { ...bot, bot: true });
  for (const player of players) if (people.has(player.seat)) bySeat.set(player.seat, { ...player, bot: false });
  const result = roster.map((entry) => {
    if (entry.seat < 0) return { ...entry };
    const current = bySeat.get(entry.seat);
    if (current) return {
      ...entry, name: current.name.slice(0, 40), bot: !!current.bot, eligible: true,
      color: current.color ?? entry.color, skin: current.skin ?? entry.skin,
    };
    if (entry.bot) return { ...entry, seat: -1, eligible: false };
    return { ...entry, bot: true, eligible: false };
  });
  const taken = new Set(result.filter((entry) => entry.seat >= 0).map((entry) => entry.seat));
  const newSeats = [...bySeat.values()].filter((entry) => entry.seat >= 0 && !taken.has(entry.seat));
  for (const person of newSeats) {
    const index = result.findIndex((entry) => entry.seat < 0);
    if (index < 0) break;
    const bot = !people.has(person.seat);
    result[index] = {
      ...result[index], seat: person.seat, name: person.name.slice(0, 40),
      color: person.color ?? person.seat % 8, skin: person.skin ?? person.seat % 8,
      bot, eligible: true,
    };
    taken.add(person.seat);
  }
  return result;
}

export function worldFromRoster(seed: number, radius: number, roster: readonly RosterEntry[], create: (seed: number, radius: number) => World): World {
  const world = create(seed, radius);
  for (const entry of roster) {
    addSnake(world, {
      id: entry.id, name: entry.name, seat: entry.seat, bot: entry.bot, eligible: entry.eligible,
      color: entry.color, skin: entry.skin, respawnDelay: 3,
    });
  }
  return world;
}

export function standings(world: World): number[] {
  return world.snakes.slice().sort((a, b) => b.mass - a.mass || b.kills - a.kills || a.id - b.id).map((snake) => snake.id);
}

export function winnerSeat(world: World, winner: number | null): number | null {
  if (winner === null) return null;
  const snake = world.snakes.find((s) => s.id === winner);
  return snake && snake.seat >= 0 && snake.eligible ? snake.seat : null;
}

export function applyOps(world: World, ops: readonly NetOp[]) {
  for (const op of ops) {
    if (op.k === 'remove') {
      world.pellets = world.pellets.filter((pellet) => pellet.id !== op.id);
    } else if (op.k === 'add') {
      if (!world.pellets.some((pellet) => pellet.id === op.pellet.id)) setPellet(world, { ...op.pellet });
    } else if (op.k === 'spawn') {
      const snake = world.snakes.find((s) => s.id === op.id);
      if (snake) {
        const angle = wrapAngle(op.angle);
        snake.x = snake.px = op.x;
        snake.y = snake.py = op.y;
        snake.angle = snake.prevAngle = angle;
        snake.alive = true;
        snake.mass = 10;
        snake.body = Array.from({ length: 13 }, (_, i) => ({
          x: op.x - Math.cos(angle) * i * 7,
          y: op.y - Math.sin(angle) * i * 7,
        }));
        snake.respawnAt = null;
      }
    } else {
      const snake = world.snakes.find((s) => s.id === op.id);
      if (snake) {
        snake.alive = false;
        snake.mass = op.mass;
        snake.respawnAt = snake.respawnDelay > 0 ? world.clock + snake.respawnDelay : null;
      }
    }
  }
}

export function applyHeadState(world: World, state: readonly SnakeState[]) {
  for (const row of state) {
    const snake = world.snakes.find((s) => s.id === row[0]);
    if (!snake) continue;
    const [, x, y, angle, mass, alive, kills, boosting, vx, vy, peak] = row;
    if (snake.alive && alive) {
      const dx = x - snake.x;
      const dy = y - snake.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < 200) {
        let nextPoint = 7 - snake.pathDistance;
        while (nextPoint <= distance) {
          snake.body.unshift({ x: snake.x + dx * nextPoint / distance, y: snake.y + dy * nextPoint / distance });
          nextPoint += 7;
        }
        snake.pathDistance = (snake.pathDistance + distance) % 7;
      }
    }
    snake.px = snake.x;
    snake.py = snake.y;
    snake.x = x;
    snake.y = y;
    snake.prevAngle = wrapAngle(snake.angle);
    snake.angle = wrapAngle(angle);
    snake.mass = mass;
    if (snake.alive) {
      snake.body.length = Math.min(snake.body.length, bodyCount(mass) + 2);
    }
    snake.alive = alive;
    snake.kills = kills;
    snake.boosting = boosting;
    snake.vx = vx;
    snake.vy = vy;
    snake.peak = Math.max(snake.peak, peak);
  }
}

export function loadSnapshot(world: World, data: readonly unknown[][]) {
  const bodies = new Map<number, { start: number; points: number[] }[]>();
  const pellets: Pellet[] = [];
  for (const row of data) {
    if (row[0] === 's') {
      const snake = world.snakes.find((s) => s.id === row[1]);
      if (!snake || row.length < 19) continue;
      snake.seat = row[2] as number;
      snake.name = row[3] as string;
      snake.color = row[4] as number;
      snake.skin = row[5] as number;
      snake.bot = row[6] as boolean;
      snake.eligible = row[7] as boolean;
      snake.alive = row[8] as boolean;
      snake.x = snake.px = row[9] as number;
      snake.y = snake.py = row[10] as number;
      snake.angle = snake.prevAngle = wrapAngle(row[11] as number);
      snake.mass = row[12] as number;
      snake.peak = row[13] as number;
      snake.kills = row[14] as number;
      snake.boosting = row[15] as boolean;
      snake.vx = row[16] as number;
      snake.vy = row[17] as number;
      snake.respawnAt = row[18] === null ? null : row[18] as number;
    } else if (row[0] === 'b' && typeof row[1] === 'number' && typeof row[2] === 'number') {
      const list = bodies.get(row[1]) ?? [];
      list.push({ start: row[2], points: row.slice(3).filter((v): v is number => typeof v === 'number') });
      bodies.set(row[1], list);
    } else if (row[0] === 'p' && row.length === 8) {
      pellets.push({
        id: row[1] as number, x: row[2] as number, y: row[3] as number, value: row[4] as number,
        color: row[5] as number, born: row[6] as number, natural: row[7] as boolean,
      });
    }
  }
  for (const [id, chunks] of bodies) {
    const snake = world.snakes.find((s) => s.id === id);
    if (!snake) continue;
    const points: { x: number; y: number }[] = [];
    for (const chunk of chunks.sort((a, b) => a.start - b.start)) {
      for (let i = 0; i + 1 < chunk.points.length; i += 2) points[chunk.start + i / 2] = { x: chunk.points[i] / 10, y: chunk.points[i + 1] / 10 };
    }
    snake.body = points.filter((p): p is { x: number; y: number } => !!p);
  }
  world.pellets = pellets;
  world.nextPelletId = Math.max(1, ...pellets.map((p) => p.id + 1));
}

export function winnerOf(world: World): number | null {
  return world.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass || b.kills - a.kills || a.id - b.id)[0]?.id ?? null;
}

export function resultRows(world: World): [number, number, number, number][] {
  return standings(world).map((id) => {
    const snake = world.snakes[id];
    return [snake.id, snake.seat, Math.round(snake.mass * 10) / 10, snake.kills];
  });
}

type ShellStatus = 'ready' | 'playing' | 'paused' | 'over';

/** A solo round starts fresh on Play or Play Again, but Resume after a pause keeps the round in progress. */
export function startsSoloRound(previous: ShellStatus | null, status: ShellStatus, hasWorld: boolean): boolean {
  return status === 'playing' && (!hasWorld || previous !== 'paused');
}

/** CSS size that still renders at least `min` px when a framed device scales the whole screen down, capped at `max`. */
export function touchTarget(renderedWidth: number, layoutWidth: number, min = 44, max = 64): number {
  const scale = layoutWidth > 0 && renderedWidth > 0 ? renderedWidth / layoutWidth : 1;
  return Math.min(max, Math.ceil(min / Math.min(1, scale)));
}

/** Who left (a person's noodle now steered by a bot) and who joined (a person now steering one) between two rosters. */
export function rosterChanges(before: readonly RosterEntry[], after: readonly RosterEntry[], mySeat = -1): { left: string[]; joined: string[] } {
  const left: string[] = [];
  const joined: string[] = [];
  const old = new Map(before.map((entry) => [entry.id, entry]));
  const person = (entry: RosterEntry | undefined) => !!entry && entry.seat >= 0 && !entry.bot;
  for (const entry of after) {
    const prev = old.get(entry.id);
    const was = person(prev);
    const is = person(entry);
    if (was && (!is || prev!.seat !== entry.seat)) left.push(prev!.name);
    if (is && entry.seat !== mySeat && (!was || prev!.seat !== entry.seat)) joined.push(entry.name);
  }
  return { left, joined };
}

/** A short line for a roster change, or '' when nobody came or went. */
export function rosterNotice(change: { left: string[]; joined: string[] }): string {
  const names = (list: string[]) => list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const parts: string[] = [];
  if (change.left.length) parts.push(`${names(change.left)} left, a bot took over`);
  if (change.joined.length) parts.push(`${names(change.joined)} joined`);
  return parts.join('. ');
}

export type PersonResult = { seat: number; name: string; place: number; length: number; kills: number; me: boolean };

/** The people still in the room at the end of a round, in finishing order, from the host's final ranking. */
export function peopleResults(ranking: readonly [number, number, number, number][], snakes: readonly { id: number; seat: number; bot: boolean; name: string }[], mySeat: number): PersonResult[] {
  const byId = new Map(snakes.map((snake) => [snake.id, snake]));
  const result: PersonResult[] = [];
  ranking.forEach(([id, seat, length, kills], i) => {
    const snake = byId.get(id);
    if (!snake || snake.bot || seat < 0) return;
    result.push({ seat, name: snake.name, place: i + 1, length: Math.floor(length), kills, me: seat === mySeat });
  });
  return result;
}

export const ordinal = (place: number) => place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;

/** One line naming everyone in the room with their place and length, for the online Game Over card. */
export function peopleLine(people: readonly PersonResult[]): string {
  if (!people.length) return '';
  const rows = people.map((p) => `${p.me ? 'you' : p.name} ${ordinal(p.place)}, length ${p.length}`);
  return `${people.length === 1 ? '1 person' : `${people.length} people`} in the room: ${rows.join('; ')}.`;
}
