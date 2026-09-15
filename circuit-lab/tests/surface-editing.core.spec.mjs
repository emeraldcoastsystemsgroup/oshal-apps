/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | The assistant-rail case waits for the "Jarvis made 1 change" toast
 *                     |                             | instead of reading it once: it read the toast while the solve's
 *                     |                             | adopt was still fetching waveforms and failed at 0.7.0 too.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B7 on the actual page: reltol, gmin and method set in the
 *                     |                             | run settings are saved with the design and sent with the run,
 *                     |                             | emptied they go back to the defaults, and an out-of-range gmin
 *                     |                             | is refused in a toast naming sim.gmin with the stored value kept.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B2 on the actual page: a board part clicked and turned
 *                     |                             | with R stands upright (stored as rot 90), the board names the
 *                     |                             | short it makes inside one strip and drops the warning once the
 *                     |                             | part turns on; the hidden schematic ignores the key; a jumper is
 *                     |                             | a straight line at its physical span and reads its length in mm;
 *                     |                             | board and schematic still imply the same nets.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B9 on the actual page: a double-click puts a bend on a
 *                     |                             | wire without moving it, a bend drags on the grid, a double-click
 *                     |                             | on a bend removes it and the last one gone restores the
 *                     |                             | automatic path — each saved as the wire's route.points and sent
 *                     |                             | to the engine; R turns a marquee selection a quarter about its
 *                     |                             | centre, four turns are the identity, and a turn that would push
 *                     |                             | a part off the canvas is refused in a toast with nothing moved.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | The assistant rail through the REAL core bridge client: the page
 *                     |                             | hands the client to itself, publishes the open design as a
 *                     |                             | `context` envelope on the bridge channel (surface, recordId, a
 *                     |                             | digest naming the parts, the circuit_action op), and a
 *                     |                             | `circuit_action` delivered as the client's DOM event edits a
 *                     |                             | part through the routes, solves once and toasts.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | The Arduino Blink starter: its sketch edits as multi-line text
 *                     |                             | in the inspector and is saved with its newlines intact.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The Breadboard view: the circuit is laid out with every
 *                     |                             | electrical part on the board, a part dragged to another
 *                     |                             | column keeps the nets, a jumper clicked between two holes
 *                     |                             | adds a schematic wire, and board and schematic imply the
 *                     |                             | same nets throughout.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A marquee on empty canvas selects the parts inside and they
 *                     |                             | move together; a wire re-routes by dragging its middle
 *                     |                             | segment and the route is saved; clicking a wire plots its
 *                     |                             | net's voltage.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Undo / redo over the edits, values on the canvas after a run,
 *                     |                             | and restoring an earlier run from the runs list.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the actual packaged page in headless Chromium over
 *                     |                             | the compiled routes on loopback: an example opens with its
 *                     |                             | parts drawn and its readings read; a part DRAGGED from the
 *                     |                             | palette lands where it was dropped, snapped to the grid, and
 *                     |                             | the design is saved and solved; clicking one pin then another
 *                     |                             | wires them; Delete removes the selected wire; the inspector
 *                     |                             | edits a property and the run count advances; no page errors.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | A setup that fails part-way no longer hangs the suite to its time limit: teardown is null-safe and closes the fake engine it did start. In the Test Lab sandbox a missing catalog file failed setup after the engine was listening, and the open socket held the run for 120 s.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express and playwright. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface-editing.core.spec.mjs
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(fixture.baseUrl + '/api/circuit-lab/app');
  await page.waitForSelector('#palette button', { state: 'attached' });
});
test.after(async () => { await browser?.close(); fixture?.stop(); });

const state = () => page.locator('#design-state').textContent();
const waitRun = (n) => page.waitForFunction((want) => (document.querySelector('#design-state')?.textContent || '').includes('run ' + want), n, { timeout: 15000 });
const partsOnCanvas = () => page.locator('svg#canvas g.part').count();
const design = () => fixture.pool.tables.circuit_design[0];

test('an example opens: parts drawn, wires drawn, readings from the solver', async () => {
  await page.selectOption('#example-select', 'led-switch');
  await page.waitForSelector('table.readings tr');
  assert.equal(await partsOnCanvas(), 5);
  assert.equal(await page.locator('svg#canvas path.wire').count(), 5);
  assert.match(await page.locator('table.readings').innerText(), /D1 \(led\)\s+3\.1 mA · lit/);
  assert.match(await state(), /run 1/);
  assert.equal(fixture.engine.seen[0].cmd, 'simulate');
});

