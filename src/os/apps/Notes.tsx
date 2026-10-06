import { useEffect, useState, type ReactNode } from 'react';
import { folders, linkedin, links, profile } from '../data';
import { useOS, type AppProps } from '../types';

type Note = { id: string; title: string; preview: string; body: () => ReactNode };

const work = folders.find((f) => f.id === 'work')!.entries;

const notes: Note[] = [
  {
    id: 'about',
    title: 'about me',
    preview: 'hi, i’m joshua koo.',
    body: () => (
      <>
        <h1>hi, i’m joshua koo.</h1>
        <p>{profile.tagline}</p>
        <p>
          i study <b>cs + math at Stanford</b>, cox the varsity rowing team, and spend the rest of my time somewhere between startups, investing and
          music.
        </p>
        <ul>
          <li>currently leading Cognition’s Korea efforts</li>
          <li>investment intern at CRV</li>
          <li>debuted as an artist with “Fairytale” (Dejavu Group)</li>
          <li>building side projects i actually use</li>
        </ul>
        <p className="note-muted">tip: everything on this desktop is clickable. try the terminal, or text me in Messages.</p>
      </>
    ),
  },
  {
    id: 'work',
    title: 'where i’ve worked',
    preview: work.map((w) => w.name).join(', '),
    body: () => (
      <>
        <h1>where i’ve worked</h1>
        <ul className="note-list">
          {work.map((w) => (
            <li key={w.name}>
              <b>{w.name}</b> — {w.role}
              {w.meta && w.meta !== 'now' ? <span className="note-muted"> · {w.meta}</span> : <span className="note-muted"> · now</span>}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: 'music',
    title: 'music',
    preview: 'fairytale, all i need, kelix…',
    body: () => (
      <>
        <h1>music</h1>
        <p>{linkedin.projects[0].blurb}</p>
        <ul>
          <li>
            <a href={links.spotifyAlbum} target="_blank" rel="noreferrer">all i need</a> — Spotify
          </li>
          <li>
            <a href={links.soundcloud} target="_blank" rel="noreferrer">kelix</a> — SoundCloud
          </li>
          <li>
            <a href={links.youtube} target="_blank" rel="noreferrer">fairytale</a> — YouTube
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'rowing',
    title: 'rowing',
    preview: 'coxswain, stanford varsity',
    body: () => (
      <>
        <h1>rowing</h1>
        <p>i’m a coxswain for Stanford Varsity Rowing — steering the boat, calling the race, keeping eight people in rhythm.</p>
        <p className="note-muted">want to know what that feels like? open Cox Box on the desktop.</p>
      </>
    ),
  },
  {
    id: 'misc',
    title: 'awards, languages, papers',
    preview: 'USACO Platinum, M3 Challenge…',
    body: () => (
      <>
        <h1>awards, languages, papers</h1>
        <h2>honors</h2>
        <ul>
          {linkedin.awards.map((a) => (
            <li key={a.title}>
              {a.title} <span className="note-muted">· {a.meta}</span>
            </li>
          ))}
        </ul>
        <h2>languages</h2>
        <ul>
          {linkedin.languages.map((l) => (
            <li key={l.name}>
              {l.name} <span className="note-muted">· {l.level}</span>
            </li>
          ))}
        </ul>
        <h2>writing</h2>
        <ul>
          {linkedin.publications.map((p) => (
            <li key={p.title}>
              {p.title} <span className="note-muted">· {p.meta}</span>
            </li>
          ))}
        </ul>
        <h2>also</h2>
        <ul>
          <li>{linkedin.projects[1].title} — {linkedin.projects[1].blurb.toLowerCase()}</li>
        </ul>
      </>
    ),
  },
];

export default function Notes({ args }: AppProps) {
  const os = useOS();
  const [cur, setCur] = useState(args.note ?? 'about');
  const [listOpen, setListOpen] = useState(!os.mobile);
  useEffect(() => setListOpen(!os.mobile), [os.mobile]);
  useEffect(() => {
    if (args.note) setCur(args.note);
  }, [args.nonce, args.note]);
  const note = notes.find((n) => n.id === cur) ?? notes[0];
  return (
    <div className={`notes ${listOpen ? 'list-open' : ''}`}>
      <aside className="notes-list" data-drag>
        <div className="notes-list-head" data-drag />
        <p className="side-label">Pinned</p>
        {notes.map((n) => (
          <button
            key={n.id}
            className={n.id === cur ? 'is-sel' : ''}
            onClick={() => {
              setCur(n.id);
              if (os.mobile) setListOpen(false);
            }}
          >
            <b>{n.title}</b>
            <span>{n.preview}</span>
          </button>
        ))}
      </aside>
      <article className="note">
        <header className="note-bar" data-drag>
          {os.mobile && (
            <button className="note-back" onClick={() => setListOpen(true)}>
              ‹ Notes
            </button>
          )}
        </header>
        <div className="note-body">{note.body()}</div>
      </article>
    </div>
  );
}
