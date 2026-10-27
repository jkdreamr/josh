// Stadium sound for soccer, synthesized live with Web Audio: no samples and no downloads, so there is nothing to
// license. The crowd is a bed of filtered noise that swells as an attack nears the box, plus a "choir" of detuned
// voices through vowel formants for the oohs on near misses, the roar and chant on goals and the boos on fouls. The
// home side's fans are louder. The referee's pea whistle, the ball (kicks, volleys, the woodwork, the
// net) and a short line of commentary, spoken through the Web Speech API when there is one and always captioned, sit
// on top. Nothing here writes to the world: the sim stays deterministic and these modules only read it.
import { FIELD } from './field.ts';
import { BALL_RADIUS } from './physics.ts';
import { teamDir, teamOf, type Action, type Team, type World } from './logic.ts';
import { clubById, DEFAULT_CLUBS } from './teams.ts';

/** The home side: their attacks swell louder, their goals get the chant, and fouls on them get the loudest boos. */
export const HOME: Team = 0;
export const CLUB_NAMES: readonly [string, string] = [
  clubById(DEFAULT_CLUBS[0]).call,
  clubById(DEFAULT_CLUBS[1]).call,
];
const clubNamesFor = (world: World): readonly [string, string] => [
  clubById(world.clubs?.[0] ?? DEFAULT_CLUBS[0]).call,
  clubById(world.clubs?.[1] ?? DEFAULT_CLUBS[1]).call,
];

const HALF_X = FIELD.length / 2;
const GOAL_HALF = FIELD.goalWidth / 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export type Whistle = 'short' | 'long' | 'double' | 'final';
/** Blast lengths and the gaps before them, in seconds. Half time is a double, full time a double and a long one. */
export const WHISTLES: Record<Whistle, readonly { gap: number; dur: number }[]> = {
  short: [{ gap: 0, dur: 0.22 }],
  long: [{ gap: 0, dur: 0.8 }],
  double: [{ gap: 0, dur: 0.3 }, { gap: 0.16, dur: 0.75 }],
  final: [{ gap: 0, dur: 0.3 }, { gap: 0.16, dur: 0.3 }, { gap: 0.16, dur: 1.1 }],
};

export type Cue =
  | { kind: 'kick'; action: Action | 'touch'; power: number; speed: number; volley: boolean; x: number }
  | { kind: 'post'; speed: number; x: number }
  | { kind: 'bar'; speed: number; x: number }
  | { kind: 'net'; speed: number; x: number }
  | { kind: 'bounce'; speed: number; x: number }
  | { kind: 'whistle'; pattern: Whistle }
  /** team: who scored. */
  | { kind: 'goal'; team: Team; score: [number, number] }
  /** team: the attacking side. */
  | { kind: 'near-miss' | 'save'; team: Team; x: number }
  /** team: the side awarded the free kick or penalty (the one fouled). */
  | { kind: 'foul'; team: Team; penalty: boolean }
  | { kind: 'corner'; team: Team }
  | { kind: 'kickoff'; second: boolean; first: boolean }
  | { kind: 'half-time' | 'full-time'; score: [number, number] };

type BallSample = { x: number; y: number; z: number; vx: number; vy: number; vz: number; inNet: boolean };
export type CueMemory = {
  ball: BallSample;
  phase: World['phase'];
  restart: World['restart'];
  event: string;
  score: [number, number];
  kick: string;
  /** The last shot: who took it and when (in the caller's seconds), for telling a near miss from a stray ball. */
  shot: { team: Team; at: number } | null;
  /** No second gasp until then (a shot off the post that then runs out is one near miss). */
  calm: number;
};

const speedOf = (b: BallSample) => Math.hypot(b.vx, b.vy, b.vz);
const kickKey = (world: World) => world.kickEvent ? `${world.kickEvent.playerId}:${world.kickEvent.time.toFixed(4)}:${world.kickEvent.action}` : '';

export function cueMemory(world: World, shot: CueMemory['shot'] = null, calm = -Infinity): CueMemory {
  const { x, y, z, vx, vy, vz, inNet } = world.ball;
  return { ball: { x, y, z, vx, vy, vz, inNet }, phase: world.phase, restart: world.restart, event: world.event, score: [world.score[0], world.score[1]], kick: kickKey(world), shot, calm };
}

/** Which side attacks the goal at this end of the pitch (sign of x). */
export function attackerAt(world: Pick<World, 'endsSwapped'>, x: number): Team {
  return teamDir(0, world.endsSwapped) * Math.sign(x || 1) > 0 ? 0 : 1;
}

/**
 * Compares the world with what was heard last time and returns the sounds that happened in between. Call it after
 * every sim step on the host (a kick only shows for one step), or on every snapshot on a guest, where kicks are
 * inferred from the ball's jumps in speed. `time` is any clock in seconds.
 */
