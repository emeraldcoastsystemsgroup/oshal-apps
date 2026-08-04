/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 01:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — route-boundary spec
 *                     |                             | on HTTP loopback (sat-ops-pass-routes pattern, port
 *                     |                             | 42171 per BUILD_CONTRACT §6): the mount refuses
 *                     |                             | unauthenticated callers when wired with the auth
 *                     |                             | param exactly as the manifest loader wires it;
 *                     |                             | engine-absent → honest 503 capability_unavailable
 *                     |                             | (and /capabilities reports present:false as data);
 *                     |                             | malformed design vectors → 400; the frozen §2a
 *                     |                             | error-code map (422/504/503-busy) via an injected
 *                     |                             | adapter double; export downloads allow-listed (a
 *                     |                             | ../ name 404s); /app serves the bundled surface;
 *                     |                             | the concierge degrades bad drafts to say-only.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAeroLabRoutes, validateDesign, parseAeroDesignerEnvelope, DEFAULT_DESIGN } from '../src-routes/aero-lab-routes';
import { AeroEngineAdapter, AeroEngineError } from '../src-routes/engine-adapter';

const PORT = 42171;
const API = `http://127.0.0.1:${PORT}`;
const AUTH = { 'x-test-auth': 'yes' };

/** The auth wrapper exactly as the manifest mount applies it (requiresAuth param pattern). */
function requiresAuthDouble(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-test-auth'] === 'yes') { next(); return; }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * Adapter double for the STATUS-CODE MAP only (§6: transport doubles are legitimate;
 * engine numbers are proven in aero-live-engine.spec.ts). Behavior keyed off the design's
 * area_m2 so one mount exercises every mapped failure.
 */
function scriptedAdapter(workDir: string): AeroEngineAdapter {
  const caps = {
    engineVersion: 'double-0.0.0',
    python: 'double',
    capabilities: { polar: true, evaluate: true, screen: true, mission: false, export: true, hybrid: false, modules: {} },
    bounds: { area_m2: [0.3, 3.0] },
  };
  const double = {
    workDir,
    engineStatus: () => ({ present: true, engineDir: '(double)', python: '(double)', venvOk: true, workerPath: '(double)', workerOk: true }),
    capabilities: async () => caps,
    cachedCapabilities: () => caps,
    dispose: () => undefined,
    request: async (cmd: string, args: Record<string, unknown>) => {
      const design = (args.design || {}) as Record<string, number>;
      if (design.area_m2 === 1.11) throw new AeroEngineError('inadmissible_input', 'mass does not close: pack heavier than lift');
      if (design.area_m2 === 1.22) throw new AeroEngineError('engine_timeout', 'engine evaluate exceeded 300 s and was killed');
      if (design.area_m2 === 1.33) throw new AeroEngineError('engine_busy', 'engine busy — try again shortly');
      if (design.area_m2 === 1.44) throw new AeroEngineError('invalid_design', 'engine bounds: area_m2 rejected');
      if (cmd === 'export') return { exportId: 'exp-test-1', files: ['wing.stl', 'BOM.csv'] };
      return { echo: { cmd, design } };
    },
  };
  return double as unknown as AeroEngineAdapter;
}

