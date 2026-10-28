"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPortfolioPlanRoutes = registerPortfolioPlanRoutes;
const trading_portfolio_model_1 = require("./trading-portfolio-model");
const trading_portfolio_sim_1 = require("./trading-portfolio-sim");
const trading_portfolio_history_1 = require("./trading-portfolio-history");
const trading_portfolio_rotation_1 = require("./trading-portfolio-rotation");
const trading_portfolio_calendar_1 = require("./trading-portfolio-calendar");
const trading_portfolio_plan_1 = require("./trading-portfolio-plan");
const trading_portfolio_plan_evidence_1 = require("./trading-portfolio-plan-evidence");
const trading_portfolio_store_1 = require("./trading-portfolio-store");
const busy = new Set();
function bodyFields(body, allowed) {
    if (Object.keys(body).some(k => ![...allowed, 'book', 'mode'].includes(k)))
        throw new trading_portfolio_model_1.PortfolioError(400, 'plan_input_invalid', 'Only the saved study, holdings scope and exact confirmation fields can be supplied. Account facts, quotes, limits and target quantities are server-derived.');
}
async function retainedEvidence(ctx, owner, plan) {
    const snapshot = await (0, trading_portfolio_store_1.getRecord)(ctx, owner, 'plan-evidence', plan.evidence.snapshotId);
    const { id, createdAt, ...data } = snapshot;
    if ((0, trading_portfolio_store_1.fingerprint)(data) !== plan.evidence.snapshotFingerprint)
        throw new trading_portfolio_model_1.PortfolioError(409, 'plan_evidence_changed', 'The retained preview evidence no longer matches its fingerprint.');
    return data;
}
/** Routes inherit the parent authenticated owner boundary; none exposes an execute operation. */
function registerPortfolioPlanRoutes(route, ctx, deps) {
    route('get', '/portfolio/plans', async (_req, owner, at) => {
        const [plans, approvals] = await Promise.all([(0, trading_portfolio_store_1.listRecords)(ctx, owner, 'plan', 20), (0, trading_portfolio_store_1.listRecords)(ctx, owner, 'plan-approval')]);
        const approved = new Map(approvals.map(a => [a.planId, a]));
        return { plans: plans.slice(0, 100).map(p => { const a = approved.get(p.id); const { evidence, ...view } = p; return { ...view, status: a ? 'planning-approved' : at.getTime() >= Date.parse(p.expiresAt) ? 'expired' : p.status, approval: a ? { id: a.id, approvedAt: a.approvedAt } : null }; }), executionAvailable: false, recentLimit: 20 };
    });
    route('post', '/portfolio/plans', async (req, owner, at) => {
        const b = req.body || {};
        bodyFields(b, ['runId', 'scope']);
        if (busy.has(owner))
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_preview_running', 'Another preview is collecting your current account evidence.');
        const run = await (0, trading_portfolio_store_1.getRecord)(ctx, owner, 'run', b.runId);
        if (run.status !== 'completed' || !run.evidenceFingerprint)
            throw new trading_portfolio_model_1.PortfolioError(422, 'completed_backtest_required', 'Select a completed, source-backed historical study before previewing a rebalance.');
        const config = (0, trading_portfolio_sim_1.normalizePortfolioStrategy)(run.strategy.config), initial = await deps.selected(owner, run, at), scope = (b.scope ?? 'preserve-other-holdings');
        if (!['preserve-other-holdings', 'whole-account'].includes(scope))
            throw new trading_portfolio_model_1.PortfolioError(400, 'plan_scope_invalid', 'Choose which holdings the preview may rebalance.');
        const connection = initial.account.kind === 'outside' ? initial.native.accounts[0]?.connectionKey : initial.account.connectionKey;
        if (!connection)
            throw new trading_portfolio_model_1.PortfolioError(422, 'plan_connection_required', 'A caller-owned Schwab connection is required for measured preview prices.');
        const symbols = (0, trading_portfolio_plan_evidence_1.planSymbols)(initial.account, config), latest = (0, trading_portfolio_calendar_1.lastCompletedSession)(at), start = new Date(Date.parse(latest + 'T00:00:00Z') - 110 * 86400000).toISOString().slice(0, 10);
        busy.add(owner);
        try {
            const [historical, quoted] = await Promise.allSettled([(0, trading_portfolio_history_1.portfolioHistory)(ctx, connection, config, start, (0, trading_portfolio_rotation_1.portfolioSignalHistoryEnd)(config, latest), at), (0, trading_portfolio_plan_evidence_1.readPlanQuotes)(ctx, connection, symbols)]);
            if (historical.status === 'rejected')
                throw historical.reason;
            if (quoted.status === 'rejected')
                throw quoted.reason;
            const history = historical.value, quoteEvidence = quoted.value;
            const created = deps.clock();
            if ((0, trading_portfolio_calendar_1.lastCompletedSession)(created) !== latest)
                throw new trading_portfolio_model_1.PortfolioError(409, 'signal_session_changed', 'A new session completed while reading evidence. Prepare a fresh preview.');
            const current = await deps.selected(owner, run, created), currentSymbols = (0, trading_portfolio_plan_evidence_1.planSymbols)(current.account, config);
            if ((0, trading_portfolio_store_1.fingerprint)(currentSymbols) !== (0, trading_portfolio_store_1.fingerprint)(symbols))
                throw new trading_portfolio_model_1.PortfolioError(409, 'holdings_changed', 'The instrument roster changed while reading prices. Prepare a fresh preview.');
            const signal = (0, trading_portfolio_sim_1.portfolioNextTargets)(config, history.series, latest);
            const result = (0, trading_portfolio_plan_1.buildRebalancePlan)({ account: current.account, profile: current.profile, config, targets: signal.targets, signalAsOf: latest, quotes: quoteEvidence.quotes, scope, now: created });
            const snapshot = { accountSnapshot: current.account, profileSnapshot: current.profile ?? null, history, quoteEvidence, targets: signal.targets, signalDecisionAsOf: signal.decisionAsOf, signalEvidenceThrough: history.requestedEndDate, rebalanceCadence: signal.rebalanceCadence };
            const snapshotRecord = await (0, trading_portfolio_store_1.saveRecord)(ctx, owner, 'plan-evidence', snapshot);
            const data = { ...result, signalDecisionAsOf: signal.decisionAsOf, signalEvidenceThrough: history.requestedEndDate, rebalanceCadence: signal.rebalanceCadence, constraints: current.constraints, accountId: run.accountId, connectionKey: run.connectionKey, accountLabel: current.profile?.label || current.account.label || current.account.accountMasked,
                strategyId: run.strategyId, strategyName: run.strategy.name, strategyFingerprint: (0, trading_portfolio_store_1.fingerprint)(config), runId: run.id, runEvidenceFingerprint: run.evidenceFingerprint,
                backtest: { window: run.result.window, metrics: run.result.metrics }, portfolioCoverage: current.report.coverage,
                evidence: { accountWitness: deps.witness(current.account, current.profile), snapshotId: snapshotRecord.id, snapshotFingerprint: (0, trading_portfolio_store_1.fingerprint)(snapshot), quoteEvidence, targets: signal.targets } };
            const plan = await (0, trading_portfolio_store_1.saveRecord)(ctx, owner, 'plan', { ...data, fingerprint: (0, trading_portfolio_store_1.fingerprint)(data) });
            return { plan: { ...plan, evidence: { ...plan.evidence, ...snapshot } } };
        }
        finally {
            busy.delete(owner);
        }
    });
    route('get', '/portfolio/plans/:id', async (req, owner) => {
        const plan = await (0, trading_portfolio_store_1.getRecord)(ctx, owner, 'plan', req.params.id), data = await retainedEvidence(ctx, owner, plan);
        return { plan: { ...plan, evidence: { ...plan.evidence, ...data } } };
    });
    route('post', '/portfolio/plans/:id/approve', async (req, owner, at) => {
        const b = req.body || {};
        bodyFields(b, ['confirm', 'fingerprint', 'acknowledgePlanningExceptions', 'acknowledgeUnmanagedSales']);
        const plan = await (0, trading_portfolio_store_1.getRecord)(ctx, owner, 'plan', req.params.id);
        if (b.confirm !== true || b.fingerprint !== plan.fingerprint)
            throw new trading_portfolio_model_1.PortfolioError(428, 'exact_plan_confirmation_required', 'Confirm the exact displayed buy/sell planning preview. Research-envelope approval cannot approve this plan.');
        if (at.getTime() >= Date.parse(plan.expiresAt))
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_expired', 'This planning preview expired. Collect fresh account and quote evidence.');
        if (plan.status !== 'pending-review' || plan.blockers.length)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_facts_blocked', 'The preview has unresolved facts or no actions. Planning exceptions cannot override these blockers.');
        if (plan.requiresPlanningExceptionAcknowledgement && b.acknowledgePlanningExceptions !== true)
            throw new trading_portfolio_model_1.PortfolioError(428, 'planning_exceptions_required', 'Explicitly acknowledge the exact dollar/share/exposure planning-cap exceptions. No live limit changes.');
        if (plan.requiresUnmanagedSalesAcknowledgement && b.acknowledgeUnmanagedSales !== true)
            throw new trading_portfolio_model_1.PortfolioError(428, 'unmanaged_sales_confirmation_required', 'Explicitly review sales of holdings OSHAL does not manage, including names outside the strategy.');
        await retainedEvidence(ctx, owner, plan);
        const current = await deps.selected(owner, plan, at);
        if (deps.witness(current.account, current.profile) !== plan.evidence.accountWitness)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_account_changed', 'Account balances, holdings or category changed. Prepare a fresh preview.');
        if ((0, trading_portfolio_calendar_1.lastCompletedSession)(at) !== plan.signalAsOf)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_signal_changed', 'The completed signal session changed. Prepare a fresh preview.');
        const run = await (0, trading_portfolio_store_1.getRecord)(ctx, owner, 'run', plan.runId), config = (0, trading_portfolio_sim_1.normalizePortfolioStrategy)(run.strategy.config);
        if (run.evidenceFingerprint !== plan.runEvidenceFingerprint || (0, trading_portfolio_store_1.fingerprint)(config) !== plan.strategyFingerprint)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_study_changed', 'The study evidence no longer matches this planning preview.');
        const symbols = (0, trading_portfolio_plan_evidence_1.planSymbols)(current.account, config), quotes = await (0, trading_portfolio_plan_evidence_1.readPlanQuotes)(ctx, plan.evidence.quoteEvidence.connection, symbols), checked = deps.clock();
        if (checked.getTime() >= Date.parse(plan.expiresAt) || (0, trading_portfolio_calendar_1.lastCompletedSession)(checked) !== plan.signalAsOf)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_expired', 'The preview expired or its signal session changed while checking evidence.');
        const fresh = (0, trading_portfolio_plan_1.buildRebalancePlan)({ account: current.account, profile: current.profile, config, targets: plan.evidence.targets, signalAsOf: plan.signalAsOf, quotes: quotes.quotes, scope: plan.scope, now: checked });
        if (fresh.blockers.length)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_facts_changed', 'Fresh quote or funding checks failed. Prepare a fresh preview.');
        const priceRows = (rows) => rows.map(r => ({ symbol: r.symbol, price: r.referencePrice, qty: r.changeQty }));
        if ((0, trading_portfolio_store_1.fingerprint)(priceRows(fresh.rows)) !== (0, trading_portfolio_store_1.fingerprint)(priceRows(plan.rows)))
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_prices_changed', 'Reference prices or quantities changed. Review the newly priced preview before approval.');
        const finalAccount = await deps.selected(owner, plan, checked);
        if (deps.witness(finalAccount.account, finalAccount.profile) !== plan.evidence.accountWitness)
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_account_changed', 'The account changed during quote verification. Prepare a fresh preview.');
        if (deps.clock().getTime() >= Date.parse(plan.expiresAt))
            throw new trading_portfolio_model_1.PortfolioError(409, 'plan_expired', 'This preview expired during final account verification.');
        const existing = (await (0, trading_portfolio_store_1.listRecords)(ctx, owner, 'plan-approval')).find(a => a.planId === plan.id);
        if (existing)
            return { approval: existing, realOrdersPlaced: 0, borrowingAuthorized: false, liveLimitsChanged: false };
        const approval = await (0, trading_portfolio_store_1.savePlanApprovalOnce)(ctx, owner, plan.id, { planId: plan.id, planFingerprint: plan.fingerprint, status: 'planning-approved', approvedAt: checked.toISOString(),
            acknowledgedPlanningExceptions: b.acknowledgePlanningExceptions === true ? plan.planningExceptions : [], acknowledgedUnmanagedSales: b.acknowledgeUnmanagedSales === true,
            accountWitness: plan.evidence.accountWitness, quoteCheck: quotes, realOrdersPlaced: 0, borrowingAuthorized: false, liveLimitsChanged: false,
            purpose: 'Acknowledges this specific planning preview only. It creates no broker order, borrowing authority, live strategy application or changed risk limit.' });
        return { approval, realOrdersPlaced: 0, borrowingAuthorized: false, liveLimitsChanged: false };
    });
}