test('a part dragged from the palette lands where it is dropped, snapped, and the design is saved and solved', async () => {
  const canvas = page.locator('svg#canvas');
  const box = await canvas.boundingBox();
  const at = { x: box.width * 0.75, y: box.height * 0.8 };
  // Where that screen point is in the canvas's own frame (the viewBox is letterboxed inside the element).
  const expected = await page.evaluate(({ x, y }) => { const svg = document.querySelector('svg#canvas'); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }; }, { x: box.x + at.x, y: box.y + at.y });
  await page.dragAndDrop('#palette button[data-type="resistor"]', 'svg#canvas', { targetPosition: at });
  await waitRun(2);
  assert.equal(await partsOnCanvas(), 6);
  const added = design().parts.find((p) => p.id === 'R2');
  assert.ok(added, 'the new resistor is R2 (R1 is taken by the example)');
  assert.equal(added.x % 20, 0); assert.equal(added.y % 20, 0);
  assert.ok(Math.abs(added.x - expected.x) <= 20 && Math.abs(added.y - expected.y) <= 20, `landed at ${added.x},${added.y}, expected ${expected.x},${expected.y}`);
  assert.equal(added.props.ohms, 220, 'defaults from the contract');
  assert.match(await page.locator('#selected-name').textContent(), /R2 — Resistor/);
  const last = fixture.engine.seen[fixture.engine.seen.length - 1];
  assert.equal(last.args.circuit.parts.length, 6);
  await page.waitForFunction(() => /R2 is not connected/.test(document.querySelector('#warnings')?.textContent || ''), null, { timeout: 5000 });
});

test('click pin → pin wires two parts; Delete removes the selected wire', async () => {
  const pin = (partIndex, pinIndex) => page.locator('svg#canvas g.part').nth(partIndex).locator('circle.pin').nth(pinIndex);
  const r2 = design().parts.findIndex((p) => p.id === 'R2');
  const b1 = design().parts.findIndex((p) => p.id === 'B1');
  await pin(r2, 0).dispatchEvent('pointerdown');
  await pin(b1, 0).dispatchEvent('pointerdown');
  await waitRun(3);
  const wire = design().wires.find((w) => (w.from.part === 'R2' && w.to.part === 'B1') || (w.from.part === 'B1' && w.to.part === 'R2'));
  assert.ok(wire, 'a wire joins R2 and B1');
  assert.equal(await page.locator('svg#canvas path.wire').count(), 6);
  await page.locator('svg#canvas path.wire-hit').last().dispatchEvent('pointerdown');
  assert.match(await page.locator('#selected-name').textContent(), new RegExp('wire ' + wire.id));
  await page.keyboard.press('Delete');
  await waitRun(4);
  assert.equal(design().wires.length, 5);
  assert.equal(await page.locator('svg#canvas path.wire').count(), 5);
});

test('undo and redo walk the local edits; values on the canvas follow the run; restore puts an earlier run back', async () => {
  const partsBefore = design().parts.length;
  await page.keyboard.press('Control+z');
  await waitRun(5);
  assert.equal(design().wires.length, 6, 'undo put the deleted wire back');
  await page.keyboard.press('Control+y');
  await waitRun(6);
  assert.equal(design().wires.length, 5, 'redo removed it again');
  assert.equal(design().parts.length, partsBefore);
  await page.check('#show-values');
  await page.waitForFunction(() => document.querySelectorAll('svg#canvas text.wireval').length > 0);
  assert.ok((await page.locator('svg#canvas text.wireval').allTextContents()).some((t) => /V$/.test(t)), 'a net voltage is written on a wire');
  await page.uncheck('#show-values');
  await page.locator('#runs li:has(span:text-is("run 1")) button:text-is("restore")').click();
  await waitRun(7);
  assert.equal(design().parts.length, 5, 'run 1 had the example\'s five parts');
  assert.equal(await partsOnCanvas(), 5);
});

