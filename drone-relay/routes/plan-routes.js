"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The plan router the tile, the concierge's tools and any MCP
 *                     |                             | client all drive: plans (preview without saving, create,
 *                     |                             | list, read, replace the spec, delete), a scenario run that is
 *                     |                             | stored as the plan's last run (refused on an infeasible
 *                     |                             | plan), the generated design write-up, and a hop-by-hop trace
 *                     |                             | of one signed envelope through the chain (the protocol, shown
 *                     |                             | rather than described). Every input validates against the
 *                     |                             | engine's contract first and a refusal names the field.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Trees (B5): a spec with `branches` previews, saves and runs
 *                     |                             | through the same routes; the trace walks the trunk and the
 *                     |                             | branch its destination lies on (default tip1 on a tree).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | POST /plans/:id/fleet-mission (B6): the saved formation as a
 *                     |                             | Drone Ops fleet-mission DRAFT from the base's latitude and
 *                     |                             | longitude — computed and returned, never stored, never sent,
 *                     |                             | never executed here; 409 on an infeasible plan.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicPlan = publicPlan;
exports.createPlanRoutes = createPlanRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engine_1 = require("./engine");
const plan_store_1 = require("./plan-store");
const logger = (0, logger_1.createChildLogger)({ module: 'drone-relay-plan-routes' });
const BASE = '/api/drone-relay';
/**
 * @description The plan as the API returns it: the row plus its roster and the write-up's URL.
 * @param row - The stored plan.
 * @returns The public shape.
 */
