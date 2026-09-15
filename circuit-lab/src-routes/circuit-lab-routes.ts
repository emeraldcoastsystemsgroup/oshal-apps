/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Serve circuit-lab-geometry.js (the wire-bend and group-rotation
 *                     |                             | geometry the canvas shares with the plain-node suite).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The shaft-driver catalog (`/catalog/drivers`, loaded and validated
 *                     |                             | once from catalog/drivers.json; a bad catalog fails the mount).
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its scripts from this package's
 *                     |                             | tools/ (ctx.appPackageDir), publishes `/capabilities` (the
 *                     |                             | part contract the routes enforce, the starter examples, the
 *                     |                             | engine's status and the exact install command when it is
 *                     |                             | down), owns ONE engine client per api process, and composes
 *                     |                             | the design router under the `/api/circuit-lab` mount. The
 *                     |                             | manifest's `auth: oidc` wraps the whole mount; every handler
 *                     |                             | still re-derives the caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { describeContract, DRIVER_TYPES } from './circuit-contract';
import { listDrivers, loadDriverCatalog } from './driver-catalog';
import { engineBuildHash } from './engine-build-hash';
import { DEFAULT_ENGINE_ADDR, EngineClient, parseEngineAddr } from './engine-client';
import { resolveDataRoot } from './data-dir';
import { createDesignRoutes } from './design-routes';
import { listExamples } from './examples';

const logger = createChildLogger({ module: 'circuit-lab-routes' });
const SURFACE_SCRIPTS = ['circuit-lab.js', 'circuit-lab-canvas.js', 'circuit-lab-geometry.js', 'circuit-lab-plot.js', 'circuit-lab-board-model.js', 'circuit-lab-board.js'] as const;
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
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

/** @description Optional overrides for specs, on top of the framework's per-package context. */
export interface CircuitLabRouteOpts {
  dataRoot?: string;
  env?: Record<string, string | undefined>;
  /** A pre-built engine client (specs hand in one bound to a fake bridge). */
  engine?: EngineClient;
  engineBuild?: string | null;
  runTimeoutMs?: number;
}

/**
 * @description The install command the surface and /capabilities print when the engine is down.
 * @param env - Environment (OSHAL_API_CONTAINER names the api container when known).
 * @returns The exact command.
 */
export function installHint(env: Record<string, string | undefined>): string {
  const api = (env.OSHAL_API_CONTAINER || env.HOSTNAME || '<api-container>').trim();
  return `docker exec ${api} sh /app/workspace-shared/deployed-apps/circuit-lab/engine/install-engine.sh`;
}

/**
 * @description Build the `/api/circuit-lab` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides; see {@link CircuitLabRouteOpts}.
 * @returns The composed router.
 */
export function createCircuitLabRoutes(ctx: AppContext, opts: CircuitLabRouteOpts = {}): Router {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const dataRoot = opts.dataRoot ?? resolveDataRoot(env);
  const appPackageDir = ctx.appPackageDir;
  const engineDir = packageFile(appPackageDir, 'engine');
  const engineBuild = opts.engineBuild !== undefined ? opts.engineBuild : engineBuildHash(engineDir);
  const hint = installHint(env);
  const addr = parseEngineAddr(env.CIRCUIT_LAB_ENGINE_ADDR || DEFAULT_ENGINE_ADDR);
  const engine = opts.engine ?? new EngineClient({ host: addr.host, port: addr.port, expectedBuildHash: engineBuild, installHint: hint });
  const router = Router();

  const surface = packageFile(appPackageDir, 'tools', 'circuit-lab.html');
  logger.info({ surface, appPackageDir, dataRoot, engine: `${addr.host}:${addr.port}`, engineBuild }, 'Resolved the circuit-lab surface');
  router.get('/app', serveFile(surface, 'html'));
  const assets = Router();
  for (const file of SURFACE_SCRIPTS) assets.get(`/${file}`, serveFile(packageFile(appPackageDir, 'tools', file), 'application/javascript'));
  router.use('/assets', assets);

  const catalog = loadDriverCatalog(packageFile(appPackageDir, 'catalog', 'drivers.json'));
  logger.info({ drivers: catalog.length }, 'Loaded the shaft-driver catalog');

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({ app: 'circuit-lab', solver: 'ngspice (engine container)', contract: describeContract(), examples: listExamples(), engine: engine.status(), catalog: { drivers: catalog.length, path: '/api/circuit-lab/catalog/drivers' } });
  });
  router.get('/examples', (_req: Request, res: Response) => { res.json({ examples: listExamples() }); });
  router.get('/catalog/drivers', (req: Request, res: Response) => {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    if (type && !DRIVER_TYPES.includes(type)) { res.status(400).json({ error: 'invalid_input', field: 'type', message: `type must be one of ${DRIVER_TYPES.join(', ')}` }); return; }
    res.json({ drivers: listDrivers(catalog, type) });
  });

  router.use(createDesignRoutes({ pool: ctx.pool, engine, dataRoot, engineBuild, callerSub, timeoutMs: opts.runTimeoutMs }));
  return router;
}
