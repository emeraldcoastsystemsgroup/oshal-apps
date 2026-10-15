/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Regression for the identity search that listed Google Cloud APIs alphabetically ("Abusive Experience Report API" first) and buried the Google sign-in connector: the shipped searchRank/rankedMatches from tools/identity.html put an exact name or id first, then names starting with the words typed, and ids that merely contain the query last.
 *
 * Runs the two functions out of the page in a VM, so the bytes the browser runs are the bytes under test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'identity.html'), 'utf8');

/** Pull one top-level `function name(...){...}` out of the page by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in identity.html`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const ctx = {};
vm.runInNewContext(`${extractFunction(html, 'searchRank')}\n${extractFunction(html, 'rankedMatches')}\nthis.searchRank = searchRank; this.rankedMatches = rankedMatches;`, ctx);

/** A synthetic slice of the catalog shaped like GET /api/connect/list rows. */
const CATALOG = [
  { id: 'googleapis-com-abusiveexperiencereport', label: 'Abusive Experience Report API', category: null, auth: 'token', connected: false },
  { id: 'googleapis-com-acceleratedmobilepageurl', label: 'Accelerated Mobile Pages (AMP) URL API', category: null, auth: 'token', connected: false },
  { id: 'goog-io', label: 'goog.io | Unoffical Google Search API', category: null, auth: 'token', connected: false },
  { id: 'google-search-console', label: 'Google Search Console', category: 'Marketing', auth: 'oauth', connected: false },
  { id: 'google-drive', label: 'Google Drive', category: 'Files', auth: 'oauth', connected: false },
  { id: 'google-calendar', label: 'Google Calendar', category: 'Scheduling', auth: 'oauth', connected: true },
  { id: 'google', label: 'google', category: null, auth: 'oauth', connected: false },
  { id: 'spotify', label: 'Spotify', category: 'Media', auth: 'oauth', connected: false },
];
const ids = (rows) => rows.map((p) => p.id);

test('"google" puts the Google sign-in connector first and the Cloud APIs last', () => {
  const order = ids(ctx.rankedMatches(CATALOG, 'google'));
  assert.equal(order[0], 'google');
  assert.deepEqual(order.slice(1, 4), ['google-calendar', 'google-drive', 'google-search-console']);
  assert.ok(order.indexOf('googleapis-com-abusiveexperiencereport') > order.indexOf('goog-io'));
  assert.ok(!order.includes('spotify'));
});

test('a multi-word query matches word starts in the name', () => {
  assert.deepEqual(ids(ctx.rankedMatches(CATALOG, 'google cal')), ['google-calendar']);
  assert.equal(ctx.searchRank(CATALOG.find((p) => p.id === 'google-drive'), 'Google Drive'), 100);
});

test('category and auth kind still match, below any name match', () => {
  const files = ctx.searchRank(CATALOG.find((p) => p.id === 'google-drive'), 'files');
  assert.ok(files > 0 && files < ctx.searchRank(CATALOG.find((p) => p.id === 'google-drive'), 'drive'));
  assert.equal(ctx.searchRank(CATALOG.find((p) => p.id === 'spotify'), 'zzz'), 0);
});

test('a search renders one ranked list instead of category groups sorted by name', () => {
  const render = extractFunction(html, 'renderProviders');
  assert.match(render, /rankedMatches\(providers, query\)/);
  assert.match(render, /Best matches for/);
});