export function detectCues(memory: CueMemory | null, world: World, time: number): { cues: Cue[]; memory: CueMemory } {
  const cues: Cue[] = [];
  if (!memory) return { cues, memory: cueMemory(world) };
  const prev = memory.ball;
  const ball = world.ball;
  const prevSpeed = speedOf(prev);
  const speed = speedOf(ball);
  let shot = memory.shot && time - memory.shot.at < 3.5 ? memory.shot : null;
  const live = memory.phase === 'live' && world.phase === 'live';

  const key = kickKey(world);
  if (key && key !== memory.kick) {
    const kick = world.kickEvent!;
    const volley = prev.y > 0.45 && !['tackle', 'slide', 'skill'].includes(kick.action);
    cues.push({ kind: 'kick', action: kick.action, power: kick.power, speed, volley, x: ball.x });
    if (kick.action === 'shoot' || kick.action === 'finesse' || (volley && kick.power > 0.5)) shot = { team: teamOf(kick.playerId), at: time };
  } else if (!key && live && speed - prevSpeed > 6 && Math.abs(ball.x) < HALF_X - 2) {
    cues.push({ kind: 'kick', action: 'touch', power: clamp(speed / 30, 0, 1), speed, volley: prev.y > 0.45, x: ball.x });
    if (speed > 17) shot = { team: attackerAt(world, ball.vx), at: time };
  }

  const keeper = world.event !== memory.event && (world.event === 'keeper parries' || world.event === 'keeper claims it');
  if (live && !keeper && prev.vx * ball.vx < 0 && Math.abs(prev.vx) > 2 && Math.abs(ball.x) > HALF_X - 0.6
    && Math.abs(ball.z) < GOAL_HALF + 0.6 && ball.y < FIELD.goalHeight + 0.3) {
    const bar = Math.abs(ball.z) < GOAL_HALF - BALL_RADIUS - 0.01;
    cues.push({ kind: bar ? 'bar' : 'post', speed: prevSpeed, x: ball.x });
    if (time >= memory.calm) cues.push({ kind: 'near-miss', team: attackerAt(world, ball.x), x: ball.x });
  } else if (live && prev.vy < -3 && ball.vy > 0 && ball.y < 0.4) {
    cues.push({ kind: 'bounce', speed: -prev.vy, x: ball.x });
  }
  if (keeper && prevSpeed > 13) cues.push({ kind: 'save', team: attackerAt(world, prev.x), x: prev.x });

  for (const team of [0, 1] as const) {
    if (world.score[team] > memory.score[team]) {
      cues.push({ kind: 'net', speed: Math.max(prevSpeed, 8), x: prev.x });
      cues.push({ kind: 'goal', team, score: [world.score[0], world.score[1]] });
    }
  }

  if (memory.phase === 'live' && world.phase === 'restart') {
    if (world.restart === 'free-kick' || world.restart === 'penalty') {
      cues.push({ kind: 'whistle', pattern: 'long' });
      cues.push({ kind: 'foul', team: world.restartTeam, penalty: world.restart === 'penalty' });
    } else if (world.restart === 'corner' || world.restart === 'goal-kick') {
      const lineZ = Math.abs(prev.z);
      const fast = prevSpeed > 9 || !!shot;
      if (fast && time >= memory.calm && lineZ < GOAL_HALF + 4.5 && prev.y < FIELD.goalHeight + 2.5) cues.push({ kind: 'near-miss', team: attackerAt(world, prev.x), x: prev.x });
      if (world.restart === 'corner') cues.push({ kind: 'corner', team: world.restartTeam });
    }
  }
  if (memory.phase === 'restart' && world.phase === 'live' && memory.restart && ['kickoff', 'free-kick', 'penalty'].includes(memory.restart)) {
    cues.push({ kind: 'whistle', pattern: 'short' });
    if (memory.restart === 'kickoff') cues.push({ kind: 'kickoff', first: memory.event === 'kick off', second: memory.event === 'second half' });
  }
  if (world.phase !== memory.phase && world.phase === 'half-time') {
    cues.push({ kind: 'whistle', pattern: 'double' }, { kind: 'half-time', score: [world.score[0], world.score[1]] });
  }
  if (world.phase !== memory.phase && world.phase === 'full-time') {
    cues.push({ kind: 'whistle', pattern: 'final' }, { kind: 'full-time', score: [world.score[0], world.score[1]] });
  }
  const big = cues.some((c) => c.kind === 'goal' || c.kind === 'near-miss' || c.kind === 'save');
  if (big) shot = null;
  return { cues, memory: cueMemory(world, shot, big ? time + 2.5 : memory.calm) };
}

/**
 * How tense the crowd is (0 calm to 1 on its feet) and whose attack it is: the closer the ball is to a goal, the
 * louder, and more so for the home side's attacks and while the attackers have it.
 */
export function crowdMood(world: World): { level: number; attacker: Team } {
  const attacker = attackerAt(world, world.ball.x);
  if (world.phase !== 'live') return { level: 0, attacker };
  const d = Math.hypot(HALF_X - Math.abs(world.ball.x), world.ball.z);
  const near = clamp(1 - (d - 7) / 30, 0, 1);
  const owner = world.carrierId != null ? teamOf(world.carrierId) : world.lastTouch;
  const level = near * near * (owner === attacker ? 1 : 0.45) * (attacker === HOME ? 1 : 0.62);
  return { level, attacker };
}

export type LineKind = Cue['kind'] | 'attack';
export type Line = { text: string; priority: number; kind: LineKind };

const scoreLine = (score: readonly [number, number], names: readonly [string, string] = CLUB_NAMES) => {
  const [a, b] = score;
  if (a === b) return `all square at ${a} ${b}`;
  const lead: Team = a > b ? 0 : 1;
  return `${names[lead]} lead ${Math.max(a, b)} ${Math.min(a, b)}`;
};

