"use strict";
/**
 * AI Bake-Off — the owner-scoped Postgres store (jobs, runs, per-lane results).
 *
 * Every table carries `owner_sub` and gets the kernel's owner-or-operator RLS policy, so a
 * bake-off — which contains the caller's prompts, their outputs, and their spend — is unreadable
 * to any other user even if a handler forgets to filter. The handlers filter anyway; RLS is the
 * backstop, not the plan.
 *
 * Schema is applied through `runRuntimeSchemaBootstrap` (validate-only in hosted mode), and the
 * package also ships migrations/001-bake-off.sql, so the app works whether or not
 * APP_PACKAGE_MIGRATIONS is on.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — bake_off_jobs / bake_off_runs / bake_off_results with owner-or-operator RLS, plus the owner-scoped CRUD the routes and the engine share. Reads are always parameterised on owner_sub so a missing GUC cannot widen a query.
 *
 * @module bake-off-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBakeOffSchema = ensureBakeOffSchema;
exports.insertJob = insertJob;
exports.listJobs = listJobs;
exports.getJob = getJob;
exports.deleteJob = deleteJob;
exports.openRun = openRun;
exports.closeRun = closeRun;
exports.insertResult = insertResult;
exports.listRuns = listRuns;
exports.getRun = getRun;
exports.listResults = listResults;
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const log = (0, logger_1.createChildLogger)({ module: 'bake-off-store' });
/** Tables this package owns. Order matters — results reference runs, runs reference jobs. */
const TABLES = ['bake_off_jobs', 'bake_off_runs', 'bake_off_results'];
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bake_off_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference TEXT,
  quality_bar NUMERIC(5,2) NOT NULL DEFAULT 70,
  monthly_volume INTEGER NOT NULL DEFAULT 100,
  lane_agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS bake_off_jobs_owner_idx ON bake_off_jobs(owner_sub, created_at DESC);
