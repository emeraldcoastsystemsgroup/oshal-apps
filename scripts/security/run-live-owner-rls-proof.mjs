#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add an explicit opt-in live PostgreSQL proof for LoRA/Vids owner isolation, operator visibility, migration idempotence, and guaranteed database/role cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add a separate pre-owner legacy schema and prove the 100-only backfill, constraint replacement, FORCE RLS, isolation, and repeat-upgrade path.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Make the proof safe for required CI by documenting its ephemeral-service invocation while retaining explicit confirmation and guaranteed unique-object cleanup.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIRM_FLAG = '--confirm-live-owner-rls-proof';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultStoreRoot = resolve(scriptDir, '..', '..');

const USAGE = `Usage:
  node scripts/security/run-live-owner-rls-proof.mjs ${CONFIRM_FLAG} --container <postgres-container> [--admin-user postgres] [--admin-database postgres]
  node scripts/security/run-live-owner-rls-proof.mjs ${CONFIRM_FLAG} --database-url <postgres-admin-url> [--admin-database postgres]

Environment alternatives (the confirmation flag is still mandatory):
  OSHAL_SECURITY_POSTGRES_CONTAINER
  OSHAL_SECURITY_DATABASE_URL
  OSHAL_SECURITY_POSTGRES_USER
  OSHAL_SECURITY_POSTGRES_DATABASE

The supplied PostgreSQL principal must be able to CREATE/DROP DATABASE and CREATE/DROP ROLE.
The runner never uses the candidate role as an owner: it SET ROLEs into that NOLOGIN role for the
isolation proof, then drops both unique temporary objects in a guaranteed cleanup path. Required CI
invokes it only against its job-local ephemeral PostgreSQL service. The runner never prints the
database URL.`;

/** @description Read one required value following a CLI option. */
function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

/**
 * @description Parse the explicit live-proof invocation without consulting unrelated database
 * environment variables.
 * @param {string[]} argv - CLI arguments after the script name.
 * @param {Record<string, string | undefined>} env - Approved security-runner environment inputs.
 * @returns {object} Validated runner options or `{ help: true }`.
 */
export function parseLiveProofOptions(argv, env = process.env) {
  const environmentContainer = env.OSHAL_SECURITY_POSTGRES_CONTAINER?.trim() || '';
  const environmentDatabaseUrl = env.OSHAL_SECURITY_DATABASE_URL?.trim() || '';
  const options = {
    confirmed: false,
    container: '',
    databaseUrl: '',
    adminUser: env.OSHAL_SECURITY_POSTGRES_USER?.trim() || 'postgres',
    adminDatabase: env.OSHAL_SECURITY_POSTGRES_DATABASE?.trim() || '',
    psqlBin: 'psql',
    dockerBin: 'docker',
    storeRoot: defaultStoreRoot,
  };
  let explicitConnection = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === CONFIRM_FLAG) {
      options.confirmed = true;
      continue;
    }
    if (argument === '--container') {
      if (explicitConnection) throw new Error('Choose exactly one live PostgreSQL input: --container or --database-url');
      explicitConnection = 'container';
      options.container = optionValue(argv, index++, argument);
    } else if (argument === '--database-url') {
      if (explicitConnection) throw new Error('Choose exactly one live PostgreSQL input: --container or --database-url');
      explicitConnection = 'database-url';
      options.databaseUrl = optionValue(argv, index++, argument);
    } else if (argument === '--admin-user') options.adminUser = optionValue(argv, index++, argument);
    else if (argument === '--admin-database') options.adminDatabase = optionValue(argv, index++, argument);
    else if (argument === '--psql-bin') options.psqlBin = optionValue(argv, index++, argument);
    else if (argument === '--docker-bin') options.dockerBin = optionValue(argv, index++, argument);
    else if (argument === '--store') options.storeRoot = resolve(optionValue(argv, index++, argument));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!explicitConnection) {
    options.container = environmentContainer;
    options.databaseUrl = environmentDatabaseUrl;
  }
  if (!options.confirmed) throw new Error(`Live database mutation requires ${CONFIRM_FLAG}`);
  if (Boolean(options.container) === Boolean(options.databaseUrl)) {
    throw new Error('Choose exactly one live PostgreSQL input: --container or --database-url');
  }
  if (!options.adminUser) throw new Error('PostgreSQL admin user is empty');
  if (options.databaseUrl) {
    let parsed;
    try {
      parsed = new URL(options.databaseUrl);
    } catch {
      throw new Error('The security database URL is not a valid URL');
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('The security database URL must use postgres:// or postgresql://');
    }
    if (!options.adminDatabase) options.adminDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
  } else if (!options.adminDatabase) options.adminDatabase = 'postgres';
  return options;
}