/** Seconds before a kind of line can come again. */
const COOLDOWN: Partial<Record<LineKind, number>> = { attack: 18, corner: 10, foul: 6, 'near-miss': 6, save: 6, post: 4, bar: 4 };
const PRIORITY: Partial<Record<LineKind, number>> = { goal: 3, 'half-time': 3, 'full-time': 3, post: 2, bar: 2, save: 2, kickoff: 1, 'near-miss': 1, foul: 1 };

/** Candidate lines for a cue, or none for cues the booth stays quiet on. */
function linesFor(cue: Cue | { kind: 'attack'; team: Team }, names: readonly [string, string] = CLUB_NAMES): string[] {
  const name = (t: Team) => names[t];
  switch (cue.kind) {
    case 'kickoff':
      if (cue.first) return ["and we're under way", 'here we go', 'kick off, enjoy this one'];
      if (cue.second) return ['the second half is under way', 'back under way for the second half'];
      return [];
    case 'goal': {
      const opener = cue.team === HOME ? ['goal!', "it's in!", 'what a finish!', 'get in!'] : [`${name(cue.team)} score.`, 'goal for the visitors.', `${name(cue.team)} find the net.`];
      return opener.map((o) => `${o} ${scoreLine(cue.score, names)}`);
    }
    case 'near-miss':
      return cue.team === HOME ? ['ooh, just wide', `so close for ${name(cue.team)}`, 'inches away'] : [`wide from ${name(cue.team)}`, `${name(cue.team)} go close`, `a let off for ${name(HOME)}`];
    case 'post': return ['off the post!', 'it hits the post!', 'denied by the woodwork'];
    case 'bar': return ['off the bar!', 'crashes off the crossbar!', 'rattles the bar'];
    case 'save': return ['great save', 'what a stop by the keeper', 'the keeper keeps it out', 'saved!'];
    case 'foul':
      return cue.penalty ? [`penalty to ${name(cue.team)}!`, 'the ref points to the spot'] : [`free kick to ${name(cue.team)}`, 'the ref blows for a foul', 'that is a foul'];
    case 'corner': return [`corner to ${name(cue.team)}`, `${name(cue.team)} win a corner`];
    case 'attack':
      return cue.team === HOME ? [`${name(cue.team)} on the attack`, 'the home crowd rises', `${name(cue.team)} pushing forward`] : [`${name(cue.team)} break forward`, `${name(cue.team)} threaten here`, `danger for ${name(HOME)}`];
    case 'half-time': return [`half time, ${scoreLine(cue.score, names)}`];
    case 'full-time': {
      const [a, b] = cue.score;
      return [a === b ? `full time, it ends ${a} ${b}` : `full time, ${names[a > b ? 0 : 1]} win ${Math.max(a, b)} ${Math.min(a, b)}`];
    }
    default: return [];
  }
}

/**
 * Picks short lines for the booth with cooldowns, so a busy spell never turns into a stream of chatter: one line
 * every `gap` seconds at most, each kind of line on its own cooldown, and the big moments (goals, the woodwork, the
 * whistle at the half and the end) cutting in. Lines rotate through their pool, so the same call never repeats twice.
 */
export class Commentary {
  private last = -Infinity;
  private lastPriority = 0;
  private kinds = new Map<LineKind, number>();
  private turn = new Map<LineKind, number>();
  private gap: number;
  constructor(gap = 3.5) { this.gap = gap; }

  next(cue: Cue | { kind: 'attack'; team: Team }, time: number, names: readonly [string, string] = CLUB_NAMES): Line | null {
    const pool = linesFor(cue, names);
    if (!pool.length) return null;
    const priority = PRIORITY[cue.kind] ?? 0;
    const since = time - this.last;
    if (priority < 3 && since < this.gap && priority <= this.lastPriority) return null;
    if (priority < 2 && since < this.gap) return null;
    if (time - (this.kinds.get(cue.kind) ?? -Infinity) < (COOLDOWN[cue.kind] ?? 0)) return null;
    const turn = this.turn.get(cue.kind) ?? 0;
    this.turn.set(cue.kind, turn + 1);
    this.kinds.set(cue.kind, time);
    this.last = time;
    this.lastPriority = priority;
    return { text: pool[turn % pool.length]!, priority, kind: cue.kind };
  }
}

export type CommentaryMode = 'voice' | 'captions' | 'off';
export type Caption = { text: string; id: number };

/** Speaks lines (Web Speech API) and keeps the caption on screen for a moment. Captions show in voice mode too. */
export class Announcer {
  mode: CommentaryMode = 'voice';
  /** Spoken volume, 0 for silent (muted or the volume set to off). */
  volume = 1;
  caption: Caption | null = null;
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private voice: SpeechSynthesisVoice | null | undefined;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
  getCaption = () => this.caption;

  private speech(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  }
  /** Whether lines can be spoken at all here. */
  canSpeak() { return !!this.speech(); }

