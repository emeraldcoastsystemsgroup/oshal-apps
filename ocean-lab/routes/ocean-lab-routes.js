"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOceanLabRoutes = createOceanLabRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const harvest_routes_1 = require("./harvest-routes");
const rotor_routes_1 = require("./rotor-routes");
const surface_files_1 = require("./surface-files");
const logger = (0, logger_1.createChildLogger)({ module: 'ocean-lab-routes' });
/** The engine scripts both bundled pages load, served from one mount so a page-relative
 * `assets/<file>` and an absolute `/api/ocean-lab/assets/<file>` reach the same bytes. */
const SURFACE_SCRIPTS = ['harvest-console.js', 'blade-studio.js', 'blade-studio-gl.js'];
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
function createOceanLabRoutes(arg = {}) {
    const isOpts = arg !== null && typeof arg === 'object' && ('requiresAuth' in arg || 'ctx' in arg);
    const opts = isOpts ? arg : { ctx: arg };
    const appPackageDir = opts.ctx?.appPackageDir;
    const sub = { appPackageDir, requiresAuth: opts.requiresAuth };
    const router = (0, express_1.Router)();
    // ── The bundled surfaces ───────────────────────────────────────────────────
    // Both pages probe `assets/<file>` relative to their own URL first, which resolves to
    // /api/ocean-lab/assets/<file> — hence the top-level assets mount alongside the per-half ones.
    const harvestConsole = (0, surface_files_1.surfaceFile)(appPackageDir, 'harvest-console.html');
    const bladeStudio = (0, surface_files_1.surfaceFile)(appPackageDir, 'blade-studio.html');
    logger.info({ harvestConsole, bladeStudio, appPackageDir }, 'Resolved the ocean-lab surfaces');
    router.get('/app', (0, surface_files_1.serveSurfaceFile)(harvestConsole, 'html'));
    router.get('/harvest-console', (0, surface_files_1.serveSurfaceFile)(harvestConsole, 'html'));
    router.get('/blade-studio', (0, surface_files_1.serveSurfaceFile)(bladeStudio, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS) {
        assets.get(`/${file}`, (0, surface_files_1.serveSurfaceFile)((0, surface_files_1.surfaceFile)(appPackageDir, file), 'application/javascript'));
    }
    router.use('/assets', assets);
    /**
     * GET /capabilities — the bound tables both surfaces pre-validate their forms against, so a form
     * and the server cannot disagree about what is admissible. No engine probe: the models are
     * in-process TypeScript, so there is nothing that can be absent at runtime.
     */
    router.get('/capabilities', (_req, res) => {
        res.json({
            app: 'ocean-lab',
            domains: ['marine', 'ground', 'rotor'],
            surfaces: [
                { name: 'harvest-console', url: '/api/ocean-lab/harvest-console' },
                { name: 'blade-studio', url: '/api/ocean-lab/blade-studio' },
            ],
            limits: { harvest: harvest_routes_1.HARVEST_LIMITS, rotor: rotor_routes_1.ROTOR_LIMITS },
            provenance: 'illustrative parameters over real models — not survey data, no hardware built',
        });
    });
    router.use('/harvest', (0, harvest_routes_1.createHarvestRoutes)(sub));
    router.use('/rotor', (0, rotor_routes_1.createRotorRoutes)(sub));
    return router;
}
