/**
 * Venture Plan - an analyst run never replaces a number a person entered or a vendor quoted, against a disposable
 * PostgreSQL.
 *
 * WHAT THIS PROVES. The ops and market analysts fill code-owned slots under the exact keys the composed model
 * reads (venture-required-inputs: landed.freight.container-rate, landed.duty.hts-rate, bom.final-assembly.cost,
 * market.demand.base-units, channel.retail-price, channel.dtc.terms, season.sell-through), and compose computes
 * with whatever row is live for those keys. Up to store 9a82cec2 every analyst write superseded the live row
 * whatever its source, so a vendor quote recorded on landed.freight.container-rate or a person's own duty rate was
 * quietly replaced by the analyst's guess when Run was pressed again: the landed cost moved and the coverage fell
 * back to estimate. Here a quote and a person's entry hold two of the ops slots; an ops run fills all three; the
 * live rows must still be the quote and the person's entry, the third slot (held by nothing but an estimate)
 * must take the analyst's value, the phase must name no gap, and the composed input must compute with the quoted
 * freight and the entered duty. A second ops run that leaves the quoted slot empty must not report it as a gap,
 * and must still replace the analyst's own earlier estimate.
 *
 * HOW. Real: the compiled routes (venture-run, venture-store, venture-store-supply applyQuote, venture-store-compose),
 * the package's schema bootstrap with its forced owner RLS, the framework's identity (GUC) pool wrapper and runtime
 * DDL guard, the pg driver and PostgreSQL. Named seams: the analysts' bot calls (authorOps returns a fixture reply;
 * no provider is reached), the logger, and the bot client the schema boot already makes inert. The run is driven
 * the native way (OSHAL_EGRESS=kernel), so startRun awaits it inside the call.
 *
 * Needs Docker with postgres:16-alpine already present (never pulled) and a framework checkout with node_modules
 * (OSHAL_CORE_ROOT / OSHAL_CORE_DIR / OSHAL_FRAMEWORK_ROOT, default the sibling ../../oshal). Without either it FAILS.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: a vendor quote and a person's entry on two ops slots survive an ops run that fills them, the composed freight and duty are the quoted and entered values, a held slot is no gap, and an analyst's own estimate is still replaced.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The ops fixture fills the two container-fill slots, and the composed freight computes with them. A second BOM run that redrafts the lines (live: six lowercase bom.bl-* refs, then six uppercase bom.BL-* refs, 13 BOM costs live) closes the BOM analyst's estimates for lines and vendors the redraft no longer has, keeps a person's entry on an old line, and leaves the closed rows in the key's history.
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
const OWNER = 'venture-evidence-owner';
const ON_DATE = '2026-10-12';
const QUOTED_FREIGHT_MICROS = 4_200_000_000;
const ENTERED_DUTY_BPS = 250;

/** The ops reply the fixture analyst gives; `slots` overrides or drops (null) individual slots. */
const ops = { slots: {} };
/** @description An ops reply with the three required slots, as the live analyst returns them. @returns {string} */
function opsReply() {
  const base = {
    containerFreightUsd: { value: 2500, low: 2000, high: 3000, confidence: 'medium', basis: 'fixture analyst', sourceUrl: null },
    htsDutyPercent: { value: 6.5, low: 5, high: 8, confidence: 'low', basis: 'fixture analyst', sourceUrl: null },
    finalAssemblyCostUsd: { value: 3, low: 2, high: 4, confidence: 'low', basis: 'fixture analyst', sourceUrl: null },
    unitsPerContainer: { value: 2500, low: 2000, high: 3000, confidence: 'low', basis: 'fixture analyst', sourceUrl: null },
    cbmPerUnit: { value: 0.0015, low: 0.001, high: 0.002, confidence: 'low', basis: 'fixture analyst', sourceUrl: null },
  };
  const required = Object.fromEntries(Object.entries({ ...base, ...ops.slots }).filter(([, v]) => v !== null));
  return JSON.stringify({ assumptions: [], schedule_tasks: [], headcount_roles: [], required });
}

