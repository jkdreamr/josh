import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { applyTouch, buildCourse, checkpointAt, COURSE_NAMES, progressOf, respawnPoint } from './courses';
import { createBrain, resetBrain, thinkBot, type Brain } from './bots';
import { createBody, insideZone, respawn, STEP, stepBody, updateCourse } from './physics';
import { hash } from './rng';
import { BOT_NAMES, COLORS, botSkill, offlineEntrants } from './roster';
import {
  courseOf, createShow, markFall, markFinish, pickRace, playTime, placeOf, stillRunning, stepShow,
  type Show,
} from './show';
import {
  fallPacket, finishPacket, Interp, movePacket, parsePacket, playersPacket, showOf, showPacket,
  tilePacket, unpackBody, type Packet,
} from './net';
import type { Body, Course, Entrant, Input, Bump } from './types.ts';
import { EV } from './types.ts';
import { createScene, type BodyView, type CamState, type View } from './scene';
import { meta } from './meta';
import './wacky-walk.css';

const FIELD = defineSetting('wacky-walk:field', ['8', '12', '16', '20'] as const, '12');
const COURSE = defineSetting('wacky-walk:course', ['random', 'oval', 'fountain', 'palm'] as const, 'random');
const FIELD_OPTIONS = [
  ['8', '8'],
  ['12', '12'],
  ['16', '16'],
  ['20', '20'],
] as const;
const COURSE_OPTIONS = [
  ['random', 'random'],
  ['oval', 'the oval'],
  ['fountain', 'claw fountain'],
  ['palm', 'palm drive'],
] as const;

type Mode = 'idle' | 'solo' | 'online';
type Stick = { pointer: number; ox: number; oy: number; x: number; y: number };
type Drag = { kind: 'orbit' | 'stick'; pointer: number; x: number; y: number; ox: number; oy: number };
type Hud = {
  round: number;
  name: string;
  phase: string;
  phaseT: number;
  time: number;
  count: number;
  standing: number;
  quota: number;
  localQualified: boolean;
  localOut: boolean;
  playClock: number;
};

const emptyHud: Hud = {
  round: 0, name: 'the oval', phase: 'intro', phaseT: 0, time: 120, count: 0, standing: 0, quota: 0,
  localQualified: false, localOut: false, playClock: 0,
};

function seedOf(): number {
  return (Math.random() * 0x7fffffff) >>> 0;
}

function entrantsForRoom(room: NonNullable<ReturnType<typeof useOnline>>, seed: number): Entrant[] {
  const bySeat = new Map<number, Entrant>();
  for (const player of room.players) {
    if (player.seat < 0 || player.seat >= 20) continue;
    bySeat.set(player.seat, {
      id: player.seat,
      seat: player.seat,
      name: player.name,
      bot: false,
      color: COLORS[player.seat % COLORS.length],
      skill: 0.78,
    });
  }
  for (const bot of room.bots ?? []) {
    if (bot.seat < 0 || bot.seat >= 20 || bySeat.has(bot.seat)) continue;
    bySeat.set(bot.seat, {
      id: bot.seat,
      seat: bot.seat,
      name: bot.name || BOT_NAMES[bot.seat % BOT_NAMES.length],
      bot: true,
      color: COLORS[bot.seat % COLORS.length],
      skill: botSkill(seed, bot.seat),
    });
  }
  return [...bySeat.values()].sort((a, b) => a.seat - b.seat).slice(0, 20);
}

function courseTip(id: string): string {
  if (id === 'oval') return 'watch the tubes, then hop the spinning bars.';
  if (id === 'fountain') return 'jets come in waves. keep your feet on the stones.';
  if (id === 'palm') return 'coconuts roll downhill. take the checkpoints as you climb.';
  if (id === 'tiles') return 'keep moving. cracked tiles fall away in a moment.';
  return 'follow the spiral, use the pads and look up for the crown.';
}

function timeLabel(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function stateSignature(show: Show): string {
  return [
    show.round, show.phase, show.inRound.join(','), show.out.join(','), show.finished.join(','),
    show.fallen.join(','), show.qualified.join(','), show.winner ?? '', show.quota,
  ].join('|');
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell
      meta={meta}
      compact={compact}
      onExit={onExit}
      roomCode={roomCode}
      className="g-wacky-walk"
      setup={<Setup />}
      hostSetup={<HostSetup />}
      botNames={BOT_NAMES}
      defaultBots={11}
    >
      <Stage />
    </GameShell>
  );
}

function Stage() {
  const shell = useShell();
  const room = useOnline();
  const stage = useRef('idle');
  if (shell.status === 'ready') stage.current = 'idle';
  else if (shell.status === 'playing') {
    stage.current = room ? `online:${room.round}` : `solo:${shell.round}`;
  }
  return <Play key={stage.current} />;
}

function Setup() {
  const [field, setField] = useSetting(FIELD);
  const [course, setCourse] = useSetting(COURSE);
  return (
    <div className="g-wacky-walk-setup">
      <Segmented value={field} options={FIELD_OPTIONS} onChange={setField} label="field size" />
      <Segmented value={course} options={COURSE_OPTIONS} onChange={setCourse} label="course" />
    </div>
  );
}

