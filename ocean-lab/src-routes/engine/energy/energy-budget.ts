/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the closed-loop energy budget lifted out
 *                     |                             | of the marine slice with its arithmetic untouched. The
 *                     |                             | integration order, the pre-efficiency curtailment term and
 *                     |                             | the binary-search tolerance are all load-bearing: they are
 *                     |                             | what make "perpetual" a simulated verdict rather than a
 *                     |                             | mean-power hand-wave that passes designs which die at the
 *                     |                             | first lull.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Four correctness fixes found by adversarial review. (a) The
 *                     |                             | closure test is now netEnergyWh >= 0, not "final SoC >=
 *                     |                             | initial SoC": on a store the search starts FULL the old
 *                     |                             | clause meant "ends exactly full", which is a property of
 *                     |                             | the harvest schedule and no capacity could ever satisfy —
 *                     |                             | recommendStorageWh reported "no store closes this design"
 *                     |                             | for designs with a 5x surplus and zero brownout. (b) The
 *                     |                             | search no longer forces the trial store full, so the answer
 *                     |                             | is a store that survives the design AS WRITTEN. (c) The run
 *                     |                             | integrates EXACTLY the requested span — a partial final step
 *                     |                             | is now partial, instead of overshooting and inflating every
 *                     |                             | mean by the overshoot. (d) Span, step and store are
 *                     |                             | validated: a zero step was an unbounded loop, a non-positive
 *                     |                             | span certified any design at all, and a zero efficiency or
 *                     |                             | capacity produced a NaN verdict that nothing detected.
 */

import { createChildLogger } from '@/shared/logger';
import type {
  EnergyBudgetDesign,
  EnergyBudgetSample,
  EnergyBudgetVerdict,
  PowerLoad,
  StorageConfig,
} from './energy-types';

const logger = createChildLogger({ module: 'shared:energy-budget' });

/** @description Default run: 30 days, long enough to contain a full multi-day environmental cycle. */
export const DEFAULT_DURATION_HOURS = 720;

/**
 * @description Options for {@link simulateEnergyBudget}.
 */
export interface EnergyBudgetOptions {
  /** Simulated span, hours. Default 720. Too short a span cannot see the environment's worst stretch. */
  durationHours?: number;
  /** Integration step, seconds. Default 60. */
  stepSeconds?: number;
  /** Retain one plot sample per this many minutes. Default 30. */
  sampleEveryMinutes?: number;
}

/**
 * @description Verdict plus the retained timeseries behind it.
 */
export interface EnergyBudgetResult {
  /** The scalar verdict. */
  verdict: EnergyBudgetVerdict;
  /** Downsampled timeseries for plotting the harvest envelope. */
  samples: EnergyBudgetSample[];
}

/**
 * @description Duty-cycle-weighted mean draw of a load set.
 * @param loads - Every electrical load on the unit.
 * @returns Mean total draw, W.
 */
export function totalDrawW(loads: PowerLoad[]): number {
  return loads.reduce((sum, l) => sum + l.watts * l.dutyCycle, 0);
}

/**
 * @description Reject a parameter that is not a finite positive number. Every one of these guards
 * exists because the un-guarded value produced a CONFIDENT WRONG ANSWER rather than a failure: a
 * zero step made `Math.ceil(span/step)` Infinity and hung the integration loop forever, a
 * non-positive span skipped the loop entirely and returned `perpetual: true` for a dead harvester,
 * and a zero capacity or efficiency divided into NaN that propagated all the way to the verdict.
 * @param value - Candidate value.
 * @param field - Dotted field name for the message.
 * @param maximum - Inclusive upper bound; omit for none.
 * @returns Nothing; throws when the value is unusable.
 * @throws If the value is NaN, infinite, non-positive, or above `maximum`.
 */
