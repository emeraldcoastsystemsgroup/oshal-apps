/**
 * Venture engine — demand scenarios and price response.
 *
 * WHY THE DEFAULT IS A FLAT CURVE AND NOT AN INVENTED ELASTICITY. If nobody has
 * measured how this product's volume responds to price, the honest model holds
 * volume flat and SAYS SO (`no-elasticity-assumption`). Fabricating an elasticity
 * makes every price inversion downstream look like a measured result. A flat
 * curve is wrong in a way the reader can see; an invented curve is wrong in a way
 * they cannot.
 *
 * WHERE AN ELASTICITY IS SUPPLIED it is constant-elasticity, Q = Q0 x (P/P0)^e,
 * with e <= 0 enforced (a positive elasticity means volume rises with price,
 * which is a data-entry error far more often than a Veblen good) and an explicit
 * support band outside which the curve is flagged rather than trusted —
 * extrapolating a demand curve to half or triple the reference price is not
 * evidence, it is arithmetic wearing evidence's clothes.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — conservative/base/optimistic scenarios, constant-elasticity price response with the flat-curve default, positive-elasticity rejection, and the support-band flag.
 *
 * @module venture-demand
 */

import { issue, type VentureIssue } from './venture-issues';
import { roundHalfUp, type Micros, type Ratio } from './venture-primitives';

/** The three scenarios every plan carries. */
export type ScenarioKey = 'conservative' | 'base' | 'optimistic';

/** Scenario keys in presentation order. */
export const SCENARIO_KEYS: readonly ScenarioKey[] = ['conservative', 'base', 'optimistic'] as const;

/** One scenario's baseline volume at the reference price. */
export interface DemandScenario {
  key: ScenarioKey;
  baselineUnits: number;
  assumptionRef: string;
}

/** A measured or estimated price response. */
export interface ElasticityAssumption {
  referencePriceMicros: Micros;
  /** Must be <= 0. A positive elasticity is rejected outright. */
  elasticity: number;
  /** Multiples of the reference price over which the curve is considered usable. */
  supportRatio: { low: Ratio; high: Ratio };
  assumptionRef: string;
}

/** Volume at each scenario, and which one the model is being run at. */
export interface DemandResult {
  byScenario: Record<ScenarioKey, { units: number; priceMicros: Micros; issues: VentureIssue[] }>;
  selected: ScenarioKey;
  units: number;
  priceMicros: Micros;
  assumptionRefs: string[];
  issues: VentureIssue[];
}

/**
 * @description Volume at a price under a constant-elasticity curve. With NO
 *   elasticity assumption the volume is held FLAT and the absence is surfaced —
 *   the engine never invents a demand curve.
 * @param baselineUnits - Volume at the reference price.
 * @param priceMicros - The price being modelled.
 * @param e - The elasticity assumption, or null for a flat curve.
 * @returns The volume and any issues (missing curve, out-of-support price, bad elasticity).
 */
export function unitsAtPrice(
  baselineUnits: number, priceMicros: Micros, e: ElasticityAssumption | null,
): { units: number; issues: VentureIssue[] } {
  const base = Number.isFinite(baselineUnits) ? Math.max(0, Math.trunc(baselineUnits)) : 0;
  if (!e) {
    return {
      units: base,
      issues: [issue('no-elasticity-assumption', 'warn', 'demand',
        'No price-response assumption is registered, so volume is held flat across every price. Every price inversion in this model therefore assumes demand does not move, which is a modelling choice, not a measurement.',
        { baselineUnits: base })],
    };
  }
  if (!(e.elasticity <= 0) || !Number.isFinite(e.elasticity)) {
    return {
      units: base,
      issues: [issue('invalid-elasticity', 'block', 'demand',
        `Elasticity is ${e.elasticity}; a positive or non-finite elasticity means volume rises with price, which is a data-entry error far more often than a real effect. Volume is held flat and the model is not publishable until it is corrected.`,
        { elasticity: e.elasticity })],
    };
  }
  if (!(e.referencePriceMicros > 0) || !(priceMicros > 0)) {
    return {
      units: base,
      issues: [issue('invalid-elasticity', 'warn', 'demand',
        'A price of zero has no place on a constant-elasticity curve, so volume is held flat.', { priceMicros })],
    };
  }
  const ratio = priceMicros / e.referencePriceMicros;
  const issues: VentureIssue[] = [];
  if (ratio < e.supportRatio.low || ratio > e.supportRatio.high) {
    issues.push(issue('price-outside-elasticity-support', 'warn', 'demand',
      `The modelled price is ${ratio.toFixed(2)}x the reference price, outside the ${e.supportRatio.low}x-${e.supportRatio.high}x band the elasticity was estimated over; the volume it implies is an extrapolation.`,
      { ratio: roundHalfUp(ratio * 100) / 100, supportLow: e.supportRatio.low, supportHigh: e.supportRatio.high }));
  }
  return { units: Math.max(0, roundHalfUp(base * Math.pow(ratio, e.elasticity))), issues };
}

/**
 * @description Volume for every scenario at a modelled price, and the selected
 *   scenario's volume.
 * @param input - Scenarios, the selected key, the price and the elasticity.
 * @returns Volume per scenario, the selected volume, references and issues.
 */
export function computeDemand(input: {
  scenarios: readonly DemandScenario[];
  selected: ScenarioKey;
  priceMicros: Micros;
  elasticity: ElasticityAssumption | null;
}): DemandResult {
  const byScenario = {} as DemandResult['byScenario'];
  const refs = new Set<string>();
  for (const key of SCENARIO_KEYS) {
    const s = input.scenarios.find((x) => x.key === key);
    const baseline = s ? s.baselineUnits : 0;
    if (s) refs.add(s.assumptionRef);
    const { units, issues } = unitsAtPrice(baseline, input.priceMicros, input.elasticity);
    byScenario[key] = { units, priceMicros: input.priceMicros, issues };
  }
  if (input.elasticity) refs.add(input.elasticity.assumptionRef);
  const selected = SCENARIO_KEYS.includes(input.selected) ? input.selected : 'base';
  const chosen = byScenario[selected];
  const issues = [...chosen.issues];
  if (chosen.units === 0) {
    issues.push(issue('zero-volume', 'warn', 'demand',
      `The ${selected} scenario carries zero units, so every per-unit figure in this model is undefined.`, { scenario: selected }));
  }
  return {
    byScenario, selected, units: chosen.units, priceMicros: input.priceMicros,
    assumptionRefs: [...refs].filter(Boolean).sort(), issues,
  };
}
