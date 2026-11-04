import { ARCADE_API } from '../../kit/leaderboard.ts';
import { RUN_VERSION, type RunTicket } from './replay.ts';

export async function startRankedRun(signal: AbortSignal): Promise<RunTicket | null> {
  try {
    const response = await fetch(`${ARCADE_API}/flappy/run`, { method: 'POST', signal });
    if (!response.ok) return null;
    const ticket = await response.json();
    return ticket?.version === RUN_VERSION && typeof ticket.token === 'string' &&
      Number.isInteger(ticket.seed) && ticket.seed >= 0 && ticket.seed <= 0xffffffff ? ticket : null;
  } catch { return null; }
}
