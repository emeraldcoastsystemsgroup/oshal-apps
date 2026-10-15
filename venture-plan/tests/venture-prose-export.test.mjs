/**
 * Venture Plan - what a person reads and exports carries the computed numbers, in words, from the current model.
 *
 * Sweep 9 on the phone (2026-10-12) found four ways a document disagreed with the model:
 *   1. After Regenerate prose the Executive summary read "a blended shelf price of {{fig:demand.priceMicros}}":
 *      the strategist writes every number as a figure token and proseSection printed the prose verbatim.
 *   2. plan.docx printed "**Decision this supports:**" and the tokens: the whole Markdown body went to the
 *      Office renderer, which prints every character it is given.
 *   3. A stored document showed "Landed cost per unit $25.12" while the Numbers tab showed $23.52: it was rendered
 *      from an earlier computation and nothing said so.
 *   4. A native run timed out at 60 s storing its 17 documents one insert at a time after the model was stored.
 *
 * Real here: PostgreSQL 16 (disposable, labelled, removed), the framework's database layer, the package's compiled
 * routes, run orchestration, store and document renderer, and the Office renderer the native kernel's office port
 * wraps (@oshal/office-runtime from OSHAL_PACKAGE_NODE_MODULES). Named seams: the analysts and the narrator (bot
 * calls return fixed replies), the caller identity (a fixed sub), the Express router (a recorder).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: tokens rendered and an unknown token rejecting its section only; the computed document set stored in one batched INSERT with per-document versions; stale documents marked on the list and the read and re-rendered for print and export; plan.docx free of Markdown markers and tokens through the real Office renderer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: the rejected section no longer prints the cited machine name; it reads "cited a figure the model did not compute".
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { freshSchema, startPostgres } from './venture-schema-postgres.fixture.mjs';

process.env.LOG_LEVEL = 'silent';
process.env.OSHAL_EGRESS = 'kernel';
delete process.env.OSHAL_SCHEMA_BOOTSTRAP;
const require = createRequire(import.meta.url);
const boot = require('./helpers/venture-schema-boot.cjs');
const ROUTES = path.join(boot.PKG, 'routes');
const OWNER = 'venture-prose-owner';
const ON_DATE = '2026-10-12';
const NM = process.env.OSHAL_PACKAGE_NODE_MODULES;

const narration = { sections: {} };
const sql = [];
let fixture;
let api;
let identity;
let Run;
let Store;
let Docs;
let Outputs;
let routes;
const cleanups = [];

/** @description The market and ops replies a filled analyst gives (every required slot). @returns {string} */
function slots(keys) {
  return JSON.stringify({ assumptions: [], schedule_tasks: [], headcount_roles: [], required: Object.fromEntries(keys.map((k, i) => [k,
    { value: 10 + i, low: 5 + i, high: 20 + i, confidence: 'low', basis: 'fixture analyst', sourceUrl: null }])) });
}

/** @description Serve the compiled modules their real dependencies with the bot calls, caller and Office renderer named. */
function seams() {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '@/app/routes/caller-sub') return { callerSub: () => OWNER };
    if (request === '@/features/presentation-generation') return require(path.join(NM, '@oshal', 'office-runtime'));
    const loaded = original.call(this, request, parent, isMain);
    if (request !== './venture-bots' || parent?.filename !== path.join(ROUTES, 'venture-run.js')) return loaded;
    return {
      ...loaded,
      authorMarket: async () => ({ text: slots(['baseDemandUnits', 'retailPriceUsd', 'dtcCostPerOrderUsd', 'seasonSellThroughPercent']), costUsd: 0, model: 'fixture', durationMs: 1 }),
      authorOps: async () => ({ text: slots(['containerFreightUsd', 'htsDutyPercent', 'finalAssemblyCostUsd', 'unitsPerContainer', 'cbmPerUnit']), costUsd: 0, model: 'fixture', durationMs: 1 }),
      authorBom: async () => ({ text: '{"bom_lines": [], "vendor_candidates": []}', costUsd: 0, model: 'fixture', durationMs: 1 }),
      narrate: async () => ({ text: JSON.stringify({ sections: narration.sections }), costUsd: 0, model: 'fixture', durationMs: 1 }),
    };
  };
}

/** @description Run fn as the venture owner, the identity the GUC pool stamps for owner RLS. */
function asOwner(fn) {
  return identity.runWithRequestIdentity({ sub: OWNER, principalIssuer: null, isOperator: false }, fn);
}

