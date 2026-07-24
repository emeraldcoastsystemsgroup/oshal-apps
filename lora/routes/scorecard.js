"use strict";
/**
 * LoRA Studio scorecard math — pure functions shared by the ingest route and the box-side
 * validator's reference logic. A character LoRA is scored on a FIXED held-out matrix of
 * pose × camera × expression cells; each cell gets an identity score (does it still look like
 * THE character) and a quality score. "Better" is the mean cell score, so versions are comparable.
 *
 * @module lora-studio/scorecard
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUALITY_WEIGHT = exports.IDENTITY_WEIGHT = void 0;
exports.cellScore = cellScore;
exports.summarizeScore = summarizeScore;
exports.computeWeakCells = computeWeakCells;
/** Weight on identity vs quality in a cell's combined score (identity matters most for a sprite). */
exports.IDENTITY_WEIGHT = 0.6;
exports.QUALITY_WEIGHT = 0.4;
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
/** The combined per-cell score (uses an explicit `score` if present, else the weighted blend). */
function cellScore(c) {
    if (typeof c.score === 'number' && Number.isFinite(c.score))
        return clamp01(c.score);
    return clamp01(exports.IDENTITY_WEIGHT * clamp01(c.identity) + exports.QUALITY_WEIGHT * clamp01(c.quality));
}
/** Version-level rollup over all cells (overall / identity / quality means + the worst cell). */
function summarizeScore(cells) {
    if (!cells.length)
        return { overall: 0, identityMean: 0, qualityMean: 0, minCell: 0 };
    const scores = cells.map(cellScore);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
        overall: round4(mean(scores)),
        identityMean: round4(mean(cells.map((c) => clamp01(c.identity)))),
        qualityMean: round4(mean(cells.map((c) => clamp01(c.quality)))),
        minCell: round4(Math.min(...scores)),
    };
}
/**
 * @description Find axis values that score systematically below the overall mean — these are the
 * weak spots the next training batch should target. An axis value is "weak" when its mean cell
 * score is at least `margin` below the overall mean. Returned ascending by mean (worst first).
 * @param cells - the scored validation cells
 * @param margin - how far below overall counts as weak (default 0.08)
 */
function computeWeakCells(cells, margin = 0.08) {
    if (!cells.length)
        return [];
    const overall = summarizeScore(cells).overall;
    const axes = ['action', 'camera', 'expression'];
    const weak = [];
    for (const axis of axes) {
        const byValue = new Map();
        for (const c of cells) {
            const v = c[axis];
            if (!v)
                continue;
            (byValue.get(v) ?? byValue.set(v, []).get(v)).push(cellScore(c));
        }
        for (const [value, scores] of byValue) {
            const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
            if (mean <= overall - margin)
                weak.push({ axis, value, mean: round4(mean) });
        }
    }
    return weak.sort((a, b) => a.mean - b.mean);
}
function round4(n) {
    return Math.round(n * 1e4) / 1e4;
}
//# sourceMappingURL=scorecard.js.map