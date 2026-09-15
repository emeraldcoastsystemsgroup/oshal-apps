/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the actual CAD page and shared viewer with synthetic parts and controlled local HTTP; no engine, database or external traffic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Publish the package's REAL contract for revolve, sweep and loft (and its selector lists) after the synthetic boss, so the form is proven against what the server actually enforces.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Answer the rebuild cancel (BACKLOG B5) in the server's reply shape; the part stays at its revision.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const coreRoot = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!coreRoot) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
export const coreRequire = createRequire(path.join(coreRoot, 'package.json'));
coreRequire('tsx/cjs');
const express = coreRequire('express');
export const { boxStl, observeStlRendering } = coreRequire(path.join(coreRoot, 'tests/fixtures/stl-viewer.ts'));
export const { launchIsolatedBrowser } = coreRequire(path.join(coreRoot, 'tests/fixtures/isolated-browser.ts'));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { describeContract } = createRequire(import.meta.url)(path.join(packageRoot, 'routes', 'feature-contract.js'));
export const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const BASE = '/api/cad-studio';

/** @description A synthetic part with real revision artifact URLs and editable feature metadata. */
export function model(id, width, revision = 1) {
  return { model_id: id, title: id === IDS[0] ? 'Alpha part' : 'Beta part', revision, state: 'built',
    updated_at: `2026-09-13T05:00:${String(revision).padStart(2, '0')}.000Z`, base: { kind: 'box', sizeX: width, sizeY: 40, sizeZ: 30 },
    settings: { densityGcm3: 1.24 }, features: [], feature_status: [],
    report: { extentsMm: { size: [width, 40, 30] }, volumeMm3: width * 1200, surfaceAreaMm2: 1200, massG: 1, densityGcm3: 1.24, faces: 6, edges: 12, vertices: 8, valid: true, centerOfMassMm: [width / 2, 20, 15] },
    artifacts: Object.fromEntries(['stl', 'step', 'report'].map(key => [key, `${BASE}/models/${id}/artifacts/${key}?revision=${revision}`])) };
}

/** @description Return real surface response shapes backed only by test memory. */
function detail(value) {
  return { model: structuredClone(value), engine: { connected: true },
    revisions: Array.from({ length: value.revision }, (_,i) => ({ revision: i + 1, featureCount: 0, volumeMm3: value.base.sizeX * 1200, created_at: value.updated_at })) };
}

/** @description Install synthetic read and mutation routes; every write remains in this fixture's map. */
function routes(app, models, requests, bodyHolds) {
  app.use(express.json());
  app.use((req, _res, next) => { requests.push({ method: req.method, path: req.path, body: req.body }); next(); });
  app.get(BASE + '/capabilities', (_req, res) => {
    const real = describeContract(), sketch = Object.fromEntries(['revolve', 'sweep', 'loft'].map(type => [type, real.features[type]]));
    // The synthetic boss stays FIRST (the default selection every lifecycle case edits).
    res.json({ contract: { ...real, features: { boss: { doc: 'Synthetic boss', required: { height: 'Height' }, optional: {} }, ...sketch } }, defaults: { densityGcm3: 1.24 }, engine: { connected: true } });
  });
  app.get(BASE + '/models', (_req, res) => res.json({ models: [...models.values()].map(value => structuredClone(value)) }));
  app.get(BASE + '/models/:id', (req, res) => { const value = models.get(req.params.id); res.status(value ? 200 : 404).json(value ? detail(value) : { error: 'not_found' }); });
  app.get(BASE + '/models/:id/artifacts/:key', async (req, res) => {
    const value = models.get(req.params.id); if (!value) { res.status(404).end(); return; }
    const width = req.query.revision === '1' && value.model_id === IDS[0] ? 60 : value.base.sizeX;
    const bytes = req.params.key === 'stl' ? Buffer.from(boxStl(width, true)) : Buffer.from('synthetic artifact');
    res.type(req.params.key === 'stl' ? 'model/stl' : 'text/plain');
    const held = bodyHolds.find(item => !item.used && item.id === req.params.id && req.params.key === 'stl');
    if (held) { held.used = true; res.write(bytes.subarray(0, 84)); held.seen(); await held.gate; res.end(bytes.subarray(84)); }
    else res.send(bytes);
  });
  app.post(BASE + '/models/:id/rebuild', (req, res) => {
    const previous = models.get(req.params.id), next = model(req.params.id, 80, previous.revision + 1); models.set(req.params.id, next);
    res.json({ ...detail(next), build: { ok: true, ms: 1 } });
  });
  app.post(BASE + '/models/:id/features', (req, res) => {
    const previous = models.get(req.params.id), next = model(req.params.id, previous.base.sizeX, previous.revision + 1);
    const feature = { id: 'synthetic-feature-' + next.revision, enabled: true, ...req.body };
    next.features = [...previous.features, feature]; next.feature_status = [{ id: feature.id, ok: true }]; models.set(req.params.id, next);
    res.json({ ...detail(next), feature, build: { ok: true, ms: 1 } });
  });
  app.patch(BASE + '/models/:id', (req, res) => {
    const value = models.get(req.params.id); if (req.body.title) value.title = req.body.title;
    if (req.body.settings) value.settings = req.body.settings; res.json(detail(value));
  });
  app.delete(BASE + '/models/:id', (req, res) => { models.delete(req.params.id); res.json({ deleted: true }); });
  app.post(BASE + '/models/:id/cancel', (req, res) => {
    const value = models.get(req.params.id); if (!value) { res.status(404).json({ error: 'model_not_found' }); return; }
    res.json({ cancelled: true, stage: 'inflight', lastGoodRevision: value.revision, model: structuredClone(value) });
  });
}

/** @description Start one ephemeral loopback fixture with actual package HTML and canonical core assets. */
export async function startFixture() {
  const app = express(), models = new Map([[IDS[0], model(IDS[0], 60)], [IDS[1], model(IDS[1], 100)]]), requests = [], bodyHolds = [];
  app.use('/shared/ui', express.static(path.join(coreRoot, 'src/shared/ui')));
  app.use('/cockpit', express.static(path.join(coreRoot, 'src/pages/cockpit')));
  app.get(BASE + '/app', (_req, res) => res.sendFile(path.join(packageRoot, 'tools/cad-studio.html')));
  if (process.env.CAD_LIFECYCLE_SOURCE) app.get(BASE + '/assets/cad-studio.js', (_req, res) => res.sendFile(path.resolve(process.env.CAD_LIFECYCLE_SOURCE)));
  app.use(BASE + '/assets', express.static(path.join(packageRoot, 'tools')));
  routes(app, models, requests, bodyHolds);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, models, requests,
    holdStlBody: id => {
      let release, seen; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { seen = resolve; });
      bodyHolds.push({ id, release, seen, gate, used: false }); return { ready, release };
    },
    close: () => { bodyHolds.forEach(item => item.release()); return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
