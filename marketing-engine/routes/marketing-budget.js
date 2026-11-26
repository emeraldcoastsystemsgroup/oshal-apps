"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.8 P2 campaign-to-finance
 *     budget link and reallocation proposal routes under /api/marketing:
 *     POST /campaigns/:id/finance-project (owner-scoped link), GET /campaigns/:id/budget-summary
 *     (read-only campaign budget + optional linked Finance project summary), and
 *     POST /campaigns/:id/reallocation-proposals (runs reallocationProposals() over recorded
 *     or supplied channel costs and writes status='proposed' channel_allocation ledger rows).
 *     Mirrors migrations/009-marketing-finance-link.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBudgetLinkSchema = ensureBudgetLinkSchema;
exports.linkCampaignFinanceProject = linkCampaignFinanceProject;
exports.getCampaignBudgetSummary = getCampaignBudgetSummary;
exports.loadRecordedChannelMetrics = loadRecordedChannelMetrics;
exports.createReallocationLedgerProposal = createReallocationLedgerProposal;
exports.generateCampaignReallocationProposals = generateCampaignReallocationProposals;
exports.registerBudgetRoutes = registerBudgetRoutes;
const database_1 = require("@/shared/services/database");
const marketing_model_1 = require("./marketing-model");
const marketing_budget_model_1 = require("./marketing-budget-model");
const marketing_support_1 = require("./marketing-support");
/** Lazy-DDL mirror of migrations/009-marketing-finance-link.sql. */
const BUDGET_LINK_DDL = [
    'ALTER TABLE oshal_marketing_campaigns ADD COLUMN IF NOT EXISTS finance_project_id UUID',
    "ALTER TABLE oshal_marketing_campaigns ADD COLUMN IF NOT EXISTS channel_allocations JSONB NOT NULL DEFAULT '{}'",
    `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_campaigns_finance_project
    ON oshal_marketing_campaigns (user_sub, finance_project_id)
    WHERE finance_project_id IS NOT NULL`,
];
/**
 * @description Ensure the 009-marketing-finance-link columns on oshal_marketing_campaigns
 * at the lazy-DDL chokepoint.
 */
async function ensureBudgetLinkSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'marketing-budget',
        statements: BUDGET_LINK_DDL,
        requirements: [
            { table: 'oshal_marketing_campaigns', columns: ['finance_project_id', 'channel_allocations'] },
        ],
    });
}
/** Read owner-scoped linked finance project summary when Finance tables exist; degrade cleanly otherwise. */
async function readLinkedFinanceSummary(pool, sub, financeProjectId) {
    if (!financeProjectId || !marketing_support_1.UUID_RE.test(financeProjectId)) {
        return { available: false, summary: null };
    }
    try {
        const projRows = await (0, marketing_support_1.rows)(pool, `SELECT project_id, slug, name, currency, status, budget_cents, external_ref, notes
         FROM oshal_finance_projects
        WHERE project_id = $1 AND owner_sub = $2`, [financeProjectId, sub]);
        if (!projRows[0])
            return { available: true, summary: null };
        const [lineRows, actualRows] = await Promise.all([
            (0, marketing_support_1.rows)(pool, `SELECT line_id, project_id, name, channel, budget_cents, committed_cents
           FROM oshal_finance_project_lines
          WHERE project_id = $1 AND owner_sub = $2
          ORDER BY created_at ASC`, [financeProjectId, sub]),
            (0, marketing_support_1.rows)(pool, `SELECT actual_id, project_id, line_id, source, amount_cents, occurred_on
           FROM oshal_finance_project_actuals
          WHERE project_id = $1 AND owner_sub = $2
          ORDER BY occurred_on DESC, created_at DESC`, [financeProjectId, sub]),
        ]);
        return { available: true, summary: (0, marketing_budget_model_1.summarizeLinkedFinanceRows)(projRows[0], lineRows, actualRows) };
    }
    catch {
        return { available: false, summary: null };
    }
}
/**
 * @description POST /campaigns/:id/finance-project — link an existing or newly created Finance
 * project UUID onto a caller-owned campaign.
 */