/** @description Require an internally generated SQL identifier before interpolation. */
function assertIdentifier(value, label) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${label} is not a safe PostgreSQL identifier`);
}

/** @description Create collision-resistant, identifier-safe temporary database and role names. */
function temporaryNames() {
  const suffix = `${Date.now().toString(36)}_${process.pid.toString(36)}_${randomBytes(4).toString('hex')}`;
  return { database: `oshal_sec06_db_${suffix}`, role: `oshal_sec06_role_${suffix}` };
}

/** @description Point an approved admin URL at one database without exposing its credentials. */
function urlForDatabase(databaseUrl, database) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/** @description Run one fail-fast psql input through either a local client or a named container. */
function createSqlExecutor(options) {
  return (database, sql, label) => {
    const command = options.container ? options.dockerBin : options.psqlBin;
    const args = options.container
      ? [
          'exec', '-i', options.container,
          'psql', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet',
          '--username', options.adminUser, '--dbname', database,
        ]
      : [
          '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet',
          '--dbname', urlForDatabase(options.databaseUrl, database),
        ];
    const result = spawnSync(command, args, {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error) throw new Error(`${label} could not start ${command}: ${result.error.message}`);
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().slice(-4_000);
      throw new Error(`${label} failed with exit ${result.status}${detail ? `: ${detail}` : ''}`);
    }
  };
}

/** @description Read migration files with visible input boundaries in live psql failures. */
function readMigrationPaths(paths) {
  return paths.map((path) => `\n-- BEGIN ${path}\n${readFileSync(path, 'utf8')}\n-- END ${path}\n`).join('');
}

/** @description Load the reviewed fresh-install migrations and repeat each owner upgrade. */
function migrationSql(storeRoot) {
  const paths = [
    join(storeRoot, 'lora', 'migrations', '058-lora-studio.sql'),
    join(storeRoot, 'lora', 'migrations', '100-lora-owner-rls.sql'),
    join(storeRoot, 'lora', 'migrations', '100-lora-owner-rls.sql'),
    join(storeRoot, 'vids', 'migrations', '059-vids-platform.sql'),
    join(storeRoot, 'vids', 'migrations', '100-vids-owner-rls.sql'),
    join(storeRoot, 'vids', 'migrations', '100-vids-owner-rls.sql'),
  ];
  return readMigrationPaths(paths);
}

/** @description Load only the two owner-upgrade migrations, twice each, for a pre-owner schema. */
function legacyMigrationSql(storeRoot) {
  return readMigrationPaths([
    join(storeRoot, 'lora', 'migrations', '100-lora-owner-rls.sql'),
    join(storeRoot, 'vids', 'migrations', '100-vids-owner-rls.sql'),
    join(storeRoot, 'lora', 'migrations', '100-lora-owner-rls.sql'),
    join(storeRoot, 'vids', 'migrations', '100-vids-owner-rls.sql'),
  ]);
}

/** @description Build the minimum core table required by the migration 059 agent seed. */
function bootstrapSql() {
  return `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE agents (
  agent_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  api_provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  persona JSONB NOT NULL,
  base_capabilities TEXT[] NOT NULL,
  base_selector_descriptor TEXT NOT NULL,
  base_routing_keywords TEXT[] NOT NULL,
  metadata JSONB NOT NULL
);
`;
}

/**
 * @description Reproduce the pre-owner LoRA/Vids tables in an isolated schema. The LoRA parent has
 * the former global subject uniqueness and no owner column; Vids ownership is nullable; child rows
 * exist before any RLS policy so migration 100 must preserve and hide them correctly.
 */
function legacyFixtureSql() {
  return `
