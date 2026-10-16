import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { STORE, apply, chooseMove, legalMoves, newState, ownerOf, parsePacket, pitsOf, score, sow, winner, type Board, type Level, type MoveResult, type Packet, type Side, type State } from './mancala.ts';
import { meta } from './meta';
import type { AiReply, AiRequest } from './worker.ts';
import './mancala.css';

const MODE = defineSetting('mancala:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('mancala:level', LEVEL_NAMES, 'normal');
const HUMAN: Side = 0;
const CPU: Side = 1;
const MIN_THINK_MS = 520;
const TOP = 38;
const SEED_COLORS = ['#3fd0c9', '#ff7a6b', '#ffc24a', '#a98bff', '#f4ede1', '#8ee06a'];

type Job = { pit: number; side: Side; result: MoveResult; next: State };
type Seed = { id: number; at: number; slot: number; held: boolean };
type Point = { x: number; y: number };
type Geo = { vertical: boolean; u: number; bx: number; by: number; bw: number; bh: number; centers: Point[]; foot: boolean };
type Toast = { id: number; text: string };

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />}>
      <Mancala />
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

/** Timers that run on game time, so pausing freezes a sowing in place. */
function useGameTimers() {
  const timers = useRef<{ remaining: number; fn: () => void }[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push({ remaining: Math.max(0, ms) / 1000, fn });
  }, []);
  useGameLoop((dt) => {
    const due: (() => void)[] = [];
    timers.current = timers.current.filter((t) => {
      t.remaining -= dt;
      if (t.remaining <= 0) {
        due.push(t.fn);
        return false;
      }
      return true;
    });
    due.forEach((fn) => fn());
  });
  useEffect(() => () => {
    timers.current = [];
  }, []);
  return later;
}

/** Board geometry in stage pixels. Columns 0 and 7 are the stores; the viewer's pits run along the bottom (or down the left when tall). */
function layout(w: number, h: number, view: Side): Geo {
  const W = Math.max(120, w - 24);
  const H = Math.max(80, h - TOP - 8);
  const uh = Math.min(W / 8.6, H / 2.66);
  const uv = Math.min(W / 2.66, H / 8.6);
  const vertical = uv > uh * 1.25;
  const u = Math.max(30, Math.min(vertical ? uv : uh, 128));
  const bw = vertical ? 2.66 * u : 8.6 * u;
  const bh = vertical ? 8.6 * u : 2.66 * u;
  const footSpace = H - bh;
  const foot = !vertical && footSpace > 40;
  const bx = (w - bw) / 2;
  const by = TOP + Math.max(0, (H - bh - (foot ? 34 : 0)) / 2);
  const along = (c: number) => 0.3 * u + (c + 0.5) * u;
  const cross = (r: number) => 0.33 * u + (r + 0.5) * u;
  const centers: Point[] = new Array(14);
  const mine = pitsOf(view);
  const theirs = pitsOf((1 - view) as Side);
  if (!vertical) {
    mine.forEach((p, k) => (centers[p] = { x: bx + along(k + 1), y: by + cross(1) }));
    theirs.forEach((p, k) => (centers[p] = { x: bx + along(6 - k), y: by + cross(0) }));
    centers[STORE[view]] = { x: bx + along(7), y: by + bh / 2 };
    centers[STORE[1 - view]] = { x: bx + along(0), y: by + bh / 2 };
  } else {
    // A quarter turn clockwise when tall: the viewer's row runs down the left, their store sits at the bottom.
    mine.forEach((p, k) => (centers[p] = { x: bx + cross(0), y: by + along(k + 1) }));
    theirs.forEach((p, k) => (centers[p] = { x: bx + cross(1), y: by + along(6 - k) }));
    centers[STORE[view]] = { x: bx + bw / 2, y: by + along(7) };
    centers[STORE[1 - view]] = { x: bx + bw / 2, y: by + along(0) };
  }
  return { vertical, u, bx, by, bw, bh, centers, foot };
}

const GOLDEN = 2.39996;

