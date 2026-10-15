/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 7: the Finance hand-off carried the Research screen's control text ('Buy AAPL / + Watchlist / Chart / 5Min / 1Hour / 1Day / 1Week / Live chart unavailable ...') and the header's Settings button showed a bare 'C'. Runs the page's own researchSummaryText (tools/ui/view-research.js) over a report: plain sentences of what each section found or why it is unavailable, no control text; connected-actions.js hands that on instead of innerText; the Settings button shows a glyph with its label.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Live re-drive: on Research's default sub-tab (SUB null) the hand-off said nothing was loaded beside a loaded AAPL report; the stock tab is SUB 'stock' or the default.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A reason that already ends with a full stop gets no second one ('...through the Schwab connection..').
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UI = path.join(__dirname, '..', 'tools', 'ui');
const VIEW = fs.readFileSync(path.join(UI, 'view-research.js'), 'utf8');

/** view-research.js in a sandbox (its globals are declared there); returns researchSummaryText. */
function summary() {
  const sandbox = { document: { getElementById: () => null }, console };
  vm.createContext(sandbox);
  vm.runInContext(`${VIEW}\n;globalThis.__summary = researchSummaryText;`, sandbox, { filename: 'view-research.js' });
  return sandbox.__summary;
}

const REPORT = {
  symbol: 'AAPL', book: 'paper',
  sections: { quote: 'ok', fundamentals: 'ok', earnings: 'ok', news: 'unavailable', filings: 'ok' },
  reasons: { news: 'No market-data source is connected on this installation.' },
  quote: { price: 227.5, source: 'world-archive', asOf: '2026-10-11T20:00:00Z' },
  fundamentals: { fiscalYear: 2025, revenue: 391e9, revenueYoYPct: 2.02, netIncome: 93.7e9, netMarginPct: 23.97 },
  earnings: { nextExpected: '2026-10-30', source: 'cadence-estimate', pastResults: ['2026-07-31'] },
  filings: { latest10K: { form: '10-K', date: '2025-11-01', url: 'https://example.test/k' }, latest10Q: { form: '10-Q', date: '2026-08-02', url: 'https://example.test/q' },
    recent8K: [{ date: '2026-07-31', itemsPlain: ['Results of operations'], url: 'https://example.test/8k' }] },
  events: [{ date: '2026-07-31', kind: 'earnings', label: 'Quarterly results' }],
};

test('the hand-off summary states the research, never the screen controls', () => {
  const text = summary()(REPORT);
  assert.match(text, /^Stock research for AAPL\. Price \$227\.5 \(last stored price\) as of 2026-10-11T20:00:00Z\./);
  assert.match(text, /Fundamentals FY2025: revenue \$391\.00B \(2\.0% year on year\), net income \$93\.70B, net margin 24\.0%\./);
  assert.match(text, /Next earnings expected 2026-10-30 \(estimated from cadence\)\./);
  assert.match(text, /News unavailable: No market-data source is connected on this installation\./);
  assert.match(text, /SEC filings: annual 2025-11-01, quarterly 2026-08-02\. Recent 8-Ks: 2026-07-31 Results of operations\./);
  assert.match(text, /Major events: 2026-07-31 Quarterly results\./);
  assert.doesNotMatch(text, /Buy AAPL|\+ Watchlist|5Min|1Hour|1Week|Chart/);
});

test('a report with every section unavailable says why for each', () => {
  const text = summary()({ symbol: 'ZZZ', sections: {}, reasons: { quote: 'not tracked', fundamentals: 'no source' }, quote: null });
  assert.match(text, /Quote unavailable: not tracked\. Fundamentals unavailable: no source\. Earnings unavailable\. News unavailable\. SEC filings unavailable\./);
  assert.equal(summary()(null), '');
  const ended = summary()({ symbol: 'AAPL', sections: {}, reasons: { news: 'No market-data source is connected.' } });
  assert.match(ended, /News unavailable: No market-data source is connected\. SEC/, 'a reason that ends a sentence gets no second full stop');
  assert.doesNotMatch(ended, /\.\./);
});

test('connected-actions hands on the report summary, not the screen text', () => {
  const actions = fs.readFileSync(path.join(UI, 'connected-actions.js'), 'utf8');
  assert.match(actions, /researchSummaryText\(RS_REPORT\)/);
  assert.doesNotMatch(actions, /result\.innerText/);
  assert.match(actions, /\(SUB\|\|'stock'\)==='stock'/, 'Research on its default sub-tab (SUB null) is the stock tab');
  assert.match(VIEW, /RS_REPORT = j;\n {2}body\.innerHTML = researchTopHtml\(j\)/, 'the painted report is the one handed on');
});

test('the Settings button shows a glyph and keeps its label', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'trading.html'), 'utf8');
  const btn = html.match(/<button class="icon-btn" id="settingsBtn"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn);
  assert.match(btn[0], /aria-label="Settings"/);
  assert.notEqual(btn[1].trim(), 'C');
  assert.match(btn[1], /&#9881;/);
});
