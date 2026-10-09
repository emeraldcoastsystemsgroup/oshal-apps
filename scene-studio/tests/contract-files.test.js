/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the project file contract both halves enforce: the api's
 *                     |                             | validatePath (routes/project-files.js) and the engine's validate_path
 *                     |                             | (engine/scene_ops.py, run with the runner's python3) accept and refuse
 *                     |                             | the SAME paths and normalise them the same way; their limits agree;
 *                     |                             | the map helpers keep sorted, validated, bounded maps; a revision blob
 *                     |                             | round-trips and two writes of one revision never share a name.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const files = require(path.resolve(__dirname, '..', 'routes', 'project-files.js'));
const ENGINE = path.resolve(__dirname, '..', 'engine');

/** Run python3 over the engine's scene_ops with a JSON payload; returns the JSON it prints. */
function python(code, payload) {
  const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(ENGINE)})\nimport scene_ops\npayload = json.loads(sys.stdin.read())\n${code}`;
  return JSON.parse(execFileSync('python3', ['-c', script], { input: JSON.stringify(payload), encoding: 'utf8' }));
}

const CASES = [
  'main.tscn', 'res://main.tscn', 'levels/level 1.tscn', 'assets/tex_01.png', 'scripts/player.gd', '.godot/imported/x.ctex',
  'a/b/c/d/e/f/g/h/i/j/k/l', 'x'.repeat(120), 'models/boat (v2).glb', 'a+b,c=d~e@f[1].txt',
  '', '/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'a/.', 'a\\b', 'a\u0000b', 'a/b/c/d/e/f/g/h/i/j/k/l/m',
  'x'.repeat(121), `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(41)}`, 'é.txt', 'a:b', 'a*b', '$HOME', 'a\nb', 'res://../x', 'res:///abs', 42,
];

function tsVerdict(raw) {
  try { return { ok: true, path: files.validatePath(raw) }; } catch (e) { return { ok: false, error: e.constructor.name }; }
}

test('the api and the engine accept and refuse exactly the same paths, normalised the same way', () => {
  const py = python(
    'out = []\nfor raw in payload:\n    try:\n        out.append({"ok": True, "path": scene_ops.validate_path(raw)})\n    except scene_ops.OpError:\n        out.append({"ok": False})\nprint(json.dumps(out))',
    CASES,
  );
  CASES.forEach((raw, i) => {
    const ts = tsVerdict(raw);
    assert.equal(ts.ok, py[i].ok, `verdicts differ for ${JSON.stringify(raw)}: api ${ts.ok}, engine ${py[i].ok}`);
    if (ts.ok) assert.equal(ts.path, py[i].path, `normalised forms differ for ${JSON.stringify(raw)}`);
    else assert.equal(ts.error, 'FileError');
  });
  assert.equal(tsVerdict('res://main.tscn').path, 'main.tscn');
  assert.equal(CASES.filter((raw) => tsVerdict(raw).ok).length, 10, 'the ten safe paths pass; every other case is refused');
});

test('the api limits equal the engine limits', () => {
  const py = python('print(json.dumps(scene_ops.LIMITS))', null);
  assert.equal(files.FILE_LIMITS.maxFiles, py.max_files);
  assert.equal(files.FILE_LIMITS.maxFileBytes, py.max_file_bytes);
  assert.equal(files.FILE_LIMITS.maxTotalBytes, py.max_total_bytes);
  assert.equal(files.FILE_LIMITS.maxPathChars, py.max_path_chars);
  assert.equal(files.FILE_LIMITS.maxDepth, py.max_depth);
});

test('the map helpers keep a sorted, validated map and refuse duplicates and size breaches', () => {
  let map = files.withFile([], 'main.tscn', Buffer.from('[gd_scene format=3]'));
  map = files.withFile(map, 'a.gd', Buffer.from('extends Node'));
  map = files.withFile(map, 'res://main.tscn', Buffer.from('[gd_scene format=3]\n'));
  assert.deepEqual(map.map((f) => f.path), ['a.gd', 'main.tscn'], 'sorted, and res:// replaced the same file');
  assert.equal(files.fileData(map, 'main.tscn').toString(), '[gd_scene format=3]\n');
  assert.equal(files.fileData(map, 'nope.gd'), null);
  assert.deepEqual(files.summarize(map), { fileCount: 2, totalBytes: 12 + 20 });
  assert.throws(() => files.withoutFile(map, 'nope.gd'), (e) => e instanceof files.FileError && e.status === 404);
  assert.deepEqual(files.withoutFile(map, 'a.gd').map((f) => f.path), ['main.tscn']);
  assert.throws(() => files.assertWithinLimits([{ path: 'x', data: '' }, { path: 'x', data: '' }]), /duplicate/);
  assert.throws(() => files.assertWithinLimits([{ path: '../x', data: '' }]), /unsafe segment/);
  const big = Buffer.alloc(files.FILE_LIMITS.maxFileBytes + 1).toString('base64');
  assert.throws(() => files.assertWithinLimits([{ path: 'big.bin', data: big }]), (e) => e.status === 413);
});

test('text detection and the listing hide derived Godot state and cap what they show', () => {
  assert.equal(files.isText(Buffer.from('extends Node3D\n')), true);
  assert.equal(files.isText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), false);
  assert.equal(files.isText(Buffer.from([0xff, 0xfe, 0x41])), false);
  const map = [{ path: '.godot/imported/a.ctex', data: '' }, { path: 'main.tscn', data: 'eA==' }];
  assert.deepEqual(files.listing(map), { files: [{ path: 'main.tscn', bytes: 1 }], hidden: 1, more: 0 });
});

test('a revision blob round-trips; two writes of one revision never share a name; bad names are refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-blobs-'));
  try {
    const map = [{ path: 'main.tscn', data: Buffer.from('[gd_scene format=3]').toString('base64') }];
    const a = files.writeRevisionBlob(dir, 3, map);
    const b = files.writeRevisionBlob(dir, 3, map);
    assert.notEqual(a, b);
    assert.match(a, /^3-[0-9a-f]{12}\.json\.gz$/);
    assert.deepEqual(files.readRevisionBlob(dir, a), map);
    assert.throws(() => files.readRevisionBlob(dir, '../../etc/passwd'), /invalid/);
    files.removeRevisionBlobs(dir, [a, '../escape.json.gz']);
    assert.equal(fs.existsSync(path.join(dir, a)), false);
    assert.equal(fs.existsSync(path.join(dir, b)), true);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'no temp file is left behind');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
