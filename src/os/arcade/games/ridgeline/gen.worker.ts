// Builds a map off the main thread (terrain, towns, trees, baked light take most of a second), so the page stays
// responsive while it loads. Post a map id (and whether it is a royale); the world comes back with its big arrays
// transferred, not copied.
import type { MapId } from './maps.ts';
import { buildWorld } from './world.ts';

self.onmessage = (e: MessageEvent<{ id: MapId; royale: boolean }>) => {
  const w = buildWorld(e.data.id, e.data.royale);
  (self as unknown as Worker).postMessage(w, [w.terrain.h.buffer, w.light.buffer, w.minimap.data.buffer, w.grid.start.buffer, w.grid.items.buffer, w.region.buffer, w.loot.buffer, w.doors.buffer]);
};
