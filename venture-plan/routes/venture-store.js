"use strict";
/**
 * Venture Plan — ventures, the append-only assumption ledger, scenarios and runs.
 *
 * EVERY QUERY IS PARAMETERISED ON `owner_sub`. RLS is the backstop, not the plan:
 * a handler that forgets to filter must still return nothing, but no handler here
 * forgets. A read for a venture the caller does not own returns exactly what a
 * read for a venture that does not exist returns — `null` — so the API leaks no
 * information about the existence of other people's ventures.
 *
 * THE LEDGER IS APPEND-ONLY AND THAT IS THE PRODUCT.
 * `upsertAssumption` never issues an `UPDATE … SET value_num`. It inserts the new
 * revision and stamps `superseded_by` on the previous live row, inside ONE
 * transaction, so the live-row partial unique index can never see two live rows
 * for a key. The consequence a user feels: replacing a guessed projector price
 * with a real quote is a dated, attributable event in `GET /assumptions/:key/history`
 * rather than a number that quietly changed between two screenshots.
 *
 * ORDER MATTERS INSIDE THAT TRANSACTION. The prior row is superseded FIRST and the
 * new row inserted SECOND, because the reverse order transiently presents the
 * index with two live rows for the same key and aborts the transaction. The
 * self-referencing pointer therefore needs the new id, which is why the insert
 * returns before the update lands — see the two-step below.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — owner-scoped venture CRUD, the transactional supersede-not-overwrite ledger write, bulk bot-authored assumption insertion, coverage roll-up, scenarios, and the run log the out-of-band orchestrator drives.
 *
 * @module venture-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVentures = listVentures;
exports.getVenture = getVenture;
exports.insertVenture = insertVenture;
exports.updateVenture = updateVenture;
exports.deleteVenture = deleteVenture;
exports.liveAssumptions = liveAssumptions;
exports.assumptionHistory = assumptionHistory;
exports.upsertAssumption = upsertAssumption;
exports.bulkInsertAssumptions = bulkInsertAssumptions;
exports.coverageOf = coverageOf;
exports.listScenarios = listScenarios;
exports.getScenario = getScenario;
exports.insertScenario = insertScenario;
exports.updateScenario = updateScenario;
exports.openRun = openRun;
exports.advanceRun = advanceRun;
exports.closeRun = closeRun;
exports.listRuns = listRuns;
exports.getRun = getRun;
exports.latestRun = latestRun;
const logger_1 = require("@/shared/logger");
const venture_types_1 = require("./venture-types");
const log = (0, logger_1.createChildLogger)({ module: 'venture-store' });
/** Cap on rows any single list read returns — a surface never needs more. */
const LIST_LIMIT = 500;
/** Map a ventures row to the API shape. */
function toVenture(r) {
    return {
        id: String(r.id),
        ownerSub: String(r.owner_sub),
        name: String(r.name),
        ideaText: String(r.idea_text),
        spec: (r.spec ?? {}),
        currency: String(r.currency ?? 'USD'),
        targetLaunchDate: r.target_launch_date ? new Date(r.target_launch_date).toISOString().slice(0, 10) : null,
        stage: String(r.stage),
        horizonMonths: Number(r.horizon_months),
        openQuestions: Array.isArray(r.open_questions) ? r.open_questions.map(String) : [],
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
    };
}
/** Map an assumptions row to the API shape. */
function toAssumption(r) {
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    return {
        id: String(r.id),
        ventureId: String(r.venture_id),
        key: String(r.key),
        domain: String(r.domain),
        label: String(r.label),
        unit: String(r.unit),
        valueNum: num(r.value_num),
        valueText: r.value_text ?? null,
        lowNum: num(r.low_num),
        highNum: num(r.high_num),
        sourceKind: String(r.source_kind),
        sourceDetail: r.source_detail ?? null,
        sourceUrl: r.source_url ?? null,
        confidence: String(r.confidence),
        authoredBy: String(r.authored_by),
        runId: r.run_id ? String(r.run_id) : null,
        supersededBy: r.superseded_by ? String(r.superseded_by) : null,
        createdAt: new Date(r.created_at).toISOString(),
        provenance: 'assumed',
    };
}
/**
 * @description List one owner's ventures, most recently touched first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @returns The caller's ventures; never another owner's.
 */
