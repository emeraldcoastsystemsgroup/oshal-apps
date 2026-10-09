/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 5 | maintainer@emeraldcoastsystemsgroup.com | A failed posted-model print (POST /service/print) answers with error, message and installHint at the top level, the same shape as a job print.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Third review: with auto-start off — against the vendor-default printer that requires signed commands, and a busy one — the reply says auto-start is off, no failure is recorded and the printer's broker is never contacted for a start; an HTTP host's job says the same; a failed print answers with its reason at the top level; per-attempt names carry 48 random bits.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Second review: posted G-code reaches an HTTP host but is never auto-started; an auto-start that cannot be read starts nothing and the attempt is still recorded; a printer host name that resolves to loopback is refused before anything is dialled; every print of a job gets its own name on the printer (a long title keeps the job id); replies carry the auto-start value as it stands after the attempt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review fixes, each with its guard: registration pins the printer's certificate and refuses numeric loopback hosts; auto-start is re-read when the start would be sent (switching it off while the slicer runs stops the start); a sliced archive posted as is is never auto-started while a posted STL is; posted models get unique names and are recorded as the .gcode.3mf actually sent; plain uploads record no failure_reason; GET /service/jobs lists printable jobs; a busy slicer is reported busy, without reinstall advice.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The print service and Bambu Lab printers over the package's real routes (the shared HTTP fixture, the real core request-identity module, a fake printer on real local TLS, a slicer bridge speaking the real line protocol). Registration reads identity from the certificate and proves the access code before storing it encrypted; auto-start is an owner setting that needs confirmation and that no service caller can reach; a service call needs the secret AND a user, runs every query as that user (never operator), sees only that user's printers; a job or a posted model is sliced for the printer, uploaded, and started ONLY when the owner turned auto-start on and the printer allows it; a stale or stopped slicer engine refuses with the install command before anything reaches the printer.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { startFixture, json, readyJob, coreRequire } = require('./routes-core.fixture.js');
const { startFakePrinter } = require('./bambu-fake-printer.cjs');

coreRequire('tsx/cjs');
const identityModule = coreRequire(path.join(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR, 'src/shared/services/database/request-identity.ts'));
const { slicerEngineBuildHash } = require(path.join(__dirname, '..', 'routes/printing/slicer-engine.js'));
const ENGINE_HASH = slicerEngineBuildHash(path.join(__dirname, '..', 'engine'));
const ARCHIVE = Buffer.from('PK\x03\x04 sliced for the printer');

/** A slicer bridge speaking the real protocol; `hash` decides whether the client accepts it, `busy`
 * answers like a bridge with no free slot, `beforeAnswer` runs (and is awaited) before a slice answer. */
async function startSlicer(hash = ENGINE_HASH, opts = {}) {
  const seen = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    if (opts.busy) { socket.end(JSON.stringify({ id: null, ok: false, error: { code: 'engine_busy', message: 'engine container has no free worker slot' } }) + '\n'); return; }
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: hash } }) + '\n');
    let buf = '';
    socket.on('data', (c) => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); seen.push(req);
        const result = req.cmd === 'profiles'
          ? { printers: [{ modelId: 'N7', printerModel: 'Bambu Lab P2S', defaultPlate: 'Textured PEI Plate', nozzles: ['0.4'], filaments: ['Bambu PLA Basic'] }], plates: ['Textured PEI Plate'] }
          : { fileName: 'x.gcode.3mf', archive: ARCHIVE.toString('base64'), estimate: { printSeconds: 1208, firstLayerSeconds: 313, filamentGrams: 3.8 }, profile: { modelId: req.args.modelId, plate: req.args.plate || 'Textured PEI Plate', filamentType: 'PLA' } };
        Promise.resolve(req.cmd === 'slice' && opts.beforeAnswer ? opts.beforeAnswer() : null)
          .then(() => socket.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n'));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { seen, connect: () => net.connect({ host: '127.0.0.1', port }), close: () => new Promise((r) => server.close(r)) };
}

