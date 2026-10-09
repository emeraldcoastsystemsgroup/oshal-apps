"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's mounted factory. Serves the
 *                     |                             | bundled surface and its script from this package's tools/
 *                     |                             | (ctx.appPackageDir), publishes `/capabilities` (the engine's
 *                     |                             | versions and the upstream MCP tools with their schemas, or —
 *                     |                             | when the engine is down or stale — the honest reason and the
 *                     |                             | exact install command), owns ONE engine client per api process,
 *                     |                             | and composes the project router under `/api/scene-studio`. The
 *                     |                             | manifest's `auth: oidc` wraps the mount; handlers re-derive the
 *                     |                             | caller.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: this factory is the one place the package registers with
 *                     |                             | the kernel at activation — the `scene` resource adapter of the
 *                     |                             | ADR-149 catalog (scene-authorization.ts) and the director's 22
 *                     |                             | in-process package tools (scene-tools.ts), which share this
 *                     |                             | factory's one engine client (its FIFO and the project locks) with
 *                     |                             | the studio. `/capabilities` and the scene-capabilities tool answer
 *                     |                             | from one cache (scene-capabilities.ts, moved here unchanged).
 *                     |                             | New behaviour lives only in new modules and in this route entry,
 *                     |                             | the module the mounter reloads on a hot update.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Select the admitted native engine and atomic owner file root while preserving legacy sockets.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.installHint = installHint;
exports.createSceneStudioRoutes = createSceneStudioRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const engine_build_hash_1 = require("./engine-build-hash");
const engine_client_1 = require("./engine-client");
const data_dir_1 = require("./data-dir");
const project_routes_1 = require("./project-routes");
const scene_authorization_1 = require("./scene-authorization");
const scene_capabilities_1 = require("./scene-capabilities");
const scene_tools_1 = require("./scene-tools");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-routes' });
const SURFACE_SCRIPTS = ['scene-studio.js'];
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
    return `docker exec ${api} sh /app/workspace-shared/deployed-apps/scene-studio/engine/install-engine.sh`;
}
function capabilitiesRoute(capabilities) {
    return async (_req, res) => {
        try {
            res.json(await capabilities());
        }
        catch (error) {
            logger.error({ err: error }, 'Scene Studio capabilities failed');
            res.status(500).json({ error: 'capabilities_failed' });
        }
    };
}
function nativeContext(ctx) {
    return ctx.pool.storageModel === 'kernel-scoped-documents';
}
/** Keep legacy sockets as-is; a native package has only its admitted fixed service capability. */
function sceneEngine(ctx, opts, env, build) {
    if (opts.engine)
        return opts.engine;
    const addr = (0, engine_client_1.parseEngineAddr)(env.SCENE_STUDIO_ENGINE_ADDR || engine_client_1.DEFAULT_ENGINE_ADDR);
    if (!nativeContext(ctx))
        return new engine_client_1.EngineClient({ ...addr, expectedBuildHash: build, installHint: installHint(env) });
    const native = ctx;
    return new engine_client_1.EngineClient({ ...addr, expectedBuildHash: null, installHint: 'Enable the operator-owned native Scene engine.',
        nativeRequest: async (op, fields, timeoutMs) => {
            if (typeof native.intent !== 'function')
                throw new Error('Native Scene intent capability is unavailable');
            return await native.intent('scene.engine', { op, fields, timeoutMs });
        } });
}
/**
 * @description Build the `/api/scene-studio` router, and register the package's authorization
 * resource and its 22 package tools with the kernel while the package activates.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool`, `appPackageDir`, and the
 * activation-scoped `authorization` and `tools` ports (absent in an isolated route test).
 * @param opts - Spec overrides; see {@link SceneStudioRouteOpts}.
 * @returns The composed router.
 */
function createSceneStudioRoutes(ctx, opts = {}) {
    const env = opts.env ?? process.env;
    const dataRoot = opts.dataRoot ?? (nativeContext(ctx) ? '/tmp/scene-store' : (0, data_dir_1.resolveDataRoot)(env));
    const engineDir = packageFile(ctx.appPackageDir, 'engine');
    const engineBuild = opts.engineBuild !== undefined ? opts.engineBuild : nativeContext(ctx) ? null : (0, engine_build_hash_1.engineBuildHash)(engineDir);
    const engine = sceneEngine(ctx, opts, env, engineBuild);
    const engineCaps = (0, scene_capabilities_1.capabilityCache)(engine);
    const capabilities = () => (0, scene_capabilities_1.describeCapabilities)(engine, engineCaps);
    (0, scene_authorization_1.registerSceneStudioAuthorization)(ctx);
    const deps = { pool: ctx.pool, engine, dataRoot, capabilities, callerSub,
        get engineBuild() { return nativeContext(ctx) ? engine.status().buildHash : engineBuild; } };
    (0, scene_tools_1.registerSceneStudioTools)(ctx, deps);
    const router = (0, express_1.Router)();
    const surface = packageFile(ctx.appPackageDir, 'tools', 'scene-studio.html');
    logger.info({ surface, dataRoot, engine: engine.status().address, engineBuild }, 'Resolved the scene-studio surface');
    router.get('/app', serveFile(surface, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS)
        assets.get(`/${file}`, serveFile(packageFile(ctx.appPackageDir, 'tools', file), 'application/javascript'));
    router.use('/assets', assets);
    router.get('/capabilities', capabilitiesRoute(capabilities));
    router.use((0, project_routes_1.createProjectRoutes)(deps));
    return router;
}
