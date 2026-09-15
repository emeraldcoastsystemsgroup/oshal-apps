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

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import {
  SpecError, advance, buildEnvelope, chainOrderTo, decideForward, designMarkdown, formationDraft, planChain, rosterIds, routeThrough, signEnvelope, simulate, validateScenario, validateSpec, verifyEnvelope,
  type ChainPlan, type ForwardDecision, type RelayEnvelope,
} from './engine';
import { createPlan, deletePlan, getPlan, listPlans, requireUuid, saveRun, updatePlan, type PlanRow, type QueryablePool } from './plan-store';

const logger = createChildLogger({ module: 'drone-relay-plan-routes' });
const BASE = '/api/drone-relay';

/** @description What the plan router needs from its host. */
export interface PlanRouteDeps {
  pool: QueryablePool;
  callerSub: (req: Request) => string | null;
}

type PlanRequest = Request & { relaySub?: string; relayPlan?: PlanRow };

/**
 * @description The plan as the API returns it: the row plus its roster and the write-up's URL.
 * @param row - The stored plan.
 * @returns The public shape.
 */
export function publicPlan(row: PlanRow | (Omit<PlanRow, 'last_sim'> & { last_metrics?: unknown })): Record<string, unknown> {
  return { ...row, roster: rosterIds(row.plan as ChainPlan), designUrl: `${BASE}/plans/${row.plan_id}/design.md` };
}

function refuse(res: Response, error: unknown): boolean {
  if (error instanceof SpecError) { res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message }); return true; }
  if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_id', message: error.message }); return true; }
  return false;
}

/** The spec body: either `{ spec: {...} }` or the fields at the top level (tool calls send them flat). */
function specBody(body: unknown): Record<string, unknown> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (b.spec && typeof b.spec === 'object') return { ...(b.spec as Record<string, unknown>), ...(typeof b.title === 'string' ? { title: b.title } : {}) };
  const { planId: _p, scenario: _s, ...rest } = b;
  return rest;
}

/** One envelope walked through its route; the decisions a real relay would make at each node. */
function traceEnvelope(signed: RelayEnvelope): Array<{ node: string; hop: number; ttl: number } & ForwardDecision> {
  const trace: Array<{ node: string; hop: number; ttl: number } & ForwardDecision> = [];
  let env = signed;
  for (let guard = 0; guard < 32; guard += 1) {
    const node = env.route[env.hop];
    const decision = decideForward(env, node);
    trace.push({ node, hop: env.hop, ttl: env.ttl, ...decision });
    if (decision.action !== 'forward') break;
    env = advance(env);
  }
  return trace;
}

