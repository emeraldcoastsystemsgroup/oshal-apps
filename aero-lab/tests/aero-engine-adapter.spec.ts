/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 01:05:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — adapter transport
 *                     |                             | spec against the fake-worker protocol double
 *                     |                             | (BUILD_CONTRACT §6): round-trip, honest worker-error
 *                     |                             | passthrough (codes preserved verbatim, never
 *                     |                             | swallowed), non-JSON stdout dropped, wall-clock
 *                     |                             | timeout → kill → engine_timeout → clean restart,
 *                     |                             | FIFO queue cap → engine_busy, and the engine-absent
 *                     |                             | paths (missing dir / missing venv / missing worker →
 *                     |                             | capability_unavailable with the exact reason). The
 *                     |                             | double fakes the TRANSPORT only — engine numbers are
 *                     |                             | proven in aero-live-engine.spec.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AeroEngineAdapter, AeroEngineError } from '../src-routes/engine-adapter';

const FAKE_WORKER = path.resolve(__dirname, 'fixtures', 'fake-worker.cjs');

/** Adapter over the node protocol double (pythonPath/workerPath are injectable). */
function fakeAdapter(overrides: ConstructorParameters<typeof AeroEngineAdapter>[0] = {}): AeroEngineAdapter {
  return new AeroEngineAdapter({
    engineDir: os.tmpdir(),
    pythonPath: process.execPath,
    workerPath: FAKE_WORKER,
    ...overrides,
  });
}

async function rejectionOf(p: Promise<unknown>): Promise<AeroEngineError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AeroEngineError);
    return err as AeroEngineError;
  }
  throw new Error('expected the promise to reject');
}

describe('AeroEngineAdapter transport (protocol double)', () => {
  let adapter: AeroEngineAdapter;

  beforeAll(() => {
    adapter = fakeAdapter();
  });

  afterAll(() => {
    adapter.dispose();
  });

  it('round-trips a command and returns the worker result verbatim', async () => {
    const r = (await adapter.request('polar', { design: { area_m2: 1 } })) as { echo: { cmd: string; args: Record<string, unknown> } };
    expect(r.echo.cmd).toBe('polar');
    expect((r.echo.args.design as Record<string, unknown>).area_m2).toBe(1);
  });

  it('surfaces worker errors honestly — code and message preserved verbatim', async () => {
    const err = await rejectionOf(adapter.request('evaluate', { __fail: { code: 'inadmissible_input', message: 'mass does not close: pack heavier than MTOW' } }));
    expect(err.code).toBe('inadmissible_input');
    expect(err.message).toBe('mass does not close: pack heavier than MTOW');

    const err2 = await rejectionOf(adapter.request('polar', { __fail: { code: 'invalid_design', message: 'area_m2 out of bounds' } }));
    expect(err2.code).toBe('invalid_design');

    const err3 = await rejectionOf(adapter.request('mission', { __fail: { code: 'capability_unavailable', message: 'mission module not importable' } }));
    expect(err3.code).toBe('capability_unavailable');
    expect(err3.reason).toContain('mission module');
  });

  it('constrains unknown worker error codes to engine_error (frozen code set)', async () => {
    const err = await rejectionOf(adapter.request('screen', { __fail: { code: 'made_up_code', message: 'boom' } }));
    expect(err.code).toBe('engine_error');
    expect(err.message).toBe('boom');
  });

  it('drops non-JSON stdout lines (worker bug) and still settles the request', async () => {
    const r = (await adapter.request('screen', { __garbage: true, design: { x: 1 } })) as { echo: { cmd: string } };
    expect(r.echo.cmd).toBe('screen');
  });

  it('caches capabilities and reports the double honestly', async () => {
    const caps = (await adapter.capabilities()) as { capabilities: { hybrid: boolean }; bounds: Record<string, [number, number]> };
    expect(caps.capabilities.hybrid).toBe(false);
    expect(caps.bounds.area_m2).toEqual([0.3, 3.0]);
    expect(adapter.cachedCapabilities()).toBe(caps);
  });
});

describe('AeroEngineAdapter timeout → kill → restart', () => {
  it('kills the worker on wall-clock expiry, rejects engine_timeout, then recovers', async () => {
    const a = fakeAdapter({ timeoutsMs: { polar: 700 } });
    try {
      const err = await rejectionOf(a.request('polar', { __sleepMs: 60_000 }));
      expect(err.code).toBe('engine_timeout');
      expect(err.message).toContain('polar');
      // The next request lazily respawns a fresh worker.
      const r = (await a.request('polar', { design: { ok: true } })) as { echo: { cmd: string } };
      expect(r.echo.cmd).toBe('polar');
    } finally {
      a.dispose();
    }
  }, 20_000);
});

describe('AeroEngineAdapter FIFO queue cap', () => {
  it('rejects engine_busy beyond the cap and completes everything queued', async () => {
    const a = fakeAdapter({ queueCap: 2 });
    try {
      const slow = a.request('polar', { __sleepMs: 800, n: 0 });
      const q1 = a.request('polar', { n: 1 });
      const q2 = a.request('polar', { n: 2 });
      const overflow = await rejectionOf(a.request('polar', { n: 3 }));
      expect(overflow.code).toBe('engine_busy');
      const results = (await Promise.all([slow, q1, q2])) as Array<{ echo: { args: { n: number } } }>;
      expect(results.map((r) => r.echo.args.n)).toEqual([0, 1, 2]);
    } finally {
      a.dispose();
    }
  }, 20_000);
});

describe('AeroEngineAdapter engine-absent honesty (no fallback, no fabrication)', () => {
  const originalPython = process.env.AERO_LAB_PYTHON;

  beforeAll(() => {
    delete process.env.AERO_LAB_PYTHON;
  });

  afterAll(() => {
    if (originalPython !== undefined) process.env.AERO_LAB_PYTHON = originalPython;
  });

  it('missing engine dir → capability_unavailable naming AERO_LAB_ENGINE_DIR', async () => {
    const a = new AeroEngineAdapter({ engineDir: path.join(os.tmpdir(), 'aero-lab-definitely-missing-dir') });
    const err = await rejectionOf(a.request('polar', {}));
    expect(err.code).toBe('capability_unavailable');
    expect(String(err.reason)).toContain('AERO_LAB_ENGINE_DIR');
    expect(a.engineStatus().present).toBe(false);
  });

  it('engine dir with no venv → capability_unavailable naming the venv, never system python', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lab-empty-engine-'));
    const a = new AeroEngineAdapter({ engineDir: empty });
    const status = a.engineStatus();
    expect(status.present).toBe(false);
    expect(status.venvOk).toBe(false);
    expect(status.python).toContain('.venv');
    const err = await rejectionOf(a.request('capabilities', {}));
    expect(err.code).toBe('capability_unavailable');
    expect(String(err.reason)).toContain('venv');
  });

  it('venv present but worker script missing → capability_unavailable naming the worker', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lab-noworker-'));
    const a = new AeroEngineAdapter({ engineDir: empty, pythonPath: process.execPath, workerPath: path.join(empty, 'engine', 'aero_lab_worker.py') });
    const status = a.engineStatus();
    expect(status.present).toBe(false);
    expect(status.workerOk).toBe(false);
    const err = await rejectionOf(a.request('polar', {}));
    expect(err.code).toBe('capability_unavailable');
    expect(String(err.reason)).toContain('worker');
  });
});