function seedOffset(geo: Geo, seed: Seed): Point {
  const { u, vertical } = geo;
  if (seed.held) {
    const k = seed.slot;
    const r = 0.07 * u * Math.sqrt(k + 0.4);
    return { x: Math.cos(k * GOLDEN) * Math.min(r, 0.3 * u), y: Math.sin(k * GOLDEN) * Math.min(r, 0.3 * u) - 0.08 * u };
  }
  if (seed.at === STORE[0] || seed.at === STORE[1]) {
    const k = seed.slot % 30;
    const layer = Math.floor(seed.slot / 30);
    const rx = (vertical ? 0.88 : 0.27) * u;
    const ry = (vertical ? 0.27 : 0.88) * u;
    const r = Math.sqrt((k + 0.5) / 30);
    return { x: Math.cos(k * GOLDEN + layer) * rx * r + layer * 0.03 * u, y: Math.sin(k * GOLDEN + layer) * ry * r - layer * 0.03 * u };
  }
  const k = seed.slot;
  const r = Math.min(0.095 * u * Math.sqrt(k + 0.3), 0.27 * u);
  return { x: Math.cos(k * GOLDEN + 0.6) * r, y: Math.sin(k * GOLDEN + 0.6) * r };
}

function seedsFor(board: Board, prev: Seed[] = []): Seed[] {
  const keep: Seed[] = [];
  const pool: Seed[] = [];
  const counts = new Array(14).fill(0);
  const sorted = [...prev].sort((a, b) => a.slot - b.slot);
  for (const s of sorted) {
    if (!s.held && counts[s.at] < board[s.at]) keep.push({ ...s, slot: counts[s.at]++ });
    else pool.push(s);
  }
  let next = prev.reduce((m, s) => Math.max(m, s.id + 1), 0);
  for (let i = 0; i < 14; i++) {
    while (counts[i] < board[i]) {
      const s = pool.shift() ?? { id: next++, at: i, slot: 0, held: false };
      keep.push({ ...s, at: i, slot: counts[i]++, held: false });
    }
  }
  return keep.sort((a, b) => a.id - b.id);
}

function sameState(a: State, b: State) {
  return a.turn === b.turn && a.over === b.over && a.seq === b.seq && a.board.every((n, i) => n === b.board[i]);
}

