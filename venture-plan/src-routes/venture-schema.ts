/**
 * Venture Plan — the owner-scoped Postgres schema.
 *
 * ELEVEN TABLES, ONE FROZEN LIST. `VENTURE_TABLES` is the single source of truth
 * for what this package owns: the RLS bootstrap iterates it, the schema-readiness
 * requirement list is derived from it, and a guard asserts every `CREATE TABLE` in
 * `SCHEMA_SQL` appears in it. Adding a table without adding RLS is therefore a red
 * test rather than an unprotected table nobody notices for a year.
 *
 * WHY APPEND-ONLY ASSUMPTIONS. This app's entire product is knowing which numbers
 * are guesses. If a vendor quote UPDATEd the estimate it replaces, the evidence
 * that yesterday's plan rested on a guess would be destroyed by the very act of
 * improving it. So `venture_assumptions` never updates a value: a replacement is a
 * new row, and the prior row's `superseded_by` is stamped with the new row's id.
 * The partial unique index `WHERE superseded_by IS NULL` is what makes "the live
 * value for this key" a database-level guarantee rather than a convention.
 *
 * WHY MODELS AND DOCUMENTS ARE IMMUTABLE. A computed model carries `inputs_hash`
 * and `engine_version`; a document carries the `model_id` it was rendered from and
 * a monotonically increasing `version`. That is what lets the surface say "this
 * funding memo was rendered from a model whose inputs have since changed" instead
 * of quietly serving a stale number under a fresh timestamp.
 *
 * MONEY UNITS. BOM lines and quotes are `BIGINT` micro-dollars (1e-6 USD) because a
 * $0.0034 fastener at qty 20 rounds to $0.00 in cents and the roll-up is silently
 * understated. Everything downstream of the roll-up is integer cents. The engine
 * owns that arithmetic; this module only has to store it without losing precision.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the eleven owner-scoped tables, the append-only assumption ledger with its live-row partial unique index, immutable model snapshots and versioned documents, and the frozen VENTURE_TABLES list the RLS bootstrap and the schema guard both read.
 *
 * @module venture-schema
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';

const log = createChildLogger({ module: 'venture-schema' });

/**
 * Every table this package owns, in dependency order (children after parents).
 *
 * FROZEN ON PURPOSE. `ensureVentureSchema` derives both the RLS policy statements
 * and the hosted-mode readiness requirements from this list, so a table that is
 * created but not listed gets neither — and `venture-store.test.js` asserts the
 * list and the DDL agree.
 */
export const VENTURE_TABLES = Object.freeze([
  'venture_ventures',
  'venture_assumptions',
  'venture_scenarios',
  'venture_runs',
  'venture_bom_lines',
  'venture_vendors',
  'venture_quotes',
  'venture_schedule_tasks',
  'venture_headcount',
  'venture_models',
  'venture_documents',
] as const);

/** One of this package's tables. */
export type VentureTable = (typeof VENTURE_TABLES)[number];

/** Ventures, the append-only ledger, scenarios and runs. Mirrors migrations/001. */
const SCHEMA_CORE = `
CREATE TABLE IF NOT EXISTS venture_ventures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  idea_text TEXT NOT NULL,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  target_launch_date DATE,
  stage VARCHAR(24) NOT NULL DEFAULT 'scoped',
  horizon_months INTEGER NOT NULL DEFAULT 36,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_ventures_owner_idx ON venture_ventures(owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS venture_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  key VARCHAR(160) NOT NULL,
  domain VARCHAR(24) NOT NULL,
  label TEXT NOT NULL,
  unit VARCHAR(24) NOT NULL,
  value_num NUMERIC(24,6),
  value_text TEXT,
  low_num NUMERIC(24,6),
  high_num NUMERIC(24,6),
  source_kind VARCHAR(24) NOT NULL,
  source_detail TEXT,
  source_url TEXT,
  confidence VARCHAR(12) NOT NULL,
  authored_by VARCHAR(120) NOT NULL,
  run_id UUID,
  superseded_by UUID REFERENCES venture_assumptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS venture_assumptions_live_idx
  ON venture_assumptions(venture_id, key) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS venture_assumptions_hist_idx
  ON venture_assumptions(venture_id, key, created_at DESC);

CREATE TABLE IF NOT EXISTS venture_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume_units INTEGER,
  retail_price_cents INTEGER,
  channel_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_scenarios_venture_idx ON venture_scenarios(venture_id, created_at);

CREATE TABLE IF NOT EXISTS venture_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  phase VARCHAR(24),
  phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  bots_requested INTEGER NOT NULL DEFAULT 0,
  bots_completed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS venture_runs_venture_idx ON venture_runs(venture_id, started_at DESC);
`;

