"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — deterministic silhouette extraction. The
 *                     |                             | object is whatever is NOT the background, and the background
 *                     |                             | is estimated from the photo's own border rather than assumed
 *                     |                             | white: a phone photo on a kitchen table has a beige background,
 *                     |                             | and a fixed threshold would either eat the object or keep the
 *                     |                             | table. Otsu's method picks the split from the image's own
 *                     |                             | distance histogram, so the same photo always yields the same
 *                     |                             | mask — there is no model, no seed and no randomness anywhere in
 *                     |                             | this file, which is the property the reconstruction inherits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateBackground = estimateBackground;
exports.distanceMap = distanceMap;
exports.otsuThreshold = otsuThreshold;
exports.openClose = openClose;
exports.labelComponents = labelComponents;
exports.largestComponent = largestComponent;
exports.fillHoles = fillHoles;
exports.extractSilhouette = extractSilhouette;
const raster_types_1 = require("./raster-types");
/** @description Median of a numeric sample; the background estimator's robustness comes from it. */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/**
 * @description Estimate the background as the per-channel median of the border pixels. Median,
 * not mean: the object often touches one edge, and a median ignores that minority.
 * @param raster - Source image.
 * @param borderFraction - Frame thickness as a fraction of the shorter side.
 * @returns The background colour.
 */
function estimateBackground(raster, borderFraction) {
    const frame = Math.max(1, Math.round(Math.min(raster.width, raster.height) * borderFraction));
    const r = [];
    const g = [];
    const b = [];
    for (let y = 0; y < raster.height; y += 1) {
        const onRowFrame = y < frame || y >= raster.height - frame;
        for (let x = 0; x < raster.width; x += 1) {
            if (!onRowFrame && x >= frame && x < raster.width - frame)
                continue;
            const at = (y * raster.width + x) * 4;
            r.push(raster.data[at]);
            g.push(raster.data[at + 1]);
            b.push(raster.data[at + 2]);
        }
    }
    return { r: median(r), g: median(g), b: median(b) };
}
/**
 * @description Per-pixel Euclidean RGB distance from the background, scaled to 0..255.
 * @param raster - Source image.
 * @param background - Background colour.
 * @returns One byte per pixel.
 */
function distanceMap(raster, background) {
    const out = new Uint8Array(raster.width * raster.height);
    const scale = 255 / Math.sqrt(3 * 255 * 255);
    for (let i = 0; i < out.length; i += 1) {
        const at = i * 4;
        const dr = raster.data[at] - background.r;
        const dg = raster.data[at + 1] - background.g;
        const db = raster.data[at + 2] - background.b;
        out[i] = Math.min(255, Math.round(Math.sqrt(dr * dr + dg * dg + db * db) * scale));
    }
    return out;
}
/**
 * @description Otsu's threshold over a byte histogram: the split that maximises between-class
 * variance. Returns 0 when the histogram is degenerate (one level), which the caller floors.
 * @param values - Byte samples.
 * @returns The threshold; pixels strictly above it are foreground.
 */
function otsuThreshold(values) {
    const histogram = new Float64Array(256);
    for (let i = 0; i < values.length; i += 1)
        histogram[values[i]] += 1;
    const total = values.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t += 1)
        sumAll += t * histogram[t];
    let weightBackground = 0;
    let sumBackground = 0;
    let first = 0;
    let last = 0;
    let bestVariance = 0;
    for (let t = 0; t < 256; t += 1) {
        weightBackground += histogram[t];
        if (weightBackground === 0)
            continue;
        const weightForeground = total - weightBackground;
        if (weightForeground === 0)
            break;
        sumBackground += t * histogram[t];
        const meanBackground = sumBackground / weightBackground;
        const meanForeground = (sumAll - sumBackground) / weightForeground;
        const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
        // A clean two-level image has a PLATEAU of equally good thresholds spanning the empty gap
        // between the levels; take its middle so a hairline of noise on either side does not flip
        // the verdict. Strict "first maximum" would sit at the very bottom of the gap.
        if (variance > bestVariance) {
            bestVariance = variance;
            first = t;
            last = t;
        }
        else if (variance === bestVariance && bestVariance > 0) {
            last = t;
        }
    }
    return Math.floor((first + last) / 2);
}
/**
 * @description One 3×3 erosion or dilation pass (8-neighbourhood). Off-image neighbours are
 * EDGE-REPLICATED (clamped into the image) rather than read as background, so an object that
 * touches the frame keeps touching it — the "clipped" warning depends on that pixel surviving.
 */
