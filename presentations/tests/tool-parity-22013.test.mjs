/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.13 (CREATE-TOOL-PRESENTATIONS-04, -15, -20): prove presentations-create-workbook with real OOXML .xlsx structure, cover subtitle across PPTX/DOCX/XLSX exports, Edit & regenerate / reopen, Guide set_subtitle, and Send to Slack UI + presentations-send-slack explicit confirmation contract at 1440x900 and 412x915.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftSnapshot } from '../tools/office-assistant.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const storeRoot = resolve(packageRoot, '..');
const FIXTURE_THEME = {
  id: 'executive', name: 'Executive', mood: 'clear', cover: 'wash', decor: 'bar', darkCanvas: false, headingCase: 'normal',
  fonts: { heading: 'Arial', body: 'Arial' },
  colors: { deep: '17202b', deepInk: 'ffffff', deepInkSoft: 'c7d2df', accent: '4cc9f0', accent2: 'f72585', canvas: 'ffffff', canvasAlt: 'eef4f8', ink: '17202b', inkSoft: '536476', line: 'd4dce7' },
};

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

async function renderRealXlsx(title, sections, opts = {}) {
  const ExcelJS = resolveDep('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.title = title;
  const overview = wb.addWorksheet('Overview');
  overview.getCell('A1').value = title;
  if (opts.subtitle) overview.getCell('A3').value = opts.subtitle;
  for (const sec of sections) {
    const ws = wb.addWorksheet(String(sec.title || 'Sheet').slice(0, 31));
    for (const line of String(sec.content || '').split('\n').filter((l) => l.trim())) {
      const cells = line.includes('|') ? line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : [line];
      ws.addRow(cells.map((v) => (/^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v)));
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function renderRealPptx(title, sections, opts = {}) {
  const PptxGen = resolveDep('pptxgenjs');
  const pptx = new PptxGen();
  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.5, y: 1.0, w: 8, h: 1 });
  if (opts.subtitle) cover.addText(opts.subtitle, { x: 0.5, y: 2.2, w: 8, h: 0.8 });
  for (const sec of sections) {
    const s = pptx.addSlide();
    s.addText(sec.title || '', { x: 0.5, y: 0.5, w: 8, h: 0.6 });
    if (sec.content) s.addText(sec.content, { x: 0.5, y: 1.4, w: 8, h: 3 });
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function renderRealDocx(title, sections, opts = {}) {
  const { Document, Packer, Paragraph, TextRun } = resolveDep('docx');
  const children = [new Paragraph({ children: [new TextRun(title)] })];
  if (opts.subtitle) children.push(new Paragraph({ children: [new TextRun(opts.subtitle)] }));
  for (const sec of sections) {
    children.push(new Paragraph({ children: [new TextRun(sec.title || '')] }));
    if (sec.content) children.push(new Paragraph({ children: [new TextRun(sec.content)] }));
  }
  const buf = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = () => {};
  return res;
}

function routeStubs(savedBuffers, slackUploads) {
  const fakeRouter = () => {
    const routes = new Map();
    const add = (m) => (p, ...h) => routes.set(`${m} ${p}`, h.at(-1));
    return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  };
  return {
    express: { Router: fakeRouter, raw: () => (_q, _s, next) => next?.() },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/features/presentation-generation': {
      PresentationEngine: class {}, renderPptx: renderRealPptx, renderDocx: renderRealDocx, renderXlsx: renderRealXlsx,
      themeCatalog: () => [{ id: 'executive', mood: 'clear' }], layoutCatalog: () => [], isThemeId: (v) => v === 'executive',
      DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}), brandTheme: () => { throw new Error('unused'); },
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
    '@/app/routes/storage-target': {
      resolveStorageTarget: async () => ({ provider: 'oshal-local', folder: 'files' }),
      saveContent: async (_c, _s, _k, name, buf) => {
        savedBuffers.set(name, buf);
        return { provider: 'oshal-local', location: `oshal/a0000000-0000-0000-0000-000000000042/${name}`, downloadUrl: `/dl/${encodeURIComponent(name)}`, url: `https://files.invalid/${encodeURIComponent(name)}` };
      },
      listFolder: async () => ({ provider: 'oshal-local', files: [...savedBuffers.keys()].map((name) => ({ name, downloadUrl: `/dl/${encodeURIComponent(name)}`, url: `https://files.invalid/${encodeURIComponent(name)}` })) }),
      deleteStoredFile: async () => ({ provider: 'oshal-local', removed: true }),
    },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async () => ({ response: JSON.stringify({ reply: 'Updated subtitle.', actions: [{ op: 'set_subtitle', subtitle: 'Executive Summary 2026' }] }) }),
    },
    '@/app/routes/connectors-routes': { getValidAccessToken: async (_p, _s, provider) => (provider === 'slack' ? 'slack-fixture-token' : null) },
    '@/app/routes/slack-client': {
      uploadSlackFile: async (token, input) => { slackUploads.push({ token, input }); return { fileId: 'F999', channelId: input.channelId, permalink: 'https://slack.invalid/files/F999' }; },
    },
    '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (op) => ({ error: 'confirmation_required', operation: op }),
    },
  };
}

