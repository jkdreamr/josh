import {
  distance, FIELD, FORMATION, matchClock, nearestCarrier, setRestart, teamDir, transferControl,
  type Player, type Point, type Team, type World,
} from './logic.ts';

export type Card = 'yellow' | 'red' | 'second-yellow';
export type RulesState = {
  offside: boolean;
  snapshot: { team: Team; passerId: number; flagged: number[] } | null;
  indirect: { team: Team; takerId: number | null } | null;
  advantage: { team: Team; at: Point; offenderId: number; victimId: number; card: Card | null; t: number } | null;
  pendingCard: { playerId: number; card: Card } | null;
  yellows: number[];
  banner: { kind: 'offside' | 'advantage' | Card; team: Team; playerId: number; x: number; t: number } | null;
  added: number;
  board: { minutes: number; t: number } | null;
  stoppage: { minutes: number; left: number; elapsed: number; hold: number } | null;
  stats: { fouls: [number, number]; yellows: [number, number]; reds: [number, number]; offsides: [number, number] };
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const validTeam = (v: unknown): v is Team => v === 0 || v === 1;
const validId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 22;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validCard = (v: unknown): v is Card => v === 'yellow' || v === 'red' || v === 'second-yellow';

export function createRules(): RulesState {
  return {
    offside: true, snapshot: null, indirect: null, advantage: null, pendingCard: null, yellows: [],
    banner: null, added: 0, board: null, stoppage: null,
    stats: { fouls: [0, 0], yellows: [0, 0], reds: [0, 0], offsides: [0, 0] },
  };
}

function state(world: World) {
  return world.rules ??= createRules();
}

function addTime(world: World, minutes: number) {
  const rules = state(world);
  rules.added += minutes;
  if (rules.stoppage) rules.stoppage.left += minutes * world.halfLength / 45;
}

export function validRules(value: unknown): value is RulesState | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<RulesState>;
  const validIds = (ids: unknown, max = 22) => Array.isArray(ids) && ids.length <= max
    && ids.every(validId) && new Set(ids).size === ids.length;
  const validPoint = (p: unknown) => !!p && typeof p === 'object'
    && finite((p as Point).x) && Math.abs((p as Point).x) <= FIELD.length / 2 + 2
    && finite((p as Point).z) && Math.abs((p as Point).z) <= FIELD.width / 2 + 2;
  const validCardRecord = (v: unknown) => {
    if (v === null) return true;
    if (!v || typeof v !== 'object') return false;
    const card = v as { playerId?: unknown; card?: unknown };
    return validId(card.playerId) && validCard(card.card);
  };
  const added = r.added;
  if (typeof r.offside !== 'boolean' || !Array.isArray(r.yellows) || !validIds(r.yellows)
    || !finite(added) || added < 0 || added > 100
    || !r.stats || !Array.isArray(r.stats.fouls) || !Array.isArray(r.stats.yellows)
    || !Array.isArray(r.stats.reds) || !Array.isArray(r.stats.offsides)) return false;
  if (![r.stats.fouls, r.stats.yellows, r.stats.reds, r.stats.offsides].every((values) =>
    values.length === 2 && values.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000))) return false;
  if (r.snapshot !== null) {
    const snapshot = r.snapshot as RulesState['snapshot'];
    if (!snapshot || !validTeam(snapshot.team) || !validId(snapshot.passerId) || !validIds(snapshot.flagged)) return false;
  }
  if (r.indirect !== null) {
    const indirect = r.indirect as RulesState['indirect'];
    if (!indirect || !validTeam(indirect.team) || indirect.takerId !== null && !validId(indirect.takerId)) return false;
  }
  if (r.advantage !== null) {
    const advantage = r.advantage as RulesState['advantage'];
    if (!advantage || !validTeam(advantage.team) || !validPoint(advantage.at) || !validId(advantage.offenderId)
      || !validId(advantage.victimId) || advantage.card !== null && !validCard(advantage.card)
      || !finite(advantage.t) || advantage.t < 0 || advantage.t > 3) return false;
  }
  if (!validCardRecord(r.pendingCard)) return false;
  if (r.banner !== null) {
    const banner = r.banner as RulesState['banner'];
    if (!banner || !validTeam(banner.team) || !validId(banner.playerId) || !finite(banner.x)
      || Math.abs(banner.x) > FIELD.length / 2 + 2 || !finite(banner.t) || banner.t < 0 || banner.t > 3
      || !(['offside', 'advantage', 'yellow', 'red', 'second-yellow'] as unknown[]).includes(banner.kind)) return false;
  }
  if (r.stoppage !== null) {
    const stoppage = r.stoppage as RulesState['stoppage'];
    if (!stoppage || !Number.isInteger(stoppage.minutes) || stoppage.minutes < 1 || stoppage.minutes > 5
      || !finite(stoppage.left) || stoppage.left < -100 || stoppage.left > 100
      || !finite(stoppage.elapsed) || stoppage.elapsed < 0 || stoppage.elapsed > 100
      || !finite(stoppage.hold) || stoppage.hold < 0 || stoppage.hold > 8) return false;
  }
  if (r.board !== null) {
    const board = r.board as RulesState['board'];
    if (!board || !Number.isInteger(board.minutes) || board.minutes < 1 || board.minutes > 5
      || !finite(board.t) || board.t < 0 || board.t > 4) return false;
  }
  return true;
}