async function listVentures(pool, ownerSub) {
    const { rows } = await pool.query('SELECT * FROM venture_ventures WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT $2', [ownerSub, LIST_LIMIT]);
    return rows.map(toVenture);
}
/**
 * @description Read one venture, scoped to its owner.
 *
 * The owner predicate is in the WHERE clause rather than checked after the read,
 * so a foreign id is indistinguishable from a missing one.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The venture, or null.
 */
async function getVenture(pool, ownerSub, ventureId) {
    const { rows } = await pool.query('SELECT * FROM venture_ventures WHERE id = $1 AND owner_sub = $2', [ventureId, ownerSub]);
    return rows.length ? toVenture(rows[0]) : null;
}
/**
 * @description Create a venture owned by the calling user.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub — the only accountable owner.
 * @param input - The validated venture header.
 * @returns The stored venture.
 */
async function insertVenture(pool, ownerSub, input) {
    const { rows } = await pool.query(`INSERT INTO venture_ventures (owner_sub, name, idea_text, spec, currency, target_launch_date,
       horizon_months, open_questions)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) RETURNING *`, [ownerSub, input.name, input.ideaText, JSON.stringify(input.spec ?? {}),
        input.currency ?? 'USD', input.targetLaunchDate ?? null,
        input.horizonMonths ?? 36, JSON.stringify(input.openQuestions ?? [])]);
    log.info({ ownerSub, ventureId: rows[0].id, name: input.name }, 'venture created');
    return toVenture(rows[0]);
}
/** Columns `updateVenture` will write. Frozen — a caller cannot name a column. */
const VENTURE_UPDATABLE = Object.freeze({
    name: 'name',
    ideaText: 'idea_text',
    targetLaunchDate: 'target_launch_date',
    horizonMonths: 'horizon_months',
    stage: 'stage',
    openQuestions: 'open_questions',
    spec: 'spec',
});
/** Values that must be serialised before they reach a JSONB column. */
const VENTURE_JSON_FIELDS = new Set(['spec', 'openQuestions']);
/**
 * @description Update a venture's mutable header fields.
 *
 * The column list comes from a frozen allowlist rather than the request body, so
 * an unexpected key is dropped rather than becoming SQL. Returns null when the
 * venture is not the caller's — the same answer as "does not exist".
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param patch - Partial header; unknown keys are ignored.
 * @returns The updated venture, or null.
 */
async function updateVenture(pool, ownerSub, ventureId, patch) {
    const sets = [];
    const params = [ventureId, ownerSub];
    for (const [field, column] of Object.entries(VENTURE_UPDATABLE)) {
        if (!Object.prototype.hasOwnProperty.call(patch, field))
            continue;
        const raw = patch[field];
        params.push(VENTURE_JSON_FIELDS.has(field) ? JSON.stringify(raw ?? null) : raw);
        sets.push(`${column} = $${params.length}${VENTURE_JSON_FIELDS.has(field) ? '::jsonb' : ''}`);
    }
    if (!sets.length)
        return getVenture(pool, ownerSub, ventureId);
    const { rows } = await pool.query(`UPDATE venture_ventures SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND owner_sub = $2 RETURNING *`, params);
    return rows.length ? toVenture(rows[0]) : null;
}
/**
 * @description Delete a venture and, by cascade, everything under it.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns True when a row belonging to this owner was removed.
 */
async function deleteVenture(pool, ownerSub, ventureId) {
    const { rowCount } = await pool.query('DELETE FROM venture_ventures WHERE id = $1 AND owner_sub = $2', [ventureId, ownerSub]);
    log.info({ ownerSub, ventureId, removed: rowCount }, 'venture delete');
    return (rowCount ?? 0) > 0;
}
/**
 * @description The live assumption set for one venture — one row per key.
 *
 * "Live" is `superseded_by IS NULL`, which the partial unique index guarantees is
 * at most one row per key. Superseded revisions stay in the table forever and are
 * read through `assumptionHistory`.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The live assumptions, ordered by domain then key.
 */
