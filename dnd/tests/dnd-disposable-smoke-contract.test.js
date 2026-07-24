/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:52:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard the disposable smoke's local default, dedicated profile, provider intercepts, fresh-only writes, environment deny lists, and external redacted evidence.
 * 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Require both canonical and legacy Dungeon Master model requests to be intercepted locally.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dnd-disposable-gameplay-smoke.js'), 'utf8');
const docs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dnd-disposable-gameplay-smoke.md'), 'utf8');

test('disposable smoke is local-by-default and cannot borrow an ordinary browser profile', () => {
  assert.match(script, /DND_SMOKE_BASE_URL \|\| 'http:\/\/127\.0\.0\.1:35457'/);
  assert.match(script, /path\.join\(os\.homedir\(\), '\.oshal-e2e-chrome'\)/);
  assert.match(script, /path\.basename\(PROFILE\)\.toLowerCase\(\), '\.oshal-e2e-chrome'/);
  assert.match(script, /serviceWorkers: 'block'/);
  assert.match(script, /BASE, target\.origin/);
});

test('disposable smoke blocks paid media and fails closed around one fresh campaign', () => {
  assert.match(script, /url\.pathname === '\/api\/dnd\/tts'[\s\S]{0,260}route\.fulfill/);
  assert.match(script, /url\.pathname === '\/api\/dnd\/cutaway'[\s\S]{0,260}route\.fulfill/);
  assert.match(script, /\['\/api\/dnd\/chat', '\/api\/dnd\/dm'\]\.includes\(url\.pathname\)[\s\S]{0,260}route\.fulfill/);
  assert.match(script, /creating = method === 'POST' && url\.pathname === '\/api\/dnd\/campaign'/);
  assert.match(script, /beforeFreshBlocked = mutation && !evidence\.freshCampaign && !creating/);
  assert.match(script, /outsideFreshBlocked = mutation && evidence\.freshCampaign && campaignId !== evidence\.freshCampaign\.id/);
  assert.match(script, /DND_SMOKE_FORBIDDEN_CAMPAIGN_ID/);
  assert.match(script, /DND_SMOKE_FORBIDDEN_CAMPAIGN_CODE/);
  assert.doesNotMatch(script, /const FORBIDDEN_(?:ID|CODE)\s*=/);
});

test('disposable smoke writes only scrubbed evidence outside the repository', () => {
  assert.match(script, /pathIsInside\(REPO_ROOT, EVIDENCE_FILE\), false/);
  assert.match(script, /authorization\|cookie\|password\|secret/);
  assert.match(script, /REDACTED_JWT/);
  assert.match(script, /writeFileSync\(EVIDENCE_FILE, serialized/);
  assert.match(docs, /outside the repository/);
  assert.match(docs, /does not claim to validate distinct guest authentication/);
});
