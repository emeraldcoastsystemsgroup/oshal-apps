/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 08:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Sat-Ops (ADR-102) W2:
 *                     |                             | POST /api/sat/passes route-boundary behavior over the
 *                     |                             | real router on HTTP loopback (node-fleet spec pattern):
 *                     |                             | validation → 400, ambiguous local time → 400, decayed
 *                     |                             | orbit → 422, wall-clock defaulting, engine tag pass-through.
 * 2026-07-19 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Moved out of the OSHAL kernel
 *                     |                             | (tests/unit/) with the carved sat-ops app package
 *                     |                             | (ADR-085 Wave 3): imports flip to ../src-routes/sat-routes.
 *                     |                             | Run from the package root with the framework checkout on
 *                     |                             | the vitest alias path (movies-envelope precedent).
 */

import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSatRoutes } from '../src-routes/sat-routes';

const PORT = 42152;
const API = `http://127.0.0.1:${PORT}`;

/** Valid ISS-class TLE with correct checksums (mirrors the pass-windows spec builder output). */
function checksum(line68: string): string {
  const s = line68.slice(0, 68).split('').map((c) => (c === '-' ? 1 : /\d/.test(c) ? Number(c) : 0)).reduce((a, b) => a + b, 0) % 10;
  return line68 + String(s);
}
const TLE = [
  checksum('1 90001U 26001A   26018.50000000  .00000000  00000-0  00000-0 0    1'),
  checksum('2 90001  51.6400 247.4627 0003000 130.5360  10.4117 15.50000000  100'),
].join('\n');
const STATION = { latDeg: 45, lonDeg: -93, altKm: 0.25 };

async function post(body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}/api/sat/passes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('POST /api/sat/passes route boundary', () => {
  let server: Server;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/sat', createSatRoutes()); // auth wrapper is server.ts's job
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('400s an empty body and an oversized TLE', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ tle: 'x'.repeat(600), station: STATION })).status).toBe(400);
  });

  it('400s an ambiguous local-time startUtc and unparseable strings', async () => {
    const r = await post({ tle: TLE, station: STATION, startUtc: '2026-01-18T12:00:00' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('zone');
    expect((await post({ tle: TLE, station: STATION, startUtc: 'not-a-date-Z' })).status).toBe(400);
  });

  it('accepts an explicit-zone ISO startUtc and returns the prediction shape', async () => {
    const r = await post({ tle: TLE, station: STATION, startUtc: '2026-01-18T12:00:00Z', elevationMaskDeg: 10 });
    expect(r.status).toBe(200);
    expect(r.body.startUtcMs).toBe(Date.UTC(2026, 0, 18, 12, 0, 0));
    expect(r.body.engine).toBe('sgp4/satellite.js');
    expect(r.body.satnum).toBe(90001);
    expect(typeof r.body.effectiveStepSeconds).toBe('number');
    expect(Array.isArray(r.body.passes)).toBe(true);
  }, 20_000);

  it('defaults startUtc to the wall clock at the route boundary only', async () => {
    const before = Date.now();
    const r = await post({ tle: TLE, station: STATION, horizonHours: 1 });
    expect(r.status).toBe(200);
    expect(r.body.startUtcMs).toBeGreaterThanOrEqual(before - 1000);
    expect(r.body.startUtcMs).toBeLessThanOrEqual(Date.now() + 1000);
  }, 20_000);

  it('422s a decayed/unpropagatable element set', async () => {
    // mean motion 20 rev/day → whole orbit subterranean → satrec.error=6 (decayed).
    const bad = [
      checksum('1 90001U 26001A   26018.50000000  .00000000  00000-0  00000-0 0    1'),
      checksum('2 90001  51.6400 247.4627 0500000 130.5360  10.4117 20.00000000  100'),
    ].join('\n');
    const r = await post({ tle: bad, station: STATION, startUtc: '2026-01-18T12:00:00Z' });
    expect(r.status).toBe(422);
  });

  it('400s out-of-range options through the route', async () => {
    expect((await post({ tle: TLE, station: STATION, startUtc: '2026-01-18T12:00:00Z', horizonHours: 100 })).status).toBe(400);
    expect((await post({ tle: TLE, station: { latDeg: 95, lonDeg: 0, altKm: 0 }, startUtc: '2026-01-18T12:00:00Z' })).status).toBe(400);
  });
});
