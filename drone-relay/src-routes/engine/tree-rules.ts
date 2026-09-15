/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The elastic rule on a TREE (backlog B5): one trunk from the
 *                     |                             | base to a fork, two to four branches from the fork to their
 *                     |                             | work points. Every branch hangs off ONE relay at the fork
 *                     |                             | (the junction), so a tip may pass the fork only once the
 *                     |                             | trunk has relays enough to put one there with every trunk
 *                     |                             | hop inside the allowed hop; the relays left over go to the
 *                     |                             | branch whose tip is farthest short of its work point; and
 *                     |                             | however many relays there are, they are spread so the worst
 *                     |                             | hop is as short as it can be. The same function of the
 *                     |                             | structure and of how many relays are connected right now
 *                     |                             | that the line evaluates (ADR-155 D1) — nothing is re-planned
 *                     |                             | when a relay is lost. Pure arithmetic on arc lengths.
 */

/** @description A tree as arc lengths: the fork's distance from the base, and each branch's length beyond it. */
export interface TreeShape {
  forkS: number;
  branchM: number[];
}

/** @description Where the relays and tips go: arc lengths from the base (a branch's along trunk + that branch). */
export interface TreeLayout {
  /** Relay targets on the trunk, inner → outer (the last is AT the fork whenever a tip is beyond it). */
  trunk: number[];
  /** Relay targets per branch, inner → outer, strictly between the fork and the branch's tip. */
  branches: number[][];
  /** Each branch's tip target. */
  tips: number[];
}

const EPS = 1e-9;

/**
 * @description Relays the trunk needs to hold one AT the fork with every trunk hop within `hop`.
 * @param forkS - The fork's arc length.
 * @param hop - The allowed hop.
 * @returns The count (the junction included).
 */
export function trunkNeed(forkS: number, hop: number): number {
  return Math.max(1, Math.ceil(forkS / hop - EPS));
}

/**
 * @description Relays a branch needs between the fork and its work point with every hop within `hop`.
 * @param lengthM - The branch's length beyond the fork.
 * @param hop - The allowed hop.
 * @returns The count (the tip not included).
 */
export function branchNeed(lengthM: number, hop: number): number {
  return Math.max(0, Math.ceil(lengthM / hop - EPS) - 1);
}

/**
 * @description Where each tip may be with `k` relays in the tree, every hop within `hop`. Too few to
 * hold the junction: the tree is a chain up the trunk and every tip waits on it, at most at the fork.
 * Enough: each tip goes out its branch as far as the relays given to it reach, the relays going one
 * at a time to the branch whose tip is farthest short (ties to the lower branch).
 * @param shape - The tree.
 * @param k - Relays counted in the tree.
 * @param hop - The allowed hop (the design hop under retreat, the degraded range under hold-degraded).
 * @returns Each branch's tip target, arc length from the base.
 */
export function treeTipReach(shape: TreeShape, k: number, hop: number): number[] {
  const T = shape.forkS;
  const nT = trunkNeed(T, hop);
  if (k < nT) return shape.branchM.map(() => Math.min(T, (k + 1) * hop));
  const take = shape.branchM.map(() => 0);
  for (let left = k - nT; left > 0; left -= 1) {
    let best = -1;
    let bestShort = 0;
    shape.branchM.forEach((B, i) => {
      const short = B - Math.min(B, (take[i] + 1) * hop);
      if (short > bestShort + EPS) { best = i; bestShort = short; }
    });
    if (best < 0) break;
    take[best] += 1;
  }
  return shape.branchM.map((B, i) => T + Math.min(B, (take[i] + 1) * hop));
}

/**
 * @description Spread `k` relays over the tree with its tips at `tips` so the worst hop is as short as
 * it can be: one AT the fork when any tip is beyond it, the rest handed one at a time to whichever
 * stretch (the trunk, or a branch out to its tip) has the longest hop. With every tip still on the
 * trunk the tree is a chain to the nearest one.
 * @param shape - The tree.
 * @param tips - Each branch's tip target (from {@link treeTipReach}).
 * @param k - Relays to place.
 * @returns The layout; exactly `k` relay targets.
 */
export function treeSpread(shape: TreeShape, tips: number[], k: number): TreeLayout {
  const T = shape.forkS;
  if (k > 0 && !tips.some((t) => t > T + EPS)) return { trunk: evenInside(0, Math.min(...tips), k), branches: tips.map(() => []), tips };
  return treeSpreadTo(shape, tips.map((s) => ({ s, held: false })), k);
}

/** @description One branch's far end for a spread: a tip's target, or a meeting point a relay must hold (`held`). */
export interface BranchEnd {
  s: number;
  held: boolean;
}

/**
 * @description Spread `k` relays over the tree out to each branch's end, the worst hop as short as it
 * can be. The junction AT the fork comes first, then a relay AT every held end (meet-in-the-middle on
 * a cut branch: the meeting point), in branch order while relays last; the rest go one at a time to
 * the stretch with the longest hop. With every end beyond the fork held as a tip this is
 * {@link treeSpread}.
 * @param shape - The tree.
 * @param ends - Each branch's end (arc length from the base along its lane).
 * @param k - Relays to place.
 * @returns The layout (`tips` are the ends); exactly `k` relay targets.
 */
export function treeSpreadTo(shape: TreeShape, ends: BranchEnd[], k: number): TreeLayout {
  const T = shape.forkS;
  const tipsOut = ends.map((e) => e.s);
  if (k <= 0) return { trunk: [], branches: ends.map(() => []), tips: tipsOut };
  let left = k - 1;
  const held = ends.map((e) => { const h = e.held && e.s > T + EPS && left > 0; if (h) left -= 1; return h; });
  const spans = [T, ...ends.map((e) => (e.s > T + EPS ? e.s - T : 0))];
  const take = minimaxTake(spans, left);
  return {
    trunk: [...evenInside(0, T, take[0]), T],
    branches: ends.map((e, i) => (e.s > T + EPS ? [...evenInside(T, e.s, take[i + 1]), ...(held[i] ? [e.s] : [])] : [])),
    tips: tipsOut,
  };
}

/**
 * @description The elastic layout: the tips' reach from the relays IN the tree, and every relay the
 * controller knows spread to it (a spare still on the pad counts toward the spread, not the reach).
 * @param shape - The tree.
 * @param inTree - Relays already in the tree (at least half a hop out).
 * @param known - Relays on the controller's roster.
 * @param hop - The allowed hop.
 * @returns The layout.
 */
export function treeTargets(shape: TreeShape, inTree: number, known: number, hop: number): TreeLayout {
  return treeSpread(shape, treeTipReach(shape, inTree, hop), known);
}

/** `count` relays given one at a time to the span whose hop is longest (ties to the lower index). */
function minimaxTake(spans: number[], count: number): number[] {
  const take = spans.map(() => 0);
  for (let given = 0; given < count; given += 1) {
    let worst = 0;
    for (let i = 1; i < spans.length; i += 1) if (spans[i] / (take[i] + 1) > spans[worst] / (take[worst] + 1) + EPS) worst = i;
    take[worst] += 1;
  }
  return take;
}

/** `n` points evenly strictly between `from` and `to`. */
function evenInside(from: number, to: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) out.push(from + ((to - from) * i) / (n + 1));
  return out;
}