test('the inspector edits a property and the run count advances; the page raised no errors', async () => {
  await page.dragAndDrop('#palette button[data-type="resistor"]', 'svg#canvas', { targetPosition: { x: 300, y: 300 } });
  await waitRun(8);
  const r2 = design().parts.findIndex((p) => p.id === 'R2');
  await page.locator('svg#canvas g.part').nth(r2).dispatchEvent('pointerdown');
  await page.locator('svg#canvas').dispatchEvent('pointerup');
  await page.fill('#prop-ohms', '4700');
  await page.click('#apply-props');
  await waitRun(9);
  assert.equal(design().parts.find((p) => p.id === 'R2').props.ohms, 4700);
  assert.match(await page.locator('svg#canvas g.part').nth(r2).locator('text.value').textContent(), /4\.7kΩ/);
  assert.deepEqual(errors, []);
});

/** Screen coordinates of a canvas (world) point, through the SVG's own CTM. */
const screenOf = (x, y) => page.evaluate(({ x, y }) => { const svg = document.querySelector('svg#canvas'); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const s = pt.matrixTransform(svg.getScreenCTM()); return { clientX: s.x, clientY: s.y }; }, { x, y });
const pointer = async (locator, type, world) => locator.dispatchEvent(type, Object.assign({ button: 0, pointerId: 1, isPrimary: true, bubbles: true }, await screenOf(world[0], world[1])));

test('a marquee on empty canvas selects the parts inside; dragging one moves them together', async () => {
  const svg = page.locator('svg#canvas');
  const before = design().parts.map((p) => [p.id, p.x, p.y]);
  await pointer(svg, 'pointerdown', [200, 40]);
  await pointer(svg, 'pointermove', [480, 160]);
  await pointer(svg, 'pointerup', [480, 160]);
  assert.deepEqual((await page.locator('svg#canvas g.part.selected text').allTextContents()).filter((t) => /^(S1|R1)$/.test(t)), ['S1', 'R1'], 'the switch and the resistor sit inside the band');
  assert.equal(await page.locator('svg#canvas g.part.selected').count(), 2);
  assert.match(await page.locator('#selected-name').textContent(), /2 parts/);
  const s1 = design().parts.findIndex((p) => p.id === 'S1');
  await pointer(page.locator('svg#canvas g.part').nth(s1), 'pointerdown', [260, 100]);
  await pointer(svg, 'pointermove', [300, 160]);
  await pointer(svg, 'pointerup', [300, 160]);
  await waitRun(10);
  const after = Object.fromEntries(design().parts.map((p) => [p.id, [p.x, p.y]]));
  assert.deepEqual(after.S1, [300, 160]); assert.deepEqual(after.R1, [460, 160], 'the other selected part moved by the same 40, 60');
  for (const [id, x, y] of before) if (id !== 'S1' && id !== 'R1') assert.deepEqual(after[id], [x, y], id + ' stayed');
});

test('a wire re-routes by dragging its middle segment and the route is saved with the design', async () => {
  const svg = page.locator('svg#canvas');
  const grab = page.locator('svg#canvas path.wire-mid[data-wire="w1"]');
  assert.equal(await grab.count(), 1, 'w1 (B1.+ to S1.a) has a draggable middle segment');
  await pointer(grab, 'pointerdown', [185, 165]);
  await pointer(svg, 'pointermove', [140, 165]);
  await pointer(svg, 'pointerup', [140, 165]);
  await waitRun(11);
  const w1 = design().wires.find((w) => w.id === 'w1');
  assert.deepEqual(w1.route, { mid: 140 });
  assert.match(await page.locator('svg#canvas path.wire').first().getAttribute('d'), /L140 /, 'the drawn wire bends at x = 140');
  assert.equal(fixture.engine.seen[fixture.engine.seen.length - 1].args.circuit.wires.find((w) => w.id === 'w1').route.mid, 140, 'the route rides along to the engine, which ignores it');
});

