// Vehicle dynamics for a modern hybrid open-wheeler. A planar rigid body (surge, sway, yaw) on four tyres, each with
// its own spin, load, temperature and combined-slip force (a Magic Formula curve over normalized slip), plus aero
// downforce and drag with DRS, load transfer, an 8-speed seamless gearbox with an auto clutch for launches, a rear
// limited-slip differential, brake bias, and an ERS battery. Integrated in fixed substeps. Pure, runs under node.
import { surfaceAt, wallAt, locate, type Circuit, type Surface } from './track.ts';

export const G = 9.81;
export const RHO = 1.2;

export const SPEC = {
  mass: 832, // kg with driver and a light fuel load
  izz: 1150, // yaw inertia, kg m^2
  wheelbase: 3.6,
  cgFront: 1.98, // cg to front axle (45% front weight)
  trackF: 1.6,
  trackR: 1.56,
  cgH: 0.3,
  /** Share of lateral load transfer taken by the front axle (roll stiffness balance). */
  rollF: 0.53,
  radius: 0.36,
  wheelI: 1.2,
  maxSteer: 0.3, // road wheel angle at full lock, rad
  ClA: 3.9,
  CdA: 0.98,
  aeroFront: 0.43,
  drsDrag: 0.16,
  drsDown: 0.1,
  roll: 0.012, // rolling resistance coefficient
  mu: 1.8, // peak friction at the reference load
  fz0: 2000,
  loadSens: 0.13,
  slipX: 0.11, // slip ratio at peak force
  slipY: 0.105, // slip angle at peak force (rad), about 6 degrees
  shapeC: 1.5,
  brakeTorque: 13500, // total at full pedal, N m
  brakeBias: 0.57,
  idle: 4000,
  limiter: 12500,
  shiftRpm: 12100,
  engineI: 0.12,
  // overall ratios (gearbox x final drive) for gears 1 to 8; 8th tops out near 355 km/h at the limiter
  ratios: [17.6, 14.2, 11.6, 9.65, 8.1, 6.8, 5.7, 4.72],
  efficiency: 0.93,
  ersPower: 120_000,
  ersStore: 4_000_000,
  ersDeployLap: 4_000_000,
  ersHarvestLap: 2_000_000,
  diffLock: 900, // N m per rad/s of speed difference across the rear axle
};

