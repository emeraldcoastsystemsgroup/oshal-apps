"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — frontier exploration for the drone: at the
 *                     |                             | flight altitude, a frontier is a known-free cell next to an
 *                     |                             | unknown one; the next goal is the nearest frontier reachable
 *                     |                             | through known-free cells (breadth-first, deterministic ties),
 *                     |                             | kept a little away from the unknown so the drone never plans
 *                     |                             | into what it has not seen. No frontier means the layer is
 *                     |                             | explored.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | `gainFrontier`: for a downward camera, the goal is where the most unseen columns fit under the footprint for the least flying, from one breadth-first pass — not the nearest edge of the unknown.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | `gainFrontier` skips candidates near spots already scanned from — a column in a cabinet's shadow is unseen from above the cabinet no matter how often the camera looks; the next view has to come from elsewhere.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextFrontier = nextFrontier;
exports.gainFrontier = gainFrontier;
exports.standBack = standBack;
const occupancy_grid_1 = require("./occupancy-grid");
/**
 * @description Find the nearest frontier on a flight grid from a start cell.
 * @param grid - The flight-layer grid (1 = not known free).
 * @param unknownGrid - Same shape; 1 where the layer is UNKNOWN (as opposed to occupied).
 * @param start - Where the drone is.
 * @param minCells - Ignore frontiers closer than this many cells (already effectively seen).
 * @returns The goal, or null when no frontier is reachable.
 */
function nextFrontier(grid, unknownGrid, start, minCells = 6) {
    if (!(0, occupancy_grid_1.isFree)(grid, start))
        return null;
    const s = (0, occupancy_grid_1.worldToCell)(grid, start);
    const sIdx = s.j * grid.width + s.i;
    const dist = new Int32Array(grid.cells.length).fill(-1);
    const parent = new Int32Array(grid.cells.length).fill(-1);
    const queue = [sIdx];
    dist[sIdx] = 0;
    let head = 0;
    let frontierCount = 0;
    let goal = -1;
    const isFrontier = (idx) => {
        const i = idx % grid.width;
        const j = Math.floor(idx / grid.width);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= grid.width || jj >= grid.height)
                continue;
            if (unknownGrid.cells[jj * grid.width + ii])
                return true;
        }
        return false;
    };
    while (head < queue.length) {
        const cur = queue[head];
        head += 1;
        if (isFrontier(cur)) {
            frontierCount += 1;
            if (goal < 0 && dist[cur] >= minCells)
                goal = cur;
        }
        const i = cur % grid.width;
        const j = Math.floor(cur / grid.width);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= grid.width || jj >= grid.height)
                continue;
            const n = jj * grid.width + ii;
            if (grid.cells[n] || dist[n] >= 0)
                continue;
            dist[n] = dist[cur] + 1;
            parent[n] = cur;
            queue.push(n);
        }
    }
    if (goal < 0)
        return null;
    const path = [];
    for (let c = goal; c !== -1; c = parent[c])
        path.push((0, occupancy_grid_1.cellToWorld)(grid, c % grid.width, Math.floor(c / grid.width)));
    path.reverse();
    path[0] = { x: start.x, y: start.y };
    return { point: path[path.length - 1], path, frontierCount };
}
/**
 * @description The reachable cell where the most unseen columns fit under a downward camera's footprint, for the
 * least flying: score = unseen cells within `radiusCells` ÷ (path length + 4). One breadth-first pass gives every
 * cell's distance and parent; candidates are sampled every `stride` cells. Null when nothing reachable would
 * teach the camera at least `minGain` columns — exploration is then finished, not stuck.
 * @param grid - The flight grid (0 = flyable).
 * @param unseen - Columns whose top has not been seen (1 = unseen).
 * @param start - Where the drone is.
 * @param radiusCells - The camera footprint as a radius in cells.
 * @param minGain - The least number of new columns worth a flight.
 * @param stride - Candidate sampling stride in cells.
 * @returns The best goal with its path, or null.
 */
function gainFrontier(grid, unseen, start, radiusCells, minGain, stride = 2, avoid = [], avoidM = 0.4) {
    if (!(0, occupancy_grid_1.isFree)(grid, start))
        return null;
    const s = (0, occupancy_grid_1.worldToCell)(grid, start);
    const sIdx = s.j * grid.width + s.i;
    const dist = new Int32Array(grid.cells.length).fill(-1);
    const parent = new Int32Array(grid.cells.length).fill(-1);
    const queue = [sIdx];
    dist[sIdx] = 0;
    let head = 0;
    while (head < queue.length) {
        const cur = queue[head];
        head += 1;
        const i = cur % grid.width;
        const j = Math.floor(cur / grid.width);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= grid.width || jj >= grid.height)
                continue;
            const n = jj * grid.width + ii;
            if (grid.cells[n] || dist[n] >= 0)
                continue;
            dist[n] = dist[cur] + 1;
            parent[n] = cur;
            queue.push(n);
        }
    }
    const offs = [];
    for (let dj = -radiusCells; dj <= radiusCells; dj += 1)
        for (let di = -radiusCells; di <= radiusCells; di += 1)
            if (di * di + dj * dj <= radiusCells * radiusCells)
                offs.push([di, dj]);
    let best = -1;
    let bestScore = 0;
    let bestGain = 0;
    let frontierCount = 0;
    for (let j = 0; j < grid.height; j += stride)
        for (let i = 0; i < grid.width; i += stride) {
            const idx = j * grid.width + i;
            if (dist[idx] < 1)
                continue;
            // A spot already scanned from teaches nothing new: what stayed unseen from there is in shadow from there.
            const here = (0, occupancy_grid_1.cellToWorld)(grid, i, j);
            if (avoid.some((a) => Math.hypot(a.x - here.x, a.y - here.y) < avoidM))
                continue;
            let gain = 0;
            for (const [di, dj] of offs) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= grid.width || jj >= grid.height)
                    continue;
                if (unseen.cells[jj * grid.width + ii])
                    gain += 1;
            }
            if (gain < minGain)
                continue;
            frontierCount += 1;
            const score = gain / (dist[idx] + 4);
            if (score > bestScore) {
                bestScore = score;
                best = idx;
                bestGain = gain;
            }
        }
    if (best < 0)
        return null;
    const path = [];
    for (let c = best; c !== -1; c = parent[c])
        path.push((0, occupancy_grid_1.cellToWorld)(grid, c % grid.width, Math.floor(c / grid.width)));
    path.reverse();
    path[0] = { x: start.x, y: start.y };
    return { goal: path[path.length - 1], path, gain: bestGain, frontierCount };
}
function standBack(goal, backCells = 3) {
    const idx = Math.max(0, goal.path.length - 1 - backCells);
    return goal.path[idx];
}
//# sourceMappingURL=explore.js.map