test('the breadboard view lays the circuit out; a dragged part keeps the nets; a jumper adds a schematic wire', async () => {
  const board = page.locator('svg#board');
  const boardScreen = (hole) => page.evaluate((h) => { const B = window.CircuitLabBoard, M = window.CircuitLabBoardModel; const p = M.parseHole(h); const svg = document.querySelector('svg#board'); const pt = svg.createSVGPoint(); pt.x = B.X0 + (p.col - 1) * B.PITCH; pt.y = B.ROW_Y[p.row]; const s = pt.matrixTransform(svg.getScreenCTM()); return { clientX: s.x, clientY: s.y }; }, hole);
  const at = async (locator, type, hole) => locator.dispatchEvent(type, Object.assign({ button: 0, pointerId: 1, isPrimary: true, bubbles: true }, await boardScreen(hole)));
  await page.click('#view-board');
  await page.waitForFunction(() => document.querySelectorAll('svg#board g.bpart').length === 6, null, { timeout: 15000 });
  assert.equal(await board.isVisible(), true); assert.equal(await page.locator('svg#canvas').isVisible(), false);
  const d0 = JSON.parse(JSON.stringify(design()));  // a snapshot: the fake pool mutates the row in place
  assert.deepEqual(Object.keys(d0.board.placements).sort(), ['B1', 'D1', 'GND', 'R1', 'R2', 'S1']);
  assert.equal(await page.locator('svg#board path.jumper').count(), d0.board.jumpers.length);
  const nets = await page.evaluate(async () => { const M = window.CircuitLabBoardModel; const caps = await (await fetch('/api/circuit-lab/capabilities')).json(); const out = await (await fetch(location.pathname.replace(/\/app$/, '') + '/designs')).json(); const d = out.designs[0]; return M.sameNets(M.wireNets(d.parts, d.wires, caps.contract), M.boardNets(d.board, d.parts, caps.contract)); });
  assert.equal(nets, true, 'the board implies the schematic nets after layout');
  const r2 = d0.board.placements.R2, anchor = r2.row + r2.col;
  await at(page.locator('svg#board g.bpart[data-part="R2"]'), 'pointerdown', anchor);
  await at(board, 'pointermove', 'b50');
  await at(board, 'pointerup', 'b50');
  await waitRun(12);
  await page.waitForFunction(() => document.querySelectorAll('#runs li').length >= 12, null, { timeout: 15000 });  // the board re-renders once more after the save settles
  assert.deepEqual(design().board.placements.R2, { col: 50, row: 'b' });
  assert.equal(design().wires.length, d0.wires.length, 'moving an unwired part changes no wire');
  const b1 = design().board.placements.B1;
  await page.locator('svg#board circle.hole[data-hole="a50"]').dispatchEvent('pointerdown');
  await page.locator(`svg#board circle.hole[data-hole="a${b1.col}"]`).dispatchEvent('pointerdown');
  await waitRun(13);
  assert.equal(design().wires.length, d0.wires.length + 1, 'the jumper became a schematic wire');
  assert.ok(design().wires.some((w) => [w.from.part, w.to.part].sort().join() === 'B1,R2'), 'joining R2.a to the battery + strip');
  assert.equal(design().board.jumpers.length, d0.board.jumpers.length + 1);
  const netsAfter = await page.evaluate(async () => { const M = window.CircuitLabBoardModel; const caps = await (await fetch('/api/circuit-lab/capabilities')).json(); const out = await (await fetch('/api/circuit-lab/designs')).json(); const d = out.designs[0]; return M.sameNets(M.wireNets(d.parts, d.wires, caps.contract), M.boardNets(d.board, d.parts, caps.contract)); });
  assert.equal(netsAfter, true, 'board and schematic still imply the same nets');
  await page.click('#view-schematic');
  assert.equal(await page.locator('svg#canvas path.wire').count(), d0.wires.length + 1, 'the schematic shows the new wire');
});

test('clicking a wire plots its net; the page raised no errors', async () => {
  const picked = () => page.locator('#signals label').evaluateAll((labels) => labels.filter((l) => l.querySelector('input').checked).map((l) => l.textContent.trim()));
  // an earlier case clicked a wire to delete it, which already plotted its net: untick it first
  const box = page.locator('#signals label', { hasText: 'v(n1)' }).locator('input');
  if (await box.isChecked()) await box.uncheck();
  assert.ok(!(await picked()).includes('v(n1)'), 'the net is not plotted before the click');
  await page.locator('svg#canvas path.wire-hit').first().dispatchEvent('pointerdown');
  assert.match(await page.locator('#selected-name').textContent(), /wire w1/);
  assert.ok((await picked()).includes('v(n1)'), 'the clicked wire\'s net voltage joined the plots');
  assert.ok((await page.locator('#plots canvas').count()) >= 1);
  assert.deepEqual(errors, []);
});

