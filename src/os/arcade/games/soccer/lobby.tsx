import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Segmented, useOnline, useSetting, useShell } from '../../kit';
import QRCode from 'qrcode';
import { COMPETITIONS, competitionById, type CompetitionId } from './modes.ts';
import { CLUBS, clubById, DEFAULT_CLUBS } from './teams.ts';
import { MODE, COMPETITION, HOME_CLUB, AWAY_CLUB } from './settings.ts';
import type { Mode } from './modes.ts';
import { clearCup, createCup, cupSummary, loadCup, saveCup, userFixture, type Cup } from './cup.ts';
import { parsePacket, type LobbyMember, type LobbyPacket } from './net.ts';
import { Crest } from './crest.tsx';

let currentLobby: LobbyPacket | null = null;
const lobbyListeners = new Set<() => void>();
const subscribeLobby = (listener: () => void) => {
  lobbyListeners.add(listener);
  return () => lobbyListeners.delete(listener);
};
const getLobby = () => currentLobby;
export function useLobbyState() {
  return useSyncExternalStore(subscribeLobby, getLobby, getLobby);
}
export function publishLobby(packet: LobbyPacket) {
  if (currentLobby && packet.r < currentLobby.r) return;
  if (currentLobby && packet.r === currentLobby.r && packet.seq <= currentLobby.seq) return;
  currentLobby = structuredClone(packet);
  lobbyListeners.forEach((listener) => listener());
}
export function sideForRoom(roomCode: string | undefined): 0 | 1 {
  if (typeof window === 'undefined' || !roomCode) return 0;
  const params = new URLSearchParams(window.location.search);
  return params.get('side') === '1' && (params.get('room') ?? '').toUpperCase() === roomCode.toUpperCase() ? 1 : 0;
}

const modeLabels: Record<Mode, string> = { cpu: 'vs cpu', versus: '2 player versus', coop: '2 player co-op' };
const competitionOptions = COMPETITIONS.map(({ id, label }) => [id, label] as const);
const clubOptions = CLUBS.map(({ id, name }) => [id, name] as const);
const clampIndex = (index: number) => (index + CLUBS.length) % CLUBS.length;
const nextClubId = (id: string, direction: number, other: string) => {
  let index = clampIndex(CLUBS.findIndex((club) => club.id === id));
  for (let step = 0; step < CLUBS.length; step++) {
    index = clampIndex(index + direction);
    if (CLUBS[index]!.id !== other) return CLUBS[index]!.id;
  }
  return id;
};

