#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add an explicit disposable-PostgreSQL proof for D&D owner backfill, forced RLS, shared-member access, private-character isolation, bounded join-code admission, operator visibility, and cleanup.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIRM_FLAG = '--confirm-live-dnd-rls-proof';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultStoreRoot = resolve(scriptDir, '..', '..');

const USAGE = `Usage:
  node scripts/security/run-live-dnd-rls-proof.mjs ${CONFIRM_FLAG} --container <postgres-container> [--admin-user postgres] [--admin-database postgres]
  node scripts/security/run-live-dnd-rls-proof.mjs ${CONFIRM_FLAG} --database-url <postgres-admin-url> [--admin-database postgres]

Environment alternatives (the confirmation flag is still mandatory):
  OSHAL_SECURITY_POSTGRES_CONTAINER
  OSHAL_SECURITY_DATABASE_URL
  OSHAL_SECURITY_POSTGRES_USER
  OSHAL_SECURITY_POSTGRES_DATABASE

The supplied principal must be able to CREATE/DROP DATABASE and CREATE/DROP ROLE. The runner
creates collision-resistant disposable objects, never prints a database URL, and removes both
objects in a guaranteed cleanup path.`;

/** @description Read one required CLI value without accepting another option as data. */
function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

/** @description Parse an explicit live-proof target without borrowing an application DSN. */
export function parseLiveDndOptions(argv, env = process.env) {
  const options = {
    confirmed: false,
    container: '',
    databaseUrl: '',
    adminUser: env.OSHAL_SECURITY_POSTGRES_USER?.trim() || 'postgres',
    adminDatabase: env.OSHAL_SECURITY_POSTGRES_DATABASE?.trim() || '',
    psqlBin: 'psql', dockerBin: 'docker', storeRoot: defaultStoreRoot,
  };
  let explicit = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === CONFIRM_FLAG) options.confirmed = true;
    else if (argument === '--container' || argument === '--database-url') {
      if (explicit) throw new Error('Choose exactly one live PostgreSQL input');
      explicit = argument;
      options[argument === '--container' ? 'container' : 'databaseUrl'] = optionValue(argv, index++, argument);
    } else if (argument === '--admin-user') options.adminUser = optionValue(argv, index++, argument);
    else if (argument === '--admin-database') options.adminDatabase = optionValue(argv, index++, argument);
    else if (argument === '--psql-bin') options.psqlBin = optionValue(argv, index++, argument);
    else if (argument === '--docker-bin') options.dockerBin = optionValue(argv, index++, argument);
    else if (argument === '--store') options.storeRoot = resolve(optionValue(argv, index++, argument));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!explicit) {
    options.container = env.OSHAL_SECURITY_POSTGRES_CONTAINER?.trim() || '';
    options.databaseUrl = env.OSHAL_SECURITY_DATABASE_URL?.trim() || '';
  }
  if (!options.confirmed) throw new Error(`Live database mutation requires ${CONFIRM_FLAG}`);
  if (Boolean(options.container) === Boolean(options.databaseUrl)) throw new Error('Choose exactly one live PostgreSQL input');
  if (!options.adminUser) throw new Error('PostgreSQL admin user is empty');
  if (options.databaseUrl) validateDatabaseUrl(options);
  else if (!options.adminDatabase) options.adminDatabase = 'postgres';
  return options;
}

