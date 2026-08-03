/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — proofs for the extracted @/shared/energy
 *                     |                             | core in isolation, on square-wave harvests whose answers are
 *                     |                             | derivable by hand. The marine spec proves the engine against
 *                     |                             | tides; these prove the four semantics the engine PROMISES
 *                     |                             | (efficiency on charge only, pre-efficiency curtailment, the
 *                     |                             | depth-of-discharge floor, and a two-condition perpetual
 *                     |                             | predicate) which no tidal test isolates. Closes with a
 *                     |                             | bit-exact parity pin on the marine numbers, so an ULP-level
 *                     |                             | regression inside stepStore fails here rather than silently.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Guards for the four defects adversarial review found in the
 *                     |                             | core, each written so it goes RED against the old code: the
 *                     |                             | closure test that no capacity could satisfy, the store search
 *                     |                             | that silently started every trial full, the span overshoot
 *                     |                             | that inflated every mean, and the unvalidated span/step/store
 *                     |                             | that hung the loop, certified dead designs and produced NaN.
 *                     |                             | The gap pins moved because the scan now bisects its crossings
 *                     |                             | instead of reporting multiples of the sampling step.
 */

import { describe, expect, it } from 'vitest';
import {
  longestGapHours,
  recommendStorageWh,
  simulateEnergyBudget,
  totalDrawW,
  type EnergyBudgetDesign,
  type HarvestSampler,
  type StorageConfig,
} from '../src-routes/engine/energy';
import {
  MODERATE_INLET_SITE,
  STRONG_CHANNEL_SITE,
  longestSlackHours,
  recommendStorageWh as recommendMarineStorageWh,
  simulatePowerBudget,
  type MarineUnitConfig,
  type TurbineConfig,
} from '../src-routes/engine/marine';

/**
 * @description One-hour integration steps, so every quantity in this file is a whole number of
 * watt-hours and each assertion can be derived on paper rather than read off the implementation.
 */
const HOURLY = { stepSeconds: 3600, sampleEveryMinutes: 60 } as const;

/**
 * @description A store with no depth-of-discharge limit — floor at zero — so tests that are
 * about efficiency or curtailment are not also implicitly about the floor.
 * @param capacityWh - Nameplate.
 * @param initialSocFraction - Starting charge, 0..1.
 * @returns Store config with rte 0.9 and full usable depth.
 */
function store(capacityWh: number, initialSocFraction: number): StorageConfig {
  return { capacityWh, initialSocFraction, roundTripEfficiency: 0.9, usableDepthOfDischarge: 1 };
}

/**
 * @description Assemble a generic design from a harvest sampler and a single constant load.
 * @param harvestAt - Harvest sampler, W.
 * @param loadW - Continuous load, W.
 * @param storage - Store config.
 * @returns A complete harvest-agnostic design.
 */
function design(harvestAt: HarvestSampler, loadW: number, storage: StorageConfig): EnergyBudgetDesign {
  return { label: 'probe', harvestAt, loads: [{ name: 'payload', watts: loadW, dutyCycle: 1 }], storage };
}

/** @description Harvest sampler that is dark at every instant — isolates the discharge path. */
const DARK: HarvestSampler = () => 0;

/**
 * @description Twelve hours on at `onW`, twelve hours dark, repeating. Stands in for any
 * environment with a predictable dark stretch; the dark half is what sizes the store.
 * @param onW - Power during the lit half, W.
 * @returns A day/night harvest sampler.
 */
function dayNight(onW: number): HarvestSampler {
  return (t) => (Math.floor(t / 3600) % 24 < 12 ? onW : 0);
}

