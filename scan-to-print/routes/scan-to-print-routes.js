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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.slicerEngineOptions = slicerEngineOptions;
exports.capabilitiesOf = capabilitiesOf;
exports.createScanToPrintServiceRoutes = createScanToPrintServiceRoutes;
exports.createScanToPrintRoutes = createScanToPrintRoutes;
const express_1 = require("express");
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const surface_files_1 = require("./surface-files");
const data_dir_1 = require("./data-dir");
const job_routes_1 = require("./job-routes");
const print_routes_1 = require("./print-routes");
const service_routes_1 = require("./service-routes");
const scan_authorization_1 = require("./scan-authorization");
const print_tools_1 = require("./print-tools");
const slicer_engine_1 = require("./printing/slicer-engine");
const views_1 = require("./engine/grid/views");
const pipeline_1 = require("./engine/pipeline");
const depth_decode_1 = require("./engine/grid/depth-decode");
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
 * @description The slicer engine this package's routes dial: the configured address, the build
 * hash of the engine tree shipped beside these routes, and the command that installs it here.
 * @param appPackageDir - The deployed package directory.
 * @param env - Environment (SCAN_TO_PRINT_ENGINE_ADDR).
 * @param connect - Socket factory override.
 * @returns Engine options.
 */
function slicerEngineOptions(appPackageDir, env, connect) {
    const engineDir = node_path_1.default.join(appPackageDir, 'engine');
    // A malformed address must not stop the app from mounting (every other printer kind still works):
    // it is carried as an error every slicer request reports.
    let address = { host: '', port: 0 };
    let addrError;
    try {
        address = (0, slicer_engine_1.parseSlicerAddr)(env[slicer_engine_1.SLICER_ENGINE_ADDR_ENV]);
    }
    catch (error) {
        addrError = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, variable: slicer_engine_1.SLICER_ENGINE_ADDR_ENV }, 'Slicer engine address is invalid; Bambu slicing will report it');
    }
    return { ...address, expectedBuildHash: (0, slicer_engine_1.slicerEngineBuildHash)(engineDir), installHint: (0, slicer_engine_1.slicerInstallHint)(engineDir), ...(addrError ? { addrError } : {}), ...(connect ? { connect } : {}) };
}
/** @description The dependencies the person's print routes and the print service share. */
function printDeps(ctx, opts) {
    const env = opts.env ?? process.env;
    return {
        pool: ctx.pool, dataRoot: opts.dataRoot ?? (0, data_dir_1.resolveDataRoot)(env), env, callerSub, execFile: opts.execFile, fetchImpl: opts.fetchImpl,
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
function capabilitiesOf(env, deps) {
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
    return {
        app: 'scan-to-print', views: views_1.VIEW_NAMES, lanes: ['silhouettes', 'pointcloud', 'depth'], limits: pipeline_1.RECONSTRUCTION_LIMITS, upload: job_routes_1.UPLOAD_LIMITS,
        depth: depth_decode_1.DEPTH_UPLOAD_LIMITS, printers: { kinds: printer_adapters_1.PRINTER_KINDS, slicerConfigured }, video: ffmpeg,
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
function createScanToPrintServiceRoutes(ctx, opts = {}) {
    return (0, service_routes_1.createPrintServiceRouter)(printDeps(ctx, opts));
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
    const deps = printDeps(ctx, { ...opts, env, dataRoot });
    router.get('/capabilities', (_req, res) => { res.json(capabilitiesOf(env, deps)); });
    (0, scan_authorization_1.registerScanToPrintAuthorization)(ctx);
    (0, print_tools_1.registerPrintTools)(ctx, { ...deps, capabilities: () => capabilitiesOf(env, deps) });
    router.use((0, job_routes_1.createJobRoutes)(deps));
    router.use((0, print_routes_1.createPrintRoutes)(deps));
    return router;
}
//# sourceMappingURL=scan-to-print-routes.js.map