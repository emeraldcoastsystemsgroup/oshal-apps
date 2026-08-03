/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the /api/rotor blade-studio surface. Four things it
 *                     |                             | must never lose: (a) every route is auth-gated — proven by the
 *                     |                             | SOLVER never being called on an anonymous request, not by a
 *                     |                             | status code, because a 401 emitted after a BEMT sweep has run
 *                     |                             | is still a CPU denial of service; (b) every bound rejects with
 *                     |                             | a 4xx and the solver untouched, including the two DERIVED
 *                     |                             | ceilings (panel work, element solves) that individually-in-range
 *                     |                             | fields can still blow through; (c) a valid solve returns a Cp at
 *                     |                             | or below the Betz limit; (d) POST /harvest really SUBSTITUTES
 *                     |                             | the solved Cp — asserted on the config the marine slice was
 *                     |                             | CALLED with, and against the 0.4 every marine fixture in this
 *                     |                             | repo hand-types, so a silent fall-through to the typed-in value
 *                     |                             | cannot pass. Assertions are on call arguments and on the
 *                     |                             | slices' OWN return values — never on message substrings, which
 *                     |                             | survive a gutted guard.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Two holes in (a) and (b), both mutation-verified. (a) covered
 *                     |                             | only the four POST routes, so the two GET asset routes the same
 *                     |                             | factory mounts could be made fully anonymous with all 79 specs
 *                     |                             | green — and those handlers fs.readFileSync a file and send it.
 *                     |                             | (b)'s `expectRefused` asserted the solver, the sweep and the
 *                     |                             | budget were untouched but never the LOFT, so hoisting
 *                     |                             | bladeToMesh above the facet ceiling left every /export bound
 *                     |                             | case passing while the mesh it exists to refuse was built.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/** Native fetch captured before anything could stub the global. */
const realFetch = globalThis.fetch;

// The three slice entry points are wrapped in spies that CALL THROUGH to the real implementations,
// so every assertion below runs against real physics while still being able to prove the negative
// ("the solver was never entered"). vi.hoisted is required — vi.mock factories are hoisted above
// the imports, so the spy objects must exist before them.
const slice = vi.hoisted(() => ({
  solveBemt: vi.fn(),
  cpCurve: vi.fn(),
  bladeToMesh: vi.fn(),
  simulatePowerBudget: vi.fn(),
}));

vi.mock('../src-routes/engine/rotor-design', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src-routes/engine/rotor-design')>();
  slice.solveBemt.mockImplementation(actual.solveBemt);
  slice.cpCurve.mockImplementation(actual.cpCurve);
  slice.bladeToMesh.mockImplementation(actual.bladeToMesh);
  return {
    ...actual,
    solveBemt: slice.solveBemt,
    cpCurve: slice.cpCurve,
    bladeToMesh: slice.bladeToMesh,
  };
});

vi.mock('../src-routes/engine/marine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src-routes/engine/marine')>();
  slice.simulatePowerBudget.mockImplementation(actual.simulatePowerBudget);
  return { ...actual, simulatePowerBudget: slice.simulatePowerBudget };
});

import {
  ROTOR_EXPORT_FORMATS,
  ROTOR_LIMITS,
  createRotorRoutes,
  parseBemtOptions,
} from '../src-routes/rotor-routes';
import { HARVEST_LIMITS } from '../src-routes/harvest-routes';
import {
  BETZ_LIMIT,
  referenceTidalFlow,
  referenceTidalRotor,
  type BladeSpec,
  type FlowCondition,
} from '../src-routes/engine/rotor-design';
import { SEAWATER_DENSITY_KGM3, STRONG_CHANNEL_SITE } from '../src-routes/engine/marine';
import { DXF_R12_VERSION, stlBinaryByteLength } from '../src-routes/engine/geometry';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — plain JSON, exactly as the blade studio would post them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description The Cp every marine fixture in this repo hand-types (marine-power-budget.spec.ts:33
 * and :41, energy-budget.spec.ts:452, harvest-routes.spec.ts:132, harvest-console.js:421). The
 * substitution test asserts against THIS number: if POST /harvest ever fell through to a typed-in
 * coefficient instead of the solved one, that is the value it would fall through to.
 */
const HAND_TYPED_MARINE_CP = 0.4;

/** The illustrative 150 mm Betz-optimal tidal rotor, round-tripped through JSON like a real post. */
const REFERENCE_BLADE: BladeSpec = JSON.parse(JSON.stringify(referenceTidalRotor())) as BladeSpec;

/** Its design inflow: 1 m/s in seawater at λ = 5. */
const REFERENCE_FLOW: FlowCondition = JSON.parse(JSON.stringify(referenceTidalFlow())) as FlowCondition;

/** A cheap discretisation — the ceilings get their own cases, so the happy paths stay fast. */
const FAST_BEMT = { elementCount: 12, panelStations: 24 };