async function linkCampaignFinanceProject(ctx, sub, req, res) {
    const campaignId = String(req.params.id || '');
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, campaignId);
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    const b = (req.body ?? {});
    const rawPid = b.financeProjectId ?? b.finance_project_id ?? b.projectId;
    const financeProjectId = typeof rawPid === 'string' ? rawPid.trim() : '';
    if (!marketing_support_1.UUID_RE.test(financeProjectId)) {
        res.status(400).json({ error: 'invalid_finance_project_id', message: 'financeProjectId must be a valid UUID.' });
        return;
    }
    const updated = (await (0, marketing_support_1.rows)(ctx.pool, `UPDATE oshal_marketing_campaigns
        SET finance_project_id = $1, updated_at = now()
      WHERE campaign_id = $2 AND user_sub = $3
      RETURNING *`, [financeProjectId, campaignId, sub]))[0];
    const payload = (0, marketing_budget_model_1.buildBudgetProjectPayload)(updated || campaign);
    res.json({
        campaign: updated,
        financeProjectId,
        budgetPayload: payload.ok ? payload.value : null,
    });
}
/**
 * @description GET /campaigns/:id/budget-summary — read-only campaign budget, channel allocations,
 * create-budget payload, and optional live Finance project summary.
 */
async function getCampaignBudgetSummary(ctx, sub, req, res) {
    const campaignId = String(req.params.id || '');
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, campaignId);
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    const financeProjectId = campaign.finance_project_id ? String(campaign.finance_project_id) : null;
    const channelAllocations = (0, marketing_budget_model_1.normalizeChannelAllocations)(campaign.channel_allocations);
    const payload = (0, marketing_budget_model_1.buildBudgetProjectPayload)(campaign);
    const linked = await readLinkedFinanceSummary(ctx.pool, sub, financeProjectId);
    res.json({
        campaignId,
        financeProjectId,
        budgetMonthlyUsd: Number(campaign.budget_monthly_usd ?? 0),
        budgetCents: (0, marketing_budget_model_1.usdToCents)(campaign.budget_monthly_usd) ?? 0,
        channelAllocations,
        budgetPayload: payload.ok ? payload.value : null,
        financeAvailable: linked.available,
        linkedSummary: linked.summary,
    });
}
/** Load recorded channel spend (cents) from a linked Finance project's actuals when available. */
async function loadFinanceProjectSpendByChannel(pool, sub, financeProjectId, spendCentsByChannel) {
    if (!financeProjectId || !marketing_support_1.UUID_RE.test(financeProjectId))
        return;
    try {
        const actualRows = await (0, marketing_support_1.rows)(pool, `SELECT COALESCE(l.channel, 'general') AS channel, SUM(a.amount_cents)::bigint AS spend_cents
         FROM oshal_finance_project_actuals a
         LEFT JOIN oshal_finance_project_lines l
           ON l.line_id = a.line_id AND l.owner_sub = a.owner_sub
        WHERE a.owner_sub = $1 AND a.project_id = $2
        GROUP BY COALESCE(l.channel, 'general')`, [sub, financeProjectId]);
        for (const r of actualRows) {
            const ch = (0, marketing_budget_model_1.normalizeChannelKey)(r.channel);
            const cents = Number(r.spend_cents ?? 0);
            if (ch && Number.isSafeInteger(cents) && cents > 0) {
                spendCentsByChannel[ch] = (spendCentsByChannel[ch] ?? 0) + cents;
            }
        }
    }
    catch {
        // Finance tables optional; continue with marketing_events only.
    }
}
/** Load recorded channel spend (cents) and conversions for one campaign from Finance actuals + marketing events. */
async function loadRecordedChannelMetrics(pool, sub, campaign) {
    const spendCentsByChannel = {};
    const conversionsByChannel = {};
    const financeProjectId = campaign.finance_project_id ? String(campaign.finance_project_id) : null;
    await loadFinanceProjectSpendByChannel(pool, sub, financeProjectId, spendCentsByChannel);
    const slug = typeof campaign.slug === 'string' ? campaign.slug : '';
    if (slug) {
        const eventRows = await (0, marketing_support_1.safeRows)(pool, `SELECT medium, source, event, value FROM oshal_marketing_events
        WHERE user_sub = $1 AND campaign_slug = $2`, [sub, slug]);
        for (const ev of eventRows) {
            const ch = (0, marketing_budget_model_1.normalizeChannelKey)(ev.medium || ev.source);
            const val = Number(ev.value ?? 0);
            if (!ch || !Number.isFinite(val) || val <= 0)
                continue;
            const evName = String(ev.event || '').toLowerCase();
            if (evName === 'spend' || evName === 'cost' || evName === 'ad_spend') {
                spendCentsByChannel[ch] = (spendCentsByChannel[ch] ?? 0) + Math.round(val * 100);
            }
            else if (evName === 'conversion' || evName === 'conversions' || evName === 'signup' || evName === 'purchase') {
                conversionsByChannel[ch] = (conversionsByChannel[ch] ?? 0) + val;
            }
        }
    }
    return { spendCentsByChannel, conversionsByChannel };
}
/** Validate optional caller-supplied channel cost metrics for reallocation proposals. */
function parseSuppliedChannelMetrics(raw) {
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            return null;
        const rec = item;
        const ch = (0, marketing_budget_model_1.normalizeChannelKey)(rec.channel);
        const spendUsd = rec.spendCents !== undefined
            ? (Number(rec.spendCents) / 100)
            : Number(rec.spendUsd ?? rec.spend_usd);
        const conversions = Number(rec.conversions ?? 0);
        const allocationUsd = rec.allocationCents !== undefined
            ? (Number(rec.allocationCents) / 100)
            : Number(rec.allocationUsd ?? rec.allocation_usd ?? spendUsd);
        if (!ch || !Number.isFinite(spendUsd) || spendUsd < 0 || !Number.isFinite(conversions) || conversions < 0 || !Number.isFinite(allocationUsd) || allocationUsd < 0) {
            return null;
        }
        out.push({ channel: ch, spendUsd, conversions, allocationUsd });
    }
    return out;
}
/**
 * @description Persist a recommended donor->recipient reallocation move as a single `proposed`
 * ledger row (`field = 'channel_allocation'`) carrying exact integer-cent allocations.
 */