CREATE SCHEMA legacy;
CREATE TABLE legacy.oshal_lora_characters (
  id UUID PRIMARY KEY,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  trigger_word TEXT NOT NULL,
  CONSTRAINT oshal_lora_characters_subject_key UNIQUE (subject)
);
CREATE TABLE legacy.oshal_lora_models (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES legacy.oshal_lora_characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  UNIQUE (character_id, version)
);
CREATE TABLE legacy.oshal_lora_scores (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES legacy.oshal_lora_characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  overall NUMERIC(6,4),
  UNIQUE (character_id, version)
);
CREATE TABLE legacy.vids_jobs (
  job_id UUID PRIMARY KEY,
  user_sub VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  idea TEXT NOT NULL
);

INSERT INTO legacy.oshal_lora_characters (id, subject, display_name, trigger_word)
VALUES ('11000000-0000-4000-8000-000000000000', 'sec06-legacy-sentinel', 'Legacy', 'legacy');
INSERT INTO legacy.oshal_lora_models (id, character_id, version)
VALUES ('21000000-0000-4000-8000-000000000000', '11000000-0000-4000-8000-000000000000', 1);
INSERT INTO legacy.oshal_lora_scores (id, character_id, version, overall)
VALUES ('31000000-0000-4000-8000-000000000000', '11000000-0000-4000-8000-000000000000', 1, 0.5);
INSERT INTO legacy.vids_jobs (job_id, user_sub, idea)
VALUES ('41000000-0000-4000-8000-000000000000', NULL, 'legacy sentinel clip');

SET search_path = legacy, pg_catalog;
`;
}

/**
 * @description Build assertions executed entirely as the temporary non-owner role. Owner A and B
 * receive identical LoRA subjects, see only their own character/model/score/job rows, cannot update
 * the other's rows, and see both rows only after the exact operator GUC is enabled.
 */
export function ownerIsolationProofSql(role) {
  assertIdentifier(role, 'Temporary role');
  return `
GRANT USAGE ON SCHEMA public TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON
  oshal_lora_characters, oshal_lora_models, oshal_lora_scores, vids_jobs
TO ${role};

SET ROLE ${role};
SET oshal.current_sub = 'sec06-owner-a';
SET oshal.is_operator = 'off';
INSERT INTO oshal_lora_characters
  (id, subject, display_name, trigger_word, owner_sub)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'sec06-shared-subject', 'Owner A', 'sec06-a', 'sec06-owner-a');
INSERT INTO oshal_lora_models (id, character_id, version)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1);
INSERT INTO oshal_lora_scores (id, character_id, version, overall)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 0.9);
INSERT INTO vids_jobs (job_id, user_sub, idea)
VALUES ('40000000-0000-4000-8000-000000000001', 'sec06-owner-a', 'owner a clip');
RESET ROLE;

SET ROLE ${role};
SET oshal.current_sub = 'sec06-owner-b';
SET oshal.is_operator = 'off';
INSERT INTO oshal_lora_characters
  (id, subject, display_name, trigger_word, owner_sub)
VALUES
  ('10000000-0000-4000-8000-000000000002', 'sec06-shared-subject', 'Owner B', 'sec06-b', 'sec06-owner-b');
INSERT INTO oshal_lora_models (id, character_id, version)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1);
INSERT INTO oshal_lora_scores (id, character_id, version, overall)
VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 0.8);
INSERT INTO vids_jobs (job_id, user_sub, idea)
VALUES ('40000000-0000-4000-8000-000000000002', 'sec06-owner-b', 'owner b clip');
RESET ROLE;

