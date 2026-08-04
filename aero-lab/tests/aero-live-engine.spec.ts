/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 01:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — LIVE round-trip
 *                     |                             | against the REAL aerosim engine through the real
 *                     |                             | adapter transport. Repo doctrine: no silent skip —
 *                     |                             | if the engine venv is missing this spec FAILS with
 *                     |                             | the exact fix (AERO_LAB_ENGINE_DIR + setup-venv),
 *                     |                             | it does not green-wash. Asserts real physics
 *                     |                             | invariants, not doubles: CD>0 everywhere, CL rises
 *                     |                             | with alpha, finite arrays.
 * 2026-08-03 02:30:00 | maintainer@emeraldcoastsystemsgroup.com | Split the spec by WHICH engine it talks
 *                     |                             | to, because they are not the same tree. The physics
 *                     |                             | assertions now run against the engine VENDORED IN
 *                     |                             | THIS PACKAGE — the bytes the package actually ships,
 *                     |                             | deterministic, ours to keep green. A second block
 *                     |                             | talks to the RESOLVED engine (the concurrently
 *                     |                             | edited scratchpad checkout when it is on the box)
 *                     |                             | and asserts the property that matters for in-flight
 *                     |                             | code: every answer is either real physics or a TYPED
 *                     |                             | refusal from the frozen code set carrying the
 *                     |                             | engine's own words — never a crash, never fabricated
 *                     |                             | numbers — and it PRINTS the drift so a human sees it.
 *                     |                             | Why: on 2026-08-03 the upgrade workflow landed
 *                     |                             | REAL_CHAIN_HONESTY R-1 (pack Wh/kg audited against
 *                     |                             | the certified cell catalogue) plus a billed-wing mass
 *                     |                             | closure, and the live tree now refuses all four
 *                     |                             | shipped presets while the vendored snapshot still
 *                     |                             | runs three. Pinning this package's guards to a tree
 *                     |                             | another workflow is rewriting makes the suite a drift
 *                     |                             | alarm, not a test.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { AeroEngineAdapter, AeroEngineError } from '../src-routes/engine-adapter';
import { DEFAULT_DESIGN, DESIGN_SANITY_BOUNDS } from '../src-routes/aero-lab-routes';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const VENDORED_ENGINE_DIR = path.join(PACKAGE_DIR, 'engine');
const PACKAGED_WORKER = path.join(VENDORED_ENGINE_DIR, 'aero_lab_worker.py');

const RESOLVED_ENGINE_DIR = process.env.AERO_LAB_ENGINE_DIR
  || 'C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim';

/**
 * @description Find a Python 3.11 venv interpreter that can drive the engine. The vendored
 * engine dir has no venv until `engine/setup-venv` runs, so the resolved checkout's venv is
 * accepted for BOTH trees — they carry the same pins (engine/requirements-lock.txt).
 * @returns The interpreter path, or '' when the box has none.
 */
