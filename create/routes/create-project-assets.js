"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectAssetRoot = projectAssetRoot;
exports.normalizeProjectImage = normalizeProjectImage;
exports.saveProjectImage = saveProjectImage;
exports.readProjectImage = readProjectImage;
exports.removeProjectImage = removeProjectImage;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Normalize private immutable raster uploads outside the installed package and serve only exact-owner verified bytes.
 */
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const sharp_1 = __importDefault(require("sharp"));
const create_project_types_1 = require("./create-project-types");
const create_project_validation_1 = require("./create-project-validation");
/** Match the established package-private shared-workspace convention; never store under package source. */
function projectAssetRoot(env = process.env) {
    if (env.CREATE_PROJECT_DATA_DIR?.trim())
        return (0, node_path_1.resolve)(env.CREATE_PROJECT_DATA_DIR);
    const shared = env.CLINE_WORKSPACE_ROOT || env.SHARED_WORKSPACE_ROOT
        || ((0, node_fs_1.existsSync)('/app/workspace-shared') ? '/app/workspace-shared' : (0, node_path_1.resolve)(process.cwd(), 'workspace-shared'));
    return (0, node_path_1.join)((0, node_path_1.resolve)(shared), 'create-projects');
}
function ownerDirectory(root, owner) {
    return (0, node_path_1.join)(root, (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([owner.issuer, owner.sub])).digest('hex'));
}
function imagePath(root, owner, id) { return (0, node_path_1.join)(ownerDirectory(root, owner), `${(0, create_project_validation_1.projectId)(id)}.png`); }
/** Inspect real decoder metadata, reject animated/oversized/non-raster input and strip metadata through PNG normalization. */
async function normalizeProjectImage(bytes) {
    if (!bytes.length || bytes.length > create_project_types_1.PROJECT_LIMITS.imageBytes)
        throw new create_project_types_1.ProjectError(413, 'project_image_too_large');
    try {
        const options = { limitInputPixels: create_project_types_1.PROJECT_LIMITS.pixels, failOn: 'error' };
        const metadata = await (0, sharp_1.default)(bytes, options).metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1
            || !metadata.width || !metadata.height || metadata.width > create_project_types_1.PROJECT_LIMITS.dimension || metadata.height > create_project_types_1.PROJECT_LIMITS.dimension) {
            throw new create_project_types_1.ProjectError(400, 'invalid_project_image');
        }
        const normalized = await (0, sharp_1.default)(bytes, options).rotate().png().toBuffer({ resolveWithObject: true });
        if (normalized.data.length > create_project_types_1.PROJECT_LIMITS.imageBytes)
            throw new create_project_types_1.ProjectError(413, 'project_image_too_large');
        return { bytes: normalized.data, width: normalized.info.width, height: normalized.info.height };
    }
    catch (error) {
        if (error instanceof create_project_types_1.ProjectError)
            throw error;
        throw new create_project_types_1.ProjectError(400, 'invalid_project_image');
    }
}
/** Create bytes once, then admit their metadata atomically; failed admissions remove only this newly created file. */
async function saveProjectImage(root, store, owner, bytes, confirm) {
    const image = await normalizeProjectImage(bytes);
    await confirm();
    const id = (0, node_crypto_1.randomUUID)(), file = imagePath(root, owner, id), directory = ownerDirectory(root, owner);
    await (0, promises_1.mkdir)(directory, { recursive: true, mode: 0o700 });
    if ((await (0, promises_1.lstat)(directory)).isSymbolicLink())
        throw new create_project_types_1.ProjectError(503, 'project_asset_storage_unavailable');
    await (0, promises_1.writeFile)(file, image.bytes, { flag: 'wx', mode: 0o600 });
    const value = { id, src: create_project_types_1.PROJECT_ASSET_PREFIX + id, width: image.width, height: image.height,
        bytes: image.bytes.length, sha256: (0, node_crypto_1.createHash)('sha256').update(image.bytes).digest('hex') };
    try {
        await store.addAsset(owner, value, confirm);
        return value;
    }
    catch (error) {
        await (0, promises_1.unlink)(file);
        throw error;
    }
}
/** The database owner check precedes filesystem reads; changed or linked bytes are never served as the immutable asset. */
async function readProjectImage(root, store, owner, id) {
    const value = await store.getAsset(owner, id), file = imagePath(root, owner, id);
    try {
        const stat = await (0, promises_1.lstat)(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== value.bytes)
            throw new Error('asset_integrity');
        const bytes = await (0, promises_1.readFile)(file);
        if ((0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex') !== value.sha256)
            throw new Error('asset_integrity');
        return bytes;
    }
    catch {
        throw new create_project_types_1.ProjectError(503, 'project_asset_storage_unavailable');
    }
}
/** Retry missing-file cleanup safely; only a server-selected stale unused UUID is accepted. */
async function removeProjectImage(root, owner, id) {
    try {
        await (0, promises_1.unlink)(imagePath(root, owner, id));
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
    }
}
//# sourceMappingURL=create-project-assets.js.map