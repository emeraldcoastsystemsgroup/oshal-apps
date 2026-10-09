/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D2 in ocean-lab: the stage is computed on every read
 *                     |                             | and never stored. The five stages, their order, the vector
 *                     |                             | fingerprint (sha256 of the canonical, key-sorted JSON) and the
 *                     |                             | sentence every surface renders beside a stage are the SAME as
 *                     |                             | aero-lab's (aero-lab/src-routes/floater-record.ts), shared as a
 *                     |                             | contract and pinned by scripts/check-adr160-contract.mjs rather
 *                     |                             | than imported (D3). `sized` needs a run of this lab's own
 *                     |                             | evaluation plant at the CURRENT vector carrying every figure the
 *                     |                             | kind requires, so a changed vector drops the record back to
 *                     |                             | `concept`; `parts-complete` is blocked until S3's parts model
 *                     |                             | and displacement budget exist.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3: `parts-complete` is now computed. stageOf takes the
 *                     |                             | kind's parts gate (the explorer's: its parts model derived from
 *                     |                             | the CURRENT vector and the displacement budget against the run
 *                     |                             | the stage is sized by) and advances only when the model has no
 *                     |                             | completeness problem AND the budget is green; otherwise it stays
 *                     |                             | `sized` and names every blocker. `fabricable` stays blocked:
 *                     |                             | no part's OCCT export is recorded against the vector. With no
 *                     |                             | gate the old blocker stands, so a kind without parts never
 *                     |                             | advances by omission.
 */

import { createHash } from 'node:crypto';
import type { LimitRow, VehicleKind } from './explorer-kind';

/** The sentence every surface that renders a stage renders with it (ADR-160 D6). */
export const FABRICABLE_SENTENCE = 'fabricable means the files are complete and self-consistent. It does not mean the machine is safe to build, fly or wet.';

/** ADR-160 D2: five stages, each defined by what the record can currently produce. */
export type Stage = 'concept' | 'sized' | 'parts-complete' | 'fabricable' | 'built';

/** The stages in order, so a surface can draw the ladder. */
export const STAGES: readonly Stage[] = ['concept', 'sized', 'parts-complete', 'fabricable', 'built'];

/** The plant this lab's own evaluations are recorded under; only its runs can size the record. */
export const EVALUATION_PLANT = 'ocean-lab.wave-propulsion';

/** @description sha256 over the canonical (key-sorted) JSON of a design vector: the identity an evaluation is pinned to.
 * @param vector - Any JSON value. @returns Hex sha256. */
export function designVectorFingerprint(vector: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(vector)), 'utf8').digest('hex');
}

/** @description What a stored run looks like to the stage function. */
export interface RunLike {
  sequence: number;
  mediumId: string;
  plant: string;
  vectorFingerprint: string;
  result: Record<string, unknown>;
}

/** @description The stage, computed on read, with what blocks the next one and the sentence D6 requires. */
export interface StageView {
  stage: Stage;
  reached: Stage[];
  next: Stage | null;
  blockedBy: string[];
  because: string;
  currentVectorFingerprint: string;
  /** The run the stage rests on, by sequence, or null at `concept`. */
  sizedBy: number | null;
  openLimits: LimitRow[];
  fabricable: string;
}

/** @description What a kind's parts gate answers for the stage: every completeness problem, and the budget's verdict and why. */
export interface PartsGateResult { problems: string[]; budget: { status: string; why: string } }

/** @description A kind's parts gate: the parts model at the current vector judged against the run the stage is sized by. */
export type PartsGate = (designVector: unknown, sizedBy: RunLike) => PartsGateResult;

/** What blocks `fabricable` once the parts are complete: the OCCT exports S3 does not record. */
const FABRICABLE_BLOCKER = 'no part has produced its STEP and STL through the OCCT kernel at the current vector with its validator passed, and no build sheet is generated (ADR-160 D6 items 3-4)';

/** Does a run carry every figure the kind requires, as finite numbers? */
function carriesRequiredFigures(kind: VehicleKind, run: RunLike): boolean {
  const figures = (run.result.figures ?? {}) as Record<string, unknown>;
  return kind.requiredFigures.every((f) => typeof figures[f] === 'number' && Number.isFinite(figures[f] as number));
}

/**
 * @description The stage function (D2): nobody sets it, it is what the record can currently produce,
 * and a changed vector drops it back.
 * @param kind - The kind. @param designVector - The record's current vector. @param runs - Every run stored against the record.
 * @param openLimits - The record's open limit rows (defaults to every limit the kind declares: a limit is open until retired).
 * @param partsGate - The kind's parts gate; without one nothing is ever parts-complete.
 * @returns The stage and why.
 */
export function stageOf(kind: VehicleKind, designVector: unknown, runs: readonly RunLike[], openLimits: readonly LimitRow[] = kind.limits, partsGate?: PartsGate): StageView {
  const current = designVectorFingerprint(designVector);
  const base = { currentVectorFingerprint: current, openLimits: [...openLimits], fabricable: FABRICABLE_SENTENCE };
  const sized = runs
    .filter((r) => r.plant === EVALUATION_PLANT && r.vectorFingerprint === current && carriesRequiredFigures(kind, r))
    .sort((a, b) => b.sequence - a.sequence)[0];
  if (!sized) {
    const stale = runs.some((r) => r.plant === EVALUATION_PLANT) ? ' Evaluations exist at other vectors; the vector changed and they no longer count.' : '';
    return { ...base, stage: 'concept', reached: ['concept'], next: 'sized', sizedBy: null, blockedBy: ['no evaluation at the current design vector carries every figure the kind requires'], because: `a named design vector exists and nothing has been evaluated at it.${stale}` };
  }
  const because = `run ${sized.sequence} computed every figure the kind requires at the current vector (${kind.requiredFigures.join(', ')}) in ${sized.mediumId}.`;
  const gate = partsGate ? partsGate(designVector, sized) : null;
  const blockedBy = gate
    ? [...gate.problems.map((p) => `the parts model is incomplete: ${p}`), ...(gate.budget.status === 'green' ? [] : [`the displacement budget is ${gate.budget.status.toUpperCase()}: ${gate.budget.why}`])]
    : ['no parts model is recorded against this vector (every part printed with material, print notes, mass and a CAD program, or bought with mass, price and a source line), and no displacement budget closes against the sizing at that mass'];
  if (blockedBy.length) return { ...base, stage: 'sized', reached: ['concept', 'sized'], next: 'parts-complete', sizedBy: sized.sequence, blockedBy, because };
  return {
    ...base, stage: 'parts-complete', reached: ['concept', 'sized', 'parts-complete'], next: 'fabricable', sizedBy: sized.sequence, blockedBy: [FABRICABLE_BLOCKER],
    because: `${because} Every part is printed with a program or bought with a mass, price and source, and the displacement budget closes: ${(gate as PartsGateResult).budget.why}.`,
  };
}
