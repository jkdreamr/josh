import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BoardList, BoardScopeNote, useRoundBoard, validName } from '../arcade/kit/board';
import { ARCADE_API, NAME_MAX, formatBoardScore, savedName, saveName, type BoardInfo } from '../arcade/kit/leaderboard';
import { ROOM_VISIBILITY, useOpenRooms, type RoomVisibility } from '../arcade/kit/online';
import { nextOnlineRound, openRoomLine } from '../arcade/kit/online-core';
import { createRoom, RoomLink, type RoomPlayer, type RoomTransport } from '../arcade/kit/room';
import { useSetting } from '../arcade/kit/settings';
import { usePlayingReport } from '../arcade/playing';
import { OSContext } from '../types';
import './online-room.css';

/**
 * Online rooms for the desktop game apps (Baduk, Badminton). Same Worker, room codes and invite
 * links as the arcade's GameShell, without the arcade overlays: the app draws its own lobby with
 * <RoomPanel> and plays rounds through send/onMessage.
 */
export type AppRoomStatus = 'idle' | 'lobby' | 'playing';
export type AppRoom = ReturnType<typeof useAppRoom>;

type Handlers = {
  /** A round began (first start or a rematch). Seat 0 is the host. */
  onStart?: (round: number, seat: number, players: RoomPlayer[]) => void;
  /** The room ended: the host or the opponent left, or the connection dropped. */
  onEnd?: (reason: string) => void;
};

export const onlineAvailable = !!ARCADE_API;

export function useAppRoom(game: string, handlers: Handlers = {}) {
  const [status, setStatus] = useState<AppRoomStatus>('idle');
  const [code, setCode] = useState('');
  const [seat, setSeat] = useState<number | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [round, setRound] = useState(0);
  /** The game the room was created for, from the server. A guest may join from a different mode. */
  const [roomGame, setRoomGame] = useState('');
  const [transport, setTransport] = useState<RoomTransport>('relay');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => savedName());
  /** Whether the room is public (null: the server doesn't say), and the kind of room Create Room makes. */
  const [listed, setListedState] = useState<boolean | null>(null);
  const [visibility, setVisibility] = useSetting(ROOM_VISIBILITY);
  const linkRef = useRef<RoomLink | null>(null);
  const roundRef = useRef(0);
  const statusRef = useRef<AppRoomStatus>('idle');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const reset = useCallback((message = '') => {
    linkRef.current?.close();
    linkRef.current = null;
    roundRef.current = 0;
    statusRef.current = 'idle';
    setStatus('idle');
    setCode('');
    setSeat(null);
    setPlayers([]);
    setRound(0);
    setRoomGame('');
    setTransport('relay');
    setListedState(null);
    setError(message);
  }, []);

  const connect = useCallback((roomCode: string) => {
    linkRef.current?.close();
    setError('');
    const clean = name.trim();
    if (clean) saveName(clean);
    const link = new RoomLink(roomCode.toUpperCase(), clean || 'Player');
    linkRef.current = link;
    roundRef.current = 0;
    statusRef.current = 'lobby';
    setStatus('lobby');
    setCode(link.code);
    setSeat(null);
    setPlayers([]);
    setRound(0);
    link.on('welcome', (message) => {
      setSeat(message.seat);
      setRoomGame(message.game);
      setCode(message.code);
      setPlayers(message.players);
    });
    link.on('players', (list) => {
      if (linkRef.current !== link) return;
      setPlayers(list);
      if (statusRef.current === 'playing' && list.length < 2) {
        reset('Your opponent left the room.');
        handlersRef.current.onEnd?.('opponent-left');
      }
    });
    link.on('transport', setTransport);
    link.on('listed', (on) => linkRef.current === link && setListedState(on));
    link.on('start', ({ players: list, round: serverRound }) => {
      if (linkRef.current !== link || link.seat === null) return;
      roundRef.current = nextOnlineRound(roundRef.current, serverRound);
      statusRef.current = 'playing';
      setStatus('playing');
      setPlayers(list);
      setRound(roundRef.current);
      handlersRef.current.onStart?.(roundRef.current, link.seat, list);
    });
    link.on('closed', ({ reason }) => {
      if (linkRef.current !== link) return;
      reset(reason === 'host-left' ? 'The host left the room.' : 'The connection was lost.');
      handlersRef.current.onEnd?.(reason);
    });
  }, [name, reset]);

  const create = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      connect(await createRoom(game, { listed: visibility === 'public' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could Not Create A Room');
    } finally {
      setBusy(false);
    }
  }, [connect, game, visibility]);

  const join = useCallback((roomCode: string) => {
    try {
      connect(roomCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could Not Join Room');
    }
  }, [connect]);

  const leave = useCallback(() => reset(''), [reset]);
  const start = useCallback(() => linkRef.current?.start(), []);
  const setListed = useCallback((on: boolean) => linkRef.current?.setListed(on), []);
  const send = useCallback((d: unknown, options?: { fast?: boolean }) => linkRef.current?.send(d, options), []);
  const onMessage = useCallback((listener: (from: number, d: unknown) => void) => {
    const link = linkRef.current;
    if (!link) return () => {};
    return link.on('msg', ({ from, d }) => listener(from, d));
  }, []);
  const reportResult = useCallback((winner: number | null) => linkRef.current?.reportResult(roundRef.current, winner), []);

  useEffect(() => () => linkRef.current?.close(), []);

  const opponent = players.find((player) => player.seat !== seat);
  return { game, roomGame, status, code, seat, players, opponent, round, transport, busy, error, name, setName, visibility, setVisibility, listed, setListed, create, join, leave, start, send, onMessage, reportResult, isHost: seat === 0, linked: !!code };
}

