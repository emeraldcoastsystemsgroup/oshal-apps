/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 spider-18: the print set. The thirteen part programs go
 *                     |                             | through CAD Studio's real kernel once (the engine image, isolated,
 *                     |                             | removed on exit, as the OCCT guard runs it) and come back as
 *                     |                             | binary STL files a slicer takes, each checked watertight, beside
 *                     |                             | a print sheet (quantities, material, the kernel's solid mass next
 *                     |                             | to the design's estimate, extents, print notes, which parts the
 *                     |                             | latched-spring option adds), the bill of materials as CSV and a
 *                     |                             | manifest with every file's sha256. Nothing is typed by hand: the
 *                     |                             | design is the source. Run: node scripts/hexapod-prints.mjs <out-dir>
 *                     |                             | (image override: OSHAL_CAD_ENGINE_IMAGE).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const { buildHexapod } = require(path.join(PKG, 'routes', 'engine', 'design', 'hexapod-design.js'));
const { hexapodBomCsv } = require(path.join(PKG, 'routes', 'engine', 'design', 'hexapod-markdown.js'));

/** The engine image the OCCT guard uses; PETG's density for the kernel's mass figure. */
export const DEFAULT_IMAGE = 'oshal-cad-studio-engine:local';
export const PETG_G_CM3 = 1.27;
export const STL_TOLERANCE_MM = 0.05;

/** @description A binary or ASCII STL as welded vertices and triangles. */
function parseStl(buf) {
  const facets = [];
  if (buf.subarray(0, 5).toString() === 'solid' && buf.toString('latin1').includes('facet')) {
    const v = [...buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    for (let i = 0; i < v.length; i += 3) facets.push([v[i], v[i + 1], v[i + 2]]);
  } else {
    for (let i = 0; i < buf.readUInt32LE(80); i += 1) {
      const o = 84 + i * 50 + 12;
      facets.push([0, 1, 2].map((k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)]));
    }
  }
  const index = new Map(); let count = 0;
  const id = (p) => { const key = p.join(','); if (!index.has(key)) { index.set(key, count); count += 1; } return index.get(key); };
  return { vertexCount: count, triangles: facets.map((f) => f.map(id)) };
}