/** Fixture + fake printer + slicer, torn down together. */
async function world(printerOpts = {}, slicerHash, slicerOpts = {}, ioExtra = {}) {
  const printer = await startFakePrinter(printerOpts);
  const slicer = await startSlicer(slicerHash, slicerOpts);
  const f = await startFixture({ identityModule, slicerConnect: slicer.connect, bambuIo: { connect: printer.connect, connectTcp: printer.connectTcp, statusTimeoutMs: 4000, startTimeoutMs: 4000, ...ioExtra } });
  return { f, printer, slicer, async close() { await f.close(); await printer.close(); await slicer.close(); } };
}

async function addBambu(w, overrides = {}) {
  const res = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'Workshop P2S', host: w.printer.host, accessCode: w.printer.printer.accessCode, ...overrides }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.printer;
}

const projectFiles = (w) => w.printer.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file');

test('a Bambu printer is registered from its address and access code; identity comes from its certificate', async () => {
  const w = await world();
  try {
    const p = await addBambu(w);
    assert.equal(p.kind, 'bambu-lan');
    assert.equal(p.base_url, 'bambu://192.168.1.250');
    assert.equal(p.device_serial, '01S00FAKE000001');
    assert.equal(p.device_model, 'N7');
    assert.equal(p.device_cert_sha256, w.printer.printer.certSha256, 'the printer certificate is pinned');
    assert.equal(p.auto_start, false, 'registration never grants auto-start');
    assert.deepEqual(p.slice_profile, { nozzle: '0.4' }, 'the nozzle the printer reports');
    assert.equal(p.api_key_ciphertext, undefined);
    const stored = w.f.pool.tables.scan_print_printer[0];
    assert.match(stored.api_key_ciphertext, /^enc:v1:/);
    assert.ok(!stored.api_key_ciphertext.includes(w.printer.printer.accessCode), 'the access code is never stored in plain text');
    const wrong = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'x', host: w.printer.host, accessCode: 'nope9999' }));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /refused the LAN access code/);
    const badHost = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'x', host: 'http://127.0.0.1', accessCode: 'fake1234' }));
    assert.equal(badHost.status, 400);
    const numericLoopback = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'x', host: '2130706433', accessCode: 'fake1234' }));
    assert.equal(numericLoopback.status, 400);
    assert.match(numericLoopback.body.message, /loopback/);
    assert.equal(w.f.pool.tables.scan_print_printer.length, 1, 'refused registrations store nothing');
  } finally { await w.close(); }
});

test('auto-start is the owner\'s setting, needs explicit confirmation, and no service caller can change it', async () => {
  const w = await world();
  try {
    const p = await addBambu(w);
    const unconfirmed = await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true }));
    assert.equal(unconfirmed.status, 428);
    assert.equal(w.f.pool.tables.scan_print_printer[0].auto_start, false);
    // The service mount has no settings route; the request falls through to the OIDC-only mount, whose
    // requiresAuth answers any API request without a session 401 (core oidc.ts createRequiresAuthWrapper).
    const viaService = await w.f.service(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    assert.equal(viaService.status, 401);
    const direct = await fetch(`${w.f.base}/printers/${p.printer_id}`, { ...json('PATCH', { autoStart: true, confirm: true }), headers: { 'Content-Type': 'application/json', 'X-Service-Secret': w.f.serviceSecret, 'X-Oshal-User-Sub': 'alice' } });
    assert.equal(direct.status, 401, 'a service caller cannot reach the owner settings route directly either');
    assert.equal(w.f.pool.tables.scan_print_printer[0].auto_start, false);
    const on = await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    assert.equal(on.status, 200);
    assert.equal(on.body.printer.auto_start, true);
    const plate = await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { sliceProfile: { plate: 'Glass Plate' } }));
    assert.equal(plate.status, 400);
    const off = await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: false, sliceProfile: { plate: 'Textured PEI Plate', filament: 'Bambu PLA Matte' } }));
    assert.equal(off.status, 200, 'turning auto-start off needs no confirmation');
    assert.equal(off.body.printer.auto_start, false);
    assert.deepEqual(off.body.printer.slice_profile, { plate: 'Textured PEI Plate', filament: 'Bambu PLA Matte' });
    w.f.control.sub = 'mallory';
    const foreign = await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    assert.equal(foreign.status, 404);
  } finally { await w.close(); }
});

