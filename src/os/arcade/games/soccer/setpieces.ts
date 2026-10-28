import { clubById, DEFAULT_CLUBS } from './teams.ts';

import { FIELD, distance, kick, movePlayer, restartTaker, rng, setRestart, teamDir, transferControl, type Action, type Command, type Player, type Point, type Team, type World } from './logic.ts';
import { stepBall } from './physics.ts';

export type SetPiece = { kind: 'corner' | 'free-kick' | 'penalty' | 'goal-kick' | 'throw-in'; option: string; aim: Point & { y: number }; curl: -1 | 0 | 1; direct: boolean; takerId: number; wall: number[]; keeperDive: -1 | 0 | 1 | null; cpuDelay: number; marks?: Record<number, number> };
export type SetPieceRun = { t: number; kind: string; runs: Record<number, Point>; marks: Record<number, number>; wall: number[]; penalty?: { keeperId: number; side: -1 | 0 | 1; t: number } };
export type Shootout = { kicks: [boolean[], boolean[]]; turn: Team; first: Team; done: boolean; winner: Team | null; round: number; pause?: number; flight?: number };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const side = (n: number): -1 | 0 | 1 => n < -0.15 ? -1 : n > 0.15 ? 1 : 0;
const opposition = (team: Team): Team => team === 0 ? 1 : 0;
const goal = (w: World) => teamDir(w.restartTeam, w.endsSwapped) * FIELD.length / 2;
const snap = (p: Player, x: number, z: number) => { p.x = clamp(x, -52.35, 52.35); p.z = clamp(z, -33.85, 33.85); p.vx = p.vz = 0; p.action = 'idle'; p.cooldown = 0; p.touchCd = 0; };
const options = (s: SetPiece) => s.kind === 'corner' ? ['near', 'far', 'spot', 'short'] : s.kind === 'free-kick' ? (s.direct ? ['direct', 'cross', 'short'] : ['cross', 'short']) : s.kind === 'penalty' ? ['shot'] : ['short', 'long'];
function preset(w: World) {
  const s = w.setPiece!;
  const d = teamDir(w.restartTeam, w.endsSwapped), g = goal(w), flank = Math.sign(w.restartAt.z || 1);
  if (s.kind === 'penalty' || s.option === 'direct') s.aim = { x: g, z: -flank * 2.8, y: 1.2 };
  else if (s.kind === 'corner') s.aim = s.option === 'short' ? { x: w.restartAt.x - d * 4, z: w.restartAt.z - flank * 4, y: 0.11 } : { x: g - d * (s.option === 'spot' ? 11 : 6.5), z: s.option === 'near' ? flank * 5 : s.option === 'far' ? -flank * 5 : 0, y: 1.8 };
  else if (s.kind === 'goal-kick') s.aim = { x: s.option === 'short' ? -g + d * 17 : d * 4, z: 13, y: s.option === 'short' ? 0.11 : 1.8 };
  else if (s.kind === 'throw-in') s.aim = { x: clamp(w.restartAt.x + d * (s.option === 'short' ? 7 : 22), -45, 45), z: w.restartAt.z - flank * 8, y: 1.2 };
  else s.aim = { x: s.option === 'short' ? w.restartAt.x + d * 6 : g - d * 10, z: s.option === 'short' ? w.restartAt.z + 4 : -flank * 5, y: 1.8 };
}
function exclude(w: World, p: Player) {
  const dx = p.x - w.restartAt.x, dz = p.z - w.restartAt.z, r = Math.hypot(dx, dz);
  if (r < 9.15) { const a = r ? dx / r : -teamDir(w.restartTeam, w.endsSwapped); p.x = w.restartAt.x + a * 9.16; p.z = w.restartAt.z + (r ? dz / r : 0) * 9.16; }
  p.x = clamp(p.x, -52.35, 52.35); p.z = clamp(p.z, -33.85, 33.85);
}
const SET_PIECE_GAP = 0.75;
function spaceOut(w: World, taker: Player) {
  const active = w.players.filter(p => !p.sentOff), wall = w.setPiece?.wall ?? [];
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!, b = active[j]!, gap = distance(a, b);
      if (gap >= SET_PIECE_GAP || wall.includes(a.id) && wall.includes(b.id)) continue;
      const dx = gap > 1e-6 ? (b.x - a.x) / gap : 0, dz = gap > 1e-6 ? (b.z - a.z) / gap : (a.id < b.id ? 1 : -1);
      const push = SET_PIECE_GAP - gap + 1e-3, pinned = (p: Player) => p.id === taker.id || wall.includes(p.id);
      const share = pinned(a) ? 0 : pinned(b) ? 1 : 0.5;
      const clear = [a, b].map(p => p.team !== w.restartTeam && distance(p, w.restartAt) >= 9.15);
      a.x -= dx * push * share; a.z -= dz * push * share;
      b.x += dx * push * (1 - share); b.z += dz * push * (1 - share);
      [a, b].forEach((p, k) => {
        if (clear[k] && distance(p, w.restartAt) < 9.15) exclude(w, p);
        else { p.x = clamp(p.x, -52.35, 52.35); p.z = clamp(p.z, -33.85, 33.85); }
      });
      moved = true;
    }
    if (!moved) return;
  }
}
function spaceTeammates(w: World, fixed: number, min = 2) {
  for (const team of [0, 1] as const) {
    const players = w.players.filter(p => p.team === team && !p.sentOff);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i]!, b = players[j]!;
          if (distance(a, b) >= min) continue;
          const aFixed = a.id === fixed || a.slot === 'GK';
          const bFixed = b.id === fixed || b.slot === 'GK';
          if (aFixed && bFixed) continue;
          const moverIndex = bFixed ? i : j;
          const otherIndex = bFixed ? j : i;
          const mover = players[moverIndex]!, other = players[otherIndex]!;
          const dx = mover.x - other.x;
          const offset = Math.sqrt(Math.max(0, min * min - dx * dx));
          let direction = Math.sign(mover.z - other.z) || Math.sign(moverIndex - otherIndex);
          let z = other.z + direction * offset;
          if (z < -33.85 || z > 33.85) {
            direction *= -1;
            z = other.z + direction * offset;
          }
          snap(mover, mover.x, z);
        }
      }
    }
  }
}
function clearWall(w: World) {
  const setPiece = w.setPiece;
  if (!setPiece?.wall.length) return;
  const members = setPiece.wall.map(id => w.players[id]!).filter(p => !p.sentOff);
  if (!members.length) return;
  const g = goal(w), range = distance(w.ball, { x: g, z: 0 }) || 1;
  const dx = (g - w.ball.x) / range, dz = -w.ball.z / range;
  const c = members.reduce((sum, p) => ({ x: sum.x + p.x / members.length, z: sum.z + p.z / members.length }), { x: 0, z: 0 });
  const halfWidth = Math.max(...members.map(p => Math.abs((p.x - c.x) * -dz + (p.z - c.z) * dx)));
  const wallIds = new Set(setPiece.wall);
  for (const p of w.players) {
    if (p.team === w.restartTeam || wallIds.has(p.id) || p.slot === 'GK' || p.human || p.sentOff) continue;
    const px = p.x - c.x, pz = p.z - c.z;
    const depth = px * dx + pz * dz, lateral = px * -dz + pz * dx;
    if (Math.abs(depth) >= 2 || Math.abs(lateral) >= halfWidth + 2) continue;
    const target = (side: number) => ({
      x: c.x + dx * depth - dz * side * (halfWidth + 2),
      z: c.z + dz * depth + dx * side * (halfWidth + 2),
    });
    let side = Math.sign(lateral) || 1;
    let position = target(side);
    if (position.z < -33.85 || position.z > 33.85) {
      side *= -1;
      position = target(side);
    }
    snap(p, position.x, position.z);
    exclude(w, p);
    if (setPiece.marks) delete setPiece.marks[p.id];
  }
}
export function arrangeSetPiece(w: World) {
  if (!w.restart || w.restart === 'kickoff') { w.setPiece = null; return; }
  const kind = w.restart === 'kick-in' ? 'throw-in' : w.restart;
  const team = w.players.filter(p => p.team === w.restartTeam), enemies = w.players.filter(p => p.team !== w.restartTeam);
  const d = teamDir(w.restartTeam, w.endsSwapped), g = goal(w), flank = Math.sign(w.restartAt.z || 1);
  const preferred = kind === 'goal-kick' ? team.filter(p => p.slot === 'GK') : team.filter(p => p.human && p.controlled);
  const candidates = kind === 'penalty' ? team.filter(p => p.slot === 'ST') : team.filter(p => kind === 'corner' || kind === 'free-kick' ? ['LW', 'RW', 'CM'].includes(p.slot) : p.slot !== 'GK');
  let taker = preferred[0] ?? candidates.sort((a,b) => distance(a,w.ball)-distance(b,w.ball))[0]!;
  if (w.shootout) {
    const order = ['ST', 'LW', 'RW', 'CM', 'LB', 'CB', 'RB', 'GK'];
    const rotation = [...team].sort((a,b) => order.indexOf(a.slot)-order.indexOf(b.slot) || a.id-b.id);
    taker = rotation[w.shootout.kicks[w.restartTeam].length % rotation.length]!;
  }
  const indirect = w.rules?.indirect?.team === w.restartTeam;
  const direct = !indirect && distance(w.restartAt,{x:g,z:0}) <= 32 && Math.abs(w.restartAt.z) < 24;
  w.setPiece = { kind, option: kind === 'corner' ? 'far' : kind === 'penalty' ? 'shot' : kind === 'free-kick' ? direct ? 'direct' : 'cross' : 'long', aim: {x:g,z:0,y:1}, curl: 0, direct, takerId:taker.id, wall:[], keeperDive:null, cpuDelay:kind === 'penalty' ? 2.2 : 1.6 };
  preset(w);
  for (const p of w.players) snap(p,p.x,p.z);
  const attackingOrder = ['ST','LW','RW','CM','LB','RB','CB'];
  const attackers = team.filter(p => p.id !== taker.id && p.slot !== 'GK').sort((a,b)=>attackingOrder.indexOf(a.slot)-attackingOrder.indexOf(b.slot)||a.id-b.id);
  const defenders = enemies.filter(p => p.slot !== 'GK');
  if (kind === 'corner' || kind === 'free-kick') {
    const spots = [[6.5,flank*5],[6.5,-flank*5],[11,0],[16,8],[19,-8]];
    if(kind==='corner' || w.restartAt.x*d>0) attackers.forEach((p,i) => { const a = spots[i]; snap(p,a ? g-d*a[0]! : d*(i-5)*3,a ? a[1]! : (i%2 ? 16 : -16)); });
    if (kind === 'corner' && attackers[5]) snap(attackers[5],w.restartAt.x-d*4,w.restartAt.z-flank*4);
    w.setPiece.marks={};
    defenders.forEach((p,i) => { const mark = attackers[(i-3+attackers.length)%attackers.length]!; snap(p,i<3 ? g-d*5.5 : mark.x+d*0.8,i<3 ? (i-1)*6 : mark.z); if(i>=3) w.setPiece!.marks![p.id]=mark.id; });
    const keeper = enemies.find(p => p.slot === 'GK')!; snap(keeper,g-d*0.3,-flank*0.5);
    if (kind === 'free-kick') {
      const range = distance(w.ball,{x:g,z:0}), count = range<=20 ? 4 : range<=28 ? 3 : range<=35 ? 2 : 0;
      const dx = (g-w.ball.x)/range, dz = -w.ball.z/range;
      defenders.filter(p => !p.human).slice(0,count).forEach((p,i) => { const offset = (i-(count-1)/2)*0.6; snap(p,w.ball.x+dx*9.3-dz*offset,w.ball.z+dz*9.3+dx*offset); p.action='wall'; w.setPiece!.wall.push(p.id); });
      keeper.z = -flank * 1.3;
      for(const id of w.setPiece.wall) delete w.setPiece.marks[id];
    }
    enemies.forEach(p => exclude(w,p));
    if (kind === 'free-kick' && w.setPiece.wall.length) clearWall(w);
  } else if (kind === 'penalty') {
    w.players.filter(p => p.id !== taker.id).forEach((p,i) => snap(p,w.shootout ? (i%3-1)*3 : w.restartAt.x-d*(12+i%3),w.shootout ? (Math.floor(i/3)-3)*1.5 : (i%2 ? 1 : -1)*(21 + Math.floor(i/2)*1.25)));
    const keeper = enemies.find(p => p.slot === 'GK')!; snap(keeper,g-d*0.15,0);
    if (enemies.some(p => p.human) && !keeper.human) transferControl(w,keeper.team,keeper.id);
  } else if (kind === 'goal-kick') {
    team.filter(p => p.slot === 'CB').forEach((p,i) => snap(p,-g+d*17,i ? 13 : -13));
    enemies.forEach(p => { if (p.x*d < -36) snap(p,-d*34,p.z); });
  } else {
    attackers.slice(0,3).forEach((p,i) => snap(p,w.restartAt.x+d*(6+i*3),w.restartAt.z-flank*(6+i*2)));
  }
  const aim = w.setPiece.aim, r = distance(w.ball,aim)||1;
  snap(taker,w.ball.x-(aim.x-w.ball.x)/r*0.5,w.ball.z-(aim.z-w.ball.z)/r*0.5);
  taker.facing = Math.atan2(aim.x-taker.x,aim.z-taker.z);
  if (kind === 'goal-kick') spaceTeammates(w, taker.id);
  spaceOut(w, taker);
  if (team.some(p => p.human) && !taker.human) transferControl(w,w.restartTeam,taker.id);
}

