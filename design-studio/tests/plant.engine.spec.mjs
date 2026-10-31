/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the lift END TO END against the REAL engines on this box. The three part programs go through CAD Studio's real kernel image (docker run, no network, the spider's way) so the masses and extents are the kernel's; embodied's REAL compiled routes are mounted over loopback (its route harness) and dial a container started from the embodied engine image (OSHAL_EMBODIED_ENGINE_IMAGE, default oshal-embodied-engine:local; port published on 127.0.0.1 only; removed on exit), whose build hash must equal this tree's; this package's real routes serve the page, which is driven in Chromium: Create the parts (the fixture's CAD Studio model routes answer with the kernel's own reports), Define the mechanism, Build the plant, Run the baselines, Train the policy (PLANT_PROOF_TIMESTEPS PPO steps, default 20000, about 90 s on the box's CPU), Certify, Close the phase, GET /body. Every number asserted is the engine's; the policy's verdict is reported, never asserted. When docker or an image is absent the case skips loudly with the exact reason. The results land in PLANT_PROOF_OUT (JSON) and screenshots in DESIGN_STUDIO_SHOTS when the folder exists.
 *
 * FRAMEWORK-COUPLED: OSHAL_CORE_ROOT=$HOME/Documents/projects/oshal/src node --test tests/plant.engine.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CAD_IMAGE = process.env.OSHAL_CAD_ENGINE_IMAGE || 'oshal-cad-studio-engine:local';
const EMB_IMAGE = process.env.OSHAL_EMBODIED_ENGINE_IMAGE || 'oshal-embodied-engine:local';
const TIMESTEPS = Number(process.env.PLANT_PROOF_TIMESTEPS || 20000);
const SHOTS = process.env.DESIGN_STUDIO_SHOTS || '';
const OUT = process.env.PLANT_PROOF_OUT || '';
const DENSITY = 1.24;
const shoot = async (page, name) => { if (SHOTS && fs.existsSync(SHOTS)) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

/** The exact reason the engines cannot run here, or null. */
function prerequisite() {
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (docker.error || docker.status !== 0) return `prerequisite missing: docker is not running on this box (${(docker.stderr || String(docker.error || '')).trim() || 'docker version failed'})`;
  for (const [image, hint] of [[CAD_IMAGE, 'cad-studio/engine/install-engine.sh, or OSHAL_CAD_ENGINE_IMAGE'], [EMB_IMAGE, 'embodied/engine/install-engine.sh, or OSHAL_EMBODIED_ENGINE_IMAGE']]) {
    if (spawnSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).status !== 0) return `prerequisite missing: the engine image ${image} is not on this box (build it with ${hint})`;
  }
  return null;
}
/** One program through the CAD kernel's worker: the report and the STL. */
function buildOnCad(id, program) {
  const input = JSON.stringify({ id, cmd: 'rebuild', args: { base: program.base, features: program.features, exports: ['stl'], densityGcm3: DENSITY, stlToleranceMm: 0.05 } }) + '\n';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '1g', '--entrypoint', 'python', CAD_IMAGE, '/opt/cad-studio/engine/cad_worker.py'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  assert.equal(run.status, 0, `the CAD engine container failed: ${run.stderr || run.error}`);
  const answer = JSON.parse(run.stdout.split(/\r?\n/).filter(Boolean)[0]);
  assert.equal(answer.ok, true, `the worker refused ${id}: ${JSON.stringify(answer.error)}`);
  assert.ok(answer.result.features.every((f) => f.ok) && answer.result.report.valid, `${id}: every feature accepted and the solid valid`);
  return { report: answer.result.report, stl: Buffer.from(answer.result.exports.stl, 'base64') };
}
/** Start the embodied engine container on a loopback port; returns {port, name, stop}. */
function startEngine() {
  const name = `design-studio-plant-proof-${process.pid}`;
  const run = spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1:0:7413', '--tmpfs', '/tmp:size=1g', EMB_IMAGE], { encoding: 'utf8' });
  assert.equal(run.status, 0, `the embodied engine container did not start: ${run.stderr}`);
  const port = Number(spawnSync('docker', ['port', name, '7413/tcp'], { encoding: 'utf8' }).stdout.trim().split(':').pop());
  return { name, port, stop: () => { spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' }); } };
}
/** Wait until the bridge answers its hello on the port (it imports MuJoCo and torch first): up to 90 s. */
async function awaitHello(port) {
  const net = await import('node:net');
  const deadline = Date.now() + 90000;
  for (;;) {
    const hello = await new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {});
      let text = '';
      sock.setTimeout(3000, () => { sock.destroy(); resolve(null); });
      sock.on('data', (d) => { text += d.toString('utf8'); if (text.includes('\n')) { sock.destroy(); resolve(text.split('\n')[0]); } });
      sock.on('error', () => resolve(null)); sock.on('close', () => resolve(text.includes('\n') ? text.split('\n')[0] : null));
    });
    if (hello) return JSON.parse(hello);
    assert.ok(Date.now() < deadline, 'the engine container did not answer its hello within 90 s');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test('the lift end to end on the real engines: the kernel\'s parts, the plant built from the mechanism, the PD baseline, a short PPO run, the gate, the certificate, the body contract', { timeout: 1800000 }, async (t) => {
  const reason = prerequisite();
  if (reason) { t.diagnostic(reason); t.skip(reason); return; }
  const H = require('./routes.harness.js');
  const EH = require('../../embodied/tests/routes.harness.js');
  const { LIFT_1_EXAMPLE } = require(path.join(H.PKG, 'routes', 'examples.js'));
  const { engineBuildHash } = require(path.join(EH.PKG, 'routes', 'engine', 'physics', 'build-hash.js'));
  // 1. The three parts through the real CAD kernel: the masses and extents the plant is built from.
  const kernel = {};
  for (const p of LIFT_1_EXAMPLE.bindings.design.parts) kernel[p.id] = buildOnCad(p.id, p.program);
  const results = { cad: Object.fromEntries(Object.entries(kernel).map(([id, k]) => [id, { massG: k.report.massG, extentsMm: k.report.extentsMm.size, volumeMm3: k.report.volumeMm3, triangles: k.stl.readUInt32LE(80) }])) };
  // 2. The real embodied routes over loopback, dialling a container from the engine image; this package's real routes; CAD Studio's model routes doubled with the kernel's own reports.
  const engine = startEngine();
  const hello = await awaitHello(engine.port);
  assert.equal(hello.buildHash, engineBuildHash(path.join(EH.PKG, 'engine')), `the container ${EMB_IMAGE} was built from another engine tree (${String(hello.buildHash).slice(0, 12)}): rebuild it`);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-studio-plant-proof-'));
  process.env.DESIGN_STUDIO_DATA_DIR = dataRoot;
  const ds = H.loadRoutes();
  const emb = EH.loadRoutes();
  const { launchIsolatedBrowser } = await import('./design-studio.fixture.mjs');
  let owned; let server; let page; let context;
  try {
    const express = ds.express;
    const app = express();
    const sub = 'roger-proof';
    app.use('/shared/ui', express.static(sharedUi()));
    app.use('/cockpit/css/themes', express.static(themes()));
    app.use(express.json({ limit: '4mb' }));
    app.use((req, _res, next) => { req.oidc = { user: { sub }, isAuthenticated: () => true }; next(); });
    app.use('/api/design-studio', ds.createDesignStudioRoutes({ pool: H.fakePool(), appPackageDir: H.PKG }));
    app.use('/api/embodied', emb.createEmbodiedRoutes({ pool: EH.fakePool(), appPackageDir: EH.PKG }, { engineAddr: `127.0.0.1:${engine.port}`, noTimer: true }));
    const models = [];
    app.get('/api/cad-studio/models', (_req, res) => res.json({ models }));
    app.post('/api/cad-studio/models', (req, res) => {
      const part = req.body.source && req.body.source.designStudio ? req.body.source.designStudio.part : null;
      const k = kernel[part]; if (!k) return res.status(400).json({ error: 'not a lift part' });
      const model = { model_id: `${part}-${models.length + 1}`, owner_sub: sub, title: req.body.title, base: req.body.base, features: req.body.features, revision: 1, state: 'built', report: k.report, source: req.body.source, artifacts: {}, engine_build: 'real-kernel' };
      models.push(model); res.status(201).json({ model, build: { ok: true, ms: 1 } });
    });
    app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
    server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = async (method, p, body) => { const res = await fetch(`${origin}/api/design-studio${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
    // The engine answering is THIS tree's build.
    const status = await (await fetch(`${origin}/api/embodied/physics/status`)).json();
    assert.equal(status.engine.connected, true, JSON.stringify(status.engine));
    assert.equal(status.engine.buildHash, engineBuildHash(path.join(EH.PKG, 'engine')), 'the container was built from this engine tree');
    results.engine = { engine: status.engine.engine, version: status.engine.version, buildHash: status.engine.buildHash };
    // 3. The page, driven as the person.
    owned = await launchIsolatedBrowser(); context = await owned.browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    page = await context.newPage();
    const created = await api('POST', '/projects', { example: 'lift-1' }); const id = created.json.project.id;
    const ready = () => page.locator('#studio[data-ready="1"]').waitFor({ timeout: 30000 });
    const text = (sel) => page.locator(sel).textContent();
    const stage = (kind) => page.locator(`#poster-${kind}`).getAttribute('data-stage');
    const reload = async () => { const n = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#reload'); await page.locator(`#studio[data-reads="${n + 1}"]`).waitFor({ timeout: 60000 }); };
    await page.goto(`${origin}/api/design-studio/app?theme=midnight#/product/${id}`); await ready();
    await page.click('#act-design'); await page.locator('#make-close:not([disabled])').waitFor({ timeout: 60000 });
    const n0 = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#make-close'); await page.locator(`#studio[data-reads="${n0 + 1}"]`).waitFor({ timeout: 30000 });
    assert.equal(await stage('design'), 'parts-complete');
    await page.click('#act2-design'); await page.locator('#studio[data-screen="mechanism"][data-ready="1"]').waitFor({ timeout: 30000 });
    const parts = await page.locator('#mech-parts li').allTextContents();
    for (const p of LIFT_1_EXAMPLE.bindings.design.parts) assert.ok(parts.some((l) => l.includes(`(${p.id}) · ${kernel[p.id].report.massG} g · ${kernel[p.id].report.extentsMm.size.join(' × ')} mm by the kernel`)), `${p.id}: the kernel's figures on the screen: ${parts.join(' | ')}`);
    await shoot(page, 'lift-real-mechanism-1280');
    await page.click('#mech-save'); await page.locator('#studio[data-screen="product"][data-ready="1"]').waitFor({ timeout: 30000 });
    // Build the plant on the real engine.
    await page.click('#act-simulate'); await page.locator('#poster-simulate[data-stage="built"]').waitFor({ timeout: 60000 });
    const state = await (await fetch(`${origin}/api/embodied/physics/plant/state?project=${id}`)).json();
    const info = state.state.info;
    results.plant = { massKg: info.massKg, bodies: info.bodies, actuators: info.actuators, timestepS: info.timestepS, payloadRestM: info.payload.restPosM, specSha256: info.specSha256 };
    const expectedMass = LIFT_1_EXAMPLE.bindings.design.parts.reduce((s, p) => s + kernel[p.id].report.massG, 0) / 1000 + 2;
    assert.ok(Math.abs(info.massKg - expectedMass) < 1e-4, `the plant's mass is the kernel's three masses plus the 2 kg payload: ${info.massKg} vs ${expectedMass}`);
    assert.equal(info.actuators.length, 1); assert.equal(info.actuators[0].row.id, 'sts3215-12v'); assert.equal(info.actuators[0].gearRatio, 40);
    // Run the baselines: the engine's own numbers.
    await page.click('#act-simulate'); await page.locator('#poster-simulate[data-stage="baseline"]').waitFor({ timeout: 120000 });
    /** The engine's reports for this product; the bridge takes one request at a time, so a listing refused while the page reads is asked again. */
    const reports = async () => {
      for (let attempt = 0; ; attempt += 1) {
        const listing = await (await fetch(`${origin}/api/embodied/physics/reports`)).json();
        if (Array.isArray(listing.reports)) return listing.reports.filter((r) => r.file.startsWith(`plant-${id}-`));
        assert.ok(attempt < 20, `the reports listing never answered: ${JSON.stringify(listing).slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    const base = (await reports()).find((r) => r.file === `plant-${id}-reach-seed0.json`).report;
    results.baseline = { ...base.baseline, rows: undefined }; results.task = base.taskSpec; results.ik = base.ik;
    assert.equal(base.baseline.episodes, 5);
    assert.ok(base.baseline.reached === 5 && base.baseline.reachedS <= base.taskSpec.timeS, `the PD baseline lifts 2 kg to 300 mm inside 5 s on the real plant: ${JSON.stringify(results.baseline)}`);
    assert.ok(base.baseline.rmsTorqueMaxNm <= info.actuators[0].continuousNm, 'under the row\'s continuous rating');
    assert.match(await text('#simulate-figure'), new RegExp(`^${base.baseline.reachedS.toFixed(2)} s$`));
    await shoot(page, 'lift-real-baseline-1280');
    // Train the policy: a real PPO run as a job; follow it by Reload until the engine reports it done.
    const catalog = await (await fetch(`${origin}/api/embodied/build/catalog`)).json();
    const sts = catalog.servos.find((r) => r.id === 'sts3215-12v');
    const reads = { parts: models.map((m) => ({ id: m.source.designStudio.part, modelId: m.model_id, massG: m.report.massG, extentsMm: m.report.extentsMm.size, route: `${origin}/api/cad-studio/models`, readAt: new Date().toISOString(), revision: m.revision })), motors: [{ rowId: sts.id, source: 'embodied', name: sts.name, stallNm: sts.stallNm, noLoadRadS: sts.noLoadRadS, continuousNm: sts.continuousNm, route: `${origin}/api/embodied/build/catalog`, readAt: new Date().toISOString() }] };
    const spec = (await api('POST', `/projects/${id}/plant-spec`, reads)).json.spec;
    assert.equal(spec.actuators[0].stallNm, sts.stallNm, 'the drive is the real catalog row');
    const trainRes = await fetch(`${origin}/api/embodied/physics/plant/train`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: id, spec, task: { deltaM: base.taskSpec.deltaM, timeS: base.taskSpec.timeS, loadKg: base.taskSpec.loadKg, line: base.taskSpec.line }, timesteps: TIMESTEPS, seed: 0 }) });
    const started = await trainRes.json(); assert.equal(started.started, true, JSON.stringify(started));
    await reload(); assert.equal(await stage('simulate'), 'training', await text('#simulate-stage'));
    const t0 = Date.now();
    for (;;) {
      const jobs = (await (await fetch(`${origin}/api/embodied/physics/plant/train`)).json()).jobs;
      const job = jobs.find((j) => j.file === started.job.file);
      if (job.state !== 'running') { assert.equal(job.state, 'done', JSON.stringify(job)); results.job = job; break; }
      assert.ok(Date.now() - t0 < 1500000, 'the run finishes inside 25 minutes');
      await new Promise((r) => setTimeout(r, 5000));
    }
    await reload(); assert.equal(await stage('simulate'), 'trained');
    const trained = (await reports()).find((r) => r.file === `plant-${id}-reach-seed0.json`).report;
    results.policy = { ...trained.policy, rows: undefined }; results.verdict = trained.verdict; results.policyBeatsBaseline = trained.policyBeatsBaseline; results.trainWallS = trained.trainWallS; results.timesteps = trained.timesteps;
    // Certify through the real gate.
    const beforeCertify = Number(await page.locator('#studio').getAttribute('data-reads'));
    await page.click('#act-simulate');
    await page.locator(`#studio[data-reads="${beforeCertify + 1}"]`).waitFor({ timeout: 300000 });
    const certEntry = (await reports()).find((r) => r.file === `plant-${id}-reach-ppo-seed0.certificate.json`);
    assert.ok(certEntry, 'the certificate file is beside the policy in the engine\'s report directory');
    const cert = certEntry.report;
    results.certificate = { file: certEntry.file, ok: cert.ok, checked: cert.checked, refusedCount: cert.refusedCount, refused: cert.refused, policySha256: cert.policySha256, buildHash: cert.buildHash, specSha256: cert.specSha256, policyBeatsBaseline: cert.policyBeatsBaseline, verdict: cert.verdict, limits: cert.limits, baseline: cert.baseline, policy: cert.policy, wallSeconds: cert.wallSeconds };
    assert.equal(cert.buildHash, status.engine.buildHash); assert.equal(cert.specSha256, info.specSha256); assert.match(cert.policySha256, /^[0-9a-f]{64}$/);
    assert.equal(await stage('simulate'), cert.ok ? 'certified' : 'trained');
    await shoot(page, 'lift-real-certified-1280');
    if (cert.ok) {
      await page.click('#act-simulate'); await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 }); await page.click('#close-dialog button[value="close"]'); await page.locator('#poster-simulate[data-closed="1"]').waitFor({ timeout: 30000 });
      const body = await api('GET', `/projects/${id}/body`);
      assert.equal(body.status, 200, JSON.stringify(body.json));
      assert.equal(body.json.actuators.length, 1); assert.equal(body.json.actuators[0].joint, 'carriage-slide'); assert.equal(body.json.actuators[0].continuousNm, info.actuators[0].continuousNm); assert.equal(body.json.actuators[0].stallNm, info.actuators[0].stallNm);
      assert.equal(body.json.walker.kind, 'certified-policy'); assert.equal(body.json.walker.policySha256, cert.policySha256); assert.deepEqual(body.json.node, { kind: 'plant', endpoint: '/api/embodied/physics/plant' });
      results.body = body.json;
    } else {
      t.diagnostic(`the gate refused the ${TIMESTEPS}-step policy: ${JSON.stringify(cert.refused.slice(0, 3))}; the body contract is not published without a passing certificate`);
    }
    await page.setViewportSize({ width: 412, height: 915 }); await page.reload(); await ready();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await shoot(page, 'lift-real-product-412x915');
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    t.diagnostic(JSON.stringify({ baseline: results.baseline, policy: results.policy, verdict: results.verdict, certificate: { ok: cert.ok, refusedCount: cert.refusedCount, checked: cert.checked } }));
  } finally {
    if (context) await context.close(); if (owned) { await owned.browser.close(); await owned.close(); }
    if (server) await new Promise((r) => server.close(r));
    engine.stop(); emb.restore(); ds.restore(); fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function sharedUi() {
  const c = [process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src/shared/ui'), path.join(os.homedir(), 'Documents/projects/oshal-kernel/platform/src/shared/ui'), path.join(process.env.OSHAL_CORE_ROOT || '', 'src/shared/ui')].filter(Boolean);
  return c.find((x) => fs.existsSync(path.join(x, 'js/surface-theme.js')));
}
function themes() {
  const c = [process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src/pages/cockpit/css/themes'), path.join(os.homedir(), 'Documents/projects/oshal-kernel/platform/src/pages/cockpit/css/themes'), path.join(process.env.OSHAL_CORE_ROOT || '', 'src/pages/cockpit/css/themes')].filter(Boolean);
  return c.find((x) => fs.existsSync(x));
}
