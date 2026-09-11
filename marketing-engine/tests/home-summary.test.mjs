/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Home summary contract over the COMPILED route (routes/home-summary.js), loaded the way the store Home harness loads it — an express-only require — so the module provably stays import-free. Covers the authenticated-session gate, owner-scoped read-only queries, the ADR-145 core caps (4 tiles, 5 items, label 24, value 16, text 120, detail 400), honest Unavailable/503 degradation, and prepare-* actions that exist in the manifest.
 *
 * Dependency-free `node --test` (store-CI contract): no DB, no express install, no network. Why:
 * Home shows every app's summary side by side, so a count invented on failure, a line core has to
 * clip mid-sentence, or an action pointing at an undeclared integration is visible to the owner
 * on the first screen they see — and a summary that reads without a live session leaks it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-09-11T12:00:00.000Z');
const ALICE = { user: { sub: 'alice' }, isAuthenticated: () => true };

/** Load the compiled route with an express-only require; returns its exports and GET handler. */
function loadRoute(query) {
  let handler;
  const module = { exports: {} };
  const source = readFileSync(join(packageDir, 'routes', 'home-summary.js'), 'utf8');
  const stubRequire = (name) => {
    assert.equal(name, 'express', `home-summary must stay import-free; it required ${name}`);
    return { Router: () => ({ get: (_path, fn) => { handler = fn; } }) };
  };
  new Function('require', 'module', 'exports', source)(stubRequire, module, module.exports);
  module.exports.createHomeSummaryRoutes({ pool: { query } });
  const call = async (oidc = ALICE) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; } };
    await handler({ oidc, query: { user_sub: 'mallory' } }, res);
    return res;
  };
  return { exports: module.exports, call };
}

const { exports: summary } = loadRoute(() => assert.fail('no query at load time'));
const { buildMarketingHomeSummary, HOME_SUMMARY_QUERIES, HOME_SUMMARY_LIMITS, CONTENT_ITEM_ACTIONS, clip, isoDate } = summary;

/** A saved content row, overridable per case. */
function contentRow(overrides = {}) {
  return { title: 'Launch post', body: 'Body text', channel: 'linkedin', status: 'draft', updated_at: '2026-09-10T08:00:00.000Z', ...overrides };
}

/** A query stub answering each of the three statements in order. */
function answering(...answers) {
  let n = 0;
  return async () => { const answer = answers[n++]; if (answer instanceof Error) throw answer; return { rows: answer }; };
}

/** Assert every tile and item honours the core Home caps. */
function assertWithinCaps(body) {
  assert.ok(body.tiles.length <= HOME_SUMMARY_LIMITS.tiles);
  assert.ok(body.items.length <= HOME_SUMMARY_LIMITS.items);
  for (const tile of body.tiles) {
    assert.ok(tile.label.length <= HOME_SUMMARY_LIMITS.labelChars, `label too long: ${tile.label}`);
    assert.ok(tile.value.length <= HOME_SUMMARY_LIMITS.valueChars, `value too long: ${tile.value}`);
  }
  for (const item of body.items) {
    assert.ok(item.text.length <= HOME_SUMMARY_LIMITS.textChars, `text over cap: ${item.text}`);
    if (item.detail !== undefined) assert.ok(item.detail.length <= HOME_SUMMARY_LIMITS.detailChars);
  }
}

test('the compiled route loads with only express and exports its contract surface', () => {
  for (const name of ['createHomeSummaryRoutes', 'buildMarketingHomeSummary', 'clip', 'isoDate']) assert.equal(typeof summary[name], 'function', name);
  assert.equal(HOME_SUMMARY_QUERIES.length, 3);
  assert.deepEqual({ ...HOME_SUMMARY_LIMITS }, { tiles: 4, items: 5, labelChars: 24, valueChars: 16, textChars: 120, detailChars: 400, notesChars: 2000, bodyChars: 1500 });
});

test('an unauthenticated or unconfirmed session is refused before any read', async () => {
  const { call } = loadRoute(() => assert.fail('read before authentication'));
  for (const oidc of [null, { user: { sub: 'alice' } }, { user: { sub: 'alice' }, isAuthenticated: () => false }, { user: {}, isAuthenticated: () => true }]) {
    const res = await call(oidc);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('every read is an owner-scoped, time-bounded SELECT for the session subject only', async () => {
  const seen = [];
  const res = await loadRoute(async (config) => { seen.push(config); return { rows: [] }; }).call();
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 3);
  for (const config of seen) {
    assert.match(config.text, /^SELECT /);
    assert.match(config.text, /user_sub = \$1/);
    assert.doesNotMatch(config.text, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT)\b/i);
    assert.equal(config.values[0], 'alice', 'the session subject, never a query-string user');
    assert.ok(config.values[1] instanceof Date);
    assert.equal(config.query_timeout, 1800);
  }
  for (const config of seen.filter((c) => c.text.includes('oshal_marketing_content'))) {
    assert.match(config.text, /p\.user_sub = \$1/, 'a campaign-linked row must belong to a campaign the caller owns');
  }
});

test('all queries succeeding yields 200 with real counts, content items, and the footnote', async () => {
  const res = await loadRoute(answering([{ drafts: '2', approved: '1' }], [{ day: '0', five: '3' }], [contentRow()])).call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.partial, false);
  assert.deepEqual(res.body.tiles.map((tile) => tile.value), ['2', '1', '0', '3']);
  assert.deepEqual(res.body.metrics, res.body.tiles);
  assert.equal(res.body.items[0].text, 'Launch post');
  assert.equal(res.body.items.at(-1).text, 'Counts come from saved content and recorded publish outcomes.');
  assertWithinCaps(res.body);
});

