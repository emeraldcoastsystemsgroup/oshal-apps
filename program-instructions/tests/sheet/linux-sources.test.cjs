/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the package's own inputs/linux-pack-inputs.json is Lane G's pack-inputs.json (its handover path, scripts/program-facts.cjs LANE_G_INPUTS) with only the programs its `amended` record names changed, each of those citing Lane G4's commit 6602c84d; and every test of Orbit's Linux suites a Linux fact names as its proof (test-linux-any-program.cjs, test-linux-open-readable.cjs, quoted by the start of its title) is in the kernel checkout. It fails when Lane G changes its file until the copy is brought up to date, and it fails, never skips, when the handover file or the kernel checkout is absent. In tests/sheet/, out of the store job's glob, because it reads files outside this repository; the Test Lab runs it by name.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane LX1): a Linux fact may name test-linux-everyday-programs.cjs as its proof (Lane LX1's suite of the Spark's everyday programs), and its cited test titles are held to that file in the kernel checkout as the other two suites' are.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const { LANE_G_INPUTS } = require(path.join(root, 'scripts/program-facts.cjs'));
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const SCRIPTS = path.join(KERNEL, 'desktop', 'oshal-node', 'scripts');
const ours = JSON.parse(fs.readFileSync(path.join(root, 'inputs/linux-pack-inputs.json'), 'utf8'));

test('the package\'s Linux inputs are Lane G\'s file with only the programs it names as amended changed, each citing Lane G4', () => {
  assert.ok(fs.existsSync(LANE_G_INPUTS), `Lane G's pack inputs are at ${LANE_G_INPUTS}`);
  const laneG = JSON.parse(fs.readFileSync(LANE_G_INPUTS, 'utf8'));
  const key = (entry) => `${entry.platform}/${entry.program}/${entry.bridge}`;
  assert.deepEqual(ours.programs.map(key), laneG.programs.map(key), 'the same programs in the same order');
  const amended = ours.amended.programs;
  for (const [index, entry] of ours.programs.entries()) {
    if (!amended.includes(entry.program)) {
      assert.deepEqual(entry, laneG.programs[index], `${entry.program} is as Lane G wrote it`);
      continue;
    }
    assert.notDeepEqual(entry, laneG.programs[index], `${entry.program} is named as amended`);
    assert.ok(entry.must_say.some(({ evidence }) => evidence.includes('6602c84d')), `${entry.program} cites Lane G4's commit`);
  }
  assert.deepEqual(ours.updated.slice(0, laneG.updated.length), laneG.updated, 'Lane G\'s own record of changes is kept');
});

test('every Orbit Linux test a Linux fact names as its proof is in the kernel checkout', () => {
  assert.ok(fs.existsSync(SCRIPTS), `the kernel checkout is at ${KERNEL} (set OSHAL_KERNEL_ROOT)`);
  const suites = {};
  const suite = (name) => {
    suites[name] ??= fs.readFileSync(path.join(SCRIPTS, name), 'utf8').replace(/\\'/g, "'");
    return suites[name];
  };
  let named = 0;
  for (const entry of ours.programs) {
    for (const { evidence } of entry.must_say) {
      for (const cited of evidence.matchAll(/(test-linux-(?:any-program|open-readable|everyday-programs)\.cjs)((?: (?:and )?'.+?\.\.\.',?)+)/g)) {
        for (const [, title] of cited[2].matchAll(/'(.+?)\.\.\.'/g)) {
          for (const part of title.split('...').map((piece) => piece.trim()).filter(Boolean)) {
            assert.ok(suite(cited[1]).includes(part), `${entry.program}: ${cited[1]} has a test titled with "${part}"`);
          }
          named += 1;
        }
      }
    }
  }
  assert.ok(named >= 20, `the Linux facts name their tests (${named} found)`);
});
