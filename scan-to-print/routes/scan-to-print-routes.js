"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.createScanToPrintRoutes = createScanToPrintRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const surface_files_1 = require("./surface-files");
const data_dir_1 = require("./data-dir");
const job_routes_1 = require("./job-routes");
const print_routes_1 = require("./print-routes");
const views_1 = require("./engine/grid/views");
const pipeline_1 = require("./engine/pipeline");
const printer_adapters_1 = require("./engine/print/printer-adapters");
const slicer_1 = require("./engine/print/slicer");
const image_ingest_1 = require("./image-ingest");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-routes' });
/** @description The scripts the surface loads, served from one `/assets` mount. */
const SURFACE_SCRIPTS = ['scan-to-print.js', 'scan-to-print-gl.js', 'scan-to-print-camera.js'];
/**
 * @description Resolve the authenticated caller's sub. The mount is `auth: oidc`; a service-rail
 * caller resolved by the mounter arrives as `oshalCallerSub` and is honoured too.
 * @param req - The request.
 * @returns The sub, or null when the request carries no identity.
 */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
/**
 * @description Build the `/api/scan-to-print` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides; see {@link ScanToPrintRouteOpts}.
 * @returns The composed router.
 */
function createScanToPrintRoutes(ctx, opts = {}) {
    const env = opts.env ?? process.env;
    const dataRoot = opts.dataRoot ?? (0, data_dir_1.resolveDataRoot)(env);
    const appPackageDir = ctx.appPackageDir;
    const router = (0, express_1.Router)();
    const surface = (0, surface_files_1.surfaceFile)(appPackageDir, 'scan-to-print.html');
    logger.info({ surface, appPackageDir, dataRoot }, 'Resolved the scan-to-print surface');
    router.get('/app', (0, surface_files_1.serveSurfaceFile)(surface, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS)
        assets.get(`/${file}`, (0, surface_files_1.serveSurfaceFile)((0, surface_files_1.surfaceFile)(appPackageDir, file), 'application/javascript'));
    router.use('/assets', assets);
    router.get('/capabilities', (_req, res) => {
        let ffmpeg;
        try {
            const f = (0, image_ingest_1.resolveFfmpeg)(env);
            ffmpeg = { configured: true, fps: f.fps, maxFrames: f.maxFrames };
        }
        catch (error) {
            ffmpeg = { configured: false, error: error instanceof Error ? error.message : String(error) };
        }
        let slicerConfigured = false;
        try {
            slicerConfigured = (0, slicer_1.resolveSlicerConfig)(env) !== null;
        }
        catch {
            slicerConfigured = false;
        }
        res.json({
            app: 'scan-to-print', views: views_1.VIEW_NAMES, lanes: ['silhouettes', 'pointcloud'], limits: pipeline_1.RECONSTRUCTION_LIMITS, upload: job_routes_1.UPLOAD_LIMITS,
            printers: { kinds: printer_adapters_1.PRINTER_KINDS, slicerConfigured }, video: ffmpeg,
        });
    });
    const deps = { pool: ctx.pool, dataRoot, env, callerSub, execFile: opts.execFile, fetchImpl: opts.fetchImpl };
    router.use((0, job_routes_1.createJobRoutes)(deps));
    router.use((0, print_routes_1.createPrintRoutes)(deps));
    return router;
}
//# sourceMappingURL=scan-to-print-routes.js.map