/** A short budget span so the harvest leg stays fast; the span ceilings live in the harvest guard. */
const FAST_BUDGET = { durationHours: 72, stepSeconds: 60, sampleEveryMinutes: 30 };

const LOADS = [{ name: 'compute', watts: 2, dutyCycle: 1 }];

const STORAGE = {
  capacityWh: 500,
  initialSocFraction: 0.7,
  roundTripEfficiency: 0.9,
  usableDepthOfDischarge: 0.8,
};

/** JSON.parse turns this literal into Infinity — the exact shape Number.isFinite exists to catch. */
const JSON_INFINITY = '1e999';

/**
 * @description A blade carrying an arbitrary number of design stations, used to drive the derived
 * ceilings (which are products of the station count and a discretisation, so neither factor alone
 * can reach them).
 * @param count - How many stations to emit.
 * @returns A structurally valid blade with `count` stations.
 */
function bladeWithStations(count: number): BladeSpec {
  const stations = Array.from({ length: count }, (_, i) => ({
    radiusFrac: 0.25 + (0.75 * i) / Math.max(1, count - 1),
    chordM: 0.02,
    twistDeg: 20 - (20 * i) / Math.max(1, count - 1),
    section: { maxCamber: 0.04, camberPos: 0.4, thickness: 0.15 },
  }));
  return { tipRadiusM: 0.15, hubRadiusM: 0.0375, bladeCount: 3, stations, pitchDeg: 0 };
}

/**
 * @description The reference blade with ONE field replaced, so a bound case names exactly the
 * field it is testing instead of restating a whole blade.
 * @param patch - Fields to override on the blade.
 * @returns The patched blade, as a plain JSON value.
 */
function blade(patch: Record<string, unknown>): unknown {
  return { ...REFERENCE_BLADE, ...patch };
}

/**
 * @description The reference blade with one STATION field replaced.
 * @param patch - Fields to override on station 0.
 * @returns The patched blade, as a plain JSON value.
 */
function bladeWithStationPatch(patch: Record<string, unknown>): unknown {
  const stations = REFERENCE_BLADE.stations.map((s, i) => (i === 0 ? { ...s, ...patch } : s));
  return { ...REFERENCE_BLADE, stations };
}

/**
 * @description The reference flow with one field replaced.
 * @param patch - Fields to override.
 * @returns The patched flow, as a plain JSON value.
 */
function flow(patch: Record<string, unknown>): unknown {
  return { ...REFERENCE_FLOW, ...patch };
}

/** The full, valid POST /harvest body. */
const HARVEST_BODY = {
  blade: REFERENCE_BLADE,
  flow: REFERENCE_FLOW,
  site: STRONG_CHANNEL_SITE,
  loads: LOADS,
  storage: STORAGE,
  bemtOptions: FAST_BEMT,
  options: FAST_BUDGET,
};

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

/**
 * @description Boot a throwaway server carrying the REAL router, with a session or without one.
 * @param authenticated - Whether the injected oidc session carries a user.
 * @returns The running fixture.
 */
async function startFixture(authenticated: boolean): Promise<Fixture> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { oidc: unknown }).oidc = authenticated
      ? { isAuthenticated: () => true, user: { sub: 'blade-studio-user' } }
      : { isAuthenticated: () => false };
    next();
  });
  app.use('/api/rotor', createRotorRoutes({ requiresAuth: requiresAuthStub }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/api/rotor` };
}

interface Hit {
  status: number;
  body: Record<string, unknown> | null;
}

/**
 * @description GET a rotor route — used for the asset mounts, which are the only non-POST routes
 * this factory registers and the ones a POST-only auth block cannot see.
 * @param fixture - Which server to hit.
 * @param route - Route path under /api/rotor.
 * @returns Status and body text.
 */
async function get(fixture: Fixture, route: string): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${fixture.baseUrl}${route}`);
  return { status: res.status, text: await res.text() };
}

/**
 * @description POST a body (or a raw JSON string, for the Infinity cases) to a rotor route.
 * @param fixture - Which server to hit.
 * @param route - Route path under /api/rotor.
 * @param body - Object to serialise, or a raw JSON string to send verbatim.
 * @returns Status and parsed body.
 */
