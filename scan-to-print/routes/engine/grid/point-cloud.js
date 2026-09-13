"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the point-cloud lane: a `.ply` from an iPhone
 *                     |                             | / iPad LiDAR export (Scaniverse, Polycam), a depth camera or a
 *                     |                             | photogrammetry tool becomes the SAME occupancy grid the photo
 *                     |                             | lane carves. Points mark surface voxels; a morphological close
 *                     |                             | seals sub-voxel gaps; a flood fill from the grid border marks
 *                     |                             | the exterior and everything unreached is the solid interior.
 *                     |                             | The parser is a minimal, bounded PLY reader (ASCII + binary,
 *                     |                             | both endians, x/y/z only) because the store package may not
 *                     |                             | pull a dependency and the kernel's converter targets splats.
 *                     |                             | A leak (scan gap larger than a voxel) is REPORTED, not hidden.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePly = parsePly;
exports.voxelizePointCloud = voxelizePointCloud;
exports.fillSolidFromSurface = fillSolidFromSurface;
const occupancy_grid_1 = require("./occupancy-grid");
/** @description Sizes of PLY scalar types, bytes. */
const PLY_TYPE_BYTES = {
    char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
    int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
};
/** @description Parse the header text; the body starts right after `end_header\n`. */
function parseHeader(bytes) {
    const probe = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    const endToken = 'end_header';
    const endAt = probe.indexOf(endToken);
    if (!probe.startsWith('ply') || endAt < 0)
        throw new RangeError('Not a PLY file (missing ply/end_header)');
    let bodyOffset = endAt + endToken.length;
    if (probe[bodyOffset] === '\r')
        bodyOffset += 1;
    if (probe[bodyOffset] === '\n')
        bodyOffset += 1;
    const header = { format: 'ascii', elements: [], bodyOffset };
    for (const raw of probe.slice(0, endAt).split(/\r?\n/)) {
        const parts = raw.trim().split(/\s+/);
        if (parts[0] === 'format')
            header.format = parts[1];
        else if (parts[0] === 'element')
            header.elements.push({ name: parts[1], count: Number(parts[2]), properties: [] });
        else if (parts[0] === 'property' && header.elements.length > 0) {
            const element = header.elements[header.elements.length - 1];
            if (parts[1] === 'list')
                element.properties.push({ name: parts[4], type: 'list', list: { countType: parts[2], itemType: parts[3] } });
            else
                element.properties.push({ name: parts[2], type: parts[1] });
        }
    }
    if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(header.format)) {
        throw new RangeError(`Unsupported PLY format "${header.format}"`);
    }
    return header;
}
/** @description Read one binary scalar. */
function readScalar(view, at, type, little) {
    switch (type) {
        case 'char':
        case 'int8': return view.getInt8(at);
        case 'uchar':
        case 'uint8': return view.getUint8(at);
        case 'short':
        case 'int16': return view.getInt16(at, little);
        case 'ushort':
        case 'uint16': return view.getUint16(at, little);
        case 'int':
        case 'int32': return view.getInt32(at, little);
        case 'uint':
        case 'uint32': return view.getUint32(at, little);
        case 'float':
        case 'float32': return view.getFloat32(at, little);
        case 'double':
        case 'float64': return view.getFloat64(at, little);
        default: throw new RangeError(`Unsupported PLY property type "${type}"`);
    }
}
/** @description Walk the binary body, collecting vertex xyz and skipping everything else by size. */
function readBinary(bytes, header, out) {
    const little = header.format === 'binary_little_endian';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = header.bodyOffset;
    let written = 0;
    for (const element of header.elements) {
        const isVertex = element.name === 'vertex';
        for (let n = 0; n < element.count; n += 1) {
            for (const prop of element.properties) {
                if (prop.list) {
                    const count = readScalar(view, at, prop.list.countType, little);
                    at += PLY_TYPE_BYTES[prop.list.countType] + count * PLY_TYPE_BYTES[prop.list.itemType];
                    continue;
                }
                if (isVertex && (prop.name === 'x' || prop.name === 'y' || prop.name === 'z')) {
                    out[written * 3 + (prop.name === 'x' ? 0 : prop.name === 'y' ? 1 : 2)] = readScalar(view, at, prop.type, little);
                }
                at += PLY_TYPE_BYTES[prop.type];
            }
            if (isVertex)
                written += 1;
        }
        if (isVertex)
            return;
    }
}
/** @description Walk the ASCII body token by token, same traversal as the binary reader. */
function readAscii(bytes, header, out) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(header.bodyOffset));
    const tokens = text.split(/\s+/).filter((t) => t.length > 0);
    let at = 0;
    let written = 0;
    for (const element of header.elements) {
        const isVertex = element.name === 'vertex';
        for (let n = 0; n < element.count; n += 1) {
            for (const prop of element.properties) {
                if (prop.list) {
                    at += 1 + Number(tokens[at]);
                    continue;
                }
                if (isVertex && (prop.name === 'x' || prop.name === 'y' || prop.name === 'z')) {
                    out[written * 3 + (prop.name === 'x' ? 0 : prop.name === 'y' ? 1 : 2)] = Number(tokens[at]);
                }
                at += 1;
            }
            if (isVertex)
                written += 1;
        }
        if (isVertex)
            return;
    }
}
/**
 * @description Parse a PLY point cloud's vertex positions. Colours, normals, faces and any other
 * element are skipped by size; only `x`, `y`, `z` are read.
 * @param bytes - The file.
 * @param options - See {@link ParsePlyOptions}.
 * @returns The positions.
 * @throws RangeError for a non-PLY file, an unsupported format/type, no vertex element, or too many points.
 */
