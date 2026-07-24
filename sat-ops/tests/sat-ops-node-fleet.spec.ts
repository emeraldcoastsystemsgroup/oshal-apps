/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 06:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Sat-Ops (ADR-102) W1
 *                     |                             | round 3: the REAL sat node + the REAL /api/sat router
 *                     |                             | end-to-end over HTTP loopback (drone-spec pattern):
 *                     |                             | heartbeat join → fleet listing → rate-damp → 20° point
 *                     |                             | settle, plus secret rejection, offline rejection, and
 *                     |                             | 409 propagation. RK4 engine time-scaled 50× so the
 *                     |                             | whole closed loop proves out in seconds of wall clock.
 * 2026-07-19 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Moved out of the OSHAL kernel
 *                     |                             | (tests/unit/) with the carved sat-ops app package
 *                     |                             | (ADR-085 Wave 3): imports flip to ../src-routes/sat-routes;
 *                     |                             | the sat NODE + engine stay kernel-resident and import via
 *                     |                             | @/ aliases. The engine-only offline-rejection case also
 *                     |                             | stays covered kernel-side (sat-orbit-w3.spec.ts).
 */

import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SatFleet, SatCommandError, vNorm } from '@/features/sat-ops';
import { createSatRoutes } from '../src-routes/sat-routes';
import { startSatNode, type RunningSatNode } from '@/app/sat-node-server';

const SECRET = 'sat-ops-e2e-secret';
const API_PORT = 42150;
const NODE_PORT = 42151;
const API = `http://127.0.0.1:${API_PORT}`;

async function until(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function post(path: string, body: unknown, secret?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Service-Secret': secret } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('sat-ops node + fleet end-to-end (real node, real router, HTTP loopback)', () => {
  const fleet = new SatFleet();
  let apiServer: Server;
  let node: RunningSatNode;

  beforeAll(async () => {
    process.env.SWARM_SERVICE_SECRET = SECRET;
    const app = express();
    app.use(express.json());
    // Auth wrapper is server.ts's job (serviceSecretOr(requiresAuth)); the heartbeat route
    // enforces its own secret and is what this spec exercises.
    app.use('/api/sat', createSatRoutes({ fleet }));
    apiServer = await new Promise<Server>((resolve) => {
      const s = app.listen(API_PORT, () => resolve(s));
    });
    node = await startSatNode({
      satId: 'sat-e2e',
      port: NODE_PORT,
      endpointUrl: `http://127.0.0.1:${NODE_PORT}`,
      apiUrl: API,
      engine: 'rk4',
      nasa42Host: '127.0.0.1',
      nasa42Port: 10001,
      timeScale: 50, // 1 wall-second ≈ 50 simulated seconds
      dtSeconds: 0.1,
    });
  }, 20_000);

  afterAll(async () => {
    await node?.stop();
    await new Promise<void>((resolve) => apiServer?.close(() => resolve()));
  });

  it('joins the fleet by authenticated heartbeat and lists online with telemetry', async () => {
    await until(() => fleet.isOnline('sat-e2e'), 5_000, 'first heartbeat');
    const res = await fetch(`${API}/api/sat/fleet`);
    const { fleet: rows } = (await res.json()) as { fleet: any[] };
    const row = rows.find((r) => r.satId === 'sat-e2e');
    expect(row).toBeTruthy();
    expect(row.online).toBe(true);
    expect(row.engine).toBe('rk4');
    expect(row.telemetry.attitudeCalibrated).toBe(true);
    // W2: the initial mild tumble (~2.3°/s) is below the 3°/s emergency threshold, so the
    // machine sits in SAFE (its fault floor / idle equivalent) awaiting an operator command.
    expect(row.telemetry.mode).toBe('SAFE');
  }, 10_000);

  it('rejects an unauthenticated heartbeat', async () => {
    const r = await post('/api/sat/nodes/heartbeat', { satId: 'rogue', endpointUrl: 'http://x', telemetry: {} });
    expect(r.status).toBe(401);
  });

  it('rate-damps the initial tumble via DETUMBLE (legacy rateDamp maps on)', async () => {
    // The node starts in SAFE with the tumble frozen (~2.3°/s). Command detumble and wait for
    // the RATE to actually fall — this only happens once DETUMBLE runs, so it is race-free
    // against the initial SAFE state (which the command is consumed out of on the next tick).
    const r = await post('/api/sat/nodes/sat-e2e/mode', { mode: 'rateDamp' }, SECRET);
    expect(r.status).toBe(200);
    // Wall-clock budgets are deliberately generous: the RK4 pacing loop batches sim steps per
    // 20ms wall tick, so under full-suite parallel load it delivers far fewer sim-seconds per
    // wall-second (seen live 2026-07-18: omega 0.039 at a 15s cutoff that passes alone).
    await until(() => vNorm(node.telemetry().state.omega) < 0.012, 45_000, 'detumble damps the rate < ~0.7°/s');
    // Having fallen below OMEGA_LO, the machine auto-completes DETUMBLE → SAFE.
    await until(() => node.telemetry().mode === 'SAFE', 15_000, 'detumble completes to SAFE');
  }, 65_000);

  it('points 20° (SLEW → POINT) and settles under 1° on the node-local ADCS loop', async () => {
    const r = await post('/api/sat/nodes/sat-e2e/point', { axis: { x: 0, y: 0, z: 1 }, angleDeg: 20 }, SECRET);
    expect(r.status).toBe(200);
    // 20° error ≥ the 10° SLEW-enter threshold → SLEW first (poll — the command applies next tick).
    await until(() => node.telemetry().mode === 'SLEW' || node.telemetry().mode === 'POINT', 5_000, 'enters SLEW');
    await until(() => node.telemetry().mode === 'POINT', 15_000, 'SLEW→POINT convergence');
    await until(() => {
      const err = node.telemetry().pointingErrorDeg;
      return err !== null && err < 1;
    }, 15_000, '20° slew to settle');
  }, 25_000);

  it('propagates a node 409 (bad mode) through the controller route', async () => {
    const r = await post('/api/sat/nodes/sat-e2e/mode', { mode: 'bogus' }, SECRET);
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain('unknown mode');
  });

  it('rejects commands to offline sats before any network I/O', async () => {
    let now = 1_000_000;
    const cold = new SatFleet({
      clock: () => now,
      fetchImpl: async () => { throw new Error('must not dial an offline node'); },
    });
    cold.ingestHeartbeat({
      satId: 'sat-stale',
      endpointUrl: 'http://127.0.0.1:59999',
      engine: 'rk4',
      telemetry: { state: { t: 0, q: { w: 1, x: 0, y: 0, z: 0 }, omega: { x: 0, y: 0, z: 0 }, wheelMomentum: { x: 0, y: 0, z: 0 } }, mode: 'SAFE', pointingErrorDeg: null, attitudeCalibrated: true },
    });
    expect(cold.isOnline('sat-stale')).toBe(true);
    now += 60_000;
    expect(cold.isOnline('sat-stale')).toBe(false);
    await expect(cold.command('sat-stale', 'point', {})).rejects.toThrow(SatCommandError);
  });
});
