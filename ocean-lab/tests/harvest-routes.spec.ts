/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the /api/harvest console surface. Three things it
 *                     |                             | must never lose: (a) both routes are auth-gated — proven by
 *                     |                             | the SIMULATION FUNCTION never being called on an anonymous
 *                     |                             | request, not by a status code alone, because a 401 emitted
 *                     |                             | after the work is done is still a CPU denial of service;
 *                     |                             | (b) every unbounded-input shape is a 4xx with the slice
 *                     |                             | untouched, including the two DERIVED ceilings (integration
 *                     |                             | steps, retained samples) that individually-in-range fields
 *                     |                             | can still blow through; (c) a valid request returns the real
 *                     |                             | verdict + a series strided to the response cap. Assertions are
 *                     |                             | on call arguments and on the simulation's OWN return value —
 *                     |                             | never on message substrings, which survive a gutted guard.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Made claim (b) true for the ground domain, which it was not:
 *                     |                             | three shapes passed every per-field bound and then tripped a
 *                     |                             | PRECONDITION inside the slice — a plain Error, hence a 500 —
 *                     |                             | on input a console user reaches by typing. A zero collector
 *                     |                             | area (the floor was inclusive-zero), two junctions left at
 *                     |                             | the same default depth, and a mean/amplitude combination
 *                     |                             | resolving a face below absolute zero. Covered by cases AND
 *                     |                             | by a sweep that forbids a 500 for any admitted shape, so the
 *                     |                             | next disagreement between a bound and a precondition is
 *                     |                             | caught by the class rather than one-by-one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/** Native fetch captured before anything could stub the global. */
const realFetch = globalThis.fetch;

// The two slice entry points are wrapped in spies that CALL THROUGH to the real implementations,
// so every assertion below runs against real physics while still being able to prove the negative
// ("the simulation was never entered"). vi.hoisted is required — vi.mock factories are hoisted
// above the imports, so the spy objects must exist before them.
const slice = vi.hoisted(() => ({
  simulatePowerBudget: vi.fn(),
  simulateGroundBudget: vi.fn(),
}));

vi.mock('../src-routes/engine/marine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src-routes/engine/marine')>();
  slice.simulatePowerBudget.mockImplementation(actual.simulatePowerBudget);
  return { ...actual, simulatePowerBudget: slice.simulatePowerBudget };
});

vi.mock('../src-routes/engine/ground', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src-routes/engine/ground')>();
  slice.simulateGroundBudget.mockImplementation(actual.simulateGroundBudget);
  return { ...actual, simulateGroundBudget: slice.simulateGroundBudget };
});

import {
  DEFAULT_SAMPLE_EVERY_MINUTES,
  DEFAULT_STEP_SECONDS,
  HARVEST_LIMITS,
  HarvestInputError,
  createHarvestRoutes,
  downsampleSamples,
  parseHarvestOptions,
} from '../src-routes/harvest-routes';
import { MODERATE_INLET_SITE, STRONG_CHANNEL_SITE } from '../src-routes/engine/marine';
import {
  DEFAULT_GROUND_DURATION_HOURS,
  DEFAULT_SOIL,
  DRY_SAND_SOIL,
  WET_CLAY_SOIL,
  simulateGroundBudget,
  type GroundUnitConfig,
} from '../src-routes/engine/ground';
import { DEFAULT_DURATION_HOURS } from '../src-routes/engine/energy';

/**
 * @description A ground node driven almost purely by the ANNUAL wave: both junctions sit well
 * below the diurnal damping depth, so the only thing modulating its output is the season.
 *
 * Tuned to be the worst kind of design — it harvests 1.96x the energy it spends across a year and
 * is still browned out for 600 h of it, because the surplus arrives in the wrong season and a
 * 0.5 Wh store cannot bridge an equinox null. Average power is not a schedule. A 720 h window
 * lands inside one lobe of the annual wave, sees none of that, and certifies it.
 * @returns The config.
 */
