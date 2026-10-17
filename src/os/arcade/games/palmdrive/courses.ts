// The courses you can race: each is a loop of control points, where its pickups sit and how its sky looks. Pure, no
// three.js; the scene builds each course's scenery (scene.ts) and the logic races on its track (logic.ts).
import { EDGE, HAZARD_R, KART_R, PASTS, ROAD_HALF, ROUTE, START, WET, buildTrack, deltaS, layout as palmLayout, shoreOf, wrapS, type EdgeSpan, type HazardKind, type Layout, type Track } from './track.ts';

export type CourseId = 'palm' | 'lake' | 'barn' | 'dish' | 'stadium' | 'quad' | 'hoover' | 'golf';
export const COURSE_IDS: CourseId[] = ['palm', 'lake', 'barn', 'dish', 'stadium', 'quad', 'hoover', 'golf'];
export const isCourse = (v: unknown): v is CourseId => COURSE_IDS.includes(v as CourseId);

/** How hard a course is, for the picker: narrower roads, tighter bends and more in the way as it goes up. */
export const DIFFICULTY = ['Easy', 'Medium', 'Hard', 'Expert'] as const;
export type Difficulty = 1 | 2 | 3 | 4;

/**
 * How the race itself gets harder with the course, past what is on the road. pace: the CPUs' top speed, on top of
 * their own and the class's. band: how far the CPUs ease off when well ahead of you and push when well behind
 * ([slowest, fastest, over how many meters]); on the harder courses they hardly ease off at all. harsh: how much longer
 * a spin, a squash or a tumble lasts, whatever the cause. rocket: how often the CPUs nail a rocket start (times their
 * skill). fallT and fallCoins: what falling off the road costs, into water or a pit (seconds before you are back on
 * it, and coins). brink: where the road drops away with no wall, how far past the edge of the road the kart's middle can
 * go before it falls (on Expert about half the kart is over the drop by then).
 */