// Fixed-time shooting solves all three components against the simulation integrator.
export function deliveryVelocity(w: World, target: Point & {y:number}, seconds: number, spin: number) {
  let vx = (target.x-w.ball.x)/seconds, vz = (target.z-w.ball.z)/seconds, vy = (target.y-w.ball.y)/seconds+4.905*seconds;
  for (let iteration=0; iteration<12; iteration++) {
    const b = {...w.ball,vx,vy,vz,spin,grounded:false,inNet:false};
    const steps = Math.ceil(seconds/ (1/120)), dt = seconds/steps;
    for (let i=0;i<steps;i++) stepBall(b,dt);
    vx += (target.x-b.x)/seconds; vz += (target.z-b.z)/seconds; vy += (target.y-b.y)/seconds;
  }
  return {vx,vy,vz};
}
export function takeSetPiece(w: World, action: Action = 'lob', power = 0.65) {
  const s = w.setPiece; if (!s) return;
  if(action==='pass' && s.kind==='corner') { s.option='short'; preset(w); }
  const taker = w.players[s.takerId]!, d = teamDir(w.restartTeam,w.endsSwapped);
  const shot = s.kind === 'penalty' || s.kind === 'free-kick' && s.option === 'direct' && (action === 'shoot' || action === 'finesse');
  const target = {...s.aim};
  const run: SetPieceRun = {t:2.8,kind:s.kind,runs:{},marks:{},wall:[...s.wall]};
  if (action === 'pass') {
    kick(w,taker,'pass',{move:{x:0,z:0},aim:{x:target.x-w.ball.x,z:target.z-w.ball.z},power});
  } else {
    if (shot) {
      const error = Math.max(0,power-(s.kind === 'penalty' ? 0.7 : 0.8))*5 + Math.max(0,Math.abs(target.z)-3.2)*0.6
        + (s.kind==='free-kick' ? Math.max(0,distance(w.ball,target)-16)*0.055 : 0);
      target.z += (rng(w)-0.5)*error;
      if (power > (s.kind === 'penalty' ? 0.85 : 0.93)) target.y = 3.8;
    } else {
      target.y = action === 'shoot' ? 0.7 : 1.8;
      if (power>0.92) { target.x += (target.x-w.ball.x)*0.15; target.z += (target.z-w.ball.z)*0.15; }
    }
    const speed = s.kind === 'penalty' ? 15+power*16 : 17+power*11;
    const seconds = shot ? distance(w.ball,target)/(speed*0.88) : distance(w.ball,target)/(action === 'shoot' ? 25 : 17+power*8);
    const spin = s.curl*d*35;
    Object.assign(w.ball,deliveryVelocity(w,target,Math.max(0.2,seconds),spin),{spin,grounded:false});
    w.passTarget = null; w.passPoint = null;
    if (!shot) {
      const runners = w.players.filter(p => p.team === w.restartTeam && p.id !== taker.id && p.slot !== 'GK').sort((a,b)=>distance(a,target)-distance(b,target));
      const receiver = runners[0]!;
      run.runs[receiver.id] = {x:target.x,z:target.z};
      w.passTarget = receiver.id; w.passPoint = {x:target.x,z:target.z}; w.passControl=false;
      runners.slice(1,5).forEach(p => { run.runs[p.id]={x:p.x+d*1.5,z:p.z}; });
      w.players.filter(p=>p.team!==w.restartTeam && p.slot!=='GK' && !s.wall.includes(p.id)).forEach((p,i)=>{run.marks[p.id]=runners[i%5]!.id;});
    }
    w.kickEvent={playerId:taker.id,action,power,time:w.halfLength-w.clock};
  }
  if (s.kind==='penalty') {
    const keeper=w.players.find(p=>p.team!==w.restartTeam && p.slot==='GK')!;
    const guess=rng(w);
    run.penalty={keeperId:keeper.id,side:keeper.human ? s.keeperDive??0 : guess<0.4 ? -1 : guess<0.8 ? 1 : 0,t:0};
    run.t=3.5;
  }
  taker.touchCd=0.5; taker.cooldown=0.5; taker.action='kick';
  w.lastTouch=w.restartTeam; w.lastToucherId=taker.id; w.carrierId=null;
  w.phase='live'; w.restart=null; w.setPiece=null; w.setPieceRun=run;
  if (s.kind === 'goal-kick' && taker.human && w.controlled[w.restartTeam] === taker.id) {
    const receiver = w.players.find((player) => player.id === w.passTarget
      && player.team === w.restartTeam && player.slot !== 'GK' && !player.sentOff && !player.human);
    const next = receiver ?? w.players.filter((player) => player.team === w.restartTeam
      && player.slot !== 'GK' && !player.sentOff && !player.human)
      .sort((a, b) => distance(a, w.ball) - distance(b, w.ball))[0];
    if (next) transferControl(w, w.restartTeam, next.id, taker.id);
  }
  if (w.shootout) w.shootout.flight=0;
}
export function stepSetPiece(w: World, commands: Map<number,Command>, t: number) {
  const s=w.setPiece; if (!s) return;
  const taker=w.players[s.takerId]!, cmd=commands.get(taker.id), d=teamDir(w.restartTeam,w.endsSwapped);
  for (const p of w.players) {
    if (p.id===taker.id || !p.human) continue;
    const c=commands.get(p.id);
    if (s.kind==='penalty' && p.team!==w.restartTeam && p.slot==='GK') { if (c?.pressed) s.keeperDive=side(c.move.z); else if(s.keeperDive===null && c) s.keeperDive=side(c.move.z); continue; }
    movePlayer(p,c?.move??{x:0,z:0},!!c?.sprint,false,t);
    if (p.team!==w.restartTeam) exclude(w,p);
    if (s.kind==='penalty') { p.x=d*Math.min(p.x*d,w.restartAt.x*d-9.16); if(Math.abs(p.z)<20.5) p.z=Math.sign(p.z||1)*20.5; }
  }
  for(const [id,markId] of Object.entries(s.marks??{})) {
    const marker=w.players[Number(id)]!, mark=w.players[markId]!;
    if(marker.human || s.wall.includes(marker.id)) continue;
    const target={...marker,x:mark.x+d*0.8,z:mark.z};
    exclude(w,target);
    if(distance(target,mark)<SET_PIECE_GAP) {
      // The exclusion arc pushed the marker onto its man: mark him from the side along the arc instead.
      const rx=mark.x-w.restartAt.x, rz=mark.z-w.restartAt.z, r=Math.hypot(rx,rz)||1;
      const side=(marker.x-mark.x)*-rz+(marker.z-mark.z)*rx>=0?1:-1;
      target.x=w.restartAt.x+rx/r*9.16-rz/r*side*0.8; target.z=w.restartAt.z+rz/r*9.16+rx/r*side*0.8;
      exclude(w,target);
    }
    const gap=distance(marker,target);
    movePlayer(marker,{x:(target.x-marker.x)/Math.max(1,gap),z:(target.z-marker.z)/Math.max(1,gap)},gap>2,false,t);
    exclude(w,marker);
  }
  if (taker.human && cmd) {
    const mouth=s.kind==='penalty'||s.kind==='free-kick'&&s.option==='direct';
    s.aim.z=clamp(s.aim.z+cmd.move.z*(mouth?3:14)*t,mouth?-3.6:-30,mouth?3.6:30);
    if(mouth) s.aim.y=clamp(s.aim.y+cmd.move.x*d*3*t,0.2,2.4);
    else s.aim.x=clamp(s.aim.x+cmd.move.x*14*t,s.kind==='corner' ? Math.min(goal(w)-d*18,goal(w)-d*2) : -50,s.kind==='corner' ? Math.max(goal(w)-d*18,goal(w)-d*2):50);
    if(cmd.pressed && cmd.action==='through') { const list=options(s); s.option=list[(list.indexOf(s.option)+1)%list.length]!; preset(w); }
    else if(cmd.pressed && cmd.action==='skill') s.curl=(s.curl===1?-1:s.curl+1) as -1|0|1;
    else if(cmd.pressed && cmd.action) takeSetPiece(w,cmd.action,cmd.power??0.65);
  }
  if(!w.setPiece) return;
  if(!taker.human && w.restartClock>=s.cpuDelay) {
    const choice=rng(w);
    let action: Action='lob', power=0.55+rng(w)*0.25;
    if(s.kind==='corner') { s.option=choice<0.15?'short':choice<0.43?'near':choice<0.72?'far':'spot'; preset(w); if(s.option==='short') action='pass'; }
    else if(s.kind==='penalty') { s.aim={x:goal(w),z:(rng(w)<0.5?-1:1)*(2.6+rng(w)*0.6),y:1.3+rng(w)*0.9}; action='shoot'; }
    else if(s.kind==='free-kick') { s.option=s.direct && choice>=0.3?'direct':'cross'; preset(w); if(s.option==='direct') {action='shoot'; s.aim.y=choice>0.65?2:0.5; s.curl=side(s.aim.z);} }
    else { s.option=choice<0.4?'short':'long'; preset(w); action=s.option==='short' || s.kind==='throw-in'?'pass':'lob'; }
    takeSetPiece(w,action,power);
  } else if(w.restartClock>=20) takeSetPiece(w,s.kind==='penalty'||s.option==='direct'?'shoot':s.option==='short'?'pass':'lob',0.65);
}

