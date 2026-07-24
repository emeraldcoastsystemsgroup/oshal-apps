/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-12 02:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Regression lock for the resume-link 404 (dev-bot RCA c36c5dfb): GET /resume/:id must route (alias for /resume?id=), the query shape must keep working, and the alias must not shadow the static /resume/state route.
 */

import express from 'express';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCareerHunterRoutes } from '../src-routes/career-hunter-routes';
import type { AppContext } from '../../src/app/composition/app-context';

// A sub no local data dir exists for — openUserDb() returns null, so a MATCHED
// data route answers JSON ({error:'no data'}/400), while an UNMATCHED path falls
// through to Express's default HTML 404. That difference is the assertion.
const TEST_SUB = 'test|resume-alias-spec';

let server: ReturnType<typeof express.application.listen>;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { oidc: { user: { sub: string } } }).oidc = { user: { sub: TEST_SUB } };
    next();
  });
  app.use('/api/career-hunter', createCareerHunterRoutes({ pool: {} } as unknown as AppContext));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('career-hunter GET /resume/:id alias (route-shape mismatch fix)', () => {
  it('routes the path shape /resume/<id> instead of 404ing at the router', async () => {
    const res = await fetch(`${baseUrl}/api/career-hunter/resume/1053679`);
    // Route matched: JSON "no data" for a user with no store — NOT the HTML default-404.
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'no data' });
  });

  it('keeps the original query shape /resume?id=&kind= working identically', async () => {
    const res = await fetch(`${baseUrl}/api/career-hunter/resume?id=1053679&kind=cover`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no data' });
  });

  it('rejects a non-numeric :id with 400 (never treats it as a file path)', async () => {
    const res = await fetch(`${baseUrl}/api/career-hunter/resume/not-a-number`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'id required' });
  });

  it('does not shadow the static /resume/state route (alias registered last)', async () => {
    const res = await fetch(`${baseUrl}/api/career-hunter/resume/state`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasResume: boolean; scored: number };
    expect(body).toHaveProperty('hasResume', false);
    expect(body).toHaveProperty('scored', 0);
  });
});