function morph(mask, dilate) {
    const out = (0, raster_types_1.createMask)(mask.width, mask.height);
    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            let hit = dilate ? 0 : 1;
            for (let dy = -1; dy <= 1 && (dilate ? hit === 0 : hit === 1); dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const nx = Math.min(mask.width - 1, Math.max(0, x + dx));
                    const ny = Math.min(mask.height - 1, Math.max(0, y + dy));
                    const v = mask.data[ny * mask.width + nx];
                    if (dilate && v === 1) {
                        hit = 1;
                        break;
                    }
                    if (!dilate && v === 0) {
                        hit = 0;
                        break;
                    }
                }
            }
            out.data[y * mask.width + x] = hit;
        }
    }
    return out;
}
/**
 * @description Morphological open then close with a 3×3 element, `radius` times each. Open drops
 * speckle; close seals pinholes. Both preserve the outline to within `radius` pixels.
 * @param mask - Input mask.
 * @param radius - Passes per operation. 0 returns the input untouched.
 * @returns The cleaned mask.
 */
function openClose(mask, radius) {
    let current = mask;
    for (let i = 0; i < radius; i += 1)
        current = morph(current, false);
    for (let i = 0; i < radius; i += 1)
        current = morph(current, true);
    for (let i = 0; i < radius; i += 1)
        current = morph(current, true);
    for (let i = 0; i < radius; i += 1)
        current = morph(current, false);
    return current;
}
/**
 * @description Label 4-connected components and return the component id per pixel (0 = background)
 * plus the pixel count per id. Iterative BFS on typed arrays — no recursion, no stack growth.
 * @param mask - Input mask.
 * @returns Labels and per-label sizes (index 0 unused).
 */
function labelComponents(mask) {
    const labels = new Int32Array(mask.width * mask.height);
    const queue = new Int32Array(mask.width * mask.height);
    const sizes = [0];
    for (let start = 0; start < labels.length; start += 1) {
        if (mask.data[start] === 0 || labels[start] !== 0)
            continue;
        const id = sizes.length;
        sizes.push(0);
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = id;
        while (head < tail) {
            const at = queue[head++];
            sizes[id] += 1;
            const x = at % mask.width;
            const y = (at - x) / mask.width;
            const neighbours = [x > 0 ? at - 1 : -1, x < mask.width - 1 ? at + 1 : -1, y > 0 ? at - mask.width : -1, y < mask.height - 1 ? at + mask.width : -1];
            for (const n of neighbours) {
                if (n >= 0 && mask.data[n] === 1 && labels[n] === 0) {
                    labels[n] = id;
                    queue[tail++] = n;
                }
            }
        }
    }
    return { labels, sizes };
}
/**
 * @description Keep only the largest 4-connected component — the object — and drop every other
 * blob (a shadow fragment, a crumb, the edge of the table).
 * @param mask - Input mask.
 * @returns A mask holding only the largest component; all-zero when the input is empty.
 */
