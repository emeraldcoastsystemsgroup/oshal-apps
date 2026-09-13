"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — shape-from-silhouette (the visual hull) over
 *                     |                             | the occupancy grid. Two halves: REGISTRATION turns each photo's
 *                     |                             | silhouette bounding box plus ONE known dimension into a
 *                     |                             | millimetres-per-pixel scale and an image centre per view (the
 *                     |                             | object's bounding box is the registration key — the capture
 *                     |                             | contract is "camera square to the face"); CARVING then deletes
 *                     |                             | every voxel whose centre lands on background in any view. No
 *                     |                             | solver iterates to convergence and nothing is estimated
 *                     |                             | stochastically: the same photos and the same number always
 *                     |                             | yield the same grid, which is the whole point of the package.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSilhouettes = registerSilhouettes;
exports.carveSilhouettes = carveSilhouettes;
exports.chooseVoxelMm = chooseVoxelMm;
const raster_types_1 = require("../raster/raster-types");
const occupancy_grid_1 = require("./occupancy-grid");
const views_1 = require("./views");
/** @description Relative disagreement between two scale estimates above which a warning is raised. */
const SCALE_DISAGREEMENT = 0.1;
/** @description Pixel extents of a silhouette along the view's `u` and `v` axes. */
function pixelExtents(box) {
    return { uPx: box.maxX - box.minX + 1, vPx: box.maxY - box.minY + 1 };
}
/** @description Reject inputs that cannot register: no views, a duplicate view, an empty mask, no anchor. */
function validateInputs(silhouettes, known) {
    if (silhouettes.length === 0)
        throw new RangeError('At least one view silhouette is required');
    if (known.length === 0)
        throw new RangeError('At least one known dimension is required to set the scale');
    for (const dim of known) {
        if (!(dim.mm > 0) || !Number.isFinite(dim.mm))
            throw new RangeError(`Known ${dim.axis} dimension must be a positive number`);
    }
    const boxes = new Map();
    for (const s of silhouettes) {
        if (boxes.has(s.view))
            throw new RangeError(`View "${s.view}" was supplied twice`);
        const { bbox } = (0, raster_types_1.maskStats)(s.mask);
        if (!bbox)
            throw new RangeError(`View "${s.view}" has an empty silhouette`);
        boxes.set(s.view, bbox);
    }
    return boxes;
}
/**
 * @description Propagate known extents through the views until nothing new resolves: a view that
 * knows one of its two axes in millimetres yields the other from the pixel ratio.
 * @param boxes - Silhouette bounds per view.
 * @param sizes - Partially known extents, mutated.
 * @param sources - Provenance per axis, mutated.
 * @returns Nothing; the maps are updated in place.
 */
function propagateExtents(boxes, sizes, sources) {
    let progress = true;
    while (progress) {
        progress = false;
        for (const [view, box] of boxes) {
            const frame = views_1.VIEW_FRAMES[view];
            const { uPx, vPx } = pixelExtents(box);
            const uAxis = frame.u.axis;
            const vAxis = frame.v.axis;
            if (sizes[uAxis] !== undefined && sizes[vAxis] === undefined) {
                sizes[vAxis] = sizes[uAxis] * (vPx / uPx);
                sources[vAxis] = 'derived';
                progress = true;
            }
            else if (sizes[vAxis] !== undefined && sizes[uAxis] === undefined) {
                sizes[uAxis] = sizes[vAxis] * (uPx / vPx);
                sources[uAxis] = 'derived';
                progress = true;
            }
        }
    }
}
/** @description Build one view's calibration from the resolved sizes, warning when its two axes disagree. */
function calibrateView(view, box, sizeMm, warnings) {
    const frame = views_1.VIEW_FRAMES[view];
    const { uPx, vPx } = pixelExtents(box);
    const fromU = sizeMm[frame.u.axis] / uPx;
    const fromV = sizeMm[frame.v.axis] / vPx;
    const disagreement = Math.abs(fromU - fromV) / Math.max(fromU, fromV);
    if (disagreement > SCALE_DISAGREEMENT) {
        warnings.push(`${view} view: its ${frame.u.axis}/${frame.v.axis} proportions disagree with the other views by ${Math.round(disagreement * 100)}%; the photo may not be square to the face.`);
    }
    const center = { x: 0, y: 0, z: sizeMm.z / 2 };
    return {
        view,
        mmPerPx: (fromU + fromV) / 2,
        bbox: box,
        uCenterPx: (box.minX + box.maxX + 1) / 2,
        vCenterPx: (box.minY + box.maxY + 1) / 2,
        uCenterMm: (0, views_1.readAxis)(center, frame.u),
        vCenterMm: (0, views_1.readAxis)(center, frame.v),
    };
}
/**
 * @description Resolve the object's world size and every view's pixel calibration from the
 * silhouettes and the known dimension(s). An axis no supplied view can see is ASSUMED equal to
 * the first known dimension and flagged — the drawing carries that flag.
 * @param silhouettes - One mask per supplied view.
 * @param known - One to three measured extents.
 * @returns The registration.
 * @throws RangeError when the inputs cannot register (see {@link validateInputs}).
 */