function MiniBracket({ cup }: { cup: Cup }) {
  const labels = ['quarter-finals', 'semi-finals', 'final'];
  return (
    <div className="g-soccer-cup-bracket">
      {cup.rounds.map((matches, index) => (
        <section key={labels[index]}>
          <b>{labels[index]}</b>
          {matches.map((match, matchIndex) => {
            const active = match.home === cup.user || match.away === cup.user;
            const home = clubById(match.home), away = clubById(match.away);
            return (
              <div className={active ? 'is-user' : ''} key={`${match.home}-${match.away}-${matchIndex}`}>
                <span>{home.short} {match.score ? `${match.score[0]}-${match.score[1]}` : '·'} {away.short}</span>
                {match.pens && <small>pens {match.pens[0]}-{match.pens[1]}</small>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function CupCard({ cup, onNew }: { cup: Cup; onNew: () => void }) {
  const fixture = userFixture(cup);
  const opponent = fixture ? clubById(fixture.away === cup.user ? fixture.home : fixture.away) : null;
  const next = fixture && opponent ? `next: ${fixture.stage} vs ${opponent.name}` : cup.champion ? 'cup winners!' : 'cup run complete';
  return (
    <div className="g-soccer-cup-card">
      <MiniBracket cup={cup} />
      <div className="g-soccer-cup-next"><strong>{next}</strong><button type="button" onClick={onNew}>new cup</button></div>
    </div>
  );
}

function currentMembers(members: LobbyMember[], onlinePlayers: { seat: number }[]): LobbyMember[] {
  const connectedSeats = new Set(onlinePlayers.map((player) => player.seat));
  const result = members.filter((member) => member.seat === 0 || connectedSeats.has(member.seat));
  for (const player of onlinePlayers) {
    if (player.seat === 0 && !result.some((member) => member.seat === player.seat)) result.push({ seat: 0, role: 'host', side: 0 });
  }
  return result.sort((a, b) => a.seat - b.seat);
}

function CupLobbyCard({ cup, homeId, setHomeId, setCup }: { cup: Cup | null; homeId: string; setHomeId: (id: string) => void; setCup: (cup: Cup | null) => void }) {
  if (!cup) return (
    <div className="g-soccer-cup-empty">
      <Crest club={clubById(homeId)} size={46} />
      <span>pick a club to start a cup</span>
    </div>
  );
  const onNew = () => {
    clearCup();
    setCup(null);
    setHomeId(clubById(homeId).id);
  };
  return <CupCard cup={cup} onNew={onNew} />;
}

function HostLobby({ online }: { online: NonNullable<ReturnType<typeof useOnline>> }) {
  const [mode, setMode] = useSetting(MODE);
  const [competition, setCompetition] = useSetting(COMPETITION);
  const [homeId, setHomeId] = useSetting(HOME_CLUB);
  const [awayId, setAwayId] = useSetting(AWAY_CLUB);
  const [qr, setQr] = useState('');
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const [ready, setReady] = useState<[boolean, boolean]>([false, false]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [members, setMembers] = useState<LobbyMember[]>([{ seat: 0, role: 'host', side: 0 }]);
  const [cup, setCup] = useState<Cup | null>(() => loadCup());
  const sequence = useRef(0);
  const received = useRef(new Map<number, number>());
  const navState = useRef(new Map<number, { x: number; y: number; time: number }>());
  const membersRef = useRef(members);
  const compRef = useRef(competition);
  const modeRef = useRef(mode);
  const settingsRef = useRef({ homeId, awayId });
  membersRef.current = members;
  compRef.current = competition;
  modeRef.current = mode;
  settingsRef.current = { homeId, awayId };
  const def = competitionById(competition);
  const connected = online.players.filter((player) => player.seat > 0);
  const memberList = currentMembers(members, online.players);
  const phoneCount = memberList.filter((member) => member.role === 'phone').length;
  const guestMac = memberList.some((member) => member.role === 'mac' && member.side === 1);
  const sideOnePhones = memberList.filter((member) => member.role === 'phone' && member.side === 1).length;
  const requiredPhones = competition === 'online' ? 0 : mode === 'cpu' ? 1 : 2;
  const enoughPlayers = competition === 'online' ? guestMac : phoneCount >= requiredPhones;
  const isRunningCup = competition === 'cup' && cup !== null && cup.round < 3 && !cup.out;

  useEffect(() => {
    if (!online.code || typeof location === 'undefined') return;
    const url = `${location.protocol}//${location.host}/?game=soccer&room=${online.code}`;
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 2, width: 250 }).then(setQr).catch(() => setQr(''));
  }, [online.code]);

  useEffect(() => {
    const off = online.onMessage((from, data) => {
      if (from === online.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== (online.round || 1)) return;
      if ((packet.k === 'hi' || packet.k === 'nav' || packet.k === 'mv') && packet.seat !== from) return;
      if (packet.k === 'hi') {
        if (packet.seq <= (received.current.get(from) ?? -1)) return;
        received.current.set(from, packet.seq);
        setMembers((previous) => {
          const next = previous.filter((member) => member.seat !== from);
          next.push({ seat: from, role: packet.role, side: packet.side });
          return next.sort((a, b) => a.seat - b.seat);
        });
      }
      if (packet.k === 'nav') {
        if (packet.seq <= (received.current.get(from) ?? -1)) return;
        received.current.set(from, packet.seq);
        const now = performance.now();
        const previous = navState.current.get(from) ?? { x: 0, y: 0, time: 0 };
        const moved = packet.dx !== previous.x || packet.dy !== previous.y;
        if (packet.dx || packet.dy) {
          if (!moved && now - previous.time < 280) return;
          navState.current.set(from, { x: packet.dx, y: packet.dy, time: now });
        } else navState.current.set(from, { x: 0, y: 0, time: now });
        const member = membersRef.current.find((entry) => entry.seat === from);
        if (!member) return;
        const side = member.side;
        if (packet.a) setReady((previous) => previous.map((value, index) => index === side ? true : value) as [boolean, boolean]);
        if (packet.b) setReady((previous) => previous.map((value, index) => index === side ? false : value) as [boolean, boolean]);
        if (packet.dx || packet.dy) {
          setReady([false, false]);
          setCountdown(null);
        }
        if (packet.dy) setFocus((previous) => previous.map((value, index) => index === side ? 1 - value : value) as [number, number]);
        if (packet.dx && focus[side] === 0 && side === 0) {
          const arrangements = competitionById(compRef.current).arrangements;
          const current = arrangements.indexOf(modeRef.current);
          setMode(arrangements[(current + packet.dx + arrangements.length) % arrangements.length]!);
        } else if (packet.dx && focus[side] === 1) {
          const selected = side === 0 ? settingsRef.current.homeId : settingsRef.current.awayId;
          const other = side === 0 ? settingsRef.current.awayId : settingsRef.current.homeId;
          const next = nextClubId(selected, packet.dx, other);
          if (side === 0) setHomeId(next); else setAwayId(next);
        }
      }
    });
    return off;
  }, [online, online.round, online.seat, focus, setAwayId, setCompetition, setHomeId]);

  useEffect(() => {
    if (!def.arrangements.includes(mode)) setMode(def.arrangements[0]!);
  }, [competition, def, mode, setMode]);

  useEffect(() => {
    if (competition === 'cup' && cup && cup.user !== homeId && cup.round < 3 && !cup.out) setHomeId(cup.user);
  }, [competition, cup, homeId, setHomeId]);

  useEffect(() => {
    const packet: LobbyPacket = {
      t: 'soccer', k: 'lobby', r: online.round || 1, seq: sequence.current++, comp: competition, mode,
      clubs: [homeId, awayId], focus, ready, countdown, members: memberList, ...(cup ? { cup: cupSummary(cup) } : {}),
    };
    publishLobby(packet);
    if (online.round === 0) online.send(packet);
  }, [online, competition, mode, homeId, awayId, focus, ready, countdown, members, cup]);

  useEffect(() => {
    if (countdown === null || !online.isHost) return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else {
        let nextCup = cup;
        if (compRef.current === 'cup' && (!nextCup || nextCup.round >= 3 || nextCup.out)) {
          nextCup = createCup(settingsRef.current.homeId, Math.floor(Date.now() % 0xffff_ffff));
          setCup(nextCup);
          saveCup(nextCup);
        }
        const latestCup = nextCup;
        const packet: LobbyPacket = {
          t: 'soccer', k: 'lobby', r: online.round || 1, seq: sequence.current++, comp: compRef.current, mode: modeRef.current,
          clubs: [latestCup && compRef.current === 'cup' ? latestCup.user : settingsRef.current.homeId, settingsRef.current.awayId],
          focus, ready: [true, true], countdown: null, members: currentMembers(membersRef.current, online.players),
          ...(latestCup ? { cup: cupSummary(latestCup) } : {}),
        };
        online.send(packet);
        publishLobby(packet);
        online.start();
        setCountdown(null);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, online, cup, focus]);

  useEffect(() => {
    if (online.isHost && countdown === null && enoughPlayers && ready[0] && (competition !== 'online' || ready[1])) setCountdown(3);
  }, [online.isHost, countdown, enoughPlayers, ready, competition]);

  const changeCompetition = (value: CompetitionId) => {
    setReady([false, false]);
    setCountdown(null);
    setCompetition(value);
  };
  const setClub = (side: 0 | 1, value: string) => {
    setReady([false, false]);
    setCountdown(null);
    if (side === 0 && isRunningCup) return;
    if (side === 0) setHomeId(value === awayId ? nextClubId(value, 1, awayId) : value);
    else setAwayId(value === homeId ? nextClubId(value, 1, homeId) : value);
  };
  const start = () => {
    if (!enoughPlayers || countdown !== null) return;
    setReady((previous) => [true, competition === 'online' ? previous[1] : true]);
    setCountdown(competition === 'online' ? null : 3);
  };

  return (
    <div className="g-soccer-phone-lobby">
      <div className="g-soccer-phone-qr">
        {qr && <img src={qr} alt="Connect phone QR code" />}
        <strong>{connected.length ? 'your phone is connected' : 'connect a phone'}</strong>
      </div>
      <div className="g-soccer-phone-lobby-content">
        <div className="g-soccer-phone-connections" role="status">
          <span className={phoneCount ? '' : 'is-waiting'}>{phoneCount ? `your phone ✓` : 'waiting for your phone'}</span>
          {competition === 'online' && <span className={guestMac ? '' : 'is-waiting'}>{guestMac ? 'friend mac ✓' : 'waiting for the other mac'}</span>}
          {competition === 'online' && <span className={sideOnePhones ? '' : 'is-waiting'}>{sideOnePhones ? 'friend phone ✓' : 'friend phone optional'}</span>}
          {competition !== 'online' && mode !== 'cpu' && <span className={phoneCount > 1 ? '' : 'is-waiting'}>{phoneCount > 1 ? 'second phone ✓' : 'waiting for a second phone'}</span>}
        </div>
        {connected.length > 0 && (
          <>
            <Segmented label="competition" value={competition} options={competitionOptions} onChange={changeCompetition} />
            {competition === 'online' && online.code && <p className="g-soccer-friend-link">friend's mac: <a href={`/?game=soccer&room=${online.code}`}>{location.host}/?game=soccer&amp;room={online.code}</a></p>}
            <div className="g-soccer-lobby-clubs">
              {[homeId, awayId].map((id, side) => {
                const club = clubById(id);
                return (
                  <div className="g-soccer-lobby-club" key={side}>
                    <Crest club={club} size={42} />
                    <label>{side === 0 ? 'your club' : competition === 'online' ? "friend's club" : 'opponent'}
                      <select value={id} disabled={side === 0 && isRunningCup} onChange={(event) => setClub(side as 0 | 1, event.currentTarget.value)}>
                        {clubOptions.map(([clubId, name]) => <option key={clubId} value={clubId} disabled={clubId === (side === 0 ? awayId : homeId)}>{name}</option>)}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
            {competition === 'cup' && <CupLobbyCard cup={cup} homeId={homeId} setHomeId={setHomeId} setCup={setCup} />}
            {competition !== 'cup' && (
              <Segmented label="setup" value={mode} options={def.arrangements.map((arrangement) => [arrangement, modeLabels[arrangement]] as const)} onChange={(value) => { setReady([false, false]); setCountdown(null); setMode(value); }} />
            )}
            <div className="g-soccer-lobby-ready">
              <span>you {ready[0] ? 'ready' : 'choose a club'} · friend {ready[1] ? 'ready' : 'waiting'}</span>
              <button type="button" className="arcade-btn arcade-btn-primary" disabled={!enoughPlayers || countdown !== null} onClick={start}>
                {countdown === null ? 'kick off' : `starting in ${countdown}`}
              </button>
            </div>
            <details className="g-soccer-phone-settings"><summary>match settings</summary><div className="g-soccer-settings">{/* use the system settings card for half length and difficulty */}</div></details>
          </>
        )}
      </div>
    </div>
  );
}

function GuestMacLobby({ online }: { online: NonNullable<ReturnType<typeof useOnline>> }) {
  const lobby = useLobbyState();
  const [qr, setQr] = useState('');
  const sequence = useRef(0);
  const sendNav = (dx: -1 | 0 | 1, a = false, b = false) => online.send({
    t: 'soccer', k: 'nav', r: online.round || 1, seq: sequence.current++, seat: online.seat, dx, dy: 0, a, b,
  }, { fast: true });
  const currentClub = lobby?.clubs[1] ?? DEFAULT_CLUBS[1];
  const member = lobby?.members.find((entry) => entry.seat === online.seat);
  useEffect(() => {
    if (!online.code || typeof location === 'undefined') return;
    const url = `${location.protocol}//${location.host}/?game=soccer&room=${online.code}&side=1`;
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 2, width: 210 }).then(setQr).catch(() => setQr(''));
  }, [online.code]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (member?.role === 'mac' && member.side === 1) return;
      online.send({ t: 'soccer', k: 'hi', r: online.round || 1, seq: sequence.current++, seat: online.seat, role: 'mac', side: 1 });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [online, member]);
  useEffect(() => {
    const off = online.onMessage((from, data) => {
      if (from !== 0) return;
      const packet = parsePacket(data);
      if (packet?.k === 'lobby' && packet.r === (online.round || 1)) publishLobby(packet);
    });
    return off;
  }, [online, online.round]);
  if (online.isHost) return null;
  const club = clubById(currentClub);
  return (
    <div className="g-soccer-guest-lobby">
      <div className="g-soccer-guest-card">
        <span className="g-soccer-eyebrow">online vs mac</span>
        <h2>{member ? 'you are on the away side' : 'connecting to the match'}</h2>
        <Crest club={club} size={76} />
        <strong>{club.name}</strong>
        <div className="g-soccer-guest-club-actions">
          <button type="button" onClick={() => sendNav(-1)}>previous club</button>
          <button type="button" onClick={() => sendNav(1)}>next club</button>
        </div>
        <p>Share this link with your phone to pick your club.</p>
        {qr && <img src={qr} alt="Phone picker link for side one" />}
        {online.round === 0 && <button type="button" className="arcade-btn arcade-btn-primary" onClick={() => sendNav(0, true)}>kick off</button>}
      </div>
    </div>
  );
}

export function PhoneLobby() {
  const online = useOnline();
  const shell = useShell();
  if (!online || shell.touch) return null;
  return online.isHost ? <HostLobby online={online} /> : <GuestMacLobby online={online} />;
}

function PickStick({ movement }: { movement: { current: { x: number; z: number } } }) {
  const pointer = useRef<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width * 0.36;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy), scale = length > radius ? radius / length : 1;
    const x = dx * scale, y = dy * scale;
    movement.current = { x: x / radius, z: y / radius };
    setOffset({ x, y });
  };
  const release = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && pointer.current !== event.pointerId) return;
    pointer.current = null; movement.current = { x: 0, z: 0 }; setOffset({ x: 0, y: 0 });
  };
  return <div className="g-soccer-stick" aria-label="picker navigation stick"
    onPointerDown={(event) => { event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); update(event); }}
    onPointerMove={(event) => pointer.current === event.pointerId && update(event)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <i style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} />
  </div>;
}

export function PhoneTeamPicker({ online }: { online: NonNullable<ReturnType<typeof useOnline>> }) {
  const lobby = useLobbyState();
  const lobbyRef = useRef(lobby);
  const movement = useRef({ x: 0, z: 0 });
  const heldDirection = useRef({ x: 0, y: 0 });
  const sequence = useRef(0);
  const pendingA = useRef(false);
  const pendingB = useRef(false);
  const pendingDx = useRef<-1 | 0 | 1>(0);
  const pendingDy = useRef<-1 | 0 | 1>(0);
  const received = useRef(-1);
  const side = sideForRoom(online.code);
  const selfReady = lobby?.ready[side] ?? false;
  const selected = clubById(lobby?.clubs[side] ?? DEFAULT_CLUBS[side]);
  const focus = lobby?.focus[side] ?? 0;
  lobbyRef.current = lobby;

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = lobbyRef.current;
      if (current?.members.some((member) => member.seat === online.seat && member.role === 'phone' && member.side === side)) return;
      online.send({ t: 'soccer', k: 'hi', r: online.round || 1, seq: sequence.current++, seat: online.seat, role: 'phone', side });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [online, side]);
  useEffect(() => {
    const off = online.onMessage((from, data) => {
      if (from !== 0) return;
      const packet = parsePacket(data);
      if (packet?.k !== 'lobby' || packet.r !== (online.round || 1) || packet.seq <= received.current) return;
      received.current = packet.seq;
      publishLobby(packet);
    });
    const timer = window.setInterval(() => {
      const direction = (value: number, previous: number) => {
        if (Math.abs(value) < 0.3) return 0;
        if (previous && Math.sign(value) === previous && Math.abs(value) < 0.6) return previous;
        return Math.abs(value) >= 0.6 ? Math.sign(value) : 0;
      };
      const x = pendingDx.current || direction(movement.current.x, heldDirection.current.x) as -1 | 0 | 1;
      const y = pendingDy.current || direction(movement.current.z, heldDirection.current.y) as -1 | 0 | 1;
      heldDirection.current = { x, y };
      online.send({
        t: 'soccer', k: 'nav', r: online.round || 1, seq: sequence.current++, seat: online.seat, dx: x, dy: y,
        a: pendingA.current, b: pendingB.current,
      }, { fast: true });
      pendingA.current = false;
      pendingB.current = false;
      pendingDx.current = 0;
      pendingDy.current = 0;
    }, 1000 / 30);
    return () => { off(); window.clearInterval(timer); };
  }, [online, online.round]);

  return (
    <div className="g-soccer-phone-picker">
      <header><strong>pick your club</strong><span>{side === 1 ? 'away side' : 'home side'}</span></header>
      {!lobby ? <p className="g-soccer-picker-wait">waiting for the mac to open the lobby…</p> : (
        <>
          <div className="g-soccer-picker-mode">
            <span className={focus === 0 ? 'is-focused' : ''}>setup</span>
            <strong>{modeLabels[lobby.mode]}</strong>
          </div>
          <div className="g-soccer-picker-club">
            <button type="button" className="g-soccer-picker-arrow" aria-label="previous club" onClick={() => { pendingDx.current = -1; }}>◀</button>
            <div className="g-soccer-picker-identity">
              <Crest club={selected} size={112} />
              <h2>{selected.name}</h2>
              <span>{selected.ratings.attack} attack · {selected.ratings.midfield} midfield · {selected.ratings.defense} defense</span>
            </div>
            <button type="button" className="g-soccer-picker-arrow" aria-label="next club" onClick={() => { pendingDx.current = 1; }}>▶</button>
          </div>
          <div className="g-soccer-picker-controls">
            <PickStick movement={movement} />
            <div>
              <button type="button" onClick={() => { pendingB.current = true; }}>B · back</button>
              <button type="button" className="is-ready" onClick={() => { pendingA.current = true; }}>{selfReady ? 'ready ✓' : 'A · ready'}</button>
            </div>
          </div>
          <p className="g-soccer-picker-help">move the stick to browse · left and right to change · A to ready</p>
        </>
      )}
    </div>
  );
}
