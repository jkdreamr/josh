import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, Segmented, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { buildView, type View } from './scene';
import {
  COUNTDOWN,
  DOOR_GONE,
  DOOR_OPENING,
  DOOR_SHUT,
  FIGHTER_COLORS,
  F_STUN,
  LEVELS,
  MAX_FIGHTERS,
  MODES,
  MODE_NAMES,
  PLANS,
  SLOT_MELEE,
  SLOT_THROW,
  VAULT_TIME,
  aliveCount,
  angleDiff,
  camouflaged,
  concealed,
  createMatch,
  downMate,
  editable,
  fmtClock,
  held,
  heldGun,
  isMode,
  levelOf,
  ordinal,
  owned,
  prompt,
  pingOf,
  scopesOf,
  reviveShare,
  revivedBy,
  scoreOf,
  soloMatch,
  teamCount,
  teamOf,
  teamsLeft,
  mateColor,
  mateInNeed,
  mateMarks,
  mateNumber,
  edgeOf,
  DOWN_HP,
  EMOTE_T,
  FACE_EMOTES,
  ammoAsk,
  TEAM_EMOTES,
  emoteOf,
  emoteReady,
  isTeamEmote,
  burning,
  type Cause,
  type EmoteId,
  type Ev,
  type Fighter,
  type Input,
  type Level,
  type LootItem,
  type Match,
  type Mode,
  type Plan,
  type RideKind,
} from './logic';
import { configOf, parsePacket, teamAsk, type Bots } from './net';
import { FLUSH, QUICK_LEVEL, TICK_MS, catchUp, ending, flush, frameTime, guestMatch, handOff, hostBots, hostMatch, namesOf, newSession, nextTeam, offscreen, pinTeam, receive, resultCard, share, stepIn, takeOver, teamsFor, tick, toNewHost, winnersOf, type Session } from './session';
import { ARMOR_NAMES, MATS, MAT_MAX, MELEE, PIECE_COST, RARITY_COLORS, SCOPES, THROW, THROWS, THROW_IDS, USES, USE_IDS, WEAPONS, ammoCap, isMelee, isThrow, isWeapon, legendary, lootName, reloadOf, type Ammo, type LootDef, type MeleeId, type ThrowId, type UseId, type WeaponId } from './items';
import { DEEP, HALF, SUPPLY_FALL, basementAt, isDeep, placeAt, topX, type ContainerKind } from './map';
import { AMMO_FILL, AmmoIcon, ArmorIcon, BasementArt, CrownIcon, DROP_KEY, EDIT_KEY, EMOTE_KEY, EditIcon, EggIcon, EmoteIcon, emoteText, GhillieIcon, HowToPlay, IslandArt, MAT_KEY, MatIcon, PIECE_KEYS, PIECE_NAMES, PING_KEY, PackIcon, PieceIcon, PingIcon, PlaceNames, SCOPE_KEY, ScopeIcon, USE_KEYS, UseIcon, WeaponIcon, keyCode } from './hud';
import { meta } from './meta';
import './scramble.css';

const LEVEL = defineSetting('scramble:level', LEVELS, 'normal');
const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const;
/** With computer eggs in the room, whether more of them fill the island up to fifty. */
const FILL = defineSetting('scramble:fill', ['fill', 'none'] as const, 'fill');
/** Solo, duos or squads: for Play with Bots and a room you host, and (on its own) for quick play's Play. */
const MODE = defineSetting('scramble:mode', MODES, 'solo');
const QUICK_MODE = defineSetting('scramble:quick-mode', MODES, 'solo');
const modeOptions = MODES.map((m) => [m, MODE_NAMES[m]] as const);
/**
 * In a room you host, the team each seat is on (-1 for wherever there's room), as you and the people in the room have
 * arranged them: kept here so the match you start next lays the teams out that way.
 */
const lobbyPicks = { current: [] as number[] };
/** A Scramble room starts full: nineteen bots with the host, and Fill to 50 adds the rest. */
const ROOM_BOTS = (meta.online?.seats ?? 8) - 1;
const fillOptions = [
  ['fill', 'Fill to 50'],
  ['none', 'Room Bots Only'],
] as const;
/** Quick play's card, under the people in the match so far. */
const quickNote = (mode: Mode) => (mode === 'solo' ? `Computer eggs fill the island to ${MAX_FIGHTERS}.` : `${MODE_NAMES[mode]}: you team up with the people here first, and computer eggs fill the teams and the island to ${MAX_FIGHTERS}.`);
/** Name tags shown at once at most, the nearest eggs' (fifty would bury the screen). */
const TAGS = 12;
/** How tall a name tag is on screen: one that would sit on a nearer one's waits till they part. */
const TAG_H = 16;
/** Markers pointing the way to teammates off the screen (or up or down a stairway): the rest of a squad. */
const MATE_MARKS = 3;
/** How far in from the side of the screen a teammate is for its name tag to show rather than its marker. */
const EDGE_IN = 30;
/** The host gives everyone a moment to get its first packet before the countdown. */
const HOST_LEAD = 1.2;
const STICK_R = 52;
const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);
/** Whether the player asked for less motion (looked up once). */
let calmed: boolean | null = null;
const calmMotion = () => (calmed ??= typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
/** How far a touch throw goes for how far the right thumb is pushed (pixels from where it came down). */
const tossReach = (len: number) => THROW.min + Math.max(0, Math.min(1, (len - 12) / (STICK_R - 12))) * (THROW.max - THROW.min);
/** Seconds a touch throw let go of too soon after the last one waits to go. */
const TOSS_WAIT = 0.8;
/** Milliseconds without a wheel event that end a turn of it (a trackpad's glide keeps them coming quicker). */
const WHEEL_GAP = 140;
/** Loot named on screen at once: the nearest few by your feet, and the one the mouse is over. */
const LABELS = 5;
/** How tall a loot name is on screen, with a little gap. */
const LABEL_H = 20;
/** What the cars are called. */
const RIDE_NAMES: Record<RideKind, string> = { coupe: 'coupe', jeep: 'jeep', truck: 'pickup' };
/** What the interact key says it will open. */
const OPEN_TEXT: Partial<Record<ContainerKind, string>> = { supply: 'open supply drop', fridge: 'open the fridge', drawer: 'open the drawers', books: 'search the bookshelf', locker: 'open the locker', safe: 'open the safe', deposit: 'open the deposit box' };
/** The color a piece of loot's name shows in: its rarity's (or its level's), gold for the best. */
function lootColor(def: LootDef) {
  if (legendary(def)) return RARITY_COLORS[4];
  switch (def.kind) {
    case 'gun':
      return RARITY_COLORS[def.r];
    case 'scope':
    case 'pack':
    case 'helmet':
    case 'vest':
      return RARITY_COLORS[Math.min(4, def.lv + 1)];
    case 'ammo':
      return AMMO_FILL[def.a];
    case 'throw':
    case 'ghillie':
      return RARITY_COLORS[3];
    case 'melee':
      return RARITY_COLORS[2];
    default:
      return '#f4f5f7';
  }
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  const [quickMode] = useSetting(QUICK_MODE);
  return (
    <GameShell
      meta={meta}
      compact={compact}
      onExit={onExit}
      roomCode={roomCode}
      setup={<Setup />}
      hostSetup={<OnlineSetup />}
      defaultBots={ROOM_BOTS}
      quickNote={quickNote(quickMode)}
      quickSetup={<QuickSetup />}
      // quick play keeps each mode's matches apart (solo's in the pool quick play always had)
      quickPool={quickMode === 'solo' ? undefined : quickMode}
      soloLabel="Play with Bots"
    >
      <Stage />
    </GameShell>
  );
}

/** The mode quick play's Play finds a match in. */
function QuickSetup() {
  const [mode, setMode] = useSetting(QUICK_MODE);
  return <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />;
}

function useBests() {
  const easy = useHighScore('scramble-easy');
  const normal = useHighScore('scramble-normal');
  const hard = useHighScore('scramble-hard');
  return { easy, normal, hard };
}

function Setup() {
  const [level, setLevel] = useSetting(LEVEL);
  const [mode, setMode] = useSetting(MODE);
  const best = useBests()[level].best;
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <Segmented label="Computer Eggs" value={level} options={levelOptions} onChange={setLevel} />
      <Extras />
      {best !== null && <small className="g-scramble-best">Best solo on {level}: {best.toLocaleString('en-US')} pts</small>}
    </>
  );
}

function Extras() {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  return (
    <div className="g-scramble-extras">
      <button type="button" className="arcade-btn" onClick={() => setOpen(true)}>
        How to Play
      </button>
      {open && (
        <HowToPlay
          root={shell.root.current}
          touch={shell.touch}
          onClose={() => {
            setOpen(false);
            shell.root.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

/**
 * Settings for online matches. The host picks the mode, and in duos and squads the people in the room arrange the teams
 * (the host anyone's, everyone else their own; whoever doesn't pick goes on the first team with room, so friends fill
 * teams together in seat order, and computer eggs fill the rest). The room's bots are its computer eggs (the host adds
 * them in the room, and they fill every empty seat unless the host takes some away). With any in the room, the host
 * picks whether more fill the island to fifty, and how sharp they all are, and tells the room. Quick play always
 * fills it, at normal, in the mode its Play found.
 */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(LEVEL);
  const [fill, setFill] = useSetting(FILL);
  const [myMode, setMode] = useSetting(MODE);
  const [picks, setPicks] = useState<number[]>(() => [...lobbyPicks.current]);
  const [picked, setPicked] = useState<{ bots: Bots; level: Level; mode: Mode; picks: number[] } | null>(null);
  const host = online?.isHost ?? true;
  const bots = online?.bots.length ?? 0;
  const mode = host ? myMode : (picked?.mode ?? 'solo');
  const seen = host ? picks : (picked?.picks ?? []);
  useEffect(() => {
    lobbyPicks.current = picks;
  }, [picks]);
  // someone who leaves gives up their pick (whoever takes the seat next goes wherever there's room)
  const seatsKey = online?.players.map((p) => p.seat).join() ?? '';
  useEffect(() => {
    if (!online?.isHost) return;
    const here = new Set(online.players.map((p) => p.seat));
    setPicks((x) => (x.some((t, seat) => t >= 0 && !here.has(seat)) ? x.map((t, seat) => (here.has(seat) ? t : -1)) : x));
  }, [seatsKey]);
  useEffect(() => {
    if (!online?.isHost || online.quick) return;
    const say = () => online.send(configOf(online.round, fill, level, myMode, picks));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, fill, level, myMode, picks]);
  // the host hears who asks for which team (everyone else stays put)
  const room = useRef({ mode: myMode, seats: [] as number[] });
  room.current = { mode: myMode, seats: online ? online.players.map((p) => p.seat).sort((a, b) => a - b) : [] };
  useEffect(() => {
    if (!online?.isHost || online.quick) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      const { mode, seats } = room.current;
      if (p?.k !== 'tm' || from <= 0 || mode === 'solo' || !seats.includes(from)) return;
      setPicks((x) => pinTeam(mode, seats, x, from, p.team));
    });
  }, [online]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from !== 0 || !p) return;
      if (p.k === 'cfg') setPicked({ bots: p.bots, level: p.level, mode: p.mode, picks: p.picks });
      // joining while a match is on, the host's state says how it was set up
      else if (p.k === 'S' && p.roster) {
        const bots: Bots = p.roster.length >= MAX_FIGHTERS ? 'fill' : 'none';
        setPicked((x) => (x && x.bots === bots && x.level === p.level && x.mode === p.mode ? x : { bots, level: p.level, mode: p.mode, picks: x?.picks ?? [] }));
      }
    });
  }, [online]);
  const people = online ? [...online.players].sort((a, b) => a.seat - b.seat) : [];
  // the teams as they stand (numbered from 1), and moving someone to the next one
  const seats = people.map((p) => p.seat);
  const teams = mode === 'solo' ? [] : teamsFor(mode, seats, seen, 0);
  const move = (seat: number) => {
    if (!online || mode === 'solo') return;
    const next = nextTeam(mode, teams, seats.indexOf(seat));
    if (host) setPicks((x) => pinTeam(mode, seats, x, seat, next));
    else if (seat === online.seat) online.send(teamAsk(online.round, next));
  };
  return (
    <>
      {online && !online.quick &&
        (host ? (
          <Segmented label="Mode" value={myMode} options={modeOptions} onChange={setMode} />
        ) : (
          <div className="arcade-field">
            <span>Mode</span>
            <div className="g-scramble-hostpick">
              <b>{picked ? MODE_NAMES[picked.mode] : '…'}</b>
              <small>picked by the host</small>
            </div>
          </div>
        ))}
      {online && !online.quick && mode !== 'solo' && people.length > 0 && (
        <div className="arcade-field g-scramble-teams">
          <span>Teams</span>
          <ul>
            {people.map((p, i) => {
              const mine = p.seat === online.seat;
              // nowhere else to go (every other team full) leaves the button off
              const can = (host || mine) && nextTeam(mode, teams, i) !== teams[i];
              return (
                <li key={p.seat} className={mine ? 'is-mine' : undefined}>
                  <span>{p.name}</span>
                  <button type="button" className="arcade-btn" disabled={!can} aria-label={`${p.name}: team ${teams[i] + 1}${can ? ', tap for the next team' : ''}`} onClick={() => move(p.seat)}>
                    Team {teams[i] + 1}
                  </button>
                </li>
              );
            })}
          </ul>
          <small>{host ? 'Tap a team to move someone. Computer eggs fill the rest.' : 'Tap your team to change it. Computer eggs fill the rest.'}</small>
        </div>
      )}
      {bots > 0 && !online?.quick &&
        (host ? (
          <>
            <Segmented label="Computer Eggs" value={fill} options={fillOptions} onChange={setFill} />
            <Segmented label="How Sharp" value={level} options={levelOptions} onChange={setLevel} />
          </>
        ) : (
          <div className="arcade-field">
            <span>Computer Eggs</span>
            <div className="g-scramble-hostpick">
              <b>{picked ? `${picked.bots === 'fill' ? 'fill to 50' : 'room bots only'}, ${picked.level}` : '…'}</b>
              <small>picked by the host</small>
            </div>
          </div>
        ))}
      <Extras />
    </>
  );
}

type StageMode = 'idle' | 'solo' | 'online';

/** A fresh match for each solo round and each online round, and the island from above behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', mode: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : 'solo';
    if (key !== current.current.key) current.current = { key, mode: online ? 'online' : 'solo' };
  }
  return <Play key={current.current.key} mode={current.current.mode} />;
}

/** The card for someone who joined just as a match was set up, and sits it out. */
const SIT_OUT = { title: 'Sitting This One Out', detail: 'You Will Be in the Next Round.' };

/** A stand-in while a guest waits for the host: the island with nobody on it. */
const waitingMatch = (level: Level) => createMatch({ seed: 1, role: 'guest', level, entrants: [], me: -1 });

type Slot = { w: WeaponId; r: number; mag: number } | null;
type Hud = {
  phase: Fighter['phase'] | 'none';
  alive: number;
  total: number;
  kills: number;
  hp: number;
  shield: number;
  boost: number;
  slot: number;
  slots: [Slot, Slot];
  melee: MeleeId;
  /** The throwable in the throw slot, how many (-1 when it's someone else's egg), and how many kinds we carry. */
  toss: { w: ThrowId; n: number; kinds: number } | null;
  mag: number;
  reserve: number;
  ammo: Ammo | null;
  /** Wood, stone and metal (null when it's someone else's egg), the one picked, the piece the build key makes, whether
   * there's a wall of ours in front to edit, and the level the egg stands on (0 on the ground). */
  mats: number[] | null;
  mat: number;
  piece: Plan;
  edit: boolean;
  high: number;
  /** Consumables by kind, or null when it's someone else's egg. */
  items: Record<UseId, number> | null;
  /** The scope looked through, and the ones carried (a bit each from 2x up), someone else's egg's too. */
  scope: number;
  scopes: number;
  pack: number;
  /** Helmet and vest levels (shown for someone else's egg too, as its owner reports them). */
  helmet: number;
  vest: number;
  /** 0 while reloading or using something (its bar is moved every frame, see busyOf), else -1. */
  busy: number;
  busyText: string;
  storm: string;
  shrinking: boolean;
  outside: boolean;
  low: boolean;
  /** Warming up at a campfire. */
  warm: boolean;
  /** Hidden from anyone more than a few steps off (in cover, or still in a ghillie suit), and wearing a ghillie suit. */
  hidden: boolean;
  ghillie: boolean;
  /** The kill leader's name (or 'you') and kills, or null. */
  leader: { name: string; kills: number; mine: boolean } | null;
  /** The place just walked (or landed) into, while its name is up, and the place the egg we see is in. */
  arrive: string | null;
  where: string | null;
  banner: string | null;
  prompt: string | null;
  jump: boolean;
  watching: string | null;
  /** The egg watched is on our team. */
  watchMate: boolean;
  out: string | null;
  mine: boolean;
  /**
   * In duos and squads: the teams still in, and the rest of the team of the egg we see, each in its own color with its
   * health and shield (knocked down: what it has left to bleed), and how far along a revive of it is (-1 for none).
   */
  teams: number;
  mates: Mate[] | null;
  /** In duos and squads: the number and color of the egg we see on its team, and the nearest teammate down that nobody is reviving. */
  me: { n: number; color: string } | null;
  help: { name: string; n: number; color: string; far: number } | null;
  /** The egg we see knocked down: what it has left before it bleeds out (0..1), how far along a revive is, and whose. */
  down: { left: number; revive: number; by: string | null } | null;
  /** Where the team's eggs and pings are, roughly, so the maps are drawn again as they move. */
  marks: string;
  /** The prompt is to revive a teammate (the button is held down for it), in that teammate's color. */
  reviving: boolean;
  reviveColor: string | null;
  /** The basement the egg we see is down in (its building), or -1. */
  deep: number;
  /** The emotes up that the egg we see sees: who, what, the ammo asked for and when, `;` apart. */
  emotes: string;
  /**
   * The car the egg we see sits in: what it's called, its health (percent), whether it burns, the seat it has (0
   * drives), and who sits in each seat ('' nobody, 'you', or a teammate's color). Null on foot.
   */
  car: { name: string; hp: number; burning: boolean; seat: number; seats: string[] } | null;
  /** Where the cars that can be driven are, roughly, so the maps are drawn again as they move. */
  cars: string;
};
/** A teammate on the team panel, with its number and how far off it is (to 5 m). */
type Mate = { id: number; name: string; color: string; n: number; far: number; hp: number; shield: number; down: boolean; out: boolean; revive: number };
const deep = new Set<keyof Hud>(['slots', 'toss', 'items', 'mats', 'leader', 'mates', 'down', 'me', 'help', 'car']);
/** Where the arrow for an egg goes on a map drawn `k` as big as the whole island. */
const arrowAt = (f: Fighter, k: number) => `translate(${topX(f.x).toFixed(1)} ${f.z.toFixed(1)}) rotate(${((-f.aim * 180) / Math.PI + 180).toFixed(0)}) scale(${k})`;
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every((k) => (deep.has(k) ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : a[k] === b[k]));
const blankHud = (): Hud => ({ phase: 'none', alive: 0, total: 0, kills: 0, hp: 100, shield: 0, boost: 0, slot: SLOT_MELEE, slots: [null, null], melee: 'spatula', toss: null, mag: 0, reserve: 0, ammo: null, mats: null, mat: 0, piece: 'wall', edit: false, high: 0, items: null, scope: 0, scopes: 0, pack: 0, helmet: 0, vest: 0, busy: -1, busyText: '', storm: '', shrinking: false, outside: false, low: false, warm: false, hidden: false, ghillie: false, leader: null, arrive: null, where: null, banner: null, prompt: null, jump: false, watching: null, watchMate: false, out: null, mine: false, teams: 0, mates: null, me: null, help: null, down: null, marks: '', reviving: false, reviveColor: null, deep: -1, emotes: '', car: null, cars: '' });

