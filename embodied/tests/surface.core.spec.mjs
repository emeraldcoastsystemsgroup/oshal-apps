/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The tile in a real headless browser over the real routes: it renders the unknown world, both simulated cameras and the drone design; "Explore the room" (drone first) drafts, rehearses, executes through the confirm dialog and runs to done with surfaces discovered, the drone tracking and the log filled; Take command lets a person scan and fly by hand and every command lands in the log; Reset world switches the drone to the printed sensor set; "Open in CAD Studio" posts exactly the part program the routes publish and lands on the CAD Studio tile. FRAMEWORK-COUPLED: needs a core checkout (OSHAL_CORE_DIR) for express, tsx and Playwright. Run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface.core.spec.mjs
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B20: the tile lists the node that heartbeat in as a truth model, a Reset world onto it runs the plant on the rail node and the node panel says so.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B4: the Room selector lists the scenes, a reset onto the studio is confirmed by name and the selector follows the active scene.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm in the Build panel: its joints and parts render, and Check on physics puts the container's measured hold in the row.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1, the operator's own acceptance case in a real browser: choose a medium, drop the explorer hull. In AIR the fall is drawn and the numbers are the analytic free fall; in SEAWATER the tile shows the REFUSAL by its own name instead of a plausible float.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture, launchIsolatedBrowser, fastPolling } from './surface.core.fixture.mjs';

let owned; let browser; let context; let page; let f; const dialogs = [];
before(async () => { owned = await launchIsolatedBrowser(); browser = owned.browser; });
after(async () => { await browser.close(); await owned.close(); });
beforeEach(async () => {
  f = await startFixture();
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort()));
  page = await context.newPage();
  dialogs.length = 0;
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
  await page.addInitScript(fastPolling);
  await page.goto(f.origin + '/api/embodied/app');
  await page.locator('#build-parts tbody tr').first().waitFor({ timeout: 15000 });
});
afterEach(async () => { await context.close(); await f.close(); });

const text = (sel) => page.locator(sel).textContent();
/** Distinct colours on a canvas — a drawn view, not a blank one. */
const coloursOn = (id) => page.evaluate((cid) => {
  const c = document.getElementById(cid); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set();
  for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
}, id);
/** The canvas contents as packed RGB bytes, the shape the picture route serves. */
const canvasRgb = (id) => page.evaluate((cid) => {
  const c = document.getElementById(cid); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const out = [];
  for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
  return out;
}, id);
const logLines = () => page.locator('#log li').allTextContents();
/** On a failure, say what the server and the tile believed — a bare timeout explains nothing. */
async function diagnose(step) {
  try { await step(); } catch (error) {
    const ctl = (await (await fetch(f.origin + '/api/embodied/state')).json()).control;
    const tile = { mode: await text('#mode'), holder: await text('#holder'), toast: await page.locator('.toast').textContent().catch(() => null) };
    throw new Error(`${error.message}
server control ${JSON.stringify(ctl)}
tile ${JSON.stringify(tile)}
log ${f.pool.log.map((l) => `${l.command}:${l.outcome}${l.reason ? '(' + l.reason + ')' : ''}`).join(' | ')}`);
  }
}