export function setPieceCommands(w: World, commands: Map<number,Command>) {
  const run=w.setPieceRun; if(!run) return commands;
  const next=new Map(commands);
  for(const p of w.players) {
    if(p.human && p.controlled) continue;
    const marked=w.players[run.marks[p.id]!];
    const target=marked ? {x:marked.x+teamDir(w.restartTeam,w.endsSwapped)*0.8,z:marked.z} : run.runs[p.id];
    if(target) next.set(p.id,{move:{x:clamp(target.x-p.x,-1,1),z:clamp(target.z-p.z,-1,1)},sprint:true});
    if(run.wall.includes(p.id)||run.penalty?.keeperId===p.id) next.set(p.id,{move:{x:0,z:0}});
  }
  return next;
}
export function stepSetPieceRun(w: World,t: number,previousX: number) {
  const run=w.setPieceRun; if(!run) return;
  run.t-=t;
  const b=w.ball;
  for(const id of run.wall) {
    const p=w.players[id]!;
    const fraction=(p.x-previousX)/(b.x-previousX);
    if(fraction>=0 && fraction<=1 && Math.abs(b.z-p.z)<0.65 && b.y<1.95) {
      b.vx*=-0.35; b.vz+=2; b.vy=2; p.action='wall'; w.lastTouch=p.team; w.lastToucherId=id; w.event='wall blocks it'; w.eventTime=1;
      run.wall=[]; break;
    }
  }
  if(run.penalty) {
    const pen=run.penalty, keeper=w.players[pen.keeperId]!;
    pen.t+=t; keeper.z=pen.side*2.6*Math.min(1,pen.t/0.5); keeper.action='dive';
    const d=teamDir(w.restartTeam,w.endsSwapped), plane=d*(FIELD.length/2-0.3);
    if((previousX-plane)*d<0 && (b.x-plane)*d>=0 && Math.hypot(b.z-keeper.z,b.y-0.9)<0.95) {
      b.vx=-d*5; b.vy=2; b.vz=pen.side*3; w.lastTouch=keeper.team; w.lastToucherId=keeper.id; w.event='saved!'; w.eventTime=1.5;
      if(w.shootout) resolveShootoutKick(w,false);
      else w.setPieceRun=null;
      return;
    }
  } else if(b.y>=0.9 && b.y<=2.6 && b.vy<=0) {
    let p=w.players.filter(p=>p.slot!=='GK' && distance(p,b)<0.85 && !(p.touchCd!>0)).sort((a,c)=>distance(a,b)-distance(c,b))[0];
    if(p && p.team===w.restartTeam) {
      const challenger=w.players.find(q=>q.team!==p!.team && q.slot!=='GK' && distance(q,b)<1.2);
      if(challenger && rng(w)<0.6) p=challenger;
    }
    if(p) {
      const d=teamDir(p.team,w.endsSwapped), attacking=p.team===w.restartTeam && p.x*d>30;
      const target={x:attacking?d*53:p.x+d*25,z:attacking?(rng(w)<0.5?-2.7:2.7):Math.sign(p.z||1)*28};
      const gap=distance(b,target), speed=13+rng(w)*4;
      b.vx=(target.x-b.x)/gap*speed; b.vz=(target.z-b.z)/gap*speed; b.vy=attacking?0.5:6; b.spin=0;
      p.action='header'; p.touchCd=0.5; w.lastTouch=p.team; w.lastToucherId=p.id; w.kickEvent={playerId:p.id,action:'shoot',power:0.7,time:w.halfLength-w.clock};
      w.event=attacking?'header!':'headed clear'; w.eventTime=1; w.passTarget=null; w.passPoint=null;
      run.runs={}; run.marks={}; run.wall=[]; run.t=0.8;
      return;
    }
  }
  if(run.t<=0 || w.carrierId!=null && w.players[w.carrierId]?.team!==w.restartTeam) w.setPieceRun=null;
}

