/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 computer link, the module the page runs: only a closed verb and base64 reach the command string, whatever a person types; the install command, run by real bash and the system python3 in a throwaway home, installs the package's bridge files exactly (the bridge then reports the same sha256) and refuses a damaged file before writing any; a bridge command run the same way answers in one JSON line; tap and swipe scaling; a picture read in parts is checked by sha256; and one command at a time with a press ahead of a waiting refresh.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: bridgeSupport refuses Windows and macOS with Linux-only guidance and accepts Linux or empty; computerStanding names Let Jarvis control this computer; adb-connect-tv and ble-remove are closed verbs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: installer carries oshal_phone_mirror.py, lowercase oshal Node guidance, closed setup-mirror / mirror-start / mirror-stop / mirror-frame verbs, readFrame custom verb support, and phoneReachable with mirror.hasFrame.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: cover computerPoint coordinate mapping (normalized and multi-monitor physical offset), desktopControlSupport capability gating, safeFileName, bytesToBase64, QUALITY_PRESETS, and adb-files/adb-push/adb-pull/adb-clipboard-* verbs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the installer carries oshal_phone_lan.py, its single-quoted payload installs for real, and lan-discover / lan-control are closed verbs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.6.1: the reconnect rules (only a not_connected refusal, only a device reached over the network, at most once in 20 seconds), the command sent again after a reconnect and to a new serial when the reconnect reports one, the words for a device still not connected (a TV is never called a phone), and the note under a stored picture.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bridgeCommand, installCommand, parseReply, bridgeMatches, tapPoint, swipeFromDrag, iosGestureFromDrag,
  readFrame, createQueue, toBase64, fromBase64, bytesToBase64, safeFileName, computerPoint,
  desktopControlSupport, QUALITY_PRESETS, VERBS, workHref, computerStanding, bridgeSupport, phoneReachable,
  reconnectVerb, sendWithReconnect, notConnectedWords, storedPictureNote, RECONNECT_EVERY_MS
} from '../tools/computer-link.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { bridgeManifest } = require(join(PKG, 'lib', 'bridge-files.js'));
const home = mkdtempSync(join(tmpdir(), 'pc-link-home-'));
const runtime = mkdtempSync('/tmp/pcl-');
after(() => { rmSync(home, { recursive: true, force: true }); rmSync(runtime, { recursive: true, force: true }); });

/** Run a command the way OSHAL Node's shell.exec does: bash -lc, in the person's home. */
function shell(command) {
  try {
    const stdout = execFileSync('bash', ['-lc', command], { cwd: home, env: { PATH: '/usr/bin:/bin', HOME: home, XDG_RUNTIME_DIR: runtime,
      DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${runtime}/no-bus` }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: { stdout, stderr: '', exitCode: 0 } };
  } catch (error) {
    return { ok: false, output: { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.status } };
  }
}

const HOSTILE = ['$(touch /tmp/pwned)', '`id`', "'; rm -rf ~; '", 'line\nnext', '"quoted" && echo', 'ünïcödé ☎'];

test('only the verb and base64 reach the command string, whatever is typed', () => {
  for (const text of HOSTILE) {
    const command = bridgeCommand('ble-type', { text, enter: true });
    assert.match(command, /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" ble-type --b64 [A-Za-z0-9+/]+=*$/);
    for (const piece of ['$(', '`', ';', '\n', '"quoted"', 'rm -rf']) assert.ok(!command.slice(80).includes(piece), `${piece} leaked`);
    const b64 = command.split(' ').pop();
    assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64(b64))), { text, enter: true });
  }
  assert.throws(() => bridgeCommand('rm', {}), /no bridge verb/);
  assert.throws(() => bridgeCommand('status', ['x']), /object/);
  assert.equal(toBase64('☎'), Buffer.from('☎').toString('base64'));
});

