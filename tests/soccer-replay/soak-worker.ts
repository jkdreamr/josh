import { parentPort, workerData } from 'node:worker_threads';
import { runRow } from './soak.ts';

parentPort!.postMessage(runRow(workerData.home, workerData.away, workerData.seeds));
