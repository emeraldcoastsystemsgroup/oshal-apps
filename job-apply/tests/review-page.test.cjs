/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Job Apply, grade F): the review page carries no brief form and no hand-off receiver (its input went nowhere), never shows the ledger-contract paragraph or "Open the app to begin", and its one primary is Open in Career. The manifest keeps the route but no Apps tile and no receiver naming the removed surface (the kernel refuses an accepts entry whose surface is not a tile).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: Job Apply exposes one setting screen (job-apply-settings -> /api/job-apply/settings) that chooses which connected device applies to jobs, explains how to connect one when none are connected, keeps Open in Career, and never renders a ticket queue or brief form.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');

test('no brief form, no ticket queue table, and no hand-off receiver on the page', () => {
  assert.doesNotMatch(html, /id="notes"|id="title"|Your next brief/);
  assert.doesNotMatch(html, /receiveHandoff|mountConnectedActions/);
  assert.doesNotMatch(html, /Use this evidence/);
});

test('the setting screen shows None connected guidance, reads/saves /api/apply-operator/workers, and links Open in Career', () => {
  assert.match(html, /None connected/);
  assert.match(html, /\/cockpit\/tools\/devices\.html/);
  assert.match(html, /fetch\('\/api\/apply-operator\/workers'/);
  assert.match(html, /method:\s*'PUT'/);
  assert.match(html, /href="\/cockpit\/\?app=career-hunter&amp;screen=career-submission-activity" target="_top">Open in Career/);
});

test('the manifest declares the job-apply-settings tile, defaultView, config route tool, and no duplicate settings schema', () => {
  assert.match(manifest, /toolName:\s*job-apply-settings/);
  assert.match(manifest, /iframeUrl:\s*\/api\/job-apply\/settings/);
  assert.match(manifest, /defaultView:\s*job-apply-settings/);
  assert.match(manifest, /name:\s*job_apply_device_config/);
  assert.match(manifest, /mountPath:\s*\/api\/job-apply/);
  assert.doesNotMatch(manifest, /^settings:/m);
  const routeSrc = fs.readFileSync(path.join(ROOT, 'src-routes', 'review.ts'), 'utf8');
  assert.match(routeSrc, /oshal-app\.yaml/);
  assert.doesNotMatch(routeSrc, /version:\s*'1\.2\.0'/);
});
