// The courses you can race: each is a loop of control points, where its pickups sit and how its sky looks. Pure, no
// three.js; the scene builds each course's scenery (scene.ts) and the logic races on its track (logic.ts).
import { EDGE, HAZARD_R, ROAD_HALF, ROUTE, START, buildTrack, layout as palmLayout, wrapS, type HazardKind, type Layout, type Track } from './track.ts';

export type CourseId = 'palm' | 'lake' | 'barn' | 'dish' | 'stadium';
export const COURSE_IDS: CourseId[] = ['palm', 'lake', 'barn', 'dish', 'stadium'];
export const isCourse = (v: unknown): v is CourseId => COURSE_IDS.includes(v as CourseId);

/** How hard a course is, for the picker: narrower roads, tighter bends and more in the way as it goes up. */
export const DIFFICULTY = ['Easy', 'Medium', 'Hard', 'Expert'] as const;
export type Difficulty = 1 | 2 | 3 | 4;

export type Course = {
  id: CourseId;
  name: string;
  /** One line for the picker. */
  blurb: string;
  difficulty: Difficulty;
  route: [number, number][];
  start: [number, number];
  /** Half the road's width and where the walls stand, if not Palm Drive's. */
  half?: number;
  edge?: number;
  /** Item boxes, coins, dash panels and ramps on this course's track. */
  layout: (t: Track) => Layout;
  /** The sky behind the 3D view (the canvas is transparent). */
  sky: string;
};

/**
 * Pickups by distance along the lap: rows of four item boxes, lines of coins [s, d, count], dash panels [s, d] and
 * ramps [s, d, width]. Distances are meters from the start line.
 */
function placed(
  t: Track,
  spec: {
    boxes: number[];
    coins: [number, number, number][];
    dashes: [number, number][];
    ramps: [number, number, number][];
    /** [kind, s, d, size], and for cows how far they wander, how fast and when they set off. */
    hazards?: [HazardKind, number, number, number?, number?, number?, number?][];
  },
): Layout {
  // a narrow road packs its row of boxes a little closer together
  const gap = Math.min(1.8, (t.half - 1.6) / 3);
  return {
    boxes: spec.boxes.flatMap((s) => [-3 * gap, -gap, gap, 3 * gap].map((d) => ({ s: wrapS(t, s), d }))),
    coins: spec.coins.flatMap(([s, d, count]) => Array.from({ length: count }, (_, k) => ({ s: wrapS(t, s + k * 3.2), d }))),
    dashes: spec.dashes.map(([s, d]) => ({ s: wrapS(t, s), d })),
    ramps: spec.ramps.map(([s, d, w]) => ({ s: wrapS(t, s), d, w })),
    hazards: (spec.hazards ?? []).map(([kind, s, d, r, swing, speed, phase]) => ({ kind, s: wrapS(t, s), d, r: r ?? HAZARD_R[kind], swing, speed, phase })),
  };
}

/** Lake Lagunita, scaled from map meters like Palm Drive's route. */
const LAKE_K = 0.7;
const LAKE: [number, number][] = [
  // along the dam, then north up the east shore
  [-60, -180], [60, -182], [160, -160], [215, -110], [238, -66], [230, -36], [204, -16],
  // out along the boathouse peninsula, round its tip and back
  [145, -18], [100, -18], [65, -3], [50, 32], [65, 67], [100, 82], [150, 84], [192, 88],
  // the north shore
  [226, 118], [234, 156], [214, 192], [160, 210], [90, 216], [0, 204], [-80, 224], [-150, 210], [-200, 182],
  // the reed esses down the west shore
  [-220, 132], [-210, 80], [-228, 20], [-212, -44], [-224, -112], [-176, -172],
];

/** The Red Barn: along the front of the barn, up through the paddocks, round the arena and back across the fields. */
const BARN_K = 0.9;
const BARN: [number, number][] = [
  // the front of the barn
  [-200, -150], [-60, -162], [80, -160], [170, -140],
  // the paddock esses
  [228, -92], [246, -30], [224, 28], [248, 88], [216, 148],
  // round the arena
  [200, 205], [150, 250], [88, 240], [58, 190], [60, 130],
  // across the fields and the long sweeper home
  [24, 70], [-50, 48], [-130, 72], [-200, 40], [-246, -20], [-246, -100],
];

/**
 * The Dish: up the foothills behind campus. Switchbacks climb to the ridge, it runs along the top past the big radio
 * telescope, then esses wind back down. Long and narrow, with cattle on the road.
 */
