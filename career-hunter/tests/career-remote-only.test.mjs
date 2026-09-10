/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the remote-only scoring contract against the production engine, and pin every place the standing preference must be honoured against the COMPILED routes — the scoring choke point, the manual run, the digest, and the board default. A preference honoured in three of four places is the defect this guards.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const routes = (name) => readFileSync(join(packageRoot, 'routes', name), 'utf8');

test('the scoring candidate query narrows to remote when the preference is set', () => {
  const result = spawnSync('python', [join(packageRoot, 'tests', 'career-remote-only-contract.py')], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONPATH: join(packageRoot, 'engine') },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, [], 'every contract check must hold');
  assert.ok(report.checks >= 12, `expected the full contract, ran ${report.checks}`);
});

test('every automated path consults the preference', () => {
  // The scoring choke point: cron and boot catch-up both funnel through runUserScore, so gating
  // here is what keeps them from disagreeing about what counts as a match.
  const dispatch = routes('career-engine-dispatch.js');
  assert.match(dispatch, /readRemoteOnly\)?\(pool, userSub\)/, 'runUserScore must read the preference');
  assert.match(dispatch, /--remote-only/, 'the engine flag must be passed');

  // A manual "score now" must not disagree with the nightly pass.
  const run = routes('career-run-routes.js');
  assert.match(run, /readRemoteOnly\)?\(ctx\.pool, userSub\)/, 'the manual score must read the preference');
  assert.match(run, /--remote-only/, 'the manual score must pass the engine flag');

  // The digest.
  const digest = routes('career-digest.js');
  assert.match(digest, /readRemoteOnly\)?\(pool, userSub\)/, 'the digest must read the preference');
  assert.match(digest, /COALESCE\(pc\.remote, 0\) = 1/, 'the digest must filter on remote');

  // The matched board, as a DEFAULT that an explicit pill still overrides.
  const board = routes('career-board-routes.js');
  assert.match(board, /query\.remote === undefined/, 'an explicit remote pill must win over the preference');
  assert.match(board, /readRemoteOnly\)?\(ctx\.pool, userSub\)/, 'the board must read the preference');
});

test('the preference is stored, readable and refused when malformed', () => {
  const settings = routes('career-title-score.js');
  assert.match(settings, /\/settings\/remote-only/, 'the save route must be registered');
  assert.match(settings, /remoteOnly !== 'boolean'/, 'a non-boolean must be refused');
  assert.match(settings, /unauthorized/, 'an unauthenticated caller must be refused');
  assert.match(settings, /remote_only = EXCLUDED\.remote_only/, 'the upsert must write only this column');
  assert.match(settings, /remote_only/, 'the state read must select the column');
});

test('the migration ships and is listed in the manifest', () => {
  const sql = readFileSync(join(packageRoot, 'migrations', '104-career-remote-only.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS remote_only BOOLEAN NOT NULL DEFAULT FALSE/,
    'additive and defaulted off, so existing users are unchanged');
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /migrations\/104-career-remote-only\.sql/, 'the migration must be applied on load');
});