/** The BOM reply the fixture analyst gives: lines as [ref, partName, dollars], all from one vendor. */
const bom = { lines: [], vendor: 'Fixture Vendor' };
/** @description A BOM reply in the contract the prompt states. @returns {string} */
function bomReply() {
  return JSON.stringify({
    bom_lines: bom.lines.map(([ref, partName, usd]) => ({
      ref, parentRef: null, partName, qtyPerUnit: 1, uom: 'ea', discrete: true, makeOrBuy: 'buy',
      lowMicros: usd * 900_000, highMicros: usd * 1_100_000, scrapPct: 1, vendorName: bom.vendor, confidence: 'medium',
    })),
    vendor_candidates: [{ name: bom.vendor, kind: 'component', depositBps: 3000, balanceNetDays: 30, confidence: 'medium' }],
  });
}

let fixture;
let api;
let identity;
let Run;
let Store;
let Supply;
let Compose;
const cleanups = [];
const botCalls = [];

/** @description Serve the compiled venture-run its real bot module with only the analysts' calls replaced. */
function seamAnalysts() {
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    const loaded = original.call(this, request, parent, isMain);
    if (request !== './venture-bots' || parent?.filename !== path.join(ROUTES, 'venture-run.js')) return loaded;
    return {
      ...loaded,
      authorOps: async () => { botCalls.push('ops'); return { text: opsReply(), costUsd: 0, model: 'fixture', durationMs: 1 }; },
      authorMarket: async () => { throw new Error('the market analyst is not part of this suite'); },
      authorBom: async () => { botCalls.push('bom'); return { text: bomReply(), costUsd: 0, model: 'fixture', durationMs: 1 }; },
    };
  };
}

/** @description Run fn as the venture owner, the identity the GUC pool stamps for owner RLS. */
function asOwner(fn) {
  return identity.runWithRequestIdentity({ sub: OWNER, principalIssuer: null, isOperator: false }, fn);
}

/** @description The live ledger row for one key. */
async function live(ventureId, key) {
  const rows = await asOwner(() => Store.liveAssumptions(api.pool, OWNER, ventureId));
  return rows.find((r) => r.key === key) ?? null;
}

/** @description The engine input compose builds from the venture's stored rows. */
async function composed(ventureId) {
  return asOwner(async () => {
    const [venture, assumptions, bomLines, vendors, headcount] = await Promise.all([
      Store.getVenture(api.pool, OWNER, ventureId), Store.liveAssumptions(api.pool, OWNER, ventureId),
      Supply.listBom(api.pool, OWNER, ventureId), Supply.listVendors(api.pool, OWNER, ventureId),
      Supply.listHeadcount(api.pool, OWNER, ventureId),
    ]);
    return Compose.composeModelInput({ venture, assumptions, bomLines, vendors, headcount, scenario: null, onDate: ON_DATE }).input;
  });
}

/** @description Start an ops run as the owner and return its stored phase. */
async function runOps(ventureId) {
  const ctx = { pool: api.pool, appPackageDir: boot.PKG };
  const started = await asOwner(() => Run.startRun(ctx, OWNER, ventureId, 'ops', undefined, ON_DATE));
  assert.equal(started.alreadyRunning, false);
  const run = await asOwner(() => Store.latestRun(api.pool, OWNER, ventureId));
  assert.equal(run.id, started.runId);
  return { run, phase: run.phases.find((p) => p.name === 'ops') };
}

before(async () => {
  const framework = boot.loadFramework();
  identity = require(path.join(framework.core, 'src', 'shared', 'services', 'database', 'request-identity.ts'));
  fixture = await startPostgres((cleanup) => cleanups.push(cleanup), framework.Pool);
  api = boot.apiPool(framework, fixture.appConfig);
  await freshSchema(fixture.admin);
  boot.forgetPackageModules();
  seamAnalysts();
  await require(path.join(ROUTES, 'venture-schema.js')).ensureVentureSchema(api.pool);
  Run = require(path.join(ROUTES, 'venture-run.js'));
  Store = require(path.join(ROUTES, 'venture-store.js'));
  Supply = require(path.join(ROUTES, 'venture-store-supply.js'));
  Compose = require(path.join(ROUTES, 'venture-store-compose.js'));
}, { timeout: 120000 });

