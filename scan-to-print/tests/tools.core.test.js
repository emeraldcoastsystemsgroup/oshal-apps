/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.7.0: the print service's package tools (BACKLOG B18) as the kernel runs them. The person's route factory registers exactly the manifest's five tools and the `scan` resource adapter on the activation ports; each handler is called the way core's package-tool registry calls it, inside the real core request identity for the verified actor (src/shared/package-tools/index.ts), against the shared HTTP fixture's store, a fake Bambu printer on real local TLS and a slicer bridge speaking the real line protocol. Without an active verified actor every tool refuses before any query; reads answer as that actor and never carry a printer secret; inputs are closed; a print with auto-start off uploads and records requested_by service, with auto-start on it starts; a print holds the job's lock and refuses a stale model, an unknown printer and a busy job.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { startFixture, json, readyJob, coreRequire } = require('./routes-core.fixture.js');
const { startFakePrinter } = require('./bambu-fake-printer.cjs');
const { readManifest } = require('./catalog.fixture.cjs');

coreRequire('tsx/cjs');
const identityModule = coreRequire(path.join(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR, 'src/shared/services/database/request-identity.ts'));
const { slicerEngineBuildHash } = require(path.join(__dirname, '..', 'routes/printing/slicer-engine.js'));
const { claimJobOperation } = require(path.join(__dirname, '..', 'routes/job-outputs.js'));
const ENGINE_HASH = slicerEngineBuildHash(path.join(__dirname, '..', 'engine'));
const ARCHIVE = Buffer.from('PK\x03\x04 sliced for the printer');

/** A slicer bridge speaking the real protocol (hello, then one JSON line per request). */
async function startSlicer() {
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: ENGINE_HASH } }) + '\n');
    let buf = '';
    socket.on('data', (c) => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        const result = { fileName: 'x.gcode.3mf', archive: ARCHIVE.toString('base64'), estimate: { printSeconds: 1208, firstLayerSeconds: 313, filamentGrams: 3.8 }, profile: { modelId: req.args.modelId, plate: 'Textured PEI Plate', filamentType: 'PLA' } };
        socket.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { connect: () => net.connect({ host: '127.0.0.1', port }), close: () => new Promise((r) => server.close(r)) };
}

/** The fixture with the kernel's activation ports recorded, plus `run`, which calls a tool the way core does. */
async function toolWorld(printerOpts = {}) {
  const printer = await startFakePrinter(printerOpts);
  const slicer = await startSlicer();
  const tools = new Map(), resources = new Map(), box = { actor: undefined };
  const ctx = {
    tools: { register(name, handler) { if (tools.has(name)) throw new Error(`duplicate tool ${name}`); tools.set(name, handler); } },
    authorization: { registerResource(name, adapter) { resources.set(name, adapter); }, currentActor: () => box.actor },
  };
  const f = await startFixture({ identityModule, slicerConnect: slicer.connect, bambuIo: { connect: printer.connect, connectTcp: printer.connectTcp, statusTimeoutMs: 4000, startTimeoutMs: 4000 }, ctx });
  const actor = { sub: f.control.sub, issuer: f.control.issuer, isActive: true };
  const run = (name, input) => {
    box.actor = actor;
    return identityModule.runWithRequestIdentity({ sub: actor.sub, principalIssuer: actor.issuer, isOperator: false }, () => tools.get(name)(input));
  };
  return { f, printer, tools, resources, box, actor, run, async close() { await f.close(); await printer.close(); await slicer.close(); } };
}

async function addBambu(w) {
  const res = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'Workshop P2S', host: w.printer.host, accessCode: w.printer.printer.accessCode }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.printer;
}

const projectFiles = (w) => w.printer.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file');

test('the route factory registers exactly the manifest tools and the scan resource; the adapter admits only an active actor', async () => {
  const w = await toolWorld();
  try {
    assert.deepEqual([...w.tools.keys()], readManifest().tools, 'one handler per manifest tool, in manifest order');
    assert.deepEqual([...w.resources.keys()], ['scan']);
    assert.equal(await w.resources.get('scan').authorize({ actor: { isActive: true } }), true);
    assert.equal(await w.resources.get('scan').authorize({ actor: { isActive: false } }), false);
  } finally { await w.close(); }
});

test('without an active verified actor every tool refuses before any query', async () => {
  const w = await toolWorld();
  try {
    const before = w.f.control.identityQueries.length;
    const inputs = { 'print-service-printer-status': { printerId: '00000000-0000-4000-8000-000000000000' }, 'print-to-3d-printer': { jobId: '00000000-0000-4000-8000-000000000000' } };
    for (const actor of [undefined, { ...w.actor, isActive: false }, { ...w.actor, issuer: '' }, { ...w.actor, sub: '' }]) {
      w.box.actor = actor;
      for (const [name, handler] of w.tools) await assert.rejects(handler(inputs[name] ?? {}), /signed_in_owner_required/, `${name} with ${JSON.stringify(actor)}`);
    }
    assert.equal(w.f.control.identityQueries.length, before, 'nothing was queried');
  } finally { await w.close(); }
});

