import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import util from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { BLACK, legalMoves, newGame, pass, play, type Color, type GameState, type Point } from '../src/os/games/go.ts';
import { KataGo } from '../src/os/games/katago/engine.ts';
import { gunzipIfNeeded } from '../src/os/games/katago/model.ts';
import type { NetOutput } from '../src/os/games/katago/search.ts';

const legacyUtil = util as typeof util & { isNullOrUndefined?: (value: unknown) => boolean };
legacyUtil.isNullOrUndefined ??= (value) => value === null || value === undefined;
const tfNodeModule = '@tensorflow/tfjs-node';
await import(tfNodeModule);

type Action = Point | null;
type Scenario = { name: string; actions: Action[]; state: GameState };

const modelPath = `${homedir()}/nets/kata1-b10c128-s1141046784-d204142634.txt.gz`;
const binaryModelPath = `${homedir()}/repos/josh/public/models/kata1-b10c128-s1141046784-d204142634.bin.gz`;
const configPath = `${homedir()}/katago-ref/default_gtp.cfg`;
const executable = `${homedir()}/katago-ref/katago`;
const rules = {
  ko: 'POSITIONAL',
  scoring: 'AREA',
  tax: 'NONE',
  suicide: false,
  friendlyPassOk: false,
  hasButton: false,
  whiteHandicapBonus: 'N',
};

function scenario(name: string, actions: Action[]): Scenario {
  let state = newGame(9);
  for (const action of actions) {
    if (action === null) {
      state = pass(state);
      continue;
    }
    const result = play(state, action.x, action.y);
    if (!result.ok) throw new Error(`${name}: illegal setup move ${action.x},${action.y}: ${result.reason}`);
    state = result.state;
  }
  return { name, actions, state };
}

function nearFinalScenario(): Scenario {
  let state = newGame(9);
  const actions: Action[] = [];
  for (let turn = 0; turn < 64 && state.phase === 'play'; turn += 1) {
    const point = state.board.findIndex((_, index) => {
      const x = index % 9;
      const y = Math.floor(index / 9);
      if (state.board[index] !== 0) return false;
      return play(state, x, y).ok;
    });
    if (point < 0) {
      actions.push(null);
      state = pass(state);
      continue;
    }
    const move = { x: point % 9, y: Math.floor(point / 9) };
    actions.push(move);
    state = play(state, move.x, move.y).state;
  }
  return { name: 'near-final', actions, state };
}

function allScenarios(): Scenario[] {
  const midgame = scenario('mid-game', [
    { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 3 },
    { x: 4, y: 5 }, { x: 2, y: 2 }, { x: 6, y: 6 }, { x: 3, y: 5 },
    { x: 5, y: 3 }, { x: 2, y: 4 }, { x: 6, y: 4 }, { x: 4, y: 2 },
  ]);
  const ladder = scenario('ladder', [
    { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 0, y: 0 },
    { x: 4, y: 5 }, { x: 8, y: 8 },
  ]);
  const ko = scenario('ko-superko', [
    { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 3, y: 5 },
    { x: 4, y: 3 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 4, y: 6 },
    { x: 8, y: 8 }, { x: 0, y: 8 }, { x: 4, y: 5 },
  ]);
  const recapture = play(ko.state, 4, 4);
  if (recapture.ok || recapture.reason !== 'ko') throw new Error('ko-superko scenario does not ban its recapture');
  const afterPass = scenario('after-one-pass', [
    { x: 2, y: 2 }, { x: 6, y: 6 }, { x: 3, y: 5 }, { x: 5, y: 3 }, null,
  ]);
  return [
    scenario('empty', []),
    midgame,
    ladder,
    ko,
    afterPass,
    nearFinalScenario(),
  ];
}

class GtpClient {
  private buffer = '';
  private readonly pending: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = [];
  private readonly child: ReturnType<typeof spawn>;
  private readonly input: NonNullable<ReturnType<typeof spawn>['stdin']>;
  private readonly output: NonNullable<ReturnType<typeof spawn>['stdout']>;

  constructor(model = modelPath) {
    const child = spawn(executable, ['gtp', '-model', model, '-config', configPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (!child.stdin || !child.stdout) throw new Error('KataGo GTP pipes are unavailable');
    this.child = child;
    this.input = child.stdin;
    this.output = child.stdout;
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end = this.buffer.indexOf('\n\n');
      while (end >= 0) {
        const response = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 2);
        if (response.startsWith('=') || response.startsWith('?')) this.pending.shift()?.resolve(response);
        end = this.buffer.indexOf('\n\n');
      }
    });
    this.child.on('error', (error) => {
      while (this.pending.length) this.pending.shift()?.reject(error);
    });
    this.child.on('exit', (code) => {
      const error = new Error(`KataGo exited with code ${code}`);
      while (this.pending.length) this.pending.shift()?.reject(error);
    });
  }

  command(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.input.write(`${command}\n`, (error) => {
        if (error) {
          this.pending.pop();
          reject(error);
        }
      });
    });
  }

  async close(): Promise<void> {
    try {
      await this.command('quit');
    } finally {
      this.input.end();
    }
  }
}

