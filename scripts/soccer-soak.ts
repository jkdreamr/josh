import { Worker } from 'node:worker_threads';
import { PAIRS, failures, table, type Row } from '../tests/soccer-replay/soak.ts';

export function seedList(args: string[], env: Record<string, string | undefined>): number[] {
  let count = env.SOCCER_SOAK_SEEDS ?? '50';
  let start = env.SOCCER_SOAK_START ?? '1';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds') count = args[++i] ?? '';
    else if (args[i] === '--start') start = args[++i] ?? '';
    else throw new Error('Usage: npm run soccer:soak -- [--seeds COUNT] [--start INTEGER]');
  }
  const n = Number(count),
    first = Number(start);
  if (
    !Number.isSafeInteger(n) ||
    n < 1 ||
    n > 10000 ||
    !Number.isSafeInteger(first) ||
    first < 1 ||
    first + n > 0xffffffff / 113
  )
    throw new Error('seeds must be 1–10000; start must be a positive integer within the uint32 seed range');
  return Array.from({ length: n }, (_, i) => (first + i) * 113);
}
async function main() {
  const seeds = seedList(process.argv.slice(2), process.env);
  const began = performance.now();
  console.log(
    'Soccer soak: ' +
      seeds.length +
      ' seeds × ' +
      PAIRS.length +
      ' pairs × 480 seconds; seeds ' +
      seeds[0] +
      '…' +
      seeds.at(-1),
  );
  const rows = await Promise.all(
    PAIRS.map(
      ([home, away]) =>
        new Promise<Row>((resolve, reject) => {
          const worker = new Worker(new URL('../tests/soccer-replay/soak-worker.ts', import.meta.url), {
            workerData: { home, away, seeds },
          });
          let result: Row | undefined;
          worker.once('message', (row) => {
            result = row;
          });
          worker.once('error', reject);
          worker.once('exit', (code) =>
            code === 0 && result ? resolve(result) : reject(new Error(home + '/' + away + ' worker exited ' + code)),
          );
        }),
    ),
  );
  console.log(table(rows));
  for (const row of rows) for (const error of failures(row)) console.error(row.home + '/' + row.away + ': ' + error);
  console.log('Total runtime: ' + ((performance.now() - began) / 1000).toFixed(3) + ' s');
  if (rows.some((row) => failures(row).length)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
