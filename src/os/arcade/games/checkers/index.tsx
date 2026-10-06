import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { BLACK, RED, bestMove, colOf, colorOf, count, isKing, movesFrom, newGame, play, rowOf, sq, type Board, type Color, type Game as CheckersGame, type Level, type Move } from './checkers.ts';
import { meta } from './meta';
import type { AiReply, AiRequest } from './worker.ts';
import './checkers.css';

const MODE = defineSetting('checkers:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('checkers:level', LEVEL_NAMES, 'normal');
const HUMAN: Color = RED;
const STEP_MS = 190;
const MIN_THINK_MS = 420;
const NAMES: Record<Color, string> = { [RED]: 'Red', [BLACK]: 'Black' };
type GameTimer = { remaining: number; fn: () => void };
type PendingAI = { game: CheckersGame; id: number; started: number; move: Move | null; ready: boolean; scheduled: boolean; cleanup?: () => void };

function useGameTimers() {
  const timers = useRef<GameTimer[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push({ remaining: Math.max(0, ms) / 1000, fn });
  }, []);
  useGameLoop((dt) => {
    const due: GameTimer[] = [];
    timers.current = timers.current.filter((timer) => {
      timer.remaining -= dt;
      if (timer.remaining <= 0) {
        due.push(timer);
        return false;
      }
      return true;
    });
    due.forEach((timer) => timer.fn());
  });
  useEffect(() => () => {
    timers.current = [];
  }, []);
  return later;
}

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} lowerIsBetter formatScore={(n) => `${n} ${n === 1 ? 'move' : 'moves'}`} setup={<Setup />}>
      <Checkers />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Anim = { piece: number; at: number; path: number[]; captured: number[]; step: number; move: Move };
type Drag = { pid: number; from: number; moved: boolean };