async function replayPosition(client: GtpClient, position: Scenario): Promise<string> {
  await client.command('clear_board');
  await client.command('boardsize 9');
  await client.command('komi 7.5');
  await client.command(`kata-set-rules ${JSON.stringify(rules)}`);
  let toPlay: Color = BLACK;
  for (const action of position.actions) {
    const point = action ? gtpCoordinate(action) : 'pass';
    const response = await client.command(`play ${gtpColor(toPlay)} ${point}`);
    if (response.startsWith('?')) throw new Error(`KataGo could not replay ${position.name}: ${response}`);
    toPlay = -toPlay as Color;
  }
  return client.command('kata-raw-nn 0');
}

function gtpColor(color: number): string {
  return color === BLACK ? 'black' : 'white';
}

function gtpCoordinate(point: Point): string {
  const column = 'ABCDEFGHJKLMNOP'[point.x];
  return `${column}${9 - point.y}`;
}

function rawValue(text: string, name: string): number {
  const match = text.match(new RegExp(`^${name}\\s+([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)`, 'm'));
  if (!match) throw new Error(`Missing ${name} in kata-raw-nn output`);
  return Number(match[1]);
}

function rawGrid(text: string, section: string, nextSection: string): number[] {
  const start = text.indexOf(`${section}\n`);
  if (start < 0) throw new Error(`Missing ${section} grid in kata-raw-nn output`);
  const contentStart = start + section.length + 1;
  const end = nextSection === '$' ? text.length : text.indexOf(`\n${nextSection}`, contentStart);
  if (end < 0) throw new Error(`Missing ${nextSection} after ${section} grid in kata-raw-nn output`);
  return text.slice(contentStart, end).trim().split(/\s+/).map(Number);
}

function parseRawOutput(text: string, state: GameState): NetOutput {
  const whiteWin = rawValue(text, 'whiteWin');
  const whiteLoss = rawValue(text, 'whiteLoss');
  const noResult = rawValue(text, 'noResult');
  const whiteLead = rawValue(text, 'whiteLead');
  const whitePolicy = rawGrid(text, 'policy', 'policyPass');
  const passPolicy = rawValue(text, 'policyPass');
  const whiteOwnership = rawGrid(text, 'whiteOwnership', '$');
  const sign = state.toPlay === BLACK ? -1 : 1;
  const legal = new Set(legalMoves(state).map((point) => point.y * 9 + point.x));
  const policy = new Float32Array(82);
  for (let position = 0; position < 81; position += 1) {
    if (legal.has(position) && Number.isFinite(whitePolicy[position])) policy[position] = whitePolicy[position]!;
  }
  policy[81] = passPolicy;
  return {
    policy,
    win: state.toPlay === BLACK ? whiteLoss : whiteWin,
    loss: state.toPlay === BLACK ? whiteWin : whiteLoss,
    noResult,
    scoreLead: state.toPlay === BLACK ? -whiteLead : whiteLead,
    ownership: Float32Array.from(whiteOwnership, (value) => value * sign),
  };
}

function moveLabel(index: number): string {
  if (index === 81) return 'Pass';
  return gtpCoordinate({ x: index % 9, y: Math.floor(index / 9) });
}

function topMoves(output: NetOutput): string {
  return [...output.policy.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([index, probability]) => `${moveLabel(index)}=${probability.toFixed(6)}`)
    .join(', ');
}

function maxAbsDifference(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) maximum = Math.max(maximum, Math.abs(left[index]! - right[index]!));
  return maximum;
}

const lines: string[] = [];
const log = (line: string): void => {
  lines.push(line);
  console.log(line);
};

await import('@tensorflow/tfjs-core').then(({ setBackend, ready }) => setBackend('tensorflow').then(() => ready()));
const modelBytes = await gunzipIfNeeded(new Uint8Array(await readFile(modelPath)));
const engine = await KataGo.load(modelBytes, ['tensorflow']);
log(`backend=${engine.backend} model=${engine.modelName}`);
const client = new GtpClient();
let binaryClient: GtpClient | undefined;
let allWithinTolerance = true;

