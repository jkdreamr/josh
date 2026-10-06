import { useCallback, useEffect, useRef, useState } from 'react';
import { awardPoint, COURT_HALF_LENGTH, createFlight, NET_HEIGHT, newMatch, planShot, serviceCourt, serveFault, SHORT_SERVICE_LINE, simulateLanding, stepFlight, type FlightState, type MatchFormat, type MatchState, type Side, type ShotType } from '../games/badminton';
import { useOS, type AppProps } from '../types';
import './Badminton.css';

type Athlete = { x: number; vx: number; jump: number; jumpVelocity: number; swingUntil: number; swingMode: 'normal' | 'up' | 'down' };
type Input = { left: boolean; right: boolean; up: boolean; down: boolean };
type SimState = {
  player: Athlete;
  cpu: Athlete;
  flight: FlightState | null;
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
  const scale = Math.min(width / 15.5, height / 8.6);
  const ground = height * 0.84;
  const originX = width / 2;

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#121c27');
  background.addColorStop(0.72, '#17232b');
  background.addColorStop(1, '#24302f');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.32, 3, width * 0.5, height * 0.32, width * 0.6);
  glow.addColorStop(0, 'rgba(180,207,206,.10)');
  glow.addColorStop(1, 'rgba(180,207,206,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(originX, ground);
  ctx.scale(scale, -scale);
  ctx.fillStyle = '#263e3c';
  ctx.fillRect(-7.55, -0.72, 15.1, 0.72);
  ctx.fillStyle = 'rgba(186,207,186,.045)';
  ctx.fillRect(-COURT_HALF_LENGTH, 0, COURT_HALF_LENGTH * 2, 0.05);
  ctx.strokeStyle = 'rgba(226,235,214,.75)';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(-COURT_HALF_LENGTH, 0);
  ctx.lineTo(COURT_HALF_LENGTH, 0);
  ctx.moveTo(-COURT_HALF_LENGTH, 0.02);
  ctx.lineTo(-COURT_HALF_LENGTH, 0.18);
  ctx.moveTo(COURT_HALF_LENGTH, 0.02);
  ctx.lineTo(COURT_HALF_LENGTH, 0.18);
  ctx.moveTo(-SHORT_SERVICE_LINE, 0);
  ctx.lineTo(-SHORT_SERVICE_LINE, 0.11);
  ctx.moveTo(SHORT_SERVICE_LINE, 0);
  ctx.lineTo(SHORT_SERVICE_LINE, 0.11);
  ctx.moveTo(-COURT_HALF_LENGTH, 0.4);
  ctx.lineTo(COURT_HALF_LENGTH, 0.4);
  ctx.stroke();
  ctx.strokeStyle = '#dce4d3';
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, NET_HEIGHT);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(223,231,217,.38)';
  ctx.lineWidth = 0.018;
  for (let y = 0.12; y < NET_HEIGHT; y += 0.18) {
    ctx.beginPath();
    ctx.moveTo(-0.23, y);
    ctx.lineTo(0.23, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(243,238,219,.95)';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(-0.22, NET_HEIGHT);
  ctx.lineTo(0.22, NET_HEIGHT);
  ctx.stroke();

  const drawAthlete = (athlete: Athlete, side: Side, swinging: boolean) => {
    const facing = side === 'player' ? 1 : -1;
    const x = athlete.x;
    const lift = athlete.jump;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = side === 'player' ? '#f2ded0' : '#d1d6cf';
    ctx.lineWidth = 0.075;
    ctx.beginPath();
    ctx.moveTo(x - 0.08, lift + 0.43);
    ctx.lineTo(x - 0.19, 0.07);
    ctx.moveTo(x + 0.08, lift + 0.43);
    ctx.lineTo(x + 0.17, 0.07);
    ctx.stroke();
    ctx.fillStyle = side === 'player' ? '#a51e36' : '#64716d';
    ctx.beginPath();
    ctx.roundRect(x - 0.18, lift + 0.58, 0.36, 0.58, 0.1);
    ctx.fill();
    ctx.fillStyle = side === 'player' ? '#e2b194' : '#c8b8a6';
    ctx.beginPath();
    ctx.arc(x, lift + 1.34, 0.145, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = side === 'player' ? '#dfb093' : '#cbbba9';
    ctx.lineWidth = 0.065;
    const armStart = { x: x + facing * 0.13, y: lift + 1.02 };
    const racketX = x + facing * (swinging ? 0.78 : 0.61);
    const racketY = lift + (swinging ? 1.46 : 1.24);
    ctx.beginPath();
    ctx.moveTo(armStart.x, armStart.y);
    ctx.lineTo(racketX - facing * 0.18, racketY - 0.12);
    ctx.stroke();
    ctx.strokeStyle = '#dbe0d7';
    ctx.lineWidth = 0.026;
    ctx.beginPath();
    ctx.moveTo(racketX - facing * 0.2, racketY - 0.12);
    ctx.lineTo(racketX, racketY);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(racketX + facing * 0.07, racketY + 0.06, 0.18, 0.1, facing * -0.45, 0, Math.PI * 2);
    ctx.stroke();
    if (swinging) {
      ctx.strokeStyle = 'rgba(242,233,191,.55)';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.arc(x + facing * 0.28, lift + 1.04, 0.52, facing > 0 ? -0.9 : Math.PI + 0.9, facing > 0 ? 0.75 : Math.PI - 0.75);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawAthlete(sim.player, 'player', playerSwing);
  drawAthlete(sim.cpu, 'cpu', cpuSwing);

  if (sim.flight) {
    const shuttle = sim.flight.shuttle;
    ctx.save();
    ctx.translate(shuttle.x, shuttle.y);
    ctx.rotate(Math.atan2(shuttle.vy, shuttle.vx));
    ctx.strokeStyle = '#f1eee2';
    ctx.fillStyle = '#f7f4e7';
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(-0.18, -0.07);
    ctx.lineTo(0.05, 0);
    ctx.lineTo(-0.18, 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.03, 0);
    ctx.lineTo(0.19, 0);
    ctx.lineWidth = 0.065;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.2, 0, 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
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
            sim.cpuReactAt = now + (difficultyNow === 'easy' ? 260 : difficultyNow === 'normal' ? 170 : 110);
            sim.player.swingUntil = 0;
            sim.call = `${shot.type} · nice`;
            setCall(sim.call);
          } else if (!playerTurn && now >= sim.cpuReactAt && within(cpuRacket)) {
            const contact = { x: shuttle.x, y: Math.max(0.2, shuttle.y) };
            const shotType: ShotType = contact.y >= 2.4 ? 'smash' : contact.y < 0.95 && Math.abs(contact.x) < 1.2 ? 'net' : Math.abs(sim.cpu.x) > 4.8 ? 'clear' : 'drive';
            const shot = planShot(shotType, 'cpu', contact);
            sim.flight = createFlight(contact, shot.velocity, 'cpu');
            sim.cpuReactAt = Infinity;
            sim.call = `${shot.type} · returned`;
            setCall(sim.call);
          }
          sim.flight = stepFlight(sim.flight ?? flight, step);
          sim.rallyDuration = (now - sim.rallyStart) / 1000;
          sim.rallyMaxSpeed = Math.max(sim.rallyMaxSpeed, sim.flight.maxSpeed);
          if (sim.flight.status !== 'flying') finishFlight(sim.flight, now);
        } else if (!matchRef.current.matchWinner && matchRef.current.server === 'cpu' && sim.serveAt >= 0 && now >= sim.serveAt) {
          launchServe('cpu', now);
        }
        accumulator -= step;
      }

      const playerSwing = sim.player.swingUntil >= now;
      const cpuSwing = !!sim.flight && sim.flight.hitter === 'cpu' && sim.cpuReactAt < now;
      drawCourt(canvas, sim, playerSwing, cpuSwing);
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
    <div className={`badminton-app ${os.mobile ? 'is-mobile' : ''}`}>
      <header className="badminton-header">
        <div className="badminton-brand"><span>kelix arcade</span><h1>badminton</h1></div>
        <div className="badminton-format" aria-label="match format">
          <button className={format === 'casual' ? 'is-selected' : ''} onClick={() => reset('casual')}>quick 11</button>
          <button className={format === 'bwf' ? 'is-selected' : ''} onClick={() => reset('bwf')}>bwf 21</button>
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
      {match.matchWinner && <div className="badminton-match-result">{match.matchWinner === 'player' ? 'you win' : 'cpu wins'} · <button onClick={() => reset(format)}>play again</button></div>}
      <div className="badminton-stage">
        <canvas ref={canvasRef} aria-label="Badminton singles rally" />
        <div className="badminton-stage-hud">
          <span>{stats.duration.toFixed(1)}s rally</span>
          <span>max {Math.round(stats.speed)} km/h</span>
        </div>
      </div>
      <div className="badminton-toolbar">
        <div className="badminton-controls">
          <span className="badminton-desktop-hint">move ← → / A D <b>jump ↑ / W</b> hit <kbd>space</kbd> / <kbd>J</kbd></span>
          <div className="badminton-touch-controls">
            <button aria-label="move left" onPointerDown={() => setTouch('left', true)} onPointerUp={() => setTouch('left', false)} onPointerLeave={() => setTouch('left', false)}>←</button>
            <button aria-label="move right" onPointerDown={() => setTouch('right', true)} onPointerUp={() => setTouch('right', false)} onPointerLeave={() => setTouch('right', false)}>→</button>
            <button aria-label="jump" onPointerDown={() => setTouch('up', true)} onPointerUp={() => setTouch('up', false)} onPointerLeave={() => setTouch('up', false)}>jump</button>
          </div>
        </div>
        <div className="badminton-hit-controls">
          <button className="badminton-hit-button" onPointerDown={(event) => { touchHitStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => {
            const start = touchHitStart.current;
            const delta = start ? event.clientY - start.y : 0;
            startSwing(delta > 25 ? 'down' : delta < -25 ? 'up' : 'normal');
            touchHitStart.current = null;
          }}>
            hit
            <small>swipe up smash / clear · down drop / net</small>
          </button>
          <div className="badminton-hit-modes">
            <button onPointerDown={() => setTouch('down', true)} onPointerUp={() => setTouch('down', false)} onPointerLeave={() => setTouch('down', false)}>hold for drop</button>
            <button onClick={() => startSwing('up')}>smash / clear</button>
          </div>
        </div>
        <label className="badminton-difficulty">
          <span>opponent</span>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>
            <option value="easy">easy</option>
            <option value="normal">normal</option>
            <option value="hard">hard</option>
          </select>
        </label>
        <div className="badminton-statline"><span>{formatName}</span><b>{stats.duration.toFixed(1)}s · {Math.round(stats.speed)} km/h</b></div>
      </div>
    </div>
  );
}