/** @description Validate an admin URL and derive its database without exposing credentials. */
function validateDatabaseUrl(options) {
  let parsed;
  try { parsed = new URL(options.databaseUrl); } catch { throw new Error('The security database URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('The security database URL must use postgres:// or postgresql://');
  if (!options.adminDatabase) options.adminDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
}

/** @description Produce safe unique names for disposable proof objects. */
function temporaryNames() {
  const suffix = `${Date.now().toString(36)}_${process.pid.toString(36)}_${randomBytes(4).toString('hex')}`;
  return { database: `oshal_dnd_rls_db_${suffix}`, role: `oshal_dnd_rls_role_${suffix}` };
}

/** @description Require generated identifiers before interpolating them into administrative SQL. */
function assertIdentifier(value, label) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${label} is not a safe PostgreSQL identifier`);
}

/** @description Retarget an approved PostgreSQL URL to one disposable database. */
function urlForDatabase(databaseUrl, database) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/** @description Build one fail-fast SQL executor over psql or a named container. */
function createSqlExecutor(options) {
  return (database, sql, label) => {
    const command = options.container ? options.dockerBin : options.psqlBin;
    const args = options.container
      ? ['exec', '-i', options.container, 'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--username', options.adminUser, '--dbname', database]
      : ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', urlForDatabase(options.databaseUrl, database)];
    const result = spawnSync(command, args, { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (result.error) throw new Error(`${label} could not start ${command}: ${result.error.message}`);
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().slice(-4_000);
      throw new Error(`${label} failed with exit ${result.status}${detail ? `: ${detail}` : ''}`);
    }
  };
}

/** @description Read reviewed migration files with visible psql error boundaries. */
function readMigrations(storeRoot, paths) {
  return paths.map((path) => {
    const full = join(storeRoot, 'dnd', 'migrations', path);
    return `\n-- BEGIN dnd/migrations/${path}\n${readFileSync(full, 'utf8')}\n-- END dnd/migrations/${path}\n`;
  }).join('');
}

/** @description Load the legacy schema before the SEC-04 ownership upgrade. */
function baseMigrationSql(storeRoot) {
  return readMigrations(storeRoot, [
    '001-dnd.sql', '002-multiplayer.sql', '003-snapshots.sql',
    '004-character-library.sql', '005-roll-events.sql',
  ]);
}

/** @description Repeat the owner migration so non-idempotent DDL fails the proof. */
function ownerMigrationSql(storeRoot) {
  return readMigrations(storeRoot, ['006-owner-rls.sql', '006-owner-rls.sql']);
}

/** @description Seed both owners and all six tables before owner_sub exists. */
function legacyFixtureSql() {
  return `
INSERT INTO dnd_campaigns (campaign_id, user_sub, name, adventure_id, status, join_code) VALUES
  ('10000000-0000-4000-8000-000000000001', 'dnd-owner-a', 'Owner A', 'proof', 'active', 'AAA111'),
  ('20000000-0000-4000-8000-000000000002', 'dnd-owner-b', 'Owner B', 'proof', 'active', 'BBB222');
INSERT INTO dnd_encounters (encounter_id, campaign_id, user_sub, adventure_id, state, rev) VALUES
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'dnd-owner-a', 'proof', '{"mode":"setup","tokens":[{"id":"a","kind":"pc"}]}', 1),
  ('22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'dnd-owner-b', 'proof', '{"mode":"setup","tokens":[{"id":"b","kind":"pc"}]}', 1);
INSERT INTO dnd_characters (character_id, user_sub, campaign_id, slug, name, sheet) VALUES
  ('13000000-0000-4000-8000-000000000001', 'dnd-owner-a', '10000000-0000-4000-8000-000000000001', 'a', 'A', '{}'),
  ('23000000-0000-4000-8000-000000000002', 'dnd-owner-b', '20000000-0000-4000-8000-000000000002', 'b', 'B', '{}'),
  ('14000000-0000-4000-8000-000000000001', 'dnd-owner-a', NULL, 'private-a', 'Private A', '{}'),
  ('24000000-0000-4000-8000-000000000002', 'dnd-owner-b', NULL, 'private-b', 'Private B', '{}');
INSERT INTO dnd_archive (entry_id, user_sub, campaign_id, seq, kind, content) VALUES
  ('15000000-0000-4000-8000-000000000001', 'dnd-legacy-member-a', '10000000-0000-4000-8000-000000000001', 1, 'milestone', 'A'),
  ('25000000-0000-4000-8000-000000000002', 'dnd-owner-b', '20000000-0000-4000-8000-000000000002', 1, 'milestone', 'B');
INSERT INTO dnd_players (player_id, campaign_id, user_sub, display_name) VALUES
  ('16000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'dnd-legacy-member-a', 'Legacy A'),
  ('26000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'dnd-legacy-member-b', 'Legacy B');
INSERT INTO dnd_snapshots (snapshot_id, campaign_id, user_sub, label, state, sheets) VALUES
  ('17000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'dnd-owner-a', 'A save', '{}', '{}'),
  ('27000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'dnd-owner-b', 'B save', '{}', '{}');
`;
}

/** @description Transfer table ownership to the exact non-bypass runtime role. */
function runtimeOwnershipSql(role) {
  return `
ALTER TABLE dnd_campaigns OWNER TO ${role};
ALTER TABLE dnd_encounters OWNER TO ${role};
ALTER TABLE dnd_characters OWNER TO ${role};
ALTER TABLE dnd_archive OWNER TO ${role};
ALTER TABLE dnd_players OWNER TO ${role};
ALTER TABLE dnd_snapshots OWNER TO ${role};
GRANT USAGE ON SCHEMA public TO ${role};
`;
}

/** @description Assert backfill, two-owner isolation, member sharing, join, and operator access. */
function proofSql(role) {
  return `
CREATE OR REPLACE FUNCTION public.dnd_proof_assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN IF NOT ok THEN RAISE EXCEPTION 'D&D RLS proof failed: %', message; END IF; END
$assert$;

SELECT public.dnd_proof_assert((
  SELECT count(*) = 6 FROM pg_class
   WHERE oid IN ('dnd_campaigns'::regclass, 'dnd_encounters'::regclass, 'dnd_characters'::regclass,
                 'dnd_archive'::regclass, 'dnd_players'::regclass, 'dnd_snapshots'::regclass)
     AND relrowsecurity AND relforcerowsecurity
), 'all six tenant tables must enable and force RLS');
SELECT public.dnd_proof_assert((
  SELECT count(*) = 6 FROM pg_class
   WHERE oid IN ('dnd_campaigns'::regclass, 'dnd_encounters'::regclass, 'dnd_characters'::regclass,
                 'dnd_archive'::regclass, 'dnd_players'::regclass, 'dnd_snapshots'::regclass)
     AND relowner = '${role}'::regrole
), 'proof role must own every forced table');
SELECT public.dnd_proof_assert((SELECT count(*) = 6 FROM information_schema.columns
  WHERE table_schema='public' AND column_name='owner_sub' AND table_name LIKE 'dnd_%'), 'owner_sub backfill columns');
SELECT public.dnd_proof_assert((SELECT count(*) = 2 FROM dnd_campaigns WHERE owner_sub = user_sub), 'campaign owner backfill');
SELECT public.dnd_proof_assert((SELECT count(*) = 2 FROM dnd_players WHERE owner_sub IN ('dnd-owner-a','dnd-owner-b')), 'member owner backfill');
SELECT public.dnd_proof_assert((SELECT 'dnd-legacy-member-a' = ANY(member_subs) FROM dnd_campaigns
  WHERE campaign_id='10000000-0000-4000-8000-000000000001'), 'member ACL backfill');

SET ROLE ${role};

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-owner-a';
SET LOCAL oshal.is_operator = 'off';
INSERT INTO dnd_campaigns (campaign_id,user_sub,name,adventure_id,status,join_code)
VALUES ('30000000-0000-4000-8000-000000000003','dnd-owner-a','Fresh owner write','proof','active','CCC333');
INSERT INTO dnd_encounters (encounter_id,campaign_id,user_sub,adventure_id,state)
VALUES ('31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','dnd-owner-a','proof','{}');
INSERT INTO dnd_characters (character_id,user_sub,campaign_id,slug,name,sheet)
VALUES ('33000000-0000-4000-8000-000000000003','dnd-owner-a','30000000-0000-4000-8000-000000000003','fresh','Fresh','{}');
INSERT INTO dnd_archive (entry_id,user_sub,campaign_id,seq,kind,content)
VALUES ('35000000-0000-4000-8000-000000000003','dnd-owner-a','30000000-0000-4000-8000-000000000003',1,'milestone','fresh');
INSERT INTO dnd_players (player_id,campaign_id,user_sub,display_name)
VALUES ('36000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','dnd-owner-a','Owner A');
INSERT INTO dnd_snapshots (snapshot_id,campaign_id,user_sub,label,state,sheets)
VALUES ('37000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','dnd-owner-a','Fresh save','{}','{}');
SELECT public.dnd_proof_assert((SELECT count(*)=6 FROM (
  SELECT owner_sub FROM dnd_campaigns WHERE campaign_id='30000000-0000-4000-8000-000000000003'
  UNION ALL SELECT owner_sub FROM dnd_encounters WHERE campaign_id='30000000-0000-4000-8000-000000000003'
  UNION ALL SELECT owner_sub FROM dnd_characters WHERE campaign_id='30000000-0000-4000-8000-000000000003'
  UNION ALL SELECT owner_sub FROM dnd_archive WHERE campaign_id='30000000-0000-4000-8000-000000000003'
  UNION ALL SELECT owner_sub FROM dnd_players WHERE campaign_id='30000000-0000-4000-8000-000000000003'
  UNION ALL SELECT owner_sub FROM dnd_snapshots WHERE campaign_id='30000000-0000-4000-8000-000000000003'
) owned WHERE owner_sub='dnd-owner-a'), 'fresh owner writes derive all six owner columns');
ROLLBACK;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-owner-a';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'owner A campaign visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_encounters), 'owner A encounter visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_characters), 'owner A campaign plus private character visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_archive), 'owner A archive visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_players), 'owner A player visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_snapshots), 'owner A snapshot visibility');
DO $owner_a_block$
DECLARE affected integer;
BEGIN
  UPDATE dnd_campaigns SET name='blocked' WHERE campaign_id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner A cannot mutate owner B');
END
$owner_a_block$;
DO $owner_a_children$
DECLARE affected integer;
BEGIN
  UPDATE dnd_characters SET name=name WHERE campaign_id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner A cannot mutate owner B characters');
  UPDATE dnd_players SET display_name=display_name WHERE campaign_id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner A cannot mutate owner B players');
  DELETE FROM dnd_archive WHERE campaign_id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner A cannot delete owner B archive');
  DELETE FROM dnd_snapshots WHERE campaign_id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner A cannot delete owner B snapshots');
END
$owner_a_children$;
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-owner-b';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'owner B campaign visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_characters), 'owner B private isolation');
DO $owner_b_block$
DECLARE affected integer;
BEGIN
  UPDATE dnd_encounters SET rev=rev+1 WHERE campaign_id='10000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'owner B cannot mutate owner A board');
