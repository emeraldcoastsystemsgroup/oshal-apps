"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.2: ADR-139 artifact-exchange source listing (`GET /artifacts`, BACKLOG B4) returning caller-scoped current STL/SVG/OBJ outputs with pagination, and printable orientation-cube face markers (`GET /markers`, BACKLOG B9) serving a 6-face SVG sheet or single face.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orientationCubeSheetSvg = orientationCubeSheetSvg;
exports.createExchangeRoutes = createExchangeRoutes;
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const logger_1 = require("@/shared/logger");
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const job_outputs_1 = require("./job-outputs");
const views_1 = require("./engine/grid/views");
const face_marker_1 = require("./engine/raster/face-marker");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-exchange-routes' });
const PAGE_SIZE = 60;
const CURSOR_RE = /^\d{1,7}$/;
const EXCHANGED_KEYS = [
    { key: 'stl', mime: 'model/stl' },
    { key: 'svg', mime: 'image/svg+xml' },
    { key: 'obj', mime: 'model/obj' },
];
const SHEET_ORDER = ['front', 'right', 'top', 'back', 'left', 'bottom'];
const MARKER_MIN_MM = 10;
const MARKER_MAX_MM = 200;
const MARKER_DEFAULT_MM = 40;
/** @description True when a file starts with the gzip header (compressed OBJ at rest). */
function isGzipFile(file) {
    const fd = node_fs_1.default.openSync(file, 'r');
    try {
        const head = Buffer.alloc(2);
        return node_fs_1.default.readSync(fd, head, 0, 2, 0) === 2 && head[0] === 0x1f && head[1] === 0x8b;
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
}
/** @description Safe display filename for one job artifact. */
function safeBaseName(title) {
    return title.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'part';
}
/** @description Collect caller-owned current STL/SVG/OBJ items for the shared picker. */
function collectJobArtifacts(dataRoot, sub, jobs) {
    const items = [];
    for (const job of jobs) {
        if (!(0, job_outputs_1.hasCurrentOutput)(job))
            continue;
        const dir = (0, data_dir_1.jobDir)(dataRoot, sub, job.job_id);
        const present = (0, job_outputs_1.artifactPresence)(dir, job);
        const base = safeBaseName(job.title);
        for (const { key, mime } of EXCHANGED_KEYS) {
            if (!present[key])
                continue;
            const file = (0, data_dir_1.artifactPath)(dir, key);
            const item = {
                name: `${base}.${key}`,
                type: mime,
                source: `/api/scan-to-print/jobs/${encodeURIComponent(job.job_id)}/artifacts/${key}`,
            };
            if (key !== 'obj' || !isGzipFile(file))
                item.size = node_fs_1.default.statSync(file).size;
            items.push(item);
        }
    }
    return items;
}
/** @description Render one marker face placed inside a printable sheet at (ox, oy) mm. */
function sheetFaceMarkup(view, ox, oy, sideMm) {
    const cells = (0, face_marker_1.faceMarkerCells)(view);
    const n = cells.length + 2;
    const cellMm = sideMm / n;
    const rects = [];
    cells.forEach((row, r) => row.forEach((bit, c) => {
        if (bit)
            rects.push(`<rect x="${(ox + (c + 1) * cellMm).toFixed(3)}" y="${(oy + (r + 1) * cellMm).toFixed(3)}" width="${cellMm.toFixed(3)}" height="${cellMm.toFixed(3)}"/>`);
    }));
    const cx = (ox + sideMm / 2).toFixed(2);
    const ty = (oy + sideMm + 5.5).toFixed(2);
    return `<g data-face="${view}"><rect x="${ox}" y="${oy}" width="${sideMm}" height="${sideMm}" fill="#fff" stroke="#888" stroke-width="0.3" stroke-dasharray="1.5 1.5"/><g fill="#000">${rects.join('')}</g><text x="${cx}" y="${ty}" text-anchor="middle" font-family="sans-serif" font-size="4" fill="#111">${view.toUpperCase()}</text></g>`;
}
/** @description Render all six orientation-cube faces on one printable 3x2 SVG sheet. */
function orientationCubeSheetSvg(sideMm) {
    const gap = 12;
    const margin = 12;
    const labelH = 8;
    const width = margin * 2 + sideMm * 3 + gap * 2;
    const height = margin * 2 + sideMm * 2 + labelH * 2 + gap + 10;
    const faces = SHEET_ORDER.map((view, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const ox = margin + col * (sideMm + gap);
        const oy = margin + 10 + row * (sideMm + labelH + gap);
        return sheetFaceMarkup(view, ox, oy, sideMm);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><title>Scan to Print Orientation Cube Markers (${sideMm} mm)</title><rect width="${width}" height="${height}" fill="#fff"/><text x="${margin}" y="${margin + 4}" font-family="sans-serif" font-size="4.5" fill="#111">Scan to Print — Orientation Cube (${sideMm} mm faces, print at 100% scale, cut &amp; fold)</text>${faces.join('')}</svg>`;
}
/** @description Parse and bound the requested marker face side length in millimetres. */
function parseSideMm(raw) {
    if (raw === undefined || raw === null || raw === '')
        return MARKER_DEFAULT_MM;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MARKER_MIN_MM || n > MARKER_MAX_MM) {
        throw new RangeError(`sideMm must be a number between ${MARKER_MIN_MM} and ${MARKER_MAX_MM}`);
    }
    return n;
}
/** @description Register GET /artifacts (B4) and GET /markers (B9). */
function createExchangeRoutes(deps) {
    const router = (0, express_1.Router)();
    router.get('/artifacts', async (req, res) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const rawCursor = req.query.cursor === undefined ? '0' : String(req.query.cursor);
        if (!CURSOR_RE.test(rawCursor)) {
            res.status(400).json({ error: 'invalid_cursor', message: 'cursor must be a non-negative integer offset.' });
            return;
        }
        const offset = Number(rawCursor);
        try {
            const jobs = await (0, job_store_1.listJobs)(deps.pool, sub);
            const all = collectJobArtifacts(deps.dataRoot, sub, jobs);
            const items = all.slice(offset, offset + PAGE_SIZE);
            const nextCursor = offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : null;
            res.setHeader('Cache-Control', 'private, no-store');
            res.json({ items, folders: [], nextCursor });
        }
        catch (error) {
            logger.error({ err: error }, 'Artifact picker listing failed');
            res.status(500).json({ error: 'artifacts_list_failed' });
        }
    });
    router.get('/markers', (req, res) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const rawView = req.query.view === undefined || req.query.view === '' ? 'all' : String(req.query.view);
        if (rawView !== 'all' && !(0, views_1.isViewName)(rawView)) {
            res.status(400).json({ error: 'invalid_view', views: ['all', ...views_1.VIEW_NAMES] });
            return;
        }
        let sideMm;
        try {
            sideMm = parseSideMm(req.query.sideMm);
        }
        catch (error) {
            res.status(400).json({ error: 'invalid_side_mm', message: error.message });
            return;
        }
        const svg = rawView === 'all' ? orientationCubeSheetSvg(sideMm) : (0, face_marker_1.faceMarkerSvg)(rawView, sideMm);
        const filename = rawView === 'all' ? 'orientation-cube-markers.svg' : `orientation-cube-${rawView}.svg`;
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.query.download !== undefined)
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.type('image/svg+xml').send(svg);
    });
    return router;
}
//# sourceMappingURL=exchange-routes.js.map