describe('round-trip efficiency is paid on charge and only on charge', () => {
  it('stores rte x the surplus, not the whole surplus', () => {
    const { samples } = simulateEnergyBudget(design(() => 10, 0, store(1000, 0.5)), { durationHours: 1, ...HOURLY });
    // 10 Wh arrives at the terminals; 0.9 of it lands in the pack. 510 would mean rte was skipped.
    expect(samples[0].socWh).toBe(509);
  });

  it('draws the deficit straight out, without inflating it by rte', () => {
    const { samples } = simulateEnergyBudget(design(DARK, 10, store(1000, 0.5)), { durationHours: 1, ...HOURLY });
    // 500 - 10. A double-sided model would charge 10/0.9 and land on 488.89.
    expect(samples[0].socWh).toBe(490);
  });

  it('loses exactly (1 - rte) over a charge/discharge round trip', () => {
    const oneHourOn: HarvestSampler = (t) => (t < 3600 ? 20 : 0);
    const { samples } = simulateEnergyBudget(design(oneHourOn, 10, store(1000, 0.5)), { durationHours: 2, ...HOURLY });
    expect(samples[0].socWh).toBe(509); // +10 Wh in, 9 Wh kept
    expect(samples[1].socWh).toBe(499); // -10 Wh out, 10 Wh gone
    // The asymmetry IS the round-trip loss: 10 Wh cycled through the pack costs 1 Wh.
    expect(500 - samples[1].socWh).toBe(1);
  });
});

describe('curtailment counts pre-efficiency energy', () => {
  it('discards the whole surplus when the pack has no room', () => {
    const { verdict } = simulateEnergyBudget(design(() => 10, 0, store(100, 1)), { durationHours: 1, ...HOURLY });
    expect(verdict.harvestedWh).toBe(10);
    expect(verdict.curtailedWh).toBe(10);
  });

  it('charges curtailment at the terminals, not at the pack', () => {
    // Room for 5 Wh of stored energy. Filling it consumed 5/0.9 = 5.556 Wh of harvest, so
    // 4.444 Wh of the 10 Wh harvested was thrown away — NOT 5.0, which is what counting the
    // post-efficiency shortfall (netWh - stored) would report.
    const { verdict } = simulateEnergyBudget(design(() => 10, 0, store(10, 0.5)), { durationHours: 1, ...HOURLY });
    expect(verdict.curtailedWh).toBeCloseTo(10 - 5 / 0.9, 12);
    expect(verdict.curtailedWh).toBeCloseTo(4.444444444444445, 12);
    expect(verdict.curtailedWh).not.toBeCloseTo(5, 6);
  });

  it('curtails nothing while the pack still has room', () => {
    const { verdict } = simulateEnergyBudget(design(() => 10, 0, store(1000, 0.5)), { durationHours: 1, ...HOURLY });
    expect(verdict.curtailedWh).toBe(0);
  });
});

describe('the brownout floor comes from depth of discharge', () => {
  it('stops discharging at capacity x (1 - dod) and counts every starved step', () => {
    const storage: StorageConfig = { capacityWh: 100, initialSocFraction: 1, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 };
    const { verdict } = simulateEnergyBudget(design(DARK, 10, storage), { durationHours: 20, ...HOURLY });
    // Floor is 100 x (1 - 0.8) = 20 Wh, so 80 Wh is usable: 8 h of draw, then 12 h starved.
    // Inverting the floor to capacity x dod would put it at 80, drain in 2 h and brown out for 18.
    expect(verdict.minSocFraction).toBeCloseTo(0.2, 12);
    expect(verdict.minSocAtHours).toBe(8);
    expect(verdict.brownoutHours).toBe(12);
  });

  it('counts a partially met deficit as a full browned-out step', () => {
    const storage: StorageConfig = { capacityWh: 100, initialSocFraction: 0.25, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 };
    // 25 Wh in the pack, 20 Wh of it below the floor: the first hour can only serve 5 of its
    // 10 Wh and is still a brownout hour. Two dark hours -> two brownout hours.
    const { verdict } = simulateEnergyBudget(design(DARK, 10, storage), { durationHours: 2, ...HOURLY });
    expect(verdict.brownoutHours).toBe(2);
    expect(verdict.minSocFraction).toBeCloseTo(0.2, 12);
  });
});

