/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the hexapod's thirteen part programs through
 *                     |                             | CAD Studio's REAL kernel (OCCT), the way ocean-lab proves the
 *                     |                             | explorer's. The contract suite proves each program is well
 *                     |                             | formed; only OCCT proves it builds. CAD Studio's own engine image
 *                     |                             | runs once, isolated (no network, capped memory, removed on
 *                     |                             | exit), fed the COMPILED emitter's programs, and every part must
 *                     |                             | come back with every feature accepted, a valid solid seated on
 *                     |                             | z = 0 and a watertight exported STL. The kernel's volume is
 *                     |                             | printed beside the design's net-volume estimate for the report.
 *                     |                             | The image is a prerequisite: its absence FAILS, never skips.
 *                     |                             | Run: node --test tests/hexapod-parts-occt.spec.mjs
 *                     |                             | (image override: OSHAL_CAD_ENGINE_IMAGE).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const IMAGE = process.env.OSHAL_CAD_ENGINE_IMAGE || 'oshal-cad-studio-engine:local';
const require = createRequire(import.meta.url);
const { buildHexapod } = require(path.join(PKG, 'routes', 'engine', 'design', 'hexapod-design.js'));
const PETG_G_CM3 = 1.27;

/** @description A binary or ASCII STL as welded vertices and triangles. */
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
  const index = new Map(); let count = 0;
  const id = (p) => { const key = p.join(','); if (!index.has(key)) { index.set(key, count); count += 1; } return index.get(key); };
  return { vertexCount: count, triangles: facets.map((f) => f.map(id)) };
}

/** @description Watertight: every edge shared by exactly two triangles, no degenerate triangle. */
function meshCheck(mesh) {
  const edges = new Map(); let degenerate = 0;
  for (const [a, b, c] of mesh.triangles) {
    if (a === b || b === c || a === c) { degenerate += 1; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? `${u}-${v}` : `${v}-${u}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  let open = 0; let nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) open += 1; else if (n > 2) nonManifold += 1; }
  return { open, nonManifold, degenerate, watertight: open === 0 && nonManifold === 0 && degenerate === 0, triangles: mesh.triangles.length };
}

test('every spider-18 part program builds through CAD Studio\'s OCCT kernel into a valid, seated, watertight solid', { timeout: 600000 }, () => {
  const inspect = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, `prerequisite missing: the CAD Studio engine image ${IMAGE} (build it with cad-studio/engine/install-engine.sh, or set OSHAL_CAD_ENGINE_IMAGE) and a running Docker`);
  const d = buildHexapod('spider-18');
  const input = d.printed.map((p) => JSON.stringify({ id: p.id, cmd: 'rebuild', args: { base: p.cad.base, features: p.cad.features, exports: ['stl'], densityGcm3: PETG_G_CM3, stlToleranceMm: 0.05 } })).join('\n') + '\n';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '1g', '--entrypoint', 'python', IMAGE, '/opt/cad-studio/engine/cad_worker.py'], { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 540000 });
  assert.equal(run.status, 0, `the engine container failed: ${run.stderr || run.error}`);
  const answers = new Map(run.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const a = JSON.parse(line); return [a.id, a]; }));
  assert.equal(d.printed.length, 13);
  const report = [];
  for (const p of d.printed) {
    const a = answers.get(p.id);
    assert.ok(a && a.ok, `${p.id}: the worker refused the program: ${JSON.stringify(a && a.error)}`);
    const r = a.result;
    assert.deepEqual(r.features.filter((s) => !s.ok).map((s) => ({ id: s.id, error: s.error })), [], `${p.id}: every feature accepted`);
    assert.equal(r.report.valid, true, `${p.id}: a valid solid`);
    const e = r.report.extentsMm;
    assert.ok(Math.abs(e.min[2]) < 0.01, `${p.id}: seated on z = 0 (min z ${e.min[2]})`);
    const mesh = meshCheck(parseStl(Buffer.from(r.exports.stl, 'base64')));
    assert.ok(mesh.watertight, `${p.id}: exported STL ${JSON.stringify(mesh)}`);
    const sizes = e.max.map((v, i) => Math.round((v - e.min[i]) * 10) / 10);
    report.push(`${p.id.padEnd(15)} volume ${(r.report.volumeMm3 / 1000).toFixed(1).padStart(7)} cm³  solid mass ${r.report.massG.toFixed(0).padStart(4)} g at ${PETG_G_CM3}  design estimate ${String(p.massEachG).padStart(3)} g  extents ${sizes.join(' × ')} mm  ${mesh.triangles} triangles  faces ${r.report.faces}`);
  }
  console.log(report.join('\n'));
});