describe('aero-lab routes — auth, honesty, and the frozen §2a contract', () => {
  let server: Server;
  let absentDir: string;
  let pkgDir: string;
  let workDir: string;

  beforeAll(async () => {
    delete process.env.AERO_LAB_PYTHON;
    absentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lab-absent-'));
    pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lab-pkg-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lab-work-'));
    fs.mkdirSync(path.join(pkgDir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'tools', 'aero-lab.html'), '<!doctype html><title>Aero Lab</title>AERO-LAB-SURFACE-MARKER');
    fs.mkdirSync(path.join(workDir, 'exports', 'exp-test-1'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'exports', 'exp-test-1', 'wing.stl'), 'solid-wing-bytes');
    fs.writeFileSync(path.join(workDir, 'exports', 'exp-test-1', 'BOM.csv'), 'part,qty');

    const app = express();
    app.use(express.json());
    // Mounted exactly as the manifest loader mounts it: requiresAuth wraps the whole mount.
    app.use('/api/aero-lab/absent', requiresAuthDouble, createAeroLabRoutes({
      adapter: new AeroEngineAdapter({ engineDir: absentDir }),
      ctx: { appPackageDir: pkgDir },
    }));
    app.use('/api/aero-lab', requiresAuthDouble, createAeroLabRoutes({
      adapter: scriptedAdapter(workDir),
      ctx: {
        appPackageDir: pkgDir,
        orchestrator: {
          processMessage: async (_id: string, prompt: string) => {
            if (prompt.includes('give me a bad draft')) return { response: '{"say":"trying","draft":{"area_m2":999}}' };
            if (prompt.includes('give me a hybrid draft')) return { response: '{"say":"hybrid","draft":{"buoyancy_fraction":0.5}}' };
            return { response: '{"say":"a tighter wing","draft":{"area_m2":1.2,"aspect_ratio":14}}' };
          },
        },
      },
    }));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(PORT, () => resolve(s));
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const post = async (route: string, body: unknown, headers: Record<string, string> = AUTH) => {
    const res = await fetch(`${API}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  it('refuses every route unauthenticated when wired with the auth param', async () => {
    for (const url of ['/api/aero-lab/capabilities', '/api/aero-lab/app']) {
      const res = await fetch(`${API}${url}`);
      expect(res.status).toBe(401);
    }
    expect((await post('/api/aero-lab/polar', { design: {} }, {})).status).toBe(401);
    expect((await post('/api/aero-lab/export', { design: {} }, {})).status).toBe(401);
  });

  it('GET /capabilities on an absent engine reports present:false as data (200), with the reason', async () => {
    const res = await fetch(`${API}/api/aero-lab/absent/capabilities`, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engine.present).toBe(false);
    expect(body.capabilities).toBeNull();
    expect(String(body.reason)).toContain('venv');
  });

  it('engine-absent POSTs → honest 503 capability_unavailable with the reason, never fake numbers', async () => {
    for (const route of ['/api/aero-lab/absent/polar', '/api/aero-lab/absent/evaluate', '/api/aero-lab/absent/screen', '/api/aero-lab/absent/export']) {
      const r = await post(route, { design: {} });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('capability_unavailable');
      expect(String(r.body.reason).length).toBeGreaterThan(10);
    }
  });

  it('400s malformed design vectors before any engine work', async () => {
    expect((await post('/api/aero-lab/polar', {})).status).toBe(400);
    expect((await post('/api/aero-lab/polar', { design: { wingspan_m: 3 } })).status).toBe(400);
    expect((await post('/api/aero-lab/polar', { design: { area_m2: 'big' } })).status).toBe(400);
    expect((await post('/api/aero-lab/polar', { design: { area_m2: 9999 } })).status).toBe(400);
    expect((await post('/api/aero-lab/polar', { design: { day_of_year: 90.5 } })).status).toBe(400);
    expect((await post('/api/aero-lab/mission', { design: {}, days: 0 })).status).toBe(400);
  });

  it('maps the frozen engine error codes: 422 / 504 / 503-busy / 400', async () => {
    const r422 = await post('/api/aero-lab/evaluate', { design: { area_m2: 1.11 } });
    expect(r422.status).toBe(422);
    expect(r422.body.error).toContain('mass does not close');
    expect((await post('/api/aero-lab/evaluate', { design: { area_m2: 1.22 } })).status).toBe(504);
    expect((await post('/api/aero-lab/evaluate', { design: { area_m2: 1.33 } })).status).toBe(503);
    expect((await post('/api/aero-lab/evaluate', { design: { area_m2: 1.44 } })).status).toBe(400);
  });

  it('503s buoyancy_fraction > 0 while the hybrid capability is false — never silently drops it', async () => {
    const r = await post('/api/aero-lab/evaluate', { design: { buoyancy_fraction: 0.5 } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('capability_unavailable');
    expect(String(r.body.reason)).toContain('buoyancy');
  });

  it('export → allow-listed per-file downloads; a ../ name and unknown names 404', async () => {
    const r = await post('/api/aero-lab/export', { design: {} });
    expect(r.status).toBe(200);
    expect(r.body.exportId).toBe('exp-test-1');
    expect(r.body.files).toEqual(['wing.stl', 'BOM.csv']);

    const ok = await fetch(`${API}/api/aero-lab/export/exp-test-1/wing.stl`, { headers: AUTH });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('solid-wing-bytes');

    const traversal = await fetch(`${API}/api/aero-lab/export/exp-test-1/..%2FBOM.csv`, { headers: AUTH });
    expect(traversal.status).toBe(404);
    const unknown = await fetch(`${API}/api/aero-lab/export/exp-test-1/notes.txt`, { headers: AUTH });
    expect(unknown.status).toBe(404);
    const badId = await fetch(`${API}/api/aero-lab/export/who-dis/wing.stl`, { headers: AUTH });
    expect(badId.status).toBe(404);
  });

  it('serves the bundled surface from ctx.appPackageDir', async () => {
    const res = await fetch(`${API}/api/aero-lab/app`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('AERO-LAB-SURFACE-MARKER');
  });

  it('concierge: validated draft passes through; out-of-bounds and hybrid drafts degrade to say-only', async () => {
    const good = await post('/api/aero-lab/chat', { message: 'tighter wing please' });
    expect(good.status).toBe(200);
    expect(good.body.draft.area_m2).toBe(1.2);
    expect(good.body.draft.aspect_ratio).toBe(14);
    expect(good.body.draft.taper_ratio).toBe(DEFAULT_DESIGN.taper_ratio);

    const bad = await post('/api/aero-lab/chat', { message: 'give me a bad draft' });
    expect(bad.status).toBe(200);
    expect(bad.body.draft).toBeNull();

    const hybrid = await post('/api/aero-lab/chat', { message: 'give me a hybrid draft' });
    expect(hybrid.status).toBe(200);
    expect(hybrid.body.draft).toBeNull();

    const noOrch = await post('/api/aero-lab/absent/chat', { message: 'hello' });
    expect(noOrch.status).toBe(503);
  });
});

describe('validateDesign + envelope parsing (pure)', () => {
  it('fills defaults, rejects unknown/garbage fields, honors worker bounds without clamping', () => {
    const ok = validateDesign({ area_m2: 1.0 });
    expect('design' in ok && ok.design.aspect_ratio).toBe(DEFAULT_DESIGN.aspect_ratio);
    expect('error' in validateDesign({ nope: 1 })).toBe(true);
    expect('error' in validateDesign({ area_m2: Infinity })).toBe(true);
    expect('error' in validateDesign('span=3')).toBe(true);
    const bounded = validateDesign({ area_m2: 2.5 }, { area_m2: [0.3, 2.0] });
    expect('error' in bounded && bounded.error).toContain('engine bounds');
  });

  it('envelope: malformed JSON degrades to say-only; hybrid gate drops buoyant drafts', () => {
    expect(parseAeroDesignerEnvelope('plain words', false).draft).toBeNull();
    expect(parseAeroDesignerEnvelope('{"say":"x","draft":{"area_m2":"wide"}}', false).draft).toBeNull();
    const gated = parseAeroDesignerEnvelope('{"say":"x","draft":{"buoyancy_fraction":0.4}}', false);
    expect(gated.draft).toBeNull();
    const allowed = parseAeroDesignerEnvelope('{"say":"x","draft":{"buoyancy_fraction":0.4}}', true);
    expect(allowed.draft?.buoyancy_fraction).toBe(0.4);
  });
});
