/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.12 (CREATE-TOOL-PRESENTATIONS-08): prove speaker notes on screen, PPTX notesSlide OOXML export/import round-trip, Edit & regenerate / reopen persistence, `page` patch and Guide `update_slide` contracts, and Chromium desktop (1440x900) + phone (412x915) UI flows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { initial, validate, LIMITS } from '../tools/office/model.mjs';
import { applyOperations, history } from '../tools/office/operations.mjs';
import { renderOffice, embeddedModel } from '../routes/office-editor/formats.mjs';
import { inspectOffice } from '../routes/office-editor/importers.mjs';
import { selectedModel } from '../routes/office-editor/selection.mjs';
import { serializeSections } from '../tools/slide-workspace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const storeRoot = resolve(packageRoot, '..');
const htmlSource = readFileSync(join(packageRoot, 'tools', 'presentations.html'), 'utf8');

function resolveDep(name) {
  const bases = [
    process.env.STORE_CI_TOOLCHAIN && join(resolve(process.env.STORE_CI_TOOLCHAIN), 'package.json'),
    join(storeRoot, 'scripts', 'toolchain', 'package.json'),
    process.env.OSHAL_FRAMEWORK && join(resolve(process.env.OSHAL_FRAMEWORK), 'package.json'),
    import.meta.url,
  ].filter(Boolean);
  for (const base of bases) {
    try { return createRequire(base)(name); } catch {}
  }
  throw new Error(`Missing test dependency: ${name}`);
}

function officeRuntime() {
  return {
    Pptx: resolveDep('pptxgenjs'),
    word: resolveDep('docx'),
    Excel: resolveDep('exceljs'),
    Zip: resolveDep('jszip'),
  };
}

function outlineHelpers() {
  const start = htmlSource.indexOf('function parseOutline(');
  const end = htmlSource.indexOf('// ADR-043 item A:', start);
  const ctx = vm.createContext({});
  vm.runInContext(htmlSource.slice(start, end), ctx);
  return {
    parse: (text) => JSON.parse(JSON.stringify(vm.runInContext('parseOutline(input)', Object.assign(ctx, { input: text })))),
    serialize: (sections) => vm.runInContext('serializeOfficeSections(input)', Object.assign(ctx, { input: sections })),
  };
}

function loadBotRoutes(guideActions) {
  const req = createRequire(import.meta.url);
  const Module = req('node:module');
  const calls = { guide: [], inserts: [], rendered: [] };
  const fakeRouter = () => {
    const routes = new Map();
    const add = (m) => (p, ...h) => routes.set(`${m} ${p}`, h.at(-1));
    return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  };
  const stubs = {
    express: { Router: fakeRouter, raw: () => (_q, _s, next) => next?.() },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/features/presentation-generation': {
      PresentationEngine: class {},
      renderPptx: async (title, sections) => { calls.rendered.push({ title, sections }); return Buffer.from('PK'); },
      renderDocx: async () => Buffer.from('PK'),
      renderXlsx: async () => Buffer.from('PK'),
      themeCatalog: () => [{ id: 'executive', mood: 'clear' }],
      layoutCatalog: () => [],
      isThemeId: (v) => v === 'executive',
      DEFAULT_THEME_ID: 'executive',
      importOffice: async () => ({}),
      brandTheme: () => { throw new Error('unused'); },
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
    '@/app/routes/storage-target': {
      resolveStorageTarget: async () => ({ provider: 'oshal-local' }),
      saveContent: async (_c, _s, _k, name) => ({ provider: 'oshal-local', location: `oshal/bot/${name}`, downloadUrl: `/dl/${name}` }),
      listFolder: async () => ({ provider: 'oshal-local', files: [] }),
      deleteStoredFile: async () => ({}),
    },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (...args) => {
        calls.guide.push(args);
        return { response: JSON.stringify({ reply: 'Updated speaker notes.', actions: guideActions() }) };
      },
    },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/slack-client': { uploadSlackFile: async () => ({}) },
    '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: () => false,
      confirmationRequiredPayload: () => ({ error: 'confirmation_required' }),
    },
  };
  const original = Module._load;
  const routePath = join(packageRoot, 'routes', 'bot-presentation-routes.js');
  delete req.cache[routePath];
  Module._load = (request, ...rest) => (Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : original.call(Module, request, ...rest));
  try {
    const { createBotPresentationRoutes } = req(routePath);
    const pool = {
      async query(sql, params) {
        if (/INSERT INTO oshal_presentations/.test(sql)) calls.inserts.push(params);
        return { rows: [], rowCount: 1 };
      },
    };
    const router = createBotPresentationRoutes({ pool, appPackageDir: packageRoot });
    return { router, calls };
  } finally {
    Module._load = original;
  }
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = () => {};
  return res;
}

