import * as tf from '@tensorflow/tfjs-core';
import { BLACK, legalMoves, newGame, type GameState, type Ownership } from '../go.ts';
import { encodeV7, symmetryIndex } from './features.ts';
import { gunzipIfNeeded, parseKataGoModel } from './model.ts';
import { KataGoModelV8Tf } from './network.ts';
import { FAST, STRONG, search, type Evaluator, type NetOutput, type SearchOptions, type SearchResult } from './search.ts';

const softmax3 = (values: ArrayLike<number>): [number, number, number] => {
  const max = Math.max(values[0]!, values[1]!, values[2]!);
  const scores = [Math.exp(values[0]! - max), Math.exp(values[1]! - max), Math.exp(values[2]! - max)];
  const total = scores[0]! + scores[1]! + scores[2]!;
  return [scores[0]! / total, scores[1]! / total, scores[2]! / total];
};

export async function fetchModel(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
  return gunzipIfNeeded(new Uint8Array(await response.arrayBuffer()));
}

export class KataGo {
  readonly backend: string;
  readonly modelName: string;
  readonly evaluator: Evaluator;
  private readonly net: KataGoModelV8Tf;

  private constructor(backend: string, net: KataGoModelV8Tf) {
    this.backend = backend;
    this.net = net;
    this.modelName = net.modelName;
    this.evaluator = {
      evaluate: (states) => this.evaluate(states),
      evaluateSymmetric: (state) => this.evaluateSymmetric(state),
    };
  }

  static async load(bytes: Uint8Array, backends: string[]): Promise<KataGo> {
    const model = parseKataGoModel(bytes);
    const failures: string[] = [];
    for (const backend of backends) {
      let network: KataGoModelV8Tf | undefined;
      try {
        if (!await tf.setBackend(backend)) throw new Error(`Backend ${backend} is unavailable`);
        await tf.ready();
        network = new KataGoModelV8Tf(model);
        const instance = new KataGo(backend, network);
        const warmup = await instance.evaluate([newGame(9)]);
        if (!warmup.every((output) => [output.win, output.loss, output.noResult, output.scoreLead, ...output.policy, ...output.ownership].every(Number.isFinite))) {
          throw new Error(`${backend} warmup produced a non-finite output`);
        }
        return instance;
      } catch (error) {
        network?.dispose();
        failures.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`No KataGo backend succeeded (${failures.join('; ')})`);
  }

  async genmove(state: GameState, level: 'fast' | 'strong' | SearchOptions, extra: Partial<SearchOptions> = {}): Promise<SearchResult> {
    const base = typeof level === 'string' ? level === 'fast' ? FAST : STRONG : level;
    return search(state, this.evaluator, { ...base, ...extra });
  }

  async ownership(state: GameState): Promise<Ownership[]> {
    const output = await this.evaluateSymmetric(state);
    const sign = state.toPlay === BLACK ? 1 : -1;
    return Array.from(output.ownership, (value) => {
      const black = value * sign;
      return { black: Math.max(0, black), white: Math.max(0, -black), neutral: Math.max(0, 1 - Math.abs(black)) };
    });
  }

  dispose(): void {
    this.net.dispose();
  }

  private async evaluate(states: GameState[]): Promise<NetOutput[]> {
    return this.evaluateBatch(states, states.map(() => 0));
  }

  private async evaluateSymmetric(state: GameState): Promise<NetOutput> {
    const outputs = await this.evaluateBatch([state, state, state, state, state, state, state, state], [0, 1, 2, 3, 4, 5, 6, 7]);
    const policy = new Float32Array(82);
    const ownership = new Float32Array(81);
    let win = 0;
    let loss = 0;
    let noResult = 0;
    let scoreLead = 0;
    for (let symmetry = 0; symmetry < outputs.length; symmetry += 1) {
      const output = outputs[symmetry]!;
      win += output.win / 8;
      loss += output.loss / 8;
      noResult += output.noResult / 8;
      scoreLead += output.scoreLead / 8;
      for (let position = 0; position < 81; position += 1) {
        const transformed = symmetryIndex(symmetry, position);
        policy[position] += output.policy[transformed]! / 8;
        ownership[position] += output.ownership[transformed]! / 8;
      }
      policy[81] += output.policy[81]! / 8;
    }
    return { policy, win, loss, noResult, scoreLead, ownership };
  }

  private async evaluateBatch(states: GameState[], symmetries: number[]): Promise<NetOutput[]> {
    const encoded = states.map((state, index) => encodeV7(state, symmetries[index]!));
    const spatialValues = new Float32Array(states.length * 9 * 9 * 22);
    const globalValues = new Float32Array(states.length * 19);
    encoded.forEach((features, index) => {
      spatialValues.set(features.spatial, index * features.spatial.length);
      globalValues.set(features.global, index * features.global.length);
    });
    const spatial = tf.tensor4d(spatialValues, [states.length, 9, 9, 22]);
    const global = tf.tensor2d(globalValues, [states.length, 19]);
    const outputs = this.net.forward(spatial, global);
    spatial.dispose();
    global.dispose();
    const [policyLogits, passLogits, valueLogits, scoreValues, ownershipLogits] = await Promise.all([
      outputs.policy.data(), outputs.policyPass.data(), outputs.value.data(), outputs.scoreValue.data(), outputs.ownership.data(),
    ]);
    outputs.policy.dispose();
    outputs.policyPass.dispose();
    outputs.value.dispose();
    outputs.scoreValue.dispose();
    outputs.ownership.dispose();
    return states.map((state, batchIndex) => {
      const valueOffset = batchIndex * 3;
      const [win, loss, noResult] = softmax3([valueLogits[valueOffset]!, valueLogits[valueOffset + 1]!, valueLogits[valueOffset + 2]!]);
      const scoreOffset = batchIndex * this.net.scoreValueChannels;
      const scoreLead = scoreValues[scoreOffset + 2]! * 20 * (1 - noResult);
      const rawPolicy = new Float32Array(82);
      const policyOffset = batchIndex * 81 * this.net.policyOutChannels;
      for (let position = 0; position < 81; position += 1) rawPolicy[position] = policyLogits[policyOffset + position * this.net.policyOutChannels]!;
      rawPolicy[81] = passLogits[batchIndex * this.net.policyOutChannels]!;
      const symmetry = symmetries[batchIndex]!;
      const legal = new Set(legalMoves(state).map((point) => symmetryIndex(symmetry, point.y * 9 + point.x)));
      const ownership = new Float32Array(81);
      const ownershipOffset = batchIndex * 81;
      for (let position = 0; position < 81; position += 1) {
        ownership[position] = Math.tanh(ownershipLogits[ownershipOffset + position]!);
      }
      return { policy: maskPolicy(rawPolicy, legal), win, loss, noResult, scoreLead, ownership };
    });
  }
}

function maskPolicy(logits: Float32Array, legal: Set<number>): Float32Array {
  let max = logits[81]!;
  for (let position = 0; position < 81; position += 1) {
    if (legal.has(position)) max = Math.max(max, logits[position]!);
  }
  const policy = new Float32Array(82);
  let total = Math.exp(logits[81]! - max);
  policy[81] = total;
  for (let position = 0; position < 81; position += 1) {
    if (!legal.has(position)) continue;
    policy[position] = Math.exp(logits[position]! - max);
    total += policy[position]!;
  }
  for (let position = 0; position < policy.length; position += 1) policy[position] /= total;
  return policy;
}