function requirePositive(value: number, field: string, maximum = Infinity): void {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be a finite number in (0, ${maximum}], got ${value}`);
  }
}

/** @description The loop bounds a validated set of run options resolves to. */
interface ResolvedRun {
  /** Simulated span, hours, exactly as requested. */
  durationHours: number;
  /** Integration step, seconds. */
  stepSeconds: number;
  /** Simulated span, seconds — the value every step is clipped against. */
  spanSeconds: number;
  /** Iterations, rounded UP so the series reaches the end of the span. */
  steps: number;
  /** Retain one plot sample per this many iterations. */
  sampleEvery: number;
}

/**
 * @description Validate the run span and sampling, and derive the loop bounds from them. Callers
 * that reach this from an HTTP surface have already been bounded far more tightly; this is the
 * floor beneath every caller, including the slices' own defaults and any future one.
 * @param options - Caller options, possibly partial.
 * @returns The validated span, step and derived loop bounds.
 * @throws If any value is non-finite or non-positive.
 */
function resolveRun(options: EnergyBudgetOptions): ResolvedRun {
  const durationHours = options.durationHours ?? DEFAULT_DURATION_HOURS;
  const stepSeconds = options.stepSeconds ?? 60;
  const sampleEveryMinutes = options.sampleEveryMinutes ?? 30;
  requirePositive(durationHours, 'options.durationHours');
  // A step LONGER than the span is coarse but well defined — the single step is clipped to the
  // span, so it is one rectangle over the whole run rather than an overshoot. No bound needed.
  requirePositive(stepSeconds, 'options.stepSeconds');
  requirePositive(sampleEveryMinutes, 'options.sampleEveryMinutes');
  const spanSeconds = durationHours * 3600;
  return {
    durationHours,
    stepSeconds,
    spanSeconds,
    steps: Math.ceil(spanSeconds / stepSeconds),
    sampleEvery: Math.max(1, Math.round((sampleEveryMinutes * 60) / stepSeconds)),
  };
}

/**
 * @description Validate the store. The fractions are checked against their real domains rather
 * than merely "is a number": a zero round-trip efficiency is the one value that turns the
 * curtailment term's `stored / roundTripEfficiency` into 0/0, and a zero capacity is the
 * denominator of every SoC fraction in the verdict.
 * @param storage - Store model.
 * @returns Nothing; throws on an unusable store.
 * @throws If capacity, efficiency or depth of discharge is outside (0, 1] (capacity: (0, ∞)), or
 * the initial state of charge is outside [0, 1].
 */
function validateStorage(storage: StorageConfig): void {
  requirePositive(storage.capacityWh, 'storage.capacityWh');
  requirePositive(storage.roundTripEfficiency, 'storage.roundTripEfficiency', 1);
  requirePositive(storage.usableDepthOfDischarge, 'storage.usableDepthOfDischarge', 1);
  const soc = storage.initialSocFraction;
  if (!Number.isFinite(soc) || soc < 0 || soc > 1) {
    throw new Error(`storage.initialSocFraction must be a finite number in [0, 1], got ${soc}`);
  }
}

/** @description Mutable accumulator threaded through the integration loop. */
interface BudgetState {
  socWh: number;
  harvestedWh: number;
  consumedWh: number;
  curtailedWh: number;
  netEnergyWh: number;
  brownoutSeconds: number;
  minSocWh: number;
  minSocAtSeconds: number;
}

/**
 * @description Advance the store by one timestep. Charge pays the round-trip efficiency;
 * discharge does not (standard single-sided model). Energy that cannot be stored — pack full
 * or harvester clamped — is counted as curtailed, which is the signal that the harvester is
 * oversized relative to the store rather than the environment being generous.
 *
 * `netEnergyWh` accumulates the same signed step WITHOUT either clamp, which is what makes it a
 * property of the harvest schedule alone and therefore the only term a bigger battery cannot buy.
 * @param state - Accumulator, mutated in place.
 * @param storage - Store model.
 * @param netWh - Harvest minus draw for this step, Wh (signed).
 * @param floorWh - Absolute store level treated as empty.
 * @param stepSeconds - Step length, seconds.
 * @returns Nothing; `state` is mutated.
 */
function stepStore(state: BudgetState, storage: StorageConfig, netWh: number, floorWh: number, stepSeconds: number): void {
  const { capacityWh, roundTripEfficiency } = storage;
  state.netEnergyWh += netWh >= 0 ? netWh * roundTripEfficiency : netWh;
  if (netWh >= 0) {
    const room = capacityWh - state.socWh;
    const stored = Math.min(netWh * roundTripEfficiency, room);
    state.socWh += stored;
    state.curtailedWh += netWh - stored / roundTripEfficiency;
  } else {
    const deficit = -netWh;
    const available = Math.max(0, state.socWh - floorWh);
    const drawn = Math.min(deficit, available);
    state.socWh -= drawn;
    if (drawn < deficit) state.brownoutSeconds += stepSeconds;
  }
}

/**
 * @description Simulate a persistent node's energy over a full environmental cycle and return
 * whether the design actually closes. This is the honest form of "it runs forever": the run must
 * never brown out AND must end in net energy surplus once charging losses are paid, so a design
 * that merely drains slowly is correctly rejected.
 *
 * The span is integrated EXACTLY: when the step does not divide the span, the final step is
 * shortened rather than overshooting it. Overshooting inflated every total and every mean by the
 * overshoot ratio — a 1 h run at a 3500 s step reported 94% more harvest than it collected.
 * @param design - Label, harvest sampler, loads and store.
 * @param options - Span, step and sampling.
 * @returns Verdict plus the retained timeseries.
 * @throws If the span, step, sampling or store is outside its usable domain.
 */
export function simulateEnergyBudget(design: EnergyBudgetDesign, options: EnergyBudgetOptions = {}): EnergyBudgetResult {
  const { durationHours, stepSeconds, spanSeconds, steps, sampleEvery } = resolveRun(options);
  validateStorage(design.storage);

  const { capacityWh, initialSocFraction, usableDepthOfDischarge } = design.storage;
  const floorWh = capacityWh * (1 - usableDepthOfDischarge);
  const startSocWh = capacityWh * initialSocFraction;
  const drawW = totalDrawW(design.loads);

  const state: BudgetState = {
    socWh: startSocWh,
    harvestedWh: 0,
    consumedWh: 0,
    curtailedWh: 0,
    netEnergyWh: 0,
    brownoutSeconds: 0,
    minSocWh: startSocWh,
    minSocAtSeconds: 0,
  };
  const samples: EnergyBudgetSample[] = [];

  for (let i = 0; i < steps; i += 1) {
    const t = i * stepSeconds;
    const dtSeconds = Math.min(stepSeconds, spanSeconds - t);
    const dtHours = dtSeconds / 3600;
    const harvestW = design.harvestAt(t);
    state.harvestedWh += harvestW * dtHours;
    state.consumedWh += drawW * dtHours;
    stepStore(state, design.storage, (harvestW - drawW) * dtHours, floorWh, dtSeconds);
    if (state.socWh < state.minSocWh) {
      state.minSocWh = state.socWh;
      state.minSocAtSeconds = t;
    }
    if (i % sampleEvery === 0) {
      samples.push({ tHours: t / 3600, harvestW, drawW, socWh: state.socWh, socFraction: state.socWh / capacityWh });
    }
  }

  const verdict = buildVerdict(design.label, capacityWh, state, durationHours);
  logger.info(
    { label: verdict.label, perpetual: verdict.perpetual, marginRatio: verdict.marginRatio, minSocFraction: verdict.minSocFraction },
    'energy budget simulated',
  );
  return { verdict, samples };
}

/**
 * @description Collapse the accumulator into the scalar verdict.
 * @param label - Design label.
 * @param capacityWh - Store nameplate, the denominator for every SoC fraction.
 * @param state - Accumulator after the run.
 * @param durationHours - Simulated span, which the loop integrated exactly.
 * @returns The verdict.
 */
function buildVerdict(
  label: string,
  capacityWh: number,
  state: BudgetState,
  durationHours: number,
): EnergyBudgetVerdict {
  return {
    perpetual: state.brownoutSeconds === 0 && state.netEnergyWh >= 0,
    label,
    durationHours,
    minSocFraction: state.minSocWh / capacityWh,
    minSocAtHours: state.minSocAtSeconds / 3600,
    brownoutHours: state.brownoutSeconds / 3600,
    harvestedWh: state.harvestedWh,
    consumedWh: state.consumedWh,
    curtailedWh: state.curtailedWh,
    netEnergyWh: state.netEnergyWh,
    marginRatio: state.consumedWh > 0 ? state.harvestedWh / state.consumedWh : Infinity,
    meanHarvestW: state.harvestedWh / durationHours,
    meanDrawW: state.consumedWh / durationHours,
  };
}

/**
 * @description Smallest store, in Wh, that makes a design perpetual — the answer to "how big does
 * the battery have to be". Binary search over capacity, each trial run with the design's OWN
 * starting state of charge: a node that wakes at 20% has to survive its first gap on 20%, and a
 * search that quietly started every trial full returned a capacity that browned out for 190 h on
 * the design as posted.
 *
 * The predicate is monotone in capacity because the only capacity-sensitive clause is "never
 * browned out" — the surplus clause (`netEnergyWh`) is deliberately capacity-independent, so
 * `null` here means exactly one thing that more battery cannot fix: after charging losses the
 * harvest does not cover the load over this span.
 * @param design - Unit design; its `storage.capacityWh` is overridden per trial. `harvestAt` is a
 * pure function of time, so it rides through the per-trial spread unchanged.
 * @param options - Passed through to the simulation. Use ≥ 720 h.
 * @param maxCapacityWh - Upper bound for the search, Wh. Default 100 kWh.
 * @returns Minimum viable capacity in Wh, or null when the design cannot close within the bound.
 * @throws If the search bound, the span/step or the store is outside its usable domain.
 */
export function recommendStorageWh(
  design: EnergyBudgetDesign,
  options: EnergyBudgetOptions = {},
  maxCapacityWh = 100_000,
): number | null {
  requirePositive(maxCapacityWh, 'maxCapacityWh');
  const at = (capacityWh: number): EnergyBudgetVerdict =>
    simulateEnergyBudget({ ...design, storage: { ...design.storage, capacityWh } }, options).verdict;

  const ceiling = at(maxCapacityWh);
  if (!ceiling.perpetual) {
    logger.warn(
      {
        label: design.label,
        maxCapacityWh,
        netEnergyWh: ceiling.netEnergyWh,
        brownoutHours: ceiling.brownoutHours,
        reason:
          ceiling.netEnergyWh < 0
            ? 'harvest is short of load once charging losses are paid — storage cannot fix it'
            : 'still browns out at the search bound — raise maxCapacityWh or the starting charge',
      },
      'no store size closes this design',
    );
    return null;
  }
  let lo = 0;
  let hi = maxCapacityWh;
  for (let i = 0; i < 40 && hi - lo > 0.5; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid).perpetual) hi = mid;
    else lo = mid;
  }
  logger.info({ label: design.label, recommendedWh: hi }, 'minimum viable store computed');
  return hi;
}