async function liveAssumptions(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT * FROM venture_assumptions
     WHERE venture_id = $1 AND owner_sub = $2 AND superseded_by IS NULL
     ORDER BY domain, key LIMIT $3`, [ventureId, ownerSub, LIST_LIMIT]);
    return rows.map(toAssumption);
}
/**
 * @description Every revision of one assumption key, newest first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param key - The assumption key.
 * @returns The revision chain, including the live row.
 */
async function assumptionHistory(pool, ownerSub, ventureId, key) {
    const { rows } = await pool.query(`SELECT * FROM venture_assumptions
     WHERE venture_id = $1 AND owner_sub = $2 AND key = $3
     ORDER BY created_at DESC LIMIT 200`, [ventureId, ownerSub, key]);
    return rows.map(toAssumption);
}
/** Insert one assumption revision on an open client. Shared by both write paths. */
async function insertRevision(client, ownerSub, ventureId, a, authoredBy, runId) {
    const { rows } = await client.query(`INSERT INTO venture_assumptions (venture_id, owner_sub, key, domain, label, unit,
       value_num, value_text, low_num, high_num, source_kind, source_detail, source_url,
       confidence, authored_by, run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [ventureId, ownerSub, a.key, a.domain, a.label, a.unit,
        a.valueNum ?? null, a.valueText ?? null, a.lowNum ?? null, a.highNum ?? null,
        a.sourceKind, a.sourceDetail ?? null, a.sourceUrl ?? null,
        a.confidence, authoredBy, runId]);
    return toAssumption(rows[0]);
}
/**
 * @description Write a new revision of an assumption, superseding the live one.
 *
 * NEVER an in-place update. The previous live row is stamped with the new row's
 * id, so the history of a number is complete and the moment a guess became a
 * quote is on the record with its author. Runs in a transaction because a
 * half-applied supersede would leave two live rows and violate the index.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param a - The new assumption values.
 * @param authoredBy - An agentId, or `user:<sub>`.
 * @param runId - The run that authored it, when a bot did.
 * @returns The new live revision and the id it superseded (null on a first write).
 */
