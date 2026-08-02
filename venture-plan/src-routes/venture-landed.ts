/**
 * Venture engine — landed cost, ex-works to warehouse-in.
 *
 * WHY FREIGHT IS A STEP FUNCTION AND NOT A PER-UNIT RATE. Ocean freight is sold
 * by the container. Buying one unit more than a container holds buys a second
 * container, and per-unit freight jumps. Every textbook break-even formula that
 * assumes constant contribution is wrong for exactly this reason, which is why
 * the break-even engine downstream searches over rebuilt models instead of
 * dividing fixed cost by a contribution it assumes is flat.
 *
 * WHY INCOTERM IS A RESPONSIBILITY MATRIX, NOT A LABEL. Under CIF the seller pays
 * ocean freight — but it is not free, it is inside the unit price. So a
 * seller-paid leg is EXCLUDED from buyer landed cost and reported in
 * `sellerPaidLegs`, and the customs value never re-adds a leg the invoice already
 * contains. Adding a seller-paid leg on top is the most common way a landed-cost
 * spreadsheet double-counts.
 *
 * WHAT THE ENGINE CANNOT KNOW. HS classification is a customs-broker judgement,
 * not a lookup, and it moves duty by whole percentage points on the largest cost
 * line in the model. This module computes whatever rate it is handed and reports
 * the effective rate it produced; it never asserts that a classification is
 * correct. The honest workflow is: carry the rate as an estimated assumption,
 * sweep it, and get a binding ruling before a purchase order.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the incoterm responsibility matrix, FCL/LCL mode selection with the minimum chargeable volume, customs value on an FOB or CIF basis, HS duty plus additional tariff, MPF with its per-entry floor and ceiling, HMF, marine insurance with a minimum premium, and the ex-works inversion that solves closed-form and falls back to deterministic integer bisection only when a cap boundary actually bound.
 *
 * @module venture-landed
 */

import { issue, type VentureIssue } from './venture-issues';
import {
  addMicros, applyBps, bpsOf, divMicros, roundHalfUp, scaleMicros, subMicros, type Bps, type Micros,
} from './venture-primitives';

/** The incoterms this engine models. */
export type Incoterm = 'EXW' | 'FCA' | 'FOB' | 'CIF' | 'DDP';

/** Every leg of the ex-works-to-warehouse chain. */
export type LandedLegKey =
  | 'exWorks' | 'originInland' | 'exportClearance' | 'oceanFreight' | 'marineInsurance'
  | 'duty' | 'additionalTariff' | 'mpf' | 'hmf' | 'importClearance' | 'drayage' | 'warehouseIn';

/** Ordered for presentation: this is the order a landed-cost table reads in. */
export const LANDED_LEG_ORDER: readonly LandedLegKey[] = [
  'exWorks', 'originInland', 'exportClearance', 'oceanFreight', 'marineInsurance',
  'duty', 'additionalTariff', 'mpf', 'hmf', 'importClearance', 'drayage', 'warehouseIn',
] as const;

/**
 * Which legs the BUYER pays under each incoterm. `exWorks` is always present: it
 * is the invoice price, not a leg. Legs absent from a term's list are inside the
 * seller's price and must never be added on top.
 */
export const INCOTERM_BUYER_PAYS: Record<Incoterm, readonly LandedLegKey[]> = {
  EXW: LANDED_LEG_ORDER,
  FCA: ['exWorks', 'oceanFreight', 'marineInsurance', 'duty', 'additionalTariff', 'mpf', 'hmf', 'importClearance', 'drayage', 'warehouseIn'],
  FOB: ['exWorks', 'oceanFreight', 'marineInsurance', 'duty', 'additionalTariff', 'mpf', 'hmf', 'importClearance', 'drayage', 'warehouseIn'],
  CIF: ['exWorks', 'duty', 'additionalTariff', 'mpf', 'hmf', 'importClearance', 'drayage', 'warehouseIn'],
  DDP: ['exWorks', 'warehouseIn'],
};

/** Which value the duty rate is applied to. */
export type CustomsValueBasis = 'fob' | 'cif';

/** Ocean freight shape: container economics plus the LCL fallback. */
export interface FreightProfile {
  containerType: '20GP' | '40GP' | '40HQ';
  unitsPerContainer: number;
  containerCostMicros: Micros;
  cbmPerUnit: number;
  /** Below this fraction of one container, LCL is used instead of FCL. */
  lclThresholdRatio: number;
  lclCostPerCbmMicros: Micros;
  lclMinimumChargeableCbm: number;
  assumptionRefs: string[];
}