function seasonallyDeadGroundDesign(): GroundUnitConfig {
  return {
    soil: DEFAULT_SOIL,
    pairs: [
      {
        name: 'deep-annual-only',
        hotDepthM: 0.6,
        coldDepthM: 3,
        module: { collectorAreaM2: 0.5, moduleResistanceKW: 2.5, ztBar: 0.8, ratedPowerW: 5, cutInPowerW: 0.0002 },
      },
    ],
    loads: [{ name: 'sensor', watts: 0.0004, dutyCycle: 1 }],
    storage: { capacityWh: 0.5, initialSocFraction: 1, roundTripEfficiency: 0.9, usableDepthOfDischarge: 0.8 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — plain JSON, exactly as the console would post them.
// ─────────────────────────────────────────────────────────────────────────────

/** A short run so the guard stays fast; the ceilings are exercised by their own cases. */
const FAST_OPTIONS = { durationHours: 72, stepSeconds: 60, sampleEveryMinutes: 30 };

const STORAGE = {
  capacityWh: 500,
  initialSocFraction: 0.7,
  roundTripEfficiency: 0.9,
  usableDepthOfDischarge: 0.8,
};

const LOADS = [{ name: 'compute', watts: 4, dutyCycle: 1 }];

const MARINE_CONFIG = {
  site: {
    name: 'guard-channel',
    constituents: [
      { name: 'M2', periodHours: 12.4206012, amplitudeMs: 1.9, phaseDeg: 0 },
      { name: 'S2', periodHours: 12.0, amplitudeMs: 0.6, phaseDeg: 25 },
    ],
    residualMs: 0.1,
  },
  turbine: {
    sweptAreaM2: 0.5,
    powerCoefficient: 0.4,
    drivetrainEfficiency: 0.8,
    cutInSpeedMs: 0.4,
    ratedPowerW: 400,
  },
  loads: LOADS,
  storage: STORAGE,
};

const GROUND_CONFIG = {
  soil: {
    name: 'guard-loam',
    thermalDiffusivityM2S: 5e-7,
    thermalConductivityWmK: 1.2,
    meanTempC: 14,
    annualAmplitudeC: 11,
    diurnalAmplitudeC: 6,
  },
  pairs: [
    {
      name: 'shallow-to-deep',
      hotDepthM: 0.1,
      coldDepthM: 3,
      module: {
        collectorAreaM2: 0.05,
        moduleResistanceKW: 2.5,
        ztBar: 0.8,
        ratedPowerW: 5,
        cutInPowerW: 0.02,
      },
    },
  ],
  loads: LOADS,
  storage: STORAGE,
};

/** JSON.parse turns this literal into Infinity — the exact shape Number.isFinite exists to catch. */
const JSON_INFINITY = '1e999';

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

/** requiresAuth stub mirroring express-openid-connect: 401 without a session, else pass through. */
function requiresAuthStub(req: Request, res: Response, next: NextFunction): void {
  const user = (req as unknown as { oidc?: { user?: unknown } }).oidc?.user;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

interface Fixture {
  server: Server;
  baseUrl: string;
}

async function startFixture(authenticated: boolean): Promise<Fixture> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { oidc: unknown }).oidc = authenticated
      ? { isAuthenticated: () => true, user: { sub: 'harvest-console-user' } }
      : { isAuthenticated: () => false };
    next();
  });
  app.use('/api/harvest', createHarvestRoutes({ requiresAuth: requiresAuthStub }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/api/harvest` };
}

interface Hit {
  status: number;
  body: Record<string, unknown> | null;
}

async function get(fixture: Fixture, route: string): Promise<Hit> {
  return read(await realFetch(`${fixture.baseUrl}${route}`));
}

async function simulate(fixture: Fixture, body: unknown): Promise<Hit> {
  return read(
    await realFetch(`${fixture.baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

async function read(res: globalThis.Response): Promise<Hit> {
  const raw = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

let authed: Fixture;
let anon: Fixture;

beforeAll(async () => {
  authed = await startFixture(true);
  anon = await startFixture(false);
});

afterAll(async () => {
  await Promise.all(
    [authed, anon].map((f) => new Promise<void>((resolve) => f.server.close(() => resolve()))),
  );
});

beforeEach(() => {
  // clearAllMocks (not reset) — it wipes recorded calls but KEEPS the call-through implementation.
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/harvest is auth-gated (oidc.ts runs authRequired:false — omission is anonymous)', () => {
  it('401s GET /sites without a session and never emits the catalogue', async () => {
    const res = await get(anon, '/sites');
    expect(res.status).toBe(401);
    expect(res.body?.marine).toBeUndefined();
    expect(res.body?.ground).toBeUndefined();
    expect(res.body?.limits).toBeUndefined();
  });

  it('401s POST /simulate WITHOUT ever entering the marine simulation', async () => {
    const res = await simulate(anon, { domain: 'marine', config: MARINE_CONFIG, options: FAST_OPTIONS });
    expect(res.status).toBe(401);
    // The load-bearing assertion: a 401 returned *after* a 30-day integration would still be a
    // denial of service. The guard must short-circuit before the slice is touched.
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
    expect(res.body?.verdict).toBeUndefined();
    expect(res.body?.samples).toBeUndefined();
  });

  it('401s POST /simulate WITHOUT ever entering the ground simulation', async () => {
    const res = await simulate(anon, { domain: 'ground', config: GROUND_CONFIG, options: FAST_OPTIONS });
    expect(res.status).toBe(401);
    expect(slice.simulateGroundBudget).not.toHaveBeenCalled();
    expect(res.body?.verdict).toBeUndefined();
  });
});

describe('GET /api/harvest/sites — the console catalogue', () => {
  it('returns the illustrative marine sites and soil profiles the slices actually export', async () => {
    const res = await get(authed, '/sites');
    expect(res.status).toBe(200);

    const marine = res.body?.marine as Array<{ name: string; constituents: unknown[] }>;
    expect(marine.map((s) => s.name)).toEqual([STRONG_CHANNEL_SITE.name, MODERATE_INLET_SITE.name]);
    expect(marine[0].constituents.length).toBe(STRONG_CHANNEL_SITE.constituents.length);

    const ground = res.body?.ground as Array<{ name: string; thermalDiffusivityM2S: number }>;
    expect(ground.map((s) => s.name)).toEqual([DEFAULT_SOIL.name, DRY_SAND_SOIL.name, WET_CLAY_SOIL.name]);
    for (const soil of ground) expect(Number.isFinite(soil.thermalDiffusivityM2S)).toBe(true);
  });

  it('publishes the EXACT bounds the simulate route enforces, so the form cannot drift from them', async () => {
    const res = await get(authed, '/sites');
    expect(res.body?.limits).toEqual(HARVEST_LIMITS);
    // Per-domain, and they must NOT be the same number: the console pre-fills its duration field
    // from this, so publishing one shared default would put a 720 h window in front of a ground
    // design and let the operator certify a seasonally-dead node from the UI.
    expect(res.body?.defaults).toEqual({
      marine: {
        durationHours: DEFAULT_DURATION_HOURS,
        stepSeconds: DEFAULT_STEP_SECONDS,
        sampleEveryMinutes: DEFAULT_SAMPLE_EVERY_MINUTES,
      },
      ground: {
        durationHours: DEFAULT_GROUND_DURATION_HOURS,
        stepSeconds: DEFAULT_STEP_SECONDS,
        sampleEveryMinutes: DEFAULT_SAMPLE_EVERY_MINUTES,
      },
    });
    expect(res.body?.defaults?.ground?.durationHours).not.toBe(res.body?.defaults?.marine?.durationHours);
  });

  it('labels the catalogue as illustrative rather than surveyed', async () => {
    const res = await get(authed, '/sites');
    expect(res.body?.illustrative).toBe(true);
    expect(typeof res.body?.note).toBe('string');
  });
});

describe('POST /api/harvest/simulate — a valid run returns a real verdict', () => {
  it('hands the marine slice the parsed config and resolved options, and returns its verdict', async () => {
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options: FAST_OPTIONS });
    expect(res.status).toBe(200);

    expect(slice.simulatePowerBudget).toHaveBeenCalledTimes(1);
    expect(slice.simulatePowerBudget).toHaveBeenCalledWith(MARINE_CONFIG, FAST_OPTIONS);
    expect(slice.simulateGroundBudget).not.toHaveBeenCalled();

    const verdict = res.body?.verdict as Record<string, unknown>;
    expect(typeof verdict.perpetual).toBe('boolean');
    expect(verdict.durationHours).toBe(FAST_OPTIONS.durationHours);
    for (const key of ['minSocFraction', 'brownoutHours', 'harvestedWh', 'consumedWh', 'marginRatio', 'meanHarvestW']) {
      expect(Number.isFinite(verdict[key] as number), `verdict.${key} must be a real number`).toBe(true);
    }
    expect(res.body?.domain).toBe('marine');
    expect(res.body?.options).toEqual(FAST_OPTIONS);
  });

  it('returns a plottable series whose points carry the budget the verdict was built from', async () => {
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options: FAST_OPTIONS });
    const samples = res.body?.samples as Array<Record<string, number>>;
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      for (const key of ['tHours', 'harvestW', 'drawW', 'socWh', 'socFraction']) {
        expect(Number.isFinite(s[key]), `sample.${key} must be a real number`).toBe(true);
      }
    }
    // Monotonic time — a stride bug that reordered or duplicated points would show up here.
    for (let i = 1; i < samples.length; i += 1) expect(samples[i].tHours).toBeGreaterThan(samples[i - 1].tHours);
    expect(res.body?.retainedSampleCount).toBe(samples.length);
  });

  it('routes the ground domain to the ground slice and nothing else', async () => {
    const res = await simulate(authed, { domain: 'ground', config: GROUND_CONFIG, options: FAST_OPTIONS });
    expect(res.status).toBe(200);
    expect(slice.simulateGroundBudget).toHaveBeenCalledTimes(1);
    expect(slice.simulateGroundBudget).toHaveBeenCalledWith(GROUND_CONFIG, FAST_OPTIONS);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
    expect(typeof (res.body?.verdict as Record<string, unknown>).perpetual).toBe('boolean');
  });

  it('applies the documented defaults when options are omitted entirely', async () => {
    // 720 h at 60 s is the core's own default run — cheap enough to assert against directly.
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG });
    expect(res.status).toBe(200);
    expect(slice.simulatePowerBudget).toHaveBeenCalledWith(MARINE_CONFIG, {
      durationHours: DEFAULT_DURATION_HOURS,
      stepSeconds: DEFAULT_STEP_SECONDS,
      sampleEveryMinutes: DEFAULT_SAMPLE_EVERY_MINUTES,
    });
  });
});