function registerPlanCrud(router: Router, deps: PlanRouteDeps): void {
  router.post('/plan-preview', (req: PlanRequest, res) => {
    try { const spec = validateSpec(specBody(req.body)); res.json({ spec, sized: planChain(spec) }); } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.get('/plans', async (req: PlanRequest, res) => {
    const plans = await listPlans(deps.pool, req.relaySub as string);
    res.json({ plans: plans.map((p) => publicPlan(p)) });
  });
  router.post('/plans', async (req: PlanRequest, res) => {
    try {
      const spec = validateSpec(specBody(req.body));
      const row = await createPlan(deps.pool, req.relaySub as string, { title: spec.title, spec, plan: planChain(spec) });
      logger.info({ planId: row.plan_id, transport: spec.transport, relays: row.plan.relaysNeeded, feasible: row.plan.feasible }, 'Relay plan created');
      res.status(201).json({ plan: publicPlan(row) });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.get('/plans/:planId', (req: PlanRequest, res) => { res.json({ plan: publicPlan(req.relayPlan as PlanRow) }); });
  router.patch('/plans/:planId', async (req: PlanRequest, res) => {
    try {
      const current = req.relayPlan as PlanRow;
      const spec = validateSpec({ ...current.spec, ...specBody(req.body) });
      const row = await updatePlan(deps.pool, req.relaySub as string, current.plan_id, { title: spec.title, spec, plan: planChain(spec) });
      if (!row) { res.status(404).json({ error: 'plan_not_found' }); return; }
      res.json({ plan: publicPlan(row) });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.delete('/plans/:planId', async (req: PlanRequest, res) => {
    const gone = await deletePlan(deps.pool, req.relaySub as string, (req.relayPlan as PlanRow).plan_id);
    res.status(gone ? 200 : 404).json(gone ? { deleted: true } : { error: 'plan_not_found' });
  });
}

function registerPlanActions(router: Router, deps: PlanRouteDeps): void {
  router.post('/plans/:planId/simulate', async (req: PlanRequest, res) => {
    const row = req.relayPlan as PlanRow;
    try {
      if (!row.plan.feasible) { res.status(409).json({ error: 'plan_not_feasible', reasons: row.plan.reasons }); return; }
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const scenario = validateScenario(body.scenario ?? body, row.plan);
      const started = Date.now();
      const run = simulate(row.spec, row.plan, scenario);
      const saved = await saveRun(deps.pool, req.relaySub as string, row.plan_id, run);
      logger.info({ planId: row.plan_id, verdict: run.metrics.verdict, outageS: run.metrics.tipOutageS, ms: Date.now() - started }, 'Relay scenario simulated');
      res.json({ run, plan: saved ? publicPlan(saved) : publicPlan(row) });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.post('/plans/:planId/fleet-mission', (req: PlanRequest, res) => {
    const row = req.relayPlan as PlanRow;
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    if (!row.plan.feasible) { res.status(409).json({ error: 'plan_not_feasible', reasons: row.plan.reasons }); return; }
    try { res.json({ ...formationDraft(row.spec, row.plan, body.home, body.drones), target: 'drone', executes: false }); } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.get('/plans/:planId/design.md', (req: PlanRequest, res) => {
    const row = req.relayPlan as PlanRow;
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/markdown').send(designMarkdown(row.spec, row.plan, row.last_sim));
  });
  router.post('/plans/:planId/trace', (req: PlanRequest, res) => {
    const row = req.relayPlan as PlanRow;
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const dst = typeof body.dst === 'string' ? body.dst : row.plan.tree ? 'tip1' : 'tip';
    const order = chainOrderTo(row.plan, dst);
    const kind = body.kind === 'heartbeat' || body.kind === 'reply' ? body.kind : 'command';
    try {
      const route = routeThrough(order, dst, kind === 'command' ? 'outward' : 'inward');
      const payload = body.payload ?? { id: 'demo', command: 'hold', args: {} };
      const signed = signEnvelope(buildEnvelope({ kind, route, payload, ts: Date.now(), id: `demo-${row.plan_id.slice(0, 8)}` }), row.plan_id);
      res.json({ envelope: signed, trace: traceEnvelope(signed), verifiedAtDestination: verifyEnvelope(signed, row.plan_id), replyRoute: route.slice().reverse(), keyNote: 'signed with the plan id as a stand-in for the pair key a node receives at enrolment' });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });
}

/**
 * @description Build the plan router (mounted under the package's oidc mount).
 * @param deps - Pool and caller resolver.
 * @returns The router.
 */
export function createPlanRoutes(deps: PlanRouteDeps): Router {
  const router = Router();
  router.use((req: PlanRequest, res, next) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    req.relaySub = sub;
    next();
  });
  router.param('planId', async (req: PlanRequest, res, next, value) => {
    try {
      const row = await getPlan(deps.pool, req.relaySub as string, requireUuid(value));
      if (!row) { res.status(404).json({ error: 'plan_not_found' }); return; }
      req.relayPlan = row;
      next();
    } catch (error) {
      if (!refuse(res, error)) { logger.error({ err: error }, 'Load plan failed'); res.status(500).json({ error: 'load_failed' }); }
    }
  });
  registerPlanCrud(router, deps);
  registerPlanActions(router, deps);
  return router;
}