const DISH_K = 0.82;
const DISH: [number, number][] = [
  // the gate, and the first leg of the switchbacks
  [18, -205], [12, -150], [26, -114], [56, -97], [100, -96],
  // round the east hairpin and back along the second leg
  [150, -96], [178, -84], [190, -56], [178, -28], [150, -16], [60, -16],
  // the west hairpin and the third leg
  [0, -16], [-30, -4], [-43, 26], [-30, 56], [0, 68], [70, 70], [170, 72],
  // up onto the ridge and along the top past the Dish
  [222, 100], [230, 160], [180, 212], [80, 230], [-40, 230], [-130, 218],
  // the esses back down the west side
  [-178, 196], [-196, 150], [-180, 100], [-196, 48], [-174, -20], [-194, -92], [-160, -172],
  // and round the bottom to the gate
  [-132, -226], [-94, -262], [-44, -282], [2, -278], [22, -246],
];

/** Stanford Stadium: round the field inside the bowl, out through the tunnel, round the plaza and back in. */
const STADIUM_K = 0.85;
const STADIUM: [number, number][] = [
  // down the home straight in front of the west stand, and round the east end of the bowl
  [-100, -62], [0, -64], [100, -62], [169, -38], [182, -6], [176, 27], [153, 53], [120, 62],
  // back along the far side and out through the tunnel
  [40, 62], [-30, 64], [-80, 86], [-104, 140],
  // round the plaza and back in
  [-119, 186], [-145, 201], [-175, 198], [-199, 179], [-208, 150], [-208, 90], [-204, 10], [-176, -46],
];

