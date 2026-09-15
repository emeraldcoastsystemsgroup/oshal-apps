"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the discovered world the machine and the bots
 *                     |                             | reason over: the occupancy map plus TRACKED surfaces and
 *                     |                             | objects with ids that stay stable across scans (matched by
 *                     |                             | height/overlap and by centroid distance), first-seen and
 *                     |                             | last-seen scan numbers, and a label a bot or a person may
 *                     |                             | attach. An object whose voxels were lifted away is dropped;
 *                     |                             | one not seen again is kept until its space is seen free.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A raw detection also matches a tracked object whose footprint it shares (> 50 %), and a tracked object not seen this refresh is dropped when a current one covers > 30 % of its footprint — a half-seen plate from the air is the same plate once the rest is seen, not a second one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldModel = void 0;
const discover_1 = require("./discover");
const voxel_map_1 = require("./voxel-map");
/** @description The world model. */
/** @description The xy overlap of two object boxes as a fraction of the smaller footprint — a partial view of a plate and the whole plate share most of it. */
function footprintOverlap(a, b) {
    const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
    const h = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
    if (w <= 0 || h <= 0)
        return 0;
    const areaA = (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]);
    const areaB = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]);
    return (w * h) / Math.max(1e-9, Math.min(areaA, areaB));
}
class WorldModel {
    opts;
    map;
    surfaces = [];
    objects = [];
    nextSurface = 1;
    nextObject = 1;
    refreshedAt = -1;
    constructor(bounds, opts = discover_1.DEFAULT_DISCOVER, map) {
        this.opts = opts;
        this.map = map ?? new voxel_map_1.VoxelMap(bounds);
    }
    /** @description A deep copy with the same ids. */
    clone() {
        const w = new WorldModel(this.map.bounds, this.opts, this.map.clone());
        w.surfaces = JSON.parse(JSON.stringify(this.surfaces));
        w.objects = JSON.parse(JSON.stringify(this.objects));
        w.nextSurface = this.nextSurface;
        w.nextObject = this.nextObject;
        w.refreshedAt = this.refreshedAt;
        return w;
    }
    /** @description Re-run discovery when the map changed since the last refresh; match to tracked entities. */
    refresh() {
        if (this.refreshedAt === this.map.version)
            return;
        this.refreshedAt = this.map.version;
        const tops = (0, discover_1.heightField)(this.map);
        const rawS = (0, discover_1.discoverSurfaces)(this.map, this.opts, tops);
        const surfaceIds = rawS.map((s) => this.matchSurface(s));
        const rawO = (0, discover_1.discoverObjects)(this.map, rawS, this.opts, tops);
        const seen = new Set();
        for (const o of rawO) {
            const id = this.matchObject(o, surfaceIds[o.surface]);
            seen.add(id);
        }
        // Drop tracked objects whose space is now known free (they were moved or lifted), and partial
        // views superseded by a fuller detection over the same footprint.
        const current = this.objects.filter((o) => seen.has(o.id));
        this.objects = this.objects.filter((o) => seen.has(o.id) || (!this.spaceIsFree(o) && !current.some((c) => footprintOverlap(c, o) > 0.3)));
    }
    matchSurface(s) {
        const hit = this.surfaces.find((t) => Math.abs(t.z - s.z) <= this.map.res * 1.5 && overlap(t.bbox, s.bbox) > 0.3);
        if (hit) {
            Object.assign(hit, { z: s.z, bbox: s.bbox, centroid: s.centroid, areaM2: s.areaM2, columns: s.columns, lastSeenScan: this.map.scans });
            return hit.id;
        }
        const id = `surf-${this.nextSurface}`;
        this.nextSurface += 1;
        this.surfaces.push({ id, z: s.z, bbox: s.bbox, centroid: s.centroid, areaM2: s.areaM2, columns: s.columns, firstSeenScan: this.map.scans, lastSeenScan: this.map.scans, label: null });
        return id;
    }
    matchObject(o, surfaceId) {
        const size = { l: o.max[0] - o.min[0], w: o.max[1] - o.min[1], h: o.max[2] - o.supportZ };
        const probe = { min: o.min, max: o.max };
        const hit = this.objects.find((t) => Math.hypot(t.centroid[0] - o.centroid[0], t.centroid[1] - o.centroid[1], t.centroid[2] - o.centroid[2]) < 0.08 || footprintOverlap(t, probe) > 0.5);
        if (hit) {
            Object.assign(hit, { centroid: o.centroid, min: o.min, max: o.max, size, surfaceId, supportZ: o.supportZ, guess: o.guess, voxels: o.voxels, lastSeenScan: this.map.scans });
            return hit.id;
        }
        const id = `obj-${this.nextObject}`;
        this.nextObject += 1;
        this.objects.push({ id, centroid: o.centroid, min: o.min, max: o.max, size, surfaceId, supportZ: o.supportZ, guess: o.guess, voxels: o.voxels, firstSeenScan: this.map.scans, lastSeenScan: this.map.scans, label: null });
        return id;
    }
    /** @description True when most of a tracked object's box now reads FREE. */
    spaceIsFree(o) {
        const [i0, j0, k0] = this.map.toCell(o.min);
        const [i1, j1, k1] = this.map.toCell([o.max[0] - 1e-6, o.max[1] - 1e-6, o.max[2] - 1e-6]);
        let total = 0;
        let free = 0;
        for (let k = k0; k <= k1; k += 1)
            for (let j = j0; j <= j1; j += 1)
                for (let i = i0; i <= i1; i += 1) {
                    if (!this.map.inside(i, j, k))
                        continue;
                    total += 1;
                    if (this.map.cells[this.map.index(i, j, k)] === voxel_map_1.FREE)
                        free += 1;
                }
        return total > 0 && free / total > 0.6;
    }
    /** @description Forget an object (it is in the gripper) and free its voxels. */
    lift(objectId) {
        const o = this.objects.find((x) => x.id === objectId);
        if (!o)
            return null;
        this.map.clearBox([o.min[0], o.min[1], o.min[2] + this.map.res], o.max, o.supportZ);
        this.objects = this.objects.filter((x) => x.id !== objectId);
        this.refreshedAt = -1;
        return o;
    }
    /** @description Look-ups. */
    surface(id) { return this.surfaces.find((s) => s.id === id) ?? null; }
    object(id) { return this.objects.find((o) => o.id === id) ?? null; }
    objectsOn(surfaceId) { return this.objects.filter((o) => o.surfaceId === surfaceId); }
    stats() { return this.map.stats(); }
    /** @description Plain data for the surface and the bots. */
    snapshot() {
        return { stats: this.stats(), surfaces: this.surfaces.map(({ columns, ...s }) => ({ ...s, cells: columns.length })), objects: this.objects };
    }
}
exports.WorldModel = WorldModel;
/** @description Fraction of the smaller box covered by the intersection. */
function overlap(a, b) {
    const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
    const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
    const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
    const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
    return (ix * iy) / Math.max(1e-9, Math.min(areaA, areaB));
}
//# sourceMappingURL=world-model.js.map