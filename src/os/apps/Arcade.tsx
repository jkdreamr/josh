import { useState } from 'react';
import { ArcadePage } from '../arcade/ArcadePage';
import { GameFrame } from '../arcade/GameFrame';
import { ArcadeHost } from '../arcade/kit/host';
import type { AppProps } from '../types';
import './Arcade.css';

/** The chrome://games arcade as its own app: pick a tile to play, the shell's back button returns to the grid. */
export default function Arcade(_: AppProps) {
  const [game, setGame] = useState<string | null>(null);
  return (
    <div className="arcade-app">
      {game ? (
        <div className="arcade-app-game">
          <ArcadeHost.Provider value={{ active: true }}>
            <GameFrame key={game} id={game} onExit={() => setGame(null)} />
          </ArcadeHost.Provider>
        </div>
      ) : (
        <ArcadePage onOpen={setGame} />
      )}
    </div>
  );
}