function active(player: Player) {
  return !player.sentOff;
}

function secondLastProgress(world: World, team: Team) {
  const dir = teamDir(team, world.endsSwapped);
  const defenders = world.players.filter((p) => p.team !== team && active(p))
    .map((p) => p.x * dir).sort((a, b) => b - a);
  return defenders[1] ?? defenders[0] ?? 0;
}

export function offsideLine(world: World, team: Team) {
  const dir = teamDir(team, world.endsSwapped);
  return Math.max(secondLastProgress(world, team), world.ball.x * dir, 0);
}

export function offsidePosition(world: World, player: Player) {
  const rules = state(world);
  if (!rules.offside || !active(player)) return false;
  const dir = teamDir(player.team, world.endsSwapped);
  const progress = player.x * dir;
  return progress > 0 && progress > world.ball.x * dir + 0.1 && progress > secondLastProgress(world, player.team) + 0.1;
}

export function noteKick(world: World, player: Player, _action: string) {
  const rules = state(world);
  const restart = world.restart;
  if (!rules.offside || restart === 'kick-in' || restart === 'goal-kick' || restart === 'corner'
    || restart === 'penalty' || restart === 'kickoff') {
    rules.snapshot = null;
    return;
  }
  rules.snapshot = {
    team: player.team,
    passerId: player.id,
    flagged: world.players.filter((p) => p.team === player.team && active(p) && offsidePosition(world, p)).map((p) => p.id),
  };
}

function callOffside(world: World, player: Player, team: Team) {
  const rules = state(world);
  const defending = team === 0 ? 1 : 0;
  setRestart(world, defending, 'free-kick', player);
  world.event = 'offside';
  world.eventTime = 2;
  rules.indirect = { team: defending, takerId: null };
  rules.banner = { kind: 'offside', team, playerId: player.id, x: player.x, t: 2.6 };
  rules.stats.offsides[team]++;
  addTime(world, 0.15);
}

export function checkOffside(world: World, carrier: Player | undefined) {
  const rules = state(world);
  const snapshot = rules.snapshot;
  if (!snapshot) return;
  const toucher = world.lastToucherId == null ? undefined : world.players.find((p) => p.id === world.lastToucherId);
  if (toucher && toucher.team !== snapshot.team && toucher.slot !== 'GK' && active(toucher)) {
    rules.snapshot = null;
    return;
  }
  if (!carrier) return;
  if (carrier.slot === 'GK') return;
  if (carrier.team === snapshot.team && carrier.id !== snapshot.passerId && snapshot.flagged.includes(carrier.id)) {
    callOffside(world, carrier, snapshot.team);
    return;
  }
  rules.snapshot = null;
}

export function clearOffside(world: World) {
  state(world).snapshot = null;
}

export function noteRestart(world: World, restart: NonNullable<World['restart']>) {
  if (restart === 'free-kick') addTime(world, 0.25);
  else if (restart === 'penalty') addTime(world, 0.5);
  else if (restart === 'kick-in' || restart === 'corner' || restart === 'goal-kick') addTime(world, 0.08);
}

export function noteGoal(world: World) {
  const rules = state(world);
  addTime(world, 0.5);
  rules.snapshot = null;
  rules.indirect = null;
  finishAdvantage(world, true);
  applyStoppageCard(world);
}