function largestComponent(mask) {
    const { labels, sizes } = labelComponents(mask);
    let keep = 0;
    for (let id = 1; id < sizes.length; id += 1)
        if (sizes[id] > sizes[keep])
            keep = id;
    const out = (0, raster_types_1.createMask)(mask.width, mask.height);
    if (keep === 0)
        return out;
    for (let i = 0; i < labels.length; i += 1)
        out.data[i] = labels[i] === keep ? 1 : 0;
    return out;
}
/**
 * @description Fill enclosed background pockets: flood the background from the image border, and
 * everything still unreached is inside the object. A silhouette is an outline, not a texture — a
 * dark logo on a light object must not carve a tunnel through the part.
 * @param mask - Input mask.
 * @returns A mask with interior holes set to 1.
 */
function fillHoles(mask) {
    const reached = new Uint8Array(mask.width * mask.height);
    const queue = new Int32Array(mask.width * mask.height);
    let head = 0;
    let tail = 0;
    const seed = (at) => {
        if (mask.data[at] === 0 && reached[at] === 0) {
            reached[at] = 1;
            queue[tail++] = at;
        }
    };
    for (let x = 0; x < mask.width; x += 1) {
        seed(x);
        seed((mask.height - 1) * mask.width + x);
    }
    for (let y = 0; y < mask.height; y += 1) {
        seed(y * mask.width);
        seed(y * mask.width + mask.width - 1);
    }
    while (head < tail) {
        const at = queue[head++];
        const x = at % mask.width;
        const y = (at - x) / mask.width;
        if (x > 0)
            seed(at - 1);
        if (x < mask.width - 1)
            seed(at + 1);
        if (y > 0)
            seed(at - mask.width);
        if (y < mask.height - 1)
            seed(at + mask.width);
    }
    const out = (0, raster_types_1.createMask)(mask.width, mask.height);
    for (let i = 0; i < out.data.length; i += 1)
        out.data[i] = mask.data[i] === 1 || reached[i] === 0 ? 1 : 0;
    return out;
}
/** @description Capture problems worth telling the person about, derived from the mask alone. */
function captureWarnings(stats, mask, threshold, minThreshold) {
    const warnings = [];
    if (stats.pixels === 0) {
        warnings.push('No object found: the photo looks uniform. Use a plain background that contrasts with the object.');
        return warnings;
    }
    if (threshold <= minThreshold)
        warnings.push('Low contrast between object and background; the outline may be unreliable.');
    if (stats.coverage < 0.02)
        warnings.push('The object is very small in the frame; move closer so it fills more of the photo.');
    if (stats.coverage > 0.9)
        warnings.push('The object fills almost the whole frame; the background estimate is unreliable.');
    const box = stats.bbox;
    if (box && (box.minX === 0 || box.minY === 0 || box.maxX === mask.width - 1 || box.maxY === mask.height - 1)) {
        warnings.push('The object touches the edge of the photo; part of the outline may be cut off.');
    }
    return warnings;
}
/**
 * @description Extract the object silhouette from a photo: background from the border, Otsu split
 * on colour distance, open/close cleanup, largest component, holes filled. Same input, same mask.
 * @param raster - Decoded RGBA photo.
 * @param options - See {@link SilhouetteOptions}.
 * @returns The mask, the decisions behind it and any capture warnings.
 */
function extractSilhouette(raster, options = {}) {
    const borderFraction = options.borderFraction ?? 0.03;
    const minThreshold = options.minThreshold ?? 14;
    const radius = options.morphologyRadius ?? 1;
    const background = estimateBackground(raster, borderFraction);
    const distances = distanceMap(raster, background);
    const threshold = Math.max(minThreshold, otsuThreshold(distances));
    let mask = (0, raster_types_1.createMask)(raster.width, raster.height);
    for (let i = 0; i < distances.length; i += 1)
        mask.data[i] = distances[i] > threshold ? 1 : 0;
    if (radius > 0)
        mask = openClose(mask, radius);
    mask = largestComponent(mask);
    if (options.fillHoles ?? true)
        mask = fillHoles(mask);
    const stats = (0, raster_types_1.maskStats)(mask);
    return { mask, threshold, background, stats, warnings: captureWarnings(stats, mask, threshold, minThreshold) };
}
//# sourceMappingURL=silhouette.js.map