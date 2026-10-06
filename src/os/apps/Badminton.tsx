import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { awardPoint, COURT_HALF_LENGTH, createFlight, NET_HEIGHT, newMatch, planShot, serviceCourt, serveFault, SHORT_SERVICE_LINE, simulateLanding, stepFlight, type FlightState, type MatchFormat, type MatchState, type Side, type ShotType } from '../games/badminton';
import { useOS, type AppProps } from '../types';
import './game-controls.css';
import './Badminton.css';

type Athlete = { x: number; vx: number; jump: number; jumpVelocity: number; swingUntil: number; swingMode: 'normal' | 'up' | 'down' };
type Input = { left: boolean; right: boolean; up: boolean; down: boolean };
type SimState = {
  player: Athlete;
  cpu: Athlete;
  flight: FlightState | null;
  trail: Array<{ x: number; y: number }>;
  impact: { x: number; y: number; at: number } | null;
  rallyStart: number;
  rallyDuration: number;
  rallyMaxSpeed: number;
  cpuReactAt: number;
  cpuTarget: number;
  serveAt: number;
  call: string;
};
type RallyStats = { duration: number; speed: number };

const makeAthlete = (x: number): Athlete => ({ x, vx: 0, jump: 0, jumpVelocity: 0, swingUntil: 0, swingMode: 'normal' });
const makeSimulation = (): SimState => ({
  player: makeAthlete(-4),
  cpu: makeAthlete(4),
  flight: null,
  trail: [],
  impact: null,
  rallyStart: 0,
  rallyDuration: 0,
  rallyMaxSpeed: 0,
  cpuReactAt: 0,
  cpuTarget: 3,
  serveAt: -1,
  call: 'serve to start',
});

function opposite(side: Side): Side {
  return side === 'player' ? 'cpu' : 'player';
}

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(target, current + amount);
  return Math.max(target, current - amount);
}

function choosePlayerShot(mode: 'normal' | 'up' | 'down', contact: { x: number; y: number }, playerX: number): ShotType {
  if (mode === 'down') return contact.y < 1 ? 'net' : 'drop';
  if (mode === 'up') return contact.y >= 2.4 ? 'smash' : 'clear';
  if (contact.y >= 2.4) return 'smash';
  if (contact.y < 0.95 && Math.abs(contact.x) < 1.3) return 'net';
  return playerX < -4.7 ? 'clear' : 'drive';
}

