#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S5 (second half): the cross-lab CONTRACT drift guard. D3 says what labs share is a contract, not a runtime - the vehicle record's column set, the stage function, the medium shape and the run-result schema - and that a cross-package read-only test fails when they drift. This reads every lab AS DATA AND TEXT and imports nothing from any package, so the store's package-separation guard is untouched. It DISCOVERS its targets rather than listing them: every package whose migrations create a `*_vehicle` table with a design_vector column is a vehicle-record lab, and its run-bearing table is the one that references it and carries a vector fingerprint; every medium-properties.json and force-model-envelopes.json in the store is compared (compiled copies included); every TypeScript source that exports STAGES, FABRICABLE_SENTENCE, designVectorFingerprint or RUN_RESULT_SCHEMA is compared; and every lab that declares media or envelopes must keep a test case for each named refusal. It fails CLOSED: fewer than two record labs, a missing export, an unreadable file or an unknown property name is a failure, never a skip.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fix: every exported helper (walk, discoverRecordLabs, recordShapeProblems, exportedDeclaration, stageContractProblems, runSchemaProblems, mediumRowProblems, envelopeProblems, refusalCaseProblems, main) now carries @param and @returns as the house JSDoc rule requires and the sibling guards (check-medium-properties.mjs, check-forced-rls.mjs) already do. Documentation only; no behavior changed.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3: the PORTABLE-OBJECT shape (D8) joins the contract. Every lab that declares PORTABLE_OBJECT_SCHEMA under src-routes/ must declare it, PORTABLE_OBJECT_KEYS and CAD_STUDIO_WORLD_FRAME identically to every other declaring lab; the declared frame must equal CAD Studio's own `worldFrame` text, read from cad-studio's contract source; and every declaring lab keeps a committed fixture of what it emits (tests/fixtures/*portable-objects*.json), each object of which must carry exactly the declared keys and schema, quote that frame, give every mass property a provenance, and declare a force model only as its own envelope file declares it, in media the reference row implements and with requirements the medium shape can answer. Fails CLOSED: a shape declared nowhere, a lab with no fixture, an unreadable CAD Studio frame. Read as data and text; nothing is imported.
 *
 * Usage: node scripts/check-adr160-contract.mjs [repository-root]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one committed row per medium (ADR-160 S1): every other copy of the rows is compared against it. */
export const REFERENCE_ROW = 'embodied/src-routes/engine/medium/medium-properties.json';

/** The columns ADR-160 D5 requires on every run-bearing table, with the base type each carries. */
export const RUN_CORE_COLUMNS = Object.freeze({
  vehicle_id: 'UUID', owner_sub: 'TEXT', sequence: 'INTEGER', medium_id: 'TEXT', vector_fingerprint: 'TEXT', engine_fingerprints: 'JSONB', result: 'JSONB', created_at: 'TIMESTAMPTZ',
});

/** The named refusals ADR-160 D7 makes part of the contract; each lab keeps a test case for each. */
export const NAMED_REFUSALS = Object.freeze(['medium_property_unavailable', 'model_not_valid_in_medium']);

/** The stage-contract exports every record lab carries, and what makes two of them the same. */
const STAGE_EXPORTS = Object.freeze(['STAGES', 'FABRICABLE_SENTENCE', 'Stage', 'designVectorFingerprint']);

/** The CAD Studio contract source whose `worldFrame` every portable object's attachment frame must quote (D8 item 4). */
export const CAD_STUDIO_CONTRACT = 'cad-studio/src-routes/feature-contract.ts';

const SKIP_DIRS = new Set(['node_modules', '.git', 'output', 'audits', 'scripts', '_walkthrough-shots']);

/**
 * @description Every file under a directory, relative to the repository root, skipping dependency and
 *  tooling trees. The guard discovers its targets from this list instead of naming them, so a new lab
 *  is compared the day it lands.
 * @param {string} root The store checkout.
 * @param {string} [rel] The directory being walked, relative to root ('' for root itself).
 * @param {string[]} [out] The accumulator the recursion appends to.
 * @returns {string[]} Every file path, relative to root, with forward slashes.
 */
export function walk(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(root, rel ? `${rel}/${entry.name}` : entry.name, out); } else if (entry.isFile()) out.push(rel ? `${rel}/${entry.name}` : entry.name);
  }
  return out;
}

