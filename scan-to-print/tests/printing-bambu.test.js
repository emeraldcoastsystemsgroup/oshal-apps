/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A printer that never answers a TLS 1.3 hello (as reported for the P2S 01.02.00.00 broker; the fake does it on every port) is identified, read, uploaded to and started, and no connection offered it TLS 1.3; a positive control proves the fake ignores an uncapped hello on the broker and the file server.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Second review: a malformed relayed report is no match and cannot crash the process; the start queue holds until the printer reports busy even when it answers first; a caller's start gate is read inside the start, a "no" starts nothing (declined) and a gate that cannot be read starts nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review fixes, each with its guard: the certificate pin (a device presenting another certificate, even with the right serial, is refused and receives no credential on either protocol); a refused STOR fails at once instead of waiting on a data socket the server never accepts; only the printer's answer to OUR start counts (another client's success does not); the signature bit is read exactly from the 64-bit flags; the AMS tray is chosen by material and a start is refused when every typed slot holds another; two starts on one printer are serialised; numeric loopback/metadata host forms are refused and the canonical address stored.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Bambu Lab LAN client against a fake printer on real local TLS (bambu-fake-printer.cjs): identity from the certificate, status, a refused access code, a printer whose certificate names a different serial, upload with the session reuse the printer's FTPS server requires, the no-storage refusal, and every start rule — never attempted while the printer demands vendor-signed commands, never while it is busy, refused when the printer refuses, and started (with the right storage URL and AMS tray) when allowed. Plus the pure pieces: MQTT framing, state normalisation, the project_file command and the host validator.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startFakePrinter } = require('./bambu-fake-printer.cjs');

const ROUTES = path.resolve(__dirname, '..', 'routes');
const mqtt = require(path.join(ROUTES, 'printing/bambu-mqtt.js'));
const lan = require(path.join(ROUTES, 'printing/bambu-lan.js'));
const { ftpsUpload, pasvPort } = require(path.join(ROUTES, 'printing/bambu-ftps.js'));
const { validateBambuHost, bambuHostOf, hostAccepts, fileKindOf, adapterFor } = require(path.join(ROUTES, 'engine/print/printer-adapters.js'));

const io = (fake) => ({ connect: fake.connect, connectTcp: fake.connectTcp, statusTimeoutMs: 4000, startTimeoutMs: 4000 });
const profile = (fake, overrides = {}) => ({ host: fake.host, serial: fake.printer.serial, certSha256: fake.printer.certSha256, accessCode: fake.printer.accessCode, modelId: fake.printer.model, ...overrides });
const target = (fake, overrides = {}) => ({ ...profile(fake, overrides), connect: fake.connect, connectTcp: fake.connectTcp });
const IMPOSTOR_PIN = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

test('MQTT framing: remaining-length varints round-trip and packets split across chunk boundaries', () => {
  for (const n of [0, 1, 127, 128, 16383, 16384, 2097151, 2097152]) {
    const encoded = mqtt.encodeLength(n);
    const framed = Buffer.concat([Buffer.from([0x30]), encoded, Buffer.alloc(n)]);
    const { packets, rest } = mqtt.splitPackets(framed);
    assert.equal(packets.length, 1, `length ${n}`);
    assert.equal(packets[0].body.length, n);
    assert.equal(rest.length, 0);
  }
  const two = Buffer.concat([mqtt.publishPacket('a/b', '{"x":1}'), mqtt.publishPacket('a/b', '{"y":2}')]);
  const head = mqtt.splitPackets(two.subarray(0, 5));
  assert.equal(head.packets.length, 0, 'a partial packet waits');
  const all = mqtt.splitPackets(two);
  assert.equal(all.packets.length, 2);
  assert.deepEqual(all.packets.map((p) => p.type), [3, 3]);
});

test('state normalisation: vendor words, the signature flag, HMS codes and loaded AMS trays', () => {
  const s = lan.normaliseState({ gcode_state: 'RUNNING', mc_percent: 31, mc_remaining_time: '12', layer_num: 5, total_layer_num: 37, subtask_name: 'part', sdcard: true,
    fun: '64029FD1A3FF9CB3', print_error: 50348044, hms: [{ attr: 83886336, code: 196612 }], nozzle_diameter: '0.4',
    ams: { tray_exist_bits: 'a', ams: [{ id: '0', tray: [{ id: '1', tray_type: 'PETG' }, { id: '3', tray_type: 'PLA' }] }] } });
  assert.equal(s.state, 'printing');
  assert.equal(s.signatureRequired, true);
  assert.equal(s.printError, '0300400C');
  assert.deepEqual(s.hms, ['0500-0100-0003-0004']);
  assert.deepEqual(s.trays, [{ index: 1, type: 'PETG' }, { index: 3, type: 'PLA' }]);
  assert.equal(s.remainingMinutes, 12);
  const dev = lan.normaliseState({ gcode_state: 'FINISH', fun: '64029FD183FF9CB3' });
  assert.equal(dev.state, 'finished');
  assert.equal(dev.signatureRequired, false, 'Developer Mode clears the signature bit');
  // A full 64-bit value rounds in a double; the bit must be read exactly (review finding).
  assert.equal(lan.signatureRequired('64029FD1BFFFFE00'), true);
  assert.equal(lan.signatureRequired('64029FD19FFFFE00'), false);
  assert.equal(lan.signatureRequired(undefined), false);
  assert.equal(lan.signatureRequired('zz'), false);
});

