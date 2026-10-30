import {
  chargePower,
  chooseShot,
  contactAccuracy,
  COURT_HALF_LENGTH,
  createFlight,
  HALF_SMASH_POWER,
  LOW_HEIGHT,
  OVERHEAD_HEIGHT,
  planShot,
  PLAYER_RUN_SPEED,
  pressuredAccuracy,
  RACKET_REACH,
  SMASH_MIN_HEIGHT,
  smashRecoveryMs,
  stepFlight,
  type Direction,
  type FlightState,
  type Intent,
  type Point2D,
  type ShotType,
} from './badminton.ts';

/**
 * The Agent level: the same body, reach, swing and charge as the player (see the Olympic level), with a mind that
 * learns the player. It never gets faster feet, quicker hands or a harder smash than a human has; it gets better by
 * choosing better. Within a few points it measures how quickly the opponent reacts and how fast they run, then picks
 * the stroke the opponent is least able to reach or punish. As the match goes on it also learns which strokes win
 * from each spot, when a full smash is worth winding up, and where to wait for each reply. Every match starts fresh.
 */

export type ContactBand = 'smash' | 'over' | 'mid' | 'low';
export type DepthBand = 'front' | 'mid' | 'back';
export type PowerArm = 'half' | 'full';
/** How a reply lands: short is a net shot or drop, fast a smash or drive, deep a clear or lift. */
export type ReplyKind = 'short' | 'fast' | 'deep';

/** Learned value of one choice: a and b are decayed Beta counts, tries and won are plain tallies for the summary. */
export type Arm = { a: number; b: number; tries: number; won: number };
export type ReplyHabit = { n: number; depth: number; short: number; fast: number; deep: number };

export type AgentBrain = {
  rallies: number;
  /** stroke choice per situation, keyed by contactKey */
  shots: Record<string, Partial<Record<Intent, Arm>>>;
  /** half or full smash, by how far from the net the Agent will be */
  smash: Partial<Record<DepthBand, Partial<Record<PowerArm, Arm>>>>;
  /** how the player answers each of the Agent's shots */
  replies: Partial<Record<ShotType, ReplyHabit>>;
  /** how quickly the player reacts and how fast they run, measured from their movement */
  opponent?: OpponentModel;
};

export type OpponentModel = { reactionMs: number; speed: number; reads: number };
/** Before it has seen you move, the Agent assumes you are as quick as anyone can be, and learns otherwise. */
const DEFAULT_OPPONENT: OpponentModel = { reactionMs: 80, speed: PLAYER_RUN_SPEED, reads: 0 };

type ShotRecord = { key: string; intent: Intent; smash?: { band: DepthBand; arm: PowerArm } };
/** A full smash the Agent means to wind up for the incoming shuttle, and when to start holding. */
export type ChargePlan = { band: DepthBand; arm: PowerArm; chargeAt: number; used: boolean };
/** Watching the opponent after the Agent's shot: when they start to respond, and their top speed. */
type Watch = { since: number; vx: number; reacted: boolean; top: number };
export type AgentRally = {
  shots: ShotRecord[];
  plan: ChargePlan | null;
  lastAgentShot: ShotType | null;
  abandoned: Array<{ band: DepthBand; arm: PowerArm }>;
  /** when to weigh up the shuttle in reach again */
  thinkAt: number;
  watch: Watch | null;
};

/** Older evidence fades so the Agent keeps up when the player changes style. */
const ARM_CAP = 30;
const HOME_DEFAULT = 2.6;
const INTENTS: Intent[] = ['normal', 'power', 'soft'];
const DEPTHS: DepthBand[] = ['front', 'mid', 'back'];

export function newBrain(): AgentBrain {
  return { rallies: 0, shots: {}, smash: {}, replies: {} };
}

export function newAgentRally(): AgentRally {
  return { shots: [], plan: null, lastAgentShot: null, abandoned: [], thinkAt: -Infinity, watch: null };
}

export function contactBand(y: number): ContactBand {
  if (y >= SMASH_MIN_HEIGHT) return 'smash';
  if (y >= OVERHEAD_HEIGHT) return 'over';
  if (y >= LOW_HEIGHT) return 'mid';
  return 'low';
}

export function depthBand(distanceFromNet: number): DepthBand {
  if (distanceFromNet < 2.4) return 'front';
  if (distanceFromNet > 4.4) return 'back';
  return 'mid';
}

