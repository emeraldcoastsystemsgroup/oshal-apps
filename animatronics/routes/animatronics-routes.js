"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its scripts from this package's tools/
 *                     |                             | (ctx.appPackageDir), publishes `/capabilities` (the rig and
 *                     |                             | behaviour contracts, the controller protocol, the templates,
 *                     |                             | the servo catalog summary and the `prop` kind vocabulary),
 *                     |                             | `/catalog/servos` and `/templates`, and composes the rig
 *                     |                             | router under the `/api/animatronics` mount. The manifest's
 *                     |                             | `auth: oidc` wraps the whole mount; every handler still
 *                     |                             | re-derives the caller.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerSub = callerSub;
exports.createAnimatronicsRoutes = createAnimatronicsRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const rig_contract_1 = require("./engine/rig-contract");
const scenario_1 = require("./engine/scenario");
const protocol_1 = require("./engine/protocol");
const catalog_1 = require("./engine/catalog");
const templates_1 = require("./engine/templates");
const kind_1 = require("./engine/kind");
const rig_routes_1 = require("./rig-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'animatronics-routes' });
const SURFACE_SCRIPTS = ['animatronics.js', 'animatronics-view.js', 'animatronics-serial.js'];
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
 * @description The compiled protocol module (routes/engine/protocol.js — no imports, CommonJS) wrapped for
 * the browser as `window.AnimatronicsProtocol`, so the page encodes E-STOP and parses replies with the
 * very same code the server used to write the frames. One source, two runtimes, no copy.
 */
const serveProtocolModule = (_req, res) => {
    try {
        const source = node_fs_1.default.readFileSync(node_path_1.default.join(__dirname, 'engine', 'protocol.js'), 'utf8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.type('application/javascript').send(`(function () {\nvar exports = {}; var module = { exports: exports };\n${source}\nwindow.AnimatronicsProtocol = module.exports;\n})();\n`);
    }
    catch (error) {
        logger.error({ err: error }, 'Compiled protocol module is not readable');
        res.status(404).json({ error: 'surface_file_not_found' });
    }
};
/**
 * @description Build the `/api/animatronics` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
function createAnimatronicsRoutes(ctx) {
    const appPackageDir = ctx.appPackageDir;
    const router = (0, express_1.Router)();
    const surface = packageFile(appPackageDir, 'tools', 'animatronics.html');
    logger.info({ surface, appPackageDir }, 'Resolved the animatronics surface');
    router.get('/app', serveFile(surface, 'html'));
    const assets = (0, express_1.Router)();
    for (const file of SURFACE_SCRIPTS)
        assets.get(`/${file}`, serveFile(packageFile(appPackageDir, 'tools', file), 'application/javascript'));
    assets.get('/protocol.js', serveProtocolModule);
    router.use('/assets', assets);
    const catalog = (0, catalog_1.loadServoCatalog)(packageFile(appPackageDir, 'catalog', 'servos.json'));
    const rows = (0, catalog_1.servoMap)(catalog.servos);
    const templates = (0, templates_1.buildTemplates)(rows);
    logger.info({ servos: catalog.servos.length, controllers: catalog.controllers.length, templates: templates.length }, 'Loaded the servo catalog and the rig templates');
    router.get('/capabilities', (_req, res) => {
        res.json({
            app: 'animatronics',
            contract: (0, rig_contract_1.describeRigContract)(),
            behaviour: (0, scenario_1.describeBehaviourContract)(),
            protocol: (0, protocol_1.describeProtocol)(),
            kind: { kind: kind_1.PROP_KIND, owner: kind_1.PROP_VOCABULARY_OWNER, ...kind_1.PROP_VOCABULARY, confirmExempt: [...kind_1.PROP_CONFIRM_EXEMPT] },
            catalog: { servos: catalog.servos.length, controllers: catalog.controllers.length, path: '/api/animatronics/catalog/servos' },
            templates: templates.map((t) => ({ id: t.id, title: t.title, description: t.description, channels: t.rig.channels.length, poses: Object.keys(t.poses), scenarios: Object.keys(t.scenarios) })),
            rail: 'draft → rehearse → arm (confirm) → play / look-at / jog → disarm (e-stop)',
        });
    });
    router.get('/catalog/servos', (req, res) => {
        const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
        if (kind && kind !== 'hobby' && kind !== 'bus') {
            res.status(400).json({ error: 'invalid_input', field: 'kind', message: 'kind must be hobby or bus' });
            return;
        }
        res.json({ servos: kind ? catalog.servos.filter((s) => s.kind === kind) : catalog.servos, controllers: catalog.controllers });
    });
    router.get('/templates', (_req, res) => { res.json({ templates }); });
    router.use((0, rig_routes_1.createRigRoutes)({ pool: ctx.pool, callerSub, catalog: rows, templates }));
    return router;
}