SET ROLE ${role};
SET oshal.current_sub = 'sec06-owner-a';
SET oshal.is_operator = 'off';
DO $owner_a$
DECLARE affected INTEGER;
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters WHERE subject = 'sec06-shared-subject') <> 1 THEN
    RAISE EXCEPTION 'owner A character isolation failed';
  END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 1 THEN RAISE EXCEPTION 'owner A model isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 1 THEN RAISE EXCEPTION 'owner A score isolation failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 1 THEN RAISE EXCEPTION 'owner A vids isolation failed'; END IF;
  UPDATE oshal_lora_characters SET display_name = 'forbidden-a' WHERE id = '10000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner A changed owner B character'; END IF;
  UPDATE oshal_lora_models SET status = 'failed' WHERE id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner A changed owner B model'; END IF;
  UPDATE oshal_lora_scores SET overall = 0 WHERE id = '30000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner A changed owner B score'; END IF;
  UPDATE vids_jobs SET status = 'failed' WHERE job_id = '40000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner A changed owner B vids job'; END IF;
END
$owner_a$;
RESET ROLE;

SET ROLE ${role};
SET oshal.current_sub = 'sec06-owner-b';
SET oshal.is_operator = 'off';
DO $owner_b$
DECLARE affected INTEGER;
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters WHERE subject = 'sec06-shared-subject') <> 1 THEN
    RAISE EXCEPTION 'owner B character isolation failed';
  END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 1 THEN RAISE EXCEPTION 'owner B model isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 1 THEN RAISE EXCEPTION 'owner B score isolation failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 1 THEN RAISE EXCEPTION 'owner B vids isolation failed'; END IF;
  UPDATE oshal_lora_characters SET display_name = 'forbidden-b' WHERE id = '10000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner B changed owner A character'; END IF;
  UPDATE oshal_lora_models SET status = 'failed' WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner B changed owner A model'; END IF;
  UPDATE oshal_lora_scores SET overall = 0 WHERE id = '30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner B changed owner A score'; END IF;
  UPDATE vids_jobs SET status = 'failed' WHERE job_id = '40000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'owner B changed owner A vids job'; END IF;
END
$owner_b$;
RESET ROLE;

SET ROLE ${role};
SET oshal.current_sub = 'sec06-operator';
SET oshal.is_operator = 'on';
DO $operator$
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters WHERE subject = 'sec06-shared-subject') <> 2 THEN
    RAISE EXCEPTION 'operator character visibility failed';
  END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 2 THEN RAISE EXCEPTION 'operator model visibility failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 2 THEN RAISE EXCEPTION 'operator score visibility failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 2 THEN RAISE EXCEPTION 'operator vids visibility failed'; END IF;