test('the install command installs exactly the package bridge, and the bridge reports the same hashes', () => {
  const manifest = bridgeManifest(PKG);
  const installed = parseReply(shell(installCommand(manifest)));
  assert.equal(installed.ok, true, installed.message);
  assert.deepEqual(installed.installed.sort(), [
    'oshal-phone-bridge', 'oshal_phone_ble.py', 'oshal_phone_bridge.py', 'oshal_phone_lan.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py'
  ]);
  assert.ok(installCommand(manifest).length < 100 * 1024, 'the install command stays one shell argument with room to spare');
  for (const file of manifest.files) {
    const where = file.name === 'oshal-phone-bridge' ? join(home, '.local', 'bin', file.name) : join(home, '.local', 'share', 'oshal-phone-bridge', file.name);
    assert.equal(createHash('sha256').update(readFileSync(where)).digest('hex'), file.sha256, file.name);
  }
  const version = parseReply(shell(bridgeCommand('version')));
  assert.equal(version.ok, true, version.message);
  assert.equal(bridgeMatches(version, manifest), true);
  const byName = shell('oshal-phone-bridge() { "$HOME/.local/bin/oshal-phone-bridge" "$@"; }; oshal-phone-bridge version');
  assert.equal(parseReply(byName).version, manifest.version, 'the wrapper runs the same bridge by name');
});

test('a damaged file is refused before any file is replaced', () => {
  const manifest = bridgeManifest(PKG);
  const before = readFileSync(join(home, '.local', 'share', 'oshal-phone-bridge', 'oshal_phone_bridge.py'));
  const damaged = { ...manifest, files: manifest.files.map((file, index) => (index === 1 ? { ...file, sha256: '0'.repeat(64) } : file)) };
  const reply = parseReply(shell(installCommand(damaged)));
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'sha256_mismatch');
  assert.deepEqual(readFileSync(join(home, '.local', 'share', 'oshal-phone-bridge', 'oshal_phone_bridge.py')), before);
  assert.throws(() => installCommand({ ...manifest, files: [...manifest.files, { name: 'evil.sh', sha256: '0'.repeat(64), mode: 493, gz: '' }] }), /unexpected files/);
});

test('a bridge command answers in one JSON line; hostile text is refused or carried, never run', () => {
  for (const text of HOSTILE) {
    const reply = parseReply(shell(bridgeCommand('ble-type', { text })));
    assert.equal(reply.ok, false);
    assert.ok(['ble_not_running'].includes(reply.error), `${reply.error}: ${reply.message}`);
    assert.notEqual(reply.sent, true);
  }
  assert.equal(existsSync('/tmp/pwned'), false);
  const refused = parseReply(shell(bridgeCommand('adb-text', { serial: '10.0.0.2:5555', text: 'ünïcödé' })));
  assert.equal(refused.error, 'cannot_type');
  const missing = parseReply({ ok: false, output: { stdout: '', stderr: "python3: can't open file '/x/oshal_phone_bridge.py'", exitCode: 2 } });
  assert.equal(missing.error, 'bridge_not_installed');
  assert.equal(parseReply({ ok: false, error: 'control is off', output: {} }).message, 'control is off');
});

test('a click or a drag on the picture lands on the phone\'s own pixels', () => {
  const box = { width: 216, height: 468 };
  const frame = { deviceWidth: 1080, deviceHeight: 2340 };
  assert.deepEqual(tapPoint({ x: 108, y: 234 }, box, frame), { x: 540, y: 1170 });
  assert.deepEqual(tapPoint({ x: 400, y: -5 }, box, frame), { x: 1079, y: 0 });
  assert.equal(swipeFromDrag({ x: 100, y: 100 }, { x: 104, y: 103 }, box, frame, 90), null, 'a short move is a tap');
  assert.deepEqual(swipeFromDrag({ x: 108, y: 400 }, { x: 108, y: 100 }, box, frame, 5000), { x1: 540, y1: 2000, x2: 540, y2: 500, ms: 1500 });
  assert.throws(() => tapPoint({ x: 1, y: 1 }, { width: 0, height: 0 }, frame), /no picture/);
});

