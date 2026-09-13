/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The printer boundary with a fake network: OctoPrint multipart with select/print flags only for G-code, Moonraker upload with print flag, PrusaLink PUT with Print-After-Upload, status parsing per host, the API key riding a header and never a URL, URL validation refusing loopback / credentials / non-http / query strings, extension acceptance per host, and the slicer: env resolution, argv building without a shell, whole-token placeholders, and success/failure results.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** A fetch double recording every call and answering with a fixed status/body. */
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
}
const profile = (kind) => ({ kind, baseUrl: 'http://printer.lan', apiKey: 'K-secret' });
const bytes = new Uint8Array([1, 2, 3]);

test('OctoPrint: multipart upload, select/print only for G-code, key in the header', async () => {
  const gcode = fakeFetch(201, { done: true });
  const out = await e.adapterFor('octoprint').upload(profile('octoprint'), { fileName: 'p.gcode', bytes, startPrint: true }, gcode.impl);
  assert.equal(out.ok, true);
  assert.equal(out.started, true);
  assert.equal(gcode.calls[0].url, 'http://printer.lan/api/files/local');
  assert.equal(gcode.calls[0].init.headers['X-Api-Key'], 'K-secret');
  const form = gcode.calls[0].init.body;
  assert.equal(form.get('select'), 'true');
  assert.equal(form.get('print'), 'true');
  assert.equal(form.get('file').name, 'p.gcode');
  const stl = fakeFetch(201, { done: true });
  const out2 = await e.adapterFor('octoprint').upload(profile('octoprint'), { fileName: 'p.stl', bytes, startPrint: true }, stl.impl);
  assert.equal(out2.started, false, 'an STL is uploaded but never auto-printed');
  assert.equal(stl.calls[0].init.body.get('print'), 'false');
  assert.ok(!gcode.calls[0].url.includes('K-secret'));
});

test('Moonraker and PrusaLink upload shapes and statuses', async () => {
  const moon = fakeFetch(201, { item: {}, print_started: true });
  const m = await e.adapterFor('moonraker').upload(profile('moonraker'), { fileName: 'p.gcode', bytes, startPrint: true }, moon.impl);
  assert.equal(m.ok && m.started, true);
  assert.equal(moon.calls[0].url, 'http://printer.lan/server/files/upload');
  assert.equal(moon.calls[0].init.body.get('root'), 'gcodes');
  const prusa = fakeFetch(204, '');
  const p = await e.adapterFor('prusalink').upload(profile('prusalink'), { fileName: 'my part.gcode', bytes, startPrint: true }, prusa.impl);
  assert.equal(p.ok, true);
  assert.equal(prusa.calls[0].url, 'http://printer.lan/api/v1/files/usb/my%20part.gcode');
  assert.equal(prusa.calls[0].init.method, 'PUT');
  assert.equal(prusa.calls[0].init.headers['Print-After-Upload'], '?1');
  assert.equal(prusa.calls[0].init.headers['X-Api-Key'], 'K-secret');
  const st = fakeFetch(200, { result: { status: { print_stats: { state: 'printing' } } } });
  assert.equal((await e.adapterFor('moonraker').status(profile('moonraker'), st.impl)).state, 'printing');
  const oct = fakeFetch(200, { state: 'Operational' });
  assert.equal((await e.adapterFor('octoprint').status(profile('octoprint'), oct.impl)).state, 'operational');
  const down = fakeFetch(0, '');
  assert.equal((await e.adapterFor('prusalink').status(profile('prusalink'), down.impl)).state, 'offline');
});

test('a failed upload is reported, not thrown, and network errors surface in the message', async () => {
  const bad = fakeFetch(403, { error: 'nope' });
  const out = await e.adapterFor('octoprint').upload(profile('octoprint'), { fileName: 'p.gcode', bytes, startPrint: false }, bad.impl);
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  const out2 = await e.adapterFor('moonraker').upload(profile('moonraker'), { fileName: 'p.gcode', bytes, startPrint: false }, boom);
  assert.equal(out2.ok, false);
  assert.ok(out2.message.includes('ECONNREFUSED'));
});

test('printer base URL validation', () => {
  assert.deepEqual(e.validatePrinterBaseUrl('http://octopi.local/'), { ok: true, url: 'http://octopi.local' });
  assert.deepEqual(e.validatePrinterBaseUrl('https://192.168.50.20:5000/api/'), { ok: true, url: 'https://192.168.50.20:5000/api' });
  for (const bad of ['ftp://x', 'http://user:pw@host', 'http://localhost:5000', 'http://127.0.0.1', 'http://169.254.169.254', 'http://host/?x=1', 'nonsense']) {
    assert.equal(e.validatePrinterBaseUrl(bad).ok, false, bad);
  }
});

test('file kinds and host acceptance', () => {
  assert.equal(e.fileKindOf('a.STL'), 'stl');
  assert.equal(e.fileKindOf('a.bgcode'), 'gcode');
  assert.equal(e.fileKindOf('a.txt'), 'other');
  assert.equal(e.hostAccepts('octoprint', 'a.stl'), true);
  assert.equal(e.hostAccepts('moonraker', 'a.stl'), false);
  assert.equal(e.hostAccepts('prusalink', 'a.bgcode'), true);
  assert.throws(() => e.adapterFor('cups'), RangeError);
});

test('slicer configuration and argv building', () => {
  assert.equal(e.resolveSlicerConfig({}), null);
  assert.throws(() => e.resolveSlicerConfig({ SCAN_TO_PRINT_SLICER_CMD: 'prusa-slicer -g {input}' }), /\{output\}/);
  assert.throws(() => e.resolveSlicerConfig({ SCAN_TO_PRINT_SLICER_CMD: 'x {input} {output}', SCAN_TO_PRINT_SLICER_TIMEOUT_MS: '-1' }), /TIMEOUT/);
  const cfg = e.resolveSlicerConfig({ SCAN_TO_PRINT_SLICER_CMD: '"C:/Program Files/PrusaSlicer/prusa-slicer-console.exe" --export-gcode --load "my profile.ini" -o {output} {input}' });
  assert.equal(cfg.timeoutMs, 300000);
  const argv = e.buildSlicerArgv(cfg.command, '/in/a.stl', '/out/a.gcode');
  assert.equal(argv.file, 'C:/Program Files/PrusaSlicer/prusa-slicer-console.exe');
  assert.deepEqual(argv.args, ['--export-gcode', '--load', 'my profile.ini', '-o', '/out/a.gcode', '/in/a.stl']);
  assert.throws(() => e.buildSlicerArgv('slicer --out={output} {input}', 'i', 'o'), /whole argument/);
});

test('sliceStl reports success only when the output exists, and failure without throwing', async () => {
  const cfg = { command: 'slicer {input} {output}', timeoutMs: 1000 };
  const ran = [];
  const ok = await e.sliceStl(cfg, 'in.stl', 'out.gcode', async (file, args) => { ran.push([file, args]); return { stdout: '', stderr: 'done' }; }, () => true);
  assert.equal(ok.ok, true);
  assert.deepEqual(ran[0], ['slicer', ['in.stl', 'out.gcode']]);
  const missing = await e.sliceStl(cfg, 'in.stl', 'out.gcode', async () => ({ stdout: '', stderr: '' }), () => false);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /output file/);
  const crashed = await e.sliceStl(cfg, 'in.stl', 'out.gcode', async () => { const err = new Error('exit 1'); err.stderr = 'bad mesh'; throw err; }, () => false);
  assert.equal(crashed.ok, false);
  assert.equal(crashed.stderr, 'bad mesh');
});
