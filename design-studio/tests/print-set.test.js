/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: the print set as data, against the COMPILED modules with no framework import. An STL is parsed back (binary and ASCII) and checked watertight - a box of twelve triangles passes, the same box with one triangle dropped has three open edges and is named so, a degenerate triangle is counted, bytes that are not an STL are refused; the set input and a part's meta are refused by field (engine, an empty part list, a count of 0, an id with a slash, a duplicate, too many parts, a model id that is not a UUID, a report without the kernel's verdict); a file name derives only from a validated part id; on a temporary directory a set is begun, a watertight part is kept with its sha256 and the kernel's figures, a non-watertight one is recorded unprintable with the fault and its bytes dropped, finish is refused while a programmed part has neither a file nor a reason, then the sheet (the parts' own fields, "not stated" where the design says nothing, the unprintable section), the BOM (printed, unprintable and bought rows) and the manifest (every file's sha256) are written and the listing carries the manifest's own sha256; a hand-off is kept only for a file of the set; beginning again wipes the set; the data root resolves from the explicit variable, the native lasting directory, the shared workspace or the local fallback.
 *
 * Run: node --test tests/print-set.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Mesh = require('../routes/print-set-mesh.js');
const Model = require('../routes/print-set-model.js');
const Store = require('../routes/print-set-store.js');
const STL = require('./stl.fixture.js');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const PROJECT = '0f3f6b2a-5a1e-4d7c-9b2f-1c2d3e4f5a6b';
const MODEL = '7d1e2c3b-4a5f-4e6d-8c9b-0a1b2c3d4e5f';
const partRow = (id, extra = {}) => ({ id, name: `${id} part`, qty: 2, material: 'PETG', printNotes: 'upright, 6 walls', program: true, ...extra });
const meta = (report = STL.boxReport()) => ({ source: { engine: 'cad-studio', modelId: MODEL, revision: 1, route: `/api/cad-studio/models/${MODEL}/artifacts/stl?revision=1`, title: 'Hook' }, report });

test('an STL is parsed back and checked watertight: a box passes, a dropped triangle opens three edges, bytes that are not an STL are refused', () => {
  const box = Mesh.meshCheck(Mesh.parseStl(STL.boxStl()));
  assert.deepEqual(box, { open: 0, nonManifold: 0, degenerate: 0, watertight: true, triangles: 12 });
  assert.equal(Mesh.parseStl(STL.boxStl()).vertexCount, 8, 'eight welded corners');
  const open = Mesh.meshCheck(Mesh.parseStl(STL.openStl()));
  assert.equal(open.watertight, false); assert.equal(open.open, 3); assert.equal(open.triangles, 11);
  assert.equal(Mesh.meshFault(open), 'the exported STL is not watertight: 3 open edges');
  assert.equal(Mesh.meshCheck(Mesh.parseStl(STL.asciiBoxStl())).watertight, true, 'ASCII reads the same');
  const degenerate = Mesh.meshCheck({ vertexCount: 3, triangles: [[0, 1, 2], [0, 2, 1], [1, 1, 2]] });
  assert.equal(degenerate.degenerate, 1); assert.equal(degenerate.watertight, false);
  assert.throws(() => Mesh.parseStl(Buffer.from('hello')), /not an STL/);
  const lying = Buffer.alloc(84); lying.writeUInt32LE(5, 80);
  assert.throws(() => Mesh.parseStl(lying), /5 triangles declared/);
  assert.equal(Mesh.sha256Hex(Buffer.from('x')), sha(Buffer.from('x')));
});

test('the set input and a part\'s meta are refused by field; a file name derives only from a validated part id', () => {
  const field = (fn, code, f) => { try { fn(); assert.fail('accepted'); } catch (e) { assert.equal(e.code, code); assert.equal(e.field, f); return e; } };
  const base = { engine: 'embodied', designRevision: 'r1', designRoute: '/api/embodied/build/hexapod?fit=x', parts: [partRow('plate')], bought: [] };
  field(() => Model.validateSetInput({ ...base, engine: 'circuit-lab' }), 'bad_print_set', 'engine');
  field(() => Model.validateSetInput({ ...base, parts: [] }), 'bad_print_set', 'parts');
  field(() => Model.validateSetInput({ ...base, parts: [partRow('plate', { qty: 0 })] }), 'bad_print_set', 'parts[0].qty');
  field(() => Model.validateSetInput({ ...base, parts: [partRow('../plate')] }), 'bad_print_set', 'parts[0].id');
  field(() => Model.validateSetInput({ ...base, parts: [partRow('plate'), partRow('plate')] }), 'bad_print_set', 'parts');
  field(() => Model.validateSetInput({ ...base, designRevision: '' }), 'bad_print_set', 'designRevision');
  const many = field(() => Model.validateSetInput({ ...base, parts: Array.from({ length: 65 }, (_, i) => partRow(`p${i}`)) }), 'too_many_parts', 'parts');
  assert.equal(many.status, 413);
  const ok = Model.validateSetInput({ ...base, parts: [partRow('plate', { orientation: 'collars up', layerHeightMm: 0.2, supports: false, massEachG: 68 }), { id: 'foot', name: 'Foot', qty: 6 }], bought: [{ id: 'servo', name: 'bus servo', qty: 18, massEachG: 55, approxUsdEach: 20, role: 'every joint' }] });
  assert.deepEqual(ok.parts[1], { id: 'foot', name: 'Foot', qty: 6, material: null, printNotes: null, option: null, link: null, massEachG: null, orientation: null, layerHeightMm: null, supports: null, program: false }, 'an unstated field is null, never invented');
  assert.equal(ok.parts[0].supports, false); assert.equal(ok.bought[0].source, null);
  field(() => Model.validatePartMeta({ source: { engine: 'embodied', modelId: MODEL, revision: 1, route: '/x' }, report: STL.boxReport() }), 'bad_print_set', 'meta.source.engine');
  field(() => Model.validatePartMeta({ source: { engine: 'cad-studio', modelId: 'm1', revision: 1, route: '/x' }, report: STL.boxReport() }), 'bad_print_set', 'meta.source.modelId');
  field(() => Model.validatePartMeta({ source: { engine: 'cad-studio', modelId: MODEL, revision: 0, route: '/x' }, report: STL.boxReport() }), 'bad_print_set', 'meta.source.revision');
  field(() => Model.validatePartMeta({ source: { engine: 'cad-studio', modelId: MODEL, revision: 1, route: '/x' }, report: { massG: 1 } }), 'bad_print_set', 'meta.report.valid');
  const m = Model.validatePartMeta(meta());
  assert.equal(m.source.modelId, MODEL); assert.equal(m.report.massG, 4.96); assert.deepEqual(m.report.extentsMm.max, [10, 10, 10]);
  assert.equal(Model.fileFor('coxa-bracket'), 'coxa-bracket.stl'); assert.equal(Model.fileFor(MODEL), `${MODEL}.stl`);
  assert.throws(() => Model.fileFor('../x'), /lowercase letters, digits and dashes/);
  assert.throws(() => Model.fileFor('PRINT-SHEET.md'), /lowercase/);
});

test('on disk: a set is begun, a watertight part is kept with its sha256, a non-watertight one is unprintable with the fault, finish refuses while a part is unaccounted, then the sheet, the BOM and the manifest are written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-studio-print-set-'));
  try {
    const dir = Store.setDir(root, 'roger-test', PROJECT);
    assert.equal(path.basename(dir), PROJECT); assert.equal(path.basename(path.dirname(dir)), Store.subHash('roger-test'));
    assert.throws(() => Store.setDir(root, 'roger-test', '../x'), /project id/);
    assert.equal(Store.listing(dir), null);
    const input = Model.validateSetInput({ engine: 'embodied', designRevision: 'r7', designRoute: '/api/embodied/build/hexapod?fit=fixture', parts: [partRow('plate', { massEachG: 68, orientation: 'collars up' }), partRow('foot', { material: 'TPU 95A', qty: 6, option: 'latched-spring' }), { id: 'latch', name: 'Latch pawl', qty: 1, program: false }], bought: [{ id: 'servo', name: 'bus servo', qty: 18, massEachG: 55, approxUsdEach: 20, role: 'every joint', source: 'the catalog' }] });
    const state = Store.beginSet(dir, { id: PROJECT, name: 'spider (fixture)' }, input);
    assert.equal(state.schema, 'design-studio-print-set/1'); assert.ok(fs.existsSync(path.join(dir, 'set.json')));
    assert.equal(Store.listing(dir).finished, false); assert.deepEqual(Store.listing(dir).pending, ['plate', 'foot', 'latch']);
    const m = Model.validatePartMeta(meta());
    const box = STL.boxStl(20, 20, 10);
    const kept = Store.addPart(dir, 'plate', box, m.source, m.report);
    assert.equal(kept.status, 'exported'); assert.equal(kept.file, 'plate.stl'); assert.equal(kept.sha256, sha(box)); assert.equal(kept.triangles, 12); assert.equal(kept.bytes, box.length);
    assert.deepEqual(kept.extentsMm, [20, 20, 10]); assert.equal(kept.kernelMassEachG, 4.96); assert.equal(kept.volumeCm3, 4); assert.equal(kept.densityGcm3, 1.24);
    assert.ok(fs.readFileSync(path.join(dir, 'plate.stl')).equals(box), 'the bytes on disk are the bytes sent');
    assert.throws(() => Store.finishSet(dir), (e) => e.code === 'set_incomplete' && /missing: foot/.test(e.message) && !/plate|latch/.test(e.message), 'a programmed part with neither a file nor a reason blocks the finish; one without a program does not');
    const bad = Store.addPart(dir, 'foot', STL.openStl(), m.source, m.report);
    assert.deepEqual(bad, { status: 'unprintable', reason: 'the exported STL is not watertight: 3 open edges' });
    assert.equal(fs.existsSync(path.join(dir, 'foot.stl')), false, 'a bad mesh is never kept');
    const invalid = Store.addPart(dir, 'foot', box, m.source, { ...m.report, valid: false });
    assert.match(invalid.reason, /kernel reports the solid as not valid/);
    assert.throws(() => Store.addPart(dir, 'head', box, m.source, m.report), (e) => e.code === 'part_not_in_set' && e.status === 409);
    const again = Store.addPart(dir, 'foot', STL.boxStl(16, 16, 16), m.source, STL.boxReport(16, 16, 16, 1.2));
    assert.equal(again.status, 'exported');
    const { manifest, manifestSha256 } = Store.finishSet(dir);
    assert.equal(manifestSha256, sha(fs.readFileSync(path.join(dir, 'manifest.json'))), 'the sha is the manifest file\'s');
    assert.deepEqual(manifest.parts.map((p) => p.file), ['plate.stl', 'foot.stl']);
    assert.deepEqual(manifest.unprintable, [{ id: 'latch', name: 'Latch pawl', qty: 1, reason: 'no CAD program in the design for this part' }], 'a part without a program is listed, never skipped');
    assert.deepEqual(manifest.files.map((f) => f.file), ['plate.stl', 'foot.stl', 'PRINT-SHEET.md', 'bom.csv']);
    for (const f of manifest.files) assert.equal(f.sha256, sha(fs.readFileSync(path.join(dir, f.file))), f.file);
    assert.deepEqual(manifest.totals, { files: 4, stlFiles: 2, pieces: 8, kernelMassG: Math.round(2 * 4.96 + 6 * 4.92), unprintable: 1, watertight: 2 });
    const sheet = fs.readFileSync(path.join(dir, 'PRINT-SHEET.md'), 'utf8');
    assert.ok(sheet.startsWith('# spider (fixture) print set (design revision r7'));
    assert.ok(sheet.includes('| `plate.stl` | 2 | PETG | collars up | not stated | not stated | 20 × 20 × 10 | 5 g at 1.24 g/cm³ (design 68 g) | upright, 6 walls |'), sheet);
    assert.ok(sheet.includes('| `foot.stl` | 6 | TPU 95A | not stated | not stated | not stated | 16 × 16 × 16 | 5 g at 1.2 g/cm³ (design not stated) | **latched-spring only** · upright, 6 walls |'), sheet);
    assert.ok(sheet.includes('**Core build:** 2 pieces from 1 file') && sheet.includes('**The latched-spring option adds** 6 pieces from 1 file'));
    assert.ok(sheet.includes('- **Latch pawl** (`latch`, × 1): no CAD program in the design for this part'));
    const bom = fs.readFileSync(path.join(dir, 'bom.csv'), 'utf8').split('\n');
    assert.equal(bom[0], 'id,kind,name,qty,massEachG,totalG,approxUsdEach,approxUsdTotal,option,role,source,file');
    assert.equal(bom[1], 'plate,printed,plate part,2,5,10,,,,,CAD Studio kernel,plate.stl');
    assert.equal(bom[3], 'latch,unprintable,Latch pawl,1,,,,,,,no CAD program in the design for this part,');
    assert.equal(bom[4], 'servo,bought,bus servo,18,55,990,20,360,,every joint,the catalog,');
    const list = Store.listing(dir);
    assert.equal(list.finished, true); assert.equal(list.manifestSha256, manifestSha256); assert.equal(list.exported, 2); assert.deepEqual(list.unprintable.map((u) => u.id), ['latch']);
    assert.deepEqual([...Store.servedFiles(manifest)].sort(), ['PRINT-SHEET.md', 'bom.csv', 'foot.stl', 'manifest.json', 'plate.stl']);
    assert.throws(() => Store.addPart(dir, 'plate', box, m.source, m.report), (e) => e.code === 'print_set_finished');
    const sent = Store.recordSent(dir, Model.validateSent({ file: 'plate.stl', printerId: 'prn-1', printerLabel: 'Bench', uploaded: true, started: false, message: 'waits on the printer' }, Store.servedFiles(manifest)));
    assert.equal(sent.length, 1); assert.equal(Store.listing(dir).sent[0].file, 'plate.stl');
    assert.throws(() => Model.validateSent({ file: 'other.stl', printerId: 'prn-1' }, Store.servedFiles(manifest)), (e) => e.field === 'file');
    Store.beginSet(dir, { id: PROJECT, name: 'spider (fixture)' }, input);
    assert.equal(Store.listing(dir).finished, false); assert.equal(fs.existsSync(path.join(dir, 'plate.stl')), false, 'begin wipes the set');
    assert.equal(Store.readManifest(dir), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the data root resolves from the explicit variable, the native lasting directory, the shared workspace or the local fallback', () => {
  assert.equal(Store.resolveDataRoot({ DESIGN_STUDIO_DATA_DIR: '/data/ds' }, () => false), path.resolve('/data/ds'));
  assert.equal(Store.resolveDataRoot({ OSHAL_PACKAGE_DATA_DIR: '/var/lib/oshal-package-data' }, () => false), path.resolve('/var/lib/oshal-package-data/print-sets'));
  assert.equal(Store.resolveDataRoot({ SHARED_WORKSPACE_ROOT: '/ws' }, () => false), path.resolve('/ws/design-studio'));
  assert.equal(Store.resolveDataRoot({}, (p) => p === '/app/workspace-shared'), '/app/workspace-shared/design-studio');
  assert.equal(Store.resolveDataRoot({}, () => false), path.join(path.resolve(process.cwd(), 'workspace-shared'), 'design-studio'));
});
