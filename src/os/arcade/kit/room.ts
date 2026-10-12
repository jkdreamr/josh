import { ARCADE_API } from './leaderboard.ts';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];

export type RoomPlayer = { seat: number; name: string };
export type RoomTransport = 'direct' | 'relay';
type Peer = { pc: RTCPeerConnection; channels: Map<'r' | 'u', RTCDataChannel>; candidates: RTCIceCandidateInit[] };

type RoomEvents = {
  welcome: { seat: number; code: string; game: string; seats: number; players: RoomPlayer[] };
  players: RoomPlayer[];
  start: RoomPlayer[];
  msg: { from: number; d: unknown };
  closed: { reason: string };
  transport: RoomTransport;
};

type Listener<T> = (value: T) => void;

export function makeRoomCode(bytes: ArrayLike<number>): string {
  if (bytes.length < 4) throw new RangeError('four random bytes are required');
  return Array.from({ length: 4 }, (_, i) => ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]).join('');
}

export async function createRoom(game: string, api = ARCADE_API): Promise<string> {
  if (!api) throw new Error('Online Play Is Unavailable');
  const response = await fetch(`${api.replace(/\/+$/, '')}/rooms?game=${encodeURIComponent(game)}`, { method: 'POST' });
  if (!response.ok) throw new Error('Could Not Create A Room');
  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== 'string' || !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(body.code)) throw new Error('Invalid Room Code');
  return body.code;
}

export class RoomLink {
  readonly code: string;
  readonly name: string;
  seat: number | null = null;
  game = '';
  seats = 0;
  players: RoomPlayer[] = [];
  private readonly socket: WebSocket;
  private readonly listeners = new Map<keyof RoomEvents, Set<Listener<never>>>();
  private readonly peers = new Map<number, Peer>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private transportValue: RoomTransport = 'relay';
  private closed = false;