test('tray choice: the sliced material, else a slot of unknown material, else a refusal', () => {
  const typed = [{ index: 1, type: 'PETG' }, { index: 3, type: 'PLA' }];
  assert.deepEqual(lan.chooseTray(typed, 'pla'), { tray: { index: 3, type: 'PLA' } });
  assert.deepEqual(lan.chooseTray([{ index: 0, type: 'PETG' }, { index: 2, type: null }], 'PLA'), { tray: { index: 2, type: null } });
  assert.match(lan.chooseTray([{ index: 0, type: 'PETG' }, { index: 1, type: 'TPU' }], 'PLA').refusal, /no loaded AMS slot holds PLA \(loaded: PETG, TPU\)/);
  assert.deepEqual(lan.chooseTray([], 'PLA'), { tray: null }, 'no AMS: the external spool');
  assert.deepEqual(lan.chooseTray(typed, null), { tray: typed[0] });
});

test('project_file command: storage URL by model family, the chosen tray and this request\'s id', () => {
  const p2s = lan.projectFileCommand('part.gcode.3mf', 'N7', { index: 3 }, '4242').print;
  assert.equal(p2s.url, 'ftp:///part.gcode.3mf');
  assert.equal(p2s.param, 'Metadata/plate_1.gcode');
  assert.deepEqual(p2s.ams_mapping, [3]);
  assert.equal(p2s.use_ams, true);
  assert.equal(p2s.subtask_name, 'part');
  assert.equal(p2s.sequence_id, '4242');
  assert.equal(lan.projectFileCommand('part.gcode.3mf', 'C12', { index: 0 }, '1').print.url, 'file:///sdcard/part.gcode.3mf', 'P1S addresses its SD card');
  const external = lan.projectFileCommand('part.gcode.3mf', 'N7', null, '1').print;
  assert.equal(external.use_ams, false);
  assert.deepEqual(external.ams_mapping, []);
});

test('host validation: a bare LAN address, never a URL, loopback or the metadata address', () => {
  assert.deepEqual(validateBambuHost(' 192.168.1.193 '), { ok: true, host: '192.168.1.193', baseUrl: 'bambu://192.168.1.193' });
  assert.equal(validateBambuHost('p2s.local').ok, true);
  for (const bad of ['', 'http://192.168.1.2', '192.168.1.2:990', '127.0.0.1', 'localhost', '169.254.169.254', '0.0.0.0', 'a b', '192.168.1.2/x',
    '2130706433', '0x7f000001', '0177.0.0.1', '017700000001', '0', '2852039166', '0xa9fea9fe', '127.1']) {
    assert.equal(validateBambuHost(bad).ok, false, bad);
  }
  assert.deepEqual(validateBambuHost('3232235777'), { ok: true, host: '192.168.1.1', baseUrl: 'bambu://192.168.1.1' }, 'the canonical address is what is stored');
  assert.equal(bambuHostOf('bambu://10.0.0.5'), '10.0.0.5');
  assert.throws(() => bambuHostOf('http://10.0.0.5'), RangeError);
  assert.equal(hostAccepts('bambu-lan', 'part.gcode.3mf'), true);
  assert.equal(hostAccepts('bambu-lan', 'part.3mf'), false, 'an unsliced project 3MF is not printable');
  assert.equal(hostAccepts('bambu-lan', 'part.gcode'), false);
  assert.equal(fileKindOf('x.gcode.3mf'), '3mf');
  assert.throws(() => adapterFor('bambu-lan'), /bambu-lan\.ts/);
  assert.equal(pasvPort('227 Entering Passive Mode (10,0,0,9,195,80).'), 195 * 256 + 80);
});

