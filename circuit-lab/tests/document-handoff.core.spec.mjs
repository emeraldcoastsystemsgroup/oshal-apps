/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the shared document handoff on the actual page: the
 *                     |                             | REAL /shared/ui/js/document-handoff.js module and the compiled
 *                     |                             | routes on loopback. A part added on the canvas, an inspector
 *                     |                             | field never applied and a run setting never committed are each
 *                     |                             | saved before the handoff names the design and its updated_at;
 *                     |                             | a part edit made through the lab's own route (standing in for
 *                     |                             | the concierge) is drawn on refresh; the next manual edit reaches
 *                     |                             | the next handoff; an inspector field the person is still editing
 *                     |                             | survives both the refresh and the page's poll.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express and playwright, and the kernel platform for the shared module:
 * OSHAL_CORE_ROOT=<core checkout> OSHAL_PLATFORM_ROOT=<kernel>/platform node --test tests/document-handoff.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from './surface-editing.core.fixture.mjs';

let fixture, browser, page;
const errors = [];
test.before(async () => {
  fixture = await startFixture();
  const { chromium } = fixture.coreRequire('playwright');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // The connected-actions shell (/cockpit/js/app-workflows.js) is a cockpit file this fixture does not serve; the page
  // already words its absence. Every other console error counts.
  page.on('console', (m) => { if (m.type() === 'error' && !String(m.location()?.url || '').endsWith('/cockpit/js/app-workflows.js')) errors.push('console: ' + m.text()); });
  await page.goto(fixture.baseUrl + '/api/circuit-lab/app');
  await page.waitForSelector('#palette button', { state: 'attached' });
  await page.waitForFunction(() => !!window.__oshalDocumentSession);
});
test.after(async () => { await browser?.close(); fixture?.stop(); });

const row = (id) => fixture.pool.tables.circuit_design.find((d) => d.design_id === id);
const begin = () => page.evaluate(async () => {
  const api = await import('/shared/ui/js/document-handoff.js');
  window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context;
});
/** The concierge's edit, made through the lab's own part route as the same signed-in person. */
async function conciergeEdit(id, ohms) {
  const res = await fetch(`${fixture.baseUrl}/api/circuit-lab/designs/${id}/parts/R1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ props: { ohms }, run: false }) });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).design;
}
async function openExample() {
  const before = new Set(fixture.pool.tables.circuit_design.map((d) => d.design_id));
  await page.selectOption('#example-select', 'led-switch');
  await page.waitForFunction(() => document.querySelector('#design-state')?.textContent === 'run 1' && document.querySelectorAll('svg#canvas g.part').length === 5);
  const created = fixture.pool.tables.circuit_design.filter((d) => !before.has(d.design_id));
  assert.equal(created.length, 1);
  return created[0].design_id;
}
async function selectR1(id) {
  const index = row(id).parts.findIndex((p) => p.id === 'R1');
  await page.locator('svg#canvas g.part').nth(index).dispatchEvent('pointerdown');
  await page.locator('svg#canvas').dispatchEvent('pointerup');
  await page.waitForSelector('#prop-ohms');
}

test('pending canvas, inspector and run-setting edits are saved before the handoff; a concierge edit is drawn on refresh; the next manual edit reaches the next handoff', async () => {
  const id = await openExample();
  await page.click('#palette button[data-type="resistor"]');
  const first = await begin();
  assert.equal(first.app, 'circuit-lab');
  assert.equal(first.recordId, id);
  assert.equal(row(id).parts.length, 6, 'the part added on the canvas was saved before the handoff');
  assert.equal(first.fields.revision, row(id).updated_at);
  assert.equal(first.fields.readOnly, false);

  await selectR1(id);
  await page.fill('#prop-ohms', '1200');
  const second = await begin();
  assert.equal(second.recordId, id);
  assert.equal(row(id).parts.find((p) => p.id === 'R1').props.ohms, 1200, 'an inspector field never applied is saved');
  assert.equal(second.fields.revision, row(id).updated_at);
  assert.notEqual(second.fields.revision, first.fields.revision);

  const edited = await conciergeEdit(id, 2200);
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#prop-ohms').inputValue(), '2200', 'the concierge edit is drawn in the open inspector');
  const r1 = row(id).parts.findIndex((p) => p.id === 'R1');
  assert.match(await page.locator('svg#canvas g.part').nth(r1).locator('text.value').textContent(), /2\.2kΩ/);

  await page.fill('#prop-ohms', '3300');
  await page.fill('#sim-stop', '0.03');
  const third = await begin();
  assert.equal(third.recordId, id);
  assert.equal(row(id).parts.find((p) => p.id === 'R1').props.ohms, 3300, 'the next manual edit is saved over the concierge one');
  assert.equal(row(id).sim.stopSeconds, 0.03, 'a run setting still in its field is saved');
  assert.equal(third.fields.revision, row(id).updated_at);
  assert.ok(Date.parse(third.fields.revision) > Date.parse(edited.updated_at));
  assert.deepEqual(errors, []);
});

test('an inspector field the person is still editing survives the refresh and the poll; the refresh says so', async () => {
  const id = await openExample();
  await selectR1(id);
  const handed = await begin();
  assert.equal(handed.recordId, id);
  await page.fill('#prop-ohms', '5600');
  await conciergeEdit(id, 100);
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /while you were editing/);
  assert.equal(await page.locator('#prop-ohms').inputValue(), '5600');
  assert.match(await page.locator('#toast').textContent(), /Your edit is still here/);
  await page.waitForTimeout(5600);
  assert.equal(await page.locator('#prop-ohms').inputValue(), '5600', 'the five-second poll does not redraw over the field');
  assert.equal(row(id).parts.find((p) => p.id === 'R1').props.ohms, 100, 'nothing was saved behind the person');
  const next = await begin();
  assert.equal(row(id).parts.find((p) => p.id === 'R1').props.ohms, 5600, 'the kept field reaches the next handoff');
  assert.equal(next.fields.revision, row(id).updated_at);
  assert.deepEqual(errors, []);
});