function publicPlan(row) {
    return { ...row, roster: (0, engine_1.rosterIds)(row.plan), designUrl: `${BASE}/plans/${row.plan_id}/design.md` };
}
function refuse(res, error) {
    if (error instanceof engine_1.SpecError) {
        res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message });
        return true;
    }
    if (error instanceof RangeError) {
        res.status(400).json({ error: 'invalid_id', message: error.message });
        return true;
    }
    return false;
}
/** The spec body: either `{ spec: {...} }` or the fields at the top level (tool calls send them flat). */
function specBody(body) {
    const b = body && typeof body === 'object' ? body : {};
    if (b.spec && typeof b.spec === 'object')
        return { ...b.spec, ...(typeof b.title === 'string' ? { title: b.title } : {}) };
    const { planId: _p, scenario: _s, ...rest } = b;
    return rest;
}
/** One envelope walked through its route; the decisions a real relay would make at each node. */
function traceEnvelope(signed) {
    const trace = [];
    let env = signed;
    for (let guard = 0; guard < 32; guard += 1) {
        const node = env.route[env.hop];
        const decision = (0, engine_1.decideForward)(env, node);
        trace.push({ node, hop: env.hop, ttl: env.ttl, ...decision });
        if (decision.action !== 'forward')
            break;
        env = (0, engine_1.advance)(env);
    }
    return trace;
}
function registerPlanCrud(router, deps) {
    router.post('/plan-preview', (req, res) => {
        try {
            const spec = (0, engine_1.validateSpec)(specBody(req.body));
            res.json({ spec, sized: (0, engine_1.planChain)(spec) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.get('/plans', async (req, res) => {
        const plans = await (0, plan_store_1.listPlans)(deps.pool, req.relaySub);
        res.json({ plans: plans.map((p) => publicPlan(p)) });
    });
    router.post('/plans', async (req, res) => {
        try {
            const spec = (0, engine_1.validateSpec)(specBody(req.body));
            const row = await (0, plan_store_1.createPlan)(deps.pool, req.relaySub, { title: spec.title, spec, plan: (0, engine_1.planChain)(spec) });
            logger.info({ planId: row.plan_id, transport: spec.transport, relays: row.plan.relaysNeeded, feasible: row.plan.feasible }, 'Relay plan created');
            res.status(201).json({ plan: publicPlan(row) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.get('/plans/:planId', (req, res) => { res.json({ plan: publicPlan(req.relayPlan) }); });
    router.patch('/plans/:planId', async (req, res) => {
        try {
            const current = req.relayPlan;
            const spec = (0, engine_1.validateSpec)({ ...current.spec, ...specBody(req.body) });
            const row = await (0, plan_store_1.updatePlan)(deps.pool, req.relaySub, current.plan_id, { title: spec.title, spec, plan: (0, engine_1.planChain)(spec) });
            if (!row) {
                res.status(404).json({ error: 'plan_not_found' });
                return;
            }
            res.json({ plan: publicPlan(row) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.delete('/plans/:planId', async (req, res) => {
        const gone = await (0, plan_store_1.deletePlan)(deps.pool, req.relaySub, req.relayPlan.plan_id);
        res.status(gone ? 200 : 404).json(gone ? { deleted: true } : { error: 'plan_not_found' });
    });
}
function registerPlanActions(router, deps) {
    router.post('/plans/:planId/simulate', async (req, res) => {
        const row = req.relayPlan;
        try {
            if (!row.plan.feasible) {
                res.status(409).json({ error: 'plan_not_feasible', reasons: row.plan.reasons });
                return;
            }
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const scenario = (0, engine_1.validateScenario)(body.scenario ?? body, row.plan);
            const started = Date.now();
            const run = (0, engine_1.simulate)(row.spec, row.plan, scenario);
            const saved = await (0, plan_store_1.saveRun)(deps.pool, req.relaySub, row.plan_id, run);
            logger.info({ planId: row.plan_id, verdict: run.metrics.verdict, outageS: run.metrics.tipOutageS, ms: Date.now() - started }, 'Relay scenario simulated');
            res.json({ run, plan: saved ? publicPlan(saved) : publicPlan(row) });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.post('/plans/:planId/fleet-mission', (req, res) => {
        const row = req.relayPlan;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        if (!row.plan.feasible) {
            res.status(409).json({ error: 'plan_not_feasible', reasons: row.plan.reasons });
            return;
        }
        try {
            res.json({ ...(0, engine_1.formationDraft)(row.spec, row.plan, body.home, body.drones), target: 'drone', executes: false });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
    router.get('/plans/:planId/design.md', (req, res) => {
        const row = req.relayPlan;
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/markdown').send((0, engine_1.designMarkdown)(row.spec, row.plan, row.last_sim));
    });
    router.post('/plans/:planId/trace', (req, res) => {
        const row = req.relayPlan;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const dst = typeof body.dst === 'string' ? body.dst : row.plan.tree ? 'tip1' : 'tip';
        const order = (0, engine_1.chainOrderTo)(row.plan, dst);
        const kind = body.kind === 'heartbeat' || body.kind === 'reply' ? body.kind : 'command';
        try {
            const route = (0, engine_1.routeThrough)(order, dst, kind === 'command' ? 'outward' : 'inward');
            const payload = body.payload ?? { id: 'demo', command: 'hold', args: {} };
            const signed = (0, engine_1.signEnvelope)((0, engine_1.buildEnvelope)({ kind, route, payload, ts: Date.now(), id: `demo-${row.plan_id.slice(0, 8)}` }), row.plan_id);
            res.json({ envelope: signed, trace: traceEnvelope(signed), verifiedAtDestination: (0, engine_1.verifyEnvelope)(signed, row.plan_id), replyRoute: route.slice().reverse(), keyNote: 'signed with the plan id as a stand-in for the pair key a node receives at enrolment' });
        }
        catch (error) {
            if (!refuse(res, error))
                throw error;
        }
    });
}
/**
 * @description Build the plan router (mounted under the package's oidc mount).
 * @param deps - Pool and caller resolver.
 * @returns The router.
 */
function createPlanRoutes(deps) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        req.relaySub = sub;
        next();
    });
    router.param('planId', async (req, res, next, value) => {
        try {
            const row = await (0, plan_store_1.getPlan)(deps.pool, req.relaySub, (0, plan_store_1.requireUuid)(value));
            if (!row) {
                res.status(404).json({ error: 'plan_not_found' });
                return;
            }
            req.relayPlan = row;
            next();
        }
        catch (error) {
            if (!refuse(res, error)) {
                logger.error({ err: error }, 'Load plan failed');
                res.status(500).json({ error: 'load_failed' });
            }
        }
    });
    registerPlanCrud(router, deps);
    registerPlanActions(router, deps);
    return router;
}
//# sourceMappingURL=plan-routes.js.map