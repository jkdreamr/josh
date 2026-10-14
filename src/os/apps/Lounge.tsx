import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { getAppGame, roomApp } from '../arcade/apps';
import { savedName, saveName } from '../arcade/kit/leaderboard';
import { useOpenRooms } from '../arcade/kit/online';
import { openRoomDetail, openRoomLine, type OpenRoom } from '../arcade/kit/online-core';
import {
  CHANNELS,
  cleanLine,
  DEFAULT_CHANNEL,
  INVITE_CHANNEL,
  isChannel,
  lineHash,
  LoungeLink,
  memberList,
  mentions,
  NAME_MAX,
  newestIds,
  TEXT_MAX,
  typingLine,
  unreadCounts,
  validLine,
  type ChannelId,
  type LoungeInvite,
  type LoungeMember,
  type LoungeMessage,
  type LoungeReject,
  type LoungeState,
  type Presence,
  type ReadMarks,
} from '../arcade/lounge';
import { getMeta } from '../arcade/manifest';
import { usePlaying, type Playing } from '../arcade/playing';
import { setBadge } from '../badges';
import { dayLabel } from '../chat-core';
import { useMedia } from '../hooks';
import { useOS, useWin, type AppProps, type OSApi } from '../types';
import './Lounge.css';

/** Messages from one name this close together share one header. */
const GROUP_MS = 5 * 60_000;
/** A shared room older than this, and not in Open Rooms, has most likely closed. */
const INVITE_FRESH_MS = 60 * 60_000;
/** Widths where the channels get a sidebar, and where the member list gets a column of its own. */
const WIDE = 700;
const ROOMY = 980;
/** Avatar colors, all readable with a white initial. A prime count spreads names out more evenly. */
const COLORS = ['#1a73e8', '#c5221f', '#137333', '#8430ce', '#b06000', '#007b83', '#b80672', '#3949ab', '#795548', '#827717', '#455a64'];
const NOTICES: Record<LoungeReject['error'] | 'waiting', string> = {
  name: 'Pick a name first, 1 to 16 characters.',
  text: 'Messages can be up to 280 characters.',
  channel: 'That channel is gone. Reload to see the new ones.',
  invite: "That room can't be shared here.",
  slow: 'Slow down a little. Try again in a few seconds.',
  repeat: 'You just said that.',
  offline: "That didn't send. The connection dropped.",
  waiting: 'Still connecting. Try again in a moment.',
};
const READ_KEY = 'lounge:read';
const CHANNEL_KEY = 'lounge:channel';
/** Whether #find-a-game's Open Rooms list is folded away. */
const ROOMS_KEY = 'lounge:rooms';
const NO_TYPING: LoungeState['typing'] = {};

const nameColor = (name: string) => COLORS[lineHash(name.toLowerCase()) % COLORS.length];
const initial = (name: string) => (Array.from(name)[0] ?? '?').toUpperCase();
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const topicOf = (ch: ChannelId) => CHANNELS.find((channel) => channel.id === ch)?.topic ?? '';
/** Typing in the Lounge never reaches the OS shortcuts or a game in another window; Cmd and Ctrl combos (Cmd+K) still do. */
const keepKeys = (e: KeyboardEvent) => {
  if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
};

function loadRead(): ReadMarks | null {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return Object.fromEntries(Object.entries(raw).filter(([ch, id]) => isChannel(ch) && Number.isSafeInteger(id))) as ReadMarks;
  } catch {
    return null;
  }
}

function saveRead(marks: ReadMarks) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(marks));
  } catch {
    /* ignore */
  }
}

function loadChannel(): ChannelId {
  try {
    const ch = localStorage.getItem(CHANNEL_KEY);
    return isChannel(ch) ? ch : DEFAULT_CHANNEL;
  } catch {
    return DEFAULT_CHANNEL;
  }
}

function saveChannel(ch: ChannelId) {
  try {
    localStorage.setItem(CHANNEL_KEY, ch);
  } catch {
    /* ignore */
  }
}

