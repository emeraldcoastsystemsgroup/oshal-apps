/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the package's own Godot inputs are what their sources say. The verbs in inputs/godot-bridge-facts.json are exactly GODOT_ACTIONS in Orbit's code (desktop/oshal-node/src/main/bridges/godot-actions.ts), each at the line its source names, and the bridge's actions name the methods of bridges/godot.ts that run them; every Godot test a fact names as its evidence is a test in the kernel's real Godot suites, and every Orbit file it names exists.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const ORBIT = path.join(KERNEL, 'desktop', 'oshal-node');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const lineOf = (source) => {
  const [file, line] = source.replace(/^desktop\/oshal-node\//, '').split(':');
  return fs.readFileSync(path.join(ORBIT, file), 'utf8').split('\n')[Number(line) - 1] || '';
};

test('the Godot sheet\'s verbs are the ones Orbit\'s Godot add-on declares, each at the line it names', () => {
  assert.ok(fs.existsSync(ORBIT), `the kernel checkout is at ${KERNEL} (set OSHAL_KERNEL_ROOT)`);
  const sheet = readJson('inputs/godot-bridge-facts.json').bridges.godot;
  const code = fs.readFileSync(path.join(ORBIT, 'src/main/bridges/godot-actions.ts'), 'utf8');
  const declaredIds = [...code.matchAll(/^ {4}id: '([a-z][a-z0-9-]*)'/gm)].map((m) => m[1]);
  const verbs = Object.values(sheet.declared).flat();
  assert.deepEqual(verbs.map((verb) => verb.id), declaredIds);
  for (const verb of verbs) assert.ok(lineOf(verb.source).includes(`id: '${verb.id}'`), `${verb.source} holds ${verb.id}`);
  const methods = { snapshot: 'async read(', invoke: 'async invoke(', undo: 'async undoGroup(' };
  for (const [action, { source }] of Object.entries(sheet.actions)) assert.ok(lineOf(source).includes(methods[action]), `${source} runs ${action}`);
});

test('every Godot test and Orbit file a Godot fact names as its evidence exists', () => {
  const suites = ['test-godot-editor.cjs', 'test-godot-dock.cjs', 'test-godot-addon.cjs'].map((name) => fs.readFileSync(path.join(ORBIT, 'scripts', name), 'utf8')).join('\n');
  for (const { fact, evidence } of readJson('inputs/godot-pack-inputs.json').programs[0].must_say) {
    for (const [, name] of evidence.matchAll(/test "([^"]+)"/g)) {
      assert.ok(suites.includes(`test('${name.replace(/'/g, "\\'")}'`), `a Godot test named "${name}" (${fact.slice(0, 40)})`);
    }
    assert.match(evidence, /test "[^"]+"/, `${fact.slice(0, 40)} names the test that proves it`);
    for (const [, file] of evidence.matchAll(/desktop\/oshal-node\/([A-Za-z0-9/._-]+\.(?:ts|cjs|gd))/g)) {
      assert.ok(fs.existsSync(path.join(ORBIT, file)), `desktop/oshal-node/${file}`);
    }
  }
});
