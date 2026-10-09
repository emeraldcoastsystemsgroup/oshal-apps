/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the engine's isolation and plumbing, run with the runner's
 *                     |                             | python3 on Linux (the engine's own platform): a job started through
 *                     |                             | the REAL sandbox_exec.py cannot open an IP socket (AF_INET, AF_INET6,
 *                     |                             | netlink), ptrace or io_uring, while AF_UNIX still works; a malformed
 *                     |                             | launch is refused before anything runs; the seccomp program is well
 *                     |                             | formed for both syscall tables and refuses an unknown machine; the
 *                     |                             | scrub spares PID 1, the bridge and `docker exec` sessions and kills
 *                     |                             | every job process and orphan; collecting a project never follows a
 *                     |                             | symlink; a bad file map and an engine-owned argument are refused; the
 *                     |                             | Node and Python build hashes agree; and the MCP client speaks
 *                     |                             | JSON-RPC to a fake stdio server (answers by id, refuses server
 *                     |                             | requests, times out, reports an exit).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.1.1: create_scene refuses a scenePath that already exists (godot-mcp
 *                     |                             | would silently replace it) and accepts a new one.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PKG = path.resolve(__dirname, '..');
const ENGINE = path.join(PKG, 'engine');
const SANDBOX = path.join(ENGINE, 'sandbox_exec.py');
assert.equal(process.platform, 'linux', 'the engine sandbox is Linux seccomp; run this suite on Linux (CI and the engine box are)');

function py(code, opts = {}) {
  const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(ENGINE)})\nsys.path.insert(0, ${JSON.stringify(path.join(ENGINE, 'container'))})\n${code}`;
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8', ...opts }));
}

const PROBE = [
  'import socket, errno, ctypes, json',
  'r = {}',
  "for name, fam, kind in (('inet', socket.AF_INET, socket.SOCK_STREAM), ('inet6', socket.AF_INET6, socket.SOCK_STREAM), ('netlink', socket.AF_NETLINK, socket.SOCK_RAW)):",
  '    try:',
  "        socket.socket(fam, kind).close(); r[name] = 'OPEN'",
  '    except OSError as e:',
  '        r[name] = errno.errorcode.get(e.errno)',
  "a, b = socket.socketpair(); a.send(b'k'); r['unix'] = b.recv(1).decode()",
  'libc = ctypes.CDLL(None, use_errno=True)',
  "r['ptrace'] = 'ALLOWED' if libc.ptrace(0, 0, 0, 0) == 0 else errno.errorcode.get(ctypes.get_errno())",
  "r['io_uring'] = 'ALLOWED' if libc.syscall(425, 1, ctypes.c_void_p(0)) != -1 else errno.errorcode.get(ctypes.get_errno())",
  'print(json.dumps(r))',
].join('\n');

test('a sandboxed job has no IP networking, no ptrace and no io_uring; AF_UNIX still works', () => {
  const out = JSON.parse(execFileSync('python3', [SANDBOX, '--cpu-seconds', '30', '--', 'python3', '-c', PROBE], { encoding: 'utf8' }));
  assert.deepEqual(out, { inet: 'EACCES', inet6: 'EACCES', netlink: 'EACCES', unix: 'k', ptrace: 'EPERM', io_uring: 'EPERM' });
});

test('a malformed launch is refused before anything runs', () => {
  for (const args of [['--bogus', '1', '--', 'true'], ['--cpu-seconds', '0', '--', 'true'], ['--cpu-seconds', 'x', '--', 'true'], ['--', ], ['true']]) {
    const res = spawnSync('python3', [SANDBOX, ...args], { encoding: 'utf8' });
    assert.equal(res.status, 126, `exit for ${args.join(' ')}`);
    assert.match(res.stderr, /refusing to run the job unsandboxed/);
  }
});

test('the seccomp program is well formed for both syscall tables and refuses an unknown machine', () => {
  const out = py([
    'import sandbox_exec as s',
    'res = {}',
    "for m in ('aarch64', 'x86_64'):",
    '    prog = s.build_filter(m)',
    "    res[m] = {'n': len(prog), 'first': list(prog[0]), 'arch': prog[1][3], 'rets': sorted({k for c, jt, jf, k in prog if c == s.BPF_RET_K}),",
    "              'jumps_ok': all(i + 1 + max(jt, jf) < len(prog) for i, (c, jt, jf, k) in enumerate(prog) if c != s.BPF_RET_K)}",
    'try:',
    "    s.build_filter('sparc'); res['sparc'] = 'built'",
    'except s.SandboxError:',
    "    res['sparc'] = 'refused'",
    'print(json.dumps(res))',
  ].join('\n'));
  for (const [machine, arch] of [['aarch64', 0xC00000B7], ['x86_64', 0xC000003E]]) {
    assert.deepEqual(out[machine].first, [0x20, 0, 0, 4], `${machine}: the program starts by loading the arch`);
    assert.equal(out[machine].arch, arch);
    assert.equal(out[machine].jumps_ok, true, `${machine}: every jump lands inside the program`);
    assert.deepEqual(out[machine].rets, [0x00050001, 0x0005000d, 0x7fff0000, 0x80000000].sort((a, b) => a - b), `${machine}: allow, EPERM, EACCES, kill`);
  }
  assert.equal(out.sparc, 'refused');
});

test('the scrub spares PID 1, the bridge and docker-exec sessions, and kills every job process and orphan', () => {
  const victims = py([
    'from scene_engine_bridge import scrub_victims',
    // pid: (state, ppid). 1 = init, 7 = bridge, 20/21 = a job and its child, 30 = an orphan re-parented to init,
    // 40/41 = a docker-exec session (parent 0) and its child, 50 = a zombie.
    "table = {1: ('S', 0), 7: ('S', 1), 20: ('S', 7), 21: ('S', 20), 30: ('S', 1), 40: ('S', 0), 41: ('R', 40), 50: ('Z', 7)}",
    'print(json.dumps(scrub_victims(7, table)))',
  ].join('\n'));
  assert.deepEqual(victims, [20, 21, 30]);
});

test('collecting a project never follows a symlink and refuses a tree past the limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-collect-'));
  try {
    fs.writeFileSync(path.join(root, 'main.tscn'), '[gd_scene format=3]');
    fs.symlinkSync('/etc/passwd', path.join(root, 'stolen.txt'));
    fs.mkdirSync(path.join(root, 'linked'));
    fs.symlinkSync('/etc', path.join(root, 'linked', 'etc'));
    fs.writeFileSync(path.join(root, 'scene.blend1'), 'backup');
    const got = py(`import scene_ops\nprint(json.dumps(sorted(scene_ops.collect(${JSON.stringify(root)}))))`);
    assert.deepEqual(got, ['main.tscn'], 'symlinks and .blend1 backups are not carried back');
    const over = py(`import scene_ops\nscene_ops.LIMITS['max_total_bytes'] = 4\ntry:\n    scene_ops.collect(${JSON.stringify(root)}); print(json.dumps('collected'))\nexcept scene_ops.OpError as e:\n    print(json.dumps(e.code))`);
    assert.equal(over, 'engine_error');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a bad file map and an engine-owned argument are refused', () => {
  const out = py([
    'import scene_ops as s',
    'res = []',
    "for files in ([{'path': 'a', 'data': '%%%'}], [{'path': 'a', 'data': ''}, {'path': 'a', 'data': ''}], [{'path': '../a', 'data': ''}], 'nope'):",
    '    try:',
    "        s.decode_files(files); res.append('accepted')",
    '    except s.OpError as e:',
    '        res.append(e.code)',
    "job = type('J', (), {'project': '/nonexistent'})()",
    "for server, tool, args in (('godot', 'add_node', {'projectPath': '/etc'}), ('blender', 'execute_blender_code_for_cli', {'blend_file': '/x.blend', 'code': 'x'})):",
    '    try:',
    "        table = s.GODOT_TOOLS if server == 'godot' else s.BLENDER_TOOLS",
    "        s._shape_arguments(server, tool, table[tool], dict(args), job, {}); res.append('accepted')",
    '    except s.OpError as e:',
    "        res.append(e.code + ':' + str(e))",
    'print(json.dumps(res))',
  ].join('\n'));
  assert.deepEqual(out.slice(0, 4), ['refused', 'refused', 'refused', 'refused']);
  assert.match(out[4], /^refused:projectPath is set by Scene Studio/);
  assert.match(out[5], /^refused:blend_file is set by Scene Studio/);
});

test('the Node and Python engine build hashes agree', () => {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
    return load.call(this, request, parent, isMain);
  };
  const { engineBuildHash } = require(path.join(PKG, 'routes', 'engine-build-hash.js'));
  const fromPython = execFileSync('python3', [path.join(ENGINE, 'container', 'scene_engine_bridge.py'), '--build-hash'], { encoding: 'utf8' }).trim();
  assert.match(fromPython, /^[0-9a-f]{64}$/);
  assert.equal(engineBuildHash(ENGINE), fromPython);
});

const FAKE_SERVER = [
  'import sys, json, time',
  'refused = False',
  'for line in sys.stdin:',
  '    msg = json.loads(line)',
  "    m = msg.get('method')",
  '    if m is None:',
  "        refused = refused or (msg.get('id') == 'srv-1' and (msg.get('error') or {}).get('code') == -32601)",
  '        continue',
  "    if 'id' not in msg: continue",
  "    if m == 'initialize':",
  "        print(json.dumps({'jsonrpc': '2.0', 'id': 'srv-1', 'method': 'roots/list'}), flush=True)",
  "        print('not json, a log line', flush=True)",
  "        print(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'serverInfo': {'name': 'fake'}}}), flush=True)",
  "    elif m == 'tools/list':",
  "        print(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'tools': [{'name': 'echo', 'inputSchema': {}}]}}), flush=True)",
  "    elif m == 'tools/call' and msg['params']['name'] == 'echo':",
  "        text = json.dumps({'args': msg['params']['arguments'], 'refused': refused})",
  "        print(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'content': [{'type': 'text', 'text': text}]}}), flush=True)",
  "    elif m == 'tools/call' and msg['params']['name'] == 'slow':",
  '        time.sleep(5)',
  "    elif m == 'tools/call' and msg['params']['name'] == 'die':",
  '        sys.exit(3)',
].join('\n');

test('the MCP client answers by id, refuses server requests, times out and reports an exit', () => {
  const out = py([
    'from mcp_client import McpSession, McpError, content_text',
    'import sys as _s',
    `server = [_s.executable, '-c', ${JSON.stringify(FAKE_SERVER)}]`,
    "s = McpSession(server, {'PATH': '/usr/bin:/bin'}, '/')",
    'res = {"init": s.initialize(5)["serverInfo"]["name"], "tools": [t["name"] for t in s.list_tools(5)]}',
    "res['echo'] = content_text(s.call_tool('echo', {'a': 1}, 5))[0]",
    'try:',
    "    s.call_tool('slow', {}, 1); res['slow'] = 'answered'",
    'except McpError as e:',
    "    res['slow'] = e.code",
    'try:',
    "    s.call_tool('die', {}, 5); res['die'] = 'answered'",
    'except McpError as e:',
    "    res['die'] = e.code",
    's.close()',
    'print(json.dumps(res))',
  ].join('\n'), { timeout: 30_000 });
  assert.deepEqual(out, { init: 'fake', tools: ['echo'], echo: '{"args": {"a": 1}, "refused": true}', slow: 'timeout', die: 'exited' });
});

test('create_scene refuses a scene that already exists and accepts a new path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-create-'));
  try {
    fs.writeFileSync(path.join(root, 'project.godot'), 'config_version=5');
    fs.writeFileSync(path.join(root, 'main.tscn'), '[gd_scene format=3]');
    const out = py([
      'import scene_ops as s',
      `job = type('J', (), {'project': ${JSON.stringify(root)}})()`,
      'res = []',
      "for scene in ('main.tscn', 'res://main.tscn', 'levels/level1.tscn'):",
      '    try:',
      "        a = s._shape_arguments('godot', 'create_scene', s.GODOT_TOOLS['create_scene'], {'scenePath': scene}, job, {})",
      "        res.append('accepted:' + a['scenePath'])",
      '    except s.OpError as e:',
      "        res.append(e.code)",
      'print(json.dumps(res))',
    ].join('\n'));
    assert.deepEqual(out, ['refused', 'refused', 'accepted:levels/level1.tscn']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