test('the service needs the secret and a user (or a session), runs as that user, and sees only that user\'s printers', async () => {
  const w = await world();
  try {
    await addBambu(w);
    const withUser = await w.f.service('/printers');
    assert.equal(withUser.status, 200);
    assert.deepEqual(Object.keys(withUser.body.printers[0]).sort(), ['autoStart', 'kind', 'label', 'model', 'printerId', 'sliceProfile']);
    assert.ok(w.f.control.identityQueries.length > 0);
    for (const q of w.f.control.identityQueries) assert.deepEqual(q.identity, { sub: 'alice', principalIssuer: 'https://scan-fixture.invalid', isOperator: false });
    const noUser = await w.f.service('/printers', {}, null);
    assert.equal(noUser.status, 403);
    const sub = w.f.control.sub;
    w.f.control.sub = null;
    assert.equal((await w.f.call('/service/printers')).status, 401, 'no secret and no session');
    w.f.control.sub = sub;
    const session = await w.f.call('/service/printers');
    assert.equal(session.status, 200, 'a signed-in person can use the service too');
  } finally { await w.close(); }
});

test('a job sent by the service is sliced and uploaded but NOT started while auto-start is off', async () => {
  const w = await world();
  try {
    await addBambu(w);
    const job = await readyJob(w.f, 'Synthetic box');
    const res = await w.f.service(`/jobs/${job.id}/print`, json('POST', {}));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.uploaded, true);
    assert.equal(res.body.outcome.started, false);
    assert.equal(res.body.printer.autoStart, false);
    const name = res.body.outcome.fileName;
    assert.match(name, new RegExp(`^Synthetic_box-${job.id.slice(0, 8)}-[0-9a-f]{12}\\.gcode\\.3mf$`), 'title, job id and a 48-bit per-attempt suffix');
    assert.ok(w.printer.printer.files.get(name).equals(ARCHIVE), 'the sliced archive is on the printer');
    assert.equal(projectFiles(w).length, 0, 'no start command was sent');
    const slice = w.slicer.seen.find((r) => r.cmd === 'slice');
    assert.equal(slice.args.modelId, 'N7');
    assert.equal(slice.args.nozzle, '0.4');
    assert.equal(res.body.submission.requested_by, 'service');
    assert.equal(res.body.submission.state, 'uploaded');
    assert.equal(res.body.submission.failure_reason, null, 'an upload nobody asked to start is not a failure');
    assert.match(res.body.outcome.message, /Auto-start is off for this printer/);
    const jobs = await w.f.service('/jobs');
    assert.equal(jobs.status, 200);
    assert.deepEqual(jobs.body.jobs.map((j) => [j.jobId, j.printable, j.state]), [[job.id, true, 'reconstructed']]);
  } finally { await w.close(); }
});

test('switching auto-start off while the slicer runs stops the start: the decision is read when the start would be sent', async () => {
  let w;
  w = await world({ signatureRequired: false }, undefined, { beforeAnswer: async () => {
    const off = await w.f.call(`/printers/${w.printerId}`, json('PATCH', { autoStart: false }));
    assert.equal(off.status, 200);
  } });
  try {
    const p = await addBambu(w);
    w.printerId = p.printer_id;
    assert.equal((await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }))).status, 200);
    const job = await readyJob(w.f);
    const res = await w.f.service(`/jobs/${job.id}/print`, json('POST', {}));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.uploaded, true);
    assert.equal(res.body.outcome.started, false);
    assert.equal(projectFiles(w).length, 0, 'no start was sent after the owner switched auto-start off');
    assert.equal(res.body.printer.autoStart, false, 'the reply reports auto-start as it stands now');
  } finally { await w.close(); }
});

