import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { parseKataGoModel } from '../src/os/games/katago/model.ts';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/katago-txt-to-bin.ts in.txt.gz out.bin.gz');
const compressed = await readFile(inputPath);
const source = new Uint8Array(compressed[0] === 0x1f && compressed[1] === 0x8b ? gunzipSync(compressed) : compressed);
const binary = parseKataGoModel(source).toBinary();
await writeFile(outputPath, gzipSync(binary, { level: 9 }));
