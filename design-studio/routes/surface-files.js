"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203, lane @ds-app: package-local surface serving (the embodied /
 *                     |                             | scan-to-print idiom). The screen's files resolve from THIS
 *                     |                             | package's tools/ directory via ctx.appPackageDir (ADR-085 D10),
 *                     |                             | with a load-time env fallback for frameworks predating it and a
 *                     |                             | routes/-relative fallback for tests run straight off disk. The
 *                     |                             | file names are constants: a request never names a file.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: design-studio-fabricate.js (the print set
 *                     |                             | made through CAD Studio and sent to a printer) joins the scripts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the Mechanism screen's script (design-studio-mechanism.js) joins the served list.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURFACE_FILES = void 0;
exports.surfaceFile = surfaceFile;
exports.serveSurfaceFile = serveSurfaceFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'design-studio-surface-files' });
/** @description Load-time-only fallback for frameworks predating `ctx.appPackageDir`, read ONCE on purpose. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/** @description The screen's files inside `tools/`: the page, the scripts and the sheet. */
exports.SURFACE_FILES = Object.freeze({
    page: 'design-studio.html',
    scripts: ['design-studio.js', 'design-studio-stages.js', 'design-studio-screens.js', 'design-studio-fabricate.js', 'design-studio-mechanism.js', 'design-studio-orders.js'],
    style: 'design-studio.css',
});
/**
 * @description Resolve one bundled surface file inside this package's `tools/` directory.
 * @param appPackageDir - This package's directory, from the per-package AppContext.
 * @param fileName - Bare filename inside `tools/`.
 * @returns The first candidate that exists, or the last one so `sendFile` produces the 404.
 */
function surfaceFile(appPackageDir, fileName) {
    const candidates = [
        appPackageDir ? node_path_1.default.join(appPackageDir, 'tools', fileName) : '',
        LOAD_TIME_PACKAGE_DIR ? node_path_1.default.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
        node_path_1.default.resolve(__dirname, '../tools', fileName),
    ].filter(Boolean);
    const found = candidates.find((candidate) => node_fs_1.default.existsSync(candidate)) || candidates[candidates.length - 1];
    logger.debug({ fileName, found }, 'Resolved a surface file');
    return found;
}
/**
 * @description Serve a bundled surface file from an ABSOLUTE path fixed at mount time. Bytes are read per
 * request so an in-place edit during development is visible without a restart.
 * @param filePath - Absolute path resolved once by {@link surfaceFile}.
 * @param contentType - `html`, `application/javascript` or `text/css`.
 * @returns An Express handler that sends the file, or 404 when it is not on disk.
 */
function serveSurfaceFile(filePath, contentType) {
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
//# sourceMappingURL=surface-files.js.map