test('with auto-start on, a service job starts — when the printer allows it', async () => {
  const w = await world({ signatureRequired: false, status: { gcode_state: 'FINISH' } });
  try {
    const p = await addBambu(w);
    assert.equal((await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }))).status, 200);
    const job = await readyJob(w.f);
    const res = await w.f.service(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.started, true, res.body.outcome.message);
    assert.equal(res.body.submission.state, 'printing');
    assert.equal(projectFiles(w).length, 1);
    assert.deepEqual(projectFiles(w)[0].msg.print.ams_mapping, [3], 'the PLA tray');
  } finally { await w.close(); }
});

test('with auto-start on but a printer that requires vendor-signed commands, the file is uploaded and the reply says why it did not start', async () => {
  const w = await world({ signatureRequired: true });
  try {
    const p = await addBambu(w);
    await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    const job = await readyJob(w.f);
    const res = await w.f.service(`/jobs/${job.id}/print`, json('POST', {}));
    assert.equal(res.status, 201);
    assert.equal(res.body.outcome.uploaded, true);
    assert.equal(res.body.outcome.started, false);
    assert.match(res.body.outcome.message, /Developer Mode/);
    assert.equal(projectFiles(w).length, 0);
  } finally { await w.close(); }
});

function model(name, bytes) {
  const body = new FormData();
  body.append('model', new Blob([bytes]), name);
  return { method: 'POST', body };
}

test('a posted model: an STL is sliced, a .gcode.3mf goes as it is, anything else is refused', async () => {
  const w = await world({ signatureRequired: false });
  try {
    await addBambu(w);
    const stl = await w.f.service('/print', model('bracket v2.stl', Buffer.from('solid bracket\nendsolid bracket\n')));
    assert.equal(stl.status, 201, JSON.stringify(stl.body));
    assert.match(stl.body.outcome.fileName, /^bracket_v2-[0-9a-f]{12}\.gcode\.3mf$/, 'a unique name on the printer');
    assert.ok(w.printer.printer.files.get(stl.body.outcome.fileName).equals(ARCHIVE));
    assert.equal(stl.body.submission.job_id, null);
    assert.equal(stl.body.submission.source_name, 'bracket v2.stl');
    assert.equal(stl.body.submission.file_kind, 'gcode.3mf', 'recorded as what was sent');
    const sliced = Buffer.from('PK\x03\x04 already sliced');
    const ready = await w.f.service('/print', model('ready.gcode.3mf', sliced));
    assert.equal(ready.status, 201);
    assert.ok(w.printer.printer.files.get(ready.body.outcome.fileName).equals(sliced), 'a sliced archive is not re-sliced');
    assert.equal(w.slicer.seen.filter((r) => r.cmd === 'slice').length, 1);
    assert.equal((await w.f.service('/print', model('part.obj', Buffer.from('v 0 0 0')))).status, 415);
    assert.equal((await w.f.service('/print', { method: 'POST', body: new FormData() })).status, 400);
    const history = await w.f.service('/submissions');
    assert.equal(history.body.submissions.length, 2);
  } finally { await w.close(); }
});

test('with auto-start on, a posted STL starts but a sliced archive posted as is waits for the printer screen', async () => {
  const w = await world({ signatureRequired: false, status: { gcode_state: 'FINISH' } });
  try {
    const p = await addBambu(w);
    await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    const passThrough = await w.f.service('/print', model('ready.gcode.3mf', Buffer.from('PK\x03\x04 sliced elsewhere')));
    assert.equal(passThrough.status, 201);
    assert.equal(passThrough.body.outcome.started, false);
    assert.match(passThrough.body.outcome.message, /start it from the printer screen/);
    assert.equal(projectFiles(w).length, 0);
    const stl = await w.f.service('/print', model('part.stl', Buffer.from('solid part')));
    assert.equal(stl.body.outcome.started, true, stl.body.outcome.message);
    assert.equal(projectFiles(w).length, 1);
  } finally { await w.close(); }
});