export function noteTouch(world: World, playerId: number) {
  const indirect = state(world).indirect;
  if (indirect?.takerId !== null && indirect?.takerId !== undefined && indirect.takerId !== playerId) {
    state(world).indirect = null;
  }
}

export function indirectBlocksGoal(world: World) {
  const indirect = state(world).indirect;
  return !!indirect && indirect.takerId !== null && indirect.takerId === world.lastToucherId;
}

export function noteIndirectKick(world: World, restart: World['restart'], team: Team, takerId: number) {
  const indirect = state(world).indirect;
  if (restart === 'free-kick' && indirect?.team === team) indirect.takerId = takerId;
}

export function approachAngle(offender: Player, victim: Player) {
  const from = Math.atan2(offender.x - victim.x, offender.z - victim.z);
  return Math.abs(Math.atan2(Math.sin(victim.facing - from), Math.cos(victim.facing - from)));
}

function penaltyArea(world: World, player: Player, team: Team) {
  const ownGoal = -teamDir(team, world.endsSwapped) * FIELD.length / 2;
  return Math.abs(player.x - ownGoal) <= FIELD.penaltyDepth && Math.abs(player.z) <= FIELD.penaltyWidth / 2;
}

function dogso(world: World, offender: Player, victim: Player) {
  const dir = teamDir(victim.team, world.endsSwapped);
  const goal = { x: dir * FIELD.length / 2, z: 0 };
  const speed = Math.hypot(victim.vx, victim.vz);
  const movingTowardGoal = speed > 0 && (victim.vx * dir) / speed > 0.3;
  const facingTowardGoal = Math.sin(victim.facing) * dir > 0.3;
  const goalSideOpponent = world.players.some((p) => p.team !== victim.team && p.id !== offender.id && active(p)
    && p.slot !== 'GK' && p.x * dir > victim.x * dir && Math.abs(p.z - victim.z) < 12);
  const attacking = victim.x * dir > 0 || world.lastTouch === victim.team;
  return attacking && distance(victim, world.ball) <= 1.5 && distance(victim, goal) <= 25
    && (movingTowardGoal || facingTowardGoal) && !goalSideOpponent;
}

export function gradeFoul(world: World, offender: Player, victim: Player, kind: 'tackle' | 'slide', ballContact: boolean) {
  const angle = approachAngle(offender, victim);
  const points = (kind === 'slide' ? 2 : 0) + (angle > 1.9 ? 2 : angle > 1.3 ? 1 : 0)
    + (Math.hypot(offender.vx, offender.vz) > 7.5 ? 1 : 0) + (!ballContact ? 1 : 0);
  const isDogso = dogso(world, offender, victim);
  let card: Card | null = points >= 6 ? 'red' : points >= 4 ? 'yellow' : null;
  if (isDogso) card = penaltyArea(world, victim, offender.team) && (kind === 'tackle' || ballContact) ? 'yellow' : 'red';
  if (card === 'yellow' && state(world).yellows.includes(offender.id)) card = 'second-yellow';
  return { points, card, dogso: isDogso };
}

function canPlayAdvantage(world: World, offender: Player, victim: Player, isDogso: boolean) {
  if (isDogso || penaltyArea(world, victim, offender.team) || world.ball.y > 0.75
    || world.ball.x * teamDir(victim.team, world.endsSwapped) < 0) return false;
  const nearest = world.players.filter(active).sort((a, b) => distance(a, world.ball) - distance(b, world.ball))[0];
  if (!nearest || nearest.team !== victim.team || distance(nearest, world.ball) > 1.5) return false;
  if (world.players.some((p) => p.team === offender.team && active(p) && distance(p, world.ball) <= 1.5)) return false;
  return world.players.filter((p) => p.team === offender.team && p.id !== offender.id && active(p)
    && distance(p, world.ball) <= 4).length <= 1;
}

export function onFoul(world: World, offender: Player, victim: Player, kind: 'tackle' | 'slide', ballContact: boolean): 'stop' | 'advantage' {
  const rules = state(world);
  const grade = gradeFoul(world, offender, victim, kind, ballContact);
  rules.stats.fouls[offender.team]++;
  if (canPlayAdvantage(world, offender, victim, grade.dogso)) {
    rules.advantage = { team: victim.team, at: { x: victim.x, z: victim.z }, offenderId: offender.id, victimId: victim.id, card: grade.card, t: 3 };
    rules.banner = { kind: 'advantage', team: victim.team, playerId: victim.id, x: victim.x, t: 3 };
    world.lastTouch = victim.team;
    world.lastToucherId = victim.id;
    return 'advantage';
  }
  if (grade.card) rules.pendingCard = { playerId: offender.id, card: grade.card };
  return 'stop';
}

