/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the ADR-160 contract drift guard. A disposable store is built from the REAL files the guard reads in the three labs (both record migrations, both stage sources, both run-result schema declarations, every medium row and envelope file, and one refusal-bearing test per lab), and every case changes exactly ONE thing and requires the guard to go red naming it: a renamed vehicle column, a run table that loses its medium id, a changed fabricable sentence, reordered stages, a fingerprint that stops sorting keys, a different Stage type, a drifted run-result schema, a seawater density that disagrees, a medium row that loses its validity, an envelope that requires a property no medium carries or names a medium nobody implements or disagrees on the media known, a lab that loses its last case for a named refusal, and a store with only one record lab left (fail CLOSED, never "nothing to compare"). The last case pins the real store.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3: the fixture store also carries ocean-lab's portable-object declaration, its committed emitted fixture and CAD Studio's contract source, and eight new cases each go red naming ONE drift in the D8 shape: a schema that moves, a key list reordered, an object that loses a block, a mass value without provenance, an attachment frame that stops quoting CAD Studio (changed on CAD Studio's side), a force model that disagrees with its lab's envelope, a lab with no emitted fixture, and a shape declared nowhere (fail closed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adr160ContractDrift, exportedDeclaration, parseTables } from './check-adr160-contract.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real files the guard reads, copied verbatim so the fixture drifts from the store's own bytes. */
const FILES = [
  'aero-lab/migrations/001-aero-lab.sql',
  'aero-lab/src-routes/floater-record.ts',
  'aero-lab/src-routes/force-model-envelopes.json',
  'aero-lab/tests/aero-vehicle-record.spec.ts',
  'ocean-lab/migrations/001-ocean-lab.sql',
  'ocean-lab/src-routes/engine/vehicle/stage.ts',
  'ocean-lab/src-routes/engine/vehicle/run-fingerprint.ts',
  'ocean-lab/src-routes/engine/wave/medium-properties.json',
  'ocean-lab/src-routes/engine/wave/force-model-envelopes.json',
  'ocean-lab/tests/engine-wave.test.js',
  'embodied/src-routes/engine/medium/medium-properties.json',
  'embodied/src-routes/engine/medium/run-fingerprint.ts',
  'embodied/tests/engine-medium.test.js',
  'ocean-lab/src-routes/engine/vehicle/portable-object.ts',
  'ocean-lab/tests/fixtures/explorer-portable-objects.json',
  'cad-studio/src-routes/feature-contract.ts',
];

const OBJECTS = 'ocean-lab/tests/fixtures/explorer-portable-objects.json';
const DECLARATION = 'ocean-lab/src-routes/engine/vehicle/portable-object.ts';

/**
 * @description A disposable store holding only the files the guard reads, with at most one edit.
 * @param {import('node:test').TestContext} t The test, for cleanup.
 * @param {{ file?: string, from?: string | RegExp, to?: string, drop?: string }} [edit] One replacement in one file, or one file dropped.
 * @returns {string} The fixture root.
 */
function fixture(t, edit = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-adr160-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const rel of FILES) {
    if (rel === edit.drop) continue;
    let body = fs.readFileSync(path.join(REPOSITORY_ROOT, rel), 'utf8');
    if (rel === edit.file) {
      assert.ok(typeof edit.from === 'string' ? body.includes(edit.from) : edit.from.test(body), `fixture ${rel} does not contain ${edit.from}`);
      body = body.replace(edit.from, () => edit.to);
    }
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

/** @description Assert the guard goes red with a problem matching the pattern. */
function red(t, edit, pattern) {
  const { problems } = adr160ContractDrift(fixture(t, edit));
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
}

/** @description Edit one JSON file by a function instead of by text. */
function jsonEdit(file, mutate) {
  const body = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
  mutate(body);
  const from = fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
  return { file, from, to: `${JSON.stringify(body, null, 2)}\n` };
}

test('the unmutated fixture passes and compares both record labs', (t) => {
  const { problems, labs } = adr160ContractDrift(fixture(t));
  assert.deepEqual(problems, []);
  assert.deepEqual(labs, ['aero-lab', 'ocean-lab']);
});

test('the parser reads column names and base types, skips constraints, and sees what a column references', () => {
  const tables = parseTables('CREATE TABLE IF NOT EXISTS a_vehicle (\n  vehicle_id UUID PRIMARY KEY,\n  design_vector JSONB NOT NULL, -- the vector\n  CONSTRAINT x CHECK (true)\n);\nCREATE TABLE b (\n  vehicle_id UUID REFERENCES a_vehicle (vehicle_id),\n  vector_fingerprint TEXT\n);');
  assert.deepEqual([...tables.get('a_vehicle').columns], [['vehicle_id', 'UUID'], ['design_vector', 'JSONB']]);
  assert.equal(tables.get('b').references.get('vehicle_id'), 'a_vehicle');
  assert.equal(exportedDeclaration("export const X = 'a';\nexport const Y = 1;", 'X'), "export const X = 'a';");
});

test('a vehicle column renamed in one lab goes red', (t) => red(t, { file: 'ocean-lab/migrations/001-ocean-lab.sql', from: '  provenance     JSONB', to: '  origin         JSONB' }, /ocean_lab_vehicle columns .* differ from aero-lab/));

test('a run table that loses its medium id goes red', (t) => red(t, { file: 'aero-lab/migrations/001-aero-lab.sql', from: /  medium_id\s+TEXT\s+NOT NULL,[^\n]*\n/, to: '' }, /aero_lab_vehicle_evaluation: column medium_id must be TEXT/));

test('a run table without the 64-hex fingerprint constraint goes red', (t) => red(t, { file: 'ocean-lab/migrations/001-ocean-lab.sql', from: "CHECK (vector_fingerprint ~ '^[0-9a-f]{64}$')", to: 'CHECK (length(vector_fingerprint) > 0)' }, /no 64-hex shape constraint/));

test('a changed fabricable sentence goes red', (t) => red(t, { file: 'ocean-lab/src-routes/engine/vehicle/stage.ts', from: 'safe to build, fly or wet.', to: 'safe to build or fly.' }, /FABRICABLE_SENTENCE differs/));

test('reordered stages go red', (t) => red(t, { file: 'aero-lab/src-routes/floater-record.ts', from: "['concept', 'sized', 'parts-complete', 'fabricable', 'built']", to: "['concept', 'parts-complete', 'sized', 'fabricable', 'built']" }, /STAGES differs/));

test('a Stage type that gains a stage goes red', (t) => red(t, { file: 'ocean-lab/src-routes/engine/vehicle/stage.ts', from: "export type Stage = 'concept' | 'sized'", to: "export type Stage = 'concept' | 'drafted' | 'sized'" }, /Stage differs/));

test('a vector fingerprint that stops sorting keys goes red', (t) => red(t, { file: 'ocean-lab/src-routes/engine/vehicle/stage.ts', from: 'Object.keys(value as Record<string, unknown>).sort().map', to: 'Object.keys(value as Record<string, unknown>).map' }, /designVectorFingerprint differs/));

test('a lab that stops exporting the stage contract fails closed', (t) => red(t, { file: 'ocean-lab/src-routes/engine/vehicle/stage.ts', from: 'export const FABRICABLE_SENTENCE', to: 'const FABRICABLE_SENTENCE' }, /ocean-lab: exports FABRICABLE_SENTENCE 0 time/));

test('a drifted run-result schema goes red', (t) => red(t, { file: 'ocean-lab/src-routes/engine/vehicle/run-fingerprint.ts', from: "'oshal.run-result/1'", to: "'oshal.run-result/2'" }, /RUN_RESULT_SCHEMA .* differs/));

test('a seawater density that disagrees with the committed row goes red', (t) => red(t, jsonEdit('ocean-lab/src-routes/engine/wave/medium-properties.json', (j) => { j.media.seawater.properties.densityKgM3 = 1026; }), /seawater: properties .* differ from the reference/));

test('a medium row that loses its validity band goes red', (t) => red(t, jsonEdit('ocean-lab/src-routes/engine/wave/medium-properties.json', (j) => { delete j.media.air.implementation.validity; }), /air: implementation keys .* differ/));

test('an envelope that requires a property no medium carries goes red', (t) => red(t, jsonEdit('ocean-lab/src-routes/engine/wave/force-model-envelopes.json', (j) => { j.models['wave-propulsion'].requires.push('salinity'); }), /requires salinity, which is not a field of the medium shape/));

test('an envelope valid in a medium nobody implements goes red', (t) => red(t, jsonEdit('aero-lab/src-routes/force-model-envelopes.json', (j) => { j.models.aeropolar.validIn.push('helium'); }), /validIn names helium/));

test('an envelope file that disagrees on the media known goes red', (t) => red(t, jsonEdit('aero-lab/src-routes/force-model-envelopes.json', (j) => { j.mediaKnown = ['air', 'seawater']; }), /mediaKnown .* differs from the reference media/));

test('a lab that loses its last case for a named refusal goes red', (t) => red(t, { file: 'ocean-lab/tests/engine-wave.test.js', from: /model_not_valid_in_medium/g, to: 'declined' }, /ocean-lab: no test case names model_not_valid_in_medium/));

test('a store with only one record lab left fails CLOSED, never "nothing to compare"', (t) => red(t, { drop: 'aero-lab/migrations/001-aero-lab.sql' }, /found 1 vehicle-record lab\(s\) \(ocean-lab\)/));

test('a portable-object schema that moves in its declaration goes red against the emitted objects', (t) => red(t, { file: DECLARATION, from: "'oshal.portable-object/1'", to: "'oshal.portable-object/2'" }, /schema oshal\.portable-object\/1 differs from PORTABLE_OBJECT_SCHEMA oshal\.portable-object\/2/));

test('a reordered key list goes red against the emitted objects', (t) => red(t, { file: DECLARATION, from: "['schema', 'identity', 'geometry'", to: "['schema', 'geometry', 'identity'" }, /keys .* differ from PORTABLE_OBJECT_KEYS/));

test('an emitted object that loses a D8 block goes red', (t) => red(t, jsonEdit(OBJECTS, (j) => { delete j.objects[2].forceModel; }), /objects\[2\] \(wing\): keys .* differ/));

test('a mass value without provenance goes red', (t) => red(t, jsonEdit(OBJECTS, (j) => { delete j.objects[0].massProperties.inertia.provenance; }), /\(float\): massProperties\.inertia carries no provenance/));

test('an attachment frame that no longer quotes CAD Studio goes red when CAD Studio changes its frame', (t) => red(t, { file: 'cad-studio/src-routes/feature-contract.ts', from: "worldFrame: 'right-handed, Z up,", to: "worldFrame: 'right-handed, Y up," }, /CAD_STUDIO_WORLD_FRAME .* is not CAD Studio's worldFrame/));

test('a force model on an object that disagrees with its lab\'s envelope goes red', (t) => red(t, jsonEdit(OBJECTS, (j) => { j.objects[2].forceModel.validIn = ['seawater']; }), /\(wing\): forceModel wave-propulsion .* differs from its lab's envelope/));

test('a lab that declares the shape but keeps no emitted fixture fails closed', (t) => red(t, { drop: OBJECTS }, /ocean-lab: declares the portable-object shape but keeps no committed portable-objects fixture/));

test('a portable-object shape declared nowhere fails closed', (t) => red(t, { file: DECLARATION, from: 'export const PORTABLE_OBJECT_SCHEMA', to: 'const PORTABLE_OBJECT_SCHEMA' }, /PORTABLE_OBJECT_SCHEMA is declared nowhere/));

test('the real store agrees', () => {
  const { problems, labs } = adr160ContractDrift(REPOSITORY_ROOT);
  assert.deepEqual(problems, []);
  assert.ok(labs.includes('aero-lab') && labs.includes('ocean-lab'), labs.join(','));
});
