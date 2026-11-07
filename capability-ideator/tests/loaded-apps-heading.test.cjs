/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: every loaded-application heading read "Aero Lab · 1 available actions".
 *   The heading statement the page runs is taken from tools/review.html and run over one, two and no available offers.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the directory de-duplicates an application's actions by label and target, so the fixture names each
 *   offer and a new case proves an action offered twice counts once.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');

/** The page's own heading statement(s), from the offers line up to the heading assignment, run over a fake entry. */
function heading(states) {
  const start = page.indexOf("const offers=(entry.integrationSources||[])");
  const end = page.indexOf(';', page.indexOf('heading.textContent=', start));
  assert.ok(start > 0 && end > start, 'the page builds each heading from its offers');
  const node = { textContent: '' };
  const entry = { displayName: 'Aero Lab', integrationSources: [{ offers: states.map((state, i) => ({ state, label: 'Action ' + i, targetApp: 'presentations' })) }] };
  new Function('entry', 'heading', page.slice(start, end + 1))(entry, node);
  return node.textContent;
}

test('a loaded-application heading counts its available actions in the right number (sweep 12)', () => {
  assert.equal(heading(['available']), 'Aero Lab · 1 available action');
  assert.equal(heading(['available', 'available', 'needs-connection']), 'Aero Lab · 2 available actions');
  assert.equal(heading([]), 'Aero Lab · 0 available actions');
});

test('an action offered twice by the same application is counted once (UX audit 2026-11-06: four identical rows)', () => {
  const start = page.indexOf("const offers=(entry.integrationSources||[])");
  const end = page.indexOf(';', page.indexOf('heading.textContent=', start));
  const node = { textContent: '' };
  const twice = { label: 'Prepare a document', targetApp: 'presentations', state: 'available' };
  const entry = { displayName: 'Intelligent Career', integrationSources: [{ offers: [twice, twice] }, { offers: [twice, { ...twice, targetApp: 'venture-plan' }] }] };
  new Function('entry', 'heading', page.slice(start, end + 1))(entry, node);
  assert.equal(node.textContent, 'Intelligent Career · 2 available actions');
});