function findVenvPython(): string {
  const candidates = [
    process.env.AERO_LAB_PYTHON || '',
    path.join(VENDORED_ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(VENDORED_ENGINE_DIR, '.venv', 'bin', 'python'),
    path.join(RESOLVED_ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(RESOLVED_ENGINE_DIR, '.venv', 'bin', 'python'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || '';
}

const PYTHON = findVenvPython();

const MISSING_ENGINE_MESSAGE = [
  'LIVE ENGINE ROUND-TRIP CANNOT RUN — no aerosim venv interpreter is on this box.',
  `Looked in: ${VENDORED_ENGINE_DIR}/.venv and ${RESOLVED_ENGINE_DIR}/.venv`,
  'Fix: run engine/setup-venv.ps1 (or engine/setup-venv.sh) to build the dedicated venv',
  'against engine/requirements-lock.txt, or point AERO_LAB_PYTHON at one.',
  'This spec fails loudly instead of skipping — a skipped guard is a guard that does not',
  'exist (repo doctrine).',
].join('\n');

/** Frozen §5b/§2a honest failure codes. Anything outside this set is a transport bug. */
const HONEST_CODES = ['capability_unavailable', 'invalid_design', 'inadmissible_input', 'engine_timeout', 'engine_busy'];

interface PolarResponse {
  polar: { alpha_deg: number[]; CL: number[]; CD: number[]; LD: number[] };
  dragBuildup: Array<{ label: string; CD: number }>;
}

/**
 * The hybrid f=0.80 design the surface ships as a preset (tools/aero-lab.html,
 * key `hybrid80` — the FINAL_PRODUCT craft). Kept here verbatim so the buoyant path
 * is exercised by exactly the vector a user can press.
 */
const HYBRID_80_PRESET: Record<string, number> = {
  area_m2: 0.52, aspect_ratio: 12.019230769230768, taper_ratio: 1.0,
  twist_root_deg: 0.0, twist_tip_deg: 0.0, extra_CD0: 0.00744, fus_over_floor: 1.0,
  battery_mass_kg: 0.3182307005178919, pack_Wh_per_kg: 250.0,
  cell_eff: 0.227, pv_density: 0.45, pv_packing: 0.6923076923076923,
  prop_max_W: 100.0, prop_diameter_m: 0.3,
  payload_W: 2.5308494022630583, payload_mass_kg: 0.1, buoyancy_fraction: 0.8,
  latitude_deg: 47.6, day_of_year: 195, altitude_m: 500.0,
};

describe('LIVE engine round-trip — the engine VENDORED IN THIS PACKAGE (the bytes we ship)', () => {
  const adapter = new AeroEngineAdapter({
    engineDir: VENDORED_ENGINE_DIR,
    appPackageDir: PACKAGE_DIR,
    workerPath: PACKAGED_WORKER,
    pythonPath: PYTHON || undefined,
  });

  afterAll(() => {
    adapter.dispose();
  });

  it('the package ships a complete engine tree and an interpreter exists (loud fail, never a silent skip)', () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    expect(fs.existsSync(path.join(VENDORED_ENGINE_DIR, 'aerosim', '__init__.py'))).toBe(true);
    expect(fs.existsSync(PACKAGED_WORKER)).toBe(true);
    expect(adapter.engineStatus().present).toBe(true);
  });

  it('real capabilities off the vendored tree: python 3.11, polar + evaluate live, fingerprint reported', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    const caps = (await adapter.capabilities()) as {
      python?: string;
      engineDir?: string;
      engineFingerprint?: string;
      capabilities?: Record<string, unknown>;
    };
    expect(String(caps.python || '')).toMatch(/^3\.11/);
    expect(path.resolve(String(caps.engineDir))).toBe(path.resolve(VENDORED_ENGINE_DIR));
    expect(String(caps.engineFingerprint || '')).toMatch(/^[0-9a-f]{8,}$/);
    if (!caps.capabilities?.polar || !caps.capabilities?.evaluate) {
      throw new Error(
        'The VENDORED engine reports polar/evaluate unavailable — the shipped tree is incomplete. ' +
        `Worker said: ${JSON.stringify(caps)}`,
      );
    }
    // eslint-disable-next-line no-console -- deliberate: paste-able live evidence for the build log
    console.log(`VENDORED engine fingerprint=${caps.engineFingerprint} caps=${JSON.stringify(caps.capabilities)}`);
  }, 60_000);

  it('the route layer never refuses a design the engine would accept (sanity bounds ⊇ engine bounds)', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    const caps = (await adapter.capabilities()) as { bounds?: Record<string, [number, number]> };
    const published = caps.bounds || {};
    expect(Object.keys(published).length).toBeGreaterThan(10);
    const narrower: string[] = [];
    for (const [field, [engLo, engHi]] of Object.entries(published)) {
      const sanity = DESIGN_SANITY_BOUNDS[field];
      if (!sanity) {
        narrower.push(`${field}: engine publishes it, the routes have no sanity bound at all`);
        continue;
      }
      const [lo, hi] = sanity;
      if (lo > engLo) narrower.push(`${field}: sanity floor ${lo} > engine floor ${engLo}`);
      if (hi < engHi) narrower.push(`${field}: sanity ceiling ${hi} < engine ceiling ${engHi}`);
    }
    // A sanity bound tighter than the engine's is a 400 for a buildable design — the
    // pre-check exists to reject garbage before a worker spawn, never to shrink the
    // design space the engine actually supports.
    expect(narrower, `route sanity bounds cut the engine's range:\n  ${narrower.join('\n  ')}`).toEqual([]);
  }, 60_000);

  it('real polar on the R7-default design: finite arrays, CD>0, CL rises with alpha', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    const r = (await adapter.request('polar', { design: { ...DEFAULT_DESIGN } })) as PolarResponse;
    const { alpha_deg, CL, CD, LD } = r.polar;
    expect(alpha_deg.length).toBeGreaterThan(5);
    expect(CL.length).toBe(alpha_deg.length);
    expect(CD.length).toBe(alpha_deg.length);
    expect(LD.length).toBe(alpha_deg.length);
    for (const arr of [alpha_deg, CL, CD, LD]) {
      expect(arr.every((x) => Number.isFinite(x))).toBe(true);
    }
    expect(CD.every((x) => x > 0)).toBe(true);
    // Physics, not fixtures: lift increases with alpha over the linear range.
    expect(CL[CL.length - 1]).toBeGreaterThan(CL[0]);
    // A sane solar-endurance wing best L/D is well above single digits.
    expect(Math.max(...LD)).toBeGreaterThan(5);
    expect(Array.isArray(r.dragBuildup)).toBe(true);
    expect(r.dragBuildup.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console -- deliberate: paste-able live evidence for the build log
    console.log(`VENDORED polar: bestLD=${Math.max(...LD).toFixed(2)} alphaPts=${alpha_deg.length} CLrange=[${Math.min(...CL).toFixed(3)}, ${Math.max(...CL).toFixed(3)}]`);
  }, 150_000);

  it('real evaluate on the R7-default design: a 24 h limit cycle with a mass ledger that closes', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    const r = (await adapter.request('evaluate', { design: { ...DEFAULT_DESIGN } })) as {
      build: { massBreakdown: Array<{ label: string; kg: number }>; massAllUpKg: number; packWh: number };
      energy: { t_s: number[]; soc: number[]; p_gen_W: number[]; p_load_W: number[]; minSoc: number; usable: number };
      closed: boolean;
      verdict: { admissible: boolean; reasons: string[] };
    };
    const { energy, build, verdict } = r;
    expect(energy.soc.length).toBeGreaterThan(20);
    expect(energy.t_s.length).toBe(energy.soc.length);
    expect(energy.p_gen_W.length).toBe(energy.soc.length);
    expect(energy.p_load_W.length).toBe(energy.soc.length);
    for (const arr of [energy.t_s, energy.soc, energy.p_gen_W, energy.p_load_W]) {
      expect(arr.every((x) => Number.isFinite(x))).toBe(true);
    }
    // Physics: SOC is a fraction, generation is never negative, load is always positive.
    expect(energy.soc.every((s) => s >= 0 && s <= 1.0000001)).toBe(true);
    expect(energy.p_gen_W.every((p) => p >= 0)).toBe(true);
    expect(energy.p_load_W.every((p) => p > 0)).toBe(true);
    // There is a real night in the window: some samples generate nothing.
    expect(energy.p_gen_W.some((p) => p === 0)).toBe(true);
    expect(energy.minSoc).toBeCloseTo(Math.min(...energy.soc), 6);
    // The billed mass ledger closes on the all-up mass the engine reports.
    const ledger = build.massBreakdown.reduce((a, row) => a + row.kg, 0);
    expect(ledger).toBeCloseTo(build.massAllUpKg, 3);
    expect(build.packWh).toBeGreaterThan(0);
    expect(typeof verdict.admissible).toBe('boolean');
    expect(Array.isArray(verdict.reasons)).toBe(true);
    // eslint-disable-next-line no-console -- deliberate: paste-able live evidence for the build log
    console.log(
      `VENDORED evaluate (R7 default): closed=${r.closed} admissible=${verdict.admissible} ` +
      `minSoc=${energy.minSoc.toFixed(4)} usable=${energy.usable.toFixed(4)} ` +
      `allUp=${build.massAllUpKg.toFixed(3)}kg packWh=${build.packWh.toFixed(1)} socPts=${energy.soc.length}`,
    );
  }, 300_000);

  it('the shipped hybrid f=0.80 preset: real physics or a TYPED refusal, and the outcome is printed', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    const caps = (await adapter.capabilities()) as { capabilities?: { hybrid?: boolean } };
    // The flag means the hybrid MACHINERY imports, not that a buoyant design closes.
    expect(typeof caps.capabilities?.hybrid).toBe('boolean');
    try {
      const r = (await adapter.request('evaluate', { design: { ...HYBRID_80_PRESET } })) as {
        energy: { minSoc: number; usable: number; soc: number[] };
        hybrid: { f_actual: number; volume_m3: number; film_kg: number; helium_kg: number } | null;
        verdict: { admissible: boolean; reasons: string[] };
      };
      expect(r.hybrid).toBeTruthy();
      expect(r.energy.soc.every((s) => Number.isFinite(s))).toBe(true);
      // eslint-disable-next-line no-console -- deliberate: build-log evidence
      console.log(
        `VENDORED evaluate (hybrid f=0.80): ACCEPTED minSoc=${r.energy.minSoc.toFixed(4)} ` +
        `usable=${r.energy.usable.toFixed(4)} f_actual=${r.hybrid?.f_actual} — ` +
        'the buoyant chain now closes; refresh the hybrid preset note in tools/aero-lab.html.',
      );
    } catch (err) {
      // As of 2026-08-03 this is the real state on BOTH trees: the quasi-steady trim
      // stops converging once a BuoyancyVolume is attached, and the study's own
      // HYBRID_common.run_hybrid path fails identically. It must still be a TYPED
      // refusal carrying the engine's words — that is what the surface renders.
      expect(err).toBeInstanceOf(AeroEngineError);
      const e = err as AeroEngineError;
      expect(HONEST_CODES).toContain(e.code);
      expect(e.message.length).toBeGreaterThan(20);
      // eslint-disable-next-line no-console -- deliberate: build-log evidence
      console.log(`VENDORED evaluate (hybrid f=0.80): REFUSED [${e.code}] ${e.message.slice(0, 220)}`);
    }
  }, 300_000);
});

