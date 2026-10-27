export type SoccerRenderStats = {
  rendererCalls: number;
  triangles: number;
  shadowsEnabled: boolean;
  shadowType: number;
  shadowWidth: number;
  shadowHeight: number;
  crowdMeshCount: number;
};

type MetricSummary = { mean: number; p50: number; p95: number; max: number };
type PerfSummary = {
  enabled: true;
  startedAt: number;
  updatedAt: number;
  raw: Record<string, number[]>;
  summary: Record<string, MetricSummary>;
  hudCommitsPerSecond: number;
  renderer: SoccerRenderStats | null;
};

declare global {
  interface Window {
    __soccerPerf?: PerfSummary;
  }
}

export const soccerPerfEnabled = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('soccerperf');

const raw: Record<string, number[]> = {};
const hudCommitTimes: number[] = [];
let renderer: SoccerRenderStats | null = null;
let lastPublish = 0;
let startedAt = 0;

if (soccerPerfEnabled && typeof window !== 'undefined') {
  startedAt = performance.now();
  window.__soccerPerf = { enabled: true, startedAt, updatedAt: startedAt, raw, summary: {}, hudCommitsPerSecond: 0, renderer };
}

export function recordSoccerPerf(name: string, value: number) {
  const samples = raw[name] ?? (raw[name] = []);
  samples.push(value);
}

export function recordSoccerRendererStats(stats: SoccerRenderStats) {
  renderer = stats;
  recordSoccerPerf('rendererCalls', stats.rendererCalls);
  recordSoccerPerf('triangles', stats.triangles);
  recordSoccerPerf('shadowsEnabled', stats.shadowsEnabled ? 1 : 0);
  recordSoccerPerf('shadowType', stats.shadowType);
  recordSoccerPerf('shadowWidth', stats.shadowWidth);
  recordSoccerPerf('shadowHeight', stats.shadowHeight);
  recordSoccerPerf('crowdMeshCount', stats.crowdMeshCount);
}

export function recordSoccerHudCommit() {
  hudCommitTimes.push(performance.now());
}

function summarize(values: number[]): MetricSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
}

export function publishSoccerPerf() {
  if (!soccerPerfEnabled || typeof window === 'undefined') return;
  const now = performance.now();
  if (now - lastPublish < 1000) return;
  lastPublish = now;
  while (hudCommitTimes.length && hudCommitTimes[0]! < now - 1000) hudCommitTimes.shift();
  const summary: Record<string, MetricSummary> = {};
  for (const [name, values] of Object.entries(raw)) if (values.length) summary[name] = summarize(values);
  recordSoccerPerf('hudCommitsPerSecond', hudCommitTimes.length);
  window.__soccerPerf = {
    enabled: true,
    startedAt,
    updatedAt: now,
    raw,
    summary,
    hudCommitsPerSecond: hudCommitTimes.length,
    renderer,
  };
}
