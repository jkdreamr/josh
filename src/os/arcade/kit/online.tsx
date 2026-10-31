import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Segmented } from './controls';
import { defineSetting } from './settings';
import { ARCADE_API } from './leaderboard';
import { openRoomAction, openRoomLine, tagRound, type OpenRoom, type RoundRouter } from './online-core';
import { listRooms, RoomLink, type RoomPlayer, type RoomTransport } from './room';
import { sfx } from './sfx';

type OnlineValue = {
  link: RoomLink;
  code: string;
  start: () => void;
  /** Game messages, each handed to the round it was sent for. */
  router: RoundRouter;
  seat: number;
  seats: number;
  round: number;
  started: boolean;
  players: RoomPlayer[];
  /** Computer players: this round's while one is under way, otherwise the ones the host has added so far. */
  bots: RoomPlayer[];
  isHost: boolean;
  transport: RoomTransport;
  /** The connection to the room dropped and this player's seat is being got back (the round carries on meanwhile). */
  reconnecting: boolean;
  /**
   * Bumps each time the host leaves and hands the room on: a round the old host's game ran is over, unless the game
   * takes it over (meta.online.migrate).
   */
  handoffs: number;
  /** Each hand-off a round went on past, oldest first: the round, and the seat that took over (seat 0 from then on). */
  handedOff: readonly HandOff[];
  /** A quick-play room: it started on its own, and the game sets the match up the same way every time. */
  quick: boolean;
  /** The quick-play pool the room gathered for (a game's mode, see GameShell's quickPool), or '' for none. */
  pool: string;
  /**
   * Watching as a spectator (seat is -1): the game draws what the host broadcasts, with no player of this person's own,
   * and sends nothing (send and reportResult do nothing).
   */
  watching: boolean;
  /** Who is watching the room, by name. */
  watchers: string[];
};

export type HandOff = { round: number; from: number };

const OnlineContext = createContext<OnlineValue | null>(null);

export function OnlineProvider({
  link,
  router,
  seat,
  seats,
  round,
  started,
  players,
  bots,
  transport,
  reconnecting,
  handoffs,
  handedOff,
  quick,
  pool,
  watching,
  watchers,
  children,
}: Omit<OnlineValue, 'seat' | 'link' | 'isHost' | 'code' | 'start'> & { link: RoomLink | null; seat: number | null; children: ReactNode }) {
  const value = useMemo(
    () => link && seat !== null ? { link, code: link.code, start: () => link.start(), router, seat, seats, round, started, players, bots, isHost: seat === 0, transport, reconnecting, handoffs, handedOff, quick, pool, watching, watchers } : null,
    [link, router, seat, seats, round, started, players, bots, transport, reconnecting, handoffs, handedOff, quick, pool, watching, watchers],
  );
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
}

export function useOnline() {
  const room = useContext(OnlineContext);
  return useMemo(() => {
    if (!room) return null;
    return {
      seat: room.seat,
      code: room.code,
      start: () => room.link.start(),
      seats: room.seats,
      round: room.round,
      started: room.started,
      players: room.players,
      bots: room.bots,
      isHost: room.isHost,
      transport: room.transport,
      reconnecting: room.reconnecting,
      handoffs: room.handoffs,
      handedOff: room.handedOff,
      quick: room.quick,
      pool: room.pool,
      watching: room.watching,
      watchers: room.watchers,
      // Tagged with the round this player is in at the moment it's sent, which a game that kept an old handle still gets.
      send: (d: unknown, options?: { to?: number; fast?: boolean; reliable?: boolean; everyone?: boolean }) => room.link.send(tagRound(room.router.round, d), options),
      onMessage: (listener: (from: number, d: unknown) => void) => room.router.listen(listener),
      /** Who won: a seat, with every seat on its team for a team game, or null. */
      reportResult: (round: number, winner: number | null, team?: number[]) => room.link.reportResult(round, winner, team),
    };
  }, [room]);
}

/**
 * Public rooms someone can join now, for one game or every game, asked again every few seconds while the page is
 * visible (and `on`). Null until the first answer, and whenever Open Rooms can't be reached (a Worker from before them included).
 */
