"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — where a project's revisions and artifacts live
 *                     |                             | (never inside the package dir): <root>/<sha(sub)>/<projectId>/
 *                     |                             | {revisions,artifacts/<revision>}. Every path segment is a UUID,
 *                     |                             | an integer or an allowlisted artifact name we validated, so no
 *                     |                             | caller string is ever joined into a path.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_TYPES = exports.DATA_DIR_ENV = void 0;
exports.resolveDataRoot = resolveDataRoot;
exports.subHash = subHash;
exports.requireUuid = requireUuid;
exports.requireRevision = requireRevision;
exports.projectDir = projectDir;
exports.revisionsDir = revisionsDir;
exports.artifactsDir = artifactsDir;
exports.isArtifactName = isArtifactName;
exports.ensureDir = ensureDir;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
exports.DATA_DIR_ENV = 'SCENE_STUDIO_DATA_DIR';
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Artifacts a project revision can carry, and the type each is served with. */
exports.ARTIFACT_TYPES = Object.freeze({
    'preview.png': 'image/png',
    'preview.glb': 'model/gltf-binary',
    'preview.stl': 'model/stl',
    'export.zip': 'application/zip',
    'export.glb': 'model/gltf-binary',
    'export.fbx': 'application/octet-stream',
    'export.obj': 'text/plain; charset=utf-8',
    'export.stl': 'model/stl',
});
/** @description Resolve the data root: explicit env, the shared workspace, or a local fallback. */
function resolveDataRoot(env, exists = node_fs_1.default.existsSync) {
    const explicit = (env[exports.DATA_DIR_ENV] ?? '').trim();
    if (explicit)
        return node_path_1.default.resolve(explicit);
    const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
    if (shared)
        return node_path_1.default.join(node_path_1.default.resolve(shared), 'scene-studio');
    if (exists(CONTAINER_WORKSPACE_ROOT))
        return node_path_1.default.join(CONTAINER_WORKSPACE_ROOT, 'scene-studio');
    return node_path_1.default.join(node_path_1.default.resolve(process.cwd(), 'workspace-shared'), 'scene-studio');
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
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10_000_000)
        throw new RangeError('Expected a revision number');
    return n;
}
/** @description The directory holding everything of one project. */
function projectDir(root, sub, projectId) {
    return node_path_1.default.join(root, subHash(sub), requireUuid(projectId));
}
/** @description The directory of a project's revision blobs. */
function revisionsDir(root, sub, projectId) {
    return node_path_1.default.join(projectDir(root, sub, projectId), 'revisions');
}
/** @description The directory of one revision's artifacts. */
function artifactsDir(root, sub, projectId, revision) {
    return node_path_1.default.join(projectDir(root, sub, projectId), 'artifacts', String(requireRevision(revision)));
}
/** @description True for an artifact name this package serves. */
function isArtifactName(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(exports.ARTIFACT_TYPES, name);
}
/** @description mkdir -p with owner-only permissions. */
function ensureDir(dir) {
    node_fs_1.default.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}
//# sourceMappingURL=data-dir.js.map