export type Tier = { pace: number; paceCc?: Partial<Record<'50cc' | '100cc' | '150cc' | '200cc', number>>; band: [number, number, number]; harsh: number; rocket: number; fallT: number; fallCoins: number; brink: number };
export const TIER: Record<Difficulty, Tier> = {
  1: { pace: 0.97, band: [0.9, 1.08, 600], harsh: 1, rocket: 0.6, fallT: 1.3, fallCoins: 1, brink: 1 },
  2: { pace: 0.98, band: [0.9, 1.08, 600], harsh: 1, rocket: 0.6, fallT: 1.3, fallCoins: 1, brink: 1 },
  3: { pace: 0.985, band: [0.93, 1.09, 500], harsh: 1.15, rocket: 0.75, fallT: 1.5, fallCoins: 2, brink: 1 },
  // (at 200cc the CPUs' usual 3% off the class pace is waived too: a good driver was still winning a quarter of races)
  4: { pace: 1.03, paceCc: { '200cc': 1 / 0.97 }, band: [0.97, 1.1, 450], harsh: 1.3, rocket: 0.9, fallT: 1.7, fallCoins: 3, brink: 0.6 },
};

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
  /** Anything about the course's tier (see TIER) that differs from its difficulty's. */
  tier?: Partial<Tier>;
  /** A line for the lap banner on the laps where something joins in (see Hazard.lap). */
  laps?: Record<number, string>;
  /** Where the walls give way to a drop (or stand somewhere else): everywhere else the walls stand at `edge`. */
  edges?: EdgeSpan[];
  /** The leaderboard the course's times go on, if not its id (a course rebuilt so its old times no longer compare). */
  board?: string;
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
    /** [kind, s, d, size], and for cows how far they wander, how fast and when they set off; then the lap it joins in. */
    hazards?: [HazardKind, number, number, number?, number?, number?, number?, number?][];
    /** Buses: [where it waits for the green light, its lane d, meters a second]. */
    buses?: [number, number, number][];
    /** Golf carts driving laps, the same way. */
    carts?: [number, number, number][];
    /**
     * Golf balls: [s, d where they land, every so many seconds, the first at, the tee: [along, across] from there],
     * and the lap they start on if not the first.
     */
    balls?: [number, number, number, number, number, number, number?][];
    /** Ponds beside the road: [s, d of the middle, radius]. */
    ponds?: [number, number, number][];
    /** Trenches right across the road: [s, meters long, d of the middle, meters either side of it, put back at s]. */
    holes?: [number, number, number, number, number][];
  },
): Layout {
  // a narrow road packs its row of boxes a little closer together
  const gap = Math.min(1.8, (t.half - 1.6) / 3);
  return {
    boxes: spec.boxes.flatMap((s) => [-3 * gap, -gap, gap, 3 * gap].map((d) => ({ s: wrapS(t, s), d }))),
    coins: spec.coins.flatMap(([s, d, count]) => Array.from({ length: count }, (_, k) => ({ s: wrapS(t, s + k * 3.2), d }))),
    dashes: spec.dashes.map(([s, d]) => ({ s: wrapS(t, s), d })),
    ramps: spec.ramps.map(([s, d, w]) => ({ s: wrapS(t, s), d, w })),
    hazards: [
      ...(spec.hazards ?? []).map(([kind, s, d, r, swing, speed, phase, lap]) => ({ kind, s: wrapS(t, s), d, r: r ?? HAZARD_R[kind], swing, speed, phase, ...(lap ? { lap } : {}) })),
      ...(spec.buses ?? []).map(([s, d, drive]) => ({ kind: 'bus' as const, s: wrapS(t, s), d, r: HAZARD_R.bus, drive })),
      ...(spec.carts ?? []).map(([s, d, drive]) => ({ kind: 'cart' as const, s: wrapS(t, s), d, r: HAZARD_R.cart, drive })),
      ...(spec.balls ?? []).map(([s, d, every, phase, along, across, lap]) => ({ kind: 'ball' as const, s: wrapS(t, s), d, r: HAZARD_R.ball, every, phase, tee: [along, across] as [number, number], ...(lap ? { lap } : {}) })),
      ...(spec.ponds ?? []).map(([s, d, r]) => ({ kind: 'water' as const, s: wrapS(t, s), d, r })),
      ...(spec.holes ?? []).map(([s, len, d, w, back]) => ({ kind: 'trench' as const, s: wrapS(t, s), d, r: w, len, w, back: wrapS(t, back) })),
    ],
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

/**
 * Straight legs joined by round corners: each corner [east, north, r] becomes an arc of radius r tangent to both legs,
 * so a course can turn square corners that still drive smoothly (and a hairpin can be tight where a sweeper is wide).
 */
function rounded(corners: [number, number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r] = corners[i];
    const [px, py] = corners[(i - 1 + n) % n];
    const [qx, qy] = corners[(i + 1) % n];
    const la = Math.hypot(x - px, y - py);
    const lb = Math.hypot(qx - x, qy - y);
    const [ax, ay, bx, by] = [(x - px) / la, (y - py) / la, (qx - x) / lb, (qy - y) / lb];
    // how far it turns (positive to the left), how far back from the corner the arc meets the leg in, and its middle
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    const back = r * Math.tan(Math.abs(turn) / 2);
    const side = Math.sign(turn);
    const cx = x - ax * back - ay * r * side;
    const cy = y - ay * back + ax * r * side;
    const from = Math.atan2(y - ay * back - cy, x - ax * back - cx);
    // a point every 15 degrees keeps the spline on the arc
    const steps = Math.max(1, Math.round(Math.abs(turn) / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) out.push([cx + Math.cos(from + (turn * k) / steps) * r, cy + Math.sin(from + (turn * k) / steps) * r]);
  }
  return out;
}
/** The same with one radius for every corner. */
const squared = (corners: [number, number][], r: number) => rounded(corners.map(([x, y]): [number, number, number] => [x, y, r]));

/**
 * The Main Quad: paths round the outside of the quad and in through the arcades, all square corners and short
 * straights. Along the front of Memorial Court, up the east side and in round the inner quad, out again and up to
 * the church, a chicane in front of its mosaic, then down the west side with another dog-leg through the arcades.
 */
const QUAD_K = 1.25;
const QUAD: [number, number][] = [
  // Memorial Court, and the dog-leg in round the east side of the inner quad
  [-95, -100], [60, -100], [60, -40], [0, -40], [0, 20], [80, 20],
  // up the east side to the head of the quad, and the chicane in front of the church
  [80, 100], [44, 100], [26, 85], [-4, 85], [-22, 100],
  // down the west side, with a dog-leg in through the arcades
  [-95, 100], [-95, 40], [-40, 40], [-40, -20], [-95, -20],
];

/**
 * Hoover Nights: campus after dark, rebuilt round three real hairpins. Corners [east, north, radius] in world meters: the
 * start straight down Serra Mall, the Tanner Fountain hairpin, back west to the Dig hairpin, the causeway over the Dig and
 * the Lasuen sweeper, up to the Claw hairpin, the esses and Memorial Church, and home down the west side.
 */
const HOOVER_K = 1.25;
const HOOVER: [number, number, number][] = [
  [-130, -120, 20], [84, -120, 14], [84, -92, 14], [-35, -92, 15], [-35, -62, 15], [130, -62, 40],
  [130, 91, 13], [104, 91, 13], [104, 22, 16], [50, 22, 22], [37.3, 44, 22], [-130, 44, 18],
];

/**
 * The Stanford Golf Course: off the first tee past the clubhouse with the driving range alongside, through the bunkers,
 * round the island green's pond, the dog-leg esses on the back nine and down the 18th fairway home. The loop round the
 * pond is points on a circle, so the water keeps an even distance from the road.
 */
const GOLF_K = 0.9;
const GOLF: [number, number][] = [
  // the first tee, past the clubhouse and the driving range, and the long sweeper north
  [-200, -160], [-60, -165], [80, -160], [160, -132], [200, -75],
  // the bunker esses
  [205, -10], [180, 45],
  // round the island green's pond
  [192, 102], [192, 148], [169, 187], [130, 210], [84, 210], [45, 187], [22, 148],
  // the dog-leg esses on the back nine
  [14, 100], [-24, 66], [-76, 84], [-120, 140],
  // and down the 18th fairway home
  [-180, 140], [-215, 90], [-232, 10], [-238, -70], [-224, -132],
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
    // the CPUs know their way round the bales and the bog, which makes the barn the harder of the two Medium courses
    // at the Medium pace: a touch slower keeps it Medium
    tier: { pace: 0.965 },
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
    // a short sprint on a wide road keeps the field bunched up, so the CPUs go a touch easier to leave it Easy
    tier: { pace: 0.955 },
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
  quad: {
    id: 'quad',
    name: 'Main Quad',
    blurb: 'Square corners round the sandstone arcades, a chicane at the church, and bikes everywhere. Tight and twisty.',
    difficulty: 3,
    route: squared(QUAD, 22).map(([e, n]) => [e * QUAD_K, n * QUAD_K]),
    start: [-40 * QUAD_K, -100.6 * QUAD_K],
    half: 6.5,
    edge: 10,
    layout: (t) =>
      placed(t, {
        boxes: [48, 350, 636],
        coins: [
          [14, 3, 5],
          [107, 2.5, 4],
          [168, 0, 4],
          [207, -2.5, 4],
          [276, -3, 5],
          [382, 2, 4],
          [430, -2, 5],
          [552, 3, 4],
          [612, -2, 4],
          [700, 3, 4],
          [808, -3, 4],
        ],
        dashes: [
          [522, 0],
          [852, -2],
        ],
        // a dash panel straight into a jump after the chicane, and a kicker down the west side
        ramps: [
          [540, 0, 8],
          [803, 3.5, 5],
        ],
        hazards: [
          // round planters with a tree in each, on the inside of the corners
          ['planter', 118, -3],
          ['planter', 224, 2.6],
          ['planter', 457, 2.4],
          ['planter', 588, -2.6],
          ['planter', 684, 2.6],
          // and cyclists riding across, back and forth between classes
          ['bike', 66, 0, undefined, 5, 1.1, 0],
          ['bike', 288, 0, undefined, 5, 1.2, 2],
          ['bike', 366, 0, undefined, 5, 1.1, 4],
          ['bike', 512, 0, undefined, 5, 1.25, 1],
          ['bike', 798, 0, undefined, 5, 0.8, 3],
        ],
      }),
    sky: 'linear-gradient(180deg, #2a68c4 0%, #6aa3e3 24%, #bcd6ee 36%, #f1dfbf 42%, #dcc596 46%, #c9b07e 47%)',
  },
  hoover: {
    id: 'hoover',
    name: 'Hoover Nights',
    blurb: 'Campus after dark: hairpins round the fountains, a plank road over the Dig, and no wall where you need one.',
    difficulty: 4,
    route: rounded(HOOVER).map(([e, n]) => [e * HOOVER_K, n * HOOVER_K]),
    start: [-60 * HOOVER_K, -120 * HOOVER_K],
    half: 6,
    edge: 8.5,
    // rebuilt round real hairpins and open edges in 2026: the old route's times are on the old boards
    board: 'hoover2',
    edges: [
      // Tanner Fountain, inside the first hairpin: cut the apex and you go fountain hopping
      [126, 180, -1, 'water'],
      // the Dig, round the inside of the second hairpin and along the causeway
      // (on to where the reflecting pool begins: no stub of wall between the two)
      [200, 431, 1, 'pit'],
      // the utility trench along the other side of the causeway: open on both sides here
      [330, 404, -1, 'pit'],
      // the reflecting pool, outside the sweeper
      [430, 488, 1, 'water'],
      // the Claw, inside the third hairpin
      [580, 632, -1, 'water'],
      // the Arboretum ditch, outside the left-hander and down the west side
      // (a little further out through the bend itself, so a late brake into L is not a fall)
      [894, 930, 1, 'pit', 7.2],
      [930, 972, 1, 'pit'],
    ],
    layout: (t) => {
      // cyclists cross the road while both Marguerites keep to the right-hand lane: each crosses a whole number of times
      // per bus lap, timed to be over on the far side as either bus comes by (an even number, as the buses are about
      // half a lap apart)
      const BUS_V = 11;
      const buses: [number, number, number][] = [
        [200, 3.6, BUS_V],
        [760, 3.6, BUS_V],
      ];
      const lap = t.length / BUS_V;
      const bike = (s: number, n: number): [HazardKind, number, number, number?, number?, number?, number?] => {
        const speed = (2 * Math.PI * n) / lap;
        const [a, b] = buses.map(([from]) => ((((s - from) % t.length) + t.length) % t.length) / BUS_V);
        // halfway between the two buses' turns (in the angle of the swing), at the far left of the swing
        const gap = ((((speed * (b - a)) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        return ['bike', s, 0, undefined, 5, speed, 1.5 * Math.PI - speed * a - gap / 2];
      };
      return placed(t, {
        boxes: [20, 196, 520, 790],
        coins: [
          [70, 3, 3],
          // bait on the fountain's lip, on the inside line by the water
          [136, -5.2, 4],
          // onto the right-hand plate over the trench
          [336, 3.4, 4],
          [450, -4, 3],
          [500, -3, 5],
          // bait on the Claw's lip
          [598, -4.4, 3],
          [700, 0, 4],
          [820, 3, 5],
          [880, -3, 4],
          [938, 3.5, 4],
          [1030, 0, 5],
          [1100, -3, 5],
        ],
        // a boost onto the causeway, open on both sides, and two down the long straights
        dashes: [
          [324, 0],
          [840, 0],
          [1000, 0],
        ],
        // the jump over the trench, and a kicker on the west straight
        ramps: [
          [394.5, 0, 4.4],
          [1011, 0, 5],
        ],
        holes: [[395, 6, 0, 2, 380]],
        hazards: [
          // the Thinker, dead in the middle of the Claw hairpin's apex: an inside line by the water or the outside one
          ['statue', 606, -0.2, 1.4],
          // oil on the inside of the turn after the Claw, and on the outside of the second bend of the esses
          ['oil', 680, 3],
          ['oil', 750, 3],
          // cyclists on their way across the quad
          bike(704, 18),
          bike(738, 20),
          bike(770, 16),
        ],
        // two Marguerites on their rounds, both in the right-hand lane
        buses,
      });
    },
    sky: 'linear-gradient(180deg, #03061a 0%, #0a1434 22%, #16264e 36%, #2a3a68 43%, #22325e 46%, #121a2a 47%)',
  },
  golf: {
    id: 'golf',
    name: 'Stanford Golf Course',
    blurb: 'Golf carts and golfers crossing, balls raining down off the tees, bunkers, water and an island green. The wildest yet.',
    difficulty: 4,
    route: GOLF.map(([e, n]) => [e * GOLF_K, n * GOLF_K]),
    start: [-120 * GOLF_K, -163 * GOLF_K],
    half: 6.5,
    edge: 10,
    layout: (t) => {
      // Three carts drive their rounds in the right-hand lane a third of a lap apart, so the left is always clear.
      // Everything that crosses the road keeps time with them: a whole number of crossings between one cart and the
      // next, timed to be over on the far side whenever one comes by.
      const cartV = 9;
      const third = t.length / 3;
      const every = third / cartV;
      // (a group walking together keeps time with the one at the front, at s0)
      const across = (kind: 'golfer' | 'cart', s: number, n: number, swing: number, size?: number, s0 = s, lap?: number): [HazardKind, number, number, number?, number?, number?, number?, number?] => {
        const speed = (2 * Math.PI * n) / every;
        const pass = ((((s0 - 180) % third) + third) % third) / cartV;
        return [kind, s, 0, size, swing, speed, -Math.PI / 2 - speed * pass, lap];
      };
      return placed(t, {
        boxes: [22, 285, 600, 812],
        coins: [
          [52, 3, 4],
          [175, -3, 5],
          [262, -2.5, 4],
          [320, 0, 4],
          [425, 3, 5],
          [515, 0, 3],
          [624, 2.5, 4],
          [700, -2.5, 4],
          [785, 0, 4],
          [862, -3, 4],
          [958, 3, 4],
          [1040, -3, 5],
          [1075, 3, 4],
        ],
        // boosts and jumps keep to the middle of the road, out of the carts' lanes; the jump down the 18th clears the
        // fairway bunker
        dashes: [
          [160, 0],
          [828, 0],
          [1065, 0],
        ],
        ramps: [
          [535, 0, 4.5],
          [846, 0, 5.5],
        ],
        hazards: [
          // the bunker esses, a bunker on each apex so the line slaloms, more on the apexes of the back nine, and one in
          // the middle of the 18th fairway that the jump clears
          ['sand', 310, -3.6],
          ['sand', 348, 3.6],
          ['sand', 388, -3.6],
          ['sand', 662, 3.6],
          ['sand', 752, -3.6],
          ['sand', 858, 0, 3],
          ['sand', 1028, -3.6],
          // carts crossing the road on the cart paths, and back
          across('cart', 205, 6, 4.8, 1.2),
          across('cart', 775, 6, 4.8, 1.2),
          // golfers walking across with their bags: a pair to the second tee, a foursome on the way to the island green
          // (one behind the other, in step), and a couple more on the back nine
          across('golfer', 255, 3, 4.6),
          across('golfer', 256.6, 3, 4.6, undefined, 255),
          ...[498, 499.6, 501.2, 502.8].map((at) => across('golfer', at, 3, 4.6, undefined, 498)),
          across('golfer', 690, 4, 4.6),
          across('golfer', 972, 3, 4.6),
          // and from the last lap the gallery that has been watching by the 18th green walks across it, all four
          ...[1016, 1017.6, 1019.2, 1020.8].map((at) => across('golfer', at, 3, 4.6, undefined, 1016, 5)),
          // the flagsticks where the road crosses two greens
          ['pin', 725, -2.6],
          ['pin', 1006, -2.4],
        ],
        carts: [
          [180, 3.8, cartV],
          [180 + third, 3.8, cartV],
          [180 + 2 * third, 3.8, cartV],
        ],
        // balls driven onto the road: four from the driving range across the first straight, more down the 18th,
        // and one off each of the tees in between. From the third lap the whole range is hitting (four more across the
        // rest of the straight), and on the last lap two more come down on the approach to the 18th green
        balls: [
          [45, 1.8, 4, 0.4, -6, 26],
          [75, -2.4, 4, 1.4, -6, 26],
          [105, 0.6, 4, 2.4, -6, 26],
          [135, -1.8, 4, 3.4, -6, 26],
          [230, 2, 5, 1.5, 20, 32],
          [455, 1.8, 5.5, 0.8, -15, 30],
          [580, -1.5, 5, 3.3, -10, 30],
          [640, -1, 4.5, 2.2, 10, -30],
          [880, 1.6, 4.5, 0.2, -12, 30],
          [905, -2, 5, 2.6, -12, 30],
          [935, 1, 4.5, 1.1, -12, 30],
          [965, -1.5, 5, 3.9, -12, 30],
          [178, 0, 4, 0.9, -6, 26, 3],
          [200, 2.2, 4, 2.9, -6, 26, 3],
          [215, -2.6, 4.5, 1.7, -6, 26, 3],
          [245, 1, 4, 3.7, -6, 26, 3],
          [985, 1.6, 4, 0.7, -12, 30, 5],
          [995, -1, 4.5, 2.2, -12, 30, 5],
        ],
        // the island green's pond on the inside of the loop, and the water down the left of the 18th: right up to the
        // curb, so one wheel over and you are in
        ponds: [
          [402.57, -62.54, 54.9],
          [915, -37.7, 30],
          [929, -37.7, 30],
          [943, -37.7, 30],
        ],
      });
    },
    sky: 'linear-gradient(180deg, #3a7fd0 0%, #85b8ea 24%, #d3e5f1 36%, #f6e3b6 42%, #e9cf96 46%, #5d9a3c 47%)',
    // a good line misses most of what is on the road here, so the CPUs need a touch more pace to keep up with one
    tier: { pace: 1.04 },
    laps: { 3: 'The range opens up', 5: 'The gallery at the 18th' },
  },
};

/** A course's tier: its difficulty's, with anything the course sets itself. */
export const tierOf = (id: CourseId): Tier => ({ ...TIER[COURSES[id].difficulty], ...COURSES[id].tier });

const tracks = new Map<CourseId, Track>();
/** Each course's circuit, built once, with its edges: where the road drops away and what into. */
export function trackOf(id: CourseId): Track {
  let t = tracks.get(id);
  if (!t) {
    const c = COURSES[id];
    t = buildTrack(c.route, c.start, c.half ?? ROAD_HALF, c.edge ?? EDGE);
    edgesOf(t, c);
    tracks.set(id, t);
  }
  return t;
}

/** Fills in a track's edges: the course's own spans, then its ponds and the steel plates over any trench. */
function edgesOf(t: Track, c: Course) {
  const set = (i: number, side: number, lim: number, code: number) => {
    if (side <= 0) {
      t.lo[i] = -lim;
      t.pastLo[i] = code;
    }
    if (side >= 0) {
      t.hi[i] = lim;
      t.pastHi[i] = code;
    }
  };
  const brink = t.half + tierOf(c.id).brink;
  for (const [s0, s1, side, past, at] of c.edges ?? []) {
    for (let i = 0; i < t.n; i++) if (i * t.step >= s0 && i * t.step <= s1) set(i, side, at ?? (past === 'wall' ? t.edge : brink), PASTS.indexOf(past));
  }
  // where a pond comes inside the wall line there is no wall: the kart is in once its middle is within WET of the water
  const lay = c.layout(t);
  const shore = shoreOf(t, lay.hazards);
  if (shore) {
    for (let i = 0; i < t.n; i++) {
      // (only where the water lies inside where a wall would hold the kart anyway: elsewhere the wall stands as before)
      if (shore.left[i] - WET < t.edge - KART_R) set(i, -1, shore.left[i] - WET, PASTS.indexOf('water'));
      if (shore.right[i] - WET < t.edge - KART_R) set(i, 1, shore.right[i] - WET, PASTS.indexOf('water'));
    }
  }
  // over a trench, steel plates take the road on either side of the hole, and past them it drops away (from the sample
  // before it to the one after, so the edge is the plates' all the way along it)
  for (const h of lay.hazards) {
    if (h.kind !== 'trench') continue;
    for (let i = 0; i < t.n; i++) {
      const ds = deltaS(t, h.s, i * t.step);
      if (ds > -t.step && ds < (h.len ?? 0) + t.step) set(i, 0, t.half - 0.4, PASTS.indexOf('pit'));
    }
  }
}
