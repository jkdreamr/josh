import { createContext, useContext } from 'react';
import type { FolderId } from './data';

export type AppId =
  | 'finder'
  | 'chrome'
  | 'messages'
  | 'lounge'
  | 'notes'
  | 'soundcloud'
  | 'spotify'
  | 'instagram'
  | 'x'
  | 'linkedin'
  | 'github'
  | 'coffee'
  | 'mail'
  | 'terminal'
  | 'arcade'
  | 'coxbox'
  | 'baduk'
  | 'badminton'
  | 'beatpad'
  | 'photobooth'
  | 'trash'
  | 'about';

export type OpenArgs = {
  folder?: FolderId;
  url?: string;
  note?: string;
  account?: 'personal' | 'music';
  beat?: string;
  game?: 'go' | 'omok';
  /** arcade game id the Arcade app opens straight into */
  play?: string;
  /** online room code from an invite link (Baduk, Badminton and Cox Box), or one to join in the Arcade with `play` */
  room?: string;
  /** a room to share in the Lounge, which opens on #find-a-game with it attached */
  invite?: { game: string; code: string };
  /** bumps on every open() call so an already-open app can react to new args */
  nonce?: number;
};

/** Screen-space rectangle (px, relative to the display) an app zooms out of and back into. */
export type Origin = { x: number; y: number; w: number; h: number };

export type OSApi = {
  open: (id: AppId, args?: OpenArgs, from?: Origin) => void;
  close: (id: AppId) => void;
  openUrl: (url: string) => void;
  mobile: boolean;
  tablet: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  restart: () => void;
  sleep: () => void;
  /** Shuts the lid (3D laptop) or puts the device to sleep. */
  closeLid: () => void;
  openLauncher: () => void;
  /** True while an app holds a live camera stream (lights the camera indicator). */
  camera: boolean;
  setCamera: (on: boolean) => void;
};

export const OSContext = createContext<OSApi | null>(null);

export function useOS(): OSApi {
  const ctx = useContext(OSContext);
  if (!ctx) throw new Error('useOS outside OSContext');
  return ctx;
}

export type AppProps = { args: OpenArgs };

/** The window an app is drawn in: whether it's the front window, and whether it's minimized. */
export type WinState = { active: boolean; min: boolean };
export const WinContext = createContext<WinState>({ active: true, min: false });

export function useWin(): WinState {
  return useContext(WinContext);
}
