/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16, Torch Technologies on My jobs): the backfill that re-reads, once, the descriptions the shared corpus has none for (scripts/backfill-job-descriptions.py), run by career-job-descriptions-backfill-contract.py over a disposable Career root built from the engine's corpus schema, the employer answering from the saved real Torch Technologies posting: its dry run prints counts only and writes nothing; it fills exactly what read, in an edited copy published under the pull's lock with the old corpus kept; a closed, refused or empty answer is left as it was; a second run fills nothing; a held lock, a changed corpus or a stopped pull's work refuses.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the description backfill: counts-only dry run, one fill per read, idempotent, never invents, refuses a busy or changed corpus', () => {
  const out = spawnSync(process.env.CAREER_PYTHON || process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-job-descriptions-backfill-contract.py', import.meta.url))], {encoding:'utf8', timeout:120000});
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /Ran 3 tests[\s\S]*\nOK\s*$/);
});