END
$owner_b_block$;
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-legacy-member-a';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'backfilled member campaign visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_characters), 'member sees campaign but no private characters');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_characters WHERE campaign_id IS NULL), 'private library exact owner');
UPDATE dnd_campaigns SET user_sub='dnd-legacy-member-a', join_code='BAD999'
 WHERE campaign_id='10000000-0000-4000-8000-000000000001';
SELECT public.dnd_proof_assert((SELECT owner_sub='dnd-owner-a' AND user_sub='dnd-owner-a' AND join_code='AAA111'
  FROM dnd_campaigns WHERE campaign_id='10000000-0000-4000-8000-000000000001'), 'member cannot seize ownership or rotate join code');
UPDATE dnd_encounters SET rev=rev+1 WHERE campaign_id='10000000-0000-4000-8000-000000000001';
UPDATE dnd_campaigns SET updated_at=now() WHERE campaign_id='10000000-0000-4000-8000-000000000001';
UPDATE dnd_characters SET updated_at=now() WHERE campaign_id='10000000-0000-4000-8000-000000000001';
INSERT INTO dnd_archive (user_sub, campaign_id, seq, kind, content)
VALUES ('dnd-legacy-member-a','10000000-0000-4000-8000-000000000001',2,'table-talk','member write');
INSERT INTO dnd_snapshots (snapshot_id,campaign_id,user_sub,label,state,sheets)
VALUES ('18000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','dnd-owner-a','Member save','{}','{}');
DO $member_delete_block$
DECLARE affected integer;
BEGIN
  DELETE FROM dnd_campaigns WHERE campaign_id='10000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM public.dnd_proof_assert(affected=0, 'member cannot delete host campaign');
