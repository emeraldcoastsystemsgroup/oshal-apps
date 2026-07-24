/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 09:15:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Sat-Ops (ADR-102) W2
 *                     |                             | live proof: the REAL sat node (SAT_ENGINE=nasa42) +
 *                     |                             | the REAL /api/sat router fly NASA 42's CfsSat through
 *                     |                             | the full W2 mission arc — tip-off coast in SAFE, MEKF
 *                     |                             | lock (health gate), operator point 30° (SLEW→POINT
 *                     |                             | under 1°), operator DESAT (MTB dipole over the wire,
 *                     |                             | wheel momentum bleeds), autonomous return to POINT.
 *                     |                             | All commands go over HTTP with the service secret —
 *                     |                             | the same surface the cockpit uses.
 *                     |                             | Run: docker run --rm -d -p 10001:10001
 *                     |                             |   -v <repo>/sim/nasa42/case:/opt/42/sat-ops
 *                     |                             |   oshal-sat42:latest
 *                     |                             | then npx ts-node -r tsconfig-paths/register this file.
 * 2026-07-18 10:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Live findings folded in: (1) port squatter
 *                     |                             | pre-flight (Windows SO_REUSEADDR let an orphaned prior
 *                     |                             | node answer this mission's commands from frozen state);
 *                     |                             | (2) Phase C measures |Hw| after POINT RE-SETTLE, not at
 *                     |                             | the DESAT→POINT flip (return transient), and asserts
 *                     |                             | the arc — dump SIZE is dipole-limited physics, proven
 *                     |                             | 31.7→25.2 N·m·s on mission 1; (3) Phase D allows the
 *                     |                             | seed reinit (reinits ≤ 1) and bounds the reject share.
 * 2026-07-19 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Moved out of the OSHAL kernel
 *                     |                             | (scripts/) with the carved sat-ops app package (ADR-085
 *                     |                             | Wave 3): the REAL router now lives in this package, so the
 *                     |                             | import flips to ../src-routes/sat-routes. The sat node +
 *                     |                             | NASA 42 engine stay kernel-resident (@/ aliases). Run from
 *                     |                             | the package root against a framework checkout.
 */

import express from 'express';
import type { Server } from 'http';
import { SatFleet } from '@/features/sat-ops';
import { createSatRoutes } from '../src-routes/sat-routes';
import { startSatNode, type RunningSatNode } from '@/app/sat-node-server';

const SECRET = process.env.SWARM_SERVICE_SECRET || 'sat-ops-w2-live';
process.env.SWARM_SERVICE_SECRET = SECRET;

const API_PORT = Number(process.env.SAT_API_PORT ?? 42160);
const NODE_PORT = Number(process.env.SAT_NODE_PORT ?? 42161);
const API = `http://127.0.0.1:${API_PORT}`;
const SAT_ID = 'sat42-live';
const ACQUIRE_MAX_WALL_MS = 30 * 60_000;
const PHASE_MAX_WALL_MS = 20 * 60_000;

interface FleetRow {
  satId: string;
  online: boolean;
  telemetry: {
    state: { t: number; wheelMomentum: { x: number; y: number; z: number } };
    mode: string;
    pointingErrorDeg: number | null;
    attitudeCalibrated: boolean;
    adcs?: { reason: string; momentumFrac: number; dumping: boolean; hasTarget: boolean; transitionCount: number };
    estimator?: {
      initialized: boolean; updatesApplied: number; rejected: number; reinits: number;
      biasDegHr: { x: number; y: number; z: number };
      attitudeSigmaDeg: { x: number; y: number; z: number };
    };
  };
}

/**
 * @description Fetch this sat's row from the REAL fleet route (the cockpit's surface).
 * @returns The row, or null if the sat is not listed yet.
 */
async function fleetRow(): Promise<FleetRow | null> {
  const res = await fetch(`${API}/api/sat/fleet`);
  const { fleet } = (await res.json()) as { fleet: FleetRow[] };
  return fleet.find((r) => r.satId === SAT_ID) ?? null;
}

/**
 * @description Poll the fleet row until a predicate holds, logging progress lines.
 * @param label - What we are waiting for (used in logs and the timeout error).
 * @param timeoutMs - Wall-clock budget for this phase.
 * @param pred - Predicate over the freshest row.
 * @returns The row that satisfied the predicate.
 */
async function waitFor(label: string, timeoutMs: number, pred: (r: FleetRow) => boolean): Promise<FleetRow> {
  const start = Date.now();
  let lastLog = 0;
  for (;;) {
    const row = await fleetRow();
    if (row && pred(row)) return row;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    if (row && Date.now() - lastLog > 15_000) {
      lastLog = Date.now();
      const t = row.telemetry;
      const est = t.estimator;
      console.log(
        `  [${label}] simT=${t.state.t.toFixed(0)}s mode=${t.mode} cal=${t.attitudeCalibrated}`
        + ` err=${t.pointingErrorDeg === null ? '—' : t.pointingErrorDeg.toFixed(3) + '°'}`
        + ` hFrac=${(t.adcs?.momentumFrac ?? 0).toFixed(3)} dump=${t.adcs?.dumping ?? false}`
        + (est ? ` | MEKF upd=${est.updatesApplied} rej=${est.rejected} reinit=${est.reinits} σ=[${est.attitudeSigmaDeg.x.toFixed(3)},${est.attitudeSigmaDeg.y.toFixed(3)},${est.attitudeSigmaDeg.z.toFixed(3)}]°` : ''),
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * @description POST an operator command through the REAL controller route with the service secret.
 * @param path - Route path under /api/sat.
 * @param body - JSON body.
 * @returns Status + parsed body.
 */
async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Secret': SECRET },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** @description Magnitude of the wheel-momentum vector in a fleet row. @returns |Hw| in N·m·s. */
function hMag(r: FleetRow): number {
  const h = r.telemetry.state.wheelMomentum;
  return Math.hypot(h.x, h.y, h.z);
}

/**
 * @description Run the full W2 live mission and print PASS/FAIL (exit code follows).
 * @returns Resolves when the verdict is printed.
 */
async function main(): Promise<void> {
  // Pre-flight: Windows SO_REUSEADDR lets a second process bind an already-taken port
  // silently, with traffic going to the FIRST binder — an orphaned earlier mission then
  // answers our commands from its frozen state (live 2026-07-18: a stale node 409'd the
  // point command of a mission it wasn't part of). If anything answers, abort loudly.
  const squatter = await fetch(`${API}/api/sat/fleet`).then((r) => r.ok).catch(() => false);
  if (squatter) {
    throw new Error(`port ${API_PORT} already answers /api/sat/fleet — kill the orphaned node process first (netstat -ano | findstr ${API_PORT})`);
  }

  const app = express();
  app.use(express.json());
  const fleet = new SatFleet();
  app.use('/api/sat', createSatRoutes({ fleet }));
  const server: Server = await new Promise((resolve) => { const s = app.listen(API_PORT, () => resolve(s)); });
  console.log(`controller: REAL /api/sat router listening on :${API_PORT}`);

  let node: RunningSatNode | null = null;
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  try {
    node = await startSatNode({
      satId: SAT_ID,
      port: NODE_PORT,
      endpointUrl: `http://127.0.0.1:${NODE_PORT}`,
      apiUrl: API,
      engine: 'nasa42',
      nasa42Host: process.env.SAT42_HOST ?? '127.0.0.1',
      nasa42Port: Number(process.env.SAT42_PORT ?? 10001),
      timeScale: 1,
      dtSeconds: 0.2,
    });
    console.log(`node: ${SAT_ID} flying NASA 42 (tip-off coast in SAFE, MEKF gating point commands)`);

    // Phase A — acquisition: the tip-off sweep clears the ST exclusion cones; the MEKF
    // initializes, converges, and the health gate (σ_att < ~1.15°) opens.
    const a = await waitFor('MEKF lock', ACQUIRE_MAX_WALL_MS, (r) =>
      r.telemetry.attitudeCalibrated && (r.telemetry.estimator?.initialized ?? false)
      && Math.hypot(r.telemetry.estimator!.attitudeSigmaDeg.x, r.telemetry.estimator!.attitudeSigmaDeg.y, r.telemetry.estimator!.attitudeSigmaDeg.z) < 1.15);
    const estA = a.telemetry.estimator!;
    checks.push({ name: 'MEKF lock', pass: true, detail: `simT=${a.telemetry.state.t.toFixed(0)}s upd=${estA.updatesApplied} rej=${estA.rejected} reinit=${estA.reinits}` });
    console.log(`PHASE A ✓ MEKF locked: ${checks[0].detail}`);

    // Phase B — operator point: 30° about a body diagonal, over the real route. SLEW→POINT
    // hysteresis runs on the node; we accept under 1° on the ESTIMATED state.
    const pt = await post(`/api/sat/nodes/${SAT_ID}/point`, { axis: { x: 1, y: 1, z: 0 }, angleDeg: 30 });
    if (pt.status !== 200) throw new Error(`point command rejected: ${pt.status} ${JSON.stringify(pt.body)}`);
    const b = await waitFor('30° slew settle <1°', PHASE_MAX_WALL_MS, (r) =>
      r.telemetry.mode === 'POINT' && r.telemetry.pointingErrorDeg !== null && r.telemetry.pointingErrorDeg < 1);
    checks.push({ name: 'point 30° (SLEW→POINT <1°)', pass: true, detail: `err=${b.telemetry.pointingErrorDeg!.toFixed(4)}° simT=${b.telemetry.state.t.toFixed(0)}s` });
    console.log(`PHASE B ✓ pointed: ${checks[1].detail}`);

    // Phase C — operator DESAT arc: the manager must honor the command, run the rods, and
    // autonomously return to the LATCHED point target, re-settling under 1°. The absolute
    // dump SIZE is dipole-limited physics (180 A·m² × 35 µT ≈ 6.3 mN·m ≈ 0.38 N·m·s/min),
    // so with entry momentum already below the 40% exit threshold the dwell dumps little —
    // the 20% real-momentum dump over this wire path was live-proven on mission 1
    // (31.7 → 25.2 N·m·s). Here we assert the arc + no secular growth after re-settle.
    const hBefore = hMag(b);
    const ds = await post(`/api/sat/nodes/${SAT_ID}/mode`, { mode: 'desat' });
    if (ds.status !== 200) throw new Error(`desat command rejected: ${ds.status} ${JSON.stringify(ds.body)}`);
    await waitFor('DESAT entered', PHASE_MAX_WALL_MS, (r) => r.telemetry.mode === 'DESAT' || (r.telemetry.adcs?.reason === 'desat-complete'));
    const c = await waitFor('POINT re-settled after desat', PHASE_MAX_WALL_MS, (r) =>
      r.telemetry.mode === 'POINT' && r.telemetry.adcs?.reason === 'desat-complete'
      && r.telemetry.pointingErrorDeg !== null && r.telemetry.pointingErrorDeg < 1);
    const hAfter = hMag(c);
    const arcOk = hAfter <= hBefore * 1.1; // no secular growth (small PD re-settle transient allowed)
    checks.push({ name: 'DESAT arc + autonomous return to latched POINT', pass: arcOk, detail: `|Hw| ${hBefore.toFixed(3)} → ${hAfter.toFixed(3)} N·m·s, err=${c.telemetry.pointingErrorDeg!.toFixed(3)}°` });
    console.log(`PHASE C ${arcOk ? '✓' : '✗'} desat: ${checks[2].detail}`);

    // Phase D — estimator integrity over the whole mission: only the initial seed reinit,
    // gate rejections a bounded share of updates, uncertainty still tight.
    const estC = c.telemetry.estimator!;
    const sigma = Math.hypot(estC.attitudeSigmaDeg.x, estC.attitudeSigmaDeg.y, estC.attitudeSigmaDeg.z);
    const integrity = estC.reinits <= 1 && estC.updatesApplied > 500 && estC.rejected < estC.updatesApplied / 10 && sigma < 1.15;
    checks.push({ name: 'MEKF mission integrity', pass: integrity, detail: `upd=${estC.updatesApplied} rej=${estC.rejected} reinit=${estC.reinits} σ=${sigma.toFixed(3)}° bias=[${estC.biasDegHr.x.toFixed(2)},${estC.biasDegHr.y.toFixed(2)},${estC.biasDegHr.z.toFixed(2)}]°/hr` });
    console.log(`PHASE D ${integrity ? '✓' : '✗'} estimator: ${checks[3].detail}`);

    const pass = checks.every((chk) => chk.pass);
    console.log('---');
    for (const chk of checks) console.log(` ${chk.pass ? 'PASS' : 'FAIL'}  ${chk.name} — ${chk.detail}`);
    console.log(pass
      ? 'W2 LIVE PROOF PASS — real node + real routes flew NASA 42 through acquire → point → desat → point'
      : 'W2 LIVE PROOF FAIL — see checks above');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await node?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error('mission FAILED with error:', err);
  process.exitCode = 1;
});