/** @description A pool that records every statement it is given, then forwards it. */
function recording(pool) {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') return (text, ...rest) => { sql.push(String(text?.text ?? text)); return target.query(text, ...rest); };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** @description Drive one registered GET route; resolves with what it answered. */
function get(route, params) {
  return new Promise((resolve, reject) => {
    const res = { headers: {}, statusCode: 200, headersSent: false };
    res.status = (c) => { res.statusCode = c; return res; };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.type = (t) => { res.headers['content-type'] = t; return res; };
    res.json = (body) => { res.headersSent = true; resolve({ code: res.statusCode, body }); };
    res.send = (body) => { res.headersSent = true; resolve({ code: res.statusCode, body, headers: res.headers }); };
    asOwner(() => routes.get(route)({ params, query: {}, originalUrl: route }, res)).catch(reject);
  });
}

/** @description One authoring run as the owner on the native path. @returns {Promise<object>} The run's stored row. */
async function run(ventureId, kind, docKeys) {
  const ctx = { pool: api.pool, appPackageDir: boot.PKG };
  await asOwner(() => Run.startRun(ctx, OWNER, ventureId, kind, docKeys, ON_DATE));
  return asOwner(() => Store.latestRun(api.pool, OWNER, ventureId));
}

before(async () => {
  assert.ok(NM, 'OSHAL_PACKAGE_NODE_MODULES must name the kernel runtime node_modules (the Office renderer); a skipped guard is not a guard');
  const framework = boot.loadFramework();
  identity = require(path.join(framework.core, 'src', 'shared', 'services', 'database', 'request-identity.ts'));
  fixture = await startPostgres((cleanup) => cleanups.push(cleanup), framework.Pool);
  api = boot.apiPool(framework, fixture.appConfig);
  api.pool = recording(api.pool);
  await freshSchema(fixture.admin);
  boot.forgetPackageModules();
  seams();
  await require(path.join(ROUTES, 'venture-schema.js')).ensureVentureSchema(api.pool);
  Run = require(path.join(ROUTES, 'venture-run.js'));
  Store = require(path.join(ROUTES, 'venture-store.js'));
  Outputs = require(path.join(ROUTES, 'venture-store-outputs.js'));
  Docs = require(path.join(ROUTES, 'venture-routes-docs.js'));
  routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  Docs.registerDocumentRoutes({ get: reg('GET'), post: reg('POST') }, { pool: api.pool }, api.pool);
}, { timeout: 120000 });

after(async () => {
  await api?.raw.end();
  for (const cleanup of cleanups.reverse()) await cleanup();
  console.log(JSON.stringify({ fixture: 'venture-prose-export', ...fixture?.evidence }));
});

/** A venture with a computed model and its stored document set, as a native full run leaves it. */
async function computedVenture(name) {
  const venture = await asOwner(() => Store.insertVenture(api.pool, OWNER, { name, ideaText: 'a clip-on reading light' }));
  await run(venture.id, 'market');
  sql.length = 0;
  const latest = await run(venture.id, 'full');
  return { venture, latest };
}

test('a native run stores its computed documents in one INSERT, each at its next version', { timeout: 60000 }, async () => {
  const { venture } = await computedVenture('sweep10-batch light');
  const inserts = sql.filter((s) => /INSERT INTO venture_documents/.test(s));
  assert.equal(inserts.length, 1, 'one statement stores the whole document set');
  assert.match(inserts[0], /jsonb_to_recordset/);
  const docs = await asOwner(() => Outputs.listDocuments(api.pool, OWNER, venture.id, false));
  assert.ok(docs.length >= 15, `the catalogue is stored (${docs.length})`);
  assert.ok(docs.every((d) => d.version === 1 && d.proseStatus === 'none'));
  await asOwner(() => Outputs.insertDocumentVersions(api.pool, OWNER, venture.id, [
    { docKey: docs[0].docKey, modelId: docs[0].modelId, title: 't', bodyMd: 'b', sections: [] },
    { docKey: docs[0].docKey, modelId: docs[0].modelId, title: 't2', bodyMd: 'b2', sections: [] },
  ]));
  const again = await asOwner(() => Outputs.getDocument(api.pool, OWNER, venture.id, docs[0].docKey, null));
  assert.equal(again.version, 2, 'the next version, once, for a key given twice');
  assert.equal(again.title, 't2', 'the last entry for a key wins');
});

test('narrated prose prints the computed figures; an unknown figure rejects only its own section', { timeout: 60000 }, async () => {
  const { venture } = await computedVenture('sweep10-prose light');
  const snapshot = await asOwner(() => Outputs.latestModel(api.pool, OWNER, venture.id, null));
  const money = Object.values(snapshot.figures).find((f) => f.unit === 'micros');
  assert.ok(money, 'the model computed a money figure');
  narration.sections = {
    overview: `The plan prices at {{fig:${money.id}}} across {{fig:ledger.total}} registered assumptions.`,
    'what-must-be-true': 'It needs {{fig:demand.notARealFigure}} to hold.',
  };
  await run(venture.id, 'narrate', ['executive-summary']);
  const { body } = await get('GET /ventures/:id/documents/:docKey', { id: venture.id, docKey: 'executive-summary' });
  const md = body.document.bodyMd;
  assert.doesNotMatch(md, /\{\{fig:/, 'no raw token reaches the reader');
  const shown = require(path.join(ROUTES, 'venture-figures.js')).formatFigure(money);
  assert.ok(md.includes(`The plan prices at ${shown} across`), `the money figure as the engine formats it (${shown})`);
  assert.match(md, new RegExp(`across ${snapshot.figures['ledger.total'].value} registered assumptions`));
  assert.match(md, /Not written: the strategist's draft cited a figure the model did not compute, so the section was rejected/);
  assert.doesNotMatch(md, /notARealFigure/, 'no machine name reaches the reader');
  assert.deepEqual(body.document.unverifiedNumbers, [], 'a token is a cited figure, not an unverified number');
  assert.equal(body.document.stale, null, 'rendered from the latest computation');
});

test('a document from an earlier computation is marked stale, and print and export render the current numbers', { timeout: 60000 }, async () => {
  const { venture } = await computedVenture('sweep10-stale light');
  const before = await asOwner(() => Outputs.latestModel(api.pool, OWNER, venture.id, null));
  const recomputed = await asOwner(() => Run.recomputeVenture(api.pool, OWNER, venture.id, { onDate: ON_DATE }));
  assert.notEqual(recomputed.snapshot.id, before.id);
  const list = await get('GET /ventures/:id/documents', { id: venture.id });
  assert.ok(list.body.documents.length > 0);
  assert.ok(list.body.documents.every((d) => d.stale && d.stale.latestModelId === recomputed.snapshot.id), 'every stored document is marked');
  const read = await get('GET /ventures/:id/documents/:docKey', { id: venture.id, docKey: 'executive-summary' });
  assert.equal(read.body.document.modelId, before.id, 'the stored version is what the read shows');
  assert.equal(read.body.document.stale.latestComputedAt, recomputed.snapshot.computedAt);
  const print = await get('GET /ventures/:id/documents/:docKey/print', { id: venture.id, docKey: 'executive-summary' });
  assert.match(print.body, new RegExp(`Computed ${recomputed.snapshot.computedAt.replace(/[.]/g, '\\.')}`), 'print renders from the current computation');
});

test('plan.docx carries no Markdown markers and no figure tokens through the real Office renderer', { timeout: 60000 }, async () => {
  const { venture } = await computedVenture('sweep10-docx light');
  const out = await get('GET /ventures/:id/export/plan.docx', { id: venture.id });
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  const JSZip = require(path.join(NM, 'jszip'));
  const xml = await (await JSZip.loadAsync(out.body)).file('word/document.xml').async('string');
  const text = xml.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /\*\*/, 'no bold markers');
  assert.doesNotMatch(text, /\{\{fig:/, 'no figure tokens');
  assert.doesNotMatch(text, /(^|\s)> /, 'no quote markers');
  assert.match(text, /Decision this supports:/);
  assert.match(text, /sweep10-docx light/);
  const slides = Docs.officeSlides([{ title: 'Doc', bodyMd: '# Doc\n\n**Name** · for *you*\n\n> **Posture: estimate.** x\n\n## A\n\n| a | b |\n|---|---|\n| 1 \\| 2 | 3 |\n\n## B\n\n| c |\n|---|\n| 4 |\n' }]);
  assert.deepEqual(slides.map((s) => s.title), ['Doc', 'Doc · A', 'Doc · B'], 'one slide per heading, so each table stays its own');
  assert.equal(slides[0].content, 'Name · for you\nPosture: estimate. x');
  assert.equal(slides[1].content, '| a | b |\n|---|---|\n| 1 / 2 | 3 |', 'an escaped pipe cannot split a cell');
});
