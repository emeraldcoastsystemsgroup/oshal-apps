/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Home summary contract over the COMPILED route (routes/home-summary.js), loaded the way the store Home harness loads it — an express-only require — so the module provably stays import-free. Covers the authenticated-session gate, owner-scoped read-only queries, the ADR-145 core caps (4 tiles, 5 items, label 24, value 16, text 120, detail 400), honest Unavailable/503 degradation, and prepare-* actions that exist in the manifest.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Four queries: the owner's campaigns are counted (not archived, with the active/draft/paused split and the five newest names) in a `campaigns` metric that rides in `metrics` only, beside the four unchanged tiles; a failed campaign read is Unavailable, never zero.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Five queries: the newest campaign names are a plain fifth SELECT, and no query uses array_to_string or array_agg, which the native kernel's package SQL refuses (the campaigns metric read Unavailable live).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Seven queries (sweep 11): the concierge invented draft times for every campaign beyond the three newest drafts the summary listed. Each of the six most recently updated campaigns is a metric with its real draft count and newest draft time or "No drafts", the rest are one "Other campaigns" metric, and a failed draft read says Unavailable rather than "No drafts". The persona never states a time or count the summary or screen does not give.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 12: the concierge said "No drafts" for campaigns past the six listed and "4 other campaigns not listed" with all ten on the Board. Every campaign carries its status, draft count and newest draft time, packed into the seven rows the concierge keeps; only campaigns past them are counted as not in this summary.
 *
 * Dependency-free `node --test` (store-CI contract): no DB, no express install, no network. Why:
 * Home shows every app's summary side by side, so a count invented on failure, a line core has to
 * clip mid-sentence, or an action pointing at an undeclared integration is visible to the owner
 * on the first screen they see — and a summary that reads without a live session leaks it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 13: each newest-draft time is a full RFC 3339 instant with seconds, the form the kernel
 *   writes in the person's zone ("2026-10-12T03:55Z" stayed UTC and the concierge converted it wrongly); the persona says an unlisted
 *   campaign exists only when the summary's not-in-this-summary row says so, and never converts a time itself.
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

/** A query stub answering each of the five statements in order. */
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
  assert.equal(HOME_SUMMARY_QUERIES.length, 7);
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
  assert.equal(seen.length, 7);
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
  assert.deepEqual(res.body.metrics.slice(0, 4), res.body.tiles);
  assert.equal(res.body.metrics.length, 5, 'the campaigns metric rides in metrics only');
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

test('the owner\'s campaigns are counted with their split and newest names, in metrics only', async () => {
  const campaigns = [{ live: '3', active: '1', draft: '2', paused: '0' }];
  const names = [{ name: 'Spring launch' }, { name: 'Student budget' }];
  const res = await loadRoute(answering([{ drafts: '2', approved: '1' }], [{ day: '0', five: '3' }], [contentRow()], campaigns, names)).call();
  assert.equal(res.statusCode, 200);
  const metric = res.body.metrics.find((m) => m.id === 'campaigns');
  assert.deepEqual({ ...metric }, { id: 'campaigns', label: 'Campaigns (not archived)', value: '3', detail: '1 active, 2 draft, 0 paused; newest: Spring launch | Student budget' });
  assert.ok(metric.label.length <= HOME_SUMMARY_LIMITS.labelChars);
  assert.ok(!res.body.tiles.some((tile) => tile.id === 'campaigns'), 'the four tiles are unchanged');
  assert.match(HOME_SUMMARY_QUERIES[3], /^SELECT .* FROM oshal_marketing_campaigns WHERE user_sub = \$1 AND created_at <= \$2$/);
  assert.match(HOME_SUMMARY_QUERIES[4], /^SELECT name FROM oshal_marketing_campaigns WHERE user_sub = \$1 AND created_at <= \$2 .* LIMIT 5$/);
  for (const query of HOME_SUMMARY_QUERIES) assert.doesNotMatch(query, /array_to_string|array_agg/, 'the native package SQL refuses array functions');
});