test('structured model and operations validate, clear, undo/redo and isolate per-slide speaker notes', () => {
  let model = initial('pptx', 'Notes Deck');
  const p1 = model.pages[0].id;
  assert.equal(Object.hasOwn(model.pages[0], 'notes'), false);
  const undo = history(model);

  model = undo.commit(applyOperations(model, [{ op: 'page', id: p1, patch: { notes: 'Open with the headline.\nPause for questions.' } }]));
  assert.equal(model.pages[0].notes, 'Open with the headline.\nPause for questions.');
  assert.equal(selectedModel(model, { kind: 'slide-object', page: p1, ids: [] }).page.notes, 'Open with the headline.\nPause for questions.');

  model = undo.commit(applyOperations(model, [{ op: 'add-page', after: p1 }]));
  const p2 = model.pages[1].id;
  model = undo.commit(applyOperations(model, [{ op: 'page', id: p2, patch: { notes: 'Slide two talking points.' } }]));
  assert.equal(model.pages[0].notes, 'Open with the headline.\nPause for questions.');
  assert.equal(model.pages[1].notes, 'Slide two talking points.');

  const reordered = applyOperations(model, [{ op: 'move-page', id: p2, index: 0 }]);
  assert.equal(reordered.pages[0].notes, 'Slide two talking points.');
  assert.equal(reordered.pages[1].notes, 'Open with the headline.\nPause for questions.');

  const cleared = applyOperations(model, [{ op: 'page', id: p1, patch: { notes: '' } }]);
  assert.equal(cleared.pages[0].notes, '');
  assert.equal(undo.undo().pages[1].notes, undefined);
  assert.equal(undo.redo().pages[1].notes, 'Slide two talking points.');

  for (const bad of [42, null, {}, [], 'x'.repeat(LIMITS.notes + 1), 'bad\u0000note']) {
    assert.throws(() => applyOperations(model, [{ op: 'page', id: p1, patch: { notes: bad } }]));
  }
  const doc = initial('docx', 'Word');
  assert.throws(() => applyOperations(doc, [{ op: 'page', id: doc.pages[0].id, patch: { notes: 'Not allowed' } }]));
});

test('PPTX export writes native notesSlide XML and external PPTX import restores per-slide notes', async () => {
  const runtime = officeRuntime();
  let model = initial('pptx', 'Exported Notes Deck');
  const p1 = model.pages[0].id;
  model = applyOperations(model, [
    { op: 'page', id: p1, patch: { notes: 'Introduce Q3 targets.\nHighlight 94% uptime.' } },
    { op: 'add-page', after: p1 },
  ]);
  const p2 = model.pages[1].id;
  model = applyOperations(model, [{ op: 'page', id: p2, patch: { notes: 'Walk through customer rollout.' } }]);

  const bytes = await renderOffice(model, 'pptx', runtime);
  const zip = await runtime.Zip.loadAsync(bytes);
  const n1 = zip.file('ppt/notesSlides/notesSlide1.xml');
  const n2 = zip.file('ppt/notesSlides/notesSlide2.xml');
  assert.ok(n1, 'exported .pptx includes ppt/notesSlides/notesSlide1.xml');
  assert.ok(n2, 'exported .pptx includes ppt/notesSlides/notesSlide2.xml');
  const xml1 = await n1.async('string');
  const xml2 = await n2.async('string');
  assert.match(xml1, /Introduce Q3 targets\./);
  assert.match(xml1, /Highlight 94% uptime\./);
  assert.match(xml2, /Walk through customer rollout\./);
  assert.deepEqual(await embeddedModel(zip), validate(model));

  // Remove embedded JSON to prove visible OOXML notesSlide import restores notes on open.
  zip.remove('oshal/office.json');
  const externalBytes = await zip.generateAsync({ type: 'nodebuffer' });
  const imported = await inspectOffice(externalBytes, runtime);
  assert.equal(imported.kind, 'pptx');
  assert.equal(imported.model.pages.length, 2);
  assert.equal(imported.model.pages[0].notes, 'Introduce Q3 targets.\nHighlight 94% uptime.');
  assert.equal(imported.model.pages[1].notes, 'Walk through customer rollout.');
});