test('an Arduino sketch edits as multi-line text in the inspector and is saved intact; no page errors', async () => {
  await page.selectOption('#example-select', 'arduino-blink');
  await page.waitForFunction(() => /Arduino Blink/.test(document.querySelector('#design-heading')?.textContent || ''), null, { timeout: 15000 });
  await page.waitForFunction(() => /MCU1 \(arduino\)/.test(document.querySelector('#readings')?.textContent || ''), null, { timeout: 15000 });
  const blink = () => fixture.pool.tables.circuit_design.find((d) => d.title === 'Arduino Blink');
  const mcu = blink().parts.findIndex((p) => p.id === 'MCU1');
  await page.locator('svg#canvas g.part').nth(mcu).dispatchEvent('pointerdown');
  await page.locator('svg#canvas').dispatchEvent('pointerup');
  const sketch = page.locator('textarea#prop-sketch');
  assert.match(await sketch.inputValue(), /digitalWrite\(13, HIGH\);\n  delay\(500\);/, 'the sketch arrives with its newlines');
  await sketch.fill((await sketch.inputValue()).replace(/delay\(500\)/g, 'delay(250)'));
  await page.click('#apply-props');
  await page.waitForFunction(() => /run 2/.test(document.querySelector('#design-state')?.textContent || ''), null, { timeout: 15000 });
  assert.match(blink().parts.find((p) => p.id === 'MCU1').props.sketch, /delay\(250\);\n  digitalWrite\(13, LOW\);\n  delay\(250\);\n}\n$/, 'saved intact, every newline kept');
  assert.match(await page.locator('table.readings').innerText(), /MCU1 \(arduino\)\s+compiled \(924 bytes\)/);
  assert.deepEqual(errors, []);
});

test('the assistant rail: the real bridge client attaches, the open design is published as context, and a circuit_action edits through the routes; no page errors', async () => {
  // The client posts to window.parent; the page is top-level here, so its envelopes arrive on its own window.
  await page.evaluate(() => { window.__envelopes = []; window.addEventListener('message', (e) => window.__envelopes.push(e.data)); });
  assert.equal(await page.evaluate(() => !!window.__bridge), true, 'the module client loaded and handed itself to the page');
  await page.evaluate(() => window.CircuitLabAssistant.publishContext());
  const ctx = await page.evaluate(() => window.__envelopes.filter((m) => m && m.channel === 'oshal-surface-bridge' && m.op === 'context').pop());
  assert.ok(ctx, 'a context envelope on the bridge channel');
  assert.equal(ctx.app, 'circuit-lab');
  assert.equal(ctx.surface, 'schematic');
  assert.equal(ctx.title, 'Arduino Blink');
  const blink = () => fixture.pool.tables.circuit_design.find((d) => d.title === 'Arduino Blink');
  assert.equal(ctx.recordId, String(blink().design_id));
  assert.match(ctx.digest, /^Arduino Blink: 4 parts, 4 wires, solved \(run 2\)/);
  assert.match(ctx.digest, /MCU1 arduino sketch \d+ lines/, 'a sketch is summarised as its line count, never its text');
  assert.ok(ctx.digest.length <= 4000);
  assert.deepEqual(ctx.can, ['custom', 'notify']);
  assert.equal(ctx.customOps[0].name, 'circuit_action');
  assert.ok(ctx.customOps[0].description.length <= 600);
  // Inbound: the client re-dispatches a custom op as this DOM event; the page applies it through the routes.
  const resistor = blink().parts.find((p) => p.type === 'resistor');
  await page.evaluate((id) => document.dispatchEvent(new CustomEvent('surface-bridge:custom', { detail: { name: 'circuit_action', data: { actions: [{ op: 'update_part', id, props: { ohms: 330 } }] } } })), resistor.id);
  await waitRun(3);
  assert.equal(blink().parts.find((p) => p.id === resistor.id).props.ohms, 330, 'the edit landed through the routes');
  // the toast follows the solve's adopt, which renders 'run 3' before its waveform fetch returns: wait for it, do not read it once
  await page.waitForFunction(() => /Jarvis made 1 change/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 5000 });
  const after = await page.evaluate(() => window.__envelopes.filter((m) => m && m.op === 'context').pop());
  assert.match(after.digest, /solved \(run 3\)/, 'the context is republished after the edit');
  // A `request_context` republishes without changing anything.
  const count = await page.evaluate(() => window.__envelopes.filter((m) => m && m.op === 'context').length);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('surface-bridge:custom', { detail: { name: 'request_context', data: {} } })));
  assert.equal(await page.evaluate(() => window.__envelopes.filter((m) => m && m.op === 'context').length), count + 1);
  assert.match(await state(), /run 3/);
  assert.deepEqual(errors, []);
});

