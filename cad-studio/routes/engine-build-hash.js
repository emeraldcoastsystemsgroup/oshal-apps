"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the build hash of this package's engine
 *                     |                             | tree, computed EXACTLY as engine/container/cad_engine_bridge.py
 *                     |                             | computes it (same file list, same framing, CRLF folded to LF),
 *                     |                             | so the api can refuse a container built from a different
 *                     |                             | engine than the package now ships. A spec runs both.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_FILES = void 0;
exports.engineBuildHash = engineBuildHash;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
/** The files the image bakes that change the engine's answers (mirror of RUNTIME_FILES in the bridge). */
exports.RUNTIME_FILES = ['cad_worker.py', 'container/cad_engine_bridge.py', 'requirements.txt', 'requirements-lock.txt'];
/**
 * @description Hash the engine tree, or null when it is not readable at all.
 * @param engineDir - The package's engine/ directory.
 * @returns Hex sha256, or null.
 */
function engineBuildHash(engineDir) {
    if (!engineDir || !node_fs_1.default.existsSync(engineDir))
        return null;
    const digest = (0, node_crypto_1.createHash)('sha256');
    for (const rel of exports.RUNTIME_FILES) {
        digest.update(Buffer.from(rel + '\0', 'utf8'));
        const file = node_path_1.default.join(engineDir, rel);
        if (node_fs_1.default.existsSync(file)) {
            const bytes = node_fs_1.default.readFileSync(file);
            digest.update(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
        }
        digest.update(Buffer.from('\0', 'utf8'));
    }
    return digest.digest('hex');
}
//# sourceMappingURL=engine-build-hash.js.map