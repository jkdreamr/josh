import { createContext } from 'react';

/** Provided by the host (the Chrome tab). Games pause when their tab is not the active one. */
export const ArcadeHost = createContext<{ active: boolean }>({ active: true });

/** Room code from an invite link, provided by GameFrame so every game's shell can join it without forwarding props. */
export const ArcadeInvite = createContext<string | undefined>(undefined);
