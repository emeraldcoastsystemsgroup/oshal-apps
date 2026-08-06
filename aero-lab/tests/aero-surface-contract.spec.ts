/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 03:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — the guard this
 *                     |                             | package was missing. The surface is the deliverable
 *                     |                             | and nothing compiled it: an endpoint the surface
 *                     |                             | calls that the router never registers renders as a
 *                     |                             | silently empty box (the world 1.0.1 lesson), and a
 *                     |                             | shipped preset whose vector the route layer would
 *                     |                             | reject is a button that 400s before the engine ever
 *                     |                             | runs. Three families, all structural, no doubles:
 *                     |                             | (1) every /api/aero-lab path the surface calls is
 *                     |                             | registered by createAeroLabRoutes; (2) every preset
 *                     |                             | and every field in the surface's catalog survives
 *                     |                             | the route layer's own validateDesign, with slider
 *                     |                             | ranges inside the sanity bounds; (3) both surface
 *                     |                             | files parse as the classic scripts the browser gets.
 * 2026-08-06 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Pin the new geometry helper's
 *                     |                             | route, load order and classic-script syntax
 *                     |                             | so browser/server parity cannot be bypassed
 *                     |                             | by shipping the helper without loading it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { describe, expect, it } from 'vitest';
import { validateDesign, DEFAULT_DESIGN, DESIGN_SANITY_BOUNDS } from '../src-routes/aero-lab-routes';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const SURFACE_HTML = path.join(PACKAGE_DIR, 'tools', 'aero-lab.html');
const SURFACE_JS = path.join(PACKAGE_DIR, 'tools', 'aero-lab.js');
const GEOMETRY_JS = path.join(PACKAGE_DIR, 'tools', 'aero-lab-geometry.js');
const ROUTES_TS = path.join(PACKAGE_DIR, 'src-routes', 'aero-lab-routes.ts');

const html = fs.readFileSync(SURFACE_HTML, 'utf8');
const js = fs.readFileSync(SURFACE_JS, 'utf8');
const geometryJs = fs.readFileSync(GEOMETRY_JS, 'utf8');
const routesSrc = fs.readFileSync(ROUTES_TS, 'utf8');

interface PresetEntry { key: string; name: string; needs?: string; v: Record<string, number> }
interface FieldEntry { k: string; min: number; max: number }
interface SurfaceData { presets: PresetEntry[]; fields: FieldEntry[] }

/**
 * @description Evaluate the surface's static data block (`window.AERO_LAB_DATA`) the
 * same way a browser would — in a sandbox with only a `window` object — so the specs
 * read the ACTUAL shipped presets rather than a copy that can drift.
 * @returns The parsed AERO_LAB_DATA object.
 */
function readSurfaceData(): SurfaceData {
  const m = html.match(/window\.AERO_LAB_DATA\s*=\s*\{[\s\S]*?\n\s*\};/);
  if (!m) throw new Error('window.AERO_LAB_DATA block not found in tools/aero-lab.html');
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(m[0], sandbox, { timeout: 5_000 });
  return sandbox.window.AERO_LAB_DATA as SurfaceData;
}

describe('surface ↔ router contract', () => {
  it('every /api/aero-lab path the surface calls is registered by the router', () => {
    // The surface funnels every call through api(method, path) — collect the literals.
    const called = new Set<string>();
    for (const m of js.matchAll(/\bapi\(\s*'(GET|POST)'\s*,\s*'([^']+)'/g)) called.add(m[2]);
    expect(called.size).toBeGreaterThan(5);
    const registered = new Set<string>();
    for (const m of routesSrc.matchAll(/router\.(?:get|post)\(\s*'([^']+)'/g)) registered.add(m[1]);
    const missing = [...called].filter((p) => !registered.has(p));
    expect(missing, `surface calls endpoints the router never registers: ${missing.join(', ')}`).toEqual([]);
  });

  it('the parameterised export-download path the surface builds matches a registered route', () => {
    // Built by string concatenation, so the literal check above cannot see it.
    expect(js).toContain('api/aero-lab/export/');
    expect(routesSrc).toMatch(/router\.get\(\s*'\/export\/:exportId\/:file'/);
  });

  it('the HTML loads the surface script from the route that serves it', () => {
    expect(html).toContain('src="/api/aero-lab/geometry.js"');
    expect(html).toContain('src="/api/aero-lab/app.js"');
    expect(html.indexOf('/api/aero-lab/geometry.js')).toBeLessThan(html.indexOf('/api/aero-lab/app.js'));
    expect(routesSrc).toMatch(/router\.get\(\s*'\/geometry\.js'/);
    expect(routesSrc).toMatch(/router\.get\(\s*'\/app\.js'/);
  });
});

describe('surface presets survive the route layer (a preset that 400s is a broken button)', () => {
  const data = readSurfaceData();

  it('the surface ships the four documented presets', () => {
    expect(data.presets.map((p) => p.key)).toEqual(['tier1', 'fixedwing', 'hybrid80', 'r7winner']);
  });

  for (const preset of data.presets) {
    it(`preset "${preset.key}" validates through the route layer's own validateDesign`, () => {
      const out = validateDesign(preset.v as unknown as Record<string, unknown>);
      expect(out.error, `preset ${preset.key} rejected: ${out.error}`).toBeUndefined();
      expect(out.design).toBeTruthy();
      // Every field the engine needs is present after normalisation.
      expect(Object.keys(out.design as object).sort()).toEqual(Object.keys(DEFAULT_DESIGN).sort());
    });
  }

  it('a buoyant preset declares needs:"hybrid" so the surface can gate it', () => {
    for (const p of data.presets) {
      if ((p.v.buoyancy_fraction || 0) > 0) {
        expect(p.needs, `preset ${p.key} is buoyant but declares no capability gate`).toBe('hybrid');
      }
    }
  });

  it('every slider field is a real design field and its range sits inside the sanity bounds', () => {
    for (const f of data.fields) {
      const bounds = DESIGN_SANITY_BOUNDS[f.k];
      expect(bounds, `slider "${f.k}" is not a design field the routes know`).toBeTruthy();
      expect(f.min, `slider "${f.k}" min ${f.min} is below the sanity floor ${bounds[0]}`).toBeGreaterThanOrEqual(bounds[0]);
      expect(f.max, `slider "${f.k}" max ${f.max} is above the sanity ceiling ${bounds[1]}`).toBeLessThanOrEqual(bounds[1]);
    }
  });

  it('the slider catalog covers every design field — a missing slider is a field a user cannot set', () => {
    const sliders = new Set(data.fields.map((f) => f.k));
    const missing = Object.keys(DEFAULT_DESIGN).filter((k) => !sliders.has(k));
    expect(missing, `design fields with no slider: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('surface files parse as the scripts the browser receives', () => {
  it('tools/aero-lab-geometry.js parses as a classic script', () => {
    expect(() => new vm.Script(geometryJs, { filename: 'aero-lab-geometry.js' })).not.toThrow();
  });

  it('tools/aero-lab.js parses as a classic script', () => {
    expect(() => new vm.Script(js, { filename: 'aero-lab.js' })).not.toThrow();
  });

  it('every inline <script> in tools/aero-lab.html parses as a classic script', () => {
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((src, i) => {
      expect(() => new vm.Script(src, { filename: `aero-lab.html#inline-${i}` })).not.toThrow();
    });
  });
});
