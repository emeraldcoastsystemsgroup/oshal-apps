/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify actual binary PSD bounds, pixel decoding and editable native group geometry/history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPsd, decodePsdRow, psdDocument, PSD_LIMITS } from '../../tools/editor/psd-reader.mjs';
import { validateProject } from '../../tools/editor/model-validation.mjs';
import { applyOperation } from '../../tools/editor/model.mjs';
import { createHistory } from '../../tools/editor/history.mjs';
import { worldLayer } from '../../tools/editor/group-geometry.mjs';
import { makePsd, groupedPsd } from '../fixtures/psd-fixtures.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const asset = (id, width, height) => ({ id, width, height, src: '/api/create/project-assets/' + id });
const id1 = '12345678-1234-4234-8234-123456789abc', id2 = '22345678-1234-4234-8234-123456789abc';
test('independent Pillow decoder opens genuine raw/RLE PSD and agrees on composite pixels', t => {
  const probe = spawnSync('python3', ['-c', 'from PIL import Image'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('Independent Pillow decoder is not installed; no independent decode pass claimed'); return; }
  for (const rle of [false, true]) {
    const result = spawnSync('python3', ['-c', 'from PIL import Image\nfrom io import BytesIO\nimport sys,json\nim=Image.open(BytesIO(sys.stdin.buffer.read()))\nprint(json.dumps({"size":im.size,"pixels":list(im.getdata())}))'],
      { input: makePsd({ rle, color: [10, 20, 30], layers: [{}] }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const decoded = JSON.parse(result.stdout);
    assert.deepEqual(decoded.size, [2, 2]); assert.deepEqual(decoded.pixels, Array(4).fill([10, 20, 30]));
  }
});
test('licensed upstream Pillow PSD has exact independent pixels; its ZIP RGBA fixture is explicitly refused', t => {
  const bytes=readFileSync(new URL('../fixtures/pillow-hopper-merged.psd',import.meta.url)),parsed=readPsd(bytes);
  assert.equal(parsed.width,128);assert.equal(parsed.height,128);assert.equal(parsed.editable,true);assert.equal(parsed.layers.length,1);
  assert.throws(()=>readPsd(readFileSync(new URL('../fixtures/pillow-rgba.psd',import.meta.url))),/psd_compression_unsupported/);
  const decoded=spawnSync('python3',['-c','from PIL import Image\nfrom io import BytesIO\nimport sys\nsys.stdout.buffer.write(Image.open(BytesIO(sys.stdin.buffer.read())).convert("RGBA").tobytes())'],{input:bytes});
  if(decoded.status!==0){t.skip('Independent Pillow decoder unavailable; no upstream pixel pass claimed');return;}
  assert.deepEqual(Buffer.from(parsed.merged),decoded.stdout);assert.deepEqual(Buffer.from(parsed.layers[0].rgba),decoded.stdout);
});
test('raw and PackBits pixel layers preserve RGB, transparency and opacity independently', () => {
  for (const rle of [false, true]) {
    const value = readPsd(makePsd({ rle, layers: [{ color: [10, 20, 30, 64], opacity: 128 }] }));
    assert.equal(value.editable, true); assert.deepEqual([...value.layers[0].rgba], Array(4).fill([10, 20, 30, 64]).flat());
    assert.equal(value.layers[0].opacity, 128 / 255); assert.deepEqual([...value.merged], Array(4).fill([255, 0, 0, 255]).flat());
  }
});
test('Unicode names, isolated group order, fixed placement and native editing/history persist', () => {
  const parsed = readPsd(groupedPsd()); assert.equal(parsed.editable, true);
  const doc = validateProject(psdDocument(parsed, new Map([[1, asset(id1, 2, 2)], [3, asset(id2, 4, 4)]]), 'Imported'), { mode: 'reference' });
  assert.deepEqual(doc.layers.map(l => l.id), ['psd-3', 'psd-1', 'psd-0']);
  assert.equal(doc.layers[2].name, 'Grüppe 🎨'); assert.equal(doc.layers[2].opacity, 128 / 255);
  assert.equal(worldLayer(doc, 'psd-1').x, 1); assert.equal(worldLayer(doc, 'psd-1').y, 1);
  const history = createHistory(doc), next = history.commit(applyOperation(doc, { type: 'update', id: 'psd-1', patch: { x: 1, opacity: .25 } }));
  assert.equal(worldLayer(next, 'psd-1').x, 2); assert.equal(next.layers[1].opacity, .25);
  assert.equal(history.undo().layers[1].opacity, 1); assert.equal(history.redo().layers[1].opacity, .25);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next)), { mode: 'reference' }), next);
});
test('text, effects, masks, clipping and non-normal modes refuse editable import with deterministic reports', () => {
  for (const option of [{ tag: 'TySh' }, { tag: 'lrFX' }, { mask: Buffer.alloc(20) }, { clipping: 1 }, { blend: 'mul ' }]) {
    const bytes = makePsd({ layers: [option] }), parsed = readPsd(bytes);
    assert.equal(parsed.editable, false); assert.equal(parsed.flattenable, true); assert.ok(parsed.report.length);
    assert.deepEqual(readPsd(bytes).report, parsed.report);
    assert.throws(() => psdDocument(parsed, new Map(), 'No'), /psd_editable_unsupported/);
  }
});
test('pass-through groups and malformed group nesting are explicit unsupported outcomes', () => {
  for (const layers of [[{ section: 1, blend: 'pass' }, {}, { section: 3 }], [{ section: 3 }, {}], [{ section: 1 }, {}], [{ section: 1 }, { section: 3 }]]) {
    const parsed = readPsd(makePsd({ layers })); assert.equal(parsed.editable, false);
  }
});
test('transparent merged caches are not advertised as faithful flattened fallback', () => {
  const parsed = readPsd(makePsd({ mergedAlpha: true, color: [255, 255, 255, 128], layers: [{}] }));
  assert.equal(parsed.editable, true); assert.equal(parsed.flattenable, false);
});
test('adversarial truncation, sizes, channels and RLE refuse without expansion', () => {
  const bytes = groupedPsd();
  for (let n = 0; n < bytes.length; n++) assert.throws(() => readPsd(bytes.subarray(0, n)));
  assert.throws(() => readPsd(Buffer.concat([bytes, Buffer.from([0])])));
  assert.throws(() => readPsd(Buffer.alloc(PSD_LIMITS.bytes + 1)), /psd_file_limit/);
  assert.throws(() => readPsd(makePsd({ width: 2049 })), /psd_canvas_limit/);
  assert.throws(() => readPsd(makePsd({ depth: 16 })), /psd_color_mode_unsupported/);
  assert.throws(() => readPsd(makePsd({ mode: 4 })), /psd_color_mode_unsupported/);
  assert.throws(() => decodePsdRow(Uint8Array.of(255, 1), 1));
  assert.throws(() => decodePsdRow(Uint8Array.of(2, 1, 2), 3));
  assert.throws(() => decodePsdRow(Uint8Array.of(128), 1));
  assert.deepEqual([...decodePsdRow(Uint8Array.of(128, 254, 7), 3)], [7, 7, 7]);
});
