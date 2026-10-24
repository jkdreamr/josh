import type { MicroGame } from './types.ts';
import { bikeCircle } from './bike-circle.ts';
import { burrito } from './burrito.ts';
import { squirrel } from './squirrel.ts';
import { tree } from './tree.ts';
import { fountain } from './fountain.ts';
import { snooze } from './snooze.ts';
import { signHere } from './sign-here.ts';
import { hoover } from './hoover.ts';
import { marguerite } from './marguerite.ts';
import { coffee } from './coffee.ts';
import { cardSwipe } from './card-swipe.ts';
import { axe } from './axe.ts';

/** Every micro-game, in a fixed order every client agrees on (schedules index into it). */
export const MICRO: readonly MicroGame[] = [bikeCircle, burrito, squirrel, tree, fountain, snooze, signHere, hoover, marguerite, coffee, cardSwipe, axe];
export const microById = new Map(MICRO.map((m) => [m.id, m]));