END
$member_delete_block$;
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-new-member';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_campaigns), 'unarmed joiner sees no campaign');
SELECT set_config('oshal.dnd_join_code','BBB222',true);
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'wrong campaign code exposes only its exact campaign');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_campaigns
  WHERE campaign_id='10000000-0000-4000-8000-000000000001'), 'wrong code cannot see target campaign');
SELECT set_config('oshal.dnd_join_code','AAA111',true);
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'exact join capability is bounded to one campaign');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_encounters), 'joiner may inspect exact setup board');
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_players), 'joiner may count exact campaign seats');
INSERT INTO dnd_players (campaign_id,user_sub,display_name)
VALUES ('10000000-0000-4000-8000-000000000001','dnd-new-member','New Member');
SELECT set_config('oshal.dnd_join_code','',true);
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'membership survives capability reset');
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_players), 'members share the complete seat list');
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-new-member';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=1 FROM dnd_campaigns), 'committed member needs no join code');
DO $forgery$
BEGIN
  BEGIN
    INSERT INTO dnd_players (campaign_id,user_sub,display_name)
    VALUES ('10000000-0000-4000-8000-000000000001','dnd-forged-member','Forged');
    RAISE EXCEPTION 'forged member insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$forgery$;
DELETE FROM dnd_players
 WHERE campaign_id='10000000-0000-4000-8000-000000000001'
   AND user_sub='dnd-new-member';
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_campaigns), 'leaving member loses campaign access immediately');
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-stranger';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_campaigns), 'stranger campaign isolation');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_encounters), 'stranger encounter isolation');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_characters), 'stranger character isolation');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_archive), 'stranger archive isolation');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_players), 'stranger player isolation');
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_snapshots), 'stranger snapshot isolation');
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = 'dnd-operator';
SET LOCAL oshal.is_operator = 'on';
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_campaigns), 'operator campaign visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_encounters), 'operator encounter visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=4 FROM dnd_characters), 'operator character visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=3 FROM dnd_archive), 'operator archive visibility');
SELECT public.dnd_proof_assert((SELECT count(*)=2 FROM dnd_players), 'operator player visibility after leave');
SELECT public.dnd_proof_assert((SELECT count(*)=3 FROM dnd_snapshots), 'operator snapshot visibility');
COMMIT;

