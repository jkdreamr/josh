export type Entry = {
  name: string;
  role?: string;
  meta?: string;
  href?: string;
  /** true when the site allows being framed, so it can open inside the in-desktop browser */
  embeddable?: boolean;
  blurb?: string;
};

export type FolderId = 'school' | 'work' | 'projects' | 'music';

export type Folder = {
  id: FolderId;
  label: string;
  entries: Entry[];
};

export const profile = {
  name: 'Joshua Koo',
  short: 'josh',
  tagline: 'I like to build and make things I actually use.',
  email: 'joskoo@stanford.edu',
  location: 'Stanford, CA',
};

export const links = {
  x: 'https://x.com/joshuaykoo',
  linkedin: 'https://www.linkedin.com/in/joshuaykoo',
  github: 'https://github.com/jkdreamr',
  instagram: 'https://www.instagram.com/joshuaykoo/',
  instagramMusic: 'https://www.instagram.com/atkelix/',
  soundcloud: 'https://soundcloud.com/atkelix',
  spotifyAlbum: 'https://open.spotify.com/album/2ckdlSbzkVukYqvSwZIiUp',
  youtube: 'https://www.youtube.com/watch?v=nw2rOUypDHE',
};

export const embeds = {
  soundcloud:
    'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Fusers%2F818107360&color=%23ff5500&auto_play=false&hide_related=false&show_comments=false&show_user=true&show_reposts=false&visual=true',
  spotify: 'https://open.spotify.com/embed/album/2ckdlSbzkVukYqvSwZIiUp?utm_source=generator&theme=0',
  youtube: 'https://www.youtube-nocookie.com/embed/nw2rOUypDHE',
};

export const soundcloudAvatar = 'https://i1.sndcdn.com/avatars-XdpKzxkUvnfkeqjI-9cI96Q-t500x500.jpg';

export const folders: Folder[] = [
  {
    id: 'school',
    label: 'School',
    entries: [
      { role: 'undergrad', name: 'Stanford University', meta: 'CS + Math', href: 'https://www.stanford.edu/' },
      { role: 'student athlete', name: 'Stanford Varsity Rowing', meta: 'coxswain', href: 'https://gostanford.com/sports/mens-rowing' },
      { role: 'organizer', name: 'TreeHacks', meta: 'Stanford Hackathon', href: 'https://www.treehacks.com/' },
      { role: 'head of growth', name: 'Stanford Blockchain' },
      { role: 'organizer', name: 'Stanford Math Tournament' },
      { role: 'frosh battalion', name: 'BASES' },
      { role: 'financial officer', name: 'AASA' },
      { role: 'public outreach', name: 'TEDxStanford' },
      { role: 'intern', name: 'Stanford Concert Network' },
      { role: 'member', name: 'Stanford Badminton' },
      { role: 'member', name: 'Kappa Sigma' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    entries: [
      { role: 'leading Korea efforts', name: 'Cognition', meta: 'now', href: 'https://cognition.ai/', blurb: 'the team behind Devin, the AI software engineer' },
      { role: 'investment intern', name: 'CRV', meta: 'Jun 2026 - present', href: 'https://www.crv.com/' },
      { role: 'ecosystem manager', name: 'NEAR Protocol', meta: 'Jun 2025 - Sep 2025', href: 'https://near.ai/' },
      { role: 'research', name: 'Pantera Capital', meta: 'Feb 2025 - May 2025', href: 'https://panteracapital.com/' },
      { role: 'intern', name: 'Branch and Bound (CodeTree)', meta: 'Jul 2022 - Sep 2023', href: 'https://www.codetree.ai/', embeddable: true },
    ],
  },
  {
    id: 'projects',
    label: 'Side Projects',
    entries: [
      { name: 'kookwleigh', meta: 'intimate dinners, by invitation', href: 'https://kookwleigh.vercel.app/', embeddable: true },
      { name: 'NOVUM', meta: 'artist-led creative technology', href: 'https://novumworld.vercel.app/', embeddable: true },
      { name: 'LiveX', meta: 'NBA Summer League hoodie designer', href: 'https://livex-nba.vercel.app/', embeddable: true },
      { name: 'Harbor', meta: 'make sense of your work', href: 'https://personal-seven-orpin.vercel.app/access?next=%2F' },
      { name: 'Verses', meta: 'a songwriting surface', href: 'https://verses-zeta.vercel.app/', embeddable: true },
    ],
  },
  {
    id: 'music',
    label: 'Music',
    entries: [
      { name: 'all i need', meta: 'Spotify', href: links.spotifyAlbum },
      { name: 'kelix', meta: 'SoundCloud', href: links.soundcloud },
      { name: 'fairytale', meta: 'YouTube', href: links.youtube },
      { name: '@atkelix', meta: 'Instagram', href: links.instagramMusic },
    ],
  },
];

export const folderById = (id: FolderId) => folders.find((f) => f.id === id)!;

export const linkedin = {
  headline: 'CS + Math @ Stanford | Student Athlete',
  about: "Currently leading Cognition's Korea efforts",
  publications: [
    { title: 'Understanding the importance of the idol training process in the popularity of global K-Pop', meta: 'Working Paper' },
  ],
  projects: [
    {
      title: 'Professional Music Debut',
      blurb:
        'Debuted as an official artist with the digital single “Fairytale” under Korean hip hop label Dejavu Group. Also releasing music independently on SoundCloud and YouTube.',
    },
    { title: 'Solana Validator', blurb: 'Running testnet to join delegation program' },
  ],
  awards: [
    { title: 'USA Computing Olympiad Platinum Division', meta: 'USA Computing Olympiad · Jan 2021' },
    { title: 'M3 Challenge Honorable Mention', meta: 'MathWorks · Apr 2023' },
  ],
  languages: [
    { name: 'Korean', level: 'Native or bilingual' },
    { name: 'English', level: 'Native or bilingual' },
    { name: 'Chinese', level: 'Full professional' },
  ],
};