test('reads answer as the actor and never carry a printer secret', async () => {
  const w = await toolWorld({ signatureRequired: false });
  try {
    const p = await addBambu(w);
    const job = await readyJob(w.f);
    w.f.control.identityQueries.length = 0;
    const printers = await w.run('print-service-printers', {});
    assert.deepEqual(printers.printers.map((x) => [x.printerId, x.label, x.kind, x.autoStart]), [[p.printer_id, 'Workshop P2S', 'bambu-lan', false]]);
    assert.doesNotMatch(JSON.stringify(printers), new RegExp(w.printer.printer.accessCode), 'no access code');
    const jobs = await w.run('print-service-jobs', undefined);
    assert.deepEqual(jobs.jobs.filter((j) => j.jobId === job.id).map((j) => j.printable), [true]);
    const status = await w.run('print-service-printer-status', { printerId: p.printer_id });
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.status.detail.signatureRequired, false);
    assert.deepEqual(await w.run('scan-to-print-capabilities', {}), (await w.f.call('/capabilities')).body, 'the same document GET /capabilities answers');
    assert.ok(w.f.control.identityQueries.length > 0);
    assert.deepEqual([...new Set(w.f.control.identityQueries.map((q) => q.identity && q.identity.sub))], ['alice'], 'every query ran as the actor');
  } finally { await w.close(); }
});

test('inputs are closed: unknown fields, missing ids, non-strings and malformed ids are refused', async () => {
  const w = await toolWorld();
  try {
    await assert.rejects(w.run('print-service-printers', { printerId: 'x' }), /invalid_tool_input: print-service-printers does not take printerId/);
    await assert.rejects(w.run('print-service-jobs', []), /invalid_tool_input/);
    await assert.rejects(w.run('print-to-3d-printer', {}), /invalid_tool_input: print-to-3d-printer needs jobId/);
    await assert.rejects(w.run('print-to-3d-printer', { jobId: 7 }), /invalid_tool_input: jobId must be a string/);
    await assert.rejects(w.run('print-service-printer-status', { printerId: 'not-a-uuid' }), /invalid_tool_input/);
    await assert.rejects(w.run('print-to-3d-printer', { jobId: '00000000-0000-4000-8000-000000000000', start: true }), /does not take start/, 'an agent cannot ask to force a start');
  } finally { await w.close(); }
});

test('with auto-start off a print uploads, does not start, and is recorded as a service request', async () => {
  const w = await toolWorld({ signatureRequired: false, status: { gcode_state: 'FINISH' } });
  try {
    await addBambu(w);
    const job = await readyJob(w.f);
    const out = await w.run('print-to-3d-printer', { jobId: job.id });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.status, 201);
    assert.equal(out.outcome.uploaded, true);
    assert.equal(out.outcome.started, false);
    assert.match(out.outcome.message, /Auto-start is off for this printer/);
    assert.equal(out.submission.requested_by, 'service');
    assert.equal(out.printer.autoStart, false);
    assert.equal(projectFiles(w).length, 0, 'no start command reached the printer');
  } finally { await w.close(); }
});

test('with auto-start on the print starts', async () => {
  const w = await toolWorld({ signatureRequired: false, status: { gcode_state: 'FINISH' } });
  try {
    const p = await addBambu(w);
    assert.equal((await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }))).status, 200);
    const job = await readyJob(w.f);
    const out = await w.run('print-to-3d-printer', { jobId: job.id, printerId: p.printer_id });
    assert.equal(out.outcome.started, true, out.outcome.message);
    assert.equal(projectFiles(w).length, 1);
  } finally { await w.close(); }
});

test('a print holds the job lock and refuses a busy job, a stale model and an unknown printer', async () => {
  const w = await toolWorld({ signatureRequired: false });
  try {
    await addBambu(w);
    const job = await readyJob(w.f);
    const claim = claimJobOperation({ pool: w.f.pool, dataRoot: w.f.tmp }, 'alice', job.id, 'read');
    assert.ok(claim.release, 'the test holds a reader');
    try {
      const busy = await w.run('print-to-3d-printer', { jobId: job.id });
      assert.deepEqual([busy.ok, busy.status, busy.error], [false, 409, 'job_busy']);
    } finally { claim.release(); }
    const created = await w.f.call('/jobs', json('POST', { title: 'Not yet built' }));
    const stale = await w.run('print-to-3d-printer', { jobId: created.body.job.job_id });
    assert.deepEqual([stale.ok, stale.status, stale.error], [false, 409, 'output_stale']);
    const unknown = await w.run('print-to-3d-printer', { jobId: job.id, printerId: '00000000-0000-4000-8000-000000000000' });
    assert.deepEqual([unknown.ok, unknown.status, unknown.error], [false, 404, 'printer_not_found']);
    assert.equal(projectFiles(w).length, 0);
  } finally { await w.close(); }
});