test('with two printers the caller must name one; with none it is told so', async () => {
  const w = await world();
  try {
    assert.equal((await w.f.service('/print', model('a.stl', Buffer.from('solid a')))).body.error, 'no_printers');
    await addBambu(w);
    await addBambu(w, { label: 'Second' });
    const res = await w.f.service('/print', model('a.stl', Buffer.from('solid a')));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'printer_required');
    assert.equal(res.body.printers.length, 2);
  } finally { await w.close(); }
});

test('a stale slicer engine refuses with the install command before anything reaches the printer', async () => {
  const w = await world({}, 'f'.repeat(64));
  try {
    await addBambu(w);
    const res = await w.f.service('/print', model('a.stl', Buffer.from('solid a')));
    assert.equal(res.status, 503);
    assert.match(res.body.outcome.message, /out of date/);
    assert.match(res.body.outcome.installHint, /install-engine\.sh/);
    assert.equal(res.body.error, 'print_not_sent', 'a posted model fails with the same top-level shape as a job');
    assert.match(res.body.message, /out of date/);
    assert.match(res.body.installHint, /install-engine\.sh/);
    assert.equal(w.printer.printer.files.size, 0);
    const profiles = await w.f.call('/printers/profiles');
    assert.equal(profiles.body.engine.ready, false);
    assert.match(profiles.body.installHint, /install-engine\.sh/);
  } finally { await w.close(); }
});

test('a busy slicer is reported busy, without advice to reinstall it', async () => {
  const w = await world({}, undefined, { busy: true });
  try {
    await addBambu(w);
    const res = await w.f.service('/print', model('a.stl', Buffer.from('solid a')));
    assert.equal(res.status, 503);
    assert.match(res.body.outcome.message, /busy/);
    assert.equal(res.body.outcome.installHint, undefined);
    const profiles = await w.f.call('/printers/profiles');
    assert.equal(profiles.body.engine.busy, true);
    assert.equal(profiles.body.installHint, undefined);
  } finally { await w.close(); }
});

test('the person\'s Print click on a Bambu printer needs confirmation and starts only when they tick start', async () => {
  const w = await world({ signatureRequired: false });
  try {
    const p = await addBambu(w);
    const job = await readyJob(w.f);
    assert.equal((await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id }))).status, 428);
    const upload = await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id, confirm: true }));
    assert.equal(upload.status, 201, JSON.stringify(upload.body));
    assert.equal(upload.body.outcome.started, false);
    assert.equal(upload.body.submission.requested_by, 'person');
    assert.equal(upload.body.submission.failure_reason, null);
    assert.match(upload.body.outcome.message, /Start it from the printer screen/);
    const start = await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id, confirm: true, startPrint: true }));
    assert.equal(start.body.outcome.started, true, start.body.outcome.message);
    assert.equal(projectFiles(w).length, 1);
    const profiles = await w.f.call('/printers/profiles');
    assert.equal(profiles.body.engine.ready, true);
    assert.equal(profiles.body.printers[0].printerModel, 'Bambu Lab P2S');
  } finally { await w.close(); }
});

