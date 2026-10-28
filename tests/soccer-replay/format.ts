import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAI, type Level } from '../../src/os/arcade/games/soccer/ai.ts';
import {
  createWorld,
  setRestart,
  stepWorld,
  STEP,
  type Command,
  type World,
  type Player,
  type Restart,
} from '../../src/os/arcade/games/soccer/logic.ts';
import { missingPhoneSeats } from '../../src/os/arcade/games/soccer/seats.ts';
import { CLUB_IDS } from '../../src/os/arcade/games/soccer/teams.ts';

export type Run = { from: number; to: number; seat: number; command: Command };
export type Recording = {
  version: 1;
  seed: number;
  clubs: [string, string];
  mode: 'cpu' | 'versus' | 'coop';
  halfLength: number;
  humans: 1 | 2;
  level: Level;
  seats: Record<string, number>;
  frames: number;
  cpuRestarts?: boolean;
  setup?: {
    name: 'live' | 'kickoff';
    park?: boolean;
    ball?: Partial<World['ball']>;
    players?: Record<string, Partial<Player>>;
    lastTouch?: 0 | 1;
    carrierId?: number;
    restart?: { kind: Exclude<Restart, null>; team: 0 | 1; at: { x: number; z: number } };
  };
  commands: Run[];
  presence?: { from: number; to: number; seats: number[] }[];
};
const integer = (n: unknown, lo = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo;
function point(p: unknown): void {
  assert.ok(
    p &&
      typeof p === 'object' &&
      typeof (p as { x: number }).x === 'number' &&
      typeof (p as { z: number }).z === 'number',
    'invalid point',
  );
}
function finite(value: unknown): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'nonfinite number');
  if (value && typeof value === 'object') Object.values(value).forEach(finite);
}
export function validateRecording(value: unknown): Recording {
  const r = value as Recording;
  assert.ok(r && r.version === 1, 'unsupported recording version');
  finite(r);
  assert.ok(integer(r.seed) && integer(r.frames, 1) && r.frames <= 36000);
  assert.ok(r.halfLength > 0 && (r.humans === 1 || r.humans === 2));
  assert.ok(['cpu', 'versus', 'coop'].includes(r.mode) && ['easy', 'normal', 'hard'].includes(r.level));
  assert.ok(Array.isArray(r.clubs) && r.clubs.length === 2 && r.clubs.every((c) => CLUB_IDS.includes(c)));
  assert.ok(r.seats && typeof r.seats === 'object');
  const ids = Object.values(r.seats);
  assert.equal(new Set(ids).size, ids.length);
  for (const [seat, id] of Object.entries(r.seats)) assert.ok(integer(Number(seat)) && integer(id) && id < 22);
  assert.ok(Array.isArray(r.commands));
  if (r.cpuRestarts !== undefined) assert.equal(typeof r.cpuRestarts, 'boolean');
  const occupied = new Set<string>();
  for (const run of r.commands) {
    assert.ok(integer(run.from) && integer(run.to) && run.from <= run.to && run.to < r.frames);
    assert.ok(Object.hasOwn(r.seats, run.seat));
    assert.ok(run.command && typeof run.command === 'object');
    point(run.command.move);
    for (const key of [
      'sprint',
      'jockey',
      'autoJockey',
      'contain',
      'switchNearest',
      'pressed',
      'press',
      'allowOffside',
    ] as const)
      if (run.command[key] !== undefined) assert.equal(typeof run.command[key], 'boolean');
    if (run.command.aim !== undefined) point(run.command.aim);
    if (run.command.switchDir != null) point(run.command.switchDir);
    if (run.command.power !== undefined)
      assert.ok(typeof run.command.power === 'number' && run.command.power >= 0 && run.command.power <= 1);
    assert.ok(Math.hypot(run.command.move.x, run.command.move.z) <= Math.SQRT2);
    if (run.command.action != null)
      assert.ok(
        ['pass', 'through', 'lob', 'shoot', 'finesse', 'tackle', 'slide', 'skill'].includes(run.command.action),
      );
    for (let f = run.from; f <= run.to; f++) {
      const key = f + ':' + run.seat;
      assert.ok(!occupied.has(key), 'overlapping command runs');
      occupied.add(key);
    }
  }
  if (r.setup) {
    assert.ok(['live', 'kickoff'].includes(r.setup.name));
    if (r.setup.park !== undefined) assert.equal(typeof r.setup.park, 'boolean');
    for (const [id, p] of Object.entries(r.setup.players ?? {})) {
      assert.ok(integer(Number(id)) && Number(id) < 22);
      for (const [key, value] of Object.entries(p)) {
        assert.ok(
          ['x', 'z', 'vx', 'vz', 'facing', 'stamina', 'cooldown', 'touchCd'].includes(key),
          'unsupported player override',
        );
        assert.equal(typeof value, 'number');
      }
    }
    for (const [key, value] of Object.entries(r.setup.ball ?? {})) {
      assert.ok(
        ['x', 'y', 'z', 'vx', 'vy', 'vz', 'spin', 'grounded', 'inNet'].includes(key),
        'unsupported ball override',
      );
      assert.equal(typeof value, ['grounded', 'inNet'].includes(key) ? 'boolean' : 'number');
    }
    if (r.setup.carrierId !== undefined) assert.ok(integer(r.setup.carrierId) && r.setup.carrierId < 22);
    if (r.setup.lastTouch !== undefined) assert.ok([0, 1].includes(r.setup.lastTouch));
    if (r.setup.restart) {
      assert.ok(
        ['kickoff', 'corner', 'goal-kick', 'kick-in', 'free-kick', 'penalty'].includes(r.setup.restart.kind) &&
          [0, 1].includes(r.setup.restart.team),
      );
      point(r.setup.restart.at);
    }
  }
  for (const p of r.presence ?? [])
    assert.ok(
      integer(p.from) &&
        integer(p.to) &&
        p.from <= p.to &&
        p.to < r.frames &&
        p.seats.every((s) => Object.hasOwn(r.seats, s)),
    );
  return structuredClone(r);
}
export function loadRecording(name: string): Recording {
  assert.match(name, /^[a-z0-9-]+$/);
  return validateRecording(
    JSON.parse(readFileSync(new URL('../fixtures/soccer/' + name + '.json', import.meta.url), 'utf8')),
  );
}
export function commandsAt(r: Recording, frame: number): Map<number, Command> {
  return new Map(
    Object.keys(r.seats).map((s) => [
      Number(s),
      structuredClone(
        r.commands.find((v) => v.seat === Number(s) && v.from <= frame && v.to >= frame)?.command ?? {
          move: { x: 0, z: 0 },
        },
      ),
    ]),
  );
}
export function recordFrames(frames: readonly ReadonlyMap<number, Command>[]): Run[] {
  const runs: Run[] = [];
  frames.forEach((commands, frame) =>
    commands.forEach((command, seat) => {
      const prev = runs.findLast((r) => r.seat === seat);
      if (prev && prev.to === frame - 1 && JSON.stringify(prev.command) === JSON.stringify(command)) prev.to = frame;
      else runs.push({ from: frame, to: frame, seat, command: structuredClone(command) });
    }),
  );
  return runs;
}
export function createReplayWorld(input: Recording) {
  const r = validateRecording(input),
    w = createWorld(r.seed, r.halfLength, r.humans, r.clubs);
  for (const p of w.players) {
    p.human = Object.values(r.seats).includes(p.id);
    p.controlled = p.human;
    if (p.human) w.controlled[p.team] = p.id;
  }
  const s = r.setup;
  if (s?.name === 'live') {
    w.phase = 'live';
    w.restart = null;
  }
  if (s?.restart) setRestart(w, s.restart.team, s.restart.kind, s.restart.at);
  if (s?.park)
    for (const player of w.players) {
      Object.assign(player, { x: player.team === 0 ? -35 : 35, z: ((player.id % 11) - 5) * 5, vx: 0, vz: 0 });
    }
  for (const [id, p] of Object.entries(s?.players ?? {})) Object.assign(w.players[Number(id)]!, p);
  Object.assign(w.ball, s?.ball);
  if (s?.lastTouch !== undefined) w.lastTouch = s.lastTouch;
  if (s?.carrierId !== undefined) w.carrierId = s.carrierId;
  return w;
}
export function runReplay(input: Recording, onStep: (w: World, frame: number, paused: boolean) => void = () => {}) {
  const r = validateRecording(input);
  const w = createReplayWorld(r);
  let tick = 0;
  for (let frame = 0; frame < r.frames; frame++) {
    const present =
      r.presence?.find((p) => p.from <= frame && p.to >= frame)?.seats ?? Object.keys(r.seats).map(Number);
    const paused = missingPhoneSeats(Object.keys(r.seats).map(Number), present).length > 0;
    if (!paused) {
      const cpuRestart = r.cpuRestarts && w.phase === 'restart';
      for (const player of w.players) {
        player.human = !cpuRestart && Object.values(r.seats).includes(player.id);
        player.controlled = player.human;
      }
      const commands = computeAI(w, r.level, STEP, tick++);
      if (!cpuRestart) for (const [seat, c] of commandsAt(r, frame)) commands.set(r.seats[seat]!, c);
      stepWorld(w, STEP, commands);
    }
    onStep(w, frame, paused);
  }
  return w;
}
