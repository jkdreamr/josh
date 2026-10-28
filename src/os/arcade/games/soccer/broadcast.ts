import { FIELD, TEAM_SIZE, distance, teamDir, teamOf, type Point, type Team, type World } from './logic.ts';
import { clubById, DEFAULT_CLUBS, rosterName } from './teams.ts';

export type Club = {
  name: string;
  short: string;
  abbr: string;
  primary: string;
  secondary: string;
  roster: readonly string[];
};

const DEFAULT_ROSTERS = [
  ['A. MORGAN', 'T. BENNETT', 'D. PARK', 'L. WILLIAMS', 'R. CHEN', 'S. PATEL', 'J. KIM', 'E. BROOKS', 'C. REYES', 'M. RIVERA', 'N. FOSTER'],
  ['I. CARTER', 'O. FOSTER', 'D. SINGH', 'T. WALKER', 'B. NGUYEN', 'H. PRICE', 'M. JONES', 'P. CLARKE', 'R. DIAZ', 'K. ALVAREZ', 'S. WARD'],
] as const;

const broadcastClub = (id: string, roster: readonly string[]): Club => {
  const club = clubById(id);
  return {
    name: club.name,
    short: club.short,
    abbr: club.short,
    primary: club.home.shirt,
    secondary: club.home.shorts,
    roster,
  };
};

export const CLUBS = [
  broadcastClub(DEFAULT_CLUBS[0], DEFAULT_ROSTERS[0]),
  broadcastClub(DEFAULT_CLUBS[1], DEFAULT_ROSTERS[1]),
] as const satisfies readonly [Club, Club];

export type TeamStats = {
  goals: number;
  shots: number;
  onTarget: number;
  passes: number;
  completed: number;
  tackles: number;
  fouls: number;
  corners: number;
  saves: number;
  xg: number;
  possession: number;
};

export type TickerKind = 'goal' | 'own-goal' | 'save' | 'corner' | 'foul' | 'offside' | 'yellow' | 'red' | 'penalty' | 'chance' | 'half-time' | 'full-time';
export type TickerItem = { id: number; minute: string; team: Team | null; kind: TickerKind; text: string; scorer?: number; assist?: number | null };
export type MatchStats = { teams: [TeamStats, TeamStats]; ticker: TickerItem[]; goals: TickerItem[]; added: [number | null, number | null]; version: number };

export const REGULAR = 45 / 48;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function playerName(id: number, world?: Pick<World, 'clubs'>): string {
  const team = teamOf(id);
  if (!world?.clubs || world.clubs[team] === DEFAULT_CLUBS[team]) return CLUBS[team].roster[id % TEAM_SIZE]!;
  return rosterName(clubById(world?.clubs?.[team] ?? DEFAULT_CLUBS[team]), id % TEAM_SIZE);
}

export function xgFor(world: World, shooter: Point, team: Team): number {
  const goal = { x: teamDir(team, world.endsSwapped) * FIELD.length / 2, z: 0 };
  const distanceToGoal = distance(shooter, goal);
  const firstPost = { x: goal.x - shooter.x, z: -FIELD.goalWidth / 2 - shooter.z };
  const secondPost = { x: goal.x - shooter.x, z: FIELD.goalWidth / 2 - shooter.z };
  const cross = firstPost.x * secondPost.z - firstPost.z * secondPost.x;
  const dot = firstPost.x * secondPost.x + firstPost.z * secondPost.z;
  const angle = Math.abs(Math.atan2(cross, dot));
  return clamp(1 / (1 + Math.exp(-(-1.1 + 1.6 * angle - 0.09 * distanceToGoal))), 0.01, 0.95);
}

const emptyTeam = (): TeamStats => ({
  goals: 0, shots: 0, onTarget: 0, passes: 0, completed: 0, tackles: 0,
  fouls: 0, corners: 0, saves: 0, xg: 0, possession: 0,
});

export function createMatchStats(): MatchStats {
  return { teams: [emptyTeam(), emptyTeam()], ticker: [], goals: [], added: [null, null], version: 0 };
}

