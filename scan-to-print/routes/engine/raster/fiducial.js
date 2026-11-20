"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B3) — deterministic high-contrast square
 *                     |                             | fiducial detector and printable fiducial SVG generator. Zero ML
 *                     |                             | model: uses Otsu darkness thresholding, 4-connected components,
 *                     |                             | aspect ratio, outer border solidity, light quiet-zone verification,
 *                     |                             | and high-contrast inner-ring / mixed-cell checks to detect a
 *                     |                             | printed square fiducial (either a concentric calibration target or
 *                     |                             | an orientation-cube face marker) while rejecting solid dark objects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIDUCIAL_LIMITS = void 0;
exports.detectFiducialSquare = detectFiducialSquare;
exports.fiducialScaleMmPerPx = fiducialScaleMmPerPx;
exports.fiducialSquareSvg = fiducialSquareSvg;
const raster_types_1 = require("./raster-types");
const silhouette_1 = require("./silhouette");
const face_marker_1 = require("./face-marker");
/** @description Detection and physical-size bounds for square fiducials. */
exports.FIDUCIAL_LIMITS = Object.freeze({
    /** Minimum outer square side length in pixels (6 cells x 3 px/cell). */
    minSidePx: 18,
    /** Maximum relative difference between width and height (15 %). */
    squareTolerance: 0.15,
    /** Minimum darkness dynamic range (0..255) so flat/uniform photos never produce false positives. */
    minContrast: 24,
    /** Minimum fraction of dark pixels along the outer border strip. */
    minBorderDark: 0.9,
    /** Minimum fraction of light pixels in the outer quiet-zone margin. */
    minQuietLight: 0.7,
    /** Minimum fraction of light pixels inside the inner 4x4 region (rejects solid dark squares). */
    minInteriorLight: 0.15,
    /** Maximum side fraction of the shorter image dimension so the whole frame is never a candidate. */
    maxSideCoverage: 0.65,
    /** Minimum physical fiducial square side length in millimetres. */
    fiducialMmMin: 5,
    /** Maximum physical fiducial square side length in millimetres. */
    fiducialMmMax: 500,
});
/** @description Darkness per pixel (255 - luminance) and dynamic range. */
function darknessStats(raster) {
    const dark = new Uint8Array(raster.width * raster.height);
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < dark.length; i += 1) {
        const at = i * 4;
        const v = 255 - Math.round(0.299 * raster.data[at] + 0.587 * raster.data[at + 1] + 0.114 * raster.data[at + 2]);
        dark[i] = v;
        if (v < lo)
            lo = v;
        if (v > hi)
            hi = v;
    }
    return { dark, contrast: hi - lo };
}
/** @description Bounding box for each 4-connected dark component. */
function componentBoxes(labels, count, width) {
    const boxes = new Array(count).fill(null);
    for (let i = 0; i < labels.length; i += 1) {
        const id = labels[i];
        if (id === 0)
            continue;
        const x = i % width;
        const y = (i - x) / width;
        const b = boxes[id];
        if (!b) {
            boxes[id] = { minX: x, minY: y, maxX: x, maxY: y };
            continue;
        }
        if (x < b.minX)
            b.minX = x;
        if (x > b.maxX)
            b.maxX = x;
        if (y < b.minY)
            b.minY = y;
        if (y > b.maxY)
            b.maxY = y;
    }
    return boxes;
}
/** @description Dark-pixel ratio over an inclusive pixel rectangle. */
function darkRatio(data, width, x0, y0, x1, y1) {
    let on = 0;
    let total = 0;
    for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
            on += data[y * width + x];
            total += 1;
        }
    }
    return total > 0 ? on / total : 0;
}
/** @description Sample one cell of a 6x6 grid over its central half. */
function sampleGridCell(data, width, box, row, col) {
    const cw = (box.maxX - box.minX + 1) / 6;
    const ch = (box.maxY - box.minY + 1) / 6;
    const x0 = Math.floor(box.minX + (col + 0.25) * cw);
    const x1 = Math.max(x0, Math.ceil(box.minX + (col + 0.75) * cw) - 1);
    const y0 = Math.floor(box.minY + (row + 0.25) * ch);
    const y1 = Math.max(y0, Math.ceil(box.minY + (row + 0.75) * ch) - 1);
    return darkRatio(data, width, x0, y0, x1, y1) > 0.5 ? 1 : 0;
}
/** @description Verify that a 1-cell margin immediately outside `box` is predominantly light. */
function hasQuietZone(data, raster, box) {
    const w = box.maxX - box.minX + 1;
    const h = box.maxY - box.minY + 1;
    const pad = Math.max(1, Math.round(Math.min(w, h) / 6));
    const x0 = Math.max(0, box.minX - pad);
    const x1 = Math.min(raster.width - 1, box.maxX + pad);
    const y0 = Math.max(0, box.minY - pad);
    const y1 = Math.min(raster.height - 1, box.maxY + pad);
    let light = 0;
    let total = 0;
    for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
            if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY)
                continue;
            if (data[y * raster.width + x] === 0)
                light += 1;
            total += 1;
        }
    }
    return total > 0 && light / total >= exports.FIDUCIAL_LIMITS.minQuietLight;
}
/** @description Validate one component's outer border, quiet zone, and high-contrast interior. */
function evaluateCandidate(data, raster, box, pixelCount) {
    const w = box.maxX - box.minX + 1;
    const h = box.maxY - box.minY + 1;
    const maxSide = Math.min(raster.width, raster.height) * exports.FIDUCIAL_LIMITS.maxSideCoverage;
    if (w < exports.FIDUCIAL_LIMITS.minSidePx || h < exports.FIDUCIAL_LIMITS.minSidePx || w > maxSide || h > maxSide)
        return null;
    const aspectError = Math.abs(w - h) / Math.max(w, h);
    if (aspectError > exports.FIDUCIAL_LIMITS.squareTolerance)
        return null;
    if (box.minX <= 0 || box.minY <= 0 || box.maxX >= raster.width - 1 || box.maxY >= raster.height - 1)
        return null;
    if (pixelCount / (w * h) > 0.9)
        return null;
    let borderDark = 0;
    const inner = [];
    for (let r = 0; r < 6; r += 1) {
        const row = [];
        for (let c = 0; c < 6; c += 1) {
            const bit = sampleGridCell(data, raster.width, box, r, c);
            if (r === 0 || c === 0 || r === 5 || c === 5)
                borderDark += bit;
            else
                row.push(bit);
        }
        if (r > 0 && r < 5)
            inner.push(row);
    }
    const borderSolidity = borderDark / 20;
    if (borderSolidity < exports.FIDUCIAL_LIMITS.minBorderDark || !hasQuietZone(data, raster, box))
        return null;
    const innerLight = inner.flat().filter((b) => b === 0).length;
    const innerDark = 16 - innerLight;
    if (innerLight / 16 < exports.FIDUCIAL_LIMITS.minInteriorLight)
        return null;
    const ringClear = inner.every((row, ri) => row.every((bit, ci) => (ri === 0 || ri === 3 || ci === 0 || ci === 3 ? bit === 0 : true)));
    const mixedPattern = innerLight >= 4 && innerDark >= 4;
    if (!ringClear && !mixedPattern)
        return null;
    return { bbox: box, sidePx: (w + h) / 2, kind: 'fiducial-square', aspectError, borderSolidity };
}
/** @description True when two bounding boxes describe the same square component. */
function sameBox(a, b) {
    return Math.abs(a.minX - b.minX) <= 2 && Math.abs(a.minY - b.minY) <= 2 && Math.abs(a.maxX - b.maxX) <= 2 && Math.abs(a.maxY - b.maxY) <= 2;
}
/** @description Merge known orientation-cube markers with generic fiducial-square candidates. */
function mergeCandidates(raster, generic) {
    const faceScan = (0, face_marker_1.detectFaceMarkers)(raster);
    const merged = faceScan.markers.map((m) => {
        const w = m.bbox.maxX - m.bbox.minX + 1;
        const h = m.bbox.maxY - m.bbox.minY + 1;
        return { bbox: m.bbox, sidePx: (w + h) / 2, kind: 'face-marker', aspectError: Math.abs(w - h) / Math.max(w, h), borderSolidity: 1 };
    });
    for (const cand of generic) {
        if (!merged.some((m) => sameBox(m.bbox, cand.bbox)))
            merged.push(cand);
    }
    return merged;
}
/**
 * @description Deterministically detect a high-contrast square fiducial in a photo without any ML
 * model. Accepts either a concentric calibration square (solid dark border + light inner ring, with
 * or without a dark core) or an orientation-cube / ArUco-style bordered pattern, while rejecting
 * solid dark objects, non-square blobs, low-contrast frames, and border-clipped shapes.
 * @param raster - Decoded RGBA photo.
 * @returns Detection verdict, pixel side length, and human-readable reason.
 */
