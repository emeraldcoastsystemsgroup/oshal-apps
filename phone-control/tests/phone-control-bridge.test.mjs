/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 bridge, run for real with the system python3 in a throwaway home on a computer whose system message bus is not there: it says so in words and never answers "sent"; the resident keyboard refuses to start and leaves no socket; the verb list is closed; every argument is checked before adb or Bluetooth is touched; every answer is one JSON line within 19,000 characters; a kept picture is read back in parts. A real adapter and phone are tests/live/ble-takeover.sh and tests/live/android-device.sh; real adb is tests/live/adb-host.sh.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERBS } from '../tools/computer-link.js';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge');
const home = mkdtempSync(join(tmpdir(), 'pc-bridge-home-'));
const runtime = mkdtempSync('/tmp/pcb-');
const env = { PATH: '/usr/bin:/bin', HOME: home, XDG_RUNTIME_DIR: runtime, DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${runtime}/no-system-bus` };
after(() => { rmSync(home, { recursive: true, force: true }); rmSync(runtime, { recursive: true, force: true }); });

function bridge(...args) {
  const done = spawnSync('python3', ['-I', join(BRIDGE, 'oshal_phone_bridge.py'), ...args], { env, encoding: 'utf8', timeout: 60000 });
  const lines = done.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `exactly one line: ${done.stdout}${done.stderr}`);
  assert.ok(lines[0].length <= 19000);
  return { ...JSON.parse(lines[0]), status: done.status };
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

test('the verb list is closed and is the page\'s list', () => {
  const help = bridge('help');
  assert.equal(help.ok, true);
  assert.deepEqual(Object.keys(help.verbs).sort(), VERBS.filter((verb) => verb !== 'ble-status').sort());
  const unknown = bridge('serve-ble');
  assert.equal(unknown.error, 'unknown_verb');
  assert.equal(unknown.status, 3);
  assert.equal(bridge('status', '--b64', '!!!').error, 'bad_argument');
  assert.equal(bridge('status', '--json', '[1]').error, 'bad_argument');
  assert.equal(bridge('status', '--rm').error, 'bad_argument');
});

test('with no system message bus the bridge says there is no Bluetooth and never sends', () => {
  const status = bridge('status', 'adb=false');
  assert.equal(status.ok, true);
  assert.equal(status.bluetooth.ready, false);
  assert.match(status.bluetooth.message, /No Bluetooth adapter on this computer|python3-dbus/);
  assert.equal(status.ble, null);
  assert.equal(typeof status.ffmpeg, 'boolean');
  const ensure = bridge('ensure');
  assert.equal(ensure.ok, false);
  assert.equal(ensure.error, 'no_bluetooth');
  for (const [verb, args] of [['ble-type', { text: 'hello from oshal' }], ['ble-key', { key: 'Home' }], ['ble-mouse', { dx: 5, dy: 5, click: true }],
    ['ble-open', { name: 'Notes' }], ['ble-pair-window', { seconds: 120 }], ['ble-devices', {}]]) {
    const reply = bridge(verb, '--b64', b64(args));
    assert.equal(reply.ok, false, verb);
    assert.equal(reply.error, 'ble_not_running', verb);
    assert.notEqual(reply.sent, true, verb);
  }
});

test('the resident keyboard refuses to start without a bus and leaves no socket behind', () => {
  const folder = mkdtempSync('/tmp/pcs-');
  const done = spawnSync('python3', ['-I', join(BRIDGE, 'oshal_phone_ble.py'), 'serve', folder], { env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr + done.stdout, /DBus|dbus|Bluetooth/);
  assert.equal(existsSync(join(folder, 'ble.sock')), false);
  assert.equal(spawnSync('python3', ['-I', join(BRIDGE, 'oshal_phone_ble.py'), 'listen'], { env, encoding: 'utf8' }).status, 1);
  rmSync(folder, { recursive: true, force: true });
});

test('every Android argument is checked before adb is touched', () => {
  const cases = [
    ['adb-pair', { address: 'not an address', code: '123456' }, 'bad_address'],
    ['adb-pair', { address: '192.168.1.42:99999', code: '123456' }, 'bad_address'],
    ['adb-pair', { address: '192.168.1.42:37123', code: '12345' }, 'bad_code'],
    ['adb-tap', { serial: '-H 1.2.3.4', x: 1, y: 1 }, 'bad_serial'],
    ['adb-tap', { serial: '10.0.0.2:5555', x: -1, y: 1 }, 'bad_argument'],
    ['adb-swipe', { serial: '10.0.0.2:5555', x1: 1, y1: 1, x2: 1, y2: 1, ms: 9000 }, 'bad_argument'],
    ['adb-key', { serial: '10.0.0.2:5555', key: 'FORMAT' }, 'unknown_key'],
    ['adb-text', { serial: '10.0.0.2:5555', text: 'café' }, 'cannot_type'],
    ['adb-text', { serial: '10.0.0.2:5555', text: 'a%sb' }, 'cannot_type'],
    ['adb-text', { serial: '10.0.0.2:5555', text: '' }, 'no_text'],
    ['adb-launch', { serial: '10.0.0.2:5555', package: 'com.x; reboot' }, 'bad_package'],
    ['frame-chunk', { id: '../../etc', index: 1 }, 'bad_frame'],
    ['frame-chunk', { id: 'abcdef0123456789', index: 1 }, 'frame_gone']
  ];
  for (const [verb, args, code] of cases) assert.equal(bridge(verb, '--b64', b64(args)).error, code, `${verb} ${JSON.stringify(args)}`);
  const words = bridge('adb-text', 'serial=10.0.0.2:5555', 'text=naïve');
  assert.match(words.message, /cannot type ï\. Nothing was sent\./);
});

test('a kept picture is read back in parts that add up to its sha256', () => {
  const frames = join(runtime, 'oshal-phone-bridge', 'frames');
  mkdirSync(frames, { recursive: true });
  const bytes = Buffer.alloc(30000, 7);
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  writeFileSync(join(frames, `${id}.jpg`), bytes);
  const parts = [0, 1, 2].map((index) => bridge('frame-chunk', `id=${id}`, `index=${index}`));
  assert.ok(parts.every((part) => part.ok));
  assert.deepEqual(Buffer.from(parts.map((part) => part.data).join(''), 'base64'), bytes);
  assert.equal(bridge('frame-chunk', `id=${id}`, 'index=3').error, 'bad_frame');
  assert.ok(readdirSync(join(runtime, 'oshal-phone-bridge')).length >= 1);
});