  say(line: Line) {
    if (this.mode === 'off') return;
    this.caption = { text: line.text, id: ++this.seq };
    this.emit();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.caption = null; this.timer = null; this.emit(); }, 2600 + line.text.length * 45);
    const speech = this.speech();
    if (this.mode !== 'voice' || !speech || this.volume <= 0) return;
    try {
      if (line.priority >= 3 || speech.speaking) speech.cancel();
      const u = new SpeechSynthesisUtterance(line.text);
      if (this.voice === undefined) {
        const voices = speech.getVoices();
        if (voices.length) this.voice = voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
      }
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang ?? 'en-GB';
      u.rate = line.priority >= 3 ? 1.12 : 1.04;
      u.pitch = line.priority >= 3 ? 1.08 : 1;
      u.volume = clamp(this.volume, 0, 1);
      speech.speak(u);
    } catch { /* no voice: the caption stays */ }
  }

  /** Call from a user gesture: Safari only lets a page speak after one. */
  prime() {
    const speech = this.speech();
    if (!speech || this.mode !== 'voice') return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speech.speak(u);
    } catch { /* ignore */ }
  }

  hush() {
    try { this.speech()?.cancel(); } catch { /* ignore */ }
  }

  dispose() {
    this.hush();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.caption = null;
    this.subs.clear();
  }

  private emit() { this.subs.forEach((f) => f()); }
}

// ---------------------------------------------------------------------------------------------------------------
// The synth. One AudioContext for the page, made on the first gesture (Safari and Chrome only start audio from
// one), shared by every round and suspended whenever no round is playing.

type Vowel = 'oo' | 'oh' | 'ah' | 'eh' | 'ee';
const FORMANTS: Record<Vowel, readonly [number, number]> = { oo: [320, 800], oh: [480, 820], ah: [760, 1220], eh: [560, 1720], ee: [300, 2250] };

type Graph = {
  ctx: AudioContext;
  master: GainNode;
  crowd: GainNode;
  effects: GainNode;
  noise: AudioBuffer;
  claps: AudioBuffer;
};

let graph: Graph | null = null;
/** Rounds whose crowd is up; the context sleeps whenever there are none. */
const playing = new Set<StadiumSynth>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return buf;
}

/** Many hands clapping out of time: short decaying cracks scattered at random. */
function clapBuffer(ctx: BaseAudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const len = Math.floor(ctx.sampleRate * 0.012);
  for (let n = Math.floor(seconds * 420); n > 0; n--) {
    const at = Math.floor(Math.random() * (d.length - len));
    const amp = 0.25 + Math.random() * 0.5;
    for (let i = 0; i < len; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len * 0.22));
  }
  return buf;
}

function makeGraph(): Graph | null {
  if (graph) return graph;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);
    const crowd = ctx.createGain();
    crowd.connect(master);
    const effects = ctx.createGain();
    effects.connect(master);
    graph = { ctx, master, crowd, effects, noise: noiseBuffer(ctx, 4), claps: clapBuffer(ctx, 3) };
    return graph;
  } catch {
    return null;
  }
}

function settle() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (playing.size === 0 && graph?.ctx.state === 'running') void graph.ctx.suspend().catch(() => {});
  }, 120);
}

const ramp = (p: AudioParam, v: number, t: number, tau: number) => {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(v, t, tau);
};

/** Live crowd bed and event sounds for one round. */
export class StadiumSynth {
  private g: Graph | null = null;
  private bed: { stop: () => void; swell: GainNode; swellTone: BiquadFilterNode; murmur: GainNode } | null = null;
  private running = false;
  private level = { volume: 0.7, crowd: 1, muted: false };
  private active = new Set<AudioScheduledSourceNode>();
  private subs = new Set<() => void>();
  private mood = 0;
  private sleep: ReturnType<typeof setTimeout> | null = null;

  /** True until a gesture has started audio: show a tap for sound prompt then. */
  get locked() {
    const g = graph;
    return !g || g.ctx.state !== 'running';
  }
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
  isLocked = () => this.locked;

  constructor() {
    this.g = graph;
    if (this.g) this.g.ctx.addEventListener('statechange', this.emit);
  }

  /** Call from a user gesture (pointerdown, keydown, a tap): creates or resumes the context. */
  unlock() {
    const fresh = !graph;
    const g = makeGraph();
    if (!g) return;
    if (fresh || this.g !== g) {
      this.g = g;
      g.ctx.addEventListener('statechange', this.emit);
    }
    if (g.ctx.state !== 'running') {
      // A gesture is the one moment Safari lets audio start, so resume now even between rounds; the bed waits for play.
      void g.ctx.resume().then(() => this.start()).catch(() => {});
      // An empty buffer played inside the gesture is what older Safari needs to let sound through.
      const src = g.ctx.createBufferSource();
      src.buffer = g.ctx.createBuffer(1, 1, 22050);
      src.connect(g.ctx.destination);
      src.start(0);
    }
    if (this.running) this.start();
  }

  setLevels(level: { volume: number; crowd: number; muted: boolean }) {
    this.level = level;
    this.applyLevels(0.08);
  }

  /** Round playing and page visible: the crowd comes up. Otherwise it fades and the context sleeps. */
  setRunning(on: boolean) {
    this.running = on;
    if (on) playing.add(this); else playing.delete(this);
    if (this.sleep) clearTimeout(this.sleep);
    this.sleep = null;
    const g = this.g ?? graph;
    if (on) {
      if (g && !this.g) this.g = g;
      if (g && g.ctx.state !== 'running' && g.ctx.state !== 'closed') void g.ctx.resume().catch(() => {});
      this.start();
    } else {
      if (g) ramp(g.master.gain, 0, g.ctx.currentTime, 0.08);
      if (g) this.sleep = setTimeout(() => { this.sleep = null; this.stopBed(); settle(); }, 400);
    }
    this.emit();
  }