END
$operator$;
RESET ROLE;
`;
}

/**
 * @description Prove the real pre-owner upgrade path after only the two migration-100 files ran.
 * The legacy sentinels must be backfilled and retained, ownership columns become NOT NULL, the old
 * global subject constraint is replaced, FORCE RLS protects parents/children/jobs, and operator
 * mode is the only non-owner view of the retained sentinels.
 */
export function legacyOwnerUpgradeProofSql(role) {
  assertIdentifier(role, 'Temporary role');
  return `
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-admin';
SET oshal.is_operator = 'on';
DO $legacy_upgrade_shape$
BEGIN
  IF (SELECT owner_sub FROM oshal_lora_characters WHERE id = '11000000-0000-4000-8000-000000000000')
      IS DISTINCT FROM 'system:legacy:lora' THEN
    RAISE EXCEPTION 'legacy LoRA owner backfill failed';
  END IF;
  IF (SELECT user_sub FROM vids_jobs WHERE job_id = '41000000-0000-4000-8000-000000000000')
      IS DISTINCT FROM 'system:legacy:vids' THEN
    RAISE EXCEPTION 'legacy Vids owner backfill failed';
  END IF;
  IF NOT COALESCE((SELECT attnotnull FROM pg_attribute
                    WHERE attrelid = 'legacy.oshal_lora_characters'::regclass AND attname = 'owner_sub'), false) THEN
    RAISE EXCEPTION 'legacy LoRA owner_sub is nullable';
  END IF;
  IF NOT COALESCE((SELECT attnotnull FROM pg_attribute
                    WHERE attrelid = 'legacy.vids_jobs'::regclass AND attname = 'user_sub'), false) THEN
    RAISE EXCEPTION 'legacy Vids user_sub is nullable';
  END IF;
  IF to_regclass('legacy.oshal_lora_characters_subject_key') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy global subject uniqueness survived migration 100';
  END IF;
  IF to_regclass('legacy.idx_lora_characters_owner_subject') IS NULL THEN
    RAISE EXCEPTION 'owner-scoped subject uniqueness is missing';
  END IF;
  IF NOT COALESCE((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
                    WHERE oid = 'legacy.oshal_lora_characters'::regclass), false) THEN
    RAISE EXCEPTION 'legacy character FORCE RLS is missing';
  END IF;
  IF NOT COALESCE((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
                    WHERE oid = 'legacy.oshal_lora_models'::regclass), false) THEN
    RAISE EXCEPTION 'legacy model FORCE RLS is missing';
  END IF;
  IF NOT COALESCE((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
                    WHERE oid = 'legacy.oshal_lora_scores'::regclass), false) THEN
    RAISE EXCEPTION 'legacy score FORCE RLS is missing';
  END IF;
  IF NOT COALESCE((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
                    WHERE oid = 'legacy.vids_jobs'::regclass), false) THEN
    RAISE EXCEPTION 'legacy Vids FORCE RLS is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'legacy'
                  AND tablename = 'oshal_lora_characters' AND policyname = 'oshal_lora_characters_owner_policy') THEN
    RAISE EXCEPTION 'legacy character policy is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'legacy'
                  AND tablename = 'oshal_lora_models' AND policyname = 'oshal_lora_models_owner_policy') THEN
    RAISE EXCEPTION 'legacy model policy is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'legacy'
                  AND tablename = 'oshal_lora_scores' AND policyname = 'oshal_lora_scores_owner_policy') THEN
    RAISE EXCEPTION 'legacy score policy is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'legacy'
                  AND tablename = 'vids_jobs' AND policyname = 'vids_jobs_owner_policy') THEN
    RAISE EXCEPTION 'legacy Vids policy is missing';
  END IF;
  BEGIN
    INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub)
    VALUES ('11000000-0000-4000-8000-000000000099', 'null-owner-must-fail', 'Null', 'null', NULL);
    RAISE EXCEPTION 'legacy LoRA accepted a null owner';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vids_jobs (job_id, user_sub, idea)
    VALUES ('41000000-0000-4000-8000-000000000099', NULL, 'null owner must fail');
    RAISE EXCEPTION 'legacy Vids accepted a null owner';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END
$legacy_upgrade_shape$;

GRANT USAGE ON SCHEMA legacy TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON
  legacy.oshal_lora_characters, legacy.oshal_lora_models,
  legacy.oshal_lora_scores, legacy.vids_jobs
TO ${role};

SET ROLE ${role};
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-legacy-owner-a';
SET oshal.is_operator = 'off';
INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub)
VALUES ('11000000-0000-4000-8000-000000000001', 'sec06-legacy-shared', 'Legacy A', 'legacy-a', 'sec06-legacy-owner-a');
INSERT INTO oshal_lora_models (id, character_id, version)
VALUES ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 1);
INSERT INTO oshal_lora_scores (id, character_id, version, overall)
VALUES ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 1, 0.9);
INSERT INTO vids_jobs (job_id, user_sub, idea)
VALUES ('41000000-0000-4000-8000-000000000001', 'sec06-legacy-owner-a', 'legacy owner a clip');
RESET ROLE;

