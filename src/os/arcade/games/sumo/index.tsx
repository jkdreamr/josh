import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { think } from './ai';
import { CAR_COLORS, createScene, type View } from './scene';
import { configOf, endOf, hostState, inputOf, parsePacket, type PackedCar } from './net';
import { TARGET, createWorld, matchWinner, step, takeoverDeparted, type CarConfig, type Input, type Level, type World } from './logic';
import { meta } from './meta';
import './sumo.css';

type LevelName = (typeof LEVEL_NAMES)[number];
type Mode = 'cpu' | '2p';
type StageMode = 'idle' | 'solo' | 'online';
type Stick = { pointer: number; player: number; ox: number; oy: number; x: number; y: number };
type Hud = { phase: string; timer: number; round: number; radius: number; startRadius: number; wins: number[]; positions: { x: number; z: number; y: number; out: boolean }[] };

const MODE = defineSetting('sumo:mode', PLAY_MODES, 'cpu');
const RIVALS = defineSetting('sumo:rivals', ['1', '3', '5', '7'] as const, '3');
const LEVEL = defineSetting('sumo:level', LEVEL_NAMES, 'normal');
const rivalOptions = [
  ['1', '1 Rival'],
  ['3', '3 Rivals'],
  ['5', '5 Rivals'],
  ['7', '7 Rivals'],
] as const;
const BOT_NAMES = ['Nudge', 'Pebble', 'Biscuit', 'Tango', 'Wobble', 'Fizz', 'Rascal'] as const;
const modeOf = (mode: Mode, rivals: string) => ({ mode, rivals: Number(rivals) });
const difficulty = (level: LevelName): Level => level === 'easy' ? 0 : level === 'hard' ? 2 : 1;
const emptyInput = (): Input => ({ x: 0, y: 0, dash: false });

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={BOT_NAMES} defaultBots={3}>
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [rivals, setRivals] = useSetting(RIVALS);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />}
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [hostLevel, setHostLevel] = useState<LevelName | null>(null);
  useEffect(() => {
    if (!online?.isHost || !online.bots.length) return;
    const send = () => online.send(configOf(online.round, difficulty(level)));
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [online, level]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, data) => {
      const packet = parsePacket(data);
      if (from !== 0 || !packet) return;
      if (packet.k === 'cfg' || packet.k === 'S') {
        const levelIndex = packet.k === 'cfg' ? packet.lv : packet.lv;
        setHostLevel(levelIndex === 0 ? 'easy' : levelIndex === 2 ? 'hard' : 'normal');
      }
    });
  }, [online]);
  if (!online?.bots.length) return null;
  if (online.isHost) return <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />;
  return (
    <div className="arcade-field">
      <span>Bot Level</span>
      <div className="g-sumo-hostpick">
        <b>{hostLevel ? hostLevel[0].toUpperCase() + hostLevel.slice(1) : 'Waiting for Host'}</b>
        <small>picked by the host</small>
      </div>
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const stage = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') stage.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== stage.current.key) stage.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={stage.current.key} mode={stage.current.mode} />;
}

function rosterFor(online: NonNullable<ReturnType<typeof useOnline>>, level: Level): CarConfig[] {
  const bySeat = new Map<number, { name: string; bot: boolean }>();
  for (const player of online.players) bySeat.set(player.seat, { name: player.name, bot: false });
  for (const bot of online.bots) bySeat.set(bot.seat, { name: bot.name, bot: true });
  return [...bySeat.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 8)
    .map(([seat, entry], color) => ({ seat, color, ai: entry.bot ? level : null, name: entry.name }));
}

function makeWorld(mode: StageMode, playMode: Mode, rivals: string, level: Level, online: ReturnType<typeof useOnline>) {
  if (mode === 'online' && online) return createWorld(rosterFor(online, level), online.round || 1);
  if (playMode === '2p') {
    return createWorld([
      { seat: -1, color: 0, ai: null, name: 'P1' },
      { seat: -1, color: 1, ai: null, name: 'P2' },
    ]);
  }
  const { rivals: rivalCount } = modeOf(playMode, rivals);
  return createWorld([
    { seat: -1, color: 0, ai: null, name: 'You' },
    ...Array.from({ length: rivalCount }, (_, i) => ({ seat: -1, color: i + 1, ai: level, name: BOT_NAMES[i] })),
  ]);
}