function drawCourt(
  canvas: HTMLCanvasElement,
  sim: SimState,
  playerSwing: boolean,
  cpuSwing: boolean,
  now: number,
) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(rect.width * dpr);
  const pixelHeight = Math.round(rect.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const ground = height * 0.8;
  const scaleX = width * 0.9 / (COURT_HALF_LENGTH * 2);
  const scaleY = ground / 9;
  const originX = width / 2;

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#10181f');
  background.addColorStop(0.56, '#18242a');
  background.addColorStop(1, '#252b29');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.05, 2, width * 0.5, height * 0.18, width * 0.64);
  glow.addColorStop(0, 'rgba(226,224,202,.2)');
  glow.addColorStop(0.3, 'rgba(177,195,188,.1)');
  glow.addColorStop(1, 'rgba(157,180,175,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(2,7,11,.12)');
  vignette.addColorStop(0.7, 'rgba(2,7,11,0)');
  vignette.addColorStop(1, 'rgba(2,7,11,.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(originX, ground);
  ctx.scale(scaleX, -scaleY);

  const wood = ctx.createLinearGradient(0, -0.82, 0, 0);
  wood.addColorStop(0, '#332b25');
  wood.addColorStop(0.45, '#4b392b');
  wood.addColorStop(1, '#584334');
  ctx.fillStyle = wood;
  ctx.fillRect(-7.65, -0.82, 15.3, 0.82);
  ctx.strokeStyle = 'rgba(220,185,138,.15)';
  ctx.lineWidth = 0.012;
  for (const y of [-0.22, -0.43, -0.64]) {
    ctx.beginPath();
    ctx.moveTo(-7.55, y);
    ctx.lineTo(7.55, y);
    ctx.stroke();
  }
  for (const x of [-5.7, -2.4, 1.1, 4.8]) {
    ctx.beginPath();
    ctx.moveTo(x, -0.82);
    ctx.lineTo(x, -0.22);
    ctx.stroke();
  }

  ctx.fillStyle = '#285044';
  ctx.fillRect(-COURT_HALF_LENGTH, -0.18, COURT_HALF_LENGTH * 2, 0.18);
  ctx.fillStyle = 'rgba(217,229,197,.035)';
  ctx.fillRect(-COURT_HALF_LENGTH, -0.18, COURT_HALF_LENGTH * 2, 0.025);
  ctx.strokeStyle = 'rgba(237,241,221,.88)';
  ctx.lineWidth = 0.024;
  ctx.beginPath();
  ctx.moveTo(-COURT_HALF_LENGTH, 0);
  ctx.lineTo(COURT_HALF_LENGTH, 0);
  ctx.moveTo(-COURT_HALF_LENGTH, 0);
  ctx.lineTo(-COURT_HALF_LENGTH, 0.22);
  ctx.moveTo(COURT_HALF_LENGTH, 0);
  ctx.lineTo(COURT_HALF_LENGTH, 0.22);
  ctx.moveTo(-SHORT_SERVICE_LINE, 0);
  ctx.lineTo(-SHORT_SERVICE_LINE, 0.16);
  ctx.moveTo(SHORT_SERVICE_LINE, 0);
  ctx.lineTo(SHORT_SERVICE_LINE, 0.16);
  ctx.stroke();

  ctx.fillStyle = 'rgba(14,25,23,.18)';
  ctx.beginPath();
  ctx.ellipse(0, 0.04, 0.25, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(234,238,221,.12)';
  ctx.fillRect(-0.17, 0, 0.34, NET_HEIGHT);
  ctx.strokeStyle = 'rgba(236,240,224,.3)';
  ctx.lineWidth = 0.012;
  for (let y = 0.1; y < NET_HEIGHT - 0.06; y += 0.14) {
    ctx.beginPath();
    ctx.moveTo(-0.17, y);
    ctx.lineTo(0.17, y);
    ctx.moveTo(-0.17, y);
    ctx.lineTo(0.17, Math.min(NET_HEIGHT - 0.04, y + 0.14));
    ctx.moveTo(-0.17, Math.min(NET_HEIGHT - 0.04, y + 0.14));
    ctx.lineTo(0.17, y);
    ctx.stroke();
  }
  for (let x = -0.14; x <= 0.14; x += 0.07) {
    ctx.beginPath();
    ctx.moveTo(x, 0.03);
    ctx.lineTo(x, NET_HEIGHT - 0.04);
    ctx.stroke();
  }
  ctx.fillStyle = '#c9cbc1';
  ctx.fillRect(-0.205, 0, 0.04, NET_HEIGHT + 0.08);
  ctx.fillRect(0.165, 0, 0.04, NET_HEIGHT + 0.08);
  ctx.fillStyle = '#f1efe4';
  ctx.fillRect(-0.205, NET_HEIGHT - 0.025, 0.41, 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  ctx.moveTo(-0.205, NET_HEIGHT - 0.02);
  ctx.lineTo(0.205, NET_HEIGHT - 0.02);
  ctx.stroke();
  ctx.fillStyle = '#afb4aa';
  ctx.fillRect(-0.205, NET_HEIGHT + 0.08, 0.04, 0.045);
  ctx.fillRect(0.165, NET_HEIGHT + 0.08, 0.04, 0.045);

  const drawAthlete = (athlete: Athlete, side: Side, swinging: boolean) => {
    const facing = side === 'player' ? 1 : -1;
    const x = athlete.x;
    const lift = athlete.jump;
    const moving = Math.abs(athlete.vx) > 0.45;
    const stride = moving ? Math.sin(now * 0.018 + (side === 'cpu' ? Math.PI : 0)) * 0.1 : 0;
    const skin = side === 'player' ? '#d6ac91' : '#b5a99d';
    const jersey = side === 'player' ? '#8c1833' : '#68716f';
    const shorts = side === 'player' ? '#5f1728' : '#485250';

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#080e0d';
    ctx.beginPath();
    ctx.ellipse(x, 0.035, 0.3, 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, lift);
    ctx.rotate(moving ? -facing * 0.035 : 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(-0.15, 0.51);
    ctx.lineTo(-0.06, 0.5);
    ctx.lineTo(-0.11 + stride, 0.25);
    ctx.lineTo(-0.19 + stride, 0.06);
    ctx.lineTo(-0.29 + stride, 0.06);
    ctx.lineTo(-0.22 + stride, 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.06, 0.5);
    ctx.lineTo(0.15, 0.51);
    ctx.lineTo(0.2 - stride, 0.29);
    ctx.lineTo(0.28 - stride, 0.06);
    ctx.lineTo(0.18 - stride, 0.06);
    ctx.lineTo(0.1 - stride, 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e6e1d5';
    ctx.beginPath();
    ctx.ellipse(-0.23 + stride, 0.045, 0.105, 0.035, 0, 0, Math.PI * 2);
    ctx.ellipse(0.23 - stride, 0.045, 0.105, 0.035, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shorts;
    ctx.beginPath();
    ctx.moveTo(-0.17, 0.72);
    ctx.lineTo(0.17, 0.72);
    ctx.lineTo(0.15, 0.49);
    ctx.lineTo(0.02, 0.45);
    ctx.lineTo(0, 0.61);
    ctx.lineTo(-0.04, 0.45);
    ctx.lineTo(-0.16, 0.49);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.moveTo(-0.17, 0.68);
    ctx.lineTo(-0.24, 1.06);
    ctx.lineTo(-0.13, 1.19);
    ctx.lineTo(0.13, 1.19);
    ctx.lineTo(0.24, 1.06);
    ctx.lineTo(0.17, 0.68);
    ctx.quadraticCurveTo(0, 0.61, -0.17, 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = side === 'player' ? 'rgba(255,239,225,.23)' : 'rgba(255,255,255,.18)';
    ctx.fillRect(-0.035, 0.76, 0.07, 0.3);

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, 1.37, 0.13, 0, Math.PI * 2);
    ctx.fill();

    const racketX = facing * (swinging ? 0.72 : 0.58);
    const racketY = swinging ? 1.53 : 1.27;
    ctx.strokeStyle = skin;
    ctx.lineWidth = 0.105;
    ctx.beginPath();
    ctx.moveTo(facing * 0.16, 1.08);
    ctx.lineTo(racketX - facing * 0.18, racketY - 0.08);
    ctx.moveTo(-facing * 0.16, 1.04);
    ctx.lineTo(-facing * 0.34, 0.78);
    ctx.stroke();
    ctx.strokeStyle = '#ddd9ce';
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(racketX - facing * 0.2, racketY - 0.08);
    ctx.lineTo(racketX + facing * 0.08, racketY + 0.08);
    ctx.stroke();
    ctx.save();
    ctx.translate(racketX + facing * 0.13, racketY + 0.15);
    ctx.rotate(facing * -0.42);
    ctx.strokeStyle = '#ece9dc';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.18, 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235,235,222,.55)';
    ctx.lineWidth = 0.009;
    for (let line = -2; line <= 2; line += 1) {
      const offset = line * 0.045;
      ctx.beginPath();
      ctx.moveTo(offset, -0.085);
      ctx.lineTo(offset, 0.085);
      ctx.moveTo(-0.135, offset * 0.62);
      ctx.lineTo(0.135, offset * 0.62);
      ctx.stroke();
    }
    ctx.restore();

    if (swinging) {
      ctx.strokeStyle = 'rgba(245,233,197,.38)';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.arc(facing * 0.22, 1.05, 0.5, facing > 0 ? -0.86 : Math.PI + 0.86, facing > 0 ? 0.72 : Math.PI - 0.72);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawAthlete(sim.player, 'player', playerSwing);
  drawAthlete(sim.cpu, 'cpu', cpuSwing);

  if (sim.flight) {
    const shuttle = sim.flight.shuttle;
    if (sim.impact && now - sim.impact.at < 170) {
      const age = Math.max(0, now - sim.impact.at);
      const progress = age / 170;
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#fff1c2';
      ctx.lineWidth = 0.028;
      ctx.beginPath();
      ctx.arc(sim.impact.x, sim.impact.y, 0.18 + progress * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = ray * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(sim.impact.x + Math.cos(angle) * 0.23, sim.impact.y + Math.sin(angle) * 0.23);
        ctx.lineTo(sim.impact.x + Math.cos(angle) * (0.34 + progress * 0.12), sim.impact.y + Math.sin(angle) * (0.34 + progress * 0.12));
        ctx.stroke();
      }
      ctx.restore();
    }
    if (sim.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let index = 1; index < sim.trail.length; index += 1) {
        const alpha = (index / sim.trail.length) * 0.28;
        ctx.strokeStyle = `rgba(248,246,231,${alpha})`;
        ctx.lineWidth = 0.045 * (index / sim.trail.length);
        ctx.beginPath();
        ctx.moveTo(sim.trail[index - 1].x, sim.trail[index - 1].y);
        ctx.lineTo(sim.trail[index].x, sim.trail[index].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(shuttle.x, shuttle.y);
    ctx.rotate(Math.atan2(shuttle.vy, shuttle.vx));
    ctx.fillStyle = '#f5f3e8';
    ctx.beginPath();
    ctx.moveTo(-0.28, -0.13);
    ctx.lineTo(-0.05, -0.035);
    ctx.lineTo(0.06, -0.03);
    ctx.lineTo(0.06, 0.03);
    ctx.lineTo(-0.05, 0.035);
    ctx.lineTo(-0.28, 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(185,184,170,.8)';
    ctx.lineWidth = 0.012;
    for (const feather of [-0.09, -0.03, 0.03, 0.09]) {
      ctx.beginPath();
      ctx.moveTo(-0.25, feather);
      ctx.lineTo(-0.04, feather * 0.28);
      ctx.stroke();
    }
    ctx.fillStyle = '#eeeade';
    ctx.beginPath();
    ctx.ellipse(0.085, 0, 0.085, 0.052, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  if (sim.flight && sim.flight.shuttle.y > 9) {
    const markerX = Math.max(12, Math.min(width - 12, originX + sim.flight.shuttle.x * scaleX));
    ctx.fillStyle = 'rgba(246,243,227,.88)';
    ctx.beginPath();
    ctx.moveTo(markerX, 7);
    ctx.lineTo(markerX - 4, 14);
    ctx.lineTo(markerX + 4, 14);
    ctx.closePath();
    ctx.fill();
  }

  const serve = sim.flight === null;
  ctx.fillStyle = 'rgba(255,255,255,.64)';
  ctx.font = '10px ui-sans-serif, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(serve ? 'side view · singles' : 'side view · rally', 13, height - 12);
}

export default function Badminton(_: AppProps) {
  const os = useOS();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimState>(makeSimulation());
  const inputRef = useRef<Input>({ left: false, right: false, up: false, down: false });
  const matchRef = useRef<MatchState>(newMatch('casual'));
  const difficultyRef = useRef<'easy' | 'normal' | 'hard'>('normal');
  const touchHitStart = useRef<{ x: number; y: number } | null>(null);
  const [format, setFormat] = useState<MatchFormat>('casual');
  const [match, setMatch] = useState<MatchState>(matchRef.current);
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [stats, setStats] = useState<RallyStats>({ duration: 0, speed: 0 });
  const [call, setCall] = useState('serve to start');
  matchRef.current = match;
  difficultyRef.current = difficulty;

  const launchServe = useCallback((side: Side, now: number) => {
    const sim = simRef.current;
    const serverX = side === 'player' ? sim.player.x + 0.45 : sim.cpu.x - 0.45;
    const start = { x: serverX, y: 1.08 };
    const plan = planShot('serve', side, start);
    const fault = serveFault(start.y, plan.targetX, side) ?? plan.fault;
    if (fault) {
      sim.call = fault === 'serve-height' ? 'serve above the waist' : 'service fault';
      setCall(sim.call);
      const next = awardPoint(matchRef.current, opposite(side));
      matchRef.current = next;
      setMatch(next);
      sim.serveAt = next.matchWinner ? -1 : next.server === 'cpu' ? now + 650 : -1;
      return;
    }
    sim.flight = createFlight(start, plan.velocity, side, true);
    sim.trail = [];
    sim.impact = null;
    sim.rallyStart = now;
    sim.rallyDuration = 0;
    sim.rallyMaxSpeed = Math.hypot(plan.velocity.vx, plan.velocity.vy);
    sim.cpuReactAt = now + (difficultyRef.current === 'easy' ? 260 : difficultyRef.current === 'normal' ? 170 : 110);
    sim.call = side === 'player' ? 'your serve' : 'their serve';
    sim.serveAt = -1;
    setCall(sim.call);
  }, []);

  const endPoint = useCallback((winner: Side, resultCall: string, now: number) => {
    const sim = simRef.current;
    setStats({ duration: sim.rallyDuration, speed: sim.rallyMaxSpeed * 3.6 });
    sim.call = resultCall;
    sim.flight = null;
    sim.trail = [];
    setCall(resultCall);
    const next = awardPoint(matchRef.current, winner);
    matchRef.current = next;
    setMatch(next);
    sim.player = makeAthlete(-4);
    sim.cpu = makeAthlete(4);
    sim.serveAt = next.matchWinner ? -1 : next.server === 'cpu' ? now + 720 : -1;
  }, []);

  const startSwing = useCallback((mode: 'normal' | 'up' | 'down' = 'normal') => {
    const now = performance.now();
    const sim = simRef.current;
    if (!sim.flight) {
      if (matchRef.current.server === 'player' && !matchRef.current.matchWinner) launchServe('player', now);
      return;
    }
    sim.player.swingUntil = now + 180;
    sim.player.swingMode = mode;
  }, [launchServe]);

  const reset = (nextFormat = format) => {
    const next = newMatch(nextFormat);
    matchRef.current = next;
    setMatch(next);
    setFormat(nextFormat);
    simRef.current = makeSimulation();
    setStats({ duration: 0, speed: 0 });
    setCall('serve to start');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let previous = performance.now();
    let lastHud = previous;
    let accumulator = 0;

    const finishFlight = (flight: FlightState, now: number) => {
      if (flight.status === 'flying') return;
      const winner = flight.status === 'landed' ? flight.hitter : opposite(flight.hitter);
      const calls: Record<string, string> = {
        net: 'net fault',
        out: 'out',
        'own-side': 'didn’t clear the net',
        'short-service': 'short service fault',
      };
      endPoint(winner, flight.status === 'landed' ? 'in · point' : calls[flight.fault ?? 'out'], now);
    };

    const animate = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      accumulator += dt;
      const sim = simRef.current;
      const input = inputRef.current;
      const difficultyNow = difficultyRef.current;
      const cpuSpeed = difficultyNow === 'easy' ? 3 : difficultyNow === 'normal' ? 4.1 : 5;
      while (accumulator >= 1 / 240) {
        const step = 1 / 240;
        const playerDirection = Number(input.right) - Number(input.left);
        sim.player.vx = approach(sim.player.vx, playerDirection * 5, playerDirection ? 13 * step : 18 * step);
        sim.player.x = Math.max(-6.15, Math.min(-0.75, sim.player.x + sim.player.vx * step));
        if (input.up && sim.player.jump <= 0.001) sim.player.jumpVelocity = 5.2;
        sim.player.jump = Math.max(0, sim.player.jump + sim.player.jumpVelocity * step);
        sim.player.jumpVelocity -= 12.4 * step;
        if (sim.player.jump === 0 && sim.player.jumpVelocity < 0) sim.player.jumpVelocity = 0;

        const flight = sim.flight;
        if (flight?.status === 'flying') {
          const shuttle = flight.shuttle;
          const prediction = simulateLanding({ x: shuttle.x, y: shuttle.y }, { vx: shuttle.vx, vy: shuttle.vy });
          if (flight.hitter === 'player' && now >= sim.cpuReactAt) sim.cpuTarget = Math.max(0.8, Math.min(6.05, prediction.x));
          const cpuDirection = Math.sign(sim.cpuTarget - sim.cpu.x);
          sim.cpu.vx = approach(sim.cpu.vx, cpuDirection * cpuSpeed, cpuDirection ? 11 * step : 15 * step);
          sim.cpu.x = Math.max(0.75, Math.min(6.15, sim.cpu.x + sim.cpu.vx * step));
          if (shuttle.y > 2.1 && sim.cpu.jump < 0.04 && flight.hitter === 'player') sim.cpu.jumpVelocity = 4.8;
          sim.cpu.jump = Math.max(0, sim.cpu.jump + sim.cpu.jumpVelocity * step);
          sim.cpu.jumpVelocity -= 12.4 * step;
          if (sim.cpu.jump === 0 && sim.cpu.jumpVelocity < 0) sim.cpu.jumpVelocity = 0;

          const playerTurn = flight.hitter === 'cpu';
          const playerRacket = { x: sim.player.x + 0.55, y: 1.1 + sim.player.jump };
          const cpuRacket = { x: sim.cpu.x - 0.55, y: 1.1 + sim.cpu.jump };
          const within = (racket: { x: number; y: number }) => Math.hypot(shuttle.x - racket.x, shuttle.y - racket.y) < 0.94;
          const playerMode = sim.player.swingMode;
          if (playerTurn && sim.player.swingUntil >= now && within(playerRacket)) {
            const contact = { x: shuttle.x, y: Math.max(0.2, shuttle.y) };
            const shot = planShot(choosePlayerShot(playerMode, contact, sim.player.x), 'player', contact);
            sim.flight = createFlight(contact, shot.velocity, 'player');
            sim.trail = [];
            sim.impact = shot.type === 'smash' ? { ...contact, at: now } : sim.impact;
            sim.cpuReactAt = now + (difficultyNow === 'easy' ? 260 : difficultyNow === 'normal' ? 170 : 110);
            sim.player.swingUntil = 0;
            sim.call = `${shot.type} · nice`;
            setCall(sim.call);
          } else if (!playerTurn && now >= sim.cpuReactAt && within(cpuRacket)) {
            const contact = { x: shuttle.x, y: Math.max(0.2, shuttle.y) };
            const shotType: ShotType = contact.y >= 2.4 ? 'smash' : contact.y < 0.95 && Math.abs(contact.x) < 1.2 ? 'net' : Math.abs(sim.cpu.x) > 4.8 ? 'clear' : 'drive';
            const shot = planShot(shotType, 'cpu', contact);
            sim.flight = createFlight(contact, shot.velocity, 'cpu');
            sim.trail = [];
            sim.impact = shot.type === 'smash' ? { ...contact, at: now } : sim.impact;
            sim.cpuReactAt = Infinity;
            sim.call = `${shot.type} · returned`;
            setCall(sim.call);
          }
          sim.flight = stepFlight(sim.flight ?? flight, step);
          sim.rallyDuration = (now - sim.rallyStart) / 1000;
          sim.rallyMaxSpeed = Math.max(sim.rallyMaxSpeed, sim.flight.maxSpeed);
          if (sim.flight.status === 'flying') {
            const shuttle = sim.flight.shuttle;
            const last = sim.trail[sim.trail.length - 1];
            if (!last || Math.hypot(shuttle.x - last.x, shuttle.y - last.y) > 0.09) {
              sim.trail.push({ x: shuttle.x, y: shuttle.y });
              if (sim.trail.length > 6) sim.trail.shift();
            }
          }
          if (sim.flight.status !== 'flying') finishFlight(sim.flight, now);
        } else if (!matchRef.current.matchWinner && matchRef.current.server === 'cpu' && sim.serveAt >= 0 && now >= sim.serveAt) {
          launchServe('cpu', now);
        }
        accumulator -= step;
      }

      const playerSwing = sim.player.swingUntil >= now;
      const cpuSwing = !!sim.flight && sim.flight.hitter === 'cpu' && sim.cpuReactAt < now;
      drawCourt(canvas, sim, playerSwing, cpuSwing, now);
      if (now - lastHud > 120) {
        setStats({ duration: sim.rallyDuration, speed: sim.rallyMaxSpeed * 3.6 });
        lastHud = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [endPoint, launchServe]);

  useEffect(() => {
    const mapKey = (key: string): keyof Input | null => {
      if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'left';
      if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'right';
      if (key === 'ArrowUp' || key.toLowerCase() === 'w') return 'up';
      if (key === 'ArrowDown' || key.toLowerCase() === 's') return 'down';
      return null;
    };
    const keydown = (event: KeyboardEvent) => {
      const mapped = mapKey(event.key);
      const hitKey = event.code === 'Space' || event.key.toLowerCase() === 'j';
      if (!mapped && !hitKey) return;
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      if (mapped) inputRef.current[mapped] = true;
      if (hitKey) startSwing(inputRef.current.down ? 'down' : inputRef.current.up ? 'up' : 'normal');
    };
    const keyup = (event: KeyboardEvent) => {
      const mapped = mapKey(event.key);
      if (mapped) inputRef.current[mapped] = false;
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
    };
  }, [startSwing]);

  const setTouch = (key: keyof Input, value: boolean) => {
    inputRef.current[key] = value;
  };
  const serverName = match.server === 'player' ? 'you' : 'cpu';
  const serviceLabel = serviceCourt(match);
  const formatName = format === 'bwf' ? 'bwf · best of 3' : 'casual · to 11';

  return (
    <div className={`badminton-app gc-dark ${os.mobile ? 'is-mobile' : ''}`} style={{ '--tint': '#2f7d5b' } as CSSProperties}>
      <header className="badminton-header">
        <div className="badminton-brand"><h1>Stanford Badminton</h1></div>
        <div className="badminton-format gseg" aria-label="Match Format">
          <button aria-pressed={format === 'casual'} onClick={() => reset('casual')}>Quick 11</button>
          <button aria-pressed={format === 'bwf'} onClick={() => reset('bwf')}>BWF 21</button>
        </div>
      </header>
      <section className="badminton-scoreboard">
        <div className="badminton-player-score">
          <span className="badminton-name"><i className={match.server === 'player' ? 'is-serving' : ''} /> you</span>
          <strong>{match.points.player}</strong>
          <small>{match.games.player} games</small>
        </div>
        <div className="badminton-score-center">
          <span>game {match.game} · {match.bestOf === 3 ? 'best of 3' : 'one game'}</span>
          <b>{call}</b>
          <small>{match.matchWinner ? `${match.matchWinner === 'player' ? 'you' : 'cpu'} win the match` : `${serverName} serves · ${serviceLabel} court`}</small>
        </div>
        <div className="badminton-player-score is-cpu">
          <span className="badminton-name"><i className={match.server === 'cpu' ? 'is-serving' : ''} /> cpu <em>{difficulty}</em></span>
          <strong>{match.points.cpu}</strong>
          <small>{match.games.cpu} games</small>
        </div>
      </section>
      {match.intervalAt11 && Math.max(match.points.player, match.points.cpu) === 11 && format === 'bwf' && !match.matchWinner && <div className="badminton-interval">interval · take a breath</div>}
      {match.matchWinner && <div className="badminton-match-result">{match.matchWinner === 'player' ? 'you win' : 'cpu wins'} · <button className="gbtn" onClick={() => reset(format)}>Play Again</button></div>}
      <div className="badminton-stage">
        <canvas ref={canvasRef} aria-label="Badminton singles rally" />
        <div className="badminton-stage-hud">
          <span>{stats.duration.toFixed(1)}s rally</span>
          <span>max {Math.round(stats.speed)} km/h</span>
        </div>
      </div>
      <div className="badminton-toolbar">
        <div className="badminton-controls">
          <span className="ghelp badminton-help">{os.mobile ? 'Swipe up for a Smash or Clear · Swipe down for a Drop or Net Shot' : 'Move with A/D or ←/→ · Jump with W/↑ · Hit with Space/J'}</span>
          <div className="badminton-touch-controls">
            <button className="gpad gpad-secondary" title="Move Left (A or Left Arrow)" onPointerDown={() => setTouch('left', true)} onPointerUp={() => setTouch('left', false)} onPointerLeave={() => setTouch('left', false)}>Left</button>
            <button className="gpad gpad-secondary" title="Move Right (D or Right Arrow)" onPointerDown={() => setTouch('right', true)} onPointerUp={() => setTouch('right', false)} onPointerLeave={() => setTouch('right', false)}>Right</button>
            <button className="gpad gpad-secondary" title="Jump (W or Up Arrow)" onPointerDown={() => setTouch('up', true)} onPointerUp={() => setTouch('up', false)} onPointerLeave={() => setTouch('up', false)}>Jump</button>
          </div>
        </div>
        <div className="badminton-hit-controls">
          <button className="gpad badminton-hit-button" title="Hit (Space or J)" onPointerDown={(event) => { touchHitStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => {
            const start = touchHitStart.current;
            const delta = start ? event.clientY - start.y : 0;
            const mode = inputRef.current.down ? 'down' : inputRef.current.up ? 'up' : delta > 25 ? 'down' : delta < -25 ? 'up' : 'normal';
            startSwing(mode);
            touchHitStart.current = null;
          }}>
            Hit
          </button>
          <div className="badminton-hit-modes">
            <button className="gbtn" title="Hold for a Drop or Net Shot" onPointerDown={() => setTouch('down', true)} onPointerUp={() => setTouch('down', false)} onPointerLeave={() => setTouch('down', false)}>Drop</button>
            <button className="gbtn" title="Hold for a Smash or Clear" onPointerDown={() => setTouch('up', true)} onPointerUp={() => setTouch('up', false)} onPointerLeave={() => setTouch('up', false)}>Smash</button>
          </div>
        </div>
        <label className="badminton-difficulty">
          <span className="glabel">Opponent</span>
          <select className="ginput" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <div className="badminton-statline"><span>{formatName}</span><b>{stats.duration.toFixed(1)}s · {Math.round(stats.speed)} km/h</b></div>
      </div>
    </div>
  );
}