export function useOpenRooms(game?: string, every = 6000, on = true): OpenRoom[] | null {
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  useEffect(() => {
    if (!ARCADE_API || !on) return;
    let live = true;
    let timer = 0;
    const load = async () => {
      if (!document.hidden) {
        try {
          const next = await listRooms(game);
          if (live) setRooms(next);
        } catch {
          if (live) setRooms(null);
        }
      }
      if (live) timer = window.setTimeout(load, every);
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [game, every, on]);
  return rooms;
}

export type RoomVisibility = 'private' | 'public';
/** The kind of room Create Room makes, remembered on this device for every game. */
export const ROOM_VISIBILITY = defineSetting<RoomVisibility>('online:visibility', ['private', 'public'], 'private');
const visibilityOptions = [
  ['private', 'Private'],
  ['public', 'Public'],
] as const satisfies readonly (readonly [RoomVisibility, string])[];
export const visibilityNote = (v: RoomVisibility) => (v === 'public' ? 'Anyone Can Find It in Open Rooms and Join.' : 'Only People With the Code or Link Can Join.');

/** Private or public: a public room is listed in the arcade's Open Rooms for anyone to join. */
export function VisibilityPicker({ value, onChange }: { value: RoomVisibility; onChange: (v: RoomVisibility) => void }) {
  return (
    <>
      <Segmented label="Room" value={value} options={visibilityOptions} onChange={onChange} />
      <p className="arcade-online-hint">{visibilityNote(value)}</p>
    </>
  );
}

export type WatchSetting = 'on' | 'off';
/** Whether the rooms this player hosts let people watch, remembered on this device for every game (on by default). */
export const ROOM_WATCHERS = defineSetting<WatchSetting>('online:watchers', ['on', 'off'], 'on');
const watchOptions = [
  ['on', 'Allowed'],
  ['off', 'Off'],
] as const satisfies readonly (readonly [WatchSetting, string])[];

/** The host's switch for spectators: allowed (anyone in the room's code or Open Rooms can watch a round), or off. */
export function WatchPicker({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  return (
    <>
      <Segmented label="Spectators" value={value ? 'on' : 'off'} options={watchOptions} onChange={(v) => onChange(v === 'on')} />
      <p className="arcade-online-hint">{value ? 'People Can Watch Your Rounds Without Playing.' : 'Nobody Can Watch. Anyone Watching Now Is Sent Away.'}</p>
    </>
  );
}

/**
 * Who is in the room: each person (the host and you marked), the bots on one line, and who is watching. On the online
 * Game Over card, so everyone sees who is still here for the next round.
 */
export function RoomRoster({ players, bots, watchers, seat, seats, label = 'In the Room' }: { players: RoomPlayer[]; bots: RoomPlayer[]; watchers: string[]; seat: number | null; seats: number; label?: string }) {
  return (
    <div className="arcade-online-players arcade-online-roster">
      <strong>{label}{seats > 2 && ` ${players.length + bots.length}/${seats}`}</strong>
      {players.map((player) => (
        <div key={player.seat} className="arcade-online-player">
          <span>{player.name}</span>
          {player.seat === 0 && <small>Host</small>}
          {player.seat === seat && <small>You</small>}
        </div>
      ))}
      {!!bots.length && (
        <div className="arcade-online-player is-bot" title={bots.map((bot) => bot.name).join(', ')}>
          <span>{bots.map((bot) => bot.name).join(', ')}</span>
          <small>{bots.length === 1 ? 'Bot' : `${bots.length} Bots`}</small>
        </div>
      )}
      {!!watchers.length && (
        <div className="arcade-online-player is-watching" title={watchers.join(', ')}>
          <span>{watchers.join(', ')}</span>
          <small>{watchers.length} Watching</small>
        </div>
      )}
    </div>
  );
}

/** This game's open rooms, each with a Join button (Watch, for a round under way nobody can join). Hidden until Open Rooms answers. */
function OpenRoomList({ game, busy, onJoin }: { game: string; busy: boolean; onJoin: (code: string) => void }) {
  const rooms = useOpenRooms(game);
  if (!rooms) return null;
  return (
    <div className="arcade-online-players arcade-online-open">
      <strong>Open Rooms</strong>
      {rooms.map((room) => (
        <div key={room.code} className="arcade-online-player">
          <span>{room.host}</span>
          <small>{openRoomLine(room)}</small>
          <button type="button" className="arcade-btn" disabled={busy} aria-label={`${openRoomAction(room)} ${room.host}'s Room`} onClick={() => onJoin(room.code)}>
            {openRoomAction(room)}
          </button>
        </div>
      ))}
      {!rooms.length && <p>None Right Now. Make Yours Public and Others Can Find It.</p>}
    </div>
  );
}

/**
 * The host's bot count. Bots fill empty seats and step aside when someone joins, so the most it offers is every seat
 * nobody holds. The count follows the room; a press shows at once and the room confirms it.
 */
export function BotStepper({ count, max, onChange, disabled }: { count: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  const label = useId();
  const [pressed, setPressed] = useState(count);
  // The room's word wins whenever it changes, and so does a room that has just filled up.
  useEffect(() => setPressed(count), [count, max]);
  const shown = Math.min(pressed, max);
  const change = (n: number) => {
    if (n < 0 || n > max || n === shown) return;
    sfx.play('select');
    setPressed(n);
    onChange(n);
  };
  const glyph = (d: string) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  return (
    <div className="arcade-field">
      <span id={label}>Bots</span>
      <div className="arcade-stepper" role="group" aria-labelledby={label}>
        <button type="button" aria-label="Fewer Bots" disabled={disabled || shown <= 0} onClick={() => change(shown - 1)}>
          {glyph('M6 12h12')}
        </button>
        <output aria-live="polite">{shown === 0 ? 'None' : shown === 1 ? '1 Bot' : `${shown} Bots`}</output>
        <button type="button" aria-label="More Bots" disabled={disabled || shown >= max} onClick={() => change(shown + 1)}>
          {glyph('M6 12h12M12 6v12')}
        </button>
      </div>
    </div>
  );
}

/** Whole seconds until `at` (a performance.now() time), counted down on screen; null without one. */
function useSecondsTo(at: number | null): number | null {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (at === null) return;
    setNow(performance.now());
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [at]);
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** Focus without scrolling (the laptop screen is projected HTML and must never scroll), once, as it appears. */
const focusOnce = (el: HTMLInputElement | null) => el?.focus({ preventScroll: true });

/**
 * Quick play's card: a name to play under (while it's still blank), then finding a match, then the people in it so far
 * and a countdown to the start, which the room makes on its own. Bots take every seat nobody holds.
 */
export function QuickPanel({
  code,
  linked,
  players,
  seat,
  seats,
  startAt,
  busy,
  error,
  name,
  onName,
  onFind,
  onLeave,
  note,
  setup,
}: {
  code: string;
  /** On the way into a room (or in one). */
  linked: boolean;
  players: RoomPlayer[];
  seat: number | null;
  seats: number;
  /** When the match starts (a performance.now() time), or null until the room says. */
  startAt: number | null;
  busy: boolean;
  error: string;
  name: string;
  onName: (value: string) => void;
  /** Looks for a match (again). */
  onFind: () => void;
  onLeave: () => void;
  /** One line about who else plays, e.g. that bots fill the rest. */
  note?: string;
  setup?: ReactNode;
}) {
  const secs = useSecondsTo(code ? startAt : null);
  const inRoom = !!code && seat !== null;
  const naming = !inRoom && !busy && !linked;
  return (
    <div className="arcade-ov">
      <div className="arcade-card arcade-online-card arcade-quick-card">
        <h2>{inRoom ? 'Match Starting' : 'Play'}</h2>
        {naming ? (
          <>
            <label className="arcade-online-field">
              <span>Your Name</span>
              <input
                ref={focusOnce}
                className="arcade-input"
                value={name}
                maxLength={16}
                autoComplete="nickname"
                onChange={(e) => onName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && name.trim()) onFind();
                }}
              />
            </label>
            <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={!name.trim()} onClick={onFind}>
              {error ? 'Try Again' : 'Find a Match'}
            </button>
          </>
        ) : !inRoom ? (
          <p className="arcade-quick-finding" aria-live="polite">Finding a Match…</p>
        ) : (
          <>
            <div className="arcade-quick-count" aria-live="polite">
              <b>{secs === null || secs > 0 ? secs ?? '…' : 'Go'}</b>
              <span>{secs === 0 ? 'Starting' : 'Starting In'}</span>
            </div>
            <div className="arcade-online-players">
              <strong>Players {players.length}/{seats}</strong>
              {players.map((player) => (
                <div key={player.seat} className="arcade-online-player">
                  <span>{player.name}</span>
                  {player.seat === seat && <small>You</small>}
                </div>
              ))}
            </div>
            {note && <p className="arcade-online-note">{note}</p>}
          </>
        )}
        {setup && <div className="arcade-setup">{setup}</div>}
        <button type="button" className="arcade-btn" onClick={onLeave}>
          {inRoom ? 'Leave' : 'Back'}
        </button>
        {error && <p className="arcade-online-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** The room's code with Copy Link, Share in Lounge and Leave: in the room's lobby, and on its Game Over card. */
export function RoomCode({ game, code, onShare, onLeave }: { game: string; code: string; onShare?: () => void; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?game=${encodeURIComponent(game)}&room=${encodeURIComponent(code)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      return;
    }
  };
  return (
    <div className="arcade-room">
      <div className="arcade-room-code" aria-label={`Room Code ${code}`}>{code}</div>
      <div className="arcade-row">
        <button type="button" className="arcade-btn" onClick={copyLink}>{copied ? 'Copied' : 'Copy Link'}</button>
        {onShare && <button type="button" className="arcade-btn" onClick={onShare}>Share in Lounge</button>}
        <button type="button" className="arcade-btn" onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}

export function OnlinePanel({
  game,
  code,
  players,
  bots = null,
  listed = null,
  visibility = 'private',
  seat,
  seats = 0,
  inProgress = false,
  busy,
  error,
  name,
  onName,
  onVisibility,
  onCreate,
  onJoin,
  onStart,
  onBots,
  onListed,
  onLeave,
  onShare,
  note,
  setup,
  lastCode = '',
  watching = false,
  watchers = [],
  watchable = null,
  onWatchable,
  onTakeSeat,
  onWatchRound,
  setupFirst = false,
}: {
  game: string;
  code: string;
  players: RoomPlayer[];
  /** Bots that would play if the host started now, or null when the room has none to offer. */
  bots?: RoomPlayer[] | null;
  /** Whether the room is public (listed in Open Rooms), or null from a server that does not say. */
  listed?: boolean | null;
  /** The kind of room Create Room makes. */
  visibility?: RoomVisibility;
  seat: number | null;
  /** Room size; shown next to the player count for rooms bigger than two. */
  seats?: number;
  /** A round is already under way; this player joins the next one. */
  inProgress?: boolean;
  busy: boolean;
  error: string;
  name: string;
  onName: (value: string) => void;
  onVisibility?: (v: RoomVisibility) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  /** Host only, in rooms with bots: ask for this many. */
  onBots?: (n: number) => void;
  /** Host only: make the room public or private. */
  onListed?: (on: boolean) => void;
  onLeave: () => void;
  /** Shares the room in the Lounge, to find people to play with. */
  onShare?: () => void;
  /** One line under the title explaining how this game plays online. */
  note?: string;
  /** Settings for the round, shown once in a room (the game decides what guests may change). */
  setup?: ReactNode;
  /** Put the host's setup at the top of the room card, before room settings. */
  setupFirst?: boolean;
  /** The room this player just lost touch with, filled in so they can join it again. */
  lastCode?: string;
  /** In as a spectator: the room's people and what happens next, with nothing to start. */
  watching?: boolean;
  /** Who is watching, and whether the host lets people watch (null: a game nobody can watch). */
  watchers?: string[];
  watchable?: boolean | null;
  /** Host only: let people watch, or not. */
  onWatchable?: (on: boolean) => void;
  /** A spectator takes a free seat for the next round. */
  onTakeSeat?: () => void;
  /** Someone waiting for the next round watches the one under way instead (their seat goes back to the room). */
  onWatchRound?: () => void;
}) {
  const host = seat === 0;
  const botCount = bots?.length ?? 0;
  const stepper = host && bots && onBots ? <BotStepper count={botCount} max={Math.max(0, seats - players.length)} onChange={onBots} disabled={busy} /> : null;
  const publicity = host && listed !== null && onListed ? <VisibilityPicker value={listed ? 'public' : 'private'} onChange={(v) => onListed(v === 'public')} /> : null;
  const spectators = host && watchable !== null && onWatchable ? <WatchPicker value={watchable} onChange={onWatchable} /> : null;
  const freeSeat = players.length < seats;
  const [joinCode, setJoinCode] = useState(lastCode);
  useEffect(() => {
    if (lastCode) setJoinCode(lastCode);
  }, [lastCode]);

  return (
    <div className="arcade-ov">
      <div className="arcade-card arcade-online-card">
        <h2>{watching ? 'Watching' : code ? 'Online Room' : 'Play Online'}</h2>
        {note && !code && <p className="arcade-online-note">{note}</p>}
        {!code ? (
          <>
            <label className="arcade-online-field">
              <span>Your Name</span>
              <input className="arcade-input" value={name} maxLength={16} autoComplete="nickname" onChange={(e) => onName(e.target.value)} />
            </label>
            {onVisibility && (
              <div className="arcade-setup">
                <VisibilityPicker value={visibility} onChange={onVisibility} />
              </div>
            )}
            <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={busy || !name.trim()} onClick={onCreate}>
              {busy ? 'Creating Room…' : visibility === 'public' ? 'Create Public Room' : 'Create Room'}
            </button>
            <div className="arcade-online-divider"><span>Or Join</span></div>
            <form
              className="arcade-online-join"
              onSubmit={(e) => {
                e.preventDefault();
                if (joinCode.length === 4 && !busy) onJoin(joinCode);
              }}
            >
              <input
                className="arcade-input arcade-online-code-input"
                type="text"
                aria-label="Room Code"
                placeholder="Four-Character Code"
                maxLength={4}
                autoCapitalize="characters"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, '').slice(0, 4))}
              />
              <button type="submit" className="arcade-btn" disabled={busy || joinCode.length !== 4}>
                {lastCode && joinCode === lastCode ? 'Rejoin' : 'Join'}
              </button>
            </form>
            <OpenRoomList game={game} busy={busy} onJoin={onJoin} />
            <button type="button" className="arcade-btn" onClick={onLeave}>
              Back
            </button>
          </>
        ) : (
          <>
            <RoomCode game={game} code={code} onShare={onShare} onLeave={onLeave} />
            <div className="arcade-online-players">
              <strong>Players{seats > 2 && ` ${players.length + botCount}/${seats}`}</strong>
              {players.map((player) => (
                <div key={player.seat} className="arcade-online-player">
                  <span>{player.name}</span>
                  {player.seat === 0 && <small>Host</small>}
                  {player.seat === seat && <small>You</small>}
                </div>
              ))}
              {!!botCount && (
                // One line for every bot, so a room of eight still leaves Start in view on a phone.
                <div className="arcade-online-player is-bot" title={bots!.map((bot) => bot.name).join(', ')}>
                  <span>{bots!.map((bot) => bot.name).join(', ')}</span>
                  <small>{botCount === 1 ? 'Bot' : `${botCount} Bots`}</small>
                </div>
              )}
              {!!watchers.length && (
                <div className="arcade-online-player is-watching" title={watchers.join(', ')}>
                  <span>{watchers.join(', ')}</span>
                  <small>{watchers.length} Watching</small>
                </div>
              )}
              {players.length + botCount < 2 && <p>{stepper ? 'Waiting For Another Player, Or Add A Bot' : 'Waiting For Another Player'}</p>}
              {!host && !watching && listed && <p>A Public Room: Anyone Can Join From Open Rooms.</p>}
            </div>
            {setupFirst && host && !watching && setup && <div className="arcade-setup">{setup}</div>}
            {(publicity || spectators || stepper || (setup && !watching)) && (
              <div className="arcade-setup">
                {publicity}
                {spectators}
                {stepper}
                {!watching && !setupFirst && setup}
              </div>
            )}
            {watching ? (
              <>
                <p>{inProgress ? 'A Round Is Under Way. It Shows Here in a Moment.' : 'You Are Watching. The Round Shows Here When the Host Starts It.'}</p>
                {onTakeSeat && freeSeat && !inProgress && (
                  <button type="button" className="arcade-btn arcade-btn-primary" disabled={busy} onClick={onTakeSeat}>
                    Play Instead
                  </button>
                )}
              </>
            ) : host ? (
              <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={busy || players.length + botCount < 2} onClick={onStart}>
                Start Game
              </button>
            ) : (
              <>
                <p>{inProgress ? 'A Round Is In Progress. You Will Join The Next One.' : 'Waiting For The Host To Start'}</p>
                {inProgress && watchable && onWatchRound && (
                  <button type="button" className="arcade-btn" onClick={onWatchRound}>
                    Watch This Round
                  </button>
                )}
              </>
            )}
          </>
        )}
        {error && <p className="arcade-online-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