async function upsertAssumption(pool, ownerSub, ventureId, a, authoredBy, runId = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Clear the live flag FIRST: the partial unique index forbids two live rows for
        // one key, so inserting before superseding aborts the transaction.
        const prior = await client.query(`UPDATE venture_assumptions SET superseded_by = id
       WHERE venture_id = $1 AND owner_sub = $2 AND key = $3 AND superseded_by IS NULL
       RETURNING id`, [ventureId, ownerSub, a.key]);
        const created = await insertRevision(client, ownerSub, ventureId, a, authoredBy, runId);
        const supersededId = prior.rows.length ? String(prior.rows[0].id) : null;
        if (supersededId) {
            // Point the retired row at its successor rather than at itself.
            await client.query('UPDATE venture_assumptions SET superseded_by = $2 WHERE id = $1 AND owner_sub = $3', [supersededId, created.id, ownerSub]);
        }
        await client.query('COMMIT');
        log.info({ ownerSub, ventureId, key: a.key, supersededId, sourceKind: a.sourceKind }, 'assumption revision written');
        return { assumption: created, supersededId };
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        log.error({ err, stack: err?.stack, ownerSub, ventureId, key: a.key }, 'assumption write failed');
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * @description Write a batch of bot-authored assumptions, one revision each.
 *
 * Sequential rather than a single multi-row insert: each key needs its own
 * supersede, and a batch that partially fails must leave the keys it did write
 * correct rather than rolling back a whole research phase over one bad row.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param rows - Parsed assumptions from a bot contract.
 * @param authoredBy - The authoring agentId.
 * @param runId - The run these belong to.
 * @returns How many revisions landed and the keys that failed.
 */
async function bulkInsertAssumptions(pool, ownerSub, ventureId, rows, authoredBy, runId) {
    let written = 0;
    const failed = [];
    for (const a of rows) {
        try {
            await upsertAssumption(pool, ownerSub, ventureId, a, authoredBy, runId);
            written += 1;
        }
        catch (err) {
            log.error({ err, stack: err?.stack, ventureId, key: a.key }, 'assumption row rejected');
            failed.push(a.key);
        }
    }
    return { written, failed };
}
/**
 * @description Roll the live ledger up into the coverage headline.
 *
 * `estimatePct` is what the surface leads with — "34 of 61 figures still rest on
 * model estimates" — and it is COMPUTED here rather than typed anywhere, per the
 * anti-drift rule that counts are generated.
 *
 * @param assumptions - The live assumption set.
 * @returns Counts by source kind and confidence, plus the estimate percentage.
 */
function coverageOf(assumptions) {
    const bySourceKind = Object.fromEntries(venture_types_1.SOURCE_KINDS.map((k) => [k, 0]));
    const byConfidence = Object.fromEntries(venture_types_1.CONFIDENCES.map((c) => [c, 0]));
    for (const a of assumptions) {
        if (bySourceKind[a.sourceKind] !== undefined)
            bySourceKind[a.sourceKind] += 1;
        if (byConfidence[a.confidence] !== undefined)
            byConfidence[a.confidence] += 1;
    }
    const total = assumptions.length;
    const estimatePct = total === 0 ? 0 : Math.round((bySourceKind['model-estimate'] / total) * 1000) / 10;
    return { totalAssumptions: total, bySourceKind, byConfidence, estimatePct };
}
/** Map a scenarios row to the API shape. */
function toScenario(r) {
    return {
        id: String(r.id),
        ventureId: String(r.venture_id),
        name: String(r.name),
        overrides: (r.overrides ?? {}),
        volumeUnits: r.volume_units === null ? null : Number(r.volume_units),
        retailPriceCents: r.retail_price_cents === null ? null : Number(r.retail_price_cents),
        channelMix: (r.channel_mix ?? {}),
        isBase: r.is_base === true,
        createdAt: new Date(r.created_at).toISOString(),
    };
}
/**
 * @description List a venture's scenarios.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The scenarios, base first.
 */
async function listScenarios(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT * FROM venture_scenarios WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY is_base DESC, created_at LIMIT 100`, [ventureId, ownerSub]);
    return rows.map(toScenario);
}
/**
 * @description Read one scenario, scoped to its owner and venture.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param scenarioId - Scenario id.
 * @returns The scenario, or null.
 */
async function getScenario(pool, ownerSub, ventureId, scenarioId) {
    const { rows } = await pool.query('SELECT * FROM venture_scenarios WHERE id = $1 AND venture_id = $2 AND owner_sub = $3', [scenarioId, ventureId, ownerSub]);
    return rows.length ? toScenario(rows[0]) : null;
}
/**
 * @description Create a scenario.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param s - Name, overrides and optional volume/price/mix.
 * @returns The stored scenario.
 */
async function insertScenario(pool, ownerSub, ventureId, s) {
    const { rows } = await pool.query(`INSERT INTO venture_scenarios (venture_id, owner_sub, name, overrides, volume_units,
       retail_price_cents, channel_mix, is_base)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8) RETURNING *`, [ventureId, ownerSub, s.name, JSON.stringify(s.overrides ?? {}),
        s.volumeUnits ?? null, s.retailPriceCents ?? null,
        JSON.stringify(s.channelMix ?? {}), s.isBase === true]);
    return toScenario(rows[0]);
}
/**
 * @description Update a scenario's overrides or levers.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param scenarioId - Scenario id.
 * @param patch - Partial scenario.
 * @returns The updated scenario, or null when it is not the caller's.
 */
async function updateScenario(pool, ownerSub, ventureId, scenarioId, patch) {
    const { rows } = await pool.query(`UPDATE venture_scenarios SET
       name = COALESCE($4, name),
       overrides = COALESCE($5::jsonb, overrides),
       volume_units = COALESCE($6, volume_units),
       retail_price_cents = COALESCE($7, retail_price_cents),
       channel_mix = COALESCE($8::jsonb, channel_mix)
     WHERE id = $1 AND venture_id = $2 AND owner_sub = $3 RETURNING *`, [scenarioId, ventureId, ownerSub, patch.name ?? null,
        patch.overrides === undefined ? null : JSON.stringify(patch.overrides),
        patch.volumeUnits ?? null, patch.retailPriceCents ?? null,
        patch.channelMix === undefined ? null : JSON.stringify(patch.channelMix)]);
    return rows.length ? toScenario(rows[0]) : null;
}
/** Map a runs row to the API shape. */
function toRun(r) {
    return {
        id: String(r.id),
        ventureId: String(r.venture_id),
        kind: String(r.kind),
        status: String(r.status),
        phase: r.phase ?? null,
        phases: Array.isArray(r.phases) ? r.phases : [],
        botsRequested: Number(r.bots_requested),
        botsCompleted: Number(r.bots_completed),
        error: r.error ?? null,
        startedAt: new Date(r.started_at).toISOString(),
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    };
}
/**
 * @description Open a run row and return its id immediately.
 *
 * The id is what `POST /runs` answers 202 with, so it must exist before any bot
 * is called — a run whose row appears only on completion is invisible while it is
 * the only thing the user is waiting for.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param kind - What the run was asked to do.
 * @param phases - The planned phase list, already in `pending`.
 * @returns The new run id.
 */
async function openRun(pool, ownerSub, ventureId, kind, phases) {
    const { rows } = await pool.query(`INSERT INTO venture_runs (venture_id, owner_sub, kind, status, phases, bots_requested)
     VALUES ($1,$2,$3,'running',$4::jsonb,$5) RETURNING id`, [ventureId, ownerSub, kind, JSON.stringify(phases),
        phases.filter((p) => p.agentId !== null).length]);
    return String(rows[0].id);
}
/**
 * @description Record progress on a run: which phase it is in and the phase list.
 * @param pool - Shared pool.
 * @param runId - Run id.
 * @param phase - The phase now executing.
 * @param phases - The full phase list with updated statuses.
 * @param botsCompleted - How many bot phases have finished, successfully or not.
 * @returns Nothing.
 */
async function advanceRun(pool, runId, phase, phases, botsCompleted) {
    await pool.query('UPDATE venture_runs SET phase = $2, phases = $3::jsonb, bots_completed = $4 WHERE id = $1', [runId, phase, JSON.stringify(phases), botsCompleted]);
}
/**
 * @description Close a run as done or failed.
 * @param pool - Shared pool.
 * @param runId - Run id.
 * @param status - Terminal status.
 * @param phases - The final phase list.
 * @param error - Failure reason when the run failed outright.
 * @returns Nothing.
 */
async function closeRun(pool, runId, status, phases, error) {
    await pool.query(`UPDATE venture_runs SET status = $2, phases = $3::jsonb, error = $4, phase = NULL,
       finished_at = NOW() WHERE id = $1`, [runId, status, JSON.stringify(phases), error ?? null]);
}
/**
 * @description List a venture's runs, newest first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The runs.
 */
async function listRuns(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT * FROM venture_runs WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY started_at DESC LIMIT 50`, [ventureId, ownerSub]);
    return rows.map(toRun);
}
/**
 * @description Read one run by id, scoped to its owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param runId - Run id.
 * @returns The run, or null when it is missing or not the caller's.
 */
async function getRun(pool, ownerSub, runId) {
    const { rows } = await pool.query('SELECT * FROM venture_runs WHERE id = $1 AND owner_sub = $2', [runId, ownerSub]);
    return rows.length ? toRun(rows[0]) : null;
}
/**
 * @description Read the newest run for a venture, whatever its status.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The newest run, or null.
 */
async function latestRun(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT * FROM venture_runs WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY started_at DESC LIMIT 1`, [ventureId, ownerSub]);
    return rows.length ? toRun(rows[0]) : null;
}
//# sourceMappingURL=venture-store.js.map