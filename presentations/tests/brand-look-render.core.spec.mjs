/**
 * Brand looks through the AI Office route, against the framework's own deck engine.
 *
 * Real code on the boundary this proves: the COMPILED package route (routes/bot-presentation-
 * routes.js) and core's presentation-generation source, loaded from the framework checkout and
 * transpiled here, so brandTheme and the three renderers are the kernel's. Storage, the database,
 * the outline-drafting bot, the mailbox and Slack are in-memory seams that record what they were
 * asked to do; nothing is written outside this process.
 *
 * Run: OSHAL_CORE_ROOT=<framework checkout> node --test tests/brand-look-render.core.spec.mjs
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.13.0: a deck, a document and a workbook generated from the caller's kit are opened and carry its colors and faces, and the owner-scoped record names the look brand:<base>; a built-in look still records its id; an invalid kit is refused with the engine's reason before any draft, render, save, record or send; POST /brand-look builds the look for a signed-in caller only; email and Slack deliver in the brand look.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

const core = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!core || !fs.existsSync(path.join(core, 'src/features/presentation-generation/services/brand-theme.ts'))) {
  throw new Error('fixture:core-checkout with brand looks is required: set OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) to a framework checkout whose deck engine has brandTheme');
}
const coreRequire = Module.createRequire(path.join(core, 'package.json'));
const ts = coreRequire('typescript');
const JSZip = coreRequire('jszip');
const ExcelJS = coreRequire('exceljs');
const quiet = { error() {}, warn() {}, info() {}, debug() {}, child() { return quiet; } };
const loaded = new Map();

/** Resolve a core source module the way the framework's path aliases do. */
function sourceFile(base) {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return candidate;
  throw new Error(`cannot resolve core source ${base}`);
}

/** Load one core TypeScript module (and what it imports) from the framework checkout. */
function loadCore(filename) {
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const subject = new Module(filename);
  loaded.set(filename, subject);
  subject.filename = filename;
  subject.require = (name) => {
    if (name === '@/shared/logger') return { createChildLogger: () => quiet };
    if (name.startsWith('@/')) return loadCore(sourceFile(path.join(core, 'src', name.slice(2))));
    if (name.startsWith('.')) return loadCore(sourceFile(path.resolve(path.dirname(filename), name)));
    return coreRequire(name);
  };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  subject._compile(source, filename);
  return subject.exports;
}

const engine = loadCore(sourceFile(path.join(core, 'src/features/presentation-generation')));

function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => routes.set(`${method} ${routePath}`, handlers.at(-1));
  return { routes, get: register('get'), post: register('post'), put: register('put'), delete: register('delete') };
}

const seen = { saved: [], inserts: [], drafts: 0, mails: [], uploads: [], tokenReads: [] };
const stubs = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': engine,
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({ provider: 'oshal-local' }),
    saveContent: async (_ctx, sub, kind, fileName, content) => {
      seen.saved.push({ sub, kind, fileName, content });
      return { provider: 'oshal-local', location: `oshal-local/${fileName}`, downloadUrl: '/api/files/download', url: null };
    },
    listFolder: async () => ({ provider: 'oshal-local', files: [] }),
    deleteStoredFile: async () => ({ provider: 'oshal-local', removed: false }),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => { seen.drafts += 1; return { response: '[{"title":"Drafted","content":"a"}]' }; } },
  '@/app/routes/connectors-routes': {
    getValidAccessToken: async (_pool, sub, provider) => { seen.tokenReads.push(provider); return provider === 'google' || provider === 'slack' ? `${provider}-token-of-${sub}` : null; },
  },
  '@/app/routes/slack-client': { uploadSlackFile: async (token, input) => { seen.uploads.push({ token, input }); return { fileId: 'F1', permalink: 'https://slack.invalid/F1' }; } },
  '@/app/routes/email-routes': { sendGmail: async (token, mail) => { seen.mails.push({ token, mail }); return { id: 'm1' }; }, sendOutlookMail: async () => {} },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => body?.confirm === true,
    confirmationRequiredPayload: (operation) => ({ error: 'confirmation_required', operation }),
  },
};
const originalLoad = Module._load;
Module._load = function loadRouteSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
test.after(() => { Module._load = originalLoad; });

const pool = { query: async (sql, params) => { if (/INSERT INTO oshal_presentations/.test(sql)) seen.inserts.push(params); return { rows: [], rowCount: 1 }; } };
const routes = createBotPresentationRoutes({ pool, appPackageDir: path.resolve(here, '..') }).routes;

/** The caller's kit as the studio sends it: Create's roles and faces on the nearest look's layout. */
const BRAND = {
  base: 'executive',
  colors: { primary: '#7d2ae8', secondary: '#00a6a6', accent: '#ff7a59', dark: '#1d1733', light: '#fffdf7' },
  fonts: { heading: 'Georgia', body: 'Trebuchet MS' },
};
const INVALID = { ...BRAND, colors: { ...BRAND.colors, primary: 'red' } };
const OUTLINE = [
  { title: 'Where we are', content: 'shipped the runtime\nsigned three design partners' },
  { title: 'Revenue mix', content: 'Enterprise: 55\nMid-market: 30\nSelf-serve: 15' },
  { title: 'By segment', content: '| Segment | Revenue |\n| --- | --- |\n| Enterprise | 4100000 |' },
];
const OWNER = 'auth0|brand-owner';

