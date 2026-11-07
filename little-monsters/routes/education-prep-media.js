"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keptVideoPath = keptVideoPath;
exports.createPrepMediaHandler = createPrepMediaHandler;
/**
 * Study Lab and curriculum lesson media: the video, poster and captions of each lesson.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Answer lesson videos by lasting-file reference. A package reply is buffered, capped at 8 MiB and has no byte ranges, and every package file is copied into every person's sandbox and every dependent's, so real lesson videos cannot live in the package. One copy of each video sits in the package's lasting directory, put there by scripts/lesson-studio/install-videos.py, and the kernel streams it with byte ranges.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Load optional curriculum-manifest.json for the 168-topic video curriculum and serve manifest-authorized curriculum posters and captions from lasting storage when absent from tools/prep-media.
 * -----------------------------------------------------------------------------
 *
 * @module education-prep-media
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'education-prep-media' });
/** Only the files a lesson ships: a plain name, never a path. */
const MEDIA_NAME = /^[a-z0-9-]+\.(mp4|jpg|vtt)$/;
/**
 * @description Where a filmed lesson's video is kept, by the digest the manifest records for it, so a
 * package only ever serves the video it was delivered with.
 * @param id The lesson id.
 * @param sha256 The video's SHA-256 from the manifest.
 * @returns The path relative to the package's lasting directory.
 */
function keptVideoPath(id, sha256) {
    return `prep-media/${id}-${sha256.slice(0, 16)}.mp4`;
}
/** The videos this package was delivered with: lesson id to its kept path. */
function readKeptVideos(mediaRoot) {
    const manifest = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(mediaRoot, 'manifest.json'), 'utf8'));
    const entries = new Map(Object.entries(manifest.lessons).map(([id, entry]) => [id, keptVideoPath(id, entry.sha256)]));
    const curriculumPath = node_path_1.default.join(mediaRoot, 'curriculum-manifest.json');
    if (node_fs_1.default.existsSync(curriculumPath)) {
        const curriculum = JSON.parse(node_fs_1.default.readFileSync(curriculumPath, 'utf8'));
        for (const [id, entry] of Object.entries(curriculum.lessons || {})) {
            entries.set(id, keptVideoPath(id, entry.sha256));
        }
    }
    return entries;
}
function notFound(res) {
    res.status(404).type('text/plain; charset=utf-8').send('Not found');
}
/** Send a file directly: posters, captions, and videos on a host with no lasting-file reply. */
function sendDirect(res, file, name) {
    res.sendFile(file, (err) => {
        if (!err)
            return;
        if (res.headersSent || res.writableEnded) {
            logger.warn({ err, name }, 'Aborted while serving lesson media');
            return;
        }
        logger.error({ err, name }, 'Could not serve lesson media');
        notFound(res);
    });
}
/**
 * @description GET /prep-media/:file. A video goes out by reference to its kept copy; a poster or caption
 * file comes from the package or, for manifest-listed curriculum lessons, from lasting storage.
 * @param mediaRoot Absolute path of the package's tools/prep-media folder.
 * @param env Process environment; OSHAL_PACKAGE_DATA_DIR names the lasting directory.
 * @returns The Express handler.
 */
function createPrepMediaHandler(mediaRoot, env = process.env) {
    let kept = null;
    return async (req, res) => {
        const name = String(req.params.file || '');
        if (!MEDIA_NAME.test(name))
            return notFound(res);
        if (!name.endsWith('.mp4')) {
            const packaged = node_path_1.default.join(mediaRoot, name);
            if ((await node_fs_1.default.promises.stat(packaged).catch(() => null))?.isFile()) {
                return sendDirect(res, packaged, name);
            }
            kept = kept || readKeptVideos(mediaRoot);
            const baseId = node_path_1.default.basename(name, node_path_1.default.extname(name));
            const dataDir = env.OSHAL_PACKAGE_DATA_DIR;
            if (kept.has(baseId) && dataDir) {
                const fallback = node_path_1.default.join(dataDir, 'prep-media', name);
                if ((await node_fs_1.default.promises.stat(fallback).catch(() => null))?.isFile()) {
                    return sendDirect(res, fallback, name);
                }
            }
            return notFound(res);
        }
        kept = kept || readKeptVideos(mediaRoot);
        const relative = kept.get(node_path_1.default.basename(name, '.mp4'));
        if (!relative)
            return notFound(res);
        const dataDir = env.OSHAL_PACKAGE_DATA_DIR;
        const file = dataDir ? node_path_1.default.join(dataDir, relative) : null;
        if (!file || !(await node_fs_1.default.promises.stat(file).catch(() => null))?.isFile()) {
            logger.error({ name, relative }, 'Lesson video is not installed; run scripts/lesson-studio/install-videos.py');
            return notFound(res);
        }
        res.setHeader('content-type', 'video/mp4');
        const reply = res;
        if (typeof reply.lastingFile === 'function') {
            reply.lastingFile(relative, { filename: name, inline: true });
            return;
        }
        sendDirect(res, file, name);
    };
}
//# sourceMappingURL=education-prep-media.js.map