after(async () => {
  await api?.raw.end();
  for (const cleanup of cleanups.reverse()) await cleanup();
  console.log(JSON.stringify({ fixture: 'venture-run-evidence-slots', ...fixture?.evidence }));
});

test('an ops run keeps a recorded vendor quote and a person\'s own entry on its slots, and the plan computes with them', { timeout: 60000 }, async () => {
  const venture = await asOwner(() => Store.insertVenture(api.pool, OWNER, { name: 'Evidence widget', ideaText: 'a widget' }));
  const vendor = await asOwner(() => Supply.insertVendor(api.pool, OWNER, venture.id, {
    name: 'Fixture Freight', sourceKind: 'user-entered', confidence: 'medium',
  }));
  const quoted = await asOwner(() => Supply.applyQuote(api.pool, OWNER, venture.id, {
    vendorId: vendor.id, unitCostMicros: QUOTED_FREIGHT_MICROS, assumptionKey: 'landed.freight.container-rate',
    documentRef: 'fixture quote FQ-1', label: 'Ocean freight per 40ft container (quoted)',
  }));
  const entered = await asOwner(() => Store.upsertAssumption(api.pool, OWNER, venture.id, {
    key: 'landed.duty.hts-rate', domain: 'compliance', label: 'HTS import duty rate', unit: 'bps',
    valueNum: ENTERED_DUTY_BPS, lowNum: ENTERED_DUTY_BPS, highNum: ENTERED_DUTY_BPS,
    sourceKind: 'user-entered', sourceDetail: 'my broker', confidence: 'high',
  }, `user:${OWNER}`, null));

  const first = await runOps(venture.id);
  assert.deepEqual(botCalls, ['ops']);
  assert.equal(first.phase.status, 'done');
  assert.equal(first.phase.error, null, 'a slot a quote or a person holds is not a gap');

  const freight = await live(venture.id, 'landed.freight.container-rate');
  assert.equal(freight.id, quoted.assumption.id, 'the quote is still the live freight row');
  assert.equal(freight.sourceKind, 'vendor-quote');
  assert.equal(freight.valueNum, QUOTED_FREIGHT_MICROS);
  const duty = await live(venture.id, 'landed.duty.hts-rate');
  assert.equal(duty.id, entered.assumption.id, 'the person\'s duty rate is still live');
  assert.equal(duty.sourceKind, 'user-entered');
  const assembly = await live(venture.id, 'bom.final-assembly.cost');
  assert.equal(assembly.sourceKind, 'model-estimate', 'a slot nobody holds takes the analyst\'s value');
  assert.equal(assembly.valueNum, 3_000_000);

  const input = await composed(venture.id);
  assert.equal(input.landed.freight.containerCostMicros, QUOTED_FREIGHT_MICROS);
  assert.equal(input.landed.duty.htsDutyBps, ENTERED_DUTY_BPS);
  assert.equal(input.landed.freight.unitsPerContainer, 2500, 'the registered container fill is what the freight ships');
  assert.equal(input.landed.freight.cbmPerUnit, 0.0015);
  assert.equal(Run.needsAnotherRun(first.phase), false, 'Run does not repeat the analyst over held slots');

  // The next run leaves the quoted slot empty and revises its own estimate.
  ops.slots = { containerFreightUsd: null, finalAssemblyCostUsd: { value: 4, low: 3, high: 5, confidence: 'low', basis: 'revised', sourceUrl: null } };
  const second = await runOps(venture.id);
  assert.equal(second.phase.status, 'done');
  assert.equal(second.phase.error, null, 'an empty slot a quote holds is not a gap');
  assert.equal((await live(venture.id, 'landed.freight.container-rate')).id, quoted.assumption.id);
  const revised = await live(venture.id, 'bom.final-assembly.cost');
  assert.notEqual(revised.id, assembly.id, 'the analyst still revises its own earlier estimate');
  assert.equal(revised.valueNum, 4_000_000);
});

