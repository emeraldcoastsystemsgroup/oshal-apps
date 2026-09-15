"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B9) — the orientation cube. A small paper
 *                     |                             | cube with one marker per face stands beside the object; the face
 *                     |                             | the camera sees names the canonical view, so assigning views stops
 *                     |                             | being a manual step. The detector is deterministic and has no
 *                     |                             | model: Otsu on darkness, 4-connected components, and for each
 *                     |                             | square candidate a (4 + 2)-cell grid sampled by majority over each
 *                     |                             | cell's central half — a solid black border ring and 16 data cells
 *                     |                             | read against a fixed six-code dictionary under all four rotations.
 *                     |                             | The codes were chosen by a deterministic greedy search (every row
 *                     |                             | and column mixed, seven to nine black cells) so any two faces, in
 *                     |                             | any rotation, differ in at least 6 cells and no face matches its
 *                     |                             | own rotation within 6; the spec re-verifies both. One wrong cell
 *                     |                             | is tolerated; exactly one known marker assigns a view, and
 *                     |                             | anything else (none, unknown, two) leaves the view to the person.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACE_MARKER_LIMITS = exports.FACE_MARKER_CODES = exports.FACE_MARKER_DATA = void 0;
exports.faceMarkerCells = faceMarkerCells;
exports.detectFaceMarkers = detectFaceMarkers;
exports.faceMarkerSvg = faceMarkerSvg;
const raster_types_1 = require("./raster-types");
const silhouette_1 = require("./silhouette");
const views_1 = require("../grid/views");
/** @description Data cells per marker side; the marker is this plus a one-cell black border. */
exports.FACE_MARKER_DATA = 4;
/**
 * @description The dictionary: one 16-cell code per face, row-major, `1` = black, as the face is
 * printed upright when seen from its own canonical view.
 */
exports.FACE_MARKER_CODES = Object.freeze({
    front: '0110110010100111',
    back: '0001110001110100',
    left: '0101100011100010',
    right: '1001111000011011',
    top: '0001000101111010',
    bottom: '0101011010110011',
});
/**
 * @description Detection bounds. `maxBitErrors` is 1 because the dictionary's minimum distance of 6
 * could correct 2 uniquely; accepting 1 keeps 4 cells of margin to any other face.
 */
exports.FACE_MARKER_LIMITS = Object.freeze({
    /** Smallest cell, pixels, a marker must be photographed at. */
    minCellPx: 3,
    /** Largest relative difference between a candidate's width and height. */
    squareTolerance: 0.2,
    /** Wrong cells tolerated in a match. */
    maxBitErrors: 1,
});
/** @description A code as 16 bits. */
function bitsOf(code) {
    return [...code].map((c) => (c === '1' ? 1 : 0));
}
/** @description Rotate an N x N bit grid 90 degrees clockwise. */
function rotateClockwise(bits) {
    const n = exports.FACE_MARKER_DATA;
    const out = new Array(n * n);
    for (let r = 0; r < n; r += 1)
        for (let c = 0; c < n; c += 1)
            out[c * n + (n - 1 - r)] = bits[r * n + c];
    return out;
}
/** @description The dictionary expanded to every face in every rotation, in a fixed order. */
const DICTIONARY = views_1.VIEW_NAMES.flatMap((view) => {
    const rotations = [bitsOf(exports.FACE_MARKER_CODES[view])];
    for (let k = 1; k < 4; k += 1)
        rotations.push(rotateClockwise(rotations[k - 1]));
    return rotations.map((bits, k) => ({ view, rotationDeg: (k * 90), bits }));
});
/**
 * @description The printable cell grid of one face: (4 + 2) x (4 + 2) cells, the border included,
 * `1` = black. A renderer draws it on white with at least one white cell of margin around it.
 * @param view - The face.
 * @returns Rows of cells, top first.
 */
