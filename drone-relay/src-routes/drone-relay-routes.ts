/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The `/api/drone-relay` mount: serves the bundled surface and its
 *                     |                             | script from this package's tools/ (ctx.appPackageDir captured
 *                     |                             | at factory time — ADR-085 D10), publishes `/capabilities`
 *                     |                             | (the transport catalog, the SAME limits the plan routes
 *                     |                             | enforce, the defaults, the envelope constants), the transport
 *                     |                             | comparison and the single-link budget, and composes the plan
 *                     |                             | router. The manifest's `auth: oidc` wraps the whole mount;
 *                     |                             | every plan handler still re-derives the caller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | `/capabilities` also lists the postures, the control-channel
 *                     |                             | choices and the packed heartbeat size the plan's air-time
 *                     |                             | figure assumes, so a tool reads them instead of guessing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | `/capabilities` lists the branch limits a tree is held to.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | ...and the limits a lattice's area is held to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  BASE_ID, BRANCH_LIMITS, DEFAULT_PATH_LOSS_EXPONENT, GROUND_NODE_LIMITS, HEARTBEAT_BYTES, LATTICE_LIMITS, MAX_ROUTE, POSTURES, SCENARIO_LIMITS, SPEC_LIMITS, SpecError, TRANSPORTS, compareTransports, controlChannelIds, findTransport, linkBudget, numberIn, validateSpec,
} from './engine';
import { createPlanRoutes } from './plan-routes';

const logger = createChildLogger({ module: 'drone-relay-routes' });
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub).
 * @param req - The request.
 * @returns The sub, or null when the request carries no identity.
 */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

function packageFile(appPackageDir: string | undefined, ...rel: string[]): string {
  const candidates = [appPackageDir ? path.join(appPackageDir, ...rel) : '', LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, ...rel) : '', path.resolve(__dirname, '..', ...rel)].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || candidates[candidates.length - 1];
}

function serveFile(filePath: string, contentType: 'html' | 'application/javascript'): RequestHandler {
  return (_req: Request, res: Response): void => {
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.type(contentType).send(source);
    } catch (error) {
      logger.error({ err: error, filePath }, 'Bundled surface file is not readable');
      res.status(404).json({ error: 'surface_file_not_found' });
    }
  };
}

function budgetParams(source: Record<string, unknown>): { distanceM: number; requiredMarginDb: number; exponent: number } {
  return {
    distanceM: numberIn(source.distanceM, 'distanceM', 1, 100_000, 500),
    requiredMarginDb: numberIn(source.requiredMarginDb ?? source.marginDb, 'requiredMarginDb', SPEC_LIMITS.requiredMarginDb.min, SPEC_LIMITS.requiredMarginDb.max, SPEC_LIMITS.requiredMarginDb.default),
    exponent: numberIn(source.exponent ?? source.pathLossExponent, 'pathLossExponent', SPEC_LIMITS.pathLossExponent.min, SPEC_LIMITS.pathLossExponent.max, DEFAULT_PATH_LOSS_EXPONENT),
  };
}

function refuse(res: Response, error: unknown): boolean {
  if (error instanceof SpecError) { res.status(400).json({ error: 'invalid_input', field: error.field, message: error.message }); return true; }
  return false;
}

/**
 * @description Build the `/api/drone-relay` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
export function createDroneRelayRoutes(ctx: AppContext): Router {
  const appPackageDir = ctx.appPackageDir;
  const router = Router();
  const surface = packageFile(appPackageDir, 'tools', 'drone-relay.html');
  logger.info({ surface, appPackageDir }, 'Resolved the drone-relay surface');
  router.get('/app', serveFile(surface, 'html'));
  router.get('/assets/drone-relay.js', serveFile(packageFile(appPackageDir, 'tools', 'drone-relay.js'), 'application/javascript'));

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({ app: 'drone-relay', transports: TRANSPORTS, limits: SPEC_LIMITS, groundNodes: GROUND_NODE_LIMITS, branches: BRANCH_LIMITS, lattice: LATTICE_LIMITS, scenario: SCENARIO_LIMITS, defaults: validateSpec({}), gapPolicies: ['retreat', 'hold-degraded'], postures: POSTURES, controlChannels: controlChannelIds(), heartbeatBytes: HEARTBEAT_BYTES, envelope: { maxRoute: MAX_ROUTE, baseId: BASE_ID }, model: 'log-distance path loss on datasheet numbers; the range test replaces it' });
  });
  router.get('/transports', (req: Request, res: Response) => {
    try {
      const p = budgetParams(req.query as Record<string, unknown>);
      res.json({ ...p, budgets: compareTransports(p.distanceM, p.requiredMarginDb, p.exponent) });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });
  router.post('/link-budget', (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const transport = findTransport(body.transport);
      if (!transport) throw new SpecError('transport', `transport "${String(body.transport)}" is not in the catalog`);
      const p = budgetParams(body);
      res.json({ transport, budget: linkBudget(transport, p.distanceM, p.requiredMarginDb, p.exponent) });
    } catch (error) { if (!refuse(res, error)) throw error; }
  });

  router.use(createPlanRoutes({ pool: ctx.pool, callerSub }));
  return router;
}
