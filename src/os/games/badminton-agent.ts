import {
  chargePower,
  chooseShot,
  contactAccuracy,
  HALF_SMASH_POWER,
  LOW_HEIGHT,
  OVERHEAD_HEIGHT,
  pressuredAccuracy,
  RACKET_REACH,
  SMASH_MIN_HEIGHT,
  stepFlight,
  type FlightState,
  type Intent,
  type Point2D,
  type ShotType,
} from './badminton.ts';

/**
 * The Agent level: the same body, reach, swing and charge as the player (see the Olympic level), with a mind that
 * learns the player's habits. It never gets faster feet, quicker hands or a harder smash than a human has; it gets
 * better by choosing better: which stroke beats you from each spot, when a full smash is worth winding up, and where
 * to wait for your reply.
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
  version: 1;
  rallies: number;
  /** stroke choice per situation, keyed by contactKey */
  shots: Record<string, Partial<Record<Intent, Arm>>>;
  /** half or full smash, by how far from the net the Agent will be */
  smash: Partial<Record<DepthBand, Partial<Record<PowerArm, Arm>>>>;
  /** how the player answers each of the Agent's shots */
  replies: Partial<Record<ShotType, ReplyHabit>>;
};

type ShotRecord = { key: string; intent: Intent; smash?: { band: DepthBand; arm: PowerArm } };
/** A full smash the Agent means to wind up for the incoming shuttle, and when to start holding. */
export type ChargePlan = { band: DepthBand; arm: PowerArm; chargeAt: number; used: boolean };
export type AgentRally = { shots: ShotRecord[]; plan: ChargePlan | null; lastAgentShot: ShotType | null; abandoned: Array<{ band: DepthBand; arm: PowerArm }> };

export const AGENT_STORAGE_KEY = 'jk-badminton-agent';
/** Older evidence fades so the Agent keeps up when the player changes style. */
const ARM_CAP = 30;
const HOME_DEFAULT = 2.6;
const INTENTS: Intent[] = ['normal', 'power', 'soft'];

export function newBrain(): AgentBrain {
  return { version: 1, rallies: 0, shots: {}, smash: {}, replies: {} };
}

export function newAgentRally(): AgentRally {
  return { shots: [], plan: null, lastAgentShot: null, abandoned: [] };
}

const finite = (value: unknown, min = 0, max = 1e6): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseArm(value: unknown): Arm | null {
  if (!isObject(value) || !finite(value.a) || !finite(value.b) || !finite(value.tries) || !finite(value.won)) return null;
  return { a: value.a, b: value.b, tries: value.tries, won: Math.min(value.won, value.tries) };
}

function parseArms<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, Arm>> {
  const arms: Partial<Record<K, Arm>> = {};
  if (!isObject(value)) return arms;
  for (const key of keys) {
    const arm = parseArm(value[key]);
    if (arm) arms[key] = arm;
  }
  return arms;
}

const DEPTHS: DepthBand[] = ['front', 'mid', 'back'];
const SHOT_TYPES: ShotType[] = ['clear', 'drop', 'smash', 'drive', 'net', 'lift', 'serve', 'high-serve'];

/** Reads a brain back from storage, dropping anything malformed instead of trusting it. */
export function parseBrain(value: unknown): AgentBrain {
  const brain = newBrain();
  if (!isObject(value) || value.version !== 1) return brain;
  if (finite(value.rallies)) brain.rallies = Math.floor(value.rallies);
  if (isObject(value.shots)) {
    for (const [key, arms] of Object.entries(value.shots)) {
      if (/^(smash|over|mid|low)(\|[a-z|]+)?$/.test(key) && key.length < 32) brain.shots[key] = parseArms(arms, INTENTS);
    }
  }
  if (isObject(value.smash)) {
    for (const band of DEPTHS) if (isObject(value.smash[band])) brain.smash[band] = parseArms(value.smash[band], ['half', 'full'] as const);
  }
  if (isObject(value.replies)) {
    for (const type of SHOT_TYPES) {
      const habit = value.replies[type];
      if (isObject(habit) && finite(habit.n) && finite(habit.depth, 0, 8) && finite(habit.short) && finite(habit.fast) && finite(habit.deep)) {
        brain.replies[type] = { n: habit.n, depth: habit.depth, short: habit.short, fast: habit.fast, deep: habit.deep };
      }
    }
  }
  return brain;
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
): AgentStroke {
  const intent = chooseIntent(brain, contact, playerDistanceFromNet, random);
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
  return notes.sort((x, y) => y.weight - x.weight).slice(0, 3).map((note) => note.text);
}