describe('perpetual needs BOTH conditions, and each one alone is not enough', () => {
  it('rejects a run that never browned out but ended down on charge', () => {
    const { verdict, samples } = simulateEnergyBudget(design(DARK, 10, store(100, 1)), { durationHours: 5, ...HOURLY });
    // The honest half of the predicate: this node is not perpetual, it is merely slow.
    expect(verdict.brownoutHours).toBe(0);
    expect(samples[4].socWh).toBe(50);
    expect(verdict.netEnergyWh).toBe(-50);
    expect(verdict.perpetual).toBe(false);
  });

  it('rejects a run that ended full but browned out on the way', () => {
    const lateStart: HarvestSampler = (t) => (t < 2 * 3600 ? 0 : 100);
    const storage: StorageConfig = { capacityWh: 100, initialSocFraction: 0.25, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 };
    const { verdict, samples } = simulateEnergyBudget(design(lateStart, 10, storage), { durationHours: 6, ...HOURLY });
    expect(verdict.brownoutHours).toBe(2);
    expect(samples[5].socWh).toBe(100); // ends full, well above the 25 Wh it started with
    expect(verdict.perpetual).toBe(false);
  });

  it('accepts a run that never starved and closed up on charge', () => {
    const { verdict, samples } = simulateEnergyBudget(design(() => 20, 10, store(100, 0.5)), { durationHours: 10, ...HOURLY });
    expect(verdict.brownoutHours).toBe(0);
    expect(samples[9].socWh).toBe(100);
    expect(verdict.perpetual).toBe(true);
  });

  it('integrates EXACTLY the requested span when the step does not divide it', () => {
    // 1.5 h at 1 h steps is 2 steps, and the SECOND one is half a step long. Integrating both in
    // full would collect 2 Wh over a span the verdict still calls 1.5 h, and every mean built on
    // that total inherits the 33% overshoot. The step count still rounds UP — the sample series
    // must reach the end of the span — but the energy it accumulates is clipped to the span.
    const { verdict, samples } = simulateEnergyBudget(design(() => 1, 0, store(1000, 0)), {
      durationHours: 1.5,
      ...HOURLY,
    });
    expect(samples).toHaveLength(2);
    expect(verdict.harvestedWh).toBe(1.5);
    expect(verdict.durationHours).toBe(1.5);
    expect(verdict.meanHarvestW).toBe(1);
  });

  it('reports the true mean for a constant harvester at ANY step, however coarse', () => {
    // The overshoot grew with the step and was unbounded: a 1 h run at a 3500 s step integrated
    // 1.944 h and reported 19.44 W for a 10 W harvester, and a half-hour run at a 3600 s step
    // reported 20 W. A constant source has one right answer and the step cannot change it.
    const constant = design(() => 10, 1, store(1e6, 0.5));
    for (const [durationHours, stepSeconds] of [[1, 3500], [0.5, 3600], [1, 60], [3, 900]] as const) {
      const { verdict } = simulateEnergyBudget(constant, { durationHours, stepSeconds });
      expect(verdict.meanHarvestW, `${durationHours} h at ${stepSeconds} s`).toBeCloseTo(10, 12);
      expect(verdict.harvestedWh, `${durationHours} h at ${stepSeconds} s`).toBeCloseTo(10 * durationHours, 12);
      expect(verdict.meanDrawW, `${durationHours} h at ${stepSeconds} s`).toBeCloseTo(1, 12);
    }
  });

  it('reports infinite margin rather than NaN when nothing is consumed', () => {
    const { verdict } = simulateEnergyBudget({ label: 'idle', harvestAt: DARK, loads: [], storage: store(100, 1) }, {
      durationHours: 1,
      ...HOURLY,
    });
    // 0 harvested / 0 consumed is the case that turns a bare division into NaN.
    expect(verdict.consumedWh).toBe(0);
    expect(verdict.marginRatio).toBe(Infinity);
  });
});

