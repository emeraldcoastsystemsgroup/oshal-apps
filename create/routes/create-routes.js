"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial — serve the Create home surface and the package skin from the installed package dir
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | GET /new — the purpose-first New screen
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCreateRoutes = createCreateRoutes;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const express_1 = require("express");
/**
 * @description Resolve the installed package root ONCE, when the factory runs. `ctx.appPackageDir` is
 * the framework's contract; the env var is the load-time fallback for older frameworks and is never
 * read per request (after load it names whichever package the loader mounted LAST).
 * @param ctx - Framework context handed to the factory.
 * @returns Absolute package root.
 */
function packageRoot(ctx) {
    if (ctx.appPackageDir)
        return path.resolve(ctx.appPackageDir);
    if (process.env.OSHAL_APP_PACKAGE_DIR)
        return path.resolve(process.env.OSHAL_APP_PACKAGE_DIR);
    return path.resolve(__dirname, '..');
}
/**
 * @description Send one bundled file with the exact content type the surface expects, refusing to
 * serve anything the package does not ship (a missing file is a 404, never a stack trace).
 * @param res - Express response.
 * @param file - Absolute path inside the package.
 * @param type - Content type to send.
 * @returns void
 */
function sendBundled(res, file, type) {
    if (!fs.existsSync(file)) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type(type);
    res.sendFile(file);
}
/**
 * @description The Create package's own routes: its home surface and the skin the cockpit wears while
 * the app is focused. Both are static files bundled beside the manifest; nothing here reads a store,
 * calls a provider, or mutates state — the member studios own their domains.
 * @param ctx - Framework context (only `appPackageDir` is read).
 * @returns Express router mounted at /api/create.
 */
function createCreateRoutes(ctx) {
    const root = packageRoot(ctx);
    const home = path.join(root, 'tools', 'create-home.html');
    const fresh = path.join(root, 'tools', 'create-new.html');
    const skin = path.join(root, 'ui', 'create.css');
    const router = (0, express_1.Router)();
    router.get('/home', (_req, res) => sendBundled(res, home, 'text/html; charset=utf-8'));
    router.get('/new', (_req, res) => sendBundled(res, fresh, 'text/html; charset=utf-8'));
    router.get('/theme.css', (_req, res) => sendBundled(res, skin, 'text/css; charset=utf-8'));
    return router;
}
//# sourceMappingURL=create-routes.js.map