test('posted G-code reaches an HTTP host but is never auto-started', async () => {
  const w = await world();
  try {
    const added = await w.f.call('/printers', json('POST', { kind: 'octoprint', label: 'Octo', baseUrl: 'http://octo.example', apiKey: 'k-123' }));
    assert.equal(added.status, 201, JSON.stringify(added.body));
    await w.f.call(`/printers/${added.body.printer.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    const res = await w.f.service('/print', model('part.gcode', Buffer.from('G28\nG1 X10\n')));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.started, false);
    assert.match(res.body.outcome.message, /waits on the printer host/);
    const upload = w.f.fetchCalls.at(-1);
    assert.match(upload.url, /\/api\/files\/local$/);
    assert.equal(upload.init.body.get('print'), 'false', 'OctoPrint was not told to start');
    assert.equal(upload.init.redirect, 'manual', 'a printer host is never followed through a redirect');
  } finally { await w.close(); }
});

test('an auto-start that cannot be read starts nothing, and the attempt is still recorded', async () => {
  const w = await world({ signatureRequired: false });
  try {
    const p = await addBambu(w);
    await w.f.call(`/printers/${p.printer_id}`, json('PATCH', { autoStart: true, confirm: true }));
    w.f.control.beforeQuery = (text) => { if (/^SELECT auto_start FROM scan_print_printer/.test(text.trim())) throw new Error('pool timeout'); };
    const res = await w.f.service('/print', model('part.stl', Buffer.from('solid part')));
    w.f.control.beforeQuery = null;
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.uploaded, true);
    assert.equal(res.body.outcome.started, false);
    assert.equal(projectFiles(w).length, 0);
    assert.match(res.body.submission.failure_reason, /could not be read/);
  } finally { await w.close(); }
});

test('a printer host name that resolves to loopback is refused before anything is dialled', async () => {
  const w = await world({}, undefined, {}, { lookup: async () => ['127.0.0.1'] });
  try {
    const res = await w.f.call('/printers', json('POST', { kind: 'bambu-lan', label: 'x', host: 'printer.lan', accessCode: w.printer.printer.accessCode }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /loopback and metadata addresses are refused/);
    assert.deepEqual(w.printer.printer.credentialsSeen, []);
  } finally { await w.close(); }
});

test('every print of a job gets its own name on the printer, and a long title keeps the job id', async () => {
  const w = await world({ signatureRequired: false });
  try {
    const p = await addBambu(w);
    const job = await readyJob(w.f, 'A'.repeat(110));
    const first = await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id, confirm: true }));
    const second = await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id, confirm: true }));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const names = [first.body.outcome.fileName, second.body.outcome.fileName];
    assert.notEqual(names[0], names[1], 'a re-print never overwrites the file a printer may be printing from');
    for (const name of names) assert.ok(name.includes(job.id.slice(0, 8)), name);
    assert.equal(w.printer.printer.files.size, 2);
  } finally { await w.close(); }
});

test('with auto-start off, a busy or signature-requiring printer is not blamed and its broker is not contacted', async () => {
  for (const printerOpts of [{}, { signatureRequired: false, status: { gcode_state: 'RUNNING' } }]) {
    const w = await world(printerOpts);
    try {
      await addBambu(w);
      const mqttBefore = w.printer.printer.credentialsSeen.filter((c) => c.via === 'mqtt').length;
      const res = await w.f.service('/print', model('part.stl', Buffer.from('solid part')));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.outcome.started, false);
      assert.match(res.body.outcome.message, /Auto-start is off for this printer/);
      assert.equal(res.body.submission.failure_reason, null);
      assert.equal(projectFiles(w).length, 0);
      assert.equal(w.printer.printer.credentialsSeen.filter((c) => c.via === 'mqtt').length, mqttBefore, 'no broker session for a start nobody asked for');
    } finally { await w.close(); }
  }
});

test('an HTTP host job sent by the service says auto-start is off', async () => {
  const w = await world();
  try {
    const added = await w.f.call('/printers', json('POST', { kind: 'octoprint', label: 'Octo', baseUrl: 'http://octo.example', apiKey: 'k-123' }));
    w.f.env.SCAN_TO_PRINT_SLICER_CMD = 'slicer {input} {output}';
    const job = await readyJob(w.f);
    const res = await w.f.service(`/jobs/${job.id}/print`, json('POST', { printerId: added.body.printer.printer_id }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.outcome.started, false);
    assert.match(res.body.outcome.message, /Auto-start is off for this printer/);
    assert.equal(w.f.fetchCalls.at(-1).init.body.get('print'), 'false');
  } finally { await w.close(); }
});

test('a failed print answers with its reason at the top level, which is what the page shows', async () => {
  const w = await world({}, 'f'.repeat(64));
  try {
    const p = await addBambu(w);
    const job = await readyJob(w.f);
    const res = await w.f.call(`/jobs/${job.id}/print`, json('POST', { printerId: p.printer_id, confirm: true }));
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'print_not_sent');
    assert.match(res.body.message, /out of date/);
    assert.match(res.body.installHint, /install-engine\.sh/);
  } finally { await w.close(); }
});