export function broadcastClock(world: World, stats: MatchStats): { label: string; minute: string; added: number | null } {
  const half = world.half;
  const base = (half - 1) * 45;
  const frac = world.halfLength === 0 ? 1 : clamp((world.halfLength - world.clock) / world.halfLength, 0, 1);
  let totalSeconds: number;
  let minute: string;
  if (world.rules) {
    const gameSeconds = frac * 2700;
    const stoppage = world.rules.stoppage;
    if (stoppage) {
      const extraSeconds = stoppage.elapsed / (world.halfLength / 45) * 60;
      totalSeconds = (base + 45) * 60 + extraSeconds;
      minute = `${base + 45}+${Math.min(stoppage.minutes, Math.floor(extraSeconds / 60) + 1)}'`;
    } else {
      totalSeconds = base * 60 + gameSeconds;
      minute = `${Math.min(base + 45, Math.floor(base + gameSeconds / 60) + 1)}'`;
    }
  } else if (frac < REGULAR) {
    const gameSeconds = frac / REGULAR * 2700;
    totalSeconds = base * 60 + gameSeconds;
    minute = `${Math.min(base + 45, Math.floor(base + gameSeconds / 60) + 1)}'`;
  } else {
    const added = stats.added[half - 1] ?? 1;
    const extra = (frac - REGULAR) / (1 - REGULAR) * added * 60;
    totalSeconds = (base + 45) * 60 + extra;
    minute = `${base + 45}+${Math.min(added, Math.floor(extra / 60) + 1)}'`;
  }
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return {
    label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    minute,
    added: stats.added[half - 1],
  };
}

