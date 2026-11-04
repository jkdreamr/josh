// A run a game plays for the global leaderboard, recorded for the Worker to check (see verify/protocol.ts).
import { useEffect, useRef } from 'react';
import { FEED_MS } from '../verify/protocol.ts';
import { ARCADE_API, noteFinishing, openRun, post, type RunTicket } from './leaderboard';

/** Events kept before a chunk goes early, so no chunk grows past the Worker's limit. */
const CHUNK_EVENTS = 1_000;

/**
 * One run's recording. Made as play begins: it asks the Worker for the run (and the seed its randomness must come
 * from), which usually lands before the player's first move. `begin` starts it as a ranked run if the ticket came;
 * the game then records what the player does (`record`) and its own clock (`clock`), which go off in chunks every few
 * seconds; `end` sends the last chunk with the score. A run that never got a ticket, or that the Worker turned down,
 * still plays; its score stays on this device.
 */
export class RankedRun {
  private ticket: RunTicket | null = null;
  private waiting = true;
  private begun = false;
  private ended = false;
  private broken = false;
  private events: unknown[] = [];
  private at: unknown = 0;
  private n = 0;
  private chain: Promise<boolean> = Promise.resolve(true);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly api: string;

  constructor(game: string, api = ARCADE_API) {
    this.api = api;
    if (!api) {
      this.waiting = false;
      return;
    }
    openRun(game, api).then((t) => {
      this.ticket = t;
      this.waiting = false;
    });
  }

  /** The ticket is still on its way. */
  get pending() {
    return this.waiting;
  }

  /** The seed the run's randomness must come from, once the ticket is in. */
  get seed(): number | null {
    return this.ticket?.seed ?? null;
  }

  /** The run's id once it has begun as a ranked run (for the Game Over card's submission). */
  get id(): string | undefined {
    return this.begun && !this.broken && this.ticket ? this.ticket.run : undefined;
  }

  /** Starts the ranked run, saying how it starts. False when there is no ticket: the run plays unranked. */
  begin(init: unknown): boolean {
    if (!this.ticket || this.begun) return false;
    this.begun = true;
    this.send('/runs/start', { run: this.ticket.run, init });
    this.timer = setInterval(() => this.flush(), FEED_MS);
    return true;
  }

  /** Something the player did, as the game's verifier reads it. */
  record(event: unknown) {
    if (!this.begun || this.ended) return;
    this.events.push(event);
    if (this.events.length >= CHUNK_EVENTS) this.flush();
  }

  /** The run's own clock, stamped on the next chunk. */
  clock(at: unknown) {
    this.at = at;
  }

  /** Sends the last chunk with the score. The run's id, for the Game Over card, or undefined for an unranked run. */
  end(score: number): string | undefined {
    if (!this.begun || this.ended || !this.ticket) return undefined;
    this.ended = true;
    this.stop();
    const run = this.ticket.run;
    const done = this.send('/runs/finish', { run, n: this.n++, e: this.events.splice(0), t: this.at, score });
    noteFinishing(run, done);
    return this.broken ? undefined : run;
  }

  /** Stops sending (the game was left mid-run). */
  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private flush() {
    if (!this.begun || this.ended || this.broken || !this.ticket) return;
    this.send('/runs/feed', { run: this.ticket.run, n: this.n++, e: this.events.splice(0), t: this.at });
  }

  /** Sends in order. A refusal ends the run's ranking; a dropped connection is tried again a couple of times. */
  private send(path: string, body: unknown): Promise<boolean> {
    this.chain = this.chain.then(async (ok) => {
      if (!ok || this.broken) return false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await post(`${this.api}${path}`, body);
          if (res.ok) return true;
          if (res.status < 500) break;
        } catch {
          /* tried again below */
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
      this.broken = true;
      this.stop();
      return false;
    });
    return this.chain;
  }
}

/**
 * The ranked run for this round of `game` (a game remounts for each round): made the first time it is asked for, while
 * playing, and stopped when the round goes away. Null when ranked runs don't apply (online, a preview tile).
 */
export function useRankedRun(game: string, enabled: boolean) {
  const run = useRef<RankedRun | null>(null);
  useEffect(() => () => run.current?.stop(), []);
  return () => {
    if (!enabled) return null;
    run.current ??= new RankedRun(game);
    return run.current;
  };
}
