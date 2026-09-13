/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its two scripts from this package's
 *                     |                             | tools/ (ctx.appPackageDir, captured at factory time — D10),
 *                     |                             | publishes `/capabilities` (the SAME bounds the job and print
 *                     |                             | routes enforce, so the form and the server cannot disagree),
 *                     |                             | and composes the job and print routers under one `/api/scan-
 *                     |                             | to-print` mount. The manifest's `auth: oidc` wraps the whole
 *                     |                             | mount; every handler still re-derives the caller sub itself.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Serve the surface's camera module (scan-to-print-camera.js)
 *                     |                             | from the same fixed asset list — phone capture ships in the
 *                     |                             | surface, the routes and the engine are unchanged.
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { serveSurfaceFile, surfaceFile } from './surface-files';
import { resolveDataRoot } from './data-dir';
import { type JobRouteDeps, UPLOAD_LIMITS, createJobRoutes } from './job-routes';
import { type PrintRouteDeps, createPrintRoutes } from './print-routes';
import { VIEW_NAMES } from './engine/grid/views';
import { RECONSTRUCTION_LIMITS } from './engine/pipeline';
import { PRINTER_KINDS } from './engine/print/printer-adapters';
import { resolveSlicerConfig } from './engine/print/slicer';
import { resolveFfmpeg } from './image-ingest';

const logger = createChildLogger({ module: 'scan-to-print-routes' });

/** @description The scripts the surface loads, served from one `/assets` mount. */
const SURFACE_SCRIPTS = ['scan-to-print.js', 'scan-to-print-gl.js', 'scan-to-print-camera.js'] as const;

/**
 * @description Resolve the authenticated caller's sub. The mount is `auth: oidc`; a service-rail
 * caller resolved by the mounter arrives as `oshalCallerSub` and is honoured too.
 * @param req - The request.
 * @returns The sub, or null when the request carries no identity.
 */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

/** @description Optional overrides for specs, on top of the framework's per-package context. */
export interface ScanToPrintRouteOpts {
  /** Job-file root override. */
  dataRoot?: string;
  /** Environment override. */
  env?: Record<string, string | undefined>;
  /** Network client override for printer hosts. */
  fetchImpl?: PrintRouteDeps['fetchImpl'];
  /** Process runner override for ffmpeg and the slicer. */
  execFile?: JobRouteDeps['execFile'];
}

/**
 * @description Build the `/api/scan-to-print` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides; see {@link ScanToPrintRouteOpts}.
 * @returns The composed router.
 */
export function createScanToPrintRoutes(ctx: AppContext, opts: ScanToPrintRouteOpts = {}): Router {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const dataRoot = opts.dataRoot ?? resolveDataRoot(env);
  const appPackageDir = ctx.appPackageDir;
  const router = Router();

  const surface = surfaceFile(appPackageDir, 'scan-to-print.html');
  logger.info({ surface, appPackageDir, dataRoot }, 'Resolved the scan-to-print surface');
  router.get('/app', serveSurfaceFile(surface, 'html'));
  const assets = Router();
  for (const file of SURFACE_SCRIPTS) assets.get(`/${file}`, serveSurfaceFile(surfaceFile(appPackageDir, file), 'application/javascript'));
  router.use('/assets', assets);

  router.get('/capabilities', (_req: Request, res: Response) => {
    let ffmpeg: { configured: boolean; fps?: number; maxFrames?: number; error?: string };
    try { const f = resolveFfmpeg(env); ffmpeg = { configured: true, fps: f.fps, maxFrames: f.maxFrames }; } catch (error) { ffmpeg = { configured: false, error: error instanceof Error ? error.message : String(error) }; }
    let slicerConfigured = false;
    try { slicerConfigured = resolveSlicerConfig(env) !== null; } catch { slicerConfigured = false; }
    res.json({
      app: 'scan-to-print', views: VIEW_NAMES, lanes: ['silhouettes', 'pointcloud'], limits: RECONSTRUCTION_LIMITS, upload: UPLOAD_LIMITS,
      printers: { kinds: PRINTER_KINDS, slicerConfigured }, video: ffmpeg,
    });
  });

  const deps = { pool: ctx.pool, dataRoot, env, callerSub, execFile: opts.execFile, fetchImpl: opts.fetchImpl };
  router.use(createJobRoutes(deps));
  router.use(createPrintRoutes(deps));
  return router;
}