function Mancala() {
  const shell = useShell();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const [modeSetting] = useSetting(MODE);
  const [levelSetting] = useSetting(LEVEL);
  const cfg = useRef<{ mode: 'cpu' | '2p' | 'online'; level: Level }>({ mode: online ? 'online' : getSetting(MODE), level: levelIndex(getSetting(LEVEL)) });
  const start = (): State => ({ ...newState(), turn: (online ? online.round % 2 : 0) as Side });
  const [game, setGame] = useState<State>(start);
  const gameRef = useRef(game);
  const [shown, setShown] = useState<State>(game);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const queue = useRef<Job[]>([]);
  const epoch = useRef(0);
  const seedsRef = useRef<Seed[]>(seedsFor(game.board));
  const [seeds, setSeeds] = useState<Seed[]>(seedsRef.current);
  const [flash, setFlash] = useState<number[]>([]);
  const [source, setSource] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [synced, setSynced] = useState(!online || online.isHost);
  const syncedRef = useRef(synced);
  syncedRef.current = synced;
  const [pickPending, setPickPending] = useState<number | null>(null);
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const later = useGameTimers();
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const ended = useRef(false);

  const view: Side = online && online.seat !== 0 ? 1 : 0;
  const geo = useMemo(() => layout(size.w || 600, size.h || 300, view), [size.w, size.h, view]);

  // The Start card's settings apply to the round about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    cfg.current = { mode: online ? 'online' : modeSetting, level: levelIndex(levelSetting) };
  }, [modeSetting, levelSetting, shell.status, online]);

  const pushSeeds = () => setSeeds(seedsRef.current.map((s) => ({ ...s })));
  const moveSeed = (s: Seed, to: number) => {
    s.slot = seedsRef.current.filter((o) => o !== s && !o.held && o.at === to).length;
    s.at = to;
    s.held = false;
  };
  const showToast = (text: string, ms = 1100) => {
    const id = Date.now() + Math.random();
    setToast({ id, text });
    const e = epoch.current;
    later(() => {
      if (epoch.current === e) setToast((t) => (t?.id === id ? null : t));
    }, ms);
  };

  const settle = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
    setSource(null);
    setFlash([]);
    setShown(gameRef.current);
    seedsRef.current = seedsFor(gameRef.current.board, seedsRef.current);
    setSeeds(seedsRef.current);
  }, []);

  const runRef = useRef<() => void>(() => {});
  const [mover, setMover] = useState<Side>(0);
  const animate = (job: Job, done: () => void) => {
    const e = epoch.current;
    const alive = () => epoch.current === e;
    const { result, side, pit } = job;
    const n = result.path.length;
    const step = n > 12 ? 85 : n > 7 ? 115 : 150;
    const held = seedsRef.current.filter((s) => !s.held && s.at === pit).sort((a, b) => a.slot - b.slot);
    held.forEach((s, i) => {
      s.held = true;
      s.slot = i;
    });
    setSource(pit);
    pushSeeds();
    sfx.tone({ freq: 340, to: 520, dur: 0.08, type: 'triangle', vol: 0.12 });
    let t = 170;
    result.path.forEach((to, i) => {
      later(() => {
        if (!alive()) return;
        const s = seedsRef.current.find((o) => o.held && held.includes(o));
        if (s) moveSeed(s, to);
        pushSeeds();
        const store = to === STORE[side];
        sfx.tone({ freq: (store ? 660 : 480) * Math.pow(1.035, i), dur: store ? 0.09 : 0.05, type: store ? 'triangle' : 'sine', vol: 0.16 });
      }, t + i * step);
    });
    t += n * step + 60;
    if (result.capture) {
      const cap = result.capture;
      later(() => {
        if (!alive()) return;
        setFlash([cap.pit, cap.opposite]);
        sfx.play('hit', 1.4);
      }, t);
      t += 300;
      later(() => {
        if (!alive()) return;
        for (const s of seedsRef.current) if (!s.held && (s.at === cap.pit || s.at === cap.opposite)) moveSeed(s, STORE[side]);
        pushSeeds();
        setFlash([]);
        sfx.play('coin', 0.9);
        showToast(`Capture +${cap.seeds}`);
      }, t);
      t += 380;
    } else if (result.extra) {
      later(() => {
        if (!alive()) return;
        sfx.play('coin', 1.1);
        showToast('Extra Turn');
      }, t - 40);
      t += 120;
    }
    if (result.over && result.sweep) {
      t += 260;
      later(() => {
        if (!alive()) return;
        for (const s of seedsRef.current) if (!s.held && s.at !== STORE[0] && s.at !== STORE[1]) moveSeed(s, STORE[ownerOf(s.at)]);
        pushSeeds();
        if (result.sweep![0] + result.sweep![1] > 0) sfx.tone({ freq: 300, to: 160, dur: 0.25, type: 'triangle', vol: 0.14 });
      }, t);
      t += 500;
    }
    later(() => {
      if (alive()) done();
    }, t);
  };

  const run = useCallback(() => {
    if (busyRef.current) return;
    const job = queue.current.shift();
    if (!job) return;
    busyRef.current = true;
    setBusy(true);
    setMover(job.side);
    setHover(null);
    animate(job, () => {
      busyRef.current = false;
      if (queue.current.length) runRef.current();
      else settle();
    });
  }, [settle]);
  runRef.current = run;

  /** Applies a sowing to the rules state right away and queues its animation. */
  const playPit = useCallback((pit: number): boolean => {
    const from = gameRef.current;
    const r = apply(from, pit);
    if (!r) return false;
    gameRef.current = r.state;
    setGame(r.state);
    queue.current.push({ pit, side: from.turn, result: r.result, next: r.state });
    runRef.current();
    return true;
  }, []);

  const snap = useCallback((state: State) => {
    epoch.current++;
    queue.current = [];
    gameRef.current = state;
    setGame(state);
    setToast(null);
    settle();
  }, [settle]);

  // Online: the host owns the game. Guests ask for sowings and play back what the host sends.
  useEffect(() => {
    if (!online) return;
    const off = online.onMessage((from, d) => {
      const o = onlineRef.current;
      const p: Packet | null = parsePacket(d);
      if (!o || !p) return;
      const g = gameRef.current;
      if (o.isHost) {
        if (from === 0) return;
        if (p.t === 'hello') o.send({ t: 'sync', state: g }, { to: from });
        else if (p.t === 'pick') {
          if (from === seatOf(o, 1) && !g.over && g.turn === 1 && p.seq === g.seq && playPit(p.pit)) o.send({ t: 'move', seq: g.seq, pit: p.pit, state: gameRef.current });
          else o.send({ t: 'sync', state: g }, { to: from });
        }
        return;
      }
      if (from !== 0) return;
      if (p.t === 'sync') {
        setPickPending(null);
        if (!syncedRef.current || p.state.seq > g.seq) snap(p.state);
        setSynced(true);
      } else if (p.t === 'move') {
        setPickPending(null);
        setSynced(true);
        if (p.seq < g.seq) return;
        const r = p.seq === g.seq ? apply(g, p.pit) : null;
        if (r && sameState(r.state, p.state)) playPit(p.pit);
        else snap(p.state);
      }
    });
    if (online.isHost) online.send({ t: 'sync', state: gameRef.current });
    return off;
  }, [online?.onMessage, online?.isHost, playPit, snap]);

  // A player who joins from the Start card keeps this board into their first round, so a new round always starts clean.
  const roundRef = useRef(online?.round);
  useEffect(() => {
    const o = onlineRef.current;
    if (!o || roundRef.current === o.round) return;
    roundRef.current = o.round;
    ended.current = false;
    setPickPending(null);
    snap({ ...newState(), turn: (o.round % 2) as Side });
    setSynced(o.isHost);
    if (o.isHost) o.send({ t: 'sync', state: gameRef.current });
  }, [online?.round, snap]);

  // Guests keep asking until the host answers (it may still be loading the round).
  useEffect(() => {
    if (!online || online.isHost || synced) return;
    online.send({ t: 'hello' });
    const t = window.setInterval(() => onlineRef.current?.send({ t: 'hello' }), 1200);
    return () => window.clearInterval(t);
  }, [online?.isHost, synced]);

  useEffect(() => {
    if (pickPending === null || !online) return;
    const t = window.setTimeout(() => {
      setPickPending(null);
      onlineRef.current?.send({ t: 'hello' });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [pickPending]);

  const mode = cfg.current.mode;
  const settled = !busy && shell.status === 'playing';
  const myTurn = (s: State) => {
    if (s.over) return false;
    if (mode === 'online') return synced && s.turn === view;
    if (mode === 'cpu') return s.turn === HUMAN;
    return true;
  };
  const canPlay = settled && myTurn(shown) && pickPending === null;
  const legal = useMemo(() => new Set(canPlay ? legalMoves(shown.board, shown.turn) : []), [canPlay, shown]);

  const tapPit = (pit: number) => {
    if (!canPlay || !legal.has(pit)) {
      if (canPlay && ownerOf(pit) === shown.turn && pit !== STORE[0] && pit !== STORE[1]) sfx.play('blip', 0.5);
      return;
    }
    setCursor(null);
    const o = onlineRef.current;
    if (mode === 'online' && o && !o.isHost) {
      setPickPending(pit);
      o.send({ t: 'pick', seq: gameRef.current.seq, pit });
      return;
    }
    const seq = gameRef.current.seq;
    if (playPit(pit) && mode === 'online' && o) o.send({ t: 'move', seq, pit, state: gameRef.current });
  };

  // Computer moves come from a worker so a deep search never stalls the board.
  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'cpu' || !settled || shown.over || shown.turn !== CPU || shown !== gameRef.current) return;
    const state = shown;
    const id = ++reqId.current;
    const startedAt = performance.now();
    const e = epoch.current;
    setThinking(true);
    let gone = false;
    const deliver = (pit: number) => {
      if (gone || id !== reqId.current) return;
      later(() => {
        if (gone || id !== reqId.current || epoch.current !== e || gameRef.current !== state || statusRef.current !== 'playing') return;
        setThinking(false);
        const pick = legalMoves(state.board, CPU).includes(pit) ? pit : legalMoves(state.board, CPU)[0];
        if (pick !== undefined) playPit(pick);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - startedAt)));
    };
    const w = worker.current;
    const fallback = () => later(() => deliver(chooseMove(state.board, CPU, cfg.current.level, { budgetMs: 250 })), 20);
    let cleanup = () => {};
    if (w) {
      const onMessage = (ev: MessageEvent<AiReply>) => {
        if (ev.data.id === id) deliver(ev.data.pit);
      };
      const onError = () => fallback();
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      cleanup = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      };
      const req: AiRequest = { id, board: [...state.board], side: CPU, level: cfg.current.level };
      w.postMessage(req);
    } else fallback();
    return () => {
      gone = true;
      cleanup();
      setThinking(false);
    };
  }, [mode, settled, shown, later, playPit]);

  // The end tally, once the last seeds have reached the stores.
  useEffect(() => {
    if (!shown.over || busy || shell.status !== 'playing' || ended.current) return;
    ended.current = true;
    const final = shown;
    later(() => {
      if (statusRef.current !== 'playing') return;
      const [a, b] = score(final.board);
      const win = winner(final.board);
      const o = onlineRef.current;
      const names = sideNames(mode, o, view);
      const tally = `${a} to ${b}`;
      const mine = view === 0 ? `${a} to ${b}` : `${b} to ${a}`;
      if (mode === 'online' && o) {
        o.reportResult(o.round, win === null ? null : seatOf(o, win));
        sfx.play(win === null ? 'select' : win === view ? 'win' : 'lose');
        shell.gameOver(undefined, { title: win === null ? 'Tie Game' : win === view ? 'You Win' : `${names[win]} Wins`, detail: `${mine}. ${win === null ? 'Even split.' : `${names[win]} took ${Math.max(a, b)} of 48 seeds.`}` });
      } else if (mode === 'cpu') {
        sfx.play(win === HUMAN ? 'win' : win === null ? 'select' : 'lose');
        const lvl = levelLabel(LEVEL_NAMES[cfg.current.level]);
        shell.gameOver(undefined, { title: win === null ? 'Tie Game' : win === HUMAN ? 'You Win' : 'Computer Wins', detail: `${tally} on ${lvl}.` });
      } else {
        sfx.play(win === null ? 'select' : 'win');
        shell.gameOver(undefined, { title: win === null ? 'Tie Game' : `${names[win]} Wins`, detail: `${tally}.` });
      }
    }, 450);
  }, [shown, busy, shell.status, shell.gameOver, later, mode, view]);

  // Keyboard: arrows walk the pits of whoever is to move, Enter or Space sows.
  const ownPits = canPlay ? pitsOf(shown.turn) : [];
  const visualOrder = (side: Side) => {
    const pits = pitsOf(side);
    return side === view ? pits : [...pits].reverse();
  };
  useKeys((code, e) => {
    if (!canPlay) return;
    const order = visualOrder(shown.turn);
    const prev = code === 'ArrowLeft' || code === 'KeyA' || (geo.vertical && (code === 'ArrowUp' || code === 'KeyW'));
    const next = code === 'ArrowRight' || code === 'KeyD' || (geo.vertical && (code === 'ArrowDown' || code === 'KeyS'));
    if (prev || next) {
      const cur = cursor !== null && order.includes(cursor) ? order.indexOf(cursor) : -1;
      let i = cur < 0 ? (prev ? order.length - 1 : 0) : cur + (next ? 1 : -1);
      i = Math.max(0, Math.min(order.length - 1, i));
      setCursor(order[i]);
      sfx.play('tick', 1);
      return;
    }
    const digit = /^Digit([1-6])$/.exec(code);
    if (digit) {
      tapPit(order[Number(digit[1]) - 1]);
      return;
    }
    if ((code === 'Enter' || code === 'Space') && !e?.repeat && cursor !== null && ownPits.includes(cursor)) tapPit(cursor);
  });

  const names = sideNames(mode, online, view);
  const focus = cursor ?? hover;
  const landing = useMemo(() => {
    if (focus === null || !legal.has(focus)) return null;
    try {
      return sow(shown.board, shown.turn, focus).last;
    } catch {
      return null;
    }
  }, [focus, legal, shown]);

  const status = (() => {
    if (mode === 'online' && !synced) return 'Joining the table';
    if (shown.over) return busy ? 'Clearing the board' : 'Game over';
    if (busy) return mode === 'cpu' || mode === 'online' ? (mover === view ? 'Sowing' : `${names[mover]} is sowing`) : `${names[mover]} is sowing`;
    if (pickPending !== null) return 'Sowing';
    if (mode === 'cpu') return shown.turn === CPU ? 'Computer is thinking' : 'Your turn';
    if (mode === 'online') return shown.turn === view ? 'Your turn' : `${names[shown.turn]} to move`;
    return `${names[shown.turn]} to move`;
  })();

  const visBoard = useMemo(() => {
    const counts = new Array(14).fill(0);
    for (const s of seeds) if (!s.held) counts[s.at]++;
    return counts as number[];
  }, [seeds]);
  const heldCount = seeds.filter((s) => s.held).length;
  const [sa, sb] = [visBoard[STORE[0]], visBoard[STORE[1]]];
  const u = geo.u;
  const seedPx = Math.max(7, 0.19 * u);
  const badgePx = Math.max(11, Math.min(15, 0.24 * u));
  const onPit = (pit: number) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    tapPit(pit);
  };

  const pitIndices = [...pitsOf(0), ...pitsOf(1)];
  return (
    <div ref={stageRef} className="g-mancala-stage">
      {shell.status !== 'ready' && (
        <div className={`g-mancala-status ${thinking || busy ? 'busy' : ''}`} aria-live="polite">
          {(thinking || (mode === 'online' && !synced)) && <span className="g-mancala-dots" aria-hidden="true" />}
          {status}
        </div>
      )}
      <div
        className={`g-mancala-board ${geo.vertical ? 'tall' : ''}`}
        style={{ left: geo.bx, top: geo.by, width: geo.bw, height: geo.bh, borderRadius: 0.5 * u }}
        onContextMenu={(e) => e.preventDefault()}
        role="group"
        aria-label="Mancala board"
      />
      {[STORE[0], STORE[1]].map((st) => {
        const c = geo.centers[st];
        const w = (geo.vertical ? 1.9 : 0.82) * u;
        const h = (geo.vertical ? 0.82 : 1.9) * u;
        const side = ownerOf(st);
        const live = !shown.over && shown.turn === side;
        return (
          <div key={st} className={`g-mancala-store ${live ? 'on' : ''} ${side === view ? 'mine' : ''}`} style={{ left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, borderRadius: 0.41 * u }} aria-label={`${names[side]} store, ${visBoard[st]} seeds`}>
            <span className="g-mancala-count store" style={{ fontSize: Math.max(12, Math.min(22, 0.32 * u)) }}>
              {visBoard[st]}
            </span>
          </div>
        );
      })}
      {pitIndices.map((pit) => {
        const c = geo.centers[pit];
        const side = ownerOf(pit);
        const canTap = legal.has(pit);
        const out = side === view ? 1 : -1;
        const badge = geo.vertical ? { left: c.x - out * 0.62 * u, top: c.y } : { left: c.x, top: c.y + out * 0.6 * u };
        const cls = ['g-mancala-pit', canTap ? 'live' : '', cursor === pit ? 'cursor' : '', landing === pit ? 'land' : '', flash.includes(pit) ? 'flash' : '', source === pit ? 'source' : '', pickPending === pit ? 'pending' : ''].join(' ');
        return (
          <div key={pit}>
            <div
              className={cls}
              style={{ left: c.x - u / 2, top: c.y - u / 2, width: u, height: u, ['--pit' as string]: `${0.84 * u}px` }}
              role="button"
              aria-label={`${names[side]} pit ${pitsOf(side).indexOf(pit) + 1}, ${visBoard[pit]} ${visBoard[pit] === 1 ? 'seed' : 'seeds'}`}
              aria-disabled={!canTap}
              onPointerDown={onPit(pit)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(pit)}
              onPointerLeave={() => setHover((h) => (h === pit ? null : h))}
            />
            <span className={`g-mancala-count ${landing === pit ? 'land' : ''}`} style={{ left: badge.left, top: badge.top, fontSize: badgePx }}>
              {visBoard[pit]}
            </span>
          </div>
        );
      })}
      {landing !== null && (landing === STORE[0] || landing === STORE[1]) && <LandRing c={geo.centers[landing]} u={u} vertical={geo.vertical} />}
      <div className="g-mancala-seeds" aria-hidden="true">
        {seeds.map((s) => {
          const c = geo.centers[s.at];
          const off = seedOffset(geo, s);
          const x = c.x + off.x - seedPx / 2;
          const y = c.y + off.y - seedPx / 2;
          return (
            <span
              key={s.id}
              className={`g-mancala-seed ${s.held ? 'held' : ''}`}
              style={{ width: seedPx, height: seedPx, transform: `translate(${x}px, ${y}px)`, zIndex: s.held ? 40 + s.slot : 2 + Math.min(s.slot, 30), ['--seed' as string]: SEED_COLORS[s.id % SEED_COLORS.length], ['--tilt' as string]: `${(s.id * 47) % 360}deg` }}
            />
          );
        })}
      </div>
      {heldCount > 0 && source !== null && (
        <span className="g-mancala-hand" style={{ left: geo.centers[source].x, top: geo.centers[source].y - 0.52 * u, fontSize: badgePx }}>
          {heldCount}
        </span>
      )}
      {toast && (
        <div key={toast.id} className="g-mancala-toast" style={{ left: geo.bx + geo.bw / 2, top: geo.by + geo.bh / 2 }}>
          {toast.text}
        </div>
      )}
      {geo.foot && (
        <div className="g-mancala-foot" style={{ left: geo.bx, top: geo.by + geo.bh + 10, width: geo.bw }}>
          <span className={`g-mancala-side ${!shown.over && shown.turn !== view ? 'on' : ''}`}>
            {names[(1 - view) as Side]} <b>{view === 0 ? sb : sa}</b>
          </span>
          <span className="g-mancala-mode">{mode === 'cpu' ? levelLabel(LEVEL_NAMES[cfg.current.level]) : mode === '2p' ? 'Pass and Play' : 'Online'}</span>
          <span className={`g-mancala-side ${!shown.over && shown.turn === view ? 'on' : ''}`}>
            <b>{view === 0 ? sa : sb}</b> {names[view]}
          </span>
        </div>
      )}
    </div>
  );
}

function LandRing({ c, u, vertical }: { c: Point; u: number; vertical: boolean }) {
  const w = (vertical ? 1.9 : 0.82) * u;
  const h = (vertical ? 0.82 : 1.9) * u;
  return <span className="g-mancala-landring" style={{ left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, borderRadius: 0.41 * u }} aria-hidden="true" />;
}

/** The host plays the first side; whoever else holds a seat plays the second (seat numbers can grow as people rejoin). */
function seatOf(online: NonNullable<ReturnType<typeof useOnline>>, side: Side): number {
  if (side === 0) return 0;
  return online.players.find((p) => p.seat !== 0)?.seat ?? (online.seat !== 0 ? online.seat : 1);
}

function sideNames(mode: 'cpu' | '2p' | 'online', online: ReturnType<typeof useOnline>, view: Side): Record<Side, string> {
  if (mode === 'cpu') return { 0: 'You', 1: 'Computer' };
  if (mode === 'online' && online) {
    const them = (1 - view) as Side;
    const name = online.players.find((p) => p.seat === seatOf(online, them))?.name ?? 'Opponent';
    return { [view]: 'You', [them]: name } as Record<Side, string>;
  }
  return { 0: 'Player 1', 1: 'Player 2' };
}
