/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 bridge, run for real with the system python3 in a throwaway home on a computer whose system message bus is not there: it says so in words and never answers "sent"; the resident keyboard refuses to start and leaves no socket; the verb list is closed; every argument is checked before adb or Bluetooth is touched; every answer is one JSON line within 19,000 characters; a kept picture is read back in parts. A real adapter and phone are tests/live/ble-takeover.sh and tests/live/android-device.sh; real adb is tests/live/adb-host.sh.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: tv_address defaults port 5555 and refuses malformed hosts/ports, ANDROID_KEYS has OK and PLAY_PAUSE, and ble-remove answers ble_not_running without a bus.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: mirror-start, mirror-stop and mirror-frame validate SOI/EOI JPEGs, refuse partial writes and stopped receivers, parse SOF dimensions, and clean up background UxPlay processes.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: validate adb-files, adb-push, adb-pull, adb-clipboard-get, and adb-clipboard-set arguments + real mock-adb transfers/clipboard refusals, and verify UxPlay -fps 8 -bt709 videoconvert pipeline.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
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
  return bridgeWithEnv(env, ...args);
}

function bridgeWithEnv(customEnv, ...args) {
  const done = spawnSync('python3', ['-I', join(BRIDGE, 'oshal_phone_bridge.py'), ...args], { env: customEnv, encoding: 'utf8', timeout: 60000 });
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
    ['ble-open', { name: 'Notes' }], ['ble-pair-window', { seconds: 120 }], ['ble-devices', {}], ['ble-remove', { address: '7C:4B:26:00:00:01' }]]) {
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
    ['adb-connect-tv', { address: 'not an address' }, 'bad_address'],
    ['adb-connect-tv', { address: '192.168.1.138:99999' }, 'bad_address'],
    ['adb-connect-tv', { address: '' }, 'bad_address'],
    ['adb-tap', { serial: '-H 1.2.3.4', x: 1, y: 1 }, 'bad_serial'],
    ['adb-tap', { serial: '10.0.0.2:5555', x: -1, y: 1 }, 'bad_argument'],
    ['adb-swipe', { serial: '10.0.0.2:5555', x1: 1, y1: 1, x2: 1, y2: 1, ms: 9000 }, 'bad_argument'],
    ['adb-key', { serial: '10.0.0.2:5555', key: 'FORMAT' }, 'unknown_key'],
    ['adb-text', { serial: '10.0.0.2:5555', text: 'café' }, 'cannot_type'],
    ['adb-text', { serial: '10.0.0.2:5555', text: 'a%sb' }, 'cannot_type'],
    ['adb-text', { serial: '10.0.0.2:5555', text: '' }, 'no_text'],
    ['adb-launch', { serial: '10.0.0.2:5555', package: 'com.x; reboot' }, 'bad_package'],
    ['adb-files', { serial: '-H 1.2.3.4' }, 'bad_serial'],
    ['adb-push', { serial: '10.0.0.2:5555', name: '../passwd', data: 'YQ==' }, 'bad_filename'],
    ['adb-push', { serial: '10.0.0.2:5555', name: 'note.txt', data: '!!!' }, 'bad_argument'],
    ['adb-pull', { serial: '10.0.0.2:5555', name: 'sub/note.txt' }, 'bad_filename'],
    ['adb-clipboard-get', { serial: 'bad serial' }, 'bad_serial'],
    ['adb-clipboard-set', { serial: '10.0.0.2:5555', text: '' }, 'bad_argument'],
    ['adb-clipboard-set', { serial: '10.0.0.2:5555', text: 'x'.repeat(4001) }, 'bad_argument'],
    ['frame-chunk', { id: '../../etc', index: 1 }, 'bad_frame'],
    ['frame-chunk', { id: 'abcdef0123456789', index: 1 }, 'frame_gone']
  ];
  for (const [verb, args, code] of cases) assert.equal(bridge(verb, '--b64', b64(args)).error, code, `${verb} ${JSON.stringify(args)}`);
  const words = bridge('adb-text', 'serial=10.0.0.2:5555', 'text=naïve');
  assert.match(words.message, /cannot type ï\. Nothing was sent\./);
  const pyCheck = spawnSync('python3', ['-B', '-I', '-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(BRIDGE)}); import oshal_phone_bridge as b; `
    + 'assert b.tv_address("192.168.1.138") == "192.168.1.138:5555"; '
    + 'assert b.tv_address("192.168.1.138:5556") == "192.168.1.138:5556"; '
    + 'assert b.ANDROID_KEYS["OK"] == 23 and b.ANDROID_KEYS["PLAY_PAUSE"] == 85'], { env, encoding: 'utf8' });
  assert.equal(pyCheck.status, 0, pyCheck.stderr);
  assert.ok(VERBS.includes('ble-remove') && VERBS.includes('adb-connect-tv'));
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