  private applyLevels(tau: number) {
    const g = this.g;
    if (!g) return;
    const t = g.ctx.currentTime;
    ramp(g.master.gain, this.running && !this.level.muted ? this.level.volume : 0, t, tau);
    ramp(g.crowd.gain, this.level.crowd, t, tau);
  }

  private start() {
    const g = this.g;
    if (!g || g.ctx.state !== 'running' || !this.running) return;
    this.applyLevels(0.3);
    if (!this.bed) this.bed = this.makeBed(g);
  }

  private stopBed() {
    this.bed?.stop();
    this.bed = null;
  }

  private loop(g: Graph, buffer: AudioBuffer) {
    const src = g.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    src.start(g.ctx.currentTime, Math.random() * buffer.duration);
    return src;
  }

  private makeBed(g: Graph) {
    const { ctx } = g;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    out.connect(g.crowd);
    nodes.push(out);
    const layer = (freq: number, type: BiquadFilterType, q: number, gain: number, lfoHz: number) => {
      const src = this.loop(g, g.noise);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const amp = ctx.createGain();
      amp.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const depth = ctx.createGain();
      depth.gain.value = gain * 0.35;
      lfo.connect(depth).connect(amp.gain);
      lfo.start();
      src.connect(filter).connect(amp).connect(out);
      sources.push(src, lfo);
      nodes.push(filter, amp, depth);
      return { amp, filter };
    };
    layer(300, 'lowpass', 0.5, 0.55, 0.07);
    const murmur = layer(950, 'bandpass', 0.8, 0.32, 0.13).amp;
    layer(1800, 'bandpass', 1.4, 0.12, 0.29);
    // The swell: an "ah" from thousands of throats, opened up by crowdMood.
    const src = this.loop(g, g.noise);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 650; f1.Q.value = 2.2;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 3;
    const swell = ctx.createGain();
    swell.gain.value = 0;
    const f2amp = ctx.createGain();
    f2amp.gain.value = 0.6;
    src.connect(f1).connect(swell);
    src.connect(f2).connect(f2amp).connect(swell);
    swell.connect(out);
    sources.push(src);
    nodes.push(f1, f2, swell, f2amp);
    return {
      swell, swellTone: f1, murmur,
      stop: () => {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.1);
        for (const s of sources) try { s.stop(t + 0.6); } catch { /* already stopped */ }
        setTimeout(() => nodes.forEach((n) => n.disconnect()), 800);
      },
    };
  }

  /** Feed crowdMood's level every frame or so. */
  setMood(level: number) {
    const bed = this.bed;
    if (!bed || !this.g) return;
    if (Math.abs(level - this.mood) < 0.02) return;
    this.mood = level;
    const t = this.g.ctx.currentTime;
    ramp(bed.swell.gain, level * 0.9, t, level > 0.4 ? 0.35 : 0.9);
    ramp(bed.swellTone.frequency, 600 + level * 220, t, 0.5);
    ramp(bed.murmur.gain, 0.32 + level * 0.18, t, 0.6);
  }

  private track<T extends AudioScheduledSourceNode>(node: T, stopAt: number, ...chain: AudioNode[]) {
    this.active.add(node);
    node.onended = () => { this.active.delete(node); node.disconnect(); chain.forEach((n) => n.disconnect()); };
    node.stop(stopAt);
    return node;
  }

  private ready() {
    const g = this.g;
    return g && g.ctx.state === 'running' && this.running && !this.level.muted && this.level.volume > 0 ? g : null;
  }

  private pan(g: Graph, x: number, amount: number, to: AudioNode): AudioNode {
    if (!g.ctx.createStereoPanner) return to;
    const p = g.ctx.createStereoPanner();
    p.pan.value = clamp(x / HALF_X, -1, 1) * amount;
    p.connect(to);
    return p;
  }

  /** A crowd sound: voices on a vowel (detuned saws through two formants) and their breath (formant noise). */
  private voices(g: Graph, o: { vowel: Vowel; to?: Vowel; pitch: number; glide?: number; count: number; at: number; attack: number; hold: number; release: number; gain: number; x?: number }) {
    const { ctx } = g;
    const end = o.at + o.attack + o.hold + o.release;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, o.at);
    env.gain.exponentialRampToValueAtTime(o.gain, o.at + o.attack);
    env.gain.setValueAtTime(o.gain, o.at + o.attack + o.hold);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(o.x === undefined ? g.crowd : this.pan(g, o.x, 0.35, g.crowd));
    const [a1, a2] = FORMANTS[o.vowel];
    const [b1, b2] = FORMANTS[o.to ?? o.vowel];
    const formant = (from: number, to: number, q: number, gain: number) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(from, o.at);
      f.frequency.linearRampToValueAtTime(to, o.at + o.attack + o.hold);
      const amp = ctx.createGain();
      amp.gain.value = gain;
      f.connect(amp).connect(env);
      return { f, amp };
    };
    const one = formant(a1, b1, 5, 1);
    const two = formant(a2, b2, 7, 0.55);
    const chain: AudioNode[] = [env, one.f, one.amp, two.f, two.amp];
    for (let i = 0; i < o.count; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const pitch = o.pitch * (0.78 + Math.random() * 0.44);
      osc.frequency.setValueAtTime(pitch, o.at);
      osc.frequency.linearRampToValueAtTime(pitch * (o.glide ?? 1), end);
      osc.detune.value = (Math.random() - 0.5) * 40;
      const amp = ctx.createGain();
      amp.gain.value = 0.9 / o.count;
      osc.connect(amp);
      amp.connect(one.f);
      amp.connect(two.f);
      osc.start(o.at + Math.random() * 0.08);
      this.track(osc, end + 0.05, amp);
    }
    const breath = ctx.createBufferSource();
    breath.buffer = g.noise;
    const bamp = ctx.createGain();
    bamp.gain.value = 2.2;
    breath.connect(bamp);
    bamp.connect(one.f);
    bamp.connect(two.f);
    breath.start(o.at, Math.random() * 2);
    this.track(breath, end + 0.05, bamp, ...chain);
  }

  private applause(g: Graph, at: number, dur: number, gain: number) {
    const { ctx } = g;
    const src = ctx.createBufferSource();
    src.buffer = g.claps;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.3);
    env.gain.setTargetAtTime(0.0001, at + dur * 0.55, dur * 0.2);
    src.connect(hp).connect(env).connect(g.crowd);
    src.start(at, Math.random() * 2);
    this.track(src, at + dur + 0.5, hp, env);
  }

  /** Fans whistling through their fingers at the ref. */
  private fanWhistles(g: Graph, at: number, count: number, gain: number) {
    for (let i = 0; i < count; i++) {
      const t = at + Math.random() * 1.2;
      const osc = g.ctx.createOscillator();
      const f = 2000 + Math.random() * 900;
      osc.frequency.setValueAtTime(f * 0.85, t);
      osc.frequency.linearRampToValueAtTime(f, t + 0.12);
      osc.frequency.linearRampToValueAtTime(f * 0.9, t + 0.55);
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + 0.05);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(env).connect(g.crowd);
      osc.start(t);
      this.track(osc, t + 0.65, env);
    }
  }

  private noiseHit(g: Graph, o: { at: number; dur: number; gain: number; type: BiquadFilterType; freq: number; to?: number; q?: number; out: AudioNode }) {
    const { ctx } = g;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.freq, o.at);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.at + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain, o.at);
    env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
    src.connect(f).connect(env).connect(o.out);
    src.start(o.at, Math.random() * 3);
    this.track(src, o.at + o.dur + 0.05, f, env);
  }

  private toneHit(g: Graph, o: { at: number; dur: number; gain: number; freq: number; to?: number; type?: OscillatorType; out: AudioNode; wobble?: number }) {
    const { ctx } = g;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.at + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain, o.at);
    env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
    osc.connect(env).connect(o.out);
    const extra: AudioNode[] = [env];
    if (o.wobble) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const depth = ctx.createGain();
      depth.gain.value = o.wobble;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(o.at);
      this.track(lfo, o.at + o.dur + 0.05, depth);
    }
    osc.start(o.at);
    this.track(osc, o.at + o.dur + 0.05, ...extra);
  }

  private whistle(g: Graph, pattern: Whistle) {
    const { ctx } = g;
    let t = ctx.currentTime + 0.02;
    for (const blast of WHISTLES[pattern]) {
      t += blast.gap;
      const end = t + blast.dur;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.16, t + 0.018);
      env.gain.setValueAtTime(0.16, end - 0.05);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      env.connect(g.effects);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(3050, t);
      osc.frequency.setValueAtTime(3050, end - 0.06);
      osc.frequency.linearRampToValueAtTime(2850, end);
      // The pea: a fast rattle in pitch and level.
      const pea = ctx.createOscillator();
      pea.frequency.value = 26 + Math.random() * 6;
      const peaDepth = ctx.createGain();
      peaDepth.gain.value = 120;
      pea.connect(peaDepth).connect(osc.frequency);
      const over = ctx.createOscillator();
      over.frequency.setValueAtTime(6100, t);
      const overAmp = ctx.createGain();
      overAmp.gain.value = 0.12;
      over.connect(overAmp).connect(env);
      osc.connect(env);
      for (const o of [osc, pea, over]) o.start(t);
      this.track(osc, end + 0.02, env);
      this.track(pea, end + 0.02, peaDepth);
      this.track(over, end + 0.02, overAmp);
      this.noiseHit(g, { at: t, dur: blast.dur, gain: 0.04, type: 'bandpass', freq: 3200, q: 1.5, out: g.effects });
      t = end;
    }
  }

  private kick(g: Graph, cue: Extract<Cue, { kind: 'kick' }>) {
    const t = g.ctx.currentTime;
    const w = clamp(cue.speed / 30, 0.08, 1);
    const out = this.pan(g, cue.x, 0.5, g.effects);
    this.toneHit(g, { at: t, dur: 0.09 + w * 0.05, gain: 0.55 * Math.pow(w, 0.8), freq: 120 + w * 70, to: 52, out });
    this.noiseHit(g, { at: t, dur: 0.018, gain: (cue.volley ? 0.45 : 0.22) * w, type: 'highpass', freq: cue.volley ? 2800 : 1600, out });
    if (cue.volley) this.toneHit(g, { at: t, dur: 0.035, gain: 0.18 * w, freq: 360, to: 220, type: 'triangle', out });
    if (cue.speed > 16 || cue.action === 'shoot' || cue.action === 'finesse') {
      this.noiseHit(g, { at: t + 0.02, dur: 0.28, gain: 0.1 * w, type: 'bandpass', freq: 700, to: 2600, q: 1.2, out });
    }
  }

  private woodwork(g: Graph, cue: Extract<Cue, { kind: 'post' | 'bar' }>) {
    const t = g.ctx.currentTime;
    const w = clamp(cue.speed / 26, 0.2, 1);
    const out = this.pan(g, cue.x, 0.6, g.effects);
    const base = cue.kind === 'post' ? 410 : 330;
    const partials: readonly [number, number, number][] = [[1, 0.4, 1.1], [2.76, 0.24, 0.75], [5.4, 0.13, 0.45], [8.93, 0.07, 0.28]];
    for (const [ratio, gain, decay] of partials) {
      this.toneHit(g, { at: t, dur: decay * (cue.kind === 'bar' ? 1.5 : 1) * (0.6 + w * 0.6), gain: gain * w, freq: base * ratio, out, wobble: cue.kind === 'bar' ? base * ratio * 0.012 : 0 });
    }
    this.toneHit(g, { at: t, dur: 0.1, gain: 0.4 * w, freq: 140, to: 60, out });
  }

  private net(g: Graph, cue: Extract<Cue, { kind: 'net' }>) {
    const t = g.ctx.currentTime;
    const w = clamp(cue.speed / 25, 0.3, 1);
    const out = this.pan(g, cue.x, 0.6, g.effects);
    this.noiseHit(g, { at: t, dur: 0.5, gain: 0.32 * w, type: 'bandpass', freq: 2400, to: 1400, q: 0.7, out });
    this.noiseHit(g, { at: t + 0.03, dur: 0.35, gain: 0.25 * w, type: 'lowpass', freq: 380, out });
  }

  /** Play one cue's sounds now. */
  play(cue: Cue) {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    const home = (team: Team) => team === HOME;
    switch (cue.kind) {
      case 'kick': this.kick(g, cue); break;
      case 'post':
      case 'bar': this.woodwork(g, cue); break;
      case 'net': this.net(g, cue); break;
      case 'bounce': this.toneHit(g, { at: t, dur: 0.07, gain: clamp(cue.speed / 12, 0.05, 0.35), freq: 95, to: 50, out: this.pan(g, cue.x, 0.5, g.effects) }); break;
      case 'whistle': this.whistle(g, cue.pattern); break;
      case 'near-miss': {
        const loud = home(cue.team) ? 1 : 0.5;
        this.voices(g, { vowel: 'oo', to: 'oh', pitch: 210, glide: 1.25, count: 14, at: t, attack: 0.12, hold: 0.45, release: 0.9, gain: 0.5 * loud, x: cue.x });
        if (home(cue.team)) this.voices(g, { vowel: 'oh', to: 'ah', pitch: 190, glide: 0.75, count: 10, at: t + 0.8, attack: 0.2, hold: 0.3, release: 0.9, gain: 0.25, x: cue.x });
        else this.applause(g, t + 0.7, 1.4, 0.12);
        break;
      }
      case 'save':
        this.voices(g, { vowel: 'oo', to: 'ah', pitch: 220, glide: 1.15, count: 12, at: t, attack: 0.1, hold: 0.3, release: 0.8, gain: home(cue.team) ? 0.42 : 0.3, x: cue.x });
        this.applause(g, t + 0.4, 2, home(cue.team) ? 0.14 : 0.3);
        break;
      case 'goal': {
        if (home(cue.team)) {
          this.voices(g, { vowel: 'eh', to: 'ah', pitch: 240, glide: 1.2, count: 18, at: t, attack: 0.08, hold: 2.2, release: 2.6, gain: 0.9 });
          this.noiseHit(g, { at: t, dur: 4.5, gain: 0.55, type: 'bandpass', freq: 900, to: 650, q: 0.6, out: g.crowd });
          this.applause(g, t + 0.3, 5, 0.4);
          this.fanWhistles(g, t + 0.5, 4, 0.03);
          this.chant(g, t + 3.2, 3);
        } else {
          this.voices(g, { vowel: 'eh', to: 'ah', pitch: 250, glide: 1.15, count: 10, at: t, attack: 0.1, hold: 1.2, release: 1.6, gain: 0.32, x: cue.team === 0 ? -HALF_X : HALF_X });
          this.voices(g, { vowel: 'oh', to: 'oo', pitch: 170, glide: 0.7, count: 14, at: t + 0.4, attack: 0.3, hold: 0.6, release: 1.2, gain: 0.32 });
          this.applause(g, t + 0.2, 3, 0.12);
        }
        break;
      }
      case 'foul': {
        // The home crowd boos the visitors' fouls hardest; on a foul by their own side they still jeer the ref.
        const loud = home(cue.team) ? 1 : 0.5;
        this.voices(g, { vowel: 'oo', pitch: 130, glide: 0.88, count: 16, at: t + 0.15, attack: 0.3, hold: 0.9 + loud * 0.5, release: 0.8, gain: 0.55 * loud });
        this.fanWhistles(g, t + 0.2, home(cue.team) ? 3 : 1, 0.025);
        if (cue.penalty) this.voices(g, { vowel: home(cue.team) ? 'eh' : 'oh', to: 'ah', pitch: 220, count: 12, at: t + 0.05, attack: 0.1, hold: 0.6, release: 1, gain: 0.45 });
        break;
      }
      case 'corner':
        if (home(cue.team)) this.applause(g, t, 1.6, 0.18);
        break;
      case 'kickoff':
        this.applause(g, t, cue.first || cue.second ? 3 : 1.6, 0.22);
        break;
      case 'half-time':
        this.applause(g, t + 0.6, 4, 0.26);
        break;
      case 'full-time': {
        const [a, b] = cue.score;
        if (a > b) { this.voices(g, { vowel: 'eh', to: 'ah', pitch: 240, glide: 1.1, count: 16, at: t + 1.2, attack: 0.3, hold: 1.5, release: 2, gain: 0.7 }); this.chant(g, t + 3.5, 2); }
        else if (a < b) this.voices(g, { vowel: 'oo', pitch: 140, glide: 0.9, count: 14, at: t + 1.2, attack: 0.4, hold: 1, release: 1.2, gain: 0.4 });
        this.applause(g, t + 1, 5, a >= b ? 0.4 : 0.15);
        break;
      }
    }
  }

  /** "bay ci-ty" and three claps, a few times over. */
  private chant(g: Graph, at: number, times: number) {
    const syllables: readonly [number, Vowel, number][] = [[0, 'eh', 1], [0.42, 'ee', 1], [0.66, 'ee', 0.84]];
    for (let r = 0; r < times; r++) {
      const bar = at + r * 2;
      for (const [off, vowel, pitch] of syllables) {
        this.voices(g, { vowel, pitch: 196 * pitch, count: 12, at: bar + off, attack: 0.04, hold: off === 0 ? 0.26 : 0.14, release: 0.12, gain: 0.55 });
      }
      for (const off of [1.1, 1.36, 1.62]) this.noiseHit(g, { at: bar + off, dur: 0.09, gain: 0.5, type: 'bandpass', freq: 1300, q: 0.9, out: g.crowd });
    }
  }

  dispose() {
    this.running = false;
    playing.delete(this);
    if (this.sleep) clearTimeout(this.sleep);
    this.sleep = null;
    this.stopBed();
    const t = this.g?.ctx.currentTime ?? 0;
    for (const node of this.active) try { node.stop(t); } catch { /* already stopped */ }
    this.active.clear();
    if (this.g) {
      ramp(this.g.master.gain, 0, t, 0.05);
      this.g.ctx.removeEventListener('statechange', this.emit);
    }
    this.subs.clear();
    settle();
  }

  private emit = () => { this.subs.forEach((f) => f()); };
}

