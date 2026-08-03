/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the authenticated /api/rotor surface, and the
 *                     |                             | LEGAL COMPOSITION POINT between two same-layer slices. BEMT
 *                     |                             | (@/features/rotor-design) and the tidal budget (@/features/marine)
 *                     |                             | may not import each other, so POST /harvest is where a SOLVED Cp
 *                     |                             | replaces the hand-typed powerCoefficient the marine TurbineConfig
 *                     |                             | has always carried — closing the loop from blade geometry to
 *                     |                             | "does this node run forever". Every numeric input is bounded
 *                     |                             | here rather than trusted: a BEMT sweep panels a section (a dense
 *                     |                             | O(n^3) solve) and bisects an inflow angle per element per
 *                     |                             | tip-speed ratio, all SYNCHRONOUSLY on the controller's only
 *                     |                             | thread, so an unbounded {stations, panelStations, elementCount,
 *                     |                             | lambdas} request is a one-call denial of service against the
 *                     |                             | whole swarm. The two DERIVED ceilings are the load-bearing ones:
 *                     |                             | per-field bounds alone still admit 64 stations at 200 panel
 *                     |                             | stations (5.1e8 panel work units, seconds of wall clock) and
 *                     |                             | 400 elements across 64 tip-speed ratios (25600 element solves).
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  BETZ_LIMIT,
  DEFAULT_SECTION_STATIONS,
  PITCH_AXIS_CHORD_FRACTION,
  bladeToMesh,
  cpCurve,
  nacaSection,
  sectionRingLength,
  solveBemt,
  type BemtOptions,
  type BemtResult,
  type BladeSpec,
  type BladeStation,
  type CpCurvePoint,
  type FlowCondition,
  type NacaSpec,
} from './engine/rotor-design';
import {
  SEAWATER_DENSITY_KGM3,
  simulatePowerBudget,
  type MarineUnitConfig,
  type TidalSiteConfig,
  type TurbineConfig,
} from './engine/marine';
import {
  toDxfR12,
  toObj,
  toOpenScad,
  toStlAscii,
  toStlBinary,
  validateMesh,
  type DxfSection,
  type MeshValidation,
  type Point2D,
  type TriMesh,
} from './engine/geometry';
import type { EnergyBudgetVerdict, PowerLoad, StorageConfig } from './engine/energy';
import { createChildLogger } from '@/shared/logger';
import {
  HARVEST_LIMITS,
  HarvestInputError,
  downsampleSamples,
  parseHarvestOptions,
  type ResolvedHarvestOptions,
} from './harvest-routes';
import { passthrough, serveSurfaceFile, surfaceFile } from './surface-files';

const logger = createChildLogger({ module: 'rotor-routes' });

/**
 * @description Every bound this route enforces, in one exported table so a guard can assert the
 * ceilings instead of re-deriving them and so the blade studio can pre-validate its form on the
 * SAME numbers the server rejects on. Four entries are shared verbatim with {@link HARVEST_LIMITS}
 * rather than restated: the site, load and store shapes POST /harvest accepts are the marine
 * shapes, and two independently-maintained copies of a bound is how a form and a server end up
 * disagreeing about what is admissible.
 *
 * `maxPanelWorkUnits` and `maxElementSolves` are DERIVED ceilings, and they are the ones that
 * actually protect the process — every per-field bound below can be satisfied simultaneously by a
 * request that still costs seconds of synchronous CPU.
 */
export const ROTOR_LIMITS = {
  /** Smallest tip radius, metres. Below this the lofted section rings weld into each other. */
  minTipRadiusM: 1e-3,
  /** Largest tip radius, metres — past any tidal rotor that has ever been built. */
  maxTipRadiusM: 100,
  /** Smallest station chord, metres (0.1 mm). A smaller chord lofts into a degenerate solid. */
  minChordM: 1e-4,
  /** Largest station chord, metres. */
  maxChordM: 50,
  /** Most blades on one rotor. */
  maxBladeCount: 24,
  /** Fewest design stations. {@link solveBemt} interpolates between stations and needs two. */
  minStations: 2,
  /** Most design stations. Also the upper bound on DISTINCT sections a request can panel. */
  maxStations: 64,
  /** Largest |twist| at a station, degrees. */
  maxTwistDeg: 180,
  /** Largest |collective pitch|, degrees. */
  maxPitchDeg: 90,
  /** Thinnest section, as a fraction of chord. A zero-thickness section has no panel geometry. */
  minThickness: 5e-3,
  /** Thickest section, as a fraction of chord. */
  maxThickness: 0.6,
  /** Largest section camber, as a fraction of chord. */
  maxCamber: 0.4,
  /** Fewest annular elements. */
  minElementCount: 1,
  /** Most annular elements. */
  maxElementCount: 400,
  /** Fewest chordwise panel stations — `cosineStations` needs at least three. */
  minPanelStations: 3,
  /** Most chordwise panel stations. The panel solve is dense and cubic in this. */
  maxPanelStations: 200,
  /** Most tip-speed ratios in one Cp(λ) sweep. */
  maxLambdas: 64,
  /** Largest tip-speed ratio. */
  maxLambda: 50,
  /** Slowest free-stream speed, m/s. `solveBemt` refuses a non-positive one outright. */
  minFreeStreamMs: 1e-6,
  /** Largest free-stream speed, m/s. */
  maxFreeStreamMs: 50,
  /** Largest rotational speed, rad/s. */
  maxRotationRadS: 20_000,
  /** Smallest fluid density, kg/m³ — it is the denominator of Cp. */
  minDensityKgM3: 1e-6,
  /** Largest fluid density, kg/m³. */
  maxDensityKgM3: 20_000,
  /** Smallest kinematic viscosity, m²/s — it is the denominator of section Reynolds. */
  minKinematicViscosityM2S: 1e-12,
  /** Largest kinematic viscosity, m²/s. */
  maxKinematicViscosityM2S: 1e-2,
  /** Hard ceiling on `elementCount · max(1, lambdaCount)` — the synchronous element-solve count. */
  maxElementSolves: 20_000,
  /** Hard ceiling on `stationCount · panelStations³` — the dense panel solves, one per section. */
  maxPanelWorkUnits: 3e8,
  /** Fewest chordwise points per surface in an export. */
  minSectionPoints: 3,
  /** Most chordwise points per surface in an export. */
  maxSectionPoints: 200,
  /**
   * Hard ceiling on the facets an export may emit. An ASCII STL runs ~200 bytes per facet, so this
   * is roughly an 8 MB response — deliberately above a full 64-station blade at the default section
   * resolution (20220 facets) and below the same blade at 160 points per surface (40700), because a
   * ceiling that refuses the default is a ceiling nobody can use.
   */
  maxExportTriangles: 40_000,
  /** Longest accepted name/label string. Shared with the harvest surface. */
  maxNameLength: HARVEST_LIMITS.maxNameLength,
  /** Longest load list accepted. Shared with the harvest surface. */
  maxLoads: HARVEST_LIMITS.maxLoads,
  /** Longest tidal constituent list accepted. Shared with the harvest surface. */
  maxConstituents: HARVEST_LIMITS.maxConstituents,
  /** Samples actually returned by POST /harvest. Shared with the harvest surface. */
  maxResponseSamples: HARVEST_LIMITS.maxResponseSamples,
} as const;

