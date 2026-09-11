/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — the engine CONTAINER
 *   |                                           | transport across its real seams: the real
 *   |                                           | bridge (engine/container/aero_engine_bridge.py)
 *   |                                           | over a real TCP socket, spawning a real worker
 *   |                                           | process. Only the engine NUMBERS are doubled
 *   |                                           | (the fake-worker protocol double, BUILD_CONTRACT
 *   |                                           | §6); the image itself is proven by the
 *   |                                           | install-time self-test. Also pins the three
 *   |                                           | copies of the baked file set together (TS hash,
 *   |                                           | Python hash, .dockerignore whitelist) and the
 *   |                                           | self-test design to DEFAULT_DESIGN.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AeroEngineAdapter, AeroEngineError, engineInstallHint } from '../src-routes/engine-adapter';
import { ENGINE_RUNTIME_FILES, ENGINE_RUNTIME_TREES, engineBuildHash } from '../src-routes/engine-build-hash';
import { createAeroLabRoutes, DEFAULT_DESIGN } from '../src-routes/aero-lab-routes';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(PACKAGE_DIR, 'engine');
const BRIDGE = path.join(ENGINE_DIR, 'container', 'aero_engine_bridge.py');
const FAKE_WORKER = path.resolve(__dirname, 'fixtures', 'fake-worker.cjs');

/**
 * @description Any python3 runs the bridge (stdlib only). Prefer the configured / vendored venv,
 * then PATH. Repo doctrine: no python → the suite FAILS loudly, it never skips.
 * @returns A runnable interpreter, or '' when the box has none.
 */
function findPython(): string {
  const candidates = [
    process.env.AERO_LAB_PYTHON || '',
    path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ENGINE_DIR, '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean);
  return candidates.find((p) => spawnSync(p, ['--version']).status === 0) || '';
}

const PYTHON = findPython();
const NO_PYTHON = 'The engine-container transport spec needs a python3 to run the real bridge (stdlib only). ' +
  'None found (AERO_LAB_PYTHON, engine/.venv, python3, python). This spec fails loudly instead of skipping.';

function requirePython(): string {
  if (!PYTHON) throw new Error(NO_PYTHON);
  return PYTHON;
}

/** Ask the kernel for a free loopback port. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

interface RunningBridge { proc: ChildProcess; port: number; workRoot: string; stop(): void }

/**
 * @description Start the REAL bridge with the fake worker as its engine, and wait until it listens.
 * @param maxConnections - The bridge's session cap.
 * @returns The running bridge.
 */
async function startBridge(maxConnections = 2): Promise<RunningBridge> {
  const port = await freePort();
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-bridge-work-'));
  const proc = spawn(requirePython(), [BRIDGE, '--host', '127.0.0.1', '--port', String(port), '--max-connections', String(maxConnections)], {
    env: {
      ...process.env,
      AERO_LAB_ENGINE_DIR: ENGINE_DIR,
      AERO_ENGINE_WORK_DIR: workRoot,
      AERO_ENGINE_WORKER_CMD: JSON.stringify([process.execPath, FAKE_WORKER]),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`bridge did not start listening:\n${log}`)), 20_000);
    proc.stderr?.on('data', (d: Buffer) => {
      log += String(d);
      if (log.includes('listening on')) { clearTimeout(timer); resolve(); }
    });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`bridge exited (${code}):\n${log}`)); });
  });
  return { proc, port, workRoot, stop: () => { proc.kill(); } };
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

