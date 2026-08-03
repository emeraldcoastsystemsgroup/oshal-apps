/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — Harvest Siting Console. Hand-rolled
 *                     |                             | canvas visualisation of the ground-thermal harvest domain
 *                     |                             | beside the marine one. The physics is mirrored client-side
 *                     |                             | on purpose: the console must stay fully usable when
 *                     |                             | /api/ocean-lab/harvest is absent, so the server is a cross-check and
 *                     |                             | never a dependency. Everything here is illustrative
 *                     |                             | PARAMETERS over a real model — not survey data.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Mirrored the server's corrected closure test. The console
 *                     |                             | had ALREADY diagnosed the end-state clause (see the sizing
 *                     |                             | search's comment) and worked around it locally; the fix has
 *                     |                             | now landed in @/shared/energy, so the headline verdict uses
 *                     |                             | the same netEnergyWh test and the "server cross-check" row
 *                     |                             | compares like with like instead of disagreeing by design.
 */

/* global window, document, fetch */

(function (global) {
  'use strict';

  /* =========================================================================
   * 1. Constants — the model's fixed numbers.
   * ====================================================================== */

  /** @description Tropical year, seconds. The annual thermal wave's period. */
  var ANNUAL_PERIOD_S = 31557600;
  /** @description Solar day, seconds. The diurnal thermal wave's period. */
  var DIURNAL_PERIOD_S = 86400;
  /** @description Seconds in a day — used everywhere the axis is in days. */
  var DAY_S = 86400;
  /** @description Celsius-to-Kelvin offset. TEG efficiency is absolute-temperature work. */
  var KELVIN = 273.15;
  /** @description Continental-average geothermal gradient, K/m (25 K/km). */
  var DEFAULT_GEOTHERMAL_K_PER_M = 0.025;
  /** @description Seawater density at coastal temperature/salinity, kg/m³. */
  var SEAWATER_DENSITY_KGM3 = 1025;
  /** @description Simulated span for the ground node: two full annual cycles. */
  var SPAN_DAYS = 730.5;
  /** @description Integration step for the ground budget, s. 15 min resolves the 24 h wave 96×. */
  var GROUND_STEP_S = 900;
  /** @description Step for the sub-cut-in gap scan, s. Fine enough to time an hours-long null. */
  var GAP_STEP_S = 600;
  /** @description Canvas label font, matching the surface's own system sans. */
  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  /**
   * @description Width the cutaway caption needs, px. The slab is sized around it so a narrow card
   * cannot push the numbers off the right edge; below the threshold where a usable slab AND the
   * caption both fit side by side, the caption moves under the slab and the slab gives up the
   * height for it. Reserving that band up front is the point — dropping the caption below a
   * full-height slab would push it off the bottom instead, which is the same bug moved.
   */
  var CAPTION_W = 168;

  /**
   * @description Illustrative soil materials. `alphaM2S` (thermal diffusivity) sets both damping
   * depths; `kWmK` (conductivity) sets the conduction path a TEG has to pull heat through. They are
   * listed together because they are properties of the SAME material — tuning one without the other
   * describes a soil that does not exist. Values are held inside the model's stated ranges
   * (alpha 0.2e-6..1.0e-6 m²/s, k 0.5..2.0 W/m/K).
   */
  var SOILS = [
    { id: 'reference-loam', label: 'Reference loam (model default)', alphaM2S: 0.50e-6, kWmK: 1.00 },
    { id: 'dry-sand', label: 'Dry sand', alphaM2S: 0.24e-6, kWmK: 0.50 },
    { id: 'moist-sand', label: 'Moist sand', alphaM2S: 0.74e-6, kWmK: 1.80 },
    { id: 'dry-clay', label: 'Dry clay', alphaM2S: 0.20e-6, kWmK: 0.55 },
    { id: 'wet-clay', label: 'Wet clay', alphaM2S: 0.55e-6, kWmK: 1.25 },
    { id: 'saturated-silt', label: 'Saturated silt', alphaM2S: 0.62e-6, kWmK: 1.50 },
    { id: 'granite', label: 'Granite bedrock', alphaM2S: 1.00e-6, kWmK: 2.00 }
  ];

  /**
   * @description Illustrative climates — the surface boundary condition the two waves ride on.
   * `annualPeakDay` / `diurnalPeakHour` only fix the time origin (day 0 = 1 January, hour 0 =
   * midnight) so the null windows land on a readable calendar; they do not change the physics.
   * These are plausible parameters, NOT station data — replace them before siting anything.
   */
  var SITES = [
    { id: 'temperate-continental', label: 'Temperate continental', meanC: 11, annualK: 12, diurnalK: 8, annualPeakDay: 200, diurnalPeakHour: 15 },
    { id: 'humid-subtropical', label: 'Humid subtropical', meanC: 19, annualK: 9, diurnalK: 7, annualPeakDay: 205, diurnalPeakHour: 15 },
    { id: 'semi-arid-high-desert', label: 'Semi-arid high desert', meanC: 13, annualK: 14, diurnalK: 16, annualPeakDay: 196, diurnalPeakHour: 16 },
    { id: 'boreal', label: 'Boreal', meanC: 2, annualK: 16, diurnalK: 6, annualPeakDay: 202, diurnalPeakHour: 15 },
    { id: 'maritime-temperate', label: 'Maritime temperate', meanC: 10.5, annualK: 6, diurnalK: 5, annualPeakDay: 210, diurnalPeakHour: 15 }
  ];

  /** @description How the two junction pairs are wired into the one converter. */
  var WIRINGS = [
    { id: 'dual', label: 'Both pairs → one converter' },
    { id: 'deep', label: 'Deep annual pair only' },
    { id: 'shallow', label: 'Shallow diurnal pair only' }
  ];

  /**
   * @description Opening state. Depths are metres, powers milliwatts, resistances K/W. The store
   * default is deliberately the interesting size: 0.10 Wh carries the DUAL-pair design through its
   * worst gap with room to spare and leaves the annual-pair-alone design short of the equinox null,
   * so the console's whole argument is visible on first paint without touching a control.
   */
  var DEFAULTS = {
    siteId: 'temperate-continental', soilId: 'reference-loam', wiring: 'dual',
    collectorAreaM2: 0.25, rTegKW: 9.6, ztBar: 0.9, ratedMw: 50,
    shallowHotM: 0.05, shallowColdM: 0.35, deepHotM: 0.60, deepColdM: 3.00,
    loadMw: 0.25, cutInMw: 0.02, capacityWh: 0.10,
    geothermalKPerM: DEFAULT_GEOTHERMAL_K_PER_M, cursorDay: 104, cursorHour: 6
  };

  /* =========================================================================
   * 2. Soil thermal field — the harmonic solution to the 1-D heat equation.
   * ====================================================================== */

  /**
   * @description Damping depth of a thermal wave in a semi-infinite solid, d = sqrt(2·alpha/omega).
   * This one number is the whole model: amplitude falls as exp(-z/d) and phase lags by z/d radians,
   * so the annual wave (d ≈ 2.24 m at the default soil) still has usable amplitude at 3 m while the
   * diurnal wave (d ≈ 0.117 m) is dead by 0.5 m.
   * @param alphaM2S - Soil thermal diffusivity, m²/s.
   * @param periodSeconds - Wave period, s.
   * @returns Damping depth, m.
   */
  function dampingDepthM(alphaM2S, periodSeconds) {
    return Math.sqrt((2 * alphaM2S) / ((2 * Math.PI) / periodSeconds));
  }

  /**
   * @description Build the temperature field T(z,t) for a site/soil pair. Two harmonic waves
   * SUPERPOSE — each with its own surface amplitude and its own damping depth — on a mean plus a
   * small linear geothermal term. The `-z/d` inside the cosine is the phase lag, and the lag, not
   * the geothermal gradient, is what makes a buried pair produce any dT at all.
   * @param site - Climate parameters (mean, two surface amplitudes, phase origins).
   * @param soil - Material parameters (diffusivity, conductivity).
   * @param geothermalKPerM - Linear geothermal gradient, K/m.
   * @returns A field object with `tempAt`, `rowSampler` (a depth-fixed fast path that hoists the two
   * exponentials out of the loop — the heatmap and the budget integration both live in that loop),
   * both damping depths, and the derived lag/amplitude probes.
   */
  function createSoilField(site, soil, geothermalKPerM) {
    var dA = dampingDepthM(soil.alphaM2S, ANNUAL_PERIOD_S); var wA = (2 * Math.PI) / ANNUAL_PERIOD_S;
    var dD = dampingDepthM(soil.alphaM2S, DIURNAL_PERIOD_S); var wD = (2 * Math.PI) / DIURNAL_PERIOD_S;
    var tA = site.annualPeakDay * DAY_S; var tD = site.diurnalPeakHour * 3600;
    var rowSampler = function (z) {
      var base = site.meanC + geothermalKPerM * z;
      var ampA = site.annualK * Math.exp(-z / dA); var lagA = z / dA;
      var ampD = site.diurnalK * Math.exp(-z / dD); var lagD = z / dD;
      return function (t) { return base + ampA * Math.cos(wA * (t - tA) - lagA) + ampD * Math.cos(wD * (t - tD) - lagD); };
    };
    return {
      site: site, soil: soil, meanC: site.meanC, geothermalKPerM: geothermalKPerM,
      annualDampingM: dA, diurnalDampingM: dD, rowSampler: rowSampler,
      tempAt: function (z, t) { return rowSampler(z)(t); },
      annualAmplitudeK: function (z) { return site.annualK * Math.exp(-z / dA); },
      diurnalAmplitudeK: function (z) { return site.diurnalK * Math.exp(-z / dD); },
      annualLagDays: function (z) { return (z / dA) / wA / DAY_S; }
    };
  }

  /* =========================================================================
   * 3. TEG harvester — thermal resistance network, then figure-of-merit efficiency.
   * ====================================================================== */

  /**
   * @description Conduction resistance of the soil path between two junctions, R = L/(k·A). The
   * collector area is the lever most people miss: doubling it halves R_soil and therefore doubles
   * the heat available to convert, while dT is untouched.
   * @param separationM - |z_hot − z_cold|, m.
   * @param conductivityWmK - Soil thermal conductivity, W/m/K.
   * @param areaM2 - Collector area, m².
   * @returns Soil thermal resistance, K/W.
   */
  function soilResistanceKW(separationM, conductivityWmK, areaM2) {
    if (!(conductivityWmK > 0) || !(areaM2 > 0)) return Infinity;
    return separationM / (conductivityWmK * areaM2);
  }

  /**
   * @description Electrical power off one thermoelectric module. Heat must FLOW to be converted:
   * Q = |dT|/(R_soil + R_teg) is the heat crossing, and only dT_module = Q·R_teg falls across the
   * module itself. Efficiency is the standard figure-of-merit form. Sign-agnostic by design — the
   * junction polarity reverses every half-cycle and the converter bridges it.
   * @param tHotC - Temperature at the warmer junction, °C (whichever it is at this instant).
   * @param tColdC - Temperature at the cooler junction, °C.
   * @param rSoilKW - Soil path resistance, K/W.
   * @param rTegKW - Module thermal resistance, K/W.
   * @param ztBar - Mean figure of merit; 0.9 is Bi2Te3 near ambient.
   * @param ratedW - Electrical clamp, W.
   * @returns Electrical power, W. Peaks at R_teg == R_soil — thermal impedance matching is the lever.
   */
  function tegPowerW(tHotC, tColdC, rSoilKW, rTegKW, ztBar, ratedW) {
    var deltaK = Math.abs(tHotC - tColdC); var rTotal = rSoilKW + rTegKW;
    if (!(deltaK > 0) || !(rTotal > 0) || !isFinite(rTotal)) return 0;
    var heatW = deltaK / rTotal;
    var hotK = Math.max(tHotC, tColdC) + KELVIN; var coldK = Math.min(tHotC, tColdC) + KELVIN;
    if (!(hotK > 0)) return 0;
    var root = Math.sqrt(1 + ztBar);
    var eta = ((heatW * rTegKW) / hotK) * ((root - 1) / (root + coldK / hotK));
    return Math.min(eta * heatW, ratedW);
  }

  /**
   * @description Attach everything about a junction pair that depends only on its depths — the
   * separation, the soil resistance, and a depth-fixed temperature sampler per junction. Doing this
   * once per pair rather than per timestep takes four transcendentals out of an inner loop that runs
   * roughly a hundred thousand times per redraw, which is the difference between a slider that
   * tracks the pointer and one that stutters.
   * @param field - Soil temperature field.
   * @param pair - Pair carrying `hotM` and `coldM`, mutated in place.
   * @param cfg - Harvester config (`conductivityWmK`, `collectorAreaM2`).
   * @returns The same pair, now carrying `separationM`, `rSoilKW`, `hotSampler`, `coldSampler`.
   */
  function preparePair(field, pair, cfg) {
    pair.separationM = Math.abs(pair.coldM - pair.hotM);
    pair.rSoilKW = soilResistanceKW(pair.separationM, cfg.conductivityWmK, cfg.collectorAreaM2);
    pair.hotSampler = field.rowSampler(pair.hotM); pair.coldSampler = field.rowSampler(pair.coldM);
    return pair;
  }

  /**
   * @description Everything about one prepared junction pair at one instant: both junction
   * temperatures, the signed dT across them, and the electrical power that dT actually yields.
   * @param pair - Pair prepared by {@link preparePair}.
   * @param t - Time since the run epoch, s.
   * @param cfg - Harvester config (`rTegKW`, `ztBar`, `ratedW`).
   * @returns `{ tHotC, tColdC, deltaK, powerW }`.
   */
  function pairStateAt(pair, t, cfg) {
    var a = pair.hotSampler(t);
    var b = pair.coldSampler(t);
    return { tHotC: a, tColdC: b, deltaK: a - b, powerW: tegPowerW(a, b, pair.rSoilKW, cfg.rTegKW, cfg.ztBar, cfg.ratedW) };
  }

  /**
   * @description Compose one or more prepared junction pairs into a `(t) => watts` harvest sampler,
   * with the converter's cut-in applied to the SUM. Cut-in on the sum is the physically honest choice
   * for a dual-pair node: one boost converter cold-starts off whatever the pairs jointly present,
   * and it is precisely why two pairs beat the better of the two taken separately.
   * @param pairs - Prepared junction pairs to wire in.
   * @param cfg - Harvester config, including `cutInW`.
   * @returns Harvest sampler in watts.
   */
  function makeHarvestSampler(pairs, cfg) {
    return function (t) {
      var total = 0;
      for (var i = 0; i < pairs.length; i += 1) {
        total += tegPowerW(pairs[i].hotSampler(t), pairs[i].coldSampler(t), pairs[i].rSoilKW, cfg.rTegKW, cfg.ztBar, cfg.ratedW);
      }
      return total >= cfg.cutInW ? Math.min(total, cfg.ratedW) : 0;
    };
  }

  /* =========================================================================
   * 4. Harvest gap + closed-loop energy budget (mirrors @/shared/energy).
   * ====================================================================== */

  /**
   * @description Longest continuous stretch in which a sampler stays below a threshold. THIS is the
   * number that sizes the store: it is the gap the node rides on stored energy alone. For a pair
   * driven only by the annual wave it runs for WEEKS; for a diurnal pair, hours.
   *
   * Both ENDS of every detected gap are bisected (40 halvings, the inner loop), so the answer is
   * the continuous gap rather than a multiple of the sample step — an un-refined count reports the
   * STEP, and a 45-minute and a 53-minute null then read identically at a 600 s step. A gap that
   * opens AND closes entirely between two samples is still invisible, so the step must sit below
   * the shortest gap that matters. Mirrors longestGapHours in @/shared/energy.
   * @param harvestAt - Sampler over time. Units must match `thresholdW`.
   * @param thresholdW - Value below which harvest counts as nothing.
   * @param spanHours - Window to search.
   * @param stepSeconds - Sample step, s.
   * @returns Longest sub-threshold stretch, hours, clipped to the span.
   */
  function longestGapHours(harvestAt, thresholdW, spanHours, stepSeconds) {
    var spanS = spanHours * 3600, steps = Math.ceil(spanS / stepSeconds), longest = 0, prevT = 0, prevBelow = harvestAt(0) < thresholdW, start = prevBelow ? 0 : null, t, below, lo, hi, mid, j;
    for (var i = 1; i <= steps; i += 1, prevBelow = below, prevT = t) {
      t = Math.min(i * stepSeconds, spanS); below = harvestAt(t) < thresholdW; if (below === prevBelow) continue;
      for (lo = prevT, hi = t, j = 0; j < 40; j += 1) { mid = (lo + hi) / 2; if ((harvestAt(mid) < thresholdW) === below) hi = mid; else lo = mid; }
      if (below) { start = (lo + hi) / 2; } else { longest = Math.max(longest, (lo + hi) / 2 - (start === null ? 0 : start)); start = null; }
    }
    return Math.max(longest, start === null ? 0 : spanS - start) / 3600;
  }

  /**
   * @description Advance the store one step. Charge pays the round-trip efficiency, discharge does
   * not; energy that will not fit is curtailed, which is the signal the harvester is oversized for
   * the store rather than the environment being generous. `netEnergyWh` accumulates the same signed
   * step with NEITHER clamp applied, so it is a property of the harvest schedule alone — the one
   * term a bigger cell cannot move, and therefore the honest closure test.
   * @param state - Accumulator, mutated in place.
   * @param storage - Store model.
   * @param netWh - Harvest minus draw for this step, Wh (signed).
   * @param floorWh - Level treated as empty.
   * @param stepSeconds - Step length, s.
   * @returns True when this step browned out.
   */
  function stepStore(state, storage, netWh, floorWh, stepSeconds) {
    state.netEnergyWh += netWh >= 0 ? netWh * storage.roundTripEfficiency : netWh;
    if (netWh >= 0) {
      var stored = Math.min(netWh * storage.roundTripEfficiency, storage.capacityWh - state.socWh);
      state.socWh += stored; state.curtailedWh += netWh - stored / storage.roundTripEfficiency;
      return false;
    }
    var deficit = -netWh; var drawn = Math.min(deficit, Math.max(0, state.socWh - floorWh));
    state.socWh -= drawn;
    if (drawn < deficit) { state.brownoutSeconds += stepSeconds; return true; }
    return false;
  }

  /**
   * @description Simulate a node's energy over a full environmental cycle. "Perpetual" requires BOTH
   * that the pack never browned out AND that the run ended in net energy surplus once charging
   * losses are paid — a design that limps downhill for two years is not perpetual, it is slow. Each
   * retained sample carries whether any step inside its window browned out, so the brownout region
   * can be drawn.
   * @param design - `{ label, harvestAt, drawW, storage }`.
   * @param options - `{ durationHours, stepSeconds, sampleEveryMinutes }`.
   * @returns `{ verdict, samples }`.
   */
  function simulateEnergyBudget(design, options) {
    var opts = options || {};
    var durationHours = opts.durationHours || 720; var stepSeconds = opts.stepSeconds || 60;
    var sampleEvery = Math.max(1, Math.round(((opts.sampleEveryMinutes || 30) * 60) / stepSeconds));
    var storage = design.storage;
    var floorWh = storage.capacityWh * (1 - storage.usableDepthOfDischarge);
    var startSocWh = storage.capacityWh * storage.initialSocFraction;
    var spanSeconds = durationHours * 3600; var steps = Math.ceil(spanSeconds / stepSeconds);
    var state = { socWh: startSocWh, harvestedWh: 0, consumedWh: 0, curtailedWh: 0, netEnergyWh: 0, brownoutSeconds: 0, minSocWh: startSocWh, minSocAtSeconds: 0 };
    var samples = []; var windowBrownout = false;
    for (var i = 0; i < steps; i += 1) {
      // The final step is CLIPPED to the span rather than overshooting it: an overshoot inflates
      // every total and every mean by the overshoot ratio whenever the step does not divide.
      var t = i * stepSeconds; var dtSeconds = Math.min(stepSeconds, spanSeconds - t); var dtHours = dtSeconds / 3600; var harvestW = design.harvestAt(t);
      state.harvestedWh += harvestW * dtHours; state.consumedWh += design.drawW * dtHours;
      if (stepStore(state, storage, (harvestW - design.drawW) * dtHours, floorWh, dtSeconds)) windowBrownout = true;
      if (state.socWh < state.minSocWh) { state.minSocWh = state.socWh; state.minSocAtSeconds = t; }
      if (i % sampleEvery === 0) {
        samples.push({ tDays: t / DAY_S, harvestW: harvestW, socFraction: state.socWh / storage.capacityWh, brownout: windowBrownout });
        windowBrownout = false;
      }
    }
    return { verdict: buildVerdict(design.label, storage.capacityWh, state, durationHours), samples: samples };
  }

  /**
   * @description Collapse the integration accumulator into the scalar verdict the console leads with.
   * @param label - Design label.
   * @param capacityWh - Store nameplate — the denominator of every SoC fraction.
   * @param s - Accumulator after the run.
   * @param durationHours - Simulated span, which the loop integrated exactly.
   * @returns The verdict object.
   */
  function buildVerdict(label, capacityWh, s, durationHours) {
    return {
      perpetual: s.brownoutSeconds === 0 && s.netEnergyWh >= 0, label: label, durationHours: durationHours,
      minSocFraction: s.minSocWh / capacityWh, minSocAtHours: s.minSocAtSeconds / 3600, brownoutHours: s.brownoutSeconds / 3600,
      harvestedWh: s.harvestedWh, consumedWh: s.consumedWh, curtailedWh: s.curtailedWh, netEnergyWh: s.netEnergyWh,
      marginRatio: s.consumedWh > 0 ? s.harvestedWh / s.consumedWh : Infinity,
      meanHarvestW: s.harvestedWh / durationHours, meanDrawW: s.consumedWh / durationHours
    };
  }

  /**
   * @description Smallest store that carries a design through its worst harvest gap — the answer to
   * "how big does the cell have to be". Binary search over capacity, each trial run from the
   * design's OWN starting state of charge: a cell that wakes half-empty has to survive its first
   * gap half-empty, and a search that quietly started every trial full answers a question nobody
   * asked.
   *
   * The predicate is now the full `perpetual` one, which it could not be before: perpetual used to
   * require the run to CLOSE no worse charged than it started, and on a store the search started
   * FULL the top clamp turned that into "ends EXACTLY full" — a property of where the window
   * stopped, satisfiable by no capacity at all, which reported "no size works" for designs with a
   * 3× harvest margin. With the closure test now netEnergyWh ≥ 0 — capacity-independent — the two
   * clauses split cleanly: brownout is what capacity fixes, net surplus is what it cannot.
   * @param design - Design whose `storage.capacityWh` is overridden per trial.
   * @param options - Simulation options (a coarser step is used here; it is a sizing search).
   * @param maxCapacityWh - Upper bound for the search.
   * @returns Minimum viable capacity, Wh, or null when harvest is short of load at any size.
   */
  function recommendStorageWh(design, options, maxCapacityWh) {
    var cap = maxCapacityWh || 100;
    var trial = function (capacityWh) {
      var storage = { capacityWh: capacityWh, initialSocFraction: design.storage.initialSocFraction, roundTripEfficiency: design.storage.roundTripEfficiency, usableDepthOfDischarge: design.storage.usableDepthOfDischarge };
      return simulateEnergyBudget({ label: design.label, harvestAt: design.harvestAt, drawW: design.drawW, storage: storage }, options).verdict;
    };
    if (!trial(cap).perpetual) return null;
    var lo = 0; var hi = cap;
    for (var i = 0; i < 30 && hi - lo > cap * 1e-5; i += 1) {
      var mid = (lo + hi) / 2;
      if (trial(mid).perpetual) hi = mid; else lo = mid;
    }
    return hi;
  }

  /* =========================================================================
   * 5. Marine reference domain — the second harvest environment, for scale.
   * ====================================================================== */

  /**
   * @description Illustrative moderate coastal inlet. Constituent periods are fixed by orbital
   * mechanics everywhere on the planet; only amplitude and phase are local. The spring/neap beat is
   * NOT a parameter — it emerges from M2 and S2 drifting in and out of phase (≈ 14.77 days). These
   * are plausible parameters, not a harmonic analysis of any real station.
   */
  var MARINE_SITE = {
    name: 'illustrative-moderate-inlet',
    constituents: [
      { name: 'M2', periodHours: 12.4206012, amplitudeMs: 0.85, phaseDeg: 0 },
      { name: 'S2', periodHours: 12.0, amplitudeMs: 0.28, phaseDeg: 30 },
      { name: 'K1', periodHours: 23.9344696, amplitudeMs: 0.12, phaseDeg: 95 }
    ],
    residualMs: 0.05
  };

  /**
   * @description Illustrative small rotor and node for the marine comparison. Sized so the neap
   * minimum actually bites: at a comfortable margin the store would simply pin at full and the
   * spring/neap beat — the thing worth comparing against the equinox null — would be invisible.
   */
  var MARINE_UNIT = {
    turbine: { sweptAreaM2: 0.05, powerCoefficient: 0.40, drivetrainEfficiency: 0.80, cutInSpeedMs: 0.35, ratedPowerW: 25 },
    drawW: 1.2,
    storage: { capacityWh: 60, initialSocFraction: 0.6, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 }
  };

  /**
   * @description Signed flow speed at a tidal site: the sum of its constituents plus any steady
   * residual. Sign carries direction; a rotor harvests either way.
   * @param site - Harmonic site model.
   * @param t - Seconds since the phase epoch.
   * @returns Signed flow speed, m/s.
   */
  function currentSpeedAt(site, t) {
    var u = site.residualMs || 0;
    for (var i = 0; i < site.constituents.length; i += 1) {
      var c = site.constituents[i];
      u += c.amplitudeMs * Math.cos(((2 * Math.PI) / (c.periodHours * 3600)) * t - (c.phaseDeg * Math.PI) / 180);
    }
    return u;
  }

  /**
   * @description Electrical power a rotor extracts: P = ½·rho·A·|v|³·Cp·eta, zero below cut-in and
   * clamped at rated. The cube is why cut-in dominates: halving the flow cuts power eightfold.
   * @param turbine - Rotor model.
   * @param speedMs - Signed flow speed, m/s.
   * @returns Electrical power, W.
   */
  function turbinePowerW(turbine, speedMs) {
    var v = Math.abs(speedMs);
    if (v < turbine.cutInSpeedMs) return 0;
    var raw = 0.5 * SEAWATER_DENSITY_KGM3 * turbine.sweptAreaM2 * v * v * v * turbine.powerCoefficient * turbine.drivetrainEfficiency;
    return Math.min(raw, turbine.ratedPowerW);
  }

  /**
   * @description Run the marine reference design over a 30-day span — one full spring/neap beat.
   * Independent of every ground control, so it is computed once and held.
   * @returns `{ verdict, samples, speedAt }`.
   */
  function computeMarine() {
    var harvestAt = function (t) { return turbinePowerW(MARINE_UNIT.turbine, currentSpeedAt(MARINE_SITE, t)); };
    var design = { label: MARINE_SITE.name, harvestAt: harvestAt, drawW: MARINE_UNIT.drawW, storage: MARINE_UNIT.storage };
    var run = simulateEnergyBudget(design, { durationHours: 720, stepSeconds: 60, sampleEveryMinutes: 15 });
    return { verdict: run.verdict, samples: run.samples, speedAt: function (t) { return currentSpeedAt(MARINE_SITE, t); } };
  }

  /* =========================================================================
   * 6. Model assembly — one pure function from control state to everything drawn.
   * ====================================================================== */

  /**
   * @description Look an entry up by id, falling back to the first so a stale or server-supplied id
   * can never leave the console without a model to draw.
   * @param list - Catalogue array.
   * @param id - Requested id.
   * @returns The matching entry, or the first.
   */
  function byId(list, id) {
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return list[0];
  }

  /**
   * @description Compute every derived quantity the console renders, from the control state alone.
   * Deliberately pure: the same state always yields the same page, whether or not the server
   * answered. The three gap figures are the headline finding — annual-only nulls for weeks,
   * diurnal-only for hours, and the dual pair inherits the shorter of the two — and the
   * counterfactual run is what lets the store chart show the brownout the shallow pair prevents.
   * @param state - Control state.
   * @returns The full model: field, pairs, gaps, budget, verdict and store recommendation.
   */
  function computeModel(state) {
    var site = byId(SITES, state.siteId); var soil = byId(SOILS, state.soilId);
    var field = createSoilField(site, soil, state.geothermalKPerM);
    var cfg = { conductivityWmK: soil.kWmK, collectorAreaM2: state.collectorAreaM2, rTegKW: state.rTegKW, ztBar: state.ztBar, ratedW: state.ratedMw / 1000, cutInW: state.cutInMw / 1000 };
    var shallow = preparePair(field, { id: 'shallow', hotM: state.shallowHotM, coldM: state.shallowColdM }, cfg);
    var deep = preparePair(field, { id: 'deep', hotM: state.deepHotM, coldM: state.deepColdM }, cfg);
    var pairs = [shallow, deep];
    var samplers = { shallow: makeHarvestSampler([shallow], cfg), deep: makeHarvestSampler([deep], cfg), dual: makeHarvestSampler(pairs, cfg) };
    samplers.active = samplers[state.wiring] || samplers.dual;
    var spanHours = SPAN_DAYS * 24;
    var gaps = {
      shallowH: longestGapHours(samplers.shallow, cfg.cutInW, spanHours, GAP_STEP_S),
      deepH: longestGapHours(samplers.deep, cfg.cutInW, spanHours, GAP_STEP_S),
      dualH: longestGapHours(samplers.dual, cfg.cutInW, spanHours, GAP_STEP_S)
    };
    gaps.activeH = typeof gaps[state.wiring + 'H'] === 'number' ? gaps[state.wiring + 'H'] : gaps.dualH;
    var storage = { capacityWh: state.capacityWh, initialSocFraction: 0.6, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 };
    var runOpts = { durationHours: spanHours, stepSeconds: GROUND_STEP_S, sampleEveryMinutes: 360 }; var drawW = state.loadMw / 1000;
    var design = { label: site.label + ' / ' + soil.label, harvestAt: samplers.active, drawW: drawW, storage: storage };
    var run = simulateEnergyBudget(design, runOpts);
    return {
      state: state, site: site, soil: soil, field: field, cfg: cfg, pairs: pairs,
      shallow: shallow, deep: deep, samplers: samplers, gaps: gaps, storage: storage,
      verdict: run.verdict, samples: run.samples,
      counterfactual: state.wiring === 'deep' ? run
        : simulateEnergyBudget({ label: 'annual pair alone', harvestAt: samplers.deep, drawW: drawW, storage: storage }, runOpts),
      minStoreWh: recommendStorageWh(design, { durationHours: spanHours, stepSeconds: 3600, sampleEveryMinutes: 1440 }, 20),
      nullWindows: findNullWindows(samplers.deep, cfg.cutInW),
      peakPairStats: peakPairStats(pairs, cfg),
      cursorSeconds: state.cursorDay * DAY_S + state.cursorHour * 3600
    };
  }

  /**
   * @description Scan the two-year span for the stretches where the ANNUAL pair alone sits below
   * cut-in — the equinox nulls. Returned as day intervals so every time-axis chart can shade the
   * same windows and the reader can see the store draining through them. Windows closer than two
   * days are merged: a dT sweeping through zero hovers around cut-in, so a fixed-step scan can
   * register one brief recovery mid-null and split a seventeen-day window into two, which would
   * understate the very finding the chart exists to show.
   * @param deepSampler - Harvest sampler for the annual pair only.
   * @param cutInW - Converter cut-in, W.
   * @returns Array of `{ startDay, endDay }`.
   */
  function findNullWindows(deepSampler, cutInW) {
    var raw = []; var stepS = 3 * 3600; var open = -1;
    var steps = Math.ceil((SPAN_DAYS * DAY_S) / stepS);
    for (var i = 0; i <= steps; i += 1) {
      var below = i < steps && deepSampler(i * stepS) < cutInW;
      if (below && open < 0) open = i;
      if (!below && open >= 0) { raw.push({ startDay: (open * stepS) / DAY_S, endDay: (i * stepS) / DAY_S }); open = -1; }
    }
    var out = [];
    for (var j = 0; j < raw.length; j += 1) {
      var last = out[out.length - 1];
      if (last && raw[j].startDay - last.endDay < 2) last.endDay = raw[j].endDay;
      else out.push({ startDay: raw[j].startDay, endDay: raw[j].endDay });
    }
    return out;
  }

  /**
   * @description Peak |dT|, peak and mean power per pair, plus the matched module resistance. Peak is
   * found by a coarse scan of the two-year span rather than analytically, because the pair's dT is
   * the superposition of two damped waves and the analytic peak is not worth the algebra.
   * @param pairs - Prepared junction pairs.
   * @param cfg - Harvester config.
   * @returns Per-pair-id stats `{ peakDeltaK, peakPowerW, meanPowerW, matchedRTegKW }`.
   */
  function peakPairStats(pairs, cfg) {
    var out = {}; var stepS = 1800;
    var steps = Math.ceil((SPAN_DAYS * DAY_S) / stepS);
    for (var p = 0; p < pairs.length; p += 1) {
      var pair = pairs[p]; var peakD = 0; var peakP = 0; var sumP = 0;
      for (var i = 0; i < steps; i += 1) {
        var s = pairStateAt(pair, i * stepS, cfg);
        if (Math.abs(s.deltaK) > peakD) peakD = Math.abs(s.deltaK);
        if (s.powerW > peakP) peakP = s.powerW;
        sumP += s.powerW;
      }
      out[pair.id] = { peakDeltaK: peakD, peakPowerW: peakP, meanPowerW: sumP / steps, matchedRTegKW: pair.rSoilKW };
    }
    return out;
  }

  /* =========================================================================
   * 7. Palette — theme-derived, validated (dataviz method: slots 1–3, both modes).
   * ====================================================================== */

  /**
   * @description Diverging ramp for the temperature field on a LIGHT surface: blue (cold) ↔ neutral
   * gray ↔ red (warm), five steps per arm. Warm and cool poles that read as opposite, with a
   * midpoint that reads as "nothing" — which is exactly what the soil mean is.
   */
  var DIVERGING_LIGHT = ['#0d366b', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4', '#f0efec', '#f6b6ae', '#ef8b7f', '#e34948', '#b02f2f', '#6f1c1c'];

  /**
   * @description The same two hues re-stepped for a DARK plot ground, so the midpoint recedes toward
   * the surface and both arms brighten outward. The warm arm's luminances deliberately mirror the
   * cold arm's (0.11 / 0.19 / 0.29 / 0.56 / 0.77 against 0.11 / 0.19 / 0.30 / 0.54 / 0.74): unequal
   * arms would make a warm deviation read as smaller than the identical cool one, which on a field
   * centred at the soil mean is a lie.
   */
  var DIVERGING_DARK = ['#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#1c5cab', '#383835', '#a83636', '#d04a48', '#e5706a', '#f6b6ae', '#fbdcd9'];

  /** @description Memoised hex→rgb for the ramp stops, so the heatmap never re-parses a literal. */
  var RAMP_CACHE = {};

  /**
   * @description Parse any CSS colour the browser resolved into `[r,g,b]`. Used both for the theme
   * probe and for ramp interpolation, so a hex literal and a computed `rgb()` take the same path.
   * @param value - CSS colour string.
   * @returns `[r,g,b]` 0..255, or null when unparseable.
   */
  function parseColor(value) {
    var s = String(value || '').trim(); var m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  /**
   * @description Resolve the chart palette against whatever framework theme is currently stamped on
   * `<html>`. Light-or-dark is decided by the relative luminance of the resolved `--bg-primary`
   * rather than by enumerating the eleven theme ids, so a twelfth theme gets the right chart palette
   * with no change here. Series hues are the validated categorical slots 1–3 (blue / orange / aqua)
   * in their per-mode steps; ink and grid come from the theme's own text tokens so the chart never
   * fights the surface it sits on.
   * @returns The palette object every draw function reads.
   */
  function resolvePalette() {
    var css = global.getComputedStyle(document.documentElement);
    var read = function (name, fallback) { return (css.getPropertyValue(name) || '').trim() || fallback; };
    var plot = read('--bg-primary', '#0a0a12');
    var lin = (parseColor(plot) || [10, 10, 18]).map(function (v) { var x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    var light = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.5;
    return {
      light: light, plot: plot,
      ink: read('--text-primary', light ? '#1a1a2e' : '#eeeef5'),
      dim: read('--text-secondary', light ? '#4a4a6a' : '#a0a0be'),
      muted: read('--text-muted', light ? '#8a8aa0' : '#5c5c78'),
      grid: light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.09)',
      axis: light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)',
      series: light ? ['#2a78d6', '#eb6834', '#1baf7a'] : ['#3987e5', '#d95926', '#199e70'],
      warning: '#fab219', critical: '#d03b3b',
      diverging: light ? DIVERGING_LIGHT : DIVERGING_DARK
    };
  }

  /**
   * @description Sample the diverging ramp at a normalised deviation from the soil mean. Linear
   * interpolation between adjacent documented stops; the ramp itself supplies the perceptual steps.
   * @param ramp - Ordered stop list, coldest first.
   * @param unit - Deviation in −1..+1 (−1 = coldest extreme, 0 = the soil mean, +1 = warmest).
   * @param out - Optional `Uint8ClampedArray` to write into instead of returning a string — the
   * heatmap paints tens of thousands of cells and cannot afford a string per cell.
   * @param offset - Byte offset of the pixel when `out` is supplied.
   * @returns An `rgb(...)` string, or an empty string when writing into a buffer.
   */
  function rampColor(ramp, unit, out, offset) {
    var pos = ((Math.max(-1, Math.min(1, unit)) + 1) / 2) * (ramp.length - 1);
    var i = Math.max(0, Math.min(ramp.length - 2, Math.floor(pos))); var f = pos - i;
    var a = RAMP_CACHE[ramp[i]] || (RAMP_CACHE[ramp[i]] = parseColor(ramp[i]));
    var b = RAMP_CACHE[ramp[i + 1]] || (RAMP_CACHE[ramp[i + 1]] = parseColor(ramp[i + 1]));
    if (!out) return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
    out[offset] = a[0] + (b[0] - a[0]) * f;
    out[offset + 1] = a[1] + (b[1] - a[1]) * f;
    out[offset + 2] = a[2] + (b[2] - a[2]) * f;
    out[offset + 3] = 255;
    return '';
  }

  /* =========================================================================
   * 8. Canvas plot primitives — one implementation, shared by every chart.
   * ====================================================================== */

  /**
   * @description DPR-capped backing-store resize plus a cleared 2D context. Capped at 2 because a
   * 3× backing store on a full-width heatmap costs more than it shows.
   * @param canvas - Target canvas element.
   * @returns `{ ctx, w, h }` in CSS pixels, or null when the canvas has no layout yet.
   */
  function fitCanvas(canvas) {
    if (!canvas) return null;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.round(canvas.clientWidth); var h = Math.round(canvas.clientHeight);
    if (!(w > 0) || !(h > 0)) return null;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /**
   * @description Build the value↔pixel mapping for a plot rectangle. Kept as a plain object rather
   * than a class so a chart can stash it for the hover layer to reuse without re-deriving geometry.
   * @param rect - `{ l, t, w, h }` plot area in CSS pixels.
   * @param x0 - Domain minimum on x.
   * @param x1 - Domain maximum on x.
   * @param y0 - Domain minimum on y.
   * @param y1 - Domain maximum on y.
   * @returns Scale object with `x`, `y`, `invX`, `invY` and the retained domain.
   */
  function makeScale(rect, x0, x1, y0, y1) {
    return {
      rect: rect, x0: x0, x1: x1, y0: y0, y1: y1,
      x: function (v) { return rect.l + ((v - x0) / (x1 - x0)) * rect.w; },
      y: function (v) { return rect.t + rect.h - ((v - y0) / (y1 - y0)) * rect.h; },
      invX: function (px) { return x0 + ((px - rect.l) / rect.w) * (x1 - x0); },
      invY: function (py) { return y0 + ((rect.t + rect.h - py) / rect.h) * (y1 - y0); }
    };
  }

  /**
   * @description Round tick positions for an axis — clean numbers a reader can hold in their head.
   * @param min - Domain minimum.
   * @param max - Domain maximum.
   * @param target - Approximate tick count.
   * @returns Ascending tick values inside the domain.
   */
  function niceTicks(min, max, target) {
    var span = max - min;
    if (!(span > 0)) return [min];
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)); var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  /**
   * @description Clip subsequent drawing to a plot rectangle. Every series draw is clipped so an
   * out-of-range excursion cannot bleed across the axis labels.
   * @param ctx - 2D context.
   * @param r - Plot rectangle.
   * @returns Nothing; caller must `ctx.restore()`.
   */
  function clipTo(ctx, r) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.l, r.t, r.w, r.h); ctx.clip();
  }

  /**
   * @description Draw the plot ground, hairline grid, both axes and their titles. Gridlines are
   * solid one-step-off-surface hairlines — never dashed, which reads as "threshold" when it is just
   * a grid.
   * @param ctx - 2D context.
   * @param sc - Scale from {@link makeScale}.
   * @param pal - Palette.
   * @param o - `{ xTicks, yTicks, fmtX, fmtY, xTitle, yTitle }`.
   * @returns Nothing; draws in place.
   */
  function drawFrame(ctx, sc, pal, o) {
    var r = sc.rect; var i, px, py;
    ctx.fillStyle = pal.plot; ctx.fillRect(r.l, r.t, r.w, r.h);
    ctx.font = '11px ' + FONT; ctx.lineWidth = 1; ctx.strokeStyle = pal.grid;
    for (i = 0; i < o.yTicks.length; i += 1) {
      py = Math.round(sc.y(o.yTicks[i])) + 0.5;
      if (py < r.t - 1 || py > r.t + r.h + 1) continue;
      ctx.beginPath(); ctx.moveTo(r.l, py); ctx.lineTo(r.l + r.w, py); ctx.stroke();
      ctx.fillStyle = pal.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(o.fmtY(o.yTicks[i]), r.l - 7, py);
    }
    for (i = 0; i < o.xTicks.length; i += 1) {
      px = Math.round(sc.x(o.xTicks[i])) + 0.5;
      if (px < r.l - 1 || px > r.l + r.w + 1) continue;
      ctx.strokeStyle = pal.grid;
      ctx.beginPath(); ctx.moveTo(px, r.t); ctx.lineTo(px, r.t + r.h); ctx.stroke();
      ctx.fillStyle = pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.fmtX(o.xTicks[i]), px, r.t + r.h + 6);
    }
    ctx.strokeStyle = pal.axis;
    ctx.beginPath(); ctx.moveTo(r.l + 0.5, r.t); ctx.lineTo(r.l + 0.5, r.t + r.h + 0.5); ctx.lineTo(r.l + r.w, r.t + r.h + 0.5); ctx.stroke();
    ctx.fillStyle = pal.dim;
    if (o.xTitle) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.xTitle, r.l + r.w / 2, r.t + r.h + 22); }
    if (!o.yTitle) return;
    ctx.save(); ctx.translate(12, r.t + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(o.yTitle, 0, 0); ctx.restore();
  }

  /**
   * @description Stroke a series as a 2px round-joined line. Points come from a sampler over pixel
   * columns, so a two-year series never allocates an array it does not need.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param color - Series colour.
   * @param sampleAt - `(domainX) => domainY` (return null to break the line).
   * @returns Nothing; draws in place.
   */
  function drawSeries(ctx, sc, color, sampleAt) {
    var r = sc.rect;
    clipTo(ctx, r);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    var pen = false;
    for (var px = 0; px <= r.w; px += 1) {
      var v = sampleAt(sc.invX(r.l + px));
      if (v === null || !isFinite(v)) { pen = false; continue; }
      if (pen) ctx.lineTo(r.l + px, sc.y(v)); else ctx.moveTo(r.l + px, sc.y(v));
      pen = true;
    }
    ctx.stroke(); ctx.restore();
  }

  /**
   * @description Draw a min/max envelope for a series that oscillates far faster than one pixel
   * column. Drawing instantaneous samples at this zoom would alias into a moiré that misstates the
   * data; the envelope is the honest downsample — a ~16%-opacity wash plus a hairline mean.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param color - Series colour.
   * @param columnStats - `(x0, x1, pxIndex) => { min, max, mean }` over one pixel column's width.
   * @returns Nothing; draws in place.
   */
  function drawEnvelope(ctx, sc, color, columnStats) {
    var r = sc.rect; var tops = []; var bottoms = []; var means = [];
    for (var px = 0; px <= r.w; px += 1) {
      var s = columnStats(sc.invX(r.l + px), sc.invX(r.l + px + 1), px);
      tops.push(sc.y(s.max)); bottoms.push(sc.y(s.min)); means.push(sc.y(s.mean));
    }
    clipTo(ctx, r);
    ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.beginPath();
    for (var i = 0; i < tops.length; i += 1) ctx.lineTo(r.l + i, tops[i]);
    for (var j = bottoms.length - 1; j >= 0; j -= 1) ctx.lineTo(r.l + j, bottoms[j]);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.beginPath();
    for (var k = 0; k < means.length; k += 1) { if (k === 0) ctx.moveTo(r.l, means[0]); else ctx.lineTo(r.l + k, means[k]); }
    ctx.stroke(); ctx.restore();
  }

  /**
   * @description Shade vertical day-intervals — the equinox nulls and the brownout stretches — and
   * write the region's name over the first one. The wash carries the region; the label carries the
   * meaning, because a status colour must never be the only channel.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param windows - `[{ startDay, endDay }]`.
   * @param color - Status colour.
   * @param alpha - Fill opacity. Pass 0 to place a label over a region already shaded by an earlier
   * call, which is how the store chart labels whichever of its two brownout sets actually occurred.
   * @param label - Optional text placed over the first window, in the theme's ink. The label is ink
   * rather than the status hue on purpose: warning sits below 3:1 on a light surface by design, so
   * the wash carries the region and readable text carries the meaning.
   * @param pal - Palette, for the label ink.
   * @returns Nothing; draws in place.
   */
  function drawWindows(ctx, sc, windows, color, alpha, label, pal) {
    var r = sc.rect;
    if (!windows.length) return;
    clipTo(ctx, r);
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    for (var i = 0; i < windows.length; i += 1) {
      var a = sc.x(windows[i].startDay);
      ctx.fillRect(a, r.t, Math.max(1.5, sc.x(windows[i].endDay) - a), r.h);
    }
    ctx.restore();
    if (!label) return;
    ctx.save();
    ctx.font = '10px ' + FONT; ctx.fillStyle = pal.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(label, Math.min(sc.x(windows[0].startDay) + 3, r.l + r.w - 138), r.t + 4);
    ctx.restore();
  }

  /**
   * @description Draw the shared time cursor — the scrubbed instant, echoed on every time chart so
   * the cutaway, the dT trace and the store level are unmistakably the same moment. Ink over a
   * surface-coloured underlay, so it stays legible across the heatmap's whole ramp.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param pal - Palette.
   * @param day - Cursor position in days.
   * @returns Nothing; draws in place.
   */
  function drawCursor(ctx, sc, pal, day) {
    if (day < sc.x0 || day > sc.x1) return;
    var px = Math.round(sc.x(day)) + 0.5; var r = sc.rect;
    ctx.save();
    for (var pass = 0; pass < 2; pass += 1) {
      ctx.strokeStyle = pass ? pal.ink : pal.plot; ctx.lineWidth = pass ? 1 : 3.5;
      ctx.beginPath(); ctx.moveTo(px, r.t); ctx.lineTo(px, r.t + r.h); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * @description The dT = 0 rule — the only line on the chart that is a threshold rather than a
   * grid, so it is drawn in the axis ink rather than the recessive gridline gray.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param pal - Palette.
   * @param value - Domain y to rule at.
   * @returns Nothing; draws in place.
   */
  function drawRule(ctx, sc, pal, value) {
    var py = Math.round(sc.y(value)) + 0.5;
    ctx.save(); ctx.strokeStyle = pal.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sc.rect.l, py); ctx.lineTo(sc.rect.l + sc.rect.w, py); ctx.stroke(); ctx.restore();
  }

  /**
   * @description Label one series at its right-hand end. Selective by design — a value on every
   * point is chaos; the endpoint plus the legend carry identity, and the table view carries the rest.
   * The dot wears the series colour; the text stays in ink, never the data colour.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param pal - Palette.
   * @param color - Series colour, used for the key dot only.
   * @param text - Label text.
   * @param value - Domain y at the right edge.
   * @returns Nothing; draws in place.
   */
  function labelSeriesEnd(ctx, sc, pal, color, text, value) {
    var py = Math.max(sc.rect.t + 8, Math.min(sc.rect.t + sc.rect.h - 8, sc.y(value))); var px = sc.rect.l + sc.rect.w + 6;
    ctx.save();
    ctx.font = '10.5px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px + 3, py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.dim; ctx.fillText(text, px + 9, py); ctx.restore();
  }

  /**
   * @description Mark one point on a curve with a ringed dot and a direct label. The 2px surface ring
   * is what keeps the marker legible where it overlaps the curve it sits on.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param pal - Palette.
   * @param x - Domain x.
   * @param y - Domain y.
   * @param color - Marker colour.
   * @param label - Text label, drawn in ink.
   * @returns Nothing; draws in place.
   */
  function markPoint(ctx, sc, pal, x, y, color, label) {
    if (x < sc.x0 || x > sc.x1) return;
    var px = sc.x(x); var py = Math.max(sc.rect.t + 6, Math.min(sc.rect.t + sc.rect.h - 6, sc.y(y)));
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = pal.plot; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.font = '10.5px ' + FONT; ctx.fillStyle = pal.dim; ctx.textBaseline = 'bottom';
    ctx.textAlign = px > sc.rect.l + sc.rect.w * 0.6 ? 'right' : 'left';
    ctx.fillText(label, px + (ctx.textAlign === 'right' ? -9 : 9), py - 6); ctx.restore();
  }

  /**
   * @description Format a day-of-run tick as whole months, so a two-year axis reads as a calendar
   * rather than a three-digit day count.
   * @param days - Day index.
   * @returns Tick label.
   */
  function fmtMonths(days) { return String(Math.round(days / 30.4375)); }

  /** @description Tick formatter for a day-index axis. @param v - Day index. @returns Label. */
  function fmtDay(v) { return 'd' + v.toFixed(0); }

  /** @description Tick formatter for a percentage axis. @param v - Percent. @returns Label. */
  function fmtPct(v) { return v.toFixed(0) + '%'; }

  /** @description Tick formatter with no decimals. @param v - Value. @returns Label. */
  function fmt0(v) { return v.toFixed(0); }

  /** @description Tick formatter with one decimal. @param v - Value. @returns Label. */
  function fmt1(v) { return v.toFixed(1); }

  /** @description Tick formatter with two decimals. @param v - Value. @returns Label. */
  function fmt2(v) { return v.toFixed(2); }

  /* =========================================================================
   * 9. Visual 1 — the soil depth/time heatmap (the headline).
   * ====================================================================== */

  /**
   * @description Rasterise T(z,t) into an offscreen image at cell resolution, then colour it against
   * the diverging ramp centred on the soil mean. Each cell is the MEAN of several sub-samples across
   * its own time width, which is a correct box downsample: at a two-year zoom a single instantaneous
   * sample per column would alias the 24 h wave into a false pattern. Row constants are hoisted via
   * `rowSampler`, so the inner loop is two cosines.
   * @param field - Soil temperature field.
   * @param o - `{ cols, rows, day0, day1, depth0, depth1, subSamples, ramp }`.
   * @returns `{ canvas, values, cols, rows, half }` — the image, its raw temperatures, and the
   * symmetric half-range the colours were scaled by.
   */
  function buildFieldImage(field, o) {
    var off = document.createElement('canvas');
    off.width = o.cols; off.height = o.rows;
    var octx = off.getContext('2d');
    var img = octx.createImageData(o.cols, o.rows);
    var values = new Float64Array(o.cols * o.rows);
    var dayStep = (o.day1 - o.day0) / o.cols; var sub = o.subSamples || 6;
    var min = Infinity; var max = -Infinity;
    for (var ry = 0; ry < o.rows; ry += 1) {
      var sampleAt = field.rowSampler(o.depth0 + ((ry + 0.5) / o.rows) * (o.depth1 - o.depth0));
      for (var cx = 0; cx < o.cols; cx += 1) {
        var acc = 0;
        for (var s = 0; s < sub; s += 1) acc += sampleAt((o.day0 + (cx + (s + 0.5) / sub) * dayStep) * DAY_S);
        var v = acc / sub; values[ry * o.cols + cx] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    var half = Math.max(Math.abs(max - field.meanC), Math.abs(field.meanC - min), 0.01);
    for (var i = 0; i < values.length; i += 1) rampColor(o.ramp, (values[i] - field.meanC) / half, img.data, i * 4);
    octx.putImageData(img, 0, 0);
    return { canvas: off, values: values, cols: o.cols, rows: o.rows, half: half };
  }

  /**
   * @description Render one depth/time heatmap panel: the field image, the mid-isotherm contour, the
   * junction-depth markers and the shared cursor. The contour is the phase lag made visible — it is
   * the locus of T = soil mean, and it tilts steadily right with depth because deeper soil crosses
   * its mean later. The damping is visible in the same frame, as colour fading toward the neutral
   * midpoint with depth.
   * @param ctx - 2D context.
   * @param sc - Scale (x = days, y = depth, inverted).
   * @param pal - Palette.
   * @param image - Result of {@link buildFieldImage}.
   * @param model - Full model, for the junction depths and the cursor.
   * @param markers - Whether to draw the junction-pair depth markers.
   * @returns Nothing; draws in place.
   */
  function drawHeatPanel(ctx, sc, pal, image, model, markers) {
    var r = sc.rect;
    clipTo(ctx, r);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image.canvas, r.l, r.t, r.w, r.h);
    ctx.fillStyle = pal.light ? 'rgba(11,11,11,0.55)' : 'rgba(255,255,255,0.6)';
    for (var ry = 0; ry < image.rows; ry += 1) {
      for (var cx = 1; cx < image.cols; cx += 1) {
        var a = image.values[ry * image.cols + cx - 1] - model.field.meanC;
        var b = image.values[ry * image.cols + cx] - model.field.meanC;
        if ((a > 0) === (b > 0)) continue;
        ctx.fillRect(r.l + (cx / image.cols) * r.w - 0.75, r.t + ((ry + 0.5) / image.rows) * r.h - 0.75, 1.5, 1.5);
      }
    }
    ctx.restore();
    if (markers) drawDepthMarkers(ctx, sc, pal, model);
    drawCursor(ctx, sc, pal, model.state.cursorDay);
  }

  /**
   * @description Overlay the four junction depths as horizontal markers, paired by colour, each with
   * a 2px surface ring so the line stays legible wherever it crosses the ramp. A trailing chip names
   * the pair and its depth, so identity is never colour-alone.
   * @param ctx - 2D context.
   * @param sc - Scale.
   * @param pal - Palette.
   * @param model - Model carrying the pairs.
   * @returns Nothing; draws in place.
   */
  function drawDepthMarkers(ctx, sc, pal, model) {
    var r = sc.rect;
    var rows = [[model.shallow.hotM, pal.series[0], 'A hot'], [model.shallow.coldM, pal.series[0], 'A cold'],
      [model.deep.hotM, pal.series[1], 'B hot'], [model.deep.coldM, pal.series[1], 'B cold']];
    ctx.save();
    ctx.font = '10px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (var i = 0; i < rows.length; i += 1) {
      var py = sc.y(rows[i][0]);
      if (py < r.t || py > r.t + r.h) continue;
      var label = rows[i][2] + ' ' + rows[i][0].toFixed(2) + ' m';
      for (var pass = 0; pass < 2; pass += 1) {
        ctx.strokeStyle = pass ? rows[i][1] : pal.plot; ctx.lineWidth = pass ? 1.5 : 3.5;
        ctx.beginPath(); ctx.moveTo(r.l, py); ctx.lineTo(r.l + r.w, py); ctx.stroke();
      }
      var w = ctx.measureText(label).width + 10;
      ctx.fillStyle = pal.plot; ctx.fillRect(r.l + r.w - w - 4, py - 7, w, 14);
      ctx.fillStyle = pal.ink; ctx.fillText(label, r.l + r.w - w + 1, py);
    }
    ctx.restore();
  }

  /**
   * @description Continuous colour-scale legend for the heatmap — mandatory, because a colour ramp
   * with no key is an unreadable encoding.
   * @param ctx - 2D context.
   * @param pal - Palette.
   * @param box - `{ l, t, w, h }` for the strip.
   * @param meanC - Midpoint temperature.
   * @param half - Half the colour span, K.
   * @returns Nothing; draws in place.
   */
  function drawColorbar(ctx, pal, box, meanC, half) {
    for (var i = 0; i < box.w; i += 1) {
      ctx.fillStyle = rampColor(pal.diverging, (i / (box.w - 1)) * 2 - 1);
      ctx.fillRect(box.l + i, box.t, 1.5, box.h);
    }
    ctx.font = '10px ' + FONT; ctx.fillStyle = pal.muted; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText((meanC - half).toFixed(1) + ' °C', box.l, box.t + box.h + 4);
    ctx.textAlign = 'center'; ctx.fillText('soil mean ' + meanC.toFixed(1) + ' °C', box.l + box.w / 2, box.t + box.h + 4);
    ctx.textAlign = 'right'; ctx.fillText((meanC + half).toFixed(1) + ' °C', box.l + box.w, box.t + box.h + 4);
  }

  /**
   * @description Draw the two-year × 4 m annual panel and the 14-day × 0.6 m diurnal panel together.
   * Two panels because one time axis cannot hold both waves: at a two-year zoom the 24 h wave is
   * sub-pixel, and at a 14-day zoom the annual wave is a straight line. Seeing both is how the two
   * damping depths — 2.24 m and 0.117 m at the default soil — become visible facts rather than claims.
   * @param canvas - Target canvas.
   * @param model - Full model.
   * @param pal - Palette.
   * @returns Nothing; draws and registers the hover model.
   */
  function drawHeatmap(canvas, model, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var maxDepth = Math.max(4, model.deep.coldM + 0.5); var split = Math.round(f.h * 0.62);
    var annual = makeScale({ l: 54, t: 10, w: f.w - 78, h: split - 58 }, 0, SPAN_DAYS, maxDepth, 0);
    var imgA = buildFieldImage(model.field, { cols: 366, rows: 130, day0: 0, day1: SPAN_DAYS, depth0: 0, depth1: maxDepth, subSamples: 6, ramp: pal.diverging });
    drawFrame(f.ctx, annual, pal, { xTicks: niceTicks(0, SPAN_DAYS, 8), yTicks: niceTicks(0, maxDepth, 5), fmtX: fmtMonths, fmtY: fmt1, xTitle: 'months from 1 January, year 1', yTitle: 'depth (m)' });
    drawHeatPanel(f.ctx, annual, pal, imgA, model, true);
    drawColorbar(f.ctx, pal, { l: annual.rect.l, t: split - 34, w: Math.min(300, annual.rect.w), h: 9 }, model.field.meanC, imgA.half);
    var diurnal = makeScale({ l: 54, t: split + 16, w: f.w - 78, h: f.h - split - 52 }, 0, 14, 0.6, 0);
    var imgD = buildFieldImage(model.field, { cols: 336, rows: 90, day0: 0, day1: 14, depth0: 0, depth1: 0.6, subSamples: 3, ramp: pal.diverging });
    drawFrame(f.ctx, diurnal, pal, { xTicks: niceTicks(0, 14, 7), yTicks: [0, 0.15, 0.3, 0.45, 0.6], fmtX: fmtDay, fmtY: fmt2, xTitle: 'days (zoom: the diurnal wave, damped out by ~0.5 m)', yTitle: 'depth (m)' });
    drawHeatPanel(f.ctx, diurnal, pal, imgD, model, false);
    canvas.hoverModel = { scale: annual, kind: 'field', field: model.field };
  }

  /* =========================================================================
   * 10. Visual 2 — dT per junction pair, with the null windows shaded.
   * ====================================================================== */

  /**
   * @description Column statistics for a fast-oscillating dT series — min, max and mean across one
   * pixel column, sampled hourly. This is what makes the shallow pair's daily swing legible at a
   * two-year zoom instead of an aliased smear.
   * @param pair - Prepared junction pair.
   * @param day0 - Column start, days.
   * @param day1 - Column end, days.
   * @returns `{ min, max, mean }` in K.
   */
  function deltaColumnStats(pair, day0, day1) {
    var n = Math.max(2, Math.min(48, Math.round((day1 - day0) * 24)));
    var min = Infinity; var max = -Infinity; var sum = 0;
    for (var i = 0; i < n; i += 1) {
      var t = (day0 + ((i + 0.5) / n) * (day1 - day0)) * DAY_S; var d = pair.hotSampler(t) - pair.coldSampler(t);
      if (d < min) min = d;
      if (d > max) max = d;
      sum += d;
    }
    return { min: min, max: max, mean: sum / n };
  }

  /**
   * @description Draw the dT story: two years of both pairs' dT with the annual pair's sub-cut-in
   * windows shaded, then a 14-day zoom underneath. The two-year panel shows the annual pair sweeping
   * through zero twice a year with the nulls lasting WEEKS; the zoom shows the shallow pair crossing
   * zero twice a DAY with nulls lasting hours. That non-coincidence is the entire design argument
   * for wiring two pairs into one converter.
   * @param canvas - Target canvas.
   * @param model - Full model.
   * @param pal - Palette.
   * @returns Nothing; draws and registers the hover model.
   */
  function drawDeltaT(canvas, model, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var peak = Math.max(model.peakPairStats.shallow.peakDeltaK, model.peakPairStats.deep.peakDeltaK, 1) * 1.12; var split = Math.round(f.h * 0.58);
    var deltaA = function (day) { return model.shallow.hotSampler(day * DAY_S) - model.shallow.coldSampler(day * DAY_S); };
    var deltaB = function (day) { return model.deep.hotSampler(day * DAY_S) - model.deep.coldSampler(day * DAY_S); };
    var top = makeScale({ l: 54, t: 10, w: f.w - 88, h: split - 46 }, 0, SPAN_DAYS, -peak, peak);
    drawFrame(f.ctx, top, pal, { xTicks: niceTicks(0, SPAN_DAYS, 8), yTicks: niceTicks(-peak, peak, 5), fmtX: fmtMonths, fmtY: fmt0, xTitle: 'months from 1 January, year 1', yTitle: 'dT across pair (K)' });
    drawWindows(f.ctx, top, model.nullWindows, pal.warning, 0.18, '◆ pair B below cut-in', pal);
    drawRule(f.ctx, top, pal, 0);
    drawEnvelope(f.ctx, top, pal.series[0], function (a, b) { return deltaColumnStats(model.shallow, a, b); });
    drawSeries(f.ctx, top, pal.series[1], deltaB);
    labelSeriesEnd(f.ctx, top, pal, pal.series[1], 'pair B', deltaB(SPAN_DAYS));
    labelSeriesEnd(f.ctx, top, pal, pal.series[0], 'pair A', deltaA(SPAN_DAYS));
    drawCursor(f.ctx, top, pal, model.state.cursorDay);
    var z0 = Math.max(0, Math.min(SPAN_DAYS - 14, model.state.cursorDay - 7));
    var bot = makeScale({ l: 54, t: split + 14, w: f.w - 88, h: f.h - split - 50 }, z0, z0 + 14, -peak, peak);
    drawFrame(f.ctx, bot, pal, { xTicks: niceTicks(z0, z0 + 14, 7), yTicks: niceTicks(-peak, peak, 4), fmtX: fmtDay, fmtY: fmt0, xTitle: '14-day zoom around the cursor — pair A nulls twice a day, pair B is flat here', yTitle: 'dT (K)' });
    drawRule(f.ctx, bot, pal, 0);
    drawSeries(f.ctx, bot, pal.series[0], deltaA);
    drawSeries(f.ctx, bot, pal.series[1], deltaB);
    drawCursor(f.ctx, bot, pal, model.state.cursorDay);
    canvas.hoverModel = { scale: top, kind: 'delta', model: model };
  }

  /* =========================================================================
   * 11. Visual 3 — state of charge, with the brownout region marked.
   * ====================================================================== */

  /**
   * @description Nearest retained sample's SoC for a day position. Nearest-sample rather than
   * interpolated, because the retained series is already a 6-hourly downsample of a 15-minute
   * integration — inventing intermediate values would imply a resolution the run does not have.
   * @param samples - Retained budget samples.
   * @param day - Day position.
   * @param span - Domain width the samples cover, days.
   * @returns SoC fraction 0..1.
   */
  function socAtDay(samples, day, span) {
    if (!samples.length) return 0;
    var i = Math.round((day / (span || SPAN_DAYS)) * (samples.length - 1));
    return samples[Math.max(0, Math.min(samples.length - 1, i))].socFraction;
  }

  /**
   * @description Collapse the per-sample brownout flags into contiguous day intervals for shading.
   * @param samples - Retained budget samples.
   * @returns `[{ startDay, endDay }]`, empty when the design never browned out.
   */
  function brownoutWindows(samples) {
    var out = [];
    var open = -1;
    for (var i = 0; i < samples.length; i += 1) {
      if (samples[i].brownout && open < 0) open = i;
      if (!samples[i].brownout && open >= 0) { out.push({ startDay: samples[open].tDays, endDay: samples[i].tDays }); open = -1; }
    }
    if (open >= 0) out.push({ startDay: samples[open].tDays, endDay: samples[samples.length - 1].tDays });
    return out;
  }

  /**
   * @description Draw the store level over the same two years, on the same x axis as the dT trace so
   * the reader can line the store's decline up with the shaded null it is riding through. TWO series:
   * the design as wired, and the annual pair alone as the counterfactual. The counterfactual is the
   * point of the chart — it flatlines on the depth-of-discharge floor through every equinox null, and
   * the critical band under it is the brownout the shallow pair is there to prevent.
   * @param canvas - Target canvas.
   * @param model - Full model.
   * @param pal - Palette.
   * @returns Nothing; draws and registers the hover model.
   */
  function drawSoc(canvas, model, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var sc = makeScale({ l: 54, t: 12, w: f.w - 126, h: f.h - 52 }, 0, SPAN_DAYS, 0, 100);
    drawFrame(f.ctx, sc, pal, { xTicks: niceTicks(0, SPAN_DAYS, 8), yTicks: [0, 20, 40, 60, 80, 100], fmtX: fmtMonths, fmtY: fmtPct, xTitle: 'months from 1 January, year 1', yTitle: 'state of charge' });
    drawWindows(f.ctx, sc, model.nullWindows, pal.warning, 0.14);
    var asWired = brownoutWindows(model.samples); var counter = brownoutWindows(model.counterfactual.samples);
    drawWindows(f.ctx, sc, counter, pal.critical, 0.16);
    drawWindows(f.ctx, sc, asWired, pal.critical, 0.34);
    drawRule(f.ctx, sc, pal, (1 - model.storage.usableDepthOfDischarge) * 100);
    f.ctx.save();
    f.ctx.font = '10px ' + FONT; f.ctx.fillStyle = pal.dim; f.ctx.textAlign = 'left'; f.ctx.textBaseline = 'bottom';
    f.ctx.fillText('depth-of-discharge floor', sc.rect.l + 6, sc.y((1 - model.storage.usableDepthOfDischarge) * 100) - 3); f.ctx.restore();
    if (model.state.wiring !== 'deep') {
      drawSeries(f.ctx, sc, pal.series[1], function (d) { return socAtDay(model.counterfactual.samples, d) * 100; });
      labelSeriesEnd(f.ctx, sc, pal, pal.series[1], 'annual alone', socAtDay(model.counterfactual.samples, SPAN_DAYS) * 100);
    }
    drawSeries(f.ctx, sc, pal.series[0], function (d) { return socAtDay(model.samples, d) * 100; });
    labelSeriesEnd(f.ctx, sc, pal, pal.series[0], 'as wired', socAtDay(model.samples, SPAN_DAYS) * 100);
    drawWindows(f.ctx, sc, asWired.length ? asWired : counter, pal.critical, 0, asWired.length ? '▲ brownout — as wired' : '▲ brownout — annual pair alone', pal);
    drawCursor(f.ctx, sc, pal, model.state.cursorDay);
    canvas.hoverModel = { scale: sc, kind: 'soc', model: model };
  }

  /* =========================================================================
   * 12. Visual 4 — the marine reference panel.
   * ====================================================================== */

  /**
   * @description Per-pixel-column min/max/mean flow speed, sampled every 6 minutes and MEMOISED on
   * the plot width. The 12.42 h carrier is far faster than a pixel column at a 30-day zoom, so the
   * envelope is the only honest rendering — but the marine domain does not depend on a single ground
   * control, so re-deriving it on every slider frame would be pure waste.
   * @param marine - Marine reference result, used as the cache owner.
   * @param sc - Scale whose pixel width keys the cache.
   * @returns Array of `{ min, max, mean }`, one per pixel column.
   */
  function marineEnvelope(marine, sc) {
    var width = Math.round(sc.rect.w);
    if (marine.envelopeWidth === width && marine.envelope) return marine.envelope;
    var cols = [];
    for (var px = 0; px <= width + 1; px += 1) {
      var day0 = sc.invX(sc.rect.l + px); var day1 = sc.invX(sc.rect.l + px + 1);
      var n = Math.max(4, Math.min(240, Math.round((day1 - day0) * 240)));
      var min = Infinity; var max = -Infinity; var sum = 0;
      for (var i = 0; i < n; i += 1) {
        var v = marine.speedAt((day0 + ((i + 0.5) / n) * (day1 - day0)) * DAY_S);
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      cols.push({ min: min, max: max, mean: sum / n });
    }
    marine.envelope = cols; marine.envelopeWidth = width;
    return cols;
  }

  /**
   * @description Draw the marine domain beside the ground one: 30 days of flow speed as a min/max
   * envelope — which is exactly the spring/neap beat, since the beat is an envelope on a 12.42 h
   * carrier — and the same node's store level underneath. Same chart grammar as the ground panels,
   * so the comparison is between the domains rather than between two chart styles.
   * @param canvas - Target canvas.
   * @param marine - Result of {@link computeMarine}.
   * @param pal - Palette.
   * @returns Nothing; draws and registers the hover model.
   */
  function drawMarine(canvas, marine, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var split = Math.round(f.h * 0.55); var peak = 1.4;
    var top = makeScale({ l: 54, t: 10, w: f.w - 88, h: split - 46 }, 0, 30, -peak, peak);
    drawFrame(f.ctx, top, pal, { xTicks: niceTicks(0, 30, 6), yTicks: niceTicks(-peak, peak, 5), fmtX: fmtDay, fmtY: fmt1, xTitle: 'days — one full spring/neap beat (≈ 14.77 d)', yTitle: 'flow speed (m/s)' });
    drawRule(f.ctx, top, pal, 0);
    var env = marineEnvelope(marine, top);
    drawEnvelope(f.ctx, top, pal.series[2], function (a, b, px) { return env[Math.min(env.length - 1, px)]; });
    labelSeriesEnd(f.ctx, top, pal, pal.series[2], 'flow', 0);
    var bot = makeScale({ l: 54, t: split + 14, w: f.w - 88, h: f.h - split - 50 }, 0, 30, 0, 100);
    drawFrame(f.ctx, bot, pal, { xTicks: niceTicks(0, 30, 6), yTicks: [0, 50, 100], fmtX: fmtDay, fmtY: fmtPct, xTitle: 'days', yTitle: 'state of charge' });
    drawWindows(f.ctx, bot, brownoutWindows(marine.samples), pal.critical, 0.30, '▲ brownout', pal);
    drawSeries(f.ctx, bot, pal.series[0], function (d) { return socAtDay(marine.samples, d, 30) * 100; });
    labelSeriesEnd(f.ctx, bot, pal, pal.series[0], 'store', socAtDay(marine.samples, 30, 30) * 100);
    canvas.hoverModel = { scale: top, kind: 'marine', marine: marine };
  }

  /* =========================================================================
   * 13. Visual 5 — the 2.5D cutaway of the buried node.
   * ====================================================================== */

  /**
   * @description Draw the buried node in cross-section with a live temperature gradient painted into
   * the soil column from the SAME field the heatmap uses, evaluated at the scrubbed instant. Nothing
   * here is decorative: the column's colour is T(z, cursor), the plate's drawn width is the square
   * root of the collector area against the slab's own metre scale, and every junction marker sits at
   * its control's depth.
   * @param canvas - Target canvas.
   * @param model - Full model.
   * @param pal - Palette.
   * @returns Nothing; draws in place.
   */
  function drawCutaway(canvas, model, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var maxDepth = Math.max(4, model.deep.coldM + 0.5);
    var side = f.w >= 96 + 120 + 46 + 18 + CAPTION_W;
    var box = { l: 96, t: 54, w: Math.max(80, Math.min(240, (f.w - 114 - CAPTION_W) / 1.34)), h: f.h - 92 - (side ? 0 : 96) };
    var geo = { box: box, skew: Math.min(46, box.w * 0.34), maxDepth: maxDepth, zToY: function (z) { return box.t + (z / maxDepth) * box.h; }, side: side };
    var half = Math.max(model.field.annualAmplitudeK(0) + model.field.diurnalAmplitudeK(0), 0.01);
    paintSoilSlab(f.ctx, model, pal, geo, half);
    drawNodeFurniture(f.ctx, model, pal, geo);
    drawCutawayScale(f.ctx, model, pal, geo, half);
  }

  /**
   * @description Paint the front and right faces of the soil slab as depth strips coloured by the
   * live field, then the isometric top face and the surface collector plate. The right face is the
   * same strip drawn through a vertical shear — that shear is the whole "2.5D" — then knocked back so
   * it reads as a face turned away from the light rather than a contradictory second scale.
   * @param ctx - 2D context.
   * @param model - Full model.
   * @param pal - Palette.
   * @param geo - `{ box, skew, maxDepth, zToY }`.
   * @param half - Colour half-range, K.
   * @returns Nothing; draws in place.
   */
  function paintSoilSlab(ctx, model, pal, geo, half) {
    var box = geo.box; var skew = geo.skew; var colors = []; var py;
    for (py = 0; py < box.h; py += 1) {
      colors.push(rampColor(pal.diverging, (model.field.rowSampler((py / box.h) * geo.maxDepth)(model.cursorSeconds) - model.field.meanC) / half));
    }
    for (py = 0; py < colors.length; py += 1) { ctx.fillStyle = colors[py]; ctx.fillRect(box.l, box.t + py, box.w, 1.02); }
    ctx.save();
    ctx.translate(box.l + box.w, 0); ctx.transform(1, -0.42, 0, 1, 0, 0);
    for (py = 0; py < colors.length; py += 1) { ctx.fillStyle = colors[py]; ctx.fillRect(0, box.t + py, skew, 1.02); }
    ctx.globalAlpha = 0.34; ctx.fillStyle = '#000'; ctx.fillRect(0, box.t, skew, box.h);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = pal.light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(box.l, box.t); ctx.lineTo(box.l + skew, box.t - skew * 0.42);
    ctx.lineTo(box.l + box.w + skew, box.t - skew * 0.42); ctx.lineTo(box.l + box.w, box.t);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = pal.axis; ctx.lineWidth = 1; ctx.stroke();
    var plateW = Math.max(14, Math.min(box.w, (Math.sqrt(model.state.collectorAreaM2) / 2) * box.w));
    var px = box.l + (box.w - plateW) / 2;
    ctx.fillStyle = pal.series[2]; ctx.beginPath();
    ctx.moveTo(px, box.t); ctx.lineTo(px + skew * 0.55, box.t - skew * 0.23);
    ctx.lineTo(px + plateW + skew * 0.55, box.t - skew * 0.23); ctx.lineTo(px + plateW, box.t);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = pal.dim; ctx.font = '10.5px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('surface plate — ' + model.state.collectorAreaM2.toFixed(2) + ' m²', box.l + box.w / 2, box.t - skew * 0.3 - 6);
    ctx.restore();
  }

  /**
   * @description Draw both TEG modules, all four junction markers and the store, each annotated with
   * the temperature or charge the model actually holds at the scrubbed instant.
   * @param ctx - 2D context.
   * @param model - Full model.
   * @param pal - Palette.
   * @param geo - `{ box, skew, maxDepth, zToY }`.
   * @returns Nothing; draws in place.
   */
  function drawNodeFurniture(ctx, model, pal, geo) {
    var t = model.cursorSeconds; var box = geo.box;
    var legs = [{ pair: model.shallow, color: pal.series[0], tag: 'A', x: box.l + box.w * 0.28 },
      { pair: model.deep, color: pal.series[1], tag: 'B', x: box.l + box.w * 0.68 }];
    ctx.save();
    ctx.font = '10px ' + FONT;
    for (var i = 0; i < legs.length; i += 1) {
      var g = legs[i]; var yHot = geo.zToY(g.pair.hotM); var yCold = geo.zToY(g.pair.coldM);
      ctx.strokeStyle = g.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(g.x, yHot); ctx.lineTo(g.x, yCold); ctx.stroke();
      drawJunctionDot(ctx, pal, g.x, yHot, g.color, g.tag + ' ' + g.pair.hotSampler(t).toFixed(1) + '°');
      drawJunctionDot(ctx, pal, g.x, yCold, g.color, g.tag + ' ' + g.pair.coldSampler(t).toFixed(1) + '°');
      ctx.fillStyle = g.color; ctx.fillRect(g.x - 9, (yHot + yCold) / 2 - 7, 18, 14);
      ctx.fillStyle = pal.light ? '#fff' : '#0b0b0b';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TEG', g.x, (yHot + yCold) / 2);
    }
    var soc = socAtDay(model.samples, model.state.cursorDay); var sx = box.l + 8; var sy = box.t + 12;
    ctx.fillStyle = pal.plot; ctx.fillRect(sx - 2, sy - 2, 44, 21);
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, sy + 0.5, 40, 17);
    ctx.fillStyle = soc <= (1 - model.storage.usableDepthOfDischarge) + 0.01 ? pal.critical : pal.series[0];
    ctx.fillRect(sx + 2, sy + 2, Math.max(1, 36 * Math.max(0, Math.min(1, soc))), 13);
    ctx.fillStyle = pal.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('store ' + Math.round(soc * 100) + '%', sx, sy + 21);
    ctx.restore();
  }

  /**
   * @description One junction: an 8px dot with a 2px surface ring so it stays legible wherever it
   * lands on the ramp, plus its live temperature on a surface-coloured chip.
   * @param ctx - 2D context.
   * @param pal - Palette.
   * @param x - Pixel x.
   * @param y - Pixel y.
   * @param color - Pair colour.
   * @param label - Text to the right.
   * @returns Nothing; draws in place.
   */
  function drawJunctionDot(ctx, pal, x, y, color, label) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = pal.plot; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = pal.plot;
    ctx.fillRect(x + 8, y - 7, ctx.measureText(label).width + 8, 14);
    ctx.fillStyle = pal.ink; ctx.fillText(label, x + 12, y);
  }

  /**
   * @description Depth ruler down the left of the cutaway plus the caption to its right. The ruler is
   * the axis the painted column would otherwise lack; the caption carries the instant and both pairs'
   * current dT, which is what makes the gradient readable rather than pretty.
   * @param ctx - 2D context.
   * @param model - Full model.
   * @param pal - Palette.
   * @param geo - `{ box, skew, maxDepth, zToY }`.
   * @param half - Colour half-range, K.
   * @returns Nothing; draws in place.
   */
  function drawCutawayScale(ctx, model, pal, geo, half) {
    var box = geo.box; var t = model.cursorSeconds;
    ctx.save();
    ctx.font = '10px ' + FONT; ctx.strokeStyle = pal.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(box.l - 10.5, box.t); ctx.lineTo(box.l - 10.5, box.t + box.h); ctx.stroke();
    var ticks = niceTicks(0, geo.maxDepth, 5);
    ctx.fillStyle = pal.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var i = 0; i < ticks.length; i += 1) {
      if (ticks[i] > geo.maxDepth) continue;
      var y = geo.zToY(ticks[i]);
      ctx.beginPath(); ctx.moveTo(box.l - 14, y + 0.5); ctx.lineTo(box.l - 10, y + 0.5); ctx.stroke();
      ctx.fillText(ticks[i].toFixed(1) + ' m', box.l - 18, y);
    }
    var lines = [
      'day ' + model.state.cursorDay + ', ' + (model.state.cursorHour < 10 ? '0' : '') + model.state.cursorHour + ':00',
      'pair A dT ' + (model.shallow.hotSampler(t) - model.shallow.coldSampler(t)).toFixed(2) + ' K',
      'pair B dT ' + (model.deep.hotSampler(t) - model.deep.coldSampler(t)).toFixed(2) + ' K',
      'harvest ' + (model.samplers.active(t) * 1e6).toFixed(0) + ' µW',
      'colour ±' + half.toFixed(1) + ' K about ' + model.field.meanC.toFixed(1) + ' °C'
    ];
    var capX = geo.side ? box.l + box.w + geo.skew + 18 : box.l - 10;
    var capY = geo.side ? box.t : box.t + box.h + 20;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (var j = 0; j < lines.length; j += 1) {
      ctx.fillStyle = j === 0 ? pal.ink : pal.dim;
      ctx.fillText(lines[j], capX, capY + j * 17);
    }
    ctx.restore();
  }

  /* =========================================================================
   * 14. Visual 6 — the impedance-match curve.
   * ====================================================================== */

  /**
   * @description Sweep module resistance against electrical power at the deep pair's peak dT. The
   * curve peaks exactly where R_teg == R_soil, which is the design lever this console exists to make
   * obvious: raw dT is the environment's to give, the match is the engineer's to choose.
   * @param canvas - Target canvas.
   * @param model - Full model.
   * @param pal - Palette.
   * @returns Nothing; draws in place.
   */
  function drawMatchCurve(canvas, model, pal) {
    var f = fitCanvas(canvas);
    if (!f) return;
    var rSoil = model.deep.rSoilKW; var peakK = model.peakPairStats.deep.peakDeltaK;
    var powerAt = function (rTeg) { return tegPowerW(model.field.meanC + peakK / 2, model.field.meanC - peakK / 2, rSoil, rTeg, model.state.ztBar, model.cfg.ratedW) * 1e6; };
    var xMax = Math.max(Math.min(rSoil * 4, 200), model.state.rTegKW * 1.4, 1); var yMax = powerAt(rSoil) * 1.18 || 1;
    var sc = makeScale({ l: 52, t: 12, w: f.w - 68, h: f.h - 50 }, 0, xMax, 0, yMax);
    drawFrame(f.ctx, sc, pal, { xTicks: niceTicks(0, xMax, 5), yTicks: niceTicks(0, yMax, 4), fmtX: fmt0, fmtY: fmt0, xTitle: 'module thermal resistance R_teg (K/W)', yTitle: 'power at peak dT (µW)' });
    drawSeries(f.ctx, sc, pal.series[1], powerAt);
    markPoint(f.ctx, sc, pal, rSoil, powerAt(rSoil), pal.series[2], 'matched R_teg = R_soil = ' + rSoil.toFixed(1));
    markPoint(f.ctx, sc, pal, model.state.rTegKW, powerAt(model.state.rTegKW), pal.series[0], 'your setting ' + model.state.rTegKW.toFixed(1));
  }

  /* =========================================================================
   * 15. Verdict, table view, legend and the hover layer.
   * ====================================================================== */

  /**
   * @description Format a power in watts as the unit a reader can hold — µW under a milliwatt,
   * mW under a watt, W above.
   * @param watts - Power, W.
   * @returns Formatted string with unit.
   */
  function fmtPower(watts) {
    var w = Math.abs(watts);
    if (w < 1e-3) return (watts * 1e6).toFixed(1) + ' µW';
    if (w < 1) return (watts * 1e3).toFixed(2) + ' mW';
    return watts.toFixed(2) + ' W';
  }

  /**
   * @description Format a duration in hours as the unit that makes the null story legible — hours
   * below two days, days and weeks above. The whole point of the equinox finding is that one number
   * is hours and the other is weeks, so the unit must not hide it.
   * @param hours - Duration, h.
   * @returns Formatted string with unit.
   */
  function fmtGap(hours) {
    if (!isFinite(hours)) return '—';
    if (hours < 48) return hours.toFixed(1) + ' h';
    return (hours / 24).toFixed(1) + ' d (' + (hours / 168).toFixed(1) + ' wk)';
  }

  /**
   * @description Set an element's text, tolerating an absent node so a trimmed page cannot throw.
   * @param id - Element id.
   * @param text - Text content.
   * @returns Nothing; writes into the DOM.
   */
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * @description Write the headline verdict — perpetual or not, the harvest margin, and the smallest
   * store that closes the design. The status is carried by an icon and a word as well as the colour,
   * because a colour alone is not an encoding.
   * @param model - Full model.
   * @returns Nothing; writes into the DOM.
   */
  function renderVerdict(model) {
    var v = model.verdict; var ok = v.perpetual;
    var el = document.getElementById('verdict');
    if (el) el.className = 'verdict summary-card ' + (ok ? 'is-good' : 'is-bad');
    setText('verdict-icon', ok ? '●' : '▲');
    setText('verdict-word', ok ? 'Perpetual' : 'Not perpetual');
    setText('verdict-note', ok
      ? 'Never browned out, and closed the two years no worse charged than it started.'
      : (v.brownoutHours > 0
        ? 'Browned out for ' + fmtGap(v.brownoutHours) + ' — the store cannot ride the annual null.'
        : 'Survived, but ended the run below its starting charge: it is draining, not closing.'));
    setText('kpi-margin', isFinite(v.marginRatio) ? v.marginRatio.toFixed(2) + '×' : '∞');
    setText('kpi-minstore', model.minStoreWh === null ? 'no size closes it' : model.minStoreWh.toFixed(3) + ' Wh');
    setText('kpi-minsoc', (v.minSocFraction * 100).toFixed(1) + '%'); setText('kpi-harvest', fmtPower(v.meanHarvestW));
    setText('kpi-gap', fmtGap(model.gaps.activeH));
  }

  /**
   * @description Build the table view — the WCAG-clean twin of every chart, and the relief channel
   * the light-mode palette's sub-3:1 series colours oblige. Every number a chart encodes in colour or
   * position is readable here as text. The server cross-check is appended only when
   * `/api/ocean-lab/harvest/simulate` answered with a shape this page recognises; the headline verdict stays
   * locally computed either way, so the page can never contradict itself.
   * @param model - Full model.
   * @param marine - Marine reference result.
   * @returns Nothing; writes into the DOM.
   */
  function renderTable(model, marine) {
    var f = model.field; var rows = [
      ['Annual damping depth d = sqrt(2α/ω)', f.annualDampingM.toFixed(3) + ' m'],
      ['Diurnal damping depth', f.diurnalDampingM.toFixed(4) + ' m'],
      ['Annual phase lag at the deep cold junction', f.annualLagDays(model.deep.coldM).toFixed(0) + ' d'],
      ['Annual amplitude at the deep cold junction', f.annualAmplitudeK(model.deep.coldM).toFixed(2) + ' K'],
      ['Geothermal rise across pair B (' + f.geothermalKPerM + ' K/m)', (f.geothermalKPerM * model.deep.separationM).toFixed(3) + ' K — negligible beside the wave'],
      ['Pair A separation / R_soil', model.shallow.separationM.toFixed(2) + ' m / ' + model.shallow.rSoilKW.toFixed(2) + ' K/W'],
      ['Pair B separation / R_soil', model.deep.separationM.toFixed(2) + ' m / ' + model.deep.rSoilKW.toFixed(2) + ' K/W'],
      ['Pair A peak |dT| / mean power', model.peakPairStats.shallow.peakDeltaK.toFixed(2) + ' K / ' + fmtPower(model.peakPairStats.shallow.meanPowerW)],
      ['Pair B peak |dT| / mean power', model.peakPairStats.deep.peakDeltaK.toFixed(2) + ' K / ' + fmtPower(model.peakPairStats.deep.meanPowerW)],
      ['Longest sub-cut-in gap — pair A only (diurnal)', fmtGap(model.gaps.shallowH)],
      ['Longest sub-cut-in gap — pair B only (annual)', fmtGap(model.gaps.deepH)],
      ['Longest sub-cut-in gap — both pairs wired together', fmtGap(model.gaps.dualH)],
      ['Mean harvest / mean draw', fmtPower(model.verdict.meanHarvestW) + ' / ' + fmtPower(model.verdict.meanDrawW)],
      ['Curtailed (store full or clamped)', model.verdict.curtailedWh.toFixed(4) + ' Wh'],
      ['Brownout total — as wired', fmtGap(model.verdict.brownoutHours)],
      ['Brownout total — annual pair alone', fmtGap(model.counterfactual.verdict.brownoutHours)],
      ['Marine reference — mean harvest / margin', fmtPower(marine.verdict.meanHarvestW) + ' / ' + marine.verdict.marginRatio.toFixed(2) + '×'],
      ['Marine reference — perpetual / deepest charge', (marine.verdict.perpetual ? 'yes' : 'no') + ' / ' + (marine.verdict.minSocFraction * 100).toFixed(1) + '%']
    ];
    if (SERVER.simulate) rows.push(['Server cross-check (/api/ocean-lab/harvest/simulate)', (SERVER.simulate.perpetual ? 'perpetual' : 'not perpetual') + (typeof SERVER.simulate.marginRatio === 'number' ? ' · margin ' + SERVER.simulate.marginRatio.toFixed(2) + '×' : '')]);
    var body = document.getElementById('table-body');
    if (!body) return;
    body.innerHTML = '';
    for (var i = 0; i < rows.length; i += 1) body.appendChild(tableRow(rows[i][0], rows[i][1]));
  }

  /**
   * @description Build one table row with a scoped row header, so the table stays navigable by
   * assistive tech rather than being a grid of anonymous cells.
   * @param label - Row header text.
   * @param value - Value text.
   * @returns The `<tr>` element.
   */
  function tableRow(label, value) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.setAttribute('scope', 'row'); th.textContent = label;
    var td = document.createElement('td');
    td.className = 'num'; td.textContent = value;
    tr.appendChild(th); tr.appendChild(td);
    return tr;
  }

  /**
   * @description Paint the legend swatches from the resolved palette. The legends are static markup
   * but their colours must come from the SAME palette the canvases use, or a theme flip would leave
   * the key disagreeing with the chart — which is worse than no key at all.
   * @param pal - Palette.
   * @returns Nothing; writes into the DOM.
   */
  function paintLegend(pal) {
    var swatches = document.querySelectorAll('[data-series]'); var i;
    for (i = 0; i < swatches.length; i += 1) {
      swatches[i].style.background = pal.series[Number(swatches[i].getAttribute('data-series')) % pal.series.length];
    }
    var states = document.querySelectorAll('[data-status]');
    for (i = 0; i < states.length; i += 1) {
      states[i].style.background = states[i].getAttribute('data-status') === 'critical' ? pal.critical : pal.warning;
    }
  }

  /**
   * @description Resolve the tooltip text for a chart kind at a domain position.
   * @param hm - The chart's hover model.
   * @param x - Domain x under the pointer.
   * @param y - Domain y under the pointer.
   * @returns One line of text.
   */
  function hoverText(hm, x, y) {
    var t = x * DAY_S;
    if (hm.kind === 'field') return 'day ' + x.toFixed(0) + ' · ' + y.toFixed(2) + ' m · ' + hm.field.tempAt(y, t).toFixed(2) + ' °C';
    if (hm.kind === 'soc') return 'day ' + x.toFixed(0) + ' · store ' + (socAtDay(hm.model.samples, x) * 100).toFixed(1) + '%';
    if (hm.kind === 'marine') return 'day ' + x.toFixed(1) + ' · flow ' + hm.marine.speedAt(t).toFixed(2) + ' m/s';
    if (hm.kind !== 'delta') return '';
    var m = hm.model;
    return 'day ' + x.toFixed(0) + ' · A ' + (m.shallow.hotSampler(t) - m.shallow.coldSampler(t)).toFixed(2) +
      ' K · B ' + (m.deep.hotSampler(t) - m.deep.coldSampler(t)).toFixed(2) + ' K · ' + fmtPower(m.samplers.active(t));
  }

  /**
   * @description Attach the hover layer to a chart canvas: a tooltip that reads the model at the
   * pointer. Tooltips enhance and never gate — every value here is also in the table view.
   * @param canvas - Chart canvas carrying a `hoverModel`.
   * @param tip - Shared tooltip element.
   * @returns Nothing; installs listeners.
   */
  function attachHover(canvas, tip) {
    canvas.addEventListener('mousemove', function (ev) {
      var hm = canvas.hoverModel;
      if (!hm) return;
      var rect = canvas.getBoundingClientRect();
      var px = ev.clientX - rect.left; var py = ev.clientY - rect.top; var r = hm.scale.rect;
      if (px < r.l || px > r.l + r.w || py < r.t || py > r.t + r.h) { tip.hidden = true; return; }
      tip.textContent = hoverText(hm, hm.scale.invX(px), hm.scale.invY(py));
      tip.hidden = false;
      tip.style.left = Math.round(ev.clientX + 14) + 'px'; tip.style.top = Math.round(ev.clientY + 14) + 'px';
    });
    canvas.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  /* =========================================================================
   * 16. Server bridge — optional, silent on failure.
   * ====================================================================== */

  /** @description Anything the server contributed. Absent keys simply mean the page ran on its own. */
  var SERVER = { sites: null, simulate: null };

  /**
   * @description Structured surface log. Browser surfaces have no Pino; this keeps the same shape —
   * a module tag and a context object — so a console capture is still greppable and no catch is silent.
   * @param message - What happened.
   * @param context - Structured context; never credentials.
   * @returns Nothing.
   */
  function surfaceWarn(message, context) {
    console.warn({ module: 'api:harvest-console', msg: message, ctx: context || {} });
  }

  /**
   * @description GET a JSON endpoint, resolving to null on any non-200, parse failure or network
   * error. The console is designed to work with `/api/ocean-lab/harvest` absent, so an outage must degrade to
   * "the local model" rather than to a broken page.
   * @param url - Absolute path to fetch.
   * @returns Promise of the parsed body, or null.
   */
  function getJson(url) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function (err) {
        surfaceWarn('harvest endpoint unavailable — falling back to the built-in model', { url: url, error: String(err) });
        return null;
      });
  }

  /**
   * @description Merge server-supplied sites into the catalogue. Every field is validated before it
   * is trusted: a malformed entry is dropped rather than allowed to produce a nonsense field.
   * @param payload - Whatever `/api/ocean-lab/harvest/sites` returned.
   * @returns Count of sites adopted.
   */
  function mergeServerSites(payload) {
    var list = payload && (Array.isArray(payload) ? payload : payload.sites);
    if (!Array.isArray(list)) return 0;
    var added = 0;
    for (var i = 0; i < list.length; i += 1) {
      var s = list[i];
      if (!s || typeof s.id !== 'string' || typeof s.meanC !== 'number' || typeof s.annualK !== 'number' || typeof s.diurnalK !== 'number') continue;
      SITES.push({
        id: s.id, label: (s.label || s.id) + ' (server)', meanC: s.meanC, annualK: s.annualK, diurnalK: s.diurnalK,
        annualPeakDay: typeof s.annualPeakDay === 'number' ? s.annualPeakDay : 200,
        diurnalPeakHour: typeof s.diurnalPeakHour === 'number' ? s.diurnalPeakHour : 15
      });
      added += 1;
    }
    return added;
  }

  /* =========================================================================
   * 17. Controls, render loop and boot.
   * ====================================================================== */

  /** @description Live control state, seeded from {@link DEFAULTS}. */
  var STATE = {};
  /** @description The most recent computed model, held for redraws that change nothing physical. */
  var MODEL = null;
  /** @description The marine reference run — independent of every ground control, so computed once. */
  var MARINE = null;
  /** @description Pending animation-frame handle, so a slider drag coalesces into one recompute. */
  var pending = 0;

  /** @description Select controls: `[elementId, stateKey, catalogue]`. */
  var PICKERS = [['c-site', 'siteId', SITES], ['c-soil', 'soilId', SOILS], ['c-wiring', 'wiring', WIRINGS]];

  /** @description Numeric controls: `[elementId, stateKey, unitSuffix, decimals]`. */
  var NUMBERS = [
    ['c-area', 'collectorAreaM2', ' m²', 2], ['c-rteg', 'rTegKW', ' K/W', 1],
    ['c-a-hot', 'shallowHotM', ' m', 2], ['c-a-cold', 'shallowColdM', ' m', 2],
    ['c-b-hot', 'deepHotM', ' m', 2], ['c-b-cold', 'deepColdM', ' m', 2],
    ['c-load', 'loadMw', ' mW', 3], ['c-cutin', 'cutInMw', ' mW', 3],
    ['c-cap', 'capacityWh', ' Wh', 2], ['c-day', 'cursorDay', '', 0], ['c-hour', 'cursorHour', ':00', 0]
  ];

  /**
   * @description Populate a `<select>` from a catalogue. Called again after the server answers, so a
   * server-supplied site appears without a reload.
   * @param id - Select element id.
   * @param list - Catalogue with `id` and `label`.
   * @param selected - Currently selected id.
   * @returns Nothing; writes into the DOM.
   */
  function fillSelect(id, list, selected) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < list.length; i += 1) {
      var opt = document.createElement('option');
      opt.value = list[i].id; opt.textContent = list[i].label;
      if (list[i].id === selected) opt.selected = true;
      el.appendChild(opt);
    }
  }

  /**
   * @description Read every control into {@link STATE} and echo its value, then clamp.
   *
   * Two guards, both load-bearing. An EMPTY input is ignored rather than read: `Number('')` is 0,
   * not NaN, so a cleared field would otherwise drive collector area, store capacity and every depth
   * to zero at once — which is not an error the page can show, it is a silent collapse to an
   * infinite soil resistance and a NaN state of charge. And the junction depths are ordered with a
   * minimum separation, because a zero separation is an infinite R_soil for the same reason.
   * @returns Nothing; mutates STATE.
   */
  function readControls() {
    var i, el;
    for (i = 0; i < PICKERS.length; i += 1) {
      el = document.getElementById(PICKERS[i][0]);
      if (el && el.value) STATE[PICKERS[i][1]] = el.value;
    }
    for (i = 0; i < NUMBERS.length; i += 1) {
      el = document.getElementById(NUMBERS[i][0]);
      if (!el) continue;
      var raw = String(el.value === undefined || el.value === null ? '' : el.value).trim();
      var v = Number(raw);
      if (raw !== '' && isFinite(v)) STATE[NUMBERS[i][1]] = v;
      var out = document.getElementById(NUMBERS[i][0] + '-out');
      if (out) out.textContent = STATE[NUMBERS[i][1]].toFixed(NUMBERS[i][3]) + NUMBERS[i][2];
    }
    STATE.collectorAreaM2 = Math.max(1e-3, STATE.collectorAreaM2);
    STATE.capacityWh = Math.max(1e-4, STATE.capacityWh);
    STATE.shallowColdM = Math.max(STATE.shallowHotM + 0.05, STATE.shallowColdM);
    STATE.deepColdM = Math.max(STATE.deepHotM + 0.1, STATE.deepColdM);
  }

  /**
   * @description Recompute the model and redraw every visual. One entry point, so a control change, a
   * theme flip and a resize all take exactly the same path and can never disagree.
   * @returns Nothing; redraws the page.
   */
  function render() {
    readControls();
    var pal = resolvePalette();
    MODEL = computeModel(STATE);
    if (!MARINE) MARINE = computeMarine();
    drawHeatmap(document.getElementById('cv-heatmap'), MODEL, pal);
    drawDeltaT(document.getElementById('cv-delta'), MODEL, pal);
    drawSoc(document.getElementById('cv-soc'), MODEL, pal);
    drawCutaway(document.getElementById('cv-cutaway'), MODEL, pal);
    drawMarine(document.getElementById('cv-marine'), MARINE, pal);
    drawMatchCurve(document.getElementById('cv-match'), MODEL, pal);
    paintLegend(pal);
    renderVerdict(MODEL);
    renderTable(MODEL, MARINE);
    setText('provenance', SERVER.sites || SERVER.simulate ? 'local model + server cross-check' : 'local model');
  }

  /**
   * @description Coalesce control churn into one recompute per frame. The model is on the order of a
   * million arithmetic steps; running it per input event would make a slider drag feel broken.
   * @returns Nothing; schedules a render.
   */
  function scheduleRender() {
    if (pending) return;
    pending = global.requestAnimationFrame(function () { pending = 0; render(); });
  }

  /**
   * @description Ask the server for its view of the current design, recording it only when the
   * response carries the field this page knows how to display.
   * @returns Nothing; updates SERVER and re-renders when something arrived.
   */
  function refreshServerSimulation() {
    var q = '?site=' + encodeURIComponent(STATE.siteId) + '&soil=' + encodeURIComponent(STATE.soilId) + '&areaM2=' + STATE.collectorAreaM2 + '&rTeg=' + STATE.rTegKW + '&loadMw=' + STATE.loadMw;
    getJson('/api/ocean-lab/harvest/simulate' + q).then(function (payload) {
      var v = payload && (payload.verdict || payload);
      SERVER.simulate = v && typeof v.perpetual === 'boolean' ? v : null;
      if (SERVER.simulate) render();
    });
  }

  /**
   * @description Set the module resistance to the deep pair's soil-path resistance — the maximum
   * power transfer point. Wired to a button because the match is the design lever the impedance
   * curve exists to teach, and reading it off the chart by hand is exactly the step people skip.
   * @returns Nothing; moves the slider and schedules a redraw.
   */
  function matchModuleToSoil() {
    var slider = document.getElementById('c-rteg');
    if (slider && MODEL) { slider.value = String(Math.round(MODEL.deep.rSoilKW * 10) / 10); scheduleRender(); }
  }

  /**
   * @description Wire every control, the theme observer and the resize handler, then draw once. The
   * first paint happens before any fetch resolves — that ordering is what makes the console usable
   * with `/api/ocean-lab/harvest` entirely absent.
   * @returns Nothing; boots the console.
   */
  function boot() {
    var k, i, el;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) STATE[k] = DEFAULTS[k];
    for (i = 0; i < PICKERS.length; i += 1) fillSelect(PICKERS[i][0], PICKERS[i][2], STATE[PICKERS[i][1]]);
    var ids = PICKERS.map(function (p) { return p[0]; }).concat(NUMBERS.map(function (n) { return n[0]; }));
    for (i = 0; i < ids.length; i += 1) {
      el = document.getElementById(ids[i]);
      if (el) { el.addEventListener('input', scheduleRender); el.addEventListener('change', scheduleRender); }
    }
    el = document.getElementById('c-match');
    if (el) el.addEventListener('click', matchModuleToSoil);
    var tip = document.getElementById('tooltip');
    var charts = ['cv-heatmap', 'cv-delta', 'cv-soc', 'cv-marine'];
    for (i = 0; i < charts.length; i += 1) {
      el = document.getElementById(charts[i]);
      if (el && tip) attachHover(el, tip);
    }
    global.addEventListener('resize', scheduleRender);
    new global.MutationObserver(scheduleRender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    render();
    getJson('/api/ocean-lab/harvest/sites').then(function (payload) {
      if (mergeServerSites(payload) > 0) { SERVER.sites = true; fillSelect('c-site', SITES, STATE.siteId); render(); }
    });
    refreshServerSimulation();
  }

  /**
   * @description The console's public surface. Exposed so a test can drive the physics without a
   * browser, and so the boot is explicit rather than an anonymous side effect.
   */
  var HarvestConsole = {
    ANNUAL_PERIOD_S: ANNUAL_PERIOD_S, DIURNAL_PERIOD_S: DIURNAL_PERIOD_S, DEFAULT_GEOTHERMAL_K_PER_M: DEFAULT_GEOTHERMAL_K_PER_M,
    SPAN_DAYS: SPAN_DAYS, SOILS: SOILS, SITES: SITES, WIRINGS: WIRINGS, DEFAULTS: DEFAULTS,
    dampingDepthM: dampingDepthM, createSoilField: createSoilField, soilResistanceKW: soilResistanceKW, tegPowerW: tegPowerW,
    preparePair: preparePair, pairStateAt: pairStateAt, makeHarvestSampler: makeHarvestSampler, longestGapHours: longestGapHours,
    simulateEnergyBudget: simulateEnergyBudget, recommendStorageWh: recommendStorageWh, currentSpeedAt: currentSpeedAt,
    turbinePowerW: turbinePowerW, computeModel: computeModel, computeMarine: computeMarine, boot: boot
  };

  global.HarvestConsole = HarvestConsole;
  if (typeof module === 'object' && module && module.exports) module.exports = HarvestConsole;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
}(typeof window !== 'undefined' ? window : globalThis));