function loadCompiledRoutes() {
  const req = createRequire(import.meta.url);
  const Module = req('node:module');
  const savedBuffers = new Map();
  const dbRows = [];
  const slackUploads = [];
  const stubs = routeStubs(savedBuffers, slackUploads);
  const original = Module._load;
  const routePath = join(packageRoot, 'routes', 'bot-presentation-routes.js');
  delete req.cache[routePath];
  Module._load = (r, ...rest) => (Object.prototype.hasOwnProperty.call(stubs, r) ? stubs[r] : original.call(Module, r, ...rest));
  try {
    const { createBotPresentationRoutes } = req(routePath);
    const pool = {
      async query(sql, params) {
        if (/INSERT INTO oshal_presentations/.test(sql)) {
          dbRows.unshift({
            user_sub: params[0], title: params[1], file_name: params[2], provider: params[3],
            download_url: params[4], url: params[5], slides: params[6], outline: JSON.parse(params[7]),
            theme: params[8], format: params[9], created_at: new Date(),
          });
          return { rows: [], rowCount: 1 };
        }
        if (/SELECT [\s\S]* FROM oshal_presentations/.test(sql)) return { rows: dbRows.filter((r) => r.user_sub === params[0]) };
        return { rows: [], rowCount: 0 };
      },
    };
    return { router: createBotPresentationRoutes({ pool, appPackageDir: packageRoot }), savedBuffers, dbRows, slackUploads };
  } finally {
    Module._load = original;
  }
}