SET ROLE ${role};
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-legacy-owner-b';
SET oshal.is_operator = 'off';
INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub)
VALUES ('11000000-0000-4000-8000-000000000002', 'sec06-legacy-shared', 'Legacy B', 'legacy-b', 'sec06-legacy-owner-b');
INSERT INTO oshal_lora_models (id, character_id, version)
VALUES ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 1);
INSERT INTO oshal_lora_scores (id, character_id, version, overall)
VALUES ('31000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 1, 0.8);
INSERT INTO vids_jobs (job_id, user_sub, idea)
VALUES ('41000000-0000-4000-8000-000000000002', 'sec06-legacy-owner-b', 'legacy owner b clip');
RESET ROLE;

SET ROLE ${role};
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-legacy-owner-a';
SET oshal.is_operator = 'off';
DO $legacy_owner_a$
DECLARE affected INTEGER;
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters) <> 1 THEN RAISE EXCEPTION 'legacy owner A character isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 1 THEN RAISE EXCEPTION 'legacy owner A model isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 1 THEN RAISE EXCEPTION 'legacy owner A score isolation failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 1 THEN RAISE EXCEPTION 'legacy owner A Vids isolation failed'; END IF;
  UPDATE oshal_lora_characters SET display_name = 'forbidden-a' WHERE id = '11000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner A changed owner B character'; END IF;
  UPDATE oshal_lora_models SET status = 'failed' WHERE id = '21000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner A changed owner B model'; END IF;
  UPDATE oshal_lora_scores SET overall = 0 WHERE id = '31000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner A changed owner B score'; END IF;
  UPDATE vids_jobs SET status = 'failed' WHERE job_id = '41000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner A changed owner B Vids job'; END IF;
END
$legacy_owner_a$;
RESET ROLE;

SET ROLE ${role};
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-legacy-owner-b';
SET oshal.is_operator = 'off';
DO $legacy_owner_b$
DECLARE affected INTEGER;
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters) <> 1 THEN RAISE EXCEPTION 'legacy owner B character isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 1 THEN RAISE EXCEPTION 'legacy owner B model isolation failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 1 THEN RAISE EXCEPTION 'legacy owner B score isolation failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 1 THEN RAISE EXCEPTION 'legacy owner B Vids isolation failed'; END IF;
  UPDATE oshal_lora_characters SET display_name = 'forbidden-b' WHERE id = '11000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner B changed owner A character'; END IF;
  UPDATE oshal_lora_models SET status = 'failed' WHERE id = '21000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner B changed owner A model'; END IF;
  UPDATE oshal_lora_scores SET overall = 0 WHERE id = '31000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner B changed owner A score'; END IF;
  UPDATE vids_jobs SET status = 'failed' WHERE job_id = '41000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'legacy owner B changed owner A Vids job'; END IF;
END
$legacy_owner_b$;
RESET ROLE;

SET ROLE ${role};
SET search_path = legacy, pg_catalog;
SET oshal.current_sub = 'sec06-legacy-operator';
SET oshal.is_operator = 'on';
DO $legacy_operator$
BEGIN
  IF (SELECT count(*) FROM oshal_lora_characters) <> 3 THEN RAISE EXCEPTION 'legacy operator character visibility failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_models) <> 3 THEN RAISE EXCEPTION 'legacy operator model visibility failed'; END IF;
  IF (SELECT count(*) FROM oshal_lora_scores) <> 3 THEN RAISE EXCEPTION 'legacy operator score visibility failed'; END IF;
  IF (SELECT count(*) FROM vids_jobs) <> 3 THEN RAISE EXCEPTION 'legacy operator Vids visibility failed'; END IF;
  IF (SELECT owner_sub FROM oshal_lora_characters WHERE id = '11000000-0000-4000-8000-000000000000')
      IS DISTINCT FROM 'system:legacy:lora' THEN RAISE EXCEPTION 'legacy LoRA sentinel is not operator-visible'; END IF;
  IF (SELECT user_sub FROM vids_jobs WHERE job_id = '41000000-0000-4000-8000-000000000000')
      IS DISTINCT FROM 'system:legacy:vids' THEN RAISE EXCEPTION 'legacy Vids sentinel is not operator-visible'; END IF;