function HostSetup() {
  const room = useOnline();
  const [course, setCourse] = useSetting(COURSE);
  if (!room?.isHost) return null;
  return (
    <div className="g-wacky-walk-setup">
      <Segmented value={course} options={COURSE_OPTIONS} onChange={setCourse} label="course" />
    </div>
  );
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const room = useOnline();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [field] = useSetting(FIELD);
  const [courseChoice] = useSetting(COURSE);
  const [hud, setHud] = useState<Hud>(emptyHud);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [stick, setStick] = useState<Stick | null>(null);
  const [watchTarget, setWatchTarget] = useState<number | null>(null);
  const showRef = useRef<Show | null>(null);
  const courseRef = useRef<Course | null>(null);
  const viewRef = useRef<View | null>(null);
  const bodiesRef = useRef(new Map<number, Body>());
  const brainsRef = useRef(new Map<number, Brain>());
  const interpRef = useRef(new Map<number, Interp>());
  const remoteClockRef = useRef(0);
  const guestClockRef = useRef(0);
  const clockErrorRef = useRef(0);
  const hiddenRef = useRef(new Set<number>());
  const checkpointRef = useRef(new Map<number, number>());
  const lastGroundRef = useRef(new Map<number, number>());
  const celebratedRef = useRef(new Set<number>());
  const finishSentRef = useRef(new Set<number>());
  const fallenSentRef = useRef(new Set<number>());
  const eliminatedSfxRef = useRef(new Set<number>());
  const seedRef = useRef(seedOf());
  const initializedRef = useRef(false);
  const accumulatorRef = useRef(0);
  const lastUpdateAtRef = useRef(0);
  const renderDtRef = useRef(0);
  const netClockRef = useRef(0);
  const hudClockRef = useRef(0);
  const cameraRef = useRef<CamState>({ yaw: 0, pitch: 0.4, dist: 9 });
  const manualOrbitAtRef = useRef(0);
  const lastCountRef = useRef(-1);
  const pendingJumpRef = useRef(false);
  const pendingDiveRef = useRef(false);
  const touchJumpRef = useRef(false);
  const touchDiveRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const stickRef = useRef<Stick | null>(null);
  const watchIndexRef = useRef(0);
  const hudRef = useRef(hud);
  const onlineRef = useRef(room);
  const shellRef = useRef(shell);
  const modeRef = useRef<Mode>('idle');
  const showSignatureRef = useRef('');
  const resultStartedRef = useRef(false);
  const reportedRef = useRef(false);
  const doneHandledRef = useRef(false);
  const offlineCardRef = useRef(false);
  const winTimeRef = useRef(0);
  const winConfettiRef = useRef(0);
  const tagNodesRef = useRef(new Map<number, HTMLDivElement>());
  const latestPacketHandlerRef = useRef<(from: number, value: unknown) => void>(() => {});
  const portraitPhone = shell.touch && size.h > size.w;
  const mode: Mode = shell.status === 'playing' || (shell.status === 'over' && room) ? (room ? 'online' : 'solo') : 'idle';
  modeRef.current = mode;
  onlineRef.current = room;
  shellRef.current = shell;
  hudRef.current = hud;

  function localId(show = showRef.current): number | null {
    if (modeRef.current === 'solo') return 0;
    const currentRoom = onlineRef.current;
    if (!currentRoom || currentRoom.watching || currentRoom.seat == null || !show) return null;
    return show.entrants.some((entrant) => entrant.id === currentRoom.seat) ? currentRoom.seat : null;
  }

  function syncSceneCourse(course: Course) {
    viewRef.current?.setCourse(course);
    if (showRef.current) {
      viewRef.current?.setPlayers(showRef.current.entrants.map((entrant) => ({ id: entrant.id, color: entrant.color })));
    }
  }

  function resetRound(show: Show) {
    const course = buildCourse(courseOf(show), hash(show.seed, show.round));
    courseRef.current = course;
    updateCourse(course, 0);
    bodiesRef.current.clear();
    brainsRef.current.clear();
    interpRef.current.clear();
    hiddenRef.current.clear();
    checkpointRef.current.clear();
    lastGroundRef.current.clear();
    celebratedRef.current.clear();
    finishSentRef.current.clear();
    fallenSentRef.current.clear();
    eliminatedSfxRef.current.clear();
    for (let slot = 0; slot < show.inRound.length; slot++) {
      const id = show.inRound[slot];
      const entrant = show.entrants.find((item) => item.id === id);
      const spawn = course.spawns[slot] ?? course.spawns[0] ?? { x: 0, y: 0, z: 0 };
      bodiesRef.current.set(id, createBody(spawn.x, spawn.y, spawn.z, course.startYaw));
      checkpointRef.current.set(id, 0);
      lastGroundRef.current.set(id, -1);
      if (entrant?.bot) {
        const brain = createBrain(id, entrant.skill, hash(show.seed, show.round, id));
        resetBrain(brain, course);
        brainsRef.current.set(id, brain);
      }
    }
    guestClockRef.current = show.clock;
    remoteClockRef.current = show.clock;
    clockErrorRef.current = 0;
    cameraRef.current.yaw = course.startYaw;
    cameraRef.current.pitch = 0.4;
    cameraRef.current.dist = portraitPhone ? 10.5 : 9;
    watchIndexRef.current = 0;
    setWatchTarget(null);
    syncSceneCourse(course);
  }

  if (!initializedRef.current && (mode === 'solo' || (mode === 'online' && room?.isHost))) {
    const seed = seedRef.current;
    const entrants = mode === 'solo'
      ? offlineEntrants(Number(field), seed)
      : room ? entrantsForRoom(room, seed) : [];
    if (entrants.length) {
      const show = createShow(entrants, seed, pickRace(seed, courseChoice));
      showRef.current = show;
      resetRound(show);
      initializedRef.current = true;
    }
  }

  function currentCourseClock(show: Show): number {
    return modeRef.current === 'online' && !onlineRef.current?.isHost ? guestClockRef.current : show.clock;
  }

  function entrant(id: number, show = showRef.current): Entrant | undefined {
    return show?.entrants.find((item) => item.id === id);
  }

  function getInterp(id: number): Interp {
    let interp = interpRef.current.get(id);
    if (!interp) {
      interp = new Interp();
      interpRef.current.set(id, interp);
    }
    return interp;
  }

  function sampleRemote(id: number, time: number): Body | undefined {
    const body = bodiesRef.current.get(id);
    if (!body) return undefined;
    getInterp(id).sample(time - 0.12, body);
    return body;
  }

  function isLocallyStepped(id: number): boolean {
    const who = entrant(id);
    if (!who) return false;
    if (modeRef.current === 'solo') return true;
    const currentRoom = onlineRef.current;
    if (!currentRoom) return false;
    if (currentRoom.isHost) return !!who.bot || id === currentRoom.seat;
    return id === currentRoom.seat;
  }

  function bumpsFor(id: number, time: number): Bump[] {
    const show = showRef.current;
    if (!show) return [];
    const bumps: Bump[] = [];
    for (const otherId of show.inRound) {
      if (otherId === id || hiddenRef.current.has(otherId)) continue;
      let body = bodiesRef.current.get(otherId);
      if (!body) continue;
      if (!isLocallyStepped(otherId)) body = sampleRemote(otherId, time) ?? body;
      bumps.push({ x: body.x, y: body.y, z: body.z, vx: body.vx, vz: body.vz });
    }
    return bumps;
  }

  function sendReliable(packet: unknown) {
    const currentRoom = onlineRef.current;
    if (currentRoom) currentRoom.send(packet);
  }

  function sendShow(force = false) {
    const show = showRef.current;
    const course = courseRef.current;
    const currentRoom = onlineRef.current;
    if (!show || !course || !currentRoom?.isHost) return;
    const signature = stateSignature(show);
    if (!force && signature === showSignatureRef.current) return;
    showSignatureRef.current = signature;
    sendReliable(showPacket(currentRoom.round, show, course.colliders));
  }

  function activateConfetti(id: number, count = 80) {
    if (celebratedRef.current.has(id)) return;
    celebratedRef.current.add(id);
    const body = bodiesRef.current.get(id);
    if (body) viewRef.current?.confetti(body.x, body.y + 1, body.z, count);
  }

  function gameOverInfo(show: Show, mine: number | null) {
    const winner = show.winner == null ? undefined : entrant(show.winner, show);
    if (mine != null && show.winner === mine) {
      return { title: 'you won the show!', detail: 'the crown is yours. what a walk.' };
    }
    const place = mine == null ? null : placeOf(show, mine);
    const title = winner ? `${winner.name} won the show` : 'the show is over';
    const detail = place ? `you placed ${place}. thanks for taking the walk.` : 'thanks for taking the walk.';
    return { title, detail };
  }

  function finishShow(show: Show) {
    if (show.phase !== 'done' || doneHandledRef.current) return;
    const currentRoom = onlineRef.current;
    const mine = localId(show);
    const info = gameOverInfo(show, mine);
    if (modeRef.current === 'online' && currentRoom) {
      if (currentRoom.isHost && !reportedRef.current) {
        reportedRef.current = true;
        const winnerSeat = show.winner == null ? null : entrant(show.winner, show)?.seat ?? null;
        currentRoom.reportResult(currentRoom.round, winnerSeat);
      }
      doneHandledRef.current = true;
      if (!resultStartedRef.current) {
        resultStartedRef.current = true;
        shellRef.current.gameOver(undefined, info);
      } else {
        shellRef.current.updateOver(info);
      }
      return;
    }
    doneHandledRef.current = true;
    if (show.winner === mine) {
      if (!resultStartedRef.current) {
        resultStartedRef.current = true;
        winTimeRef.current = 0;
        winConfettiRef.current = 0;
      }
    } else {
      resultStartedRef.current = true;
      shellRef.current.gameOver(undefined, info);
    }
  }

  function receiveShow(packet: Extract<Packet, { k: 'S' }>) {
    const incoming = showOf(packet);
    const before = showRef.current;
    const changedRound = !before || before.round !== incoming.round;
    const oldFinished = new Set(before?.finished ?? []);
    const oldQualified = new Set(before?.qualified ?? []);
    if (changedRound) {
      showRef.current = incoming;
      resetRound(incoming);
    } else if (before) {
      before.phase = incoming.phase;
      before.phaseT = incoming.phaseT;
      before.clock = incoming.clock;
      before.inRound = incoming.inRound;
      before.out = incoming.out;
      before.finished = incoming.finished;
      before.fallen = incoming.fallen;
      before.qualified = incoming.qualified;
      before.quota = incoming.quota;
      before.winner = incoming.winner;
    }
    const show = showRef.current;
    const course = courseRef.current;
    if (!show || !course) return;
    remoteClockRef.current = packet.c;
    const error = packet.c - guestClockRef.current;
    if (Math.abs(error) > 0.5) {
      guestClockRef.current = packet.c;
      clockErrorRef.current = 0;
    } else clockErrorRef.current = error;
    for (const [id, touchedAt] of packet.tiles) {
      if (touchedAt !== null) applyTouch(course, id, touchedAt);
    }
    for (const id of show.finished) if (!oldFinished.has(id)) activateConfetti(id, 75);
    for (const id of show.qualified) if (!oldQualified.has(id)) activateConfetti(id, 90);
    const mine = localId(show);
    const nowOut = mine != null && (show.out.includes(mine) || show.fallen.includes(mine));
    if (modeRef.current === 'online' && nowOut && !resultStartedRef.current && show.phase !== 'done') {
      resultStartedRef.current = true;
      eliminatedSfxRef.current.add(mine);
      sfx.play('lose');
      shellRef.current.gameOver(undefined, {
        title: 'eliminated',
        detail: `out in round ${show.round + 1}`,
        wait: 'watch the rest of the show',
      });
    }
    if (show.phase === 'done') finishShow(show);
  }

  function handlePacket(from: number, value: unknown) {
    const currentRoom = onlineRef.current;
    const show = showRef.current;
    if (!currentRoom) return;
    const packet = parsePacket(value);
    if (!packet || packet.r !== currentRoom.round) return;
    if (currentRoom.isHost) {
      if (!show || from === currentRoom.seat || packet.k === 'S' || packet.k === 'P') return;
      if (packet.rd !== show.round || !show.inRound.includes(from)) return;
      if (packet.k === 'm') {
        const who = entrant(from, show);
        if (!who || who.bot) return;
        getInterp(from).push(show.clock, unpackBody(packet.b));
        remoteClockRef.current = show.clock;
      } else if (packet.k === 'fin') {
        if (markFinish(show, from)) {
          activateConfetti(from, 80);
          sfx.play('coin');
          sendShow(true);
        }
      } else if (packet.k === 'fall') {
        if (markFall(show, from)) {
          hiddenRef.current.add(from);
          viewRef.current?.splash(bodiesRef.current.get(from)?.x ?? 0, 0, bodiesRef.current.get(from)?.z ?? 0);
          sfx.play('lose');
          sendShow(true);
        }
      } else if (packet.k === 'tile') {
        const tile = courseRef.current?.colliders[packet.id];
        if (tile?.tile && tile.tile.touchedAt === null && applyTouch(courseRef.current!, packet.id, packet.at)) {
          sendReliable(tilePacket(currentRoom.round, show.round, packet.id, packet.at));
          sendShow(true);
        }
      }
      return;
    }
    if (from !== 0) return;
    if (packet.k === 'S') {
      receiveShow(packet);
    } else if (!show) {
      return;
    } else if (packet.k === 'P') {
      remoteClockRef.current = packet.c;
      clockErrorRef.current = packet.c - guestClockRef.current;
      for (const row of packet.b) {
        const id = row[0];
        if (id === currentRoom.seat) continue;
        getInterp(id).push(packet.c, unpackBody(row.slice(1)));
      }
    } else if (packet.k === 'tile') {
      const course = courseRef.current;
      if (course) applyTouch(course, packet.id, packet.at);
    }
  }
  latestPacketHandlerRef.current = handlePacket;

  useEffect(() => {
    if (!THREE || !ref.current) return;
    const view = createScene(THREE, ref.current, shell.touch);
    if (!view) return;
    viewRef.current = view;
    view.resize(size.w, size.h);
    if (courseRef.current) syncSceneCourse(courseRef.current);
    shell.invalidate();
    return () => {
      view.dispose();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    viewRef.current?.resize(size.w, size.h);
  }, [size.w, size.h]);

  useEffect(() => {
    if (mode !== 'online' || !room) return;
    const unsubscribe = room.onMessage((from, packet) => latestPacketHandlerRef.current(from, packet));
    if (room.isHost) sendShow(true);
    const heartbeat = window.setInterval(() => {
      if (onlineRef.current?.isHost) sendShow(true);
    }, 2000);
    return () => {
      unsubscribe();
      window.clearInterval(heartbeat);
    };
  }, [mode, room]);

  useEffect(() => {
    const clear = () => {
      dragRef.current = null;
      stickRef.current = null;
      setStick(null);
      pendingJumpRef.current = false;
      pendingDiveRef.current = false;
      touchJumpRef.current = false;
      touchDiveRef.current = false;
    };
    if (shell.status !== 'playing') clear();
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [shell.status]);

  function watchedIds(show: Show): number[] {
    const alive = show.inRound.filter((id) =>
      !hiddenRef.current.has(id) && !show.fallen.includes(id) && !show.out.includes(id) && !show.finished.includes(id),
    );
    if (alive.length) return alive;
    return show.inRound.filter((id) => !hiddenRef.current.has(id) && !show.out.includes(id));
  }

  function cycleWatch(direction: number) {
    const show = showRef.current;
    if (!show) return;
    const ids = watchedIds(show);
    if (!ids.length) return;
    const current = watchTarget == null ? watchIndexRef.current : ids.indexOf(watchTarget);
    const next = (Math.max(0, current) + direction + ids.length) % ids.length;
    watchIndexRef.current = next;
    setWatchTarget(ids[next]);
  }

  function inputFor(active: boolean): Input {
    const currentRoom = onlineRef.current;
    const watching = !!currentRoom?.watching || localId() == null || !active;
    if (watching) {
      keys.pressed('Space', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyC');
      pendingJumpRef.current = false;
      pendingDiveRef.current = false;
      return { mx: 0, mz: 0, jump: false, dive: false };
    }

    const jumpPressed = keys.pressed('Space') || touchJumpRef.current;
    const divePressed = keys.pressed('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyC') || touchDiveRef.current;
    touchJumpRef.current = false;
    touchDiveRef.current = false;
    pendingJumpRef.current ||= jumpPressed;
    pendingDiveRef.current ||= divePressed;
    const forward = (keys.down('KeyW') || keys.down('ArrowUp') ? 1 : 0) - (keys.down('KeyS') || keys.down('ArrowDown') ? 1 : 0);
    const right = (keys.down('KeyD') || keys.down('ArrowRight') ? 1 : 0) - (keys.down('KeyA') || keys.down('ArrowLeft') ? 1 : 0);
    let localX = right, localZ = forward;
    const currentStick = stickRef.current;
    if (currentStick && shell.touch) {
      localX = (currentStick.x - currentStick.ox) / 48;
      localZ = (currentStick.oy - currentStick.y) / 48;
      const mag = Math.hypot(localX, localZ);
      if (mag > 1) {
        localX /= mag;
        localZ /= mag;
      }
    }
    const cam = cameraRef.current;
    const cos = Math.cos(cam.yaw), sin = Math.sin(cam.yaw);
    const mx = localX * cos + localZ * sin;
    const mz = -localX * sin + localZ * cos;
    const jump = pendingJumpRef.current;
    const dive = pendingDiveRef.current;
    pendingJumpRef.current = false;
    pendingDiveRef.current = false;
    return { mx, mz, jump, dive };
  }

  function handleBodyEvents(id: number, body: Body) {
    if (id !== localId()) return;
    if (body.ev & EV.JUMP) sfx.play('jump');
    if (body.ev & EV.LAND) sfx.play('tick', 0.75);
    if (body.ev & EV.DIVE) sfx.play('jump', 0.65);
    if (body.ev & EV.HIT) sfx.play('hit');
    if (body.ev & EV.BIG_HIT) sfx.play('boom');
    if (body.ev & EV.SPRING) sfx.play('coin', 0.75);
    if (body.ev & EV.SPLASH) sfx.noise(0.12, 0.1);
  }

  function markRunnerFinish(show: Show, id: number, body: Body, remote = false) {
    const course = courseRef.current;
    if (!course || show.phase !== 'play' || show.round === 1) return;
    const target = course.zones.find((zone) => zone.kind === (show.round === 2 ? 'crown' : 'finish'));
    if (!target || !insideZone(target, body.x, body.y + 0.7, body.z)) return;
    const currentRoom = onlineRef.current;
    if (modeRef.current === 'online' && currentRoom && !currentRoom.isHost) {
      if (id === currentRoom.seat && !finishSentRef.current.has(id)) {
        finishSentRef.current.add(id);
        sendReliable(finishPacket(currentRoom.round, show.round));
        activateConfetti(id, 80);
        sfx.play('coin');
      }
      return;
    }
    if (!remote && markFinish(show, id)) {
      activateConfetti(id, show.round === 2 ? 180 : 80);
      if (id === localId()) sfx.play('coin');
      if (modeRef.current === 'online' && currentRoom?.isHost) sendShow(true);
    }
  }

  function markRunnerFall(show: Show, id: number, body: Body) {
    const course = courseRef.current;
    if (!course || body.y >= course.killY || show.phase !== 'play') return;
    const currentRoom = onlineRef.current;
    if (show.round === 1) {
      if (modeRef.current === 'online' && currentRoom && !currentRoom.isHost && id === currentRoom.seat) {
        if (!fallenSentRef.current.has(id)) {
          fallenSentRef.current.add(id);
          sendReliable(fallPacket(currentRoom.round, show.round));
          hiddenRef.current.add(id);
          viewRef.current?.splash(body.x, body.y, body.z);
          sfx.play('lose');
        }
      } else if (markFall(show, id)) {
        hiddenRef.current.add(id);
        viewRef.current?.splash(body.x, body.y, body.z);
        if (id === localId()) sfx.play('lose');
        if (modeRef.current === 'online' && currentRoom?.isHost) sendShow(true);
      }
      return;
    }
    const slot = Math.max(0, show.inRound.indexOf(id));
    const checkpoint = checkpointRef.current.get(id) ?? 0;
    const point = respawnPoint(course, checkpoint, slot);
    respawn(body, point, course.startYaw);
    lastGroundRef.current.set(id, -1);
  }

  function registerTile(show: Show, id: number, body: Body) {
    const course = courseRef.current;
    if (!course || show.round !== 1 || body.ground < 0 || lastGroundRef.current.get(id) === body.ground) return;
    lastGroundRef.current.set(id, body.ground);
    const tile = course.colliders[body.ground];
    if (!tile?.tile || tile.tile.touchedAt !== null) return;
    const currentRoom = onlineRef.current;
    const touchedAt = currentCourseClock(show);
    if (modeRef.current === 'online' && currentRoom && !currentRoom.isHost) {
      if (id !== currentRoom.seat) return;
      applyTouch(course, tile.id, touchedAt);
      sendReliable(tilePacket(currentRoom.round, show.round, tile.id, touchedAt));
      return;
    }
    if (applyTouch(course, tile.id, touchedAt) && modeRef.current === 'online' && currentRoom?.isHost) {
      sendReliable(tilePacket(currentRoom.round, show.round, tile.id, touchedAt));
    }
  }

  function reportLocalElimination(show: Show) {
    const mine = localId(show);
    if (mine == null) return;
    const eliminated = show.fallen.includes(mine) || show.out.includes(mine);
    if (!eliminated) return;
    if (modeRef.current === 'online' && !resultStartedRef.current && show.phase !== 'done') {
      resultStartedRef.current = true;
      shellRef.current.gameOver(undefined, {
        title: 'eliminated',
        detail: `out in round ${show.round + 1}`,
        wait: 'watch the rest of the show',
      });
    }
  }

  function advanceOneStep() {
    const show = showRef.current;
    const course = courseRef.current;
    if (!show || !course) return;
    const currentRoom = onlineRef.current;
    const authoritative = modeRef.current === 'solo' || !!currentRoom?.isHost;
    const time = authoritative ? show.clock : guestClockRef.current;
    updateCourse(course, time);
    for (const id of show.inRound) {
      if (hiddenRef.current.has(id)) continue;
      let body = bodiesRef.current.get(id);
      if (!body) continue;
      const who = entrant(id, show);
      if (!isLocallyStepped(id)) {
        sampleRemote(id, time);
        continue;
      }
      if (!authoritative && id !== currentRoom?.seat) continue;
      if (show.phase !== 'play' || show.finished.includes(id) || show.fallen.includes(id)) continue;
      const isBot = !!who?.bot;
      const localActive = id === localId(show) && shellRef.current.status === 'playing';
      const input = isBot
        ? thinkBot(brainsRef.current.get(id)!, body, course, time, STEP)
        : inputFor(localActive);
      const others = bumpsFor(id, time);
      stepBody(body, input, course, time, STEP, others);
      handleBodyEvents(id, body);
      const checkpoint = checkpointAt(course, body.x, body.y, body.z);
      if (checkpoint >= 0) checkpointRef.current.set(id, Math.max(checkpointRef.current.get(id) ?? 0, checkpoint));
      registerTile(show, id, body);
      markRunnerFinish(show, id, body);
      markRunnerFall(show, id, body);
    }
    if (modeRef.current === 'online' && currentRoom && !currentRoom.isHost) {
      guestClockRef.current += STEP;
      const error = remoteClockRef.current - guestClockRef.current;
      if (Math.abs(error) > 0.5) guestClockRef.current = remoteClockRef.current;
      else guestClockRef.current += error * STEP * 0.1;
      show.phaseT += STEP;
      show.clock = guestClockRef.current;
      return;
    }
    const previousRound = show.round;
    const previousPhase = show.phase;
    const changed = stepShow(show, STEP, (id) => {
      const body = bodiesRef.current.get(id);
      return body ? progressOf(course, body.x, body.y, body.z) : 0;
    });
    if (show.round !== previousRound) {
      resetRound(show);
      showSignatureRef.current = '';
      sendShow(true);
    } else if (changed || previousPhase !== show.phase) {
      if (show.phase === 'count') lastCountRef.current = -1;
      if (show.phase === 'outro') {
        for (const id of show.qualified) activateConfetti(id, 90);
        sfx.play('win');
      }
      sendShow(true);
    }
    reportLocalElimination(show);
    if (show.phase === 'done') {
      if (authoritative) sendShow(true);
      finishShow(show);
    }
  }

  function update(dt: number) {
    const show = showRef.current;
    const course = courseRef.current;
    const currentRoom = onlineRef.current;
    if (!show || !course) return;
    const now = performance.now();
    const elapsed = lastUpdateAtRef.current ? (now - lastUpdateAtRef.current) / 1000 : dt;
    lastUpdateAtRef.current = now;
    dt = Math.max(0, Math.min(0.25, elapsed));
    renderDtRef.current = dt;
    const currentId = localId(show);
    const local = currentId == null ? undefined : bodiesRef.current.get(currentId);
    const following = local && !show.finished.includes(currentId!)
      ? local
      : watchTarget == null ? undefined : bodiesRef.current.get(watchTarget);
    if (shell.status === 'playing') {
      const orbit = (keys.down('KeyE') ? 1 : 0) - (keys.down('KeyQ') ? 1 : 0);
      if (orbit) {
        cameraRef.current.yaw += orbit * dt * 1.55;
        manualOrbitAtRef.current = performance.now() / 1000;
      }
      if (following && Math.hypot(following.vx, following.vz) > 2 && performance.now() / 1000 - manualOrbitAtRef.current > 1.2) {
        const target = Math.atan2(following.vx, following.vz);
        let delta = ((target - cameraRef.current.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        cameraRef.current.yaw += delta * (1 - Math.exp(-2.4 * dt));
      }
    }
    if (show.phase !== 'play') {
      pendingJumpRef.current = false;
      pendingDiveRef.current = false;
      touchJumpRef.current = false;
      touchDiveRef.current = false;
      keys.pressed('Space');
      keys.pressed('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyC');
    }
    const spectating = !!currentRoom?.watching || currentId == null || show.finished.includes(currentId) || show.fallen.includes(currentId) || show.out.includes(currentId);
    if (spectating) {
      if (keys.pressed('ArrowLeft')) cycleWatch(-1);
      if (keys.pressed('ArrowRight')) cycleWatch(1);
    }
    cameraRef.current.pitch = Math.max(0.05, Math.min(1.1, cameraRef.current.pitch));
    cameraRef.current.dist = portraitPhone ? 10.5 : 9;

    if (mode === 'online' && currentRoom && !currentRoom.isHost) {
      const jumpPressed = keys.pressed('Space') || touchJumpRef.current;
      const divePressed = keys.pressed('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyC') || touchDiveRef.current;
      if (local && show.phase === 'play' && shell.status === 'playing' && currentId != null) {
        pendingJumpRef.current ||= jumpPressed;
        pendingDiveRef.current ||= divePressed;
      }
      touchJumpRef.current = false;
      touchDiveRef.current = false;
    }

    accumulatorRef.current += dt;
    let steps = 0;
    while (accumulatorRef.current >= STEP && steps < 15) {
      advanceOneStep();
      accumulatorRef.current -= STEP;
      steps++;
    }

    const activeShow = showRef.current;
    const activeCourse = courseRef.current;
    if (!activeShow || !activeCourse) return;
    const localNow = localId(activeShow);
    const playerBody = localNow == null ? undefined : bodiesRef.current.get(localNow);
    if (playerBody && activeShow.phase === 'count') {
      const count = Math.ceil(3 - activeShow.phaseT);
      if (count >= 1 && count !== lastCountRef.current) {
        lastCountRef.current = count;
        sfx.play('tick', 0.8 + count * 0.08);
      }
    } else if (lastCountRef.current !== -1) lastCountRef.current = -1;

    if (mode === 'online' && currentRoom && !currentRoom.isHost && playerBody && shell.status === 'playing') {
      netClockRef.current += dt;
      if (netClockRef.current >= 1 / 12) {
        netClockRef.current %= 1 / 12;
        currentRoom.send(movePacket(currentRoom.round, activeShow.round, playerBody), { fast: true });
      }
    } else if (mode === 'online' && currentRoom?.isHost) {
      netClockRef.current += dt;
      if (netClockRef.current >= 1 / 12) {
        netClockRef.current %= 1 / 12;
        const states: { id: number; body: Body }[] = [];
        for (const id of activeShow.inRound) {
          if (hiddenRef.current.has(id)) continue;
          const body = bodiesRef.current.get(id);
          if (!body) continue;
          if (!isLocallyStepped(id)) sampleRemote(id, activeShow.clock);
          states.push({ id, body });
        }
        currentRoom.send(playersPacket(currentRoom.round, activeShow.round, activeShow.clock, states), { fast: true });
      }
    }

    if (mode === 'solo' && activeShow.phase === 'done' && activeShow.winner === localNow) {
      winTimeRef.current += dt;
      winConfettiRef.current += dt;
      if (winConfettiRef.current >= 0.16) {
        winConfettiRef.current = 0;
        const winner = activeShow.winner == null ? undefined : bodiesRef.current.get(activeShow.winner);
        if (winner) viewRef.current?.confetti(winner.x, winner.y + 1.3, winner.z, 24);
      }
      if (winTimeRef.current >= 3) {
        if (!offlineCardRef.current) {
          offlineCardRef.current = true;
          shellRef.current.gameOver(undefined, gameOverInfo(activeShow, localNow));
        }
      }
    }
    hudClockRef.current += dt;
    if (hudClockRef.current >= 0.125) {
      hudClockRef.current %= 0.125;
      const remaining = Math.max(0, activeCourse.limit - playTime(activeShow));
      const mine = localId(activeShow);
      const running = stillRunning(activeShow).length;
      setHud({
        round: activeShow.round,
        name: COURSE_NAMES[courseOf(activeShow)],
        phase: activeShow.phase,
        phaseT: activeShow.phaseT,
        time: remaining,
        count: activeShow.round === 1 ? running : activeShow.finished.length,
        standing: running,
        quota: activeShow.quota,
        localQualified: mine != null && activeShow.qualified.includes(mine),
        localOut: mine != null && (activeShow.out.includes(mine) || activeShow.fallen.includes(mine)),
        playClock: activeShow.clock,
      });
      const focusId = watchTarget ?? mine;
      const focus = focusId == null ? undefined : bodiesRef.current.get(focusId);
      const ids = activeShow.inRound
        .filter((id) => id !== focusId && !hiddenRef.current.has(id) && bodiesRef.current.has(id))
        .sort((a, b) => {
          const ba = bodiesRef.current.get(a)!, bb = bodiesRef.current.get(b)!;
          const fx = focus?.x ?? 0, fz = focus?.z ?? 0;
          return (ba.x - fx) ** 2 + (ba.z - fz) ** 2 - ((bb.x - fx) ** 2 + (bb.z - fz) ** 2);
        })
        .slice(0, 8);
      setTagIds(mine != null && bodiesRef.current.has(mine) ? [mine, ...ids] : ids);
    }
  }

  function focusFor(show: Show): number | null {
    const mine = localId(show);
    const spectating = !!room?.watching || mine == null || show.finished.includes(mine) || show.fallen.includes(mine) || show.out.includes(mine);
    if (!spectating && mine != null) return mine;
    const ids = watchedIds(show);
    if (!ids.length) return null;
    let chosen = watchTarget;
    if (chosen == null || !ids.includes(chosen)) {
      const at = Math.max(0, Math.min(ids.length - 1, watchIndexRef.current));
      chosen = ids[at];
      watchIndexRef.current = at;
      setWatchTarget(chosen);
    }
    return chosen;
  }

  function render() {
    const view = viewRef.current;
    const show = showRef.current;
    const course = courseRef.current;
    if (!view || !show || !course) return;
    const time = currentCourseClock(show);
    for (const id of show.inRound) {
      if (!isLocallyStepped(id) && !hiddenRef.current.has(id)) sampleRemote(id, time);
    }
    const bodies: (BodyView | null)[] = Array.from({ length: 20 }, () => null);
    for (const id of show.inRound) {
      if (!hiddenRef.current.has(id)) bodies[id] = bodiesRef.current.get(id) ?? null;
    }
    const focus = focusFor(show);
    view.frame(course, time, bodies, focus, cameraRef.current, renderDtRef.current);
    for (const id of tagIds) {
      const node = tagNodesRef.current.get(id);
      const body = bodiesRef.current.get(id);
      if (!node) continue;
      const point = body ? view.project(body.x, body.y + (id === localId(show) ? 1.45 : 1.85), body.z) : null;
      if (!point || point.x < 12 || point.x > size.w - 12 || point.y < 12 || point.y > size.h - 12) {
        node.style.visibility = 'hidden';
        continue;
      }
      node.style.visibility = 'visible';
      node.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -100%)`;
    }
    view.render();
  }

  useGameLoop(update, render, { always: mode === 'online' });

  function beginPointer(e: RPointerEvent<HTMLDivElement>) {
    if (shell.status !== 'playing' || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.g-wacky-walk-action, .g-wacky-walk-watch')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (shell.touch) {
      if (localId() != null && x < rect.width * 0.53) {
        e.preventDefault();
        const item = { pointer: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        stickRef.current = item;
        dragRef.current = { kind: 'stick', pointer: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
        setStick(item);
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (x > rect.width * 0.56 && y < rect.height * 0.62) {
        e.preventDefault();
        dragRef.current = { kind: 'orbit', pointer: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    e.preventDefault();
    dragRef.current = { kind: 'orbit', pointer: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function movePointer(e: RPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.kind === 'orbit') {
      cameraRef.current.yaw -= dx * 0.006;
      cameraRef.current.pitch = Math.max(0.05, Math.min(1.1, cameraRef.current.pitch + dy * 0.005));
      manualOrbitAtRef.current = performance.now() / 1000;
    } else {
      const length = Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy);
      const scale = length > 48 ? 48 / length : 1;
      const item = {
        pointer: e.pointerId, ox: drag.ox, oy: drag.oy,
        x: drag.ox + (e.clientX - drag.ox) * scale,
        y: drag.oy + (e.clientY - drag.oy) * scale,
      };
      stickRef.current = item;
      setStick(item);
    }
  }

  function endPointer(e: RPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    if (drag.kind === 'stick') {
      stickRef.current = null;
      setStick(null);
    }
    dragRef.current = null;
  }

  function pressAction(e: RPointerEvent<HTMLButtonElement>, action: 'jump' | 'dive') {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (action === 'jump') touchJumpRef.current = true;
    else touchDiveRef.current = true;
  }

  const show = showRef.current;
  const mine = show ? localId(show) : null;
  const isWatching = !!room?.watching || mine == null || !!(show && (show.finished.includes(mine) || show.fallen.includes(mine) || show.out.includes(mine)));
  const watchedName = watchTarget == null ? 'a runner' : entrant(watchTarget, show)?.name ?? 'a runner';
  const showTags = show?.entrants ?? [];
  const activeTouch = shell.touch && !isWatching && shell.status === 'playing';
  const remainingCount = hud.round === 1 ? `${hud.standing} standing` : `${hud.count} qualified`;
  const intro = hud.phase === 'intro';
  const count = hud.phase === 'count';
  const outro = hud.phase === 'outro';
  const hint = !shell.touch && hud.playClock < 6 && !isWatching;
  const eliminatedOffline = mode === 'solo' && hud.localOut && hud.phase !== 'done';

  return (
    <div
      ref={ref}
      className="g-wacky-walk-stage"
      onPointerDown={beginPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="g-wacky-walk-vignette" aria-hidden="true" />
      {show && (
        <>
          <div className="g-wacky-walk-top">
            <div className="g-wacky-walk-pill">
              <span className="g-wacky-walk-round">round {hud.round + 1}: {hud.name}</span>
              <span className="g-wacky-walk-clock">{timeLabel(hud.time)}</span>
              <span className="g-wacky-walk-standing">{remainingCount} / {hud.quota}</span>
            </div>
            {isWatching && <div className="g-wacky-walk-watch-label">watching {watchedName}</div>}
          </div>
          {intro && (
            <div className="g-wacky-walk-intro">
              <span className="g-wacky-walk-eyebrow">round {hud.round + 1}</span>
              <strong>{hud.name}</strong>
              <span>{courseTip(courseOf(show))}</span>
            </div>
          )}
          {count && (
            <div className="g-wacky-walk-count" aria-live="polite">
              {Math.max(1, Math.ceil(3 - hud.phaseT))}
            </div>
          )}
          {hud.phase === 'play' && hud.playClock - 7 < 0.7 && (
            <div className="g-wacky-walk-go">go!</div>
          )}
          {outro && (
            <div className="g-wacky-walk-outro">
              <strong className={hud.localQualified ? 'is-qualified' : 'is-eliminated'}>
                {hud.localQualified ? 'qualified!' : hud.localOut ? 'eliminated' : 'round over'}
              </strong>
              <span>round over</span>
            </div>
          )}
          {hint && <div className="g-wacky-walk-hint">wasd move, space jump, shift dive, drag or q/e camera</div>}
          {showTags.map((player) => tagIds.includes(player.id) && (
            <div
              className={`g-wacky-walk-tag${player.id === mine ? ' is-you' : ''}`}
              key={player.id}
              ref={(node) => {
                if (node) tagNodesRef.current.set(player.id, node);
                else tagNodesRef.current.delete(player.id);
              }}
            >
              {player.id === mine ? 'you' : player.name}
            </div>
          ))}
          {activeTouch && stick && (
            <div className="g-wacky-walk-stick" style={{ left: stick.ox, top: stick.oy }} aria-hidden="true">
              <i style={{ transform: `translate(${stick.x - stick.ox}px, ${stick.y - stick.oy}px)` }} />
            </div>
          )}
          {activeTouch && (
            <div className="g-wacky-walk-actions">
              <button
                type="button"
                className="g-wacky-walk-action"
                onPointerDown={(e) => pressAction(e, 'jump')}
                aria-label="jump"
              >jump</button>
              <button
                type="button"
                className="g-wacky-walk-action is-dive"
                onPointerDown={(e) => pressAction(e, 'dive')}
                aria-label="dive"
              >dive</button>
            </div>
          )}
          {isWatching && (
            <div className="g-wacky-walk-watch">
              <button type="button" onClick={() => cycleWatch(-1)} aria-label="watch previous runner">&lt;</button>
              <span>watching {watchedName}</span>
              <button type="button" onClick={() => cycleWatch(1)} aria-label="watch next runner">&gt;</button>
            </div>
          )}
          {eliminatedOffline && (
            <div className="g-wacky-walk-eliminated">
              <strong>eliminated</strong>
              <span>keep watching the show or see your results.</span>
              <button
                type="button"
                onClick={() => shell.gameOver(undefined, { title: 'eliminated', detail: `out in round ${hud.round + 1}. thanks for taking the walk.` })}
              >see results</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