function faceMarkerCells(view) {
    const data = bitsOf(exports.FACE_MARKER_CODES[view]);
    const side = exports.FACE_MARKER_DATA + 2;
    return Array.from({ length: side }, (_, r) => Array.from({ length: side }, (_, c) => {
        if (r === 0 || c === 0 || r === side - 1 || c === side - 1)
            return 1;
        return data[(r - 1) * exports.FACE_MARKER_DATA + (c - 1)];
    }));
}
/** @description Darkness per pixel (255 - luminance), the value the threshold splits. */
function darkness(raster) {
    const out = new Uint8Array(raster.width * raster.height);
    for (let i = 0; i < out.length; i += 1) {
        const at = i * 4;
        out[i] = 255 - Math.round(0.299 * raster.data[at] + 0.587 * raster.data[at + 1] + 0.114 * raster.data[at + 2]);
    }
    return out;
}
/** @description Bounds of every labelled component, index = label. */
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
/** @description Majority of dark pixels over the central half of one grid cell. */
function sampleCell(dark, width, box, row, col) {
    const side = exports.FACE_MARKER_DATA + 2;
    const cw = (box.maxX - box.minX + 1) / side;
    const ch = (box.maxY - box.minY + 1) / side;
    const x0 = Math.floor(box.minX + (col + 0.25) * cw);
    const x1 = Math.ceil(box.minX + (col + 0.75) * cw) - 1;
    const y0 = Math.floor(box.minY + (row + 0.25) * ch);
    const y1 = Math.ceil(box.minY + (row + 0.75) * ch) - 1;
    let on = 0;
    let total = 0;
    for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
            on += dark[y * width + x];
            total += 1;
        }
    return on * 2 > total ? 1 : 0;
}
/** @description Is this component a candidate: square enough, large enough, clear of the image edge? */
function isCandidate(box, raster) {
    const w = box.maxX - box.minX + 1;
    const h = box.maxY - box.minY + 1;
    const side = exports.FACE_MARKER_DATA + 2;
    if (w < side * exports.FACE_MARKER_LIMITS.minCellPx || h < side * exports.FACE_MARKER_LIMITS.minCellPx)
        return false;
    if (Math.abs(w - h) > exports.FACE_MARKER_LIMITS.squareTolerance * Math.max(w, h))
        return false;
    return box.minX > 0 && box.minY > 0 && box.maxX < raster.width - 1 && box.maxY < raster.height - 1;
}
/** @description Read one candidate: null when it has no solid border or its data cells are uniform. */
function readCandidate(dark, width, box) {
    const side = exports.FACE_MARKER_DATA + 2;
    const data = [];
    for (let r = 0; r < side; r += 1) {
        for (let c = 0; c < side; c += 1) {
            const bit = sampleCell(dark, width, box, r, c);
            const border = r === 0 || c === 0 || r === side - 1 || c === side - 1;
            if (border && bit === 0)
                return null;
            if (!border)
                data.push(bit);
        }
    }
    const ones = data.reduce((s, b) => s + b, 0);
    return ones === 0 || ones === data.length ? null : data;
}
/** @description The dictionary entry nearest a read code, when unique and within the error bound. */
function match(data) {
    let best = null;
    let bestErrors = Infinity;
    let tie = false;
    for (const entry of DICTIONARY) {
        let errors = 0;
        for (let i = 0; i < data.length; i += 1)
            if (data[i] !== entry.bits[i])
                errors += 1;
        if (errors < bestErrors) {
            best = entry;
            bestErrors = errors;
            tie = false;
        }
        else if (errors === bestErrors)
            tie = true;
    }
    if (!best || tie || bestErrors > exports.FACE_MARKER_LIMITS.maxBitErrors)
        return null;
    return { view: best.view, rotationDeg: best.rotationDeg, bitErrors: bestErrors };
}
/** @description The sentence the upload shows for a scan. */
function reasonFor(markers, unknown) {
    if (markers.length === 1)
        return `The ${markers[0].view} face marker is visible, so this photo is the ${markers[0].view} view.`;
    if (markers.length > 1)
        return `Markers for ${markers.map((m) => m.view).join(' and ')} are both visible; assign this photo's view by hand.`;
    if (unknown > 0)
        return 'A marker-like square is visible but its pattern is not an orientation-cube face; assign this photo\'s view by hand.';
    return 'No orientation-cube marker is visible; assign this photo\'s view by hand.';
}
/**
 * @description Find the orientation-cube face markers in a photo and, when exactly one known marker
 * is visible, name the photo's canonical view. The object itself is never a marker: a candidate
 * needs a solid black border ring AND mixed data cells, which a uniformly dark part cannot show.
 * @param raster - The decoded photo.
 * @returns The scan: the view (or null), every known marker, the count of unknown candidates, why.
 */
function detectFaceMarkers(raster) {
    const dark = darkness(raster);
    const threshold = (0, silhouette_1.otsuThreshold)(dark);
    const mask = (0, raster_types_1.createMask)(raster.width, raster.height);
    for (let i = 0; i < dark.length; i += 1)
        mask.data[i] = dark[i] > threshold ? 1 : 0;
    const { labels, sizes } = (0, silhouette_1.labelComponents)(mask);
    const boxes = componentBoxes(labels, sizes.length, raster.width);
    const markers = [];
    let unknown = 0;
    for (let id = 1; id < boxes.length; id += 1) {
        const box = boxes[id];
        if (!box || !isCandidate(box, raster))
            continue;
        const data = readCandidate(mask.data, raster.width, box);
        if (!data)
            continue;
        const found = match(data);
        if (found)
            markers.push({ ...found, bbox: box });
        else
            unknown += 1;
    }
    return { view: markers.length === 1 ? markers[0].view : null, markers, unknown, reason: reasonFor(markers, unknown) };
}
/**
 * @description One face as a printable SVG square of `sideMm`, the marker on white with one cell of
 * margin. Print the six, fold them onto a cube so each reads upright from its own canonical view,
 * and stand the cube beside the object, not touching it, smaller than the object in every photo.
 * @param view - The face.
 * @param sideMm - Printed side of the whole face, millimetres.
 * @returns SVG text.
 * @throws RangeError when the side is not a positive number.
 */
function faceMarkerSvg(view, sideMm) {
    if (!(sideMm > 0) || !Number.isFinite(sideMm))
        throw new RangeError('sideMm must be a positive number');
    const cells = faceMarkerCells(view);
    const n = cells.length + 2;
    const rects = [];
    cells.forEach((row, r) => row.forEach((bit, c) => { if (bit)
        rects.push(`<rect x="${c + 1}" y="${r + 1}" width="1" height="1"/>`); }));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sideMm}mm" height="${sideMm}mm" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><title>${view}</title><rect width="${n}" height="${n}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}
//# sourceMappingURL=face-marker.js.map