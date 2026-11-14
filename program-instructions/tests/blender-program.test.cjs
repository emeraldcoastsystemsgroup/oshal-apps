/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): Blender on Linux. Orbit's Linux reader reports a bound Blender on the blender bridge with its own --version (kernel 871319bb: `Blender 5.1.0`, version kind file), and Orbit's Blender add-on declares sixteen verbs on the open .blend (kernel 54321ffd, desktop/oshal-node/src/main/bridges/blender-actions.ts). Before 0.1.6 the writer had no entry for that bridge, so a Blender text naming any verb was refused ("no declared verbs are known for this bridge") and it had no measured facts. These cases prove that a Blender text names exactly those sixteen verbs and no other program's, that Blender's request lists them and carries its measured facts with room to be asked once more, that the committed files hold exactly what the package's own Blender inputs give with each fact naming its proof, that a Blender text holding the measured words is published while one lacking them is reported, and that both distillers take the Blender files after the Windows ones. The Blender row is the version the Spark's Blender reports (5.1.0, by its own --version).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6, folded with Lane GD1's Godot and Lane LX1's everyday Linux facts: both distillers take the Blender files after the Windows and Godot ones, and VS Code's after them.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.7 (Lane BL2, Blender as a game-asset tool): Orbit's Blender add-on 1.1.0 declares thirty verbs by family (import, mesh, UV, material, light, camera, collection, rig, animation, scene, file). A Blender text names exactly those, its request carries the new facts (edit-mesh's operation and faces, decimate to a budget, the character's order through make-action, export-glb's animations as Godot lists them, the Python gate's second switch), and a text must hold edit-mesh and make-action and never the input name op.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pack = require(path.join(root, 'lib/instruction-pack.js'));
const loadRoutes = () => import(pathToFileURL(path.join(root, 'routes/program-instructions.mjs')).href);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const CONTRACT = Object.freeze({
  tools: ['computer.app', 'computer.open'],
  actions: ['apps', 'snapshot', 'scroll', 'press', 'type', 'select', 'invoke', 'undo', 'restore'],
  min_bytes: 200,
  max_bytes: 8192
});
/** Blender's row as the kernel's claim answer shapes it: the version the Spark's Blender reports; id, claim and expiry are fixture values. */
const BLENDER = Object.freeze({
  id: 'ef'.repeat(32), claim: 'ab'.repeat(16), platform: 'linux', program: 'blender', version: '5.1.0', version_kind: 'file',
  bridge: 'blender', attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
/** The verbs Orbit's Blender add-on declares (desktop/oshal-node/src/main/bridges/blender-actions.ts BLENDER_ACTIONS). */
const BLENDER_VERBS = ['add-primitive', 'transform-object', 'delete-object', 'rename', 'set-parent', 'add-modifier', 'set-modifier', 'remove-modifier', 'apply-modifier',
  'edit-mesh', 'clean-mesh', 'uv-unwrap', 'set-material-color', 'texture-material', 'bake-texture', 'add-light', 'add-camera', 'organize-collection',
  'add-armature', 'skin-to-armature', 'insert-keyframe', 'make-action', 'shape-key', 'import-model', 'run-python', 'read-object', 'scene-stats',
  'viewport-screenshot', 'save-file', 'export-glb'];

const declared = (id) => `# Fixture text for a test (not documentation)\n\n${'Plain words. '.repeat(20)}\nRun {"action": "invoke", "declared": "${id}"} next.`;

/** The package suite's stand-in for the kernel's rails: each call by name answers what the case scripts, and is recorded. */
function standInKernel(script) {
  const calls = [];
  const answer = (step, input) => {
    calls.push({ step, input });
    if (script[step] === undefined) throw new Error(`refused: the stand-in kernel has no answer for ${step}`);
    return script[step];
  };
  return { calls, ctx: { intent: async (name, input) => answer(name, input), executeBot: async (agentId, request) => answer('bot', { agentId, request }) } };
}

test('a Blender text names only the thirty verbs Orbit\'s Blender add-on declares, and no other program\'s', () => {
  for (const id of BLENDER_VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'blender', BLENDER.program), null, `Blender ${id}`);
  assert.deepEqual(pack.verbsFor('blender', BLENDER.program).ids, BLENDER_VERBS);
  for (const id of ['save-document', 'insert-paragraph', 'set-cells', 'add-slide', 'export-gltf', 'add-object']) {
    assert.equal(pack.checkBody(declared(id), CONTRACT, 'blender', BLENDER.program),
      `the text names the declared verb "${id}", and the blender bridge does not list it for this program`, id);
  }
  assert.equal(pack.verbsFor('libreoffice', 'libreoffice-writer').ids.includes('export-glb'), false, 'no other bridge names a Blender verb');
});

test('Blender\'s request lists its verbs and carries its measured facts, with room to be asked once more', () => {
  const text = pack.requestText(BLENDER);
  assert.ok(text.includes('- Declared verbs the blender bridge has for this program, by document kind:\n'
    + `  - scene (Blender): ${BLENDER_VERBS.join(', ')}\n`), text);
  const facts = pack.factsFor(BLENDER);
  assert.ok(facts, 'lib/program-facts.json has linux, blender, blender');
  for (const line of [...facts.facts, ...facts.never, ...facts.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
  for (const word of facts.absent) assert.ok(text.includes(`  - ${word}\n`), word);
  for (const word of ['export-glb', 'res://', 'confirmed', 'Object Mode', '"action": "undo"', 'edit-mesh', 'make-action']) assert.ok(facts.contains.includes(word), word);
  assert.ok(facts.absent.includes('"op":'), 'the door keeps op; the input is operation');
  assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), 'a second request still fits under 8 KiB');
});

test('the committed files hold exactly what the package\'s own Blender inputs give, and each fact names its proof', () => {
  const { distil: distilFacts } = require(path.join(root, 'scripts/program-facts.cjs'));
  const { distil: distilVerbs } = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const inputs = readJson('inputs/blender-pack-inputs.json');
  const blender = pack.PROGRAM_FACTS.programs.filter((entry) => entry.bridge === 'blender');
  assert.deepEqual(blender, distilFacts(inputs).programs);
  assert.deepEqual(blender.map((entry) => `${entry.platform}/${entry.program}/${entry.bridge}`), ['linux/blender/blender']);
  assert.deepEqual(pack.BRIDGE_VERBS.bridges.blender, distilVerbs(readJson('inputs/blender-bridge-facts.json')).bridges.blender);
  for (const { fact, evidence } of inputs.programs[0].must_say) {
    assert.match(evidence, /test-blender-[a-z-]+\.cjs|desktop\/oshal-node\/[A-Za-z0-9/._-]+/, fact.slice(0, 60));
  }
  assert.ok(inputs.programs[0].must_say.filter(({ evidence }) => /test-blender-plugin-desktop\.cjs/.test(evidence)).length >= 8, 'most facts cite the real-Blender suite');
});

test('a Blender text holding the measured words is published; one lacking them is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const holding = [
    '# Blender 5.1.0 on Linux (fixture text for a test, not documentation)', '',
    'Read the open file with {"action": "snapshot"}. Change it only with {"action": "invoke"}, for example "declared": "add-primitive"',
    'or "declared": "transform-object" (rotation in degrees), and only in Object Mode. Take a change back with {"action": "undo"}.',
    'Hand a model to Godot with "declared": "export-glb"; the answer gives its res:// path. run-python needs confirmed after a yes.',
    'Model with "declared": "edit-mesh" and make each animation with "declared": "make-action".'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'blender', BLENDER.program), null);
  assert.equal(pack.acceptanceProblem(holding, BLENDER), null, `holds ${pack.factsFor(BLENDER).contains.join(', ')}`);
  const published = standInKernel({
    'application_profiles.claim': { requests: [BLENDER] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: BLENDER.id, claim: BLENDER.claim, body: holding });
  const lacking = holding.replace('the answer gives its res:// path', 'the answer names the file');
  const refused = standInKernel({
    'application_profiles.claim': { requests: [BLENDER] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: res://');
});

test('both distillers take the Blender files after the Windows and Godot ones, and before VS Code\'s', () => {
  const verbs = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const facts = require(path.join(root, 'scripts/program-facts.cjs'));
  assert.deepEqual(verbs.DEFAULT_SHEETS, [verbs.DEFAULT_SHEET, verbs.WINDOWS_SHEET, verbs.GODOT_SHEET, verbs.BLENDER_SHEET, verbs.VSCODE_SHEET]);
  assert.deepEqual(facts.DEFAULT_SOURCES, [facts.DEFAULT_INPUTS, facts.WINDOWS_INPUTS, facts.GODOT_INPUTS, facts.BLENDER_INPUTS, facts.VSCODE_INPUTS]);
  assert.deepEqual(pack.BRIDGE_VERBS.provenance.map((entry) => entry.sheet).slice(-2), ['inputs/blender-bridge-facts.json', 'inputs/vscode-bridge-facts.json']);
});