/** @description Blank SQL `--` comments so a described column is never read as a declared one. */
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * @description Every `CREATE TABLE` in a migration, with its columns (name and base type) and whether it
 *  references another table from a column.
 * @param {string} sql The migration text. @returns {Map<string, {columns: Map<string,string>, references: Map<string,string>, body: string}>} Tables by name.
 */
export function parseTables(sql) {
  const tables = new Map();
  const text = stripSqlComments(sql);
  const header = /CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  let match;
  while ((match = header.exec(text))) {
    let depth = 1; let i = header.lastIndex;
    for (; i < text.length && depth > 0; i += 1) { if (text[i] === '(') depth += 1; else if (text[i] === ')') depth -= 1; }
    const body = text.slice(header.lastIndex, i - 1);
    const columns = new Map(); const references = new Map();
    for (const line of body.split(/,\s*\n/)) {
      const col = /^\s*([a-z_][a-z0-9_]*)\s+([A-Z]+)\b/.exec(line);
      if (!col || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(col[1])) continue;
      columns.set(col[1], col[2].toUpperCase());
      const ref = /REFERENCES\s+([a-z_][a-z0-9_]*)/i.exec(line);
      if (ref) references.set(col[1], ref[1]);
    }
    tables.set(match[1], { columns, references, body });
  }
  return tables;
}

/**
 * @description The vehicle-record labs: a `*_vehicle` table with a design_vector, and the run-bearing
 *  table that references it. Discovered from migrations so a lab cannot opt out by not being listed.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @returns {Array<{lab: string, migration: string, vehicleTable: string, vehicle: object, runTables: Array<{name: string, table: object}>}>} One entry per vehicle table found, in migration-path order.
 */
export function discoverRecordLabs(root, files) {
  const labs = [];
  for (const file of files.filter((f) => /^[^/]+\/migrations\/[^/]+\.sql$/.test(f)).sort()) {
    const tables = parseTables(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const [name, table] of tables) {
      if (!name.endsWith('_vehicle') || !table.columns.has('design_vector')) continue;
      const runs = [...tables].filter(([, t]) => t.references.get('vehicle_id') === name && t.columns.has('vector_fingerprint'));
      labs.push({ lab: file.split('/')[0], migration: file, vehicleTable: name, vehicle: table, runTables: runs.map(([n, t]) => ({ name: n, table: t })) });
    }
  }
  return labs;
}

/**
 * @description The record shape: every lab's vehicle columns equal the first lab's, and every run table
 *  carries the D5 core. Fewer than two labs is itself a problem, because a comparison of one is a drift
 *  nobody catches.
 * @param {ReturnType<typeof discoverRecordLabs>} labs The discovered record labs.
 * @returns {string[]} One message per drifted column, missing run table or missing fingerprint constraint.
 */
export function recordShapeProblems(labs) {
  const problems = [];
  if (labs.length < 2) return [`found ${labs.length} vehicle-record lab(s) (${labs.map((l) => l.lab).join(', ') || 'none'}); the contract needs at least two to compare - a guard with nothing to compare is a drift nobody catches`];
  const shape = (cols) => [...cols].map(([n, t]) => `${n} ${t}`).join(', ');
  const reference = labs[0];
  for (const lab of labs.slice(1)) {
    if (shape(lab.vehicle.columns) !== shape(reference.vehicle.columns)) problems.push(`${lab.migration} ${lab.vehicleTable} columns (${shape(lab.vehicle.columns)}) differ from ${reference.migration} ${reference.vehicleTable} (${shape(reference.vehicle.columns)})`);
  }
  for (const lab of labs) {
    if (lab.runTables.length === 0) { problems.push(`${lab.migration}: no table references ${lab.vehicleTable}(vehicle_id) with a vector_fingerprint - runs cannot carry the vector they were computed at (D2, D5)`); continue; }
    for (const { name, table } of lab.runTables) {
      for (const [column, type] of Object.entries(RUN_CORE_COLUMNS)) {
        if (table.columns.get(column) !== type) problems.push(`${lab.migration} ${name}: column ${column} must be ${type} (D5), found ${table.columns.get(column) ?? 'nothing'}`);
      }
      if (!/vector_fingerprint\s*~\s*'\^\[0-9a-f\]\{64\}\$'/.test(table.body)) problems.push(`${lab.migration} ${name}: vector_fingerprint carries no 64-hex shape constraint`);
    }
  }
  return problems;
}