describe('the closure test is net energy, NOT "ended as full as it started"', () => {
  it('certifies a plainly perpetual design whose window happens to stop while discharging', () => {
    // 12 h on at 30 W, 12 h dark, 10 W of load: a 3x-margin design that closes every single day.
    // Over 252 h the run ends in the LIT half and the pack ends full; over 258 h it ends in the
    // dark half and does not. The design is identical. "Final SoC >= initial SoC" answers those
    // two runs differently, and on a store started full it means "ends EXACTLY full" — a property
    // of the harvest schedule that no capacity can buy, so the old predicate reported "no store
    // size closes this design" for the 258 h window.
    const nightly = design(dayNight(30), 10, store(1, 1));
    for (const durationHours of [252, 258, 264, 271]) {
      const recommended = recommendStorageWh(nightly, { durationHours, ...HOURLY });
      expect(recommended, `${durationHours} h window`).not.toBeNull();
      expect(recommended as number, `${durationHours} h window`).toBeCloseTo(120.16, 1);
    }
  });

  it('sizes a design with a large surplus and zero brownout instead of refusing it', () => {
    // 10 W for 360 h then dark for 360 h against a 1 W load: 5x the energy it spends, never
    // starved at any adequate capacity, and it can only END below full. Reported unbuildable.
    const front: HarvestSampler = (t) => (t < 360 * 3600 ? 10 : 0);
    const probe = design(front, 1, store(1e6, 1));
    const { verdict } = simulateEnergyBudget(probe, { durationHours: 720, stepSeconds: 60 });
    expect(verdict.marginRatio).toBeCloseTo(5, 6);
    expect(verdict.brownoutHours).toBe(0);
    // 360 h of dark at 1 W is 360 Wh out of the pack — that, not "no such store", is the answer.
    expect(recommendStorageWh(probe, { durationHours: 720, stepSeconds: 60 }, 1e6)).toBeCloseTo(360, 0);
  });

  it('is capacity-independent, which is what makes a null recommendation MEAN something', () => {
    const nightly = design(dayNight(30), 10, store(1, 1));
    const netAt = (capacityWh: number) =>
      simulateEnergyBudget({ ...nightly, storage: { ...nightly.storage, capacityWh } }, { durationHours: 258, ...HOURLY })
        .verdict.netEnergyWh;
    // Three capacities spanning six orders of magnitude, one number. Curtailment, brownout and
    // the SoC trace all move; this does not, because it is asked without a ceiling or a floor.
    expect(netAt(1)).toBeCloseTo(netAt(1_000), 9);
    expect(netAt(1)).toBeCloseTo(netAt(1_000_000), 9);
  });

  it('catches the losing design that marginRatio calls a winner', () => {
    // 10.5 Wh harvested in hour 0, then dark; 1 W of load for 10 h. Raw margin is 1.05 — above
    // one, so "harvested / consumed" signs it off — but 9.5 Wh of surplus only puts 8.55 Wh into
    // the pack at 90% charging efficiency, against 9 Wh drawn back out. It loses 0.45 Wh a cycle.
    const spike: HarvestSampler = (t) => (t < 3600 ? 10.5 : 0);
    const losing = design(spike, 1, store(1000, 1));
    const { verdict } = simulateEnergyBudget(losing, { durationHours: 10, ...HOURLY });
    expect(verdict.marginRatio).toBeCloseTo(1.05, 12);
    expect(verdict.netEnergyWh).toBeCloseTo(-0.45, 12);
    expect(verdict.brownoutHours).toBe(0);
    expect(verdict.perpetual).toBe(false);
    expect(recommendStorageWh(losing, { durationHours: 10, ...HOURLY })).toBeNull();
  });

  it('never refuses a design that ran the ceiling capacity clean — over a whole design sweep', () => {
    // The property the old predicate violated on roughly half of all multi-harmonic designs:
    // if the largest store in the search survives with no brownout and no net loss, then SOME
    // store closes the design and the answer cannot be null. Deterministic pseudo-random sweep
    // (a plain LCG) so a failure is reproducible rather than a flake.
    let seed = 20260802;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let sized = 0;
    for (let i = 0; i < 40; i += 1) {
      const [a, b, pa, pb] = [4 + 12 * next(), 2 + 8 * next(), next() * 2 * Math.PI, next() * 2 * Math.PI];
      const multi: HarvestSampler = (t) =>
        Math.max(0, a * Math.sin((2 * Math.PI * t) / 86400 + pa) + b * Math.sin((2 * Math.PI * t) / 43200 + pb));
      const probe = design(multi, 1 + 2 * next(), store(1, 1));
      const opts = { durationHours: 720, stepSeconds: 300 };
      const ceiling = simulateEnergyBudget({ ...probe, storage: { ...probe.storage, capacityWh: 1e5 } }, opts).verdict;
      if (!ceiling.perpetual) continue;
      sized += 1;
      expect(recommendStorageWh(probe, opts), `design ${i}`).not.toBeNull();
    }
    // Guard the guard: if the sweep stopped producing viable designs it would pass vacuously.
    expect(sized).toBeGreaterThan(20);
  });
});

