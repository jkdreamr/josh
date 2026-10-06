import { links, profile } from '../data';
import { useOS, type AppProps } from '../types';

export function Trash(_: AppProps) {
  return (
    <div className="trash">
      <svg width="70" height="80" viewBox="0 0 48 56" aria-hidden="true">
        <path d="M6 12h36l-3 40a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="#e9ecf2" stroke="#c9ced8" />
        <rect x="3" y="6" width="42" height="7" rx="3" fill="#dfe3ea" />
      </svg>
      <b>Trash is empty</b>
      <p>the old website lived here. it was rebranded.</p>
    </div>
  );
}

export function About(_: AppProps) {
  const os = useOS();
  const specs: [string, string][] = [
    ['Chip', 'Stanford CS + Math'],
    ['Role', "Leading Cognition's Korea efforts"],
    ['Also', 'Investment intern, CRV'],
    ['Graphics', 'Coxswain, Stanford Varsity Rowing'],
    ['Audio', '“Fairytale” · “all i need” · kelix'],
    ['Languages', 'Korean · English · Chinese'],
    ['Serial', '@joshuaykoo'],
  ];
  return (
    <div className="about">
      <div className="about-orb">jk</div>
      <h2>{profile.name}</h2>
      <p className="about-ver">Version 2026 (rebranded)</p>
      <dl>
        {specs.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="about-btns">
        <button className="btn btn-ghost" onClick={() => os.open('notes', { note: 'about' })}>
          More Info…
        </button>
        <a className="btn btn-ghost" href={links.linkedin} target="_blank" rel="noreferrer">
          LinkedIn
        </a>
      </div>
      <p className="about-legal">™ and © {new Date().getFullYear()} joshua koo. all rights reserved.</p>
    </div>
  );
}
