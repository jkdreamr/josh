import { createContext, useContext } from 'react';
import type { FolderId } from './data';

export type AppId =
  | 'finder'
  | 'chrome'
  | 'messages'
  | 'notes'
  | 'soundcloud'
  | 'spotify'
  | 'instagram'
  | 'x'
  | 'linkedin'
  | 'github'
  | 'mail'
  | 'terminal'
  | 'coxbox'
  | 'baduk'
  | 'photobooth'
  | 'trash'
  | 'about';

export type OpenArgs = {
  folder?: FolderId;
  url?: string;
  note?: string;
  account?: 'personal' | 'music';
  /** bumps on every open() call so an already-open app can react to new args */
  nonce?: number;
};

export type OSApi = {
  open: (id: AppId, args?: OpenArgs) => void;
  close: (id: AppId) => void;
  openUrl: (url: string) => void;
  mobile: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  restart: () => void;
  sleep: () => void;
  openLauncher: () => void;
};

export const OSContext = createContext<OSApi | null>(null);

export function useOS(): OSApi {
  const ctx = useContext(OSContext);
  if (!ctx) throw new Error('useOS outside OSContext');
  return ctx;
}

export type AppProps = { args: OpenArgs };
