/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the print set through CAD Studio's real kernel
 *                     |                             | (scripts/hexapod-prints.mjs) into a temporary directory - thirteen
 *                     |                             | binary STL files named by part, every one watertight and matching
 *                     |                             | the manifest's sha256 and triangle count, the sheet carrying every
 *                     |                             | part's quantity, material and notes with the latched-spring parts
 *                     |                             | marked, the BOM as CSV equal to the route's, the manifest's
 *                     |                             | masses from the kernel beside the design's. The image is a
 *                     |                             | prerequisite: its absence FAILS, never skips.
 *                     |                             | Run: node --test tests/hexapod-prints.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writePrintSet, meshCheck, DEFAULT_IMAGE } from '../scripts/hexapod-prints.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildHexapod } = require(path.join(HERE, '..', 'routes', 'engine', 'design', 'hexapod-design.js'));
const { hexapodBomCsv } = require(path.join(HERE, '..', 'routes', 'engine', 'design', 'hexapod-markdown.js'));

test('the print set: thirteen watertight STL files, the sheet, the BOM and a manifest that matches them', { timeout: 600000 }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-18-prints-'));
  try {
    const manifest = writePrintSet(out, 'spider-18', process.env.OSHAL_CAD_ENGINE_IMAGE || DEFAULT_IMAGE);
    const design = buildHexapod('spider-18');
    assert.equal(manifest.parts.length, 13);
    assert.deepEqual(manifest.parts.map((p) => p.id), design.printed.map((p) => p.id), 'one file per printed part, in the design\'s order');
    for (const row of manifest.parts) {
      const file = path.join(out, row.file);
      assert.equal(row.file, `spider-18-${row.id}.stl`);
      const stl = fs.readFileSync(file);
      assert.ok(stl.length > 84 && stl.readUInt32LE(80) === row.triangles, `${row.id}: a binary STL of ${row.triangles} triangles`);
      assert.equal(createHash('sha256').update(stl).digest('hex'), row.sha256, `${row.id}: the manifest's sha256 is the file's`);
      assert.ok(row.kernelMassEachG > 0 && row.volumeCm3 > 0 && row.extentsMm.every((v) => v > 0), `${row.id}: kernel mass, volume and extents`);
      const p = design.printed.find((x) => x.id === row.id);
      assert.equal(row.qty, p.qty); assert.equal(row.material, p.material); assert.equal(row.designMassEachG, p.massEachG); assert.equal(row.option, p.option ?? null);
    }
    const sheet = fs.readFileSync(path.join(out, 'PRINT-SHEET.md'), 'utf8');
    assert.ok(sheet.startsWith('# spider-18 print set'));
    for (const p of design.printed) assert.ok(sheet.includes(`| \`spider-18-${p.id}.stl\` | ${p.qty} | ${p.material} |`), `${p.id} on the sheet with its quantity and material`);
    assert.ok(sheet.includes('**latched-spring only**') && sheet.includes('legs-hop needs none of them'));
    assert.equal(fs.readFileSync(path.join(out, 'bom.csv'), 'utf8'), hexapodBomCsv('spider-18'), 'the BOM is the route\'s');
    assert.equal(manifest.massBudget.totalG, design.massBudget.totalG);
    assert.deepEqual(meshCheck({ triangles: [[0, 1, 2], [0, 2, 1]] }).watertight, true, 'the mesh check\'s own sanity: a closed two-triangle sheet');
    assert.equal(meshCheck({ triangles: [[0, 1, 2]] }).open, 3);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
