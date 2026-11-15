"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve Finance's own pages and the files its page frame is made of (Roger, 2026-11-12: Finance as a person's money day, "done in the same fashion" as Little Monsters and Career). GET /api/finance/p/<name> answers tools/finance-<name>.html (Transactions, Accounts, and each page a later lane adds as a file, with no change here), and GET /api/finance/p/static/<file> answers a stylesheet, script or mark under tools/ whose name starts with finance-. Only those two shapes are answered, the name is matched against a closed pattern before the disk is touched, and the file must resolve inside the package's own tools directory. The module reads no person's data, calls no provider and writes nothing; it is mounted on its own path so the page lane does not edit finance-routes.ts. Home stays at /api/finance/app, served there.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.7.0 (Lane FINH1b, 2026-11-14): the route comes onto 1.6.5 without the 2026-11-12 page frame. It serves the record pages Finance's own bar shows (Accounts, Transactions, Bills, Spending, Goals: tools/finance-<name>.html) and the two files they share (finance-records.css, finance-records.js). Unchanged rules: a closed name pattern, nothing outside tools/, no data read, nothing written.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFinancePagesRoutes = createFinancePagesRoutes;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
/** A page's short name: `transactions` serves tools/finance-transactions.html. */
const PAGE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** A frame file: a stylesheet, script or mark of this package whose name starts with finance-. */
const STATIC_NAME = /^finance-[a-z0-9-]{1,40}\.(css|js|svg)$/;
const CONTENT_TYPES = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    svg: 'image/svg+xml',
};
/**
 * @description Read one file of the package's tools directory, refusing anything that resolves outside it.
 * @param toolsDir The package's tools directory.
 * @param fileName A file name already matched against a closed pattern.
 * @returns The file's bytes, or null when it is absent, not a regular file, or outside the directory.
 */
function readToolFile(toolsDir, fileName) {
    try {
        const root = node_fs_1.default.realpathSync(toolsDir);
        const resolved = node_fs_1.default.realpathSync(node_path_1.default.join(root, fileName));
        const relative = node_path_1.default.relative(root, resolved);
        if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative) || !node_fs_1.default.statSync(resolved).isFile())
            return null;
        return node_fs_1.default.readFileSync(resolved);
    }
    catch {
        return null;
    }
}
/**
 * @description Answer one tools file, or 404 in words when there is none by that name.
 * @param res The response.
 * @param toolsDir The package's tools directory.
 * @param fileName A file name already matched against a closed pattern, or an empty string for a refused name.
 * @returns Nothing.
 */
function sendToolFile(res, toolsDir, fileName) {
    const bytes = fileName ? readToolFile(toolsDir, fileName) : null;
    if (!bytes) {
        res.status(404).type('text/plain; charset=utf-8').send('Not found');
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type(CONTENT_TYPES[fileName.slice(fileName.lastIndexOf('.') + 1)]).send(bytes);
}
/**
 * @description Finance's page routes: its own pages by name and the files of its page frame. Pages hold no data; each
 * reads the signed-in person's own records from Finance's other routes in the browser.
 * @param ctx The package context; `appPackageDir` is where the package is installed.
 * @returns The router, mounted at /api/finance/p.
 */
function createFinancePagesRoutes(ctx) {
    const router = (0, express_1.Router)();
    const toolsDir = node_path_1.default.join(ctx?.appPackageDir || process.env.OSHAL_APP_PACKAGE_DIR || node_path_1.default.resolve(__dirname, '..'), 'tools');
    router.get('/static/:file', (req, res) => {
        const file = String(req.params.file || '');
        sendToolFile(res, toolsDir, STATIC_NAME.test(file) ? file : '');
    });
    router.get('/:page', (req, res) => {
        const page = String(req.params.page || '');
        sendToolFile(res, toolsDir, PAGE_NAME.test(page) ? `finance-${page}.html` : '');
    });
    return router;
}
//# sourceMappingURL=finance-pages.js.map