describe('the engine refuses inputs it used to answer wrongly', () => {
  const anyDesign = design(() => 1, 1, store(100, 1));

  it('rejects a zero or negative step instead of looping forever', () => {
    // ceil(span / 0) is Infinity, so `i < steps` never ends: the process hangs, it does not fail.
    expect(() => simulateEnergyBudget(anyDesign, { durationHours: 1, stepSeconds: 0 })).toThrow(/options\.stepSeconds/);
    expect(() => simulateEnergyBudget(anyDesign, { durationHours: 1, stepSeconds: -60 })).toThrow(/options\.stepSeconds/);
    expect(() => simulateEnergyBudget(anyDesign, { durationHours: 1, stepSeconds: Number.NaN })).toThrow(/options\.stepSeconds/);
  });

  it('rejects a non-positive span instead of certifying every design on it', () => {
    // Zero steps means the loop body never runs: no brownout, no charge lost, "perpetual: true"
    // for a 1 kW load on a dead harvester — a certification function answering yes to anything.
    const dead = design(DARK, 1000, store(100, 1));
    expect(() => simulateEnergyBudget(dead, { durationHours: 0 })).toThrow(/options\.durationHours/);
    expect(() => simulateEnergyBudget(dead, { durationHours: -5 })).toThrow(/options\.durationHours/);
    expect(() => recommendStorageWh(dead, { durationHours: 0 })).toThrow(/options\.durationHours/);
    expect(() => simulateEnergyBudget(dead, { durationHours: 1, sampleEveryMinutes: 0 })).toThrow(/sampleEveryMinutes/);
  });

  it('rejects the store values that divide into NaN', () => {
    // rte 0: the curtailment term is `netWh - stored / rte`, and stored is also 0, so 0/0 poisons
    // curtailedWh for the whole run. capacity 0: it is the denominator of every SoC fraction.
    const bad = (storage: StorageConfig) => () => simulateEnergyBudget(design(() => 5, 0.1, storage), { durationHours: 24 });
    expect(bad({ capacityWh: 100, initialSocFraction: 1, roundTripEfficiency: 0, usableDepthOfDischarge: 0.8 })).toThrow(/roundTripEfficiency/);
    expect(bad({ capacityWh: 0, initialSocFraction: 1, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 })).toThrow(/capacityWh/);
    expect(bad({ capacityWh: 100, initialSocFraction: 1, roundTripEfficiency: 1.5, usableDepthOfDischarge: 0.8 })).toThrow(/roundTripEfficiency/);
    expect(bad({ capacityWh: 100, initialSocFraction: 1, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0 })).toThrow(/usableDepthOfDischarge/);
    expect(bad({ capacityWh: 100, initialSocFraction: 1.4, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 })).toThrow(/initialSocFraction/);
    expect(bad({ capacityWh: 100, initialSocFraction: Number.NaN, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 })).toThrow(/initialSocFraction/);
  });

  it('emits no NaN in any verdict field for an accepted design', () => {
    const { verdict } = simulateEnergyBudget(design(dayNight(30), 10, store(200, 1, 0.5)), { durationHours: 48, ...HOURLY });
    for (const [key, value] of Object.entries(verdict)) {
      if (typeof value !== 'number') continue;
      expect(Number.isNaN(value), `verdict.${key} is NaN`).toBe(false);
    }
  });
});

