/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the explorer's six part programs through CAD Studio's REAL
 *                     |                             | kernel. The contract suites prove each program is well formed; only OCCT
 *                     |                             | proves it builds. This starts CAD Studio's own engine image once, isolated
 *                     |                             | (no network, capped memory, removed on exit), feeds its worker the
 *                     |                             | programs the COMPILED emitter produces at the seed, and requires for every
 *                     |                             | part: every feature accepted, a valid solid seated in CAD Studio's frame,
 *                     |                             | the volume (a hull, the tether) or the mass (a foil) within 0.5 % of the
 *                     |                             | lab's own integration, and an exported STL that ocean-lab's own mesh
 *                     |                             | validator passes (closed, manifold, no degenerate facet, Euler 2). The image
 *                     |                             | is a prerequisite and its absence FAILS the suite by name, never a skip.
 *                     |                             | Run: node --test tests/explorer-parts-occt.spec.mjs
 *                     |                             | (image override: OSHAL_CAD_ENGINE_IMAGE).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const IMAGE = process.env.OSHAL_CAD_ENGINE_IMAGE || 'oshal-cad-studio-engine:local';
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const vehicle = require(path.join(PKG, 'routes', 'engine', 'vehicle', 'index.js'));
const geometry = require(path.join(PKG, 'routes', 'engine', 'geometry', 'index.js'));

/** @description A binary or ASCII STL as a welded TriMesh for ocean-lab's validator. */
function parseStl(buf) {
  const facets = [];
  if (buf.subarray(0, 5).toString() === 'solid' && buf.toString('latin1').includes('facet')) {
    const v = [...buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    for (let i = 0; i < v.length; i += 3) facets.push([v[i], v[i + 1], v[i + 2]]);
  } else {
    for (let i = 0; i < buf.readUInt32LE(80); i += 1) {
      const o = 84 + i * 50 + 12;
      facets.push([0, 1, 2].map((k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)]));
    }
  }
  const index = new Map(); const vertices = [];
  const id = (p) => { const key = p.join(','); if (!index.has(key)) { index.set(key, vertices.length); vertices.push({ x: p[0], y: p[1], z: p[2] }); } return index.get(key); };
  return { vertices, triangles: facets.map((f) => f.map(id)) };
}

test('every explorer part program builds through CAD Studio\'s OCCT kernel into a valid, seated, watertight solid', { timeout: 600000 }, () => {
  const inspect = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, `prerequisite missing: the CAD Studio engine image ${IMAGE} (build it with cad-studio/engine/install-engine.sh, or set OSHAL_CAD_ENGINE_IMAGE) and a running Docker`);
  const parts = vehicle.buildExplorerParts(vehicle.explorerSeed().designVector);
  const bodies = [...parts.printed, ...parts.bought.filter((b) => b.geometry)];
  const input = bodies.map((p) => JSON.stringify({ id: p.id, cmd: 'rebuild', args: { base: p.geometry.program.base, features: p.geometry.program.features, exports: ['stl'], densityGcm3: 1.27, stlToleranceMm: 0.05 } })).join('\n') + '\n';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '768m', '--entrypoint', 'python', IMAGE, '/opt/cad-studio/engine/cad_worker.py'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 540000 });
  assert.equal(run.status, 0, `the engine container failed: ${run.stderr || run.error}`);
  const answers = new Map(run.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const a = JSON.parse(line); return [a.id, a]; }));
  assert.equal(bodies.length, 6);
  for (const p of bodies) {
    const a = answers.get(p.id);
    assert.ok(a && a.ok, `${p.id}: the worker refused the program: ${JSON.stringify(a && a.error)}`);
    const r = a.result;
    assert.deepEqual(r.features.filter((s) => !s.ok), [], `${p.id}: every feature accepted`);
    assert.equal(r.report.valid, true, `${p.id}: a valid solid`);
    const e = r.report.extentsMm;
    assert.ok(Math.abs(e.min[0] + e.max[0]) < 0.01 && Math.abs(e.min[1] + e.max[1]) < 0.01 && Math.abs(e.min[2]) < 0.01, `${p.id}: seated in CAD Studio's frame`);
    const want = p.make !== 'printed' || p.id === 'float' || p.id === 'sub-body' ? ['volumeMm3', p.displacedTotalMm3 / p.qty] : ['massG', p.massEachKg * 1000];
    assert.ok(Math.abs(r.report[want[0]] - want[1]) <= 0.005 * want[1], `${p.id}: OCCT ${want[0]} ${r.report[want[0]]} against the lab's ${want[1]}`);
    const mesh = geometry.validateMesh(parseStl(Buffer.from(r.exports.stl, 'base64')));
    assert.ok(mesh.valid && mesh.watertight && mesh.eulerCharacteristic === 2, `${p.id}: exported STL ${JSON.stringify({ openEdges: mesh.openEdges, nonManifold: mesh.nonManifoldEdges, degenerate: mesh.degenerate, euler: mesh.eulerCharacteristic })}`);
  }
});
