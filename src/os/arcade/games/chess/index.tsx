import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { bestMove, type Level } from './ai.ts';
import {
  BLACK, FLAG_CASTLE, WHITE,
  colorOf, fileOf, findMove, inCheck, isPromotion, moveCaptured, moveFlags, moveFrom, movePromo, moveTo, newGame, pieces, play, rankOf, squareName,
  type Color, type Game as ChessGame,
} from './engine.ts';
import { PieceDrag, boardPoint, columnOf, initialIds, nextIds, pieceTransform, rowOf, squareAt, squareAtPoint, type BoardQuad, type DragView } from './interaction.ts';
import { meta } from './meta';
import { BISHOP, KNIGHT, Piece, QUEEN, ROOK } from './pieces.tsx';
import type { AiReply, AiRequest } from './worker.ts';
import './chess.css';

const MODE = defineSetting('chess:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('chess:level', LEVEL_NAMES, 'normal');
const SIDE = defineSetting('chess:side', ['white', 'black'] as const, 'white');
const sideOptions = [
  ['white', 'White'],
  ['black', 'Black'],
] as const;
const colorOfSide = (s: 'white' | 'black'): Color => (s === 'white' ? WHITE : BLACK);
const MIN_THINK_MS = 450;
const ENDINGS = { checkmate: 'Checkmate', stalemate: 'Stalemate', repetition: 'Draw by repetition', fifty: 'Draw by the fifty-move rule', insufficient: 'Draw, insufficient material' } as const;
const DRAWS = { stalemate: 'stalemate', repetition: 'threefold repetition', fifty: 'the fifty-move rule', insufficient: 'insufficient material' } as const;
type GameTimer = { remaining: number; fn: () => void };
type PendingAI = { game: ChessGame; id: number; started: number; from: number; to: number; promo: number; ready: boolean; scheduled: boolean; cleanup?: () => void };

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
      <Chess />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  const [side, setSide] = useSetting(SIDE);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
      {mode === 'cpu' && <Segmented label="Play as" value={side} options={sideOptions} onChange={setSide} />}
    </>
  );
}

/** Online: the host plays White in odd rounds and Black in even rounds, so colors swap on every rematch. */
const onlineColorOf = (seat: number, round: number): Color => ((round % 2 === 1) === (seat === 0) ? WHITE : BLACK);
const seatOfColor = (color: Color, round: number) => (onlineColorOf(0, round) === color ? 0 : 1);

