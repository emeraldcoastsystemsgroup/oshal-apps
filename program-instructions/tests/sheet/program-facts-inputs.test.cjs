/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1 (T76): the committed lib/program-facts.json is what Lane G's pack inputs give now. Runs the distiller's real --check against the inputs at their own path (OSHAL_PACK_INPUTS, else the coordinator's handover copy, scripts/program-facts.cjs DEFAULT_INPUTS). It fails, never skips, when the inputs are absent, and it fails when Lane G changes a program's facts or words until the file is re-derived with node scripts/program-facts.cjs. In tests/sheet/, out of the store job's glob, because it reads a file outside this repository; the Test Lab runs it by name.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4): --check runs against every default inputs file, Lane G's and the package's own inputs/windows-pack-inputs.json, since the committed file is distilled from both.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the default Linux inputs are the package's own inputs/linux-pack-inputs.json (Lane G's file with Lane G4's wording; tests/sheet/linux-sources.test.cjs holds it to Lane G's), so --check runs over the package's two inputs files. It failed on main: Lane G's handover file had fourteen programs and the committed file three.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const script = path.join(root, 'scripts/program-facts.cjs');
const { DEFAULT_SOURCES } = require(script);

test('the committed program facts are what the pack inputs give now (--check)', () => {
  let said = '';
  let code = 0;
  try {
    said = execFileSync(process.execPath, [script, '--check', ...DEFAULT_SOURCES], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    code = error.status;
    said = `${error.stdout || ''}${error.stderr || ''}`;
  }
  assert.equal(code, 0, `${said.trim()} (the Linux inputs are ${DEFAULT_SOURCES[0]} unless OSHAL_PACK_INPUTS names others)`);
  assert.match(said, /program-facts\.json is what .* gives now/);
});
