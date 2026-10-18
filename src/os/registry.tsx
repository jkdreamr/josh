import type { ComponentType } from 'react';
import type { IconKind } from './icons';
import type { AppId, AppProps } from './types';
import Finder from './apps/Finder';
import Chrome from './apps/Chrome';
import Messages from './apps/Messages';
import Lounge from './apps/Lounge';
import Notes from './apps/Notes';
import { SoundCloud, Spotify } from './apps/Music';
import { Instagram, XApp, LinkedIn, GitHub } from './apps/Social';
import BuyMeACoffee from './apps/BuyMeACoffee';
import Mail from './apps/Mail';
import Terminal from './apps/Terminal';
import Arcade from './apps/Arcade';
import CoxBox from './apps/CoxBox';
import Baduk from './apps/Baduk';
import Badminton from './apps/Badminton';
import BeatPad from './apps/BeatPad';
import PhotoBooth from './apps/PhotoBooth';
import { Trash, About } from './apps/Misc';

export type AppDef = {
  id: AppId;
  title: string;
  icon: IconKind;
  Component: ComponentType<AppProps>;
  w: number;
  h: number;
  /** 'overlay' lets the app draw under the title bar (traffic lights float over its own header) */
  frame?: 'standard' | 'overlay';
  theme?: 'light' | 'dark';
  /** On a computer, opened next to a game it docks down the right edge at this width, out of the game's way. */
  side?: number;
  dock?: boolean;
  /** A computer app (Finder, Terminal): left off the phone and iPad home screens and search, though links can still open it. */
  laptopOnly?: boolean;
  keywords?: string;
};

export const apps: Record<AppId, AppDef> = {
  finder: { id: 'finder', title: 'Finder', icon: 'finder', Component: Finder, w: 780, h: 470, frame: 'overlay', dock: true, laptopOnly: true, keywords: 'files folders school work projects' },
  chrome: { id: 'chrome', title: 'Chrome', icon: 'chrome', Component: Chrome, w: 1000, h: 640, frame: 'overlay', dock: true, keywords: 'browser web internet games arcade' },
  messages: { id: 'messages', title: 'Messages', icon: 'messages', Component: Messages, w: 430, h: 580, frame: 'overlay', dock: true, keywords: 'chat text imessage talk' },
  lounge: { id: 'lounge', title: 'Lounge', icon: 'lounge', Component: Lounge, w: 900, h: 600, side: 380, theme: 'dark', dock: true, keywords: 'chat global arcade lounge channels players friends find a game lfg ideas talk' },
  notes: { id: 'notes', title: 'Notes', icon: 'notes', Component: Notes, w: 700, h: 470, frame: 'overlay', dock: true, keywords: 'about me bio' },
  soundcloud: { id: 'soundcloud', title: 'SoundCloud', icon: 'soundcloud', Component: SoundCloud, w: 520, h: 600, theme: 'dark', dock: true, keywords: 'music kelix listen' },
  spotify: { id: 'spotify', title: 'Spotify', icon: 'spotify', Component: Spotify, w: 460, h: 560, theme: 'dark', dock: true, keywords: 'music album all i need listen' },
  instagram: { id: 'instagram', title: 'Instagram', icon: 'instagram', Component: Instagram, w: 400, h: 640, dock: true, keywords: 'photos atkelix joshuaykoo' },
  x: { id: 'x', title: 'X', icon: 'x', Component: XApp, w: 560, h: 620, theme: 'dark', dock: true, keywords: 'twitter tweets joshuaykoo' },
  linkedin: { id: 'linkedin', title: 'LinkedIn', icon: 'linkedin', Component: LinkedIn, w: 720, h: 620, dock: true, keywords: 'resume cv experience' },
  github: { id: 'github', title: 'GitHub', icon: 'github', Component: GitHub, w: 720, h: 580, theme: 'dark', dock: true, keywords: 'code repos jkdreamr' },
  coffee: { id: 'coffee', title: 'Buy Me a Coffee', icon: 'coffee', Component: BuyMeACoffee, w: 380, h: 560, frame: 'overlay', dock: true, keywords: 'buy me a coffee tip support joshuakoo' },
  mail: { id: 'mail', title: 'Mail', icon: 'mail', Component: Mail, w: 580, h: 480, dock: true, keywords: 'email contact' },
  terminal: { id: 'terminal', title: 'Terminal', icon: 'terminal', Component: Terminal, w: 660, h: 420, theme: 'dark', frame: 'overlay', dock: true, laptopOnly: true, keywords: 'shell zsh command line' },
  arcade: { id: 'arcade', title: 'Arcade', icon: 'arcade', Component: Arcade, w: 920, h: 640, dock: false, keywords: 'arcade games play chrome://games leaderboards snake chess 2048 sudoku pong blocks party group mafia imposter charades drinking kings cup' },
  coxbox: { id: 'coxbox', title: 'Cox Box', icon: 'coxbox', Component: CoxBox, w: 900, h: 620, theme: 'dark', dock: false, keywords: 'rowing stanford typing race regatta game multiplayer online wpm' },
  baduk: { id: 'baduk', title: 'Baduk', icon: 'baduk', Component: Baduk, w: 620, h: 680, theme: 'dark', dock: false, keywords: 'go baduk 바둑 board game strategy omok gomoku five in a row' },
  badminton: { id: 'badminton', title: 'Badminton', icon: 'badminton', Component: Badminton, w: 900, h: 560, theme: 'dark', dock: false, keywords: 'badminton shuttle racket court game sport' },
  beatpad: { id: 'beatpad', title: 'Beat Pad', icon: 'beatpad', Component: BeatPad, w: 820, h: 600, theme: 'dark', dock: false, keywords: 'beat pad music drum machine sequencer synth' },
  photobooth: { id: 'photobooth', title: 'Photo Booth', icon: 'photobooth', Component: PhotoBooth, w: 660, h: 560, theme: 'dark', dock: true, keywords: 'camera selfie photo' },
  trash: { id: 'trash', title: 'Trash', icon: 'trash', Component: Trash, w: 520, h: 330 },
  about: { id: 'about', title: 'About This Josh', icon: 'about', Component: About, w: 440, h: 520, keywords: 'about info specs' },
};

export const dockOrder: AppId[] = [
  'finder',
  'chrome',
  'messages',
  'lounge',
  'notes',
  'mail',
  'spotify',
  'soundcloud',
  'instagram',
  'x',
  'linkedin',
  'github',
  'coffee',
  'terminal',
  'photobooth',
];

export const mobileDock: AppId[] = ['messages', 'chrome', 'spotify', 'mail'];
export const games: AppId[] = ['arcade', 'coxbox', 'baduk', 'badminton', 'beatpad'];

export const tabletDock: AppId[] = ['messages', 'chrome', 'mail', 'notes', 'spotify', 'soundcloud', 'instagram'];