// ── BACKLOG B9: several bends per wire; a multi-selection turns about its centre ──────────────
const latest = () => fixture.pool.tables.circuit_design[fixture.pool.tables.circuit_design.length - 1];
/** Poll a node-side condition (the fake pool is updated by the routes, not the page). */
async function until(check, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await check()) return; } catch (_) { /* not yet */ }
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const routeOf = (id) => JSON.stringify((latest().wires.find((w) => w.id === id) || {}).route || null);
const wireD = (i) => page.locator('svg#canvas path.wire').nth(i).getAttribute('d');

test('a wire takes several bends: a double-click places one without moving the wire, a bend drags on the grid, a double-click removes it; saved as route.points', async () => {
  const before = fixture.pool.tables.circuit_design.length;
  await page.selectOption('#example-select', 'led-switch');
  await until(() => fixture.pool.tables.circuit_design.length === before + 1 && latest().run_count === 1, 'a fresh Switched LED, solved');
  await page.waitForFunction(() => document.querySelector('#design-state')?.textContent === 'run 1', null, { timeout: 15000 });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const svg = page.locator('svg#canvas');
  assert.equal(await wireD(0), 'M100 170 L165 170 L165 100 L230 100', 'w1 (B1.+ to S1.a) starts on its automatic path');
  await pointer(svg, 'dblclick', [131, 172]);
  await until(() => routeOf('w1') === JSON.stringify({ points: [[140, 170], [165, 170], [165, 100]] }), 'the first bend saved with the drawn corners');
  assert.equal(await wireD(0), 'M100 170 L140 170 L165 170 L165 100 L230 100', 'placing the bend did not move the wire');
  assert.equal(await page.locator('svg#canvas circle.wire-bend[data-wire="w1"]').count(), 3);
  await pointer(page.locator('svg#canvas circle.wire-bend[data-wire="w1"][data-index="0"]'), 'pointerdown', [140, 170]);
  await pointer(svg, 'pointermove', [143, 236]);
  await pointer(svg, 'pointerup', [143, 236]);
  await until(() => routeOf('w1') === JSON.stringify({ points: [[140, 240], [165, 170], [165, 100]] }), 'the dragged bend saved on the grid');
  await pointer(svg, 'dblclick', [165, 102]);
  await until(() => routeOf('w1') === JSON.stringify({ points: [[140, 240], [165, 170]] }), 'the bend at (165, 100) removed');
  assert.equal(await wireD(0), 'M100 170 L140 240 L165 170 L230 100');
  const sent = fixture.engine.seen[fixture.engine.seen.length - 1].args.circuit.wires.find((w) => w.id === 'w1');
  assert.deepEqual(sent.route, { points: [[140, 240], [165, 170]] }, 'the route rides to the engine, which ignores it');
  await page.locator('svg#canvas path.wire-hit').first().dispatchEvent('pointerdown');
  assert.match(await page.locator('#pin-list').textContent(), /2 bends/);
  await pointer(svg, 'dblclick', [140, 240]);
  await pointer(svg, 'dblclick', [165, 170]);
  await until(() => routeOf('w1') === 'null', 'the last bend gone leaves no route');
  assert.equal(await wireD(0), 'M100 170 L165 170 L165 100 L230 100', 'the automatic path is back');
  assert.deepEqual(errors, []);
});

