import { useState } from 'react';
import { getAppGame } from './apps';
import { useOpenRooms } from './kit/online';
import { openRoomAction, openRoomLine, type OpenRoom } from './kit/online-core';
import { getMeta } from './manifest';

/** Rooms shown before Show All, so a busy evening doesn't push the games out of sight. */
const FIRST = 6;

/** Public rooms anyone can join (or watch) right now, across every game, as tiles above the games. Hidden when there are none. */
export function OpenRooms({ onJoin }: { onJoin: (game: string, code: string) => void }) {
  const rooms = useOpenRooms();
  const [all, setAll] = useState(false);
  if (!rooms?.length) return null;
  return (
    <section className="arcade-section arcade-open" aria-label="Open Rooms">
      <h2>Open Rooms</h2>
      <div className="arcade-grid">
        {(all ? rooms : rooms.slice(0, FIRST)).map((room) => (
          <RoomTile key={room.code} room={room} onJoin={onJoin} />
        ))}
      </div>
      {rooms.length > FIRST && (
        <button type="button" className="arcade-pbtn arcade-open-more" onClick={() => setAll(!all)}>
          {all ? 'Show Fewer' : `Show All ${rooms.length} Rooms`}
        </button>
      )}
    </section>
  );
}

function RoomTile({ room, onJoin }: { room: OpenRoom; onJoin: (game: string, code: string) => void }) {
  // Arcade games have a tile of their own; the desktop app games (Go, Omok, Badminton) carry a look in apps.ts.
  const game = getMeta(room.game) ?? getAppGame(room.game);
  const title = game?.title ?? room.game;
  return (
    <button className="arcade-tile arcade-open-tile" style={{ ['--accent' as string]: game?.accent ?? '#636366' }} aria-label={`${openRoomAction(room)} ${room.host}'s ${title} Room`} onClick={() => onJoin(room.game, room.code)}>
      <span className="arcade-tile-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={game?.glyph ?? 'M5 12h14M12 5v14'} />
        </svg>
      </span>
      <span className="arcade-tile-text">
        <span className="arcade-tile-top">
          <b>{title}</b>
          <em>{openRoomLine(room)}</em>
        </span>
        <span className="arcade-tile-blurb">
          {room.host}'s room, {room.watchOnly ? 'playing now, watch it live' : room.started ? 'join for the next round' : 'waiting to start'}.
        </span>
      </span>
      <span className="arcade-open-join" aria-hidden="true">
        {openRoomAction(room)}
      </span>
    </button>
  );
}
