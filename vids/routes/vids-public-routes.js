"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVidsPublicRoutes = createVidsPublicRoutes;
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Replace directory-membership publication with a committed, revocable per-export token. Anonymous reads grant no job/control access and are never cached.
 */
const express_1 = require("express");
const vids_artifacts_1 = require("./vids-artifacts");
const vids_artifact_files_1 = require("./vids-artifact-files");
function createVidsPublicRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
    router.get('/:token/video.mp4', async (req, res) => {
        const token = String(req.params.token);
        if (!/^[a-f0-9]{64}$/.test(token)) {
            res.status(404).end();
            return;
        }
        try {
            const row = await (0, vids_artifacts_1.publicArtifact)(ctx, token);
            if (!row) {
                res.status(404).end();
                return;
            }
            await (0, vids_artifact_files_1.serveVideo)(req, res, row);
        }
        catch (error) {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            res.status(error.code === 'ENOENT' ? 404 : 503).end();
        }
    });
    return router;
}
//# sourceMappingURL=vids-public-routes.js.map