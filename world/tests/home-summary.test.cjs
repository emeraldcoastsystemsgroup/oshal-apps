const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function request(snapshot) {
  let handler, calls = 0;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(__dirname, '../routes/home-summary.js'), 'utf8'))(name => {
    if (name === 'express') return { Router: () => ({ get: (_path, fn) => { handler = fn; } }) };
    if (name === '@/features/world-data') return {
      DEFAULT_WORLD_TOPICS: ['technology', 'artificial-intelligence', 'world-news', 'healthcare', 'us-economy'].map(id => ({ entity: 'world:topic:' + id })),
      createWorldIntelligenceService: () => snapshot === false ? null : { coverageSnapshot: async subjects => {
        assert.ok(subjects.includes('world:topic:technology')); calls++; return snapshot;
      } },
    };
    throw Error('Unexpected dependency: ' + name);
  }, module, module.exports);
  module.exports.createHomeSummaryRoutes();
  return async (authenticated = true) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ oidc: { isAuthenticated: () => authenticated, user: { sub: 'viewer' } } }, res);
    return { ...res, calls };
  };
}
test('World Home rejects anonymous requests before reading the shared archive', async () => {
  const response = await request({})(false);
  assert.equal(response.code, 401); assert.equal(response.calls, 0);
});
test('World Home unavailable is not zero', async () => {
  assert.equal((await request(false)()).code, 503);
  const res = await request({ at: '2026-09-10T00:00:00Z', coverage: null, articles: null, events: null })();
  assert.equal(res.code, 503); assert.equal(res.body.metrics[0].value, 'Unavailable');
});
test('World Home deduplicates source articles across subjects and creates only review context', async () => {
  const get = request({ at: '2026-09-10T00:00:00Z', coverage: { fetched: '20000', pulls: '900', new_subject_items: '4000', subjects: '30' }, events: [], articles: [
    { title: '<b>Research finding</b>', entity: 'world:topic:artificial-intelligence', pub_date: '2026-09-09T12:00:00Z', link: 'https://news.example/story?utm_source=feed', outlet: 'News' },
    { title: 'Same finding', entity: 'world:topic:technology', pub_date: '2026-09-09T12:00:00Z', link: 'https://news.example/story' },
    { title: 'Second finding', entity: 'world:topic:healthcare', pub_date: '2026-09-09T12:00:00Z', link: 'javascript:alert(1)' },
  ] });
  for (let i = 0; i < 2; i++) {
    const res = await get(); assert.equal(res.code, 200);
    assert.equal(res.body.metrics[0].value, '20000');
    assert.equal(res.body.items.filter(i => i.integration).length, 1);
    assert.equal(res.body.items[0].text, 'Research finding');
    assert.equal(res.body.items[0].integration, 'explore-venture');
    assert.deepEqual(res.body.items[0].actions.map(a=>a.integration), ['prepare-document','explore-venture','prepare-campaign','review-sales']);
    assert.equal(res.body.items[1].sourceUrl, undefined);
    assert.equal(res.body.items[0].highlight, undefined);
    assert.match(res.body.items.at(-1).detail, /not distinct events/);
  }
});

test('World Home excludes old, future, unknown-date and off-topic stories, and does not suggest ventures for court news', async () => {
  const row = { entity: 'world:topic:technology', pub_date: '2026-09-09T12:00:00Z', link: 'https://news.example/item' };
  const res = await request({ at: '2026-09-10T00:00:00Z', coverage: {}, events: [], articles: [
    { ...row, title: 'New product launch', pub_date: '2026-07-05T12:00:00Z' },
    { ...row, title: 'Unknown publication', pub_date: null },
    { ...row, title: 'Future publication', pub_date: '2026-09-11T12:00:00Z' },
    { ...row, title: 'Football product launch', entity: 'world:sports:fixture' },
    { ...row, title: 'Technology founder in murder court' },
  ] })();
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].text, 'Technology founder in murder court');
  assert.equal(res.body.items[0].integration, undefined);
  assert.equal(res.body.items[0].context, undefined);
});

test('World Home gives each sampled topic space and reports a current-news empty state', async () => {
  const snapshot = { at: '2026-09-10T00:00:00Z', coverage: {}, events: [], articles: [
    { entity: 'world:topic:technology', title: 'Newest product', pub_date: '2026-09-09T12:00:00Z', link: 'https://news.example/one' },
    { entity: 'world:topic:technology', title: 'Second product', pub_date: '2026-09-09T11:00:00Z', link: 'https://news.example/two' },
    { entity: 'world:topic:us-economy', title: 'Economic report', pub_date: '2026-09-09T10:00:00Z', link: 'https://news.example/three' },
  ] };
  const res = await request(snapshot)();
  assert.deepEqual(res.body.items.slice(0, -1).map(i => i.text), ['Newest product', 'Economic report']);
  const empty = await request({ ...snapshot, articles: [] })();
  assert.match(empty.body.items[0].text, /No articles published in the last 48 hours/);
  assert.equal(empty.body.partial, false);
});
