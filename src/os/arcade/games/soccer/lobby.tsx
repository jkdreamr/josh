import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Segmented, levelOptions, useOnline, useSetting, useShell } from '../../kit';
import QRCode from 'qrcode';
import { COMPETITIONS, competitionById, type CompetitionId } from './modes.ts';
import { CLUBS, clubById, DEFAULT_CLUBS } from './teams.ts';
import { MODE, COMPETITION, HOME_CLUB, AWAY_CLUB, HALF, LEVEL, CAMERA, TIME } from './settings.ts';
import type { Mode } from './modes.ts';
import { clearCup, createCup, cupSummary, loadCup, saveCup, userFixture, type Cup } from './cup.ts';
import { hostLobbyStatus, lobbySetupOptions, phoneStatusLine, requiredPhones, sideForLobbyMember } from './phone-flow.ts';
import { parsePacket, type LobbyMember, type LobbyPacket } from './net.ts';
import { Crest } from './crest.tsx';
import { preloadSoccer } from './load.ts';
import { LoadProgress } from './loading.tsx';

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

const modeLabels: Record<Mode, string> = { cpu: 'vs cpu', versus: '2 player versus', coop: '2 player co-op', practice: 'practice · learn the controls' };
const competitionOptions = COMPETITIONS.map(({ id, label }) => [id, label] as const);
const halfOptions = [['2', '2 min'], ['4', '4 min'], ['6', '6 min']] as const;
const cameraOptions = [['broadcast', 'Broadcast'], ['end', 'End to end']] as const;
const timeOptions = [['day', 'Day'], ['night', 'Night'], ['golden', 'Golden hour'], ['overcast', 'Overcast'], ['rain', 'Rain']] as const;
const clampIndex = (index: number) => (index + CLUBS.length) % CLUBS.length;
const nextClubId = (id: string, direction: number, other: string) => {
  let index = clampIndex(CLUBS.findIndex((club) => club.id === id));
  for (let step = 0; step < CLUBS.length; step++) {
    index = clampIndex(index + direction);
    if (CLUBS[index]!.id !== other) return CLUBS[index]!.id;
  }
  return id;
};

function ClubPickerCard({ label, id, other, locked, onChange }: {
  label: string;
  id: string;
  other: string;
  locked?: boolean;
  onChange: (id: string) => void;
}) {
  const club = clubById(id);
  const overall = Math.round((club.ratings.attack + club.ratings.midfield + club.ratings.defense) / 3);
  return (
    <div className="g-soccer-lobby-club">
      <span className="g-soccer-lobby-club-label">{label}</span>
      <div className={`g-soccer-club-picker-card${locked ? ' is-locked' : ''}`}>
        {!locked && <button type="button" aria-label={`previous ${label}`} onClick={() => onChange(nextClubId(id, -1, other))}>◀</button>}
        <Crest club={club} size={36} />
        <div className="g-soccer-club-picker-copy">
          <strong>{club.name}</strong>
          <span>ovr {overall}</span>
        </div>
        {!locked && <button type="button" aria-label={`next ${label}`} onClick={() => onChange(nextClubId(id, 1, other))}>▶</button>}
      </div>
    </div>
  );
}

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

