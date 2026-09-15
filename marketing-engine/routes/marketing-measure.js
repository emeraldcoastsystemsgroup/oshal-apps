"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Measurement handlers for the marketing-engine API, moved verbatim out of marketing-routes.ts at the 800-line decomposition threshold: the stored weekly scorecard read and its current-week rebuild, the experiment lifecycle with its legal-transition graph, the 428-gated budget-proposal decision and the whitelisted apply behind it, and the deterministic UTM builder. Every query, transition, status code and payload is unchanged.
 *
 * @module marketing-measure
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScorecard = getScorecard;
exports.rebuildScorecard = rebuildScorecard;
exports.createExperiment = createExperiment;
exports.patchExperiment = patchExperiment;
exports.decideBudgetProposal = decideBudgetProposal;
exports.getUtm = getUtm;
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const marketing_model_1 = require("./marketing-model");
const marketing_support_1 = require("./marketing-support");
/**
 * @description GET /scorecard?weeks=8 — the caller's stored weekly scorecards, newest first.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function getScorecard(ctx, sub, req, res) {
    const weeksRaw = Number(req.query.weeks ?? 8);
    const weeks = Number.isInteger(weeksRaw) && weeksRaw >= 1 && weeksRaw <= 52 ? weeksRaw : 8;
    const weekRows = await (0, marketing_support_1.safeRows)(ctx.pool, 'SELECT * FROM oshal_marketing_scorecard_weeks WHERE user_sub = $1 ORDER BY week_start DESC LIMIT ' + weeks, [sub]);
    res.json({ weeks: weekRows });
}
/**
 * @description POST /scorecard/rebuild — recompute + upsert the CURRENT week from the caller's own events.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param _req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function rebuildScorecard(ctx, sub, _req, res) {
    const weekStart = (0, marketing_model_1.weekStartOf)(new Date().toISOString());
    const events = await (0, marketing_support_1.safeRows)(ctx.pool, `SELECT ts, source, campaign_slug, medium, event, value, meta FROM oshal_marketing_events
     WHERE user_sub = $1 AND ts >= $2::date AND ts < $2::date + INTERVAL '7 days' ORDER BY ts ASC`, [sub, weekStart]);
    const normalized = events.map((e) => ({
        ...e,
        ts: e.ts instanceof Date ? e.ts.toISOString() : String(e.ts),
        value: Number(e.value),
    }));
    const rollup = (0, marketing_model_1.scorecardRollup)(normalized, weekStart);
    const week = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_scorecard_weeks (user_sub, week_start, data, sources, computed_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,now())
     ON CONFLICT (user_sub, week_start) DO UPDATE SET data = EXCLUDED.data, sources = EXCLUDED.sources, computed_at = now()
     RETURNING *`, [sub, weekStart, JSON.stringify(rollup.data ?? {}), JSON.stringify(rollup.sources ?? {})]))[0];
    res.json({ week });
}
/**
 * @description POST /experiments — register a proposed experiment (ICE 1-10 each).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function createExperiment(ctx, sub, req, res) {
    const b = (req.body ?? {});
    const hypothesis = typeof b.hypothesis === 'string' ? b.hypothesis.trim().slice(0, 1000) : '';
    const variable = typeof b.variable === 'string' ? b.variable.trim().slice(0, 200) : '';
    if (!hypothesis || !variable) {
        res.status(400).json({ error: 'hypothesis_and_variable_required' });
        return;
    }
    const ice = ['iceImpact', 'iceConfidence', 'iceEase'].map((k, i) => Number(b[k] ?? b[['ice_impact', 'ice_confidence', 'ice_ease'][i]]));
    if (ice.some((n) => !Number.isInteger(n) || n < 1 || n > 10)) {
        res.status(400).json({ error: 'ice_scores_must_be_integers_1_10' });
        return;
    }
    const campaignId = typeof b.campaignId === 'string' && marketing_support_1.UUID_RE.test(b.campaignId) ? b.campaignId : null;
    const row = (await (0, marketing_support_1.rows)(ctx.pool, `INSERT INTO oshal_marketing_experiments (user_sub, campaign_id, hypothesis, variable, ice_impact, ice_confidence, ice_ease)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [sub, campaignId, hypothesis, variable, ice[0], ice[1], ice[2]]))[0];
    res.status(201).json({ experiment: row });
}
/**
 * @description PATCH /experiments/:id — status transition (legal graph enforced) + verdict/window edits.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function patchExperiment(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(id)) {
        res.status(404).json({ error: 'experiment_not_found' });
        return;
    }
    const existing = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_experiments WHERE experiment_id = $1 AND user_sub = $2', [id, sub]))[0];
    if (!existing) {
        res.status(404).json({ error: 'experiment_not_found' });
        return;
    }
    const b = (req.body ?? {});
    const next = String(b.status || '');
    if (!(next in marketing_support_1.EXPERIMENT_TRANSITIONS)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
    }
    if (!(marketing_support_1.EXPERIMENT_TRANSITIONS[String(existing.status)] ?? []).includes(next)) {
        res.status(409).json({ error: 'illegal_transition', from: existing.status, to: next });
        return;
    }
    const verdict = typeof b.verdict === 'string' ? b.verdict.trim().slice(0, 2000) : null;
    const windowStart = typeof b.windowStart === 'string' && marketing_support_1.DATE_RE.test(b.windowStart) ? b.windowStart : null;
    const windowEnd = typeof b.windowEnd === 'string' && marketing_support_1.DATE_RE.test(b.windowEnd) ? b.windowEnd : null;
    const row = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_experiments SET
       status = $1,
       verdict = COALESCE($2, verdict),
       window_start = COALESCE($3::date, window_start),
       window_end = COALESCE($4::date, window_end),
       updated_at = now()
     WHERE experiment_id = $5 AND user_sub = $6 RETURNING *`, [next, verdict, windowStart, windowEnd, id, sub]))[0];
    res.json({ experiment: row });
}
/** Apply an approved proposal to its campaign (whitelisted fields only). */
async function applyBudgetProposal(pool, sub, row) {
    if (!row.campaign_id)
        return { ok: false, status: 422, error: 'proposal_has_no_campaign' };
    if (row.field === 'budget_monthly_usd') {
        const value = Number(row.new_value);
        if (!Number.isFinite(value) || value < 0)
            return { ok: false, status: 422, error: 'invalid_value' };
        const r = await pool.query('UPDATE oshal_marketing_campaigns SET budget_monthly_usd = $1, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3', [value, row.campaign_id, sub]);
        if (!r.rowCount)
            return { ok: false, status: 409, error: 'campaign_not_found' };
        return { ok: true };
    }
    if (row.field === 'channels') {
        let channels;
        try {
            channels = JSON.parse(String(row.new_value));
        }
        catch (err) {
            marketing_support_1.logger.error({ err, entryId: row.entry_id }, 'budget proposal channels value is not JSON');
            channels = null;
        }
        if (!Array.isArray(channels))
            return { ok: false, status: 422, error: 'invalid_value' };
        const r = await pool.query('UPDATE oshal_marketing_campaigns SET channels = $1::jsonb, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3', [JSON.stringify(channels), row.campaign_id, sub]);
        if (!r.rowCount)
            return { ok: false, status: 409, error: 'campaign_not_found' };
        return { ok: true };
    }
    return { ok: false, status: 422, error: 'unsupported_field' };
}
/**
 * @description POST /budget/proposals/:id/decide — approve (428-gated, then applied) or reject.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function decideBudgetProposal(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(id)) {
        res.status(404).json({ error: 'proposal_not_found' });
        return;
    }
    const b = (req.body ?? {});
    const decision = String(b.decision || '');
    if (decision !== 'approve' && decision !== 'reject') {
        res.status(400).json({ error: 'decision_must_be_approve_or_reject' });
        return;
    }
    const row = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_budget_ledger WHERE entry_id = $1 AND user_sub = $2', [id, sub]))[0];
    if (!row) {
        res.status(404).json({ error: 'proposal_not_found' });
        return;
    }
    if (row.status !== 'proposed') {
        res.status(409).json({ error: 'already_decided', status: row.status });
        return;
    }
    if (decision === 'reject') {
        const rejected = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_budget_ledger SET status = 'rejected', decided_by = $1, decided_at = now()
       WHERE entry_id = $2 AND user_sub = $3 AND status = 'proposed' RETURNING *`, [sub, id, sub]))[0];
        res.json({ proposal: rejected ?? row });
        return;
    }
    if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(b)) {
        res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('marketing-budget', 'budget.apply'));
        return;
    }
    const approved = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_budget_ledger SET status = 'approved', decided_by = $1, decided_at = now()
     WHERE entry_id = $2 AND user_sub = $3 AND status = 'proposed' RETURNING *`, [sub, id, sub]))[0];
    if (!approved) {
        res.status(409).json({ error: 'already_decided' });
        return;
    }
    const applied = await applyBudgetProposal(ctx.pool, sub, approved);
    if (!applied.ok) {
        res.status(applied.status).json({ error: applied.error, proposal: approved });
        return;
    }
    const final = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_budget_ledger SET status = 'applied' WHERE entry_id = $1 AND user_sub = $2 RETURNING *`, [id, sub]))[0];
    res.json({ proposal: final ?? approved });
}
/**
 * @description GET /utm — deterministic UTM-tagged link from the pure model builder.
 * @param _ctx - Framework app context (unused; the builder is pure).
 * @param _sub - The caller's OIDC subject (unused; no row is read).
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function getUtm(_ctx, _sub, req, res) {
    const q = req.query;
    const url = String(q.url || '');
    const source = String(q.source || '');
    const medium = String(q.medium || '');
    const campaign = String(q.campaign || '');
    const content = String(q.content || '');
    if (!url || !source || !medium || !campaign) {
        res.status(400).json({ error: 'url_source_medium_campaign_required' });
        return;
    }
    try {
        const utmUrl = (0, marketing_model_1.buildUtmUrl)({ url, source, medium, campaign, content: content || undefined });
        if (typeof utmUrl !== 'string' || !utmUrl) {
            res.status(400).json({ error: 'invalid_url' });
            return;
        }
        res.json({ utmUrl });
    }
    catch (err) {
        marketing_support_1.logger.error({ err }, 'UTM build rejected input');
        res.status(400).json({ error: 'invalid_url' });
    }
}