describe('recommendStorageWh finds the true critical capacity', () => {
  const NIGHTLY = design(dayNight(30), 10, store(0.001, 1));

  it('answers for the design AS WRITTEN, not for a store it quietly filled', () => {
    // 200 h of nothing, then 4 W against a 1 W load, from a pack that wakes at 5%. Overriding the
    // trial store to "full" answers a different design: it returned 200 Wh, and 200 Wh browns out
    // for 190 of the first 200 hours. Surviving 200 h at 1 W on 5% of the pack needs 4000 Wh.
    const late: HarvestSampler = (t) => (t < 200 * 3600 ? 0 : 4);
    const coldStart = design(late, 1, store(0.001, 0.05));
    const options = { durationHours: 720, stepSeconds: 60 };
    const recommended = recommendStorageWh(coldStart, options);
    expect(recommended).not.toBeNull();
    expect(recommended as number).toBeGreaterThan(3_900);
    const asWritten = simulateEnergyBudget(
      { ...coldStart, storage: { ...coldStart.storage, capacityWh: recommended as number } },
      options,
    ).verdict;
    expect(asWritten.brownoutHours).toBe(0);
    expect(asWritten.perpetual).toBe(true);
  });

  it('lands on the analytic answer and proves 0.9x of it does not survive', () => {
    // 12 dark hours x 10 W = 120 Wh must come out of the pack. Anything smaller starves.
    const recommended = recommendStorageWh(NIGHTLY, { durationHours: 252, ...HOURLY });
    expect(recommended).not.toBeNull();
    const rec = recommended as number;
    expect(rec).toBeGreaterThanOrEqual(120);
    expect(rec).toBeLessThan(120.5); // the search's 0.5 Wh tolerance, measured against 120

    const at = (capacityWh: number) =>
      simulateEnergyBudget({ ...NIGHTLY, storage: { ...NIGHTLY.storage, capacityWh, initialSocFraction: 1 } }, {
        durationHours: 252,
        ...HOURLY,
      }).verdict.perpetual;
    expect(at(rec)).toBe(true);
    expect(at(rec * 0.9)).toBe(false);
    // And the answer is genuinely critical, not merely sufficient: one Wh under it fails.
    expect(at(rec - 1)).toBe(false);
  });

  it('returns null when the harvest itself is short, at any store size', () => {
    // 12 h x 5 W harvested against 24 h x 10 W drawn — no battery closes a losing budget.
    const starved = design(dayNight(5), 10, store(0.001, 1));
    expect(recommendStorageWh(starved, { durationHours: 252, ...HOURLY })).toBeNull();
  });

  it('rejects a non-positive search bound rather than searching an empty bracket', () => {
    expect(() => recommendStorageWh(NIGHTLY, { durationHours: 24, ...HOURLY }, 0)).toThrow(/maxCapacityWh/);
  });
});