async function post(fixture: Fixture, route: string, body: unknown): Promise<Hit> {
  const res = await realFetch(`${fixture.baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

/**
 * @description Assert that a request was refused with a 400 AND that no expensive work ran. Both
 * halves matter: a bound that rejects after the sweep protects nothing.
 *
 * `bladeToMesh` is in the list because the /export ceilings are the ones whose whole claim is
 * ORDERING — "refuses the derived facet ceiling BEFORE building the mesh, not after". Without it,
 * hoisting the loft above the ceiling check leaves every /export case green while a 40700-facet
 * blade is lofted and thrown away on each one.
 * @param hit - The response.
 * @param why - Label shown when the expectation fails.
 * @returns Nothing.
 */
function expectRefused(hit: Hit, why: string): void {
  expect(hit.status, `${why} must be refused`).toBe(400);
  expect(hit.body?.error, why).toBe('invalid_rotor_request');
  expect(slice.solveBemt, `${why} must not reach the solver`).not.toHaveBeenCalled();
  expect(slice.cpCurve, `${why} must not reach the sweep`).not.toHaveBeenCalled();
  expect(slice.bladeToMesh, `${why} must not reach the loft`).not.toHaveBeenCalled();
  expect(slice.simulatePowerBudget, `${why} must not reach the energy budget`).not.toHaveBeenCalled();
}

let authed: Fixture;
let anon: Fixture;

beforeAll(async () => {
  authed = await startFixture(true);
  anon = await startFixture(false);
});

afterAll(async () => {
  await Promise.all([authed, anon].map((f) => new Promise<void>((resolve) => f.server.close(() => resolve()))));
});

beforeEach(() => {
  // clearAllMocks (not reset) — it wipes recorded calls but KEEPS the call-through implementation.
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/rotor is auth-gated (oidc.ts runs authRequired:false — omission is anonymous)', () => {
  it('401s POST /solve WITHOUT ever entering the BEMT solver', async () => {
    const res = await post(anon, '/solve', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: FAST_BEMT });
    expect(res.status).toBe(401);
    // The load-bearing assertion: a 401 returned *after* a rotor sweep would still be a denial of
    // service. The guard must short-circuit before the slice is touched.
    expect(slice.solveBemt).not.toHaveBeenCalled();
    expect(res.body?.bemt).toBeUndefined();
  });

  it('401s POST /cp-curve WITHOUT ever entering the sweep', async () => {
    const res = await post(anon, '/cp-curve', {
      blade: REFERENCE_BLADE,
      flow: REFERENCE_FLOW,
      lambdas: [3, 5, 7],
      options: FAST_BEMT,
    });
    expect(res.status).toBe(401);
    expect(slice.cpCurve).not.toHaveBeenCalled();
    expect(slice.solveBemt).not.toHaveBeenCalled();
    expect(res.body?.points).toBeUndefined();
  });

  it('401s POST /export WITHOUT ever lofting the blade', async () => {
    const res = await post(anon, '/export', { blade: REFERENCE_BLADE, format: 'obj', sectionPoints: 12 });
    expect(res.status).toBe(401);
    expect(slice.bladeToMesh).not.toHaveBeenCalled();
    expect(res.body?.payload).toBeUndefined();
  });

  it('401s POST /harvest WITHOUT solving OR running the energy budget', async () => {
    const res = await post(anon, '/harvest', HARVEST_BODY);
    expect(res.status).toBe(401);
    expect(slice.solveBemt).not.toHaveBeenCalled();
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
    expect(res.body?.verdict).toBeUndefined();
  });

  // The four POST routes are not the whole surface. `createRotorRoutes` also mounts the blade
  // studio's engine scripts, and those handlers read files off disk with fs.readFileSync — an
  // unguarded regression there is anonymous file exposure, which is exactly the shape CLAUDE.md's
  // "authentication is opt-in per route" rule warns about. Asserted per FILE rather than over the
  // mount, because dropping the guard from one route leaves the other one's 401 intact.
  for (const file of ['blade-studio-gl.js', 'blade-studio.js']) {
    it(`401s GET /assets/${file} and serves NOTHING to an anonymous caller`, async () => {
      const res = await get(anon, `/assets/${file}`);
      expect(res.status).toBe(401);
      expect(res.text).not.toMatch(/function|const |=>/);
      expect(res.text.length).toBeLessThan(200);
    });

    it(`serves /assets/${file} to a signed-in caller, so the 401 is the guard and not a 404`, async () => {
      const res = await get(authed, `/assets/${file}`);
      expect(res.status).toBe(200);
      expect(res.text.length).toBeGreaterThan(200);
    });
  }
});

describe('POST /api/rotor/solve — a valid solve', () => {
  it('returns a converged rotor whose Cp is at or below the Betz limit', async () => {
    const res = await post(authed, '/solve', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: FAST_BEMT });
    expect(res.status).toBe(200);
    expect(slice.solveBemt).toHaveBeenCalledTimes(1);

    const bemt = res.body?.bemt as { cp: number; ct: number; powerW: number; allConverged: boolean; tipSpeedRatio: number };
    expect(bemt.allConverged).toBe(true);
    expect(bemt.cp).toBeGreaterThan(0);
    // The physics acceptance: no open-flow rotor can pass 16/27, and a solver that prints one has
    // lost its high-induction correction.
    expect(bemt.cp).toBeLessThanOrEqual(BETZ_LIMIT);
    expect(res.body?.aboveBetzLimit).toBe(false);
    expect(res.body?.betzLimit).toBe(BETZ_LIMIT);
    for (const key of ['ct', 'powerW', 'tipSpeedRatio'] as const) {
      expect(Number.isFinite(bemt[key]), `bemt.${key} must be a real number`).toBe(true);
    }
  });

  it('hands the solver the parsed blade, flow and RESOLVED discretisation', async () => {
    await post(authed, '/solve', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: FAST_BEMT });
    const [passedBlade, passedFlow, passedOptions] = slice.solveBemt.mock.calls[0] as [
      BladeSpec,
      FlowCondition,
      { elementCount: number; panelStations: number },
    ];
    expect(passedBlade.stations.length).toBe(REFERENCE_BLADE.stations.length);
    expect(passedBlade.tipRadiusM).toBe(REFERENCE_BLADE.tipRadiusM);
    expect(passedFlow).toEqual(REFERENCE_FLOW);
    expect(passedOptions.elementCount).toBe(FAST_BEMT.elementCount);
    expect(passedOptions.panelStations).toBe(FAST_BEMT.panelStations);
  });

  it('returns one element record per requested element', async () => {
    const res = await post(authed, '/solve', {
      blade: REFERENCE_BLADE,
      flow: REFERENCE_FLOW,
      options: { elementCount: 9, panelStations: 24 },
    });
    const bemt = res.body?.bemt as { elements: unknown[] };
    expect(bemt.elements.length).toBe(9);
  });
});

describe('POST /api/rotor/solve — every input is bounded', () => {
  const cases: Array<[string, unknown]> = [
    ['a missing body', {}],
    ['an array body', []],
    ['a blade that is an array', { blade: [], flow: REFERENCE_FLOW }],
    ['a zero tip radius', { blade: blade({ tipRadiusM: 0 }), flow: REFERENCE_FLOW }],
    ['an over-large tip radius', { blade: blade({ tipRadiusM: ROTOR_LIMITS.maxTipRadiusM + 1 }), flow: REFERENCE_FLOW }],
    ['a zero hub radius (the blank-form shape)', { blade: blade({ hubRadiusM: 0 }), flow: REFERENCE_FLOW }],
    ['a hub at the tip radius', { blade: blade({ hubRadiusM: REFERENCE_BLADE.tipRadiusM }), flow: REFERENCE_FLOW }],
    ['a hub outside the tip radius', { blade: blade({ hubRadiusM: 0.2 }), flow: REFERENCE_FLOW }],
    ['a zero blade count', { blade: blade({ bladeCount: 0 }), flow: REFERENCE_FLOW }],
    ['a fractional blade count', { blade: blade({ bladeCount: 2.5 }), flow: REFERENCE_FLOW }],
    ['too many blades', { blade: blade({ bladeCount: ROTOR_LIMITS.maxBladeCount + 1 }), flow: REFERENCE_FLOW }],
    ['a single-station blade', { blade: blade({ stations: [REFERENCE_BLADE.stations[0]] }), flow: REFERENCE_FLOW }],
    [
      'too many stations',
      { blade: bladeWithStations(ROTOR_LIMITS.maxStations + 1), flow: REFERENCE_FLOW, options: FAST_BEMT },
    ],
    ['a zero chord', { blade: bladeWithStationPatch({ chordM: 0 }), flow: REFERENCE_FLOW }],
    ['a radius fraction past the tip', { blade: bladeWithStationPatch({ radiusFrac: 1.5 }), flow: REFERENCE_FLOW }],
    [
      'a zero-thickness section',
      { blade: bladeWithStationPatch({ section: { maxCamber: 0.04, camberPos: 0.4, thickness: 0 } }), flow: REFERENCE_FLOW },
    ],
    [
      'a cambered section with camberPos at the pole 0',
      { blade: bladeWithStationPatch({ section: { maxCamber: 0.04, camberPos: 0, thickness: 0.12 } }), flow: REFERENCE_FLOW },
    ],
    [
      'a cambered section with camberPos at the pole 1',
      { blade: bladeWithStationPatch({ section: { maxCamber: 0.04, camberPos: 1, thickness: 0.12 } }), flow: REFERENCE_FLOW },
    ],
    ['a zero free stream', { blade: REFERENCE_BLADE, flow: flow({ freeStreamMs: 0 }) }],
    ['a zero density', { blade: REFERENCE_BLADE, flow: flow({ densityKgM3: 0 }) }],
    ['a zero viscosity', { blade: REFERENCE_BLADE, flow: flow({ kinematicViscosityM2S: 0 }) }],
    ['a negative rotation', { blade: REFERENCE_BLADE, flow: flow({ rotationRadS: -1 }) }],
    [
      'a fractional element count',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { elementCount: 47.5 } },
    ],
    [
      'a zero element count',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { elementCount: 0 } },
    ],
    [
      'an over-large element count',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { elementCount: ROTOR_LIMITS.maxElementCount + 1 } },
    ],
    [
      'panel stations below the cosine-spacing minimum',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { panelStations: ROTOR_LIMITS.minPanelStations - 1 } },
    ],
    [
      'an over-large panel count',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { panelStations: ROTOR_LIMITS.maxPanelStations + 1 } },
    ],
    [
      'a string physics switch',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, options: { dragEnabled: 'false' } },
    ],
  ];

  for (const [label, body] of cases) {
    it(`refuses ${label} with a 400 and never enters the solver`, async () => {
      expectRefused(await post(authed, '/solve', body), label);
    });
  }

  it('refuses a JSON Infinity, which passes every range comparison a bound can make', async () => {
    const body = `{"blade":${JSON.stringify(REFERENCE_BLADE).replace('"tipRadiusM":0.15', `"tipRadiusM":${JSON_INFINITY}`)},"flow":${JSON.stringify(REFERENCE_FLOW)}}`;
    expectRefused(await post(authed, '/solve', body), 'an infinite tip radius');
  });

  it('refuses an infinite free stream', async () => {
    const body = `{"blade":${JSON.stringify(REFERENCE_BLADE)},"flow":{"freeStreamMs":${JSON_INFINITY},"rotationRadS":33,"densityKgM3":1025,"kinematicViscosityM2S":1.05e-6}}`;
    expectRefused(await post(authed, '/solve', body), 'an infinite free stream');
  });

  it('refuses the DERIVED panel-work ceiling that per-field bounds cannot reach', async () => {
    // 64 stations and 200 panel stations are BOTH individually admissible; their product is 5.1e8
    // panel work units against a 3e8 cap, i.e. seconds of dense Gaussian elimination.
    const stations = ROTOR_LIMITS.maxStations;
    const panelStations = ROTOR_LIMITS.maxPanelStations;
    expect(stations * panelStations ** 3).toBeGreaterThan(ROTOR_LIMITS.maxPanelWorkUnits);
    expectRefused(
      await post(authed, '/solve', {
        blade: bladeWithStations(stations),
        flow: REFERENCE_FLOW,
        options: { panelStations, elementCount: 12 },
      }),
      'the panel-work ceiling',
    );
  });

  it('admits the same station count at the DEFAULT panel resolution, so the ceiling is not a station cap', async () => {
    const res = await post(authed, '/solve', {
      blade: bladeWithStations(ROTOR_LIMITS.maxStations),
      flow: REFERENCE_FLOW,
      options: { elementCount: 8, panelStations: 24 },
    });
    expect(res.status).toBe(200);
    expect(slice.solveBemt).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/rotor/cp-curve — the sweep', () => {
  it('returns one point per tip-speed ratio, in the order asked, with the peak identified', async () => {
    const lambdas = [2, 4, 5, 6, 8];
    const res = await post(authed, '/cp-curve', {
      blade: REFERENCE_BLADE,
      flow: REFERENCE_FLOW,
      lambdas,
      options: FAST_BEMT,
    });
    expect(res.status).toBe(200);
    expect(slice.cpCurve).toHaveBeenCalledTimes(1);

    const points = res.body?.points as Array<{ lambda: number; cp: number }>;
    expect(points.map((p) => p.lambda)).toEqual(lambdas);
    for (const point of points) {
      expect(Number.isFinite(point.cp)).toBe(true);
      // Betz caps a Cp(λ) curve at every point, not only at its peak.
      expect(point.cp).toBeLessThanOrEqual(BETZ_LIMIT);
    }
    const peak = res.body?.peak as { lambda: number; cp: number };
    expect(peak.cp).toBe(Math.max(...points.map((p) => p.cp)));
  });

  it('marks the points the solver could not close, and never names one of them as the peak', async () => {
    // At -15 degrees collective the reference rotor has no BEM solution on part of its span above
    // about lambda 12 — the residual is sign-definite across the whole windmill bracket. The
    // failed elements contribute zero to both integrals, so the cp that comes back looks ordinary.
    const stalled = { ...REFERENCE_BLADE, pitchDeg: -15 };
    const options = { elementCount: 24, panelStations: 24 };

    const mixed = await post(authed, '/cp-curve', {
      blade: stalled,
      flow: REFERENCE_FLOW,
      lambdas: [5, 13, 14],
      options,
    });
    expect(mixed.status).toBe(200);
    const points = mixed.body?.points as Array<{
      lambda: number;
      cp: number;
      allConverged: boolean;
      failedElements: number;
    }>;
    expect(points.some((point) => !point.allConverged)).toBe(true);
    expect(mixed.body?.allConverged).toBe(false);
    expect(mixed.body?.unconvergedLambdas).toEqual(
      points.filter((point) => !point.allConverged).map((point) => point.lambda),
    );
    for (const point of points.filter((p) => !p.allConverged)) expect(point.failedElements).toBeGreaterThan(0);
    const peak = mixed.body?.peak as { lambda: number; cp: number };
    expect(points.find((point) => point.lambda === peak.lambda)?.allConverged).toBe(true);
    expect(peak.cp).toBe(Math.max(...points.filter((point) => point.allConverged).map((point) => point.cp)));

    // ...and when NOTHING converged there is no peak to report, rather than the least-bad fiction.
    const allBroken = await post(authed, '/cp-curve', {
      blade: stalled,
      flow: REFERENCE_FLOW,
      lambdas: [13, 14, 15],
      options,
    });
    expect(allBroken.status).toBe(200);
    expect((allBroken.body?.points as unknown[]).length).toBe(3);
    expect(allBroken.body?.allConverged).toBe(false);
    expect(allBroken.body?.peak).toBeNull();
  });

  const cases: Array<[string, unknown]> = [
    ['a missing lambda list', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW }],
    ['an empty lambda list', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, lambdas: [] }],
    ['a zero tip-speed ratio', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, lambdas: [4, 0] }],
    ['a negative tip-speed ratio', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, lambdas: [-3] }],
    [
      'a tip-speed ratio past the cap',
      { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, lambdas: [ROTOR_LIMITS.maxLambda + 1] },
    ],
    [
      'too many tip-speed ratios',
      {
        blade: REFERENCE_BLADE,
        flow: REFERENCE_FLOW,
        lambdas: Array.from({ length: ROTOR_LIMITS.maxLambdas + 1 }, (_, i) => 1 + i * 0.1),
      },
    ],
    ['a non-numeric tip-speed ratio', { blade: REFERENCE_BLADE, flow: REFERENCE_FLOW, lambdas: ['5'] }],
  ];

  for (const [label, body] of cases) {
    it(`refuses ${label} with a 400 and never enters the sweep`, async () => {
      expectRefused(await post(authed, '/cp-curve', body), label);
    });
  }

  it('refuses the DERIVED element-solve ceiling that per-field bounds cannot reach', async () => {
    // 400 elements and 64 tip-speed ratios are BOTH individually admissible; their product is
    // 25600 synchronous element solves against a 20000 cap.
    const lambdas = Array.from({ length: ROTOR_LIMITS.maxLambdas }, (_, i) => 1 + i * 0.1);
    expect(ROTOR_LIMITS.maxElementCount * lambdas.length).toBeGreaterThan(ROTOR_LIMITS.maxElementSolves);
    expectRefused(
      await post(authed, '/cp-curve', {
        blade: REFERENCE_BLADE,
        flow: REFERENCE_FLOW,
        lambdas,
        options: { elementCount: ROTOR_LIMITS.maxElementCount, panelStations: 24 },
      }),
      'the element-solve ceiling',
    );
  });

  it('admits the same element count for a SINGLE solve, so the ceiling is not an element cap', () => {
    // Called directly rather than over HTTP: this asserts the ceiling's arithmetic, and running a
    // 400-element solve through the router would spend seconds proving nothing extra.
    expect(parseBemtOptions({ elementCount: ROTOR_LIMITS.maxElementCount }, 13, 1).elementCount).toBe(
      ROTOR_LIMITS.maxElementCount,
    );
    expect(() => parseBemtOptions({ elementCount: ROTOR_LIMITS.maxElementCount }, 13, ROTOR_LIMITS.maxLambdas)).toThrow(
      /element solves/,
    );
  });
});

describe('POST /api/rotor/export — the blade as a CAD/print file', () => {
  it('emits every advertised format with a decodable payload', async () => {
    for (const format of ROTOR_EXPORT_FORMATS) {
      const res = await post(authed, '/export', { blade: REFERENCE_BLADE, format, sectionPoints: 12, name: 'guard blade' });
      expect(res.status, `${format} must render`).toBe(200);
      expect(res.body?.format).toBe(format);
      expect(typeof res.body?.payload).toBe('string');
      expect((res.body?.payload as string).length).toBeGreaterThan(0);
      const encoding = res.body?.encoding as 'utf8' | 'base64';
      const decoded = Buffer.from(res.body?.payload as string, encoding === 'base64' ? 'base64' : 'utf8');
      expect(decoded.byteLength, `${format} byteLength must describe the real file`).toBe(res.body?.byteLength);
    }
  });

  it('lofts a WATERTIGHT solid for the mesh formats and reports the verdict', async () => {
    const res = await post(authed, '/export', { blade: REFERENCE_BLADE, format: 'obj', sectionPoints: 24 });
    expect(res.status).toBe(200);
    expect(slice.bladeToMesh).toHaveBeenCalledTimes(1);
    const mesh = res.body?.mesh as { vertices: number; triangles: number; validation: { valid: boolean; watertight: boolean } };
    expect(mesh.validation.watertight).toBe(true);
    expect(mesh.validation.valid).toBe(true);
    expect(mesh.triangles).toBeGreaterThan(0);
  });

  it('sizes the binary STL exactly as the format defines it', async () => {
    const res = await post(authed, '/export', { blade: REFERENCE_BLADE, format: 'stl-binary', sectionPoints: 16 });
    const mesh = res.body?.mesh as { triangles: number };
    expect(res.body?.byteLength).toBe(stlBinaryByteLength(mesh.triangles));
    expect(res.body?.encoding).toBe('base64');
  });

  it('emits an R12 drawing for the DXF format, with no mesh verdict (it is 2-D)', async () => {
    const res = await post(authed, '/export', { blade: REFERENCE_BLADE, format: 'dxf', sectionPoints: 12 });
    expect(res.status).toBe(200);
    expect(res.body?.mesh).toBeNull();
    expect(res.body?.payload as string).toContain(DXF_R12_VERSION);
    expect(slice.bladeToMesh).not.toHaveBeenCalled();
  });

  const cases: Array<[string, unknown]> = [
    ['an unknown format', { blade: REFERENCE_BLADE, format: 'gcode' }],
    ['a missing format', { blade: REFERENCE_BLADE }],
    ['a non-string format', { blade: REFERENCE_BLADE, format: 3 }],
    [
      'a section resolution below the cosine-spacing minimum',
      { blade: REFERENCE_BLADE, format: 'obj', sectionPoints: ROTOR_LIMITS.minSectionPoints - 1 },
    ],
    [
      'a section resolution past the cap',
      { blade: REFERENCE_BLADE, format: 'obj', sectionPoints: ROTOR_LIMITS.maxSectionPoints + 1 },
    ],
    ['a fractional section resolution', { blade: REFERENCE_BLADE, format: 'obj', sectionPoints: 12.5 }],
    ['a malformed blade', { blade: blade({ hubRadiusM: 0 }), format: 'obj' }],
  ];

  for (const [label, body] of cases) {
    it(`refuses ${label} with a 400 and never lofts`, async () => {
      expectRefused(await post(authed, '/export', body), label);
    });
  }

  it('refuses the DERIVED facet ceiling before building the mesh, not after', async () => {
    // 64 stations at 160 points per surface are BOTH admissible; the loft they describe is 40700
    // facets against a 40000 cap — roughly 8 MB of ASCII STL held in memory to be thrown away.
    const res = await post(authed, '/export', {
      blade: bladeWithStations(ROTOR_LIMITS.maxStations),
      format: 'stl',
      sectionPoints: 160,
    });
    expectRefused(res, 'the facet ceiling');
  });
});

describe('POST /api/rotor/harvest — the composition point', () => {
  it('SUBSTITUTES the solved Cp for the hand-typed marine powerCoefficient', async () => {
    const res = await post(authed, '/harvest', HARVEST_BODY);
    expect(res.status).toBe(200);
    expect(slice.solveBemt).toHaveBeenCalledTimes(1);
    expect(slice.simulatePowerBudget).toHaveBeenCalledTimes(1);

    const bemt = res.body?.bemt as { cp: number; allConverged: boolean };
    const turbine = res.body?.turbine as { powerCoefficient: number; sweptAreaM2: number };
    expect(bemt.allConverged).toBe(true);
    expect(turbine.powerCoefficient).toBe(bemt.cp);

    // The assertion that makes the substitution FALSIFIABLE: every marine fixture in this repo
    // hand-types Cp = 0.4, so a route that silently fell through to a typed-in coefficient would
    // land exactly there. A solved Cp does not.
    expect(Math.abs(turbine.powerCoefficient - HAND_TYPED_MARINE_CP)).toBeGreaterThan(0.01);

    // And it is asserted on the CALL, not only on the echo: the config the marine slice actually
    // integrated has to carry the solved number.
    const [passedConfig] = slice.simulatePowerBudget.mock.calls[0] as [
      { turbine: { powerCoefficient: number; sweptAreaM2: number } },
    ];
    expect(passedConfig.turbine.powerCoefficient).toBe(bemt.cp);
    expect(passedConfig.turbine.powerCoefficient).not.toBe(HAND_TYPED_MARINE_CP);
  });

  it('normalises the swept area to the SAME disc area Cp was measured against', async () => {
    const res = await post(authed, '/harvest', HARVEST_BODY);
    const turbine = res.body?.turbine as { sweptAreaM2: number };
    // BemtResult.cp is P / (½ρ·πR²·V³). Any other area and turbinePowerW stops reproducing the
    // shaft power the solver reported.
    expect(turbine.sweptAreaM2).toBeCloseTo(Math.PI * REFERENCE_BLADE.tipRadiusM ** 2, 12);
  });

  it('returns a real closed-loop verdict alongside the solve', async () => {
    const res = await post(authed, '/harvest', HARVEST_BODY);
    const verdict = res.body?.verdict as Record<string, unknown>;
    expect(typeof verdict.perpetual).toBe('boolean');
    expect(verdict.durationHours).toBe(FAST_BUDGET.durationHours);
    for (const key of ['minSocFraction', 'brownoutHours', 'harvestedWh', 'consumedWh', 'meanHarvestW']) {
      expect(Number.isFinite(verdict[key] as number), `verdict.${key} must be a real number`).toBe(true);
    }
    expect((res.body?.samples as unknown[]).length).toBeGreaterThan(0);
    expect((res.body?.samples as unknown[]).length).toBeLessThanOrEqual(ROTOR_LIMITS.maxResponseSamples);
    expect(res.body?.betzLimit).toBe(BETZ_LIMIT);
    expect(res.body?.aboveBetzLimit).toBe(false);
    expect(typeof res.body?.note).toBe('string');
  });

  it('defaults the drivetrain to identities rather than an invented efficiency', async () => {
    const res = await post(authed, '/harvest', HARVEST_BODY);
    const turbine = res.body?.turbine as { drivetrainEfficiency: number; cutInSpeedMs: number };
    expect(turbine.drivetrainEfficiency).toBe(1);
    expect(turbine.cutInSpeedMs).toBe(0);
  });

  it('honours a named drivetrain', async () => {
    const res = await post(authed, '/harvest', {
      ...HARVEST_BODY,
      drivetrain: { efficiency: 0.75, cutInSpeedMs: 0.4, ratedPowerW: 25 },
    });
    const turbine = res.body?.turbine as { drivetrainEfficiency: number; cutInSpeedMs: number; ratedPowerW: number };
    expect(turbine.drivetrainEfficiency).toBe(0.75);
    expect(turbine.cutInSpeedMs).toBe(0.4);
    expect(turbine.ratedPowerW).toBe(25);
  });

  it('REFUSES a rotor solved in a different fluid from the one the budget integrates in', async () => {
    // turbinePowerW hard-codes seawater density. A Cp solved in fresh water re-applied at 1025
    // kg/m³ produces a verdict for a rotor nobody solved — and every per-field bound admits it.
    const res = await post(authed, '/harvest', { ...HARVEST_BODY, flow: flow({ densityKgM3: 1000 }) });
    expectRefused(res, 'a fresh-water solve fed to the seawater budget');
    expect(SEAWATER_DENSITY_KGM3).toBe(1025);
  });

  it('refuses a negative-Cp operating point with a 422 rather than harvesting negative power', async () => {
    // λ = 12 puts the reference rotor deep past its peak, into the branch where it absorbs shaft
    // power. The cube law would render that as a NEGATIVE harvest and the budget would "work".
    const res = await post(authed, '/harvest', {
      ...HARVEST_BODY,
      flow: flow({ rotationRadS: (12 * 1) / REFERENCE_BLADE.tipRadiusM }),
    });
    expect(res.status).toBe(422);
    expect(res.body?.error).toBe('rotor_solution_unusable');
    expect(slice.solveBemt).toHaveBeenCalledTimes(1);
    expect(slice.simulatePowerBudget).not.toHaveBeenCalled();
  });

  const cases: Array<[string, unknown]> = [
    ['a missing site', { ...HARVEST_BODY, site: undefined }],
    ['a site with no constituents', { ...HARVEST_BODY, site: { name: 'empty', constituents: [] } }],
    ['a missing load set', { ...HARVEST_BODY, loads: undefined }],
    ['an empty load set', { ...HARVEST_BODY, loads: [] }],
    ['a duty cycle above 1', { ...HARVEST_BODY, loads: [{ name: 'x', watts: 1, dutyCycle: 1.5 }] }],
    ['a zero-capacity store', { ...HARVEST_BODY, storage: { ...STORAGE, capacityWh: 0 } }],
    ['a malformed blade', { ...HARVEST_BODY, blade: blade({ hubRadiusM: 0 }) }],
    ['a drivetrain efficiency above 1', { ...HARVEST_BODY, drivetrain: { efficiency: 1.5 } }],
    ['a budget span past the harvest ceiling', { ...HARVEST_BODY, options: { durationHours: 1e6 } }],
    ['a budget step/span pair past the integration ceiling', { ...HARVEST_BODY, options: { durationHours: 20000, stepSeconds: 1 } }],
  ];

  for (const [label, body] of cases) {
    it(`refuses ${label} with a 400 and never enters the budget`, async () => {
      expectRefused(await post(authed, '/harvest', body), label);
    });
  }

  it('reuses the harvest surface bounds verbatim rather than keeping a second copy', () => {
    // Two independently-maintained copies of the same bound is how a form and a server end up
    // disagreeing about what is admissible.
    expect(ROTOR_LIMITS.maxLoads).toBe(HARVEST_LIMITS.maxLoads);
    expect(ROTOR_LIMITS.maxConstituents).toBe(HARVEST_LIMITS.maxConstituents);
    expect(ROTOR_LIMITS.maxNameLength).toBe(HARVEST_LIMITS.maxNameLength);
    expect(ROTOR_LIMITS.maxResponseSamples).toBe(HARVEST_LIMITS.maxResponseSamples);
  });
});
