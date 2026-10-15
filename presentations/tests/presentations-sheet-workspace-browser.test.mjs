/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Actual Chromium workspace actions; synchronous outline adapters are the named seam, not native/export/provider acceptance.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Model the real parent reentrant refresh and prove consecutive undo/redo snapshots and focus.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve actual pending value/source fields through unchanged refresh and still render empty initial drafts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const toolchain = process.env.STORE_CI_TOOLCHAIN || fileURLToPath(new URL('../../scripts/toolchain', import.meta.url));
const moduleDirectory = process.env.OSHAL_PACKAGE_NODE_MODULES || resolve(toolchain, 'node_modules');
const { chromium } = require(resolve(moduleDirectory, 'playwright'));
const initial = [{ title: 'Budget', content: '| Item | Value |\n| Rent | 1500 |\n| Food | 400 |' }, { title: 'Income', content: 'Salary: 5200\nSide work: 400' }, { title: 'Notes <img src=x onerror=alert(1)>', content: '## Keep this group\n> An original quote\n#layout: comparison' }];

async function fixture(t, width = 1200) {
  const server = createServer(async (req, res) => {
    const name = req.url === '/sheet-workspace.mjs' ? 'sheet-workspace.mjs' : req.url === '/sheet-workspace.css' ? 'sheet-workspace.css' : null;
    if (name) { res.setHeader('content-type', name.endsWith('mjs') ? 'text/javascript' : 'text/css'); res.end(await readFile(new URL(`../tools/${name}`, import.meta.url))); return; }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/sheet-workspace.css"><style>body{margin:8px}main{max-width:100%}</style></head><body><main id="host"></main><script type="module">
      import {createSheetWorkspace} from '/sheet-workspace.mjs';
      window.sections=${JSON.stringify(initial).replaceAll('<', '\\u003c')}; window.writes=0;window.events=[];
      const readSections=()=>structuredClone(window.sections);
      const writeSections=sections=>{window.sections=structuredClone(sections);window.writes++;window.workspace?.refresh()};
      window.workspace=createSheetWorkspace({host:document.querySelector('#host'),readSections,writeSections,onChange:selection=>window.events.push(selection)});
    </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('grid').waitFor();
  return page;
}
const valueEditor = page => page.getByRole('textbox', { name: 'Cell value or formula text' });
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();

test('unchanged theme or layout refresh keeps pending value and source drafts and focus', async t => {
  const page = await fixture(t);
  await page.getByRole('gridcell', { name: 'B2', exact: true }).click();
  await valueEditor(page).fill('not committed yet');
  await page.evaluate(() => window.workspace.refresh());
  assert.equal(await valueEditor(page).inputValue(), 'not committed yet');
  assert.equal(await valueEditor(page).evaluate(el => el === document.activeElement), true);
  assert.match(await page.evaluate(() => window.sections[0].content), /Rent \| 1500/);
  await page.locator('.sheet-source summary').click();
  const source = page.getByRole('textbox', { name: 'Original sheet source' });
  await source.fill('| Still | Pending |\n| Source | Draft |');
  await page.evaluate(() => window.workspace.refresh());
  assert.equal(await source.inputValue(), '| Still | Pending |\n| Source | Draft |');
  assert.equal(await source.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.sheet-source').evaluate(el => el.open), true);
  assert.equal(await page.evaluate(() => window.writes), 0);
  await page.evaluate(() => { window.sections=[];window.workspace.refresh(); });
  assert.equal(await page.getByText('Add a sheet to begin.', { exact: true }).count(), 1);
  await page.evaluate(() => { window.workspace.destroy();window.workspace=undefined; });
  await page.evaluate(async () => {
    const {createSheetWorkspace}=await import('/sheet-workspace.mjs');
    window.workspace=createSheetWorkspace({host:document.querySelector('#host'),readSections:()=>[],writeSections:()=>{throw new Error('not used')}});
  });
  assert.equal(await page.getByText('Add a sheet to begin.', { exact: true }).count(), 1, 'initial empty draft still renders');
});

test('synchronous adapter refresh preserves multiple edit snapshots through two undo and redo operations', async t => {
  const page = await fixture(t);
  await page.getByRole('gridcell', { name: 'B2', exact: true }).click();
  await valueEditor(page).fill('1501'); await click(page, 'Apply');
  await valueEditor(page).fill('1502'); await click(page, 'Apply');
  const content = () => page.evaluate(() => window.sections[0].content);
  await click(page, 'Undo'); assert.match(await content(), /Rent \| 1501/);
  await page.keyboard.press('Control+z'); assert.match(await content(), /Rent \| 1500/);
  await page.keyboard.press('Control+Shift+z'); assert.match(await content(), /Rent \| 1501/);
  await click(page, 'Redo'); assert.match(await content(), /Rent \| 1502/);
  assert.equal(await page.locator('[role="gridcell"][aria-label="B2"]').evaluate(el => el === document.activeElement), true);
});

test('human grid edits, keyboard selection, formulas and history change the authoritative outline', async t => {
  const page = await fixture(t);
  await page.getByRole('gridcell', { name: 'B2', exact: true }).dblclick();
  await valueEditor(page).fill('=SUM(B3:B4)'); await valueEditor(page).press('Enter');
  assert.deepEqual(await page.evaluate(() => window.workspace.getSelection()), { kind: 'xlsx', index: 1, title: 'Budget', cell: 'B3' });
  assert.equal(await page.evaluate(() => window.sections[0].content), '| Item | Value |\n| Rent | =SUM(B3:B4) |\n| Food | 400 |');
  await click(page, 'Undo'); assert.match(await page.evaluate(() => window.sections[0].content), /Rent \| 1500/);
  await click(page, 'Redo'); assert.match(await page.evaluate(() => window.sections[0].content), /=SUM/);
  await page.getByRole('gridcell', { name: 'B3', exact: true }).focus(); await page.keyboard.press('Control+z');
  assert.match(await page.evaluate(() => window.sections[0].content), /Rent \| 1500/);
  await page.keyboard.press('Control+Shift+z'); assert.match(await page.evaluate(() => window.sections[0].content), /=SUM/);
  await page.getByRole('gridcell', { name: 'B3', exact: true }).press('ArrowLeft');
  assert.equal((await page.evaluate(() => window.workspace.getSelection())).cell, 'A3');
  assert.equal(await page.locator('.sheet-notice').textContent(), 'Formulas are saved as text. This workspace does not calculate them. The XLSX exporter adds a live SUM total for numeric Label: Value sections.');
});

test('tabs and all sheet lifecycle operations, series conversion and source fallback retain originals', async t => {
  const page = await fixture(t);
  await page.getByRole('tab', { name: 'Income', exact: true }).click();
  await page.getByRole('gridcell', { name: 'B2', exact: true }).click();
  await valueEditor(page).fill('5300'); await click(page, 'Apply');
  assert.equal(await page.evaluate(() => window.sections[1].content), 'Salary: 5300\nSide work: 400');
  await valueEditor(page).fill('=B3*2'); await click(page, 'Apply');
  assert.match(await page.getByRole('status', { name: 'Sheet edit status' }).textContent(), /Converted/);
  assert.equal(await page.evaluate(() => window.sections[1].content), '| Label | Value |\n| Salary | =B3*2 |\n| Side work | 400 |');
  await page.getByRole('textbox', { name: 'Sheet name', exact: true }).fill('Own renamed sheet'); await click(page, 'Rename');
  await click(page, 'Duplicate');
  assert.deepEqual(await page.evaluate(() => window.sections.slice(1, 3).map(s => s.content)), ['| Label | Value |\n| Salary | =B3*2 |\n| Side work | 400 |', '| Label | Value |\n| Salary | =B3*2 |\n| Side work | 400 |']);
  await click(page, 'Remove'); await click(page, 'Undo');
  await click(page, 'Add sheet'); await click(page, 'Add row'); await click(page, 'Add column');
  assert.equal(await page.getByRole('tab').count(), 5);
  await page.getByRole('tab', { name: 'Notes <img src=x onerror=alert(1)>', exact: true }).click();
  assert.equal(await page.locator('img').count(), 0, 'sheet title is escaped DOM text');
  assert.equal(await page.getByRole('grid').count(), 0);
  const original = await page.getByRole('textbox', { name: 'Original sheet source' }).inputValue();
  assert.equal(original, initial[2].content);
  await page.getByRole('textbox', { name: 'Original sheet source' }).fill(`${original}\nAn extra note`); await click(page, 'Apply source');
  assert.equal(await page.evaluate(() => window.sections[3].content), `${initial[2].content}\nAn extra note`);
  await page.getByRole('textbox', { name: 'Original sheet source' }).fill('first\n\nsecond'); await click(page, 'Apply source');
  assert.match(await page.getByRole('status', { name: 'Sheet edit status' }).textContent(), /blank line/);
});

test('external AI/source updates retire undo and reject stale local mutation', async t => {
  const page = await fixture(t);
  await page.getByRole('gridcell', { name: 'B2', exact: true }).click(); await valueEditor(page).fill('99'); await click(page, 'Apply');
  await valueEditor(page).fill('88');
  await page.evaluate(() => { window.sections[0].content = '| AI | Current |\n| Preserved | 77 |'; });
  await click(page, 'Apply');
  assert.equal(await page.evaluate(() => window.sections[0].content), '| AI | Current |\n| Preserved | 77 |');
  assert.match(await page.getByRole('status', { name: 'Sheet edit status' }).textContent(), /changed elsewhere/);
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.sections=[];window.workspace.refresh(); });
  assert.equal(await page.evaluate(() => window.workspace.getSelection()), null);
  await click(page, 'Add sheet'); assert.equal(await page.getByRole('grid').count(), 1);
  await page.evaluate(() => window.workspace.destroy()); assert.equal(await page.locator('.sheet-workspace').count(), 0);
  assert.equal(await page.evaluate(() => window.workspace.getSelection()), null);
});

test('phone grid scrolls inside workspace and paging preserves all offscreen source cells', async t => {
  const page = await fixture(t, 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.locator('.sheet-grid-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
  const content = [Array.from({ length: 30 }, (_, i) => `Header ${i}`), ...Array.from({ length: 80 }, (_, i) => Array.from({ length: 30 }, (_, c) => `${i}:${c}`))].map(row => `| ${row.join(' | ')} |`).join('\n');
  await page.evaluate(content => { window.sections=[{title:'Large',content}];window.workspace.refresh(); }, content);
  await click(page, 'Next rows'); await click(page, 'Next columns');
  await page.getByRole('gridcell', { name: 'AA51', exact: true }).click();
  await valueEditor(page).fill('offscreen edit'); await click(page, 'Apply');
  const saved = await page.evaluate(() => window.sections[0].content.split('\n'));
  assert.equal(saved.length, 81); assert.equal(saved[0], content.split('\n')[0]); assert.equal(saved[80], content.split('\n')[80]);
  assert.match(saved[50], /offscreen edit/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});


test('selection commits pending cell text, invalid text stays selected, and source drafts require an explicit decision',async t=>{
 const page=await fixture(t);
 await page.getByRole('gridcell',{name:'B2',exact:true}).dblclick();await valueEditor(page).fill('1700');
 await page.getByRole('gridcell',{name:'B3',exact:true}).click();assert.match(await page.evaluate(()=>window.sections[0].content),/Rent \| 1700/);
 await valueEditor(page).fill('450');await page.getByRole('tab',{name:'Income',exact:true}).click();assert.match(await page.evaluate(()=>window.sections[0].content),/Food \| 450/);
 await page.getByRole('tab',{name:'Budget',exact:true}).click();await page.getByRole('gridcell',{name:'B2',exact:true}).click();
 await valueEditor(page).fill('invalid|cell');await page.getByRole('gridcell',{name:'B3',exact:true}).click();
 assert.equal(await valueEditor(page).inputValue(),'invalid|cell');assert.equal(await page.locator('.sheet-address').textContent(),'B2');assert.match(await page.locator('.sheet-status').innerText(),/cannot contain/);
 await valueEditor(page).press('Escape');assert.equal(await valueEditor(page).inputValue(),'1700');
 await page.locator('.sheet-source summary').click();const source=page.getByRole('textbox',{name:'Original sheet source'});await source.fill('| A | B |\n| Unapplied | source |');
 await page.getByRole('tab',{name:'Income',exact:true}).click();assert.equal(await source.inputValue(),'| A | B |\n| Unapplied | source |');assert.equal(await page.getByRole('tab',{name:'Budget',exact:true}).getAttribute('aria-selected'),'true');
 await source.press('Escape');await page.getByRole('tab',{name:'Income',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Income',exact:true}).getAttribute('aria-selected'),'true');
});