test('identity comes from the certificate, and the access code is proven by a real session', async () => {
  const fake = await startFakePrinter();
  try {
    assert.deepEqual(await lan.probeBambuPrinter(fake.host, io(fake)), { ok: true, serial: fake.printer.serial, modelId: 'N7', certSha256: fake.printer.certSha256 });
    const status = await lan.bambuStatus(profile(fake), io(fake));
    assert.equal(status.ok, true);
    assert.equal(status.state.state, 'idle');
    assert.equal(status.state.signatureRequired, true);
    const wrong = await lan.bambuStatus(profile(fake, { accessCode: 'nope9999' }), io(fake));
    assert.deepEqual(wrong, { ok: false, message: 'the printer refused the LAN access code' });
    const impostor = await lan.bambuStatus(profile(fake, { serial: '01S00OTHER00001' }), io(fake));
    assert.equal(impostor.ok, false);
    assert.match(impostor.message, /identifies as 01S00FAKE000001, not printer 01S00OTHER00001/);
  } finally { await fake.close(); }
});

test('a device with the right serial but not the pinned certificate receives no credential on either protocol', async () => {
  const fake = await startFakePrinter();
  try {
    const status = await lan.bambuStatus(profile(fake, { certSha256: IMPOSTOR_PIN }), io(fake));
    assert.equal(status.ok, false);
    assert.match(status.message, /not presenting the certificate this printer had when it was added/);
    const upload = await ftpsUpload(target(fake, { certSha256: IMPOSTOR_PIN }), 'part.gcode.3mf', Buffer.from('x'));
    assert.equal(upload.ok, false);
    assert.match(upload.message, /not presenting the certificate/);
    const started = await lan.bambuStart(profile(fake, { certSha256: IMPOSTOR_PIN }), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(started.started, false);
    assert.deepEqual(fake.printer.credentialsSeen, [], 'the access code never left the client');
  } finally { await fake.close(); }
});

test('upload resumes the control session on the data channel and confirms the stored size', async () => {
  const fake = await startFakePrinter();
  try {
    const bytes = Buffer.alloc(200_003, 9);
    const result = await ftpsUpload(target(fake), 'part.gcode.3mf', bytes);
    assert.deepEqual(result, { ok: true, storedBytes: 200_003, message: 'stored on the printer' });
    assert.equal(fake.printer.unreusedDataConnections, 0);
    assert.ok(fake.printer.files.get('part.gcode.3mf').equals(bytes));
    const unsafe = await ftpsUpload(target(fake), '../x.gcode.3mf', bytes);
    assert.equal(unsafe.ok, false);
    assert.match(unsafe.message, /unsafe file name/);
    const badCode = await ftpsUpload(target(fake, { accessCode: 'nope9999' }), 'a.gcode.3mf', bytes);
    assert.deepEqual(badCode, { ok: false, storedBytes: null, message: 'the printer refused the LAN access code' });
  } finally { await fake.close(); }
});

test('a printer with no USB stick or SD card is reported at once, without waiting on the data channel', async () => {
  const fake = await startFakePrinter({ storage: false });
  try {
    const started = Date.now();
    const result = await lan.bambuUpload(profile(fake), 'part.gcode.3mf', Buffer.from('x'), io(fake));
    assert.equal(result.ok, false);
    assert.match(result.message, /nowhere to store the file — insert a USB stick/);
    assert.ok(Date.now() - started < 3000, `answered in ${Date.now() - started} ms`);
    assert.equal(fake.printer.dataConnections, 0, 'no TLS was started on the refused data channel');
  } finally { await fake.close(); }
});

test('start is never attempted while the printer requires vendor-signed commands', async () => {
  const fake = await startFakePrinter({ signatureRequired: true });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /only accepts start commands signed by the vendor/);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 0, 'no start command was published');
  } finally { await fake.close(); }
});

test('start is never attempted while the printer is busy', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, status: { gcode_state: 'RUNNING' } });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /printer is printing; nothing was started/);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 0);
  } finally { await fake.close(); }
});

test('an allowed start publishes project_file for the stored file and waits for the printer to accept', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, status: { gcode_state: 'FINISH' } });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, true, outcome.message);
    const sent = fake.printer.requests.find((r) => r.msg.print && r.msg.print.command === 'project_file');
    assert.equal(sent.topic, `device/${fake.printer.serial}/request`);
    assert.equal(sent.msg.print.url, 'ftp:///part.gcode.3mf');
    assert.deepEqual(sent.msg.print.ams_mapping, [3]);
  } finally { await fake.close(); }
});