/** Joins a room once, from an invite link the OS passed in as app args. */
export function useInvite(room: AppRoom, inviteCode: string | undefined, nonce: number | undefined, enter: () => void) {
  const consumed = useRef<string | null>(null);
  useEffect(() => {
    if (!inviteCode || !onlineAvailable) return;
    const key = `${inviteCode}:${nonce ?? 0}`;
    if (consumed.current === key) return;
    consumed.current = key;
    enter();
    room.join(inviteCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, nonce]);
}

const visibilityNotes: Record<RoomVisibility, string> = {
  private: 'Only people with the code or link can join.',
  public: 'Anyone can find it in Open Rooms and join.',
};

/** Private or public, in the apps' own controls: a public room is listed in the arcade's Open Rooms. */
function VisibilitySeg({ value, onChange }: { value: RoomVisibility; onChange: (v: RoomVisibility) => void }) {
  return (
    <div className="oroom-field">
      <span className="glabel">Room</span>
      <div className="gseg" role="group" aria-label="Room">
        <button type="button" aria-pressed={value === 'private'} onClick={() => onChange('private')}>Private</button>
        <button type="button" aria-pressed={value === 'public'} onClick={() => onChange('public')}>Public</button>
      </div>
      <span className="ghelp">{visibilityNotes[value]}</span>
    </div>
  );
}

/** Open rooms for this app's game, each with a Join button. Hidden until Open Rooms answers. */
function OpenRoomRows({ room }: { room: AppRoom }) {
  const rooms = useOpenRooms(room.game);
  if (!rooms) return null;
  return (
    <section className="oroom-open" aria-label="Open Rooms">
      <span className="glabel">Open Rooms</span>
      {rooms.length ? (
        <ul className="oroom-players">
          {rooms.map((open) => (
            <li key={open.code}>
              <span>{open.host}</span>
              <small>{openRoomLine(open)}</small>
              <button type="button" className="gbtn gbtn-sm" disabled={!validName(room.name)} aria-label={`Join ${open.host}'s Room`} onClick={() => room.join(open.code)}>
                Join
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="oroom-note">None right now. Make yours public and others can find it.</p>
      )}
    </section>
  );
}

/** Tells the Lounge this app's game is open, with the room while it's public so people there can join. */
export function usePlayingRoom(game: string, room: AppRoom) {
  usePlayingReport(game, room.linked && room.listed && room.code ? room.code : null);
}

/** Lobby for an app room: name, create or join with a code, then the code, players and Start. */
export function RoomPanel({ room, title, note, startLabel = 'Start Game' }: { room: AppRoom; title: string; note?: string; startLabel?: string }) {
  const os = useContext(OSContext);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const link = room.code ? `${location.origin}/?game=${encodeURIComponent(room.game)}&room=${encodeURIComponent(room.code)}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      return;
    }
  };

  if (!onlineAvailable) return <section className="oroom"><p className="oroom-note">Online play is unavailable right now.</p></section>;

  return (
    <section className="oroom" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
      {!room.linked ? (
        <>
          {note && <p className="oroom-note">{note}</p>}
          <label className="oroom-field">
            <span className="glabel">Your Name</span>
            <input className="ginput" value={room.name} maxLength={NAME_MAX} autoComplete="nickname" spellCheck={false} onChange={(e) => room.setName(e.target.value)} />
          </label>
          <VisibilitySeg value={room.visibility} onChange={room.setVisibility} />
          <button type="button" className="gbtn gbtn-primary" disabled={room.busy || !validName(room.name)} onClick={room.create}>
            {room.busy ? 'Creating Room…' : room.visibility === 'public' ? 'Create Public Room' : 'Create Room'}
          </button>
          <form
            className="oroom-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (joinCode.length === 4 && validName(room.name)) room.join(joinCode);
            }}
          >
            <input
              className="ginput"
              aria-label="Room Code"
              placeholder="Room Code"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, '').slice(0, 4))}
            />
            <button type="submit" className="gbtn" disabled={joinCode.length !== 4 || !validName(room.name)}>
              Join
            </button>
          </form>
          <OpenRoomRows room={room} />
        </>
      ) : (
        <>
          <div className="oroom-code" aria-label={`Room Code ${room.code}`}>{room.code}</div>
          <div className="oroom-row">
            <button type="button" className="gbtn" onClick={copyLink}>{copied ? 'Copied' : 'Copy Link'}</button>
            {os && (
              <button type="button" className="gbtn" onClick={() => os.open('lounge', { invite: { game: room.game, code: room.code } })}>
                Share in Lounge
              </button>
            )}
            <button type="button" className="gbtn" onClick={room.leave}>Leave</button>
          </div>
          <ul className="oroom-players" aria-label="Players">
            {room.players.map((player) => (
              <li key={player.seat}>
                <span>{player.name}</span>
                {player.seat === 0 && <small>Host</small>}
                {player.seat === room.seat && <small>You</small>}
              </li>
            ))}
          </ul>
          {room.isHost && room.listed !== null && room.status !== 'playing' && <VisibilitySeg value={room.listed ? 'public' : 'private'} onChange={(v) => room.setListed(v === 'public')} />}
          {!room.isHost && room.listed && <p className="oroom-note">A public room: anyone can join from Open Rooms.</p>}
          {room.players.length < 2 ? (
            <p className="oroom-note">{room.listed ? 'Waiting for another player. Anyone can find this room in Open Rooms.' : 'Waiting for another player. Share the code or the link.'}</p>
          ) : room.isHost ? (
            room.status !== 'playing' && (
              <button type="button" className="gbtn gbtn-primary" onClick={room.start}>
                {startLabel}
              </button>
            )
          ) : (
            room.status !== 'playing' && <p className="oroom-note">Waiting for the host to start.</p>
          )}
        </>
      )}
      {room.error && <p className="oroom-error" role="alert">{room.error}</p>}
    </section>
  );
}

/**
 * Leaderboard card for a finished game in an app: offers the name field when the score makes the
 * top 100 and shows the board. `round` changes for every finished game so each one loads fresh.
 */
export function AppBoard({ board, score, round }: { board: BoardInfo; score: number; round: number }) {
  // Callers rebuild the board info on every render; keep one spec per board so the board loads once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spec = useMemo(() => board.spec, [board.id]);
  const state = useRoundBoard(board.id, spec, score, round);
  const [name, setName] = useState(() => savedName());
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => formatBoardScore(n, spec);
  return (
    <section className="oboard" aria-label={`${board.title} Leaderboard`} onKeyDown={(e) => e.stopPropagation()}>
      <div className="oboard-head">
        <b>{board.title}</b>
        <span>{spec.measure ? `${spec.measure}: ` : ''}{fmt(score)}</span>
      </div>
      {state.canSubmit && (
        <form
          className="oroom-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (validName(name) && !state.busy) state.submit(name).then(() => setOpen(true));
          }}
        >
          <input className="ginput" aria-label="Your Name" placeholder="Your Name" maxLength={NAME_MAX} autoComplete="nickname" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="gbtn gbtn-primary" disabled={!validName(name) || state.busy}>
            Submit
          </button>
        </form>
      )}
      {open ? (
        <>
          <BoardScopeNote board={state.board} />
          <BoardList board={state.board} fmt={fmt} mine={state.mine} />
          <button type="button" className="gbtn gbtn-plain" onClick={() => setOpen(false)}>Hide Leaderboard</button>
        </>
      ) : (
        <button type="button" className="gbtn gbtn-plain" onClick={() => setOpen(true)}>
          {state.canSubmit ? 'A Top 100 Score. View Leaderboard' : 'View Leaderboard'}
        </button>
      )}
    </section>
  );
}
