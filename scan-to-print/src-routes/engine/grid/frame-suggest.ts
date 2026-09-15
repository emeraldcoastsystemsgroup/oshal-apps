/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B12) — square-on frame suggestion for
 *                     |                             | the video lane. Frames arrive in sequence order with their
 *                     |                             | silhouette statistics; each frame is scored per candidate view
 *                     |                             | from two terms, both computed from the silhouette alone. SKEW:
 *                     |                             | the view's two axis scale estimates (known size over pixel
 *                     |                             | extent, per image axis) agree only when the outline has the
 *                     |                             | view's proportions. TURN: a square-on frame is where the
 *                     |                             | silhouette stops shrinking and starts growing (a cusp on a steady
 *                     |                             | spin, a plateau when the person pauses), measured on its area
 *                     |                             | against its neighbours. A first-difference STABILITY term was
 *                     |                             | measured and rejected: on a steady spin a 60 x 40 box also shows
 *                     |                             | the front's exact proportions at 67.4 degrees, and that frame
 *                     |                             | changes more slowly than the square-on one (0.033 against 0.050
 *                     |                             | per step), so stability proposes it; the turning point rejects it
 *                     |                             | by sign. Only a frame at a turning point (with a neighbour on
 *                     |                             | both sides: a clip's edge cannot confirm a turn) AND inside the
 *                     |                             | registration's 10 % disagreement threshold is ever proposed, so
 *                     |                             | a view the video never showed gets no proposal. The engine only
 *                     |                             | PROPOSES; the person confirms each view.
 */

import type { PixelBox } from '../raster/raster-types';
import { type KnownDimension, SCALE_DISAGREEMENT } from './silhouette-carver';
import { type Axis, type ViewName, VIEW_FRAMES, isViewName } from './views';

/** @description One video frame's silhouette statistics, as stored at ingest. */
export interface FrameSample {
  /** Caller's identifier (the image id). */
  id: string;
  /** Silhouette pixel count. */
  pixels: number;
  /** Silhouette bounds; null when the frame has no object. */
  bbox: PixelBox | null;
  /** Which clip the frame came from; neighbours never cross from one clip into another. Default 0. */
  sequence?: number;
}

/** @description Options for {@link suggestSquareOnFrames}. */
export interface SuggestOptions {
  /** Frame ids that still count as neighbours but are never proposed (already assigned by the person). */
  exclude?: Iterable<string>;
}

/** @description One frame's score for one view. Lower is better. */
export interface FrameCandidate {
  /** Position in the sequence. */
  index: number;
  /** The frame's id. */
  id: string;
  /** `skew - turn`; lower is a better square-on frame for this view. */
  score: number;
  /** |ln(scale_u / scale_v)| for this view, or null when either of its two extents is not known. */
  skew: number | null;
  /** How far the silhouette area sits below its smaller neighbour, as a fraction of its own area. */
  turn: number;
  /**
   * At a turning point (turn >= 0) with a neighbour on both sides and, when the view's proportions
   * are known, within the registration's own disagreement threshold. Only such a frame is proposed.
   */
  squareOn: boolean;
}

/** @description The proposal for one view: the best free frame and every frame ranked. */
export interface ViewSuggestion {
  /** The view. */
  view: ViewName;
  /** The best square-on frame not already proposed for an earlier view; null when the sequence shows none. */
  best: FrameCandidate | null;
  /** Every scorable frame for this view, best first (ties by sequence position). */
  ranked: FrameCandidate[];
}

/** @description Reject frames, views or dimensions the scorer cannot read. */
function requireInputs(frames: FrameSample[], views: ViewName[], known: KnownDimension[]): void {
  if (!Array.isArray(frames) || frames.length === 0) throw new RangeError('At least one frame is required');
  for (const f of frames) {
    if (!Number.isInteger(f?.pixels) || f.pixels < 0) throw new RangeError('Each frame needs a non-negative integer pixel count');
    if (f.sequence !== undefined && !Number.isInteger(f.sequence)) throw new RangeError('A frame sequence must be an integer clip number');
    const b = f.bbox;
    if (b !== null && !(Number.isInteger(b?.minX) && Number.isInteger(b.minY) && b.maxX >= b.minX && b.maxY >= b.minY)) throw new RangeError('Each frame bbox must be null or integer bounds with max >= min');
  }
  if (!Array.isArray(views) || views.length === 0) throw new RangeError('At least one candidate view is required');
  if (new Set(views).size !== views.length || !views.every(isViewName)) throw new RangeError('Candidate views must be distinct canonical view names');
  const axes = new Set<Axis>();
  for (const d of known) {
    if (!(['x', 'y', 'z'] as unknown[]).includes(d?.axis) || axes.has(d.axis) || !(d.mm > 0) || !Number.isFinite(d.mm)) throw new RangeError('Known dimensions must be distinct axes with positive millimetres');
    axes.add(d.axis);
  }
}

/**
 * @description Nearest frame on one side, in the same clip, that shows the object; a frame where the
 * object left the view is no neighbour, and a clip boundary is an edge.
 */
function neighbour(frames: FrameSample[], from: number, step: -1 | 1): FrameSample | undefined {
  const clip = frames[from].sequence ?? 0;
  for (let i = from + step; i >= 0 && i < frames.length; i += step) {
    if ((frames[i].sequence ?? 0) !== clip) return undefined;
    if (frames[i].pixels > 0) return frames[i];
  }
  return undefined;
}

/**
 * @description Turning score per frame: positive where the area is a local minimum, 0 on a plateau.
 * `interior` is false for a frame without an object-bearing neighbour on BOTH sides: at the edge of
 * the clip a shrinking silhouette cannot be told from one still turning, so it is never confirmed.
 */
function turnScores(frames: FrameSample[]): Array<{ turn: number; interior: boolean }> {
  return frames.map((f, i) => {
    if (f.pixels === 0) return { turn: -Infinity, interior: false };
    const around = [neighbour(frames, i, -1), neighbour(frames, i, 1)].filter((n): n is FrameSample => n !== undefined).map((n) => n.pixels);
    if (around.length === 0) return { turn: 0, interior: false };
    return { turn: (Math.min(...around) - f.pixels) / f.pixels, interior: around.length === 2 };
  });
}

/** @description Skew between a view's two axis scale estimates, or null when an extent is unknown. */
function skewFor(view: ViewName, box: PixelBox, sizes: Partial<Record<Axis, number>>): number | null {
  const { u, v } = VIEW_FRAMES[view];
  const su = sizes[u.axis];
  const sv = sizes[v.axis];
  if (su === undefined || sv === undefined) return null;
  const uPx = box.maxX - box.minX + 1;
  const vPx = box.maxY - box.minY + 1;
  return Math.abs(Math.log(su / uPx) - Math.log(sv / vPx));
}

/**
 * @description Rank every frame for every candidate view and propose one DISTINCT square-on frame
 * per view, in the order the views are given (so list the views that matter most first). A view the
 * sequence never shows gets no proposal rather than the least bad frame. A view whose two extents
 * are not both known is ranked on the turning point alone and says so with `skew: null`. Frames
 * with no silhouette are never proposed and are skipped when finding a frame's neighbours.
 * @param frames - Frames in sequence order.
 * @param views - Candidate views, highest priority first.
 * @param known - The job's measured extents.
 * @param options - Frames to leave out of the proposals; see {@link SuggestOptions}.
 * @returns One suggestion per view, in the order given.
 * @throws RangeError on empty or malformed frames, views or dimensions.
 */
export function suggestSquareOnFrames(frames: FrameSample[], views: ViewName[], known: KnownDimension[], options: SuggestOptions = {}): ViewSuggestion[] {
  requireInputs(frames, views, known);
  const excluded = new Set(options.exclude ?? []);
  const sizes: Partial<Record<Axis, number>> = Object.fromEntries(known.map((d) => [d.axis, d.mm]));
  const turn = turnScores(frames);
  const maxSkew = -Math.log(1 - SCALE_DISAGREEMENT);
  const taken = new Set<number>();
  return views.map((view) => {
    const ranked: FrameCandidate[] = [];
    frames.forEach((f, index) => {
      if (f.bbox === null || f.pixels === 0) return;
      const skew = skewFor(view, f.bbox, sizes);
      const { turn: t, interior } = turn[index];
      const squareOn = interior && t >= 0 && (skew === null || skew <= maxSkew);
      ranked.push({ index, id: f.id, skew, turn: t, squareOn, score: (skew ?? 0) - t });
    });
    ranked.sort((a, b) => a.score - b.score || a.index - b.index);
    const best = ranked.find((c) => c.squareOn && !taken.has(c.index) && !excluded.has(c.id)) ?? null;
    if (best) taken.add(best.index);
    return { view, best, ranked };
  });
}