export function applyStoppageCard(world: World) {
  const rules = state(world);
  const pending = rules.pendingCard;
  if (!pending) return;
  rules.pendingCard = null;
  const player = world.players.find((p) => p.id === pending.playerId);
  if (!player) return;
  const card = pending.card;
  const kind = card;
  if (card === 'yellow' || card === 'second-yellow') {
    if (!rules.yellows.includes(player.id)) rules.yellows.push(player.id);
    rules.stats.yellows[player.team]++;
  }
  if (card !== 'yellow') rules.stats.reds[player.team]++;
  addTime(world, card === 'yellow' ? 0.5 : 0.75);
  rules.banner = { kind, team: player.team, playerId: player.id, x: player.x, t: 2.6 };
  if (card !== 'yellow') sendOff(world, player);
}

function formationIndex(world: World, player: Player) {
  return player.formation ?? world.players.filter((p) => p.team === player.team).indexOf(player);
}

function swapOutfieldFormation(world: World, player: Player) {
  const originalSlot = player.slot;
  const originalFormation = formationIndex(world, player);
  if (originalSlot === 'GK') {
    const fallback = ['ST', 'LW', 'RW'] as const;
    let replacement = fallback.map((slot) => world.players.find((p) => p.team === player.team && active(p) && p.slot === slot)).find(Boolean);
    if (!replacement) replacement = world.players.filter((p) => p.team === player.team && active(p) && p.slot === 'CM')
      .sort((a, b) => formationIndex(world, b) - formationIndex(world, a))[0];
    if (!replacement) return;
    const replacedSlot = replacement.slot;
    const replacedFormation = formationIndex(world, replacement);
    replacement.slot = 'GK';
    replacement.formation = 0;
    player.slot = replacedSlot;
    player.formation = replacedFormation;
    return;
  }
  if (!['LB', 'CB', 'RB', 'CM'].includes(originalSlot)) return;
  const spot = FORMATION[originalFormation]?.z ?? 0;
  const desired: Player['slot'] = spot < 0 ? 'LW' : spot > 0 ? 'RW' : 'ST';
  const fallback = desired === 'LW' ? ['ST', 'RW'] : desired === 'RW' ? ['ST', 'LW'] : ['LW', 'RW'];
  let replacement = world.players.find((p) => p.team === player.team && active(p) && p.slot === desired);
  for (const slot of fallback) replacement ??= world.players.find((p) => p.team === player.team && active(p) && p.slot === slot);
  if (!replacement) return;
  const replacedSlot = replacement.slot;
  const replacedFormation = formationIndex(world, replacement);
  replacement.slot = originalSlot;
  replacement.formation = originalFormation;
  player.slot = replacedSlot;
  player.formation = replacedFormation;
}

export function sendOff(world: World, player: Player) {
  const wasHuman = player.human || player.controlled;
  const wasSelected = world.controlled[player.team] === player.id;
  player.sentOff = true;
  player.human = false;
  player.controlled = false;
  const team = player.team;
  const replacement = world.players.filter((p) => p.team === team && active(p))
    .sort((a, b) => distance(a, player) - distance(b, player))[0];
  if (replacement && wasHuman) transferControl(world, team, replacement.id);
  else if (replacement && wasSelected) world.controlled[team] = replacement.id;
  swapOutfieldFormation(world, player);
  const count = world.players.filter((p) => p.team === team && p.sentOff).length - 1;
  player.x = (team === 0 ? -1 : 1) * (4 + 1.2 * Math.max(0, count));
  player.z = -(FIELD.width / 2 + 1.5);
  player.vx = 0;
  player.vz = 0;
  player.action = 'idle';
  player.slide = null;
  player.buffer = null;
  player.touchCd = 0;
}

export function finishAdvantage(world: World, apply = false) {
  const rules = state(world);
  const advantage = rules.advantage;
  if (!advantage) return;
  rules.advantage = null;
  if (rules.banner?.kind === 'advantage') rules.banner = null;
  if (advantage.card) rules.pendingCard = { playerId: advantage.offenderId, card: advantage.card };
  if (apply) applyStoppageCard(world);
}

