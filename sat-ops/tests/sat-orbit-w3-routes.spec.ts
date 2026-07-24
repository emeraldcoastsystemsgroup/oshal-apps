/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 12:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation — Sat-Ops (ADR-102) W3:
 *                     |                             | the /api/sat orbit route boundaries over HTTP loopback
 *                     |                             | (catalog CRUD, /track, /conjunctions) and the concierge
 *                     |                             | chat validation boundary (drafts only — whitelist,
 *                     |                             | online sat, finite axis, ≤60°; 400/503 rails).
 * 2026-07-19 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Split out of the kernel's
 *                     |                             | sat-orbit-w3.spec.ts with the carved sat-ops app package
 *                     |                             | (ADR-085 Wave 3): the ROUTE-boundary describes move here
 *                     |                             | (imports flip to ../src-routes/sat-routes); the engine
 *                     |                             | describes (orbit track, conjunction screening, TLE
 *                     |                             | catalog) stay tested in the kernel. Run from the package
 *                     |                             | root with the framework checkout on the vitest alias path.
 */

import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SatFleet, type SatNodeTelemetry } from '@/features/sat-ops';
import { createSatRoutes } from '../src-routes/sat-routes';

const START = Date.UTC(2026, 0, 18, 12, 0, 0);

/** TLE line checksum append (standard mod-10). */
function checksum(line68: string): string {
  const s = line68.slice(0, 68).split('').map((c) => (c === '-' ? 1 : /\d/.test(c) ? Number(c) : 0)).reduce((a, b) => a + b, 0) % 10;
  return line68 + String(s);
}

/** ISS-class TLE with a configurable mean anomaly + satnum (checksums recomputed). */
function makeTle(satnum: string, maDeg: number): string {
  const ma = maDeg.toFixed(4).padStart(8, ' ');
  return [
    checksum(`1 ${satnum}U 26001A   26018.50000000  .00000000  00000-0  00000-0 0    1`),
    checksum(`2 ${satnum}  51.6400 247.4627 0003000 130.5360 ${ma} 15.50000000  100`),
  ].join('\n');
}

describe('sat-ops W3 orbit routes (HTTP loopback)', () => {
  const PORT = 42153;
  const API = `http://127.0.0.1:${PORT}`;
  let server: Server;

  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/sat', createSatRoutes()); // auth wrapper is the mounter's job
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('catalog CRUD round-trip with validation boundaries', async () => {
    expect((await call('PUT', '/api/sat/catalog/sat-a', { tle: 'garbage' })).status).toBe(400);
    expect((await call('PUT', '/api/sat/catalog/bad%20id', { tle: makeTle('90001', 10) })).status).toBe(400);
    const put = await call('PUT', '/api/sat/catalog/sat-a', { tle: makeTle('90001', 10), name: 'Alpha' });
    expect(put.status).toBe(200);
    expect(put.body.entry.satnum).toBe(90001);
    const list = await call('GET', '/api/sat/catalog');
    expect(list.body.catalog).toHaveLength(1);
    expect((await call('DELETE', '/api/sat/catalog/ghost')).status).toBe(404);
    expect((await call('DELETE', '/api/sat/catalog/sat-a')).status).toBe(200);
    expect((await call('GET', '/api/sat/catalog')).body.catalog).toHaveLength(0);
  });

  it('POST /track works from catalog id and inline tle; 404s unknown ids', async () => {
    await call('PUT', '/api/sat/catalog/sat-a', { tle: makeTle('90001', 10) });
    const byId = await call('POST', '/api/sat/track', { satId: 'sat-a', startUtc: START, durationMinutes: 10, stepSeconds: 60 });
    expect(byId.status).toBe(200);
    expect(byId.body.satId).toBe('sat-a');
    expect(byId.body.points.length).toBeGreaterThan(8);
    expect(byId.body.points[0]).toHaveProperty('eciKm');
    expect(byId.body.points[0]).toHaveProperty('latDeg');
    const inline = await call('POST', '/api/sat/track', { tle: makeTle('90002', 11), startUtc: START, durationMinutes: 10 });
    expect(inline.status).toBe(200);
    expect(inline.body.satnum).toBe(90002);
    expect((await call('POST', '/api/sat/track', { satId: 'ghost', startUtc: START })).status).toBe(404);
    expect((await call('POST', '/api/sat/track', {})).status).toBe(400);
    expect((await call('POST', '/api/sat/track', { satId: 'sat-a', startUtc: '2026-01-18T12:00:00' })).status).toBe(400); // zoneless
  });

  it('POST /conjunctions screens the catalog and reports the close pair', async () => {
    await call('PUT', '/api/sat/catalog/close-1', { tle: makeTle('90011', 20.0) });
    await call('PUT', '/api/sat/catalog/close-2', { tle: makeTle('90012', 20.05) });
    const rep = await call('POST', '/api/sat/conjunctions', { ids: ['close-1', 'close-2'], startUtc: START, horizonHours: 2 });
    expect(rep.status).toBe(200);
    expect(rep.body.events.length).toBeGreaterThan(0);
    expect(rep.body.events[0].missKm).toBeLessThan(25);
    expect((await call('POST', '/api/sat/conjunctions', { ids: ['close-1'], startUtc: START })).status).toBe(400); // <2 entries
    expect((await call('POST', '/api/sat/conjunctions', { ids: ['close-1', 'ghost'], startUtc: START })).status).toBe(400);
  });
});

