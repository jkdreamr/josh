import { GameFrame } from '../arcade/GameFrame';
import { ArcadeHost } from '../arcade/kit/host';
import type { AppProps } from '../types';
import './CoxBox.css';

/** The Cox Box typing regatta from the arcade, full window. Invite links open here with their room code. */
export default function CoxBox({ args }: AppProps) {
  return (
    <div className="coxbox-app">
      <ArcadeHost.Provider value={{ active: true }}>
        <GameFrame id="coxbox" roomCode={args.room} />
      </ArcadeHost.Provider>
    </div>
  );
}
