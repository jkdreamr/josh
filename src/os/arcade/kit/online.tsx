import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { RoomLink, type RoomPlayer, type RoomTransport } from './room';

type OnlineValue = {
  link: RoomLink;
  seat: number;
  seats: number;
  players: RoomPlayer[];
  isHost: boolean;
  transport: RoomTransport;
};

const OnlineContext = createContext<OnlineValue | null>(null);

export function OnlineProvider({
  link,
  seat,
  seats,
  players,
  transport,
  children,
}: Omit<OnlineValue, 'seat' | 'link' | 'isHost'> & { link: RoomLink | null; seat: number | null; children: ReactNode }) {
  const value = useMemo(
    () => link && seat !== null ? { link, seat, seats, players, isHost: seat === 0, transport } : null,
    [link, seat, seats, players, transport],
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
      players: room.players,
      isHost: room.isHost,
      transport: room.transport,
      send: (d: unknown, options?: { to?: number; fast?: boolean }) => room.link.send(d, options),
      onMessage: (listener: (from: number, d: unknown) => void) =>
        room.link.on('msg', ({ from, d }) => listener(from, d)),
      reportResult: (round: number, winner: number | null) => room.link.reportResult(round, winner),
    };
  }, [room]);
}

export function OnlinePanel({
  game,
  code,
  players,
  seat,
  busy,
  error,
  name,
  onName,
  onCreate,
  onJoin,
  onStart,
  onLeave,
}: {
  game: string;
  code: string;
  players: RoomPlayer[];
  seat: number | null;
  busy: boolean;
  error: string;
  name: string;
  onName: (value: string) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const host = seat === 0;
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
        {!code ? (
          <>
            <label className="arcade-online-field">
              <span>Your Name</span>
              <input className="arcade-input" value={name} maxLength={16} autoComplete="nickname" onChange={(e) => onName(e.target.value)} />
            </label>
            <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={busy || !name.trim()} onClick={onCreate}>
              {busy ? 'Creating Room…' : 'Create Room'}
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
          </>
        ) : (
          <>
            <div className="arcade-room-code" aria-label={`Room Code ${code}`}>{code}</div>
            <div className="arcade-row">
              <button type="button" className="arcade-btn" onClick={copyLink}>{copied ? 'Copied' : 'Copy Link'}</button>
              <button type="button" className="arcade-btn" onClick={onLeave}>Leave</button>
            </div>
            <div className="arcade-online-players">
              <strong>Players</strong>
              {players.map((player) => (
                <div key={player.seat} className="arcade-online-player">
                  <span>{player.name}</span>
                  {player.seat === 0 && <small>Host</small>}
                  {player.seat === seat && <small>You</small>}
                </div>
              ))}
              {players.length < 2 && <p>Waiting For Another Player</p>}
            </div>
            {host ? (
              <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={busy || players.length < 2} onClick={onStart}>
                Start Game
              </button>
            ) : (
              <p>Waiting For The Host To Start</p>
            )}
          </>
        )}
        {error && <p className="arcade-online-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
