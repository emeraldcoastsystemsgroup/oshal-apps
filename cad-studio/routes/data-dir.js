"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — where a model's exported artifacts live
 *                     |                             | (never inside the package dir): <root>/<sha(sub)>/<modelId>/
 *                     |                             | <revision>/… . Every path segment is a UUID or an integer we
 *                     |                             | validated, so no caller string is ever joined into a path.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_TYPES = exports.ARTIFACT_FILES = exports.DATA_DIR_ENV = void 0;
exports.resolveDataRoot = resolveDataRoot;
exports.subHash = subHash;
exports.requireUuid = requireUuid;
exports.requireRevision = requireRevision;
exports.revisionDir = revisionDir;
exports.modelDir = modelDir;
exports.ensureDir = ensureDir;
exports.isArtifactKey = isArtifactKey;
exports.artifactPath = artifactPath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
exports.DATA_DIR_ENV = 'CAD_STUDIO_DATA_DIR';
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** @description Resolve the artifact root: explicit env, the shared workspace, or a local fallback. */
function resolveDataRoot(env, exists = node_fs_1.default.existsSync) {
    const explicit = (env[exports.DATA_DIR_ENV] ?? '').trim();
    if (explicit)
        return node_path_1.default.resolve(explicit);
    const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
    if (shared)
        return node_path_1.default.join(node_path_1.default.resolve(shared), 'cad-studio');
    if (exists(CONTAINER_WORKSPACE_ROOT))
        return node_path_1.default.join(CONTAINER_WORKSPACE_ROOT, 'cad-studio');
    return node_path_1.default.join(node_path_1.default.resolve(process.cwd(), 'workspace-shared'), 'cad-studio');
}
/** @description A short stable hash of the owner sub for the directory name (the sub itself is not a path). */
function subHash(sub) {
    return (0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 16);
}
/** @description Accept only a UUID (lower-cased). @throws RangeError otherwise. */
function requireUuid(value) {
    const text = String(value ?? '').toLowerCase();
    if (!UUID.test(text))
        throw new RangeError('Expected a UUID');
    return text;
}
/** @description Accept only a non-negative integer revision. @throws RangeError otherwise. */
function requireRevision(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000)
        throw new RangeError('Expected a revision number');
    return n;
}
/** @description The directory of one model's revision artifacts. */
function revisionDir(root, sub, modelId, revision) {
    return node_path_1.default.join(root, subHash(sub), requireUuid(modelId), String(requireRevision(revision)));
}
/** @description The directory holding every revision of one model. */
function modelDir(root, sub, modelId) {
    return node_path_1.default.join(root, subHash(sub), requireUuid(modelId));
}
/** @description mkdir -p. */
function ensureDir(dir) {
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
/** The artifact keys a revision can carry and their file names. */
exports.ARTIFACT_FILES = Object.freeze({
    step: 'model.step', stl: 'model.stl', 'svg-front': 'front.svg', 'svg-top': 'top.svg', 'svg-right': 'right.svg', 'svg-iso': 'iso.svg', report: 'report.json',
});
exports.ARTIFACT_TYPES = Object.freeze({
    step: 'application/step', stl: 'model/stl', 'svg-front': 'image/svg+xml', 'svg-top': 'image/svg+xml', 'svg-right': 'image/svg+xml', 'svg-iso': 'image/svg+xml', report: 'application/json',
});
/** @description Is this string an artifact key? */
function isArtifactKey(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.ARTIFACT_FILES, value);
}
/** @description Path of one artifact inside a revision directory. */
function artifactPath(dir, key) {
    return node_path_1.default.join(dir, exports.ARTIFACT_FILES[key]);
}
//# sourceMappingURL=data-dir.js.map