export function shootoutScore(w: World): [number,number] {
  return [w.shootout?.kicks[0].filter(Boolean).length??0,w.shootout?.kicks[1].filter(Boolean).length??0];
}
export function shootoutWinner(w: World): Team | null { return w.shootout?.winner??null; }
function nextPenalty(w: World) {
  const s=w.shootout!;
  w.endsSwapped=s.turn===1;
  setRestart(w,s.turn,'penalty',{x:41.5,z:0});
  w.event='penalties'; w.eventTime=1.5;
}
export function startShootout(w: World,first: Team=0) {
  w.shootout={kicks:[[],[]],turn:first,first,done:false,winner:null,round:1};
  nextPenalty(w);
}
export function resolveShootoutKick(w: World,scored: boolean) {
  const s=w.shootout; if(!s || s.done || s.pause) return;
  s.kicks[s.turn].push(scored);
  const tally=shootoutScore(w), a=s.kicks[0].length,b=s.kicks[1].length;
  let winner: Team|null=null;
  if(a<=5 && b<=5) {
    if(tally[0]>tally[1]+Math.max(0,5-b)) winner=0;
    if(tally[1]>tally[0]+Math.max(0,5-a)) winner=1;
  }
  if(a>=5 && b>=5 && a===b && tally[0]!==tally[1]) winner=tally[0]>tally[1]?0:1;
  w.setPieceRun=null; w.setPiece=null; w.ball.vx=w.ball.vy=w.ball.vz=0;
  const name = (team: Team) => clubById(w.clubs?.[team] ?? DEFAULT_CLUBS[team]).call;
  if(winner!==null) {
    s.done=true; s.winner=winner; w.phase='full-time'; w.event=name(winner)+' win on penalties'; return;
  }
  w.event=scored?name(s.turn)+' scores · '+tally.join('-'):'missed / saved!';
  s.turn=opposition(s.turn); s.round=Math.min(a,b)+1; s.pause=1.5; w.eventTime=1.5;
}
export function stepShootout(w: World,t: number) {
  const s=w.shootout; if(!s || s.done) return false;
  if(s.pause) { s.pause=Math.max(0,s.pause-t); if(!s.pause) nextPenalty(w); return true; }
  if(w.phase==='live') { s.flight=(s.flight??0)+t; if(s.flight>=3.5) {resolveShootoutKick(w,false); return true;} }
  return false;
}
export function phoneStoppagePrompt(w: World, playerId: number): string | null {
  const player = w.players.find((p) => p.id === playerId);
  if (!player) return null;
  const labels = setPieceLabels(w, player.team, playerId);
  if (labels) return `${labels.title} · ${labels.hint}`;
  if (w.phase === 'restart') {
    const taker = w.restart === 'kickoff' ? restartTaker(w) : null;
    if (taker?.human) return playerId === taker.id
      ? 'Kick off · aim with stick, press A to pass'
      : 'Kick off · waiting for the taker';
    return `${w.event || 'Kick off'} · move the stick or press to take`;
  }
  if (w.phase !== 'live') return w.event || w.phase;
  if (player.slide) return 'Sliding · movement resumes after the slide';
  return null;
}

