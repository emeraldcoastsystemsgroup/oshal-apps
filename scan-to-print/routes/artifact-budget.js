"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAVE_BUDGET_BYTES = exports.DOWNLOAD_LIMIT_BYTES = void 0;
exports.planArtifacts = planArtifacts;
exports.downloadBytes = downloadBytes;
/**
 * Artifact budget — what one reconstruction keeps so it fits one save and every output fits one download.
 *
 * The native kernel commits a request's new file chunks base64-encoded inside a 16 MiB transaction bound
 * (crates/control/src/data_snapshot.rs MAX_TRANSACTION_BYTES) and answers at most 8 MiB per response
 * (bridge http_response.js MAX_BODY). At the default resolution (96 voxels across) a round object's OBJ alone
 * was 8.3 MB, so the save exceeded the bound, the whole request rolled back and the page showed only
 * "application_route_failed".
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: the OBJ is kept gzip-compressed at rest (about 1/7 the size) and inflated on download; an OBJ too large for one download is not kept and the report says why; an STL too large for one download, or outputs too large for one save, refuse with a RangeError naming a resolution that fits.
 *
 * @module artifact-budget
 */
const node_zlib_1 = __importDefault(require("node:zlib"));
/** @description Largest artifact one download can carry (the native kernel answers at most 8 MiB, less headroom). */
exports.DOWNLOAD_LIMIT_BYTES = 8 * 1024 * 1024 - 64 * 1024;
/** @description New artifact bytes one save may write: the kernel commits them base64-encoded within its 16 MiB transaction bound. */
exports.SAVE_BUDGET_BYTES = 10 * 1024 * 1024;
/** @description Megabytes for a person. */
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
/**
 * @description Decide what one reconstruction keeps so it fits one save and each output fits one download.
 * The OBJ is stored gzip-compressed (the download inflates it); an OBJ too large for one download is not
 * kept, with a warning; an STL too large for one download, or outputs too large for one save, refuse with a
 * resolution that fits.
 * @param stl - Binary STL.
 * @param obj - OBJ text.
 * @param rest - The small artifacts (svg, report text, contours text).
 * @param report - The reconstruction report (its voxel size and extent give the current resolution).
 * @returns The files to write and any warning to add to the report.
 * @throws RangeError with the sizes and a resolution that fits.
 */
function planArtifacts(stl, obj, rest, report) {
    const current = Math.max(1, Math.round(Math.max(report.sizeMm.x, report.sizeMm.y, report.sizeMm.z) / report.voxelMm));
    const fitting = (bytes, limit) => Math.max(16, Math.floor(current * Math.sqrt(limit / bytes) * 0.9));
    if (stl.length > exports.DOWNLOAD_LIMIT_BYTES) {
        throw new RangeError(`At this resolution (${current} voxels across) the mesh is ${mb(stl.length)}, more than one download can carry here (${mb(exports.DOWNLOAD_LIMIT_BYTES)}). Reconstruct at resolution ${fitting(stl.length, exports.DOWNLOAD_LIMIT_BYTES)} or lower (for a point cloud, a larger voxel size).`);
    }
    const warnings = [];
    const files = [['stl', stl], ...rest];
    const objBytes = Buffer.byteLength(obj);
    if (objBytes > exports.DOWNLOAD_LIMIT_BYTES) {
        warnings.push(`The OBJ (${mb(objBytes)}) is larger than one download can carry here, so only the STL was kept; reconstruct at resolution ${fitting(objBytes, exports.DOWNLOAD_LIMIT_BYTES)} or lower for an OBJ too.`);
    }
    else {
        files.push(['obj', node_zlib_1.default.gzipSync(Buffer.from(obj, 'utf8'))]);
    }
    const total = files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
    if (total > exports.SAVE_BUDGET_BYTES) {
        throw new RangeError(`At this resolution (${current} voxels across) the outputs are ${mb(total)}, more than one save can hold here (${mb(exports.SAVE_BUDGET_BYTES)}). Reconstruct at resolution ${fitting(total, exports.SAVE_BUDGET_BYTES)} or lower.`);
    }
    return { files, warnings };
}
/** @description An artifact's bytes as downloaded: a gzip-stored OBJ is inflated, everything else is as written. */
function downloadBytes(key, bytes) {
    return key === 'obj' && bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? node_zlib_1.default.gunzipSync(bytes) : bytes;
}
//# sourceMappingURL=artifact-budget.js.map