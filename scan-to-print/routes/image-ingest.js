"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the only two places bytes from the outside
 *                     |                             | world become pixels. Photos decode through `sharp` (already a
 *                     |                             | framework dependency, resolved from the running image's
 *                     |                             | node_modules): EXIF-rotated so a phone's sideways JPEG lands
 *                     |                             | upright, bounded to 768 px on the long side so a 12-megapixel
 *                     |                             | photo never costs more than a few milliseconds to threshold,
 *                     |                             | and re-encoded as PNG so what is stored is what was analysed.
 *                     |                             | Video frames come out of ffmpeg (in the image's apk layer) via
 *                     |                             | execFile with argv — no shell — at a configured rate and cap.
 *                     |                             | The binary name and the rate are configuration, not literals.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FRAMES_ENV = exports.FRAME_FPS_ENV = exports.FFMPEG_BIN_ENV = exports.MAX_IMAGE_SIDE = void 0;
exports.decodeToRaster = decodeToRaster;
exports.maskToPng = maskToPng;
exports.pngToMask = pngToMask;
exports.resolveFfmpeg = resolveFfmpeg;
exports.extractFrames = extractFrames;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const sharp_1 = __importDefault(require("sharp"));
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** @description Longest side a stored photo is bounded to. */
exports.MAX_IMAGE_SIDE = 768;
/** @description Environment variable names this module reads. */
exports.FFMPEG_BIN_ENV = 'SCAN_TO_PRINT_FFMPEG_BIN';
exports.FRAME_FPS_ENV = 'SCAN_TO_PRINT_FRAME_FPS';
exports.MAX_FRAMES_ENV = 'SCAN_TO_PRINT_MAX_FRAMES';
/**
 * @description Decode any image sharp understands into a bounded upright RGBA raster plus the PNG
 * that is stored alongside it.
 * @param bytes - Uploaded file bytes.
 * @returns The raster and its PNG encoding.
 * @throws Error when sharp cannot decode the bytes.
 */
async function decodeToRaster(bytes) {
    const image = (0, sharp_1.default)(bytes, { failOn: 'error' }).rotate().resize({ width: exports.MAX_IMAGE_SIDE, height: exports.MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true });
    const png = await image.clone().png().toBuffer();
    const { data, info } = await (0, sharp_1.default)(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { raster: { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }, png };
}
/**
 * @description Encode a mask as a PNG (white object on black) for the person to inspect.
 * @param mask - The silhouette.
 * @returns PNG bytes.
 */
async function maskToPng(mask) {
    const grey = Buffer.alloc(mask.width * mask.height);
    for (let i = 0; i < grey.length; i += 1)
        grey[i] = mask.data[i] ? 255 : 0;
    return (0, sharp_1.default)(grey, { raw: { width: mask.width, height: mask.height, channels: 1 } }).png().toBuffer();
}
/**
 * @description Decode a stored silhouette PNG back into a mask (any pixel above mid-grey is set).
 * @param bytes - PNG bytes written by {@link maskToPng}.
 * @returns The mask.
 */
async function pngToMask(bytes) {
    const { data, info } = await (0, sharp_1.default)(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
    const mask = { width: info.width, height: info.height, data: new Uint8Array(info.width * info.height) };
    for (let i = 0; i < mask.data.length; i += 1)
        mask.data[i] = data[i * info.channels] > 127 ? 1 : 0;
    return mask;
}
/**
 * @description Read the frame-extraction configuration from the environment.
 * @param env - Usually `process.env`.
 * @returns The config.
 * @throws RangeError when the rate or cap is not a positive number.
 */
function resolveFfmpeg(env) {
    const bin = (env[exports.FFMPEG_BIN_ENV] ?? '').trim() || 'ffmpeg';
    const fps = env[exports.FRAME_FPS_ENV] === undefined || env[exports.FRAME_FPS_ENV] === '' ? 1 : Number(env[exports.FRAME_FPS_ENV]);
    const maxFrames = env[exports.MAX_FRAMES_ENV] === undefined || env[exports.MAX_FRAMES_ENV] === '' ? 24 : Number(env[exports.MAX_FRAMES_ENV]);
    if (!(fps > 0) || !Number.isFinite(fps))
        throw new RangeError(`${exports.FRAME_FPS_ENV} must be a positive number`);
    if (!Number.isInteger(maxFrames) || maxFrames <= 0 || maxFrames > 120)
        throw new RangeError(`${exports.MAX_FRAMES_ENV} must be an integer 1..120`);
    return { bin, fps, maxFrames };
}
/**
 * @description Sample frames from a video into `outDir` as `frame-NNN.png`.
 * @param videoPath - The uploaded file.
 * @param outDir - Destination directory (created if missing).
 * @param config - From {@link resolveFfmpeg}.
 * @param execFileImpl - Process runner; defaults to the real one.
 * @returns Absolute paths of the frames written, in order.
 * @throws Error when ffmpeg is missing or fails; the message names the program so the operator can install or configure it.
 */
async function extractFrames(videoPath, outDir, config, execFileImpl = execFile) {
    node_fs_1.default.mkdirSync(outDir, { recursive: true });
    const pattern = node_path_1.default.join(outDir, 'frame-%03d.png');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-vf', `fps=${config.fps}`, '-frames:v', String(config.maxFrames), pattern];
    try {
        await execFileImpl(config.bin, args, { timeout: 120_000 });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Frame extraction failed running "${config.bin}" (set ${exports.FFMPEG_BIN_ENV} if it lives elsewhere): ${message}`);
    }
    return node_fs_1.default.readdirSync(outDir).filter((f) => /^frame-\d{3}\.png$/.test(f)).sort().map((f) => node_path_1.default.join(outDir, f));
}
//# sourceMappingURL=image-ingest.js.map