test('outline serialization and compiled bot routes preserve notes across save, Edit & regenerate and Guide update_slide', async () => {
  const { parse, serialize } = outlineHelpers();
  const slides = [
    { title: 'Opening', content: 'First point\nSecond point', notes: 'Welcome the board.\nKeep pace brisk.' },
    { title: 'Metrics', content: 'Revenue: 120', notes: 'Mention YoY growth.' },
  ];
  assert.deepEqual(parse(serializeSections(slides)), slides);
  assert.deepEqual(parse(serialize(slides)), slides);
  assert.equal(serializeSections([{ title: 'Plain', content: 'Point one' }]), 'Plain\nPoint one');
  assert.throws(() => serializeSections([{ title: 'Bad', content: 'Body', notes: 123 }]), TypeError);
  assert.throws(() => serializeSections([{ title: 'Bad', content: 'Body', notes: 'a'.repeat(4001) }]), TypeError);

  const actions = [
    { op: 'update_slide', index: 1, notes: 'Updated by concierge' },
    { op: 'update_slide', index: 2, notes: '' },
    { op: 'update_slide', index: 1, notes: 999 },
    { op: 'add_slide', title: 'Closing', bullets: ['Next step'], notes: 'Thank everyone.' },
  ];
  const { router, calls } = loadBotRoutes(() => actions);
  const guideRes = makeRes();
  await router.routes.get('POST /guide')({
    oidc: { user: { sub: 'alice' } },
    body: {
      message: 'Refine slide 1 notes',
      kind: 'pptx',
      title: 'Board Deck',
      slides: [{ title: 'Opening', bullets: ['Point'], notes: 'Old presenter note' }],
    },
  }, guideRes);
  assert.equal(guideRes.statusCode, 200);
  assert.match(calls.guide[0][3].text, /Notes: Old presenter note/);
  assert.deepEqual(guideRes.body.actions, [
    { op: 'update_slide', index: 1, notes: 'Updated by concierge' },
    { op: 'update_slide', index: 2, notes: '' },
    { op: 'add_slide', title: 'Closing', bullets: ['Next step'], notes: 'Thank everyone.' },
  ]);

  const pptxRes = makeRes();
  await router.routes.get('POST /pptx')({
    oidc: { user: { sub: 'alice' } },
    body: { title: 'Board Deck', sections: slides },
  }, pptxRes);
  assert.equal(pptxRes.statusCode, 200);
  assert.equal(calls.rendered[0].sections[0].notes, 'Welcome the board.\nKeep pace brisk.');
  const savedOutline = JSON.parse(calls.inserts[0][7]);
  assert.equal(savedOutline[0].notes, 'Welcome the board.\nKeep pace brisk.');
  assert.equal(savedOutline[1].notes, 'Mention YoY growth.');
  assert.equal(savedOutline.every((s) => s.sourceVersion === 2), true);
});