/** @description Start a BOM run as the owner and return its stored phase. */
async function runBom(ventureId) {
  const ctx = { pool: api.pool, appPackageDir: boot.PKG };
  await asOwner(() => Run.startRun(ctx, OWNER, ventureId, 'bom', undefined, ON_DATE));
  const run = await asOwner(() => Store.latestRun(api.pool, OWNER, ventureId));
  return run.phases.find((p) => p.name === 'bom');
}

/** @description The live keys under a prefix and suffix, sorted. */
async function liveKeys(ventureId, re) {
  const rows = await asOwner(() => Store.liveAssumptions(api.pool, OWNER, ventureId));
  return rows.map((r) => r.key).filter((k) => re.test(k)).sort();
}

test('a BOM redraft closes the analyst\'s estimates for lines and vendors it no longer has, never a person\'s entry', { timeout: 60000 }, async () => {
  const venture = await asOwner(() => Store.insertVenture(api.pool, OWNER, { name: 'Redraft light', ideaText: 'a clip-on light' }));
  bom.lines = [['bl-battery', 'Battery', 1], ['bl-housing', 'Housing', 2], ['bl-pcba', 'PCBA', 5]];
  bom.vendor = 'First Vendor';
  assert.equal((await runBom(venture.id)).status, 'done');
  const firstTerms = await liveKeys(venture.id, /^supplier\..*\.terms$/);
  assert.equal(firstTerms.length, 1);
  assert.deepEqual(await liveKeys(venture.id, /^bom\..*\.unit-cost$/),
    ['bom.bl-battery.unit-cost', 'bom.bl-housing.unit-cost', 'bom.bl-pcba.unit-cost']);
  const battery = await live(venture.id, 'bom.bl-battery.unit-cost');
  // The person replaces one line's cost with their own figure.
  await asOwner(() => Store.upsertAssumption(api.pool, OWNER, venture.id, {
    key: 'bom.bl-housing.unit-cost', domain: 'manufacturing', label: 'Housing unit cost', unit: 'micros',
    valueNum: 2_500_000, lowNum: 2_500_000, highNum: 2_500_000, sourceKind: 'user-entered', sourceDetail: 'my sample', confidence: 'high',
  }, `user:${OWNER}`, null));

  bom.lines = [['BL-BATT', 'Battery', 1], ['BL-CASE', 'Case', 2]];
  bom.vendor = 'Second Vendor';
  assert.equal((await runBom(venture.id)).status, 'done');
  assert.deepEqual(await liveKeys(venture.id, /^bom\..*\.unit-cost$/),
    ['bom.BL-BATT.unit-cost', 'bom.BL-CASE.unit-cost', 'bom.bl-housing.unit-cost'],
    'the first draft\'s estimates are closed; the person\'s entry stays live');
  assert.equal((await live(venture.id, 'bom.bl-housing.unit-cost')).sourceKind, 'user-entered');
  const terms = await liveKeys(venture.id, /^supplier\..*\.terms$/);
  assert.equal(terms.length, 1, 'only the second draft\'s vendor terms are live');
  assert.notDeepEqual(terms, firstTerms);
  const history = await asOwner(() => Store.assumptionHistory(api.pool, OWNER, venture.id, 'bom.bl-battery.unit-cost'));
  assert.equal(history.length, 1, 'a closed estimate stays in its history');
  assert.equal(history[0].id, battery.id);
  assert.equal(history[0].supersededBy, battery.id, 'closed with no successor');
  const input = await composed(venture.id);
  assert.equal(input.product.bom.children.length, 2, 'the plan rolls up the redrafted lines only');
});
