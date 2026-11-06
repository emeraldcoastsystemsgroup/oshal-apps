/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 computer link, the module the page runs: only a closed verb and base64 reach the command string, whatever a person types; the install command, run by real bash and the system python3 in a throwaway home, installs the package's bridge files exactly (the bridge then reports the same sha256) and refuses a damaged file before writing any; a bridge command run the same way answers in one JSON line; tap and swipe scaling; a picture read in parts is checked by sha256; and one command at a time with a press ahead of a waiting refresh.
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
  bridgeCommand, installCommand, parseReply, bridgeMatches, tapPoint, swipeFromDrag, readFrame, createQueue,
  toBase64, fromBase64, VERBS, workHref, computerStanding, phoneReachable
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
  assert.deepEqual(installed.installed.sort(), ['oshal-phone-bridge', 'oshal_phone_ble.py', 'oshal_phone_bridge.py']);
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
  assert.equal(computerStanding({ connected: false }).usable, false);
  assert.equal(computerStanding({ connected: true, can_control: false }).usable, false);
  assert.equal(computerStanding({ connected: true, can_control: true, tools: ['shell.exec'] }).usable, true);
  const report = { adb: { devices: [{ serial: '10.0.0.2:5555', state: 'device' }] }, ble: { phones: [{ address: 'AA', connected: false }] } };
  assert.equal(phoneReachable({ platform: 'android', address: '10.0.0.2:5555' }, report), true);
  assert.equal(phoneReachable({ platform: 'ios', address: 'AA' }, report), false);
  assert.ok(VERBS.includes('adb-frame') && !VERBS.includes('serve-ble'), 'the resident server is never a page verb');
});