/** Duty and government fee shape for one HS classification. */
export interface DutyProfile {
  htsCode: string;
  htsDutyBps: Bps;
  /** Trade-remedy add-on (e.g. a Section 301 rate) applied to the same value. */
  additionalTariffBps: Bps;
  customsValueBasis: CustomsValueBasis;
  /** Merchandise processing fee: a rate with a per-entry floor and ceiling. */
  mpfBps: Bps;
  mpfMinMicros: Micros;
  mpfMaxMicros: Micros;
  /** Harbour maintenance fee — ocean arrivals only. */
  hmfBps: Bps;
  assumptionRefs: string[];
}

/** Everything the landed stack needs for one shipment. */
export interface LandedInput {
  units: number;
  exWorksUnitMicros: Micros;
  incoterm: Incoterm;
  originInlandPerContainerMicros: Micros;
  exportClearancePerEntryMicros: Micros;
  freight: FreightProfile;
  duty: DutyProfile;
  insuranceBps: Bps;
  insuranceMinimumMicros: Micros;
  importClearancePerEntryMicros: Micros;
  drayagePerContainerMicros: Micros;
  warehouseInPerUnitMicros: Micros;
}

/** One costed leg. `paidBy: 'seller'` legs carry zero buyer cost by construction. */
export interface LandedLeg {
  key: LandedLegKey;
  totalMicros: Micros;
  perUnitMicros: Micros | null;
  paidBy: 'buyer' | 'seller';
  /** Human-readable derivation, e.g. `2 containers x $4,200`. */
  basis: string;
  assumptionRefs: string[];
}

/** The landed-cost result for one shipment. */
export interface LandedCost {
  units: number;
  mode: 'fcl' | 'lcl';
  containers: number;
  containerFillRatio: number;
  legs: LandedLeg[];
  customsValueMicros: Micros;
  buyerTotalMicros: Micros;
  /** The number the whole channel stack sits on. Null at zero volume. */
  buyerUnitMicros: Micros | null;
  sellerPaidLegs: LandedLegKey[];
  /** Every duty-like charge as basis points of customs value. Generated. */
  effectiveDutyBps: Bps | null;
  issues: VentureIssue[];
  assumptionRefs: string[];
}

/**
 * @description Whole containers needed for a unit count. Ocean freight is sold by
 *   the container, so this is a ceiling, not a ratio.
 * @param units - Units to ship.
 * @param f - The freight profile.
 * @returns Whole containers, 0 for zero units.
 */
export function containersFor(units: number, f: FreightProfile): number {
  if (!(units > 0) || !(f.unitsPerContainer > 0)) return 0;
  return Math.ceil(units / f.unitsPerContainer);
}

/** Internal: the freight decision and its cost, before any other leg. */
function computeFreight(
  units: number,
  f: FreightProfile,
): { mode: 'fcl' | 'lcl'; containers: number; fill: number; costMicros: Micros; basis: string; issues: VentureIssue[] } {
  const issues: VentureIssue[] = [];
  if (!(units > 0)) return { mode: 'fcl', containers: 0, fill: 0, costMicros: 0, basis: 'no shipment', issues };
  const threshold = Math.max(0, Math.min(1, f.lclThresholdRatio));
  const perContainer = Math.max(1, f.unitsPerContainer);
  if (units < perContainer * threshold) {
    const rawCbm = units * Math.max(0, f.cbmPerUnit);
    const chargeable = Math.max(rawCbm, Math.max(0, f.lclMinimumChargeableCbm));
    if (chargeable > rawCbm) {
      issues.push(issue('lcl-minimum-chargeable', 'warn', 'landed:freight',
        `The shipment measures ${rawCbm.toFixed(3)} CBM but the carrier bills a ${f.lclMinimumChargeableCbm} CBM minimum, so freight is charged on volume that is not being shipped.`,
        { actualCbm: roundHalfUp(rawCbm * 1000) / 1000, chargeableCbm: chargeable }));
    }
    return {
      mode: 'lcl', containers: 0, fill: units / perContainer,
      costMicros: scaleMicros(f.lclCostPerCbmMicros, chargeable),
      basis: `${chargeable} chargeable CBM (LCL)`, issues,
    };
  }
  const containers = containersFor(units, f);
  const fill = units / (containers * perContainer);
  if (fill < 0.7) {
    issues.push(issue('partial-container', 'warn', 'landed:freight',
      `${containers} container(s) ship ${Math.round(fill * 100)}% full; freight per unit is carrying empty space.`,
      { containers, fillPct: Math.round(fill * 100) }));
  }
  return {
    mode: 'fcl', containers, fill,
    costMicros: scaleMicros(f.containerCostMicros, containers),
    basis: `${containers} x ${f.containerType}`, issues,
  };
}

