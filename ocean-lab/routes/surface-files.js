"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — package-local replacement for the core
 *                     |                             | `@/app/server-ui-assets` helper the two route modules used
 *                     |                             | while they lived in the kernel. A store package cannot reach
 *                     |                             | into `src/api`, so surfaces resolve from THIS package's
 *                     |                             | tools/ directory via ctx.appPackageDir (ADR-085 D10), with a
 *                     |                             | load-time env fallback for frameworks predating it and a
 *                     |                             | routes/-relative fallback for tests run straight off disk.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passthrough = void 0;
exports.surfaceFile = surfaceFile;
exports.serveSurfaceFile = serveSurfaceFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'ocean-lab-surface-files' });
/**
 * @description Load-time-only fallback for frameworks predating `ctx.appPackageDir`. Read ONCE at
 * require time on purpose: the process-global is set immediately before the loader requires this
 * module, so a request-time read would return whichever package mounted last.
 */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve one bundled surface file inside this package's `tools/` directory.
 *
 * Every candidate is built from constants plus the package directory the framework handed us —
 * `fileName` is never request-derived, which is the whole traversal argument: there is no join with
 * caller input to escape from.
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
    return candidates.find((candidate) => node_fs_1.default.existsSync(candidate)) || candidates[candidates.length - 1];
}
/**
 * @description Serve a bundled surface file from an ABSOLUTE path fixed at mount time.
 *
 * The bytes are read per request rather than cached because a package directory can be edited in
 * place during development; caching them makes an edit invisible until a restart, which is the
 * shape where half a console works and nobody can see why.
 * @param filePath - Absolute path resolved once by {@link surfaceFile}.
 * @param contentType - `html` or `application/javascript`.
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
/**
 * @description A no-op middleware used when no guard is injected. The package manifest declares
 * `requiresAuth: true` on the mount, so the framework wraps the WHOLE router before any of this
 * runs; the injectable parameter exists so a guard spec can prove the 401 without booting a server.
 * @param _req - Unused.
 * @param _res - Unused.
 * @param next - Continue.
 * @returns Nothing.
 */
const passthrough = (_req, _res, next) => {
    next();
};
exports.passthrough = passthrough;