test('the footnote fits the text cap whole — core never has to clip it mid-sentence', () => {
  const footnote = buildMarketingHomeSummary([[], [], []], NOW).body.items.at(-1);
  assert.ok(footnote.text.length <= HOME_SUMMARY_LIMITS.textChars);
  assert.ok(footnote.text.endsWith('.'));
  assert.ok(footnote.detail.length <= HOME_SUMMARY_LIMITS.detailChars);
  assert.match(footnote.detail, /destination consent and publishing controls still apply\.$/);
});

test('an owner with no saved work sees zero counts and an empty-state line, never a warning', () => {
  const { status, body } = buildMarketingHomeSummary([[{ drafts: '0', approved: '0' }], [{ day: '0', five: '0' }], []], NOW);
  assert.equal(status, 200);
  assert.deepEqual(body.tiles.map((tile) => tile.value), ['0', '0', '0', '0']);
  assert.equal(body.items[0].text, 'No saved work yet. Open the app to begin.');
  assert.ok(body.items.every((item) => item.tone !== 'warn'));
});

test('a failed query reads Unavailable — never a guessed zero — and marks the summary partial', async () => {
  const res = await loadRoute(answering([{ drafts: '4', approved: '2' }], new Error('PRIVATE'), [contentRow()])).call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.partial, true);
  assert.deepEqual(res.body.tiles.map((tile) => tile.value), ['4', '2', 'Unavailable', 'Unavailable']);
  assert.ok(res.body.items.some((item) => item.tone === 'warn' && item.text === 'Some saved sources cannot be checked.'));
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE'), 'a database error never reaches the response');
});

test('every query failing answers 503 so Home shows the app unavailable, not empty', async () => {
  const res = await loadRoute(async () => { throw new Error('PRIVATE'); }).call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.partial, true);
  assert.ok(res.body.tiles.every((tile) => tile.value === 'Unavailable'));
  assert.ok(!res.body.items.some((item) => item.text.startsWith('No saved work')));
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
});

test('item count stays within the cap even with extra rows and a failure', () => {
  const rows = Array.from({ length: 7 }, (_, index) => contentRow({ title: `Item ${index}` }));
  const { body } = buildMarketingHomeSummary([null, [{ day: '1', five: '1' }], rows], NOW);
  assert.equal(body.items.filter((item) => item.actions).length, 3);
  assert.equal(body.items.length, HOME_SUMMARY_LIMITS.items);
  assertWithinCaps(body);
});

test('oversized and missing row fields are bounded or named honestly', () => {
  const long = contentRow({ title: 'T'.repeat(500), body: 'B '.repeat(4000), channel: 'x'.repeat(500), updated_at: 'not a date' });
  const [item] = buildMarketingHomeSummary([[], [], [long]], NOW).body.items;
  assert.equal(item.text.length, HOME_SUMMARY_LIMITS.textChars);
  assert.match(item.detail, /saved date unavailable$/);
  for (const action of item.actions) assert.ok(action.context.notes.length <= HOME_SUMMARY_LIMITS.notesChars);
  const [untitled] = buildMarketingHomeSummary([[], [], [contentRow({ title: '' })]], NOW).body.items;
  assert.equal(untitled.text, 'Untitled content');
  assert.equal(clip('  a \n\t b  ', 10), 'a b');
  assert.equal(isoDate('2026-09-10T08:00:00Z'), '2026-09-10T08:00:00.000Z');
});

test('every content action hands off to an integration the manifest actually offers', () => {
  const manifest = readFileSync(join(packageDir, 'oshal-app.yaml'), 'utf8');
  const offers = manifest.slice(manifest.indexOf('  offers:'));
  for (const integration of CONTENT_ITEM_ACTIONS) assert.match(offers, new RegExp(`- id: ${integration}\\r?\\n`), integration);
  const [item] = buildMarketingHomeSummary([[], [], [contentRow()]], NOW).body.items;
  assert.deepEqual(item.actions.map((action) => action.integration), [...CONTENT_ITEM_ACTIONS]);
  assert.ok(item.actions.every((action) => action.context.title === item.text));
});