function response() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  return res;
}

async function call(route, body, sub = OWNER) {
  const res = response();
  await routes.get(route)({ oidc: sub ? { user: { sub } } : undefined, body, query: {} }, res);
  return res;
}

function reset() { seen.saved.length = 0; seen.inserts.length = 0; seen.drafts = 0; seen.mails.length = 0; seen.uploads.length = 0; seen.tokenReads.length = 0; }

/** Every XML part of a rendered file, joined. */
async function xmlOf(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.xml$/.test(n));
  return (await Promise.all(names.map((n) => zip.files[n].async('string')))).join('\n');
}

test('a deck, a document and a workbook from the caller\'s kit carry its colors and faces; the owner\'s record names the brand look', async () => {
  for (const kind of ['pptx', 'docx', 'xlsx']) {
    reset();
    const res = await call(`post /${kind}`, { title: 'Northwind review', sections: OUTLINE, brand: BRAND });
    assert.equal(res.statusCode, 200, `${kind}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.theme, 'brand:executive');
    assert.equal(seen.saved.length, 1);
    const xml = await xmlOf(seen.saved[0].content);
    for (const value of ['7D2AE8', '1D1733', 'Trebuchet MS']) assert.ok(xml.includes(value), `${kind} lacks ${value}`);
    if (kind !== 'xlsx') assert.ok(xml.includes('Georgia'), `${kind} lacks the heading face`);
    for (const executive of ['C9A227', '12233F']) assert.ok(!xml.includes(executive), `${kind} carries the base look's ${executive}`);
    assert.equal(seen.inserts.length, 1);
    const [userSub, , , , , , , , theme, format] = seen.inserts[0];
    assert.deepEqual([userSub, theme, format], [OWNER, 'brand:executive', kind]);
  }
  const wb = new ExcelJS.Workbook();
  reset();
  await call('post /xlsx', { title: 'Northwind workbook', sections: OUTLINE, brand: BRAND });
  await wb.xlsx.load(seen.saved[0].content);
  const a1 = wb.getWorksheet('Overview').getCell('A1');
  assert.deepEqual([a1.font.name, a1.fill.fgColor.argb, a1.font.color.argb], ['Trebuchet MS', 'FF1D1733', 'FFFFFDF7']);
});

test('a built-in look still renders and records by its id', async () => {
  reset();
  const res = await call('post /pptx', { title: 'Plain', sections: OUTLINE, theme: 'executive' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.theme, 'executive');
  assert.equal(seen.inserts[0][8], 'executive');
  assert.ok((await xmlOf(seen.saved[0].content)).includes('C9A227'), 'the executive look draws its own gold');
});

test('an invalid kit is refused with the engine\'s reason before any draft, render, save or record', async () => {
  for (const kind of ['pptx', 'docx', 'xlsx']) {
    reset();
    const res = await call(`post /${kind}`, { title: 'T', topic: 'a deck the bot would draft', brand: INVALID });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_brand_look');
    assert.match(res.body.message, /primary color must be a six-digit hex/);
    assert.deepEqual([seen.drafts, seen.saved.length, seen.inserts.length], [0, 0, 0], `${kind} did work for a refused look`);
  }
});

test('POST /brand-look builds the look for a signed-in caller, refuses an invalid kit and stops an anonymous caller', async () => {
  const ok = await call('post /brand-look', BRAND);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.look.id, 'brand:executive');
  assert.deepEqual([ok.body.look.colors.accent, ok.body.look.colors.canvas, ok.body.look.fonts.heading], ['7D2AE8', 'FFFDF7', 'Georgia']);
  const refused = await call('post /brand-look', INVALID);
  assert.deepEqual([refused.statusCode, refused.body.error], [400, 'invalid_brand_look']);
  const anonymous = await call('post /brand-look', BRAND, null);
  assert.deepEqual([anonymous.statusCode, anonymous.body.error], [401, 'not_authenticated']);
});

test('email and Slack deliver the file in the brand look, and refuse an invalid kit before sending', async () => {
  reset();
  const mailed = await call('post /email', { confirm: true, to: 'colleague@oshal.example.com', title: 'Northwind', sections: OUTLINE, format: 'docx', brand: BRAND });
  assert.equal(mailed.statusCode, 200);
  assert.equal(seen.mails.length, 1);
  assert.ok((await xmlOf(Buffer.from(seen.mails[0].mail.attachment.contentBase64, 'base64'))).includes('7D2AE8'));
  reset();
  const shared = await call('post /slack', { confirm: true, channelId: 'C1', title: 'Northwind', sections: OUTLINE, format: 'pptx', brand: BRAND });
  assert.equal(shared.statusCode, 200);
  assert.ok((await xmlOf(seen.uploads[0].input.content)).includes('7D2AE8'));
  reset();
  const badMail = await call('post /email', { confirm: true, to: 'colleague@oshal.example.com', title: 'N', sections: OUTLINE, brand: INVALID });
  const badSlack = await call('post /slack', { confirm: true, channelId: 'C1', title: 'N', sections: OUTLINE, brand: INVALID });
  assert.deepEqual([badMail.statusCode, badSlack.statusCode], [400, 400]);
  assert.deepEqual([seen.mails.length, seen.uploads.length, seen.tokenReads.length], [0, 0, 0], 'a refused look reads no token and sends nothing');
});