test('the tile renders the unknown world, both simulated cameras and the drone design from the shipped HTML and JS', async () => {
  assert.equal(await page.title(), 'Embodied Swarm');
  assert.match(await text('#world-stats'), /No scans yet/);
  const drone = await text('#drone');
  assert.match(drone, /sensors\s*recon-3d/); assert.match(drone, /localisation\s*anchored/);
  await page.locator('#cap-drone').filter({ hasText: 'SIMULATED' }).waitFor({ timeout: 10000 });
  assert.match(await text('#cap-wrist'), /wrist camera · \d+ returns .* SIMULATED/);
  assert.ok((await coloursOn('view3d')) > 8, 'the 3-D view drew the nodes and the frame, not a blank canvas');
  for (const sensor of ['drone', 'wrist']) {
    const pic = await (await fetch(`${f.origin}/api/embodied/picture?sensor=${sensor}`)).json();
    const shown = Buffer.from(await canvasRgb(`pic-${sensor}`));
    assert.equal(Buffer.compare(shown, Buffer.from(pic.rgb, 'base64')), 0, `the ${sensor} picture on the tile is the route's picture, pixel for pixel`);
  }
  const summary = await text('#build-summary');
  assert.match(summary, /Recon-mini/); assert.match(summary, /Wheelbase 260 mm/); assert.match(summary, /All-up 746 g/);
  assert.equal(await page.locator('#build-parts tbody tr').count(), (await f.design('recon-mini')).parts.length, 'one row per printed part');
  assert.match(await text('#build-bought'), /LD19/);
  assert.equal(await page.locator('#build-md').getAttribute('href'), '/api/embodied/build/drone/design.md?fit=recon-mini');
});

