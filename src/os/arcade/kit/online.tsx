import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Segmented } from './controls';
import { defineSetting } from './settings';
import { ARCADE_API } from './leaderboard';
import { openRoomLine, type OpenRoom } from './online-core';
import { listRooms, RoomLink, type RoomPlayer, type RoomTransport } from './room';
import { sfx } from './sfx';

type OnlineValue = {
  link: RoomLink;
  seat: number;
  seats: number;
  round: number;
  players: RoomPlayer[];
  /** Computer players: this round's while one is under way, otherwise the ones the host has added so far. */
  bots: RoomPlayer[];
  isHost: boolean;
  transport: RoomTransport;
};

const OnlineContext = createContext<OnlineValue | null>(null);

export function OnlineProvider({
  link,
  seat,
  seats,
  round,
  players,
  bots,
  transport,
  children,
}: Omit<OnlineValue, 'seat' | 'link' | 'isHost'> & { link: RoomLink | null; seat: number | null; children: ReactNode }) {
  const value = useMemo(
    () => link && seat !== null ? { link, seat, seats, round, players, bots, isHost: seat === 0, transport } : null,
    [link, seat, seats, round, players, bots, transport],
  );
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
}

export function useOnline() {
  const room = useContext(OnlineContext);
  return useMemo(() => {
    if (!room) return null;
    return {
      seat: room.seat,
      seats: room.seats,
      round: room.round,
      players: room.players,
      bots: room.bots,
      isHost: room.isHost,
      transport: room.transport,
      send: (d: unknown, options?: { to?: number; fast?: boolean }) => room.link.send(d, options),
      onMessage: (listener: (from: number, d: unknown) => void) =>
        room.link.on('msg', ({ from, d }) => listener(from, d)),
      reportResult: (round: number, winner: number | null) => room.link.reportResult(round, winner),
    };
  }, [room]);
}

/**
 * Public rooms someone can join now, for one game or every game, asked again every few seconds while the page is
 * visible. Null until the first answer, and whenever Open Rooms can't be reached (a Worker from before them included).
 */
export function useOpenRooms(game?: string, every = 6000): OpenRoom[] | null {
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  useEffect(() => {
    if (!ARCADE_API) return;
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
  }, [game, every]);
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

/** This game's open rooms, each with a Join button. Hidden until Open Rooms answers. */
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
          <button type="button" className="arcade-btn" disabled={busy} aria-label={`Join ${room.host}'s Room`} onClick={() => onJoin(room.code)}>
            Join
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
  note,
  setup,
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
  /** One line under the title explaining how this game plays online. */
  note?: string;
  /** Settings for the round, shown once in a room (the game decides what guests may change). */
  setup?: ReactNode;
}) {
  const host = seat === 0;
  const botCount = bots?.length ?? 0;
  const stepper = host && bots && onBots ? <BotStepper count={botCount} max={Math.max(0, seats - players.length)} onChange={onBots} disabled={busy} /> : null;
  const publicity = host && listed !== null && onListed ? <VisibilityPicker value={listed ? 'public' : 'private'} onChange={(v) => onListed(v === 'public')} /> : null;
  const link = code ? `${location.origin}/?game=${encodeURIComponent(game)}&room=${encodeURIComponent(code)}` : '';
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      return;
    }
  };

  return (
    <div className="arcade-ov">
      <div className="arcade-card arcade-online-card">
        <h2>{code ? 'Online Room' : 'Play Online'}</h2>
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
                Join
              </button>
            </form>
            <OpenRoomList game={game} busy={busy} onJoin={onJoin} />
            <button type="button" className="arcade-btn" onClick={onLeave}>
              Back
            </button>
          </>
        ) : (
          <>
            <div className="arcade-room-code" aria-label={`Room Code ${code}`}>{code}</div>
            <div className="arcade-row">
              <button type="button" className="arcade-btn" onClick={copyLink}>{copied ? 'Copied' : 'Copy Link'}</button>
              <button type="button" className="arcade-btn" onClick={onLeave}>Leave</button>
            </div>
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
              {players.length + botCount < 2 && <p>{stepper ? 'Waiting For Another Player, Or Add A Bot' : 'Waiting For Another Player'}</p>}
              {!host && listed && <p>A Public Room: Anyone Can Join From Open Rooms.</p>}
            </div>
            {(publicity || stepper || setup) && (
              <div className="arcade-setup">
                {publicity}
                {stepper}
                {setup}
              </div>
            )}
            {host ? (
              <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={busy || players.length + botCount < 2} onClick={onStart}>
                Start Game
              </button>
            ) : (
              <p>{inProgress ? 'A Round Is In Progress. You Will Join The Next One.' : 'Waiting For The Host To Start'}</p>
            )}
          </>
        )}
        {error && <p className="arcade-online-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
