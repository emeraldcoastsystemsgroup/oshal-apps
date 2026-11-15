/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.64.1: four more cases (the raised defaults, a source's seconds, a shared host, the stage ending early).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the pull's description stage contract: the real `scrape --all` over a disposable SQLite corpus keeps an in-lane job's description from its saved real page after every list is read, within its caps and off switch, and a pull killed inside the stage continues without reading a page it kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the pull keeps descriptions it can read, after the lists, within its caps', () => {
  const out = spawnSync(process.env.CAREER_PYTHON || process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-pull-details-contract.py', import.meta.url))],
    {encoding: 'utf8', timeout: 240000, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /Ran 12 tests/);
});
