/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the compiled cron's completion status against real temporary filesystem markers, progressive corpus writes and failed pulls. Engine, graph, scoring and logger collaborators are scoped doubles; marker reads and writes remain real.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Module, { createRequire } from 'node:module';

const root = mkdtempSync(join(tmpdir(), 'career-completion-'));
const marker = join(root, '.last-evening-run');
const corpus = join(root, 'corpus.db');
const originalLoad = Module._load;
let pullOk = false;
Module._load = function load(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
  if (request === './career-user-store') return { userPaths: () => ({ corpusDb: corpus }), listStoreUsers: () => ['owner'] };
  if (request === './career-hunter-routes') return { enqueueForUser: async () => 0 };
  if (request === './career-engine-dispatch') return { runSharedPull: async () => ({ ok: pullOk }), runUserMatch: async () => ({ ok: true }) };
  if (request === './career-automation') return { readAutomationSettingsSystem: async () => ({ autoGenerate: false }) };
  if (request === './career-digest') return { sendDigestsForAllUsers: async () => undefined };
  if (request === './career-title-score') return {};
  if (request === './career-graph-routes') return { ingestJobsGraphForUser: async () => undefined };
  return originalLoad.call(this, request, ...rest);
};
const cron = createRequire(import.meta.url)('../routes/career-hunter-cron.js');
after(() => { Module._load = originalLoad; rmSync(root, { recursive: true, force: true }); });

test('completion status is null for absent or corrupted markers', () => {
  assert.equal(cron.lastEveningCompletedAt('owner'), null);
  writeFileSync(marker, 'not a date');
  assert.equal(cron.lastEveningCompletedAt('owner'), null);
});

test('progressive corpus writes and failed pulls preserve the previous completion', async () => {
  const previous = '2026-10-06T08:48:47.612Z';
  writeFileSync(marker, previous);
  writeFileSync(corpus, 'rows progressively written by the new scrape');
  assert.equal(cron.lastEveningCompletedAt('owner'), previous);
  pullOk = false;
  await cron.runEveningScrapeIndex({ pool: {} }, ['owner'], { manualRefresh: true });
  assert.equal(readFileSync(marker, 'utf8'), previous);
  assert.equal(cron.lastEveningCompletedAt('owner'), previous);
});

test('only a successful completed chain advances the real completion marker', async () => {
  pullOk = true;
  const before = Date.now();
  await cron.runEveningScrapeIndex({ pool: {} }, ['owner'], { manualRefresh: true });
  const completed = cron.lastEveningCompletedAt('owner');
  assert.ok(Date.parse(completed) >= before);
  assert.ok(Date.parse(completed) <= Date.now());
  assert.equal(readFileSync(marker, 'utf8'), completed);
});
