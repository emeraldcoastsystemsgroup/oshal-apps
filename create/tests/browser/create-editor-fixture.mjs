/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve actual editor modules and shared themes over a disposable synthetic project and raster API.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Provide actual nonJSON gateway responses and held export requests for bounded error-recovery checks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Let a companion fixture add its own synthetic routes (the brand kit) to the same server before the error handler.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject } from '../../tools/editor/model.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
const express = requireCore('express'), multer = requireCore('multer'), sharp = requireCore('sharp');
export const { chromium } = requireCore('playwright');
const clone = value => structuredClone(value);
const metadata = record => ({ id: record.id, title: record.title, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt });

function parentHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/shared/ui/css/surface-themes.css"><style>body{margin:0;background:var(--bg-primary);color:var(--text-primary)}header{padding:4px 10px;height:36px}iframe{width:100%;height:calc(100vh - 36px);border:0;display:block}</style></head>
  <body><header><button id="workspace">Workspace</button><button id="midnight">Midnight</button><label><input id="applicationColors" type="checkbox">Application colors</label></header>
  <iframe id="editorFrame" title="Create image editor"></iframe><script type="module">
  import {ThemeManager,setApplicationColors} from '/cockpit/js/theme-manager.js';window.theme=new ThemeManager();theme.setApplicationTheme('create','/api/create/theme/create.css');
  for(const id of ['workspace','midnight'])document.getElementById(id).onclick=()=>theme.apply(id);
  document.getElementById('applicationColors').onchange=e=>setApplicationColors(e.target.checked);
  document.getElementById('editorFrame').src='/api/create/editor'+location.search;
  </script></body></html>`;
}

function staticRoutes(app) {
  app.get('/fixture', (_req, res) => res.type('html').send(parentHtml()));
  app.get('/api/create/editor', (_req, res) => res.sendFile(resolve(packageRoot, 'tools/create-editor.html')));
  app.use('/api/create/editor', express.static(resolve(packageRoot, 'tools/editor')));
  app.get('/api/create/theme/create.css', (_req, res) => res.sendFile(resolve(packageRoot, 'ui/create.css')));
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.use('/cockpit', express.static(resolve(coreRoot, 'src/pages/cockpit')));
  app.get('/api/artifacts/picker.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/cockpit/js/components/artifact-picker.js')));
  app.get('/api/artifacts/picker.css', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/cockpit/js/components/artifact-picker.css')));
}

function gate(state, permission) {
  return (_req, res, next) => {
    if (!state.permissions.view || !state.permissions[permission]) return res.status(403).json({ error: 'synthetic_project_permission_denied' });
    next();
  };
}

function projectRecord(state, req, res) {
  const record = state.projects.get(req.params.id);
  if (!record) { res.status(404).json({ error: 'synthetic_project_not_found' }); return null; } return record;
}

function revisionInput(state, body) {
  const document = validateProject(body.document, { assetMode: 'reference' });
  if (body.title !== document.name) throw new Error('synthetic_title_mismatch');
  for (const image of Object.values(document.images)) if (!state.assets.has(image.src.split('/').at(-1))) throw new Error('synthetic_asset_not_found');
  return document;
}

function addRecord(state, document) {
  const now = new Date().toISOString(), record = { id: randomUUID(), title: document.name, revision: 1, createdAt: now, updatedAt: now, document: clone(document) };
  state.projects.set(record.id, record); state.revisions.set(record.id, [clone(record)]); return record;
}

function projectReads(app, state) {
  app.get('/api/create/permissions', (_req, res) => state.options.permissionsFailure
    ? res.status(state.options.permissionsFailure).json({ error: 'synthetic_permission_unavailable' }) : res.json({ permissions: state.permissions }));
  app.get('/api/create/projects', gate(state, 'read'), (_req, res) => {
    if (state.listReply) return res.status(state.listReply.status).type('html').send(state.listReply.body);
    res.json({ projects: [...state.projects.values()].map(metadata) });
  });
  app.get('/api/create/projects/:id', gate(state, 'read'), (req, res) => {
    const record = projectRecord(state, req, res); if (!record) return;
    if (state.holdReads) { state.pendingReads.push(() => res.json({ project: clone(record) })); state.onHeldRead?.(); return; }
    res.json({ project: clone(record) });
  });
  app.get('/api/create/projects/:id/revisions', gate(state, 'read'), (req, res) => {
    if (projectRecord(state, req, res)) res.json({ revisions: state.revisions.get(req.params.id).map(metadata).reverse() });
  });
  app.get('/api/create/projects/:id/revisions/:revision', gate(state, 'read'), (req, res) => {
    const record = state.revisions.get(req.params.id)?.find(row => row.revision === Number(req.params.revision));
    if (record) res.json({ project: clone(record) }); else res.status(404).json({ error: 'synthetic_revision_not_found' });
  });
  app.get('/api/create/projects/:id/export', gate(state, 'export'), gate(state, 'read'), (req, res) => {
    const record = projectRecord(state, req, res); if (!record) return;
    if (state.holdExports) { state.onHeldExport?.(); return; }
    res.json({ document: clone(record.document) });
  });
}

function projectWrites(app, state) {
  app.post('/api/create/projects', gate(state, 'create'), (req, res) => {
    const document = revisionInput(state, req.body), record = addRecord(state, document); state.successfulWrites++;
    res.status(201).json({ project: clone(record) });
  });
  app.post('/api/create/projects/:id/revisions', gate(state, 'change'), (req, res) => {
    const record = projectRecord(state, req, res); if (!record) return;
    if (state.revisionFailure) return res.status(state.revisionFailure).json({ error: state.revisionError || 'synthetic_save_unavailable' });
    if (state.staleOnce || record.revision !== req.body.baseRevision) { state.staleOnce = false; res.status(409).json({ error: 'project_revision_conflict' }); return; }
    const document = revisionInput(state, req.body), next = { ...record, title: document.name, revision: record.revision + 1, updatedAt: new Date().toISOString(), document };
    state.projects.set(record.id, next); state.revisions.get(record.id).push(clone(next)); state.successfulWrites++;
    res.status(201).json({ project: clone(next) });
  });
  app.delete('/api/create/projects/:id', gate(state, 'delete'), (req, res) => {
    const record = projectRecord(state, req, res); if (!record) return;
    if (record.revision !== req.body.baseRevision) { res.status(409).json({ error: 'project_revision_conflict' }); return; }
    state.projects.delete(record.id); state.revisions.delete(record.id); state.successfulWrites++; res.sendStatus(204);
  });
}

function imageRoutes(app, state) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8388608 } }).single('image');
  app.post('/api/create/project-assets', (req, res, next) => {
    if (!state.permissions.view || !(state.permissions.create || state.permissions.change)) return res.status(403).json({ error: 'synthetic_upload_denied' });
    next();
  }, upload, async (req, res, next) => {
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 33554432 }).rotate(), bytes = await image.png().toBuffer(), size = await sharp(bytes).metadata();
      const id = randomUUID(), asset = { id, src: `/api/create/project-assets/${id}`, width: size.width, height: size.height, bytes: bytes.length };
      state.assets.set(id, { asset, bytes }); state.uploads++; res.status(201).json({ asset });
    } catch (error) { next(error); }
  });
  app.get('/api/create/project-assets/:id', gate(state, 'read'), (req, res) => {
    const value = state.assets.get(req.params.id); if (!value) return res.sendStatus(404);
    const send = () => res.type('image/png').send(value.bytes);
    if (state.holdAssets) { state.pendingAssets.push(send); state.onHeldAsset?.(); return; } send();
  });
}

/** @description Keep all mutations in fresh synthetic Maps while serving the real editor and theme implementation.
 * @param {object} options Synthetic permission or response controls.
 * @returns {Promise<object>} Origin, fixture state and deterministic cleanup. */
export async function startEditorFixture(options = {}) {
  const app = express(), state = { options, permissions: { view: true, read: true, create: true, change: true, delete: true, export: true, ...options.permissions },
    projects: new Map(), revisions: new Map(), assets: new Map(), requests: [], successfulWrites: 0, uploads: 0, staleOnce: false,
    holdReads: Boolean(options.holdReads), pendingReads: [], onHeldRead: options.onHeldRead,
    holdAssets: false, pendingAssets: [], revisionFailure: null };
  app.use(express.json({ limit: '300kb' }));
  app.use((req, res, next) => {
    state.requests.push({ method: req.method, path: req.path, body: req.is('application/json') ? clone(req.body) : undefined });
    res.set('Cache-Control', 'no-store'); next();
  });
  staticRoutes(app); projectReads(app, state); projectWrites(app, state); imageRoutes(app, state);
  options.extend?.(app, state, { express, multer, sharp, requireCore, packageRoot });
  app.use((error, _req, res, _next) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, ...state, state,
    seed: document => addRecord(state, validateProject(document, { assetMode: 'reference' })),
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}

/** @description A generated red/blue PNG is the only uploaded picture in these tests.
 * @returns {Promise<Buffer>} Synthetic 40 by 20 raster. */
export async function syntheticImage() {
  const bytes = Buffer.alloc(40 * 20 * 4);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) { const offset = (y * 40 + x) * 4; bytes[offset + (x < 20 ? 0 : 2)] = 255; bytes[offset + 3] = 255; }
  return sharp(bytes, { raw: { width: 40, height: 20, channels: 4 } }).png().toBuffer();
}
