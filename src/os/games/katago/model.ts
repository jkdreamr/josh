export type ActivationKind = 'identity' | 'relu' | 'mish';

export interface ParsedBatchNorm {
  readonly channels: number;
  readonly mergedScale: Float32Array;
  readonly mergedBias: Float32Array;
}

export interface ParsedConv2d {
  readonly name: string;
  readonly kernelY: number;
  readonly kernelX: number;
  readonly inChannels: number;
  readonly outChannels: number;
  readonly dilationY: number;
  readonly dilationX: number;
  readonly weights: Float32Array;
}

export interface ParsedMatMul {
  readonly name: string;
  readonly inChannels: number;
  readonly outChannels: number;
  readonly weights: Float32Array;
}

export interface ParsedMatBias {
  readonly name: string;
  readonly channels: number;
  readonly weights: Float32Array;
}

export type ParsedTrunkBlock =
  | { kind: 'ordinary'; preBN: ParsedBatchNorm; preActivation: ActivationKind; w1: ParsedConv2d; midBN: ParsedBatchNorm; midActivation: ActivationKind; w2: ParsedConv2d }
  | { kind: 'gpool'; preBN: ParsedBatchNorm; preActivation: ActivationKind; w1a: ParsedConv2d; w1b: ParsedConv2d; gpoolBN: ParsedBatchNorm; gpoolActivation: ActivationKind; w1r: ParsedMatMul; midBN: ParsedBatchNorm; midActivation: ActivationKind; w2: ParsedConv2d }
  | { kind: 'nested_bottleneck'; numBlocks: number; preBN: ParsedBatchNorm; preActivation: ActivationKind; preConv: ParsedConv2d; blocks: ParsedTrunkBlock[]; postBN: ParsedBatchNorm; postActivation: ActivationKind; postConv: ParsedConv2d };

export interface ParsedModel {
  modelName: string;
  modelVersion: number;
  numInputChannels: number;
  numInputGlobalChannels: number;
  metaEncoderVersion: number;
  metaEncoder?: {
    numInputMetaChannels: number;
    mul1: ParsedMatMul;
    bias1: ParsedMatBias;
    act1: ActivationKind;
    mul2: ParsedMatMul;
    bias2: ParsedMatBias;
    act2: ActivationKind;
    mul3: ParsedMatMul;
  };
  postProcessParams: {
    tdScoreMultiplier: number;
    scoreMeanMultiplier: number;
    scoreStdevMultiplier: number;
    leadMultiplier: number;
    varianceTimeMultiplier: number;
    shorttermValueErrorMultiplier: number;
    shorttermScoreErrorMultiplier: number;
    outputScaleMultiplier: number;
  };
  policyOutChannels: number;
  scoreValueChannels: number;
  trunk: {
    numBlocks: number;
    trunkNumChannels: number;
    midNumChannels: number;
    regularNumChannels: number;
    gpoolNumChannels: number;
    conv1: ParsedConv2d;
    ginput: ParsedMatMul;
    blocks: ParsedTrunkBlock[];
    tipBN: ParsedBatchNorm;
    tipActivation: ActivationKind;
  };
  policy: {
    p1: ParsedConv2d;
    g1: ParsedConv2d;
    g1BN: ParsedBatchNorm;
    g1Activation: ActivationKind;
    gpoolToBias: ParsedMatMul;
    p1BN: ParsedBatchNorm;
    p1Activation: ActivationKind;
    p2: ParsedConv2d;
    passMul: ParsedMatMul;
    passBias?: ParsedMatBias;
    passActivation?: ActivationKind;
    passMul2?: ParsedMatMul;
  };
  value: {
    v1: ParsedConv2d;
    v1BN: ParsedBatchNorm;
    v1Activation: ActivationKind;
    v2: ParsedMatMul;
    v2Bias: ParsedMatBias;
    v2Activation: ActivationKind;
    v3: ParsedMatMul;
    v3Bias: ParsedMatBias;
    sv3: ParsedMatMul;
    sv3Bias: ParsedMatBias;
    ownership: ParsedConv2d;
  };
  toBinary(): Uint8Array;
}

const isSpace = (value: number | undefined): boolean => value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;
const BIN = new Uint8Array([0x40, 0x42, 0x49, 0x4e, 0x40]);

class Reader {
  private offset = 0;
  private readonly decoder = new TextDecoder();
  private readonly output: Uint8Array[] = [];
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  private skipSpace(): void {
    while (isSpace(this.bytes[this.offset])) this.offset += 1;
  }

  private token(record: boolean): string {
    this.skipSpace();
    const start = this.offset;
    while (this.offset < this.bytes.length && !isSpace(this.bytes[this.offset])) this.offset += 1;
    if (start === this.offset) throw new Error('Unexpected EOF while reading token');
    const value = this.decoder.decode(this.bytes.subarray(start, this.offset));
    if (record) this.output.push(new TextEncoder().encode(`${value}\n`));
    return value;
  }

