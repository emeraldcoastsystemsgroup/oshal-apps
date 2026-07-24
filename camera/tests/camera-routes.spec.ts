/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-19 03:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Camera Ops route-boundary
 *                     |                             | behavior over the REAL router on HTTP loopback (sat/ambient
 *                     |                             | route-spec pattern): control→sim wiring, the 428 destructive
 *                     |                             | confirm gate, the 401 node-heartbeat secret guard + happy
 *                     |                             | mint, the /app surface serving, and the concierge executing
 *                     |                             | an interpreted command via a mocked orchestrator.
 * 2026-07-19 14:25:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Moved out of the OSHAL kernel
 *                     |                             | (tests/unit/camera-routes.spec.ts) with the carved camera
 *                     |                             | app package (ADR-085 Wave 3): imports flip to
 *                     |                             | ../src-routes/camera-routes. Run from the package root
 *                     |                             | with the framework checkout on the vitest alias path
 *                     |                             | (movies-envelope precedent).
 */

import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCameraRoutes } from '../src-routes/camera-routes';
import type { AppContext } from '@/app/composition/app-context';

const PORT = 42207;
const API = `http://127.0.0.1:${PORT}`;
const SECRET = 'camera-test-secret';

/** Mock AppContext: an inert pool (audit/schema writes resolve empty) + a scripted orchestrator. */
const ctx = {
  pool: { query: async () => ({ rows: [] }) },
  orchestrator: { processMessage: async () => ({ response: '{"say":"Recording now.","action":{"op":"record"}}' }) },
} as unknown as AppContext;

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* html/other */ }
  return { status: res.status, body: parsed, text };
}

describe('Camera Ops routes (boundary)', () => {
  let server: Server;

  beforeAll(async () => {
    process.env.MOCK_OIDC = 'true';
    process.env.SWARM_SERVICE_SECRET = SECRET;
    const app = express();
    app.use(express.json());
    app.use('/api/camera', createCameraRoutes(ctx)); // auth wrapper is the mounter's job
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('lists the embedded sim in the fleet', async () => {
    const r = await req('GET', '/api/camera/fleet');
    expect(r.status).toBe(200);
    expect(r.body.fleet.map((c: any) => c.cameraId)).toContain('sim-1');
  });

  it('records then stops via /control and produces a capture', async () => {
    expect((await req('POST', '/api/camera/control', { cameraId: 'sim-1', op: 'record' })).body.telemetry.recording).toBe(true);
    const stop = await req('POST', '/api/camera/control', { cameraId: 'sim-1', op: 'stop' });
    expect(stop.status).toBe(200);
    expect(stop.body.telemetry.recording).toBe(false);
    const caps = await req('GET', '/api/camera/captures?cameraId=sim-1');
    expect(caps.body.captures.length).toBeGreaterThanOrEqual(1);
  });

  it('422s an invalid command op', async () => {
    const r = await req('POST', '/api/camera/control', { cameraId: 'sim-1', op: 'nope' });
    expect(r.status).toBe(422);
  });

  it('gates deleteAll behind a confirm (428 → 200)', async () => {
    const gated = await req('POST', '/api/camera/control', { cameraId: 'sim-1', op: 'deleteAll' });
    expect(gated.status).toBe(428);
    expect(gated.body.confirmationRequired).toBe(true);
    const confirmed = await req('POST', '/api/camera/control', { cameraId: 'sim-1', op: 'deleteAll', confirm: true });
    expect(confirmed.status).toBe(200);
  });

  it('requires the service secret for node heartbeats, then mints the remote', async () => {
    const noSecret = await req('POST', '/api/camera/nodes/heartbeat', { cameraId: 'gopro-1', endpointUrl: 'http://127.0.0.1:4200', engine: 'gopro', telemetry: { cameraId: 'gopro-1' } });
    expect(noSecret.status).toBe(401);
    const ok = await req('POST', '/api/camera/nodes/heartbeat',
      { cameraId: 'gopro-1', endpointUrl: 'http://127.0.0.1:4200', engine: 'gopro', telemetry: { cameraId: 'gopro-1', status: 'connected', mode: 'video', model: 'HERO9 Black', recording: false, connected: true, recordElapsedS: 0, previewActive: false, settings: {}, lastCaptureSeq: 0 }, events: [] },
      { 'X-Service-Secret': SECRET });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.ack).toBe('number');
    const fleet = await req('GET', '/api/camera/fleet');
    expect(fleet.body.fleet.map((c: any) => c.cameraId)).toContain('gopro-1');
  });

  it('serves the cockpit surface HTML at /app', async () => {
    const r = await req('GET', '/api/camera/app');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Camera Ops');
    expect(r.text.toLowerCase()).toContain('<!doctype html>');
  });

  it('concierge interprets NL and executes the command', async () => {
    const r = await req('POST', '/api/camera/chat', { message: 'start recording', cameraId: 'sim-1' });
    expect(r.status).toBe(200);
    expect(r.body.reply).toContain('Recording');
    expect(r.body.executed?.op).toBe('record');
  });
});