describe('LIVE engine round-trip — the RESOLVED engine (an in-flight tree may refuse; it may never lie)', () => {
  const resolvedPresent = fs.existsSync(RESOLVED_ENGINE_DIR);
  const adapter = new AeroEngineAdapter({
    engineDir: RESOLVED_ENGINE_DIR,
    appPackageDir: PACKAGE_DIR,
    workerPath: PACKAGED_WORKER,
    pythonPath: PYTHON || undefined,
  });

  afterAll(() => {
    adapter.dispose();
  });

  it('reports its own fingerprint, and drift from the vendored snapshot is PRINTED not swallowed', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    if (!resolvedPresent) {
      // Not an error: the documented scratchpad checkout is a dev-box convenience. The
      // adapter falls back to the vendored tree, which the block above gates properly.
      // eslint-disable-next-line no-console -- deliberate: build-log evidence
      console.log(`RESOLVED engine dir absent (${RESOLVED_ENGINE_DIR}) — the vendored engine is the runtime.`);
      return;
    }
    const caps = (await adapter.capabilities()) as { engineFingerprint?: string; capabilities?: Record<string, unknown> };
    expect(String(caps.engineFingerprint || '')).toMatch(/^[0-9a-f]{8,}$/);
    // eslint-disable-next-line no-console -- deliberate: build-log evidence
    console.log(`RESOLVED engine fingerprint=${caps.engineFingerprint} caps=${JSON.stringify(caps.capabilities)}`);
  }, 60_000);

  it('polar on the R7 default is EITHER real physics OR a typed refusal — never a crash, never fake numbers', async () => {
    if (!PYTHON) throw new Error(MISSING_ENGINE_MESSAGE);
    if (!resolvedPresent) return;
    try {
      const r = (await adapter.request('polar', { design: { ...DEFAULT_DESIGN } })) as PolarResponse;
      expect(r.polar.CD.every((x) => x > 0)).toBe(true);
      expect(r.polar.CL[r.polar.CL.length - 1]).toBeGreaterThan(r.polar.CL[0]);
      // eslint-disable-next-line no-console -- deliberate: build-log evidence
      console.log('RESOLVED polar (R7 default): accepted, real physics returned.');
    } catch (err) {
      // The refusal contract: a typed AeroEngineError from the frozen set, carrying the
      // engine's own words. That is what the surface renders — an honest verdict, not data.
      expect(err).toBeInstanceOf(AeroEngineError);
      const e = err as AeroEngineError;
      expect(HONEST_CODES).toContain(e.code);
      expect(e.message.length).toBeGreaterThan(20);
      // eslint-disable-next-line no-console -- deliberate: build-log evidence of live drift
      console.log(`RESOLVED polar (R7 default): REFUSED [${e.code}] ${e.message.slice(0, 200)}`);
    }
  }, 150_000);
});