export function rulesStep(world: World, dt: number) {
  const rules = state(world);
  if (rules.board) {
    rules.board.t = Math.max(0, rules.board.t - dt);
    if (rules.board.t <= 0) rules.board = null;
  }
  const advantage = rules.advantage;
  if (advantage) {
    advantage.t = Math.max(0, advantage.t - dt);
    const fizzled = world.phase === 'live' && world.lastTouch !== advantage.team
      || world.phase === 'restart' && world.restartTeam !== advantage.team;
    if (fizzled) {
      rules.advantage = null;
      if (rules.banner?.kind === 'advantage') rules.banner = null;
      if (advantage.card) rules.pendingCard = { playerId: advantage.offenderId, card: advantage.card };
      setRestart(world, advantage.team, 'free-kick', advantage.at);
      world.event = 'foul';
      world.eventTime = 2;
      applyStoppageCard(world);
      return;
    }
    if (advantage.t <= 0 || world.phase !== 'live') {
      finishAdvantage(world, world.phase !== 'live');
    } else if (rules.banner?.kind === 'advantage') rules.banner.t = advantage.t;
  }
  if (rules.banner && rules.banner.kind !== 'advantage') {
    rules.banner.t = Math.max(0, rules.banner.t - dt);
    if (rules.banner.t <= 0) rules.banner = null;
  } else if (rules.banner?.kind === 'advantage' && !rules.advantage) {
    rules.banner = null;
  }
}

export function halfOver(world: World, clockStep: number) {
  const rules = state(world);
  if (!rules.stoppage) {
    const minutes = clamp(Math.round(rules.added), 0, 5);
    if (!minutes) {
      rules.added = 0;
      rules.board = null;
      return true;
    }
    rules.stoppage = { minutes, left: minutes * world.halfLength / 45, elapsed: 0, hold: 0 };
    rules.board = { minutes, t: 4 };
    return false;
  }
  const stoppage = rules.stoppage;
  stoppage.left -= clockStep;
  stoppage.elapsed += clockStep;
  if (stoppage.left > 0) return false;
  const dir = teamDir(world.lastTouch, world.endsSwapped);
  const inPenaltyArea = Math.abs(world.ball.x - dir * (FIELD.length / 2 - FIELD.penaltyDepth / 2)) < FIELD.penaltyDepth / 2
    && Math.abs(world.ball.z) < FIELD.penaltyWidth / 2;
  const attackingBox = world.phase === 'live' && inPenaltyArea;
  if (attackingBox && stoppage.hold < 8) {
    stoppage.hold = Math.min(8, stoppage.hold + clockStep);
    return false;
  }
  rules.added = 0;
  rules.stoppage = null;
  rules.board = null;
  return true;
}

export function clockLabel(world: World) {
  const stoppage = state(world).stoppage;
  if (!stoppage) return `${matchClock(world)}`;
  const extra = Math.min(stoppage.minutes, Math.floor(stoppage.elapsed / (world.halfLength / 45)) + 1);
  return `${world.half === 1 ? 45 : 90}+${extra}`;
}

export function onsideProgress(world: World, player: Player, progress: number) {
  const rules = state(world);
  const carrier = nearestCarrier(world);
  if (!rules.offside || world.passTarget === player.id || carrier && carrier.team !== player.team) return progress;
  return Math.min(progress, Math.max(offsideLine(world, player.team) - 0.15, 0));
}

export function stepUpLine(world: World, player: Player, progress: number) {
  if (!state(world).offside) return progress;
  const carrier = nearestCarrier(world);
  if (!carrier || carrier.team === player.team || carrier.sentOff) return progress;
  const dir = teamDir(player.team, world.endsSwapped);
  if (carrier.x * dir + FIELD.length / 2 < 20) return progress;
  const opponentDir = teamDir(carrier.team, world.endsSwapped);
  const backPass = world.ball.vx * -opponentDir > 3;
  const facingOwnHalf = Math.sin(carrier.facing) * -opponentDir > 0.3;
  if (!backPass && !facingOwnHalf) return progress;
  return Math.min(progress + 4, world.ball.x * dir - 3);
}

export function cpuMayTackle(world: World, player: Player, opponent: Player) {
  const fromBehind = approachAngle(player, opponent) > 1.9;
  return !fromBehind || opponent.x * teamDir(player.team, world.endsSwapped) < -FIELD.length / 6;
}