  readToken(): string {
    return this.token(true);
  }

  readInt(): number {
    const token = this.readToken();
    const value = Number.parseInt(token, 10);
    if (!Number.isFinite(value)) throw new Error(`Invalid integer token: ${token}`);
    return value;
  }

  readFloat(): number {
    const token = this.readToken();
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) throw new Error(`Invalid float token: ${token}`);
    return value;
  }

  readFloats(count: number): Float32Array {
    this.skipSpace();
    const binary = this.bytes.subarray(this.offset, this.offset + 5).every((byte, index) => byte === BIN[index]);
    const values = new Float32Array(count);
    let raw: Uint8Array;
    if (binary) {
      this.offset += 5;
      const size = count * 4;
      if (this.offset + size > this.bytes.length) throw new Error('Unexpected EOF while reading binary weights');
      raw = this.bytes.slice(this.offset, this.offset + size);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let index = 0; index < count; index += 1) values[index] = view.getFloat32(index * 4, true);
      this.offset += size;
    } else {
      for (let index = 0; index < count; index += 1) {
        const token = this.token(false);
        const value = Number.parseFloat(token);
        if (!Number.isFinite(value)) throw new Error(`Invalid weight token: ${token}`);
        values[index] = value;
      }
      raw = new Uint8Array(count * 4);
      const view = new DataView(raw.buffer);
      for (let index = 0; index < count; index += 1) view.setFloat32(index * 4, values[index]!, true);
    }
    this.output.push(BIN, raw, new Uint8Array([0x0a]));
    this.skipSpace();
    return values;
  }

  toBinary(): Uint8Array {
    const result = new Uint8Array(this.output.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of this.output) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
}

function parseBatchNorm(reader: Reader): ParsedBatchNorm {
  reader.readToken();
  const channels = reader.readInt();
  const epsilon = reader.readFloat();
  const hasScale = reader.readInt() !== 0;
  const hasBias = reader.readInt() !== 0;
  const mean = reader.readFloats(channels);
  const variance = reader.readFloats(channels);
  const scale = hasScale ? reader.readFloats(channels) : new Float32Array(channels).fill(1);
  const bias = hasBias ? reader.readFloats(channels) : new Float32Array(channels).fill(0);
  const mergedScale = new Float32Array(channels);
  const mergedBias = new Float32Array(channels);
  for (let i = 0; i < channels; i += 1) {
    mergedScale[i] = scale[i]! / Math.sqrt(variance[i]! + epsilon);
    mergedBias[i] = bias[i]! - mergedScale[i]! * mean[i]!;
  }
  return { channels, mergedScale, mergedBias };
}

function parseActivation(reader: Reader, version: number): ActivationKind {
  reader.readToken();
  if (version < 11) return 'relu';
  const kind = reader.readToken();
  if (kind === 'ACTIVATION_IDENTITY') return 'identity';
  if (kind === 'ACTIVATION_RELU') return 'relu';
  if (kind === 'ACTIVATION_MISH') return 'mish';
  throw new Error(`Unsupported activation: ${kind}`);
}

function parseConv(reader: Reader): ParsedConv2d {
  const name = reader.readToken();
  const kernelY = reader.readInt();
  const kernelX = reader.readInt();
  const inChannels = reader.readInt();
  const outChannels = reader.readInt();
  const dilationY = reader.readInt();
  const dilationX = reader.readInt();
  return { name, kernelY, kernelX, inChannels, outChannels, dilationY, dilationX, weights: reader.readFloats(kernelY * kernelX * inChannels * outChannels) };
}

function parseMatMul(reader: Reader): ParsedMatMul {
  const name = reader.readToken();
  const inChannels = reader.readInt();
  const outChannels = reader.readInt();
  return { name, inChannels, outChannels, weights: reader.readFloats(inChannels * outChannels) };
}

function parseMatBias(reader: Reader): ParsedMatBias {
  const name = reader.readToken();
  const channels = reader.readInt();
  return { name, channels, weights: reader.readFloats(channels) };
}

