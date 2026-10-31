/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: ONE small part program through CAD Studio's real engine image (oshal-cad-studio-engine:local, run the way the spider's print set ran it - docker run, no network, removed on exit) and then through this package's real compiled routes over loopback: the engine's STL is kept watertight with the sha256 of the engine's own bytes, the kernel's mass, volume and extents from the engine's report, the served file is byte-equal, and the sheet carries the part's fields. The image is a prerequisite declared in tests/test-lab.yaml; when docker or the image is absent on the box the case SKIPS LOUDLY with the exact reason (the hexapod suites fail instead; this one is a guard on the package's path, not on the image).
 *
 * FRAMEWORK-COUPLED: OSHAL_CORE_ROOT=$HOME/Documents/projects/oshal/src node --test tests/print-set.engine.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const IMAGE = process.env.OSHAL_CAD_ENGINE_IMAGE || 'oshal-cad-studio-engine:local';
/** A small generic part: a 16 mm cap with a 6.4 mm bore, in CAD Studio's own feature contract (no product's numbers). */
const PART = { id: 'cap', name: 'Pegged cap', qty: 2, material: 'TPU 95A', printNotes: 'bore up, 100 % infill', orientation: 'bore up', layerHeightMm: 0.2, supports: false, massEachG: 4, program: true };
const PROGRAM = { base: { kind: 'cylinder', diameter: 16, height: 16 }, features: [{ id: 'bore', type: 'hole', params: { diameter: 6.4, axis: 'z', x: 0, y: 0, z: 0, depth: 8 }, label: 'the peg bore' }] };
const DENSITY = 1.2;
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The exact reason the engine cannot run here, or null when it can. */
function enginePrerequisite() {
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (docker.error || docker.status !== 0) return `prerequisite missing: docker is not running on this box (${(docker.stderr || String(docker.error || '')).trim() || 'docker version failed'})`;
  const image = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' });
  if (image.status !== 0) return `prerequisite missing: the CAD Studio engine image ${IMAGE} is not on this box (build it with cad-studio/engine/install-engine.sh, or set OSHAL_CAD_ENGINE_IMAGE)`;
  return null;
}

/** Run one program through the engine worker and return its answer line. */
function buildOnEngine(program) {
  const input = JSON.stringify({ id: PART.id, cmd: 'rebuild', args: { base: program.base, features: program.features, exports: ['stl'], densityGcm3: DENSITY, stlToleranceMm: 0.05 } }) + '\n';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '1g', '--entrypoint', 'python', IMAGE, '/opt/cad-studio/engine/cad_worker.py'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  assert.equal(run.status, 0, `the engine container failed: ${run.stderr || run.error}`);
  const lines = run.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `one answer line expected, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

test('one small part through the real CAD Studio engine, then through the package\'s real routes: kept watertight with the engine\'s own sha256, mass, volume and extents', { timeout: 300000 }, async (t) => {
  const reason = enginePrerequisite();
  if (reason) { t.diagnostic(reason); t.skip(reason); return; }
  const answer = buildOnEngine(PROGRAM);
  assert.equal(answer.ok, true, `the worker refused the program: ${JSON.stringify(answer.error)}`);
  const r = answer.result;
  assert.ok(r.features.every((f) => f.ok), `every feature accepted: ${JSON.stringify(r.features)}`);
  assert.equal(r.report.valid, true, 'the kernel calls the solid valid');
  const stl = Buffer.from(r.exports.stl, 'base64');
  assert.ok(stl.length > 84 && stl.readUInt32LE(80) > 0, 'a binary STL came back');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-studio-engine-'));
  process.env.DESIGN_STUDIO_DATA_DIR = root;
  const H = require('./routes.harness.js');
  const { express, createDesignStudioRoutes, restore } = H.loadRoutes();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(H.session('roger-engine'));
  app.use('/api/design-studio', createDesignStudioRoutes({ pool: H.fakePool(), appPackageDir: H.PKG }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api/design-studio`;
  const call = async (method, p, body) => { const res = await fetch(origin + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
  try {
    const project = (await call('POST', '/projects', { name: 'engine cap', brief: { what: 'a pegged cap', requirements: ['caps a 6.4 mm peg'] } })).json.project;
    const begun = await call('POST', `/projects/${project.id}/print-set`, { engine: 'embodied', designRevision: 'engine-spec', designRoute: 'this spec\'s one program', parts: [PART], bought: [] });
    assert.equal(begun.status, 201);
    const fd = new FormData();
    fd.append('stl', new Blob([stl], { type: 'model/stl' }), 'cap.stl');
    fd.append('meta', JSON.stringify({ source: { engine: 'cad-studio', modelId: '11111111-2222-4333-8444-555555555555', revision: 1, route: `docker run ${IMAGE} cad_worker.py rebuild`, title: PART.name }, report: { valid: r.report.valid, massG: r.report.massG, volumeMm3: r.report.volumeMm3, extentsMm: r.report.extentsMm, densityGcm3: r.report.densityGcm3 } }));
    const put = await fetch(`${origin}/projects/${project.id}/print-set/parts/cap`, { method: 'PUT', body: fd });
    const part = (await put.json()).part;
    assert.equal(put.status, 200); assert.equal(part.status, 'exported', JSON.stringify(part));
    assert.equal(part.sha256, sha(stl), 'the sha256 is of the engine\'s own bytes'); assert.equal(part.triangles, stl.readUInt32LE(80));
    assert.equal(part.kernelMassEachG, Math.round(r.report.massG * 100) / 100); assert.equal(part.volumeCm3, Math.round(r.report.volumeMm3 / 10) / 100); assert.equal(part.densityGcm3, DENSITY);
    assert.ok(part.extentsMm.every((v) => v > 0) && Math.abs(part.extentsMm[2] - 16) < 0.2, `extents from the kernel's bounding box: ${part.extentsMm}`);
    assert.ok(Math.abs(r.report.volumeMm3 - (Math.PI * 64 * 16 - Math.PI * 3.2 * 3.2 * 8)) < 50, `the kernel's volume is a 16 mm cylinder less an 8 mm deep 6.4 mm bore: ${r.report.volumeMm3}`);
    const done = await call('POST', `/projects/${project.id}/print-set/finish`);
    assert.equal(done.status, 200); assert.equal(done.json.exported, 1); assert.deepEqual(done.json.unprintable, []); assert.match(done.json.manifestSha256, /^[0-9a-f]{64}$/);
    const served = await fetch(`${origin}/projects/${project.id}/print-set/cap.stl`);
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(stl), 'the served file is the engine\'s bytes');
    const sheet = await (await fetch(`${origin}/projects/${project.id}/print-set/PRINT-SHEET.md`)).text();
    assert.ok(sheet.includes(`| \`cap.stl\` | 2 | TPU 95A | bore up | 0.2 mm | no | ${part.extentsMm.join(' × ')} | ${Math.round(part.kernelMassEachG)} g at ${DENSITY} g/cm³ (design 4 g) | bore up, 100 % infill |`), sheet);
    t.diagnostic(`engine ${IMAGE}: ${part.triangles} triangles, ${part.kernelMassEachG} g at ${DENSITY} g/cm³, ${part.extentsMm.join(' x ')} mm, manifest ${done.json.manifestSha256.slice(0, 12)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve)); restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