/** Internal: build one leg record, zeroed when the seller pays it. */
function leg(
  key: LandedLegKey, totalMicros: Micros, units: number, buyerPays: boolean,
  basis: string, assumptionRefs: string[],
): LandedLeg {
  const total = buyerPays ? totalMicros : 0;
  return {
    key, totalMicros: total, perUnitMicros: divMicros(total, units), paidBy: buyerPays ? 'buyer' : 'seller',
    basis: buyerPays ? basis : `${basis} — inside the seller's price under this incoterm`,
    assumptionRefs,
  };
}

/**
 * @description Compute the buyer's landed cost for one shipment: freight mode and
 *   cost, the incoterm responsibility split, the customs value on its declared
 *   basis, duty, trade-remedy tariff, MPF within its caps, HMF, insurance above
 *   its minimum premium, and the fixed per-entry and per-container charges.
 * @param input - The shipment inputs.
 * @returns Every leg, the customs value, the buyer total and per-unit cost, the
 *   seller-paid leg list, the generated effective duty rate, and all issues.
 */
export function computeLandedCost(input: LandedInput): LandedCost {
  const units = Number.isFinite(input.units) ? Math.max(0, Math.trunc(input.units)) : 0;
  const pays = new Set(INCOTERM_BUYER_PAYS[input.incoterm] ?? INCOTERM_BUYER_PAYS.EXW);
  const issues: VentureIssue[] = [];
  const freight = computeFreight(units, input.freight);
  issues.push(...freight.issues);

  const containerCount = freight.mode === 'fcl' ? freight.containers : 1;
  const legs = originLegs(input, units, containerCount, freight, pays);
  const customs = customsValue(input.duty.customsValueBasis, legs, pays);
  if (input.duty.customsValueBasis === 'cif') {
    issues.push(issue('customs-basis-assumed', 'info', 'landed:duty',
      'Duty is assessed on a CIF value here; the United States assesses on FOB, so confirm the declared basis with the broker before relying on the duty figure.',
      { basis: 'cif' }));
  }
  const dutyLegs = governmentCharges(input.duty, customs, units, pays);
  legs.push(...dutyLegs);
  legs.push(leg('importClearance', input.importClearancePerEntryMicros, units, pays.has('importClearance'), '1 import entry', []));
  legs.push(leg('drayage', scaleMicros(input.drayagePerContainerMicros, containerCount), units, pays.has('drayage'), `${containerCount} x drayage`, []));
  legs.push(leg('warehouseIn', scaleMicros(input.warehouseInPerUnitMicros, units), units, pays.has('warehouseIn'), `${units} x receiving`, []));

  const buyerTotalMicros = addMicros(...legs.map((l) => l.totalMicros));
  const sellerPaidLegs = legs.filter((l) => l.paidBy === 'seller').map((l) => l.key);
  for (const key of sellerPaidLegs) {
    issues.push(issue('seller-paid-leg', 'info', 'landed:incoterm',
      `Under ${input.incoterm} the seller pays "${key}", so it is excluded from buyer landed cost — it is inside the unit price, not free.`,
      { incoterm: input.incoterm, legKey: key }));
  }
  if (units === 0) {
    issues.push(issue('zero-volume', 'warn', 'landed', 'Zero units ship, so there is no per-unit landed cost.', { units: 0 }));
  }
  const dutyish = addMicros(...legs.filter((l) => DUTY_LIKE.has(l.key)).map((l) => l.totalMicros));
  return {
    units, mode: freight.mode, containers: freight.containers, containerFillRatio: freight.fill,
    legs, customsValueMicros: customs, buyerTotalMicros, buyerUnitMicros: divMicros(buyerTotalMicros, units),
    sellerPaidLegs,
    effectiveDutyBps: bpsOf(dutyish, customs),
    issues,
    assumptionRefs: [...new Set([...input.freight.assumptionRefs, ...input.duty.assumptionRefs])].sort(),
  };
}

const DUTY_LIKE = new Set<LandedLegKey>(['duty', 'additionalTariff', 'mpf', 'hmf']);

/**
 * @description The legs up to and including marine insurance — everything that
 *   happens before the goods reach customs. Insurance is last because its premium
 *   is a rate on the goods-and-freight value the earlier legs establish, subject
 *   to a minimum premium that binds at low volume.
 * @param input - The shipment inputs.
 * @param units - Units in the shipment.
 * @param containerCount - Containers, or 1 for an LCL consignment.
 * @param freight - The computed freight decision.
 * @param pays - Legs the buyer pays under this incoterm.
 * @returns The origin legs in presentation order.
 */