function parseModel(reader: Reader): Omit<ParsedModel, 'toBinary'> {
  const modelName = reader.readToken();
  const modelVersion = reader.readInt();
  if (modelVersion < 8 || modelVersion > 14) throw new Error(`Unsupported model version ${modelVersion}`);
  const numInputChannels = reader.readInt();
  const numInputGlobalChannels = reader.readInt();
  const postProcessParams = modelVersion >= 13
    ? {
        tdScoreMultiplier: reader.readFloat(),
        scoreMeanMultiplier: reader.readFloat(),
        scoreStdevMultiplier: reader.readFloat(),
        leadMultiplier: reader.readFloat(),
        varianceTimeMultiplier: reader.readFloat(),
        shorttermValueErrorMultiplier: reader.readFloat(),
        shorttermScoreErrorMultiplier: reader.readFloat(),
        outputScaleMultiplier: 1,
      }
    : {
        tdScoreMultiplier: 20,
        scoreMeanMultiplier: 20,
        scoreStdevMultiplier: 20,
        leadMultiplier: 20,
        varianceTimeMultiplier: 40,
        shorttermValueErrorMultiplier: 0.25,
        shorttermScoreErrorMultiplier: 30,
        outputScaleMultiplier: 1,
      };

  reader.readToken();
  const numBlocks = reader.readInt();
  const trunkNumChannels = reader.readInt();
  const midNumChannels = reader.readInt();
  const regularNumChannels = reader.readInt();
  reader.readInt();
  const gpoolNumChannels = reader.readInt();
  const conv1 = parseConv(reader);
  const ginput = parseMatMul(reader);

  const parseBlock = (): ParsedTrunkBlock => {
    const kind = reader.readToken();
    reader.readToken();
    if (kind === 'ordinary_block') {
      const preBN = parseBatchNorm(reader);
      const preActivation = parseActivation(reader, modelVersion);
      const w1 = parseConv(reader);
      const midBN = parseBatchNorm(reader);
      const midActivation = parseActivation(reader, modelVersion);
      return { kind: 'ordinary', preBN, preActivation, w1, midBN, midActivation, w2: parseConv(reader) };
    }
    if (kind === 'gpool_block') {
      const preBN = parseBatchNorm(reader);
      const preActivation = parseActivation(reader, modelVersion);
      const w1a = parseConv(reader);
      const w1b = parseConv(reader);
      const gpoolBN = parseBatchNorm(reader);
      const gpoolActivation = parseActivation(reader, modelVersion);
      const w1r = parseMatMul(reader);
      const midBN = parseBatchNorm(reader);
      const midActivation = parseActivation(reader, modelVersion);
      const w2 = parseConv(reader);
      return { kind: 'gpool', preBN, preActivation, w1a, w1b, gpoolBN, gpoolActivation, w1r, midBN, midActivation, w2 };
    }
    if (kind === 'nested_bottleneck_block') {
      const numInnerBlocks = reader.readInt();
      const preBN = parseBatchNorm(reader);
      const preActivation = parseActivation(reader, modelVersion);
      const preConv = parseConv(reader);
      const blocks = Array.from({ length: numInnerBlocks }, parseBlock);
      const postBN = parseBatchNorm(reader);
      const postActivation = parseActivation(reader, modelVersion);
      const postConv = parseConv(reader);
      return { kind: 'nested_bottleneck', numBlocks: numInnerBlocks, preBN, preActivation, preConv, blocks, postBN, postActivation, postConv };
    }
    throw new Error(`Unsupported trunk block kind ${kind}`);
  };

  const blocks = Array.from({ length: numBlocks }, parseBlock);
  const tipBN = parseBatchNorm(reader);
  const tipActivation = parseActivation(reader, modelVersion);
  reader.readToken();
  const p1 = parseConv(reader);
  const g1 = parseConv(reader);
  const g1BN = parseBatchNorm(reader);
  const g1Activation = parseActivation(reader, modelVersion);
  const gpoolToBias = parseMatMul(reader);
  const p1BN = parseBatchNorm(reader);
  const p1Activation = parseActivation(reader, modelVersion);
  const p2 = parseConv(reader);
  const passMul = parseMatMul(reader);
  reader.readToken();
  const v1 = parseConv(reader);
  const v1BN = parseBatchNorm(reader);
  const v1Activation = parseActivation(reader, modelVersion);
  const v2 = parseMatMul(reader);
  const v2Bias = parseMatBias(reader);
  const v2Activation = parseActivation(reader, modelVersion);
  const v3 = parseMatMul(reader);
  const v3Bias = parseMatBias(reader);
  const sv3 = parseMatMul(reader);
  const sv3Bias = parseMatBias(reader);
  const ownership = parseConv(reader);
  return {
    modelName, modelVersion, numInputChannels, numInputGlobalChannels, metaEncoderVersion: 0, postProcessParams,
    policyOutChannels: p2.outChannels, scoreValueChannels: sv3.outChannels,
    trunk: { numBlocks, trunkNumChannels, midNumChannels, regularNumChannels, gpoolNumChannels, conv1, ginput, blocks, tipBN, tipActivation },
    policy: { p1, g1, g1BN, g1Activation, gpoolToBias, p1BN, p1Activation, p2, passMul },
    value: { v1, v1BN, v1Activation, v2, v2Bias, v2Activation, v3, v3Bias, sv3, sv3Bias, ownership },
  };
}

export function parseKataGoModel(bytes: Uint8Array): ParsedModel {
  const reader = new Reader(bytes);
  const parsed = parseModel(reader);
  return { ...parsed, toBinary: () => reader.toBinary() };
}

export async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
