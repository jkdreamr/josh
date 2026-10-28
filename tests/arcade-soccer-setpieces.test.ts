import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, setRestart, stepWorld, STEP, type Restart, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { deliveryVelocity, resolveShootoutKick, setPieceLabels, shootoutScore, shootoutWinner, startShootout, stepSetPieceRun, takeSetPiece } from '../src/os/arcade/games/soccer/setpieces.ts';
import { stepBall } from '../src/os/arcade/games/soccer/physics.ts';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { cloneSnapshot, parsePacket } from '../src/os/arcade/games/soccer/net.ts';

function setup(kind: Exclude<Restart,null|'kickoff'>, seed=1234, human=true, x=52.35, z=33.85) {
  const w=createWorld(seed);
  if(!human) w.players.forEach(p=>{p.human=false;p.controlled=false;});
  setRestart(w,0,kind,{x,z});
  return w;
}
test('phone snapshots preserve pending deliveries, open play and shootouts',()=>{
  const w=setup('corner');
  const snapshot=()=>parsePacket({t:'soccer',k:'s',r:1,seq:1,state:cloneSnapshot(w)});
  const corner=snapshot();
  assert.equal(corner?.k,'s');
  if(corner?.k==='s') {
    assert.equal(setPieceLabels(corner.state,0,w.setPiece!.takerId)?.a,'Short');
    assert.deepEqual(corner.state.setPiece,w.setPiece);
    corner.state.setPiece!.aim.z=0;
    assert.notEqual(w.setPiece!.aim.z,0);
  }
  takeSetPiece(w);
  const live=snapshot();
  assert.equal(live?.k,'s');
  if(live?.k==='s')assert.equal(setPieceLabels(live.state,0),null);
  startShootout(w);
  const pens=snapshot();
  assert.equal(pens?.k,'s');
  if(pens?.k==='s')assert.deepEqual(pens.state.shootout,w.shootout);
});
function ticks(w: World, n: number) { for(let i=0;i<n;i++) stepWorld(w,STEP); }
function goalKickWithAttackers(zs: [number, number], seed = 1234) {
  const w = createWorld(seed);
  const st = w.players.find(p => p.team === 1 && p.slot === 'ST')!;
  const rw = w.players.find(p => p.team === 1 && p.slot === 'RW')!;
  st.x = rw.x = -40;
  st.z = zs[0];
  rw.z = zs[1];
  setRestart(w, 0, 'goal-kick', { x: -47, z: 0 });
  return w;
}
function assertGoalKickSpacing(w: World) {
  for (let i = 0; i < w.players.length; i++) {
    for (let j = i + 1; j < w.players.length; j++) {
      const a = w.players[i]!, b = w.players[j]!;
      if (a.sentOff || b.sentOff || a.team !== b.team) continue;
      assert.ok(distance(a, b) >= 2 - 1e-6, `players ${a.id}/${b.id} are too close`);
    }
  }
}
test('goal-kick placement separates attackers while keeping them outside the box', () => {
  const w = goalKickWithAttackers([20.2, 20.6]);
  const st = w.players.find(p => p.team === 1 && p.slot === 'ST')!;
  const rw = w.players.find(p => p.team === 1 && p.slot === 'RW')!;
  assertGoalKickSpacing(w);
  assert.equal(st.x, -34);
  assert.equal(rw.x, -34);
  assert.ok(distance(w.players[w.setPiece!.takerId]!, w.ball) < 0.64);
});
test('goal-kick spacing moves attackers inward rather than beyond the touchline', () => {
  const w = goalKickWithAttackers([33.6, 33.6]);
  const st = w.players.find(p => p.team === 1 && p.slot === 'ST')!;
  const rw = w.players.find(p => p.team === 1 && p.slot === 'RW')!;
  assert.ok(Math.min(st.z, rw.z) < 33.6);
  assert.ok([st, rw].every(p => p.z >= -33.85 && p.z <= 33.85));
  assert.ok(distance(st, rw) >= 2 - 1e-6);
});
test('goal-kick spacing is deterministic', () => {
  const a = goalKickWithAttackers([20.2, 20.6]);
  const b = goalKickWithAttackers([20.2, 20.6]);
  assert.deepEqual(a.players.map(p => ({ x: p.x, z: p.z })), b.players.map(p => ({ x: p.x, z: p.z })));
});
test('corner layout has zones, a nearby taker and legal defenders',()=>{
  const w=setup('corner');
  assert.ok(distance(w.players[w.setPiece!.takerId]!,w.ball)<0.64);
  const defenders=w.players.filter(p=>p.team===1);
  assert.equal(defenders.filter(p=>Math.abs(p.x-47)<0.01).length,3);
  assert.ok(defenders.every(p=>distance(p,w.ball)>=9.15));
  assert.ok(w.players.filter(p=>p.team===0 && p.x>32 && p.id!==w.setPiece!.takerId).length>=5);
});
test('stick aims without taking; target and curl cycle; labels disappear in play',()=>{
  const w=setup('corner'),id=w.setPiece!.takerId, before=w.setPiece!.aim.z;
  stepWorld(w,STEP,new Map([[id,{move:{x:0,z:1}}]]));
  assert.equal(w.phase,'restart'); assert.ok(w.setPiece!.aim.z>before);
  stepWorld(w,STEP,new Map([[id,{move:{x:0,z:0},action:'through',pressed:true}]]));
  assert.equal(w.setPiece!.option,'spot');
  stepWorld(w,STEP,new Map([[id,{move:{x:0,z:0},action:'skill',pressed:true}]]));
  assert.equal(w.setPiece!.curl,1);
  assert.match(setPieceLabels(w,0)!.b,/cross/); assert.match(setPieceLabels(w,1)!.hint,/mark/);
  takeSetPiece(w); assert.equal(setPieceLabels(w,0),null);
});
test('curled delivery arrives at head height within two metres and assigns a runner',()=>{
  const w=setup('corner'); w.setPiece!.curl=1; const target={...w.setPiece!.aim};
  const seconds=distance(w.ball,target)/(17+0.65*8);
  takeSetPiece(w,'lob',0.65);
  assert.ok(w.passTarget!==null); assert.ok(w.setPieceRun!.runs[w.passTarget!]);
  for(let i=0;i<Math.round(seconds/STEP);i++) stepBall(w.ball,STEP);
  assert.ok(distance(w.ball,target)<2); assert.ok(Math.abs(w.ball.y-target.y)<0.6);
});
test('wall sizes, exclusion and low-shot block',()=>{
  for(const [range,count] of [[18,4],[25,3],[33,2],[40,0]]) {
    const w=setup('free-kick',1,true,52.5-range!,0);
    assert.equal(w.setPiece!.wall.length,count);
    assert.ok(w.players.filter(p=>p.team===1).every(p=>distance(p,w.ball)>=9.15));
  }
  const w=setup('free-kick',1,true,30,0),p=w.players[w.setPiece!.wall[0]!]!;
  takeSetPiece(w,'shoot',0.6);
  Object.assign(w.ball,{x:p.x+0.1,z:p.z,y:0.5,vx:25,vy:0});
  stepSetPieceRun(w,STEP,p.x-0.1);
  assert.ok(w.ball.vx<0); assert.match(w.event,/wall/);
});
test('restart markers track a moving human runner without moving the wall',()=>{
  for(const kind of ['corner','free-kick'] as const) {
    const w=setup(kind,1234,true,kind==='corner'?52.35:28,kind==='corner'?33.85:0);
    const runner=w.players[9]!;
    runner.human=true;runner.controlled=true;
    const id=Number(Object.entries(w.setPiece!.marks!).find(([,mark])=>mark===runner.id)![0]);
    const marker=w.players[id]!, initialZ=marker.z;
    const wall=w.setPiece!.wall.map(id=>({id,x:w.players[id]!.x,z:w.players[id]!.z}));
    for(let i=0;i<60;i++) stepWorld(w,STEP,new Map([[runner.id,{move:{x:0,z:1}}]]));
    assert.equal(w.phase,'restart');
    assert.ok(marker.z>initialZ+2);
    assert.ok(distance(marker,{x:runner.x+0.8,z:runner.z})<2);
    assert.ok(distance(marker,w.ball)>=9.15);
    for(const p of wall) assert.deepEqual({x:w.players[p.id]!.x,z:w.players[p.id]!.z},{x:p.x,z:p.z});
  }
});
test('direct free-kick lateral error grows with distance at the same power and seed',()=>{
  function error(x: number) {
    const w=setup('free-kick',1234,true,x,0);
    w.setPiece!.aim={x:52.5,z:2.8,y:1.8};
    takeSetPiece(w,'shoot',0.7);
    let previous={...w.ball};
    while(w.ball.x<52.5) { previous={...w.ball}; stepBall(w.ball,STEP); }
    const fraction=(52.5-previous.x)/(w.ball.x-previous.x);
    return Math.abs(previous.z+(w.ball.z-previous.z)*fraction-2.8);
  }
  assert.ok(error(22)>error(35)+0.05);
});
test('trajectory solver puts a curled free kick inside the goal frame',()=>{
  const w=setup('free-kick',1,true,27,0),target={x:52.5,z:2.8,y:1.8};
  const seconds=distance(w.ball,target)/23;
  Object.assign(w.ball,deliveryVelocity(w,target,seconds,35),{spin:35,grounded:false});
  for(let i=0;i<Math.round(seconds/STEP);i++) stepBall(w.ball,STEP);
  assert.ok(Math.abs(w.ball.z)<3.5); assert.ok(w.ball.y<2.33);
});
test('curled deliveries mirror across ends without changing lateral bend',()=>{
  for(const kind of ['corner','free-kick'] as const) {
    const a=setup(kind,1234,true,kind==='corner'?52.35:28,kind==='corner'?33.85:8);
    const b=createWorld(1234);
    b.endsSwapped=true;
    b.players.forEach(p=>{p.x=-p.x;});
    setRestart(b,0,kind,{x:-a.restartAt.x,z:a.restartAt.z});
    a.setPiece!.curl=b.setPiece!.curl=1;
    takeSetPiece(a,kind==='corner'?'lob':'shoot',0.7);
    takeSetPiece(b,kind==='corner'?'lob':'shoot',0.7);
    for(let i=0;i<30;i++){stepBall(a.ball,STEP);stepBall(b.ball,STEP);}
    assert.ok(Math.abs(a.ball.x+b.ball.x)<0.001);
    assert.ok(Math.abs(a.ball.z-b.ball.z)<0.001);
    assert.ok(Math.abs(a.ball.y-b.ball.y)<0.001);
  }
});
test('half-time clears set-piece jobs before swapping ends',()=>{
  const w=setup('corner');takeSetPiece(w);w.clock=0;
  stepWorld(w,STEP);
  assert.equal(w.phase,'half-time');assert.equal(w.setPieceRun,null);assert.equal(w.setPiece,null);
  ticks(w,121);
  assert.equal(w.endsSwapped,true);assert.equal(w.restart,'kickoff');assert.equal(w.setPieceRun,null);
});
test('penalty overcharge skies, correct guess saves and wrong guess loses',()=>{
  for(const [guess,expected] of [[1,false],[-1,true]] as const) {
    const w=setup('penalty'); const keeper=w.players[11]!; keeper.human=true; keeper.controlled=true;
    w.setPiece!.keeperDive=guess; w.setPiece!.aim={x:52.5,z:2.2,y:0.8};
    takeSetPiece(w,'shoot',0.65); ticks(w,50);
    assert.equal(w.score[0]>0,expected);
  }
  const w=setup('penalty'); takeSetPiece(w,'shoot',1);
  while(w.ball.x<52.4) stepBall(w.ball,STEP);
  assert.equal(w.score[0],0);
  assert.ok(w.ball.y>2.44);
});
test('human keeper commits a side and receives keeper labels',()=>{
  const w=setup('penalty'); w.players[17]!.human=true; w.players[17]!.controlled=true;
  setRestart(w,0,'penalty',{x:41.5,z:0});
  assert.equal(w.controlled[1],11);
  stepWorld(w,STEP,new Map([[11,{move:{x:0,z:-1},action:'pass',pressed:true}]]));
  assert.equal(w.setPiece!.keeperDive,-1); assert.match(setPieceLabels(w,1)!.title,/GOAL/);
});
test('goal kick offers split CBs, a short pass and a long flight; throw uses touchline',()=>{
  const w=setup('goal-kick',1,true,-47,0);
  assert.equal(w.players[w.setPiece!.takerId]!.slot,'GK');
  w.setPiece!.aim={x:-35.5,z:13,y:0.11}; takeSetPiece(w,'pass',0.6);
  assert.equal(w.players[w.passTarget!]!.slot,'CB');
  const long=setup('goal-kick',1,true,-47,0); takeSetPiece(long,'lob',0.7);
  const start=long.ball.x; for(let i=0;i<160;i++) stepBall(long.ball,STEP);
  assert.ok(long.ball.x-start>35);
  const throwing=setup('kick-in',1,true,10,33.85);
  assert.equal(throwing.setPiece!.kind,'throw-in'); assert.equal(throwing.event,'throw-in');
  assert.ok(throwing.players[throwing.setPiece!.takerId]!.z>33);
  takeSetPiece(throwing,'pass'); assert.equal(throwing.lastTouch,0);
});
test('each CPU set piece takes within three seconds and ignores AI restart commands',()=>{
  for(const kind of ['corner','free-kick','penalty','goal-kick','kick-in'] as const) {
    const w=setup(kind,1,false,kind==='free-kick'?28:kind==='goal-kick'?-47:52.35,kind==='penalty'?0:33.85);
    ticks(w,170); assert.notEqual(w.phase,'restart',kind);
  }
});
test('headers attack and defensive headers clear',()=>{
  for(const team of [0,1] as const) {
    const w=setup('corner'); takeSetPiece(w);
    w.players.forEach(p=>{p.x=0;p.z=25;});
    const p=w.players[team===0?9:20]!; p.x=42;p.z=0;
    Object.assign(w.ball,{x:42,y:1.8,z:0,vy:-1});
    stepSetPieceRun(w,STEP,41.9);
    assert.equal(p.action,'header'); assert.equal(w.lastTouch,team);
    assert.equal(Math.sign(w.ball.vx),team===0?1:-1);
  }
});
test('shootout alternates, finishes early at 3-0 and never changes match score',()=>{
  const w=createWorld(); startShootout(w);
  for(const result of [true,false,true,false,true,false]) {
    resolveShootoutKick(w,result);
    if(!w.shootout!.done) ticks(w,91);
  }
  assert.deepEqual(shootoutScore(w),[3,0]); assert.equal(shootoutWinner(w),0);
  assert.equal(w.phase,'full-time'); assert.deepEqual(w.score,[0,0]);
});
test('shootout sudden death waits for the pair; cup draw starts automatically',()=>{
  const w=createWorld(); startShootout(w,1);
  for(let i=0;i<10;i++){resolveShootoutKick(w,true); ticks(w,91);}
  resolveShootoutKick(w,true); assert.equal(shootoutWinner(w),null); ticks(w,91);
  resolveShootoutKick(w,false); assert.equal(shootoutWinner(w),1);
  const cup=createWorld(); cup.cup=true; cup.half=2;cup.clock=0;cup.phase='live';cup.restart=null;
  stepWorld(cup,STEP); assert.ok(cup.shootout); assert.equal(cup.phase,'restart');
});
test('seeded set pieces replay identically',()=>{
  const a=setup('corner',9876,false),b=setup('corner',9876,false);
  ticks(a,250);ticks(b,250);assert.deepEqual(a,b);
});

