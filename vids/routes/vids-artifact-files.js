"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactPath = exports.artifactRoot = exports.MAX_VIDEO_BYTES = void 0;
exports.ensureArtifactRoot = ensureArtifactRoot;
exports.inspectVideo = inspectVideo;
exports.serveVideo = serveVideo;
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stream bounded private MP4 exports, validate complete container boxes and a video track, and serve immutable files without following file links.
 */
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
exports.MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const artifactRoot = () => (0, node_path_1.join)(process.env.CLINE_WORKSPACE_ROOT || '/app/workspace-shared', 'vids-artifacts');
exports.artifactRoot = artifactRoot;
const artifactPath = (id) => {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
        throw new Error('Invalid artifact identity');
    return (0, node_path_1.join)((0, exports.artifactRoot)(), `${id}.mp4`);
};
exports.artifactPath = artifactPath;
async function ensureArtifactRoot() {
    const root = (0, exports.artifactRoot)();
    await (0, promises_1.mkdir)(root, { recursive: true });
    const stat = await (0, promises_1.lstat)(root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Artifact root must be a directory');
    return root;
}
async function bytesAt(file, offset, size) {
    const bytes = Buffer.alloc(size);
    const read = await file.read(bytes, 0, size, offset);
    if (read.bytesRead !== size)
        throw new Error('Truncated MP4');
    return bytes;
}
async function boxes(file, start, end) {
    const out = [];
    while (start < end) {
        if (end - start < 8 || out.length >= 10000)
            throw new Error('Invalid MP4 box boundary');
        const header = await bytesAt(file, start, 8);
        let size = header.readUInt32BE(0), headerSize = 8;
        if (size === 1) {
            if (end - start < 16)
                throw new Error('Truncated MP4 box');
            const extended = (await bytesAt(file, start + 8, 8)).readBigUInt64BE();
            if (extended > BigInt(exports.MAX_VIDEO_BYTES))
                throw new Error('Oversize MP4 box');
            size = Number(extended);
            headerSize = 16;
        }
        else if (size === 0)
            size = end - start;
        if (size < headerSize || start + size > end)
            throw new Error('Truncated MP4 box');
        out.push({ kind: header.toString('ascii', 4, 8), start, payload: start + headerSize, end: start + size });
        start += size;
    }
    return out;
}
async function hasVideoTrack(file, movie) {
    for (const track of (await boxes(file, movie.payload, movie.end)).filter((b) => b.kind === 'trak')) {
        for (const media of (await boxes(file, track.payload, track.end)).filter((b) => b.kind === 'mdia')) {
            for (const handler of (await boxes(file, media.payload, media.end)).filter((b) => b.kind === 'hdlr')) {
                if (handler.end - handler.payload >= 12 && (await bytesAt(file, handler.payload + 8, 4)).toString('ascii') === 'vide')
                    return true;
            }
        }
    }
    return false;
}
/** Container validation is not editorial review or a full decoder. The owner previews before publishing. */
async function inspectVideo(path) {
    const file = await (0, promises_1.open)(path, node_fs_1.constants.O_RDONLY | (node_fs_1.constants.O_NOFOLLOW || 0));
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > exports.MAX_VIDEO_BYTES || stat.size < 32)
            throw new Error('Invalid MP4 size');
        const top = await boxes(file, 0, stat.size);
        const ftyp = top[0], movie = top.find((b) => b.kind === 'moov');
        if (ftyp?.kind !== 'ftyp' || ftyp.end - ftyp.payload < 8 || !movie
            || !top.some((b) => b.kind === 'mdat' && b.end > b.payload) || !(await hasVideoTrack(file, movie)))
            throw new Error('A complete MP4 video export is required');
        const hash = (0, node_crypto_1.createHash)('sha256');
        for await (const chunk of file.createReadStream({ start: 0, autoClose: false }))
            hash.update(chunk);
        return { sha256: hash.digest('hex'), byteLength: stat.size };
    }
    finally {
        await file.close();
    }
}
function byteRange(value, size) {
    if (!value)
        return [0, size - 1];
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2]))
        return null;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? [start, end] : null;
}
async function serveVideo(req, res, row) {
    const root = await (0, promises_1.lstat)((0, exports.artifactRoot)());
    if (!root.isDirectory() || root.isSymbolicLink()) {
        res.status(404).end();
        return;
    }
    const path = (0, exports.artifactPath)(row.artifact_id);
    if ((await (0, promises_1.lstat)(path)).isSymbolicLink()) {
        res.status(404).end();
        return;
    }
    const file = await (0, promises_1.open)(path, node_fs_1.constants.O_RDONLY | (node_fs_1.constants.O_NOFOLLOW || 0));
    let streaming = false;
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== Number(row.byte_length)) {
            res.status(404).end();
            return;
        }
        const range = byteRange(req.headers.range, stat.size);
        res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Type': 'video/mp4', 'Content-Disposition': 'inline; filename="video.mp4"', 'Accept-Ranges': 'bytes' });
        if (!range) {
            res.set('Content-Range', `bytes */${stat.size}`).status(416).end();
            return;
        }
        if (req.headers.range)
            res.status(206).set('Content-Range', `bytes ${range[0]}-${range[1]}/${stat.size}`);
        res.set('Content-Length', String(range[1] - range[0] + 1));
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        const stream = (0, node_fs_1.createReadStream)(path, { fd: file.fd, autoClose: false, start: range[0], end: range[1] });
        streaming = true;
        const close = () => { stream.destroy(); void file.close().catch(() => undefined); };
        res.once('close', close);
        stream.once('error', () => res.destroy());
        stream.pipe(res);
    }
    finally {
        if (!streaming)
            await file.close();
    }
}
//# sourceMappingURL=vids-artifact-files.js.map