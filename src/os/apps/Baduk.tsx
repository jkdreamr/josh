import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BLACK, groupStones, newGame, pass, play, resign, score, undo, WHITE, type GameState, type Ownership, type Point } from '../games/go';
import { useOS, type AppProps } from '../types';
import './Baduk.css';

type Mode = 'computer' | 'friend';
type WorkerResponse =
  | { id: number; type: 'ai'; move: Point | null }
  | { id: number; type: 'ownership'; values: Ownership[] };

const START = 44;
const SPACING = 41.5;
const SIZE = 420;
const LETTERS = 'ABCDEFGHJ';
const pointPosition = (index: number) => START + index * SPACING;

function pointFromPointer(event: ReactPointerEvent<SVGSVGElement>): Point | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * SIZE;
  const y = ((event.clientY - rect.top) / rect.height) * SIZE;
  const pointX = Math.round((x - START) / SPACING);
  const pointY = Math.round((y - START) / SPACING);
  if (pointX < 0 || pointY < 0 || pointX >= 9 || pointY >= 9) return null;
  if (Math.abs(x - pointPosition(pointX)) > SPACING * 0.48 || Math.abs(y - pointPosition(pointY)) > SPACING * 0.48) return null;
  return { x: pointX, y: pointY };
}

export default function Baduk(_: AppProps) {
  const os = useOS();
  const [game, setGame] = useState<GameState>(() => newGame(9));
  const [mode, setMode] = useState<Mode>('computer');
  const [difficulty, setDifficulty] = useState<'easy' | 'normal'>('normal');
  const [hovered, setHovered] = useState<Point | null>(null);
  const [deadSet, setDeadSet] = useState<Set<number>>(() => new Set());
  const [counted, setCounted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const gameRef = useRef(game);
  const modeRef = useRef(mode);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  gameRef.current = game;
  modeRef.current = mode;

  useEffect(() => {
    const worker = new Worker(new URL('../games/go.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.id !== jobRef.current) return;
      if (response.type === 'ai') {
        setThinking(false);
        setGame((current) => {
          if (modeRef.current !== 'computer' || current.phase !== 'play' || current.toPlay !== WHITE) return current;
          if (!response.move) return pass(current);
          const result = play(current, response.move.x, response.move.y);
          return result.ok ? result.state : current;
        });
        return;
      }
      const current = gameRef.current;
      setAnalyzing(false);
      if (current.phase !== 'mark') return;
      const dead = new Set<number>();
      response.values.forEach((point, index) => {
        const stone = current.board[index];
        if ((stone === BLACK && point.white > 0.7) || (stone === WHITE && point.black > 0.7)) dead.add(index);
      });
      setDeadSet(dead);
      setAnalysisReady(true);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'computer' || game.phase !== 'play' || game.toPlay !== WHITE) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setThinking(true);
    worker.postMessage({ id, type: 'ai', state: game, budgetMs: difficulty === 'easy' ? 150 : 700 });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [mode, game, difficulty]);

  useEffect(() => {
    if (game.phase !== 'mark' || analysisReady) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setAnalyzing(true);
    worker.postMessage({ id, type: 'ownership', state: game, playouts: 400 });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [game, analysisReady]);

  const startNewGame = () => {
    jobRef.current += 1;
    setGame(newGame(9));
    setDeadSet(new Set());
    setCounted(false);
    setThinking(false);
    setAnalyzing(false);
    setAnalysisReady(false);
  };

  const placeStone = (point: Point) => {
    if (game.phase === 'mark') {
      const group = groupStones(game, point.x, point.y);
      if (!group.length) return;
      setDeadSet((current) => {
        const next = new Set(current);
        const shouldAdd = group.some((index) => !next.has(index));
        group.forEach((index) => shouldAdd ? next.add(index) : next.delete(index));
        return next;
      });
      setCounted(false);
      return;
    }
    if (thinking || game.phase !== 'play') return;
    const result = play(game, point.x, point.y);
    if (result.ok) {
      setGame(result.state);
      setCounted(false);
    }
  };

  const onBoardPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'mouse' || !window.matchMedia('(pointer: fine)').matches) {
      setHovered(null);
      return;
    }
    setHovered(pointFromPointer(event));
  };

  const undoTurn = () => {
    jobRef.current += 1;
    setThinking(false);
    setGame((current) => {
      let previous = undo(current);
      if (!previous) return current;
      if (modeRef.current === 'computer' && current.toPlay === BLACK && previous.toPlay === WHITE) {
        previous = undo(previous) ?? previous;
      }
      return previous;
    });
    setDeadSet(new Set());
    setCounted(false);
    setAnalysisReady(false);
  };

  const passTurn = () => {
    if (thinking || game.phase !== 'play') return;
    setGame(pass(game));
    setCounted(false);
  };

  const letters = Array.from({ length: 9 }, (_, index) => LETTERS[index] ?? '');
  const shownScore = counted ? score(game, deadSet) : null;
  const hoverIndex = hovered ? hovered.y * game.size + hovered.x : -1;
  const canHover = game.phase === 'play' && !thinking && hovered && game.board[hoverIndex] === 0;

  return (
    <div className={`baduk-app ${os.mobile ? 'is-mobile' : ''}`}>
      <header className="baduk-header">
        <div>
          <span className="baduk-eyebrow">an old favorite</span>
          <h1>baduk <span>바둑</span></h1>
        </div>
        <p>grew up playing this. 9x9, area scoring, 7.5 komi.</p>
      </header>
      <main className="baduk-main">
        <div className="baduk-board-wrap">
          <svg
            className="baduk-board"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label="9 by 9 Go board"
            onPointerMove={onBoardPointerMove}
            onPointerLeave={() => setHovered(null)}
            onPointerUp={(event) => {
              const point = pointFromPointer(event);
              if (point) placeStone(point);
            }}
          >
            <defs>
              <linearGradient id="baduk-kaya" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#dfb87b" />
                <stop offset="0.52" stopColor="#d7ad6e" />
                <stop offset="1" stopColor="#c99a5a" />
              </linearGradient>
              <radialGradient id="baduk-black" cx="34%" cy="28%">
                <stop offset="0" stopColor="#5f6260" />
                <stop offset="0.42" stopColor="#272927" />
                <stop offset="1" stopColor="#090a0a" />
              </radialGradient>
              <radialGradient id="baduk-white" cx="32%" cy="25%">
                <stop offset="0" stopColor="#fff" />
                <stop offset="0.52" stopColor="#f4f0e7" />
                <stop offset="1" stopColor="#c9c3b7" />
              </radialGradient>
              <pattern id="baduk-grain" width="31" height="17" patternUnits="userSpaceOnUse">
                <path d="M0 4c8-2 14 1 23 0M5 13c7 1 15-2 25-1" fill="none" stroke="#82562d" strokeOpacity=".1" strokeWidth=".7" />
              </pattern>
              <filter id="baduk-stone-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="1.2" dy="2" stdDeviation="1.5" floodColor="#4a331b" floodOpacity=".35" />
              </filter>
            </defs>
            <rect x="22" y="22" width="376" height="376" rx="4" fill="url(#baduk-kaya)" />
            <rect x="22" y="22" width="376" height="376" rx="4" fill="url(#baduk-grain)" />
            {Array.from({ length: 9 }, (_, index) => {
              const pos = pointPosition(index);
              return (
                <g key={index}>
                  <line x1={START} x2={pointPosition(8)} y1={pos} y2={pos} className="baduk-grid-line" />
                  <line x1={pos} x2={pos} y1={START} y2={pointPosition(8)} className="baduk-grid-line" />
                  <text x={pos} y="16" className="baduk-coordinate">{letters[index]}</text>
                  <text x={pos} y="410" className="baduk-coordinate">{letters[index]}</text>
                  <text x="15" y={pos + 3} className="baduk-coordinate">{9 - index}</text>
                  <text x="405" y={pos + 3} className="baduk-coordinate">{9 - index}</text>
                </g>
              );
            })}
            {[ [2, 2], [6, 2], [2, 6], [6, 6], [4, 4] ].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={pointPosition(x)} cy={pointPosition(y)} r="2.1" className="baduk-hoshi" />
            ))}
            {game.board.map((stone, index) => {
              if (stone === 0) return null;
              const x = index % game.size;
              const y = Math.floor(index / game.size);
              const cx = pointPosition(x);
              const cy = pointPosition(y);
              const isDead = deadSet.has(index);
              return (
                <g key={index} className={isDead ? 'is-dead' : ''} filter="url(#baduk-stone-shadow)">
                  <circle cx={cx} cy={cy} r="15.2" fill={stone === BLACK ? 'url(#baduk-black)' : 'url(#baduk-white)'} stroke={stone === BLACK ? '#050606' : '#bdb7ab'} strokeWidth="1" />
                  {isDead && <path d={`M${cx - 5} ${cy - 5}l10 10m0-10l-10 10`} className="baduk-dead-mark" />}
                  {game.lastMove?.x === x && game.lastMove?.y === y && <circle cx={cx} cy={cy} r="4" className={stone === BLACK ? 'baduk-last-move is-on-black' : 'baduk-last-move'} />}
                </g>
              );
            })}
            {canHover && (
              <circle
                cx={pointPosition(hovered!.x)}
                cy={pointPosition(hovered!.y)}
                r="15"
                fill={game.toPlay === BLACK ? '#111' : '#fff'}
                stroke={game.toPlay === BLACK ? '#000' : '#999'}
                className="baduk-ghost-stone"
              />
            )}
            <rect x="24" y="24" width="372" height="372" rx="3" className="baduk-board-border" />
          </svg>
        </div>
        <aside className="baduk-side">
          <div className="baduk-turn-card">
            <span className={`baduk-turn-stone ${game.toPlay === BLACK ? 'is-black' : 'is-white'}`} />
            <div><small>{game.phase === 'mark' ? 'mark the dead stones' : game.phase === 'resigned' ? 'game over' : thinking ? 'thinking' : 'to play'}</small><b>{game.phase === 'mark' ? 'count the board' : game.phase === 'resigned' ? 'resigned' : game.toPlay === BLACK ? 'black' : 'white'}</b></div>
          </div>
          <div className="baduk-captures">
            <span><i className="is-black" /> black captured <b>{game.captures.black}</b></span>
            <span><i className="is-white" /> white captured <b>{game.captures.white}</b></span>
          </div>
          <div className="baduk-mode">
            <span>playing</span>
            <div>
              <button className={mode === 'computer' ? 'is-selected' : ''} onClick={() => { setMode('computer'); startNewGame(); }}>vs computer</button>
              <button className={mode === 'friend' ? 'is-selected' : ''} onClick={() => { setMode('friend'); startNewGame(); }}>with a friend</button>
            </div>
          </div>
          {mode === 'computer' && (
            <label className="baduk-difficulty">
              <span>computer</span>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as 'easy' | 'normal')}>
                <option value="easy">easy · quick</option>
                <option value="normal">normal · thoughtful</option>
              </select>
            </label>
          )}
          <div className="baduk-actions">
            <button onClick={passTurn} disabled={game.phase !== 'play' || thinking}>pass</button>
            <button onClick={undoTurn} disabled={!game.past.length}>undo</button>
            <button onClick={startNewGame}>new game</button>
            <button className="baduk-resign" onClick={() => setGame(resign(game))} disabled={game.phase !== 'play' || thinking}>resign</button>
          </div>
          {game.phase === 'mark' && (
            <section className="baduk-count-panel">
              <div><small>two passes. review the board.</small><b>{analyzing ? 'reading 400 playouts…' : `${deadSet.size} stones marked dead`}</b></div>
              <p>tap a group to toggle it, then count the board.</p>
              <button className="baduk-count-button" onClick={() => setCounted(true)} disabled={analyzing}>count</button>
            </section>
          )}
          {shownScore && (
            <section className="baduk-score-card">
              <small>area score · 7.5 komi</small>
              <strong>{shownScore.result}</strong>
              <div><span>black</span><b>{shownScore.black.toFixed(1)}</b></div>
              <div><span>white</span><b>{shownScore.white.toFixed(1)}</b></div>
              <div><span>territory</span><b>{shownScore.blackTerritory} · {shownScore.whiteTerritory}</b></div>
              <p>{shownScore.winner === BLACK ? 'black' : 'white'} wins by {shownScore.margin.toFixed(1)}.</p>
            </section>
          )}
          {game.phase === 'resigned' && game.winner && (
            <section className="baduk-score-card">
              <small>resignation</small>
              <strong>{game.winner === BLACK ? 'B+R' : 'W+R'}</strong>
              <p>{game.winner === BLACK ? 'black' : 'white'} wins.</p>
            </section>
          )}
          <footer>black plays first · area scoring · 7.5 komi</footer>
        </aside>
      </main>
      <div className="baduk-touch-hint">{game.phase === 'mark' ? 'tap stones to mark a group dead' : game.toPlay === BLACK ? 'black to play' : 'white to play'}</div>
      <span className="baduk-screenreader" aria-live="polite">{thinking ? 'computer thinking' : game.phase === 'mark' ? 'mark dead stones' : ''}</span>
    </div>
  );
}