/**
 * @description Raised by the validators below and turned into a 400 by {@link rotorRoute}. A
 * distinct class rather than a sentinel return is what lets a validator eight frames deep reject
 * with a field-accurate dotted path without every caller in between forwarding a null.
 */
export class RotorInputError extends Error {
  /**
   * @description Builds the rejection carrying the operator-facing reason.
   * @param message - Which field failed and what was expected; surfaced verbatim in the 400 body.
   */
  constructor(message: string) {
    super(message);
    this.name = 'RotorInputError';
    Object.setPrototypeOf(this, RotorInputError.prototype);
  }
}

/**
 * @description Raised when the inputs were ADMISSIBLE but the solution they produced cannot be
 * used — a BEMT solve that did not converge on every element, or a rotor that extracts no net
 * power at the requested operating point. That is not a 400 (nothing the caller typed was out of
 * range) and it is emphatically not a 500 (nothing failed); it is a 422, and it exists so the
 * substitution in POST /harvest can refuse to feed a NaN or a negative Cp into the energy budget.
 */
export class RotorSolutionError extends Error {
  /**
   * @description Builds the rejection carrying the physical reason the solution is unusable.
   * @param message - What the solver produced and why it cannot be consumed.
   */
  constructor(message: string) {
    super(message);
    this.name = 'RotorSolutionError';
    Object.setPrototypeOf(this, RotorSolutionError.prototype);
  }
}

/**
 * @description Reject the request with a field-accurate reason.
 * @param message - Which field failed and what was expected.
 * @returns Never — always throws {@link RotorInputError}.
 */
function bad(message: string): never {
  throw new RotorInputError(message);
}

/**
 * @description Narrow an unknown to a plain object. Arrays are rejected explicitly: `typeof []` is
 * 'object', so without this an array would flow into the field readers and every lookup would
 * silently yield undefined instead of a named rejection.
 * @param value - The candidate.
 * @param label - Dotted path used in the rejection message.
 * @returns The value as a record.
 */
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(`${label} must be an object`);
  return value as Record<string, unknown>;
}

/**
 * @description Read a required, finite, in-range number. `Number.isFinite` is the load-bearing
 * check: JSON.parse turns `1e999` into Infinity, Infinity passes every `<`/`>` comparison a range
 * check can make, and an infinite chord makes the panel solve produce NaN for every element while
 * still "converging".
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns The validated number.
 */
function num(src: Record<string, unknown>, key: string, label: string, min: number, max: number): number {
  const raw = src[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) bad(`${label}.${key} must be a finite number`);
  const value = raw as number;
  if (value < min || value > max) bad(`${label}.${key} must be between ${min} and ${max}`);
  return value;
}

/**
 * @description Read an optional number. Absent stays absent — it is NOT coerced to zero, so the
 * slice's own documented default still applies.
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @param min - Inclusive lower bound when present.
 * @param max - Inclusive upper bound when present.
 * @returns The validated number, or undefined when the field was omitted or null.
 */
function optNum(src: Record<string, unknown>, key: string, label: string, min: number, max: number): number | undefined {
  const raw = src[key];
  if (raw === undefined || raw === null) return undefined;
  return num(src, key, label, min, max);
}

/**
 * @description Read an optional INTEGER count. Integrality is checked rather than rounded: a
 * discretisation of 47.5 elements is a typo, and silently accepting it would make two otherwise
 * identical requests disagree about the answer for a reason no reader could see.
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @param min - Inclusive lower bound when present.
 * @param max - Inclusive upper bound when present.
 * @returns The validated integer, or undefined when the field was omitted or null.
 */
function optInt(src: Record<string, unknown>, key: string, label: string, min: number, max: number): number | undefined {
  const value = optNum(src, key, label, min, max);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) bad(`${label}.${key} must be a whole number, received ${value}`);
  return value;
}

/**
 * @description Read an optional boolean. A string 'false' is rejected rather than coerced — the
 * physics switches turn drag and the tip loss OFF, and a truthy 'false' would silently return an
 * ideal-rotor Cp to a caller who asked for the real one.
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @returns The boolean, or undefined when the field was omitted or null.
 */