describe('longestGapHours', () => {
  it('measures the longest sub-threshold stretch, in hours', () => {
    expect(longestGapHours(dayNight(30), 1, 48, 3600)).toBeCloseTo(12, 9);
  });

  it('treats a sample exactly at the threshold as harvesting, not as a gap', () => {
    // Strict `<`. Flipping it to `<=` would report the whole span as one gap.
    expect(longestGapHours(() => 5, 5, 10, 3600)).toBe(0);
    expect(longestGapHours(() => 4.999, 5, 10, 3600)).toBe(10);
  });

  it('clips a gap still open at the end to the span, rather than rounding it up a whole step', () => {
    // 2.5 h of dark scanned at 1 h steps is 2.5 h of gap. Rounding the step count up and counting
    // three whole steps reported 3 h — a stretch half an hour longer than the window looked at.
    expect(longestGapHours(DARK, 1, 2.5, 3600)).toBe(2.5);
  });

  it('resolves both ends of a gap by bisection, so the answer is not a multiple of the step', () => {
    // A ramp crossing the threshold at t = 1.25 h and back at t = 3.75 h: a 2.5 h gap that no
    // sample grid contains. Counting samples reports 2 h at a 1 h step and 3 h at 1.5 h steps;
    // bisecting the two crossings reports 2.5 h from either grid.
    const vee: HarvestSampler = (t) => Math.abs(t / 3600 - 2.5) - 1.25;
    expect(longestGapHours(vee, 0, 6, 3600)).toBeCloseTo(2.5, 9);
    expect(longestGapHours(vee, 0, 6, 5400)).toBeCloseTo(2.5, 9);
    expect(longestGapHours(vee, 0, 6, 600)).toBeCloseTo(2.5, 9);
  });

  it('cannot see a gap that opens and closes between two samples — choose the step below it', () => {
    // The one limitation refinement does not remove, pinned so it stays a documented contract
    // rather than a surprise: an 8-minute null sitting off a 600 s grid is never sampled at all.
    const brief: HarvestSampler = (t) => {
      const phase = t % 21_600;
      return phase >= 10_850 && phase < 11_330 ? 0 : 1;
    };
    expect(longestGapHours(brief, 0.5, 240, 600)).toBe(0);
    expect(longestGapHours(brief, 0.5, 240, 60)).toBeCloseTo(480 / 3600, 6);
  });

  it('rejects a zero step instead of hanging on an infinite loop bound', () => {
    expect(() => longestGapHours(DARK, 1, 24, 0)).toThrow(/stepSeconds/);
    expect(() => longestGapHours(DARK, 1, 0, 60)).toThrow(/spanHours/);
  });

  it('is unit-agnostic — the sampler and the threshold only have to agree', () => {
    // The same schedule expressed in m/s rather than W yields the same gap, which is exactly
    // why the marine wrapper is allowed to scan pre-cube speeds.
    const speeds: HarvestSampler = (t) => (Math.floor(t / 3600) % 24 < 12 ? 1.8 : 0.1);
    expect(longestGapHours(speeds, 0.35, 48, 3600)).toBeCloseTo(12, 9);
  });
});

describe('totalDrawW', () => {
  it('weights each load by its duty cycle', () => {
    expect(
      totalDrawW([
        { name: 'cpu', watts: 0.2, dutyCycle: 1 },
        { name: 'iridium', watts: 7, dutyCycle: 0.01 },
        { name: 'ctd', watts: 1.5, dutyCycle: 0.1 },
      ]),
    ).toBeCloseTo(0.2 + 0.07 + 0.15, 9);
  });
});

const REAL_TURBINE: TurbineConfig = {
  sweptAreaM2: 0.5,
  powerCoefficient: 0.4,
  drivetrainEfficiency: 0.8,
  cutInSpeedMs: 0.35,
  ratedPowerW: 120,
};

/**
 * @description Assemble the same marine design the marine spec uses, so the parity pins below
 * compare like with like.
 * @param site - Site model.
 * @param capacityWh - Store nameplate.
 * @param loadW - Continuous load, W.
 * @returns A complete marine config.
 */
function marineUnit(site: MarineUnitConfig['site'], capacityWh: number, loadW: number): MarineUnitConfig {
  return {
    site,
    turbine: REAL_TURBINE,
    loads: [{ name: 'avionics', watts: loadW, dutyCycle: 1 }],
    storage: { capacityWh, initialSocFraction: 1, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 },
  };
}