function detectFiducialSquare(raster) {
    const { dark, contrast } = darknessStats(raster);
    if (contrast < exports.FIDUCIAL_LIMITS.minContrast) {
        return { detected: false, fiducial: null, candidates: [], reason: 'Photo contrast is too low to detect a fiducial square.' };
    }
    const threshold = (0, silhouette_1.otsuThreshold)(dark);
    const mask = (0, raster_types_1.createMask)(raster.width, raster.height);
    for (let i = 0; i < dark.length; i += 1)
        mask.data[i] = dark[i] > threshold ? 1 : 0;
    const { labels, sizes } = (0, silhouette_1.labelComponents)(mask);
    const boxes = componentBoxes(labels, sizes.length, raster.width);
    const generic = [];
    for (let id = 1; id < boxes.length; id += 1) {
        const box = boxes[id];
        if (!box)
            continue;
        const hit = evaluateCandidate(mask.data, raster, box, sizes[id]);
        if (hit)
            generic.push(hit);
    }
    const candidates = mergeCandidates(raster, generic);
    if (candidates.length === 0)
        return { detected: false, fiducial: null, candidates, reason: 'No fiducial square detected in this photo.' };
    if (candidates.length === 1) {
        const f = candidates[0];
        return { detected: true, fiducial: f, candidates, reason: `Detected ${f.kind} (${f.sidePx.toFixed(1)} px square).` };
    }
    const faceOnly = candidates.filter((c) => c.kind === 'face-marker');
    if (faceOnly.length === 1) {
        const f = faceOnly[0];
        return { detected: true, fiducial: f, candidates, reason: `Detected orientation-cube fiducial (${f.sidePx.toFixed(1)} px square).` };
    }
    return { detected: false, fiducial: null, candidates, reason: `Found ${candidates.length} fiducial-like squares; keep a single fiducial square in the frame to anchor scale automatically.` };
}
/**
 * @description Convert a detected fiducial square pixel side and known physical side (mm) into
 * millimetres per pixel for view registration.
 * @param sidePx - Detected square outer side in pixels.
 * @param fiducialMm - Known printed outer side in millimetres.
 * @returns Scale in mm/px.
 */
