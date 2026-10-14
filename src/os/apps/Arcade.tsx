import { useEffect, useRef, useState } from 'react';
import { ArcadePage } from '../arcade/ArcadePage';
import { GameFrame } from '../arcade/GameFrame';
import { ArcadeHost } from '../arcade/kit/host';
import { hasGame } from '../arcade/manifest';
import type { AppProps } from '../types';
import './Arcade.css';

/** The chrome://games arcade as its own app: pick a tile to play, the shell's back button returns to the grid. */
export default function Arcade({ args }: AppProps) {
  const opening = !!args.play && hasGame(args.play);
  const [game, setGame] = useState<string | null>(() => (opening ? args.play! : null));
  /** A room picked from Open Rooms or joined from the Lounge, which the game joins as it opens. */
  const [room, setRoom] = useState<string | undefined>(() => (opening ? args.room : undefined));
  // Opened again with a game (Join in the Lounge while the Arcade is already open): switch to it.
  const seen = useRef(args.nonce);
  useEffect(() => {
    if (args.nonce === seen.current) return;
    seen.current = args.nonce;
    if (!args.play || !hasGame(args.play)) return;
    setRoom(args.room);
    setGame(args.play);
  }, [args.nonce, args.play, args.room]);
  return (
    <div className="arcade-app">
      {game ? (
        <div className="arcade-app-game">
          <ArcadeHost.Provider value={{ active: true }}>
            <GameFrame key={`${game}:${room ?? ''}`} id={game} roomCode={room} onExit={() => { setGame(null); setRoom(undefined); }} resume={{ app: 'arcade', args: { play: game } }} />
          </ArcadeHost.Provider>
        </div>
      ) : (
        <ArcadePage onOpen={(id, code) => { setRoom(code); setGame(id); }} />
      )}
    </div>
  );
}