describe('POST /api/harvest/simulate — every bad shape is a 4xx and the slice is never entered', () => {
  const rejected: Array<[string, unknown]> = [
    // An array, not a string literal: express.json runs in strict mode and rejects a bare JSON
    // scalar itself, which would test body-parser rather than this route. An array reaches the
    // handler (typeof [] === 'object') and must still be refused.
    ['a body that is an array, not an object', []],
    ['a missing domain', { config: MARINE_CONFIG }],
    ['an unknown domain', { domain: 'solar', config: MARINE_CONFIG }],
    ['a missing config', { domain: 'marine' }],
    ['a config that is an array', { domain: 'marine', config: [MARINE_CONFIG] }],
    ['a missing site', { domain: 'marine', config: { ...MARINE_CONFIG, site: undefined } }],
    ['a blank site name', { domain: 'marine', config: { ...MARINE_CONFIG, site: { ...MARINE_CONFIG.site, name: '  ' } } }],
    ['a missing turbine', { domain: 'marine', config: { ...MARINE_CONFIG, turbine: undefined } }],
    ['a missing storage', { domain: 'marine', config: { ...MARINE_CONFIG, storage: undefined } }],
    ['a zero-capacity store', { domain: 'marine', config: { ...MARINE_CONFIG, storage: { ...STORAGE, capacityWh: 0 } } }],
    ['a duty cycle above 1', { domain: 'marine', config: { ...MARINE_CONFIG, loads: [{ name: 'x', watts: 4, dutyCycle: 5 }] } }],
    ['an empty load list', { domain: 'marine', config: { ...MARINE_CONFIG, loads: [] } }],
    ['a negative rotor area', { domain: 'marine', config: { ...MARINE_CONFIG, turbine: { ...MARINE_CONFIG.turbine, sweptAreaM2: -1 } } }],
    ['a missing soil', { domain: 'ground', config: { ...GROUND_CONFIG, soil: undefined } }],
    ['an empty pair list', { domain: 'ground', config: { ...GROUND_CONFIG, pairs: [] } }],
    ['a zero thermal diffusivity', { domain: 'ground', config: { ...GROUND_CONFIG, soil: { ...GROUND_CONFIG.soil, thermalDiffusivityM2S: 0 } } }],
    ['a pair with no module', { domain: 'ground', config: { ...GROUND_CONFIG, pairs: [{ name: 'p', hotDepthM: 0.1, coldDepthM: 3 }] } }],
    // The three shapes below pass every PER-FIELD bound and then trip a precondition inside the
    // slice, which throws a plain Error and became a 500 — the exact failure this table's header
    // claims cannot happen. Each is reachable from the console by typing, not by crafting.
    [
      'a zero collector area (the validator floor used to be inclusive-zero)',
      { domain: 'ground', config: { ...GROUND_CONFIG, pairs: [{ ...GROUND_CONFIG.pairs[0], module: { ...GROUND_CONFIG.pairs[0].module, collectorAreaM2: 0 } }] } },
    ],
    [
      'two junctions at the SAME depth — what a form does with both depth inputs at their default',
      { domain: 'ground', config: { ...GROUND_CONFIG, pairs: [{ ...GROUND_CONFIG.pairs[0], hotDepthM: 2, coldDepthM: 2 }] } },
    ],
    [
      'a soil whose mean and amplitudes reach below absolute zero',
      { domain: 'ground', config: { ...GROUND_CONFIG, soil: { ...GROUND_CONFIG.soil, meanTempC: -100, annualAmplitudeC: 100, diurnalAmplitudeC: 100 } } },
    ],
  ];

  it.each(rejected)('rejects %s with a 400', async (_label, body) => {
    const res = await simulate(authed, body);
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('invalid_harvest_request');
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
    expect(slice.simulateGroundBudget).not.toHaveBeenCalled();
  });

  it('rejects an over-long load list rather than integrating it every timestep', async () => {
    const loads = Array.from({ length: HARVEST_LIMITS.maxLoads + 1 }, (_, i) => ({
      name: `load-${i}`, watts: 1, dutyCycle: 0.5,
    }));
    const res = await simulate(authed, { domain: 'marine', config: { ...MARINE_CONFIG, loads }, options: FAST_OPTIONS });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('accepts a load list exactly AT the cap (the bound is a limit, not an off-by-one)', async () => {
    const loads = Array.from({ length: HARVEST_LIMITS.maxLoads }, (_, i) => ({
      name: `load-${i}`, watts: 0.01, dutyCycle: 0.1,
    }));
    const res = await simulate(authed, { domain: 'marine', config: { ...MARINE_CONFIG, loads }, options: FAST_OPTIONS });
    expect(res.status).toBe(200);
    expect(slice.simulatePowerBudget).toHaveBeenCalledTimes(1);
  });

  it('rejects an over-long constituent list', async () => {
    const constituents = Array.from({ length: HARVEST_LIMITS.maxConstituents + 1 }, (_, i) => ({
      name: `C${i}`, periodHours: 12, amplitudeMs: 0.1, phaseDeg: 0,
    }));
    const site = { ...MARINE_CONFIG.site, constituents };
    const res = await simulate(authed, { domain: 'marine', config: { ...MARINE_CONFIG, site }, options: FAST_OPTIONS });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('accepts junction depths that differ by the smallest amount the bound allows', async () => {
    // Guards the fix from over-reaching: the rejection is EQUALITY, not "too close together".
    const pairs = [{ ...GROUND_CONFIG.pairs[0], hotDepthM: 2, coldDepthM: 2.000001 }];
    const res = await simulate(authed, { domain: 'ground', config: { ...GROUND_CONFIG, pairs }, options: FAST_OPTIONS });
    expect(res.status).toBe(200);
    expect(slice.simulateGroundBudget).toHaveBeenCalledTimes(1);
  });

  it('never answers 500 for any ground shape the per-field bounds admit', async () => {
    // The header's claim, asserted as a claim: sweep the four fields whose bounds and whose slice
    // preconditions disagreed, and require every response to be a 4xx or a real verdict — never
    // the 500 that says an operator's typing reached an unguarded `throw`.
    const shapes: Array<Record<string, unknown>> = [
      { ...GROUND_CONFIG, pairs: [{ ...GROUND_CONFIG.pairs[0], hotDepthM: 0, coldDepthM: 0 }] },
      { ...GROUND_CONFIG, pairs: [{ ...GROUND_CONFIG.pairs[0], hotDepthM: 1000, coldDepthM: 1000 }] },
      { ...GROUND_CONFIG, pairs: [{ ...GROUND_CONFIG.pairs[0], module: { ...GROUND_CONFIG.pairs[0].module, collectorAreaM2: 0 } }] },
      { ...GROUND_CONFIG, soil: { ...GROUND_CONFIG.soil, meanTempC: -100, annualAmplitudeC: 100, diurnalAmplitudeC: 100 } },
      { ...GROUND_CONFIG, soil: { ...GROUND_CONFIG.soil, thermalConductivityWmK: 0.001 } },
    ];
    for (const config of shapes) {
      const res = await simulate(authed, { domain: 'ground', config, options: FAST_OPTIONS });
      expect(res.status, `shape ${JSON.stringify(config.pairs ?? config.soil)}`).toBeLessThan(500);
    }
  });

  it('rejects an over-long junction-pair list', async () => {
    const pairs = Array.from({ length: HARVEST_LIMITS.maxJunctionPairs + 1 }, () => GROUND_CONFIG.pairs[0]);
    const res = await simulate(authed, { domain: 'ground', config: { ...GROUND_CONFIG, pairs }, options: FAST_OPTIONS });
    expect(res.status).toBe(400);
    expect(slice.simulateGroundBudget).not.toHaveBeenCalled();
  });

  it('rejects a non-finite number smuggled in as a JSON literal (1e999 parses to Infinity)', async () => {
    const raw = JSON.stringify({ domain: 'marine', config: MARINE_CONFIG, options: FAST_OPTIONS }).replace(
      '"ratedPowerW":400',
      `"ratedPowerW":${JSON_INFINITY}`,
    );
    const res = await simulate(authed, raw);
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });
});

describe('POST /api/harvest/simulate — the run-cost ceilings (an unbounded run wedges the controller)', () => {
  it('rejects a duration past the cap', async () => {
    const options = { ...FAST_OPTIONS, durationHours: HARVEST_LIMITS.maxDurationHours + 1 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('accepts the cap duration when the step keeps the step count sane (the bound is a real edge)', async () => {
    // 20000 h at one-day steps is 834 steps — in range, and it proves maxDurationHours is not
    // itself the thing rejecting the case above's neighbour.
    const options = { durationHours: HARVEST_LIMITS.maxDurationHours, stepSeconds: 86_400, sampleEveryMinutes: 1_440 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(200);
    expect(slice.simulatePowerBudget).toHaveBeenCalledWith(MARINE_CONFIG, options);
  });

  it('rejects a sub-second integration step', async () => {
    const options = { ...FAST_OPTIONS, stepSeconds: 0 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('rejects a duration/step PAIR that is individually in range but asks for 72M timesteps', async () => {
    // Both fields pass their own bounds; only the derived step-count ceiling catches this, which
    // is the entire reason that ceiling exists.
    const options = { durationHours: HARVEST_LIMITS.maxDurationHours, stepSeconds: HARVEST_LIMITS.minStepSeconds, sampleEveryMinutes: 30 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('rejects a sampling density that would retain more points than the memory ceiling', async () => {
    // 2000 h at 60 s = 120000 steps (under the step cap) but one retained sample per step.
    const options = { durationHours: 2_000, stepSeconds: 60, sampleEveryMinutes: 1 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  it('rejects a non-finite duration (1e999 parses to Infinity and passes every range comparison)', async () => {
    const raw = `{"domain":"marine","config":${JSON.stringify(MARINE_CONFIG)},"options":{"durationHours":${JSON_INFINITY}}}`;
    const res = await simulate(authed, raw);
    expect(res.status).toBe(400);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });
});

describe('POST /api/harvest/simulate — the response series is downsampled, never truncated', () => {
  it('strides a long run down to the response cap while keeping the run\'s final point', async () => {
    // 2000 h at 60 s sampled every 30 min retains 4000 points — above the 2000-point wire cap.
    const options = { durationHours: 2_000, stepSeconds: 60, sampleEveryMinutes: 30 };
    const res = await simulate(authed, { domain: 'marine', config: MARINE_CONFIG, options });
    expect(res.status).toBe(200);

    const samples = res.body?.samples as Array<{ tHours: number }>;
    expect(samples.length).toBeLessThanOrEqual(HARVEST_LIMITS.maxResponseSamples);
    expect(samples.length).toBeGreaterThan(1);

    // Compare against what the simulation ACTUALLY produced, not a guessed number.
    const produced = slice.simulatePowerBudget.mock.results[0].value as { samples: Array<{ tHours: number }> };
    expect(produced.samples.length).toBeGreaterThan(HARVEST_LIMITS.maxResponseSamples);
    expect(res.body?.retainedSampleCount).toBe(produced.samples.length);
    expect(samples[0].tHours).toBe(produced.samples[0].tHours);
    expect(samples[samples.length - 1].tHours).toBe(produced.samples[produced.samples.length - 1].tHours);
  });
});

describe('the exported helpers the route is built from', () => {
  it('downsampleSamples keeps the last point even when the stride does not divide evenly', () => {
    const input = Array.from({ length: 10_001 }, (_, i) => i);
    const out = downsampleSamples(input, 100);
    // At MOST max — an implementation that appends the tail after a full strided pass returns
    // max+1 and silently breaks the response cap.
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(10_000);
    // Strictly increasing — no duplicated tail.
    for (let i = 1; i < out.length; i += 1) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it('downsampleSamples returns the input untouched when it already fits', () => {
    const input = [1, 2, 3];
    expect(downsampleSamples(input, 10)).toBe(input);
  });

  it('parseHarvestOptions resolves omitted options to the documented defaults', () => {
    expect(parseHarvestOptions(undefined, 'marine')).toEqual({
      durationHours: DEFAULT_DURATION_HOURS,
      stepSeconds: DEFAULT_STEP_SECONDS,
      sampleEveryMinutes: DEFAULT_SAMPLE_EVERY_MINUTES,
    });
  });

  it('parseHarvestOptions throws HarvestInputError on the derived step-count ceiling', () => {
    expect(() =>
      parseHarvestOptions({ durationHours: HARVEST_LIMITS.maxDurationHours, stepSeconds: 1 }, 'marine'),
    ).toThrow(HarvestInputError);
  });

  it('parseHarvestOptions rejects NaN — the one non-finite a range check cannot catch', () => {
    // Infinity is caught by `value > max`, so the range comparisons alone look sufficient. NaN is
    // not: `NaN < min` and `NaN > max` are BOTH false, so it passes every bound and then poisons
    // the integration into producing a NaN verdict forever. Number.isFinite is what stops it, and
    // this is the only case that fails if that check is removed. NaN cannot come from JSON.parse,
    // so it is reachable via this exported helper rather than over the wire.
    expect(() => parseHarvestOptions({ durationHours: Number.NaN }, 'marine')).toThrow(HarvestInputError);
    expect(() => parseHarvestOptions({ stepSeconds: Number.NaN }, 'marine')).toThrow(HarvestInputError);
    expect(() => parseHarvestOptions({ sampleEveryMinutes: Number.NaN }, 'marine')).toThrow(HarvestInputError);
  });

  it('resolves the GROUND default span to a full year, not marine 720 h', () => {
    // The route hands the slice FULLY RESOLVED options, so an omitted durationHours is decided
    // here and the slice's own default can never fire. Resolving it domain-blind gave ground
    // marine's 720 h — a window that cannot contain an equinox null.
    expect(parseHarvestOptions(undefined, 'ground').durationHours).toBe(DEFAULT_GROUND_DURATION_HOURS);
    expect(parseHarvestOptions(undefined, 'marine').durationHours).toBe(DEFAULT_DURATION_HOURS);
    expect(DEFAULT_GROUND_DURATION_HOURS).toBeGreaterThan(8000);
    // Mutation guard: if defaultDurationHoursFor stops branching on domain, these collide.
    expect(parseHarvestOptions(undefined, 'ground').durationHours).not.toBe(
      parseHarvestOptions(undefined, 'marine').durationHours,
    );
  });

  it('an explicit durationHours still wins over the domain default, in both domains', () => {
    expect(parseHarvestOptions({ durationHours: 1000 }, 'ground').durationHours).toBe(1000);
    expect(parseHarvestOptions({ durationHours: 1000 }, 'marine').durationHours).toBe(1000);
  });

  it("the ground default fits inside the route's own cost ceilings", () => {
    // A default that trips maxIntegrationSteps would turn every option-less ground request into a
    // 400, trading a wrong answer for a broken endpoint. Prove the annual span actually runs.
    const opts = parseHarvestOptions(undefined, 'ground');
    const steps = Math.ceil((opts.durationHours * 3600) / opts.stepSeconds);
    const retained = Math.ceil(steps / Math.max(1, Math.round((opts.sampleEveryMinutes * 60) / opts.stepSeconds)));
    expect(steps).toBeLessThanOrEqual(HARVEST_LIMITS.maxIntegrationSteps);
    expect(retained).toBeLessThanOrEqual(HARVEST_LIMITS.maxRetainedSamples);
    expect(opts.durationHours).toBeLessThanOrEqual(HARVEST_LIMITS.maxDurationHours);
  });

  it('CERTIFICATION GUARD: an option-less ground design that dies seasonally is REJECTED', () => {
    // The defect this replaces: over HTTP with no options, a deep annual pair was simulated for
    // 720 h — a window sitting entirely inside one lobe of the annual wave — and came back
    // `perpetual: true` for a node browned out for roughly a quarter of the year. Certifying by
    // omission is the one failure mode a verdict surface must never have.
    const design = seasonallyDeadGroundDesign();
    const short = simulateGroundBudget(design, parseHarvestOptions({ durationHours: 720 }, 'ground'));
    const resolved = simulateGroundBudget(design, parseHarvestOptions(undefined, 'ground'));

    // The short window is exactly the trap — it sees no null and says yes.
    expect(short.verdict.perpetual).toBe(true);
    expect(short.verdict.brownoutHours).toBe(0);
    // The resolved default sees the equinox null and says no.
    expect(resolved.verdict.perpetual).toBe(false);
    expect(resolved.verdict.brownoutHours).toBeGreaterThan(24 * 14);
    // And the reason it is a TRAP rather than an obviously-short design: across the full year it
    // harvests comfortably MORE than it spends. A margin check alone would wave this through.
    expect(resolved.verdict.marginRatio).toBeGreaterThan(1.5);
  });
});