function Chess() {
  const shell = useShell();
  const online = useOnline();
  const onlineColor = online ? onlineColorOf(online.seat, online.round) : null;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const corners = useRef<(HTMLSpanElement | null)[]>([]);
  const [game, setGame] = useState<ChessGame>(() => newGame());
  const [ids, setIds] = useState(() => initialIds(game.pos));
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [flipped, setFlipped] = useState(() => getSetting(MODE) === 'cpu' && getSetting(SIDE) === 'black');
  const [thinking, setThinking] = useState(false);
  const [dragView, setDragView] = useState<DragView | null>(null);
  const drag = useRef(new PieceDrag());
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const [side] = useSetting(SIDE);
  const cfg = useRef<{ mode: typeof mode; level: Level; color: Color }>({ mode: getSetting(MODE), level: levelIndex(getSetting(LEVEL)), color: colorOfSide(getSetting(SIDE)) });
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const aiTask = useRef<PendingAI | null>(null);
  const [aiRevision, setAiRevision] = useState(0);
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const activeRef = useRef(shell.active);
  activeRef.current = shell.active;
  const gameRef = useRef(game);
  gameRef.current = game;
  const gameOverScheduled = useRef<ChessGame | null>(null);
  const later = useGameTimers();

  const humanTurn = game.status === 'playing' && (onlineColor !== null ? game.pos.turn === onlineColor : cfg.current.mode === '2p' || game.pos.turn === cfg.current.color);
  const lastMove = game.history.at(-1)?.move;
  const checkSq = inCheck(game.pos) ? game.pos.kings[game.pos.turn === WHITE ? 0 : 1] : -1;
  const targets = useMemo(() => (sel === null ? new Set<number>() : new Set(game.legal.filter((m) => moveFrom(m) === sel).map(moveTo))), [sel, game.legal]);

  const commit = useCallback(
    (m: number, remote = false) => {
      const current = gameRef.current;
      if (statusRef.current !== 'playing' || !activeRef.current || current.status !== 'playing' || !current.legal.includes(m)) return;
      const room = onlineRef.current;
      if (room && !remote) {
        if (current.pos.turn !== onlineColorOf(room.seat, room.round)) return;
        room.send({ game: 'chess', round: room.round, from: moveFrom(m), to: moveTo(m), promo: movePromo(m) });
      }
      const next = play(current, m);
      gameRef.current = next;
      setGame(next);
      setIds((ids) => nextIds(ids, current.pos, m));
      const cap = moveCaptured(m);
      if (next.status === 'checkmate') sfx.play((cfg.current.mode === 'cpu' || room) && next.pos.turn === cfg.current.color ? 'lose' : 'win');
      else if (next.status !== 'playing') sfx.play('select', 0.7);
      else if (inCheck(next.pos)) sfx.play('blip', 1.3);
      else if (movePromo(m)) sfx.play('coin');
      else if (moveFlags(m) & FLAG_CASTLE) sfx.play('select');
      else if (cap) sfx.play('hit', 1.6);
      else sfx.play('tick', 0.7);
      setSel(null);
      setPromo(null);
    },
    [],
  );

  const tryMove = useCallback(
    (from: number, to: number) => {
      const current = gameRef.current;
      if (statusRef.current !== 'playing' || !activeRef.current || current.status !== 'playing') return false;
      if (isPromotion(current.legal, from, to)) {
        setPromo({ from, to });
        setSel(from);
        return true;
      }
      const m = findMove(current.legal, from, to);
      if (m === undefined) return false;
      commit(m);
      return true;
    },
    [commit],
  );

  // Setup changes made on the Start card apply to the game that is about to begin.
  // Online rounds always start fresh with the seat's color for that round.
  useEffect(() => {
    if (shell.status !== 'ready' && (onlineColor === null || gameRef.current.history.length > 0)) return;
    const color = onlineColor ?? colorOfSide(side);
    cfg.current = { mode: onlineColor !== null ? '2p' : mode, level: levelIndex(levelName), color };
    const g = newGame();
    gameRef.current = g;
    setGame(g);
    setIds(initialIds(g.pos));
    setFlipped(onlineColor !== null ? color === BLACK : mode === 'cpu' && color === BLACK);
    setSel(null);
    setPromo(null);
  }, [mode, levelName, side, shell.status, onlineColor]);

  // The opponent's moves, checked against the legal list and whose turn it is.
  useEffect(() => online?.onMessage((from, data) => {
    const room = onlineRef.current;
    if (!room || from === room.seat || !data || typeof data !== 'object') return;
    const message = data as { game?: unknown; round?: unknown; from?: unknown; to?: unknown; promo?: unknown };
    if (message.game !== 'chess' || message.round !== room.round) return;
    if (!Number.isInteger(message.from) || !Number.isInteger(message.to) || !Number.isInteger(message.promo)) return;
    const current = gameRef.current;
    if (from !== seatOfColor(current.pos.turn, room.round)) return;
    const m = findMove(current.legal, message.from as number, message.to as number, message.promo as number);
    if (m !== undefined) commit(m, true);
  }), [online?.onMessage, commit]);

  // Computer: a Web Worker when available, otherwise the same search on a timer.
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
    if (task && (task.game !== game || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.pos.turn === cfg.current.color)) {
      task.cleanup?.();
      aiTask.current = null;
      task = null;
    }
    if (shell.status !== 'playing' || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.pos.turn === cfg.current.color) return;

    if (!task) {
      const pending: PendingAI = { game, id: ++reqId.current, started: performance.now(), from: -1, to: -1, promo: 0, ready: false, scheduled: false };
      task = pending;
      aiTask.current = pending;
      setThinking(true);
      const receive = (from: number, to: number, promo: number) => {
        if (aiTask.current !== pending || pending.ready) return;
        pending.from = from;
        pending.to = to;
        pending.promo = promo;
        pending.ready = true;
        setAiRevision((revision) => revision + 1);
      };
      const fallback = () => {
        later(() => {
          if (aiTask.current !== pending) return;
          const result = bestMove(game.pos, cfg.current.level, game.keys);
          if (result) receive(moveFrom(result.move), moveTo(result.move), movePromo(result.move));
          else receive(-1, -1, 0);
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
          receive(e.data.from, e.data.to, e.data.promo);
        };
        const onError = () => {
          remove();
          fallback();
        };
        pending.cleanup = remove;
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        const req: AiRequest = { id: pending.id, fen: game.history.at(-1)?.fen ?? toFenOf(game), keys: game.keys, level: cfg.current.level };
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
        const m = findMove(game.legal, pending.from, pending.to, pending.promo);
        if (m !== undefined) commit(m);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - task.started)));
    }
  }, [game, commit, later, shell.status, aiRevision]);

  useEffect(() => {
    if (game.status === 'playing') {
      gameOverScheduled.current = null;
      return;
    }
    if (shell.status !== 'playing' || gameOverScheduled.current === game) return;
    gameOverScheduled.current = game;
    // Report right away so a quick rematch cannot drop the result.
    const room = onlineRef.current;
    if (room) {
      const winner = game.status === 'checkmate' ? (game.pos.turn === WHITE ? BLACK : WHITE) : null;
      room.reportResult(room.round, winner === null ? null : seatOfColor(winner, room.round));
    }
    later(() => {
      if (statusRef.current !== 'playing' || gameRef.current !== game) return;
      const { mode, color } = cfg.current;
      const winner = game.status === 'checkmate' ? (game.pos.turn === WHITE ? BLACK : WHITE) : null;
      const moves = Math.ceil(game.history.length / 2);
      const room = onlineRef.current;
      if (room) {
        const winnerSeat = winner === null ? null : seatOfColor(winner, room.round);
        const name = room.players.find((player) => player.seat === winnerSeat)?.name ?? (winner === WHITE ? 'White' : 'Black');
        if (winnerSeat !== null) shell.gameOver(undefined, { title: 'Checkmate', detail: `${winnerSeat === room.seat ? 'You win' : `${name} wins`} in ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
        else shell.gameOver(undefined, { title: 'Draw', detail: `By ${DRAWS[game.status as keyof typeof DRAWS]} after ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
        return;
      }
      if (game.status === 'checkmate') {
        const who = mode === 'cpu' ? (winner === color ? 'You win' : 'Computer wins') : `${winner === WHITE ? 'White' : 'Black'} wins`;
        const score = mode === 'cpu' && winner === color ? moves : undefined;
        shell.gameOver(score, { title: 'Checkmate', detail: `${who} in ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
      } else {
        const why = DRAWS[game.status as keyof typeof DRAWS];
        shell.gameOver(undefined, { title: 'Draw', detail: `By ${why} after ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
      }
    }, 650);
  }, [game, shell.status, shell.gameOver, later]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [game.history.length]);

  // Geometry
  const flip = flipped;
  const colOf = (sq: number) => columnOf(sq, flip);
  const sqAt = (col: number, row: number) => squareAt(col, row, flip);
  const TOP = 44;
  const wide = size.w >= 540 && size.w > size.h * 0.95;
  const panelW = wide ? Math.min(240, Math.max(170, size.w * 0.3)) : 0;
  const panelH = wide ? 0 : 104;
  const boardPx = Math.max(120, Math.floor(wide ? Math.min(size.h - TOP - 20, size.w - panelW - 36) : Math.min(size.w - 24, size.h - TOP - panelH - 24)));

  const pointFromEvent = (e: { clientX: number; clientY: number }) => {
    if (corners.current.length !== 4 || corners.current.some((el) => !el)) return null;
    const quad = corners.current.map((el) => {
      const r = el!.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }) as unknown as BoardQuad;
    return boardPoint({ x: e.clientX, y: e.clientY }, quad);
  };
  const releaseCapture = useCallback((pid: number) => {
    const b = boardRef.current;
    if (b?.hasPointerCapture(pid)) b.releasePointerCapture(pid);
  }, []);
  const cancelDrag = useCallback(() => {
    const d = drag.current.cancel();
    if (d) releaseCapture(d.pid);
    setDragView(null);
  }, [releaseCapture]);
  useLayoutEffect(() => {
    cancelDrag();
  }, [shell.status, shell.active, flipped, boardPx, promo, cancelDrag]);
  useLayoutEffect(() => () => {
    const d = drag.current.cancel();
    if (d) releaseCapture(d.pid);
  }, [releaseCapture]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (shell.status !== 'playing' || !shell.active || !humanTurn || promo || drag.current.current || !e.isPrimary || e.button !== 0) return;
    const sq = squareAtPoint(pointFromEvent(e), flip);
    if (sq < 0) return;
    const pc = game.pos.board[sq];
    setCursor(null);
    if (pc && colorOf(pc) === game.pos.turn) {
      setSel(sq);
      drag.current.begin(e.pointerId, sq, { x: e.clientX, y: e.clientY });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        cancelDrag();
      }
      return;
    }
    if (sel !== null && tryMove(sel, sq)) return;
    setSel(null);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const view = drag.current.move(e.pointerId, { x: e.clientX, y: e.clientY }, pointFromEvent(e));
    if (view) setDragView(view);
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current.end(e.pointerId);
    if (!d) return;
    releaseCapture(d.pid);
    setDragView(null);
    if (!d.moved || cancelled) return;
    const to = squareAtPoint(pointFromEvent(e), flip);
    if (to >= 0 && to !== d.from) {
      if (!tryMove(d.from, to)) {
        const pc = gameRef.current.pos.board[to];
        setSel(pc && colorOf(pc) === gameRef.current.pos.turn ? to : null);
      }
    }
  };

  // Keyboard: arrows move a cursor, Enter or Space selects and moves, F flips.
  useKeys((code, e) => {
    if (e?.repeat && (code === 'Enter' || code === 'Space' || code === 'KeyF')) return;
    if (code === 'KeyF') return setFlipped((f) => !f);
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
    if (dirs[code]) {
      const [dx, dy] = dirs[code];
      setCursor((c) => {
        const cur = c ?? sel ?? sqAt(4, 7);
        const col = Math.max(0, Math.min(7, colOf(cur) + dx));
        const row = Math.max(0, Math.min(7, rowOf(cur, flip) + dy));
        return sqAt(col, row);
      });
      return;
    }
    if ((code === 'Enter' || code === 'Space') && cursor !== null && humanTurn) {
      if (promo) return;
      const pc = game.pos.board[cursor];
      if (sel !== null && cursor !== sel && tryMove(sel, cursor)) return;
      if (pc && colorOf(pc) === game.pos.turn) setSel(cursor);
      else setSel(null);
    }
    if (code === 'Escape' || code === 'Backspace') {
      setSel(null);
      setPromo(null);
    }
  });

  const status = (() => {
    if (game.status !== 'playing') return ENDINGS[game.status];
    const mover = game.pos.turn === WHITE ? 'White' : 'Black';
    const check = checkSq >= 0 ? ' · check' : '';
    if (onlineColor !== null) return (game.pos.turn === onlineColor ? 'Your move' : `${online?.players.find((p) => p.seat !== online.seat)?.name ?? 'Opponent'} to move`) + check;
    if (cfg.current.mode === 'cpu') return (thinking ? 'Computer is thinking' : 'Your move') + check;
    return `${mover} to move${check}`;
  })();

  const squares = useMemo(() => {
    const out: { sq: number; col: number; row: number }[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) out.push({ sq: sqAt(col, row), col, row });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip]);

  const rows: { n: number; w?: string; b?: string }[] = [];
  game.history.forEach((h, i) => {
    if (i % 2 === 0) rows.push({ n: i / 2 + 1, w: h.san });
    else rows[rows.length - 1].b = h.san;
  });

  return (
    <div ref={stageRef} className={`g-chess-stage ${wide ? 'wide' : 'tall'}`}>
      <div className={`g-chess-status ${thinking ? 'busy' : ''}`} aria-live="polite">
            {thinking && <span className="g-chess-dots" aria-hidden="true" />}
            {status}
          </div>
          <div className="g-chess-body" style={{ paddingTop: TOP }}>
            <div
              ref={boardRef}
              className={`g-chess-board ${humanTurn ? 'live' : ''}`}
              style={{ width: boardPx, height: boardPx }}
              role="grid"
              aria-label="Chess board"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={(e) => endDrag(e, true)}
              onLostPointerCapture={(e) => endDrag(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {[[0, 0], [100, 0], [100, 100], [0, 100]].map(([left, top], i) => (
                <span key={i} ref={(el) => { corners.current[i] = el; }} className="g-chess-corner" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true" />
              ))}
              {squares.map(({ sq, col, row }) => {
                const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
                const isLast = lastMove !== undefined && (moveFrom(lastMove) === sq || moveTo(lastMove) === sq);
                const hint = targets.has(sq);
                const capture = hint && game.pos.board[sq] !== 0;
                const cls = ['g-chess-sq', light ? 'light' : 'dark', sel === sq ? 'sel' : '', isLast ? 'last' : '', checkSq === sq ? 'check' : '', cursor === sq ? 'cursor' : '', hint ? (capture ? 'hint capture' : 'hint') : ''].join(' ');
                return (
                  <div key={sq} className={cls} style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }} role="gridcell" aria-label={squareName(sq)}>
                    {col === 0 && <span className="g-chess-rank">{rankOf(sq) + 1}</span>}
                    {row === 7 && <span className="g-chess-file">{'abcdefgh'[fileOf(sq)]}</span>}
                  </div>
                );
              })}
              {pieces(game.pos).map(([sq, pc]) => {
                const id = ids.get(sq) ?? sq + 1000;
                const dragging = dragView?.from === sq;
                return (
                  <div
                    key={id}
                    className={`g-chess-piece ${dragging ? 'drag' : ''} ${colorOf(pc) === game.pos.turn && humanTurn ? 'own' : ''}`}
                    data-square={squareName(sq)}
                    style={{ transform: pieceTransform(sq, flip, boardPx, dragView) }}
                  >
                    <Piece piece={pc} />
                  </div>
                );
              })}
              {promo && (
                <div className="g-chess-promo" role="dialog" aria-label="Promote to">
                  <span>Promote to</span>
                  <div>
                    {[QUEEN, ROOK, BISHOP, KNIGHT].map((t) => (
                      <button key={t} type="button" onClick={() => commit(findMove(game.legal, promo.from, promo.to, t)!)} aria-label={['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t]}>
                        <Piece piece={t | game.pos.turn} />
                      </button>
                    ))}
                  </div>
                  <button type="button" className="arcade-btn g-chess-cancel" onClick={() => setPromo(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <aside className="g-chess-panel" style={wide ? { width: panelW, height: boardPx } : { height: panelH, width: boardPx }}>
              <div className="g-chess-tools">
                <span className="g-chess-mode">{onlineColor !== null ? `Online · ${onlineColor === WHITE ? 'White' : 'Black'}` : cfg.current.mode === 'cpu' ? `vs Computer · ${levelLabel(LEVEL_NAMES[cfg.current.level])}` : '2 Players'}</span>
                <button type="button" className="g-chess-flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip Board" title="Flip Board">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 4v13M3.5 13.5L7 17l3.5-3.5M17 20V7M13.5 10.5L17 7l3.5 3.5" />
                  </svg>
                </button>
              </div>
              <ol ref={listRef} className="g-chess-moves" aria-label="Moves">
                {rows.length === 0 && <li className="g-chess-empty">{cfg.current.mode === 'cpu' && cfg.current.color === BLACK ? 'White opens.' : 'White to open.'}</li>}
                {rows.map((r) => (
                  <li key={r.n}>
                    <em>{r.n}.</em>
                    <b className={r.b === undefined && r.n === rows.length ? 'cur' : ''}>{r.w}</b>
                    <b className={r.b !== undefined && r.n === rows.length ? 'cur' : ''}>{r.b ?? ''}</b>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
    </div>
  );
}

function toFenOf(g: ChessGame) {
  // The start position is the only game state without a recorded fen.
  return g.history.length ? g.history[g.history.length - 1].fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}
