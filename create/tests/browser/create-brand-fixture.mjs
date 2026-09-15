/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the real Brand Kit page, Home and editor over the synthetic editor fixture plus an in-memory brand API that validates with the shipped brand module.
 */
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startEditorFixture } from './create-editor-fixture.mjs';
import { validateBrandKit, describeBrandKit, logoAssetId } from '../../tools/editor/brand-kit.mjs';

export { chromium, syntheticImage } from './create-editor-fixture.mjs';

function brandState(options) {
  const kit = options.kit ? validateBrandKit(options.kit) : null;
  return { kit, revision: kit ? 1 : 0, read: options.brand?.read ?? true, change: options.brand?.change ?? true, writes: [] };
}

function reply(brand) {
  return { kit: brand.kit, revision: brand.revision, updatedAt: brand.kit ? '2026-09-13T12:00:00.000Z' : null, canChange: brand.change,
    words: brand.kit ? describeBrandKit(brand.kit) : null };
}

function pages(app, packageRoot) {
  app.get('/api/create/brand', (_req, res) => res.sendFile(resolve(packageRoot, 'tools/create-brand.html')));
  app.get('/api/create/home', (_req, res) => res.sendFile(resolve(packageRoot, 'tools/create-home.html')));
  app.get('/api/authorization/me', (_req, res) => res.json({ status: 'legacy' }));
}

function kitRoutes(app, state, brand) {
  const allow = key => (_req, res, next) => (state.permissions.view && brand[key] ? next() : res.status(403).json({ error: 'brand_permission_denied' }));
  app.get('/api/create/brand-kit', allow('read'), (_req, res) => res.json(reply(brand)));
  app.put('/api/create/brand-kit', allow('change'), (req, res) => {
    if (req.body.baseRevision !== brand.revision) return res.status(409).json({ error: 'brand_revision_conflict' });
    let kit;
    try { kit = validateBrandKit(req.body.kit); } catch { return res.status(400).json({ error: 'invalid_brand_kit' }); }
    const logo = logoAssetId(kit);
    if (logo && !state.assets.has(logo)) return res.status(400).json({ error: 'brand_logo_unavailable' });
    brand.kit = kit; brand.revision += 1; brand.writes.push(structuredClone(req.body)); res.json(reply(brand));
  });
  app.delete('/api/create/brand-kit', allow('change'), (req, res) => {
    if (!brand.kit) return res.status(404).json({ error: 'brand_kit_not_found' });
    if (req.body.baseRevision !== brand.revision) return res.status(409).json({ error: 'brand_revision_conflict' });
    brand.kit = null; brand.revision = 0; res.sendStatus(204);
  });
}

function logoRoute(app, state, brand, { multer, sharp }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8388608 } }).single('image');
  app.post('/api/create/brand-kit/logo', (_req, res, next) => (state.permissions.view && brand.change ? next() : res.status(403).json({ error: 'brand_permission_denied' })),
    upload, async (req, res, next) => {
      try {
        const bytes = await sharp(req.file.buffer).rotate().png().toBuffer(), size = await sharp(bytes).metadata(), id = randomUUID();
        const asset = { id, src: `/api/create/project-assets/${id}`, width: size.width, height: size.height, bytes: bytes.length };
        state.assets.set(id, { asset, bytes }); brand.logos += 1; res.status(201).json({ asset });
      } catch (error) { next(error); }
    });
}

/** @description The editor fixture plus the brand kit: real pages and modules, synthetic storage only.
 * @param {object} options Editor fixture options plus `kit` (a seeded kit) and `brand` ({read, change}).
 * @returns {Promise<object>} The editor fixture with `brand` (kit, revision, writes, logos). */
export async function startBrandFixture(options = {}) {
  const brand = { ...brandState(options), logos: 0 };
  const fixture = await startEditorFixture({ ...options, extend: (app, state, deps) => {
    pages(app, deps.packageRoot); kitRoutes(app, state, brand); logoRoute(app, state, brand, deps);
  } });
  return { ...fixture, brand };
}

/** @description Seed a logo asset directly, as if uploaded earlier.
 * @param {object} fixture Running fixture.
 * @param {Buffer} bytes PNG bytes.
 * @param {number} width Pixel width.
 * @param {number} height Pixel height.
 * @returns {object} The logo reference for a kit. */
export function seedLogo(fixture, bytes, width, height) {
  const id = randomUUID(), asset = { id, src: `/api/create/project-assets/${id}`, width, height, bytes: bytes.length };
  fixture.state.assets.set(id, { asset, bytes }); return { src: asset.src, width, height };
}