function loadRoomsOpen(): boolean {
  try {
    return localStorage.getItem(ROOMS_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function saveRoomsOpen(open: boolean) {
  try {
    if (open) localStorage.removeItem(ROOMS_KEY);
    else localStorage.setItem(ROOMS_KEY, 'closed');
  } catch {
    /* ignore */
  }
}

type Look = { title: string; accent: string; glyph: string };

/** How a game shows in the Lounge: its title, color and icon, from the arcade or the desktop app that plays it. */
function gameLook(id: string): Look | null {
  const meta = getMeta(id);
  if (meta) return { title: meta.title, accent: meta.accent, glyph: meta.glyph };
  const app = getAppGame(id);
  return app ? { title: app.title, accent: app.accent ?? '#636366', glyph: app.glyph ?? 'M5 12h14M12 5v14' } : null;
}

/** Opens a shared room: arcade games in the Arcade, the others (Go, Omok, Badminton, Cox Box) in their own app. */
function joinRoom(os: OSApi, invite: LoungeInvite) {
  if (getMeta(invite.game) && invite.game !== 'coxbox') return os.open('arcade', { play: invite.game, room: invite.code });
  const { app, args } = roomApp(invite.game, invite.code);
  os.open(app, args);
}

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};

function usePageVisible() {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden', () => true);
}

/** The Lounge's connection, held while the app is open (minimized included, so unread counts keep up). */
function useLounge(presence: Presence, onReject: (reject: LoungeReject) => void) {
  const [state, setState] = useState<LoungeState>({ status: 'connecting', messages: [], members: null, online: null, you: null, typing: NO_TYPING });
  const link = useRef<LoungeLink | null>(null);
  const rejected = useRef(onReject);
  rejected.current = onReject;
  const first = useRef(presence);
  useEffect(() => {
    const lounge = new LoungeLink(undefined, first.current);
    link.current = lounge;
    setState(lounge.state);
    const offChange = lounge.onChange(setState);
    const offReject = lounge.onReject((reject) => rejected.current(reject));
    return () => {
      offChange();
      offReject();
      lounge.close();
      link.current = null;
    };
  }, []);
  const { name, game, room } = presence;
  useEffect(() => {
    link.current?.presence({ ...(name ? { name } : {}), ...(game ? { game } : {}), ...(room ? { room } : {}) });
  }, [name, game, room]);
  const say = useCallback((ch: ChannelId, who: string, text: string, invite?: LoungeInvite) => link.current?.say(ch, who, text, invite) ?? false, []);
  const markTyping = useCallback((ch: ChannelId) => link.current?.typing(ch), []);
  const retry = useCallback(() => link.current?.retry(), []);
  return { ...state, say, markTyping, retry };
}

/** A phone keyboard covers the bottom of the screen: while typing there, lift the box above it, like Cox Box does. */
function useKeyboardLift(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el || !active) return;
    const fit = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Only as far as the keyboard reaches past the bottom of the Lounge (the padding inside it doesn't move it).
      const below = Math.max(0, window.innerHeight - el.getBoundingClientRect().bottom);
      el.style.setProperty('--lounge-keyboard', covered > 80 ? `${Math.min(Math.max(0, covered - below), el.clientHeight * 0.6)}px` : '0px');
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.removeProperty('--lounge-keyboard');
    };
  }, [ref, active]);
}