test('seeded CPU restart statistics',()=>{
  let attempts=0,penalties=0,freeKicks=0;
  for(let i=0;i<40;i++) {
    for(const kind of ['corner','penalty','free-kick'] as const) {
      const w=setup(kind,1234+i*7919,false,kind==='free-kick'?28:52.35,kind==='corner'?33.85:0);
      let attempt=false;
      for(let tick=0;tick<360;tick++) {
        stepWorld(w,STEP,computeAI(w,'normal',STEP,tick));
        if(w.event==='header!' || w.kickEvent?.action==='shoot' && w.players[w.kickEvent.playerId]!.team===0) attempt=true;
        if(w.score[0] || w.event==='saved!' || w.phase==='restart' && tick>180) break;
      }
      if(kind==='corner') attempts+=Number(attempt);
      if(kind==='penalty') penalties+=w.score[0];
      if(kind==='free-kick') freeKicks+=w.score[0];
    }
  }
  console.log('40 seeded CPU restarts: corner attempts '+(attempts*2.5).toFixed(1)+'%; penalties '+(penalties*2.5).toFixed(1)+'%; direct-FK scenario goals '+(freeKicks*2.5).toFixed(1)+'%');
  assert.ok(penalties>=26 && penalties<=34,'CPU penalties convert 65–85%');
});