BEGIN;
SET LOCAL oshal.current_sub = '';
SET LOCAL oshal.is_operator = 'off';
SELECT public.dnd_proof_assert((SELECT count(*)=0 FROM dnd_campaigns), 'anonymous identity fails closed');
COMMIT;
RESET ROLE;
`;
}

/** @description Run cleanup without hiding the original proof failure. */
function cleanup(executeSql, options, names) {
  const failures = [];
  try {
    executeSql(options.adminDatabase, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${names.database}' AND pid<>pg_backend_pid(); DROP DATABASE IF EXISTS ${names.database};`, 'drop temporary database');
  } catch (error) { failures.push(error); }
  try { executeSql(options.adminDatabase, `DROP ROLE IF EXISTS ${names.role};`, 'drop temporary role'); }
  catch (error) { failures.push(error); }
  return failures;
}

/** @description Execute the disposable D&D RLS proof and guarantee cleanup. */
export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseLiveDndOptions(argv, env);
  if (options.help) { console.log(USAGE); return; }
  const names = temporaryNames();
  assertIdentifier(names.database, 'database');
  assertIdentifier(names.role, 'role');
  const executeSql = createSqlExecutor(options);
  let failure;
  try {
    executeSql(options.adminDatabase, `CREATE ROLE ${names.role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;`, 'create temporary role');
    executeSql(options.adminDatabase, `CREATE DATABASE ${names.database};`, 'create temporary database');
    executeSql(names.database, baseMigrationSql(options.storeRoot), 'apply D&D base migrations');
    executeSql(names.database, legacyFixtureSql(), 'seed pre-owner D&D fixture');
    executeSql(names.database, ownerMigrationSql(options.storeRoot), 'apply idempotent D&D owner migration');
    executeSql(names.database, runtimeOwnershipSql(names.role), 'transfer tables to candidate role');
    executeSql(names.database, proofSql(names.role), 'prove D&D multi-identity RLS');
    console.log('D&D live owner/RLS proof passed: six forced tables, fresh/backfilled owners, two owners, shared-member join/leave, private library, stranger denial, and operator access.');
  } catch (error) { failure = error; }
  const cleanupFailures = cleanup(executeSql, options, names);
  if (failure) throw failure;
  if (cleanupFailures.length) throw cleanupFailures[0];
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
  }
}
