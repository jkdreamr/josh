import { createContext } from 'react';

/** Provided by the host (the Chrome tab). Games pause when their tab is not the active one. */
export const ArcadeHost = createContext<{ active: boolean }>({ active: true });