test('a printer that never answers a TLS 1.3 hello (as reported for the P2S 01.02.00.00 broker) is identified, read, uploaded to and started: every connection offers TLS 1.2 at most', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, tls13Hangs: true, status: { gcode_state: 'FINISH' } });
  try {
    assert.deepEqual(await lan.probeBambuPrinter(fake.host, io(fake)), { ok: true, serial: fake.printer.serial, modelId: 'N7', certSha256: fake.printer.certSha256 });
    const status = await lan.bambuStatus(profile(fake), io(fake));
    assert.equal(status.ok, true, status.message);
    const bytes = Buffer.from('PK\x03\x04 sliced for a P2S');
    const upload = await lan.bambuUpload(profile(fake), 'part.gcode.3mf', bytes, io(fake));
    assert.equal(upload.ok, true, upload.message);
    assert.ok(fake.printer.files.get('part.gcode.3mf').equals(bytes), 'the upload went over a data channel offered TLS 1.2 at most');
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, true, outcome.message);
    assert.equal(fake.printer.tls13HellosIgnored, 0, 'no connection offered the printer TLS 1.3');
    assert.equal(mqtt.BAMBU_MAX_TLS, 'TLSv1.2');
    // Positive control: the fake really sits on a hello that offers TLS 1.3, on the broker and on the file server.
    const answered = (socket) => new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
      socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once('error', () => { clearTimeout(timer); resolve(false); });
    });
    assert.equal(await answered(fake.connect({ host: fake.host, port: 8883, rejectUnauthorized: false })), false, 'an uncapped hello to the broker is never answered');
    assert.equal(await answered(fake.connect({ host: fake.host, port: 990, rejectUnauthorized: false })), false, 'an uncapped hello to the file server is never answered');
    assert.equal(fake.printer.tls13HellosIgnored, 2);
  } finally { await fake.close(); }
});

test('another client\'s successful start is not mistaken for ours', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, acceptStart: false, foreignAck: true });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /refused the start command/);
  } finally { await fake.close(); }
});

test('no start when every loaded slot holds another material', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, status: { ams: { tray_exist_bits: '3', ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PETG' }, { id: '1', tray_type: 'TPU' }] }] } } });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /no loaded AMS slot holds PLA/);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 0);
  } finally { await fake.close(); }
});

test('two starts on one printer are serialised: the second sees the first job and starts nothing', async () => {
  const fake = await startFakePrinter({ signatureRequired: false });
  try {
    const [a, b] = await Promise.all([
      lan.bambuStart(profile(fake), 'a.gcode.3mf', 'PLA', io(fake)),
      lan.bambuStart(profile(fake), 'b.gcode.3mf', 'PLA', io(fake)),
    ]);
    assert.deepEqual([a.started, b.started], [true, false]);
    assert.match(b.message, /printer is preparing/);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 1);
  } finally { await fake.close(); }
});

test('a start the printer refuses is reported, not assumed', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, acceptStart: false });
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', io(fake));
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /refused the start command: refused by fake printer/);
  } finally { await fake.close(); }
});

test('a malformed relayed report is no match and cannot crash the process', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, malformedAck: true });
  let crashed = null;
  const onCrash = (error) => { crashed = error; };
  process.on('uncaughtException', onCrash);
  try {
    const outcome = await lan.bambuStart(profile(fake), 'part.gcode.3mf', 'PLA', { ...io(fake), startTimeoutMs: 1500 });
    assert.equal(outcome.started, false);
    assert.match(outcome.message, /did not acknowledge/);
    assert.equal(crashed, null, 'no exception escaped the socket handler');
  } finally { process.off('uncaughtException', onCrash); await fake.close(); }
});

test('the start queue holds until the printer reports busy, even when it answers before its state moves', async () => {
  const fake = await startFakePrinter({ signatureRequired: false, stateDelayMs: 800 });
  try {
    const [a, b] = await Promise.all([
      lan.bambuStart(profile(fake), 'a.gcode.3mf', 'PLA', io(fake)),
      lan.bambuStart(profile(fake), 'b.gcode.3mf', 'PLA', io(fake)),
    ]);
    assert.deepEqual([a.started, b.started], [true, false]);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 1);
  } finally { await fake.close(); }
});

test('a start gate is read inside the start: "no" starts nothing, and a gate that cannot be read starts nothing', async () => {
  const fake = await startFakePrinter({ signatureRequired: false });
  try {
    const no = await lan.bambuStart(profile(fake), 'a.gcode.3mf', 'PLA', io(fake), async () => false);
    assert.equal(no.started, false);
    assert.equal(no.declined, true);
    const broken = await lan.bambuStart(profile(fake), 'a.gcode.3mf', 'PLA', io(fake), async () => { throw new Error('pool timeout'); });
    assert.equal(broken.started, false);
    assert.match(broken.message, /could not be read \(pool timeout\); nothing was started/);
    assert.equal(fake.printer.requests.filter((r) => r.msg.print && r.msg.print.command === 'project_file').length, 0);
  } finally { await fake.close(); }
});
