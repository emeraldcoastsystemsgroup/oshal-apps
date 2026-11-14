/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane VS1: Orbit reports a bound VS Code on the vscode bridge (Orbit's VS Code extension, kernel 7ed028e0), which had no entry here, so a VS Code text naming the extension's edit-text was refused and its request said no declared verbs were known. Proves that VS Code on vscode has its measured facts and the extension's twelve verbs, that a text may name them on vscode and not on linux-atspi, that a LibreOffice verb is refused for VS Code, that the committed entries are exactly what inputs/vscode-pack-inputs.json and inputs/vscode-bridge-facts.json give, and that a text holding the measured words is published while one without the run gate's words is reported. Stand-in kernel rails as in the package suite; no kernel, model or network.
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
/** A claimed Linux row as the kernel's claim answer shapes it; the id, claim and version are fixture values. */
const claimed = (bridge) => Object.freeze({
  id: 'ef'.repeat(32), claim: '12'.repeat(16), platform: 'linux', program: 'com.microsoft.vscode', version: '1.146.0', version_kind: 'package',
  bridge, attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
const VSCODE = claimed('vscode');
const VERBS = ['workspace', 'read-file', 'problems', 'find-in-files', 'open-file', 'edit-text', 'save-file', 'list-tasks', 'run-task', 'run-command', 'terminals', 'terminal-output'];
const declared = (id) => `# Fixture text for a test (not documentation)\n\n${'Plain words. '.repeat(20)}\nRun {"action": "invoke", "declared": "${id}"} next.`;

/** The kernel rails a tick calls and the bot, answered as the test's script says, each call recorded (windows-programs.test.cjs). */
function standInKernel(script) {
  const calls = [];
  const answer = (step, input) => {
    calls.push({ step, input });
    if (script[step] === undefined) throw new Error(`refused: the stand-in kernel has no answer for ${step}`);
    return script[step];
  };
  return { calls, ctx: { intent: async (name, input) => answer(name, input), executeBot: async (agentId, request) => answer('bot', { agentId, request }) } };
}

test('VS Code on the vscode bridge has its measured facts, and the request lists the extension\'s twelve verbs', () => {
  const facts = pack.factsFor(VSCODE);
  assert.ok(facts, 'lib/program-facts.json has linux, com.microsoft.vscode, vscode');
  assert.deepEqual(pack.verbsFor('vscode', VSCODE.program).ids, VERBS);
  const text = pack.requestText(VSCODE);
  assert.ok(text.includes(`  - editor window (Visual Studio Code, Antigravity IDE, VSCodium with Orbit's extension): ${VERBS.join(', ')}\n`), text);
  for (const line of [...facts.facts, ...facts.never, ...facts.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
  for (const word of ['confirmed: true', 'Nothing was run', 'Restricted Mode', "Install Orbit's extension"]) assert.ok(facts.contains.includes(word), word);
  assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), 'a second request still fits under 8 KiB');
  assert.ok(pack.factsFor(claimed('linux-atspi')), 'Lane G3\'s entry stays for an Orbit that reports linux-atspi');
});

test('a VS Code text may name the extension\'s verbs on vscode only; a LibreOffice verb is refused', () => {
  for (const id of VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'vscode', VSCODE.program), null, id);
  for (const id of ['save-document', 'open-document', 'insert-paragraph', 'find-replace']) {
    assert.match(String(pack.checkBody(declared(id), CONTRACT, 'vscode', VSCODE.program)), /the vscode bridge does not list it/, id);
  }
  assert.match(String(pack.checkBody(declared('edit-text'), CONTRACT, 'linux-atspi', VSCODE.program)), /does not list it|no declared verbs/);
});

test('the committed files hold exactly what the package\'s own VS Code inputs give, and each fact names its test', () => {
  const { distil: distilFacts } = require(path.join(root, 'scripts/program-facts.cjs'));
  const { distil: distilVerbs } = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const inputs = readJson('inputs/vscode-pack-inputs.json');
  assert.deepEqual(pack.PROGRAM_FACTS.programs.filter((entry) => entry.bridge === 'vscode'), distilFacts(inputs).programs);
  assert.deepEqual(pack.BRIDGE_VERBS.bridges.vscode, distilVerbs(readJson('inputs/vscode-bridge-facts.json')).bridges.vscode);
  for (const { fact, evidence } of inputs.programs[0].must_say) {
    assert.match(evidence, /desktop\/oshal-node\/scripts\/test-vscode-extension-desktop\.cjs '/, fact.slice(0, 60));
  }
});

test('a VS Code text holding the measured words is published; one without the run gate\'s words is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const holding = [
    '# Visual Studio Code 1.146.0 on Linux (fixture text for a test, not documentation)', '',
    'With Orbit\'s VS Code extension a {"action": "snapshot"} has "part" "whole": the active file. Change it with',
    '{"action": "invoke", "declared": "edit-text"}, take a change back with {"action": "undo"}. Without the extension, ask the',
    'person to press Install Orbit\'s extension in Visual Studio Code. A command runs only after the person said yes, with',
    'confirmed: true; until then the answer says Nothing was run, and in Restricted Mode nothing runs at all.'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'vscode', VSCODE.program), null);
  assert.equal(pack.acceptanceProblem(holding, VSCODE), null);
  const published = standInKernel({ 'application_profiles.claim': { requests: [VSCODE] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' } });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  const lacking = holding.replace('confirmed: true; until then the answer says Nothing was run, and ', '');
  const refused = standInKernel({ 'application_profiles.claim': { requests: [VSCODE] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' } });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: confirmed: true, Nothing was run');
});