function parsePly(bytes, options = {}) {
    const header = parseHeader(bytes);
    const vertex = header.elements.find((e) => e.name === 'vertex');
    if (!vertex)
        throw new RangeError('PLY file has no vertex element');
    const names = new Set(vertex.properties.map((p) => p.name));
    if (!names.has('x') || !names.has('y') || !names.has('z'))
        throw new RangeError('PLY vertex element lacks x/y/z');
    const maxPoints = options.maxPoints ?? 5_000_000;
    if (!Number.isInteger(vertex.count) || vertex.count <= 0)
        throw new RangeError('PLY vertex count must be a positive integer');
    if (vertex.count > maxPoints)
        throw new RangeError(`PLY has ${vertex.count} points; the limit is ${maxPoints}`);
    const xyz = new Float32Array(vertex.count * 3);
    if (header.format === 'ascii')
        readAscii(bytes, header, xyz);
    else
        readBinary(bytes, header, xyz);
    for (let i = 0; i < xyz.length; i += 1)
        if (!Number.isFinite(xyz[i]))
            throw new RangeError('PLY contains a non-finite coordinate');
    return { count: vertex.count, xyz };
}
/** @description Scale, re-orient (Y-up → Z-up) and return the transformed points plus their bounds. */
function transformPoints(cloud, unitScale, up) {
    const pts = new Float32Array(cloud.xyz.length);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < cloud.count; i += 1) {
        const sx = cloud.xyz[i * 3] * unitScale;
        const sy = cloud.xyz[i * 3 + 1] * unitScale;
        const sz = cloud.xyz[i * 3 + 2] * unitScale;
        const x = sx;
        const y = up === 'y' ? -sz : sy;
        const z = up === 'y' ? sy : sz;
        pts[i * 3] = x;
        pts[i * 3 + 1] = y;
        pts[i * 3 + 2] = z;
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
    }
    return { pts, min, max };
}
/**
 * @description Drop the points into a grid: footprint centred on X = Y = 0, resting on Z = 0, one
 * voxel set per occupied cell.
 * @param cloud - Parsed positions.
 * @param options - See {@link VoxelizeOptions}.
 * @returns The surface-only grid and the object size.
 * @throws RangeError when the cloud is degenerate (zero extent) or would exceed the voxel ceiling.
 */
