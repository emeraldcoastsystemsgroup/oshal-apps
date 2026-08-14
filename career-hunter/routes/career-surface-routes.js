"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract native surfaces, static assets, and the caller-scoped classic board from the composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retire the unbounded persistent classic-board process and redirect legacy links to the native board.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCareerToolFileHandler = createCareerToolFileHandler;
exports.registerCareerSurfaceRoutes = registerCareerSurfaceRoutes;
exports.registerCareerClassicBoardRoutes = registerCareerClassicBoardRoutes;
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'career-surface-routes' });
const TOOL_DIR = path_1.default.resolve(__dirname, '..', 'tools');
/**
 * @description Create a no-cache handler for one package-owned Career surface.
 * @param fileName basename of the HTML asset under the package tools directory
 * @returns Express handler that serves the asset without stale browser caching
 */
function createCareerToolFileHandler(fileName) {
    return (_req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.sendFile(path_1.default.join(TOOL_DIR, fileName), (err) => {
            if (err) {
                logger.error({ err, fileName }, 'career surface serve failed');
                res.status(404).send('Not found');
            }
        });
    };
}
/** Serve one allowlisted static asset and log package/path drift. */
function serveStatic(req, res) {
    const file = path_1.default.basename(String(req.params.file));
    if (!/\.(css|js|png|svg)$/.test(file)) {
        res.status(404).end();
        return;
    }
    res.sendFile(path_1.default.join(TOOL_DIR, file), (err) => {
        if (err) {
            logger.error({ err, file }, 'career static asset serve failed');
            res.status(404).end();
        }
    });
}
/** Redirect retired classic-board URLs to the bounded native surface. */
function redirectClassicBoard(_req, res) {
    res.redirect(308, '/api/career-hunter/board-native');
}
/**
 * @description Register package-owned HTML and static surfaces before feature data routes.
 * @param router authenticated Career Hunter router
 * @returns nothing
 */
function registerCareerSurfaceRoutes(router) {
    router.get('/board-native', createCareerToolFileHandler('career-board.html'));
    // Search Jobs — the corpus, not the caller's scored matches. Deliberately a separate
    // screen from the board: it works with no résumé indexed, and has no fit/pipeline concept.
    router.get('/search-ui', createCareerToolFileHandler('career-search.html'));
    router.get('/recruiters-ui', createCareerToolFileHandler('career-recruiters.html'));
    router.get('/strengthen-ui', createCareerToolFileHandler('career-strengthen.html'));
    router.get('/insights-ui', createCareerToolFileHandler('career-insights.html'));
    router.get('/approvals', createCareerToolFileHandler('career-approvals.html'));
    router.get('/settings', createCareerToolFileHandler('career-settings.html'));
    router.get('/resume-studio', createCareerToolFileHandler('career-resume-studio.html'));
    router.get('/mobile', createCareerToolFileHandler('career-mobile.html'));
    router.get('/submissions', createCareerToolFileHandler('career-submissions.html'));
    router.get('/static/:file', serveStatic);
}
/**
 * @description Keep historical classic-board URLs working without starting persistent children.
 * @param router authenticated Career Hunter router
 * @param _ctx retained context parameter for registrar compatibility
 * @returns nothing
 */
function registerCareerClassicBoardRoutes(router, _ctx) {
    router.get('/board', redirectClassicBoard);
    router.get('/board/*boardPath', redirectClassicBoard);
}
//# sourceMappingURL=career-surface-routes.js.map