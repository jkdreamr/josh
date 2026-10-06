export type RaceDistance = 500 | 1000 | 2000;
export type LeaderboardEntry = {
  name: string;
  timeMs: number;
  date: string;
  avgRate?: number;
  strokes?: number;
};
export type LeaderboardResult = { entries: LeaderboardEntry[]; scope: 'global' | 'device' };
export type SubmitScore = {
  distance: RaceDistance;
  name: string;
  timeMs: number;
  avgRate: number;
  strokes: number;
};

const STORAGE_KEY = 'coxbox-lb-v2';

function readDeviceBoards(): Record<string, LeaderboardEntry[]> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeDeviceBoards(boards: Record<string, LeaderboardEntry[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch {
    // local storage can be unavailable in private browsing
  }
}

function ranked(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => a.timeMs - b.timeMs).slice(0, 10);
}

export async function getBoard(distance: RaceDistance): Promise<LeaderboardResult> {
  try {
    const response = await fetch(`/api/leaderboard?distance=${distance}`);
    if (!response.ok) throw new Error('leaderboard unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.entries)) throw new Error('invalid leaderboard response');
    return { entries: payload.entries, scope: 'global' };
  } catch {
    return { entries: ranked(readDeviceBoards()[String(distance)] ?? []), scope: 'device' };
  }
}

export async function submit(score: SubmitScore): Promise<LeaderboardResult> {
  const name = score.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 16);
  const cleanScore = { ...score, name };
  const entry: LeaderboardEntry = { name, timeMs: score.timeMs, date: new Date().toISOString(), avgRate: score.avgRate, strokes: score.strokes };
  const boards = readDeviceBoards();
  boards[String(score.distance)] = ranked([...(boards[String(score.distance)] ?? []), entry]);
  writeDeviceBoards(boards);

  try {
    const response = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cleanScore),
    });
    if (!response.ok) throw new Error('leaderboard unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.entries)) throw new Error('invalid leaderboard response');
    return { entries: payload.entries, scope: 'global' };
  } catch {
    return { entries: boards[String(score.distance)], scope: 'device' };
  }
}