export const COURSES: Record<CourseId, Course> = {
  palm: {
    id: 'palm',
    name: 'Palm Drive',
    blurb: 'Up Palm Drive, round the Oval and through the Arboretum.',
    difficulty: 1,
    route: ROUTE,
    start: START,
    layout: palmLayout,
    sky: 'linear-gradient(180deg, #2f5fae 0%, #6f9bdc 22%, #b9cfe6 34%, #f3d6b4 40%, #e9c99b 46%, #7da957 47%)',
  },
  lake: {
    id: 'lake',
    name: 'Lake Lagunita',
    blurb: 'Along the dam, out round the boathouse and through the reeds at sunset.',
    difficulty: 2,
    route: LAKE.map(([e, n]) => [e * LAKE_K, n * LAKE_K]),
    start: [-20 * LAKE_K, -181 * LAKE_K],
    layout: (t) =>
      placed(t, {
        boxes: [70, 380, 690],
        coins: [
          [18, -4, 6],
          [118, 3, 5],
          [296, 4, 6],
          [508, -3, 6],
          [596, 4, 4],
          [756, -3, 5],
          [846, 3, 5],
          [930, -4, 5],
        ],
        dashes: [
          [365, 0],
          [526, -2.5],
          [988, 2.5],
        ],
        // a dash panel straight into a jump on the north shore, and a kicker beside the dam
        ramps: [
          [546, -2.5, 10],
          [40, 4.6, 5.5],
        ],
      }),
    sky: 'linear-gradient(180deg, #2b2a5c 0%, #6b4b8f 18%, #e0748a 32%, #f6a96b 40%, #f7d6a0 46%, #8aa45f 47%)',
  },
  barn: {
    id: 'barn',
    name: 'Red Barn',
    blurb: 'A dirt road round the stables: hay bales to dodge, mud in the paddocks, a bog to blast through and a cow loose.',
    difficulty: 2,
    route: BARN.map(([e, n]) => [e * BARN_K, n * BARN_K]),
    start: [-150 * BARN_K, -160.5 * BARN_K],
    half: 7,
    edge: 11.5,
    layout: (t) =>
      placed(t, {
        boxes: [60, 560, 795],
        coins: [
          [20, -3, 6],
          [200, 0, 5],
          [300, 4, 5],
          [480, -3, 5],
          [620, 3, 5],
          [700, 3, 5],
          [860, 0, 4],
          [960, 3, 5],
          [1075, -3, 5],
        ],
        dashes: [
          [270, -3],
          [845, 0],
        ],
        // a jump over a mud puddle after the arena
        ramps: [[757, 0, 9]],
        hazards: [
          // a slalom of hay bales down the front of the barn, and one on the inside of the arena's exit
          ['hay', 120, -3.4],
          ['hay', 150, 3.4],
          ['hay', 180, -3.4],
          ['hay', 724, -3.2],
          // puddles through the paddock esses, one behind the jump and one waiting on the inside of the sweeper
          ['mud', 400, -3.4],
          ['mud', 462, 3.4],
          ['mud', 773, 0, 3],
          ['mud', 1040, -4.2],
          // and a cow that has wandered out of the field
          ['cow', 985, 0, undefined, 4.5, 0.45, 0],
          // the bog: right across the road, with a dash panel to blast through it
          ['mud', 872, -4.3, 3.6],
          ['mud', 872, 0, 3.6],
          ['mud', 872, 4.3, 3.6],
        ],
      }),
    sky: 'linear-gradient(180deg, #3d78c4 0%, #7fb0e3 24%, #cfe3ef 36%, #eedfb8 41%, #d9c38e 46%, #8fae5c 47%)',
  },
  dish: {
    id: 'dish',
    name: 'The Dish',
    blurb: 'Switchbacks up the foothills and along the ridge past the radio telescope. Narrow, long, and the cows are out.',
    difficulty: 3,
    route: DISH.map(([e, n]) => [e * DISH_K, n * DISH_K]),
    start: [16 * DISH_K, -196 * DISH_K],
    half: 6.5,
    edge: 10.5,
    layout: (t) =>
      placed(t, {
        boxes: [95, 430, 790, 1150],
        coins: [
          [20, 0, 5],
          [120, 3, 5],
          [300, -3, 5],
          [400, 2, 4],
          [540, 0, 5],
          [650, -2.5, 5],
          [850, 2.5, 5],
          [960, 0, 4],
          [1060, 0, 4],
          [1195, 2.5, 6],
          [1300, 2, 4],
        ],
        dashes: [
          [225, 0],
          [705, 2],
          [1100, -2],
        ],
        // a jump off the end of the third leg, and a kicker on the long run home
        ramps: [
          [520, 0, 8],
          [1255, 2, 6],
        ],
        hazards: [
          // cattle wandering over every leg of the climb, along the ridge and on the run home
          ['cow', 290, 0, undefined, 4.2, 0.55, 0],
          ['cow', 470, 0, undefined, 4.2, 0.6, 2],
          ['cow', 760, 0, undefined, 4.2, 0.5, 4],
          ['cow', 1180, 0, undefined, 4.2, 0.5, 1],
          // puddles waiting on the inside of both hairpins, and on the climb to the ridge
          ['mud', 183, -3.8, 2.8],
          ['mud', 365, 3.8, 2.8],
          ['mud', 640, 3, 3],
          ['mud', 1000, 0, 3],
          // boulders come down off the hillside
          ['rock', 840, 3.5],
          ['rock', 1220, -3.5],
        ],
      }),
    sky: 'linear-gradient(180deg, #2a6fc9 0%, #6aa6e6 22%, #bcd8ee 35%, #e9dcb0 41%, #d6bd7a 46%, #b7a45c 47%)',
  },
  stadium: {
    id: 'stadium',
    name: 'Stanford Stadium',
    blurb: 'A short, wide sprint round the field on game day, out through the tunnel and round the tailgates.',
    difficulty: 1,
    route: STADIUM.map(([e, n]) => [e * STADIUM_K, n * STADIUM_K]),
    start: [-40 * STADIUM_K, -63 * STADIUM_K],
    half: 10,
    edge: 15,
    layout: (t) =>
      placed(t, {
        boxes: [70, 300, 590],
        coins: [
          [10, -5, 6],
          [110, 5, 5],
          [180, 0, 5],
          [270, -5, 6],
          [360, 5, 4],
          [420, 0, 5],
          [500, -4, 5],
          [560, 4, 5],
          [680, 0, 6],
          [740, 5, 4],
        ],
        dashes: [
          [40, -4],
          [250, 4],
          [600, 0],
          [720, -4],
        ],
        // a big jump in front of the north stand, and a kicker beside the plaza straight
        ramps: [
          [330, 0, 12],
          [640, 5, 6],
        ],
      }),
    sky: 'linear-gradient(180deg, #1f5fbf 0%, #5d9be0 25%, #b5d3f0 38%, #e6e2d4 44%, #c9bd8a 46%, #6f9a52 47%)',
  },
};

const tracks = new Map<CourseId, Track>();
/** Each course's circuit, built once. */
export function trackOf(id: CourseId): Track {
  let t = tracks.get(id);
  if (!t) {
    const c = COURSES[id];
    t = buildTrack(c.route, c.start, c.half ?? ROAD_HALF, c.edge ?? EDGE);
    tracks.set(id, t);
  }
  return t;
}