export function createStatsObserver() {
  const stats = createMatchStats();
  let initialized = false;
  let previousPhase: World['phase'] = 'restart';
  let previousScore: [number, number] = [0, 0];
  let previousEvent = '';
  let previousEventTime = 0;
  let previousActions = Array<string>(TEAM_SIZE * 2).fill('');
  let previousCooldowns = Array<number>(TEAM_SIZE * 2).fill(0);
  let previousSlideWon = Array<boolean>(TEAM_SIZE * 2).fill(false);
  let previousYellows = new Set<number>();
  let previousSentOff = Array<boolean>(TEAM_SIZE * 2).fill(false);
  let currentHalf: World['half'] = 1;
  let pendingPass: { team: Team; passer: number } | null = null;
  let pendingShot: { team: Team; shooter: number; xg: number } | null = null;
  let lastKicker: number | null = null;
  let lastCompletedPass: { passer: number; receiver: number; at: number } | null = null;
  let simTime = 0;
  let goalsThisHalf = 0;
  let stoppagesThisHalf = 0;
  let nextId = 1;

  const reset = () => {
    const empty = createMatchStats();
    stats.teams = empty.teams;
    stats.ticker.length = 0;
    stats.goals.length = 0;
    stats.added = [null, null];
    stats.version = 0;
    initialized = false;
    previousPhase = 'restart';
    previousScore = [0, 0];
    previousEvent = '';
    previousEventTime = 0;
    previousActions = Array<string>(TEAM_SIZE * 2).fill('');
    previousCooldowns = Array<number>(TEAM_SIZE * 2).fill(0);
    previousSlideWon = Array<boolean>(TEAM_SIZE * 2).fill(false);
    previousYellows = new Set<number>();
    previousSentOff = Array<boolean>(TEAM_SIZE * 2).fill(false);
    currentHalf = 1;
    pendingPass = null;
    pendingShot = null;
    lastKicker = null;
    lastCompletedPass = null;
    simTime = 0;
    goalsThisHalf = 0;
    stoppagesThisHalf = 0;
    nextId = 1;
  };

  const addTicker = (world: World, kind: TickerKind, team: Team | null, text: string, scorer?: number, assist?: number | null, goal = false) => {
    const item: TickerItem = {
      id: nextId++,
      minute: broadcastClock(world, stats).minute,
      team,
      kind,
      text,
      ...(scorer === undefined ? {} : { scorer }),
      ...(assist === undefined ? {} : { assist }),
    };
    stats.ticker.push(item);
    if (stats.ticker.length > 24) stats.ticker.splice(0, stats.ticker.length - 24);
    if (goal) stats.goals.push(item);
    stats.version++;
    return item;
  };

  const resolvePass = (receiver: number, now: number) => {
    if (!pendingPass || receiver === pendingPass.passer) return;
    if (teamOf(receiver) === pendingPass.team) {
      stats.teams[pendingPass.team].completed++;
      lastCompletedPass = { passer: pendingPass.passer, receiver, at: now };
    }
    pendingPass = null;
  };

  const observe = (world: World, dt: number) => {
    const now = simTime + Math.max(0, dt);
    if (!initialized) {
      initialized = true;
      previousPhase = world.phase;
      previousScore = [...world.score];
      previousEvent = world.event;
      previousEventTime = world.eventTime;
      currentHalf = world.half;
      for (const player of world.players) {
        previousActions[player.id] = player.action;
        previousCooldowns[player.id] = player.cooldown;
        previousSlideWon[player.id] = !!player.slide?.won;
        previousSentOff[player.id] = !!player.sentOff;
        stats.teams[player.team].goals = world.score[player.team];
      }
      previousYellows = new Set(world.rules?.yellows ?? []);
    }

    if (world.half !== currentHalf) {
      currentHalf = world.half;
      goalsThisHalf = 0;
      stoppagesThisHalf = 0;
    }

    const carrier = world.carrierId ?? null;
    if (world.phase === 'live') {
      const possessionTeam = carrier !== null ? teamOf(carrier) : world.lastTouch;
      stats.teams[possessionTeam].possession += Math.max(0, dt);
    }

    if (pendingPass && carrier !== null && carrier !== pendingPass.passer) resolvePass(carrier, now);

    const keeperContact = world.eventTime === 1.1
      && (world.event === 'keeper claims it' || world.event === 'keeper parries')
      && (previousEventTime !== 1.1 || previousEvent !== world.event);
    let savedThisStep = false;
    if (keeperContact && pendingShot && pendingShot.team !== world.lastTouch) {
      stats.teams[pendingShot.team].onTarget++;
      const keeperTeam = (1 - pendingShot.team) as Team;
      stats.teams[keeperTeam].saves++;
      const keeperId = world.lastToucherId ?? world.players.find((player) => player.team === keeperTeam && player.slot === 'GK')?.id;
      addTicker(world, 'save', keeperTeam, `save by ${keeperId === undefined ? 'keeper' : playerName(keeperId, world)}`);
      pendingShot = null;
      savedThisStep = true;
    }

    let scored = false;
    for (const team of [0, 1] as const) {
      const goals = world.score[team] - previousScore[team];
      if (goals <= 0) continue;
      stats.teams[team].goals = world.score[team];
      for (let count = 0; count < goals; count++) {
        if (pendingShot?.team === team) stats.teams[team].onTarget++;
        const scorer = lastKicker ?? world.lastToucherId ?? undefined;
        const isGoal = scorer !== undefined && teamOf(scorer) === team;
        const kind: TickerKind = isGoal ? 'goal' : 'own-goal';
        const assist = isGoal && scorer !== undefined && lastCompletedPass?.receiver === scorer && now - lastCompletedPass.at < 12
          ? lastCompletedPass.passer
          : null;
        const text = `${isGoal ? 'goal' : 'own goal'}, ${scorer === undefined ? 'unknown player' : playerName(scorer, world)}`;
        addTicker(world, kind, team, text, scorer, assist, true);
        goalsThisHalf++;
        scored = true;
      }
      pendingShot = null;
      pendingPass = null;
    }
    previousScore = [...world.score];

    const kick = world.kickEvent;
    if (kick) {
      lastKicker = kick.playerId;
      if (pendingPass && pendingPass.passer !== kick.playerId) resolvePass(kick.playerId, now);
      const team = teamOf(kick.playerId);
      if (kick.action === 'shoot' || kick.action === 'finesse') {
        const shooter = world.players[kick.playerId]!;
        const xg = xgFor(world, shooter, team);
        stats.teams[team].shots++;
        stats.teams[team].xg += xg;
        pendingShot = { team, shooter: kick.playerId, xg };
        if (xg >= 0.35) addTicker(world, 'chance', team, `big chance, ${playerName(kick.playerId, world)}`);
      } else if (kick.action === 'pass' || kick.action === 'through' || kick.action === 'lob') {
        stats.teams[team].passes++;
        pendingPass = { team, passer: kick.playerId };
      }
    }

    for (const player of world.players) {
      if (player.action === 'tackle' && previousActions[player.id] !== 'tackle') stats.teams[player.team].tackles++;
      if (player.slide?.won && !previousSlideWon[player.id]) stats.teams[player.team].tackles++;
      previousActions[player.id] = player.action;
      previousCooldowns[player.id] = player.cooldown;
      previousSlideWon[player.id] = !!player.slide?.won;
    }

    if (world.rules) {
      for (const team of [0, 1] as const) {
        const fouls = world.rules.stats.fouls[team];
        if (stats.teams[team].fouls !== fouls) {
          stats.teams[team].fouls = fouls;
          stats.version++;
        }
      }
    }

    if (pendingShot && ((carrier !== null && teamOf(carrier) !== pendingShot.team && !savedThisStep)
      || (world.phase !== 'live' && !scored))) pendingShot = null;

    if (previousPhase === 'live' && world.phase === 'restart') {
      pendingPass = null;
      pendingShot = null;
      if (world.restart !== 'kickoff') {
        stoppagesThisHalf++;
        if (world.restart === 'corner') {
          stats.teams[world.restartTeam].corners++;
          addTicker(world, 'corner', world.restartTeam, `corner, ${clubById(world.clubs?.[world.restartTeam] ?? DEFAULT_CLUBS[world.restartTeam]).short.toLowerCase()}`);
        } else if (world.restart === 'free-kick') {
          const offendingTeam = (1 - world.restartTeam) as Team;
          if (!world.rules) stats.teams[offendingTeam].fouls++;
          if (world.rules && world.event === 'offside') {
            addTicker(world, 'offside', offendingTeam, `offside, ${clubById(world.clubs?.[offendingTeam] ?? DEFAULT_CLUBS[offendingTeam]).short.toLowerCase()}`);
          } else {
            addTicker(world, 'foul', world.restartTeam, `foul, ${clubById(world.clubs?.[world.restartTeam] ?? DEFAULT_CLUBS[world.restartTeam]).short.toLowerCase()}`);
          }
        } else if (world.restart === 'penalty') {
          if (!world.rules) stats.teams[1 - world.restartTeam].fouls++;
          addTicker(world, 'penalty', world.restartTeam, `penalty, ${clubById(world.clubs?.[world.restartTeam] ?? DEFAULT_CLUBS[world.restartTeam]).short.toLowerCase()}`);
        }
      }
    }

    if (world.rules) {
      for (const id of world.rules.yellows) {
        if (previousYellows.has(id)) continue;
        const player = world.players.find((candidate) => candidate.id === id);
        if (player) addTicker(world, 'yellow', player.team, `yellow card, ${playerName(id, world)}`);
      }
      for (const player of world.players) {
        if (!previousSentOff[player.id] && player.sentOff) {
          const kind = previousYellows.has(player.id) ? 'second yellow' : 'red card';
          addTicker(world, 'red', player.team, `${kind}, ${playerName(player.id, world)}`);
        }
      }
      previousYellows = new Set(world.rules.yellows);
    }
    for (const player of world.players) previousSentOff[player.id] = !!player.sentOff;

    if (previousPhase !== 'half-time' && world.phase === 'half-time') {
      addTicker(world, 'half-time', null, `half time, ${clubById(world.clubs?.[0] ?? DEFAULT_CLUBS[0]).short} ${world.score[0]}-${world.score[1]} ${clubById(world.clubs?.[1] ?? DEFAULT_CLUBS[1]).short}`);
    }
    if (previousPhase !== 'full-time' && world.phase === 'full-time') {
      addTicker(world, 'full-time', null, `full time, ${clubById(world.clubs?.[0] ?? DEFAULT_CLUBS[0]).short} ${world.score[0]}-${world.score[1]} ${clubById(world.clubs?.[1] ?? DEFAULT_CLUBS[1]).short}`);
    }

    if (world.rules) {
      const stoppage = world.rules.stoppage;
      if (stoppage && stats.added[world.half - 1] !== stoppage.minutes) {
        stats.added[world.half - 1] = stoppage.minutes;
        stats.version++;
      }
    } else {
      const frac = world.halfLength === 0 ? 1 : clamp((world.halfLength - world.clock) / world.halfLength, 0, 1);
      if (frac >= REGULAR - 1 / 48 && stats.added[world.half - 1] === null) {
        stats.added[world.half - 1] = clamp(1 + goalsThisHalf + Math.floor(stoppagesThisHalf / 6), 1, 5);
        stats.version++;
      }
    }

    previousPhase = world.phase;
    previousEvent = world.event;
    previousEventTime = world.eventTime;
    simTime = now;
    return stats;
  };

  return { stats, observe, reset };
}

export function possessionShare(stats: MatchStats): [number, number] {
  const total = stats.teams[0].possession + stats.teams[1].possession;
  if (total <= 0) return [50, 50];
  const home = Math.round(stats.teams[0].possession / total * 100);
  return [home, 100 - home];
}

export function passAccuracy(team: TeamStats): number {
  return team.passes > 0 ? Math.round(team.completed / team.passes * 100) : 0;
}