function buildMinimalSof0Jpeg(width, height) {
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof0, Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9])]);
}

test('mirror-start, mirror-frame and mirror-stop enforce valid JPEGs, -fps 8 -bt709 pipeline, and clean process lifecycle', () => {
  assert.equal(bridge('mirror-frame').error, 'mirror_not_running');
  const stubBin = join(runtime, 'stub-uxplay');
  const argvLog = join(runtime, 'uxplay-argv.json');
  writeFileSync(
    stubBin,
    `#!/usr/bin/env python3\nimport json, sys, time\nif "-v" in sys.argv or "-h" in sys.argv:\n    print("UxPlay 1.68.2")\n    raise SystemExit(0)\nopen(${JSON.stringify(argvLog)}, "w").write(json.dumps(sys.argv[1:]))\ntime.sleep(30)\n`
  );
  chmodSync(stubBin, 0o755);
  const mirrorEnv = { ...env, OSHAL_UXPLAY_BIN: stubBin, OSHAL_UXPLAY_SKIP_MDNS_CHECK: '1' };
  const statusBefore = bridgeWithEnv(mirrorEnv, 'status', 'adb=false');
  assert.equal(statusBefore.mirror.ready, true);
  assert.equal(statusBefore.mirror.version, '1.68.2');
  const started = bridgeWithEnv(mirrorEnv, 'mirror-start');
  try {
    assert.equal(started.ok, true, started.message);
    assert.match(started.receiverName, /^OSHAL Mirror \(/);
    const launchedArgs = JSON.parse(readFileSync(argvLog, 'utf8'));
    assert.ok(launchedArgs.includes('-fps') && launchedArgs[launchedArgs.indexOf('-fps') + 1] === '8');
    assert.ok(launchedArgs.includes('-bt709'));
    const sinkArg = launchedArgs[launchedArgs.indexOf('-vs') + 1];
    assert.match(sinkArg, /^videoconvert ! jpegenc quality=75 ! multifilesink /);
    assert.doesNotMatch(sinkArg, /videorate/);
    assert.equal(bridgeWithEnv(mirrorEnv, 'mirror-frame').error, 'no_mirror_frame');
    const mirrorDir = join(runtime, 'oshal-phone-bridge', 'mirror');
    const validJpeg = buildMinimalSof0Jpeg(360, 780);
    writeFileSync(join(mirrorDir, 'frame-00001.jpg'), validJpeg.subarray(0, validJpeg.length - 2));
    assert.equal(bridgeWithEnv(mirrorEnv, 'mirror-frame').error, 'no_mirror_frame', 'truncated JPEG without EOI is refused');
    writeFileSync(join(mirrorDir, 'frame-00002.jpg'), validJpeg);
    const frame = bridgeWithEnv(mirrorEnv, 'mirror-frame', 'width=432');
    assert.equal(frame.ok, true, frame.message);
    assert.equal(frame.deviceWidth, 360);
    assert.equal(frame.deviceHeight, 780);
    assert.equal(frame.sha256, createHash('sha256').update(validJpeg).digest('hex'));
  } finally {
    const stopped = bridgeWithEnv(mirrorEnv, 'mirror-stop');
    assert.equal(stopped.ok, true);
  }
  assert.equal(bridgeWithEnv(mirrorEnv, 'mirror-frame').error, 'mirror_not_running');
});

function createStubAdb(binDir, sdcardDir, clipFile) {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(sdcardDir, { recursive: true });
  const stub = join(binDir, 'adb');
  writeFileSync(stub, [
    '#!/usr/bin/env python3',
    'import os, shutil, sys',
    `sd = ${JSON.stringify(sdcardDir)}`,
    `clip = ${JSON.stringify(clipFile)}`,
    'args = sys.argv[1:]',
    'if "version" in args: print("Android Debug Bridge version 1.0.41\\nVersion 34.0.4"); sys.exit(0)',
    'if "start-server" in args: sys.exit(0)',
    'if args[:2] == ["-s", "10.0.0.2:5555"]: args = args[2:]',
    'if args and args[0] == "push": shutil.copyfile(args[1], os.path.join(sd, os.path.basename(args[2]))); sys.exit(0)',
    'if args and args[0] == "pull":',
    '    src = os.path.join(sd, os.path.basename(args[1]))',
    '    if not os.path.isfile(src): sys.stderr.write("remote object does not exist\\n"); sys.exit(1)',
    '    shutil.copyfile(src, args[2]); sys.exit(0)',
    'cmd = " ".join(args[1:]) if args and args[0] == "shell" else ""',
    'if "stat -c" in cmd:',
    '    for fn in sorted(os.listdir(sd)):',
    '        st = os.stat(os.path.join(sd, fn)); print(f"regular file\\t{st.st_size}\\t{int(st.st_mtime)}\\t/sdcard/Download/{fn}")',
    'elif "get-text" in cmd:',
    '    val = open(clip).read() if os.path.isfile(clip) else ""',
    '    if val == "__DENY__": print("SecurityException: Denying clipboard access"); sys.exit(1)',
    '    print(val, end="")',
    'elif "set-text" in cmd:',
    '    open(clip, "w").write(cmd.split("set-text ", 1)[1].rsplit(" 2>&1", 1)[0].strip("\'"))'
  ].join('\n') + '\n');
  chmodSync(stub, 0o755);
}

test('adb-files, chunked adb-push/adb-pull, and adb-clipboard-* round-trip and refuse honestly', () => {
  const binDir = join(runtime, 'mock-bin');
  const sdcardDir = join(runtime, 'sdcard-download');
  const clipFile = join(runtime, 'clipboard.txt');
  createStubAdb(binDir, sdcardDir, clipFile);
  const adbEnv = { ...env, PATH: `${binDir}:${env.PATH}` };
  const payload = Buffer.from('Hello Android Download transfer! '.repeat(500), 'utf8');
  const first = bridgeWithEnv(adbEnv, 'adb-push', '--b64', b64({
    serial: '10.0.0.2:5555', name: 'report.txt', index: 0, final: false, data: payload.subarray(0, 10000).toString('base64')
  }));
  assert.equal(first.ok, true);
  assert.equal(first.done, false);
  const done = bridgeWithEnv(adbEnv, 'adb-push', '--b64', b64({
    serial: '10.0.0.2:5555', name: 'report.txt', index: 1, final: true, data: payload.subarray(10000).toString('base64')
  }));
  assert.equal(done.ok, true);
  assert.equal(done.done, true);
  const listing = bridgeWithEnv(adbEnv, 'adb-files', '--b64', b64({ serial: '10.0.0.2:5555' }));
  assert.equal(listing.files.length, 1);
  assert.equal(listing.files[0].name, 'report.txt');
  const pulled0 = bridgeWithEnv(adbEnv, 'adb-pull', '--b64', b64({ serial: '10.0.0.2:5555', name: 'report.txt', offset: 0 }));
  const pulled1 = bridgeWithEnv(adbEnv, 'adb-pull', '--b64', b64({ serial: '10.0.0.2:5555', name: 'report.txt', offset: 12288 }));
  assert.equal(pulled0.sha256, createHash('sha256').update(payload).digest('hex'));
  assert.deepEqual(Buffer.concat([Buffer.from(pulled0.data, 'base64'), Buffer.from(pulled1.data, 'base64')]), payload);
  assert.equal(bridgeWithEnv(adbEnv, 'adb-pull', '--b64', b64({ serial: '10.0.0.2:5555', name: 'missing.txt', offset: 0 })).error, 'file_not_found');
  assert.equal(bridgeWithEnv(adbEnv, 'adb-clipboard-set', '--b64', b64({ serial: '10.0.0.2:5555', text: 'CopiedToken123' })).ok, true);
  assert.equal(bridgeWithEnv(adbEnv, 'adb-clipboard-get', '--b64', b64({ serial: '10.0.0.2:5555' })).text, 'CopiedToken123');
  writeFileSync(clipFile, '__DENY__');
  assert.equal(bridgeWithEnv(adbEnv, 'adb-clipboard-get', '--b64', b64({ serial: '10.0.0.2:5555' })).error, 'clipboard_denied');
});

test('rdp-probe verifies real X.224 RDP Connection Confirm on an ephemeral TCP port and refuses closed ports', async () => {
  assert.equal(bridge('rdp-probe', '--b64', b64({ host: 'bad host!' })).error, 'bad_host');
  const rdpServer = net.createServer((sock) => {
    sock.once('data', () => {
      // TPDU 0xD0 X.224 Connection Confirm with protocol = 2 (NLA / CredSSP)
      sock.end(Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x02, 0x01, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00]));
    });
  });
  await new Promise((resolve) => rdpServer.listen(0, '127.0.0.1', resolve));
  const port = rdpServer.address().port;
  const runAsync = (...args) => new Promise((resolve, reject) => {
    execFile('python3', ['-I', join(BRIDGE, 'oshal_phone_bridge.py'), ...args], { env, encoding: 'utf8', timeout: 10000 }, (err, stdout) => {
      if (stdout && stdout.trim()) return resolve(JSON.parse(stdout.trim().split('\n')[0]));
      return reject(err);
    });
  });
  try {
    const ok = await runAsync('rdp-probe', '--b64', b64({ host: '127.0.0.1', port }));
    assert.equal(ok.ok, true);
    assert.equal(ok.reachable, true);
    assert.equal(ok.rdpHandshake, true);
    assert.equal(ok.security, 'NLA (CredSSP)');
    assert.equal(ok.address, `127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => rdpServer.close(resolve));
  }
  const dead = await runAsync('rdp-probe', '--b64', b64({ host: '127.0.0.1', port }));
  assert.equal(dead.ok, false);
  assert.equal(dead.error, 'rdp_unreachable');
});

test('ble-calibrate learns cursor gain into ble-profiles.json, Fire TV NAMED_KEYS exist, and unified primitives dispatch cleanly', () => {
  const py = [
    'import io, json, os, subprocess, sys, types',
    `sys.path.insert(0, ${JSON.stringify(BRIDGE)})`,
    'import oshal_phone_ble, oshal_phone_mirror, oshal_phone_ops',
    'for k in ("Up", "Down", "Left", "Right", "Select", "Back", "Menu", "PlayPause"):',
    '    assert k in oshal_phone_ble.NAMED_KEYS, k',
    'rt = os.path.join(os.environ["XDG_RUNTIME_DIR"], "cal-rt")',
    'mdir = os.path.join(rt, "mirror")',
    'os.makedirs(mdir, exist_ok=True)',
    'open(os.path.join(mdir, "uxplay.pid"), "w").write(str(os.getpid()))',
    'pos = [0, 0]',
    'def write_cursor_jpeg(cx, cy):',
    '    ppm = bytearray([20] * (200 * 400))',
    '    for dy in range(-5, 6):',
    '        for dx in range(-5, 6):',
    '            px, py = max(0, min(199, int(cx) + dx)), max(0, min(399, int(cy) + dy))',
    '            ppm[py * 200 + px] = 245',
    '    pgm = b"P5\\n200 400\\n255\\n" + bytes(ppm)',
    '    jpg = subprocess.check_output(["ffmpeg", "-v", "error", "-f", "pgm_pipe", "-i", "pipe:0", "-frames:v", "1", "-f", "mjpeg", "pipe:1"], input=pgm)',
    '    open(os.path.join(mdir, "frame-00001.jpg"), "wb").write(jpg)',
    'def fake_ble_op(op, args):',
    '    if op == "home": pos[0], pos[1] = 8, 8',
    '    elif op == "mouse": pos[0] += args.get("dx", 0) * 0.5; pos[1] += args.get("dy", 0) * 0.5',
    '    write_cursor_jpeg(pos[0], pos[1])',
    '    return {"ok": True, "phones": [{"address": "7C:4B:26:AA:BB:CC", "name": "Roger iPhone", "connected": True}]}',
    'write_cursor_jpeg(8, 8)',
    'def run_cmd(argv, timeout, data=None, binary=False):',
    '    p = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)',
    '    return (p.returncode, p.stdout, p.stderr) if binary else (p.returncode, p.stdout.decode(), p.stderr.decode())',
    'ctx = types.SimpleNamespace(Refusal=RuntimeError, runtime_dir=lambda: rt, process_argv=lambda pid: ["uxplay"],',
    '    ble_op=fake_ble_op, run=run_cmd, number=lambda a, k, lo, hi, d=None: int(a.get(k, d if d is not None else lo)))',
    'os.environ["OSHAL_BLE_CALIB_SETTLE"] = "0.02"',
    'cal = oshal_phone_ops.verb_ble_calibrate(ctx, {"address": "7C:4B:26:AA:BB:CC"})',
    'assert cal["ok"] is True and 350 <= cal["profile"]["span_x"] <= 450 and 700 <= cal["profile"]["span_y"] <= 900, cal',
    'sx, sy = oshal_phone_ble.span_for(False, address="7C:4B:26:AA:BB:CC")',
    'assert (sx, sy) == (cal["profile"]["span_x"], cal["profile"]["span_y"])',
    'click_calls = []',
    'ctx.ble_op = lambda op, a: (click_calls.append((op, a)) or {"ok": True, "sent": True})',
    'res = oshal_phone_ops.verb_pointer_click(ctx, {"platform": "ios", "address": "7C:4B:26:AA:BB:CC", "x": 100, "y": 200, "width": 200, "height": 400})',
    'assert res["ok"] is True and click_calls[0][0] == "tap" and click_calls[0][1]["nx"] == 0.5 and click_calls[0][1]["ny"] == 0.5',
    'ctx.need_serial = lambda a: a["serial"]',
    'ctx.verb_adb_info = lambda a: {"ok": True, "width": 1920, "height": 1080}',
    'assert oshal_phone_ops.detect_dimensions(ctx, "android", "192.168.1.138:5555", {}) == (1920, 1080, True)'
  ].join('\n');
  const done = spawnSync('python3', ['-B', '-I', '-c', py], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(done.status, 0, done.stderr + done.stdout);
});