CREATE TABLE IF NOT EXISTS bake_off_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES bake_off_jobs(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  lanes_requested INTEGER NOT NULL DEFAULT 0,
  lanes_completed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS bake_off_runs_job_idx ON bake_off_runs(job_id, started_at DESC);
CREATE TABLE IF NOT EXISTS bake_off_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES bake_off_runs(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  lane_bot TEXT NOT NULL,
  lane_agent_id VARCHAR(64) NOT NULL,
  lane_harness TEXT NOT NULL,
  lane_provider TEXT NOT NULL,
  observed_model TEXT,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  output TEXT,
  cost_usd NUMERIC(12,6),
  total_tokens INTEGER,
  duration_ms INTEGER,
  judge_score NUMERIC(5,2),
  judge_mode VARCHAR(32),
  judge_rationale TEXT,
  dimensions JSONB,
  task_id VARCHAR(64),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS bake_off_results_run_idx ON bake_off_results(run_id, created_at);
`;
/**
 * @description Create (or validate) this package's schema, including RLS policies.
 *
 * @param pool - The framework's shared Postgres pool.
 * @returns Nothing; throws only when the hosted-mode validation finds the schema missing.
 */
async function ensureBakeOffSchema(pool) {
    const statements = [SCHEMA_SQL, ...TABLES.flatMap((t) => (0, database_1.buildOwnerRlsPolicyStatements)(t, 'owner_sub'))];
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'bake-off routes',
        statements,
        requirements: TABLES.map((table) => ({ table, columns: ['owner_sub'] })),
    });
}
/** Map a jobs row to the API shape (JSONB columns arrive already parsed). */
function toJob(r) {
    return {
        id: String(r.id),
        ownerSub: String(r.owner_sub),
        name: String(r.name),
        prompt: String(r.prompt),
        rubric: Array.isArray(r.rubric) ? r.rubric : [],
        reference: r.reference ?? null,
        qualityBar: Number(r.quality_bar),
        monthlyVolume: Number(r.monthly_volume),
        laneAgentIds: Array.isArray(r.lane_agent_ids) ? r.lane_agent_ids : [],
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
    };
}
/**
 * @description Persist a new job for one owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub — the only accountable owner.
 * @param spec - The validated spec.
 * @returns The stored job.
 */
async function insertJob(pool, ownerSub, spec) {
    const { rows } = await pool.query(`INSERT INTO bake_off_jobs (owner_sub, name, prompt, rubric, reference, quality_bar, monthly_volume, lane_agent_ids)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) RETURNING *`, [ownerSub, spec.name, spec.prompt, JSON.stringify(spec.rubric), spec.reference,
        spec.qualityBar, spec.monthlyVolume, JSON.stringify(spec.laneAgentIds)]);
    log.info({ ownerSub, jobId: rows[0].id, name: spec.name }, 'Bake-off job created');
    return toJob(rows[0]);
}
/**
 * @description List one owner's jobs, newest first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @returns The owner's jobs (never another owner's).
 */
async function listJobs(pool, ownerSub) {
    const { rows } = await pool.query('SELECT * FROM bake_off_jobs WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 200', [ownerSub]);
    return rows.map(toJob);
}
/**
 * @description Read one job, scoped to its owner.
 *
 * Owner-scoped in the WHERE clause so a job the caller does not own returns the same `null` as a
 * job that does not exist — no existence leak (the run-trace read model's posture).
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param jobId - Job id.
 * @returns The job, or null.
 */
async function getJob(pool, ownerSub, jobId) {
    const { rows } = await pool.query('SELECT * FROM bake_off_jobs WHERE id = $1 AND owner_sub = $2', [jobId, ownerSub]);
    return rows.length ? toJob(rows[0]) : null;
}
/**
 * @description Delete one job (and, by cascade, its runs and results).
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param jobId - Job id.
 * @returns True when a row belonging to this owner was removed.
 */
async function deleteJob(pool, ownerSub, jobId) {
    const { rowCount } = await pool.query('DELETE FROM bake_off_jobs WHERE id = $1 AND owner_sub = $2', [jobId, ownerSub]);
    log.info({ ownerSub, jobId, removed: rowCount }, 'Bake-off job delete');
    return (rowCount ?? 0) > 0;
}
/**
 * @description Open a run row for a job.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param jobId - Job the run belongs to.
 * @param lanesRequested - How many lanes this run will race.
 * @returns The new run id.
 */
async function openRun(pool, ownerSub, jobId, lanesRequested) {
    const { rows } = await pool.query(`INSERT INTO bake_off_runs (job_id, owner_sub, status, lanes_requested) VALUES ($1,$2,'running',$3) RETURNING id`, [jobId, ownerSub, lanesRequested]);
    return String(rows[0].id);
}
/**
 * @description Close a run as complete or failed.
 * @param pool - Shared pool.
 * @param runId - Run id.
 * @param status - Terminal status.
 * @param lanesCompleted - Lanes that produced a graded result.
 * @param error - Failure reason when status is 'failed'.
 * @returns Nothing.
 */
async function closeRun(pool, runId, status, lanesCompleted, error) {
    await pool.query(`UPDATE bake_off_runs SET status = $2, lanes_completed = $3, error = $4, finished_at = NOW() WHERE id = $1`, [runId, status, lanesCompleted, error ?? null]);
}
/**
 * @description Persist one lane's result.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param runId - Run the lane belongs to.
 * @param r - The lane result.
 * @returns Nothing.
 */
async function insertResult(pool, ownerSub, runId, r) {
    await pool.query(`INSERT INTO bake_off_results (run_id, owner_sub, lane_bot, lane_agent_id, lane_harness, lane_provider,
       observed_model, ok, output, cost_usd, total_tokens, duration_ms, judge_score, judge_mode,
       judge_rationale, dimensions, task_id, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)`, [runId, ownerSub, r.laneBot, r.laneAgentId, r.laneHarness, r.laneProvider, r.observedModel ?? null,
        r.ok, r.output ?? null, r.costUsd ?? null, r.totalTokens ?? null, r.durationMs ?? null,
        r.judgeScore ?? null, r.judgeMode ?? null, r.judgeRationale ?? null,
        r.dimensions === undefined ? null : JSON.stringify(r.dimensions), r.taskId ?? null, r.error ?? null]);
}
/** Map a runs row to the API shape. */
function toRun(r) {
    return {
        id: String(r.id), jobId: String(r.job_id), status: String(r.status),
        lanesRequested: Number(r.lanes_requested), lanesCompleted: Number(r.lanes_completed),
        error: r.error ?? null,
        startedAt: new Date(r.started_at).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    };
}
/**
 * @description List a job's runs, newest first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param jobId - Job id.
 * @returns The runs.
 */
async function listRuns(pool, ownerSub, jobId) {
    const { rows } = await pool.query('SELECT * FROM bake_off_runs WHERE job_id = $1 AND owner_sub = $2 ORDER BY started_at DESC LIMIT 50', [jobId, ownerSub]);
    return rows.map(toRun);
}
/**
 * @description Read the newest run for a job, or a specific one.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param jobId - Job id.
 * @param runId - Specific run, or null for the newest.
 * @returns The run, or null.
 */
async function getRun(pool, ownerSub, jobId, runId) {
    const { rows } = runId
        ? await pool.query('SELECT * FROM bake_off_runs WHERE id = $1 AND job_id = $2 AND owner_sub = $3', [runId, jobId, ownerSub])
        : await pool.query('SELECT * FROM bake_off_runs WHERE job_id = $1 AND owner_sub = $2 ORDER BY started_at DESC LIMIT 1', [jobId, ownerSub]);
    return rows.length ? toRun(rows[0]) : null;
}
/**
 * @description Read one run's lane results.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param runId - Run id.
 * @param includeOutput - When false, the (potentially large) output text is omitted.
 * @returns The lane results in insertion order.
 */
async function listResults(pool, ownerSub, runId, includeOutput) {
    const { rows } = await pool.query('SELECT * FROM bake_off_results WHERE run_id = $1 AND owner_sub = $2 ORDER BY created_at', [runId, ownerSub]);
    return rows.map((r) => ({
        laneBot: String(r.lane_bot), laneAgentId: String(r.lane_agent_id),
        laneHarness: String(r.lane_harness), laneProvider: String(r.lane_provider),
        observedModel: r.observed_model ?? null, ok: r.ok === true,
        output: includeOutput ? (r.output ?? null) : null,
        costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
        totalTokens: r.total_tokens === null ? null : Number(r.total_tokens),
        durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
        judgeScore: r.judge_score === null ? null : Number(r.judge_score),
        judgeMode: r.judge_mode ?? null, judgeRationale: r.judge_rationale ?? null,
        dimensions: r.dimensions ?? null, taskId: r.task_id ?? null, error: r.error ?? null,
    }));
}
//# sourceMappingURL=bake-off-store.js.map