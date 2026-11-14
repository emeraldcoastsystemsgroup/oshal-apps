/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): the package's own Blender inputs are what their sources say. The verbs in inputs/blender-bridge-facts.json are exactly the ids of BLENDER_ACTIONS in Orbit's code (desktop/oshal-node/src/main/bridges/blender-actions.ts), in its order, each at the line it names; each action names the line of the Blender bridge's method that runs it; and every Orbit file a fact in inputs/blender-pack-inputs.json names (a .ts, .py or .rs source, or a test-blender-*.cjs suite) exists in the kernel checkout. It reads the checkout at OSHAL_KERNEL_ROOT or its default folder, and fails, never skips, when it is absent.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.7 (Lane BL2): thirty verbs, the game-asset families of Orbit's Blender add-on 1.1.0.
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
const lineOf = (file, line) => fs.readFileSync(path.join(KERNEL, file), 'utf8').split('\n')[Number(line) - 1] || '';

test('Blender\'s verbs in the Blender sheet are BLENDER_ACTIONS in Orbit\'s code, each at the line it names', () => {
  assert.ok(fs.existsSync(ORBIT), `the kernel checkout is at ${KERNEL} (set OSHAL_KERNEL_ROOT)`);
  const text = fs.readFileSync(path.join(ORBIT, 'src/main/bridges/blender-actions.ts'), 'utf8');
  const orbit = [...text.matchAll(/^\s+id: '([a-z][a-z0-9-]*)', effect: '(?:reads|edits|acts)'/gm)].map((match) => match[1]);
  assert.equal(orbit.length, 30, 'Orbit declares thirty Blender verbs');
  const sheet = readJson('inputs/blender-bridge-facts.json').bridges.blender;
  assert.deepEqual(Object.keys(sheet.declared), ['scene (Blender)'], 'one kind and no catch-all, so every Blender row gets the verbs');
  assert.deepEqual(sheet.declared['scene (Blender)'].map((verb) => verb.id), orbit);
  for (const verb of sheet.declared['scene (Blender)']) {
    const [file, line] = verb.source.split(':');
    assert.match(lineOf(file, line), new RegExp(`id: '${verb.id}'`), `${verb.source} holds ${verb.id}`);
  }
  const methods = { snapshot: 'async read(', invoke: 'async invoke(', undo: 'async undoGroup(', restore: 'async restore(' };
  assert.deepEqual(Object.keys(sheet.actions), Object.keys(methods));
  for (const [action, { source }] of Object.entries(sheet.actions)) {
    const [file, line] = source.split(':');
    assert.ok(lineOf(file, line).includes(methods[action]), `${source} is where ${action} runs`);
  }
});

test('every Orbit file a Blender fact names is in the kernel checkout', () => {
  const inputs = readJson('inputs/blender-pack-inputs.json');
  const named = new Set();
  for (const { evidence } of inputs.programs.flatMap((program) => program.must_say)) {
    for (const match of evidence.matchAll(/((?:desktop\/oshal-node|crates)\/[A-Za-z0-9/._-]+\.(?:ts|py|rs|cjs))|(scripts\/test-blender-[a-z-]+\.cjs)/g)) {
      named.add(match[1] || `desktop/oshal-node/${match[2]}`);
    }
  }
  assert.ok(named.size >= 6, [...named].join(', '));
  for (const file of named) assert.ok(fs.existsSync(path.join(KERNEL, file)), `${file} is in the kernel checkout`);
});