describe('engine image file set — three copies, one truth', () => {
  it('the TypeScript build hash equals the bridge\'s own hash of the same tree', () => {
    const py = spawnSync(requirePython(), [BRIDGE, '--build-hash', ENGINE_DIR], { encoding: 'utf8' });
    expect(py.status, py.stderr).toBe(0);
    const ts = engineBuildHash(ENGINE_DIR);
    expect(ts).toMatch(/^[0-9a-f]{64}$/);
    expect(ts).toBe(py.stdout.trim());
  });

  it('the .dockerignore whitelist bakes exactly the hashed file set', () => {
    const text = fs.readFileSync(path.join(ENGINE_DIR, '.dockerignore'), 'utf8');
    const whitelisted = text.split(/\r?\n/).filter((l) => l.startsWith('!')).map((l) => l.slice(1).trim()).sort();
    expect(whitelisted).toEqual([...ENGINE_RUNTIME_FILES, ...ENGINE_RUNTIME_TREES].sort());
  });

  it('a one-byte engine change moves the hash (the stale-container guard has teeth)', () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-hash-'));
    fs.cpSync(path.join(ENGINE_DIR, 'aerosim'), path.join(copy, 'aerosim'), { recursive: true });
    fs.copyFileSync(path.join(ENGINE_DIR, 'service.py'), path.join(copy, 'service.py'));
    const before = engineBuildHash(copy);
    fs.appendFileSync(path.join(copy, 'aerosim', 'validate.py'), '#');
    expect(engineBuildHash(copy)).not.toBe(before);
  });

  it('the install self-test flies exactly the routes\' DEFAULT_DESIGN', () => {
    const py = spawnSync(requirePython(), [BRIDGE, '--selftest-design'], { encoding: 'utf8' });
    expect(py.status, py.stderr).toBe(0);
    expect(JSON.parse(py.stdout)).toEqual(DEFAULT_DESIGN);
  });
});

describe('container transport — real bridge, real socket, real worker process', () => {
  let bridge: RunningBridge;
  let adapter: AeroEngineAdapter;
  let workDir: string;

  beforeAll(async () => {
    bridge = await startBridge();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-api-work-'));
    adapter = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${bridge.port}`, appPackageDir: PACKAGE_DIR, workDir });
  }, 30_000);

  afterAll(() => {
    adapter?.dispose();
    bridge?.stop();
  });

  it('selects the container transport and names the install command', () => {
    const status = adapter.engineStatus();
    expect(adapter.transport).toBe('container');
    expect(status.transport).toBe('container');
    expect(status.engineAddr).toBe(`127.0.0.1:${bridge.port}`);
    expect(status.installHint).toBe(engineInstallHint(ENGINE_DIR));
    expect(status.installHint).toMatch(/engine\/install-engine\.sh$/);
  });

  it('round-trips through the bridge after a verified hello', async () => {
    const r = (await adapter.request('polar', { design: { area_m2: 1 } })) as { echo: { cmd: string; args: { design: { area_m2: number } } } };
    expect(r.echo.cmd).toBe('polar');
    expect(r.echo.args.design.area_m2).toBe(1);
  }, 20_000);

  it('passes worker errors through verbatim, codes constrained to the frozen set', async () => {
    const e1 = await rejectionOf(adapter.request('evaluate', { __fail: { code: 'inadmissible_input', message: 'mass does not close' } }));
    expect(e1.code).toBe('inadmissible_input');
    expect(e1.message).toBe('mass does not close');
    const e2 = await rejectionOf(adapter.request('screen', { __fail: { code: 'made_up', message: 'boom' } }));
    expect(e2.code).toBe('engine_error');
  }, 20_000);

  it('export: the bridge pins its own workDir and the files land in the api workDir', async () => {
    const r = (await adapter.request('export', {
      __export: { files: { 'wing.stl': 'solid-wing-bytes', 'BOM.csv': 'part,qty\nspar,1' } },
    })) as { exportId: string; files: string[]; workDirSeen: string; bridgeFiles?: unknown };
    expect(r.exportId).toBe('exp-0123456789ab');
    expect(r.files.sort()).toEqual(['BOM.csv', 'wing.stl']);
    expect(r.bridgeFiles).toBeUndefined();
    // The worker wrote under the BRIDGE's session dir, never the api path the adapter injected.
    expect(path.resolve(r.workDirSeen).startsWith(path.resolve(bridge.workRoot))).toBe(true);
    const dir = path.join(workDir, 'exports', r.exportId);
    expect(fs.readFileSync(path.join(dir, 'wing.stl'), 'utf8')).toBe('solid-wing-bytes');
    expect(fs.readFileSync(path.join(dir, 'BOM.csv'), 'utf8')).toBe('part,qty\nspar,1');
  }, 20_000);

  it('export naming a file outside its directory is refused, never transferred', async () => {
    const err = await rejectionOf(adapter.request('export', {
      __export: { files: { 'BOM.csv': 'x' }, names: ['../evil'] },
    }));
    expect(err.code).toBe('engine_error');
    expect(err.message).toContain('outside its directory');
  }, 20_000);

  it('timeout closes the socket, the bridge kills its worker, and the next command reconnects', async () => {
    const a = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${bridge.port}`, appPackageDir: PACKAGE_DIR, timeoutsMs: { polar: 800 } });
    try {
      const err = await rejectionOf(a.request('polar', { __sleepMs: 60_000 }));
      expect(err.code).toBe('engine_timeout');
      const r = (await a.request('polar', { n: 2 })) as { echo: { args: { n: number } } };
      expect(r.echo.args.n).toBe(2);
    } finally {
      a.dispose();
    }
  }, 30_000);
});