type Stick = { id: number; ox: number; oy: number; x: number; y: number };
/** A kill feed line; it fades out at `until` on the game clock (so a paused game keeps it up). */
type Feed = { id: number; text: string; mine: boolean; until: number };
type Pop = { el: HTMLDivElement | null; x: number; y: number; z: number; age: number; live: boolean };
/**
 * `toss` is how far a touch throw goes, `tossAim` which way, and `tossBy` the match clock it gives up at if it can't go
 * yet. `piece`, `mat` and `edit` are the build menu's (as Input has them).
 */
type Taps = { build: boolean; piece: Plan | null; mat: number; edit: boolean; reload: boolean; use: Input['use']; interact: boolean; jump: boolean; cycle: number; slot: number; watch: number; toss: number; tossAim: number; tossBy: number; ping: boolean; pingAt: { x: number; z: number } | null; drop: Input['drop']; scope: number; emote: Input['emote'] };
const noTaps = (): Taps => ({ build: false, piece: null, mat: 0, edit: false, reload: false, use: null, interact: false, jump: false, cycle: 0, slot: -1, watch: 0, toss: 0, tossAim: 0, tossBy: 0, ping: false, pingAt: null, drop: null, scope: 0, emote: null });
/**
 * The emote wheel while it's up: its middle on the game, what opened it (the right mouse button, the emote key, or the
 * touch button), and the spot an enemy call points at (under the mouse, or ahead, as it opened).
 */
type Wheel = { x: number; y: number; by: 'mouse' | 'key' | 'touch'; at: { x: number; z: number } };
/** The wheel's rings, sized to fit: faces round the middle, and round them the team's calls (in duos and squads). */
function wheelSize(w: number, h: number, teams: boolean) {
  const out = Math.max(60, Math.min(teams ? 150 : 100, Math.min(w, h) * 0.44));
  return { out, mid: teams ? out * 0.54 : out, in: out * (teams ? 0.2 : 0.3) };
}
/** The slice of the wheel a point so far from its middle is on (past the edge too), or null in the middle. */
function wheelAt(dx: number, dy: number, teams: boolean, size: ReturnType<typeof wheelSize>): EmoteId | null {
  const r = Math.hypot(dx, dy);
  if (r < size.in) return null;
  const ring = teams && r > size.mid ? TEAM_EMOTES : FACE_EMOTES;
  // clockwise from the top, a slice centered on each step round
  const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return ring[Math.floor((a / (2 * Math.PI)) * ring.length + 0.5) % ring.length];
}
/** The short name on a slice of the wheel. */
const SLICE_TEXT: Partial<Record<EmoteId, string>> = { meds: 'meds', shield: 'shield', gun: 'gun', help: 'help!', follow: 'follow me', enemy: 'enemy', omw: 'on my way' };
/**
 * Whether the egg we see sees another's emote: a call only on its team, a face over anyone in plain sight close by
 * (and its own, and its team's, always). `view`: what the screen hides, so a bubble goes with its egg.
 */
function seesEmote(m: Match, f: Fighter, eye: Fighter | undefined, k: EmoteId, view: View | null) {
  if (!eye || (f.phase !== 'ground' && f.phase !== 'drop')) return false;
  if (f === eye || (m.mode !== 'solo' && f.team === eye.team)) return true;
  return !isTeamEmote(k) && Math.hypot(f.x - eye.x, f.z - eye.z) < 40 && (f.inside < 0 || f.inside === eye.inside) && !(view ? view.hides(f.id) : concealed(m, f, eye));
}
/** How long the build key's blueprint stays up after a build key, and the edit key's mark after an edit. */
const PREVIEW = 2.5;
const EDIT_PREVIEW = 1.5;