function originLegs(
  input: LandedInput, units: number, containerCount: number,
  freight: { costMicros: Micros; basis: string }, pays: ReadonlySet<LandedLegKey>,
): LandedLeg[] {
  const legs: LandedLeg[] = [
    leg('exWorks', scaleMicros(input.exWorksUnitMicros, units), units, true, `${units} x unit price`, []),
    leg('originInland', scaleMicros(input.originInlandPerContainerMicros, containerCount), units,
      pays.has('originInland'), `${containerCount} x origin inland`, []),
    leg('exportClearance', input.exportClearancePerEntryMicros, units, pays.has('exportClearance'), '1 export entry', []),
    leg('oceanFreight', freight.costMicros, units, pays.has('oceanFreight'), freight.basis, input.freight.assumptionRefs),
  ];
  const insuredValue = addMicros(...legs.map((l) => l.totalMicros));
  const premium = Math.max(applyBps(insuredValue, Math.max(0, input.insuranceBps)), input.insuranceMinimumMicros);
  legs.push(leg('marineInsurance', premium, units, pays.has('marineInsurance'),
    `${input.insuranceBps} bps of insured value, minimum premium applied`, []));
  return legs;
}

/**
 * @description The declared customs value. FOB is goods plus origin inland and
 *   export clearance; CIF adds freight and insurance. Seller-paid legs are NOT
 *   re-added — they are already inside the invoice price, and adding them is a
 *   double count.
 * @param basis - `fob` or `cif`.
 * @param legs - The legs computed so far (through marine insurance).
 * @param pays - Legs the buyer pays under this incoterm.
 * @returns The customs value in micros.
 */
function customsValue(basis: CustomsValueBasis, legs: readonly LandedLeg[], pays: ReadonlySet<LandedLegKey>): Micros {
  const include: LandedLegKey[] = basis === 'cif'
    ? ['exWorks', 'originInland', 'exportClearance', 'oceanFreight', 'marineInsurance']
    : ['exWorks', 'originInland', 'exportClearance'];
  return addMicros(...legs.filter((l) => include.includes(l.key) && (l.key === 'exWorks' || pays.has(l.key))).map((l) => l.totalMicros));
}

/**
 * @description Duty, trade-remedy tariff, MPF (clamped to its per-entry floor and
 *   ceiling) and HMF, all assessed on the customs value.
 * @param d - The duty profile.
 * @param customs - The customs value in micros.
 * @param units - Units in the shipment, for the per-unit split.
 * @param pays - Legs the buyer pays under this incoterm.
 * @returns The four government-charge legs, in presentation order.
 */
function governmentCharges(d: DutyProfile, customs: Micros, units: number, pays: ReadonlySet<LandedLegKey>): LandedLeg[] {
  const mpfRaw = applyBps(customs, Math.max(0, d.mpfBps));
  const mpf = Math.min(Math.max(mpfRaw, d.mpfMinMicros), d.mpfMaxMicros);
  return [
    leg('duty', applyBps(customs, Math.max(0, d.htsDutyBps)), units, pays.has('duty'),
      `${d.htsDutyBps} bps of customs value (HS ${d.htsCode})`, d.assumptionRefs),
    leg('additionalTariff', applyBps(customs, Math.max(0, d.additionalTariffBps)), units, pays.has('additionalTariff'),
      `${d.additionalTariffBps} bps trade-remedy add-on`, d.assumptionRefs),
    leg('mpf', mpf, units, pays.has('mpf'),
      mpf === d.mpfMinMicros ? 'MPF at the per-entry floor' : mpf === d.mpfMaxMicros ? 'MPF at the per-entry ceiling' : `${d.mpfBps} bps MPF`, []),
    leg('hmf', applyBps(customs, Math.max(0, d.hmfBps)), units, pays.has('hmf'), `${d.hmfBps} bps HMF`, []),
  ];
}

/** How the ex-works inversion arrived at its answer. */
export type InversionMethod = 'closed-form' | 'bisection';

/**
 * @description The highest ex-works unit price that still lands at or below a
 *   target landed unit cost — the target-cost figure that changes a whole plan
 *   ("the factory has to hit $X or this does not work").
 *
 *   Landed cost is affine in the ex-works price (duty is a rate on a customs value
 *   that contains it), so the answer is solved by fitting the exact line through
 *   two forward evaluations. Where an MPF cap boundary is crossed between the
 *   probes the relation is only piecewise affine, so the result is verified by a
 *   forward re-evaluation and falls back to deterministic integer bisection —
 *   never to a guess.
 * @param targetLandedUnitMicros - The landed unit cost that must not be exceeded.
 * @param input - The shipment inputs without the ex-works price.
 * @returns The ex-works unit price, how it was derived, and any issues.
 */
