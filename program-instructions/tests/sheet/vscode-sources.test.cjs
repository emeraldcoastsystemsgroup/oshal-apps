/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane VS1: the package's own VS Code inputs are what their sources say. The vscode bridge's verbs in inputs/vscode-bridge-facts.json are exactly the ids VSCODE_ACTIONS declares in Orbit's code (desktop/oshal-node/src/main/bridges/vscode-actions.ts), in order, each at the line it names; every test a fact of inputs/vscode-pack-inputs.json cites is in the kernel's real-VS Code suite (desktop/oshal-node/scripts/test-vscode-extension-desktop.cjs) and every commit it cites is in the kernel checkout. The kernel checkout is OSHAL_KERNEL_ROOT, else ~/Documents/projects/oshal-kernel; it fails, never skips, when that is absent. In tests/sheet/, out of the store job's glob, because it reads files outside this repository; the Test Lab runs it by name.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const ORBIT = path.join(KERNEL, 'desktop', 'oshal-node');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('the vscode bridge\'s verbs are the ones VSCODE_ACTIONS declares in Orbit\'s code, in order, each at the line it names', () => {
  assert.ok(fs.existsSync(ORBIT), `the kernel checkout is at ${KERNEL} (set OSHAL_KERNEL_ROOT)`);
  const file = 'src/main/bridges/vscode-actions.ts';
  const text = fs.readFileSync(path.join(ORBIT, file), 'utf8');
  const block = /export const VSCODE_ACTIONS: DeclaredAction\[\] = \[([\s\S]*?)\n\];/.exec(text);
  assert.ok(block, `VSCODE_ACTIONS is in desktop/oshal-node/${file}`);
  const ids = [...block[1].matchAll(/\bid: '([a-z][a-z0-9-]*)'/g)].map((match) => match[1]);
  const [kind] = Object.keys(readJson('inputs/vscode-bridge-facts.json').bridges.vscode.declared);
  const verbs = readJson('inputs/vscode-bridge-facts.json').bridges.vscode.declared[kind];
  assert.deepEqual(verbs.map((verb) => verb.id), ids);
  const lines = text.split('\n');
  for (const verb of verbs) {
    const [where, line] = verb.source.replace(/^desktop\/oshal-node\//, '').split(':');
    assert.equal(where, file);
    assert.ok((lines[Number(line) - 1] || '').includes(`id: '${verb.id}'`), `${verb.source} holds ${verb.id}`);
  }
});

test('every test and commit a VS Code fact cites is in the kernel checkout', () => {
  const suite = fs.readFileSync(path.join(ORBIT, 'scripts', 'test-vscode-extension-desktop.cjs'), 'utf8');
  const titles = new Set([...suite.matchAll(/\btest\('((?:\\'|[^'])*)'/g)].map((match) => match[1].replace(/\\'/g, "'")));
  for (const program of readJson('inputs/vscode-pack-inputs.json').programs) {
    for (const { evidence } of program.must_say) {
      const cited = [...evidence.matchAll(/test-vscode-extension-desktop\.cjs '([^']*(?:'[^' ,;][^']*)*)'/g)].map((match) => match[1]);
      assert.ok(cited.length > 0, evidence.slice(0, 80));
      for (const title of cited) assert.ok(titles.has(title), `${program.program}: the test '${title}'`);
      for (const [commit] of evidence.matchAll(/\b[0-9a-f]{8}\b/g)) {
        assert.doesNotThrow(() => execFileSync('git', ['-C', KERNEL, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' }), `${program.program}: commit ${commit}`);
      }
    }
  }
});