  constructor(code: string, name: string, api = ARCADE_API) {
    if (!api) throw new Error('Online Play Is Unavailable');
    this.code = code.toUpperCase();
    this.name = name;
    const base = new URL(api);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/rooms/${encodeURIComponent(this.code)}/ws`;
    base.search = new URLSearchParams({ name }).toString();
    this.socket = new WebSocket(base);
    this.socket.addEventListener('open', this.onOpen);
    this.socket.addEventListener('message', this.onSocketMessage);
    this.socket.addEventListener('close', this.onSocketClose);
    this.socket.addEventListener('error', this.onSocketError);
  }

  get transport(): RoomTransport {
    return this.transportValue;
  }

  on<K extends keyof RoomEvents>(event: K, listener: Listener<RoomEvents[K]>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as Listener<never>);
    return () => listeners?.delete(listener as Listener<never>);
  }

  start() {
    this.sendSocket({ t: 'start' });
  }

  reportResult(round: number, winner: number | null) {
    this.sendSocket({ t: 'result', round, winner });
  }

  send(d: unknown, options: { to?: number; fast?: boolean } = {}) {
    const label = options.fast ? 'u' : 'r';
    const payload = JSON.stringify(d);
    const recipients = this.seat === 0
      ? options.to === undefined ? this.players.map(({ seat }) => seat).filter((seat) => seat !== 0) : [options.to]
      : this.seat === null ? [] : [0];
    let relayed = false;

    for (const seat of recipients) {
      const peer = this.peers.get(seat);
      const channel = peer?.channels.get(label);
      if (channel?.readyState === 'open') {
        channel.send(payload);
      } else {
        this.sendSocket({ t: 'msg', to: this.seat === 0 ? seat : 0, d });
        relayed = true;
      }
    }
    if (!recipients.length && options.to !== undefined) {
      this.sendSocket({ t: 'msg', to: options.to, d });
      relayed = true;
    }
    if (relayed) this.setTransport('relay');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer !== null) globalThis.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket.removeEventListener('open', this.onOpen);
    this.socket.removeEventListener('message', this.onSocketMessage);
    this.socket.removeEventListener('close', this.onSocketClose);
    this.socket.removeEventListener('error', this.onSocketError);
    this.socket.close();
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
  }

  private readonly onOpen = () => {
    this.pingTimer = globalThis.setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send('ping');
    }, 25_000);
  };

  private readonly onSocketMessage = (event: MessageEvent<string>) => {
    if (typeof event.data !== 'string') return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === 'welcome' && Number.isInteger(message.seat) && typeof message.game === 'string' && Number.isInteger(message.seats)) {
      this.seat = message.seat as number;
      this.game = message.game;
      this.seats = message.seats as number;
      this.players = this.asPlayers(message.players);
      this.emit('welcome', { seat: this.seat, code: this.code, game: this.game, seats: this.seats, players: this.players });
      this.emit('players', this.players);
    } else if (message.t === 'players') {
      this.players = this.asPlayers(message.players);
      this.emit('players', this.players);
      this.updateTransport();
    } else if (message.t === 'start') {
      this.players = this.asPlayers(message.players);
      this.emit('start', this.players);
      if (this.peers.size === 0) this.beginPeers();
    } else if (message.t === 'msg' && Number.isInteger(message.from)) {
      this.emit('msg', { from: message.from as number, d: message.d });
    } else if (message.t === 'signal' && Number.isInteger(message.from)) {
      void this.receiveSignal(message.from as number, message.d);
    } else if (message.t === 'closed' && typeof message.reason === 'string') {
      this.emit('closed', { reason: message.reason });
    }
  };

  private readonly onSocketClose = () => {
    if (!this.closed) this.emit('closed', { reason: 'connection-lost' });
  };

  private readonly onSocketError = () => {
    if (!this.closed) this.setTransport('relay');
  };

  private async beginPeers() {
    if (typeof RTCPeerConnection === 'undefined' || this.seat === null) {
      this.setTransport('relay');
      return;
    }
    if (this.seat === 0) {
      for (const player of this.players) if (player.seat !== 0) await this.offerTo(player.seat);
    }
  }

  private async offerTo(seat: number) {
    const peer = this.createPeer(seat);
    if (!peer) return;
    peer.channels.set('r', peer.pc.createDataChannel('r', { ordered: true }));
    peer.channels.set('u', peer.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
    this.bindChannels(seat, peer);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(seat, peer.pc.localDescription);
    } catch {
      this.setTransport('relay');
    }
  }

  private async receiveSignal(from: number, value: unknown) {
    const peer = this.createPeer(from);
    if (!peer || !value || typeof value !== 'object') return;
    const signal = value as Record<string, unknown>;
    try {
      if (typeof signal.candidate === 'string') {
        const candidate = signal as unknown as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.candidates.push(candidate);
        return;
      }
      if (typeof signal.type !== 'string' || !['offer', 'answer', 'pranswer', 'rollback'].includes(signal.type)) return;
      await peer.pc.setRemoteDescription(signal as unknown as RTCSessionDescriptionInit);
      for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
      if (signal.type === 'offer') {
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(from, peer.pc.localDescription);
      }
    } catch {
      this.setTransport('relay');
    }
  }

  private createPeer(seat: number): Peer | null {
    const existing = this.peers.get(seat);
    if (existing) return existing;
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, channels: new Map(), candidates: [] };
    this.peers.set(seat, peer);
    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(seat, event.candidate.toJSON());
    };
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label !== 'r' && channel.label !== 'u') return channel.close();
      peer.channels.set(channel.label, channel);
      this.bindChannels(seat, peer);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') this.setTransport('relay');
    };
    return peer;
  }

  private bindChannels(seat: number, peer: Peer) {
    for (const channel of peer.channels.values()) {
      channel.onopen = () => this.updateTransport();
      channel.onclose = () => this.setTransport('relay');
      channel.onmessage = (event) => {
        try {
          this.emit('msg', { from: seat, d: JSON.parse(String(event.data)) });
        } catch {
          return;
        }
      };
    }
  }

  private sendSignal(seat: number, d: unknown) {
    if (d) this.sendSocket({ t: 'signal', to: seat, d });
  }

  private sendSocket(message: unknown) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private updateTransport() {
    const peers = this.seat === 0
      ? this.players.filter(({ seat }) => seat !== 0)
      : this.seat === null ? [] : this.players.filter(({ seat }) => seat === 0);
    const direct = peers.length > 0 && peers.every((player) =>
      (['r', 'u'] as const).every((label) => this.peers.get(player.seat)?.channels.get(label)?.readyState === 'open'),
    );
    this.setTransport(direct ? 'direct' : 'relay');
  }

  private setTransport(value: RoomTransport) {
    if (this.transportValue === value) return;
    this.transportValue = value;
    this.emit('transport', value);
  }

  private asPlayers(value: unknown): RoomPlayer[] {
    if (!Array.isArray(value)) return [];
    return value.filter((player): player is RoomPlayer =>
      !!player && typeof player === 'object' && Number.isInteger((player as RoomPlayer).seat) && typeof (player as RoomPlayer).name === 'string',
    ).map(({ seat, name }) => ({ seat, name }));
  }

  private emit<K extends keyof RoomEvents>(event: K, value: RoomEvents[K]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as Listener<RoomEvents[K]>)(value);
  }
}
