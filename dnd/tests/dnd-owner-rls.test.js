/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 02:43:35 | maintainer@emeraldcoastsystemsgroup.com     | Pin the SEC-04 owner backfill, six-table FORCE RLS, non-recursive member ACL, exact private library, bounded join capability, manifest release, and disposable live proof.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const store = path.join(root, '..');
const migration = fs.readFileSync(path.join(root, 'migrations', '006-owner-rls.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'lib', 'dnd-campaign-service.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(store, 'marketplace.json'), 'utf8'));
const liveRunner = fs.readFileSync(path.join(store, 'scripts', 'security', 'run-live-dnd-rls-proof.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(store, '.github', 'workflows', 'security.yml'), 'utf8');
const tables = ['campaigns', 'encounters', 'characters', 'archive', 'players', 'snapshots'];

/** @description Extract one package version from its top-level YAML field. */
function manifestVersion() {
  return /^version:\s*([^\s#]+)/m.exec(manifest)?.[1];
}

test('the released package installs the idempotent SEC-04 owner migration', () => {
  assert.match(manifest, /migrations\/006-owner-rls\.sql/);
  assert.match(readme, /migrations\/006-owner-rls\.sql/);
  assert.match(readme, /RLS hardening\.\*\*~~ \*\*Shipped in v0\.19\.1/);
  assert.doesNotMatch(readme, /add\s+per-request GUC RLS policies as defense-in-depth/);
  assert.equal(manifestVersion(), '0.19.1');
  assert.equal(catalog.apps.find((app) => app.name === 'dnd').version, manifestVersion());
  assert.equal((liveRunner.match(/'006-owner-rls\.sql'/g) || []).length, 2);
  assert.match(migration, /DROP TRIGGER IF EXISTS dnd_player_membership_sync/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.dnd_sync_campaign_members/);
});

test('all six tenant tables backfill a nonempty authoritative owner and force RLS', () => {
  for (const table of tables) {
    assert.match(migration, new RegExp(`ALTER TABLE dnd_${table}\\s+ADD COLUMN IF NOT EXISTS owner_sub text`));
    assert.match(migration, new RegExp(`ALTER TABLE dnd_${table}\\s+ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`ALTER TABLE dnd_${table}\\s+FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /ALTER TABLE dnd_campaigns\s+ALTER COLUMN owner_sub SET NOT NULL/);
  assert.match(migration, /ck_dnd_players_user_sub_nonempty/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test('campaign membership is non-recursive and private characters stay exact-owner only', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS member_subs text\[\]/);
  assert.match(migration, /NEW\.user_sub := OLD\.user_sub;[\s\S]+NEW\.join_code := OLD\.join_code/);
  assert.match(migration, /NULLIF\(current_setting\('oshal\.current_sub', true\), ''\) = ANY\(member_subs\)/);
  assert.match(migration, /CREATE POLICY dnd_players_insert[\s\S]+user_sub = NULLIF\(current_setting\('oshal\.current_sub'/);
  assert.match(migration, /campaign_id IS NULL[\s\S]+owner_sub = NULLIF\(current_setting\('oshal\.current_sub'/);
  assert.match(migration, /set_config\('oshal\.dnd_membership_campaign', OLD\.campaign_id::text, true\)/);
  assert.match(migration, /campaign_id::text = NULLIF\(current_setting\('oshal\.dnd_membership_campaign', true\), ''\)/);
  assert.match(migration, /current_setting\('oshal\.is_operator', true\) = 'on'/);
  assert.doesNotMatch(migration, /FROM dnd_players p WHERE p\.campaign_id = c\.campaign_id AND p\.user_sub = NULLIF/);
});

test('join admission arms only a validated transaction-local code before protected reads', () => {
  const arm = service.indexOf("SELECT set_config('oshal.dnd_join_code', $1, true)");
  const lookup = service.indexOf('JOIN dnd_encounters e ON e.campaign_id=c.campaign_id', arm);
  assert.ok(arm >= 0 && lookup > arm);
  assert.match(service, /if \(!transactional\)[\s\S]+JOIN_TRANSACTION_REQUIRED/);
  assert.match(service, /if \(!\/\^\[A-F0-9\]\{6\}\$\/\.test\(code\)\)/);
  assert.match(migration, /join_code = NULLIF\(current_setting\('oshal\.dnd_join_code', true\), ''\)/);
  assert.doesNotMatch(service, /set_config\('oshal\.current_sub'/);
});

test('the destructive live proof is explicit, least-privilege, comprehensive, and cleaned', async () => {
  const runner = await import('../../scripts/security/run-live-dnd-rls-proof.mjs');
  assert.throws(() => runner.parseLiveDndOptions([], {}), /--confirm-live-dnd-rls-proof/);
  assert.match(liveRunner, /NOSUPERUSER[\s\S]+NOBYPASSRLS/);
  for (const identity of ['dnd-owner-a', 'dnd-owner-b', 'dnd-new-member', 'dnd-stranger', 'dnd-operator']) {
    assert.match(liveRunner, new RegExp(identity));
  }
  assert.match(liveRunner, /DROP DATABASE IF EXISTS/);
  assert.match(liveRunner, /DROP ROLE IF EXISTS/);
  assert.match(workflow, /run-live-dnd-rls-proof\.mjs[\s\S]+--confirm-live-dnd-rls-proof/);
});