function voxelizePointCloud(cloud, options) {
    const unitScale = options.unitScale ?? 1;
    const { pts, min, max } = transformPoints(cloud, unitScale, options.up ?? 'z');
    const sizeMm = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
    if (!(sizeMm.x > 0) || !(sizeMm.y > 0) || !(sizeMm.z > 0))
        throw new RangeError('Point cloud has zero extent along an axis');
    const largest = Math.max(sizeMm.x, sizeMm.y, sizeMm.z);
    if (largest / options.voxelMm > occupancy_grid_1.MAX_VOXELS_PER_AXIS - 2) {
        throw new RangeError(`Voxel ${options.voxelMm} mm is too fine for a ${largest.toFixed(1)} mm object (limit ${occupancy_grid_1.MAX_VOXELS_PER_AXIS} per axis)`);
    }
    const padding = options.padding ?? 2;
    const grid = (0, occupancy_grid_1.createOccupancyGrid)(sizeMm, options.voxelMm, padding, 0);
    const shift = { x: -(min.x + max.x) / 2, y: -(min.y + max.y) / 2, z: -min.z };
    // A point exactly on the bounding box's max face divides to one past the last interior voxel;
    // clamp into the interior so the padding shell stays empty (the mesher's precondition).
    const clampIndex = (raw, count) => Math.min(count - padding - 1, Math.max(padding, raw));
    let pointCount = 0;
    for (let n = 0; n < cloud.count; n += 1) {
        const i = clampIndex(Math.floor((pts[n * 3] + shift.x - grid.originMm.x) / grid.voxelMm), grid.nx);
        const j = clampIndex(Math.floor((pts[n * 3 + 1] + shift.y - grid.originMm.y) / grid.voxelMm), grid.ny);
        const k = clampIndex(Math.floor((pts[n * 3 + 2] + shift.z - grid.originMm.z) / grid.voxelMm), grid.nz);
        grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)] = 1;
        pointCount += 1;
    }
    return { grid, sizeMm, pointCount };
}
/** @description One 6-neighbourhood dilation or erosion pass over the interior (border kept empty). */
function morph3(grid, dilate) {
    const src = new Uint8Array(grid.data);
    for (let k = 1; k < grid.nz - 1; k += 1) {
        for (let j = 1; j < grid.ny - 1; j += 1) {
            for (let i = 1; i < grid.nx - 1; i += 1) {
                const at = (0, occupancy_grid_1.gridIndex)(grid, i, j, k);
                const n = [at - 1, at + 1, at - grid.nx, at + grid.nx, at - grid.nx * grid.ny, at + grid.nx * grid.ny];
                const any = n.some((q) => src[q] === 1);
                const all = n.every((q) => src[q] === 1);
                grid.data[at] = dilate ? (src[at] === 1 || any ? 1 : 0) : (src[at] === 1 && all ? 1 : 0);
            }
        }
    }
}
/**
 * @description Turn a surface-only grid into a solid: close sub-voxel gaps, flood the exterior
 * from the border, and fill everything the flood could not reach. If the flood reaches the
 * inside (a gap bigger than the closing radius), nothing fills and the caller is told.
 * @param grid - Surface grid, mutated in place. Its empty shell must be thicker than `closeRadius`.
 * @param closeRadius - Dilate/erode passes before filling. Default 1. 0 disables closing.
 * @returns Interior voxels filled, and whether the surface was closed.
 * @throws RangeError when the grid is too small to hold a shell thicker than the closing radius.
 */
function fillSolidFromSurface(grid, closeRadius = 1) {
    if (!Number.isInteger(closeRadius) || closeRadius < 0)
        throw new RangeError('closeRadius must be a non-negative integer');
    if (Math.min(grid.nx, grid.ny, grid.nz) < 2 * (closeRadius + 1) + 1)
        throw new RangeError('Grid is too small for the requested closing radius');
    for (let r = 0; r < closeRadius; r += 1)
        morph3(grid, true);
    for (let r = 0; r < closeRadius; r += 1)
        morph3(grid, false);
    const reached = new Uint8Array(grid.data.length);
    const queue = new Int32Array(grid.data.length);
    let head = 0;
    let tail = 0;
    reached[0] = 1;
    queue[tail++] = 0;
    const stride = [1, -1, grid.nx, -grid.nx, grid.nx * grid.ny, -(grid.nx * grid.ny)];
    while (head < tail) {
        const at = queue[head++];
        const i = at % grid.nx;
        const j = Math.floor(at / grid.nx) % grid.ny;
        const k = Math.floor(at / (grid.nx * grid.ny));
        const open = [i < grid.nx - 1, i > 0, j < grid.ny - 1, j > 0, k < grid.nz - 1, k > 0];
        for (let d = 0; d < 6; d += 1) {
            if (!open[d])
                continue;
            const q = at + stride[d];
            if (grid.data[q] === 0 && reached[q] === 0) {
                reached[q] = 1;
                queue[tail++] = q;
            }
        }
    }
    let interiorFilled = 0;
    for (let at = 0; at < grid.data.length; at += 1) {
        if (grid.data[at] === 0 && reached[at] === 0) {
            grid.data[at] = 1;
            interiorFilled += 1;
        }
    }
    return { interiorFilled, closed: interiorFilled > 0 };
}
//# sourceMappingURL=point-cloud.js.map