/** BOM, vendors, quotes, schedule and headcount. Mirrors migrations/002. */
const SCHEMA_SUPPLY = `
CREATE TABLE IF NOT EXISTS venture_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'component',
  country VARCHAR(64),
  url TEXT,
  contact TEXT,
  moq INTEGER,
  lead_time_days INTEGER,
  qualification_days INTEGER,
  deposit_bps INTEGER NOT NULL DEFAULT 0,
  balance_net_days INTEGER NOT NULL DEFAULT 0,
  qualified BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'candidate',
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_vendors_venture_idx ON venture_vendors(venture_id, name);

CREATE TABLE IF NOT EXISTS venture_bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  parent_line_id UUID REFERENCES venture_bom_lines(id) ON DELETE CASCADE,
  ref VARCHAR(32) NOT NULL,
  part_name TEXT NOT NULL,
  spec_text TEXT,
  qty_per_unit NUMERIC(14,6) NOT NULL DEFAULT 1,
  uom VARCHAR(16) NOT NULL DEFAULT 'ea',
  discrete BOOLEAN NOT NULL DEFAULT TRUE,
  material TEXT,
  process TEXT,
  make_or_buy VARCHAR(8) NOT NULL DEFAULT 'buy',
  unit_cost_micros BIGINT,
  low_micros BIGINT,
  high_micros BIGINT,
  scrap_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  moq INTEGER,
  lead_time_days INTEGER,
  tooling_cost_micros BIGINT NOT NULL DEFAULT 0,
  tooling_life_units INTEGER,
  vendor_id UUID REFERENCES venture_vendors(id) ON DELETE SET NULL,
  assumption_key VARCHAR(160),
  hts_code VARCHAR(16),
  duty_pct NUMERIC(6,3),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_bom_venture_idx ON venture_bom_lines(venture_id, parent_line_id, sort_order);

CREATE TABLE IF NOT EXISTS venture_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  vendor_id UUID NOT NULL REFERENCES venture_vendors(id) ON DELETE CASCADE,
  bom_line_id UUID REFERENCES venture_bom_lines(id) ON DELETE CASCADE,
  qty_break INTEGER NOT NULL DEFAULT 1,
  unit_cost_micros BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  tooling_cost_micros BIGINT NOT NULL DEFAULT 0,
  incoterm VARCHAR(12),
  lead_time_days INTEGER,
  valid_until DATE,
  document_ref TEXT,
  notes TEXT,
  assumption_id UUID REFERENCES venture_assumptions(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_quotes_venture_idx ON venture_quotes(venture_id, received_at DESC);

CREATE TABLE IF NOT EXISTS venture_schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  name TEXT NOT NULL,
  owner_role TEXT,
  duration_days INTEGER NOT NULL DEFAULT 1,
  depends_on JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumption_key VARCHAR(160),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_schedule_venture_idx ON venture_schedule_tasks(venture_id, sort_order);

CREATE TABLE IF NOT EXISTS venture_headcount (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  role TEXT NOT NULL,
  kind VARCHAR(12) NOT NULL DEFAULT 'employee',
  fte NUMERIC(6,3) NOT NULL DEFAULT 1,
  start_month INTEGER NOT NULL DEFAULT 0,
  end_month INTEGER,
  base_salary_micros BIGINT NOT NULL DEFAULT 0,
  burden_bps INTEGER NOT NULL DEFAULT 3000,
  recruit_cost_micros BIGINT NOT NULL DEFAULT 0,
  assumption_key VARCHAR(160),
  source_kind VARCHAR(24) NOT NULL DEFAULT 'model-estimate',
  confidence VARCHAR(12) NOT NULL DEFAULT 'low',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_headcount_venture_idx ON venture_headcount(venture_id, sort_order);
`;