describe('container transport — honest refusal (absent, stale, full)', () => {
  it('no container listening → capability_unavailable naming the install command', async () => {
    const port = await freePort();
    const a = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${port}`, appPackageDir: PACKAGE_DIR });
    try {
      const err = await rejectionOf(a.request('capabilities', {}));
      expect(err.code).toBe('capability_unavailable');
      expect(String(err.reason)).toContain('not running');
      expect(String(err.reason)).toContain('install-engine.sh');
    } finally {
      a.dispose();
    }
  });

  it('a container built from a different engine tree is refused before any command runs', async () => {
    const bridge = await startBridge();
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-stale-pkg-'));
    fs.mkdirSync(path.join(pkg, 'engine', 'aerosim'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'engine', 'aerosim', '__init__.py'), '# a newer engine than the container carries\n');
    const a = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${bridge.port}`, appPackageDir: pkg });
    try {
      const err = await rejectionOf(a.request('polar', { design: {} }));
      expect(err.code).toBe('capability_unavailable');
      expect(String(err.reason)).toContain('out of date');
      expect(String(err.reason)).toContain('install-engine.sh');
    } finally {
      a.dispose();
      bridge.stop();
    }
  }, 30_000);

  it('beyond the bridge connection cap → engine_busy, not a hang', async () => {
    const bridge = await startBridge(1);
    const first = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${bridge.port}`, appPackageDir: PACKAGE_DIR });
    const second = new AeroEngineAdapter({ engineAddr: `127.0.0.1:${bridge.port}`, appPackageDir: PACKAGE_DIR });
    try {
      await first.request('polar', { n: 1 }); // holds its connection (idle shutdown is minutes away)
      const err = await rejectionOf(second.request('polar', { n: 2 }));
      expect(err.code).toBe('engine_busy');
    } finally {
      first.dispose();
      second.dispose();
      bridge.stop();
    }
  }, 30_000);

  it('GET /capabilities reports an absent container as data: 200, present:false, the install command', async () => {
    const port = await freePort();
    const app = express();
    app.use('/api/aero-lab', createAeroLabRoutes({
      adapter: new AeroEngineAdapter({ engineAddr: `127.0.0.1:${port}`, appPackageDir: PACKAGE_DIR }),
      ctx: { appPackageDir: PACKAGE_DIR },
    }));
    const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const { port: httpPort } = server.address() as net.AddressInfo;
      const res = await fetch(`http://127.0.0.1:${httpPort}/api/aero-lab/capabilities`);
      expect(res.status).toBe(200);
      const body = await res.json() as { engine: { present: boolean; transport: string; installHint: string }; capabilities: unknown; reason: string };
      expect(body.engine.present).toBe(false);
      expect(body.engine.transport).toBe('container');
      expect(body.capabilities).toBeNull();
      expect(body.reason).toContain(body.engine.installHint);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