/** @description Watertight: every edge shared by exactly two triangles, no degenerate triangle. */
export function meshCheck(mesh) {
  const edges = new Map(); let degenerate = 0;
  for (const [a, b, c] of mesh.triangles) {
    if (a === b || b === c || a === c) { degenerate += 1; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? `${u}-${v}` : `${v}-${u}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
  }
  let open = 0; let nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) open += 1; else if (n > 2) nonManifold += 1; }
  return { open, nonManifold, degenerate, watertight: open === 0 && nonManifold === 0 && degenerate === 0, triangles: mesh.triangles.length };
}

/**
 * @description Build every printed part through the engine image once. @param design - buildHexapod's answer.
 * @param image - The engine image. @returns Map of part id to the worker's answer. @throws when the image is absent or the container fails.
 */
export function buildParts(design, image = DEFAULT_IMAGE) {
  const inspect = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
  if (inspect.status !== 0) throw new Error(`prerequisite missing: the CAD Studio engine image ${image} (build it with cad-studio/engine/install-engine.sh, or set OSHAL_CAD_ENGINE_IMAGE) and a running Docker`);
  const input = design.printed.map((p) => JSON.stringify({ id: p.id, cmd: 'rebuild', args: { base: p.cad.base, features: p.cad.features, exports: ['stl'], densityGcm3: PETG_G_CM3, stlToleranceMm: STL_TOLERANCE_MM } })).join('\n') + '\n';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '1g', '--entrypoint', 'python', image, '/opt/cad-studio/engine/cad_worker.py'], { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600000 });
  if (run.status !== 0) throw new Error(`the engine container failed: ${run.stderr || run.error}`);
  return new Map(run.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const a = JSON.parse(line); return [a.id, a]; }));
}

/** @description One part's row for the sheet and the manifest. */
function partRow(p, answer, stlFile, stl) {
  if (!answer || !answer.ok) throw new Error(`${p.id}: the worker refused the program: ${JSON.stringify(answer && answer.error)}`);
  const r = answer.result;
  const rejected = r.features.filter((s) => !s.ok).map((s) => ({ id: s.id, error: s.error }));
  if (rejected.length || !r.report.valid) throw new Error(`${p.id}: not a valid solid: ${JSON.stringify(rejected)}`);
  const mesh = meshCheck(parseStl(stl));
  if (!mesh.watertight) throw new Error(`${p.id}: the exported STL is not watertight: ${JSON.stringify(mesh)}`);
  const e = r.report.extentsMm;
  const extents = e.max.map((v, i) => Math.round((v - e.min[i]) * 10) / 10);
  return { id: p.id, file: stlFile, name: p.name, qty: p.qty, material: p.material, option: p.option ?? null, link: p.link, printNotes: p.printNotes, designMassEachG: p.massEachG,
           kernelMassEachG: Math.round(r.report.massG), volumeCm3: Math.round(r.report.volumeMm3 / 10) / 100, extentsMm: extents, triangles: mesh.triangles, sha256: createHash('sha256').update(stl).digest('hex') };
}

/** @description The print sheet as Markdown: what to print, how many, in what, how, and what each weighs by the kernel. */
function printSheet(design, rows) {
  const line = (r) => `| \`${r.file}\` | ${r.qty} | ${r.material} | ${r.extentsMm.join(' × ')} | ${r.kernelMassEachG} g (design ${r.designMassEachG} g) | ${r.option ? `**${r.option} only** · ` : ''}${r.printNotes} |`;
  const core = rows.filter((r) => !r.option); const spring = rows.filter((r) => r.option);
  const pieces = (rs) => rs.reduce((n, r) => n + r.qty, 0);
  const grams = (rs) => rs.reduce((n, r) => n + r.qty * r.kernelMassEachG, 0);
  return [
    `# spider-18 print set (${design.fit}, generated ${new Date().toISOString().slice(0, 10)})`, '',
    `Every file here came out of CAD Studio's kernel from the design's own part programs (\`GET /api/embodied/build/hexapod/parts/<id>\`); the masses are the kernel's solid volume at PETG ${PETG_G_CM3} g/cm³ beside the design's estimate (its mass budget: ${design.massBudget.totalG} g total against the ${design.massBudget.targetG} g target). Infill and walls are in each part's notes; a sliced part weighs what the slicer says.`, '',
    `**Core build:** ${pieces(core)} pieces from ${core.length} files, about ${grams(core)} g of solid PETG. **The latched-spring jump option adds** ${pieces(spring)} pieces from ${spring.length} files (${grams(spring)} g); legs-hop needs none of them.`, '',
    '| file | print | material | extents mm (x × y × z, seated on z = 0) | each | notes |', '|---|---|---|---|---|---|',
    ...core.map(line), ...spring.map(line), '',
    '## Bought parts', '', 'The bill of materials beside this sheet (`bom.csv`) lists every bought part with the printed ones; the servo row, the Pi, the LiDAR, the pack and the fasteners come from the parts catalog the design was built from.', '',
    '## Checks the files passed', '', `Each STL was exported at ${STL_TOLERANCE_MM} mm tolerance, parsed back and checked watertight (every edge on exactly two triangles, no degenerate triangle); the triangle counts and sha256 of every file are in \`manifest.json\`.`, '',
  ].join('\n');
}

/**
 * @description Write the print set: the STL files, the sheet, the BOM and the manifest. @param outDir - Where. @param fit - The design.
 * @param image - The engine image. @returns The manifest.
 */
export function writePrintSet(outDir, fit = 'spider-18', image = process.env.OSHAL_CAD_ENGINE_IMAGE || DEFAULT_IMAGE) {
  const design = buildHexapod(fit);
  const answers = buildParts(design, image);
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const p of design.printed) {
    const a = answers.get(p.id);
    const stl = a && a.ok ? Buffer.from(a.result.exports.stl, 'base64') : Buffer.alloc(0);
    const file = `${fit}-${p.id}.stl`;
    const row = partRow(p, a, file, stl);
    fs.writeFileSync(path.join(outDir, file), stl);
    rows.push(row);
  }
  fs.writeFileSync(path.join(outDir, 'PRINT-SHEET.md'), printSheet(design, rows));
  fs.writeFileSync(path.join(outDir, 'bom.csv'), hexapodBomCsv(fit));
  const manifest = { fit, generatedAt: new Date().toISOString(), image, tolerance: STL_TOLERANCE_MM, density: PETG_G_CM3, massBudget: design.massBudget, parts: rows };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/hexapod-prints.mjs <out-dir>'); process.exit(2); }
  const m = writePrintSet(path.resolve(out));
  for (const r of m.parts) console.log(`${r.file.padEnd(34)} x${String(r.qty).padStart(2)}  ${String(r.extentsMm.join('x')).padEnd(20)} ${String(r.kernelMassEachG).padStart(4)} g  ${r.triangles} triangles${r.option ? `  [${r.option}]` : ''}`);
  console.log(`${m.parts.length} files in ${out}: PRINT-SHEET.md, bom.csv, manifest.json`);
}
