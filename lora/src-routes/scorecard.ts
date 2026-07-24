/**
 * LoRA Studio scorecard math — pure functions shared by the ingest route and the box-side
 * validator's reference logic. A character LoRA is scored on a FIXED held-out matrix of
 * pose × camera × expression cells; each cell gets an identity score (does it still look like
 * THE character) and a quality score. "Better" is the mean cell score, so versions are comparable.
 *
 * @module lora-studio/scorecard
 */

/** Weight on identity vs quality in a cell's combined score (identity matters most for a sprite). */
export const IDENTITY_WEIGHT = 0.6;
export const QUALITY_WEIGHT = 0.4;

/** One validation-matrix cell's result. */
export interface ScoreCell {
  /** Stable cell key, e.g. "running|side profile view|screaming". */
  cell: string;
  action?: string;
  camera?: string;
  expression?: string;
  /** 0..1 — CLIP cosine to the locked hero (consistency). */
  identity: number;
  /** 0..1 — no-reference quality proxy. */
  quality: number;
  /** 0..1 — combined; defaults to IDENTITY_WEIGHT·identity + QUALITY_WEIGHT·quality. */
  score?: number;
  image?: string;
}

/** A systematically weak axis value the targeted-improve loop should over-sample. */
export interface WeakCell {
  axis: 'action' | 'camera' | 'expression';
  value: string;
  mean: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The combined per-cell score (uses an explicit `score` if present, else the weighted blend). */
export function cellScore(c: ScoreCell): number {
  if (typeof c.score === 'number' && Number.isFinite(c.score)) return clamp01(c.score);
  return clamp01(IDENTITY_WEIGHT * clamp01(c.identity) + QUALITY_WEIGHT * clamp01(c.quality));
}

/** Version-level rollup over all cells (overall / identity / quality means + the worst cell). */
export function summarizeScore(cells: ScoreCell[]): {
  overall: number;
  identityMean: number;
  qualityMean: number;
  minCell: number;
} {
  if (!cells.length) return { overall: 0, identityMean: 0, qualityMean: 0, minCell: 0 };
  const scores = cells.map(cellScore);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
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
export function computeWeakCells(cells: ScoreCell[], margin = 0.08): WeakCell[] {
  if (!cells.length) return [];
  const overall = summarizeScore(cells).overall;
  const axes: Array<WeakCell['axis']> = ['action', 'camera', 'expression'];
  const weak: WeakCell[] = [];
  for (const axis of axes) {
    const byValue = new Map<string, number[]>();
    for (const c of cells) {
      const v = c[axis];
      if (!v) continue;
      (byValue.get(v) ?? byValue.set(v, []).get(v)!).push(cellScore(c));
    }
    for (const [value, scores] of byValue) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (mean <= overall - margin) weak.push({ axis, value, mean: round4(mean) });
    }
  }
  return weak.sort((a, b) => a.mean - b.mean);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
