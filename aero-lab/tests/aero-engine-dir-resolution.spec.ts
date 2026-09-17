/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- the engine-dir
 *                     |                             | contract guard (BACKLOG.md B). The package
 *                     |                             | resolved a hard-coded operator-local aerosim
 *                     |                             | checkout BEFORE the tree it vendors, so a box that
 *                     |                             | carried that path answered every preset from an
 *                     |                             | uncertified engine (422 on all four) and a box that
 *                     |                             | did not had a stranger's path quoted back in
 *                     |                             | capability_unavailable and in the engine-container
 *                     |                             | install hint. Three boundaries are covered: the
 *                     |                             | adapter's resolution over a real filesystem, the
 *                     |                             | SHIPPED compiled routes/engine-adapter.js loaded by
 *                     |                             | a plain node process against a package skeleton
 *                     |                             | with no vendored aerosim, and the real
 *                     |                             | engine/service.py resolver in a python subprocess.
 *                     |                             | A fourth case scans every shipped file for an
 *                     |                             | absolute user-home path -- the mechanism that made
 *                     |                             | the wrong tree reachable in the first place.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AeroEngineAdapter } from '../src-routes/engine-adapter';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const VENDORED_ENGINE_DIR = path.join(PACKAGE_DIR, 'engine');
const SHIPPED_ROUTES_DIR = path.join(PACKAGE_DIR, 'routes');
const PROBE_CJS = path.join(__dirname, 'fixtures', 'engine-dir-probe.cjs');
const PROBE_PY = path.join(__dirname, 'fixtures', 'engine-dir-probe.py');
const SERVICE_PY = path.join(VENDORED_ENGINE_DIR, 'service.py');

/** Env this contract reads; every case starts from a clean slate and restores it after. */
const ENGINE_ENV_KEYS = ['AERO_LAB_ENGINE_DIR', 'AERO_LAB_PYTHON', 'AERO_LAB_ENGINE_ADDR', 'OSHAL_APP_PACKAGE_DIR'] as const;

/**
 * Absolute per-person home paths, assembled from fragments so this file can never match
 * itself. The fragments spell the same words the scan looks for.
 */
const USER_HOME_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'windows user profile', re: new RegExp('[A-Za-z]:[\\\\/]{1,2}' + 'Us' + 'ers[\\\\/]', 'i') },
  { label: 'posix home', re: new RegExp('/' + 'ho' + 'me/[A-Za-z0-9._-]+/') },
  { label: 'macos home', re: new RegExp('/' + 'Us' + 'ers/[A-Za-z0-9._-]+/') },
];

/** Directories that are never shipped (build output, caches, virtualenvs, dependencies). */
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '.pytest_cache', 'output', 'dist']);
/** Binary payloads the scan cannot meaningfully read. */
const SCAN_SKIP_EXT = new Set(['.stl', '.dxf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.whl', '.pyc', '.map', '.woff', '.woff2']);

const savedEnv: Record<string, string | undefined> = {};
const scratchDirs: string[] = [];

/**
 * @description Make a throwaway directory under the OS temp dir and remember it for cleanup.
 * @param prefix - mkdtemp prefix.
 * @returns The created directory.
 */
function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

/**
 * @description Build a package skeleton: `<dir>/engine/aerosim/__init__.py` when a vendored
 * engine is wanted, otherwise just the bare directory.
 * @param withAerosim - Whether the skeleton carries a vendored engine tree.
 * @returns The package dir.
 */
function packageSkeleton(withAerosim: boolean): string {
  const dir = scratch('aero-lab-pkg-');
  if (withAerosim) {
    fs.mkdirSync(path.join(dir, 'engine', 'aerosim'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'aerosim', '__init__.py'), '');
  }
  return dir;
}

/**
 * @description Env for a probe subprocess with every engine knob removed, so the child
 * exercises the default resolution and nothing else.
 * @param extra - Values to set on top of the cleaned env.
 * @returns The child environment.
 */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ENGINE_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

/**
 * @description Find an interpreter that can run the python probe: the engine venv first
 * (it is the one the engine really uses), then whatever python is on PATH.
 * @returns The interpreter, or '' when the box has none.
 */
function findPython(): string {
  const candidates = [
    path.join(VENDORED_ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(VENDORED_ENGINE_DIR, '.venv', 'bin', 'python'),
    'python',
    'python3',
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'pass'], { stdio: 'ignore', env: cleanEnv() });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return '';
}

/**
 * @description Walk every shipped file in the package (skipping build output, caches and
 * binaries) and collect its path.
 * @param dir - Directory to walk.
 * @param out - Accumulator.
 * @returns The accumulated file list.
 */
function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SCAN_SKIP_DIRS.has(entry.name)) shippedFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && !SCAN_SKIP_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

