/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D4, lane @ds-app: the four screens in a real headless browser over the REAL compiled routes and canned engines. Products starts empty with the one button New product; the walkthrough proposes four phases for a hanger and Create lands on the Product screen with four posters; the spider example reads parts-complete, sized, drafted (the example in the lab), specified, on-the-rail, certified and printable from the canned engines, each poster with one button in the ADR's words; Close the phase binds the engine's read and records the closure, after which the body contract publishes the fixture's timestep, ranges, torques, sha and endpoint; absent engines read "no engine on this swarm for this phase" and a failed read is shown; Run the baselines posts {fit, seeds, jump}, Certify posts the file and the poster turns certified; Open in Circuit Lab creates the person's copy from the example, binds it and lands on the lab; Start the build lists the assembly from the design's parts by link, the bring-up and the brain door, and a tick is a closure; Settings lists an engine per phase, the brain and the printers, and Save writes the chain; 412 x 915 has no sideways scroll and 44px controls; midnight and daylight render from the portal tokens. Screenshots land in DESIGN_STUDIO_SHOTS (the handover folder) when it exists.
 *
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: Make the print set on the spider runs every printed part through the fixture's CAD Studio (one create per part, tagged with the product and the program hash), the dialog shows each part exported watertight and the manifest's sha256, the poster reads fabricated with the files linked, Close the phase records that sha as the revision, and a second run creates nothing (the parts are found by their tag); a part without a program and a build the engine refuses are listed unprintable with their reasons and the phase does not close; an open mesh is caught by the watertight check; the hanger from one CAD Studio box part gets a one-file set whose STL is the fixture's bytes; Send to printer appears only with a finished set and a printer chosen in Settings, asks, posts the file to the print service and records the reply on the poster; 412 x 915 with the set made.
 *
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the lift example in Chromium over the real routes and the fixture's engines - the Design poster's Create the parts in CAD Studio builds the three programs once (tagged) and binds them, Define the mechanism opens the Mechanism screen with the parts' kernel figures, the two joints, the motor row from embodied's catalog (the lab's rows disabled with their reason), the payload and the task from the brief's line, Save writes revision 2, the Simulate poster goes Build the plant (the spec the page composed carries the kernel's masses and the row's numbers) -> built -> Run the baselines -> baseline (the engine's reached time) -> Train the policy -> training (the job) -> trained -> Certify -> certified -> Close the phase, after which the body contract publishes the one actuator from the row with the certified reach policy; a refused certificate reads trained again; the spider's Mechanism screen is read-only; 412 x 915 of the Mechanism screen.
 *
 * FRAMEWORK-COUPLED: OSHAL_CORE_ROOT=$HOME/Documents/projects/oshal/src node --test tests/design-studio.spec.mjs
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startFixture, launchIsolatedBrowser, cannedDesign, cannedReports, cannedCatalog, hexapodReport } from './design-studio.fixture.mjs';

const PAGE = '/api/design-studio/app';
const SHOTS = process.env.DESIGN_STUDIO_SHOTS || '';
const shoot = async (page, name) => { if (SHOTS && fs.existsSync(SHOTS)) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
let owned; let browser; let context; let page; let f;
before(async () => { owned = await launchIsolatedBrowser(); browser = owned.browser; });
after(async () => { await browser.close(); await owned.close(); });
afterEach(async () => { if (context) await context.close(); if (f) await f.close(); context = null; f = null; });

/** Open the page over a fresh fixture at a hash route and wait for its first read. */
async function open(fixture = {}, { hash = '#/', viewport = { width: 1280, height: 900 }, theme = 'midnight' } = {}) {
  if (f) await f.close(); if (context) await context.close();
  f = await startFixture(fixture);
  context = await browser.newContext({ viewport });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort()));
  page = await context.newPage();
  await page.goto(`${f.origin}${PAGE}?theme=${theme}${hash}`);
  await ready();
}
const ready = async () => { await page.locator('#studio[data-ready="1"]').waitFor({ timeout: 15000 }); };
const reads = () => Number(page.locator('#studio').getAttribute('data-reads'));
const nextRead = async () => { const n = await page.locator('#studio').getAttribute('data-reads'); await page.locator(`#studio[data-reads="${Number(n) + 1}"]`).waitFor({ timeout: 15000 }); };
const text = (sel) => page.locator(sel).textContent();
const stage = (kind) => page.locator(`#poster-${kind}`).getAttribute('data-stage');
const api = async (method, p, body) => { const res = await fetch(`${f.origin}/api/design-studio${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json().catch(() => null) }; };
async function spider() { const r = await api('POST', '/projects', { example: 'spider-18' }); assert.equal(r.status, 201); return r.json.project.id; }
/** Change the hash route and wait for the read the new screen makes (a hidden screen keeps its old posters, so readiness alone is not enough). */
/** Re-read the current screen through its Reload button. */
async function reload() { const n = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#reload'); await page.locator(`#studio[data-reads="${n + 1}"]`).waitFor({ timeout: 15000 }); }
async function goto(hash) { const n = Number(await page.locator('#studio').getAttribute('data-reads')); await page.evaluate((h) => { location.hash = h; }, hash); await page.locator(`#studio[data-reads="${n + 1}"]`).waitFor({ timeout: 15000 }); }

test('Products starts empty with the one button New product; the walkthrough proposes a hanger\'s four phases and Create lands on four posters', async () => {
  await open({});
  assert.equal(await page.title(), 'Design Studio');
  assert.equal(await text('#title'), 'Products');
  assert.match(await text('#products-empty'), /Press New product/);
  assert.equal(await page.locator('#new-product').isVisible(), true); assert.equal(await text('#new-product'), 'New product');
  await page.click('#new-product'); await page.locator('#studio[data-screen="new"][data-ready="1"]').waitFor({ timeout: 15000 });
  assert.equal(await text('#title'), 'New product');
  await page.fill('#new-name', 'the hanger'); await page.fill('#new-what', 'a clothes hanger'); await page.fill('#new-requirements', 'holds a coat\nhangs on a closet rail');
  await page.fill('#new-mass', '40');
  await page.locator('#proposal li[data-kind="fabricate"]').waitFor({ timeout: 10000 });
  assert.deepEqual(await page.locator('#proposal li[data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind)), ['brief', 'design', 'fabricate', 'build']);
  assert.deepEqual(await page.locator('#proposal .engine').allTextContents(), ['reasoned', 'cad-studio', 'scan-to-print', 'reasoned']);
  await shoot(page, 'new-product-1280');
  assert.equal(await text('#create'), 'Create');
  await page.click('#create');
  await page.locator('#poster-build').waitFor({ timeout: 15000 }); await ready();
  assert.equal(await text('#title'), 'the hanger');
  assert.deepEqual(await page.locator('.poster h2').allTextContents(), ['Brief', 'Design', 'Fabricate', 'Build and test']);
  assert.equal(await text('#act-brief'), 'Confirm the brief');
  assert.equal(await stage('design'), 'concept'); assert.equal(await text('#act-design'), 'Open in CAD Studio');
  assert.match(await text('#design-stage'), /^concept · no CAD Studio part is bound/);
  assert.equal(await text('#act-fabricate'), 'Make the print set'); assert.equal(await text('#act-build'), 'Start the build');
  assert.match(await text('#fabricate-stage'), /^unbound · no CAD Studio part is bound to the Design phase yet.* · 1 printer registered · none chosen in Settings$/);
  assert.equal(await page.locator('#act-fabricate').isDisabled(), true, 'nothing to print until a part is bound');
  await shoot(page, 'hanger-product-1280');
  // Back on Products the hanger is a poster that opens the product.
  await goto('#/');
  assert.equal(await page.locator('.poster[data-product]').count(), 1);
  assert.match(await text('.poster[data-product] h2'), /^the hanger$/);
});

test('the spider example reads its stages from the canned engines, one button each in the ADR\'s words, at 1280 and 412 x 915', async () => {
  await open({});
  const id = await spider();
  await goto(`#/product/${id}`);
  assert.deepEqual(await page.locator('.poster h2').allTextContents(), ['Brief', 'Design', 'Mechanical spec', 'Electrical and power', 'Sensors', 'Controller', 'Simulate and train', 'Fabricate', 'Build and test']);
  const d = cannedDesign();
  assert.equal(await stage('design'), 'parts-complete');
  assert.equal(await text('#design-figure'), `${d.massBudget.totalG} g`);
  assert.match(await text('#design-stage'), new RegExp(`^parts-complete · ${d.massBudget.totalG} g under the ${d.massBudget.targetG} g target · worst femur 1\\.43 N·m of 1\\.47 N·m continuous · 8 printed programs$`));
  assert.equal(await text('#act-design'), 'Close the phase', 'the bar is met and the phase is open, so the one button closes it');
  assert.equal(await stage('mechanical'), 'sized'); assert.equal(await text('#mechanical-figure'), '1.43 N·m'); assert.equal(await text('#act-mechanical'), 'Close the phase');
  assert.equal(await stage('electrical'), 'drafted'); assert.match(await text('#electrical-stage'), /^drafted · the Hexapod power \(spider-18\) example is in the lab; Open in Circuit Lab makes your copy/); assert.equal(await text('#act-electrical'), 'Open in Circuit Lab');
  assert.equal(await stage('sensors'), 'specified'); assert.match(await text('#sensors-stage'), /^specified · lidar \(fixture LiDAR ring, on the Head \(LiDAR nose\)\) · imu \(fixture IMU\) · joints \(18\)$/);
  assert.equal(await stage('controller'), 'on-the-rail'); assert.match(await text('#controller-stage'), /^physics engine mujoco 3\.3\.5 connected · hexapod node spider-pi online \(hexapod-node 0\.1\.0\)$/); assert.equal(await text('#controller-figure'), '1');
  assert.equal(await stage('simulate'), 'certified'); assert.match(await text('#simulate-stage'), /^certified · hexapod-walk-shape-seed1\.json \(hexapod-walk, seed 1\): policy beats the baseline \(the gate re-measured\) · certified \(1631 control steps, policy sha fixture-sha-\) · the walker · plant 18 actuators at dt 0\.002 s$/);
  assert.equal(await text('#act-simulate'), 'Close the phase');
  assert.equal(await stage('fabricate'), 'printable'); assert.match(await text('#fabricate-stage'), /^printable · 8 of 8 the design's printed parts have a program · no print set made yet · 1 printer registered · none chosen in Settings$/);
  assert.equal(await text('#act-fabricate'), 'Make the print set');
  assert.equal(await stage('build'), 'not-started'); assert.equal(await text('#build-figure'), '0/18'); assert.equal(await text('#act-build'), 'Start the build');
  assert.equal(await text('#act-brief'), 'Confirm the brief');
  assert.equal(await page.locator('.poster').count(), 9);
  assert.equal(await page.locator('.poster .act > *').count(), 9, 'one button per poster');
  assert.equal(await text('#act-controller'), 'Close the phase', 'the node is on the rail, so the bar is met');
  await shoot(page, 'spider-product-1280');
  // The phone: no sideways scroll, 44px controls, one column.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.reload(); await ready();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, 'no horizontal overflow at 412 x 915');
  const short = await page.locator('.poster .act > *, #head-actions > *:not([hidden])').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
  assert.deepEqual(short, [], 'every control is at least 44px tall on a phone');
  await shoot(page, 'spider-product-412x915');
});

test('Close the phase binds the engine\'s read and records the closure; the body contract then publishes the fixture\'s values', async () => {
  await open({});
  const id = await spider();
  await goto(`#/product/${id}`);
  const before = await api('GET', `/projects/${id}/body`);
  assert.equal(before.status, 409); assert.equal(before.json.error, 'body_incomplete');
  for (const kind of ['design', 'sensors', 'controller', 'simulate']) {
    await page.click(`#act-${kind}`);
    await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#close-evidence').inputValue(), await text(`#${kind}-stage`), `${kind}: the evidence line is the stage line as read`);
    assert.ok((await page.locator('#close-revision').inputValue()).length > 0);
    await page.click('#close-dialog button[value="close"]');
    await page.locator(`#poster-${kind}[data-closed="1"]`).waitFor({ timeout: 10000 });
    assert.equal(await text(`#act-${kind}`), { design: 'Open the design', sensors: 'Open the design', controller: 'Node status', simulate: 'Run the baselines' }[kind], `${kind}: once closed the button is the phase's action again`);
  }
  assert.match(await text('#poster-design .closed'), /^closed .* by person at [0-9a-f]{8}$/);
  const after = await api('GET', `/projects/${id}/body`);
  assert.equal(after.status, 200, JSON.stringify(after.json));
  const d = cannedDesign();
  assert.equal(after.json.plant.physicsDt, 0.002, 'the timestep parsed from the fixture MJCF');
  assert.equal(after.json.actuators.length, 18);
  const femur = after.json.actuators.find((a) => a.joint === 'R2-femur');
  assert.deepEqual(femur.rangeRad, [-2.0944, 2.0944]); assert.equal(femur.continuousNm, d.joints[1].usableNm); assert.equal(femur.stallNm, d.servo.stallNm);
  assert.equal(after.json.walker.policySha256, 'fixture-sha-d15f6a7d2048e7ce'); assert.equal(after.json.walker.kind, 'certified-gait');
  assert.deepEqual(after.json.node, { kind: 'hexapod', endpoint: 'http://spider-pi.local:7421' });
  assert.equal(after.json.plant.tickS, null, 'the rail listing states no tick rate, so none is invented');
  assert.ok(after.json.missing.some((m) => /plant\.tickS/.test(m)));
  assert.equal(after.json.senses.find((s) => s.name === 'lidar').mount, 'Head (LiDAR nose)');
  // The brief: Confirm the brief closes it; Edit the brief re-opens the walkthrough with the words.
  await page.click('#act-brief'); await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 }); await page.click('#close-dialog button[value="close"]');
  await page.locator('#poster-brief[data-closed="1"]').waitFor({ timeout: 10000 });
  assert.equal(await text('#act-brief'), 'Edit the brief');
  await page.click('#act-brief'); await page.locator('#studio[data-screen="new"][data-ready="1"]').waitFor({ timeout: 10000 });
  assert.equal(await text('#title'), 'Edit the brief'); assert.equal(await page.locator('#new-name').inputValue(), 'spider-18');
  assert.equal(await page.locator('#proposal-card').isHidden(), true, 'the chain is kept when the brief is edited');
  // A stale closure: the design moves on, the closure says so.
  f.design.massBudget.totalG += 1;
  await goto(`#/product/${id}`);
  assert.equal(await page.locator('#studio').getAttribute('data-screen'), 'product');
  assert.match(await text('#poster-design .closed'), /^stale · closed/);
  assert.equal(await text('#act-design'), 'Close the phase');
  assert.equal((await api('GET', '/projects')).json.projects[0].closedPhases, 5);
});

test('absent engines read "no engine on this swarm for this phase"; a failed read is shown; a refusal is named', async () => {
  await open({ embodied: 404, circuitLab: 404, cadStudio: 404, printService: 404 });
  const id = await spider();
  await goto(`#/product/${id}`);
  for (const kind of ['design', 'mechanical', 'sensors', 'controller', 'simulate', 'fabricate']) { assert.equal(await stage(kind), 'absent', kind); assert.match(await text(`#${kind}-stage`), /no engine on this swarm for this phase \(embodied did not answer/, kind); }
  assert.match(await text('#electrical-stage'), /no engine on this swarm for this phase \(Circuit Lab did not answer/);
  assert.match(await text('#fabricate-stage'), /no print service on this swarm/);
  assert.equal(await page.locator('#act-design').isDisabled(), true); assert.equal(await page.locator('#act-simulate').isDisabled(), true);
  assert.equal(await page.locator('#act-controller').isDisabled(), false, 'Node status still shows the failed read');
  await shoot(page, 'spider-absent-engines-1280');
  f.embodied = 200; f.statusCode = 503; f.reportsCode = 500; f.circuitLab = 403;
  await reload();
  assert.equal(await stage('controller'), 'failed'); assert.match(await text('#controller-stage'), /^unavailable · \/api\/embodied\/physics\/status: engine unavailable \(fixture\)$/);
  assert.equal(await stage('simulate'), 'failed'); assert.match(await text('#simulate-stage'), /^unavailable · \/api\/embodied\/physics\/reports: fixture_failure$/);
  assert.equal(await stage('electrical'), 'refused'); assert.match(await text('#electrical-stage'), /^Circuit Lab refused this account \(HTTP 403\)$/);
  assert.equal(await stage('design'), 'parts-complete', 'the design still reads');
  assert.equal(await text('#act-controller'), 'Node status');
  await page.click('#act-controller');
  assert.match(await text('#status-json'), /"status": 503/, 'the status dialog shows the failed read, not a blank');
  await page.keyboard.press('Escape');
});

test('Run the baselines posts the check, Certify posts the file and the poster turns certified; Open in Circuit Lab makes the person\'s copy and binds it', async () => {
  await open({ reports: cannedReports([]) });
  const id = await spider();
  await goto(`#/product/${id}`);
  assert.equal(await stage('simulate'), 'baseline'); assert.equal(await text('#act-simulate'), 'Run the baselines');
  assert.match(await text('#simulate-stage'), /^baseline · no hexapod-\* report yet in \/tmp\/embodied-reports · the walker · plant 18 actuators at dt 0\.002 s$/);
  await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /The baselines ran in the engine container in 3\.2 s\. standsAtStandHeight: yes, walksForward: yes, leavesTheFloor: NO\./ }).waitFor({ timeout: 10000 });
  await page.locator('#poster-simulate[data-stage="trained"]').waitFor({ timeout: 10000 });
  assert.deepEqual(f.checks, [{ fit: 'spider-18', seeds: 1, jump: 'legs-hop' }]);
  assert.equal(await text('#act-simulate'), 'Certify');
  await page.click('#act-simulate');
  await page.locator('#poster-simulate[data-stage="certified"]').waitFor({ timeout: 10000 });
  assert.deepEqual(f.certifies, [{ file: 'hexapod-walk-shape-seed2.json' }]);
  assert.match(await text('#simulate-stage'), /certified \(1631 control steps/);
  assert.equal(await text('#act-simulate'), 'Close the phase');
  // The check route absent: the toast says so and nothing pretends to have run.
  f.checkCode = 404;
  await page.click('#act-simulate'); await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 }); await page.click('#close-dialog button[value="cancel"]');
  // Electrical: the person's copy from the example, solved on the fixture, bound, and the lab opened on it.
  const [lab] = await Promise.all([context.waitForEvent('page'), page.click('#act-electrical')]);
  await lab.waitForURL(/design=circ-1/, { timeout: 10000 });
  assert.match(lab.url(), /\/api\/circuit-lab\/app\?design=circ-1$/, 'the lab opens beside the page, on the person\'s copy');
  await lab.close();
  assert.deepEqual(f.circuitCreates, [{ example: 'hexapod-power', title: 'spider-18 power', run: true }]);
  const bound = await api('GET', `/projects/${id}`);
  assert.equal(bound.json.bindings.electrical.artifact.designId, 'circ-1'); assert.equal(bound.json.bindings.electrical.revision, 2);
  await page.goto(`${f.origin}${PAGE}#/product/${id}`); await ready();
  assert.equal(await stage('electrical'), 'holds');
  assert.match(await text('#electrical-stage'), /^holds · run 1 of spider-18 power: REG1 5\.00 V · 21\.8 min at the run's average draw$/);
  assert.equal(await text('#act-electrical'), 'Close the phase');
});

test('Start the build lists the assembly by link, the bring-up and the brain door; a tick is a closure', async () => {
  await open({});
  const id = await spider();
  await goto(`#/product/${id}`);
  await page.click('#act-build');
  await page.locator('#build-dialog[open]').waitFor({ timeout: 5000 });
  const groups = await page.locator('#build-steps li.group').allTextContents();
  assert.deepEqual(groups, ['assemble the body', 'assemble the coxa', 'assemble the femur', 'assemble the tibia', 'assemble the jump', 'fit the bought parts', 'bring-up', 'the certified brain']);
  assert.equal(await page.locator('#build-steps li[data-step]').count(), 18);
  assert.match(await text('#build-steps li[data-step="bringup:row"]'), /the row: all 18 actuators answer/);
  assert.match(await text('#build-steps li[data-step="brain:load"]'), /close the Simulate phase first/);
  await page.check('#step-assemble\\:plate');
  await page.locator('#build-steps li[data-step="assemble:plate"] .when').waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.locator('#poster-build[data-stage="in-progress"]').waitFor({ timeout: 10000 });
  assert.equal(await text('#build-figure'), '1/18');
  const closures = (await api('GET', `/projects/${id}`)).json.closures;
  assert.deepEqual(closures.map((c) => `${c.phase}:${c.step}`), ['build:assemble:plate']);
  assert.equal((await api('GET', '/projects')).json.projects[0].closedPhases, 0, 'a ticked step never closes the phase');
});

const sha = (b) => createHash('sha256').update(b).digest('hex');
/** Press Make the print set, wait for the dialog's result line, close it and wait for the re-read. */
async function makeSet() {
  await page.click('#act-fabricate');
  await page.locator('#make-dialog[open]').waitFor({ timeout: 5000 });
  await page.locator('#make-close:not([disabled])').waitFor({ timeout: 60000 });
  const result = await text('#make-result');
  const states = await page.locator('#make-steps li[data-part]').evaluateAll((els) => els.map((e) => `${e.dataset.part}:${e.dataset.state}`));
  const n = Number(await page.locator('#studio').getAttribute('data-reads'));
  await page.click('#make-close');
  await page.locator(`#studio[data-reads="${n + 1}"]`).waitFor({ timeout: 15000 });
  return { result, states };
}

test('Make the print set runs every part through CAD Studio once, the poster reads fabricated with the files, Close the phase records the manifest sha, a second run rebuilds nothing', async () => {
  await open({});
  const id = await spider();
  await goto(`#/product/${id}`);
  assert.equal(await text('#act-fabricate'), 'Make the print set'); assert.equal(await page.locator('#act2-fabricate').count(), 0, 'no second button before a set exists');
  const first = await makeSet();
  assert.equal(first.states.length, 8); assert.ok(first.states.every((s) => /:exported$/.test(s)), first.states.join(' '));
  assert.match(first.result, /^8 of 8 parts exported watertight · manifest sha256 [0-9a-f]{64}$/);
  const listing = (await api('GET', `/projects/${id}/print-set`)).json;
  assert.equal(listing.finished, true); assert.equal(listing.exported, 8); assert.deepEqual(listing.unprintable, []); assert.equal(listing.engine, 'embodied');
  assert.equal(await stage('fabricate'), 'fabricated');
  assert.match(await text('#fabricate-stage'), new RegExp(`^fabricated · 8 of 8 parts exported watertight through CAD Studio · manifest ${listing.manifestSha256.slice(0, 12)} · 1 printer registered · none chosen in Settings$`));
  assert.equal(await text('#fabricate-figure'), '8/8');
  assert.deepEqual(await page.locator('#fabricate-files a').allTextContents(), [...cannedDesign().printed.map((p) => `${p.id}.stl`), 'PRINT-SHEET.md', 'bom.csv', 'manifest.json']);
  assert.equal(await text('#act-fabricate'), 'Close the phase', 'the bar is met and the phase is open');
  // Every part became the person's own CAD Studio part once, tagged with the product and the program hash.
  assert.equal(f.cadCreates.length, 8);
  assert.deepEqual(f.cadCreates.map((c) => c.source.designStudio.part), cannedDesign().printed.map((p) => p.id));
  assert.ok(f.cadCreates.every((c) => c.source.designStudio.project === id && /^[0-9a-f]{8}$/.test(c.source.designStudio.programSha) && c.title.startsWith('spider-18 · ')));
  // The served file is the bytes CAD Studio exported, and the sheet names the part with the design's own fields.
  const plate = listing.manifest.parts.find((p) => p.id === 'plate');
  const served = await fetch(`${f.origin}/api/design-studio/projects/${id}/print-set/plate.stl`); assert.equal(served.status, 200); assert.equal(sha(Buffer.from(await served.arrayBuffer())), plate.sha256);
  assert.equal(plate.sha256, sha(f.cadStl.get(plate.source.modelId))); assert.equal(plate.kernelMassEachG, 152.77); assert.deepEqual(plate.extentsMm, [220, 140, 4]);
  const sheet = await (await fetch(`${f.origin}/api/design-studio/projects/${id}/print-set/PRINT-SHEET.md`)).text();
  assert.ok(sheet.includes('| `plate.stl` | 2 | PETG | not stated | not stated | not stated | 220 × 140 × 4 | 153 g at 1.24 g/cm³ (design 60 g) | PETG, 30 % gyroid (fixture) |'), sheet);
  assert.ok(sheet.includes('**The latched-spring option adds** 1 piece from 1 file'));
  // Close the phase: the evidence is the poster line and the revision is the manifest's sha256.
  await page.click('#act-fabricate'); await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#close-revision').inputValue(), listing.manifestSha256);
  await page.click('#close-dialog button[value="close"]');
  await page.locator('#poster-fabricate[data-closed="1"]').waitFor({ timeout: 10000 });
  assert.match(await text('#poster-fabricate .closed'), new RegExp(`by person at ${listing.manifestSha256}$`));
  assert.equal(await text('#act-fabricate'), 'Make the print set');
  const bound = (await api('GET', `/projects/${id}`)).json;
  assert.equal(bound.bindings.fabricate.artifact.read.manifestSha256, listing.manifestSha256); assert.equal(bound.closures.find((c) => c.phase === 'fabricate').revision, listing.manifestSha256);
  await shoot(page, 'spider-fabricated-1280');
  // A second run finds every part by its tag and creates nothing; the set is remade with the same files.
  const second = await makeSet();
  assert.equal(f.cadCreates.length, 8, 'nothing rebuilt'); assert.match(second.result, /^8 of 8 parts exported watertight/);
  const again = (await api('GET', `/projects/${id}/print-set`)).json;
  assert.deepEqual(again.manifest.parts.map((p) => p.sha256), listing.manifest.parts.map((p) => p.sha256));
  // The design moves on: the closure is stale, and the set is stale too.
  f.design.massBudget.totalG += 1;
  await reload();
  assert.equal(await stage('fabricate'), 'printable'); assert.match(await text('#fabricate-stage'), /^printable · the set \(8 of 8 parts, manifest [0-9a-f]{12}\) was made at design revision [0-9a-f]{8}; the design is now [0-9a-f]{8}: make it again/);
  assert.match(await text('#poster-fabricate .closed'), /^stale · closed/);
  // The phone, with the set made.
  await page.setViewportSize({ width: 412, height: 915 }); await page.reload(); await ready();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal overflow at 412 x 915');
  const short = await page.locator('.poster .act > *, #head-actions > *:not([hidden])').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
  assert.deepEqual(short, []);
  await shoot(page, 'spider-fabricated-412x915');
});

test('a part without a program and a build the engine refuses are listed unprintable, an open mesh is caught, and the phase does not close until every part is in the set', async () => {
  await open({ cadBuildFails: true });
  const id = await spider();
  delete f.design.printed[7].cad;
  await goto(`#/product/${id}`);
  assert.equal(await stage('fabricate'), 'unprintable'); assert.match(await text('#fabricate-stage'), /^unprintable · 7 of 8 the design's printed parts have a program · no print set made yet/);
  const first = await makeSet();
  assert.deepEqual(first.states.filter((s) => /:unprintable$/.test(s)).length, 8);
  assert.match(first.result, /^0 of 8 parts exported watertight · manifest sha256 [0-9a-f]{64} · 8 unprintable: Body plate \(CAD Studio: engine container is not running \(fixture\) — install or rebuild it\); /);
  assert.match(first.result, /Spring cam \(no CAD program in the design for this part\)$/);
  assert.equal(await stage('fabricate'), 'unprintable'); assert.equal(await text('#act-fabricate'), 'Make the print set', 'not met: no Close the phase');
  assert.match(await text('#fabricate-stage'), /^unprintable · 0 of 8 parts exported watertight through CAD Studio · 8 unprintable: /);
  assert.equal(await page.locator('#fabricate-files a').count(), 3, 'the sheet, the BOM and the manifest exist even with nothing exported');
  const listing = (await api('GET', `/projects/${id}/print-set`)).json;
  assert.equal(listing.unprintable.length, 8); assert.equal(listing.unprintable[7].reason, 'no CAD program in the design for this part');
  // The engine builds, but exports a mesh with an open edge: the watertight check catches it, part by part.
  f.cadBuildFails = false; f.cadOpenMesh = true;
  const second = await makeSet();
  assert.match(second.result, /^0 of 8 parts exported watertight · manifest sha256 [0-9a-f]{64} · 8 unprintable: Body plate \(the exported STL is not watertight: 3 open edges\); /);
  assert.equal(f.cadCreates.length, 14, 'seven creates refused on the first run left no part behind, so seven were built on the second');
  // Clean meshes: every programmed part exports; the one without a program stays listed.
  f.cadOpenMesh = false; f.models = f.models.filter((m) => !(m.source && m.source.designStudio));
  const third = await makeSet();
  assert.match(third.result, /^7 of 8 parts exported watertight · manifest sha256 [0-9a-f]{64} · 1 unprintable: Spring cam \(no CAD program in the design for this part\)$/);
  assert.equal(await stage('fabricate'), 'unprintable'); assert.equal(await text('#act-fabricate'), 'Make the print set');
  assert.match(await text('#fabricate-stage'), /^unprintable · 7 of 8 parts exported watertight through CAD Studio · 1 unprintable: Spring cam \(no CAD program in the design for this part\) · manifest [0-9a-f]{12}/);
  await shoot(page, 'spider-unprintable-1280');
});

test('the hanger: one CAD Studio box part bound to Design gives a one-file print set whose STL is the engine\'s bytes; Send to printer asks, posts the file to the print service and records the reply', async () => {
  await open({ cadBox: { title: 'Hook', x: 30, y: 20, z: 10 }, models: [] });
  const created = await api('POST', '/projects', { name: 'the hanger', brief: { what: 'a clothes hanger', requirements: ['holds a coat'] } });
  const id = created.json.project.id;
  assert.equal((await api('POST', `/projects/${id}/bind`, { phase: 'design', artifact: { engine: 'cad-studio', kind: 'cad-models', modelIds: [f.cadBoxId] } })).status, 201);
  await goto(`#/product/${id}`);
  assert.equal(await stage('design'), 'parts-complete'); assert.match(await text('#design-stage'), /^parts-complete · 1 of 1 bound parts built · Hook r1$/);
  assert.equal(await stage('fabricate'), 'printable'); assert.match(await text('#fabricate-stage'), /^printable · 1 of 1 the bound CAD Studio parts have a program · no print set made yet · 1 printer registered · none chosen in Settings$/);
  const made = await makeSet();
  assert.deepEqual(made.states, [`${f.cadBoxId}:exported`]); assert.match(made.result, /^1 of 1 parts exported watertight · manifest sha256 [0-9a-f]{64}$/);
  assert.equal(f.cadCreates.length, 0, 'a bound CAD Studio part is read, never rebuilt');
  assert.equal(await stage('fabricate'), 'fabricated'); assert.equal(await text('#act-fabricate'), 'Close the phase');
  assert.deepEqual(await page.locator('#fabricate-files a').allTextContents(), [`${f.cadBoxId}.stl`, 'PRINT-SHEET.md', 'bom.csv', 'manifest.json']);
  const listing = (await api('GET', `/projects/${id}/print-set`)).json;
  assert.equal(listing.engine, 'cad-studio'); assert.equal(listing.designRevision, `${f.cadBoxId.slice(0, 8)}@r1`);
  const part = listing.manifest.parts[0];
  assert.equal(part.name, 'Hook'); assert.equal(part.qty, 1); assert.deepEqual(part.extentsMm, [30, 20, 10]); assert.equal(part.source.modelId, f.cadBoxId); assert.equal(part.sha256, sha(f.cadStl.get(f.cadBoxId)));
  const served = await fetch(`${f.origin}/api/design-studio/projects/${id}/print-set/${f.cadBoxId}.stl`);
  assert.equal(served.headers.get('content-disposition'), `attachment; filename="the-hanger-${f.cadBoxId}.stl"`); assert.equal(sha(Buffer.from(await served.arrayBuffer())), part.sha256);
  const sheet = await (await fetch(`${f.origin}/api/design-studio/projects/${id}/print-set/PRINT-SHEET.md`)).text();
  assert.ok(sheet.includes(`| \`${f.cadBoxId}.stl\` | 1 | not stated | not stated | not stated | not stated | 30 × 20 × 10 | 7 g at 1.24 g/cm³ (design not stated) | not stated |`), sheet);
  assert.ok(sheet.includes('None: every printed part of the design is in this set.'));
  const bom = await (await fetch(`${f.origin}/api/design-studio/projects/${id}/print-set/bom.csv`)).text();
  assert.equal(bom.split('\n').length, 3, 'a header and the one printed row: no bought rows in a CAD Studio design');
  await shoot(page, 'hanger-fabricated-1280');
  // No printer chosen: no second button. Chosen in Settings: Send to printer asks, then sends one file.
  assert.equal(await page.locator('#act2-fabricate').count(), 0);
  await api('PUT', `/projects/${id}/phases`, { phases: created.json.project.phases.map((p) => (p.kind === 'fabricate' ? { ...p, printerId: 'prn-1' } : p)) });
  await reload();
  assert.equal(await text('#act2-fabricate'), 'Send to printer'); assert.match(await text('#fabricate-stage'), /Bench P1S chosen$/);
  await page.click('#act2-fabricate'); await page.locator('#send-dialog[open]').waitFor({ timeout: 5000 });
  assert.match(await text('#send-what'), /^One file at a time to Bench P1S \(bambu-lan, auto-start off: the file waits on the printer for you to start it\) through the print service, the way print-to-3d-printer sends a scan job\. It asks first, as that tool does\.$/);
  assert.deepEqual(await page.locator('#send-file option').evaluateAll((els) => els.map((e) => e.value)), [`${f.cadBoxId}.stl`]);
  await page.click('#send-dialog button[value="cancel"]');
  assert.deepEqual(f.prints, [], 'cancel sends nothing');
  await page.click('#act2-fabricate'); await page.locator('#send-dialog[open]').waitFor({ timeout: 5000 });
  await page.check('#send-plate'); await page.click('#send-dialog button[value="send"]');
  await page.locator('.toast').filter({ hasText: /is on Bench P1S: Uploaded; auto-start is off for this printer, start it on the printer\./ }).waitFor({ timeout: 10000 });
  await page.locator('#poster-fabricate').filter({ hasText: /1 file sent to Bench P1S \(the last one waits on the printer\)/ }).waitFor({ timeout: 10000 });
  assert.deepEqual(f.prints, [{ printerId: 'prn-1', name: `the-hanger-${f.cadBoxId}.stl`, bytes: f.cadStl.get(f.cadBoxId).length, sha256: part.sha256 }], 'the print service got the set\'s bytes for the chosen printer');
  const sent = (await api('GET', `/projects/${id}/print-set`)).json.sent;
  assert.deepEqual(sent.map((x) => [x.file, x.printerId, x.printerLabel, x.submissionId, x.uploaded, x.started]), [[`${f.cadBoxId}.stl`, 'prn-1', 'Bench P1S', 'sub-1', true, false]]);
  // The print service gone: the button goes with it and the line says so.
  f.printService = 404; await reload();
  assert.equal(await page.locator('#act2-fabricate').count(), 0); assert.match(await text('#fabricate-stage'), /no print service on this swarm$/);
});

test('Settings lists an engine per phase, the brain and the printers; Save writes the chain and the printer; daylight renders from the tokens', async () => {
  await open({}, { theme: 'daylight' });
  const id = await spider();
  await goto(`#/product/${id}/settings`);
  assert.equal(await text('#title'), 'Settings · spider-18');
  assert.equal(await page.locator('#settings-engines .row').count(), 9);
  assert.equal(await page.locator('#engine-design').inputValue(), 'embodied');
  assert.deepEqual(await page.locator('#engine-electrical option').allTextContents(), ['circuit-lab', 'reasoned (no engine)']);
  assert.equal(await page.locator('#set-brain').count(), 0, 'Settings names no outside brain');
  assert.deepEqual(await page.locator('#set-printer option').allTextContents(), ['none chosen', 'Bench P1S (bambu-lan)']);
  assert.equal(await page.locator('#bindings-list .row').count(), 7);
  await page.selectOption('#set-printer', 'prn-1'); await page.selectOption('#engine-mechanical', 'reasoned');
  await shoot(page, 'spider-settings-daylight-1280');
  await page.click('#save-settings');
  await page.locator('#poster-build').waitFor({ timeout: 15000 }); await ready();
  const p = (await api('GET', `/projects/${id}`)).json.project;
  assert.equal(p.phases.find((x) => x.kind === 'fabricate').printerId, 'prn-1'); assert.equal(p.phases.find((x) => x.kind === 'mechanical').engine, 'reasoned');
  assert.match(await text('#fabricate-stage'), /Bench P1S chosen/);
  assert.equal(await stage('mechanical'), 'reasoned'); assert.equal(await text('#act-mechanical'), 'Close the phase');
  assert.match(await text('#mechanical-stage'), /^no engine on this swarm for this phase · every actuator sized/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(bg, 'rgb(10, 10, 18)', 'daylight is not the midnight fallback');
  const sheet = fs.readFileSync(new URL('../tools/design-studio.css', import.meta.url), 'utf8');
  for (const m of sheet.matchAll(/#[0-9a-f]{3,8}\b/gi)) assert.match(sheet.slice(Math.max(0, m.index - 60), m.index), /var\(--[a-z-]+,\s*$/, `${m[0]} is only a token fallback`);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[style]')].filter((e) => e.getAttribute('style').trim()).map((e) => e.id || e.tagName)), [], 'no inline style on the page (an empty style attribute the browser adds to a form control is not one)');
  // The engine marked absent in Settings when it did not answer this session.
  f.cadStudio = 404;
  await goto(`#/product/${id}/settings`);
  assert.deepEqual(await page.locator('#engine-design option').allTextContents(), ['cad-studio — absent on this swarm', 'embodied', 'reasoned (no engine)']);
});

test('the walkthrough proposes all nine phases from the spider\'s six lines and names the thermal need as unsolved', async () => {
  await open({}, { hash: '#/new' });
  await page.fill('#new-name', 'spider'); await page.fill('#new-what', 'a six-legged walking robot');
  await page.fill('#new-requirements', 'holds a Raspberry Pi\nhas heat\none LiDAR eye\nsix legs\njumps\nflips its legs when upside down');
  await page.locator('#proposal li[data-kind="simulate"]').waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#proposal li[data-kind]').count(), 9);
  assert.match(await text('#proposal li.unsolved'), /has heat - a thermal phase has no engine on this shelf/);
  await page.uncheck('#phase-sensors');
  await page.click('#create');
  await page.locator('#poster-build').waitFor({ timeout: 15000 }); await ready();
  assert.equal(await page.locator('.poster').count(), 8);
  assert.equal(await page.locator('#poster-sensors').count(), 0);
  assert.equal(await stage('design'), 'concept', 'a brief\'s design binds CAD Studio by default'); assert.match(await text('#design-stage'), /^concept · no CAD Studio part is bound/);
  assert.equal(await stage('simulate'), 'unbound'); assert.match(await text('#simulate-stage'), /^unbound · no plant or report bound to this phase: ask the design partner to bind one \(no fit is bound either\) · the walker$/);
  assert.equal(await page.locator('#act-simulate').isDisabled(), true);
  assert.equal(await stage('controller'), 'unbound'); assert.equal(await text('#act-controller'), 'Node status');
  const r = await page.locator('#studio').getAttribute('data-reads'); assert.ok(Number(r) >= 1); assert.ok(reads);
});

test('the lift: Create the parts in CAD Studio, Define the mechanism, Build the plant, Run the baselines, Train the policy, Certify, Close the phase; the body contract carries the one actuator from the row', async () => {
  await open({ models: [], reports: cannedReports([]) });
  const created = await api('POST', '/projects', { example: 'lift-1' }); assert.equal(created.status, 201); const id = created.json.project.id;
  await goto(`#/product/${id}`);
  assert.deepEqual(await page.locator('.poster h2').allTextContents(), ['Brief', 'Design', 'Mechanical spec', 'Electrical and power', 'Simulate and train', 'Fabricate', 'Build and test']);
  assert.equal(await stage('design'), 'concept'); assert.equal(await text('#act-design'), 'Create the parts in CAD Studio'); assert.equal(await text('#act2-design'), 'Define the mechanism');
  assert.match(await text('#design-stage'), /^concept · 3 of 3 parts are programs from the design \(Base plate, Column, Carriage\); none is in CAD Studio yet/);
  assert.equal(await stage('simulate'), 'concept'); assert.match(await text('#simulate-stage'), /^concept · mechanism r1: 3 parts, 2 joints, 1 driven, payload 2 kg on the carriage · task: lifts 2 kg to 300 mm in 5 s · plant not built in the engine$/);
  assert.equal(await text('#act-simulate'), 'Build the plant'); assert.equal(await page.locator('#act-simulate').isDisabled(), false);
  // Create the parts: three tagged creates, then the design reads parts-complete from the fixture's kernel reports.
  await page.click('#act-design'); await page.locator('#make-dialog[open]').waitFor({ timeout: 5000 }); await page.locator('#make-close:not([disabled])').waitFor({ timeout: 30000 });
  assert.deepEqual(await page.locator('#make-steps li[data-part]').evaluateAll((els) => els.map((e) => `${e.dataset.part}:${e.dataset.state}`)), ['base:exported', 'column:exported', 'carriage:exported']);
  assert.match(await text('#make-result'), /^3 parts are in CAD Studio and bound/);
  const n = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#make-close'); await page.locator(`#studio[data-reads="${n + 1}"]`).waitFor({ timeout: 15000 });
  assert.equal(f.cadCreates.length, 3); assert.deepEqual(f.cadCreates.map((c) => c.source.designStudio.part), ['base', 'column', 'carriage']); assert.ok(f.cadCreates.every((c) => c.source.designStudio.project === id && c.title.startsWith('lift-1 · ')));
  assert.equal(await stage('design'), 'parts-complete'); assert.match(await text('#design-stage'), /^parts-complete · 3 of 3 bound parts built · lift-1 · Base plate r1, lift-1 · Column r1, lift-1 · Carriage r1$/);
  const bound = (await api('GET', `/projects/${id}`)).json.bindings.design.artifact; assert.equal(bound.kind, 'cad-models'); assert.equal(bound.models.length, 3); assert.equal(bound.parts.length, 3, 'the programs stay beside the models');
  // The Mechanism screen: the parts with the kernel's figures, the joints, the motor rows, the payload, the task.
  await page.click('#act2-design'); await page.locator('#studio[data-screen="mechanism"][data-ready="1"]').waitFor({ timeout: 15000 });
  assert.equal(await text('#title'), 'Mechanism · lift-1');
  const parts = await page.locator('#mech-parts li').allTextContents();
  assert.equal(parts.length, 3); assert.match(parts[0], /^Base plate \(base\) · 496 g · 200 × 200 × 10 mm by the kernel, r1$/); assert.match(parts[2], /^Carriage \(carriage\) · 238\.08 g · 80 × 60 × 40 mm by the kernel, r1$/);
  assert.equal(await page.locator('#mech-base').inputValue(), 'base');
  assert.equal(await page.locator('#mech-joints .joint').count(), 2);
  assert.equal(await page.locator('#j1-type').inputValue(), 'slide'); assert.equal(await page.locator('#j1-motor').inputValue(), 'sts3215-12v'); assert.equal(await page.locator('#j1-ratio').inputValue(), '40'); assert.equal(await page.locator('#j1-hi').inputValue(), '0.35');
  const rows = await page.locator('#j1-motor option').evaluateAll((els) => els.map((e) => `${e.value}|${e.disabled ? 'off' : 'on'}|${e.textContent}`));
  assert.ok(rows.some((r) => /^sts3215-12v\|on\|fixture bus servo 12 V · embodied · stall 2\.942 N·m, no-load 4\.72 rad\/s, continuous 1\.471 N·m$/.test(r)), rows.join('\n'));
  assert.ok(rows.some((r) => /^2306-1800kv\|off\|.*cannot drive a joint$/.test(r)) && rows.some((r) => /^stepper-nema17\|off\|.*no stall torque and no-load speed published/.test(r)), `rows without a rating are listed disabled with the reason: ${rows.join(' ; ')}`);
  assert.ok(!rows.some((r) => /^servo-bus-sts3215-12v/.test(r)), 'the lab\'s copy of embodied\'s row is not listed twice');
  assert.equal(await page.locator('#mech-payload-mass').inputValue(), '2'); assert.equal(await page.locator('#mech-payload-part').inputValue(), 'carriage');
  assert.match(await text('#mech-task'), /^"lifts 2 kg to 300 mm in 5 s" → move the payload by 0, 0, 300 mm in 5 s with 2 kg$/);
  await page.setViewportSize({ width: 412, height: 915 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal overflow on the Mechanism screen at 412 x 915');
  await shoot(page, 'lift-mechanism-412x915');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shoot(page, 'lift-mechanism-1280');
  await page.click('#mech-save');
  await page.locator('.toast').filter({ hasText: /The mechanism is saved \(revision 2\): 2 joints, 1 driven\./ }).waitFor({ timeout: 10000 });
  await page.locator('#studio[data-screen="product"][data-ready="1"]').waitFor({ timeout: 15000 });
  const saved = (await api('GET', `/projects/${id}/mechanism`)).json; assert.equal(saved.revision, 2); assert.equal(saved.mechanism.parts[0].modelId, bound.models[0].modelId, 'the parts now carry their model ids'); assert.equal(saved.mechanism.task.timeS, 5);
  // Build the plant: the spec the page composed carries the kernel's masses and the row's numbers.
  assert.equal(await text('#act-simulate'), 'Build the plant');
  await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /The plant is built in the engine: 5 bodies, 1 actuator, 3\.528 kg at dt 0\.002 s\./ }).waitFor({ timeout: 10000 });
  await page.locator('#poster-simulate[data-stage="built"]').waitFor({ timeout: 15000 });
  assert.equal(f.plantLoads.length, 1); const spec = f.plantLoads[0].spec;
  assert.equal(f.plantLoads[0].project, id); assert.deepEqual(spec.parts.map((p) => p.massKg), [0.496, 0.7936, 0.23808], 'the fixture kernel\'s masses at 1.24 g/cm³, over a thousand'); assert.deepEqual(spec.parts[1].extentsM, [0.04, 0.04, 0.4]);
  assert.deepEqual(spec.actuators, [{ joint: 'carriage-slide', stallNm: 2.942, noLoadRadS: 4.7166, gearRatio: 40, continuousNm: 1.471, row: { id: 'sts3215-12v', source: 'embodied', name: 'fixture bus servo 12 V', route: '/api/embodied/build/catalog', readAt: spec.actuators[0].row.readAt } }], 'the drive is the catalog row as read, with the route and the moment');
  assert.deepEqual(spec.task, { deltaM: [0, 0, 0.3], timeS: 5, loadKg: 2, line: 'lifts 2 kg to 300 mm in 5 s' }); assert.deepEqual(spec.payload, { massKg: 2, attachedTo: 'carriage' });
  assert.match(await text('#simulate-stage'), /^built · plant built in the engine: 1 actuator at dt 0\.002 s, 3\.528 kg · no plant-[0-9a-f-]+-\* report yet in \/tmp\/embodied-reports · the reach policy/);
  assert.equal(await text('#simulate-figure'), '1'); assert.equal(await text('#act-simulate'), 'Run the baselines');
  // Run the baselines: the PD baseline's reached time from the engine.
  await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /The PD baseline ran in the engine: reached 5 of 5 episodes within the brief's time, in 3\.58 s; RMS motor torque 0\.549 N·m\./ }).waitFor({ timeout: 10000 });
  await page.locator('#poster-simulate[data-stage="baseline"]').waitFor({ timeout: 15000 });
  assert.equal(f.plantTrains.length, 1); assert.equal(f.plantTrains[0].timesteps, 0); assert.deepEqual(f.plantTrains[0].task, spec.task);
  assert.equal(await text('#simulate-figure'), '3.58 s'); assert.match(await text('#simulate-sub'), /^to the target with 2 kg \(the PD baseline; the brief allows 5 s\)$/);
  assert.match(await text('#simulate-stage'), new RegExp(`^baseline · plant-${id}-reach-seed0\\.json: the PD baseline reached 5 of 5 within 5 s, in 3\\.58 s · RMS motor torque 0\\.549 N·m of 1\\.471 N·m continuous, peak 1\\.415 N·m · plant built`));
  assert.equal(await text('#act-simulate'), 'Train the policy');
  // Train the policy: a job the engine reports; while it runs the poster says so and the button waits.
  await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /Training started in the engine: 60000 PPO steps/ }).waitFor({ timeout: 10000 });
  await page.locator('#poster-simulate[data-stage="training"]').waitFor({ timeout: 15000 });
  assert.equal(f.plantTrains[1].timesteps, 60000, 'the engine\'s default length');
  assert.match(await text('#simulate-stage'), /^training · plant-.*-reach-seed0\.json seed 0: 0 of 60000 steps in 0 s \(Reload to follow\)/); assert.equal(await page.locator('#act-simulate').isDisabled(), true);
  f.finishJob(false); await reload();
  assert.equal(await stage('simulate'), 'trained'); assert.equal(await text('#act-simulate'), 'Certify');
  assert.match(await text('#simulate-stage'), /^trained · plant-.*-reach-seed0\.json \(60000 PPO steps, seed 0\): the baseline still wins · policy reached in 4\.34 s, RMS motor torque 0\.549 N·m of 1\.471 N·m · uncertified/);
  assert.equal(await text('#simulate-figure'), '4.34 s');
  // Certify: refused first (the fixture says so), then certified; Close the phase binds the read.
  f.certifyOk = false; let n1 = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /Refused at 1 of 1875 control steps — first: did not reach the target within 5 s \(fixture\)\./ }).waitFor({ timeout: 10000 });
  await page.locator(`#studio[data-reads="${n1 + 1}"]`).waitFor({ timeout: 15000 }); assert.equal(await stage('simulate'), 'trained');
  assert.match(await text('#simulate-stage'), /certification refused at 1 of 1875 control steps — first: did not reach/); assert.equal(await text('#act-simulate'), 'Train the policy');
  f.certifyOk = true; f.reports.reports = f.reports.reports.filter((r) => !/certificate/.test(r.file)); f.reports.reports.find((r) => r.file.startsWith('plant-')).certified = null; await reload();
  n1 = Number(await page.locator('#studio').getAttribute('data-reads')); await page.click('#act-simulate');
  await page.locator('.toast').filter({ hasText: /Certified: 1875 control steps passed the gate; the baseline still wins\./ }).waitFor({ timeout: 10000 });
  await page.locator(`#studio[data-reads="${n1 + 1}"]`).waitFor({ timeout: 15000 }); await page.locator('#poster-simulate[data-stage="certified"]').waitFor({ timeout: 15000 });
  assert.equal(f.plantCertifies.length, 2); assert.equal(f.plantCertifies[1].file, `plant-${id}-reach-seed0.json`); assert.equal(f.plantCertifies[1].spec.actuators[0].gearRatio, 40, 'the spec rides with the certify');
  assert.match(await text('#simulate-stage'), /^certified · plant-.*: the baseline still wins \(the gate re-measured\) · policy reached in 4\.34 s against the baseline's 3\.58 s, RMS motor torque 0\.549 N·m of 1\.471 N·m · certified \(1875 control steps, policy sha fixture-sha-\) · the reach policy/);
  assert.equal(await text('#act-simulate'), 'Close the phase');
  await shoot(page, 'lift-product-certified-1280');
  // An engine restart drops the loaded plant, not the work: the poster stays certified and offers to load it again.
  const loaded = new Map(f.plants); f.plants.clear();
  await reload();
  assert.equal(await stage('simulate'), 'certified'); assert.match(await text('#simulate-stage'), /certified \(1875 control steps/); assert.match(await text('#simulate-stage'), /plant not built in the engine/);
  assert.equal(await text('#act-simulate'), 'Build the plant', 'a phase closes only with the plant read');
  for (const [k, v] of loaded) f.plants.set(k, v);
  await reload();
  await page.click('#act-simulate'); await page.locator('#close-dialog[open]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#close-revision').inputValue(), 'fixture-sha-lift-0');
  await page.click('#close-dialog button[value="close"]'); await page.locator('#poster-simulate[data-closed="1"]').waitFor({ timeout: 10000 });
  const body = await api('GET', `/projects/${id}/body`);
  assert.equal(body.status, 200, JSON.stringify(body.json));
  assert.deepEqual(body.json.actuators, [{ joint: 'carriage-slide', rangeRad: [0, 0.35], unit: 'm', type: 'slide', continuousNm: 1.471, stallNm: 2.942, noLoadRpm: 45.04, gearRatio: 40 }]);
  assert.equal(body.json.walker.kind, 'certified-policy'); assert.equal(body.json.walker.policySha256, 'fixture-sha-lift-0'); assert.deepEqual(body.json.walker.command, ['payloadTargetM']);
  assert.deepEqual(body.json.node, { kind: 'plant', endpoint: '/api/embodied/physics/plant' }); assert.equal(body.json.plant.physicsDt, 0.002); assert.equal(body.json.plant.tickS, 0.02);
  assert.equal(body.json.senses.find((s) => s.name === 'joints').count, 1);
  // The spider's Mechanism screen is read-only: its joints are the plant's own.
  const spiderId = await spider(); await goto(`#/product/${spiderId}/mechanism`);
  assert.equal(await page.locator('#mech-readonly').count(), 1); assert.equal(await page.locator('#mech-save').count(), 0);
  assert.equal(await page.locator('#mech-readonly li[data-joint]').count(), 18);
  // The plant route absent: what was measured stays on the poster, it says the plant is not built, and Build the plant waits.
  f.plantCode = 404; await goto(`#/product/${id}`);
  assert.equal(await stage('simulate'), 'certified'); assert.match(await text('#simulate-stage'), /plant not built in the engine/); assert.equal(await text('#act-simulate'), 'Build the plant');
  assert.equal(cannedCatalog().servos[0].id, 'sts3215-12v');
});

test('the design partner\'s engine orders run from the open page: a part built and bound, a read in the engine\'s words, a poster pressed, an absent engine named', async () => {
  await open({});
  const made = await api('POST', '/projects', { name: 'the hanger', brief: { what: 'a clothes hanger', requirements: ['holds a coat', 'hangs on a closet rail'] } });
  const id = made.json.project.id;
  await goto(`#/product/${id}`);
  assert.equal(await stage('design'), 'concept');
  const contract = await api('POST', `/projects/${id}/orders`, { action: 'read', input: { what: 'cad-contract' } });
  assert.equal(contract.status, 201); assert.equal(contract.json.order.status, 'done');
  assert.deepEqual(contract.json.order.result.reply.contract.bases, { box: 'sizeX, sizeY, sizeZ' });
  const part = await api('POST', `/projects/${id}/orders`, { action: 'cad-create', input: { name: 'Hook', base: { kind: 'box', sizeX: 30, sizeY: 20, sizeZ: 10 }, features: [] } });
  assert.equal(part.status, 201); assert.equal(part.json.order.status, 'done', JSON.stringify(part.json.order.result));
  assert.equal(part.json.order.result.design.bound, true);
  const modelId = part.json.order.result.modelId;
  assert.deepEqual((await api('GET', `/projects/${id}`)).json.bindings.design.artifact.modelIds, [modelId]);
  await page.locator('#poster-design[data-stage="parts-complete"]').waitFor({ timeout: 15000 });
  const pressed = await api('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'fabricate', button: 'Make the print set' }, waitMs: 30000 });
  assert.equal(pressed.json.order.status, 'done', JSON.stringify(pressed.json.order.result));
  assert.equal(pressed.json.order.result.stage, 'fabricated'); assert.match(pressed.json.order.result.line, /1 of 1 parts exported watertight/);
  assert.equal(await page.locator('#make-dialog[open]').count(), 0, 'the dialog does not sit over the page after an order');
  const none = await api('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'design', button: 'Certify' } });
  assert.equal(none.json.order.status, 'failed'); assert.match(none.json.order.result.refused, /no Certify button/);
  f.cadStudio = 404;
  const absent = await api('POST', `/projects/${id}/orders`, { action: 'read', input: { what: 'cad-models' } });
  assert.equal(absent.json.order.status, 'failed'); assert.match(absent.json.order.result.refused, /not installed on this swarm/);
});

test('any machine, not only the example: a product from a brief with parts the partner built gets the plant path, the Controller closes on the plant, and a product made on the rail appears without a reload', async () => {
  await open({});
  const made = await api('POST', '/projects', { name: 'bench lift', brief: { what: 'a small motor-driven lift', requirements: ['lifts 2 kg to 300 mm in 5 s', 'driven by one servo motor', 'runs off a 12 V supply'] } });
  assert.equal(made.status, 201);
  await page.locator('.poster[data-product]').waitFor({ timeout: 12000 });
  const id = made.json.project.id;
  const opened = await api('POST', `/projects/${id}/orders`, { action: 'open', input: {} });
  assert.equal(opened.json.order.status, 'done'); assert.ok(opened.json.order.result.posters.some((p) => p.phase === 'simulate'));
  assert.equal(await page.locator('#poster-simulate').count(), 1, 'the order opened the product on the page');
  const ids = {};
  for (const name of ['Base plate', 'Column', 'Carriage']) {
    const r = await api('POST', `/projects/${id}/orders`, { action: 'cad-create', input: { name, base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 40 }, features: [] } });
    assert.equal(r.json.order.status, 'done', JSON.stringify(r.json.order.result)); ids[name] = r.json.order.result.design.partId;
  }
  assert.deepEqual(Object.values(ids), ['base-plate', 'column', 'carriage']);
  await reload();
  assert.equal(await stage('simulate'), 'concept'); assert.match(await text('#simulate-stage'), /no mechanism is defined/);
  assert.equal(await stage('controller'), 'on-the-plant'); assert.equal(await text('#act-controller'), 'Close the phase');
  const rows = cannedCatalog().servos[0];
  const saved = await api('PUT', `/projects/${id}/mechanism`, { mechanism: { parts: [{ id: 'base-plate', name: 'Base plate' }, { id: 'column', name: 'Column' }, { id: 'carriage', name: 'Carriage' }], base: 'base-plate', joints: [{ id: 'mount', parent: 'base-plate', child: 'column', type: 'fixed', axis: [0, 0, 1], originMm: [0, 0, 10] }, { id: 'slide', parent: 'column', child: 'carriage', type: 'slide', axis: [0, 0, 1], rangeM: [0, 0.35], originMm: [0, 0, 0], drivenBy: rows.id, gearRatio: 100 }], motors: [{ rowId: rows.id, source: 'embodied' }], payload: { massKg: 2, attachedTo: 'carriage' } } });
  assert.ok(saved.status < 300, JSON.stringify(saved.json));
  await reload();
  assert.equal(await text('#act-simulate'), 'Build the plant');
  const built = await api('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'simulate', button: 'Build the plant' } });
  assert.equal(built.json.order.status, 'done', JSON.stringify(built.json.order.result));
  assert.equal(built.json.order.result.stage, 'built'); assert.match(built.json.order.result.said, /The plant is built in the engine/);
  assert.equal((await api('GET', `/projects/${id}`)).json.bindings.simulate.artifact.kind, 'plant');
  // The mechanism changes: the old plant reads stale, and rebuilding clears it.
  const m = (await api('GET', `/projects/${id}/mechanism`)).json.mechanism;
  m.joints.find((j) => j.id === 'slide').gearRatio = 40;
  assert.ok((await api('PUT', `/projects/${id}/mechanism`, { mechanism: m })).status < 300);
  await reload();
  await page.locator('#poster-simulate[data-stage="stale"]').waitFor({ timeout: 15000 }); assert.equal(await text('#act-simulate'), 'Build the plant');
  const rebuilt = await api('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'simulate', button: 'Build the plant' } });
  assert.equal(rebuilt.json.order.result.stage, 'built', JSON.stringify(rebuilt.json.order.result));
  // An order reads the poster fresh: the engine lost the plant behind the page's back, and the press says so instead of acting on what the page last saw.
  f.plants.clear();
  const late = await api('POST', `/projects/${id}/orders`, { action: 'press', input: { phase: 'simulate', button: 'Run the baselines' } });
  assert.equal(late.json.order.status, 'failed', JSON.stringify(late.json.order.result)); assert.match(late.json.order.result.refused, /no Run the baselines button/); assert.ok(late.json.order.result.buttons.includes('Build the plant'));
});

