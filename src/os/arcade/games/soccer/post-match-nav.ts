export type PostMatchNavState = {
  seq: number;
  edge: number;
  direction: -1 | 0 | 1;
  changedAt: number;
};

export function postMatchNavPacket(
  previous: PostMatchNavState,
  packet: { seq: number; z: number; e?: number; buttons: number },
  now: number,
): { state: PostMatchNavState; move: -1 | 0 | 1; choose: boolean } {
  if (packet.seq <= previous.seq) return { state: previous, move: 0, choose: false };
  const rawDirection = packet.z < -0.35 ? -1 : packet.z > 0.35 ? 1 : 0;
  const direction = rawDirection === 0 && previous.direction !== 0 && Math.abs(packet.z) >= 0.22
    ? previous.direction
    : rawDirection;
  const shouldMove = direction !== 0 && (direction !== previous.direction || now - previous.changedAt >= 320);
  return {
    state: {
      seq: packet.seq,
      edge: packet.e ?? previous.edge,
      direction,
      changedAt: shouldMove ? now : previous.changedAt,
    },
    move: shouldMove ? direction : 0,
    choose: !!(packet.buttons & 1) && packet.e !== undefined && packet.e > previous.edge,
  };
}

export function repeatPostMatchNav(
  previous: PostMatchNavState,
  now: number,
): { state: PostMatchNavState; move: -1 | 0 | 1 } {
  if (previous.direction === 0 || now - previous.changedAt < 320) return { state: previous, move: 0 };
  return {
    state: { ...previous, changedAt: now },
    move: previous.direction,
  };
}