async function createReallocationLedgerProposal(pool, sub, campaign, channelPerf, opts) {
    const recommendations = (0, marketing_model_1.reallocationProposals)({
        channels: channelPerf,
        maxShiftPct: opts.maxShiftPct,
        floorUsd: opts.floorUsd,
    });
    if (recommendations.length < 2)
        return { proposal: null, recommendations: [] };
    const [donor, recipient] = recommendations;
    const deltaCents = Math.round((donor.oldValue - donor.newValue) * 100);
    if (!Number.isSafeInteger(deltaCents) || deltaCents <= 0)
        return { proposal: null, recommendations: [] };
    const baseAlloc = (0, marketing_budget_model_1.normalizeChannelAllocations)(campaign.channel_allocations);
    for (const item of channelPerf) {
        if (!(item.channel in baseAlloc)) {
            const c = (0, marketing_budget_model_1.usdToCents)(item.allocationUsd);
            if (c !== null)
                baseAlloc[item.channel] = c;
        }
    }
    const nextAlloc = (0, marketing_budget_model_1.applyChannelAllocationMap)(baseAlloc, {
        kind: 'transfer',
        fromChannel: donor.channel,
        toChannel: recipient.channel,
        deltaCents,
    });
    if (!nextAlloc.ok)
        return { proposal: null, recommendations: [] };
    const oldSnapshot = {
        [donor.channel]: baseAlloc[donor.channel] ?? Math.round(donor.oldValue * 100),
        [recipient.channel]: baseAlloc[recipient.channel] ?? Math.round(recipient.oldValue * 100),
    };
    const newPayload = {
        fromChannel: donor.channel,
        toChannel: recipient.channel,
        deltaCents,
        allocations: nextAlloc.value.allocations,
        rationale: `${donor.rationale}; ${recipient.rationale}`,
    };
    const inserted = (await (0, marketing_support_1.rows)(pool, `INSERT INTO oshal_marketing_budget_ledger
       (user_sub, campaign_id, channel, field, old_value, new_value, status, proposed_by)
     VALUES ($1,$2,$3,'channel_allocation',$4,$5,'proposed',$6)
     RETURNING *`, [
        sub,
        String(campaign.campaign_id),
        `${donor.channel}->${recipient.channel}`,
        JSON.stringify(oldSnapshot),
        JSON.stringify(newPayload),
        opts.proposedBy || 'reallocation-advisor',
    ]))[0];
    return { proposal: inserted ?? null, recommendations };
}
/**
 * @description POST /campaigns/:id/reallocation-proposals — run reallocationProposals() over the
 * campaign's recorded channel costs/conversions (or validated supplied channel metrics) and write
 * any recommendation as a `status = 'proposed'` row with `field = 'channel_allocation'`.
 */