test('Explore the room (drone first) runs through the confirm to done: surfaces discovered, the drone tracking, every step in the log', async () => {
  await page.fill('#max-scans', '4');
  await page.check('#drone-first');
  await page.click('#explore');
  assert.equal(dialogs.length, 1); assert.match(dialogs[0], /drone first/);
  await page.locator('#rehearsal').filter({ hasText: 'Rehearsal OK' }).waitFor({ timeout: 30000 });
  await page.locator('#task-summary').filter({ hasText: /Explore/ }).waitFor();
  await page.locator('#world-stats').filter({ hasText: /% of the room known after \d+ scan/ }).waitFor({ timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('mode').textContent === 'idle' && document.getElementById('holder').textContent === '', null, { timeout: 120000 });
  assert.equal(await text('#holder'), '', 'no failure text: the plan ended done');
  assert.ok((await page.locator('#surfaces tbody tr').count()) >= 1, 'at least the floor is a discovered surface');
  const drone = await text('#drone');
  assert.match(drone, /localisation\s*(tracking|anchored) · [1-9]\d* registration/);
  assert.match(drone, /mode\s*landed/);
  await page.waitForFunction(() => [...document.querySelectorAll('#log li')].some((li) => /drone\.scan .* completed/.test(li.textContent)), null, { timeout: 10000 });
  const lines = await logLines();
  assert.ok(lines.some((l) => /plan\.execute .* accepted/.test(l)), 'the execute is logged');
  assert.ok(lines.some((l) => /drone\.register .* completed/.test(l)), 'the registration sweeps are logged as their own rows');
  assert.ok(lines.every((l) => !/rover\.scan/.test(l)), 'drone first: the rover never scanned');
  assert.equal(await page.locator('#steps li').count(), f.pool.tasks[0].plan.steps.length, 'the step list is the stored plan');
  assert.equal(f.pool.tasks[0].status, 'done');
  assert.ok((await coloursOn('view3d')) > 30, 'the mapped voxels colour the view');
});

test('Take command: a person scans and flies by hand, every command lands in the log, release hands it back', async () => {
  await page.click('#take');
  await page.locator('#mode').filter({ hasText: 'manual' }).waitFor();
  assert.equal(await page.locator('#release').isHidden(), false);
  await page.click('button.jog[data-sensor="drone"]');
  await page.locator('.toast').filter({ hasText: 'drone scan integrated' }).waitFor({ timeout: 10000 });
  await page.locator('#world-stats').filter({ hasText: /after 1 scan/ }).waitFor({ timeout: 10000 });
  await diagnose(async () => { await page.click('button.jog[data-drone="takeoff"]', { timeout: 10000 }); });
  await page.locator('#drone').filter({ hasText: /mode\s*(takeoff|hover)/ }).waitFor({ timeout: 10000 });
  await page.click('button.jog[data-drone="land"]');
  await page.locator('#drone').filter({ hasText: /mode\s*landed/ }).waitFor({ timeout: 30000 });
  await page.click('button.jog[data-cmd="grasp"]');
  await page.locator('.toast').filter({ hasText: /Refused/ }).waitFor({ timeout: 10000 });
  await page.click('#release');
  await page.locator('#mode').filter({ hasText: 'idle' }).waitFor();
  assert.ok(await page.locator('button.jog[data-drone="takeoff"]').isDisabled(), 'outside command the manual buttons are disabled');
  await page.waitForFunction(() => [...document.querySelectorAll('#log li')].some((li) => /control\.release/.test(li.textContent)), null, { timeout: 10000 });
  const lines = await logLines();
  for (const want of [/control\.take ← roger-browser · accepted/, /takeoff ← roger-browser · accepted/, /land ← roger-browser · accepted/, /grasp ← roger-browser · refused · /, /control\.release ← roger-browser · accepted/]) assert.ok(lines.some((l) => want.test(l)), `log has ${want}`);
});

test('Reset world switches the drone to the printed sensor set; Open in CAD Studio posts the exact part program and lands on the CAD Studio tile', async () => {
  await page.locator('#physics-status').filter({ hasText: /physics engine: not reachable .* install: docker exec .* rail: tile-plant online/ }).waitFor({ timeout: 10000 });
  assert.deepEqual(await page.locator('#backend option').allTextContents(), ['kinematic truth', 'physics (MuJoCo)', 'rail node tile-plant (fake 0)']);
  assert.deepEqual(await page.locator('#scenario option').allTextContents(), ['Kitchen', 'Studio']);
  // B4: the Room selector starts the world from another hidden scene; the selector follows the active scene after the reset.
  await page.selectOption('#scenario', 'studio');
  await page.click('#reset-world');
  assert.match(dialogs.at(-1), /simulated studio world/);
  await page.locator('#drone').filter({ hasText: /truth model\s*kinematic/ }).waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('scenario').value === 'studio', null, { timeout: 10000 });
  await page.selectOption('#scenario', 'kitchen');
  // The node on the rail flies the world from the tile: choose it, Reset world, and the node panel names who flies the plant.
  await page.selectOption('#backend', 'node:tile-plant');
  await page.click('#reset-world');
  assert.match(dialogs.at(-1), /physics of rail node tile-plant/);
  await page.locator('#drone').filter({ hasText: /truth model\s*physics on rail node tile-plant: fake 0, seed 0, flown by pid/ }).waitFor({ timeout: 10000 });
  await page.selectOption('#backend', 'kinematic');
  await page.selectOption('#sensor-set', 'recon-mini');
  await page.click('#reset-world');
  assert.match(dialogs.at(-1), /2-D ring \+ ToF/); assert.match(dialogs.at(-1), /kinematic truth model/);
  await page.locator('#drone').filter({ hasText: /truth model\s*kinematic/ }).waitFor({ timeout: 10000 });
  // The Policies panel lists the container's reports with both scores; Certify on an unexplored world is refused and says why.
  await page.locator('#policies tbody tr').first().waitFor({ timeout: 10000 });
  const row = await page.locator('#policies tbody tr').first().allTextContents();
  assert.match(row[0], /hover-leg-residual-seed0\.json.*residual.*200000.*1\.0 cm \/ 1\.5 cm.*0\.8 cm \/ 1\.2 cm.*yes.*not run/s);
  assert.deepEqual(await page.locator('#controller option').allTextContents(), ['flown by PID'], 'no policy is offered before it is certified');
  await page.locator('#policies tbody tr').first().getByRole('button', { name: 'Certify' }).click();
  await page.locator('.toast').filter({ hasText: /Refused at 2 of 2 points .* unknown/ }).waitFor({ timeout: 10000 });
  await page.locator('#policies tbody tr').first().filter({ hasText: /refused 2/ }).waitFor({ timeout: 10000 });
  await page.locator('#drone').filter({ hasText: /sensors\s*recon-mini/ }).waitFor({ timeout: 10000 });
  assert.match(await text('#world-stats'), /No scans yet/);
  const design = await f.design('recon-mini');
  const expected = await f.partBody('recon-mini', design.parts[0].id);
  await page.locator('#build-parts tbody tr').first().getByRole('button', { name: 'Open in CAD Studio' }).click();
  await page.waitForURL('**/cockpit/?app=cad-studio', { timeout: 15000 });
  assert.equal(f.cadPosts.length, 1);
  assert.deepEqual(f.cadPosts[0], expected, 'the tile posts the program the routes publish, byte for byte');
  assert.equal(f.cadPosts[0].source.package, 'embodied');
  assert.match(await text('#cockpit-stub'), /app=cad-studio/);
});