try {
  await client.command('boardsize 9');
  await client.command('komi 7.5');
  const rulesOutput = await client.command(`kata-set-rules ${JSON.stringify(rules)}`);
  const confirmedRules = await client.command('kata-get-rules');
  log(`kata-set-rules: ${rulesOutput.replace(/^=\s*/, '')}`);
  log(`kata-get-rules: ${confirmedRules.replace(/^=\s*/, '')}`);
  if (!confirmedRules.includes('"ko":"POSITIONAL"') || !confirmedRules.includes('"scoring":"AREA"') || !confirmedRules.includes('"friendlyPassOk":false')) {
    throw new Error(`KataGo rejected the requested rules: ${confirmedRules}`);
  }

  const scenarios = allScenarios();
  for (const position of scenarios) {
    const reference = parseRawOutput(await replayPosition(client, position), position.state);
    const output = (await engine.evaluator.evaluate([position.state]))[0]!;
    const policyError = maxAbsDifference(output.policy, reference.policy);
    const valueError = Math.max(
      Math.abs(output.win - reference.win),
      Math.abs(output.loss - reference.loss),
      Math.abs(output.noResult - reference.noResult),
      Math.abs(output.scoreLead - reference.scoreLead),
    );
    const ownershipError = maxAbsDifference(output.ownership, reference.ownership);
    const withinTolerance = policyError <= 1e-3 && valueError <= 1e-3;
    allWithinTolerance &&= withinTolerance;
    log(`${position.name} moves=${position.actions.length} policyMax=${policyError.toExponential(3)} valueMax=${valueError.toExponential(3)} ownershipMax=${ownershipError.toExponential(3)} ${withinTolerance ? 'PASS' : 'FAIL'}`);
    log(`  value ours=${output.win.toFixed(6)}/${output.loss.toFixed(6)}/${output.noResult.toFixed(6)} lead=${output.scoreLead.toFixed(4)} kata=${reference.win.toFixed(6)}/${reference.loss.toFixed(6)}/${reference.noResult.toFixed(6)} lead=${reference.scoreLead.toFixed(4)}`);
    log(`  policy ours ${topMoves(output)}; pass=${output.policy[81]!.toFixed(6)}`);
    log(`  policy kata ${topMoves(reference)}; pass=${reference.policy[81]!.toFixed(6)}`);
    log(`  ownership[0,40,80] ours=${[0, 40, 80].map((index) => output.ownership[index]!.toFixed(4)).join(',')} kata=${[0, 40, 80].map((index) => reference.ownership[index]!.toFixed(4)).join(',')}`);
  }

  binaryClient = new GtpClient(binaryModelPath);
  for (const position of scenarios.slice(0, 2)) {
    const textOutput = await replayPosition(client, position);
    const binaryOutput = await replayPosition(binaryClient, position);
    const identical = textOutput === binaryOutput;
    log(`text/bin ${position.name}: raw KataGo output ${identical ? 'identical' : 'DIFFERS'}`);
    allWithinTolerance &&= identical;
  }

  const singleStart = performance.now();
  await engine.evaluator.evaluate([scenarios[1]!.state]);
  const singleMs = performance.now() - singleStart;
  const batchStart = performance.now();
  await engine.evaluator.evaluate(Array.from({ length: 8 }, () => scenarios[1]!.state));
  const batchMs = performance.now() - batchStart;
  log(`tensorflow timing: batch1=${singleMs.toFixed(1)}ms batch8=${batchMs.toFixed(1)}ms`);

  const wasmDirectory = `${process.cwd()}/node_modules/@tensorflow/tfjs-backend-wasm/dist`;
  setWasmPaths({
    'tfjs-backend-wasm.wasm': `${wasmDirectory}/tfjs-backend-wasm.wasm`,
    'tfjs-backend-wasm-simd.wasm': `${wasmDirectory}/tfjs-backend-wasm-simd.wasm`,
    'tfjs-backend-wasm-threaded-simd.wasm': `${wasmDirectory}/tfjs-backend-wasm-threaded-simd.wasm`,
  });
  const wasmEngine = await KataGo.load(modelBytes, ['wasm']);
  const wasmSingleStart = performance.now();
  await wasmEngine.evaluator.evaluate([scenarios[1]!.state]);
  const wasmSingleMs = performance.now() - wasmSingleStart;
  const wasmBatchStart = performance.now();
  await wasmEngine.evaluator.evaluate(Array.from({ length: 8 }, () => scenarios[1]!.state));
  const wasmBatchMs = performance.now() - wasmBatchStart;
  log(`wasm timing: batch1=${wasmSingleMs.toFixed(1)}ms batch8=${wasmBatchMs.toFixed(1)}ms`);
  wasmEngine.dispose();
} finally {
  await client.close();
  if (binaryClient) await binaryClient.close();
  engine.dispose();
  await writeFile(`${homedir()}/bench/parity.txt`, `${lines.join('\n')}\n`);
}

if (!allWithinTolerance) process.exitCode = 1;