describe('extraction parity — marine is bit-identical after the engine moved to shared', () => {
  // The marine spec's own guards are mostly inequalities (perpetual true/false, curtailed > 0).
  // Those survive an ULP-level drift inside the integration loop; these pins do not. Captured
  // from the marine slice BEFORE the extraction and reproduced exactly after it.
  it('reproduces the strong-site verdict to full double precision', () => {
    const { verdict } = simulatePowerBudget(marineUnit(STRONG_CHANNEL_SITE, 500, 3));
    expect(verdict.harvestedWh).toBe(59506.69547957435);
    expect(verdict.consumedWh).toBe(2159.9999999990923);
    expect(verdict.curtailedWh).toBe(57317.906590660146);
    expect(verdict.netEnergyWh).toBe(51586.115931595836);
    expect(verdict.minSocFraction).toBe(0.9921999999999982);
    expect(verdict.minSocAtHours).toBe(190.48333333333332);
    expect(verdict.meanHarvestW).toBe(82.64818816607549);
    expect(verdict.brownoutHours).toBe(0);
    expect(verdict.siteName).toBe('illustrative-strong-channel');
    expect(verdict.label).toBe('illustrative-strong-channel');
  });

  it('reproduces the undersized-store trap to full double precision', () => {
    const { verdict } = simulatePowerBudget(marineUnit(MODERATE_INLET_SITE, 5, 18));
    expect(verdict.harvestedWh).toBe(19897.49798935706);
    expect(verdict.consumedWh).toBe(12959.999999991942);
    expect(verdict.curtailedWh).toBe(11795.863527271758);
    expect(verdict.brownoutHours).toBe(345.78333333333336);
    expect(verdict.marginRatio).toBe(1.5353007707846784);
    expect(verdict.minSocFraction).toBe(0.19999999999999996);
    // Raw margin over 1 and 5.7 kWh of net surplus, and the design is still dead: the store is too
    // small to hold the neap deficit. netEnergyWh is the clause capacity CANNOT fix, brownout is
    // the clause it can — this design fails only the second, which is why a bigger pack saves it.
    expect(verdict.netEnergyWh).toBe(5716.022001147837);
    expect(verdict.perpetual).toBe(false);
  });

  it('reproduces the curtailment total and both gap scans exactly', () => {
    expect(simulatePowerBudget(marineUnit(STRONG_CHANNEL_SITE, 50, 1)).verdict.curtailedWh).toBe(58777.09918324213);
    // The gap pins moved off their old 3.05 / 1.3 — both were exact multiples of the 60 s sampling
    // step, which is the tell that the step was being measured rather than the slack. Refined,
    // they are the continuous crossing-to-crossing stretch and no longer land on a grid line.
    expect(longestSlackHours(MODERATE_INLET_SITE, REAL_TURBINE.cutInSpeedMs, 720)).toBeCloseTo(3.0426860162, 9);
    expect(longestSlackHours(STRONG_CHANNEL_SITE, REAL_TURBINE.cutInSpeedMs, 720)).toBeCloseTo(1.3148166151, 9);
    // And they are now a property of the tide, not of the scan: a 10x finer step agrees.
    expect(longestSlackHours(MODERATE_INLET_SITE, REAL_TURBINE.cutInSpeedMs, 720, 6)).toBeCloseTo(3.0426860162, 9);
    expect(longestSlackHours(STRONG_CHANNEL_SITE, REAL_TURBINE.cutInSpeedMs, 720, 6)).toBeCloseTo(1.3148166151, 9);
  });

  it('reproduces every store recommendation exactly', () => {
    expect(recommendMarineStorageWh(marineUnit(MODERATE_INLET_SITE, 5, 18))).toBe(1430.8929443359375);
    expect(recommendMarineStorageWh(marineUnit(MODERATE_INLET_SITE, 100, 60))).toBeNull();
    expect(recommendMarineStorageWh(marineUnit(STRONG_CHANNEL_SITE, 1, 3))).toBe(4.9591064453125);
  });

  it('still carries the flow speed on every retained sample', () => {
    const { samples } = simulatePowerBudget(marineUnit(STRONG_CHANNEL_SITE, 500, 3));
    expect(samples.length).toBeGreaterThan(0);
    // currentMs is the marine widening the generic sample cannot carry; it must survive the map.
    expect(samples.every((s) => Number.isFinite(s.currentMs))).toBe(true);
    expect(samples.some((s) => s.currentMs < 0)).toBe(true);
  });
});
