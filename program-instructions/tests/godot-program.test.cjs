/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the kernel keeps a row for the Godot 4 editor (program godot, bridge godot: Orbit's Godot add-on), and its text names the seventeen verbs the add-on declares and no other; its request lists them and carries the measured facts with room to be asked once more; the committed files hold exactly what the package's own Godot inputs give, each fact naming the Godot test or Orbit source that proves it; a Godot text holding the measured words is published and one lacking them is reported.
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
/** Godot's row as the kernel's claim answer shapes it, at the version Orbit's Linux reader gives the Spark's build; the id and claim are fixture values. */
const GODOT = Object.freeze({
  id: 'ef'.repeat(32), claim: '12'.repeat(16), platform: 'linux', program: 'godot', version: '4.7.2', version_kind: 'file',
  bridge: 'godot', attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
/** The verbs Orbit's Godot add-on declares (desktop/oshal-node/src/main/bridges/godot-actions.ts GODOT_ACTIONS). */
const GODOT_VERBS = ['add-node', 'set-property', 'create-script', 'edit-script', 'run-scene', 'game-output', 'stop-scene', 'open-scene',
  'new-scene', 'save-scene', 'rename-node', 'move-node', 'delete-node', 'add-input-action', 'instance-scene', 'import-asset', 'show-view'];
const KIND = "project (a Godot editor with Orbit's add-on)";

const declared = (id) => `# Fixture text for a test (not documentation)\n\n${'Plain words. '.repeat(20)}\nRun {"action": "invoke", "declared": "${id}"} next.`;

/** A kernel that answers each step from a script and records what it was asked. */
function standInKernel(script) {
  const calls = [];
  const answer = (step, input) => {
    calls.push({ step, input });
    if (script[step] === undefined) throw new Error(`refused: the stand-in kernel has no answer for ${step}`);
    return script[step];
  };
  return { calls, ctx: { intent: async (name, input) => answer(name, input), executeBot: async (agentId, request) => answer('bot', { agentId, request }) } };
}

test('a Godot text names only the seventeen verbs Orbit\'s Godot add-on declares', () => {
  for (const id of GODOT_VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'godot', GODOT.program), null, id);
  for (const id of ['insert-paragraph', 'save-document', 'set-cells', 'add-slide', 'export-document']) {
    assert.equal(pack.checkBody(declared(id), CONTRACT, 'godot', GODOT.program),
      `the text names the declared verb "${id}", and the godot bridge does not list it for this program`, id);
  }
  assert.deepEqual(pack.verbsFor('godot', GODOT.program).ids, GODOT_VERBS);
  assert.deepEqual(pack.verbsFor('godot', GODOT.program).kinds.map(([kind]) => kind), [KIND]);
});

test('Godot\'s request lists its verbs and carries its measured facts, with room to be asked once more', () => {
  const text = pack.requestText(GODOT);
  assert.ok(text.includes(`- Declared verbs the godot bridge has for this program, by document kind:\n  - ${KIND}: ${GODOT_VERBS.join(', ')}\n`), text);
  const facts = pack.factsFor(GODOT);
  assert.ok(facts, 'lib/program-facts.json has linux, godot, godot');
  for (const line of [...facts.facts, ...facts.never, ...facts.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
  for (const word of facts.absent) assert.ok(text.includes(`  - ${word}\n`), word);
  assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), 'a second request still fits under 8 KiB');
});

test('the committed files hold exactly what the package\'s own Godot inputs give, and each fact names its proof', () => {
  const { distil: distilFacts } = require(path.join(root, 'scripts/program-facts.cjs'));
  const { distil: distilVerbs } = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const inputs = readJson('inputs/godot-pack-inputs.json');
  const godot = pack.PROGRAM_FACTS.programs.filter((entry) => entry.bridge === 'godot');
  assert.deepEqual(godot, distilFacts(inputs).programs);
  assert.deepEqual(godot.map((entry) => `${entry.platform}/${entry.program}/${entry.bridge}`), ['linux/godot/godot']);
  assert.deepEqual(pack.BRIDGE_VERBS.bridges.godot, distilVerbs(readJson('inputs/godot-bridge-facts.json')).bridges.godot);
  assert.deepEqual(pack.BRIDGE_VERBS.bridges.godot.actions, ['snapshot', 'invoke', 'undo']);
  for (const { fact, evidence } of inputs.programs[0].must_say) {
    assert.match(evidence, /desktop\/oshal-node\/(scripts\/test-godot-[a-z]+\.cjs|src\/main\/[a-z/-]+\.ts|plugins\/godot\/[a-z_/]+\.gd)/, fact.slice(0, 60));
  }
});

test('a Godot text holding the measured words is published; one lacking them is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const holding = [
    '# Godot Engine 4.7.2 on Linux (fixture text for a test, not documentation)', '',
    'Read the whole project first with {"action": "snapshot"}: res:// scenes, the node tree, the selection.',
    'Change it with {"action": "invoke", "declared": "add-node"}, set-property, create-script or edit-script.',
    'Try the game with run-scene, read game-output, then stop-scene. Take a change back with {"action": "undo"}.'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'godot', GODOT.program), null);
  assert.equal(pack.acceptanceProblem(holding, GODOT), null);
  const published = standInKernel({
    'application_profiles.claim': { requests: [GODOT] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: GODOT.id, claim: GODOT.claim, body: holding });
  const lacking = holding.replace('read game-output, then stop-scene', 'then stop-scene');
  const refused = standInKernel({
    'application_profiles.claim': { requests: [GODOT] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: game-output');
});
