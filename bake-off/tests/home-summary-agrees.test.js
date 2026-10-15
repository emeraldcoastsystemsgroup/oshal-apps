/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bake-Off says what exists. (1) The home summary drove the COMPILED route with a pool that answers one saved job and no run: it showed "Saved benchmarks 1" beside "No saved work yet"; the item now says one benchmark is saved and none has run. (2) "Ask the analyst" was enabled for a job that had never run (the route then answered 409); the shipped verdictReady (cut out of tools/bake-off.html and run) enables it only for a finished run.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the Review tab said 'No saved work yet. Open the app to begin.' inside the app; the empty and not-yet-run lines now name the AI Bake-Off tab.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

/** Load the compiled home summary with a stub express Router that records the GET handler. */
function summaryHandler() {
  const original = Module._load;
  let handler = null;
  Module._load = function (request, ...rest) {
    if (request === 'express') return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) };
    return original.call(this, request, ...rest);
  };
  try {
    const file = path.resolve(__dirname, '..', 'routes', 'home-summary.js');
    delete require.cache[file];
    return { mod: require(file), make: (pool) => { require(file).createHomeSummaryRoutes({ pool }); return handler; } };
  } finally { Module._load = original; }
}

/** A pool answering the three summary queries in order: jobs, run counts, recent runs. */
function pool(jobs, runs) {
  return { query: async ({ text }) => {
    if (/count\(\*\)::text AS jobs/.test(text)) return { rows: [{ jobs: String(jobs) }] };
    if (/AS active/.test(text)) return { rows: [{ active: '0', failed: '0', five: String(runs.length) }] };
    return { rows: runs };
  } };
}

async function summary(jobs, runs = []) {
  const handler = summaryHandler().make(pool(jobs, runs));
  const req = { oidc: { user: { sub: 'owner-1' }, isAuthenticated: () => true } };
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler(req, res);
  return res.body;
}

test('saved benchmarks with no run are named as saved and not run, never "No saved work"', async () => {
  const one = await summary(1);
  assert.equal(one.metrics.find((m) => m.id === 'saved-benchmarks').value, '1');
  assert.equal(one.items[0].text, '1 saved benchmark, none run yet. Open the AI Bake-Off tab and run one to compare lanes.');
  assert.ok(!one.items.some((i) => /No saved work/.test(i.text)), 'the item agrees with the metric');
  assert.match((await summary(3)).items[0].text, /^3 saved benchmarks, none run yet\./);
  assert.equal((await summary(0)).items[0].text, 'No saved work yet. Open the AI Bake-Off tab to save a job and run it.');
});

test('a run is listed and replaces the empty-state line', async () => {
  const body = await summary(1, [{ name: 'Summaries', status: 'complete', started_at: '2026-10-10T12:00:00Z', lanes_requested: 2, lanes_completed: 2, observed_model: 'm', judge_score: '81', judge_mode: 'rubric', cost_usd: '0.01' }]);
  assert.equal(body.items[0].text, 'Summaries');
  assert.ok(!body.items.some((i) => /none run yet|No saved work/.test(i.text)));
});

test('"Ask the analyst" is enabled only for a finished run', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'bake-off.html'), 'utf8');
  const start = html.indexOf('function verdictReady(');
  assert.ok(start > 0, 'the surface declares verdictReady');
  const end = html.indexOf('\n}\n', start) + 2;
  const button = { disabled: false, title: '' };
  const sandbox = { $: (id) => { assert.equal(id, 'verdict'); return button; } };
  vm.createContext(sandbox);
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.verdictReady = verdictReady;`, sandbox);
  sandbox.verdictReady(null);
  assert.deepEqual([button.disabled, button.title], [true, 'Run this job first; the analyst reads a finished run.']);
  sandbox.verdictReady({ status: 'running' });
  assert.deepEqual([button.disabled, button.title], [true, 'Wait for this run to finish.']);
  sandbox.verdictReady({ status: 'complete' });
  assert.deepEqual([button.disabled, button.title], [false, '']);
  assert.match(html, /\['run', 'del'\]\.forEach\(\(id\) => \{ \$\(id\)\.disabled = !job; \}\);\n  if \(LANES\.length < 2\) \$\('run'\)\.disabled = true;\n  verdictReady\(null\);/,
    'selecting a job no longer enables the analyst before its report says a run finished');
  assert.match(html, /function renderReport\(d\) \{\n  verdictReady\(d\.run \|\| null\);/);
});
