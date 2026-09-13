"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — where job files live. NOT inside the package
 *                     |                             | directory (a package update replaces it — the aero-lab lesson)
 *                     |                             | and NOT a literal: SCAN_TO_PRINT_DATA_DIR, else the shared
 *                     |                             | workspace root the swarm already mounts, else a local-dev
 *                     |                             | fallback under the cwd. Owner subs are hashed into the path so
 *                     |                             | a directory listing never shows an identity, and every path is
 *                     |                             | built from a validated UUID plus a fixed file name — nothing a
 *                     |                             | caller types is ever joined into a filesystem path.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add the `contours` artifact (contours.json): the view outlines
 *                     |                             | in world millimetres that CAD Studio turns into a B-rep part.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_FILES = exports.DATA_DIR_ENV = void 0;
exports.resolveDataRoot = resolveDataRoot;
exports.subHash = subHash;
exports.requireUuid = requireUuid;
exports.jobDir = jobDir;
exports.ensureDir = ensureDir;
exports.artifactPath = artifactPath;
exports.imagePath = imagePath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
/** @description Environment variable naming the data root. */
exports.DATA_DIR_ENV = 'SCAN_TO_PRINT_DATA_DIR';
/** @description The docker-compose shared workspace root. */
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
/** @description A canonical lower-case UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * @description Resolve the data root: explicit env → shared workspace env → container root if
 * present → `<cwd>/workspace-shared`. Always ends in `/scan-to-print`.
 * @param env - Usually `process.env`.
 * @param exists - Directory probe, injectable for specs.
 * @returns An absolute directory path (not necessarily created yet).
 */
function resolveDataRoot(env, exists = node_fs_1.default.existsSync) {
    const explicit = (env[exports.DATA_DIR_ENV] ?? '').trim();
    if (explicit)
        return node_path_1.default.resolve(explicit);
    const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
    if (shared)
        return node_path_1.default.join(node_path_1.default.resolve(shared), 'scan-to-print');
    if (exists(CONTAINER_WORKSPACE_ROOT))
        return node_path_1.default.join(CONTAINER_WORKSPACE_ROOT, 'scan-to-print');
    return node_path_1.default.join(node_path_1.default.resolve(process.cwd(), 'workspace-shared'), 'scan-to-print');
}
/**
 * @description Stable, non-reversible directory name for an owner.
 * @param sub - Owner subject.
 * @returns 16 hex characters.
 */
function subHash(sub) {
    return (0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 16);
}
/**
 * @description Validate an id from the wire is a canonical UUID before it touches a path or a query.
 * @param value - Untrusted value.
 * @returns The id, lower-cased.
 * @throws RangeError when it is not a UUID.
 */
function requireUuid(value) {
    const text = String(value ?? '').toLowerCase();
    if (!UUID.test(text))
        throw new RangeError('Expected a UUID');
    return text;
}
/**
 * @description A job's directory.
 * @param root - From {@link resolveDataRoot}.
 * @param sub - Owner subject.
 * @param jobId - Validated job id.
 * @returns `<root>/<subHash>/<jobId>`.
 */
function jobDir(root, sub, jobId) {
    return node_path_1.default.join(root, subHash(sub), requireUuid(jobId));
}
/**
 * @description Create a directory tree if missing.
 * @param dir - Directory path.
 * @returns The same path.
 */
function ensureDir(dir) {
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
/** @description The fixed artifact file names a job can hold. */
exports.ARTIFACT_FILES = Object.freeze({
    stl: 'model.stl', obj: 'model.obj', svg: 'drawing.svg', report: 'report.json', gcode: 'model.gcode', contours: 'contours.json',
});
/**
 * @description Path of one artifact inside a job.
 * @param dir - The job directory.
 * @param key - Which artifact.
 * @returns The file path.
 */
function artifactPath(dir, key) {
    return node_path_1.default.join(dir, 'artifacts', exports.ARTIFACT_FILES[key]);
}
/**
 * @description Path of an image's stored PNG (`source`) or silhouette PNG (`mask`).
 * @param dir - The job directory.
 * @param imageId - Validated image id.
 * @param kind - Which file.
 * @returns The file path.
 */
function imagePath(dir, imageId, kind) {
    return node_path_1.default.join(dir, kind === 'source' ? 'images' : 'masks', `${requireUuid(imageId)}.png`);
}
//# sourceMappingURL=data-dir.js.map