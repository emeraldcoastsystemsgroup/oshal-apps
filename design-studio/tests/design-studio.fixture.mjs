/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: embodied's catalog (the servo row with fixture numbers labelled as such) and the plant routes in their real reply shapes (recorded from the engine on the lift): load echoes the spec's actuators with the limits the engine derives, state is 404 plant_not_built until a load, train with 0 steps writes a baseline report into the reports listing, train with steps records a running job that `finishJob()` completes into a trained report with a policy, certify writes the certificate beside it; every request is recorded; Circuit Lab's drivers answer a stepper row without a continuous rating.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: CAD Studio's model routes in their real shape - POST /models builds a box from the program's base (a binary STL of twelve triangles, the kernel report a box has, revision 1, state built, artifacts links, the source tag kept), GET /models lists the canned and the created parts, GET /models/{id}/artifacts/stl serves the bytes; switches make a create fail its build (cadBuildFails) or export a mesh with an open edge (cadOpenMesh: the mesh check must catch it). The print service's posted-model route (multer from the core checkout) records what it was sent and answers uploaded, not started, under the owner's auto-start. The print-set root is a temporary directory removed with the fixture.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D4, lane @ds-app: the loopback fixture the browser proof opens - the REAL compiled design-studio routes (routes/design-studio-routes.js through the route harness's framework doubles and in-memory pool) with the framework's shared theme assets and a signed-in identity, beside canned answers in the engines' own shapes for everything the page reads through the session: embodied's design (the hexapod route's shape with fixture numbers labelled as such), /physics/status with a node of kind hexapod, /physics/reports with a certificate, the plant's MJCF with its timestep and eighteen actuated joints, the check and the gate as writers that record what they were sent; Circuit Lab's designs and examples, a create that solves on the fixture (a regulator reading that holds); CAD Studio's models; the print service's printers; the cockpit stub the deep links land on. Every canned answer is switchable (absent, refused, failing) so the screen's honesty can be proven.
 */
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const harness = require('./routes.harness.js');
export const coreRoot = harness.CORE;
harness.coreRequire('tsx/cjs');
export const { launchIsolatedBrowser } = harness.coreRequire(path.join(coreRoot, 'tests/fixtures/isolated-browser.ts'));
export const bodyReads = require('./body-reads.fixture.js');
const STL = require('./stl.fixture.js');
const { randomUUID } = require('node:crypto');