/** ICE torque at full throttle (N m) by rpm, a 1.6 litre turbo V6 around 560 kW. */
const TORQUE: [number, number][] = [
  [0, 160],
  [3000, 240],
  [5000, 330],
  [7000, 420],
  [9000, 480],
  [10500, 495],
  [11500, 470],
  [12500, 420],
  [13500, 300],
];
export function engineTorque(rpm: number) {
  if (rpm <= TORQUE[0][0]) return TORQUE[0][1];
  for (let i = 1; i < TORQUE.length; i++) {
    const [r1, t1] = TORQUE[i];
    if (rpm <= r1) {
      const [r0, t0] = TORQUE[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return TORQUE[TORQUE.length - 1][1];
}

export const SURFACE: Record<Surface, { grip: number; drag: number; bump: number }> = {
  asphalt: { grip: 1, drag: 0, bump: 0 },
  kerb: { grip: 0.93, drag: 0.004, bump: 1 },
  runoff: { grip: 0.88, drag: 0.004, bump: 0.15 },
  grass: { grip: 0.5, drag: 0.06, bump: 0.6 },
  gravel: { grip: 0.42, drag: 0.32, bump: 1 },
};

export type Wheel = {
  /** Spin rate, rad/s. */
  w: number;
  load: number;
  /** Tread temperature, deg C. */
  temp: number;
  slipX: number;
  slipY: number;
  /** Normalized combined slip (1 = peak grip). */
  slip: number;
  /** How hard the tyre is sliding, m/s (drives smoke and skid marks). */
  slide: number;
  surface: Surface;
  /** World position of the contact patch. */
  x: number;
  y: number;
  /** Lateral offset from the centerline. */
  d: number;
};

export type Car = {
  x: number;
  y: number;
  yaw: number;
  /** Body frame velocity (forward, left) and yaw rate. */
  vx: number;
  vy: number;
  r: number;
  /** Measured body accelerations (filtered), m/s^2. */
  ax: number;
  ay: number;
  steer: number;
  throttle: number;
  brake: number;
  /** 0 neutral, -1 reverse, 1..8. */
  gear: number;
  rpm: number;
  /** Seconds left in a gear change (torque is cut while shifting). */
  shifting: number;
  clutch: number;
  drs: boolean;
  ers: number;
  ersDeployed: number;
  ersHarvested: number;
  ersOn: boolean;
  wheels: Wheel[];
  /** Track position. */
  i: number;
  s: number;
  d: number;
  /** All four wheels past the white line right now. */
  offTrack: boolean;
  /** Impact speed of the latest wall hit this step (0 if none). */
  impact: number;
  /** Seconds since the car last touched a wall. */
  sinceHit: number;
  /** How rough the ground under the car is (0 smooth, 1 kerb or gravel). */
  bump: number;
  /** Seconds the car has been standing still. */
  sinceStill: number;
  /** 0 to 1: how deep in another car's wake this car is (less drag on straights, less downforce in corners). */
  tow: number;
  /** Share of drive torque traction control lets through (1 when it isn't cutting). */
  tc: number;
};

export type Input = {
  /** Steering, -1 full left to 1 full right. */
  steer: number;
  throttle: number;
  brake: number;
  shiftUp?: boolean;
  shiftDown?: boolean;
  drs?: boolean;
};

export type Assists = { tc: boolean; abs: boolean; autoGears: boolean };
export const NO_ASSISTS: Assists = { tc: false, abs: false, autoGears: false };

export const SUBSTEP = 1 / 400;

// wheel order: front left, front right, rear left, rear right; body frame +x forward, +y left
const WX = [SPEC.cgFront, SPEC.cgFront, SPEC.cgFront - SPEC.wheelbase, SPEC.cgFront - SPEC.wheelbase];
const WY = [SPEC.trackF / 2, -SPEC.trackF / 2, SPEC.trackR / 2, -SPEC.trackR / 2];

export function createCar(c: Circuit, x: number, y: number, yaw: number, speed = 0, tyreTemp = 85): Car {
  const wheels: Wheel[] = [0, 1, 2, 3].map(() => ({ w: speed / SPEC.radius, load: 0, temp: tyreTemp, slipX: 0, slipY: 0, slip: 0, slide: 0, surface: 'asphalt', x, y, d: 0 }));
  const spot = locate(c, x, y);
  const car: Car = {
    x,
    y,
    yaw,
    vx: speed,
    vy: 0,
    r: 0,
    ax: 0,
    ay: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    gear: speed > 1 ? gearFor(speed) : 1,
    rpm: SPEC.idle,
    shifting: 0,
    clutch: speed > 1 ? 1 : 0,
    drs: false,
    ers: SPEC.ersStore,
    ersDeployed: 0,
    ersHarvested: 0,
    ersOn: false,
    wheels,
    i: spot.i,
    s: spot.s,
    d: spot.d,
    offTrack: false,
    impact: 0,
    sinceHit: 99,
    bump: 0,
    sinceStill: 0,
    tow: 0,
    tc: 1,
  };
  car.rpm = wheelRpm(car) || SPEC.idle;
  return car;
}

/** The gear an auto box would pick at this speed. */
export function gearFor(v: number) {
  for (let g = 1; g <= 8; g++) {
    const rpm = (v / SPEC.radius) * SPEC.ratios[g - 1] * (60 / (2 * Math.PI));
    if (rpm < SPEC.shiftRpm - 900) return g;
  }
  return 8;
}

/** Engine speed the rear wheels would turn it at in the current gear. */
function wheelRpm(car: Car) {
  if (car.gear === 0) return 0;
  const ratio = car.gear < 0 ? -SPEC.ratios[0] : SPEC.ratios[car.gear - 1];
  return ((car.wheels[2].w + car.wheels[3].w) / 2) * ratio * (60 / (2 * Math.PI));
}

export const speedOf = (car: Car) => Math.hypot(car.vx, car.vy);
export const kmh = (car: Car) => Math.abs(car.vx) * 3.6;

/** Grip factor from tread temperature: full grip in the working window of about 90 to 114 C. */
export function tempGrip(t: number) {
  const off = Math.max(0, Math.abs(t - 102) - 12);
  return Math.max(0.72, 1 - (off / 55) ** 2);
}

/** Normalized Magic Formula: rises to 1 at s = 1 and falls off past it. */
const B = Math.tan(Math.PI / (2 * SPEC.shapeC));
export const curve = (s: number) => Math.sin(SPEC.shapeC * Math.atan(B * s));
const curveSlope = (s: number) => (SPEC.shapeC * B * Math.cos(SPEC.shapeC * Math.atan(B * s))) / (1 + B * B * s * s);

/** Peak friction coefficient of a tyre at load fz. */
export const muAt = (fz: number) => SPEC.mu * Math.pow(Math.max(fz, 200) / SPEC.fz0, -SPEC.loadSens);

export type StepEvents = { shifted?: number; impact?: number; limiter?: boolean };

/** Advances the car by dt seconds in fixed substeps. Returns what happened, for sounds and the HUD. */
export function stepCar(car: Car, input: Input, dt: number, c: Circuit, assists: Assists, drsAllowed: boolean): StepEvents {
  const ev: StepEvents = {};
  car.impact = 0;
  // gear requests and DRS are handled once per frame; the driver's inputs ramp like real pedals and a wheel
  if (assists.autoGears) {
    autoShift(car, input, ev);
    // with the auto box in reverse the pedals swap, so the brake backs the car up and the throttle stops it
    if (car.gear === -1) input = { ...input, throttle: input.brake, brake: input.throttle };
  } else {
    if (input.shiftUp) shift(car, 1, ev);
    if (input.shiftDown) shift(car, -1, ev);
  }
  // DRS opens on request inside a zone and shuts the moment the driver brakes or leaves it
  if (!drsAllowed || input.brake > 0.05) car.drs = false;
  else if (input.drs) car.drs = true;

  const steps = Math.max(1, Math.round(dt / SUBSTEP));
  const h = dt / steps;
  for (let k = 0; k < steps; k++) substep(car, input, h, c, assists);
  return ev;
}

function shift(car: Car, dir: number, ev: StepEvents) {
  const speed = car.vx;
  if (dir > 0) {
    if (car.gear >= 8) return;
    if (car.gear === -1) car.gear = 0;
    else car.gear = car.gear === 0 ? 1 : car.gear + 1;
  } else {
    if (car.gear <= -1) return;
    if (car.gear === 1 || car.gear === 0) {
      // reverse only from (almost) standstill
      if (car.gear === 1) car.gear = 0;
      else if (Math.abs(speed) < 1.5) car.gear = -1;
      ev.shifted = car.gear;
      return;
    }
    // a downshift that would over-rev the engine is refused, like the real gearbox
    const rpm = (Math.abs(speed) / SPEC.radius) * SPEC.ratios[car.gear - 2] * (60 / (2 * Math.PI));
    if (rpm > SPEC.limiter + 200) return;
    car.gear--;
  }
  car.shifting = 0.035;
  ev.shifted = car.gear;
}

function autoShift(car: Car, input: Input, ev: StepEvents) {
  if (car.shifting > 0) return;
  if (car.gear <= 0) {
    // reverse while the driver holds the brake at a standstill, forward again on the throttle
    if (car.gear === -1 && input.throttle > 0.1 && car.vx > -0.5) {
      car.gear = 1;
      ev.shifted = 1;
    }
    if (car.gear === 0) car.gear = 1;
    return;
  }
  if (car.gear === 1 && input.brake > 0.5 && input.throttle < 0.05 && car.sinceStill > 0.6) {
    car.gear = -1;
    ev.shifted = -1;
    return;
  }
  const rpm = car.rpm;
  if (rpm > SPEC.shiftRpm && car.gear < 8 && car.clutch >= 1) shift(car, 1, ev);
  // first is for launches and hairpins: the auto box keeps second above about 55 km/h
  else if (car.gear > 2 || (car.gear === 2 && car.vx < 15)) {
    const lower = (Math.abs(car.vx) / SPEC.radius) * SPEC.ratios[car.gear - 2] * (60 / (2 * Math.PI));
    // drop a gear once the lower one has room, keeping the engine near its torque peak on the way down
    if (lower < (car.brake > 0.2 ? 11300 : 9800)) shift(car, -1, ev);
  }
}

function substep(car: Car, input: Input, h: number, c: Circuit, assists: Assists) {
  const S = SPEC;
  // pedals and steering rack have a little travel time
  car.throttle += clampAbs(input.throttle - car.throttle, h * 9);
  car.brake += clampAbs(input.brake - car.brake, h * 14);
  const steerTarget = input.steer * S.maxSteer;
  car.steer += clampAbs(steerTarget - car.steer, h * 2.4);
  car.shifting = Math.max(0, car.shifting - h);
  car.sinceHit += h;
  const still = Math.abs(car.vx) < 0.3 && Math.abs(car.vy) < 0.3;
  car.sinceStill = still ? car.sinceStill + h : 0;

  const vx = car.vx;
  const vy = car.vy;
  const r = car.r;
  const speed = Math.hypot(vx, vy);

  // track position and what each wheel is on
  const spot = locate(c, car.x, car.y, car.i);
  car.i = spot.i;
  car.s = spot.s;
  car.d = spot.d;
  const cos = Math.cos(car.yaw);
  const sin = Math.sin(car.yaw);
  // lateral (left) unit vector of the track at this sample
  const nx = -c.ty[car.i];
  const ny = c.tx[car.i];
  let off = 0;
  let bump = 0;
  let rollDrag = 0;
  for (let k = 0; k < 4; k++) {
    const wh = car.wheels[k];
    wh.x = car.x + cos * WX[k] - sin * WY[k];
    wh.y = car.y + sin * WX[k] + cos * WY[k];
    wh.d = car.d + (wh.x - car.x) * nx + (wh.y - car.y) * ny;
    wh.surface = surfaceAt(c, car.i, wh.d);
    if (Math.abs(wh.d) > c.hw[car.i]) off++;
    const sf = SURFACE[wh.surface];
    bump += sf.bump / 4;
    rollDrag += sf.drag / 4;
  }
  car.offTrack = off === 4;
  car.bump = bump;

  // aero
  const drsOpen = car.drs;
  const q = 0.5 * RHO * vx * vx;
  const down = q * S.ClA * (drsOpen ? 1 - S.drsDown : 1) * (1 - car.tow * 0.18);
  const front = drsOpen ? S.aeroFront / (1 - S.drsDown) : S.aeroFront;
  const drag = q * S.CdA * (drsOpen ? 1 - S.drsDrag : 1) * (1 - car.tow * 0.3);

  // loads with longitudinal and lateral transfer from the filtered accelerations
  const m = S.mass;
  const L = S.wheelbase;
  const staticF = (m * G * (L - S.cgFront)) / L;
  const staticR = m * G - staticF;
  const longT = (m * car.ax * S.cgH) / L;
  const axleF = staticF + down * Math.min(front, 0.6) - longT;
  const axleR = staticR + down * (1 - Math.min(front, 0.6)) + longT;
  const latF = (m * car.ay * S.cgH * S.rollF) / S.trackF;
  const latR = (m * car.ay * S.cgH * (1 - S.rollF)) / S.trackR;
  const loads = [axleF / 2 - latF, axleF / 2 + latF, axleR / 2 - latR, axleR / 2 + latR];

  // powertrain: engine torque, clutch, gear, ERS
  const gear = car.gear;
  const ratio = gear === 0 ? 0 : gear < 0 ? -S.ratios[0] : S.ratios[gear - 1];
  const wr = wheelRpm(car);
  const thr = car.shifting > 0 ? car.throttle * 0.35 : car.throttle;
  let driveTorque = 0;
  let engineRpm = car.rpm;
  if (gear === 0) {
    car.clutch = 0;
    engineRpm += (S.idle + thr * (S.limiter - S.idle) - engineRpm) * Math.min(1, h * 6);
  } else {
    // the auto clutch slips below about 6000 rpm in the first two gears, so launches need throttle control
    const bite = 6200;
    const absWr = Math.abs(wr);
    if (absWr < bite && Math.abs(gear) <= 2) {
      // as the clutch bites, the engine is pulled down onto the wheels' speed, meeting it exactly at full engagement
      const launch = S.idle + thr * (bite + 2000 - S.idle);
      const bitten = Math.min(1, absWr / bite) ** 2;
      engineRpm += (Math.max(absWr, launch + (absWr - launch) * bitten) - engineRpm) * Math.min(1, h * 8);
      car.clutch = Math.min(1, absWr / bite);
      // a slipping clutch passes the engine's torque through while the engine is spinning faster than the wheels
      const slipping = engineRpm > absWr + 50;
      const te = slipping ? engineTorque(engineRpm) * thr : engineTorque(absWr) * thr - (1 - thr) * 30;
      driveTorque = te * ratio * S.efficiency * (thr > 0.02 || !slipping ? 1 : 0);
    } else {
      car.clutch = 1;
      engineRpm = absWr;
      let te = engineTorque(engineRpm) * thr - (1 - thr) * (35 + engineRpm * 0.006);
      if (engineRpm >= S.limiter) te = Math.min(te, -20);
      driveTorque = te * ratio * S.efficiency;
    }
  }
  car.rpm = Math.max(S.idle * 0.9, Math.min(S.limiter + 150, engineRpm));

  // ERS: deploys at full throttle while the lap allowance and battery last, harvests under braking
  car.ersOn = false;
  if (gear > 0 && thr > 0.92 && car.clutch >= 1 && car.ers > 0 && car.ersDeployed < S.ersDeployLap && car.rpm < S.limiter) {
    const wAvg = Math.max(20, (car.wheels[2].w + car.wheels[3].w) / 2);
    driveTorque += Math.min(S.ersPower / wAvg, 1400);
    const e = S.ersPower * h;
    car.ers -= e;
    car.ersDeployed += e;
    car.ersOn = true;
  }
  if (car.brake > 0.05 && vx > 5 && car.ers < S.ersStore && car.ersHarvested < S.ersHarvestLap) {
    const e = Math.min(S.ersPower, car.brake * S.ersPower * 1.5) * h;
    car.ers += e;
    car.ersHarvested += e;
  }

  // traction control trims drive torque as the rears near the limit, counting cornering slip too, and eases the
  // torque back in rather than snapping it on and off
  if (assists.tc && driveTorque > 0) {
    const rl = car.wheels[2];
    const rr = car.wheels[3];
    const over = Math.max(rl.slipX > 0 ? rl.slip : 0, rr.slipX > 0 ? rr.slip : 0) - 0.85;
    const want = over > 0 ? Math.max(0.1, 1 - over * 3) : 1;
    car.tc += (want - car.tc) * Math.min(1, h * (want < car.tc ? 60 : 8));
    driveTorque *= car.tc;
  } else car.tc = 1;

  // brakes, with ABS easing the pedal on a wheel that starts to lock
  const brakeTotal = car.brake * S.brakeTorque;
  const brakeT = [brakeTotal * S.brakeBias * 0.5, brakeTotal * S.brakeBias * 0.5, brakeTotal * (1 - S.brakeBias) * 0.5, brakeTotal * (1 - S.brakeBias) * 0.5];

  let fxB = 0;
  let fyB = 0;
  let mz = 0;
  const rearDiff = car.wheels[2].w - car.wheels[3].w;
  for (let k = 0; k < 4; k++) {
    const wh = car.wheels[k];
    const fz = Math.max(0, loads[k]);
    wh.load = fz;
    const delta = k < 2 ? car.steer * (k === 0 ? 1 + 0.08 * Math.sign(-car.steer) : 1 + 0.08 * Math.sign(car.steer)) : 0;
    // the steer input is positive to the right, which turns the wheel clockwise (negative about +z)
    const dl = -delta;
    const cvx = vx - r * WY[k];
    const cvy = vy + r * WX[k];
    const cd = Math.cos(dl);
    const sd = Math.sin(dl);
    const wvx = cd * cvx + sd * cvy;
    const wvy = -sd * cvx + cd * cvy;

    const den = Math.max(Math.abs(wvx), 3);
    const sx = (wh.w * S.radius - wvx) / den;
    const sa = Math.atan(wvy / den);
    wh.slipX = sx;
    wh.slipY = sa;
    const nX = sx / S.slipX;
    const nY = sa / S.slipY;
    const ns = Math.hypot(nX, nY);
    wh.slip = ns;
    const sf = SURFACE[wh.surface];
    const mu = muAt(fz) * tempGrip(wh.temp) * sf.grip;
    const peak = mu * fz;
    const f = ns > 1e-6 ? curve(ns) / ns : B * SPEC.shapeC;
    let fx = peak * f * nX;
    const fy = -peak * f * nY;

    // spin dynamics, semi-implicit in the tyre's longitudinal stiffness so it stays stable at any speed
    const rear = k >= 2;
    const inertia = S.wheelI + (rear && car.clutch > 0.5 && gear !== 0 ? (S.engineI * ratio * ratio) / 2 : 0);
    const torque = rear ? driveTorque / 2 - (k === 2 ? 1 : -1) * rearDiff * S.diffLock * 0.5 : 0;
    // past the peak the slope turns negative; the secant (force over slip) keeps the update damped there, so a
    // spinning or locked wheel settles instead of overshooting between the two
    const stiff = (peak * Math.max(curveSlope(ns), curve(ns) / Math.max(ns, 1e-3))) / S.slipX;
    const denom = 1 + (h * S.radius * S.radius * stiff) / (inertia * den);
    let w1 = wh.w + ((h / inertia) * (torque - S.radius * fx)) / denom;
    let bt = brakeT[k];
    if (assists.abs && bt > 0 && sx < -S.slipX * 0.8) bt *= Math.max(0, 1 - (-sx - S.slipX * 0.8) / (S.slipX * 0.3));
    const dw = ((h / inertia) * bt) / denom;
    if (w1 > 0) w1 = Math.max(0, w1 - dw);
    else w1 = Math.min(0, w1 + dw);
    wh.w = w1;
    // rolling resistance and surface drag act along the wheel
    fx -= Math.sign(wvx) * fz * (S.roll + rollDrag * 0.6) * Math.min(1, Math.abs(wvx));

    // tread temperature: sliding work heats it, airflow cools it
    const slideX = wh.w * S.radius - wvx;
    const slideV = Math.hypot(slideX, wvy);
    wh.slide = slideV;
    const heat = (Math.abs(fx * slideX) + Math.abs(fy * wvy)) * 0.000016 + fz * Math.abs(wvx) * 0.0000017;
    const cool = (wh.temp - 26) * (0.0036 + Math.abs(wvx) * 0.000105);
    wh.temp += (heat - cool) * h;

    // back to the body frame
    const bx = cd * fx - sd * fy;
    const by = sd * fx + cd * fy;
    fxB += bx;
    fyB += by;
    mz += WX[k] * by - WY[k] * bx;
  }

  // surface drag (gravel and grass) and aero drag
  fxB -= Math.sign(vx) * (drag + m * G * rollDrag * Math.min(1, Math.abs(vx) / 3));
  fyB -= vy * m * rollDrag * 0.5;

  const ax = fxB / m;
  const ay = fyB / m;
  // the body pitches and rolls on its springs, so the load transfer lags the forces slightly
  const lag = 1 - Math.exp(-h / 0.06);
  car.ax += (Math.max(-60, Math.min(60, ax)) - car.ax) * lag;
  car.ay += (Math.max(-60, Math.min(60, ay)) - car.ay) * lag;

  car.vx += (ax + r * vy) * h;
  car.vy += (ay - r * vx) * h;
  car.r += (mz / S.izz) * h;

  // parked: tyres hold the car still instead of creeping
  if (speed < 0.6 && car.throttle < 0.05) {
    const hold = Math.min(1, h * (car.brake > 0.05 ? 30 : 4));
    car.vx -= car.vx * hold;
    car.vy -= car.vy * hold;
    car.r -= car.r * hold;
    if (car.brake > 0.05) for (const wh of car.wheels) wh.w -= wh.w * hold;
  }

  const wx = cos * car.vx - sin * car.vy;
  const wy = sin * car.vx + cos * car.vy;
  car.x += wx * h;
  car.y += wy * h;
  car.yaw += car.r * h;

  // barriers: the car's corners are about 1 m beyond its center to each side
  const wall = wallAt(c, car.i, car.d);
  const reach = Math.abs(car.d) + 1.0;
  if (reach > wall) {
    const side = Math.sign(car.d) || 1;
    const push = reach - wall;
    car.x -= nx * side * push;
    car.y -= ny * side * push;
    // velocity into the wall is mostly lost, and scraping along it slows the car
    const into = (wx * nx + wy * ny) * side;
    if (into > 0) {
      const tvx = wx - nx * side * into;
      const tvy = wy - ny * side * into;
      const scrape = Math.max(0.55, 1 - into * 0.04);
      const nwx = tvx * scrape - nx * side * into * 0.2;
      const nwy = tvy * scrape - ny * side * into * 0.2;
      car.vx = cos * nwx + sin * nwy;
      car.vy = -sin * nwx + cos * nwy;
      car.r *= 0.6;
      car.r += -side * into * 0.04 * Math.sign(car.vx);
      for (const wh of car.wheels) wh.w = (car.vx / S.radius) * 0.95 + wh.w * 0.05;
      if (into > 1.5) {
        car.impact = Math.max(car.impact, into);
        car.sinceHit = 0;
      }
    }
  }
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** Shift lights: how far through the band before the shift point, 0 to 1. */
export const revBand = (car: Car) => Math.max(0, Math.min(1, (car.rpm - 9800) / (SPEC.shiftRpm - 9800)));