/**
 * @description One exported declaration's normalized text from TypeScript source. Whitespace is
 *  collapsed so two labs that format the same declaration differently still compare equal.
 * @param {string} source The file text.
 * @param {string} name The exported identifier (const, function or type).
 * @returns {string | null} The declaration on one line, or null when the file does not export it.
 */
export function exportedDeclaration(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^export (?:const|function|type) ${name}\\b`).test(l));
  if (start < 0) return null;
  const out = [];
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    out.push(lines[i].trim());
    for (const c of lines[i]) { if (c === '{' || c === '(' || c === '[') depth += 1; else if (c === '}' || c === ')' || c === ']') depth -= 1; }
    if (depth <= 0 && /[;}]\s*$/.test(lines[i])) break;
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

/**
 * @description The stage contract: every record lab exports STAGES, the Stage type, the fabricable
 *  sentence and the vector fingerprint exactly once under src-routes/, and they read the same.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @param {ReturnType<typeof discoverRecordLabs>} labs The discovered record labs.
 * @returns {string[]} One message per missing, duplicated or differing export.
 */
export function stageContractProblems(root, files, labs) {
  const problems = [];
  const found = new Map();
  for (const lab of labs) {
    const sources = files.filter((f) => f.startsWith(`${lab.lab}/src-routes/`) && f.endsWith('.ts') && !f.endsWith('.d.ts'));
    for (const name of STAGE_EXPORTS) {
      const hits = sources.map((f) => ({ f, d: exportedDeclaration(fs.readFileSync(path.join(root, f), 'utf8'), name) })).filter((h) => h.d);
      if (hits.length !== 1) { problems.push(`${lab.lab}: exports ${name} ${hits.length} time(s) under src-routes/ - the stage contract needs exactly one`); continue; }
      if (!found.has(name)) found.set(name, hits[0]); else if (found.get(name).d !== hits[0].d) problems.push(`${hits[0].f} ${name} differs from ${found.get(name).f}:\n      ${hits[0].d}\n    vs ${found.get(name).d}`);
    }
  }
  return problems;
}

/**
 * @description Every RUN_RESULT_SCHEMA declared in the store reads the same, and at least two labs
 *  declare one.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @returns {string[]} One message per declaration that differs from the first, or one when fewer than two exist.
 */
export function runSchemaProblems(root, files) {
  const hits = files.filter((f) => /^[^/]+\/src-routes\/.+\.ts$/.test(f))
    .map((f) => ({ f, d: exportedDeclaration(fs.readFileSync(path.join(root, f), 'utf8'), 'RUN_RESULT_SCHEMA') })).filter((h) => h.d);
  if (hits.length < 2) return [`RUN_RESULT_SCHEMA is declared ${hits.length} time(s); the labs that record runs must each declare it`];
  return hits.slice(1).filter((h) => h.d !== hits[0].d).map((h) => `${h.f} RUN_RESULT_SCHEMA (${h.d}) differs from ${hits[0].f} (${hits[0].d})`);
}

const sameKeys = (a, b) => JSON.stringify(Object.keys(a ?? {})) === JSON.stringify(Object.keys(b ?? {}));

/**
 * @description Every copy of the medium rows: the reference's schema, media, row keys, implementation
 *  keys and property VALUES. A lab may differ in what it can answer, never in what a medium is.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @param {object} reference The parsed REFERENCE_ROW document.
 * @returns {string[]} One message per unreadable copy or drifted schema, medium, key or value.
 */
export function mediumRowProblems(root, files, reference) {
  const problems = [];
  for (const file of files.filter((f) => f.endsWith('/medium-properties.json') && f !== REFERENCE_ROW)) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch (error) { problems.push(`${file}: not JSON (${error.message})`); continue; }
    if (rows.schema !== reference.schema) problems.push(`${file}: schema ${rows.schema}, the reference is ${reference.schema}`);
    if (rows.earthSurfaceGravityMps2 !== reference.earthSurfaceGravityMps2) problems.push(`${file}: earthSurfaceGravityMps2 ${rows.earthSurfaceGravityMps2} differs from ${reference.earthSurfaceGravityMps2}`);
    if (!sameKeys(rows.media, reference.media)) { problems.push(`${file}: media ${Object.keys(rows.media ?? {}).join(',')} differ from ${Object.keys(reference.media).join(',')}`); continue; }
    for (const [id, ref] of Object.entries(reference.media)) {
      const row = rows.media[id];
      if (!sameKeys(row, ref)) problems.push(`${file} ${id}: row keys ${Object.keys(row).join(',')} differ from ${Object.keys(ref).join(',')}`);
      if (JSON.stringify(row.properties) !== JSON.stringify(ref.properties)) problems.push(`${file} ${id}: properties ${JSON.stringify(row.properties)} differ from the reference ${JSON.stringify(ref.properties)} - a lab may differ in what it can answer, never in what a medium IS`);
      if (!sameKeys(row.implementation, ref.implementation)) problems.push(`${file} ${id}: implementation keys ${Object.keys(row.implementation ?? {}).join(',')} differ from ${Object.keys(ref.implementation).join(',')}`);
      if (!sameKeys(row.implementation?.validity, ref.implementation.validity)) problems.push(`${file} ${id}: validity keys differ from the reference`);
    }
  }
  return problems;
}

/**
 * @description Every force-model envelope file: one schema and shape, media the reference knows, and
 *  requirements the medium shape can answer. Fewer than two files is a problem, not a skip.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @param {object} reference The parsed REFERENCE_ROW document.
 * @returns {string[]} One message per unreadable file, shape difference, unknown medium or unanswerable requirement.
 */
export function envelopeProblems(root, files, reference) {
  const problems = [];
  const envelopeFiles = files.filter((f) => f.endsWith('/force-model-envelopes.json'));
  if (envelopeFiles.length < 2) return [`found ${envelopeFiles.length} force-model-envelopes.json file(s); every lab that declares envelopes must be compared`];
  const mediaIds = Object.keys(reference.media);
  const fields = new Set(Object.values(reference.media).flatMap((row) => [...Object.keys(row.properties), ...Object.keys(row.implementation)]));
  let first = null;
  for (const file of envelopeFiles) {
    let env;
    try { env = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch (error) { problems.push(`${file}: not JSON (${error.message})`); continue; }
    if (first && (env.schema !== first.env.schema || !sameKeys(env, first.env))) problems.push(`${file}: schema or top-level keys differ from ${first.file}`);
    first ??= { file, env };
    if (JSON.stringify(env.mediaKnown) !== JSON.stringify(mediaIds)) problems.push(`${file}: mediaKnown ${JSON.stringify(env.mediaKnown)} differs from the reference media ${JSON.stringify(mediaIds)}`);
    if (!mediaIds.includes(env.defaultMedium)) problems.push(`${file}: defaultMedium ${env.defaultMedium} is not a known medium`);
    for (const [model, row] of Object.entries(env.models ?? {})) {
      if (JSON.stringify(Object.keys(row)) !== JSON.stringify(['label', 'requires', 'validIn', 'why'])) problems.push(`${file} ${model}: row keys ${Object.keys(row).join(',')} are not label,requires,validIn,why`);
      for (const m of row.validIn ?? []) if (!mediaIds.includes(m)) problems.push(`${file} ${model}: validIn names ${m}, which no medium row implements`);
      for (const p of row.requires ?? []) if (!fields.has(p)) problems.push(`${file} ${model}: requires ${p}, which is not a field of the medium shape (${[...fields].join(', ')})`);
    }
  }
  return problems;
}

/**
 * @description Every lab that declares media or envelopes keeps at least one test case per named
 *  refusal, so a refusal is a guarded case rather than a note.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @returns {string[]} One message per lab and named refusal no test under that lab's tests/ names.
 */
export function refusalCaseProblems(root, files) {
  const labs = [...new Set(files.filter((f) => /\/(medium-properties|force-model-envelopes)\.json$/.test(f)).map((f) => f.split('/')[0]))].sort();
  const problems = [];
  for (const lab of labs) {
    const tests = files.filter((f) => f.startsWith(`${lab}/tests/`) && /\.(test|spec)\.(c|m)?[jt]s$/.test(f)).map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
    for (const refusal of NAMED_REFUSALS) if (!tests.some((t) => t.includes(refusal))) problems.push(`${lab}: no test case names ${refusal} - each named refusal is a case, not a note (ADR-160 S5)`);
  }
  return problems;
}

/**
 * @description CAD Studio's world frame, read as text from its contract source.
 * @param {string} root The store checkout.
 * @returns {string | null} The `worldFrame` string, or null when it cannot be read.
 */
export function cadStudioWorldFrame(root) {
  try {
    const match = /worldFrame:\s*'([^']+)'/.exec(fs.readFileSync(path.join(root, CAD_STUDIO_CONTRACT), 'utf8'));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** @description The quoted strings of one declaration, in order. */
const quoted = (declaration) => [...declaration.matchAll(/'([^']*)'/g)].map((m) => m[1]);

/**
 * @description The portable-object declarations: each of the three names declared the same way by every declaring lab,
 *  and each declaring lab declaring all three. None at all fails closed.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @returns {{problems: string[], labs: string[], schema: string | null, keys: string[], frame: string | null}} What was found.
 */
export function portableDeclarations(root, files) {
  const sources = files.filter((f) => /^[^/]+\/src-routes\/.+\.ts$/.test(f) && !f.endsWith('.d.ts'));
  const found = Object.fromEntries(['PORTABLE_OBJECT_SCHEMA', 'PORTABLE_OBJECT_KEYS', 'CAD_STUDIO_WORLD_FRAME'].map((name) => [name, sources
    .map((f) => ({ f, d: exportedDeclaration(fs.readFileSync(path.join(root, f), 'utf8'), name) })).filter((h) => h.d)]));
  const labs = [...new Set(found.PORTABLE_OBJECT_SCHEMA.map((h) => h.f.split('/')[0]))].sort();
  if (!labs.length) return { problems: ['PORTABLE_OBJECT_SCHEMA is declared nowhere under */src-routes/: the D8 portable-object shape has nothing to hold (fail closed)'], labs, schema: null, keys: [], frame: null };
  const problems = [];
  for (const [name, hits] of Object.entries(found)) {
    for (const lab of labs) if (!hits.some((h) => h.f.startsWith(`${lab}/`))) problems.push(`${lab}: declares PORTABLE_OBJECT_SCHEMA but not ${name}`);
    for (const h of hits.slice(1)) if (h.d !== hits[0].d) problems.push(`${h.f} ${name} (${h.d}) differs from ${hits[0].f} (${hits[0].d})`);
  }
  const first = (name) => (found[name][0] ? quoted(found[name][0].d) : []);
  return { problems, labs, schema: first('PORTABLE_OBJECT_SCHEMA')[0] ?? null, keys: first('PORTABLE_OBJECT_KEYS'), frame: first('CAD_STUDIO_WORLD_FRAME')[0] ?? null };
}

/** @description Problems with one emitted object's mass properties and force model against the lab's envelopes and the medium shape. */
function objectBodyProblems(at, o, envelopes, reference) {
  const problems = [];
  for (const block of ['mass', 'centreOfMass', 'inertia']) {
    const p = o.massProperties?.[block]?.provenance;
    if (!p || typeof p.source !== 'string' || typeof p.basis !== 'string' || !p.basis) problems.push(`${at}: massProperties.${block} carries no provenance (D8 item 3: each value with its provenance)`);
  }
  const fm = o.forceModel;
  if (fm === null || fm === undefined) return problems;
  const mediaIds = Object.keys(reference.media);
  const fields = new Set(Object.values(reference.media).flatMap((row) => [...Object.keys(row.properties), ...Object.keys(row.implementation)]));
  const declared = envelopes?.models?.[fm.id];
  if (!declared) problems.push(`${at}: forceModel ${fm.id} has no envelope in its lab's force-model-envelopes.json`);
  else if (JSON.stringify(declared.requires) !== JSON.stringify(fm.requires) || JSON.stringify(declared.validIn) !== JSON.stringify(fm.validIn)) problems.push(`${at}: forceModel ${fm.id} (requires ${JSON.stringify(fm.requires)}, validIn ${JSON.stringify(fm.validIn)}) differs from its lab's envelope (requires ${JSON.stringify(declared.requires)}, validIn ${JSON.stringify(declared.validIn)})`);
  for (const m of fm.validIn ?? []) if (!mediaIds.includes(m)) problems.push(`${at}: forceModel validIn names ${m}, which no medium row implements`);
  for (const r of fm.requires ?? []) if (!fields.has(r)) problems.push(`${at}: forceModel requires ${r}, which is not a field of the medium shape`);
  return problems;
}