async function startStructuredFixture() {
  const runtime = officeRuntime();
  const docs = new Map();
  let seq = 1;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (status, val) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(val)); };
    const readJson = async () => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); };
    if (url.pathname === '/api/presentations/editor/app') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(packageRoot, 'tools', 'office', 'editor.html')));
      return;
    }
    const asset = /^\/api\/presentations\/editor\/assets\/([a-z0-9.-]+)$/.exec(url.pathname);
    if (asset) {
      res.writeHead(200, { 'content-type': asset[1].endsWith('.css') ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(join(packageRoot, 'tools', 'office', asset[1])));
      return;
    }
    if (url.pathname === '/api/presentations/editor/permissions') return json(200, { permissions: { view: true, read: true, create: true, change: true, delete: true, export: true }, actorSub: 'alice' });
    if (url.pathname === '/api/presentations/editor/documents' && req.method === 'GET') {
      return json(200, { documents: [...docs.values()].map((d) => ({ id: d.id, title: d.model.title, kind: d.model.kind, revision: d.revision, updatedAt: new Date().toISOString() })) });
    }
    if (url.pathname === '/api/presentations/editor/documents' && req.method === 'POST') {
      const body = await readJson();
      const id = 'doc-' + (seq++);
      const record = { id, revision: 1, currentRevision: 1, model: validate(body.model), original: null };
      docs.set(id, record);
      return json(201, { document: record });
    }
    const docMatch = /^\/api\/presentations\/editor\/documents\/(doc-\d+)$/.exec(url.pathname);
    if (docMatch && req.method === 'GET') {
      const record = docs.get(docMatch[1]);
      return record ? json(200, { document: record, history: Array.from({ length: record.revision }, (_, i) => ({ revision: i + 1 })) }) : json(404, { error: 'not_found' });
    }
    const revMatch = /^\/api\/presentations\/editor\/documents\/(doc-\d+)\/revisions$/.exec(url.pathname);
    if (revMatch && req.method === 'POST') {
      const record = docs.get(revMatch[1]);
      const body = await readJson();
      record.model = validate(body.model);
      record.revision += 1;
      record.currentRevision = record.revision;
      return json(201, { document: record });
    }
    const expMatch = /^\/api\/presentations\/editor\/documents\/(doc-\d+)\/revisions\/(\d+)\/content$/.exec(url.pathname);
    if (expMatch && req.method === 'GET') {
      const record = docs.get(expMatch[1]);
      const bytes = await renderOffice(record.model, url.searchParams.get('format') || 'pptx', runtime);
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      res.end(bytes);
      return;
    }
    if (url.pathname === '/shared/ui/js/editor-assistant.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('export function createEditorAssistant(){const el=document.createElement("div");return{element:el,refresh(){},destroy(){}};}');
      return;
    }
    if (url.pathname === '/shared/ui/js/editor-foundation.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('export function createEditorFoundation({root,header,navigation,viewport,inspector,status,ai}){root.classList.add("ef-editor");const shell=document.createElement("div");shell.className="ef-shell";const hSlot=document.createElement("div");hSlot.className="ef-header-slot";hSlot.append(header);const body=document.createElement("div");body.className="ef-body";navigation.classList.add("ef-navigation");viewport.classList.add("ef-viewport");inspector.classList.add("ef-inspector");const props=document.createElement("div");props.className="ef-properties";inspector.append(props);body.append(navigation,viewport,inspector);if(ai){ai.classList.add("ef-concierge");body.append(ai);}const sSlot=document.createElement("div");sSlot.className="ef-status-slot";sSlot.append(status);shell.append(hSlot,body,sSlot);root.replaceChildren(shell);return{refresh(){},showPanel(){},hasPending:()=>false,flushPending:async()=>{},discardPending(){},destroy(){}};}');
      return;
    }
    if (url.pathname === '/shared/ui/js/document-handoff.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('let current=null;export function registerDocumentSession(h){current=h;window.__officeHandoff=h;return()=>{current=null;};}');
      return;
    }
    if (url.pathname.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return; }
    if (url.pathname.endsWith('.css')) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(':root{--ds-page:#fff;--ds-surface:#f8fafc;--ds-surface-2:#f1f5f9;--ds-surface-3:#e2e8f0;--ds-ink:#172033;--ds-ink-2:#475569;--ds-hairline:#cbd5e1;--ds-line-control:#94a3b8;--ds-accent:#2563eb}'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    docs,
    runtime,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}

async function startWorkspaceFixture() {
  const renders = [];
  const savedDrafts = [];
  const theme = { id: 'executive', name: 'Executive', mood: 'clear', cover: 'wash', decor: 'bar', darkCanvas: false, headingCase: 'normal', fonts: { heading: 'Arial', body: 'Arial' }, colors: { deep: '17202b', deepInk: 'ffffff', deepInkSoft: 'c7d2df', accent: '4cc9f0', accent2: 'f72585', canvas: 'ffffff', canvasAlt: 'eef4f8', ink: '17202b', inkSoft: '536476', line: 'd4dce7' } };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (status, val) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(val)); };
    if (url.pathname === '/api/presentations/sections/ui') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(packageRoot, 'tools', 'presentations.html')));
      return;
    }
    const asset = /^\/api\/presentations\/sections\/assets\/([a-z0-9.-]+)$/.exec(url.pathname);
    if (asset) {
      res.writeHead(200, { 'content-type': asset[1].endsWith('.css') ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(join(packageRoot, 'tools', asset[1])));
      return;
    }
    if (url.pathname.endsWith('/themes')) return json(200, { themes: [theme], layouts: [], defaultTheme: 'executive' });
    if (url.pathname.endsWith('/starters')) return json(200, { kinds: [], starters: [] });
    if (url.pathname.endsWith('/destination')) return json(200, { provider: 'oshal-local', folder: 'files', subfolder: 'oshal', isDefault: true });
    if (url.pathname.endsWith('/list')) return json(200, { decks: savedDrafts });
    if (req.method === 'POST' && url.pathname.endsWith('/pptx')) {
      const c = []; for await (const x of req) c.push(x);
      const body = JSON.parse(Buffer.concat(c).toString('utf8'));
      renders.push(body);
      savedDrafts.push({
        title: body.title || 'Notes Deck', fileName: 'notes-deck.pptx', format: 'pptx', theme: 'executive',
        outlineComplete: true,
        outline: body.sections.map((s) => ({ title: s.title, bullets: String(s.content || '').split('\n'), ...(s.notes ? { notes: s.notes } : {}), sourceVersion: 2 })),
      });
      return json(200, { ok: true, provider: 'oshal-local', location: 'notes-deck.pptx', format: 'pptx', slides: body.sections.length });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/import')) {
      return json(200, {
        title: 'Imported Deck', format: 'pptx',
        sections: [
          { title: 'Imported Slide 1', content: 'Imported point', notes: 'Imported speaker note 1' },
          { title: 'Imported Slide 2', content: 'Second point', notes: 'Imported speaker note 2' },
        ],
      });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/guide')) {
      return json(200, {
        reply: 'Updated slide 1 speaker notes.',
        actions: [{ op: 'update_slide', index: 1, notes: 'Updated by concierge' }],
      });
    }
    if (url.pathname === '/cockpit/js/app-handoff.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export function receiveHandoff(){}'); return; }
    if (url.pathname === '/cockpit/js/app-workflows.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export async function mountConnectedActions(){}'); return; }
    if (url.pathname.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return; }
    if (url.pathname.endsWith('.css')) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(':root{--bg:#f4f6fb;--panel:#fff;--panel2:#eee;--line:#cbd5e1;--text:#17202b;--muted:#536476;--accent:#2563eb;--accent2:#0d9488}'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    renders,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}

