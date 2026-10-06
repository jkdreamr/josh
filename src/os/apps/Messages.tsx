import { useEffect, useRef, useState, type ReactNode } from 'react';
import { links, profile } from '../data';
import { useOS, type AppProps, type OSApi } from '../types';

type Action = { label: string; run: (os: OSApi) => void };
type Msg = { id: number; from: 'me' | 'josh'; text: ReactNode; actions?: Action[] };
type Topic = { q: string; a: string[]; actions?: Action[] };

const topics: Topic[] = [
  {
    q: 'what are you working on?',
    a: [
      "these days i'm leading Cognition's Korea efforts — we make Devin, the AI software engineer.",
      "before that: investment intern at CRV, ecosystem manager at NEAR, and research at Pantera Capital.",
    ],
    actions: [{ label: 'see work folder', run: (os) => os.open('finder', { folder: 'work' }) }],
  },
  {
    q: "what's stanford like?",
    a: ["cs + math. i'm a coxswain on the varsity rowing team, help organize TreeHacks and the Stanford Math Tournament, and play badminton when i can."],
    actions: [
      { label: 'school folder', run: (os) => os.open('finder', { folder: 'school' }) },
      { label: 'try cox box', run: (os) => os.open('coxbox') },
    ],
  },
  {
    q: 'you make music?',
    a: [
      'yep. i debuted as an artist with the single “Fairytale” under Dejavu Group, a korean hip hop label.',
      'i also release music on my own — “all i need” is on Spotify, and i post as kelix on SoundCloud.',
    ],
    actions: [
      { label: 'play on spotify', run: (os) => os.open('spotify') },
      { label: 'soundcloud', run: (os) => os.open('soundcloud') },
      { label: 'watch fairytale', run: (os) => os.openUrl(links.youtube) },
    ],
  },
  {
    q: 'side projects?',
    a: ['i like to build things i actually use: kookwleigh (dinners, by invitation), NOVUM, LiveX, Harbor and Verses (a songwriting surface).'],
    actions: [{ label: 'open them in chrome', run: (os) => os.open('chrome') }],
  },
  {
    q: 'fun fact?',
    a: ['i speak korean, english and chinese, and made USACO Platinum back in the day.', 'also wrote a working paper on how idol training shapes the popularity of global k-pop.'],
  },
  {
    q: 'how do i reach you?',
    a: [`email is best: ${profile.email}. i'm also @joshuaykoo on X and Instagram.`],
    actions: [
      { label: 'write an email', run: (os) => os.open('mail') },
      { label: 'X', run: (os) => os.open('x') },
    ],
  },
];

let seq = 1;

export default function Messages(_: AppProps) {
  const os = useOS();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const queue = useRef<number[]>([]);

  const joshSays = (lines: ReactNode[], actions?: Action[], startDelay = 350) => {
    let t = startDelay;
    lines.forEach((line, i) => {
      queue.current.push(window.setTimeout(() => setTyping(true), t));
      t += 650 + Math.min(1400, String(line).length * 14);
      const last = i === lines.length - 1;
      queue.current.push(
        window.setTimeout(() => {
          setTyping(false);
          setMsgs((m) => [...m, { id: seq++, from: 'josh', text: line, actions: last ? actions : undefined }]);
        }, t),
      );
      t += 250;
    });
  };

  useEffect(() => {
    joshSays(["hey! i'm josh 👋", 'ask me anything below — or just type.'], undefined, 300);
    return () => queue.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, typing]);

  const ask = (t: Topic) => {
    setAsked((a) => [...a, t.q]);
    setMsgs((m) => [...m, { id: seq++, from: 'me', text: t.q }]);
    joshSays(t.a, t.actions);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setMsgs((m) => [...m, { id: seq++, from: 'me', text }]);
    const mailto = `mailto:${profile.email}?subject=${encodeURIComponent('hey josh — from your website')}&body=${encodeURIComponent(text)}`;
    joshSays(
      ["the real me isn't at this keyboard right now — want to send that straight to my inbox?"],
      [{ label: 'send as email', run: () => (window.location.href = mailto) }],
    );
  };

  const remaining = topics.filter((t) => !asked.includes(t.q));

  return (
    <div className="messages">
      <header className="msg-head" data-drag>
        <span className="msg-avatar">JK</span>
        <b>Josh</b>
        <small>iMessage</small>
      </header>
      <div className="msg-scroll" ref={scroller}>
        <p className="msg-day">Today</p>
        {msgs.map((m) => (
          <div key={m.id} className={`bubble-row from-${m.from}`}>
            <div className="bubble">{m.text}</div>
            {m.actions && (
              <div className="bubble-actions">
                {m.actions.map((a) => (
                  <button key={a.label} onClick={() => a.run(os)}>
                    {a.label} →
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
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
          send();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="iMessage" aria-label="Message" />
        <button type="submit" disabled={!draft.trim()} aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  );
}
