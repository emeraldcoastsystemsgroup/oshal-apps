"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Campaign and content handlers for the marketing-engine API, moved verbatim out of marketing-routes.ts at the 800-line decomposition threshold: the board overview, campaign create/sanitized-import/patch with its applied budget-ledger rows, the three inline-bot surfaces (draft, ICP research, launch checklist), the content list, and the publish handler that runs the consent→cap→confirm→rail→run-ledger chain. Every query, gate order, status code and payload is unchanged.
 *
 * @module marketing-campaigns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOverview = getOverview;
exports.createCampaign = createCampaign;
exports.importCampaign = importCampaign;
exports.patchCampaign = patchCampaign;
exports.createDraft = createDraft;
exports.runResearch = runResearch;
exports.runLaunchChecklist = runLaunchChecklist;
exports.listContent = listContent;
exports.publishContent = publishContent;
const marketing_model_1 = require("./marketing-model");
const marketing_support_1 = require("./marketing-support");
const marketing_bots_1 = require("./marketing-bots");
const marketing_publish_1 = require("./marketing-publish");
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
/**
 * @description GET /overview — the one board payload.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param _req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function getOverview(ctx, sub, _req, res) {
    const pool = ctx.pool;
    const [campaigns, channelRows, scorecard, pendingProposals, experiments, recentRuns] = await Promise.all([
        (0, marketing_support_1.rows)(pool, 'SELECT * FROM oshal_marketing_campaigns WHERE user_sub = $1 ORDER BY updated_at DESC', [sub]),
        (0, marketing_support_1.rows)(pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1', [sub]),
        (0, marketing_support_1.safeRows)(pool, 'SELECT * FROM oshal_marketing_scorecard_weeks WHERE user_sub = $1 ORDER BY week_start DESC LIMIT 2', [sub]),
        (0, marketing_support_1.rows)(pool, "SELECT * FROM oshal_marketing_budget_ledger WHERE user_sub = $1 AND status = 'proposed' ORDER BY created_at DESC", [sub]),
        (0, marketing_support_1.rows)(pool, "SELECT * FROM oshal_marketing_experiments WHERE user_sub = $1 AND status IN ('proposed','running','extended') ORDER BY created_at DESC", [sub]),
        (0, marketing_support_1.safeRows)(pool, 'SELECT * FROM oshal_marketing_run_ledger WHERE user_sub = $1 ORDER BY ts DESC LIMIT 20', [sub]),
    ]);
    res.json({
        campaigns,
        channels: (0, marketing_support_1.withChannelDefaults)(sub, channelRows),
        scorecard,
        pendingProposals,
        experiments,
        recentRuns,
    });
}
/** Insert one campaign row; 23505 (per-user slug collision) → conflict. */
async function insertCampaign(pool, sub, c) {
    try {
        const r = await (0, marketing_support_1.rows)(pool, `INSERT INTO oshal_marketing_campaigns (user_sub, product, name, slug, motion, icp, message_map, channels)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`, [sub, c.product, c.name, c.slug, c.motion, JSON.stringify(c.icp ?? {}), JSON.stringify(c.messageMap ?? {}), JSON.stringify(Array.isArray(c.channels) ? c.channels : [])]);
        return { row: r[0] };
    }
    catch (err) {
        if (err.code === '23505')
            return { conflict: true };
        throw err;
    }
}
/**
 * @description POST /campaigns — create from an explicit operator request.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function createCampaign(ctx, sub, req, res) {
    const b = (req.body ?? {});
    const product = typeof b.product === 'string' ? b.product.trim().slice(0, 200) : '';
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
    if (!product || !name) {
        res.status(400).json({ error: 'product_and_name_required' });
        return;
    }
    const motion = b.motion === 'revenue' ? 'revenue' : 'adoption';
    const slug = (0, marketing_support_1.slugify)(name);
    if (!slug) {
        res.status(400).json({ error: 'name_not_sluggable' });
        return;
    }
    const icp = typeof b.icp === 'object' && b.icp ? b.icp : {};
    const messageMap = typeof b.messageMap === 'object' && b.messageMap ? b.messageMap : {};
    if ((0, marketing_support_1.tooLarge)(icp, 100_000) || (0, marketing_support_1.tooLarge)(messageMap, 100_000)) {
        res.status(400).json({ error: 'payload_too_large' });
        return;
    }
    const created = await insertCampaign(ctx.pool, sub, {
        product, name, slug, motion, icp, messageMap,
        channels: Array.isArray(b.channels) ? b.channels.filter((c) => typeof c === 'string').slice(0, 12) : [],
    });
    if (created.conflict) {
        res.status(409).json({ error: 'slug_exists', slug });
        return;
    }
    res.status(201).json({ campaign: created.row });
}
/**
 * @description POST /campaigns/import — sanitized import (NEVER consent/budget/stage — the series-pump rule).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function importCampaign(ctx, sub, req, res) {
    const raw = req.body?.campaign;
    if (!raw || typeof raw !== 'object') {
        res.status(400).json({ error: 'campaign_required' });
        return;
    }
    const clean = (0, marketing_model_1.sanitizeCampaignImport)(raw);
    const product = typeof clean.product === 'string' ? clean.product.trim().slice(0, 200) : '';
    const name = typeof clean.name === 'string' ? clean.name.trim().slice(0, 200) : '';
    if (!product || !name) {
        res.status(400).json({ error: 'import_missing_fields', hint: 'campaign.product and campaign.name are required' });
        return;
    }
    const slug = (0, marketing_support_1.slugify)(typeof clean.slug === 'string' && clean.slug.trim() ? clean.slug : name);
    if (!slug) {
        res.status(400).json({ error: 'name_not_sluggable' });
        return;
    }
    const messageMapRaw = clean.message_map ?? clean.messageMap;
    const icp = typeof clean.icp === 'object' && clean.icp ? clean.icp : {};
    const messageMap = typeof messageMapRaw === 'object' && messageMapRaw ? messageMapRaw : {};
    if ((0, marketing_support_1.tooLarge)(icp, 100_000) || (0, marketing_support_1.tooLarge)(messageMap, 100_000)) {
        res.status(400).json({ error: 'payload_too_large' });
        return;
    }
    const created = await insertCampaign(ctx.pool, sub, {
        product, name, slug,
        motion: clean.motion === 'revenue' ? 'revenue' : 'adoption',
        icp, messageMap,
        channels: Array.isArray(clean.channels) ? clean.channels : [],
    });
    if (created.conflict) {
        res.status(409).json({ error: 'slug_exists', slug });
        return;
    }
    res.status(201).json({ campaign: created.row, imported: true });
}
/** Whitelist + validate a campaign PATCH body into column→value pairs. */
function parseCampaignPatch(body) {
    const fields = {};
    if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
        if (!name)
            return { fields, error: 'name must be a non-empty string' };
        fields.name = name;
    }
    if (body.status !== undefined) {
        if (!marketing_support_1.CAMPAIGN_STATUSES.includes(String(body.status)))
            return { fields, error: 'invalid status' };
        fields.status = body.status;
    }
    if (body.stage !== undefined) {
        const stage = Number(body.stage);
        if (!Number.isInteger(stage) || stage < 0 || stage > 3)
            return { fields, error: 'stage must be an integer 0-3' };
        fields.stage = stage;
    }
    if (body.icp !== undefined) {
        if (typeof body.icp !== 'object' || !body.icp || Array.isArray(body.icp))
            return { fields, error: 'icp must be an object' };
        fields.icp = body.icp;
    }
    const messageMap = body.messageMap ?? body.message_map;
    if (messageMap !== undefined) {
        if (typeof messageMap !== 'object' || !messageMap || Array.isArray(messageMap))
            return { fields, error: 'messageMap must be an object' };
        fields.message_map = messageMap;
    }
    if (body.channels !== undefined) {
        if (!Array.isArray(body.channels))
            return { fields, error: 'channels must be an array' };
        fields.channels = body.channels.filter((c) => typeof c === 'string').slice(0, 12);
    }
    const budget = body.budgetMonthlyUsd ?? body.budget_monthly_usd;
    if (budget !== undefined) {
        const n = Number(budget);
        if (!Number.isFinite(n) || n < 0)
            return { fields, error: 'budgetMonthlyUsd must be a number >= 0' };
        fields.budget_monthly_usd = n;
    }
    const targetCpa = body.targetCpaUsd ?? body.target_cpa_usd;
    if (targetCpa !== undefined) {
        if (targetCpa !== null) {
            const n = Number(targetCpa);
            if (!Number.isFinite(n) || n <= 0)
                return { fields, error: 'targetCpaUsd must be a positive number or null' };
            fields.target_cpa_usd = n;
        }
        else {
            fields.target_cpa_usd = null;
        }
    }
    return { fields };
}
/** Append the human-decided 'applied' budget-ledger row for a direct campaign edit. */
async function appendAppliedLedger(pool, sub, campaignId, field, oldValue, newValue) {
    await pool.query(`INSERT INTO oshal_marketing_budget_ledger
       (user_sub, campaign_id, field, old_value, new_value, status, proposed_by, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,'applied','human',$6,now())`, [sub, campaignId, field, oldValue === null || oldValue === undefined ? null : String(oldValue), String(newValue), sub]);
}
/**
 * @description PATCH /campaigns/:id — whitelisted update; budget/stage edits also land in the budget ledger.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function patchCampaign(ctx, sub, req, res) {
    const id = String(req.params.id || '');
    const existing = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, id);
    if (!existing) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    const { fields, error } = parseCampaignPatch((req.body ?? {}));
    if (error) {
        res.status(400).json({ error });
        return;
    }
    if (Object.keys(fields).length === 0) {
        res.status(400).json({ error: 'no_updatable_fields' });
        return;
    }
    const sets = [];
    const vals = [];
    for (const [col, val] of Object.entries(fields)) {
        vals.push(marketing_support_1.JSONB_COLS.has(col) ? JSON.stringify(val) : val);
        sets.push(`${col} = $${vals.length}${marketing_support_1.JSONB_COLS.has(col) ? '::jsonb' : ''}`);
    }
    vals.push(id, sub);
    const updated = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_campaigns SET ${sets.join(', ')}, updated_at = now()
     WHERE campaign_id = $${vals.length - 1} AND user_sub = $${vals.length} RETURNING *`, vals))[0];
    if ('budget_monthly_usd' in fields && Number(existing.budget_monthly_usd) !== Number(fields.budget_monthly_usd)) {
        await appendAppliedLedger(ctx.pool, sub, id, 'budget_monthly_usd', existing.budget_monthly_usd, fields.budget_monthly_usd);
    }
    if ('stage' in fields && Number(existing.stage) !== Number(fields.stage)) {
        await appendAppliedLedger(ctx.pool, sub, id, 'stage', existing.stage, fields.stage);
    }
    res.json({ campaign: updated });
}
/** Insert one content item as a reviewable draft. */
async function insertContent(pool, sub, c) {
    return (await (0, marketing_support_1.rows)(pool, `INSERT INTO oshal_marketing_content (user_sub, campaign_id, channel, title, body, status)
     VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`, [sub, c.campaignId, c.channel, c.title, c.body]))[0];
}
/**
 * @description POST /drafts — campaign-director writes one channel draft; stored for human review.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function createDraft(ctx, sub, req, res) {
    const b = (req.body ?? {});
    const channel = String(b.channel || '');
    if (!marketing_support_1.CHANNELS.includes(channel)) {
        res.status(400).json({ error: 'unknown_channel' });
        return;
    }
    const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, 2000) : '';
    if (!brief) {
        res.status(400).json({ error: 'brief_required' });
        return;
    }
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, String(b.campaignId || ''));
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    await (0, marketing_bots_1.respondWithBot)(res, async () => {
        const text = await (0, marketing_bots_1.runMarketingBot)(ctx, marketing_support_1.CAMPAIGN_DIRECTOR_ID, 'draft', String(campaign.slug), sub, (0, marketing_bots_1.draftPrompt)(campaign, channel, brief));
        const item = await insertContent(ctx.pool, sub, {
            campaignId: String(campaign.campaign_id), channel, title: brief.slice(0, 120), body: text,
        });
        res.status(201).json({ item });
    });
}
/**
 * @description POST /research — market-analyst refines the campaign ICP (raw text preserved on parse failure).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function runResearch(ctx, sub, req, res) {
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, String(req.body?.campaignId || ''));
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    await (0, marketing_bots_1.respondWithBot)(res, async () => {
        const text = await (0, marketing_bots_1.runMarketingBot)(ctx, marketing_support_1.MARKET_ANALYST_ID, 'research', String(campaign.slug), sub, (0, marketing_bots_1.researchPrompt)(campaign));
        const parsed = (0, marketing_bots_1.extractJsonObject)(text);
        const baseIcp = (typeof campaign.icp === 'object' && campaign.icp) ? campaign.icp : {};
        const merged = parsed ? { ...baseIcp, ...parsed } : null;
        const icp = merged && !(0, marketing_support_1.tooLarge)(merged, 200_000) ? merged : { ...baseIcp, rawNotes: text.slice(0, 8000) };
        const updated = (await (0, marketing_support_1.rows)(ctx.pool, 'UPDATE oshal_marketing_campaigns SET icp = $1::jsonb, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3 RETURNING *', [JSON.stringify(icp), String(campaign.campaign_id), sub]))[0];
        res.json({ campaign: updated, parsed: merged !== null && icp === merged });
    });
}
/**
 * @description POST /launch-checklist — launch-coordinator emits a checklist item (channel 'launch', human-posted).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function runLaunchChecklist(ctx, sub, req, res) {
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, String(req.body?.campaignId || ''));
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    await (0, marketing_bots_1.respondWithBot)(res, async () => {
        const text = await (0, marketing_bots_1.runMarketingBot)(ctx, marketing_support_1.LAUNCH_COORDINATOR_ID, 'launch', String(campaign.slug), sub, (0, marketing_bots_1.launchPrompt)(campaign));
        const item = await insertContent(ctx.pool, sub, {
            campaignId: String(campaign.campaign_id), channel: 'launch',
            title: `Launch checklist — ${String(campaign.name)}`.slice(0, 200), body: text,
        });
        res.status(201).json({ item });
    });
}
/**
 * @description GET /content — the caller's content items (board fodder), optional campaign filter.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function listContent(ctx, sub, req, res) {
    const campaignId = String(req.query.campaignId || '');
    const params = [sub];
    let where = 'user_sub = $1';
    if (campaignId) {
        if (!marketing_support_1.UUID_RE.test(campaignId)) {
            res.status(400).json({ error: 'invalid_campaign_id' });
            return;
        }
        params.push(campaignId);
        where += ` AND campaign_id = $${params.length}`;
    }
    const items = await (0, marketing_support_1.rows)(ctx.pool, `SELECT * FROM oshal_marketing_content WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
    res.json({ items });
}
/**
 * @description POST /content/:id/publish — the full consent→cap→confirm→rail→ledger chain.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
async function publishContent(ctx, sub, req, res) {
    const itemId = String(req.params.id || '');
    if (!marketing_support_1.UUID_RE.test(itemId)) {
        res.status(404).json({ error: 'content_not_found' });
        return;
    }
    const item = (await (0, marketing_support_1.rows)(ctx.pool, 'SELECT * FROM oshal_marketing_content WHERE item_id = $1 AND user_sub = $2', [itemId, sub]))[0];
    if (!item) {
        res.status(404).json({ error: 'content_not_found' });
        return;
    }
    if (!marketing_support_1.CHANNELS.includes(String(item.channel))) {
        res.status(400).json({ error: 'channel_not_publishable', hint: 'launch items are posted by a human, never by this endpoint.' });
        return;
    }
    if (item.status === 'published') {
        res.status(409).json({ error: 'already_published', ref: item.published_ref ?? null });
        return;
    }
    if (item.status === 'rejected') {
        res.status(409).json({ error: 'content_rejected' });
        return;
    }
    const channel = String(item.channel);
    const detailBase = { itemId, campaignId: item.campaign_id ?? null };
    const refusal = await (0, marketing_publish_1.gatePublish)(ctx, sub, channel, req.body);
    if (refusal) {
        await (0, marketing_support_1.recordRun)(ctx.pool, sub, channel, 'publish', refusal.outcome, { ...detailBase, reason: refusal.reason });
        res.status(refusal.status).json(refusal.payload);
        return;
    }
    const rail = await (0, marketing_publish_1.runPublishRail)(ctx, sub, item, (req.body ?? {}));
    if (!rail.ok) {
        await (0, marketing_support_1.recordRun)(ctx.pool, sub, channel, 'publish', 'error', { ...detailBase, error: rail.error ?? 'unknown' });
        res.status(rail.status).json({ error: rail.error, ...(rail.hint ? { hint: rail.hint } : {}) });
        return;
    }
    const updated = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_content SET status = 'published', published_ref = $1, updated_at = now()
     WHERE item_id = $2 AND user_sub = $3 RETURNING *`, [rail.ref ?? null, itemId, sub]))[0];
    await (0, marketing_support_1.recordRun)(ctx.pool, sub, channel, 'publish', 'published', { ...detailBase, ref: rail.ref ?? null });
    res.json({ item: updated, ref: rail.ref ?? null });
}