function fiducialScaleMmPerPx(sidePx, fiducialMm) {
    if (!(sidePx > 0) || !Number.isFinite(sidePx))
        throw new RangeError('Detected fiducial sidePx must be a positive number');
    if (!(fiducialMm >= exports.FIDUCIAL_LIMITS.fiducialMmMin) || fiducialMm > exports.FIDUCIAL_LIMITS.fiducialMmMax || !Number.isFinite(fiducialMm)) {
        throw new RangeError(`fiducialMm must be between ${exports.FIDUCIAL_LIMITS.fiducialMmMin} and ${exports.FIDUCIAL_LIMITS.fiducialMmMax} mm`);
    }
    return fiducialMm / sidePx;
}
/**
 * @description Render a printable concentric calibration fiducial square (SVG) whose dark outer
 * border measures exactly `sideMm` x `sideMm`, framed by a 1-cell white quiet zone.
 * @param sideMm - Physical outer side of the dark square border, millimetres.
 * @returns SVG document.
 */
function fiducialSquareSvg(sideMm) {
    if (!(sideMm >= exports.FIDUCIAL_LIMITS.fiducialMmMin) || sideMm > exports.FIDUCIAL_LIMITS.fiducialMmMax || !Number.isFinite(sideMm)) {
        throw new RangeError(`fiducialMm must be between ${exports.FIDUCIAL_LIMITS.fiducialMmMin} and ${exports.FIDUCIAL_LIMITS.fiducialMmMax} mm`);
    }
    const totalMm = (sideMm * 8) / 6;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${totalMm.toFixed(2)}mm" height="${totalMm.toFixed(2)}mm" viewBox="0 0 8 8" shape-rendering="crispEdges">`,
        `<title>Calibration fiducial (${sideMm} mm outer square)</title>`,
        '<rect width="8" height="8" fill="#fff"/>',
        '<rect x="1" y="1" width="6" height="6" fill="#000"/>',
        '<rect x="2" y="2" width="4" height="4" fill="#fff"/>',
        '<rect x="3" y="3" width="2" height="2" fill="#000"/>',
        '</svg>',
    ].join('');
}
//# sourceMappingURL=fiducial.js.map