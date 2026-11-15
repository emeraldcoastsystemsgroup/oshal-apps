/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance as a "Send to..." target. The manifest's accept points at the mounted endpoint inside Finance's own address space, acts by post, and lists only the kinds the endpoint can read on the native kernel (text, CSV, OFX, QFX; not PDF, which a package's server cannot turn into text there). On a disposable PostgreSQL through the compiled route: a handed-over statement becomes a preview and a document record that keeps the file's name and fingerprint but not its text, with one line for the sender to show; no transaction or account is written until the person applies it; the preview then applies like any other; a reference the caller does not own, a malformed one, a PDF, a file that is not text and a CSV whose columns are unknown are each refused in words with nothing written; a bill is answered as a proposal. The relay is the kernel's and is doubled here by one that answers a reference only to the person who owns it; the real relay is proven in the kernel (crates/host-process/bridge/artifact_exchange.test.js). Synthetic files only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-artifact-import.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, TOOLCHAIN, database, ledgerRoutes, call, statement, assertFigures } = require('./ledger.fixture.cjs');

const ref = (n) => 'art_' + String(n).repeat(64).slice(0, 64);
const count = async (pool, table) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test('the manifest offers "File in Finance" for the kinds the endpoint can read, at the mounted endpoint', () => {
  const manifest = require(path.join(TOOLCHAIN, 'js-yaml')).load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const accept = manifest.artifacts.accepts[0];
  assert.deepEqual([accept.id, accept.label, accept.mode, accept.endpoint], ['statement', 'File in Finance', 'post', '/api/finance/ledger/imports/artifact']);
  const mount = manifest.routes.find((route) => route.module === 'routes/finance-ledger.js');
  assert.deepEqual([mount.mountPath, mount.factory, mount.auth, mount.requiresAuth], ['/api/finance/ledger', 'createFinanceLedgerRoutes', 'oidc', true]);
  assert.ok(accept.endpoint.startsWith(mount.mountPath + '/'));
  assert.ok(manifest.routes.findIndex((route) => route.mountPath === '/api/finance/ledger') < manifest.routes.findIndex((route) => route.mountPath === '/api/finance'), 'the ledger mount is matched before the application mount');
  assert.ok(accept.types.includes('text/*') && accept.types.includes('application/x-ofx') && accept.types.includes('application/vnd.intu.qfx'));
  assert.equal(accept.types.some((type) => /pdf|\*\/\*/.test(type)), false, 'no kind is offered that the endpoint would refuse');
});

test('a handed-over statement becomes a preview and a document record; nothing joins the records until it is applied', async (t) => {
  const pool = await database(t);
  const artifacts = { [ref(1)]: { owner: 'alice', name: 'october.ofx', type: 'application/x-ofx', text: statement('harbor-checking.ofx') } };
  const routes = ledgerRoutes(pool, { artifacts });
  const sent = await call(routes['POST /imports/artifact'], 'alice', { body: { ref: ref(1) } });
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.body.ok, sent.body.message, sent.body.counts.toAdd, sent.body.account.last4], [true, 'Read october.ofx: 4 transactions ready to add in Finance.', 4, '4821']);
  assertFigures(sent.body);
  assert.deepEqual([await count(pool, 'finance_transactions'), await count(pool, 'finance_accounts')], [0, 0]);
  const doc = (await pool.query('SELECT * FROM finance_documents')).rows[0];
  assert.deepEqual([doc.user_sub, doc.kind, doc.title, doc.origin, doc.body_text, doc.produced.importId, doc.fingerprint.length], ['alice', 'statement', 'october.ofx', 'send-to', '', sent.body.importId, 64], 'the statement\'s text is not kept');
  assert.equal((await pool.query('SELECT doc_id FROM finance_imports')).rows[0].doc_id, sent.body.docId);

  const opened = await call(routes['GET /imports/:id'], 'alice', { params: { id: sent.body.importId } });
  assert.deepEqual([opened.body.state, opened.body.rows.length, opened.body.rows[0].status], ['previewed', 4, 'new'], 'the sheet opened on it reads its lines again');
  assertFigures(opened.body);
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: sent.body.importId }, body: { confirm: true } });
  assert.deepEqual([applied.body.state, applied.body.added], ['applied', 4]);
});

test('what Finance cannot take is refused in words and writes nothing', async (t) => {
  const pool = await database(t);
  const artifacts = {
    [ref(1)]: { owner: 'alice', name: 'october.ofx', type: 'application/x-ofx', text: statement('harbor-checking.ofx') },
    [ref(2)]: { owner: 'alice', name: 'october.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj\n') },
    [ref(3)]: { owner: 'alice', name: 'book.xls', type: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]) },
    [ref(4)]: { owner: 'alice', name: 'export.csv', type: 'text/csv', text: statement('unnamed-columns.csv') },
    [ref(5)]: { owner: 'alice', name: 'notes.txt', type: 'text/plain', text: 'Thank you for banking with us.' },
  };
  const routes = ledgerRoutes(pool, { artifacts });
  const refused = async (sub, value) => { const res = await call(routes['POST /imports/artifact'], sub, { body: { ref: value } }); return [res.statusCode, res.body.error, res.body.message]; };
  assert.deepEqual(await refused('bob', ref(1)), [404, 'artifact_unavailable', 'Finance could not fetch that file. Use Send to again.'], 'a reference is answered only to the person who owns it');
  assert.deepEqual(await refused('alice', 'not-a-ref'), [400, 'ref_required', 'A valid artifact reference is required.']);
  assert.deepEqual(await refused('alice', ref(2)), [415, 'pdf_needs_text', 'Finance reads a PDF from its own Add an account sheet, where the PDF is turned into text first. Open Finance, choose Add an account and pick the file there.']);
  assert.deepEqual(await refused('alice', ref(3)), [415, 'not_text', 'This file is not text. Save the statement as CSV, OFX or QFX and send that file.']);
  assert.deepEqual((await refused('alice', ref(4))).slice(0, 2), [422, 'needs_columns']);
  assert.deepEqual(await refused('alice', ref(5)), [422, 'no_transactions', 'Finance found no line in this text that starts with a date and ends in an amount.']);
  assert.equal((await call(routes['POST /imports/artifact'], null, { body: { ref: ref(1) } })).statusCode, 401);
  for (const table of ['finance_transactions', 'finance_accounts', 'finance_imports', 'finance_documents']) assert.equal(await count(pool, table), 0, `${table} is untouched`);
});

test('a handed-over bill is answered as a proposal with its document', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool, { artifacts: { [ref(6)]: { owner: 'alice', name: 'utilities.txt', type: 'text/plain', text: statement('city-utilities-bill.txt') } } });
  const sent = await call(routes['POST /imports/artifact'], 'alice', { body: { ref: ref(6) } });
  assert.deepEqual([sent.statusCode, sent.body.kind, sent.body.message, sent.body.bill.amountDue.cents, sent.body.bill.dueDate], [200, 'bill', 'Read utilities.txt: a bill from City Utilities is waiting in Finance.', 11240, '2026-11-21']);
  assert.deepEqual([await count(pool, 'finance_documents'), await count(pool, 'finance_transactions'), await count(pool, 'finance_imports')], [1, 0, 0]);
});
