#!/usr/bin/env node
const usage = 'Usage: node scripts/soccer-telemetry.mjs [--hours 1..336] [--build HEX] [--api URL] [--json]';
const options = { hours: '336', build: '', api: '', json: false };

for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--json') {
    options.json = true;
  } else if (arg === '--hours' || arg === '--build' || arg === '--api') {
    const value = process.argv[++index];
    if (!value) {
      console.error(`${arg} needs a value\n${usage}`);
      process.exit(1);
    }
    if (arg === '--hours') options.hours = value;
    else if (arg === '--build') options.build = value;
    else options.api = value;
  } else {
    console.error(`Unknown option: ${arg}\n${usage}`);
    process.exit(1);
  }
}

const hours = /^\d+$/.test(options.hours) ? Number(options.hours) : NaN;
if (!Number.isSafeInteger(hours) || hours < 1 || hours > 336) {
  console.error(`--hours must be an integer from 1 to 336\n${usage}`);
  process.exit(1);
}
if (options.build && !/^[0-9a-f]{1,40}$/i.test(options.build)) {
  console.error(`--build must be a hexadecimal SHA prefix\n${usage}`);
  process.exit(1);
}
if (!process.env.TELEMETRY_TOKEN) {
  console.error('TELEMETRY_TOKEN is required');
  process.exit(1);
}

const api = (options.api || process.env.ARCADE_API || process.env.PUBLIC_ARCADE_API || 'https://josh-arcade.joshuakoo.workers.dev')
  .replace(/\/+$/, '');
const query = new URLSearchParams({ hours: String(hours) });
if (options.build) query.set('build', options.build.toLowerCase());
const counts = (values) => Object.entries(values ?? {}).map(([name, count]) => `${name} ${count}`).join(', ') || 'none';
const value = (percentile, key) => percentile?.[key] ?? 'n/a';

try {
  const response = await fetch(`${api}/telemetry/summary?${query}`, {
    headers: { authorization: `Bearer ${process.env.TELEMETRY_TOKEN}` },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${text}`);
    process.exitCode = 1;
  } else {
    const summary = JSON.parse(text);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Soccer telemetry · ${summary.window.hours}h · ${summary.window.from} to ${summary.window.to}`);
      console.log(`Errors: ${summary.totals.errors} across ${summary.totals.errorEvents} events · ${summary.totals.clients} clients`);
      console.log('\nErrors');
      console.log('count | clients | roles / devices | last seen | message');
      for (const error of summary.errors) {
        const message = error.message.length > 80 ? `${error.message.slice(0, 77)}...` : error.message;
        console.log(`${error.count} | ${error.clients} | ${counts(error.roles)} / ${counts(error.devices)} | ${error.last} | ${message}`);
        if (error.frame) console.log(`  ${error.frame}`);
      }
      if (!summary.errors.length) console.log('No errors');
      console.log('\nPerf');
      console.log('group | samples | fps p50 / p5 | longest frame p95 | input RTT p50 / p95 | loss p95 | tiers | drops / reconnects');
      if (!summary.perf.length) console.log('  No samples');
      for (const perf of summary.perf) {
        console.log([
          perf.group,
          perf.samples,
          `${value(perf.fps50, 'p50')} / ${value(perf.fps5, 'p50')}`,
          `${value(perf.longMs, 'p95')} ms`,
          `${value(perf.in50, 'p50')} / ${value(perf.in95, 'p95')} ms`,
          value(perf.loss, 'p95'),
          counts(perf.tiers),
          `${perf.drops} / ${perf.reconnects}`,
        ].join(' | '));
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