async function zipXmlText(buffer) {
  const JSZip = resolveDep('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xml = await Promise.all(Object.keys(zip.files).filter((k) => k.endsWith('.xml')).map((k) => zip.file(k).async('string')));
  return { zip, text: xml.join('\n') };
}

test('authorization.yaml binds presentations-create-workbook and presentations-send-slack with zero new permissions or roles', () => {
  const yaml = resolveDep('js-yaml');
  const auth = yaml.load(readFileSync(join(packageRoot, 'authorization.yaml'), 'utf8'));
  const manifest = yaml.load(readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(auth.permissions).sort(), ['document.change', 'document.create', 'document.delete', 'document.export', 'document.read', 'document.view', 'legacy.access']);
  assert.deepEqual(Object.keys(auth.roles).sort(), ['admin', 'editor', 'viewer']);
  for (const id of ['presentations-create-workbook', 'presentations-send-slack']) {
    const binding = auth.bindings.tools.find((t) => t.id === id);
    assert.ok(binding, `${id} is bound in authorization.yaml`);
    assert.deepEqual(binding.allOf, ['document.view', 'legacy.access']);
  }
  const wbTool = manifest.tools.find((t) => t.name === 'presentations-create-workbook');
  assert.equal(wbTool.executor.apiEndpoint, 'POST /api/presentations/sections/xlsx');
  assert.equal(wbTool.defaultAuthMode, 'auto');
  assert.equal(wbTool.requiresApproval, false);
  const slackTool = manifest.tools.find((t) => t.name === 'presentations-send-slack');
  assert.equal(slackTool.executor.apiEndpoint, 'POST /api/presentations/sections/slack');
  assert.equal(slackTool.defaultAuthMode, 'ask');
  assert.equal(slackTool.requiresApproval, true);
  assert.equal(slackTool.inputSchema.properties.confirm.const, true);
  assert.ok(typeof slackTool.cardText === 'string' && slackTool.cardText.length > 20);
});

test('CREATE-TOOL-PRESENTATIONS-04 & -15: POST /xlsx, /pptx, /docx produce real OOXML with cover subtitle and persist it in GET /list', async () => {
  const { router, savedBuffers } = loadCompiledRoutes();
  const xlsxRes = makeRes();
  await router.routes.get('POST /xlsx')({
    oidc: { user: { sub: 'alice' } },
    body: {
      title: 'Household Budget', subtitle: 'Q4 Family Forecast', theme: 'executive',
      sections: [{ title: 'Expenses', content: '| Category | Amount |\n| Rent | 2200 |\n| Food | 650 |' }],
    },
  }, xlsxRes);
  assert.equal(xlsxRes.statusCode, 200);
  assert.equal(xlsxRes.body.ok, true);
  assert.equal(xlsxRes.body.format, 'xlsx');
  assert.equal(xlsxRes.body.subtitle, 'Q4 Family Forecast');
  assert.equal(xlsxRes.body.openUrl, '/cockpit/?app=presentations&open=Household%20Budget.xlsx');
  assert.ok(xlsxRes.body.url && xlsxRes.body.downloadUrl);

  const { zip: xlsxZip, text: xlsxText } = await zipXmlText(savedBuffers.get('Household Budget.xlsx'));
  assert.ok(xlsxZip.file('[Content_Types].xml') && xlsxZip.file('xl/workbook.xml'));
  assert.match(xlsxText, /Q4 Family Forecast/);
  assert.match(xlsxText, /2200/);

  for (const [kind, fileName, xmlPath] of [['pptx', 'Board Deck.pptx', 'ppt/slides/slide1.xml'], ['docx', 'Policy Brief.docx', 'word/document.xml']]) {
    const r = makeRes();
    await router.routes.get(`POST /${kind}`)({
      oidc: { user: { sub: 'alice' } },
      body: { title: fileName.replace(/\.\w+$/, ''), subtitle: `Cover Sub ${kind.toUpperCase()}`, sections: [{ title: 'Summary', content: 'Key point' }] },
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.subtitle, `Cover Sub ${kind.toUpperCase()}`);
    const { zip } = await zipXmlText(savedBuffers.get(fileName));
    assert.match(await zip.file(xmlPath).async('string'), new RegExp(`Cover Sub ${kind.toUpperCase()}`));
  }

  const listRes = makeRes();
  await router.routes.get('GET /list')({ oidc: { user: { sub: 'alice' } } }, listRes);
  const budget = listRes.body.decks.find((d) => d.fileName === 'Household Budget.xlsx');
  assert.equal(budget.subtitle, 'Q4 Family Forecast');
  assert.equal(budget.outlineComplete, true);
  assert.notEqual(draftSnapshot({ kind: 'pptx', title: 'A', outline: 'B', theme: 'executive', subtitle: 'Old' }), draftSnapshot({ kind: 'pptx', title: 'A', outline: 'B', theme: 'executive', subtitle: 'New' }));
});

test('CREATE-TOOL-PRESENTATIONS-20: POST /slack enforces 428 confirmation refusal and uploads with confirm:true and subtitle', async () => {
  const { router, slackUploads } = loadCompiledRoutes();
  const unconfirmed = makeRes();
  await router.routes.get('POST /slack')({
    oidc: { user: { sub: 'alice' } },
    body: { channelId: 'C12345', title: 'Budget', format: 'xlsx', sections: [{ title: 'Sheet1', content: 'Rent: 2200' }] },
  }, unconfirmed);
  assert.equal(unconfirmed.statusCode, 428);
  assert.equal(slackUploads.length, 0);

  const confirmed = makeRes();
  await router.routes.get('POST /slack')({
    oidc: { user: { sub: 'alice' } },
    body: { confirm: true, channelId: 'C12345', title: 'Budget', subtitle: 'Q4 Final', format: 'xlsx', comment: 'Ready for review', sections: [{ title: 'Sheet1', content: 'Rent: 2200' }] },
  }, confirmed);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.ok, true);
  assert.equal(confirmed.body.fileName, 'Budget.xlsx');
  assert.equal(slackUploads.length, 1);
  const { text } = await zipXmlText(slackUploads[0].input.content);
  assert.match(text, /Q4 Final/);
});

function handleStaticFixture(url, res) {
  if (url.pathname === '/api/presentations/sections/ui') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(packageRoot, 'tools', 'presentations.html')));
    return true;
  }
  const asset = /^\/api\/presentations\/sections\/assets\/([a-z0-9.-]+)$/.exec(url.pathname);
  if (asset) {
    res.writeHead(200, { 'content-type': asset[1].endsWith('.css') ? 'text/css' : 'text/javascript' });
    res.end(readFileSync(join(packageRoot, 'tools', asset[1])));
    return true;
  }
  if (url.pathname === '/cockpit/js/app-handoff.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export function receiveHandoff(){}'); return true; }
  if (url.pathname === '/cockpit/js/app-workflows.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export async function mountConnectedActions(){}'); return true; }
  if (url.pathname.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return true; }
  if (url.pathname.endsWith('.css')) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(':root{--bg:#f4f6fb;--panel:#fff;--panel2:#eee;--line:#cbd5e1;--text:#17202b;--muted:#536476;--accent:#2563eb;--accent2:#0d9488}'); return true; }
  return false;
}