test('R turns a marquee selection a quarter about its centre and four turns are the identity; a turn off the canvas is refused with nothing moved', async () => {
  const svg = page.locator('svg#canvas');
  const at = () => Object.fromEntries(latest().parts.map((p) => [p.id, [p.x, p.y, p.rotation]]));
  const start = at();
  await pointer(svg, 'pointerdown', [200, 40]);
  await pointer(svg, 'pointermove', [480, 160]);
  await pointer(svg, 'pointerup', [480, 160]);
  assert.match(await page.locator('#selected-name').textContent(), /2 parts/);
  assert.equal(await page.locator('#rotate-part').isVisible(), true, 'a multi-selection offers Rotate');
  await page.keyboard.press('r');
  await until(() => { const p = at(); return p.S1.join() === '340,20,90' && p.R1.join() === '340,180,90'; }, 'S1 and R1 turned about (340, 100)');
  for (const id of ['B1', 'D1', 'GND']) assert.deepEqual(at()[id], start[id], id + ' stayed');
  assert.equal(await wireD(1), 'M340 50 L340 100 L340 100 L340 150', 'w2 now runs down between the turned pins');
  await page.click('#rotate-part'); await page.keyboard.press('r'); await page.keyboard.press('r');
  await until(() => JSON.stringify(at()) === JSON.stringify(start), 'four quarter turns put the group back');
  await page.evaluate(() => window.CircuitLabCanvas.selectParts(['B1', 'R1']));
  await page.keyboard.press('r');
  await page.waitForFunction(() => /would move B1 off the canvas/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 700));  // past the autosave debounce: nothing may have been saved
  assert.deepEqual(at(), start, 'the refused turn moved nothing');
  assert.deepEqual(errors, []);
});

// ── BACKLOG B2: a part turns on the breadboard; a jumper is drawn at its physical length ──────
test('on the breadboard a clicked part turns upright with R, a short inside one strip is named, the schematic ignores the key, and a jumper reads its span in mm', async () => {
  const svg = page.locator('svg#canvas'), board = page.locator('svg#board');
  const holeScreen = (hole) => page.evaluate((h) => { const B = window.CircuitLabBoard, M = window.CircuitLabBoardModel; const p = M.parseHole(h); const el = document.querySelector('svg#board'); const pt = el.createSVGPoint(); pt.x = B.X0 + (p.col - 1) * B.PITCH; pt.y = B.ROW_Y[p.row]; const q = pt.matrixTransform(el.getScreenCTM()); return { clientX: q.x, clientY: q.y }; }, hole);
  const onHole = async (locator, type, hole) => locator.dispatchEvent(type, Object.assign({ button: 0, pointerId: 1, isPrimary: true, bubbles: true }, await holeScreen(hole)));
  // a schematic selection that must NOT turn while the board has the keys
  await pointer(svg, 'pointerdown', [200, 40]); await pointer(svg, 'pointermove', [480, 160]); await pointer(svg, 'pointerup', [480, 160]);
  const schematic = () => Object.fromEntries(latest().parts.map((p) => [p.id, [p.x, p.y, p.rotation]]));
  const before = schematic();
  await page.click('#view-board');
  await page.waitForFunction(() => document.querySelectorAll('svg#board g.bpart').length === 5, null, { timeout: 15000 });
  await until(() => latest().board && latest().board.placements.R1, 'the board laid out');
  // nothing is selected on the board: R and Delete must not reach the hidden schematic's S1 / R1 selection
  // (the board sends nothing back here, so nothing would put a turned or deleted schematic right again)
  const canvasParts = () => page.evaluate(() => JSON.stringify(window.CircuitLabCanvas.circuit().parts.map((p) => [p.id, p.x, p.y, p.rotation])));
  const canvasBefore = await canvasParts();
  await page.keyboard.press('r'); await page.keyboard.press('Delete');
  await new Promise((r) => setTimeout(r, 700));  // past the autosave debounce
  assert.equal(await canvasParts(), canvasBefore, 'the hidden schematic took neither key');
  assert.deepEqual(schematic(), before, 'and nothing was saved');
  const r1 = latest().board.placements.R1, anchor = r1.row + r1.col;
  await onHole(page.locator('svg#board g.bpart[data-part="R1"]'), 'pointerdown', anchor);
  await onHole(board, 'pointerup', anchor);
  assert.equal(await page.locator('svg#board g.bpart.selected').getAttribute('data-part'), 'R1', 'a click without a drag selects the part');
  await page.keyboard.press('r');
  await until(() => latest().board.placements.R1.rot === 90, 'R1 stored upright');
  const strip = (r1.row <= 'e' ? 't' : 'b') + r1.col;
  await page.waitForFunction((want) => (document.querySelector('svg#board text.bwarn')?.textContent || '').includes(want), `R1 is shorted: a and b share strip ${strip}`, { timeout: 15000 });
  const legs = await page.locator('svg#board g.bpart[data-part="R1"] circle.leg').evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))));
  assert.equal(new Set(legs).size, 1, 'upright: both legs in one column');
  await page.keyboard.press('r');
  await until(() => latest().board.placements.R1.rot === 180, 'R1 turned on to 180');
  await page.waitForFunction(() => !/shorted/.test(document.querySelector('svg#board text.bwarn')?.textContent || ''), null, { timeout: 15000 });
  const j = latest().board.jumpers[0];
  await page.locator(`svg#board path.jumper[data-jumper="${j.id}"]`).dispatchEvent('pointerdown');
  const d = await page.locator(`svg#board path.jumper[data-jumper="${j.id}"]`).getAttribute('d');
  assert.match(d, /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/, 'a jumper is one straight run, not an arc');
  const want = await page.evaluate((jj) => window.CircuitLabBoardModel.jumperLengthMm(jj.from, jj.to), j);
  const [x1, y1, x2, y2] = d.slice(1).split(/[ L]+/).map(Number);
  assert.ok(Math.abs(Math.hypot(x2 - x1, y2 - y1) - (want / 2.54) * 14) < 0.01, 'drawn at its physical span: 14 px per 0.1 inch');
  assert.equal(await page.locator('svg#board text.jlen').textContent(), want.toFixed(1) + ' mm', 'the selected jumper reads its length');
  assert.match(await page.locator('svg#board text.bsum').textContent(), /^\d+ jumpers · [\d.]+ mm of wire · longest [\d.]+ mm$/);
  const agree = await page.evaluate(async () => { const M2 = window.CircuitLabBoardModel; const caps = await (await fetch('/api/circuit-lab/capabilities')).json(); const out = await (await fetch('/api/circuit-lab/designs')).json(); const dd = out.designs.find((x) => x.board && x.board.placements.R1 && x.board.placements.R1.rot === 180); return !!dd && M2.sameNets(M2.wireNets(dd.parts, dd.wires, caps.contract), M2.boardNets(dd.board, dd.parts, caps.contract)); });
  assert.equal(agree, true, 'board and schematic imply the same nets after the turns');
  await page.click('#view-schematic');
  assert.deepEqual(errors, []);
});