function Avatar({ name }: { name?: string }) {
  return (
    <span className="lounge-avatar" style={name ? { background: nameColor(name) } : undefined} aria-hidden="true">
      {name ? initial(name) : '?'}
    </span>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const PEOPLE = 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3 3 0 0 1 0 5.6';
const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4';
const SEND = 'M5 12h13M12 5l7 7-7 7';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const CHEVRON = 'M6 9l6 6 6-6';

/** #find-a-game's live list: every public room where someone is waiting, with Join (your own room says so instead). */
function OpenRoomsPanel({ rooms, mine, onJoin }: { rooms: OpenRoom[] | null; mine?: string; onJoin: (invite: LoungeInvite) => void }) {
  const [open, setOpen] = useState(loadRoomsOpen);
  const count = rooms?.length ?? 0;
  const toggle = () => {
    setOpen(!open);
    saveRoomsOpen(!open);
  };
  return (
    <section className={`lounge-rooms ${open ? 'is-open' : ''}`} aria-label="Open Rooms">
      <button type="button" className="lounge-rooms-head" aria-expanded={open} onClick={toggle}>
        <i className={count ? 'is-live' : undefined} aria-hidden="true" />
        <span>Open Rooms</span>
        {rooms && <b>{count}</b>}
        <Glyph d={CHEVRON} />
      </button>
      {open &&
        (rooms === null ? (
          <p className="lounge-rooms-note">Looking for rooms…</p>
        ) : count === 0 ? (
          <p className="lounge-rooms-note">Nobody's waiting right now. Make a room public from Play Online in any game and it shows up here.</p>
        ) : (
          <ul className="lounge-room-list">
            {rooms.map((room) => {
              const look = gameLook(room.game);
              const title = look?.title ?? room.game;
              return (
                <li key={room.code} className="lounge-room" style={{ ['--accent' as string]: look?.accent ?? '#636366' }}>
                  <span className="lounge-invite-icon">{look && <Glyph d={look.glyph} />}</span>
                  <span className="lounge-room-text">
                    <b>
                      {title} <small>{room.host}'s room</small>
                    </b>
                    <em>{openRoomDetail(room)}</em>
                  </span>
                  {room.code === mine ? (
                    <span className="lounge-room-yours">Your Room</span>
                  ) : (
                    <button type="button" className="lounge-join is-small" aria-label={`Join ${room.host}'s ${title} room`} onClick={() => onJoin({ game: room.game, code: room.code })}>
                      Join
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

/** A room shared in a message: the game, whether it's still open (when Open Rooms knows), and Join. */
function InviteCard({ invite, at, now, rooms, onJoin }: { invite: LoungeInvite; at: number; now: number; rooms: OpenRoom[] | null; onJoin: (invite: LoungeInvite) => void }) {
  const look = gameLook(invite.game);
  const open = rooms?.find((room) => room.code === invite.code && room.game === invite.game) ?? null;
  const fresh = now - at < INVITE_FRESH_MS;
  const title = look?.title ?? invite.game;
  return (
    <div className={`lounge-invite ${open || fresh ? '' : 'is-stale'}`} style={{ ['--accent' as string]: look?.accent ?? '#636366' }}>
      <span className="lounge-invite-icon">{look && <Glyph d={look.glyph} />}</span>
      <span className="lounge-invite-text">
        <b>{title}</b>
        <em>{open ? `Room ${invite.code} · ${openRoomLine(open)}` : fresh ? `Room ${invite.code}` : 'This room has probably closed'}</em>
      </span>
      {(open || fresh) && (
        <button type="button" className="lounge-join" aria-label={`Join ${title} room ${invite.code}`} onClick={() => onJoin(invite)}>
          Join
        </button>
      )}
    </div>
  );
}

type ListProps = {
  messages: LoungeMessage[];
  me: string;
  /** Messages after this id are new since the channel was last read: a divider goes above the first. */
  divider: number | null;
  rooms: OpenRoom[] | null;
  listRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onJoin: (invite: LoungeInvite) => void;
};

/** A channel's messages in order, with day headings, a New divider, and one header per run of messages from the same name. */
const MessageList = memo(function MessageList({ messages, me, divider, rooms, listRef, onScroll, onJoin }: ListProps) {
  const now = Date.now();
  const firstNew = divider === null ? -1 : messages.findIndex((m) => m.id > divider);
  return (
    <div className="lounge-list" ref={listRef} onScroll={onScroll} role="log" aria-label="Messages">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const day = dayLabel(m.t, now);
        const newDay = !prev || dayLabel(prev.t, now) !== day;
        const isNew = i === firstNew;
        const first = newDay || isNew || prev.name !== m.name || m.t - prev.t > GROUP_MS;
        const mentioned = !!me && mentions(m.text, me);
        const at = new Date(m.t).toISOString();
        return (
          <Fragment key={m.id}>
            {newDay && (
              <p className="lounge-day">
                <span>{day}</span>
              </p>
            )}
            {isNew && (
              <p className="lounge-new">
                <span>New</span>
              </p>
            )}
            <div className={['lounge-msg', first ? 'is-first' : '', mentioned ? 'is-mention' : ''].join(' ')}>
              {first ? (
                <>
                  <Avatar name={m.name} />
                  <div className="lounge-meta">
                    <b style={{ ['--name' as string]: nameColor(m.name) }}>{m.name}</b>
                    <time dateTime={at}>{clock(m.t)}</time>
                  </div>
                </>
              ) : (
                <time className="lounge-gutter" dateTime={at} aria-hidden="true">
                  {clock(m.t).replace(/\s?[AP]M$/, '')}
                </time>
              )}
              <p className="lounge-text" dir="auto">
                {!first && <span className="lounge-sr">{m.name}: </span>}
                {m.text}
              </p>
              {m.invite && <InviteCard invite={m.invite} at={m.t} now={now} rooms={rooms} onJoin={onJoin} />}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
});

/** Who's here: joinable rooms first, then who's playing, then everyone else, and how many more are browsing without a name. */
function MemberRows({ members, online, you, onJoin }: { members: LoungeMember[] | null; online: number | null; you: string | null; onJoin: (invite: LoungeInvite) => void }) {
  const list = useMemo(() => (members ? memberList(members, you) : null), [members, you]);
  if (!list) return <p className="lounge-guests">{online === null ? 'Connecting…' : online === 1 ? 'Just you here' : `${online} here now`}</p>;
  return (
    <>
      <h3 className="lounge-members-head">Here · {list.named.length + list.guests}</h3>
      <ul className="lounge-member-list">
        {list.named.map((m) => {
          const look = m.game ? gameLook(m.game) : null;
          return (
            <li key={m.id} className="lounge-member">
              <Avatar name={m.name} />
              <span className="lounge-member-text">
                <b>
                  {m.name}
                  {m.you && <small> (you)</small>}
                </b>
                {look && <em>Playing {look.title}</em>}
              </span>
              {m.room && look && !m.you && (
                <button type="button" className="lounge-join is-small" aria-label={`Join ${m.name}'s ${look.title} room`} onClick={() => onJoin({ game: m.game!, code: m.room! })}>
                  Join
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {list.guests > 0 && <p className="lounge-guests">{list.guests === 1 ? '1 more browsing' : `${list.guests} more browsing`}</p>}
    </>
  );
}

type UserBarProps = {
  name: string;
  playing: Playing | null;
  editing: boolean;
  draft: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
};

/** You: your name (to change), and what you're playing as everyone else sees it. */
function UserBar({ name, playing, editing, draft, inputRef, onDraft, onEdit, onSave, onCancel }: UserBarProps) {
  const named = validLine(name, NAME_MAX);
  const look = playing ? gameLook(playing.game) : null;
  return (
    <div className="lounge-user">
      <Avatar name={named ? name : undefined} />
      {editing ? (
        <form
          className="lounge-user-edit"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={NAME_MAX}
            aria-label="Your Name"
            placeholder="Your Name"
            autoComplete="nickname"
            spellCheck={false}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              keepKeys(e);
              if (e.key === 'Escape') onCancel();
            }}
          />
          <button type="submit" disabled={!validLine(draft, NAME_MAX)}>
            Save
          </button>
        </form>
      ) : (
        <>
          <span className="lounge-user-text">
            <b>{named ? name : 'No name yet'}</b>
            <em>{look ? `Playing ${look.title}` : 'In the Lounge'}</em>
          </span>
          <button type="button" className="lounge-icon-btn" aria-label={named ? 'Change Your Name' : 'Pick a Name'} title={named ? 'Change your name' : 'Pick a name'} onClick={onEdit}>
            <Glyph d={PENCIL} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The Lounge: the arcade's global chat as an app of its own, to keep open next to a game. Channels, who's here and what
 * they're playing, rooms shared with a Join button, and unread counts on the Dock while you play. Everything is plain text.
 */
export default function Lounge({ args }: AppProps) {
  const os = useOS();
  const win = useWin();
  const playing = usePlaying();
  const pageVisible = usePageVisible();
  const [name, setName] = useState(() => savedName());
  const [nameDraft, setNameDraft] = useState(() => savedName());
  const [editingName, setEditingName] = useState(false);
  const [channel, setChannel] = useState<ChannelId>(() => (args.invite ? INVITE_CHANNEL : loadChannel()));
  const [draft, setDraft] = useState('');
  const [invite, setInvite] = useState<LoungeInvite | null>(null);
  const [notice, setNotice] = useState('');
  const [read, setRead] = useState<ReadMarks | null>(() => loadRead());
  const [divider, setDivider] = useState<number | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [showMembers, setShowMembers] = useState(false);
  const [typingHere, setTypingHere] = useState(false);
  const [width, setWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  /** Whether the list is scrolled to the newest message, so new ones scroll into view. */
  const stuck = useRef(true);
  const newestId = useRef(0);
  const coarse = useMedia('(pointer: coarse)');
  const named = validLine(name, NAME_MAX);
  const wide = width >= WIDE;
  const roomy = width >= ROOMY;

  const presence = useMemo<Presence>(
    () => ({ ...(named ? { name: cleanLine(name) } : {}), ...(playing ? { game: playing.game, ...(playing.room ? { room: playing.room } : {}) } : {}) }),
    [named, name, playing],
  );
  const lounge = useLounge(presence, (reject) => {
    if (reject.text) setDraft((d) => d || reject.text);
    if (reject.invite) setInvite((held) => held ?? reject.invite ?? null);
    setNotice(NOTICES[reject.error]);
    if (reject.error === 'name') {
      setEditingName(true);
      // On a narrow Lounge your name is in the member list.
      if (!wide) setShowMembers(true);
    }
  });
  const { messages, members, online, you, status, typing } = lounge;
  // A Worker from before channels only has #general.
  const legacy = status === 'live' && members === null;
  const view: ChannelId = legacy ? DEFAULT_CHANNEL : channel;
  const shownChannels: readonly (typeof CHANNELS)[number][] = legacy ? CHANNELS.filter((c) => c.id === DEFAULT_CHANNEL) : CHANNELS;
  const channelMessages = useMemo(() => messages.filter((m) => m.ch === view), [messages, view]);
  const marks = read ?? newestIds(messages);
  const unread = useMemo(() => unreadCounts(messages, marks), [messages, marks]);
  const looking = win.active && !win.min && pageVisible && atBottom && status === 'live';
  const total = shownChannels.reduce((sum, c) => sum + (looking && c.id === view ? 0 : unread[c.id]), 0);

  // Open rooms: #find-a-game lists them, and shared rooms say whether they're still open. Asked only while on screen.
  const roomsShown = view === INVITE_CHANNEL;
  const recentInvites = channelMessages.some((m) => m.invite && Date.now() - m.t < INVITE_FRESH_MS);
  const rooms = useOpenRooms(undefined, win.active ? 6000 : 15_000, !win.min && pageVisible && status !== 'unavailable' && (roomsShown || recentInvites));
  const onJoin = useCallback((room: LoungeInvite) => joinRoom(os, room), [os]);

  useKeyboardLift(rootRef, typingHere && coarse);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A room shared from a game: open #find-a-game with it attached, and a line to send it with.
  const shared = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!args.invite || shared.current === args.nonce) return;
    shared.current = args.nonce;
    const room = args.invite;
    setChannel(INVITE_CHANNEL);
    setDivider(null);
    setInvite(room);
    setDraft((d) => d || `Anyone up for ${gameLook(room.game)?.title ?? 'a game'}? Join my room.`);
    stuck.current = true;
    window.setTimeout(() => textRef.current?.focus({ preventScroll: true }), 0);
  }, [args.nonce, args.invite]);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    (named ? textRef : nameRef).current?.focus({ preventScroll: true });
    // Only when the Lounge opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (editingName) editRef.current?.focus({ preventScroll: true });
  }, [editingName]);

  // A first visit counts everything already said as read.
  useEffect(() => {
    if (read !== null || status !== 'live') return;
    const first = newestIds(messages);
    setRead(first);
    saveRead(first);
  }, [read, status, messages]);

  // Reading the channel: in front, on screen, scrolled to the newest message.
  useEffect(() => {
    if (!looking || read === null) return;
    const newest = channelMessages.at(-1)?.id ?? 0;
    if (newest <= (read[view] ?? 0)) return;
    const next = { ...read, [view]: newest };
    setRead(next);
    saveRead(next);
  }, [looking, channelMessages, view, read]);

  useEffect(() => setBadge('lounge', total), [total]);
  useEffect(() => () => setBadge('lounge', 0), []);

  // A new channel starts at its newest message. (Before the effect below, which then scrolls there.)
  useLayoutEffect(() => {
    stuck.current = true;
    setUnseen(0);
    setAtBottom(true);
  }, [view]);

  useLayoutEffect(() => {
    const added = channelMessages.filter((m) => m.id > newestId.current).length;
    newestId.current = channelMessages.at(-1)?.id ?? 0;
    const el = listRef.current;
    if (!el) {
      // Nothing on screen (an empty or cleared channel): start again from the bottom.
      stuck.current = true;
      setUnseen(0);
    } else if (stuck.current) el.scrollTop = el.scrollHeight;
    else if (added) setUnseen((n) => n + added);
  }, [channelMessages]);

  // Stay on the newest message while the list changes size (a keyboard opening, the window resizing).
  const showList = status !== 'unavailable' && channelMessages.length > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showList, view]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(stuck.current);
    if (stuck.current) setUnseen(0);
  }, []);

  const jump = () => {
    stuck.current = true;
    setUnseen(0);
    setAtBottom(true);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const pick = (ch: ChannelId) => {
    if (!wide) setShowMembers(false);
    if (ch === view) return;
    setDivider(unread[ch] > 0 ? (marks[ch] ?? 0) : null);
    setChannel(ch);
    saveChannel(ch);
  };

  /** Saves a name typed in the box where it's asked for (or changed). False when it isn't one. */
  const keepName = (raw: string) => {
    const clean = cleanLine(raw);
    if (!validLine(clean, NAME_MAX)) {
      setNotice(NOTICES.name);
      return false;
    }
    saveName(clean);
    setName(clean);
    setNameDraft(clean);
    return true;
  };

  const send = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!named) {
      if (keepName(nameDraft)) {
        setNotice('');
        window.setTimeout(() => textRef.current?.focus({ preventScroll: true }), 0);
      } else nameRef.current?.focus();
      return;
    }
    const text = cleanLine(draft);
    if (!text) return;
    if (!lounge.say(view, cleanLine(name), text, invite ?? undefined)) {
      setNotice(NOTICES.waiting);
      return;
    }
    setDraft('');
    setInvite(null);
    setNotice('');
    setDivider(null);
    stuck.current = true;
  };

  const onDraft = (value: string) => {
    setDraft(value);
    if (cleanLine(value)) lounge.markTyping(view);
  };

  // Moving between the boxes keeps a phone's keyboard up, so it isn't a stop.
  const onBlur = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof HTMLInputElement && rootRef.current?.contains(e.relatedTarget))) setTypingHere(false);
  };

  const typers = Object.entries(typing)
    .filter(([id, note]) => note.ch === view && id !== you)
    .map(([id]) => members?.find((m) => m.id === id)?.name)
    .filter((who): who is string => !!who);
  const left = TEXT_MAX - draft.length;
  const inviteLook = invite ? gameLook(invite.game) : null;
  const userBar = (
    <UserBar
      name={name}
      playing={playing}
      editing={editingName}
      draft={nameDraft}
      inputRef={editRef}
      onDraft={setNameDraft}
      onEdit={() => {
        setNameDraft(name);
        setEditingName(true);
      }}
      onSave={() => keepName(nameDraft) && setEditingName(false)}
      onCancel={() => {
        setNameDraft(name);
        setEditingName(false);
      }}
    />
  );
  const channelButtons = (
    <ul className="lounge-channels">
      {shownChannels.map((c) => {
        const count = c.id === view ? 0 : unread[c.id];
        return (
          <li key={c.id}>
            <button type="button" className={c.id === view ? 'is-on' : count ? 'is-unread' : ''} aria-current={c.id === view ? 'page' : undefined} onClick={() => pick(c.id)}>
              <i aria-hidden="true">#</i>
              <span>{c.id}</span>
              {count > 0 && (
                <b className="lounge-count" aria-label={`${count} unread`}>
                  {count > 99 ? '99+' : count}
                </b>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const memberRows = <MemberRows members={members} online={online} you={you} onJoin={onJoin} />;

  return (
    <div
      ref={rootRef}
      className={['lounge', wide ? 'is-wide' : '', roomy ? 'is-roomy' : ''].join(' ')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && showMembers && !roomy) {
          e.stopPropagation();
          setShowMembers(false);
          return;
        }
        if (e.key !== 'Escape') keepKeys(e);
      }}
      onFocus={(e) => setTypingHere(e.target instanceof HTMLInputElement)}
      onBlur={onBlur}
    >
      {wide ? (
        <nav className="lounge-side" aria-label="Channels">
          <p className="lounge-brand">Lounge</p>
          {channelButtons}
          {userBar}
        </nav>
      ) : (
        <nav className="lounge-tabs" aria-label="Channels">
          {channelButtons}
        </nav>
      )}

      <section className="lounge-main" aria-label={`#${view}`}>
        <header className="lounge-head">
          <h2>
            <i aria-hidden="true">#</i>
            {view}
          </h2>
          <p>{topicOf(view)}</p>
          {!roomy && (
            <button type="button" className="lounge-members-btn" aria-expanded={showMembers} aria-controls="lounge-members" aria-label={`Who's here: ${online ?? 0}`} onClick={() => setShowMembers(!showMembers)}>
              <Glyph d={PEOPLE} />
              <span>{online ?? '–'}</span>
            </button>
          )}
        </header>

        <div className="lounge-body">
          {roomsShown && status !== 'unavailable' && <OpenRoomsPanel rooms={rooms} mine={playing?.room} onJoin={onJoin} />}
          {status === 'reconnecting' && <p className="lounge-status">Reconnecting…</p>}
          {status === 'unavailable' ? (
            <div className="lounge-empty">
              <p>The Lounge is unavailable right now.</p>
              <button type="button" className="lounge-btn" onClick={lounge.retry}>
                Try Again
              </button>
            </div>
          ) : showList ? (
            <MessageList messages={channelMessages} me={named ? cleanLine(name) : ''} divider={divider} rooms={rooms} listRef={listRef} onScroll={onScroll} onJoin={onJoin} />
          ) : (
            <div className="lounge-empty">
              <span className="lounge-empty-hash" aria-hidden="true">
                #
              </span>
              <p>{status === 'live' ? `This is the start of #${view}. Say hi.` : 'Connecting…'}</p>
            </div>
          )}
          {showList && unseen > 0 && (
            <button type="button" className="lounge-jump" onClick={jump}>
              {unseen === 1 ? '1 New Message' : `${unseen} New Messages`}
            </button>
          )}
        </div>

        {status !== 'unavailable' && (
          <form className="lounge-compose" onSubmit={send}>
            <p className="lounge-typing" aria-hidden="true">
              {typingLine(typers)}
            </p>
            {notice && (
              <p className="lounge-notice" role="alert">
                {notice}
              </p>
            )}
            {!named ? (
              <div className="lounge-row is-name">
                <input
                  ref={nameRef}
                  value={nameDraft}
                  placeholder="Pick a name to chat"
                  aria-label="Your Name"
                  maxLength={NAME_MAX}
                  autoComplete="nickname"
                  spellCheck={false}
                  enterKeyHint="go"
                  onChange={(e) => setNameDraft(e.target.value)}
                />
                <button type="submit" className="lounge-btn is-primary" disabled={!validLine(nameDraft, NAME_MAX)}>
                  Join Chat
                </button>
              </div>
            ) : (
              <>
                {invite && (
                  <div className="lounge-chip" style={{ ['--accent' as string]: inviteLook?.accent ?? '#636366' }}>
                    {inviteLook && <Glyph d={inviteLook.glyph} />}
                    <span>
                      {inviteLook?.title ?? invite.game} · Room {invite.code}
                    </span>
                    <button type="button" aria-label="Don't Share the Room" title="Don't share the room" onClick={() => setInvite(null)}>
                      <Glyph d={CLOSE} />
                    </button>
                  </div>
                )}
                <div className="lounge-row">
                  <input
                    ref={textRef}
                    value={draft}
                    placeholder={`Message #${view}`}
                    aria-label={`Message #${view}`}
                    maxLength={TEXT_MAX}
                    autoComplete="off"
                    enterKeyHint="send"
                    onChange={(e) => onDraft(e.target.value)}
                  />
                  {left <= 30 && <span className="lounge-left">{left}</span>}
                  {/* Tapping Send keeps the focus (and a phone's keyboard) in the message box. */}
                  <button type="submit" className="lounge-send" aria-label="Send" disabled={status !== 'live' || !cleanLine(draft)} onPointerDown={(e) => e.preventDefault()}>
                    <Glyph d={SEND} />
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </section>

      {roomy ? (
        <aside className="lounge-members" aria-label="Who's Here">
          {memberRows}
        </aside>
      ) : (
        showMembers && (
          <>
            <button type="button" className="lounge-scrim" aria-label="Close" tabIndex={-1} onClick={() => setShowMembers(false)} />
            <aside className="lounge-members is-overlay" id="lounge-members" aria-label="Who's Here">
              {!wide && userBar}
              {memberRows}
            </aside>
          </>
        )
      )}
    </div>
  );
}