function optBool(src: Record<string, unknown>, key: string, label: string): boolean | undefined {
  const raw = src[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') bad(`${label}.${key} must be a boolean`);
  return raw as boolean;
}

/**
 * @description Read a required, length-bounded, non-blank string. Labels are echoed into exported
 * CAD files and into the verdict, so an unbounded one is a payload amplifier.
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @returns The trimmed string.
 */
function text(src: Record<string, unknown>, key: string, label: string): string {
  const raw = src[key];
  if (typeof raw !== 'string' || !raw.trim()) bad(`${label}.${key} must be a non-empty string`);
  const value = (raw as string).trim();
  if (value.length > ROTOR_LIMITS.maxNameLength) {
    bad(`${label}.${key} must be at most ${ROTOR_LIMITS.maxNameLength} characters`);
  }
  return value;
}

/**
 * @description Read a required array with both ends bounded. The lower bound matters as much as
 * the upper: a one-station blade passes every per-field check and then trips a slice precondition,
 * which would be a 500 on input a form can produce.
 * @param src - Object being validated.
 * @param key - Field name.
 * @param label - Dotted path of `src` for the message.
 * @param min - Fewest accepted entries.
 * @param max - Most accepted entries.
 * @returns The array.
 */
function list(src: Record<string, unknown>, key: string, label: string, min: number, max: number): unknown[] {
  const raw = src[key];
  if (!Array.isArray(raw)) bad(`${label}.${key} must be an array`);
  const values = raw as unknown[];
  if (values.length < min) bad(`${label}.${key} needs at least ${min} entries, received ${values.length}`);
  if (values.length > max) bad(`${label}.${key} must hold at most ${max} entries`);
  return values;
}

/**
 * @description Validate a NACA 4-digit section, stated as fractions.
 *
 * The camber-position rule is a CROSS-FIELD check and it mirrors {@link nacaCamber} exactly: a
 * genuinely cambered section divides by `camberPos²` and by `(1 − camberPos)²`, so 0 and 1 are
 * both poles and the slice throws a plain Error — i.e. a 500 — on them. A SYMMETRIC section never
 * reaches that code, so `camberPos` is unconstrained there rather than being rejected for a value
 * the physics never reads.
 * @param raw - The posted section.
 * @param at - Dotted path for messages.
 * @returns Validated section.
 */
function parseNacaSpec(raw: unknown, at: string): NacaSpec {
  const spec = asRecord(raw, at);
  const maxCamber = num(spec, 'maxCamber', at, -ROTOR_LIMITS.maxCamber, ROTOR_LIMITS.maxCamber);
  const camberPos = num(spec, 'camberPos', at, 0, 1);
  if (maxCamber !== 0 && !(camberPos > 0 && camberPos < 1)) {
    bad(`${at}.camberPos must be strictly inside (0, 1) for a cambered section (maxCamber ${maxCamber})`);
  }
  return {
    maxCamber,
    camberPos,
    thickness: num(spec, 'thickness', at, ROTOR_LIMITS.minThickness, ROTOR_LIMITS.maxThickness),
  };
}

/**
 * @description Validate one spanwise design station.
 * @param raw - The posted station.
 * @param at - Dotted path for messages.
 * @returns Validated station.
 */
function parseStation(raw: unknown, at: string): BladeStation {
  const station = asRecord(raw, at);
  return {
    radiusFrac: num(station, 'radiusFrac', at, 0, 1),
    chordM: num(station, 'chordM', at, ROTOR_LIMITS.minChordM, ROTOR_LIMITS.maxChordM),
    twistDeg: num(station, 'twistDeg', at, -ROTOR_LIMITS.maxTwistDeg, ROTOR_LIMITS.maxTwistDeg),
    section: parseNacaSpec(station.section, `${at}.section`),
  };
}

/**
 * @description Validate a full blade.
 *
 * The hub/tip relation is the cross-field check a per-field bound cannot make: `buildElements`
 * requires `0 < hubRadiusM < tipRadiusM` (the Prandtl hub factor is singular at the hub and the
 * element width would be negative or zero otherwise) and refuses with a plain Error, so a hub at
 * or outside the tip would be a 500 on two individually-legal numbers. A hub of exactly zero is
 * the shape a form reaches by leaving the field blank, which is why it is named here.
 * @param raw - The posted `blade`.
 * @returns Validated blade.
 */
function parseBlade(raw: unknown): BladeSpec {
  const blade = asRecord(raw, 'blade');
  const tipRadiusM = num(blade, 'tipRadiusM', 'blade', ROTOR_LIMITS.minTipRadiusM, ROTOR_LIMITS.maxTipRadiusM);
  const hubRadiusM = num(blade, 'hubRadiusM', 'blade', 0, ROTOR_LIMITS.maxTipRadiusM);
  if (!(hubRadiusM > 0 && hubRadiusM < tipRadiusM)) {
    bad(`blade.hubRadiusM must satisfy 0 < hubRadiusM < tipRadiusM (${hubRadiusM} against ${tipRadiusM})`);
  }
  const bladeCount = num(blade, 'bladeCount', 'blade', 1, ROTOR_LIMITS.maxBladeCount);
  if (!Number.isInteger(bladeCount)) bad(`blade.bladeCount must be a whole number, received ${bladeCount}`);
  const stations = list(blade, 'stations', 'blade', ROTOR_LIMITS.minStations, ROTOR_LIMITS.maxStations).map(
    (entry, i) => parseStation(entry, `blade.stations[${i}]`),
  );
  return {
    tipRadiusM,
    hubRadiusM,
    bladeCount,
    stations,
    pitchDeg: num(blade, 'pitchDeg', 'blade', -ROTOR_LIMITS.maxPitchDeg, ROTOR_LIMITS.maxPitchDeg),
  };
}

/**
 * @description Validate the inflow. Three of these floors are slice PRECONDITIONS rather than
 * taste: `solveBemt` refuses a non-positive free stream, `sectionReynolds` refuses a non-positive
 * viscosity, and Cp divides by the density — each throws a plain Error, so a zero here without a
 * named bound is a 500 on a field a form can leave at its default.
 * @param raw - The posted `flow`.
 * @returns Validated flow condition.
 */
function parseFlow(raw: unknown): FlowCondition {
  const flow = asRecord(raw, 'flow');
  return {
    freeStreamMs: num(flow, 'freeStreamMs', 'flow', ROTOR_LIMITS.minFreeStreamMs, ROTOR_LIMITS.maxFreeStreamMs),
    rotationRadS: num(flow, 'rotationRadS', 'flow', 0, ROTOR_LIMITS.maxRotationRadS),
    densityKgM3: num(flow, 'densityKgM3', 'flow', ROTOR_LIMITS.minDensityKgM3, ROTOR_LIMITS.maxDensityKgM3),
    kinematicViscosityM2S: num(
      flow,
      'kinematicViscosityM2S',
      'flow',
      ROTOR_LIMITS.minKinematicViscosityM2S,
      ROTOR_LIMITS.maxKinematicViscosityM2S,
    ),
  };
}

/** @description BEMT discretisation with both count fields resolved to concrete numbers. */
export interface ResolvedBemtOptions extends BemtOptions {
  /** Annular elements per solve. */
  elementCount: number;
  /** Chordwise panel stations per surface. */
  panelStations: number;
}

/**
 * @description Validate the BEMT switches and — the part that actually protects the controller —
 * reject the COMBINATIONS that are expensive even though each field is individually in range.
 *
 * Two derived ceilings, each mirroring where the solver really spends time:
 *
 * 1. `stationCount · panelStations³`. The inviscid lift line is panelled ONCE per distinct section
 *    and memoised, so a sweep pays the dense O(n³) Gaussian elimination once per section — but a
 *    blade may name a different section at every station, so the station count is the honest upper
 *    bound on how many of those solves a request buys. Measured: 13 stations at 240 panel stations
 *    is 1.8e8 units and 731 ms, so the 3e8 ceiling is roughly a 1.2 s worst case.
 * 2. `elementCount · lambdaCount`. Each element bisects the inflow angle up to 200 times inside an
 *    outer Reynolds loop, and a Cp(λ) sweep repeats the whole thing per tip-speed ratio. Measured
 *    at ~0.1 ms per element solve, so the 20000 ceiling is roughly a 2 s worst case.
 *
 * Neither is reachable by bounding the fields independently: 64 stations at 200 panel stations and
 * 400 elements across 64 tip-speed ratios satisfies every per-field bound above.
 * @param raw - The posted `options`, or undefined.
 * @param stationCount - Design stations on the blade; the upper bound on distinct panel solves.
 * @param solveCount - How many full-rotor solves this request will run (1 for a single solve).
 * @returns Fully resolved options.
 */
export function parseBemtOptions(raw: unknown, stationCount: number, solveCount: number): ResolvedBemtOptions {
  const opts = raw === undefined || raw === null ? {} : asRecord(raw, 'options');
  const elementCount =
    optInt(opts, 'elementCount', 'options', ROTOR_LIMITS.minElementCount, ROTOR_LIMITS.maxElementCount) ?? 48;
  const panelStations =
    optInt(opts, 'panelStations', 'options', ROTOR_LIMITS.minPanelStations, ROTOR_LIMITS.maxPanelStations) ??
    DEFAULT_SECTION_STATIONS;

  const panelWork = stationCount * panelStations ** 3;
  if (panelWork > ROTOR_LIMITS.maxPanelWorkUnits) {
    bad(
      `options.panelStations against ${stationCount} stations asks for ${panelWork} panel work units; the cap ` +
        `is ${ROTOR_LIMITS.maxPanelWorkUnits} — lower panelStations or use fewer stations`,
    );
  }
  const elementSolves = elementCount * Math.max(1, solveCount);
  if (elementSolves > ROTOR_LIMITS.maxElementSolves) {
    bad(
      `options.elementCount across ${solveCount} solve(s) asks for ${elementSolves} element solves; the cap is ` +
        `${ROTOR_LIMITS.maxElementSolves} — lower elementCount or sweep fewer tip-speed ratios`,
    );
  }
  return {
    elementCount,
    panelStations,
    dragEnabled: optBool(opts, 'dragEnabled', 'options'),
    tipLossEnabled: optBool(opts, 'tipLossEnabled', 'options'),
    hubLossEnabled: optBool(opts, 'hubLossEnabled', 'options'),
  };
}

/**
 * @description Validate the tip-speed ratios of a Cp(λ) sweep. The positive floor is a slice
 * precondition — {@link cpCurve} derives the rotational speed as `λ V / R` and refuses a
 * non-positive λ with a plain Error.
 * @param raw - The posted `body`.
 * @returns Validated tip-speed ratios, in the order given.
 */
function parseLambdas(raw: Record<string, unknown>): number[] {
  return list(raw, 'lambdas', 'body', 1, ROTOR_LIMITS.maxLambdas).map((entry, i) => {
    const at = `body.lambdas[${i}]`;
    if (typeof entry !== 'number' || !Number.isFinite(entry)) bad(`${at} must be a finite number`);
    const lambda = entry as number;
    if (!(lambda > 0) || lambda > ROTOR_LIMITS.maxLambda) {
      bad(`${at} must be greater than 0 and at most ${ROTOR_LIMITS.maxLambda}, received ${lambda}`);
    }
    return lambda;
  });
}

/**
 * @description Validate the load set of the harvest leg. Bounds are read from
 * {@link ROTOR_LIMITS}, whose entry is {@link HARVEST_LIMITS}' own, so the two surfaces cannot
 * drift apart on what a load may be.
 * @param src - The posted body.
 * @returns Validated loads.
 */
function parseLoads(src: Record<string, unknown>): PowerLoad[] {
  return list(src, 'loads', 'body', 1, ROTOR_LIMITS.maxLoads).map((raw, i) => {
    const at = `body.loads[${i}]`;
    const load = asRecord(raw, at);
    return {
      name: text(load, 'name', at),
      watts: num(load, 'watts', at, 0, 1e6),
      dutyCycle: num(load, 'dutyCycle', at, 0, 1),
    };
  });
}

/**
 * @description Validate the energy store of the harvest leg. `capacityWh` has a positive floor
 * because it is the denominator of every state-of-charge fraction in the verdict — a zero capacity
 * reports NaN perpetuality rather than failing.
 * @param src - The posted body.
 * @returns Validated store.
 */
function parseStorage(src: Record<string, unknown>): StorageConfig {
  const at = 'body.storage';
  const storage = asRecord(src.storage, at);
  return {
    capacityWh: num(storage, 'capacityWh', at, 0.001, 1e9),
    initialSocFraction: num(storage, 'initialSocFraction', at, 0, 1),
    roundTripEfficiency: num(storage, 'roundTripEfficiency', at, 0.01, 1),
    usableDepthOfDischarge: num(storage, 'usableDepthOfDischarge', at, 0.01, 1),
  };
}

/**
 * @description Validate the tidal site of the harvest leg: its harmonic constituents plus any
 * steady residual flow.
 * @param raw - The posted `site`.
 * @returns Validated site.
 */
function parseTidalSite(raw: unknown): TidalSiteConfig {
  const site = asRecord(raw, 'body.site');
  const constituents = list(site, 'constituents', 'body.site', 1, ROTOR_LIMITS.maxConstituents).map((entry, i) => {
    const at = `body.site.constituents[${i}]`;
    const c = asRecord(entry, at);
    return {
      name: text(c, 'name', at),
      periodHours: num(c, 'periodHours', at, 0.01, 2_000),
      amplitudeMs: num(c, 'amplitudeMs', at, 0, 50),
      phaseDeg: optNum(c, 'phaseDeg', at, -3_600, 3_600) ?? 0,
    };
  });
  return {
    name: text(site, 'name', 'body.site'),
    constituents,
    residualMs: optNum(site, 'residualMs', 'body.site', -50, 50),
  };
}

/**
 * @description Everything about the substituted turbine that BEMT does NOT know. A rotor solve
 * produces SHAFT power; it says nothing about the generator behind the shaft, the speed below
 * which the bearings win, or the electrical clamp. So each default here is deliberately the
 * IDENTITY of the term rather than a plausible-looking number: with no drivetrain named the
 * verdict is the undiluted rotor, which is honest, whereas an invented 0.8 would silently move
 * every answer by 20 % for a reason no reader could trace.
 */
const UNDILUTED_DRIVETRAIN = {
  /** No generator/rectifier/MPPT loss modelled. */
  efficiency: 1,
  /** No cut-in imposed — a BEMT solve at one operating point cannot infer one. */
  cutInSpeedMs: 0,
  /**
   * Non-binding electrical clamp, W. `turbinePowerW` clamps at this, so the sentinel has to be
   * finite; 1 GW is nine orders of magnitude above any node this surface describes, i.e. it never
   * binds. Pass a real rating to see curtailment.
   */
  ratedPowerW: 1e9,
} as const;

/**
 * @description Validate the optional drivetrain block of the harvest leg.
 * @param raw - The posted `drivetrain`, or undefined.
 * @returns Efficiency, cut-in speed and rating, defaulted to {@link UNDILUTED_DRIVETRAIN}.
 */
function parseDrivetrain(raw: unknown): { efficiency: number; cutInSpeedMs: number; ratedPowerW: number } {
  const src = raw === undefined || raw === null ? {} : asRecord(raw, 'body.drivetrain');
  return {
    efficiency: optNum(src, 'efficiency', 'body.drivetrain', 0, 1) ?? UNDILUTED_DRIVETRAIN.efficiency,
    cutInSpeedMs: optNum(src, 'cutInSpeedMs', 'body.drivetrain', 0, 50) ?? UNDILUTED_DRIVETRAIN.cutInSpeedMs,
    ratedPowerW: optNum(src, 'ratedPowerW', 'body.drivetrain', 0, 1e9) ?? UNDILUTED_DRIVETRAIN.ratedPowerW,
  };
}

/** @description The CAD/print formats POST /export can emit. */
export type RotorExportFormat = 'stl' | 'stl-binary' | 'obj' | 'scad' | 'dxf';

/** @description Every accepted `format` value, in the order the rejection message lists them. */
export const ROTOR_EXPORT_FORMATS: ReadonlyArray<RotorExportFormat> = ['stl', 'stl-binary', 'obj', 'scad', 'dxf'];

/** @description One rendered export, described well enough for a browser to save it unaided. */
export interface RotorExportPayload {
  /** The format emitted. */
  format: RotorExportFormat;
  /** Suggested download name. */
  filename: string;
  /** MIME type for the payload. */
  contentType: string;
  /** How `payload` is encoded — binary STL is base64, everything else is text. */
  encoding: 'utf8' | 'base64';
  /** The file itself. */
  payload: string;
  /** Decoded size in bytes, so a client can show it before decoding. */
  byteLength: number;
}

/**
 * @description Facet and point counts an export WOULD produce, computed from the geometry alone so
 * the ceiling can be enforced before anything is built. The loft is one ring per station plus two
 * fan caps, which is where these two closed forms come from — see `loftSections`.
 * @param stationCount - Design stations, i.e. rings in the loft.
 * @param sectionPoints - Chordwise points per surface.
 * @returns Ring length, total outline points and total facets.
 */
function estimateExportSize(
  stationCount: number,
  sectionPoints: number,
): { ringLength: number; points: number; triangles: number } {
  const ringLength = sectionRingLength(sectionPoints);
  return {
    ringLength,
    points: stationCount * ringLength,
    triangles: (stationCount - 1) * ringLength * 2 + 2 * (ringLength - 2),
  };
}

/**
 * @description Project each design station into its own 2-D outline for a DXF drawing: scaled by
 * chord and rotated by minus its total blade angle about the pitch axis — the SAME mapping
 * {@link bladeToMesh} applies, so the drawing and the solid describe one blade rather than two.
 * @param blade - The validated blade.
 * @param sectionPoints - Chordwise points per surface.
 * @returns One named, elevated profile per station, hub to tip.
 */
function bladeToDxfSections(blade: BladeSpec, sectionPoints: number): DxfSection[] {
  const sorted = [...blade.stations].sort((a, b) => a.radiusFrac - b.radiusFrac);
  return sorted.map((station, index) => {
    const angleRad = -((station.twistDeg + blade.pitchDeg) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const points: Point2D[] = nacaSection(station.section, sectionPoints).points.map((p) => {
      const x = (p.x - PITCH_AXIS_CHORD_FRACTION) * station.chordM;
      const y = p.y * station.chordM;
      return { x: x * cos - y * sin, y: x * sin + y * cos };
    });
    return {
      name: `station_${index}_r${station.radiusFrac.toFixed(3)}`,
      points,
      elevation: station.radiusFrac * blade.tipRadiusM,
      closed: true,
    };
  });
}

/**
 * @description Render the four mesh-based formats from an already-lofted solid.
 * @param mesh - The lofted blade.
 * @param format - One of stl / stl-binary / obj / scad.
 * @param name - Solid name; every exporter sanitises it to its own character set.
 * @param parameters - Design inputs emitted as an editable header by the OpenSCAD export.
 * @returns The rendered payload.
 */
function renderMeshExport(
  mesh: TriMesh,
  format: Exclude<RotorExportFormat, 'dxf'>,
  name: string,
  parameters: Record<string, number>,
): RotorExportPayload {
  if (format === 'stl-binary') {
    const bytes = toStlBinary(mesh);
    return {
      format,
      filename: `${name}.stl`,
      contentType: 'model/stl',
      encoding: 'base64',
      payload: Buffer.from(bytes).toString('base64'),
      byteLength: bytes.byteLength,
    };
  }
  const rendered =
    format === 'stl' ? toStlAscii(mesh, name) : format === 'obj' ? toObj(mesh, name) : toOpenScad(mesh, { name, parameters });
  const extension = format === 'stl' ? 'stl' : format === 'obj' ? 'obj' : 'scad';
  const contentType = format === 'stl' ? 'model/stl' : format === 'obj' ? 'model/obj' : 'text/plain';
  return {
    format,
    filename: `${name}.${extension}`,
    contentType,
    encoding: 'utf8',
    payload: rendered,
    byteLength: Buffer.byteLength(rendered, 'utf8'),
  };
}

/**
 * @description The design inputs the OpenSCAD export carries as an editable header. Only derived
 * scalars — never a caller-supplied string — so nothing the caller typed lands in the file
 * unescaped beyond the single sanitised solid name.
 * @param blade - The validated blade.
 * @returns Named numeric parameters.
 */
function scadParameters(blade: BladeSpec): Record<string, number> {
  return {
    tip_radius_m: blade.tipRadiusM,
    hub_radius_m: blade.hubRadiusM,
    blade_count: blade.bladeCount,
    pitch_deg: blade.pitchDeg,
    station_count: blade.stations.length,
  };
}

/** @description What POST /export answers with: the file, plus what was actually built. */
interface RotorExportResponse extends RotorExportPayload {
  /** Mesh statistics and the printability verdict — absent for the 2-D DXF drawing. */
  mesh: { vertices: number; triangles: number; validation: MeshValidation } | null;
}

/**
 * @description Loft (or draw) the blade and render it in the requested format, refusing anything
 * past the facet ceiling BEFORE building it — the check is on the closed-form estimate precisely
 * so that a 40-million-facet request costs a comparison rather than the memory.
 * @param blade - The validated blade.
 * @param format - Requested format.
 * @param sectionPoints - Chordwise points per surface.
 * @param name - Solid/file name.
 * @returns The rendered file plus the mesh verdict where one applies.
 */
function renderExport(
  blade: BladeSpec,
  format: RotorExportFormat,
  sectionPoints: number,
  name: string,
): RotorExportResponse {
  const size = estimateExportSize(blade.stations.length, sectionPoints);
  if (size.triangles > ROTOR_LIMITS.maxExportTriangles) {
    bad(
      `body.sectionPoints against ${blade.stations.length} stations would emit ${size.triangles} facets; the cap ` +
        `is ${ROTOR_LIMITS.maxExportTriangles} — lower sectionPoints or use fewer stations`,
    );
  }
  if (format === 'dxf') {
    const drawing = toDxfR12(bladeToDxfSections(blade, sectionPoints));
    return {
      format,
      filename: `${name}.dxf`,
      contentType: 'image/vnd.dxf',
      encoding: 'utf8',
      payload: drawing,
      byteLength: Buffer.byteLength(drawing, 'utf8'),
      mesh: null,
    };
  }
  const mesh = bladeToMesh(blade, sectionPoints);
  return {
    ...renderMeshExport(mesh, format, name, scadParameters(blade)),
    mesh: {
      vertices: mesh.vertices.length,
      triangles: mesh.triangles.length,
      validation: validateMesh(mesh),
    },
  };
}

/**
 * @description Refuse a BEMT result that cannot be substituted into an energy budget.
 *
 * Three distinct failures, each of which would otherwise poison the budget silently: a solve that
 * did not converge on every element contributes ZERO from the failed ones, so its Cp reads as a
 * rotor that lost its inboard third; a non-positive Cp is the propeller-brake branch, where the
 * rotor is absorbing shaft power rather than producing it (a real state — the reference rotor hits
 * Cp = −0.44 at λ = 12 — and one the cube law would render as a NEGATIVE harvest); and a Cp above
 * 1 cannot come from a converged solve at all.
 *
 * Cp above the BETZ limit is deliberately NOT refused here. The limit is real, but this surface
 * exists so an operator can SEE that an above-Betz coefficient is what made a design "work" — the
 * same decision the harvest route already documents for its hand-typed `powerCoefficient` — so it
 * is flagged in the response and logged, never clamped.
 * @param bemt - The solve to check.
 * @returns Nothing; throws {@link RotorSolutionError} when the result is unusable.
 */
function assertUsableForBudget(bemt: BemtResult): void {
  if (!bemt.allConverged) {
    throw new RotorSolutionError(
      'the BEMT solve did not converge on every element, so its Cp is an integral over a partly missing ' +
        'rotor — change the operating point or the discretisation rather than consuming this number',
    );
  }
  if (!(bemt.cp > 0)) {
    throw new RotorSolutionError(
      `the rotor extracts no net power at this operating point (Cp ${bemt.cp}) — it is being driven, not ` +
        'driving. Lower the tip-speed ratio or re-pitch the blade',
    );
  }
  if (bemt.cp > 1) {
    throw new RotorSolutionError(`solved Cp ${bemt.cp} exceeds 1, which no converged solve can produce`);
  }
}

/**
 * @description Turn a solved rotor into the marine slice's turbine model.
 *
 * `sweptAreaM2` is π·R² because that is EXACTLY the reference area `BemtResult.cp` is normalised
 * by — pick any other area and `turbinePowerW`'s ½ρA|v|³·Cp stops reproducing the shaft power the
 * solver reported. Everything else comes from the drivetrain block, whose defaults are identities.
 * @param blade - The solved blade.
 * @param bemt - Its converged solve.
 * @param drivetrain - Efficiency, cut-in and rating.
 * @returns The substituted turbine.
 */
function turbineFromSolve(
  blade: BladeSpec,
  bemt: BemtResult,
  drivetrain: { efficiency: number; cutInSpeedMs: number; ratedPowerW: number },
): TurbineConfig {
  return {
    sweptAreaM2: Math.PI * blade.tipRadiusM ** 2,
    powerCoefficient: bemt.cp,
    drivetrainEfficiency: drivetrain.efficiency,
    cutInSpeedMs: drivetrain.cutInSpeedMs,
    ratedPowerW: drivetrain.ratedPowerW,
  };
}

/**
 * @description What POST /harvest answers with — both halves of the composition, never just the
 * verdict. A reader has to be able to see WHICH Cp produced it, or the substitution is unfalsifiable.
 */
export interface RotorHarvestResponse {
  /** The full BEMT solve whose Cp was substituted. */
  bemt: BemtResult;
  /** The marine turbine built from that solve — `powerCoefficient` is `bemt.cp`, not a typed-in number. */
  turbine: TurbineConfig;
  /** 16/27. Reported so a caller does not hard-code it to check the next field. */
  betzLimit: number;
  /** True when the solved Cp is above Betz. Flagged, never clamped — see {@link assertUsableForBudget}. */
  aboveBetzLimit: boolean;
  /** Span/step/sampling the budget actually ran with. */
  options: ResolvedHarvestOptions;
  /** The energy verdict. */
  verdict: EnergyBudgetVerdict;
  /** The retained series, strided down to the wire cap. */
  samples: unknown[];
  /** How many samples the run retained before striding. */
  retainedSampleCount: number;
  /** The modelling assumption the substitution rests on, stated in the payload rather than only in a doc. */
  note: string;
}

/**
 * @description The one assumption a constant substituted Cp encodes, carried in the response so it
 * travels with the number instead of living only in this file.
 */
const CONSTANT_CP_NOTE =
  'Cp is solved once, at the posted flow, and then held constant across the tide — which assumes the ' +
  'rotor is held at that tip-speed ratio by its controller as the current varies. That is the same ' +
  'assumption a hand-typed powerCoefficient already made; the difference is that this one came from a ' +
  'blade. Sweep POST /cp-curve to see how much Cp actually moves off the design point.';

/**
 * @description Reject a harvest request whose rotor was solved in a different fluid from the one
 * the budget integrates in. `turbinePowerW` hard-codes {@link SEAWATER_DENSITY_KGM3}, so a Cp
 * solved in fresh water or in air would be re-applied at 1025 kg/m³ and the verdict would describe
 * a rotor nobody solved. The two numbers are the same physical quantity and must agree.
 * @param flow - The validated flow condition.
 * @returns Nothing; throws {@link RotorInputError} on a mismatch.
 */
function assertMarineDensity(flow: FlowCondition): void {
  if (Math.abs(flow.densityKgM3 - SEAWATER_DENSITY_KGM3) > 1e-6) {
    bad(
      `flow.densityKgM3 must be the marine budget's own seawater density ${SEAWATER_DENSITY_KGM3} kg/m³ ` +
        `(received ${flow.densityKgM3}) — turbinePowerW re-applies the solved Cp at that density, so solving ` +
        'the rotor in another fluid would produce a verdict for a rotor nobody solved',
    );
  }
}

/**
 * @description POST /solve { blade, flow, options? } — one full BEMT solution.
 * @param req - Express request carrying the posted rotor.
 * @param res - Express response.
 * @returns Nothing; responds with the solve, or throws {@link RotorInputError}.
 */
function handleSolve(req: Request, res: Response): void {
  const body = asRecord(req.body, 'body');
  const blade = parseBlade(body.blade);
  const flow = parseFlow(body.flow);
  // Options FIRST among the expensive decisions: the cost ceilings are what stop a costly run, so
  // they clear before any solve is entered.
  const options = parseBemtOptions(body.options, blade.stations.length, 1);
  const bemt = solveBemt(blade, flow, options);
  if (bemt.cp > BETZ_LIMIT) {
    logger.warn({ cp: bemt.cp, betzLimit: BETZ_LIMIT, tipSpeedRatio: bemt.tipSpeedRatio }, 'BEMT solved a Cp above the Betz limit');
  }
  res.json({ options, betzLimit: BETZ_LIMIT, aboveBetzLimit: bemt.cp > BETZ_LIMIT, bemt });
}

/**
 * @description POST /cp-curve { blade, flow, lambdas, options? } — Cp against tip-speed ratio.
 *
 * The PEAK is taken over converged points only, and is null when none converged. A peak read off a
 * point whose blade partly failed to solve is not a design number at all — the failed elements
 * contribute zero, so such a point can sit ABOVE its converged neighbours and be reported as the
 * best operating point on the curve.
 * @param req - Express request carrying the posted rotor and sweep.
 * @param res - Express response.
 * @returns Nothing; responds with one point per requested λ, or throws {@link RotorInputError}.
 */
function handleCpCurve(req: Request, res: Response): void {
  const body = asRecord(req.body, 'body');
  const blade = parseBlade(body.blade);
  const flow = parseFlow(body.flow);
  const lambdas = parseLambdas(body);
  const options = parseBemtOptions(body.options, blade.stations.length, lambdas.length);
  const points: CpCurvePoint[] = cpCurve(blade, flow, lambdas, options);
  const converged = points.filter((point) => point.allConverged);
  const peak = converged.length > 0 ? converged.reduce((best, p) => (p.cp > best.cp ? p : best)) : null;
  const unconverged = points.filter((point) => !point.allConverged).map((point) => point.lambda);
  if (unconverged.length > 0) {
    logger.warn({ unconverged, total: points.length }, 'Cp(λ) sweep returned points the solver could not close');
  }
  res.json({
    options,
    betzLimit: BETZ_LIMIT,
    points,
    peak,
    allConverged: unconverged.length === 0,
    unconvergedLambdas: unconverged,
  });
}

/**
 * @description POST /export { blade, format, sectionPoints?, name? } — the blade as a CAD/print file.
 * @param req - Express request carrying the posted blade and format.
 * @param res - Express response.
 * @returns Nothing; responds with the rendered file, or throws {@link RotorInputError}.
 */
function handleExport(req: Request, res: Response): void {
  const body = asRecord(req.body, 'body');
  const format = body.format;
  if (typeof format !== 'string' || !ROTOR_EXPORT_FORMATS.includes(format as RotorExportFormat)) {
    bad(`body.format must be one of ${ROTOR_EXPORT_FORMATS.join(', ')}`);
  }
  const blade = parseBlade(body.blade);
  const sectionPoints =
    optInt(body, 'sectionPoints', 'body', ROTOR_LIMITS.minSectionPoints, ROTOR_LIMITS.maxSectionPoints) ??
    DEFAULT_SECTION_STATIONS;
  const name = body.name === undefined || body.name === null ? 'oshal_blade' : text(body, 'name', 'body');
  res.json(renderExport(blade, format as RotorExportFormat, sectionPoints, name));
}

/**
 * @description POST /harvest { blade, flow, site, loads, storage, drivetrain?, options? } — the
 * whole point of this router, and the one place the rotor-design and marine slices are allowed to
 * meet. Solves the blade, substitutes the resulting Cp for the marine turbine's hand-typed
 * `powerCoefficient`, and runs the closed-loop tidal budget on it.
 * @param req - Express request carrying the blade, the flow, and the marine design around it.
 * @param res - Express response.
 * @returns Nothing; responds with {@link RotorHarvestResponse}, or throws.
 */
function handleHarvest(req: Request, res: Response): void {
  const body = asRecord(req.body, 'body');
  // Budget options FIRST — its integration-step ceiling is the largest single cost in the request
  // and is reused verbatim from the harvest surface so the two cannot bound the same run differently.
  const options = parseHarvestOptions(body.options, 'marine');
  const blade = parseBlade(body.blade);
  const flow = parseFlow(body.flow);
  assertMarineDensity(flow);
  const bemtOptions = parseBemtOptions(body.bemtOptions, blade.stations.length, 1);
  const design: Omit<MarineUnitConfig, 'turbine'> = {
    site: parseTidalSite(body.site),
    loads: parseLoads(body),
    storage: parseStorage(body),
  };
  const drivetrain = parseDrivetrain(body.drivetrain);

  const bemt = solveBemt(blade, flow, bemtOptions);
  assertUsableForBudget(bemt);
  const turbine = turbineFromSolve(blade, bemt, drivetrain);
  const aboveBetzLimit = bemt.cp > BETZ_LIMIT;
  if (aboveBetzLimit) {
    logger.warn({ cp: bemt.cp, betzLimit: BETZ_LIMIT }, 'substituting an above-Betz Cp into the marine budget');
  }
  const result = simulatePowerBudget({ ...design, turbine }, options);
  logger.info(
    { cp: bemt.cp, tipSpeedRatio: bemt.tipSpeedRatio, perpetual: result.verdict.perpetual },
    'solved a rotor and closed the marine energy loop on its Cp',
  );
  res.json({
    bemt,
    turbine,
    betzLimit: BETZ_LIMIT,
    aboveBetzLimit,
    options,
    verdict: result.verdict,
    samples: downsampleSamples(result.samples, ROTOR_LIMITS.maxResponseSamples),
    retainedSampleCount: result.samples.length,
    note: CONSTANT_CP_NOTE,
  } satisfies RotorHarvestResponse);
}

/**
 * @description Whether a thrown value is one of the two rejection classes this router maps to a
 * 400. {@link HarvestInputError} is included because POST /harvest resolves its budget span with
 * the harvest surface's own {@link parseHarvestOptions} — reusing that validator means also
 * recognising its rejection, or an out-of-range `durationHours` would surface as a 500 here and a
 * 400 one route over.
 * @param error - The caught value.
 * @returns True when the caller's input was refused.
 */
function isInputRejection(error: unknown): error is Error {
  return error instanceof RotorInputError || error instanceof HarvestInputError;
}

/**
 * @description Wrap a handler with entry/exit logging and the three failure postures: refused
 * input is a 400 naming the field, an unusable SOLUTION is a 422 explaining the physics, and
 * anything else is a 500 that logs the stack and tells the caller nothing about it.
 * @param operation - Route name for the logs.
 * @param handler - The synchronous handler.
 * @returns An Express handler.
 */
function rotorRoute(operation: string, handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res) => {
    const startedAt = Date.now();
    logger.info({ operation, method: req.method }, 'Rotor route entered');
    try {
      handler(req, res);
      logger.info({ operation, status: res.statusCode, durationMs: Date.now() - startedAt }, 'Rotor route completed');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (isInputRejection(error)) {
        logger.warn({ operation, reason: error.message, durationMs }, 'Rotor route rejected invalid input');
        res.status(400).json({ error: 'invalid_rotor_request', message: error.message });
        return;
      }
      if (error instanceof RotorSolutionError) {
        logger.warn({ operation, reason: error.message, durationMs }, 'Rotor route refused an unusable solution');
        res.status(422).json({ error: 'rotor_solution_unusable', message: error.message });
        return;
      }
      logger.error({ err: error, operation, durationMs }, 'Rotor route failed');
      res.status(500).json({ error: 'rotor_solve_failed' });
    }
  };
}

/**
 * @description The blade studio's engine scripts, both of them. The page loads the geometry half
 * BEFORE the model half (the model calls into it at boot), so a mount that serves only
 * `blade-studio.js` leaves the surface just as unbootable as no mount at all — the loader gives up
 * on the first file and never asks for the second.
 */
const BLADE_STUDIO_SCRIPTS = ['blade-studio-gl.js', 'blade-studio.js'] as const;

/**
 * @description Builds the router that serves the blade studio's engine scripts, as its OWN factory
 * so the same implementation can be mounted at more than one path without a second copy.
 *
 * It needs two mounts because the page and this router were written against different URL shapes:
 * `blade-studio.html`'s inline loader probes both `assets/` relative to the page and an absolute
 * package path. Serving both from one factory is what stops that from becoming two implementations
 * that drift; it costs one extra `router.use`.
 * @param opts - Package directory (for bundled assets) and the optional guard.
 * @returns Express router serving `blade-studio-gl.js` and `blade-studio.js`.
 */
export function createBladeStudioAssetRoutes(opts: { appPackageDir?: string; requiresAuth?: RequestHandler } = {}): Router {
  const router = Router();
  const guard = opts.requiresAuth ?? passthrough;
  for (const file of BLADE_STUDIO_SCRIPTS) {
    const resolved = surfaceFile(opts.appPackageDir, file);
    logger.info({ file, resolved }, 'Resolved a blade studio engine script');
    router.get(`/${file}`, guard, serveSurfaceFile(resolved, 'application/javascript'));
  }
  return router;
}

/**
 * @description Builds the rotor half of the ocean-lab API: the BEMT solve, the Cp sweep, the CAD
 * export and the rotor-fed harvest budget.
 *
 * `requiresAuth` is INJECTABLE rather than imported, for the reason given on
 * {@link createHarvestRoutes}: the manifest's `requiresAuth: true` is the real guard on the mount,
 * and the parameter lets a spec prove the 401 without booting a server.
 * @param opts - Package directory (for bundled assets) and the optional guard.
 * @returns Express router mounted under `/api/ocean-lab/rotor`.
 */
export function createRotorRoutes(opts: { appPackageDir?: string; requiresAuth?: RequestHandler } = {}): Router {
  const router = Router();
  const guard = opts.requiresAuth ?? passthrough;
  router.use('/assets', createBladeStudioAssetRoutes(opts));
  router.post('/solve', guard, rotorRoute('solve', handleSolve));
  router.post('/cp-curve', guard, rotorRoute('cp-curve', handleCpCurve));
  router.post('/export', guard, rotorRoute('export', handleExport));
  router.post('/harvest', guard, rotorRoute('harvest', handleHarvest));
  return router;
}