// ── BACKLOG B7: the solver knobs in the run settings ──────────────────────────────────────────
test('the solver knobs are saved with the design and sent with the run; emptied they are the defaults again; an out-of-range one is refused naming the field', async () => {
  const setNum = async (id, value) => { await page.fill('#' + id, value); await page.locator('#' + id).dispatchEvent('change'); };
  await setNum('sim-reltol', '0.01');
  await until(() => latest().sim.reltol === 0.01, 'reltol saved');
  await setNum('sim-gmin', '1e-9');
  await until(() => latest().sim.gmin === 1e-9, 'gmin saved');
  await page.selectOption('#sim-method', 'gear');
  await until(() => latest().sim.method === 'gear', 'method saved');
  const runs = latest().run_count;
  await page.click('#run');
  await until(() => latest().run_count === runs + 1, 'the run');
  const sent = fixture.engine.seen[fixture.engine.seen.length - 1].args.sim;
  assert.deepEqual([sent.reltol, sent.gmin, sent.method], [0.01, 1e-9, 'gear'], 'the engine got the knobs the person chose');
  await setNum('sim-reltol', '');
  await page.selectOption('#sim-method', '');
  await until(() => !('reltol' in latest().sim) && !('method' in latest().sim), 'emptied knobs are gone from the stored settings');
  assert.equal(latest().sim.gmin, 1e-9, 'the knob left alone is kept');
  assert.deepEqual(errors, []);
  await setNum('sim-gmin', '0.5');
  await page.waitForFunction(() => /\[sim\.gmin\]/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 5000 });
  assert.equal(latest().sim.gmin, 1e-9, 'the refused value was not stored');
  // the refusal is a real 400, which Chromium logs to the console; that one line is expected, nothing else
  assert.deepEqual(errors.splice(0), ['console: Failed to load resource: the server responded with a status of 400 (Bad Request)']);
});
