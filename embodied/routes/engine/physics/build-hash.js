"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the engine tree's build hash, computed the way the container's bridge computes it (sha256 over the same runtime files, each prefixed by its relative name, line endings normalised), so the api can refuse a container built from another engine tree before the first request.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B20: the node-rail front (container/embodied_engine_node.py) is a runtime file — a container without it is another build.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B6: the PX4 node front is a runtime file too.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The arm plant and its task are runtime files too (ADR-152 D5 task 3).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENGINE_RUNTIME_FILES = void 0;
exports.engineBuildHash = engineBuildHash;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** The files whose bytes define an engine build (RUNTIME_FILES in embodied_engine_bridge.py). */
exports.ENGINE_RUNTIME_FILES = ['embodied_worker.py', 'container/embodied_engine_bridge.py', 'requirements.txt', 'requirements-lock.txt', 'tasks/hover_leg.py', 'container/embodied_engine_node.py', 'container/embodied_px4_node.py', 'embodied_arm.py', 'tasks/reach_grasp.py'];
/** @description The build hash of the engine tree under `engineDir`, or null when the tree is not there.
 * @param engineDir - The package's `engine/` directory. @returns Hex sha256 or null. */
function engineBuildHash(engineDir) {
    if (!node_fs_1.default.existsSync(node_path_1.default.join(engineDir, 'embodied_worker.py')))
        return null;
    const digest = (0, node_crypto_1.createHash)('sha256');
    for (const rel of exports.ENGINE_RUNTIME_FILES) {
        const file = node_path_1.default.join(engineDir, rel);
        digest.update(Buffer.from(`${rel}\0`, 'utf8'));
        if (node_fs_1.default.existsSync(file))
            digest.update(node_fs_1.default.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
        digest.update(Buffer.from('\0', 'utf8'));
    }
    return digest.digest('hex');
}
//# sourceMappingURL=build-hash.js.map