async function startStudioFixture() {
  const renders = [];
  const slackCalls = [];
  const savedDrafts = [];
  let slackFailMessage = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (status, val) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(val)); };
    const readJson = async () => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); };
    if (handleStaticFixture(url, res)) return;
    if (url.pathname.endsWith('/themes')) return json(200, { themes: [FIXTURE_THEME], layouts: [], defaultTheme: 'executive' });
    if (url.pathname.endsWith('/starters')) return json(200, { kinds: [], starters: [] });
    if (url.pathname.endsWith('/destination')) return json(200, { provider: 'oshal-local', folder: 'files', subfolder: 'oshal', isDefault: true });
    if (url.pathname.endsWith('/list')) return json(200, { decks: savedDrafts });
    if (req.method === 'POST' && /\/(pptx|docx|xlsx)$/.test(url.pathname)) {
      const kind = url.pathname.split('/').pop();
      const body = await readJson();
      renders.push({ kind, body });
      savedDrafts.unshift({
        title: body.title || 'Untitled', subtitle: body.subtitle || null, fileName: `${body.title || 'Untitled'}.${kind}`,
        format: kind, theme: 'executive', provider: 'oshal-local', outlineComplete: true,
        outline: body.sections.map((s, idx) => ({ title: s.title, bullets: String(s.content || '').split('\n'), ...(idx === 0 && body.subtitle ? { coverSubtitle: body.subtitle } : {}), sourceVersion: 2 })),
      });
      return json(200, { ok: true, provider: 'oshal-local', location: `${body.title}.${kind}`, format: kind, slides: body.sections.length, subtitle: body.subtitle });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/guide')) return json(200, { reply: 'Updated the cover subtitle.', actions: [{ op: 'set_subtitle', subtitle: 'Guide Updated Subtitle' }] });
    if (req.method === 'POST' && url.pathname.endsWith('/slack')) {
      const body = await readJson();
      slackCalls.push(body);
      if (slackFailMessage) return json(409, { error: 'no_slack_connection', message: slackFailMessage });
      return json(200, { ok: true, via: 'slack', channelId: body.channelId, fileId: 'F1', format: body.format, fileName: `${body.title}.${body.format}` });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    renders, slackCalls,
    setSlackFail: (msg) => { slackFailMessage = msg; },
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}

async function verifySubtitleAcrossFormats(page, app) {
  await page.locator('#title').fill('Q4 Strategy');
  await page.locator('#subtitleInput').fill('Executive Board Briefing');
  await page.evaluate(() => {
    const el = document.getElementById('outline');
    el.value = 'Overview\nRevenue grew 18%';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const kind of ['pptx', 'docx', 'xlsx']) {
    await page.locator('#officeFormat').selectOption(kind);
    const before = app.renders.length;
    await page.locator('#genBtn').click();
    await page.waitForFunction(() => document.getElementById('result').textContent.includes('saved'));
    assert.equal(app.renders.length, before + 1);
    assert.equal(app.renders.at(-1).kind, kind);
    assert.equal(app.renders.at(-1).body.subtitle, 'Executive Board Briefing');
  }
  await page.locator('#subtitleInput').fill('');
  await page.locator('#tabDecks').click();
  await page.locator('.fRow').first().click();
  await page.locator('#fEdit').click();
  assert.equal(await page.locator('#subtitleInput').inputValue(), 'Executive Board Briefing');
}

async function verifyGuideAndSlackUi(page, app) {
  await page.locator('#chatIn').fill('Set the cover subtitle');
  await page.locator('#chatSend').click();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  assert.equal(await page.locator('#subtitleInput').inputValue(), 'Guide Updated Subtitle');

  await page.locator('#slackBtn').click();
  await page.locator('#slackChannel').fill('C0123456789');
  await page.locator('#slackSend').click();
  assert.equal(app.slackCalls.length, 0);
  assert.match(await page.locator('#result').textContent(), /Explicit confirmation is required/);

  app.setSlackFail('<img src=x onerror="window.__xss=1"> Connect Slack first');
  await page.locator('#slackConfirm').check();
  await page.locator('#slackSend').click();
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('Connect Slack first'));
  assert.equal(await page.locator('#result img').count(), 0);

  app.setSlackFail(null);
  await page.locator('#slackComment').fill('Sharing Q4 pack');
  await page.locator('#slackSend').click();
  await page.waitForFunction(() => document.getElementById('result').textContent.includes('C0123456789'));
  assert.equal(app.slackCalls.at(-1).confirm, true);
  assert.equal(app.slackCalls.at(-1).channelId, 'C0123456789');
  assert.equal(app.slackCalls.at(-1).subtitle, 'Guide Updated Subtitle');
}

test('Chromium (1440x900 & 412x915): cover subtitle, Edit & regenerate, Guide set_subtitle, and Send to Slack UI with explicit confirmation and XSS-safe status', async (t) => {
  const { chromium } = resolveDep('playwright');
  const app = await startStudioFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${app.origin}/api/presentations/sections/ui?kind=pptx&workspace=1`);
  await page.waitForFunction(() => Boolean(window.officeProposalReview));
  await verifySubtitleAcrossFormats(page, app);
  await verifyGuideAndSlackUi(page, app);

  await page.setViewportSize({ width: 412, height: 915 });
  await page.locator('#slackBtn').click();
  assert.equal(await page.locator('#subtitleInput').isVisible(), true);
  assert.equal(await page.locator('#slackRow').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
});
