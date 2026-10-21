import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { links, profile } from '../data';
import { useOS, type AppProps, type OSApi } from '../types';
import { cleanText, dayLabel, MAX_TEXT, mergePage, pollDelay, readChat, savedSession, sendChat, startSession, type ChatPage } from './messages-live';

type Action = { label: string; run: (os: OSApi) => void };
/**
 * A bubble. Scripted answers and chip questions stay on this device. Typed messages go to the real Josh on Telegram:
 * `idx` is their place in the live conversation once stored, `status` tracks one still on its way or one that failed.
 * `auto` marks the AI answering for Josh when he hasn't replied in a day.
 */
type Msg = { id: number; from: 'me' | 'josh'; text: ReactNode; t: number; actions?: Action[]; idx?: number; status?: 'sending' | 'failed'; auto?: boolean };
type Topic = { q: string; a: string[]; actions?: Action[] };

const topics: Topic[] = [
  {
    q: 'what are you working on?',
    a: [
      "these days i'm leading Cognition's Korea efforts. we make Devin, the AI software engineer.",
      "before that: investment intern at CRV, ecosystem manager at NEAR, and research at Pantera Capital.",
    ],
    actions: [{ label: 'See Work Folder', run: (os) => os.open('finder', { folder: 'work' }) }],
  },
  {
    q: "what's stanford like?",
    a: ["cs + math. i'm a coxswain on the varsity rowing team, previously helped organize Treehacks and the Stanford Math Tournament, and play badminton when i can."],
    actions: [
      { label: 'School Note', run: (os) => os.open('notes', { note: 'school' }) },
      { label: 'Race Me in Cox Box', run: (os) => os.open('coxbox') },
    ],
  },
  {
    q: 'you make music?',
    a: [
      'yep. i debuted as an artist with the single “Fairytale” under Dejavu Group, a korean hip hop label.',
      'i also release music on my own. “all i need” is on Spotify, and i post as kelix on SoundCloud.',
    ],
    actions: [
      { label: 'Play on Spotify', run: (os) => os.open('spotify') },
      { label: 'SoundCloud', run: (os) => os.open('soundcloud') },
      { label: 'Watch Fairytale', run: (os) => os.openUrl(links.youtube) },
    ],
  },
  {
    q: 'side projects?',
    a: ['i like to build things i actually use: kookwleigh (dinners, by invitation), NOVUM, LiveX, Harbor and Verses (a songwriting surface).'],
    actions: [{ label: 'Open Them in Chrome', run: (os) => os.open('chrome') }],
  },
  {
    q: 'fun fact?',
    a: ['i speak korean, english and chinese, and made USACO Platinum back in the day.', 'also wrote a working paper on how idol training shapes the popularity of global k-pop.'],
  },
  {
    q: 'how do i reach you?',
    a: [`email is best: ${profile.email}. i'm also @joshuaykoo on X and Instagram.`],
    actions: [
      { label: 'Write an Email', run: (os) => os.open('mail') },
      { label: 'X', run: (os) => os.open('x') },
    ],
  },
];

let seq = 1;

const mailto = (text: string) =>
  `mailto:${profile.email}?subject=${encodeURIComponent('hey josh, from your website')}&body=${encodeURIComponent(text)}`;
const emailAction = (text: string): Action => ({ label: 'Send as Email', run: () => (window.location.href = mailto(text)) });