export function maxExWorksForLanded(
  targetLandedUnitMicros: Micros,
  input: Omit<LandedInput, 'exWorksUnitMicros'>,
): { exWorksUnitMicros: Micros; method: InversionMethod; issues: VentureIssue[] } {
  const units = Number.isFinite(input.units) ? Math.max(0, Math.trunc(input.units)) : 0;
  if (units === 0) {
    return {
      exWorksUnitMicros: 0, method: 'closed-form',
      issues: [issue('zero-volume', 'warn', 'landed:inversion', 'Zero units ship, so no ex-works target exists.', { units: 0 })],
    };
  }
  const target = scaleMicros(targetLandedUnitMicros, units);
  const total = (x: Micros): Micros => computeLandedCost({ ...input, exWorksUnitMicros: x }).buyerTotalMicros;
  const t0 = total(0);
  const probe = Math.max(1_000_000, Math.abs(targetLandedUnitMicros) || 1_000_000);
  const t1 = total(probe);
  const slope = (t1 - t0) / probe;
  if (!(slope > 0)) {
    return {
      exWorksUnitMicros: 0, method: 'closed-form',
      issues: [issue('inversion-impossible', 'block', 'landed:inversion',
        'Landed cost does not rise with the ex-works price, so no maximum factory price can be derived from this shipment shape.', {})],
    };
  }
  const linear = Math.floor((target - t0) / slope);
  if (linear < 0) {
    return {
      exWorksUnitMicros: 0, method: 'closed-form',
      issues: [issue('inversion-impossible', 'block', 'landed:inversion',
        'Freight, duty and handling alone already exceed the target landed cost; no factory price, not even zero, reaches it.',
        { targetLandedUnitMicros, fixedLandedMicros: t0 })],
    };
  }
  if (total(linear) <= target && total(linear + 1) > target) {
    return { exWorksUnitMicros: linear, method: 'closed-form', issues: [] };
  }
  return bisectExWorks(target, linear, total);
}

/**
 * @description Deterministic integer bisection for the largest ex-works price
 *   whose landed total stays at or below the target. Used only when the closed
 *   form was invalidated by a fee cap boundary.
 * @param target - Target landed TOTAL in micros.
 * @param seed - The closed-form estimate, used to bracket the search.
 * @param total - Forward landed-total evaluator.
 * @returns The ex-works unit price and the issues raised.
 */
function bisectExWorks(
  target: Micros, seed: number, total: (x: Micros) => Micros,
): { exWorksUnitMicros: Micros; method: InversionMethod; issues: VentureIssue[] } {
  let lo = 0;
  let hi = Math.max(1, seed * 2 + 1_000_000);
  if (total(lo) > target) {
    return {
      exWorksUnitMicros: 0, method: 'bisection',
      issues: [issue('inversion-impossible', 'block', 'landed:inversion',
        'Even a zero factory price lands above the target once freight, duty and handling are paid.', { targetTotalMicros: target })],
    };
  }
  for (let i = 0; i < 64 && total(hi) <= target; i += 1) hi *= 2;
  for (let i = 0; i < 64 && hi - lo > 1; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (total(mid) <= target) lo = mid; else hi = mid;
  }
  return {
    exWorksUnitMicros: lo, method: 'bisection',
    issues: [issue('rounding-residual', 'info', 'landed:inversion',
      'A fee cap boundary made landed cost only piecewise affine in the factory price, so the maximum was found by bisection over the real model rather than by algebra.', {})],
  };
}

/**
 * @description Look up one leg of a computed landed cost.
 * @param landed - A computed landed cost.
 * @param key - The leg to find.
 * @returns The leg, or undefined when the shipment shape omitted it.
 */
export function landedLeg(landed: LandedCost, key: LandedLegKey): LandedLeg | undefined {
  return landed.legs.find((l) => l.key === key);
}

/**
 * @description Per-unit landed cost excluding the goods themselves — the "cost to
 *   get it here" figure a sourcing conversation actually needs.
 * @param landed - A computed landed cost.
 * @returns Micros per unit, or null at zero volume.
 */
export function logisticsUnitMicros(landed: LandedCost): Micros | null {
  const goods = landedLeg(landed, 'exWorks')?.totalMicros ?? 0;
  return divMicros(subMicros(landed.buyerTotalMicros, goods), landed.units);
}
