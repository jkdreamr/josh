import { useEffect, useState, type ReactNode } from 'react';
import { folders, linkedin, links, profile, school } from '../data';
import { useOS, type AppProps } from '../types';

type Note = { id: string; title: string; preview: string; body: () => ReactNode };

const work = folders.find((f) => f.id === 'work')!.entries;

const notes: Note[] = [
  {
    id: 'about',
    title: 'About me',
    preview: 'hi, i’m joshua koo.',
    body: () => (
      <>
        <h1>hi, i’m joshua koo.</h1>
        <p>{profile.tagline}</p>
        <p><strong>
          I study cs + math at Stanford, walked on to the men’s varsity rowing team as a coxswain, and spend the rest of my time somewhere
          between startups, investing and music.
        </strong></p>
        <p className="note-muted"><strong>tip: everything on this desktop is clickable. try the terminal, or text me in Messages.</strong></p>
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
              <b>{w.name}</b>, {w.role}
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
            <a href={links.spotifyAlbum} target="_blank" rel="noreferrer">all i need</a> on Spotify
          </li>
          <li>
            <a href={links.soundcloud} target="_blank" rel="noreferrer">kelix</a> on SoundCloud
          </li>
          <li>
            <a href={links.youtube} target="_blank" rel="noreferrer">fairytale</a> on YouTube
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'school',
    title: 'School',
    preview: 'Stanford Men’s Rowing, Kappa Sigma',
    body: () => (
      <>
        <h1>School</h1>
        <p><b>Currently:</b> {school.current.join(', ')}</p>
        <p><b>Past:</b> {school.past.join(', ')}</p>
      </>
    ),
  },
  {
    id: 'misc',
    title: 'Other things I like',
    preview: 'Go, sports, lifting, music, cooking…',
    body: () => (
      <>
        <h1>Other things I like</h1>
        <ul>
          <li>Go (board game)</li>
          <li>I love watching and playing sports like badminton, basketball, football (go 49ers!), golf, tennis, squash, running, swimming.</li>
          <li>Lifting (a lot)</li>
          <li>Making music</li>
          <li>Cooking</li>
          <li>I can speak Korean and Mandarin</li>
          <li>algorithmic coding (USACO Plat my freshman year of high school)</li>
          <li>crypto</li>
          <li>eating (literally everything)</li>
          <li>clash of clans (prev. top 6 in the US), I stopped playing now lol</li>
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
