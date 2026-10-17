// One module per circle. Each gets a Dress from the scene and adds its own detail; see ../decor.ts for the contract.
import type { Dresser } from '../decor';
import type { Zone } from '../level';
import { dressCatacombs } from './catacombs';
import { dressCathedral } from './cathedral';
import { dressForge } from './forge';
import { dressFrost } from './frost';
import { dressPit } from './pit';
import { dressStars } from './stars';

export const DRESSERS: Record<Zone['id'], Dresser> = {
  pit: dressPit,
  catacombs: dressCatacombs,
  forge: dressForge,
  frost: dressFrost,
  cathedral: dressCathedral,
  stars: dressStars,
};
