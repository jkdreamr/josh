import { DurableObject } from 'cloudflare:workers';
import { OPEN_ROOMS_MAX, type OpenRoom } from '../../src/os/arcade/kit/online-core.ts';
import { GATHER_MS, LISTING_TTL_MS, pickQuick, sortListings } from './room-core';

/**
 * The arcade's Open Rooms: every public room someone can still join, one line each. Rooms keep their own line right
 * (as people come and go, and from an alarm every minute), so a line nobody has refreshed for a few minutes belongs to
 * a room that is gone and is dropped.
 */
export class Lobby extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, game TEXT NOT NULL, listing TEXT NOT NULL, updated INTEGER NOT NULL)');
  }

  put(listing: OpenRoom): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO rooms (code, game, listing, updated) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET game = excluded.game, listing = excluded.listing, updated = excluded.updated',
      listing.code,
      listing.game,
      JSON.stringify(listing),
      Date.now(),
    );
  }

  drop(code: string): void {
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
  }

  /** Open rooms for one game, or for every game (not quick rooms nobody is in yet). */
  list(game: string | null): OpenRoom[] {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM rooms WHERE updated < ?', Date.now() - LISTING_TTL_MS);
    const rows = game
      ? sql.exec<{ listing: string }>('SELECT listing FROM rooms WHERE game = ?', game).toArray()
      : sql.exec<{ listing: string }>('SELECT listing FROM rooms').toArray();
    return sortListings(rows.map((row) => JSON.parse(row.listing) as OpenRoom).filter((room) => room.host !== '')).slice(0, OPEN_ROOMS_MAX);
  }

  /**
   * Quick play: the code of a quick room of this game (and `pool`, if any: a game's modes keep apart) still gathering
   * people, or else `fresh`, which is kept as a new one (with no host until its first person comes in) for the Worker
   * to open. One call at a time, so two people pressing Play together get the same room. Each one sent to a room counts
   * in its line until the room says otherwise.
   */
  quick(game: string, fresh: string, seats: number, lateJoin: boolean, pool?: string): string {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec('DELETE FROM rooms WHERE updated < ?', now - LISTING_TTL_MS);
    const rows = sql.exec<{ listing: string; updated: number }>('SELECT listing, updated FROM rooms WHERE game = ?', game).toArray();
    const pick = pickQuick(rows.map((row) => ({ listing: JSON.parse(row.listing) as OpenRoom, updated: row.updated })), now, pool);
    if (pick) {
      sql.exec('UPDATE rooms SET listing = ? WHERE code = ?', JSON.stringify({ ...pick, players: pick.players + 1 }), pick.code);
      return pick.code;
    }
    this.put({ code: fresh, game, host: '', players: 1, bots: 0, seats, started: false, lateJoin, quick: true, startAt: now + GATHER_MS, ...(pool ? { pool } : {}) });
    return fresh;
  }
}