END
$legacy_operator$;
RESET ROLE;
`;
}

/** @description Build the post-cleanup assertion that neither unique object survived. */
function cleanupVerificationSql(database, role) {
  return `
DO $cleanup_verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = '${database}') THEN
    RAISE EXCEPTION 'temporary database survived cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    RAISE EXCEPTION 'temporary role survived cleanup';
  END IF;
END
$cleanup_verify$;
`;
}

/**
 * @description Execute the live proof and always attempt database/role deletion plus independent
 * absence verification, including when migration or assertion SQL fails.
 * @param {object} options - Validated live-proof options.
 * @param {object} dependencies - Optional deterministic executor/names for plain-node contracts.
 * @returns {{database: string, role: string}} Names proven absent when the function returns.
 */
export function runLiveOwnerRlsProof(options, dependencies = {}) {
  if (!options?.confirmed) throw new Error(`Live database mutation requires ${CONFIRM_FLAG}`);
  const names = dependencies.names ?? temporaryNames();
  assertIdentifier(names.database, 'Temporary database');
  assertIdentifier(names.role, 'Temporary role');
  const executeSql = dependencies.executeSql ?? createSqlExecutor(options);
  const readMigrations = dependencies.migrationSql ?? (() => migrationSql(options.storeRoot ?? defaultStoreRoot));
  const readLegacyMigrations = dependencies.legacyMigrationSql
    ?? (() => legacyMigrationSql(options.storeRoot ?? defaultStoreRoot));
  let primaryFailure = null;
  const cleanupFailures = [];
  try {
    executeSql(options.adminDatabase, `CREATE ROLE ${names.role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`, 'create temporary role');
    executeSql(options.adminDatabase, `CREATE DATABASE ${names.database};`, 'create temporary database');
    executeSql(names.database, `${bootstrapSql()}\n${readMigrations()}`, 'apply base and idempotent owner migrations');
    executeSql(names.database, ownerIsolationProofSql(names.role), 'run owner isolation proof');
    executeSql(
      names.database,
      `${legacyFixtureSql()}\n${readLegacyMigrations()}`,
      'apply legacy fixture and repeated owner upgrades',
    );
    executeSql(names.database, legacyOwnerUpgradeProofSql(names.role), 'run legacy owner upgrade proof');
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupSteps = [
      [
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${names.database}' AND pid <> pg_backend_pid();`,
        'terminate temporary database sessions',
      ],
      [`DROP DATABASE IF EXISTS ${names.database};`, 'drop temporary database'],
      [`DROP ROLE IF EXISTS ${names.role};`, 'drop temporary role'],
      [cleanupVerificationSql(names.database, names.role), 'verify temporary object cleanup'],
    ];
    for (const [sql, label] of cleanupSteps) {
      try {
        executeSql(options.adminDatabase, sql, label);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }

  if (primaryFailure && cleanupFailures.length) {
    throw new AggregateError([primaryFailure, ...cleanupFailures], 'Owner/RLS proof failed and cleanup was incomplete');
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Owner/RLS proof cleanup was incomplete');
  return names;
}

/** @description CLI entry point with concise, credential-free output. */
export function main(argv = process.argv.slice(2)) {
  const options = parseLiveProofOptions(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  runLiveOwnerRlsProof(options);
  console.log('Live LoRA/Vids owner-RLS proof passed; temporary database and role were removed');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof AggregateError) {
      console.error(error.message);
      for (const cause of error.errors) console.error(`- ${cause instanceof Error ? cause.message : String(cause)}`);
    } else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