export type SoundLevels = { volume: number; crowd: number; muted: boolean; commentary: CommentaryMode };

/** Everything for one round: hears the world, plays it and calls it. Safe to make under node (no audio there). */
export class SoccerSound {
  readonly synth = new StadiumSynth();
  readonly announcer = new Announcer();
  private commentary = new Commentary();
  private memory: CueMemory | null = null;
  private attackArmed = true;
  private primed = false;

  configure(levels: SoundLevels) {
    this.synth.setLevels(levels);
    this.announcer.mode = levels.commentary;
    this.announcer.volume = levels.muted ? 0 : levels.volume;
    if (levels.commentary !== 'voice' || this.announcer.volume === 0) this.announcer.hush();
  }

  unlock() {
    this.synth.unlock();
    if (!this.primed) {
      this.primed = true;
      this.announcer.prime();
    }
  }

  setRunning(on: boolean) {
    this.synth.setRunning(on);
    if (!on) this.announcer.hush();
  }

  reset(world: World) {
    this.memory = cueMemory(world);
    this.attackArmed = true;
  }

  /** Call after every sim step (host) or snapshot (guest). Returns the cues, for tests. */
  observe(world: World, time: number): Cue[] {
    const { cues, memory } = detectCues(this.memory, world, time);
    this.memory = memory;
    const names = clubNamesFor(world);
    for (const cue of cues) {
      this.synth.play(cue);
      const line = this.commentary.next(cue, time, names);
      if (line) this.announcer.say(line);
    }
    return cues;
  }

  /** Call every frame: the crowd follows the attack, and a big one gets a line. */
  frame(world: World, time: number) {
    const mood = crowdMood(world);
    const names = clubNamesFor(world);
    this.synth.setMood(world.phase === 'goal' ? 0.2 : mood.level);
    if (mood.level < 0.3) this.attackArmed = true;
    else if (this.attackArmed && mood.level > (mood.attacker === HOME ? 0.7 : 0.45)) {
      this.attackArmed = false;
      const line = this.commentary.next({ kind: 'attack', team: mood.attacker }, time, names);
      if (line) this.announcer.say(line);
    }
  }

  dispose() {
    this.synth.dispose();
    this.announcer.dispose();
  }
}