test('a picture read in parts is assembled and checked by sha256', async () => {
  const bytes = new Uint8Array(40000).map((_, i) => (i * 31) % 251);
  const text = Buffer.from(bytes).toString('base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const parts = [text.slice(0, 16000), text.slice(16000, 32000), text.slice(32000)];
  const asked = [];
  const send = async (verb, args) => {
    asked.push([verb, args.index ?? null]);
    if (verb === 'adb-frame') return { ok: true, id: 'abcdef0123456789', sha256, mime: 'image/jpeg', bytes: bytes.length, chunks: 3, data: parts[0], deviceWidth: 1080, deviceHeight: 2340 };
    return { ok: true, data: parts[args.index] };
  };
  const frame = await readFrame(send, '10.0.0.2:5555');
  assert.deepEqual(asked, [['adb-frame', null], ['frame-chunk', 1], ['frame-chunk', 2]]);
  assert.deepEqual(frame.bytes, bytes);
  const mirrorAsked = [];
  const mirrorSend = async (verb, args) => {
    mirrorAsked.push([verb, args.index ?? null, args.serial ?? null]);
    if (verb === 'mirror-frame') return { ok: true, id: 'abcdef0123456789', sha256, mime: 'image/jpeg', bytes: bytes.length, chunks: 1, data: text, deviceWidth: 1170, deviceHeight: 2532 };
    return { ok: false, message: 'unexpected' };
  };
  const mirrored = await readFrame(mirrorSend, '', 432, 'mirror-frame');
  assert.deepEqual(mirrorAsked, [['mirror-frame', null, null]]);
  assert.equal(mirrored.deviceWidth, 1170);
  const damaged = async (verb, args) => (verb === 'adb-frame' ? send(verb, args) : { ok: true, data: parts[args.index].replace(/^./, 'A') });
  await assert.rejects(readFrame(damaged, 's'), /damaged/);
  await assert.rejects(readFrame(async () => ({ ok: false, message: 'The phone is not connected' }), 's'), /not connected/);
});

test('one command at a time: a press goes before a waiting refresh, and only one refresh waits', async () => {
  const queue = createQueue();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queue.refresh(async () => { await gate; order.push('refresh 1'); });
  const second = queue.refresh(async () => order.push('refresh 2'));
  assert.ok(second, 'one refresh may wait behind the running one');
  assert.equal(queue.refresh(async () => order.push('refresh 3')), null, 'a second waiting refresh is dropped');
  const press = queue.press(async () => order.push('press'));
  release();
  await Promise.all([first, second, press]);
  assert.deepEqual(order, ['refresh 1', 'press', 'refresh 2']);
  assert.equal(queue.idle(), true);
});

test('computers and phones are described from what the kernel and the bridge said', () => {
  assert.equal(workHref('a b'), '/cockpit/tools/computer.html?id=a%20b');
  const disconnected = computerStanding({ name: 'Desk', connected: false });
  assert.equal(disconnected.usable, false);
  assert.match(disconnected.fix, /open oshal Node and sign in/);
  const controlOff = computerStanding({ name: 'Spark', connected: true, can_control: false });
  assert.equal(controlOff.usable, false);
  assert.match(controlOff.fix, /Let Jarvis control this computer/);
  assert.equal(computerStanding({ connected: true, can_control: true, tools: [] }).usable, false);
  assert.equal(computerStanding({ connected: true, can_control: true, tools: ['shell.exec'] }).usable, true);
  for (const platform of ['windows', 'Windows', 'macos']) {
    const support = bridgeSupport({ name: 'PC', platform });
    assert.equal(support.ok, false, platform);
    assert.match(support.text, /Linux computer only/);
  }
  for (const platform of ['linux', 'Linux', '', undefined]) {
    assert.equal(bridgeSupport({ name: 'Spark', platform }).ok, true, String(platform));
  }
  assert.match(bridgeCommand('adb-connect-tv', { address: '192.168.1.60' }), / adb-connect-tv --b64 /);
  assert.match(bridgeCommand('ble-remove', { address: '7C:4B:26:00:00:01' }), / ble-remove --b64 /);
  assert.match(bridgeCommand('setup-mirror'), / setup-mirror --b64 e30=$/);
  assert.match(bridgeCommand('mirror-start'), / mirror-start --b64 e30=$/);
  assert.match(bridgeCommand('mirror-stop'), / mirror-stop --b64 e30=$/);
  assert.match(bridgeCommand('mirror-frame', { width: 432 }), / mirror-frame --b64 /);
  const report = { adb: { devices: [{ serial: '10.0.0.2:5555', state: 'device' }] }, ble: { phones: [{ address: 'AA', connected: false }] } };
  assert.equal(phoneReachable({ platform: 'android', address: '10.0.0.2:5555' }, report), true);
  assert.equal(phoneReachable({ platform: 'ios', address: 'AA' }, report), false);
  assert.equal(phoneReachable({ platform: 'ios', address: 'AA' }, { ...report, mirror: { hasFrame: true } }), true);
  assert.ok(VERBS.includes('adb-frame') && VERBS.includes('mirror-frame') && !VERBS.includes('serve-ble'), 'the resident server is never a page verb');
  assert.deepEqual(computerPoint({ x: 100, y: 50 }, { width: 200, height: 100 }, { width: 1920, height: 1080 }), { x: 960, y: 540, coordinateSpace: 'screenshot' });
  assert.deepEqual(tapPoint({ x: 200, y: 200 }, { width: 400, height: 400 }, { deviceWidth: 1920, deviceHeight: 1080 }), { x: 960, y: 540 });
  assert.deepEqual(tapPoint({ x: 200, y: 40 }, { width: 400, height: 400 }, { deviceWidth: 1920, deviceHeight: 1080 }), { x: 960, y: 0 });
  assert.deepEqual(
    computerPoint({ x: 100, y: 50 }, { width: 200, height: 100 }, { width: 1920, height: 1080 }, { originX: 1920, originY: 0, width: 2560, height: 1440 }),
    { x: 2880, y: 540, coordinateSpace: 'physical' }
  );
  const iosTap = iosGestureFromDrag({ x: 100, y: 200 }, { x: 100, y: 200 }, { width: 200, height: 400 }, { deviceWidth: 500, deviceHeight: 1000 }, 60);
  assert.equal(iosTap.verb, 'ble-tap');
  assert.deepEqual(iosTap.pixel, { x: 250, y: 500, width: 500, height: 1000 });
  const iosSwipe = iosGestureFromDrag({ x: 160, y: 200 }, { x: 40, y: 200 }, { width: 200, height: 400 }, { deviceWidth: 500, deviceHeight: 1000 }, 220);
  assert.equal(iosSwipe.verb, 'ble-swipe');
  assert.equal(iosSwipe.pixel.x1, 400);
  assert.equal(iosSwipe.pixel.x2, 100);
  assert.equal(desktopControlSupport({ name: 'Spark', connected: true, can_control: true, tools: ['shell.exec'] }).ok, false);
  assert.equal(desktopControlSupport({ name: 'Spark', connected: true, can_control: true, tools: ['shell.exec', 'desktop.control'] }).ok, true);
  assert.equal(safeFileName('C:\\fakepath\\My Report 1.pdf'), 'My Report 1.pdf');
  assert.throws(() => safeFileName('C:\\fakepath\\../bad.sh'));
  assert.equal(bytesToBase64(new Uint8Array([1, 2, 3, 4])), Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.equal(QUALITY_PRESETS.high.width > QUALITY_PRESETS.balanced.width && QUALITY_PRESETS.balanced.width > QUALITY_PRESETS.low.width, true);
  for (const verb of [
    'adb-files', 'adb-push', 'adb-pull', 'adb-clipboard-get', 'adb-clipboard-set',
    'ble-calibrate', 'rdp-probe', 'screen-info', 'pointer-move', 'pointer-click', 'pointer-drag', 'keyboard-type', 'keyboard-key'
  ]) {
    assert.match(bridgeCommand(verb, { serial: '10.0.0.2:5555' }), new RegExp(` ${verb} --b64 `));
  }
});

const FIRE_TV = { id: 'tv-1', platform: 'android', form: 'tv', name: 'Amazon AFTMD001', address: '192.168.1.60:5555' };
const LOST = { ok: false, error: 'not_connected', message: 'The phone is not connected to this computer. Open Connect a device and press Connect.' };

/** A bridge that answers from a script and records what it was sent. */
function scripted(answers) {
  const sent = [];
  return { sent, io: { now: () => 100000, tried: new Map(), adopted: [], adopt(serial) { this.adopted.push(serial); },
    async send(verb, args, limit) { sent.push({ verb, args, limit }); return answers.shift() ?? { ok: false, error: 'script_ran_out' }; } } };
}

test('1.6.1: the page reconnects by itself only a network device its computer lost, and not twice in a row', () => {
  assert.equal(reconnectVerb(FIRE_TV, 'adb-frame', LOST, 0, 100000), 'adb-connect-tv');
  assert.equal(reconnectVerb({ ...FIRE_TV, form: 'phone' }, 'adb-key', LOST, 0, 100000), 'adb-connect', 'a phone on Wi-Fi');
  assert.equal(reconnectVerb({ ...FIRE_TV, form: 'phone', address: 'R58N123ABC' }, 'adb-key', LOST, 0, 100000), null, 'a phone on a cable cannot be plugged in from here');
  assert.equal(reconnectVerb(FIRE_TV, 'adb-frame', { ok: false, error: 'unauthorized' }, 0, 100000), null, 'only a lost connection');
  assert.equal(reconnectVerb(FIRE_TV, 'adb-frame', { ok: true }, 0, 100000), null);
  assert.equal(reconnectVerb(FIRE_TV, 'adb-connect-tv', LOST, 0, 100000), null, 'a refused connect is not answered with a connect');
  assert.equal(reconnectVerb({ ...FIRE_TV, platform: 'ios' }, 'ble-key', LOST, 0, 100000), null);
  assert.equal(reconnectVerb(FIRE_TV, 'adb-frame', LOST, 100000 - RECONNECT_EVERY_MS + 1, 100000), null, 'tried a moment ago');
  assert.equal(reconnectVerb(FIRE_TV, 'adb-frame', LOST, 100000 - RECONNECT_EVERY_MS, 100000), 'adb-connect-tv');
});

test('1.6.1: a command to a TV the computer lost reconnects it once and is sent again', async () => {
  const tv = { ...FIRE_TV };
  const { sent, io } = scripted([LOST, { ok: true, serial: '192.168.1.60:5555' }, { ok: true, key: 'HOME' }]);
  const reply = await sendWithReconnect(io, tv, 'adb-key', { serial: tv.address, key: 'HOME' }, 9000);
  assert.deepEqual(reply, { ok: true, key: 'HOME' });
  assert.deepEqual(sent.map((item) => item.verb), ['adb-key', 'adb-connect-tv', 'adb-key']);
  assert.deepEqual(sent[1], { verb: 'adb-connect-tv', args: { address: '192.168.1.60:5555' }, limit: 25000 });
  assert.deepEqual(sent[2], sent[0], 'the same command, the same limit');
  // The next refusal within the wait is reported as it is: no second reconnect, one command sent.
  const second = scripted([LOST]);
  second.io.tried = io.tried;
  assert.equal(await sendWithReconnect(second.io, tv, 'adb-frame', { serial: tv.address, width: 432 }), LOST);
  assert.deepEqual(second.sent.map((item) => item.verb), ['adb-frame']);
});

test('1.6.1: a reconnect that fails changes nothing, and one that reports a new serial sends the command to it', async () => {
  const failed = scripted([LOST, { ok: false, error: 'no_answer', message: 'The phone did not answer at 192.168.1.60:5555.' }]);
  assert.equal(await sendWithReconnect(failed.io, { ...FIRE_TV }, 'adb-frame', { serial: FIRE_TV.address }), LOST, 'the first refusal is what is reported');
  assert.deepEqual(failed.sent.map((item) => item.verb), ['adb-frame', 'adb-connect-tv']);
  const tv = { ...FIRE_TV };
  const moved = scripted([LOST, { ok: true, serial: '192.168.1.77:5555' }, { ok: true }]);
  moved.io.adopt = (serial) => { tv.address = serial; };
  await sendWithReconnect(moved.io, tv, 'adb-launch', { serial: FIRE_TV.address, package: 'com.amazon.avod' });
  assert.deepEqual(moved.sent[2].args, { serial: '192.168.1.77:5555', package: 'com.amazon.avod' });
  const fine = scripted([{ ok: true }]);
  await sendWithReconnect(fine.io, { ...FIRE_TV }, 'adb-key', { serial: FIRE_TV.address, key: 'BACK' });
  assert.equal(fine.sent.length, 1, 'a command that worked sends nothing more');
});

test('1.6.1: a device still not connected is named with its kind, its computer and the one thing to do', () => {
  assert.equal(notConnectedWords(FIRE_TV, 'Spark'), 'Amazon AFTMD001 is not connected to Spark. Check that the TV is on and on the same Wi-Fi, then press Sync.');
  assert.doesNotMatch(notConnectedWords(FIRE_TV, 'Spark'), /phone/i, 'a TV is never called a phone');
  assert.match(notConnectedWords({ platform: 'android', name: 'Pixel', address: '10.0.0.9:37123' }, ''), /^Pixel is not connected to this computer\. Unlock the phone, .* press Sync\.$/);
  assert.match(notConnectedWords({ platform: 'android', name: 'Pixel', address: 'R58N123ABC' }, 'Spark'), /Plug it in with its cable/);
  assert.equal(storedPictureNote(FIRE_TV, 'It is not connected.'),
    "Not live: this is the last picture Amazon AFTMD001's own oshal app sent, not what is on the TV now. It is not connected.");
  assert.match(storedPictureNote({ name: 'Pixel' }), /^Not live: .* not what is on the phone now\.$/);
});