function HostLobby({ online, postMatch = false }: { online: NonNullable<ReturnType<typeof useOnline>>; postMatch?: boolean }) {
  const [mode, setMode] = useSetting(MODE);
  const [competition, setCompetition] = useSetting(COMPETITION);
  const [homeId, setHomeId] = useSetting(HOME_CLUB);
  const [awayId, setAwayId] = useSetting(AWAY_CLUB);
  const [half, setHalf] = useSetting(HALF);
  const [level, setLevel] = useSetting(LEVEL);
  const [camera, setCamera] = useSetting(CAMERA);
  const [time, setTime] = useSetting(TIME);
  const [qr, setQr] = useState('');
  const [focus, setFocus] = useState<[number, number]>([1, 0]);
  const [ready, setReady] = useState<[boolean, boolean]>([false, false]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [members, setMembers] = useState<LobbyMember[]>([{ seat: 0, role: 'host', side: 0 }]);
  const [cup, setCup] = useState<Cup | null>(() => loadCup());
  const matchStarted = useRef(false);
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
  const memberList = currentMembers(members, online.players).map((member) => ({
    ...member,
    side: sideForLobbyMember(competition, mode, member.role, member.seat, member.side),
  }));
  const phoneCount = memberList.filter((member) => member.role === 'phone').length;
  const phoneStatus = phoneStatusLine(memberList, ready);
  const showSecondPhoneCaption = competition === 'quick' && (mode === 'versus' || mode === 'coop');
  const guestMac = memberList.some((member) => member.role === 'mac' && member.side === 1);
  const sideOnePhones = memberList.filter((member) => member.role === 'phone' && member.side === 1).length;
  const phonesNeeded = requiredPhones(competition, mode);
  const enoughPlayers = competition === 'online' ? guestMac : phoneCount >= phonesNeeded;
  const inviteUrl = online.code && typeof location !== 'undefined'
    ? `${location.protocol}//${location.host}/?game=soccer&room=${online.code}`
    : '';
  const statusLine = countdown === null
    ? hostLobbyStatus({ competition, mode, phoneCount, guestMac })
    : `Starting in ${countdown}…`;
  const isRunningCup = competition === 'cup' && cup !== null && cup.round < 3 && !cup.out;

  useEffect(() => {
    if (online.isHost) preloadSoccer().catch(() => {});
  }, [online.isHost]);

  useEffect(() => {
    if (!inviteUrl) return;
    void QRCode.toDataURL(inviteUrl, { errorCorrectionLevel: 'H', margin: 2, width: 250 }).then(setQr).catch(() => setQr(''));
  }, [inviteUrl]);

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
          next.push({ seat: from, role: packet.role, side: sideForLobbyMember(compRef.current, modeRef.current, packet.role, from, packet.side) });
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
        const side = sideForLobbyMember(compRef.current, modeRef.current, member.role, from, member.side);
        if (packet.a) setReady((previous) => previous.map((value, index) => index === side ? true : value) as [boolean, boolean]);
        if (packet.b) setReady((previous) => previous.map((value, index) => index === side ? false : value) as [boolean, boolean]);
        if (packet.dx || packet.dy) {
          setReady([false, false]);
          setCountdown(null);
        }
        if (packet.dy) setFocus((previous) => previous.map((value, index) => index === side ? 1 - value : value) as [number, number]);
        if (packet.dx && focus[side] === 0 && side === 0) {
          const arrangements = lobbySetupOptions(compRef.current);
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
    const arrangements = lobbySetupOptions(competition);
    if (!arrangements.includes(mode)) setMode(arrangements[0]!);
  }, [competition, mode, setMode]);

  useEffect(() => {
    if (competition === 'cup' && cup && cup.user !== homeId && cup.round < 3 && !cup.out) setHomeId(cup.user);
  }, [competition, cup, homeId, setHomeId]);

  useEffect(() => {
    const packet: LobbyPacket = {
      t: 'soccer', k: 'lobby', r: online.round || 1, seq: sequence.current++, comp: competition, mode,
      clubs: [homeId, awayId], focus, ready, countdown, members: memberList, ...(cup ? { cup: cupSummary(cup) } : {}),
      ...(postMatch ? { screen: matchStarted.current ? 'match' as const : 'lobby' as const } : {}),
    };
    publishLobby(packet);
    if (online.round === 0 || postMatch) online.send(packet);
  }, [online, competition, mode, homeId, awayId, focus, ready, countdown, members, cup, postMatch]);

  useEffect(() => {
    if (countdown === null || !online.isHost) return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else {
        matchStarted.current = true;
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
          focus, ready: [true, true], countdown: null, members: currentMembers(membersRef.current, online.players).map((member) => ({
            ...member,
            side: sideForLobbyMember(compRef.current, modeRef.current, member.role, member.seat, member.side),
          })),
          ...(latestCup ? { cup: cupSummary(latestCup) } : {}),
          ...(postMatch ? { screen: 'match' as const } : {}),
        };
        online.send(packet);
        publishLobby(packet);
        online.start();
        setCountdown(null);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, online, cup, focus, postMatch]);

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
    <div className="g-soccer-phone-lobby-shell">
      <div className={`g-soccer-phone-lobby${connected.length ? ' is-connected' : ''}${phonesNeeded === 2 && phoneCount === 1 ? ' needs-second-phone' : ''}`}>
        <div className="g-soccer-phone-lobby-rail">
        <div className="g-soccer-phone-qr">
          {qr && <img src={qr} alt="Connect phone QR code" />}
          {phoneCount > 0 && showSecondPhoneCaption && <strong>Scan to add a second phone</strong>}
        </div>
        {phoneCount > 0 && (
          <div className="g-soccer-phone-lobby-status">
            <p className="g-soccer-lobby-status" role="status">{statusLine}</p>
            <div className="g-soccer-phone-connections" role="status">
              {phoneStatus && phoneStatus.split(' · ').map((status, index) => <span key={index}>{status}</span>)}
              {competition === 'online' && <span className={guestMac ? '' : 'is-waiting'}>{guestMac ? 'Other Mac connected' : 'Waiting for the other Mac'}</span>}
              {competition === 'online' && <span className={sideOnePhones ? '' : 'is-waiting'}>{sideOnePhones ? 'Other phone connected' : 'Other phone optional'}</span>}
              {competition !== 'online' && phonesNeeded === 2 && phoneCount === 1 && <span className="is-waiting">Waiting for a second phone</span>}
            </div>
          </div>
        )}
        </div>
        <div className="g-soccer-phone-lobby-content">
        {!phoneCount && (
          <div className="g-soccer-lobby-instructions">
            <h2>Scan with your iPhone camera</h2>
            <p>Your phone becomes the controller. No app needed.</p>
            {inviteUrl && <p className="g-soccer-invite-url">{inviteUrl}</p>}
            <div className="g-soccer-phone-connections" role="status"><span className="is-waiting">Waiting for your phone…</span></div>
          </div>
        )}
        {connected.length > 0 && (
          <>
            <Segmented label="competition" value={competition} options={competitionOptions} onChange={changeCompetition} />
            {competition === 'online' && online.code && <p className="g-soccer-friend-link">friend's mac: <a href={`/?game=soccer&room=${online.code}`}>{location.host}/?game=soccer&amp;room={online.code}</a></p>}
            {competition !== 'cup' && (
              <Segmented label="setup" value={mode} options={lobbySetupOptions(competition).map((arrangement) => [arrangement, modeLabels[arrangement]] as const)} onChange={(value) => { setReady([false, false]); setCountdown(null); setMode(value); }} />
            )}
            <div className={`g-soccer-lobby-clubs${def.opponentPick ? '' : ' is-single'}`}>
              <ClubPickerCard label="your club" id={homeId} other={awayId} locked={isRunningCup} onChange={(value) => setClub(0, value)} />
              {def.opponentPick && (
                <ClubPickerCard label={competition === 'online' ? "friend's club" : 'opponent'} id={awayId} other={homeId} onChange={(value) => setClub(1, value)} />
              )}
            </div>
            {competition === 'cup' && <CupLobbyCard cup={cup} homeId={homeId} setHomeId={setHomeId} setCup={setCup} />}
          </>
        )}
        <LoadProgress />
        </div>
        <div className="g-soccer-phone-lobby-footer">
        <details className="g-soccer-phone-settings">
          <summary>Settings</summary>
          <div className="g-soccer-settings">
            <Segmented label="Half length" value={half} options={halfOptions} onChange={setHalf} />
            <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
            <Segmented label="Camera" value={camera} options={cameraOptions} onChange={setCamera} />
            <Segmented label="Time of day" value={time} options={timeOptions} onChange={setTime} />
          </div>
        </details>
        {connected.length > 0 && <button type="button" className="arcade-btn arcade-btn-primary" disabled={!enoughPlayers || countdown !== null} onClick={start}>Start match</button>}
        </div>
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
        <div className="g-soccer-guest-main">
        <span className="g-soccer-eyebrow">online vs mac</span>
        <h2>{member ? 'you are on the away side' : 'connecting to the match'}</h2>
        <div className="g-soccer-guest-club">
          <Crest club={club} size={46} />
          <strong>{club.name}</strong>
        </div>
        <div className="g-soccer-guest-club-actions">
          <button type="button" aria-label="previous club" onClick={() => sendNav(-1)}>◀</button>
          <button type="button" aria-label="next club" onClick={() => sendNav(1)}>▶</button>
        </div>
        {online.round === 0 && <button type="button" className="arcade-btn arcade-btn-primary g-soccer-guest-kickoff" onClick={() => sendNav(0, true)}>kick off</button>}
        </div>
        <div className="g-soccer-guest-qr">
          <span>scan to pick your club</span>
          {qr && <img src={qr} alt="Phone picker link for side one" />}
        </div>
      </div>
    </div>
  );
}

export function PhoneLobby({ postMatch = false }: { postMatch?: boolean } = {}) {
  const online = useOnline();
  const shell = useShell();
  if (!online || shell.touch) return null;
  return online.isHost ? <HostLobby online={online} postMatch={postMatch} /> : <GuestMacLobby online={online} />;
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
  const ownMember = lobby?.members.find((entry) => entry.seat === online.seat);
  const side = lobby ? ownMember?.side ?? 0 : sideForRoom(online.code);
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
      <header><strong>Tilt the stick to pick your club, press A</strong><span>{side === 1 ? 'Away side' : 'Home side'}</span></header>
      {!lobby ? <p className="g-soccer-picker-wait" role="status">{online.round > 0 ? 'Match in progress — reconnecting to your Mac…' : 'Connecting to your Mac…'}</p> : (
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
        </>
      )}
    </div>
  );
}
