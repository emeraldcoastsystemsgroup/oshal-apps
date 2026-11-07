/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Job Apply, grade F): the review page carries no brief form and no hand-off receiver (its input went nowhere), never shows the ledger-contract paragraph or "Open the app to begin", and its one primary is Open in Career. The manifest keeps the route but no Apps tile and no receiver naming the removed surface (the kernel refuses an accepts entry whose surface is not a tile).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');

test('no brief form and no hand-off receiver on the page', () => {
  assert.doesNotMatch(html, /id="notes"|id="title"|Your next brief/);
  assert.doesNotMatch(html, /receiveHandoff|mountConnectedActions/);
  assert.doesNotMatch(html, /Use this evidence/);
});

test('the ledger contract and the empty-account line are filtered, and the one primary opens Career', () => {
  assert.match(html, /const HIDDEN_NOTE=\/\^\(Uses the authoritative Apply V2 ledger\|No saved work yet/);
  assert.match(html, /if\(HIDDEN_NOTE\.test\(String\(item\.text\|\|''\)\)\)continue;/);
  const primaries = html.match(/class="primary"[^>]*>[^<]*</g) || [];
  assert.deepEqual(primaries.map((p) => p.replace(/.*>/, '').replace('<', '')), ['Open in Career']);
  assert.match(html, /href="\/cockpit\/\?app=career-hunter&amp;screen=career-submission-activity" target="_top">Open in Career/);
});

test('the manifest keeps the route without an Apps tile or a receiver for the removed surface', () => {
  assert.match(manifest, /^ui:\n(?:  #.*\n)*  static: \[\]$/m);
  assert.doesNotMatch(manifest, /^\s+surface: job-apply-review$/m);
  assert.match(manifest, /mountPath: \/api\/job-apply/);
});
