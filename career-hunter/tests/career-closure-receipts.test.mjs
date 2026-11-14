// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the closure-receipt contract (real temporary SQLite), then read a re-keyed saved job through the shipped saved-jobs board query: it is still open at its new address, and a job the employer took down still says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { fetchBoardPage } = require('../routes/career-board-feed.js');
const SCRIPT = fileURLToPath(new URL('./career-closure-receipts.py', import.meta.url));
const python = (args) => spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [SCRIPT, ...args],
  { encoding: 'utf8', timeout: 240000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });

test('each closure a complete read makes is recorded, a re-key keeps the job, and a full pull leaves a receipt', () => {
  const result = python([]);
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});

test('a re-keyed saved job stays open on My jobs at its new address; a job the employer took down still shows closed', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'career-closure-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const built = python(['--saved-fixture', folder]);
  assert.equal(built.status, 0, built.stderr || built.error?.message || built.stdout);
  const { saved, gone } = JSON.parse(built.stdout.trim().split('\n').pop());
  const db = new DatabaseSync(join(folder, 'user.db'), { readOnly: true });
  t.after(() => db.close());
  db.exec(`ATTACH DATABASE '${join(folder, 'corpus.db').replaceAll("'", "''")}' AS corpus`);
  // The call My jobs' Saved list makes (routes/career-board-routes.js getJobs with the saved ids).
  const page = fetchBoardPage(db, { status: 'saved', lane: 'all', sort: 'ai', per: '20' }, null, [saved, gone]);
  const byId = new Map(page.jobs.map((job) => [Number(job.id), job]));
  assert.ok(byId.has(saved), 'the saved job is still on the list');
  assert.equal(byId.get(saved).url, 'https://jobs.example/10001', 'at the address the employer now uses');
  assert.ok(byId.has(gone), 'a job the employer took down stays on the list');
  assert.equal(byId.get(gone).url, 'https://jobs.example/job/Miami-FL/Cashier_R10005');
  // The flag Prepare reads before it starts (lib/career-workflow-routes.js job()): open, and closed for the gone one.
  const open = (id) => db.prepare('SELECT p.active FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?').get(id).active;
  assert.equal(open(saved), 1, 'Prepare does not say "The employer posting is no longer available."');
  assert.equal(open(gone), 0);
});