test('the Build panel shows the printed arm and checks it on physics', async () => {
  await page.locator('#arm-joints tbody tr').first().waitFor({ timeout: 15000 });
  const design = await f.armDesign('desk-6');
  assert.equal(await page.locator('#arm-joints tbody tr').count(), design.joints.length, 'one row per joint');
  assert.equal(await page.locator('#arm-parts tbody tr').count(), design.parts.length, 'one row per printed part');
  assert.match(await text('#arm-summary'), /Reach 0\.4\d+ m, payload 0\.15 kg, 8 servos/);
  assert.match(await page.locator('#arm-joints tbody tr').nth(1).innerText(), /shoulder pitch[\s\S]*two servos/);
  await page.getByRole('button', { name: 'Check on physics' }).click();
  await page.locator('#arm-summary').filter({ hasText: /physics agrees with the sizing/ }).waitFor({ timeout: 20000 });
  assert.equal(f.armChecks.length, 1, 'the tile asked the container once');
  assert.equal(f.armChecks[0].worst.length, 6, 'and sent the worst pose of every joint');
  assert.match(await page.locator('#arm-joints tbody tr').nth(1).innerText(), /N·m/, 'the measured hold landed in the row');
  await page.locator('.toast').filter({ hasText: /holds its payload and the taught task works/ }).waitFor({ timeout: 10000 });
});

test('ADR-160 S1: choose a medium and drop the hull — in air it falls, in seawater the tile refuses by name', async () => {
  await page.locator('#medium option').first().waitFor({ state: 'attached', timeout: 15000 });
  assert.deepEqual(await page.locator('#medium option').allTextContents(),
    ['Vacuum (Earth surface gravity)', 'Air (ISA sea level)', 'Seawater (coastal)']);
  assert.equal(await page.locator('#medium').inputValue(), 'air');

  // What the chosen medium can and cannot answer is read off the record, not typed into the page.
  const summary = await text('#medium-summary');
  assert.match(summary, /1\.225 kg/);
  assert.match(summary, /free surface: none/);

  // AIR: it falls, and the fall is drawn.
  await page.locator('#drop-hull').click();
  await page.waitForFunction(() => document.getElementById('drop-result').textContent.includes('It falls.'), null, { timeout: 15000 });
  const fell = await text('#drop-result');
  assert.match(fell, /It falls\./);
  assert.match(fell, /300 mm envelope, 24\.7 kg all-up, one solid/);
  assert.match(fell, /0\.639 s/, 'sqrt(2 * 2 / 9.81)');
  assert.match(fell, /6\.26 m\/s/);
  assert.match(fell, /medium_property_unavailable: freeSurface/, 'the float question is refused in the same answer');
  assert.ok((await page.locator('#fall rect').count()) >= 5, 'the hull is drawn descending, not just described');

  // SEAWATER: the answer is the refusal, by name.
  await page.selectOption('#medium', 'seawater');
  assert.match(await text('#medium-summary'), /1025 kg/);
  await page.locator('#drop-hull').click();
  await page.waitForFunction(() => document.getElementById('drop-result').textContent.includes('Refused by name'), null, { timeout: 15000 });
  const refused = await text('#drop-result');
  assert.match(refused, /Refused by name: model_not_valid_in_medium: rigid-body-plant, seawater/);
  assert.match(refused, /confidently wrong/);
  assert.doesNotMatch(refused, /It falls\./);
  assert.equal(await page.locator('#fall rect').count(), 0, 'nothing is drawn: a plausible float would disprove the contract');
});