/** Immutable model snapshots and versioned documents. Mirrors migrations/003. */
const SCHEMA_OUTPUTS = `
CREATE TABLE IF NOT EXISTS venture_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  scenario_id UUID REFERENCES venture_scenarios(id) ON DELETE CASCADE,
  run_id UUID,
  engine_version VARCHAR(16) NOT NULL,
  inputs_hash CHAR(64) NOT NULL,
  figures JSONB NOT NULL,
  tables JSONB NOT NULL,
  coverage JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  posture VARCHAR(16) NOT NULL DEFAULT 'estimate',
  can_publish BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_models_venture_idx
  ON venture_models(venture_id, scenario_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS venture_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  doc_key VARCHAR(48) NOT NULL,
  version INTEGER NOT NULL,
  model_id UUID NOT NULL REFERENCES venture_models(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  prose_run_id UUID,
  prose_status VARCHAR(12) NOT NULL DEFAULT 'none',
  unverified_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions_cited JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimate_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS venture_documents_ver_idx
  ON venture_documents(venture_id, doc_key, version);
`;

/**
 * The whole schema, in application order.
 *
 * Split into three constants purely so the file reads, and so each block matches
 * one migration file byte-for-byte in intent. `runRuntimeSchemaBootstrap` applies
 * them in order, and every statement is idempotent.
 */
export const SCHEMA_SQL: readonly string[] = Object.freeze([
  SCHEMA_CORE,
  SCHEMA_SUPPLY,
  SCHEMA_OUTPUTS,
]);

/**
 * @description Create (or, in hosted validate-only mode, verify) this package's
 *   schema together with the owner-or-operator RLS policy on every table.
 *
 * Called once at route-factory time rather than per request. RLS is derived from
 * `VENTURE_TABLES` rather than hand-listed, so the protected set can never drift
 * from the owned set — the failure mode that leaves one table world-readable is
 * structurally unavailable.
 *
 * @param pool - The framework's shared Postgres pool.
 * @returns Nothing. Throws only when hosted-mode validation finds the schema
 *   missing, which is the correct time to fail: an app whose tables do not exist
 *   should refuse loudly rather than serve empty state as if it were the truth.
 */
export async function ensureVentureSchema(pool: Pool): Promise<void> {
  const statements = [
    ...SCHEMA_SQL,
    ...VENTURE_TABLES.flatMap((t) => buildOwnerRlsPolicyStatements(t, 'owner_sub')),
  ];
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'venture-plan routes',
    statements,
    requirements: VENTURE_TABLES.map((table) => ({ table, columns: ['owner_sub'] })),
  });
  log.info({ tables: VENTURE_TABLES.length }, 'venture schema ready');
}

/**
 * @description Every table name the schema DDL actually creates.
 *
 * Exists so a guard can compare the DDL against `VENTURE_TABLES` instead of
 * trusting that whoever added a table also remembered the list. Parsing the SQL
 * is deliberate: it is the only check that cannot be satisfied by editing the
 * list alone.
 *
 * @returns The created table names, in DDL order.
 */
export function tablesInSchemaSql(): string[] {
  const found: string[] = [];
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi;
  for (const block of SCHEMA_SQL) {
    let m: RegExpExecArray | null = re.exec(block);
    while (m) {
      found.push(m[1]);
      m = re.exec(block);
    }
  }
  return found;
}