export function replyKind(type: ShotType): ReplyKind {
  if (type === 'net' || type === 'drop' || type === 'serve') return 'short';
  if (type === 'smash' || type === 'drive') return 'fast';
  return 'deep';
}

/** The situation a stroke is chosen in. Overhead choices also depend on where the Agent stands, since a smash from the back is weaker. */
export function contactKey(contact: Point2D, playerDistanceFromNet: number): string {
  const band = contactBand(contact.y);
  const player = depthBand(playerDistanceFromNet);
  return band === 'smash' || band === 'over' ? `${band}|${depthBand(Math.abs(contact.x))}|${player}` : `${band}|${player}`;
}

/** What a sensible player would do before knowing anything about you: the Olympic level's habits. */
export function startingIntent(contact: Point2D, playerDistanceFromNet: number): Intent {
  const fromNet = Math.abs(contact.x);
  if (contact.y >= SMASH_MIN_HEIGHT && fromNet < 3.5) return 'power';
  if (playerDistanceFromNet > 3.5) return 'soft';
  return contact.y < LOW_HEIGHT ? 'power' : 'normal';
}

function gaussian(random: () => number) {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A draw from roughly Beta(a, b): try what looks best, but keep testing what is still uncertain. */
function sample(a: number, b: number, random: () => number) {
  const mean = a / (a + b);
  const spread = Math.sqrt((mean * (1 - mean)) / (a + b + 1));
  return mean + gaussian(random) * spread;
}

const valueOf = (arm: Arm | undefined, prior: [number, number]): [number, number] => [prior[0] + (arm?.a ?? 0), prior[1] + (arm?.b ?? 0)];

/** Picks the stroke for this contact: high, overhead, shoulder height or low, given where both players are. */
export function chooseIntent(brain: AgentBrain, contact: Point2D, playerDistanceFromNet: number, random: () => number = Math.random): Intent {
  const key = contactKey(contact, playerDistanceFromNet);
  const known = brain.shots[key] ?? {};
  // What worked at this height anywhere on court counts for half, so a lesson in one spot carries over until that spot has its own.
  const broad = brain.shots[contactBand(contact.y)] ?? {};
  const habit = startingIntent(contact, playerDistanceFromNet);
  let best: Intent = habit;
  let bestScore = -Infinity;
  for (const intent of INTENTS) {
    const prior: [number, number] = intent === habit ? [2.6, 1.4] : [1.4, 1.6];
    const pooled = broad[intent];
    const [a, b] = valueOf(known[intent], pooled ? [prior[0] + pooled.a * 0.5, prior[1] + pooled.b * 0.5] : prior);
    const score = sample(a, b, random);
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

/** Whether to wind up a full smash for a shuttle the Agent expects to meet this far from the net. */
export function choosePower(brain: AgentBrain, band: DepthBand, random: () => number = Math.random): PowerArm {
  const known = brain.smash[band] ?? {};
  const fullPrior: [number, number] = band === 'back' ? [1.5, 1.5] : [2.2, 1.4];
  const full = sample(...valueOf(known.full, fullPrior), random);
  const half = sample(...valueOf(known.half, [1.6, 1.4]), random);
  return full > half ? 'full' : 'half';
}

/** How a full hold is timed: started this long before the expected contact, so it peaks just as the racket meets the shuttle. */
const WIND_UP_MS = 620;

/**
 * Called as the player's shot leaves the racket. For a high shuttle the Agent may decide to wind up a full smash,
 * which also slows its feet while it holds, exactly as holding the hit slows the player.
 */
export function planForIncoming(brain: AgentBrain, rally: AgentRally, flight: FlightState, type: ShotType, clock: number, earliestMs: number, random: () => number = Math.random) {
  rally.plan = null;
  if (type !== 'clear' && type !== 'lift' && type !== 'high-serve') return;
  let preview = flight;
  for (let time = 0; time < 3; time += 1 / 120) {
    preview = stepFlight(preview, 1 / 120);
    if (preview.status !== 'flying') return;
    const { x, y, vy } = preview.shuttle;
    if (x * flight.direction > 0 && vy < 0 && y <= 2.7) {
      const band = depthBand(Math.abs(x));
      const arm = choosePower(brain, band, random);
      if (arm === 'full') rally.plan = { band, arm, chargeAt: Math.max(earliestMs, clock + time * 1000 - WIND_UP_MS), used: false };
      return;
    }
  }
}

export type AgentStroke = { type: ShotType; intent: Intent; accuracy: number; power: number };

/**
 * The Agent's stroke at contact, played by the player's rules: chooseShot from the intent and contact point,
 * accuracy from how cleanly the racket met the shuttle, and smash power only from how long it has been holding.
 */
export function agentStroke(
  brain: AgentBrain,
  rally: AgentRally,
  contact: Point2D,
  playerDistanceFromNet: number,
  contactDistance: number,
  pressure: number,
  heldMs: number | null,
  random: () => number = Math.random,
  chosen?: Intent,
): AgentStroke {
  const intent = chosen ?? chooseIntent(brain, contact, playerDistanceFromNet, random);
  const type = chooseShot(intent, contact);
  const power = type === 'smash' && heldMs !== null ? chargePower(heldMs) : HALF_SMASH_POWER;
  const record: ShotRecord = { key: contactKey(contact, playerDistanceFromNet), intent };
  if (type === 'smash') record.smash = { band: depthBand(Math.abs(contact.x)), arm: power >= 0.7 ? 'full' : 'half' };
  if (rally.plan && !rally.plan.used) {
    // A wind-up that ended in another stroke still taught the Agent something about that plan.
    if (type !== 'smash') rally.abandoned.push({ band: rally.plan.band, arm: rally.plan.arm });
    rally.plan.used = true;
  }
  rally.shots.push(record);
  return { type, intent, accuracy: pressuredAccuracy(contactAccuracy(contactDistance, RACKET_REACH), pressure), power };
}

/** Called when the player hits: remembers how they answered the Agent's last shot. */
export function recordReply(brain: AgentBrain, rally: AgentRally, replyType: ShotType, landingDistanceFromNet: number) {
  const to = rally.lastAgentShot;
  if (!to) return;
  const habit = brain.replies[to] ?? { n: 0, depth: HOME_DEFAULT + 1, short: 0, fast: 0, deep: 0 };
  // A running average that leans on the last 20 or so replies, so a change of style shows up within a game.
  const weight = 1 / Math.min(habit.n + 1, 20);
  habit.depth += (Math.max(0, Math.min(7, landingDistanceFromNet)) - habit.depth) * weight;
  habit.n = Math.min(habit.n + 1, 400);
  const decay = habit.n > 20 ? 0.95 : 1;
  habit.short *= decay;
  habit.fast *= decay;
  habit.deep *= decay;
  habit[replyKind(replyType)] += 1;
  brain.replies[to] = habit;
}

/** Where to wait, in metres from the net, after playing this shot: forward if you tend to answer it short, back if deep. */
export function agentHome(brain: AgentBrain, played: ShotType): number {
  const habit = brain.replies[played];
  if (!habit || habit.n < 2) return HOME_DEFAULT;
  const confidence = habit.n / (habit.n + 3);
  return Math.max(1.7, Math.min(4.3, HOME_DEFAULT + (habit.depth - 3.6) * 0.55 * confidence));
}

function reward(arm: Arm | undefined, value: number, won: boolean): Arm {
  const next = arm ? { ...arm } : { a: 0, b: 0, tries: 0, won: 0 };
  next.a += value;
  next.b += 1 - value;
  if (next.a + next.b > ARM_CAP) {
    const scale = ARM_CAP / (next.a + next.b);
    next.a *= scale;
    next.b *= scale;
  }
  next.tries += 1;
  if (won) next.won += 1;
  return next;
}

/**
 * Credits the Agent's strokes once the rally is over. The last two strokes carry the result;
 * earlier ones only learn that they kept the rally alive.
 */
export function recordRallyEnd(brain: AgentBrain, rally: AgentRally, agentWon: boolean) {
  settleWatch(brain, rally);
  const count = rally.shots.length;
  rally.shots.forEach((shot, index) => {
    const fromEnd = count - 1 - index;
    const value = fromEnd === 0 ? (agentWon ? 1 : 0) : fromEnd === 1 ? (agentWon ? 0.75 : 0.3) : 0.55;
    const decisive = fromEnd <= 1 && agentWon;
    for (const key of [shot.key, shot.key.split('|')[0]]) {
      const arms = brain.shots[key] ?? {};
      arms[shot.intent] = reward(arms[shot.intent], value, decisive);
      brain.shots[key] = arms;
    }
    if (shot.smash) {
      const smash = brain.smash[shot.smash.band] ?? {};
      smash[shot.smash.arm] = reward(smash[shot.smash.arm], value, decisive);
      brain.smash[shot.smash.band] = smash;
    }
  });
  // Winding up and then not getting a smash away, or never reaching the shuttle, counts against the wind-up.
  const missed = rally.plan && !rally.plan.used ? [{ band: rally.plan.band, arm: rally.plan.arm }] : [];
  for (const plan of [...rally.abandoned, ...missed]) {
    const smash = brain.smash[plan.band] ?? {};
    smash[plan.arm] = reward(smash[plan.arm], agentWon ? 0.5 : 0, false);
    brain.smash[plan.band] = smash;
  }
  brain.rallies += 1;
}

export function opponentModel(brain: AgentBrain): OpponentModel {
  return brain.opponent ?? DEFAULT_OPPONENT;
}

/** Called as the Agent's shot leaves the racket: start timing the opponent's response. */
export function startWatch(brain: AgentBrain, rally: AgentRally, clock: number, opponentVx: number) {
  settleWatch(brain, rally);
  rally.watch = { since: clock, vx: opponentVx, reacted: false, top: Math.abs(opponentVx) };
}

/** Called every step while the Agent's shot is in the air, with the opponent's running speed. */
export function observeOpponent(brain: AgentBrain, rally: AgentRally, clock: number, opponentVx: number) {
  const watch = rally.watch;
  if (!watch) return;
  watch.top = Math.max(watch.top, Math.abs(opponentVx));
  if (watch.reacted || Math.abs(opponentVx - watch.vx) < 1.2) return;
  watch.reacted = true;
  const model = { ...opponentModel(brain) };
  // Leans hard on the first few reads so a new opponent is sized up within a handful of points.
  const weight = 1 / Math.min(model.reads + 1.5, 6);
  model.reactionMs += (Math.max(40, Math.min(500, clock - watch.since)) - model.reactionMs) * weight;
  model.reads = Math.min(model.reads + 1, 1000);
  brain.opponent = model;
}

function settleWatch(brain: AgentBrain, rally: AgentRally) {
  const watch = rally.watch;
  rally.watch = null;
  if (!watch || watch.top < 2.5) return;
  const model = { ...opponentModel(brain) };
  model.speed += (Math.min(watch.top, 12) - model.speed) * (watch.top > model.speed ? 0.6 : 0.15);
  brain.opponent = model;
}

const fixedRandom = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** The highest a player's racket reaches with a full jump, and the lowest it can scoop. */
const TOP_RACKET = 1.2 + 1.09;
const LOW_RACKET = 1.2;

/**
 * How good this stroke is from here, 0 to 1, judged the way a player sizes up a shot: where it would go, and whether
 * the opponent, from where they stand and as quickly as they react and run, could get a racket on it.
 * 1 is a clean winner, 0 a shot into the net or out.
 */
export function shotValue(
  type: ShotType,
  direction: Direction,
  contact: Point2D,
  accuracy: number,
  power: number,
  opponent: { x: number; vx: number },
  model: OpponentModel,
  samples = 2,
  self?: { x: number; speed: number },
): number {
  const random = fixedRandom(7919);
  const opponentDirection = -direction as Direction;
  const near = opponentDirection > 0 ? -COURT_HALF_LENGTH - 0.3 : 0.55;
  const far = opponentDirection > 0 ? -0.55 : COURT_HALF_LENGTH + 0.3;
  const reaction = model.reactionMs / 1000;
  let total = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const plan = planShot(type, direction, contact, random, accuracy, { power });
    let flight = createFlight(contact, plan.velocity, 'b', direction);
    let best = -Infinity;
    // Opponents play the shuttle the first moment they can, so that moment decides whether they can attack it.
    let first: (Point2D & { speed: number; t: number }) | null = null;
    for (let step = 0; step < 360 && flight.status === 'flying'; step += 1) {
      flight = stepFlight(flight, 1 / 120);
      const { x, y } = flight.shuttle;
      if (x * direction < -0.12) continue;
      const lift = y > TOP_RACKET ? y - TOP_RACKET : y < LOW_RACKET ? LOW_RACKET - y : 0;
      if (lift > RACKET_REACH) continue;
      const reach = Math.sqrt(RACKET_REACH * RACKET_REACH - lift * lift);
      const needed = x - opponentDirection * 0.5;
      const stand = Math.max(near, Math.min(far, needed));
      const t = flight.elapsed;
      const start = opponent.x + opponent.vx * Math.min(t, reaction);
      const run = Math.max(0, model.speed * (t - reaction) - 0.3);
      const margin = run + reach - Math.abs(needed - stand) - Math.abs(stand - start);
      if (margin >= 0 && !first) first = { x, y, t, speed: Math.hypot(flight.shuttle.vx, flight.shuttle.vy) };
      best = Math.max(best, margin);
    }
    if (flight.status === 'fault') continue;
    let value = 1;
    if (first) {
      // What the opponent can do from where they first meet it: met high and close they smash it straight back,
      // met high and deep they can only clear or drop, met low they have to lift or push.
      // Close to the net even a shuttle at shoulder height can be pushed down for a winner.
      // A fast shuttle met that high can only be blocked, so only a slow one is a gift.
      const slow = first.speed < 14;
      const killable = slow && ((first.y >= SMASH_MIN_HEIGHT && Math.abs(first.x) < 4) || (first.y >= 1.55 && Math.abs(first.x) < 2.5));
      const base = killable ? 0.03 : first.y >= SMASH_MIN_HEIGHT ? 0.3 : first.y >= LOW_HEIGHT ? 0.4 : 0.5;
      // The less room they have to spare getting there, the more likely a weak reply.
      value = base + (0.9 - base) * Math.exp(-best / 0.5);
      if (self) {
        // Can the hitter get back to the net before a short reply lands there? A smash costs balance too.
        const recover = type === 'smash' ? smashRecoveryMs(power) / 1000 : 0;
        const time = first.t + 0.55;
        const run = self.speed * Math.max(0, time - recover) + self.speed * 0.5 * Math.min(time, recover) - 0.3;
        if (Math.abs(self.x) - 1.3 > run + RACKET_REACH) value *= 0.35;
      }
    }
    if (type === 'smash' && power >= 0.7) value = Math.min(1, value + 0.08);
    total += value;
  }
  return total / samples;
}

/** Whether the shuttle will be out of the racket's reach a moment from now, so it is now or never. */
export function lastChanceToHit(body: { x: number; vx: number; jump: number; jumpVelocity: number }, flight: FlightState, direction: Direction, aheadMs = 13): boolean {
  const next = stepFlight(flight, aheadMs / 1000);
  if (next.status !== 'flying') return true;
  const seconds = aheadMs / 1000;
  const racketX = body.x + direction * 0.5 + body.vx * seconds;
  const racketY = 1.2 + Math.max(0, body.jump + body.jumpVelocity * seconds);
  return Math.hypot(next.shuttle.x - racketX, next.shuttle.y - racketY) > RACKET_REACH;
}

export type DecideInput = {
  clock: number;
  contact: Point2D;
  direction: Direction;
  contactDistance: number;
  pressure: number;
  heldMs: number | null;
  opponent: { x: number; vx: number };
  lastChance: boolean;
  /** the racket is at its natural contact point (olympicContactReady): where a player meets the shuttle without waiting */
  ready: boolean;
};

/**
 * Called each step the shuttle is in reach. Weighs every stroke from here and plays the best one at the natural
 * contact point, or earlier if one is already a clean winner. Letting the shuttle drop for a better look only
 * hands the opponent time, so it never waits past that point.
 */
export function agentDecide(brain: AgentBrain, rally: AgentRally, input: DecideInput, random: () => number = Math.random): AgentStroke | null {
  const now = input.ready || input.lastChance;
  if (!now && input.clock < rally.thinkAt) return null;
  rally.thinkAt = input.clock + 20;
  const accuracy = pressuredAccuracy(contactAccuracy(input.contactDistance, RACKET_REACH), input.pressure);
  const power = input.heldMs !== null ? chargePower(input.heldMs) : HALF_SMASH_POWER;
  const model = opponentModel(brain);
  const playerDistance = Math.abs(input.opponent.x);
  const arms = brain.shots[contactKey(input.contact, playerDistance)] ?? {};
  let best: Intent = 'normal';
  let bestValue = -Infinity;
  for (const intent of INTENTS) {
    const type = chooseShot(intent, input.contact);
    const arm = arms[intent];
    // What has actually won against this player tips close calls.
    const record = arm ? (arm.a + 1) / (arm.a + arm.b + 2) - 0.5 : 0;
    const stroke = type === 'smash' ? power : HALF_SMASH_POWER;
    const self = { x: input.contact.x - input.direction * 0.5, speed: PLAYER_RUN_SPEED };
    const value = shotValue(type, input.direction, input.contact, accuracy, stroke, input.opponent, model, 2, self) + 0.1 * record;
    if (value > bestValue) {
      best = intent;
      bestValue = value;
    }
  }
  if (!now && bestValue < 0.9) return null;
  return agentStroke(brain, rally, input.contact, playerDistance, input.contactDistance, input.pressure, input.heldMs, random, best);
}

const SHOT_NAME: Partial<Record<ShotType, string>> = { clear: 'clears', drop: 'drops', smash: 'smashes', drive: 'drives', net: 'net shots', lift: 'lifts', serve: 'short serves', 'high-serve': 'high serves' };
const STROKE_NAME: Record<ContactBand, Record<Intent, string>> = {
  smash: { normal: 'Clears', power: 'Smashes', soft: 'Drops' },
  over: { normal: 'Clears', power: 'Drives', soft: 'Drops' },
  mid: { normal: 'Pushes', power: 'Drives', soft: 'Net shots' },
  low: { normal: 'Lifts', power: 'Lifts', soft: 'Net shots' },
};
const WHERE: Record<DepthBand, string> = { front: 'at the net', mid: 'mid court', back: 'at the back' };

/** Up to three plain sentences on what the Agent has picked up, strongest evidence first. */
export function agentInsights(brain: AgentBrain): string[] {
  const notes: Array<{ weight: number; text: string }> = [];
  for (const [played, habit] of Object.entries(brain.replies) as Array<[ShotType, ReplyHabit]>) {
    const total = habit.short + habit.fast + habit.deep;
    if (total < 4) continue;
    const [kind, count] = (Object.entries({ short: habit.short, fast: habit.fast, deep: habit.deep }) as Array<[ReplyKind, number]>).sort((x, y) => y[1] - x[1])[0];
    const share = count / total;
    if (share < 0.55) continue;
    const answer = kind === 'short' ? 'short' : kind === 'fast' ? 'hard and flat' : 'deep';
    const response = kind === 'short' ? 'so it waits closer to the net' : kind === 'deep' ? 'so it waits further back' : 'so it stays ready in mid court';
    notes.push({ weight: share * Math.min(total, 20), text: `You answer its ${SHOT_NAME[played]} ${answer} ${Math.round(share * 100)}% of the time, ${response}.` });
  }
  for (const [key, arms] of Object.entries(brain.shots)) {
    const parts = key.split('|');
    if (parts.length < 2) continue;
    const band = parts[0] as ContactBand;
    const player = parts[parts.length - 1] as DepthBand;
    for (const intent of INTENTS) {
      const arm = arms[intent];
      if (!arm || arm.tries < 4 || arm.won / arm.tries < 0.5) continue;
      notes.push({ weight: (arm.won / arm.tries) * Math.min(arm.tries, 20), text: `${STROKE_NAME[band][intent]} while you are ${WHERE[player]} have won it ${arm.won} of ${Math.round(arm.tries)} points.` });
    }
  }
  for (const band of DEPTHS) {
    const full = brain.smash[band]?.full;
    const half = brain.smash[band]?.half;
    if (!full || !half || full.tries < 3 || half.tries < 3) continue;
    const fullRate = full.won / full.tries;
    const halfRate = half.won / half.tries;
    if (Math.abs(fullRate - halfRate) < 0.15) continue;
    const better = fullRate > halfRate ? 'full' : 'half';
    notes.push({ weight: Math.abs(fullRate - halfRate) * 20, text: `From ${WHERE[band]}, its ${better} smashes trouble you more than its ${better === 'full' ? 'half' : 'full'} ones.` });
  }
  const model = brain.opponent;
  if (model && model.reads >= 3) {
    notes.push({ weight: 30, text: `You react in about ${(model.reactionMs / 1000).toFixed(2)} s and run up to ${model.speed.toFixed(1)} m/s, so it aims where you cannot get to in time.` });
  }
  return notes.sort((x, y) => y.weight - x.weight).slice(0, 3).map((note) => note.text);
}
