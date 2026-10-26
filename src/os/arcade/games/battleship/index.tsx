import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelIndex, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import {
  FLEET,
  HIT,
  MISS,
  SIZE,
  SUNK,
  UNKNOWN,
  applyResult,
  boardGeometry,
  boardTopBelow,
  canPlace,
  chooseShot,
  consistent,
  fleetCode,
  frameUnit,
  isCompleteFleet,
  newIntel,
  parseFleet,
  parseMsg,
  randomFleet,
  resolveShot,
  rotateShip,
  shipCells,
  shipLen,
  topBarSlot,
  ZOOM_PAD,
  ZOOM_PAD_END,
  type Fleet,
  type Intel,
  type Level,
  type Rng,
  type Ship,
  type ShipId,
  type ShotResult,
} from './battleship.ts';
import { meta } from './meta';
import './battleship.css';

type Mode = 'cpu' | '2p';
type GameMode = Mode | 'online';
type Phase = 'place' | 'cover' | 'battle' | 'hold';
type CoverFor = 'place1' | 'place2' | 'battle';
type DragState = { id: ShipId; offset: number; x: number; y: number; candidate: Ship; valid: boolean };
type StatusLayout = { top: number; left: number | null; boardTop: number; below: boolean };
type GameState = {
  mode: GameMode;
  phase: Phase;
  coverFor: CoverFor;
  coverTitle: string;
  coverArmed: boolean;
  fleets: [Fleet, Fleet];
  targets: [Intel, Intel];
  ownIntel: [Intel, Intel];
  incoming: [Uint8Array, Uint8Array];
  placementSeat: number;
  viewer: number;
  touchAim: boolean;
  turn: number;
  shotsBySeat: [number, number];
  hitBySeat: [number, number];
  totalShots: number;
  onlineN: number;
  ready: [boolean, boolean];
  readyBusy: boolean;
  commits: [string, string];
  salts: [string, string];
  logs: [ShotResult[], ShotResult[]];
  pending: { n: number; cell: number; shooter: number } | null;
  pendingAnswer: ShotResult | null;
  waiting: boolean;
  status: string;
  selected: ShipId;
  drag: DragState | null;
  hover: number | null;
  cursor: number;
  aimed: number | null;
  lastTarget: [number | null, number | null];
  lastIncoming: [number | null, number | null];
  endRevealFleet: Fleet | null;
  endWinner: number | null;
  resultReported: boolean;
  titleWinner: number | null;
};