async function generateCampaignReallocationProposals(ctx, sub, req, res) {
    const campaignId = String(req.params.id || '');
    const campaign = await (0, marketing_support_1.loadCampaign)(ctx.pool, sub, campaignId);
    if (!campaign) {
        res.status(404).json({ error: 'campaign_not_found' });
        return;
    }
    const b = (req.body ?? {});
    let channelPerf;
    if (b.channels !== undefined) {
        const parsed = parseSuppliedChannelMetrics(b.channels);
        if (!parsed) {
            res.status(400).json({ error: 'invalid_channel_metrics', message: 'channels must be an array of { channel, spendUsd|spendCents, conversions, allocationUsd|allocationCents }.' });
            return;
        }
        channelPerf = parsed;
    }
    else {
        const recorded = await loadRecordedChannelMetrics(ctx.pool, sub, campaign);
        channelPerf = (0, marketing_budget_model_1.buildChannelPerformanceInputs)({ campaign, ...recorded });
    }
    const maxShiftPct = b.maxShiftPct !== undefined ? Number(b.maxShiftPct) : undefined;
    const floorUsd = b.floorUsd !== undefined ? Number(b.floorUsd) : undefined;
    const { proposal, recommendations } = await createReallocationLedgerProposal(ctx.pool, sub, campaign, channelPerf, { maxShiftPct, floorUsd, proposedBy: 'reallocation-advisor' });
    if (!proposal) {
        res.json({ proposed: false, proposals: [], recommendations: [] });
        return;
    }
    res.status(201).json({ proposed: true, proposals: [proposal], recommendations });
}
/**
 * @description Register P2 campaign-to-finance-project and reallocation proposal routes under /api/marketing.
 */
function registerBudgetRoutes(router, ctx) {
    ensureBudgetLinkSchema(ctx.pool).catch((err) => marketing_support_1.logger.error({ err }, 'Failed to ensure marketing-engine budget link schema'));
    router.post('/campaigns/:id/finance-project', (0, marketing_support_1.authed)(ctx, linkCampaignFinanceProject));
    router.get('/campaigns/:id/budget-summary', (0, marketing_support_1.authed)(ctx, getCampaignBudgetSummary));
    router.post('/campaigns/:id/reallocation-proposals', (0, marketing_support_1.authed)(ctx, generateCampaignReallocationProposals));
}