test('Chromium (1440x900 & 412x915): structured editor speaker notes survive slide switch, undo/redo, save/reopen, concierge update and .pptx export', async (t) => {
  const { chromium } = resolveDep('playwright');
  const app = await startStructuredFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${app.origin}/api/presentations/editor/app?kind=pptx`);
  await page.locator('html[data-office-ready=true]').waitFor();

  const notes = page.getByRole('textbox', { name: 'Speaker notes', exact: true });
  assert.equal(await notes.isVisible(), true, 'Speaker notes box is visible under the active slide');
  const boxes = await page.evaluate(() => ({
    slide: document.querySelector('.office-slide').getBoundingClientRect().bottom,
    panel: document.querySelector('#slide-notes-panel').getBoundingClientRect().top,
  }));
  assert.ok(boxes.panel >= boxes.slide - 2, 'Speaker notes sit below the active slide canvas');

  await notes.fill('Slide 1 presenter script');
  await page.locator('#add-page').click();
  assert.equal(await notes.inputValue(), '', 'Slide 2 starts with empty speaker notes');
  await notes.fill('Slide 2 talking points');
  await page.locator('#page-list button').first().click();
  assert.equal(await notes.inputValue(), 'Slide 1 presenter script', 'Switching back to Slide 1 restores its notes');

  await notes.fill('Slide 1 revised');
  await page.locator('#undo').click();
  assert.equal(await notes.inputValue(), 'Slide 1 presenter script', 'Undo restores prior speaker notes');
  await page.locator('#redo').click();
  assert.equal(await notes.inputValue(), 'Slide 1 revised', 'Redo restores updated speaker notes');

  await page.locator('#save-document').click();
  await page.locator('#save-state').filter({ hasText: 'Saved · revision 1' }).waitFor();
  await page.reload();
  await page.locator('html[data-office-ready=true]').waitFor();
  assert.equal(await notes.inputValue(), 'Slide 1 revised', 'Speaker notes survive save & reopen');

  const docId = [...app.docs.keys()][0];
  const record = app.docs.get(docId);
  record.model = applyOperations(record.model, [{ op: 'page', id: record.model.pages[0].id, patch: { notes: 'Updated by concierge' } }]);
  record.revision = 2;
  record.currentRevision = 2;
  await page.evaluate(() => window.__officeHandoff.refresh());
  assert.equal(await notes.inputValue(), 'Updated by concierge', 'Concierge refresh updates on-screen speaker notes');

  const exported = await page.request.get(`${app.origin}/api/presentations/editor/documents/${docId}/revisions/2/content?format=pptx`);
  assert.equal(exported.status(), 200);
  const zip = await app.runtime.Zip.loadAsync(await exported.body());
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /Updated by concierge/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide2.xml').async('string'), /Slide 2 talking points/);

  await page.setViewportSize({ width: 412, height: 915 });
  assert.equal(await notes.isVisible(), true, 'Speaker notes remain visible on 412x915 phone viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Zero horizontal overflow at 412x915');

  // Non-presentation formats hide the speaker notes panel.
  await page.goto(`${app.origin}/api/presentations/editor/app?kind=docx`);
  await page.locator('html[data-office-ready=true]').waitFor();
  assert.equal(await page.locator('#slide-notes-panel').isVisible(), false, 'Speaker notes stay hidden for Word documents');
  assert.deepEqual(errors, []);
});

test('Chromium (1440x900 & 412x915): slide workspace speaker notes survive slide switch, Edit & regenerate, Open file and Guide update_slide', async (t) => {
  const { chromium } = resolveDep('playwright');
  const app = await startWorkspaceFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${app.origin}/api/presentations/sections/ui?kind=pptx&workspace=1`);
  await page.waitForFunction(() => Boolean(window.officeProposalReview));
  await page.evaluate(() => {
    const el = document.getElementById('outline');
    el.value = 'Slide One\nAlpha point\n\nSlide Two\nBeta point';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const notes = page.locator('#slideWorkspace').getByRole('textbox', { name: 'Speaker notes', exact: true });
  assert.equal(await notes.isVisible(), true);
  await notes.fill('Slide 1 speaker notes');
  await page.locator('.office-slide-thumbnail').nth(1).click();
  assert.equal(await notes.inputValue(), '', 'Slide 2 notes start empty');
  await notes.fill('Slide 2 speaker notes');
  await page.locator('.office-slide-thumbnail').first().click();
  assert.equal(await notes.inputValue(), 'Slide 1 speaker notes');

  await page.locator('#genBtn').click();
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('saved'));
  assert.equal(app.renders[0].sections[0].notes, 'Slide 1 speaker notes');
  assert.equal(app.renders[0].sections[1].notes, 'Slide 2 speaker notes');

  // Clear draft then click Edit & regenerate from My files.
  await page.evaluate(() => { const el = document.getElementById('outline'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#tabDecks').click();
  await page.locator('.fRow').first().click();
  await page.locator('#fEdit').click();
  assert.equal(await notes.inputValue(), 'Slide 1 speaker notes', 'Edit & regenerate preserves Slide 1 speaker notes');
  await page.locator('.office-slide-thumbnail').nth(1).click();
  assert.equal(await notes.inputValue(), 'Slide 2 speaker notes', 'Edit & regenerate preserves Slide 2 speaker notes');

  // Guide update_slide updates on-screen speaker notes and export payload.
  await page.locator('.office-slide-thumbnail').first().click();
  await page.locator('#chatIn').fill('Update speaker notes on slide 1');
  await page.locator('#chatSend').click();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  assert.equal(await notes.inputValue(), 'Updated by concierge');
  await page.locator('#genBtn').click();
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('saved'));
  assert.equal(app.renders.at(-1).sections[0].notes, 'Updated by concierge');

  // Open a file preserves imported speaker notes.
  await page.locator('#openFile').setInputFiles({ name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PK') });
  await page.waitForFunction(() => document.querySelector('.office-slide-notes-input')?.value === 'Imported speaker note 1');
  assert.equal(await notes.inputValue(), 'Imported speaker note 1');

  await page.setViewportSize({ width: 412, height: 915 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Zero horizontal overflow at 412x915');
  assert.deepEqual(errors, []);
});