const MODE = defineSetting('battleship:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('battleship:level', LEVEL_NAMES, 'normal');
const FLEET_RNG: Rng = Math.random;
const cellCoord = (cell: number) => ({ r: Math.floor(cell / SIZE), c: cell % SIZE });
const validCell = (cell: number | null): cell is number => cell !== null && Number.isInteger(cell) && cell >= 0 && cell < SIZE * SIZE;
const opposite = (seat: number) => seat === 0 ? 1 : 0;
const makeTuple = <T,>(make: () => T): [T, T] => [make(), make()];

function createGameState(mode: GameMode, localSeat: number): GameState {
  const online = mode === 'online';
  const fleets: [Fleet, Fleet] = online
    ? localSeat === 0 ? [randomFleet(FLEET_RNG), []] : [[], randomFleet(FLEET_RNG)]
    : [randomFleet(FLEET_RNG), randomFleet(FLEET_RNG)];
  const isTwoPlayer = mode === '2p';
  return {
    mode,
    phase: isTwoPlayer ? 'cover' : 'place',
    coverFor: 'place1',
    coverTitle: 'Player 1, Place Your Fleet',
    coverArmed: false,
    fleets,
    targets: makeTuple(newIntel),
    ownIntel: makeTuple(newIntel),
    incoming: makeTuple(() => new Uint8Array(SIZE * SIZE)),
    placementSeat: online ? localSeat : 0,
    viewer: online ? localSeat : 0,
    touchAim: false,
    turn: 0,
    shotsBySeat: [0, 0],
    hitBySeat: [0, 0],
    totalShots: 0,
    onlineN: 0,
    ready: [false, false],
    readyBusy: false,
    commits: ['', ''],
    salts: ['', ''],
    logs: [[], []],
    pending: null,
    pendingAnswer: null,
    waiting: false,
    status: isTwoPlayer ? 'player 1, place your fleet' : 'place your fleet',
    selected: 'flagship',
    drag: null,
    hover: null,
    cursor: 44,
    aimed: null,
    lastTarget: [null, null],
    lastIncoming: [null, null],
    endRevealFleet: null,
    endWinner: null,
    resultReported: false,
    titleWinner: null,
  };
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={(n) => `${n} shots`} setup={<Setup />}>
      <Battleship />
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

function Battleship() {
  const shell = useShell();
  const online = useOnline();
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const statusRef = useRef<HTMLDivElement | null>(null);
  const [statusLayout, setStatusLayout] = useState<StatusLayout>({ top: 52, left: null, boardTop: 88, below: true });
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const level = levelIndex(levelName) as Level;
  const stateRef = useRef<GameState | null>(null);
  if (!stateRef.current) stateRef.current = createGameState(online ? 'online' : mode, online?.seat ?? 0);
  const state = stateRef.current;
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((revision) => revision + 1);
  const timerRef = useRef<{ remaining: number; callback: () => void } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<number | null>(null);
  const actionsRef = useRef<{ key: (code: string) => void; message: (from: number, data: unknown) => void }>({
    key: () => {},
    message: () => {},
  });
  const keys = useKeys((code) => actionsRef.current.key(code));
  const onlineRef = useRef(online);
  onlineRef.current = online;
  // The iPad frame scales the whole screen down; grow text and touch targets by the same factor so they read the same on screen.
  const [unit, setUnit] = useState(1);
  useEffect(() => {
    const root = shell.root.current;
    if (!root || !shell.touch) {
      setUnit(1);
      return;
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = frameUnit(root.getBoundingClientRect().width, root.offsetWidth);
        root.style.setProperty('--g-battleship-u', next.toFixed(3));
        setUnit((current) => Math.abs(current - next) < 0.001 ? current : next);
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--g-battleship-u');
    };
  }, [shell.touch]);

  useEffect(() => {
    const stage = stageRef.current;
    const status = statusRef.current;
    const shellRoot = stage?.closest<HTMLElement>('.arcade-shell');
    if (!stage || !status || !shellRoot) return;

    const controls = shellRoot.querySelector<HTMLElement>('.arcade-ctrl');
    const observed = new Set<HTMLElement>();
    const watch = (el: HTMLElement | null) => {
      if (el && !observed.has(el)) {
        resizeObserver.observe(el);
        observed.add(el);
      }
      return el;
    };
    const update = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      const stageRect = stage.getBoundingClientRect();
      const scaleX = stageRect.width / width || 1;
      const scaleY = stageRect.height / height || 1;
      const controlRect = controls?.getBoundingClientRect();
      const scoreRect = watch(shellRoot.querySelector<HTMLElement>('.arcade-score'))?.getBoundingClientRect();
      const badgeRect = watch(shellRoot.querySelector<HTMLElement>('.arcade-online-status'))?.getBoundingClientRect();
      const controlLeft = controlRect ? (controlRect.left - stageRect.left) / scaleX : width;
      const scoreRight = scoreRect ? (scoreRect.right - stageRect.left) / scaleX : 0;
      const leftEdge = scoreRect ? scoreRight + 8 : 8;
      const rightEdge = controlRect ? controlLeft - 8 : width - 8;
      const statusWidth = status.getBoundingClientRect().width / scaleX;
      const compact = height < 300;
      const regularBoardTop = Math.round((compact ? 40 : 64) * unit);

      const blocks: Array<[number, number]> = badgeRect
        ? [[(badgeRect.left - stageRect.left) / scaleX, (badgeRect.right - stageRect.left) / scaleX]]
        : [];
      const left = topBarSlot(leftEdge, rightEdge, statusWidth, blocks);
      if (left !== null) {
        setStatusLayout((current) =>
          current.top === 6 && current.left === left && current.boardTop === regularBoardTop && !current.below
            ? current
            : { top: 6, left, boardTop: regularBoardTop, below: false },
        );
        return;
      }

      const controlBottom = controlRect ? (controlRect.bottom - stageRect.top) / scaleY : 0;
      const scoreBottom = scoreRect ? (scoreRect.bottom - stageRect.top) / scaleY : 0;
      const badgeBottom = badgeRect ? (badgeRect.bottom - stageRect.top) / scaleY : 0;
      const top = Math.ceil(Math.max(controlBottom, scoreBottom, badgeBottom) + 8);
      const statusHeight = status.getBoundingClientRect().height / scaleY;
      const boardTop = boardTopBelow(top + statusHeight, unit);
      setStatusLayout((current) =>
        current.top === top && current.left === null && current.boardTop === boardTop && current.below
          ? current
          : { top, left: null, boardTop, below: true },
      );
    };
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(stage);
    resizeObserver.observe(status);
    if (controls) resizeObserver.observe(controls);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(shellRoot, { childList: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [size.w, size.h, state.status, unit]);

  const setTimer = (seconds: number, callback: () => void) => {
    timerRef.current = { remaining: seconds, callback };
  };
  const cancelTimer = () => {
    timerRef.current = null;
  };
  const localSeat = online?.seat ?? 0;
  const playerName = (seat: number) => online?.players.find((player) => player.seat === seat)?.name ?? 'opponent';
  const isHumanTurn = (s = stateRef.current!) =>
    s.phase === 'battle' && s.endWinner === null && s.turn >= 0 &&
    (s.mode === '2p' || (s.mode === 'cpu' && s.turn === 0) || (s.mode === 'online' && s.turn === localSeat && !s.waiting));

  const reset = () => {
    const s = createGameState(online ? 'online' : mode, online?.seat ?? 0);
    stateRef.current = s;
    cancelTimer();
    shell.setScore(null);
    if (s.phase === 'cover') setTimer(0.6, () => {
      s.coverArmed = true;
      refresh();
    });
    refresh();
  };

  useEffect(() => {
    if (shell.status === 'ready') reset();
  }, [mode, levelName, shell.status, online?.seat]);

  // A clicked game button often unmounts or disables itself (Start Battle, Ready, Fire), which drops focus to the page; hand it back so keys keep working.
  const refocusRef = useRef(0);
  const keepFocus = () => {
    window.clearTimeout(refocusRef.current);
    refocusRef.current = window.setTimeout(() => {
      const root = shell.root.current;
      const active = document.activeElement;
      if (root?.isConnected && (!active || active === document.body || (root.contains(active) && (active as HTMLButtonElement).disabled))) {
        root.focus({ preventScroll: true });
      }
    }, 0);
  };

  useEffect(() => () => {
    window.clearTimeout(refocusRef.current);
    cancelTimer();
    const board = boardRef.current;
    const pointer = pointerRef.current;
    if (board && pointer !== null && board.hasPointerCapture(pointer)) board.releasePointerCapture(pointer);
    pointerRef.current = null;
    keys.clear();
  }, []);

  const markResult = (s: GameState, shooter: number, result: ShotResult) => {
    const owner = opposite(shooter);
    applyResult(s.targets[shooter], result);
    applyResult(s.ownIntel[owner], result);
    s.incoming[owner][result.cell] = 1;
    s.lastTarget[shooter] = result.cell;
    s.lastIncoming[owner] = result.cell;
    s.aimed = null;
    s.hover = null;
    s.shotsBySeat[shooter]++;
    s.totalShots++;
    if (result.hit) s.hitBySeat[shooter]++;
    if (s.mode === 'cpu') shell.setScore(s.shotsBySeat[0]);
    if (s.mode === '2p' || s.mode === 'online') shell.setScore(null);
    if (result.all) sfx.play(shooter === (s.mode === 'online' ? localSeat : 0) ? 'win' : 'lose');
    else if (result.sunk) sfx.play('boom');
    else if (result.hit) sfx.play('hit');
    else {
      sfx.noise(0.25, 0.15);
      sfx.play('select', 0.55);
    }
  };

  const resultStatus = (shooter: number, result: ShotResult) => {
    const fromLocal = stateRef.current!.mode === 'online' ? shooter === localSeat : shooter === 0;
    if (result.all) return fromLocal ? 'you sank their fleet' : 'they sank your fleet';
    if (result.sunk) {
      const name = FLEET.find((ship) => ship.id === result.sunk)?.name.toLowerCase() ?? 'ship';
      return fromLocal ? `you sank their ${name}` : `they sank your ${name}`;
    }
    if (result.hit) return fromLocal ? 'hit' : 'they hit your ship';
    return fromLocal ? 'miss' : 'they missed';
  };

  const finishLocal = (s: GameState, winner: number) => {
    if (s.endWinner !== null) return;
    s.endWinner = winner;
    s.endRevealFleet = s.fleets[opposite(s.viewer)];
    s.turn = winner;
    s.phase = 'battle';
    s.status = winner === 0 ? (s.mode === '2p' ? 'player 1 wins' : 'you win') : (s.mode === '2p' ? 'player 2 wins' : 'computer wins');
    cancelTimer();
    setTimer(1.8, () => {
      if (stateRef.current !== s || s.resultReported) return;
      s.resultReported = true;
      if (s.mode === 'cpu') {
        if (winner === 0) {
          const shots = s.shotsBySeat[0];
          const accuracy = Math.round((s.hitBySeat[0] / Math.max(1, shots)) * 100);
          shell.gameOver(shots, {
            title: 'You Win',
            detail: `sunk their fleet in ${shots} shots, ${accuracy}% hit rate.`,
          });
        } else {
          const escaped = FLEET.length - s.ownIntel[0].sunk.length;
          shell.gameOver(undefined, {
            title: 'Computer Wins',
            detail: `they needed ${s.shotsBySeat[1]} shots. ${escaped} of your ships made it home.`,
          });
        }
      } else {
        shell.gameOver(undefined, {
          title: `Player ${winner + 1} Wins`,
          detail: `in ${s.totalShots} shots.`,
        });
      }
      refresh();
    });
    refresh();
  };

  const finishOnline = (s: GameState, winner: number) => {
    if (s.endWinner !== null) return;
    s.endWinner = winner;
    s.phase = 'battle';
    s.turn = opposite(winner);
    s.status = winner === localSeat ? 'you win' : `${playerName(winner)} wins`;
    const code = fleetCode(s.fleets[localSeat]);
    const salt = s.salts[localSeat];
    onlineRef.current?.send({ game: 'battleship', t: 'reveal', fleet: code, salt });
    cancelTimer();
    setTimer(1.8, () => {
      if (stateRef.current !== s || s.resultReported) return;
      s.resultReported = true;
      const currentOnline = onlineRef.current;
      if (!currentOnline) return;
      const winnerForTitle = s.titleWinner ?? s.endWinner;
      const title = winnerForTitle === localSeat ? 'You Win' : `${playerName(opposite(localSeat))} Wins`;
      currentOnline.reportResult(currentOnline.round, s.endWinner);
      shell.gameOver(undefined, { title, detail: `in ${s.totalShots} shots.` });
      refresh();
    });
    refresh();
  };

  const applyLocalShot = (s: GameState, shooter: number, result: ShotResult) => {
    markResult(s, shooter, result);
    s.status = resultStatus(shooter, result);
    s.turn = opposite(shooter);
    s.aimed = null;
    if (result.all) {
      finishLocal(s, shooter);
      return;
    }
    if (s.mode === '2p') {
      s.phase = 'hold';
      setTimer(1.1, () => {
        if (stateRef.current !== s) return;
        s.phase = 'cover';
        s.coverFor = 'battle';
        s.coverTitle = `Pass to Player ${s.turn + 1}`;
        s.coverArmed = false;
        s.status = `player ${s.turn + 1}, your turn`;
        setTimer(0.6, () => {
          s.coverArmed = true;
          refresh();
        });
        refresh();
      });
      return;
    }
    if (s.mode === 'cpu' && s.turn === 1) {
      const thinkingFor = 0.45 + Math.random() * 0.4;
      s.status = 'computer is aiming';
      setTimer(thinkingFor, () => {
        if (stateRef.current !== s || s.phase !== 'battle' || s.turn !== 1) return;
        const target = chooseShot(s.targets[1], level, Math.random);
        const answer = resolveShot(s.fleets[0], s.incoming[0], target);
        s.incoming[0][target] = 1;
        applyLocalShot(s, 1, answer);
      });
    }
    refresh();
  };

  const startBattle = () => {
    const s = stateRef.current!;
    if (!isCompleteFleet(s.fleets[s.placementSeat]) || s.phase !== 'place') return;
    if (s.mode === 'online') {
      void readyOnline(s);
      return;
    }
    if (s.mode === '2p' && s.placementSeat === 0) {
      s.phase = 'cover';
      s.coverFor = 'place2';
      s.coverTitle = 'Pass to Player 2';
      s.coverArmed = false;
      s.status = 'player 2, place your fleet';
      setTimer(0.6, () => {
        s.coverArmed = true;
        refresh();
      });
    } else if (s.mode === '2p') {
      s.phase = 'cover';
      s.coverFor = 'battle';
      s.coverTitle = 'Pass to Player 1';
      s.coverArmed = false;
      s.turn = 0;
      s.status = 'player 1, your turn';
      setTimer(0.6, () => {
        s.coverArmed = true;
        refresh();
      });
    } else {
      s.phase = 'battle';
      s.turn = 0;
      s.status = 'your turn';
    }
    sfx.play('tick');
    refresh();
  };

  const beginCover = (s: GameState) => {
    if (!s.coverArmed || s.phase !== 'cover') return;
    cancelTimer();
    if (s.coverFor === 'place1') {
      s.phase = 'place';
      s.placementSeat = 0;
      s.status = 'place your fleet';
    } else if (s.coverFor === 'place2') {
      s.phase = 'place';
      s.placementSeat = 1;
      s.status = 'place your fleet';
    } else {
      s.phase = 'battle';
      s.viewer = s.turn;
      s.status = s.mode === 'online'
        ? s.turn === localSeat ? 'your turn' : `${playerName(s.turn)} is firing`
        : s.mode === '2p' ? `player ${s.turn + 1}, your turn` : 'your turn';
    }
    refresh();
  };

  const fireOnline = (s: GameState, cell: number) => {
    const connection = onlineRef.current;
    if (!connection || s.waiting || s.phase !== 'battle' || s.turn !== localSeat || s.targets[localSeat].cells[cell] !== UNKNOWN) return;
    const n = s.onlineN;
    s.pending = { n, cell, shooter: localSeat };
    s.waiting = true;
    s.status = 'firing...';
    connection.send({ game: 'battleship', t: 'shot', n, cell });
    refresh();
  };

  const fire = (cell: number) => {
    const s = stateRef.current!;
    if (!isHumanTurn(s) || !validCell(cell)) return;
    if (s.targets[s.turn].cells[cell] !== UNKNOWN) {
      sfx.play('blip');
      return;
    }
    if (s.mode === 'online') {
      fireOnline(s, cell);
      return;
    }
    const shooter = s.turn;
    const owner = opposite(shooter);
    const answer = resolveShot(s.fleets[owner], s.incoming[owner], cell);
    s.incoming[owner][cell] = 1;
    applyLocalShot(s, shooter, answer);
  };

  const acceptOnlineResult = (s: GameState, shooter: number, result: ShotResult) => {
    const owner = opposite(shooter);
    markResult(s, shooter, result);
    s.logs[owner].push(result);
    s.onlineN++;
    s.pending = null;
    s.pendingAnswer = null;
    s.waiting = false;
    s.turn = opposite(shooter);
    s.status = resultStatus(shooter, result);
    if (result.all) {
      finishOnline(s, shooter);
      return;
    }
    if (s.turn === localSeat) s.status = 'your turn';
    else s.status = `${playerName(s.turn)} is firing`;
    refresh();
  };

  const startOnlineRound = (s: GameState, first: 0 | 1) => {
    if (s.phase !== 'place' || !s.ready[localSeat] || !s.ready[opposite(localSeat)]) return;
    s.phase = 'battle';
    s.turn = first;
    s.status = first === localSeat ? 'your turn' : `${playerName(first)} is firing`;
    refresh();
  };

  const startHostRound = (s: GameState) => {
    const connection = onlineRef.current;
    if (!connection?.isHost || s.mode !== 'online' || s.phase !== 'place' ||
        !s.ready[0] || !s.ready[1] || s.waiting) return;
    const first: 0 | 1 = connection.round % 2 === 0 ? 0 : 1;
    connection.send({ game: 'battleship', t: 'begin', first });
    startOnlineRound(s, first);
  };

  const setShipAt = (id: ShipId, r: number, c: number, horiz?: boolean) => {
    const s = stateRef.current!;
    if (s.phase !== 'place' || s.mode === 'online' && s.ready[localSeat]) return false;
    const fleet = s.fleets[s.placementSeat];
    const original = fleet.find((ship) => ship.id === id);
    if (!original) return false;
    const next = { ...original, r, c, ...(horiz === undefined ? {} : { horiz }) };
    if (!canPlace(fleet, next)) return false;
    s.fleets[s.placementSeat] = fleet.map((ship) => ship.id === id ? next : ship);
    s.selected = id;
    return true;
  };

  const rotateSelected = () => {
    const s = stateRef.current!;
    if (s.phase !== 'place' || s.mode === 'online' && s.ready[localSeat]) return;
    const next = rotateShip(s.fleets[s.placementSeat], s.selected);
    if (!next) {
      sfx.play('blip');
      refresh();
      return;
    }
    s.fleets[s.placementSeat] = s.fleets[s.placementSeat].map((ship) => ship.id === next.id ? next : ship);
    sfx.play('blip');
    refresh();
  };

  const moveSelected = (dr: number, dc: number) => {
    const s = stateRef.current!;
    if (s.phase !== 'place') return;
    const ship = s.fleets[s.placementSeat].find((candidate) => candidate.id === s.selected);
    if (!ship) return;
    if (setShipAt(ship.id, ship.r + dr, ship.c + dc)) {
      sfx.play('tick');
      refresh();
    } else sfx.play('blip');
  };

  const randomize = () => {
    const s = stateRef.current!;
    if (s.phase !== 'place' || s.mode === 'online' && s.ready[localSeat]) return;
    s.fleets[s.placementSeat] = randomFleet(FLEET_RNG);
    s.drag = null;
    sfx.play('tick');
    refresh();
  };

  const pointerCell = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-cell]');
    const cell = Number(element?.dataset.cell);
    return element && event.currentTarget.contains(element) && Number.isInteger(cell) && cell >= 0 && cell < SIZE * SIZE ? cell : null;
  };

  const onBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>, target: boolean) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const cell = pointerCell(event);
    if (!validCell(cell)) return;
    const s = stateRef.current!;
    const board = event.currentTarget;
    if (board.setPointerCapture) {
      try {
        board.setPointerCapture(event.pointerId);
        pointerRef.current = event.pointerId;
        boardRef.current = board;
      } catch {
        pointerRef.current = null;
      }
    }
    if (target) {
      if (!isHumanTurn(s)) return;
      s.hover = cell;
      s.drag = null;
      if (event.pointerType !== 'touch') s.aimed = cell;
      refresh();
      return;
    }
    if (s.phase !== 'place' || s.mode === 'online' && s.ready[localSeat]) return;
    const fleet = s.fleets[s.placementSeat];
    const ship = fleet.find((candidate) => shipCells(candidate).includes(cell));
    if (!ship) return;
    s.selected = ship.id;
    s.drag = {
      id: ship.id,
      offset: shipCells(ship).indexOf(cell),
      x: event.clientX,
      y: event.clientY,
      candidate: { ...ship },
      valid: true,
    };
    event.preventDefault();
    refresh();
  };

  const onBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>, target: boolean) => {
    const s = stateRef.current!;
    const cell = pointerCell(event);
    if (target) {
      if (isHumanTurn(s) && validCell(cell) && cell !== s.hover) {
        s.hover = cell;
        if (event.pointerType !== 'touch') {
          s.aimed = cell;
          s.cursor = cell;
          s.touchAim = false;
        }
        refresh();
      }
      return;
    }
    if (!s.drag || !validCell(cell)) return;
    const original = s.fleets[s.placementSeat].find((ship) => ship.id === s.drag!.id);
    if (!original) return;
    const at = cellCoord(cell);
    const candidate: Ship = {
      ...original,
      r: at.r - (original.horiz ? 0 : s.drag.offset),
      c: at.c - (original.horiz ? s.drag.offset : 0),
    };
    const moved = Math.hypot(event.clientX - s.drag.x, event.clientY - s.drag.y) >= 6;
    s.drag = { ...s.drag, candidate, valid: canPlace(s.fleets[s.placementSeat], candidate), ...(moved ? { x: s.drag.x, y: s.drag.y } : {}) };
    refresh();
  };

  const onBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>, target: boolean) => {
    const s = stateRef.current!;
    const cell = pointerCell(event);
    if (target) {
      const wasAimed = s.aimed === cell;
      s.hover = validCell(cell) ? cell : null;
      if (validCell(cell)) {
        if (event.pointerType === 'touch') {
          if (wasAimed) fire(cell);
          else {
            s.aimed = cell;
            s.cursor = cell;
            s.touchAim = true;
            refresh();
          }
        } else fire(cell);
      }
    } else if (s.drag) {
      const drag = s.drag;
      const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 6;
      const fleet = s.fleets[s.placementSeat];
      const original = fleet.find((ship) => ship.id === drag.id);
      const dropCell = pointerCell(event);
      const at = validCell(dropCell) ? cellCoord(dropCell) : null;
      const candidate = original && at ? {
        ...original,
        r: at.r - (original.horiz ? 0 : drag.offset),
        c: at.c - (original.horiz ? drag.offset : 0),
      } : null;
      if (moved && candidate && canPlace(fleet, candidate)) {
        s.fleets[s.placementSeat] = fleet.map((ship) => ship.id === drag.id ? candidate : ship);
        sfx.play('tick');
      } else if (!moved) rotateSelected();
      s.drag = null;
      refresh();
    }
    if (boardRef.current && boardRef.current.hasPointerCapture(event.pointerId)) {
      boardRef.current.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
  };

  const onBoardPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const s = stateRef.current!;
    s.drag = null;
    s.hover = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current = null;
    refresh();
  };

  const fireAimed = () => {
    const s = stateRef.current!;
    if (validCell(s.aimed)) fire(s.aimed);
  };

  const keyboardAction = (code: string) => {
    const s = stateRef.current!;
    if (s.phase === 'cover') {
      if (code === 'Enter' || code === 'Space') beginCover(s);
      return;
    }
    if (s.phase === 'place') {
      const digit = /^Digit([1-5])$/.exec(code);
      if (digit) {
        s.selected = FLEET[Number(digit[1]) - 1].id;
        refresh();
      } else if (code === 'KeyR') rotateSelected();
      else if (code === 'ArrowLeft') moveSelected(0, -1);
      else if (code === 'ArrowRight') moveSelected(0, 1);
      else if (code === 'ArrowUp') moveSelected(-1, 0);
      else if (code === 'ArrowDown') moveSelected(1, 0);
      else if (code === 'Enter') startBattle();
      return;
    }
    if (s.phase !== 'battle' || !isHumanTurn(s)) return;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
      const { r, c } = cellCoord(s.cursor);
      const nextR = Math.max(0, Math.min(SIZE - 1, r + (code === 'ArrowUp' ? -1 : code === 'ArrowDown' ? 1 : 0)));
      const nextC = Math.max(0, Math.min(SIZE - 1, c + (code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : 0)));
      s.cursor = nextR * SIZE + nextC;
      s.aimed = s.cursor;
      refresh();
    } else if (code === 'Enter' || code === 'Space') fire(s.cursor);
  };

  const commitValid = async (fleet: Fleet): Promise<{ commit: string; salt: string }> => {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const salt = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!globalThis.crypto?.subtle) return { commit: '', salt };
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${fleetCode(fleet)}|${salt}`));
    return { commit: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), salt };
  };

  const verifyValidCommit = async (code: string, salt: string, commit: string) => {
    if (!globalThis.crypto?.subtle) return true;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${code}|${salt}`));
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return actual === commit;
  };

  const readyOnline = async (s: GameState) => {
    const connection = onlineRef.current;
    if (!connection || s.mode !== 'online' || s.ready[localSeat] || s.readyBusy || !isCompleteFleet(s.fleets[localSeat])) return;
    s.readyBusy = true;
    refresh();
    const secret = await commitValid(s.fleets[localSeat]);
    if (stateRef.current !== s) return;
    s.readyBusy = false;
    s.salts[localSeat] = secret.salt;
    s.commits[localSeat] = secret.commit;
    s.ready[localSeat] = true;
    const other = opposite(localSeat);
    s.status = s.ready[other] ? `${playerName(other)} is ready` : `waiting for ${playerName(other)}`;
    connection.send({ game: 'battleship', t: 'ready', commit: secret.commit });
    startHostRound(s);
    refresh();
  };

  const handleOnlineMessage = async (from: number, data: unknown) => {
    const connection = onlineRef.current;
    const s = stateRef.current;
    if (!connection || !s || from === connection.seat) return;
    if (from !== opposite(connection.seat)) return;
    const message = parseMsg(data);
    if (!message) return;
    const other = opposite(connection.seat);
    if (message.t === 'ready') {
      s.ready[from] = true;
      s.commits[from] = message.commit;
      s.status = `${playerName(from)} is ready`;
      startHostRound(s);
      refresh();
      return;
    }
    if (message.t === 'begin') {
      if (from !== 0 || connection.isHost || !s.ready[localSeat] || !s.ready[other]) return;
      startOnlineRound(s, message.first);
      return;
    }
    if (message.t === 'shot') {
      if (s.phase !== 'battle' || s.turn !== from || message.n !== s.onlineN ||
          s.targets[from].cells[message.cell] !== UNKNOWN) return;
      if (connection.isHost) {
        if (from !== 1) return;
        const answer = resolveShot(s.fleets[0], s.incoming[0], message.cell);
        s.incoming[0][message.cell] = 1;
        s.logs[0].push(answer);
        markResult(s, from, answer);
        s.onlineN++;
        s.turn = 0;
        s.status = resultStatus(from, answer);
        connection.send({ game: 'battleship', t: 'result', n: message.n, shooter: from, res: answer, next: 0 });
        if (answer.all) finishOnline(s, from);
        else {
          s.status = 'your turn';
          refresh();
        }
        return;
      }
      if (from !== 0 || s.waiting) return;
      const answer = resolveShot(s.fleets[localSeat], s.incoming[localSeat], message.cell);
      s.pending = { n: message.n, cell: message.cell, shooter: from };
      s.pendingAnswer = answer;
      s.waiting = true;
      s.status = 'firing...';
      connection.send({ game: 'battleship', t: 'answer', n: message.n, res: answer });
      refresh();
      return;
    }
    if (message.t === 'answer') {
      const pending = s.pending;
      const result = message.res;
      const alreadySunk = result.sunk !== null && s.targets[0].sunk.includes(result.sunk);
      const wouldHaveSunkAll = s.targets[0].sunk.length + (result.sunk && !alreadySunk ? 1 : 0) === FLEET.length;
      const cellsMatchIntel = result.sunkCells?.every((cell) =>
        cell === result.cell || s.targets[0].cells[cell] === HIT) ?? result.sunkCells === null;
      if (!connection.isHost || from !== 1 || s.phase !== 'battle' || s.turn !== 0 ||
          !pending || pending.shooter !== 0 ||
          message.n !== s.onlineN || pending.n !== message.n || result.cell !== pending.cell ||
          s.targets[0].cells[pending.cell] !== UNKNOWN || alreadySunk || !cellsMatchIntel ||
          result.all !== wouldHaveSunkAll) return;
      connection.send({ game: 'battleship', t: 'result', n: message.n, shooter: 0, res: result, next: 1 });
      acceptOnlineResult(s, 0, result);
      return;
    }
    if (message.t === 'result') {
      if (connection.isHost || from !== 0 || s.phase !== 'battle' || message.n !== s.onlineN ||
          message.shooter !== s.turn || message.next !== opposite(message.shooter) ||
          s.targets[message.shooter].cells[message.res.cell] !== UNKNOWN) return;
      if (message.shooter === localSeat) {
        if (!s.pending || s.pending.n !== message.n || s.pending.cell !== message.res.cell) return;
      } else {
        if (!s.pending || !s.pendingAnswer || s.pending.n !== message.n || s.pending.cell !== message.res.cell ||
            !sameShotResult(s.pendingAnswer, message.res)) return;
      }
      acceptOnlineResult(s, message.shooter, message.res);
      return;
    }
    if (message.t === 'reveal') {
      if (s.endWinner === null) return;
      const revealed = parseFleet(message.fleet);
      if (!revealed) return;
      const expectedCommit = s.commits[from];
      const matches = expectedCommit ? await verifyValidCommit(message.fleet, message.salt, expectedCommit) : true;
      if (!matches || !consistent(revealed, s.logs[from])) {
        s.status = "their fleet didn't match their answers";
        s.titleWinner = localSeat;
        refresh();
        return;
      }
      s.endRevealFleet = revealed;
      refresh();
    }
  };
  actionsRef.current.key = keyboardAction;
  actionsRef.current.message = (from, data) => { void handleOnlineMessage(from, data); };

  useEffect(() => online?.onMessage((from, data) => actionsRef.current.message(from, data)), [online?.onMessage]);

  useGameLoop((dt) => {
    const timer = timerRef.current;
    if (!timer) {
      const s = stateRef.current;
      if (s?.phase === 'cover' && !s.coverArmed) setTimer(0.6, () => {
        s.coverArmed = true;
        refresh();
      });
      return;
    }
    timer.remaining -= dt;
    if (timer.remaining <= 0 && timerRef.current === timer) {
      timerRef.current = null;
      timer.callback();
    }
  });

  // On touch, enemy squares keep at least 40px on screen; a board that can't fit at that size pans inside its view.
  const minTouchCell = shell.touch ? Math.ceil(40 * unit) : 0;
  const geometry = boardGeometry(size.w, size.h, state.phase === 'place', statusLayout.boardTop, unit, minTouchCell);
  const localFleet = state.fleets[state.placementSeat];
  const drag = state.drag;
  const targetSeat = state.mode === 'online' ? localSeat : state.viewer;
  const renderTargetShips = state.endRevealFleet ?? state.targets[targetSeat].sunkShips;
  const boardTargetLabel = state.endRevealFleet ? 'enemy fleet revealed' : state.mode === '2p' ? `player ${opposite(state.viewer) + 1}` : state.mode === 'online' ? playerName(opposite(localSeat)) : 'enemy waters';
  const targetIntel = state.targets[targetSeat];
  const targetLast = state.lastTarget[targetSeat];
  const ownSeat = targetSeat;
  const ownIntel = state.ownIntel[ownSeat];
  const ownBoardLabel = state.mode === '2p' ? `player ${ownSeat + 1}` : 'your fleet';
  const placementShip = drag?.candidate;
  const showCover = state.phase === 'cover' && (shell.status === 'playing' || shell.status === 'paused');
  const targetInteractive = state.phase === 'battle' && isHumanTurn(state);
  const showFire = targetInteractive && state.aimed !== null && (geometry.portrait || state.touchAim);
  const stageClass = `g-battleship-stage${size.h < 220 ? ' compact-height' : ''}${size.h < 300 ? ' short-window' : ''}${geometry.portrait ? ' portrait' : ''}${statusLayout.below ? ' status-below' : ''}`;
  const targetBoardStyle = boardStyle(geometry.targetCell, geometry.targetX, geometry.targetY);
  const ownBoardStyle = boardStyle(geometry.ownCell, geometry.ownX, geometry.ownY);
  const placementBoardStyle = boardStyle(geometry.placeCell, geometry.placeX, geometry.placeY);

  return (
    <div ref={stageRef} className={stageClass} onClick={(event) => {
      if ((event.target as HTMLElement).closest('button')) keepFocus();
    }}>
      <div
        ref={statusRef}
        className="g-battleship-status"
        style={{
          top: statusLayout.top,
          left: statusLayout.left ?? '50%',
          transform: statusLayout.left === null ? 'translateX(-50%)' : 'none',
        }}
        aria-live="polite"
      >
        {state.status}
      </div>
      {state.phase === 'place' && (
        <>
          <Board
            refBoard={boardRef}
            style={placementBoardStyle}
            caption={state.mode === '2p' ? `player ${state.placementSeat + 1}, your fleet` : 'your fleet'}
            fleet={localFleet}
            intel={newIntel()}
            last={null}
            placement
            selected={state.selected}
            drag={drag}
            ghost={placementShip}
            ghostValid={drag?.valid ?? true}
            active={true}
            onPointerDown={(event) => onBoardPointerDown(event, false)}
            onPointerMove={(event) => onBoardPointerMove(event, false)}
            onPointerUp={(event) => onBoardPointerUp(event, false)}
            onPointerCancel={onBoardPointerCancel}
          />
          <div className="g-battleship-place-tools" style={{ left: geometry.toolsX, top: geometry.toolsY }}>
            <button type="button" className="arcade-btn" onClick={randomize} disabled={state.mode === 'online' && state.ready[localSeat]}>Random</button>
            <button type="button" className="arcade-btn" onClick={rotateSelected} disabled={state.mode === 'online' && state.ready[localSeat]}>Rotate</button>
            <button
              type="button"
              className="arcade-btn arcade-btn-primary"
              onClick={startBattle}
              disabled={!isCompleteFleet(localFleet) || state.mode === 'online' && (state.ready[localSeat] || state.readyBusy)}
            >
              {state.mode === 'online' ? state.ready[localSeat] || state.readyBusy ? 'Waiting' : 'Ready' : 'Start Battle'}
            </button>
          </div>
        </>
      )}
      {(state.phase === 'battle' || state.phase === 'hold') && (
        <>
          <Board
            style={targetBoardStyle}
            view={geometry.zoomed ? { w: geometry.targetViewW, h: geometry.targetViewH, pad: ZOOM_PAD * unit, padEnd: ZOOM_PAD_END * unit } : undefined}
            caption={boardTargetLabel}
            fleet={renderTargetShips}
            intel={targetIntel}
            last={targetLast}
            placement={false}
            selected={null}
            drag={null}
            ghost={null}
            ghostValid={false}
            active={targetInteractive}
            aimed={state.aimed}
            hover={state.hover}
            cursor={state.cursor}
            lastHit={state.lastTarget[targetSeat]}
            onPointerDown={(event) => onBoardPointerDown(event, true)}
            onPointerMove={(event) => onBoardPointerMove(event, true)}
            onPointerUp={(event) => onBoardPointerUp(event, true)}
            onPointerCancel={onBoardPointerCancel}
          />
          <Board
            style={ownBoardStyle}
            caption={ownBoardLabel}
            fleet={state.fleets[ownSeat]}
            intel={ownIntel}
            last={state.lastIncoming[ownSeat]}
            placement={false}
            selected={null}
            drag={null}
            ghost={null}
            ghostValid={false}
            active={false}
            lastHit={state.lastIncoming[ownSeat]}
            own
          />
          {showFire && (
            <button
              type="button"
              className="g-battleship-fire arcade-btn arcade-btn-primary"
              style={{ left: geometry.fireX, top: geometry.fireY }}
              onClick={fireAimed}
            >
              Fire
            </button>
          )}
        </>
      )}
      {showCover && (
        <div className="g-battleship-cover">
          <h2>{state.coverTitle}</h2>
          <p>{state.coverFor === 'battle' ? 'tap ready when only they can see the screen' : 'tap ready when only they can see the screen'}</p>
          <button type="button" className="arcade-btn arcade-btn-primary" disabled={!state.coverArmed} onClick={() => beginCover(state)}>Ready</button>
        </div>
      )}
    </div>
  );
}

