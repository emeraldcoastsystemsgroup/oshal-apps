/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- execute the
 *                     |                             | shipped browser geometry helper and the
 *                     |                             | Python service derivation over identical
 *                     |                             | vectors, including the server's span-cap
 *                     |                             | boundary, at a stated 1e-12 relative/absolute
 *                     |                             | tolerance.
 */

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(PACKAGE_DIR, 'engine');
const GEOMETRY_JS = path.join(PACKAGE_DIR, 'tools', 'aero-lab-geometry.js');
const requireFromHere = createRequire(import.meta.url);
const browserGeometry = requireFromHere(GEOMETRY_JS) as {
  MAX_SPAN_M: number;
  deriveDesignReadouts: (design: Record<string, number>) => Record<string, number>;
};

/** The test uses the same dedicated interpreter contract as the live adapter spec. */
function findEnginePython(): string {
  const candidates = [
    process.env.AERO_LAB_PYTHON || '',
    path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ENGINE_DIR, '.venv', 'bin', 'python'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

const PYTHON = findEnginePython();
const CASES: Array<Record<string, number>> = [
  { area_m2: 0.52, aspect_ratio: 12.019230769230768, battery_mass_kg: 0.4, pack_Wh_per_kg: 250.0 },
  { area_m2: 1.72, aspect_ratio: 18.559593023255814, battery_mass_kg: 2.9170124481327802, pack_Wh_per_kg: 241.0 },
  { area_m2: 0.9, aspect_ratio: 12.019034280644231, battery_mass_kg: 2.042409251864678, pack_Wh_per_kg: 441.83662268579803 },
  // Legal top-of-box geometry: raw sqrt(39.9 * 195) = 88.2 m, server-capped to 79.9 m.
  { area_m2: 195.0, aspect_ratio: 39.9, battery_mass_kg: 500.0, pack_Wh_per_kg: 499.99 },
];

function serverReadouts(cases: Array<Record<string, number>>): Array<Record<string, number>> {
  expect(PYTHON, 'Aero Lab parity requires engine/.venv; run engine/setup-venv').not.toBe('');
  const code = [
    'import json, os, sys',
    'sys.path.insert(0, os.getcwd())',
    'import service',
    'vectors = json.load(sys.stdin)',
    'print(json.dumps([service._design_readouts(v) for v in vectors], allow_nan=False))',
  ].join('; ');
  const run = spawnSync(PYTHON, ['-c', code], {
    cwd: ENGINE_DIR,
    input: JSON.stringify(cases),
    encoding: 'utf8',
    env: { ...process.env, AERO_LAB_ENGINE_DIR: ENGINE_DIR },
  });
  expect(run.status, `Python parity helper failed:\n${run.stderr}`).toBe(0);
  return JSON.parse(run.stdout) as Array<Record<string, number>>;
}

describe('browser/server input-geometry parity', () => {
  it('matches span, mean chord and pack capacity within 1e-12 on shared cases', () => {
    const server = serverReadouts(CASES);
    const browser = CASES.map((design) => browserGeometry.deriveDesignReadouts(design));
    expect(browserGeometry.MAX_SPAN_M).toBe(79.9);
    expect(browser.at(-1)?.span_m).toBe(79.9);
    for (let i = 0; i < CASES.length; i += 1) {
      for (const key of ['span_m', 'mean_chord_m', 'pack_Wh']) {
        const tolerance = 1e-12 * Math.max(1, Math.abs(server[i][key]));
        expect(Math.abs(browser[i][key] - server[i][key]), `case ${i} ${key}`).toBeLessThanOrEqual(tolerance);
      }
    }
  });
});
