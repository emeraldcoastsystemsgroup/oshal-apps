"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its scripts from this package's
 *                     |                             | tools/ (ctx.appPackageDir), publishes `/capabilities` (the
 *                     |                             | feature contract the routes enforce, the engine's status and
 *                     |                             | the exact install command when it is down), owns ONE engine
 *                     |                             | client per api process, and composes the model router under
 *                     |                             | the `/api/cad-studio` mount. The manifest's `auth: oidc` wraps
 *                     |                             | the whole mount; every handler still re-derives the caller.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.installHint = installHint;
exports.createCadStudioRoutes = createCadStudioRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const feature_contract_1 = require("./feature-contract");
const engine_build_hash_1 = require("./engine-build-hash");
const engine_client_1 = require("./engine-client");
const data_dir_1 = require("./data-dir");
const model_routes_1 = require("./model-routes");
const rebuild_service_1 = require("./rebuild-service");
const logger = (0, logger_1.createChildLogger)({ module: 'cad-studio-routes' });
const SURFACE_SCRIPTS = ['cad-studio.js', 'cad-studio-gl.js'];
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
function callerSub(req) {
    const r = req;
    return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}
function packageFile(appPackageDir, ...rel) {
    const candidates = [appPackageDir ? node_path_1.default.join(appPackageDir, ...rel) : '', LOAD_TIME_PACKAGE_DIR ? node_path_1.default.join(LOAD_TIME_PACKAGE_DIR, ...rel) : '', node_path_1.default.resolve(__dirname, '..', ...rel)].filter(Boolean);
    return candidates.find((c) => node_fs_1.default.existsSync(c)) || candidates[candidates.length - 1];
}
function serveFile(filePath, contentType) {
    return (_req, res) => {
        try {
            const source = node_fs_1.default.readFileSync(filePath, 'utf8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.type(contentType).send(source);
        }
        catch (error) {
            logger.error({ err: error, filePath }, 'Bundled surface file is not readable');
            res.status(404).json({ error: 'surface_file_not_found' });
        }
    };
}
/**
 * @description The install command the surface and /capabilities print when the engine is down.
 * @param env - Environment (OSHAL_API_CONTAINER names the api container when known).
 * @returns The exact command.
 */
function installHint(env) {
    const api = (env.OSHAL_API_CONTAINER || env.HOSTNAME || '<api-container>').trim();
    return `docker exec ${api} sh /app/workspace-shared/deployed-apps/cad-studio/engine/install-engine.sh`;
}
/**
 * @description Build the `/api/cad-studio` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @param opts - Spec overrides; see {@link CadStudioRouteOpts}.
 * @returns The composed router.
 */
function createCadStudioRoutes(ctx, opts = {}) {
    const env = opts.env ?? process.env;
    const dataRoot = opts.dataRoot ?? (0, data_dir_1.resolveDataRoot)(env);
    const appPackageDir = ctx.appPackageDir;
    const engineDir = packageFile(appPackageDir, 'engine');
    const engineBuild = opts.engineBuild !== undefined ? opts.engineBuild : (0, engine_build_hash_1.engineBuildHash)(engineDir);
    const hint = installHint(env);
    const addr = (0, engine_client_1.parseEngineAddr)(env.CAD_STUDIO_ENGINE_ADDR || engine_client_1.DEFAULT_ENGINE_ADDR);
    const engine = opts.engine ?? new engine_client_1.EngineClient({ host: addr.host, port: addr.port, expectedBuildHash: engineBuild, installHint: hint });
    const router = (0, express_1.Router)();
    const surface = packageFile(appPackageDir, 'tools', 'cad-studio.html');
    logger.info({ surface, appPackageDir, dataRoot, engine: `${addr.host}:${addr.port}`, engineBuild }, 'Resolved the cad-studio surface');
    router.get('/app', serveFile(surface, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS)
        assets.get(`/${file}`, serveFile(packageFile(appPackageDir, 'tools', file), 'application/javascript'));
    router.use('/assets', assets);
    router.get('/capabilities', (_req, res) => {
        res.json({
            app: 'cad-studio', kernel: 'OCCT via CadQuery (engine container)', contract: (0, feature_contract_1.describeContract)(), featureInputSchema: feature_contract_1.FEATURE_INPUT_SCHEMA,
            exports: { formats: ['step', 'stl', 'svg', 'report'], views: rebuild_service_1.EXPORT_VIEWS }, defaults: rebuild_service_1.DEFAULT_SETTINGS, upload: model_routes_1.UPLOAD_LIMITS,
            engine: engine.status(),
        });
    });
    router.use((0, model_routes_1.createModelRoutes)({ pool: ctx.pool, engine, dataRoot, engineBuild, callerSub, timeoutMs: opts.rebuildTimeoutMs }));
    return router;
}
//# sourceMappingURL=cad-studio-routes.js.map