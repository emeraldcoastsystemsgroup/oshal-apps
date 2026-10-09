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
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | `/capabilities` lists the depth lane and its upload bounds
 *                     |                             | (BACKLOG B1): the accepted encodings, the pixel ceiling and the
 *                     |                             | depthScale range the route enforces.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The print service and the slicer engine: one slicer-engine
 *                     |                             | configuration (address, the build hash of THIS package's engine
 *                     |                             | tree, the install command for this box) is built here and handed
 *                     |                             | to both the person's routes and createScanToPrintServiceRoutes,
 *                     |                             | the factory the manifest mounts `service-or-oidc` at
 *                     |                             | /api/scan-to-print/service. `/capabilities` names the print
 *                     |                             | service and the engine's address, expected build and installHint.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | An unparseable SCAN_TO_PRINT_ENGINE_ADDR no longer throws while
 *                     |                             | the routes mount (which skipped the whole app); slicing reports it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | 0.7.0: the route entry factory registers the package's ADR-149
 *                     |                             | resource adapter and its five package tools (print-tools.ts) on
 *                     |                             | the kernel's activation ports, once; the capabilities answer is
 *                     |                             | one function the route and the scan-to-print-capabilities tool
 *                     |                             | share.
 */

import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { serveSurfaceFile, surfaceFile } from './surface-files';
import { resolveDataRoot } from './data-dir';
import { type JobRouteDeps, UPLOAD_LIMITS, createJobRoutes } from './job-routes';
import { type PrintRouteDeps, createPrintRoutes } from './print-routes';
import { createPrintServiceRouter } from './service-routes';
import { registerScanToPrintAuthorization } from './scan-authorization';
import { registerPrintTools } from './print-tools';
import { type SlicerEngineOptions, SLICER_ENGINE_ADDR_ENV, parseSlicerAddr, slicerEngineBuildHash, slicerInstallHint } from './printing/slicer-engine';
import type { BambuIo } from './printing/bambu-lan';
import { VIEW_NAMES } from './engine/grid/views';
import { RECONSTRUCTION_LIMITS } from './engine/pipeline';
import { DEPTH_UPLOAD_LIMITS } from './engine/grid/depth-decode';
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
  /** Slicer engine socket factory (specs). */
  slicerConnect?: SlicerEngineOptions['connect'];
  /** Bambu printer socket seam (specs). */
  bambuIo?: BambuIo;
}

/**
 * @description The slicer engine this package's routes dial: the configured address, the build
 * hash of the engine tree shipped beside these routes, and the command that installs it here.
 * @param appPackageDir - The deployed package directory.
 * @param env - Environment (SCAN_TO_PRINT_ENGINE_ADDR).
 * @param connect - Socket factory override.
 * @returns Engine options.
 */
export function slicerEngineOptions(appPackageDir: string, env: Record<string, string | undefined>, connect?: SlicerEngineOptions['connect']): SlicerEngineOptions {
  const engineDir = path.join(appPackageDir, 'engine');
  // A malformed address must not stop the app from mounting (every other printer kind still works):
  // it is carried as an error every slicer request reports.
  let address: { host: string; port: number } = { host: '', port: 0 };
  let addrError: string | undefined;
  try { address = parseSlicerAddr(env[SLICER_ENGINE_ADDR_ENV]); } catch (error) {
    addrError = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, variable: SLICER_ENGINE_ADDR_ENV }, 'Slicer engine address is invalid; Bambu slicing will report it');
  }
  return { ...address, expectedBuildHash: slicerEngineBuildHash(engineDir), installHint: slicerInstallHint(engineDir), ...(addrError ? { addrError } : {}), ...(connect ? { connect } : {}) };
}

/** @description The dependencies the person's print routes and the print service share. */
function printDeps(ctx: AppContext, opts: ScanToPrintRouteOpts): PrintRouteDeps & JobRouteDeps {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  return {
    pool: ctx.pool, dataRoot: opts.dataRoot ?? resolveDataRoot(env), env, callerSub, execFile: opts.execFile, fetchImpl: opts.fetchImpl,
    slicer: slicerEngineOptions(ctx.appPackageDir ?? '', env, opts.slicerConnect), bambuIo: opts.bambuIo,
  };
}

/**
 * @description What this swarm's Scan to Print can do: views, lanes, limits, printer kinds, the slicer
 * engine and the print service. One answer for GET /capabilities and the scan-to-print-capabilities tool.
 * @param env - Environment (ffmpeg, slicer).
 * @param deps - The print dependencies (slicer engine options).
 * @returns The capabilities document.
 */
export function capabilitiesOf(env: Record<string, string | undefined>, deps: PrintRouteDeps): Record<string, unknown> {
  let ffmpeg: { configured: boolean; fps?: number; maxFrames?: number; error?: string };
  try { const f = resolveFfmpeg(env); ffmpeg = { configured: true, fps: f.fps, maxFrames: f.maxFrames }; } catch (error) { ffmpeg = { configured: false, error: error instanceof Error ? error.message : String(error) }; }
  let slicerConfigured = false;
  try { slicerConfigured = resolveSlicerConfig(env) !== null; } catch { slicerConfigured = false; }
  return {
    app: 'scan-to-print', views: VIEW_NAMES, lanes: ['silhouettes', 'pointcloud', 'depth'], limits: RECONSTRUCTION_LIMITS, upload: UPLOAD_LIMITS,
    depth: DEPTH_UPLOAD_LIMITS, printers: { kinds: PRINTER_KINDS, slicerConfigured }, video: ffmpeg,
    printService: { mountPath: '/api/scan-to-print/service', startsOnlyWhenPrinterAutoStart: true },
    slicerEngine: { address: `${deps.slicer.host}:${deps.slicer.port}`, expectedBuildHash: deps.slicer.expectedBuildHash, installHint: deps.slicer.installHint },
  };
}

/**
 * @description Build the `/api/scan-to-print/service` router — the swarm print service.
 * @param ctx - The per-package AppContext.
 * @param opts - Spec overrides.
 * @returns The print service router.
 */
export function createScanToPrintServiceRoutes(ctx: AppContext, opts: ScanToPrintRouteOpts = {}): Router {
  return createPrintServiceRouter(printDeps(ctx, opts));
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

  const deps = printDeps(ctx, { ...opts, env, dataRoot });
  router.get('/capabilities', (_req: Request, res: Response) => { res.json(capabilitiesOf(env, deps)); });
  registerScanToPrintAuthorization(ctx);
  registerPrintTools(ctx, { ...deps, capabilities: () => capabilitiesOf(env, deps) });

  router.use(createJobRoutes(deps));
  router.use(createPrintRoutes(deps));
  return router;
}
