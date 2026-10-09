"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D5 in ocean-lab: "every run result carries its medium
 *                     |                             | id and engine fingerprints, or it is not displayed." The package
 *                     |                             | version is read from the installed manifest (a real version or
 *                     |                             | null, never a placeholder), the engine tree is hashed over every
 *                     |                             | module under this package's engine directory with line endings
 *                     |                             | folded, and `displayabilityProblems` names every field a run
 *                     |                             | lacks. The same two fields embodied's `oshal.run-result/1`
 *                     |                             | carries (engine.packageVersion, engine.routesBuildHash) are what
 *                     |                             | make a foreign run displayable here, so an ingested hull drop is
 *                     |                             | held to exactly the rule its own lab applies.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHA256_HEX = exports.VERSION = exports.RUN_RESULT_SCHEMA = void 0;
exports.readPackageVersion = readPackageVersion;
exports.hashEngineTree = hashEngineTree;
exports.routesEngineBuildHash = routesEngineBuildHash;
exports.displayabilityProblems = displayabilityProblems;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'ocean-lab-run-fingerprint' });
/** The shape every displayed run result carries (embodied's schema id, shared as a contract). */
exports.RUN_RESULT_SCHEMA = 'oshal.run-result/1';
/** A real version string, the shape a manifest's `version:` carries. */
exports.VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A sha256 in hex — the only shape a build hash takes. */
exports.SHA256_HEX = /^[0-9a-f]{64}$/;
/** @description The installed package's `version:`, read from its manifest without a YAML runtime.
 * @param packageDir - The package root that holds `oshal-app.yaml`. @returns A real version, or null — the caller must then refuse to fingerprint, never invent one. */
function readPackageVersion(packageDir) {
    try {
        const manifest = node_fs_1.default.readFileSync(node_path_1.default.join(packageDir, 'oshal-app.yaml'), 'utf8');
        const match = /^version:\s*([^#\r\n]+)/m.exec(manifest);
        const version = String(match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
        if (exports.VERSION.test(version))
            return version;
        logger.error({ packageDir, version: version || null }, 'package manifest carries no real version — no run can be fingerprinted (ADR-160 D5)');
        return null;
    }
    catch (err) {
        logger.error({ err, stack: err.stack, packageDir }, 'package manifest unreadable — no run can be fingerprinted (ADR-160 D5)');
        return null;
    }
}
/** Every engine module under a tree, as sorted POSIX-relative paths (source maps and type declarations are not part of a build's identity). */
function engineModules(root, rel = '', out = []) {
    for (const entry of node_fs_1.default.readdirSync(node_path_1.default.join(root, rel), { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory())
            engineModules(root, childRel, out);
        else if (entry.isFile() && /\.(?:js|ts|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
            out.push(childRel);
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
/** The engine tree this module was loaded from (routes/engine when compiled). */
const OWN_ENGINE_ROOT = node_path_1.default.resolve(__dirname, '..');
let ownTreeHash = null;
/** @description sha256 over every engine module under a tree, each prefixed by its relative name, CRLF folded to LF so a Windows checkout and the deployed Linux copy of one commit agree.
 * @param root - The engine directory. @returns Hex sha256, or null when the tree holds no module (a hash over nothing names no engine). */
function hashEngineTree(root) {
    let modules;
    try {
        modules = engineModules(root);
    }
    catch (err) {
        logger.error({ err, stack: err.stack, root }, 'engine tree unreadable — no run can be fingerprinted (ADR-160 D5)');
        return null;
    }
    if (modules.length === 0) {
        logger.error({ root }, 'engine tree empty — a hash over nothing names no engine (ADR-160 D5)');
        return null;
    }
    const digest = (0, node_crypto_1.createHash)('sha256');
    for (const rel of modules) {
        digest.update(Buffer.from(`${rel}\0`, 'utf8'));
        digest.update(node_fs_1.default.readFileSync(node_path_1.default.join(root, rel)).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
        digest.update(Buffer.from('\0', 'utf8'));
    }
    return digest.digest('hex');
}
/** @description The build hash of the engine tree this process answers from, computed once (it is the running code). Any other root is recomputed.
 * @param engineRoot - The engine directory; defaults to this module's own tree. @returns Hex sha256, or null. */
function routesEngineBuildHash(engineRoot = OWN_ENGINE_ROOT) {
    const root = node_path_1.default.resolve(engineRoot);
    if (root !== OWN_ENGINE_ROOT)
        return hashEngineTree(root);
    if (ownTreeHash === null)
        ownTreeHash = hashEngineTree(root);
    return ownTreeHash;
}
/** @description Every field a run lacks before it may be displayed: its medium id, a real package version and a 64-hex build hash (D5).
 * @param run - The medium id and the engine fingerprints a run carries. @returns The missing fields; empty when displayable. */
function displayabilityProblems(run) {
    const missing = [];
    if (typeof run.mediumId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(run.mediumId))
        missing.push('medium.id');
    const fp = (run.engineFingerprints && typeof run.engineFingerprints === 'object' ? run.engineFingerprints : {});
    if (typeof fp.packageVersion !== 'string' || !exports.VERSION.test(fp.packageVersion))
        missing.push('engine.packageVersion');
    if (typeof fp.routesBuildHash !== 'string' || !exports.SHA256_HEX.test(fp.routesBuildHash))
        missing.push('engine.routesBuildHash');
    return missing;
}
