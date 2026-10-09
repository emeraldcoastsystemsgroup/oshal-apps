"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 D5/D7: "every run result carries its medium id and engine fingerprints, or it is not displayed." A run is (vehicle, medium, plant), and the moment a vehicle can be run in any medium a number shown without WHICH medium and WHICH engine produced it is a fabrication. This module is the fingerprint half: the package version read from the installed manifest, a build hash over the compiled engine tree that actually answered (every module under routes/engine, name-prefixed, line endings folded), and which plant answered — the analytic fall, or the MuJoCo engine tree by its own build hash. `requireDisplayable` is the refusal: a result missing its medium id or either fingerprint is refused by name, and the tile applies the same rule before it draws anything.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunNotDisplayable = exports.RUN_RESULT_SCHEMA = void 0;
exports.readPackageVersion = readPackageVersion;
exports.routesEngineBuildHash = routesEngineBuildHash;
exports.fingerprintRun = fingerprintRun;
exports.requireDisplayable = requireDisplayable;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** The shape every displayed run result carries. Bumped when a field is added or renamed. */
exports.RUN_RESULT_SCHEMA = 'oshal.run-result/1';
/** @description The refusal a result gets when it cannot say which medium or which engine produced it. */
class RunNotDisplayable extends Error {
    code = 'run_not_displayable';
    missing;
    constructor(missing) {
        super(`run_not_displayable: missing ${missing.join(', ')} — a run result without its medium id and engine fingerprints is not displayed (ADR-160 D5)`);
        this.name = 'RunNotDisplayable';
        this.missing = missing;
    }
}
exports.RunNotDisplayable = RunNotDisplayable;
/** @description Read the installed package's version from its manifest, the way the readiness smoke does: a plain top-level scalar, no YAML runtime.
 * @param packageDir - The package root that holds `oshal-app.yaml`.
 * @returns The version string, or null when the manifest is absent or carries none — the caller must then refuse to fingerprint, never invent one. */
function readPackageVersion(packageDir) {
    try {
        const manifest = node_fs_1.default.readFileSync(node_path_1.default.join(packageDir, 'oshal-app.yaml'), 'utf8');
        const match = /^version:\s*([^#\r\n]+)/m.exec(manifest);
        const version = String(match?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
        return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
    }
    catch {
        return null;
    }
}
/** Every compiled module under a tree, as sorted POSIX-relative paths. Source maps are not part of a build's identity. */
function compiledModules(root, rel = '', out = []) {
    for (const entry of node_fs_1.default.readdirSync(node_path_1.default.join(root, rel), { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory())
            compiledModules(root, childRel, out);
        else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name))
            out.push(childRel);
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
/** The tree this module was loaded from: the one tree whose hash may be cached, because it is the running code and cannot change under a live process. */
const OWN_ENGINE_ROOT = node_path_1.default.resolve(__dirname, '..');
let ownTreeHash = null;
/** @description sha256 over every `.js` and `.json` module under a compiled engine tree, each prefixed by its relative name, CRLF folded to LF so a Windows checkout and the deployed Linux copy of one commit agree. Always recomputed — a caller hashing a copy is usually asking whether the copy has changed.
 * @param root - The compiled engine directory. @returns Hex sha256. */
function hashCompiledTree(root) {
    const digest = (0, node_crypto_1.createHash)('sha256');
    for (const rel of compiledModules(root)) {
        digest.update(Buffer.from(`${rel}\0`, 'utf8'));
        digest.update(node_fs_1.default.readFileSync(node_path_1.default.join(root, rel)).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
        digest.update(Buffer.from('\0', 'utf8'));
    }
    return digest.digest('hex');
}
/** @description The build hash of a compiled engine tree. The tree THIS module lives in (routes/engine when compiled) is hashed once per process, because it is the running code; any other root is recomputed on every call.
 * @param engineRoot - The compiled engine directory. Defaults to this module's own tree.
 * @returns Hex sha256. */
function routesEngineBuildHash(engineRoot = OWN_ENGINE_ROOT) {
    const root = node_path_1.default.resolve(engineRoot);
    if (root !== OWN_ENGINE_ROOT)
        return hashCompiledTree(root);
    if (ownTreeHash === null)
        ownTreeHash = hashCompiledTree(root);
    return ownTreeHash;
}
/** @description Stamp a run result with the engine that produced it. The medium id must already be on the result: it is the run's own, never the fingerprint's.
 * @param result - A run result carrying `medium.id`. @param engine - The fingerprints of the engine that answered.
 * @returns The same result with `schema` and `engine`, displayable. */
function fingerprintRun(result, engine) {
    return { ...result, schema: exports.RUN_RESULT_SCHEMA, medium: result.medium, engine };
}
/** @description The rule every surface applies before drawing a run: the result carries its medium id and its engine fingerprints, or it is refused by name. The tile in tools/embodied.js applies the same three checks in the browser.
 * @param result - Anything that claims to be a run result.
 * @returns The result, typed as displayable.
 * @throws RunNotDisplayable naming every missing field. */
function requireDisplayable(result) {
    const r = (result ?? {});
    const missing = [];
    if (typeof r.medium?.id !== 'string' || !r.medium.id)
        missing.push('medium.id');
    if (typeof r.engine?.packageVersion !== 'string' || !r.engine.packageVersion)
        missing.push('engine.packageVersion');
    if (typeof r.engine?.routesBuildHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.engine.routesBuildHash))
        missing.push('engine.routesBuildHash');
    if (missing.length)
        throw new RunNotDisplayable(missing);
    return result;
}
//# sourceMappingURL=run-fingerprint.js.map