type BoardProps = {
  refBoard?: Ref<HTMLDivElement>;
  style: CSSProperties;
  view?: { w: number; h: number; pad: number; padEnd: number };
  caption: string;
  fleet: Fleet;
  intel: Intel;
  last: number | null;
  placement: boolean;
  selected: ShipId | null;
  drag: DragState | null;
  ghost: Ship | null | undefined;
  ghostValid: boolean;
  active: boolean;
  aimed?: number | null;
  hover?: number | null;
  cursor?: number;
  lastHit?: number | null;
  own?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

function Board({
  refBoard,
  style,
  view,
  caption,
  fleet,
  intel,
  last,
  placement,
  selected,
  drag,
  ghost,
  ghostValid,
  active,
  aimed = null,
  hover = null,
  cursor = -1,
  lastHit = null,
  own = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: BoardProps) {
  const ships = ghost ? fleet.map((ship) => ship.id === ghost.id ? ghost : ship) : fleet;
  const boardClass = [
    'g-battleship-board',
    placement ? 'placing' : 'battle-board',
    active ? 'active' : '',
    ghost ? ghostValid ? 'ghost-valid' : 'ghost-invalid' : '',
    lastHit !== null && lastHit !== undefined && (intel.cells[lastHit] === HIT || intel.cells[lastHit] === SUNK) ? 'has-hit' : '',
  ].filter(Boolean).join(' ');
  const viewRef = useRef<HTMLDivElement | null>(null);
  const zoomed = !!view;
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el || !zoomed) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [zoomed]);
  const side = Number(style.width) || 0;
  return (
    <div
      className={`g-battleship-board-wrap${own ? ' own' : ''}`}
      style={{ left: style.left, top: style.top, width: view ? view.w : style.width, height: view ? view.h : style.height }}
    >
      <div className="g-battleship-caption">{caption}</div>
      <div ref={viewRef} className={`g-battleship-board-view${zoomed ? ' zoomed' : ''}`}>
        {view && (
          <div
            className="g-battleship-board-extent"
            style={{ width: view.pad + side + view.padEnd, height: view.pad + side + view.padEnd }}
            aria-hidden="true"
          />
        )}
        <div
          ref={refBoard}
          className={boardClass}
          style={{ ...style, left: view ? view.pad : 0, top: view ? view.pad : 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-label={caption}
        >
          {Array.from({ length: SIZE * SIZE }, (_, cell) => {
            const row = Math.floor(cell / SIZE);
            const col = cell % SIZE;
            const value = intel.cells[cell];
            const labels = `${String.fromCharCode(65 + row)}${col + 1}`;
            const marker = value === MISS ? 'miss' : value === HIT ? 'hit' : value === SUNK ? 'sunk' : '';
            const classes = [
              'g-battleship-cell',
              marker,
              cell === last ? 'last' : '',
              cell === aimed || cell === cursor ? 'aimed' : '',
              cell === hover ? 'hovered' : '',
              row === 0 ? 'first-row' : '',
              col === 0 ? 'first-col' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                type="button"
                key={cell}
                className={classes}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}
                data-cell={cell}
                data-label={labels}
                data-row={String.fromCharCode(65 + row)}
                data-col={col + 1}
                aria-label={`${labels}${marker ? `, ${marker}` : ''}`}
                tabIndex={-1}
                disabled={!active}
              >
                <span className="g-battleship-marker" aria-hidden="true" />
                {row === 0 && <span className="g-battleship-coordinate-col" aria-hidden="true">{col + 1}</span>}
                {col === 0 && <span className="g-battleship-coordinate-row" aria-hidden="true">{String.fromCharCode(65 + row)}</span>}
              </button>
            );
          })}
          {ships.map((ship) => {
            const hitShip = intel.sunk.includes(ship.id);
            const length = shipLen(ship.id);
            const shipClass = [
              'g-battleship-hull',
              ship.horiz ? 'horizontal' : 'vertical',
              length >= 3 ? 'detailed' : '',
              placement && selected === ship.id ? 'selected' : '',
              drag?.id === ship.id ? 'dragging' : '',
              hitShip ? 'sunk' : '',
              ghost?.id === ship.id ? 'ghost' : '',
              ghost?.id === ship.id && !ghostValid ? 'invalid' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={ship.id}
                className={shipClass}
                style={{
                  gridRow: `${ship.r + 1} / span ${ship.horiz ? 1 : shipLen(ship.id)}`,
                  gridColumn: `${ship.c + 1} / span ${ship.horiz ? shipLen(ship.id) : 1}`,
                }}
                aria-label={FLEET.find((item) => item.id === ship.id)?.name}
              >
                <span className="g-battleship-deck">
                  {length >= 3 && (
                    <>
                      <span className="g-battleship-superstructure forward" />
                      <span className="g-battleship-superstructure aft" />
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function boardStyle(cell: number, x: number, y: number): CSSProperties {
  const side = cell * SIZE + SIZE - 1;
  return {
    left: x,
    top: y,
    width: side,
    height: side,
    '--cell': `${cell}px`,
  } as CSSProperties;
}

function sameShotResult(a: ShotResult, b: ShotResult): boolean {
  return a.cell === b.cell && a.hit === b.hit && a.sunk === b.sunk && a.all === b.all &&
    (a.sunkCells === null ? b.sunkCells === null : !!b.sunkCells && a.sunkCells.length === b.sunkCells.length &&
      a.sunkCells.every((cell, index) => cell === b.sunkCells![index]));
}
