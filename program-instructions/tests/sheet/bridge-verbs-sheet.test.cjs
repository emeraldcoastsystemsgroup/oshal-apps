/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0 (T76): the committed lib/bridge-verbs.json is what the bridge fact sheet gives now. Runs the distiller's real --check against the sheet at its own path (OSHAL_BRIDGE_FACTS, else the coordinator's handover copy, scripts/bridge-verbs.cjs DEFAULT_SHEET). It fails, never skips, when the sheet is absent, and it fails when Lane G regenerates the sheet until the file is re-derived with node scripts/bridge-verbs.cjs. Kept apart from the package suite so the Test Lab can name its one prerequisite, the sheet.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Moved to tests/sheet/, out of the store job's tests/*.test.cjs glob: the store gate never depends on a file outside the repository. Test Lab runs it by name.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4): --check runs against every default sheet, Lane G's and the package's own inputs/windows-bridge-facts.json, since the committed file is distilled from both.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const script = path.join(root, 'scripts/bridge-verbs.cjs');
const { DEFAULT_SHEETS } = require(script);

test('the committed bridge verbs are what the bridge fact sheet gives now (--check)', () => {
  let said = '';
  let code = 0;
  try {
    said = execFileSync(process.execPath, [script, '--check', ...DEFAULT_SHEETS], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    code = error.status;
    said = `${error.stdout || ''}${error.stderr || ''}`;
  }
  assert.equal(code, 0, `${said.trim()} (set OSHAL_BRIDGE_FACTS to Lane G's sheet when it is not at ${DEFAULT_SHEETS[0]})`);
  assert.match(said, /bridge-verbs\.json is what .* gives now/);
});