/**
 * @description The portable-object shape (D8): the declarations agree, the declared frame is CAD Studio's own, and every
 *  declaring lab's committed emitted fixture holds to them object by object.
 * @param {string} root The store checkout.
 * @param {string[]} files Every file in the checkout, as walk() returns them.
 * @param {object} reference The parsed REFERENCE_ROW document.
 * @returns {string[]} One message per drifted declaration, unreadable frame, missing fixture or drifted object.
 */
export function portableObjectProblems(root, files, reference) {
  const decl = portableDeclarations(root, files);
  if (!decl.labs.length) return decl.problems;
  const problems = [...decl.problems];
  const cadFrame = cadStudioWorldFrame(root);
  if (!cadFrame) problems.push(`${CAD_STUDIO_CONTRACT}: no worldFrame could be read, so no attachment frame can be held to CAD Studio's (fail closed)`);
  else if (decl.frame !== cadFrame) problems.push(`CAD_STUDIO_WORLD_FRAME (${decl.frame}) is not CAD Studio's worldFrame (${cadFrame})`);
  for (const lab of decl.labs) {
    const fixtures = files.filter((f) => f.startsWith(`${lab}/tests/fixtures/`) && /portable-objects[^/]*\.json$/.test(f));
    if (!fixtures.length) { problems.push(`${lab}: declares the portable-object shape but keeps no committed portable-objects fixture under tests/fixtures/`); continue; }
    const envelopeFile = files.find((f) => f.startsWith(`${lab}/src-routes/`) && f.endsWith('/force-model-envelopes.json'));
    const envelopes = envelopeFile ? JSON.parse(fs.readFileSync(path.join(root, envelopeFile), 'utf8')) : null;
    for (const file of fixtures) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch (error) { problems.push(`${file}: not JSON (${error.message})`); continue; }
      if (!Array.isArray(doc.objects) || !doc.objects.length) { problems.push(`${file}: holds no objects`); continue; }
      doc.objects.forEach((o, i) => {
        const at = `${file} objects[${i}]${o?.identity?.partId ? ` (${o.identity.partId})` : ''}`;
        if (JSON.stringify(Object.keys(o ?? {})) !== JSON.stringify(decl.keys)) { problems.push(`${at}: keys ${Object.keys(o ?? {}).join(',')} differ from PORTABLE_OBJECT_KEYS ${decl.keys.join(',')}`); return; }
        if (o.schema !== decl.schema) problems.push(`${at}: schema ${o.schema} differs from PORTABLE_OBJECT_SCHEMA ${decl.schema}`);
        if (cadFrame && o.attachmentFrame?.convention !== cadFrame) problems.push(`${at}: attachmentFrame.convention does not quote CAD Studio's world frame`);
        problems.push(...objectBodyProblems(at, o, envelopes, reference));
      });
    }
  }
  return problems;
}