beforeEach(() => {
  for (const key of ENGINE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENGINE_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  while (scratchDirs.length) {
    const dir = scratchDirs.pop() as string;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('engine-dir resolution - the vendored engine is the default', () => {
  it('with nothing configured, resolves the tree vendored in THIS package', () => {
    const status = new AeroEngineAdapter({}).engineStatus();
    expect(path.resolve(status.engineDir)).toBe(path.resolve(VENDORED_ENGINE_DIR));
  });

  it("a package context's own engine/aerosim wins over the compiled module's sibling", () => {
    const pkg = packageSkeleton(true);
    const status = new AeroEngineAdapter({ appPackageDir: pkg }).engineStatus();
    expect(path.resolve(status.engineDir)).toBe(path.resolve(path.join(pkg, 'engine')));
    expect(status.installHint).toContain(path.join(pkg, 'engine').replace(/\\/g, '/'));
  });

  it('AERO_LAB_ENGINE_DIR is the one way to reach a tree outside the package', () => {
    const elsewhere = scratch('aero-lab-upstream-');
    process.env.AERO_LAB_ENGINE_DIR = elsewhere;
    const status = new AeroEngineAdapter({}).engineStatus();
    expect(path.resolve(status.engineDir)).toBe(path.resolve(elsewhere));
  });

  it('an explicit engineDir option still beats the environment', () => {
    const envDir = scratch('aero-lab-env-');
    const optDir = scratch('aero-lab-opt-');
    process.env.AERO_LAB_ENGINE_DIR = envDir;
    const status = new AeroEngineAdapter({ engineDir: optDir }).engineStatus();
    expect(path.resolve(status.engineDir)).toBe(path.resolve(optDir));
  });
});

describe('engine-dir resolution - the SHIPPED compiled adapter, loaded as the loader loads it', () => {
  it('names THIS install when no candidate carries a vendored aerosim - never a path outside the package', () => {
    const pkg = packageSkeleton(false);
    fs.mkdirSync(path.join(pkg, 'routes'), { recursive: true });
    for (const file of fs.readdirSync(SHIPPED_ROUTES_DIR)) {
      if (file.endsWith('.js')) fs.copyFileSync(path.join(SHIPPED_ROUTES_DIR, file), path.join(pkg, 'routes', file));
    }

    const out = execFileSync(process.execPath, [PROBE_CJS, path.join(pkg, 'routes', 'engine-adapter.js')], {
      encoding: 'utf8',
      env: cleanEnv(),
    });
    const status = JSON.parse(out) as { engineDir: string; installHint: string };

    expect(path.resolve(status.engineDir)).toBe(path.resolve(path.join(pkg, 'engine')));
    expect(status.installHint).toContain(path.join(pkg, 'engine').replace(/\\/g, '/'));
    // The skeleton itself lives under the OS temp dir, which on some boxes sits inside a user
    // profile - so only the part of the resolved path BEYOND the skeleton may not be a home dir.
    const beyond = path.resolve(status.engineDir).slice(path.resolve(pkg).length);
    for (const { label, re } of USER_HOME_PATTERNS) {
      expect(beyond, label + ' leaked into the resolved engine dir').not.toMatch(re);
    }
  });
});

describe('engine-dir resolution - the worker half (engine/service.py)', () => {
  const python = findPython();

  it('has an interpreter to prove the worker contract with', () => {
    expect(
      python,
      'NO PYTHON ON THIS BOX - the engine/service.py resolver cannot be proven. Install Python 3.11 '
        + 'or build the engine venv (engine/setup-venv.ps1 / engine/setup-venv.sh). This case fails '
        + 'loudly instead of skipping: a guard that skips is a guard that does not exist.',
    ).not.toBe('');
  });

  it('resolves its own directory when AERO_LAB_ENGINE_DIR is unset', () => {
    const out = execFileSync(python, [PROBE_PY, SERVICE_PY], { encoding: 'utf8', env: cleanEnv() });
    const { engineDir } = JSON.parse(out) as { engineDir: string };
    expect(path.resolve(engineDir)).toBe(path.resolve(VENDORED_ENGINE_DIR));
  });

  it('honours AERO_LAB_ENGINE_DIR when it is set', () => {
    const elsewhere = scratch('aero-lab-upstream-py-');
    const out = execFileSync(python, [PROBE_PY, SERVICE_PY], {
      encoding: 'utf8',
      env: cleanEnv({ AERO_LAB_ENGINE_DIR: elsewhere }),
    });
    const { engineDir } = JSON.parse(out) as { engineDir: string };
    expect(path.resolve(engineDir)).toBe(path.resolve(elsewhere));
  });
});

describe('engine-dir resolution - no operator-local path ships in this package', () => {
  it('no shipped file carries an absolute user-home path', () => {
    const offenders: string[] = [];
    for (const file of shippedFiles(PACKAGE_DIR)) {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        for (const { label, re } of USER_HOME_PATTERNS) {
          if (re.test(lines[i])) {
            offenders.push(path.relative(PACKAGE_DIR, file) + ':' + (i + 1) + ' (' + label + ')');
            break;
          }
        }
      }
    }
    expect(
      offenders,
      'A per-person absolute path ships in this package. That is how the engine-dir default came to '
        + "point at one box's aerosim checkout (BACKLOG.md B): every other box then answered from an "
        + 'uncertified tree, or was told to run a command against a directory it does not have. Use a '
        + 'path relative to the package, or an environment variable.',
    ).toEqual([]);
  });

  it('scans a meaningful number of files (an empty scan is not a pass)', () => {
    expect(shippedFiles(PACKAGE_DIR).length).toBeGreaterThan(50);
  });
});