export function setPieceLabels(w: World,team: Team,playerId?: number): {title:string;hint:string;a:string;b:string;x:string;y:string;lb:string;rb:string}|null {
  const s=w.setPiece; if(w.phase!=='restart'||!s) return null;
  const title=(w.shootout?'PENS '+shootoutScore(w).join('-')+' · ':'')+s.kind.toUpperCase()+' · '+s.option.toUpperCase();
  const base={title,hint:'Stick: aim delivery · hold to power',a:'Short pass',b:'Driven',x:'Lofted',y:'Option',lb:'Curl',rb:'-'};
  if(team!==w.restartTeam) return s.kind==='penalty'?{...base,title:title+" · YOU'RE IN GOAL",hint:'Stick: pick a side',a:'Dive',b:'Dive',x:'Dive',y:'Dive',lb:'-'}:{...base,hint:'Hold your mark',a:'Switch',b:'Tackle',x:'Slide',y:'Switch',lb:'-'};
  if(playerId!==undefined && playerId!==s.takerId) return {...base,hint:'Find space · hold your run'};
  if(s.kind==='penalty') return {...base,hint:'Stick: aim',b:'Shoot (hold · >85% skies)',a:'Shoot',x:'Shoot',y:'-',lb:'-'};
  if(s.kind==='corner') return {...base,a:'Short',b:'Driven cross',x:'Lofted cross',y:'Target: '+options(s)[(options(s).indexOf(s.option)+1)%4],lb:'Curl: '+(s.curl<0?'out-swing':s.curl>0?'in-swing':'none')};
  if(s.kind==='free-kick') return {...base,b:s.option==='direct'?'Shoot (hold)':'Driven cross',x:'Cross'};
  return {...base,b:s.kind==='throw-in'?'Long throw':'Driven long',x:s.kind==='throw-in'?'Long throw':'Long kick',y:'Target: '+(s.option==='short'?'long':'short'),lb:'-'};
}
