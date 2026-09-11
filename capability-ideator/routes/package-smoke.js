"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the bounded, service-authenticated CORE-05 package-readiness endpoint.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Contain a resolved manifest path beneath its real package root before reading readiness metadata.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPackageSmokeRoutes = createPackageSmokeRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const MAX_MANIFEST_BYTES = 128 * 1024;
const PACKAGE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Read one plain top-level manifest scalar without accepting aliases or interpolation. */
function manifestScalar(source, key) {
    const match = source.match(new RegExp(`^${key}:\\s*([^#\\r\\n]+)`, 'm'));
    return String(match?.[1] || '').trim().replace(/^(['"])(.*)\1$/, '$2');
}
/**
 * Package-owned install readiness. This route reads only the installed package manifest: it does
 * not resolve a user, query tenant data, call a provider, mutate state, or spend AI tokens.
 */
function createPackageSmokeRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', (_req, res) => {
        try {
            if (!ctx.appPackageDir)
                throw new Error('package context unavailable');
            const packageRoot = node_fs_1.default.realpathSync(ctx.appPackageDir);
            const manifestPath = node_path_1.default.join(packageRoot, 'oshal-app.yaml');
            const resolvedManifest = node_fs_1.default.realpathSync(manifestPath);
            const relativeManifest = node_path_1.default.relative(packageRoot, resolvedManifest);
            if (!relativeManifest || relativeManifest.startsWith('..') || node_path_1.default.isAbsolute(relativeManifest)) {
                throw new Error('package manifest escapes its package root');
            }
            const stat = node_fs_1.default.statSync(resolvedManifest);
            if (!stat.isFile() || stat.size === 0 || stat.size > MAX_MANIFEST_BYTES) {
                throw new Error('package manifest is not a bounded regular file');
            }
            const manifest = node_fs_1.default.readFileSync(resolvedManifest, 'utf8');
            const packageName = manifestScalar(manifest, 'name');
            const version = manifestScalar(manifest, 'version');
            if (!PACKAGE_NAME.test(packageName) || !PACKAGE_VERSION.test(version)) {
                throw new Error('package identity is invalid');
            }
            res.json({ status: 'ready', package: packageName, version, manifest: 'verified' });
        }
        catch {
            res.status(503).json({ status: 'unavailable', code: 'package_integrity_failed' });
        }
    });
    return router;
}
//# sourceMappingURL=package-smoke.js.map