function Checkers() {
  const shell = useShell();
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const moverRef = useRef<HTMLDivElement | null>(null);
  const [game, setGame] = useState<CheckersGame>(() => newGame());
  const [vis, setVis] = useState<Board>(game.board);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [gone, setGone] = useState<number[]>([]);
  const drag = useRef<Drag | null>(null);
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const cfg = useRef<{ mode: typeof mode; level: Level }>({ mode: getSetting(MODE), level: levelIndex(getSetting(LEVEL)) });
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const aiTask = useRef<PendingAI | null>(null);
  const [aiRevision, setAiRevision] = useState(0);
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const gameRef = useRef(game);
  gameRef.current = game;
  const gameOverScheduled = useRef<CheckersGame | null>(null);
  const later = useGameTimers();

  const lastMove = game.history.at(-1);
  const humanTurn = game.status === 'playing' && !anim && (cfg.current.mode === '2p' || game.turn === HUMAN);
  const fromSquares = useMemo(() => new Set(game.legal.map((m) => m.from)), [game.legal]);
  const targets = useMemo(() => (sel === null ? new Map<number, Move>() : new Map(movesFrom(game.legal, sel).map((m) => [m.to, m]))), [sel, game.legal]);

  // Commit animates the piece along its path, removing captured men as it passes, then updates the rules state.
  const commit = useCallback(
    (m: Move) => {
      setSel(null);
      setCursor(null);
      const piece = game.board[m.from];
      const board = new Uint8Array(game.board);
      board[m.from] = 0;
      setVis(board);
      setAnim({ piece, at: m.from, path: m.path, captured: m.captured, step: 0, move: m });
      sfx.play(m.captured.length ? 'hit' : 'tick', 0.9);
      m.path.forEach((square, i) => {
        later(() => {
          setAnim((a) => (a ? { ...a, at: square, step: i + 1 } : a));
          if (m.captured[i] !== undefined) {
            const cap = m.captured[i];
            setGone((g) => [...g, cap]);
            later(() => {
              setVis((b) => {
                const nb = new Uint8Array(b);
                nb[cap] = 0;
                return nb;
              });
              setGone((g) => g.filter((x) => x !== cap));
            }, STEP_MS * 0.6);
            sfx.play('hit', 1.3 + i * 0.15);
          }
        }, 30 + i * STEP_MS);
      });
      later(() => {
        const next = play(game, m);
        setGame(next);
        setVis(next.board);
        setAnim(null);
        setGone([]);
        if (isKing(next.board[m.to]) && !isKing(piece)) sfx.play('coin');
        if (next.status !== 'playing') sfx.play(next.status === 'draw' ? 'select' : cfg.current.mode === 'cpu' && next.status !== 'red' ? 'lose' : 'win');
      }, 30 + m.path.length * STEP_MS + 40);
    },
    [game, later],
  );

  // Setup changes made on the Start card apply to the game that is about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    cfg.current = { mode, level: levelIndex(levelName) };
    const g = newGame();
    setGame(g);
    setVis(g.board);
    setAnim(null);
    setSel(null);
    setGone([]);
  }, [mode, levelName, shell.status]);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      aiTask.current?.cleanup?.();
      aiTask.current = null;
      w?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    let task = aiTask.current;
    if (task && (task.game !== game || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.turn === HUMAN || anim)) {
      task.cleanup?.();
      aiTask.current = null;
      task = null;
    }
    if (shell.status !== 'playing' || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.turn === HUMAN || anim) return;

    if (!task) {
      const pending: PendingAI = { game, id: ++reqId.current, started: performance.now(), move: null, ready: false, scheduled: false };
      task = pending;
      aiTask.current = pending;
      setThinking(true);
      const receive = (move: Move | null) => {
        if (aiTask.current !== pending || pending.ready) return;
        pending.move = move;
        pending.ready = true;
        setAiRevision((revision) => revision + 1);
      };
      const fallback = () => {
        later(() => {
          if (aiTask.current === pending) receive(bestMove(game.board, game.turn, cfg.current.level));
        }, 30);
      };
      const w = worker.current;
      if (w) {
        const remove = () => {
          w.removeEventListener('message', onMessage);
          w.removeEventListener('error', onError);
          pending.cleanup = undefined;
        };
        const onMessage = (e: MessageEvent<AiReply>) => {
          if (e.data.id !== pending.id || aiTask.current !== pending) return;
          remove();
          receive(e.data.move);
        };
        const onError = () => {
          remove();
          fallback();
        };
        pending.cleanup = remove;
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        const req: AiRequest = { id: pending.id, board: Array.from(game.board), side: game.turn, level: cfg.current.level };
        w.postMessage(req);
      } else fallback();
    }

    if (task?.ready && !task.scheduled) {
      task.scheduled = true;
      const pending = task;
      later(() => {
        if (aiTask.current !== pending || statusRef.current !== 'playing' || gameRef.current !== pending.game) return;
        pending.cleanup?.();
        aiTask.current = null;
        setThinking(false);
        const legal = pending.move && game.legal.find((x) => x.from === pending.move!.from && x.to === pending.move!.to && x.path.join() === pending.move!.path.join());
        if (legal) commit(legal);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - task.started)));
    }
  }, [game, anim, commit, later, shell.status, aiRevision]);

  useEffect(() => {
    if (game.status === 'playing') {
      gameOverScheduled.current = null;
      return;
    }
    if (shell.status !== 'playing' || gameOverScheduled.current === game) return;
    gameOverScheduled.current = game;
    later(() => {
      if (statusRef.current !== 'playing' || gameRef.current !== game) return;
      const moves = Math.ceil(game.history.length / 2);
      const { mode } = cfg.current;
      if (game.status === 'draw') shell.gameOver(undefined, { title: 'Draw', detail: `Forty moves without progress after ${moves} moves.` });
      else {
        const winner: Color = game.status === 'red' ? RED : BLACK;
        const title = mode === 'cpu' ? (winner === HUMAN ? 'You Win' : 'Computer Wins') : `${NAMES[winner]} Wins`;
        const left = count(game.board, winner);
        const detail = `${left.men + left.kings} ${left.men + left.kings === 1 ? 'piece' : 'pieces'} left after ${moves} ${moves === 1 ? 'move' : 'moves'}.`;
        shell.gameOver(mode === 'cpu' && winner === HUMAN ? moves : undefined, { title, detail });
      }
    }, 500);
  }, [game, shell.status, shell.gameOver, later]);

  // Geometry: 44px status row on top, counts row below the board.
  const TOP = 44;
  const FOOT = 40;
  const boardPx = Math.max(120, Math.floor(Math.min(size.w - 24, size.h - TOP - FOOT - 16)));
  const sqPx = boardPx / 8;

  const squareFromEvent = (e: { clientX: number; clientY: number }) => {
    const b = boardRef.current;
    if (!b) return -1;
    const r = b.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return sq(row, col);
  };

  const tryMove = (from: number, to: number) => {
    const m = movesFrom(game.legal, from).find((x) => x.to === to);
    if (!m) return false;
    commit(m);
    return true;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!humanTurn) return;
    const s = squareFromEvent(e);
    if (s < 0) return;
    setCursor(null);
    if (fromSquares.has(s)) {
      setSel(s);
      drag.current = { pid: e.pointerId, from: s, moved: false };
      boardRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (sel !== null && tryMove(sel, s)) return;
    const p = game.board[s];
    if (p && colorOf(p) === game.turn && !fromSquares.has(s)) sfx.play('blip', 0.5);
    setSel(null);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = boardRef.current;
    if (!d || d.pid !== e.pointerId || !b) return;
    const r = b.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!d.moved) {
      const hx = colOf(d.from) * sqPx + sqPx / 2;
      const hy = rowOf(d.from) * sqPx + sqPx / 2;
      if (Math.hypot(x - hx, y - hy) < 5) return;
      d.moved = true;
      setDragFrom(d.from);
    }
    const el = b.querySelector<HTMLDivElement>(`[data-sq="${d.from}"]`);
    if (el) el.style.transform = `translate(${x - sqPx / 2}px, ${y - sqPx / 2}px) scale(1.1)`;
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    const el = boardRef.current?.querySelector<HTMLDivElement>(`[data-sq="${d.from}"]`);
    if (el) el.style.transform = `translate(${colOf(d.from) * 100}%, ${rowOf(d.from) * 100}%)`;
    setDragFrom(null);
    if (!d.moved || cancelled) return;
    const to = squareFromEvent(e);
    if (to >= 0 && to !== d.from && !tryMove(d.from, to)) setSel(fromSquares.has(to) ? to : null);
  };

  useKeys((code, e) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
    if (dirs[code]) {
      const [dx, dy] = dirs[code];
      setCursor((c) => {
        const cur = c ?? sel ?? sq(5, 2);
        return sq(Math.max(0, Math.min(7, rowOf(cur) + dy)), Math.max(0, Math.min(7, colOf(cur) + dx)));
      });
      return;
    }
    if ((code === 'Enter' || code === 'Space') && !e?.repeat && cursor !== null && humanTurn) {
      if (sel !== null && cursor !== sel && tryMove(sel, cursor)) return;
      setSel(fromSquares.has(cursor) ? cursor : null);
    }
    if (code === 'Escape') setSel(null);
  });

  const status = (() => {
    if (game.status === 'draw') return 'Draw';
    if (game.status !== 'playing') return `${NAMES[game.status === 'red' ? RED : BLACK]} wins`;
    const must = game.legal[0]?.captured.length ? ' · capture' : '';
    if (cfg.current.mode === 'cpu') return (thinking || game.turn !== HUMAN ? 'Computer is thinking' : 'Your move') + must;
    return `${NAMES[game.turn]} to move${must}`;
  })();

  const red = count(vis, RED);
  const black = count(vis, BLACK);
  const squares = useMemo(() => Array.from({ length: 64 }, (_, i) => i), []);

  return (
    <div ref={stageRef} className="g-checkers-stage">
      <div className={`g-checkers-status ${thinking ? 'busy' : ''}`} aria-live="polite">
            {thinking && <span className="g-checkers-dots" aria-hidden="true" />}
            {status}
          </div>
          <div className="g-checkers-body" style={{ paddingTop: TOP }}>
            <div
              ref={boardRef}
              className={`g-checkers-board ${humanTurn ? 'live' : ''}`}
              style={{ width: boardPx, height: boardPx }}
              role="grid"
              aria-label="Checkers board"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={(e) => endDrag(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {squares.map((i) => {
                const darkSq = (rowOf(i) + colOf(i)) % 2 === 1;
                const isLast = !!lastMove && !anim && (lastMove.from === i || lastMove.path.includes(i));
                const hint = targets.has(i);
                const canPick = humanTurn && fromSquares.has(i) && sel === null;
                const cls = ['g-checkers-sq', darkSq ? 'dark' : 'light', sel === i ? 'sel' : '', isLast ? 'last' : '', cursor === i ? 'cursor' : '', hint ? 'hint' : '', canPick ? 'pick' : ''].join(' ');
                return <div key={i} className={cls} style={{ left: `${colOf(i) * 12.5}%`, top: `${rowOf(i) * 12.5}%` }} role="gridcell" />;
              })}
              {squares.map((i) => {
                const p = vis[i];
                if (!p) return null;
                const c = colorOf(p);
                return (
                  <div
                    key={i}
                    data-sq={i}
                    className={`g-checkers-piece ${c === RED ? 'red' : 'black'} ${isKing(p) ? 'king' : ''} ${dragFrom === i ? 'drag' : ''} ${gone.includes(i) ? 'gone' : ''}`}
                    style={{ transform: `translate(${colOf(i) * 100}%, ${rowOf(i) * 100}%)` }}
                  >
                    <Crown show={isKing(p)} />
                  </div>
                );
              })}
              {anim && (
                <div ref={moverRef} className={`g-checkers-piece mover ${colorOf(anim.piece) === RED ? 'red' : 'black'} ${isKing(anim.piece) ? 'king' : ''}`} style={{ transform: `translate(${colOf(anim.at) * 100}%, ${rowOf(anim.at) * 100}%)` }}>
                  <Crown show={isKing(anim.piece)} />
                </div>
              )}
            </div>
            <div className="g-checkers-foot" style={{ width: boardPx }}>
              <span className={`g-checkers-side red ${game.turn === RED && game.status === 'playing' ? 'on' : ''}`}>
                <i /> {cfg.current.mode === 'cpu' ? 'You' : 'Red'} <b>{red.men + red.kings}</b>
              </span>
              <span className="g-checkers-mode">{cfg.current.mode === 'cpu' ? levelLabel(LEVEL_NAMES[cfg.current.level]) : 'Pass and Play'}</span>
              <span className={`g-checkers-side black ${game.turn === BLACK && game.status === 'playing' ? 'on' : ''}`}>
                <b>{black.men + black.kings}</b> {cfg.current.mode === 'cpu' ? 'Computer' : 'Black'} <i />
              </span>
            </div>
          </div>
    </div>
  );
}

function Crown({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 16h14l1-8-4.2 3L12 5l-3.8 6L4 8z" fill="currentColor" />
    </svg>
  );
}
