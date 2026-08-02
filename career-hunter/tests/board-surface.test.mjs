/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Guards for the board surface: the inline script is never parsed by a compiler (a served HTML file), so a syntax error ships silently — this parses it. Plus the filter-memory contract the operator asked for (the board must come back with the filter it was left on) and the boot shape that stopped putting two round-trips in front of the first paint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'tools', 'career-board.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const body = inline.join('\n;\n');

test('every inline script parses — nothing else in the toolchain checks this file', () => {
  assert.ok(inline.length > 0, 'expected inline script blocks');
  inline.forEach((src, i) => {
    assert.doesNotThrow(() => new vm.Script(src, { filename: `career-board.html#${i}` }));
  });
});

test('the filter set is written to localStorage on every change', () => {
  // The surface is an iframe: a ribbon navigation reloads the document and drops in-memory state,
  // so persistence is the only thing that makes a filter survive leaving the tab.
  assert.match(body, /localStorage\.setItem\(FILTER_KEY/);
  assert.match(body, /localStorage\.getItem\(FILTER_KEY/);
  // Every control the operator can set has to be in the persisted set.
  for (const id of ['q', 'sort', 'min_score', 'min_pay', 'days']) {
    assert.ok(new RegExp(`'${id}'`).test(body), `filter control not persisted: ${id}`);
  }
  assert.match(body, /f\.remote\s*=\s*'1'/);   // the checkbox
  assert.match(body, /f\.status\s*=\s*activeStatus/); // the pipeline tab
});

test('filters are restored before the first request goes out', () => {
  const restore = body.indexOf('restoreFilters();');
  const boot = body.indexOf('checkOnboarding(true);');
  assert.ok(restore > -1 && boot > -1, 'expected the boot sequence');
  assert.ok(restore < boot, 'restoreFilters() must run before the first fetch');
});

test('an explicit URL filter wins over the remembered one', () => {
  // A bookmarked or shared link has to render what it says, not this browser's last view.
  assert.match(body, /fromUrl\s*\?\s*url\s*:\s*saved/);
});

test('changing any filter re-queries AND re-remembers', () => {
  // refilter() is the pairing; a listener wired straight to loadJobs would query without saving.
  assert.match(body, /const refilter\s*=\s*\(\)\s*=>\s*\{\s*rememberFilters\(\);\s*loadJobs\(\);\s*\}/);
  assert.match(body, /\['sort','min_score','min_pay','days'\]\.forEach\(k=>\$\(k\)\.addEventListener\('change',refilter\)\)/);
  assert.match(body, /\$\('remote'\)\.addEventListener\('change',refilter\)/);
  assert.match(body, /qt=setTimeout\(refilter,300\)/);
  // The pipeline tabs are a filter too.
  assert.match(body, /activeStatus=b\.dataset\.k;\s*rememberFilters\(\)/);
});

test('a remembered filter is escapable — the operator can see and clear it', () => {
  // Sticky state with no visible exit is how a board looks broken ("where did my jobs go?").
  assert.match(body, /clear filters/);
  assert.match(body, /function clearFilters\(\)/);
});

test('the feed request is issued in parallel with the onboarding gate', () => {
  // /resume/state used to resolve BEFORE the feed started — two serialized round-trips in front
  // of first paint, to answer a question that is "yes" for every returning user.
  assert.match(body, /const feed = prefetch \? fetchJobs\(\)/);
  const gate = body.indexOf("fetch('/api/career-hunter/resume/state')");
  const kick = body.indexOf('const feed = prefetch ? fetchJobs()');
  assert.ok(kick > -1 && gate > kick, 'the feed must be kicked off before awaiting resume/state');
});

test('the surface tells the operator what a pooled ranking covered', () => {
  // Reporting "ranked within your top N" is the honest counterpart to bounding the pool.
  assert.match(body, /ranked within your top/);
  assert.match(body, /no further scored matches/);
});
