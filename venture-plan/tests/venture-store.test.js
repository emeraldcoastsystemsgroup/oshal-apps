/**
 * Venture Plan — owner-scoping guards for the store layer.
 *
 * WHAT THIS SUITE IS PROVING. A venture holds somebody's idea, their costs, their
 * suppliers and their cash position. If one user could read or move another's row,
 * the app would be worse than useless — it would be a leak with a business plan
 * attached. RLS is the backstop, but a backstop that has never been tested is a
 * hope, and RLS is exempted for superuser roles anyway, so the handlers' own
 * predicates are the thing that actually has to hold.
 *
 * So every assertion here is on the SQL THE STORE ACTUALLY ISSUED, captured from a
 * fake pool, and on what the functions RETURN — never on the text of the source.
 * A guard that greps for `owner_sub` in the file would pass a function that built
 * the string and never sent it.
 *
 * THE OTHER HALF is the append-only rule. `upsertAssumption` must never issue an
 * UPDATE that changes a value: replacing a guessed number with a real quote has to
 * leave the guess readable, dated and attributed, or the app's central claim —
 * "you can see which numbers were invented" — is false the moment anybody improves
 * one.
 *
 * Runs against the COMPILED routes/*.js, the same bytes the framework mounts, with
 * the framework seams stubbed at the require layer. Dependency-free node:test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the blanket owner-predicate sweep over every store read and write, cross-sub isolation asserted on returned values and on the parameters actually sent, the supersede-not-overwrite proof, applyQuote's three-part transaction, and the schema/RLS/migration agreement checks.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard immutable/concurrently idempotent FX persistence, exact foreign-quote binding, owner-bound quote references, atomic quote writes, and scenario micro-price storage.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard owner-bound rebaseline policy/run writes, slot idempotency, exact cost evidence, and migration/runtime schema agreement.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');

/* ── require-layer stubs for the framework seams ─────────────────────────── */
const captured = { bootstrap: [] };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': {
    buildOwnerRlsPolicyStatements: (table, col) => [
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY ${table}_owner_or_operator ON ${table} USING (${col} = current_setting('oshal.current_sub', true))`,
    ],
    runRuntimeSchemaBootstrap: async (opts) => { captured.bootstrap.push(opts); },
  },
};
const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const store = require(path.join(PKG, 'routes', 'venture-store.js'));
const supply = require(path.join(PKG, 'routes', 'venture-store-supply.js'));
const fxStore = require(path.join(PKG, 'routes', 'venture-store-fx.js'));
const rebaselineStore = require(path.join(PKG, 'routes', 'venture-store-rebaseline.js'));
const outputs = require(path.join(PKG, 'routes', 'venture-store-outputs.js'));
const schema = require(path.join(PKG, 'routes', 'venture-schema.js'));

/* ── a pool that records everything it was asked to run ──────────────────── */
function makePool(impl) {
  const pool = { calls: [], released: 0 };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params: params || [] });
    return impl ? impl(String(sql), params || [], pool.calls.length) : { rows: [], rowCount: 0 };
  };
  pool.connect = async () => ({
    query: pool.query,
    release: () => { pool.released += 1; },
  });
  return pool;
}

/** A minimal ventures row the mappers accept. */
function ventureRow(over) {
  return Object.assign({
    id: 'v1', owner_sub: 'alice', name: 'Widget', idea_text: 'an idea', spec: {},
    currency: 'USD', target_launch_date: null, stage: 'scoped', horizon_months: 36,
    open_questions: [], created_at: new Date(0), updated_at: new Date(0),
  }, over || {});
}

/** A minimal assumptions row. */
function assumptionRow(over) {
  return Object.assign({
    id: 'a1', venture_id: 'v1', owner_sub: 'alice', key: 'bom.x.unit-cost',
    domain: 'manufacturing', label: 'X', unit: 'micros', value_num: '1000000',
    value_text: null, low_num: null, high_num: null, source_kind: 'model-estimate',
    source_detail: null, source_url: null, confidence: 'low', authored_by: 'bot',
    run_id: null, superseded_by: null, created_at: new Date(0),
  }, over || {});
}

/** A minimal vendor row for owner-bound quote references. */
function vendorRow(over) {
  return Object.assign({
    id: 'ven1', venture_id: 'v1', owner_sub: 'alice', name: 'Factory', kind: 'manufacturer',
    country: 'DE', url: null, contact: null, moq: 1, lead_time_days: 30,
    qualification_days: 0, deposit_bps: 0, balance_net_days: 0, qualified: true,
    notes: null, status: 'active', source_kind: 'user-entered', confidence: 'high',
  }, over || {});
}

/** A minimal immutable FX row. */
function fxRow(over) {
  return Object.assign({
    id: 'fx1', venture_id: 'v1', owner_sub: 'alice', source_currency: 'EUR',
    reporting_currency: 'USD', rate_nanos: '1085000000', source_kind: 'published-source',
    source_ref: 'ECB reference rate', observed_at: new Date('2026-08-01T00:00:00Z'),
    idempotency_key: 'quote-eur-20260801', authored_by: 'user:alice',
    created_at: new Date('2026-08-01T00:00:00Z'), was_inserted: true,
  }, over || {});
}

/** Statements that read or write a venture table. Ignores transaction control. */
const dataCalls = (pool) => pool.calls.filter((c) => /venture_[a-z_]+/.test(c.sql));

/* ══ 1. the blanket sweep: no venture query without an owner predicate ═════ */

test('EVERY store read and write carries an owner_sub predicate and the caller sub', async () => {
  const pool = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_assumptions/.test(sql)) return { rows: [assumptionRow()], rowCount: 1 };
    if (/INSERT INTO/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const sub = 'alice';
  await store.listVentures(pool, sub);
  await store.getVenture(pool, sub, 'v1');
  await store.deleteVenture(pool, sub, 'v1');
  await store.liveAssumptions(pool, sub, 'v1');
  await store.assumptionHistory(pool, sub, 'v1', 'k');
  await store.listScenarios(pool, sub, 'v1');
  await store.getScenario(pool, sub, 'v1', 's1');
  await store.listRuns(pool, sub, 'v1');
  await store.getRun(pool, sub, 'r1');
  await store.latestRun(pool, sub, 'v1');
  await fxStore.listFxAssumptions(pool, sub, 'v1');
  await fxStore.getFxAssumption(pool, sub, 'v1', 'fx1');
  await supply.listBom(pool, sub, 'v1');
  await supply.getBomLine(pool, sub, 'v1', 'l1');
  await supply.listVendors(pool, sub, 'v1');
  await supply.getVendor(pool, sub, 'v1', 'ven1');
  await supply.listQuotes(pool, sub, 'v1');
  await supply.listScheduleTasks(pool, sub, 'v1');
  await supply.listHeadcount(pool, sub, 'v1');
  await supply.deleteBomSubtree(pool, sub, 'v1', 'l1');
  await outputs.latestModel(pool, sub, 'v1', null);
  await outputs.latestModel(pool, sub, 'v1', 'sc1');
  await outputs.getModel(pool, sub, 'm1');
  await outputs.listDocuments(pool, sub, 'v1', false);
  await outputs.getDocument(pool, sub, 'v1', 'k', null);
  await outputs.getDocument(pool, sub, 'v1', 'k', 3);
  await outputs.documentHistory(pool, sub, 'v1', 'k');

  const offenders = dataCalls(pool).filter((c) => !/owner_sub/.test(c.sql));
  assert.deepEqual(offenders.map((c) => c.sql.slice(0, 90)), [],
    'every statement touching a venture table must carry an owner_sub predicate');
  const unscoped = dataCalls(pool).filter((c) => !c.params.includes(sub));
  assert.deepEqual(unscoped.map((c) => c.sql.slice(0, 90)), [],
    "every statement must be parameterised on the CALLER's sub, not a literal");
  assert.ok(dataCalls(pool).length >= 27, 'the sweep must actually have exercised every reader');
});

/* ══ 2. cross-sub isolation, asserted on returned values ══════════════════ */

test("a second user cannot read another's venture — and the query proves the scope", async () => {
  // The fake database holds exactly one venture, owned by alice. It answers only
  // when BOTH the id and the owner match, which is what a scoped WHERE does.
  const pool = makePool((sql, params) => {
    if (/FROM venture_ventures/.test(sql) && params[0] === 'v1' && params[1] === 'alice') {
      return { rows: [ventureRow()], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  assert.ok(await store.getVenture(pool, 'alice', 'v1'), 'the owner reads their own venture');
  assert.equal(await store.getVenture(pool, 'mallory', 'v1'), null,
    "a foreign id must answer null — the SAME answer as 'does not exist', so nothing leaks");
  const foreign = pool.calls[pool.calls.length - 1];
  assert.equal(foreign.params[1], 'mallory', 'the query must carry the CALLER, never the owner');
});

test("a second user cannot mutate or delete another's venture", async () => {
  const pool = makePool((sql, params) => {
    const ownerMatches = params.includes('alice');
    if (/UPDATE venture_ventures/.test(sql)) {
      return ownerMatches ? { rows: [ventureRow({ name: 'renamed' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/DELETE FROM venture_ventures/.test(sql)) return { rows: [], rowCount: ownerMatches ? 1 : 0 };
    if (/FROM venture_ventures/.test(sql)) return { rows: ownerMatches ? [ventureRow()] : [], rowCount: ownerMatches ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  assert.equal(await store.updateVenture(pool, 'mallory', 'v1', { name: 'stolen' }), null);
  assert.equal(await store.deleteVenture(pool, 'mallory', 'v1'), false);
  assert.ok(await store.updateVenture(pool, 'alice', 'v1', { name: 'renamed' }));
  assert.equal(await store.deleteVenture(pool, 'alice', 'v1'), true);
});

test("a second user cannot mutate another's BOM line or vendor", async () => {
  const pool = makePool((sql, params) => (params.includes('alice') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 }));
  assert.equal(await supply.updateBomLine(pool, 'mallory', 'v1', 'l1', { partName: 'x' }), null);
  assert.equal(await supply.updateVendor(pool, 'mallory', 'v1', 'x1', { name: 'x' }), null);
  for (const c of dataCalls(pool)) {
    assert.ok(c.params.includes('mallory'), 'the write must be scoped to the caller');
    assert.ok(!c.params.includes('alice'), 'the owner must never appear in a foreign caller\'s query');
  }
});

test('an unknown patch key can never become a column', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  await supply.updateBomLine(pool, 'alice', 'v1', 'l1', {
    partName: 'ok', owner_sub: 'mallory', 'evil = 1; DROP TABLE venture_ventures; --': 1,
  });
  const sql = pool.calls[0].sql;
  assert.ok(/SET part_name = \$4/.test(sql), 'the allowlisted column is written');
  assert.ok(!/DROP TABLE/.test(sql), 'an unexpected key never reaches the statement');
  assert.ok(!/SET owner_sub/.test(sql), 'ownership is not a writable field');
});

/* ══ 3. the ledger is append-only ═════════════════════════════════════════ */

test('upsertAssumption SUPERSEDES the prior revision and never rewrites its value', async () => {
  const pool = makePool((sql) => {
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) return { rows: [{ id: 'old-1' }], rowCount: 1 };
    if (/INSERT INTO venture_assumptions/.test(sql)) return { rows: [assumptionRow({ id: 'new-1' })], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const written = await store.upsertAssumption(pool, 'alice', 'v1', {
    key: 'bom.x.unit-cost', domain: 'manufacturing', label: 'X', unit: 'micros',
    valueNum: 2000000, sourceKind: 'user-entered', confidence: 'high',
  }, 'user:alice', null);

  assert.equal(written.supersededId, 'old-1');
  assert.equal(written.assumption.id, 'new-1');
  assert.equal(written.assumption.provenance, 'assumed',
    'a stored assumption is ALWAYS provenance "assumed" — it can never be a computed result');

  const updates = pool.calls.filter((c) => /^\s*UPDATE venture_assumptions/i.test(c.sql));
  assert.equal(updates.length, 2, 'exactly two updates: clear the live flag, then point at the successor');
  for (const u of updates) {
    assert.ok(!/value_num|low_num|high_num|confidence|source_kind/.test(u.sql),
      'NO update may change a stored value — a quote supersedes a guess, it never overwrites it');
    assert.ok(/superseded_by/.test(u.sql));
  }
  assert.equal(pool.calls.filter((c) => /^\s*INSERT INTO venture_assumptions/i.test(c.sql)).length, 1);
  assert.ok(pool.calls.some((c) => c.sql === 'BEGIN') && pool.calls.some((c) => c.sql === 'COMMIT'),
    'the supersede and the insert are one unit of work');
  assert.equal(pool.released, 1, 'the client is always released');
});

test('the live flag is cleared BEFORE the insert — the index forbids two live rows', async () => {
  const order = [];
  const pool = makePool((sql) => {
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) { order.push('supersede'); return { rows: [{ id: 'old' }], rowCount: 1 }; }
    if (/INSERT INTO venture_assumptions/.test(sql)) { order.push('insert'); return { rows: [assumptionRow({ id: 'new' })], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
  await store.upsertAssumption(pool, 'alice', 'v1', {
    key: 'k.a.b', domain: 'finance', label: 'L', unit: 'micros', valueNum: 1,
    sourceKind: 'user-entered', confidence: 'low',
  }, 'user:alice', null);
  assert.deepEqual(order, ['supersede', 'insert'],
    'inserting first would transiently present the partial unique index with two live rows');
});

test('a first write of a key supersedes nothing', async () => {
  const pool = makePool((sql) => {
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO venture_assumptions/.test(sql)) return { rows: [assumptionRow()], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const w = await store.upsertAssumption(pool, 'alice', 'v1', {
    key: 'k.a.b', domain: 'finance', label: 'L', unit: 'micros', valueNum: 1,
    sourceKind: 'user-entered', confidence: 'low',
  }, 'user:alice', null);
  assert.equal(w.supersededId, null);
  assert.equal(pool.calls.filter((c) => /SET superseded_by = \$2/.test(c.sql)).length, 0,
    'there is no successor pointer to write when nothing was superseded');
});

test('a failed ledger write rolls back and still releases the client', async () => {
  const pool = makePool((sql) => {
    if (/INSERT INTO venture_assumptions/.test(sql)) throw new Error('constraint violation');
    if (/UPDATE venture_assumptions/.test(sql)) return { rows: [{ id: 'old' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => store.upsertAssumption(pool, 'alice', 'v1', {
    key: 'k.a.b', domain: 'finance', label: 'L', unit: 'micros', valueNum: 1,
    sourceKind: 'user-entered', confidence: 'low',
  }, 'user:alice', null));
  assert.ok(pool.calls.some((c) => c.sql === 'ROLLBACK'), 'a half-applied supersede must never commit');
  assert.equal(pool.released, 1);
});

/* ══ 4. a received quote is the only way `vendor-quote` enters ════════════ */

test('applyQuote writes a vendor-quote revision, the quote row, and re-points the BOM line', async () => {
  const bomRow = {
    id: 'l1', venture_id: 'v1', owner_sub: 'alice', parent_line_id: null, ref: 'PROJ',
    part_name: 'Projector', spec_text: null, qty_per_unit: '1', uom: 'ea', discrete: true,
    material: null, process: null, make_or_buy: 'buy', unit_cost_micros: '50000000',
    low_micros: '28000000', high_micros: '85000000', scrap_pct: '0', moq: null,
    lead_time_days: null, tooling_cost_micros: '0', tooling_life_units: null, vendor_id: null,
    assumption_key: 'bom.PROJ.unit-cost', hts_code: null, duty_pct: null,
    source_kind: 'model-estimate', confidence: 'low', sort_order: 0,
  };
  const pool = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_vendors/.test(sql)) return { rows: [vendorRow()], rowCount: 1 };
    if (/FROM venture_bom_lines/.test(sql)) return { rows: [bomRow], rowCount: 1 };
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) return { rows: [{ id: 'est-1' }], rowCount: 1 };
    if (/INSERT INTO venture_assumptions/.test(sql)) {
      return { rows: [assumptionRow({ id: 'quote-1', source_kind: 'vendor-quote', confidence: 'high' })], rowCount: 1 };
    }
    if (/INSERT INTO venture_quotes/.test(sql)) {
      return {
        rows: [{
          id: 'q1', venture_id: 'v1', owner_sub: 'alice', vendor_id: 'ven1', bom_line_id: 'l1',
          qty_break: 5000, unit_cost_micros: '41000000', currency: 'USD', tooling_cost_micros: '0',
          reporting_unit_cost_micros: '41000000', reporting_currency: 'USD',
          reporting_tooling_cost_micros: '0', fx_assumption_id: null,
          incoterm: 'FOB', lead_time_days: 60, valid_until: null, document_ref: 'Q-2026-11',
          notes: null, assumption_id: 'quote-1', received_at: new Date(0),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const out = await supply.applyQuote(pool, 'alice', 'v1', {
    vendorId: 'ven1', bomLineId: 'l1', qtyBreak: 5000, unitCostMicros: 41000000,
    incoterm: 'FOB', leadTimeDays: 60, documentRef: 'Q-2026-11',
  });

  assert.equal(out.supersededId, 'est-1', 'the estimate it replaces is superseded, not deleted');
  assert.equal(out.assumption.sourceKind, 'vendor-quote');
  assert.equal(out.quote.assumptionId, 'quote-1', 'the quote row points at the revision it wrote');
  assert.equal(out.quote.reportingUnitCostMicros, 41000000);
  assert.equal(out.quote.fxAssumptionId, null);

  const insert = pool.calls.find((c) => /INSERT INTO venture_assumptions/.test(c.sql));
  assert.ok(insert.params.includes('vendor-quote'),
    'a received quote is the ONE place vendor-quote is written, and a human action put it there');
  assert.ok(insert.params.includes('user:alice'), 'the human who recorded it is the author');

  const lineUpdate = pool.calls.find((c) => /UPDATE venture_bom_lines/.test(c.sql));
  assert.ok(lineUpdate, 'the line now resolves through the quoted assumption');
  assert.ok(/source_kind = 'vendor-quote'/.test(lineUpdate.sql));
  assert.ok(lineUpdate.params.includes(41000000));
  assert.ok(lineUpdate.params.includes('alice'), 'even the follow-up write is owner-scoped');
  assert.ok(pool.calls.some((c) => c.sql === 'BEGIN') && pool.calls.some((c) => c.sql === 'COMMIT'),
    'the assumption, quote and BOM update commit as one unit');
  assert.equal(pool.released, 1);
});

/* ══ 5. bot-authored replacements never delete human work ═════════════════ */

test('an FX assumption insert is immutable and an exact retry is idempotent', async () => {
  const input = {
    sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_085_000_000,
    sourceKind: 'published-source', sourceRef: 'ECB reference rate',
    observedAt: '2026-08-01T00:00:00.000Z', idempotencyKey: 'quote-eur-20260801',
  };
  const insertedPool = makePool((sql) => (/WITH inserted AS/.test(sql)
    ? { rows: [fxRow()], rowCount: 1 } : { rows: [], rowCount: 0 }));
  const inserted = await fxStore.insertFxAssumption(
    insertedPool, 'alice', 'v1', input, 'user:alice',
  );
  assert.equal(inserted.inserted, true);
  assert.ok(Object.isFrozen(inserted.assumption), 'the returned evidence cannot be mutated in memory');
  assert.match(insertedPool.calls[0].sql, /ON CONFLICT \(venture_id, idempotency_key\) DO NOTHING/);
  assert.match(insertedPool.calls[0].sql, /FROM venture_ventures[\s\S]*owner_sub = \$2/,
    'even a superuser-backed insert proves the caller owns the venture');

  const replayPool = makePool(() => ({
    rows: [fxRow({ was_inserted: false })], rowCount: 1,
  }));
  const replay = await fxStore.insertFxAssumption(
    replayPool, 'alice', 'v1', input, 'user:alice',
  );
  assert.equal(replay.inserted, false);
  assert.equal(replay.assumption.id, inserted.assumption.id,
    'an exact retry returns the original immutable row');
  assert.equal(replayPool.calls.filter((c) => /^\s*(UPDATE|DELETE)/i.test(c.sql)).length, 0,
    'idempotency never mutates the original evidence');
});

test('reusing an FX idempotency key for different evidence fails closed', async () => {
  const pool = makePool(() => ({
    rows: [fxRow({ was_inserted: false, rate_nanos: '1090000000' })], rowCount: 1,
  }));
  await assert.rejects(() => fxStore.insertFxAssumption(pool, 'alice', 'v1', {
    sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_085_000_000,
    sourceKind: 'published-source', sourceRef: 'ECB reference rate',
    observedAt: '2026-08-01T00:00:00.000Z', idempotencyKey: 'quote-eur-20260801',
  }, 'user:alice'), { code: 'fx_idempotency_conflict' });
});

test('a concurrent exact FX retry is reread after an invisible ON CONFLICT row', async () => {
  const pool = makePool((sql) => {
    if (/WITH inserted AS/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM venture_fx_assumptions/.test(sql)) {
      return { rows: [fxRow({ was_inserted: undefined })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const result = await fxStore.insertFxAssumption(pool, 'alice', 'v1', {
    sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_085_000_000,
    sourceKind: 'published-source', sourceRef: 'ECB reference rate',
    observedAt: '2026-08-01T00:00:00.000Z', idempotencyKey: 'quote-eur-20260801',
  }, 'user:alice');
  assert.equal(result.inserted, false);
  assert.equal(result.assumption.id, 'fx1');
  assert.equal(pool.calls.length, 2, 'the second statement gets a new READ COMMITTED snapshot');
  assert.match(pool.calls[1].sql, /owner_sub = \$2/);
});

test('a foreign quote uses its immutable FX rate for the assumption and BOM', async () => {
  const bomRow = {
    id: 'l1', venture_id: 'v1', owner_sub: 'alice', parent_line_id: null, ref: 'PROJ',
    part_name: 'Projector', spec_text: null, qty_per_unit: '1', uom: 'ea', discrete: true,
    material: null, process: null, make_or_buy: 'buy', unit_cost_micros: '50000000',
    low_micros: '28000000', high_micros: '85000000', scrap_pct: '0', moq: null,
    lead_time_days: null, tooling_cost_micros: '0', tooling_life_units: null, vendor_id: null,
    assumption_key: 'bom.PROJ.unit-cost', hts_code: null, duty_pct: null,
    source_kind: 'model-estimate', confidence: 'low', sort_order: 0,
  };
  const pool = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_fx_assumptions/.test(sql)) return { rows: [fxRow()], rowCount: 1 };
    if (/FROM venture_vendors/.test(sql)) return { rows: [vendorRow()], rowCount: 1 };
    if (/FROM venture_bom_lines/.test(sql)) return { rows: [bomRow], rowCount: 1 };
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) return { rows: [{ id: 'old' }], rowCount: 1 };
    if (/INSERT INTO venture_assumptions/.test(sql)) {
      return { rows: [assumptionRow({ id: 'new', value_num: '44485000', source_kind: 'vendor-quote' })], rowCount: 1 };
    }
    if (/INSERT INTO venture_quotes/.test(sql)) return {
      rows: [{
        id: 'q-eur', venture_id: 'v1', owner_sub: 'alice', vendor_id: 'ven1', bom_line_id: 'l1',
        qty_break: 5000, unit_cost_micros: '41000000', currency: 'EUR', tooling_cost_micros: '2000000',
        reporting_unit_cost_micros: '44485000', reporting_currency: 'USD',
        reporting_tooling_cost_micros: '2170000', fx_assumption_id: 'fx1', incoterm: 'FOB',
        lead_time_days: 60, valid_until: null, document_ref: 'Q-EUR-1', notes: null,
        assumption_id: 'new', received_at: new Date(0),
      }], rowCount: 1,
    };
    return { rows: [], rowCount: 0 };
  });
  const out = await supply.applyQuote(pool, 'alice', 'v1', {
    vendorId: 'ven1', bomLineId: 'l1', qtyBreak: 5000,
    unitCostMicros: 41_000_000, toolingCostMicros: 2_000_000,
    currency: 'EUR', fxAssumptionId: 'fx1', documentRef: 'Q-EUR-1',
  });
  assert.equal(out.quote.unitCostMicros, 41_000_000, 'the supplier amount remains exact EUR micros');
  assert.equal(out.quote.reportingUnitCostMicros, 44_485_000,
    'EUR 41.000000 x 1.085 = USD 44.485000');
  assert.equal(out.quote.reportingToolingCostMicros, 2_170_000);
  assert.equal(out.quote.fxAssumptionId, 'fx1');
  const assumptionInsert = pool.calls.find((c) => /INSERT INTO venture_assumptions/.test(c.sql));
  assert.ok(assumptionInsert.params.includes(44_485_000),
    'the model ledger receives reporting-currency micros, never the raw foreign number');
  assert.ok(assumptionInsert.params.some((p) => typeof p === 'string' && p.includes('FX fx1 EUR->USD')),
    'the assumption provenance names the immutable FX snapshot');
  const lineUpdate = pool.calls.find((c) => /UPDATE venture_bom_lines/.test(c.sql));
  assert.ok(lineUpdate.params.includes(44_485_000), 'the BOM is re-pointed at the converted amount');
});

test('a foreign quote without matching FX evidence performs no write', async () => {
  const noFxPool = makePool((sql) => (/FROM venture_ventures/.test(sql)
    ? { rows: [ventureRow()], rowCount: 1 } : { rows: [], rowCount: 0 }));
  await assert.rejects(() => supply.applyQuote(noFxPool, 'alice', 'v1', {
    vendorId: 'ven1', unitCostMicros: 41_000_000, currency: 'EUR',
  }), { code: 'fx_assumption_required' });
  assert.equal(noFxPool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);

  const mismatchPool = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_fx_assumptions/.test(sql)) {
      return { rows: [fxRow({ source_currency: 'GBP' })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => supply.applyQuote(mismatchPool, 'alice', 'v1', {
    vendorId: 'ven1', unitCostMicros: 41_000_000, currency: 'EUR', fxAssumptionId: 'fx1',
  }), { code: 'fx_assumption_mismatch' });
  assert.equal(mismatchPool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);
});

test('a quote-row failure rolls back the assumption revision instead of half-applying it', async () => {
  const pool = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_vendors/.test(sql)) return { rows: [vendorRow()], rowCount: 1 };
    if (/UPDATE venture_assumptions SET superseded_by = id/.test(sql)) return { rows: [{ id: 'old' }], rowCount: 1 };
    if (/INSERT INTO venture_assumptions/.test(sql)) return { rows: [assumptionRow({ id: 'new' })], rowCount: 1 };
    if (/INSERT INTO venture_quotes/.test(sql)) throw new Error('quote constraint failed');
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => supply.applyQuote(pool, 'alice', 'v1', {
    vendorId: 'ven1', assumptionKey: 'bom.PROJ.unit-cost', unitCostMicros: 41_000_000,
  }), /quote constraint failed/);
  assert.ok(pool.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some((c) => c.sql === 'COMMIT'));
  assert.equal(pool.released, 1);
});

test('a quote cannot bind another owner\'s vendor or BOM line by UUID', async () => {
  const missingVendor = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => supply.applyQuote(missingVendor, 'alice', 'v1', {
    vendorId: 'foreign-vendor', unitCostMicros: 1_000_000,
  }), { code: 'quote_vendor_not_found' });
  assert.equal(missingVendor.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);

  const missingLine = makePool((sql) => {
    if (/FROM venture_ventures/.test(sql)) return { rows: [ventureRow()], rowCount: 1 };
    if (/FROM venture_vendors/.test(sql)) return { rows: [vendorRow()], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => supply.applyQuote(missingLine, 'alice', 'v1', {
    vendorId: 'ven1', bomLineId: 'foreign-line', unitCostMicros: 1_000_000,
  }), { code: 'quote_bom_line_not_found' });
  assert.equal(missingLine.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);
  for (const call of [...missingVendor.calls, ...missingLine.calls]) {
    if (/venture_(vendors|bom_lines)/.test(call.sql)) {
      assert.match(call.sql, /owner_sub/, 'reference lookup must carry an owner predicate');
      assert.ok(call.params.includes('alice'));
    }
  }
});

test('a BOM re-draft deletes only model-authored lines', async () => {
  const pool = makePool(() => ({ rows: [{ id: 'x' }], rowCount: 2 }));
  await supply.replaceBomFromBot(pool, 'alice', 'v1', [
    { ref: 'A', partName: 'Part A', lowMicros: 1, highMicros: 2 },
  ]);
  const del = pool.calls.find((c) => /DELETE FROM venture_bom_lines/.test(c.sql));
  assert.ok(/source_kind = 'model-estimate'/.test(del.sql),
    'a research re-run must never delete the line somebody phoned a supplier about');
  assert.ok(del.params.includes('alice'));
});

test('a schedule and headcount re-draft delete only model-authored rows', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  await supply.replaceScheduleTasks(pool, 'alice', 'v1', [
    { phase: 'tooling', name: 'Cut tool', durationDays: 45, confidence: 'low' },
  ]);
  await supply.replaceHeadcount(pool, 'alice', 'v1', [
    { role: 'Ops', kind: 'contractor', fte: 0.5, startMonth: 0, baseSalaryMicros: 1, burdenBps: 0, confidence: 'low' },
  ]);
  const deletes = pool.calls.filter((c) => /^\s*DELETE/i.test(c.sql));
  assert.equal(deletes.length, 2);
  for (const d of deletes) {
    assert.ok(/source_kind = 'model-estimate'/.test(d.sql));
    assert.ok(d.params.includes('alice'));
  }
});

/* ══ 6. outputs are immutable, and the version is allocated in one statement ══ */

test('an absent rebaseline policy reads as disabled dry-run without writing a row', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  const policy = await rebaselineStore.getRebaselinePolicy(pool, 'alice', 'v1');
  assert.deepEqual(policy, {
    ventureId: 'v1', enabled: false, dryRun: true, cadence: 'weekly',
    weeklyDay: 1, maxCostMicros: 0, updatedAt: null,
  });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /p\.owner_sub = \$2/);
  assert.deepEqual(pool.calls[0].params, ['v1', 'alice']);
});

test('policy upsert selects through the owned venture and cannot retarget its owner', async () => {
  const row = {
    venture_id: 'v1', owner_sub: 'alice', enabled: true, dry_run: false,
    cadence: 'nightly', weekly_day: 1, max_cost_micros: '25000', updated_at: new Date(0),
  };
  const pool = makePool(() => ({ rows: [row], rowCount: 1 }));
  const stored = await rebaselineStore.upsertRebaselinePolicy(pool, 'alice', {
    ventureId: 'v1', enabled: true, dryRun: false, cadence: 'nightly',
    weeklyDay: 1, maxCostMicros: 25_000, updatedAt: null,
  });
  assert.equal(stored.maxCostMicros, 25_000);
  assert.equal(stored.enabled, true);
  assert.match(pool.calls[0].sql, /FROM venture_ventures v WHERE v\.id = \$1 AND v\.owner_sub = \$2/);
  assert.match(pool.calls[0].sql, /venture_rebaseline_policies\.owner_sub = EXCLUDED\.owner_sub/);
  assert.deepEqual(pool.calls[0].params.slice(0, 2), ['v1', 'alice']);
});

test('scheduled run reservation is owner-bound and one successful insert needs no lookup', async () => {
  const pool = makePool((sql) => (/INSERT INTO venture_runs/.test(sql)
    ? { rows: [{ id: 'r1' }], rowCount: 1 } : { rows: [], rowCount: 0 }));
  const opened = await rebaselineStore.openScheduledRun(pool, 'alice', 'v1',
    'nightly:2026-08-06', 50_000, [
      { name: 'bom', agentId: 'bot', status: 'pending', durationMs: null, error: null },
      { name: 'compute', agentId: null, status: 'pending', durationMs: null, error: null },
    ]);
  assert.deepEqual(opened, { runId: 'r1', inserted: true });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /v\.id = \$1 AND v\.owner_sub = \$2/);
  assert.match(pool.calls[0].sql, /ON CONFLICT \(venture_id, schedule_slot\)/);
  assert.ok(pool.calls[0].params.includes('alice'));
  assert.ok(pool.calls[0].params.includes(50_000));
});

test('a concurrent or retried scheduled slot returns the one existing owner run', async () => {
  const pool = makePool((sql) => {
    if (/INSERT INTO venture_runs/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT id FROM venture_runs/.test(sql)) return { rows: [{ id: 'existing' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const opened = await rebaselineStore.openScheduledRun(pool, 'alice', 'v1',
    'weekly:2026-08-03', 10, []);
  assert.deepEqual(opened, { runId: 'existing', inserted: false });
  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[1].sql, /owner_sub = \$2/);
  assert.deepEqual(pool.calls[1].params, ['v1', 'alice', 'weekly:2026-08-03']);
});

test('scheduled cost evidence updates only the exact owner venture run', async () => {
  const pool = makePool(() => ({ rows: [{ id: 'r1' }], rowCount: 1 }));
  const saved = await rebaselineStore.updateScheduledRunCost(pool, 'alice', 'v1', 'r1', {
    capMicros: 50_000, spentMicros: 12_345, status: 'within-cap',
    callsStarted: 1, callsSettled: 1, callsSkipped: 0,
  });
  assert.equal(saved, true);
  assert.match(pool.calls[0].sql, /id = \$1 AND venture_id = \$2 AND owner_sub = \$3/);
  assert.deepEqual(pool.calls[0].params.slice(0, 4), ['r1', 'v1', 'alice', 'scheduled']);
  assert.ok(pool.calls[0].params.includes(12_345));
  assert.match(pool.calls[0].sql, /\$5 >= cost_spent_micros/,
    'the store cannot rewrite measured spend downward');
  assert.match(pool.calls[0].sql, /cost_status = 'within-cap'.*cost_status = \$6.*\$6 = 'capture-failed'/s,
    'terminal cost states can only stay terminal or fail more conservatively');
});

test('manual run open, progress, and close all bind venture plus owner', async () => {
  const pool = makePool(() => ({ rows: [{ id: 'r1' }], rowCount: 1 }));
  const phases = [{ name: 'compute', agentId: null, status: 'pending', durationMs: null, error: null }];
  assert.equal(await store.openRun(pool, 'alice', 'v1', 'full', phases), 'r1');
  await store.advanceRun(pool, 'alice', 'v1', 'r1', 'compute', phases, 0);
  await store.closeRun(pool, 'alice', 'v1', 'r1', 'done', phases, null);
  assert.equal(pool.calls.length, 3);
  for (const call of pool.calls) {
    assert.match(call.sql, /owner_sub/);
    assert.ok(call.params.includes('alice'));
    assert.ok(call.params.includes('v1'));
  }
  assert.match(pool.calls[1].sql, /WHERE id = \$1 AND venture_id = \$2 AND owner_sub = \$3/);
  assert.match(pool.calls[2].sql, /WHERE id = \$1 AND venture_id = \$2 AND owner_sub = \$3/);
});

test('run reads expose scheduled slot and exact integer cost evidence', async () => {
  const pool = makePool(() => ({ rows: [{
    id: 'r1', venture_id: 'v1', kind: 'rebaseline', status: 'done', phase: null,
    phases: [], bots_requested: 3, bots_completed: 3, trigger_kind: 'scheduled',
    schedule_slot: 'nightly:2026-08-06', cost_cap_micros: '50000',
    cost_spent_micros: '43125', cost_status: 'within-cap', error: null,
    started_at: new Date(0), finished_at: new Date(1),
  }], rowCount: 1 }));
  const runs = await store.listRuns(pool, 'alice', 'v1');
  assert.equal(runs[0].triggerKind, 'scheduled');
  assert.equal(runs[0].scheduleSlot, 'nightly:2026-08-06');
  assert.equal(runs[0].costCapMicros, 50_000);
  assert.equal(runs[0].costSpentMicros, 43_125);
  assert.equal(runs[0].costStatus, 'within-cap');
});

test('scenario prices persist as micros and legacy cents read back exactly', async () => {
  const row = {
    id: 's1', venture_id: 'v1', owner_sub: 'alice', name: 'Sub-cent', overrides: {},
    volume_units: 10, retail_price_cents: null, retail_price_micros: '3400',
    channel_mix: {}, is_base: false, created_at: new Date(0),
  };
  const pool = makePool(() => ({ rows: [row], rowCount: 1 }));
  const scenario = await store.insertScenario(pool, 'alice', 'v1', {
    name: 'Sub-cent', retailPriceMicros: 3400,
  });
  assert.equal(scenario.retailPriceMicros, 3400);
  assert.match(pool.calls[0].sql, /retail_price_micros/);
  assert.doesNotMatch(pool.calls[0].sql, /retail_price_cents/);
  assert.ok(pool.calls[0].params.includes(3400));

  const legacyPool = makePool(() => ({ rows: [{
    ...row, retail_price_micros: null, retail_price_cents: 1234,
  }], rowCount: 1 }));
  const legacy = await store.listScenarios(legacyPool, 'alice', 'v1');
  assert.equal(legacy[0].retailPriceMicros, 12_340_000,
    'legacy cents are expanded exactly once at the compatibility boundary');

  const invalidPool = makePool();
  await assert.rejects(() => store.insertScenario(invalidPool, 'alice', 'v1', {
    name: 'Negative price', retailPriceMicros: -1,
  }), { code: 'invalid_currency_amount' });
  assert.equal(invalidPool.calls.length, 0, 'invalid money is refused before a database round trip');
});

test('a document version is allocated inside the INSERT, never by a prior SELECT', async () => {
  const pool = makePool(() => ({
    rows: [{
      id: 'd1', venture_id: 'v1', owner_sub: 'alice', doc_key: 'funding-ask', version: 4,
      model_id: 'm1', title: 'Funding ask', body_md: '#', sections: [], prose_run_id: null,
      prose_status: 'none', unverified_numbers: [], assumptions_cited: [], estimate_pct: '80',
      created_at: new Date(0),
    }],
    rowCount: 1,
  }));
  const doc = await outputs.insertDocumentVersion(pool, 'alice', 'v1', {
    docKey: 'funding-ask', modelId: 'm1', title: 'Funding ask', bodyMd: '#', sections: [],
  });
  assert.equal(doc.version, 4);
  assert.equal(pool.calls.length, 1,
    'a SELECT MAX(version) followed by an INSERT is a race two regenerations lose');
  assert.ok(/MAX\(version\)/.test(pool.calls[0].sql));
  assert.ok(/INSERT INTO venture_documents/.test(pool.calls[0].sql));
  assert.ok(!/UPDATE venture_documents/.test(pool.calls[0].sql), 'documents are never rewritten');
});

test('hashInputs is order-independent and folds in the engine version', () => {
  const a = outputs.hashInputs('1.0.0', { z: 2, a: 1 });
  const b = outputs.hashInputs('1.0.0', { a: 1, z: 2 });
  assert.equal(a, b, 'two identical assumption sets must hash identically or "stale" means nothing');
  assert.notEqual(a, outputs.hashInputs('1.0.1', { a: 1, z: 2 }),
    'an engine change must invalidate every stored hash — the arithmetic moved');
  assert.notEqual(a, outputs.hashInputs('1.0.0', { a: 1, z: 3 }));
  assert.equal(a.length, 64);
});

/* ══ 7. coverage is generated, never typed ═══════════════════════════════ */

test('coverageOf counts what is actually in the ledger', () => {
  const rows = [
    { sourceKind: 'model-estimate', confidence: 'low' },
    { sourceKind: 'model-estimate', confidence: 'medium' },
    { sourceKind: 'vendor-quote', confidence: 'high' },
    { sourceKind: 'user-entered', confidence: 'medium' },
  ];
  const c = store.coverageOf(rows);
  assert.equal(c.totalAssumptions, 4);
  assert.equal(c.bySourceKind['model-estimate'], 2);
  assert.equal(c.bySourceKind['vendor-quote'], 1);
  assert.equal(c.byConfidence.medium, 2);
  assert.equal(c.estimatePct, 50, '2 of 4 — the headline number is computed, never hand-typed');
  assert.equal(store.coverageOf([]).estimatePct, 0, 'an empty ledger is 0%, never NaN');
});

/* ══ 8. the RLS set can never drift from the owned set ═══════════════════ */

test('every table the DDL creates is in the frozen VENTURE_TABLES list', () => {
  assert.deepEqual([...schema.tablesInSchemaSql()].sort(), [...schema.VENTURE_TABLES].sort(),
    'a table created but not listed would get neither RLS nor a readiness check');
  assert.equal(schema.VENTURE_TABLES.length, 13);
});

test('ensureVentureSchema applies an RLS policy for EVERY owned table', async () => {
  captured.bootstrap.length = 0;
  await schema.ensureVentureSchema(makePool());
  assert.equal(captured.bootstrap.length, 1);
  const opts = captured.bootstrap[0];
  const text = opts.statements.join('\n');
  for (const table of schema.VENTURE_TABLES) {
    assert.ok(text.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`), `${table} has RLS enabled`);
    assert.ok(text.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`), `${table} FORCEs RLS`);
    assert.ok(text.includes(`${table}_owner_or_operator`), `${table} has the owner-or-operator policy`);
  }
  assert.deepEqual(opts.requirements.map((r) => r.table).sort(), [...schema.VENTURE_TABLES].sort());
  for (const r of opts.requirements) assert.deepEqual(r.columns, ['owner_sub']);
});

/* ══ 9. the migration files and the runtime schema agree ════════════════ */

test('the migrations create exactly the same tables, each with FORCEd RLS', () => {
  const dir = path.join(PKG, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files, [
    '001-venture-core.sql', '002-venture-supply-chain.sql',
    '003-venture-outputs.sql', '004-venture-fx.sql', '005-venture-rebaseline.sql',
  ]);
  const sql = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, [...schema.VENTURE_TABLES].sort(),
    'a box installed from migrations and a box self-healed at boot must have the same schema');
  for (const table of schema.VENTURE_TABLES) {
    assert.ok(sql.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`), `${table} FORCEs RLS in the migration too`);
  }
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS venture_assumptions_live_idx[\s\S]*WHERE superseded_by IS NULL/.test(sql),
    'the live-row partial unique index is what makes "one live value per key" a database guarantee');
  assert.match(sql, /CREATE TRIGGER venture_fx_assumptions_immutable[\s\S]*BEFORE UPDATE OR DELETE/,
    'the database rejects in-place FX evidence changes, not only the API');
  assert.match(sql, /CREATE TRIGGER venture_fx_assumptions_validate_owner[\s\S]*BEFORE INSERT/,
    'an FX row cannot attach its owner_sub to another owner\'s venture');
  assert.match(sql, /FX reporting currency does not match its owned venture/,
    'an FX row cannot invent a reporting currency different from its venture');
  assert.match(sql, /CREATE TRIGGER venture_quotes_validate_fx[\s\S]*BEFORE INSERT OR UPDATE/,
    'the database rechecks currency pairing and converted amounts on every quote write');
  assert.match(sql, /quote vendor is missing or owned by another account/,
    'the database rejects cross-owner vendor references even when a UUID is known');
  assert.match(sql, /venture_scenarios_retail_price_micros_ck[\s\S]*BETWEEN 0 AND 9007199254740000/,
    'the database keeps scenario price micros non-negative and exactly representable');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS retail_price_micros BIGINT/,
    'the last scenario cents field has an exact micro-currency migration');
  assert.match(sql, /venture_rebaseline_policy_paid_ck[\s\S]*NOT enabled OR dry_run OR max_cost_micros > 0/,
    'a paid policy cannot exist without a positive integer-micro cap');
  assert.match(sql, /venture_runs_schedule_slot_uq[\s\S]*WHERE schedule_slot IS NOT NULL/,
    'venture/date retries converge at a database partial unique index');
  assert.match(sql, /CREATE TRIGGER venture_rebaseline_policy_validate_owner[\s\S]*BEFORE INSERT OR UPDATE/,
    'policy ownership is checked by PostgreSQL as well as the store');
  assert.match(sql, /CREATE TRIGGER venture_runs_validate_owner[\s\S]*BEFORE INSERT OR UPDATE/,
    'run ownership is checked by PostgreSQL as well as the store');
  assert.match(sql, /cost_spent_micros BETWEEN 0 AND 9007199254740000/,
    'scheduled run evidence remains exactly representable in JavaScript');
  assert.match(sql, /CREATE TRIGGER venture_runs_validate_cost_transition[\s\S]*BEFORE UPDATE OF trigger_kind/,
    'the database makes each run slot and authorization immutable after reservation');
  assert.match(sql, /run measured cost cannot decrease/,
    'the database rejects rewriting measured spend downward');
});
