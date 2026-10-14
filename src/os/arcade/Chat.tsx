import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react';
import { dayLabel } from '../chat-core';
import { useMedia } from '../hooks';
import { savedName, saveName } from './kit/leaderboard';
import { cleanLine, lineHash, LoungeLink, NAME_MAX, TEXT_MAX, validLine, type LoungeMessage, type LoungeReject, type LoungeState } from './lounge';
import './Chat.css';

/** Messages from one name this close together share one header. */
const GROUP_MS = 5 * 60_000;
/** Name colors, all readable on white (and white on them). A prime count spreads names out more evenly. */
const COLORS = ['#1a73e8', '#c5221f', '#137333', '#8430ce', '#b06000', '#007b83', '#b80672', '#3949ab', '#795548', '#827717', '#455a64'];
const NOTICES: Record<LoungeReject['error'] | 'waiting', string> = {
  name: 'Pick a name first, 1 to 16 characters.',
  text: 'Messages can be up to 280 characters.',
  slow: 'Slow down a little. Try again in a few seconds.',
  repeat: 'You just said that.',
  offline: "That didn't send. The connection dropped.",
  waiting: 'Still connecting. Try again in a moment.',
};

const nameColor = (name: string) => COLORS[lineHash(name.toLowerCase()) % COLORS.length];
const initial = (name: string) => (Array.from(name)[0] ?? '?').toUpperCase();
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** Typing in the chat never reaches the OS shortcuts; Cmd and Ctrl combos (Cmd+K) still do. */
const keepKeys = (e: KeyboardEvent) => {
  if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
};

/** The chat's connection, held only while the chat is on screen. */
function useLounge(onReject: (reject: LoungeReject) => void) {
  const [state, setState] = useState<LoungeState>({ status: 'connecting', messages: [], online: null });
  const link = useRef<LoungeLink | null>(null);
  const rejected = useRef(onReject);
  rejected.current = onReject;
  useEffect(() => {
    const lounge = new LoungeLink();
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
  const say = useCallback((name: string, text: string) => link.current?.say(name, text) ?? false, []);
  const retry = useCallback(() => link.current?.retry(), []);
  return { ...state, say, retry };
}

/** A phone keyboard covers the bottom of the screen: while typing there, lift the box above it, like Cox Box does. */
function useKeyboardLift(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el || !active) return;
    const fit = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Only as far as the keyboard reaches past the bottom of the box (the padding inside it doesn't move the box itself).
      const below = Math.max(0, window.innerHeight - el.getBoundingClientRect().bottom);
      el.style.setProperty('--chat-keyboard', covered > 80 ? `${Math.min(Math.max(0, covered - below), el.clientHeight * 0.6)}px` : '0px');
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.removeProperty('--chat-keyboard');
    };
  }, [ref, active]);
}

