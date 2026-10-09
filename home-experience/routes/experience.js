"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExperienceRoutes = createExperienceRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve package-owned Home metadata/assets under the existing application authority; member data routes remain owned by their applications.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serve the fixed owned attention asset under the same application read gate.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
/** @description Mount only the declared Home entry and assets; grants and business records are outside this package.
 * @param ctx Trusted package context, including its activation-only authorization port.
 * @returns The package router. */
function createExperienceRoutes(ctx) {
    if (!ctx.authorization || !ctx.appPackageDir)
        throw new Error('Home requires experience hosting and application authorization');
    ctx.authorization.registerResource('application', {
        authorize: async ({ actor, grant, fields }) => actor.isActive && Boolean(actor.sub?.trim()) && Boolean(actor.issuer?.trim())
            && grant.scope === 'own' && fields.length === 0,
    });
    const root = node_fs_1.default.realpathSync(node_path_1.default.join(ctx.appPackageDir, 'ui'));
    const router = (0, express_1.Router)();
    const send = (filename) => (_req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const file = node_fs_1.default.realpathSync(node_path_1.default.join(root, filename));
            if (!file.startsWith(root + node_path_1.default.sep) || !node_fs_1.default.statSync(file).isFile())
                throw new Error('Asset unavailable');
            res.sendFile(file, error => { if (error && !res.headersSent)
                res.status(503).json({ error: 'experience_asset_unavailable' }); });
        }
        catch {
            res.status(503).json({ error: 'experience_asset_unavailable' });
        }
    };
    router.get('/app', send('index.html'));
    router.get('/assets/config.js', send('config.js'));
    router.get('/assets/home-attention.js', send('home-attention.js'));
    router.get('/assets/homebase.css', send('homebase.css'));
    return router;
}
//# sourceMappingURL=experience.js.map