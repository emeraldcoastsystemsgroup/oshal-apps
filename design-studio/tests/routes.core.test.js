/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203, lane @ds-app: the packaged routes over real loopback HTTP with express resolved from the framework checkout (OSHAL_CORE_ROOT) and the SQL-dispatching in-memory pool: the surface and its assets serve; the caller gate 401s; capabilities and the plan (a hanger four phases, the spider nine); a project is created from a brief (the proposed chain) and from the example (nine phases, eight bindings by name, no number); list, read, rename, re-brief, the chain (PUT /phases, refused by field), delete with its rows; owner scoping (a second subject gets 404); a bind is a new revision of the phase's binding and refuses a phase outside the chain; a close is refused as missing_evidence without the evidence line OR the revision, missing_step on build, and recorded otherwise; the phase brief per kind (inChain, binding, closures); the body contract 409 body_incomplete naming the missing reads, then 200 with every value traced to the bound reads; the Home summary; the smoke.
 *
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: the print set under a product over the same loopback - 404 no_print_set before one is begun; begin refused by field; begun from the design's rows (pending every part); a watertight STL kept by multipart with its sha256 and the kernel's figures from the meta; a non-watertight STL recorded unprintable with the fault; a part without a program recorded unprintable by JSON reason; a part outside the set 409; an STL over the cap 413; finish refused 409 set_incomplete naming the part still unaccounted, then 200 with the manifest's sha256; every file served by the name the manifest lists with its content type and bytes (an STL downloads as <product>-<part>.stl), the state file and a name outside the manifest 404, another subject 404; a hand-off recorded for a file of the set and refused for another; begin again wipes the set. The data root is a temporary directory named by DESIGN_STUDIO_DATA_DIR.
 *
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the mechanism under a product over the same loopback - 404 no_mechanism with the brief's task before a save; PUT refused by name against the design's bound parts (part_not_bound, unknown_motor, cycle, bad_mechanism with the field); 201 then 200 as revision 2 with the task read from the brief when the body states none; the project read carries it; the lift example creates seven phases, two bindings and its mechanism with the task from its line; POST /plant-spec composes the engine's spec from the mechanism and the reads the page sends (every number one of those; part_not_read and motor_not_read by name); the body contract of the lift from a generated plant's read; another subject 404; delete removes the mechanism row.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Not part of the store-CI bare job (the glob is tests/*-*.test.js); run locally:
 * OSHAL_CORE_ROOT=$HOME/Documents/projects/oshal/src node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./routes.harness.js');

const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const STL = require('./stl.fixture.js');
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'design-studio-routes-'));
process.env.DESIGN_STUDIO_DATA_DIR = DATA_ROOT;
const { express, createDesignStudioRoutes, createHomeSummaryRoutes, createPackageSmokeRoutes, restore } = H.loadRoutes();
const SUB = 'roger-test'; const OTHER = 'someone-else';
let server; let origin; let pool; let who = SUB;

test.before(async () => {
  pool = H.fakePool();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (who) req.oidc = { user: { sub: who }, isAuthenticated: () => true }; next(); });
  app.use('/api/design-studio/home-summary', createHomeSummaryRoutes({ pool, appPackageDir: H.PKG }));
  app.use('/api/design-studio/_smoke', createPackageSmokeRoutes({ appPackageDir: H.PKG }));
  app.use('/api/design-studio', createDesignStudioRoutes({ pool, appPackageDir: H.PKG }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); restore(); fs.rmSync(DATA_ROOT, { recursive: true, force: true }); });

const call = async (method, p, body) => {
  const res = await fetch(`${origin}/api/design-studio${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
};
const HANGER = { name: 'a clothes hanger', brief: { what: 'a clothes hanger', requirements: ['holds a coat', 'hangs on a closet rail'], targets: { massG: 40 } } };

test('the surface, its assets, the smoke and capabilities serve; the caller gate 401s', async () => {
  const page = await call('GET', '/app'); assert.equal(page.status, 200); assert.match(page.type, /text\/html/); assert.match(page.text, /<title>Design Studio<\/title>/);
  for (const f of ['design-studio.js', 'design-studio-stages.js', 'design-studio-screens.js']) { const r = await call('GET', `/assets/${f}`); assert.equal(r.status, 200, f); assert.match(r.type, /javascript/); }
  const css = await call('GET', '/assets/design-studio.css'); assert.equal(css.status, 200); assert.match(css.type, /text\/css/);
  const smoke = await call('GET', '/_smoke'); assert.equal(smoke.status, 200); assert.equal(smoke.json.package, 'design-studio'); assert.match(smoke.json.version, /^\d+\.\d+\.\d+$/);
  const caps = await call('GET', '/capabilities'); assert.equal(caps.status, 200);
  assert.deepEqual(caps.json.phases, ['brief', 'design', 'mechanical', 'electrical', 'sensors', 'controller', 'simulate', 'fabricate', 'build']);
  assert.deepEqual(caps.json.examples.map((e) => e.id), ['spider-18', 'lift-1']); assert.equal(caps.json.body.schema, 'design-studio-body/1');
  who = null;
  assert.equal((await call('GET', '/projects')).status, 401); assert.equal((await call('POST', '/projects', HANGER)).status, 401);
  assert.equal((await call('GET', '/home-summary')).status, 401);
  who = SUB;
});

test('the plan proposes four phases for a hanger and nine for the spider, naming the lines; a bad brief is refused by field', async () => {
  const hanger = await call('POST', '/plan', { brief: HANGER.brief });
  assert.equal(hanger.status, 200); assert.deepEqual(hanger.json.phases.map((p) => p.kind), ['brief', 'design', 'fabricate', 'build']);
  const spider = await call('POST', '/plan', { brief: { what: 'a six-legged walking robot', requirements: ['holds a Raspberry Pi', 'has heat', 'one LiDAR eye', 'six legs', 'jumps', 'flips its legs when upside down'] } });
  assert.equal(spider.json.phases.length, 9); assert.match(spider.json.unsolved[0], /thermal/);
  const bad = await call('POST', '/plan', { brief: { what: '' } }); assert.equal(bad.status, 400); assert.equal(bad.json.field, 'brief.what');
});

let hangerId; let spiderId;
test('a project is created from a brief with the proposed chain, and from the example with nine phases bound by name', async () => {
  const h = await call('POST', '/projects', HANGER);
  assert.equal(h.status, 201); hangerId = h.json.project.id; assert.match(hangerId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(h.json.project.phases.map((p) => `${p.kind}:${p.engine}`), ['brief:reasoned', 'design:cad-studio', 'fabricate:scan-to-print', 'build:reasoned']);
  assert.deepEqual(h.json.bindings, {}); assert.deepEqual(h.json.closures, []);
  const s = await call('POST', '/projects', { example: 'spider-18' });
  assert.equal(s.status, 201); spiderId = s.json.project.id; assert.equal(s.json.project.name, 'spider-18');
  assert.equal(s.json.project.phases.length, 9);
  assert.deepEqual(Object.keys(s.json.bindings).sort(), ['build', 'controller', 'design', 'electrical', 'fabricate', 'mechanical', 'sensors', 'simulate']);
  assert.deepEqual(s.json.bindings.design.artifact, { engine: 'embodied', kind: 'design-fit', machine: 'hexapod', fit: 'spider-18' });
  assert.equal(s.json.bindings.simulate.artifact.certificate, 'hexapod-walk-ppo-shape-seed1.certificate.json');
  assert.equal(s.json.bindings.design.revision, 1); assert.equal(s.json.bindings.design.bindCount, 1);
  const unknown = await call('POST', '/projects', { example: 'nope' }); assert.equal(unknown.status, 404); assert.equal(unknown.json.error, 'unknown_example');
  const explicit = await call('POST', '/projects', { name: 'widget', brief: { what: 'a widget' }, phases: [{ kind: 'brief' }, { kind: 'design', engine: 'reasoned' }, { kind: 'build' }] });
  assert.equal(explicit.status, 201); assert.deepEqual(explicit.json.project.phases.map((p) => p.engine), ['reasoned', 'reasoned', 'reasoned']);
  await call('DELETE', `/projects/${explicit.json.project.id}`);
});

test('list, read, rename, re-brief and the chain; another subject sees nothing; a bad chain is refused by field', async () => {
  const list = await call('GET', '/projects'); assert.equal(list.status, 200);
  assert.deepEqual(list.json.projects.map((p) => p.name).sort(), ['a clothes hanger', 'spider-18']); assert.equal(list.json.projects[0].closedPhases, 0);
  const renamed = await call('PATCH', `/projects/${hangerId}`, { name: 'the hanger', brief: { what: 'a clothes hanger', requirements: ['holds a coat'] } });
  assert.equal(renamed.status, 200); assert.equal(renamed.json.project.name, 'the hanger'); assert.deepEqual(renamed.json.project.brief.requirements, ['holds a coat']);
  const chain = await call('PUT', `/projects/${hangerId}/phases`, { phases: [{ kind: 'build' }, { kind: 'brief' }, { kind: 'design', engine: 'cad-studio' }, { kind: 'mechanical', engine: 'reasoned' }, { kind: 'fabricate', engine: 'cad-studio' }] });
  assert.equal(chain.status, 200); assert.deepEqual(chain.json.project.phases.map((p) => p.kind), ['brief', 'design', 'mechanical', 'fabricate', 'build']);
  const bad = await call('PUT', `/projects/${hangerId}/phases`, { phases: [{ kind: 'brief' }, { kind: 'electrical', engine: 'embodied' }, { kind: 'build' }] });
  assert.equal(bad.status, 400); assert.equal(bad.json.error, 'unknown_engine'); assert.equal(bad.json.field, 'phases[1].engine');
  who = OTHER;
  assert.deepEqual((await call('GET', '/projects')).json.projects, []);
  assert.equal((await call('GET', `/projects/${hangerId}`)).status, 404);
  assert.equal((await call('POST', `/projects/${hangerId}/close`, { phase: 'brief', evidence: 'x', revision: 'y' })).status, 404);
  assert.equal((await call('DELETE', `/projects/${hangerId}`)).status, 404);
  who = SUB;
  assert.equal((await call('GET', '/projects/not-a-uuid')).status, 400);
  assert.equal((await call('GET', `/projects/${hangerId}`)).json.project.name, 'the hanger');
});

test('a bind is a new revision of the phase\'s binding and refuses a phase outside the chain or a bad artifact', async () => {
  const first = await call('POST', `/projects/${hangerId}/bind`, { phase: 'design', artifact: { engine: 'cad-studio', kind: 'cad-models', modelIds: ['m1', 'm2'] } });
  assert.equal(first.status, 201); assert.equal(first.json.binding.revision, 1);
  const second = await call('POST', `/projects/${hangerId}/bind`, { phase: 'design', artifact: { engine: 'cad-studio', kind: 'cad-models', modelIds: ['m1'], read: { route: '/api/cad-studio/models', readAt: 'now', models: [{ modelId: 'm1', revision: 3, state: 'built' }] } } });
  assert.equal(second.json.binding.revision, 2); assert.equal(second.json.bindings.design.bindCount, 2); assert.deepEqual(second.json.bindings.design.artifact.modelIds, ['m1']);
  const outside = await call('POST', `/projects/${hangerId}/bind`, { phase: 'simulate', artifact: { engine: 'embodied', kind: 'gait' } });
  assert.equal(outside.status, 409); assert.equal(outside.json.error, 'phase_not_in_chain');
  const badEngine = await call('POST', `/projects/${hangerId}/bind`, { phase: 'design', artifact: { engine: 'circuit-lab', kind: 'x' } });
  assert.equal(badEngine.status, 400); assert.equal(badEngine.json.field, 'artifact.engine');
  assert.equal((await call('POST', `/projects/${hangerId}/bind`, { phase: 'thermal', artifact: {} })).json.error, 'unknown_phase');
});

test('a close is refused as missing_evidence without the evidence line OR the revision, missing_step on build, and recorded otherwise', async () => {
  const noEvidence = await call('POST', `/projects/${hangerId}/close`, { phase: 'design', revision: 'm1@r3' });
  assert.equal(noEvidence.status, 422); assert.equal(noEvidence.json.error, 'missing_evidence'); assert.equal(noEvidence.json.field, 'evidence');
  const noRevision = await call('POST', `/projects/${hangerId}/close`, { phase: 'design', evidence: 'parts-complete · 1 of 1 bound parts built' });
  assert.equal(noRevision.status, 422); assert.equal(noRevision.json.field, 'revision');
  const noStep = await call('POST', `/projects/${hangerId}/close`, { phase: 'build', evidence: 'ticked', revision: 'bench' });
  assert.equal(noStep.status, 422); assert.equal(noStep.json.error, 'missing_step');
  assert.equal((await call('POST', `/projects/${hangerId}/close`, { phase: 'simulate', evidence: 'x', revision: 'y' })).json.error, 'phase_not_in_chain');
  const ok = await call('POST', `/projects/${hangerId}/close`, { phase: 'design', evidence: 'parts-complete · 1 of 1 bound parts built', revision: 'm1@r3', by: 'design-partner' });
  assert.equal(ok.status, 201); assert.equal(ok.json.closure.phase, 'design'); assert.equal(ok.json.closure.closed_by, 'design-partner'); assert.equal(ok.json.closure.step, null);
  const step = await call('POST', `/projects/${hangerId}/close`, { phase: 'build', evidence: 'ticked on the bench: the hook', revision: 'bench', step: 'assemble:m1' });
  assert.equal(step.status, 201); assert.equal(step.json.closure.step, 'assemble:m1');
  const read = await call('GET', `/projects/${hangerId}`);
  assert.deepEqual(read.json.closures.map((c) => `${c.phase}:${c.step || '-'}`), ['design:-', 'build:assemble:m1']);
  assert.equal((await call('GET', '/projects')).json.projects.find((p) => p.id === hangerId).closedPhases, 1, 'a build step is not a closed phase');
});

test('the phase brief per kind carries the brief, the chain membership, the binding and the closures', async () => {
  const design = await call('GET', `/projects/${hangerId}/phase-brief/design`);
  assert.equal(design.status, 200); assert.equal(design.json.inChain, true); assert.equal(design.json.brief.kind, 'design'); assert.match(design.json.brief.closes, /parts-complete/);
  assert.equal(design.json.binding.revision, 2); assert.equal(design.json.closures.length, 1); assert.equal(design.json.productBrief.what, 'a clothes hanger');
  const simulate = await call('GET', `/projects/${hangerId}/phase-brief/simulate`);
  assert.equal(simulate.json.inChain, false); assert.equal(simulate.json.phase, null); assert.equal(simulate.json.binding, null);
  for (const kind of ['brief', 'mechanical', 'electrical', 'sensors', 'controller', 'fabricate', 'build']) { const r = await call('GET', `/projects/${spiderId}/phase-brief/${kind}`); assert.equal(r.status, 200, kind); assert.equal(r.json.brief.kind, kind); }
  assert.equal((await call('GET', `/projects/${hangerId}/phase-brief/thermal`)).status, 400);
});

test('the body contract is body_incomplete naming the reads it lacks, then publishes every value from the bound reads', async () => {
  const incomplete = await call('GET', `/projects/${spiderId}/body`);
  assert.equal(incomplete.status, 409); assert.equal(incomplete.json.error, 'body_incomplete');
  assert.deepEqual(incomplete.json.required, ['actuators: the simulate phase has no plant read (the MJCF joints and ranges)', 'plant.physicsDt: the simulate phase has no plant read (the MJCF timestep)', 'walker.policySha256: the simulate phase has no certificate read']);
  assert.equal(incomplete.json.body.node.kind, 'hexapod', 'the node kind is bound by name even before a read');
  const hanger = await call('GET', `/projects/${hangerId}/body`); assert.equal(hanger.status, 409);
  const F = require('./body-reads.fixture.js');
  for (const [phase, read] of Object.entries(F.reads)) {
    const bound = await call('GET', `/projects/${spiderId}`);
    const r = await call('POST', `/projects/${spiderId}/bind`, { phase, artifact: { ...bound.json.bindings[phase].artifact, read } });
    assert.equal(r.status, 201, phase);
  }
  const body = await call('GET', `/projects/${spiderId}/body`);
  assert.equal(body.status, 200, JSON.stringify(body.json));
  assert.equal(body.json.schema, 'design-studio-body/1'); assert.equal(body.json.project, spiderId); assert.equal(body.json.name, 'spider-18');
  assert.equal(body.json.revision, F.reads.design.revision);
  assert.equal(body.json.plant.physicsDt, F.reads.simulate.plant.physicsDt); assert.equal(body.json.plant.tickS, 1 / F.reads.controller.node.tickHz); assert.equal(body.json.plant.mjcf, F.reads.simulate.plant.route);
  assert.equal(body.json.actuators.length, F.reads.simulate.plant.joints.length);
  const femur = body.json.actuators.find((a) => a.joint === 'L2-femur');
  assert.deepEqual(femur.rangeRad, F.reads.simulate.plant.joints.find((j) => j.name === 'L2-femur').rangeRad);
  assert.equal(femur.continuousNm, F.reads.design.joints.find((j) => j.joint === 'femur').usableNm); assert.equal(femur.stallNm, F.reads.design.servo.stallNm);
  assert.equal(femur.noLoadRpm, Math.round(F.reads.design.servo.noLoadRadS * 60 / (2 * Math.PI) * 100) / 100);
  assert.equal(body.json.walker.policySha256, F.reads.simulate.certificate.policySha256); assert.equal(body.json.walker.kind, 'certified-gait'); assert.deepEqual(body.json.walker.command, ['vx', 'vy', 'vyaw']);
  assert.equal(body.json.node.endpoint, F.reads.controller.node.endpoint);
  assert.equal(body.json.senses.find((s) => s.name === 'lidar').mount, F.reads.sensors.senses[0].mount);
  assert.equal(body.json.senses.find((s) => s.name === 'joints').count, F.reads.sensors.senses[2].count);
  assert.deepEqual(body.json.senses.filter((s) => !s.present).map((s) => s.name), ['vision', 'audio', 'thermal', 'touch']);
  for (const m of body.json.missing) assert.match(m, /^senses\.\w+\.rateHz/, 'only the rates no engine stated are missing');
});

test('the Home summary counts products, phases and closures; delete removes the project with its rows', async () => {
  const home = await call('GET', '/home-summary');
  assert.equal(home.status, 200); assert.equal(home.json.partial, false);
  assert.deepEqual(home.json.metrics.map((m) => `${m.id}=${m.value}`), ['products-total=2', 'phases-total=14', 'phases-closed=1', 'build-steps-ticked=1']);
  assert.equal(home.json.items[0].text, 'spider-18', 'the newest change first'); assert.match(home.json.items[1].detail, /^1 of 5 phases closed/);
  const gone = await call('DELETE', `/projects/${hangerId}`); assert.equal(gone.status, 200); assert.equal(gone.json.deleted, hangerId);
  assert.equal((await call('GET', `/projects/${hangerId}`)).status, 404);
  assert.equal(pool.tables.design_closure.filter((c) => c.project_id === hangerId).length, 0, 'closures went with the project');
  assert.equal(pool.tables.design_binding.filter((c) => c.project_id === hangerId).length, 0, 'bindings went with the project');
  assert.equal((await call('GET', '/projects')).json.projects.length, 1);
});

const sha = (b) => createHash('sha256').update(b).digest('hex');
const MODEL = '7d1e2c3b-4a5f-4e6d-8c9b-0a1b2c3d4e5f';
const partMeta = (report = STL.boxReport()) => JSON.stringify({ source: { engine: 'cad-studio', modelId: MODEL, revision: 1, route: `/api/cad-studio/models/${MODEL}/artifacts/stl?revision=1`, title: 'plate' }, report });
const putPart = async (id, bytes, meta = partMeta()) => {
  const fd = new FormData(); fd.append('stl', new Blob([bytes], { type: 'model/stl' }), `${id}.stl`); fd.append('meta', meta);
  const res = await fetch(`${origin}/api/design-studio/projects/${spiderId}/print-set/parts/${id}`, { method: 'PUT', body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getFile = async (name, id = spiderId) => { const res = await fetch(`${origin}/api/design-studio/projects/${id}/print-set/${name}`); return { status: res.status, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', bytes: Buffer.from(await res.arrayBuffer()) }; };
const SET = { engine: 'embodied', designRevision: 'r7', designRoute: '/api/embodied/build/hexapod?fit=spider-18', parts: [{ id: 'plate', name: 'Body plate', qty: 2, material: 'PETG', printNotes: 'collars up', massEachG: 68, program: true }, { id: 'foot', name: 'Foot cap', qty: 6, material: 'TPU 95A', program: true }, { id: 'latch', name: 'Latch pawl', qty: 1, program: false }], bought: [{ id: 'servo', name: 'bus servo', qty: 18, massEachG: 55, approxUsdEach: 20, role: 'every joint' }] };

test('the print set: begun from the design rows, parts kept watertight or listed unprintable, finished with a manifest, served by name only', async () => {
  assert.equal((await call('GET', `/projects/${spiderId}/print-set`)).json.error, 'no_print_set');
  const bad = await call('POST', `/projects/${spiderId}/print-set`, { ...SET, engine: 'circuit-lab' }); assert.equal(bad.status, 400); assert.equal(bad.json.field, 'engine');
  const begun = await call('POST', `/projects/${spiderId}/print-set`, SET);
  assert.equal(begun.status, 201); assert.equal(begun.json.finished, false); assert.deepEqual(begun.json.pending, ['plate', 'foot', 'latch']); assert.equal(begun.json.name, 'spider-18');
  const box = STL.boxStl(20, 20, 10);
  const plate = await putPart('plate', box);
  assert.equal(plate.status, 200, JSON.stringify(plate.json)); assert.equal(plate.json.part.status, 'exported'); assert.equal(plate.json.part.sha256, sha(box)); assert.equal(plate.json.part.kernelMassEachG, 4.96); assert.deepEqual(plate.json.part.extentsMm, [20, 20, 10]);
  const foot = await putPart('foot', STL.openStl());
  assert.equal(foot.status, 200); assert.deepEqual(foot.json.part, { status: 'unprintable', reason: 'the exported STL is not watertight: 3 open edges' });
  const noMeta = await putPart('foot', box, '{"source":{}}'); assert.equal(noMeta.status, 400); assert.equal(noMeta.json.field, 'meta');
  const latch = await call('PUT', `/projects/${spiderId}/print-set/parts/latch`, { reason: 'no CAD program in the design for this part' });
  assert.equal(latch.status, 200); assert.equal(latch.json.part.status, 'unprintable');
  assert.equal((await putPart('head', box)).json.error, 'part_not_in_set');
  assert.equal((await call('PUT', `/projects/${spiderId}/print-set/parts/latch`, {})).json.field, 'reason');
  const big = await putPart('foot', Buffer.alloc(8 * 1024 * 1024 + 1)); assert.equal(big.status, 413); assert.equal(big.json.error, 'stl_too_large');
  const incomplete = await call('POST', `/projects/${spiderId}/print-set/finish`);
  assert.equal(incomplete.status, 200, 'foot has a reason (unprintable) and latch has one, so nothing is unaccounted');
  assert.equal(incomplete.json.finished, true); assert.match(incomplete.json.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(incomplete.json.manifest.parts.map((p) => p.file), ['plate.stl']);
  assert.deepEqual(incomplete.json.manifest.unprintable.map((u) => `${u.id}: ${u.reason}`), ['foot: the exported STL is not watertight: 3 open edges', 'latch: no CAD program in the design for this part']);
  const listed = await call('GET', `/projects/${spiderId}/print-set`); assert.equal(listed.json.manifestSha256, incomplete.json.manifestSha256); assert.equal(listed.json.exported, 1);
  const stl = await getFile('plate.stl'); assert.equal(stl.status, 200); assert.match(stl.type, /^model\/stl/); assert.ok(stl.bytes.equals(box)); assert.equal(stl.disposition, 'attachment; filename="spider-18-plate.stl"');
  const sheet = await getFile('PRINT-SHEET.md'); assert.equal(sheet.status, 200); assert.match(sheet.type, /text\/markdown/); assert.match(sheet.bytes.toString(), /^# spider-18 print set \(design revision r7/);
  const bom = await getFile('bom.csv'); assert.match(bom.type, /text\/csv/); assert.match(bom.bytes.toString(), /\nservo,bought,bus servo,18,55,990,20,360,,every joint,,\n/);
  const manifest = await getFile('manifest.json'); assert.match(manifest.type, /application\/json/); assert.equal(sha(manifest.bytes), incomplete.json.manifestSha256, 'the served manifest is the file the sha names');
  assert.equal((await getFile('foot.stl')).status, 404, 'an unprintable part has no file');
  assert.equal((await getFile('set.json')).status, 404, 'the state file is never served');
  assert.equal((await getFile('..%2Fset.json')).status, 404); assert.equal((await getFile('%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status, 404);
  who = OTHER;
  assert.equal((await call('GET', `/projects/${spiderId}/print-set`)).status, 404); assert.equal((await getFile('plate.stl')).status, 404);
  who = SUB;
  const sent = await call('POST', `/projects/${spiderId}/print-set/sent`, { file: 'plate.stl', printerId: 'prn-1', printerLabel: 'Bench P1S', submissionId: 'sub-1', uploaded: true, started: false, message: 'waits on the printer' });
  assert.equal(sent.status, 201); assert.equal(sent.json.sent[0].file, 'plate.stl');
  assert.equal((await call('POST', `/projects/${spiderId}/print-set/sent`, { file: 'foot.stl', printerId: 'prn-1' })).json.field, 'file');
  assert.equal((await call('GET', `/projects/${spiderId}/print-set`)).json.sent.length, 1);
  const again = await call('POST', `/projects/${spiderId}/print-set`, SET); assert.equal(again.status, 201); assert.equal(again.json.finished, false);
  assert.equal((await getFile('plate.stl')).status, 404, 'begin wipes the set');
  const blocked = await call('POST', `/projects/${spiderId}/print-set/finish`); assert.equal(blocked.status, 409); assert.equal(blocked.json.error, 'set_incomplete'); assert.match(blocked.json.message, /missing: plate, foot$/);
  assert.equal((await call('POST', `/projects/${spiderId}/print-set/sent`, { file: 'plate.stl', printerId: 'prn-1' })).json.error, 'no_print_set');
});

test('the mechanism: 404 before a save with the brief\'s task, refused by name against the bound parts, saved as revisions, read with the project; the lift example carries its own', async () => {
  const made = await call('POST', '/projects', HANGER); const hangerId = made.json.project.id;
  assert.equal((await call('POST', `/projects/${hangerId}/bind`, { phase: 'design', artifact: { engine: 'cad-studio', kind: 'cad-models', modelIds: ['m1'] } })).status, 201);
  const spiderId = (await call('POST', '/projects', { example: 'spider-18' })).json.project.id;
  const none = await call('GET', `/projects/${hangerId}/mechanism`);
  assert.equal(none.status, 404); assert.equal(none.json.error, 'no_mechanism'); assert.equal(none.json.briefTask, null, 'the hanger\'s lines name no lift');
  // The hanger is bound to the CAD Studio model m1: a joint naming another part is refused against that binding.
  const hook = { parts: [{ id: 'm1', name: 'Hook' }, { id: 'peg' }], base: 'm1', joints: [{ id: 'j', parent: 'm1', child: 'peg', type: 'hinge', axis: [0, 1, 0], rangeRad: [-1, 1] }], motors: [], payload: null };
  const unbound = await call('PUT', `/projects/${hangerId}/mechanism`, { mechanism: hook });
  assert.equal(unbound.status, 422); assert.equal(unbound.json.error, 'part_not_bound'); assert.match(unbound.json.message, /peg is not among the Design phase's bound parts \(m1\)/);
  const one = { parts: [{ id: 'm1', name: 'Hook' }], base: 'm1', joints: [], motors: [], payload: null };
  const first = await call('PUT', `/projects/${hangerId}/mechanism`, { mechanism: one });
  assert.equal(first.status, 201); assert.equal(first.json.revision, 1); assert.deepEqual(first.json.mechanism.parts, [{ id: 'm1', name: 'Hook', modelId: null }]); assert.equal(first.json.mechanism.task, null);
  const second = await call('PUT', `/projects/${hangerId}/mechanism`, { mechanism: { ...one, payload: { massKg: 0.5, attachedTo: 'm1' } } });
  assert.equal(second.status, 200); assert.equal(second.json.revision, 2); assert.equal(second.json.mechanism.payload.massKg, 0.5);
  const read = await call('GET', `/projects/${hangerId}`);
  assert.equal(read.json.mechanism.revision, 2); assert.equal(read.json.mechanism.payload.attachedTo, 'm1'); assert.ok(read.json.mechanism.savedAt);
  for (const [mechanism, error, field] of [[{ ...one, base: 'nope' }, 'part_not_bound', 'base'], [{ ...one, joints: [{ id: 'j', parent: 'm1', child: 'm1', type: 'fixed' }] }, 'cycle', 'joints[0]'], [{ ...one, joints: [{ id: 'j', parent: 'm1', child: 'm1', type: 'rail' }] }, 'cycle', 'joints[0]'], [{ ...one, motors: [{ rowId: 'x', source: 'ebay' }] }, 'bad_mechanism', 'motors[0].source'], [{ ...one, task: { deltaMm: [0, 0, 0], timeS: 1 } }, 'bad_mechanism', 'task.deltaMm'], ['x', 'bad_mechanism', 'mechanism']]) {
    const r = await call('PUT', `/projects/${hangerId}/mechanism`, { mechanism });
    assert.equal(r.json.error, error, JSON.stringify(mechanism)); assert.equal(r.json.field, field);
  }
  who = OTHER;
  assert.equal((await call('GET', `/projects/${hangerId}/mechanism`)).status, 404, 'another subject sees no project, hence no mechanism');
  who = SUB;
  // The lift example: seven phases, two bindings by name, the mechanism with the task read from the brief's line.
  const lift = await call('POST', '/projects', { example: 'lift-1' });
  assert.equal(lift.status, 201); const liftId = lift.json.project.id;
  assert.deepEqual(lift.json.project.phases.map((p) => p.kind), ['brief', 'design', 'mechanical', 'electrical', 'simulate', 'fabricate', 'build']);
  assert.deepEqual(Object.keys(lift.json.bindings).sort(), ['design', 'simulate']); assert.equal(lift.json.bindings.design.artifact.kind, 'cad-programs'); assert.equal(lift.json.bindings.design.artifact.parts.length, 3); assert.equal(lift.json.bindings.simulate.artifact.kind, 'plant');
  assert.equal(lift.json.mechanism.revision, 1); assert.deepEqual(lift.json.mechanism.task, { line: 'lifts 2 kg to 300 mm in 5 s', deltaMm: [0, 0, 300], timeS: 5, loadKg: 2 });
  assert.deepEqual(lift.json.mechanism.joints.map((j) => `${j.id}:${j.type}:${j.drivenBy || '-'}`), ['column-mount:fixed:-', 'carriage-slide:slide:sts3215-12v']);
  const got = await call('GET', `/projects/${liftId}/mechanism`);
  assert.equal(got.status, 200); assert.equal(got.json.briefTask.loadKg, 2); assert.equal(got.json.mechanism.payload.massKg, 2);
  // A saved mechanism keeps the brief's task when the body states none, and is held to the example's bound part ids.
  const resave = await call('PUT', `/projects/${liftId}/mechanism`, { mechanism: { ...got.json.mechanism, task: undefined } });
  assert.equal(resave.status, 200); assert.equal(resave.json.revision, 2); assert.equal(resave.json.mechanism.task.timeS, 5);
  const stray = await call('PUT', `/projects/${liftId}/mechanism`, { mechanism: { ...got.json.mechanism, parts: [...got.json.mechanism.parts, { id: 'winch' }], joints: [...got.json.mechanism.joints, { id: 'w', parent: 'base', child: 'winch', type: 'fixed' }] } });
  assert.equal(stray.status, 422); assert.equal(stray.json.error, 'part_not_bound');
  const noMotor = await call('PUT', `/projects/${liftId}/mechanism`, { mechanism: { ...got.json.mechanism, motors: [] } });
  assert.equal(noMotor.status, 422); assert.equal(noMotor.json.error, 'unknown_motor');
  // The plant spec is composed from the mechanism and the reads the page sends.
  const parts = [{ id: 'base', massG: 496, extentsMm: [200, 200, 10], route: '/api/cad-studio/models', readAt: 'now', revision: 1 }, { id: 'column', massG: 794, extentsMm: [40, 40, 400] }, { id: 'carriage', massG: 150, extentsMm: [80, 60, 40] }];
  const motors = [{ rowId: 'sts3215-12v', source: 'embodied', name: 'fixture servo', stallNm: 2.942, noLoadRadS: 4.7166, continuousNm: 1.471, route: '/api/embodied/build/catalog', readAt: 'now' }];
  assert.equal((await call('POST', `/projects/${hangerId}/plant-spec`, { parts: [{ id: 'm1', massG: 7, extentsMm: [30, 20, 10] }], motors })).json.spec.parts.length, 1, 'the hanger has a one-part mechanism');
  const spec = await call('POST', `/projects/${liftId}/plant-spec`, { parts, motors });
  assert.equal(spec.status, 200); assert.equal(spec.json.revision, 2);
  assert.equal(spec.json.spec.parts[1].massKg, 0.794); assert.deepEqual(spec.json.spec.joints[1].range, [0, 0.35]); assert.deepEqual(spec.json.spec.actuators[0].row.id, 'sts3215-12v'); assert.equal(spec.json.spec.actuators[0].gearRatio, 40);
  assert.deepEqual(spec.json.spec.task, { deltaM: [0, 0, 0.3], timeS: 5, loadKg: 2, line: 'lifts 2 kg to 300 mm in 5 s' }); assert.deepEqual(spec.json.spec.payload, { massKg: 2, attachedTo: 'carriage' });
  const unread = await call('POST', `/projects/${liftId}/plant-spec`, { parts: parts.slice(1), motors }); assert.equal(unread.status, 422); assert.equal(unread.json.error, 'part_not_read');
  const unrow = await call('POST', `/projects/${liftId}/plant-spec`, { parts, motors: [] }); assert.equal(unrow.status, 422); assert.equal(unrow.json.error, 'motor_not_read');
  assert.equal((await call('POST', `/projects/${spiderId}/plant-spec`, { parts, motors })).json.error, 'no_mechanism', 'the spider has no mechanism of its own');
  // The body contract of the lift from a generated plant's read: the one actuator from the row, the certified reach policy, the plant route as the node.
  const plant = { kind: 'plant', route: '/api/embodied/physics/plant', readAt: 'now', physicsDt: 0.002, controlDtS: 0.02, specSha256: 'spec-1', actuators: [{ joint: 'carriage-slide', type: 'slide', range: [0, 0.35], stallNm: 2.942, noLoadRadS: 4.7166, gearRatio: 40, continuousNm: 1.471, unit: 'N', row: { id: 'sts3215-12v', source: 'embodied' } }], senses: [{ name: 'joints', present: true, count: 1, rateHz: 50 }, { name: 'imu', present: true, rateHz: 50 }, { name: 'payload', present: true, rateHz: 50 }] };
  const bind = await call('POST', `/projects/${liftId}/bind`, { phase: 'simulate', artifact: { engine: 'embodied', kind: 'plant', read: { route: '/api/embodied/physics/reports', readAt: 'now', plant, certificate: { file: 'plant-x.certificate.json', policySha256: 'sha-lift', ok: true, checked: 1875, refusedCount: 0 } } } });
  assert.equal(bind.status, 201); assert.equal(bind.json.binding.revision, 2);
  const body = await call('GET', `/projects/${liftId}/body`);
  assert.equal(body.status, 200, JSON.stringify(body.json));
  assert.deepEqual(body.json.actuators, [{ joint: 'carriage-slide', rangeRad: [0, 0.35], unit: 'm', type: 'slide', continuousNm: 1.471, stallNm: 2.942, noLoadRpm: 45.04, gearRatio: 40 }]);
  assert.equal(body.json.walker.kind, 'certified-policy'); assert.deepEqual(body.json.walker.command, ['payloadTargetM']); assert.equal(body.json.walker.door, 'plant.step {command}');
  assert.deepEqual(body.json.node, { kind: 'plant', endpoint: '/api/embodied/physics/plant' }); assert.equal(body.json.plant.tickS, 0.02); assert.equal(body.json.plant.kind, 'plant');
  assert.equal(body.json.senses.find((s) => s.name === 'payload').present, true);
  assert.equal((await call('DELETE', `/projects/${liftId}`)).status, 200);
  assert.equal(pool.tables.design_mechanism.filter((r) => r.project_id === liftId).length, 0, 'the mechanism row goes with the project');
});

test('an engine order: refused by name outside the vocabulary, 202 with no page open, claimed once, and the engine\'s reply comes back', async () => {
  const created = await call('POST', '/projects', { example: 'lift-1' });
  const id = created.json.project.id;
  for (const [body, field] of [[{ action: 'shell', input: {} }, 'action'], [{ action: 'read', input: { what: '/etc/passwd' } }, 'input.what'], [{ action: 'cad-model', input: {} }, 'action'], [{ action: 'press', input: { phase: 'build', button: 'Close the phase' } }, 'input.button'], [{ action: 'cad-edit', input: { modelId: '../x', op: 'add', feature: {} } }, 'input.modelId']]) {
    const r = await call('POST', `/projects/${id}/orders`, body);
    assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error, 'bad_order'); assert.equal(r.json.field, field);
  }
  const waiting = await call('POST', `/projects/${id}/orders`, { action: 'read', input: { what: 'cad-models' }, waitMs: 50, claimWaitMs: 0 });
  assert.equal(waiting.status, 202); assert.equal(waiting.json.order.status, 'pending'); assert.match(waiting.json.note, /product page is not open/);
  const orderId = waiting.json.order.id;
  const pending = await call('GET', '/orders/pending');
  assert.deepEqual(pending.json.orders.map((o) => o.id), [orderId]);
  who = OTHER;
  assert.equal((await call('GET', '/orders/pending')).json.orders.length, 0, 'another person sees none of them');
  assert.equal((await call('POST', `/orders/${orderId}/claim`, {})).status, 409, 'nor can they take one');
  assert.equal((await call('GET', `/projects/${id}/orders/${orderId}`)).status, 404);
  who = SUB;
  assert.equal((await call('POST', `/orders/${orderId}/finish`, { ok: true, result: {} })).status, 404, 'a pending order is not finished without a claim');
  const claimed = await call('POST', `/orders/${orderId}/claim`, {});
  assert.equal(claimed.status, 200); assert.equal(claimed.json.order.status, 'running');
  assert.equal((await call('POST', `/orders/${orderId}/claim`, {})).status, 409, 'a second tab cannot run it again');
  assert.equal((await call('GET', '/orders/pending')).json.orders.length, 0);
  const finished = await call('POST', `/orders/${orderId}/finish`, { ok: true, result: { route: '/api/cad-studio/models', reply: { models: [] } } });
  assert.equal(finished.json.order.status, 'done');
  const read = await call('GET', `/projects/${id}/orders/${orderId}`);
  assert.deepEqual(read.json.order.result.reply, { models: [] });
  // A waiting file returns the finished reply when the page finishes inside the wait.
  const filing = call('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'simulate', button: 'Build the plant' }, waitMs: 8000, claimWaitMs: 8000 });
  let order = null; for (let i = 0; i < 40 && !order; i += 1) { order = (await call('GET', '/orders/pending')).json.orders[0] || null; if (!order) await new Promise((r) => setTimeout(r, 50)); }
  await call('POST', `/orders/${order.id}/claim`, {}); await call('POST', `/orders/${order.id}/finish`, { ok: false, result: { refused: 'no such button' } });
  const done = await filing;
  assert.equal(done.status, 201); assert.equal(done.json.order.status, 'failed'); assert.equal(done.json.order.result.refused, 'no such button');
  assert.equal((await call('DELETE', `/projects/${id}`)).status < 300, true);
});