/** The shared UI the page loads: the kernel platform tree when it is on this box (document-handoff.js lives there), else the core checkout. */
function sharedUiRoot() {
  const candidates = [process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src/shared/ui'), path.join(os.homedir(), 'Documents/projects/oshal-kernel/platform/src/shared/ui'), path.join(coreRoot, 'src/shared/ui')].filter(Boolean);
  return candidates.find((c) => fs.existsSync(path.join(c, 'js/surface-theme.js')));
}
function themesRoot() {
  const candidates = [process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src/pages/cockpit/css/themes'), path.join(os.homedir(), 'Documents/projects/oshal-kernel/platform/src/pages/cockpit/css/themes'), path.join(coreRoot, 'src/pages/cockpit/css/themes')].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c));
}

const LEGS = bodyReads.LEGS; const JOINTS = ['coxa', 'femur', 'tibia'];
const DEG = Math.PI / 180;
/** A printed part in the hexapod route's shape with a CAD Studio program (a box base, no features) and the link it rides on. */
const printed = (id, name, qty, material, massEachG, link, size, option) => ({ id, name, qty, material, printNotes: 'PETG, 30 % gyroid (fixture)', massEachG, link, ...(option ? { option } : {}), cad: { base: { kind: 'box', sizeX: size[0], sizeY: size[1], sizeZ: size[2] }, features: [] } });
const bought = (id, name, qty, massEachG, role, approxUsdEach) => ({ id, name, qty, massEachG, role, approxUsdEach, source: 'fixture' });

/**
 * @description The canned design: GET /build/hexapod's shape with FIXTURE numbers. The budget closes, every joint sits inside the row's continuous torque, every printed part has a program, so the page reads parts-complete.
 * @returns {object} The design.
 */
export function cannedDesign() {
  const printedParts = [
    printed('plate', 'Body plate', 2, 'PETG', 60, 'body', [220, 140, 4]), printed('pi-bay', 'Pi bay', 1, 'PETG', 25, 'body', [95, 70, 30]), printed('head', 'Head (LiDAR nose)', 1, 'PETG', 20, 'body', [50, 50, 40]),
    printed('coxa-bracket', 'Coxa bracket', 6, 'PETG', 12, 'coxa', [45, 30, 30]), printed('femur', 'Femur', 6, 'PETG', 18, 'femur', [80, 25, 25]), printed('tibia', 'Tibia', 6, 'PETG', 22, 'tibia', [120, 20, 20]), printed('foot', 'Foot cap', 6, 'TPU', 4, 'tibia', [16, 16, 16]),
    printed('spring-cam', 'Spring cam', 1, 'PETG', 9, 'jump', [30, 30, 12], 'latched-spring'),
  ];
  const boughtParts = [
    bought('sts3215-12v', 'fixture bus servo 12 V', 18, 55, 'every joint', 14), bought('pi5-8gb', 'fixture Pi 5', 1, 45, 'the brain', 80), bought('ld19-lidar', 'fixture LiDAR ring', 1, 47, 'the one eye', 90),
    bought('bno055-imu', 'fixture IMU', 1, 3, 'which way is up', 20), bought('lipo-3s-2200', 'fixture 3S pack', 1, 175, 'the pack', 30), bought('buck-5v-5a', 'fixture 5 V buck', 1, 10, 'the Pi rail', 12),
  ];
  const totalG = printedParts.reduce((a, p) => a + (p.option ? 0 : p.qty * p.massEachG), 0) + boughtParts.reduce((a, p) => a + p.qty * p.massEachG, 0);
  const servo = { id: 'sts3215-12v', name: 'fixture bus servo 12 V', stallNm: 2.942, noLoadRadS: 4.7166, massG: 55 };
  const joint = (j, nm) => ({ joint: j, staticNm: nm / 1.3, nm, usableNm: 1.47, stallNm: servo.stallNm, withinContinuous: nm <= 1.47, margin: Math.round((1.47 / nm) * 100) / 100, because: 'fixture' });
  return {
    simulated: true, generated: true, fit: 'spider-18',
    spec: { fit: 'spider-18', servoRowId: 'sts3215-12v', servoCount: 18, limits: { coxaDeg: [-60, 60], femurDeg: [-120, 120], tibiaDeg: [-140, 140] }, jumpOptions: ['legs-hop', 'latched-spring'], massTargetG: 2100 },
    servo, massBudget: { rows: [], totalG, targetG: 2100, withinTarget: totalG <= 2100, printedG: 0, boughtG: 0, briefTotalG: 1851 },
    joints: [joint('coxa', 1.15), joint('femur', 1.43), joint('tibia', 1.0)],
    printed: printedParts, bought: boughtParts, bom: [], jump: [], approxUsd: 0, approxUsdWithSpring: 0, assumptions: ['fixture numbers'], printRules: [],
  };
}

/** @description The plant's MJCF as GET /physics/hexapod/mjcf answers it: the option's timestep, a hinge joint per actuator with its range in radians, and the position actuators. */
export function cannedMjcf(timestepS = 0.002) {
  const limits = { coxa: 60, femur: 120, tibia: 140 };
  const joints = LEGS.flatMap((leg) => JOINTS.map((j) => `      <joint name="${leg}-${j}" type="hinge" axis="0 0 1" range="${(-limits[j] * DEG).toFixed(4)} ${(limits[j] * DEG).toFixed(4)}"/>`));
  const actuators = LEGS.flatMap((leg) => JOINTS.map((j) => `    <position name="${leg}-${j}" joint="${leg}-${j}" kp="40"/>`));
  return `<mujoco model="spider-18 (fixture)">\n  <option timestep="${timestepS}" gravity="0 0 -9.81"/>\n  <worldbody>\n    <body name="torso">\n${joints.join('\n')}\n      <joint name="spring" type="slide" axis="0 0 1" range="-0.038 0.038"/>\n    </body>\n  </worldbody>\n  <actuator>\n${actuators.join('\n')}\n  </actuator>\n</mujoco>\n`;
}

/** @description A hexapod training report entry in GET /physics/reports' shape, with the walk facets. */
export function hexapodReport(o = {}) {
  const file = o.file || 'hexapod-walk-shape-seed1.json';
  return { file, certified: o.certified === undefined ? null : o.certified, report: { task: o.task || 'hexapod-walk', mode: 'shape', seed: o.seed === undefined ? 1 : o.seed, timesteps: 1000000, policyFile: file.replace(/^hexapod-walk-/, 'hexapod-walk-ppo-').replace(/\.json$/, '.zip'), finishedAt: o.finishedAt || '2026-10-30T15:00:00.000Z', policyBeatsBaseline: o.beats === undefined ? false : o.beats, baseline: { trackingErrorMps: 0.042, costOfTransport: 12.5, falls: 0 }, policy: { trackingErrorMps: 0.040, costOfTransport: 6.8, falls: 0 } } };
}
/** @description A certificate entry as the listing carries it beside the policy: the gate's verdict, the policy's sha and the engine build (fixture values). */
export function certificateEntry(policyFile = 'hexapod-walk-ppo-shape-seed1.zip', ok = true) {
  return { file: policyFile.replace(/\.zip$/, '.certificate.json'), certified: null, report: { task: 'hexapod-certify', reportFile: 'hexapod-walk-shape-seed1.json', policyFile, policySha256: 'fixture-sha-d15f6a7d2048e7ce', buildHash: 'fixture-build-7346d37a', unit: 'control steps', checked: 1631, refused: [], refusedCount: ok ? 0 : 3, ok, policyBeatsBaseline: true, baseline: { trackingErrorMps: 0.042, costOfTransport: 12.5, falls: 0 }, policy: { trackingErrorMps: 0.040, costOfTransport: 6.8, falls: 0 }, certifiedAt: '2026-10-30T15:33:00.000Z' } };
}
/** @description The /physics/status answer: the engine hello and the rail with a node of kind hexapod. */
export function cannedStatus({ hexapod = 'online', connected = true } = {}) {
  const nodes = [{ nodeId: 'tile-plant', kind: 'plant', online: true, engine: 'mujoco', version: '3.3.5', stale: false }];
  if (hexapod) nodes.push({ nodeId: 'spider-pi', kind: 'hexapod', online: hexapod === 'online', engine: 'hexapod-node', version: '0.1.0', stale: null, endpointUrl: 'http://spider-pi.local:7421' });
  return { backends: ['kinematic', 'physics', 'node'], engine: connected ? { connected: true, engine: 'mujoco', version: '3.3.5', buildHash: 'fixture-build-7346d37a', protocol: 1, addr: '127.0.0.1:1' } : { connected: false, code: 'unreachable', reason: 'connect ECONNREFUSED', addr: '127.0.0.1:1' }, nodes, rail: {} };
}
export const cannedReports = (reports = []) => ({ dir: '/tmp/embodied-reports', policies: reports.filter((r) => r.report.policyFile).map((r) => r.report.policyFile), reports });

/** A solved circuit design in Circuit Lab's public shape: one regulator reading that holds, a battery with a runtime. */
function circuitDesign(id, title, example, solved) {
  return { design_id: id, title, parts: [{ id: 'B1', type: 'battery' }, { id: 'REG1', type: 'regulator' }], wires: [], sim: { stopSeconds: 2 }, run_count: solved ? 1 : 0, state: solved ? 'ran' : 'draft', failure_reason: null,
    report: solved ? { readings: [{ id: 'B1', type: 'battery', runtimeHours: 0.3633 }, { id: 'REG1', type: 'regulator', voltsFinal: 5.0, ampsPeak: 2.7, overMax: false, inDropout: false }], warnings: [] } : null,
    source: example ? { kind: 'example', example } : {}, board: null, created_at: '2026-10-30T19:00:00.000Z', updated_at: '2026-10-30T19:00:00.000Z', artifacts: {} };
}

/** A CAD Studio model in the public shape, built from a box base; a mesh with an open edge when the fixture says so. */
function cadModel(f, body) {
  const base = body.base && typeof body.base === 'object' ? body.base : { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 };
  const size = base.kind === 'box' ? [Number(base.sizeX) || 40, Number(base.sizeY) || 40, Number(base.sizeZ) || 20] : base.kind === 'cylinder' ? [Number(base.diameter) || 16, Number(base.diameter) || 16, Number(base.height) || 16] : [40, 40, 20];
  const id = randomUUID();
  const stl = f.cadOpenMesh ? STL.openStl(...size) : STL.boxStl(...size);
  f.cadStl.set(id, stl);
  return { model_id: id, owner_sub: f.sub, title: String(body.title || 'Untitled part').slice(0, 200), base, features: Array.isArray(body.features) ? body.features : [], revision: 1, state: 'built', report: STL.boxReport(...size), feature_status: [], failure_reason: null,
    source: body.source && typeof body.source === 'object' ? body.source : {}, settings: {}, created_at: '2026-10-30T22:00:00.000Z', updated_at: '2026-10-30T22:00:00.000Z', engine_build: 'fixture-cad-build',
    artifacts: Object.fromEntries(['step', 'stl', 'svg-front', 'svg-top', 'svg-right', 'svg-iso', 'report'].map((k) => [k, `/api/cad-studio/models/${id}/artifacts/${k}?revision=1`])) };
}

/** @description embodied's drive catalog as GET /build/catalog answers it: the servo row's numbers are FIXTURE values labelled as such. */
export function cannedCatalog() {
  return { servos: [{ id: 'sts3215-12v', name: 'fixture bus servo 12 V', kind: 'bus-servo', stallNm: 2.942, noLoadRadS: 4.7166, noLoadRpm: 45.04, continuousNm: 1.471, massG: 55, approxUsd: 20, encoder: 'fixture', source: 'fixture numbers' }],
    motors: [{ id: '2306-1800kv', name: 'fixture brushless', kind: 'brushless', kv: 1800, stallNm: null, noLoadRadS: null, continuousNm: null, massG: 30, approxUsd: 18, source: 'fixture', note: 'a propulsion row: KV only, no stall torque or continuous rating is published, so it cannot drive a joint' }], continuousFraction: 0.5, source: 'fixture' };
}
/** The engine's load reply for a spec: the actuators with the limits the engine derives from the rows and the ratio (the real embodied_plant.py arithmetic). */
function plantLoadReply(project, spec) {
  const actuators = (spec.actuators || []).map((a) => { const j = (spec.joints || []).find((x) => x.id === a.joint) || {}; const limit = a.stallNm * a.gearRatio; return { joint: a.joint, type: j.type, stallNm: a.stallNm, noLoadRadS: a.noLoadRadS, gearRatio: a.gearRatio, continuousNm: a.continuousNm, row: a.row || null, forceLimit: limit, noLoadSpeed: a.noLoadRadS / a.gearRatio, kp: limit / 0.05, damping: limit / (a.noLoadRadS / a.gearRatio), unit: j.type === 'hinge' ? 'N·m' : 'N', speedUnit: j.type === 'hinge' ? 'rad/s' : 'm/s', range: j.range }; });
  const massKg = (spec.parts || []).reduce((s, p) => s + p.massKg, 0) + (spec.payload ? spec.payload.massKg : 0);
  return { name: project, specSha256: `fixture-spec-${project.slice(0, 8)}`, timestepS: 0.002, controlDtS: 0.02, bodies: (spec.parts || []).length + 2, geoms: (spec.parts || []).length + 2, massKg: Math.round(massKg * 1e6) / 1e6, medium: spec.medium, parts: (spec.parts || []).map((p) => ({ id: p.id, name: p.name, massKg: p.massKg, extentsM: p.extentsM, mesh: false })), joints: spec.joints, actuators, payload: spec.payload ? { ...spec.payload, restPosM: [0, 0, 0.128106] } : null, senses: [{ name: 'joints', present: true, count: actuators.length, fields: ['q', 'dq', 'force'], rateHz: 50 }, { name: 'imu', present: true, on: spec.base, fields: ['gyro', 'accel'], rateHz: 50 }, { name: 'payload', present: !!spec.payload, fields: ['posM', 'velMps'], rateHz: 50 }], controller: 'targets' };
}
/** A baseline aggregate in the task's shape (fixture numbers). */
const plantBaseline = () => ({ episodes: 5, meanReturn: 91.47, reached: 5, reachedS: 3.58, finalErrorM: 0, rmsTorqueMaxNm: 0.549, rmsTorqueMaxActuator: 'carriage-slide', peakTorqueNm: 1.4151, overRatingSteps: 0, energyJ: 33.37 });

/** Answer a canned route: a number is a bare status with the fixture's refusal body, an object is the 200 body. */
function answer(res, status, body) {
  if (status !== 200) { res.status(status).json({ error: status === 404 ? 'fixture_route_unavailable' : 'fixture_failure', message: status === 503 ? 'engine unavailable (fixture)' : undefined }); return; }
  res.json(body);
}

/**
 * @description Start one ephemeral loopback fixture.
 * @param {object} o Switches: `embodied` (HTTP status of every embodied route; 200 default), `design`, `designStatus`, `status`, `statusCode`, `reports`, `reportsCode`,
 *   `mjcfCode`, `circuitLab` (status), `circuits` (designs list), `cadStudio` (status), `models`, `printService` (status), `printers`, `checkCode`, `certifyOk`, `sub`,
 *   `cadBuildFails` (a create answers 503 with a build failure), `cadOpenMesh` (a created part's STL has an open edge).
 * @returns The origin, the pool, the recorded writes and the switches (mutable between reads), and `close`.
 */
export async function startFixture(o = {}) {
  const { express, createDesignStudioRoutes, restore } = harness.loadRoutes();
  const pool = harness.fakePool();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-studio-browser-'));
  process.env.DESIGN_STUDIO_DATA_DIR = dataRoot;
  const multer = harness.coreRequire('multer');
  const f = {
    embodied: o.embodied ?? 200, design: o.design === undefined ? cannedDesign() : o.design, designStatus: o.designStatus ?? (o.design === null ? 404 : 200),
    status: o.status ?? cannedStatus(), statusCode: o.statusCode ?? 200, reports: o.reports ?? cannedReports([hexapodReport(), certificateEntry()]), reportsCode: o.reportsCode ?? 200, mjcfCode: o.mjcfCode ?? 200,
    circuitLab: o.circuitLab ?? 200, circuits: o.circuits ?? [], cadStudio: o.cadStudio ?? 200, models: o.models ?? [{ model_id: 'cad-1', title: 'Hook', revision: 2, state: 'built' }, { model_id: 'cad-2', title: 'Bar', revision: 1, state: 'draft' }],
    printService: o.printService ?? 200, printers: o.printers ?? [{ printer_id: 'prn-1', label: 'Bench P1S', kind: 'bambu-lan', autoStart: false }],
    checkCode: o.checkCode ?? 200, certifyOk: o.certifyOk ?? true, sub: o.sub || 'roger-browser',
    checks: [], certifies: [], circuitCreates: [], cockpitVisits: [], pool,
    cadBuildFails: o.cadBuildFails ?? false, cadOpenMesh: o.cadOpenMesh ?? false, cadCreates: [], cadStl: new Map(), prints: [], dataRoot,
    catalog: o.catalog ?? cannedCatalog(), catalogCode: o.catalogCode ?? 200, plantCode: o.plantCode ?? 200, plants: new Map(), plantLoads: [], plantTrains: [], plantCertifies: [], jobs: [], defaults: { timesteps: 60000, maxTimesteps: 2000000 },
  };
  /** Complete the newest running job: the trained report with its policy replaces the baseline one (fixture numbers). */
  f.finishJob = (beats = false) => {
    const job = f.jobs.find((j) => j.state === 'running'); if (!job) return null;
    Object.assign(job, { state: 'done', stepsDone: job.timesteps, elapsedS: 240.5, policyFile: job.file.replace(/-reach-seed/, '-reach-ppo-seed').replace(/\.json$/, '.zip') });
    const entry = f.reports.reports.find((r) => r.file === job.file);
    entry.report = { ...entry.report, timesteps: job.timesteps, policyFile: job.policyFile, trainWallS: 240.5, policy: { ...plantBaseline(), reachedS: beats ? 3.4 : 4.34, finalErrorM: beats ? 0 : 0.0045, energyJ: 32.85 }, verdict: { reached: true, reachedS: beats, finalErrorM: beats, rmsTorqueMaxNm: true }, policyBeatsBaseline: beats, finishedAt: '2026-10-31T00:10:00Z' };
    return job;
  };
  if (o.cadBox) { const m = cadModel(f, { title: o.cadBox.title || 'Box', base: { kind: 'box', sizeX: o.cadBox.x || 30, sizeY: o.cadBox.y || 20, sizeZ: o.cadBox.z || 10 } }); f.models = [m, ...(o.models === undefined ? [] : f.models)]; f.cadBoxId = m.model_id; }
  const app = express();
  app.use('/shared/ui', express.static(sharedUiRoot()));
  app.use('/cockpit/css/themes', express.static(themesRoot()));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.oidc = { user: { sub: f.sub }, isAuthenticated: () => true }; next(); });
  app.use('/api/design-studio', createDesignStudioRoutes({ pool, appPackageDir: harness.PKG }));
  const emb = (status) => (f.embodied !== 200 ? f.embodied : status);
  app.get('/api/embodied/build/hexapod', (_req, res) => answer(res, emb(f.designStatus), f.design));
  app.get('/api/embodied/build/hexapod/design.md', (_req, res) => { if (emb(f.designStatus) !== 200) return answer(res, emb(f.designStatus)); res.type('text/markdown').send('# spider-18\n\nthe design document (fixture)\n'); });
  app.get('/api/embodied/physics/status', (_req, res) => answer(res, emb(f.statusCode), f.status));
  app.get('/api/embodied/physics/reports', (_req, res) => answer(res, emb(f.reportsCode), f.reports));
  app.get('/api/embodied/physics/hexapod/mjcf', (_req, res) => { if (emb(f.mjcfCode) !== 200) return answer(res, emb(f.mjcfCode)); res.type('application/xml').send(cannedMjcf()); });
  app.post('/api/embodied/physics/hexapod/check', (req, res) => {
    f.checks.push(req.body);
    if (emb(f.checkCode) !== 200) return answer(res, emb(f.checkCode));
    f.reports.reports.push(hexapodReport({ file: `hexapod-walk-shape-seed${f.checks.length + 1}.json`, seed: f.checks.length + 1, finishedAt: '2026-10-30T21:00:00.000Z' }));
    res.json({ simulated: true, fit: req.body.fit, report: { task: 'hexapod-check', seeds: req.body.seeds, wallSeconds: 3.2, verdict: { standsAtStandHeight: true, walksForward: true, leavesTheFloor: false } } });
  });
  app.post('/api/embodied/physics/hexapod/certify', (req, res) => {
    f.certifies.push(req.body);
    const entry = f.reports.reports.find((r) => r.file === req.body.file);
    if (!entry) return res.status(404).json({ error: 'report_not_found', file: req.body.file });
    const cert = certificateEntry(entry.report.policyFile, f.certifyOk); cert.report.reportFile = entry.file;
    f.reports.reports.push(cert); entry.certified = cert.report;
    res.json({ file: req.body.file, policyFile: entry.report.policyFile, certification: cert.report });
  });
  app.get('/api/embodied/build/catalog', (_req, res) => answer(res, emb(f.catalogCode), f.catalog));
  app.post('/api/embodied/physics/plant/load', (req, res) => {
    f.plantLoads.push(req.body);
    if (emb(f.plantCode) !== 200) return answer(res, emb(f.plantCode));
    const reply = plantLoadReply(req.body.project, req.body.spec || {}); f.plants.set(req.body.project, reply);
    res.json({ built: true, project: req.body.project, route: '/api/embodied/physics/plant', plant: reply });
  });
  app.get('/api/embodied/physics/plant/state', (req, res) => {
    if (emb(f.plantCode) !== 200) return answer(res, emb(f.plantCode));
    const info = f.plants.get(String(req.query.project));
    if (!info) return res.status(404).json({ error: 'plant_not_built', built: false, project: req.query.project, message: 'no plant is built for this product in the engine: POST /physics/plant/load first' });
    res.json({ built: true, project: req.query.project, route: '/api/embodied/physics/plant', state: { timeS: 0, jointPos: [0], jointVel: [0], jointForce: [0], motorTorqueNm: [0], targets: [0], gyroRadS: [0, 0, 0], accelMps2: [0, 0, 9.81], payloadPosM: [0, 0, 0.128106], payloadVelMps: [0, 0, 0], energyJ: 0, info } });
  });
  app.post('/api/embodied/physics/plant/train', (req, res) => {
    f.plantTrains.push(req.body);
    if (emb(f.plantCode) !== 200) return answer(res, emb(f.plantCode));
    const b = req.body; const file = `plant-${b.project}-reach-seed${b.seed || 0}.json`;
    const report = { task: 'plant-reach', project: b.project, seed: b.seed || 0, specSha256: `fixture-spec-${String(b.project).slice(0, 8)}`, taskSpec: { targetPosM: [0, 0, 0.428106], deltaM: b.task.deltaM, timeS: b.task.timeS, loadKg: b.task.loadKg, line: b.task.line }, timesteps: 0, evalSeeds: [100, 101, 102, 103, 104], facets: ['reached', 'reachedS', 'finalErrorM', 'rmsTorqueMaxNm'], startedAt: '2026-10-31T00:00:00Z', finishedAt: '2026-10-31T00:00:01Z', baseline: plantBaseline() };
    f.reports.reports = f.reports.reports.filter((r) => r.file !== file);
    if (!b.timesteps) { f.reports.reports.push({ file, certified: null, report }); return res.json({ started: false, project: b.project, report }); }
    const running = f.jobs.find((j) => j.state === 'running' && j.file === file);
    if (running) return res.status(409).json({ error: 'busy', message: `${file} is already training`, project: b.project });
    const job = { file, policyFile: null, project: b.project, seed: b.seed || 0, timesteps: b.timesteps, state: 'running', startedAt: '2026-10-31T00:05:00Z', elapsedS: 0, stepsDone: 0, error: null };
    f.jobs.push(job); f.reports.reports.push({ file, certified: null, report });
    res.json({ started: true, project: b.project, job });
  });
  app.get('/api/embodied/physics/plant/train', (_req, res) => { if (emb(f.plantCode) !== 200) return answer(res, emb(f.plantCode)); res.json({ jobs: f.jobs, defaults: f.defaults }); });
  app.post('/api/embodied/physics/plant/certify', (req, res) => {
    f.plantCertifies.push(req.body);
    if (emb(f.plantCode) !== 200) return answer(res, emb(f.plantCode));
    const entry = f.reports.reports.find((r) => r.file === req.body.file);
    if (!entry) return res.status(404).json({ error: 'report_not_found', file: req.body.file });
    if (!entry.report.policyFile) return res.status(422).json({ error: 'no_policy', file: req.body.file });
    const r = entry.report;
    const cert = { task: 'plant-certify', project: r.project, seed: r.seed, reportFile: entry.file, policyFile: r.policyFile, policySha256: `fixture-sha-lift-${r.seed}`, buildHash: 'fixture-build-5d885fe0', specSha256: r.specSha256, evalSeeds: r.evalSeeds, limits: [{ joint: 'carriage-slide', continuousNm: 1.471, stallNm: 2.942, gearRatio: 40 }], reachedWithinS: r.taskSpec.timeS, unit: 'control steps', checked: 1875, refused: [], refusedCount: f.certifyOk ? 0 : 1, ok: !!f.certifyOk, baseline: { ...r.baseline, checked: 1875, refused: [], refusedCount: 0 }, policy: { ...r.policy, checked: 1875, refused: [], refusedCount: f.certifyOk ? 0 : 1 }, verdict: r.verdict, policyBeatsBaseline: r.policyBeatsBaseline, certifiedAt: '2026-10-31T00:12:00Z', wallSeconds: 3.55 };
    if (!f.certifyOk) cert.refused = [{ episode: 100, step: 375, reason: 'did not reach the target within 5 s (fixture)' }];
    f.reports.reports.push({ file: r.policyFile.replace(/\.zip$/, '.certificate.json'), certified: null, report: cert }); entry.certified = cert;
    res.json({ file: req.body.file, policyFile: r.policyFile, beatsBaseline: cert.policyBeatsBaseline, limits: cert.limits, certification: cert });
  });
  app.get('/api/circuit-lab/catalog/drivers', (_req, res) => answer(res, f.circuitLab, { drivers: [{ id: 'stepper-nema17', type: 'stepper', name: 'fixture NEMA 17', kind: 'stepper', nameplate: { holdingTorqueMnm: 400, stepsPerRev: 200 } }, { id: 'servo-bus-sts3215-12v', type: 'servo', kind: 'bus-servo', name: 'fixture bus servo via the lab', sharedPart: { owner: 'embodied', id: 'sts3215-12v' }, nameplate: { stallTorqueMnm: 2942, noLoadDegPerS: 270 } }] }));
  app.get('/api/circuit-lab/app', (req, res) => { res.type('html').send(`<title>lab stub</title><p id="lab-stub">${req.originalUrl}</p>`); });
  app.get('/api/circuit-lab/capabilities', (_req, res) => answer(res, f.circuitLab, { contract: { parts: ['resistor'] } }));
  app.get('/api/circuit-lab/designs', (_req, res) => answer(res, f.circuitLab, { designs: f.circuits }));
  app.get('/api/circuit-lab/examples', (_req, res) => answer(res, f.circuitLab, { examples: [{ id: 'hexapod-power', title: 'Hexapod power (spider-18)' }] }));
  app.post('/api/circuit-lab/designs', (req, res) => {
    f.circuitCreates.push(req.body);
    if (f.circuitLab !== 200) return answer(res, f.circuitLab);
    const d = circuitDesign(`circ-${f.circuitCreates.length}`, req.body.title || 'Untitled circuit', req.body.example || null, req.body.run !== false);
    f.circuits.push(d); res.status(201).json({ design: d, run: d.run_count ? { run: 1, report: d.report } : null, build: { ok: true, ms: 12 } });
  });
  app.get('/api/cad-studio/capabilities', (_req, res) => answer(res, f.cadStudio, { contract: { bases: { box: 'sizeX, sizeY, sizeZ' } } }));
  app.get('/api/cad-studio/models', (_req, res) => answer(res, f.cadStudio, { models: f.models }));
  app.post('/api/cad-studio/models', (req, res) => {
    f.cadCreates.push(req.body);
    if (f.cadStudio !== 200) return answer(res, f.cadStudio);
    if (f.cadBuildFails) return res.status(503).json({ model: null, build: { ok: false, code: 'capability_unavailable', error: 'engine container is not running (fixture)', reason: 'engine container is not running (fixture) — install or rebuild it' } });
    const m = cadModel(f, req.body || {}); f.models.push(m);
    res.status(201).json({ model: m, build: { ok: true, ms: 12 } });
  });
  app.get('/api/cad-studio/models/:id/artifacts/stl', (req, res) => {
    if (f.cadStudio !== 200) return answer(res, f.cadStudio);
    const stl = f.cadStl.get(req.params.id);
    if (!stl) return res.status(404).json({ error: 'artifact_not_found' });
    res.setHeader('Cache-Control', 'private, no-store'); res.type('model/stl').send(stl);
  });
  const printUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024, files: 1 } });
  app.post('/api/scan-to-print/service/print', printUpload.single('model'), (req, res) => {
    if (f.printService !== 200) return answer(res, f.printService);
    const printer = f.printers.find((p) => (p.printer_id || p.id) === (req.body || {}).printerId);
    f.prints.push({ printerId: (req.body || {}).printerId, name: req.file ? req.file.originalname : null, bytes: req.file ? req.file.buffer.length : 0, sha256: req.file ? require('node:crypto').createHash('sha256').update(req.file.buffer).digest('hex') : null });
    if (!req.file) return res.status(400).json({ error: 'model_required', message: 'Post the model as multipart field "model" (.stl, .gcode.3mf or .gcode).' });
    if (!printer) return res.status(404).json({ error: 'printer_not_found' });
    res.json({ submission: { submission_id: `sub-${f.prints.length}` }, printer: { printerId: printer.printer_id, label: printer.label, kind: printer.kind, autoStart: !!printer.autoStart }, outcome: { uploaded: true, started: !!printer.autoStart, fileName: req.file.originalname, message: printer.autoStart ? 'started' : 'Uploaded; auto-start is off for this printer, start it on the printer.', estimate: null, sliceProfile: null } });
  });
  app.get('/api/scan-to-print/printers', (_req, res) => answer(res, f.printService, { printers: f.printers, kinds: [], slicerConfigured: false }));
  app.get('/cockpit/', (req, res) => { f.cockpitVisits.push(req.originalUrl); res.type('html').send(`<title>cockpit stub</title><p id="cockpit-stub">${req.originalUrl}</p>`); });
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return Object.assign(f, { origin, circuitDesign, close: async () => { await new Promise((resolve) => server.close(resolve)); restore(); fs.rmSync(dataRoot, { recursive: true, force: true }); } });
}