const BUSY_TEXT: Record<UseId, string> = { bandage: 'bandaging', medkit: 'using a medkit', mini: 'drinking a mini shield', shield: 'drinking a shield potion', coffee: 'drinking coffee', smoothie: 'drinking a smoothie', tart: 'eating a golden egg tart' };
/** A name with its article, for the kill feed: "with a pistol", "with an smg", "with hot sauce". */
const withA = (name: string) => `${/^[aeiou]|^SMG/.test(name) ? 'an' : 'a'} ${name}`;
function causeName(w: Cause) {
  if (w === 'storm') return 'the storm';
  if (w === 'left') return '';
  if (w === 'bleed') return 'a knock';
  if (w === 'sauce') return 'hot sauce';
  if (w === 'grenade' || w === 'barrel') return withA(w);
  if (w === 'mirv') return withA('MIRV grenade');
  if (w === 'impulse') return withA('impulse egg');
  if (w === 'car') return 'a car';
  if (w === 'wreck') return 'a car going up';
  if (isMelee(w)) return withA(MELEE[w].name);
  return withA(WEAPONS[w].name);
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = mode === 'online' && !!online;
  const [level] = useSetting(LEVEL);
  const [fill] = useSetting(FILL);
  const [teamMode] = useSetting(MODE);
  const bests = useBests();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const view = useRef<View | null>(null);
  const match = useRef<Match | null>(null);
  const net = useRef<Session>(null as unknown as Session);
  /**
   * Sets up the match as its host: the room's bots, and with any of them, more to fill the island when the host wants
   * it (quick play always does), in the mode quick play found (else the host's, with the teams as the room arranged
   * them). The room's hand-offs this round so far are behind us: its seats are as they are now.
   */
  const setUp = (o: NonNullable<typeof online>) => {
    const quick = o.quick;
    const bots = hostBots(quick, o.bots.length, fill === 'fill');
    const md: Mode = quick ? (isMode(o.pool) ? o.pool : 'solo') : teamMode;
    const h = hostMatch(o.players, o.seat, randomSeed(), quick ? QUICK_LEVEL : level, bots, COUNTDOWN + HOST_LEAD, md, quick ? [] : lobbyPicks.current);
    match.current = h.match;
    // (the same session the room's handlers hold, afresh)
    net.current = Object.assign(net.current ?? {}, newSession(true, h.roster));
    net.current.handoffs = o.handedOff.filter((x) => x.round === o.round).length;
  };
  net.current ??= newSession(!live || online!.isHost);
  if (!match.current) {
    if (mode === 'idle') match.current = soloMatch(randomSeed(), level);
    else if (!live) match.current = soloMatch(randomSeed(), level, 'you', FIGHTER_COLORS[0], teamMode);
    else if (online!.isHost) setUp(online!);
    else match.current = waitingMatch(level);
  }
  const [viewKey, setViewKey] = useState(0);
  const clock = useRef(0);
  const [hud, setHud] = useState<Hud>(blankHud);
  const hudTick = useRef(0);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [bigMap, setBigMap] = useState(false);
  /** The touch build menu is open; and until when (our clock) the blueprint of what the build key makes shows. */
  const [buildMenu, setBuildMenu] = useState(false);
  const buildMenuRef = useRef(buildMenu);
  buildMenuRef.current = buildMenu;
  const preview = useRef<{ until: number; what: Plan | 'edit' }>({ until: -1, what: 'wall' });
  const bannerRef = useRef({ text: '', until: -1 });
  /** The named place our egg is in, the last one whose name went up, when it last came or went, and until when the name shows. */
  const placeRef = useRef({ in: -1, said: -1, at: -99, until: -1 });
  const spectate = useRef(-1);
  const soloEnd = useRef(-1);

  // input that arrives between frames
  const mouse = useRef({ x: 0, y: 0, inside: false, down: false, clicked: false, ping: false });
  /** The pick up button held down on a touch screen (to revive), and a long press on a slot or an item (to drop it). */
  const holding = useRef(false);
  /** The brake button held down, driving on a touchscreen. */
  const braking = useRef(false);
  const press = useRef<number | null>(null);
  const taps = useRef<Taps>(noTaps());
  /** The emote wheel while it's up, and the slice picked on it. */
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const wheelRef = useRef<Wheel | null>(null);
  const [wheelPick, setWheelPick] = useState<EmoteId | null>(null);
  const wheelPickRef = useRef<EmoteId | null>(null);
  // up from the right mouse button or the emote key, the mouse picks a slice wherever it goes, and letting go of the
  // button says it (no menu comes up for it meanwhile)
  useEffect(() => {
    if (!wheel || wheel.by === 'touch') return;
    const move = (e: MouseEvent) => {
      pickSlice(sliceUnder(e.clientX, e.clientY));
      if (wheelRef.current?.by === 'mouse' && e.buttons === 0) closeWheel(true);
    };
    const up = (e: MouseEvent) => {
      if (e.button === 2 && wheelRef.current?.by === 'mouse') closeWheel(true);
    };
    const menu = (e: Event) => e.preventDefault();
    const blur = () => closeWheel(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('contextmenu', menu, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', blur);
      // (a menu some systems bring up as the button comes up is still kept away)
      window.setTimeout(() => window.removeEventListener('contextmenu', menu, true), 300);
    };
  }, [wheel]);
  const moveStick = useRef<Stick | null>(null);
  const aimStick = useRef<Stick | null>(null);
  /** Which thumbsticks are down; their knobs move on the DOM as the thumb does. */
  const [sticks, setSticks] = useState({ move: false, aim: false });
  const stickEls = useRef<{ move: HTMLDivElement | null; aim: HTMLDivElement | null }>({ move: null, aim: null });
  const lastAim = useRef(0);
  /** When the match last moved on (wall seconds), so a hidden tab can catch up. */
  const lastStep = useRef(0);
  /**
   * Thumbsticks or mouse: a phone or iPad starts on thumbsticks, anything else on the mouse, and either switches to
   * whatever is actually used (a laptop with a touchscreen does both).
   */
  const [touchMode, setTouchMode] = useState(shell.touch);
  const touchRef = useRef(touchMode);
  touchRef.current = touchMode;
  useEffect(() => setTouchMode(shell.touch), [shell.touch]);
  const soundGap = useRef(0);

  // floating damage numbers and name tags, moved on the DOM every frame
  const pops = useRef<Pop[]>(Array.from({ length: 24 }, () => ({ el: null, x: 0, y: 0, z: 0, age: 9, live: false })));
  const popAt = useRef(0);
  const tags = useRef(new Map<number, HTMLDivElement>());
  const mateEls = useRef<(HTMLDivElement | null)[]>([]);
  /** The emote bubbles over eggs, by egg. */
  const bubbles = useRef(new Map<number, HTMLDivElement>());
  const bubbleHalf = useMemo(() => new WeakMap<HTMLDivElement, number>(), []);
  // hit marks where our shots land, the names of loot near us, and the wash of a stun grenade's flash
  const marks = useRef<Pop[]>(Array.from({ length: 6 }, () => ({ el: null, x: 0, y: 0, z: 0, age: 9, live: false })));
  const markAt = useRef(0);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  /** The name over the stairs by our egg, the black that fades in and out going down or up them, and the level we saw last. */
  const stairEl = useRef<HTMLDivElement | null>(null);
  const fadeEl = useRef<HTMLDivElement | null>(null);
  const belowRef = useRef(false);
  const dazeEl = useRef<HTMLDivElement | null>(null);
  /** The arrow for the egg we see on the little map and the big one: moved every frame, not only when the HUD changes. */
  const arrows = useRef<(SVGGElement | null)[]>([null, null]);
  const busyBar = useRef<HTMLElement | null>(null);
  /** Meters each egg has walked since its last footstep, and how long until the next one may sound. */
  const strides = useRef(new Map<number, number>());
  const stepGap = useRef(0);

  const buzz = (ms: number) => {
    if (!shellRef.current.touch) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not allowed here */
    }
  };

  useEffect(() => {
    const host = ref.current;
    const m = match.current;
    if (!THREE || !host || !m) return;
    const v = buildView(THREE, host, m);
    if (!v) return;
    view.current = v;
    v.resize(sizeRef.current.w, sizeRef.current.h);
    v.frame(m, focusOf(m), 0, 0, { aimLine: false, overview: mode === 'idle' || m.me < 0 });
    v.render();
    shell.invalidate();
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [THREE, viewKey]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE, viewKey]);

  // the mouse wheel cycles weapons, and with Shift held the scopes (a native listener, so it can keep the page from
  // scrolling; with Shift some browsers scroll sideways instead). One step a turn of the wheel, never by accident: a
  // trackpad's glide, a pinch (Ctrl), a sideways swipe without Shift or letting go of Shift partway through a turn is
  // still the same turn, and a turn ends after a moment's pause
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let acc = 0;
    let last = -Infinity;
    let stepped = false;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - last > WHEEL_GAP) {
        acc = 0;
        stepped = false;
      }
      last = now;
      // (and nothing while the emote wheel is up)
      if (stepped || wheelRef.current || e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
      // Firefox counts in lines (or pages), the rest in pixels
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      acc += (e.shiftKey ? e.deltaY || e.deltaX : e.deltaY) * unit;
      if (Math.abs(acc) >= 40) {
        if (e.shiftKey) taps.current.scope = acc > 0 ? -1 : 1;
        else taps.current.cycle = acc > 0 ? 1 : -1;
        stepped = true;
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (shell.status !== 'playing') {
      mouse.current.down = false;
      moveStick.current = null;
      aimStick.current = null;
      setSticks({ move: false, aim: false });
    }
  }, [shell.status]);

  /** The egg the camera follows: yours, or once you're out, whoever you're watching (your teammates first). */
  function focusOf(m: Match) {
    const me = m.fighters[m.me];
    if (me && me.phase !== 'out') return m.me;
    const alive = watchable(m);
    if (!alive.length) return Math.max(0, m.me);
    if (!alive.some((f) => f.id === spectate.current)) {
      const killer = me && me.by >= 0 ? m.fighters[me.by] : undefined;
      spectate.current = alive[0].team === me?.team ? alive[0].id : killer && killer.phase !== 'out' ? killer.id : alive[0].id;
    }
    return spectate.current;
  }

  /** The eggs still in to watch, your teammates first. */
  function watchable(m: Match) {
    const me = m.fighters[m.me];
    const alive = m.fighters.filter((f) => f.phase !== 'out');
    return me ? [...alive.filter((f) => f.team === me.team), ...alive.filter((f) => f.team !== me.team)] : alive;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Online: state about 15 times a second, events as they happen, the result from the host.

  /** Whether this game runs the match: the host when it started, or one that took it over when the host left. */
  const hosting = useRef(!!online?.isHost);
  /**
   * The result card for an online match. `report` once the host has called it; `early` when we are out and have seen
   * enough before the end: the match goes on for everyone else (the host's timer keeps running it), and the card
   * keeps up with it until the result comes, which is still reported. In a room of our own, the host's Play Again
   * waits for the end (it starts the next match for everyone); in quick play it never does (it finds another match,
   * and someone else runs this one).
   */
  const finishOnline = (report: boolean, early = false) => {
    const n = net.current;
    const o = onlineRef.current;
    const m = match.current!;
    if (report && !n.reported && o) {
      n.reported = true;
      // a team's win counts for every person on it
      const people = winnersOf(m).filter((f) => f.seat >= 0);
      const winner = people.find((f) => f.id === m.winner) ?? people[0];
      o.reportResult(o.round, winner ? winner.seat : null, m.mode !== 'solo' && winner ? people.map((f) => f.seat) : undefined);
    }
    if (n.over && !n.early) return;
    const { won, ...card } = resultCard(m, early, hosting.current && !o?.quick);
    n.early = early;
    if (n.over) {
      shellRef.current.updateOver(card);
      return;
    }
    n.over = true;
    sfx.play(won ? 'win' : 'lose');
    shellRef.current.gameOver(undefined, card);
  };
  const finishRef = useRef(finishOnline);
  finishRef.current = finishOnline;

  /**
   * Follows the room's host hand-offs this match: the roster follows each, and once the room has made us the host our
   * game takes the match over (see takeOver), while a guest tells the new host what it heard the old one settle. A note
   * says who runs the match now; nothing else changes on screen.
   */
  function syncHost() {
    const o = onlineRef.current;
    const n = net.current;
    const m = match.current;
    if (!o || !m) return;
    const ours = o.handedOff.filter((h) => h.round === o.round);
    if (ours.length <= n.handoffs) return;
    if (!n.synced) {
      n.handoffs = ours.length;
      if (!o.isHost) return;
      // made the host of a match we sat out: nothing to take over, nor to hold the next one for
      if (shellRef.current.status === 'over') shellRef.current.updateOver(SIT_OUT);
      else {
        // the host left before its first report got to us: nobody has the match it set up, so we set it up afresh
        // (anyone who did hear of it hears of this one and joins it instead)
        setUp(o);
        hosting.current = true;
        lastStep.current = performance.now() / 1000;
        setViewKey((x) => x + 1);
        addFeed('you are now running the match', true);
      }
      return;
    }
    const now = performance.now() / 1000;
    for (const h of ours.slice(n.handoffs)) handOff(n, m, h.from, now);
    const me = { seat: o.seat, isHost: o.isHost, round: o.round };
    if (o.isHost && !n.host) {
      takeOver(n, m, me, o.players.map((p) => p.seat), now);
      hosting.current = true;
      // (a card up since we were done watching: our timer runs the match from now, not from when we stopped)
      lastStep.current = now;
      // a card already up: out early, it is the host's now; with the result in, the room may hear the match is over
      if (n.over && n.early) finishRef.current(false, true);
      else if (n.over) {
        const card = resultCard(m, false, false);
        shellRef.current.updateOver({ title: card.title, detail: card.detail });
      }
    } else if (!o.isHost) for (const d of toNewHost(n, m, me, now)) o.send(d);
    const host = o.players.find((p) => p.seat === 0);
    addFeed(o.isHost ? 'you are now running the match' : `${host?.name ?? 'someone else'} is now running the match`, o.isHost);
  }
  const syncRef = useRef(syncHost);
  syncRef.current = syncHost;

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      syncRef.current();
      const o = onlineRef.current;
      const m = match.current;
      if (!o || !m) return;
      // Left out of the host's match (joined just as it was set up): sit it out rather than wait for good.
      const packet = !n.synced && from === 0 ? parsePacket(d) : null;
      if (packet?.k === 'S' && packet.round === o.round && packet.roster && !packet.roster.includes(o.seat)) {
        if (shellRef.current.status === 'playing') shellRef.current.gameOver(undefined, SIT_OUT);
        return;
      }
      const next = receive(n, m, { seat: o.seat, isHost: o.isHost, round: o.round }, from, d, (seed, lvl, time, roster, md, teams) => guestMatch(o.players, o.seat, seed, lvl, time, roster, md, teams), performance.now() / 1000);
      if (next !== m) {
        match.current = next;
        setViewKey((x) => x + 1);
      }
    });
    const timer = window.setInterval(() => {
      // the host left and someone took over (maybe us): the match goes on
      syncRef.current();
      const o = onlineRef.current;
      const m = match.current;
      if (!o || !m) return;
      const me = { seat: o.seat, isHost: o.isHost, round: o.round };
      const now = performance.now() / 1000;
      // a hidden tab gets no frames, so the match carries on from here: our egg stands still but the storm still
      // bites and the glide still lands. A host keeps the computer eggs and everyone's pickups going, hidden or done
      // watching.
      if (offscreen(n, me, document.hidden, shellRef.current.status === 'playing')) {
        const mine = m.fighters[m.me];
        if (mine) {
          mine.input.fire = false;
          mine.input.mx = 0;
          mine.input.mz = 0;
        }
        mouse.current.down = false;
        catchUp(n, m, o.seat, now - lastStep.current);
        lastStep.current = now;
        for (const packet of flush(n, o.round, FLUSH)) o.send(packet);
      }
      // done watching: nothing draws the match any more, but the card keeps count and the room still hears who won from us
      if (n.over) m.events.length = 0;
      const call = n.synced ? ending(n, m, me, now) : null;
      if (call) finishRef.current(call === 'report');
      else if (n.early) finishRef.current(false, true);
      // the host reports the eggs near the one we watch most often (none once we're done watching)
      n.watch = n.over ? m.me : focusOf(m);
      for (const out of tick(n, m, me, o.players.map((p) => p.seat), now)) o.send(out.d, { fast: out.fast, to: out.to });
    }, TICK_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  // -------------------------------------------------------------------------------------------------------------
  // Input.

  const throwing = (f: Fighter | undefined) => !!f && owned(f) && f.phase === 'ground' && f.slot === SLOT_THROW && THROW_IDS.some((k) => f.throws[k] > 0);

  function readInput(m: Match, me: Fighter, v: View | null, dt: number) {
    const inp = me.input;
    const t = taps.current;
    // Enter and left/right taps only count once you're out (leave, watch another egg): drop any made before then
    keys.pressed('Enter', 'left', 'right');
    // walking: keys, or the left thumb
    let mx = keys.axis('left', 'right');
    let mz = keys.axis('up', 'down');
    const ms = moveStick.current;
    if (ms) {
      const dx = ms.x - ms.ox;
      const dy = ms.y - ms.oy;
      const len = Math.hypot(dx, dy);
      const k = len < 8 ? 0 : Math.min(1, len / STICK_R) / len;
      mx = dx * k;
      mz = dy * k;
    }
    inp.mx = mx;
    inp.mz = mz;
    // aiming: the right thumb, the mouse, or the way you walk. With a throwable out, the right thumb sets how far
    // it goes and letting go throws it; the mouse throws to wherever it points.
    const tossing = throwing(me);
    let fire = false;
    const as = aimStick.current;
    const drag = !!as && Math.hypot(as.x - as.ox, as.y - as.oy) > 10;
    if (drag) {
      const dx = as.x - as.ox;
      const dy = as.y - as.oy;
      const len = Math.hypot(dx, dy);
      lastAim.current = assist(m, me, Math.atan2(dx, dy));
      if (tossing) inp.reach = tossReach(len);
      else fire = len > STICK_R * 0.5;
    } else if (wheelRef.current && wheelRef.current.by !== 'touch') {
      // the aim holds while the emote wheel is up (the mouse is picking on it)
    } else if (mouse.current.inside && v && !touchRef.current) {
      const g = v.ground(mouse.current.x, mouse.current.y, me.y + 1);
      if (g && Math.hypot(g.x - me.x, g.z - me.z) > 0.3) lastAim.current = Math.atan2(g.x - me.x, g.z - me.z);
      inp.reach = g ? Math.hypot(g.x - me.x, g.z - me.z) : 0;
    } else {
      if (mx || mz) lastAim.current = Math.atan2(mx, mz);
      if (!as) inp.reach = 0;
    }
    // a click too quick for a frame still fires (or throws) once
    if ((mouse.current.down || mouse.current.clicked) && !touchRef.current) fire = true;
    // a touch throw goes where the right thumb aimed it. One let go of during the throw cooldown waits it out (for a
    // moment), and a new drag of the right thumb keeps the aim line until it goes.
    const toss = tossing && t.toss > 0 && m.clock < t.tossBy ? t.toss : 0;
    const go = toss > 0 && (!drag || me.fireT <= dt);
    if (go) {
      fire = true;
      inp.reach = toss;
    }
    inp.aim = go ? t.tossAim : lastAim.current;
    inp.fire = fire && me.phase === 'ground';
    if (keys.pressed('Digit1')) inp.slot = 0;
    if (keys.pressed('Digit2')) inp.slot = 1;
    if (keys.pressed('Digit3')) inp.slot = SLOT_MELEE;
    if (keys.pressed('Digit4')) inp.slot = SLOT_THROW;
    if (t.slot >= 0) inp.slot = t.slot;
    if (keys.pressed('KeyQ')) inp.cycle = 1;
    if (t.cycle) inp.cycle = t.cycle;
    if (keys.pressed(keyCode(SCOPE_KEY))) inp.scope = 1;
    if (t.scope) inp.scope = t.scope;
    if (keys.pressed('KeyR') || t.reload) inp.reload = true;
    if (keys.pressed('KeyE') || t.interact) inp.interact = true;
    // held down by a knocked teammate, it revives them (a button let go of once the prompt has moved on lets go too)
    if (holding.current && me.reviving < 0 && !downMate(m, me)) holding.current = false;
    inp.hold = keys.down('KeyE') || holding.current;
    // a ping where the mouse points (or ahead, where you aim), and the drop key for what's in hand
    if ((keys.pressed(keyCode(PING_KEY)) || mouse.current.ping || t.ping) && pingable(me)) {
      const g = t.ping ? null : mouse.current.inside && v && !touchRef.current ? v.ground(mouse.current.x, mouse.current.y, me.y + 1) : null;
      inp.ping = t.pingAt ?? g ?? { x: me.x + Math.sin(lastAim.current) * 12, z: me.z + Math.cos(lastAim.current) * 12 };
    }
    mouse.current.ping = false;
    if (keys.pressed(keyCode(DROP_KEY))) inp.drop = me.slot;
    if (t.drop !== null) inp.drop = t.drop;
    // the emote key held down opens the wheel where the mouse is (or in the middle), and letting go says what it's on
    const emoteKey = keys.down(keyCode(EMOTE_KEY));
    if (emoteKey && !wheelRef.current) {
      const { w, h } = sizeRef.current;
      openWheel(mouse.current.inside && !touchRef.current ? mouse.current.x : w / 2, mouse.current.inside && !touchRef.current ? mouse.current.y : h / 2, 'key');
    } else if (!emoteKey && wheelRef.current?.by === 'key') closeWheel(true);
    if (t.emote) inp.emote = t.emote;
    USE_IDS.forEach((w) => {
      if (keys.pressed(keyCode(USE_KEYS[w]))) inp.use = w;
    });
    if (keys.pressed('KeyH')) inp.use = 'bestHeal';
    if (keys.pressed('KeyG')) inp.use = 'bestShield';
    if (t.use) inp.use = t.use;
    // building: a piece by its own key (built at once), the material and edit keys, and the build key for the piece picked
    for (const k of PLANS) if (keys.pressed(keyCode(PIECE_KEYS[k]))) inp.piece = k;
    if (t.piece) inp.piece = t.piece;
    if (keys.pressed(keyCode(MAT_KEY))) inp.mat = 1;
    if (t.mat) inp.mat = t.mat;
    if (keys.pressed(keyCode(EDIT_KEY)) || t.edit) inp.edit = true;
    const space = keys.pressed('Space');
    // in a car, Space (or the brake button) held down is the handbrake, and nothing builds
    inp.brake = me.ride >= 0 && (keys.down('Space') || braking.current);
    if (me.phase === 'bus') {
      if (space || t.jump || mouse.current.clicked || inp.interact || t.build) inp.jump = true;
    } else if ((space || t.build) && me.ride < 0) inp.build = true;
    // the blueprint of what the build key makes shows a moment after any of them (and while Space is held)
    if (me.phase === 'ground' && me.ride < 0) {
      if (inp.piece || inp.mat || inp.build || keys.down('Space')) preview.current = { until: clock.current + PREVIEW, what: inp.piece ?? me.piece };
      if (inp.edit) preview.current = { until: clock.current + EDIT_PREVIEW, what: 'edit' };
    }
    mouse.current.clicked = false;
    taps.current = noTaps();
    if (toss && me.fireT > dt) {
      taps.current.toss = toss;
      taps.current.tossAim = t.tossAim;
      taps.current.tossBy = t.tossBy;
    }
  }

  /** On a touchscreen, a near miss with the right thumb snaps onto the egg it was meant for. */
  function assist(m: Match, me: Fighter, a: number) {
    const g = heldGun(me);
    const range = g ? WEAPONS[g].range : throwing(me) ? THROW.max : 3;
    let best = a;
    let bestD = 0.2;
    for (const o of m.fighters) {
      if (o === me || o.phase !== 'ground' || concealed(m, o, me)) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d > range) continue;
      const off = Math.abs(angleDiff(Math.atan2(o.x - me.x, o.z - me.z), a));
      if (off < bestD) {
        bestD = off;
        best = Math.atan2(o.x - me.x, o.z - me.z);
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The frame loop.

  useGameLoop(
    (frameDt) => {
      const m = match.current!;
      const v = view.current;
      const n = net.current;
      const o = onlineRef.current;
      // online a frame longer than the loop allows (a slow phone, a hitch) is made up in steps, not lost (see frameTime)
      const now = performance.now() / 1000;
      const dt = live && lastStep.current > 0 ? frameTime(frameDt, now - lastStep.current) : frameDt;
      clock.current += dt;
      lastStep.current = now;
      if (live && !n.synced) {
        v?.frame(m, -1, dt, clock.current, { aimLine: false, overview: true });
        updateHud(m, dt);
        return;
      }
      const me = m.fighters[m.me];
      if (wheelRef.current && !(emotable(me) && !n.over)) closeWheel(false);
      if (me && me.phase !== 'out' && !n.over) readInput(m, me, v, dt);
      else watchInput(m);
      if (keys.pressed('KeyM')) setBigMap((b) => !b);

      stepIn(m, dt);
      const focus = focusOf(m);
      for (const e of m.events.splice(0)) {
        react(m, e, focus);
        v?.react(e, m, focus);
        if (live && o) share(n, e, o.seat);
      }
      footsteps(m, focus, dt);
      // down the stairs or up them (ours or the egg we watch): a moment of black as the view goes over
      const eye = m.fighters[focus];
      const down = !!eye && eye.phase === 'ground' && isDeep(eye.x);
      if (down !== belowRef.current) {
        belowRef.current = down;
        fadeEl.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: calmMotion() ? 200 : 480, easing: 'ease-out' });
      }
      // the name goes up on walking or landing into a named place (not again for one we only just stepped out of)
      const here = me && me.phase === 'ground' ? placeAt(m.map, topX(me.x), me.z) : -1;
      const pl = placeRef.current;
      if (here !== pl.in) {
        pl.in = here;
        if (here >= 0 && !n.over && (here !== pl.said || clock.current - pl.at > 20)) {
          pl.said = here;
          pl.until = clock.current + 3;
        }
        pl.at = clock.current;
      }
      if (live && o) for (const packet of flush(n, o.round, dt)) o.send(packet);

      if (v) {
        // the build key's blueprint (or the wall the edit key works on): for a moment after building, while the touch
        // build menu is open, or while it builds up
        const pv = preview.current;
        const plan = me && focus === m.me && me.phase === 'ground' ? (clock.current < pv.until ? (pv.what === 'edit' ? 'edit' : me.piece) : touchRef.current && buildMenuRef.current ? me.piece : null) : null;
        v.frame(m, focus, dt, clock.current, { aimLine: focus === m.me, overview: false, preview: plan });
        placeOverlays(m, v, dt, focus);
      }

      // the end: once one egg is left (out or not, you watch the rest until then, or leave when you like)
      if (!live) {
        if (me && !n.over && m.ended) {
          if (soloEnd.current < 0) soloEnd.current = clock.current;
          if (clock.current - soloEnd.current > 2.2) finishSolo(m, me);
        }
      } else if (o) {
        // the host calls it; if it never does, show what we know without reporting a winner
        const call = ending(n, m, { seat: o.seat, isHost: o.isHost, round: o.round }, performance.now() / 1000);
        if (call) finishRef.current(call === 'report');
      }
      updateHud(m, dt);
    },
    () => view.current?.render(),
  );

  /** Out of the match: arrows (or the on-screen buttons) switch whose view you watch, and Enter leaves. */
  function watchInput(m: Match) {
    if (keys.pressed('Enter') && canLeave()) leave();
    const step = (keys.pressed('right', 'KeyE') ? 1 : 0) - (keys.pressed('left') ? 1 : 0) + taps.current.watch;
    taps.current.watch = 0;
    if (!step) return;
    const alive = watchable(m);
    if (!alive.length) return;
    const at = alive.findIndex((f) => f.id === spectate.current);
    spectate.current = alive[(at + step + alive.length) % alive.length].id;
  }

  /** Out, and seen enough: on to the results. Online the match goes on without us (the host's game still runs it). */
  const canLeave = () => {
    const m = match.current;
    const me = m?.fighters[m.me];
    return !!me && me.phase === 'out' && !net.current.over;
  };
  function leave() {
    const m = match.current!;
    const me = m.fighters[m.me];
    if (!canLeave() || !me) return;
    if (!live) finishSolo(m, me);
    else finishRef.current(false, true);
  }

  /**
   * The result on this device: your place (your team's, in duos and squads) and points. Only solo matches go on the
   * boards, one a level.
   */
  function finishSolo(m: Match, me: Fighter) {
    const n = net.current;
    if (n.over) return;
    n.over = true;
    const teams = m.mode !== 'solo';
    const winners = winnersOf(m);
    const won = winners.includes(me);
    const score = scoreOf(me, won);
    const board = !teams && score > 0;
    const newBest = board && bests[m.level].submit(score);
    const total = teams ? teamCount(m) : m.fighters.length;
    // left while the rest of the team is still in: no place yet
    const title = won ? (teams ? 'Last Team Standing' : 'Last Egg Standing') : teams && !me.place ? 'Your Team Is Still In' : `${ordinal(me.place || total)} of ${total}`;
    const how = won ? '' : me.by >= 0 && me.by !== me.id ? ` Cracked by ${m.fighters[me.by]?.name ?? 'someone'}.` : me.outCause === 'storm' ? ' The storm got you.' : me.outCause === 'bleed' ? ' You bled out.' : '';
    const them = !won && winners.length && m.ended ? ` ${namesOf(winners)} won.` : '';
    const detail = `${score.toLocaleString('en-US')} pts${newBest ? ', a new best' : ''}: ${me.kills} ${me.kills === 1 ? 'elimination' : 'eliminations'}, ${Math.round(me.dealt)} damage${won ? ' and the win' : ''}.${how}${them}${teams ? ' Only solo matches go on the board.' : ''}`;
    shellRef.current.gameOver(undefined, board ? { title, detail, board: m.level, rank: score } : { title, detail });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Sounds and moments.

  function say(text: string, seconds = 2.2) {
    bannerRef.current = { text, until: clock.current + seconds };
  }

  function addFeed(text: string, mine: boolean) {
    const id = Date.now() + Math.random();
    setFeed((f) => [...f.slice(-4), { id, text, mine, until: clock.current + 6 }]);
  }

  /** A hit mark over where our shot landed (red when it cracked the egg). */
  function hitMark(x: number, z: number, kill: boolean, y = 0) {
    const p = marks.current[markAt.current];
    markAt.current = (markAt.current + 1) % marks.current.length;
    if (!p.el) return;
    Object.assign(p, { x, y: y + 1.1, z, age: 0, live: true });
    p.el.classList.toggle('is-kill', kill);
  }

  /** Footsteps of the eggs walking near the one we watch, seen or not: a soft scuff every couple of meters, louder the nearer. */
  function footsteps(m: Match, focus: number, dt: number) {
    const eye = m.fighters[focus];
    stepGap.current = Math.max(0, stepGap.current - dt);
    if (!eye || eye.phase !== 'ground' || net.current.over) return;
    for (const f of m.fighters) {
      if (f.phase !== 'ground') continue;
      const d = Math.hypot(f.x - eye.x, f.z - eye.z);
      const speed = Math.hypot(f.vx, f.vz);
      if (d > 22 || speed < 1.2) continue;
      const walked = (strides.current.get(f.id) ?? 0) + speed * dt;
      strides.current.set(f.id, walked >= 1.9 ? 0 : walked);
      if (walked < 1.9 || stepGap.current > 0) continue;
      stepGap.current = 0.05;
      const k = f === eye ? 0.3 : Math.max(0, 1 - d / 22);
      if (f.wet) sfx.noise(0.07, 0.06 * k);
      else {
        sfx.noise(0.025, 0.05 * k);
        sfx.tone({ freq: 110, to: 70, dur: 0.04, type: 'sine', vol: 0.06 * k });
      }
    }
  }

  /** A damage number popping up over a hit, `y` up from the ground (the egg's height up on something built). */
  function popNumber(x: number, z: number, text: string, shield: boolean, big: boolean, y = 0) {
    const p = pops.current[popAt.current];
    popAt.current = (popAt.current + 1) % pops.current.length;
    if (!p.el) return;
    p.x = x + (Math.random() - 0.5) * 0.6;
    p.y = 1.8 + y;
    p.z = z;
    p.age = 0;
    p.live = true;
    p.el.textContent = text;
    p.el.classList.toggle('is-shield', shield);
    p.el.classList.toggle('is-big', big);
  }

  function gunSound(w: WeaponId, k: number) {
    switch (w) {
      case 'pistol':
        sfx.noise(0.06, 0.14 * k);
        sfx.tone({ freq: 720, to: 180, dur: 0.06, type: 'square', vol: 0.05 * k });
        break;
      case 'revolver':
        sfx.noise(0.2, 0.26 * k);
        sfx.tone({ freq: 420, to: 70, dur: 0.22, type: 'sawtooth', vol: 0.09 * k });
        break;
      case 'smg':
        sfx.noise(0.04, 0.1 * k);
        sfx.tone({ freq: 900, to: 300, dur: 0.04, type: 'square', vol: 0.04 * k });
        break;
      case 'micro':
        sfx.noise(0.03, 0.08 * k);
        sfx.tone({ freq: 1100, to: 420, dur: 0.03, type: 'square', vol: 0.035 * k });
        break;
      case 'rifle':
      case 'burst':
        sfx.noise(0.07, 0.15 * k);
        sfx.tone({ freq: 520, to: 120, dur: 0.08, type: 'sawtooth', vol: 0.06 * k });
        break;
      case 'lmg':
        sfx.noise(0.08, 0.17 * k);
        sfx.tone({ freq: 380, to: 90, dur: 0.08, type: 'sawtooth', vol: 0.06 * k });
        break;
      case 'scout':
        sfx.noise(0.16, 0.22 * k);
        sfx.tone({ freq: 1100, to: 140, dur: 0.2, type: 'sawtooth', vol: 0.07 * k });
        break;
      case 'shotgun':
      case 'double':
        sfx.noise(0.22, 0.3 * k);
        sfx.tone({ freq: 190, to: 50, dur: 0.18, type: 'sawtooth', vol: 0.1 * k });
        break;
      case 'auto':
        sfx.noise(0.15, 0.24 * k);
        sfx.tone({ freq: 230, to: 70, dur: 0.12, type: 'sawtooth', vol: 0.08 * k });
        break;
      case 'sniper':
        sfx.noise(0.3, 0.28 * k);
        sfx.tone({ freq: 1400, to: 90, dur: 0.35, type: 'sawtooth', vol: 0.08 * k });
        break;
      case 'crossbow':
        sfx.tone({ freq: 260, to: 120, dur: 0.12, type: 'triangle', vol: 0.09 * k });
        break;
      case 'launcher':
        sfx.tone({ freq: 220, to: 560, dur: 0.25, type: 'sawtooth', vol: 0.07 * k });
        sfx.noise(0.15, 0.1 * k);
        break;
      case 'hsmg':
        sfx.noise(0.05, 0.13 * k);
        sfx.tone({ freq: 640, to: 160, dur: 0.05, type: 'square', vol: 0.05 * k });
        break;
      case 'marksman':
        sfx.noise(0.12, 0.2 * k);
        sfx.tone({ freq: 800, to: 120, dur: 0.15, type: 'sawtooth', vol: 0.07 * k });
        break;
      case 'minigun':
        sfx.noise(0.03, 0.09 * k);
        sfx.tone({ freq: 300, to: 120, dur: 0.035, type: 'sawtooth', vol: 0.04 * k });
        break;
      case 'flare':
        // a pop and a whistle going up
        sfx.noise(0.1, 0.18 * k);
        sfx.tone({ freq: 500, to: 1800, dur: 0.9, type: 'triangle', vol: 0.06 * k });
        break;
    }
  }

  function react(m: Match, e: Ev, focus: number) {
    const f = 'f' in e ? m.fighters[e.f] : undefined;
    const eye = m.fighters[focus];
    const mine = !!f && f.id === m.me;
    // how loud something is from where we stand
    const near = (x: number, z: number) => (eye ? Math.max(0, 1 - Math.hypot(x - eye.x, z - eye.z) / 55) : 0);
    switch (e.t) {
      case 'beep':
        sfx.tone({ freq: 440, dur: 0.18, type: 'square', vol: 0.15 });
        break;
      case 'go':
        sfx.tone({ freq: 880, dur: 0.45, type: 'square', vol: 0.16 });
        break;
      case 'storm':
        if (e.shrinking) {
          say(e.phase === 1 ? 'the storm is moving' : 'the storm is closing in');
          sfx.tone({ freq: 300, to: 200, dur: 0.6, type: 'sawtooth', vol: 0.08 });
          sfx.tone({ freq: 300, to: 200, dur: 0.6, type: 'sawtooth', vol: 0.08, delay: 0.7 });
        }
        break;
      case 'supply':
        if (m.fighters[m.me]?.phase === 'out') break;
        say('a supply drop is coming down', 3);
        sfx.tone({ freq: 660, to: 990, dur: 0.25, type: 'triangle', vol: 0.12 });
        sfx.tone({ freq: 990, to: 1320, dur: 0.25, type: 'triangle', vol: 0.12, delay: 0.25 });
        break;
      case 'jump':
        if (mine) sfx.play('jump');
        break;
      case 'bounce':
        if (f && (mine || near(f.x, f.z) > 0.2)) {
          const k = mine ? 1 : near(f.x, f.z);
          sfx.tone({ freq: 240, to: 720, dur: 0.28, type: 'triangle', vol: 0.12 * k });
          sfx.tone({ freq: 480, to: 1100, dur: 0.2, type: 'sine', vol: 0.06 * k, delay: 0.08 });
          if (mine) buzz(30);
        }
        break;
      case 'land':
        if (mine) sfx.noise(0.12, 0.12);
        break;
      case 'stairs':
        // footsteps on the stairs, going down (or up) the scale
        if (mine || e.f === focus)
          for (let k = 0; k < 4; k++) {
            sfx.noise(0.03, 0.05, k * 0.09);
            sfx.tone({ freq: e.down ? 150 - k * 18 : 96 + k * 18, dur: 0.05, type: 'sine', vol: 0.07, delay: k * 0.09 });
          }
        break;
      case 'shot': {
        if (!f) break;
        const k = mine ? 1 : near(f.x, f.z) * 0.8;
        if (!mine) {
          // a gunfight next door shouldn't drown everything else
          if (k <= 0.05 || clock.current - soundGap.current < 0.035) break;
          soundGap.current = clock.current;
        }
        gunSound(e.w, k);
        break;
      }
      case 'swing':
        if (f && (mine || near(f.x, f.z) > 0.6)) {
          if (held(f).w === 'pan') sfx.tone({ freq: 520, to: 260, dur: 0.12, type: 'square', vol: 0.06 });
          else sfx.tone({ freq: 340, to: 140, dur: 0.1, type: 'triangle', vol: 0.08 });
        }
        break;
      case 'throw':
        if (f && (mine || near(f.x, f.z) > 0.3)) sfx.tone({ freq: 500, to: 900, dur: 0.15, type: 'triangle', vol: 0.06 * (mine ? 1 : near(f.x, f.z)) });
        break;
      case 'zone': {
        const k = near(e.x, e.z);
        if (k <= 0) break;
        if (e.k === 'flour') sfx.noise(0.35, 0.2 * k);
        else if (e.k === 'bush') sfx.tone({ freq: 220, to: 520, dur: 0.3, type: 'triangle', vol: 0.08 * k });
        else if (e.k === 'jam') {
          sfx.noise(0.2, 0.1 * k);
          sfx.tone({ freq: 140, to: 80, dur: 0.25, type: 'triangle', vol: 0.07 * k });
        } else {
          sfx.noise(0.5, 0.12 * k);
          sfx.tone({ freq: 160, to: 90, dur: 0.4, type: 'sawtooth', vol: 0.05 * k });
        }
        break;
      }
      case 'thud':
        // a frying pan turning a bullet away, near us
        if (e.what === 'pan' && near(e.x, e.z) > 0.5) sfx.tone({ freq: 1500, to: 900, dur: 0.12, type: 'square', vol: 0.06 });
        // and the clang of a bullet off a car or a lamp post
        else if ((e.what === 'car' || e.what === 'post') && near(e.x, e.z) > 0.6) sfx.tone({ freq: 2100, to: 1300, dur: 0.06, type: 'square', vol: 0.035 });
        break;
      case 'hit':
        if (e.f === m.me) {
          popNumber(e.x, e.z, String(Math.round(e.took)), e.shield, e.took >= 40, m.fighters[e.to]?.y ?? 0);
          hitMark(e.x, e.z, false, m.fighters[e.to]?.y ?? 0);
          // a soft tick that it landed (higher off a shield)
          sfx.tone({ freq: e.shield ? 1600 : 1200, to: e.shield ? 1350 : 950, dur: 0.045, type: 'sine', vol: 0.1 });
        }
        break;
      case 'hurt':
        if (e.f !== m.me) break;
        if (e.storm) sfx.tone({ freq: 160, dur: 0.08, type: 'triangle', vol: 0.06 });
        else {
          sfx.play('hit', e.shield ? 1.3 : 0.9);
          buzz(40);
        }
        break;
      case 'smash':
        if (mine) sfx.tone({ freq: 240, to: 180, dur: 0.05, type: 'square', vol: 0.06 });
        break;
      case 'door': {
        const s = m.map.slabs[e.i];
        const k = !s ? 0 : e.f === m.me ? 1 : near(s.x, s.z);
        if (k <= 0.05) break;
        if (e.s === DOOR_GONE) {
          // splintered off its hinges
          sfx.noise(0.25, 0.22 * k);
          sfx.tone({ freq: 160, to: 60, dur: 0.25, type: 'sawtooth', vol: 0.08 * k });
        } else if (e.s === DOOR_OPENING) {
          // the vault's alarm, and its bolts grinding back
          for (let i = 0; i < 5; i++) sfx.tone({ freq: 880, to: 640, dur: 0.22, type: 'square', vol: 0.05 * k, delay: i * 0.45 });
          sfx.noise(0.8, 0.07 * k);
          if (e.f === m.me) say('the vault is opening', 3);
        } else if (s?.vault) sfx.tone({ freq: 120, to: 60, dur: 0.7, type: 'sawtooth', vol: 0.1 * k });
        else {
          // a creak as it swings, a knock as it shuts
          sfx.tone({ freq: e.s === DOOR_SHUT ? 320 : 420, to: e.s === DOOR_SHUT ? 200 : 640, dur: 0.14, type: 'triangle', vol: 0.07 * k });
          if (e.s === DOOR_SHUT) sfx.noise(0.05, 0.12 * k, 0.1);
        }
        break;
      }
      case 'stun': {
        // a sharp bang and a ringing in the ears
        const k = Math.max(0.1, near(e.x, e.z));
        sfx.noise(0.2, 0.3 * k);
        sfx.tone({ freq: 3200, to: 2900, dur: 0.9, type: 'sine', vol: 0.05 * k, delay: 0.05 });
        break;
      }
      case 'leader': {
        const who = m.fighters[e.f];
        if (!who) break;
        const mine = e.f === m.me;
        addFeed(`${mine ? 'you are' : `${who.name} is`} the kill leader (${e.kills} kills)`, mine);
        say(mine ? 'you are the kill leader!' : `${who.name} is the kill leader`, 2.6);
        sfx.tone({ freq: 660, to: 990, dur: 0.18, type: 'triangle', vol: 0.09 });
        sfx.tone({ freq: 990, to: 1320, dur: 0.2, type: 'triangle', vol: 0.09, delay: 0.16 });
        break;
      }
      case 'glass': {
        // a crash and the tinkle of shards falling
        const p = m.map.windows[e.i];
        const k = mine ? 1 : p ? near(p.x, p.z) : 0;
        if (k <= 0.05) break;
        sfx.noise(0.16, 0.16 * k);
        for (const [i, f] of [2600, 3400, 2200, 3900].entries()) sfx.tone({ freq: f, to: f * 0.8, dur: 0.08, type: 'triangle', vol: 0.05 * k, delay: 0.03 + i * 0.05 });
        break;
      }
      case 'harvest':
        // a knock for wood, a clack for stone, a clang for metal
        if (mine) sfx.tone(e.mat === 'wood' ? { freq: 330, to: 220, dur: 0.06, type: 'triangle', vol: 0.1 } : e.mat === 'stone' ? { freq: 520, to: 300, dur: 0.05, type: 'square', vol: 0.06 } : { freq: 1600, to: 1100, dur: 0.08, type: 'square', vol: 0.04 });
        break;
      case 'boom': {
        // a MIRV's bomblets pop, smaller and quieter
        const small = e.r !== undefined;
        const k = Math.max(0.15, near(e.x, e.z)) * (small ? 0.55 : 1);
        if (small && clock.current - soundGap.current < 0.05) break;
        if (small) soundGap.current = clock.current;
        sfx.noise(small ? 0.25 : 0.45, 0.3 * k);
        sfx.tone({ freq: small ? 180 : 120, to: 40, dur: small ? 0.22 : 0.4, type: 'sawtooth', vol: 0.12 * k });
        break;
      }
      case 'pulse': {
        // a soft thump and a whoosh
        const k = near(e.x, e.z);
        if (k <= 0) break;
        sfx.tone({ freq: 90, to: 260, dur: 0.3, type: 'sine', vol: 0.14 * k });
        sfx.noise(0.25, 0.12 * k);
        break;
      }
      case 'seat':
        // the door, in or out
        if (e.f === m.me) {
          sfx.noise(0.07, 0.14);
          sfx.tone({ freq: 190, to: 110, dur: 0.09, type: 'square', vol: 0.07 });
        }
        break;
      case 'crash': {
        // a crunch, as loud as it was hard
        const k = Math.min(1, e.d / 20) * (m.fighters[m.me]?.ride === e.v ? 1 : near(e.x, e.z));
        if (k <= 0.05) break;
        sfx.noise(0.18, 0.25 * k);
        sfx.tone({ freq: 140, to: 60, dur: 0.18, type: 'sawtooth', vol: 0.1 * k });
        if (m.fighters[m.me]?.ride === e.v) buzz(40);
        break;
      }
      case 'wreck': {
        // a deeper rumble under the bang (see boom)
        const k = Math.max(0.15, near(e.x, e.z));
        sfx.tone({ freq: 70, to: 30, dur: 0.7, type: 'sawtooth', vol: 0.12 * k });
        break;
      }
      case 'called':
        if (e.f === m.me) say('flare away: a supply drop is on its way', 3);
        break;
      case 'reload':
        if (mine) sfx.play('tick', 0.7);
        break;
      case 'reloaded':
        if (mine) sfx.play('tick', 1.1);
        break;
      case 'empty':
        if (mine) sfx.tone({ freq: 220, dur: 0.04, type: 'square', vol: 0.06 });
        break;
      case 'use':
        if (mine) sfx.play('select', 0.8);
        break;
      case 'used':
        if (mine) sfx.play('coin', e.what === 'shield' || e.what === 'mini' ? 0.9 : e.what === 'coffee' ? 1.5 : 1.2);
        break;
      case 'took':
        if (e.f === m.me) sfx.play(e.def.kind === 'gun' || e.def.kind === 'melee' ? 'select' : 'blip', 1.3);
        break;
      case 'opened':
        if (e.f === m.me) {
          const c = m.map.containers[e.c];
          if (c?.kind === 'chest' || c?.kind === 'supply' || c?.kind === 'safe') sfx.play('coin', c.kind === 'supply' || c.kind === 'safe' || c.gold ? 0.8 : 1);
          else if (c?.kind === 'fridge' || c?.kind === 'deposit') sfx.play('coin', 1.2);
          else if (c?.kind === 'locker') sfx.tone({ freq: 700, to: 420, dur: 0.1, type: 'square', vol: 0.06 });
          else if (c?.kind === 'drawer' || c?.kind === 'books') sfx.noise(0.12, 0.1);
          else if (c?.kind === 'toilet') sfx.tone({ freq: 900, to: 300, dur: 0.12, type: 'square', vol: 0.07 });
          else if (c?.kind === 'crate' || c?.kind === 'hay') sfx.noise(0.15, 0.15);
        }
        break;
      case 'wall':
        if (e.wall.f === m.me) {
          // a thunk, deeper for stone and metal
          const low = e.wall.mat === 'wood' ? 1 : e.wall.mat === 'stone' ? 0.8 : 0.65;
          sfx.noise(0.06, 0.1);
          sfx.tone({ freq: 260 * low, to: 360 * low, dur: 0.07, type: 'square', vol: 0.06 });
        }
        break;
      case 'edit':
        if (e.f === m.me) sfx.tone({ freq: 620, to: e.e ? 880 : 420, dur: 0.06, type: 'square', vol: 0.05 });
        break;
      case 'out': {
        const who = m.fighters[e.f];
        const by = e.by >= 0 ? m.fighters[e.by] : undefined;
        if (!who) break;
        const yours = e.by === m.me && e.f !== m.me;
        const name = (x: Fighter) => (x.id === m.me ? 'you' : x.name);
        const kills = (x: Fighter) => `${x.kills} ${x.kills === 1 ? 'kill' : 'kills'}`;
        // a knocked egg finished off, bled out, or out with the last of its team
        const text =
          e.w === 'left'
            ? `${who.name} left`
            : e.w === 'bleed'
              ? `${name(who)} bled out${by && by !== who ? ` (knocked by ${name(by)}, ${kills(by)})` : ''}`
              : e.w === 'storm' || !by
                ? `${name(who)} ${who.id === m.me ? 'were' : 'was'} lost to the storm`
                : by === who
                  ? `${name(who)} cracked`
                  : e.down
                    ? `${name(by)} finished ${name(who)} (${kills(by)})`
                    : `${name(by)} eliminated ${name(who)} with ${causeName(e.w)} (${kills(by)})`;
        addFeed(text, yours || e.f === m.me || mateOf(m, who));
        if (yours) {
          hitMark(who.x, who.z, true, who.y);
          say(`you cracked ${who.name}`);
          sfx.play('coin', 1.4);
          buzz(30);
        } else if (e.f === m.me) {
          sfx.play('lose');
          buzz(120);
        } else if (eye && near(who.x, who.z) > 0) sfx.noise(0.12, 0.1 * near(who.x, who.z));
        break;
      }
      case 'knock': {
        const who = m.fighters[e.f];
        const by = e.by >= 0 ? m.fighters[e.by] : undefined;
        if (!who) break;
        const name = (x: Fighter) => (x.id === m.me ? 'you' : x.name);
        addFeed(by ? `${name(by)} knocked ${name(who)} down with ${causeName(e.w)}` : `${name(who)} ${who.id === m.me ? 'were' : 'was'} knocked down${e.w === 'storm' ? ' by the storm' : ''}`, e.by === m.me || e.f === m.me || mateOf(m, who));
        if (e.by === m.me) {
          hitMark(who.x, who.z, true, who.y);
          say(`you knocked ${who.name} down`);
          sfx.play('coin', 1.2);
          buzz(25);
        } else if (e.f === m.me) {
          say('knocked down! crawl to your team', 3);
          sfx.tone({ freq: 330, to: 110, dur: 0.5, type: 'sawtooth', vol: 0.1 });
          buzz(90);
        } else if (mateOf(m, who)) {
          say(`${who.name} is down`);
          sfx.tone({ freq: 520, to: 260, dur: 0.3, type: 'triangle', vol: 0.1 });
        }
        break;
      }
      case 'revive':
        if (e.to === m.me && e.f !== m.me && m.fighters[e.f]) say(`${m.fighters[e.f].name} is reviving you`);
        break;
      case 'revived': {
        const who = m.fighters[e.f];
        const by = m.fighters[e.by];
        if (!who) break;
        if (mateOf(m, who)) addFeed(`${by ? (by.id === m.me ? 'you' : by.name) : 'someone'} revived ${who.id === m.me ? 'you' : who.name}`, true);
        if (e.f === m.me) {
          say('back on your feet', 2.4);
          sfx.play('coin', 1.1);
        } else if (e.by === m.me) {
          say(`${who.name} is back up`);
          sfx.play('coin', 1.3);
        }
        break;
      }
      case 'ping':
        // a teammate marks a spot: a blip (the map and the island show where)
        if (f && mateOf(m, f)) sfx.tone({ freq: 1180, to: 1560, dur: 0.12, type: 'sine', vol: 0.09 });
        break;
      case 'emote': {
        // a bubble over the egg (see placeOverlays), and a team's call in the feed with a chirp
        if (!f || !seesEmote(m, f, eye, e.k, view.current)) break;
        if (isTeamEmote(e.k)) {
          addFeed(`${mine ? 'you' : f.name}: ${emoteText(e.k, e.a)}`, true);
          sfx.tone({ freq: 760, to: 980, dur: 0.09, type: 'triangle', vol: 0.09 });
          sfx.tone({ freq: 980, to: 1240, dur: 0.1, type: 'triangle', vol: 0.08, delay: 0.1 });
          if (!mine && (e.k === 'help' || e.k === 'meds' || e.k === 'shield' || e.k === 'ammo' || e.k === 'gun')) buzz(15);
        } else sfx.tone({ freq: 520, to: 780, dur: 0.12, type: 'sine', vol: 0.08 * Math.max(0.3, mine ? 1 : near(f.x, f.z)) });
        break;
      }
      case 'end': {
        const winners = winnersOf(m);
        const me = m.fighters[m.me];
        if (me && winners.includes(me)) {
          say(m.mode === 'solo' ? 'last egg standing!' : 'last team standing!', 6);
          sfx.play('win');
        }
        break;
      }
    }
  }

  /** Whether our egg can emote: off the bus and still in (knocked down too). */
  const emotable = (f: Fighter | undefined) => !!f && (f.phase === 'ground' || f.phase === 'drop') && shellRef.current.status === 'playing';

  /** Opens the emote wheel at (x, y) on the game, kept on screen. */
  function openWheel(x: number, y: number, by: Wheel['by']) {
    const m = match.current;
    const me = m?.fighters[m.me];
    const v = view.current;
    if (!m || !me || !emotable(me) || wheelRef.current || net.current.over) return;
    const { w, h } = sizeRef.current;
    const sz = wheelSize(w, h, m.mode !== 'solo');
    const g = by !== 'touch' && mouse.current.inside && v ? v.ground(mouse.current.x, mouse.current.y, me.y + 1) : null;
    const at = g ?? { x: me.x + Math.sin(lastAim.current) * 15, z: me.z + Math.cos(lastAim.current) * 15 };
    const wh: Wheel = { x: Math.max(sz.out + 4, Math.min(w - sz.out - 4, x)), y: Math.max(sz.out + 4, Math.min(h - sz.out - 40, y)), by, at };
    wheelRef.current = wh;
    setWheel(wh);
    pickSlice(null);
  }
  /** Puts the wheel away, saying what it was on when `send`. */
  function closeWheel(send: boolean) {
    const wh = wheelRef.current;
    const k = wheelPickRef.current;
    wheelRef.current = null;
    setWheel(null);
    pickSlice(null);
    if (!send || !wh || !k) return;
    const m = match.current;
    const me = m?.fighters[m.me];
    if (!m || !me) return;
    if (!emoteReady(me, m.clock)) return say('one at a time: wait a moment', 1.4);
    taps.current.emote = { k, x: wh.at.x, z: wh.at.z };
  }
  function pickSlice(k: EmoteId | null) {
    if (wheelPickRef.current === k) return;
    wheelPickRef.current = k;
    setWheelPick(k);
  }
  /** The slice a point on the game (client pixels) is on, with the wheel up: past its edge too, but for a touch. */
  function sliceUnder(cx: number, cy: number, touch = false) {
    const wh = wheelRef.current;
    const r = ref.current?.getBoundingClientRect();
    const m = match.current;
    if (!wh || !r || !m) return null;
    const sz = wheelSize(sizeRef.current.w, sizeRef.current.h, m.mode !== 'solo');
    const dx = cx - r.left - wh.x;
    const dy = cy - r.top - wh.y;
    return touch && Math.hypot(dx, dy) > sz.out * 1.08 ? null : wheelAt(dx, dy, m.mode !== 'solo', sz);
  }
  /**
   * The touch button for the wheel: down opens it in the middle (again puts it away), and a thumb that slides onto a
   * slice and lifts says it; lifted anywhere else, the wheel stays up for a tap on a slice (see the wheel's backdrop).
   */
  const emoteButton = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (wheelRef.current) return closeWheel(false);
      capture(e);
      openWheel(sizeRef.current.w / 2, sizeRef.current.h / 2, 'touch');
    },
    onPointerMove: (e: RPointerEvent<HTMLButtonElement>) => {
      if (wheelRef.current?.by === 'touch') pickSlice(sliceUnder(e.clientX, e.clientY, true));
    },
    onPointerUp: () => {
      if (wheelRef.current && wheelPickRef.current) closeWheel(true);
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };

  /** Whether an egg of ours can ping for its team: in duos and squads, off the bus and still in. */
  const pingable = (f: Fighter | undefined) => !!f && match.current?.mode !== 'solo' && (f.phase === 'ground' || f.phase === 'drop');

  /** On the team of the egg we see (and not that egg itself): in solo, nobody. */
  function mateOf(m: Match, f: Fighter) {
    const eye = m.fighters[focusOf(m)];
    return m.mode !== 'solo' && !!eye && f !== eye && f.team === eye.team;
  }

  /** Name tags (the nearest TAGS of them) and damage numbers, moved straight on the DOM. */
  function placeOverlays(m: Match, v: View, dt: number, focus: number) {
    const calm = calmMotion();
    const eye = m.fighters[focus];
    const near: [number, Fighter][] = [];
    for (const f of m.fighters) {
      if (!eye || f.id === focus || (f.phase !== 'ground' && f.phase !== 'drop')) continue;
      const d = Math.hypot(f.x - eye.x, f.z - eye.z);
      // teammates first, from farther off, wherever they are
      if (m.mode !== 'solo' && f.team === eye.team) near.push([d - 1000, f]);
      else if (d < 40 && (f.inside < 0 || f.inside === eye.inside) && !v.hides(f.id)) near.push([d, f]);
    }
    near.sort((a, b) => a[0] - b[0]);
    // nearest first; one that would cover a name already up stays hidden (sized from its text, not measured)
    const shown = new Map<number, { x: number; y: number }>();
    const put: { x: number; y: number; w: number }[] = [];
    for (const [, f] of near) {
      if (shown.size >= TAGS) break;
      const at = v.project(f.x, f.y + 2.3, f.z);
      if (!at) continue;
      // (a teammate's has its number in front)
      const w = Math.min(120, f.name.length * 6.4 + 16) + (m.mode !== 'solo' && f.team === eye.team ? 20 : 0);
      if (put.some((p) => Math.abs(at.x - p.x) < (w + p.w) / 2 && Math.abs(at.y - p.y) < TAG_H)) continue;
      put.push({ x: at.x, y: at.y, w });
      shown.set(f.id, at);
    }
    for (const f of m.fighters) {
      const tag = tags.current.get(f.id);
      if (!tag) continue;
      const at = shown.get(f.id);
      if (!at) {
        if (tag.style.opacity !== '0') tag.style.opacity = '0';
      } else {
        tag.style.opacity = '1';
        tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
        // in duos and squads: a teammate's in its color with its number, everyone else's dark with a red edge
        const teams = m.mode !== 'solo' && !!eye;
        const mate = teams && f.team === eye.team;
        tag.classList.toggle('is-mate', mate);
        tag.classList.toggle('is-foe', teams && !mate);
        tag.classList.toggle('is-down', f.down);
        const n = mate ? String(mateNumber(m, f)) : '';
        if (tag.dataset.n !== n) {
          tag.dataset.n = n;
          tag.style.setProperty('--mate', mate ? mateColor(m, f) : '');
        }
      }
    }
    // teammates off the screen: an arrow at the edge their way with their number and how far; one up or down a
    // stairway from us shows over (or under) where it is on our level. Red and pulsing while one is down
    const ks = mateMarks(m, eye);
    const marked = new Map<number, { x: number; y: number }>();
    const { w, h } = sizeRef.current;
    const from = eye ? v.project(eye.x, eye.y + 1, eye.z) : null;
    for (let i = 0; i < MATE_MARKS; i++) {
      const el = mateEls.current[i];
      if (!el) continue;
      const k = ks[i];
      const o = k ? m.fighters[k.id] : undefined;
      const at = o && eye ? v.project(topX(o.x) + (isDeep(eye.x) ? DEEP : 0), (k.level ? eye.y : o.y) + 1.2, o.z) : null;
      // (one whose tag is on the screen needs none)
      const seen = !!at && k.level === 0 && at.x > EDGE_IN && at.x < w - EDGE_IN && at.y > EDGE_IN && at.y < h - 8;
      // (kept in far enough for the distance under it)
      const pad = 30;
      const e = at && !seen ? edgeOf(at.x, at.y, from?.x ?? w / 2, from?.y ?? h / 2, pad, Math.max(pad + 14, h * 0.15), w - pad, h - Math.max(pad + 24, h * 0.22)) : null;
      if (!k || !e) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      el.style.opacity = '1';
      el.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px) translate(-50%, -50%)`;
      // (its marker, not half a name tag at the edge, and what it says goes up by the marker)
      marked.set(k.id, e);
      const tag = tags.current.get(k.id);
      if (tag && tag.style.opacity !== '0') tag.style.opacity = '0';
      el.style.setProperty('--a', `${(e.off ? e.a : k.level > 0 ? -Math.PI / 2 : Math.PI / 2).toFixed(3)}rad`);
      const far = `${Math.round(k.dist)}m`;
      const text = `${k.n}|${k.level === 0 ? far : e.off ? `${far} ${k.level > 0 ? 'up' : 'down'}` : k.level > 0 ? 'above' : 'below'}|${k.color}`;
      if (el.dataset.k !== text) {
        el.dataset.k = text;
        const [num, said] = text.split('|');
        el.style.setProperty('--mate', k.color);
        el.children[1].textContent = num;
        el.children[2].textContent = said;
      }
      el.classList.toggle('is-down', k.down);
      el.classList.toggle('is-help', k.help);
    }
    // emote bubbles over the eggs saying them (see Hud emotes)
    for (const [id, el] of bubbles.current) {
      if (!el.isConnected) {
        bubbles.current.delete(id);
        continue;
      }
      const f = m.fighters[id];
      const mark = marked.get(id);
      const at = mark ? { x: mark.x, y: mark.y - 12 } : f && (f.phase === 'ground' || f.phase === 'drop') ? v.project(f.x, f.y + 2.3, f.z) : null;
      if (!at) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      // over its name tag, when that's up (clear of a teammate's ring round it), fading in and out on the game clock
      // (a paused game keeps it up)
      el.style.visibility = '';
      const age = m.clock - f.emoteAt;
      el.style.opacity = calm ? '1' : Math.max(0, Math.min(1, age / 0.18, (EMOTE_T - age) / 0.5)).toFixed(2);
      // (kept on the screen, sideways; its width read once, not every frame between the moves)
      let half = bubbleHalf.get(el);
      if (half === undefined) bubbleHalf.set(el, (half = el.offsetWidth / 2 + 4));
      const x = Math.max(half, Math.min(w - half, at.x));
      el.style.transform = `translate(${x.toFixed(1)}px, ${(at.y - (shown.has(id) && !mark ? TAG_H + 12 : 4)).toFixed(1)}px) translate(-50%, -100%)`;
    }
    // hit marks: a quick X that grows a little and fades
    for (const p of marks.current) {
      if (!p.live || !p.el) continue;
      p.age += dt;
      const at = p.age < 0.32 ? v.project(p.x, p.y, p.z) : null;
      if (!at) {
        p.live = false;
        p.el.style.opacity = '0';
        continue;
      }
      p.el.style.opacity = String(Math.min(1, (0.32 - p.age) * 6));
      p.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%) rotate(45deg) scale(${(calm ? 1 : 0.8 + p.age * 1.2).toFixed(2)})`;
    }
    // the names of the loot by our feet, and of whatever the mouse is over
    const me = m.fighters[m.me];
    const named: LootItem[] = [];
    if (me && me.phase === 'ground' && eye === me) {
      // not the one the pick up prompt already names, and fewer on a small touch screen
      const p = prompt(m, me);
      const said = p && 'item' in p ? p.item : null;
      const close: [number, LootItem][] = [];
      for (const l of m.loot.values()) {
        const d = Math.hypot(l.x - me.x, l.z - me.z);
        if (d < 3.2 && l !== said) close.push([d, l]);
      }
      close.sort((a, b) => a[0] - b[0]);
      for (const [, l] of close.slice(0, touchRef.current ? 2 : LABELS - 1)) named.push(l);
      const g = mouse.current.inside && !touchRef.current ? v.ground(mouse.current.x, mouse.current.y, 0.45) : null;
      if (g) {
        let over: LootItem | null = null;
        let best = 1.1;
        for (const l of m.loot.values()) {
          const d = Math.hypot(l.x - g.x, l.z - g.z);
          if (d < best && Math.hypot(l.x - me.x, l.z - me.z) < 40) {
            over = l;
            best = d;
          }
        }
        if (over && !named.includes(over)) named.push(over);
      }
    }
    // nearest first; one that would cover a name already up goes above it (sized from its text, not measured)
    const placed: { x: number; y: number; w: number }[] = [];
    labels.current.forEach((el, i) => {
      if (!el) return;
      const l = named[i];
      const at = l ? v.project(l.x, 1.2, l.z) : null;
      if (!l || !at) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        return;
      }
      const text = lootName(l.def);
      if (el.textContent !== text) el.textContent = text;
      const w = text.length * 6.6 + 18;
      let y = at.y;
      for (let moved = true, n = 0; moved && n < LABELS; n++) {
        moved = false;
        for (const p of placed)
          if (Math.abs(at.x - p.x) < (w + p.w) / 2 && Math.abs(y - p.y) < LABEL_H) {
            y = p.y - LABEL_H;
            moved = true;
          }
      }
      placed.push({ x: at.x, y, w });
      el.style.setProperty('--loot', lootColor(l.def));
      el.style.opacity = '1';
      el.style.transform = `translate(${at.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    });
    // the stairs by our egg, on its level: down to the basement, or back up
    const sl = stairEl.current;
    if (sl) {
      const st = me && me.phase === 'ground' && eye === me ? nearStairs(m, me) : null;
      const at = st ? v.project(st.x, 1.3, st.z) : null;
      if (!st || !at) {
        if (sl.style.opacity !== '0') sl.style.opacity = '0';
      } else {
        if (sl.textContent !== st.text) sl.textContent = st.text;
        sl.style.opacity = '1';
        sl.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    // the bar of what the egg we see is busy with, filling smoothly (the HUD only says what it is)
    const bar = busyBar.current;
    if (bar && eye) {
      const width = `${(Math.max(0, Math.min(1, busyOf(m, eye).busy)) * 100).toFixed(1)}%`;
      if (bar.style.width !== width) bar.style.width = width;
    }
    // the arrow on the maps
    if (eye)
      for (const el of arrows.current) {
        if (!el) continue;
        const t = arrowAt(eye, Number(el.dataset.k));
        if (el.getAttribute('transform') !== t) el.setAttribute('transform', t);
      }
    // dazed by a stun grenade: the screen washes out white and blurs, clearing as it wears off
    const daze = !eye || eye.phase !== 'ground' ? 0 : eye.kind === 'remote' ? ((eye.show.flags & F_STUN) !== 0 ? 0.8 : 0) : Math.min(0.9, eye.stunT / 2);
    if (dazeEl.current) dazeEl.current.style.opacity = daze.toFixed(2);
    const host = ref.current;
    if (host) {
      const blur = daze > 0.02 && !calm ? `blur(${(daze * 3.5).toFixed(1)}px)` : '';
      if (host.style.filter !== blur) host.style.filter = blur;
    }
    for (const p of pops.current) {
      if (!p.live || !p.el) continue;
      p.age += dt;
      if (p.age > 0.9) {
        p.live = false;
        p.el.style.opacity = '0';
        continue;
      }
      // it pops up big, settles, and floats off slowing down (or just rises, for those who'd rather less motion)
      const u = p.age / 0.9;
      const at = v.project(p.x, p.y + (1 - (1 - u) * (1 - u)) * 1.6, p.z);
      if (!at) {
        p.el.style.opacity = '0';
        continue;
      }
      const scale = calm ? 1 : p.age < 0.08 ? 0.6 + (p.age / 0.08) * 0.9 : Math.max(1, 1.5 - (p.age - 0.08) * 4);
      p.el.style.opacity = String(Math.min(1, (0.9 - p.age) * 4));
      p.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }

  /** What an egg is busy with, and how far along (0 to 1, or -1 when nothing). */
  function busyOf(m: Match, focus: Fighter) {
    const own = owned(focus);
    const g = own && focus.slot < 2 ? focus.guns[focus.slot] : null;
    if (focus.reviving >= 0 && m.fighters[focus.reviving]) return { busy: reviveShare(m, focus), text: `reviving ${m.fighters[focus.reviving].id === m.me ? 'you' : m.fighters[focus.reviving].name}` };
    if (own && focus.reloadT > 0 && g) return { busy: 1 - focus.reloadT / reloadOf(g.w, g.r), text: 'reloading' };
    if (own && focus.using) return { busy: 1 - focus.useT / USES[focus.using].time, text: BUSY_TEXT[focus.using] };
    if (own && g && WEAPONS[g.w].spin && focus.spin > 0 && focus.spin < 1) return { busy: focus.spin, text: 'spinning up' };
    if (focus.phase === 'ground') {
      // a bank vault grinding open nearby
      const vault = m.vaults.find((i) => m.doors[i] === DOOR_OPENING && Math.hypot(m.map.slabs[i].x - focus.x, m.map.slabs[i].z - focus.z) < 14);
      if (vault !== undefined) return { busy: Math.min(1, (m.clock - m.doorAt[vault]) / VAULT_TIME), text: 'the vault is opening' };
    }
    return { busy: -1, text: '' };
  }

  function updateHud(m: Match, dt: number) {
    hudTick.current -= dt;
    if (hudTick.current > 0) return;
    hudTick.current = 1 / 15;
    setFeed((f) => (f.some((x) => x.until <= clock.current) ? f.filter((x) => x.until > clock.current) : f));
    const n = net.current;
    const focus = m.fighters[focusOf(m)];
    const me = m.fighters[m.me];
    if (!focus) {
      const next = { ...blankHud(), banner: live && !n.synced ? 'waiting for the host' : null };
      setHud((h) => (sameHud(h, next) ? h : next));
      return;
    }
    const watching = me && me.phase === 'out' && focus !== me ? focus : null;
    const own = owned(focus);
    const h = held(focus);
    const g = own && focus.slot < 2 ? focus.guns[focus.slot] : null;
    const slots: [Slot, Slot] = own ? [focus.guns[0] ? { ...focus.guns[0] } : null, focus.guns[1] ? { ...focus.guns[1] } : null] : [isWeapon(h.w) ? { w: h.w, r: h.r, mag: -1 } : null, null];
    const kinds = THROW_IDS.filter((k) => focus.throws[k] > 0).length;
    // someone else's egg: only what's in hand shows, not how many
    const toss = own && kinds > 0 ? { w: focus.throws[focus.pick] > 0 ? focus.pick : THROW_IDS.find((k) => focus.throws[k] > 0)!, n: 0, kinds } : !own && isThrow(h.w) ? { w: h.w, n: -1, kinds: 1 } : null;
    if (toss && own) toss.n = focus.throws[toss.w];
    const s = m.storm;
    const outside = Math.hypot(topX(focus.x) - s.x, focus.z - s.z) > s.r && focus.phase === 'ground';
    let storm = '';
    if (m.time >= 0) {
      if (s.shrinking) storm = `storm closing ${fmtClock(s.timer)}`;
      else if (s.timer > 0) storm = `storm moves in ${fmtClock(s.timer)}`;
      else storm = 'storm closed';
    }
    let banner: string | null = null;
    if (me && me.phase === 'out') banner = null;
    else if (m.time < -COUNTDOWN) banner = 'get ready';
    else if (m.time < 0) banner = String(Math.ceil(-m.time));
    else if (clock.current < bannerRef.current.until) banner = bannerRef.current.text;
    else if (focus.phase === 'drop' && focus === me) banner = 'steer to where you want to land';
    const { busy, text: busyText } = busyOf(m, focus);
    const teamsOn = m.mode !== 'solo';
    let promptText: string | null = null;
    let reviving = false;
    let reviveColor: string | null = null;
    if (me && me === focus && me.phase === 'ground') {
      const p = prompt(m, me);
      reviving = !!p && 'revive' in p;
      if (p && 'revive' in p) reviveColor = mateColor(m, m.fighters[p.revive]);
      if (p && 'ride' in p) {
        const kind = RIDE_NAMES[m.rides[p.ride].kind];
        promptText = p.seat < 0 ? (me.sit === 0 ? 'stop and get out' : 'get out') : p.seat === 0 ? `drive the ${kind}` : `ride in the ${kind}`;
      } else if (p && 'chest' in p) {
        const c = m.map.containers[p.chest];
        promptText = OPEN_TEXT[c.kind] ?? (c.gold ? 'open the golden chest' : 'open chest');
      } else if (p && 'door' in p) {
        const s = m.map.slabs[p.door];
        promptText = s.vault ? 'open the vault' : `${m.doors[p.door] === DOOR_SHUT ? 'open' : 'shut'} the ${s.bars ? 'cell door' : 'door'}`;
      } else if (p && 'revive' in p) promptText = me.reviving >= 0 ? 'keep holding' : `hold to revive ${m.fighters[p.revive].name}`;
      else if (p) {
        const k = p.item.def.kind;
        const have = k === 'melee' ? MELEE[me.melee].name : k === 'helmet' || k === 'vest' ? ARMOR_NAMES[k][me[k]] : 'gun';
        promptText = `${p.swap ? `swap ${have} for` : 'pick up'} ${lootName(p.item.def)}`;
      }
    }
    // out: how, and where we (our team) placed, once we know
    const total = teamsOn ? teamCount(m) : m.fighters.length;
    const out = me && me.phase === 'out' ? (me.outCause === 'bleed' ? 'bled out' : me.by >= 0 && me.by !== me.id && m.fighters[me.by] ? `cracked by ${m.fighters[me.by].name}` : me.outCause === 'storm' ? 'lost to the storm' : 'out') + (me.place ? ` · ${ordinal(me.place)} of ${total}` : ' · your team is still in') : null;
    // the rest of the team, and what's on the maps for it
    const near = mateMarks(m, focus);
    const farOf = (id: number) => {
      const k = near.find((x) => x.id === id);
      return k ? Math.round(k.dist / 5) * 5 : -1;
    };
    const mates: Mate[] | null = teamsOn
      ? teamOf(m, focus.team)
          .filter((o) => o !== focus)
          .map((o) => {
            const r = revivedBy(m, o);
            return { id: o.id, name: o.id === m.me ? 'you' : o.name, color: mateColor(m, o), n: mateNumber(m, o), far: farOf(o.id), hp: Math.max(0, Math.ceil(o.hp)), shield: o.down ? 0 : Math.ceil(o.shield), down: o.down && o.phase !== 'out', out: o.phase === 'out', revive: r ? Math.round(reviveShare(m, r) * 20) / 20 : -1 };
          })
      : null;
    // a teammate down with nobody reviving it, while the egg we see could go
    const needy = focus.phase === 'ground' && !focus.down ? mateInNeed(near) : null;
    const help = needy ? { name: needy.id === m.me ? 'you' : m.fighters[needy.id].name, n: needy.n, color: needy.color, far: Math.round(needy.dist / 5) * 5 } : null;
    const reviver = focus.down ? revivedBy(m, focus) : undefined;
    const marks = teamsOn ? teamOf(m, focus.team).map((o) => `${Math.round(o.x / 2)},${Math.round(o.z / 2)},${o.down ? 1 : 0},${pingOf(m, o) ? `${o.pingX},${o.pingZ}` : ''}`).join(';') : '';
    const gw = g ? WEAPONS[g.w] : null;
    // the car the egg we see sits in, and who sits where in it
    const ride = focus.ride >= 0 && focus.phase === 'ground' ? m.rides[focus.ride] : undefined;
    const car = ride
      ? { name: RIDE_NAMES[ride.kind], hp: Math.max(0, Math.ceil((ride.hp / ride.max) * 100)), burning: burning(ride), seat: focus.sit, seats: ride.seats.map((id) => (id < 0 || !m.fighters[id] ? '' : id === focus.id ? 'you' : teamsOn ? mateColor(m, m.fighters[id]) : '#fff')) }
      : null;
    const cars = m.rides.map((c) => (c.dead ? 'x' : `${Math.round(c.x / 2)},${Math.round(c.z / 2)},${Math.round(c.a * 4)}`)).join(';');
    // the emotes the egg we see sees over eggs
    const emotes = m.fighters
      .filter((o) => {
        const em = emoteOf(m, o);
        return !!em && seesEmote(m, o, focus, em.k, view.current);
      })
      .map((o) => `${o.id},${o.emote},${o.emoteA ?? ''},${o.emoteAt.toFixed(2)}`)
      .join(';');
    const next: Hud = {
      phase: focus.phase,
      alive: aliveCount(m),
      total: m.fighters.length,
      kills: focus.kills,
      hp: Math.ceil(focus.hp),
      shield: Math.ceil(focus.shield),
      boost: own ? Math.ceil(focus.boost) : 0,
      slot: own ? focus.slot : isWeapon(h.w) ? 0 : isThrow(h.w) ? SLOT_THROW : SLOT_MELEE,
      slots,
      melee: own ? focus.melee : isMelee(h.w) ? h.w : 'spatula',
      toss,
      mag: g ? g.mag : -1,
      reserve: g && gw && !gw.call ? focus.ammo[gw.ammo] : 0,
      // a flare gun takes no ammo
      ammo: gw && !gw.call ? gw.ammo : null,
      mats: own ? MATS.map((k) => focus[k]) : null,
      mat: focus.mat,
      piece: focus.piece,
      edit: own && focus.phase === 'ground' && !!editable(m, focus),
      high: focus.phase === 'ground' ? levelOf(focus.y) : 0,
      items: own ? { ...focus.items } : null,
      scope: focus.scope,
      scopes: focus.scopes,
      pack: own ? focus.pack : 0,
      helmet: focus.helmet,
      vest: focus.vest,
      busy: busy >= 0 ? 0 : -1,
      busyText,
      storm,
      shrinking: s.shrinking,
      outside,
      low: own && focus.hp <= 30 && focus.phase === 'ground',
      warm: focus.warm && focus.phase === 'ground',
      hidden: focus.phase === 'ground' && ((focus.bush >= 0 && m.clock - focus.firedAt > 1.2) || camouflaged(m, focus)),
      ghillie: focus.ghillie,
      leader: m.fighters[m.leader] ? { name: m.leader === m.me ? 'you' : m.fighters[m.leader].name, kills: m.fighters[m.leader].kills, mine: m.leader === m.me } : null,
      arrive: clock.current < placeRef.current.until && placeRef.current.said >= 0 ? m.map.places[placeRef.current.said]?.name ?? null : null,
      where: focus.phase === 'ground' ? (m.map.places[placeAt(m.map, topX(focus.x), focus.z)]?.name ?? null) : null,
      banner,
      prompt: promptText,
      jump: !!me && me === focus && me.phase === 'bus' && m.time >= m.map.bus.on,
      watching: watching ? watching.name : null,
      watchMate: !!watching && teamsOn && !!me && watching.team === me.team,
      out,
      mine: focus === me,
      teams: teamsOn ? teamsLeft(m) : 0,
      mates,
      me: teamsOn ? { n: mateNumber(m, focus), color: mateColor(m, focus) } : null,
      help,
      down: focus.down && focus.phase === 'ground' ? { left: Math.round(Math.max(0, focus.hp / DOWN_HP) * 50) / 50, revive: reviver ? Math.round(reviveShare(m, reviver) * 30) / 30 : -1, by: reviver ? (reviver.id === m.me ? 'you' : reviver.name) : null } : null,
      marks,
      reviving,
      reviveColor,
      deep: focus.phase === 'ground' ? basementAt(m.map, focus.x, focus.z) : -1,
      emotes,
      car,
      cars,
    };
    setHud((prev) => (sameHud(prev, next) ? prev : next));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Pointer input.

  /** Keeps a pointer's moves coming here even off the element (a pointer that is already gone can't be kept). */
  const capture = (e: RPointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* no such pointer any more */
    }
  };
  /** Whichever kind of pointer was just used becomes the way to play. */
  const usePointer = (e: RPointerEvent<HTMLElement>) => {
    const mouseNow = e.pointerType === 'mouse';
    if (mouseNow === touchRef.current) {
      touchRef.current = !mouseNow;
      setTouchMode(!mouseNow);
    }
    return mouseNow;
  };
  const onMouseMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    usePointer(e);
    mouse.current.x = e.nativeEvent.offsetX;
    mouse.current.y = e.nativeEvent.offsetY;
    mouse.current.inside = true;
  };
  const onMouseDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!usePointer(e) || shell.status !== 'playing') return;
    mouse.current.x = e.nativeEvent.offsetX;
    mouse.current.y = e.nativeEvent.offsetY;
    mouse.current.inside = true;
    if (e.button === 0) {
      mouse.current.down = true;
      mouse.current.clicked = true;
      capture(e);
    } else if (e.button === 2) openWheel(e.nativeEvent.offsetX, e.nativeEvent.offsetY, 'mouse');
    else if (e.button === 1) {
      // the middle button pings where it points
      e.preventDefault();
      mouse.current.ping = true;
    }
  };
  const onMouseUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) mouse.current.down = false;
  };
  /**
   * The right mouse button held down brings up the emote wheel, even with the left already down (when no new pointer
   * goes down for it).
   */
  const onRightDown = (e: RMouseEvent<HTMLDivElement>) => {
    if (e.button !== 2 || touchRef.current || shell.status !== 'playing') return;
    openWheel(e.nativeEvent.offsetX, e.nativeEvent.offsetY, 'mouse');
  };

  const stick = (which: 'move' | 'aim') => {
    const r = which === 'move' ? moveStick : aimStick;
    const release = (throwNow: boolean) => {
      const s = r.current;
      // with a throwable out, letting go of the right thumb throws it, as far as the thumb was pushed
      if (throwNow && which === 'aim' && s) {
        const len = Math.hypot(s.x - s.ox, s.y - s.oy);
        const m = match.current;
        if (len > 14 && m && throwing(m.fighters[m.me])) {
          taps.current.toss = tossReach(len);
          taps.current.tossAim = lastAim.current;
          taps.current.tossBy = m.clock + TOSS_WAIT;
        }
      }
      r.current = null;
      setSticks((v) => ({ ...v, [which]: false }));
    };
    return {
      onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
        // a mouse over the thumbstick areas means someone is playing with a mouse after all
        if (usePointer(e)) return;
        e.preventDefault();
        if (r.current) return;
        capture(e);
        const x = e.nativeEvent.offsetX;
        const y = e.nativeEvent.offsetY;
        r.current = { id: e.pointerId, ox: x, oy: y, x, y };
        const me = match.current?.fighters[match.current.me];
        if (which === 'aim' && me?.phase === 'bus') taps.current.jump = true;
        setSticks((s) => ({ ...s, [which]: true }));
        drawStick(which);
      },
      onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse') return void usePointer(e);
        const s = r.current;
        if (!s || s.id !== e.pointerId) return;
        s.x = e.nativeEvent.offsetX;
        s.y = e.nativeEvent.offsetY;
        // the base follows a thumb that wanders too far
        const dx = s.x - s.ox;
        const dy = s.y - s.oy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R * 1.4) {
          s.ox = s.x - (dx / len) * STICK_R * 1.4;
          s.oy = s.y - (dy / len) * STICK_R * 1.4;
        }
        drawStick(which);
      },
      onPointerUp: (e: RPointerEvent<HTMLDivElement>) => {
        if (r.current?.id !== e.pointerId) return;
        release(true);
      },
      onPointerCancel: () => release(false),
      onLostPointerCapture: () => {
        if (r.current) release(false);
      },
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    };
  };
  /** Puts a thumbstick's base where the thumb came down and its knob where the thumb is now. */
  function drawStick(which: 'move' | 'aim') {
    const s = (which === 'move' ? moveStick : aimStick).current;
    const el = stickEls.current[which];
    if (!s || !el) return;
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    el.style.left = `${s.ox}px`;
    el.style.top = `${s.oy}px`;
    const tossing = which === 'aim' && throwing(match.current?.fighters[match.current.me]);
    el.classList.toggle('is-firing', which === 'aim' && !tossing && len > STICK_R * 0.5);
    el.classList.toggle('is-tossing', tossing && len > 14);
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  const tap = (set: (t: Taps) => void) => ({
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      set(taps.current);
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });
  /**
   * A button that also puts something down for a teammate: held a moment on a touch screen, or right clicked. A right
   * click does nothing else.
   */
  const tapOrDrop = (what: Input['drop'], set: (t: Taps) => void) => {
    const stop = () => {
      if (press.current !== null) window.clearTimeout(press.current);
      press.current = null;
    };
    return {
      onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) return;
        set(taps.current);
        stop();
        if (e.pointerType !== 'mouse')
          press.current = window.setTimeout(() => {
            taps.current.drop = what;
            buzz(30);
            press.current = null;
          }, 550);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerLeave: stop,
      onContextMenu: (e: { preventDefault: () => void }) => {
        e.preventDefault();
        if (!touchRef.current) taps.current.drop = what;
      },
    };
  };
  /** The brake button, driving: held down, the handbrake is on. */
  const brakeDown = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      braking.current = true;
      capture(e);
    },
    onPointerUp: () => (braking.current = false),
    onPointerCancel: () => (braking.current = false),
    onLostPointerCapture: () => (braking.current = false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
  /** The pick up button while it says to revive: held down, it revives. */
  const holdDown = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      holding.current = true;
      capture(e);
    },
    onPointerUp: () => (holding.current = false),
    onPointerCancel: () => (holding.current = false),
    onLostPointerCapture: () => (holding.current = false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };

  const m = match.current!;
  const playing = shell.status === 'playing';
  const map = m.map;
  const islandArt = useMemo(() => <IslandArt map={map} />, [map]);
  // the name tags, teammate markers, hit marks, loot names and damage numbers, moved straight on the DOM every frame
  // (see placeOverlays): made once a match, not gone over again each time the HUD changes
  const tagEls = useMemo(
    () => (
      <>
        {m.fighters.map((f) =>
          f.id === m.me ? null : (
            <div
              key={f.id}
              ref={(el) => {
                if (el) tags.current.set(f.id, el);
                else tags.current.delete(f.id);
              }}
              className="g-scramble-tag"
              style={{ ['--tag' as string]: f.color, opacity: 0 }}
            >
              <span>{f.name}</span>
            </div>
          ),
        )}
        <div className="g-scramble-mates" aria-hidden="true">
          {Array.from({ length: MATE_MARKS }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                mateEls.current[i] = el;
              }}
              className="g-scramble-matemark"
              style={{ opacity: 0 }}
            >
              <i />
              <b />
              <small />
            </div>
          ))}
        </div>
      </>
    ),
    [m],
  );
  const popEls = useMemo(
    () => (
      <div className="g-scramble-pops" aria-hidden="true">
        <div ref={dazeEl} className="g-scramble-daze" style={{ opacity: 0 }} />
        {marks.current.map((p, i) => (
          <div
            key={`m${i}`}
            ref={(el) => {
              p.el = el;
            }}
            className="g-scramble-hitmark"
            style={{ opacity: 0 }}
          />
        ))}
        <div ref={stairEl} className="g-scramble-loot is-stairs" style={{ opacity: 0 }} />
        {Array.from({ length: LABELS }, (_, i) => (
          <div
            key={`l${i}`}
            ref={(el) => {
              labels.current[i] = el;
            }}
            className="g-scramble-loot"
            style={{ opacity: 0 }}
          />
        ))}
        {pops.current.map((p, i) => (
          <div
            key={i}
            ref={(el) => {
              p.el = el;
            }}
            className="g-scramble-pop"
            style={{ opacity: 0 }}
          />
        ))}
      </div>
    ),
    [],
  );
  const focusFighter = m.fighters[focusOf(m)];
  const s = m.storm;
  const stormPath = `M${-HALF - 40} ${-HALF - 40}H${HALF + 40}V${HALF + 40}H${-HALF - 40}Z M${(s.x - s.r).toFixed(1)} ${s.z.toFixed(1)}a${s.r.toFixed(1)} ${s.r.toFixed(1)} 0 1 0 ${(2 * s.r).toFixed(1)} 0a${s.r.toFixed(1)} ${s.r.toFixed(1)} 0 1 0 ${(-2 * s.r).toFixed(1)} 0Z`;
  // supply drops show on the map from the moment they're on their way until someone opens them
  const drops = [...map.drops, ...map.flares].map((id) => map.containers[id]).filter((c) => c && m.time >= c.at - SUPPLY_FALL && !m.opened[c.id]);
  const leader = m.fighters[m.leader];
  // in duos and squads, the rest of the team, and every ping it has up
  const team = m.mode !== 'solo' && focusFighter ? teamOf(m, focusFighter.team) : [];
  // the basement the egg we see is down in: the little map shows it close up, the big map in a corner
  const under = hud.deep >= 0 ? map.buildings[hud.deep] : undefined;
  const underBox = under ? `${(under.x - DEEP - Math.max(under.w, under.d) / 2 - 5).toFixed(1)} ${(under.z - Math.max(under.w, under.d) / 2 - 5).toFixed(1)} ${(Math.max(under.w, under.d) + 10).toFixed(1)} ${(Math.max(under.w, under.d) + 10).toFixed(1)}` : '';
  // (the big map's close up of it goes in the corner farthest from it)
  const inset = { x: under && under.x - DEEP < 0 ? HALF - 75 : -HALF + 75, z: under && under.z < 0 ? HALF - 75 : -HALF + 75 };
  /** Marks on the maps (over the ground above anyone underground), `k` as big as on the whole island. */
  const mapMarks = (big: boolean, k = 1) => (
    <>
      <path d={stormPath} fill="rgba(122, 60, 240, 0.45)" fillRule="evenodd" />
      {(s.shrinking || s.next.r < s.r - 0.5) && s.next.r > 0.3 && <circle cx={s.next.x} cy={s.next.z} r={s.next.r} fill="none" stroke="#fff" strokeWidth={(big ? 1.6 : 3) * k} />}
      {big && focusFighter?.phase === 'bus' && <line x1={map.bus.x0} y1={map.bus.z0} x2={map.bus.x1} y2={map.bus.z1} stroke="#fff" strokeWidth="2" strokeDasharray="5 4" />}
      {drops.map((c) => (
        <rect key={c.id} x={c.x - (big ? 5 : 8)} y={c.z - (big ? 5 : 8)} width={big ? 10 : 16} height={big ? 10 : 16} rx="2" fill="#2f7de1" stroke="#fff" strokeWidth={big ? 1.6 : 2.6} />
      ))}
      {/* the cars that can be driven, wherever they've been driven (one gone up is a black shell) */}
      {m.rides.map((c) => (
        <rect key={`v${c.i}`} x={-c.hw - 0.4} y={-c.hl - 0.4} width={c.hw * 2 + 0.8} height={c.hl * 2 + 0.8} rx="0.8" transform={`translate(${c.x.toFixed(1)} ${c.z.toFixed(1)}) rotate(${((-c.a * 180) / Math.PI).toFixed(0)})`} fill={c.dead ? '#2a2624' : c.kind === 'truck' ? '#5d6670' : '#f4f6f8'} stroke="#2b2d33" strokeWidth="0.6" />
      ))}
      {big && leader && leader.phase === 'ground' && leader !== focusFighter && (
        // the kill leader, wherever it is
        <g transform={`translate(${topX(leader.x).toFixed(1)} ${leader.z.toFixed(1)})`}>
          <circle r="7.5" fill="rgba(20, 16, 4, 0.55)" stroke="#ffd23d" strokeWidth="1.4" />
          <path d="M-5 3l-1-6 3.2 2.6L0 -4.5l2.8 5.1L6 -3l-1 6z" fill="#ffd23d" stroke="#7a4a00" strokeWidth="0.8" strokeLinejoin="round" />
        </g>
      )}
      {team.map((o) => {
        const at = pingOf(m, o);
        return at ? (
          <g key={`p${o.id}`} transform={`translate(${at.x} ${at.z}) scale(${(big ? 0.55 : 1) * k})`} className="g-scramble-mapping">
            <circle r={9} fill="none" stroke={mateColor(m, o)} strokeWidth="2.4" />
            <path d="M0 6L-5.5 -3a6.5 6.5 0 1 1 11 0z" fill={mateColor(m, o)} stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
          </g>
        ) : null;
      })}
      {team.map((o) =>
        o === focusFighter || o.phase === 'out' || o.phase === 'bus' ? null : (
          // each teammate in its color (with its number on the big map, drawn bigger on a small touch screen), a red
          // ring blinking round it while it's down
          <g key={`m${o.id}`} transform={`translate(${topX(o.x).toFixed(1)} ${o.z.toFixed(1)}) scale(${big && touchMode ? 1.6 : k})`}>
            {o.down && <circle r={big ? 8.5 : 12} fill="none" stroke="#ff4d4d" strokeWidth={big ? 2 : 3.4} className="is-down" />}
            <circle r={big ? 6 : 8} fill={mateColor(m, o)} stroke="#fff" strokeWidth={big ? 1.4 : 2.4} />
            {big && (
              <text y="2.9" textAnchor="middle" fontSize="8" fontWeight="800" fill="#10141c">
                {mateNumber(m, o)}
              </text>
            )}
          </g>
        ),
      )}
      {focusFighter && focusFighter.phase !== 'out' && (
        <g ref={(el) => void (arrows.current[big ? 1 : 0] = el)} data-k={k} transform={arrowAt(focusFighter, k)}>
          <path d={big ? 'M0 -7L5 5L0 2.5L-5 5Z' : 'M0 -13L9.5 9.5L0 4.6L-9.5 9.5Z'} fill={team.length ? mateColor(m, focusFighter) : focusFighter.color} stroke="#fff" strokeWidth={big ? 1.2 : 2.2} strokeLinejoin="round" />
        </g>
      )}
    </>
  );
  const box = `${-HALF - 8} ${-HALF - 8} ${2 * HALF + 16} ${2 * HALF + 16}`;
  // a teammate knocked down with nobody reviving it: who, and how far (its marker points the way). Up top in the
  // middle, or on a touch screen under the team panel, clear of the buttons
  const helpCall = hud.help && (
    <div className="g-scramble-help" role="status" style={{ ['--mate' as string]: hud.help.color }}>
      <em className="g-scramble-num">{hud.help.n}</em>
      <span>
        <b>{hud.help.name}</b> {hud.help.name === 'you' ? 'need' : 'needs'} help · {hud.help.far}m
      </span>
    </div>
  );
  const slotLabel = (i: number) => (touchMode ? '' : String(i + 1));
  const heals = hud.items ? hud.items.bandage + hud.items.medkit + hud.items.tart : 0;
  const shields = hud.items ? hud.items.mini + hud.items.shield + hud.items.smoothie : 0;

  return (
    <>
      <div
        ref={ref}
        className={`g-scramble-host${touchMode ? '' : ' is-mouse'}`}
        onPointerMove={onMouseMove}
        onPointerDown={onMouseDown}
        onPointerUp={onMouseUp}
        onMouseDown={onRightDown}
        onLostPointerCapture={() => (mouse.current.down = false)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {tagEls}
      {hud.emotes &&
        hud.emotes.split(';').map((row) => {
          const [id, k, a, at] = row.split(',');
          const fid = Number(id);
          const em = k as EmoteId;
          const call = isTeamEmote(em);
          // in duos and squads, ringed as its name tag is: in a teammate's color, red for anyone else's
          const o = m.fighters[fid];
          const side = !o || !focusFighter || m.mode === 'solo' ? '' : o.team === focusFighter.team ? ' is-mate' : ' is-foe';
          return (
            <div
              key={`${id}@${at}`}
              ref={(el) => {
                // (one gone from the page is let go of as the bubbles move, see placeOverlays)
                if (el) bubbles.current.set(fid, el);
              }}
              className={`g-scramble-bubble${call ? ' is-call' : ''}${side}`}
              style={{ visibility: 'hidden', ['--mate' as string]: side === ' is-mate' ? mateColor(m, o) : undefined }}
              role="status"
              aria-label={`${fid === m.me ? 'you' : (m.fighters[fid]?.name ?? '')}: ${emoteText(em, (a || null) as Ammo | null)}`}
            >
              <EmoteIcon k={em} a={(a || null) as Ammo | null} size={call ? 22 : 30} />
              {call && <span>{emoteText(em, (a || null) as Ammo | null)}</span>}
            </div>
          );
        })}
      <div ref={fadeEl} className="g-scramble-fade" aria-hidden="true" />
      {popEls}
      {shell.status !== 'ready' && !shell.compact && (
        <div className={`g-scramble-hud${touchMode ? ' is-touch' : ''}${live ? ' is-online' : ''}`}>
          {hud.deep >= 0 && <div className="g-scramble-underfx" aria-hidden="true" />}
          {hud.outside && <div className="g-scramble-stormfx" aria-hidden="true" />}
          {hud.low && !hud.outside && <div className="g-scramble-lowfx" aria-hidden="true" />}
          <div className="g-scramble-top">
            <span className="g-scramble-pill" aria-label={`${hud.alive} eggs left`}>
              <EggIcon />
              <b>{hud.alive}</b> left
            </span>
            {hud.teams > 0 && (
              <span className="g-scramble-pill is-teams" aria-label={`${hud.teams} teams left${hud.me ? `, ${hud.mine ? 'you are' : 'watching'} number ${hud.me.n} on the team` : ''}`}>
                {hud.me && (
                  // the number and color of the egg we see, as its teammates see them on their markers
                  <em className="g-scramble-num" style={{ ['--mate' as string]: hud.me.color }}>
                    {hud.me.n}
                  </em>
                )}
                <b>{hud.teams}</b> {hud.teams === 1 ? 'team' : 'teams'}
              </span>
            )}
            <span className="g-scramble-pill is-kills" aria-label={`${hud.kills} eliminations`}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <b>{hud.kills}</b>
            </span>
            {hud.scopes > 0 && (
              // every scope carried, the one looked through lit: a click or a tap looks through another (holding it or
              // a right click on the one in use puts it down for a teammate). Underground, those past 2x are dimmed:
              // they see no farther than it down there
              <span className="g-scramble-pill is-gear is-scopes" role="group" aria-label={`Scopes: looking through ${SCOPES[hud.scope]}${hud.deep >= 0 && hud.scope > 1 ? ', which sees no farther than 2x underground' : ''}`}>
                <ScopeIcon size={15} />
                {scopesOf(hud).map((lv) =>
                  hud.mine ? (
                    <button
                      key={lv}
                      type="button"
                      tabIndex={-1}
                      className={[hud.scope === lv ? 'is-on' : '', hud.deep >= 0 && lv > 1 ? 'is-dim' : ''].join(' ').trim() || undefined}
                      aria-label={`Look through the ${SCOPES[lv]} scope`}
                      aria-pressed={hud.scope === lv}
                      {...(lv > 0 && lv === hud.scope ? tapOrDrop('scope', () => {}) : tap((t) => (t.scope = 10 + lv)))}
                    >
                      {SCOPES[lv]}
                    </button>
                  ) : (
                    <b key={lv} className={[hud.scope === lv ? 'is-on' : '', hud.deep >= 0 && lv > 1 ? 'is-dim' : ''].join(' ').trim() || undefined}>
                      {SCOPES[lv]}
                    </b>
                  ),
                )}
                {!touchMode && hud.mine && <kbd>{SCOPE_KEY}</kbd>}
              </span>
            )}
            {hud.pack > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`level ${hud.pack} backpack`}>
                <PackIcon size={15} lv={hud.pack} />
                <b>{hud.pack}</b>
              </span>
            )}
            {hud.helmet > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`${ARMOR_NAMES.helmet[hud.helmet]}, a level ${hud.helmet} helmet`}>
                <ArmorIcon kind="helmet" size={15} lv={hud.helmet} />
                <b>{hud.helmet}</b>
              </span>
            )}
            {hud.vest > 0 && (
              <span className="g-scramble-pill is-gear" aria-label={`${ARMOR_NAMES.vest[hud.vest]}, a level ${hud.vest} vest`}>
                <ArmorIcon kind="vest" size={15} lv={hud.vest} />
                <b>{hud.vest}</b>
              </span>
            )}
            {hud.high > 0 && (
              <span className="g-scramble-pill is-high" role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 3l7 8h-4.5v10h-5V11H5z" fill="currentColor" />
                </svg>
                high ground
              </span>
            )}
            {hud.ghillie && (
              <span className="g-scramble-pill is-gear" aria-label="ghillie suit">
                <GhillieIcon size={15} />
              </span>
            )}
            {hud.deep >= 0 && (
              <span className="g-scramble-pill is-deep" role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M3 5h5v5h5v5h5v5h3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                </svg>
                {m.map.buildings[hud.deep]?.kind === 'cellar' ? 'in a cellar' : 'in a bunker'}
              </span>
            )}
            {hud.hidden && (
              <span className="g-scramble-pill is-hidden" role="status">
                hidden
              </span>
            )}
            {hud.leader && (
              <span className={`g-scramble-pill is-leader${hud.leader.mine ? ' is-mine' : ''}`} aria-label={`kill leader: ${hud.leader.name}, ${hud.leader.kills} eliminations`}>
                <CrownIcon size={15} />
                <b>{hud.leader.kills}</b>
                <span>{hud.leader.name}</span>
              </span>
            )}
            {hud.warm && (
              <span className="g-scramble-pill is-warm" role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1.5-4 .5 1.5 1.5 2 2.5 2 0-3-1-4 0-7z" fill="currentColor" />
                </svg>
                warming up
              </span>
            )}
            {hud.mates && hud.mates.length > 0 && hud.phase !== 'none' && (
              <ul className="g-scramble-team" aria-label="Your team">
                {hud.mates.map((t) => (
                  <li key={t.id} className={t.out ? 'is-out' : t.down ? 'is-down' : undefined} style={{ ['--mate' as string]: t.color }} aria-label={`${t.n}, ${t.name}: ${t.out ? 'out' : t.down ? `knocked down${t.revive >= 0 ? ', being revived' : ''}` : `${t.hp} health, ${t.shield} shield`}${t.far >= 0 ? `, ${t.far} meters off` : ''}`}>
                    <em className="g-scramble-num">{t.n}</em>
                    <span>{t.name}</span>
                    {t.far >= 0 && <small className="g-scramble-far">{t.far}m</small>}
                    {t.out ? (
                      <small>out</small>
                    ) : (
                      <i>
                        <b style={{ width: `${t.hp}%` }} />
                        {!t.down && t.shield > 0 && <em style={{ width: `${t.shield}%` }} />}
                        {t.revive >= 0 && <u style={{ width: `${t.revive * 100}%` }} />}
                      </i>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {touchMode && helpCall}
          </div>
          {hud.storm && <div className={`g-scramble-storm${hud.shrinking ? ' is-moving' : ''}`}>{hud.storm}</div>}
          {!touchMode && helpCall}
          {hud.arrive && (
            <div key={hud.arrive} className="g-scramble-arrive" role="status">
              <small>entering</small>
              <b>{hud.arrive}</b>
            </div>
          )}
          <div
            className="g-scramble-map"
            role="button"
            aria-label={hud.where ? `Island map: you're in ${hud.where}` : 'Island map'}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBigMap((b) => !b);
            }}
          >
            <svg viewBox={under ? underBox : box} aria-hidden="true">
              {islandArt}
              {under && (
                <>
                  <rect x={-HALF - 40} y={-HALF - 40} width={2 * HALF + 80} height={2 * HALF + 80} fill="rgba(8, 7, 6, 0.72)" />
                  <BasementArt map={map} b={under} opened={m.opened} />
                </>
              )}
            </svg>
            {/* the storm and the arrow on a layer of their own, so the island under them isn't drawn again as they move */}
            <svg viewBox={under ? underBox : box} aria-hidden="true" className="is-marks">
              {mapMarks(false, under ? (Math.max(under.w, under.d) + 10) / (2 * HALF + 16) : 1)}
            </svg>
            {hud.where && <span>{hud.where}</span>}
          </div>
          <ol className="g-scramble-feed" aria-live="polite">
            {feed.map((f) => (
              <li key={f.id} className={f.mine ? 'is-mine' : undefined}>
                {f.text}
              </li>
            ))}
          </ol>
          {hud.banner && (
            <div key={hud.banner} className={`g-scramble-banner${/^\d$/.test(hud.banner) ? ' is-count' : ''}${hud.banner.length > 16 ? ' is-note' : ''}`}>
              {hud.banner}
            </div>
          )}
          {hud.out && (
            <div className="g-scramble-out">
              <b>{hud.out}</b>
              {hud.watching && (
                <span>
                  {touchMode ? (
                    <button type="button" className="g-scramble-watch" aria-label="Watch the previous egg" onPointerDown={(e) => { e.preventDefault(); taps.current.watch = -1; }}>
                      ‹
                    </button>
                  ) : (
                    <kbd>←</kbd>
                  )}
                  watching
                  {hud.watchMate && hud.me && (
                    <em className="g-scramble-num" style={{ ['--mate' as string]: hud.me.color }}>
                      {hud.me.n}
                    </em>
                  )}
                  {hud.watching}
                  {hud.teams > 0 && <small>{hud.watchMate ? 'your team' : 'other team'}</small>}
                  {touchMode ? (
                    <button type="button" className="g-scramble-watch" aria-label="Watch the next egg" onPointerDown={(e) => { e.preventDefault(); taps.current.watch = 1; }}>
                      ›
                    </button>
                  ) : (
                    <kbd>→</kbd>
                  )}
                </span>
              )}
              {canLeave() && (
                <button
                  type="button"
                  className="g-scramble-leave"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  // on the click, not the press: the result card comes up where the finger is, and the click a lifted
                  // finger makes would land on its Play Again
                  onClick={(e) => {
                    e.stopPropagation();
                    leave();
                  }}
                >
                  done watching{!touchMode && <kbd>Enter</kbd>}
                </button>
              )}
            </div>
          )}
          {hud.jump && (
            <button type="button" className="g-scramble-jump" {...tap((t) => (t.jump = true))}>
              jump{!touchMode && <kbd>Space</kbd>}
            </button>
          )}
          {hud.down && (
            <div className="g-scramble-down" role="status">
              <b>{hud.down.revive >= 0 ? `${hud.down.by} ${hud.down.by === 'you' ? 'are' : 'is'} reviving ${hud.mine ? 'you' : hud.watching ?? ''}` : hud.mine ? 'knocked down: crawl to your team' : `${hud.watching ?? 'they'} ${hud.watching ? 'is' : 'are'} knocked down`}</b>
              <i className={hud.down.revive >= 0 ? 'is-revive' : undefined}>
                <b style={{ width: `${(hud.down.revive >= 0 ? hud.down.revive : hud.down.left) * 100}%` }} />
              </i>
            </div>
          )}
          {hud.busy >= 0 && (
            <div className="g-scramble-busy" role="status">
              <span>{hud.busyText}</span>
              <i ref={busyBar} style={{ width: '0%' }} />
            </div>
          )}
          {hud.prompt && hud.phase === 'ground' && (
            <button type="button" className={`g-scramble-prompt${hud.reviving ? ' is-revive' : ''}${hud.car ? ' is-ride' : ''}`} style={hud.reviveColor ? { ['--mate' as string]: hud.reviveColor } : undefined} {...(hud.reviving ? holdDown : tap((t) => (t.interact = true)))}>
              {!touchMode && <kbd>E</kbd>}
              {hud.prompt}
            </button>
          )}
          {hud.phase === 'ground' && hud.mats && hud.mine && !hud.car && (!touchMode || buildMenu) && (
            <div className="g-scramble-build" role="group" aria-label="Building">
              <div className="g-scramble-matbar">
                {MATS.map((k, i) => (
                  <button
                    key={k}
                    type="button"
                    tabIndex={-1}
                    className={`${hud.mat === i ? 'is-on' : ''}${hud.mats![i] < PIECE_COST ? ' is-none' : ''}${hud.mats![i] >= MAT_MAX ? ' is-full' : ''}`}
                    aria-label={`${hud.mats![i]} ${k}`}
                    aria-pressed={hud.mat === i}
                    {...tapOrDrop(k, (t) => (t.mat = 10 + i))}
                  >
                    <MatIcon mat={k} size={18} />
                    <b>{hud.mats![i]}</b>
                  </button>
                ))}
                {!touchMode && <kbd>{MAT_KEY}</kbd>}
              </div>
              <div className="g-scramble-pieces">
                {PLANS.map((k) => (
                  <button key={k} type="button" tabIndex={-1} className={hud.piece === k ? 'is-on' : undefined} aria-label={`Build a ${PIECE_NAMES[k]}`} aria-pressed={hud.piece === k} {...tap((t) => (t.piece = k))}>
                    <PieceIcon k={k} size={touchMode ? 26 : 24} />
                    {!touchMode && <kbd>{PIECE_KEYS[k]}</kbd>}
                  </button>
                ))}
                <button type="button" tabIndex={-1} className={`is-edit${hud.edit ? '' : ' is-none'}`} aria-label="Edit the wall of yours in front" {...tap((t) => (t.edit = true))}>
                  <EditIcon size={touchMode ? 26 : 24} />
                  {!touchMode && <kbd>{EDIT_KEY}</kbd>}
                </button>
              </div>
              {!touchMode && (
                <small>
                  <kbd>Space</kbd> builds the {PIECE_NAMES[hud.piece]}, twice quickly boxes you in
                </small>
              )}
            </div>
          )}
          {hud.phase !== 'none' && hud.phase !== 'bus' && (
            <div className="g-scramble-bottom">
              <div className="g-scramble-bars" aria-label={`${hud.hp} health, ${hud.shield} shield${hud.boost ? `, ${hud.boost} boost` : ''}`}>
                {hud.car && (
                  // the car: who sits where (the wheel first), what it is, and what it has left
                  <div className={`g-scramble-car${hud.car.burning ? ' is-fire' : ''}`} role="status" aria-label={`${hud.car.seat === 0 ? 'Driving' : 'Riding in'} the ${hud.car.name}, ${hud.car.hp}% left${hud.car.burning ? ', on fire' : ''}`}>
                    <span className="g-scramble-seats" aria-hidden="true">
                      {hud.car.seats.map((c, k) => (
                        <i key={k} className={[k === 0 ? 'is-wheel' : '', c === 'you' ? 'is-you' : c ? 'is-taken' : ''].join(' ').trim() || undefined} style={c && c !== 'you' ? { ['--seat' as string]: c } : undefined} />
                      ))}
                    </span>
                    <b>{hud.car.burning ? 'on fire: get out!' : hud.car.name}</b>
                    <div className="g-scramble-bar is-car">
                      <b style={{ width: `${hud.car.hp}%` }} />
                      <i style={{ width: `${hud.car.hp}%` }} />
                      <span>{hud.car.hp}</span>
                    </div>
                  </div>
                )}
                {hud.boost > 0 && (
                  <div className="g-scramble-bar is-boost">
                    <i style={{ width: `${hud.boost}%` }} />
                  </div>
                )}
                <div className="g-scramble-bar is-shield">
                  <b style={{ width: `${hud.shield}%` }} />
                  <i style={{ width: `${hud.shield}%` }} />
                  <span>{hud.shield}</span>
                </div>
                <div className={`g-scramble-bar is-hp${hud.hp <= 30 ? ' is-low' : ''}`}>
                  <b style={{ width: `${hud.hp}%` }} />
                  <i style={{ width: `${hud.hp}%` }} />
                  <span>{hud.hp}</span>
                </div>
              </div>
              <div className="g-scramble-slots" role="group" aria-label="Weapons">
                {[0, 1, SLOT_MELEE, SLOT_THROW].map((i) => {
                  const g = i < 2 ? hud.slots[i as 0 | 1] : null;
                  const on = hud.slot === i;
                  const empty = (i < 2 && !g) || (i === SLOT_THROW && !hud.toss);
                  const label = i < 2 ? (g ? WEAPONS[g.w].name : 'Empty slot') : i === SLOT_MELEE ? MELEE[hud.melee].name : hud.toss ? (hud.toss.n < 0 ? THROWS[hud.toss.w].name : `${hud.toss.n} ${hud.toss.n === 1 ? THROWS[hud.toss.w].name : THROWS[hud.toss.w].plural}`) : 'Nothing to throw';
                  return (
                    <button
                      key={i}
                      type="button"
                      tabIndex={-1}
                      className={`g-scramble-slot${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
                      style={g ? { ['--rarity' as string]: RARITY_COLORS[g.r] } : undefined}
                      aria-label={label}
                      aria-pressed={on}
                      {...tapOrDrop(i, (t) => (t.slot = i))}
                    >
                      {slotLabel(i) && <small>{slotLabel(i)}</small>}
                      {i < 2 && g && <WeaponIcon w={g.w} size={34} />}
                      {i === SLOT_MELEE && <WeaponIcon w={hud.melee} size={30} />}
                      {i === SLOT_THROW && hud.toss && (
                        <>
                          <WeaponIcon w={hud.toss.w} size={28} />
                          {hud.toss.n >= 0 && <b className="g-scramble-count">{hud.toss.n}</b>}
                          {hud.toss.kinds > 1 && <i className="g-scramble-more" aria-hidden="true" />}
                        </>
                      )}
                      {on && i < 2 && g && hud.mag >= 0 && (
                        <em>
                          {hud.mag}
                          {hud.ammo && <span>/{hud.reserve}</span>}
                        </em>
                      )}
                    </button>
                  );
                })}
              </div>
              {hud.items && (
                <div className="g-scramble-mats">
                  {USE_IDS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      tabIndex={-1}
                      className={hud.items![w] ? undefined : 'is-none'}
                      title={USES[w].name}
                      aria-label={`${hud.items![w]} ${hud.items![w] === 1 ? USES[w].name : USES[w].plural}`}
                      {...tapOrDrop(w, (t) => (t.use = w))}
                    >
                      <UseIcon w={w} size={20} />
                      {hud.items![w]}
                      {!touchMode && <kbd>{USE_KEYS[w]}</kbd>}
                    </button>
                  ))}
                  {hud.ammo && (
                    <button type="button" tabIndex={-1} className="g-scramble-ammo" title="Ammo" aria-label={`${hud.reserve} ammo`} {...tapOrDrop(hud.ammo, () => {})}>
                      <AmmoIcon a={hud.ammo} size={20} />
                      {hud.reserve}
                      <small>/{ammoCap(hud.ammo, hud.pack)}</small>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {bigMap && shell.status !== 'ready' && (
        <div
          className="g-scramble-bigmap"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // in duos and squads, a tap on the island pings that spot for the team (the button closes it)
            const svg = (e.target as Element).closest?.('svg');
            const me = m.fighters[m.me];
            const pt = svg instanceof SVGSVGElement && pingable(me) ? svg.getScreenCTM()?.inverse() : null;
            if (pt) {
              const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(pt);
              taps.current.ping = true;
              taps.current.pingAt = { x: at.x, z: at.y };
              return;
            }
            setBigMap(false);
          }}
        >
          <svg viewBox={box} role="img" aria-label="Island map">
            {islandArt}
            <PlaceNames map={map} />
            {mapMarks(true)}
            {under && focusFighter && (
              // down in a basement: where it is, and its rooms close up in the corner across the island from it
              <>
                <rect x={under.x - DEEP - under.w / 2 - 2} y={under.z - under.d / 2 - 2} width={under.w + 4} height={under.d + 4} fill="none" stroke="#f2c230" strokeWidth="1.6" strokeDasharray="4 3" />
                <rect x={inset.x - 77} y={inset.z - 77} width={154} height={154} rx="4" fill="#0f0c0a" stroke="#f2c230" strokeWidth="1.6" />
                <g transform={`translate(${inset.x} ${inset.z}) scale(${(150 / (Math.max(under.w, under.d) + 10)).toFixed(3)}) translate(${(-(under.x - DEEP)).toFixed(1)} ${(-under.z).toFixed(1)})`}>
                  <BasementArt map={map} b={under} opened={m.opened} />
                  <g transform={`translate(${topX(focusFighter.x).toFixed(2)} ${focusFighter.z.toFixed(2)}) rotate(${((-focusFighter.aim * 180) / Math.PI + 180).toFixed(0)}) scale(0.12)`}>
                    <path d="M0 -13L9.5 9.5L0 4.6L-9.5 9.5Z" fill={focusFighter.color} stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
                  </g>
                </g>
              </>
            )}
          </svg>
          <small>{pingable(m.fighters[m.me]) ? (touchMode ? 'tap the island to ping it for your team, or here to close' : 'click the island to ping it for your team, M or here to close') : touchMode ? 'tap to close' : 'M or click to close'}</small>
        </div>
      )}
      {wheel && (
        <div
          className={`g-scramble-wheelbg${wheel.by === 'touch' ? ' is-touch' : ''}`}
          onPointerDown={(e) => {
            // a tap on a slice says it, anywhere else puts the wheel away
            if (wheel.by !== 'touch') return;
            e.preventDefault();
            e.stopPropagation();
            const k = sliceUnder(e.clientX, e.clientY, true);
            pickSlice(k);
            closeWheel(!!k);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <EmoteWheel wheel={wheel} size={wheelSize(size.w, size.h, m.mode !== 'solo')} teams={m.mode !== 'solo'} pick={wheelPick} ammo={m.fighters[m.me] ? ammoAsk(m.fighters[m.me]) : null} wait={!!m.fighters[m.me] && !emoteReady(m.fighters[m.me], m.clock)} touch={wheel.by === 'touch'} />
        </div>
      )}
      {touchMode && playing && !net.current.over && hud.mine && (hud.phase === 'ground' || hud.phase === 'drop') && (
        <button type="button" className={`g-scramble-emotebtn${hud.mates ? ' is-low' : ''}${wheel ? ' is-on' : ''}`} aria-label={hud.mates ? 'Emotes and calls for your team' : 'Emotes'} aria-pressed={!!wheel} {...emoteButton}>
          <EmoteIcon k="happy" size={24} />
        </button>
      )}
      {touchMode && playing && !net.current.over && hud.mine && hud.mates && (hud.phase === 'ground' || hud.phase === 'drop') && (
        <button type="button" className="g-scramble-pingbtn" aria-label="Ping where you aim for your team" {...tap((t) => (t.ping = true))}>
          <PingIcon size={22} />
        </button>
      )}
      {touchMode && playing && !net.current.over && (
        <div className="g-scramble-touch">
          <div className="g-scramble-zone is-move" {...stick('move')}>
            {sticks.move && moveStick.current && (
              <StickArt
                s={moveStick.current}
                at={(el) => {
                  stickEls.current.move = el;
                }}
              />
            )}
          </div>
          <div className="g-scramble-zone is-aim" {...stick('aim')}>
            {sticks.aim && aimStick.current && (
              <StickArt
                s={aimStick.current}
                at={(el) => {
                  stickEls.current.aim = el;
                }}
              />
            )}
          </div>
          {hud.phase === 'ground' && hud.mine && hud.car?.seat === 0 && (
            <div className="g-scramble-buttons is-drive">
              <button type="button" tabIndex={-1} aria-label="Handbrake (hold)" {...brakeDown}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
                  <path d="M12 7.5v6M12 16.5v0.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
                <span>brake</span>
              </button>
            </div>
          )}
          {hud.phase === 'ground' && hud.mine && hud.car?.seat !== 0 && (
            <div className="g-scramble-buttons">
              {!hud.car && (
                // (nothing builds out of a car)
                <>
                  <button type="button" tabIndex={-1} aria-label={`Build a ${PIECE_NAMES[hud.piece]} (twice quickly: box up)`} className={hud.mats && hud.mats.some((n) => n >= PIECE_COST) ? undefined : 'is-none'} {...tap((t) => (t.build = true))}>
                    <PieceIcon k={hud.piece} size={24} />
                    <span>{PIECE_NAMES[hud.piece] === 'box up' ? 'box' : PIECE_NAMES[hud.piece]}</span>
                  </button>
                  <button type="button" tabIndex={-1} aria-label={buildMenu ? 'Close the build menu' : 'Open the build menu'} aria-pressed={buildMenu} className={buildMenu ? 'is-on' : undefined} {...tap(() => setBuildMenu((b) => !b))}>
                    <MatIcon mat={MATS[hud.mat]} size={20} />
                    <span>{hud.mats ? hud.mats[hud.mat] : 0}</span>
                  </button>
                </>
              )}
              <button type="button" tabIndex={-1} aria-label="Reload" {...tap((t) => (t.reload = true))}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>reload</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Heal" className={heals ? undefined : 'is-none'} {...tap((t) => (t.use = 'bestHeal'))}>
                <UseIcon w={hud.items && !hud.items.bandage ? (hud.items.medkit ? 'medkit' : hud.items.tart ? 'tart' : 'bandage') : 'bandage'} size={22} />
                <span>{heals}</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Top up shield" className={shields ? undefined : 'is-none'} {...tap((t) => (t.use = 'bestShield'))}>
                <UseIcon w={hud.items && !hud.items.mini ? (hud.items.smoothie ? 'smoothie' : hud.items.shield ? 'shield' : 'mini') : 'mini'} size={22} />
                <span>{shields}</span>
              </button>
              <button type="button" tabIndex={-1} aria-label="Drink a coffee" className={hud.items?.coffee ? undefined : 'is-none'} {...tap((t) => (t.use = 'coffee'))}>
                <UseIcon w="coffee" size={22} />
                <span>{hud.items?.coffee ?? 0}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The stairway near an egg on its level (within a few steps of the end it walks onto) and what it leads to, for the
 * name over it, or null.
 */
function nearStairs(m: Match, f: Fighter) {
  const deep = isDeep(f.x);
  const x = topX(f.x);
  // (below, only the basement's own: another's may lie under the ground nearby)
  const u = deep ? basementAt(m.map, f.x, f.z) : -1;
  for (const st of m.map.stairs) {
    if (Math.hypot(st.x - x, st.z - f.z) > 6 || (deep && st.u !== u)) continue;
    const kind = m.map.buildings[st.u]?.kind;
    return { x: st.x + (deep ? DEEP : 0), z: st.z, text: deep ? 'stairs up' : kind === 'cellar' ? 'stairs down to a cellar' : 'stairs down to a bunker' };
  }
  return null;
}

/**
 * The emote wheel: a ring of faces round the middle and (in duos and squads) one of the team's calls round it, the slice
 * picked lit, and what it says (or to wait, after a few too quickly) under it.
 */
function EmoteWheel({ wheel, size, teams, pick, ammo, wait, touch }: { wheel: Wheel; size: ReturnType<typeof wheelSize>; teams: boolean; pick: EmoteId | null; ammo: Ammo | null; wait: boolean; touch: boolean }) {
  const o = size.out;
  const rings: [readonly EmoteId[], number, number][] = teams
    ? [
        [FACE_EMOTES, size.in, size.mid],
        [TEAM_EMOTES, size.mid, o],
      ]
    : [[FACE_EMOTES, size.in, o]];
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const ammoText = ammo === 'rockets' ? 'eggs' : ammo === 'shells' ? 'shells' : ammo ? `${ammo} ammo` : 'ammo';
  return (
    <div className="g-scramble-wheel" style={{ left: wheel.x - o, top: wheel.y - o, width: 2 * o, height: 2 * o }} aria-hidden="true">
      <svg viewBox={`${-o} ${-o} ${2 * o} ${2 * o}`} width={2 * o} height={2 * o}>
        {rings.map(([ring, r0, r1]) =>
          ring.map((k, i) => {
            const step = (2 * Math.PI) / ring.length;
            const [a0, a1, am] = [(i - 0.5) * step, (i + 0.5) * step, i * step];
            const label = ring === TEAM_EMOTES ? (k === 'ammo' ? ammoText : (SLICE_TEXT[k] ?? '')) : '';
            const ic = label ? 22 : Math.min(30, (r1 - r0) * 0.6);
            const mid = (r0 + r1) / 2;
            const [cx, cy] = [Math.sin(am) * mid, -Math.cos(am) * mid];
            return (
              <g key={k} className={pick === k ? 'is-on' : undefined}>
                <path className="is-slice" d={`M${pt(r0, a0)}L${pt(r1, a0)}A${r1} ${r1} 0 0 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z`} />
                <g transform={`translate(${(cx - ic / 2).toFixed(1)} ${(cy - ic / 2 - (label ? 6 : 0)).toFixed(1)})`}>
                  <EmoteIcon k={k} a={ammo} size={ic} />
                </g>
                {label && (
                  <text x={cx.toFixed(1)} y={(cy + ic / 2 + 4).toFixed(1)}>
                    {label}
                  </text>
                )}
              </g>
            );
          }),
        )}
        <circle r={size.in - 3} className="is-middle" />
        <path d="M-5 -5L5 5M5 -5L-5 5" className="is-cancel" />
      </svg>
      <b className={wait ? 'is-wait' : undefined}>{pick ? emoteText(pick, ammo) : wait ? 'wait a moment' : touch ? 'tap one, or anywhere else to close' : 'let go on one to say it'}</b>
    </div>
  );
}

/** A thumbstick: the base where the thumb came down, the knob moved on the DOM (see drawStick). */
function StickArt({ s, at }: { s: Stick; at: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={at} className="g-scramble-stick" style={{ left: s.ox, top: s.oy }} aria-hidden="true">
      <i />
    </div>
  );
}
