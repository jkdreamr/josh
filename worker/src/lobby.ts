import { DurableObject } from 'cloudflare:workers';
import { OPEN_ROOMS_MAX, type OpenRoom } from '../../src/os/arcade/kit/online-core.ts';
import { LISTING_TTL_MS, sortListings } from './room-core';

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

  /** Open rooms for one game, or for every game. */
  list(game: string | null): OpenRoom[] {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM rooms WHERE updated < ?', Date.now() - LISTING_TTL_MS);
    const rows = game
      ? sql.exec<{ listing: string }>('SELECT listing FROM rooms WHERE game = ?', game).toArray()
      : sql.exec<{ listing: string }>('SELECT listing FROM rooms').toArray();
    return sortListings(rows.map((row) => JSON.parse(row.listing) as OpenRoom)).slice(0, OPEN_ROOMS_MAX);
  }
}