describe('sat-ops W3 concierge chat (drafts only — validation boundary)', () => {
  const PORT = 42154;
  const API = `http://127.0.0.1:${PORT}`;
  let server: Server;
  let modelReply = '';

  const tele = (mode: string): SatNodeTelemetry => ({
    state: { t: 0, q: { w: 1, x: 0, y: 0, z: 0 }, omega: { x: 0, y: 0, z: 0 }, wheelMomentum: { x: 0, y: 0, z: 0 } },
    mode: mode as SatNodeTelemetry['mode'],
    pointingErrorDeg: null,
    attitudeCalibrated: true,
  });

  const chat = async (message: string): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${API}/api/sat/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    let now = 1_000_000;
    const fleet = new SatFleet({ clock: () => now, fetchImpl: async () => { throw new Error('no dial in chat tests'); } });
    fleet.ingestHeartbeat({ satId: 'sat-live', endpointUrl: 'http://x', engine: 'rk4', telemetry: tele('SAFE') });
    now += 60_000; // sat-stale ages out; re-beat only sat-live
    fleet.ingestHeartbeat({ satId: 'sat-live', endpointUrl: 'http://x', engine: 'rk4', telemetry: tele('SAFE') });
    fleet.ingestHeartbeat({ satId: 'sat-old', endpointUrl: 'http://y', engine: 'rk4', telemetry: tele('SAFE') });
    now += 45_000; // sat-old goes stale (45s > 30s window), sat-live re-beats below
    fleet.ingestHeartbeat({ satId: 'sat-live', endpointUrl: 'http://x', engine: 'rk4', telemetry: tele('SAFE') });
    const ctx = { orchestrator: { processMessage: async (): Promise<{ response: string }> => ({ response: modelReply }) } };
    const app = express();
    app.use(express.json());
    app.use('/api/sat', createSatRoutes({ fleet, ctx }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('passes a valid point draft for an ONLINE sat through', async () => {
    modelReply = '{"say":"Drafted a 30° slew.","draft":{"satId":"sat-live","command":"point","axis":{"x":1,"y":1,"z":0},"angleDeg":30}}';
    const r = await chat('point it please');
    expect(r.status).toBe(200);
    expect(r.body.say).toContain('Drafted');
    expect(r.body.draft).toMatchObject({ satId: 'sat-live', command: 'point', angleDeg: 30 });
  });

  it('strips drafts that violate the contract (offline sat, bad angle, bogus command, junk)', async () => {
    for (const bad of [
      '{"say":"x","draft":{"satId":"sat-old","command":"detumble"}}',            // stale sat
      '{"say":"x","draft":{"satId":"ghost","command":"safe"}}',                  // unknown sat
      '{"say":"x","draft":{"satId":"sat-live","command":"point","axis":{"x":1,"y":0,"z":0},"angleDeg":90}}', // >60°
      '{"say":"x","draft":{"satId":"sat-live","command":"point","axis":{"x":0,"y":0,"z":0},"angleDeg":30}}', // zero axis
      '{"say":"x","draft":{"satId":"sat-live","command":"selfdestruct"}}',       // bogus command
    ]) {
      modelReply = bad;
      const r = await chat('do the thing');
      expect(r.status).toBe(200);
      expect(r.body.draft).toBeNull();
    }
    modelReply = 'no json at all, just prose';
    const r = await chat('hello');
    expect(r.body.say).toContain('no json');
    expect(r.body.draft).toBeNull();
  });

  it('400s empty messages and 503s when no orchestrator is wired', async () => {
    expect((await chat('')).status).toBe(400);
    const bare = express();
    bare.use(express.json());
    bare.use('/api/sat', createSatRoutes()); // no ctx
    const s2 = await new Promise<Server>((resolve) => { const s = bare.listen(42155, () => resolve(s)); });
    const res = await fetch('http://127.0.0.1:42155/api/sat/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
    });
    expect(res.status).toBe(503);
    await new Promise<void>((resolve) => s2.close(() => resolve()));
  });
});