function registerSilhouettes(silhouettes, known) {
    const boxes = validateInputs(silhouettes, known);
    const sizes = {};
    const sources = {};
    for (const dim of known) {
        sizes[dim.axis] = dim.mm;
        sources[dim.axis] = 'known';
    }
    propagateExtents(boxes, sizes, sources);
    const warnings = [];
    for (const axis of ['x', 'y', 'z']) {
        if (sizes[axis] !== undefined)
            continue;
        sizes[axis] = known[0].mm;
        sources[axis] = 'assumed';
        warnings.push(`Extent along ${axis.toUpperCase()} is not visible in any supplied view; assumed ${known[0].mm} mm. Add a view that shows it, or enter it as a known dimension.`);
    }
    const sizeMm = { x: sizes.x, y: sizes.y, z: sizes.z };
    const views = [...boxes].map(([view, box]) => calibrateView(view, box, sizeMm, warnings));
    return { sizeMm, sources: sources, views, warnings };
}
/** @description Pixel coordinates a world point lands on in one calibrated view. */
function pixelOf(p, cal) {
    const { u, v } = (0, views_1.projectToView)(p, views_1.VIEW_FRAMES[cal.view]);
    return {
        col: Math.floor(cal.uCenterPx + (u - cal.uCenterMm) / cal.mmPerPx),
        row: Math.floor(cal.vCenterPx + (v - cal.vCenterMm) / cal.mmPerPx),
    };
}
/**
 * @description Carve the grid by every registered silhouette: a voxel survives only if its centre
 * projects onto the object in EVERY supplied view. The result is the visual hull — the largest
 * solid consistent with the outlines, which means cavities no outline can see stay filled. That
 * is a property of the method, reported as such, and exactly the gap a depth or LiDAR carve fills.
 * @param grid - Grid to carve, mutated in place. Start it solid ({@link createOccupancyGrid} fill 1).
 * @param registration - From {@link registerSilhouettes}.
 * @param silhouettes - The same masks the registration was built from.
 * @returns How many voxels were removed and how many remain solid.
 * @throws RangeError when a calibrated view has no matching silhouette.
 */
function carveSilhouettes(grid, registration, silhouettes) {
    const masks = new Map(silhouettes.map((s) => [s.view, s.mask]));
    const lanes = registration.views.map((cal) => {
        const mask = masks.get(cal.view);
        if (!mask)
            throw new RangeError(`No silhouette supplied for calibrated view "${cal.view}"`);
        return { cal, mask };
    });
    let carved = 0;
    let remaining = 0;
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                const at = (0, occupancy_grid_1.gridIndex)(grid, i, j, k);
                if (grid.data[at] === 0)
                    continue;
                const center = (0, occupancy_grid_1.voxelCenter)(grid, i, j, k);
                const outside = lanes.some(({ cal, mask }) => {
                    const { col, row } = pixelOf(center, cal);
                    return (0, raster_types_1.maskAt)(mask, col, row) === 0;
                });
                if (outside) {
                    grid.data[at] = 0;
                    carved += 1;
                }
                else
                    remaining += 1;
            }
        }
    }
    return { carved, remaining };
}
/**
 * @description Voxel edge that puts `resolution` voxels along the object's largest extent.
 * @param sizeMm - Object size.
 * @param resolution - Voxels along the largest axis.
 * @returns Millimetres per voxel.
 * @throws RangeError when the resolution is not a positive integer.
 */
function chooseVoxelMm(sizeMm, resolution) {
    if (!Number.isInteger(resolution) || resolution <= 0)
        throw new RangeError('Resolution must be a positive integer');
    return Math.max(sizeMm.x, sizeMm.y, sizeMm.z) / resolution;
}
//# sourceMappingURL=silhouette-carver.js.map