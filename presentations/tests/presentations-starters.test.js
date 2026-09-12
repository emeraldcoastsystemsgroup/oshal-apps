/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Contract for the purpose-first starter catalog (2.10.0): every kind has purposes in every one of its groups, ids are unique, every outline is a real multi-section shape in the engine's micro-syntax, spreadsheet starters carry a table or a numeric series (real cells, a live SUM), suggested looks are catalog theme ids, and the surface fetches the catalog + honours the deep link the Create front door sends.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 2.11.0 — focus mode, kind vocabulary and purpose prompts are pinned.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install). Loads the
 * COMPILED module, so a stale routes/office-starters.js fails here before it fails on a box.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STARTER_KINDS, OFFICE_STARTERS, starterCatalog } = require('../routes/office-starters.js');

const SURFACE = path.resolve(__dirname, '..', 'tools', 'presentations.html');
const ROUTES = path.resolve(__dirname, '..', 'src-routes', 'bot-presentation-routes.ts');
/** The deck theme ids the engine ships (src/features/presentation-generation/services/deck-themes.ts). */
const THEME_IDS = ['midnight', 'aurora', 'monochrome', 'executive', 'sunrise', 'forest', 'blueprint', 'paper', 'neon', 'sandstone'];

const sections = (outline) => String(outline).split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);

test('three kinds, each with named purpose groups and an honest "opens in" line', () => {
  assert.deepEqual(STARTER_KINDS.map((k) => k.id), ['pptx', 'docx', 'xlsx']);
  for (const k of STARTER_KINDS) {
    assert.ok(k.groups.length >= 3, `${k.id} has purpose groups`);
    assert.ok(/·/.test(k.opens), `${k.id} names the apps it opens in`);
    assert.equal(new Set(k.groups.map((g) => g.id)).size, k.groups.length, `${k.id} group ids unique`);
  }
});

test('every kind offers at least six purposes and every group has at least one', () => {
  for (const k of STARTER_KINDS) {
    const own = OFFICE_STARTERS.filter((s) => s.kind === k.id);
    assert.ok(own.length >= 6, `${k.id} has ${own.length} starters`);
    for (const g of k.groups) assert.ok(own.some((s) => s.group === g.id), `${k.id}/${g.id} has a starter`);
    for (const s of own) assert.ok(k.groups.some((g) => g.id === s.group), `${s.id} belongs to a declared group`);
  }
  const ids = OFFICE_STARTERS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'starter ids are unique across kinds');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test('every starter is a real shape: title, purpose line, suggested look, multi-section outline', () => {
  for (const s of OFFICE_STARTERS) {
    assert.ok(s.name && s.desc && s.title && s.icon, `${s.id} has name/desc/title/icon`);
    assert.notEqual(s.desc.toLowerCase(), s.name.toLowerCase(), `${s.id} desc is not the name`);
    assert.ok(THEME_IDS.includes(s.theme), `${s.id} suggests a real theme (${s.theme})`);
    const blocks = sections(s.outline);
    assert.ok(blocks.length >= 3, `${s.id} outline has ${blocks.length} sections`);
    for (const b of blocks) assert.ok(b.length >= 1 && b[0].length <= 60, `${s.id} section titles are titles`);
  }
});

test('the documents read as documents: a resume has experience and skills; a flyer has a call to action', () => {
  const by = Object.fromEntries(OFFICE_STARTERS.map((s) => [s.id, s]));
  assert.equal(by.resume.kind, 'docx');
  assert.match(by.resume.outline, /Experience[\s\S]*Skills[\s\S]*Education/);
  assert.match(by.flyer.outline, /Call to action/);
  assert.match(by.letter.outline, /Sincerely/);
  assert.match(by.report.outline, /Executive summary[\s\S]*Recommendations/);
});

test('the spreadsheets read as spreadsheets: a table or a numeric series in every one (real cells, a live SUM)', () => {
  const TABLE = /^\s*\|.*\|\s*$/m;
  const SERIES = /^[^:|#>\n]{1,40}:\s*-?[\d.,]+[kmbt%x]?\s*$/im;
  for (const s of OFFICE_STARTERS.filter((x) => x.kind === 'xlsx')) {
    assert.ok(TABLE.test(s.outline) || SERIES.test(s.outline), `${s.id} carries a table or a series`);
  }
  const budget = OFFICE_STARTERS.find((s) => s.id === 'budget');
  assert.match(budget.outline, /Income[\s\S]*Fixed costs[\s\S]*Variable costs/);
  assert.ok((budget.outline.match(SERIES.source ? new RegExp(SERIES.source, 'gim') : SERIES) || []).length >= 8, 'a budget is mostly numbers');
});

test('the decks cover the four things a deck does: story, explain, meeting, sell', () => {
  const decks = OFFICE_STARTERS.filter((s) => s.kind === 'pptx');
  for (const g of ['story', 'explain', 'meeting', 'sell']) assert.ok(decks.some((s) => s.group === g), `a deck starter for ${g}`);
  // The five shapes the studio always had keep their ids — links and habits depend on them.
  for (const id of ['pitch', 'strategy', 'update', 'teach', 'review']) assert.ok(decks.some((s) => s.id === id), `${id} kept`);
});

test('the catalog is served, and the surface fetches it and honours the deep link', () => {
  const cat = starterCatalog();
  assert.equal(cat.kinds, STARTER_KINDS); assert.equal(cat.starters, OFFICE_STARTERS);
  assert.match(fs.readFileSync(ROUTES, 'utf8'), /router\.get\('\/starters'/);
  const html = fs.readFileSync(SURFACE, 'utf8');
  for (const mark of ['/api/presentations/sections/starters', 'function applyDeepLink', "p.get('kind')", "p.get('starter')", "p.get('theme')", 'function templatesFor', 'data-kind-uses="docx"', 'class="wzGroup"']) {
    assert.ok(html.includes(mark), `surface lost ${mark}`);
  }
  assert.ok(!/const TEMPLATES = \[/.test(html), 'the inline template list is gone — the catalog is served');
});

test('the studio speaks the purpose: focus mode, kind vocabulary, purpose prompts', () => {
  const html = fs.readFileSync(SURFACE, 'utf8');
  for (const mark of ['id="makingBar"', 'id="setupFold"', 'id="outlineLabel"', 'id="synSummary"', 'function enterFocus', 'function applyKindVocabulary', 'const VOCAB']) {
    assert.ok(html.includes(mark), `surface lost ${mark}`);
  }
  // Every kind names its unit and never borrows the deck's: documents have sections, workbooks sheets.
  assert.match(html, /docx: \{ thing:'Word document', unit:'Sections'/);
  assert.match(html, /xlsx: \{ thing:'Excel workbook', unit:'Sheets'/);
  assert.match(html, /pptx: \{ thing:'deck', unit:'Slides'/);
  // Both entry paths enter focus: the walkthrough pick and the deep link.
  assert.match(html, /if \(t\) enterFocus\(t\);/);
  assert.match(html, /closeWiz\(true\); enterFocus\(starterT\);/);
  // The making bar uses the starter's own article, never the kind's: a Budget, an Invoice.
  assert.match(html, /const an = \/\^\[aeiou\]\/i\.test\(starter\.name\) \? 'an' : 'a';/);
  // Every starter carries its own one-line prompt for the AI-draft box.
  for (const s of OFFICE_STARTERS) assert.ok(typeof s.prompt === 'string' && s.prompt.startsWith('e.g. '), `${s.id} has a purpose prompt`);
});
