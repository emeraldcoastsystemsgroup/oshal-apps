"use strict";
/**
 * Venture Plan - service-authenticated scheduled rebaseline tick.
 *
 * The same deterministic worker is reachable through the service-authenticated route and the
 * manifest's named service-route schedule handler. Neither path is a prompt. HTTP callers must
 * hold service auth; the active manifest registry is the schedule handler's lifecycle authority.
 * Exact execute=true crosses only the outer tick gate and never overrides owner policy.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add system-identity policy evaluation, default dry-run tick semantics, sanitized results, and explicit paid execution dispatch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Export the bounded deterministic manifest schedule handler and share one awaited schema bootstrap with the service route.
 *
 * @module venture-rebaseline-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueRebaselineTick = runDueRebaselineTick;
exports.runScheduledRebaselineTick = runScheduledRebaselineTick;
exports.createVentureRebaselineRoutes = createVentureRebaselineRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const request_identity_1 = require("@/shared/services/database/request-identity");
const venture_rebaseline_1 = require("./venture-rebaseline");
const venture_run_1 = require("./venture-run");
const venture_store_rebaseline_1 = require("./venture-store-rebaseline");
const venture_schema_1 = require("./venture-schema");
const log = (0, logger_1.createChildLogger)({ module: 'venture-rebaseline-routes' });
let schemaReady = null;
const defaultDependencies = {
    listPolicies: (ctx) => (0, venture_store_rebaseline_1.listEnabledRebaselinePoliciesSystem)(ctx.pool),
    start: venture_run_1.startScheduledRebaseline,
    withSystemIdentity: request_identity_1.runWithSystemIdentity,
};
/**
 * Evaluate all enabled policies and optionally start due work. Disabled and
 * dry-run decisions cannot reach the injected start boundary, which is the
 * testable proof that preview mode performs no writes or bot calls.
 */
async function runDueRebaselineTick(ctx, input, dependencies = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    // Validate before opening system scope or touching the database.
    (0, venture_rebaseline_1.evaluateRebaselinePolicy)((0, venture_rebaseline_1.defaultRebaselinePolicy)('timestamp-check'), input.atIso, true);
    return deps.withSystemIdentity(async () => {
        const policies = await deps.listPolicies(ctx);
        const results = [];
        for (const policy of policies) {
            let slot = null;
            try {
                const decision = (0, venture_rebaseline_1.evaluateRebaselinePolicy)(policy, input.atIso, input.execute !== true);
                slot = decision.slot;
                if (!decision.wouldStart || !decision.slot) {
                    results.push({
                        ventureId: policy.ventureId, outcome: decision.outcome, slot: decision.slot,
                    });
                    continue;
                }
                const opened = await deps.start(ctx, policy.ownerSub, policy.ventureId, decision.slot, decision.onDate, decision.maxCostMicros);
                results.push({
                    ventureId: policy.ventureId,
                    outcome: opened.alreadyScheduled ? 'already-scheduled'
                        : opened.alreadyRunning ? 'already-running' : 'started',
                    slot: decision.slot,
                    runId: opened.runId,
                });
            }
            catch (err) {
                log.error({
                    err, stack: err?.stack, ventureId: policy.ventureId, slot,
                }, 'scheduled rebaseline dispatch failed');
                results.push({
                    ventureId: policy.ventureId, outcome: 'error', slot,
                    error: err instanceof venture_rebaseline_1.RebaselineError ? err.code : 'rebaseline_dispatch_failed',
                });
            }
        }
        return results;
    });
}
/**
 * Named deterministic schedule export declared in oshal-app.yaml. The kernel freezes the static
 * body before dispatch and validates this export at activation. The result is deliberately
 * aggregate-only so owner subjects and per-venture details never enter scheduler metadata.
 */
async function runScheduledRebaselineTick(ctx, input) {
    await ensureRebaselineSchema(ctx);
    const atIso = typeof input.body.atIso === 'string' ? input.body.atIso : input.scheduledAtIso;
    const execute = input.body.execute === true;
    const results = await runDueRebaselineTick(ctx, { atIso, execute });
    const started = results.filter((result) => result.outcome === 'started').length;
    const errors = results.filter((result) => result.outcome === 'error').length;
    return { summary: `evaluated=${results.length}; started=${started}; errors=${errors}` };
}
/** Build the service-authenticated `/api/venture-rebaseline` router. */
function createVentureRebaselineRoutes(ctx) {
    const router = (0, express_1.Router)();
    void ensureRebaselineSchema(ctx).catch((err) => log.error({
        err, stack: err?.stack,
    }, 'venture rebaseline schema bootstrap failed'));
    router.post('/tick', async (req, res) => {
        const startedAt = Date.now();
        const body = (req.body ?? {});
        const atIso = typeof body.atIso === 'string' ? body.atIso : new Date().toISOString();
        const execute = body.execute === true;
        try {
            const results = await runDueRebaselineTick(ctx, { atIso, execute });
            log.info({ execute, evaluated: results.length, durationMs: Date.now() - startedAt }, 'venture rebaseline tick complete');
            res.json({ mode: execute ? 'execute' : 'dry-run', atIso, results });
        }
        catch (err) {
            log.error({ err, stack: err?.stack, durationMs: Date.now() - startedAt }, 'venture rebaseline tick refused');
            if (err instanceof venture_rebaseline_1.RebaselineError) {
                res.status(400).json({ error: err.code, detail: err.message });
                return;
            }
            res.status(500).json({ error: 'rebaseline_tick_failed' });
        }
    });
    return router;
}
/** Bootstrap the package schema once per loaded module and share failures with every caller. */
function ensureRebaselineSchema(ctx) {
    schemaReady ??= (0, venture_schema_1.ensureVentureSchema)(ctx.pool);
    return schemaReady;
}
//# sourceMappingURL=venture-rebaseline-routes.js.map