const initialHud = (world: World): Hud => ({
  phase: world.phase,
  timer: world.timer,
  round: world.round,
  radius: world.radius,
  startRadius: world.startRadius,
  wins: [...world.wins],
  positions: world.cars.map((car) => ({ x: car.x, z: car.z, y: car.y, out: car.out })),
});

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [playMode] = useSetting(MODE);
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const level = difficulty(levelName);
  const shellRef = useRef(shell);
  const onlineRef = useRef(online);
  shellRef.current = shell;
  onlineRef.current = online;
  const world = useRef<World | null>(null);
  world.current ??= makeWorld(mode, playMode, rivals, level, online);
  const view = useRef<View | null>(null);
  const lastSimWall = useRef(performance.now() / 1000);
  const remoteInput = useRef(new Map<number, Input>());
  const synced = useRef(mode !== 'online' || !!online?.isHost);
  const reported = useRef(false);
  const endSends = useRef(0);
  const endPacket = useRef<object | null>(null);
  const tickCount = useRef(0);
  const dashSent = useRef<boolean | null>(null);
  const previousCount = useRef(4);
  const previousChargeStep = useRef(0);
  const hudTimer = useRef(0);
  const toastTimer = useRef(0);
  const [hud, setHud] = useState<Hud>(() => initialHud(world.current!));
  const [toast, setToast] = useState('');
  const [sticks, setSticks] = useState<Stick[]>([]);
  const stickPointers = useRef(new Map<number, Stick>());
  const dashPointers = useRef(new Map<number, number>());
  const [touchCharge, setTouchCharge] = useState([0, 0]);
  const touchTimer = useRef(0);

  const isOnline = mode === 'online' && !!online;
  const mine = () => (isOnline ? world.current?.cars.find((car) => car.seat === onlineRef.current?.seat)?.id ?? -1 : 0);
  const carName = (carId: number) => {
    const car = world.current?.cars[carId];
    if (!car) return '';
    if (mode === 'solo' && playMode === '2p') return `P${carId + 1}`;
    if (mode === 'online') return onlineRef.current?.seat === car.seat ? 'You' : car.name;
    return carId === 0 ? 'You' : car.name;
  };

  useEffect(() => {
    shell.setScore(null);
  }, [shell]);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const next = createScene(THREE, host, shell.touch);
    if (!next) return;
    view.current = next;
    next.resize(size.w, size.h);
    next.update(world.current!, 0, mine());
    shell.invalidate();
    return () => {
      next.dispose();
      view.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, THREE, shell]);

  const readKeys = (carId: number): Input => {
    const local2p = mode === 'solo' && playMode === '2p';
    const twoPlayer = local2p;
    const player = twoPlayer ? carId : 0;
    const stick = [...stickPointers.current.values()].find((item) => item.player === player);
    let x = 0;
    let y = 0;
    if (stick) {
      const dx = stick.x - stick.ox;
      const dy = stick.y - stick.oy;
      const distance = Math.hypot(dx, dy);
      const magnitude = distance < 9 ? 0 : Math.min(1, distance / 44);
      x = distance > 0 ? (dx / distance) * magnitude : 0;
      y = distance > 0 ? (dy / distance) * magnitude : 0;
    } else if (twoPlayer && player === 0) {
      x = (keys.down('KeyD') ? 1 : 0) - (keys.down('KeyA') ? 1 : 0);
      y = (keys.down('KeyS') ? 1 : 0) - (keys.down('KeyW') ? 1 : 0);
    } else if (twoPlayer) {
      x = (keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0);
      y = (keys.down('ArrowDown') ? 1 : 0) - (keys.down('ArrowUp') ? 1 : 0);
    } else {
      x = (keys.down('KeyD', 'ArrowRight') ? 1 : 0) - (keys.down('KeyA', 'ArrowLeft') ? 1 : 0);
      y = (keys.down('KeyS', 'ArrowDown') ? 1 : 0) - (keys.down('KeyW', 'ArrowUp') ? 1 : 0);
    }
    const dashPlayer = twoPlayer ? player === 0 ? keys.down('Space') : keys.down('Enter') : keys.down('Space', 'Enter');
    return { x, y, dash: dashPointers.current.has(player) || dashPlayer };
  };

  const inputsForFrame = (): Input[] => {
    const current = world.current!;
    const o = onlineRef.current;
    return current.cars.map((car) => {
      if (car.ai !== null) return think(current, car.id, car.ai);
      if (mode === 'online' && o && !o.isHost && car.seat !== o.seat) return emptyInput();
      if (mode === 'online' && o?.isHost && car.seat !== o.seat) return remoteInput.current.get(car.seat) ?? emptyInput();
      return readKeys(car.id);
    });
  };

  const finishGame = (winnerId: number, sendEnd: boolean) => {
    const current = world.current!;
    const winner = current.cars[winnerId];
    if (!winner || reported.current) return;
    const o = onlineRef.current;
    const winnerSeat = winner.seat >= 0 ? winner.seat : null;
    if (mode === 'online' && o) {
      reported.current = true;
      o.reportResult(o.round, winnerSeat);
      endPacket.current = endOf(o.round, winnerSeat, [...current.wins]);
      if (sendEnd) endSends.current = 0;
      const title = winnerSeat === o.seat ? 'You Win' : `${winner.name} Wins`;
      shellRef.current.gameOver(undefined, { title, detail: `${current.wins.join(' to ')} in ${current.round} rounds` });
      return;
    }
    reported.current = true;
    const twoPlayer = mode === 'solo' && playMode === '2p';
    const title = twoPlayer ? `P${winnerId + 1} Wins` : winnerId === 0 ? 'You Win' : 'Splashed Out';
    shellRef.current.gameOver(undefined, { title, detail: `${current.wins.join(' to ')} in ${current.round} rounds` });
  };

  const eventsFrom = (events: ReturnType<typeof step>) => {
    const currentView = view.current;
    for (const event of events) {
      if (event.type === 'hit') {
        currentView?.hit(event.power);
        sfx.tone({ freq: 140, to: 72, dur: 0.1, type: 'triangle', vol: Math.min(0.28, 0.045 + event.power * 0.012) });
      } else if (event.type === 'dash') {
        sfx.tone({ freq: 420, to: 135, dur: 0.16, type: 'sawtooth', vol: 0.16 });
      } else if (event.type === 'splash') {
        currentView?.splash(event.x, event.z);
        sfx.noise(0.3, 0.18);
      } else if (event.type === 'bump') {
        sfx.play('tick');
      } else if (event.type === 'round') {
        if (event.winner === mine()) sfx.play('coin');
        else sfx.play(event.winner === null ? 'select' : 'lose');
      }
    }
  };

  const updateWorld = (dt: number) => {
    const current = world.current;
    if (!current || shellRef.current.status !== 'playing') return;
    const o = onlineRef.current;
    if (mode === 'online' && o?.isHost) {
      const departed = takeoverDeparted(current, o.players.map((player) => player.seat), level);
      if (departed.length) {
        const name = current.cars.find((car) => car.seat === departed[0])?.name ?? 'Player';
        setToast(`${name} left, a bot took over`);
        toastTimer.current = 3;
      }
    }
    const events = step(current, inputsForFrame(), dt);
    eventsFrom(events);
    if (toastTimer.current > 0) {
      toastTimer.current -= dt;
      if (toastTimer.current <= 0) setToast('');
    }
    if (current.phase === 'count') {
      const count = Math.ceil(current.timer);
      if (count > previousCount.current) previousCount.current = 4;
      if (count < previousCount.current && count > 0) sfx.play('tick');
      previousCount.current = count;
    }
    const myCar = current.cars[mine()];
    if (myCar?.charge > 0) {
      const chargeStep = Math.floor(myCar.charge * 4);
      if (chargeStep > previousChargeStep.current) sfx.tone({ freq: 330 + myCar.charge * 300, to: 500 + myCar.charge * 200, dur: 0.045, type: 'sine', vol: 0.07 });
      previousChargeStep.current = chargeStep;
    } else previousChargeStep.current = 0;
    if (current.phase === 'done') {
      const winnerId = matchWinner(current);
      if (winnerId !== null) finishGame(winnerId, true);
    }
    view.current?.update(current, dt, mine());
    hudTimer.current += dt;
    if (hudTimer.current >= 0.09) {
      hudTimer.current = 0;
      setHud(initialHud(current));
      const charges = [current.cars[0]?.charge ?? 0, current.cars[1]?.charge ?? 0];
      touchTimer.current += dt;
      if (touchTimer.current > 0.08) {
        touchTimer.current = 0;
        setTouchCharge(charges);
      }
    }
    lastSimWall.current = performance.now() / 1000;
  };

  const render = () => view.current?.render();
  useGameLoop(updateWorld, render);

  useEffect(() => {
    if (!isOnline || !online) return;
    const off = online.onMessage((from, data) => {
      const o = onlineRef.current;
      if (!o || from === o.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== o.round) return;
      const current = world.current!;
      if (packet.k === 'i' && o.isHost) {
        const car = current.cars.find((candidate) => candidate.seat === from);
        if (car && car.ai === null) remoteInput.current.set(from, { x: packet.x, y: packet.y, dash: packet.d });
        return;
      }
      if (packet.k === 'S' && !o.isHost && from === 0) {
        if (!synced.current) {
          if (!packet.roster.includes(o.seat)) return;
          current.cars = packet.roster.map((seat, index) => {
            const player = o.players.find((candidate) => candidate.seat === seat);
            const bot = o.bots.find((candidate) => candidate.seat === seat);
            return { seat, color: index, ai: bot ? packet.lv : null, name: player?.name ?? bot?.name ?? `Player ${seat + 1}` };
          }).map((entry, id) => ({ ...createWorld([entry]).cars[0], id }));
          current.wins = [...packet.wins];
          synced.current = true;
        }
        current.round = packet.rn;
        current.wins = [...packet.wins];
        current.phase = packet.ph;
        current.radius = packet.rad;
        if (packet.ph === 'count' || packet.ph === 'over') current.timer = packet.tm;
        else current.fightTime = packet.tm;
        for (let i = 0; i < packet.cars.length; i++) {
          const packed = packet.cars[i];
          const car = current.cars[i];
          if (!car) continue;
          const mineNow = car.seat === o.seat;
          if (mineNow) {
            const error = Math.hypot(car.x - packed.x, car.z - packed.z);
            if (error > 1.5) {
              car.x = packed.x;
              car.z = packed.z;
              car.vx = packed.vx;
              car.vz = packed.vz;
            } else {
              car.x += (packed.x - car.x) * 0.35;
              car.z += (packed.z - car.z) * 0.35;
              car.vx += (packed.vx - car.vx) * 0.35;
              car.vz += (packed.vz - car.vz) * 0.35;
            }
          } else {
            car.x = packed.x;
            car.z = packed.z;
            car.vx = packed.vx;
            car.vz = packed.vz;
          }
          car.y = packed.y;
          car.yaw = packed.yaw;
          car.charge = packed.charge;
          car.falling = !!(packed.flags & 2);
          car.out = !!(packed.flags & 4);
          car.dashT = packed.flags & 8 ? 0.2 : 0;
          if (packed.flags & 16) car.ai = packet.lv;
        }
        return;
      }
      if (packet.k === 'end' && !o.isHost && from === 0 && !reported.current) {
        current.wins = [...packet.wins];
        const winnerId = current.wins.findIndex((wins) => wins >= TARGET);
        if (winnerId < 0) return;
        finishGame(winnerId, false);
      }
    });

    const timer = window.setInterval(() => {
      const o = onlineRef.current;
      const current = world.current;
      if (!o || !current) return;
      if (shellRef.current.status === 'playing') {
        const now = performance.now() / 1000;
        let catchup = now - lastSimWall.current;
        if (catchup > 0.08) {
          while (catchup > 0.001) {
            const part = Math.min(0.25, catchup);
            updateWorld(part);
            catchup -= part;
          }
          lastSimWall.current = now;
        }
        tickCount.current++;
        if (!o.isHost) {
          const id = current.cars.findIndex((car) => car.seat === o.seat);
          if (id >= 0) {
            const input = readKeys(id);
            const packet = inputOf(o.round, input);
            o.send(packet, { fast: true });
            if (dashSent.current !== input.dash) {
              dashSent.current = input.dash;
              o.send(packet, { fast: false });
            }
          }
        } else {
          const cars: PackedCar[] = current.cars.map((car) => ({
            x: car.x,
            z: car.z,
            y: car.y,
            vx: car.vx,
            vz: car.vz,
            yaw: car.yaw,
            charge: car.charge,
            flags: (car.out ? 4 : 1) | (car.falling ? 2 : 0) | (car.dashT > 0 ? 8 : 0) | (car.ai !== null ? 16 : 0),
          }));
          const tm = current.phase === 'count' || current.phase === 'over' ? current.timer : current.fightTime;
          o.send(hostState(o.round, current.phase, tm, current.radius, current.round, current.wins, current.cars.map((car) => car.seat), level, cars), { fast: tickCount.current % 5 !== 0 });
        }
      }
      if (o.isHost && endPacket.current && endSends.current < 4) {
        o.send(endPacket.current, { fast: false });
        endSends.current++;
      }
    }, 50);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [isOnline]);

  const clearPointers = () => {
    stickPointers.current.clear();
    dashPointers.current.clear();
    setSticks([]);
    setTouchCharge([0, 0]);
  };
  useEffect(() => {
    if (shell.status !== 'playing') clearPointers();
    const blur = () => clearPointers();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      clearPointers();
    };
  }, [shell.status]);

  const playerAt = (e: RPointerEvent<HTMLDivElement>) => {
    if (mode === 'solo' && playMode === '2p') {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientX > rect.left + rect.width / 2 ? 1 : 0;
    }
    return 0;
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!shell.touch || shell.status !== 'playing' || e.button !== 0 || (e.target as HTMLElement).closest('.g-sumo-dash')) return;
    e.preventDefault();
    const player = playerAt(e);
    const stick = { pointer: e.pointerId, player, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    stickPointers.current.set(e.pointerId, stick);
    setSticks([...stickPointers.current.values()]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const stick = stickPointers.current.get(e.pointerId);
    if (!stick) return;
    const dx = e.clientX - stick.ox;
    const dy = e.clientY - stick.oy;
    const length = Math.hypot(dx, dy);
    const scale = length > 44 ? 44 / length : 1;
    stick.x = stick.ox + dx * scale;
    stick.y = stick.oy + dy * scale;
    setSticks([...stickPointers.current.values()]);
  };
  const endPointer = (e: RPointerEvent<HTMLDivElement>) => {
    if (stickPointers.current.delete(e.pointerId)) setSticks([...stickPointers.current.values()]);
  };
  const setDash = (e: RPointerEvent<HTMLButtonElement>, active: boolean, player: number) => {
    e.stopPropagation();
    if (active) {
      e.preventDefault();
      dashPointers.current.set(e.pointerId, player);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else dashPointers.current.delete(e.pointerId);
  };
  const chargeFor = (player: number) => {
    const car = world.current?.cars[player === 1 && mode === 'solo' && playMode === '2p' ? 1 : mode === 'online' ? mine() : 0];
    return car?.charge ?? touchCharge[player] ?? 0;
  };

  const current = world.current!;
  const watched = mode === 'online' && !synced.current;
  const yourCar = current.cars[mine()];
  const hostRect = ref.current?.getBoundingClientRect();
  const centerText = hud.phase === 'count'
    ? `${Math.max(1, Math.ceil(hud.timer))}`
    : hud.phase === 'over'
      ? current.roundWinner === null ? 'draw' : `${carName(current.roundWinner)} takes the round`
      : yourCar?.falling || yourCar?.out ? "you're in the water, watch them finish" : watched ? 'watching this round' : '';

  return (
    <div
      ref={(node) => {
        ref.current = node;
      }}
      className="g-sumo-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    >
      <div className="g-sumo-hud" aria-live="polite">
        <div className="g-sumo-scores">
          {hud.wins.map((wins, i) => (
            <div className={`g-sumo-score${i === mine() ? ' is-you' : ''}`} key={i} aria-label={`${carName(i)} ${wins} wins`}>
              <i style={{ backgroundColor: CAR_COLORS[current.cars[i]?.color ?? i] }} />
              <span>{[0, 1, 2].map((pip) => <b key={pip} className={pip < wins ? 'is-won' : ''} />)}</span>
            </div>
          ))}
        </div>
        {hud.radius < hud.startRadius - 0.02 && <div className="g-sumo-warning">the float is shrinking</div>}
        {centerText && <div className="g-sumo-banner">{centerText}</div>}
      </div>

      {current.cars.map((car) => {
        const position = view.current?.project(car);
        if (!position?.visible) return null;
        return (
          <div
            className="g-sumo-tag"
            key={car.id}
            style={{ left: position.x, top: position.y, '--tag-color': CAR_COLORS[car.color] } as CSSProperties}
          >
            {carName(car.id)}
          </div>
        );
      })}

      {toast && <div className="g-sumo-toast">{toast}</div>}
      {shell.touch && shell.status === 'playing' && (
        <>
          {sticks.map((stick) => (
            <div
              className="g-sumo-stick"
              key={stick.pointer}
              style={{ left: stick.ox - (hostRect?.left ?? 0), top: stick.oy - (hostRect?.top ?? 0) }}
            >
              <i style={{ transform: `translate(${stick.x - stick.ox}px, ${stick.y - stick.oy}px)` }} />
            </div>
          ))}
          {[0, ...(mode === 'solo' && playMode === '2p' ? [1] : [])].map((player) => (
            <button
              className={`g-sumo-dash g-sumo-dash-${player ? 'right' : mode === 'solo' && playMode === '2p' ? 'left' : 'single'}`}
              key={player}
              type="button"
              aria-label="Dash"
              style={{ '--charge': `${Math.round(chargeFor(player) * 100)}%` } as CSSProperties}
              onPointerDown={(e) => setDash(e, true, player)}
              onPointerUp={(e) => setDash(e, false, player)}
              onPointerCancel={(e) => setDash(e, false, player)}
              onLostPointerCapture={(e) => setDash(e, false, player)}
            >
              <span>Dash</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