export default function Messages(_: AppProps) {
  const os = useOS();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const queue = useRef<number[]>([]);
  /** When the scripted Josh is done typing what is already queued. */
  const freeAt = useRef(0);
  const alive = useRef(true);
  const session = useRef<string | null>(null);
  /** How many of the live conversation's messages are on screen. */
  const have = useRef(0);
  /** Last time the conversation moved, which sets how often to check for replies. */
  const activity = useRef(0);
  const poll = useRef<number | undefined>(undefined);
  const pulling = useRef(false);
  const announced = useRef(false);

  const joshSays = (lines: ReactNode[], actions?: Action[], startDelay = 350) => {
    const now = Date.now();
    let t = Math.max(startDelay, freeAt.current - now);
    lines.forEach((line, i) => {
      queue.current.push(window.setTimeout(() => setTyping(true), t));
      t += 650 + Math.min(1400, String(line).length * 14);
      const last = i === lines.length - 1;
      queue.current.push(
        window.setTimeout(() => {
          setTyping(false);
          setMsgs((m) => [...m, { id: seq++, from: 'josh', text: line, t: Date.now(), actions: last ? actions : undefined }]);
        }, t),
      );
      t += 250;
    });
    freeAt.current = now + t;
  };

  const absorb = (page: ChatPage, history = false) => {
    if (page.next <= have.current) return;
    const from = have.current;
    have.current = page.next;
    for (const m of page.messages) activity.current = Math.max(activity.current, m.t);
    setMsgs((list) =>
      mergePage(
        list,
        page,
        from,
        (m, idx) => ({ id: seq++, from: m.from === 'visitor' ? 'me' : 'josh', text: m.text, t: m.t, idx, auto: m.from === 'auto' || undefined }),
        history,
      ),
    );
  };

  const schedule = () => {
    window.clearTimeout(poll.current);
    if (!session.current || have.current === 0) return;
    const delay = pollDelay(Date.now() - activity.current);
    if (delay !== null) poll.current = window.setTimeout(pull, delay);
  };

  /** Checks for replies. While the tab is hidden it waits for the visitor to come back instead. */
  const pull = async () => {
    if (!session.current || pulling.current || document.hidden) return;
    pulling.current = true;
    const page = await readChat(session.current, have.current);
    pulling.current = false;
    if (!alive.current) return;
    if (page) absorb(page);
    schedule();
  };

  useEffect(() => {
    alive.current = true;
    session.current = savedSession();
    let active = true;
    let greeted = false;
    const greet = (page: ChatPage | null) => {
      if (greeted) return;
      greeted = true;
      if (page?.messages.length) return;
      joshSays(
        ["hey! i'm josh 👋", page?.live ? "ask me anything below, or type a message. it buzzes my phone and i'll answer right here." : 'ask me anything below, or just type.'],
        undefined,
        300,
      );
    };
    const fallback = window.setTimeout(() => greet(null), 700);
    void readChat(session.current, 0).then((page) => {
      window.clearTimeout(fallback);
      if (!active) return;
      if (page) absorb(page, true);
      greet(page);
      schedule();
    });
    const onVisible = () => {
      if (!document.hidden) void pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      alive.current = false;
      window.clearTimeout(fallback);
      window.clearTimeout(poll.current);
      queue.current.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing]);

  const ask = (t: Topic) => {
    setAsked((a) => [...a, t.q]);
    setMsgs((m) => [...m, { id: seq++, from: 'me', text: t.q, t: Date.now() }]);
    joshSays(t.a, t.actions);
  };

  const send = async () => {
    // Cleaned the way the Worker stores it, so the stored copy settles this bubble.
    const text = cleanText(draft);
    if (!text) return;
    setDraft('');
    const id = seq++;
    setMsgs((m) => [...m, { id, from: 'me', text, t: Date.now(), status: 'sending' }]);
    session.current ??= startSession();
    const sent = await sendChat(session.current, text, have.current);
    if (!alive.current) return;
    if (sent.ok) {
      absorb(sent.page);
      activity.current = Date.now();
      schedule();
      if (!announced.current) {
        announced.current = true;
        joshSays(["got it, that just buzzed my phone. i'll answer right here, so keep this open or check back later."]);
      }
      return;
    }
    // Offline means it never left the page, so it is just a local bubble; anything else did not arrive.
    setMsgs((m) => m.map((b) => (b.id === id ? { ...b, status: sent.reason === 'offline' ? undefined : 'failed' } : b)));
    if (sent.reason === 'offline') joshSays(["the real me isn't at this keyboard right now. want to send that straight to my inbox?"], [emailAction(text)]);
    else if (sent.reason === 'slow') joshSays(["that's a lot of messages at once. give it a few minutes, then try again."]);
    else if (sent.reason === 'full') joshSays(["this chat's gotten long. want to email me the rest?"], [emailAction(text)]);
    else joshSays(["hm, that didn't go through. want to email it instead?"], [emailAction(text)]);
  };

  const remaining = topics.filter((t) => !asked.includes(t.q));
  // Like iMessage, only the latest typed message says how it went.
  const receiptAt = msgs.findLastIndex((m) => m.from === 'me' && (m.idx !== undefined || m.status !== undefined));
  const receipt = (m: Msg) => (m.status === 'sending' ? 'Sending…' : m.status === 'failed' ? 'Not Delivered' : 'Delivered');

  return (
    <div className="messages">
      <header className="msg-head" data-drag>
        <span className="msg-avatar">JK</span>
        <b>Josh</b>
        <small>iMessage</small>
      </header>
      <div className="msg-scroll" ref={scroller}>
        {!msgs.length && <p className="msg-day">Today</p>}
        {msgs.map((m, i) => {
          const day = dayLabel(m.t);
          return (
            <Fragment key={m.id}>
              {(i === 0 || dayLabel(msgs[i - 1].t) !== day) && <p className="msg-day">{day}</p>}
              <div className={`bubble-row from-${m.from}${m.status === 'sending' ? ' sending' : ''}`}>
                <div className="bubble">{m.text}</div>
                {m.actions && (
                  <div className="bubble-actions">
                    {m.actions.map((a) => (
                      <button key={a.label} onClick={() => a.run(os)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                {m.auto && <small className="msg-note">auto-reply · AI</small>}
                {i === receiptAt && <small className={`msg-receipt${m.status === 'failed' ? ' failed' : ''}`}>{receipt(m)}</small>}
              </div>
            </Fragment>
          );
        })}
        {typing && (
          <div className="bubble-row from-josh">
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
      {remaining.length > 0 && (
        <div className="chips">
          {remaining.map((t) => (
            <button key={t.q} onClick={() => ask(t)} disabled={typing}>
              {t.q}
            </button>
          ))}
        </div>
      )}
      <form
        className="msg-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="iMessage" aria-label="Message" maxLength={MAX_TEXT} />
        <button type="submit" disabled={!draft.trim()} aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  );
}
