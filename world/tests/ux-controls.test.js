/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (world--world-dashboard): the window was offered twice (a select and four 20px pills), subjects showed raw ids ('world:ticker:nvda') and had no search, and an unpaginated By source table of 12,000 words buried the entity graph. Both copies of the served page: one window control of four buttons, names only (human() turns ids into words), a subject search, and By source shows 15 rows with Show more.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const COPIES = ['src-routes/world-app-html.ts', 'routes/world-app-html.js'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function dashboard(rel) {
  const blocks = [...read(rel).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const context = { window: { AppView: { active: () => true } }, AppView: { active: () => true },
    document: { getElementById: () => ({ innerHTML: '', classList: { toggle() {} } }), querySelectorAll: () => [] }, fetch: () => new Promise(() => {}), console };
  vm.createContext(context);
  new vm.Script(blocks[1], { filename: rel }).runInContext(context);
  return context;
}

for (const rel of COPIES) {
  test(rel + ': one window control, four buttons, no select', () => {
    const html = read(rel);
    assert.doesNotMatch(html, /<select id="win">/);
    const pills = [...html.matchAll(/<button type="button" class="pill win-pill[^"]*" aria-pressed="(true|false)" data-win="(\d+)" aria-label="([^"]+)">([^<]+)<\/button>/g)].map((m) => m[4]);
    assert.deepEqual(pills, ['30 d', '90 d', '1 y', 'All']);
  });

  test(rel + ': ids read as names, and the subject list carries no raw id', () => {
    const c = dashboard(rel);
    assert.equal(c.human('world:ticker:nvda'), 'NVDA');
    assert.equal(c.human('world:outlet:the-verge'), 'The Verge');
    assert.equal(c.human('world:topic:us-economy'), 'Us Economy');
    assert.doesNotMatch(read(rel), /items &middot; '\+s\.entity/);
    assert.match(read(rel), /id="subjSearch"[^>]*placeholder="Search subjects"/);
  });

  test(rel + ': By source shows 15 rows, then Show more', () => {
    const c = dashboard(rel);
    assert.equal(c.SOURCE_ROWS, undefined, 'a const stays script-scoped');
    const src = read(rel);
    assert.match(src, /const SOURCE_ROWS = 15;/);
    assert.match(src, /i < SOURCE_ROWS \? sourceRow\(x\) : sourceRow\(x\)\.replace\('<tr>', '<tr class="extra" hidden>'\)/);
    assert.match(src, /onclick="showAllSources\(this\)">Show ' \+ \(rows\.length - SOURCE_ROWS\) \+ ' more<\/button>'/);
  });
}

test('the two copies serve the same page', () => {
  const page = (rel) => read(rel).slice(read(rel).indexOf('<!doctype html>'));
  assert.equal(page(COPIES[0]).replace(/`;\s*$/, '').trim().slice(0, 2000), page(COPIES[1]).replace(/`;\s*$/, '').trim().slice(0, 2000));
});