test('a failed campaign read is Unavailable and partial, never zero campaigns', async () => {
  const res = await loadRoute(answering([{ drafts: '0', approved: '0' }], [{ day: '0', five: '0' }], [], new Error('PRIVATE'), [])).call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.partial, true);
  assert.equal(res.body.metrics.find((m) => m.id === 'campaigns').value, 'Unavailable');
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
});

test('each campaign carries its real draft count and newest saved time, or none (sweep 11, sweep 12)', async () => {
  const campaigns = [{ live: '0', active: '0', draft: '0', paused: '0', total: '10' }];
  const names = ['sweep11', 'sweep10', 'sweep9', 'sweep8', 'sweep7', 'sweep6', 'sweep5', 'sweep3', 'sweep2', 'sweep-campaign'];
  const recent = names.map((name, i) => ({ campaign_id: `c${i}`, name: `${name}-campaign`.replace('-campaign-campaign', '-campaign'), status: 'archived' }));
  const drafts = [
    { campaign_id: 'c0', updated_at: '2026-10-13T03:12:23.135Z' },
    { campaign_id: 'c3', updated_at: '2026-10-12T16:53:40.466Z' },
    { campaign_id: 'c3', updated_at: '2026-10-11T09:00:00.000Z' },
    { campaign_id: 'c6', updated_at: '2026-10-11T08:00:00.000Z' },
    { campaign_id: 'c7', updated_at: '2026-10-11T07:00:00.000Z' },
    { campaign_id: 'c8', updated_at: '2026-10-11T06:00:00.000Z' },
  ];
  const res = await loadRoute(answering([{ drafts: '6', approved: '0' }], [{ day: '0', five: '0' }], [], campaigns, [], recent, drafts)).call();
  const rows = res.body.metrics.filter((m) => m.id.startsWith('campaign-drafts'));
  const said = rows.map((m) => `${m.value}; ${m.detail || ''}`).join('; ');
  for (const [name, fact] of [['sweep11-campaign', '1 draft, newest saved 2026-10-13T03:12:00Z'], ['sweep10-campaign', 'no drafts'],
    ['sweep8-campaign', '2 drafts, newest saved 2026-10-12T16:53:00Z'], ['sweep5-campaign', '1 draft, newest saved 2026-10-11T08:00:00Z'],
    ['sweep3-campaign', '1 draft, newest saved 2026-10-11T07:00:00Z'], ['sweep2-campaign', '1 draft, newest saved 2026-10-11T06:00:00Z'],
    ['sweep-campaign', 'no drafts']]) {
    assert.ok(said.includes(`${name} (archived): ${fact}`), `${name}: ${fact} in ${said}`);
  }
  assert.ok(!rows.some((m) => m.id === 'campaign-drafts-unlisted'), 'all ten fit: none is called not listed');
  assert.ok(rows.length <= 7 && res.body.metrics.length <= 12, 'the concierge keeps twelve metric rows');
  for (const m of rows) {
    assert.ok(m.value.length <= 120 && (m.detail || '').length <= 120, 'within what the concierge keeps');
    assert.equal(m.defaultVisible, false, 'concierge rows stay off the Home card unless chosen');
  }
  assert.equal(res.body.tiles.length, 4, 'the Home tiles are unchanged');
  assert.match(HOME_SUMMARY_QUERIES[5], /^SELECT campaign_id, name, status FROM oshal_marketing_campaigns WHERE user_sub = \$1 AND created_at <= \$2 ORDER BY updated_at DESC, campaign_id LIMIT 40$/);
  assert.match(HOME_SUMMARY_QUERIES[6], /c\.status = 'draft'.*p\.user_sub = \$1/);
  for (const query of HOME_SUMMARY_QUERIES.slice(5)) assert.doesNotMatch(query, /GROUP BY|max\(|array_/i, 'plain rows only');
});

test('campaigns past what the rows hold are counted as not in this summary, and no entry is cut (sweep 12)', async () => {
  const recent = Array.from({ length: 40 }, (_, i) => ({ campaign_id: `c${i}`, name: `A campaign with a long name number ${i}`, status: 'active' }));
  const res = await loadRoute(answering([{ drafts: '0', approved: '0' }], [{ day: '0', five: '0' }], [], [{ live: '45', active: '45', draft: '0', paused: '0', total: '45' }], [], recent, [])).call();
  const rows = res.body.metrics.filter((m) => m.id.startsWith('campaign-drafts'));
  const packed = rows.filter((m) => m.id !== 'campaign-drafts-unlisted');
  const listed = packed.flatMap((m) => [m.value, m.detail].filter(Boolean).flatMap((text) => text.split('; ')));
  assert.ok(listed.every((entry) => /^A campaign with a long name number \d+ \(active\): no drafts$/.test(entry)), listed.join(' | '));
  const last = Number(/to (\d+) \(newest first\)$/.exec(packed.at(-1).label)[1]);
  assert.equal(listed.length, last, 'every listed campaign is named in its row');
  const unlisted = rows.find((m) => m.id === 'campaign-drafts-unlisted');
  assert.equal(unlisted.value, String(45 - last));
  assert.ok(rows.length <= 7);
});

test('a failed draft read says Unavailable for each campaign, never "No drafts" (sweep 11)', async () => {
  const recent = [{ campaign_id: 'c0', name: 'Spring launch', status: 'active' }];
  const res = await loadRoute(answering([{ drafts: '0', approved: '0' }], [{ day: '0', five: '0' }], [], [{ live: '1', active: '1', draft: '0', paused: '0', total: '1' }], [], recent, new Error('PRIVATE'))).call();
  const row = res.body.metrics.find((m) => m.id === 'campaign-drafts-1');
  assert.equal(row.value, 'Spring launch (active): drafts could not be read');
  assert.doesNotMatch(JSON.stringify(res.body.metrics), /no drafts/i);
  assert.equal(res.body.partial, true);
  assert.ok(!res.body.metrics.some((m) => m.id === 'campaign-drafts-unlisted'));
});

test('the concierge persona states only draft times and counts the summary or screen gives (sweep 11)', () => {
  const persona = readFileSync(join(packageDir, 'personas', 'campaign-director.yaml'), 'utf8');
  assert.match(persona, /never extend\s+a time, a date or a count from the campaigns it lists to ones it does not/);
  assert.match(persona, /say it is not shown here/);
  assert.match(persona, /"name \(status\): N drafts, newest saved <time>" or "name \(status\): no drafts"/, 'the persona reads the entry shape the summary writes');
  assert.match(persona, /never call them not on the screen/);
});

test('each newest-draft time is an RFC 3339 instant the kernel can put in the person\'s zone (sweep 13)', async () => {
  const recent = [{ campaign_id: 'c0', name: 'sweep6-campaign', status: 'active' }];
  const drafts = [{ campaign_id: 'c0', updated_at: '2026-10-12T03:55:41.000Z' }];
  const res = await loadRoute(answering([{ drafts: '1', approved: '0' }], [{ day: '0', five: '0' }], [], [{ live: '1', active: '1', draft: '0', paused: '0', total: '1' }], [], recent, drafts)).call();
  const row = res.body.metrics.find((m) => m.id === 'campaign-drafts-1');
  const stamp = /newest saved (\S+)$/.exec(row.value)[1];
  assert.equal(stamp, '2026-10-12T03:55:00Z');
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, 'RFC 3339 needs the seconds');
  const persona = readFileSync(join(packageDir, 'personas', 'campaign-director.yaml'), 'utf8').replace(/\s+/g, ' ');
  assert.match(persona, /Without an "Older campaigns not in this summary" row the summary lists every campaign, archived ones included: never say others exist/);
  assert.match(persona, /Quote a time exactly as the summary writes it; never convert it to another zone yourself/);
});
