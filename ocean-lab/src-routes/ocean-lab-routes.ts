/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Composes
 *                     |                             | the harvest and rotor routers under one `/api/ocean-lab` mount and
 *                     |                             | serves the two bundled surfaces from this package's tools/ dir.
 *                     |                             | The two sub-factories keep their own files (619 and 338 code lines)
 *                     |                             | rather than being merged: one 1000-line route module is exactly
 *                     |                             | what the file cap exists to prevent.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { HARVEST_LIMITS, createHarvestRoutes } from './harvest-routes';
import { ROTOR_LIMITS, createRotorRoutes } from './rotor-routes';
import { serveSurfaceFile, surfaceFile } from './surface-files';

const logger = createChildLogger({ module: 'ocean-lab-routes' });

/** The engine scripts both bundled pages load, served from one mount so a page-relative
 * `assets/<file>` and an absolute `/api/ocean-lab/assets/<file>` reach the same bytes. */
const SURFACE_SCRIPTS = ['harvest-console.js', 'blade-studio.js', 'blade-studio-gl.js'] as const;

/** Optional overrides for specs, plus the framework's per-package context. */
export interface OceanLabRouteOpts {
  /** Injectable OIDC guard — see {@link createHarvestRoutes} for why this is a parameter. */
  requiresAuth?: RequestHandler;
  /** The per-package AppContext (ADR-085 D10), carrying `appPackageDir`. */
  ctx?: unknown;
}

/**
 * @description Build the `/api/ocean-lab` router.
 *
 * Accepts EITHER the opts wrapper (`{requiresAuth?, ctx?}`) OR a bare AppContext — the manifest
 * route mounter invokes a packaged factory with `requiresContext: true` by passing the context
 * itself, and specs want to inject a guard. Same dual-shape convention `aero-lab` uses.
 *
 * Auth is the manifest's `requiresAuth: true` wrapping the whole mount; no route here mounts
 * anywhere else, so nothing can escape that guard.
 * @param arg - Opts wrapper, or the AppContext itself.
 * @returns The composed router.
 */
export function createOceanLabRoutes(arg: OceanLabRouteOpts | Record<string, unknown> = {}): Router {
  const isOpts = arg !== null && typeof arg === 'object' && ('requiresAuth' in arg || 'ctx' in arg);
  const opts: OceanLabRouteOpts = isOpts ? (arg as OceanLabRouteOpts) : { ctx: arg };
  const appPackageDir = (opts.ctx as { appPackageDir?: string } | undefined)?.appPackageDir;
  const sub = { appPackageDir, requiresAuth: opts.requiresAuth };

  const router = Router();

  // ── The bundled surfaces ───────────────────────────────────────────────────
  // Both pages probe `assets/<file>` relative to their own URL first, which resolves to
  // /api/ocean-lab/assets/<file> — hence the top-level assets mount alongside the per-half ones.
  const harvestConsole = surfaceFile(appPackageDir, 'harvest-console.html');
  const bladeStudio = surfaceFile(appPackageDir, 'blade-studio.html');
  logger.info({ harvestConsole, bladeStudio, appPackageDir }, 'Resolved the ocean-lab surfaces');

  router.get('/app', serveSurfaceFile(harvestConsole, 'html'));
  router.get('/harvest-console', serveSurfaceFile(harvestConsole, 'html'));
  router.get('/blade-studio', serveSurfaceFile(bladeStudio, 'html'));

  const assets = Router();
  for (const file of SURFACE_SCRIPTS) {
    assets.get(`/${file}`, serveSurfaceFile(surfaceFile(appPackageDir, file), 'application/javascript'));
  }
  router.use('/assets', assets);

  /**
   * GET /capabilities — the bound tables both surfaces pre-validate their forms against, so a form
   * and the server cannot disagree about what is admissible. No engine probe: the models are
   * in-process TypeScript, so there is nothing that can be absent at runtime.
   */
  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({
      app: 'ocean-lab',
      domains: ['marine', 'ground', 'rotor'],
      surfaces: [
        { name: 'harvest-console', url: '/api/ocean-lab/harvest-console' },
        { name: 'blade-studio', url: '/api/ocean-lab/blade-studio' },
      ],
      limits: { harvest: HARVEST_LIMITS, rotor: ROTOR_LIMITS },
      provenance: 'illustrative parameters over real models — not survey data, no hardware built',
    });
  });

  router.use('/harvest', createHarvestRoutes(sub));
  router.use('/rotor', createRotorRoutes(sub));

  return router;
}
