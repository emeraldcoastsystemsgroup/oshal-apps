/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.3.0: the dashboard's sentiment cards over oshal's own observed outlet ratings. The real dashboard script (both the source template and the compiled copy) runs in a vm context and renders synthetic /sentiment answers: a rated source shows its lean, bucket, reliability, compared subject-days, subjects and date range; a source below the minimums and a never-compared source show insufficient data and no number; the note states the method with the answer's own numbers; no seeded axis or "seed placeholders" text remains; a server that reports no ratings gets a notice, not numbers; source names are escaped.
 * -----------------------------------------------------------------------------
 * @module surface-ratings.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const COPIES = ['src-routes/world-app-html.ts', 'routes/world-app-html.js'];

/** The dashboard's own inline script (the second inline <script>; the first is the audience-view block). */
function dashboardScript(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const blocks = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, rel + ': the audience block and the dashboard script');
  return blocks[1];
}

/** Run the dashboard script with an active audience view (so it does not start loading) and return its globals. */
function loadDashboard(rel) {
  const element = () => ({ innerHTML: '', onchange: null, classList: { toggle() {} } });
  const context = {
    window: { AppView: { active: () => true } },
    AppView: { active: () => true },
    document: { getElementById: element, querySelectorAll: () => [] },
    fetch: () => { throw new Error('the cards must render without a network read'); },
    console,
  };
  vm.createContext(context);
  new vm.Script(dashboardScript(rel), { filename: rel }).runInContext(context);
  return context;
}

const rating = (over) => Object.assign({
  source: 'world:outlet:reuters', status: 'rated', lean: -0.12, leanBucket: 'below', reliability: 0.912,
  comparisons: 120, subjects: 30, observations: 260, firstObserved: '2026-07-03', lastObserved: '2026-09-30',
}, over);

const ANSWER = {
  entity: 'world:ticker:nvda', days: 90, naive: 0.21, reliabilityWeighted: 0.18,
  lean: { balanced: 0.15, byLean: { below: -0.05, near: 0.2, above: 0.4 }, spread: 0.45, consensus: 'mixed' },
  balanced: 0.15, byLean: { below: -0.05, near: 0.2, above: 0.4 }, spread: 0.45, consensus: 'mixed',
  bySource: [
    { source: 'world:outlet:thin-blog', outlet: 'Thin Blog <script>x</script>', lean: null, bias: 'insufficient', reliability: null, points: 3, value: 0.9,
      rating: rating({ source: 'world:outlet:thin-blog', status: 'insufficient', lean: null, leanBucket: null, reliability: null, comparisons: 5, subjects: 2, observations: 5 }) },
    { source: 'world:outlet:reuters', outlet: 'Reuters', lean: -0.12, bias: 'below', reliability: 0.912, points: 40, value: -0.05, rating: rating({}) },
    { source: 'world:outlet:new-site', outlet: 'New Site', lean: null, bias: 'insufficient', reliability: null, points: 1, value: 0.3,
      rating: rating({ source: 'world:outlet:new-site', status: 'insufficient', lean: null, leanBucket: null, reliability: null, comparisons: 0, subjects: 0, observations: 0, firstObserved: null, lastObserved: null }) },
  ],
  ratings: { method: 'consensus-divergence-v1', windowDays: 90, minComparisons: 20, minSubjects: 3, leanZ: 2, computedAt: '2026-10-01T00:00:00.000Z', rated: 1, insufficient: 2 },
};

const OLD_CORE_ANSWER = {
  naive: 0.1, reliabilityWeighted: 0.1,
  political: { balanced: 0.1, byLean: { left: 0.2, center: 0, right: -0.1 }, consensus: 'mixed' },
  econ: { balanced: 0, byEcon: {}, consensus: 'insufficient' }, byKind: {},
  bySource: [{ source: 'world:outlet:foxnews', outlet: 'Fox News', kind: 'partisan', lean: 0.65, bias: 'right', points: 4, value: -0.1 }],
};

/** One table row per source, in page order. */
const rows = (html) => [...html.matchAll(/<tr><td>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

for (const rel of COPIES) {
  test('a rated source shows its observed rating with the counts and dates behind it (' + rel + ')', () => {
    const html = loadDashboard(rel).sentimentCards({ label: 'NVDA' }, ANSWER);
    const reuters = rows(html).find((r) => r.startsWith('Reuters'));
    assert.ok(reuters, 'Reuters row present');
    assert.match(reuters, /-0\.12 <span class="tag">below<\/span>/);
    assert.match(reuters, /<td>0\.91<\/td>/);
    assert.match(reuters, /120 compared subject-days, 30 subjects, 2026-07-03 to 2026-09-30/);
  });

  test('a source below the minimums and a never-compared source show insufficient data, never a number (' + rel + ')', () => {
    const html = loadDashboard(rel).sentimentCards({ label: 'NVDA' }, ANSWER);
    const all = rows(html);
    assert.equal(all.length, 3);
    assert.match(all[0], /^Reuters/, 'rated sources first');
    const thin = all.find((r) => r.startsWith('Thin Blog'));
    assert.match(thin, /insufficient data/);
    assert.match(thin, /5 compared subject-days, 2 subjects/);
    assert.match(thin, /<td>&mdash;<\/td>/, 'no reliability number');
    const fresh = all.find((r) => r.startsWith('New Site'));
    assert.match(fresh, /insufficient data/);
    assert.match(fresh, /not compared in the rating window/);
  });

  test('the lean axis and the method note carry the answer\'s own numbers; no seeded axis remains (' + rel + ')', () => {
    const html = loadDashboard(rel).sentimentCards({ label: 'NVDA' }, ANSWER);
    assert.match(html, /Lean against the other sources \(observed\)/);
    for (const k of ['below', 'near', 'above']) assert.match(html, new RegExp('<span class="name">' + k + '</span>'));
    assert.match(html, /the last 90 days; a source with fewer than 20 compared subject-days or 3 subjects shows insufficient data/);
    assert.match(html, /Here: 1 rated, 2 insufficient/);
    assert.match(html, /consensus: mixed/);
    assert.doesNotMatch(html, /seed placeholder|Political axis|Economic axis|By outlet kind|political balanced|econ balanced/i);
  });

  test('a server that reports no ratings gets a notice, not numbers (' + rel + ')', () => {
    const html = loadDashboard(rel).sentimentCards({ label: 'NVDA' }, OLD_CORE_ANSWER);
    assert.match(html, /does not report observed outlet ratings/);
    assert.doesNotMatch(html, /<table>|Political axis|partisan|right<\/td>/);
  });

  test('source names are escaped (' + rel + ')', () => {
    const html = loadDashboard(rel).sentimentCards({ label: 'NVDA' }, ANSWER);
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /Thin Blog &lt;script&gt;x&lt;\/script&gt;/);
  });
}

test('both copies render the same cards', () => {
  const [a, b] = COPIES.map((rel) => loadDashboard(rel).sentimentCards({ label: 'NVDA' }, ANSWER));
  assert.equal(a, b);
});
