import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const assets = ['female.glb', 'male.glb'];
const requiredNodes = ['hand_l', 'hand_r', 'head', 'pelvis'];
const requiredMaterials = ['shirt', 'shorts', 'skin'];

test('Tennis player GLBs contain the expected rig and plain-glTF assets', () => {
  for (const asset of assets) {
    const path = join(process.cwd(), 'public/models/tennis', asset);
    const buffer = readFileSync(path);
    assert.ok(statSync(path).size <= 1_800_000, `${asset} exceeds the 1.8 MB budget`);
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF', `${asset} has no GLB header`);
    assert.equal(buffer.readUInt32LE(4), 2, `${asset} is not glTF 2`);
    assert.equal(buffer.readUInt32LE(8), buffer.length, `${asset} header length is incorrect`);

    const jsonLength = buffer.readUInt32LE(12);
    const jsonType = buffer.readUInt32LE(16);
    assert.equal(jsonType, 0x4e4f534a, `${asset} does not start with a JSON chunk`);
    const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength)) as {
      extensionsUsed?: string[];
      skins?: unknown[];
      nodes?: Array<{ name?: string }>;
      materials?: Array<{ name?: string }>;
    };

    assert.ok(gltf.skins?.length, `${asset} has no skins`);
    const nodes = new Set(gltf.nodes?.map((node) => node.name));
    for (const name of requiredNodes) assert.ok(nodes.has(name), `${asset} is missing node ${name}`);
    const materials = new Set(gltf.materials?.map((material) => material.name));
    for (const name of requiredMaterials) assert.ok(materials.has(name), `${asset} is missing material ${name}`);
    assert.ok(!gltf.extensionsUsed?.includes('KHR_draco_mesh_compression'), `${asset} uses Draco compression`);
    assert.ok(!gltf.extensionsUsed?.includes('EXT_meshopt_compression'), `${asset} uses meshopt compression`);
  }
});