/**
 * @description Every contract problem in a store checkout.
 * @param {string} [root] The store checkout (defaults to this repository).
 * @returns {{problems: string[], labs: string[]}} What drifted, and the record labs compared.
 */
export function adr160ContractDrift(root = REPOSITORY_ROOT) {
  const files = walk(root);
  let reference;
  try { reference = JSON.parse(fs.readFileSync(path.join(root, REFERENCE_ROW), 'utf8')); } catch (error) { return { problems: [`${REFERENCE_ROW}: cannot be read as JSON (${error.message})`], labs: [] }; }
  const labs = discoverRecordLabs(root, files);
  const problems = [
    ...recordShapeProblems(labs),
    ...(labs.length >= 2 ? stageContractProblems(root, files, labs) : []),
    ...runSchemaProblems(root, files),
    ...mediumRowProblems(root, files, reference),
    ...envelopeProblems(root, files, reference),
    ...refusalCaseProblems(root, files),
    ...portableObjectProblems(root, files, reference),
  ];
  return { problems, labs: labs.map((l) => l.lab) };
}

/**
 * @description Fail the gate on any contract drift: print each problem and set a non-zero exit code.
 * @param {string} [root] The store checkout (defaults to this repository).
 * @returns {void} Reports through stdout/stderr and process.exitCode.
 */
export function main(root = REPOSITORY_ROOT) {
  const { problems, labs } = adr160ContractDrift(root);
  if (problems.length) {
    console.error(`ADR-160 contract drift: ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Change the contract in every lab together, or not at all; never narrow this guard to the lab that tripped it.');
    process.exitCode = 1;
    return;
  }
  console.log(`ADR-160 contract passed: record labs ${labs.join(', ')} agree on the vehicle columns, the run core, the stage contract and the run-result schema; every medium row copy and envelope file agrees with ${REFERENCE_ROW}; every lab keeps a case per named refusal; every portable object agrees with its declaration, CAD Studio's frame and its lab's envelopes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
}
