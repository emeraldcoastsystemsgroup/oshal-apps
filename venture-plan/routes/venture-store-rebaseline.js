"use strict";
/**
 * Venture Plan - owner-scoped scheduled rebaseline persistence.
 *
 * Every caller-facing query carries both venture id and owner subject even when
 * RLS is active. The system-only scan is deliberately isolated here and returns
 * owner subjects only to the service tick; its public result never echoes them.
 * Scheduled runs use a database unique slot, so retries and concurrent ticks
 * converge on one run before any bot dispatch can occur.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add owner-bound policy reads/writes, system due-policy scan, scheduled-slot idempotency, and monotonic cost-evidence updates.
 *
 * @module venture-store-rebaseline
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRebaselinePolicy = getRebaselinePolicy;
exports.upsertRebaselinePolicy = upsertRebaselinePolicy;
exports.listEnabledRebaselinePoliciesSystem = listEnabledRebaselinePoliciesSystem;
exports.openScheduledRun = openScheduledRun;
exports.updateScheduledRunCost = updateScheduledRunCost;
const venture_rebaseline_1 = require("./venture-rebaseline");
const venture_primitives_1 = require("./venture-primitives");
/** Convert the driver's BIGINT/string row without losing integer precision. */
function toPolicy(row) {
    const maxCostMicros = Number(row.max_cost_micros);
    if (!Number.isSafeInteger(maxCostMicros)) {
        throw new Error('stored rebaseline cost cap exceeds the exact integer boundary');
    }
    return Object.freeze({
        ventureId: String(row.venture_id),
        enabled: Boolean(row.enabled),
        dryRun: Boolean(row.dry_run),
        cadence: String(row.cadence),
        weeklyDay: Number(row.weekly_day),
        maxCostMicros,
        updatedAt: new Date(row.updated_at).toISOString(),
    });
}
/** Read one owner's policy, returning the non-spending default when absent. */
async function getRebaselinePolicy(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT p.* FROM venture_rebaseline_policies p
       JOIN venture_ventures v ON v.id = p.venture_id AND v.owner_sub = p.owner_sub
      WHERE p.venture_id = $1 AND p.owner_sub = $2`, [ventureId, ownerSub]);
    return rows.length ? toPolicy(rows[0]) : (0, venture_rebaseline_1.defaultRebaselinePolicy)(ventureId);
}
/** Persist a fully validated policy only through the owner's venture row. */
async function upsertRebaselinePolicy(pool, ownerSub, policy) {
    const { rows } = await pool.query(`INSERT INTO venture_rebaseline_policies
       (venture_id, owner_sub, enabled, dry_run, cadence, weekly_day, max_cost_micros)
     SELECT v.id, v.owner_sub, $3, $4, $5, $6, $7
       FROM venture_ventures v WHERE v.id = $1 AND v.owner_sub = $2
     ON CONFLICT (venture_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       dry_run = EXCLUDED.dry_run,
       cadence = EXCLUDED.cadence,
       weekly_day = EXCLUDED.weekly_day,
       max_cost_micros = EXCLUDED.max_cost_micros,
       updated_at = NOW()
     WHERE venture_rebaseline_policies.owner_sub = EXCLUDED.owner_sub
     RETURNING *`, [policy.ventureId, ownerSub, policy.enabled, policy.dryRun, policy.cadence,
        policy.weeklyDay, policy.maxCostMicros]);
    return rows.length ? toPolicy(rows[0]) : null;
}
/** List enabled policies under a service-established system identity. */
async function listEnabledRebaselinePoliciesSystem(pool, limit = 500) {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 500;
    const { rows } = await pool.query(`SELECT p.* FROM venture_rebaseline_policies p
       JOIN venture_ventures v ON v.id = p.venture_id AND v.owner_sub = p.owner_sub
      WHERE p.enabled = TRUE
      ORDER BY p.venture_id ASC LIMIT $1`, [safeLimit]);
    return rows.map((row) => Object.freeze({
        ...toPolicy(row), ownerSub: String(row.owner_sub),
    }));
}
/**
 * Reserve a scheduled run before dispatch. The partial unique index is the
 * cross-process single-flight authority; an in-memory map is only a fast path.
 */
async function openScheduledRun(pool, ownerSub, ventureId, slot, capMicros, phases) {
    if (!/^(nightly|weekly):\d{4}-\d{2}-\d{2}$/.test(slot)) {
        throw new venture_rebaseline_1.RebaselineError('invalid_rebaseline_slot', 'scheduled run slot is invalid');
    }
    if (!Number.isSafeInteger(capMicros) || capMicros <= 0 || capMicros > venture_primitives_1.MAX_SAFE_MICROS) {
        throw new venture_rebaseline_1.RebaselineError('invalid_rebaseline_cost_cap', 'scheduled run cap must be positive integer micro-USD');
    }
    const values = [ventureId, ownerSub, JSON.stringify(phases),
        phases.filter((phase) => phase.agentId !== null).length, slot, capMicros];
    const inserted = await pool.query(`INSERT INTO venture_runs
       (venture_id, owner_sub, kind, status, phases, bots_requested,
        trigger_kind, schedule_slot, cost_cap_micros, cost_spent_micros, cost_status)
     SELECT v.id, v.owner_sub, 'rebaseline', 'running', $3::jsonb, $4,
            'scheduled', $5, $6, 0, 'within-cap'
       FROM venture_ventures v WHERE v.id = $1 AND v.owner_sub = $2
     ON CONFLICT (venture_id, schedule_slot) WHERE schedule_slot IS NOT NULL
       DO NOTHING
     RETURNING id`, values);
    if (inserted.rows.length) {
        return { runId: String(inserted.rows[0].id), inserted: true };
    }
    const existing = await pool.query(`SELECT id FROM venture_runs
      WHERE venture_id = $1 AND owner_sub = $2
        AND trigger_kind = 'scheduled' AND schedule_slot = $3`, [ventureId, ownerSub, slot]);
    return existing.rows.length
        ? { runId: String(existing.rows[0].id), inserted: false } : null;
}
/** Persist exact measured-cost state without allowing a cross-owner run update. */
async function updateScheduledRunCost(pool, ownerSub, ventureId, runId, budget) {
    if (!Number.isSafeInteger(budget.spentMicros) || budget.spentMicros < 0
        || budget.spentMicros > venture_primitives_1.MAX_SAFE_MICROS) {
        throw new venture_rebaseline_1.RebaselineError('invalid_rebaseline_cost_evidence', 'scheduled run spend must be non-negative integer micro-USD');
    }
    const { rows } = await pool.query(`UPDATE venture_runs
        SET cost_spent_micros = $5, cost_status = $6
      WHERE id = $1 AND venture_id = $2 AND owner_sub = $3
        AND trigger_kind = $4
        AND $5 >= cost_spent_micros
        AND (cost_status = 'within-cap' OR cost_status = $6 OR $6 = 'capture-failed')
      RETURNING id`, [runId, ventureId, ownerSub, 'scheduled', budget.spentMicros, budget.status]);
    return rows.length === 1;
}
//# sourceMappingURL=venture-store-rebaseline.js.map