/** Messages in order, with a day heading when the day changes and one header per run of messages from the same name. */
const MessageList = memo(function MessageList({ messages, listRef, onScroll }: { messages: LoungeMessage[]; listRef: RefObject<HTMLDivElement | null>; onScroll: () => void }) {
  const now = Date.now();
  return (
    <div className="arcade-chat-list" ref={listRef} onScroll={onScroll} role="log" aria-label="Messages">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const day = dayLabel(m.t, now);
        const newDay = !prev || dayLabel(prev.t, now) !== day;
        const first = newDay || prev.name !== m.name || m.t - prev.t > GROUP_MS;
        return (
          <Fragment key={m.id}>
            {newDay && <p className="arcade-chat-day">{day}</p>}
            <div className={first ? 'arcade-chat-msg is-first' : 'arcade-chat-msg'} style={{ ['--name' as string]: nameColor(m.name) }}>
              {first ? (
                <>
                  <span className="arcade-chat-avatar" aria-hidden="true">
                    {initial(m.name)}
                  </span>
                  <div className="arcade-chat-meta">
                    <b>{m.name}</b>
                    <time dateTime={new Date(m.t).toISOString()}>{clock(m.t)}</time>
                  </div>
                </>
              ) : (
                <span className="arcade-chat-sr">{m.name}: </span>
              )}
              <p className="arcade-chat-text" dir="auto">
                {m.text}
              </p>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
});

/** The arcade's global chat, for finding someone to play with. Everything in it is plain text. */
export function ArcadeChat() {
  const [name, setName] = useState(() => savedName());
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [typing, setTyping] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  /** Whether the list is scrolled to the newest message, so new ones scroll into view. */
  const stuck = useRef(true);
  const newestId = useRef(0);
  const coarse = useMedia('(pointer: coarse)');

  const lounge = useLounge((reject) => {
    if (reject.text) setDraft((d) => d || reject.text);
    setNotice(NOTICES[reject.error]);
    if (reject.error === 'name') nameRef.current?.focus();
  });
  const { messages, status, online } = lounge;
  const showList = status !== 'unavailable' && messages.length > 0;

  useKeyboardLift(panelRef, typing && coarse);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    (validLine(name, NAME_MAX) ? textRef : nameRef).current?.focus({ preventScroll: true });
    // Only when the chat opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useLayoutEffect(() => {
    const added = messages.filter((m) => m.id > newestId.current).length;
    newestId.current = messages.at(-1)?.id ?? 0;
    const el = listRef.current;
    if (!el) {
      // Nothing on screen (a cleared chat): start again from the bottom.
      stuck.current = true;
      setUnseen(0);
    } else if (stuck.current) el.scrollTop = el.scrollHeight;
    else if (added) setUnseen((n) => n + added);
  }, [messages]);

  // Stay on the newest message while the list changes size (a keyboard opening, the window resizing).
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showList]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (stuck.current) setUnseen(0);
  }, []);

  const jump = () => {
    stuck.current = true;
    setUnseen(0);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const send = (e: SyntheticEvent) => {
    e.preventDefault();
    const text = cleanLine(draft);
    if (!text) return;
    if (!validLine(name, NAME_MAX)) {
      setNotice(NOTICES.name);
      nameRef.current?.focus();
      return;
    }
    const who = cleanLine(name);
    if (!lounge.say(who, text)) {
      setNotice(NOTICES.waiting);
      return;
    }
    saveName(who);
    setName(who);
    setDraft('');
    setNotice('');
    stuck.current = true;
  };

  // Moving between the two boxes keeps the keyboard up, so it isn't a stop.
  const onBlur = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof HTMLInputElement && panelRef.current?.contains(e.relatedTarget))) setTyping(false);
  };

  const presence = status === 'live' ? (online === 1 ? 'Just you here' : `${online ?? 0} here now`) : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  const left = TEXT_MAX - draft.length;

  return (
    <section className="arcade-chat" aria-label="Chat" ref={panelRef} onFocus={(e) => setTyping(e.target instanceof HTMLInputElement)} onBlur={onBlur}>
      {status !== 'unavailable' && (
        <div className="arcade-chat-bar">
          <span className={`arcade-chat-here is-${status}`}>
            <i aria-hidden="true" />
            {presence}
          </span>
          <label className="arcade-chat-name">
            <span>Name</span>
            <input
              ref={nameRef}
              value={name}
              placeholder="Your Name"
              maxLength={NAME_MAX}
              autoComplete="nickname"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => validLine(name, NAME_MAX) && saveName(cleanLine(name))}
              onKeyDown={(e) => {
                keepKeys(e);
                if (e.key === 'Enter') textRef.current?.focus();
              }}
            />
          </label>
        </div>
      )}
      <div className="arcade-chat-body">
        {status === 'unavailable' ? (
          <div className="arcade-chat-empty">
            <p>Chat is unavailable right now.</p>
            <button type="button" className="arcade-pbtn" onClick={lounge.retry}>
              Try Again
            </button>
          </div>
        ) : showList ? (
          <MessageList messages={messages} listRef={listRef} onScroll={onScroll} />
        ) : (
          <div className="arcade-chat-empty">
            <p>{status === 'live' ? 'No messages yet. Say hi.' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>
          </div>
        )}
        {showList && unseen > 0 && (
          <button type="button" className="arcade-chat-jump" onClick={jump}>
            {unseen === 1 ? '1 New Message' : `${unseen} New Messages`}
          </button>
        )}
      </div>
      {status !== 'unavailable' && (
        <form className="arcade-chat-compose" onSubmit={send}>
          {notice && (
            <p className="arcade-chat-notice" role="alert">
              {notice}
            </p>
          )}
          <div className="arcade-chat-row">
            <input
              ref={textRef}
              value={draft}
              placeholder="Say Something"
              aria-label="Message"
              maxLength={TEXT_MAX}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={keepKeys}
            />
            {left <= 30 && <span className="arcade-chat-left">{left}</span>}
            {/* Tapping Send keeps the focus (and a phone's keyboard) in the message box. */}
            <button type="submit" className="arcade-chat-send" disabled={status !== 'live' || !cleanLine(draft)} onPointerDown={(e) => e.preventDefault()}>
              Send
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
