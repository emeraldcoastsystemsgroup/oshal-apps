/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose the actual three source-project routers over one isolated FORCE-RLS PostgreSQL fixture; no provider or production identity.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Module, { createRequire } from 'node:module';
import { fixture, dependencies } from '../editor-source-projects/postgres.fixture.mjs';
import { sourceSchema } from '../editor-source-projects/schema.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const actor = Object.freeze({ issuer: 'https://editor-review.invalid', sub: 'source-review-person', principalId: 'source-review-principal', tenantIds: ['source-review-tenant'], isActive: true });
const pages = [['brand-graphics', 'Brand Graphics', 'brand_source'], ['creative-studio', 'Stories', 'story_source'], ['portrait-studio', 'Portrait', 'portrait_source']];
function local(req) { const host = String(req.headers.host || ''); return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && (!req.headers.origin || req.headers.origin === 'http://' + host) && req.headers['sec-fetch-site'] !== 'cross-site'; }
/** Return an independent loopback upstream for a composed review host. close() owns only its server and unique disposable PG container. */
export async function startSourceReviewHub(options = {}) {
    const require = dependencies(), express = require('express');
    const platform = resolve(options.platformRoot || process.env.OSHAL_PLATFORM_ROOT || '');
    if (!options.platformRoot && !process.env.OSHAL_PLATFORM_ROOT)
        throw Error('Explicit OSHAL_PLATFORM_ROOT is required.');
    const sharpRoot = options.sharpRoot || process.env.OSHAL_EDITOR_SHARP_ROOT;
    if (sharpRoot) {
        process.env.NODE_PATH = [resolve(sharpRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':');
        Module._initPaths();
    }
    const sharp = sharpRoot ? createRequire(resolve(sharpRoot, 'package.json'))('sharp') : require('sharp');
    const cleanups = [];
    let server, closed = false;
    const close = async () => { if (closed)
        return; closed = true; server?.closeAllConnections(); if (server)
        await new Promise(done => server.close(done)); const errors = []; for (const cleanup of cleanups.reverse())
        try {
            await cleanup();
        }
        catch (error) {
            errors.push(error);
        } if (errors.length)
        throw new AggregateError(errors, 'Source review fixture cleanup failed.'); };
    try {
        const { pool } = await fixture({ after: fn => cleanups.push(fn) }, 'brand_source');
        for (const prefix of ['story_source', 'portrait_source'])
            await pool.query(sourceSchema(prefix));
        const app = express();
        app.use((req, res, next) => local(req) ? next() : res.status(403).json({ error: 'review_local_origin_required' }));
        for (const [id] of pages) {
            const { createSourceProjectRoutes } = await import('../../' + id + '/routes/source-projects.mjs');
            const ctx = { pool, appPackageDir: resolve(root, id), authorization: { currentActor: () => actor, authorize: async () => ({ allowed: true }) }, intent: async (name) => { if (name !== 'auth.application')
                    throw Error('Unsupported review authority.'); return { roles: ['@app-admin'], principal: { id: actor.principalId, issuer: actor.issuer, subject: actor.sub, tenant: actor.tenantIds[0], state: 'active' } }; } };
            app.use('/api/' + id, createSourceProjectRoutes(ctx));
            app.get('/api/' + id + (id === 'portrait-studio' ? '/app' : '/review'), (_q, res) => res.sendFile(resolve(root, id, 'tools', id === 'portrait-studio' ? 'portrait-studio.html' : 'review.html')));
            if (id !== 'portrait-studio')
                app.get('/api/' + id + '/home-summary', (_q, res) => res.json({ metrics: [], items: [] }));
        }
        const { clientCatalog } = createRequire(import.meta.url)('../../portrait-studio/routes/portrait-catalog.js');
        for (const [path, file] of [['capture-module', 'portrait-capture.js'], ['face-module', 'portrait-face.js']])
            app.get('/api/portrait-studio/' + path, (_q, res) => res.sendFile(resolve(root, 'portrait-studio/tools', file)));
        app.get('/api/portrait-studio/catalog', (_q, res) => res.json(clientCatalog()));
        app.get('/api/portrait-studio/permissions', (_q, res) => res.json({ permissions: { view: true, read: true, create: true, change: true, delete: true, export: true }, unavailable: { email: true } }));
        app.get('/api/portrait-studio/provider', (_q, res) => res.json({ configured: false, provider: 'native-unconfigured' }));
        app.get('/api/portrait-studio/portraits', (_q, res) => res.json({ portraits: [] }));
        app.get('/api/vids/jobs', (_q, res) => res.json({ workers: [], jobs: [] }));
        app.get('/api/swarm/apps/home-plan', (_q, res) => res.json({ apps: [] }));
        app.get('/api/artifacts/picker.js', (_q, res) => res.type('js').send('window.oshalArtifactPicker=undefined;'));
        app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
        app.use('/cockpit', express.static(resolve(platform, 'src/pages/cockpit')));
        // Explicit absence is useful review evidence; no generation, approval or worker response is fabricated.
        app.use((req, res) => res.status(req.method === 'GET' ? 404 : 503).json({ error: 'Provider, generation and external handoff execution are unavailable in this isolated source review.' }));
        server = app.listen(options.port ?? 0, '127.0.0.1');
        await new Promise((done, reject) => { server.once('listening', done); server.once('error', reject); });
        const origin = 'http://127.0.0.1:' + server.address().port;
        const post = async (path, body, contentType = 'application/json') => { const response = await fetch(origin + path, { method: 'POST', headers: { 'content-type': contentType }, body: contentType === 'application/json' ? JSON.stringify(body) : body }); const value = await response.json(); if (!response.ok)
            throw Error('Source review seed refused: ' + value.error); return value; };
        const entries = [];
        for (const [id, title] of pages.slice(0, 2)) {
            const model = { version: 1, kind: id === 'brand-graphics' ? 'brand' : 'story', title: title + ' review source', notes: 'This editable brief and its selectable scenes are saved as immutable source revisions. No generation provider is connected.', sourceUrl: '', mode: id === 'brand-graphics' ? 'graphic' : 'episode', scenes: [{ id: randomUUID(), title: 'Opening', text: 'Select this scene and edit its text or duration.', duration: 5 }, { id: randomUUID(), title: 'Closing', text: 'Save the source and reopen it from the library.', duration: 4 }] };
            const { project } = await post('/api/' + id + '/source-projects', { model, requestKey: randomUUID() });
            entries.push({ key: id, title, url: '/api/' + id + '/review', recordId: project.id, selectionLabel: model.title + ' · revision 1' });
        }
        const original = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#dbeafe"/><circle cx="320" cy="260" r="115" fill="#60a5fa"/><path d="M90 740v-70a230 230 0 0 1 460 0v70" fill="#2563eb"/></svg>')).png().toBuffer();
        const { asset } = await post('/api/portrait-studio/source-assets?requestKey=' + randomUUID(), original, 'image/png');
        const model = { version: 1, kind: 'portrait', title: 'Portrait review source', mode: 'professional', style: null, aspect: .8, notes: 'The original raster and crop geometry are owned source. Generation is unavailable.', settings: {}, photos: [{ id: randomUUID(), assetId: asset.id, sha256: asset.sha256, width: 640, height: 800, crops: [{ id: randomUUID(), x: 80, y: 80, w: 480, h: 600 }] }] };
        const { project } = await post('/api/portrait-studio/source-projects', { model, requestKey: randomUUID() });
        entries.push({ key: 'portrait-studio', title: 'Portrait', url: '/api/portrait-studio/app', recordId: project.id, selectionLabel: model.title + ' · revision 1' });
        return { origin, entries, app, notice: 'Actual typed source routes and FORCE-RLS SQL; fixed synthetic original person. Source data survives reload and is removed with this fixture on close. No provider is connected.', close };
    }
    catch (error) {
        await close();
        throw error;
    }
}
